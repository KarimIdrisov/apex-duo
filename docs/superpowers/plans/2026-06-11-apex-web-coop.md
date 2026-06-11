# Apex Web — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static, browser-based co-op F1 game — two players run one team's two cars through a full weekend (practice → setup → quali → race) on one track, online via WebRTC P2P, deployable to GitHub Pages.

**Architecture:** Pure deterministic sim core (`rng`, `data`, `sim`, weekend state machine) usable in both Node (tests + balance harness) and the browser. Host-authoritative netcode: the host browser runs the sim, the client sends commands and renders snapshots. DOM-based UI; Canvas only for the minimap.

**Tech Stack:** Vanilla JS ES modules, no build step. `package.json` with `"type":"module"` so the same `.js` files run under Node's built-in test runner and in `<script type="module">`. PeerJS (CDN `<script>`) for WebRTC signaling/transport — the only runtime dependency, online-only.

---

## File Structure

```
ApexWeb/
  package.json          {"type":"module"}  — makes .js = ESM in Node too
  index.html            shell: <canvas>, PeerJS CDN, entry main.js
  style.css             dark pit-wall theme
  src/
    rng.js              seeded LCG + mix32 (determinism)
    data.js             TEAMS (11/22), TRACK (Barcelona), COMPOUNDS, PACE_MODES, ERS_MODES
    sim.js              class Race — deterministic race core (no DOM, no net)
    setup.js            hidden-ideal setup model + feedback
    quali.js            single-lap quali time + grid sort
    weekend.js          class Weekend — PRACTICE→SETUP→QUALI→RACE + ready-gate
    net.js              Net interface + LocalNet (BroadcastChannel) + P2PNet (PeerJS)
    main.js             wiring: Net + Weekend + UI; host requestAnimationFrame loop
    ui/lobby.js         create/join room, pick team
    ui/practice.js      runs + feedback + closeness
    ui/setup.js         3 sliders to hidden ideal
    ui/quali.js         one fast lap with risk; grid table
    ui/race.js          HUD variant B + minimap
  tests/
    rng.test.js
    sim.test.js
    setup.test.js
    quali.test.js
    weekend.test.js
  tools/
    balance.mjs         run N races, print corridors; tune consts here
```

Pure modules (`rng`, `data`, `sim`, `setup`, `quali`, `weekend`) never import DOM or net → the balance harness and tests run them headless under Node.

**Source data references (read for exact numbers when porting):**
- `ApexDuo_Prototype/f1_2026.gd` — `TEAMS` (driver names/skill/abbrev), `team_car()` output scalars.
- `ApexDuo_Prototype/race_sim.gd:22-49` — `COMPOUNDS`, `PACE_MODES`, `ERS_MODES`.
- `ApexDuo_Prototype/race_sim.gd:199-201` — `SKILL_K=3.0`, `CAR_K=1.2`, `DNF_BASE=0.005`.
- `ApexDuo_Prototype/race_sim.gd:2564` — Barcelona track row.

---

## Task 1: Project skeleton + test harness

**Files:**
- Create: `ApexWeb/package.json`
- Create: `ApexWeb/tests/smoke.test.js`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "apex-web",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test",
    "balance": "node tools/balance.mjs"
  }
}
```

- [ ] **Step 2: Write a smoke test**

```js
// ApexWeb/tests/smoke.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

test("node test runner works", () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 3: Run the test**

Run: `cd ApexWeb && node --test`
Expected: 1 test, 1 pass.

- [ ] **Step 4: Commit**

```bash
git add ApexWeb/package.json ApexWeb/tests/smoke.test.js
git commit -m "chore(apexweb): project skeleton + node test harness"
```

---

## Task 2: Deterministic RNG (`rng.js`)

**Files:**
- Create: `ApexWeb/src/rng.js`
- Test: `ApexWeb/tests/rng.test.js`

- [ ] **Step 1: Write the failing test**

```js
// ApexWeb/tests/rng.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { RNG, mix32 } from "../src/rng.js";

test("same seed yields same sequence", () => {
  const a = new RNG(123), b = new RNG(123);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});

test("unit() is in [0,1)", () => {
  const r = new RNG(7);
  for (let i = 0; i < 1000; i++) {
    const u = r.unit();
    assert.ok(u >= 0 && u < 1, `u=${u}`);
  }
});

test("different seeds diverge", () => {
  const a = new RNG(1), b = new RNG(2);
  assert.notEqual(a.next(), b.next());
});

test("mix32 spreads consecutive seeds", () => {
  // consecutive seeds must not produce near-identical first units
  const u1 = new RNG(mix32(1000)).unit();
  const u2 = new RNG(mix32(1001)).unit();
  assert.ok(Math.abs(u1 - u2) > 0.05, `u1=${u1} u2=${u2}`);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ApexWeb && node --test tests/rng.test.js`
Expected: FAIL — cannot find module `../src/rng.js`.

- [ ] **Step 3: Implement**

```js
// ApexWeb/src/rng.js
// Seeded LCG (numerical-recipes constants) + a 32-bit avalanche mix.
// Determinism is load-bearing: same seed -> same race (host/client + balance harness).
export class RNG {
  constructor(seed) { this.state = (seed >>> 0) || 1; }
  next() {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state;
  }
  unit() { return this.next() / 4294967296; }          // [0,1)
  range(a, b) { return a + (b - a) * this.unit(); }
  // symmetric noise in [-m, m]
  noise(m) { return (this.unit() * 2 - 1) * m; }
}

// Avalanche so seed and seed+1 give well-separated streams (events RNG).
export function mix32(x) {
  x = (x >>> 0);
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd ApexWeb && node --test tests/rng.test.js`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/rng.js ApexWeb/tests/rng.test.js
git commit -m "feat(apexweb): deterministic RNG (LCG + mix32)"
```

---

## Task 3: Data tables (`data.js`)

Port the 11 teams / 22 drivers from `f1_2026.gd` and the Barcelona track row from `race_sim.gd`. Car scalars are the already-composed `team_car()` output (power/aero/energy/rel) — read them from the Godot file or approximate per the values below (these match the prototype's tier order; refine against `f1_2026.gd` if exact figures differ).

**Files:**
- Create: `ApexWeb/src/data.js`
- Test: `ApexWeb/tests/data.test.js`

- [ ] **Step 1: Write the failing test**

```js
// ApexWeb/tests/data.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { TEAMS, TRACK, COMPOUNDS, PACE_MODES, ERS_MODES } from "../src/data.js";

test("11 teams, 22 drivers", () => {
  assert.equal(TEAMS.length, 11);
  const drivers = TEAMS.flatMap(t => t.drivers);
  assert.equal(drivers.length, 22);
});

test("driver skills in [0.5, 1.0], abbrevs unique", () => {
  const drivers = TEAMS.flatMap(t => t.drivers);
  for (const d of drivers) assert.ok(d.skill >= 0.5 && d.skill <= 1.0, d.name);
  const abbrevs = new Set(drivers.map(d => d.abbrev));
  assert.equal(abbrevs.size, 22);
});

test("each team car has power/aero/energy/rel in (0,1]", () => {
  for (const t of TEAMS)
    for (const k of ["power", "aero", "energy", "rel"])
      assert.ok(t.car[k] > 0 && t.car[k] <= 1, `${t.name}.${k}`);
});

test("track + compound/mode tables present", () => {
  assert.equal(TRACK.name, "Барселона");
  assert.ok(TRACK.laps > 0 && TRACK.lt > 0);
  for (const c of ["soft", "medium", "hard"]) assert.ok(COMPOUNDS[c]);
  for (const m of ["conserve", "balanced", "push"]) assert.ok(PACE_MODES[m]);
  for (const m of ["harvest", "balanced", "attack"]) assert.ok(ERS_MODES[m]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ApexWeb && node --test tests/data.test.js`
Expected: FAIL — cannot find module `../src/data.js`.

- [ ] **Step 3: Implement**

```js
// ApexWeb/src/data.js — ported from ApexDuo_Prototype (f1_2026.gd, race_sim.gd).
// car{} = composed team_car() scalars (power from engine, aero from chassis,
// rel = engine.rel*chassis.rel). Values track the prototype's tier order.

export const TEAMS = [
  { name:"McLaren",      color:"#ff8000", car:{power:0.93, aero:0.97, energy:0.90, rel:0.95},
    drivers:[{name:"Норрис",abbrev:"NOR",skill:0.950},{name:"Пиастри",abbrev:"PIA",skill:0.942}] },
  { name:"Mercedes",     color:"#27f4d2", car:{power:0.95, aero:0.90, energy:0.93, rel:0.94},
    drivers:[{name:"Антонелли",abbrev:"ANT",skill:0.934},{name:"Расселл",abbrev:"RUS",skill:0.928}] },
  { name:"Red Bull",     color:"#3671c6", car:{power:0.90, aero:0.93, energy:0.88, rel:0.90},
    drivers:[{name:"Ферстаппен",abbrev:"VER",skill:0.944},{name:"Аджар",abbrev:"HAD",skill:0.848}] },
  { name:"Ferrari",      color:"#e8002d", car:{power:0.94, aero:0.88, energy:0.90, rel:0.91},
    drivers:[{name:"Леклер",abbrev:"LEC",skill:0.898},{name:"Хэмилтон",abbrev:"HAM",skill:0.886}] },
  { name:"Williams",     color:"#64c4ff", car:{power:0.94, aero:0.82, energy:0.90, rel:0.88},
    drivers:[{name:"Сайнс",abbrev:"SAI",skill:0.862},{name:"Албон",abbrev:"ALB",skill:0.852}] },
  { name:"Aston Martin", color:"#229971", car:{power:0.90, aero:0.83, energy:0.88, rel:0.89},
    drivers:[{name:"Алонсо",abbrev:"ALO",skill:0.846},{name:"Стролл",abbrev:"STR",skill:0.800}] },
  { name:"Alpine",       color:"#0093cc", car:{power:0.86, aero:0.84, energy:0.85, rel:0.86},
    drivers:[{name:"Гасли",abbrev:"GAS",skill:0.816},{name:"Колапинто",abbrev:"COL",skill:0.788}] },
  { name:"RB",           color:"#6692ff", car:{power:0.90, aero:0.81, energy:0.88, rel:0.88},
    drivers:[{name:"Лоусон",abbrev:"LAW",skill:0.798},{name:"Линдблад",abbrev:"LIN",skill:0.768}] },
  { name:"Haas",         color:"#b6babd", car:{power:0.94, aero:0.79, energy:0.90, rel:0.87},
    drivers:[{name:"Окон",abbrev:"OCO",skill:0.786},{name:"Бирман",abbrev:"BEA",skill:0.760}] },
  { name:"Sauber",       color:"#52e252", car:{power:0.88, aero:0.80, energy:0.86, rel:0.86},
    drivers:[{name:"Хюлькенберг",abbrev:"HUL",skill:0.764},{name:"Бортолето",abbrev:"BOR",skill:0.738}] },
  { name:"Cadillac",     color:"#c9a227", car:{power:0.94, aero:0.78, energy:0.90, rel:0.84},
    drivers:[{name:"Перес",abbrev:"PER",skill:0.742},{name:"Боттас",abbrev:"BOT",skill:0.726}] },
];

export const TRACK = {
  name:"Барселона", laps:66, lt:80.0, pit:21.5,
  df:0.82, pw:0.55, ot:0.30, abr:1.25, harv:0.58, dep:0.55, sc:0.25, el:0.82,
};

export const COMPOUNDS = {
  soft:   { pace:-0.55, wear:2.6, cliff:65 },
  medium: { pace: 0.00, wear:1.7, cliff:78 },
  hard:   { pace: 0.55, wear:1.1, cliff:90 },
};

// pace modes: pace offset (s/lap), wear multiplier, mechanical-risk multiplier
export const PACE_MODES = {
  conserve: { pace: 0.45, wear:0.80, risk:0.4 },
  balanced: { pace: 0.00, wear:1.00, risk:1.0 },
  push:     { pace:-0.45, wear:1.30, risk:1.8 },
};

// ERS modes: pace offset (s/lap), SoC change %/lap (+harvest / -deploy)
export const ERS_MODES = {
  harvest:  { pace: 0.30, soc: 6.0 },
  balanced: { pace: 0.00, soc: 0.0 },
  attack:   { pace:-0.38, soc:-6.5 },
};

// tuning constants (start points from race_sim.gd; calibrated in tools/balance.mjs)
export const SKILL_K   = 3.0;    // s/lap per unit skill above 0.5
export const CAR_K     = 1.2;    // s/lap per (power-aero)*(pw-df) track-character bias
export const DNF_BASE  = 0.005;  // per-lap mechanical-failure scale * (1-rel)
export const CLIP_PEN  = 0.32;   // s/lap when battery spent
export const STEP      = 0.25;   // sim time-step (seconds)
export const COMBAT_GAP = 0.8;   // seconds: within this, two cars fight
export const PASS_K    = 1.6;    // pass-credit accrual per unit track.ot
export const GRID_GAP  = 0.20;   // starting time spread per grid slot (seconds)
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd ApexWeb && node --test tests/data.test.js`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/data.js ApexWeb/tests/data.test.js
git commit -m "feat(apexweb): data tables (2026 grid, Barcelona, compounds/modes)"
```

---

## Task 4: Sim core — single-car lap stepping (`sim.js` part 1)

Builds `class Race` with car state and the per-tick lap-time + tyre + ERS math. No combat/pits yet — verify the pace model and determinism first.

**Files:**
- Create: `ApexWeb/src/sim.js`
- Test: `ApexWeb/tests/sim.test.js`

- [ ] **Step 1: Write the failing test**

```js
// ApexWeb/tests/sim.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { Race } from "../src/sim.js";
import { TEAMS, TRACK } from "../src/data.js";

function field() {
  // flat field: every team's two drivers, no players yet
  let idx = 0;
  return TEAMS.flatMap(t => t.drivers.map(d => ({
    idx: idx++, name:d.name, abbrev:d.abbrev, skill:d.skill,
    car:t.car, color:t.color, team:t.name,
    setup:[0.5,0.5,0.5], startTyre:"medium",
  })));
}

function runToFinish(seed) {
  const r = new Race(field(), TRACK, seed);
  let guard = 0;
  while (!r.finished && guard++ < 500000) r.step();
  return r;
}

test("a car records laps and lap times in a sane range", () => {
  const r = new Race(field(), TRACK, 42);
  for (let i = 0; i < 1000; i++) r.step();
  const c = r.cars[0];
  assert.ok(c.lap >= 1, "should have completed at least one lap");
  // clean Barcelona lap ~ 78-86s for the fastest cars
  assert.ok(c.lastLap > 70 && c.lastLap < 95, `lastLap=${c.lastLap}`);
});

test("push is faster than conserve, all else equal", () => {
  const f = field();
  const r = new Race(f, TRACK, 1);
  r.setPace(0, "push"); r.setPace(1, "conserve");
  // give them identical drivers/cars for the comparison
  r.cars[1].skill = r.cars[0].skill; r.cars[1].car = r.cars[0].car;
  let t0 = 0, t1 = 0, n = 0;
  for (let i = 0; i < 4000; i++) {
    r.step();
    if (r.cars[0].lastLap) { t0 += r.cars[0].lastLap; t1 += r.cars[1].lastLap; n++; }
  }
  assert.ok(r.cars[0].avgLap < r.cars[1].avgLap, "push should average faster");
});

test("determinism: same seed -> identical finish order", () => {
  const a = runToFinish(7).order().map(c => c.abbrev);
  const b = runToFinish(7).order().map(c => c.abbrev);
  assert.deepEqual(a, b);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ApexWeb && node --test tests/sim.test.js`
Expected: FAIL — cannot find module `../src/sim.js`.

- [ ] **Step 3: Implement (part 1 — no combat/pits yet)**

```js
// ApexWeb/src/sim.js
import { RNG, mix32 } from "./rng.js";
import { COMPOUNDS, PACE_MODES, ERS_MODES, SKILL_K, CAR_K, CLIP_PEN, STEP } from "./data.js";

export class Race {
  constructor(field, track, seed) {
    this.track = track;
    this.rng = new RNG(seed);
    this.erng = new RNG(mix32(seed));
    this.time = 0;
    this.finished = false;
    this.cars = field.map((f, i) => ({
      idx: i, name: f.name, abbrev: f.abbrev, skill: f.skill, car: f.car,
      color: f.color, team: f.team, isPlayer: !!f.isPlayer, player: f.player ?? null,
      setup: f.setup ?? [0.5, 0.5, 0.5], setupBonus: f.setupBonus ?? 0,
      lap: 0, lapFrac: 0, lapTimeAccum: 0, lastLap: 0, totalTime: 0,
      avgLap: 0, _lapSum: 0, _lapN: 0,
      tyre: f.startTyre ?? "medium", wear: 0, soc: 60,
      pace: "balanced", ers: "balanced",
      retired: false, pitPending: null, pos: i + 1,
    }));
  }

  setPace(i, mode) { if (PACE_MODES[mode]) this.cars[i].pace = mode; }
  setErs(i, mode) { if (ERS_MODES[mode]) this.cars[i].ers = mode; }

  // clean lap time for one car right now (seconds)
  _lapTime(c) {
    const t = this.track, comp = COMPOUNDS[c.tyre], pm = PACE_MODES[c.pace], em = ERS_MODES[c.ers];
    let s = t.lt;
    s -= SKILL_K * (c.skill - 0.5);
    s -= CAR_K * ((c.car.power - c.car.aero) * (t.pw - t.df));   // track-character bias
    s += comp.pace + this._wearTerm(c, comp);
    s += pm.pace;
    s += em.pace + (c.soc <= 0 ? CLIP_PEN : 0);
    s += c.setupBonus;                                           // <=0, faster when set well
    s += this.rng.noise(0.06);
    return s;
  }

  _wearTerm(c, comp) {
    // linear up to the cliff, then steep
    if (c.wear <= comp.cliff) return c.wear * 0.012;
    return comp.cliff * 0.012 + (c.wear - comp.cliff) * 0.10;
  }

  step(dt = STEP) {
    if (this.finished) return;
    this.time += dt;
    for (const c of this.cars) {
      if (c.retired) continue;
      const lt = this._lapTime(c);
      c.lapFrac += dt / lt;
      c.lapTimeAccum += dt;
      if (c.lapFrac >= 1) {            // lap completed (phase 3 owns bookkeeping)
        c.lapFrac -= 1;
        c.lap += 1;
        c.lastLap = c.lapTimeAccum;
        c._lapSum += c.lastLap; c._lapN++; c.avgLap = c._lapSum / c._lapN;
        c.totalTime += c.lastLap;
        c.lapTimeAccum = 0;
        // per-lap wear + SoC
        const comp = COMPOUNDS[c.tyre], pm = PACE_MODES[c.pace], em = ERS_MODES[c.ers];
        c.wear += comp.wear * pm.wear;
        c.soc = Math.max(0, Math.min(100, c.soc + em.soc));
        if (c.lap >= this.track.laps) c.retired = c.retired; // finishers handled in order()
      }
    }
    if (this.cars.every(c => c.retired || c.lap >= this.track.laps)) this.finished = true;
  }

  // race position: more laps first, then further along current lap
  order() {
    return [...this.cars].sort((a, b) => {
      const al = a.lap + a.lapFrac, bl = b.lap + b.lapFrac;
      if (a.retired !== b.retired) return a.retired ? 1 : -1;
      return bl - al;
    }).map((c, i) => { c.pos = i + 1; return c; });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd ApexWeb && node --test tests/sim.test.js`
Expected: 3 tests pass. If `lastLap` is out of range, adjust `_wearTerm`/noise — do NOT loosen the test bounds without reason.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/sim.js ApexWeb/tests/sim.test.js
git commit -m "feat(apexweb): sim core — lap-time/tyre/ERS model + determinism"
```

---

## Task 5: Sim core — combat, pits, DNF, grid (`sim.js` part 2)

Adds wheel-to-wheel hold-up + passing, pit stops, DNF rolls, and grid-spread start. Preserves the **invariant**: combat writes only `lapFrac`, never `lap`.

**Files:**
- Modify: `ApexWeb/src/sim.js`
- Test: `ApexWeb/tests/sim.test.js` (add cases)

- [ ] **Step 1: Add failing tests**

```js
// append to ApexWeb/tests/sim.test.js
import { COMBAT_GAP } from "../src/data.js";

test("invariant: lap completions never exceed lap counter", () => {
  const r = new Race(field(), TRACK, 99);
  let guard = 0;
  while (!r.finished && guard++ < 500000) {
    r.step();
    for (const c of r.cars) assert.ok(c.lapFrac >= 0 && c.lapFrac < 1.0001, `frac=${c.lapFrac}`);
  }
});

test("a clearly faster car gains positions over a stint", () => {
  const f = field();
  const r = new Race(f, TRACK, 3);
  // start car 21 (last) with a big pace edge; check it climbs
  r.cars[21].skill = 1.0; r.cars[21].car = { power:0.99, aero:0.99, energy:0.95, rel:0.99 };
  r.gridStart(); // worst skill starts last
  const startPos = r.order().find(c => c.idx === 21).pos;
  for (let i = 0; i < 6000; i++) r.step();
  const endPos = r.order().find(c => c.idx === 21).pos;
  assert.ok(endPos < startPos, `start=${startPos} end=${endPos}`);
});

test("requestPit serves a stop and switches compound", () => {
  const r = new Race(field(), TRACK, 5);
  r.requestPit(0, "hard");
  let guard = 0;
  while (r.cars[0].lap < 3 && guard++ < 50000) r.step();
  assert.equal(r.cars[0].tyre, "hard");
  assert.ok(r.cars[0].pitStops === 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ApexWeb && node --test tests/sim.test.js`
Expected: FAIL — `r.gridStart`/`r.requestPit`/`pitStops` not defined.

- [ ] **Step 3: Implement (extend the class)**

Add these to the constructor car objects: `pitStops: 0, pitTimer: 0`. Add methods and wire combat into `step()`:

```js
// in constructor car map, add: pitStops: 0, pitTimer: 0,

requestPit(i, compound) { this.cars[i].pitPending = compound; }

// spread the start by skill: best skill -> P1, GRID_GAP seconds per slot
gridStart() {
  const sorted = [...this.cars].sort((a, b) => b.skill - a.skill);
  sorted.forEach((c, slot) => { c.lap = 0; c.lapFrac = -slot * (GRID_GAP / this.track.lt); });
}

// combat: a follower within COMBAT_GAP of the car ahead is held up and builds
// pass-credit from its pace edge; passes when credit beats track resistance.
// Writes ONLY lapFrac (relative to the car's own lap). Never assigns lap.
_resolveCombat() {
  const ord = this.order(); // sorted leaders-first; pos set
  for (let i = 1; i < ord.length; i++) {
    const ahead = ord[i - 1], me = ord[i];
    if (me.retired || ahead.retired) continue;
    const gapLaps = (ahead.lap + ahead.lapFrac) - (me.lap + me.lapFrac);
    const gapSec = gapLaps * this.track.lt;
    if (gapSec > 0 && gapSec < COMBAT_GAP && me.lap === ahead.lap) {
      const edge = this._lapTime(ahead) - this._lapTime(me);   // >0 => me faster
      me._passCredit = (me._passCredit ?? 0) + Math.max(0, edge) * (me.ers === "attack" ? 1.5 : 1);
      const resist = (1 - this.track.ot) * 2.0;                 // high where ot low
      if (me._passCredit < resist) {
        // pinned: clamp just behind the car ahead (dirty-air hold-up)
        const target = (ahead.lap + ahead.lapFrac) - (COMBAT_GAP * 0.5) / this.track.lt;
        const desiredFrac = target - me.lap;
        if (desiredFrac < me.lapFrac) me.lapFrac = Math.max(0, desiredFrac);
      } else {
        me._passCredit = 0; // pass completes naturally next ticks (no lap write)
      }
    } else {
      me._passCredit = 0;
    }
  }
}

_serveLapEnd(c) {
  // called at lap completion in step(); handles pit + DNF
  if (c.pitPending) {
    c.tyre = c.pitPending; c.pitPending = null; c.wear = 0;
    c.pitStops += 1; c.totalTime += this.track.pit;
    c.lapFrac -= this.track.pit / this.track.lt;            // lose pit time on track
    if (c.lapFrac < 0) c.lapFrac = 0;
  }
  const pm = PACE_MODES[c.pace];
  if (this.erng.unit() < DNF_BASE * (1 - c.car.rel) * pm.risk) c.retired = true;
}
```

Wire into `step()`: after the per-car advance loop, call `this._resolveCombat()`; and at the lap-completion branch replace the wear/SoC block tail with a call to `this._serveLapEnd(c)` **after** updating wear/soc. Import `DNF_BASE`, `GRID_GAP` from `./data.js`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd ApexWeb && node --test tests/sim.test.js`
Expected: all sim tests pass (6 total). Watch the invariant test especially.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/sim.js ApexWeb/tests/sim.test.js
git commit -m "feat(apexweb): sim combat/pits/DNF/grid-start (invariant preserved)"
```

---

## Task 6: Setup model (`setup.js`)

Hidden ideal per track (deterministic from seed), closeness → pace bonus + wear modifier, and worst-axis feedback text.

**Files:**
- Create: `ApexWeb/src/setup.js`
- Test: `ApexWeb/tests/setup.test.js`

- [ ] **Step 1: Write the failing test**

```js
// ApexWeb/tests/setup.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { trackIdeal, closeness, paceBonus, feedback, AXES } from "../src/setup.js";

test("ideal is deterministic from seed and in range", () => {
  const a = trackIdeal(2026), b = trackIdeal(2026);
  assert.deepEqual(a, b);
  for (const v of a) assert.ok(v >= 0 && v <= 1);
  assert.equal(a.length, 3);
});

test("closeness is 1 at the ideal, lower away from it", () => {
  const ideal = trackIdeal(10);
  assert.ok(Math.abs(closeness(ideal, ideal) - 1) < 1e-9);
  const off = ideal.map(v => (v + 0.5) % 1);
  assert.ok(closeness(off, ideal) < closeness(ideal, ideal));
});

test("paceBonus is faster (more negative) the closer you are", () => {
  assert.ok(paceBonus(1.0) < paceBonus(0.5));
  assert.ok(paceBonus(1.0) <= 0);
});

test("feedback names the worst axis", () => {
  const ideal = [0.5, 0.5, 0.5];
  const setup = [0.5, 0.0, 0.5];          // axis 1 is worst
  const fb = feedback(setup, ideal);
  assert.ok(fb.includes(AXES[1].name), fb);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ApexWeb && node --test tests/setup.test.js`
Expected: FAIL — cannot find module `../src/setup.js`.

- [ ] **Step 3: Implement**

```js
// ApexWeb/src/setup.js
import { RNG } from "./rng.js";

export const AXES = [
  { name:"Прижим",   low:"скользит в быстрых поворотах", high:"не хватает прижима в медленных" },
  { name:"Передачи", low:"упирается в потолок на прямой", high:"проседает на разгоне из поворота" },
  { name:"Подвеска", low:"нервная на поребриках",         high:"вялый отклик в связках" },
];

export function trackIdeal(seed) {
  const r = new RNG(seed ^ 0x5e7);
  return [r.unit(), r.unit(), r.unit()];
}

export function closeness(setup, ideal) {
  let err = 0;
  for (let i = 0; i < 3; i++) err += Math.abs(setup[i] - ideal[i]);
  return 1 - err / 3;                      // 1 = perfect, 0 = worst case
}

// max ~0.15 s/lap gain at perfect setup (negative = faster)
export function paceBonus(close) { return -0.15 * Math.max(0, close); }

// wear multiplier: a bad setup chews tyres up to +20%
export function wearMod(close) { return 1 + 0.2 * (1 - Math.max(0, close)); }

export function feedback(setup, ideal) {
  let worst = 0, worstErr = -1, sign = 0;
  for (let i = 0; i < 3; i++) {
    const e = Math.abs(setup[i] - ideal[i]);
    if (e > worstErr) { worstErr = e; worst = i; sign = setup[i] < ideal[i] ? -1 : 1; }
  }
  if (worstErr < 0.08) return "Машина сбалансирована — так держать.";
  const ax = AXES[worst];
  return `${ax.name}: ${sign < 0 ? ax.high : ax.low}.`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd ApexWeb && node --test tests/setup.test.js`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/setup.js ApexWeb/tests/setup.test.js
git commit -m "feat(apexweb): setup model (hidden ideal, closeness, feedback)"
```

---

## Task 7: Quali model (`quali.js`)

One flying lap per car; risk level trades speed for variance and mistake chance; grid is the sorted times.

**Files:**
- Create: `ApexWeb/src/quali.js`
- Test: `ApexWeb/tests/quali.test.js`

- [ ] **Step 1: Write the failing test**

```js
// ApexWeb/tests/quali.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { qualiLap, buildGrid } from "../src/quali.js";
import { TEAMS, TRACK } from "../src/data.js";
import { RNG } from "../src/rng.js";

const drv = TEAMS[0].drivers[0], car = TEAMS[0].car;

test("higher risk lowers the mean lap time but raises variance", () => {
  const safe = [], risky = [];
  for (let s = 0; s < 200; s++) {
    safe.push(qualiLap(drv, car, TRACK, [0.5,0.5,0.5], 0.1, new RNG(s)));
    risky.push(qualiLap(drv, car, TRACK, [0.5,0.5,0.5], 0.9, new RNG(s)));
  }
  const mean = a => a.reduce((x,y)=>x+y,0)/a.length;
  const variance = a => { const m=mean(a); return mean(a.map(v=>(v-m)**2)); };
  assert.ok(mean(risky) < mean(safe), "risky should be faster on average");
  assert.ok(variance(risky) > variance(safe), "risky should be more variable");
});

test("buildGrid returns all cars sorted fastest-first", () => {
  let idx = 0;
  const field = TEAMS.flatMap(t => t.drivers.map(d => ({
    idx: idx++, abbrev:d.abbrev, skill:d.skill, car:t.car, setup:[0.5,0.5,0.5], risk:0.5,
  })));
  const grid = buildGrid(field, TRACK, 123);
  assert.equal(grid.length, 22);
  for (let i = 1; i < grid.length; i++) assert.ok(grid[i].time >= grid[i-1].time);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ApexWeb && node --test tests/quali.test.js`
Expected: FAIL — cannot find module `../src/quali.js`.

- [ ] **Step 3: Implement**

```js
// ApexWeb/src/quali.js
import { SKILL_K, CAR_K, COMPOUNDS } from "./data.js";
import { RNG } from "./rng.js";
import { closeness, paceBonus, trackIdeal } from "./setup.js";

// one flying lap on softs. risk in [0,1]: faster mean, bigger spread, mistake chance.
export function qualiLap(drv, car, track, setup, risk, rng) {
  const ideal = trackIdeal(track.laps * 1000 + Math.round(track.lt));
  const close = closeness(setup, ideal);
  let s = track.lt + COMPOUNDS.soft.pace;
  s -= SKILL_K * (drv.skill - 0.5);
  s -= CAR_K * ((car.power - car.aero) * (track.pw - track.df));
  s += paceBonus(close);
  s -= 0.35 * risk;                                  // pushing harder = faster
  s += rng.noise(0.08 + 0.45 * risk);                // ...but more variance
  if (rng.unit() < 0.12 * risk) s += rng.range(0.8, 2.5);  // mistake / lock-up
  return s;
}

export function buildGrid(field, track, seed) {
  const r = new RNG(seed);
  return field
    .map(f => ({ idx: f.idx, abbrev: f.abbrev, time: qualiLap(f, f.car, track, f.setup, f.risk ?? 0.5, r) }))
    .sort((a, b) => a.time - b.time);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd ApexWeb && node --test tests/quali.test.js`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/quali.js ApexWeb/tests/quali.test.js
git commit -m "feat(apexweb): quali model (risk/variance lap + grid sort)"
```

---

## Task 8: Weekend state machine (`weekend.js`)

Phase progression with a two-player ready-gate. Pure logic — drives which UI screen shows and gates transitions; holds per-car setup/quali choices.

**Files:**
- Create: `ApexWeb/src/weekend.js`
- Test: `ApexWeb/tests/weekend.test.js`

- [ ] **Step 1: Write the failing test**

```js
// ApexWeb/tests/weekend.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { Weekend } from "../src/weekend.js";

test("starts in lobby, advances only when both ready", () => {
  const w = new Weekend();
  assert.equal(w.phase, "lobby");
  w.start();
  assert.equal(w.phase, "practice");
  w.setReady("p1");
  assert.equal(w.phase, "practice", "one ready is not enough");
  w.setReady("p2");
  assert.equal(w.phase, "setup", "both ready advances");
});

test("ready flags reset on each new phase", () => {
  const w = new Weekend(); w.start();
  w.setReady("p1"); w.setReady("p2");          // -> setup
  assert.equal(w.ready.p1, false);
  assert.equal(w.ready.p2, false);
});

test("full phase order ends at result", () => {
  const w = new Weekend(); w.start();
  const seen = [w.phase];
  for (let i = 0; i < 4; i++) { w.setReady("p1"); w.setReady("p2"); seen.push(w.phase); }
  assert.deepEqual(seen, ["practice","setup","quali","race","result"]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ApexWeb && node --test tests/weekend.test.js`
Expected: FAIL — cannot find module `../src/weekend.js`.

- [ ] **Step 3: Implement**

```js
// ApexWeb/src/weekend.js
const ORDER = ["lobby", "practice", "setup", "quali", "race", "result"];

export class Weekend {
  constructor() {
    this.phase = "lobby";
    this.ready = { p1: false, p2: false };
    this.onPhase = null;                       // optional callback(phase)
  }
  start() { this._goto("practice"); }
  setReady(player) {
    if (player !== "p1" && player !== "p2") return;
    this.ready[player] = true;
    if (this.ready.p1 && this.ready.p2) this._advance();
  }
  _advance() {
    const i = ORDER.indexOf(this.phase);
    if (i >= 0 && i < ORDER.length - 1) this._goto(ORDER[i + 1]);
  }
  _goto(phase) {
    this.phase = phase;
    this.ready = { p1: false, p2: false };
    if (this.onPhase) this.onPhase(phase);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd ApexWeb && node --test tests/weekend.test.js`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/weekend.js ApexWeb/tests/weekend.test.js
git commit -m "feat(apexweb): weekend state machine + ready-gate"
```

---

## Task 9: Balance harness + calibration (`tools/balance.mjs`)

Run many headless races, print the corridors from the spec, and tune the `data.js` constants until they land. This is verification + calibration, not new game features.

**Files:**
- Create: `ApexWeb/tools/balance.mjs`
- Modify: `ApexWeb/src/data.js` (tuning constants only, if corridors miss)

- [ ] **Step 1: Write the harness**

```js
// ApexWeb/tools/balance.mjs
import { Race } from "../src/sim.js";
import { TEAMS, TRACK } from "../src/data.js";

function field() {
  let idx = 0;
  return TEAMS.flatMap(t => t.drivers.map(d => ({
    idx: idx++, name:d.name, abbrev:d.abbrev, skill:d.skill,
    car:t.car, color:t.color, team:t.name, setup:[0.5,0.5,0.5], startTyre:"medium",
  })));
}

const N = 40;
let dnfTotal = 0, winners = {}, topGapSum = 0;
for (let s = 0; s < N; s++) {
  const r = new Race(field(), TRACK, 1000 + s);
  r.gridStart();
  let guard = 0;
  while (!r.finished && guard++ < 500000) r.step();
  const ord = r.order();
  dnfTotal += r.cars.filter(c => c.retired).length;
  const w = ord[0].abbrev; winners[w] = (winners[w] || 0) + 1;
  // pace spread: best vs worst average lap among finishers
  const fin = r.cars.filter(c => !c.retired);
  const avgs = fin.map(c => c.avgLap).sort((a,b)=>a-b);
  topGapSum += (avgs[avgs.length-1] - avgs[0]);
}
console.log(`races: ${N}`);
console.log(`avg DNF/race: ${(dnfTotal/N).toFixed(2)}  (target ~1-2)`);
console.log(`avg pace spread best->worst: ${(topGapSum/N).toFixed(2)} s/lap (target ~1.5-2.5)`);
console.log(`winners:`, winners);
```

- [ ] **Step 2: Run it**

Run: `cd ApexWeb && node tools/balance.mjs`
Expected output shape:
```
races: 40
avg DNF/race: 1.x  (target ~1-2)
avg pace spread best->worst: 1.x-2.x s/lap (target ~1.5-2.5)
winners: { NOR: .., VER: .., ... }
```

- [ ] **Step 3: Calibrate if corridors miss**

If `avg DNF/race` is far from 1–2, scale `DNF_BASE` in `data.js`. If pace spread is off, adjust `SKILL_K`/`CAR_K`. Winners should be dominated by top teams but not 100% one driver. Re-run after each tweak. Record the final numbers in a comment at the top of `balance.mjs`.

- [ ] **Step 4: Commit**

```bash
git add ApexWeb/tools/balance.mjs ApexWeb/src/data.js
git commit -m "feat(apexweb): balance harness + calibrated corridors"
```

---

## Task 10: Net layer (`net.js`)

`Net` interface with two implementations. `LocalNet` (BroadcastChannel, two tabs same machine) is testable/dev-friendly; `P2PNet` (PeerJS) is real online. Same message protocol.

**Files:**
- Create: `ApexWeb/src/net.js`
- Test: `ApexWeb/tests/net.test.js` (LocalNet only — BroadcastChannel exists in Node ≥18)

- [ ] **Step 1: Write the failing test**

```js
// ApexWeb/tests/net.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalNet } from "../src/net.js";

test("LocalNet delivers messages between host and client", async () => {
  const host = new LocalNet("room1", "host");
  const client = new LocalNet("room1", "client");
  const got = new Promise(res => client.onMessage(m => res(m)));
  await new Promise(r => setTimeout(r, 10));
  host.send({ type: "snapshot", phase: "race" });
  const m = await got;
  assert.equal(m.type, "snapshot");
  assert.equal(m.phase, "race");
  host.close(); client.close();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ApexWeb && node --test tests/net.test.js`
Expected: FAIL — cannot find module `../src/net.js`.

- [ ] **Step 3: Implement**

```js
// ApexWeb/src/net.js
// Transport abstraction. Game code uses send()/onMessage()/role only.

export class LocalNet {              // two tabs / Node: BroadcastChannel
  constructor(room, role) {
    this.role = role;
    this.ch = new BroadcastChannel(`apexweb-${room}`);
    this._cbs = [];
    this.ch.onmessage = (e) => { for (const cb of this._cbs) cb(e.data); };
  }
  send(msg) { this.ch.postMessage(msg); }
  onMessage(cb) { this._cbs.push(cb); }
  close() { this.ch.close(); }
}

export class P2PNet {                // real online via PeerJS (global `Peer` from CDN)
  constructor(role) { this.role = role; this._cbs = []; this.conn = null; }

  // host: returns the room code (peer id). client: pass host code to join.
  async host() {
    this.peer = new Peer();
    return new Promise((resolve) => {
      this.peer.on("open", (id) => resolve(id));
      this.peer.on("connection", (conn) => { this.conn = conn; this._bind(conn); });
    });
  }
  async join(code) {
    this.peer = new Peer();
    return new Promise((resolve, reject) => {
      this.peer.on("open", () => {
        this.conn = this.peer.connect(code);
        this.conn.on("open", () => resolve());
        this.conn.on("error", reject);
        this._bind(this.conn);
      });
    });
  }
  _bind(conn) { conn.on("data", (d) => { for (const cb of this._cbs) cb(d); }); }
  send(msg) { if (this.conn && this.conn.open) this.conn.send(msg); }
  onMessage(cb) { this._cbs.push(cb); }
  close() { if (this.peer) this.peer.destroy(); }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd ApexWeb && node --test tests/net.test.js`
Expected: LocalNet test passes. (P2PNet is browser-only — verified manually in Task 16.)

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/net.js ApexWeb/tests/net.test.js
git commit -m "feat(apexweb): net layer (LocalNet + P2PNet) with shared protocol"
```

---

## Task 11: Shell + wiring + host loop (`index.html`, `style.css`, `main.js`)

The page shell, the dark theme, and the integration loop: host runs the sim and broadcasts snapshots; both sides route commands and render the current phase's UI. UI modules are stubbed here (each shows its phase name) and filled in Tasks 12–15.

**Files:**
- Create: `ApexWeb/index.html`, `ApexWeb/style.css`, `ApexWeb/src/main.js`
- Create stubs: `ApexWeb/src/ui/lobby.js`, `practice.js`, `setup.js`, `quali.js`, `race.js`

- [ ] **Step 1: index.html**

```html
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Apex Web</title>
  <link rel="stylesheet" href="style.css" />
  <script src="https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js"></script>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="src/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: style.css (dark pit-wall theme)**

```css
:root{--bg:#0b0e13;--panel:#11151c;--ink:#c7ced8;--muted:#7c8696;--accent:#1d6fd6;
  --good:#3ddc84;--warn:#e7c84b;--bad:#e7553b;}
*{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);
  font-family:system-ui,sans-serif} #app{max-width:760px;margin:0 auto;padding:14px}
.panel{background:var(--panel);border-radius:10px;padding:14px;margin-bottom:10px}
button{font:inherit} .seg{display:flex;gap:6px} .seg button{flex:1;padding:10px;border:0;
  border-radius:6px;background:#262b36;color:var(--ink)} .seg button.on{background:var(--accent);
  color:#fff;font-weight:700} .bar{height:14px;background:#262b36;border-radius:7px;overflow:hidden}
.bar>i{display:block;height:100%} .primary{background:var(--accent);color:#fff;border:0;
  border-radius:6px;padding:11px;font-weight:700;width:100%} .ready{background:var(--good);
  color:#062b16;border:0;border-radius:6px;padding:11px;font-weight:700;width:100%}
.label{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}
```

- [ ] **Step 3: UI stubs (each phase module exports render(ctx))**

```js
// ApexWeb/src/ui/lobby.js  (and practice.js, setup.js, quali.js, race.js — same stub, change label)
export function render(root, ctx) {
  root.innerHTML = `<div class="panel"><h2>LOBBY</h2></div>`;
}
```
Create all five with their phase label (`LOBBY`, `PRACTICE`, `SETUP`, `QUALI`, `RACE`).

- [ ] **Step 4: main.js — wiring + host loop**

```js
// ApexWeb/src/main.js
import { Weekend } from "./weekend.js";
import { LocalNet, P2PNet } from "./net.js";
import { Race } from "./sim.js";
import { TEAMS, TRACK, STEP } from "./data.js";
import * as lobby from "./ui/lobby.js";
import * as practice from "./ui/practice.js";
import * as setup from "./ui/setup.js";
import * as quali from "./ui/quali.js";
import * as race from "./ui/race.js";

const SCREENS = { lobby, practice, setup, quali, race, result: race };
const root = document.getElementById("app");

export const ctx = {
  net: null, role: null, weekend: new Weekend(), race: null,
  myPlayer: null,            // "p1" (host car) | "p2" (client car)
  teamIdx: 0, snapshot: null,
  send(cmd) { this.net.send({ type: "command", ...cmd }); },
};

function rerender() { SCREENS[ctx.weekend.phase].render(root, ctx); }
ctx.weekend.onPhase = () => { if (ctx.role === "host") onPhaseHost(); rerender(); };

// HOST: handle inbound commands, run sim during race, broadcast snapshots
function onCommand(cmd) {
  if (ctx.role !== "host") return;
  switch (cmd.cmd) {
    case "ready":     ctx.weekend.setReady(cmd.player); break;
    case "set_pace":  ctx.race?.setPace(cmd.car, cmd.mode); break;
    case "set_ers":   ctx.race?.setErs(cmd.car, cmd.mode); break;
    case "request_pit": ctx.race?.requestPit(cmd.car, cmd.compound); break;
    case "toggle_pause": ctx.paused = !ctx.paused; break;
    case "set_setup": ctx.setups = ctx.setups || {}; ctx.setups[cmd.player] = cmd.setup; break;
    case "quali_risk": ctx.qrisk = ctx.qrisk || {}; ctx.qrisk[cmd.player] = cmd.risk; break;
  }
}
function onPhaseHost() {
  if (ctx.weekend.phase === "race") startRaceHost();
}
function startRaceHost() {
  // build field: player team's two drivers flagged, rest AI (filled in Task 15)
  // ctx.race = new Race(field, TRACK, seed); ctx.race.gridStart();
}
function hostLoop() {
  if (ctx.role === "host" && ctx.weekend.phase === "race" && ctx.race && !ctx.paused) {
    ctx.race.step(STEP);
    ctx.net.send({ type: "snapshot", phase: "race", paused: ctx.paused,
      cars: ctx.race.order().map(c => ({ idx:c.idx, pos:c.pos, abbrev:c.abbrev, color:c.color,
        lap:c.lap, lapFrac:c.lapFrac, tyre:c.tyre, wear:c.wear, soc:c.soc, pace:c.pace,
        ers:c.ers, retired:c.retired, isPlayer:c.isPlayer })) });
  }
  requestAnimationFrame(hostLoop);
}

// CLIENT: render from snapshots; commands go to host
function onMessage(m) {
  if (m.type === "snapshot") { ctx.snapshot = m; rerender(); }
  if (m.type === "phase")    { ctx.weekend.phase = m.phase; rerender(); }
  if (ctx.role === "host" && m.type === "command") onCommand(m);
}

// connection entry points used by lobby UI
export async function hostGame(useP2P) {
  ctx.role = "host"; ctx.myPlayer = "p1";
  ctx.net = useP2P ? new P2PNet("host") : new LocalNet("dev", "host");
  ctx.net.onMessage(onMessage);
  const code = useP2P ? await ctx.net.host() : "dev";
  requestAnimationFrame(hostLoop);
  return code;
}
export async function joinGame(code, useP2P) {
  ctx.role = "client"; ctx.myPlayer = "p2";
  ctx.net = useP2P ? new P2PNet("client") : new LocalNet("dev", "client");
  ctx.net.onMessage(onMessage);
  if (useP2P) await ctx.net.join(code);
}

rerender();
```

- [ ] **Step 5: Manual verify the shell loads**

Run: `cd ApexWeb && python -m http.server 8000` then open `http://localhost:8000`.
Expected: a dark page showing the `LOBBY` panel, no console errors.

- [ ] **Step 6: Commit**

```bash
git add ApexWeb/index.html ApexWeb/style.css ApexWeb/src/main.js ApexWeb/src/ui/
git commit -m "feat(apexweb): page shell, theme, host loop + UI stubs"
```

---

## Task 12: Lobby UI (`ui/lobby.js`)

Create/join a room and pick the team. On host, show the room code; on join, enter it.

**Files:**
- Modify: `ApexWeb/src/ui/lobby.js`

- [ ] **Step 1: Implement**

```js
// ApexWeb/src/ui/lobby.js
import { TEAMS } from "../data.js";
import { hostGame, joinGame } from "../main.js";

export function render(root, ctx) {
  const teamOpts = TEAMS.map((t,i)=>`<option value="${i}">${t.name}</option>`).join("");
  root.innerHTML = `
    <div class="panel">
      <h2>Apex Web — кооп-уикенд</h2>
      <p class="label">Команда</p>
      <select id="team">${teamOpts}</select>
      <div style="height:10px"></div>
      <button class="primary" id="host">Создать комнату</button>
      <div style="height:8px"></div>
      <input id="code" placeholder="код комнаты" style="width:100%;padding:10px" />
      <button class="primary" id="join" style="margin-top:8px">Войти</button>
      <p id="status" class="label" style="margin-top:10px"></p>
    </div>`;
  const useP2P = true;            // set false to dev with two tabs (LocalNet)
  root.querySelector("#team").onchange = e => ctx.teamIdx = +e.target.value;
  root.querySelector("#host").onclick = async () => {
    const code = await hostGame(useP2P);
    root.querySelector("#status").textContent = `Код комнаты: ${code} — передай напарнику. Жми «Готов», когда оба тут.`;
    ctx.weekend.start();          // host moves to practice; ready-gate handles the rest
    ctx.net.send({ type:"phase", phase:"practice" });
  };
  root.querySelector("#join").onclick = async () => {
    const code = root.querySelector("#code").value.trim();
    await joinGame(code, useP2P);
    root.querySelector("#status").textContent = "Подключено. Ждём старт уикенда…";
  };
}
```

- [ ] **Step 2: Manual verify (two tabs, LocalNet)**

Set `useP2P = false`, serve, open two tabs. Tab A: create room → advances to PRACTICE stub. Tab B: Войти → moves to PRACTICE stub when host starts.
Expected: both tabs show `PRACTICE`.

- [ ] **Step 3: Commit**

```bash
git add ApexWeb/src/ui/lobby.js
git commit -m "feat(apexweb): lobby UI (create/join room, team pick)"
```

---

## Task 13: Practice + Setup UI (`ui/practice.js`, `ui/setup.js`)

Practice runs reveal closeness + feedback; setup screen is the 3 sliders to the hidden ideal with the visible green ideal mark. Both end with a ready button.

**Files:**
- Modify: `ApexWeb/src/ui/practice.js`, `ApexWeb/src/ui/setup.js`

- [ ] **Step 1: Implement practice.js**

```js
// ApexWeb/src/ui/practice.js
import { TRACK } from "../data.js";
import { trackIdeal, closeness, feedback } from "../setup.js";

export function render(root, ctx) {
  ctx.setup = ctx.setup || [0.5,0.5,0.5];
  ctx.runs = ctx.runs || 0;
  const ideal = trackIdeal(TRACK.laps*1000 + Math.round(TRACK.lt));
  const close = ctx.runs > 0 ? closeness(ctx.setup, ideal) : 0;
  const fb = ctx.runs > 0 ? feedback(ctx.setup, ideal) : "Сделай прогон, чтобы пилот дал фидбэк.";
  root.innerHTML = `
    <div class="panel">
      <h2>Практика</h2>
      <p class="label">Близость к идеалу: ${ctx.runs?Math.round(close*100):"—"}%</p>
      <div class="bar"><i style="width:${close*100}%;background:linear-gradient(90deg,#e7553b,#e7c84b 60%,#3ddc84)"></i></div>
      <div class="panel" style="border-left:3px solid var(--accent)">🗣️ ${fb}</div>
      <button class="primary" id="run" ${ctx.runs>=3?"disabled":""}>▶ Прогон (${ctx.runs}/3)</button>
      <button class="ready" id="ready" style="margin-top:8px">Готов → Сетап</button>
    </div>`;
  root.querySelector("#run").onclick = () => { ctx.runs++; ctx._revealed = true; render(root, ctx); };
  root.querySelector("#ready").onclick = () => ctx.send({ cmd:"ready", player: ctx.myPlayer });
}
```

- [ ] **Step 2: Implement setup.js**

```js
// ApexWeb/src/ui/setup.js
import { TRACK } from "../data.js";
import { AXES, trackIdeal } from "../setup.js";

export function render(root, ctx) {
  ctx.setup = ctx.setup || [0.5,0.5,0.5];
  const ideal = trackIdeal(TRACK.laps*1000 + Math.round(TRACK.lt));
  const reveal = ctx._revealed;            // green mark only after a practice run
  const sliders = AXES.map((ax,i)=>`
    <div style="margin:12px 0">
      <p class="label">${ax.name}</p>
      <div style="position:relative">
        ${reveal?`<div style="position:absolute;left:${ideal[i]*100}%;top:-3px;width:2px;height:20px;background:var(--good)"></div>`:""}
        <input type="range" min="0" max="1" step="0.01" value="${ctx.setup[i]}" data-ax="${i}" style="width:100%">
      </div>
    </div>`).join("");
  root.innerHTML = `<div class="panel"><h2>Сетап</h2>${sliders}
    <button class="ready" id="ready">Готов → Квала</button></div>`;
  root.querySelectorAll("input[type=range]").forEach(el=>{
    el.oninput = e => { ctx.setup[+e.target.dataset.ax] = +e.target.value;
      ctx.send({ cmd:"set_setup", player:ctx.myPlayer, setup: ctx.setup }); };
  });
  root.querySelector("#ready").onclick = () => ctx.send({ cmd:"ready", player: ctx.myPlayer });
}
```

- [ ] **Step 3: Manual verify**

Two tabs, advance to PRACTICE → run 3 times (closeness % and feedback update) → Готов on both → SETUP shows 3 sliders with green ideal marks → drag, Готов on both → advances to QUALI stub.

- [ ] **Step 4: Commit**

```bash
git add ApexWeb/src/ui/practice.js ApexWeb/src/ui/setup.js
git commit -m "feat(apexweb): practice + setup UI (closeness, feedback, sliders)"
```

---

## Task 14: Quali UI (`ui/quali.js`)

Pick a risk level, run the lap, see your time and the resulting grid.

**Files:**
- Modify: `ApexWeb/src/ui/quali.js`

- [ ] **Step 1: Implement**

```js
// ApexWeb/src/ui/quali.js
export function render(root, ctx) {
  ctx.qrisk = ctx.qrisk ?? 0.5;
  const grid = ctx.snapshot?.grid;     // host computes + broadcasts after both run
  root.innerHTML = `
    <div class="panel">
      <h2>Квала — один быстрый круг</h2>
      <p class="label">Риск: ${Math.round(ctx.qrisk*100)}%</p>
      <input type="range" min="0" max="1" step="0.05" value="${ctx.qrisk}" id="risk" style="width:100%">
      <button class="primary" id="go" style="margin-top:8px">🏁 Поехать круг</button>
      <button class="ready" id="ready" style="margin-top:8px">Готов → Гонка</button>
      <div id="grid" style="margin-top:10px">${grid?gridHtml(grid):""}</div>
    </div>`;
  root.querySelector("#risk").oninput = e => ctx.qrisk = +e.target.value;
  root.querySelector("#go").onclick = () =>
    ctx.send({ cmd:"quali_risk", player:ctx.myPlayer, risk: ctx.qrisk });
  root.querySelector("#ready").onclick = () => ctx.send({ cmd:"ready", player: ctx.myPlayer });
}
function gridHtml(grid){
  return `<p class="label">Стартовая решётка</p>` + grid.map((g,i)=>
    `<div style="display:flex;justify-content:space-between;padding:2px 6px">
       <span>${i+1}. ${g.abbrev}</span><span>${g.time.toFixed(3)}</span></div>`).join("");
}
```

Host: on `quali_risk`, store risk; when both players + all AI risks set, call `buildGrid` (from `quali.js`) and broadcast `{type:"snapshot", grid}`. AI risk defaults to `0.5`. Wire this into `onCommand` in `main.js`.

- [ ] **Step 2: Manual verify**

Two tabs at QUALI → set risk, Поехать → grid table appears (22 rows, sorted) → Готов on both → advances to RACE stub.

- [ ] **Step 3: Commit**

```bash
git add ApexWeb/src/ui/quali.js ApexWeb/src/main.js
git commit -m "feat(apexweb): quali UI (risk lap + grid table)"
```

---

## Task 15: Race HUD (variant B) + minimap + field build (`ui/race.js`, `main.js`)

The core playable screen: driver-focused HUD with big lever buttons, gaps, tyre/SoC bars, pit button, a Canvas minimap, and the collapsible 22-car table. Also finishes `startRaceHost()` to build the field from quali grid + setups.

**Files:**
- Modify: `ApexWeb/src/ui/race.js`, `ApexWeb/src/main.js`

- [ ] **Step 1: Finish field build in main.js `startRaceHost()`**

```js
// replace the stub startRaceHost() in main.js
import { buildGrid } from "./quali.js";
import { paceBonus, closeness, trackIdeal } from "./setup.js";

function buildField() {
  let idx = 0;
  const ideal = trackIdeal(TRACK.laps*1000 + Math.round(TRACK.lt));
  return TEAMS.flatMap((t, ti) => t.drivers.map((d, di) => {
    const isPlayerTeam = ti === ctx.teamIdx;
    const player = isPlayerTeam ? (di === 0 ? "p1" : "p2") : null;
    const setup = (player && ctx.setups?.[player]) ? ctx.setups[player] : [0.5,0.5,0.5];
    return {
      idx: idx++, name:d.name, abbrev:d.abbrev, skill:d.skill, car:t.car, color:t.color,
      team:t.name, isPlayer: isPlayerTeam, player,
      setup, setupBonus: paceBonus(closeness(setup, ideal)), startTyre:"medium",
    };
  }));
}
function startRaceHost() {
  const field = buildField();
  ctx.race = new Race(field, TRACK, 1000 + (ctx.seed||0));
  // apply quali grid order as the start spread
  const grid = buildGrid(field.map(f=>({...f, risk: f.player? (ctx.qrisk?.[f.player]??0.5):0.5})), TRACK, 1234);
  grid.forEach((g, slot) => { const c = ctx.race.cars[g.idx]; c.lap = 0; c.lapFrac = -slot * (0.20/TRACK.lt); });
  ctx.paused = false;
}
```

- [ ] **Step 2: Implement race.js (HUD variant B)**

```js
// ApexWeb/src/ui/race.js
import { TRACK } from "../data.js";
const PACE=["conserve","balanced","push"], ERS=["harvest","balanced","attack"];
const PACE_L={conserve:"Save",balanced:"Norm",push:"Push"};
const ERS_L={harvest:"Harv",balanced:"Bal",attack:"Atk"};

export function render(root, ctx) {
  const snap = ctx.snapshot;
  if (!snap || !snap.cars) { root.innerHTML = `<div class="panel">Старт гонки…</div>`; return; }
  const cars = snap.cars;                                  // already pos-sorted
  const me = cars.find(c => c.isPlayer && isMine(c, ctx)) || cars.find(c=>c.isPlayer) || cars[0];
  const myPos = cars.indexOf(me);
  const ahead = cars[myPos-1], behind = cars[myPos+1];
  const wearPct = Math.max(0, 100 - me.wear);              // visual: fresh=full
  root.innerHTML = `
    <div class="panel" style="display:flex;justify-content:space-between">
      <span>🏁 ${me.lap}/${TRACK.laps}</span><span>P${me.pos} ${me.abbrev}</span>
      <button id="pause">${snap.paused?"▶":"⏸"}</button>
    </div>
    <canvas id="map" width="320" height="120" class="panel" style="display:block;width:100%"></canvas>
    <div class="panel">
      <p>${ahead?`↑ ${ahead.abbrev} +${gap(ahead,me)}`:"— лидер —"}</p>
      <p>${behind?`↓ ${behind.abbrev} +${gap(me,behind)}`:""}</p>
      <p class="label">Резина ${me.tyre} · износ</p>
      <div class="bar"><i style="width:${wearPct}%;background:linear-gradient(90deg,#3ddc84,#e7c84b 70%,#e7553b)"></i></div>
      <p class="label" style="margin-top:8px">Заряд ERS</p>
      <div class="bar"><i style="width:${me.soc}%;background:linear-gradient(90deg,#4aa3ff,#9b6bff)"></i></div>
      <p class="label" style="margin-top:10px">Темп</p>
      <div class="seg" id="pace">${PACE.map(p=>`<button class="${me.pace===p?'on':''}" data-v="${p}">${PACE_L[p]}</button>`).join("")}</div>
      <p class="label" style="margin-top:8px">ERS</p>
      <div class="seg" id="ers">${ERS.map(e=>`<button class="${me.ers===e?'on':''}" data-v="${e}">${ERS_L[e]}</button>`).join("")}</div>
      <button class="primary" id="pit" style="margin-top:10px;background:var(--bad)">⛽ В боксы → Hard</button>
    </div>
    <details class="panel"><summary>Таблица (22)</summary>${tower(cars)}</details>`;
  // handlers
  root.querySelector("#pace").onclick = e => { if(e.target.dataset.v) ctx.send({cmd:"set_pace",car:me.idx,mode:e.target.dataset.v}); };
  root.querySelector("#ers").onclick  = e => { if(e.target.dataset.v) ctx.send({cmd:"set_ers", car:me.idx,mode:e.target.dataset.v}); };
  root.querySelector("#pit").onclick  = () => ctx.send({cmd:"request_pit",car:me.idx,compound:"hard"});
  root.querySelector("#pause").onclick= () => ctx.send({cmd:"toggle_pause"});
  drawMap(root.querySelector("#map"), cars);
}
function isMine(c, ctx){ return c.player ? c.player === ctx.myPlayer : false; }
function gap(a,b){ return Math.abs(((a.lap+a.lapFrac)-(b.lap+b.lapFrac))*TRACK.lt).toFixed(1); }
function tower(cars){
  return cars.map(c=>`<div style="display:flex;justify-content:space-between;padding:2px 6px;
    ${c.isPlayer?'background:#1d6fd6;color:#fff;border-radius:3px':''}">
    <span>${c.pos} ${c.abbrev}</span><span>${c.retired?'DNF':c.tyre}</span></div>`).join("");
}
function drawMap(cv, cars){
  const g = cv.getContext("2d"); g.clearRect(0,0,cv.width,cv.height);
  // simple oval track
  const cx=cv.width/2, cy=cv.height/2, rx=cv.width/2-16, ry=cv.height/2-12;
  g.strokeStyle="#2a2f3a"; g.lineWidth=10; g.beginPath(); g.ellipse(cx,cy,rx,ry,0,0,Math.PI*2); g.stroke();
  for(const c of cars){ if(c.retired) continue;
    const a=(c.lapFrac)*Math.PI*2 - Math.PI/2;
    g.fillStyle=c.isPlayer?"#fff":c.color||"#888";
    g.beginPath(); g.arc(cx+Math.cos(a)*rx, cy+Math.sin(a)*ry, c.isPlayer?5:3,0,Math.PI*2); g.fill();
  }
}
```

- [ ] **Step 3: Manual verify the full weekend (two tabs, LocalNet)**

Serve, two tabs, play through Lobby → Practice → Setup → Quali → Race. In Race: cars move on the minimap, lever buttons highlight and change pace/ERS, pit button switches tyre and adds time, pause toggles on both tabs, table shows 22 cars with your two highlighted, race ends and shows finishers.
Expected: no console errors; both tabs stay in sync; the sim is identical on a re-run with the same flow.

- [ ] **Step 4: Commit**

```bash
git add ApexWeb/src/ui/race.js ApexWeb/src/main.js
git commit -m "feat(apexweb): race HUD (variant B) + minimap + field build"
```

---

## Task 16: Online P2P verify + GitHub Pages deploy + README

Switch transport to P2P, verify two real browsers, and ship to Pages.

**Files:**
- Modify: `ApexWeb/src/ui/lobby.js` (`useP2P = true`)
- Create: `ApexWeb/README.md`
- Create: `.github/workflows/pages.yml` (deploy `ApexWeb/` to Pages)

- [ ] **Step 1: P2P smoke test**

Set `useP2P = true`. Serve locally, open two browser windows. Window A: create room → copy code. Window B: paste code → join. Play a full weekend.
Expected: connection establishes, snapshots render on the client ~10–15 Hz, commands from the client reach the host, pause is synchronous.

- [ ] **Step 2: README.md**

```markdown
# Apex Web
Браузерный кооп-F1 (одна команда, две машины; полный уикенд на одной трассе).

## Запуск локально
`cd ApexWeb && python -m http.server 8000` → http://localhost:8000
Разработка без интернета: в `src/ui/lobby.js` поставь `useP2P = false`, открой две вкладки.

## Онлайн
Хост жмёт «Создать комнату», передаёт код напарнику, тот вводит и жмёт «Войти».
Транспорт — WebRTC P2P (PeerJS). Хост-браузер авторитетен.

## Тесты и баланс
`cd ApexWeb && node --test`   — модульные тесты ядра
`cd ApexWeb && node tools/balance.mjs` — балансные коридоры
```

- [ ] **Step 3: Pages workflow**

```yaml
# .github/workflows/pages.yml
name: Deploy ApexWeb to Pages
on: { push: { branches: [main], paths: ["ApexWeb/**"] } }
permissions: { contents: read, pages: write, id-token: write }
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: "${{ steps.deploy.outputs.page_url }}" }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with: { path: "ApexWeb" }
      - id: deploy
        uses: actions/deploy-pages@v4
```

- [ ] **Step 4: Verify deploy**

Push to `main`. In repo Settings → Pages, set source to GitHub Actions. After the workflow runs, open the Pages URL in two browsers and run a P2P weekend.
Expected: game loads from Pages; P2P co-op works end-to-end.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/ui/lobby.js ApexWeb/README.md .github/workflows/pages.yml
git commit -m "feat(apexweb): enable P2P, README, GitHub Pages deploy"
```

---

## Notes for the implementer

- **Determinism is load-bearing.** Never feed real time or unordered dict iteration into the sim. Two RNG streams: `rng` (pace/wear) and `erng` (DNF/events).
- **Combat invariant:** `_resolveCombat` writes only `lapFrac`, never `lap`. Phase-3 lap-end owns wear/SoC/pit/DNF bookkeeping. The invariant test in Task 5 guards this.
- **Same `.js` runs in Node and the browser** — keep pure modules free of `window`/`document`/`Peer`.
- **Numbers are start points** from the Godot prototype. Task 9's harness is where they get locked; don't hand-tune in the UI.
- **UI renders from snapshot/state**, never mutates the sim directly — all changes go through `ctx.send(command)` to the host.
