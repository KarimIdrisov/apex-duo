import { test } from "node:test";
import assert from "node:assert/strict";
import { STAFF_ROLES, FACILITIES, FAC_MAX, initStaff, composePersonnel, devMult, upkeep, upgradeStaff, upgradeFacility, STAFF_UPGRADE_COST, simDriverBoost, designerFocus, DESIGNER_FOCUS, tickStaffTrain, staffGrowth, tickStaffDevelopment, STAFF_PEAK_AGE, FACTORY_DEV, facPrereqMet, staffHireFee } from "../src/staff.js";

test("§Phase-5 staff loyalty: seeded, grows while employed, raises the poach fee (not free agents)", () => {
  const g = staffGrowth(0.8, 1);
  assert.ok(g.loyalty >= 0.3 && g.loyalty <= 0.7, "seeded 0.3..0.7");
  assert.ok(staffHireFee({ rating: 0.8, team: "Ferrari", loyalty: 0.9 }) > staffHireFee({ rating: 0.8, team: "Ferrari", loyalty: 0.2 }), "a loyal rival staffer costs more to poach");
  assert.equal(staffHireFee({ rating: 0.8, team: null, loyalty: 0.9 }), staffHireFee({ rating: 0.8, team: null, loyalty: 0 }), "loyalty doesn't apply to a free agent");
  const mk = () => ({ rating: 0.7, age: 40, potential: 0.7, loyalty: 0.5 });
  const career = { staff: { designer: 0.7, strategist: 0.7, pitCrew: 0.7, people: { designer: mk(), strategist: mk(), pitCrew: mk() } } };
  tickStaffDevelopment(career);
  assert.ok(career.staff.people.designer.loyalty > 0.5, "loyalty grows each season employed");
});

test("§Phase-5 building prerequisite tree: an advanced building can't outrun its base", () => {
  assert.equal(facPrereqMet({ facilities: { design: 0 } }, "design"), true, "base buildings have no prereq");
  assert.equal(facPrereqMet({ facilities: { design: 0, tunnel: 0 } }, "tunnel"), true, "L0→L1 ok with design 0");
  assert.equal(facPrereqMet({ facilities: { design: 1, tunnel: 2 } }, "tunnel"), false, "tunnel L2→L3 needs design ≥ 2");
  assert.equal(facPrereqMet({ facilities: { design: 2, tunnel: 2 } }, "tunnel"), true, "design 2 unlocks tunnel L3");
  const c = { money: 1e6, staff: { facilities: { design: 1, pit: 1, factory: 1, sim: 1, tunnel: 3, staffctr: 1 } } };
  assert.equal(upgradeFacility(c, "tunnel"), false, "can't upgrade the tunnel past the design office");
  assert.equal(upgradeFacility(c, "design"), true, "the base design office upgrades freely");
});

test("§Phase-5 factory feeds development speed (devMult rises with the factory, bounded)", () => {
  const mk = factory => ({ designer: 0.8, facilities: { design: 3, factory }, fatigue: 0, people: {} });
  assert.ok(devMult(mk(5)) > devMult(mk(0)), "a bigger factory speeds development");
  assert.ok(devMult(mk(5)) - devMult(mk(0)) <= FACTORY_DEV + 1e-9, "bounded by FACTORY_DEV (below the design office's 0.3)");
});

test("§Phase-5 Simulator (HQ building) speeds driver development; null-safe for old saves", () => {
  assert.equal(simDriverBoost(null), 1);
  assert.equal(simDriverBoost({ facilities: {} }), 1, "old save without the sim facility = neutral ×1");
  assert.ok(simDriverBoost({ facilities: { sim: FAC_MAX } }) > simDriverBoost({ facilities: { sim: 0 } }), "more simulator = faster dev");
  assert.ok(simDriverBoost({ facilities: { sim: FAC_MAX } }) <= 1.3 + 1e-9, "bounded");
  assert.ok(FACILITIES.includes("sim"), "the Simulator is part of the facility upgrade tree");
});

test("§Phase-4 designerFocus is per-area: specialist tilts gain by area, generalist is neutral", () => {
  // a generalist designer (default specialty null) → neutral 1.0 everywhere (balance-safe, byte-identical)
  const generalist = initStaff(0.8, 1);
  assert.equal(generalist.people.designer.specialty, null);
  for (const area of ["aero", "power", "rel", "tyre", "fuel"]) assert.equal(designerFocus(generalist, area), 1);
  assert.equal(designerFocus(null, "aero"), 1, "null-safe");
  // a powertrain ("engine") designer develops the power area faster, off-areas slower
  const eng = { people: { designer: { specialty: "powertrain" } } };
  assert.ok(designerFocus(eng, "power") > 1 && designerFocus(eng, "aero") < 1, "engine designer favours power over aero");
  // an aero designer is the mirror — so engine designer ≠ wing designer
  const aero = { people: { designer: { specialty: "aero" } } };
  assert.ok(designerFocus(aero, "aero") > designerFocus(eng, "aero"), "aero designer beats engine designer on aero parts");
  assert.ok(designerFocus(eng, "power") > designerFocus(aero, "power"), "engine designer beats aero designer on power parts");
  assert.ok(SPECIALTIES.powertrain && SPECIALTIES.powertrain.role === "designer", "powertrain is a hireable designer specialty");
  assert.equal(designerFocus(eng, "power"), 1 + DESIGNER_FOCUS);
});

test("§Phase-5 R&D building tree: Wind Tunnel + Staff Centre present, seeded, add upkeep, train staff", () => {
  assert.ok(FACILITIES.includes("tunnel") && FACILITIES.includes("staffctr"), "both buildings in the tree");
  const s = initStaff(0.9, 1);
  assert.ok(s.facilities.tunnel > 0 && s.facilities.staffctr > 0, "seeded from team strength");
  const more = { facilities: { design: 1, pit: 1, factory: 1, sim: 1, tunnel: 1, staffctr: 1 } };
  const fewer = { facilities: { design: 1, pit: 1, factory: 1, sim: 1, tunnel: 0, staffctr: 0 } };
  assert.ok(upkeep(more) > upkeep(fewer), "the new buildings add upkeep");
  // the Staff Centre accelerates staff training
  const mk = ctr => ({ money: 1e6, staff: { designer: 0.7, strategist: 0.7, pitCrew: 0.7, facilities: { design: 0, pit: 0, factory: 0, sim: 0, tunnel: 0, staffctr: ctr }, people: { designer: {}, strategist: {}, pitCrew: {} } }, staffTrain: { designer: true } });
  const withCtr = mk(5), noCtr = mk(0);
  const w0 = withCtr.staff.designer, n0 = noCtr.staff.designer;
  tickStaffTrain(withCtr); tickStaffTrain(noCtr);
  assert.ok((withCtr.staff.designer - w0) > (noCtr.staff.designer - n0), "the Staff Centre speeds training");
});

test("§Phase-5 staff potential + age + off-season growth (buy-vs-grow)", () => {
  const g = staffGrowth(0.7, 12345);
  assert.deepEqual(staffGrowth(0.7, 12345), g, "deterministic");
  assert.ok(g.potential >= 0.7 && g.age >= 30, "potential is a ceiling ≥ rating; aged");
  // starting staff carry age + potential
  const s = initStaff(0.8, 1);
  for (const role of STAFF_ROLES) assert.ok(s.people[role].age > 0 && s.people[role].potential >= s.people[role].rating);
  // off-season growth: a young below-potential staffer rises toward potential and ages; a veteran does not
  const career = { staff: { designer: 0.7, strategist: 0.7, pitCrew: 0.7, people: {
    designer:   { rating: 0.7, age: 32, potential: 0.9 },   // young + headroom → grows
    strategist: { rating: 0.7, age: 32, potential: 0.7 },   // at potential → flat
    pitCrew:    { rating: 0.7, age: 52, potential: 0.95 } } } };  // past peak → no growth despite headroom
  tickStaffDevelopment(career);
  assert.ok(career.staff.designer > 0.7, "young + headroom grows");
  assert.equal(career.staff.people.designer.age, 33, "ages a year");
  assert.equal(career.staff.strategist, 0.7, "at potential → no growth");
  assert.ok(career.staff.pitCrew <= 0.7, "past peak age → no growth (plateau/decline)");
  // the hire market surfaces potential + age for the buy-vs-grow decision
  assert.ok(staffMarket(7).every(p => p.age >= 30 && p.potential >= p.rating), "market staff carry age + potential");
  assert.ok(STAFF_PEAK_AGE > 30);
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
