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
