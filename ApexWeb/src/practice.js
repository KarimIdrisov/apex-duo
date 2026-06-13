// ApexWeb/src/practice.js — pure helpers reused by the live practice session.
import { TEAMS, TRACK, SKILL_K, CAR_K, CAR_PACE_K } from "./data.js";
import { composeCar } from "./team.js";
import { closeness, paceBonus } from "./setup.js";

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
