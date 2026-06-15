// ApexWeb/src/drivers.js — pure driver career model: age, evolving overall, morale, contracts.
// All meta→sim influence flows through the driver's overall (-> driverAttrs) and moraleMod (-> setupBonus).
import { TEAMS } from "./data.js";
import { driverAttrs, attrDrift, assignTraits, traitBias, ATTR_KEYS } from "./team.js";

// approximate 2026 driver ages (abbrev -> age).
export const DRIVER_AGE = {
  NOR: 26, PIA: 25, ANT: 19, RUS: 28, VER: 28, HAD: 19, LEC: 28, HAM: 41, SAI: 31, ALB: 30,
  ALO: 44, STR: 27, GAS: 30, COL: 22, LAW: 24, LIN: 18, OCO: 29, BEA: 20, HUL: 38, BOR: 21, PER: 36, BOT: 36,
};

// abbrev -> display name (the dynamic roster no longer reads the static TEAMS roster, so it needs this).
export const DRIVER_NAME = {};
for (const t of TEAMS) for (const d of t.drivers) DRIVER_NAME[d.abbrev] = d.name;

// real 2024 F1 championship points, for drivers who raced in 2024 (D2 skill calibration). NOTE:
// points conflate car+driver — a strong driver in a weak car (Albon) is underrated by raw points,
// so we BLEND with the driver-aware estimate. Bradley-Terry (car-removed) is the ideal refinement.
export const RESULTS_2024 = {
  VER: 437, NOR: 374, LEC: 356, PIA: 292, SAI: 290, RUS: 245, HAM: 223, PER: 152,
  ALO: 70, GAS: 42, HUL: 41, STR: 24, OCO: 23, ALB: 12, BEA: 7, COL: 5, LAW: 4, BOT: 0,
};
const pointsToSkill = p => 0.74 + 0.21 * Math.sqrt(Math.max(0, p) / 437);
// a driver's overall calibrated to real 2024 results (blended 55/45 with the estimate); rookies /
// 2026 newcomers with no 2024 points (ANT, HAD, LIN, BOR…) keep the estimate. Career-only (initDrivers).
export function realOverall(abbrev, estimate) {
  const p = RESULTS_2024[abbrev];
  if (p == null) return estimate;
  return Math.round((0.55 * estimate + 0.45 * pointsToSkill(p)) * 1000) / 1000;
}

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
    const overall = realOverall(dr.abbrev, dr.skill);   // D2: calibrated to real 2024 results
    d[dr.abbrev] = {
      teamIdx: i, age: DRIVER_AGE[dr.abbrev] ?? 28, overall, morale: 0.6,
      contractSeasons: dr.skill > 0.85 ? 3 : 2, salary: salaryFor(overall),
      attrs: driverAttrs(dr.abbrev, overall),           // D5: persistent 13-attr vector (signature baked in)
      traits: assignTraits(dr.abbrev),                  // D5: identity + development bias
    };
  }));
  return d;
}

// advance all drivers one season: age up, develop attributes per the age curve (+ trait bias), drift
// overall by the mean attr change (continuous — no readout jump), refresh salary, tick contracts.
export function developDrivers(drivers) {
  for (const a in drivers) {
    const dr = drivers[a];
    dr.age += 1;
    if (dr.attrs) {
      let sum = 0;
      for (const k of ATTR_KEYS) {
        const nv = clamp01(dr.attrs[k] + attrDrift(k, dr.age) + traitBias(dr.traits, k));
        sum += nv - dr.attrs[k]; dr.attrs[k] = nv;
      }
      dr.overall = clampOverall(dr.overall + sum / ATTR_KEYS.length);   // overall follows the development trend
    } else {
      dr.overall = clampOverall(dr.overall + ageDrift(dr.age));         // legacy fallback (no attrs)
    }
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
