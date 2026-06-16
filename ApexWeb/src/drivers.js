// ApexWeb/src/drivers.js — pure driver career model: age, evolving overall, morale, contracts.
// (G1–G4: season stats, training focus, form, requests, trait development.)
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

// G2: training focuses — a chosen program develops these attrs faster (in-season + over the winter).
export const TRAINING = {
  quali:       { label: "Квалификация", attrs: ["quali", "pace"] },
  tyres:       { label: "Бережёт резину", attrs: ["tyre", "smoothness"] },
  racecraft:   { label: "Гонка / обгон", attrs: ["overtaking", "defending", "race_iq"] },
  wet:         { label: "Дождь", attrs: ["wet", "composure"] },
  consistency: { label: "Стабильность", attrs: ["consistency", "discipline"] },
};
const TRAIN_RACE = 0.0011;   // per-race drift on each focused attr (×~22 races ≈ +0.024/season of focus)
const TRAIN_WINTER = 0.010;  // extra winter drift on each focused attr
export function trainingAttrs(training) { return (TRAINING[training] && TRAINING[training].attrs) || []; }

// G4: an attr that crosses this mastery threshold can unlock the matching trait.
const ATTR_TRAIT = { wet: "wet_master", overtaking: "overtaker", defending: "defender", tyre: "tyre_whisperer", quali: "qualifier", starts: "starter", composure: "ice_cold", race_iq: "strategist" };
const TRAIT_GATE = 0.90;

// G1: a fresh per-season stat line for a driver.
export function zeroDriverStats() { return { wins: 0, podiums: 0, poles: 0, points: 0, dnf: 0, starts: 0, bestFin: 99, qH2H: 0, rH2H: 0 }; }

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
      training: null, status: "equal", form: 0.5,       // G2 training focus · G3 #1/equal status + short-term form
      stats: zeroDriverStats(), request: null,          // G1 season stats · G3 pending driver ask
    };
  }));
  return d;
}

// advance all drivers one season: age up, develop attributes per the age curve (+ trait bias), drift
// overall by the mean attr change (continuous — no re