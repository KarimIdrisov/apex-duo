# Sim Engine Phase 2 — Tyres v2 (warm-up + degradation curve + cliff) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tyres the strategic heart: a fresh tyre starts cold (slow out-lap after a pit / partly warm at race start), warms over a couple of laps, then degrades along a curve to a cliff. The cold out-lap + fresh-tyre pace is what makes **undercut/overcut** emerge.

**Architecture:** Extract the tyre pace model into a pure `tyres.js` module (`tyreTerm`, `warmStep`, starting temps), thread a `tyreTemp` state through `sim.js` (cold after a pit, warm-up each lap, used in the lap-time term), surface it in the snapshot + a small HUD "cold tyre" hint, and add an undercut corridor to the balance harness. Determinism and the combat invariant are unchanged.

**Tech Stack:** Vanilla JS ES modules, Node `node --test`. No new deps. Driver `tyre` attribute modulation is **Phase 7** — Phase 2 uses compound-only warm-up/wear.

**Spec:** `docs/superpowers/specs/2026-06-12-sim-engine-redesign-design.md` §6 (Phase 2 of §14).

---

## File Structure

```
ApexWeb/src/data.js     + `warm` field on each COMPOUND; + TYRE const (warmPen/ease/gridTemp/pitTemp)
ApexWeb/src/tyres.js    NEW — pure: tyreTerm(compound,wear,temp), warmStep(temp,compound)
ApexWeb/src/sim.js      tyreTemp state; lap-time uses tyreTerm; warm-up per lap; pit→cold; drop _wearTerm
ApexWeb/src/main.js     snapshot: + tyreTemp
ApexWeb/src/ui/race.js  small cold-tyre hint (❄ next to the tyre label until warm)
ApexWeb/tools/balance.mjs   undercut corridor (fresh+warm laps faster than a worn tyre)
ApexWeb/tests/tyres.test.js NEW
ApexWeb/tests/sim.test.js   + warm-up / determinism cases
```

---

## Task 1: data.js — compound warm-up + TYRE constants

**Files:** Modify `ApexWeb/src/data.js`; Test `ApexWeb/tests/data.test.js`.

- [ ] **Step 1: Add failing test** — append to `ApexWeb/tests/data.test.js`:

```js
import { TYRE } from "../src/data.js";

test("compounds have a warm-up rate; TYRE constants present", () => {
  for (const c of ["soft", "medium", "hard"]) assert.ok(COMPOUNDS[c].warm > 0, c);
  // softer compound warms faster than harder
  assert.ok(COMPOUNDS.soft.warm > COMPOUNDS.hard.warm);
  assert.ok(TYRE.warmPen > 0 && TYRE.ease > 0);
  assert.ok(TYRE.pitTemp < TYRE.gridTemp && TYRE.gridTemp < 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run (inside `ApexWeb/`): `node --test tests/data.test.js` → FAIL (`COMPOUNDS.soft.warm`/`TYRE` undefined).

- [ ] **Step 3: Implement** — in `ApexWeb/src/data.js`:

Change the `COMPOUNDS` block:
```js
export const COMPOUNDS = {
  soft:   { pace:-0.55, wear:2.6, cliff:65 },
  medium: { pace: 0.00, wear:1.7, cliff:78 },
  hard:   { pace: 0.55, wear:1.1, cliff:90 },
};
```
to (add `warm`):
```js
export const COMPOUNDS = {
  soft:   { pace:-0.55, wear:2.6, cliff:65, warm:1.4 },
  medium: { pace: 0.00, wear:1.7, cliff:78, warm:1.0 },
  hard:   { pace: 0.55, wear:1.1, cliff:90, warm:0.7 },
};
```
And add this const immediately after the `COMPOUNDS` block:
```js
// tyre temperature model. temp 0..1 (1 = in the window). Fresh tyres are cold.
export const TYRE = {
  warmPen:  1.2,   // s/lap when fully cold (temp 0) -> rewards warming up
  ease:     0.5,   // how fast temp eases toward 1 each lap (× compound.warm)
  gridTemp: 0.55,  // tyre temp at the race start (formation lap warmed them)
  pitTemp:  0.20,  // tyre temp leaving the pits (cold out-lap)
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/data.test.js` → PASS. `node --test` → all green.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/data.js ApexWeb/tests/data.test.js
git commit -m "feat(apexweb): compound warm-up rate + TYRE temp constants (phase 2)"
```

---

## Task 2: tyres.js — pure tyre pace + warm-up model

**Files:** Create `ApexWeb/src/tyres.js`; Test `ApexWeb/tests/tyres.test.js`.

- [ ] **Step 1: Write the failing test** — `ApexWeb/tests/tyres.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { tyreTerm, warmStep } from "../src/tyres.js";
import { TYRE } from "../src/data.js";

test("a worn tyre is slower than a fresh one (same temp)", () => {
  assert.ok(tyreTerm("medium", 40, 1) > tyreTerm("medium", 0, 1));
});

test("a cold tyre is slower than a warm one (same wear)", () => {
  assert.ok(tyreTerm("medium", 0, TYRE.pitTemp) > tyreTerm("medium", 0, 1));
});

test("past the cliff degradation is steep", () => {
  const cliff = 78; // medium
  const before = tyreTerm("medium", cliff, 1);
  const after = tyreTerm("medium", cliff + 15, 1);
  // 15 laps past the cliff costs much more than 15 laps before it
  const beforeStep = tyreTerm("medium", cliff, 1) - tyreTerm("medium", cliff - 15, 1);
  assert.ok((after - before) > beforeStep * 3, "cliff must bite");
});

test("warmStep eases temp toward 1 and never exceeds it; soft warms faster", () => {
  const t1 = warmStep(0.2, "soft"), h1 = warmStep(0.2, "hard");
  assert.ok(t1 > 0.2 && t1 <= 1);
  assert.ok(t1 > h1, "soft warms faster than hard");
  assert.ok(warmStep(0.99, "soft") <= 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/tyres.test.js` → FAIL (cannot find module `../src/tyres.js`).

- [ ] **Step 3: Implement** — `ApexWeb/src/tyres.js`:

```js
// ApexWeb/src/tyres.js — pure tyre pace model: degradation curve + cliff + warm-up.
// temp is 0..1 (1 = in the operating window). Phase 7 will add driver `tyre` attr.
import { COMPOUNDS, TYRE } from "./data.js";

const clamp01 = x => Math.max(0, Math.min(1, x));

// pace loss (s/lap) from the current tyre state. wear >= 0, temp 0..1.
export function tyreTerm(compound, wear, temp) {
  const c = COMPOUNDS[compound];
  let deg;
  if (wear <= c.cliff) deg = 0.012 * wear * (1 + (wear / c.cliff) * 0.5); // gently accelerating curve
  else deg = 0.012 * c.cliff * 1.5 + (wear - c.cliff) * 0.10;             // steep past the cliff
  const cold = (1 - clamp01(temp)) * TYRE.warmPen;
  return deg + cold;
}

// temp after one lap (eases toward 1; softer compound warms faster)
export function warmStep(temp, compound) {
  const c = COMPOUNDS[compound];
  return Math.min(1, temp + c.warm * TYRE.ease * (1 - clamp01(temp)));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/tyres.test.js` → 4 pass. `node --test` → all green.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/tyres.js ApexWeb/tests/tyres.test.js
git commit -m "feat(apexweb): pure tyre model (degradation curve + cliff + warm-up)"
```

---

## Task 3: sim.js — tyreTemp state, warm-up, pit→cold, use tyreTerm

**Files:** Modify `ApexWeb/src/sim.js`; Test `ApexWeb/tests/sim.test.js`.

- [ ] **Step 1: Add failing tests** — append to `ApexWeb/tests/sim.test.js`:

```js
import { TYRE } from "../src/data.js";

test("a pit drops the tyre cold, then it warms over the following laps", () => {
  const r = new Race(field(), TRACK, 21);
  const c = r.cars[0];
  r.requestPit(0, "medium");
  let guard = 0;
  while (c.pitStops === 0 && guard++ < 80000) r.step();   // run until the pit is served
  const tempAfterPit = c.tyreTemp;
  const lap0 = c.lap;
  while (c.lap < lap0 + 2 && guard++ < 80000) r.step();   // two more laps
  assert.ok(tempAfterPit <= TYRE.pitTemp + 1e-9, `fresh tyre should start cold (${tempAfterPit})`);
  assert.ok(c.tyreTemp > tempAfterPit, "tyre should warm up over the following laps");
});

test("determinism holds with tyre warm-up", () => {
  const run = s => { const r = new Race(field(), TRACK, s); let g = 0;
    while (!r.finished && g++ < 500000) r.step(); return r.order().map(c => c.abbrev); };
  assert.deepEqual(run(4), run(4));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/sim.test.js` → FAIL (`c.tyreTemp` is undefined → NaN lap times / assertions fail).

- [ ] **Step 3: Apply edits to `ApexWeb/src/sim.js`** (READ first):

**3a.** Import the tyre helpers — add after the fuel import line:
```js
import { tyreTerm, warmStep } from "./tyres.js";
```
And add `TYRE` to the data import (so the constructor can read `gridTemp`/`pitTemp`):
```js
import { COMPOUNDS, PACE_MODES, SKILL_K, CAR_K, STEP, DNF_BASE, GRID_GAP, COMBAT_GAP, TYRE } from "./data.js";
```

**3b.** Constructor car object — change:
```js
      tyre: f.startTyre ?? "medium", wear: 0, tyreAge: 0,
```
to:
```js
      tyre: f.startTyre ?? "medium", wear: 0, tyreAge: 0, tyreTemp: TYRE.gridTemp,
```

**3c.** In `_lapTime`, change the tyre line:
```js
    s += comp.pace + this._wearTerm(c, comp);
```
to:
```js
    s += comp.pace + tyreTerm(c.tyre, c.wear, c.tyreTemp);
```

**3d.** Delete the now-unused `_wearTerm` method entirely:
```js
  _wearTerm(c, comp) {
    // linear up to the cliff, then steep
    if (c.wear <= comp.cliff) return c.wear * 0.012;
    return comp.cliff * 0.012 + (c.wear - comp.cliff) * 0.10;
  }
```

**3e.** In `step()` lap completion, warm the tyre each lap. Change:
```js
        c.wear += comp.wear * pm.wear;
        c.fuel -= burnFor(c.engine, c.car.fuel);   // c.car.fuel: economy rating (1=standard), wired in Phase 7
        c.tyreAge += 1;
```
to:
```js
        c.wear += comp.wear * pm.wear;
        c.tyreTemp = warmStep(c.tyreTemp, c.tyre);
        c.fuel -= burnFor(c.engine, c.car.fuel);   // c.car.fuel: economy rating (1=standard), wired in Phase 7
        c.tyreAge += 1;
```

**3f.** In `_serveLapEnd`, when a pit is served, set the fresh tyre cold. Change:
```js
      c.tyre = c.pitPending; c.pitPending = null; c.wear = 0; c.tyreAge = 0;
```
to:
```js
      c.tyre = c.pitPending; c.pitPending = null; c.wear = 0; c.tyreAge = 0; c.tyreTemp = TYRE.pitTemp;
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/sim.test.js` → all sim tests pass (incl. the 2 new). `node --test` → all green. If the out-lap test is flaky from noise, it should not be — the cold penalty (~0.96s on the out-lap) dwarfs the 0.06s noise. Do NOT weaken the test.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/sim.js ApexWeb/tests/sim.test.js
git commit -m "feat(apexweb): sim tyre warm-up — cold out-lap, warm per lap, pit→cold"
```

---

## Task 4: main.js — snapshot tyreTemp

**Files:** Modify `ApexWeb/src/main.js`.

- [ ] **Step 1: Implement** — in `raceSnapshot`, add `tyreTemp` to the per-car fields. Change:
```js
      pitStops: c.pitStops, tyreAge: c.tyreAge, lastLap: c.lastLap, startPos: c.startPos,
```
to:
```js
      pitStops: c.pitStops, tyreAge: c.tyreAge, tyreTemp: c.tyreTemp, lastLap: c.lastLap, startPos: c.startPos,
```

- [ ] **Step 2: Verify**

Run: `node --check ApexWeb/src/main.js` → OK. `node --test` (inside `ApexWeb/`) → all green.

- [ ] **Step 3: Commit**

```
git add ApexWeb/src/main.js
git commit -m "feat(apexweb): snapshot tyreTemp"
```

---

## Task 5: race.js — cold-tyre hint in the HUD

**Files:** Modify `ApexWeb/src/ui/race.js`.

Show a small ❄ next to the tyre label while the tyre is still cold (warming up), so the player sees the out-lap penalty.

- [ ] **Step 1: Implement** — in `updateHud`, find the tyre label line that sets `#d-tyrelabel`. It currently reads (the player's tyre row):
```js
  $("#d-tyrelabel").innerHTML = `Резина ${tyreIcon(me.tyre, 30)} <span style="text-transform:capitalize">${me.tyre}</span> · ${me.tyreAge} кр · износ`;
```
Change it to append a cold marker when `tyreTemp < 0.85`:
```js
  const cold = (me.tyreTemp ?? 1) < 0.85 ? ` <span style="color:#4aa3ff" title="шина не прогрета">❄</span>` : "";
  $("#d-tyrelabel").innerHTML = `Резина ${tyreIcon(me.tyre, 30)} <span style="text-transform:capitalize">${me.tyre}</span>${cold} · ${me.tyreAge} кр · износ`;
```

- [ ] **Step 2: Verify**

Run: `node --check ApexWeb/src/ui/race.js` → OK. `node --test` → all green.

- [ ] **Step 3: Commit**

```
git add ApexWeb/src/ui/race.js
git commit -m "feat(apexweb): HUD cold-tyre hint (❄ until warmed)"
```

---

## Task 6: balance.mjs — undercut corridor

**Files:** Modify `ApexWeb/tools/balance.mjs`.

Prove the undercut works: an identical car on a fresh, warmed tyre laps clearly faster than one on a worn tyre — enough to overcome a pit stop over a few laps.

- [ ] **Step 1: Implement** — add this block to `ApexWeb/tools/balance.mjs` (after the fuel block; it uses the same `Race`/`TRACK` imports):

```js
// undercut corridor: fresh+warm vs worn lap-time delta should exceed the pit loss amortised over ~3 laps.
{
  const { tyreTerm } = await import("../src/tyres.js");
  const fresh = tyreTerm("medium", 0, 1);        // fresh, warm
  const worn  = tyreTerm("medium", 28, 1);       // ~28-lap-old tyre, warm
  const perLapGain = worn - fresh;               // s/lap a fresh tyre claws back
  const pitLoss = TRACK.pit;                      // s lost in the pit
  console.log(`undercut: fresh tyre gains ${perLapGain.toFixed(2)} s/lap vs a 28-lap tyre; ` +
    `pays back the ${pitLoss}s stop in ~${(pitLoss / perLapGain).toFixed(0)} laps (expect a single-digit number)`);
}
```

- [ ] **Step 2: Run it**

Run (inside `ApexWeb/`): `node tools/balance.mjs`
Expected: the undercut line prints a per-lap gain > 0 and a payback in a single-digit number of laps (e.g. ~6–9). If payback is huge (>15 laps), the degradation curve is too flat — raise the post-cliff slope or the curve coefficient in `tyres.js` (and re-run `node --test`). Record the observed numbers in a comment.

- [ ] **Step 3: Commit**

```
git add ApexWeb/tools/balance.mjs
git commit -m "feat(apexweb): balance harness undercut corridor"
```

---

## Notes for the implementer

- **Determinism intact:** warm-up is a pure function of state; no Date/Math.random added. The `erng`/`rng` streams are untouched.
- **Combat invariant untouched:** this phase doesn't touch `_resolveCombat`.
- **Driver `tyre` attribute** (faster warm-up / lower wear) is **Phase 7** — do NOT add it here; `tyreTerm`/`warmStep` take compound-only for now.
- **Owner playtest (browser, hard-reload):** after a pit the tyre shows ❄ for ~1–2 laps and the out-lap is slow; then it warms and the fresh tyre is fast → pitting a lap or two before a rival can jump them (undercut). Tyre cliff still forces the stop.
- Next plan after this: **Phase 3 — track sectors + mini-sectors** (per spec §5).
