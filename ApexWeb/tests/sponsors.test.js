import { test } from "node:test";
import assert from "node:assert/strict";
import { OBJ, defaultSponsors, titleOffers, evaluateSponsor, objectiveLabel, FOCUS_MULT } from "../src/sponsors.js";

test("§Phase-6 weekend bonus focus: a focused sponsor's met bonus is boosted; default unchanged", () => {
  const sp = { retainer: 100, bonus: 200, objective: { type: OBJ.PODIUM }, happiness: 0.6 };
  const hit = { bestPos: 1, points: 25, beat: new Set() };
  assert.equal(evaluateSponsor(sp, hit, false).payout, 300, "default: retainer + bonus");
  assert.equal(evaluateSponsor(sp, hit, true).payout, 100 + 200 * FOCUS_MULT, "focused: bonus boosted");
  const miss = { bestPos: 10, points: 0, beat: new Set() };
  assert.ok(evaluateSponsor(sp, miss, true).dHappiness < evaluateSponsor(sp, miss, false).dHappiness, "a focused miss stings happiness more");
});

test("defaultSponsors: 1 title + 2 secondary, deterministic, happiness seeded", () => {
  const a = defaultSponsors(0, 5), b = defaultSponsors(0, 5);
  assert.deepEqual(a, b);
  assert.equal(a.length, 3);
  assert.equal(a.filter(s => s.kind === "title").length, 1);
  for (const s of a) { assert.ok(s.retainer > 0 && s.bonus > 0); assert.ok(s.happiness >= 0 && s.happiness <= 1); assert.ok(s.objective && s.objective.type); }
});

test("a top team's title objective is harder (podium/front) than a backmarker's", () => {
  const top = defaultSponsors(0, 1).find(s => s.kind === "title");
  const back = defaultSponsors(10, 1).find(s => s.kind === "title");
  const hardness = o => o.type === OBJ.PODIUM ? 1 : (o.type === OBJ.FINISH_ABOVE ? 1 / o.param : 0);
  assert.ok(hardness(top.objective) > hardness(back.objective), "top deal demands more");
});

test("titleOffers: 3 deterministic offers with a retainer<->ambition tradeoff", () => {
  const offs = titleOffers(3, 2);
  assert.equal(offs.length, 3);
  assert.deepEqual(offs, titleOffers(3, 2));
  assert.ok(offs[2].bonus > offs[0].bonus, "the ambitious offer pays a bigger bonus");
});

test("evaluateSponsor: meeting the objective pays retainer+bonus and lifts happiness", () => {
  const sp = { kind: "title", retainer: 200, bonus: 300, objective: { type: OBJ.FINISH_ABOVE, param: 5 }, happiness: 0.6 };
  const hit = evaluateSponsor(sp, { bestPos: 3, points: 30, beat: new Set() });
  assert.equal(hit.met, true); assert.equal(hit.payout, 500); assert.ok(hit.dHappiness > 0);
  const miss = evaluateSponsor(sp, { bestPos: 9, points: 2, beat: new Set() });
  assert.equal(miss.met, false); assert.equal(miss.payout, 200); assert.ok(miss.dHappiness < 0);
});

test("objectiveLabel renders Russian for each kind", () => {
  assert.match(objectiveLabel({ type: OBJ.PODIUM }), /Подиум/);
  assert.match(objectiveLabel({ type: OBJ.FINISH_ABOVE, param: 6 }), /топ-6/);
  assert.match(objectiveLabel({ type: OBJ.POINTS, param: 8 }), /8/);
});
