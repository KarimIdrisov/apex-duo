# ApexWeb Editor 3D + SVG-Reference Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two reference views to the track editor — a live 3D preview (the *same* `race3d` engine, with cars driving the line, refreshed on a button) and a fixed 2D «svg-эталон» of the original preset outline.

**Architecture:** Reuse `race3d` wholesale: on «Обновить», the editor builds a synthetic editor-preview `ctx` (live points + objects + a few synthetic cars) and calls `race3d.init`; a small ticker advances the cars and race3d's own loop renders them. `race3d` gets two additive, flag-guarded hooks (explicit geometry; direct car progress) so the race path is byte-unchanged. Pure preview math lives in a THREE-free module (`editor_preview.js`) so it's unit-testable; the controller (`editor3d.js`) is imported **dynamically** so a missing CDN/THREE never breaks 2D editing.

**Tech Stack:** Vanilla ES modules, Three.js r160 (CDN, via race3d), Canvas 2D, `node --test`.

**Spec:** `docs/superpowers/specs/2026-06-15-apexweb-editor-3d-preview-design.md`

## Conventions (apply to every task)

- **Run all commands from the `ApexWeb/` directory.**
- **Commits use explicit pathspecs — never `git add -A`.** The repo holds unrelated uncommitted owner WIP.
- **End every commit message** with a blank line then `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Fast per-file test: `node --test tests/<file>.test.js`. Full suite (`node --test`) is slow (~10 min) — final task only.
- User-facing strings **Russian**; code/comments English.

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `src/editor_preview.js` | Create | **Pure, THREE-free** preview math: `advanceFrac`, `buildPreviewCars`, `fitOutline`. Unit-tested. |
| `src/editor3d.js` | Create | Preview controller: synthetic ctx → `race3d.init` → car ticker → teardown. Imports race3d. |
| `src/ui/race3d.js` | Modify | Two additive, flag-guarded hooks (explicit geometry; direct car progress). |
| `src/ui/editor.js` | Modify | «Обновить» → (re)build 3D (dynamic import); draw svg-эталон on track change. |
| `editor.html` | Modify | Add `#preview3d` canvas, `#refresh3d` button, `#svgref` canvas to the panel top. |
| `tests/editor_preview.test.js` | Create | Unit tests for the pure helpers. |
| `README.md` | Modify | Note the editor preview panels. |

**Untouched:** `sim.js`, `data.js`, `track.js`, `track_store.js`, `main.js`, netcode.

---

### Task 1: `editor_preview.js` — pure preview math

**Files:**
- Create: `ApexWeb/src/editor_preview.js`
- Test: `ApexWeb/tests/editor_preview.test.js`

- [ ] **Step 1: Write the failing test**

Create `ApexWeb/tests/editor_preview.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceFrac, buildPreviewCars, fitOutline } from "../src/editor_preview.js";

test("advanceFrac: partial advance does not wrap", () => {
  const r = advanceFrac(0, 0.2, 0.5, 7);
  assert.equal(r.lap, 0);
  assert.ok(Math.abs(r.lapFrac - (0.2 + 0.5 / 7)) < 1e-9);
});

test("advanceFrac: wraps past 1.0 and bumps lap", () => {
  const r = advanceFrac(2, 0.95, 1.0, 7);   // 0.95 + 1/7 = 1.0928 -> 0.0928, lap 3
  assert.equal(r.lap, 3);
  assert.ok(r.lapFrac >= 0 && r.lapFrac < 1);
  assert.ok(Math.abs(r.lapFrac - (0.95 + 1 / 7 - 1)) < 1e-9);
});

test("advanceFrac: a large dt wraps multiple laps", () => {
  const r = advanceFrac(0, 0.0, 14, 7);   // 14/7 = 2 laps exactly
  assert.equal(r.lap, 2);
  assert.ok(Math.abs(r.lapFrac) < 1e-9);
});

test("buildPreviewCars: spreads lapFrac=i/n, cycles colours, sets flags", () => {
  const cars = buildPreviewCars(4, ["#a", "#b"]);
  assert.equal(cars.length, 4);
  assert.deepEqual(cars.map((c) => c.lapFrac), [0, 0.25, 0.5, 0.75]);
  assert.deepEqual(cars.map((c) => c.color), ["#a", "#b", "#a", "#b"]);
  assert.deepEqual(cars.map((c) => c.idx), [0, 1, 2, 3]);
  assert.ok(cars.every((c) => c.lap === 0 && !c.retired && !c.inPit && !c.player));
});

test("fitOutline: points land inside the padded box, aspect preserved, centered", () => {
  const sq = [0, 0, 1, 0, 1, 1, 0, 1];               // unit square
  const pts = fitOutline(sq, 200, 100, 10);
  assert.equal(pts.length, 4);
  for (const [x, y] of pts) {
    assert.ok(x >= 10 - 1e-9 && x <= 190 + 1e-9, `x in range: ${x}`);
    assert.ok(y >= 10 - 1e-9 && y <= 90 + 1e-9, `y in range: ${y}`);
  }
  // scale = min((200-20)/1,(100-20)/1)=80; centered horizontally -> x from 60 to 140
  assert.ok(Math.abs(pts[0][0] - 60) < 1e-9 && Math.abs(pts[1][0] - 140) < 1e-9);
});

test("fitOutline: missing / too-short outline -> []", () => {
  assert.deepEqual(fitOutline([0, 0, 1, 1], 100, 100, 5), []);   // 2 points < 3
  assert.deepEqual(fitOutline(null, 100, 100, 5), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/editor_preview.test.js`
Expected: FAIL — cannot find module `../src/editor_preview.js`.

- [ ] **Step 3: Write the implementation**

Create `ApexWeb/src/editor_preview.js`:

```js
// ApexWeb/src/editor_preview.js — pure (THREE-free) math for the editor's 3D preview + svg reference.
// Kept free of any THREE/race3d import so it can be unit-tested under `node --test`.

// advance one car's progress by dt seconds at 1/lapSeconds laps/s; wrap lapFrac past 1 -> lap++.
export function advanceFrac(lap, lapFrac, dt, lapSeconds) {
  let f = lapFrac + dt / lapSeconds, l = lap;
  while (f >= 1) { f -= 1; l += 1; }
  return { lap: l, lapFrac: f };
}

// n synthetic preview cars spread evenly round the lap, coloured by colors[i % colors.length].
export function buildPreviewCars(n, colors) {
  const cars = [];
  for (let i = 0; i < n; i++) {
    cars.push({ idx: i, color: colors[i % colors.length], lap: 0, lapFrac: i / n, retired: false, inPit: false, player: false });
  }
  return cars;
}

// map a flat [x0,y0,...] normalized outline to canvas px: fit into w×h with `pad` margin, uniform
// scale, centered. Returns [] for a missing / too-short (< 3 points) outline.
export function fitOutline(flat, w, h, pad) {
  if (!Array.isArray(flat) || flat.length < 6) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < flat.length; i += 2) {
    if (flat[i] < minX) minX = flat[i];
    if (flat[i] > maxX) maxX = flat[i];
    if (flat[i + 1] < minY) minY = flat[i + 1];
    if (flat[i + 1] > maxY) maxY = flat[i + 1];
  }
  const spanX = (maxX - minX) || 1, spanY = (maxY - minY) || 1;
  const s = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY);
  const ox = (w - spanX * s) / 2, oy = (h - spanY * s) / 2;
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push([ox + (flat[i] - minX) * s, oy + (flat[i + 1] - minY) * s]);
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/editor_preview.test.js`
Expected: PASS — 6 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/editor_preview.js tests/editor_preview.test.js
git commit -m "feat(apexweb): editor_preview — pure advanceFrac/buildPreviewCars/fitOutline for the editor preview" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `race3d.js` — two additive editor-preview hooks

**Files:**
- Modify: `ApexWeb/src/ui/race3d.js`

No unit test (WebGL). Gate: `node --check` + the hooks are guarded by flags the race path never sets (so race behavior is identical).

- [ ] **Step 1: Hook A — explicit geometry**

In `ApexWeb/src/ui/race3d.js`, find (the geometry resolve, around line 42):

```js
  const edited = effectiveTrack(trackName, (trackName && TRACK_SHAPES[trackName]) || TRACK_PATH);   // owner's editor edits, else the preset
```

Replace it with:

```js
  const edited = (ctx.snapshot && ctx.snapshot.points)                                              // editor preview passes live geometry
    ? { points: ctx.snapshot.points, objects: ctx.snapshot.objects || [] }
    : effectiveTrack(trackName, (trackName && TRACK_SHAPES[trackName]) || TRACK_PATH);               // else owner's editor edits / preset
```

- [ ] **Step 2: Hook B — direct car progress in editor mode**

Find (inside `frame()`, around line 271):

```js
      const prog = sampleProg(buf[c.idx], rt);
```

Replace it with:

```js
      const prog = ctx.editorPreview ? (c.lap + c.lapFrac) : sampleProg(buf[c.idx], rt);   // editor preview drives cars directly (no network buffer)
```

- [ ] **Step 3: Verify syntax**

Run: `node --check src/ui/race3d.js`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/ui/race3d.js
git commit -m "feat(apexweb): race3d editor-preview hooks (explicit geometry + direct car progress, flag-guarded)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `editor3d.js` — 3D preview controller

**Files:**
- Create: `ApexWeb/src/editor3d.js`

No unit test (imports race3d → THREE from a CDN, not resolvable under `node --test`). Gate: `node --check` (syntax only — it does not execute imports).

- [ ] **Step 1: Write the implementation**

Create `ApexWeb/src/editor3d.js`:

```js
// ApexWeb/src/editor3d.js — editor 3D preview controller. Reuses the GAME renderer (race3d) on a
// synthetic editor-preview ctx, so the preview shows the same track/scenery/car models as the game.
// A small ticker advances a few cars round the lap; race3d's own loop renders them. Render-only.
// Imported dynamically by editor.js so a missing CDN/THREE never breaks 2D editing.
import { init as race3dInit } from "./ui/race3d.js";
import { advanceFrac, buildPreviewCars } from "./editor_preview.js";

const CAR_COLS = ["#e8453c", "#3d7aa0", "#ffd24a", "#46d08a", "#b06fd0", "#e07a1a"];

// start a 3D preview of an edited track on `canvas`. edit = { points: flat 0..1, objects:[...] }.
// returns { dispose } — call it before rebuilding or when tearing the preview down.
export function startPreview(canvas, edit, opts = {}) {
  const n = opts.cars || 5, lapSeconds = opts.lapSeconds || 7;
  const cars = buildPreviewCars(n, CAR_COLS);
  const ctx = {
    editorPreview: true,
    snapshot: { trackName: null, points: edit.points, objects: edit.objects || [], cars },
    _buf: {}, _cam3d: { mode: "orbit" },
  };
  const r3d = race3dInit(canvas, ctx);
  let raf = 0, last = 0, alive = true;
  function tick(t) {
    if (!alive) return;
    const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
    for (const c of cars) { const a = advanceFrac(c.lap, c.lapFrac, dt, lapSeconds); c.lap = a.lap; c.lapFrac = a.lapFrac; }
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);
  return { dispose() { if (!alive) return; alive = false; cancelAnimationFrame(raf); r3d.dispose(); } };
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --check src/editor3d.js`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/editor3d.js
git commit -m "feat(apexweb): editor3d — 3D preview controller (reuses race3d + a car ticker)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `editor.html` — preview canvases + button

**Files:**
- Modify: `ApexWeb/editor.html`

- [ ] **Step 1: Add the preview block**

In `ApexWeb/editor.html`, find:

```html
  <div class="row"><select id="preset"></select></div>
```

Replace it with (the same line, then the preview rows):

```html
  <div class="row"><select id="preset"></select></div>
  <div class="row"><canvas id="preview3d" style="width:100%;height:210px;background:#0b0d12;border-radius:6px;display:block"></canvas></div>
  <div class="row"><button id="refresh3d" style="width:100%">🔄 Обновить 3D</button></div>
  <div class="row"><b style="font-size:12px">Эталон (оригинал трассы):</b><br>
    <canvas id="svgref" style="width:100%;height:130px;background:#0b0d12;border-radius:6px;display:block"></canvas></div>
```

- [ ] **Step 2: Commit**

```bash
git add editor.html
git commit -m "feat(apexweb): editor preview canvases (3D + svg-эталон) + Обновить button" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `editor.js` — wire the preview + svg-эталон

**Files:**
- Modify: `ApexWeb/src/ui/editor.js`

UI change — no unit test. Gate: `node --check src/ui/editor.js` + owner F5.

- [ ] **Step 1: Add the static (THREE-free) import**

In `ApexWeb/src/ui/editor.js`, find:

```js
import { saveTrack, clearTrack, loadAll } from "../track_store.js";
```

Add after it (note: `editor3d` is imported *dynamically* later, not here — keep the editor offline-safe):

```js
import { saveTrack, clearTrack, loadAll } from "../track_store.js";
import { fitOutline } from "../editor_preview.js";   // pure, THREE-free — safe to import statically
```

- [ ] **Step 2: Add the preview controller state + functions**

In `ApexWeb/src/ui/editor.js`, find the toast helper near the bottom:

```js
function toast(t) { const el = document.getElementById("toast"); el.textContent = t; el.style.opacity = 1; setTimeout(() => el.style.opacity = 0, 1400); }
```

Add immediately after it:

```js
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
```

- [ ] **Step 3: Draw the svg-эталон on track change**

In `ApexWeb/src/ui/editor.js`, find the end of `loadTrack` (the `render()` call that closes the function):

```js
  view = { zoom: 1, panX: 0, panY: 0 }; base = null;   // fresh fit per track (computed lazily in frame)
  render();
}
```

Replace it with (add the svg-эталон redraw):

```js
  view = { zoom: 1, panX: 0, panY: 0 }; base = null;   // fresh fit per track (computed lazily in frame)
  render();
  drawSvgRef(name);   // refresh the original-outline reference for the picked circuit
}
```

- [ ] **Step 4: Build the initial 3D preview on load**

In `ApexWeb/src/ui/editor.js`, find the final line:

```js
loadTrack(name);
```

Replace it with:

```js
loadTrack(name);
refresh3d();        // initial 3D preview (dynamic import; degrades gracefully offline)
```

- [ ] **Step 5: Verify syntax**

Run: `node --check src/ui/editor.js`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/ui/editor.js
git commit -m "feat(apexweb): editor wires 3D preview (Обновить, dynamic import) + svg-эталон" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: README + final verification

**Files:**
- Modify: `ApexWeb/README.md`

- [ ] **Step 1: Update the editor section**

In `ApexWeb/README.md`, in the **## Редактор трассы** section, find:

```markdown
**🏁 Гонять (сим)** — гонка прямо на твоей трассе: её повороты/прямые определяют, где случаются
```

Insert this paragraph immediately **before** that line:

```markdown
**Превью рядом:** сверху панели — **3D-вид** (тот же движок, что в игре: трасса, сценерий, объекты и
пара машинок едут по линии; **🔄 Обновить 3D** перестраивает его под правки, мышь — орбита/зум) и
**svg-эталон** (оригинальный контур выбранной трассы для сравнения). 3D грузит THREE с CDN —
без сети превью отвалится с тостом, а 2D-редактор продолжит работать.

```

- [ ] **Step 2: Add the new files to the structure list**

In `ApexWeb/README.md`, in the **## Структура** code block, add next to the other `src/` entries:

```markdown
src/editor_preview.js  чистая математика превью редактора (advanceFrac/buildPreviewCars/fitOutline)
src/editor3d.js    3D-превью редактора: поднимает race3d на синтетическом ctx + тикер машинок
```

- [ ] **Step 3: Run the new test + syntax checks**

Run:
```bash
node --test tests/editor_preview.test.js
node --check src/ui/race3d.js
node --check src/editor3d.js
node --check src/ui/editor.js
```
Expected: 6 tests PASS; all three `node --check` exit 0.

- [ ] **Step 4: Run the full suite (regression gate)**

Run: `node --test`
Expected: the whole suite is green (existing + the 6 new). `race3d` has no unit test and its hooks are flag-guarded, so no behavior change for any existing test. (~10 min.)

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs(apexweb): editor 3D + svg-эталон preview in README + structure" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Owner F5 (manual — WebGL not headless-testable)

1. `cd ApexWeb && node tools/editor_server.mjs` (or `python -m http.server 8000`), open `localhost:8000/editor.html`.
2. The **3D preview** shows the track + scenery + placed objects + a few cars **driving** the line; mouse orbits/zooms.
3. Edit points/place an object → **🔄 Обновить 3D** → the preview reflects the change.
4. The **svg-эталон** shows the original outline of the picked circuit; switching circuits updates it; «Пустая» shows «(нет эталона)».
5. Open a normal **race** (2D + 3D) → it looks **identical** to before (the guarded race3d change didn't alter it).

## Self-Review

**1. Spec coverage:**
- 3D preview reuses race3d, driving cars, «Обновить» → Tasks 2, 3, 4, 5. ✓
- svg-эталон = original preset outline → Tasks 1 (`fitOutline`), 5 (`drawSvgRef`). ✓
- Compact panel layout → Task 4. ✓
- 2 additive flag-guarded race3d hooks → Task 2. ✓
- Pure THREE-free helpers, unit-tested → Task 1. ✓
- Offline resilience (dynamic import) → Task 5 Step 2/4. ✓
- Error handling: `<3` points toast, no preset → «(нет эталона)», dispose-before-rebuild → Task 5. ✓
- Determinism untouched (no sim/data/store edits) → enforced by file list; full suite gate Task 6. ✓
- README → Task 6. ✓

**2. Placeholder scan:** No TBD/TODO; every code step has full content. ✓

**3. Type consistency:** `advanceFrac(lap,lapFrac,dt,lapSeconds)→{lap,lapFrac}`, `buildPreviewCars(n,colors)→[{idx,color,lap,lapFrac,retired,inPit,player}]`, `fitOutline(flat,w,h,pad)→[[x,y]]`, `startPreview(canvas,{points,objects},opts)→{dispose}`, race3d reads `ctx.snapshot.points/objects` + `ctx.editorPreview` + car `.lap/.lapFrac/.idx/.color/.retired/.inPit/.player` — all consistent across tasks and with race3d's existing reads. ✓
