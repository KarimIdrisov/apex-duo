// ApexWeb/src/quali_session.js — pure deterministic real-time qualifying (Q1/Q2/Q3).
// State keyed by car index over all cars; reuses qualiLap for the timed flying lap.
// Randomness is keyed to lap events with stateless seeds (never per-tick) → deterministic across speeds.
import { QUALI2, TRACK } from "./data.js";
import { qualiLap } from "./quali.js";
import { RNG, mix32 } from "./rng.js";

const LAP_SEC = () => TRACK.lt;
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
  car.phase = "outlap"; car.lapsThisRun = 0;
}

export function abort(s, player) {
  const car = Object.values(s.cars).find(c => c.player === player);
  if (car && (car.phase === "outlap" || car.phase === "flying")) car.phase = "inlap";
  return s;
}

// time lost to traffic when starting a flying lap: scales with the share of the field on track,
// jittered by a stateless per-lap roll so a clear window can still be unlucky (and vice-versa).
export function trafficFor(s, car, lapIdx) {
  let onTrack = 0, total = 0;
  for (const c of Object.values(s.cars)) { if (c.eliminated) continue; total++; if (c.idx !== car.idx && (c.phase === "flying" || c.phase === "outlap")) onTrack++; }
  const density = total > 1 ? onTrack / (total - 1) : 0;             // 0 (clear) .. 1 (everyone out)
  const roll = lapRng(s, car.idx, lapIdx * 3 + 1).unit();            // 0..1, stateless
  return QUALI2.TRAFFIC_MAX * density * (0.4 + 0.6 * roll);
}

// one completed lap for a car, by phase.
function completeLap(s, car) {
  car.lapIdx += 1;
  if (car.phase === "outlap") { car.phase = "flying"; car._traffic = trafficFor(s, car, car.lapIdx); return; }       // out-lap just warms the tyre; stamp traffic for upcoming flying lap
  if (car.phase === "flying") {
    const rng = lapRng(s, car.idx, car.lapIdx);
    const t = qualiLap(car.drv, car.car, TRACK, car.setupBonus, car.risk, rng, s.carMean,
      { grip: s.grip, tyre: car.tyre, traffic: car._traffic || 0, yellow: false });   // traffic stamped on out-lap
    car.bestTime = Math.min(car.bestTime, t); car.segBest = Math.min(car.segBest, t);
    car.lapsThisRun += 1;
    // a fresh run can do a 2nd flying lap on the now-warm set; otherwise pit
    if (car.lapsThisRun < 2 && car.tyre === "fresh") { car.tyre = "used"; return; }
    car.phase = "inlap"; return;
  }
  if (car.phase === "inlap") { car.phase = "pit"; return; }
}

export function qualiStep(s, dt) {
  if (s.paused || s.clock <= 0) return s;
  const adv = Math.min(s.clock, dt * s.speed);
  s.clock -= adv;
  s.grip = Math.min(1, s.grip + QUALI2.GRIP_RISE * adv);              // track rubbers in over time
  for (const idx in s.cars) {
    const car = s.cars[idx];
    if (car.eliminated || car.phase === "pit") continue;
    car.lapAcc += adv;
    let guard = 0;
    while (car.lapAcc >= LAP_SEC() && car.phase !== "pit" && guard++ < 8) { car.lapAcc -= LAP_SEC(); completeLap(s, car); }
  }
  return s;
}

export function setSpeed(s, v) { s.speed = QUALI2.SPEEDS.includes(v) ? v : s.speed; return s; }
export function setPaused(s, p) { s.paused = !!p; return s; }

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
