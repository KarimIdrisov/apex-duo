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
  return { designer: base, strategist: base, pitCrew: base, facilities: { design: lv, pit: lv, factory: lv } };
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

// per-race upkeep ($k) — bigger facilities cost more to run.
export function upkeep(staff) {
  if (!staff) return 0;
  const lv = staff.facilities;
  return 120 * (lv.design + lv.pit + lv.factory);
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
