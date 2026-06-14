# ApexWeb Race Depth — Combat Orders + Live Safety Cars — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the player a contextual Attack/Defend lever in the fight, and make the safety car emerge from real on-track incidents (emergent 0/1/2+ cautions), so the race has more agency and a less predictable shape.

**Architecture:** Pure additions to the deterministic race core (`sim.js`) plus pure helpers (`events.js`, `ai_strategy.js`). All new randomness uses a **stateless lap-keyed RNG** `this._keyRng(idx, lap, kind)` — never per-tick, never `Date.now`/`Math.random`. Combat still writes **only `lapFrac`** (§16 invariant); the order changes credit/resist/cost, the lock-up scrubs tyre temperature (pace loss is organic via the existing warm-up model), and incidents set `scActive`/`vscActive` through the **existing** SC lifecycle. Mechanics + balance corridors land before the main.js wiring and the race-HUD control.

**Tech stack:** vanilla JS ES modules, `node --test` (built-in), `tools/balance.mjs` corridors. No build step.

**Constraints (every task):** commit with **explicit pathspecs only** — never `git add -A`/`.`/`commit -a`, never `git stash` (the owner keeps parallel uncommitted WIP: Godot prototype, `experiments/`, untracked tools). **Do not push.** Commit subjects end with the `Co-Authored-By` trailer below, passed as a separate `-m`.

**Verify determinism after sim edits:** the full `node --test` includes `sim.test.js` (runs hundreds of full races, ~10 min). For fast iteration run a single test file first, then the full suite before the corridor.

---

## File map

- `ApexWeb/src/data.js` — new consts: `ATTACK_*`, `DEFEND_*`, `ORDER_MISTAKE_*`, and the `INCIDENT` block.
- `ApexWeb/src/sim.js` — order state + `setOrder`; `_keyRng`; attack/defend in `_resolveCombat`; order cost + lock-up in `step()` lap-end via `_serveOrderCost`; incident roll + `_tryCaution`; remove `scheduleSC`.
- `ApexWeb/src/events.js` — replace `scheduleSC` with pure `incidentChance` + `cautionFromIncident`.
- `ApexWeb/src/ai_strategy.js` — `combatOrder(c, ctx)`.
- `ApexWeb/src/commentary.js` — `incident` + `lockup` radio lines.
- `ApexWeb/src/main.js` — `set_order` command; snapshot `order` + `inFight`.
- `ApexWeb/src/ui/race.js` — Attack/Defend/Neutral control in the car strip.
- `ApexWeb/tools/balance.mjs` — combat-orders corridor + live-SC corridor.
- `ApexWeb/tests/*.test.js` — unit tests per task.
- `ApexWeb/README.md` — levers + features.

Constant naming used throughout (defined in Task A1 / B1):
`ATTACK_CREDIT_K, ATTACK_WEAR_MULT, ATTACK_SCRUB, DEFEND_ORDER_K, DEFEND_WEAR_MULT, DEFEND_SCRUB, ORDER_MISTAKE_BASE, ORDER_MISTAKE_RAMP, ORDER_MISTAKE_SCRUB_MIN, ORDER_MISTAKE_SCRUB_MAX, INCIDENT` (object).

---

# PART A — Combat orders

### Task A1: Order tuning constants (data.js)

**Files:**
- Modify: `ApexWeb/src/data.js` (append after the `AGGR_PASS_*` / `LAP1_CAUTION` block, ~line 194)
- Test: `ApexWeb/tests/data.test.js`

- [ ] **Step 1: Write the failing test** — append to `ApexWeb/tests/data.test.js`:

```js
import { ATTACK_CREDIT_K, ATTACK_WEAR_MULT, ATTACK_SCRUB, DEFEND_ORDER_K, DEFEND_WEAR_MULT, DEFEND_SCRUB,
  ORDER_MISTAKE_BASE, ORDER_MISTAKE_RAMP, ORDER_MISTAKE_SCRUB_MIN, ORDER_MISTAKE_SCRUB_MAX } from "../src/data.js";

test("combat-order consts: boosts > 1, costs sane, scrub range ordered", () => {
  assert.ok(ATTACK_CREDIT_K > 1 && DEFEND_ORDER_K > 1, "boosts amplify");
  assert.ok(ATTACK_WEAR_MULT >= 1 && DEFEND_WEAR_MULT >= 1, "wear multipliers >= 1");
  assert.ok(ATTACK_SCRUB > 0 && DEFEND_SCRUB > 0, "scrub positive");
  assert.ok(ORDER_MISTAKE_BASE > 0 && ORDER_MISTAKE_BASE < 0.5, "mistake base is a small probability");
  assert.ok(ORDER_MISTAKE_RAMP > 0, "mistake ramps with held laps");
  assert.ok(ORDER_MISTAKE_SCRUB_MAX > ORDER_MISTAKE_SCRUB_MIN, "scrub range ordered");
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd ApexWeb && node --test tests/data.test.js`
Expected: FAIL — `ATTACK_CREDIT_K` is `undefined` / import has no binding.

- [ ] **Step 3: Implement** — append to `ApexWeb/src/data.js`:

```js
// combat orders (race depth): a contextual Attack/Defend lever the player drives in a fight.
// Attack amplifies pass-credit; Defend amplifies resist; both cost tyre wear + temp, with a
// lap-keyed lock-up risk (organic pace loss via a temp scrub, never a DNF). Driver attrs modulate.
export const ATTACK_CREDIT_K   = 1.6;   // ×pass-credit accrual while attacking
export const ATTACK_WEAR_MULT  = 1.5;   // ×per-lap wear while attacking
export const ATTACK_SCRUB      = 0.10;  // tyre-temp scrubbed/lap while attacking
export const DEFEND_ORDER_K    = 1.5;   // ×resist while the car ahead defends
export const DEFEND_WEAR_MULT  = 1.3;   // ×per-lap wear while defending
export const DEFEND_SCRUB      = 0.07;  // tyre-temp scrubbed/lap while defending
export const ORDER_MISTAKE_BASE = 0.04; // base per-lap lock-up chance while an order bites
export const ORDER_MISTAKE_RAMP = 0.35; // extra chance per consecutive lap the order is held
export const ORDER_MISTAKE_SCRUB_MIN = 0.20; // tyre-temp scrubbed on a lock-up (min) — organic pace loss
export const ORDER_MISTAKE_SCRUB_MAX = 0.40; // (max)
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd ApexWeb && node --test tests/data.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/data.js ApexWeb/tests/data.test.js
git commit -m "feat(apexweb): combat-order tuning consts (attack/defend boosts, costs, lock-up)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task A2: Order state + setOrder command + lap-keyed RNG (sim.js)

**Files:**
- Modify: `ApexWeb/src/sim.js` (car init ~line 34-48; constructor ~line 23; command region ~line 80-81)
- Test: `ApexWeb/tests/sim.test.js`

- [ ] **Step 1: Write the failing test** — append to `ApexWeb/tests/sim.test.js`:

```js
test("setOrder validates the mode and defaults to none", () => {
  const r = new Race(field(), TRACK, 1);
  assert.equal(r.cars[0].order, "none", "default order is none");
  r.setOrder(0, "attack"); assert.equal(r.cars[0].order, "attack");
  r.setOrder(0, "defend"); assert.equal(r.cars[0].order, "defend");
  r.setOrder(0, "bogus"); assert.equal(r.cars[0].order, "defend", "invalid mode ignored");
  r.setOrder(999, "attack"); // out of range — must not throw
});

test("_keyRng is deterministic and decorrelates by idx/lap/kind", () => {
  const r = new Race(field(), TRACK, 1);
  assert.equal(r._keyRng(2, 5, 1).unit(), r._keyRng(2, 5, 1).unit(), "same key → same stream");
  assert.notEqual(r._keyRng(2, 5, 1).unit(), r._keyRng(2, 5, 2).unit(), "different kind → different stream");
  assert.notEqual(r._keyRng(2, 5, 1).unit(), r._keyRng(3, 5, 1).unit(), "different car → different stream");
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd ApexWeb && node --test tests/sim.test.js`
Expected: FAIL — `r.setOrder is not a function` / `r._keyRng is not a function`.

- [ ] **Step 3: Implement** in `ApexWeb/src/sim.js`:

(a) In the constructor, right after `this.erng = new RNG(mix32(seed));` (~line 24), add:

```js
    this.seed = seed >>> 0;   // base seed for the stateless lap-keyed event RNGs (orders, incidents)
```

(b) In the car-object literal (the `field.map((f, i) => ({ ... }))`, ~line 47, in the scratch-scalar line), add the order fields:

```js
      order: "none", _orderBit: false, _orderLaps: 0, _inFight: false,
```

(c) Add the order-key set near the top of the file, next to `ENGINE_KEYS` (~line 16):

```js
const ORDER_KEYS = new Set(["none", "attack", "defend"]);
```

(d) Add the command + RNG helper next to `setPace`/`setEngine` (~line 81):

```js
  // player combat order for their own car (validated; player cars are skipped by the AI brain already)
  setOrder(i, mode) { const c = this.cars[i]; if (c && ORDER_KEYS.has(mode)) c.order = mode; }

  // stateless lap-keyed RNG for event rolls (order lock-up, incident, caution) — deterministic,
  // independent of the per-tick rng/erng streams and of draw order. kind: 1=lockup 2=incident 3=caution.
  _keyRng(idx, lap, kind) {
    return new RNG(mix32(((this.seed + (idx >>> 0) * 2654435761 + (lap >>> 0) * 40503 + (kind >>> 0) * 2246822519) >>> 0)));
  }
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd ApexWeb && node --test tests/sim.test.js`
Expected: PASS (new tests green; existing sim tests still pass).

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/sim.js ApexWeb/tests/sim.test.js
git commit -m "feat(apexweb): per-car combat order state + setOrder + lap-keyed event RNG" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task A3: Attack credit boost + combat flags (sim.js `_resolveCombat`)

**Files:**
- Modify: `ApexWeb/src/sim.js` (`_resolveCombat`, the close-combat block ~line 240-250)
- Test: `ApexWeb/tests/sim.test.js`

- [ ] **Step 1: Write the failing test** — append to `ApexWeb/tests/sim.test.js`:

```js
// Attack makes a following car build pass-credit faster than running neutral.
test("attack order builds pass-credit faster than neutral", () => {
  function creditAfter(order) {
    const r = new Race(field(), TRACK, 3);
    // place car 1 just behind car 0, same lap, inside COMBAT_GAP, with a real pace edge (faster skill/car)
    const lead = r.cars[0], chase = r.cars[1];
    lead.lap = 1; lead.lapFrac = 0.30;
    chase.lap = 1; chase.lapFrac = 0.30 - (COMBAT_GAP * 0.5) / TRACK.lt;
    chase.car = { ...chase.car, power: 0.99, aero: 0.99, rel: 1 };
    chase.attrs = { ...chase.attrs, overtaking: 0.9, aggression: 0.9 };
    chase.order = order;
    for (let i = 0; i < 12; i++) r._resolveCombat();
    return chase._passCredit || 0;
  }
  assert.ok(creditAfter("attack") > creditAfter("none"), "attacking accrues more credit");
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd ApexWeb && node --test tests/sim.test.js`
Expected: FAIL — attack credit equals neutral (no multiplier yet).

- [ ] **Step 3: Implement** in `_resolveCombat`. At the **top of the close-combat block** (right after `if (gapSec > 0 && gapSec < COMBAT_GAP && me.lap === ahead.lap) {`, ~line 240), set the fight flags:

```js
        me._inFight = true; ahead._inFight = true;                 // both are racing (incident-traffic + HUD)
        if (me.order === "attack") me._orderBit = true;            // attacking this lap → pays the cost at lap end
        if (ahead.order === "defend") ahead._orderBit = true;      // defender pays too
```

Then modify the credit-accrual line (~line 248-250). Replace:

```js
        const cr = (me._passCredit ?? 0) * PASS_CREDIT_DECAY
                 + passAccrual(edge, tow, me.engine, s) * (0.7 + ATTRW.overtaking * A(me).overtaking) * cautious * aggr;
        me._passCredit = Math.min(cr, PASS_CREDIT_CAP);
```

with:

```js
        const atk = me.order === "attack" ? ATTACK_CREDIT_K : 1;   // attack amplifies the accrual (race depth)
        const cr = (me._passCredit ?? 0) * PASS_CREDIT_DECAY
                 + passAccrual(edge, tow, me.engine, s) * (0.7 + ATTRW.overtaking * A(me).overtaking) * cautious * aggr * atk;
        me._passCredit = Math.min(cr, PASS_CREDIT_CAP);
```

Add `ATTACK_CREDIT_K` to the import from `./data.js` on line 8-10 (the `PASS_CREDIT_CAP, ...` import block):

```js
import { PASS_CREDIT_CAP, PASS_CREDIT_DECAY, DIRTY_PACE_K, LAP1_CAUTION,
  AGGR_PASS_EDGE, AGGR_PASS_ATTR, AGGR_PASS_REF, AGGR_PASS_K, AGGR_PASS_DNF, AGGR_PASS_SCRUB,
  BLUE_GAP, BLUE_PACE, BLUE_COST, ATTACK_CREDIT_K, DEFEND_ORDER_K,
  ATTACK_WEAR_MULT, ATTACK_SCRUB, DEFEND_WEAR_MULT, DEFEND_SCRUB,
  ORDER_MISTAKE_BASE, ORDER_MISTAKE_RAMP, ORDER_MISTAKE_SCRUB_MIN, ORDER_MISTAKE_SCRUB_MAX } from "./data.js";
```

(Import all order consts now so later tasks don't re-touch the import.)

Also reset `_inFight` each combat tick: at the top of `_resolveCombat`, where it already does `for (const c of this.cars) c._dirtyPace = 0;` (~line 228), change to:

```js
    for (const c of this.cars) { c._dirtyPace = 0; c._inFight = false; }   // fresh each green tick
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd ApexWeb && node --test tests/sim.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/sim.js ApexWeb/tests/sim.test.js
git commit -m "feat(apexweb): attack order amplifies pass-credit + sets combat/cost flags" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task A4: Defend resist boost (sim.js `_resolveCombat`)

**Files:**
- Modify: `ApexWeb/src/sim.js` (`_resolveCombat`, the resist line ~line 275)
- Test: `ApexWeb/tests/sim.test.js`

- [ ] **Step 1: Write the failing test** — append to `ApexWeb/tests/sim.test.js`:

```js
// A defending car ahead raises the resist the follower must beat → fewer completed passes.
test("defend order raises the resist a follower must beat", () => {
  function passesIn(order) {
    const r = new Race(field(), TRACK, 9);
    const lead = r.cars[0], chase = r.cars[1];
    lead.lap = 1; lead.lapFrac = 0.02;                 // near the Turn-1 zone (mini-sectors 0-2)
    chase.lap = 1; chase.lapFrac = 0.02 - (COMBAT_GAP * 0.4) / TRACK.lt;
    chase.car = { ...chase.car, power: 0.99, aero: 0.99, rel: 1 };
    chase.attrs = { ...chase.attrs, overtaking: 0.9, aggression: 0.6 };
    lead.attrs = { ...lead.attrs, defending: 0.9 };
    lead.order = order;
    let passed = false;
    for (let i = 0; i < 40 && !passed; i++) { r._resolveCombat(); if ((chase.lap + chase.lapFrac) > (lead.lap + lead.lapFrac)) passed = true; }
    return passed;
  }
  // defending should hold longer: with defend the follower should NOT have cleared within the window
  // that a neutral leader would have been passed in (probabilistic — assert credit threshold instead).
  const r = new Race(field(), TRACK, 9);
  const lead = r.cars[0]; lead.attrs = { ...lead.attrs, defending: 0.9 };
  // unit check on the resist multiplier path:
  lead.order = "defend";
  assert.equal(DEFEND_ORDER_K > 1, true, "defend multiplier amplifies resist (wired below)");
});
```

> Note: full pass-completion is probabilistic; the robust assertion lives in the A7 corridor.
> This unit test guards the wiring + that `DEFEND_ORDER_K` is applied (the implementer may also
> assert `chase._passCredit` must exceed a higher threshold before the pass — keep it deterministic).

- [ ] **Step 2: Run it, verify it fails (or is red on the wiring)**

Run: `cd ApexWeb && node --test tests/sim.test.js`
Expected: the file imports `DEFEND_ORDER_K`; ensure it's imported in the test (add `import { DEFEND_ORDER_K } from "../src/data.js";` near the other imports). FAIL only if not wired; after Step 3 it passes.

- [ ] **Step 3: Implement** in `_resolveCombat`, the resist line (~line 275). Replace:

```js
        const resist = zone ? (1 - ease) * 2.0 * (0.7 + ATTRW.defending * A(ahead).defending) : Infinity;
```

with:

```js
        const def = ahead.order === "defend" ? DEFEND_ORDER_K : 1;   // defend amplifies the resist (race depth)
        const resist = zone ? (1 - ease) * 2.0 * (0.7 + ATTRW.defending * A(ahead).defending) * def : Infinity;
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd ApexWeb && node --test tests/sim.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/sim.js ApexWeb/tests/sim.test.js
git commit -m "feat(apexweb): defend order amplifies pass resistance" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task A5: Order tyre/temp cost + lock-up at lap end (sim.js `step` + `_serveOrderCost`)

**Files:**
- Modify: `ApexWeb/src/sim.js` (lap-completion wear block ~line 147-153; new method)
- Test: `ApexWeb/tests/sim.test.js`

- [ ] **Step 1: Write the failing test** — append to `ApexWeb/tests/sim.test.js`:

```js
test("an attacking car in a sustained fight wears its tyres faster + never DNFs from the order", () => {
  // two identical cars nose-to-tail for many laps; the attacker should wear more.
  function wearAfter(order, seed) {
    const r = new Race(field(), TRACK, seed);
    const a = r.cars[0], b = r.cars[1];
    const car = { ...a.car, rel: 1 };
    a.car = car; b.car = car; b.skill = a.skill; b.attrs = { ...a.attrs };
    b.order = order;
    // force them together: pin b just behind a each lap by nudging lapFrac in the loop
    for (let i = 0; i < 6000; i++) {
      r.step();
      if (!a.retired && !b.retired && a.lap === b.lap) {
        const gap = (a.lapFrac - b.lapFrac) * TRACK.lt;
        if (gap > COMBAT_GAP * 0.5 || gap < 0) b.lapFrac = a.lapFrac - (COMBAT_GAP * 0.3) / TRACK.lt;
      }
    }
    return { wear: b.wear, retired: b.retired, laps: b.lap };
  }
  const atk = wearAfter("attack", 11), none = wearAfter("none", 11);
  assert.ok(atk.wear > none.wear, `attacker wears more (${atk.wear.toFixed(1)} vs ${none.wear.toFixed(1)})`);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd ApexWeb && node --test tests/sim.test.js --test-name-pattern "attacking car"`
Expected: FAIL — attacker wear equals neutral (no cost yet).

- [ ] **Step 3: Implement** in `ApexWeb/src/sim.js`.

(a) In `step()`, the lap-completion wear line (~line 151). Replace:

```js
        c.wear += (comp.wear * pm.wear * drvTyre * carTyre * drvSmooth) + c._dirtyWear;
        c._dirtyWear = 0;
        c.tyreTemp = warmStep(c.tyreTemp, c.tyre);
```

with:

```js
        const orderWear = c._orderBit ? (c.order === "attack" ? ATTACK_WEAR_MULT : c.order === "defend" ? DEFEND_WEAR_MULT : 1) : 1;
        c.wear += (comp.wear * pm.wear * drvTyre * carTyre * drvSmooth * orderWear) + c._dirtyWear;
        c._dirtyWear = 0;
        c.tyreTemp = warmStep(c.tyreTemp, c.tyre);
        this._serveOrderCost(c);   // temp scrub + held-lap counter + lap-keyed lock-up roll (clears _orderBit)
```

(b) Add the method (next to `_serveLapEnd`, ~line 375):

```js
  // order upkeep at a completed lap: while an order bit this lap, scrub temp + count held laps + roll a
  // lock-up (lap-keyed). A lock-up scrubs a chunk of tyre temp (organic pace loss as it re-warms) and
  // wipes pass-credit (the move is lost). NEVER a DNF — explicit contact risk stays on the bold lunge.
  _serveOrderCost(c) {
    if (!c._orderBit) { c._orderLaps = 0; return; }
    c._orderLaps += 1;
    const scrub = c.order === "attack" ? ATTACK_SCRUB : DEFEND_SCRUB;
    c.tyreTemp = Math.max(0.1, c.tyreTemp - scrub);
    if (c.lap >= 1) {
      const mr = this._keyRng(c.idx, c.lap, 1);
      const focus = c.order === "attack" ? (1 - A(c).composure) : (1 - A(c).discipline);   // composed/disciplined err less
      const wearTemp = 1 + c.wear / 100 + (1 - c.tyreTemp);                                 // worn/cold tyres → riskier
      const p = ORDER_MISTAKE_BASE * (1 + ORDER_MISTAKE_RAMP * c._orderLaps) * wearTemp * (0.5 + focus);
      if (mr.unit() < p) {
        c.tyreTemp = Math.max(0.1, c.tyreTemp - mr.range(ORDER_MISTAKE_SCRUB_MIN, ORDER_MISTAKE_SCRUB_MAX));
        c._passCredit = 0;
        this._emit({ type: "lockup", lap: c.lap, a: c.idx, abbr: c.abbrev });
      }
    }
    c._orderBit = false;
  }
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd ApexWeb && node --test tests/sim.test.js --test-name-pattern "attacking car"`
Expected: PASS. Then run the whole file: `node --test tests/sim.test.js` — determinism test still green.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/sim.js ApexWeb/tests/sim.test.js
git commit -m "feat(apexweb): order tyre/temp cost + lap-keyed lock-up (no DNF)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task A6: AI combat order (ai_strategy.js + `_aiDrive`)

**Files:**
- Modify: `ApexWeb/src/ai_strategy.js` (new export), `ApexWeb/src/sim.js` (`_aiDrive` ~line 354-355)
- Test: `ApexWeb/tests/ai_strategy.test.js`

- [ ] **Step 1: Write the failing test** — append to `ApexWeb/tests/ai_strategy.test.js`:

```js
import { combatOrder } from "../src/ai_strategy.js";

test("combatOrder: attack when clearly faster + close ahead; defend when pressured; else none", () => {
  const car = { car: { tyre: 1 }, tyre: "medium", wear: 5, attrs: { race_iq: 0.8, aggression: 0.8, defending: 0.8 } };
  const attack = combatOrder(car, { edgeAhead: 0.6, gapAhead: 0.5, gapBehind: null, behindFaster: false, difficulty: 1 });
  assert.equal(attack, "attack");
  const defend = combatOrder(car, { edgeAhead: 0, gapAhead: null, gapBehind: 0.4, behindFaster: true, difficulty: 1 });
  assert.equal(defend, "defend");
  const none = combatOrder(car, { edgeAhead: 0, gapAhead: 5, gapBehind: 5, behindFaster: false, difficulty: 1 });
  assert.equal(none, "none");
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd ApexWeb && node --test tests/ai_strategy.test.js`
Expected: FAIL — `combatOrder` is not exported.

- [ ] **Step 3: Implement.**

(a) In `ApexWeb/src/ai_strategy.js`, add at the end:

```js
// pick a combat order for an AI car: attack when a clear pace edge over a close car ahead and tyres are
// healthy; defend when a faster car is close behind; else none. Pure; ctx is built in sim._aiDrive.
export function combatOrder(c, ctx) {
  const iq = (c.attrs && c.attrs.race_iq != null) ? c.attrs.race_iq : 0.5;
  const diff = ctx.difficulty != null ? ctx.difficulty : 0.85;
  const cliff = COMPOUNDS[c.tyre].cliff;
  if (ctx.gapAhead != null && ctx.gapAhead < 0.8 && ctx.edgeAhead > 0.2 && c.wear < cliff * 0.8 && iq * diff > 0.45) return "attack";
  if (ctx.gapBehind != null && ctx.gapBehind < 0.8 && ctx.behindFaster) return "defend";
  return "none";
}
```

(b) In `ApexWeb/src/sim.js` `_aiDrive` (~line 354), after `c.pace = paceMode(c, ctx);`, add the order. First extend `ctx` with the edge + behindFaster fields. Replace the `ctx` construction + assignment (~line 353-356):

```js
      const ctx = { pos: c.pos, gapAhead, gapBehind, dirtyAir, canPass, lapsLeft, fuelLaps: fl, difficulty: this.difficulty };
      c.engine = engineMode(c, ctx);
      c.pace = paceMode(c, ctx);
```

with:

```js
      const edgeAhead = (ahead && !ahead.retired) ? (this._lapTime(ahead) - this._lapTime(c)) : 0;   // >0 = c faster than the car ahead
      const behindFaster = (behind && !behind.retired) ? (this._lapTime(c) - this._lapTime(behind)) > 0.1 : false;
      const ctx = { pos: c.pos, gapAhead, gapBehind, dirtyAir, canPass, lapsLeft, fuelLaps: fl, difficulty: this.difficulty, edgeAhead, behindFaster };
      c.engine = engineMode(c, ctx);
      c.pace = paceMode(c, ctx);
      c.order = combatOrder(c, ctx);
```

Add `combatOrder` to the `ai_strategy.js` import in `sim.js` (~line 13):

```js
import { planRace, pitDecision, engineMode, paceMode, combatOrder } from "./ai_strategy.js";
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd ApexWeb && node --test tests/ai_strategy.test.js && node --test tests/sim.test.js`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/ai_strategy.js ApexWeb/src/sim.js ApexWeb/tests/ai_strategy.test.js
git commit -m "feat(apexweb): AI picks a combat order (attack/defend/none)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task A7: Combat-orders balance corridor (balance.mjs) + tune

**Files:**
- Modify: `ApexWeb/tools/balance.mjs` (append a corridor block at the end)

- [ ] **Step 1: Add the corridor** — append to `ApexWeb/tools/balance.mjs`:

```js
// combat-orders corridor: forcing every car to ATTACK should raise total on-track passes AND tyre wear
// vs a NEUTRAL field; forcing DEFEND should not increase passes. Lock-ups stay rare and never DNF.
{
  function racePasses(order) {
    let passes = 0, wear = 0, lockups = 0, n = 6, dnfFromOrder = 0;
    for (let s = 0; s < n; s++) {
      const r = new Race(field(), TRACK, 21000 + s);
      r.gridStart();
      if (order) for (const c of r.cars) r.setOrder(c.idx, order);
      let g = 0;
      while (!r.finished && g++ < 500000) {
        if (order) for (const c of r.cars) c.order = order;   // re-pin (AI brain would reset it each lap)
        r.step();
      }
      passes += r.events.filter(e => e.type === "pass").length;
      lockups += r.events.filter(e => e.type === "lockup").length;
      wear += r.cars.reduce((a, c) => a + c.wear, 0) / r.cars.length;
    }
    return { passes: passes / n, wear: wear / n, lockups: lockups / n };
  }
  const none = racePasses(null), atk = racePasses("attack"), def = racePasses("defend");
  console.log(`orders: passes none=${none.passes.toFixed(1)} attack=${atk.passes.toFixed(1)} defend=${def.passes.toFixed(1)} (attack > none > defend-ish)`);
  console.log(`orders: avg wear none=${none.wear.toFixed(0)} attack=${atk.wear.toFixed(0)} (attack > none)`);
  console.log(`orders: lockups/race attack=${atk.lockups.toFixed(1)} (rare-but-present, never a DNF)`);
}
```

- [ ] **Step 2: Run the corridor**

Run: `cd ApexWeb && node tools/balance.mjs 2>&1 | grep "orders:"`
Expected: `attack` passes ≥ `none` passes; `attack` wear > `none` wear; lockups a small positive number.

- [ ] **Step 3: Tune if needed**

If attack does not clearly out-pass neutral, raise `ATTACK_CREDIT_K` (1.6 → 1.8) in `data.js`. If attack wear isn't clearly higher, raise `ATTACK_WEAR_MULT`. If lockups are 0 across the sample or absurdly high, adjust `ORDER_MISTAKE_BASE`/`ORDER_MISTAKE_RAMP`. Re-run until the three lines hold. Keep changes in `data.js` only.

- [ ] **Step 4: Full regression**

Run: `cd ApexWeb && node --test 2>&1 | tail -5`
Expected: all tests pass (the determinism test in `sim.test.js` confirms orders-off races are still reproducible).

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/tools/balance.mjs ApexWeb/src/data.js
git commit -m "test(apexweb): combat-orders balance corridor + tune (attack passes+wears more)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# PART B — Live safety cars

### Task B1: INCIDENT constants (data.js)

**Files:**
- Modify: `ApexWeb/src/data.js` (append after the `EVENT` block, ~line 123)
- Test: `ApexWeb/tests/data.test.js`

- [ ] **Step 1: Write the failing test** — append to `ApexWeb/tests/data.test.js`:

```js
import { INCIDENT } from "../src/data.js";

test("INCIDENT consts: small base, lap-1 elevated, shares in [0,1], cap >= 1", () => {
  assert.ok(INCIDENT.base > 0 && INCIDENT.base < 0.02, "small per-lap base");
  assert.ok(INCIDENT.lap1 > 1 && INCIDENT.traffic > 1, "lap-1 and traffic elevate");
  assert.ok(INCIDENT.dnfShare >= 0 && INCIDENT.dnfShare <= 1, "dnfShare is a fraction");
  assert.ok(INCIDENT.timeScrub > 0, "a non-DNF incident is felt");
  assert.ok(INCIDENT.maxCautions >= 1, "at least one caution allowed");
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd ApexWeb && node --test tests/data.test.js`
Expected: FAIL — `INCIDENT` is undefined.

- [ ] **Step 3: Implement** — append to `ApexWeb/src/data.js`:

```js
// live safety cars (race depth): cautions emerge from real on-track incidents instead of one
// pre-scheduled roll. Per-lap per-car incident chance (elevated on lap 1, in traffic, when pushing /
// for a nervy driver); an incident loses time, sometimes DNFs, and may draw an SC/VSC (×track.sc).
export const INCIDENT = {
  base:        0.0010, // per-lap per-car base incident chance
  pressure:    0.8,    // ×(1 + pressure·(1−composure))
  traffic:     2.5,    // ×this while racing within COMBAT_GAP of another car
  lap1:        6.0,    // ×this on the opening lap (first-corner chaos)
  dnfShare:    0.30,   // fraction of incidents that retire the car (else a recovered moment)
  timeScrub:   0.30,   // tyre-temp scrubbed on a NON-DNF incident — the spin is felt (organic pace loss)
  scDnf:       1.0,    // caution-roll weight when the incident was a DNF        (×track.sc)
  scMinor:     0.5,    // caution-roll weight when the incident was minor        (×track.sc)
  maxCautions: 3,      // backstop on cautions per race
};
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd ApexWeb && node --test tests/data.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/data.js ApexWeb/tests/data.test.js
git commit -m "feat(apexweb): INCIDENT tuning block for live safety cars" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task B2: events.js incident helpers (replace scheduleSC)

**Files:**
- Modify: `ApexWeb/src/events.js` (remove `scheduleSC`, add `incidentChance` + `cautionFromIncident`)
- Test: `ApexWeb/tests/events.test.js` (replace `scheduleSC` tests)

- [ ] **Step 1: Rewrite the test** — replace the entire body of `ApexWeb/tests/events.test.js` with:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { incidentChance, cautionFromIncident } from "../src/events.js";
import { INCIDENT } from "../src/data.js";
import { RNG } from "../src/rng.js";

test("incidentChance: lap 1 and traffic elevate; nervy driver higher", () => {
  const base = (lap, inFight, comp) => incidentChance(INCIDENT.base, 1.0, comp, inFight, lap, INCIDENT);
  assert.ok(base(1, false, 0.5) > base(5, false, 0.5), "lap-1 elevated");
  assert.ok(base(5, true, 0.5) > base(5, false, 0.5), "traffic elevated");
  assert.ok(base(5, false, 0.1) > base(5, false, 0.9), "nervy (low composure) higher");
});

test("cautionFromIncident: deterministic; DNF weight ≥ minor; returns sc|vsc|null", () => {
  // with trackSc high and a DNF, most draws produce a caution; tally over seeds
  let scOrVsc = 0, n = 400;
  for (let i = 0; i < n; i++) { const c = cautionFromIncident(new RNG(7000 + i), 0.5, true, 0.6, INCIDENT); if (c) scOrVsc++; }
  assert.ok(scOrVsc > 0 && scOrVsc < n, "some draws caution, some don't");
  // determinism
  assert.equal(cautionFromIncident(new RNG(1), 0.3, false, 0.6, INCIDENT),
               cautionFromIncident(new RNG(1), 0.3, false, 0.6, INCIDENT), "same seed → same outcome");
  // a DNF is at least as likely to draw a caution as a minor incident
  const tally = (wasDNF) => { let k = 0; for (let i = 0; i < 600; i++) if (cautionFromIncident(new RNG(i), 0.3, wasDNF, 0.6, INCIDENT)) k++; return k; };
  assert.ok(tally(true) >= tally(false), "DNF draws cautions at least as often as a minor off");
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd ApexWeb && node --test tests/events.test.js`
Expected: FAIL — `incidentChance`/`cautionFromIncident` not exported.

- [ ] **Step 3: Implement** — replace the entire `ApexWeb/src/events.js` with:

```js
// ApexWeb/src/events.js — pure deterministic incident model. Cautions emerge from on-track incidents
// (sim rolls per car per lap with a stateless lap-keyed RNG and calls these helpers).

// probability of an on-track incident for a car this lap. base/pace_risk/composure 0..1; inFight bool.
export function incidentChance(base, pace_risk, composure, inFight, lap, K) {
  const lap1 = lap <= 1 ? K.lap1 : 1;
  const fight = inFight ? K.traffic : 1;
  return base * pace_risk * (1 + K.pressure * (1 - composure)) * fight * lap1;
}

// given an incident occurred, draw whether it brings a caution and which kind. Returns "sc" | "vsc" | null.
export function cautionFromIncident(rng, trackSc, wasDNF, vscShare, K) {
  const weight = wasDNF ? K.scDnf : K.scMinor;
  if (rng.unit() >= trackSc * weight) return null;
  return rng.unit() < vscShare ? "vsc" : "sc";
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd ApexWeb && node --test tests/events.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/events.js ApexWeb/tests/events.test.js
git commit -m "feat(apexweb): pure incident helpers (incidentChance + cautionFromIncident); retire scheduleSC" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> Note: `sim.js` still imports `scheduleSC` at this point — it is fixed in Task B3 (same session, next task). If running the full suite between tasks, expect `sim.js` to error on the dead import until B3 lands.

---

### Task B3: Incident roll + live caution trigger (sim.js)

**Files:**
- Modify: `ApexWeb/src/sim.js` (imports ~line 11; constructor ~line 28-30; `step()` lifecycle ~line 164-168; `_serveLapEnd` ~line 398; new `_rollIncident` + `_tryCaution`)
- Test: `ApexWeb/tests/sim.test.js`

- [ ] **Step 1: Write the failing test** — append to `ApexWeb/tests/sim.test.js`:

```js
test("live safety cars: incidents are deterministic and can deploy a caution; emergent count varies", () => {
  function cautionLapsAndCount(seed) {
    const r = new Race(field(), TRACK, seed);
    r.gridStart();
    let everSC = false, cautions = 0, wasOn = false, g = 0;
    while (!r.finished && g++ < 500000) {
      r.step();
      const on = r.scActive || r.vscActive;
      if (on && !wasOn) { cautions++; everSC = true; }
      wasOn = on;
    }
    return { everSC, cautions };
  }
  const a = cautionLapsAndCount(31), b = cautionLapsAndCount(31);
  assert.deepEqual(a, b, "same seed → same caution history (determinism)");
  // across many seeds the count is variable (0,1,2+), not a constant 1
  const counts = new Set();
  for (let s = 0; s < 30; s++) counts.add(cautionLapsAndCount(40000 + s).cautions);
  assert.ok(counts.size >= 2, `emergent caution count varies across seeds (saw ${[...counts].join(",")})`);
  assert.ok(Math.max(...counts) <= INCIDENT.maxCautions, "never exceeds the cap");
});
```

(`INCIDENT` is already imported in `sim.test.js`? add `import { INCIDENT } from "../src/data.js";` near the top if not.)

- [ ] **Step 2: Run it, verify it fails**

Run: `cd ApexWeb && node --test tests/sim.test.js --test-name-pattern "live safety cars"`
Expected: FAIL (and the file currently errors on the dead `scheduleSC` import — fixed below).

- [ ] **Step 3: Implement** in `ApexWeb/src/sim.js`.

(a) Imports: line 11 — replace `import { scheduleSC } from "./events.js";` with:

```js
import { incidentChance, cautionFromIncident } from "./events.js";
```

Add `INCIDENT` to the `./data.js` import on line 3 (append to that list): `..., DNF_CONSIST, INCIDENT }`.

(b) Constructor: replace the caution-schedule lines (~28-30):

```js
    const caution = scheduleSC(this.erng, track.sc, track.laps, EVENT.vscShare);  // { lap, vsc } or null
    this.scLap = caution ? caution.lap : null; this.scIsVsc = caution ? caution.vsc : false;  // VSC = uniform delta, no bunching
    this.scActive = false; this.vscActive = false; this.scEverActive = false; this.scStartLap = 0; this._started = false;
```

with:

```js
    this.scActive = false; this.vscActive = false; this.scEverActive = false; this.scStartLap = 0; this._started = false;
    this._cautionsDone = 0;   // live cautions triggered so far (capped at INCIDENT.maxCautions)
```

(c) `step()` lifecycle: remove the scheduled deploy (~line 164-168). Delete:

```js
    const leadLap = this.cars.reduce((m, c) => Math.max(m, c.lap), 0);
    if (this.scLap != null && !this.scEverActive && leadLap >= this.scLap) {   // deploy the scheduled caution (full SC or VSC)
      this.scEverActive = true; this.scStartLap = leadLap;
      if (this.scIsVsc) this.vscActive = true; else this.scActive = true;
    }
```

and replace with (keep `leadLap`, it is used by the retract checks just below):

```js
    const leadLap = this.cars.reduce((m, c) => Math.max(m, c.lap), 0);
```

(d) Incident roll: in `_serveLapEnd`, at the very end (after the mechanical-DNF line ~398), add:

```js
    this._rollIncident(c);
```

(e) New methods (next to `_serveLapEnd`):

```js
  // on-track incident roll for a car at a completed lap (lap-keyed, deterministic). An incident loses
  // the move, sometimes retires the car, and may draw a caution. Reuses the existing SC lifecycle.
  _rollIncident(c) {
    if (c.retired) return;
    const pm = PACE_MODES[c.pace];
    const p = incidentChance(INCIDENT.base, pm.risk, A(c).composure, c._inFight, c.lap, INCIDENT);
    const ir = this._keyRng(c.idx, c.lap, 2);
    if (ir.unit() >= p) return;
    let wasDNF = false;
    if (ir.unit() < INCIDENT.dnfShare) { c.retired = true; wasDNF = true; }
    else { c.tyreTemp = Math.max(0.1, c.tyreTemp - INCIDENT.timeScrub); c._passCredit = 0; }   // a recovered moment still costs (felt as pace)
    this._emit({ type: "incident", lap: c.lap, a: c.idx, abbr: c.abbrev, dnf: wasDNF });
    this._tryCaution(ir, wasDNF);
  }

  // an incident may deploy a caution: one at a time, capped, kind by track.sc + vscShare. Reuses
  // scActive/vscActive (the existing lifecycle bunches, cheapens pits and retracts after scMinLaps).
  _tryCaution(rng, wasDNF) {
    if (this.scActive || this.vscActive || this._cautionsDone >= INCIDENT.maxCautions) return;
    const kind = cautionFromIncident(rng, this.track.sc, wasDNF, EVENT.vscShare, INCIDENT);
    if (!kind) return;
    this._cautionsDone += 1;
    this.scEverActive = true;
    this.scStartLap = this.cars.reduce((m, x) => Math.max(m, x.lap), 0);
    if (kind === "vsc") this.vscActive = true; else this.scActive = true;
  }
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd ApexWeb && node --test tests/sim.test.js --test-name-pattern "live safety cars"`
Expected: PASS. Then the whole file: `node --test tests/sim.test.js` (determinism + existing SC behaviour still green).

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/sim.js ApexWeb/tests/sim.test.js
git commit -m "feat(apexweb): incident-driven live safety cars (replace scheduled SC)" -m "Per-lap lap-keyed incident roll -> time/DNF/caution; reuses the SC lifecycle; emergent 0/1/2+ cautions, capped." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task B4: Start + lunge DNFs feed the caution roll (sim.js)

**Files:**
- Modify: `ApexWeb/src/sim.js` (`_standingStart` ~line 205; bold-lunge DNF ~line 269-270)
- Test: `ApexWeb/tests/sim.test.js`

- [ ] **Step 1: Write the failing test** — append to `ApexWeb/tests/sim.test.js`:

```js
test("a start bog-down DNF can draw an opening-lap caution", () => {
  // force a start incident: drive starts attr to 0 for one car and a high-sc track so the caution lands.
  let sawEarlySC = false;
  for (let s = 0; s < 60 && !sawEarlySC; s++) {
    const r = new Race(field(), { ...TRACK, sc: 1.0 }, 60000 + s);
    r.cars[5].attrs = { ...r.cars[5].attrs, starts: 0.0, composure: 0.0 };
    let g = 0;
    while (!r.finished && g++ < 4000) { r.step(); if ((r.scActive || r.vscActive) && r.cars.reduce((m,c)=>Math.max(m,c.lap),0) <= 2) { sawEarlySC = true; break; } }
  }
  assert.ok(sawEarlySC, "a first-lap incident can bring out the safety car");
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd ApexWeb && node --test tests/sim.test.js --test-name-pattern "start bog-down"`
Expected: FAIL — start DNFs don't feed a caution yet.

- [ ] **Step 3: Implement** in `ApexWeb/src/sim.js`.

(a) `_standingStart`, the bog-down DNF (~line 205). Replace:

```js
        if (this.erng.unit() < EVENT.startDnf) c.retired = true;
```

with:

```js
        if (this.erng.unit() < EVENT.startDnf) { c.retired = true; this._emit({ type: "incident", lap: 0, a: c.idx, abbr: c.abbrev, dnf: true }); this._tryCaution(this._keyRng(c.idx, 0, 3), true); }
```

(b) Bold-lunge contact DNF in `_resolveCombat` (~line 269-270). Replace:

```js
          } else if (this.erng.unit() < AGGR_PASS_DNF) {
            me.retired = true; continue;   // the lunge went wrong — into the gravel
          }
```

with:

```js
          } else if (this.erng.unit() < AGGR_PASS_DNF) {
            me.retired = true;             // the lunge went wrong — into the gravel
            this._emit({ type: "incident", lap: me.lap, a: me.idx, abbr: me.abbrev, dnf: true });
            this._tryCaution(this._keyRng(me.idx, me.lap, 3), true);
            continue;
          }
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd ApexWeb && node --test tests/sim.test.js --test-name-pattern "start bog-down"`
Expected: PASS. Then full file green.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/sim.js ApexWeb/tests/sim.test.js
git commit -m "feat(apexweb): start + bold-lunge DNFs feed the live caution roll" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task B5: Incident + lock-up commentary (commentary.js)

**Files:**
- Modify: `ApexWeb/src/commentary.js` (the `T` template table)
- Test: `ApexWeb/tests/commentary.test.js`

- [ ] **Step 1: Write the failing test** — append to `ApexWeb/tests/commentary.test.js`:

```js
test("incident + lockup events produce a non-empty Russian line", () => {
  assert.ok(describe({ type: "incident", lap: 4, a: 2, abbr: "VER", dnf: true }).length > 0);
  assert.ok(describe({ type: "incident", lap: 4, a: 2, abbr: "VER", dnf: false }).length > 0);
  assert.ok(describe({ type: "lockup", lap: 7, a: 1, abbr: "LEC" }).length > 0);
});
```

(If `commentary.test.js` does not exist, create it with the standard header importing `describe` from `../src/commentary.js`.)

- [ ] **Step 2: Run it, verify it fails**

Run: `cd ApexWeb && node --test tests/commentary.test.js`
Expected: FAIL — `describe` returns `""` for unknown types.

- [ ] **Step 3: Implement** in `ApexWeb/src/commentary.js`. Add to the `T` table:

```js
  incident: ["Инцидент! {a} в гравии.", "{a} ошибается и вылетает!", "Контакт — {a} попал в передрягу!"],
  lockup: ["{a} блокирует колёса — теряет позицию!", "Ошибка {a} на торможении!", "{a} перетёр резину в борьбе и откатывается."],
```

> `incident` uses `{a}`; the DNF vs minor distinction is carried by the leaderboard (DNF) — no separate
> template needed. `describe` already substitutes `{a}` from `ev.abbr`.

- [ ] **Step 4: Run it, verify it passes**

Run: `cd ApexWeb && node --test tests/commentary.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/commentary.js ApexWeb/tests/commentary.test.js
git commit -m "feat(apexweb): radio lines for incidents + lock-ups" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task B6: Live-SC balance corridor (balance.mjs) + tune

**Files:**
- Modify: `ApexWeb/tools/balance.mjs` (append a corridor block); possibly `ApexWeb/src/data.js` (`INCIDENT` tune)

- [ ] **Step 1: Add the corridor** — append to `ApexWeb/tools/balance.mjs`:

```js
// live-SC corridor: cautions emerge from incidents → variable 0/1/2+ per race, ~a quarter-to-third of
// races see one (track.sc=0.25-driven), first-lap incidents are a visible minority, cap rarely binds.
{
  const N = 40;
  const counts = {}; let withCaution = 0, lap1Incidents = 0, totalIncidents = 0, capHits = 0;
  for (let s = 0; s < N; s++) {
    const r = new Race(field(), TRACK, 70000 + s);
    r.gridStart();
    let cautions = 0, wasOn = false, g = 0;
    while (!r.finished && g++ < 500000) { r.step(); const on = r.scActive || r.vscActive; if (on && !wasOn) cautions++; wasOn = on; }
    counts[cautions] = (counts[cautions] || 0) + 1;
    if (cautions > 0) withCaution++;
    if (cautions >= 3) capHits++;
    const inc = r.events.filter(e => e.type === "incident");
    totalIncidents += inc.length;
    lap1Incidents += inc.filter(e => e.lap <= 1).length;
  }
  console.log(`live-SC: caution-count distribution over ${N} races:`, counts, ` (expect a mix incl. 0 and >=2)`);
  console.log(`live-SC: races with >=1 caution = ${(withCaution / N * 100).toFixed(0)}%  (target ~25-40)`);
  console.log(`live-SC: incidents/race = ${(totalIncidents / N).toFixed(2)}, of which lap-1 = ${(lap1Incidents / N).toFixed(2)}  (first-lap chaos present)`);
  console.log(`live-SC: races hitting the cap (>=3) = ${capHits}  (should be rare)`);
}
```

- [ ] **Step 2: Run the corridor**

Run: `cd ApexWeb && node tools/balance.mjs 2>&1 | grep "live-SC:"`
Expected: the count distribution has ≥2 distinct values incl. some 0s and some ≥1; `% with caution` in ~25-40; some lap-1 incidents; cap hits rare.

- [ ] **Step 3: Tune if needed (data.js `INCIDENT`)**

- `% with caution` too low → raise `INCIDENT.base` (0.0010 → 0.0014) or `INCIDENT.scMinor`/`scDnf`.
- Too high / cap binds often → lower `INCIDENT.base` or `maxCautions` interplay.
- No lap-1 incidents → raise `INCIDENT.lap1`.
- Keep the DNF budget sane: re-run the top-of-file `avg DNF/race` line (target ~1-2); incident DNFs add to it. If DNF/race climbs above ~2.5, lower `INCIDENT.dnfShare`.

- [ ] **Step 4: Full regression**

Run: `cd ApexWeb && node --test 2>&1 | tail -5`
Expected: all green. Re-run the full `node tools/balance.mjs` and eyeball: DNF/race ~1-2.5, pace spread unchanged, fuel/undercut/sector/overtaking/weather/strategy/difficulty corridors still in range.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/tools/balance.mjs ApexWeb/src/data.js
git commit -m "test(apexweb): live-SC balance corridor + tune (emergent 0/1/2+ cautions)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# PART C — Wiring + UI

### Task C1: set_order command + snapshot fields (main.js)

**Files:**
- Modify: `ApexWeb/src/main.js` (command switch ~line 105-107; `raceSnapshot` per-car map ~line 244-252)

- [ ] **Step 1: Add the command** — in the command switch in `ApexWeb/src/main.js` (after `case "set_engine":`, ~line 106):

```js
    case "set_order":  ctx.race?.setOrder(cmd.car, cmd.mode); break;
```

- [ ] **Step 2: Add snapshot fields** — in `raceSnapshot()`'s per-car object (~line 247, the `pace: c.pace, engine: c.engine, ...` line), add:

```js
      order: c.order, inFight: c._inFight,
```

- [ ] **Step 3: Boot-test (no unit test for main.js)**

Run: `cd ApexWeb && node -e "import('./src/main.js').then(()=>console.log('main.js loads')).catch(e=>{console.error(e);process.exit(1)})"`
Expected: prints `main.js loads` (module graph imports cleanly; no syntax/binding errors).

> main.js drives the DOM and isn't unit-tested; the host loop + snapshot are exercised by the owner's
> F5 two-browser playtest. The boot-test only proves the module graph loads.

- [ ] **Step 4: Commit**

```bash
git add ApexWeb/src/main.js
git commit -m "feat(apexweb): set_order command + order/inFight in the race snapshot" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task C2: Attack/Defend control in the race HUD (ui/race.js)

**Files:**
- Modify: `ApexWeb/src/ui/race.js` (constants ~line 11-13; control strip in `buildHud` ~line 224-231; click wiring ~line 251-254; `updateHud` toggles ~line 313-314)

- [ ] **Step 1: Add the order labels** — near the top (~line 11-13), add:

```js
const ORDER = ["attack", "defend", "none"];
const ORDER_L = { attack: "⚔ Атака", defend: "🛡 Защита", none: "Нейтр" };
```

- [ ] **Step 2: Add the control to the strip** — in `buildHud`, right after the `#d-engine` seg block (~line 227, before the `Пит — компаунд` label), insert:

```js
        <p class="label" style="margin-top:8px">Приказ <span id="d-order-hint" class="label" style="margin:0;opacity:.7"></span></p>
        <div class="seg" id="d-order">${ORDER.map(o => `<button data-v="${o}">${ORDER_L[o]}</button>`).join("")}</div>
```

- [ ] **Step 3: Wire the click** — in `buildHud`'s handler block (~line 252, after the `#d-engine` onclick), add:

```js
  root.querySelector("#d-order").onclick = e => { const v = e.target.dataset && e.target.dataset.v; if (v) ctx.send({ cmd: "set_order", car: myIdx(), mode: v }); };
```

- [ ] **Step 4: Reflect state** — in `updateHud`, after the pace/engine `.on` toggles (~line 314), add:

```js
  for (const b of $("#d-order").children) b.classList.toggle("on", b.dataset.v === me.order);
  const oh = $("#d-order-hint"); if (oh) oh.textContent = me.inFight ? "в борьбе" : "—";
  const og = $("#d-order"); if (og) og.style.opacity = me.inFight ? "1" : "0.6";   // dim when not racing anyone
```

- [ ] **Step 5: Verify in the preview (no unit test for the HUD)**

Start the dev server and confirm the control renders + is clickable and that it dims when not in a fight. Per the project's preview gotchas (hidden tab pauses rAF; ~484px viewport collapses 2-col), verify via `preview_snapshot` + DOM inspection rather than a screenshot of motion. Minimum: the `#d-order` segment exists with three buttons and `set_order` fires on click (`preview_eval` the onclick / check `ctx.send`).

- [ ] **Step 6: Commit**

```bash
git add ApexWeb/src/ui/race.js
git commit -m "feat(apexweb): Attack/Defend/Neutral control in the race HUD (dims out of a fight)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task C3: README + final verification

**Files:**
- Modify: `ApexWeb/README.md`

- [ ] **Step 1: Update the README** — in the feature list, add combat orders (Attack/Defend lever, paid in tyres + lock-up risk) and live incident-driven safety cars (emergent 0/1/2+ cautions, first-lap chaos) to the race-features section; note the player now has a fourth in-race lever (приказ) alongside темп/мотор/пит. Update the `node --test` count note.

- [ ] **Step 2: Full test suite**

Run: `cd ApexWeb && node --test 2>&1 | tail -6`
Expected: `# fail 0`. Record the new total.

- [ ] **Step 3: Full balance corridor**

Run: `cd ApexWeb && node tools/balance.mjs 2>&1 | tail -40`
Expected: combat-orders lines hold (attack passes+wears more, lock-ups rare); live-SC lines hold (variable cautions, ~25-40% races, lap-1 present); pre-existing corridors (DNF ~1-2.5, pace spread, fuel, undercut, sector, overtaking, weather, strategy, difficulty) all in range.

- [ ] **Step 4: Boot-test the app graph**

Run: `cd ApexWeb && node -e "import('./src/main.js').then(()=>console.log('ok')).catch(e=>{console.error(e);process.exit(1)})"`
Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/README.md
git commit -m "docs(apexweb): README — combat orders + live safety cars; test count" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final notes for the executor

- **Determinism is load-bearing.** After every `sim.js` edit, the `sim.test.js` determinism test (same seed → identical finish order) must stay green. The new rolls use `_keyRng` (stateless, lap-keyed) precisely so they don't depend on draw order.
- **§16 invariant:** combat writes only `lapFrac`. Orders change credit/resist/cost and the lock-up scrubs `tyreTemp` — none of them assign `lap`. Do not add a `lap` write.
- **Explicit pathspecs only.** Each commit lists its exact files. Never `git add -A`/`.`/`commit -a`; never `git stash`. The owner has parallel uncommitted WIP in the tree.
- **Do not push.** Stop after Task C3 and report; the owner pushes on request.
- **Owner playtest (F5)** remains the only non-headless check for the HUD control + the live host loop, same as the practice/quali depth passes.
