// ApexWeb/src/ui/race3d_screen.js — standalone FULLSCREEN 3D race view (spectator).
// Mounts the race3d.js orbital scene full-viewport + a minimal overlay (lap, top-5,
// your car) + a "back to 2D" button. Reads the same ctx snapshot buffers (pumped here
// via race.js pumpBuffers); race-engineering controls stay in the 2D dashboard.
import { pumpBuffers } from "./race.js";
import { TRACK } from "../data.js";

const me_of = (cars, ctx) => cars.find(c => c.player && c.player === ctx.myPlayer) || cars.find(c => c.isPlayer) || cars[0];
const tyreIcon = (t, s = 16) => `<img src="assets/tyres/${t}.png" alt="${t}" style="height:${s}px;width:${s}px;object-fit:contain;vertical-align:middle">`;

export function render(root, ctx, onExit) {
  const snap = ctx.snapshot;
  if (!snap || !snap.cars) return;
  pumpBuffers(ctx, snap);                                   // keep race3d car positions fed
  if (!ctx._s3dReady || !root.querySelector("#scene3d")) build(root, ctx, onExit);
  update(root, ctx, snap);
}

function build(root, ctx, onExit) {
  root.innerHTML = `
    <div id="scene3d" style="position:relative;width:100%;height:100vh;overflow:hidden;background:#0a0a0c">
      <canvas id="s3d-canvas" style="display:block;width:100%;height:100%"></canvas>
      <div style="position:absolute;top:14px;left:14px;display:flex;align-items:center;gap:10px">
        <button class="btn" id="s3d-back">← 2D</button>
        <div style="background:rgba(10,10,12,.62);border-radius:10px;padding:6px 12px;font-weight:700">
          ${TRACK.gp} · круг <span id="s3d-lap">0</span>/${TRACK.laps} <span id="s3d-chip" style="margin-left:6px;font-weight:500"></span>
        </div>
      </div>
      <div id="s3d-board" style="position:absolute;top:14px;right:14px;width:230px;background:rgba(10,10,12,.62);border-radius:12px;padding:8px 10px;font-size:13px"></div>
      <div id="s3d-me" style="position:absolute;left:14px;bottom:14px;background:rgba(10,10,12,.62);border-radius:12px;padding:8px 12px;font-size:13px"></div>
    </div>`;
  root.querySelector("#s3d-back").onclick = () => onExit();
  ctx._s3dReady = true;
  ctx._r3d = null;
  const cv = root.querySelector("#s3d-canvas");
  import("./race3d.js").then(m => { if (ctx.view3d && !ctx._r3d) ctx._r3d = m.init(cv, ctx); });
}

function update(root, ctx, snap) {
  const cars = snap.cars, me = me_of(cars, ctx), $ = id => root.querySelector(id);
  $("#s3d-lap").textContent = me.lap;
  $("#s3d-chip").textContent = snap.finished ? "ФИНИШ" : (snap.scActive ? "🟡 SC" : (snap.paused ? "ПАУЗА" : ""));
  $("#s3d-board").innerHTML = cars.slice(0, 5).map(c => {
    const mine = c.player === ctx.myPlayer, team = !mine && c.isPlayer;
    const bg = mine ? "background:rgba(0,111,238,.30)" : team ? "background:rgba(0,111,238,.14)" : "";
    return `<div style="display:flex;justify-content:space-between;padding:3px 6px;border-radius:5px;${bg}"><span><b>${c.pos}</b> ${c.abbrev}</span><span style="color:#a1a1aa">${c.retired ? "DNF" : (c.tyre || "")[0].toUpperCase()}</span></div>`;
  }).join("");
  $("#s3d-me").innerHTML = `<b>P${me.pos} ${me.abbrev}</b> · ${tyreIcon(me.tyre)} <span style="text-transform:capitalize">${me.tyre}</span> · ${me.tyreAge} кр`;
}
