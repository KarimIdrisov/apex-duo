# ApexWeb Editor → Track-Authoring Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the ApexWeb track editor so it also authors a track's *gameplay* data — pit lane, overtake zones, corner classification — plus editor zoom/pan; all written to the saved track record. The sim is NOT touched (it consuming this data is a separate later step, "Шаг 2").

**Architecture:** Pure math (nearest-point, corner classification) goes in `geom3d.js` (TDD). Persistence (`track_store.js`) round-trips new optional fields (TDD). The editor (`src/ui/editor.js` + `editor.html`) gains a view transform (zoom/pan), a small mode machine (Точки / Пит / Зоны), an 18-mini-sector overlay, and authoring of `pit`/`zones`/`cornerOverrides`. The zone format equals the sim's existing `TRACK.overtake_zones`.

**Tech Stack:** Vanilla ES modules, `node --test` (no deps), Canvas 2D, Three.js untouched. Run all commands from `ApexWeb/`. Commit with EXPLICIT pathspecs only (owner keeps parallel uncommitted WIP — never `git add -A`). Footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. The editor UI is DOM/canvas → not headless-testable; verify with `node --check` + (where feasible) the Claude_Preview MCP (synchronous render + canvas pixel sampling per the rAF-throttle note) + owner F5.

**Reference:** spec `docs/superpowers/specs/2026-06-14-apexweb-editor-track-authoring-design.md`. Mini-sectors = 18 equal lap-fraction spans (`track.js: sampleAt(f) → floor(((f%1)+1)%1 * 18)`).

---

## File Structure

- `src/geom3d.js` (modify) — add `nearestFrac`, `sectorCornerClasses` (pure, TDD).
- `tests/geom3d.test.js` (modify) — tests for the two helpers.
- `src/track_store.js` (modify) — round-trip `pit`/`pitLoss`/`zones`/`cornerOverrides`.
- `tests/track_store.test.js` (modify) — round-trip + default tests.
- `src/ui/editor.js` (modify) — view transform (zoom/pan), mode machine, sector overlay, zones/pit/corner authoring, persistence wiring.
- `editor.html` (modify) — "по размеру" button, mode bar (Точки/Пит/Зоны), zone controls, pit-loss input.
- `ApexWeb/README.md` (modify) — document the authoring features.

---

## Task 1: geom3d helpers — `nearestFrac` + `sectorCornerClasses`

**Files:**
- Modify: `src/geom3d.js`
- Test: `tests/geom3d.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/geom3d.test.js` (the import line already pulls many geom3d names — add `nearestFrac, sectorCornerClasses` to it):

Change the existing top import to also import the two new names:
```js
import { buildCenterline, pointAt, tangentAt, bounds, cameraFromBounds, ribbonEdges, sampleProg, racingLineOffset, offsetPoint, splinePath, radiusAt, cornerMask, cornerRuns, elevation, buildSpeedWarp, sampleWarp, nearestFrac, sectorCornerClasses } from "../src/geom3d.js";
```

Append these tests at the end of the file:
```js
// --- nearestFrac + sectorCornerClasses (editor authoring helpers) ---
const ring = (rx, ry, n) => { const a = []; for (let i = 0; i < n; i++) { const t = (i / n) * 2 * Math.PI; a.push(0.5 + rx * Math.cos(t), 0.5 + ry * Math.sin(t)); } return a; };

test("nearestFrac: a point ON the centerline returns ~its own fraction", () => {
  const cl = buildCenterline(splinePath(ring(0.35, 0.35, 24)));
  for (const f of [0.0, 0.25, 0.5, 0.8]) {
    const p = pointAt(cl, f);
    const got = nearestFrac(cl, p, 720);
    const d = Math.min(Math.abs(got - f), 1 - Math.abs(got - f));   // circular distance
    assert.ok(d < 0.01, `frac ${f} -> ${got} (circ dist ${d})`);
  }
});

test("nearestFrac: an off-line point maps to the nearest centerline fraction", () => {
  const cl = buildCenterline(splinePath(ring(0.35, 0.35, 24)));
  const near = pointAt(cl, 0.3);
  const p = [near[0] * 1.5 + 0.5 * (1 - 1.5), near[1] * 1.5 + 0.5 * (1 - 1.5)];   // push radially outward from center 0.5,0.5
  const got = nearestFrac(cl, p, 720);
  const d = Math.min(Math.abs(got - 0.3), 1 - Math.abs(got - 0.3));
  assert.ok(d < 0.03, `off-line near frac 0.3 -> ${got}`);
});

test("sectorCornerClasses: returns n classes from the allowed set", () => {
  const cl = buildCenterline(splinePath(ring(0.3, 0.3, 24)));
  const cls = sectorCornerClasses(cl, 18);
  assert.equal(cls.length, 18);
  for (const c of cls) assert.ok(["straight", "high", "med", "low"].includes(c), `valid class: ${c}`);
});

test("sectorCornerClasses: a big gentle circle is all 'straight', a tight circle all 'low'", () => {
  const big = sectorCornerClasses(buildCenterline(splinePath(ring(0.46, 0.46, 28))), 18);
  assert.ok(big.every(c => c === "straight"), `big circle all straight: ${big.join(",")}`);
  const tight = sectorCornerClasses(buildCenterline(splinePath(ring(0.05, 0.05, 28))), 18);
  assert.ok(tight.every(c => c === "low"), `tight circle all low: ${tight.join(",")}`);
});

test("sectorCornerClasses: an elongated oval has tight ends ('low') and gentle sides", () => {
  const cls = sectorCornerClasses(buildCenterline(splinePath(ring(0.42, 0.10, 20))), 18);
  assert.ok(cls.includes("low"), `tight ends -> some 'low': ${cls.join(",")}`);
  assert.ok(cls.some(c => c === "straight" || c === "high"), `gentle sides -> some straight/high: ${cls.join(",")}`);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/geom3d.test.js`
Expected: FAIL — `does not provide an export named 'nearestFrac'`.

- [ ] **Step 3: Implement the helpers in `src/geom3d.js`**

Append at the end of `src/geom3d.js` (after `sampleWarp`):
```js
// Lap-fraction of the centerline point nearest to a normalized point p (brute-force over `steps`
// samples). Used by the editor to map a canvas click to a mini-sector (zone painting).
export function nearestFrac(cl, p, steps = 360) {
  let best = 0, bd = Infinity;
  for (let k = 0; k < steps; k++) {
    const f = k / steps, q = pointAt(cl, f), d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}

// Corner speed-class per mini-sector from local curvature. For each of `n` equal lap-fraction
// sectors, take the tightest radius across the sector (radiusAt over a wide window) and classify:
// r >= straightR -> "straight"; >= highR -> "high"; >= lowR -> "med"; else "low". Thresholds are
// normalized radii (tunable). Mirrors the editor's speed-warp curvature read.
export function sectorCornerClasses(cl, n = 18, { straightR = 0.35, highR = 0.16, lowR = 0.07, w = 1 / 60, samples = 6 } = {}) {
  const out = [];
  for (let m = 0; m < n; m++) {
    let minR = Infinity;
    for (let s = 0; s < samples; s++) minR = Math.min(minR, radiusAt(cl, (m + (s + 0.5) / samples) / n, w));
    out.push(minR >= straightR ? "straight" : minR >= highR ? "high" : minR >= lowR ? "med" : "low");
  }
  return out;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/geom3d.test.js`
Expected: PASS (all geom3d tests, including the 5 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/geom3d.js tests/geom3d.test.js
git commit -m "feat(apexweb): geom3d nearestFrac + sectorCornerClasses (editor authoring helpers)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: track_store — round-trip pit / zones / corner data

**Files:**
- Modify: `src/track_store.js`
- Test: `tests/track_store.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/track_store.test.js`:
```js
test("track_store: round-trips pit / pitLoss / zones / cornerOverrides", () => {
  localStorage.clear();
  saveTrack("Барселона", {
    points: [0, 0, 1, 0, 1, 1, 0, 1],
    objects: [],
    pit: { x: 0.2, y: 0.3 },
    pitLoss: 24.5,
    zones: [{ sectors: [0, 1, 2], ease: 0.55, type: "brake" }],
    cornerOverrides: { 7: "low" },
  });
  const t = effectiveTrack("Барселона", [9, 9, 9, 9]);
  assert.deepEqual(t.pit, { x: 0.2, y: 0.3 });
  assert.equal(t.pitLoss, 24.5);
  assert.equal(t.zones[0].type, "brake");
  assert.deepEqual(t.zones[0].sectors, [0, 1, 2]);
  assert.equal(t.cornerOverrides["7"], "low");
});

test("track_store: old records (no gameplay fields) default cleanly", () => {
  localStorage.clear();
  saveTrack("Стара", { points: [0, 0, 1, 0, 1, 1, 0, 1] });   // no pit/zones/etc.
  const t = effectiveTrack("Стара", [9, 9, 9, 9]);
  assert.equal(t.pit, null);
  assert.equal(t.pitLoss, null);
  assert.deepEqual(t.zones, []);
  assert.equal(t.cornerOverrides, null);
});

test("effectiveTrack: preset fallback also carries default gameplay fields", () => {
  localStorage.clear();
  const t = effectiveTrack("НетТакой", [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(t.points, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(t.zones, []);
  assert.equal(t.pit, null);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/track_store.test.js`
Expected: FAIL — `t.pit` is `undefined` (current store drops these fields).

- [ ] **Step 3: Extend `src/track_store.js`**

Replace `saveTrack` and `effectiveTrack` with:
```js
export function saveTrack(name, data) {
  const s = ls(); if (!s) return;
  const all = loadAll();
  all[name] = {
    points: data.points,
    objects: data.objects || [],
    pit: data.pit || null,
    pitLoss: (typeof data.pitLoss === "number") ? data.pitLoss : null,
    zones: Array.isArray(data.zones) ? data.zones : [],
    cornerOverrides: data.cornerOverrides || null,
  };
  try { s.setItem(KEY, JSON.stringify(all)); } catch { /* quota/full -> ignore */ }
}
// edited {points,objects,pit,pitLoss,zones,cornerOverrides} if a usable edit is saved, else the
// preset points with all gameplay fields defaulted.
export function effectiveTrack(name, presetPoints) {
  const e = loadAll()[name];
  if (e && Array.isArray(e.points) && e.points.length >= 8) return {
    points: e.points,
    objects: Array.isArray(e.objects) ? e.objects : [],
    pit: e.pit || null,
    pitLoss: (typeof e.pitLoss === "number") ? e.pitLoss : null,
    zones: Array.isArray(e.zones) ? e.zones : [],
    cornerOverrides: e.cornerOverrides || null,
  };
  return { points: presetPoints, objects: [], pit: null, pitLoss: null, zones: [], cornerOverrides: null };
}
```
(`race3d` reads only `.points`/`.objects` from `effectiveTrack` — the extra fields are additive and harmless.)

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/track_store.test.js` → PASS.
Run: `node --test` → full suite stays green (race3d not test-imported; the extra fields are additive).

- [ ] **Step 5: Commit**

```bash
git add src/track_store.js tests/track_store.test.js
git commit -m "feat(apexweb): track_store round-trips pit/zones/corner authoring fields" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: editor zoom / pan (Шаг 0) + fix the refit wart

**Files:**
- Modify: `src/ui/editor.js`, `editor.html`

The editor view becomes a stable base-fit (computed on load / "по размеру" only — no more auto-refit while dragging) plus a `{zoom, panX, panY}` transform. Wheel zooms toward the cursor (unless over an object → keep object-rotate); middle-mouse drag pans. Not headless-testable → `node --check` + F5.

- [ ] **Step 1: editor.html — add the "по размеру" button**

Find the save/reset row:
```html
  <div class="row"><button id="save">💾 Сохранить</button> <button id="reset">↺ Сброс</button></div>
```
Add a row immediately AFTER the `<button id="drive">` row (which is just above save/reset):
```html
  <div class="row"><button id="fit">⊡ По размеру</button></div>
```

- [ ] **Step 2: editor.js — view state + base fit**

After the `const objects = [];` / `let driving...` state block near the top, add:
```js
let view = { zoom: 1, panX: 0, panY: 0 };               // editor zoom/pan on top of the base fit
let base = null;                                        // stable base fit {pad,sc,cx,cy,size}; recomputed only on load / "по размеру"
function computeBase() {
  const cl = buildCenterline(splinePath(toFlat(pts))), b = bounds(cl), pad = 0.12 * cv.width;
  base = { pad, sc: (cv.width - 2 * pad) / b.size, cx: b.cx, cy: b.cy, size: b.size };
}
```

- [ ] **Step 3: editor.js — rewrite `frame()` and `unproject()` to use base + view**

Replace the existing `frame()`:
```js
function frame() {
  const cl = buildCenterline(splinePath(toFlat(pts))), b = bounds(cl), pad = 0.12 * cv.width;
  const sc = (cv.width - 2 * pad) / b.size;
  const C = (q) => [pad + (q[0] - b.cx + b.size / 2) * sc, pad + (q[1] - b.cy + b.size / 2) * sc];
  return { cl, C, pxPerWorld: sc / (WORLD / b.size), hwN: HALF_W * b.size / WORLD };
}
```
with:
```js
function frame() {
  if (!base) computeBase();
  const cl = buildCenterline(splinePath(toFlat(pts)));   // cl still per-frame (pts move while dragging); fit stays stable
  const { pad, sc, cx, cy, size } = base, z = view.zoom;
  const baseC = (q) => [pad + (q[0] - cx + size / 2) * sc, pad + (q[1] - cy + size / 2) * sc];
  const C = (q) => { const c = baseC(q); return [c[0] * z + view.panX, c[1] * z + view.panY]; };
  return { cl, C, pxPerWorld: (sc / (WORLD / size)) * z, hwN: HALF_W * size / WORLD };
}
```
Replace the existing `unproject()`:
```js
function unproject(mx, my) {
  const cl = buildCenterline(splinePath(toFlat(pts))), b = bounds(cl), pad = 0.12 * cv.width, sc = (cv.width - 2 * pad) / b.size;
  return [(mx - pad) / sc - b.size / 2 + b.cx, (my - pad) / sc - b.size / 2 + b.cy];
}
```
with:
```js
function unproject(mx, my) {
  if (!base) computeBase();
  const { pad, sc, cx, cy, size } = base;
  const bx = (mx - view.panX) / view.zoom, by = (my - view.panY) / view.zoom;   // undo zoom/pan
  return [(bx - pad) / sc - size / 2 + cx, (by - pad) / sc - size / 2 + cy];      // undo base fit
}
```

- [ ] **Step 4: editor.js — recompute the base only on load (not on drag)**

In `loadTrack(n)`, the final line before `render()` — add a `computeBase()` so each loaded track fits, and reset the view. Find at the end of `loadTrack`:
```js
  if (pts.length < 4) pts = decimate(presetFlat(n), 48);
  render();
}
```
Replace with:
```js
  if (pts.length < 4) pts = decimate(presetFlat(n), 48);
  view = { zoom: 1, panX: 0, panY: 0 }; base = null;   // fresh fit per track (computed lazily in frame)
  render();
}
```
Also make the window-resize handler refit. Find:
```js
sizeCanvas(); window.addEventListener("resize", () => { sizeCanvas(); render(); });
```
Replace with:
```js
sizeCanvas(); window.addEventListener("resize", () => { sizeCanvas(); base = null; render(); });
```

- [ ] **Step 5: editor.js — wheel zoom-to-cursor (keep object-rotate)**

Replace the existing wheel handler:
```js
cv.addEventListener("wheel", (e) => { const [mx, my] = evtXY(e), oi = pickObj(mx, my); if (oi >= 0) { e.preventDefault(); objects[oi].rot = (objects[oi].rot || 0) + (e.deltaY > 0 ? 0.2 : -0.2); render(); } }, { passive: false });
```
with:
```js
cv.addEventListener("wheel", (e) => {
  e.preventDefault(); const [mx, my] = evtXY(e), oi = pickObj(mx, my);
  if (oi >= 0) { objects[oi].rot = (objects[oi].rot || 0) + (e.deltaY > 0 ? 0.2 : -0.2); render(); return; }   // over an object -> rotate it
  const k = Math.max(1, Math.min(8, view.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))) / view.zoom;   // zoom toward the cursor
  view.panX = mx - (mx - view.panX) * k; view.panY = my - (my - view.panY) * k; view.zoom *= k;
  render();
}, { passive: false });
```

- [ ] **Step 6: editor.js — middle-mouse drag to pan + the "по размеру" button**

Add (near the other event handlers, e.g. after the `wheel` handler):
```js
let panning = null;                                     // middle-drag pan
cv.addEventListener("mousedown", (e) => { if (e.button === 1) { e.preventDefault(); panning = { mx: e.clientX, my: e.clientY, px: view.panX, py: view.panY }; } });
window.addEventListener("mousemove", (e) => { if (panning) { view.panX = panning.px + (e.clientX - panning.mx); view.panY = panning.py + (e.clientY - panning.my); render(); } });
window.addEventListener("mouseup", (e) => { if (e.button === 1) panning = null; });
document.getElementById("fit").onclick = () => { view = { zoom: 1, panX: 0, panY: 0 }; base = null; render(); };
```

- [ ] **Step 7: Verify**

Run: `node --check src/ui/editor.js` → exit 0.
Run: `node --test` → green (these editor changes touch no test).
Owner F5 (`localhost:8000/editor.html`, Incognito): wheel zooms toward the cursor, middle-drag pans, "По размеру" resets, dragging a point no longer re-centres the view. (Preview-MCP can confirm it loads with no console errors.)

- [ ] **Step 8: Commit**

```bash
git add src/ui/editor.js editor.html
git commit -m "feat(apexweb): editor zoom/pan (wheel-to-cursor + middle-drag) + stable fit (fixes drag-refit wart)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: editor mode machine + 18-sector overlay (display) + persistence wiring

**Files:**
- Modify: `src/ui/editor.js`, `editor.html`

Introduce `mode` (Точки / Пит / Зоны), the gameplay state vars (`pit`, `pitLoss`, `zones`, `activeZone`, `cornerOverrides`), wire Save/loadTrack to persist/restore them, and draw the 18 mini-sector overlay coloured by auto corner-class when in Зоны mode. Zones/pit *authoring* come in Tasks 5/6; this task only displays the overlay + wires state.

- [ ] **Step 1: editor.html — mode bar + contextual control containers**

Find the preset `<select>` row:
```html
  <div class="row"><select id="preset"></select></div>
```
Add immediately AFTER it:
```html
  <div class="row" id="modes"><button id="m-edit" class="on">Точки</button> <button id="m-pit">Пит</button> <button id="m-zones">Зоны</button></div>
  <div class="row" id="pitctl" hidden>Потеря в питах, с: <input id="pitloss" type="number" step="0.1" style="width:64px"></div>
  <div class="row" id="zonectl" hidden><button id="z-brake">+ тормозная</button> <button id="z-slip">+ слипстрим</button><br>
    <span id="zonelist" style="font-size:12px"></span><br>ease: <input id="z-ease" type="range" min="0" max="1" step="0.05" value="0.5" style="width:120px"></div>
```

- [ ] **Step 2: editor.js — imports + state**

Add `sectorCornerClasses` and `nearestFrac` to the geom3d import line:
```js
import { buildCenterline, splinePath, bounds, tangentAt, offsetPoint, racingLineOffset, radiusAt, pointAt, sectorCornerClasses, nearestFrac } from "../geom3d.js";
```
(Note: `pointAt` is now imported too — used by the overlay drawing.)

After the `view`/`base` block, add the authoring state:
```js
const N_MINI = 18;                                      // mini-sectors = 18 equal lap-fraction spans (matches sim track.js)
let mode = "edit";                                      // "edit" | "pit" | "zones"
let pit = null, pitLoss = null;                         // pit-box marker {x,y} + pit-loss seconds
const zones = [];                                       // [{sectors:[..], ease, type}]  == TRACK.overtake_zones
let activeZone = -1;                                    // index of the zone being edited, or -1
let cornerOverrides = {};                               // { sectorIndex: "straight"|"high"|"med"|"low" }
const ZONE_COL = { brake: "#d83b3b", slip: "#3d7aa0" };
const CLASS_COL = { straight: "#3a5a38", high: "#46d08a", med: "#ffd24a", low: "#e8453c" };
```

- [ ] **Step 3: editor.js — mode switching + contextual panels**

In the `// --- toolbar ---` section, after the palette setup, add:
```js
function setMode(m) {
  mode = m;
  for (const b of document.querySelectorAll("#modes button")) b.classList.toggle("on", b.id === "m-" + m);
  document.getElementById("pitctl").hidden = m !== "pit";
  document.getElementById("zonectl").hidden = m !== "zones";
  render();
}
document.getElementById("m-edit").onclick = () => setMode("edit");
document.getElementById("m-pit").onclick = () => setMode("pit");
document.getElementById("m-zones").onclick = () => setMode("zones");
```

- [ ] **Step 4: editor.js — persist + restore the new fields**

Replace the Save handler:
```js
document.getElementById("save").onclick = () => { saveTrack(name, { points: toFlat(pts), objects }); toast("Сохранено: " + name); };
```
with:
```js
document.getElementById("save").onclick = () => { saveTrack(name, { points: toFlat(pts), objects, pit, pitLoss, zones, cornerOverrides }); toast("Сохранено: " + name); };
```
In `loadTrack(n)`, the saved-branch currently restores points+objects. Find:
```js
  if (saved && Array.isArray(saved.points) && saved.points.length >= 8) {
    pts = toPts(saved.points);
    objects.length = 0; for (const o of (saved.objects || [])) objects.push({ ...o });
  } else {                                               // fresh preset: decimate the dense path to draggable points
    pts = n === EMPTY ? toPts(OVAL) : decimate(presetFlat(n), 48);
    objects.length = 0;
  }
```
Replace with:
```js
  if (saved && Array.isArray(saved.points) && saved.points.length >= 8) {
    pts = toPts(saved.points);
    objects.length = 0; for (const o of (saved.objects || [])) objects.push({ ...o });
    pit = saved.pit || null; pitLoss = (typeof saved.pitLoss === "number") ? saved.pitLoss : null;
    zones.length = 0; for (const z of (saved.zones || [])) zones.push({ sectors: [...z.sectors], ease: z.ease, type: z.type });
    cornerOverrides = saved.cornerOverrides ? { ...saved.cornerOverrides } : {};
  } else {                                               // fresh preset: decimate the dense path to draggable points
    pts = n === EMPTY ? toPts(OVAL) : decimate(presetFlat(n), 48);
    objects.length = 0; pit = null; pitLoss = null; zones.length = 0; cornerOverrides = {};
  }
  activeZone = -1;
```
Also wire the pit-loss input to keep `pitLoss` in sync (add near the other control wiring):
```js
document.getElementById("pitloss").oninput = (e) => { const v = parseFloat(e.target.value); pitLoss = isNaN(v) ? null : v; };
```

- [ ] **Step 5: editor.js — the sector overlay drawing + class helper**

Add these helpers (top-level, near `drawObj`):
```js
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
```

- [ ] **Step 6: editor.js — call the overlay from render()**

In `render()`, capture `pxPerWorld` and draw the overlay when in zones mode + draw the pit marker. Find the end of `render()`:
```js
  for (const o of objects) drawObj(g, C([o.x, o.y]), o);   // placed objects on top
  if (driving) for (const car of cars) {                 // kinematic cars riding the racing line (car.lat = eased offset, set in tick)
    const p = offsetPoint(cl, car.frac, car.lat), t = tangentAt(cl, car.frac);
    drawCar(C(p), Math.atan2(t[1], t[0]), car.col);
  }
}
```
Replace with:
```js
  for (const o of objects) drawObj(g, C([o.x, o.y]), o);   // placed objects on top
  if (mode === "zones") drawSectors(g, cl, C, pxPerWorld);
  if (pit) { const c = C([pit.x, pit.y]); g.fillStyle = "#ffd24a"; g.font = "bold 16px system-ui"; g.textAlign = "center"; g.fillText("⛽", c[0], c[1] + 5); }
  if (driving) for (const car of cars) {                 // kinematic cars riding the racing line (car.lat = eased offset, set in tick)
    const p = offsetPoint(cl, car.frac, car.lat), t = tangentAt(cl, car.frac);
    drawCar(C(p), Math.atan2(t[1], t[0]), car.col);
  }
}
```
(`render()` already destructures `pxPerWorld` from `frame()` for `paintTrack`, so it's in scope to pass to `drawSectors`.)

- [ ] **Step 7: Verify**

Run: `node --check src/ui/editor.js` → exit 0.
Run: `node --test` → green.
Owner F5: click **Зоны** → the road shows 18 numbered sectors tinted by corner class (red=tight, amber=medium, green=fast, dark=straight). **Пит**/**Зоны** show their control panels; **Точки** hides them. (Preview-MCP: load editor, click `#m-zones`, sample the canvas for the class colours to confirm the overlay draws.)

- [ ] **Step 8: Commit**

```bash
git add src/ui/editor.js editor.html
git commit -m "feat(apexweb): editor mode bar (Точки/Пит/Зоны) + 18-sector overlay coloured by corner class + persist gameplay fields" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: editor overtake-zone painting (Зоны mode)

**Files:**
- Modify: `src/ui/editor.js`

In Зоны mode, "+ тормозная"/"+ слипстрим" create a zone (made active); clicking a sector toggles it into the active zone; the ease slider sets the active zone's ease; a zone list lets you select/delete. Stored in `zones` (persisted via Task 4's Save).

- [ ] **Step 1: editor.js — route left-clicks in zones mode + zone controls**

In the `mousedown` handler, add a `mode === "zones"` branch at the TOP (before the armed/object/point logic). Find:
```js
cv.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return; const [mx, my] = evtXY(e);
  if (armed) { const p = unproject(mx, my); objects.push({ type: armed, x: p[0], y: p[1], rot: 0 }); render(); return; }   // place an armed object
```
Replace those first three lines with:
```js
cv.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return; const [mx, my] = evtXY(e);
  if (mode === "pit") { pit = unproject(mx, my); render(); return; }                      // place the pit marker (Task 6 adds the loss UI)
  if (mode === "zones") {                                                                  // toggle a sector in the active zone
    if (activeZone < 0) { toast("Сначала создай зону"); return; }
    const sec = sectorAt(mx, my), z = zones[activeZone], i = z.sectors.indexOf(sec);
    if (i >= 0) z.sectors.splice(i, 1); else z.sectors.push(sec);
    z.sectors.sort((a, b) => a - b); render(); return;
  }
  if (armed) { const p = unproject(mx, my); objects.push({ type: armed, x: p[0], y: p[1], rot: 0 }); render(); return; }   // place an armed object
```

Add the zone control wiring (near `setMode`, after the mode buttons):
```js
function refreshZoneList() {
  const el = document.getElementById("zonelist");
  el.innerHTML = zones.map((z, i) => `<a href="#" data-z="${i}" style="color:${i === activeZone ? "#ffd24a" : "#7ad0ff"}">${z.type === "brake" ? "тормозн." : "слип"} [${z.sectors.join(",")}]</a> <a href="#" data-del="${i}" style="color:#e8453c">✕</a>`).join("<br>") || "(нет зон)";
  for (const a of el.querySelectorAll("a[data-z]")) a.onclick = (e) => { e.preventDefault(); activeZone = +a.dataset.z; document.getElementById("z-ease").value = zones[activeZone].ease; refreshZoneList(); render(); };
  for (const a of el.querySelectorAll("a[data-del]")) a.onclick = (e) => { e.preventDefault(); zones.splice(+a.dataset.del, 1); activeZone = -1; refreshZoneList(); render(); };
}
function addZone(type) { zones.push({ sectors: [], ease: parseFloat(document.getElementById("z-ease").value) || 0.5, type }); activeZone = zones.length - 1; refreshZoneList(); render(); }
document.getElementById("z-brake").onclick = () => addZone("brake");
document.getElementById("z-slip").onclick = () => addZone("slip");
document.getElementById("z-ease").oninput = (e) => { if (activeZone >= 0) { zones[activeZone].ease = parseFloat(e.target.value); } };
```
Call `refreshZoneList()` at the end of `setMode` (so the list shows when entering zones mode) and at the end of `loadTrack` (so a loaded track's zones list renders). In `setMode`, change `render();` to:
```js
  refreshZoneList(); render();
```
In `loadTrack`, after `activeZone = -1;` (Task 4) before `view = ...`, add:
```js
  if (document.getElementById("zonelist")) refreshZoneList();
```

- [ ] **Step 2: Verify**

Run: `node --check src/ui/editor.js` → exit 0. Run: `node --test` → green.
Owner F5: Зоны → "+ тормозная" → click sectors near a braking point → they highlight red and join the zone; the ease slider adjusts it; the zone list shows/selects/deletes zones; Сохранить → reload → zones persist. (Preview-MCP: click `#m-zones`, `#z-brake`, then a canvas point on the road; assert `zones` length via reading the DOM zone list text.)

- [ ] **Step 3: Commit**

```bash
git add src/ui/editor.js
git commit -m "feat(apexweb): editor overtake-zone painting (sectors + ease + type, == sim overtake_zones)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: editor pit-lane placement + pit-loss (Пит mode)

**Files:**
- Modify: `src/ui/editor.js`

Пит-mode click already places `pit` (wired in Task 5's mousedown branch). This task adds the pit-loss field sync on mode entry + a hint, and confirms the marker draws. (Most of pit is already in place; this finishes it.)

- [ ] **Step 1: editor.js — sync the pit-loss input when entering Пит mode**

In `setMode`, when switching to "pit", reflect the current `pitLoss` into the input. Replace the `setMode` body's control-toggle lines:
```js
  document.getElementById("pitctl").hidden = m !== "pit";
  document.getElementById("zonectl").hidden = m !== "zones";
```
with:
```js
  document.getElementById("pitctl").hidden = m !== "pit";
  document.getElementById("zonectl").hidden = m !== "zones";
  if (m === "pit") document.getElementById("pitloss").value = (pitLoss == null ? "" : pitLoss);
```

- [ ] **Step 2: editor.js — update the hint to mention modes + zoom**

Replace the hint line:
```js
document.getElementById("hint").innerHTML = "ЛКМ-тащи — точку/объект<br>2× клик по дороге — добавить точку<br>Объект: выбери тип → клик по холсту<br>Колесо над объектом — повернуть<br>ПКМ — удалить точку/объект<br>▶ Прокатить — пустить машинки по трассе<br>💾 Сохранить → откроется в 3D";
```
with:
```js
document.getElementById("hint").innerHTML = "Колесо — зум к курсору · средняя-кнопка — пан · ⊡ по размеру<br><b>Точки:</b> ЛКМ-тащи точку/объект · 2× клик — добавить · ПКМ — удалить · объект: тип→клик · колесо над объектом — повернуть<br><b>Пит:</b> клик по холсту — поставить боксы + поле потери<br><b>Зоны:</b> создай зону → кликай сектора · ПКМ по сектору — класс поворота<br>▶ Прокатить — пустить машинки · 💾 Сохранить → 3D";
```

- [ ] **Step 3: Verify**

Run: `node --check src/ui/editor.js` → exit 0. Run: `node --test` → green.
Owner F5: Пит → click the canvas → a ⛽ marker appears; the "Потеря в питах" field edits `pitLoss`; Сохранить → reload → pit + loss persist.

- [ ] **Step 4: Commit**

```bash
git add src/ui/editor.js
git commit -m "feat(apexweb): editor pit-lane placement + pit-loss field + updated mode hints" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: editor corner override (right-click cycles class in Зоны mode)

**Files:**
- Modify: `src/ui/editor.js`

In Зоны mode, right-click a sector cycles its corner class (`straight→high→med→low→straight`), stored in `cornerOverrides` (removed when it matches auto / cycles back to a marker). The overlay (Task 4) already colours by `sectorClass()` which prefers overrides. *Smallest piece — droppable.*

- [ ] **Step 1: editor.js — route right-click in zones mode to cycle the class**

The `contextmenu` handler currently deletes an object/point. Add a zones-mode branch at the top. Find:
```js
cv.addEventListener("contextmenu", (e) => {              // right-click: delete the object under the cursor, else the nearest point (min 4)
  e.preventDefault(); const [mx, my] = evtXY(e); const oi = pickObj(mx, my);
```
Replace those two lines with:
```js
cv.addEventListener("contextmenu", (e) => {
  e.preventDefault(); const [mx, my] = evtXY(e);
  if (mode === "zones") {                                // cycle the corner class of the sector under the cursor
    const seq = ["straight", "high", "med", "low"], sec = sectorAt(mx, my);
    const cur = cornerOverrides[sec] || sectorCornerClasses(buildCenterline(splinePath(toFlat(pts))), N_MINI)[sec];
    cornerOverrides[sec] = seq[(seq.indexOf(cur) + 1) % seq.length]; render(); return;
  }
  const oi = pickObj(mx, my);
```

- [ ] **Step 2: Verify**

Run: `node --check src/ui/editor.js` → exit 0. Run: `node --test` → green.
Owner F5: Зоны → right-click a sector → its colour cycles (green→amber→red→dark→green); Сохранить → reload → overrides persist (the sector keeps its set class).

- [ ] **Step 3: Commit**

```bash
git add src/ui/editor.js
git commit -m "feat(apexweb): editor corner-class override (right-click a sector in Зоны mode)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: README + final verification

**Files:**
- Modify: `ApexWeb/README.md`

- [ ] **Step 1: README — expand the editor section**

In `ApexWeb/README.md`, find the editor section (`## Редактор трассы`) and replace its body paragraph with:
```markdown
`localhost:8000/editor.html` — конструктор трасс. Двигай опорные точки (дорога перерисовывается
живьём, как в игре), ставь объекты. **Колесо** — зум к курсору, **средняя кнопка** — пан, **⊡ по
размеру** — сброс вида. Режимы: **Точки** (форма + объекты), **Пит** (поставить боксы + потеря в
питах), **Зоны** (на сетке 18 мини-секторов: красишь зоны обгона тормозн./слип + ease; ПКМ по
сектору — класс поворота). **Сохранить** → трасса открывается в 3D-гонке; Экспорт/Импорт JSON.
Хранится в localStorage. *Пока редактор только авторит эти данные — сим начнёт их использовать
в расчётах отдельным шагом (Шаг 2).*
```

- [ ] **Step 2: Final verification**

Run: `node --check src/ui/editor.js src/geom3d.js src/track_store.js` → all exit 0.
Run: `node --test` → full suite green (geom3d + track_store new tests included).
Owner F5 end-to-end: zoom/pan; in each mode author pit / zones / corner classes; Save; reload → everything persists; race still plays unchanged (sim untouched).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(apexweb): editor track-authoring (zoom, modes, pit, zones, corners) in README" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (checked against the spec)

- Data model fields (`pit`/`pitLoss`/`zones`/`cornerOverrides`): Task 2 (store) + Task 4 (editor state/persist). ✓
- geom3d helpers (`nearestFrac`, `sectorCornerClasses`): Task 1, TDD. ✓
- Шаг 0 zoom/pan + refit-wart fix: Task 3. ✓
- Pit lane: Task 6 (+ placement wired in Task 5's mousedown). ✓
- Overtake zones (mini-sector painting, == `overtake_zones`): Task 5. ✓
- Corners (auto-class overlay + override): Task 4 (display) + Task 7 (override). ✓
- Boundary — sim/track.js/netcode untouched: no task modifies them. ✓
- Testing: track_store round-trip (Task 2), geom3d helpers (Task 1); editor = node --check + F5. ✓
- Type/name consistency: `sectorAt(mx,my)`, `sectorClass(cl,classesAuto,m)`, `drawSectors(g,cl,C,pxPerWorld)`, `zones:[{sectors,ease,type}]`, `cornerOverrides:{[m]:class}`, `effectiveTrack→{points,objects,pit,pitLoss,zones,cornerOverrides}` — used consistently across tasks. ✓
- Out of scope (sim uses the data) — not implemented here; explicitly Шаг 2. ✓
```
