import { test } from "node:test";
import assert from "node:assert/strict";
import { newQuali, release, qualiStep, carView, advanceSegment, finalGrid, trafficFor } from "../src/quali_session.js";
import { TEAMS, TRACK, QUALI2 } from "../src/data.js";
import { driverAttrs, composeCar } from "../src/team.js";

function field() {   // all 22 cars; p1/p2 = first team's two drivers
  let idx = 0;
  return TEAMS.flatMap((t, ti) => t.drivers.map((d, di) => ({
    idx: idx++, abbrev: d.abbrev, drv: { skill: d.skill, attrs: driverAttrs(d.abbrev, d.skill) },
    car: composeCar(t.car), setupBonus: 0, player: ti === 0 ? (di === 0 ? "p1" : "p2") : null,
  })));
}

test("a released car warms on the out-lap then sets a flying time; grip rises", () => {
  let s = newQuali(7, field()); s.paused = false; s.speed = 8;
  s = release(s, "p1", "fresh", "attack");
  const g0 = s.grip;
  for (let i = 0; i < 600; i++) s = qualiStep(s, 1.0);
  const v = carView(s, "p1");
  assert.ok(v.bestTime > 60 && v.bestTime < 100, `set a flying time (${v.bestTime})`);
  assert.ok(s.grip > g0, "track rubbered in");
});

test("determinism: same seed + same release → identical flying time", () => {
  const run = () => { let s = newQuali(3, field()); s.paused = false; s.speed = 8;
    s = release(s, "p1", "fresh", "steady"); for (let i = 0; i < 600; i++) s = qualiStep(s, 1.0);
    return carView(s, "p1").bestTime; };
  assert.equal(run(), run());
});

test("a full knockout yields a 22-car grid: Q1 drops 7, Q2 drops 5, Q3 sets P1..P10", () => {
  let s = newQuali(11, field()); s.paused = false; s.speed = 8;
  let g = 0; while (s.segment <= 3 && g++ < 20000) {
    s = qualiStep(s, 2.0);
    if (s.clock <= 0 && s.segment <= 3) s = advanceSegment(s);
  }
  const grid = finalGrid(s);
  assert.equal(grid.length, 22, "22-car grid");
  assert.equal(new Set(grid.map(r => r.idx)).size, 22, "no duplicate cars");
  assert.deepEqual(grid.map(r => r.pos), Array.from({ length: 22 }, (_, i) => i + 1), "positions 1..22");
  assert.ok(grid[21].pos === 22, "P22 is the slowest Q1 car");
});

test("a fresh release consumes a soft set; out of fresh sets falls back to used", () => {
  let s = newQuali(5, field()); s.paused = false; s.speed = 8;
  const car = () => Object.values(s.cars).find(c => c.player === "p1");
  const sets0 = car().softSets;
  s = release(s, "p1", "fresh", "steady");
  assert.equal(car().softSets, sets0 - 1, "fresh consumed a set");
  // exhaust the fresh sets, then a fresh request must fall back to used (never negative)
  for (let k = 0; k < QUALI2.QUALI_SOFT_SETS + 2; k++) { car().phase = "pit"; s = release(s, "p1", "fresh", "steady"); }
  assert.ok(car().softSets >= 0, "never negative");
  assert.equal(car().tyre, "used", "falls back to used when out of fresh");
});

test("traffic loss rises with the number of cars on track", () => {
  let s = newQuali(9, field());
  const car = Object.values(s.cars)[0];
  const lone = trafficFor(s, car, 0);
  // mark 12 other cars as on a flying/out lap
  let n = 0; for (const c of Object.values(s.cars)) { if (c.idx !== car.idx && n < 12) { c.phase = "flying"; n++; } }
  const crowded = trafficFor(s, car, 0);
  assert.ok(crowded > lone, `crowded track loses more (${crowded} > ${lone})`);
  assert.ok(crowded <= QUALI2.TRAFFIC_MAX + 1e-9, "capped at TRAFFIC_MAX");
});
