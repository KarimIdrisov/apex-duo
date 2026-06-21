import { test } from "node:test";
import assert from "node:assert/strict";
import { seasonObjectives, evaluateObjectives, regResetFor, regArcNote, devMaturity, regResetForCareer, REG_CONVERGE, REG_DEEP } from "../src/board.js";
import { TEAMS } from "../src/data.js";

test("seasonObjectives: a championship goal + a tier-specific goal", () => {
  const top = seasonObjectives(1), mid = seasonObjectives(6), back = seasonObjectives(10);
  for (const o of [top, mid, back]) { assert.ok(o.length >= 2); assert.equal(o[0].type, "championship"); }
  assert.equal(top[1].type, "podiums"); assert.equal(mid[1].type, "points"); assert.equal(back[1].type, "develop");
});

test("evaluateObjectives: reports met/progress from career state", () => {
  const career = { teamIdx: 0, teamPts: {}, parts: {}, board: { targetPos: 1, podiums: 9, pointFinishes: 20, objectives: seasonObjectives(1) } };
  for (const t of TEAMS) career.teamPts[t.name] = t.name === TEAMS[0].name ? 500 : 100;   // player leads
  const ev = evaluateObjectives(career);
  assert.equal(ev.length, career.board.objectives.length);
  assert.ok(ev[0].met);                                   // P1 meets "<= P1"
  assert.ok(ev[1].met);                                   // 9 >= 8 podiums
  assert.ok(ev.every(o => o.progress >= 0 && o.progress <= 1 && o.label));
});

test("regResetFor: a big reg shake-up on a cycle, otherwise a normal trim; always < 1", () => {
  let big = 0; for (let s = 2; s <= 10; s++) { const r = regResetFor(s); assert.ok(r > 0 && r < 1); if (r < 0.5) big++; }
  assert.ok(big >= 1 && big < 9);                         // some big years, not all
  assert.ok(typeof regArcNote(3) === "string");
});

test("§Phase-4 item 7: a converged grid triggers a deeper threshold reset than the cadence", () => {
  // a sparse/young grid (low field development) → no threshold → the cadence reset stands
  const young = { A: { fw: 0.01 } };
  assert.ok(devMaturity(young) < REG_CONVERGE);
  assert.equal(regResetForCareer(2, young).reg, regResetFor(2), "below threshold = cadence reset");
  assert.equal(regResetForCareer(2, young).deep, false);
  // a developed/converged grid → resets DEEPER than the cadence, flagged deep
  const mature = { A: { fw: 0.2, pu: 0.2 }, B: { fw: 0.2, pu: 0.2 } };
  assert.ok(devMaturity(mature) >= REG_CONVERGE);
  const r2 = regResetForCareer(2, mature);               // season 2: cadence 0.6
  assert.ok(r2.reg <= REG_DEEP && r2.reg < regResetFor(2), "converged grid resets deeper than the cadence");
  assert.equal(r2.deep, true);
  assert.ok(regResetForCareer(3, mature).reg <= regResetFor(3), "even on a cadence-deep season it never trims less");
  assert.equal(devMaturity(null), 0, "null-safe");
});
