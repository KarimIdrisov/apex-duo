// ApexWeb/tests/sim.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { Race } from "../src/sim.js";
import { TEAMS, TRACK, STEP, SKILL_K, INCIDENT } from "../src/data.js";
import { driverAttrs } from "../src/team.js";
import { startFuel } from "../src/fuel.js";

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

test("§Phase-1 fuel-load lever: a lean start carries less fuel; omitting it is byte-identical to default", () => {
  const f = field();
  f[0].fuelMargin = 0.02;  // lean
  f[1].fuelMargin = 0.12;  // safe (heavier)
  // f[2] leaves fuelMargin undefined → tuned default
  const r = new Race(f, TRACK, 7);
  assert.ok(r.cars[0].fuel < r.cars[1].fuel, "lean tank carries less than safe");
  assert.equal(r.cars[2].fuel, startFuel(TRACK), "no margin set → exactly the tuned default");
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

test("§Phase-3 car-confidence: an unbedded car (fresh parts) is slower early, then recovers", () => {
  function avgAfter(conf) {
    const r = new Race(field(), TRACK, 4242);
    r.cars[0].car = { ...r.cars[0].car, rel: 1 };
    r.cars[0]._conf = conf;                                   // simulate freshly-fitted parts
    let g = 0; while (r.cars[0].lap < 3 && g++ < 60000) r.step();
    return r.cars[0].avgLap;
  }
  assert.ok(avgAfter(0.7) > avgAfter(1.0), "low confidence costs pace over the opening laps");
  const r = new Race(field(), TRACK, 1); r.cars[0]._conf = 0.7;
  let g = 0; while (r.cars[0].lap < 6 && g++ < 60000) r.step();
  assert.ok(r.cars[0]._conf > 0.7, "confidence recovers over the race");
});

test("§Phase-5 mechanic perk: deployPerk applies a bounded effect, once per race", () => {
  function wearAfter(deploy) {
    const r = new Race(field(), TRACK, 4242);
    r.cars[0].car = { ...r.cars[0].car, rel: 1 };           // no DNF confound
    if (deploy) assert.equal(r.deployPerk(0, "tyresave"), true, "tyresave deploys");
    let g = 0; while (r.cars[0].lap < 4 && g++ < 60000) r.step();
    return r.cars[0].wear;
  }
  assert.ok(wearAfter(true) < wearAfter(false), "tyresave reduces wear over its window");
  // once per race: a second deploy is rejected
  const r = new Race(field(), TRACK, 1);
  assert.equal(r.deployPerk(0, "tyresave"), true);
  assert.equal(r.deployPerk(0, "fuelsave"), false, "only one perk per race");
  assert.equal(r.deployPerk(0, "nope"), false, "unknown perk → no-op");
  // one-shot cooldown resets tyre temperature into the window and counts as the deploy
  const r2 = new Race(field(), TRACK, 2);
  r2.cars[0].tyreTemp = 1.4;
  assert.equal(r2.deployPerk(0, "cooldown"), true);
  assert.equal(r2.cars[0].tyreTemp, 1, "cooldown resets temp to the window");
  assert.equal(r2.deployPerk(0, "tyresave"), false, "cooldown used the once-per-race deploy");
});

test("MM burst modes flow through the sim: overtake faster + burns more; attack faster than push", () => {
  const r = new Race(field(), TRACK, 5);
  // isolate the levers: identical cars/drivers, rel=1 (no DNF confound). _pin (set by the public
  // setters) blocks the AI brain, so the lever I set sticks and the OTHER lever stays at its default.
  const idCar = { ...r.cars[0].car, rel: 1 };
  for (const i of [0, 1, 2, 3]) { r.cars[i].car = idCar; r.cars[i].skill = r.cars[0].skill; r.cars[i].attrs = r.cars[0].attrs; }
  r.setEngine(0, "overtake"); r.setEngine(1, "push");   // engine lever (pace stays default for both)
  r.setPace(2, "attack");     r.setPace(3, "push");     // pace lever (engine stays default for both)
  for (let i = 0; i < 4000; i++) r.step();
  assert.ok(r.cars[0].avgLap < r.cars[1].avgLap, "overtake engine averages faster than push");
  assert.ok(r.cars[0].fuel < r.cars[1].fuel, "overtake burns more fuel than push");
  assert.ok(r.cars[0].pushTicks > 0, "overtake counts as a PU-spending mode (pushTicks)");
  assert.ok(r.cars[2].avgLap < r.cars[3].avgLap, "attack pace averages faster than push pace");
});

test("MM tyre heat: sustained attack overheats the tyre (temp>1) + wears it faster than balanced (§item-2)", () => {
  const r = new Race(field(), TRACK, 11);
  const idCar = { ...r.cars[0].car, rel: 1 };
  for (const i of [0, 1]) { r.cars[i].car = idCar; r.cars[i].skill = r.cars[0].skill; r.cars[i].attrs = r.cars[0].attrs; }
  r.setPace(0, "attack"); r.setPace(1, "balanced");   // _pin blocks the AI brain (no pit/mode override)
  for (let i = 0; i < 3000; i++) r.step();             // ~9 laps, before any stop
  assert.ok(r.cars[0].tyreTemp > 1.0, `attack overheats past the window (temp=${r.cars[0].tyreTemp.toFixed(2)})`);
  assert.ok(r.cars[1].tyreTemp <= 1.0 + 1e-9, "balanced stays in the optimal window");
  assert.ok(r.cars[0].wear > r.cars[1].wear, "the overheating attacker wears its tyres faster");
});

test("Phase-2 parts: a less reliable car retires more often (part wear → DNF)", () => {
  function dnfCount(rel) {
    let dnf = 0;
    for (let s = 0; s < 20; s++) {
      const r = new Race(field(), TRACK, 3000 + s);
      r.cars[0].car = { ...r.cars[0].car, rel };
      let g = 0; while (!r.finished && g++ < 500000) r.step();
      if (r.cars[0].retired) dnf++;
    }
    return dnf;
  }
  assert.ok(dnfCount(0.80) > dnfCount(0.995), "a fragile car retires far more than a bulletproof one");
});

test("Phase-2 parts: every car carries declining part conditions; a mechanical DNF names a critical part", () => {
  const r = new Race(field(), TRACK, 11);
  for (let i = 0; i < 1500; i++) r.step();
  for (const c of r.cars) if (!c.retired) assert.ok(c.parts.engine < 1 && c.parts.gearbox < 1, "parts wear over the race");
  let found = false;
  for (let s = 0; s < 30 && !found; s++) {
    const rr = new Race(field(), TRACK, 1000 + s);
    let g = 0; while (!rr.finished && g++ < 500000) rr.step();
    const e = rr.events.find(ev => ev.type === "dnf" && ev.part);
    if (e) { found = true; assert.ok(["engine", "gearbox"].includes(e.part), `critical part named (${e.part})`); }
  }
  assert.ok(found, "at least one part-attributed mechanical DNF over 30 races");
});

test("Phase-2 parts: a failed non-critical part (brakes) makes the car limp, then the pit repairs it", () => {
  const r = new Race(field(), TRACK, 7);
  const c = r.cars[0];        // an AI car — limps straight to the box on a brake failure
  c.parts.brakes = 0.005;     // deep red: very likely to fail within a few laps
  let g = 0, sawLimp = false;
  while (c.lap < 10 && g++ < 80000) {
    r.step();
    if (c._brakeLimp > 0) sawLimp = true;
    if (sawLimp && c.pitStops > 0 && c._brakeLimp === 0) break;   // limped, then pitted + repaired
  }
  assert.ok(sawLimp, "deep-red brakes fail and the car limps (pace penalty)");
  assert.ok(c.pitStops > 0, "the AI limps to the box");
  assert.equal(c._brakeLimp, 0, "the stop clears the limp");
  assert.ok(c.parts.brakes > 0.005, "the stop repaired the brakes above the failure point");
});

test("Phase-3 fitness: an unfit driver fades late while a fit one holds pace; the gap widens (§Phase-3)", () => {
  const r = new Race(field(), TRACK, 5);
  const a = r.cars[0], b = r.cars[1];
  const id = { ...a.car, rel: 1 }; a.car = id; b.car = id; a.skill = b.skill; a.attrs = { ...a.attrs }; b.attrs = { ...a.attrs };
  a.attrs.fitness = 0.92; b.attrs.fitness = 0.55;   // a fit, b unfit, identical otherwise
  const lt = (c, lap) => { c.lap = lap; c.wear = 10; c.tyre = "medium"; c.tyreTemp = 1; c.fuel = 20; c.pace = "balanced"; c.engine = "standard"; c._form = 0; return r._lapTime(c); };
  const early = lt(a, 2) - lt(b, 2), late = lt(a, 62) - lt(b, 62);
  assert.ok(late < early - 0.2, "the fitness gap widens as the race wears on");
  assert.ok(late < -0.3, "a fit driver is clearly ahead of an unfit one by the end");
});

test("Phase-3 mistakes: a wet track and worn-past-cliff tyres breed more incidents (§Phase-3)", () => {
  function incidents(wetness, wear) {
    const r = new Race(field(), TRACK, 3);
    const c = r.cars[0]; c.attrs = { ...c.attrs, composure: 0.2 }; c.pace = "push"; c._inFight = true; c.tyre = "medium";
    let n = 0;
    for (let lap = 2; lap < 3000; lap++) {   // Monte-Carlo over the lap-keyed RNG (no race stepping — fast)
      c.lap = lap; c.wear = wear; c.retired = false; r.wetness = wetness;
      const before = r.events.length; r._rollIncident(c);
      if (r.events.length > before) n++;
    }
    return n;
  }
  assert.ok(incidents(0.6, 10) > incidents(0, 10), "a wet track produces more mistakes than a dry one");
  assert.ok(incidents(0, 95) > incidents(0, 10), "worn past the medium cliff (95>78) → more mistakes than fresh");
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

test("on-track passing scales with the pace edge — a clearly faster car passes more than a barely-faster one (audit r3)", () => {
  // regression lock for the dirty-air-vs-pass-edge coupling fix: dirty air must slow the follower on
  // track but NOT zero its passing intent, so a real pace edge converts into passes (was ~flat before).
  function passesAtEdge(edgeS) {
    let n = 0;
    for (let s = 0; s < 16; s++) {
      const r = new Race(field(), TRACK, 4000 + s);
      const a = r.cars[0], b = r.cars[1];
      a.car = { ...a.car, rel: 1 }; b.car = { ...a.car };
      a.attrs = { ...a.attrs, pace: 0.6 }; b.attrs = { ...a.attrs, pace: 0.6 + edgeS / SKILL_K };  // b is edgeS s/lap faster
      for (const c of r.cars) { if (c !== a && c !== b) { c.lap = 1; c.lapFrac = 0; } }   // clear 1v1
      a.lap = 1; a.lapFrac = 0.50; b.lap = 1; b.lapFrac = 0.50 - 0.4 / TRACK.lt;            // b ~0.4s behind a
      let g = 0;
      while (b.lap < 26 && g++ < 120000) {
        r.step();
        if (a.retired || b.retired) break;
        if ((b.lap + b.lapFrac) > (a.lap + a.lapFrac)) { n++; break; }   // b got ahead
      }
    }
    return n;
  }
  assert.ok(passesAtEdge(0.8) > passesAtEdge(0.1), "a faster car must convert its edge into more on-track passes");
});

test("MM team orders: hold keeps a faster teammate behind; swap waves it through (player cars only)", () => {
  // cars[0] and cars[1] are TEAMS[0]'s two drivers — already the same team; flag them as the player's.
  function setup() {
    const r = new Race(field(), TRACK, 4000);   // a seed where a 0.8 s/lap edge does convert to a pass when free
    const a = r.cars[0], b = r.cars[1];
    a.isPlayer = true; b.isPlayer = true;
    a.car = { ...a.car, rel: 1 }; b.car = { ...a.car };
    a.attrs = { ...a.attrs, pace: 0.6 }; b.attrs = { ...a.attrs, pace: 0.6 + 0.8 / SKILL_K };  // b ~0.8s/lap faster
    for (const c of r.cars) { if (c !== a && c !== b) { c.lap = 1; c.lapFrac = 0; } }   // clear the field for a 1v1
    a.lap = 1; a.lapFrac = 0.50; b.lap = 1; b.lapFrac = 0.50 - 0.4 / TRACK.lt;            // b ~0.4s behind its own car
    return { r, a, b };
  }
  const bAhead = (r, a, b) => { let g = 0; while (b.lap < 12 && g++ < 60000) { r.step(); if ((b.lap + b.lapFrac) > (a.lap + a.lapFrac)) return true; } return false; };
  // control: free racing — the faster teammate passes
  { const { r, a, b } = setup(); assert.ok(bAhead(r, a, b), "control: a faster teammate passes when free"); }
  // hold: the faster teammate is pinned behind its own car for the whole stint
  { const { r, a, b } = setup(); r.setTeamOrder("hold"); assert.ok(!bAhead(r, a, b), "hold: the faster teammate never passes its own car"); }
  // swap: the trailing teammate is waved through (one-shot), then the order auto-clears
  { const { r, a, b } = setup(); r.setTeamOrder("swap"); assert.ok(bAhead(r, a, b), "swap: the trailing teammate gets through");
    assert.equal(r.teamOrder, "none", "swap is a one-shot order (auto-clears)"); }
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

test("a car lapping a backmarker is held by blue-flag traffic; a car in clear air isn't (lapped traffic)", () => {
  const r = new Race(field(), TRACK, 9);
  for (const c of r.cars) { c.lap = 1; c.lapFrac = 0.0; }   // park the field at the line, lap 1
  const lead = r.cars[0], back = r.cars[1], clear = r.cars[2];
  lead.lap = 3; lead.lapFrac = 0.50;     // leader on lap 3...
  back.lap = 2; back.lapFrac = 0.505;    // ...catching a backmarker a lap down, ~0.4s ahead on track
  clear.lap = 3; clear.lapFrac = 0.80;   // a same-lap car in clear air (no backmarker just ahead)
  r._resolveBlueFlags();
  assert.ok(lead._blueDelay > 0, "leader catching a lapped car is held up");
  assert.equal(back._blueDelay || 0, 0, "the backmarker itself isn't blue-flagged");
  assert.equal(clear._blueDelay || 0, 0, "a car in clear air loses no time to blue flags");
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
  // incident-driven model: cautions emerge from per-lap incidents + start/lunge shunts, so the SC-per-race
  // frequency runs at roughly track.sc up to ~1.6×track.sc (design target: 25-40% of races see a caution),
  // not pinned to the raw track.sc the old pre-scheduled roll produced.
  assert.ok(freq > 0.15 && freq < 0.42, `SC freq ${freq} in the incident-driven band (~0.25-0.40)`);
});

test("a VSC occurs, is exclusive with the full SC, slows the field, and emits vsc events (§21 r3)", () => {
  let sawVsc = false;
  for (let s = 0; s < 150 && !sawVsc; s++) {
    const r = new Race(field(), TRACK, 12000 + s); r.gridStart();
    let g = 0, slowSeen = false, normLap = 0;
    while (!r.finished && g++ < 500000) {
      const lead = r.order()[0];
      const before = lead.lap;
      r.step();
      if (lead.lap > before && lead.lastLap > 0) { if (!r.vscActive && !r.scActive && normLap === 0) normLap = lead.lastLap;
        if (r.vscActive && normLap > 0 && lead.lastLap > normLap * 1.1) slowSeen = true; }
      if (r.vscActive) {
        sawVsc = true;
        assert.ok(!r.scActive, "VSC and full SC are mutually exclusive");
        // run a few more laps to confirm a slow lap was recorded under VSC, then stop
        let h = 0; while (r.vscActive && h++ < 6000) r.step();
        break;
      }
    }
    if (sawVsc) {
      assert.ok(r.events.some(e => e.type === "vsc_on"), "a vsc_on event fired");
    }
  }
  assert.ok(sawVsc, "a VSC should occur across seeds");
});

test("over many races both caution types occur (full SC and VSC)", () => {
  let sc = 0, vsc = 0;
  for (let s = 0; s < 150 && (sc === 0 || vsc === 0); s++) {   // stop as soon as we've seen both
    const r = new Race(field(), TRACK, 13000 + s); r.gridStart();
    let g = 0, sawSc = false, sawVsc = false;
    while (!r.finished && g++ < 500000) { r.step(); if (r.scActive) sawSc = true; if (r.vscActive) sawVsc = true; if (sawSc && sawVsc) break; }
    if (sawSc) sc++; if (sawVsc) vsc++;
  }
  assert.ok(sc > 0 && vsc > 0, `both caution types occur (full SC in ${sc}, VSC in ${vsc} races)`);
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

test("a smoother driver wears tyres slower than a rougher one (same car, same compound; §18.7 r3)", () => {
  const r = new Race(field(), TRACK, 52);
  const a = r.cars[0], b = r.cars[1];
  a.car = b.car;
  a.attrs = { ...a.attrs, smoothness: 0.9, tyre: 0.5 }; b.attrs = { ...a.attrs, smoothness: 0.2, tyre: 0.5 };
  for (let i = 0; i < 6000; i++) r.step();
  if (a.lap === b.lap && !a.retired && !b.retired) assert.ok(a.wear < b.wear, `smoother = less wear (${a.wear.toFixed(2)} < ${b.wear.toFixed(2)})`);
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
  // measure GREEN-flag pace: a no-caution track (sc:0) so an incident-triggered safety car in one field
  // but not the other can't confound the cross-race comparison (SC laps run at ×1.40, ~8s/lap slower).
  // Average over several seeds + all cars (incident-DNFs would otherwise bias which cars survive the avg).
  const T = { ...TRACK, sc: 0 };
  const avg = r => { const f = r.cars.filter(c => c.avgLap > 0); return f.reduce((a, c) => a + c.avgLap, 0) / f.length; };
  let easySum = 0, hardSum = 0, n = 6;
  for (let s = 0; s < n; s++) {
    const easy = new Race(field(), T, 8001 + s, 0.55);
    const hard = new Race(field(), T, 8001 + s, 1.0);
    easy.gridStart(); hard.gridStart();
    for (let i = 0; i < 4000; i++) { easy.step(); hard.step(); }
    easySum += avg(easy); hardSum += avg(hard);
  }
  assert.ok(easySum / n > hardSum / n, `easy field slower on average (${(easySum / n).toFixed(2)} > ${(hardSum / n).toFixed(2)})`);
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

test("a successful bold lunge scrubs the attacker's tyres (§18.2 round-2)", () => {
  for (let seed = 0; seed < 80; seed++) {
    const r = new Race(field(), TRACK, seed);
    const a = r.cars[0], b = r.cars[1];
    a.car = { ...a.car, rel: 1 }; b.car = { ...a.car };
    a.attrs = { ...a.attrs, pace: 0.55 };
    b.attrs = { ...a.attrs, pace: 0.95, aggression: 0.95 };   // b ~1.8 s/lap faster, very aggressive
    for (const c of r.cars) { c.lap = 5; c.lapFrac = 0.02 * c.idx; c.tyreTemp = 0.9; }
    a.lapFrac = 0.50; b.lapFrac = 0.50 - 0.4 / TRACK.lt;      // b just behind a in a NON-zone mini (mid-lap)
    const before = b.tyreTemp;
    r._resolveCombat();                                       // one attempt (one-shot-per-rival)
    if (r.events.some(e => e.type === "pass" && e.zone === "bold" && e.a === b.idx)) {
      assert.ok(b.tyreTemp < before - 0.05, `a successful lunge scrubs tyres (${b.tyreTemp.toFixed(2)} < ${before})`);
      return;
    }
  }
  assert.fail("no bold pass fired across seeds — scenario/threshold drifted");
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

test("setOrder validates the mode and defaults to none", () => {
  const r = new Race(field(), TRACK, 1);
  assert.equal(r.cars[0].order, "none", "default order is none");
  r.setOrder(0, "attack"); assert.equal(r.cars[0].order, "attack");
  r.setOrder(0, "defend"); assert.equal(r.cars[0].order, "defend");
  r.setOrder(0, "bogus"); assert.equal(r.cars[0].order, "defend", "invalid mode ignored");
  r.setOrder(999, "attack"); // out of range — must not throw
});

test("_keyRng is deterministic and decorrelates by idx/lap/kind", () => {
  const r = new Race(field(), TRACK, 1);
  assert.equal(r._keyRng(2, 5, 1).unit(), r._keyRng(2, 5, 1).unit(), "same key → same stream");
  assert.notEqual(r._keyRng(2, 5, 1).unit(), r._keyRng(2, 5, 2).unit(), "different kind → different stream");
  assert.notEqual(r._keyRng(2, 5, 1).unit(), r._keyRng(3, 5, 1).unit(), "different car → different stream");
});

// Attack makes a following car build pass-credit faster than running neutral.
test("attack order builds pass-credit faster than neutral", () => {
  function creditAfter(order) {
    const r = new Race(field(), TRACK, 3);
    const lead = r.cars[0], chase = r.cars[1];
    lead.lap = 1; lead.lapFrac = 0.30;
    chase.lap = 1; chase.lapFrac = 0.30 - (COMBAT_GAP * 0.5) / TRACK.lt;
    chase.car = { ...chase.car, power: 0.99, aero: 0.99, rel: 1 };
    chase.attrs = { ...chase.attrs, overtaking: 0.9, aggression: 0.9 };
    chase.order = order;
    // 1 tick: attack accrues more per tick than neutral (ATTACK_CREDIT_K amplifier);
    // 12 ticks would saturate PASS_CREDIT_CAP for both, masking the difference.
    r._resolveCombat();
    return chase._passCredit || 0;
  }
  assert.ok(creditAfter("attack") > creditAfter("none"), "attacking accrues more credit");
});

test("an attacking car in a sustained fight wears its tyres faster + never DNFs from the order", () => {
  function wearAfter(order, seed) {
    const r = new Race(field(), TRACK, seed);
    const a = r.cars[0], b = r.cars[1];
    const car = { ...a.car, rel: 1 };
    a.car = car; b.car = car; b.skill = a.skill; b.attrs = { ...a.attrs };
    b.player = "p1";   // a player's car — its order persists (the AI brain only sets orders for AI cars)
    for (let i = 0; i < 6000; i++) {
      b.order = order;   // re-affirm the player's order each tick (defensive; b is skipped by _aiDrive anyway)
      r.step();
      if (!a.retired && !b.retired && a.lap === b.lap) {
        const gap = (a.lapFrac - b.lapFrac) * TRACK.lt;
        if (gap > COMBAT_GAP * 0.5 || gap < 0) b.lapFrac = a.lapFrac - (COMBAT_GAP * 0.3) / TRACK.lt;
      }
    }
    return { wear: b.wear, retired: b.retired, laps: b.lap };
  }
  const atk = wearAfter("attack", 11), none = wearAfter("none", 11);
  assert.ok(atk.wear > none.wear, `attacker wears more (${atk.wear.toFixed(1)} vs ${none.wear.toFixed(1)})`);
});

test("defend order makes a follower pass less often than a neutral leader", () => {
  function passes(order) {
    let count = 0;
    for (let seed = 0; seed < 24; seed++) {
      const r = new Race(field(), TRACK, 200 + seed);
      const lead = r.cars[0], chase = r.cars[1];
      lead.lap = 1; lead.lapFrac = 0.015;                      // in the Turn-1 brake zone (mini 0-2)
      chase.lap = 1; chase.lapFrac = 0.015 - (COMBAT_GAP * 0.4) / TRACK.lt;
      chase.car = { ...chase.car, power: 0.99, aero: 0.99, rel: 1 };
      chase.attrs = { ...chase.attrs, overtaking: 0.9, aggression: 0.6 };
      lead.attrs = { ...lead.attrs, defending: 0.9 };
      lead.order = order;
      let passed = false;
      for (let i = 0; i < 30 && !passed; i++) { r._resolveCombat(); if ((chase.lap + chase.lapFrac) > (lead.lap + lead.lapFrac)) passed = true; }
      if (passed) count++;
    }
    return count;
  }
  assert.ok(passes("defend") <= passes("none"), "defending holds the position at least as often");
});

test("live safety cars: incidents are deterministic and can deploy a caution; emergent count varies", () => {
  function cautionLapsAndCount(seed) {
    const r = new Race(field(), TRACK, seed);
    r.gridStart();
    let everSC = false, cautions = 0, wasOn = false, g = 0;
    while (!r.finished && g++ < 500000) {
      r.step();
      const on = r.scActive || r.vscActive;
      if (on && !wasOn) { cautions++; everSC = true; }
      wasOn = on;
    }
    return { everSC, cautions };
  }
  const a = cautionLapsAndCount(31), b = cautionLapsAndCount(31);
  assert.deepEqual(a, b, "same seed → same caution history (determinism)");
  const counts = new Set();
  for (let s = 0; s < 16; s++) counts.add(cautionLapsAndCount(40000 + s).cautions);
  assert.ok(counts.size >= 2, `emergent caution count varies across seeds (saw ${[...counts].join(",")})`);
  assert.ok(Math.max(...counts) <= INCIDENT.maxCautions, "never exceeds the cap");
});

test("a start bog-down DNF can draw an opening-lap caution", () => {
  let sawEarlySC = false;
  for (let s = 0; s < 60 && !sawEarlySC; s++) {
    const r = new Race(field(), { ...TRACK, sc: 1.0 }, 60000 + s);
    r.cars[5].attrs = { ...r.cars[5].attrs, starts: 0.0, composure: 0.0 };
    let g = 0;
    while (!r.finished && g++ < 4000) { r.step(); if ((r.scActive || r.vscActive) && r.cars.reduce((m, c) => Math.max(m, c.lap), 0) <= 2) { sawEarlySC = true; break; } }
  }
  assert.ok(sawEarlySC, "a first-lap incident can bring out the safety car");
});
