import { test } from "node:test";
import assert from "node:assert/strict";
import { carMean, practiceLapBase } from "../src/practice.js";
import { TEAMS, TRACK } from "../src/data.js";
import { composeCar } from "../src/team.js";
import { trackIdeal } from "../src/setup.js";

const ideal = trackIdeal(TRACK.laps * 1000 + Math.round(TRACK.lt));
const drv = { skill: 0.90, attrs: { pace: 0.90 } };
const car = composeCar(TEAMS[0].car);   // McLaren

test("carMean is the field mean of (power+aero)/2, ~0.88", () => {
  const m = carMean();
  assert.ok(m > 0.84 && m < 0.92, `carMean ${m}`);
});

test("practiceLapBase: a perfect setup is faster than a bad one, lap ~78-86s", () => {
  const perfect = practiceLapBase(drv, car, ideal, ideal);            // setup == ideal
  const bad     = practiceLapBase(drv, car, [0, 0, 0], ideal);
  assert.ok(perfect < bad, `perfect (${perfect}) faster than bad (${bad})`);
  assert.ok(perfect > 75 && perfect < 88, `lap in range (${perfect})`);
});

import { runLong } from "../src/practice.js";

test("runLong: deg rises over the stint and reports a cliffLap + recommendedStops", () => {
  const r = runLong(drv, car, "soft", ideal, ideal, 14, 7);
  assert.equal(r.type, "long");
  assert.equal(r.compound, "soft");
  assert.equal(r.lapTimes.length, 14);
  // later laps are slower than the first few (degradation)
  const early = (r.lapTimes[1] + r.lapTimes[2]) / 2, late = (r.lapTimes[12] + r.lapTimes[13]) / 2;
  assert.ok(late > early + 0.5, `deg over the stint (${early.toFixed(2)} -> ${late.toFixed(2)})`);
  assert.ok(r.stintLaps >= 1 && r.recommendedStops >= 1, "sane stint/stops");
});

test("runLong is deterministic for a seed", () => {
  assert.deepEqual(runLong(drv, car, "medium", ideal, ideal, 10, 3),
                   runLong(drv, car, "medium", ideal, ideal, 10, 3));
});

import { runSetupTest, runQuali } from "../src/practice.js";

test("runSetupTest: signal tracks setup closeness, noise grows as consistency drops", () => {
  const steady  = { skill: 0.9, attrs: { pace: 0.9, consistency: 0.95, race_iq: 0.9 } };
  const jittery = { skill: 0.9, attrs: { pace: 0.9, consistency: 0.10, race_iq: 0.9 } };
  const spread = d => { let lo = 1e9, hi = -1e9; for (let s = 0; s < 40; s++) {
    const v = runSetupTest(d, car, [0.5, 0.5, 0.5], ideal, s).lapTime; lo = Math.min(lo, v); hi = Math.max(hi, v); } return hi - lo; };
  assert.ok(spread(jittery) > spread(steady), "a jittery driver's setup signal is noisier");
  // a better setup still reads faster on average
  const near = runSetupTest(steady, car, ideal, ideal, 1).lapTime, far = runSetupTest(steady, car, [0,0,0], ideal, 1).lapTime;
  assert.ok(near < far, "closer setup reads faster");
});

test("runSetupTest: feedback is clearer for a high race_iq driver", () => {
  const sharp = { skill: 0.9, attrs: { pace: 0.9, consistency: 0.9, race_iq: 0.95 } };
  const vague = { skill: 0.9, attrs: { pace: 0.9, consistency: 0.9, race_iq: 0.10 } };
  const setup = [0.2, 0.5, 0.5];   // axis 0 is clearly off
  const namesAxis0 = (d) => { let hit = 0; for (let s = 0; s < 40; s++) {
    if (runSetupTest(d, car, setup, ideal, s).feedback.startsWith("Прижим")) hit++; } return hit; };
  assert.ok(namesAxis0(sharp) > namesAxis0(vague), "the sharp driver names the right axis more often");
});

test("runQuali returns a representative pace and is deterministic", () => {
  const a = runQuali(drv, car, ideal, ideal, 5), b = runQuali(drv, car, ideal, ideal, 5);
  assert.equal(a.type, "quali");
  assert.ok(a.qualiPace > 74 && a.qualiPace < 86, `quali pace in range (${a.qualiPace})`);
  assert.equal(a.qualiPace, b.qualiPace);
});
