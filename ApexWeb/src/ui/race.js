// ApexWeb/src/ui/race.js — race screen in a timing-dashboard style:
// header + real SVG circuit map + your-car control strip + full timing leaderboard.
// Skeleton is built ONCE (so the lever buttons survive ~12 Hz updates and clicks
// land); only values + the board + car dots are mutated each snapshot.
import { TRACK, TRACK_PATH, DRIVER_INFO } from "../data.js";
import { sfx } from "../audio.js";

const PACE = ["conserve", "balanced", "push"], ERS = ["harvest", "balanced", "attack"];
const PACE_L = { conserve: "Save", balanced: "Norm", push: "Push" };
const ERS_L = { harvest: "Harv", balanced: "Bal", attack: "Atk" };
const SPEEDS = [1, 2, 4];

const logo = (a, s = 18) => { const l = DRIVER_INFO[a] && DRIVER_INFO[a].logo; return l ? `<img src="assets/teams/${l}.png" alt="" style="height:${s}px;width:${s}px;object-fit:contain;vertical-align:middle;margin-right:6px">` : ""; };
const tyreIcon = (t, s = 18) => `<img src="assets/tyres/${t}.png" alt="${t}" style="height:${s}px;width:${s}px;object-fit:contain;vertical-align:middle">`;

// ---- real circuit geometry (fit into a 100x100 viewBox) + arc-length sampler ----
const RAW = [];
for (let i = 0; i < TRACK_PATH.length; i += 2) RAW.push([TRACK_PATH[i] * 100, TRACK_PATH[i + 1] * 100]);
const PATH_D = "M" + RAW.map(p => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" L") + " Z";
const SEG = []; let TOTAL = 0;
for (let i = 0; i < RAW.length; i++) {
  const a = RAW[i], b = RAW[(i + 1) % RAW.length];
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  SEG.push({ a, b, d, acc: TOTAL }); TOTAL += d;
}
function pointAt(frac) {
  let t = (((frac % 1) + 1) % 1) * TOTAL;
  for (const s of SEG) { if (t <= s.d) { const r = s.d ? t / s.d : 0; return [s.a[0] + (s.b[0] - s.a[0]) * r, s.a[1] + (s.b[1] - s.a[1]) * r]; } t -= s.d; }
  return RAW[0];
}

function fmtLap(t) { if (!t) return "—"; const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(3).padStart(6, "0")}`; }
function fmtGap(dp) { if (dp <= 0.0001) return "—"; const laps = Math.floor(dp); return laps >= 1 ? `+${laps} LAP` : "+" + (dp * TRACK.lt).toFixed(1); }
const me_of = (cars, ctx) => cars.find(c => c.player && c.player === ctx.myPlayer) || cars.find(c => c.isPlayer) || cars[0];

export function render(root, ctx) {
  const snap = ctx.snapshot;
  if (!snap || !snap.cars) { root.innerHTML = `<div class="panel">Старт гонки…</div>`; ctx._hudReady = false; return; }
  if (!ctx._hudReady || !root.querySelector("#dash")) buildHud(root, ctx);
  updateHud(root, ctx, snap);
}

function buildHud(root, ctx) {
  const dots = ctx.snapshot.cars.map(c =>
    `<circle id="car-${c.idx}" r="${c.isPlayer ? 2.4 : 1.7}" fill="${c.color || "#888"}"
       stroke="${c.player ? "#fff" : "rgba(0,0,0,.4)"}" stroke-width="${c.player ? 0.8 : 0.3}"></circle>`).join("");
  root.innerHTML = `
    <div id="dash">
      <div class="panel dash-head" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div><div style="font-weight:700;font-size:16px">${TRACK.gp}</div>
          <div class="label" style="margin:0">${TRACK.name} · <span id="d-chip">ГОНКА</span></div></div>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="text-align:right"><div class="label" style="margin:0">КРУГ</div>
            <div style="font-weight:700"><span id="d-lap">0</span>/${TRACK.laps}</div></div>
          <button class="btn" id="d-speed">1x</button><button class="btn" id="d-pause">⏸</button>
        </div>
      </div>
      <div class="dash-side">
      <div class="panel" style="padding:10px">
        <svg viewBox="0 0 100 100" style="width:100%;max-height:340px;display:block">
          <path d="${PATH_D}" fill="none" stroke="#2a2a31" stroke-width="3.2" stroke-linejoin="round"/>
          <path d="${PATH_D}" fill="none" stroke="#3f3f46" stroke-width="1.4" stroke-linejoin="round"/>
          ${dots}
        </svg>
      </div>
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div style="font-weight:700">Моя машина — <span id="d-me"></span></div>
          <div class="label" style="margin:0" id="d-gaps"></div>
        </div>
        <p class="label" id="d-tyrelabel"></p>
        <div class="bar"><i id="d-wear"></i></div>
        <p class="label" style="margin-top:8px">Заряд ERS</p>
        <div class="bar"><i id="d-soc"></i></div>
        <p class="label" style="margin-top:10px">Темп</p>
        <div class="seg" id="d-pace">${PACE.map(p => `<button data-v="${p}">${PACE_L[p]}</button>`).join("")}</div>
        <p class="label" style="margin-top:8px">ERS</p>
        <div class="seg" id="d-ers">${ERS.map(e => `<button data-v="${e}">${ERS_L[e]}</button>`).join("")}</div>
        <button class="primary" id="d-pit" style="margin-top:10px;background:var(--bad)">⛽ В боксы → ${tyreIcon("hard", 20)} Hard</button>
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
  root.querySelector("#d-soc").style.background = "linear-gradient(90deg,#4aa3ff,#9b6bff)";
  root.querySelector("#d-pace").onclick = e => { const v = e.target.dataset && e.target.dataset.v; if (v) ctx.send({ cmd: "set_pace", car: myIdx(), mode: v }); };
  root.querySelector("#d-ers").onclick = e => { const v = e.target.dataset && e.target.dataset.v; if (v) ctx.send({ cmd: "set_ers", car: myIdx(), mode: v }); };
  root.querySelector("#d-pit").onclick = () => { sfx.pit(); ctx.send({ cmd: "request_pit", car: myIdx(), compound: "hard" }); };
  root.querySelector("#d-pause").onclick = () => ctx.send({ cmd: "toggle_pause" });
  root.querySelector("#d-speed").onclick = () => {
    const cur = (ctx.snapshot && ctx.snapshot.speed) || 1;
    ctx.send({ cmd: "set_speed", value: SPEEDS[(SPEEDS.indexOf(cur) + 1) % SPEEDS.length] });
  };
  ctx._hudReady = true;
  ctx._boardTick = 0;
  sfx.lightsOut();
}

function updateHud(root, ctx, snap) {
  const cars = snap.cars;
  const me = me_of(cars, ctx);
  ctx._myIdx = me.idx;
  const $ = id => root.querySelector(id);
  // header
  $("#d-lap").textContent = me.lap;
  $("#d-chip").textContent = snap.finished ? "ФИНИШ" : (snap.paused ? "ПАУЗА" : "ГОНКА");
  $("#d-pause").textContent = snap.paused ? "▶" : "⏸";
  $("#d-speed").textContent = (snap.speed || 1) + "x";
  // car dots on the circuit
  for (const c of cars) {
    const el = root.querySelector(`#car-${c.idx}`);
    if (!el) continue;
    if (c.retired) { el.style.display = "none"; continue; }
    el.style.display = "";
    const [x, y] = pointAt(c.lapFrac);
    el.setAttribute("cx", x.toFixed(2)); el.setAttribute("cy", y.toFixed(2));
  }
  // control strip
  const pos = cars.indexOf(me), ahead = cars[pos - 1], behind = cars[pos + 1];
  $("#d-me").textContent = `P${me.pos} ${me.abbrev}`;
  $("#d-gaps").innerHTML = `${ahead ? "↑ " + gap(ahead, me) : "— лидер"}${behind ? " &nbsp; ↓ " + gap(me, behind) : ""}`;
  $("#d-tyrelabel").innerHTML = `Резина ${tyreIcon(me.tyre, 22)} <span style="text-transform:capitalize">${me.tyre}</span> · ${me.tyreAge} кр · износ`;
  $("#d-wear").style.width = Math.max(0, Math.min(100, 100 - me.wear)) + "%";
  $("#d-soc").style.width = Math.max(0, Math.min(100, me.soc)) + "%";
  for (const b of $("#d-pace").children) b.classList.toggle("on", b.dataset.v === me.pace);
  for (const b of $("#d-ers").children) b.classList.toggle("on", b.dataset.v === me.ers);
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
