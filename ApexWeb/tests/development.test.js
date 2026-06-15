import { test } from "node:test";
import assert from "node:assert/strict";
import { TEAMS } from "../src/data.js";
import { PARTS, PART_CONTRIB, PROJECT_SIZE, partsToDeltas, effectiveCar, startProject, tickDevelopment } from "../src/development.js";
import { initStaff } from "../src/staff.js";

function fakeCareer(over = {}) {
  return { seed: 1, teamIdx: 0, round: 0, money: 1e6, costCap: false, devSpentThisSeason: 0, parts: {}, project: null, staff: initStaff(0.6, 1), academy: [], ...over };
}

test("partsToDeltas composes part levels into indicator deltas via PART_CONTRIB", () => {
  const d = partsToDeltas({ pu: 0.1, floor: 0.1 });
  assert.ok(Math.abs(d.power - 0.07) < 1e-9, "pu 0.1 -> +0.07 power");
  assert.ok(d.aero > 0.05, "floor lifts aero");
  assert.deepEqual(partsToDeltas(null), { power: 0, aero: 0, tyre: 0, fuel: 0, rel: 0 });
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
  assert.equal(startProject(c, "pu", "small"), null);          // one project at a time
  assert.equal(startProject(fakeCareer(), "wing", "small"), null);
});

test("tickDevelopment completes a part project + develops AI parts (catch-up: backmarker > top)", () => {
  const c = fakeCareer();
  startProject(c, "pu", "small");
  tickDevelopment(c);
  assert.equal(c.project, null);
  assert.ok(c.parts["McLaren"].pu > 0);
  assert.ok(c.parts[TEAMS[10].name].pu > c.parts[TEAMS[1].name].pu, "weaker team develops faster");
});

test("devMult + academy scale the part gain; deterministic", () => {
  const weak = (() => { const c = fakeCareer({ staff: initStaff(0.6, 1) }); startProject(c, "pu", "small"); tickDevelopment(c); return c.parts["McLaren"].pu; })();
  const strong = (() => { const c = fakeCareer({ staff: { ...initStaff(0.99, 1), facilities: { design: 5, pit: 5, factory: 5 } }, academy: [{ abbrev: "X" }] }); startProject(c, "pu", "small"); tickDevelopment(c); return c.parts["McLaren"].pu; })();
  assert.ok(strong > weak, "better design office + academy develops more");
});
