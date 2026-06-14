// ApexWeb/src/ui/editor.js — standalone top-down track editor. Drag/add/remove the control points;
// the road repaints live via the SHARED track_paint (so the editor == the game). Save -> localStorage.
import { buildCenterline, splinePath, bounds, tangentAt, offsetPoint, racingLineOffset, radiusAt } from "../geom3d.js";
import { TRACK_SHAPES, TRACK_NAMES } from "../track_shapes.js";
import { paintTrack } from "../track_paint.js";
import { saveTrack, clearTrack, loadAll } from "../track_store.js";

const HALF_W = 3.8, WORLD = 120, R = 7;                 // road half-width (world); world span; handle radius (px)
const EMPTY = "Пустая";                                 // scratch option: a default oval to experiment on
const OVAL = (() => { const a = []; for (let i = 0; i < 16; i++) { const t = i / 16 * Math.PI * 2; a.push(0.5 + 0.34 * Math.cos(t), 0.5 + 0.22 * Math.sin(t)); } return a; })();
const cv = document.getElementById("cv"), g = cv.getContext("2d");
const sizeCanvas = () => { const s = Math.min(window.innerWidth - 300, window.innerHeight); cv.width = cv.height = Math.max(420, s); };
sizeCanvas(); window.addEventListener("resize", () => { sizeCanvas(); base = null; render(); });

let name = TRACK_NAMES[0];                               // current circuit (a TRACK_SHAPES key, or EMPTY)
let pts = [];                                            // editable control points: [[x,y],...] normalized 0..1
let drag = -1;                                           // index of the point being dragged, or -1
let armed = null;                                        // armed object type to place (objects, Task 5)
const objects = [];                                     // placed objects {type,x,y,rot} (Task 5)
let driving = false, raf = 0, lastT = 0;                // car preview ("прокатить"): kinematic cars on the racing line
const cars = [];                                        // [{frac, col}] while driving
const CAR_COLS = ["#e8453c", "#3d7aa0", "#ffd24a", "#46d08a", "#b06fd0", "#e07a1a"];

let view = { zoom: 1, panX: 0, panY: 0 };               // editor zoom/pan on top of the base fit
let base = null;                                        // stable base fit {pad,sc,cx,cy,size}; recomputed only on load / "по размеру"
function computeBase() {
  const cl = buildCenterline(splinePath(toFlat(pts))), b = bounds(cl), pad = 0.12 * cv.width;
  base = { pad, sc: (cv.width - 2 * pad) / b.size, cx: b.cx, cy: b.cy, size: b.size };
}

const toPts = (flat) => { const p = []; for (let i = 0; i < flat.length; i += 2) p.push([flat[i], flat[i + 1]]); return p; };
const toFlat = (p) => p.flatMap((q) => q);
const presetFlat = (n) => (n === EMPTY ? OVAL : (TRACK_SHAPES[n] || TRACK_SHAPES[TRACK_NAMES[0]]));
// decimate a dense flat preset to ~N evenly-spaced control points (so dragging is manageable)
function decimate(flat, N) {
  const all = toPts(flat); const step = all.length / N, out = [];
  for (let i = 0; i < N; i++) out.push(all[Math.floor(i * step)].slice());
  return out;
}
function loadTrack(n) {
  name = n;
  const saved = loadAll()[n];                            // edited control points are already sparse -> use directly
  if (saved && Array.isArray(saved.points) && saved.points.length >= 8) {
    pts = toPts(saved.points);
    objects.length = 0; for (const o of (saved.objects || [])) objects.push({ ...o });
  } else {                                               // fresh preset: decimate the dense path to draggable points
    pts = n === EMPTY ? toPts(OVAL) : decimate(presetFlat(n), 48);
    objects.length = 0;
  }
  if (pts.length < 4) pts = decimate(presetFlat(n), 48);
  view = { zoom: 1, panX: 0, panY: 0 }; base = null;   // fresh fit per track (computed lazily in frame)
  render();
}

// world<->canvas mapping that fits the track (with margin) to the square canvas
function frame() {
  if (!base) computeBase();
  const cl = buildCenterline(splinePath(toFlat(pts)));   // cl still per-frame (pts move while dragging); fit stays stable
  const { pad, sc, cx, cy, size } = base, z = view.zoom;
  const baseC = (q) => [pad + (q[0] - cx + size / 2) * sc, pad + (q[1] - cy + size / 2) * sc];
  const C = (q) => { const c = baseC(q); return [c[0] * z + view.panX, c[1] * z + view.panY]; };
  return { cl, C, pxPerWorld: (sc / (WORLD / size)) * z, hwN: HALF_W * size / WORLD };
}
function render() {
  if (pts.length < 3) return;
  const { cl, C, pxPerWorld } = frame();
  paintTrack(g, cl, C, pxPerWorld, HALF_W);              // the SAME painting the game uses
  for (let i = 0; i < pts.length; i++) {                 // control-point handles
    const c = C(pts[i]); g.beginPath(); g.arc(c[0], c[1], R, 0, 7);
    g.fillStyle = i === drag ? "#ffd24a" : "#7ad0ff"; g.fill(); g.lineWidth = 2; g.strokeStyle = "#0b0d12"; g.stroke();
  }
  for (const o of objects) drawObj(g, C([o.x, o.y]), o);   // placed objects on top
  if (driving) for (const car of cars) {                 // kinematic cars riding the racing line (car.lat = eased offset, set in tick)
    const p = offsetPoint(cl, car.frac, car.lat), t = tangentAt(cl, car.frac);
    drawCar(C(p), Math.atan2(t[1], t[0]), car.col);
  }
}

// nearest control point within `R*1.6` px of (mx,my), or -1
function pick(mx, my) {
  const { C } = frame(); let best = -1, bd = (R * 1.6) ** 2;
  for (let i = 0; i < pts.length; i++) { const c = C(pts[i]), d = (c[0] - mx) ** 2 + (c[1] - my) ** 2; if (d < bd) { bd = d; best = i; } }
  return best;
}
// invert the canvas mapping -> normalized track point
function unproject(mx, my) {
  if (!base) computeBase();
  const { pad, sc, cx, cy, size } = base;
  const bx = (mx - view.panX) / view.zoom, by = (my - view.panY) / view.zoom;   // undo zoom/pan
  return [(bx - pad) / sc - size / 2 + cx, (by - pad) / sc - size / 2 + cy];      // undo base fit
}
const evtXY = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

cv.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return; const [mx, my] = evtXY(e);
  if (armed) { const p = unproject(mx, my); objects.push({ type: armed, x: p[0], y: p[1], rot: 0 }); render(); return; }   // place an armed object
  objDrag = pickObj(mx, my); if (objDrag >= 0) { render(); return; }   // grab an existing object before a point
  drag = pick(mx, my); render();
});
window.addEventListener("mousemove", (e) => {
  const [mx, my] = evtXY(e);
  if (objDrag >= 0) { const p = unproject(mx, my); objects[objDrag].x = p[0]; objects[objDrag].y = p[1]; render(); }
  else if (drag >= 0) { pts[drag] = unproject(mx, my); render(); }
});
window.addEventListener("mouseup", () => { if (drag >= 0 || objDrag >= 0) { drag = -1; objDrag = -1; render(); } });
cv.addEventListener("dblclick", (e) => {                 // add a point on the nearest segment
  const [mx, my] = evtXY(e), p = unproject(mx, my);
  let bi = 0, bd = Infinity;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], d = segDist(p, a, b); if (d < bd) { bd = d; bi = i; } }
  pts.splice(bi + 1, 0, p); render();
});
cv.addEventListener("contextmenu", (e) => {              // right-click: delete the object under the cursor, else the nearest point (min 4)
  e.preventDefault(); const [mx, my] = evtXY(e); const oi = pickObj(mx, my);
  if (oi >= 0) { objects.splice(oi, 1); render(); return; }
  const i = pick(mx, my); if (i >= 0 && pts.length > 4) { pts.splice(i, 1); render(); }
});
cv.addEventListener("wheel", (e) => {
  e.preventDefault(); const [mx, my] = evtXY(e), oi = pickObj(mx, my);
  if (oi >= 0) { objects[oi].rot = (objects[oi].rot || 0) + (e.deltaY > 0 ? 0.2 : -0.2); render(); return; }   // over an object -> rotate it
  const k = Math.max(1, Math.min(8, view.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))) / view.zoom;   // zoom toward the cursor
  view.panX = mx - (mx - view.panX) * k; view.panY = my - (my - view.panY) * k; view.zoom *= k;
  render();
}, { passive: false });
let panning = null;                                     // middle-drag pan
cv.addEventListener("mousedown", (e) => { if (e.button === 1) { e.preventDefault(); panning = { mx: e.clientX, my: e.clientY, px: view.panX, py: view.panY }; } });
window.addEventListener("mousemove", (e) => { if (panning) { view.panX = panning.px + (e.clientX - panning.mx); view.panY = panning.py + (e.clientY - panning.my); render(); } });
window.addEventListener("mouseup", (e) => { if (e.button === 1) panning = null; });
document.getElementById("fit").onclick = () => { view = { zoom: 1, panX: 0, panY: 0 }; base = null; render(); };
function segDist(p, a, b) {                               // distance point->segment in normalized space
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9;
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2; t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
// draw an object's editor icon at canvas point c, rotated by o.rot
function drawObj(g, c, o) {
  g.save(); g.translate(c[0], c[1]); g.rotate(o.rot || 0); g.lineWidth = 2;
  if (o.type === "stand") { g.fillStyle = "#9aa0aa"; g.fillRect(-16, -7, 32, 14); g.strokeStyle = "#222"; g.strokeRect(-16, -7, 32, 14); }
  else if (o.type === "banner") { g.fillStyle = "#3d7aa0"; g.fillRect(-18, -4, 36, 8); }
  else if (o.type === "tree") { g.fillStyle = "#2e7d32"; g.beginPath(); g.arc(0, 0, 9, 0, 7); g.fill(); }
  else { g.fillStyle = "#e07a1a"; g.beginPath(); g.moveTo(0, -10); g.lineTo(8, 8); g.lineTo(-8, 8); g.closePath(); g.fill(); }   // cone
  g.restore();
}
// topmost object within ~18px of (mx,my), or -1
function pickObj(mx, my) { const { C } = frame(); for (let i = objects.length - 1; i >= 0; i--) { const c = C([objects[i].x, objects[i].y]); if ((c[0] - mx) ** 2 + (c[1] - my) ** 2 < 18 ** 2) return i; } return -1; }

// a little car: oriented triangle at canvas point c, heading `ang` (canvas radians)
function drawCar(c, ang, col) {
  g.save(); g.translate(c[0], c[1]); g.rotate(ang); g.beginPath();
  g.moveTo(9, 0); g.lineTo(-6, 5); g.lineTo(-6, -5); g.closePath();
  g.fillStyle = col; g.fill(); g.lineWidth = 1.5; g.strokeStyle = "#0b0d12"; g.stroke(); g.restore();
}
// advance each car along the centerline each frame; slower through tighter corners. loops until ⏹.
function tick(t) {
  if (!driving) return;
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0); lastT = t;
  const { cl, hwN } = frame();
  for (const car of cars) {
    const tsf = Math.max(0.35, Math.min(1, radiusAt(cl, car.frac, 1 / 60) / 0.12));   // target speed: slow in tight corners (wide window = stable, not noisy)
    car.sf += (tsf - car.sf) * 0.1;                       // ease the speed so it can't lurch frame-to-frame (kills the stutter)
    car.frac = (car.frac + dt * (1 / 7) * car.sf) % 1;    // ~7 s/lap at full speed
    car.lat += (racingLineOffset(cl, car.frac, hwN * 0.45) - car.lat) * 0.12;   // ease onto the racing line (no sideways dart at corners/S-bends)
  }
  render();
  raf = requestAnimationFrame(tick);
}
// ▶/⏹ toggle: spawn a handful of cars spread round the lap and animate, or stop + clear
function toggleDrive() {
  driving = !driving;
  const btn = document.getElementById("drive");
  btn.classList.toggle("on", driving); btn.textContent = driving ? "⏹ Стоп" : "▶ Прокатить";
  if (driving) {
    const { cl, hwN } = frame();
    cars.length = 0;
    for (let i = 0; i < CAR_COLS.length; i++) { const frac = i / CAR_COLS.length; cars.push({ frac, col: CAR_COLS[i], lat: racingLineOffset(cl, frac, hwN * 0.45), sf: 1 }); }   // init lat on the line, sf at full
    lastT = 0; render(); raf = requestAnimationFrame(tick);   // render once so cars show immediately, not only after the first frame
  } else { cancelAnimationFrame(raf); render(); }
}

// --- toolbar ---
const sel = document.getElementById("preset");
for (const n of [...TRACK_NAMES, EMPTY]) { const o = document.createElement("option"); o.value = o.textContent = n; sel.appendChild(o); }
sel.onchange = () => loadTrack(sel.value);
// object palette: click a type to arm it, then click the canvas to drop one
const OBJ = { stand: "Трибуна", banner: "Баннер", tree: "Дерево", cone: "Конус" };
let objDrag = -1;   // index of the object being dragged, or -1
const pal = document.getElementById("palette");
for (const [t, label] of Object.entries(OBJ)) {
  const btn = document.createElement("button"); btn.textContent = label; btn.dataset.t = t; btn.style.margin = "3px";
  btn.onclick = () => { armed = armed === t ? null : t; for (const b of pal.querySelectorAll("button")) b.classList.toggle("on", b.dataset.t === armed); };
  pal.appendChild(btn);
}
document.getElementById("save").onclick = () => { saveTrack(name, { points: toFlat(pts), objects }); toast("Сохранено: " + name); };
document.getElementById("reset").onclick = () => { clearTrack(name); loadTrack(name); toast("Сброшено к пресету"); };
document.getElementById("drive").onclick = toggleDrive;
document.getElementById("export").onclick = () => {     // download the current track as JSON
  const blob = new Blob([JSON.stringify({ name, points: toFlat(pts), objects }, null, 0)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name + ".json"; a.click(); URL.revokeObjectURL(a.href);
};
document.getElementById("import").onclick = () => document.getElementById("file").click();
document.getElementById("file").onchange = (e) => {     // load a track JSON back in
  const f = e.target.files[0]; if (!f) return; const r = new FileReader();
  r.onload = () => { try { const d = JSON.parse(r.result); pts = toPts(d.points); objects.length = 0; for (const o of (d.objects || [])) objects.push({ ...o }); render(); toast("Импортировано"); } catch { toast("Битый JSON"); } };
  r.readAsText(f);
};
document.getElementById("hint").innerHTML = "ЛКМ-тащи — точку/объект<br>2× клик по дороге — добавить точку<br>Объект: выбери тип → клик по холсту<br>Колесо над объектом — повернуть<br>ПКМ — удалить точку/объект<br>▶ Прокатить — пустить машинки по трассе<br>💾 Сохранить → откроется в 3D";
function toast(t) { const el = document.getElementById("toast"); el.textContent = t; el.style.opacity = 1; setTimeout(() => el.style.opacity = 0, 1400); }

loadTrack(name);
