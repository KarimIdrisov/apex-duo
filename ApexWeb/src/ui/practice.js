// ApexWeb/src/ui/practice.js — Practice "run plans": run-picker + setup sliders + a shared findings board.
// Renders from the host practice snapshot (ctx.snapshot when phase==="practice"); sliders are local.
import { PRAC_COST, PRAC_BUDGET } from "../data.js";
import { AXES } from "../setup.js";

const fmt = t => { const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(3).padStart(6, "0")}`; };
const COMPOUNDS_RU = { soft: "софт", medium: "медиум", hard: "хард" };

export function render(root, ctx) {
  ctx.setup = ctx.setup || [0.5, 0.5, 0.5];
  ctx.pracCompound = ctx.pracCompound || "soft";
  const snap = (ctx.snapshot && ctx.snapshot.phase === "practice") ? ctx.snapshot
    : { budget: PRAC_BUDGET, spent: 0, findings: [], board: { degByCompound: {}, quali: null, idealFound: 0, recommendedStops: null } };
  const left = snap.budget - snap.spent;
  const dots = Array.from({ length: snap.budget }, (_, i) => i < snap.spent ? "●" : "○").join("");
  const canRun = type => left >= (PRAC_COST[type] || 1);

  const sliders = AXES.map((ax, i) => `
    <div style="display:flex;align-items:center;gap:10px;margin:8px 0">
      <span class="label" style="width:90px">${ax.name}</span>
      <input type="range" min="0" max="1" step="0.01" value="${ctx.setup[i]}" data-ax="${i}" style="flex:1">
      <span style="width:36px;text-align:right">${(+ctx.setup[i]).toFixed(2)}</span>
    </div>`).join("");

  const b = snap.board;
  const degChart = Object.keys(b.degByCompound).length
    ? Object.entries(b.degByCompound).map(([c, d]) => `${COMPOUNDS_RU[c]}: клифф ${d.cliffLap || "—"} · стинт ~${d.stintLaps} кр`).join("<br>")
    : "пока нет long-run";
  const board = `
    <div class="panel">
      <h3>Общая доска находок</h3>
      <p class="label">Идеал сетапа: ${Math.round(b.idealFound * 100)}% · Квали-темп: ${b.quali ? fmt(b.quali) : "—"} · Рекоменд.: ${b.recommendedStops != null ? b.recommendedStops + " стоп" : "—"}</p>
      <p style="font-size:13px;line-height:1.6">${degChart}</p>
      <div style="border-top:1px solid var(--border);margin-top:8px;padding-top:6px;font-size:13px">
        ${snap.findings.slice(-6).map(f => `<div>[${f.player}] ${runLabel(f)}</div>`).join("") || "<span class='label'>пока нет прогонов</span>"}
      </div>
    </div>`;

  root.innerHTML = `
    <div class="panel">
      <h2>Практика — настройка и разведка</h2>
      <p class="label">Трек-тайм команды: ${dots} &nbsp;(${left} из ${snap.budget})</p>
      ${sliders}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button id="run-setup" ${canRun("setup") ? "" : "disabled style='opacity:.5'"}>Setup-тест ·1</button>
        <button id="run-long" ${canRun("long") ? "" : "disabled style='opacity:.5'"}>Long-run ·3</button>
        <select id="prac-compound">${["soft","medium","hard"].map(c => `<option value="${c}" ${c===ctx.pracCompound?"selected":""}>${COMPOUNDS_RU[c]}</option>`).join("")}</select>
        <button id="run-quali" ${canRun("quali") ? "" : "disabled style='opacity:.5'"}>Quali-sim ·1</button>
      </div>
    </div>
    ${board}
    <button class="ready" id="ready" style="margin-top:8px">Готов → Квала</button>`;

  root.querySelectorAll("input[type=range]").forEach(el => {
    el.oninput = e => { ctx.setup[+e.target.dataset.ax] = +e.target.value;
      e.target.nextElementSibling.textContent = (+e.target.value).toFixed(2); };
  });
  root.querySelector("#prac-compound").onchange = e => { ctx.pracCompound = e.target.value; };
  const run = type => ctx.send({ cmd: "practice_run", player: ctx.myPlayer, type, compound: ctx.pracCompound, setup: ctx.setup.slice() });
  root.querySelector("#run-setup").onclick = () => canRun("setup") && run("setup");
  root.querySelector("#run-long").onclick  = () => canRun("long")  && run("long");
  root.querySelector("#run-quali").onclick = () => canRun("quali") && run("quali");
  root.querySelector("#ready").onclick = () => {
    ctx.send({ cmd: "set_setup", player: ctx.myPlayer, setup: ctx.setup });
    ctx.send({ cmd: "ready", player: ctx.myPlayer });
  };
}

function runLabel(f) {
  if (f.type === "long") return `Long-run · ${COMPOUNDS_RU[f.compound]} → клифф ${f.cliffLap || "—"}`;
  if (f.type === "quali") return `Quali-sim → ${fmt(f.qualiPace)}`;
  return `Setup-тест → «${f.feedback}»`;
}
