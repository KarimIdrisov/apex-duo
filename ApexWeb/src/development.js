// ApexWeb/src/development.js — pure MM-style car-development model. The player develops PARTS;
// parts compose into the 5 sim indicators (power/aero/tyre/fuel/rel) via PART_CONTRIB. The sim still
// reads the 5 composed indicators (composeCar). AI develops parts deterministically (catch-up biased).
import { mix32 } from "./rng.js";
import { TEAMS } from "./data.js";
import { devMult, staffRelBonus } from "./staff.js";
import { academyDevBonus } from "./academy.js";

export const INDICATORS = ["power", "aero", "tyre", "fuel", "rel"];

// the developable parts and how each contributes to the indicators (per unit of part level).
export const PARTS = ["fw", "rw", "floor", "sidepods", "susp", "pu"];
export const PART_LABEL = { fw: "Переднее крыло", rw: "Заднее крыло", floor: "Днище", sidepods: "Понтоны", susp: "Подвеска", pu: "Силовая установка" };
export const PART_CONTRIB = {
  fw:       { aero: 0.50, tyre: 0.20 },
  rw:       { aero: 0.45, fuel: 0.10 },
  floor:    { aero: 0.60, tyre: 0.15 },
  sidepods: { fuel: 0.40, rel: 0.20, aero: 0.15 },
  susp:     { tyre: 0.50, aero: 0.20 },
  pu:       { power: 0.70, fuel: 0.30, rel: 0.15 },
};

// upgrade sizes: part-level gain, $k cost, DAYS to complete, risk (chance-weighted shortfall).
// days are spent from the calendar gap between races — a small fits one normal (14d) gap; a large
// needs a long gap (summer break) or several gaps. (`races` kept as a coarse legacy hint.)
// days = DESIGN time (R&D); buildDays = MANUFACTURING time after design before the part is fitted (F2,
// MM-style design→build→fit). The outcome is rolled when design finishes (you see what you got), then
// the part is built, then fitted (applied + run-in).
export const PROJECT_SIZE = {
  small:  { gain: 0.012, cost: 1200, days: 8,  buildDays: 6,  races: 1, risk: 0.10, label: "Малый" },
  medium: { gain: 0.024, cost: 3000, days: 20, buildDays: 12, races: 2, risk: 0.20, label: "Средний" },
  large:  { gain: 0.042, cost: 6000, days: 34, buildDays: 20, races: 3, risk: 0.32, label: "Крупный" },
};

export const COST_CAP = 30000;
const AI_DEV_RATE = 0.0060;          // per ~14-day race gap, × facility × catch-up, over the team's parts
const AI_DEV_PER_DAY = AI_DEV_RATE / 14;   // calendar-driven: AI gains scale with the gap length

// --- E1: development approach, diminishing returns, outcome tiers, parallel projects, run-in -------
// Each upgrade is now a gamble. Approach scales the target gain, the outcome variance, and the
// reliability hit the new part carries until it's run in. Aggressive = bigger target but it can flop
// and it hurts reliability; conservative = safe and modest.
export const APPROACH = {
  safe:       { gainK: 0.78, varK: 0.5, relDebt: 0.000, label: "Консервативный", hint: "надёжно, меньше прирост" },
  balanced:   { gainK: 1.00, varK: 1.0, relDebt: 0.012, label: "Сбалансированный", hint: "баланс риска и отдачи" },
  aggressive: { gainK: 1.35, varK: 2.0, relDebt: 0.032, label: "Агрессивный",     hint: "большой прирост, риск надёжности" },
};
export const PART_CEILING = 0.34;    // per-part development ceiling under current regs → diminishing returns
export const RUNIN_RACES = 3;        // races a freshly-fitted part stays "unproven" (elevated breakage)
const SIZE_DEBT = { small: 0.7, medium: 1.0, large: 1.3 };   // bigger parts carry more run-in risk

// parallel programs: a bigger factory runs more at once (factory 0→1 slot, 2→2, 4→3).
export function maxProjects(career) {
  const fac = (career && career.staff && career.staff.facilities) ? (career.staff.facilities.factory || 0) : 0;
  return 1 + Math.floor(fac / 2);
}
// diminishing-returns factor as a part matures toward the regulation ceiling (never fully zero).
export function maturityFactor(level) { return Math.max(0.15, 1 - (level || 0) / PART_CEILING); }
// seeded outcome tier for a completed project. Aggressive widens BOTH tails (more прорыв AND more провал).
export function projectOutcome(approachKey, roll) {
  const a = APPROACH[approachKey] || APPROACH.balanced;
  const tail = 0.10 * a.varK;   // провал mass
  const brk  = 0.10 * a.varK;   // прорыв mass
  if (roll < tail)         return { mult: 0.15, label: "провал",   extraDebt: 0.020 };
  if (roll < 0.45)      