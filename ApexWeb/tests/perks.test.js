// ApexWeb/tests/perks.test.js — §Phase-5 mechanic perks (Chemistry-gated in-race lever).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PERKS, PERK_KEYS, availablePerks, perkUnlocked, perkEffect, chemAfterRace, CHEM_START, CHEM_PER_RACE } from "../src/perks.js";

test("availablePerks gates by chemistry; more chemistry unlocks more", () => {
  const low = availablePerks(0.4), mid = availablePerks(0.6), hi = availablePerks(1.0);
  assert.ok(low.length <= mid.length && mid.length <= hi.length, "monotone in chemistry");
  assert.equal(hi.length, PERK_KEYS.length, "top chemistry unlocks all perks");
  assert.ok(availablePerks(0.45).some(p => p.key === "cooldown"), "cooldown unlocks early");
  assert.ok(!perkUnlocked(0.5, "pushnow") && perkUnlocked(0.7, "pushnow"), "pushnow needs high chemistry");
  assert.equal(availablePerks(undefined).length, availablePerks(CHEM_START).length, "null chem defaults to the start value");
});

test("perkEffect has neutral defaults; unknown → null", () => {
  assert.equal(perkEffect("nope"), null);
  const ts = perkEffect("tyresave");
  assert.ok(ts.wearMult < 1 && ts.fuelMult === 1 && ts.paceBonus === 0 && ts.laps > 0, "tyresave only touches wear");
  const cd = perkEffect("cooldown");
  assert.ok(cd.oneShot && cd.wearMult === 1 && cd.fuelMult === 1 && cd.paceBonus === 0, "one-shot perk is neutral on the multipliers");
  for (const k of PERK_KEYS) { const e = perkEffect(k); assert.ok(e.wearMult > 0 && e.fuelMult > 0, `${k} multipliers are sane`); }
});

test("chemAfterRace grows toward 1 and caps", () => {
  assert.ok(Math.abs(chemAfterRace(0.5) - (0.5 + CHEM_PER_RACE)) < 1e-9);
  assert.equal(chemAfterRace(0.99), 1, "capped at 1");
  assert.equal(chemAfterRace(undefined), CHEM_START + CHEM_PER_RACE, "defaults to the start value");
});
