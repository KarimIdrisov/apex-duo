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
