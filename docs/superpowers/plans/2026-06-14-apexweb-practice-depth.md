# ApexWeb Practice Depth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ApexWeb Practice a meaningful three-session activity — a per-driver "track knowledge" that gates setup precision and buffs pace, dynamic pit-prep time, and a desktop dashboard layout.

**Architecture:** All gameplay math stays in the pure, deterministic modules (`setup.js`, `practice_session.js`) and tuning constants in `data.js`; `main.js` wires the race pace buff + AI baseline + the 15Hz repaint gate; `ui/practice.js` + `style.css` render. Lock the numbers (track-knowledge curve, pit-prep) against the Node balance corridor BEFORE touching the UI.

**Tech Stack:** Vanilla JS ES modules, `node --test` (node:test), `tools/balance.mjs` corridor harness, Canvas/HTML UI (no build).

**Spec:** `docs/superpowers/specs/2026-06-14-apexweb-practice-depth-design.md`

---

## File structure

- `src/data.js` — `PRAC2` constants (add track + pit-prep consts, bump `WIN_JITTER`, remove `PIT_PREP_SEC`/`KNOW_PER_LAP`).
- `src/practice_session.js` — replace per-axis `knowledge[]` with scalar `trackKnow`; bank it; feed `windowFor`; dynamic `prepCostFor(car, compound, laps)` + `lastCompound`; snapshot exposes `trackKnow`, `setupDelta`, `lastCompound`.
- `src/setup.js` — unchanged logic (`windowFor`/`feedbackFor` already take a 0..1 scalar); only a doc-comment tweak.
- `src/main.js` — race buff = setup + `TRACK_PACE·trackKnow`; AI baseline `TRACK_PACE·AI_TRACK_KNOW`; `liveSig` includes `trackKnow`/`lastCompound`.
- `tools/balance.mjs` — convergence corridor asserts the P1/P2/P3 curve; tune consts here.
- `src/ui/practice.js` — Variant-A 2-column dashboard; track-knowledge + satisfaction metric bars; per-axis rows lose the knowledge bar; stint card shows the prep breakdown (UI computes prepCost from `setupDelta`+`lastCompound`+local picker).
- `style.css` — dashboard grid + responsive collapse + metric bars.
- `tests/practice_session.test.js` — trackKnow banking + window gate + dynamic prep.
- `tests/data.test.js` — new consts present.
- `README.md` — practice section + test count.

---

### Task 1: PRAC2 constants

**Files:**
- Modify: `src/data.js` (the `PRAC2` block, ~lines 229-247)
- Test: `tests/data.test.js`

- [ ] **Step 1: Write the failing test** — append to `tests/data.test.js`:

```javascript
test("PRAC2 carries track-knowledge + dynamic pit-prep tuning", () => {
  assert.ok(PRAC2.TRACK_PER_LAP > 0 && PRAC2.TRACK_PER_LAP < 0.1, "track knowledge per lap");
  assert.ok(PRAC2.TRACK_PACE < 0, "track pace buff is negative (faster)");
  assert.ok(PRAC2.AI_TRACK_KNOW >= 0 && PRAC2.AI_TRACK_KNOW <= 1, "AI baseline track knowledge");
  assert.ok(PRAC2.TYRE_CHANGE_SEC > PRAC2.TYRE_REFIT_SEC, "new compound costs more than a re-fit");
  assert.ok(PRAC2.FUEL_PER_LAP > 0, "fuel load scales with laps");
  assert.equal(PRAC2.WIN_JITTER, 0.40, "window jitter bumped so P1 setup isn't ~100%");
  assert.equal(PRAC2.PIT_PREP_SEC, undefined, "flat prep retired");
  assert.equal(PRAC2.KNOW_PER_LAP, undefined, "per-axis knowledge retired");
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd ApexWeb && node --test tests/data.test.js`
Expected: FAIL (new keys undefined, `WIN_JITTER` is 0.30, old keys still present).

- [ ] **Step 3: Edit the `PRAC2` block** in `src/data.js`. Remove the `KNOW_PER_LAP` and `PIT_PREP_SEC` lines, change `WIN_JITTER`, and add the new consts so the block reads:

```javascript
export const PRAC2 = {
  AXES: 6,
  IQ_LEARN: 0.5,          // feedbackMult = 0.75 + IQ_LEARN*race_iq  (sharp driver learns faster)
  TRACK_PER_LAP: 0.022,   // track knowledge banked per completed lap (×feedbackMult) → ~0.4/0.7/1.0 over P1/P2/P3
  TRACK_PACE: -0.08,      // race pace buff (s/lap) at full track knowledge (driver confidence)
  AI_TRACK_KNOW: 0.7,     // assumed track knowledge for AI cars → player practice is a delta, not free
  MAX_HALF: 0.45,         // ideal-window half-width at track knowledge 0 (≈ whole range)
  MIN_HALF: 0.02,         // half-width floor at track knowledge 1
  WIN_P: 1.5,             // half = MIN + (MAX-MIN)*(1-trackKnow)^WIN_P
  WIN_JITTER: 0.40,       // window-centre offset at track knowledge 0 (shrinks to 0); 0.40 → P1 setup ≈ 60%
  KNOW_VAGUE: 0.25,       // below this track knowledge the axis reads "мало кругов"
  CONFIRM_LAPS: 2,        // flying laps on a value before its satisfaction is confirmed
  SAT_TOL: 0.18,          // axisSat = clamp(1-(|v-opt|/SAT_TOL)^2,0,1)
  SESSION_SEC: 1800,      // 30 game-minutes per session
  SPEEDS: [1, 2, 4, 8],   // time-acceleration multipliers (over SIM_RATE)
  AUTOSIM_MULT: 0.8,      // auto-sim banks knowledge at 0.8× (simulating underperforms)
  TYRE_SETS: 6,           // tyre sets per car across all three sessions
  ACCL_PER_LAP: 0.01,     // acclimatisation per lap (cap 1) → tiny race buff
  TYRE_CHANGE_SEC: 30,    // pit-prep: fitting a DIFFERENT compound than the last stint
  TYRE_REFIT_SEC: 12,     // pit-prep: a fresh set of the same compound
  FUEL_PER_LAP: 2,        // pit-prep: fuel-load time per requested stint lap
  SETUP_APPLY_SEC: 35,    // pit-prep: mechanic time per unit of setup change (Σ|Δaxis|, 0..6) since last run
};
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd ApexWeb && node --test tests/data.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/data.js ApexWeb/tests/data.test.js
git commit -m "feat(apexweb): PRAC2 track-knowledge + dynamic pit-prep consts"
```

---

### Task 2: Track knowledge replaces per-axis knowledge

**Files:**
- Modify: `src/practice_session.js` (`newCar`, `completeLap`, `autoSim`, `sessionSnapshot`, `carView`)
- Modify: `src/setup.js` (doc comment only)
- Test: `tests/practice_session.test.js`

Context: `windowFor(knowledge, opt, seed, i)` and `feedbackFor(value, win, knowledge, raceIq)` already take a 0..1 scalar — feed them `car.trackKnow`. The per-axis `knowledge[]` array is removed; `lapsOnVal[]`/`confirmedSat[]` stay.

- [ ] **Step 1: Write the failing tests** — append to `tests/practice_session.test.js` (it already imports `newSession, sendRun, step, carView, sessionSnapshot` and `PRAC2`; add `windowFor` to the `setup.js` import at the top if needed — see step 3):

```javascript
test("track knowledge banks per lap and gates the ideal window", () => {
  let s = newSession(4, mkCars()); s.paused = false; s.speed = 8;
  assert.equal(carView(s, "p1").trackKnow, 0, "starts at 0");
  s = sendRun(s, "p1", "soft", 12);
  for (let i = 0; i < 400; i++) s = step(s, 1.0);
  const tk = carView(s, "p1").trackKnow;
  assert.ok(tk > 0 && tk <= 1, `banked track knowledge (${tk})`);
  // the revealed window must be much wider/looser early than late
  const wEarly = windowFor(0.4, 0.5, 123, 0).half;
  const wLate  = windowFor(1.0, 0.5, 123, 0).half;
  assert.ok(wEarly > wLate * 3, `window narrows with track knowledge (${wEarly} vs ${wLate})`);
});

test("snapshot exposes scalar trackKnow and axes no longer carry per-axis knowledge", () => {
  let s = newSession(4, mkCars()); s = sendRun(s, "p1", "soft", 6); s.paused = false; s.speed = 8;
  for (let i = 0; i < 200; i++) s = step(s, 1.0);
  const snap = sessionSnapshot(s);
  assert.ok(typeof snap.cars.p1.trackKnow === "number", "per-car trackKnow present");
  assert.equal(snap.cars.p1.axes[0].knowledge, undefined, "per-axis knowledge removed");
  assert.ok(snap.cars.p1.axes[0].window && snap.cars.p1.axes[0].feedback, "window+feedback still there");
});
```

Update the existing `tests/practice_session.test.js` import line to add `windowFor`:

```javascript
import { windowFor } from "../src/setup.js";
```

- [ ] **Step 2: Run, verify failure**

Run: `cd ApexWeb && node --test tests/practice_session.test.js`
Expected: FAIL (`carView(...).trackKnow` undefined; snapshot has no `trackKnow`; axes still carry `knowledge`).

- [ ] **Step 3: Edit `src/practice_session.js`.**

In `newCar`, replace the `knowledge` line and add `lastCompound`:

```javascript
    setup: Array.from({ length: PRAC2.AXES }, () => 0.5),
    lastRunSetup: Array.from({ length: PRAC2.AXES }, () => 0.5),
    trackKnow: 0,                                                  // per-driver track knowledge → gates the window
    lastCompound: null,                                           // last stint's compound → tyre-change prep cost
    lapsOnVal: Array.from({ length: PRAC2.AXES }, () => 0),
    confirmedSat: Array.from({ length: PRAC2.AXES }, () => 0),
```

(Delete the old `knowledge: Array.from(...)` line.)

In `completeLap` (current signature is `function completeLap(car)` — keep it; the function only touches `car`), replace just the per-axis knowledge loop with a single `trackKnow` bank. The first lines become:

```javascript
function completeLap(car) {
  const fm = feedbackMult(car);
  car.trackKnow = Math.min(1, car.trackKnow + PRAC2.TRACK_PER_LAP * fm);
  for (let i = 0; i < PRAC2.AXES; i++) {
    car.lapsOnVal[i] += 1;
    if (car.lapsOnVal[i] >= PRAC2.CONFIRM_LAPS) car.confirmedSat[i] = axisSat(car.setup[i], car.ideal[i]);
  }
  // ...the rest of completeLap (lapT/deg/wear/temp/fuel/totalLaps/accl/stintLeft) is UNCHANGED...
}
```

Concretely: delete the old `car.knowledge[i] = Math.min(1, car.knowledge[i] + PRAC2.KNOW_PER_LAP * fm);` line from the loop and add the single `car.trackKnow = …` line above the loop. Leave every line after the loop exactly as it is.

In `autoSim`, bank trackKnow instead of per-axis knowledge:

```javascript
  for (let n = 0; n < laps; n++) {
    const fm = (0.75 + PRAC2.IQ_LEARN * (car.drv.attrs?.race_iq ?? 0.7)) * PRAC2.AUTOSIM_MULT;
    car.trackKnow = Math.min(1, car.trackKnow + PRAC2.TRACK_PER_LAP * fm);
    for (let i = 0; i < PRAC2.AXES; i++) {
      car.lapsOnVal[i] += 1;
      if (car.lapsOnVal[i] >= PRAC2.CONFIRM_LAPS) car.confirmedSat[i] = axisSat(car.setup[i], car.ideal[i]);
    }
    car.totalLaps += 1; car.accl = Math.min(1, car.accl + PRAC2.ACCL_PER_LAP);
  }
```

In `sessionSnapshot`, change the per-axis projection and add `trackKnow`:

```javascript
  const proj = (car, dseedIdx) => ({
    onTrack: car.onTrack, compound: car.compound, stintLeft: car.stintLeft, totalLaps: car.totalLaps,
    satisfaction: car.confirmedSat.reduce((a, b) => a + b, 0) / PRAC2.AXES, accl: car.accl,
    strategy: car.strategy, trackKnow: car.trackKnow,
    setupDelta: car.setup.reduce((a, v, i) => a + Math.abs(v - car.lastRunSetup[i]), 0),   // for the prep-cost preview
    lastCompound: car.lastCompound,
    axes: car.setup.map((v, i) => {
      const win = windowFor(car.trackKnow, car.ideal[i], s.seed + dseedIdx * 101, i);
      return { value: v, confirmedSat: car.confirmedSat[i],
        window: win, feedback: feedbackFor(v, win, car.trackKnow, car.drv.attrs?.race_iq ?? 0.7) };
    }),
  });
```

In `carView`, replace `knowledge`:

```javascript
export function carView(s, player) {
  const car = s.cars[player];
  return {
    setup: car.setup.slice(), trackKnow: car.trackKnow, confirmedSat: car.confirmedSat.slice(),
    ideal: car.ideal.slice(), onTrack: car.onTrack, compound: car.compound, stintLeft: car.stintLeft,
    totalLaps: car.totalLaps, accl: car.accl, strategy: car.strategy,
    satisfaction: car.confirmedSat.reduce((a, b) => a + b, 0) / PRAC2.AXES,
  };
}
```

Update the `src/setup.js` header comment for `windowFor`/`feedbackFor` to say "gated by track knowledge" instead of "per-axis knowledge" (cosmetic).

- [ ] **Step 4: Update the existing tests that referenced per-axis knowledge.** In `tests/practice_session.test.js`, the test "a stint runs laps and banks knowledge" asserts `v.knowledge.every(...)`, and "autoSim banks less knowledge" compares `a.knowledge[0] < h.knowledge[0]`. Rewrite them to use `trackKnow`:

```javascript
// in "a stint runs laps and banks knowledge (capped at 1)":
  assert.ok(v.trackKnow > 0 && v.trackKnow <= 1, "track knowledge banked, capped");

// in "autoSim banks less knowledge than the same number of laps run hands-on":
  assert.ok(a.trackKnow < h.trackKnow, `auto-sim underperforms (${a.trackKnow} < ${h.trackKnow})`);
```

- [ ] **Step 5: Run the tests, verify pass**

Run: `cd ApexWeb && node --test tests/practice_session.test.js`
Expected: PASS (new + updated tests).

- [ ] **Step 6: Commit**

```bash
git add ApexWeb/src/practice_session.js ApexWeb/src/setup.js ApexWeb/tests/practice_session.test.js
git commit -m "feat(apexweb): track knowledge replaces per-axis knowledge; gates the setup window"
```

---

### Task 3: Dynamic pit-prep (compound + laps + setup)

**Files:**
- Modify: `src/practice_session.js` (`prepCostFor`, `sendRun`, `autoSim`)
- Test: `tests/practice_session.test.js`

- [ ] **Step 1: Replace the prep test.** In `tests/practice_session.test.js`, replace the existing "a run charges pit-prep time to the clock" test with:

```javascript
test("dynamic pit-prep: tyre change + fuel-by-laps + setup change", () => {
  let s = newSession(7, mkCars());
  const c0 = s.clock;
  // first run: lastCompound null → counts as a change; soft, 5 laps, no setup move
  s = sendRun(s, "p1", "soft", 5);
  const expect1 = PRAC2.TYRE_CHANGE_SEC + PRAC2.FUEL_PER_LAP * 5;
  assert.ok(Math.abs((c0 - s.clock) - expect1) < 1e-6, `change+fuel (${c0 - s.clock} vs ${expect1})`);
  // same compound next run, longer stint, one axis moved 0.5
  s.cars.p1.onTrack = false;
  s = setAxis(s, "p1", 0, 1.0);
  const c1 = s.clock;
  s = sendRun(s, "p1", "soft", 10);
  const expect2 = PRAC2.TYRE_REFIT_SEC + PRAC2.FUEL_PER_LAP * 10 + PRAC2.SETUP_APPLY_SEC * 0.5;
  assert.ok(Math.abs((c1 - s.clock) - expect2) < 1e-6, `refit+fuel+setup (${c1 - s.clock} vs ${expect2})`);
  // prepCostFor preview matches what a launch would charge for a chosen compound/laps
  s.cars.p1.onTrack = false;
  assert.ok(Math.abs(prepCostFor(s.cars.p1, "medium", 8) - (PRAC2.TYRE_CHANGE_SEC + PRAC2.FUEL_PER_LAP * 8)) < 1e-6,
    "preview: new compound + fuel, no setup change");
});
```

Ensure the test file imports `setAxis` and `prepCostFor` (added in an earlier commit; confirm both are in the import line).

- [ ] **Step 2: Run, verify failure**

Run: `cd ApexWeb && node --test tests/practice_session.test.js`
Expected: FAIL (`prepCostFor` takes no compound/laps yet; old flat formula).

- [ ] **Step 3: Edit `src/practice_session.js`.** Replace `prepCostFor` and the prep lines in `sendRun`:

```javascript
// pit-prep time a run costs the session clock: a tyre change (more for a different compound), fuel load
// proportional to the stint length, plus mechanic time for setup changes since the car was last out.
export function prepCostFor(car, compound, laps) {
  const setupDelta = car.setup.reduce((a, v, i) => a + Math.abs(v - car.lastRunSetup[i]), 0);
  const tyre = (compound !== car.lastCompound) ? PRAC2.TYRE_CHANGE_SEC : PRAC2.TYRE_REFIT_SEC;
  return tyre + PRAC2.FUEL_PER_LAP * laps + PRAC2.SETUP_APPLY_SEC * setupDelta;
}

export function sendRun(s, player, compound, laps) {
  const car = s.cars[player]; if (!car) return s;
  s.clock = Math.max(0, s.clock - prepCostFor(car, compound, laps));   // garage work eats the session clock
  car.lastRunSetup = car.setup.slice();                                // this setup is now "applied"
  car.lastCompound = compound;                                         // remember the fitted compound
  car.compound = compound; car.stintLeft = laps; car.onTrack = true;
  car.wear = 0; car.temp = TYRE.pitTemp; car.fuel = startFuel(TRACK);
  return s;
}
```

In `autoSim`, change the one-pit-out charge from `PRAC2.PIT_PREP_SEC` to `PRAC2.TYRE_CHANGE_SEC`:

```javascript
  const laps = Math.floor(Math.max(0, s.clock - PRAC2.TYRE_CHANGE_SEC) / LAP_SEC());   // one pit-out to get going
```

- [ ] **Step 4: Run the tests, verify pass**

Run: `cd ApexWeb && node --test tests/practice_session.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/practice_session.js ApexWeb/tests/practice_session.test.js
git commit -m "feat(apexweb): dynamic pit-prep — tyre change + fuel-by-laps + setup"
```

---

### Task 4: Race pace buff + AI baseline + repaint gate

**Files:**
- Modify: `src/main.js` (`buildField`, a `pracTrackKnow` helper, `liveSig`)

This task has no unit test (main.js is integration glue); verify by a cache-busted in-browser drive at the end (Task 8) and by the corridor (Task 5, which reads `composeCar`/buildField semantics indirectly — actually it builds its own field, so the race-buff wiring is verified in-browser).

- [ ] **Step 1: Add the helper + buff in `buildField`.** After the `pracSetupBonus` function in `src/main.js`, add:

```javascript
// current track knowledge for a player car (0 if no practice happened).
function pracTrackKnow(player) {
  return ctx.pracSession ? (ctx.pracSession.cars[player]?.trackKnow ?? 0) : 0;
}
```

In `buildField`, change the `setupBonus` field so player cars add their track buff and AI cars get the baseline:

```javascript
      setup, startTyre: "medium",
      setupBonus: player
        ? pracSetupBonus(player) + PRAC2.TRACK_PACE * pracTrackKnow(player)
        : paceBonus(closeness(setup, ideal)) + PRAC2.TRACK_PACE * PRAC2.AI_TRACK_KNOW,
```

(Match the existing object shape — the current line sets `setupBonus: player ? pracSetupBonus(player) : paceBonus(closeness(setup, ideal))`; only append the `+ PRAC2.TRACK_PACE * …` terms.)

- [ ] **Step 2: Add `trackKnow` + `lastCompound` to the practice `liveSig`** so the metric bar updates on laps and the stint card rebuilds after a launch. In `liveSig`, the practice branch per-car string becomes:

```javascript
    const c = p => { const x = snap.cars[p]; if (!x) return "-";
      const ax = x.axes ? x.axes.map(a => Math.round(a.value * 100)).join("-") : "";
      return `${x.onTrack ? 1 : 0}.${x.totalLaps}.${Math.round(x.satisfaction * 100)}.${Math.round((x.trackKnow || 0) * 100)}.${x.compound}.${x.lastCompound || "-"}.${x.stintLeft}.${ax}`; };
```

- [ ] **Step 3: Boot-check the module loads.** Start the preview server if needed and load the graph cache-busted:

Run (preview eval): `await import('/src/main.js?v='+Date.now()).then(m => !!m.ctx)`
Expected: `true`, no console error.

- [ ] **Step 4: Commit**

```bash
git add ApexWeb/src/main.js
git commit -m "feat(apexweb): race buff = setup + track-knowledge; AI baseline; repaint gate"
```

---

### Task 5: Convergence corridor — assert the curve + tune

**Files:**
- Modify: `tools/balance.mjs` (the practice convergence corridor block, ~lines 200-245)

- [ ] **Step 1: Extend the corridor** to measure satisfaction after 1 vs 3 sessions and track knowledge per session. Replace the `goodPolicy` body so it records the curve, and add assertions/logging:

```javascript
  function goodPolicy(seed) {
    let s = newSession(seed, pracCars()); s.paused = false; s.speed = 8;
    const out = { sat: [0, 0, 0], track: [0, 0, 0] };
    for (let sess = 1; sess <= 3; sess++) {
      for (let round = 0; round < 4 && s.clock > 0; round++) {
        s = sendRun(s, "p1", "soft", 10);
        let g = 0; while (s.cars.p1.onTrack && s.clock > 0 && g++ < 3000) s = pracStep(s, 1.0);
        const snap = sessionSnapshot(s);
        for (let i = 0; i < PRAC2.AXES; i++) setAxis(s, "p1", i, snap.cars.p1.axes[i].window.center);
      }
      // confirm the current setup with one short run, then read the session result
      s = sendRun(s, "p1", "soft", PRAC2.CONFIRM_LAPS + 1); let g = 0;
      while (s.cars.p1.onTrack && s.clock > 0 && g++ < 500) s = pracStep(s, 1.0);
      out.sat[sess - 1] = carView(s, "p1").satisfaction;
      out.track[sess - 1] = carView(s, "p1").trackKnow;
      s.session = sess + 1; s.clock = PRAC2.SESSION_SEC; s.cars.p1.onTrack = false;
    }
    return out;
  }
```

Replace the averaging/printing block:

```javascript
  let s1 = 0, s3 = 0, t1 = 0, t3 = 0, auto = 0; const NP = 6;
  for (let k = 0; k < NP; k++) {
    const g = goodPolicy(1000 + k);
    s1 += g.sat[0]; s3 += g.sat[2]; t1 += g.track[0]; t3 += g.track[2];
    auto += autoPolicy(1000 + k);
  }
  s1 /= NP; s3 /= NP; t1 /= NP; t3 /= NP; auto /= NP;
  console.log(`practice: setup sat after 1 session = ${(s1*100).toFixed(0)}%  (target ~55-70: NOT solved in one)`);
  console.log(`practice: setup sat after 3 sessions = ${(s3*100).toFixed(0)}%  (target >=90: reachable by P3)`);
  console.log(`practice: track knowledge P1/P3 = ${(t1*100).toFixed(0)}% / ${(t3*100).toFixed(0)}%  (target ~40 / ~100)`);
  console.log(`practice: no-tune auto-sim sat    = ${(auto*100).toFixed(0)}%  (target < 1-session good policy)`);
```

- [ ] **Step 2: Run the corridor**

Run: `cd ApexWeb && node tools/balance.mjs 2>&1 | grep -i practice`
Expected: four practice lines printed.

- [ ] **Step 3: TUNE to hit the curve.** Adjust constants in `src/data.js` and re-run until: 1-session sat ∈ ~55-70%, 3-session sat ≥ 90%, track P1 ≈ 40% / P3 ≈ 100%, auto-sim < 1-session good policy. Levers and their effect:
  - `TRACK_PER_LAP` ↑ → track knowledge (and thus the gate) rises faster; raises both the 1-session and 3-session ceilings. Start 0.022; if track P1 < 35% raise toward 0.026, if > 45% lower toward 0.018.
  - `WIN_JITTER` ↑ → larger centre offset at low track knowledge → lower 1-session sat. Start 0.40; if 1-session sat > 70% raise toward 0.46, if < 55% lower toward 0.34.
  Re-run after each change. Commit only once all four targets hold.

- [ ] **Step 4: Confirm the race corridors didn't move** (the additive data.js consts shouldn't touch them):

Run: `cd ApexWeb && node tools/balance.mjs 2>&1 | grep -iE 'DNF|spread'`
Expected: `avg DNF/race` ≈ 1-2, `pace spread` ≈ 1.5-2.5 (unchanged from before).

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/tools/balance.mjs ApexWeb/src/data.js
git commit -m "test(apexweb): practice curve corridor (P1≈60%/P3≥90% setup, track 40→100); tune consts"
```

---

### Task 6: Desktop dashboard layout + metric bars (Variant A)

**Files:**
- Modify: `src/ui/practice.js` (the `render` function)

Context: today `render` builds `header + setupPanel + stintPanel + stratPanel + partner + ready` as a single column. Restructure into a header + a 2-column grid wrapper. The per-axis row drops its knowledge bar; add a metrics card with two bars; the stint card computes the prep breakdown from the snapshot's `setupDelta`/`lastCompound` + local picker.

- [ ] **Step 1: Replace the body assembly** at the end of `render` (the `root.innerHTML = ...` line and the panels feeding it). Keep the handler-wiring block below it unchanged. New structure:

```javascript
  // metric bars (track knowledge is the headline; satisfaction second)
  const bar = (label, pct, cls) => `
    <div class="pw-metric">
      <div class="pw-metric-top"><span>${label}</span><span class="pw-metric-val">${Math.round(pct)}%</span></div>
      <div class="bar"><i class="${cls}" style="width:${Math.round(pct)}%"></i></div>
    </div>`;
  const metrics = `
    <div class="panel pw-metrics">
      ${bar("Знание трассы", (me.trackKnow || 0) * 100, "pw-fill-track")}
      ${bar("Удовлетворённость", me.satisfaction * 100, "pw-fill-sat")}
    </div>`;

  // prep-cost breakdown for the CURRENT picker selection (UI-side; host charges the same on launch)
  const tyreCost = (ctx.pracCompound !== me.lastCompound) ? PRAC2.TYRE_CHANGE_SEC : PRAC2.TYRE_REFIT_SEC;
  const fuelCost = PRAC2.FUEL_PER_LAP * ctx.pracLaps;
  const setupCost = PRAC2.SETUP_APPLY_SEC * (me.setupDelta || 0);
  const prep = Math.round(tyreCost + fuelCost + setupCost);

  // (compSeg / lapBtns built as today)
  const stintPanel = `
    <div class="panel">
      <h3 style="margin:0 0 10px">Выпустить на трассу</h3>
      <p class="label" style="margin:0 0 4px">Компаунд</p>
      <div class="seg comp-seg" id="pw-compound">${compSeg}</div>
      <p class="label" style="margin:12px 0 4px">Кругов в стинте</p>
      <div class="pw-laps" id="pw-laps">${lapBtns}</div>
      <button class="primary" id="pw-run" style="margin-top:12px" ${me.onTrack || snap.clock <= 0 ? "disabled" : ""}>Выпустить болид · −${prep}с</button>
      <p class="label pw-prep">шины ${Math.round(tyreCost)}с · топливо ${Math.round(fuelCost)}с · настройки ${Math.round(setupCost)}с</p>
    </div>`;

  root.innerHTML = header + `<div class="pw-grid"><div class="pw-main">${setupPanel}</div><div class="pw-side">${metrics}${stintPanel}${stratPanel}${partner}</div></div>` + ready;
```

- [ ] **Step 2: Drop the per-axis knowledge bar** in the axis-row template (the `axisRows` map). Remove the `<div class="bar pw-know">…</div>` and the `знание N%` label from each row; keep the band+slider and the feedback chip. The feedback column becomes just the chip:

```javascript
        <div class="pw-fb">
          <div class="pw-chip" style="color:${ink}">${ax.feedback.text}</div>
        </div>
```

- [ ] **Step 3: Ensure `PRAC2` is imported** at the top of `src/ui/practice.js`:

```javascript
import { TRACK, PRAC2 } from "../data.js";
```

- [ ] **Step 4: Boot + visual check** (preview eval, cache-busted): render the screen with a mock snapshot that has `trackKnow`, `satisfaction`, `setupDelta`, `lastCompound`, and 6 axes; assert it produces a `.pw-grid`, two `.pw-metric` bars, the run button text contains `−`, and `.pw-prep` shows three components. No console error.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/ui/practice.js
git commit -m "feat(apexweb): Variant-A desktop practice dashboard + track-knowledge metric"
```

---

### Task 7: Dashboard CSS (grid + responsive + metrics)

**Files:**
- Modify: `style.css`

- [ ] **Step 1: Add the dashboard styles** near the existing `.pw-*` block in `style.css`:

```css
/* practice desktop dashboard: setup left (wide), side column right; collapses on narrow screens */
.pw-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:14px;align-items:start}
.pw-side{display:flex;flex-direction:column;gap:14px}
@media (max-width:760px){ .pw-grid{grid-template-columns:1fr} }
.pw-metrics{display:flex;flex-direction:column;gap:12px}
.pw-metric-top{display:flex;justify-content:space-between;align-items:baseline;font-size:13px;margin-bottom:5px}
.pw-metric-val{font-weight:700;font-size:15px}
.pw-fill-track{background:linear-gradient(90deg,var(--accent),var(--good))}
.pw-fill-sat{background:linear-gradient(90deg,var(--warn),var(--good))}
.pw-prep{margin:6px 0 0;opacity:.8}
```

- [ ] **Step 2: Verify** with `preview_inspect` (cache-busted CSS injected): `.pw-grid` computed `grid-template-columns` shows two tracks at ≥760px and one track at ≤760px (resize via `preview_resize`); the two metric bar fills are visible.

- [ ] **Step 3: Commit**

```bash
git add ApexWeb/style.css
git commit -m "style(apexweb): practice dashboard grid + responsive collapse + metric bars"
```

---

### Task 8: README + final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the practice section** of `README.md` to describe track knowledge (gates setup precision + buffs pace, ~3-session curve) and the dynamic pit-prep, and bump the test count to the new total.

- [ ] **Step 2: Run the full non-sim suite**

Run: `cd ApexWeb && node --test $(ls tests/*.test.js | grep -v 'sim.test.js') 2>&1 | grep -E '^# (tests|pass|fail)'`
Expected: all pass, 0 fail.

- [ ] **Step 3: Run the balance harness** and confirm every corridor is in range (race unchanged; practice curve on target).

Run: `cd ApexWeb && node tools/balance.mjs`
Expected: DNF ≈ 1-2, spread ≈ 1.5-2.5, practice 1-session ≈ 55-70%, 3-session ≥ 90%, track 40→100, quali unchanged.

- [ ] **Step 4: In-browser end-to-end** (cache-busted, solo): drive into practice, run a stint, confirm the track-knowledge meter rises, the 2-column layout renders and collapses under 760px, controls stay clickable, and the run button cost responds to compound/laps changes. Screenshot/snapshot as proof.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/README.md
git commit -m "docs(apexweb): README — practice track knowledge + dynamic pit-prep"
```

---

## After all tasks

Dispatch a final whole-implementation code review, then use superpowers:finishing-a-development-branch (here: the work is committed to `main` with explicit pathspecs — confirm the suite + corridors are green and summarise; push only when the owner asks). Owner F5 two-browser playtest remains the only non-headless-verifiable item.
