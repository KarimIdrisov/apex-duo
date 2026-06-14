// ApexWeb/src/ui/editor.js — standalone top-down track editor. Drag/add/remove the control points;
// the road repaints live via the SHARED track_paint (so the editor == the game). Save -> localStorage.
import { buildCenterline, splinePath, bounds } from "../geom3d.js";
import { TRACK_SHAPES, TRACK_NAMES } from "../track_shapes.js";
import { paintTrack } from "../track_paint.js";
import { saveTrack, clearTrack, loadAll } from "../track_store.js";

const HALF_W = 3.8, WORLD = 120, R = 7;                 // road half-width (world); world span; handle radius (px)
const EMPTY = "Пустая";                                 // scratch option: a default oval to experiment on
const OVAL = (() => { const a = []; for (let i = 0; i < 16; i++) { const t = i / 16 * Math.PI * 2; a.push(0.5 + 0.34 * Math.cos(t), 0.5 + 0.22 * Math.sin(t)); } return a; })();
const cv = document.getElementById("cv"), g = cv.getContext("2d");
const sizeCanvas = () => { const s = Math.min(window.innerWidth - 300, window.innerHeight); cv.width = cv.height = Math.max(420, s); };
sizeCanvas(); window.addEventListener("resize", () => { sizeCanvas(); render(); });

let name = TRACK_NAMES[0];                               // current circuit (a TRACK_SHAPES key, or EMPTY)
let pts = [];                                            // editable control points: [[x,y],...] normalized 0..1
let drag = -1;                                           // index of the point being dragged, or -1
let armed = null;                                        // armed object type to place (objects, Task 5)
const objects = [];                                     // placed objects {type,x,y,rot} (Task 5)

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
  render();
}

// world<->canvas mapping that fits the track (with margin) to the square canvas
function frame() {
  const cl = buildCenterline(splinePath(toFlat(pts))), b = bounds(cl), pad = 0.12 * cv.width;
  const sc = (cv.width - 2 * pad) / b.size;
  const C = (q) => [pad + (q[0] - b.cx + b.size / 2) * sc, pad + (q[1] - b.cy + b.size / 2) * sc];
  return { cl, C, pxPerWorld: sc / (WORLD / b.size) };   // pxPerWorld: track_paint widths are world units
}
function render() {
  if (pts.length < 3) return;
  const { cl, C, pxPerWorld } = frame();
  paintTrack(g, cl, C, pxPerWorld, HALF_W);              // the SAME painting the game uses
  for (let i = 0; i < pts.length; i++) {                 // control-point handles
    const c = C(pts[i]); g.beginPath(); g.arc(c[0], c[1], R, 0, 7);
    g.fillStyle = i === drag ? "#ffd24a" : "#7ad0ff"; g.fill(); g.lineWidth = 2; g.strokeStyle = "#0b0d12"; g.stroke();
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
  const cl = buildCenterline(splinePath(toFlat(pts))), b = bounds(cl), pad = 0.12 * cv.width, sc = (cv.width - 2 * pad) / b.size;
  return [(mx - pad) / sc - b.size / 2 + b.cx, (my - pad) / sc - b.size / 2 + b.cy];
}
const evtXY = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

cv.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  const [mx, my] = evtXY(e); drag = pick(mx, my); render();
});
window.addEventListener("mousemove", (e) => {
  if (drag < 0) return; const [mx, my] = evtXY(e); pts[drag] = unproject(mx, my); render();
});
window.addEventListener("mouseup", () => { if (drag >= 0) { drag = -1; render(); } });
cv.addEventListener("dblclick", (e) => {                 // add a point on the nearest segment
  const [mx, my] = evtXY(e), p = unproject(mx, my);
  let bi = 0, bd = Infinity;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], d = segDist(p, a, b); if (d < bd) { bd = d; bi = i; } }
  pts.splice(bi + 1, 0, p); render();
});
cv.addEventListener("contextmenu", (e) => {              // right-click removes the nearest point (min 4)
  e.preventDefault(); const [mx, my] = evtXY(e), i = pick(mx, my);
  if (i >= 0 && pts.length > 4) { pts.splice(i, 1); render(); }
});
function segDist(p, a, b) {                               // distance point->segment in normalized space
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9;
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2; t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// --- toolbar ---
const sel = document.getElementById("preset");
for (const n of [...TRACK_NAMES, EMPTY]) { const o = document.createElement("option"); o.value = o.textContent = n; sel.appendChild(o); }
sel.onchange = () => loadTrack(sel.value);
document.getElementById("save").onclick = () => { saveTrack(name, { points: toFlat(pts), objects }); toast("Сохранено: " + name); };
document.getElementById("reset").onclick = () => { clearTrack(name); loadTrack(name); toast("Сброшено к пресету"); };
document.getElementById("hint").innerHTML = "ЛКМ-тащи — двигать точку<br>2× клик по дороге — добавить точку<br>ПКМ по точке — удалить<br>💾 Сохранить → откроется в 3D-гонке";
function toast(t) { const el = document.getElementById("toast"); el.textContent = t; el.style.opacity = 1; setTimeout(() => el.style.opacity = 0, 1400); }

loadTrack(name);
