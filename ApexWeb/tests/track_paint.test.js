import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCenterline, splinePath, bounds } from "../src/geom3d.js";
import { TRACK_SHAPES } from "../src/track_shapes.js";
import { paintTrack, DEFAULT_COLORS } from "../src/track_paint.js";

// a 2D-context stand-in that records the calls paintTrack makes (node has no canvas)
function mockCtx(w, h) {
  const c = { fill: 0, stroke: 0 };
  return { canvas: { width: w, height: h }, lineJoin: "", lineCap: "", lineWidth: 0, fillStyle: "", strokeStyle: "",
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fillRect() { c.fill++; }, stroke() { c.stroke++; }, _c: c };
}

test("paintTrack: fills grass and strokes the road layers without throwing", () => {
  const g = mockCtx(512, 512);
  const cl = buildCenterline(splinePath(TRACK_SHAPES["Монца"])), b = bounds(cl);
  const C = (p) => [(p[0] - b.minX) / b.size * 512, (p[1] - b.minY) / b.size * 512];
  paintTrack(g, cl, C, 20, 3.8);
  assert.ok(g._c.fill >= 1, "grass fillRect");
  assert.ok(g._c.stroke >= 4, "shoulder + edge + asphalt + >=1 kerb chunk");
});

test("paintTrack: DEFAULT_COLORS exported with the expected keys", () => {
  for (const k of ["grass", "shoulder", "edge", "asphalt", "kerbA", "kerbB", "start"]) assert.ok(DEFAULT_COLORS[k], k);
});
