# ApexWeb 3D Race View (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 3D orbital race view to ApexWeb that drops into the right-side panel in place of the SVG minimap, rendering the live sim in Three.js without touching the sim, determinism, or netcode.

**Architecture:** A new pure-geometry module (`src/geom3d.js`, unit-tested) samples the existing normalized `TRACK_PATH` into a centerline, ribbon edges, and a framing camera. A new Three.js module (`src/ui/race3d.js`) builds the scene once and, each animation frame, reads the SAME `ctx._buf` / `ctx._meta` snapshot buffers that `race.js` already maintains, positioning 22 cars along the centerline. `race.js` gains a 2D/3D toggle + WebGL detection and keeps the SVG map as a fallback. The 3D layer is render-only — it never writes to the sim.

**Tech Stack:** Vanilla ESM JS, Three.js via ESM-CDN (`https://esm.sh/three@0.160.0`), Node's built-in test runner (`node --test`).

**Conventions for every commit in this plan:** run commands from the `ApexWeb/` directory; `git` from the repo root with **explicit file paths only** (never `git add -A`/`.`) — the repo holds the owner's parallel uncommitted work that must not be swept into these commits. Consider executing in an isolated git worktree.

---

## File Structure

- **Create `ApexWeb/src/geom3d.js`** — pure geometry + interpolation (no THREE, no DOM): `buildCenterline`, `pointAt`, `tangentAt`, `bounds`, `ribbonEdges`, `cameraFromBounds`, `sampleProg`. Deterministic, unit-tested.
- **Create `ApexWeb/tests/geom3d.test.js`** — unit tests for `geom3d.js`.
- **Create `ApexWeb/src/ui/race3d.js`** — Three.js scene (imports `three` from CDN, `geom3d`, `data`). Exports `init(canvas, ctx)` → `{ dispose() }`. WebGL — verified by owner playtest, not unit tests.
- **Modify `ApexWeb/src/ui/race.js`** — add a `<canvas>` sibling to the map `<svg>`, a `2D/3D` toggle button, WebGL detection, and a dynamic `import("./race3d.js")` that inits/disposes the 3D layer. The shared snapshot buffers and SVG geometry are left intact.

No `index.html` change: `race3d.js` imports Three.js by full URL, and `race.js` imports `race3d.js` **dynamically** so Node tests never touch WebGL.

---

## Task 1: geom3d centerline — `buildCenterline` / `pointAt` / `tangentAt`

**Files:**
- Create: `ApexWeb/src/geom3d.js`
- Test: `ApexWeb/tests/geom3d.test.js`

- [ ] **Step 1: Write the failing test**

Create `ApexWeb/tests/geom3d.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCenterline, pointAt, tangentAt } from "../src/geom3d.js";

const SQUARE = [0, 0, 1, 0, 1, 1, 0, 1];   // unit-square loop, perimeter 4

test("buildCenterline: points, segments, total perimeter", () => {
  const cl = buildCenterline(SQUARE);
  assert.equal(cl.pts.length, 4);
  assert.equal(cl.seg.length, 4);
  assert.ok(Math.abs(cl.total - 4) < 1e-9);
});

test("pointAt: frac 0 = first point, 0.125 = mid first edge, 1 wraps to 0", () => {
  const cl = buildCenterline(SQUARE);
  assert.deepEqual(pointAt(cl, 0), [0, 0]);
  const q = pointAt(cl, 0.125);              // 1/8 perimeter = halfway along edge 0
  assert.ok(Math.abs(q[0] - 0.5) < 1e-9 && Math.abs(q[1]) < 1e-9);
  assert.deepEqual(pointAt(cl, 1), pointAt(cl, 0));
});

test("tangentAt: unit vector", () => {
  const [ux, uy] = tangentAt(buildCenterline(SQUARE), 0.1);
  assert.ok(Math.abs(Math.hypot(ux, uy) - 1) < 1e-6);
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run (from `ApexWeb/`): `node --test tests/geom3d.test.js`
Expected: FAIL — `Cannot find module '../src/geom3d.js'`.

- [ ] **Step 3: Implement `geom3d.js` centerline functions**

Create `ApexWeb/src/geom3d.js`:

```js
// ApexWeb/src/geom3d.js — pure geometry + interpolation for the 3D race view.
// No THREE, no DOM. Centerline sampling from a normalized TRACK_PATH, ribbon edges,
// camera framing, and the snapshot interpolation. All deterministic + unit-testable.

// Centerline from a flat normalized path [x0,y0,x1,y1,...] (a closed loop).
export function buildCenterline(path) {
  const pts = [];
  for (let i = 0; i < path.length; i += 2) pts.push([path[i], path[i + 1]]);
  const seg = []; let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    seg.push({ a, b, d, acc: total }); total += d;
  }
  return { pts, seg, total };
}

// [x,y] on the centerline at fractional lap position (wraps mod 1).
export function pointAt(cl, frac) {
  let t = (((frac % 1) + 1) % 1) * cl.total;
  for (const s of cl.seg) {
    if (t <= s.d) { const r = s.d ? t / s.d : 0; return [s.a[0] + (s.b[0] - s.a[0]) * r, s.a[1] + (s.b[1] - s.a[1]) * r]; }
    t -= s.d;
  }
  return cl.pts[0].slice();
}

// Unit tangent [dx,dy] at frac (central difference).
export function tangentAt(cl, frac) {
  const e = 1 / 2048;
  const a = pointAt(cl, frac - e), b = pointAt(cl, frac + e);
  const dx = b[0] - a[0], dy = b[1] - a[1], m = Math.hypot(dx, dy) || 1;
  return [dx / m, dy / m];
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run (from `ApexWeb/`): `node --test tests/geom3d.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/geom3d.js ApexWeb/tests/geom3d.test.js
git commit -m "feat(apexweb): geom3d centerline sampler (pointAt/tangentAt)"
```

---

## Task 2: geom3d framing — `bounds` / `cameraFromBounds`

**Files:**
- Modify: `ApexWeb/src/geom3d.js`
- Test: `ApexWeb/tests/geom3d.test.js`

- [ ] **Step 1: Add the failing tests**

Append to `ApexWeb/tests/geom3d.test.js`:

```js
import { bounds, cameraFromBounds } from "../src/geom3d.js";

test("bounds: centroid + size of the unit square", () => {
  const b = bounds(buildCenterline(SQUARE));
  assert.ok(Math.abs(b.cx - 0.5) < 1e-9 && Math.abs(b.cy - 0.5) < 1e-9);
  assert.ok(Math.abs(b.size - 1) < 1e-9);
});

test("cameraFromBounds: target = centroid on ground, camera elevated, frames the track", () => {
  const b = bounds(buildCenterline(SQUARE));
  const cam = cameraFromBounds(b, { elevDeg: 45, azimDeg: 0, fill: 1.5 });
  assert.deepEqual(cam.target, [0.5, 0, 0.5]);
  assert.ok(cam.pos[1] > 0, "camera above the ground plane");
  assert.ok(cam.dist > b.size, "distance frames beyond the track");
});
```

- [ ] **Step 2: Run, verify failure**

Run (from `ApexWeb/`): `node --test tests/geom3d.test.js`
Expected: FAIL — `bounds`/`cameraFromBounds` are not exported.

- [ ] **Step 3: Implement**

Append to `ApexWeb/src/geom3d.js`:

```js
// Axis-aligned bounds + centroid of the centerline (normalized space).
export function bounds(cl) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of cl.pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, size: Math.max(maxX - minX, maxY - minY) || 1 };
}

// Orbital camera that frames the whole track. Returns world-space pos + target
// (ground plane = XZ, y up). Pure: caller scales to world units.
export function cameraFromBounds(b, { elevDeg = 42, azimDeg = -35, fill = 1.5 } = {}) {
  const target = [b.cx, 0, b.cy];
  const dist = b.size * fill;
  const el = elevDeg * Math.PI / 180, az = azimDeg * Math.PI / 180;
  const horiz = Math.cos(el) * dist;
  return { target, dist, pos: [target[0] + Math.sin(az) * horiz, dist * Math.sin(el), target[2] + Math.cos(az) * horiz] };
}
```

- [ ] **Step 4: Run, verify pass**

Run (from `ApexWeb/`): `node --test tests/geom3d.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/geom3d.js ApexWeb/tests/geom3d.test.js
git commit -m "feat(apexweb): geom3d bounds + orbital camera framing"
```

---

## Task 3: geom3d track ribbon — `ribbonEdges`

**Files:**
- Modify: `ApexWeb/src/geom3d.js`
- Test: `ApexWeb/tests/geom3d.test.js`

- [ ] **Step 1: Add the failing test**

Append to `ApexWeb/tests/geom3d.test.js`:

```js
import { ribbonEdges } from "../src/geom3d.js";

test("ribbonEdges: left/right edges are exactly halfW from the centerline", () => {
  const cl = buildCenterline(SQUARE);
  const halfW = 0.05, steps = 200;
  const { left, right } = ribbonEdges(cl, halfW, steps);
  assert.equal(left.length, steps);
  assert.equal(right.length, steps);
  for (const k of [10, 50, 130]) {
    const c = pointAt(cl, k / steps);
    assert.ok(Math.abs(Math.hypot(left[k][0] - c[0], left[k][1] - c[1]) - halfW) < 1e-6);
    assert.ok(Math.abs(Math.hypot(right[k][0] - c[0], right[k][1] - c[1]) - halfW) < 1e-6);
  }
});
```

- [ ] **Step 2: Run, verify failure**

Run (from `ApexWeb/`): `node --test tests/geom3d.test.js`
Expected: FAIL — `ribbonEdges` not exported.

- [ ] **Step 3: Implement**

Append to `ApexWeb/src/geom3d.js`:

```js
// Resample the centerline into `steps` points and offset by ±halfW along the
// local normal -> left/right edge arrays ([x,y] each). Builds the road ribbon.
export function ribbonEdges(cl, halfW, steps = 240) {
  const left = [], right = [];
  for (let k = 0; k < steps; k++) {
    const f = k / steps;
    const [px, py] = pointAt(cl, f);
    const [tx, ty] = tangentAt(cl, f);
    const nx = -ty, ny = tx;            // unit normal (left of travel)
    left.push([px + nx * halfW, py + ny * halfW]);
    right.push([px - nx * halfW, py - ny * halfW]);
  }
  return { left, right };
}
```

- [ ] **Step 4: Run, verify pass**

Run (from `ApexWeb/`): `node --test tests/geom3d.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/geom3d.js ApexWeb/tests/geom3d.test.js
git commit -m "feat(apexweb): geom3d track-ribbon edge builder"
```

---

## Task 4: geom3d interpolation — `sampleProg`

This mirrors `race.js`'s `sampleBuf` (render ~120 ms behind the newest snapshot, clamp extrapolation to 140 ms) so the 3D cars move with the same smoothing as the 2D dots. Kept here as a pure, tested function the 3D layer imports.

**Files:**
- Modify: `ApexWeb/src/geom3d.js`
- Test: `ApexWeb/tests/geom3d.test.js`

- [ ] **Step 1: Add the failing test**

Append to `ApexWeb/tests/geom3d.test.js`:

```js
import { sampleProg } from "../src/geom3d.js";

test("sampleProg: interpolate, clamp-before-first, clamp extrapolation", () => {
  const buf = [{ prog: 1, t: 0 }, { prog: 2, t: 100 }];
  assert.ok(Math.abs(sampleProg(buf, 50) - 1.5) < 1e-9);     // halfway between samples
  assert.equal(sampleProg(buf, -10), 1);                      // before first sample -> first prog
  assert.equal(sampleProg([], 0), 0);                         // empty buffer -> 0
  const far = sampleProg(buf, 100 + 9999);                    // far future -> extrapolation capped at 140 ms
  assert.ok(far <= 2 + (1 / 100) * 140 + 1e-9);
});
```

- [ ] **Step 2: Run, verify failure**

Run (from `ApexWeb/`): `node --test tests/geom3d.test.js`
Expected: FAIL — `sampleProg` not exported.

- [ ] **Step 3: Implement**

Append to `ApexWeb/src/geom3d.js`:

```js
// Smooth cumulative progress (lap+lapFrac) between ~12 Hz snapshots.
// buf: array of {prog, t(ms)} oldest..newest; rt: render time (ms).
export function sampleProg(buf, rt) {
  if (!buf || !buf.length) return 0;
  if (buf.length === 1 || rt <= buf[0].t) return buf[0].prog;
  for (let i = buf.length - 1; i > 0; i--) {
    const a = buf[i - 1], b = buf[i];
    if (rt >= a.t) {
      const span = b.t - a.t || 1, v = (b.prog - a.prog) / span;
      return rt <= b.t ? a.prog + (b.prog - a.prog) * ((rt - a.t) / span)
                       : b.prog + v * Math.min(rt - b.t, 140);
    }
  }
  return buf[buf.length - 1].prog;
}
```

- [ ] **Step 4: Run the full suite, verify pass**

Run (from `ApexWeb/`): `npm test`
Expected: PASS — the whole suite green, including the new `geom3d` tests.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/geom3d.js ApexWeb/tests/geom3d.test.js
git commit -m "feat(apexweb): geom3d snapshot interpolation (sampleProg)"
```

---

## Task 5: race3d.js — scene, track ribbon, orbital camera (static)

No unit test (WebGL). Verified by owner playtest at Step 4.

**Files:**
- Create: `ApexWeb/src/ui/race3d.js`

- [ ] **Step 1: Write the module (scene + track + camera + drag, no cars yet)**

Create `ApexWeb/src/ui/race3d.js`:

```js
// ApexWeb/src/ui/race3d.js — 3D orbital race view. Pure render layer over the sim:
// reads the SAME ctx._buf / ctx._meta snapshot buffers race.js maintains. No sim/netcode
// coupling. WebGL -> owner-playtest verified. Self-disposes when its canvas leaves the DOM.
import * as THREE from "https://esm.sh/three@0.160.0";
import { TRACK_PATH } from "../data.js";
import { buildCenterline, pointAt, tangentAt, bounds, ribbonEdges, sampleProg } from "../geom3d.js";

const WORLD = 120;                 // larger track axis spans ~120 world units
const HALF_W = 2.0;                // track half-width (world units)
const CAR_L = 2.8, CAR_W = 1.2, CAR_H = 0.7;
const DELAY = 120;                 // render this many ms behind the newest snapshot
const SECTOR_COL = [0x5aa0ff, 0xffce47, 0x46d08a];
const ASPHALT = 0x2c2c33, ASPHALT_SC = 0x4a4626;
const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function init(canvas, ctx) {
  const cl = buildCenterline(TRACK_PATH);
  const b = bounds(cl);
  const sc = WORLD / b.size;                       // normalized -> world scale
  const wx = (p) => (p[0] - b.cx) * sc;            // center the track at world origin
  const wz = (p) => (p[1] - b.cy) * sc;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(0x0a0a0c, 1);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(45, 1, 0.1, WORLD * 8);

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 0.8);
  key.position.set(WORLD, WORLD * 1.4, WORLD * 0.5); scene.add(key);

  // --- track ribbon: a triangle strip between the left/right edges ---
  const STEPS = 320;
  const { left, right } = ribbonEdges(cl, HALF_W / sc, STEPS);   // edges in normalized space
  const pos = new Float32Array(STEPS * 2 * 3);
  for (let k = 0; k < STEPS; k++) {
    const l = left[k], r = right[k];
    pos[k * 6 + 0] = wx(l); pos[k * 6 + 1] = 0; pos[k * 6 + 2] = wz(l);
    pos[k * 6 + 3] = wx(r); pos[k * 6 + 4] = 0; pos[k * 6 + 5] = wz(r);
  }
  const index = [];
  for (let k = 0; k < STEPS; k++) {
    const a = k * 2, bb = k * 2 + 1, c = ((k + 1) % STEPS) * 2, d = ((k + 1) % STEPS) * 2 + 1;
    index.push(a, bb, c, bb, d, c);
  }
  const trackGeo = new THREE.BufferGeometry();
  trackGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  trackGeo.setIndex(index); trackGeo.computeVertexNormals();
  const trackMat = new THREE.MeshStandardMaterial({ color: ASPHALT, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  scene.add(new THREE.Mesh(trackGeo, trackMat));

  // sector tint lines just above the asphalt
  const lineGeos = [];
  for (let s = 0; s < 3; s++) {
    const v = [], lo = s / 3, hi = (s + 1) / 3;
    for (let k = 0; k <= 48; k++) { const p = pointAt(cl, lo + (hi - lo) * (k / 48)); v.push(new THREE.Vector3(wx(p), 0.05, wz(p))); }
    const lg = new THREE.BufferGeometry().setFromPoints(v); lineGeos.push(lg);
    scene.add(new THREE.Line(lg, new THREE.LineBasicMaterial({ color: SECTOR_COL[s] })));
  }
  // start/finish line across the track at frac 0
  {
    const p = pointAt(cl, 0), t = tangentAt(cl, 0), nx = -t[1], ny = t[0], hw = HALF_W / sc;
    const a = [p[0] + nx * hw, p[1] + ny * hw], c = [p[0] - nx * hw, p[1] - ny * hw];
    const sg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(wx(a), 0.06, wz(a)), new THREE.Vector3(wx(c), 0.06, wz(c))]);
    lineGeos.push(sg);
    scene.add(new THREE.Line(sg, new THREE.LineBasicMaterial({ color: 0xffffff })));
  }

  // --- orbital camera (track centered at origin) + drag-to-orbit ---
  let azim = -35 * Math.PI / 180, elev = 42 * Math.PI / 180, dist = b.size * 1.6 * sc;
  const target = new THREE.Vector3(0, 0, 0);
  function placeCam() {
    const horiz = Math.cos(elev) * dist;
    cam.position.set(target.x + Math.sin(azim) * horiz, Math.sin(elev) * dist, target.z + Math.cos(azim) * horiz);
    cam.lookAt(target);
  }
  let drag = null;
  const onDown = (e) => { drag = { x: e.clientX, y: e.clientY }; };
  const onUp = () => { drag = null; };
  const onMove = (e) => {
    if (!drag) return;
    azim -= (e.clientX - drag.x) * 0.01;
    elev = Math.min(1.45, Math.max(0.2, elev - (e.clientY - drag.y) * 0.01));
    drag = { x: e.clientX, y: e.clientY }; placeCam();
  };
  canvas.addEventListener("mousedown", onDown);
  window.addEventListener("mouseup", onUp);
  window.addEventListener("mousemove", onMove);

  function resize() {
    const w = canvas.clientWidth || 360, h = Math.max(240, Math.round(w * 0.72));
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    cam.aspect = w / h; cam.updateProjectionMatrix();
  }
  resize(); window.addEventListener("resize", resize); placeCam();

  let raf = 0, alive = true;
  function dispose() {
    if (!alive) return; alive = false;
    cancelAnimationFrame(raf);
    canvas.removeEventListener("mousedown", onDown);
    window.removeEventListener("mouseup", onUp);
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("resize", resize);
    trackGeo.dispose(); for (const g of lineGeos) g.dispose(); renderer.dispose();
  }
  function frame() {
    if (!canvas.isConnected) return dispose();   // screen changed -> self-teardown
    raf = requestAnimationFrame(frame);
    trackMat.color.set(ctx.snapshot && ctx.snapshot.scActive ? ASPHALT_SC : ASPHALT);
    renderer.render(scene, cam);
  }
  frame();

  return { dispose };
}
```

- [ ] **Step 2: Temporary manual mount for verification**

In `ApexWeb/index.html` is not needed. Instead verify via `race.js` after Task 7. To check this task in isolation now, temporarily add to the end of `race.js`'s `buildHud` (REMOVE after this step):

```js
// TEMP verify Task 5 — remove after Task 7
import("./race3d.js").then(m => { const cv = document.createElement("canvas"); cv.style.cssText = "width:100%;height:260px"; root.querySelector("#dash .panel").appendChild(cv); m.init(cv, ctx); });
```

- [ ] **Step 3: Owner playtest**

Open `ApexWeb/index.html` (or run a static server in `ApexWeb/`), start a solo race. Expected: a dark 3D canvas shows the **Barcelona circuit as a flat ribbon** with three colored sector lines and a white start/finish line; **drag rotates** the view; no console errors.

- [ ] **Step 4: Remove the TEMP block from Step 2**, confirm the race screen is back to normal.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/ui/race3d.js
git commit -m "feat(apexweb): 3D race view scene + track ribbon + orbital camera"
```

---

## Task 6: race3d.js — cars, per-frame positioning, highlights, SC, pit, self-teardown

**Files:**
- Modify: `ApexWeb/src/ui/race3d.js`

- [ ] **Step 1: Build the car meshes (after the start/finish block, before the camera section)**

Insert into `init()` in `ApexWeb/src/ui/race3d.js`, right after the start/finish line block:

```js
  // --- cars: one Group per snapshot car, colored by team ---
  const carGeo = new THREE.BoxGeometry(CAR_W, CAR_H, CAR_L);
  const cockGeo = new THREE.BoxGeometry(CAR_W * 0.6, CAR_H * 0.7, CAR_L * 0.4);
  const ringGeo = new THREE.RingGeometry(CAR_L * 0.85, CAR_L * 1.05, 24);
  const cars = {};   // idx -> { group, ring }
  for (const c of ((ctx.snapshot && ctx.snapshot.cars) || [])) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(carGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color(c.color || "#888888"), roughness: 0.5 }));
    body.position.y = CAR_H / 2; g.add(body);
    const cock = new THREE.Mesh(cockGeo, new THREE.MeshStandardMaterial({ color: 0x101014 }));
    cock.position.set(0, CAR_H * 0.95, -CAR_L * 0.05); g.add(cock);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.09; g.add(ring);
    cars[c.idx] = { group: g, ring }; scene.add(g);
  }
  // pit-lane parking spot: start/finish, offset outward by ~2.4 half-widths
  const pitN = tangentAt(cl, 0), pitP = pointAt(cl, 0);
  const PIT = [pitP[0] + (-pitN[1]) * (2.4 * HALF_W / sc), pitP[1] + pitN[0] * (2.4 * HALF_W / sc)];
```

- [ ] **Step 2: Drive the cars each frame**

In `frame()`, add the per-car update **before** `renderer.render(...)`:

```js
    const rt = nowMs() - DELAY;
    const meta = ctx._meta || {}, buf = ctx._buf || {};
    for (const id in cars) {
      const car = cars[id], m = meta[id];
      if (!m) { car.group.visible = false; continue; }
      if (m.retired) { car.group.visible = false; continue; }
      car.group.visible = true;
      if (m.inPit) {
        car.group.position.set(wx(PIT), 0, wz(PIT));
        car.ring.material.opacity = 0;
        continue;
      }
      const prog = sampleProg(buf[id], rt);
      const p = pointAt(cl, prog), t = tangentAt(cl, prog);
      car.group.position.set(wx(p), 0, wz(p));
      car.group.rotation.y = Math.atan2(t[0], t[1]);     // local +Z faces the tangent
      const hi = m.player || m.isLeader;
      car.ring.material.opacity = hi ? 1 : 0;
      car.ring.material.color.set(m.isLeader ? 0xffd000 : 0xffffff);
    }
```

- [ ] **Step 3: Dispose the new geometries**

In `dispose()`, add before `renderer.dispose()`:

```js
    carGeo.dispose(); cockGeo.dispose(); ringGeo.dispose();
```

- [ ] **Step 4: Owner playtest**

Re-add the TEMP mount from Task 5 Step 2, open `ApexWeb/index.html`, run a solo race. Expected: **22 cars** move smoothly around the 3D ribbon in team colors; **your car + the leader show a ring** (gold = leader, white = yours); cars **vanish on DNF** and **park off-track during a pit stop**; the asphalt **tints on safety car**. Then remove the TEMP block again.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/ui/race3d.js
git commit -m "feat(apexweb): 3D cars driven by sim snapshots + highlights/pit/SC"
```

---

## Task 7: race.js integration — canvas, 2D/3D toggle, WebGL fallback

**Files:**
- Modify: `ApexWeb/src/ui/race.js`

- [ ] **Step 1: Add a canvas + toggle button to the HUD template**

In `ApexWeb/src/ui/race.js`, in `buildHud`, inside the map `.panel`, add a `<canvas>` right after the closing `</svg>`:

```js
        </svg>
        <canvas id="d-3d" style="display:none;width:100%;height:300px;border-radius:8px"></canvas>
```

And in the `dash-head` controls, add a view toggle before the speed button:

```js
          <button class="btn" id="d-view">3D</button><button class="btn" id="d-speed">1x</button><button class="btn" id="d-pause">⏸</button>
```

(Replace the existing `<button class="btn" id="d-speed">1x</button><button class="btn" id="d-pause">⏸</button>` line with the line above.)

- [ ] **Step 2: Add WebGL detection + view switching in `buildHud`**

At the top of `ApexWeb/src/ui/race.js` (module scope), add:

```js
function webglOK() {
  try { const c = document.createElement("canvas"); return !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl"))); }
  catch { return false; }
}
```

Then in `buildHud`, just before `ctx._hudReady = true;`, add the wiring:

```js
  const svgEl = root.querySelector("#dash svg");
  const cv = root.querySelector("#d-3d");
  const viewBtn = root.querySelector("#d-view");
  if (ctx._view == null) ctx._view = webglOK() ? "3d" : "2d";
  function applyView() {
    const on3d = ctx._view === "3d";
    cv.style.display = on3d ? "block" : "none";
    if (svgEl) svgEl.style.display = on3d ? "none" : "block";
    viewBtn.textContent = on3d ? "3D" : "2D";
    if (on3d && !ctx._r3d) import("./race3d.js").then(m => { if (ctx._view === "3d" && !ctx._r3d) ctx._r3d = m.init(cv, ctx); });
    if (!on3d && ctx._r3d) { ctx._r3d.dispose(); ctx._r3d = null; }
  }
  viewBtn.onclick = () => { ctx._view = ctx._view === "3d" ? "2d" : "3d"; applyView(); };
  applyView();
```

- [ ] **Step 3: Skip the SVG dot loop while 3D is active (perf)**

In `startMapLoop`'s `step` function, after `ctx._mapRAF = requestAnimationFrame(step);`, add an early return when 3D is showing:

```js
    if (ctx._view === "3d") return;
```

- [ ] **Step 4: Verify the suite still passes (no Node regression from the new import)**

Run (from `ApexWeb/`): `npm test`
Expected: PASS — `race.js`'s `import("./race3d.js")` is dynamic, so `node --test` never loads Three.js; all existing tests stay green.

- [ ] **Step 5: Owner playtest**

Open `ApexWeb/index.html`, run a solo race. Expected: the race screen opens in **3D by default** (WebGL present); the **`3D`/`2D` button** in the header toggles between the 3D canvas and the old SVG map; toggling back and forth leaves no console errors and the SVG map still works; leaving the race screen (back to paddock) does not leak (the 3D layer self-disposes when its canvas leaves the DOM).

- [ ] **Step 6: Commit**

```bash
git add ApexWeb/src/ui/race.js
git commit -m "feat(apexweb): wire 3D race view into race screen with 2D fallback toggle"
```

---

## Task 8: Final acceptance playtest vs success criteria

**Files:** none (verification only).

- [ ] **Step 1: Owner playtest against the spec's v1 criteria**

Open `ApexWeb/index.html`, run a full solo race and confirm each:
1. Right panel shows a 3D canvas with the Barcelona ribbon, in the minimap's place.
2. 22 cars move smoothly from the live sim; your 2 cars highlighted, leader gold.
3. Orbital camera frames the whole track; drag-to-orbit works.
4. SC tint + pit parking work; smooth (~60 fps); a race plays start→finish with no console errors.
5. Forcing 2D (toggle, or a browser without WebGL) falls back to the SVG map with no crash.

- [ ] **Step 2: Run the suite one last time**

Run (from `ApexWeb/`): `npm test`
Expected: PASS — whole suite green.

- [ ] **Step 3: Update `ApexWeb/README.md`** — add the 3D race view (orbital camera, 2D fallback toggle) to the feature list, and note Three.js is loaded from `esm.sh`.

- [ ] **Step 4: Commit**

```bash
git add ApexWeb/README.md
git commit -m "docs(apexweb): note 3D race view in README"
```

---

## Deferred to v1.1+ (explicitly out of scope here)

Camera 1 (chase) and camera 2 (trackside cinematic + auto-director); hero-stage layout; detailed car models; kerbs-as-meshes, elevation/banking, scenery; battle-line connectors in 3D; touch drag-orbit on mobile; pinning Three.js to a local `assets/` copy. These reuse the same scene built here.
