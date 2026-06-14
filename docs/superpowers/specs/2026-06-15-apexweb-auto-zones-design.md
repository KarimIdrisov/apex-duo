# ApexWeb Auto-Place Overtake Zones — Design

**Date:** 2026-06-15
**Status:** Approved (brainstorm), pending spec review → plan
**Topic:** A heuristic that auto-suggests overtake zones from a track's corner geometry, placed by an **«Авто-зоны»** button in the editor; the owner then edits them.

This is **Feature C** of the editor trio (decision 2026-06-15: A preview done, B drawable pit-lane deferred, C auto-zones).

---

## Goal

Placing overtake zones by hand on every track is tedious. The owner wants the tool to take a first pass — "пытался сам проставить зоны трассам, а я если что подредачил". So: a button that reads the track's corner-class vector and fills in sensible zones (brake zones at the main braking points + a slip zone on the longest straight), which the owner then tweaks with the existing zone-painting UI.

## Constraints

1. **Render / data-authoring only.** No `sim.js` / `data.js` / `track.js` / netcode changes. Overtake zones are authored DATA (`{sectors, ease, type}` on the 18 mini-sectors) that the combat model already consumes — auto-placement just writes that data, exactly like the manual painting does. **Cannot affect balance.**
2. **Pure, decoupled heuristic.** The core is a pure function over the 18-element corner-class array — no imports, no geometry, no THREE — so it is trivially unit-tested.
3. **Aligns with what the owner sees.** It classifies using the SAME `sectorCornerClasses` the editor already draws as the corner-class overlay, and it honours the owner's right-click **corner-class overrides** (`cornerOverrides`). So a suggestion never contradicts the overlay in front of the owner.
4. **Replace, not merge.** «Авто-зоны» replaces the current zones with a fresh suggestion (with a toast); the owner edits after (decision 2026-06-15).

## Architecture / data flow

```
editor.js  «Авто-зоны» click
   cl   = buildCenterline(splinePath(toFlat(pts)))          // already done for the overlay
   auto = sectorCornerClasses(cl, 18)                       // 18 class strings (existing geom3d)
   eff  = auto.map((c, m) => cornerOverrides[m] || c)       // honour the owner's right-click overrides
   zs   = suggestZonesFromClasses(eff)                      // <-- the pure heuristic (autozones.js)
   zones.length = 0; zs.forEach(z => zones.push(z)); activeZone = -1
   refreshZoneList(); render(); toast("Авто-зоны: N")
```

`autozones.js` has **no imports** — the editor (which already computes the classes for the overlay) passes them in. The sim is never touched; the zones land in the same `zones` array the manual painting and the saved-track record already use.

## The heuristic — `suggestZonesFromClasses(classes, opts)`

**Input:** `classes` — array of N (=18) strings in `{"straight","high","med","low"}` (an unknown value is treated as `"straight"`).
**Output:** `[{sectors:[asc indices], ease, type:"brake"|"slip"}]`.
**opts (defaults):** `{ maxBrakes: 3, brakeEase: 0.5, slipEase: 0.45, brakeLen: 3, slipLen: 3 }`.

Speed rank: `straight=3, high=2, med=1, low=0`. `fast(i)` = rank ≥ 2; `slow(i)` = rank ≤ 1. All index arithmetic is mod N (the track is a loop).

1. **Braking points.** For each `i`, it is a braking point if `slow(i) && fast(i-1)` — a slow corner right after a fast sector. Its **approach length** = the count of consecutive `fast` sectors ending at `i-1` (capped at N).
2. **Brake zones.** Sort braking points by approach length (desc; tie-break by index asc). Walk them, building at most `maxBrakes` zones: each zone's sectors = the entry `i` plus up to `brakeLen-1` immediately-preceding `fast` sectors. Maintain a `covered` set; **skip** a braking point whose entry or any built sector is already `covered` (no overlapping brake zones). `type:"brake", ease:brakeEase`.
3. **Slip zone.** Find the longest wrap-aware run of consecutive `"straight"` sectors (run returned in track order from its start index). If its length ≥ 2: take the run minus any `covered` sector, cap to `slipLen`; if ≥ 2 sectors remain, emit one `{sectors:asc, ease:slipEase, type:"slip"}`.
4. **Return** `[...brakeZones, slipZone?]`. Deterministic; no RNG.

Degenerate inputs fall out naturally: an all-`"straight"` oval → 0 brake zones + 1 slip; an all-`"med"` track (no fast sectors) → `[]` (no clear overtaking spots — the owner adds them manually).

## Components

| File | Create/Modify | Responsibility |
|---|---|---|
| `src/autozones.js` | Create | **Pure, import-free** `suggestZonesFromClasses(classes, opts)`. Unit-tested. |
| `src/ui/editor.js` | Modify | «Авто-зоны» handler: compute effective classes, call the heuristic, replace `zones`, refresh + toast. |
| `editor.html` | Modify | An «🎯 Авто-зоны» button in the Зоны panel (`#zonectl`). |
| `tests/autozones.test.js` | Create | Unit tests for the heuristic. |
| `README.md` | Modify | One line under the editor's Зоны description. |

**Untouched:** `sim.js`, `data.js`, `track.js`, `overtake.js`, `track_store.js`, netcode.

## Interfaces

**`src/autozones.js`**
- `suggestZonesFromClasses(classes, opts = {}) -> [{sectors:number[], ease:number, type:"brake"|"slip"}]` — as specified above. Pure; same input → same output; safe on short/odd arrays (returns `[]` if no zones found).

**`src/ui/editor.js`** — new handler (uses existing `pts`, `toFlat`, `buildCenterline`, `splinePath`, `sectorCornerClasses`, `N_MINI`, `cornerOverrides`, `zones`, `activeZone`, `refreshZoneList`, `render`, `toast`):
```js
document.getElementById("autozones").onclick = () => {
  const cl = buildCenterline(splinePath(toFlat(pts)));
  const auto = sectorCornerClasses(cl, N_MINI);
  const eff = auto.map((c, m) => cornerOverrides[m] || c);
  const zs = suggestZonesFromClasses(eff);
  zones.length = 0; for (const z of zs) zones.push(z);
  activeZone = -1; refreshZoneList(); render();
  toast(zs.length ? ("Авто-зоны: " + zs.length) : "Зоны не найдены — расставь вручную");
};
```

## Error handling

- **No clear zones** (no braking points, no straight run): the heuristic returns `[]`; the button toasts «Зоны не найдены — расставь вручную» and leaves the (now-cleared) zone list empty.
- **Too few points** to form a centerline (`pts.length < 3`): the handler is only reachable in Зоны mode on a loaded track (always ≥3 control points), but the heuristic is also `[]`-safe on a degenerate class array.
- **Replace semantics:** the toast makes the replacement explicit; the owner re-clicks for a fresh pass or edits the result.

## Testing

`tests/autozones.test.js` — pure, exact + property assertions:
- **Oval** (`Array(18).fill("straight")`): exactly one zone, `type:"slip"`, 3 sectors, `ease:0.45`, no brake zone.
- **Degenerate** (`Array(18).fill("med")`): `[]`.
- **One braking point** (18 `"straight"` with index 5 `"low"`): a brake zone `{sectors:[3,4,5], ease:0.5, type:"brake"}` + a slip zone of 3 straight sectors not overlapping it; assert the brake zone exactly, and the slip zone's type/length/disjointness.
- **Properties** on a mixed pattern: every sector index ∈ [0,18); brake zones pairwise disjoint; at most `maxBrakes` brake zones; a slip zone present iff a straight run ≥ 2 exists; each brake zone contains a slow sector preceded by a fast one.
- `node --check src/ui/editor.js`; full `node --test` stays green (nothing else changes).
- **Owner F5** (visual): in Зоны mode, **🎯 Авто-зоны** fills sensible brake zones at the heavy braking points + a slip on the long straight; the painted overlay matches; editing/clearing them works; a 🏁 race shows overtakes cluster at the suggested zones.

## Scope / YAGNI

- **In:** the pure heuristic, the editor button (replace + toast, honouring corner overrides), README.
- **Out (deferred):** batch auto-zones across all presets/pack tracks (this is per-current-track in the editor); `ease` derived from straight length (fixed defaults for now); auto-running on track load (explicit button only); tuning the thresholds against real circuits (the owner edits the first pass).
