# ApexWeb Track Phase 1 — Corner Geometry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the 3D track ribbon from self-intersecting at tight corners, and draw kerbs only through corners — fixing the "странные повороты" the owner sees.

**Architecture:** Pure-math in `src/geom3d.js` (unit-tested with `node --test`) gains a local-radius helper; `ribbonEdges` clamps its half-width by that radius so the inner edge can never cross the centerline (symmetric narrowing, realistic at hairpins). A `cornerMask` helper drives corner-only kerbs in `src/ui/race3d.js`, which also clamps each car's lateral offset to the local road width. The deterministic sim, netcode and the `ctx._buf` snapshot contract are untouched.

**Tech Stack:** Vanilla ES modules, `node --test` (no deps), Three.js r160 (render only). Verified on Windows via the Bash tool (git-bash) with `node`.

**Reference:** spec `docs/superpowers/specs/2026-06-14-apexweb-track-overhaul-design.md`. Numeric gate harness already in the tree: `ApexWeb/tools/ribbon_diag.mjs` (currently reports 7 folds; must reach 0).

**Conventions:** run all commands from the `ApexWeb/` directory. Commit with explicit pathspecs only (the owner keeps parallel uncommitted work in this tree — never `git add -A`). Footer every commit with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- `src/geom3d.js` — add `radiusAt(cl, frac, w)` and `cornerMask(cl, steps, maxR)`; modify `ribbonEdges` to clamp half-width by local radius. (pure math, no THREE/DOM)
- `tests/geom3d.test.js` — extend import; fix the existing `ribbonEdges` "exactly halfW" test (its `k=50` sample is a square corner that now clamps); add `radiusAt`, no-fold, and `cornerMask` tests.
- `src/ui/race3d.js` — import the two new helpers; clamp `car.lat` to the local road width; replace the all-the-way-around kerb `LineSegments` with corner-only kerb quads.
- `tools/ribbon_diag.mjs` — unchanged; used as the numeric acceptance gate (folds → 0).

---

## Task 1: `radiusAt` — local turn radius (geom3d)

**Files:**
- Modify: `src/geom3d.js` (add a function above `ribbonEdges`, ~line 57)
- Modify: `tests/geom3d.test.js` (import line + new test)

- [ ] **Step 1: Extend the test import**

In `tests/geom3d.test.js` line 3, add `radiusAt` and `cornerMask` to the import:

```js
import { buildCenterline, pointAt, tangentAt, bounds, cameraFromBounds, ribbonEdges, sampleProg, racingLineOffset, offsetPoint, splinePath, radiusAt, cornerMask } from "../src/geom3d.js";
```

- [ ] **Step 2: Write the failing test**

Append to `tests/geom3d.test.js`:

```js
test("radiusAt: ~R on a circle, large on a straight", () => {
  const R = 1, n = 200, p = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI; p.push(R * Math.cos(a), R * Math.sin(a)); }
  const circle = buildCenterline(p);
  for (const f of [0.1, 0.5, 0.85]) {
    const r = radiusAt(circle, f, 0.03);                 // window a few segments wide -> robust estimate
    assert.ok(Math.abs(r - R) < 0.12, `circle radius ~${R}, got ${r}`);
  }
  const square = buildCenterline([0, 0, 1, 0, 1, 1, 0, 1]);
  assert.ok(radiusAt(square, 0.125, 0.03) > 100, "straight edge -> large/Infinity radius");
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test --test-name-pattern="radiusAt" tests/geom3d.test.js`
Expected: FAIL — `radiusAt is not a function` (not exported yet).

- [ ] **Step 4: Implement `radiusAt`**

In `src/geom3d.js`, insert this function immediately **before** `export function ribbonEdges` (currently ~line 56, right after the `cameraFromBounds` block):

```js
// Local turn radius of the centerline at frac, measured over a small symmetric window `w`
// (the arc through three samples). Returns Infinity on a straight. Used to keep the road
// ribbon from self-intersecting at corners tighter than its own half-width.
export function radiusAt(cl, frac, w = 1 / 240) {
  const a = pointAt(cl, frac - w), b = pointAt(cl, frac), c = pointAt(cl, frac + w);
  const v1x = b[0] - a[0], v1y = b[1] - a[1], v2x = c[0] - b[0], v2y = c[1] - b[1];
  const la = Math.hypot(v1x, v1y) || 1e-9, lb = Math.hypot(v2x, v2y) || 1e-9;
  const cross = v1x * v2y - v1y * v2x;
  const dtheta = Math.abs(Math.asin(Math.max(-1, Math.min(1, cross / (la * lb)))));
  return dtheta > 1e-6 ? (la + lb) / 2 / dtheta : Infinity;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test --test-name-pattern="radiusAt" tests/geom3d.test.js`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add src/geom3d.js tests/geom3d.test.js
git commit -m "feat(apexweb): geom3d radiusAt — local centerline turn radius" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Clamp `ribbonEdges` by radius (no more fold)

**Files:**
- Modify: `src/geom3d.js` (`ribbonEdges`, ~line 58)
- Modify: `tests/geom3d.test.js` (fix existing test + add no-fold test)
- Gate: `tools/ribbon_diag.mjs`

- [ ] **Step 1: Add the no-fold test + fix the existing halfW test**

In `tests/geom3d.test.js`, find the existing test `"ribbonEdges: left/right edges are exactly halfW from the centerline"`. Change its sample list from `[10, 50, 130]` to `[10, 90, 130]` and add a clarifying comment — `k=50` (frac 0.25) is a square corner that now clamps, so it is no longer exactly `halfW`; `90`/`130` are mid-straight. The edited test:

```js
test("ribbonEdges: left/right edges are exactly halfW from the centerline (on straights)", () => {
  const cl = buildCenterline(SQUARE);
  const halfW = 0.05, steps = 200;
  const { left, right } = ribbonEdges(cl, halfW, steps);
  assert.equal(left.length, steps);
  assert.equal(right.length, steps);
  for (const k of [10, 90, 130]) {                 // mid-straight samples only; corners now clamp (see no-fold test)
    const c = pointAt(cl, k / steps);
    assert.ok(Math.abs(Math.hypot(left[k][0] - c[0], left[k][1] - c[1]) - halfW) < 1e-6);
    assert.ok(Math.abs(Math.hypot(right[k][0] - c[0], right[k][1] - c[1]) - halfW) < 1e-6);
  }
});
```

Then append the no-fold test:

```js
test("ribbonEdges does not self-intersect when halfW exceeds the corner radius", () => {
  const R = 0.1, n = 120, p = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI; p.push(R * Math.cos(a), R * Math.sin(a)); }
  const cl = buildCenterline(p);
  const { left, right } = ribbonEdges(cl, 0.2, n);   // halfW 0.2 > radius 0.1 -> naive offset folds; clamp must prevent it
  for (const edge of [left, right]) {
    for (let k = 0; k < n; k++) {
      const a = edge[k], b = edge[(k + 1) % n];
      const [tx, ty] = tangentAt(cl, (k + 0.5) / n);
      assert.ok((b[0] - a[0]) * tx + (b[1] - a[1]) * ty >= -1e-9, `edge segment runs backward (fold) at ${k}`);
    }
  }
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `node --test --test-name-pattern="does not self-intersect" tests/geom3d.test.js`
Expected: FAIL — the current naive `ribbonEdges` folds the inner edge (a backward-running segment trips the assertion).

- [ ] **Step 3: Implement the clamp**

In `src/geom3d.js`, replace the body of `ribbonEdges` (currently lines ~58-69) with:

```js
export function ribbonEdges(cl, halfW, steps = 240) {
  const left = [], right = [];
  for (let k = 0; k < steps; k++) {
    const f = k / steps;
    const [px, py] = pointAt(cl, f);
    const [tx, ty] = tangentAt(cl, f);
    const nx = -ty, ny = tx;                                   // unit normal (left of travel)
    const hw = Math.min(halfW, radiusAt(cl, f, 1 / steps) * 0.9);   // clamp: inner edge can't reach the centre -> no fold
    left.push([px + nx * hw, py + ny * hw]);
    right.push([px - nx * hw, py - ny * hw]);
  }
  return { left, right };
}
```

- [ ] **Step 4: Run the full geom3d suite to verify all pass**

Run: `node --test tests/geom3d.test.js`
Expected: PASS — all tests, including the fixed "exactly halfW (on straights)" and the new "does not self-intersect".

- [ ] **Step 5: Run the numeric gate on the real track**

Run: `node tools/ribbon_diag.mjs`
Expected: the FOLDS section now reads `left edge: 0/320 folded` and `right edge: 0/320 folded` (was 2 and 5). The "samples where radius < half-width" line may still be non-zero — that just counts how many samples got clamped, which is fine.

- [ ] **Step 6: Commit**

```bash
git add src/geom3d.js tests/geom3d.test.js
git commit -m "fix(apexweb): geom3d ribbonEdges clamps half-width by local radius (no corner self-intersection)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `cornerMask` — which samples are corners (geom3d)

**Files:**
- Modify: `src/geom3d.js` (add after `radiusAt`)
- Modify: `tests/geom3d.test.js` (new test)

- [ ] **Step 1: Write the failing test**

Append to `tests/geom3d.test.js`:

```js
test("cornerMask: all-true on a tight circle, mixed on a square (corners vs straights)", () => {
  const R = 0.1, n = 120, p = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI; p.push(R * Math.cos(a), R * Math.sin(a)); }
  const circle = cornerMask(buildCenterline(p), n, 0.3);     // radius 0.1 < 0.3 everywhere
  assert.equal(circle.length, n);
  assert.ok(circle.every(Boolean), "a tight circle is corner everywhere");
  const square = cornerMask(buildCenterline([0, 0, 1, 0, 1, 1, 0, 1]), 200, 0.1);
  assert.ok(square.some(Boolean), "square has corner samples");
  assert.ok(!square.every(Boolean), "square has straight (non-corner) samples");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-name-pattern="cornerMask" tests/geom3d.test.js`
Expected: FAIL — `cornerMask is not a function`.

- [ ] **Step 3: Implement `cornerMask`**

In `src/geom3d.js`, insert immediately **after** `radiusAt` (before `ribbonEdges`):

```js
// Per-sample boolean around the lap: true where the centerline is cornering (radius < maxR),
// false on straights. Drives corner-only kerbs. `steps` samples evenly from frac 0.
export function cornerMask(cl, steps, maxR) {
  const m = [];
  for (let k = 0; k < steps; k++) m.push(radiusAt(cl, k / steps, 1 / steps) < maxR);
  return m;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-name-pattern="cornerMask" tests/geom3d.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full geom3d suite**

Run: `node --test tests/geom3d.test.js`
Expected: PASS — all geom3d tests.

- [ ] **Step 6: Commit**

```bash
git add src/geom3d.js tests/geom3d.test.js
git commit -m "feat(apexweb): geom3d cornerMask — mark cornering samples for corner-only kerbs" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: race3d — car lateral clamp + corner-only kerbs

**Files:**
- Modify: `src/ui/race3d.js` (import line 8; consts ~line 16; kerb block lines ~134-147; frame-loop lateral ~line 298-300)

Note: `race3d.js` is NOT imported by any test (it needs WebGL). Verification here is `node --check` (syntax) + the owner's F5 playtest. Write the code exactly as below.

- [ ] **Step 1: Import the new helpers**

In `src/ui/race3d.js`, line 8, add `radiusAt, cornerMask` to the geom3d import:

```js
import { buildCenterline, pointAt, tangentAt, bounds, ribbonEdges, sampleProg, racingLineOffset, offsetPoint, splinePath, radiusAt, cornerMask } from "../geom3d.js";
```

- [ ] **Step 2: Add the two tuning consts**

In `src/ui/race3d.js`, just after the line `const CLOSE_PROG = 0.012;` (~line 15), add:

```js
const CORNER_R = 0.10;             // centerline radius (normalized) below which we treat a sample as a corner (kerbs)
const CAR_HALF = 0.20;             // car half-width as a fraction of the track half-width (lateral clamp margin)
```

- [ ] **Step 3: Replace the kerb block with corner-only kerb quads**

In `src/ui/race3d.js`, replace the entire existing kerb block — from the comment `// red/white rumble kerbs along both edges ...` through the closing `}` of its `for (const edge of [left, right])` loop (currently lines ~134-147) — with:

```js
  // red/white rumble kerbs — only through corners (cornerMask), in chunky alternating blocks,
  // as thin flat quads stepping inward from each edge. Straights get no kerb.
  {
    const mask = cornerMask(cl, STEPS, CORNER_R);
    const KERB_W = 0.55 / sc, CHUNK = 4, KY = 0.02;        // 0.55 world units inward; ~4-sample colour blocks
    const inward = (p, c) => { const dx = c[0] - p[0], dy = c[1] - p[1], m = Math.hypot(dx, dy) || 1; return [p[0] + dx / m * KERB_W, p[1] + dy / m * KERB_W]; };
    const kpos = [], kcol = [];
    for (const edge of [left, right]) {
      for (let k = 0; k < STEPS; k++) {
        if (!mask[k]) continue;
        const k1 = (k + 1) % STEPS, a = edge[k], bb = edge[k1];
        const ca = pointAt(cl, k / STEPS), cb = pointAt(cl, k1 / STEPS);
        const ia = inward(a, ca), ib = inward(bb, cb);
        const col = (Math.floor(k / CHUNK) % 2) ? KERB_RED : KERB_WHITE;
        for (const pt of [a, bb, ib, a, ib, ia]) { kpos.push(wx(pt), KY, wz(pt)); kcol.push(col[0], col[1], col[2]); }
      }
    }
    const kerbGeo = new THREE.BufferGeometry(); geos.push(kerbGeo);
    kerbGeo.setAttribute("position", new THREE.Float32BufferAttribute(kpos, 3));
    kerbGeo.setAttribute("color", new THREE.Float32BufferAttribute(kcol, 3));
    const kerbMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }); mats.push(kerbMat);
    scene.add(new THREE.Mesh(kerbGeo, kerbMat));
  }
```

- [ ] **Step 4: Clamp each car's lateral offset to the local road width**

In `src/ui/race3d.js`, in the frame loop, find:

```js
      const tlat = racingLineOffset(cl, prog, LANE_LAT) + side;
      car.lat += (tlat - car.lat) * 0.12;                        // ease toward target (smooth)
      const p = offsetPoint(cl, prog, car.lat), t = tangentAt(cl, prog);
```

Replace those three lines with:

```js
      const tlat = racingLineOffset(cl, prog, LANE_LAT) + side;
      car.lat += (tlat - car.lat) * 0.12;                        // ease toward target (smooth)
      const hwLocal = Math.min(HW_N, radiusAt(cl, prog, 1 / STEPS) * 0.9);   // local road half-width (matches the ribbon clamp)
      const maxLat = Math.max(0, hwLocal - CAR_HALF * HW_N);     // keep the car body on the asphalt at narrowed hairpins
      car.lat = Math.max(-maxLat, Math.min(maxLat, car.lat));
      const p = offsetPoint(cl, prog, car.lat), t = tangentAt(cl, prog);
```

- [ ] **Step 5: Syntax-check the file**

Run: `node --check src/ui/race3d.js`
Expected: no output, exit 0 (syntax OK). If it errors, fix the reported line.

- [ ] **Step 6: Full suite + gate (regression check)**

Run: `node --test` then `node tools/ribbon_diag.mjs`
Expected: all tests pass; ribbon_diag still reports `0/320` folds on both edges.

- [ ] **Step 7: Commit**

```bash
git add src/ui/race3d.js
git commit -m "feat(apexweb): 3D corner-only kerbs + car lateral clamp to local road width" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Final verification + docs

**Files:**
- Modify: `README.md` (ApexWeb 3D section — note the corner-geometry fix)

- [ ] **Step 1: Run the whole suite once more**

Run (from `ApexWeb/`): `node --test`
Expected: `# pass` equals total, `# fail 0`. Record the count.

- [ ] **Step 2: Confirm the numeric gate**

Run: `node tools/ribbon_diag.mjs`
Expected: `left edge: 0/320 folded`, `right edge: 0/320 folded`.

- [ ] **Step 3: Note the fix in the README**

In `ApexWeb/README.md`, find the 3D race-view feature line/section and add a short note that corner geometry is now curvature-clamped (no self-intersection) with corner-only kerbs. Keep it one line in the existing style; do not restructure the README.

- [ ] **Step 4: Commit the README**

```bash
git add README.md
git commit -m "docs(apexweb): README — note 3D corner-geometry fix (curvature-clamped ribbon + corner kerbs)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Hand off for owner F5**

Report: tests green (count), folds 0/0, `node --check` clean. Ask the owner to F5 and look specifically at the previously-creased corners (bottom hairpin, the tight left-loop, the final chicane) and confirm kerbs appear only in corners and cars stay on the asphalt.

---

## Self-Review notes (already checked against the spec)

- **Spec Phase 1a (curvature-clamped ribbon):** Task 1 (`radiusAt`) + Task 2 (clamp). ✓
- **Spec Phase 1b (car lateral clamp):** Task 4 Step 4. ✓
- **Spec Phase 1c (corner-only kerbs):** Task 3 (`cornerMask`) + Task 4 Step 3. ✓
- **Spec verification (folds 0, tests, node --check):** Task 2 Step 5, Task 4 Step 5-6, Task 5. ✓
- **Type/name consistency:** `radiusAt(cl, frac, w)` and `cornerMask(cl, steps, maxR)` are used with the same signatures in geom3d, the tests, and race3d. `HW_N`, `STEPS`, `sc`, `wx`, `wz`, `KERB_RED`, `KERB_WHITE`, `LANE_LAT` already exist in `race3d.js init` scope (verified against the current file). ✓
- **Phases 2-4** are intentionally NOT in this plan — each ships independently and gets its own plan when reached (per the spec's phased rollout).
