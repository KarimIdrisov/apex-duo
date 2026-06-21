import { test } from "node:test";
import assert from "node:assert/strict";
import { ATTR_KEYS, driverAttrs, genPersonnel, peakArchetype, peakOverall } from "../src/team.js";

test("§Phase-3 peak-age archetype: deterministic ±2 offset; a late peak rises past the normal peak", () => {
  assert.equal(peakArchetype("VER"), peakArchetype("VER"), "deterministic");
  assert.ok([-2, 0, 2].includes(peakArchetype("HAM")));
  const age = ATTR_PEAK.pace + 1;   // just past the normal pace peak → normal declines, a late peak still rises
  assert.ok(attrDrift("pace", age, +2) > attrDrift("pace", age, 0), "late archetype still improving past the normal peak");
});

test("§Phase-3 peakOverall: a teenager has headroom; a veteran is at/over peak", () => {
  assert.ok(peakOverall({ attrs: driverAttrs("X", 0.7), age: 19, peakAge: 0 }) > 0.7, "young → growth headroom");
  assert.ok(peakOverall({ attrs: driverAttrs("X", 0.7), age: 37, peakAge: 0 }) <= 0.7 + 1e-6, "veteran → no headroom");
});

test("driverAttrs returns all 14 attrs in [0,1], deterministic, skill attrs centered near overall", () => {
  const a = driverAttrs("LEC", 0.90), b = driverAttrs("LEC", 0.90);
  assert.deepEqual(a, b);                              // deterministic
  assert.equal(Object.keys(a).length, ATTR_KEYS.length);
  assert.equal(ATTR_KEYS.length, 14);                 // 13 skill attrs + fitness (§Phase-3)
  for (const k of ATTR_KEYS) assert.ok(a[k] >= 0 && a[k] <= 1, `${k}=${a[k]}`);
  // the 13 skill attrs cluster near `overall`; fitness is its OWN axis (~0.70, independent of overall)
  const skill = ATTR_KEYS.filter(k => k !== "fitness");
  const mean = skill.reduce((s, k) => s + a[k], 0) / skill.length;
  assert.ok(mean > 0.82 && mean < 1.0, `skill mean ${mean} near overall 0.90`);
  assert.ok(a.fitness >= 0.3 && a.fitness <= 0.99, `fitness ${a.fitness} is its own ~0.7 axis`);
  // a much weaker driver still has a comparable fitness range (decorrelated from overall)
  assert.ok(Math.abs(driverAttrs("LEC", 0.70).fitness - a.fitness) < 1e-9, "fitness ignores overall");
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
import { overallFromAttrs, attrDrift, TRAITS, traitBias, ATTR_PEAK, assignTraits, overallToStars } from "../src/team.js";

test("overallToStars: 0..5 stars in half-steps, rising with overall (§Phase-3)", () => {
  assert.equal(overallToStars(0.97), 5);
  assert.equal(overallToStars(0.50), 0);
  assert.ok(overallToStars(0.90) > overallToStars(0.75), "a stronger driver gets more stars");
  for (const o of [0.6, 0.72, 0.85, 0.95]) {
    const s = overallToStars(o);
    assert.ok(s >= 0 && s <= 5, `${o}→${s} in range`);
    assert.equal(s * 2, Math.round(s * 2), `${o}→${s} is a half-step`);
  }
});

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
