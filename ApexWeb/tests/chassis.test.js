// ApexWeb/tests/chassis.test.js — Phase 4 chassis-design ritual + character traits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Race } from "../src/sim.js";
import { TEAMS, TRACK } from "../src/data.js";
import { driverAttrs, composeCar } from "../src/team.js";
import {
  neutralChassis, composeChassis, chassisCost, setChassisPick, traitStars,
  CATEGORIES, TIERS, TRAIT_KEYS,
} from "../src/chassis.js";
import {
  PART_CEILING, effCeiling, chassisIndicatorDeltas, applyRaceMods, maturityFactor,
} from "../src/development.js";

// --- pure ritual math ---------------------------------------------------------------------------
test("neutralChassis is all-3★, free, and applies zero effect", () => {
  const n = neutralChassis();
  for (const k of TRAIT_KEYS) assert.equal(n[k], 0.5, `${k} neutral`);
  assert.equal(n.spent, 0);
  assert.deepEqual(n.picks, {});
  // neutral → no indicator deltas, neutral heat scalar
  const d = chassisIndicatorDeltas({ chassis: n });
  assert.ok(Math.abs(d.tyre) < 1e-9 && Math.abs(d.fuel) < 1e-9, "no tyre/fuel delta");
  assert.ok(Math.abs(d.tyreHeat - 1) < 1e-9, "neutral heat scalar = 1");
});

test("composeChassis: unpicked categories are free/neutral; picks move traits + cost", () => {
  assert.equal(chassisCost({}), 0, "no picks = free");
  const oneStd = composeChassis({ engine: "standard" });
  assert.equal(oneStd.spent, TIERS.standard.cost, "only the picked category is charged");
  assert.ok(oneStd.improv > 0.5, "engine primary trait (improv) rose");
  assert.equal(oneStd.cooling, 0.5, "untouched trait stays neutral");
  const allElite = composeChassis(Object.fromEntries(CATEGORIES.map(c => [c.key, "elite"])));
  assert.equal(allElite.spent, 4 * TIERS.elite.cost);
  for (const k of TRAIT_KEYS) assert.ok(allElite[k] > 0.5, `${k} strong on all-elite`);
  const allBudget = composeChassis(Object.fromEntries(CATEGORIES.map(c => [c.key, "budget"])));
  for (const k of TRAIT_KEYS) assert.ok(allBudget[k] < 0.5, `${k} weak on all-budget`);
  assert.ok(allBudget.spent < allElite.spent, "budget chassis is cheaper");
});

test("setChassisPick charges the cost delta, refunds on downgrade, and gates on affordability", () => {
  const c = { money: 5000, chassis: neutralChassis() };
  assert.equal(setChassisPick(c, "engine", "elite"), true);
  assert.equal(c.money, 5000 - TIERS.elite.cost, "charged elite cost");
  assert.equal(c.chassis.picks.engine, "elite");
  setChassisPick(c, "engine", "budget");                     // downgrade refunds the difference
  assert.equal(c.money, 5000 - TIERS.budget.cost, "refunded down to budget cost");
  const broke = { money: 100, chassis: neutralChassis() };
  assert.equal(setChassisPick(broke, "engine", "elite"), false, "can't afford → no change");
  assert.equal(broke.money, 100);
});

test("traitStars: neutral 0.5 → 3★, monotone in the trait value", () => {
  assert.equal(traitStars(0.5), 3);
  assert.ok(traitStars(0.2) < traitStars(0.5));
  assert.ok(traitStars(0.8) > traitStars(0.5));
  assert.ok(traitStars(0) >= 0.5 && traitStars(1) <= 5, "clamped 0.5..5");
});

// --- development wiring: Improvability scales the ceiling -----------------------------------------
test("effCeiling: neutral = PART_CEILING; high Improvability raises it, low lowers it", () => {
  assert.equal(effCeiling({ chassis: neutralChassis() }), PART_CEILING);
  assert.equal(effCeiling({}), PART_CEILING, "no chassis = flat ceiling (old saves)");
  const hi = effCeiling({ chassis: { ...neutralChassis(), improv: 0.9 } });
  const lo = effCeiling({ chassis: { ...neutralChassis(), improv: 0.1 } });
  assert.ok(hi > PART_CEILING && lo < PART_CEILING, "improvability swings the ceiling");
  // a higher ceiling means a developed part keeps more development headroom (higher maturityFactor)
  assert.ok(maturityFactor(0.2, hi) > maturityFactor(0.2, lo), "more headroom at a higher ceiling");
});

// --- per-race composition: traits fold into the player car, neutral = byte-identical ----------------
test("applyRaceMods folds chassis traits onto the car; neutral chassis changes nothing", () => {
  const base = { power: 0.85, aero: 0.85, tyre: 1, fuel: 1, rel: 0.9 };
  const neutral = applyRaceMods({ ...base }, { chassis: neutralChassis() }, { pw: 0.5, df: 0.5 });
  assert.ok(Math.abs(neutral.tyre - 1) < 1e-9 && Math.abs(neutral.fuel - 1) < 1e-9, "neutral: no tyre/fuel change");
  assert.ok(Math.abs((neutral.tyreHeat ?? 1) - 1) < 1e-9, "neutral heat scalar = 1");
  const elite = composeChassis(Object.fromEntries(CATEGORIES.map(c => [c.key, "elite"])));
  const strong = applyRaceMods({ ...base }, { chassis: elite }, { pw: 0.5, df: 0.5 });
  assert.ok(strong.tyre > base.tyre, "kinder tyre-wear trait lifts the tyre indicator");
  assert.ok(strong.fuel > base.fuel, "economy trait lifts the fuel indicator");
  assert.ok(strong.tyreHeat < 1, "cooling trait → cooler heat scalar (<1)");
});

test("composeCar passes tyreHeat through (default 1)", () => {
  assert.equal(composeCar({ power: 0.9, aero: 0.9, rel: 0.9 }).tyreHeat, 1, "absent → neutral 1");
  assert.equal(composeCar({ power: 0.9, aero: 0.9, rel: 0.9, tyreHeat: 0.8 }).tyreHeat, 0.8, "passthrough");
});

// --- sim hook: a hotter chassis overheats the tyre more (deterministic, same seed) ------------------
test("sim: chassis Tyre-Heating drives the in-race tyre temperature (hot > cool)", () => {
  function tempAfter(tyreHeat) {
    let idx = 0;
    const f = TEAMS.flatMap(t => t.drivers.map(d => ({
      idx: idx++, name: d.name, abbrev: d.abbrev, skill: d.skill,
      car: t.car, color: t.color, team: t.name, setup: [0.5, 0.5, 0.5], startTyre: "soft",
      attrs: driverAttrs(d.abbrev, d.skill),
    })));
    const r = new Race(f, TRACK, 4242);
    r.cars[0].car = { ...r.cars[0].car, rel: 1, tyreHeat };   // identical car bar the chassis heat trait; rel=1 = no DNF confound
    r.setPace(0, "attack");                                    // attack drives the heat target above the window
    let g = 0; while (r.cars[0].lap < 8 && g++ < 60000) r.step();
    return r.cars[0].tyreTemp;
  }
  const hot = tempAfter(1.4), cool = tempAfter(0.6);
  assert.ok(hot > cool, `hotter chassis runs a higher tyre temp (hot ${hot.toFixed(3)} > cool ${cool.toFixed(3)})`);
});
