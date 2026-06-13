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
