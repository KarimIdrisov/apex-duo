import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCenterline, pointAt, tangentAt, bounds, cameraFromBounds, ribbonEdges, sampleProg, racingLineOffset, offsetPoint, splinePath, radiusAt, cornerMask, cornerRuns, elevation, buildSpeedWarp, sampleWarp, nearestFrac, sectorCornerClasses } from "../src/geom3d.js";

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

test("sampleProg: interpolate, clamp-before-first, clamp extrapolation", () => {
  const buf = [{ prog: 1, t: 0 }, { prog: 2, t: 100 }];
  assert.ok(Math.abs(sampleProg(buf, 50) - 1.5) < 1e-9);     // halfway between samples
  assert.equal(sampleProg(buf, -10), 1);                      // before first sample -> first prog
  assert.equal(sampleProg([], 0), 0);                         // empty buffer -> 0
  const far = sampleProg(buf, 100 + 9999);                    // far future -> extrapolation capped at 140 ms
  assert.ok(far <= 2 + (1 / 100) * 140 + 1e-9);
});

test("racingLineOffset hugs the inside of a corner; offsetPoint moves perpendicular", () => {
  const cx = 2, cy = 2, R = 1, n = 64, p = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI; p.push(cx + R * Math.cos(a), cy + R * Math.sin(a)); }
  const cl = buildCenterline(p);                       // CCW circle: inside = toward the centre everywhere
  for (const f of [0.1, 0.4, 0.75]) {
    const lat = racingLineOffset(cl, f, 0.3);
    const on = pointAt(cl, f), off = offsetPoint(cl, f, lat);
    const dOn = Math.hypot(on[0] - cx, on[1] - cy), dOff = Math.hypot(off[0] - cx, off[1] - cy);
    assert.ok(dOff < dOn, `racing line should move toward the inside (centre): ${dOff} !< ${dOn}`);
    assert.ok(Math.abs(Math.hypot(off[0] - on[0], off[1] - on[1]) - Math.abs(lat)) < 1e-6, "perpendicular move == |lat|");
  }
});

test("racingLineOffset ~0 on a straight", () => {
  const cl = buildCenterline([0, 0, 1, 0, 1, 1, 0, 1]);   // square: frac 0.125 = mid a straight edge
  assert.ok(Math.abs(racingLineOffset(cl, 0.125, 1, 8)) < 1e-6);
});

test("splinePath: denser smooth loop through the originals, far gentler corners than the raw polygon", () => {
  const sq = [0, 0, 1, 0, 1, 1, 0, 1], sub = 8;
  const sp = splinePath(sq, sub);
  assert.equal(sp.length, 4 * sub * 2);                       // n*sub points (flat x,y)
  for (let i = 0; i < 4; i++) {                                // still passes through each original corner
    assert.ok(Math.abs(sp[i * sub * 2] - sq[i * 2]) < 1e-9 && Math.abs(sp[i * sub * 2 + 1] - sq[i * 2 + 1]) < 1e-9);
  }
  const cl = buildCenterline(sp);                             // max heading change between consecutive segments
  let maxTurn = 0;
  for (let k = 0; k < cl.seg.length; k++) {
    const a = cl.seg[k], b = cl.seg[(k + 1) % cl.seg.length];
    const a1 = Math.atan2(a.b[1] - a.a[1], a.b[0] - a.a[0]), a2 = Math.atan2(b.b[1] - b.a[1], b.b[0] - b.a[0]);
    let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d;
    maxTurn = Math.max(maxTurn, d);
  }
  assert.ok(maxTurn < 1.0, `smoothed max per-segment turn ${maxTurn} rad should be well under the raw 90° (1.57)`);
});

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

test("cornerRuns: one full run on a tight circle, two runs on an ellipse (the ends)", () => {
  const R = 0.1, n = 120, cp = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI; cp.push(R * Math.cos(a), R * Math.sin(a)); }
  const circ = cornerRuns(buildCenterline(cp), 200, 0.3);     // radius 0.1 < 0.3 everywhere -> all corner
  assert.equal(circ.length, 1);
  assert.equal(circ[0].len, 200, "the whole lap is one continuous corner run");

  const ep = [];                                              // elongated ellipse: tight ends (~0.16), gentle sides (~2.5)
  for (let i = 0; i < 160; i++) { const a = (i / 160) * 2 * Math.PI; ep.push(Math.cos(a), 0.4 * Math.sin(a)); }
  const runs = cornerRuns(buildCenterline(ep), 200, 0.5);     // maxR between end- and side-radius -> ends are corners
  assert.equal(runs.length, 2, "two corner runs = the two ellipse ends, split by the straight sides");
  for (const r of runs) assert.ok(r.len >= 5 && r.len < 200, "each run is a bounded span, not the whole lap");
});

test("elevation: periodic [0,1], loop-continuous, deterministic from seed", () => {
  assert.ok(Math.abs(elevation(0) - elevation(1)) < 1e-9, "no step at start/finish (loop-continuous)");
  for (const f of [0, 0.13, 0.5, 0.77, 0.99]) { const v = elevation(f); assert.ok(v >= 0 && v <= 1, `in [0,1]: ${v}`); }
  assert.equal(elevation(0.37, 7), elevation(0.37, 7), "deterministic for a given seed");
  assert.notEqual(elevation(0.37, 1), elevation(0.37, 2), "different seeds -> different profile");
});

// --- speed warp: corner-aware visual reparameterization of the lap (render-only, lap-time-preserving) ---
const ringPath = (rx, ry, n) => { const a = []; for (let i = 0; i < n; i++) { const t = (i / n) * 2 * Math.PI; a.push(0.5 + rx * Math.cos(t), 0.5 + ry * Math.sin(t)); } return a; };

test("buildSpeedWarp: length steps+1, endpoints 0..1, monotonic, all in [0,1]", () => {
  const cl = buildCenterline(splinePath(ringPath(0.34, 0.22, 16)));
  const w = buildSpeedWarp(cl, { steps: 200 });
  assert.equal(w.length, 201);
  assert.ok(Math.abs(w[0]) < 1e-9, "starts at 0");
  assert.ok(Math.abs(w[200] - 1) < 1e-9, "ends at 1");
  for (let k = 1; k < w.length; k++) assert.ok(w[k] >= w[k - 1] - 1e-9, `monotonic at ${k}`);
  for (const v of w) assert.ok(v >= -1e-9 && v <= 1 + 1e-9, "in [0,1]");
});

test("buildSpeedWarp: a circle (uniform curvature) stays ~identity (constant speed)", () => {
  const cl = buildCenterline(splinePath(ringPath(0.3, 0.3, 24)));
  const w = buildSpeedWarp(cl, { steps: 200 });
  let maxDev = 0; for (let k = 0; k <= 200; k++) maxDev = Math.max(maxDev, Math.abs(w[k] - k / 200));
  assert.ok(maxDev < 0.03, `circle warp near identity, maxDev ${maxDev}`);
});

test("buildSpeedWarp: an elongated oval departs from identity (tight ends run slower)", () => {
  const cl = buildCenterline(splinePath(ringPath(0.40, 0.14, 16)));
  const w = buildSpeedWarp(cl, { steps: 200 });
  let maxDev = 0; for (let k = 0; k <= 200; k++) maxDev = Math.max(maxDev, Math.abs(w[k] - k / 200));
  assert.ok(maxDev > 0.01, `oval warp departs from identity, maxDev ${maxDev}`);
});

test("sampleWarp: endpoints, lerp between entries, wraps integer laps", () => {
  const t = Float64Array.from([0, 0.25, 0.5, 0.75, 1]);   // 4-step identity table
  assert.ok(Math.abs(sampleWarp(t, 0)) < 1e-9);
  assert.ok(Math.abs(sampleWarp(t, 0.5) - 0.5) < 1e-9);
  assert.ok(Math.abs(sampleWarp(t, 0.375) - 0.375) < 1e-9, "lerps mid-bucket");
  assert.ok(Math.abs(sampleWarp(t, 1)) < 1e-9, "frac 1 wraps to 0 (== same start/finish point)");
  assert.ok(Math.abs(sampleWarp(t, 2.5) - 0.5) < 1e-9, "lap+fraction uses the fractional part");
});

// --- nearestFrac + sectorCornerClasses (editor authoring helpers) ---
const ring = (rx, ry, n) => { const a = []; for (let i = 0; i < n; i++) { const t = (i / n) * 2 * Math.PI; a.push(0.5 + rx * Math.cos(t), 0.5 + ry * Math.sin(t)); } return a; };

test("nearestFrac: a point ON the centerline returns ~its own fraction", () => {
  const cl = buildCenterline(splinePath(ring(0.35, 0.35, 24)));
  for (const f of [0.0, 0.25, 0.5, 0.8]) {
    const p = pointAt(cl, f);
    const got = nearestFrac(cl, p, 720);
    const d = Math.min(Math.abs(got - f), 1 - Math.abs(got - f));   // circular distance
    assert.ok(d < 0.01, `frac ${f} -> ${got} (circ dist ${d})`);
  }
});

test("nearestFrac: an off-line point maps to the nearest centerline fraction", () => {
  const cl = buildCenterline(splinePath(ring(0.35, 0.35, 24)));
  const near = pointAt(cl, 0.3);
  const p = [near[0] * 1.5 + 0.5 * (1 - 1.5), near[1] * 1.5 + 0.5 * (1 - 1.5)];   // push radially outward from center 0.5,0.5
  const got = nearestFrac(cl, p, 720);
  const d = Math.min(Math.abs(got - 0.3), 1 - Math.abs(got - 0.3));
  assert.ok(d < 0.03, `off-line near frac 0.3 -> ${got}`);
});

test("sectorCornerClasses: returns n classes from the allowed set", () => {
  const cl = buildCenterline(splinePath(ring(0.3, 0.3, 24)));
  const cls = sectorCornerClasses(cl, 18);
  assert.equal(cls.length, 18);
  for (const c of cls) assert.ok(["straight", "high", "med", "low"].includes(c), `valid class: ${c}`);
});

test("sectorCornerClasses: a big gentle circle is all 'straight', a tight circle all 'low'", () => {
  const big = sectorCornerClasses(buildCenterline(splinePath(ring(0.46, 0.46, 28))), 18);
  assert.ok(big.every(c => c === "straight"), `big circle all straight: ${big.join(",")}`);
  const tight = sectorCornerClasses(buildCenterline(splinePath(ring(0.05, 0.05, 28))), 18);
  assert.ok(tight.every(c => c === "low"), `tight circle all low: ${tight.join(",")}`);
});

test("sectorCornerClasses: an elongated oval has tight ends ('low') and gentle sides", () => {
  const cls = sectorCornerClasses(buildCenterline(splinePath(ring(0.42, 0.10, 20))), 18);
  assert.ok(cls.includes("low"), `tight ends -> some 'low': ${cls.join(",")}`);
  assert.ok(cls.some(c => c === "straight" || c === "high"), `gentle sides -> some straight/high: ${cls.join(",")}`);
});
