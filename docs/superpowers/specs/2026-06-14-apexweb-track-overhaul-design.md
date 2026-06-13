# ApexWeb 3D track overhaul — design

Date: 2026-06-14
Status: approved (owner picked all four directions)
Scope: ApexWeb browser prototype only. Pure **render layer** — the deterministic
stat-sim, netcode and `ctx._buf` snapshot contract are NOT touched.

## Problem

After the centripetal-spline fix (commit 56a1907) the track centerline is smooth,
but corners still look wrong. Root cause, proven numerically (`tools/ribbon_diag.mjs`):

- The road ribbon is built by offsetting the centerline by **±halfWidth along the
  local normal** (`ribbonEdges`). This naive parallel offset **self-intersects on
  the inside of any corner whose radius is smaller than the half-width**.
- On the bundled Barcelona outline: sharpest corner radius `0.0187` (normalized) vs
  half-width `0.0317` → ratio **1.69 > 1**. Edges fold backward at **7 sample points**
  across **4 corners** (the bowtie/crease in the asphalt the owner sees).

Two secondary issues:
- **Kerbs run around the entire lap** (every edge segment is coloured red/white,
  `k % 2`), including straights, as a thin 1px dashed line — not real corner rumble strips.
- **Only one circuit shape exists** (`TRACK_PATH` = Barcelona in `data.js`); it renders
  for every round regardless of which real circuit the round is.

## Goal

Make the 3D track read like a real circuit: correct corner geometry, real kerbs,
the right circuit per round, width/run-off, and (last, expensive) elevation.

## Architecture invariants (unchanged from the 3D batch)

- 3D reads the same `ctx._buf` / `ctx.snapshot.cars` that the 2D screen maintains.
- Pure-math lives in `src/geom3d.js` (no THREE, no DOM) and is unit-tested
  (`tests/geom3d.test.js`, `node --test`). THREE scene lives in `src/ui/race3d.js`
  (not test-imported; owner F5 verifies it).
- Determinism preserved: no `Math.random` in geometry (the procedural surface noise in
  race3d is cosmetic and already isolated).
- Each phase ships in an isolated git worktree → opus review → clean merge to main →
  owner F5 before the next phase.

---

## Phase 1 — Corner geometry (the fix) — DETAILED

The foundation. Phases 3–4 modify the same ribbon, so the offset math is corrected first.

### 1a. Curvature-clamped ribbon (kills the fold)

`geom3d.js`:
- **New exported `radiusAt(cl, frac, w = 1/240)`** — local turn radius of the centerline
  over a small symmetric window (same formula as `ribbon_diag.mjs`): sample 3 points
  `frac-w, frac, frac+w`, `dθ = |asin(cross(v1,v2)/(|v1||v2|))|`,
  `radius = ((|v1|+|v2|)/2) / dθ`, returns `Infinity` on a straight (`dθ ≈ 0`).
- **Modify `ribbonEdges(cl, halfW, steps)`** to clamp the half-width per sample:
  `const hw = Math.min(halfW, radiusAt(cl, f, 1/steps) * SAFE)` with `SAFE = 0.9`,
  then offset both edges by `hw` (symmetric → centerline stays centred; the road
  narrows slightly at hairpins, which is realistic and guarantees the inner edge can
  never reach the centre, so no self-intersection).
- Symmetric (not inner-only) chosen for: centred centerline (car placement stays valid),
  simpler code, and natural-looking hairpin narrowing. Width lost is tiny (only the few
  samples where radius < halfWidth).

### 1b. Car lateral clamp (cars stay on asphalt)

`race3d.js` frame loop: after easing `car.lat`, clamp it to the local road:
`const hwLocal = Math.min(HW_N, radiusAt(cl, prog, 1/STEPS) * 0.9);
car.lat = clamp(car.lat, -(hwLocal - CAR_HALF), +(hwLocal - CAR_HALF))` with
`CAR_HALF ≈ 0.0015` normalized. Prevents the racing-line + side-step offset from
putting a car onto the grass at a narrowed hairpin.

### 1c. Corner-only kerbs

`geom3d.js`:
- **New exported `cornerMask(cl, steps, maxR)`** → `boolean[steps]`, `true` where
  `radiusAt(cl, k/steps, 1/steps) < maxR`. Marks the corner samples; straights are `false`.

`race3d.js`:
- Replace the two "kerbs around the whole loop" `LineSegments` with kerb **quads** drawn
  only over `cornerMask` runs, on both the inner and outer edge, raised `y = 0.02`,
  alternating red/white in **chunks** of ~4 samples (not per-sample), real width
  (~0.5 world units inward from the edge). One merged `BufferGeometry` with vertex colours,
  `MeshBasicMaterial`. `maxR` calibrated so straights have no kerbs and corners do
  (start from `maxR ≈ 0.10` normalized; tune against `cornerMask` count on Barcelona).

### Phase 1 verification

- `tools/ribbon_diag.mjs` re-run: **folds = 0** (was 7). Add this as the success gate.
- `tests/geom3d.test.js`:
  - **Update** the existing `ribbonEdges` "exactly halfW" test — sample only mid-straight
    indices (e.g. `[10, 90, 130]` of 200; the old `50` is a square corner and now clamps).
    Document why in a comment.
  - **Add** `radiusAt`: on a circle of radius R (reuse the 64-pt circle fixture) returns
    `≈ R`; on a straight square edge returns a large value / `Infinity`.
  - **Add** "ribbon does not fold": small circle with `halfW > R`; assert for every sample
    `(edge[k+1]-edge[k]) · tangent ≥ 0` on both edges (the naive ribbon fails this; the
    clamped one passes).
  - **Add** `cornerMask`: all-true on a circle, all-false on a straight edge, mixed on
    `TRACK_PATH`.
- `node --check src/ui/race3d.js`; owner F5: tight corners no longer crease, kerbs only in
  corners, cars stay on track.

---

## Phase 2 — Real circuits per round — SKETCH (detail when reached)

- New `src/track_shapes.js`: `SHAPES = { "Barcelona": [...], "Monza": [...], ... }`, flat
  normalized paths ported from the Godot `track_shapes.gd` (f1-circuits-svg, CC BY 4.0) —
  same provenance as the current `TRACK_PATH`.
- The sim's per-round `track` object (in `data.js` calendar) gains a `shape` key (or a
  `shapeName` resolved against `SHAPES`). `race3d.init` reads
  `ctx.snapshot.track?.shape ?? TRACK_PATH`. Host/client match because the snapshot
  already carries the track.
- Open questions for later: how the calendar names rounds; how many circuits to port first
  (start with the 5–8 the calendar actually uses); fallback when a shape is missing.

## Phase 3 — Width + run-off — SKETCH

- Variable half-width: `ribbonEdges` takes an optional `widthAt(frac)` (wider on corner
  entry, standard on straights), composed with the Phase-1 curvature clamp.
- Run-off: extra flat geometry outside the kerbs at corners — grass (green) and gravel
  (tan) aprons — built from the same edge samples pushed further out on `cornerMask` runs.
- Apex/exit kerb extent tuned from Phase 1's kerb system.
- Open questions: data source for per-corner width/run-off (procedural from radius vs
  authored), how much it should affect readability vs clutter.

## Phase 4 — Elevation / banking — SKETCH (expensive, owner-gated)

- Height profile `h(frac)` along the lap (procedural from a track-name seed first; optional
  authored profiles per circuit later). Ribbon vertices and kerbs get `y = h*scale`; cars
  sample `h` at their `prog` for `y` (currently hard-zero); sector/start lines too.
- Banking: roll the cross-section by an angle in corners (sign from `turnRateAt`,
  magnitude from `1/radius`).
- Touches camera framing (already 3D), shadow frustum (already covers ±WORLD), and car
  `rotation` (add pitch/roll from the surface). Biggest change → its own design pass and an
  explicit owner "go" before starting.

---

## Out of scope

- No sim/netcode/balance changes. No physics. No new dependencies.
- Richer non-track scenery (crowds, billboards, barriers) tracked separately in the
  3D-race-view backlog, not here.

## Rollout

One phase per worktree, in order. After each: `node --test` green, phase-specific
verification (Phase 1: folds = 0), opus review, merge to main, owner F5. Phase 4 needs a
fresh owner "go" before it starts.
