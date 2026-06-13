// ApexWeb/src/practice.js — Practice "run plans": pure run-sim helpers + the shared findings reducer.
// Reuses the calibrated race engine (tyres/fuel/quali) — NO new balance numbers. Deterministic (seeded).
import { TEAMS, TRACK, SKILL_K, CAR_K, CAR_PACE_K, COMPOUNDS, TYRE,
  LONG_RUN_LAPS, PRAC_COST, PRAC_BUDGET, PRAC_SIGNAL_K, PRAC_SETUP_NOISE } from "./data.js";
import { composeCar } from "./team.js";
import { closeness, paceBonus, feedback, AXES } from "./setup.js";
import { tyreTerm, warmStep } from "./tyres.js";
import { startFuel, weightTerm, burnFor } from "./fuel.js";
import { RNG, mix32 } from "./rng.js";

// field-mean (power+aero)/2 over the real grid — the anchor the absolute car-pace term uses (matches the race).
export function carMean() {
  let s = 0, n = 0;
  for (const t of TEAMS) for (const d of t.drivers) { const c = composeCar(t.car); s += (c.power + c.aero) / 2; n++; }
  return s / n;
}
const A = drv => drv.attrs || { pace: drv.skill };

// deterministic single-car lap base (no race noise/form/AI/SC) — skill + absolute car + track bias + setup.
export function practiceLapBase(drv, car, setup, ideal) {
  let s = TRACK.lt;
  s -= SKILL_K * (A(drv).pace - 0.5);
  s -= CAR_PACE_K * ((car.power + car.aero) / 2 - carMean());
  s -= CAR_K * ((car.power - car.aero) * (TRACK.pw - TRACK.df));
  s += paceBonus(closeness(setup, ideal));   // <=0, faster when set well
  return s;
}

// one car's long run of `laps` laps on `compound`: the real deg curve (for the chart) PLUS the projected
// cliff/stint extrapolated from the wear rate — a long run is far shorter than a stint, so the engineer
// reads the trend and projects where the tyre falls off (the cliff is ~25 laps on softs, never reached in ~10).
export function runLong(drv, car, compound, setup, ideal, laps = LONG_RUN_LAPS, seed = 0) {
  const rng = new RNG(mix32((seed >>> 0) + 0x511));
  const base = practiceLapBase(drv, car, setup, ideal);
  const comp = COMPOUNDS[compound];
  let wear = 0, temp = TYRE.gridTemp, fuel = startFuel(TRACK);
  const lapTimes = [];
  for (let lap = 1; lap <= laps; lap++) {
    lapTimes.push(base + comp.pace + tyreTerm(compound, wear, temp) + weightTerm(fuel) + rng.noise(0.05));
    wear += comp.wear; temp = warmStep(temp, compound); fuel -= burnFor("standard", car.fuel);
  }
  const cliffLap = Math.round(comp.cliff / comp.wear);          // projected lap the tyre falls off the cliff
  const stintLaps = cliffLap;                                   // usable stint length before a stop is due
  const recommendedStops = Math.max(1, Math.ceil(TRACK.laps / Math.max(1, stintLaps)) - 1);
  return { type: "long", compound, lapTimes, cliffLap, stintLaps, recommendedStops };
}

// a short setup-signal lap (noisy: amp grows as consistency drops) + a feedback line whose clarity scales with race_iq.
export function runSetupTest(drv, car, setup, ideal, seed = 0) {
  const rng = new RNG(mix32((seed >>> 0) + 0x5e2));
  const a = A(drv);
  const cons = a.consistency ?? 0.7, iq = a.race_iq ?? 0.7;
  const close = Math.max(0, closeness(setup, ideal));
  // amplify the setup swing for a readable clock: drop the tiny race-scale paceBonus already in the base and
  // replace it with PRAC_SIGNAL_K; add noise a jittery driver can't filter out.
  const lapTime = practiceLapBase(drv, car, setup, ideal) - paceBonus(closeness(setup, ideal))
    - PRAC_SIGNAL_K * close + rng.noise(PRAC_SETUP_NOISE * (1 - cons));
  return { type: "setup", lapTime, closeness: closeness(setup, ideal), feedback: feedbackLine(setup, ideal, iq, rng) };
}

// feedback whose clarity scales with race_iq: a sharp driver names the worst axis + direction; a vague one may
// blur the direction or just say "balance is off" (so a low-feedback driver is genuinely harder to dial in).
export function feedbackLine(setup, ideal, raceIq, rng) {
  const clear = feedback(setup, ideal);                         // the precise "axis: direction" hint
  if (clear.startsWith("Машина")) return clear;                 // already balanced — always clear
  if (rng.unit() < (raceIq ?? 0.7)) return clear;               // sharp driver: precise
  // vague driver: drop to a non-committal line some of the time
  const ax = AXES[worstAxis(setup, ideal)];
  return rng.unit() < 0.5 ? `Где-то в балансе не то — покрути ещё.` : `${ax.name}: что-то не так.`;
}
function worstAxis(setup, ideal) {
  let w = 0, e = -1; for (let i = 0; i < 3; i++) { const d = Math.abs(setup[i] - ideal[i]); if (d > e) { e = d; w = i; } } return w;
}

// a representative quali pace (low fuel, soft) — the absolute single-lap pace the player would qualify near.
export function runQuali(drv, car, setup, ideal, seed = 0) {
  const rng = new RNG(mix32((seed >>> 0) + 0x901));
  const qualiPace = practiceLapBase(drv, car, setup, ideal) + COMPOUNDS.soft.pace + rng.noise(0.06);
  return { type: "quali", qualiPace };
}

export function newPracticeState() {
  return { budget: PRAC_BUDGET, spent: 0, findings: [], setups: {}, board: analyzeFindings([]) };
}

// host reducer: validate budget, run the chosen type (seeded), append the finding, recompute the board.
export function applyPracticeRun(state, req, drv, car, ideal, seed) {
  const cost = PRAC_COST[req.type] || 1;
  if (state.spent + cost > state.budget) return { accepted: false, state };
  const runId = state.findings.length;
  let result;
  if (req.type === "long")  result = runLong(drv, car, req.compound || "medium", req.setup, ideal, undefined, seed + runId);
  else if (req.type === "quali") result = runQuali(drv, car, req.setup, ideal, seed + runId);
  else result = runSetupTest(drv, car, req.setup, ideal, seed + runId);
  const findings = [...state.findings, { runId, player: req.player, ...result }];
  return { accepted: true, state: { ...state, spent: state.spent + cost, findings, board: analyzeFindings(findings) } };
}

// fold the run log into the board summary the UI shows.
export function analyzeFindings(findings) {
  const degByCompound = {}; let quali = null, idealFound = 0, recommendedStops = null;
  for (const f of findings) {
    if (f.type === "long") { degByCompound[f.compound] = { lapTimes: f.lapTimes, cliffLap: f.cliffLap, stintLaps: f.stintLaps };
      recommendedStops = recommendedStops == null ? f.recommendedStops : Math.min(recommendedStops, f.recommendedStops); }
    else if (f.type === "quali") quali = quali == null ? f.qualiPace : Math.min(quali, f.qualiPace);
    else if (f.type === "setup") idealFound = Math.max(idealFound, f.closeness);
  }
  return { degByCompound, quali, idealFound, recommendedStops };
}
