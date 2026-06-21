// ApexWeb/src/directors.js — co-director specialty system. Pure & deterministic. Each player's
// director has a specialty that buffs a team area (meta) and, for some, the race. Existing systems
// consult these thin multiplier helpers; no new sim-influence path is introduced.

export const SPECIALTIES = {
  aero:       { key: "aero",       label: "Аэродинамик", area: "aero",  race: false, blurb: "разработка аэро дешевле и эффективнее" },
  engine:     { key: "engine",     label: "Моторист",    area: "power", race: true,  blurb: "развитие ДВС дешевле, мягче износ, больше от ERS" },
  strategist: { key: "strategist", label: "Стратег",     area: null,    race: true,  blurb: "точнее окна пита и прогноз; лучше пит-колы в гонке" },
  mechanic:   { key: "mechanic",   label: "Гл. механик", area: null,    race: false, blurb: "крепче пит-крю, меньше брака на пит-стопе" },
  financier:  { key: "financier",  label: "Финансист",   area: null,    race: false, blurb: "больше стартовый бюджет и доход спонсоров" },
  mentor:     { key: "mentor",     label: "Наставник",   area: null,    race: true,  blurb: "пилоты растут быстрее, мягче падение морали" },
};
export const SPECIALTY_KEYS = Object.keys(SPECIALTIES);

// tuning knobs; start conservative, balance-check before raising.
export const DEV_DISCOUNT = 0.18, DEV_GAIN = 0.15, PU_WEAR_REDUCE = 0.15,
  SPONSOR_BONUS = 0.15, BUDGET_BONUS = 0.15, DRIVER_DEV_BONUS = 0.20, BOTCH_REDUCE = 0.15;

// weight of a specialty on the team: 1 if a primary director has it, 0.5 if only a solo assistant carries it.
export function specialtyWeight(career, key) {
  let w = 0;
  for (const d of (career && career.directors) || []) {
    if (d.specialty === key) w = Math.max(w, 1);
    if (d.assistant === key) w = Math.max(w, 0.5);
  }
  return w;
}

const areaOf = key => SPECIALTIES[key] && SPECIALTIES[key].area;
function areaWeight(career, areaKey) {                       // weight of whichever specialty owns this area
  for (const k of SPECIALTY_KEYS) if (areaOf(k) === areaKey) return specialtyWeight(career, k);
  return 0;
}

export function devCostMult(career, areaKey) { return 1 - DEV_DISCOUNT * areaWeight(career, areaKey); }
export function devGainMult(career, areaKey) { return 1 + DEV_GAIN * areaWeight(career, areaKey); }
// engine/mentor/mechanic race & driver effects: puWearMult → career.js (player PU wear), driverDevMult → tickDriverRace (in-season driver dev), botchMult → main.js (pit botch/disaster chance).
export function puWearMult(career)       { return 1 - PU_WEAR_REDUCE * specialtyWeight(career, "engine"); }
export function sponsorIncomeMult(career){ return 1 + SPONSOR_BONUS * specialtyWeight(career, "financier"); }
export function startBudgetMult(career)  { return 1 + BUDGET_BONUS * specialtyWeight(career, "financier"); }
export function driverDevMult(career)    { return 1 + DRIVER_DEV_BONUS * specialtyWeight(career, "mentor"); }
export function botchMult(career)        { return 1 - BOTCH_REDUCE * specialtyWeight(career, "mechanic"); }

// co-op: two primary directors with different valid specialties; solo: one valid specialty.
export function validDirectors(directors, coop) {
  if (!Array.isArray(directors) || !directors.length) return false;
  for (const d of directors) if (!SPECIALTIES[d.specialty]) return false;
  if (coop) { if (directors.length !== 2) return false; if (directors[0].specialty === directors[1].specialty) return false; }
  return true;
}
