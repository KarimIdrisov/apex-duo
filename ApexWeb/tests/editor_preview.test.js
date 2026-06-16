import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceFrac, buildPreviewCars, fitOutline } from "../src/editor_preview.js";

test("advanceFrac: partial advance does not wrap", () => {
  const r = advanceFrac(0, 0.2, 0.5, 7);
  assert.equal(r.lap, 0);
  assert.ok(Math.abs(r.lapFrac - (0.2 + 0.5 / 7)) < 1e-9);
});

test("advanceFrac: wraps past 1.0 and bumps lap", () => {
  const r = advanceFrac(2, 0.95, 1.0, 7);   // 0.95 + 1/7 = 1.0928 -> 0.0928, lap 3
  assert.equal(r.lap, 3);
  assert.ok(r.lapFrac >= 0 && r.lapFrac < 1);
  assert.ok(Math.abs(r.lapFrac - (0.95 + 1 / 7 - 1)) < 1e-9);
});

test("advanceFrac: a large dt wraps multiple laps", () => {
  const r = advanceFrac(0, 0.0, 14, 7);   // 14/7 = 2 laps exactly
  assert.equal(r.lap, 2);
  assert.ok(Math.abs(r.lapFrac) < 1e-9);
});

test("buildPreviewCars: spreads lapFrac=i/n, cycles colours, sets flags", () => {
  const cars = buildPreviewCars(4, ["#a", "#b"]);
  assert.equal(cars.length, 4);
  assert.deepEqual(cars.map((c) => c.lapFrac), [0, 0.25, 0.5, 0.75]);
  assert.deepEqual(cars.map((c) => c.color), ["#a", "#b", "#a", "#b"]);
  assert.deepEqual(cars.map((c) => c.idx), [0, 1, 2, 3]);
  assert.ok(cars.every((c) => c.lap === 0 && !c.retired && !c.inPit && !c.player));
});

test("fitOutline: points land inside the padded box, aspect preserved, centered", () => {
  const sq = [0, 0, 1, 0, 1, 1, 0, 1];               // unit square
  const pts = fitOutline(sq, 200, 100, 10);
  assert.equal(pts.length, 4);
  for (const [x, y] of pts) {
    assert.ok(x >= 10 - 1e-9 && x <= 190 + 1e-9, `x in range: ${x}`);
    assert.ok(y >= 10 - 1e-9 && y <= 90 + 1e-9, `y in range: ${y}`);
  }
  // scale = min((200-20)/1,(100-20)/1)=80; centered horizontally -> x from 60 to 140
  assert.ok(Math.abs(pts[0][0] - 60) < 1e-9 && Math.abs(pts[1][0] - 140) < 1e-9);
});

test("fitOutline: missing / too-short outline -> []", () => {
  assert.deepEqual(fitOutline([0, 0, 1, 1], 100, 100, 5), []);   // 2 points < 3
  assert.deepEqual(fitOutline(null, 100, 100, 5), []);
});
