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
  const dft = () => ({ name: "—", specialty: null, rating: base, salary: salaryForStaff(base) });   // default in-house staff
  return { designer: base, strategist: base, pitCrew: base, facilities: { design: lv, pit: lv, factory: lv },
    people: { designer: dft(), strategist: dft(), pitCrew: dft() } };
}

// personnel the sim reads: pit crew + pit facility -> pitMult (lower = faster); strategist + design -> strategy.
export function composePersonnel(staff) {
  if (!staff) return { pitMult: 1.0, strategy: 0.75 };
  const pit = clamp01(staff.pitCrew + (staff.facilities.pit / FAC_MAX) * 0.15);
  return { pitMult: 1.15 - 0.4 * pit, strategy: clamp01(staff.strategist + (staff.facilities.design / FAC_MAX) * 0.05) };
}

// development multiplier from the chief designer + the design office (1.0 neutral at designer 0.6 / no facility).
export function devMult(staff) {
  if (!staff) return 1.0;
  return 1 + (staff.designer - 0.6) * 0.5 + (staff.facilities.design / FAC_MAX) * 0.3;
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
  career.staff.facilities[which] = lvl + 1;
  return true;
}

// --- D6: named staff market + specialties ---

// specialty tags (identity/flavor) — each belongs to one role; the rating jump is the mechanical effect.
export const SPECIALTIES = {
  aero:       { label: "Аэродинамик", role: "designer" },
  mechanical: { label: "Механик",     role: "designer" },
  tactician:  { label: "Тактик",      role: "strategist" },
  pitace:     { label: "Ас пит-стопа", role: "pitCrew" },
};

// a fictional market of specialists (≥3 per role; names invented, no real people).
export const STAFF_MARKET_POOL = [
  { id: "d1", name: "Адриан Коул",  role: "designer",   specialty: "aero",       rating: 0.93 },
  { id: "d2", name: "Лука Ферри",   role: "designer",   specialty: "mechanical", rating: 0.85 },
  { id: "d3", name: "Йонас Берг",   role: "designer",   specialty: "aero",       rating: 0.78 },
  { id: "s1", name: "Мария Сантос", role: "strategist", specialty: "tactician",  rating: 0.91 },
  { id: "s2", name: "Том Прайс",    role: "strategist", specialty: "tactician",  rating: 0.83 },
  { id: "s3", name: "Икэр Руис",    role: "strategist", specialty: "tactician",  rating: 0.76 },
  { id: "p1", name: "Ганс Вебер",   role: "pitCrew",    specialty: "pitace",     rating: 0.90 },
  { id: "p2", name: "Дэв Капур",    role: "pitCrew",    specialty: "pitace",     rating: 0.82 },
  { id: "p3", name: "Сэм О'Брайен", role: "pitCrew",    specialty: "pitace",     rating: 0.75 },
];

// staff wage ($k/race) for a rating — used for the hire fee + displayed salary (cheap; a star ~$0.2M).
export function salaryForStaff(rating) { return Math.round(40 + Math.pow(Math.max(0, rating - 0.6), 1.6) * 900); }

// the hireable market for a season seed — deterministic order (refreshes by seed), each priced.
export function staffMarket(seed) {
  const s = seed >>> 0;
  return STAFF_MARKET_POOL
    .map(p => ({ ...p, salary: salaryForStaff(p.rating), _o: mix32((s * 2654435761 + p.id.charCodeAt(0) * 131 + p.id.charCodeAt(1)) >>> 0) }))
    .sort((a, b) => a._o - b._o)
    .map(({ _o, ...p }) => p);
}

// hire a specialist: pay a lump fee (≈8 races of wage), jump that role's rating, record the person.
export function hireStaff(career, person) {
  if (!career || !career.staff || !person || !STAFF_ROLES.includes(person.role)) return false;
  const fee = salaryForStaff(person.rating) * 8;
  if (career.money < fee) return false;
  career.money -= fee;
  career.staff[person.role] = clamp01(person.rating);
  career.staff.people = career.staff.people || {};
  career.staff.people[person.role] = { name: person.name, specialty: person.specialty, rating: person.rating, salary: salaryForStaff(person.rating) };
  return true;
}

// total staff wage bill ($k/race) — a displayed readout (NOT deducted, to keep the economy safe).
export function staffSalaries(staff) {
  if (!staff || !staff.people) return 0;
  return STAFF_ROLES.reduce((s, r) => s + ((staff.people[r] && staff.people[r].salary) || 0), 0);
}
