// ApexWeb/tests/quali.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { qualiLap, buildGrid } from "../src/quali.js";
import { TEAMS, TRACK } from "../src/data.js";
import { RNG } from "../src/rng.js";
import { driverAttrs } from "../src/team.js";

const drv = TEAMS[0].drivers[0], car = TEAMS[0].car;

test("a strong qualifier out-qualifies a same-overall racer", () => {
  const quali = { abbrev: "LEC", skill: 0.85, attrs: driverAttrs("LEC", 0.85) };  // LEC: +0.12 quali signature
  const racer = { abbrev: "PER", skill: 0.85, attrs: driverAttrs("PER", 0.85) };  // PER: no quali bump
  let qWins = 0;
  for (let s = 0; s < 100; s++) {
    if (qualiLap(quali, car, TRACK, [0.5,0.5,0.5], 0.3, new RNG(s)) <
        qualiLap(racer, car, TRACK, [0.5,0.5,0.5], 0.3, new RNG(s))) qWins++;
  }
  assert.ok(qWins > 60, `the qualifier should usually be faster (${qWins}/100)`);
});

test("higher risk lowers the mean lap time but raises variance", () => {
  const safe = [], risky = [];
  for (let s = 0; s < 200; s++) {
    safe.push(qualiLap(drv, car, TRACK, [0.5,0.5,0.5], 0.1, new RNG(s)));
    risky.push(qualiLap(drv, car, TRACK, [0.5,0.5,0.5], 0.9, new RNG(s)));
  }
  const mean = a => a.reduce((x,y)=>x+y,0)/a.length;
  const variance = a => { const m=mean(a); return mean(a.map(v=>(v-m)**2)); };
  assert.ok(mean(risky) < mean(safe), "risky should be faster on average");
  assert.ok(variance(risky) > variance(safe), "risky should be more variable");
});

test("a composed driver loses less time to lock-ups under pressure (§18.7)", () => {
  const base = driverAttrs("NOR", 0.8);
  const calm    = { abbrev: "X", skill: 0.8, attrs: { ...base, composure: 0.95 } };
  const rattled = { abbrev: "Y", skill: 0.8, attrs: { ...base, composure: 0.05 } };
  const cm = (car.power + car.aero) / 2;   // single-car mean → car-pace term zero, times realistic
  let calmSum = 0, rattSum = 0;
  for (let s = 0; s < 300; s++) {          // high risk → mistakes matter; same seed → same noise, only the lock-up roll differs
    calmSum += qualiLap(calm, car, TRACK, [0.5,0.5,0.5], 0.9, new RNG(s), cm);
    rattSum += qualiLap(rattled, car, TRACK, [0.5,0.5,0.5], 0.9, new RNG(s), cm);
  }
  assert.ok(rattSum > calmSum, `rattled driver loses more time to lock-ups (${rattSum.toFixed(1)} vs ${calmSum.toFixed(1)})`);
});

test("buildGrid returns all cars sorted fastest-first", () => {
  let idx = 0;
  const field = TEAMS.flatMap(t => t.drivers.map(d => ({
    idx: idx++, abbrev:d.abbrev, skill:d.skill, car:t.car, setup:[0.5,0.5,0.5], risk:0.5,
  })));
  const grid = buildGrid(field, TRACK, 123);
  assert.equal(grid.length, 22);
  for (let i = 1; i < grid.length; i++) assert.ok(grid[i].time >= grid[i-1].time);
});
