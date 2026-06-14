# ApexWeb Editor 3D + SVG-Reference Preview — Design

**Date:** 2026-06-15
**Status:** Approved (brainstorm), pending spec review → plan
**Topic:** Two reference views beside the track editor — a live **3D preview** (track + scenery + objects + cars driving the line, the *same* renderer as the game) refreshed on a button, and a fixed **2D «svg-эталон»** showing the original preset outline.

This is **Feature A** of two (decision 2026-06-15). **Feature B** (a drawable pit lane that cars actually drive through) is a separate later spec.

---

## Goal

While authoring a track the owner can't see how it will look in-game until they launch a race. Add, in the editor:
1. A **3D preview** — the edited geometry rendered by the **actual game 3D engine** (`race3d`), with scenery, placed objects, and a few cars driving the racing line, so the owner sees *exactly* how the models render. Rebuilt on an **«Обновить»** button (the owner chose button-refresh over live-on-drag — 3D meshes are expensive to rebuild per drag frame).
2. A **2D «svg-эталон»** — the **original preset outline** (`TRACK_SHAPES[name]`, full resolution, clean thin line) as a fixed reference of the real circuit shape, for comparison while editing.

## Constraints

1. **Render/UI only.** No `sim.js` / `data.js` / `track_store.js` / netcode changes. The sim is not involved (no race runs in the editor).
2. **Reuse the game renderer.** The preview must use the *same* `race3d` scene, car model (`makeCar`), scenery and object meshes — that is the whole point ("see how the models render"). So we reuse `race3d` wholesale rather than a parallel renderer that could drift.
3. **Race view byte-unchanged.** The two `race3d` additions are *additive branches guarded by editor-only flags* (`ctx.snapshot.points`, `ctx.editorPreview`) that the race path never sets — when absent, `race3d` runs the identical code path it does today.
4. **Pure helpers stay THREE-free.** Anything unit-tested must not sit in the import chain of `three` (loaded from a CDN URL `node --test` can't fetch). Pure preview math lives in a separate THREE-free module.

## Architecture / data flow

```
editor.js  --(live flat points + objects)-->  editor3d.startPreview(canvas, {points, objects})
                                                   |
                                          builds a synthetic ctx:
                                          { editorPreview:true,
                                            snapshot:{ points, objects, cars:[…N…] },
                                            _buf:{}, _cam3d:{mode:"orbit"} }
                                                   |
                                          race3d.init(canvas, ctx)   <-- 2 additive hooks read the flags
                                                   |
                          editor3d ticker (rAF) advances cars[i].lapFrac each frame
                                                   |
                          race3d's own frame loop renders the cars driving (Hook B reads lap+lapFrac)

editor.js  --(current track name)-->  drawSvgRef(svgCanvas, name)   reads TRACK_SHAPES[name], fits + draws the outline
```

**Repo files / localStorage are untouched by the preview** — it reads the *in-memory* live edit state directly (not the saved track), so it reflects unsaved edits the moment you press «Обновить».

## Components

| File | Create/Modify | Responsibility |
|---|---|---|
| `src/editor_preview.js` | Create | **Pure, THREE-free** preview math: `advanceFrac`, `buildPreviewCars`, `fitOutline`. Unit-tested. |
| `src/editor3d.js` | Create | Preview controller: builds the synthetic ctx, calls `race3d.init`, runs the car-advance ticker, tears down. Imports `race3d` (+ THREE transitively). |
| `src/ui/race3d.js` | Modify | Two additive, flag-guarded hooks (explicit geometry; direct car progress in editor mode). |
| `src/ui/editor.js` | Modify | Wire «Обновить» → (re)build the 3D preview; draw the svg-эталон on preset change; tidy teardown. |
| `editor.html` | Modify | Add the 3D canvas, «Обновить» button, and svg-эталон canvas to the top of the right panel. |
| `README.md` | Modify | Note the editor preview panels. |

## Interfaces

**`src/ui/race3d.js` — two additive hooks**

- *Hook A — explicit geometry* (replaces the geometry resolve at the current line 42-43):
  ```js
  const edited = (ctx.snapshot && ctx.snapshot.points)
    ? { points: ctx.snapshot.points, objects: ctx.snapshot.objects || [] }
    : effectiveTrack(trackName, (trackName && TRACK_SHAPES[trackName]) || TRACK_PATH);
  ```
  `edited.points` feeds the centerline; `edited.objects` already drives the object meshes (current lines 138-145). The race path never sets `ctx.snapshot.points`, so it falls through to `effectiveTrack` unchanged.

- *Hook B — direct car progress in editor mode* (replaces the progress read at the current line 271):
  ```js
  const prog = ctx.editorPreview ? (c.lap + c.lapFrac) : sampleProg(buf[c.idx], rt);
  ```
  In editor mode the car's progress comes straight from the synthetic car object the ticker advances (no network snapshot buffer). `sampleWarp(speedWarp, prog)` still applies, so cars visually slow into corners for free. The race path (`editorPreview` undefined) is unchanged.

**`src/editor_preview.js` — pure (no THREE)**

- `advanceFrac(lap, lapFrac, dt, lapSeconds) -> { lap, lapFrac }` — advance one car's progress by `dt` seconds at `1/lapSeconds` laps/s; wrap `lapFrac` past 1.0 and increment `lap`.
- `buildPreviewCars(n, colors) -> [{ idx, color, lap:0, lapFrac, retired:false, inPit:false, player:false }]` — `n` cars spread evenly round the lap (`lapFrac = i/n`), coloured by `colors[i % colors.length]`.
- `fitOutline(flat, w, h, pad) -> [[x,y], …]` — map a flat `[x0,y0,…]` normalized outline to canvas pixels fitted into `w×h` with `pad` margin, preserving aspect (uniform scale, centered). Returns `[]` for a too-short/missing `flat`.

**`src/editor3d.js` — preview controller (imports race3d)**

- `startPreview(canvas, edit, opts?) -> { dispose }` where `edit = { points, objects }`, `opts.cars` (default 5), `opts.lapSeconds` (default 7):
  - `cars = buildPreviewCars(opts.cars, CAR_COLS)`.
  - `ctx = { editorPreview:true, snapshot:{ trackName:null, points: edit.points, objects: edit.objects||[], cars }, _buf:{}, _cam3d:{mode:"orbit"} }`.
  - `const r3d = race3d.init(canvas, ctx)`.
  - ticker via `requestAnimationFrame`: each frame, for each car, `Object.assign(car, advanceFrac(car.lap, car.lapFrac, dt, opts.lapSeconds))`; `dt` from frame delta (clamped). race3d's own loop renders.
  - `dispose()` cancels the ticker and calls `r3d.dispose()`.

**`src/ui/editor.js` — svg-эталон draw** (inline; editor.js does NOT import THREE)

- `drawSvgRef(canvas, name)` — `const flat = TRACK_SHAPES[name]`; if absent, clear + center the text «(нет эталона)»; else `const pts = fitOutline(flat, canvas.width, canvas.height, 12)` and stroke a closed thin polyline. Redrawn from `sel.onchange` and on initial load.

## Layout (editor.html — compact, in the right panel)

Insert at the **top of `#panel`** (right after the `#preset` select), so the editor canvas and `#wrap` flex are untouched (panel already `overflow:auto`):

```html
<div class="row"><canvas id="preview3d" style="width:100%;height:210px;background:#0b0d12;border-radius:6px"></canvas></div>
<div class="row"><button id="refresh3d" style="width:100%">🔄 Обновить 3D</button></div>
<div class="row"><b style="font-size:12px">Эталон (оригинал трассы):</b><br>
  <canvas id="svgref" style="width:100%;height:130px;background:#0b0d12;border-radius:6px"></canvas></div>
```

The **3D canvas** is sized by `race3d`'s own `resize()` (it reads `clientWidth/clientHeight`), so it just needs the CSS size above. `editor.js` sizes only the **svg-эталон** canvas's backing store to its client box (×devicePixelRatio) before drawing. The 3D preview is ~panel-width (~280px) — enough to read the models with orbit/zoom; a wider dedicated column was considered and deferred (more `#wrap` surgery for marginal gain).

## Error handling

- **No preset original** (`TRACK_SHAPES[name]` undefined — «Пустая»/custom): svg-эталон shows «(нет эталона)», no throw.
- **Rebuild / teardown:** «Обновить» disposes the previous preview (`dispose()` → cancels ticker, frees race3d GPU resources via its existing `dispose`) before building a new one — no leaked WebGL contexts or runaway tickers. Leaving the editor (canvas removed) self-disposes via race3d's `canvas.isConnected` check.
- **WebGL/bloom failure:** handled by race3d already (composer stays null → plain render); the preview inherits that resilience.
- **Too-few points** (`< 3`): «Обновить» no-ops with a toast «Мало точек» (the centerline needs ≥3).

## Testing

- **`src/editor_preview.test.js`** (pure): `advanceFrac` wraps past 1.0 and bumps `lap`; partial advance doesn't wrap; `buildPreviewCars` spreads `lapFrac=i/n` with cycled colours and the right flags; `fitOutline` returns points inside `[pad, w-pad]×[pad, h-pad]`, preserves aspect (a square maps to a centered square), and `[]` for short input.
- **Race-path-unchanged:** `node --check src/ui/race3d.js`; the two hooks are guarded by flags the race path never sets, so the existing behavior is identical (argued + `node --check`; the full race render is WebGL, owner-verified). The existing `node --test` suite stays green (race3d has no unit test; nothing else changes).
- **`node --check`** on `editor3d.js`, `editor.js`.
- **Preview-MCP** ([[preview-mcp-throttles-raf]]): verify `editor.html` loads with **zero console errors**, the preview canvas paints a **first frame** (synchronous render + pixel-colour sample — rAF animation itself isn't verifiable), the svg-эталон draws, and «Обновить» runs.
- **Owner F5** (WebGL not headless-testable): open the editor → 3D preview shows the track + scenery + objects + cars **driving**; orbit/zoom works; «Обновить» reflects edits; svg-эталон matches the picked circuit; and a normal **race still looks identical** (the guarded race3d change).

## Scope / YAGNI

- **In:** 3D preview (reuse race3d, «Обновить», driving cars, orbit), svg-эталон (preset original), compact panel layout, the 2 race3d hooks, README.
- **Out (deferred):** editing *in* the 3D view; live-on-drag 3D rebuild (button chosen); a wider dedicated preview column; the pit lane (Feature B); showing the *edited* track as a clean line (the эталон is the *original* by decision).
