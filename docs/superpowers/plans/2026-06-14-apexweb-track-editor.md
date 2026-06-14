# ApexWeb Track Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone `editor.html` where the owner drags a track's control points (road repaints live, identical to the game) and drops objects (grandstands/banners/trees/cones); the saved track drives the in-game 3D view.

**Architecture:** Extract the canvas painting into a shared `track_paint.js` used by both the editor (2D) and `race3d.js` (canvas texture). A tiny `track_store.js` persists edits to `localStorage`; `race3d.js` resolves the effective track (edited points + objects, else the preset). `editor.js` is the only DOM-heavy new file. Sim/netcode untouched.

**Tech Stack:** Vanilla ES modules, `node --test` (no deps), Three.js r160 (render only). Run all commands from `ApexWeb/`. Commit with explicit pathspecs only (owner keeps parallel uncommitted work — never `git add -A`). Footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

**Reference:** spec `docs/superpowers/specs/2026-06-14-apexweb-track-editor-design.md`.

---

## File Structure

- `src/track_store.js` (new) — `localStorage` persistence + `effectiveTrack` resolver. Pure, testable.
- `src/track_paint.js` (new) — shared canvas painting (grass/shoulder/edge/kerbs/asphalt/start). Pure (given a 2D ctx), testable via a mock ctx.
- `tests/track_store.test.js`, `tests/track_paint.test.js` (new).
- `src/ui/race3d.js` (modify) — paint via `track_paint`; resolve shape via `track_store`; render objects.
- `editor.html` (new) — standalone page (canvas + toolbar).
- `src/ui/editor.js` (new) — the editor logic (DOM + 2D canvas, no THREE).

---

## Task 1: `track_store.js` — localStorage persistence

**Files:**
- Create: `src/track_store.js`
- Test: `tests/track_store.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/track_store.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
// minimal localStorage shim (node has no DOM). track_store reads localStorage lazily (inside
// functions), so setting this before the tests run is sufficient even though imports hoist.
globalThis.localStorage = (() => { let m = {}; return {
  getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); },
  removeItem: (k) => { delete m[k]; }, clear: () => { m = {}; },
}; })();
import { loadAll, saveTrack, clearTrack, effectiveTrack } from "../src/track_store.js";

test("track_store: save -> load round-trip", () => {
  localStorage.clear();
  saveTrack("Монца", { points: [0, 0, 1, 0, 1, 1, 0, 1], objects: [{ type: "tree", x: 0.5, y: 0.5, rot: 0 }] });
  const all = loadAll();
  assert.deepEqual(all["Монца"].points, [0, 0, 1, 0, 1, 1, 0, 1]);
  assert.equal(all["Монца"].objects[0].type, "tree");
});

test("effectiveTrack: preset fallback when nothing saved, edited points when saved", () => {
  localStorage.clear();
  const preset = [0, 0, 1, 0, 1, 1, 0, 1];
  let t = effectiveTrack("Спа", preset);
  assert.deepEqual(t.points, preset); assert.deepEqual(t.objects, []);
  saveTrack("Спа", { points: [0.1, 0.1, 0.9, 0.1, 0.9, 0.9, 0.1, 0.9], objects: [] });
  t = effectiveTrack("Спа", preset);
  assert.deepEqual(t.points, [0.1, 0.1, 0.9, 0.1, 0.9, 0.9, 0.1, 0.9]);
});

test("loadAll: corrupt JSON -> {} without throwing", () => {
  localStorage.setItem("apexweb_tracks", "{not json");
  assert.deepEqual(loadAll(), {});
});

test("clearTrack: removes one entry", () => {
  localStorage.clear();
  saveTrack("Баку", { points: [0, 0, 1, 1, 0, 1], objects: [] });
  clearTrack("Баку");
  assert.equal(loadAll()["Баку"], undefined);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/track_store.test.js`
Expected: FAIL — cannot resolve `../src/track_store.js`.

- [ ] **Step 3: Implement `src/track_store.js`**

```js
// ApexWeb/src/track_store.js — persistence for editor-edited tracks (localStorage) + the resolver
// the game uses to prefer edited points/objects over the built-in preset. All localStorage access
// is wrapped so private-mode / quota / corrupt data degrades cleanly to "no edits".
const KEY = "apexweb_tracks";
const ls = () => (typeof localStorage !== "undefined" ? localStorage : null);

export function loadAll() {
  const s = ls(); if (!s) return {};
  try { return JSON.parse(s.getItem(KEY) || "{}") || {}; } catch { return {}; }
}
export function saveTrack(name, data) {
  const s = ls(); if (!s) return;
  const all = loadAll(); all[name] = { points: data.points, objects: data.objects || [] };
  try { s.setItem(KEY, JSON.stringify(all)); } catch { /* quota/full -> ignore */ }
}
export function clearTrack(name) {
  const s = ls(); if (!s) return;
  const all = loadAll(); delete all[name];
  try { s.setItem(KEY, JSON.stringify(all)); } catch {}
}
// edited {points,objects} if a usable edit is saved for `name`, else the preset points + no objects.
export function effectiveTrack(name, presetPoints) {
  const e = loadAll()[name];
  return (e && Array.isArray(e.points) && e.points.length >= 8)
    ? { points: e.points, objects: Array.isArray(e.objects) ? e.objects : [] }
    : { points: presetPoints, objects: [] };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/track_store.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/track_store.js tests/track_store.test.js
git commit -m "feat(apexweb): track_store — localStorage persistence + effectiveTrack resolver" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `track_paint.js` — shared painting (extract from race3d)

**Files:**
- Create: `src/track_paint.js`
- Test: `tests/track_paint.test.js`

- [ ] **Step 1: Write the failing smoke test**

Create `tests/track_paint.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCenterline, splinePath, bounds } from "../src/geom3d.js";
import { TRACK_SHAPES } from "../src/track_shapes.js";
import { paintTrack, DEFAULT_COLORS } from "../src/track_paint.js";

// a 2D-context stand-in that records the calls paintTrack makes (node has no canvas)
function mockCtx(w, h) {
  const c = { fill: 0, stroke: 0 };
  return { canvas: { width: w, height: h }, lineJoin: "", lineCap: "", lineWidth: 0, fillStyle: "", strokeStyle: "",
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fillRect() { c.fill++; }, stroke() { c.stroke++; }, _c: c };
}

test("paintTrack: fills grass and strokes the road layers without throwing", () => {
  const g = mockCtx(512, 512);
  const cl = buildCenterline(splinePath(TRACK_SHAPES["Монца"])), b = bounds(cl);
  const C = (p) => [(p[0] - b.minX) / b.size * 512, (p[1] - b.minY) / b.size * 512];
  paintTrack(g, cl, C, 20, 3.8);
  assert.ok(g._c.fill >= 1, "grass fillRect");
  assert.ok(g._c.stroke >= 4, "shoulder + edge + asphalt + >=1 kerb chunk");
});

test("paintTrack: DEFAULT_COLORS exported with the expected keys", () => {
  for (const k of ["grass", "shoulder", "edge", "asphalt", "kerbA", "kerbB", "start"]) assert.ok(DEFAULT_COLORS[k], k);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/track_paint.test.js`
Expected: FAIL — cannot resolve `../src/track_paint.js`.

- [ ] **Step 3: Implement `src/track_paint.js`**

```js
// ApexWeb/src/track_paint.js — paint a track onto a 2D canvas context. Shared by the 3D race view
// (onto a CanvasTexture) and the editor (onto its display canvas) so both render IDENTICALLY.
// `cl` = buildCenterline(splinePath(points)); `C(p)` maps a normalized track point -> [canvasX,
// canvasY]; `pxPerWorld` scales line widths from world units; `halfW` = road half-width (world).
import { pointAt, tangentAt, cornerRuns, offsetPoint } from "./geom3d.js";

export const DEFAULT_COLORS = { grass: "#2f5236", shoulder: "#3a5a38", edge: "#5a5a64",
  asphalt: "#30303a", kerbA: "#d83b3b", kerbB: "#ededed", start: "#ffffff" };

export function paintTrack(g, cl, C, pxPerWorld, halfW, opts = {}) {
  const o = { ...DEFAULT_COLORS, ...opts }, STEPS = 600, CORNER_R = 0.10;
  g.lineJoin = "round"; g.lineCap = "round";
  const lap = (offN) => {
    g.beginPath();
    for (let k = 0; k <= STEPS; k++) { const f = k / STEPS, pp = offN ? offsetPoint(cl, f, offN) : pointAt(cl, f), c = C(pp); k ? g.lineTo(c[0], c[1]) : g.moveTo(c[0], c[1]); }
    g.closePath();
  };
  g.fillStyle = o.grass; g.fillRect(0, 0, g.canvas.width, g.canvas.height);          // grass
  lap(0); g.lineWidth = (halfW * 2 + 9) * pxPerWorld; g.strokeStyle = o.shoulder; g.stroke();   // run-off shoulder
  lap(0); g.lineWidth = (halfW * 2 + 0.8) * pxPerWorld; g.strokeStyle = o.edge; g.stroke();     // thin road edge
  {                                                                                  // red/white kerb RIM along the centerline through corners (peeks out both edges)
    const runs = cornerRuns(cl, STEPS, CORNER_R), CH = 7, KW = (halfW * 2 + 2.6) * pxPerWorld;
    for (const run of runs) for (let s = 0; s < run.len; s += CH) {
      g.beginPath();
      for (let j = 0; j <= CH && s + j <= run.len; j++) { const k = (run.start + s + j) % STEPS, c = C(pointAt(cl, k / STEPS)); j ? g.lineTo(c[0], c[1]) : g.moveTo(c[0], c[1]); }
      g.lineWidth = KW; g.strokeStyle = (Math.floor(s / CH) % 2) ? o.kerbA : o.kerbB; g.stroke();
    }
  }
  lap(0); g.lineWidth = halfW * 2 * pxPerWorld; g.strokeStyle = o.asphalt; g.stroke();          // asphalt on top -> kerb rim peeks out
  {                                                                                  // start/finish stripe (perpendicular across the road, computed in canvas space)
    const p0 = C(pointAt(cl, 0)), p1 = C(pointAt(cl, 0.002));
    let dx = p1[0] - p0[0], dy = p1[1] - p0[1], m = Math.hypot(dx, dy) || 1; const nx = -dy / m, ny = dx / m, L = halfW * pxPerWorld;
    g.beginPath(); g.moveTo(p0[0] + nx * L, p0[1] + ny * L); g.lineTo(p0[0] - nx * L, p0[1] - ny * L); g.lineWidth = 1.6 * pxPerWorld; g.strokeStyle = o.start; g.stroke();
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/track_paint.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/track_paint.js tests/track_paint.test.js
git commit -m "feat(apexweb): track_paint — shared canvas track painting (for editor + 3D view)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: race3d uses `track_paint` + `track_store` (refactor, no visual change yet)

**Files:**
- Modify: `src/ui/race3d.js`

This swaps race3d's inline painting for `paintTrack`, and resolves the shape via `effectiveTrack`
(still just the preset until the editor saves something). race3d is NOT unit-tested → verify with
`node --check` + the geom3d/store/paint suites + owner F5 (the 3D view must look the SAME as before).

- [ ] **Step 1: Add imports**

In `src/ui/race3d.js`, after the existing `import { TRACK_SHAPES } from "../track_shapes.js";` line, add:

```js
import { paintTrack } from "../track_paint.js";
import { effectiveTrack } from "../track_store.js";
```

- [ ] **Step 2: Resolve the shape via the store**

Find:
```js
  const trackName = (ctx.snapshot && ctx.snapshot.trackName) || null;   // host picked the circuit from the seed; client reads it from the snapshot
  const path = (trackName && TRACK_SHAPES[trackName]) || TRACK_PATH;     // selected real circuit, else Barcelona fallback
  const cl = buildCenterline(splinePath(path));         // Catmull-Rom-smoothed: soft corners, no per-vertex snapping
```
Replace with:
```js
  const trackName = (ctx.snapshot && ctx.snapshot.trackName) || null;   // host picked the circuit from the seed; client reads it from the snapshot
  const edited = effectiveTrack(trackName, (trackName && TRACK_SHAPES[trackName]) || TRACK_PATH);   // owner's editor edits, else the preset
  const cl = buildCenterline(splinePath(edited.points));   // Catmull-Rom-smoothed: soft corners, no per-vertex snapping
```

- [ ] **Step 3: Replace the inline painting with `paintTrack`**

In the painted-plane block, find the lines from `g.fillStyle = "#2f5236"; g.fillRect(...)` through the
start/finish stripe block (the grass fill, the three `lap(0)` strokes, the kerb `{...}` block, the
asphalt stroke, and the start/finish `{...}` block — everything that draws on `g`). Replace ALL of
it with a single call:

```js
    paintTrack(g, cl, C, PXW, HALF_W);
```

Leave the surrounding canvas/`C`/`PXW`/`HALF`/`SIZE` setup and the `CanvasTexture`/quad/mesh code in
place — EXCEPT delete the now-unused local `lap` helper definition (line ~124; paintTrack has its own)
and the now-unused `STEPS` const (it was only used by the inline painting). After this, `cornerRuns` is
the ONLY geom3d import that becomes unused in race3d (its other uses were all in the painting). Change
the geom3d import line to drop just `cornerRuns` — `tangentAt` and `offsetPoint` STAY (still used by the
frame loop, lines ~194/286/291). Final line:

```js
import { buildCenterline, pointAt, tangentAt, bounds, sampleProg, racingLineOffset, offsetPoint, splinePath } from "../geom3d.js";
```

- [ ] **Step 4: Verify**

Run: `node --check src/ui/race3d.js` → expect exit 0.
Run: `node --test tests/geom3d.test.js tests/track_shapes.test.js tests/track_store.test.js tests/track_paint.test.js` → all pass.
Owner F5 (incognito): the 3D track must look the SAME as before this task (pure refactor).

- [ ] **Step 5: Commit**

```bash
git add src/ui/race3d.js
git commit -m "refactor(apexweb): race3d paints via shared track_paint + resolves shape via track_store (no visual change)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `editor.html` + `editor.js` — load, paint, drag/add/remove points, save

**Files:**
- Create: `editor.html`
- Create: `src/ui/editor.js`

Not unit-testable (DOM/canvas) → `node --check` + owner F5 (`localhost:8000/editor.html`).

- [ ] **Step 1: Create `editor.html`**

```html
<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Apex — редактор трассы</title>
<style>
  html,body{margin:0;height:100%;background:#11141a;color:#e8e8ea;font:14px system-ui,sans-serif;overflow:hidden}
  #wrap{display:flex;height:100%}
  #cv{background:#0b0d12;flex:0 0 auto;touch-action:none;cursor:crosshair}
  #panel{flex:1;min-width:240px;max-width:300px;padding:14px;overflow:auto;border-left:1px solid #222}
  h2{font-size:15px;margin:0 0 10px} .row{margin:8px 0} button,select{font:inherit}
  button{background:#222733;color:#e8e8ea;border:1px solid #3a4150;border-radius:6px;padding:7px 10px;cursor:pointer}
  button:hover{background:#2c3340} button.on{background:#2d5a7a;border-color:#3d7aa0}
  select{background:#222733;color:#e8e8ea;border:1px solid #3a4150;border-radius:6px;padding:6px;width:100%}
  .hint{color:#8a909c;font-size:12px;line-height:1.5;margin-top:10px}
  #toast{position:fixed;bottom:16px;left:16px;background:#2d5a7a;padding:8px 12px;border-radius:6px;opacity:0;transition:opacity .25s}
</style></head>
<body><div id="wrap"><canvas id="cv"></canvas><div id="panel">
  <h2>Редактор трассы</h2>
  <div class="row"><select id="preset"></select></div>
  <div class="row"><button id="save">💾 Сохранить</button> <button id="reset">↺ Сброс</button></div>
  <div class="row"><button id="export">⬇ Экспорт JSON</button> <button id="import">⬆ Импорт</button>
    <input id="file" type="file" accept="application/json" hidden></div>
  <div class="hint" id="hint"></div>
</div></div><div id="toast"></div>
<script type="module" src="src/ui/editor.js"></script></body></html>
```

- [ ] **Step 2: Create `src/ui/editor.js` (point editing + save; objects added in Task 5)**

```js
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
```

- [ ] **Step 3: Verify**

Run: `node --check src/ui/editor.js` → exit 0.
Owner F5: open `localhost:8000/editor.html`. Pick a circuit; drag points (road repaints); double-click to add; right-click to remove; Сохранить, then start a race on that circuit (its seed must pick it — for testing, the editor's name list matches the game's `pickTrack`) → the 3D view shows the edited shape.

- [ ] **Step 4: Commit**

```bash
git add editor.html src/ui/editor.js
git commit -m "feat(apexweb): track editor — drag/add/remove control points, live shared painting, save to localStorage" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Objects — editor placement + 3D rendering

**Files:**
- Modify: `src/ui/editor.js` (palette + place/drag/rotate/delete + draw icons)
- Modify: `src/ui/race3d.js` (render `edited.objects` as simple meshes)

- [ ] **Step 1: editor.js — add the object palette + interactions**

In `editor.html`, add to the panel (after the import row):
```html
  <div class="row" id="palette"><b style="font-size:12px">Объекты:</b><br></div>
```
In `src/ui/editor.js`, `armed` and `objects` are already declared (Task 4). Add the palette + drawing.
First, the palette types and arming (add in the `// --- toolbar ---` section, before the final `loadTrack(name)`):
```js
const OBJ = { stand: "Трибуна", banner: "Баннер", tree: "Дерево", cone: "Конус" };
const pal = document.getElementById("palette");
for (const [t, label] of Object.entries(OBJ)) { const btn = document.createElement("button"); btn.textContent = label; btn.dataset.t = t; btn.style.margin = "3px"; btn.onclick = () => { armed = armed === t ? null : t; for (const b of pal.querySelectorAll("button")) b.classList.toggle("on", b.dataset.t === armed); }; pal.appendChild(btn); }
let objDrag = -1;
```
Add object drawing. In `render()`, AFTER the control-point handle loop (still inside `render()`, so it
reuses the `C` already bound at the top of `render()` — do NOT re-declare `C`), add:
```js
  for (const o of objects) drawObj(g, C([o.x, o.y]), o);
```
Add the helpers (anywhere top-level):
```js
function drawObj(g, c, o) {
  g.save(); g.translate(c[0], c[1]); g.rotate(o.rot || 0); g.lineWidth = 2;
  if (o.type === "stand") { g.fillStyle = "#9aa0aa"; g.fillRect(-16, -7, 32, 14); g.strokeStyle = "#222"; g.strokeRect(-16, -7, 32, 14); }
  else if (o.type === "banner") { g.fillStyle = "#3d7aa0"; g.fillRect(-18, -4, 36, 8); }
  else if (o.type === "tree") { g.fillStyle = "#2e7d32"; g.beginPath(); g.arc(0, 0, 9, 0, 7); g.fill(); }
  else { g.fillStyle = "#e07a1a"; g.beginPath(); g.moveTo(0, -10); g.lineTo(8, 8); g.lineTo(-8, 8); g.closePath(); g.fill(); }
  g.restore();
}
function pickObj(mx, my) { const { C } = frame(); for (let i = objects.length - 1; i >= 0; i--) { const c = C([objects[i].x, objects[i].y]); if ((c[0] - mx) ** 2 + (c[1] - my) ** 2 < 18 ** 2) return i; } return -1; }
```
Wire the interactions: extend `mousedown` (place if armed, else pick an object before a point),
`mousemove` (drag an object), `mouseup` (clear), `contextmenu` (delete object), and add `wheel`
(rotate the object under the cursor). Replace the existing `mousedown`/`mousemove`/`mouseup`/
`contextmenu` handlers with:
```js
cv.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return; const [mx, my] = evtXY(e);
  if (armed) { const p = unproject(mx, my); objects.push({ type: armed, x: p[0], y: p[1], rot: 0 }); render(); return; }
  objDrag = pickObj(mx, my); if (objDrag >= 0) { render(); return; }
  drag = pick(mx, my); render();
});
window.addEventListener("mousemove", (e) => {
  const [mx, my] = evtXY(e);
  if (objDrag >= 0) { const p = unproject(mx, my); objects[objDrag].x = p[0]; objects[objDrag].y = p[1]; render(); }
  else if (drag >= 0) { pts[drag] = unproject(mx, my); render(); }
});
window.addEventListener("mouseup", () => { if (drag >= 0 || objDrag >= 0) { drag = -1; objDrag = -1; render(); } });
cv.addEventListener("contextmenu", (e) => {
  e.preventDefault(); const [mx, my] = evtXY(e); const oi = pickObj(mx, my);
  if (oi >= 0) { objects.splice(oi, 1); render(); return; }
  const i = pick(mx, my); if (i >= 0 && pts.length > 4) { pts.splice(i, 1); render(); }
});
cv.addEventListener("wheel", (e) => { const [mx, my] = evtXY(e), oi = pickObj(mx, my); if (oi >= 0) { e.preventDefault(); objects[oi].rot = (objects[oi].rot || 0) + (e.deltaY > 0 ? 0.2 : -0.2); render(); } }, { passive: false });
```
Also delete the now-superseded standalone `cv.addEventListener("mousedown"...)`, `mousemove`,
`mouseup`, `contextmenu` handlers from Task 4 (replaced above), and update the hint:
```js
document.getElementById("hint").innerHTML = "ЛКМ-тащи — точку/объект<br>2× клик по дороге — добавить точку<br>Объект: выбери тип → клик по холсту<br>Колесо над объектом — повернуть<br>ПКМ — удалить точку/объект<br>💾 Сохранить → откроется в 3D";
```

- [ ] **Step 2: editor.js — verify**

Run: `node --check src/ui/editor.js` → exit 0.

- [ ] **Step 3: race3d.js — render the objects**

In `src/ui/race3d.js`, after the painted-plane block (`scene.add(pmesh);` then its closing `}`), add an
object-rendering block (uses `edited.objects`, `wx`/`wz`, `geos`/`mats`):

```js
  // editor-placed decorations (render-only): map each object's normalized point to the world plane
  for (const ob of edited.objects) {
    const P = [ob.x, ob.y], X = wx(P), Z = wz(P); let mesh;
    if (ob.type === "stand") { const go = new THREE.BoxGeometry(9, 2.2, 3); geos.push(go); const ma = new THREE.MeshStandardMaterial({ color: 0x9aa0aa, roughness: 1 }); mats.push(ma); mesh = new THREE.Mesh(go, ma); mesh.position.set(X, 1.1, Z); mesh.rotation.y = ob.rot || 0; mesh.castShadow = true; }
    else if (ob.type === "banner") { const go = new THREE.PlaneGeometry(7, 2); geos.push(go); const ma = new THREE.MeshStandardMaterial({ color: 0x3d7aa0, roughness: 1, side: THREE.DoubleSide }); mats.push(ma); mesh = new THREE.Mesh(go, ma); mesh.position.set(X, 1, Z); mesh.rotation.y = ob.rot || 0; }
    else if (ob.type === "tree") { const go = new THREE.ConeGeometry(1.6, 4, 7); geos.push(go); const ma = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 1 }); mats.push(ma); mesh = new THREE.Mesh(go, ma); mesh.position.set(X, 2, Z); mesh.castShadow = true; }
    else { const go = new THREE.ConeGeometry(0.6, 1.4, 10); geos.push(go); const ma = new THREE.MeshStandardMaterial({ color: 0xe07a1a, roughness: 1 }); mats.push(ma); mesh = new THREE.Mesh(go, ma); mesh.position.set(X, 0.7, Z); }
    scene.add(mesh);
  }
```

- [ ] **Step 4: Verify**

Run: `node --check src/ui/race3d.js src/ui/editor.js` → exit 0.
Run: `node --test` → full suite green.
Owner F5: in the editor place a few objects, Сохранить, race that circuit → the objects appear in 3D at the placed spots.

- [ ] **Step 5: Commit**

```bash
git add src/ui/editor.js src/ui/race3d.js editor.html
git commit -m "feat(apexweb): editor objects (stand/banner/tree/cone) — place/drag/rotate/delete + render them in the 3D view" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Export / Import JSON + README

**Files:**
- Modify: `src/ui/editor.js`
- Modify: `README.md`

- [ ] **Step 1: editor.js — export/import handlers**

In `src/ui/editor.js`, after the `reset` button handler, add:

```js
document.getElementById("export").onclick = () => {
  const blob = new Blob([JSON.stringify({ name, points: toFlat(pts), objects }, null, 0)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name + ".json"; a.click(); URL.revokeObjectURL(a.href);
};
document.getElementById("import").onclick = () => document.getElementById("file").click();
document.getElementById("file").onchange = (e) => {
  const f = e.target.files[0]; if (!f) return; const r = new FileReader();
  r.onload = () => { try { const d = JSON.parse(r.result); pts = toPts(d.points); objects.length = 0; for (const o of (d.objects || [])) objects.push({ ...o }); render(); toast("Импортировано"); } catch { toast("Битый JSON"); } };
  r.readAsText(f);
};
```

- [ ] **Step 2: Verify**

Run: `node --check src/ui/editor.js` → exit 0.
Owner F5: Экспорт downloads `<name>.json`; Импорт loads it back.

- [ ] **Step 3: README — document the editor**

In `ApexWeb/README.md`, add a short section (match the existing style):
```markdown
## Редактор трассы

`localhost:8000/editor.html` — двигай опорные точки трассы (дорога перерисовывается живьём,
точно как в игре), ставь объекты (трибуны/баннеры/деревья/конусы), **Сохранить** → трасса
открывается в 3D-гонке. Экспорт/Импорт JSON для бэкапа. Хранится в localStorage (на браузер).
```
And add `editor.html` / `src/ui/editor.js` / `src/track_paint.js` / `src/track_store.js` to the
«Структура» file list, one line each in the existing style.

- [ ] **Step 4: Commit**

```bash
git add src/ui/editor.js README.md
git commit -m "feat(apexweb): editor export/import JSON + README" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] `node --test` → full suite green (incl. new track_store + track_paint tests).
- [ ] `node --check editor.html`-loaded modules: `node --check src/ui/editor.js src/ui/race3d.js src/track_paint.js src/track_store.js`.
- [ ] Owner F5 end-to-end: edit a circuit (points + objects) in `editor.html`, Сохранить, race it → the 3D view shows the edited shape + objects. Export/Import round-trips.

## Self-Review notes (checked against the spec)

- Shared painting (`track_paint`) used by editor + race3d: Task 2 + Task 3. ✓
- Persistence (`track_store`, effectiveTrack): Task 1 + Task 3. ✓
- Editor point drag/add/remove + live paint + save: Task 4. ✓
- Objects (4 types) place/drag/rotate/delete + 3D render: Task 5. ✓
- Export/Import + README: Task 6. ✓
- Tests: track_store round-trip/fallback/corrupt; track_paint smoke. ✓ (editor/3D = F5, per spec.)
- Type/name consistency: `effectiveTrack(name, presetPoints)→{points,objects}`, `saveTrack(name,{points,objects})`, `paintTrack(g, cl, C, pxPerWorld, halfW, opts)`, object `{type,x,y,rot}` — used identically across editor.js, race3d.js, track_store.js, track_paint.js. ✓
```
