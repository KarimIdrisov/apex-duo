import { test } from "node:test";
import assert from "node:assert/strict";
import { initDrivers } from "../src/drivers.js";
import { JUNIOR_POOL, SUPERLICENSE, availableJuniors, signJunior, developAcademy, promoteJunior, academyDevBonus } from "../src/academy.js";

function career(teamIdx = 0) { return { teamIdx, money: 100000, drivers: initDrivers(), academy: [], driverPts: {} }; }
const gridCount = c => { const n = {}; for (const a in c.drivers) n[c.drivers[a].teamIdx] = (n[c.drivers[a].teamIdx] || 0) + 1; return n; };

test("JUNIOR_POOL abbrevs don't collide with the grid; availableJuniors excludes signed/promoted", () => {
  const c = career();
  const grid = new Set(Object.keys(c.drivers));
  for (const j of JUNIOR_POOL) assert.ok(!grid.has(j.abbrev), `${j.abbrev} collides with the grid`);
  const av0 = availableJuniors(c).length;
  signJunior(c, JUNIOR_POOL[0].abbrev);
  assert.equal(availableJuniors(c).length, av0 - 1);
});

test("signJunior spends the fee + adds to the academy; refused when broke / dup", () => {
  const c = career();
  assert.equal(signJunior(c, "VIL"), true);
  assert.ok(c.academy.some(j => j.abbrev === "VIL") && c.money < 100000);
  assert.equal(signJunior(c, "VIL"), false);                 // already in academy
  assert.equal(signJunior(career(), "NOPE"), false);
});

test("developAcademy grows juniors toward potential (and faster than a grid driver would)", () => {
  const c = career(); signJunior(c, "VIL");                  // ovr 0.71, pot 0.93
  const before = c.academy[0].overall;
  developAcademy(c);
  assert.ok(c.academy[0].overall > before + 0.02, "a high-potential teenager jumps");
  assert.equal(c.academy[0].age, JUNIOR_POOL.find(j => j.abbrev === "VIL").age + 1);
});

test("promoteJunior gates on the superlicense, injects into the grid, retires the dropped driver, keeps 2/team", () => {
  const c = career();
  signJunior(c, "VIL");                                       // 0.71 < gate -> can't promote yet
  assert.equal(promoteJunior(c, "VIL", "NOR"), false);
  signJunior(c, "HIR");                                       // 0.80 >= gate
  assert.ok(SUPERLICENSE <= 0.80);
  assert.equal(promoteJunior(c, "HIR", "NOR"), true);
  assert.equal(c.drivers["HIR"].teamIdx, 0);                 // junior now races for the player
  assert.equal(c.drivers["NOR"], undefined, "the dropped driver retired off the grid");
  assert.equal(c.driverPts["HIR"], 0, "junior is in the standings");
  assert.ok(!c.academy.some(j => j.abbrev === "HIR"));
  for (const k in gridCount(c)) assert.equal(gridCount(c)[k], 2);
});

test("academyDevBonus scales with academy size", () => {
  const c = career();
  assert.equal(academyDevBonus(c), 0);
  signJunior(c, "VIL"); signJunior(c, "HIR");
  assert.ok(academyDevBonus(c) > 0);
});
