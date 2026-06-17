import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILD_STEP_GAIN, stepCost, buildStep, AMBITIONS, applyAmbition, autoBuild } from "../src/preseason.js";

function career(over = {}) {
  return { teamIdx: 0, _myTeamName: "McLaren", money: 11000, parts: {}, projects: [], board: { targetPos: 1 }, directors: [], ...over };
}

test("stepCost is positive, rises with invested level, and an aero specialist pays less", () => {
  const c = career();
  const c0 = stepCost(c, "aero");
  assert.ok(c0 > 0);
  buildStep(c, "aero");
  assert.ok(stepCost(c, "aero") > c0, "diminishing returns: next step costs more");
  const withSpec = career({ directors: [{ specialty: "aero" }, { specialty: "engine" }] });
  assert.ok(stepCost(withSpec, "aero") < stepCost(career(), "aero"), "aero specialist discount");
});

test("buildStep spends money and raises a part; fails when broke", () => {
  const c = career();
  const before = c.money;
  assert.equal(buildStep(c, "aero"), true);
  assert.ok(c.money < before, "money spent");
  const tn = c._myTeamName;
  const raised = Object.values(c.parts[tn]).some(v => v >= BUILD_STEP_GAIN);
  assert.ok(raised, "a part level went up by the step gain");
  assert.equal(buildStep(career({ money: 0 }), "aero"), false, "can't afford → false");
});

test("applyAmbition sets board.targetPos from tier+offset and a rewardMult", () => {
  assert.equal(applyAmbition(career({ teamIdx: 4 }), "realistic"), 5, "tier 5 → P5");
  const amb = career({ teamIdx: 4 });
  applyAmbition(amb, "ambitious");
  assert.equal(amb.board.targetPos, 3, "ambitious = tier − 2");
  assert.equal(amb.rewardMult, AMBITIONS.ambitious.reward);
  const mod = career({ teamIdx: 0 });
  applyAmbition(mod, "modest");
  assert.equal(mod.board.targetPos, 3, "tier 1 + 2 = P3");
});

test("autoBuild spends most of the budget without overspending", () => {
  const c = career({ money: 9000 });
  autoBuild(c);
  assert.ok(c.money >= 0, "never overspends");
  assert.ok(c.money < 9000, "actually built something");
});
