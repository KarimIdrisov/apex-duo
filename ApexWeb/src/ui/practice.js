// ApexWeb/src/ui/practice.js — Practice = the setup-finding puzzle.
// 3 sliders (no visible ideal), a run budget, per-run lap time + driver feedback
// ("warmer/colder") + confidence. Each run costs one; you converge on the hidden
// ideal, then carry your setup to quali/race. Local per player (no host needed).
import { TRACK, SKILL_K, CAR_K, TEAMS } from "../data.js";
import { trackIdeal, closeness, feedback, AXES } from "../setup.js";

const RUN_BUDGET = 4;
const ideal = () => trackIdeal(TRACK.laps * 1000 + Math.round(TRACK.lt));

function myDriverCar(ctx) {
  const t = TEAMS[ctx.teamIdx] || TEAMS[0];
  return { drv: t.drivers[ctx.myPlayer === "p2" ? 1 : 0], car: t.car };
}

function fmt(t) {                       // seconds -> M:SS.mmm
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(3).padStart(6, "0")}`;
}

// practice lap time: pure function of how close the setup is (no random, so the
// signal is honest — better setup is always faster). The setup swing is amplified
// vs the tiny real race bonus so the lap clock is readable as a "feel" gauge.
function lapTime(ctx, setup) {
  const { drv, car } = myDriverCar(ctx);
  let s = TRACK.lt;
  s -= SKILL_K * (drv.skill - 0.5);
  s -= CAR_K * ((car.power - car.aero) * (TRACK.pw - TRACK.df));
  s -= 0.8 * Math.max(0, closeness(setup, ideal()));   // good setup -> faster lap (feel gauge)
  return s;
}

export function render(root, ctx) {
  ctx.setup = ctx.setup || [0.5, 0.5, 0.5];
  ctx.prac = ctx.prac || { runsLeft: RUN_BUDGET, runsDone: 0, bestLap: null, lastLap: null, fb: null, conf: 0 };
  const p = ctx.prac;

  const sliders = AXES.map((ax, i) => `
    <div style="margin:12px 0">
      <p class="label">${ax.name}</p>
      <input type="range" min="0" max="1" step="0.01" value="${ctx.setup[i]}" data-ax="${i}" style="width:100%">
    </div>`).join("");

  const dots = Array.from({ length: RUN_BUDGET }, (_, i) => i < (RUN_BUDGET - p.runsLeft) ? "●" : "○").join(" ");

  const report = p.runsDone ? `
      <div style="display:flex;justify-content:space-between;font-size:14px;margin:6px 0">
        <span>Последний круг: <b>${fmt(p.lastLap)}</b></span>
        <span>Лучший: <b style="color:var(--good)">${fmt(p.bestLap)}</b></span>
      </div>
      <div class="panel" style="border-left:3px solid var(--accent);margin:8px 0">🗣️ ${p.fb}</div>
      <p class="label">Уверенность пилота: ${Math.round(p.conf * 100)}%</p>
      <div class="bar"><i style="width:${p.conf * 100}%;background:linear-gradient(90deg,#e7553b,#e7c84b 60%,#3ddc84)"></i></div>`
    : `<div class="panel" style="border-left:3px solid var(--accent);margin:8px 0">🗣️ Поставь сетап и поезжай — скажу, что подкрутить.</div>`;

  root.innerHTML = `
    <div class="panel">
      <h2>Практика — настройка машины</h2>
      <p class="label">Прогоны: ${dots} &nbsp;(${p.runsLeft} осталось)</p>
      ${report}
      ${sliders}
      <button class="primary" id="run" ${p.runsLeft <= 0 ? "disabled style='opacity:.5'" : ""}>▶ Прогон (${p.runsLeft})</button>
      <button class="ready" id="ready" style="margin-top:8px">Готов → Квала</button>
    </div>`;

  root.querySelectorAll("input[type=range]").forEach(el => {
    el.oninput = e => { ctx.setup[+e.target.dataset.ax] = +e.target.value; };   // a guess; feedback updates on the next run
  });
  root.querySelector("#run").onclick = () => {
    if (p.runsLeft <= 0) return;
    p.runsLeft--; p.runsDone++;
    p.lastLap = lapTime(ctx, ctx.setup);
    p.bestLap = p.bestLap == null ? p.lastLap : Math.min(p.bestLap, p.lastLap);
    p.conf = Math.max(0, closeness(ctx.setup, ideal()));
    p.fb = feedback(ctx.setup, ideal());
    render(root, ctx);
  };
  root.querySelector("#ready").onclick = () => {
    ctx.send({ cmd: "set_setup", player: ctx.myPlayer, setup: ctx.setup });   // carry final setup to the race
    ctx.send({ cmd: "ready", player: ctx.myPlayer });
  };
}
