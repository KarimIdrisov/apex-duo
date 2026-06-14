// ApexWeb/src/sponsors.js — pure sponsor model: deals with a per-race retainer + an objective
// bonus + a happiness meter. Deterministic generation from team tier + seed. No UI, no I/O.
import { mix32 } from "./rng.js";

export const OBJ = { PODIUM: "podium", FINISH_ABOVE: "finishAbove", POINTS: "points", BEAT: "beatTeam" };

const TITLE_NAMES = ["Aramco", "Oracle", "Petronas", "Rolex", "DHL", "Pirelli", "Heineken", "MoneyGram", "Qualcomm", "Santander"];
const SEC_NAMES = ["Tommy", "Estrella", "CrowdStrike", "Globant", "Tezos", "Lenovo", "Puma", "Cognizant", "Webex", "VodaFone"];

export function objectiveLabel(obj) {
  switch (obj.type) {
    case OBJ.PODIUM: return "Подиум";
    case OBJ.FINISH_ABOVE: return `Финиш в топ-${obj.param}`;
    case OBJ.POINTS: return `Очки: ≥${obj.param}`;
    case OBJ.BEAT: return `Опередить ${obj.param}`;
    default: return "—";
  }
}

// expected best-car finishing position for a team tier (idx 0 = strongest).
function expectedPos(teamIdx) { return Math.min(20, 1 + teamIdx * 2); }

// a deterministic sponsor for a team, indexed by `n`. kind = "title" | "secondary".
function makeSponsor(teamIdx, seed, kind, n) {
  const r = mix32(((teamIdx + 1) * 131 + n * 977 + (seed >>> 0)) >>> 0);
  const names = kind === "title" ? TITLE_NAMES : SEC_NAMES;
  const name = names[r % names.length];
  const exp = expectedPos(teamIdx), strength = 10 - Math.min(10, teamIdx);   // 10 (top) .. 0 (back)
  const retainer = kind === "title" ? 220 + strength * 16 : 110 + strength * 8;
  const bonus = kind === "title" ? 320 + strength * 20 : 160 + strength * 10;
  let objective;
  if (kind === "title" && teamIdx <= 1) objective = { type: OBJ.PODIUM };
  else if (kind === "title") objective = { type: OBJ.FINISH_ABOVE, param: Math.max(1, exp - 2) };
  else objective = { type: OBJ.FINISH_ABOVE, param: Math.min(15, exp + 2) };
  return { name, kind, retainer, bonus, objective, happiness: 0.6 };
}

// the starting roster for a new career: 1 title + 2 secondary, deterministic.
export function defaultSponsors(teamIdx, seed) {
  return [makeSponsor(teamIdx, seed, "title", 0), makeSponsor(teamIdx, seed, "secondary", 1), makeSponsor(teamIdx, seed, "secondary", 2)];
}

// 3 title-sponsor offers to choose from at season start (safe / balanced / ambitious).
export function titleOffers(teamIdx, seed) {
  const exp = expectedPos(teamIdx);
  return [0, 1, 2].map(v => {
    const o = makeSponsor(teamIdx, seed, "title", 10 + v);
    if (v === 0) { o.objective = { type: OBJ.FINISH_ABOVE, param: Math.min(15, exp + 1) }; o.bonus = Math.round(o.bonus * 0.7); o.retainer = Math.round(o.retainer * 1.1); }
    if (v === 2) { o.objective = teamIdx <= 2 ? { type: OBJ.PODIUM } : { type: OBJ.FINISH_ABOVE, param: Math.max(1, exp - 3) }; o.bonus = Math.round(o.bonus * 1.5); o.retainer = Math.round(o.retainer * 0.9); }
    return o;
  });
}

// evaluate a sponsor against a race result for the player team.
// ctx = { bestPos:int, points:int, beat:Set<teamName> }
export function evaluateSponsor(sp, ctx) {
  let met = false;
  switch (sp.objective.type) {
    case OBJ.PODIUM: met = ctx.bestPos <= 3; break;
    case OBJ.FINISH_ABOVE: met = ctx.bestPos <= sp.objective.param; break;
    case OBJ.POINTS: met = ctx.points >= sp.objective.param; break;
    case OBJ.BEAT: met = ctx.beat.has(sp.objective.param); break;
  }
  return { met, payout: sp.retainer + (met ? sp.bonus : 0), dHappiness: met ? 0.06 : -0.05 };
}
