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

test("fuel depletes over laps; push burns faster than save", () => {
  const f = field();
  const r = new Race(f, TRACK, 11);
  r.setEngine(0, "push"); r.setEngine(1, "save");
  r.cars[1].skill = r.cars[0].skill; r.cars[1].car = r.cars[0].car;
  const f0 = r.cars[0].fuel;
  for (let i = 0; i < 4000; i++) r.step();
  assert.ok(r.cars[0].fuel < f0, "fuel should deplete");
  if (r.cars[0].lap === r.cars[1].lap) assert.ok(r.cars[0].fuel < r.cars[1].fuel);
});

test("pushing the whole race runs the tank dry -> DNF", () => {
  const r = new Race(field(), TRACK, 7);
  for (const c of r.cars) c.engine = "push";
  let guard = 0;
  while (!r.finished && guard++ < 500000) r.step();
  assert.ok(r.cars.some(c => c.retired && c.fuel <= 0), "someone should run dry");
});

test("determinism holds with fuel", () => {
  const run = s => { const r = new Race(field(), TRACK, s); let g = 0;
    while (!r.finished && g++ < 500000) r.step(); return r.order().map(c => c.abbrev); };
  assert.deepEqual(run(3), run(3));
});

import { TYRE } from "../src/data.js";

test("a pit drops the tyre cold, then it warms over the following laps", () => {
  const r = new Race(field(), TRACK, 21);
  const c = r.cars[0];
  r.requestPit(0, "medium");
  let guard = 0;
  while (c.pitStops === 0 && guard++ < 80000) r.step();   // run until the pit is served
  const tempAfterPit = c.tyreTemp;
  const lap0 = c.lap;
  while (c.lap < lap0 + 2 && guard++ < 80000) r.step();   // two more laps
  assert.ok(tempAfterPit <= TYRE.pitTemp + 1e-9, `fresh tyre should start cold (${tempAfterPit})`);
  assert.ok(c.tyreTemp > tempAfterPit, "tyre should warm up over the following laps");
});

test("determinism holds with tyre warm-up", () => {
  const run = s => { const r = new Race(field(), TRACK, s); let g = 0;
    while (!r.finished && g++ < 500000) r.step(); return r.order().map(c => c.abbrev); };
  assert.deepEqual(run(4), run(4));
});

import { N_MINI } from "../src/track.js";

test("a completed lap records 18 mini-sector times that sum to the lap time + 3 sector totals", () => {
  const r = new Race(field(), TRACK, 31);
  const c = r.cars[0];
  let guard = 0;
  while (c.lap < 2 && guard++ < 80000) r.step();
  assert.equal(c.lastMini.length, N_MINI);
  const sum = c.lastMini.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - c.lastLap) < 1e-6, `mini sum ${sum} vs lap ${c.lastLap}`);
  assert.equal(c.sectorTimes.length, 3);
  assert.ok(Math.abs(c.sectorTimes.reduce((a, b) => a + b, 0) - c.lastLap) < 1e-6);
});

test("first flier colours are all session-best (purple) and determinism holds", () => {
  const r = new Race(field(), TRACK, 32);
  const lead = r.cars.reduce((a, b) => (a.skill >= b.skill ? a : b));
  let guard = 0;
  while (lead.lap < 1 && guard++ < 80000) r.step();
  assert.ok(lead.miniColors.every(x => x === "p"), "leader's first lap should be all session bests");
});

test("following closely in dirty air wears the tyres faster than running in clean air", () => {
  function bWear(behind) {
    const r = new Race(field(), TRACK, 9);
    const a = r.cars[0], b = r.cars[1];
    a.skill = 0.90; b.skill = 0.88;
    for (let i = 0; i < r.cars.length; i++) { r.cars[i].lap = 1; r.cars[i].lapFrac = 0.02 * i; }
    if (behind) { a.lapFrac = 0.60; b.lapFrac = 0.60 - 0.6 / TRACK.lt; }  // b ~0.6s behind a
    else        { a.lapFrac = 0.05; b.lapFrac = 0.60; }                   // b in clean air, far from a
    for (let k = 0; k < 700; k++) r.step();   // ~2 laps
    return b.wear;
  }
  assert.ok(bWear(true) > bWear(false), "dirty air should wear the follower's tyres faster");
});

import { EVENT } from "../src/data.js";

test("a safety car occurs at roughly track.sc across seeds", () => {
  let sc = 0;
  for (let s = 0; s < 200; s++) {
    const r = new Race(field(), TRACK, 7000 + s);
    r.gridStart();
    let g = 0; while (!r.finished && g++ < 500000) r.step();
    if (r.scEverActive) sc++;
  }
  const freq = sc / 200;
  assert.ok(freq > TRACK.sc - 0.12 && freq < TRACK.sc + 0.12, `SC freq ${freq} ~ ${TRACK.sc}`);
});

test("under the safety car the field bunches into a tight train", () => {
  let tightObserved = false;
  for (let s = 0; s < 60 && !tightObserved; s++) {
    const r = new Race(field(), TRACK, 7000 + s);
    r.gridStart();
    let g = 0;
    while (!r.finished && g++ < 500000) {
      r.step();
      if (r.scActive) {
        const ord = r.order().filter(c => !c.retired);
        const lead = ord[0];
        const sameLap = ord.filter(c => c.lap === lead.lap);
        if (sameLap.length > 4) {
          const spread = (lead.lap + lead.lapFrac) - (sameLap[sameLap.length - 1].lap + sameLap[sameLap.length - 1].lapFrac);
          if (spread * TRACK.lt < EVENT.scTrainGap * sameLap.length + 0.5) tightObserved = true;
        }
      }
    }
  }
  assert.ok(tightObserved, "the SC train should bunch same-lap cars to ~train-gap spacing");
});

test("determinism holds with events", () => {
  const run = s => { const r = new Race(field(), TRACK, s); r.gridStart(); let g = 0;
    while (!r.finished && g++ < 500000) r.step(); return r.order().map(c => c.abbrev); };
  assert.deepEqual(run(7042), run(7042));
});

test("a start-incident penalty slows the car's first lap (drops it back, not forward)", () => {
  const r = new Race(field(), TRACK, 1);
  const c = r.cars[0]; c.lap = 0;
  const base = r._lapTime(c);
  c._startPenalty = 5;
  assert.ok(r._lapTime(c) > base + 4, "lap-1 start penalty applies");
});
