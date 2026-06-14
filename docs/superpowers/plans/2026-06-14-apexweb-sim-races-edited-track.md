# ApexWeb Шаг 2 — Sim Races an Edited Track — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the deterministic race sim race an *edited* track (its geometry → mini-sectors, its painted overtake-zones + pit), launched by a "🏁 Гонять" button in the editor — without changing the calibrated default (Barcelona) race.

**Architecture:** Parameterize `track.js` so mini-sectors are computed from a track's outline (`buildMini(outline)`) and carried on the track object; `sampleAt`/`miniSplits` take the track, and `sim.js` threads `this.track`. A new pure `track_build.js` builds the race-track object (default Barcelona, or `trackFromEdited`). The editor button hands off via localStorage; `main.js` boots a quick race on the edited track. Determinism + Barcelona behaviour are preserved (the same `MINI` math on the same outline) and proven by a fixture test + the full suite.

**Tech Stack:** Vanilla ES modules, `node --test`. Run from `ApexWeb/`. EXPLICIT-pathspec commits only (owner has parallel WIP). Footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. The sim/track changes are TDD'd + suite-verified; `main.js`/editor wiring is `node --check` + owner F5.

**Reference:** spec `docs/superpowers/specs/2026-06-14-apexweb-sim-races-edited-track-design.md`.

---

## File Structure

- `src/track.js` (modify) — `buildMini(outline)` exported; `sampleAt(track,f)` / `miniSplits(track,…)` take the track; drop the module-level `MINI`. `N_MINI` stays.
- `src/sim.js` (modify) — thread `this.track` into `sampleAt`/`miniSplits`/`MINI[i].sector`; drop the `MINI` import.
- `tests/track.test.js` (modify) — update existing `sampleAt` tests to the new signature; add the `buildMini(TRACK_PATH)`-equals-reference test.
- `src/track_build.js` (new) — `defaultRaceTrack()`, `trackFromEdited(edited)`. Pure.
- `tests/track_build.test.js` (new).
- `src/main.js` (modify) — `ctx.track` parameterization + `startQuickRace` + boot flag.
- `src/ui/editor.js` + `editor.html` (modify) — "🏁 Гонять" button + handoff.
- `tests/sim_edited_track.test.js` (new) — an edited-track race is sane + deterministic.
- `ApexWeb/README.md` (modify).

---

## Task 1: track.js bridge — `buildMini(outline)` + sampleAt/miniSplits take the track (determinism-critical)

**Files:** Modify `src/track.js`, `src/sim.js`, `tests/track.test.js`.

This is the load-bearing change. `track.js` currently builds `MINI` from `TRACK_PATH` at module load; the sim reads that global. After this, mini lives on the track object. **The math is unchanged — `buildMini(TRACK_PATH)` must reproduce today's `MINI` exactly**, so the Barcelona race is identical (proven by the fixture test + the full suite staying green).

- [ ] **Step 1: Write the failing test (behaviour-preserving fixture + new signatures)**

In `tests/track.test.js`: (a) add `buildMini` to the `from "../src/track.js"` import; (b) update any existing test that calls `sampleAt(frac)` to the new `sampleAt(track, frac)` form — build a tiny track with `{ mini: buildMini(<outline>) }` and pass it; (c) append this fixture test:
```js
// buildMini(TRACK_PATH) must reproduce the pre-refactor Barcelona MINI exactly (race unchanged).
import { TRACK_PATH } from "../src/data.js";
const BARCELONA_MINI_STRAIGHTNESS = [0.945627, 0.996998, 0.998472, 0.993176, 0.289701, 0.432803, 0.794887, 0.398023, 0.737879, 0.212744, 0.460927, 0.825647, 0.571955, 0.994913, 0.195195, 0, 0.624737, 0.582625];
test("buildMini(TRACK_PATH) == reference Barcelona MINI (behaviour-preserving)", () => {
  const mini = buildMini(TRACK_PATH);
  assert.equal(mini.length, 18);
  for (let i = 0; i < 18; i++) {
    assert.ok(Math.abs(mini[i].straightness - BARCELONA_MINI_STRAIGHTNESS[i]) < 1e-5, `sector ${i}: ${mini[i].straightness} vs ${BARCELONA_MINI_STRAIGHTNESS[i]}`);
    assert.ok(Math.abs(mini[i].lenFrac - 1 / 18) < 1e-9);
    assert.equal(mini[i].sector, Math.floor(i / 6));
  }
});
test("sampleAt(track, frac) + miniSplits(track, …) read track.mini", () => {
  const mini = buildMini(TRACK_PATH), track = { mini, lt: 80 };
  const s = sampleAt(track, 0.0);
  assert.ok(s.mini === 0 && s.sector === 0 && typeof s.straightness === "number");
  assert.equal(sampleAt(track, 0.999).mini, 17);
  const sp = miniSplits(track, 80, { power: 0.6, aero: 0.6 });
  assert.equal(sp.length, 18);
  assert.ok(Math.abs(sp.reduce((a, b) => a + b, 0) - 80) < 1, "splits sum ≈ lap time");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/track.test.js`
Expected: FAIL — `does not provide an export named 'buildMini'` (and the updated sampleAt calls fail).

- [ ] **Step 3: Parameterize `src/track.js`**

Replace the module-level mini construction. Find:
```js
const PTS = [];
for (let i = 0; i < TRACK_PATH.length; i += 2) PTS.push([TRACK_PATH[i], TRACK_PATH[i + 1]]);
const NP = PTS.length;

function turnAngle(i) {
  const a = PTS[(i - 1 + NP) % NP], b = PTS[i], c = PTS[(i + 1) % NP];
  const v1x = b[0] - a[0], v1y = b[1] - a[1], v2x = c[0] - b[0], v2y = c[1] - b[1];
  const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
  if (m1 < 1e-9 || m2 < 1e-9) return 0;
  let cos = (v1x * v2x + v1y * v2y) / (m1 * m2);
  cos = Math.max(-1, Math.min(1, cos));
  return Math.acos(cos);   // 0 = straight ahead, up to PI = hairpin
}

function buildMini() {
  const per = NP / N_MINI;
  const raw = [];
  for (let m = 0; m < N_MINI; m++) {
    let sum = 0, n = 0;
    for (let i = Math.floor(m * per); i < Math.floor((m + 1) * per); i++) { sum += turnAngle(i); n++; }
    raw.push(n ? sum / n : 0);
  }
  const maxA = Math.max(...raw, 1e-6);
  return raw.map((a, m) => ({
    straightness: 1 - a / maxA,
    lenFrac: 1 / N_MINI,
    sector: Math.floor(m / (N_MINI / N_SECTOR)),
  }));
}
export const MINI = buildMini();

export function sampleAt(lapFrac) {
  const f = ((lapFrac % 1) + 1) % 1;
  const mini = Math.min(N_MINI - 1, Math.floor(f * N_MINI));
  return { mini, sector: MINI[mini].sector, straightness: MINI[mini].straightness };
}

export function miniSplits(lapTime, car) {
  const avgS = MINI.reduce((a, m) => a + m.straightness * m.lenFrac, 0);
  const carAvg = car.power * avgS + car.aero * (1 - avgS);
  return MINI.map(m => {
    const localPace = car.power * m.straightness + car.aero * (1 - m.straightness);
    const fit = 1 - FIT_K * (localPace - carAvg);
    return lapTime * m.lenFrac * fit;
  });
}
```
with (the SAME math, now over a passed outline; `mini` carried on the track):
```js
// turn angle at vertex i of a flat outline's point array (0 = straight, up to PI = hairpin).
function turnAngle(PTS, i) {
  const NP = PTS.length, a = PTS[(i - 1 + NP) % NP], b = PTS[i], c = PTS[(i + 1) % NP];
  const v1x = b[0] - a[0], v1y = b[1] - a[1], v2x = c[0] - b[0], v2y = c[1] - b[1];
  const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
  if (m1 < 1e-9 || m2 < 1e-9) return 0;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (m1 * m2)));
  return Math.acos(cos);
}

// 18 mini-sectors from a flat outline [x0,y0,...]: per-sector straightness (1=straight, 0=tightest),
// equal lenFrac, sector 0/1/2. Pure — used by the default track and by trackFromEdited. (Unchanged math.)
export function buildMini(outline) {
  const PTS = [];
  for (let i = 0; i < outline.length; i += 2) PTS.push([outline[i], outline[i + 1]]);
  const NP = PTS.length, per = NP / N_MINI, raw = [];
  for (let m = 0; m < N_MINI; m++) {
    let sum = 0, n = 0;
    for (let i = Math.floor(m * per); i < Math.floor((m + 1) * per); i++) { sum += turnAngle(PTS, i); n++; }
    raw.push(n ? sum / n : 0);
  }
  const maxA = Math.max(...raw, 1e-6);
  return raw.map((a, m) => ({ straightness: 1 - a / maxA, lenFrac: 1 / N_MINI, sector: Math.floor(m / (N_MINI / N_SECTOR)) }));
}

// locate a car on the track's mini-sectors. `track.mini` is the buildMini() array.
export function sampleAt(track, lapFrac) {
  const f = ((lapFrac % 1) + 1) % 1, mini = Math.min(N_MINI - 1, Math.floor(f * N_MINI)), M = track.mini[mini];
  return { mini, sector: M.sector, straightness: M.straightness };
}

// distribute a lap time across the track's mini-sectors by the car's power(straights)/aero(corners) fit.
export function miniSplits(track, lapTime, car) {
  const MINI = track.mini;
  const avgS = MINI.reduce((a, m) => a + m.straightness * m.lenFrac, 0);
  const carAvg = car.power * avgS + car.aero * (1 - avgS);
  return MINI.map(m => {
    const localPace = car.power * m.straightness + car.aero * (1 - m.straightness);
    return lapTime * m.lenFrac * (1 - FIT_K * (localPace - carAvg));
  });
}
```
(`N_MINI`/`N_SECTOR` consts stay. The `import { TRACK_PATH, FIT_K }` line: `TRACK_PATH` is no longer used in track.js — change it to `import { FIT_K } from "./data.js";`. Removing the `MINI`/`PTS`/`NP` module globals is intentional.)

- [ ] **Step 4: Thread `this.track` through `src/sim.js`**

Change the track.js import (line 6) — drop `MINI`:
```js
import { miniSplits, N_MINI, sampleAt } from "./track.js";
```
Update the four call sites (all are inside `Race` methods, so `this.track` is available):
- Line ~233: `const s = sampleAt(me.lapFrac).straightness;` → `const s = sampleAt(this.track, me.lapFrac).straightness;`
- Line ~251: `zoneFor(this.track.overtake_zones, sampleAt(me.lapFrac).mini)` → `zoneFor(this.track.overtake_zones, sampleAt(this.track, me.lapFrac).mini)`
- Line ~361: `const sp = miniSplits(c.lastLap, c.car);` → `const sp = miniSplits(this.track, c.lastLap, c.car);`
- Line ~369: `sectors[MINI[i].sector] += t;` → `sectors[this.track.mini[i].sector] += t;`

(`N_MINI` stays used at ~27/46/363/364 — keep it imported. Grep `\bMINI\b` in sim.js afterward: only `this.track.mini` should remain.)

- [ ] **Step 5: Run tests**

Run: `node --test tests/track.test.js` → PASS.
Run: `node --test` → the FULL suite must stay green (this is the Barcelona-unchanged behavioural proof — `sim.test.js` runs many full Barcelona races and asserts corridors; if `buildMini(TRACK_PATH)` differed, they'd fail). Note the suite is slow (~8-15 min); wait for it. If `sim.test.js` alone times out under load, re-run it alone to confirm.

- [ ] **Step 6: Commit**

```bash
git add src/track.js src/sim.js tests/track.test.js
git commit -m "refactor(apexweb): parameterize track.js mini-sectors (buildMini(outline), mini on the track object); sim threads this.track — Barcelona unchanged" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `track_build.js` — build the race-track object

**Files:** Create `src/track_build.js`; Test `tests/track_build.test.js`.

- [ ] **Step 1: Write the failing test**

Create `tests/track_build.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { TRACK, TRACK_PATH } from "../src/data.js";
import { buildMini } from "../src/track.js";
import { defaultRaceTrack, trackFromEdited } from "../src/track_build.js";

test("defaultRaceTrack: Barcelona + its mini", () => {
  const t = defaultRaceTrack();
  assert.equal(t.name, TRACK.name);
  assert.equal(t.lt, TRACK.lt);
  assert.deepEqual(t.mini, buildMini(TRACK_PATH));
});

test("trackFromEdited: inherits Barcelona defaults, applies zones + pitLoss, builds mini from the points", () => {
  const edited = {
    name: "Моя",
    points: [0.1, 0.1, 0.9, 0.1, 0.9, 0.9, 0.1, 0.9],   // a square-ish loop
    zones: [{ sectors: [0, 1], ease: 0.5, type: "brake" }],
    pitLoss: 19.5,
  };
  const t = trackFromEdited(edited);
  assert.equal(t.name, "Моя");
  assert.equal(t.lt, TRACK.lt, "non-authored stat inherits Barcelona");
  assert.equal(t.laps, TRACK.laps);
  assert.equal(t.pit, 19.5, "pitLoss -> track.pit");
  assert.deepEqual(t.overtake_zones, edited.zones);
  assert.equal(t.mini.length, 18);
  assert.ok(t.mini.every(m => m.straightness >= 0 && m.straightness <= 1));
});

test("trackFromEdited: no pitLoss -> inherits base pit", () => {
  const t = trackFromEdited({ points: [0, 0, 1, 0, 1, 1, 0, 1] });
  assert.equal(t.pit, TRACK.pit);
  assert.deepEqual(t.overtake_zones, []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/track_build.test.js` → FAIL (cannot resolve `../src/track_build.js`).

- [ ] **Step 3: Implement `src/track_build.js`**

```js
// ApexWeb/src/track_build.js — build the sim's race-track object. Either the default (Barcelona +
// its mini) or one from an edited track record (geometry -> mini, authored zones/pit; the rest
// inherits Barcelona). Pure. The sim reads track.mini (Task 1) + overtake_zones + pit.
import { TRACK, TRACK_PATH } from "./data.js";
import { buildMini } from "./track.js";
import { splinePath } from "./geom3d.js";

// the default race track (Barcelona) with its mini attached.
export function defaultRaceTrack() { return { ...TRACK, mini: buildMini(TRACK_PATH) }; }

// build a sim track from an edited track record {points, zones, pitLoss, ...}. The sparse control
// points are densified via splinePath so buildMini's per-vertex angle is smooth. Non-authored stats
// (lt/pw/df/ot/abr/sc/wet/laps) inherit Barcelona (`base`).
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

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/track_build.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/track_build.js tests/track_build.test.js
git commit -m "feat(apexweb): track_build — defaultRaceTrack + trackFromEdited (sim track from an edited record)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: an edited-track race is sane + deterministic (the balance/determinism gate)

**Files:** Create `tests/sim_edited_track.test.js`.

- [ ] **Step 1: Write the test**

Create `tests/sim_edited_track.test.js` (mirrors `tests/sim.test.js`'s field/Race pattern):
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { Race } from "../src/sim.js";
import { TEAMS } from "../src/data.js";
import { driverAttrs } from "../src/team.js";
import { trackFromEdited } from "../src/track_build.js";

function field() {                                   // 22-car grid (same shape sim.test.js builds)
  let idx = 0;
  return TEAMS.flatMap(t => t.drivers.map(d => ({
    idx: idx++, abbrev: d.abbrev, skill: d.skill, attrs: driverAttrs(d), car: t.car,
    engine: "std", pace: "std", setupBonus: 0, player: null,
  })));
}
// a twisty oval-ish edited track (sparse control points), with a brake zone + pit loss.
const EDITED = {
  name: "Тест-овал",
  points: (() => { const a = []; for (let i = 0; i < 14; i++) { const t = i / 14 * Math.PI * 2; a.push(0.5 + 0.4 * Math.cos(t), 0.5 + 0.18 * Math.sin(t)); } return a; })(),
  zones: [{ sectors: [3, 4], ease: 0.5, type: "brake" }],
  pitLoss: 20,
};
function runToFinish(seed) {
  const r = new Race(field(), trackFromEdited(EDITED), seed);
  let guard = 0; while (!r.finished && guard++ < 500000) r.step();
  return r;
}

test("edited-track race completes with sane, finite results", () => {
  const r = runToFinish(7);
  assert.ok(r.finished, "race finished");
  const ord = r.order();
  assert.equal(ord.length, 22);
  for (const c of ord) assert.ok(Number.isFinite(c.lap + c.lapFrac), `finite progress for ${c.abbrev}`);
});

test("edited-track race is deterministic (same seed -> identical finishing order)", () => {
  const a = runToFinish(7).order().map(c => c.abbrev);
  const b = runToFinish(7).order().map(c => c.abbrev);
  assert.deepEqual(a, b);
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `node --test tests/sim_edited_track.test.js`
Expected: PASS (the bridge + track_build let the sim race the edited geometry; deterministic).
(If `field()` needs a property the sim requires that this minimal builder omits — e.g. a setup array — match `tests/sim.test.js`'s `field()` exactly; read it and copy the missing fields.)

- [ ] **Step 3: Commit**

```bash
git add tests/sim_edited_track.test.js
git commit -m "test(apexweb): an edited-track race is sane + deterministic (Шаг-2 gate)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: main.js — `ctx.track` parameterization + quick-race entry + boot flag

**Files:** Modify `src/main.js`. Integration — `node --check` + `node --test` + owner F5.

The sim already gets a track object; this routes a chosen track into it. The default path uses `defaultRaceTrack()` (Barcelona — identical to today); the quick-race uses `trackFromEdited`.

- [ ] **Step 1: Imports**

Add to `src/main.js`'s imports:
```js
import { defaultRaceTrack, trackFromEdited } from "./track_build.js";
import { loadAll } from "./track_store.js";
```

- [ ] **Step 2: Default `ctx.track` at game start**

In `startSolo()`, set the default track before the weekend runs. Find:
```js
export function startSolo() {
  ctx.role = "host"; ctx.myPlayer = "p1"; ctx.solo = true; ctx.net = null;
  ctx.weekend.solo = true;
  requestAnimationFrame(hostLoop);
  ctx.weekend.start();
}
```
Replace with:
```js
export function startSolo() {
  ctx.role = "host"; ctx.myPlayer = "p1"; ctx.solo = true; ctx.net = null;
  ctx.track = ctx.track || defaultRaceTrack();   // default Barcelona (with mini) unless a quick-race set it
  ctx.weekend.solo = true;
  requestAnimationFrame(hostLoop);
  ctx.weekend.start();
}
```
Also set the default in the online host entry point if one exists (search for where `ctx.role = "host"` is set for online play, e.g. a `createRoom`/`startHost` function — add the same `ctx.track = ctx.track || defaultRaceTrack();` line there so online races also have a track object). If unsure, add a safety default at the top of `startRaceHost` (Step 3) — it covers all paths.

- [ ] **Step 3: Swap `TRACK` → `ctx.track` in the race path**

In `startRaceHost()` and `buildField()` and the pit-recommendation, replace the `TRACK` reads (lines ~149, 153, 156, 169, 202) with `ctx.track`, and default it at the top of `startRaceHost`:
- At the very top of `startRaceHost()` (after `const field = buildField();`): add `ctx.track = ctx.track || defaultRaceTrack();`
- `new Race(field, TRACK, ctx.seed, …)` → `new Race(field, ctx.track, ctx.seed, …)`
- `buildGrid(field.map(f => ({ ...f, risk: 0.5 })), TRACK, 1234)` → `…, ctx.track, 1234)`
- `c.lapFrac = -slot * (GRID_GAP / TRACK.lt)` → `… / ctx.track.lt`
- In `buildField()`: `trackIdeal(TRACK.laps * 1000 + Math.round(TRACK.lt))` → `trackIdeal((ctx.track || TRACK).laps * 1000 + Math.round((ctx.track || TRACK).lt))`
- In the pit-recommendation (~202): `Math.ceil(TRACK.laps / st)` → `Math.ceil((ctx.track || TRACK).laps / st)`

(Keep `TRACK` imported — it's the fallback in `(ctx.track || TRACK)`.)

- [ ] **Step 4: `startQuickRace` + boot flag**

Add a quick-race entry (near `startSolo`):
```js
// quick race straight onto an edited track (from the editor's 🏁 button) — skip lobby/practice/quali.
export function startQuickRace(edited) {
  ctx.role = "host"; ctx.myPlayer = "p1"; ctx.solo = true; ctx.net = null;
  ctx.track = trackFromEdited(edited);
  ctx.trackName = edited.name || null;            // 3D/minimap reads the edited circuit by name
  ctx.weekend.solo = true;
  requestAnimationFrame(hostLoop);
  ctx.weekend._goto("race");                      // jump to the race phase (fires onPhase -> startRaceHost)
}
```
(Why `_goto("race")` works: `ctx.weekend.onPhase` is assigned at module init — `main.js:93` — *before* this boot-check runs; it calls `onPhaseHost()` which runs `startRaceHost()` when `phase==="race"` (`main.js:143`). `startQuickRace` sets `ctx.role="host"` + `ctx.net=null` first, so `onPhaseHost` fires and nothing is broadcast.)
Replace the bottom boot line `rerender();` with a flag check:
```js
const _quick = (typeof localStorage !== "undefined") ? localStorage.getItem("apexweb_race_track") : null;
if (_quick) {
  localStorage.removeItem("apexweb_race_track");
  const saved = loadAll()[_quick];
  if (saved && Array.isArray(saved.points) && saved.points.length >= 8) startQuickRace({ name: _quick, ...saved });
  else rerender();                                // stale flag -> normal boot
} else { rerender(); }
```

- [ ] **Step 5: Verify**

Run: `node --check src/main.js` → exit 0.
Run: `node --test` → green (the sim/track tests pass; main.js isn't test-imported). Grep `grep -n "ctx.track\|startQuickRace\|apexweb_race_track" src/main.js` shows the new wiring.
(The quick-race boot + race screen are runtime/DOM → owner F5 after Task 5.)

- [ ] **Step 6: Commit**

```bash
git add src/main.js
git commit -m "feat(apexweb): main.js routes a chosen track into the sim (ctx.track) + startQuickRace boot from the editor flag" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: editor — "🏁 Гонять" button + handoff

**Files:** Modify `editor.html`, `src/ui/editor.js`. DOM → `node --check` + owner F5 (the full editor→race loop).

- [ ] **Step 1: editor.html — the button**

Find the drive-button row:
```html
  <div class="row"><button id="drive">▶ Прокатить</button></div>
```
Add immediately AFTER it:
```html
  <div class="row"><button id="race" style="width:100%;background:#2d7a3a;border-color:#3da050">🏁 Гонять (сим)</button></div>
```

- [ ] **Step 2: editor.js — wire it (save, flag, navigate)**

Add near the other toolbar wiring (e.g. after the `drive` button handler):
```js
document.getElementById("race").onclick = () => {       // race the current track in the sim
  saveTrack(name, { points: toFlat(pts), objects, pit, pitLoss, zones, cornerOverrides });   // persist first
  localStorage.setItem("apexweb_race_track", name);     // main.js picks this up on boot
  location.href = "index.html";
};
```

- [ ] **Step 3: Verify**

Run: `node --check src/ui/editor.js` → exit 0. Run: `node --test` → green.
Owner F5: in `editor.html` author a track (drag corners, paint a zone, set pit) → **🏁 Гонять** → the game boots straight into a race on that track; overtakes cluster at your painted zone; pit loss = your value. (Preview-MCP can confirm the editor button exists + clicking it sets the flag + navigates.)

- [ ] **Step 4: Commit**

```bash
git add editor.html src/ui/editor.js
git commit -m "feat(apexweb): editor 🏁 Гонять — race the current edited track in the sim (localStorage handoff)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: README + final verification

**Files:** Modify `ApexWeb/README.md`.

- [ ] **Step 1: README**

In `ApexWeb/README.md`, extend the `## Редактор трассы` section — add a sentence at its end:
```markdown
**🏁 Гонять (сим)** — гонка прямо на твоей трассе: её повороты/прямые определяют, где случаются
обгоны (слипстрим/грязный воздух + твои зоны), пит-потеря = твоё значение. Базовый темп круга пока
от Барселоны (геометрия влияет на бой, не на чистый темп — это следующий шаг).
```

- [ ] **Step 2: Final verification**

Run: `node --check src/main.js src/ui/editor.js src/track.js src/track_build.js src/sim.js` → all exit 0.
Run: `node --test` → full suite green (incl. the new track_build + sim_edited_track tests; Barcelona unchanged).
Owner F5 end-to-end: author → 🏁 Гонять → race on the edited track; the DEFAULT solo race (lobby→…→race) is unchanged.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(apexweb): editor 🏁 Гонять (sim races your edited track) in README" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (against the spec)

- Bridge — track.js parameterized, mini on the track, sim threads it: Task 1. Barcelona-unchanged invariant (`buildMini(TRACK_PATH)`==ref) tested + full suite. ✓
- `trackFromEdited`/`defaultRaceTrack`: Task 2. ✓
- Combat (not base pace) uses geometry — `sampleAt(this.track,…)` at the combat sites only; `_lapTime` untouched. ✓ (spec's corrected claim)
- Quick-race flow (editor flag → main.js boot → race, skip lobby/practice/quali via `_goto("race")` + buildGrid fallback): Task 4 + 5. ✓
- Determinism + sanity gate: Task 3. ✓
- Опт-ин / default unchanged: `ctx.track` defaults to `defaultRaceTrack()` (Barcelona) on the normal path. ✓
- Out of scope (online edited tracks, cornerOverrides→pw/df, derived stats, lobby picker, FastF1) — not implemented. ✓
- Type/name consistency: `buildMini(outline)`, `sampleAt(track,frac)`, `miniSplits(track,lapTime,car)`, `defaultRaceTrack()`, `trackFromEdited(edited)`, `ctx.track`, `startQuickRace(edited)`, localStorage key `apexweb_race_track` — consistent across tasks. ✓
```
