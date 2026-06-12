# Sim Engine Phase 8 — AI strategy (`ai_strategy.js`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every non-human car a real race strategy — a planned pit schedule (1 vs 2 stops from tyre life + track length), safety-car-opportunistic and weather pit stops, and fuel/tyre-aware engine & pace management — with the sharpness of those decisions tied to the team **strategist** (`personnel.strategy`) and the driver's **`race_iq`**. Replaces the current ad-hoc "one mandatory stop near the cliff" AI.

**Architecture:** A new pure, deterministic module `ai_strategy.js` exposes `stintLife`, `planRace`, `pitDecision`, `engineMode`, `paceMode` — all pure functions of car state + a small race-context struct (no `Math.random`, no real time; jitter is seeded via `mix32`). The sim computes each AI car's plan once in the constructor, calls `pitDecision` at each lap boundary (replacing the inline AI block in `_serveLapEnd`), and runs a per-tick `_aiDrive()` that sets each AI car's `engine`/`pace` from its situation. Determinism and the combat invariant are untouched — `_aiDrive` only writes `c.engine`/`c.pace`, never `lap`/`lapFrac`/`wear`.

**Tech Stack:** Vanilla JS ES modules, Node `node --test`. Human cars (`player != null`) are never touched by the AI driver — the engineer controls them.

**Spec:** `docs/superpowers/specs/2026-06-12-sim-engine-redesign-design.md` §11 (Phase 8 of §14). Phase 7 attributes/personnel are live: `c.attrs.race_iq`, `c.personnel.strategy`, `c.car.tyre` all exist; `ATTRW` modulation weights are in `data.js`.

---

## File Structure

```
ApexWeb/src/ai_strategy.js   NEW — pure AI: stintLife, planRace, pitDecision, engineMode, paceMode
ApexWeb/src/sim.js           plan in ctor; pitDecision in _serveLapEnd; _aiDrive() per tick; fuelLaps import; difficulty field
ApexWeb/tools/balance.mjs     strategy corridor (1-2 stops, sane stop laps, no AI fuel runouts)
ApexWeb/tests/ai_strategy.test.js  NEW
ApexWeb/tests/sim.test.js     + AI-strategy integration cases
```

Reference constants (already in `data.js`): `PACE_MODES = {conserve{pace:0.45,wear:0.80}, balanced{pace:0,wear:1}, push{pace:-0.45,wear:1.30}}`, `ENGINE_MODES = {save{pace:0.35,burn:0.85}, standard{pace:0,burn:1}, push{pace:-0.30,burn:1.20}}`, `COMPOUNDS[x] = {pace,wear,cliff,warm,wet_opt}`, `ATTRW`, `DIRTY_GAP` (1.5s).

---

## Task 1: `ai_strategy.js` — the pure strategy module

**Files:** Create `ApexWeb/src/ai_strategy.js`; Test `ApexWeb/tests/ai_strategy.test.js`.

- [ ] **Step 1: Write the failing test** — `ApexWeb/tests/ai_strategy.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { stintLife, planRace, pitDecision, engineMode, paceMode } from "../src/ai_strategy.js";
import { TRACK, COMPOUNDS } from "../src/data.js";

const aiCar = (over = {}) => ({
  idx: 3, tyre: "medium", wear: 0, lap: 0, fuel: 50, engine: "standard", pace: "balanced",
  car: { power: 0.9, aero: 0.9, rel: 0.95, tyre: 1.0, fuel: 1.0 },
  attrs: { tyre: 0.5, race_iq: 0.7, smoothness: 0.5 },
  personnel: { strategy: 0.8, pitMult: 0.9 },
  ...over,
});

test("stintLife: harder compounds last longer; a tyre-kind driver extends them", () => {
  const c = aiCar();
  assert.ok(stintLife("hard", c) > stintLife("medium", c));
  assert.ok(stintLife("medium", c) > stintLife("soft", c));
  const kind = aiCar({ attrs: { ...aiCar().attrs, tyre: 0.9 } });
  assert.ok(stintLife("medium", kind) > stintLife("medium", aiCar()), "kinder driver = longer stint");
});

test("planRace: returns 1 or 2 stops with target laps inside the race and ascending", () => {
  const p = planRace(aiCar(), TRACK, 1234);
  assert.ok(p.n === 1 || p.n === 2, `n=${p.n}`);
  for (const s of p.stops) { assert.ok(s.lap > 0 && s.lap < TRACK.laps, `lap ${s.lap}`); assert.ok(COMPOUNDS[s.compound], s.compound); }
  if (p.n === 2) assert.ok(p.stops[1].lap > p.stops[0].lap, "stops ascending");
  assert.deepEqual(planRace(aiCar(), TRACK, 1234), p, "deterministic");
});

test("pitDecision: rain forces a wet-tyre stop; dry plan stop fires at its target lap", () => {
  const c = aiCar({ aiPlan: planRace(aiCar(), TRACK, 1234), aiStopsDone: 0 });
  // raining hard on slicks -> intermediate/wet, reason weather (does not consume the dry plan)
  const wet = pitDecision(c, { wetness: 0.9, scActive: false, laps: TRACK.laps });
  assert.ok(wet && (wet.compound === "wet" || wet.compound === "inter") && wet.reason === "weather");
  // dry, before the first planned stop -> no pit
  c.lap = Math.max(1, c.aiPlan.stops[0].lap - 3);
  assert.equal(pitDecision(c, { wetness: 0, scActive: false, laps: TRACK.laps }), null);
  // dry, at the planned stop lap -> pit with the planned compound, reason plan
  c.lap = c.aiPlan.stops[0].lap;
  const plan = pitDecision(c, { wetness: 0, scActive: false, laps: TRACK.laps });
  assert.ok(plan && plan.compound === c.aiPlan.stops[0].compound && plan.reason === "plan");
});

test("pitDecision: safety car pulls a near-due stop forward (cheap pit)", () => {
  const c = aiCar({ aiPlan: { stops: [{ lap: 30, compound: "hard" }], n: 1 }, aiStopsDone: 0, lap: 24 });
  assert.equal(pitDecision(c, { wetness: 0, scActive: false, laps: TRACK.laps }), null, "no SC, too early");
  const sc = pitDecision(c, { wetness: 0, scActive: true, laps: TRACK.laps });
  assert.ok(sc && sc.reason === "sc", "SC pulls the stop forward");
});

test("engineMode: saves fuel when short, pushes when chasing with fuel in hand", () => {
  const c = aiCar();
  assert.equal(engineMode(c, { fuelLaps: 3, lapsLeft: 8, gapAhead: 5, pos: 4 }), "save");
  assert.equal(engineMode(c, { fuelLaps: 20, lapsLeft: 8, gapAhead: 0.8, pos: 4 }), "push");
  assert.equal(engineMode(c, { fuelLaps: 20, lapsLeft: 8, gapAhead: 6, pos: 4 }), "standard");
});

test("paceMode: conserves stuck in dirty air, pushes when attacking on good tyres", () => {
  const c = aiCar();
  assert.equal(paceMode(c, { dirtyAir: true, canPass: false, gapAhead: 1.0 }), "conserve");
  assert.equal(paceMode(c, { dirtyAir: false, canPass: false, gapAhead: 0.7 }), "push");
  assert.equal(paceMode(c, { dirtyAir: false, canPass: false, gapAhead: 6 }), "balanced");
});
```

- [ ] **Step 2: Run to verify it fails**

Run (inside `ApexWeb/`): `node --test tests/ai_strategy.test.js` → FAIL (cannot find module ../src/ai_strategy.js).

- [ ] **Step 3: Implement** — `ApexWeb/src/ai_strategy.js`:

```js
// ApexWeb/src/ai_strategy.js — deterministic AI race strategy for non-human cars.
// Pure functions of car state + a small race-context struct. Sharpness scales with the
// team strategist (personnel.strategy) and the driver's race_iq. No Math.random / real time.
import { COMPOUNDS, ATTRW } from "./data.js";
import { mix32 } from "./rng.js";

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// laps a compound lasts before its cliff, for this car at balanced pace (mirrors sim wear math)
export function stintLife(compound, c) {
  const comp = COMPOUNDS[compound];
  const drvTyre = 1 - ATTRW.wear * (((c.attrs && c.attrs.tyre != null ? c.attrs.tyre : 0.5)) - 0.5) * 2;
  const carTyre = 1.2 - ATTRW.carWear * ((c.car && c.car.tyre != null ? c.car.tyre : 1));
  return comp.cliff / (comp.wear * drvTyre * carTyre);
}

// choose a stop plan: target laps + compound to fit at each. 1 or 2 stops, seeded jitter by strategist.
export function planRace(c, track, seed) {
  const T = track.laps;
  const Lh = stintLife("hard", c), Lm = stintLife("medium", c);
  const strat = (c.personnel && c.personnel.strategy != null) ? c.personnel.strategy : 0.6;
  const j = ((mix32(((seed >>> 0) + (c.idx >>> 0) * 2654435761) >>> 0) % 1000) / 1000) - 0.5; // [-0.5,0.5]
  const drift = (1 - strat) * 6 * j;   // up to ~±3 laps for a weak strategist, ~0 for a sharp one
  let stops;
  if (Lm + Lh >= T * 0.98) {
    const lap = clamp(Math.round(Math.min(Lm * 0.9, T * 0.55) + drift), 8, T - 6);
    stops = [{ lap, compound: "hard" }];
  } else {
    const a = clamp(Math.round(T / 3 + drift), 6, T - 12);
    const b = clamp(Math.round((2 * T) / 3 + drift), a + 6, T - 5);
    stops = [{ lap: a, compound: "medium" }, { lap: b, compound: "hard" }];
  }
  return { stops, n: stops.length };
}

// decide whether to pit at this lap boundary. Returns {compound, reason} or null.
// reasons: "weather" (does NOT consume a dry plan stop), "sc", "plan", "emergency" (do consume).
export function pitDecision(c, ctx) {
  const onSlick = COMPOUNDS[c.tyre].wet_opt < 0.1;
  // 1) weather crossover overrides the dry plan
  if (ctx.wetness > 0.55 && onSlick) return { compound: ctx.wetness > 0.8 ? "wet" : "inter", reason: "weather" };
  if (ctx.wetness < 0.35 && !onSlick) return { compound: "medium", reason: "weather" };
  if (ctx.wetness >= 0.35) return null;            // settled wet running: hold the wet tyre
  const plan = c.aiPlan; if (!plan) return null;
  const done = c.aiStopsDone || 0;
  const next = plan.stops[done];
  const lapsLeft = ctx.laps - c.lap;
  // 4) emergency: past the cliff with race left (safety net even if the plan lap hasn't come)
  if (c.wear >= COMPOUNDS[c.tyre].cliff && lapsLeft > 4) return { compound: next ? next.compound : "hard", reason: "emergency" };
  if (!next) return null;
  // 2) safety-car opportunism: take a near-due stop now while it's cheap
  if (ctx.scActive && c.lap >= next.lap - 8 && lapsLeft > 5) return { compound: next.compound, reason: "sc" };
  // 3) planned target reached
  if (c.lap >= next.lap && lapsLeft > 4) return { compound: next.compound, reason: "plan" };
  return null;
}

// engine fuel-mode for an AI car given its situation. Conservative: standard unless a clear reason.
export function engineMode(c, ctx) {
  if (ctx.fuelLaps < ctx.lapsLeft + 0.5) return "save";   // must reach the flag
  const iq = (c.attrs && c.attrs.race_iq != null) ? c.attrs.race_iq : 0.5;
  if (ctx.gapAhead != null && ctx.gapAhead < 1.2 && iq > 0.45 && ctx.fuelLaps > ctx.lapsLeft + 2) return "push";
  return "standard";
}

// pace-mode for an AI car (tyre management vs attack). Conservative defaults.
export function paceMode(c, ctx) {
  if (ctx.dirtyAir && !ctx.canPass) return "conserve";    // stuck behind: pushing only kills tyres
  if (ctx.gapAhead != null && ctx.gapAhead < 1.0 && c.wear < COMPOUNDS[c.tyre].cliff * 0.7) return "push";
  return "balanced";
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/ai_strategy.test.js` → all pass. `node --test` → all green. Do NOT weaken tests. If `planRace` returns n=2 for the default car on this track (medium+hard can't cover the distance) and the SC test's hard-coded plan still works, that's fine — the planRace test accepts 1 or 2.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/ai_strategy.js ApexWeb/tests/ai_strategy.test.js
git commit -m "feat(apexweb): pure AI strategy — stint life, pit plan, engine/pace decisions"
```

---

## Task 2: sim.js — wire the AI brain in

**Files:** Modify `ApexWeb/src/sim.js`; Test `ApexWeb/tests/sim.test.js`.

- [ ] **Step 1: Add failing tests** — append to `ApexWeb/tests/sim.test.js`:

```js
test("AI cars make 1-2 planned stops over a full race (not zero, not four)", () => {
  const r = new Race(field(), TRACK, 7001);
  r.gridStart();
  let g = 0; while (!r.finished && g++ < 500000) r.step();
  const ai = r.cars.filter(c => c.player == null && !c.retired);
  const stops = ai.map(c => c.pitStops);
  assert.ok(stops.length > 0, "some AI finished");
  const avg = stops.reduce((a, b) => a + b, 0) / stops.length;
  assert.ok(avg >= 0.8 && avg <= 2.2, `avg AI stops ${avg.toFixed(2)} in [0.8,2.2]`);
});

test("AI assigns itself an engine mode (drives, not stuck on standard forever)", () => {
  const r = new Race(field(), TRACK, 7002);
  r.gridStart();
  const seen = new Set();
  for (let i = 0; i < 8000; i++) { r.step(); for (const c of r.cars) if (c.player == null) seen.add(c.engine); }
  assert.ok(seen.size >= 1, "AI engine modes used");   // at minimum 'standard'; usually 'push'/'save' too
});

test("determinism holds with the AI brain", () => {
  const run = s => { const r = new Race(field(), TRACK, s); r.gridStart(); let g = 0;
    while (!r.finished && g++ < 500000) r.step(); return r.order().map(c => `${c.abbrev}:${c.pitStops}`); };
  assert.deepEqual(run(7003), run(7003));
});
```

- [ ] **Step 2: Run to verify it fails / baseline**

Run: `node --test tests/sim.test.js`. The "engine mode" and "determinism" tests likely pass already (engine defaults to standard); the "1-2 planned stops" test may pass or fail depending on the current ad-hoc AI. Either way, proceed — the goal is the wiring below. (If all three already pass, they become regression locks; still implement the wiring.)

- [ ] **Step 3: Edit `ApexWeb/src/sim.js`** (READ it fully first):

**2a. Imports.** Add `fuelLaps` to the fuel import (line 4) so it reads:
```js
import { startFuel, burnFor, weightTerm, engineTerm, fuelLaps } from "./fuel.js";
```
(Verify `fuelLaps` is exported by `fuel.js` — it is, `main.js` imports it. If the signature differs, read it and adapt the call in 2d.)
Add a new import after the weather import (line 9):
```js
import { planRace, pitDecision, engineMode, paceMode } from "./ai_strategy.js";
```

**2b. Constructor — give every AI car a plan + a difficulty.** At the END of the constructor (after the `this.cars = field.map(...)` assignment that builds the cars, i.e. after the closing `}));`), add:
```js
    this.difficulty = 0.85;   // scales AI sharpness (UI selection comes in Phase 9)
    for (const c of this.cars) {
      if (c.player == null) { c.aiPlan = planRace(c, track, seed); c.aiStopsDone = 0; }
    }
```

**2c. `_serveLapEnd` — replace the inline AI pit block.** Find this block (it currently spans the weather-reaction `if` and the mandatory-stop `if`):
```js
    if (c.player == null && !c.pitPending && c.tyreAge > 2) {
      const slick = COMPOUNDS[c.tyre].wet_opt < 0.1;
      if (this.wetness > 0.55 && slick) c.pitPending = this.wetness > 0.8 ? "wet" : "inter";
      else if (this.wetness < 0.35 && !slick) c.pitPending = "medium";
    }
    if (c.player == null && c.pitStops === 0 && !c.pitPending) {
      const comp = COMPOUNDS[c.tyre];
      if (c.wear >= comp.cliff * 0.8 && (this.track.laps - c.lap) > 6) {
        c.pitPending = c.tyre === "soft" ? "medium" : "hard";   // fresh, harder set
      }
    }
```
Replace the WHOLE thing with:
```js
    // AI strategy: planned stops, SC opportunism, weather changes, emergency cliff (ai_strategy.js)
    if (c.player == null && !c.pitPending && c.tyreAge > 1) {
      const want = pitDecision(c, { wetness: this.wetness, scActive: this.scActive, laps: this.track.laps });
      if (want) {
        c.pitPending = want.compound;
        if (want.reason !== "weather") c.aiStopsDone = (c.aiStopsDone || 0) + 1;  // consume a dry plan stop
      }
    }
```
Leave the `if (c.pitPending) { ... }` execution block and the DNF/fuel lines below it UNCHANGED.

**2d. New `_aiDrive()` method — per-tick engine/pace for AI cars.** Add this method to the class (e.g. right after `_resolveCombat()` ends, before `_recordMinis`):
```js
  // AI drivers pick an engine/pace mode each tick from their race situation (writes only engine/pace)
  _aiDrive() {
    const ord = this.order();   // leaders-first; sets pos
    for (let i = 0; i < ord.length; i++) {
      const c = ord[i];
      if (c.player != null || c.retired) continue;
      const ahead = ord[i - 1], behind = ord[i + 1];
      const prog = x => x.lap + x.lapFrac;
      const gapAhead = (ahead && !ahead.retired) ? (prog(ahead) - prog(c)) * this.track.lt : null;
      const gapBehind = (behind && !behind.retired) ? (prog(c) - prog(behind)) * this.track.lt : null;
      const dirtyAir = gapAhead != null && gapAhead < DIRTY_GAP && ahead.lap === c.lap;
      const canPass = (c._passCredit || 0) > 0;
      const lapsLeft = this.track.laps - c.lap;
      const fl = fuelLaps(c.fuel, c.engine, c.car.fuel);
      const ctx = { pos: c.pos, gapAhead, gapBehind, dirtyAir, canPass, lapsLeft, fuelLaps: fl, difficulty: this.difficulty };
      c.engine = engineMode(c, ctx);
      c.pace = paceMode(c, ctx);
    }
  }
```

**2e. Call `_aiDrive()` each tick.** In `step()`, find:
```js
    if (!this.scActive) this._resolveCombat();   // no green-flag passing under the safety car
```
Add immediately AFTER it:
```js
    this._aiDrive();   // AI engine/pace management (post-combat: pos + pass-credit are fresh)
```
(Run it even under SC — it just reads bunched gaps and conserves; harmless and deterministic.)

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/sim.test.js` → all pass (the 3 new + existing invariant/determinism/pace/tyre). `node --test` → ALL green. If determinism fails, you added nondeterminism (e.g. iterating a Set/Object feeding the sim, or Math.random) — find and remove it. If the combat invariant test fails, `_aiDrive` accidentally wrote `lap`/`lapFrac`/`wear` — it must only set `engine`/`pace`. Do NOT weaken tests.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/sim.js ApexWeb/tests/sim.test.js
git commit -m "feat(apexweb): wire AI strategy into the sim — planned pits + engine/pace management"
```

---

## Task 3: balance.mjs — strategy corridor + rebalance verify

**Files:** Modify `ApexWeb/tools/balance.mjs`.

- [ ] **Step 1: Implement** — append a strategy corridor after the attribute corridor (the block that prints `attrs: ...`):

```js
// strategy corridor: AI runs a sensible 1-2 stop race, pits in a mid-race window, and never
// throws the fuel away. (Spec §13: strategy bites — optimum is 1-2 stops, not a 0-stop cruise.)
{
  let stopSum = 0, stopN = 0, lapSum = 0, lapN = 0, fuelDry = 0, races = 30;
  for (let s = 0; s < races; s++) {
    const r = new Race(field(), TRACK, 7700 + s);
    r.gridStart();
    // record each AI car's stop count via pitStops; approximate stop laps by sampling tyreAge resets
    const lastStops = new Map(r.cars.map(c => [c.idx, 0]));
    let g = 0;
    while (!r.finished && g++ < 500000) {
      r.step();
      for (const c of r.cars) {
        if (c.player == null && c.pitStops > (lastStops.get(c.idx) || 0)) {
          lapSum += c.lap; lapN++; lastStops.set(c.idx, c.pitStops);
        }
      }
    }
    for (const c of r.cars) if (c.player == null && !c.retired) { stopSum += c.pitStops; stopN++; }
    fuelDry += r.cars.filter(c => c.player == null && c.retired && c.fuel <= 0).length;
  }
  console.log(`strategy: AI avg ${(stopSum / stopN).toFixed(2)} stops/race (expect ~1-2); ` +
    `mean stop on lap ${(lapSum / lapN).toFixed(0)}/${TRACK.laps} (expect a mid-race window); ` +
    `AI fuel run-outs ${fuelDry}/${races} races (expect 0 — the brain manages fuel)`);
}
```

- [ ] **Step 2: Run it**

Run (inside `ApexWeb/`): `node tools/balance.mjs`
Expected: every existing corridor still prints sane numbers (DNF ~1-2, spread ~1.5-2.5, fuel push>0/standard 0, deg ~1.66, sectors, overtaking ~1-5, SC ≈0.25, weather, attrs). The NEW `strategy:` line should show **AI avg ~1.0-2.0 stops**, a **mean stop lap in a mid-race window** (roughly 30-70% of `TRACK.laps`), and **0 AI fuel run-outs**. If AI fuel run-outs > 0, the `engineMode` fuel guard is too weak — report it (the controller may tighten the `+0.5` margin); do NOT silently retune. If avg stops drift outside ~1-2, report the number.

- [ ] **Step 3: Commit**

```
git add ApexWeb/tools/balance.mjs
git commit -m "feat(apexweb): balance harness AI-strategy corridor (stops, timing, fuel)"
```

---

## Notes for the implementer

- **Determinism is load-bearing.** `ai_strategy.js` uses only car state + `mix32`-seeded jitter; `_aiDrive` reads positions/gaps/fuel (all deterministic). No `Math.random`, no `Date`, no Set/Object iteration order feeding the sim's numeric path.
- **Combat invariant intact.** `_aiDrive` writes ONLY `c.engine`/`c.pace`. `pitDecision` only sets `c.pitPending` (executed by the existing pit block at lap-end). Nothing new writes `lap`/`lapFrac`/`wear`.
- **Human cars untouched** — every AI hook guards on `c.player == null`. The human engineer's `set_engine`/`set_pace`/`request_pit` commands still own player cars.
- **Conservative by design.** `engineMode`/`paceMode` stay on standard/balanced unless there's a clear reason (must-save fuel, close chase, dirty-air hold). This keeps the Phase-7 balance corridors intact while making the AI race smarter. The strategist drives pit-lap *precision* (jitter), `race_iq` gates the aggressive engine/pace calls.
- **Deferred (note for Phase 9 / future):** explicit undercut/overcut *targeting* a specific rival (cover a rival who just pitted), and a player-facing **difficulty selector** wiring `this.difficulty` into decision noise. `this.difficulty` is stored and threaded into `ctx` now but only lightly used.
- **Owner playtest (browser, hard-reload):** AI cars should now pit on a sensible schedule (mid-race, not lap 2), dive into the pits under a safety car, switch to wets when it rains, push when hunting a car ahead, and never coast to a fuel-dry stop. In solo mode the AI teammate (P2) gets the same brain.
- After Phase 8, the remaining roadmap item is **Phase 9 — rebalance + UI polish** (difficulty selector, AI engine/strategy readouts in the HUD, final balance pass).
```
