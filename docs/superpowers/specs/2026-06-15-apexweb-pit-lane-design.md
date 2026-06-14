# ApexWeb Drawable Pit Lane + Cars Drive It — Design

**Date:** 2026-06-15
**Status:** Approved (brainstorm); owner authorized building to completion without further approval gates.
**Topic:** Author a pit-lane path in the editor; in the race, cars **drive** down it (in-lap → box → out-lap) in both the 2D minimap and the 3D view, instead of teleporting to a fixed spot.

This is **Feature B** of the editor trio (A preview done, C auto-zones done, B = this).

---

## Goal

Today a pitting car **teleports** to a fixed pit spot (2D `race.js:117` → `PIT_STOP`; 3D `race3d.js:268` → a fixed `PIT`). The owner wants to **draw** a pit lane and have cars **actually drive through it**.

## Framing — render-only

The sim already owns pit **timing**: on a pit, `sim.js` sets `c.pitTimer = pitLoss` and **freezes the car at start/finish** for that long; `inPit` (`= pitTimer>0`) is in the snapshot (`main.js:250`). This feature is **purely visual**: it animates the car along a drawn lane during the `inPit` window. **`sim.js` / `data.js` / `pitLoss` / the snapshot contract are untouched** → balance/determinism safe.

⚠️ **Consequence:** the pit lane lives at **start/finish** — that's where the sim freezes pitting cars. The owner authors its side/width/length there. (Pits on an arbitrary straight would require a sim change — out of scope.)

## Data model

Add to the edited-track record (round-tripped by `track_store.js`, alongside `pit/pitLoss/zones/cornerOverrides`):

```
pitLane = { entry: 0..1, exit: 0..1, side: -1 | 1, width: number } | null
```

- `entry`/`exit` — lap-fractions bracketing S/F (e.g. 0.95 / 0.06). The **box** is implicitly at frac **0** (S/F), where the sim freezes the car.
- `side` — which side of the track the lane sits (sign of the lateral offset).
- `width` — lateral offset in **track half-widths** (default ~2.5), scaled per-renderer.
- `null` (default / unauthored, e.g. Barcelona) → renderers use the **default lane** `{entry:0.95, exit:0.06, side:1, width:2.5}` (matches today's spur), so every race gets the drive animation. Render-only; no balance impact.

## Pure core — `src/pitlane.js` (no imports, unit-tested)

```
pitLaneSample(phase, lane) -> { frac, latUnit }
```
`phase` 0..1: `[0,0.5)` in-lap (frac eases forward `entry → 0`, `latUnit` ramps `0 → side`); `[0.5,1]` out-lap (frac eases forward `0 → exit`, `latUnit` ramps `side → 0`). `frac` advances **forward** along the lap (so `0.95 → 0` crosses S/F, never backward). `latUnit ∈ [-1,1]` is the *signed unit* offset (the box depth = `±1`); each renderer multiplies by `width × itsHalfWidth`.

```
advancePitPhase(state, inPit, dt, opts) -> { phase, active }
```
Drives the phase from the render loop with no snapshot change: a fresh `inPit` (`!active`) resets `phase=0`; while `inPit`, ramps `phase → 0.5` over `inSec` (~1.2s) then holds (the box); once `inPit` goes false, ramps `phase → 1` over `outSec` (~1.2s) then `active=false` (car released to its normal on-track position). Both helpers are pure → both renderers reuse them; the box-hold duration auto-matches the real pit (it's "until `inPit` false") with no `pitTimer` exposure.

## Components

| File | Create/Modify | Responsibility |
|---|---|---|
| `src/pitlane.js` | Create | Pure `pitLaneSample` + `advancePitPhase`. Unit-tested. |
| `src/track_store.js` | Modify | Round-trip `pitLane` (save/effectiveTrack), backward-compatible default `null`. |
| `editor.html` | Modify | Pit controls in `#pitctl`: side toggle + width slider + hint. |
| `src/ui/editor.js` | Modify | Пит mode authors `pitLane`: click track → entry, click → exit (`nearestFrac`); side/width; draw the lane (`offsetPoint`); persist. |
| `src/ui/race.js` | Modify | 2D: resolve `pitLane` (via `ensureTrack`/`effectiveTrack`) + animate the car along the lane (`advancePitPhase` + `pitLaneSample` → `pitPos`). |
| `src/ui/race3d.js` | Modify | 3D: same — resolve `edited.pitLane` + animate (`offsetPoint` + `wx/wz`). |
| `tests/pitlane.test.js` | Create | Unit tests for both pure helpers. |
| `tests/track_store.test.js` | Modify | A `pitLane` round-trip assertion. |
| `README.md` | Modify | One line under the editor's Пит description. |

**Untouched:** `sim.js`, `data.js`, `track.js`, `track_build.js`, `main.js`, netcode, the snapshot contract.

## Authoring (editor — extend «Пит» mode)

- A click on the canvas in Пит mode sets, alternately, the lane **entry** then **exit** — each snapped to the nearest lap-fraction via `nearestFrac(buildCenterline(splinePath(toFlat(pts))), clickPoint)`. A small hint shows which is next.
- `#pitctl` gains a **side** toggle (◀/▶, flips `pitLane.side`) and a **width** slider (track-half-widths). The existing `pitloss` field stays.
- The lane is **drawn** on the canvas: a thick translucent stroke from `offsetPoint(cl, frac, side*width*HALF_W)` for `frac` stepping `entry → 0 → exit` (forward), plus a box marker at frac 0. Visible in the 2D canvas and (via Feature A) in the 3D preview when objects/geometry refresh.
- Persisted in `pitLane` within the saved record (and JSON export/import).

## Rendering (both views)

Each renderer, per car per frame: `car._pit = advancePitPhase(car._pit, inPit, dt)`. If `car._pit.active`, position the car at `pitLaneSample(car._pit.phase, lane)` mapped to that renderer's coords; else the normal on-track position.

- **2D (`race.js`):** replaces the `inPit → PIT_STOP` teleport (line 117). `lane` resolved when the circuit binds (`ensureTrack`→`effectiveTrack(name).pitLane` or the default). Position = `pitPos(frac, latUnit * width * MINIMAP_HW)` (reuses the existing `pitPos`/`normalAt`; `MINIMAP_HW` chosen so the default `width 2.5` ≈ today's depth 6.5). The map loop already has `dt` from frame timing.
- **3D (`race3d.js`):** replaces the `c.inPit → PIT` teleport (line 268). `lane` from `edited.pitLane` (the geometry it already resolves) or the default. Position = `offsetPoint(cl, frac, latUnit * width * HW_N)` → `wx/wz`; heading from `tangentAt(cl, frac)`. Its frame loop has a `dt` (add one from `nowMs()` delta if absent).

## Error handling

- **No `pitLane`** (most tracks): the default lane is used → cars drive the existing spur; no teleport, no crash.
- **Degenerate lane** (`entry==exit`, missing fields): `pitLaneSample` clamps and defaults (`side=1,width=1`); a zero-length lane just sits at the box — no NaN.
- **Editor with `<3` points:** Пит-mode clicks need a centerline; guarded like the zone/auto handlers (no-op if `pts.length<3`).
- **Backward compat:** old saved records without `pitLane` load as `null` → default lane.

## Testing

- `tests/pitlane.test.js`: `pitLaneSample` at phase 0 / 0.5 / 1 (frac=entry/0/exit, latUnit=0/side/0), forward-wrap (entry 0.95 → frac increases through 1→0, never backward), monotone ease, clamp; `advancePitPhase` in-lap ramp to 0.5, hold while inPit, out-lap ramp to 1 + `active=false`, fresh-pit reset, `dt` scaling.
- `tests/track_store.test.js`: a `pitLane` round-trip + default-`null` for old records.
- `node --check` on `editor.js`, `race.js`, `race3d.js`.
- Full `node --test` green (renderers have no unit tests; `pitlane.js`/`track_store.js` covered).
- **Owner F5** (SVG/WebGL animation not headless-verifiable): author a lane (entry/exit/side/width), 🏁 race → a pitting car **drives in → sits in the box → drives out** in both the **2D minimap** and **3D**; an unauthored track uses the default spur the same way; a normal race is otherwise unchanged.

## Scope / YAGNI

- **In:** `pitLane` data model + round-trip; editor authoring (entry/exit/side/width + draw); the two pure helpers; 2D + 3D drive animation; README.
- **Out (deferred):** pits on an arbitrary straight (needs a sim change); pit-crew/tyre-change animation; multiple boxes / per-car stalls; exposing `pitTimer` in the snapshot (not needed — box-hold is keyed on `inPit`).
