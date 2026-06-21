import { test } from "node:test";
import assert from "node:assert/strict";
import { TEAMS } from "../src/data.js";
import { DRIVER_AGE, initDrivers, developDrivers, updateMorale, moraleMod, salaryFor, reSign, tickDriverRace } from "../src/drivers.js";

test("initDrivers builds a record per grid driver with age/overall/morale/contract/salary", () => {
  const d = initDrivers();
  assert.equal(Object.keys(d).length, TEAMS.flatMap(t => t.drivers).length);
  const nor = d["NOR"];
  assert.equal(nor.age, DRIVER_AGE["NOR"]);
  assert.ok(nor.overall > 0.9 && nor.morale === 0.6 && nor.salary > 0 && nor.contractSeasons >= 1);
  assert.equal(nor.teamIdx, 0);
});

test("salaryFor rises steeply with overall (a star costs far more than a rookie)", () => {
  assert.ok(salaryFor(0.95) > salaryFor(0.80) * 2);
  assert.ok(salaryFor(0.72) > 0);
});

test("developDrivers ages everyone; the young improve, veterans decline, contracts tick", () => {
  const d = initDrivers();
  const youngBefore = d["ANT"].overall, vetBefore = d["ALO"].overall, cBefore = d["NOR"].contractSeasons;
  developDrivers(d);
  assert.equal(d["ANT"].age, DRIVER_AGE["ANT"] + 1);
  assert.ok(d["ANT"].overall > youngBefore, "a teenager develops");
  assert.ok(d["ALO"].overall < vetBefore, "a 44-year-old declines");
  assert.equal(d["NOR"].contractSeasons, cBefore - 1);
});

test("morale: beating the expected position lifts it, missing drops it; mod is centered on 0.6", () => {
  const dr = { morale: 0.6 };
  updateMorale(dr, 2, 5); assert.ok(dr.morale > 0.6);
  const dr2 = { morale: 0.6 };
  updateMorale(dr2, 12, 5); assert.ok(dr2.morale < 0.6);
  assert.equal(moraleMod(0.6), 0);                 // start morale = neutral pace
  assert.ok(moraleMod(1.0) > 0 && moraleMod(0.2) < 0);
});

// --- D2 real driver skills ---
import { RESULTS_2024, realOverall } from "../src/drivers.js";

test("D2: realOverall calibrates to 2024 results; rookies keep the estimate; blend dampens car-conflation", () => {
  assert.ok(RESULTS_2024.VER > RESULTS_2024.ALB);
  assert.ok(realOverall("VER", 0.944) >= 0.94, "champion calibrates high");
  assert.equal(realOverall("ANT", 0.934), 0.934, "a rookie (no 2024 points) keeps the estimate");
  // Albon: a respected driver in a weak car — the blend keeps him above his raw-points value
  assert.ok(realOverall("ALB", 0.852) > 0.74 + 0.21 * Math.sqrt(12 / 437), "blend > pure points");
  const d = initDrivers();
  assert.ok(d["VER"].overall >= 0.94 && d["ANT"].overall === 0.934);
});

test("reSign pays a fee, extends the contract, lifts morale; refused when broke", () => {
  const career = { money: 100000, drivers: initDrivers() };
  const ok = reSign(career, "NOR");
  assert.equal(ok, true);
  assert.ok(career.drivers["NOR"].contractSeasons >= 3 && career.money < 100000);
  assert.equal(reSign({ money: 1, drivers: initDrivers() }, "NOR"), false);
});

// --- D5 driver depth: persistent per-attribute model ---
import { ATTR_KEYS } from "../src/team.js";

test("D5: initDrivers gives each driver a persistent 13-attr vector + traits; overall stays calibrated", () => {
  const d = initDrivers();
  for (const a in d) { assert.equal(Object.keys(d[a].attrs).length, ATTR_KEYS.length); assert.ok(Array.isArray(d[a].traits)); }
  assert.ok(d.VER.traits.includes("overtaker"));
  assert.equal(d.ANT.overall, 0.934);             // D2 calibration preserved (no readout jump at init)
});

test("D5: developDrivers ages attributes independently — a veteran loses pace faster than craft", () => {
  const d = initDrivers(); const vet = "ALO";
  const pace0 = d[vet].attrs.pace, iq0 = d[vet].attrs.race_iq, o0 = d[vet].overall;
  developDrivers(d);
  assert.ok(d[vet].attrs.pace < pace0);
  assert.ok((pace0 - d[vet].attrs.pace) > (iq0 - d[vet].attrs.race_iq));   // pace fades faster than craft
  assert.ok(d[vet].overall < o0);                                          // overall declines with the trend
});

test("D5: a young driver's attributes and overall both rise over a season", () => {
  const d = initDrivers(); const o0 = d.ANT.overall, pace0 = d.ANT.attrs.pace;
  developDrivers(d);
  assert.ok(d.ANT.overall > o0 && d.ANT.attrs.pace > pace0);
});

// --- mentor co-director: driverDevMult speeds in-season development (tickDriverRace devMult) ---
test("mentor: tickDriverRace devMult scales in-season development of the focused attrs", () => {
  const mk = () => { const dr = initDrivers().NOR; dr.training = "quali"; dr.attrs.quali = 0.5; dr.attrs.pace = 0.5; return dr; };
  const base = mk(), mentored = mk();
  const info = { finishPos: 2, expectedPos: 2, retired: false, points: 18, isPole: false, beatTeammate: null };
  tickDriverRace(base, info, 1);            // no mentor (neutral)
  tickDriverRace(mentored, info, 2);        // a strong mentor (devMult 2)
  assert.ok(mentored.attrs.quali > base.attrs.quali, "a mentor develops the focused attr faster");
  assert.ok(base.attrs.quali > 0.5, "even without a mentor, in-season training still nudges the focus");
  assert.equal(tickDriverRace(initDrivers().NOR, info), undefined, "default devMult (omitted) does not throw");
});
