# Sim Engine Phase 5 — Events (start incident + safety car) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add drama and live strategy: a small chance of a **start incident** (a car loses time, rarely retires, on lap 1) and a **safety car** (deterministically scheduled from `track.sc_prob`) that slows everyone, bunches the field into a train, makes pitting cheaper (a strategic window), then restarts after a few laps.

**Architecture:** A pure `events.js` (deterministic rolls from the events RNG: `scheduleSC`, `startIncidentHit`) decides *whether/when*; `sim.js` owns the *state* — schedules the SC lap in the constructor, applies start incidents on the first tick, and runs the SC lifecycle (slow pace via `_lapTime`, field-bunching via a new `_resolveSC` that — like combat — writes only `lapFrac`, cheaper pit in `_serveLapEnd`). The snapshot carries `scActive`; the HUD header shows a SAFETY CAR chip. Determinism holds (the same `erng` stream); the combat invariant is preserved.

**Tech Stack:** Vanilla JS ES modules, Node `node --test`. Driver `starts`/`aggression` attrs are Phase 7 (start-incident is track-prob only for now). Weather is Phase 6.

**Spec:** `docs/superpowers/specs/2026-06-12-sim-engine-redesign-design.md` §9 (Phase 5 of §14).

---

## File Structure

```
ApexWeb/src/data.js     + EVENT consts (start incident + SC tunables)
ApexWeb/src/events.js   NEW — pure: scheduleSC(erng, scProb, laps), startIncidentHit(erng, p)
ApexWeb/src/sim.js      schedule SC; start incidents (first tick); SC lifecycle + slow pace + _resolveSC bunch + cheap pit
ApexWeb/src/main.js     snapshot: + scActive
ApexWeb/src/ui/race.js  header SAFETY CAR chip
ApexWeb/tools/balance.mjs   SC corridor (occurrence ≈ sc_prob; field bunches under SC)
ApexWeb/tests/events.test.js NEW
ApexWeb/tests/sim.test.js   + SC / incident cases
```

---

## Task 1: data.js — event constants

**Files:** Modify `ApexWeb/src/data.js`; Test `ApexWeb/tests/data.test.js`.

- [ ] **Step 1: Add failing test** — append to `ApexWeb/tests/data.test.js`:

```js
import { EVENT } from "../src/data.js";
test("event constants present and sane", () => {
  assert.ok(EVENT.startP > 0 && EVENT.startP < 0.2);
  assert.ok(EVENT.startLoss > 0);
  assert.ok(EVENT.scPaceMult > 1);          // SC laps are slower
  assert.ok(EVENT.scMinLaps >= 1);
  assert.ok(EVENT.scTrainGap > 0);
  assert.ok(EVENT.scPitMult > 0 && EVENT.scPitMult < 1); // pit cheaper under SC
});
```

- [ ] **Step 2: Run to verify it fails**

Run (inside `ApexWeb/`): `node --test tests/data.test.js` → FAIL (`EVENT` undefined).

- [ ] **Step 3: Implement** — add to `ApexWeb/src/data.js` after the overtaking consts (`DIRTY_WEAR`):

```js
// events (Phase 5): start incident + safety car.
export const EVENT = {
  startP:     0.03,  // per-car chance of a lap-1 start incident
  startLoss:  4.0,   // seconds lost in a start incident
  startDnf:   0.15,  // chance a start incident becomes a DNF
  scPaceMult: 1.40,  // everyone laps at 140% under the safety car
  scMinLaps:  3,     // the SC stays out this many leader-laps
  scTrainGap: 0.6,   // seconds between cars in the bunched SC train
  scPitMult:  0.55,  // pit time-loss multiplier under SC (a cheap stop)
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/data.test.js` → PASS. `node --test` → all green.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/data.js ApexWeb/tests/data.test.js
git commit -m "feat(apexweb): event constants — start incident + safety car (phase 5)"
```

---

## Task 2: events.js — pure deterministic rolls

**Files:** Create `ApexWeb/src/events.js`; Test `ApexWeb/tests/events.test.js`.

- [ ] **Step 1: Write the failing test** — `ApexWeb/tests/events.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduleSC, startIncidentHit } from "../src/events.js";
import { RNG } from "../src/rng.js";

test("scheduleSC returns a mid-race lap roughly at the given probability", () => {
  let scCount = 0, sample = null;
  for (let s = 0; s < 400; s++) {
    const lap = scheduleSC(new RNG(s + 1), 0.25, 66);
    if (lap != null) { scCount++; sample = lap; }
  }
  const freq = scCount / 400;
  assert.ok(freq > 0.18 && freq < 0.32, `SC frequency ${freq} should be ~0.25`);
  assert.ok(sample > 0 && sample < 66, `SC lap ${sample} should be inside the race`);
});

test("scheduleSC is deterministic for a seed", () => {
  assert.equal(scheduleSC(new RNG(5), 0.25, 66), scheduleSC(new RNG(5), 0.25, 66));
});

test("startIncidentHit fires near the given probability", () => {
  let hits = 0;
  const r = new RNG(7);
  for (let i = 0; i < 2000; i++) if (startIncidentHit(r, 0.1)) hits++;
  assert.ok(hits / 2000 > 0.06 && hits / 2000 < 0.14, `~0.1 expected, got ${hits / 2000}`);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/events.test.js` → FAIL (cannot find module ../src/events.js).

- [ ] **Step 3: Implement** — `ApexWeb/src/events.js`:

```js
// ApexWeb/src/events.js — pure deterministic event rolls. Draw from the sim's
// events RNG (erng) so a seed reproduces the same race. Driver attrs come in Phase 7.

// decide if/when a safety car happens. Returns the leader-lap it deploys on, or null.
export function scheduleSC(erng, scProb, laps) {
  if (erng.unit() >= scProb) return null;
  // somewhere in the middle of the race (25%..65% distance)
  return Math.max(1, Math.floor(laps * (0.25 + 0.40 * erng.unit())));
}

// per-car lap-1 start-incident roll.
export function startIncidentHit(erng, prob) {
  return erng.unit() < prob;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/events.test.js` → 3 pass. `node --test` → all green.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/events.js ApexWeb/tests/events.test.js
git commit -m "feat(apexweb): pure event rolls (scheduleSC, startIncidentHit)"
```

---

## Task 3: sim.js — start incidents + safety car lifecycle

**Files:** Modify `ApexWeb/src/sim.js`; Test `ApexWeb/tests/sim.test.js`.

- [ ] **Step 1: Add failing tests** — append to `ApexWeb/tests/sim.test.js`:

```js
import { EVENT } from "../src/data.js";

test("a safety car occurs at roughly track.sc_prob across seeds", () => {
  let sc = 0;
  for (let s = 0; s < 200; s++) {
    const r = new Race(field(), TRACK, 7000 + s);
    r.gridStart();
    let g = 0; while (!r.finished && g++ < 500000) r.step();
    if (r.scEverActive) sc++;
  }
  const freq = sc / 200;
  assert.ok(freq > TRACK.sc - 0.12 && freq < TRACK.sc + 0.12, `SC freq ${freq} ~ ${TRACK.sc}`);
});

test("under the safety car the field bunches into a tight train", () => {
  // find a seed that produces an SC, then measure the leader→last gap while SC is active
  let tightObserved = false;
  for (let s = 0; s < 60 && !tightObserved; s++) {
    const r = new Race(field(), TRACK, 7000 + s);
    r.gridStart();
    let g = 0;
    while (!r.finished && g++ < 500000) {
      r.step();
      if (r.scActive) {
        const ord = r.order().filter(c => !c.retired);
        const lead = ord[0], last = ord[ord.length - 1];
        // running cars on the lead lap should be within a few train-gaps
        const sameLap = ord.filter(c => c.lap === lead.lap);
        if (sameLap.length > 4) {
          const spread = (lead.lap + lead.lapFrac) - (sameLap[sameLap.length - 1].lap + sameLap[sameLap.length - 1].lapFrac);
          if (spread * TRACK.lt < EVENT.scTrainGap * sameLap.length + 0.5) tightObserved = true;
        }
      }
    }
  }
  assert.ok(tightObserved, "the SC train should bunch same-lap cars to ~train-gap spacing");
});

test("determinism holds with events", () => {
  const run = s => { const r = new Race(field(), TRACK, s); r.gridStart(); let g = 0;
    while (!r.finished && g++ < 500000) r.step(); return r.order().map(c => c.abbrev); };
  assert.deepEqual(run(7042), run(7042));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/sim.test.js` → FAIL (`r.scActive` / `r.scEverActive` undefined).

- [ ] **Step 3: Apply edits to `ApexWeb/src/sim.js`** (READ first):

**3a.** Add the events import after the overtake import:
```js
import { scheduleSC, startIncidentHit } from "./events.js";
```
Add `EVENT` to the data import line (append it):
```js
import { COMPOUNDS, PACE_MODES, SKILL_K, CAR_K, STEP, DNF_BASE, GRID_GAP, COMBAT_GAP, TYRE, DIRTY_GAP, EVENT } from "./data.js";
```

**3b.** In the constructor, after `this.sessionBestMini = new Array(N_MINI).fill(Infinity);`, schedule the SC and init its state:
```js
    this.scLap = scheduleSC(this.erng, track.sc, track.laps);  // leader-lap it deploys on, or null
    this.scActive = false; this.scEverActive = false; this.scStartLap = 0; this._started = false;
```
(NOTE: the Barcelona track field for safety-car probability is `track.sc` — verify in data.js; it is `sc: 0.25`.)

**3c.** Apply start incidents once, on the very first `step()`. At the TOP of `step(dt = STEP)`, right after `if (this.finished) return;`, add:
```js
    if (!this._started) { this._started = true; this._startIncidents(); }
```
And add the method (place it just before `_resolveSC` which you add in 3e, or before `_serveLapEnd`):
```js
  _startIncidents() {
    for (const c of this.cars) {
      if (startIncidentHit(this.erng, EVENT.startP)) {
        c.lapFrac -= EVENT.startLoss / this.track.lt;          // dropped back at the start
        if (this.erng.unit() < EVENT.startDnf) c.retired = true; // rare: out on the spot
      }
    }
  }
```

**3d.** Make `_lapTime` slow under the SC. At the END of `_lapTime`, right before `return s;`, add:
```js
    if (this.scActive) s *= EVENT.scPaceMult;   // everyone crawls behind the safety car
```

**3e.** Add the SC bunching + lifecycle. Add this method (e.g. before `_resolveCombat`):
```js
  // bunch same-lap running cars into a tight train behind the leader (writes only lapFrac)
  _resolveSC() {
    if (!this.scActive) return;
    const ord = this.order();
    for (let i = 1; i < ord.length; i++) {
      const ahead = ord[i - 1], me = ord[i];
      if (me.retired || ahead.retired || me.lap !== ahead.lap) continue;
      const minBehind = ahead.lapFrac - EVENT.scTrainGap / this.track.lt;
      if (me.lapFrac < minBehind) me.lapFrac = minBehind;   // catch up into the train (forward only)
    }
  }
```
And in `step()`, gate combat on "no SC" and add the SC lifecycle + bunch. The current end of the per-car loop is:
```js
    this._resolveCombat();
    if (this.cars.every(c => c.retired || c.lap >= this.track.laps)) this.finished = true;
```
Change it to (combat is suspended under yellow; the SC train + lifecycle run instead):
```js
    if (!this.scActive) this._resolveCombat();   // no green-flag passing under the safety car
    // safety-car lifecycle, driven by the leader's lap count
    const leadLap = this.cars.reduce((m, c) => Math.max(m, c.lap), 0);
    if (this.scLap != null && !this.scActive && !this.scEverActive && leadLap >= this.scLap) {
      this.scActive = true; this.scEverActive = true; this.scStartLap = leadLap;
    }
    if (this.scActive && leadLap >= this.scStartLap + EVENT.scMinLaps) this.scActive = false;
    this._resolveSC();
    if (this.cars.every(c => c.retired || c.lap >= this.track.laps)) this.finished = true;
```

**3f.** Make pitting cheaper under the SC. In `_serveLapEnd`, the pit block currently does `c.totalTime += this.track.pit;` and `c.lapFrac -= this.track.pit / this.track.lt;`. Change BOTH `this.track.pit` references to an SC-aware loss. Replace:
```js
      c.pitStops += 1; c.totalTime += this.track.pit;
      c.lapFrac -= this.track.pit / this.track.lt;            // lose pit time on track
```
with:
```js
      const pitLoss = this.track.pit * (this.scActive ? EVENT.scPitMult : 1);
      c.pitStops += 1; c.totalTime += pitLoss;
      c.lapFrac -= pitLoss / this.track.lt;                   // lose pit time on track (cheaper under SC)
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/sim.test.js` → all pass (incl. the 3 new + the existing invariant / faster-car / determinism). `node --test` → all green. The SC-frequency test draws `erng` in the constructor (`scheduleSC`) — this shifts the events stream, so re-running the whole suite confirms nothing else broke. Do NOT weaken tests. If the "field bunches" test can't find a tight train in 60 seeds, raise the seed count in the test loop is NOT allowed — instead re-check `_resolveSC` ordering.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/sim.js ApexWeb/tests/sim.test.js
git commit -m "feat(apexweb): start incidents + safety car (slow pace, bunch train, cheap pit)"
```

---

## Task 4: main.js + race.js — SC in snapshot + HUD chip

**Files:** Modify `ApexWeb/src/main.js`, `ApexWeb/src/ui/race.js`.

- [ ] **Step 1: main.js** — in `raceSnapshot`, add `scActive` to the top-level snapshot object (NOT per-car). The snapshot currently starts:
```js
    type: "snapshot", phase: "race", paused: ctx.paused, finished: ctx.race.finished,
    speed: ctx.speed || 1,
```
Change to:
```js
    type: "snapshot", phase: "race", paused: ctx.paused, finished: ctx.race.finished,
    speed: ctx.speed || 1, scActive: ctx.race.scActive,
```

- [ ] **Step 2: race.js** — in `updateHud`, the header chip line currently reads:
```js
  $("#d-chip").textContent = snap.finished ? "ФИНИШ" : (snap.paused ? "ПАУЗА" : "ГОНКА");
```
Change it so the safety car takes priority:
```js
  $("#d-chip").textContent = snap.finished ? "ФИНИШ" : (snap.scActive ? "🟡 SAFETY CAR" : (snap.paused ? "ПАУЗА" : "ГОНКА"));
```

- [ ] **Step 3: Verify**

Run: `node --check ApexWeb/src/main.js ApexWeb/src/ui/race.js` → OK. `node --test` (inside `ApexWeb/`) → all green.

- [ ] **Step 4: Commit**

```
git add ApexWeb/src/main.js ApexWeb/src/ui/race.js
git commit -m "feat(apexweb): snapshot scActive + HUD SAFETY CAR chip"
```

---

## Task 5: balance.mjs — safety-car corridor

**Files:** Modify `ApexWeb/tools/balance.mjs`.

- [ ] **Step 1: Implement** — add to `ApexWeb/tools/balance.mjs` after the overtaking block:

```js
// safety-car corridor: SC occurrence over many races should land near track.sc.
{
  let sc = 0;
  for (let s = 0; s < 60; s++) {
    const r = new Race(field(), TRACK, 9500 + s);
    r.gridStart();
    let g = 0; while (!r.finished && g++ < 500000) r.step();
    if (r.scEverActive) sc++;
  }
  console.log(`safety car: occurred in ${sc}/60 races = ${(sc / 60).toFixed(2)} (expect ~${TRACK.sc})`);
}
```

- [ ] **Step 2: Run it**

Run (inside `ApexWeb/`): `node tools/balance.mjs`
Expected: `safety car: ... ≈ 0.25` (Barcelona `sc=0.25`), within ~±0.12. Confirm the earlier corridors still print sanely (DNF may shift a little because the `erng` stream now also feeds SC scheduling + start incidents — DNF ~1-2 is fine).

- [ ] **Step 3: Commit**

```
git add ApexWeb/tools/balance.mjs
git commit -m "feat(apexweb): balance harness safety-car corridor"
```

---

## Notes for the implementer

- **Combat invariant preserved:** `_resolveSC` writes only `lapFrac` (forward catch-up, same lap), `_startIncidents` writes `lapFrac`/`retired` once at the start. Never assign `lap` outside step()'s phase-3.
- **Determinism intact:** all event rolls draw from `this.erng`; no real time / Math.random. Adding `scheduleSC` in the constructor and `_startIncidents` on tick 1 shifts the `erng` stream — that's fine (still deterministic per seed); just confirm the full suite passes.
- **`track.sc`** is the safety-car probability field on the Barcelona TRACK (`sc: 0.25`) — use `track.sc`, not `sc_prob`.
- **Owner playtest (browser, hard-reload):** sometimes the header flips to "🟡 SAFETY CAR", the whole field slows and bunches into a tight train on the minimap, and pitting right then is cheap — a strategic window. Occasionally a car loses time at the start.
- Next plan: **Phase 6 — weather** (slick↔inter↔wet crossover + drying).
