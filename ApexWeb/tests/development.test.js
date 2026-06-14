import { test } from "node:test";
import assert from "node:assert/strict";
import { TEAMS } from "../src/data.js";
import { INDICATORS, PROJECT_SIZE, effectiveCar, startProject, tickDevelopment } from "../src/development.js";

function fakeCareer(over = {}) {
  return { seed: 1, teamIdx: 0, round: 0, money: 100000, costCap: false, devSpentThisSeason: 0, carDev: {}, project: null, ...over };
}

test("effectiveCar adds deltas onto the base car, clamped; rel never exceeds ~1", () => {
  const base = TEAMS[5].car;
  const eff = effectiveCar(base, { power: 0.05, aero: 0.02, rel: 0.50, tyre: 0, fuel: 0 });
  assert.ok(Math.abs(eff.power - (base.power + 0.05)) < 1e-9);
  assert.ok(eff.rel <= 0.995, "rel clamped below 1");
  const none = effectiveCar(base, null);
  assert.equal(none.power, base.power);
});

test("startProject spends money, queues a project, blocks a second one", () => {
  const c = fakeCareer();
  const p = startProject(c, "power", "medium");
  assert.ok(p && p.indicator === "power");
  assert.equal(c.money, 100000 - PROJECT_SIZE.medium.cost);
  assert.equal(startProject(c, "aero", "small"), null, "only one project at a time");
});

test("startProject refuses when broke or indicator/size invalid", () => {
  assert.equal(startProject(fakeCareer({ money: 10 }), "power", "large"), null);
  assert.equal(startProject(fakeCareer(), "nope", "small"), null);
  assert.equal(startProject(fakeCareer(), "power", "huge"), null);
});

test("tickDevelopment completes a finished project (applies a risk-shaved gain) and develops AI", () => {
  const c = fakeCareer({ teamIdx: 0 });
  startProject(c, "power", "small");                  // 1-race project
  const evs = tickDevelopment(c);                     // racesLeft 1 -> 0 -> complete
  assert.equal(c.project, null);
  assert.ok(c.carDev["McLaren"].power > 0 && c.carDev["McLaren"].power <= PROJECT_SIZE.small.gain + 1e-9);
  assert.ok(evs.some(e => e.type === "project_done"));
  assert.ok(c.carDev[TEAMS[5].name].power > 0);
});

test("tickDevelopment is deterministic and stream-clean (same seed/round -> same gain)", () => {
  const mk = () => { const c = fakeCareer(); startProject(c, "aero", "medium"); tickDevelopment(c); tickDevelopment(c); return c.carDev["McLaren"].aero; };
  assert.equal(mk(), mk());
});

test("AI catch-up: a backmarker develops faster than a top team per round", () => {
  const c = fakeCareer({ teamIdx: 0 });
  tickDevelopment(c);
  const top = c.carDev[TEAMS[1].name].power;          // Mercedes (strong)
  const back = c.carDev[TEAMS[10].name].power;         // Cadillac (weak)
  assert.ok(back > top, "weaker teams catch up faster");
});
