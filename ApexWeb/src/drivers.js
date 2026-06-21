// ApexWeb/src/drivers.js — pure driver career model: age, evolving overall, morale, contracts.
// (G1–G4: season stats, training focus, form, requests, trait development.)
// All meta→sim influence flows through the driver's overall (-> driverAttrs) and moraleMod (-> setupBonus).
import { TEAMS } from "./data.js";
import { driverAttrs, attrDrift, assignTraits, traitBias, ATTR_KEYS, peakArchetype } from "./team.js";
import { mix32 } from "./rng.js";

// §Phase-5 — driver Feedback (the race_iq stat) gates how TRUSTWORTHY the in-race tyre-life readout is.
// A high-feedback driver reports a tight "~N laps to the cliff"; a low-feedback driver's window is fuzzy
// (a wider ± band), so you can't fully trust it — managing a weak-feedback driver means more guesswork.
// Pure & UI-free: returns the display string for `n` laps remaining to the tyre cliff. n>=0.
export function tyreWindowReadout(n, feedback) {
  const fb = Math.max(0, Math.min(1, feedback == null ? 0.7 : feedback));
  const spread = Math.round((1 - fb) * 4);                 // 0 (sharp, top feedback) … 4 (vague)
  if (spread <= 0) return `~${n} кр до обрыва`;
  const half = Math.ceil(spread / 2);
  return `~${Math.max(0, n - half)}–${n + half} кр до обрыва`;
}

// §Phase-3 — PAY DRIVER: a weaker driver who brings sponsorship money each race instead of commanding a
// premium wage (MM's "weak-but-funded" prospect). Deterministic: only lower-overall drivers, ~1 in 3 of
// them. The inbound cash flows in career.applyResult (PAY_DRIVER_INCOME).
export function isPayDriver(abbrev, overall) {
  if ((overall || 0) >= 0.75) return false;
  return (mix32(((String(abbrev).charCodeAt(0) || 65) * 2654435761 + (String(abbrev).charCodeAt(1) || 90) * 131 + 555) >>> 0) / 4294967296) < 0.35;
}

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
      peakAge: peakArchetype(dr.abbrev),                // §Phase-3: early/normal/late peak-age archetype
      payDriver: isPayDriver(dr.abbrev, overall),       // §Phase-3: pay driver (brings cash, see applyResult)
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
      const focus = new Set(trainingAttrs(dr.training));   // G2: winter training bonus on the focused attrs
      let sum = 0;
      for (const k of ATTR_KEYS) {
        let nv = dr.attrs[k] + attrDrift(k, dr.age, dr.peakAge || 0) + traitBias(dr.traits, k) + (focus.has(k) ? TRAIN_WINTER : 0);
        nv = clamp01(nv);
        sum += nv - dr.attrs[k]; dr.attrs[k] = nv;
      }
      dr.overall = clampOverall(dr.overall + sum / ATTR_KEYS.length);   // overall follows the development trend
    } else {
      dr.overall = clampOverall(dr.overall + ageDrift(dr.age));         // legacy fallback (no attrs)
    }
    dr.salary = salaryFor(dr.overall);
    dr.contractSeasons = Math.max(0, dr.contractSeasons - 1);
    dr.stats = zeroDriverStats();   // G1: fresh season stat line
  }
}

// internal: nudge the focused attrs and follow overall (used for in-season training).
function applyTrainingDrift(dr, amt) {
  if (!dr.attrs || !dr.training) return;
  let sum = 0; for (const k of trainingAttrs(dr.training)) { const nv = clamp01(dr.attrs[k] + amt); sum += nv - dr.attrs[k]; dr.attrs[k] = nv; }
  dr.overall = clampOverall(dr.overall + sum / ATTR_KEYS.length);
}

// G1+G2+G3: one race for a player driver — season stats, short-term form, morale, in-season training.
// info: { finishPos, expectedPos, retired, points, isPole, beatTeammate (bool|null) }.
// devMult (default 1 = no change): a Mentor co-director speeds in-season development (driverDevMult > 1).
export function tickDriverRace(dr, info, devMult = 1) {
  const s = dr.stats || (dr.stats = zeroDriverStats());
  s.starts += 1; s.points += info.points || 0;
  if (info.retired) s.dnf += 1; else s.bestFin = Math.min(s.bestFin, info.finishPos);
  if (!info.retired && info.finishPos === 1) s.wins += 1;
  if (!info.retired && info.finishPos <= 3) s.podiums += 1;
  if (info.isPole) s.poles += 1;
  if (info.beatTeammate === true) s.rH2H += 1;
  const met = !info.retired && info.finishPos <= info.expectedPos;
  dr.form = clamp01((dr.form ?? 0.5) * 0.75 + (met ? 0.85 : 0.20) * 0.25);
  let d = met ? 0.03 : -0.03;
  if (info.beatTeammate === false) d -= 0.015; else if (info.beatTeammate === true) d += 0.010;
  d += ((dr.form ?? 0.5) - 0.5) * 0.02;
  dr.morale = clamp01((dr.morale ?? 0.6) * 0.90 + 0.6 * 0.10 + d);
  applyTrainingDrift(dr, TRAIN_RACE * devMult);
}

// G4: a driver whose key attr crosses mastery may unlock the matching trait. Returns the trait key or null.
export function maybeGainTrait(dr) {
  if (!dr.attrs) return null;
  dr.traits = dr.traits || [];
  for (const k in ATTR_TRAIT) { const tr = ATTR_TRAIT[k]; if ((dr.attrs[k] || 0) >= TRAIT_GATE && !dr.traits.includes(tr)) { dr.traits.push(tr); return tr; } }
  return null;
}

// ---- aging → retirement (creates seat demand the academy/market fills) ------------------------
// A driver's per-season chance of hanging up the helmet: nil before ~34, rising with age; elite
// overall stretches a career (real F1: Alonso 44, Hamilton 41). Deterministic when rolled.
export function retireChance(age, overall) {
  if (age < 34) return 0;
  let p = (age - 34) * 0.11;                          // 34→0, 40→0.66, 44→1.10
  p -= Math.max(0, (overall || 0) - 0.86) * 1.2;      // a still-elite veteran races on
  return Math.max(0, Math.min(0.95, p));
}

// fictional rookies that backfill retired seats (Latin abbrev avoids the grid/academy; Cyrillic name).
export const ROOKIE_POOL = [
  { abbrev: "ERI", name: "Эрикссон" }, { abbrev: "MRK", name: "Маркелов" }, { abbrev: "PUL", name: "Пулен" },
  { abbrev: "VRG", name: "Варга" },    { abbrev: "NIE", name: "Нието" },    { abbrev: "SOL", name: "Соломон" },
  { abbrev: "TKD", name: "Такеда" },   { abbrev: "DEL", name: "Делькур" },  { abbrev: "GRN", name: "Грюн" },
  { abbrev: "BLG", name: "Балог" },    { abbrev: "RSS", name: "Россо" },    { abbrev: "KAI", name: "Кай" },
  { abbrev: "FNG", name: "Фэн" },      { abbrev: "OZD", name: "Оздемир" },  { abbrev: "PRT", name: "Прието" },
  { abbrev: "NVK", name: "Новак" },    { abbrev: "LMB", name: "Ламбер" },   { abbrev: "SVN", name: "Северин" },
];

// Retire eligible drivers and backfill each empty seat with a young rookie (grid stays at 22 cars).
// Mutates `drivers` (and registers rookie names into DRIVER_NAME). Returns { retired, rookies } for news.
export function retirePass(drivers, season, seed, playerTeamIdx) {
  const retired = [], rookies = [];
  const taken = new Set(Object.keys(drivers));
  const freeRookies = ROOKIE_POOL.filter(r => !taken.has(r.abbrev));
  let ri = 0;
  for (const ab of Object.keys(drivers)) {            // snapshot of keys — safe to add/remove inside
    const dr = drivers[ab];
    const p = retireChance(dr.age || 30, dr.overall || 0.7);
    if (p <= 0) continue;
    const roll = mix32(((seed >>> 0) + ab.charCodeAt(0) * 7919 + (ab.charCodeAt(1) || 3) * 131 + season * 97) >>> 0) / 4294967296;
    if (roll >= p) continue;
    const teamIdx = dr.teamIdx, wasPlayer = teamIdx === playerTeamIdx;
    retired.push({ abbrev: ab, name: DRIVER_NAME[ab] || ab, age: dr.age, teamIdx, wasPlayer });
    delete drivers[ab];
    const rk = freeRookies[ri] || { abbrev: "RK" + season + ri, name: "Дебютант" };
    ri += 1;
    const ov = 0.66 + (mix32(((seed >>> 0) + ri * 333 + season * 17) >>> 0) / 4294967296) * 0.08;   // 0.66–0.74
    const age = 18 + (mix32(((seed >>> 0) + ri * 51) >>> 0) % 4);
    DRIVER_NAME[rk.abbrev] = rk.name;
    drivers[rk.abbrev] = {
      teamIdx, age, overall: ov, morale: 0.66, contractSeasons: 2, salary: salaryFor(ov), name: rk.name,
      attrs: driverAttrs(rk.abbrev, ov), traits: [], training: null, status: "equal", form: 0.5, stats: zeroDriverStats(),
    };
    rookies.push({ abbrev: rk.abbrev, name: rk.name, teamIdx, wasPlayer });
  }
  return { retired, rookies };
}

// is a driver past peak / declining (UI trend arrow). Returns -1 declining, 0 prime, +1 rising.
export function ageTrend(age) { return age <= 24 ? 1 : age >= 33 ? -1 : 0; }

// G3: surface a driver "ask" if conditions warrant (dominating teammate → wants #1; contract ending +
// in form → wants a renewal). Sticky until resolved. Returns the request or null.
export function makeDriverRequest(dr, abbrev) {
  if (dr.request) return dr.request;
  const s = dr.stats || {}, name = DRIVER_NAME[abbrev] || abbrev, form = dr.form ?? 0.5, cl = dr.clauses || {};
  if (dr.status !== "lead" && (s.rH2H || 0) >= 4 && form > 0.6)
    return (dr.request = { type: "lead", text: `${name} уверенно обыгрывает напарника и хочет статус первого номера.` });
  if ((s.wins || 0) >= 1 && !cl.winBonus && form > 0.55)
    return (dr.request = { type: "bonus", text: `${name} выигрывает гонки и просит вписать бонусы за результат в контракт.` });
  if ((s.podiums || 0) >= 3 && form > 0.62)
    return (dr.request = { type: "raise", text: `${name} в блестящей форме и просит прибавку к зарплате.` });
  if ((dr.contractSeasons ?? 9) <= 1 && form > 0.55)
    return (dr.request = { type: "contract", text: `${name} в хорошей форме и хочет продлить контракт.` });
  return null;
}

// morale reason for the UI (which factor dominates right now).
export function moraleReason(dr) {
  const m = dr.morale ?? 0.6;
  if (m >= 0.72) return "в приподнятом настроении";
  if (m >= 0.55) return "доволен";
  if (m >= 0.4) return "нейтрально";
  if (m >= 0.28) return "недоволен";
  return "на грани ухода";
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
