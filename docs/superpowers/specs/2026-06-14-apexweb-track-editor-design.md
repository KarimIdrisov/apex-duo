# ApexWeb Track Editor — design

Date: 2026-06-14
Status: approved (owner picked: objects/decals + standalone page)
Scope: a standalone visual editor for the ApexWeb 3D race view. The owner edits track
shape (drag centerline control points) and places objects (grandstands, banners, trees,
cones); the saved track drives the in-game 3D view. Render/tooling layer only — the
deterministic stat-sim, netcode and snapshot contract are NOT touched.

## Goal

Stop guessing track aesthetics. Give the owner direct control: a top-down editor where they
drag the track's control points (road reshapes live, painted exactly like the game) and drop
objects around it, then Save → the 3D race view uses the edited track + objects.

## Architecture (new + changed files)

- `editor.html` (new) — standalone page: a `<canvas>` + a side toolbar. Loads `src/ui/editor.js`.
  Opened directly at `localhost:8000/editor.html`. No game/netcode involvement.
- `src/ui/editor.js` (new) — the editor: load presets, draggable control points, object
  placement, save/export/import. Pure DOM + 2D canvas (no THREE).
- `src/track_paint.js` (new, shared) — the canvas painting extracted from `race3d.js`'s painted
  block, so the editor preview and the game render IDENTICALLY. Pure: takes a 2D context, a
  centerline, a world→canvas mapper and colour options; paints grass → run-off → edge → asphalt
  → corner kerbs → start/finish. No DOM beyond the passed `ctx`, no THREE.
- `src/track_store.js` (new) — `localStorage` persistence + the "effective track" resolver.
- `src/ui/race3d.js` (changed) — paint via `track_paint`; resolve the track via `track_store`
  (edited points + objects, else the preset); render objects as simple 3D primitives.

Boundaries: `track_paint` (how a track looks) and `track_store` (where edits live) are small,
testable units with no UI. `editor.js` is the only new DOM-heavy file; `race3d.js` gains only
the object-rendering loop + the store lookup.

## Data model

An edited track is `{ points: number[], objects: Obj[] }`:
- `points` — flat normalized control points `[x0,y0,x1,y1,...]` in `0..1` (same convention as
  `TRACK_SHAPES`). The game splines these (`splinePath`) exactly as today.
- `objects` — `[{ type, x, y, rot }]`: `type ∈ {"stand","banner","tree","cone"}`, `x,y` in the
  same normalized `0..1` track space, `rot` radians (0 default).

`localStorage["apexweb_tracks"]` = `{ [trackName]: { points, objects } }` (JSON).

## `src/track_paint.js` — shared painting

```js
// Paint a track onto a 2D canvas context. `cl` = buildCenterline(splinePath(points)); `C(p)` maps
// a normalized track point -> [canvasX, canvasY]; `pxPerWorld` scales widths; `o` = colour opts.
export const DEFAULT_COLORS = { grass:"#2f5236", shoulder:"#3a5a38", edge:"#5a5a64",
  asphalt:"#30303a", kerbA:"#d83b3b", kerbB:"#ededed", start:"#ffffff" };
export function paintTrack(g, cl, C, pxPerWorld, halfW, opts = {}) { /* grass fill -> lap strokes
  (shoulder, edge), kerb RIM along the centerline through cornerRuns (red/white chunks, wider
  than asphalt), asphalt on top, start/finish stripe. Uses geom3d pointAt/tangentAt/cornerRuns/
  offsetPoint + lineJoin/lineCap='round'. Returns nothing. */ }
```
`race3d.js` calls it on a 2048² canvas with `C(p)=[(wx(p)+HALF)*PXW,(wz(p)+HALF)*PXW]`; the
editor calls it on its display canvas with a fit-to-canvas mapper. Same output, by construction.

## `src/track_store.js` — persistence

```js
export function loadAll();                       // {} or parsed localStorage["apexweb_tracks"]
export function saveTrack(name, data);           // merge {points,objects} under name, JSON.stringify back
export function clearTrack(name);                // delete one
export function effectiveTrack(name, presetPoints);  // edited {points,objects} if saved, else {points:presetPoints, objects:[]}
```
Guarded for absent/again-corrupt `localStorage` (try/catch → `{}`). Pure logic — unit-testable
with a `localStorage` shim.

## Editor UX (`editor.html` + `editor.js`)

- **Layout:** full-window split — left a square canvas (the track top-down), right a ~240px panel.
- **Load:** a `<select>` of the 25 preset names + "Пустая". On load: decimate the preset to ~48
  evenly-spaced control points (so dragging is manageable; "Пустая" = a small default oval).
  Render the painted track (via `track_paint`) + overlay the control points as draggable circles
  + objects as icons.
- **Edit points:** mousedown on a point handle → drag → live re-paint on mousemove → mouseup
  commits. **Double-click on the road** → insert a control point at the nearest segment.
  **Right-click a handle** (or select + `Delete`) → remove it (min 4 points enforced).
- **Objects:** palette buttons (Трибуна/Баннер/Дерево/Конус). Click a palette type to arm it,
  then click the canvas to drop one at that point (`rot=0`). Placed objects: drag to move,
  **mouse-wheel over a selected object** rotates it, right-click / `Delete` removes. Each type
  draws a small distinct icon on the editor canvas (box, thin bar, green blob, orange triangle).
- **Toolbar actions:** **Сохранить** (`saveTrack(name,{points,objects})` + a toast), **Экспорт
  JSON** (download `<name>.json`), **Импорт JSON** (file input → load), **Сброс** (reload the
  preset, discard edits for this name). A short hint line lists the controls.
- No undo stack in v1 (Сброс is the escape hatch). No multi-select.

## `race3d.js` integration

- Replace the inline painted block's drawing with `paintTrack(g, cl, C, PXW, HALF_W, colors)`
  (same canvas/texture/plane as now; alignment unchanged).
- Resolve the shape: `const t = effectiveTrack(trackName, (TRACK_SHAPES[trackName] || TRACK_PATH));
  const cl = buildCenterline(splinePath(t.points));` — edited points if present, else preset.
- **Objects:** for each `t.objects`, add a simple mesh at the world point `(wx(P),0,wz(P))` where
  `P` is the object's `[x,y]` mapped through the same `b`/`sc` as the track:
  - `stand` → a long low Box (grey), rotated `rot`, slightly raised; casts shadow.
  - `banner` → a thin tall Plane (team-ish colour), DoubleSide, rotated `rot`.
  - `tree` → a billboard: a small green cone + brown trunk box (cheap), or a camera-facing sprite.
  - `cone` → a small orange Cone.
  All pushed to `geos[]`/`mats[]`, freed in `dispose()`. Objects are render-only decoration.

## Testing

- `track_store.test.js` (node --test, with a `localStorage` shim): save→load round-trip;
  `effectiveTrack` returns the preset+`[]` when nothing saved and the edited data when saved;
  corrupt JSON → falls back to `{}` without throwing.
- `track_paint` smoke test: call `paintTrack` with a mock 2D ctx that records calls; assert it
  runs without throwing and issues the expected stroke/fill calls (grass fill + ≥3 lap strokes +
  ≥1 kerb stroke) on a real `TRACK_SHAPES` entry. (Catches a broken refactor headlessly.)
- `editor.js`, the canvas visuals and the 3D object rendering are NOT headless-verifiable
  (DOM/WebGL) → owner F5 (open `editor.html`, drag points, place objects, Save, then race).
- `node --check` all new/changed files; full `node --test` stays green.

## Out of scope (v1)

- No per-object scale, no z-order, no curved banners, no texture-image upload (objects are simple
  procedural primitives). No undo/redo. No editing the sim's gameplay (laps, sectors, overtaking)
  — the editor is visual only. No online sync of edited tracks (localStorage is per-browser;
  Export/Import JSON is the share path).

## Rollout

Build in an isolated worktree, subagent-driven (each unit + two-stage review). Order: (1)
`track_paint` extraction + smoke test + wire race3d to it (no behaviour change — refactor first,
verify the game still renders the same), (2) `track_store` + test + race3d uses it for the shape,
(3) `editor.html`/`editor.js` point editing + save, (4) objects (editor placement + race3d
rendering), (5) export/import + polish. `node --test` green + owner F5 between milestones.
