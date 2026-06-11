// ApexWeb/src/ui/race.js — race HUD (variant B "driver focus") + minimap + result view.
import { TRACK } from "../data.js";

const PACE = ["conserve", "balanced", "push"], ERS = ["harvest", "balanced", "attack"];
const PACE_L = { conserve: "Save", balanced: "Norm", push: "Push" };
const ERS_L = { harvest: "Harv", balanced: "Bal", attack: "Atk" };

export function render(root, ctx) {
  const snap = ctx.snapshot;
  if (!snap || !snap.cars) { root.innerHTML = `<div class="panel">Старт гонки…</div>`; return; }
  const cars = snap.cars;                       // already pos-sorted by the host
  const me = cars.find(c => c.player && c.player === ctx.myPlayer)
          || cars.find(c => c.isPlayer) || cars[0];

  if (snap.finished) {                          // result view
    root.innerHTML = `<div class="panel"><h2>Финиш — ${TRACK.name}</h2>
      <p class="label">Итоговый порядок</p>${tower(cars, ctx)}</div>`;
    return;
  }

  const myPos = cars.indexOf(me);
  const ahead = cars[myPos - 1], behind = cars[myPos + 1];
  const wearPct = Math.max(0, Math.min(100, 100 - me.wear));
  const socPct = Math.max(0, Math.min(100, me.soc));

  root.innerHTML = `
    <div class="panel" style="display:flex;justify-content:space-between;align-items:center">
      <span>🏁 ${me.lap}/${TRACK.laps}</span><span>P${me.pos} ${me.abbrev}</span>
      <button id="pause">${snap.paused ? "▶" : "⏸"}</button>
    </div>
    <canvas id="map" width="320" height="120" class="panel" style="display:block;width:100%"></canvas>
    <div class="panel">
      <p>${ahead ? `↑ ${ahead.abbrev} +${gap(ahead, me)}` : "— лидер —"}</p>
      <p>${behind ? `↓ ${behind.abbrev} +${gap(me, behind)}` : ""}</p>
      <p class="label">Резина ${me.tyre} · износ</p>
      <div class="bar"><i style="width:${wearPct}%;background:linear-gradient(90deg,#3ddc84,#e7c84b 70%,#e7553b)"></i></div>
      <p class="label" style="margin-top:8px">Заряд ERS</p>
      <div class="bar"><i style="width:${socPct}%;background:linear-gradient(90deg,#4aa3ff,#9b6bff)"></i></div>
      <p class="label" style="margin-top:10px">Темп</p>
      <div class="seg" id="pace">${PACE.map(p => `<button class="${me.pace === p ? "on" : ""}" data-v="${p}">${PACE_L[p]}</button>`).join("")}</div>
      <p class="label" style="margin-top:8px">ERS</p>
      <div class="seg" id="ers">${ERS.map(e => `<button class="${me.ers === e ? "on" : ""}" data-v="${e}">${ERS_L[e]}</button>`).join("")}</div>
      <button class="primary" id="pit" style="margin-top:10px;background:var(--bad)">⛽ В боксы → Hard</button>
    </div>
    <div class="panel">
      <button id="toggleTable" style="width:100%;background:#262b36;color:var(--ink);border:0;border-radius:6px;padding:8px">
        ${ctx.showTable ? "Скрыть таблицу" : "Таблица (22)"}</button>
      ${ctx.showTable ? tower(cars, ctx) : ""}
    </div>`;

  root.querySelector("#pace").onclick = e => { if (e.target.dataset.v) ctx.send({ cmd: "set_pace", car: me.idx, mode: e.target.dataset.v }); };
  root.querySelector("#ers").onclick = e => { if (e.target.dataset.v) ctx.send({ cmd: "set_ers", car: me.idx, mode: e.target.dataset.v }); };
  root.querySelector("#pit").onclick = () => ctx.send({ cmd: "request_pit", car: me.idx, compound: "hard" });
  root.querySelector("#pause").onclick = () => ctx.send({ cmd: "toggle_pause" });
  root.querySelector("#toggleTable").onclick = () => { ctx.showTable = !ctx.showTable; render(root, ctx); };
  drawMap(root.querySelector("#map"), cars);
}

// time gap (s) between two cars by track-distance, leader first
function gap(a, b) { return Math.abs(((a.lap + a.lapFrac) - (b.lap + b.lapFrac)) * TRACK.lt).toFixed(1); }

function tower(cars, ctx) {
  return cars.map(c => {
    const bg = c.player === ctx.myPlayer ? "background:#1d6fd6;color:#fff"
      : c.isPlayer ? "background:#2a4a7a;color:#cfe0ff" : "";
    return `<div style="display:flex;justify-content:space-between;padding:2px 6px;${bg};border-radius:3px">
      <span>${c.pos} ${c.abbrev}</span><span>${c.retired ? "DNF" : c.tyre}</span></div>`;
  }).join("");
}

function drawMap(cv, cars) {
  if (!cv) return;
  const g = cv.getContext("2d");
  g.clearRect(0, 0, cv.width, cv.height);
  const cx = cv.width / 2, cy = cv.height / 2, rx = cv.width / 2 - 16, ry = cv.height / 2 - 12;
  g.strokeStyle = "#2a2f3a"; g.lineWidth = 10;
  g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.stroke();
  for (const c of cars) {
    if (c.retired) continue;
    const a = c.lapFrac * Math.PI * 2 - Math.PI / 2;
    g.fillStyle = (c.player || c.isPlayer) ? "#fff" : (c.color || "#888");
    g.beginPath(); g.arc(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, c.isPlayer ? 5 : 3, 0, Math.PI * 2); g.fill();
  }
}
