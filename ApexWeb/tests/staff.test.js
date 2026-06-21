import { test } from "node:test";
import assert from "node:assert/strict";
import { STAFF_ROLES, FACILITIES, FAC_MAX, initStaff, composePersonnel, devMult, upkeep, upgradeStaff, upgradeFacility, STAFF_UPGRADE_COST, simDriverBoost } from "../src/staff.js";

test("§Phase-5 Simulator (HQ building) speeds driver development; null-safe for old saves", () => {
  assert.equal(simDriverBoost(null), 1);
  assert.equal(simDriverBoost({ facilities: {} }), 1, "old save without the sim facility = neutral ×1");
  assert.ok(simDriverBoost({ facilities: { sim: FAC_MAX } }) > simDriverBoost({ facilities: { sim: 0 } }), "more simulator = faster dev");
  assert.ok(simDriverBoost({ facilities: { sim: FAC_MAX } }) <= 1.3 + 1e-9, "bounded");
  assert.ok(FACILITIES.includes("sim"), "the Simulator is part of the facility upgrade tree");
});

test("initStaff seeds ratings + facility levels from the team facility strength", () => {
  const strong = initStaff(0.95, 1), weak = initStaff(0.68, 1);
  for (const r of STAFF_ROLES) assert.ok(strong[r] > weak[r], `${r} stronger for a top team`);
  for (const f of FACILITIES) assert.ok(strong.facilities[f] >= weak.facilities[f]);
  assert.deepEqual(initStaff(0.8, 5), initStaff(0.8, 5));     // deterministic
});

test("composePersonnel: better pit crew -> faster stops (lower pitMult); strategist -> strategy", () => {
  const good = composePersonnel(initStaff(0.95, 1)), poor = composePersonnel(initStaff(0.68, 1));
  assert.ok(good.pitMult < poor.pitMult);
  assert.ok(good.strategy > poor.strategy);
  assert.ok(good.pitMult > 0.7 && poor.pitMult < 1.2);       // same range as genPersonnel (balance-safe)
  assert.deepEqual(composePersonnel(null), { pitMult: 1.0, strategy: 0.75 });
});

test("devMult: a neutral office is ~1.0, a maxed one is well above 1", () => {
  const neutral = devMult({ designer: 0.6, facilities: { design: 0, pit: 0, factory: 0 } });
  assert.ok(Math.abs(neutral - 1.0) < 1e-9);
  const maxed = devMult({ designer: 0.99, facilities: { design: FAC_MAX, pit: 0, factory: 0 } });
  assert.ok(maxed > 1.2);
  assert.equal(devMult(null), 1.0);
});

test("upkeep rises with facility levels", () => {
  assert.ok(upkeep(initStaff(0.95, 1)) > upkeep(initStaff(0.68, 1)));
});

test("upgradeStaff / upgradeFacility spend money and improve; refused when broke / maxed", () => {
  const c = { money: 100000, staff: initStaff(0.75, 1) };
  const before = c.staff.designer;
  assert.equal(upgradeStaff(c, "designer"), true);
  assert.ok(c.staff.designer > before && c.money < 100000);
  assert.equal(upgradeStaff({ money: 1, staff: initStaff(0.75, 1) }, "designer"), false);
  const lvl = c.staff.facilities.design;
  assert.equal(upgradeFacility(c, "design"), true);
  assert.equal(c.staff.facilities.design, lvl + 1);
});

// --- D6: named staff market + specialties ---
import { STAFF_MARKET_POOL, staffMarket, hireStaff, staffSalaries, SPECIALTIES, salaryForStaff } from "../src/staff.js";

test("D6: staffMarket lists hireable specialists for every role, deterministic, priced", () => {
  const m1 = staffMarket(1), m2 = staffMarket(1);
  assert.deepEqual(m1, m2);                                       // deterministic
  assert.notDeepEqual(staffMarket(1), staffMarket(2));           // refreshes by seed
  for (const role of STAFF_ROLES) assert.ok(m1.some(p => p.role === role), `market has a ${role}`);
  assert.ok(m1.every(p => p.rating > 0 && p.rating <= 0.99 && p.salary > 0 && SPECIALTIES[p.specialty]));
  assert.ok(STAFF_MARKET_POOL.length >= 9);
});

test("D6: hireStaff sets the role to the specialist's rating, pays the fee, records the person; refused when broke", () => {
  const c = { money: 1e6, staff: initStaff(0.6, 1) };
  const person = staffMarket(1).find(p => p.role === "designer" && p.rating > c.staff.designer);
  const before = c.money;
  assert.equal(hireStaff(c, person), true);
  assert.equal(c.staff.designer, person.rating);                 // the rating jump is the mechanical effect
  assert.equal(c.staff.people.designer.name, person.name);
  assert.equal(c.staff.people.designer.specialty, person.specialty);
  assert.ok(c.money < before);
  assert.equal(hireStaff({ money: 1, staff: initStaff(0.6, 1) }, person), false);   // broke
});

test("D6: staffSalaries sums the hired wages (readout); initStaff seeds cheap default staff", () => {
  const s = initStaff(0.75, 1);
  assert.ok(s.people && s.people.designer);
  assert.ok(staffSalaries(s) > 0 && staffSalaries(s) < 400);
  assert.ok(salaryForStaff(0.95) > salaryForStaff(0.70));
});
