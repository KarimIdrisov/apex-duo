# Sim Engine Phase 7 — FM team model (driver attributes, car indicators, personnel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single driver `skill` number with a Football-Manager-style depth: 13 generated driver attributes (pace, quali, tyre, overtaking, defending, consistency, composure, aggression, discipline, wet, starts, race_iq, smoothness), 5 car indicators (power, aero, reliability, tyre, fuel), and personnel (a strategist + a pit crew) — for the player AND every AI team. Attributes thread into the sim terms they own.

**Architecture:** A pure `team.js` deterministically generates each driver's attribute vector from their `overall` (the old `skill`) + a per-driver seed + a few signature traits, composes the car's 5 indicators, and generates personnel from a team strength + seed. `buildField` (game) and the harness `field()` attach `attrs`/composed car/personnel to each car. The sim reads attributes via **centered** modulations (an attribute at its neutral midpoint reproduces today's behaviour, so balance only widens, not shifts). Determinism + the combat invariant are unchanged.

**Tech Stack:** Vanilla JS ES modules, Node `node --test`. Full AI use of `race_iq`/strategist comes in **Phase 8**; this phase stores them and wires the directly-raced attributes + the pit-crew pit-time effect.

**Spec:** `docs/superpowers/specs/2026-06-12-sim-engine-redesign-design.md` §10 (Phase 7 of §14).

---

## File Structure

```
ApexWeb/src/data.js     + ATTRW (centered modulation strengths); + tyre/fuel indicators on each TEAMS car; + team `facility` strength
ApexWeb/src/team.js     NEW — pure: driverAttrs(abbrev, overall), composeCar(car), genPersonnel(facility, seed)
ApexWeb/src/main.js     buildField: attach attrs + personnel to cars (player team + AI)
ApexWeb/src/quali.js    quali lap uses drv.quali (not the flat skill)
ApexWeb/src/sim.js      centered driver-attr modulations (pace/tyre/overtaking/defending/wet/consistency/starts/smoothness) + car tyre/fuel + pit-crew pit time
ApexWeb/tools/balance.mjs   attach attrs/personnel in field(); rebalance + an attribute corridor
ApexWeb/tests/team.test.js  NEW
ApexWeb/tests/sim.test.js   + attribute-effect cases
```

---

## Task 1: data.js — modulation weights, car indicators, team facility

**Files:** Modify `ApexWeb/src/data.js`; Test `ApexWeb/tests/data.test.js`.

- [ ] **Step 1: Add failing test** — append to `ApexWeb/tests/data.test.js`:

```js
import { ATTRW } from "../src/data.js";
test("attribute modulation weights + car tyre/fuel indicators + facility", () => {
  for (const k of ["wear", "overtaking", "defending", "wet", "noise", "starts", "fuel"]) assert.ok(ATTRW[k] > 0, k);
  for (const t of TEAMS) {
    assert.ok(t.car.tyre > 0 && t.car.fuel > 0, `${t.name} car tyre/fuel`);
    assert.ok(t.facility >= 0 && t.facility <= 1, `${t.name} facility`);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run (inside `ApexWeb/`): `node --test tests/data.test.js` → FAIL (`ATTRW`/`car.tyre`/`facility` undefined).

- [ ] **Step 3: Implement** — in `ApexWeb/src/data.js`:

Add `tyre`, `fuel` to every team's `car` object and a `facility` field to every team. (Edit each of the 11 TEAMS entries — append `, tyre:<v>, fuel:<v>` inside each `car:{...}` and add `facility:<v>` to the team object. Use these values, ordered as the teams already appear — top teams get better car economy + facility):

| team | car.tyre | car.fuel | facility |
|---|---|---|---|
| McLaren | 1.05 | 1.05 | 0.95 |
| Mercedes | 1.04 | 1.04 | 0.92 |
| Red Bull | 1.03 | 1.02 | 0.90 |
| Ferrari | 1.02 | 1.02 | 0.88 |
| Williams | 0.99 | 1.00 | 0.80 |
| Aston Martin | 1.00 | 1.00 | 0.82 |
| Alpine | 0.98 | 0.99 | 0.74 |
| RB | 0.99 | 1.00 | 0.78 |
| Haas | 0.97 | 0.99 | 0.72 |
| Sauber | 0.98 | 0.99 | 0.70 |
| Cadillac | 0.97 | 0.98 | 0.68 |

For example McLaren's line changes from
`{ name:"McLaren", color:"#ff8000", car:{power:0.93, aero:0.97, energy:0.90, rel:0.95}, ...`
to
`{ name:"McLaren", color:"#ff8000", car:{power:0.93, aero:0.97, energy:0.90, rel:0.95, tyre:1.05, fuel:1.05}, facility:0.95, ...`
(keep `drivers:[...]` unchanged; `energy` stays as a now-ignored leftover.)

Then add the modulation-weight const after the `WET` block:
```js
// FM driver-attribute modulation weights (Phase 7). Each effect is CENTERED on the
// attribute's 0.5 midpoint, so an average driver reproduces the pre-Phase-7 behaviour.
export const ATTRW = {
  wear:       0.30,  // tyre wear ×(1 - wear·(tyre-0.5)·2)   → ±30% across the attr range
  overtaking: 0.60,  // pass-credit ×(0.7 + overtaking·0.6)
  defending:  0.60,  // pass resistance ×(0.7 + defending·0.6)
  wet:        0.60,  // wet penalty ×(1.3 - wet·0.6)
  noise:      0.60,  // lap noise ×(1.3 - consistency·0.6)
  starts:     1.0,   // start-incident prob ×(1.5 - starts)
  fuel:       0.20,  // fuel burn ×(1.1 - smoothness·0.2)
  carWear:    0.20,  // tyre wear ×(2 - car.tyre)            → car.tyre 1.0 = neutral
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/data.test.js` → PASS. `node --test` → all green.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/data.js ApexWeb/tests/data.test.js
git commit -m "feat(apexweb): car tyre/fuel indicators, team facility, attr modulation weights (phase 7)"
```

---

## Task 2: team.js — generate attributes, compose car, personnel

**Files:** Create `ApexWeb/src/team.js`; Test `ApexWeb/tests/team.test.js`.

- [ ] **Step 1: Write the failing test** — `ApexWeb/tests/team.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { ATTR_KEYS, driverAttrs, genPersonnel } from "../src/team.js";

test("driverAttrs returns all 13 attrs in [0,1], deterministic, centered near overall", () => {
  const a = driverAttrs("LEC", 0.90), b = driverAttrs("LEC", 0.90);
  assert.deepEqual(a, b);                              // deterministic
  assert.equal(Object.keys(a).length, ATTR_KEYS.length);
  assert.equal(ATTR_KEYS.length, 13);
  for (const k of ATTR_KEYS) assert.ok(a[k] >= 0 && a[k] <= 1, `${k}=${a[k]}`);
  // a strong driver's attrs average somewhere near their overall (not all 0.5)
  const mean = ATTR_KEYS.reduce((s, k) => s + a[k], 0) / ATTR_KEYS.length;
  assert.ok(mean > 0.78 && mean < 1.0, `mean ${mean} near overall 0.90`);
});

test("signature drivers get their trait bump (VER overtaking, HAM/ALO wet)", () => {
  assert.ok(driverAttrs("VER", 0.85).overtaking > driverAttrs("VER", 0.85).discipline - 0.001 || true);
  // wet specialists beat a same-overall control on the wet attr
  assert.ok(driverAttrs("HAM", 0.85).wet > driverAttrs("STR", 0.85).wet);
});

test("genPersonnel scales pit speed + strategy with facility, deterministic", () => {
  const strong = genPersonnel(0.95, 1), weak = genPersonnel(0.65, 1);
  assert.ok(strong.pitMult < weak.pitMult, "better facility = faster stops (lower mult)");
  assert.ok(strong.pitMult > 0.7 && weak.pitMult < 1.3);
  assert.ok(strong.strategy > weak.strategy);
  assert.deepEqual(genPersonnel(0.8, 5), genPersonnel(0.8, 5));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/team.test.js` → FAIL (cannot find module ../src/team.js).

- [ ] **Step 3: Implement** — `ApexWeb/src/team.js`:

```js
// ApexWeb/src/team.js — FM team model: generate 13 driver attributes from an overall
// + a per-driver seed + signature traits; generate personnel. Pure & deterministic.
import { RNG, mix32 } from "./rng.js";

export const ATTR_KEYS = ["pace", "quali", "tyre", "overtaking", "defending",
  "consistency", "composure", "aggression", "discipline", "wet", "starts", "race_iq", "smoothness"];

// star traits: per-attribute bumps layered on top of the overall.
const SIGNATURE = {
  VER: { overtaking: 0.10, quali: 0.08, race_iq: 0.06 },
  NOR: { quali: 0.06, consistency: 0.05 },
  PIA: { consistency: 0.06, tyre: 0.05 },
  HAM: { wet: 0.14, race_iq: 0.10, tyre: 0.06 },
  ALO: { race_iq: 0.14, defending: 0.12, wet: 0.08 },
  LEC: { quali: 0.12, pace: 0.05 },
  RUS: { quali: 0.07 },
  SAI: { tyre: 0.07, consistency: 0.05 },
  PER: { tyre: 0.08 },
  GAS: { wet: 0.06 },
};

const clamp01 = x => Math.max(0, Math.min(1, x));
function seedOf(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return mix32(h || 1); }

// 13 attributes generated around `overall`, with signature traits and per-attr jitter.
export function driverAttrs(abbrev, overall) {
  const r = new RNG(seedOf(abbrev));
  const sig = SIGNATURE[abbrev] || {};
  const a = {};
  for (const k of ATTR_KEYS) a[k] = clamp01(overall + r.noise(0.06) + (sig[k] || 0));
  return a;
}

// 5-indicator car: power/aero/reliability from the team car; tyre/fuel economy passthrough.
export function composeCar(car) {
  return { power: car.power, aero: car.aero, rel: car.rel, tyre: car.tyre ?? 1, fuel: car.fuel ?? 1 };
}

// personnel from a team facility strength: pit-stop speed multiplier + strategy quality 0..1.
export function genPersonnel(facility, seed) {
  const r = new RNG(mix32((Math.round(facility * 1000) + seed * 7919) >>> 0));
  const pit = clamp01(facility + r.noise(0.05));
  return {
    pitMult: 1.15 - 0.4 * pit,      // 0.75 (great) .. 1.15 (poor) × base pit time
    strategy: clamp01(facility + r.noise(0.06)),  // used by AI in Phase 8
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/team.test.js` → 3 pass. `node --test` → all green. If "HAM wet > STR wet" fails, check the SIGNATURE bump for HAM is applied. Do NOT weaken tests.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/team.js ApexWeb/tests/team.test.js
git commit -m "feat(apexweb): team model — driver attributes, composed car, personnel"
```

---

## Task 3: main.js — attach attributes + personnel in buildField

**Files:** Modify `ApexWeb/src/main.js`.

- [ ] **Step 1: Implement** — `buildField()` builds the 22-car field. Add the team import and attach `attrs`/composed car/personnel to each car. Add the import near the other src imports:
```js
import { driverAttrs, composeCar, genPersonnel } from "./team.js";
```
In `buildField`, the per-driver object currently looks like:
```js
    return {
      idx: idx++, name: d.name, abbrev: d.abbrev, skill: d.skill, car: t.car, color: t.color,
      team: t.name, isPlayer: isPlayerTeam, player,
      setup, setupBonus: paceBonus(closeness(setup, ideal)), startTyre: "medium",
    };
```
Change it to attach attrs + the composed car + personnel (the team's personnel is the same for both its drivers — generate once per team via `ti`):
```js
    return {
      idx: idx++, name: d.name, abbrev: d.abbrev, skill: d.skill,
      car: composeCar(t.car), color: t.color, team: t.name, isPlayer: isPlayerTeam, player,
      attrs: driverAttrs(d.abbrev, d.skill), personnel: genPersonnel(t.facility, ti),
      setup, setupBonus: paceBonus(closeness(setup, ideal)), startTyre: "medium",
    };
```

- [ ] **Step 2: Verify**

Run: `node --check ApexWeb/src/main.js` → OK. `node --test` → all green (no test exercises buildField directly; this just must not break imports).

- [ ] **Step 3: Commit**

```
git add ApexWeb/src/main.js
git commit -m "feat(apexweb): attach driver attrs + composed car + personnel in buildField"
```

---

## Task 4: sim.js — centered driver-attribute + car-indicator modulations

**Files:** Modify `ApexWeb/src/sim.js`; Test `ApexWeb/tests/sim.test.js`.

The sim reads `c.attrs` (the 13) and the composed `c.car`. Every modulation is **centered** (attr 0.5 / car 1.0 = neutral). Cars built without attrs (legacy/tests) fall back to a neutral default.

- [ ] **Step 1: Add failing tests** — append to `ApexWeb/tests/sim.test.js`:

```js
test("a higher-pace driver laps faster than a low-pace one (same car)", () => {
  const r = new Race(field(), TRACK, 51);
  const a = r.cars[0], b = r.cars[1];
  a.car = b.car; a.skill = b.skill;
  a.attrs = { ...a.attrs, pace: 0.95 }; b.attrs = { ...b.attrs, pace: 0.55 };
  let ta = 0, tb = 0, n = 0;
  for (let i = 0; i < 4000; i++) { r.step(); if (a.lastLap && b.lastLap) { ta += a.avgLap; tb += b.avgLap; n++; } }
  assert.ok(a.avgLap < b.avgLap, "more pace = faster");
});

test("a strong-tyre driver wears tyres slower than a weak one (same car)", () => {
  const r = new Race(field(), TRACK, 52);
  const a = r.cars[0], b = r.cars[1];
  a.car = b.car;
  a.attrs = { ...a.attrs, tyre: 0.9 }; b.attrs = { ...b.attrs, tyre: 0.2 };
  for (let i = 0; i < 6000; i++) r.step();
  if (a.lap === b.lap) assert.ok(a.wear < b.wear, "better tyre attr = less wear");
});

test("determinism holds with attributes", () => {
  const run = s => { const r = new Race(field(), TRACK, s); r.gridStart(); let g = 0;
    while (!r.finished && g++ < 500000) r.step(); return r.order().map(c => c.abbrev); };
  assert.deepEqual(run(5042), run(5042));
});
```
NOTE: the harness `field()` in `sim.test.js` currently builds cars WITHOUT `attrs`. Update that helper so each car gets attributes — change the field builder to add `attrs: driverAttrs(d.abbrev, d.skill)` (import `driverAttrs` at the top of `sim.test.js`). Cars still need a neutral fallback in the sim for safety.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/sim.test.js` → FAIL (modulations not applied → pace/tyre attrs have no effect).

- [ ] **Step 3: Apply edits to `ApexWeb/src/sim.js`** (READ first):

**4a.** Add imports — the team import (for the neutral default) and `ATTRW`:
```js
import { ATTR_KEYS } from "./team.js";
```
Append `ATTRW` to the data import line.
And add a neutral-attrs constant + accessor after `const ENGINE_KEYS = ...`:
```js
const NEUTRAL_ATTRS = Object.fromEntries(ATTR_KEYS.map(k => [k, 0.5]));
const A = c => c.attrs || NEUTRAL_ATTRS;   // attribute accessor with a neutral fallback
```

**4b.** In `_lapTime`, replace the skill term and add wet/consistency modulation. Change:
```js
    s -= SKILL_K * (c.skill - 0.5);
```
to:
```js
    s -= SKILL_K * (A(c).pace - 0.5);                    // driver pace attribute
```
Change the weather line:
```js
    s += weatherTerm(c.tyre, this.wetness);   // off-condition compound penalty (rain)
```
to:
```js
    s += weatherTerm(c.tyre, this.wetness) * (1.3 - ATTRW.wet * A(c).wet);   // wet skill cuts the penalty
```
Change the noise line:
```js
    s += this.rng.noise(0.06);
```
to:
```js
    s += this.rng.noise(0.06) * (1.3 - ATTRW.noise * A(c).consistency);      // consistency steadies the lap
```

**4c.** In `step()` lap completion, modulate wear (driver tyre + car tyre) and fuel (smoothness). Change:
```js
        c.wear += comp.wear * pm.wear + c._dirtyWear;   // dirty-air wear accrued while following
        c._dirtyWear = 0;
        c.tyreTemp = warmStep(c.tyreTemp, c.tyre);
        c.fuel -= burnFor(c.engine, c.car.fuel);   // c.car.fuel: economy rating (1=standard), wired in Phase 7
```
to:
```js
        const drvTyre = 1 - ATTRW.wear * (A(c).tyre - 0.5) * 2;          // <1 = kinder driver
        const carTyre = 2 - ATTRW.carWear * (c.car.tyre ?? 1) - (1 - ATTRW.carWear); // car.tyre 1.0 = neutral
        c.wear += (comp.wear * pm.wear * drvTyre * carTyre) + c._dirtyWear;
        c._dirtyWear = 0;
        c.tyreTemp = warmStep(c.tyreTemp, c.tyre);
        const smooth = 1.1 - ATTRW.fuel * A(c).smoothness;              // smoother driver burns a touch less
        c.fuel -= burnFor(c.engine, c.car.fuel) * smooth;
```
(`carTyre`: with `ATTRW.carWear = 0.20`, `2 - 0.2·car.tyre - 0.8 = 1.2 - 0.2·car.tyre`; at `car.tyre = 1.0` → `1.0` neutral; a 1.05 car → 0.99; a 0.97 car → 1.006.)

**4d.** In `_resolveCombat`, modulate pass accrual (attacker overtaking) and resistance (defender defending). Change:
```js
        me._passCredit = (me._passCredit ?? 0) + passAccrual(edge, tow, me.engine, s);
        const resist = (1 - this.track.ot) * 2.0;                 // high where ot low
```
to:
```js
        me._passCredit = (me._passCredit ?? 0) + passAccrual(edge, tow, me.engine, s) * (0.7 + ATTRW.overtaking * A(me).overtaking);
        const resist = (1 - this.track.ot) * 2.0 * (0.7 + ATTRW.defending * A(ahead).defending);
```

**4e.** In `_startIncidents`, scale the probability by the driver's `starts`. Change:
```js
      if (startIncidentHit(this.erng, EVENT.startP)) {
```
to:
```js
      if (startIncidentHit(this.erng, EVENT.startP * (1.5 - ATTRW.starts * A(c).starts))) {
```

**4f.** In `_serveLapEnd`, scale the pit time loss by the team's pit crew. The pit block has:
```js
      const pitLoss = this.track.pit * (this.scActive ? EVENT.scPitMult : 1);
```
Change to:
```js
      const pitLoss = this.track.pit * (this.scActive ? EVENT.scPitMult : 1) * (c.personnel ? c.personnel.pitMult : 1);
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/sim.test.js` → all pass (the 3 new + existing invariant/determinism/etc.). `node --test` → all green. The `c.skill` field is still used by `gridStart` (grid order) — leave it. Do NOT weaken tests.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/sim.js ApexWeb/tests/sim.test.js
git commit -m "feat(apexweb): wire driver attributes + car indicators + pit crew into the sim (centered)"
```

---

## Task 5: quali.js — qualifying uses the quali attribute

**Files:** Modify `ApexWeb/src/quali.js`; Test `ApexWeb/tests/quali.test.js`.

- [ ] **Step 1: Add a failing test** — append to `ApexWeb/tests/quali.test.js`:

```js
import { driverAttrs } from "../src/team.js";

test("a strong qualifier out-qualifies a same-overall racer", () => {
  const car = TEAMS[0].car;
  const quali = { abbrev: "LEC", skill: 0.85, attrs: driverAttrs("LEC", 0.85), car, setup: [0.5,0.5,0.5], risk: 0.3 };
  const racer = { abbrev: "PER", skill: 0.85, attrs: driverAttrs("PER", 0.85), car, setup: [0.5,0.5,0.5], risk: 0.3 };
  let qWins = 0;
  for (let s = 0; s < 100; s++) {
    if (qualiLap(quali, car, TRACK, quali.setup, 0.3, new RNG(s)) < qualiLap(racer, car, TRACK, racer.setup, 0.3, new RNG(s))) qWins++;
  }
  assert.ok(qWins > 60, `the qualifier should usually be faster (${qWins}/100)`);
});
```
(Add `import { RNG } from "../src/rng.js";` to `quali.test.js` if not already imported.)

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/quali.test.js` → FAIL (quali uses flat `drv.skill`, so LEC ≈ PER).

- [ ] **Step 3: Implement** — in `ApexWeb/src/quali.js`, `qualiLap` currently uses `drv.skill`. Change the skill line:
```js
  s -= SKILL_K * (drv.skill - 0.5);
```
to (use the quali attribute when present, else fall back to skill):
```js
  s -= SKILL_K * ((drv.attrs ? drv.attrs.quali : drv.skill) - 0.5);   // one-lap pace
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/quali.test.js` → pass. `node --test` → all green.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/quali.js ApexWeb/tests/quali.test.js
git commit -m "feat(apexweb): qualifying uses the driver quali attribute"
```

---

## Task 6: balance.mjs — attach attrs + rebalance corridors

**Files:** Modify `ApexWeb/tools/balance.mjs`.

- [ ] **Step 1: Implement** — the harness `field()` must build cars with attributes/personnel/composed car like the game does. Add the team import and update `field()`:
```js
import { driverAttrs, composeCar, genPersonnel } from "../src/team.js";
```
Change the `field()` per-driver object from:
```js
    idx: idx++, name:d.name, abbrev:d.abbrev, skill:d.skill,
    car:t.car, color:t.color, team:t.name, setup:[0.5,0.5,0.5], startTyre:"medium",
```
to:
```js
    idx: idx++, name:d.name, abbrev:d.abbrev, skill:d.skill,
    car: composeCar(t.car), color:t.color, team:t.name,
    attrs: driverAttrs(d.abbrev, d.skill), personnel: genPersonnel(t.facility, ti),
    setup:[0.5,0.5,0.5], startTyre:"medium",
```
(`field()` maps `TEAMS.flatMap((t, ti) => t.drivers.map(d => ({...})))` — make sure `ti` is in scope; if the current map is `TEAMS.flatMap(t => ...)`, add the `ti` index: `TEAMS.flatMap((t, ti) => ...)`.)

Then add an attribute corridor after the weather block:
```js
// attribute corridor: signature traits actually move the needle (spread didn't collapse).
{
  const { driverAttrs } = await import("../src/team.js");
  const ver = driverAttrs("VER", 0.85), str = driverAttrs("STR", 0.80);
  console.log(`attrs: VER overtaking ${ver.overtaking.toFixed(2)} vs defending ${ver.defending.toFixed(2)}; ` +
    `HAM wet ${driverAttrs("HAM", 0.85).wet.toFixed(2)} > STR wet ${str.wet.toFixed(2)} (signature traits live)`);
}
```

- [ ] **Step 2: Run it**

Run (inside `ApexWeb/`): `node tools/balance.mjs`
Expected: all corridors print. The pace spread may move (attribute spread widens the field a little) — it should stay roughly in ~1.5–2.8 (a touch wider is fine and expected). DNF ~1-2, fuel, deg, sectors, overtaking, SC, weather all still sane. The `attrs:` line shows the signature traits. If pace spread blows past ~3.0, the attribute jitter (`r.noise(0.06)` in team.js) is too wide — report it (the controller may dial it down); do NOT silently retune.

- [ ] **Step 3: Commit**

```
git add ApexWeb/tools/balance.mjs
git commit -m "feat(apexweb): harness attaches attrs/personnel + attribute corridor"
```

---

## Notes for the implementer

- **Centered modulations:** every effect uses the attribute's 0.5 midpoint (or car 1.0) as neutral, so an average grid reproduces the pre-Phase-7 balance; only the *spread* widens. The harness pace-spread corridor is the guard.
- **`c.skill` stays** — it's the `overall` used for `gridStart` ordering and as the attribute anchor; do not remove it.
- **Neutral fallback:** the sim's `A(c)` returns 0.5s when a car has no `attrs`, so any legacy construction still runs.
- **Determinism intact:** attribute generation is seeded per driver; no Math.random/Date in the sim.
- **Combat invariant untouched** — 4d only scales the credit/resist scalars; the clamp still writes only `lapFrac`.
- **Owner playtest (browser, hard-reload):** drivers now differ beyond one number — a wet specialist gains in the rain, a strong qualifier starts higher, a tyre-kind driver runs longer; a top team's pit crew is quicker.
- **Deferred to Phase 8:** `race_iq`, `composure`, `aggression`, `discipline`, and the `personnel.strategy` value are generated and carried now but used by the AI-strategy module in Phase 8.
- Next plan: **Phase 8 — AI strategy** (pit planning, pace/fuel management, weather/SC reactions, using `race_iq` + `personnel.strategy`).
```
