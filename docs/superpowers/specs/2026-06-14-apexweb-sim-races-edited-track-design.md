# ApexWeb Шаг 2 — the sim races an edited track — design

Date: 2026-06-14
Status: approved (owner: "ок"; target = race MY edited track; entry = "🏁 Гонять" button in the editor)
Scope: make the deterministic race sim actually use an **edited track** — its geometry (mini-sectors)
and authored overtake-zones + pit — launched by a "🏁 Гонять" button in the editor. First slice of
"Шаг 2" (the deferred sim-uses-authored-data step). Balance-sensitive: touches `sim.js`/`track.js`,
so determinism + the calibrated default race must be preserved and verified.

## Goal

Today the editor authors track data into localStorage but the **sim always races a hardcoded track**
(`data.js TRACK` = Barcelona); `trackName` only drives the visual. Owner wants their *edited* track to
actually drive a race: its corners/straights shape **where overtaking happens** (slipstream, dirty
air, zones — via the geometry), and its painted overtake-zones + pit apply. Entry is a quick test loop
— a button in the editor → straight into a race on that track.

## Current architecture (what we're bridging)

- `Race`'s constructor already TAKES a track: `new Race(field, track, seed, difficulty)` → `this.track`.
  But `main.js:148` always passes the hardcoded `TRACK`.
- `this.track` supplies: `lt, laps, pw, df, ot, abr, sc, wet, pit, overtake_zones`.
- **Hardcoded:** `track.js` computes `MINI` (18 mini-sectors, per-sector `straightness`) from
  `TRACK_PATH` at module-load; `sampleAt(lapFrac)` (combat: `_resolveCombat` reads `.straightness` for
  slipstream/dirty-air, `.mini` for the zone lookup) and `miniSplits(lapTime, car)` (`sim.js:361`,
  derived sector data) read that module global. So the geometry-derived **combat character + sector
  data** are Barcelona's regardless of the track object. (Base lap pace `_lapTime` is
  geometry-independent — it uses `track.lt/pw/df` + car/driver/tyre/fuel.) **This is the thing the
  bridge must parameterize.**
- Zones are mini-sector-indexed, so they're geometry-tied — "use my zones" REQUIRES racing my geometry.

## The bridge — parameterize `track.js` (the load-bearing, determinism-critical change)

Make `track.js` pure over a track's geometry:
- `export function buildMini(outline)` — the CURRENT `buildMini` math, parameterized by a dense flat
  outline `[x0,y0,...]` (was implicitly `TRACK_PATH`). Returns the 18-sector `[{straightness, lenFrac,
  sector}]`. **`buildMini(TRACK_PATH)` must deep-equal today's Barcelona `MINI`** (it's the same math
  on the same points) — this is the behaviour-preserving invariant, unit-tested.
- The per-race track object carries `track.mini`. `sampleAt(track, lapFrac)` and
  `miniSplits(track, lapTime, car)` read `track.mini` (+ `N_MINI` stays a const). Remove the
  module-level `MINI` global; update every consumer.
- `sim.js` threads `this.track`: `sampleAt(me.lapFrac)` → `sampleAt(this.track, me.lapFrac)`,
  `miniSplits(lapTime, car)` → `miniSplits(this.track, lapTime, car)`. **Math unchanged** — only the
  source of `mini` moves from a global to the passed track. (Audit every `sampleAt`/`miniSplits`/`MINI`
  call site across `sim.js` and any other importer — e.g. quali — and thread the track.)

Determinism is preserved: `mini` is a deterministic function of the outline; same edited track + same
seed → same race. The host-authoritative sim is otherwise untouched.

## `src/track_build.js` (new, pure, testable) — build the race-track object

```js
import { TRACK, TRACK_PATH } from "./data.js";
import { buildMini } from "./track.js";
import { splinePath } from "./geom3d.js";

// the default race track (Barcelona) with its mini attached — used by the normal race path.
export function defaultRaceTrack() { return { ...TRACK, mini: buildMini(TRACK_PATH) }; }

// build a sim track from an edited track record. Geometry -> mini (densify the sparse control points
// via splinePath first). Authored zones + pit applied. Non-authored stats inherit Barcelona defaults.
export function trackFromEdited(edited, base = TRACK) {
  return {
    ...base,
    name: edited.name || base.name,
    mini: buildMini(splinePath(edited.points)),
    overtake_zones: Array.isArray(edited.zones) ? edited.zones : [],
    pit: (typeof edited.pitLoss === "number") ? edited.pitLoss : base.pit,
  };
}
```
- Edited control points are sparse (~48) → `splinePath` densifies them so `buildMini`'s per-vertex
  `turnAngle` is smooth (Barcelona's `TRACK_PATH` is already dense → passed raw → unchanged).
- **Non-authored** (`lt/pw/df/ot/abr/sc/wet/laps`) inherit Barcelona defaults (neutral; geometry +
  zones + pit give the track-specific behaviour). **How the geometry bites:** the sim's COMBAT reads
  `sampleAt(lapFrac).straightness` (slipstream stronger on straights, dirty-air worse in corners) +
  `.mini` (zone lookup), so the edited track's corners/straights shape WHERE overtaking happens —
  exactly what the painted zones target. **Base lap pace stays geometry-independent** here (driven by
  `track.lt/pw/df` = Barcelona defaults); deriving pace from the geometry, and `cornerOverrides`→`pw/df`,
  are deferred (so `cornerOverrides` is not consumed in this slice).
- `edited.pit` (the marker position) is for the 3D/visual only (already handled via `effectiveTrack`);
  the sim uses `pitLoss` → `track.pit`.

## The "🏁 Гонять" flow (editor → game, render/integration layer)

- **`editor.html` + `editor.js`:** a "🏁 Гонять" button. On click: `saveTrack(name, {...})` (persist
  the current edits), set `localStorage["apexweb_race_track"] = name`, then `location.href = "index.html"`.
- **`main.js` boot:** read + clear `localStorage["apexweb_race_track"]`. If set: load the saved track
  (`track_store.loadAll()[name]` or `effectiveTrack`), `ctx.track = trackFromEdited(saved)`, and start a
  **quick race directly** — default 2026 field, `buildGrid` (no quali), straight to the race screen
  (skip lobby/practice/quali). Otherwise boot normally.
- **Parameterize the race start:** in `startRaceHost`, `new Race(field, TRACK, …)` → `new Race(field,
  ctx.track || defaultRaceTrack(), …)`; replace the other `TRACK.*` reads in that function with
  `ctx.track.*`. The normal (non-quick) path sets `ctx.track = defaultRaceTrack()` so it's identical to
  today (Barcelona + its mini).

## Balance + determinism safety

- Racing an edited track is **opt-in** — the default race and the calibrated Barcelona are untouched.
  Balance risk is confined to the owner's own custom tracks (a feature, not a regression).
- **Harness check** (node, in `tools/`): build a sample edited track (e.g. the editor's `OVAL` and a
  twisty test layout), run a full `Race`, assert the result is **sane**: completes, finite lap times,
  no NaN, overtakes > 0 and within a loose corridor, deterministic (same seed twice → identical
  finishing order/times). This is the "is an edited track raceable" gate.
- **Barcelona-unchanged proof:** `buildMini(TRACK_PATH)` deep-equals the reference Barcelona `MINI`
  (unit), and the full `node --test` suite (incl. `sim.test.js`'s many full races) stays green — i.e.
  the parameterization didn't change the default sim.

## Testing

- `track.js`: `buildMini(TRACK_PATH)` == reference Barcelona MINI; `sampleAt(track,f)` / `miniSplits(track,…)`
  read `track.mini` (a hand-made 2-sector track → predictable sample). (TDD)
- `track_build.js`: `defaultRaceTrack().mini` == `buildMini(TRACK_PATH)`; `trackFromEdited` inherits
  defaults + applies zones/pitLoss + builds mini from the (splined) edited points; a tight-oval edited
  track yields plausible sector straightness. (TDD)
- `sim`: full suite stays green (Barcelona unchanged); a node harness races an edited track →
  sane + deterministic (the new safety check).
- `main.js` quick-race entry + the editor button + the localStorage handoff are integration/DOM →
  owner F5 (open editor, author a track, 🏁 Гонять, watch the race) + preview-MCP load check.

## File structure

- `src/track.js` (modify) — `buildMini(outline)` exported; `sampleAt`/`miniSplits` take the track;
  drop the module-level `MINI`.
- `src/track_build.js` (new) — `defaultRaceTrack`, `trackFromEdited`.
- `src/sim.js` (modify) — thread `this.track` into `sampleAt`/`miniSplits`; drop the `MINI` import.
- `src/main.js` (modify) — quick-race boot branch + `ctx.track` parameterization of `startRaceHost`.
- `src/ui/editor.js` + `editor.html` (modify) — the "🏁 Гонять" button + handoff.
- `tools/edited_race_check.mjs` (new) — the edited-track race harness (sane + deterministic).
- Update any other `track.js` consumer of `MINI`/`sampleAt`/`miniSplits` (e.g. quali) to pass the track.

## Out of scope (deferred — separate steps)

- **Online co-op on edited tracks** — the client's localStorage doesn't have the host's edited track
  (the snapshot/lobby would need to carry the edited geometry). This slice is local/host-side.
- **`cornerOverrides` → explicit `pw/df`** (MM corner-class→character) — geometry straightness already
  covers corner influence here; explicit per-corner power/downforce is a follow-on.
- **Deriving `lt/pw/df/ot` from the edited geometry** (length, corner mix) — defaults for now.
- **Lobby track picker** + the full weekend (practice/quali) on an edited track — the editor button is
  a quick race only.
- **FastF1 real-calendar in the sim** (TODO #3) — separate; shares the same `buildMini`/track-object
  bridge.
- **In-editor balance check** (run the harness from the editor UI) — the harness exists as a tool;
  surfacing it in the editor is later.
