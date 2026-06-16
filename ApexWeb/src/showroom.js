// ApexWeb/src/showroom.js — standalone 3D SHOWROOM for the broadcast race view. Mounts race3d.js on
// a synthetic editor-preview ctx with a full 22-car field (real 2026 team colours) so the upgraded
// scene (kerbs, grandstands, barriers, trees, gantry, TV camera) can be seen instantly without
// playing a weekend. Render-only; no sim/netcode. Cars are driven directly (editorPreview).
import { init as race3dInit } from "./ui/race3d.js";
import { TEAMS } from "./data.js";
import { TRACK_SHAPES } from "./track_shapes.js";

// 22-car field: two cars per team, coloured by team, spread evenly round the lap, each with a small
// per-car speed so the order shuffles and the TV director finds battles.
const COMPOUNDS = ["soft", "medium", "hard", "soft", "medium", "hard", "inter", "wet"];
function buildField() {
  const cars = [];
  let i = 0;
  for (const t of TEAMS) {
    for (let d = 0; d < 2; d++) {
      const strength = (t.car.power + t.car.aero) / 2;            // better cars circulate a touch faster
      const abbrev = (t.drivers && t.drivers[d] && (t.drivers[d].abbrev || t.drivers[d].code)) || ("D" + (i + 1));
      cars.push({ idx: i, color: t.color, abbrev, pos: i + 1, tyre: COMPOUNDS[i % COMPOUNDS.length], lap: 0, lapFrac: (i / 22), retired: false, inPit: false,
        player: i === 8, _spd: 0.92 + (strength - 0.85) * 1.2 + ((i * 2654435761 >>> 0) % 100) / 1400 });
      i++;
    }
  }
  return cars;
}

const ctx = {
  editorPreview: true,
  snapshot: { trackName: null, cars: buildField() },
  _buf: {}, _cam3d: { mode: "tv" },
};

const CAM = [
  { mode: "tv", label: "ТВ-режиссёр" },
  { mode: "orbit", label: "обзор" },
  { mode: "chase", target: "player", label: "погоня: моя" },
  { mode: "chase", target: "leader", label: "погоня: лидер" },
];
let camIdx = 0;

const canvas = document.getElementById("sr-canvas");
let r3d = race3dInit(canvas, ctx);

// drive + sort the field each frame; race3d reads ctx.snapshot.cars fresh every render
let last = 0, paused = false, lapSeconds = 16, wetTarget = 0;
function tick(tm) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, (tm - last) / 1000 || 0); last = tm;
  const w = ctx.snapshot.wetness || 0;
  ctx.snapshot.wetness = w + (wetTarget - w) * Math.min(1, dt * 0.6);   // ease the weather so the road dries/wets smoothly
  if (!paused) {
    for (const c of ctx.snapshot.cars) {
      let f = c.lapFrac + (dt / lapSeconds) * c._spd;
      while (f >= 1) { f -= 1; c.lap += 1; }
      c.lapFrac = f;
    }
    ctx.snapshot.cars.sort((a, b) => (b.lap + b.lapFrac) - (a.lap + a.lapFrac));   // P1 first (leader/ring/director)
    ctx.snapshot.cars.forEach((c, p) => { c.pos = p + 1; });
  }
  const lap = (ctx.snapshot.cars.find((c) => c.player) || ctx.snapshot.cars[0]).lap;
  document.getElementById("sr-lap").textContent = lap;
}
requestAnimationFrame(tick);

// --- controls ---
function setCam(n) { camIdx = (n + CAM.length) % CAM.length; const s = CAM[camIdx]; ctx._cam3d = { mode: s.mode, target: s.target }; document.getElementById("sr-cam").textContent = "Камера: " + s.label; }
document.getElementById("sr-cam").onclick = () => setCam(camIdx + 1);
document.getElementById("sr-pause").onclick = (e) => { paused = !paused; e.target.textContent = paused ? "▶ Пуск" : "⏸ Пауза"; };
document.getElementById("sr-rain").onclick = (e) => { wetTarget = wetTarget > 0 ? 0 : 0.85; e.target.textContent = wetTarget > 0 ? "☀ Сухо" : "☂ Дождь"; };

// track picker: rebuild the whole scene on a new track (geometry is built once at init)
const sel = document.getElementById("sr-track");
sel.innerHTML = '<option value="">Барселона (по умолч.)</option>' + Object.keys(TRACK_SHAPES).map((k) => `<option value="${k}">${k}</option>`).join("");
sel.onchange = () => {
  const name = sel.value || null;
  r3d.dispose();
  for (const c of ctx.snapshot.cars) { c.lap = 0; c.lapFrac = c.idx / 22; }
  ctx.snapshot.trackName = name;
  r3d = race3dInit(canvas, ctx);
  setCam(camIdx);
};
setCam(0);
