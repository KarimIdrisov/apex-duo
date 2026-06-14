import { test } from "node:test";
import assert from "node:assert/strict";
import { TEAMS } from "../src/data.js";
import { DRIVER_AGE, initDrivers, developDrivers, updateMorale, moraleMod, salaryFor, reSign } from "../src/drivers.js";

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

test("reSign pays a fee, extends the contract, lifts morale; refused when broke", () => {
  const career = { money: 100000, drivers: initDrivers() };
  const ok = reSign(career, "NOR");
  assert.equal(ok, true);
  assert.ok(career.drivers["NOR"].contractSeasons >= 3 && career.money < 100000);
  assert.equal(reSign({ money: 1, drivers: initDrivers() }, "NOR"), false);
});
