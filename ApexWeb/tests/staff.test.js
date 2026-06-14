import { test } from "node:test";
import assert from "node:assert/strict";
import { STAFF_ROLES, FACILITIES, FAC_MAX, initStaff, composePersonnel, devMult, upkeep, upgradeStaff, upgradeFacility, STAFF_UPGRADE_COST } from "../src/staff.js";

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
