import { test } from "node:test";
import assert from "node:assert/strict";
import { TEAMS } from "../src/data.js";
import { maxProjects, playerSlotCap, PART_CEILING, effCeiling, knownTier, knownBonus, knownStrength } from "../src/development.js";
import { PARTS, PART_CONTRIB, PROJECT_SIZE, partsToDeltas, effectiveCar, startProject, tickDevelopment,
  corrQuality, forecastRange, miscorrChance, eraEmphasis, regEra, revertPart, regressedParts,
  PU_PARTS, PU_CONTRIB, puToDeltas, startPUProject, puTokensLeft, PU_TOKEN_COST, PU_TOKENS_PER_SEASON,
  engineModeStress, puWearForRace, customerSpecDelta, supplyFeeMult, PU_SUPPLY_SPEC, applyRaceMods } from "../src/development.js";
import { initStaff } from "../src/staff.js";

function fakeCareer(over = {}) {
  return { seed: 1, teamIdx: 0, round: 0, money: 1e6, costCap: false, devSpentThisSeason: 0, parts: {}, project: null, staff: initStaff(0.6, 1), academy: [], ...over };
}

test("partsToDeltas composes part levels into indicator deltas via PART_CONTRIB", () => {
  const d = partsToDeltas({ pu: 0.1, floor: 0.1 });
  assert.ok(Math.abs(d.power - 0.045) < 1e-9, "pu 0.1 -> +0.045 power (engine; gearbox carries the rest)");
  assert.ok(d.aero > 0.05, "floor lifts aero");
  assert.deepEqual(partsToDeltas(null), { power: 0, aero: 0, tyre: 0, fuel: 0, rel: 0 });
});
test("§Phase-4 item 6: power splits engine(pu)+gearbox, conserving the old single-part total", () => {
  assert.ok(PARTS.includes("gearbox"), "gearbox is a developable part");
  assert.ok((PART_CONTRIB.gearbox.power || 0) > 0, "gearbox contributes power");
  // engine + gearbox developed together reproduce the OLD pu-only power (0.70 per unit level)
  const split = partsToDeltas({ pu: 0.2, gearbox: 0.2 });
  assert.ok(Math.abs(split.power - 0.14) < 1e-9, "0.45·0.2 + 0.25·0.2 = 0.14 = old 0.70·0.2 (conserved)");
  // developing only the engine yields less power than engine+gearbox → "engine first, gearbox second"
  assert.ok(partsToDeltas({ pu: 0.2, gearbox: 0.2 }).power > partsToDeltas({ pu: 0.2 }).power, "the gearbox adds power on top of the engine");
});

test("effectiveCar adds composed part deltas onto the base car; rel clamped", () => {
  const base = TEAMS[5].car;
  const eff = effectiveCar(base, { pu: 0.2 });
  assert.ok(eff.power > base.power && eff.rel <= 0.995);
  assert.equal(effectiveCar(base, null).power, base.power);
});

test("startProject targets a PART, spends money, blocks a second; rejects invalid part", () => {
  const c = fakeCareer();
  assert.ok(startProject(c, "floor", "medium"));
  assert.equal(c.money, 1e6 - PROJECT_SIZE.medium.cost);
  assert.equal(startProject(c, "floor", "small"), null);       // one program per part at a time
  assert.equal(startProject(fakeCareer(), "wing", "small"), null);
});

test("tickDevelopment completes a part project + develops AI parts (catch-up: backmarker > top)", () => {
  const c = fakeCareer();
  startProject(c, "pu", "small");
  tickDevelopment(c);
  assert.equal(c.projects.length, 0);   // the project completed (single → parallel projects[] model)
  assert.ok(c.parts["McLaren"].pu > 0);
  assert.ok(c.parts[TEAMS[10].name].pu > c.parts[TEAMS[1].name].pu, "weaker team develops faster");
});

test("devMult + academy scale the part gain; deterministic", () => {
  const weak = (() => { const c = fakeCareer({ staff: initStaff(0.6, 1) }); startProject(c, "pu", "small"); tickDevelopment(c); return c.parts["McLaren"].pu; })();
  const strong = (() => { const c = fakeCareer({ staff: { ...initStaff(0.99, 1), facilities: { design: 5, pit: 5, factory: 5 } }, academy: [{ abbrev: "X" }] }); startProject(c, "pu", "small"); tickDevelopment(c); return c.parts["McLaren"].pu; })();
  assert.ok(strong > weak, "better design office + academy develops more");
});

// --- P1: forecast fog + correlation quality ---
test("corrQuality rises with design office + chief designer; bounded 0..1", () => {
  const weak = corrQuality(fakeCareer({ staff: { designer: 0.6, facilities: { design: 0 } } }), "floor");
  const top = corrQuality(fakeCareer({ staff: { designer: 0.95, facilities: { design: 5 } } }), "floor");
  assert.ok(weak < top, "better infra → better correlation");
  assert.ok(weak >= 0 && top <= 1, "bounded");
  assert.ok(miscorrChance(fakeCareer({ staff: { designer: 0.6, facilities: { design: 0 } } }), "floor", "aggressive")
          > miscorrChance(fakeCareer({ staff: { designer: 0.95, facilities: { design: 5 } } }), "floor", "safe"), "risk+poor infra → more miscorrelation");
});
test("forecastRange tightens (narrower band) as correlation quality rises", () => {
  const weak = forecastRange(fakeCareer({ staff: { designer: 0.6, facilities: { design: 0 } } }), "floor", "medium");
  const top = forecastRange(fakeCareer({ staff: { designer: 0.95, facilities: { design: 5 } } }), "floor", "medium");
  assert.ok((weak.high - weak.low) > (top.high - top.low), "poor team sees a wider forecast band");
});
test("§Phase-4 per-area designer expertise tilts the forecast (engine designer ≠ wing designer)", () => {
  const mk = spec => { const c = fakeCareer(); c.staff.people.designer.specialty = spec; return c; };
  // the cross-over: the engine designer forecasts more on the POWER part (pu); the aero designer more on
  // an AERO part (floor). (Both specialists also carry a small global dev boost, so the contrast shows
  // as engine>aero on power and aero>engine on aero — their specialty AREA is where each wins.)
  assert.ok(forecastRange(mk("powertrain"), "pu", "medium").mid > forecastRange(mk("aero"), "pu", "medium").mid, "engine designer develops the power part faster");
  assert.ok(forecastRange(mk("aero"), "floor", "medium").mid > forecastRange(mk("powertrain"), "floor", "medium").mid, "aero designer develops the aero part faster");
  assert.ok(forecastRange(mk("powertrain"), "pu", "medium").mid > forecastRange(mk(null), "pu", "medium").mid, "engine designer beats a generalist on the power part");
  // a generalist designer (default specialty) leaves the forecast byte-identical to the bare default
  assert.equal(forecastRange(mk(null), "pu", "medium").mid, forecastRange(fakeCareer(), "pu", "medium").mid, "generalist = byte-identical default");
});

test("§Phase-4 item 4: Known Components raise a developed part's ceiling on a strong team; neutral = factory ceiling", () => {
  // weak team / fresh part → tier 0, no bonus, factory ceiling (byte-identical)
  const weak = fakeCareer({ staff: { designer: 0.6, facilities: { design: 0, sim: 0 } } });
  assert.equal(knownStrength(weak, "floor"), 0);
  assert.equal(knownTier(weak, "floor"), 0);
  assert.equal(knownBonus(weak, "floor"), 0);
  assert.equal(effCeiling(weak, "floor"), PART_CEILING, "weak team / undeveloped part = factory ceiling");
  // strong team (design office + simulator + top designer) + a well-developed part → a known tier above the ceiling
  const strong = fakeCareer({ staff: { designer: 0.97, facilities: { design: 5, sim: 5 } }, parts: { McLaren: { floor: 0.30 } } });
  assert.ok(knownTier(strong, "floor") >= 1, "a developed part on a strong team becomes a known component");
  assert.ok(effCeiling(strong, "floor") > PART_CEILING, "known components let you build above the factory ceiling");
  // you must build the part up first — knowledge unlocks with development, not for free
  const barely = fakeCareer({ staff: { designer: 0.97, facilities: { design: 5, sim: 5 } }, parts: { McLaren: { floor: 0.02 } } });
  assert.equal(knownTier(barely, "floor"), 0, "a lightly-developed part stays tier 0 even on a strong team");
  // Improvability (item 4a) compounds the known-component ceiling gain (base + max addition, §5.5)
  const impHi = fakeCareer({ staff: { designer: 0.97, facilities: { design: 5, sim: 5 } }, parts: { McLaren: { floor: 0.30 } }, chassis: { improv: 0.9 } });
  assert.ok(knownBonus(impHi, "floor") > knownBonus(strong, "floor"), "high Improvability boosts the known-component bonus");
});

test("§Phase-5 Wind Tunnel deepens aero known-component strength (aero parts only)", () => {
  const base = fakeCareer({ staff: { designer: 0.9, facilities: { design: 3, sim: 3, tunnel: 0 } } });
  const tun = fakeCareer({ staff: { designer: 0.9, facilities: { design: 3, sim: 3, tunnel: 5 } } });
  assert.ok(knownStrength(tun, "floor") > knownStrength(base, "floor"), "the Wind Tunnel lifts aero known strength");
  assert.equal(knownStrength(tun, "pu"), knownStrength(base, "pu"), "no effect on a non-aero (power) part");
});

// --- P2: regression + free revert ---
test("aggressive programs can regress a part; revertPart restores the previous spec", () => {
  // run many seeds; on aggressive at least one fit must come out negative (gain<0)
  let sawRegress = false;
  for (let s = 1; s <= 40 && !sawRegress; s++) {
    const c = fakeCareer({ seed: s, staff: { designer: 0.6, facilities: { design: 0 } }, parts: { McLaren: { floor: 0.2 } } });
    startProject(c, "floor", "large", "aggressive"); tickDevelopment(c, PROJECT_SIZE.large.days);   // a large project needs its full day budget to complete
    if (regressedParts(c).includes("floor")) {
      sawRegress = true;
      const prev = c.partsPrev.floor;
      assert.ok(c.parts["McLaren"].floor < prev || c.parts["McLaren"].floor >= 0, "fitted spec recorded");
      assert.ok(revertPart(c, "floor"), "revert succeeds");
      assert.equal(c.parts["McLaren"].floor, prev, "revert restores previous level");
      assert.ok(!regressedParts(c).includes("floor"), "revert clears the flag");
    }
  }
  assert.ok(sawRegress, "aggressive risk produced at least one regression across seeds");
});

// --- P3: deep PU — ERS characteristic, homologation tokens, engine modes ---
test("PU has an ERS characteristic feeding the power indicator", () => {
  assert.ok(PU_PARTS.includes("ers"), "ers is developable");
  assert.ok(puToDeltas({ ers: 0.1 }).power > 0, "ers lifts power");
});
test("homologation tokens gate engine development and cannot be overspent", () => {
  const c = fakeCareer({ backer: { puMaker: true }, puTokens: PU_TOKENS_PER_SEASON, puParts: { power: 0, ers: 0, eff: 0, rel: 0 } });
  assert.ok(startPUProject(c, "power", "large"), "first large project ok");
  assert.equal(c.puTokens, PU_TOKENS_PER_SEASON - PU_TOKEN_COST.large, "tokens spent");
  c.puProject = null;                                  // free the single PU slot
  assert.ok(startPUProject(c, "rel", "large") === null || c.puTokens >= 0, "second large blocked or within budget");
});
test("engine modes scale PU wear; default mode is back-compatible (neutral)", () => {
  assert.ok(engineModeStress({ push: 1 }) > 1 && engineModeStress({ save: 1 }) < 1, "push burns, save spares");
  assert.equal(engineModeStress({ standard: 1 }), 1, "standard is neutral");
  assert.ok(Math.abs(engineModeStress({ push: 0.5, standard: 0.5 }) - 1.7) < 1e-9, "mix averages by fraction");
  const trk = { pw: 0.7 };
  assert.equal(puWearForRace(trk, 0.1, 0.2), puWearForRace(trk, 0.1, 0.2, 1), "absent modeStress == neutral (no regression)");
  assert.ok(puWearForRace(trk, 0.1, 0.2, 2.4) > puWearForRace(trk, 0.1, 0.2, 0.5), "push wears more than save");
});

// --- P5: regulation eras ---
test("eraEmphasis is deterministic, bounded, and reshuffles across eras", () => {
  for (const p of PARTS) { const e = eraEmphasis(1, p); assert.ok(e >= 0.70 && e <= 1.30, "bounded"); }
  assert.equal(regEra(1), regEra(3), "seasons 1 and 3 share an era");
  assert.notEqual(regEra(1), regEra(4), "season 4 starts a new era");
  assert.equal(eraEmphasis(1, "floor"), eraEmphasis(3, "floor"), "stable within an era");
  assert.notEqual(eraEmphasis(1, "floor"), eraEmphasis(4, "floor"), "new era retunes the part");
});

// --- P3: engine-mode wear calibration — modeMix all-push reproduces the legacy 0.7·pushFrac term ---
test("all-push modeMix reproduces the old pushFrac PU-wear magnitude (no balance drift)", () => {
  const trk = { pw: 0.5 };
  const legacy = puWearForRace(trk, 0, 1, 1);                          // old path: pushFrac=1, neutral mode
  const viaMode = puWearForRace(trk, 0, 0, engineModeStress({ push: 1 }));  // new path: modeMix owns it
  assert.ok(Math.abs(legacy - viaMode) < 1e-9, "calibration preserved");
});

// --- P6: co-op slot split between the two co-directors ---
test("co-op caps each co-director at its share of the factory slots; the other can use the rest", () => {
  const c = fakeCareer({ coop: true, staff: { ...initStaff(0.6, 1), facilities: { design: 5, pit: 5, factory: 4 } } });
  assert.equal(maxProjects(c), 3, "factory 4 → 3 global slots");
  assert.equal(playerSlotCap(c), 2, "co-op caps a director at ceil(3/2)=2");
  assert.ok(startProject(c, "fw", "small", "balanced", "p1"));
  assert.ok(startProject(c, "rw", "small", "balanced", "p1"));
  assert.equal(startProject(c, "floor", "small", "balanced", "p1"), null, "p1 hit its half");
  assert.ok(startProject(c, "floor", "small", "balanced", "p2"), "p2 takes the remaining slot");
  assert.equal(startProject(c, "sidepods", "small", "balanced", "p2"), null, "now the global cap is full");
});
test("single-player ignores the co-op slot split (owner-gated)", () => {
  const c = fakeCareer({ staff: { ...initStaff(0.6, 1), facilities: { design: 5, pit: 5, factory: 4 } } });
  assert.equal(playerSlotCap(c), maxProjects(c), "no split outside co-op");
  assert.ok(startProject(c, "fw", "small"));
  assert.ok(startProject(c, "rw", "small"));
  assert.ok(startProject(c, "floor", "small"), "all 3 slots usable solo");
});

// --- P4: customer engine-supply spec ---
test("customer last-year engine spec weakens the car and costs a cheaper fee; works teams ignore it", () => {
  assert.equal(customerSpecDelta({ backer: { puMaker: true } }), null, "works develops its own engine");
  assert.equal(customerSpecDelta({ backer: { puMaker: false }, puContract: "current" }), null, "current spec = no penalty");
  const d = customerSpecDelta({ backer: { puMaker: false }, puContract: "prev" });
  assert.ok(d.power < 0 && d.rel < 0, "prev spec costs power + reliability");
  assert.equal(supplyFeeMult({ backer: { puMaker: false }, puContract: "prev" }), PU_SUPPLY_SPEC.prev.feeMult, "cheaper supply fee");
  // applyRaceMods folds the customer penalty into the effective car
  const base = { power: 0.9, aero: 0.85, tyre: 1, fuel: 1, rel: 0.9 };
  const cur = applyRaceMods(base, { backer: { puMaker: false }, puContract: "current" }, { pw: 0.5, df: 0.5 });
  const prev = applyRaceMods(base, { backer: { puMaker: false }, puContract: "prev" }, { pw: 0.5, df: 0.5 });
  assert.ok(prev.power < cur.power && prev.rel < cur.rel, "last-year spec is slower + less reliable in-race");
});
