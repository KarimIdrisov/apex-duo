import { test } from "node:test";
import assert from "node:assert/strict";
import { SPECIALTIES, SPECIALTY_KEYS, specialtyWeight, devCostMult, devGainMult,
  puWearMult, sponsorIncomeMult, startBudgetMult, driverDevMult, botchMult, validDirectors } from "../src/directors.js";

const coop = (a, b) => ({ teamIdx: 0, coop: true, directors: [{ player: "p1", specialty: a }, { player: "p2", specialty: b }] });
const solo = (s, asst) => ({ teamIdx: 0, coop: false, directors: [{ player: "p1", specialty: s, assistant: asst }] });

test("six specialties exist with keys", () => {
  assert.equal(SPECIALTY_KEYS.length, 6);
  for (const k of ["aero", "engine", "strategist", "mechanic", "financier", "mentor"]) assert.ok(SPECIALTIES[k], `${k} missing`);
});

test("specialtyWeight: primary = 1, solo assistant = 0.5, absent = 0", () => {
  const c = coop("aero", "engine");
  assert.equal(specialtyWeight(c, "aero"), 1);
  assert.equal(specialtyWeight(c, "mentor"), 0);
  assert.equal(specialtyWeight(solo("strategist", "mentor"), "mentor"), 0.5);
});

test("dev multipliers: an aero specialist makes aero cheaper + higher-gain; power untouched", () => {
  const c = coop("aero", "engine");
  assert.ok(devCostMult(c, "aero") < 1 && devGainMult(c, "aero") > 1);
  assert.ok(devCostMult(c, "power") < 1, "engine specialist discounts power");
  assert.equal(devCostMult(c, "tyre"), 1, "no specialist for tyre");
});

test("financier/mentor/mechanic/engine scalar helpers move the right lever", () => {
  assert.ok(sponsorIncomeMult(coop("financier", "aero")) > 1);
  assert.ok(startBudgetMult(coop("financier", "aero")) > 1);
  assert.ok(driverDevMult(coop("mentor", "aero")) > 1);
  assert.ok(botchMult(coop("mechanic", "aero")) < 1);
  assert.ok(puWearMult(coop("engine", "aero")) < 1);
  assert.equal(sponsorIncomeMult(coop("aero", "engine")), 1, "no financier → neutral");
});

test("validDirectors: co-op needs two different specialties; solo needs one valid", () => {
  assert.equal(validDirectors([{ specialty: "aero" }, { specialty: "engine" }], true), true);
  assert.equal(validDirectors([{ specialty: "aero" }, { specialty: "aero" }], true), false);
  assert.equal(validDirectors([{ specialty: "nope" }], false), false);
  assert.equal(validDirectors([{ specialty: "aero" }], false), true);
});

import { newCareer } from "../src/career.js";
import { tickDevelopment, startProject } from "../src/development.js";
import { TEAMS } from "../src/data.js";

test("financier raises the starting budget", () => {
  const plain = newCareer({ teamIdx: 0, seed: 1 });
  const fin = newCareer({ teamIdx: 0, seed: 1, directors: [{ specialty: "financier" }, { specialty: "aero" }] });
  assert.ok(fin.money > plain.money, "financier director starts richer");
});

test("an aero specialist develops aero parts faster in-season", () => {
  const mk = dirs => { const c = newCareer({ teamIdx: 0, seed: 1, directors: dirs }); startProject(c, "floor", "small"); tickDevelopment(c, 14); return c.parts[TEAMS[0].name].floor; };
  const plain = mk([]);
  const aero = mk([{ specialty: "aero" }, { specialty: "engine" }]);
  assert.ok(aero > plain, "aero specialist → bigger floor (aero) gain");
});
