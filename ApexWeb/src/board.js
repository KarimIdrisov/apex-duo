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
