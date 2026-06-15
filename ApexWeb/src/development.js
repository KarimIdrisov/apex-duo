// ApexWeb/src/development.js — pure MM-style car-development model. The player develops PARTS;
// parts compose into the 5 sim indicators (power/aero/tyre/fuel/rel) via PART_CONTRIB. The sim still
// reads the 5 composed indicators (composeCar). AI develops parts deterministically (catch-up biased).
import { mix32 } from "./rng.js";
import { TEAMS } from "./data.js";
import { devMult } from "./staff.js";
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

// upgrade sizes: part-level gain, $k cost, races to complete, risk (chance-weighted shortfall).
export const PROJECT_SIZE = {
  small:  { gain: 0.012, cost: 1200, races: 1, risk: 0.10, label: "Малый" },
  medium: { gain: 0.024, cost: 3000, races: 2, risk: 0.20, label: "Средний" },
  large:  { gain: 0.042, cost: 6000, races: 3, risk: 0.32, label: "Крупный" },
};

export const COST_CAP = 30000;
const AI_DEV_RATE = 0.0060;   // per round, × facility × catch-up, spread over the team's parts

const zeroParts = () => ({ fw: 0, rw: 0, floor: 0, sidepods: 0, susp: 0, pu: 0 });
function clampInd(k, v) { return k === "rel" ? Math.max(0.3, Math.min(0.995, v)) : Math.max(0.3, Math.min(1.20, v)); }

// part levels -> indicator deltas via PART_CONTRIB.
export function partsToDeltas(parts) {
  const d = { power: 0, aero: 0, tyre: 0, fuel: 0, rel: 0 };
  if (!parts) return d;
  for (const p of PARTS) {
    const lvl = parts[p] || 0, c = PART_CONTRIB[p];
    for (const k in c) d[k] += lvl * c[k];
  }
  return d;
}

// base car + composed part deltas -> the effective car the sim composes. energy passes through.
export function effectiveCar(baseCar, parts) {
  const dlt = partsToDeltas(parts);
  const out = { ...baseCar };
  for (const k of INDICATORS) {
    const b = baseCar[k] ?? (k === "tyre" || k === "fuel" ? 1 : 0.85);
    out[k] = clampInd(k, b + (dlt[k] || 0));
  }
  return out;
}

// start a player upgrade project on a PART. Returns the project, or null (busy / can't afford / cost cap / invalid).
export function startProject(career, part, size) {
  if (career.project) return null;
  const spec = PROJECT_SIZE[size];
  if (!spec || !PARTS.includes(part)) return null;
  if (career.money < spec.cost) return null;
  if (career.costCap && (career.devSpentThisSeason || 0) + spec.cost > COST_CAP) return null;
  career.money -= spec.cost;
  career.devSpentThisSeason = (career.devSpentThisSeason || 0) + spec.cost;
  career.project = { part, size, racesLeft: spec.races, gain: spec.gain, risk: spec.risk };
  return career.project;
}

// advance development one round: progress the player's part project (complete -> risk-shaved gain,
// scaled by design office + academy R&D) and develop every AI team's parts deterministically.
export function tickDevelopment(career) {
  career.parts = career.parts || {};
  for (const t of TEAMS) career.parts[t.name] = career.parts[t.name] || zeroParts();
  const events = [];
  if (career.project) {
    career.project.racesLeft -= 1;
    if (career.project.racesLeft <= 0) {
      const p = career.project;
      const roll = mix32(((career.seed >>> 0) + career.round * 2654435761) >>> 0) / 4294967296;
      const gain = p.gain * (1 - p.risk * roll) * devMult(career.staff) * (1 + academyDevBonus(career));
      career.parts[TEAMS[career.teamIdx].name][p.part] += gain;
      events.push({ type: "project_done", part: p.part, gain });
      career.project = null;
    }
  }
  TEAMS.forEach((t, i) => {
    if (i === career.teamIdx) return;
    const catchUp = 0.5 + i * 0.06;
    const base = AI_DEV_RATE * (t.facility ?? 0.75) * catchUp;
    career.parts[t.name].floor += base;   // AI spreads dev across the two biggest-bang parts
    career.parts[t.name].pu += base;
  });
  return events;
}
