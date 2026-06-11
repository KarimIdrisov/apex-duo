// ApexWeb/tests/setup.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { trackIdeal, closeness, paceBonus, feedback, AXES } from "../src/setup.js";

test("ideal is deterministic from seed and in range", () => {
  const a = trackIdeal(2026), b = trackIdeal(2026);
  assert.deepEqual(a, b);
  for (const v of a) assert.ok(v >= 0 && v <= 1);
  assert.equal(a.length, 3);
});

test("closeness is 1 at the ideal, lower away from it", () => {
  const ideal = trackIdeal(10);
  assert.ok(Math.abs(closeness(ideal, ideal) - 1) < 1e-9);
  const off = ideal.map(v => (v + 0.5) % 1);
  assert.ok(closeness(off, ideal) < closeness(ideal, ideal));
});

test("paceBonus is faster (more negative) the closer you are", () => {
  assert.ok(paceBonus(1.0) < paceBonus(0.5));
  assert.ok(paceBonus(1.0) <= 0);
});

test("feedback names the worst axis", () => {
  const ideal = [0.5, 0.5, 0.5];
  const setup = [0.5, 0.0, 0.5];          // axis 1 is worst
  const fb = feedback(setup, ideal);
  assert.ok(fb.includes(AXES[1].name), fb);
});
