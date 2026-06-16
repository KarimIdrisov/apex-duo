// ApexWeb/src/staff.js — pure staff & facilities model. Composes into personnel (pitMult/strategy),
// a development multiplier, and a per-race upkeep. Deterministic. At the start (no upgrades) the
// composed personnel matches genPersonnel's range, so the grid stays balance-neutral.
import { mix32 } from "./rng.js";

export const STAFF_ROLES = ["designer", "strategist", "pitCrew"];
export const ROLE_LABEL = { designer: "Гл. конструктор", strategist: "Стратег", pitCrew: "Пит-крю" };
export const FACILITIES = ["design", "pit", "factory"];
export const FAC_LABEL = { design: "КБ", pit: "Пит-бокс", factory: "Завод" };
export const FAC_MAX = 5;

export const STAFF_UPGRADE_COST = 2500;   // $k to raise a staff rating one step
export const FAC_UPGRADE_BASE = 3500;     // $k base for a facility level (×(level+1))
const STAFF_STEP = 0.06;

const clamp01 = v => Math.max(0, Math.min(1, v));

// initial staff/facilities seeded from the team facility strength (0..1).
export function initStaff(teamFacility, seed) {
  const f = teamFacility ?? 0.75;
  const r = mix32((Math.round(f * 1000) + (seed >>> 0) * 7919) >>> 0) / 4294967296;
  const base = clamp01(f + (r - 0.5) * 0.06);
  const lv = Math.max(0, Math.min(FAC_MAX, Math.round(f * 3)));
  const dft = () => ({ name: "—", specialty: null, rating: base, salary: salaryForStaff(base), contractSeasons: 3 });   // default in-house staff
  return { designer: base, strategist: base, pitCrew: base, fatigue: 0, facilities: { design: lv, pit: lv, factory: lv },
    people: { designer: dft(), strategist: dft(), pitCrew: dft() } };
}

// staff fatigue (Phase 4): calendar density wears the crew down — tight turnarounds (back-to-backs,
// triple-headers) accumulate fatigue; normal weeks recover a little; long breaks reset most of it.
// Fatigue makes pit stops slower and slows development; a long gap / the winter rests it fully.
export const FATIGUE_MAX = 0.85;
export function applyCalendarLoad(staff, gapDays) {
  if (!staff) return;
  const d = gapDays == null ? 14 : gapDays;
  let delta;
  if (d <= 8) delta = 0.16;          // back-to-back: crew runs hot
  else if (d >= 25) delta = -0.55;   // summer/winter break: big reset
  else if (d >= 19) delta = -0.28;   // long gap: real rest
  else delta = -0.04;                // normal week: slight recovery
  staff.fatigue = Math.max(0, Math.min(FATIGUE_MAX, (staff.fatigue || 0) + delta));
}

// personnel the sim reads: pit crew + pit facility -> pitMult (lower = faster); strategist + design -> strategy.
// fatigue slows the stop (higher pitMult).
export function composePersonnel(staff) {
  if (!staff) return { pitMult: 1.0, strategy: 0.75 };
  const fat = staff.fatigue || 0;
  const pit = clamp01(staff.pitCrew + (staff.facilities.pit / FAC_MAX) * 0.15);
  const pitMult = (1.15 - 0.4 * pit) * (1 + fat * 0.10) - specialtyBonus(staff, "pit");   // T2: pit-ace specialist
  return { pitMult: Math.max(0.6, pitMult), strategy: clamp01(staff.strategist + (staff.facilities.design / FAC_MAX) * 0.05 + specialtyBonus(staff, "strategy")) };
}

// development multiplier from the chief designer + the design office (1.0 neutral at designer 0.6 / no facility).
// fatigue drags it down a little; an aero specialist speeds R&D (T2).
export function devMult(staff) {
  if (!staff) return 1.0;
  const fat = staff.fatigue || 0;
  return (1 + (staff.designer - 0.6) * 0.5 + (staff.facilities.design / FAC_MAX) * 0.3 + specialtyBonus(staff, "dev")) * (1 - fat * 0.12);
}

// per-race upkeep ($k) — bigger facilities cost more to run (tuned so a top team can run a full
// facility set + develop + pay salaries and stay comfortably solvent; M5 corridor).
export function upkeep(staff) {
  if (!staff) return 0;
  const lv = staff.facilities;
  return 70 * (lv.design + lv.pit + lv.factory);
}

// upgrade a staff rating one step. Returns true if applied.
export function upgradeStaff(career, role) {
  if (!STAFF_ROLES.includes(role) || !career.staff) return false;
  if (career.money < STAFF_UPGRADE_COST || career.staff[role] >= 0.99) return false;
  career.money -= STAFF_UPGRADE_COST;
  career.capSpent = (career.capSpent || 0) + STAFF_UPGRADE_COST;   // cost-cap accounting
  career.staff[role] = clamp01(career.staff[role] + STAFF_STEP);
  return true;
}

// upgrade a facility one level (cost scales with the next level). Returns true if applied.
export function upgradeFacility(career, which) {
  if (!FACILITIES.includes(which) || !career.staff) return false;
  const lvl = career.staff.facilities[which];
  if (lvl >= FAC_MAX) return false;
  const cost = FAC_UPGRADE_BASE * (lvl + 1);
  if (career.money < cost) return false;
  career.money -= cost;
  career.capSpent = (career.capSpent || 0) + cost;   // cost-cap accounting
  career.staff.facilities[which] = lvl + 1;
  return true;
}

// --- D6: named staff market + specialties ---

// specialty tags — each belongs to one role and now grants a CONCRETE bonus (T2): aero → faster R&D,
// mechanical → car reliability, tactician → race strategy (SC/pit/wet), pit ace → faster stops.
export const SPECIALTIES = {
  aero:       { label: "Аэродинамик",  role: "designer",   fx: "dev",      fxVal: 0.06,  fxLabel: "+6% к разработке" },
  mechanical: { label: "Механик",      role: "designer",   fx: "rel",      fxVal: 0.015, fxLabel: "+надёжность машины" },
  tactician:  { label: "Тактик",       role: "strategist", fx: "strategy", fxVal: 0.05,  fxLabel: "+стратегия (SC/питы/дождь)" },
  pitace:     { label: "Ас пит-стопа", role: "pitCrew",    fx: "pit",      fxVal: 0.04,  fxLabel: "быстрее пит-стопы" },
};
// total bonus of a given kind across the team's hired specialists.
export function specialtyBonus(staff, kind) {
  if (!staff || !staff.people) return 0;
  let b = 0;
  for (const r of STAFF_ROLES) { const sp = staff.people[r] && staff.people[r].specialty, fx = sp && SPECIALTIES[sp]; if (fx && fx.fx === kind) b += fx.fxVal; }
  return b;
}
// reliability bonus the team's mechanical specialist adds to the player's car (read in applyRaceMods).
export function staffRelBonus(staff) { return specialtyBonus(staff, "rel"); }

// a fictional market of specialists (≥3 per role; names invented, no real people).
export const STAFF_MARKET_POOL = [
  { id: "d1", name: "Адриан Коул",  role: "designer",   specialty: "aero",       rating: 0.93 },
  { id: "d2", name: "Л�