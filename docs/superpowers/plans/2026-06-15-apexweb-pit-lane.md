# ApexWeb Drawable Pit Lane + Cars Drive It Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Author a pit lane in the editor (entry/exit/side/width); in the race, cars drive in→box→out along it in both the 2D minimap and the 3D view, instead of teleporting.

**Architecture:** Two pure helpers (`pitLaneSample`, `advancePitPhase`) in `src/pitlane.js` drive a render-only animation off the existing `inPit` flag — no sim/snapshot change. The editor authors a `pitLane` record (round-tripped by `track_store`); both renderers resolve it (authored or a default = today's spur) and replace their teleport with the drive animation.

**Tech Stack:** Vanilla ES modules, `node --test`, Canvas/SVG/Three.js.

**Spec:** `docs/superpowers/specs/2026-06-15-apexweb-pit-lane-design.md`

## Conventions (every task)
- Run commands from `ApexWeb/`. Commits: **explicit pathspecs**, never `git add -A`. End each message with a blank line then `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Russian user-facing strings. Full `node --test` only in the last task.

## File Structure

| File | C/M | Responsibility |
|---|---|---|
| `src/pitlane.js` | Create | Pure `pitLaneSample` + `advancePitPhase`. |
| `src/track_store.js` | Modify | Round-trip `pitLane`. |
| `editor.html` | Modify | Pit side toggle + width slider + hint. |
| `src/ui/editor.js` | Modify | Пит mode authors `pitLane` (entry/exit/side/width + draw + persist). |
| `src/ui/race.js` | Modify | 2D: resolve `pitLane` + animate. |
| `src/ui/race3d.js` | Modify | 3D: resolve `pitLane` + animate. |
| `tests/pitlane.test.js` | Create | Unit tests. |
| `tests/track_store.test.js` | Modify | `pitLane` round-trip. |
| `README.md` | Modify | Note. |

**Untouched:** `sim.js`, `data.js`, `track.js`, `track_build.js`, `main.js`, netcode.

---

### Task 1: `pitlane.js` — pure helpers

**Files:** Create `ApexWeb/src/pitlane.js`, `ApexWeb/tests/pitlane.test.js`.

- [ ] **Step 1: failing test** — create `ApexWeb/tests/pitlane.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pitLaneSample, advancePitPhase } from "../src/pitlane.js";

const LANE = { entry: 0.95, exit: 0.06, side: 1 };

test("pitLaneSample: endpoints (entry / box / exit)", () => {
  assert.deepEqual(pitLaneSample(0, LANE), { frac: 0.95, latUnit: 0 });
  const box = pitLaneSample(0.5, LANE);
  assert.ok(Math.abs(box.frac - 0) < 1e-9 && Math.abs(box.latUnit - 1) < 1e-9);
  const ex = pitLaneSample(1, LANE);
  assert.ok(Math.abs(ex.frac - 0.06) < 1e-9 && Math.abs(ex.latUnit) < 1e-9);
});

test("pitLaneSample: in-lap frac goes forward across S/F", () => {
  for (const p of [0.1, 0.4]) { const f = pitLaneSample(p, LANE).frac; assert.ok(f >= 0.95 || f < 1e-6, `f=${f}`); }
});

test("pitLaneSample: side flips lateral sign; clamps; missing lane defaults", () => {
  assert.ok(pitLaneSample(0.5, { entry: 0.95, exit: 0.06, side: -1 }).latUnit < 0);
  assert.equal(pitLaneSample(-1, LANE).frac, 0.95);
  assert.ok(pitLaneSample(0.5, undefined).latUnit !== undefined);
});

test("advancePitPhase: in-lap ramps to 0.5 then holds while inPit", () => {
  let s = advancePitPhase({ phase: 0, active: false }, true, 0.6);   // 0.6*0.5/1.2 = 0.25
  assert.ok(Math.abs(s.phase - 0.25) < 1e-9 && s.active);
  s = advancePitPhase(s, true, 10);
  assert.ok(Math.abs(s.phase - 0.5) < 1e-9 && s.active);
});

test("advancePitPhase: out-lap ramps to 1 then releases", () => {
  let s = advancePitPhase({ phase: 0.5, active: true }, false, 0.6);
  assert.ok(Math.abs(s.phase - 0.75) < 1e-9 && s.active);
  s = advancePitPhase(s, false, 10);
  assert.ok(s.phase === 1 && !s.active);
});

test("advancePitPhase: fresh inPit after release resets phase to 0", () => {
  const s = advancePitPhase({ phase: 1, active: false }, true, 0);
  assert.ok(s.phase === 0 && s.active);
});
```

- [ ] **Step 2: run → fail** — `node --test tests/pitlane.test.js` → cannot find module.

- [ ] **Step 3: implement** — create `ApexWeb/src/pitlane.js`:

```js
// ApexWeb/src/pitlane.js — pure helpers for the pit-lane drive animation (render-only). No imports.
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (t) => t * t * (3 - 2 * t);                       // smoothstep ease
function fwd(a, b, t) { const d = ((b - a) % 1 + 1) % 1; return ((a + d * t) % 1 + 1) % 1; }   // forward along the lap

// position along the pit lane at `phase` 0..1. box is implicitly frac 0 (start/finish).
// [0,0.5): in-lap entry->0, latUnit 0->side ; [0.5,1]: out-lap 0->exit, latUnit side->0.
// returns { frac (0..1), latUnit (-1..1; box depth = ±1) }; each renderer scales latUnit by width×halfWidth.
export function pitLaneSample(phase, lane) {
  const { entry = 0.95, exit = 0.06, side = 1 } = lane || {};
  const p = clamp01(phase);
  if (p < 0.5) { const t = p / 0.5; return { frac: fwd(entry, 0, t), latUnit: side * smooth(t) }; }
  const t = (p - 0.5) / 0.5; return { frac: fwd(0, exit, t), latUnit: side * (1 - smooth(t)) };
}

// advance a car's pit-anim state off the inPit flag (no snapshot/pitTimer change). state {phase, active}.
// fresh inPit -> phase 0; while inPit ramp to 0.5 (in-lap) then hold (box); once inPit clears ramp to 1
// (out-lap) then active=false (car back to its normal on-track position).
export function advancePitPhase(state, inPit, dt, opts = {}) {
  const { inSec = 1.2, outSec = 1.2 } = opts;
  let phase = (state && state.phase) || 0, active = !!(state && state.active);
  if (inPit) {
    if (!active) phase = 0;
    active = true;
    phase = Math.min(0.5, phase + dt * 0.5 / inSec);
  } else if (active) {
    phase = phase + dt * 0.5 / outSec;
    if (phase >= 1) { phase = 1; active = false; }
  }
  return { phase, active };
}
```

- [ ] **Step 4: run → pass** — `node --test tests/pitlane.test.js` → 6 tests pass.
- [ ] **Step 5: commit** — `git add src/pitlane.js tests/pitlane.test.js` →
  `git commit -m "feat(apexweb): pitlane — pure pitLaneSample + advancePitPhase (pit-lane drive math)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 2: `track_store.js` — round-trip `pitLane`

**Files:** Modify `ApexWeb/src/track_store.js`, `ApexWeb/tests/track_store.test.js`.

- [ ] **Step 1: failing test** — append to `ApexWeb/tests/track_store.test.js`:

```js
test("track_store: round-trips pitLane (+ default null for old records)", () => {
  localStorage.clear();
  saveTrack("Питовая", { points: [0, 0, 1, 0, 1, 1, 0, 1], pitLane: { entry: 0.9, exit: 0.08, side: -1, width: 2.5 } });
  assert.deepEqual(effectiveTrack("Питовая", [9, 9, 9, 9]).pitLane, { entry: 0.9, exit: 0.08, side: -1, width: 2.5 });
  saveTrack("Старая", { points: [0, 0, 1, 0, 1, 1, 0, 1] });
  assert.equal(effectiveTrack("Старая", [9, 9, 9, 9]).pitLane, null);
  assert.equal(effectiveTrack("НетТакой", [1, 2, 3, 4]).pitLane, null);   // preset fallback
});
```

- [ ] **Step 2: run → fail** — `node --test tests/track_store.test.js` → the new test fails (pitLane undefined).

- [ ] **Step 3: implement** — in `ApexWeb/src/track_store.js`, in `saveTrack`'s object literal (after the `cornerOverrides:` line) add:

```js
    cornerOverrides: data.cornerOverrides || null,
    pitLane: data.pitLane || null,
```

In `effectiveTrack`, in the **edited** return object (after its `cornerOverrides:` line) add `pitLane: e.pitLane || null,`; and in the **fallback** return (the preset line) add `pitLane: null` (before the closing `}`). Final fallback line:

```js
  return { points: presetPoints, objects: [], pit: null, pitLoss: null, zones: [], cornerOverrides: null, pitLane: null };
```

- [ ] **Step 4: run → pass** — `node --test tests/track_store.test.js` → all pass.
- [ ] **Step 5: commit** — `git add src/track_store.js tests/track_store.test.js` →
  `git commit -m "feat(apexweb): track_store round-trips pitLane (backward-compatible null)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 3: editor — author the pit lane (Пит mode)

**Files:** Modify `ApexWeb/editor.html`, `ApexWeb/src/ui/editor.js`. UI — gate `node --check src/ui/editor.js`.

- [ ] **Step 1: editor.html — pit controls.** Find:

```html
  <div class="row" id="pitctl" hidden>Потеря в питах, с: <input id="pitloss" type="number" step="0.1" style="width:64px"></div>
```

Replace with:

```html
  <div class="row" id="pitctl" hidden>Потеря в питах, с: <input id="pitloss" type="number" step="0.1" style="width:64px"><br>
    <span id="pithint" style="font-size:12px;color:#8a909c"></span><br>
    Пит-лейн: <button id="pit-side">сторона ◀</button> ширина <input id="pit-width" type="range" min="1" max="4" step="0.25" value="2.5" style="width:90px"></div>
```

- [ ] **Step 2: editor.js — state + load/reset.** Find:

```js
let pit = null, pitLoss = null;                         // pit-box marker {x,y} + pit-loss seconds
```

Replace with:

```js
let pit = null, pitLoss = null;                         // pit-box marker {x,y} + pit-loss seconds
let pitLane = null, pitNext = "entry";                  // {entry,exit,side,width} authored lane + which end the next click sets
```

In `loadTrack`, find `pit = saved.pit || null; pitLoss = ...;` and append `pitLane = saved.pitLane || null;`. In the same function's else/reset branch find `objects.length = 0; pit = null; pitLoss = null; zones.length = 0; cornerOverrides = {};` and append ` pitLane = null;` before the line break.

- [ ] **Step 3: editor.js — Пит-mode click authors entry/exit.** Find:

```js
  if (mode === "pit") { pit = unproject(mx, my); render(); return; }                      // place the pit marker (Task 6 adds the loss UI)
```

Replace with:

```js
  if (mode === "pit") {                                                                    // author the pit lane: alternate entry / exit
    if (pts.length < 3) { toast("Мало точек"); return; }
    pit = unproject(mx, my);
    const cl = buildCenterline(splinePath(toFlat(pts))), f = nearestFrac(cl, pit, 360);
    pitLane = pitLane || { entry: 0.95, exit: 0.06, side: 1, width: parseFloat(document.getElementById("pit-width").value) || 2.5 };
    pitLane[pitNext] = f; pitNext = pitNext === "entry" ? "exit" : "entry";
    document.getElementById("pithint").textContent = "клик ставит: " + (pitNext === "entry" ? "вход" : "выход");
    render(); return;
  }
```

- [ ] **Step 4: editor.js — side toggle + width slider + pit hint in setMode.** Find the `setMode` body line:

```js
  if (m === "pit") document.getElementById("pitloss").value = (pitLoss == null ? "" : pitLoss);
```

Replace with:

```js
  if (m === "pit") {
    document.getElementById("pitloss").value = (pitLoss == null ? "" : pitLoss);
    document.getElementById("pit-width").value = (pitLane && pitLane.width) || 2.5;
    document.getElementById("pithint").textContent = "клик ставит: " + (pitNext === "entry" ? "вход" : "выход");
  }
```

Find the `pitloss` oninput wiring:

```js
document.getElementById("pitloss").oninput = (e) => { const v = parseFloat(e.target.value); pitLoss = isNaN(v) ? null : v; };
```

Add after it:

```js
document.getElementById("pit-side").onclick = () => { pitLane = pitLane || { entry: 0.95, exit: 0.06, side: 1, width: 2.5 }; pitLane.side = -pitLane.side; render(); };
document.getElementById("pit-width").oninput = (e) => { if (pitLane) { pitLane.width = parseFloat(e.target.value) || 2.5; render(); } };
```

- [ ] **Step 5: editor.js — draw the lane in Пит mode.** Find, in `render()`, the pit marker draw:

```js
  if (pit) { const c = C([pit.x, pit.y]); g.fillStyle = "#ffd24a"; g.font = "bold 16px system-ui"; g.textAlign = "center"; g.fillText("⛽", c[0], c[1] + 5); }
```

Replace with:

```js
  if (mode === "pit" && pitLane) {                                                         // draw the authored lane: offset of the track entry->0->exit
    const cl = buildCenterline(splinePath(toFlat(pts))), off = (pitLane.side || 1) * (pitLane.width || 2.5) * (HALF_W * size / WORLD);
    const segFwd = (a, b) => { const d = ((b - a) % 1 + 1) % 1; const out = []; for (let k = 0; k <= 12; k++) out.push(C(offsetPoint(cl, ((a + d * k / 12) % 1 + 1) % 1, off))); return out; };
    const lane = [...segFwd(pitLane.entry ?? 0.95, 0), ...segFwd(0, pitLane.exit ?? 0.06)];
    g.beginPath(); lane.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]));
    g.lineWidth = 5; g.strokeStyle = "rgba(255,210,74,.8)"; g.lineCap = "round"; g.stroke();
    const box = C(offsetPoint(cl, 0, off)); g.fillStyle = "#ffd24a"; g.font = "bold 15px system-ui"; g.textAlign = "center"; g.fillText("⛽", box[0], box[1] + 5);
  }
```

- [ ] **Step 6: editor.js — persist pitLane.** In the three record literals (save handler `const rec = {...}`, the 🏁 race handler's `saveTrack({...})`, and the export `Blob` JSON), add `pitLane` after `cornerOverrides`. Each literal currently ends `... zones, cornerOverrides }`; change to `... zones, cornerOverrides, pitLane }`. In the import `onchange` handler, after `cornerOverrides = d.cornerOverrides ? {...} : {};` add `pitLane = d.pitLane || null;`.

- [ ] **Step 7: verify + commit** — `node --check src/ui/editor.js` (exit 0). Then `git add editor.html src/ui/editor.js` →
  `git commit -m "feat(apexweb): editor authors a pit lane (entry/exit/side/width + draw) in Пит mode" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

NOTE for the implementer: `buildCenterline`, `splinePath`, `toFlat`, `nearestFrac`, `offsetPoint`, `HALF_W`, `WORLD`, `size`, `C`, `toast` are all already imported/in scope in editor.js. `size` is a field of the `frame()` return / `base`; within `render()` it is available as part of `frame()` — confirm `size` is in scope where you draw (it is destructured in `frame()`; if not in `render()` scope, compute `HALF_W * base.size / WORLD` using `base`). Verify by reading the surrounding `render()`/`frame()` code before editing.

---

### Task 4: 2D minimap — drive the lane (`race.js`)

**Files:** Modify `ApexWeb/src/ui/race.js`. No unit test — `node --check src/ui/race.js` + owner F5.

- [ ] **Step 1: imports + default lane + resolve in ensureTrack.** At the top of `race.js`, add to the imports (find an existing `from "../track_store.js"` or add one) `import { effectiveTrack } from "../track_store.js";` and `import { pitLaneSample, advancePitPhase } from "../pitlane.js";`. Near `let _curTrack = "__none__";` add:

```js
const DEFAULT_PIT_LANE = { entry: 0.95, exit: 0.06, side: 1, width: 2.5 };
let _pitLane = DEFAULT_PIT_LANE;
const MINIMAP_HW = 2.6;   // minimap units per track-half-width (default width 2.5 -> ~6.5, today's spur depth)
const _pitAnim = {};      // idx -> { phase, active }
```

In `ensureTrack(name)`, after `setTrack(...)`, add: `_pitLane = (effectiveTrack(name, null).pitLane) || DEFAULT_PIT_LANE;` (guarding: `effectiveTrack` tolerates a missing preset; if its signature needs points, pass `(name && TRACK_SHAPES[name]) || TRACK_PATH`).

- [ ] **Step 2: animate in the map loop.** In `startMapLoop`'s `step`, the loop has `const now = nowMs(), renderT = now - DELAY`. Add a frame `dt`: track `ctx._pitLast` — `const dt = Math.min(0.05, (now - (ctx._pitLast || now)) / 1000); ctx._pitLast = now;`. Then replace:

```js
      if (meta.inPit || (ctx._pit[idx] && now < ctx._pit[idx])) { [x, y] = PIT_STOP; }  // in the box (or just-pitted tail)
      else { [x, y] = pointAt(sampleBuf(ctx._buf[idx], renderT)); }
```

with:

```js
      const inPit = meta.inPit || (ctx._pit[idx] && now < ctx._pit[idx]);
      const pa = _pitAnim[idx] = advancePitPhase(_pitAnim[idx], inPit, dt);
      if (pa.active) { const s = pitLaneSample(pa.phase, _pitLane); [x, y] = pitPos(s.frac, s.latUnit * _pitLane.width * MINIMAP_HW); }
      else { [x, y] = pointAt(sampleBuf(ctx._buf[idx], renderT)); }
```

- [ ] **Step 3: verify + commit** — `node --check src/ui/race.js` (exit 0). Then `git add src/ui/race.js` →
  `git commit -m "feat(apexweb): 2D minimap drives the pit lane (advancePitPhase + pitLaneSample) instead of teleport" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

NOTE: `pitPos(frac, depth)` already exists in race.js (offsets along the inward normal). `TRACK_SHAPES`/`TRACK_PATH` are imported there. Read the import block + `startMapLoop` before editing to place the new imports and the `dt`/state cleanly.

---

### Task 5: 3D view — drive the lane (`race3d.js`)

**Files:** Modify `ApexWeb/src/ui/race3d.js`. No unit test — `node --check src/ui/race3d.js` + owner F5.

- [ ] **Step 1: imports + default lane + resolve.** Add to race3d's imports `import { pitLaneSample, advancePitPhase } from "../pitlane.js";`. After the `const edited = ...` resolve (the editor-preview hook), add `const pitLane = (edited.pitLane) || { entry: 0.95, exit: 0.06, side: 1, width: 2.5 };`.

- [ ] **Step 2: per-frame dt.** In the `frame()` function, near `const rt = nowMs() - DELAY;`, add `const dt = Math.min(0.05, (nowMs() - (lastFrame || nowMs())) / 1000); lastFrame = nowMs();` and declare `let lastFrame = 0;` next to `let raf = 0, alive = true;`.

- [ ] **Step 3: replace the inPit teleport.** Find:

```js
      if (c.inPit) {
        car.group.position.set(wx(PIT), 0, wz(PIT));
        car.ring.material.opacity = 0; car.lat = 0; car.px = null;   // re-snap when it rejoins the track
        continue;
      }
```

Replace with:

```js
      car._pit = advancePitPhase(car._pit, c.inPit, dt);
      if (car._pit.active) {
        const s = pitLaneSample(car._pit.phase, pitLane);
        const p = offsetPoint(cl, s.frac, s.latUnit * pitLane.width * HW_N), t = tangentAt(cl, s.frac);
        car.group.position.set(wx(p), 0, wz(p));
        car.group.rotation.y = Math.atan2(t[0], t[1]);
        car.ring.material.opacity = 0; car.lat = 0; car.px = null;   // re-snap when it rejoins the track
        continue;
      }
```

- [ ] **Step 4: verify + commit** — `node --check src/ui/race3d.js` (exit 0). Then `git add src/ui/race3d.js` →
  `git commit -m "feat(apexweb): 3D view drives the pit lane (advancePitPhase + pitLaneSample) instead of teleport" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

NOTE: `offsetPoint`, `tangentAt`, `wx`, `wz`, `HW_N`, `cl`, `nowMs`, the `cars[c.idx]` object (here `car`, with `.group/.ring/.lat/.px`) all exist in race3d.js. `car._pit` is a new per-car field (undefined first frame → `advancePitPhase` handles it). The old `PIT` const may become unused — leave it or remove it if `node --check`/grep shows no other use.

---

### Task 6: README + final verification

**Files:** Modify `ApexWeb/README.md`.

- [ ] **Step 1: README.** In **## Редактор трассы**, find the **Пит** description (`клик по холсту — поставить боксы + поле потери` or similar) and append to it: ` + рисуешь пит-лейн (вход/выход/сторона/ширина), по которому машины реально едут в гонке (2D+3D)`. If the exact phrase differs, append the same note to the Пит-mode description; report any adaptation.

- [ ] **Step 2: targeted checks** — `node --test tests/pitlane.test.js tests/track_store.test.js` (all pass); `node --check src/ui/editor.js src/ui/race.js src/ui/race3d.js` (exit 0). (`node --check` accepts multiple files.)

- [ ] **Step 3: full suite** — `node --test` → green (existing + new). The renderers have no unit test; `pitlane`/`track_store` are covered; sim untouched. (~10 min.)

- [ ] **Step 4: commit** — `git add README.md` →
  `git commit -m "docs(apexweb): drawable pit lane + cars drive it (README)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

## Owner F5 (manual — SVG/WebGL animation not headless-verifiable)

1. `cd ApexWeb && node tools/editor_server.mjs`, open `editor.html` → **Пит** mode → click the track twice (вход/выход near S/F), toggle **сторона**, set **ширина** → the yellow lane draws along the track. **💾 Сохранить**.
2. **🏁 Гонять** → when a car pits, it **drives off into the lane → sits in the box → drives back out** — in both the **2D minimap** and the **3D** view.
3. An **unauthored** track (e.g. Barcelona) uses the **default** lane the same way (cars drive the spur, no teleport). A normal race is otherwise unchanged.

## Self-Review

**1. Spec coverage:** pitLane model+round-trip (T2); pure helpers (T1); editor authoring entry/exit/side/width+draw (T3); 2D drive (T4); 3D drive (T5); README (T6). ✓
**2. Placeholder scan:** no TBD; full code for T1/T2; precise anchored edits + scope notes for T3-T5. ✓
**3. Type consistency:** `pitLaneSample(phase, lane{entry,exit,side})→{frac,latUnit}` and `advancePitPhase(state{phase,active}, inPit, dt, opts)→{phase,active}` used identically in T1 tests, T4, T5; `pitLane{entry,exit,side,width}` consistent across track_store, editor, both renderers; renderers scale `latUnit*width*halfWidth` (MINIMAP_HW / HW_N). ✓
