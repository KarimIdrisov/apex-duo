# Real-time Practice (F1-Manager-style) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ApexWeb's run-plans practice with a live, real-time practice session (clock + time acceleration, 6 setup axes, send-car-out, per-lap setup-knowledge with a narrowing ideal window, satisfaction% that buffs the race), three sessions P1/P2/P3, per-car co-op.

**Architecture:** Pure deterministic session model (`practice_session.js`) reusing the existing per-lap pace/deg math; a host-authoritative real-time loop in `main.js` (mirrors the race loop) that advances laps and banks knowledge and broadcasts snapshots; a rewritten live-session screen (`ui/practice.js`). `setup.js` grows from 3 to 6 axes with knowledge/window/feedback/satisfaction helpers. Spec: `docs/superpowers/specs/2026-06-14-apexweb-realtime-practice-design.md`.

**Tech Stack:** Vanilla JS ES modules, no build. Tests: `node --test`. Determinism via the seeded `RNG`/`mix32` in `src/rng.js`. Run all commands from `ApexWeb/`.

**Conventions to follow (read before starting):**
- Per-lap pace math already exists: `practiceLapBase(drv, car, setup, ideal)` in `src/practice.js`, and `tyreTerm`/`warmStep` (`src/tyres.js`), `startFuel`/`weightTerm`/`burnFor` (`src/fuel.js`). Reuse them — do NOT invent new pace numbers.
- Determinism is load-bearing: NO `Date.now()`/`Math.random()` in the model. Per-axis randomness uses `mix32(seed + i*K)` (stateless), not RNG stream state.
- Netcode pattern: client → `ctx.send(cmd)` → host `onCommand` applies → host broadcasts `{type:"snapshot", phase, ...}` → client `onMessage` sets `ctx.snapshot` + rerenders. The host applies its own commands directly (see `src/main.js`).
- Commit only the listed pathspecs. End every commit message with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- UI strings are Russian; code/comments English.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `src/data.js` | tuning consts (knowledge/window/session) | add a `PRAC2` block |
| `src/setup.js` | 6 axes + ideal + knowledge window + feedback + satisfaction (pure) | rewrite to 6 axes, add helpers |
| `src/practice_session.js` | pure deterministic session model (state, step, reducers) | **create** |
| `src/ui/practice.js` | live-session screen (clock/speed, 6-axis widget, stint picker, strategy panel) | rewrite |
| `src/main.js` | host practice loop + command handlers + snapshot + `setupBonus` from satisfaction | modify |
| `src/weekend.js` | three practice phases P1/P2/P3 | modify |
| `src/quali.js` | quali setup term from satisfaction (6-axis) | modify |
| `src/practice.js` | keep `practiceLapBase`/`runLong` deg math; drop instant `runQuali`/`runSetupTest` interaction | trim at switchover |
| `tests/setup.test.js` | 6-axis ideal + satisfaction + window/feedback | rewrite |
| `tests/practice_session.test.js` | session model | **create** |
| `tools/balance.mjs` | convergence corridor | add a block |
| `README.md` | Practice section → real-time | update |

---

## Task 1: Tuning constants (`data.js`)

**Files:**
- Modify: `ApexWeb/src/data.js` (append near the existing `PRAC_BUDGET` block)
- Test: `ApexWeb/tests/data.test.js` (add one assertion)

- [ ] **Step 1: Write the failing test** — append to `ApexWeb/tests/data.test.js`:

```javascript
import { PRAC2 } from "../src/data.js";
test("PRAC2 has sane knowledge/session tuning", () => {
  assert.ok(PRAC2.AXES === 6, "6 setup axes");
  assert.ok(PRAC2.KNOW_PER_LAP > 0 && PRAC2.KNOW_PER_LAP < 0.2);
  assert.ok(PRAC2.MAX_HALF > 0.3 && PRAC2.MAX_HALF <= 0.5);
  assert.ok(PRAC2.CONFIRM_LAPS >= 1 && PRAC2.SAT_TOL > 0.1 && PRAC2.SAT_TOL < 0.3);
  assert.ok(PRAC2.SESSION_SEC >= 600 && PRAC2.SPEEDS.includes(8) && PRAC2.AUTOSIM_MULT < 1);
});
```

- [ ] **Step 2: Run it, expect FAIL** — `node --test tests/data.test.js` → fails (PRAC2 undefined).

- [ ] **Step 3: Implement** — append to `ApexWeb/src/data.js`:

```javascript
// Real-time practice tuning (spec 2026-06-14). See practice_session.js / setup.js.
export const PRAC2 = {
  AXES: 6,
  KNOW_PER_LAP: 0.06,     // knowledge banked per completed flying lap (per axis)
  IQ_LEARN: 0.5,          // feedbackMult = 0.75 + IQ_LEARN*race_iq  (sharp driver learns faster)
  MAX_HALF: 0.45,         // ideal-window half-width at knowledge 0 (≈ whole range)
  MIN_HALF: 0.02,         // half-width floor at knowledge 1
  WIN_P: 1.5,             // half = MIN + (MAX-MIN)*(1-knowledge)^WIN_P
  WIN_JITTER: 0.30,       // window-centre offset at knowledge 0 (shrinks to 0 with knowledge)
  KNOW_VAGUE: 0.25,       // below this knowledge the axis reads "мало кругов" (no usable window)
  CONFIRM_LAPS: 2,        // flying laps on a value before its satisfaction is confirmed
  SAT_TOL: 0.18,          // axisSat = clamp(1-(|v-opt|/SAT_TOL)^2,0,1)
  SESSION_SEC: 1800,      // 30 game-minutes per session
  SPEEDS: [1, 2, 4, 8],   // time-acceleration multipliers (over SIM_RATE)
  AUTOSIM_MULT: 0.8,      // auto-sim banks knowledge at 0.8× (simulating underperforms)
  TYRE_SETS: 6,           // tyre sets per car across all three sessions
  ACCL_PER_LAP: 0.01,     // acclimatisation per lap (cap 1) → tiny race buff
};
```

- [ ] **Step 4: Run it, expect PASS** — `node --test tests/data.test.js` → `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/data.js ApexWeb/tests/data.test.js
git commit -m "feat(apexweb): PRAC2 tuning consts for real-time practice"
```

---

## Task 2: `setup.js` — 6 axes, ideal, satisfaction

Rewrite `setup.js` to 6 axes and add the per-axis satisfaction + per-driver ideal. Keep the old export names working over N axes so nothing breaks before the switchover (`AXES`, `trackIdeal`, `closeness`, `paceBonus`, `feedback` stay, now length-6).

**Files:**
- Modify: `ApexWeb/src/setup.js`
- Test: `ApexWeb/tests/setup.test.js` (rewrite)

- [ ] **Step 1: Write the failing tests** — replace `ApexWeb/tests/setup.test.js` with:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { AXES, trackIdeal, idealFor, axisSat, satisfaction, closeness } from "../src/setup.js";

test("6 setup axes, each with a name + characteristic", () => {
  assert.equal(AXES.length, 6);
  for (const a of AXES) { assert.ok(a.name && a.char, "axis has name + char"); }
});

test("trackIdeal returns 6 values in [0,1], deterministic", () => {
  const a = trackIdeal(1234), b = trackIdeal(1234);
  assert.equal(a.length, 6);
  assert.deepEqual(a, b);
  assert.ok(a.every(v => v >= 0 && v <= 1));
});

test("idealFor jitters per-driver but stays near the track ideal", () => {
  const base = trackIdeal(1234);
  const d1 = idealFor(1234, 0), d2 = idealFor(1234, 1);
  assert.notDeepEqual(d1, d2, "two drivers differ");
  for (let i = 0; i < 6; i++) assert.ok(Math.abs(d1[i] - base[i]) < 0.2, "stays near track ideal");
});

test("axisSat is 1 at the optimum and falls off with distance", () => {
  assert.ok(Math.abs(axisSat(0.5, 0.5) - 1) < 1e-9);
  assert.ok(axisSat(0.5, 0.5) > axisSat(0.65, 0.5));
  assert.ok(axisSat(0.9, 0.5) < 0.3);
});

test("satisfaction is the mean of per-axis sats (0..1)", () => {
  assert.ok(Math.abs(satisfaction([1,1,1,1,1,1]) - 1) < 1e-9);
  assert.ok(Math.abs(satisfaction([1,0,1,0,1,0]) - 0.5) < 1e-9);
});

test("closeness still works (generalised over 6 axes)", () => {
  const ideal = trackIdeal(7);
  assert.ok(closeness(ideal, ideal) > 0.999);
});
```

- [ ] **Step 2: Run, expect FAIL** — `node --test tests/setup.test.js` → fails.

- [ ] **Step 3: Implement** — replace `ApexWeb/src/setup.js` with:

```javascript
// ApexWeb/src/setup.js — 6-axis setup: hidden ideal (per car/track/driver), per-axis
// satisfaction, and the knowledge-window + feedback model used by the live practice session.
import { RNG, mix32 } from "./rng.js";
import { PRAC2 } from "./data.js";

export const AXES = [
  { name:"Переднее крыло",     char:"поворачиваемость",        low:"вяло заходит в поворот", high:"остро ныряет, теряет зад" },
  { name:"Заднее крыло",       char:"прямые / стабильность",   low:"проседает на прямых",   high:"тяжёлый на прямых" },
  { name:"Подвеска",           char:"тяга на выходе",          low:"буксует на выходе",      high:"глухая на поребриках" },
  { name:"Развал колёс",       char:"держак в поворотах",      low:"не держит дугу",         high:"жрёт резину" },
  { name:"Передаточные числа", char:"разгон / торм. зоны",     low:"провал на разгоне",      high:"упирается на прямой" },
  { name:"Тормозной баланс",   char:"стабильн. в торможении",  low:"блокирует зад",          high:"длинно тормозит" },
];

// hidden optimum for the weekend, derived from the track seed
export function trackIdeal(seed) {
  const r = new RNG(seed ^ 0x5e7);
  return Array.from({ length: PRAC2.AXES }, () => r.unit());
}

// per-driver optimum: the track ideal nudged a little for each driver (driverSeed 0 / 1)
export function idealFor(seed, driverSeed) {
  const base = trackIdeal(seed);
  return base.map((v, i) => {
    const j = ((mix32((seed >>> 0) + driverSeed * 7919 + i * 131) % 1000) / 1000) * 2 - 1; // [-1,1]
    return Math.min(1, Math.max(0, v + j * 0.12));
  });
}

// per-axis satisfaction: bell curve around the optimum
export function axisSat(value, opt) {
  const d = Math.abs(value - opt) / PRAC2.SAT_TOL;
  return Math.max(0, Math.min(1, 1 - d * d));
}

export function satisfaction(confirmedSat) {
  if (!confirmedSat.length) return 0;
  return confirmedSat.reduce((a, b) => a + b, 0) / confirmedSat.length;
}

// legacy closeness/paceBonus/feedback — generalised over AXES.length so existing consumers
// keep working until the switchover (Task 10) moves them to satisfaction.
export function closeness(setup, ideal) {
  let err = 0; const n = ideal.length;
  for (let i = 0; i < n; i++) err += Math.abs(setup[i] - ideal[i]);
  return 1 - err / n;
}
export function paceBonus(close) { return -0.15 * Math.max(0, close); }
export function feedback(setup, ideal) {
  let worst = 0, worstErr = -1, sign = 0;
  for (let i = 0; i < ideal.length; i++) {
    const e = Math.abs(setup[i] - ideal[i]);
    if (e > worstErr) { worstErr = e; worst = i; sign = setup[i] < ideal[i] ? -1 : 1; }
  }
  if (worstErr < 0.08) return "Машина сбалансирована — так держать.";
  const ax = AXES[worst];
  return `${ax.name}: ${sign < 0 ? ax.high : ax.low}.`;
}
```

- [ ] **Step 4: Run, expect PASS** — `node --test tests/setup.test.js` → `# fail 0`.

- [ ] **Step 5: Guard the other consumers still parse** — `node --test tests/practice.test.js tests/quali.test.js` → `# fail 0` (they use `closeness`/`paceBonus` over 6 now; `trackIdeal` returns 6 — verify no NaN). If `practice.test.js` builds a 3-length setup literal that now mismatches, update those literals to length-6 (e.g. `[0.5,0.5,0.5,0.5,0.5,0.5]`) in the test only.

- [ ] **Step 6: Commit**

```bash
git add ApexWeb/src/setup.js ApexWeb/tests/setup.test.js
git commit -m "feat(apexweb): setup.js → 6 axes + per-driver ideal + axis satisfaction"
```

---

## Task 3: `setup.js` — knowledge window + feedback

Add the narrowing ideal-window and the per-axis feedback line. Pure functions.

**Files:**
- Modify: `ApexWeb/src/setup.js`
- Test: `ApexWeb/tests/setup.test.js`

- [ ] **Step 1: Write the failing tests** — append to `ApexWeb/tests/setup.test.js`:

```javascript
import { windowFor, feedbackFor } from "../src/setup.js";

test("windowFor: half-width shrinks with knowledge and centres on the optimum", () => {
  const lo = windowFor(0.1, 0.5, 1234, 0);
  const hi = windowFor(0.95, 0.5, 1234, 0);
  assert.ok(hi.half < lo.half, "more knowledge → tighter window");
  assert.ok(Math.abs(hi.center - 0.5) < Math.abs(lo.center - 0.5), "centre homes onto the optimum");
  assert.ok(hi.half >= 0.02 - 1e-9, "respects the floor");
});

test("feedbackFor: in-window → optimal; off → directional; low knowledge → vague", () => {
  const opt = 0.5;
  const vague = feedbackFor(0.5, windowFor(0.1, opt, 1, 0), 0.1, 0.8);
  assert.equal(vague.state, "vague");
  const win = windowFor(0.95, opt, 1, 0);
  assert.equal(feedbackFor(win.center, win, 0.95, 0.8).state, "optimal");
  const dir = feedbackFor(win.center + 0.25, win, 0.95, 0.8);
  assert.ok(dir.state === "low" || dir.state === "high", "off-window reads directional");
});
```

- [ ] **Step 2: Run, expect FAIL** — `node --test tests/setup.test.js` → fails.

- [ ] **Step 3: Implement** — append to `ApexWeb/src/setup.js`:

```javascript
// the revealed ideal window for an axis: centre = optimum + jitter (shrinks with knowledge),
// half-width shrinks from MAX_HALF to MIN_HALF as knowledge → 1.
export function windowFor(knowledge, opt, seed, i) {
  const k = Math.max(0, Math.min(1, knowledge));
  const j = ((mix32((seed >>> 0) + i * 977 + 0x9e3) % 1000) / 1000) * 2 - 1; // stable [-1,1]
  const center = opt + j * PRAC2.WIN_JITTER * (1 - k);
  const half = PRAC2.MIN_HALF + (PRAC2.MAX_HALF - PRAC2.MIN_HALF) * Math.pow(1 - k, PRAC2.WIN_P);
  return { center, half };
}

// feedback for one axis. clarity (vague→directional) gated by knowledge + race_iq.
export function feedbackFor(value, win, knowledge, raceIq) {
  if (knowledge < PRAC2.KNOW_VAGUE) return { state:"vague", text: knowledge < 0.12 ? "почти нет данных" : "мало кругов" };
  const d = value - win.center;
  if (Math.abs(d) <= win.half) return { state:"optimal", text:"оптимально" };
  const big = Math.abs(d) > win.half * 3;
  // a sharp driver words it precisely; a vague one just says more/less
  const sharp = raceIq >= 0.55;
  if (d < 0) return { state:"low",  text: sharp ? (big ? "нужно заметно больше →" : "чуть больше →") : "больше →" };
  return       { state:"high", text: sharp ? (big ? "← нужно заметно меньше" : "← чуть меньше") : "← меньше" };
}
```

- [ ] **Step 4: Run, expect PASS** — `node --test tests/setup.test.js` → `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/setup.js ApexWeb/tests/setup.test.js
git commit -m "feat(apexweb): setup.js knowledge window + per-axis feedback"
```

---

## Task 4: `practice_session.js` — state + per-lap step

The pure session model: state, and `step(dt)` that advances laps in accelerated game-time and banks knowledge + confirm-after-laps. Reuses `practiceLapBase` + tyres/fuel for per-lap pace/deg.

**Files:**
- Create: `ApexWeb/src/practice_session.js`
- Test: `ApexWeb/tests/practice_session.test.js`

- [ ] **Step 1: Write the failing tests** — create `ApexWeb/tests/practice_session.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { newSession, sendRun, step, carView } from "../src/practice_session.js";
import { TEAMS } from "../src/data.js";
import { driverAttrs } from "../src/team.js";
import { composeCar } from "../src/team.js";

function mkCars() {
  const t = TEAMS[0];
  const mk = di => ({ drv:{ skill:t.drivers[di].skill, attrs:driverAttrs(t.drivers[di].abbrev, t.drivers[di].skill) }, car:composeCar(t.car) });
  return { p1: mk(0), p2: mk(1) };
}

test("a stint runs laps and banks knowledge (capped at 1)", () => {
  let s = newSession(1234, mkCars());
  s = sendRun(s, "p1", "soft", 12);
  for (let i = 0; i < 400; i++) s = step(s, 1.0);   // plenty of game-seconds
  const v = carView(s, "p1");
  assert.ok(v.totalLaps >= 8, `ran laps (${v.totalLaps})`);
  assert.ok(v.knowledge.every(k => k > 0 && k <= 1), "knowledge banked, capped");
});

test("satisfaction is only confirmed after CONFIRM_LAPS on a value", () => {
  let s = newSession(1234, mkCars());
  // set every axis to its hidden optimum, then run
  const ideal = s.cars.p1.ideal.slice();
  for (let i = 0; i < 6; i++) s.cars.p1.setup[i] = ideal[i];
  // before running: nothing confirmed
  assert.ok(carView(s, "p1").satisfaction < 0.01, "unconfirmed until run");
  s = sendRun(s, "p1", "soft", 6);
  for (let i = 0; i < 200; i++) s = step(s, 1.0);
  assert.ok(carView(s, "p1").satisfaction > 0.9, "perfect setup confirms to ~100%");
});

test("determinism: same seed + same commands → identical laps & knowledge", () => {
  const run = () => { let s = newSession(77, mkCars()); s = sendRun(s, "p1", "medium", 10);
    for (let i = 0; i < 300; i++) s = step(s, 1.0); return carView(s, "p1"); };
  const a = run(), b = run();
  assert.deepEqual(a.knowledge, b.knowledge);
  assert.equal(a.totalLaps, b.totalLaps);
});
```

- [ ] **Step 2: Run, expect FAIL** — `node --test tests/practice_session.test.js` → fails (module missing).

- [ ] **Step 3: Implement** — create `ApexWeb/src/practice_session.js`:

```javascript
// ApexWeb/src/practice_session.js — pure deterministic real-time practice session.
// State + step(dt) advancing laps in accelerated game-time, banking setup knowledge.
// Reuses the calibrated per-lap pace/deg math — no new pace numbers. Seeded → deterministic.
import { PRAC2, TRACK, COMPOUNDS, TYRE } from "./data.js";
import { practiceLapBase } from "./practice.js";
import { tyreTerm, warmStep } from "./tyres.js";
import { startFuel, weightTerm, burnFor } from "./fuel.js";
import { idealFor, axisSat } from "./setup.js";
import { mix32 } from "./rng.js";

const PLAYERS = ["p1", "p2"];

function newCar(seed, driverSeed, drvCar) {
  const ideal = idealFor(seed, driverSeed);
  return {
    drv: drvCar.drv, car: drvCar.car, ideal,
    setup: Array.from({ length: PRAC2.AXES }, () => 0.5),
    knowledge: Array.from({ length: PRAC2.AXES }, () => 0),
    lapsOnVal: Array.from({ length: PRAC2.AXES }, () => 0),
    confirmedSat: Array.from({ length: PRAC2.AXES }, () => 0),
    onTrack: false, compound: "soft", stintLeft: 0,
    wear: 0, temp: TYRE.gridTemp, fuel: startFuel(TRACK),
    totalLaps: 0, accl: 0, lapAcc: 0, strategy: { degByCompound: {} },
  };
}

export function newSession(seed, cars, session = 1) {
  return {
    seed: seed >>> 0, session, clock: PRAC2.SESSION_SEC, speed: 1, paused: true,
    cars: { p1: newCar(seed, 0, cars.p1), p2: newCar(seed, 1, cars.p2) },
  };
}

function feedbackMult(car) { return 0.75 + PRAC2.IQ_LEARN * (car.drv.attrs?.race_iq ?? 0.7); }

export function setAxis(s, player, i, value) {
  const car = s.cars[player]; if (!car) return s;
  car.setup[i] = Math.max(0, Math.min(1, value));
  car.lapsOnVal[i] = 0;                       // changing a value un-confirms it (must re-run)
  return s;
}

export function sendRun(s, player, compound, laps) {
  const car = s.cars[player]; if (!car) return s;
  car.compound = compound; car.stintLeft = laps; car.onTrack = true;
  car.wear = 0; car.temp = TYRE.pitTemp; car.fuel = startFuel(TRACK);
  return s;
}

// one completed flying lap for a car: bank knowledge, confirm axes, accumulate deg, burn fuel.
function completeLap(car) {
  const fm = feedbackMult(car);
  for (let i = 0; i < PRAC2.AXES; i++) {
    car.knowledge[i] = Math.min(1, car.knowledge[i] + PRAC2.KNOW_PER_LAP * fm);
    car.lapsOnVal[i] += 1;
    if (car.lapsOnVal[i] >= PRAC2.CONFIRM_LAPS) car.confirmedSat[i] = axisSat(car.setup[i], car.ideal[i]);
  }
  // strategy/deg by-product (same shape the deg chart consumes)
  const comp = COMPOUNDS[car.compound];
  const lapT = practiceLapBase(car.drv, car.car, car.setup, car.ideal) + comp.pace
    + tyreTerm(car.compound, car.wear, car.temp) + weightTerm(car.fuel);
  const d = car.strategy.degByCompound[car.compound] || (car.strategy.degByCompound[car.compound] = { lapTimes: [], cliffLap: Math.round(comp.cliff / comp.wear), stintLaps: Math.round(comp.cliff / comp.wear) });
  d.lapTimes.push(lapT);
  car.wear += comp.wear; car.temp = warmStep(car.temp, car.compound); car.fuel -= burnFor("standard", car.car.fuel);
  car.totalLaps += 1; car.accl = Math.min(1, car.accl + PRAC2.ACCL_PER_LAP);
  car.stintLeft -= 1; if (car.stintLeft <= 0) car.onTrack = false;
}

const LAP_SEC = () => TRACK.lt;   // game-seconds per practice lap (approx clean lap)

// advance the session by dt real-seconds × speed; complete whole laps as game-time accrues.
export function step(s, dt) {
  if (s.paused || s.clock <= 0) return s;
  const adv = Math.min(s.clock, dt * s.speed);
  s.clock -= adv;
  for (const p of PLAYERS) {
    const car = s.cars[p];
    if (!car.onTrack) continue;
    car.lapAcc += adv;
    let guard = 0;
    while (car.lapAcc >= LAP_SEC() && car.onTrack && guard++ < 50) { car.lapAcc -= LAP_SEC(); completeLap(car); }
  }
  return s;
}

// read-only projection for tests/UI
export function carView(s, player) {
  const car = s.cars[player];
  return {
    setup: car.setup.slice(), knowledge: car.knowledge.slice(), confirmedSat: car.confirmedSat.slice(),
    ideal: car.ideal.slice(), onTrack: car.onTrack, compound: car.compound, stintLeft: car.stintLeft,
    totalLaps: car.totalLaps, accl: car.accl, strategy: car.strategy,
    satisfaction: car.confirmedSat.reduce((a, b) => a + b, 0) / PRAC2.AXES,
  };
}
```

- [ ] **Step 4: Run, expect PASS** — `node --test tests/practice_session.test.js` → `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/practice_session.js ApexWeb/tests/practice_session.test.js
git commit -m "feat(apexweb): practice_session model — laps bank knowledge, confirm-after-laps"
```

---

## Task 5: `practice_session.js` — clock, speed, auto-sim

Add clock/pause/speed reducers and `autoSim` (fast-forward at reduced knowledge), and a snapshot projection.

**Files:**
- Modify: `ApexWeb/src/practice_session.js`
- Test: `ApexWeb/tests/practice_session.test.js`

- [ ] **Step 1: Write the failing tests** — append:

```javascript
import { setSpeed, setPaused, autoSim, sessionSnapshot } from "../src/practice_session.js";

test("clock counts down only while running; speed scales it", () => {
  let s = newSession(1, mkCars()); s = setPaused(s, false); s = setSpeed(s, 4);
  s = step(s, 1.0);
  assert.ok(Math.abs((1800 - s.clock) - 4) < 1e-6, "4× → 4 game-seconds for 1 real-second");
  let p = newSession(1, mkCars());  // paused by default
  p = step(p, 5.0);
  assert.equal(p.clock, 1800, "paused → clock frozen");
});

test("autoSim banks less knowledge than the same laps run hands-on", () => {
  const hands = () => { let s = newSession(9, mkCars()); s = sendRun(s, "p1", "soft", 30); s = setPaused(s,false); s = setSpeed(s,8);
    for (let i=0;i<400;i++) s = step(s, 1.0); return carView(s,"p1").knowledge[0]; };
  const auto = () => { let s = newSession(9, mkCars()); s.cars.p1.compound="soft"; s = autoSim(s, "p1"); return carView(s,"p1").knowledge[0]; };
  assert.ok(auto() < hands(), "auto-sim underperforms hands-on");
});

test("sessionSnapshot exposes per-car windows + feedback + satisfaction", () => {
  let s = newSession(1, mkCars()); s = sendRun(s,"p1","soft",6); s = setPaused(s,false);
  for (let i=0;i<200;i++) s = step(s,1.0);
  const snap = sessionSnapshot(s);
  assert.equal(snap.phase, "practice");
  assert.equal(snap.cars.p1.axes.length, 6);
  assert.ok(snap.cars.p1.axes[0].window && snap.cars.p1.axes[0].feedback, "axis carries window+feedback");
  assert.ok(typeof snap.cars.p1.satisfaction === "number");
});
```

- [ ] **Step 2: Run, expect FAIL** — fails (functions missing).

- [ ] **Step 3: Implement** — append to `ApexWeb/src/practice_session.js`:

```javascript
import { windowFor, feedbackFor } from "./setup.js";

export function setSpeed(s, v) { s.speed = PRAC2.SPEEDS.includes(v) ? v : s.speed; return s; }
export function setPaused(s, p) { s.paused = !!p; return s; }

// fast-forward a car's remaining clock running the current setup, at reduced knowledge rate.
export function autoSim(s, player) {
  const car = s.cars[player];
  const laps = Math.floor(s.clock / LAP_SEC());
  car.onTrack = true; car.stintLeft = Math.max(car.stintLeft, laps);
  const save = PRAC2.KNOW_PER_LAP;
  // temporarily reduce learn rate by completing laps at AUTOSIM_MULT
  for (let n = 0; n < laps; n++) {
    const fm = (0.75 + PRAC2.IQ_LEARN * (car.drv.attrs?.race_iq ?? 0.7)) * PRAC2.AUTOSIM_MULT;
    for (let i = 0; i < PRAC2.AXES; i++) {
      car.knowledge[i] = Math.min(1, car.knowledge[i] + save * fm);
      car.lapsOnVal[i] += 1;
      if (car.lapsOnVal[i] >= PRAC2.CONFIRM_LAPS) car.confirmedSat[i] = axisSat(car.setup[i], car.ideal[i]);
    }
    car.totalLaps += 1; car.accl = Math.min(1, car.accl + PRAC2.ACCL_PER_LAP);
  }
  car.onTrack = false; car.stintLeft = 0; s.clock = 0;
  return s;
}

export function sessionSnapshot(s) {
  const proj = (car, dseedIdx) => ({
    onTrack: car.onTrack, compound: car.compound, stintLeft: car.stintLeft, totalLaps: car.totalLaps,
    satisfaction: car.confirmedSat.reduce((a, b) => a + b, 0) / PRAC2.AXES, accl: car.accl,
    strategy: car.strategy,
    axes: car.setup.map((v, i) => {
      const win = windowFor(car.knowledge[i], car.ideal[i], s.seed + dseedIdx * 101, i);
      return { value: v, knowledge: car.knowledge[i], confirmedSat: car.confirmedSat[i],
        window: win, feedback: feedbackFor(v, win, car.knowledge[i], car.drv.attrs?.race_iq ?? 0.7) };
    }),
  });
  return { type: "snapshot", phase: "practice", session: s.session, clock: s.clock, speed: s.speed, paused: s.paused,
    cars: { p1: proj(s.cars.p1, 0), p2: proj(s.cars.p2, 1) } };
}
```

Note: `completeLap` must reuse the same window seed offset; the UI reads `window` straight from the snapshot, so the `dseedIdx` (0 for p1, 1 for p2) in `sessionSnapshot` must match the per-car ideal derivation. This is internal-consistent (both derive from `s.seed` + the player index).

- [ ] **Step 4: Run, expect PASS** — `node --test tests/practice_session.test.js` → `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/practice_session.js ApexWeb/tests/practice_session.test.js
git commit -m "feat(apexweb): practice_session clock/speed/auto-sim + snapshot projection"
```

---

## Task 6: Weekend — three practice phases

**Files:**
- Modify: `ApexWeb/src/weekend.js`
- Modify: `ApexWeb/src/main.js` (the `SCREENS` map)
- Test: `ApexWeb/tests/weekend.test.js`

- [ ] **Step 1: Write the failing test** — append to `ApexWeb/tests/weekend.test.js`:

```javascript
test("weekend runs three practice sessions before quali", () => {
  const w = new Weekend(); w.solo = true; const seen = [];
  w.onPhase = p => seen.push(p);
  w.start();                       // → practice1
  w.setReady("p1");                // → practice2
  w.setReady("p1");                // → practice3
  w.setReady("p1");                // → quali
  assert.deepEqual(seen, ["practice1", "practice2", "practice3", "quali"]);
});
```

- [ ] **Step 2: Run, expect FAIL** — `node --test tests/weekend.test.js` → fails.

- [ ] **Step 3: Implement** — in `ApexWeb/src/weekend.js`, change the ORDER line:

```javascript
const ORDER = ["lobby", "practice1", "practice2", "practice3", "quali", "race", "result"];
```

and `start()`:

```javascript
start() { this._goto("practice1"); }
```

In `ApexWeb/src/main.js`, map all three practice phases to the practice screen (find the `SCREENS` const):

```javascript
const SCREENS = { lobby, practice1: practice, practice2: practice, practice3: practice, quali, race, result: race };
```

Also update the `rerender()` `root.className` test if it special-cases `"practice"` (it currently keys race/result only — leave as is). Anywhere code compares `phase === "practice"` for practice (in `main.js` `onPhaseHost`, snapshots) must accept all three — handle in Task 7/8 via a helper `isPractice(phase)`:

```javascript
const isPractice = p => p === "practice1" || p === "practice2" || p === "practice3";
```

- [ ] **Step 4: Run, expect PASS** — `node --test tests/weekend.test.js` → `# fail 0`. Boot-check: `node -e "import('./src/weekend.js').then(m=>console.log(typeof m.Weekend))"` → `function`.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/weekend.js ApexWeb/src/main.js ApexWeb/tests/weekend.test.js
git commit -m "feat(apexweb): three practice sessions P1/P2/P3 in the weekend flow"
```

---

## Task 7: Host practice loop + snapshot (`main.js`)

Add a real-time host loop that advances the session and broadcasts snapshots, mirroring `hostLoop`.

**Files:**
- Modify: `ApexWeb/src/main.js`
- Verify: boot-check + preview (no unit test — integration)

- [ ] **Step 1: Imports + session bootstrap.** At the top of `main.js` add:

```javascript
import { newSession, step as pracStep, sessionSnapshot, setAxis, sendRun, setSpeed, setPaused, autoSim } from "./practice_session.js";
```

In `onPhaseHost()`, replace the old `practice` branch with (carries knowledge across sessions):

```javascript
if (isPractice(ctx.weekend.phase)) {
  if (ctx.seed == null) ctx.seed = 1000 + Math.floor(Math.random() * 100000);
  const n = Number(ctx.weekend.phase.slice(-1));   // 1 | 2 | 3
  if (!ctx.pracSession) ctx.pracSession = newSession(ctx.seed, practiceCars());
  else { ctx.pracSession.session = n; ctx.pracSession.clock = PRAC2.SESSION_SEC; ctx.pracSession.paused = true; ctx.pracSession.cars.p1.onTrack = false; ctx.pracSession.cars.p2.onTrack = false; }
  pushPractice();
}
```

Add `practiceCars()` (driver+car per player, like `practiceDrvCar` did) and `pushPractice()`:

```javascript
function practiceCars() {
  const t = TEAMS[ctx.teamIdx] || TEAMS[0];
  const mk = di => ({ drv: { skill: t.drivers[di].skill, attrs: driverAttrs(t.drivers[di].abbrev, t.drivers[di].skill) }, car: composeCar(t.car) });
  return { p1: mk(0), p2: mk(1) };
}
function pushPractice() {
  const snap = sessionSnapshot(ctx.pracSession);
  ctx.snapshot = snap;
  if (ctx.net) ctx.net.send(snap);
  rerender();
}
```

- [ ] **Step 2: Drive the session in the host loop.** In `hostLoop(ts)`, after the race block, add a practice block (uses the same `dt`):

```javascript
if (ctx.role === "host" && isPractice(ctx.weekend.phase) && ctx.pracSession && !ctx.pracSession.paused) {
  const dt = Math.min(0.1, ctx._pracLastTs ? (ts - ctx._pracLastTs) / 1000 : 0);
  pracStep(ctx.pracSession, dt * SIM_RATE);
  if ((++ctx._pracFrame % 4) === 0) pushPractice();
}
ctx._pracLastTs = ts;
```

Add `ctx._pracFrame = 0` init alongside the other ctx fields. (`SIM_RATE` already exists.) Ensure `PRAC2` is imported in `main.js` (add to the `data.js` import).

- [ ] **Step 3: Boot-check** — `node -e "import('./src/practice_session.js').then(m=>console.log(typeof m.sessionSnapshot))"` → `function`. (main.js itself is not node-importable — verify in preview at Task 9.)

- [ ] **Step 4: Commit**

```bash
git add ApexWeb/src/main.js
git commit -m "feat(apexweb): host real-time practice loop + snapshot broadcast"
```

---

## Task 8: Practice command handlers (`main.js`)

Wire client→host commands for the live session.

**Files:**
- Modify: `ApexWeb/src/main.js` (the `onCommand` switch)

- [ ] **Step 1: Add cases** to `onCommand(cmd)` (replace the old `practice_run` case):

```javascript
case "prac_axis":  if (ctx.pracSession) { setAxis(ctx.pracSession, cmd.player, cmd.i, cmd.value); pushPractice(); } break;
case "prac_run":   if (ctx.pracSession) { sendRun(ctx.pracSession, cmd.player, cmd.compound || "soft", cmd.laps || 12); pushPractice(); } break;
case "prac_speed": if (ctx.pracSession) { setSpeed(ctx.pracSession, cmd.value); pushPractice(); } break;
case "prac_pause": if (ctx.pracSession) { setPaused(ctx.pracSession, !ctx.pracSession.paused); pushPractice(); } break;
case "prac_auto":  if (ctx.pracSession) { autoSim(ctx.pracSession, cmd.player); pushPractice(); } break;
```

- [ ] **Step 2: Carry satisfaction into the race.** In `startRaceHost()` / `buildField()`, set each player car's `setupBonus` from its session satisfaction. Add a helper and use it where `setupBonus` is computed:

```javascript
function pracSetupBonus(player) {
  if (!ctx.pracSession) return 0;
  const sat = ctx.pracSession.cars[player].confirmedSat.reduce((a, b) => a + b, 0) / PRAC2.AXES;
  return paceBonus(sat);   // reuse the existing scale: sat 1 ⇒ today's best bonus
}
```

In `buildField()`, for the player cars (`player === "p1"|"p2"`), set `setupBonus: pracSetupBonus(player)` instead of `paceBonus(closeness(setup, ideal))`. Keep AI cars at their existing `setupBonus`. Ensure `paceBonus` stays imported.

- [ ] **Step 3: Keep `practiceFindings` (race HUD aid).** In `startRaceHost()`, set:

```javascript
ctx.practiceFindings = ctx.pracSession ? analyzeStrategy(ctx.pracSession.cars[ctx.myPlayer].strategy) : null;
```

where `analyzeStrategy(strategy)` returns `{ degByCompound, recommendedStops }` from the session's accumulated `strategy.degByCompound` (recommendedStops = min over compounds of `ceil(TRACK.laps/stintLaps)-1`, floored at 1). Add this small helper in `main.js` (or export from `practice_session.js`).

- [ ] **Step 4: Boot-check** — `node --test tests/practice_session.test.js tests/setup.test.js` → `# fail 0` (model unaffected). main.js verified in preview at Task 9.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/main.js
git commit -m "feat(apexweb): practice command handlers + satisfaction→setupBonus + HUD aid"
```

---

## Task 9: Live-session screen (`ui/practice.js`)

Rewrite the screen to the live session: header (clock + speed + pause + auto-sim), the 6-axis setup widget (slider + narrowing window + feedback + knowledge bar — per the spec mockup), a stint picker, the strategy-data panel (reuse `degChartSVG`), satisfaction summary, partner peek, ready. Renders from `ctx.snapshot` (the session snapshot). HeroUI dark style (`style.css`).

**Files:**
- Rewrite: `ApexWeb/src/ui/practice.js`
- Modify: `ApexWeb/style.css` (reuse the existing "Practice screen (hero)" block; add `.pw-track/.pw-band/.pw-thumb/.pw-axis` rules mirroring the approved mockup)
- Verify: preview (drive a session, screenshot)

- [ ] **Step 1: Render contract.** `render(root, ctx)` reads `const snap = ctx.snapshot` when `ctx.weekend.phase` starts with "practice"; the local car is `snap.cars[ctx.myPlayer]`. Build:
  - **Header:** `P{snap.session} · осталось {mm:ss(snap.clock)}`, speed pills (`1× 2× 4× 8×`, active = `snap.speed`) → `ctx.send({cmd:"prac_speed", value})`; pause/▶ → `{cmd:"prac_pause"}`; «Просимулировать остаток» → `{cmd:"prac_auto", player:ctx.myPlayer}`; on-track state `на трассе · круг N · {compound}`.
  - **Setup widget:** for each of the 6 `car.axes[i]`, a row: axis name + `AXES[i].char`; a track `.pw-track` with a `.pw-band` at `left:(window.center-window.half)*100%` width `window.half*2*100%` (colour by `feedback.state`: optimal=success, low/high=warning, vague=tertiary) and a `.pw-thumb` at `value*100%`; a feedback chip (`feedback.text`, colour by state) + a knowledge bar `width:knowledge*100%`. The slider is a native `<input type=range min=0 max=1 step=.01 value=value>` overlaying the track → `oninput` sends `{cmd:"prac_axis", player, i, value}` (debounce by sending on `change`, live-preview the thumb on `input`).
  - **Stint picker:** compound segmented (soft/medium/hard) + laps stepper (e.g. 6/10/15) + «Выпустить болид» → `{cmd:"prac_run", player, compound, laps}` (disabled while `car.onTrack`).
  - **Strategy panel:** `degChartSVG(car.strategy.degByCompound)` — this function already lives in the current `ui/practice.js` (the hero deg-curve chart); preserve it in the rewrite and call it with the session's `strategy.degByCompound` (same `{lapTimes,cliffLap,stintLaps}` shape it already expects).
  - **Satisfaction summary:** big `{round(car.satisfaction*100)}%` + per-axis confirmed pips.
  - **Partner peek:** small read-only `P{other}: {round(snap.cars[other].satisfaction*100)}%`.
  - **Ready:** «Готов → {next}» → `{cmd:"set_setup"...}` is no longer needed (setup lives in the session); just `{cmd:"ready", player}`.

- [ ] **Step 2: Implement** the rewrite following the contract above, the approved mockup in the spec, and the existing `ui/practice.js` patterns (the `fmt`, `COMPOUNDS_RU`, button wiring). Keep the file focused (~200 lines). Use `var(--good)/--warn/--content2/--border` etc. from `style.css`. Add the `.pw-*` CSS to `style.css` under the existing practice block.

- [ ] **Step 3: Boot-check parse** — `node -e "import('./src/ui/practice.js').then(m=>console.log(typeof m.render))"` → `function`.

- [ ] **Step 4: Preview verification.** Start preview (`python -m http.server` on `ApexWeb/`), load, click solo → P1. Drive via `preview_eval`: set a few axes, send a stint, set speed 8×, unpause; after laps, assert the snapshot-driven DOM shows narrowing bands + feedback + rising knowledge + satisfaction; auto-sim to end; ready advances to P2. Screenshot. Fix until clean; **no console errors**. (Cache caveat: the preview proxies a fixed origin — verify a UI change via a cache-busted dynamic import if `location.reload()` serves stale modules; see the practice-redesign memory.)

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/ui/practice.js ApexWeb/style.css
git commit -m "feat(apexweb): live practice-session screen — clock, 6-axis knowledge widget, strategy panel"
```

---

## Task 10: Quali + cleanup (retire 3-axis path)

Move quali to satisfaction and remove the dead run-plans code.

**Files:**
- Modify: `ApexWeb/src/quali.js`
- Trim: `ApexWeb/src/practice.js` (drop `runQuali`/`runSetupTest`/`applyPracticeRun`/`newPracticeState`/`analyzeFindings` interaction; KEEP `practiceLapBase` and the `runLong` deg helper, both reused by `practice_session.js`). `degChartSVG` is in `ui/practice.js`, not here — leave it.
- Modify: `ApexWeb/tests/practice.test.js` (drop tests for removed functions; keep `practiceLapBase`/`degChartSVG`)
- Test: `ApexWeb/tests/quali.test.js`

- [ ] **Step 1: Quali setup term.** In `quali.js`, find where the player setup affects the flying lap (the `setup_q`/`setupBonus` term). Replace the 3-axis `closeness`-derived term with the car’s `setupBonus` already carried on the field entry (set in Task 8 from satisfaction). If `quali.js` recomputes it, change it to read `f.setupBonus`. Add/adjust a test in `quali.test.js`:

```javascript
test("a better-satisfied setup qualifies ahead of a poor one, same driver/car", () => {
  // build two identical entries differing only in setupBonus (−0.12 vs 0) and assert order
  // (use the existing buildGrid harness in quali.test.js)
});
```

- [ ] **Step 2: Trim `practice.js`.** Remove the now-unused exports and their tests. Run `node --test tests/practice.test.js` → `# fail 0` (only `practiceLapBase`/`degChartSVG`/`runLong` deg tests remain, or the file is reduced). Grep to confirm no remaining import of a removed symbol: `grep -rn "applyPracticeRun\|newPracticeState\|runSetupTest\|runQuali" src/`.

- [ ] **Step 3: Full suite** — `node --test --test-reporter=tap > /tmp/s.tap 2>&1; grep -E "^# (tests|fail)" /tmp/s.tap` → `# fail 0`. (Note `sim.test.js` ≈ 11 min; budget the run.)

- [ ] **Step 4: Commit**

```bash
git add ApexWeb/src/quali.js ApexWeb/src/practice.js ApexWeb/tests/practice.test.js ApexWeb/tests/quali.test.js
git commit -m "refactor(apexweb): quali uses setup satisfaction; retire run-plans code"
```

---

## Task 11: Balance — convergence corridor

**Files:**
- Modify: `ApexWeb/tools/balance.mjs` (add a block)

- [ ] **Step 1: Add a convergence harness** to `balance.mjs`: simulate a "good tuning policy" (each session: send a long stint, then move each axis toward its revealed window centre, repeat) across 3 sessions and report final satisfaction; also run a full auto-sim policy. Print:

```
practice: good-policy satisfaction after 3 sessions = NN%  (target ≥75% all axes reachable)
practice: full auto-sim satisfaction = NN%               (target ~60-70%, worse than hands-on)
```

Use `newSession`/`setAxis`/`sendRun`/`step`/`autoSim`/`carView`. The "good policy" reads `windowFor(knowledge, ideal, ...)`... but it must NOT cheat by reading `ideal` directly — it nudges toward `window.center` (the revealed centre), which is the honest player view.

- [ ] **Step 2: Run + verify corridor** — `node tools/balance.mjs 2>&1 | grep -i "practice:"`. Good-policy should reach ≥75% (ideally 85-100%); auto-sim should land ~60-75% and below good-policy. Tune `KNOW_PER_LAP`/`SAT_TOL`/`SESSION_SEC` in `data.js` if outside corridor; re-run the model tests after any const change.

- [ ] **Step 3: Confirm race corridor unchanged** — `node tools/balance.mjs 2>&1 | grep -E "DNF|pace spread"` → DNF ~1.3, spread ~2.3-2.5 (the race sim is untouched; satisfaction→setupBonus uses the same scale).

- [ ] **Step 4: Commit**

```bash
git add ApexWeb/tools/balance.mjs ApexWeb/src/data.js
git commit -m "test(apexweb): practice convergence corridor + verify race corridor holds"
```

---

## Task 12: README + memory + final verification

**Files:**
- Modify: `ApexWeb/README.md`
- Verify: full suite + preview

- [ ] **Step 1: README.** Replace the "Практика — план прогонов" section with a "Практика — живые сессии" section: 3 sessions P1/P2/P3 with a live clock + acceleration, 6 setup axes, per-lap knowledge with a narrowing ideal window + driver feedback, satisfaction → race buff, per-car co-op. Update the structure map: add `src/practice_session.js`; update `src/setup.js` (6 axes) and `src/ui/practice.js` (live session) lines; refresh the test-count parenthetical.

- [ ] **Step 2: Final full verification.** `node --test --test-reporter=tap > /tmp/s.tap 2>&1; grep -E "^# (tests|pass|fail)" /tmp/s.tap` → `# fail 0`. `node tools/balance.mjs` corridors hold. Preview: a full P1→P2→P3→quali→race pass, satisfaction carries, HUD aid shows. No console errors.

- [ ] **Step 3: Commit**

```bash
git add ApexWeb/README.md
git commit -m "docs(apexweb): README — real-time practice sessions"
```

- [ ] **Step 4: Owner note.** The live two-browser co-op session (host runs the clock, both render their own car) is not headless-verifiable — needs an F5 two-instance playtest. Everything else (session model, knowledge, satisfaction, convergence) is unit + balance covered.

---

## Self-review notes

- **Spec coverage:** clock+speed+autosim (T1,T5,T7,T9) · 6 axes+ideal (T2) · narrowing window+feedback (T3) · knowledge+confirm-after-laps (T4) · 3 sessions (T6) · host loop+netcode (T7,T8) · per-car co-op (T7-T9) · screen (T9) · satisfaction→setupBonus + strategy HUD aid (T8,T10) · convergence corridor (T11) · docs (T12). All spec sections map to a task.
- **Type consistency:** session state shape (`cars.{p1,p2}.{setup,knowledge,lapsOnVal,confirmedSat,onTrack,compound,stintLeft,strategy,…}`) is defined in T4 and read identically in T5/T7/T8/T9. Commands `prac_axis/prac_run/prac_speed/prac_pause/prac_auto` are emitted by T9 and handled by T8 with matching fields. Snapshot `cars.pN.axes[i].{value,knowledge,confirmedSat,window:{center,half},feedback:{state,text}}` is produced in T5 and consumed in T9. `setupBonus` from `satisfaction` via `paceBonus` (T8) matches quali's read (T10).
- **Determinism:** all randomness is `mix32(seed+…)` (setup ideal/window) or seeded `RNG` — no `Date.now`/`Math.random` in the model; the host clock only sets how many `step` laps run.
