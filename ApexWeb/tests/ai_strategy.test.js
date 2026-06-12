import { test } from "node:test";
import assert from "node:assert/strict";
import { stintLife, planRace, pitDecision, engineMode, paceMode } from "../src/ai_strategy.js";
import { TRACK, COMPOUNDS } from "../src/data.js";

const aiCar = (over = {}) => ({
  idx: 3, tyre: "medium", wear: 0, lap: 0, fuel: 50, engine: "standard", pace: "balanced",
  car: { power: 0.9, aero: 0.9, rel: 0.95, tyre: 1.0, fuel: 1.0 },
  attrs: { tyre: 0.5, race_iq: 0.7, smoothness: 0.5 },
  personnel: { strategy: 0.8, pitMult: 0.9 },
  ...over,
});

test("stintLife: harder compounds last longer; a tyre-kind driver extends them", () => {
  const c = aiCar();
  assert.ok(stintLife("hard", c) > stintLife("medium", c));
  assert.ok(stintLife("medium", c) > stintLife("soft", c));
  const kind = aiCar({ attrs: { ...aiCar().attrs, tyre: 0.9 } });
  assert.ok(stintLife("medium", kind) > stintLife("medium", aiCar()), "kinder driver = longer stint");
});

test("planRace: returns 1 or 2 stops with target laps inside the race and ascending", () => {
  const p = planRace(aiCar(), TRACK, 1234);
  assert.ok(p.n === 1 || p.n === 2, `n=${p.n}`);
  for (const s of p.stops) { assert.ok(s.lap > 0 && s.lap < TRACK.laps, `lap ${s.lap}`); assert.ok(COMPOUNDS[s.compound], s.compound); }
  if (p.n === 2) assert.ok(p.stops[1].lap > p.stops[0].lap, "stops ascending");
  assert.deepEqual(planRace(aiCar(), TRACK, 1234), p, "deterministic");
});

test("pitDecision: rain forces a wet-tyre stop; dry plan stop fires at its target lap", () => {
  const c = aiCar({ aiPlan: planRace(aiCar(), TRACK, 1234), aiStopsDone: 0 });
  const wet = pitDecision(c, { wetness: 0.9, scActive: false, laps: TRACK.laps });
  assert.ok(wet && (wet.compound === "wet" || wet.compound === "inter") && wet.reason === "weather");
  c.lap = Math.max(1, c.aiPlan.stops[0].lap - 3);
  assert.equal(pitDecision(c, { wetness: 0, scActive: false, laps: TRACK.laps }), null);
  c.lap = c.aiPlan.stops[0].lap;
  const plan = pitDecision(c, { wetness: 0, scActive: false, laps: TRACK.laps });
  assert.ok(plan && plan.compound === c.aiPlan.stops[0].compound && plan.reason === "plan");
});

test("pitDecision: safety car pulls a near-due stop forward (cheap pit)", () => {
  const c = aiCar({ aiPlan: { stops: [{ lap: 30, compound: "hard" }], n: 1 }, aiStopsDone: 0, lap: 24 });
  assert.equal(pitDecision(c, { wetness: 0, scActive: false, laps: TRACK.laps }), null, "no SC, too early");
  const sc = pitDecision(c, { wetness: 0, scActive: true, laps: TRACK.laps });
  assert.ok(sc && sc.reason === "sc", "SC pulls the stop forward");
});

test("engineMode: saves fuel when short, pushes when chasing with fuel in hand", () => {
  const c = aiCar();
  assert.equal(engineMode(c, { fuelLaps: 3, lapsLeft: 8, gapAhead: 5, pos: 4 }), "save");
  assert.equal(engineMode(c, { fuelLaps: 20, lapsLeft: 8, gapAhead: 0.8, pos: 4 }), "push");
  assert.equal(engineMode(c, { fuelLaps: 20, lapsLeft: 8, gapAhead: 6, pos: 4 }), "standard");
});

test("paceMode: conserves stuck in dirty air, pushes when attacking on good tyres", () => {
  const c = aiCar();
  assert.equal(paceMode(c, { dirtyAir: true, canPass: false, gapAhead: 1.0 }), "conserve");
  assert.equal(paceMode(c, { dirtyAir: false, canPass: false, gapAhead: 0.7 }), "push");
  assert.equal(paceMode(c, { dirtyAir: false, canPass: false, gapAhead: 6 }), "balanced");
});
