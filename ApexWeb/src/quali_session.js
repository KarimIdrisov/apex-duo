// ApexWeb/src/quali_session.js — pure deterministic real-time qualifying (Q1/Q2/Q3).
// State keyed by car index over all cars; reuses qualiLap for the timed flying lap.
// Randomness is keyed to lap events with stateless seeds (never per-tick) → deterministic across speeds.
import { QUALI2, TRACK } from "./data.js";
import { qualiLap, qualiLapClean, qualiSector } from "./quali.js";
import { RNG, mix32 } from "./rng.js";

const LAP_SEC = () => TRACK.lt;
const SECTOR_SEC = () => TRACK.lt / 3;   // 3 equal sectors per flying lap
const PUSH_RISK = { steady: 0.35, attack: 0.75 };
// stateless per-lap RNG: same (seed, car, lapIdx) → same draws, independent of step cadence
function lapRng(s, idx, lapIdx) { return new RNG(mix32((s.seed >>> 0) + idx * 977 + lapIdx * 131)); }

export function newQuali(seed, field) {
  const cars = {};
  for (const f of field) cars[f.idx] = {
    idx: f.idx, abbrev: f.abbrev, drv: f.drv, car: f.car, setupBonus: f.setupBonus || 0, player: f.player ?? null,
    phase: "pit", tyre: "fresh", softSets: QUALI2.QUALI_SOFT_SETS,
    lapAcc: 0, lapIdx: 0, bestTime: Infinity, segBest: Infinity,
    eliminated: false, gridPos: 0, risk: PUSH_RISK.steady, lapsThisRun: 0,
    push: 1, trackKnow: f.trackKnow ?? 0.5,
    sector: 0, secAcc: 0, lapSectors: [], base: 0, lapDeleted: false, bestSectors: [Infinity, Infinity, Infinity],
    lastLap: Infinity, _lastDeleted: false,
  };
  const carMean = field.reduce((a, f) => a + (f.car.power + f.car.aero) / 2, 0) / field.length;
  return { seed: seed >>> 0, carMean, segment: 1, clock: QUALI2.SEG_SEC[0], speed: 1, paused: true,
    grip: QUALI2.GRIP0, flag: null, cars, classified: [], _bottom: 22 };
}

export function release(s, player, tyre = "fresh", push = "steady") {
  const car = Object.values(s.cars).find(c => c.player === player);
  if (!car || car.eliminated || car.phase !== "pit") return s;
  startRun(s, car, tyre, push);
  return s;
}
function startRun(s, car, tyre, push) {
  if (tyre === "fresh" && car.softSets <= 0) tyre = "used";   // out of fresh sets
  if (tyre === "fresh") car.softSets -= 1;
  car.tyre = tyre; car.risk = PUSH_RISK[push] ?? PUSH_RISK.steady;
  car.push = { save: 0, steady: 1, attack: 2, max: 3 }[push] ?? 1;
  car.phase = "outlap"; car.lapsThisRun = 0;
}

export function abort(s, player) {
  const car = Object.values(s.cars).find(c => c.player === player);
  if (car && (car.phase === "outlap" || car.phase === "flying")) car.phase = "inlap";
  return s;
}

// share of the field on track right now (excluding self): 0 (clear) .. 1 (everyone out).
// the live "traffic ahead" read the player sees before choosing when to release.
export function trafficDensity(s, car) {
  let onTrack = 0, total = 0;
  for (const c of Object.values(s.cars)) { if (c.eliminated) continue; total++; if (c.idx !== car.idx && (c.phase === "flying" || c.phase === "outlap")) onTrack++; }
  return total > 1 ? onTrack / (total - 1) : 0;
}
// time lost to traffic when starting a flying lap: scales with the density, jittered by a stateless
// per-lap roll so a clear window can still be unlucky (and vice-versa).
export function trafficFor(s, car, lapIdx) {
  const density = trafficDensity(s, car);
  const roll = lapRng(s, car.idx, lapIdx * 3 + 1).unit();            // 0..1, stateless
  return QUALI2.TRAFFIC_MAX * density * (0.4 + 0.6 * roll);
}

// roll a per-flying-lap incident: null | "red" (crash → freeze) | "yellow" (minor → penalty window).
// stateless (keyed to lapIdx via a fixed pseudo-car id) and raised by attack push.
export function rollFlag(s, lapIdx, push) {
  const p = QUALI2.FLAG_PROB * (push === "attack" ? 1.8 : 1);
  const r = lapRng(s, 999, lapIdx);
  if (r.unit() >= p) return null;
  return r.unit() < 0.6 ? "red" : "yellow";                          // most incidents are red
}
// raise a red flag: void every in-progress lap (all on-track cars → inlap) and freeze the session.
export function redFlag(s) {
  s.flag = { type: "red", freezeLeft: QUALI2.RED_FREEZE_SEC };
  for (const c of Object.values(s.cars)) if (c.phase === "flying" || c.phase === "outlap") { c.phase = "inlap"; c.lapAcc = 0; }
  return s;
}

// out-lap warms the tyre then BEGINS the live flying lap; in-lap returns to the pit. (flying laps resolve in completeSector.)
function completeLap(s, car) {
  if (car.phase === "outlap") { startFlyingLap(s, car); return; }
  if (car.phase === "inlap")  { car.phase = "pit"; return; }
}

// stamp the clean base for a fresh flying lap + reset sector state. Bumps lapIdx → unique sector RNG per flying lap.
function startFlyingLap(s, car) {
  car.lapIdx += 1;
  car._traffic = trafficFor(s, car, car.lapIdx);
  car.base = qualiLapClean(car.drv, car.car, TRACK, car.setupBonus, s.carMean,
    { grip: s.grip, tyre: car.tyre, traffic: car._traffic || 0, yellow: !!(s.flag && s.flag.type === "yellow") });
  car.phase = "flying"; car.sector = 0; car.secAcc = 0; car.lapSectors = []; car.lapDeleted = false;
}

// one sector of a live flying lap: roll the flag on sector 0; resolve time + risk; finish/delete on the 3rd sector.
function completeSector(s, car) {
  if (car.sector === 0) {
    const pushLabel = car.push >= 2 ? "attack" : "steady";
    const inc = rollFlag(s, car.lapIdx, pushLabel);
    if (inc === "red") { redFlag(s); return; }                       // red sends on-track cars to inlap
    if (inc === "yellow" && !s.flag) s.flag = { type: "yellow", ySecLeft: QUALI2.YELLOW_SEC };
  }
  const rng = lapRng(s, car.idx, car.lapIdx * 10 + car.sector);
  const r = qualiSector(car.base, 1 / 3, car.push, car.trackKnow, rng);
  if (r.event === "off") {                                           // big mistake → lap deleted, no time, run over
    car.lapDeleted = true; car._lastDeleted = true; car.lapsThisRun += 1;
    car.phase = "inlap"; car.lapAcc = 0; return;
  }
  car._lastDeleted = false;
  car.lapSectors.push(r.time);
  car.sector += 1;
  if (car.sector < 3) return;                                        // mid-lap
  const t = car.lapSectors.reduce((a, b) => a + b, 0);              // lap done
  car.lastLap = t; car.bestTime = Math.min(car.bestTime, t); car.segBest = Math.min(car.segBest, t);
  for (let i = 0; i < 3; i++) car.bestSectors[i] = Math.min(car.bestSectors[i], car.lapSectors[i]);
  car.lapsThisRun += 1;
  if (car.lapsThisRun < 2 && car.tyre === "fresh") { car.tyre = "used"; startFlyingLap(s, car); return; }  // 2nd flying lap
  car.phase = "inlap"; car.lapAcc = 0;
}

// host-simulated AI: each non-player car does a staggered banker run, then a final run on a faster track.
// Release windows are jittered per car (stateless) so the field doesn't all run at once.
// A safety run fires if a car still has no time set and the clock allows ≥2 laps; this covers
// cars whose banker was wiped by a red flag.
function aiReleases(s) {
  const segLen = QUALI2.SEG_SEC[s.segment - 1];
  const minClock = LAP_SEC() * 2.2;                                               // need at least 2 laps left
  for (const idx in s.cars) {
    const car = s.cars[idx];
    if (car.player != null || car.eliminated || car.phase !== "pit") continue;
    if (car._aiSeg !== s.segment) { car._aiSeg = s.segment; car._aiRuns = 0; }   // reset per segment
    const jitter = lapRng(s, car.idx, s.segment * 13).unit();                     // 0..1, stateless per car/segment
    const run1At = segLen * (0.92 - 0.12 * jitter);                               // banker, staggered 0.80..0.92 of the clock
    const run2At = segLen * (0.42 - 0.18 * jitter);                               // final run, staggered 0.24..0.42
    let go = false, push = "steady";
    if (car._aiRuns === 0 && s.clock <= run1At) { go = true; push = "steady"; }
    else if (car._aiRuns === 1 && s.clock <= run2At && s.clock > minClock) { go = true; push = "attack"; }
    // safety run: no time set yet (red-flag victim) and clock still allows 2 laps
    else if (car._aiRuns >= 1 && !isFinite(car.segBest) && s.clock > minClock) { go = true; push = "attack"; }
    if (go) { car._aiRuns = (car._aiRuns || 0) + 1; startRun(s, car, car.softSets > 0 ? "fresh" : "used", push); }
  }
}

export function qualiStep(s, dt) {
  if (s.paused) return s;
  if (s.flag && s.flag.type === "red") {                             // red: clock + cars frozen; freeze counts down
    s.flag.freezeLeft -= dt * s.speed; if (s.flag.freezeLeft <= 0) s.flag = null; return s;
  }
  if (s.clock <= 0) return s;                                        // segment over: cars + clock frozen
  if (s.flag && s.flag.type === "yellow") {                          // yellow: session continues; window counts down
    s.flag.ySecLeft -= dt * s.speed; if (s.flag.ySecLeft <= 0) s.flag = null;
  }
  const adv = Math.min(s.clock, dt * s.speed);
  s.clock -= adv;
  s.grip = Math.min(1, s.grip + QUALI2.GRIP_RISE * adv);              // track rubbers in over time
  for (const idx in s.cars) {
    const car = s.cars[idx];
    if (car.eliminated || car.phase === "pit") continue;
    if (car.phase === "flying") {
      car.secAcc += adv;
      let guard = 0;
      while (car.secAcc >= SECTOR_SEC() && car.phase === "flying" && guard++ < 8) { car.secAcc -= SECTOR_SEC(); completeSector(s, car); }
    } else {
      car.lapAcc += adv;
      let guard = 0;
      while (car.lapAcc >= LAP_SEC() && (car.phase === "outlap" || car.phase === "inlap") && guard++ < 8) { car.lapAcc -= LAP_SEC(); completeLap(s, car); }
    }
  }
  aiReleases(s);
  return s;
}

export function setSpeed(s, v) { s.speed = QUALI2.SPEEDS.includes(v) ? v : s.speed; return s; }
export function setPaused(s, p) { s.paused = !!p; return s; }
export function setPush(s, player, level) {
  const car = Object.values(s.cars).find(c => c.player === player);
  if (car && !car.eliminated) car.push = Math.max(0, Math.min(3, level | 0));
  return s;
}

export function carView(s, player) {
  const car = Object.values(s.cars).find(c => c.player === player);
  return car ? { idx: car.idx, phase: car.phase, tyre: car.tyre, softSets: car.softSets,
    bestTime: car.bestTime, eliminated: car.eliminated, gridPos: car.gridPos } : null;
}

// classify the current segment: sort active cars fastest-first (no-time → last by idx), eliminate the
// slowest ELIM[seg], and give each eliminated car the lowest free grid slot from the back (P22, P21, …).
export function advanceSegment(s) {
  const seg = s.segment;                                              // 1|2|3
  const active = Object.values(s.cars).filter(c => !c.eliminated);
  active.sort((a, b) => (a.segBest - b.segBest) || (a.idx - b.idx));  // fastest first; Infinity ties → by idx
  const elim = QUALI2.ELIM[seg - 1];
  const survivors = active.length - elim;
  for (let i = active.length - 1; i >= survivors; i--) {              // slowest first → lowest free slot
    const c = active[i]; c.eliminated = true; c.gridPos = s._bottom--;
  }
  if (seg < 3) {                                                      // carry survivors into the next segment
    s.segment = seg + 1; s.clock = QUALI2.SEG_SEC[seg]; s.paused = true; s.flag = null;
    for (let i = 0; i < survivors; i++) { const c = active[i]; c.segBest = Infinity; c.phase = "pit"; c.lapAcc = 0; c.lapsThisRun = 0; }
  } else {                                                            // Q3 done: survivors take P1..P10 (fastest = P1)
    for (let i = 0; i < survivors; i++) { active[i].eliminated = true; active[i].gridPos = i + 1; }
    s.segment = 4;                                                    // sentinel: quali complete
  }
  return s;
}

export function finalGrid(s) {
  const all = Object.values(s.cars).slice().sort((a, b) => a.gridPos - b.gridPos);
  return all.map((c, i) => ({ idx: c.idx, abbrev: c.abbrev, pos: i + 1, time: c.bestTime }));
}

// the live timing tower + per-player control blocks for the UI/netcode.
export function qualiSnapshot(s) {
  const all = Object.values(s.cars);
  const ranked = all.slice().sort((a, b) => {
    if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;              // active above eliminated
    if (!a.eliminated) return (a.segBest - b.segBest) || (a.idx - b.idx);         // active by this-segment best
    return a.gridPos - b.gridPos;                                                 // eliminated by their locked slot
  });
  const leader = ranked.find(c => isFinite(c.segBest));
  const cut = QUALI2.IN[Math.min(s.segment, 3) - 1] - QUALI2.ELIM[Math.min(s.segment, 3) - 1];
  const tower = ranked.map((c, i) => ({
    idx: c.idx, abbrev: c.abbrev, pos: i + 1,
    time: isFinite(c.bestTime) ? c.bestTime : null,
    gap: (leader && isFinite(c.segBest) && isFinite(leader.segBest) && c !== leader) ? c.segBest - leader.segBest : null,
    tyre: c.tyre, phase: c.phase, eliminated: c.eliminated, player: c.player,
  }));
  const posOf = idx => { const r = tower.find(t => t.idx === idx); return r ? r.pos : 0; };
  const block = (player) => { const c = all.find(x => x.player === player); return c ? {
    phase: c.phase, tyre: c.tyre, softSets: c.softSets, bestTime: isFinite(c.bestTime) ? c.bestTime : null,
    pos: posOf(c.idx), eliminated: c.eliminated, traffic: trafficDensity(s, c),
    sector: c.sector, push: c.push, lapSectors: c.lapSectors.slice(),
    sectorDelta: c.lapSectors.map((t, i) => (isFinite(c.bestSectors[i]) ? t - c.bestSectors[i] : null)),
    lapDeleted: c.lapDeleted, lastLap: isFinite(c.lastLap) ? c.lastLap : null } : null; };
  return { type: "snapshot", phase: "quali", segment: s.segment, clock: s.clock, speed: s.speed,
    paused: s.paused, grip: s.grip, flag: s.flag, cut, tower, cars: { p1: block("p1"), p2: block("p2") } };
}
