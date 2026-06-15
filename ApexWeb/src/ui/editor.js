// ApexWeb/src/ui/editor.js — standalone top-down track editor. Drag/add/remove the control points;
// the road repaints live via the SHARED track_paint (so the editor == the game). Save -> localStorage.
import { buildCenterline, splinePath, bounds, tangentAt, offsetPoint, racingLineOffset, radiusAt, pointAt, sectorCornerClasses, nearestFrac } from "../geom3d.js";
import { TRACK_SHAPES, TRACK_NAMES } from "../track_shapes.js";
import { paintTrack } from "../track_paint.js";
import { saveTrack, clearTrack, loadAll } from "../track_store.js";
import { fitOutline } from "../editor_preview.js";   // pure, THREE-free — safe to import statically
import { suggestZonesFromClasses } from "../autozones.js";   // pure heuristic for the «Авто» button
import { hydratePack } from "../track_pack.js";
import { saveToRepo, publish } from "../track_repo.js";

const HALF_W = 3.8, WORLD = 120, R = 7;                 // road half-width (world); world span; handle radius (px)
const EMPTY = "Пустая";                                 // scratch option: a default oval to experiment on
const OVAL = (() => { const a = []; for (let i = 0; i < 16; i++) { const t = i / 16 * Math.PI * 2; a.push(0.5 + 0.34 * Math.cos(t), 0.5 + 0.22 * Math.sin(t)); } return a; })();
const cv = document.getElementById("cv"), g = cv.getContext("2d");
// size the drawing buffer to the canvas's OWN displayed size, so click coords (CSS px) map 1:1 to
// canvas px (dragging works at any window size). A ResizeObserver re-syncs on layout/window changes.
function sizeCanvas() { const w = Math.max(1, cv.clientWidth), h = Math.max(1, cv.clientHeight); if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; return true; } return false; }
const resyncCanvas = () => { if (sizeCanvas()) { base = null; render(); } };
sizeCanvas(); new ResizeObserver(resyncCanvas).observe(cv); window.addEventListener("resize", resyncCanvas);   // re-sync via either mechanism

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
  const cl = buildCenterline(splinePath(toFlat(pts))), b = bounds(cl);
  const fit = Math.min(cv.width, cv.height), pad = 0.12 * fit;   // fit to the SHORTER side, centred (canvas may be wide)
  base = { pad, sc: (fit - 2 * pad) / b.size, cx: b.cx, cy: b.cy, size: b.size, ox: (cv.width - fit) / 2, oy: (cv.height - fit) / 2 };
}

const N_MINI = 18;                                      // mini-sectors = 18 equal lap-fraction spans (matches sim track.js)
let mode = "edit";                                      // "edit" | "pit" | "zones"
let pit = null, pitLoss = null;                         // pit-box marker {x,y} + pit-loss seconds
let pitLane = null, pitNext = "entry";                  // {entry,exit,side,width} authored lane + which end the next click sets
const zones = [];                                       // [{sectors:[..], ease, type}]  == TRACK.overtake_zones
let activeZone = -1;                                    // index of the zone being edited, or -1
let cornerOverrides = {};                               // { sectorIndex: "straight"|"high"|"med"|"low" }
const ZONE_COL = { brake: "#d83b3b", slip: "#3d7aa0" };
const CLASS_COL = { straight: "#3a5a38", high: "#46d08a", med: "#ffd24a", low: "#e8453c" };

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
    pit = saved.pit || null; pitLoss = (typeof saved.pitLoss === "number") ? saved.pitLoss : null; pitLane = saved.pitLane || null;
    zones.length = 0; for (const z of (saved.zones || [])) zones.push({ sectors: [...z.sectors], ease: z.ease, type: z.type });
    cornerOverrides = saved.cornerOverrides ? { ...saved.cornerOverrides } : {};
  } else {                                               // fresh preset: decimate the dense path to draggable points
    pts = n === EMPTY ? toPts(OVAL) : decimate(presetFlat(n), 48);
    objects.length = 0; pit = null; pitLoss = null; zones.length = 0; cornerOverrides = {}; pitLane = null;
  }
  activeZone = -1;
  if (document.getElementById("zonelist")) refreshZoneList();
  if (pts.length < 4) pts = decimate(presetFlat(n), 48);
  view = { zoom: 1, panX: 0, panY: 0 }; base = null;   // fresh fit per track (computed lazily in frame)
  render();
  drawSvgRef(name);   // refresh the original-outline reference for the picked circuit
}

// world<->canvas mapping that fits the track (with margin) to the square canvas
function frame() {
  if (!base) computeBase();
  const cl = buildCenterline(splinePath(toFlat(pts)));   // cl still per-frame (pts move while dragging); fit stays stable
  const { pad, sc, cx, cy, size, ox, oy } = base, z = view.zoom;
  const baseC = (q) => [ox + pad + (q[0] - cx + size / 2) * sc, oy + pad + (q[1] - cy + size / 2) * sc];
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
  if (mode === "zones") drawSectors(g, cl, C, pxPerWorld);
  if (mode === "pit" && pitLane) {                                                         // draw the authored lane: offset of the track entry->0->exit
    const cl = buildCenterline(splinePath(toFlat(pts))), off = (pitLane.side || 1) * (pitLane.width || 2.5) * (HALF_W * base.size / WORLD);
    const segFwd = (a, b) => { const d = ((b - a) % 1 + 1) % 1; const out = []; for (let k = 0; k <= 12; k++) out.push(C(offsetPoint(cl, ((a + d * k / 12) % 1 + 1) % 1, off))); return out; };
    const lane = [...segFwd(pitLane.entry ?? 0.95, 0), ...segFwd(0, pitLane.exit ?? 0.06)];
    g.beginPath(); lane.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]));
    g.lineWidth = 5; g.strokeStyle = "rgba(255,210,74,.8)"; g.lineCap = "round"; g.stroke();
    const box = C(offsetPoint(cl, 0, off)); g.fillStyle = "#ffd24a"; g.font = "bold 15px system-ui"; g.textAlign = "center"; g.fillText("⛽", box[0], box[1] + 5);
  }
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
  const { pad, sc, cx, cy, size, ox, oy } = base;
  const bx = (mx - view.panX) / view.zoom, by = (my - view.panY) / view.zoom;   // undo zoom/pan
  return [(bx - ox - pad) / sc - size / 2 + cx, (by - oy - pad) / sc - size / 2 + cy];   // undo base fit (centred)
}
const evtXY = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

cv.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return; const [mx, my] = evtXY(e);
  if (mode === "pit") {                                                                    // author the pit lane: alternate entry / exit
    if (pts.length < 3) { toast("Мало точек"); return; }
    pit = unproject(mx, my);
    const cl = buildCenterline(splinePath(toFlat(pts))), f = nearestFrac(cl, pit, 360);
    pitLane = pitLane || { entry: 0.95, exit: 0.06, side: 1, width: parseFloat(document.getElementById("pit-width").value) || 2.5 };
    pitLane[pitNext] = f; pitNext = pitNext === "entry" ? "exit" : "entry";
    document.getElementById("pithint").textContent = "клик ставит: " + (pitNext === "entry" ? "вход" : "выход");
    render(); return;
  }
  if (mode === "zones") {                                                                  // toggle a sector in the active zone
    if (activeZone < 0) { toast("Сначала создай зону"); return; }
    const sec = sectorAt(mx, my), z = zones[activeZone], i = z.sectors.indexOf(sec);
    if (i >= 0) z.sectors.splice(i, 1); else z.sectors.push(sec);
    z.sectors.sort((a, b) => a - b); refreshZoneList(); render(); return;   // keep the zone list text in sync with painted sectors
  }
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
cv.addEventListener("contextmenu", (e) => {
  e.preventDefault(); const [mx, my] = evtXY(e);
  if (mode === "zones") {                                // cycle the corner class of the sector under the cursor
    const seq = ["straight", "high", "med", "low"], sec = sectorAt(mx, my);
    const cur = cornerOverrides[sec] || sectorCornerClasses(buildCenterline(splinePath(toFlat(pts))), N_MINI)[sec];
    cornerOverrides[sec] = seq[(seq.indexOf(cur) + 1) % seq.length]; render(); return;
  }
  const oi = pickObj(mx, my);
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
// class of mini-sector m: manual override if set, else auto from curvature
function sectorClass(cl, classesAuto, m) { return cornerOverrides[m] || classesAuto[m]; }
// which mini-sector a canvas point falls in (via nearest centerline fraction)
function sectorAt(mx, my) { return Math.floor(nearestFrac(buildCenterline(splinePath(toFlat(pts))), unproject(mx, my), 360) * N_MINI) % N_MINI; }
// draw the 18 mini-sectors along the road: each sector tinted by corner class, zone sectors stroked
// in their type colour (active zone brighter), + a sector number. `pxPerWorld` passed from render().
function drawSectors(g, cl, C, pxPerWorld) {
  const classesAuto = sectorCornerClasses(cl, N_MINI);
  const zoneOf = (m) => { for (let zi = 0; zi < zones.length; zi++) if (zones[zi].sectors.includes(m)) return zi; return -1; };
  for (let m = 0; m < N_MINI; m++) {
    const a = m / N_MINI, b = (m + 1) / N_MINI, zi = zoneOf(m);
    g.beginPath();
    for (let s = 0; s <= 10; s++) { const c = C(pointAt(cl, a + (b - a) * s / 10)); s ? g.lineTo(c[0], c[1]) : g.moveTo(c[0], c[1]); }
    g.lineWidth = HALF_W * 2 * 1.5 * pxPerWorld;           // a touch wider than the road, translucent
    g.globalAlpha = zi >= 0 ? (zi === activeZone ? 0.7 : 0.45) : 0.30;
    g.strokeStyle = zi >= 0 ? ZONE_COL[zones[zi].type] : CLASS_COL[sectorClass(cl, classesAuto, m)];
    g.lineCap = "butt"; g.stroke(); g.globalAlpha = 1;
    const mid = C(pointAt(cl, (a + b) / 2));               // sector number
    g.fillStyle = "#e8e8ea"; g.font = "10px system-ui"; g.textAlign = "center"; g.fillText(String(m), mid[0], mid[1]);
  }
  g.lineCap = "round";
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
// pull the committed track pack (ApexWeb/tracks/) into localStorage + list it under "Из репо"
hydratePack(saveTrack).then((names) => {
  if (!names.length) return;
  const grp = document.createElement("optgroup"); grp.label = "Из репо";
  for (const n of names) { const o = document.createElement("option"); o.value = o.textContent = n; grp.appendChild(o); }
  sel.insertBefore(grp, sel.firstChild);   // pack tracks at the top of the list
});
// object palette: click a type to arm it, then click the canvas to drop one
const OBJ = { stand: "Трибуна", banner: "Баннер", tree: "Дерево", cone: "Конус" };
let objDrag = -1;   // index of the object being dragged, or -1
const pal = document.getElementById("palette");
for (const [t, label] of Object.entries(OBJ)) {
  const btn = document.createElement("button"); btn.textContent = label; btn.dataset.t = t; btn.style.margin = "3px";
  btn.onclick = () => { armed = armed === t ? null : t; for (const b of pal.querySelectorAll("button")) b.classList.toggle("on", b.dataset.t === armed); };
  pal.appendChild(btn);
}
function setMode(m) {
  mode = m;
  for (const b of document.querySelectorAll("#modes button")) b.classList.toggle("on", b.id === "m-" + m);
  document.getElementById("pitctl").hidden = m !== "pit";
  document.getElementById("zonectl").hidden = m !== "zones";
  if (m === "pit") {
    document.getElementById("pitloss").value = (pitLoss == null ? "" : pitLoss);
    document.getElementById("pit-width").value = (pitLane && pitLane.width) || 2.5;
    document.getElementById("pithint").textContent = "клик ставит: " + (pitNext === "entry" ? "вход" : "выход");
  }
  refreshZoneList(); render();
}
document.getElementById("m-edit").onclick = () => setMode("edit");
document.getElementById("m-pit").onclick = () => setMode("pit");
document.getElementById("m-zones").onclick = () => setMode("zones");
function refreshZoneList() {
  const el = document.getElementById("zonelist");
  el.innerHTML = zones.map((z, i) => `<a href="#" data-z="${i}" style="color:${i === activeZone ? "#ffd24a" : "#7ad0ff"}">${z.type === "brake" ? "тормозн." : "слип"} [${z.sectors.join(",")}]</a> <a href="#" data-del="${i}" style="color:#e8453c">✕</a>`).join("<br>") || "(нет зон)";
  for (const a of el.querySelectorAll("a[data-z]")) a.onclick = (e) => { e.preventDefault(); activeZone = +a.dataset.z; document.getElementById("z-ease").value = zones[activeZone].ease; refreshZoneList(); render(); };
  for (const a of el.querySelectorAll("a[data-del]")) a.onclick = (e) => { e.preventDefault(); zones.splice(+a.dataset.del, 1); activeZone = -1; refreshZoneList(); render(); };
}
function addZone(type) { zones.push({ sectors: [], ease: parseFloat(document.getElementById("z-ease").value) || 0.5, type }); activeZone = zones.length - 1; refreshZoneList(); render(); }
document.getElementById("z-brake").onclick = () => addZone("brake");
document.getElementById("z-slip").onclick = () => addZone("slip");
document.getElementById("autozones").onclick = () => {   // suggest zones from the corner classes (you edit after)
  const cl = buildCenterline(splinePath(toFlat(pts)));
  const auto = sectorCornerClasses(cl, N_MINI);
  const eff = auto.map((c, m) => cornerOverrides[m] || c);   // honour right-click corner overrides
  const zs = suggestZonesFromClasses(eff);
  zones.length = 0; for (const z of zs) zones.push(z);
  activeZone = -1; refreshZoneList(); render();
  toast(zs.length ? ("Авто-зоны: " + zs.length) : "Зоны не найдены — расставь вручную");
};
document.getElementById("z-ease").oninput = (e) => { if (activeZone >= 0) { zones[activeZone].ease = parseFloat(e.target.value); } };
document.getElementById("pitloss").oninput = (e) => { const v = parseFloat(e.target.value); pitLoss = isNaN(v) ? null : v; };
document.getElementById("pit-side").onclick = () => { pitLane = pitLane || { entry: 0.95, exit: 0.06, side: 1, width: 2.5 }; pitLane.side = -pitLane.side; render(); };
document.getElementById("pit-width").oninput = (e) => { if (pitLane) { pitLane.width = parseFloat(e.target.value) || 2.5; render(); } };
document.getElementById("save").onclick = async () => {
  const rec = { name, points: toFlat(pts), objects, pit, pitLoss, zones, cornerOverrides, pitLane };
  saveTrack(name, rec);                                   // local cache (and offline fallback)
  const r = await saveToRepo(rec);                        // repo file via the node helper
  toast(r.ok ? ("В репо: tracks/" + r.slug + ".json") : "Сохранено локально (нет node-сервера для записи в репо)");
};
document.getElementById("reset").onclick = () => { clearTrack(name); loadTrack(name); toast("Сброшено к пресету"); };
document.getElementById("drive").onclick = toggleDrive;
document.getElementById("publish").onclick = async () => {
  toast("Публикую…");
  const r = await publish();
  toast(r.ok ? "Опубликовано на гит" : ("Не вышло: " + r.message));
};
document.getElementById("race").onclick = () => {       // race the current track in the sim
  saveTrack(name, { points: toFlat(pts), objects, pit, pitLoss, zones, cornerOverrides, pitLane });   // persist first
  localStorage.setItem("apexweb_race_track", name);     // main.js picks this up on boot
  location.href = "index.html";                          // go to the game -> it boots straight into the race
};
document.getElementById("export").onclick = () => {     // download the current track as JSON
  const blob = new Blob([JSON.stringify({ name, points: toFlat(pts), objects, pit, pitLoss, zones, cornerOverrides, pitLane }, null, 0)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name + ".json"; a.click(); URL.revokeObjectURL(a.href);
};
document.getElementById("import").onclick = () => document.getElementById("file").click();
document.getElementById("file").onchange = (e) => {     // load a track JSON back in
  const f = e.target.files[0]; if (!f) return; const r = new FileReader();
  r.onload = () => { try { const d = JSON.parse(r.result); pts = toPts(d.points); objects.length = 0; for (const o of (d.objects || [])) objects.push({ ...o });
    pit = d.pit || null; pitLoss = (typeof d.pitLoss === "number") ? d.pitLoss : null;
    zones.length = 0; for (const z of (d.zones || [])) zones.push({ sectors: [...z.sectors], ease: z.ease, type: z.type });
    cornerOverrides = d.cornerOverrides ? { ...d.cornerOverrides } : {}; pitLane = d.pitLane || null;
    activeZone = -1; view = { zoom: 1, panX: 0, panY: 0 }; base = null; refreshZoneList();
    render(); toast("Импортировано"); } catch { toast("Битый JSON"); } };
  r.readAsText(f);
};
document.getElementById("hint").innerHTML = "Колесо — зум к курсору · средняя-кнопка — пан · ⊡ по размеру<br><b>Точки:</b> ЛКМ-тащи точку/объект · 2× клик — добавить · ПКМ — удалить · объект: тип→клик · колесо над объектом — повернуть<br><b>Пит:</b> клик по холсту — поставить боксы + поле потери<br><b>Зоны:</b> создай зону → кликай сектора · ПКМ по сектору — класс поворота<br>▶ Прокатить — пустить машинки · 💾 Сохранить → 3D";
function toast(t) { const el = document.getElementById("toast"); el.textContent = t; el.style.opacity = 1; setTimeout(() => el.style.opacity = 0, 1400); }

// --- 3D preview (reuses the game renderer; loaded on demand so the editor works offline) + svg reference ---
let preview = null;
async function refresh3d() {
  if (preview) { preview.dispose(); preview = null; }
  if (pts.length < 3) { toast("Мало точек"); return; }
  try {
    const { startPreview } = await import("../editor3d.js");   // dynamic: a missing CDN/THREE won't break 2D editing
    preview = startPreview(document.getElementById("preview3d"), { points: toFlat(pts), objects });
  } catch { toast("3D-движок недоступен (нет сети?)"); }
}
function drawSvgRef(n) {
  const cv = document.getElementById("svgref"); if (!cv) return;
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  cv.width = Math.max(1, r.width * dpr); cv.height = Math.max(1, r.height * dpr);
  const g = cv.getContext("2d"); g.clearRect(0, 0, cv.width, cv.height);
  const flat = TRACK_SHAPES[n];
  if (!flat) { g.fillStyle = "#8a909c"; g.font = `${13 * dpr}px system-ui`; g.textAlign = "center"; g.fillText("(нет эталона)", cv.width / 2, cv.height / 2); return; }
  const pp = fitOutline(flat, cv.width, cv.height, 12 * dpr);
  g.beginPath();
  for (let i = 0; i < pp.length; i++) { const p = pp[i]; i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); }
  g.closePath(); g.lineWidth = 2 * dpr; g.strokeStyle = "#7ad0ff"; g.stroke();
}
document.getElementById("refresh3d").onclick = refresh3d;

loadTrack(name);
refresh3d();        // initial 3D preview (dynamic import; degrades gracefully offline)
