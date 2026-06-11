// ApexWeb/tests/quali.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { qualiLap, buildGrid } from "../src/quali.js";
import { TEAMS, TRACK } from "../src/data.js";
import { RNG } from "../src/rng.js";

const drv = TEAMS[0].drivers[0], car = TEAMS[0].car;

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

test("buildGrid returns all cars sorted fastest-first", () => {
  let idx = 0;
  const field = TEAMS.flatMap(t => t.drivers.map(d => ({
    idx: idx++, abbrev:d.abbrev, skill:d.skill, car:t.car, setup:[0.5,0.5,0.5], risk:0.5,
  })));
  const grid = buildGrid(field, TRACK, 123);
  assert.equal(grid.length, 22);
  for (let i = 1; i < grid.length; i++) assert.ok(grid[i].time >= grid[i-1].time);
});
