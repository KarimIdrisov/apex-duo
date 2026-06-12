// ApexWeb/src/ui/race.js — race HUD (variant B "driver focus").
// Built ONCE, then mutated in place each snapshot so the ~12 Hz state updates
// never destroy the buttons mid-click (that ate every press before).
import { TRACK } from "../data.js";

const PACE = ["conserve", "balanced", "push"], ERS = ["harvest", "balanced", "attack"];
const PACE_L = { conserve: "Save", balanced: "Norm", push: "Push" };
const ERS_L = { harvest: "Harv", balanced: "Bal", attack: "Atk" };
const SPEEDS = [1, 2, 4];

export function render(root, ctx) {
  const snap = ctx.snapshot;
  if (!snap || !snap.cars) { root.innerHTML = `<div class="panel">Старт гонки…</div>`; ctx._hudReady = false; return; }
  if (snap.finished) {
    root.innerHTML = `<div class="panel"><h2>Финиш — ${TRACK.name}</h2>
      <p class="label">Итоговый порядок</p>${tower(snap.cars, ctx)}</div>`;
    ctx._hudReady = false; return;
  }
  if (!ctx._hudReady || !root.querySelector("#hud")) buildHud(root, ctx);
  updateHud(root, ctx, snap);
}

// one-time skeleton + handlers (handlers read live state at click time)
function buildHud(root, ctx) {
  root.innerHTML = `
    <div id="hud">
      <div class="panel" style="display:flex;justify-content:space-between;align-items:center">
        <span id="hud-lap"></span><span id="hud-pos"></span>
        <span><button id="hud-speed" style="margin-right:6px">1x</button><button id="hud-pause">⏸</button></span>
      </div>
      <canvas id="hud-map" width="320" height="120" class="panel" style="display:block;width:100%"></canvas>
      <div class="panel">
        <p id="hud-ahead"></p>
        <p id="hud-behind"></p>
        <p class="label" id="hud-tyrelabel"></p>
        <div class="bar"><i id="hud-wear"></i></div>
        <p class="label" style="margin-top:8px">Заряд ERS</p>
        <div class="bar"><i id="hud-soc"></i></div>
        <p class="label" style="margin-top:10px">Темп</p>
        <div class="seg" id="hud-pace">${PACE.map(p => `<button data-v="${p}">${PACE_L[p]}</button>`).join("")}</div>
        <p class="label" style="margin-top:8px">ERS</p>
        <div class="seg" id="hud-ers">${ERS.map(e => `<button data-v="${e}">${ERS_L[e]}</button>`).join("")}</div>
        <button class="primary" id="hud-pit" style="margin-top:10px;background:var(--bad)">⛽ В боксы → Hard</button>
      </div>
      <div class="panel">
        <button id="hud-toggle" style="width:100%;background:#262b36;color:var(--ink);border:0;border-radius:6px;padding:8px"></button>
        <div id="hud-table" style="display:none;margin-top:6px"></div>
      </div>
    </div>`;
  const myIdx = () => ctx._myIdx;
  root.querySelector("#hud-wear").style.background = "linear-gradient(90deg,#3ddc84,#e7c84b 70%,#e7553b)";
  root.querySelector("#hud-soc").style.background = "linear-gradient(90deg,#4aa3ff,#9b6bff)";
  root.querySelector("#hud-pace").onclick = e => { const v = e.target.dataset && e.target.dataset.v; if (v) ctx.send({ cmd: "set_pace", car: myIdx(), mode: v }); };
  root.querySelector("#hud-ers").onclick = e => { const v = e.target.dataset && e.target.dataset.v; if (v) ctx.send({ cmd: "set_ers", car: myIdx(), mode: v }); };
  root.querySelector("#hud-pit").onclick = () => ctx.send({ cmd: "request_pit", car: myIdx(), compound: "hard" });
  root.querySelector("#hud-pause").onclick = () => ctx.send({ cmd: "toggle_pause" });
  root.querySelector("#hud-speed").onclick = () => {
    const cur = (ctx.snapshot && ctx.snapshot.speed) || 1;
    ctx.send({ cmd: "set_speed", value: SPEEDS[(SPEEDS.indexOf(cur) + 1) % SPEEDS.length] });
  };
  root.querySelector("#hud-toggle").onclick = () => { ctx.showTable = !ctx.showTable; updateHud(root, ctx, ctx.snapshot); };
  ctx._hudReady = true;
}

// lightweight per-snapshot update — no innerHTML rebuild of the controls
function updateHud(root, ctx, snap) {
  const cars = snap.cars;
  const me = cars.find(c => c.player && c.player === ctx.myPlayer) || cars.find(c => c.isPlayer) || cars[0];
  ctx._myIdx = me.idx;
  const pos = cars.indexOf(me), ahead = cars[pos - 1], behind = cars[pos + 1];
  const $ = id => root.querySelector(id);
  $("#hud-lap").textContent = `🏁 ${me.lap}/${TRACK.laps}`;
  $("#hud-pos").textContent = `P${me.pos} ${me.abbrev}`;
  $("#hud-pause").textContent = snap.paused ? "▶" : "⏸";
  $("#hud-speed").textContent = ((snap.speed || 1) + "x");
  $("#hud-ahead").textContent = ahead ? `↑ ${ahead.abbrev} +${gap(ahead, me)}` : "— лидер —";
  $("#hud-behind").textContent = behind ? `↓ ${behind.abbrev} +${gap(me, behind)}` : "";
  $("#hud-tyrelabel").textContent = `Резина ${me.tyre} · износ`;
  $("#hud-wear").style.width = Math.max(0, Math.min(100, 100 - me.wear)) + "%";
  $("#hud-soc").style.width = Math.max(0, Math.min(100, me.soc)) + "%";
  for (const b of $("#hud-pace").children) b.classList.toggle("on", b.dataset.v === me.pace);
  for (const b of $("#hud-ers").children) b.classList.toggle("on", b.dataset.v === me.ers);
  $("#hud-toggle").textContent = ctx.showTable ? "Скрыть таблицу" : "Таблица (22)";
  const tbl = $("#hud-table");
  tbl.style.display = ctx.showTable ? "block" : "none";
  if (ctx.showTable) tbl.innerHTML = tower(cars, ctx);
  drawMap($("#hud-map"), cars);
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
