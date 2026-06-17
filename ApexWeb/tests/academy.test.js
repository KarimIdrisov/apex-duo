import { test } from "node:test";
import assert from "node:assert/strict";
import { initDrivers } from "../src/drivers.js";
import { JUNIOR_POOL, FILLER, availableJuniors, signJunior, scoutProspect, scoutOf,
  developAcademy, promoteJunior, academyDevBonus, runFeeder, reserveBonus, eligible } from "../src/academy.js";

// v26 academy is a series-ladder pipeline: prospects are tier-gated, scouted, signed, then raced
// through F4→F3→F2 feeder seasons (earning superlicence points) and promoted once eligible (40 SL pts).
function career(over = {}) {
  return { teamIdx: 0, season: 1, seed: 1, money: 100000, drivers: initDrivers(),
    academy: [], academyTier: 0, scoutData: {}, rivalJuniors: [], driverPts: {}, _myTeamName: "McLaren", ...over };
}

test("JUNIOR_POOL abbrevs don't collide with the grid; availableJuniors gates by programme tier", () => {
  const c = career();
  const grid = new Set(Object.keys(c.drivers));
  for (const j of JUNIOR_POOL) assert.ok(!grid.has(j.abbrev), `${j.abbrev} collides with the grid`);
  const atTier0 = availableJuniors(c).length;
  const atTier5 = availableJuniors(career({ academyTier: 5 })).length;
  assert.ok(atTier0 >= 1, "some prospects need no programme tier");
  assert.ok(atTier0 < atTier5, "a better programme unlocks brighter prospects");
});

test("signJunior is tier-gated, spends the fee, and refuses dup / invalid", () => {
  const c = career();
  assert.equal(signJunior(c, "VIL"), false, "VIL is gated behind programme tier 2");
  assert.equal(signJunior(c, "AKI"), true, "a tier-0 prospect signs");
  assert.ok(c.academy.some(j => j.abbrev === "AKI") && c.money < 100000, "fee charged + added to academy");
  assert.equal(signJunior(c, "AKI"), false, "already signed");
  assert.equal(signJunior(c, "NOPE"), false, "not a real prospect");
});

test("scoutProspect spends a fee and raises scouting confidence", () => {
  const c = career();
  const before = scoutOf(c, "DOO");
  assert.equal(scoutProspect(c, "DOO"), true);
  assert.ok(scoutOf(c, "DOO") > before, "a report reveals more of the hidden ceiling");
  assert.ok(c.money < 100000, "the report costs money");
});

test("developAcademy grows a signed junior toward its potential and ages it a year", () => {
  const c = career(); signJunior(c, "AKI");
  const j0 = c.academy.find(x => x.abbrev === "AKI");
  const before = j0.overall, age0 = j0.age;
  developAcademy(c, c.seed);
  const j1 = c.academy.find(x => x.abbrev === "AKI");
  assert.ok(j1.overall > before, "a feeder season develops the junior");
  assert.equal(j1.age, age0 + 1);
});

test("promoteJunior gates on the superlicence (40 pts), injects the junior, retires the dropped driver, keeps 2/team", () => {
  const c = career();
  c.academy = [{ abbrev: "DOO", name: "Дуэн", age: 20, overall: 0.78, potTrue: 0.9, series: "F2", slHist: [20], role: null, contract: 3 }];
  assert.equal(promoteJunior(c, "DOO", "NOR"), false, "20 SL pts is below the gate");
  c.academy[0].slHist = [40];
  assert.equal(eligible(c.academy[0]), true);
  assert.equal(promoteJunior(c, "DOO", "NOR"), true);
  assert.equal(c.drivers["DOO"].teamIdx, 0, "junior now races for the player");
  assert.equal(c.drivers["NOR"], undefined, "the dropped driver left the grid");
  const counts = {}; for (const a in c.drivers) counts[c.drivers[a].teamIdx] = (counts[c.drivers[a].teamIdx] || 0) + 1;
  for (const k in counts) assert.equal(counts[k], 2, "every team still fields two cars");
});

test("reserveBonus rewards an active development role over the bench", () => {
  assert.ok(reserveBonus("reserve") > reserveBonus("fp1"));
  assert.ok(reserveBonus("fp1") > reserveBonus(null));
});

test("runFeeder races the academy juniors against series filler, deterministically", () => {
  const c = career();
  c.academy = [{ abbrev: "DOO", name: "Дуэн", series: "F2", overall: 0.80, potTrue: 0.92 }];
  const a = runFeeder(c, "F2", 1), b = runFeeder(c, "F2", 1);
  assert.deepEqual(a, b, "deterministic");
  assert.ok(a.length >= FILLER.F2.length, "the field includes the series filler");
  assert.ok(a.some(s => s.abbrev === "DOO"), "the academy junior is classified");
});

test("academyDevBonus rises with academy size and programme tier", () => {
  const c = career();
  assert.equal(academyDevBonus(c), 0);
  signJunior(c, "AKI");
  assert.ok(academyDevBonus(c) > 0, "a signed junior adds a dev bonus");
  assert.ok(academyDevBonus(career({ academyTier: 3, academy: c.academy })) > academyDevBonus(c), "a higher programme tier adds more");
});
