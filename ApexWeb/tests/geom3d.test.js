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
