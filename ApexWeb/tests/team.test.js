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

// --- D5: per-attribute development + traits ---
import { overallFromAttrs, attrDrift, TRAITS, traitBias, ATTR_PEAK, assignTraits } from "../src/team.js";

test("overallFromAttrs: readout rises with the headline attrs, stays in 0..1", () => {
  const lo = {}, hi = {}; for (const k of ATTR_KEYS) { lo[k] = 0.6; hi[k] = 0.9; }
  assert.ok(overallFromAttrs(hi) > overallFromAttrs(lo));
  assert.ok(overallFromAttrs(hi) > 0 && overallFromAttrs(hi) <= 1);
  assert.ok(Math.abs(overallFromAttrs(lo) - 0.6) < 0.001);   // flat profile -> reads ~its level
});

test("attrDrift: physical attrs decline for a veteran while craft holds; bounded", () => {
  const vetPace = attrDrift("pace", 40), vetIQ = attrDrift("race_iq", 40);
  assert.ok(vetPace < 0 && vetIQ < 0 && vetPace < vetIQ);     // pace falls faster than craft
  assert.ok(attrDrift("pace", 19) > 0);                       // a teenager still improves
  for (const k of ATTR_KEYS) for (const age of [18, 25, 33, 44])
    assert.ok(Math.abs(attrDrift(k, age)) <= 0.025);          // bounded per season
  assert.ok(ATTR_PEAK.pace < ATTR_PEAK.race_iq);             // physical peaks before craft
});

test("traitBias: a trait nudges its own attrs and nothing else; assignTraits is deterministic", () => {
  assert.ok(traitBias(["wet_master"], "wet") > 0);
  assert.equal(traitBias(["wet_master"], "starts"), 0);
  assert.equal(traitBias([], "wet"), 0);
  assert.ok(TRAITS.wet_master && TRAITS.wet_master.label);    // every trait has a RU label
  assert.deepEqual(assignTraits("VER"), ["overtaker"]);
  assert.deepEqual(assignTraits("STR"), []);
});
