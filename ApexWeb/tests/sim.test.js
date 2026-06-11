// ApexWeb/tests/sim.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { Race } from "../src/sim.js";
import { TEAMS, TRACK } from "../src/data.js";

function field() {
  // flat field: every team's two drivers, no players yet
  let idx = 0;
  return TEAMS.flatMap(t => t.drivers.map(d => ({
    idx: idx++, name:d.name, abbrev:d.abbrev, skill:d.skill,
    car:t.car, color:t.color, team:t.name,
    setup:[0.5,0.5,0.5], startTyre:"medium",
  })));
}

function runToFinish(seed) {
  const r = new Race(field(), TRACK, seed);
  let guard = 0;
  while (!r.finished && guard++ < 500000) r.step();
  return r;
}

test("a car records laps and lap times in a sane range", () => {
  const r = new Race(field(), TRACK, 42);
  for (let i = 0; i < 1000; i++) r.step();
  const c = r.cars[0];
  assert.ok(c.lap >= 1, "should have completed at least one lap");
  // clean Barcelona lap ~ 78-86s for the fastest cars
  assert.ok(c.lastLap > 70 && c.lastLap < 95, `lastLap=${c.lastLap}`);
});

test("push is faster than conserve, all else equal", () => {
  const f = field();
  const r = new Race(f, TRACK, 1);
  r.setPace(0, "push"); r.setPace(1, "conserve");
  // give them identical drivers/cars for the comparison
  r.cars[1].skill = r.cars[0].skill; r.cars[1].car = r.cars[0].car;
  let t0 = 0, t1 = 0, n = 0;
  for (let i = 0; i < 4000; i++) {
    r.step();
    if (r.cars[0].lastLap) { t0 += r.cars[0].lastLap; t1 += r.cars[1].lastLap; n++; }
  }
  assert.ok(r.cars[0].avgLap < r.cars[1].avgLap, "push should average faster");
});

test("determinism: same seed -> identical finish order", () => {
  const a = runToFinish(7).order().map(c => c.abbrev);
  const b = runToFinish(7).order().map(c => c.abbrev);
  assert.deepEqual(a, b);
});

// append to ApexWeb/tests/sim.test.js
import { COMBAT_GAP } from "../src/data.js";

test("invariant: lap completions never exceed lap counter", () => {
  const r = new Race(field(), TRACK, 99);
  let guard = 0;
  while (!r.finished && guard++ < 500000) {
    r.step();
    for (const c of r.cars) assert.ok(c.lapFrac >= 0 && c.lapFrac < 1.0001, `frac=${c.lapFrac}`);
  }
});

test("a clearly faster car gains positions over a stint", () => {
  const f = field();
  const r = new Race(f, TRACK, 3);
  // car 21 (Боттас) has the lowest skill -> grid him last FIRST, then give him a
  // big pace edge and check he carves forward (gridStart sorts by skill, so the
  // boost must come after the grid is set, or he'd start at the front).
  r.gridStart(); // skill-sorted grid: lowest skill (car 21) starts last
  r.cars[21].skill = 1.0; r.cars[21].car = { power:0.99, aero:0.99, energy:0.95, rel:0.99 };
  const startPos = r.order().find(c => c.idx === 21).pos;
  for (let i = 0; i < 6000; i++) r.step();
  const endPos = r.order().find(c => c.idx === 21).pos;
  assert.ok(endPos < startPos, `start=${startPos} end=${endPos}`);
});

test("requestPit serves a stop and switches compound", () => {
  const r = new Race(field(), TRACK, 5);
  r.requestPit(0, "hard");
  let guard = 0;
  while (r.cars[0].lap < 3 && guard++ < 50000) r.step();
  assert.equal(r.cars[0].tyre, "hard");
  assert.ok(r.cars[0].pitStops === 1);
});
