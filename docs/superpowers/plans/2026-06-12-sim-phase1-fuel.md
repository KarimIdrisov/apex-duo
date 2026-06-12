# Sim Engine Phase 1 — Fuel (replace battery) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the battery/ERS subsystem with fuel as a hard resource (fixed load, burn × engine mode, weight penalty, empty tank → DNF) and swap the in-race ERS lever for an engine mode (Save / Standard / Push).

**Architecture:** Evolve the deterministic per-tick race core. Add a pure `fuel.js` module (burn / weight / engine terms), thread fuel state through `sim.js` (lap-time terms, per-lap burn, fuel-out retirement), replace the ERS combat bonus and the `set_ers` command with engine-mode equivalents, and replace the HUD's ERS bar + segment with a fuel gauge + engine segment. Keep determinism and the combat invariant (`lapFrac`-only).

**Tech Stack:** Vanilla JS ES modules, Node built-in test runner (`node --test`). No new deps.

**Spec:** `docs/superpowers/specs/2026-06-12-sim-engine-redesign-design.md` (this is Phase 1 of §14).

---

## File Structure

```
ApexWeb/src/data.js     + ENGINE_MODES, FUEL consts (ERS_MODES/CLIP_PEN removed in Task 7)
ApexWeb/src/fuel.js     NEW — pure: startFuel, burnFor, weightTerm, engineTerm, fuelLaps
ApexWeb/src/sim.js      car fuel/engine state; lap-time fuel terms; per-lap burn; empty→DNF; setEngine; combat push
ApexWeb/src/main.js     set_engine command; snapshot fuel/fuelLaps/engine (drop soc/ers)
ApexWeb/src/ui/race.js  fuel gauge + engine segment (replace ERS bar + ERS segment)
ApexWeb/tools/balance.mjs   fuel corridor (push-all runs out; standard finishes)
ApexWeb/tests/fuel.test.js  NEW
ApexWeb/tests/sim.test.js   + fuel cases
```

**Note on `car.fuel`:** the per-car fuel-efficiency indicator arrives in Phase 7 (FM team model). Until then `burnFor` defaults `car.fuel` to `1`, so Phase 1 works unchanged.

---

## Task 1: data.js — ENGINE_MODES + FUEL constants

**Files:**
- Modify: `ApexWeb/src/data.js`
- Test: `ApexWeb/tests/data.test.js`

- [ ] **Step 1: Add failing test** — append to `ApexWeb/tests/data.test.js`:

```js
import { ENGINE_MODES, FUEL } from "../src/data.js";

test("engine modes + fuel constants present and ordered", () => {
  for (const m of ["save", "standard", "push"]) assert.ok(ENGINE_MODES[m], m);
  // push is faster (more negative pace) but burns more; save is the opposite
  assert.ok(ENGINE_MODES.push.pace < ENGINE_MODES.standard.pace);
  assert.ok(ENGINE_MODES.save.pace > ENGINE_MODES.standard.pace);
  assert.ok(ENGINE_MODES.push.burn > ENGINE_MODES.save.burn);
  assert.ok(FUEL.margin > 0 && FUEL.weightK > 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `ApexWeb/`): `node --test tests/data.test.js`
Expected: FAIL — `ENGINE_MODES`/`FUEL` is undefined.

- [ ] **Step 3: Implement** — add to `ApexWeb/src/data.js` immediately after the `GRID_GAP` const line:

```js
// engine modes: pace offset (s/lap), fuel burn multiplier. Replaces ERS_MODES.
export const ENGINE_MODES = {
  save:     { pace:  0.35, burn: 0.85 },
  standard: { pace:  0.00, burn: 1.00 },
  push:     { pace: -0.30, burn: 1.20 },
};
// fuel as a hard resource. fuel is measured in lap-equivalents of standard burn.
export const FUEL = {
  margin:  0.06,   // start with +6% over the exact race need
  weightK: 0.020,  // s/lap added per lap-equivalent of fuel still aboard (heavy early)
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/data.test.js` → PASS. Then `node --test` → all prior tests still green.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/data.js ApexWeb/tests/data.test.js
git commit -m "feat(apexweb): engine modes + fuel constants (sim phase 1)"
```

---

## Task 2: fuel.js — pure fuel model

**Files:**
- Create: `ApexWeb/src/fuel.js`
- Test: `ApexWeb/tests/fuel.test.js`

- [ ] **Step 1: Write the failing test** — `ApexWeb/tests/fuel.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { startFuel, burnFor, weightTerm, engineTerm, fuelLaps } from "../src/fuel.js";
import { TRACK } from "../src/data.js";

test("startFuel covers the race plus margin", () => {
  const f = startFuel(TRACK);
  assert.ok(f > TRACK.laps, "must exceed exact race need");
  assert.ok(f < TRACK.laps * 1.5, "but not wildly over");
});

test("push burns more than standard than save; car.fuel improves economy", () => {
  assert.ok(burnFor("push", 1) > burnFor("standard", 1));
  assert.ok(burnFor("standard", 1) > burnFor("save", 1));
  assert.ok(burnFor("standard", 1.2) < burnFor("standard", 1)); // efficient car burns less
  assert.equal(burnFor("standard", undefined), burnFor("standard", 1)); // defaults to 1
});

test("weight term: more fuel = slower, empty = 0", () => {
  assert.ok(weightTerm(60) > weightTerm(10));
  assert.equal(weightTerm(0), 0);
  assert.equal(weightTerm(-5), 0);
});

test("engine term: push faster (negative), save slower", () => {
  assert.ok(engineTerm("push") < 0);
  assert.ok(engineTerm("save") > 0);
  assert.equal(engineTerm("bogus"), 0);
});

test("fuelLaps = remaining laps of fuel at current burn", () => {
  // 10 units, standard burn 1.0/car.fuel 1 -> 10 laps
  assert.ok(Math.abs(fuelLaps(10, "standard", 1) - 10) < 1e-9);
  assert.ok(fuelLaps(10, "push", 1) < 10);   // pushing burns it faster
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/fuel.test.js` → FAIL (cannot find module `../src/fuel.js`).

- [ ] **Step 3: Implement** — `ApexWeb/src/fuel.js`:

```js
// ApexWeb/src/fuel.js — fuel as a hard resource (lap-equivalents of standard burn).
import { ENGINE_MODES, FUEL } from "./data.js";

export function startFuel(track) { return track.laps * (1 + FUEL.margin); }

// fuel units burned this lap. carFuel (>1 = efficient) defaults to 1 until Phase 7.
export function burnFor(engineMode, carFuel) {
  const m = ENGINE_MODES[engineMode] || ENGINE_MODES.standard;
  return m.burn / (carFuel || 1);
}

// s/lap added by the fuel still aboard (heavy early, ~0 at the end)
export function weightTerm(fuel) { return Math.max(0, fuel) * FUEL.weightK; }

// s/lap engine-mode pace offset (negative = faster)
export function engineTerm(engineMode) {
  const m = ENGINE_MODES[engineMode];
  return m ? m.pace : 0;
}

// how many more laps the current fuel lasts at the current burn (for the gauge)
export function fuelLaps(fuel, engineMode, carFuel) {
  const b = burnFor(engineMode, carFuel);
  return b > 0 ? fuel / b : Infinity;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/fuel.test.js` → 5 pass. Then `node --test` → all green.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/fuel.js ApexWeb/tests/fuel.test.js
git commit -m "feat(apexweb): pure fuel model (burn/weight/engine/fuelLaps)"
```

---

## Task 3: sim.js — fuel state, lap-time terms, burn, empty→DNF, setEngine

**Files:**
- Modify: `ApexWeb/src/sim.js`
- Test: `ApexWeb/tests/sim.test.js`

This removes the ERS/SoC terms from the sim and adds fuel. The car object loses `soc`/`ers`, gains `fuel`/`engine`.

- [ ] **Step 1: Add failing tests** — append to `ApexWeb/tests/sim.test.js`:

```js
test("fuel depletes over laps; push burns faster than save", () => {
  const f = field();
  const r = new Race(f, TRACK, 11);
  r.setEngine(0, "push"); r.setEngine(1, "save");
  r.cars[1].skill = r.cars[0].skill; r.cars[1].car = r.cars[0].car;
  const f0 = r.cars[0].fuel;
  for (let i = 0; i < 4000; i++) r.step();
  assert.ok(r.cars[0].fuel < f0, "fuel should deplete");
  // car0 (push) has burned more than car1 (save) by the same lap count
  if (r.cars[0].lap === r.cars[1].lap) assert.ok(r.cars[0].fuel < r.cars[1].fuel);
});

test("pushing the whole race runs the tank dry -> DNF", () => {
  const r = new Race(field(), TRACK, 7);
  for (const c of r.cars) c.engine = "push";   // everyone over-pushes
  let guard = 0;
  while (!r.finished && guard++ < 500000) r.step();
  // at least one car ran out of fuel before the flag (retired with fuel<=0)
  assert.ok(r.cars.some(c => c.retired && c.fuel <= 0), "someone should run dry");
});

test("determinism holds with fuel", () => {
  const run = s => { const r = new Race(field(), TRACK, s); let g = 0;
    while (!r.finished && g++ < 500000) r.step(); return r.order().map(c => c.abbrev); };
  assert.deepEqual(run(3), run(3));
});
```

(The existing `field()` helper builds cars with no `engine` set → constructor defaults it.)

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/sim.test.js` → FAIL (`r.setEngine` not a function; `c.fuel` undefined).

- [ ] **Step 3: Implement** — edit `ApexWeb/src/sim.js`:

**3a.** Change the import line (drop `ERS_MODES, CLIP_PEN`, add fuel helpers):
```js
import { COMPOUNDS, PACE_MODES, SKILL_K, CAR_K, STEP, DNF_BASE, GRID_GAP, COMBAT_GAP } from "./data.js";
import { startFuel, burnFor, weightTerm, engineTerm } from "./fuel.js";
```

**3b.** In the constructor car object, replace `soc: 60,` and the `ers: "balanced",` parts. Change:
```js
      tyre: f.startTyre ?? "medium", wear: 0, soc: 60, tyreAge: 0,
      pace: "balanced", ers: "balanced",
```
to:
```js
      tyre: f.startTyre ?? "medium", wear: 0, tyreAge: 0,
      fuel: startFuel(track), engine: "standard",
      pace: "balanced",
```

**3c.** Replace `setErs` with `setEngine`:
```js
  setEngine(i, mode) { if (ENGINE_MODES_OK(mode)) this.cars[i].engine = mode; }
```
and add this import-free guard near the top of the class file (after the imports):
```js
const ENGINE_KEYS = new Set(["save", "standard", "push"]);
function ENGINE_MODES_OK(m) { return ENGINE_KEYS.has(m); }
```

**3d.** In `_lapTime`, replace the ERS line. Change:
```js
    s += pm.pace;
    s += em.pace + (c.soc <= 0 ? CLIP_PEN : 0);
    s += c.setupBonus;                                           // <=0, faster when set well
```
to:
```js
    s += pm.pace;
    s += engineTerm(c.engine);          // fuel push/save lever
    s += weightTerm(c.fuel);            // heavy tank = slower (eases as fuel burns)
    s += c.setupBonus;                                           // <=0, faster when set well
```
Also remove the now-unused `em` local: change the destructuring line
```js
    const t = this.track, comp = COMPOUNDS[c.tyre], pm = PACE_MODES[c.pace], em = ERS_MODES[c.ers];
```
to:
```js
    const t = this.track, comp = COMPOUNDS[c.tyre], pm = PACE_MODES[c.pace];
```

**3e.** In `step()` lap completion, replace the SoC line with fuel burn. Change:
```js
        const comp = COMPOUNDS[c.tyre], pm = PACE_MODES[c.pace], em = ERS_MODES[c.ers];
        c.wear += comp.wear * pm.wear;
        c.soc = Math.max(0, Math.min(100, c.soc + em.soc));
        c.tyreAge += 1;
```
to:
```js
        const comp = COMPOUNDS[c.tyre], pm = PACE_MODES[c.pace];
        c.wear += comp.wear * pm.wear;
        c.fuel -= burnFor(c.engine, c.car.fuel);
        c.tyreAge += 1;
```

**3f.** In `_serveLapEnd`, add fuel-out retirement before the DNF roll. Change the tail:
```js
    const pm = PACE_MODES[c.pace];
    if (this.erng.unit() < DNF_BASE * (1 - c.car.rel) * pm.risk) c.retired = true;
```
to:
```js
    if (c.fuel <= 0) { c.retired = true; return; }   // ran the tank dry
    const pm = PACE_MODES[c.pace];
    if (this.erng.unit() < DNF_BASE * (1 - c.car.rel) * pm.risk) c.retired = true;
```

**3g.** In `_resolveCombat`, replace the ERS-attack bonus. Change:
```js
        me._passCredit = (me._passCredit ?? 0) + Math.max(0, edge) * (me.ers === "attack" ? 1.5 : 1);
```
to:
```js
        me._passCredit = (me._passCredit ?? 0) + Math.max(0, edge) * (me.engine === "push" ? 1.3 : 1);
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/sim.test.js` → all sim tests pass (incl. the 3 new fuel ones). Then `node --test` → all green. If "runs dry → DNF" doesn't trigger, the `ENGINE_MODES.push.burn` × race length must exceed `startFuel`; with burn 1.20 and margin 0.06 over `laps`, a full push race burns `1.20·laps > 1.06·laps` → dry well before the end. Do NOT weaken the test.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/sim.js ApexWeb/tests/sim.test.js
git commit -m "feat(apexweb): sim fuel — engine modes, weight, per-lap burn, empty→DNF"
```

---

## Task 4: main.js — set_engine command + snapshot fuel fields

**Files:**
- Modify: `ApexWeb/src/main.js`

- [ ] **Step 1: Implement** — edit `ApexWeb/src/main.js`:

**4a.** In `onCommand`, replace the `set_ers` case:
```js
    case "set_ers":   ctx.race?.setErs(cmd.car, cmd.mode); break;
```
with:
```js
    case "set_engine": ctx.race?.setEngine(cmd.car, cmd.mode); break;
```

**4b.** Add the fuel helper import at the top (after the existing setup import):
```js
import { fuelLaps } from "./fuel.js";
```

**4c.** In `raceSnapshot`, replace the per-car `soc`/`ers` fields with fuel + engine. Change:
```js
      pace: c.pace, ers: c.ers, retired: c.retired, isPlayer: c.isPlayer,
      pitStops: c.pitStops, tyreAge: c.tyreAge, lastLap: c.lastLap, startPos: c.startPos,
```
to:
```js
      pace: c.pace, engine: c.engine, retired: c.retired, isPlayer: c.isPlayer,
      fuel: c.fuel, fuelLaps: fuelLaps(c.fuel, c.engine, c.car.fuel),
      pitStops: c.pitStops, tyreAge: c.tyreAge, lastLap: c.lastLap, startPos: c.startPos,
```

- [ ] **Step 2: Verify**

Run: `node --check ApexWeb/src/main.js` from repo root (or `node --check src/main.js` inside `ApexWeb/`) → OK.
Run (inside `ApexWeb/`): `node --test` → all green (no test touches main.js, but ensure no import errors).

- [ ] **Step 3: Commit**

```
git add ApexWeb/src/main.js
git commit -m "feat(apexweb): wire set_engine command + fuel snapshot fields"
```

---

## Task 5: race.js — fuel gauge + engine segment (replace ERS)

**Files:**
- Modify: `ApexWeb/src/ui/race.js`

The HUD currently has an ERS bar (`#d-soc`) and an ERS segment (`#d-ers`). Replace both with a fuel gauge (`#d-fuel`) and an engine-mode segment (`#d-engine`).

- [ ] **Step 1: Implement** — edit `ApexWeb/src/ui/race.js`:

**5a.** Replace the ERS mode constants near the top. Change:
```js
const PACE = ["conserve", "balanced", "push"], ERS = ["harvest", "balanced", "attack"];
const PACE_L = { conserve: "Save", balanced: "Norm", push: "Push" };
const ERS_L = { harvest: "Harv", balanced: "Bal", attack: "Atk" };
```
to:
```js
const PACE = ["conserve", "balanced", "push"], ENGINE = ["save", "standard", "push"];
const PACE_L = { conserve: "Save", balanced: "Norm", push: "Push" };
const ENGINE_L = { save: "Save", standard: "Std", push: "Push" };
```

**5b.** In `buildHud`, replace the ERS bar + ERS segment block. Change:
```html
        <p class="label" style="margin-top:8px">Заряд ERS</p>
        <div class="bar"><i id="d-soc"></i></div>
        <p class="label" style="margin-top:10px">Темп</p>
        <div class="seg" id="d-pace">${PACE.map(p => `<button data-v="${p}">${PACE_L[p]}</button>`).join("")}</div>
        <p class="label" style="margin-top:8px">ERS</p>
        <div class="seg" id="d-ers">${ERS.map(e => `<button data-v="${e}">${ERS_L[e]}</button>`).join("")}</div>
```
to:
```html
        <p class="label" style="margin-top:8px">Топливо <span id="d-fuel-txt"></span></p>
        <div class="bar"><i id="d-fuel"></i></div>
        <p class="label" style="margin-top:10px">Темп</p>
        <div class="seg" id="d-pace">${PACE.map(p => `<button data-v="${p}">${PACE_L[p]}</button>`).join("")}</div>
        <p class="label" style="margin-top:8px">Мотор</p>
        <div class="seg" id="d-engine">${ENGINE.map(e => `<button data-v="${e}">${ENGINE_L[e]}</button>`).join("")}</div>
```

**5c.** In `buildHud`, replace the `#d-soc` background line and the `#d-ers` handler. Change:
```js
  root.querySelector("#d-soc").style.background = "linear-gradient(90deg,#4aa3ff,#9b6bff)";
```
to (remove it — fuel bar colour is set per-update in 5d), and change the ERS click handler:
```js
  root.querySelector("#d-ers").onclick = e => { const v = e.target.dataset && e.target.dataset.v; if (v) ctx.send({ cmd: "set_ers", car: myIdx(), mode: v }); };
```
to:
```js
  root.querySelector("#d-engine").onclick = e => { const v = e.target.dataset && e.target.dataset.v; if (v) ctx.send({ cmd: "set_engine", car: myIdx(), mode: v }); };
```

**5d.** In `updateHud`, replace the SoC bar + ERS highlight lines. Change:
```js
  $("#d-soc").style.width = Math.max(0, Math.min(100, me.soc)) + "%";
  for (const b of $("#d-pace").children) b.classList.toggle("on", b.dataset.v === me.pace);
  for (const b of $("#d-ers").children) b.classList.toggle("on", b.dataset.v === me.ers);
```
to:
```js
  const lapsLeft = TRACK.laps - me.lap;
  const ratio = lapsLeft > 0 ? Math.min(1.4, (me.fuelLaps || 0) / lapsLeft) : 1;   // >=1 means enough
  $("#d-fuel").style.width = Math.max(0, Math.min(100, ratio / 1.4 * 100)) + "%";
  $("#d-fuel").style.background = ratio >= 1 ? "var(--good)" : "var(--bad)";        // red = short
  $("#d-fuel-txt").textContent = `${(me.fuelLaps || 0).toFixed(1)} кр запас`;
  for (const b of $("#d-pace").children) b.classList.toggle("on", b.dataset.v === me.pace);
  for (const b of $("#d-engine").children) b.classList.toggle("on", b.dataset.v === me.engine);
```

- [ ] **Step 2: Verify**

Run: `node --check ApexWeb/src/ui/race.js` → OK. (Browser behaviour is verified by the owner; do not block.)

- [ ] **Step 3: Commit**

```
git add ApexWeb/src/ui/race.js
git commit -m "feat(apexweb): HUD fuel gauge + engine mode segment (replace ERS)"
```

---

## Task 6: balance.mjs — fuel corridor

**Files:**
- Modify: `ApexWeb/tools/balance.mjs`

- [ ] **Step 1: Implement** — add a fuel block to `ApexWeb/tools/balance.mjs` after the existing loop (before/after the console output is fine). Add:

```js
// fuel corridor: a full-push field should run several cars dry; a standard field should not.
function fuelRunouts(engine) {
  let dry = 0;
  for (let s = 0; s < 10; s++) {
    const r = new Race(field(), TRACK, 5000 + s);
    r.gridStart();
    for (const c of r.cars) c.engine = engine;
    let g = 0; while (!r.finished && g++ < 500000) r.step();
    dry += r.cars.filter(c => c.retired && c.fuel <= 0).length;
  }
  return dry;
}
console.log(`fuel run-outs over 10 races: push=${fuelRunouts("push")} (expect >0), standard=${fuelRunouts("standard")} (expect 0)`);
```

- [ ] **Step 2: Run it**

Run (inside `ApexWeb/`): `node tools/balance.mjs`
Expected: `push=<some >0>`, `standard=0`. If standard shows run-outs, raise `FUEL.margin`; if push shows 0, the burn/margin needs widening — adjust `ENGINE_MODES.push.burn` / `FUEL.margin` in `data.js` and re-run. Record final numbers in a comment.

- [ ] **Step 3: Commit**

```
git add ApexWeb/tools/balance.mjs ApexWeb/src/data.js
git commit -m "feat(apexweb): balance harness fuel corridor"
```

---

## Task 7: Cleanup — remove dead ERS remnants

**Files:**
- Modify: `ApexWeb/src/data.js`

- [ ] **Step 1: Remove the now-unused exports** from `ApexWeb/src/data.js`: delete the `ERS_MODES` block and the `CLIP_PEN` const line. (Verify nothing imports them: `grep -rn "ERS_MODES\|CLIP_PEN\|\.soc\|\.ers\b" ApexWeb/src` should return no live references — the snapshot and sim no longer use `soc`/`ers`.)

- [ ] **Step 2: Verify**

Run (inside `ApexWeb/`): `node --test` → all green. `node --check src/sim.js src/main.js src/ui/race.js` → OK.
Run: `grep -rn "ERS_MODES\|CLIP_PEN" ApexWeb/src ApexWeb/tools` → no matches.

- [ ] **Step 3: Commit**

```
git add ApexWeb/src/data.js
git commit -m "chore(apexweb): drop dead ERS_MODES/CLIP_PEN after fuel switch"
```

---

## Notes for the implementer

- **Determinism is load-bearing.** Fuel/weight are pure functions of state; no real time / Math.random in the sim. The `erng` still owns DNF.
- **Combat invariant preserved:** Task 3g only changes the pass-credit multiplier; `_resolveCombat` still writes `lapFrac` only.
- **`car.fuel` is optional** until Phase 7 — `burnFor` defaults it to 1.
- **Owner playtest (browser, hard-reload):** engine segment Save/Std/Push changes pace + burn; fuel gauge shows "laps of fuel" and turns red when short; pushing all race runs you dry (DNF). The ERS bar/lever is gone.
- After this phase, the next plan is **Phase 2 — Tyres v2 (warm-up + degradation curve + cliff)**.
