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

test("the cliff is an ACCELERATING fall-off; the calibrated below-cliff regime is unchanged (§item-7)", () => {
  const c = 78; // medium cliff
  const step1 = tyreTerm("medium", c + 10, 1) - tyreTerm("medium", c, 1);
  const step2 = tyreTerm("medium", c + 20, 1) - tyreTerm("medium", c + 10, 1);
  assert.ok(step2 > step1, "each lap past the cliff costs more than the last");
  // below the cliff (where calibrated stints live) the curve is byte-identical to before — deg only, no temp term at temp=1
  assert.equal(tyreTerm("medium", 40, 1), 0.040 * 40 * (1 + (40 / 78) * 0.5));
});

test("warmStep eases temp toward 1 and never exceeds it; soft warms faster", () => {
  const t1 = warmStep(0.2, "soft"), h1 = warmStep(0.2, "hard");
  assert.ok(t1 > 0.2 && t1 <= 1);
  assert.ok(t1 > h1, "soft warms faster than hard");
  assert.ok(warmStep(0.99, "soft") <= 1);
});

test("two-sided temp: overheating (temp>1) costs pace; optimal (temp=1) is penalty-free; cold unchanged (§item-2)", () => {
  const optimal = tyreTerm("medium", 10, 1);
  assert.ok(tyreTerm("medium", 10, 1.3) > optimal, "overheat is slower than the window");
  assert.ok(tyreTerm("medium", 10, 0.7) > optimal, "cold is slower than the window (unchanged)");
  // the hot penalty is exactly hotPen × (temp − 1) on top of the optimal pace
  assert.ok(Math.abs((tyreTerm("medium", 10, 1.3) - optimal) - TYRE.hotPen * 0.3) < 1e-9, "hot penalty = hotPen×(temp−1)");
});

test("warmStep is two-sided: heats toward a target>1, cools back toward it; default=1 is back-compatible (§item-2)", () => {
  assert.ok(warmStep(1.0, "soft", 1.3) > 1.0, "an aggressive target heats past the optimal window");
  const cooled = warmStep(1.4, "soft", 1.0);
  assert.ok(cooled < 1.4 && cooled > 1.0, "backing off cools an overheated tyre toward optimal (not below in one step)");
});
