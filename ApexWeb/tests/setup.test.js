import { test } from "node:test";
import assert from "node:assert/strict";
import { AXES, trackIdeal, idealFor, axisSat, satisfaction, closeness, paceBonus } from "../src/setup.js";

test("6 setup axes, each with a name + characteristic", () => {
  assert.equal(AXES.length, 6);
  for (const a of AXES) { assert.ok(a.name && a.char, "axis has name + char"); }
});

test("trackIdeal returns 6 values in [0,1], deterministic", () => {
  const a = trackIdeal(1234), b = trackIdeal(1234);
  assert.equal(a.length, 6);
  assert.deepEqual(a, b);
  assert.ok(a.every(v => v >= 0 && v <= 1));
});

test("idealFor jitters per-driver but stays near the track ideal", () => {
  const base = trackIdeal(1234);
  const d1 = idealFor(1234, 0), d2 = idealFor(1234, 1);
  assert.notDeepEqual(d1, d2, "two drivers differ");
  for (let i = 0; i < 6; i++) assert.ok(Math.abs(d1[i] - base[i]) < 0.2, "stays near track ideal");
});

test("axisSat is 1 at the optimum and falls off with distance", () => {
  assert.ok(Math.abs(axisSat(0.5, 0.5) - 1) < 1e-9);
  assert.ok(axisSat(0.5, 0.5) > axisSat(0.65, 0.5));
  assert.ok(axisSat(0.9, 0.5) < 0.3);
});

test("satisfaction is the mean of per-axis sats (0..1)", () => {
  assert.ok(Math.abs(satisfaction([1,1,1,1,1,1]) - 1) < 1e-9);
  assert.ok(Math.abs(satisfaction([1,0,1,0,1,0]) - 0.5) < 1e-9);
});

test("closeness still works (generalised over 6 axes) and reads the setup values", () => {
  const ideal = trackIdeal(7);
  assert.ok(closeness(ideal, ideal) > 0.999, "perfect setup ~1");
  assert.ok(closeness([0,0,0,0,0,0], ideal) < closeness(ideal, ideal), "a worse setup is less close");
});

test("paceBonus is faster (more negative) the closer you are", () => {
  assert.ok(paceBonus(1) < paceBonus(0.5), "more closeness = bigger pace gain");
  assert.ok(paceBonus(0) === 0, "zero closeness = no bonus");
});
