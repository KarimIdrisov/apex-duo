// ApexWeb/src/board.js — pure board/narrative: season objectives + the regulation arc. No UI, no cycle
// (imports only TEAMS). Confidence math stays in news.js; this adds the objective + reg-cadence layer.
import { TEAMS } from "./data.js";

// the season's objectives from the board's championship target (tier-specific second goal).
export function seasonObjectives(targetPos) {
  const objs = [{ type: "championship", label: `Финиш в чемпионате ≤ P${targetPos}`, target: targetPos }];
  if (targetPos <= 3) objs.push({ type: "podiums", label: "8 подиумов за сезон", target: 8 });
  else if (targetPos <= 7) objs.push({ type: "points", label: "Очки в 8 гонках", target: 8 });
  else objs.push({ type: "develop", label: "Развить машину (деталь +0.05)", target: 0.05 });
  return objs;
}

function playerPos(career) {
  const pts = career.teamPts || {}, mine = pts[TEAMS[career.teamIdx].name] || 0;
  return 1 + Object.keys(pts).filter(n => pts[n] > mine).length;
}
const clamp01 = v => Math.max(0, Math.min(1, v));

// evaluate each objective from the live career state -> [{ type, label, met, progress, cur }].
export function evaluateObjectives(career) {
  const b = career.board || {};
  return (b.objectives || []).map(o => {
    let cur = 0, met = false, progress = 0;
    if (o.type === "championship") { const pos = playerPos(career); met = pos <= o.target; progress = clamp01(o.target / pos); cur = pos; }
    else if (o.type === "podiums") { cur = b.podiums || 0; met = cur >= o.target; progress = clamp01(cur / o.target); }
    else if (o.type === "points") { cur = b.pointFinishes || 0; met = cur >= o.target; progress = clamp01(cur / o.target); }
    else if (o.type === "develop") { const p = (career.parts && career.parts[TEAMS[career.teamIdx].name]) || {}; cur = Math.max(0, ...Object.values(p), 0); met = cur >= o.target; progress = clamp01(cur / o.target); }
    return { type: o.type, label: o.label, met, progress, cur };
  });
}

// regulation arc: a big shake-up every 3rd season (deeper reset), otherwise a normal trim. <1 always.
export function regResetFor(season) { return (season % 3 === 0) ? 0.35 : 0.6; }
export function regArcNote(season) {
  return (season % 3 === 0)
    ? "⚠ Большие изменения регламента: разработка сильно обнулится."
    : "Регламент стабилен: развитие частично переносится.";
}

// §Phase-4 item 7 — a deeper, THRESHOLD-triggered reset layered on the cadence. When the grid's development
// has CONVERGED (the field has piled levels onto the cars and everyone is bunched near the ceiling), the
// regulations shake the grid harder — carryFactor → REG_DEEP — independent of the 3-season cadence. This is
// MM's "the field caught up, so the rules reset the advantage" feel, and it keeps a fast-developing era from
// running away. Deterministic (reads developed part levels only) and anti-runaway, so it's balance-safe.
export const REG_DEEP = 0.25;        // carryFactor on a convergence-triggered deep reset (masterplan §6)
export const REG_CONVERGE = 0.095;   // field-average developed part level above which the grid has "converged"
// field-average developed part level across all teams (≈0 at the start of an era, rises as everyone develops).
export function devMaturity(parts) {
  if (!parts) return 0;
  let sum = 0, n = 0;
  for (const tn in parts) { const p = parts[tn]; for (const k in p) { sum += p[k] || 0; n++; } }
  return n ? sum / n : 0;
}
// the effective reset for the upcoming season: the DEEPER of the cadence reset and (when the field has
// converged) the threshold deep reset. `deep` flags a convergence-triggered reset stronger than the cadence.
export function regResetForCareer(season, parts) {
  const cadence = regResetFor(season);
  const reg = (devMaturity(parts) >= REG_CONVERGE) ? Math.min(cadence, REG_DEEP) : cadence;
  return { reg, deep: reg < cadence };
}
