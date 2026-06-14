// ApexWeb/src/ui/race.js — race screen in a timing-dashboard style:
// header + real SVG circuit map + your-car control strip + full timing leaderboard.
// Skeleton is built ONCE (so the lever buttons survive ~12 Hz updates and clicks
// land); only values + the board + car dots are mutated each snapshot.
import { TRACK, TRACK_PATH, DRIVER_INFO } from "../data.js";
import { describe } from "../commentary.js";
import { sfx } from "../audio.js";
import * as screen3d from "./race3d_screen.js";
import { TRACK_SHAPES } from "../track_shapes.js";
import { effectiveTrack } from "../track_store.js";
import { pitLaneSample, advancePitPhase } from "../pitlane.js";

const PACE = ["conserve", "balanced", "push"], ENGINE = ["save", "standard", "push"];
const PACE_L = { conserve: "Save", balanced: "Norm", push: "Push" };
const ENGINE_L = { save: "Save", standard: "Std", push: "Push" };
const ORDER = ["attack", "defend", "none"];
const ORDER_L = { attack: "⚔ Атака", defend: "🛡 Защита", none: "Нейтр" };
const SPEEDS = [1, 2, 4];

const logo = (a, s = 18) => { const l = DRIVER_INFO[a] && DRIVER_INFO[a].logo; return l ? `<img src="assets/teams/${l}.png" alt="" style="height:${s}px;width:${s}px;object-fit:contain;vertical-align:middle;margin-right:6px">` : ""; };
const tyreIcon = (t, s = 18) => `<img src="assets/tyres/${t}.png" alt="${t}" style="height:${s}px;width:${s}px;object-fit:contain;vertical-align:middle">`;

// ---- real circuit geometry (fit into a 100x100 viewBox) + arc-length sampler. Rebindable via
// setTrack so the minimap matches whichever circuit this race uses; defaults to Barcelona. ----
const SECTOR_COL = ["#5aa0ff", "#ffce47", "#46d08a"];                 // S1 / S2 / S3 tints
let RAW = [], PATH_D = "", TOTAL = 0, CENTROID = [50, 50], PIT_A, PIT_B, PIT_STOP;
const SEG = [];
function setTrack(path) {                                            // recompute all map geometry for `path` (flat 0..1)
  RAW = [];
  for (let i = 0; i < path.length; i += 2) RAW.push([path[i] * 100, path[i + 1] * 100]);
  PATH_D = "M" + RAW.map(p => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" L") + " Z";
  SEG.length = 0; TOTAL = 0;
  for (let i = 0; i < RAW.length; i++) {
    const a = RAW[i], b = RAW[(i + 1) % RAW.length];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    SEG.push({ a, b, d, acc: TOTAL }); TOTAL += d;
  }
  CENTROID = RAW.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]).map(v => v / RAW.length);
  PIT_A = pitPos(0.95, 6.5); PIT_B = pitPos(0.06, 6.5); PIT_STOP = pitPos(0.0, 6.5);
}
function pointAt(frac) {
  let t = (((frac % 1) + 1) % 1) * TOTAL;
  for (const s of SEG) { if (t <= s.d) { const r = s.d ? t / s.d : 0; return [s.a[0] + (s.b[0] - s.a[0]) * r, s.a[1] + (s.b[1] - s.a[1]) * r]; } t -= s.d; }
  return RAW[0];
}

// ---- track furniture: sector-coloured arcs, start/finish + sector ticks, pit spur ----
function sectorPath(s) {                                              // one third of the lap as a poly-line
  const lo = s / 3, hi = (s + 1) / 3, STEPS = 64, pts = [];
  for (let k = 0; k <= STEPS; k++) pts.push(pointAt(lo + (hi - lo) * (k / STEPS)));
  return "M" + pts.map(p => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" L");
}
function normalAt(frac) {                                            // inward unit normal + the point at frac
  const e = 0.005, a = pointAt(frac - e), b = pointAt(frac + e);
  const dx = b[0] - a[0], dy = b[1] - a[1], m = Math.hypot(dx, dy) || 1;
  let nx = -dy / m, ny = dx / m; const p = pointAt(frac);
  if ((CENTROID[0] - p[0]) * nx + (CENTROID[1] - p[1]) * ny < 0) { nx = -nx; ny = -ny; }
  return { nx, ny, px: p[0], py: p[1] };
}
function tickLine(frac, len, stroke, w, dash = "") {                 // perpendicular mark across the track
  const { nx, ny, px, py } = normalAt(frac);
  return `<line x1="${(px - nx * len).toFixed(2)}" y1="${(py - ny * len).toFixed(2)}" x2="${(px + nx * len).toFixed(2)}" y2="${(py + ny * len).toFixed(2)}" stroke="${stroke}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
}
function pitPos(frac, depth) { const { nx, ny, px, py } = normalAt(frac); return [px + nx * depth, py + ny * depth]; }
const DEFAULT_PIT_LANE = { entry: 0.95, exit: 0.06, side: 1, width: 2.5 };
let _pitLane = DEFAULT_PIT_LANE;
const MINIMAP_HW = 2.6;   // minimap units per track-half-width (default width 2.5 -> ~6.5, today's spur depth)
const _pitAnim = {};      // idx -> { phase, active }
let _curTrack = "__none__";
function ensureTrack(name) {                                         // (re)bind the map geometry when the race's circuit is known
  if (name === _curTrack) return;
  _curTrack = name;
  setTrack((name && TRACK_SHAPES[name]) || TRACK_PATH);
  _pitLane = (effectiveTrack(name, (name && TRACK_SHAPES[name]) || TRACK_PATH).pitLane) || DEFAULT_PIT_LANE;
}
setTrack(TRACK_PATH);                                                // default until a race snapshot names a circuit

// cars within this on-track gap (seconds, same lap) are "in a battle" -> a connecting line
const BATTLE_GAP = 1.0;
function computeBattles(cars) {
  const out = [];
  for (let i = 1; i < cars.length; i++) {
    const a = cars[i - 1], b = cars[i];
    if (a.retired || b.retired || a.lap !== b.lap) continue;
    const gap = ((a.lap + a.lapFrac) - (b.lap + b.lapFrac)) * TRACK.lt;
    if (gap >= 0 && gap < BATTLE_GAP) out.push([a.idx, b.idx]);
  }
  return out;
}
const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

// time-interpolated progress from a per-car ring buffer of {prog,t} snapshots: smooth motion
// between ~12 Hz snapshots regardless of the sim's step cadence (renders slightly in the past).
function sampleBuf(buf, rt) {
  if (!buf || !buf.length) return 0;
  if (buf.length === 1 || rt <= buf[0].t) return buf[0].prog;
  for (let i = buf.length - 1; i > 0; i--) {
    const a = buf[i - 1], b = buf[i];
    if (rt >= a.t) {
      const span = b.t - a.t || 1, v = (b.prog - a.prog) / span;
      return rt <= b.t ? a.prog + (b.prog - a.prog) * ((rt - a.t) / span)   // interpolate between two samples
                       : b.prog + v * Math.min(rt - b.t, 140);              // mild extrapolation past the newest
    }
  }
  return buf[buf.length - 1].prog;
}

// the rAF map loop: smoothly extrapolates each car's progress between ~12 Hz snapshots,
// positions dots + labels, draws battle lines, parks pitting cars on the pit spur.
function startMapLoop(root, ctx) {
  if (ctx._mapRAF) return;
  const DELAY = 120;   // render this many ms behind the newest snapshot so motion interpolates smoothly
  const step = () => {
    ctx._mapRAF = requestAnimationFrame(step);
    if (ctx.view3d) return;
    const phase = ctx.weekend && ctx.weekend.phase;
    if (!ctx._buf || (phase !== "race" && phase !== "result")) return;
    const now = nowMs(), renderT = now - DELAY, xy = {};
    const dt = Math.min(0.05, (now - (ctx._pitLast || now)) / 1000); ctx._pitLast = now;
    for (const idx in ctx._buf) {
      const meta = ctx._meta[idx];
      const dot = root.querySelector(`#car-${idx}`), lbl = root.querySelector(`#lbl-${idx}`);
      if (!dot || !meta) continue;
      if (meta.retired) { dot.style.display = "none"; if (lbl) lbl.style.display = "none"; continue; }
      dot.style.display = ""; if (lbl) lbl.style.display = "";
      let x, y;
      const inPit = meta.inPit || (ctx._pit[idx] && now < ctx._pit[idx]);
      const pa = _pitAnim[idx] = advancePitPhase(_pitAnim[idx], inPit, dt);
      if (pa.active) { const s = pitLaneSample(pa.phase, _pitLane); [x, y] = pitPos(s.frac, s.latUnit * _pitLane.width * MINIMAP_HW); }
      else { [x, y] = pointAt(sampleBuf(ctx._buf[idx], renderT)); }
      xy[idx] = [x, y];
      const baseR = meta.isPlayer ? 2.5 : 1.8;
      const flashing = ctx._flash[idx] && now < ctx._flash[idx];
      dot.setAttribute("cx", x.toFixed(2)); dot.setAttribute("cy", y.toFixed(2));
      dot.setAttribute("r", (flashing ? baseR + 1.0 : baseR).toFixed(2));
      dot.setAttribute("stroke", meta.isLeader ? "#ffd000" : (flashing ? "#ff7a18" : (meta.player ? "#fff" : "rgba(0,0,0,.45)")));
      dot.setAttribute("stroke-width", (meta.isLeader || flashing) ? "0.9" : (meta.player ? "0.8" : "0.3"));
      if (lbl) { lbl.setAttribute("x", x.toFixed(2)); lbl.setAttribute("y", (y - baseR - 1.1).toFixed(2)); }
    }
    const bg = root.querySelector("#battles");
    if (bg) bg.innerHTML = (ctx._battlePairs || []).filter(([a, b]) => xy[a] && xy[b])
      .map(([a, b]) => `<line x1="${xy[a][0].toFixed(2)}" y1="${xy[a][1].toFixed(2)}" x2="${xy[b][0].toFixed(2)}" y2="${xy[b][1].toFixed(2)}"/>`).join("");
  };
  ctx._mapRAF = requestAnimationFrame(step);
}

function fmtLap(t) { if (!t) return "—"; const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(3).padStart(6, "0")}`; }
function fmtGap(dp) { if (dp <= 0.0001) return "—"; const laps = Math.floor(dp); return laps >= 1 ? `+${laps} LAP` : "+" + (dp * TRACK.lt).toFixed(1); }
const me_of = (cars, ctx) => cars.find(c => c.player && c.player === ctx.myPlayer) || cars.find(c => c.isPlayer) || cars[0];

function webglOK() {
  try { const c = document.createElement("canvas"); return !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl"))); }
  catch { return false; }
}

export function render(root, ctx) {
  const snap = ctx.snapshot;
  if (!snap || !snap.cars) { root.innerHTML = `<div class="panel">Старт гонки…</div>`; ctx._hudReady = false; ctx._s3dReady = false; return; }
  ensureTrack(snap.trackName || null);   // bind the minimap to this race's circuit before the skeleton is built
  if (ctx.view3d) { root.className = "full3d"; return screen3d.render(root, ctx, () => { ctx.view3d = false; render(root, ctx); }); }
  root.className = "wide";
  ctx._s3dReady = false;
  if (!ctx._hudReady || !root.querySelector("#dash")) buildHud(root, ctx);
  updateHud(root, ctx, snap);
}

// Maintain the per-car interpolation buffers + meta from a snapshot. Shared by the 2D
// dashboard and the standalone 3D screen so cars move in either view.
export function pumpBuffers(ctx, snap) {
  const cars = snap.cars, now = nowMs();
  ctx._buf = ctx._buf || {}; ctx._pit = ctx._pit || {}; ctx._flash = ctx._flash || {};
  const prevPos = ctx._prevPos || {}, prevMeta = ctx._meta || {};
  const leadIdx = cars[0] && cars[0].idx;
  for (const c of cars) {
    const buf = ctx._buf[c.idx] || (ctx._buf[c.idx] = []);
    buf.push({ prog: c.lap + c.lapFrac, t: now });
    if (buf.length > 6) buf.shift();
    const pm = prevMeta[c.idx];
    if (pm && c.pitStops > pm.pitStops) ctx._pit[c.idx] = now + 1500;
    if (prevPos[c.idx] != null && c.pos < prevPos[c.idx]) ctx._flash[c.idx] = now + 650;
  }
  ctx._meta = Object.fromEntries(cars.map(c => [c.idx,
    { pitStops: c.pitStops, retired: c.retired, inPit: c.inPit, isLeader: c.idx === leadIdx, player: c.player, isPlayer: c.isPlayer }]));
  ctx._prevPos = Object.fromEntries(cars.map(c => [c.idx, c.pos]));
  ctx._battlePairs = computeBattles(cars);
}

function buildHud(root, ctx) {
  const dots = ctx.snapshot.cars.map(c =>
    `<circle id="car-${c.idx}" r="${c.isPlayer ? 2.5 : 1.8}" fill="${c.color || "#888"}"
       stroke="${c.player ? "#fff" : "rgba(0,0,0,.45)"}" stroke-width="${c.player ? 0.8 : 0.3}"></circle>`).join("");
  const labels = ctx.snapshot.cars.map(c =>
    `<text id="lbl-${c.idx}" font-size="${c.isPlayer ? 3.0 : 2.4}" text-anchor="middle" fill="${c.player ? "#fff" : "#cfd3da"}"
       style="paint-order:stroke;stroke:#0a0a0c;stroke-width:0.5px;font-weight:${c.isPlayer ? 700 : 500};pointer-events:none">${c.abbrev}</text>`).join("");
  root.innerHTML = `
    <div id="dash">
      <div class="panel dash-head" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div><div style="font-weight:700;font-size:16px">${TRACK.gp}</div>
          <div class="label" style="margin:0">${TRACK.name} · <span id="d-chip">ГОНКА</span> <span id="d-prac-aid" class="label" style="margin:0;opacity:.8"></span></div></div>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="text-align:right"><div class="label" style="margin:0">КРУГ</div>
            <div style="font-weight:700"><span id="d-lap">0</span>/${TRACK.laps}</div></div>
          <button class="btn" id="d-view">3D</button><button class="btn" id="d-speed">1x</button><button class="btn" id="d-pause">⏸</button>
        </div>
      </div>
      <div class="dash-side">
      <div class="panel" style="padding:10px">
        <svg viewBox="-8 -8 116 116" style="width:100%;max-height:360px;display:block">
          ${[0,1,2].map(s=>`<path d="${sectorPath(s)}" fill="none" stroke="#26262c" stroke-width="3.6" stroke-linejoin="round" stroke-linecap="round"/>`).join("")}
          ${[0,1,2].map(s=>`<path d="${sectorPath(s)}" fill="none" stroke="${SECTOR_COL[s]}" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round" opacity="0.5"/>`).join("")}
          <path id="trk-sc" d="${PATH_D}" fill="none" stroke="#ffd000" stroke-width="1.9" stroke-linejoin="round" opacity="0"/>
          ${tickLine(0, 3.2, "#ffffff", 0.8, "0.7 0.5")}
          ${tickLine(1/3, 2.4, SECTOR_COL[1], 0.7)}
          ${tickLine(2/3, 2.4, SECTOR_COL[2], 0.7)}
          <line x1="${PIT_A[0].toFixed(2)}" y1="${PIT_A[1].toFixed(2)}" x2="${PIT_B[0].toFixed(2)}" y2="${PIT_B[1].toFixed(2)}" stroke="#4a4a52" stroke-width="0.9" stroke-dasharray="1.2 1"/>
          <text x="${PIT_STOP[0].toFixed(2)}" y="${(PIT_STOP[1]-1.6).toFixed(2)}" fill="#6a6a72" font-size="2.4" text-anchor="middle">PIT</text>
          <g id="battles" stroke="#ff7a18" stroke-width="0.55" opacity="0.85" stroke-linecap="round"></g>
          ${dots}
          ${labels}
        </svg>
      </div>
      <div class="panel" id="feed-panel" style="padding:8px 10px">
        <div class="label" style="margin:0 0 4px">📻 Радио</div>
        <div id="d-feed" style="display:flex;flex-direction:column;gap:3px;max-height:120px;overflow:hidden;font-size:12px"></div>
      </div>
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div style="font-weight:700">Моя машина — <span id="d-me"></span></div>
          <div class="label" style="margin:0" id="d-gaps"></div>
        </div>
        <div id="d-mini" style="display:flex;gap:2px;margin:2px 0 8px"></div>
        <p class="label" id="d-tyrelabel"></p>
        <div class="bar"><i id="d-wear"></i></div>
        <p class="label" style="margin-top:8px">Топливо <span id="d-fuel-txt"></span></p>
        <div class="bar"><i id="d-fuel"></i></div>
        <p class="label" style="margin-top:10px">Темп</p>
        <div class="seg" id="d-pace">${PACE.map(p => `<button data-v="${p}">${PACE_L[p]}</button>`).join("")}</div>
        <p class="label" style="margin-top:8px">Мотор</p>
        <div class="seg" id="d-engine">${ENGINE.map(e => `<button data-v="${e}">${ENGINE_L[e]}</button>`).join("")}</div>
        <p class="label" style="margin-top:8px">Приказ <span id="d-order-hint" class="label" style="margin:0;opacity:.7"></span></p>
        <div class="seg" id="d-order">${ORDER.map(o => `<button data-v="${o}">${ORDER_L[o]}</button>`).join("")}</div>
        <p class="label" style="margin-top:8px">Пит — компаунд <span id="d-weather"></span></p>
        <div class="seg" id="d-compound">${["soft","medium","hard","inter","wet"].map(t => `<button data-v="${t}">${tyreIcon(t, 18)}</button>`).join("")}</div>
        <button class="primary" id="d-pit" style="margin-top:8px;background:var(--bad)">⛽ В боксы</button>
      </div>
      </div>
      <div class="panel dash-board" style="padding:8px">
        <div class="label" style="padding:0 6px 6px">Leaderboard</div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:13px;white-space:nowrap">
            <thead><tr style="color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.05em">
              <th style="text-align:left;padding:4px 6px">P</th><th></th>
              <th style="text-align:left;padding:4px 6px">Пилот</th>
              <th style="padding:4px 6px">Pit</th><th style="text-align:left;padding:4px 6px">Шина</th>
              <th style="text-align:right;padding:4px 6px">Gap</th><th style="text-align:right;padding:4px 6px">Int</th>
              <th style="text-align:right;padding:4px 6px">Last</th>
            </tr></thead>
            <tbody id="d-board"></tbody>
          </table>
        </div>
      </div>
    </div>`;
  const myIdx = () => ctx._myIdx;
  root.querySelector("#d-wear").style.background = "linear-gradient(90deg,#3ddc84,#e7c84b 70%,#e7553b)";
  root.querySelector("#d-pace").onclick = e => { const v = e.target.dataset && e.target.dataset.v; if (v) ctx.send({ cmd: "set_pace", car: myIdx(), mode: v }); };
  root.querySelector("#d-engine").onclick = e => { const v = e.target.dataset && e.target.dataset.v; if (v) ctx.send({ cmd: "set_engine", car: myIdx(), mode: v }); };
  root.querySelector("#d-order").onclick = e => { const v = e.target.dataset && e.target.dataset.v; if (v) ctx.send({ cmd: "set_order", car: myIdx(), mode: v }); };
  root.querySelector("#d-compound").onclick = e => { const b = e.target.closest("button"); if (b && b.dataset.v) { ctx.nextCompound = b.dataset.v; updateHud(root, ctx, ctx.snapshot); } };
  root.querySelector("#d-pit").onclick = () => { sfx.pit(); ctx.send({ cmd: "request_pit", car: myIdx(), compound: ctx.nextCompound || "medium" }); };
  root.querySelector("#d-pause").onclick = () => ctx.send({ cmd: "toggle_pause" });
  root.querySelector("#d-speed").onclick = () => {
    const cur = (ctx.snapshot && ctx.snapshot.speed) || 1;
    ctx.send({ cmd: "set_speed", value: SPEEDS[(SPEEDS.indexOf(cur) + 1) % SPEEDS.length] });
  };
  ctx._hudReady = true;
  ctx._boardTick = 0;
  ctx._buf = {}; ctx._meta = {}; ctx._pit = {}; ctx._flash = {}; ctx._prevPos = {}; ctx._feed = []; ctx._r3d = null;
  startMapLoop(root, ctx);
  const viewBtn = root.querySelector("#d-view");
  if (!webglOK()) viewBtn.style.display = "none";
  viewBtn.onclick = () => { ctx.view3d = true; render(root, ctx); };
  sfx.lightsOut();
}

function updateHud(root, ctx, snap) {
  const cars = snap.cars;
  const me = me_of(cars, ctx);
  ctx._myIdx = me.idx;
  const $ = id => root.querySelector(id);
  // header
  $("#d-lap").textContent = me.lap;
  $("#d-chip").textContent = snap.finished ? "ФИНИШ" : (snap.scActive ? "🟡 SAFETY CAR" : (snap.vscActive ? "🟡 VSC" : (snap.paused ? "ПАУЗА" : "ГОНКА")));
  const pf = snap.practiceFindings;
  const aidEl = $("#d-prac-aid");
  if (aidEl) aidEl.textContent = pf && pf.recommendedStops != null
    ? `план: ${pf.recommendedStops} стоп${pf.degByCompound && pf.degByCompound.soft ? ` · софт-клифф ~${pf.degByCompound.soft.cliffLap}` : ""}`
    : "";
  $("#d-pause").textContent = snap.paused ? "▶" : "⏸";
  $("#d-speed").textContent = (snap.speed || 1) + "x";
  pumpBuffers(ctx, snap);
  const scOv = $("#trk-sc"); if (scOv) scOv.setAttribute("opacity", snap.scActive ? "0.95" : "0");
  // commentary feed: append new events, keep the last ~24, render newest-first (fading)
  ctx._feed = ctx._feed || [];
  if (snap.events && snap.events.length) {
    for (const ev of snap.events) { const line = describe(ev); if (line) ctx._feed.push({ line, lap: ev.lap }); }
    if (ctx._feed.length > 24) ctx._feed = ctx._feed.slice(-24);
  }
  const feedEl = $("#d-feed");
  if (feedEl) feedEl.innerHTML = ctx._feed.slice(-7).reverse()
    .map((m, i) => `<div style="opacity:${(1 - i * 0.12).toFixed(2)}"><span style="color:var(--muted)">L${m.lap}</span> ${m.line}</div>`).join("");
  // control strip
  const pos = cars.indexOf(me), ahead = cars[pos - 1], behind = cars[pos + 1];
  $("#d-me").textContent = `P${me.pos} ${me.abbrev}`;
  $("#d-gaps").innerHTML = `${ahead ? "↑ " + gap(ahead, me) : "— лидер"}${behind ? " &nbsp; ↓ " + gap(me, behind) : ""}`;
  const cold = (me.tyreTemp ?? 1) < 0.85 ? ` <span style="color:#4aa3ff" title="шина не прогрета">❄</span>` : "";
  $("#d-tyrelabel").innerHTML = `Резина ${tyreIcon(me.tyre, 22)} <span style="text-transform:capitalize">${me.tyre}</span>${cold} · ${me.tyreAge} кр · износ`;
  const COLORS = { p: "#b14aef", g: "#3ddc84", y: "#e7c84b" };
  const cols = me.miniColors || [];
  $("#d-mini").innerHTML = cols.length
    ? cols.map((k, i) => `<div title="мини-сектор ${i + 1}" style="flex:1;height:8px;border-radius:2px;background:${COLORS[k] || "#3f3f46"}"></div>`).join("")
    : `<div class="label" style="margin:0">мини-сектора появятся после первого круга</div>`;
  $("#d-wear").style.width = Math.max(0, Math.min(100, 100 - me.wear)) + "%";
  const lapsLeft = TRACK.laps - me.lap;
  const ratio = lapsLeft > 0 ? Math.min(1.4, (me.fuelLaps || 0) / lapsLeft) : 1;   // >=1 means enough
  $("#d-fuel").style.width = Math.max(0, Math.min(100, ratio / 1.4 * 100)) + "%";
  $("#d-fuel").style.background = ratio >= 1 ? "var(--good)" : "var(--bad)";        // red = short
  $("#d-fuel-txt").textContent = `${(me.fuelLaps || 0).toFixed(1)} кр запас`;
  for (const b of $("#d-pace").children) b.classList.toggle("on", b.dataset.v === me.pace);
  for (const b of $("#d-engine").children) b.classList.toggle("on", b.dataset.v === me.engine);
  for (const b of $("#d-order").children) b.classList.toggle("on", b.dataset.v === me.order);
  const oh = $("#d-order-hint"); if (oh) oh.textContent = me.inFight ? "в борьбе" : "—";
  const og = $("#d-order"); if (og) og.style.opacity = me.inFight ? "1" : "0.6";   // dim when not racing anyone
  const wet = snap.wetness || 0;
  $("#d-weather").innerHTML = wet < 0.1 ? "☀️ сухо" : wet < 0.45 ? "🌦️ сыро " + Math.round(wet * 100) + "%" : "🌧️ дождь " + Math.round(wet * 100) + "%";
  const nc = ctx.nextCompound || "medium";
  for (const b of $("#d-compound").children) b.classList.toggle("on", b.dataset.v === nc);
  // leaderboard (throttled — positions change slowly)
  if ((ctx._boardTick++ % 3) === 0 || snap.finished) $("#d-board").innerHTML = board(cars, ctx);
}

function gap(a, b) { return Math.abs(((a.lap + a.lapFrac) - (b.lap + b.lapFrac)) * TRACK.lt).toFixed(1) + "с"; }

function delta(c) {
  const d = (c.startPos || 0) - c.pos;
  if (!c.startPos || d === 0) return `<span style="color:var(--muted)">—</span>`;
  return d > 0 ? `<span style="color:var(--good)">▲${d}</span>` : `<span style="color:var(--bad)">▼${-d}</span>`;
}

function board(cars, ctx) {
  const lead = cars[0], lp = lead.lap + lead.lapFrac;
  return cars.map((c, i) => {
    const prog = c.lap + c.lapFrac;
    const gapL = c.retired ? "—" : (i === 0 ? "—" : fmtGap(lp - prog));
    const intv = c.retired ? "—" : (i === 0 ? "—" : fmtGap((cars[i - 1].lap + cars[i - 1].lapFrac) - prog));
    const mine = c.player === ctx.myPlayer, team = !mine && c.isPlayer;
    const bg = mine ? "background:rgba(0,111,238,.22)" : team ? "background:rgba(0,111,238,.10)" : "";
    return `<tr style="${bg};border-top:1px solid var(--border)">
      <td style="padding:5px 6px;font-weight:700">${c.pos}</td>
      <td style="padding:5px 2px">${delta(c)}</td>
      <td style="padding:5px 6px">${logo(c.abbrev, 18)}<b>${c.abbrev}</b></td>
      <td style="padding:5px 6px;text-align:center;color:var(--muted)">${c.pitStops || 0}</td>
      <td style="padding:5px 6px">${c.retired ? '<span style="color:var(--bad)">DNF</span>' : tyreIcon(c.tyre, 16) + ' <span style="color:var(--muted)">' + c.tyreAge + '</span>'}</td>
      <td style="padding:5px 6px;text-align:right">${gapL}</td>
      <td style="padding:5px 6px;text-align:right;color:var(--muted)">${intv}</td>
      <td style="padding:5px 6px;text-align:right">${fmtLap(c.lastLap)}</td>
    </tr>`;
  }).join("");
}
