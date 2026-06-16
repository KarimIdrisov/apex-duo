// ApexWeb/src/team_events.js — deterministic career events (Phase C): buyout suitors, parent
// pull-out, rare money events, living-grid churn. Pure (no I/O); seeded from career.seed + round/
// season so a career is reproducible. Rare + high-impact + performance-tied (not pure RNG).
import { mix32 } from "./rng.js";

const SUITORS = {
  oem:       { names: ["Vanguard Motors", "Meridian Auto", "Aterra", "Helios Automotive", "Norden"],     puMaker: true,  grant: 9000, cashMin: 5000, cashMax: 12000, targetDelta: -2, label: "Автоконцерн" },
  tech:      { names: ["Quantel", "Nexus Systems", "Orbital", "Vireo", "Datapulse"],                       puMaker: false, grant: 6000, cashMin: 6000, cashMax: 14000, targetDelta: -1, label: "Техногигант" },
  sovereign: { names: ["Falcon Capital", "Azure Fund", "Crownbridge", "Sterling Holdings"],                puMaker: false, grant: 8000, cashMin: 8000, cashMax: 18000, targetDelta: -3, label: "Суверенный фонд" },
};
const REBRAND_COLORS = ["#1fa05a", "#d44a3a", "#3d6fd0", "#c9a227", "#7a4fd0", "#0e9aa0"];
const f = (s) => (mix32(s >>> 0) >>> 0) / 4294967296;   // 0..1 from a seed

// 0..1 how attractive the team is to suitors this off-season (better result + being independent).
export function attractiveness(career, finalPos, teams = 11) {
  const posScore = 1 - (Math.max(1, finalPos) - 1) / Math.max(1, teams - 1);
  const indep = (career.backer && career.backer.type === "independent") ? 1 : 0;
  return Math.max(0, Math.min(1, 0.55 * posScore + 0.45 * indep));
}

// maybe generate a buyout offer for the player at the season boundary. null if none. Deterministic.
export function suitorOffer(career, finalPos, seed) {
  if (career.backer && career.backer.type === "works") return null;     // already owned by a concern
  const a = attractiveness(career, finalPos);
  if (f(seed + 12345) > 0.30 + 0.55 * a) return null;                   // chance scales with attractiveness
  const types = ["oem", "tech", "sovereign"];
  const t = types[mix32((seed >>> 0) + 777) % 3], S = SUITORS[t];
  const name = S.names[mix32((seed >>> 0) + 222) % S.names.length];
  const cash = Math.round(S.cashMin + (S.cashMax - S.cashMin) * f(seed + 999));
  const target = Math.max(1, (finalPos | 0) + S.targetDelta);
  return { suitor: name, type: t, typeLabel: S.label, cash, grant: S.grant, puMaker: S.puMaker, target,
    newName: name + " GP", newColor: REBRAND_COLORS[mix32((seed >>> 0) + 333) % REBRAND_COLORS.length] };
}

// should the concern pull funding from an underperforming works team this off-season?
export function parentPullout(career, finalPos) {
  if (!career.backer || career.backer.type !== "works") return false;
  const target = (career.board && career.board.targetPos) || finalPos;
  const conf = (career.board && career.board.confidence != null) ? career.board.confidence : 0.5;
  return finalPos > target + 3 && conf < 0.30;
}

// rare per-race money event. Returns {delta($k), news} or null. Deterministic.
export function moneyEvent(career, round, seed) {
  if (f(seed + round * 131 + 50) > 0.12) return null;                   // ~12% of races
  const pick = mix32((seed >>> 0) + round * 977) % 4;
  if (pick === 0) return { delta: 1500, news: "Внезапный партнёр: разовое спонсорское вливание +$1.5M." };
  if (pick === 1) return { delta: -800, news: "Штраф FIA за нарушение регламента: −$0.8M." };
  if (pick === 2) return { delta: 1000, news: "Бонус за маркетинговую веху: +$1.0M." };
  return { delta: 2000, news: "Владелец сделал разовое вливание: +$2.0M." };
}

// living grid: pick a rival INDEPENDENT to be acquired this off-season (news + small strength bump).
// teamNames = all team names; playerName excluded. Returns {team, suitorLabel} or null. Deterministic.
export function gridChurn(teamNames, playerName, indepNames, seed) {
  const pool = (indepNames || []).filter(n => n !== playerName);
  if (!pool.length || f(seed + 4242) > 0.5) return null;                // ~50% of off-seasons
  const team = pool[mix32((seed >>> 0) + 313) % pool.length];
  const types = ["oem", "tech", "sovereign"], t = types[mix32((seed >>> 0) + 191) % 3];
  return { team, suitorLabel: SUITORS[t].label };
}
