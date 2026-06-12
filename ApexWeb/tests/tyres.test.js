import { test } from "node:test";
import assert from "node:assert/strict";
import { tyreTerm, warmStep } from "../src/tyres.js";
import { TYRE } from "../src/data.js";

test("a worn tyre is slower than a fresh one (same temp)", () => {
  assert.ok(tyreTerm("medium", 40, 1) > tyreTerm("medium", 0, 1));
});

test("a cold tyre is slower than a warm one (same wear)", () => {
  assert.ok(tyreTerm("medium", 0, TYRE.pitTemp) > tyreTerm("medium", 0, 1));
});

test("past the cliff degradation is steep", () => {
  const cliff = 78; // medium
  const before = tyreTerm("medium", cliff, 1);
  const after = tyreTerm("medium", cliff + 15, 1);
  const beforeStep = tyreTerm("medium", cliff, 1) - tyreTerm("medium", cliff - 15, 1);
  assert.ok((after - before) > beforeStep * 3, "cliff must bite");
});

test("warmStep eases temp toward 1 and never exceeds it; soft warms faster", () => {
  const t1 = warmStep(0.2, "soft"), h1 = warmStep(0.2, "hard");
  assert.ok(t1 > 0.2 && t1 <= 1);
  assert.ok(t1 > h1, "soft warms faster than hard");
  assert.ok(warmStep(0.99, "soft") <= 1);
});
