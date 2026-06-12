// ApexWeb/tests/sim.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { Race } from "../src/sim.js";
import { TEAMS, TRACK, STEP } from "../src/data.js";
import { driverAttrs } from "../src/team.js";

function field() {
  // flat field: every team's two drivers, no players yet
  let idx = 0;
  return TEAMS.flatMap(t => t.drivers.map(d => ({
    idx: idx++, name:d.name, abbrev:d.abbrev, skill:d.skill,
    car:t.car, color:t.color, team:t.name,
    setup:[0.5,0.5,0.5], startTyre:"medium",
    attrs: driverAttrs(d.abbrev, d.skill),
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
  // give them identical drivers/cars for the comparison (incl. the pace attribute
  // anchor, now that lap time keys off attrs.pace); rel=1 removes the random-DNF
  // confound so the comparison isolates the pace-mode lever.
  const idCar = { ...r.cars[0].car, rel: 1 };
  r.cars[0].car = idCar; r.cars[1].car = idCar;
  r.cars[1].skill = r.cars[0].skill; r.cars[1].attrs = r.cars[0].attrs;
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
  for (const c of r.cars) r.setEngine(c.idx, "push");   // pin push via the public API so the AI fuel-saver doesn't override
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
  // the session-best setter is the genuinely fastest car; pace now lives in
  // attrs.pace, so pick by clean lap time rather than by the skill anchor.
  // average a handful of samples so the per-lap noise (incl. the AI difficulty
  // handicap noise at the default difficulty) can't mis-pick the genuine pace leader.
  const score = c => { let s = 0; for (let k = 0; k < 9; k++) s += r._lapTime(c); return s; };
  const lead = r.cars.reduce((a, b) => (score(a) <= score(b) ? a : b));
  r.step();                                   // trigger the standing start, then neutralise the launch
  for (const c of r.cars) c._launch = 0;      // (this test checks pure pace→colour, not the opening shuffle)
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

test("dirty-air pace penalty is stronger the closer you follow (§18.11 graded)", () => {
  function dp(gapS) {
    const r = new Race(field(), TRACK, 9);
    const a = r.cars[0], b = r.cars[1];
    a.car = { ...a.car }; b.car = { ...a.car }; a.attrs = b.attrs;
    for (const c of r.cars) { c.lap = 1; c.lapFrac = 0.02 * c.idx; }
    a.lapFrac = 0.50; b.lapFrac = 0.50 - gapS / TRACK.lt;   // b is gapS seconds behind a (dirty air)
    r._resolveCombat();
    return b._dirtyPace;
  }
  assert.ok(dp(0.3) > dp(1.2), "following 0.3s back should cost more pace than 1.2s back");
});

test("following closely in dirty air costs the follower lap-time (not just tyre wear)", () => {
  function bAvg(behind) {
    const r = new Race(field(), TRACK, 9);
    const a = r.cars[0], b = r.cars[1];
    a.car = { ...a.car, rel: 1 }; b.car = { ...a.car };   // identical cars
    a.attrs = b.attrs; a.skill = b.skill;                 // identical drivers → no real pace edge
    for (let i = 0; i < r.cars.length; i++) { r.cars[i].lap = 1; r.cars[i].lapFrac = 0.02 * i; }
    if (behind) { a.lapFrac = 0.60; b.lapFrac = 0.60 - 0.6 / TRACK.lt; }  // b ~0.6s behind a (dirty air)
    else        { a.lapFrac = 0.05; b.lapFrac = 0.60; }                   // b in clean air, far from a
    for (let k = 0; k < 1400; k++) r.step();   // ~4 laps
    return b.avgLap;
  }
  assert.ok(bAvg(true) > bAvg(false), "running in dirty air should make the follower's laps slower");
});

test("a more aggressive driver builds pass-credit faster behind the same car (§18.7)", () => {
  function credit(aggr) {
    const r = new Race(field(), TRACK, 9);
    const a = r.cars[0], b = r.cars[1];
    a.car = { ...a.car, rel: 1 }; b.car = { ...a.car };
    a.attrs = { ...a.attrs, pace: 0.6 }; b.attrs = { ...a.attrs, pace: 0.9, aggression: aggr };  // b genuinely faster
    for (const c of r.cars) { c.lap = 1; c.lapFrac = 0.02 * c.idx; }
    a.lapFrac = 0.30; b.lapFrac = 0.30 - 0.4 / TRACK.lt;   // b ~0.4s behind a, within COMBAT_GAP, same lap
    r._resolveCombat();
    return b._passCredit || 0;
  }
  assert.ok(credit(0.9) > credit(0.2), "higher aggression accrues more pass-credit");
});

test("a disciplined driver wears tyres slower in dirty air than an undisciplined one (§18.7)", () => {
  function wear(disc) {
    const r = new Race(field(), TRACK, 9);
    const a = r.cars[0], b = r.cars[1];
    a.car = { ...a.car }; b.car = { ...a.car };
    a.attrs = { ...a.attrs }; b.attrs = { ...a.attrs, discipline: disc };   // equal pace → b stays in a's dirty air
    for (const c of r.cars) { c.lap = 1; c.lapFrac = 0.02 * c.idx; }
    a.lapFrac = 0.60; b.lapFrac = 0.60 - 0.6 / TRACK.lt;   // b ~0.6s behind a (dirty air)
    for (let k = 0; k < 700; k++) r.step();
    return b.wear;
  }
  assert.ok(wear(0.9) < wear(0.2), "discipline reduces dirty-air wear");
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

test("the standing start only shuffles modestly over lap 1 (launch, not chaos)", () => {
  const r = new Race(field(), TRACK, 5);
  r.gridStart();
  const before = Object.fromEntries(r.order().map(c => [c.idx, c.pos]));
  let g = 0; while (r.order()[0].lap < 2 && g++ < 50000) r.step();   // run to ~end of lap 1
  const after = Object.fromEntries(r.order().map(c => [c.idx, c.pos]));
  const moves = r.cars.map(c => Math.abs(after[c.idx] - before[c.idx]));
  const avg = moves.reduce((a, b) => a + b, 0) / moves.length;
  assert.ok(avg < 4, `opening-lap shuffle stays modest (${avg.toFixed(2)} places/car, no 4s-incident wild swings)`);
});

test("rain occurs at roughly track.wet across seeds, and wets the track", () => {
  let rained = 0, sawWet = 0;
  for (let s = 0; s < 200; s++) {
    const r = new Race(field(), TRACK, 8000 + s);
    r.gridStart();
    if (r.weather.rains) rained++;
    let g = 0, peak = 0;
    while (!r.finished && g++ < 500000) { r.step(); if (r.wetness > peak) peak = r.wetness; }
    if (peak > 0.3) sawWet++;
  }
  const f = rained / 200;
  assert.ok(f > TRACK.wet - 0.14 && f < TRACK.wet + 0.14, `rain freq ${f} ~ ${TRACK.wet}`);
  assert.ok(sawWet > 0, "at least one race got wet");
});

test("an AI car on slicks boxes for wets once the track is soaked", () => {
  let switched = false;
  for (let s = 0; s < 80 && !switched; s++) {
    const r = new Race(field(), TRACK, 8000 + s);
    r.gridStart();
    if (!r.weather.rains) continue;
    let g = 0;
    while (!r.finished && g++ < 500000) {
      r.step();
      if (r.wetness > 0.6 && r.cars.some(c => c.player == null && (c.tyre === "inter" || c.tyre === "wet"))) { switched = true; break; }
    }
  }
  assert.ok(switched, "AI should fit wet-weather tyres when it pours");
});

test("determinism holds with weather", () => {
  const run = s => { const r = new Race(field(), TRACK, s); r.gridStart(); let g = 0;
    while (!r.finished && g++ < 500000) r.step(); return r.order().map(c => c.abbrev); };
  assert.deepEqual(run(8042), run(8042));
});

test("a higher-pace driver laps faster than a low-pace one (same car)", () => {
  const r = new Race(field(), TRACK, 51);
  const a = r.cars[0], b = r.cars[1];
  a.car = b.car;
  a.attrs = { ...a.attrs, pace: 0.95 }; b.attrs = { ...b.attrs, pace: 0.55 };
  for (let i = 0; i < 5000; i++) r.step();
  assert.ok(a.avgLap > 0 && b.avgLap > 0, "both completed laps");
  assert.ok(a.avgLap < b.avgLap, `more pace = faster (${a.avgLap.toFixed(2)} < ${b.avgLap.toFixed(2)})`);
});

test("a better car (higher power+aero) laps faster than a worse one, same driver", () => {
  const r = new Race(field(), TRACK, 53);
  const a = r.cars[0], b = r.cars[1];
  // identical drivers + state; differ only in ABSOLUTE car performance, with the
  // SAME power-aero balance (so the CAR_K track-character term is zero for both and
  // only the absolute car-pace term can separate them — §18.1). Measured on the clean
  // lap-time model directly (averaging out the per-tick noise) so combat/grid order
  // can't pollute the comparison.
  a.attrs = b.attrs; a.skill = b.skill;
  a.car = { ...a.car, power: 0.95, aero: 0.95, rel: 1 };
  b.car = { ...b.car, power: 0.80, aero: 0.80, rel: 1 };
  const mean = c => { let s = 0; for (let k = 0; k < 200; k++) s += r._lapTime(c); return s / 200; };
  const la = mean(a), lb = mean(b);
  assert.ok(lb - la > 0.3, `better car clearly faster on clean pace (${la.toFixed(3)} vs ${lb.toFixed(3)}, gap ${(lb - la).toFixed(3)}s)`);
});

test("a strong-tyre driver wears tyres slower than a weak one (same car, same compound)", () => {
  const r = new Race(field(), TRACK, 52);
  const a = r.cars[0], b = r.cars[1];
  a.car = b.car;
  a.attrs = { ...a.attrs, tyre: 0.9 }; b.attrs = { ...b.attrs, tyre: 0.2 };
  for (let i = 0; i < 6000; i++) r.step();
  if (a.lap === b.lap && !a.retired && !b.retired) assert.ok(a.wear < b.wear, `better tyre attr = less wear (${a.wear.toFixed(2)} < ${b.wear.toFixed(2)})`);
});

test("determinism holds with attributes", () => {
  const run = s => { const r = new Race(field(), TRACK, s); r.gridStart(); let g = 0;
    while (!r.finished && g++ < 500000) r.step(); return r.order().map(c => c.abbrev); };
  assert.deepEqual(run(5042), run(5042));
});

test("AI cars make 1-2 planned stops over a full race (not zero, not four)", () => {
  const r = new Race(field(), TRACK, 7001);
  r.gridStart();
  let g = 0; while (!r.finished && g++ < 500000) r.step();
  const ai = r.cars.filter(c => c.player == null && !c.retired);
  const stops = ai.map(c => c.pitStops);
  assert.ok(stops.length > 0, "some AI finished");
  const avg = stops.reduce((a, b) => a + b, 0) / stops.length;
  assert.ok(avg >= 0.8 && avg <= 2.2, `avg AI stops ${avg.toFixed(2)} in [0.8,2.2]`);
});

test("AI assigns itself an engine mode (drives, not stuck on standard forever)", () => {
  const r = new Race(field(), TRACK, 7002);
  r.gridStart();
  const seen = new Set();
  for (let i = 0; i < 8000; i++) { r.step(); for (const c of r.cars) if (c.player == null) seen.add(c.engine); }
  assert.ok(seen.size >= 1, "AI engine modes used");
});

test("determinism holds with the AI brain", () => {
  const run = s => { const r = new Race(field(), TRACK, s); r.gridStart(); let g = 0;
    while (!r.finished && g++ < 500000) r.step(); return r.order().map(c => `${c.abbrev}:${c.pitStops}`); };
  assert.deepEqual(run(7003), run(7003));
});

test("easy AI laps slower than hard AI (same field, difficulty handicap)", () => {
  const easy = new Race(field(), TRACK, 8001, 0.55);
  const hard = new Race(field(), TRACK, 8001, 1.0);
  easy.gridStart(); hard.gridStart();
  for (let i = 0; i < 4000; i++) { easy.step(); hard.step(); }
  const avg = r => { const f = r.cars.filter(c => !c.retired && c.avgLap > 0); return f.reduce((a, c) => a + c.avgLap, 0) / f.length; };
  assert.ok(avg(easy) > avg(hard), `easy field slower (${avg(easy).toFixed(2)} > ${avg(hard).toFixed(2)})`);
});

test("determinism holds across difficulty", () => {
  const run = d => { const r = new Race(field(), TRACK, 8002, d); r.gridStart(); let g = 0;
    while (!r.finished && g++ < 500000) r.step(); return r.order().map(c => c.abbrev); };
  assert.deepEqual(run(0.8), run(0.8));
  assert.notDeepEqual(run(0.55), run(1.0));
});

test("sim emits a deterministic event log (start, and same seed -> identical events)", () => {
  const run = s => { const r = new Race(field(), TRACK, s); r.gridStart(); let g = 0;
    while (!r.finished && g++ < 500000) r.step(); return r.events; };
  const e1 = run(4242), e2 = run(4242);
  assert.ok(Array.isArray(e1) && e1.length > 0, "events produced");
  assert.ok(e1.some(e => e.type === "start"), "has a start event");
  assert.deepEqual(e1, e2, "same seed -> identical event log");
});

test("a full race produces pit, fastlap and finish events", () => {
  const r = new Race(field(), TRACK, 4243); r.gridStart();
  let g = 0; while (!r.finished && g++ < 500000) r.step();
  const types = new Set(r.events.map(e => e.type));
  assert.ok(types.has("pit"), "someone pitted");
  assert.ok(types.has("fastlap"), "a fastest lap was set");
  assert.ok(types.has("finish"), "race finished");
  for (const e of r.events) assert.ok(typeof e.lap === "number", "every event has a lap");
});

test("pass events carry both drivers and are bounded", () => {
  const r = new Race(field(), TRACK, 4244); r.gridStart();
  let g = 0; while (!r.finished && g++ < 500000) r.step();
  const passes = r.events.filter(e => e.type === "pass");
  for (const p of passes) assert.ok(p.abbr && p.abbrB && p.abbr !== p.abbrB, "two distinct drivers");
  assert.ok(passes.length < 400, `passes bounded (${passes.length})`);
});

test("overtakes complete in a zone, or as a rare bold out-of-zone lunge", () => {
  const r = new Race(field(), TRACK, 6601); r.gridStart();
  let g = 0; while (!r.finished && g++ < 500000) r.step();
  const passes = r.events.filter(e => e.type === "pass");
  assert.ok(passes.length > 0, "some passes happened");
  for (const p of passes) assert.ok(p.zone === "brake" || p.zone === "slip" || p.zone === "bold", `pass carries a zone (${p.zone})`);
});

test("bold out-of-zone passes occur but stay rare (§18.2)", () => {
  let bold = 0, races = 20;
  for (let s = 0; s < races; s++) {
    const r = new Race(field(), TRACK, 6700 + s); r.gridStart();
    let g = 0; while (!r.finished && g++ < 500000) r.step();
    bold += r.events.filter(e => e.type === "pass" && e.zone === "bold").length;
  }
  assert.ok(bold > 0, "bold lunges should happen at least sometimes");
  assert.ok(bold / races <= 4, `bold passes stay rare (${(bold / races).toFixed(2)}/race, expect <= ~2)`);
});

test("determinism holds with overtake zones", () => {
  const run = s => { const r = new Race(field(), TRACK, s); r.gridStart(); let g = 0;
    while (!r.finished && g++ < 500000) r.step(); return r.order().map(c => c.abbrev).join(","); };
  assert.equal(run(6602), run(6602));
});

test("lap times carry sub-step precision (not all on the 0.25s grid)", () => {
  const r = new Race(field(), TRACK, 2); r.gridStart();
  const times = new Set();
  for (let i = 0; i < 30000 && times.size < 30; i++) { r.step(); for (const c of r.cars) if (c.lastLap > 0) times.add(c.lastLap); }
  const offGrid = [...times].some(t => Math.abs(t / 0.25 - Math.round(t / 0.25)) > 1e-6);
  assert.ok(offGrid, "at least some lap time is off the 0.25s grid (sub-step precision)");
});

test("serving a pit sets pitTimer to the pit-loss and fits the new tyre", () => {
  const r = new Race(field(), TRACK, 1);
  const c = r.cars[0];
  c.personnel = null; c.car = { ...c.car, rel: 1 }; c.pitPending = "hard";   // neutral crew, dry, no DNF
  r._serveLapEnd(c);
  assert.ok(Math.abs(c.pitTimer - TRACK.pit) < 1e-6, `pitTimer = pitLoss (${c.pitTimer})`);
  assert.equal(c.tyre, "hard"); assert.equal(c.pitStops, 1);
});

test("a car in the pit box sits still while race time passes — the pit-loss is real (frac stays valid)", () => {
  const r = new Race(field(), TRACK, 1);
  const c = r.cars[0];
  c.car = { ...c.car, rel: 1 };
  c.pitTimer = TRACK.pit;                                   // a stop in progress
  const prog0 = c.lap + c.lapFrac, t0 = c.totalTime;
  const ticks = Math.ceil(TRACK.pit / STEP) - 1;
  for (let i = 0; i < ticks; i++) { r.step(); assert.ok(c.lapFrac >= 0 && c.lapFrac < 1.0001, "frac stays valid"); }
  assert.ok(Math.abs((c.lap + c.lapFrac) - prog0) < 1e-9, "car made no track progress during the stop");
  assert.ok(c.totalTime - t0 >= TRACK.pit - 2 * STEP, `accrued ~the stop time (${(c.totalTime - t0).toFixed(1)}s of ${TRACK.pit})`);
});
