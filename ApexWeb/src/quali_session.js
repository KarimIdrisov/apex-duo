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

// one completed lap for a car, by phase.
function completeLap(s, car) {
  car.lapIdx += 1;
  if (car.phase === "outlap") { car.phase = "flying"; return; }       // out-lap just warms the tyre
  if (car.phase === "flying") {
    const rng = lapRng(s, car.idx, car.lapIdx);
    const t = qualiLap(car.drv, car.car, TRACK, car.setupBonus, car.risk, rng, s.carMean,
      { grip: s.grip, tyre: car.tyre, traffic: 0, yellow: false });   // traffic/yellow wired in later tasks
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
