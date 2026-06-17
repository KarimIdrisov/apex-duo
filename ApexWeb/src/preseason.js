// ApexWeb/src/preseason.js — pre-season setup math: car build (budget → part levels, reusing the
// development.js part model), season ambition (board target + reward multiplier), and a default
// auto-build. Pure & deterministic. The title-sponsor pick reuses career.chooseTitleSponsor as-is.
import { DEV_AREAS, bestPartForArea } from "./development.js";
import { devCostMult } from "./directors.js";
import { TEAMS } from "./data.js";

export const BUILD_STEP_GAIN = 0.04;     // part-level gained per build step
export const BUILD_STEP_BASE = 1200;     // $k base cost of a step (pre discount / maturity)

function teamName(career) { return (career && career._myTeamName) || TEAMS[(career && career.teamIdx) || 0].name; }
function partForArea(career, areaKey) {
  if (areaKey === "power") return "pu";                        // engine: bestPartForArea skips pu (ДВС tab in-season), build it directly here
  const a = DEV_AREAS.find(x => x.key === areaKey);            // DEV_AREAS: key === indicator
  return a ? bestPartForArea(career, a.indicator) : null;
}

// cost of the next build step in an area: base × maturity (rises with level) × specialty discount.
export function stepCost(career, areaKey) {
  const part = partForArea(career, areaKey); if (!part) return Infinity;
  const lvl = ((career.parts && career.parts[teamName(career)]) || {})[part] || 0;
  return Math.round(BUILD_STEP_BASE * (1 + lvl * 4) * devCostMult(career, areaKey));
}

// buy one build step in an area: spend, raise that area's best part by BUILD_STEP_GAIN. false if broke.
export function buildStep(career, areaKey) {
  const cost = stepCost(career, areaKey), part = partForArea(career, areaKey);
  if (!part || career.money < cost) return false;
  const tn = teamName(career);
  career.parts = career.parts || {}; career.parts[tn] = career.parts[tn] || {};
  career.parts[tn][part] = (career.parts[tn][part] || 0) + BUILD_STEP_GAIN;
  career.money -= cost;
  return true;
}

// season ambition → board target (tier ± offset) + a reward multiplier (scales the season prize fund).
export const AMBITIONS = {
  modest:    { key: "modest",    label: "Скромная",     offset: +2, reward: 0.8 },
  realistic: { key: "realistic", label: "Реалистичная", offset: 0,  reward: 1.0 },
  ambitious: { key: "ambitious", label: "Амбициозная",  offset: -2, reward: 1.3 },
};
export function applyAmbition(career, key) {
  const a = AMBITIONS[key] || AMBITIONS.realistic, tier = (career.teamIdx || 0) + 1;
  career.board = career.board || {};
  career.board.targetPos = Math.max(1, Math.min(TEAMS.length, tier + a.offset));
  career.rewardMult = a.reward;
  return career.board.targetPos;
}

// the "skip" default: spread the budget across areas in round-robin until the cheapest step is unaffordable.
export function autoBuild(career) {
  const areas = DEV_AREAS.map(a => a.key);
  let guard = 0;
  while (guard++ < 1000) {
    const affordable = areas.filter(a => career.money >= stepCost(career, a));
    if (!affordable.length) break;
    affordable.sort((x, y) => stepCost(career, x) - stepCost(career, y));
    buildStep(career, affordable[0]);
  }
}
