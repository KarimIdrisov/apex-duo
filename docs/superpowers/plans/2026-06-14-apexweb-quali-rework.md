# Real-time Qualifying (Q1/Q2/Q3 knockout) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-shot risk-slider qualifying with a live real-time Q1/Q2/Q3 knockout: a clock you pause/accelerate, release your car for an out-lap → timed flying lap, watch a timing tower, and manage track evolution + a soft-tyre allocation + traffic + flags; eliminations across three segments build the starting grid. Per-car co-op.

**Architecture:** A pure deterministic session model (`quali_session.js`) keyed by car index over all 22 cars (humans + host-simulated AI), mirroring `practice_session.js` (newSession / `qualiStep(dt)` / snapshot / reducers) and the host-loop + netcode in `main.js`. Reuses the lap-time core `qualiLap` (extended with grip/tyre/traffic terms). All randomness is keyed to **lap events with stateless seeds** (never per-tick), so flags/traffic are deterministic across speeds. Spec: `docs/superpowers/specs/2026-06-14-apexweb-quali-rework-design.md`.

**Tech Stack:** Vanilla JS ES modules, no build. Tests: `node --test`. Determinism via seeded `RNG`/`mix32` (`src/rng.js`). Run commands from `ApexWeb/`.

**Conventions (read first):**
- `qualiLap(drv, car, track, setupBonus, risk, rng, carMean)` in `src/quali.js` is the per-lap time model. The session feeds it `f.setupBonus` (already per-car from practice satisfaction).
- Determinism is load-bearing: NO `Date.now()`/`Math.random()` in the model. Per-lap randomness uses `new RNG(mix32((seed>>>0) + idx*977 + lapIdx*131))` (stateless), never per-tick.
- Mirror the practice live-session patterns: `practice_session.js` (`step(s,dt)` advances by `dt*speed`, completes whole laps via `LAP_SEC=TRACK.lt`) and `main.js` (`hostLoop` practice block, `onPhaseHost`, `pushPractice`, `prac_*` commands, `isPractice`).
- Commit ONLY the listed pathspecs. NEVER `git add -A`/`.`/`-u`/`commit -a`/`git stash`. The repo has the user's parallel uncommitted work — do not touch `ApexDuo_Prototype/*`, `ApexWeb/TODO.md`, `ApexWeb/tools/*` (except `balance.mjs`), `experiments/`, `.claude/launch.json`, race3d/geom3d files. End every commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- UI strings Russian; code/comments English.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `src/data.js` | `QUALI2` tuning consts | add a block |
| `src/quali.js` | `qualiLap` (extended: grip/tyre/traffic/yellow) | extend |
| `src/quali_session.js` | pure deterministic session model (state, `qualiStep`, eliminations, tyres, traffic, flags, AI, snapshot, finalGrid) | **create** |
| `src/ui/quali.js` | live timing-tower screen | rewrite |
| `src/main.js` | host quali loop + commands + snapshot + grid wiring | modify |
| `tests/quali_session.test.js` | session model | **create** |
| `tests/quali.test.js` | extended `qualiLap` | extend |
| `tools/balance.mjs` | grid-realism corridor | add a block |
| `README.md` | Quali section | update |

**Shared shapes (defined in Task 3, used throughout):**
```
session = { seed, segment:1|2|3, clock, speed, paused, grip, flag, cars:{[idx]:carState}, classified:[{idx,pos,time}] }
flag    = null | { type:"red"|"yellow", endClock }      // red freezes the clock; yellow penalises a sector
carState= { idx, drv, car, setupBonus, player,          // player "p1"|"p2"|null(AI)
            phase:"pit"|"outlap"|"flying"|"inlap", tyre:"fresh"|"used", softSets,
            lapAcc, lapIdx, bestTime, segBest, eliminated, gridPos, risk, lapsThisRun }
```
`QUALI2` consts: `SEG_SEC:[480,420,360]`, `ELIM:[7,5,0]`, `IN:[22,15,10]`, `GRIP0:0`, `GRIP_RISE` (per game-sec), `GRIP_GAIN:1.2`, `QUALI_SOFT_SETS:3`, `USED_PENALTY:0.25`, `TRAFFIC_MAX:0.5`, `FLAG_PROB:0.015`, `RED_FREEZE_SEC:90`, `YELLOW_SEC:25`, `YELLOW_PENALTY:0.6`, `SPEEDS:[1,2,4,8]`.

---

## Task 1: `QUALI2` tuning constants (`data.js`)

**Files:** Modify `ApexWeb/src/data.js`; Test `ApexWeb/tests/data.test.js`.

- [ ] **Step 1: Failing test** — append to `ApexWeb/tests/data.test.js`:
```javascript
import { QUALI2 } from "../src/data.js";
test("QUALI2 has a sane knockout structure + tuning", () => {
  assert.deepEqual(QUALI2.IN, [22, 15, 10]);
  assert.deepEqual(QUALI2.ELIM, [7, 5, 0]);
  assert.equal(QUALI2.IN[0] - QUALI2.ELIM[0], QUALI2.IN[1], "Q1 survivors → Q2 field");
  assert.equal(QUALI2.IN[1] - QUALI2.ELIM[1], QUALI2.IN[2], "Q2 survivors → Q3 field");
  assert.ok(QUALI2.SEG_SEC.length === 3 && QUALI2.SEG_SEC.every(s => s >= 240));
  assert.ok(QUALI2.GRIP_GAIN > 0.5 && QUALI2.QUALI_SOFT_SETS >= 2 && QUALI2.SPEEDS.includes(8));
});
```
- [ ] **Step 2: Run → FAIL** — `node --test tests/data.test.js`.
- [ ] **Step 3: Implement** — append to `ApexWeb/src/data.js`:
```javascript
// Real-time qualifying tuning (spec 2026-06-14). See quali_session.js / quali.js.
export const QUALI2 = {
  IN: [22, 15, 10],          // cars entering Q1 / Q2 / Q3
  ELIM: [7, 5, 0],           // eliminated at the end of Q1 / Q2 / Q3
  SEG_SEC: [480, 420, 360],  // game-seconds per segment (8 / 7 / 6 min)
  GRIP0: 0.0,                // track grip at the start of Q1
  GRIP_RISE: 0.00045,        // grip gained per game-second of running (carries across segments, cap 1)
  GRIP_GAIN: 1.2,            // lap-time bonus (s) from green (grip 0) to fully rubbered (grip 1)
  QUALI_SOFT_SETS: 3,        // fresh soft sets per car for the whole quali
  USED_PENALTY: 0.25,        // a re-used (warm) soft set is this much slower than a fresh one
  TRAFFIC_MAX: 0.5,          // max time lost to a fully crowded out-lap window
  FLAG_PROB: 0.015,          // per-flying-lap chance of an incident (raised by attack push)
  RED_FREEZE_SEC: 90,        // a red flag freezes the clock this long
  YELLOW_SEC: 25,            // a yellow lasts this long
  YELLOW_PENALTY: 0.6,       // flat time added to a lap run under a yellow
  SPEEDS: [1, 2, 4, 8],      // time-acceleration multipliers
};
```
- [ ] **Step 4: Run → PASS** — `# fail 0`.
- [ ] **Step 5: Commit**
```bash
git add ApexWeb/src/data.js ApexWeb/tests/data.test.js
git commit -m "feat(apexweb): QUALI2 tuning consts for real-time qualifying" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: extend `qualiLap` (grip / tyre / traffic / yellow)

`qualiLap` gains optional modifiers via a trailing options object so existing callers keep working.

**Files:** Modify `ApexWeb/src/quali.js`; Test `ApexWeb/tests/quali.test.js`.

- [ ] **Step 1: Failing test** — append to `ApexWeb/tests/quali.test.js` (reuse the file's existing `test`/`assert`/imports; import `qualiLap` if not already):
```javascript
import { qualiLap } from "../src/quali.js";
import { RNG } from "../src/rng.js";
import { TRACK } from "../src/data.js";
test("qualiLap modifiers: more grip faster, used slower than fresh, traffic + yellow add time", () => {
  const drv = { skill: 0.9, attrs: { quali: 0.9, composure: 0.8 } };
  const car = { power: 0.85, aero: 0.85 };
  const base = (opts) => qualiLap(drv, car, TRACK, 0, 0.5, new RNG(1), 0.85, opts);
  const green = base({ grip: 0 }), rubbered = base({ grip: 1 });
  assert.ok(rubbered < green, `grip helps (${rubbered} < ${green})`);
  assert.ok(base({ grip: 0.5, tyre: "used" }) > base({ grip: 0.5, tyre: "fresh" }), "used slower than fresh");
  assert.ok(base({ grip: 0.5, traffic: 0.4 }) > base({ grip: 0.5, traffic: 0 }), "traffic adds time");
  assert.ok(base({ grip: 0.5, yellow: true }) > base({ grip: 0.5, yellow: false }), "yellow adds time");
});
```
- [ ] **Step 2: Run → FAIL** — `node --test tests/quali.test.js`.
- [ ] **Step 3: Implement** — in `ApexWeb/src/quali.js`, change the `qualiLap` signature to accept a final `opts` object and add the terms. Add `import { QUALI2 } from "./data.js";` to the existing data import. Replace the function with:
```javascript
export function qualiLap(drv, car, track, setupBonus, risk, rng, carMean = 0, opts = {}) {
  const grip = opts.grip ?? 0, traffic = opts.traffic ?? 0;
  let s = track.lt + COMPOUNDS.soft.pace;
  s -= SKILL_K * ((drv.attrs ? drv.attrs.quali : drv.skill) - 0.5);   // one-lap pace
  s -= CAR_PACE_K * ((car.power + car.aero) / 2 - carMean);           // absolute car performance (§18.1)
  s -= CAR_K * ((car.power - car.aero) * (track.pw - track.df));
  s += setupBonus;
  s -= QUALI2.GRIP_GAIN * grip;                                       // track evolution: rubbered = faster
  if (opts.tyre === "used") s += QUALI2.USED_PENALTY;                 // a re-used warm set is slower than fresh
  s += traffic;                                                       // time lost to traffic (0..TRAFFIC_MAX)
  if (opts.yellow) s += QUALI2.YELLOW_PENALTY;                        // a yellow sector slows the lap
  s -= 0.35 * risk;                                                   // pushing harder = faster
  s += rng.noise(0.08 + 0.45 * risk);                                // ...but more variance
  const composed = drv.attrs ? 1 - ATTRW.composure * (drv.attrs.composure - 0.5) * 2 : 1;
  if (rng.unit() < 0.12 * risk * composed) s += rng.range(0.8, 2.5);  // mistake / lock-up
  return s;
}
```
- [ ] **Step 4: Run → PASS** — `node --test tests/quali.test.js` → `# fail 0`. Confirm the existing `qualiLap`/`buildGrid` tests still pass (the new param is optional).
- [ ] **Step 5: Commit**
```bash
git add ApexWeb/src/quali.js ApexWeb/tests/quali.test.js
git commit -m "feat(apexweb): qualiLap takes grip/tyre/traffic/yellow modifiers" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `quali_session.js` — state + lap cycle + grip (one segment)

Create the model with the full state shape; implement the out-lap→flying→in-lap cycle, grip rise, and a timed flying lap. (Eliminations/tyres/traffic/flags/AI come in later tasks; their state fields exist now.)

**Files:** Create `ApexWeb/src/quali_session.js`; Test `ApexWeb/tests/quali_session.test.js`.

- [ ] **Step 1: Failing test** — create `ApexWeb/tests/quali_session.test.js`:
```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { newQuali, release, qualiStep, carView } from "../src/quali_session.js";
import { TEAMS, TRACK } from "../src/data.js";
import { driverAttrs, composeCar } from "../src/team.js";

function field() {   // all 22 cars; p1/p2 = first team's two drivers
  let idx = 0;
  return TEAMS.flatMap((t, ti) => t.drivers.map((d, di) => ({
    idx: idx++, abbrev: d.abbrev, drv: { skill: d.skill, attrs: driverAttrs(d.abbrev, d.skill) },
    car: composeCar(t.car), setupBonus: 0, player: ti === 0 ? (di === 0 ? "p1" : "p2") : null,
  })));
}

test("a released car warms on the out-lap then sets a flying time; grip rises", () => {
  let s = newQuali(7, field()); s.paused = false; s.speed = 8;
  s = release(s, "p1", "fresh", "attack");
  const g0 = s.grip;
  for (let i = 0; i < 600; i++) s = qualiStep(s, 1.0);
  const v = carView(s, "p1");
  assert.ok(v.bestTime > 60 && v.bestTime < 100, `set a flying time (${v.bestTime})`);
  assert.ok(s.grip > g0, "track rubbered in");
});

test("determinism: same seed + same release → identical flying time", () => {
  const run = () => { let s = newQuali(3, field()); s.paused = false; s.speed = 8;
    s = release(s, "p1", "fresh", "steady"); for (let i = 0; i < 600; i++) s = qualiStep(s, 1.0);
    return carView(s, "p1").bestTime; };
  assert.equal(run(), run());
});
```
- [ ] **Step 2: Run → FAIL** — module missing.
- [ ] **Step 3: Implement** — create `ApexWeb/src/quali_session.js`:
```javascript
// ApexWeb/src/quali_session.js — pure deterministic real-time qualifying (Q1/Q2/Q3).
// State keyed by car index over all cars; reuses qualiLap for the timed flying lap.
// Randomness is keyed to lap events with stateless seeds (never per-tick) → deterministic across speeds.
import { QUALI2, TRACK } from "./data.js";
import { qualiLap } from "./quali.js";
import { RNG, mix32 } from "./rng.js";

const LAP_SEC = () => TRACK.lt;
const PUSH_RISK = { steady: 0.35, attack: 0.75 };
// stateless per-lap RNG: same (seed, car, lapIdx) → same draws, independent of step cadence
function lapRng(s, idx, lapIdx) { return new RNG(mix32((s.seed >>> 0) + idx * 977 + lapIdx * 131)); }

export function newQuali(seed, field) {
  const cars = {};
  for (const f of field) cars[f.idx] = {
    idx: f.idx, abbrev: f.abbrev, drv: f.drv, car: f.car, setupBonus: f.setupBonus || 0, player: f.player ?? null,
    phase: "pit", tyre: "fresh", softSets: QUALI2.QUALI_SOFT_SETS,
    lapAcc: 0, lapIdx: 0, bestTime: Infinity, segBest: Infinity,
    eliminated: false, gridPos: 0, risk: PUSH_RISK.steady, lapsThisRun: 0,
  };
  const carMean = field.reduce((a, f) => a + (f.car.power + f.car.aero) / 2, 0) / field.length;
  return { seed: seed >>> 0, carMean, segment: 1, clock: QUALI2.SEG_SEC[0], speed: 1, paused: true,
    grip: QUALI2.GRIP0, flag: null, cars, classified: [] };
}

export function release(s, player, tyre = "fresh", push = "steady") {
  const car = Object.values(s.cars).find(c => c.player === player);
  if (!car || car.eliminated || car.phase !== "pit") return s;
  startRun(s, car, tyre, push);
  return s;
}
function startRun(s, car, tyre, push) {
  if (tyre === "fresh" && car.softSets <= 0) tyre = "used";   // out of fresh sets
  if (tyre === "fresh") car.softSets -= 1;
  car.tyre = tyre; car.risk = PUSH_RISK[push] ?? PUSH_RISK.steady;
  car.phase = "outlap"; car.lapsThisRun = 0;
}

export function abort(s, player) {
  const car = Object.values(s.cars).find(c => c.player === player);
  if (car && (car.phase === "outlap" || car.phase === "flying")) car.phase = "inlap";
  return s;
}

// one completed lap for a car, by phase.
function completeLap(s, car) {
  car.lapIdx += 1;
  if (car.phase === "outlap") { car.phase = "flying"; return; }       // out-lap just warms the tyre
  if (car.phase === "flying") {
    const rng = lapRng(s, car.idx, car.lapIdx);
    const t = qualiLap(car.drv, car.car, TRACK, car.setupBonus, car.risk, rng, s.carMean,
      { grip: s.grip, tyre: car.tyre, traffic: 0, yellow: false });   // traffic/yellow wired in later tasks
    car.bestTime = Math.min(car.bestTime, t); car.segBest = Math.min(car.segBest, t);
    car.lapsThisRun += 1;
    // a fresh run can do a 2nd flying lap on the now-warm set; otherwise pit
    if (car.lapsThisRun < 2 && car.tyre === "fresh") { car.tyre = "used"; return; }
    car.phase = "inlap"; return;
  }
  if (car.phase === "inlap") { car.phase = "pit"; return; }
}

export function qualiStep(s, dt) {
  if (s.paused || s.clock <= 0) return s;
  const adv = Math.min(s.clock, dt * s.speed);
  s.clock -= adv;
  s.grip = Math.min(1, s.grip + QUALI2.GRIP_RISE * adv);              // track rubbers in over time
  for (const idx in s.cars) {
    const car = s.cars[idx];
    if (car.eliminated || car.phase === "pit") continue;
    car.lapAcc += adv;
    let guard = 0;
    while (car.lapAcc >= LAP_SEC() && car.phase !== "pit" && guard++ < 8) { car.lapAcc -= LAP_SEC(); completeLap(s, car); }
  }
  return s;
}

export function setSpeed(s, v) { s.speed = QUALI2.SPEEDS.includes(v) ? v : s.speed; return s; }
export function setPaused(s, p) { s.paused = !!p; return s; }

export function carView(s, player) {
  const car = Object.values(s.cars).find(c => c.player === player);
  return car ? { idx: car.idx, phase: car.phase, tyre: car.tyre, softSets: car.softSets,
    bestTime: car.bestTime, eliminated: car.eliminated, gridPos: car.gridPos } : null;
}
```
- [ ] **Step 4: Run → PASS** — `node --test tests/quali_session.test.js` → `# fail 0`. Boot: `node -e "import('./src/quali_session.js').then(m=>console.log(typeof m.qualiStep))"`.
- [ ] **Step 5: Commit**
```bash
git add ApexWeb/src/quali_session.js ApexWeb/tests/quali_session.test.js
git commit -m "feat(apexweb): quali_session — lap cycle (outlap→flying→inlap) + track evolution" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: segment transitions + eliminations + `finalGrid`

At segment end, sort runners by best time, eliminate the tail (locking grid slots), carry survivors to the next segment (grip carries, clock resets, paused), and after Q3 classify everyone into a 22-car grid.

**Files:** Modify `ApexWeb/src/quali_session.js`; Test `ApexWeb/tests/quali_session.test.js`.

First add `s._bottom = 22;` to the object returned by `newQuali` (the next grid slot to fill from the back).

- [ ] **Step 1: Failing test** — append:
```javascript
import { advanceSegment, finalGrid } from "../src/quali_session.js";
// At this task there is no AI auto-release yet (Task 8), so cars set no time (segBest = Infinity) and
// eliminations fall back to car-index order — that is fine for testing the *structure* of the knockout.
test("a full knockout yields a 22-car grid: Q1 drops 7, Q2 drops 5, Q3 sets P1..P10", () => {
  let s = newQuali(11, field()); s.paused = false; s.speed = 8;
  let g = 0; while (s.segment <= 3 && g++ < 20000) {
    s = qualiStep(s, 2.0);
    if (s.clock <= 0 && s.segment <= 3) s = advanceSegment(s);
  }
  const grid = finalGrid(s);
  assert.equal(grid.length, 22, "22-car grid");
  assert.equal(new Set(grid.map(r => r.idx)).size, 22, "no duplicate cars");
  assert.deepEqual(grid.map(r => r.pos), Array.from({ length: 22 }, (_, i) => i + 1), "positions 1..22");
  // the 7 Q1-eliminated occupy P16..P22; the bottom slot exists
  assert.ok(grid[21].pos === 22, "P22 is the slowest Q1 car");
});
```
- [ ] **Step 2: Run → FAIL**.
- [ ] **Step 3: Implement** — append to `ApexWeb/src/quali_session.js` (bottom-counter: the slowest eliminated car takes the lowest free grid slot):
```javascript
// classify the current segment: sort active cars fastest-first (no-time → last by idx), eliminate the
// slowest ELIM[seg], and give each eliminated car the lowest free grid slot from the back (P22, P21, …).
export function advanceSegment(s) {
  const seg = s.segment;                                              // 1|2|3
  const active = Object.values(s.cars).filter(c => !c.eliminated);
  active.sort((a, b) => (a.segBest - b.segBest) || (a.idx - b.idx));  // fastest first; Infinity ties → by idx
  const elim = QUALI2.ELIM[seg - 1];
  const survivors = active.length - elim;
  for (let i = active.length - 1; i >= survivors; i--) {              // slowest first → lowest free slot
    const c = active[i]; c.eliminated = true; c.gridPos = s._bottom--;
  }
  if (seg < 3) {                                                      // carry survivors into the next segment
    s.segment = seg + 1; s.clock = QUALI2.SEG_SEC[seg]; s.paused = true; s.flag = null;
    for (let i = 0; i < survivors; i++) { const c = active[i]; c.segBest = Infinity; c.phase = "pit"; c.lapAcc = 0; c.lapsThisRun = 0; }
  } else {                                                            // Q3 done: survivors take P1..P10 (fastest = P1)
    for (let i = 0; i < survivors; i++) { active[i].eliminated = true; active[i].gridPos = i + 1; }
    s.segment = 4;                                                    // sentinel: quali complete
  }
  return s;
}

export function finalGrid(s) {
  const all = Object.values(s.cars).slice().sort((a, b) => a.gridPos - b.gridPos);
  return all.map((c, i) => ({ idx: c.idx, abbrev: c.abbrev, pos: i + 1, time: c.bestTime }));
}
```
Bottom-counter walk-through (verifies the slots): Q1 (22 active, elim 7, survivors 15) gives the 7 slowest `gridPos` 22→16 (`s._bottom` 22→15); Q2 (15, elim 5, survivors 10) gives 5 cars 15→11 (`s._bottom`→10); Q3 (10, elim 0) assigns survivors P1..P10. Every car ends with a unique `gridPos` in 1..22.
- [ ] **Step 4: Run → PASS** — grid is 22 cars, positions 1..22, no dupes, P22 present.
- [ ] **Step 5: Commit**
```bash
git add ApexWeb/src/quali_session.js ApexWeb/tests/quali_session.test.js
git commit -m "feat(apexweb): quali segment transitions + eliminations + finalGrid" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: tyre sets (fresh consumes, used reuses)

Already partly in Task 3 (`startRun` consumes a fresh set; out-of-fresh falls back to used). This task adds the test lock + the "2nd lap drops to used" behaviour assertion and the run-out path.

**Files:** Modify `ApexWeb/src/quali_session.js` (only if a test reveals a gap); Test `ApexWeb/tests/quali_session.test.js`.

- [ ] **Step 1: Failing test** — append:
```javascript
test("a fresh release consumes a soft set; out of fresh sets falls back to used", () => {
  let s = newQuali(5, field()); s.paused = false; s.speed = 8;
  const car = () => Object.values(s.cars).find(c => c.player === "p1");
  const sets0 = car().softSets;
  s = release(s, "p1", "fresh", "steady");
  assert.equal(car().softSets, sets0 - 1, "fresh consumed a set");
  // exhaust the sets, then a fresh request must fall back to used (no negative sets)
  for (let k = 0; k < QUALI2.QUALI_SOFT_SETS + 2; k++) { car().phase = "pit"; s = release(s, "p1", "fresh", "steady"); }
  assert.ok(car().softSets >= 0, "never negative");
  assert.equal(car().tyre, "used", "falls back to used when out of fresh");
});
```
(Import `QUALI2` at the top of the test if not present.)
- [ ] **Step 2: Run → FAIL or PASS** — if Task 3's `startRun` already satisfies this, the test passes immediately; if not, fix `startRun` so a `fresh` request with `softSets<=0` sets `tyre="used"` and does not decrement below 0. Either way, end with the test green.
- [ ] **Step 3: Implement** — (only if needed) ensure `startRun` matches Task 3's shown code.
- [ ] **Step 4: Run → PASS**.
- [ ] **Step 5: Commit**
```bash
git add ApexWeb/src/quali_session.js ApexWeb/tests/quali_session.test.js
git commit -m "test(apexweb): lock quali soft-tyre allocation (fresh consumes, run-out → used)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: traffic

When a car STARTS its flying lap, compute `traffic` from how many other cars are on a flying/out-lap right then, plus a seeded roll, and feed it to `qualiLap`.

**Files:** Modify `ApexWeb/src/quali_session.js`; Test `ApexWeb/tests/quali_session.test.js`.

- [ ] **Step 1: Failing test** — append:
```javascript
import { trafficFor } from "../src/quali_session.js";
test("traffic loss rises with the number of cars on track", () => {
  let s = newQuali(9, field());
  const car = Object.values(s.cars)[0];
  const lone = trafficFor(s, car, 0);
  // mark 12 other cars as on a flying/out lap
  let n = 0; for (const c of Object.values(s.cars)) { if (c.idx !== car.idx && n < 12) { c.phase = "flying"; n++; } }
  const crowded = trafficFor(s, car, 0);
  assert.ok(crowded > lone, `crowded track loses more (${crowded} > ${lone})`);
  assert.ok(crowded <= QUALI2.TRAFFIC_MAX + 1e-9, "capped at TRAFFIC_MAX");
});
```
- [ ] **Step 2: Run → FAIL**.
- [ ] **Step 3: Implement** — append to `quali_session.js` and call it from `completeLap` when entering the flying phase:
```javascript
// time lost to traffic when starting a flying lap: scales with the share of the field on track,
// jittered by a stateless per-lap roll so a clear window can still be unlucky (and vice-versa).
export function trafficFor(s, car, lapIdx) {
  let onTrack = 0, total = 0;
  for (const c of Object.values(s.cars)) { if (c.eliminated) continue; total++; if (c.idx !== car.idx && (c.phase === "flying" || c.phase === "outlap")) onTrack++; }
  const density = total > 1 ? onTrack / (total - 1) : 0;             // 0 (clear) .. 1 (everyone out)
  const roll = lapRng(s, car.idx, lapIdx * 3 + 1).unit();            // 0..1, stateless
  return QUALI2.TRAFFIC_MAX * density * (0.4 + 0.6 * roll);
}
```
Then in `completeLap`, when an out-lap turns into a flying lap, stamp the traffic for that run: change the out-lap branch to `if (car.phase === "outlap") { car.phase = "flying"; car._traffic = trafficFor(s, car, car.lapIdx); return; }` and in the flying branch pass `traffic: car._traffic || 0` into `qualiLap`'s opts.
- [ ] **Step 4: Run → PASS** — and the Task 3 determinism test still passes (traffic is stateless-seeded).
- [ ] **Step 5: Commit**
```bash
git add ApexWeb/src/quali_session.js ApexWeb/tests/quali_session.test.js
git commit -m "feat(apexweb): quali traffic — flying-lap time loss scales with cars on track" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: flags (red freezes + voids; yellow penalises)

A flying-lap completion can trigger an incident (seeded, raised by attack). A red flag sets `s.flag={type:"red",endClock}`, freezes the clock (handled in `qualiStep`), and voids in-progress (not-yet-completed) flying laps. A yellow adds `YELLOW_PENALTY` to laps completed during it.

**Files:** Modify `ApexWeb/src/quali_session.js`; Test `ApexWeb/tests/quali_session.test.js`.

- [ ] **Step 1: Failing test** — append:
```javascript
import { rollFlag } from "../src/quali_session.js";
test("a red flag freezes the clock and voids in-progress flying laps", () => {
  let s = newQuali(2, field()); s.paused = false;
  // force a red flag, put a car mid-flying-lap, and step: the clock must not fall, and the car's run resets
  s.flag = { type: "red", endClock: s.clock - 1 };   // active until clock passes endClock (clock counts down)
  const car = Object.values(s.cars)[0]; car.phase = "flying"; car.lapAcc = 5;
  const c0 = s.clock; s = qualiStep(s, 5.0);
  assert.equal(s.clock, c0, "clock frozen under red flag");
});
test("rollFlag is deterministic + raised by attack push", () => {
  let s = newQuali(2, field());
  const cnt = (push) => { let n = 0; for (let i = 0; i < 400; i++) if (rollFlag(s, i, push)) n++; return n; };
  assert.ok(cnt("attack") >= cnt("steady"), "attack ≥ steady incident rate");
  assert.equal(rollFlag(s, 7, "attack"), rollFlag(s, 7, "attack"), "deterministic for same (lap, push)");
});
```
- [ ] **Step 2: Run → FAIL**.
- [ ] **Step 3: Implement** —
  - Add `export function rollFlag(s, lapIdx, push) { const p = QUALI2.FLAG_PROB * (push === "attack" ? 1.8 : 1); return lapRng(s, 999, lapIdx).unit() < p; }`.
  - In `qualiStep`, at the top, handle a red flag: if `s.flag?.type === "red"`, do NOT decrement the clock (freeze) and on each step check if it should clear (`s.flag.timer -= realAdv` or a tick budget) — simplest: store `s.flag.freezeLeft = RED_FREEZE_SEC` set in game-seconds, decrement by `dt*speed` each step, clear when ≤0; while frozen, cars don't advance laps either. Implement: at top of `qualiStep`, `if (s.flag && s.flag.type === "red") { s.flag.freezeLeft -= dt * s.speed; if (s.flag.freezeLeft <= 0) s.flag = null; return s; }` (clock + cars frozen).
  - In `completeLap`'s flying branch, BEFORE scoring, call `if (rollFlag(s, car.lapIdx, car.risk >= PUSH_RISK.attack ? "attack" : "steady")) { s.flag = { type: "red", freezeLeft: QUALI2.RED_FREEZE_SEC }; car.phase = "inlap"; return; }` — the incident voids this lap (no time scored) and triggers the freeze.
  - Yellow (lighter): with a smaller seeded chance, set `s.flag = { type:"yellow", ySecLeft: QUALI2.YELLOW_SEC }`, decrement in `qualiStep` (does NOT freeze), and pass `yellow: !!(s.flag && s.flag.type==="yellow")` into `qualiLap` opts in the flying branch. Keep yellow simple; if it complicates determinism, ship red-only in v1 and note yellow as a follow-up.
- [ ] **Step 4: Run → PASS** — and determinism tests still pass (flag rolls are stateless-seeded by lapIdx).
- [ ] **Step 5: Commit**
```bash
git add ApexWeb/src/quali_session.js ApexWeb/tests/quali_session.test.js
git commit -m "feat(apexweb): quali red/yellow flags (red freezes + voids in-progress laps)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: AI release logic + `qualiSnapshot`

AI cars (and the human teammate in solo) auto-release at sensible windows; add the snapshot the UI/netcode use.

**Files:** Modify `ApexWeb/src/quali_session.js`; Test `ApexWeb/tests/quali_session.test.js`.

- [ ] **Step 1: Failing test** — append:
```javascript
import { qualiSnapshot } from "../src/quali_session.js";
test("AI cars all set a time over a segment, and the snapshot exposes the tower", () => {
  let s = newQuali(13, field()); s.paused = false; s.speed = 8;
  let g = 0; while (s.clock > 0 && g++ < 5000) s = qualiStep(s, 2.0);
  const aiCars = Object.values(s.cars).filter(c => c.player == null);
  assert.ok(aiCars.every(c => c.segBest < Infinity), "every AI set a time in Q1");
  const snap = qualiSnapshot(s);
  assert.equal(snap.phase, "quali"); assert.equal(snap.segment, 1);
  assert.equal(snap.tower.length, 22);
  assert.ok(snap.tower[0].time <= snap.tower[snap.tower.length - 1].time || snap.tower.some(r => r.time == null), "tower sorted by time");
});
```
- [ ] **Step 2: Run → FAIL**.
- [ ] **Step 3: Implement** —
  - AI auto-release: in `qualiStep`, after advancing cars, for each `car.player == null && car.phase === "pit" && !car.eliminated`, decide via a seeded, time-gated rule whether to release now: e.g. release if `s.clock < segLen*0.6 && (no time yet || s.clock < segLen*0.25)` and a `lapRng(s, idx, segment*7).unit()` window check — aim for: a banker run mid-segment and a final run late. Keep it deterministic. Give AI `tyre = car.softSets>0 ? "fresh" : "used"`, `push = "attack"` on the final run. (Concretely: track `car._aiRuns`; first release when `s.clock <= segLen*0.55`, second when `s.clock <= segLen*0.2`; both fresh while sets remain.)
  - `qualiSnapshot(s)`: build the tower = all non-? cars sorted by current standing (active by `segBest`, eliminated by `gridPos`), each `{ idx, abbrev, pos, time: isFinite(bestTime)?bestTime:null, gap, tyre, phase, eliminated, player }`; plus `{ type:"snapshot", phase:"quali", segment, clock, speed, paused, grip, flag, cut: (QUALI2.IN[segment-1]-QUALI2.ELIM[segment-1]), cars:{p1:..,p2:..} }` where the per-player blocks carry `{phase,tyre,softSets,bestTime,pos,eliminated,traffic}` for the control card.
- [ ] **Step 4: Run → PASS**.
- [ ] **Step 5: Commit**
```bash
git add ApexWeb/src/quali_session.js ApexWeb/tests/quali_session.test.js
git commit -m "feat(apexweb): quali AI auto-release + qualiSnapshot (timing tower)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: host quali loop + commands + snapshot (`main.js`)

Surgical edits mirroring the practice wiring. After editing, paste `git diff --staged -- ApexWeb/src/main.js`.

**Files:** Modify `ApexWeb/src/main.js`.

- [ ] **Step 1** — import: add `import { newQuali, qualiStep, advanceSegment, qualiSnapshot, release as qRelease, abort as qAbort, setSpeed as qSetSpeed, setPaused as qSetPaused, finalGrid } from "./quali_session.js";`.
- [ ] **Step 2** — `onPhaseHost`: add a `quali` branch that builds the field (reuse `buildField()` — it already yields `{idx,abbrev,drv?,car,setupBonus,player}`; ensure it provides `drv:{skill,attrs}` and `setupBonus`; adapt the mapping to the `newQuali` field shape), seeds `ctx.qualiSession = newQuali(ctx.seed, qualiField())`, sets `ctx._qFrame=0; ctx._qLastTs=0;`, and `pushQuali()`.
- [ ] **Step 3** — `hostLoop`: add, after the practice block, a quali block: `if (ctx.role==="host" && ctx.weekend.phase==="quali" && ctx.qualiSession && !ctx.qualiSession.paused) { const dt=Math.min(0.1, ctx._qLastTs?(ts-ctx._qLastTs)/1000:0); qualiStep(ctx.qualiSession, dt*SIM_RATE); if (ctx.qualiSession.clock<=0 && ctx.qualiSession.segment<=3) advanceSegment(ctx.qualiSession); if ((++ctx._qFrame%4)===0) pushQuali(); }` and `ctx._qLastTs = ts;`.
- [ ] **Step 4** — helpers `qualiField()` (build the 22-car field for `newQuali`, reusing the team/driver/car/setupBonus logic) and `pushQuali()` (`const snap=qualiSnapshot(ctx.qualiSession); ctx.snapshot=snap; if(ctx.net)ctx.net.send(snap); rerender();`).
- [ ] **Step 5** — `onCommand`: add `case "quali_release": if(ctx.qualiSession){ qRelease(ctx.qualiSession, cmd.player, cmd.tyre, cmd.push); pushQuali(); } break;`, `case "quali_abort": if(ctx.qualiSession){ qAbort(ctx.qualiSession, cmd.player); pushQuali(); } break;`, and reuse/add `quali_speed`/`quali_pause` (or generalise the existing speed/pause). Remove the old `case "quali_risk"`.
- [ ] **Step 6** — verify: `node --check src/main.js` → 0; grep the new symbols; `node --test tests/quali_session.test.js tests/data.test.js` → 0 fail.
- [ ] **Step 7** — Commit `git add ApexWeb/src/main.js` → `feat(apexweb): host real-time quali loop + commands + snapshot`.

---

## Task 10: live timing-tower screen (`ui/quali.js`)

Rewrite to render the session snapshot: header (segment + clock + grip + flag + speed/pause), the timing tower with the drop-zone cut line + your car/teammate highlighted, and a control card (tyre fresh/used + sets-left, traffic read, «Выпустить на круг» / «Прервать», push toggle, ready). HeroUI dark (`style.css`).

**Files:** Rewrite `ApexWeb/src/ui/quali.js`; Modify `ApexWeb/style.css` (add `.q-` rules per the approved mockup). Controller verifies in the preview.

- [ ] **Step 1** — render from `ctx.snapshot` (phase `"quali"`). Tower rows from `snap.tower`; highlight rows where `player==="p1"/"p2"` (yours/mate); rows below `snap.cut` get a drop-zone style; show `time` (`mm:ss.mmm` or "на круге…"/"нет времени"), gap to leader, tyre dot, phase status. Control card from `snap.cars[ctx.myPlayer]`: status, fresh/used buttons (disabled by `softSets`), push toggle (steady/attack), «Выпустить» → `ctx.send({cmd:"quali_release", player:ctx.myPlayer, tyre, push})` (disabled unless `phase==="pit"`), «Прервать» → `{cmd:"quali_abort", player}`. Speed pills/pause → `quali_speed`/`quali_pause`. Ready (after Q3 / `segment===4`) → `{cmd:"ready", player}`.
- [ ] **Step 2** — implement following the contract + the approved mockup + the existing `ui/practice.js` patterns (`fmt2`, segmented controls, `.panel`). Add `.q-` CSS to `style.css`.
- [ ] **Step 3** — `node -e "import('./src/ui/quali.js').then(m=>console.log(typeof m.render))"` → function.
- [ ] **Step 4** — Controller preview-verifies (cache-busted standalone render with a mock `qualiSnapshot`; DOM/inspect since the screenshot tool wedges).
- [ ] **Step 5** — Commit `git add ApexWeb/src/ui/quali.js ApexWeb/style.css` → `feat(apexweb): live quali timing-tower screen`.

---

## Task 11: grid wiring + retire the old quali

`startRaceHost` uses `finalGrid(ctx.qualiSession)` for the starting grid; retire `buildGrid` as the grid source and the `quali_risk` path.

**Files:** Modify `ApexWeb/src/main.js`, `ApexWeb/src/quali.js` (if `buildGrid` becomes unused), `ApexWeb/tests/quali.test.js`.

- [ ] **Step 1** — `startRaceHost`: replace the `buildGrid(withRisk, TRACK, 1234)` grid construction with `const grid = ctx.qualiSession ? finalGrid(ctx.qualiSession) : buildGrid(...)`; map `grid` entries (with `idx`) onto `ctx.race.cars[idx]` start slots as today (`c.lapFrac = -slot*(GRID_GAP/TRACK.lt)`). Keep the spread logic; only the source changes.
- [ ] **Step 2** — `broadcastQualiGrid` and the old `quali_risk` case are gone (removed in Task 9). If `buildGrid` now has no live caller, leave it exported (used by `tests/quali.test.js`) OR remove it + its test if the plan retired it. Grep `grep -rn "quali_risk\|broadcastQualiGrid" src/` → 0.
- [ ] **Step 3** — full suite `node --test --test-reporter=tap > /tmp/q.tap 2>&1; grep -E "^# (tests|fail)" /tmp/q.tap` → `# fail 0` (sim.test.js ≈ 11 min — budget it).
- [ ] **Step 4** — Commit `git add ApexWeb/src/main.js ApexWeb/src/quali.js ApexWeb/tests/quali.test.js` → `refactor(apexweb): race grid from the quali session; retire the one-shot quali`.

---

## Task 12: balance — grid realism corridor

**Files:** Modify `ApexWeb/tools/balance.mjs`.

- [ ] **Step 1** — add a block: run a full headless quali (build a 22-car field, `newQuali`, step to completion calling `advanceSegment` at each `clock<=0`, all cars AI), print: pole-to-last spread, Q1/Q2 cut margins, grip gain over the session, and that all 22 are classified with unique positions. Targets: spread ~2.5–4 s; every car classified; track-evo ~1–1.5 s.
- [ ] **Step 2** — `node tools/balance.mjs 2>&1 | grep -i "quali:"` → in corridor. Tune `QUALI2` consts in `data.js` if needed (re-run model tests after). Confirm race corridor (DNF/spread) unchanged.
- [ ] **Step 3** — Commit `git add ApexWeb/tools/balance.mjs` (+`data.js` if tuned) → `test(apexweb): quali grid-realism corridor`.

---

## Task 13: README + final verification

**Files:** Modify `ApexWeb/README.md`.

- [ ] **Step 1** — replace the Quali blurb (intro line + any structure-map entries) with the real-time knockout description; add `src/quali_session.js`; update `src/ui/quali.js` + `src/quali.js` lines; refresh the test count.
- [ ] **Step 2** — final full suite `# fail 0`; `node tools/balance.mjs` corridors hold; preview a full quali → race pass (controller).
- [ ] **Step 3** — Commit `git add ApexWeb/README.md` → `docs(apexweb): README — real-time Q1/Q2/Q3 qualifying`.
- [ ] **Step 4** — Owner note: the live two-browser quali (host runs the clock, both release their own car) is not headless-verifiable — needs an F5 two-instance playtest. Everything else (session model, eliminations, grip/tyres/traffic/flags, AI, grid) is unit + balance covered.

---

## Self-review notes

- **Spec coverage:** Q1/Q2/Q3 knockout + eliminations (T3,T4) · live clock/speed/pause (T3,T9) · release/out-lap/flying/abort (T3) · track evolution (T3) · soft sets (T3,T5) · traffic (T6) · flags (T7) · AI (T8) · timing tower screen (T10) · host loop + netcode (T9) · per-car co-op (T8,T9,T10) · grid → race + parc fermé (T11) · balance (T12) · docs (T13). All spec sections map.
- **Type consistency:** session/carState shape defined in T3 and read identically in T4–T11; commands `quali_release{player,tyre,push}`/`quali_abort{player}`/`quali_speed`/`quali_pause` emitted by T10 and handled by T9 with matching fields; snapshot `{phase:"quali",segment,clock,speed,paused,grip,flag,cut,tower:[{idx,abbrev,pos,time,gap,tyre,phase,eliminated,player}],cars:{p1,p2}}` produced in T8 and consumed in T10; `finalGrid` entries `{idx,abbrev,pos,time}` produced in T4 and consumed in T11.
- **Determinism:** all randomness via `lapRng(seed,idx,lapIdx)` / `rollFlag(...lapIdx)` — keyed to lap events, never per-tick; grip/clock advance continuously and deterministically with game-time. Verified by the determinism tests in T3/T6/T7.
- **Grid math:** Task 4 uses the bottom-counter (`s._bottom` from 22) — slowest eliminated car takes the lowest free slot — with a walk-through proving unique `gridPos` 1..22 across Q1/Q2/Q3.
