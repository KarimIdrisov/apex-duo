import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCenterline, pointAt, tangentAt, bounds, cameraFromBounds, ribbonEdges, sampleProg, racingLineOffset, offsetPoint } from "../src/geom3d.js";

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
