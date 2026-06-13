# Apex Web — Practice redesign ("run plans") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 4-slider Practice minigame with a shared-budget "run plans" session: spend track-time on setup-tests / long-runs / quali-sims that gather setup + tyre-deg + quali intel, co-op in real time.

**Architecture:** A new pure module `practice.js` runs each run-type off the existing calibrated engine (`tyres.js`/`fuel.js`/`quali.js`) and folds results into a findings board; `main.js` owns the host practice state and a `practice_run` RPC that broadcasts a practice snapshot; `ui/practice.js` renders the shared board + the local setup sliders. Determinism via a seeded practice RNG.

**Tech Stack:** Vanilla JS ES modules, `node --test`, no build. Spec: `docs/superpowers/specs/2026-06-13-apexweb-practice-redesign-design.md`.

**Working dir for all commands:** `C:\Users\Karim\Desktop\Coop motorsport manager game\ApexWeb`

**Commit rule (project):** stage ONLY explicit `ApexWeb/...` pathspecs — never `git add -A`/`.`/`commit -a` (the repo holds the user's parallel WIP). Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File structure

- **Create** `ApexWeb/src/practice.js` — pure: `carMean`, `practiceLapBase`, `runLong`, `runSetupTest`, `runQuali`, `analyzeFindings`, `newPracticeState`, `applyPracticeRun`.
- **Create** `ApexWeb/tests/practice.test.js` — unit tests for all of the above.
- **Modify** `ApexWeb/src/data.js` — add `PRAC_BUDGET`, `PRAC_COST`, `LONG_RUN_LAPS`, `PRAC_SETUP_NOISE`, `PRAC_SIGNAL_K`.
- **Rewrite** `ApexWeb/src/ui/practice.js` — run-picker + sliders + shared findings board, rendering from the practice snapshot.
- **Modify** `ApexWeb/src/main.js` — host practice state, `practice_run` handler + broadcast, seed-on-practice-entry, carry `ctx.practiceFindings` into the race.
- **Modify** `ApexWeb/src/ui/race.js` — small race-HUD aid showing the practice cliff/stop prediction (final task).

---

### Task 1: Practice tuning constants

**Files:**
- Modify: `ApexWeb/src/data.js` (append near the other tuning consts, after `GRID_GAP`)

- [ ] **Step 1: Add the constants**

Append to `ApexWeb/src/data.js`:

```javascript
// Practice "run plans" (§ practice redesign). A shared team track-time budget spent across run types.
export const PRAC_BUDGET = 8;                                   // total track-time units the two co-directors share
export const PRAC_COST   = { setup: 1, long: 3, quali: 1 };     // cost per run type
export const LONG_RUN_LAPS = 10;                                // laps simulated in a long run
export const PRAC_SIGNAL_K = 0.8;                               // setup closeness -> lap-time swing (the readable "feel" gauge)
export const PRAC_SETUP_NOISE = 0.18;                           // s/lap setup-test noise at consistency 0 (scaled by 1-consistency)
```

- [ ] **Step 2: Verify it parses**

Run: `node -e "import('./src/data.js').then(m=>console.log(m.PRAC_BUDGET, JSON.stringify(m.PRAC_COST), m.LONG_RUN_LAPS))"`
Expected: `8 {"setup":1,"long":3,"quali":1} 10`

- [ ] **Step 3: Commit**

```bash
git add ApexWeb/src/data.js
git commit -m "feat(apexweb): practice run-plan constants"
```

---

### Task 2: `practice.js` — `carMean` + `practiceLapBase`

The deterministic lap-time base for a single practice car, mirroring the race `_lapTime`'s non-random terms (skill, absolute car pace, track-character bias, setup). `carMean` is the field mean of `(power+aero)/2` over the real 22-car grid (constant), so the absolute pace matches the race.

**Files:**
- Create: `ApexWeb/src/practice.js`
- Test: `ApexWeb/tests/practice.test.js`

- [ ] **Step 1: Write the failing test**

Create `ApexWeb/tests/practice.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { carMean, practiceLapBase } from "../src/practice.js";
import { TEAMS, TRACK } from "../src/data.js";
import { composeCar } from "../src/team.js";
import { trackIdeal } from "../src/setup.js";

const ideal = trackIdeal(TRACK.laps * 1000 + Math.round(TRACK.lt));
const drv = { skill: 0.90, attrs: { pace: 0.90 } };
const car = composeCar(TEAMS[0].car);   // McLaren

test("carMean is the field mean of (power+aero)/2, ~0.88", () => {
  const m = carMean();
  assert.ok(m > 0.84 && m < 0.92, `carMean ${m}`);
});

test("practiceLapBase: a perfect setup is faster than a bad one, lap ~78-86s", () => {
  const perfect = practiceLapBase(drv, car, ideal, ideal);            // setup == ideal
  const bad     = practiceLapBase(drv, car, [0, 0, 0], ideal);
  assert.ok(perfect < bad, `perfect (${perfect}) faster than bad (${bad})`);
  assert.ok(perfect > 75 && perfect < 88, `lap in range (${perfect})`);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/practice.test.js`
Expected: FAIL — `Cannot find module '../src/practice.js'`.

- [ ] **Step 3: Write the implementation**

Create `ApexWeb/src/practice.js`:

```javascript
// ApexWeb/src/practice.js — Practice "run plans": pure run-sim helpers + the shared findings reducer.
// Reuses the calibrated race engine (tyres/fuel/quali) — NO new balance numbers. Deterministic (seeded).
import { TEAMS, TRACK, SKILL_K, CAR_K, CAR_PACE_K, COMPOUNDS, TYRE,
  LONG_RUN_LAPS, PRAC_COST, PRAC_BUDGET, PRAC_SIGNAL_K, PRAC_SETUP_NOISE } from "./data.js";
import { composeCar } from "./team.js";
import { closeness, paceBonus, feedback, AXES } from "./setup.js";
import { tyreTerm, warmStep } from "./tyres.js";
import { startFuel, weightTerm, burnFor } from "./fuel.js";
import { RNG, mix32 } from "./rng.js";

// field-mean (power+aero)/2 over the real grid — the anchor the absolute car-pace term uses (matches the race).
export function carMean() {
  let s = 0, n = 0;
  for (const t of TEAMS) for (const d of t.drivers) { const c = composeCar(t.car); s += (c.power + c.aero) / 2; n++; }
  return s / n;
}
const A = drv => drv.attrs || { pace: drv.skill };

// deterministic single-car lap base (no race noise/form/AI/SC) — skill + absolute car + track bias + setup.
export function practiceLapBase(drv, car, setup, ideal) {
  let s = TRACK.lt;
  s -= SKILL_K * (A(drv).pace - 0.5);
  s -= CAR_PACE_K * ((car.power + car.aero) / 2 - carMean());
  s -= CAR_K * ((car.power - car.aero) * (TRACK.pw - TRACK.df));
  s += paceBonus(closeness(setup, ideal));   // <=0, faster when set well
  return s;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/practice.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/practice.js ApexWeb/tests/practice.test.js
git commit -m "feat(apexweb): practice.js carMean + practiceLapBase"
```

---

### Task 3: `practice.js` — `runLong` (the tyre-deg long run)

Simulate one car's stint reusing `tyres.js`/`fuel.js`, returning the deg curve + `cliffLap` + recommended stops.

**Files:**
- Modify: `ApexWeb/src/practice.js`
- Test: `ApexWeb/tests/practice.test.js`

- [ ] **Step 1: Write the failing test**

Append to `ApexWeb/tests/practice.test.js`:

```javascript
import { runLong } from "../src/practice.js";

test("runLong: deg rises over the stint and reports a cliffLap + recommendedStops", () => {
  const r = runLong(drv, car, "soft", ideal, ideal, 14, 7);
  assert.equal(r.type, "long");
  assert.equal(r.compound, "soft");
  assert.equal(r.lapTimes.length, 14);
  // later laps are slower than the first few (degradation)
  const early = (r.lapTimes[1] + r.lapTimes[2]) / 2, late = (r.lapTimes[12] + r.lapTimes[13]) / 2;
  assert.ok(late > early + 0.5, `deg over the stint (${early.toFixed(2)} -> ${late.toFixed(2)})`);
  assert.ok(r.stintLaps >= 1 && r.recommendedStops >= 1, "sane stint/stops");
});

test("runLong is deterministic for a seed", () => {
  assert.deepEqual(runLong(drv, car, "medium", ideal, ideal, 10, 3),
                   runLong(drv, car, "medium", ideal, ideal, 10, 3));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/practice.test.js`
Expected: FAIL — `runLong is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `ApexWeb/src/practice.js`:

```javascript
// one car's stint of `laps` laps on `compound`: real tyre deg + warm-up + fuel weight. Returns the curve + cliff.
export function runLong(drv, car, compound, setup, ideal, laps = LONG_RUN_LAPS, seed = 0) {
  const rng = new RNG(mix32((seed >>> 0) + 0x511));
  const base = practiceLapBase(drv, car, setup, ideal);
  const comp = COMPOUNDS[compound];
  let wear = 0, temp = TYRE.gridTemp, fuel = startFuel(TRACK);
  const lapTimes = []; let cliffLap = 0;
  for (let lap = 1; lap <= laps; lap++) {
    const t = base + comp.pace + tyreTerm(compound, wear, temp) + weightTerm(fuel) + rng.noise(0.05);
    lapTimes.push(t);
    if (!cliffLap && wear > comp.cliff) cliffLap = lap;   // first lap past the cliff
    wear += comp.wear; temp = warmStep(temp, compound); fuel -= burnFor("standard", car.fuel);
  }
  // stint length the player would run: to the cliff (or the whole run if the cliff isn't reached)
  const stintLaps = cliffLap || laps;
  const recommendedStops = Math.max(1, Math.ceil(TRACK.laps / Math.max(1, stintLaps)) - 1);
  return { type: "long", compound, lapTimes, cliffLap, stintLaps, recommendedStops };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/practice.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/practice.js ApexWeb/tests/practice.test.js
git commit -m "feat(apexweb): practice runLong — tyre-deg stint sim"
```

---

### Task 4: `practice.js` — `runSetupTest` (noisy) + `runQuali`

Setup-test lap signal carries noise scaled by `(1-consistency)`; feedback clarity scales with `race_iq`. Quali-sim returns a representative pace.

**Files:**
- Modify: `ApexWeb/src/practice.js`
- Test: `ApexWeb/tests/practice.test.js`

- [ ] **Step 1: Write the failing test**

Append to `ApexWeb/tests/practice.test.js`:

```javascript
import { runSetupTest, runQuali } from "../src/practice.js";

test("runSetupTest: signal tracks setup closeness, noise grows as consistency drops", () => {
  const steady  = { skill: 0.9, attrs: { pace: 0.9, consistency: 0.95, race_iq: 0.9 } };
  const jittery = { skill: 0.9, attrs: { pace: 0.9, consistency: 0.10, race_iq: 0.9 } };
  const spread = d => { let lo = 1e9, hi = -1e9; for (let s = 0; s < 40; s++) {
    const v = runSetupTest(d, car, [0.5, 0.5, 0.5], ideal, s).lapTime; lo = Math.min(lo, v); hi = Math.max(hi, v); } return hi - lo; };
  assert.ok(spread(jittery) > spread(steady), "a jittery driver's setup signal is noisier");
  // a better setup still reads faster on average
  const near = runSetupTest(steady, car, ideal, ideal, 1).lapTime, far = runSetupTest(steady, car, [0,0,0], ideal, 1).lapTime;
  assert.ok(near < far, "closer setup reads faster");
});

test("runSetupTest: feedback is clearer for a high race_iq driver", () => {
  const sharp = { skill: 0.9, attrs: { pace: 0.9, consistency: 0.9, race_iq: 0.95 } };
  const vague = { skill: 0.9, attrs: { pace: 0.9, consistency: 0.9, race_iq: 0.10 } };
  const setup = [0.2, 0.5, 0.5];   // axis 0 is clearly off
  const namesAxis0 = (d) => { let hit = 0; for (let s = 0; s < 40; s++) {
    if (runSetupTest(d, car, setup, ideal, s).feedback.startsWith("Прижим")) hit++; } return hit; };
  assert.ok(namesAxis0(sharp) > namesAxis0(vague), "the sharp driver names the right axis more often");
});

test("runQuali returns a representative pace and is deterministic", () => {
  const a = runQuali(drv, car, ideal, ideal, 5), b = runQuali(drv, car, ideal, ideal, 5);
  assert.equal(a.type, "quali");
  assert.ok(a.qualiPace > 74 && a.qualiPace < 86, `quali pace in range (${a.qualiPace})`);
  assert.equal(a.qualiPace, b.qualiPace);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/practice.test.js`
Expected: FAIL — `runSetupTest is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `ApexWeb/src/practice.js`:

```javascript
// a short setup-signal lap (noisy: amp grows as consistency drops) + a feedback line whose clarity scales with race_iq.
export function runSetupTest(drv, car, setup, ideal, seed = 0) {
  const rng = new RNG(mix32((seed >>> 0) + 0x5e2));
  const a = A(drv);
  const cons = a.consistency ?? 0.7, iq = a.race_iq ?? 0.7;
  const base = practiceLapBase(drv, car, setup, ideal);
  // amplify the setup swing for a readable clock; add noise that a jittery driver can't filter out
  const signal = -PRAC_SIGNAL_K * Math.max(0, closeness(setup, ideal)) + paceBonusUndo(setup, ideal);
  const lapTime = base + signal + rng.noise(PRAC_SETUP_NOISE * (1 - cons));
  return { type: "setup", lapTime, closeness: closeness(setup, ideal), feedback: feedbackLine(setup, ideal, iq, rng) };
}
// remove the small race-scale setup bonus already in base, so the amplified PRAC_SIGNAL_K is the only setup term here.
function paceBonusUndo(setup, ideal) { return -paceBonus(closeness(setup, ideal)); }

// feedback whose clarity scales with race_iq: a sharp driver names the worst axis + direction; a vague one may
// blur the direction or just say "balance is off" (so a low-feedback driver is genuinely harder to dial in).
export function feedbackLine(setup, ideal, raceIq, rng) {
  const clear = feedback(setup, ideal);                         // the precise "axis: direction" hint
  if (clear.startsWith("Машина")) return clear;                 // already balanced — always clear
  if (rng.unit() < (raceIq ?? 0.7)) return clear;               // sharp driver: precise
  // vague driver: drop to a non-committal line some of the time
  const ax = AXES[worstAxis(setup, ideal)];
  return rng.unit() < 0.5 ? `Где-то в балансе не то — покрути ещё.` : `${ax.name}: что-то не так.`;
}
function worstAxis(setup, ideal) {
  let w = 0, e = -1; for (let i = 0; i < 3; i++) { const d = Math.abs(setup[i] - ideal[i]); if (d > e) { e = d; w = i; } } return w;
}

// a representative quali pace (low fuel, soft) — the absolute single-lap pace the player would qualify near.
export function runQuali(drv, car, setup, ideal, seed = 0) {
  const rng = new RNG(mix32((seed >>> 0) + 0x901));
  const qualiPace = practiceLapBase(drv, car, setup, ideal) + COMPOUNDS.soft.pace + rng.noise(0.06);
  return { type: "quali", qualiPace };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/practice.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/practice.js ApexWeb/tests/practice.test.js
git commit -m "feat(apexweb): practice runSetupTest (skill) + runQuali"
```

---

### Task 5: `practice.js` — `newPracticeState` + `applyPracticeRun` + `analyzeFindings` (the host reducer)

A pure reducer the host calls: validate the shared budget, run the right helper, append the finding, recompute the board. This makes the host logic unit-testable without a live host.

**Files:**
- Modify: `ApexWeb/src/practice.js`
- Test: `ApexWeb/tests/practice.test.js`

- [ ] **Step 1: Write the failing test**

Append to `ApexWeb/tests/practice.test.js`:

```javascript
import { newPracticeState, applyPracticeRun } from "../src/practice.js";

test("applyPracticeRun spends the budget, appends a finding, and recomputes the board", () => {
  let st = newPracticeState();
  assert.equal(st.spent, 0);
  const r1 = applyPracticeRun(st, { player: "p1", type: "long", compound: "soft", setup: ideal }, drv, car, ideal, 1);
  assert.ok(r1.accepted);
  st = r1.state;
  assert.equal(st.spent, 3);                          // long costs 3
  assert.equal(st.findings.length, 1);
  assert.ok(st.board.degByCompound.soft, "deg recorded for soft");
  assert.ok(st.board.recommendedStops >= 1, "board has recommended stops");
});

test("applyPracticeRun rejects a run that exceeds the budget", () => {
  let st = newPracticeState();
  // spend 8 with quali runs (cost 1) then the 9th is rejected
  for (let i = 0; i < 8; i++) st = applyPracticeRun(st, { player: "p1", type: "quali", setup: ideal }, drv, car, ideal, i).state;
  assert.equal(st.spent, 8);
  const over = applyPracticeRun(st, { player: "p1", type: "quali", setup: ideal }, drv, car, ideal, 99);
  assert.equal(over.accepted, false);
  assert.equal(over.state.spent, 8);                  // unchanged
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/practice.test.js`
Expected: FAIL — `newPracticeState is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `ApexWeb/src/practice.js`:

```javascript
export function newPracticeState() {
  return { budget: PRAC_BUDGET, spent: 0, findings: [], setups: {}, board: analyzeFindings([]) };
}

// host reducer: validate budget, run the chosen type (seeded), append the finding, recompute the board.
export function applyPracticeRun(state, req, drv, car, ideal, seed) {
  const cost = PRAC_COST[req.type] || 1;
  if (state.spent + cost > state.budget) return { accepted: false, state };
  const runId = state.findings.length;
  let result;
  if (req.type === "long")  result = runLong(drv, car, req.compound || "medium", req.setup, ideal, undefined, seed + runId);
  else if (req.type === "quali") result = runQuali(drv, car, req.setup, ideal, seed + runId);
  else result = runSetupTest(drv, car, req.setup, ideal, seed + runId);
  const findings = [...state.findings, { runId, player: req.player, ...result }];
  return { accepted: true, state: { ...state, spent: state.spent + cost, findings, board: analyzeFindings(findings) } };
}

// fold the run log into the board summary the UI shows.
export function analyzeFindings(findings) {
  const degByCompound = {}; let quali = null, idealFound = 0, recommendedStops = null;
  for (const f of findings) {
    if (f.type === "long") { degByCompound[f.compound] = { lapTimes: f.lapTimes, cliffLap: f.cliffLap, stintLaps: f.stintLaps };
      recommendedStops = recommendedStops == null ? f.recommendedStops : Math.min(recommendedStops, f.recommendedStops); }
    else if (f.type === "quali") quali = quali == null ? f.qualiPace : Math.min(quali, f.qualiPace);
    else if (f.type === "setup") idealFound = Math.max(idealFound, f.closeness);
  }
  return { degByCompound, quali, idealFound, recommendedStops };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/practice.test.js`
Expected: PASS (9 tests). Then run the whole suite: `node --test 2>&1 | grep -E "# (pass|fail)"` — expect `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/practice.js ApexWeb/tests/practice.test.js
git commit -m "feat(apexweb): practice host reducer (budget + findings board)"
```

---

### Task 6: Host wiring — `practice_run` RPC + practice snapshot + seed-on-entry

**Files:**
- Modify: `ApexWeb/src/main.js` (imports; `onPhaseHost`; `onCommand`; a `pushPracticeState` broadcaster; carry `ctx.practiceFindings` into the race)

- [ ] **Step 1: Add imports + the practice-phase host setup**

In `ApexWeb/src/main.js`, add to the imports from `./practice.js`:

```javascript
import { newPracticeState, applyPracticeRun } from "./practice.js";
```

Change `onPhaseHost` so entering practice seeds the weekend + inits the shared state and broadcasts it:

```javascript
function onPhaseHost() {
  if (ctx.weekend.phase === "practice") {
    if (ctx.seed == null) ctx.seed = 1000 + Math.floor(Math.random() * 100000);  // shared weekend seed (race reuses it)
    ctx.practice = newPracticeState();
    pushPracticeState();
  }
  if (ctx.weekend.phase === "race") startRaceHost();
}
```

- [ ] **Step 2: Add the `practice_run` command + the broadcaster**

In `onCommand`'s switch, add (after the `set_setup` case):

```javascript
    case "practice_run": {
      ctx.practice = ctx.practice || newPracticeState();
      const { drv, car } = practiceDrvCar(cmd.player);
      const ideal = trackIdeal(TRACK.laps * 1000 + Math.round(TRACK.lt));
      const r = applyPracticeRun(ctx.practice, cmd, drv, car, ideal, mix32((ctx.seed || 1) >>> 0));
      if (r.accepted) { ctx.practice = r.state; pushPracticeState(); }
      break;
    }
```

Add these helpers near `buildField` in `main.js` (and import `composeCar` is already imported; add `mix32`):

```javascript
function practiceDrvCar(player) {
  const t = TEAMS[ctx.teamIdx] || TEAMS[0];
  const d = t.drivers[player === "p2" ? 1 : 0];
  return { drv: { skill: d.skill, attrs: driverAttrs(d.abbrev, d.skill) }, car: composeCar(t.car) };
}
function pushPracticeState() {
  const p = ctx.practice;
  const snap = { type: "snapshot", phase: "practice", budget: p.budget, spent: p.spent,
    findings: p.findings, board: p.board, setups: p.setups };
  ctx.snapshot = snap;
  if (ctx.net) ctx.net.send(snap);
  rerender();
}
```

Add `mix32` to the `./rng.js` import (create the import line if absent):

```javascript
import { mix32 } from "./rng.js";
```

- [ ] **Step 3: Carry the findings into the race**

In `startRaceHost()`, after `ctx.speed = ctx.speed || 1;`, add:

```javascript
  ctx.practiceFindings = ctx.practice ? ctx.practice.board : null;   // info aid for the race HUD (cliff/stops)
```

- [ ] **Step 4: Boot-check (no console errors on load)**

Run: `node -e "import('./src/main.js').then(()=>console.log('main.js loaded')).catch(e=>{console.error(e);process.exit(1)})"`
Expected: prints `main.js loaded` with no throw. (main.js touches `document`; if it throws on `document`, wrap the check: instead run `node --check src/main.js` to verify it parses.)
Fallback: Run `node --check src/main.js` — expect no output (parse OK).

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/main.js
git commit -m "feat(apexweb): host practice_run RPC + practice snapshot broadcast"
```

---

### Task 7: Rewrite the Practice screen (`ui/practice.js`)

Render the run-picker + sliders + the shared findings board from the practice snapshot. Sliders are local (`ctx.setup`); a run sends `practice_run` with the current setup; "Ready" sends `set_setup` + `ready`.

**Files:**
- Rewrite: `ApexWeb/src/ui/practice.js`

- [ ] **Step 1: Replace the file contents**

Replace `ApexWeb/src/ui/practice.js` with:

```javascript
// ApexWeb/src/ui/practice.js — Practice "run plans": run-picker + setup sliders + a shared findings board.
// Renders from the host practice snapshot (ctx.snapshot when phase==="practice"); sliders are local.
import { PRAC_COST, COMPOUNDS } from "../data.js";
import { AXES } from "../setup.js";

const fmt = t => { const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(3).padStart(6, "0")}`; };
const COMPOUNDS_RU = { soft: "софт", medium: "медиум", hard: "хард" };

export function render(root, ctx) {
  ctx.setup = ctx.setup || [0.5, 0.5, 0.5];
  ctx.pracCompound = ctx.pracCompound || "soft";
  const snap = (ctx.snapshot && ctx.snapshot.phase === "practice") ? ctx.snapshot
    : { budget: 8, spent: 0, findings: [], board: { degByCompound: {}, quali: null, idealFound: 0, recommendedStops: null } };
  const left = snap.budget - snap.spent;
  const dots = Array.from({ length: snap.budget }, (_, i) => i < snap.spent ? "●" : "○").join("");
  const canRun = type => left >= (PRAC_COST[type] || 1);

  const sliders = AXES.map((ax, i) => `
    <div style="display:flex;align-items:center;gap:10px;margin:8px 0">
      <span class="label" style="width:90px">${ax.name}</span>
      <input type="range" min="0" max="1" step="0.01" value="${ctx.setup[i]}" data-ax="${i}" style="flex:1">
      <span style="width:36px;text-align:right">${(+ctx.setup[i]).toFixed(2)}</span>
    </div>`).join("");

  const b = snap.board;
  const degChart = Object.keys(b.degByCompound).length
    ? Object.entries(b.degByCompound).map(([c, d]) => `${COMPOUNDS_RU[c]}: клифф ${d.cliffLap || "—"} · стинт ~${d.stintLaps} кр`).join("<br>")
    : "пока нет long-run";
  const board = `
    <div class="panel">
      <h3>Общая доска находок</h3>
      <p class="label">Идеал сетапа: ${Math.round(b.idealFound * 100)}% · Квали-темп: ${b.quali ? fmt(b.quali) : "—"} · Рекоменд.: ${b.recommendedStops != null ? b.recommendedStops + " стоп" : "—"}</p>
      <p style="font-size:13px;line-height:1.6">${degChart}</p>
      <div style="border-top:1px solid var(--line);margin-top:8px;padding-top:6px;font-size:13px">
        ${snap.findings.slice(-6).map(f => `<div>[${f.player}] ${runLabel(f)}</div>`).join("") || "<span class='label'>пока нет прогонов</span>"}
      </div>
    </div>`;

  root.innerHTML = `
    <div class="panel">
      <h2>Практика — настройка и разведка</h2>
      <p class="label">Трек-тайм команды: ${dots} &nbsp;(${left} из ${snap.budget})</p>
      ${sliders}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button id="run-setup" ${canRun("setup") ? "" : "disabled style='opacity:.5'"}>Setup-тест ·1</button>
        <button id="run-long" ${canRun("long") ? "" : "disabled style='opacity:.5'"}>Long-run ·3</button>
        <select id="prac-compound">${["soft","medium","hard"].map(c => `<option value="${c}" ${c===ctx.pracCompound?"selected":""}>${COMPOUNDS_RU[c]}</option>`).join("")}</select>
        <button id="run-quali" ${canRun("quali") ? "" : "disabled style='opacity:.5'"}>Quali-sim ·1</button>
      </div>
    </div>
    ${board}
    <button class="ready" id="ready" style="margin-top:8px">Готов → Квала</button>`;

  root.querySelectorAll("input[type=range]").forEach(el => {
    el.oninput = e => { ctx.setup[+e.target.dataset.ax] = +e.target.value;
      e.target.nextElementSibling.textContent = (+e.target.value).toFixed(2); };
  });
  root.querySelector("#prac-compound").onchange = e => { ctx.pracCompound = e.target.value; };
  const run = type => ctx.send({ cmd: "practice_run", player: ctx.myPlayer, type, compound: ctx.pracCompound, setup: ctx.setup.slice() });
  root.querySelector("#run-setup").onclick = () => canRun("setup") && run("setup");
  root.querySelector("#run-long").onclick  = () => canRun("long")  && run("long");
  root.querySelector("#run-quali").onclick = () => canRun("quali") && run("quali");
  root.querySelector("#ready").onclick = () => {
    ctx.send({ cmd: "set_setup", player: ctx.myPlayer, setup: ctx.setup });
    ctx.send({ cmd: "ready", player: ctx.myPlayer });
  };
}

function runLabel(f) {
  if (f.type === "long") return `Long-run · ${COMPOUNDS_RU[f.compound]} → клифф ${f.cliffLap || "—"}`;
  if (f.type === "quali") return `Quali-sim → ${fmt(f.qualiPace)}`;
  return `Setup-тест → «${f.feedback}»`;
}
```

- [ ] **Step 2: Boot-check the practice module parses + exports render**

Run: `node -e "import('./src/ui/practice.js').then(m=>console.log(typeof m.render))"`
Expected: `function`.

- [ ] **Step 3: Run the full suite (nothing regressed)**

Run: `node --test 2>&1 | grep -E "# (pass|fail)"`
Expected: `# fail 0`.

- [ ] **Step 4: Commit**

```bash
git add ApexWeb/src/ui/practice.js
git commit -m "feat(apexweb): new Practice screen — run picker + shared findings board"
```

---

### Task 8: Race-HUD aid — show the practice prediction

Surface the practice findings (recommended stops / soft cliff) as a small player aid in the race HUD.

**Files:**
- Modify: `ApexWeb/src/main.js` (add `practiceFindings` to the race snapshot)
- Modify: `ApexWeb/src/ui/race.js` (render the aid in the header area)

- [ ] **Step 1: Ship the findings in the race snapshot**

In `ApexWeb/src/main.js` `raceSnapshot()`, add `practiceFindings: ctx.practiceFindings || null,` to the returned object (next to `wetness`).

- [ ] **Step 2: Render the aid in the race header**

In `ApexWeb/src/ui/race.js`, find the header chip line (`$("#d-chip").textContent = ...`). Immediately after it, add:

```javascript
  const pf = snap.practiceFindings;
  const aidEl = $("#d-prac-aid");
  if (aidEl) aidEl.textContent = pf && pf.recommendedStops != null
    ? `план: ${pf.recommendedStops} стоп${pf.degByCompound && pf.degByCompound.soft ? ` · софт-клифф ~${pf.degByCompound.soft.cliffLap}` : ""}`
    : "";
```

If there is no `#d-prac-aid` element in the header markup, add a `<span id="d-prac-aid" class="label"></span>` next to the existing `#d-chip` element in the header template (search the file for `id="d-chip"` and add the span in the same row).

- [ ] **Step 3: Boot-check race.js parses**

Run: `node -e "import('./src/ui/race.js').then(m=>console.log(typeof m.render))"`
Expected: `function`.

- [ ] **Step 4: Run the full suite**

Run: `node --test 2>&1 | grep -E "# (pass|fail)"`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/main.js ApexWeb/src/ui/race.js
git commit -m "feat(apexweb): race HUD shows the practice strategy prediction"
```

---

### Task 9: Update README + final verification

**Files:**
- Modify: `ApexWeb/README.md` (Practice section)

- [ ] **Step 1: Update the README's Practice description** to describe run-plans (shared budget, setup-test / long-run / quali-sim, shared findings board, skill via noise + race_iq, carries setup + a strategy prediction). Keep it to a short paragraph matching the README's style.

- [ ] **Step 2: Final full verification**

Run: `node --test 2>&1 | grep -E "# (pass|fail)"`
Expected: `# fail 0`.

Run: `node tools/balance.mjs 2>&1 | grep -E "DNF|pace spread"`
Expected: corridors unchanged (this feature doesn't touch the race sim) — DNF ~1.3, spread ~2.3-2.5.

- [ ] **Step 3: Commit**

```bash
git add ApexWeb/README.md
git commit -m "docs(apexweb): README — Practice run-plans"
```

- [ ] **Step 4: Note for the owner** — the live two-browser shared findings board (host runs, both render) is **not headless-verifiable**; it needs an F5 two-instance playtest. Everything else (run sims, skill, budget, findings, setup carry) is covered by `practice.test.js`.

---

## Self-review notes

- **Spec coverage:** run-plan budget (T1,T5,T7) · long-run sim (T3) · skill noise+feedback (T4) · co-op netcode (T6) · screen (T7) · setup carry (existing, exercised) · findings-as-info race aid (T8). All spec sections map to a task.
- **Type consistency:** finding shapes `{type:"long"|"setup"|"quali", ...}` consistent across `runLong`/`runSetupTest`/`runQuali`/`analyzeFindings`/`runLabel`; `board` shape `{degByCompound, quali, idealFound, recommendedStops}` consistent in `analyzeFindings` and the screen; `applyPracticeRun` returns `{accepted, state}` everywhere.
- **Tunables** (`PRAC_BUDGET 8`, costs `1/3/1`, `LONG_RUN_LAPS 10`, `PRAC_SIGNAL_K 0.8`, `PRAC_SETUP_NOISE 0.18`) are all in `data.js` (T1) for one-line calibration.
