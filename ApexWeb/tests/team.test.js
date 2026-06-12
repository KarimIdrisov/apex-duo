import { test } from "node:test";
import assert from "node:assert/strict";
import { ATTR_KEYS, driverAttrs, genPersonnel } from "../src/team.js";

test("driverAttrs returns all 13 attrs in [0,1], deterministic, centered near overall", () => {
  const a = driverAttrs("LEC", 0.90), b = driverAttrs("LEC", 0.90);
  assert.deepEqual(a, b);                              // deterministic
  assert.equal(Object.keys(a).length, ATTR_KEYS.length);
  assert.equal(ATTR_KEYS.length, 13);
  for (const k of ATTR_KEYS) assert.ok(a[k] >= 0 && a[k] <= 1, `${k}=${a[k]}`);
  const mean = ATTR_KEYS.reduce((s, k) => s + a[k], 0) / ATTR_KEYS.length;
  assert.ok(mean > 0.78 && mean < 1.0, `mean ${mean} near overall 0.90`);
});

test("signature drivers get their trait bump (HAM/ALO wet beat a control)", () => {
  assert.ok(driverAttrs("HAM", 0.85).wet > driverAttrs("STR", 0.85).wet);
  assert.ok(driverAttrs("ALO", 0.85).race_iq > driverAttrs("STR", 0.85).race_iq);
});

test("genPersonnel scales pit speed + strategy with facility, deterministic", () => {
  const strong = genPersonnel(0.95, 1), weak = genPersonnel(0.65, 1);
  assert.ok(strong.pitMult < weak.pitMult, "better facility = faster stops (lower mult)");
  assert.ok(strong.pitMult > 0.7 && weak.pitMult < 1.3);
  assert.ok(strong.strategy > weak.strategy);
  assert.deepEqual(genPersonnel(0.8, 5), genPersonnel(0.8, 5));
});
