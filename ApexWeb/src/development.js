// ApexWeb/src/development.js — pure car-development model. Deltas add onto TEAMS[].car; the sim
// reads the composed effective car. AI dev is deterministic (facility-scaled, catch-up biased).
import { mix32 } from "./rng.js";
import { TEAMS } from "./data.js";
import { devMult } from "./staff.js";

export const INDICATORS = ["power", "aero", "tyre", "fuel", "rel"];
export const INDICATOR_LABEL = { power: "Мотор", aero: "Аэро", tyre: "Шина", fuel: "Эконом", rel: "Надёжн." };

// upgrade sizes: gain to the indicator, $k cost, races to complete, risk (chance-weighted shortfall).
export const PROJECT_SIZE = {
  small:  { gain: 0.008, cost: 1200, races: 1, risk: 0.10, label: "Малый" },
  medium: { gain: 0.016, cost: 3000, races: 2, risk: 0.20, label: "Средний" },
  large:  { gain: 0.028, cost: 6000, races: 3, risk: 0.32, label: "Крупный" },
};

export const COST_CAP = 30000;     // $k/season dev-spend ceiling when career.costCap is on
// AI development tuning (per round): rate × facility × catch-up(team index).
const AI_DEV_RATE = 0.0040;

const zeroDev = () => ({ power: 0, aero: 0, tyre: 0, fuel: 0, rel: 0 });
function clampInd(k, v) { return k === "rel" ? Math.max(0.3, Math.min(0.995, v)) : Math.max(0.3, Math.min(1.20, v)); }

// base car + dev deltas -> the effective car the sim composes. energy passes through (composeCar drops it).
export function effectiveCar(baseCar, dev) {
  const d = dev || zeroDev();
  const out = { ...baseCar };
  for (const k of INDICATORS) {
    const b = baseCar[k] ?? (k === "tyre" || k === "fuel" ? 1 : 0.85);
    out[k] = clampInd(k, b + (d[k] || 0));
  }
  return out;
}

// start a player upgrade project. Returns the project, or null (busy / can't afford / cost cap / invalid).
export function startProject(career, indicator, size) {
  if (career.project) return null;
  const spec = PROJECT_SIZE[size];
  if (!spec || !INDICATORS.includes(indicator)) return null;
  if (career.money < spec.cost) return null;
  if (career.costCap && (career.devSpentThisSeason || 0) + spec.cost > COST_CAP) return null;
  career.money -= spec.cost;
  career.devSpentThisSeason = (career.devSpentThisSeason || 0) + spec.cost;
  career.project = { indicator, size, racesLeft: spec.races, gain: spec.gain, risk: spec.risk };
  return career.project;
}

// advance development one round: progress the player's project (complete -> risk-shaved gain) and
// develop every AI team deterministically (facility-scaled, weaker teams catch up faster).
export function tickDevelopment(career) {
  career.carDev = career.carDev || {};
  for (const t of TEAMS) career.carDev[t.name] = career.carDev[t.name] || zeroDev();
  const events = [];
  if (career.project) {
    career.project.racesLeft -= 1;
    if (career.project.racesLeft <= 0) {
      const p = career.project;
      const roll = mix32(((career.seed >>> 0) + career.round * 2654435761) >>> 0) / 4294967296;  // hash, not a stream draw
      const gain = p.gain * (1 - p.risk * roll) * devMult(career.staff);
      career.carDev[TEAMS[career.teamIdx].name][p.indicator] += gain;
      events.push({ type: "project_done", indicator: p.indicator, gain });
      career.project = null;
    }
  }
  TEAMS.forEach((t, i) => {
    if (i === career.teamIdx) return;
    const catchUp = 0.5 + i * 0.06;                  // weaker teams (higher index) develop faster
    const base = AI_DEV_RATE * (t.facility ?? 0.75) * catchUp;
    career.carDev[t.name].power += base;
    career.carDev[t.name].aero += base;
  });
  return events;
}
