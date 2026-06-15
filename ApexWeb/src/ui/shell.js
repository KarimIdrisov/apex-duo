// ApexWeb/src/ui/shell.js — the persistent top navigation shell (sibling #nav above #app).
// weekendSteps + shellSig are pure; renderShell writes the #nav element.
import { constructorStandings, CALENDAR } from "../career.js";   // same source ui/season.js uses

const stateFor = (i, idx) => i < idx ? "done" : i === idx ? "current" : "upcoming";

// map a phase to the 4-step weekend stepper. state ∈ "done" | "current" | "upcoming".
export function weekendSteps(phase) {
  const idx = phase && phase.startsWith("practice") ? 0 : phase === "quali" ? 1 : phase === "race" ? 2 : phase === "result" ? 3 : -1;
  const sub = phase && phase.startsWith("practice") ? phase.slice(-1) : null;   // "1" | "2" | "3"
  return [
    { key: "practice", label: sub ? `Практика P${sub}` : "Практика", state: stateFor(0, idx) },
    { key: "quali",    label: "Квала",  state: stateFor(1, idx) },
    { key: "race",     label: "Гонка",  state: stateFor(2, idx) },
    { key: "paddock",  label: "Паддок", state: stateFor(3, idx) },
  ];
}

// a cheap signature of everything the shell displays — main.js re-renders the shell only when this
// changes, so it never rebuilds on the ~12Hz race repaint. money is bucketed to 0.1M to avoid churn.
export function shellSig(ctx) {
  const phase = ctx.weekend.phase;
  const c = ctx.careerView;
  return c ? `${phase}|${c.season}.${c.round}.${Math.round((c.money || 0) / 1e5)}.${c.board ? c.board.confidence : 0}` : `${phase}|solo`;
}

export function renderShell(nav, ctx) {
  const phase = ctx.weekend.phase;
  const c = ctx.careerView;
  if (phase === "lobby") { nav.innerHTML = `<div class="nav"><span class="nav-brand">Apex Web</span></div>`; return; }
  const steps = weekendSteps(phase)
    .map(s => `<span class="nav-step nav-${s.state}">${s.state === "done" ? "✓ " : ""}${s.label}</span>`)
    .join('<span class="nav-sep">›</span>');
  let ctxChip = "";
  if (c) {
    const team = (constructorStandings(c).find(x => x.isPlayer) || {}).team || "";   // derived (no c.teamName field)
    ctxChip = `<span class="nav-ctx">Сезон ${c.season} · R${(c.round || 0) + 1}/${CALENDAR.length}</span>
      <span class="nav-ctx">${team}</span>
      <span class="nav-money">$${((c.money || 0) / 1e6).toFixed(1)}M</span>`;
  }
  nav.innerHTML = `<div class="nav">
      <span class="nav-brand">Apex Web</span>
      <div class="nav-steps">${steps}</div>
      <div class="nav-ctxs">${ctxChip}</div>
    </div>`;
}
