// ApexWeb/src/drivers.js — pure driver career model: age, evolving overall, morale, contracts.
// All meta→sim influence flows through the driver's overall (-> driverAttrs) and moraleMod (-> setupBonus).
import { TEAMS } from "./data.js";

// approximate 2026 driver ages (abbrev -> age).
export const DRIVER_AGE = {
  NOR: 26, PIA: 25, ANT: 19, RUS: 28, VER: 28, HAD: 19, LEC: 28, HAM: 41, SAI: 31, ALB: 30,
  ALO: 44, STR: 27, GAS: 30, COL: 22, LAW: 24, LIN: 18, OCO: 29, BEA: 20, HUL: 38, BOR: 21, PER: 36, BOT: 36,
};

export const MORALE_PACE = 0.5;   // s/lap swing from morale extremes (centered on the 0.6 start)

const clampOverall = v => Math.max(0.50, Math.min(0.99, v));
const clamp01 = v => Math.max(0, Math.min(1, v));

// per-season overall drift by age: young grow toward a peak (~26), veterans decline.
function ageDrift(age) { return Math.max(-0.020, Math.min(0.020, (26 - age) * 0.0032)); }

// salary ($k/race) for a driver of this overall — stars cost far more than rookies.
export function salaryFor(overall) { return Math.round(120 + Math.pow(Math.max(0, overall - 0.7), 1.6) * 4200); }

// per-driver registry from the grid: abbrev -> {teamIdx, age, overall, morale, contractSeasons, salary}.
export function initDrivers() {
  const d = {};
  TEAMS.forEach((t, i) => t.drivers.forEach(dr => {
    const overall = dr.skill;
    d[dr.abbrev] = {
      teamIdx: i, age: DRIVER_AGE[dr.abbrev] ?? 28, overall, morale: 0.6,
      contractSeasons: dr.skill > 0.85 ? 3 : 2, salary: salaryFor(overall),
    };
  }));
  return d;
}

// advance all drivers one season: age up, drift overall by age, refresh salary, tick contracts.
export function developDrivers(drivers) {
  for (const a in drivers) {
    const dr = drivers[a];
    dr.age += 1;
    dr.overall = clampOverall(dr.overall + ageDrift(dr.age));
    dr.salary = salaryFor(dr.overall);
    dr.contractSeasons = Math.max(0, dr.contractSeasons - 1);
  }
}

// update morale from a race finish vs an expected position. Decays toward 0.6 so it never sticks
// at an extreme (steady over-performer ~0.9, under-performer ~0.3).
export function updateMorale(driver, finishPos, expectedPos) {
  const delta = finishPos <= expectedPos ? 0.03 : -0.03;
  driver.morale = clamp01(driver.morale * 0.90 + 0.6 * 0.10 + delta);
}

// morale -> pace modifier (s/lap, centered on the 0.6 start; positive = faster).
export function moraleMod(morale) { return ((morale ?? 0.6) - 0.6) * MORALE_PACE; }

// re-sign a player driver: pay a signing fee (~6 races of salary), reset contract, lift morale.
export function reSign(career, abbrev) {
  const dr = career.drivers && career.drivers[abbrev];
  if (!dr) return false;
  const fee = dr.salary * 6;
  if (career.money < fee) return false;
  career.money -= fee;
  dr.contractSeasons = 3;
  dr.morale = clamp01(dr.morale + 0.15);
  return true;
}
