# Sim Engine Phase 4 — Overtaking v2 (slipstream + dirty air) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make wheel-to-wheel emergent and track-faithful: a follower gets a **slipstream/tow** on straights (builds pass-credit faster, concentrating moves at braking zones) and suffers **dirty air** when sitting close in corners (extra tyre wear), so you can't camp behind a rival forever — you must commit a move or drop back to cool the tyres.

**Architecture:** A pure `overtake.js` module (`slipstream`, `dirtyWear`, `passAccrual`) folds straightness (from `track.js`'s `sampleAt`, built in Phase 3) into the existing hold-up + pass-credit combat. `sim.js`'s `_resolveCombat` uses them: tow boosts pass-credit on straights, the per-tick dirty-air wear is accumulated into `c._dirtyWear` and applied at lap-end. **The combat invariant is preserved** — `_resolveCombat` still writes only `lapFrac` (+ the `_passCredit`/`_dirtyWear` scratch flags); tyre wear is applied in step()'s phase-3 lap-end. Determinism unchanged (no RNG added). No UI/snapshot changes.

**Tech Stack:** Vanilla JS ES modules, Node `node --test`. Driver `overtaking`/`defending` attributes are Phase 7.

**Spec:** `docs/superpowers/specs/2026-06-12-sim-engine-redesign-design.md` §8 (Phase 4 of §14).

---

## File Structure

```
ApexWeb/src/data.js     + SLIP_K, DIRTY_GAP, DIRTY_WEAR consts
ApexWeb/src/overtake.js NEW — pure: slipstream, dirtyWear, passAccrual
ApexWeb/src/sim.js      _resolveCombat v2 (sampleAt + tow + dirty-air); car _dirtyWear; lap-end applies dirty wear
ApexWeb/tools/balance.mjs   overtaking corridor (racing happens; dirty air worse in corners)
ApexWeb/tests/overtake.test.js NEW
ApexWeb/tests/sim.test.js   + dirty-air case
```

---

## Task 1: data.js — overtaking constants

**Files:** Modify `ApexWeb/src/data.js`; Test `ApexWeb/tests/data.test.js`.

- [ ] **Step 1: Add failing test** — append to `ApexWeb/tests/data.test.js`:

```js
import { SLIP_K, DIRTY_GAP, DIRTY_WEAR } from "../src/data.js";
test("overtaking constants present and sane", () => {
  assert.ok(SLIP_K > 0);
  assert.ok(DIRTY_GAP > 0.8);   // wider than COMBAT_GAP (0.8) — dirty air reaches further
  assert.ok(DIRTY_WEAR > 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run (inside `ApexWeb/`): `node --test tests/data.test.js` → FAIL (consts undefined).

- [ ] **Step 3: Implement** — add to `ApexWeb/src/data.js` right after the `FIT_K` const:

```js
// overtaking model (Phase 4). slipstream tow on straights; dirty air in corners.
export const SLIP_K     = 0.25;  // pass-credit/tick from tow, × straightness × car.power
export const DIRTY_GAP  = 1.5;   // seconds: within this behind a car you are in dirty air
export const DIRTY_WEAR = 0.006; // extra tyre wear/tick in dirty air, × (1 - straightness)
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/data.test.js` → PASS. `node --test` → all green.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/data.js ApexWeb/tests/data.test.js
git commit -m "feat(apexweb): overtaking constants — slipstream + dirty air (phase 4)"
```

---

## Task 2: overtake.js — pure slipstream / dirty-air / accrual

**Files:** Create `ApexWeb/src/overtake.js`; Test `ApexWeb/tests/overtake.test.js`.

- [ ] **Step 1: Write the failing test** — `ApexWeb/tests/overtake.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { slipstream, dirtyWear, passAccrual } from "../src/overtake.js";

test("slipstream is stronger on straights and for powerful cars", () => {
  assert.ok(slipstream(1, 0.95) > slipstream(0, 0.95));   // straight vs corner
  assert.ok(slipstream(1, 0.95) > slipstream(1, 0.78));   // power vs less power
  assert.equal(slipstream(0, 0.95), 0);                    // no tow in a tight corner
});

test("dirty air wears more in corners than on straights", () => {
  assert.ok(dirtyWear(0) > dirtyWear(1));
  assert.equal(dirtyWear(1), 0);                           // clean air on a straight
});

test("pass-credit accrues faster on straights, with tow, and on push", () => {
  const edge = 0.3;
  assert.ok(passAccrual(edge, 0, "standard", 1) > passAccrual(edge, 0, "standard", 0)); // straight > corner
  assert.ok(passAccrual(edge, 0.2, "standard", 1) > passAccrual(edge, 0, "standard", 1)); // tow helps
  assert.ok(passAccrual(edge, 0, "push", 1) > passAccrual(edge, 0, "standard", 1));        // push helps
  assert.equal(passAccrual(-1, 0, "standard", 1), passAccrual(0, 0, "standard", 1));       // negative edge floored at 0
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/overtake.test.js` → FAIL (cannot find module ../src/overtake.js).

- [ ] **Step 3: Implement** — `ApexWeb/src/overtake.js`:

```js
// ApexWeb/src/overtake.js — pure wheel-to-wheel helpers. Straightness (0..1) comes
// from track.sampleAt(). Driver overtaking/defending attrs arrive in Phase 7.
import { SLIP_K, DIRTY_WEAR } from "./data.js";

// slipstream tow (pass-credit/tick) — only on straights; powerful cars tow better.
export function slipstream(straightness, power) {
  return SLIP_K * straightness * power;
}

// extra tyre wear/tick while in dirty air — worse in corners, zero on a clean straight.
export function dirtyWear(straightness) {
  return DIRTY_WEAR * (1 - straightness);
}

// pass-credit accrued this tick: (pace edge + tow), faster in braking zones (high straightness),
// boosted by an engine push. Negative edge floored at 0.
export function passAccrual(edge, tow, engine, straightness) {
  const push = engine === "push" ? 1.3 : 1;
  return (Math.max(0, edge) + tow) * push * (0.5 + straightness);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/overtake.test.js` → 3 pass. `node --test` → all green.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/overtake.js ApexWeb/tests/overtake.test.js
git commit -m "feat(apexweb): pure overtake helpers (slipstream, dirty-air wear, pass accrual)"
```

---

## Task 3: sim.js — combat v2 (slipstream + dirty air)

**Files:** Modify `ApexWeb/src/sim.js`; Test `ApexWeb/tests/sim.test.js`.

- [ ] **Step 1: Add failing test** — append to `ApexWeb/tests/sim.test.js`:

```js
test("following closely in dirty air wears the tyres faster than running in clean air", () => {
  function bWear(behind) {
    const r = new Race(field(), TRACK, 9);
    const a = r.cars[0], b = r.cars[1];
    a.skill = 0.90; b.skill = 0.88;
    // park every other car far away on the lap so only the a/b interaction matters
    for (let i = 0; i < r.cars.length; i++) { r.cars[i].lap = 1; r.cars[i].lapFrac = 0.02 * i; }
    if (behind) { a.lapFrac = 0.60; b.lapFrac = 0.60 - 0.6 / TRACK.lt; }  // b ~0.6s behind a
    else        { a.lapFrac = 0.05; b.lapFrac = 0.60; }                   // b in clean air, far from a
    for (let k = 0; k < 700; k++) r.step();   // ~2 laps
    return b.wear;
  }
  assert.ok(bWear(true) > bWear(false), "dirty air should wear the follower's tyres faster");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/sim.test.js` → FAIL (dirty-air wear not modelled yet → behind ≈ clean).

- [ ] **Step 3: Apply edits to `ApexWeb/src/sim.js`** (READ first):

**3a.** Extend the track import to include `sampleAt`, and add the overtake import. Change:
```js
import { miniSplits, MINI, N_MINI } from "./track.js";
```
to:
```js
import { miniSplits, MINI, N_MINI, sampleAt } from "./track.js";
import { slipstream, dirtyWear, passAccrual } from "./overtake.js";
```
And add `DIRTY_GAP` to the data import (it currently imports `COMPOUNDS, PACE_MODES, SKILL_K, CAR_K, STEP, DNF_BASE, GRID_GAP, COMBAT_GAP, TYRE`):
```js
import { COMPOUNDS, PACE_MODES, SKILL_K, CAR_K, STEP, DNF_BASE, GRID_GAP, COMBAT_GAP, TYRE, DIRTY_GAP } from "./data.js";
```

**3b.** In the constructor car object, add a dirty-air scratch accumulator after `lastMini: [], bestMini: ..., miniColors: [], sectorTimes: [0, 0, 0],`:
```js
      _dirtyWear: 0,
```

**3c.** In `step()` lap completion, apply the accumulated dirty-air wear and reset it. Change:
```js
        c.wear += comp.wear * pm.wear;
        c.tyreTemp = warmStep(c.tyreTemp, c.tyre);
```
to:
```js
        c.wear += comp.wear * pm.wear + c._dirtyWear;   // dirty-air wear accrued while following
        c._dirtyWear = 0;
        c.tyreTemp = warmStep(c.tyreTemp, c.tyre);
```

**3d.** Replace the body of `_resolveCombat` with the slipstream + dirty-air version. The current method is:
```js
  _resolveCombat() {
    const ord = this.order(); // sorted leaders-first; pos set
    for (let i = 1; i < ord.length; i++) {
      const ahead = ord[i - 1], me = ord[i];
      if (me.retired || ahead.retired) continue;
      const gapLaps = (ahead.lap + ahead.lapFrac) - (me.lap + me.lapFrac);
      const gapSec = gapLaps * this.track.lt;
      if (gapSec > 0 && gapSec < COMBAT_GAP && me.lap === ahead.lap) {
        const edge = this._lapTime(ahead) - this._lapTime(me);   // >0 => me faster
        me._passCredit = (me._passCredit ?? 0) + Math.max(0, edge) * (me.engine === "push" ? 1.3 : 1);
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
```
Replace it with:
```js
  _resolveCombat() {
    const ord = this.order(); // sorted leaders-first; pos set
    for (let i = 1; i < ord.length; i++) {
      const ahead = ord[i - 1], me = ord[i];
      if (me.retired || ahead.retired) continue;
      const gapSec = ((ahead.lap + ahead.lapFrac) - (me.lap + me.lapFrac)) * this.track.lt;
      const s = sampleAt(me.lapFrac).straightness;          // local track character at the follower
      // dirty air: sitting close (even outside passing range) costs the follower tyre life, worse in corners
      if (gapSec > 0 && gapSec < DIRTY_GAP) me._dirtyWear += dirtyWear(s);
      // close combat: hold-up + pass-credit, with slipstream and braking-zone concentration
      if (gapSec > 0 && gapSec < COMBAT_GAP && me.lap === ahead.lap) {
        const edge = this._lapTime(ahead) - this._lapTime(me);   // >0 => me faster
        const tow = slipstream(s, me.car.power);
        me._passCredit = (me._passCredit ?? 0) + passAccrual(edge, tow, me.engine, s);
        const resist = (1 - this.track.ot) * 2.0;                 // high where ot low
        if (me._passCredit < resist) {
          // pinned behind the car ahead (writes ONLY lapFrac — invariant)
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/sim.test.js` → all pass (incl. the new dirty-air case AND the existing "a clearly faster car gains positions" / determinism / invariant tests — they must still pass). `node --test` → all green. If "faster car gains positions" now fails (dirty air slows the chaser too much), that's a balance signal — report it; do NOT weaken tests.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/sim.js ApexWeb/tests/sim.test.js
git commit -m "feat(apexweb): combat v2 — slipstream tow + dirty-air wear (segment-aware)"
```

---

## Task 4: balance.mjs — overtaking corridor

**Files:** Modify `ApexWeb/tools/balance.mjs`.

- [ ] **Step 1: Implement** — add to `ApexWeb/tools/balance.mjs` after the sector block:

```js
// overtaking corridor: racing happens (net position change from grid to flag) but isn't chaos,
// and dirty air bites harder in corners than on straights.
{
  const { dirtyWear } = await import("../src/overtake.js");
  let moved = 0;
  for (let s = 0; s < 20; s++) {
    const r = new Race(field(), TRACK, 9000 + s);
    r.gridStart();
    const start = Object.fromEntries(r.order().map(c => [c.idx, c.pos]));
    let g = 0; while (!r.finished && g++ < 500000) r.step();
    const fin = r.order();
    moved += fin.reduce((a, c) => a + Math.abs(c.pos - start[c.idx]), 0) / fin.length;
  }
  console.log(`overtaking: avg |grid→finish| position change = ${(moved / 20).toFixed(2)} places/car ` +
    `(expect ~1-5: racing, not a procession or chaos); dirty-air wear corner/straight = ` +
    `${dirtyWear(0).toFixed(4)}/${dirtyWear(1).toFixed(4)}`);
}
```

- [ ] **Step 2: Run it**

Run (inside `ApexWeb/`): `node tools/balance.mjs`
Expected: `overtaking:` prints an avg position change ~1-5 places/car (there is racing, not a frozen procession; not double-digit chaos) and `dirty-air wear corner/straight` with corner > straight (straight = 0). Confirm the earlier corridors still print sanely. If the position change is ~0 (procession), passing is too hard — lower `track.ot` reliance is out of scope; just report the number. If it's >8 (chaos), report it.

- [ ] **Step 3: Commit**

```
git add ApexWeb/tools/balance.mjs
git commit -m "feat(apexweb): balance harness overtaking corridor"
```

---

## Notes for the implementer

- **Combat invariant preserved:** `_resolveCombat` writes only `lapFrac` (the hold-up clamp) plus the `_passCredit`/`_dirtyWear` scratch fields. Tyre wear is applied in step()'s phase-3 lap-end. Never assign `lap` in combat.
- **Determinism intact:** `sampleAt`/`slipstream`/`dirtyWear`/`passAccrual` are pure; no RNG added. The existing determinism test must still pass.
- **No UI/snapshot change** — the effects show up as lap-time/position/wear, already visible in the HUD. (A "tow / dirty air" radio hint could come later.)
- **Owner playtest (browser, hard-reload):** a chasing car closes faster down the straights (tow), passes tend to happen into the braking zones, and a car that sits glued behind a rival burns its tyres up (dirty air) — so camping is punished; you commit a move or back off to cool the tyres.
- Next plan: **Phase 5 — events (start incident + safety car)**.
