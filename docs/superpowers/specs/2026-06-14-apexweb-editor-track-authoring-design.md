# ApexWeb Editor → Track-Authoring Tool — design

Date: 2026-06-14
Status: approved (owner: "ок" to scope + design)
Scope: evolve the existing ApexWeb track editor (`editor.html`) from a *visual* shape/scenery
editor into a tool that also **authors a track's gameplay data** — pit lane, overtake zones,
corner classification — plus an **editor zoom/pan** for precise corner tuning. **Шаг 1 only:** the
editor AUTHORS this data into the saved track record. **Шаг 2 (the sim USING it) is explicitly
deferred** to a separate design (see Out of Scope). The deterministic sim, netcode, and snapshot
contract are NOT touched by this work.

## Goal

Make the editor a real track constructor. Today it edits the *look* (control points + decorative
objects) and that only feeds the 3D *visual*. The owner wants to also set up the pieces that define
how a track *plays*: where the pit lane is, where overtakes happen (zones), and the corner profile —
authored now, consumed by the sim "потом". And a zoom/pan so corners can be tuned precisely.

## The Шаг 1 / Шаг 2 boundary (the load-bearing architectural decision)

The editor writes tracks to `localStorage["apexweb_tracks"]`; today that influences ONLY the 3D
render (`effectiveTrack` → `race3d`). The sim (`sim.js`) races ONE hardcoded track (`TRACK` /
`TRACK_PATH`, Barcelona). So all authored gameplay data splits cleanly into two layers:

- **Layer 1 (THIS spec):** the editor authors `pit`, `zones`, `cornerOverrides` into the track
  record. Pure UI + data. No sim/netcode/track.js change. Safe.
- **Layer 2 (deferred):** the sim reads & uses that data (pit position/loss, overtake zones already
  have a sim consumer, corners influence pace MM-style) — AND first the sim must be able to race a
  non-Barcelona track at all. This is balance/determinism-sensitive → its own design + the Python
  harness. **Not in this spec.**

The data formats below are chosen to match what the sim ALREADY consumes (esp. `overtake_zones`), so
Layer 2 is a thin bridge later, not a re-author.

## Data model

The saved track record (`localStorage["apexweb_tracks"][name]`) gains optional fields. Old records
lacking them load with defaults (fully backward-compatible):

```js
{
  points: number[],            // EXISTING — flat normalized control points [x0,y0,...]
  objects: Obj[],              // EXISTING — [{type,x,y,rot}]
  pit:     { x: number, y: number } | null,   // pit-box marker, normalized 0..1; null = default (start/finish)
  pitLoss: number | null,                      // pit-loss seconds; null = engine default
  zones:   Zone[],                             // overtake zones; [] = none. SAME shape as TRACK.overtake_zones
  cornerOverrides: { [sector: number]: CornerClass } | null,   // manual class overrides; null/absent = all auto
}
// Zone        = { sectors: number[], ease: number /*0..1*/, type: "brake" | "slip" }   (sectors = mini-sector indices 0..17)
// CornerClass = "straight" | "high" | "med" | "low"
```

**Mini-sectors** are the sim's existing model: `N_MINI = 18` equal lap-fraction spans
(`track.js: sampleAt(f) → floor(((f%1)+1)%1 * 18)`). The editor computes the SAME 18 spans on the
edited centerline, so a zone painted on "sector 3" maps to the sim's sector 3 by construction.

## New pure helpers (geom3d.js — testable, TDD)

```js
// Lap-fraction of the centerline point nearest to a normalized point p (samples `steps` points).
// Used for "click near the track → which mini-sector" (zone painting) and pit snapping.
export function nearestFrac(cl, p, steps = 360): number   // 0..1

// Corner speed-class per mini-sector from local curvature (radiusAt). Returns string[n].
// "straight" if the sector barely turns, else "high"/"med"/"low" by tightest radius in the sector.
export function sectorCornerClasses(cl, n = 18, opts = {}): CornerClass[]
```
(Mini-sector index from a frac is trivial inline: `Math.floor(((f%1)+1)%1 * n)`.)

`sectorCornerClasses` samples `radiusAt` across each sector (reusing the wide-window approach from
`buildSpeedWarp`) and classifies by the tightest radius: `r ≥ straightR` → "straight"; else
"high" (`r ≥ highR`) / "med" (`r ≥ lowR`) / "low". Thresholds are consts with sane defaults.

## track_store.js changes

`saveTrack(name, data)` and `effectiveTrack(name, preset)` round-trip the new fields. `saveTrack`
currently persists `{points, objects}` explicitly — extend to also persist `pit, pitLoss, zones,
cornerOverrides` (defaulting absent ones). `effectiveTrack` returns them (defaults when no edit), so
Layer 2 + the editor reload both see them.

## Editor features

### Шаг 0 — zoom / pan (render-only)

The editor view becomes a stable, user-controlled transform on top of the existing fit-to-canvas:
- `view = { zoom, panX, panY }`. `C()`/`unproject()` apply it on top of the base fit.
- **Wheel** = zoom toward the cursor (keep the world point under the cursor fixed). **Space-drag or
  middle-mouse-drag** = pan. **"По размеру"** button = reset (recompute base fit + zoom=1, pan=0).
- The base fit is computed on track LOAD / point add-remove, NOT every frame — so dragging a point
  no longer re-centres the view. (This also fixes the known "view refits while dragging" wart.)

### Шаг 1a — pit lane

- A **"Пит"** mode: click on the canvas to place the pit-box marker (`pit = unproject(click)`),
  drawn as a "P" icon. A small **pit-loss number input** sets `pitLoss` (seconds).
- Stored in the track record. (Layer 2 will use `pit` for the 3D pit-spot + `pitLoss` for the sim;
  for now it's authored + drawn only.)

### Шаг 1b — overtake zones

- A **"Зоны"** mode shows the **18 mini-sector overlay**: tick marks across the road at frac k/18
  with small sector numbers.
- Zone management: **"+ brake" / "+ slip"** buttons create a zone and make it active; an **ease
  slider (0..1)**; clicking a mini-sector on the track toggles its membership in the active zone
  (click → `nearestFrac` → `floor(frac·18)` → toggle). A zone list lets you select/delete zones.
- Drawn: each zone's sectors filled with its type colour (brake vs slip), active-zone sectors
  highlighted. Stored as `zones: [{sectors, ease, type}]` — exactly `TRACK.overtake_zones`.

### Шаг 1c — corners

- The same sector overlay **colours each mini-sector by its auto corner-class**
  (`sectorCornerClasses`): straight = neutral, high = green, med = amber, low = red — so the track's
  character is visible at a glance.
- **Light manual override:** right-click a sector cycles its class (`straight→high→med→low→straight`),
  stored in `cornerOverrides` (only changed sectors are stored). Purely informational in Layer 1
  (the sim reads it in Layer 2). *Droppable if it bloats the increment — display alone already
  delivers the value; override can move to Layer 2 where it's consumed.*

## Boundary / safety

Everything here is editor UI + data written to the track record. **`sim.js`, `track.js`, the sim's
`TRACK`/`TRACK_PATH`, netcode and the snapshot contract are NOT modified.** The in-game race is
unchanged by this work. Determinism/netcode are unaffected because nothing here feeds the sim yet.

## Testing

- `track_store.test.js` — round-trip the new fields (save `{pit, pitLoss, zones, cornerOverrides}`
  → `loadAll`/`effectiveTrack` returns them; absent fields default).
- `geom3d.test.js` — `nearestFrac` (point on the line → its frac; off-line point → nearest frac,
  monotone sanity); `sectorCornerClasses` (circle → uniform corner class; elongated oval → tighter
  ends a lower class than the long sides; square edges → "straight").
- The editor UI / canvas / zoom / zone-painting are DOM+canvas → **owner F5** (not headless). Where
  feasible I'll preview-verify load + draw via the Claude_Preview MCP (per the rAF-throttle note:
  synchronous render + pixel sampling), but interaction + feel is F5.
- `node --check` all changed files; full `node --test` stays green.

## File structure

- `src/geom3d.js` (modify) — add `nearestFrac`, `sectorCornerClasses` (pure, tested).
- `src/track_store.js` (modify) — round-trip the new fields.
- `editor.html` (modify) — mode buttons (Точки / Объекты / Пит / Зоны), "по размеру", zone controls
  (+brake/+slip, ease slider, zone list), pit-loss input.
- `src/ui/editor.js` (modify) — view transform (zoom/pan), mode state machine, pit placement, sector
  overlay + corner colouring, zone painting, persistence wiring. This file grows; keep pure logic in
  `geom3d`. **If `editor.js` becomes unwieldy, split authoring into `src/ui/editor_authoring.js`**
  (sector overlay + zones + pit + corners) imported by `editor.js`.

## Rollout (incremental; each step `node --check` + `node --test` green + owner F5)

1. **Zoom/pan** (Шаг 0) — render-only; fixes the refit wart. (editor.js + editor.html)
2. **Store round-trip + geom3d helpers** — `nearestFrac`, `sectorCornerClasses`, track_store fields. TDD.
3. **Sector overlay + corner colouring** (read-only display of the 18 sectors + auto corner-class).
4. **Overtake-zone painting** + persistence (uses the overlay).
5. **Pit-lane placement** + pit-loss + persistence.
6. **Corner override** (right-click cycle) + persistence. (smallest; droppable)
7. **README** + polish.

## Out of scope (Шаг 2 / deferred — separate design later)

- The sim racing EDITED tracks at all (today it races hardcoded Barcelona) — the bridge.
- The sim USING authored data: pit position → 3D pit-spot; `pitLoss` → sim pit time; `zones` →
  `_resolveCombat` (the consumer already exists, just needs the data wired from an edited track);
  corners → lap-time pace (MM-style downforce-vs-power per corner mix).
- Auto-generating zones from curvature for the full calendar.
- FastF1 real-calendar wiring (TODO #3).
- Applying edited tracks' character to the existing single-track race.
