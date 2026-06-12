# Sim Engine Phase 6 — Weather (slick↔inter↔wet crossover) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deterministic weather arc (dry → rain → wet → drying) drives a wetness 0..1; tyre choice must follow it — slicks aquaplane in the rain, inters/wets overheat when it's dry — forcing reactive pit calls. The player picks the pit compound; the AI boxes for the conditions.

**Architecture:** A pure `weather.js` (`scheduleWeather` timeline from the events RNG, `wetnessAt(timeline, lap)`, `weatherTerm(compound, wetness)`) decides the conditions and the compound mismatch penalty. `sim.js` schedules weather in the constructor, tracks a smooth `this.wetness` each tick, adds `weatherTerm` to lap time, and gives AI cars a weather-reactive pit. New `inter`/`wet` compounds (+ `wet_opt` on all) join `COMPOUNDS`. The snapshot carries `wetness`; the HUD shows a weather readout and a compound picker for pits. Determinism + the combat invariant are unchanged.

**Tech Stack:** Vanilla JS ES modules, Node `node --test`. Driver `wet` attribute is Phase 7; full AI strategy is Phase 8 (this phase gives AI just enough to not get stranded on the wrong tyre).

**Spec:** `docs/superpowers/specs/2026-06-12-sim-engine-redesign-design.md` §9 (Phase 6 of §14).

---

## File Structure

```
ApexWeb/src/data.js     + inter/wet COMPOUNDS + wet_opt on all; TRACK.wet (rain prob); WET consts
ApexWeb/src/weather.js  NEW — pure: scheduleWeather, wetnessAt, weatherTerm
ApexWeb/src/sim.js      schedule weather; per-tick wetness; weatherTerm in _lapTime; AI weather pit
ApexWeb/src/main.js     snapshot: + wetness
ApexWeb/src/ui/race.js  weather readout + a tyre-compound picker for the pit button
ApexWeb/tools/balance.mjs   weather corridor (rain ≈ track.wet; wets beat slicks in the rain)
ApexWeb/tests/weather.test.js NEW
ApexWeb/tests/sim.test.js   + weather case
```

---

## Task 1: data.js — wet compounds + weather constants

**Files:** Modify `ApexWeb/src/data.js`; Test `ApexWeb/tests/data.test.js`.

- [ ] **Step 1: Add failing test** — append to `ApexWeb/tests/data.test.js`:

```js
import { WET } from "../src/data.js";
test("wet compounds + wet_opt + weather constants", () => {
  for (const c of ["soft", "medium", "hard", "inter", "wet"]) {
    assert.ok(COMPOUNDS[c], c);
    assert.ok(COMPOUNDS[c].wet_opt >= 0 && COMPOUNDS[c].wet_opt <= 1, `${c}.wet_opt`);
  }
  assert.equal(COMPOUNDS.hard.wet_opt, 0);       // slicks are dry tyres
  assert.ok(COMPOUNDS.inter.wet_opt > 0.2 && COMPOUNDS.inter.wet_opt < 0.8);
  assert.ok(COMPOUNDS.wet.wet_opt > 0.7);
  assert.ok(TRACK.wet > 0 && TRACK.wet < 1);     // rain probability
  assert.ok(WET.mismatch > 0 && WET.slick > 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run (inside `ApexWeb/`): `node --test tests/data.test.js` → FAIL (`inter`/`wet_opt`/`TRACK.wet`/`WET` undefined).

- [ ] **Step 3: Implement** — in `ApexWeb/src/data.js`:

Replace the `COMPOUNDS` block:
```js
export const COMPOUNDS = {
  soft:   { pace:-0.55, wear:2.6, cliff:65, warm:1.4 },
  medium: { pace: 0.00, wear:1.7, cliff:78, warm:1.0 },
  hard:   { pace: 0.55, wear:1.1, cliff:90, warm:0.7 },
};
```
with (add `wet_opt` to all; add inter/wet — `pace` is the on-condition baseline, the wet/dry gap comes from `weatherTerm`):
```js
export const COMPOUNDS = {
  soft:   { pace:-0.55, wear:2.6, cliff:65, warm:1.4, wet_opt:0.0 },
  medium: { pace: 0.00, wear:1.7, cliff:78, warm:1.0, wet_opt:0.0 },
  hard:   { pace: 0.55, wear:1.1, cliff:90, warm:0.7, wet_opt:0.0 },
  inter:  { pace: 0.30, wear:1.9, cliff:70, warm:1.1, wet_opt:0.5 },
  wet:    { pace: 0.50, wear:1.6, cliff:75, warm:1.0, wet_opt:0.9 },
};
```

In the `TRACK` object, add a `wet` rain-probability field. Change:
```js
  df:0.82, pw:0.55, ot:0.30, abr:1.25, harv:0.58, dep:0.55, sc:0.25, el:0.82,
```
to:
```js
  df:0.82, pw:0.55, ot:0.30, abr:1.25, harv:0.58, dep:0.55, sc:0.25, wet:0.30, el:0.82,
```

Add the WET const after the `EVENT` block:
```js
// weather (Phase 6): wet pace penalty for using a compound off its optimal wetness.
export const WET = {
  mismatch: 3.0,  // s/lap per unit |wetness - compound.wet_opt|
  slick:    8.0,  // s/lap extra for a slick once standing water forms (× wetness over 0.4)
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/data.test.js` → PASS. `node --test` → all green.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/data.js ApexWeb/tests/data.test.js
git commit -m "feat(apexweb): inter/wet compounds + wet_opt + weather constants (phase 6)"
```

---

## Task 2: weather.js — pure timeline + crossover

**Files:** Create `ApexWeb/src/weather.js`; Test `ApexWeb/tests/weather.test.js`.

- [ ] **Step 1: Write the failing test** — `ApexWeb/tests/weather.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduleWeather, wetnessAt, weatherTerm } from "../src/weather.js";
import { RNG } from "../src/rng.js";

test("scheduleWeather rains at ~the given probability and is deterministic", () => {
  let rains = 0;
  for (let s = 0; s < 400; s++) if (scheduleWeather(new RNG(s + 1), 0.3, 66).rains) rains++;
  const f = rains / 400;
  assert.ok(f > 0.22 && f < 0.38, `rain frequency ${f} ~ 0.3`);
  const a = scheduleWeather(new RNG(5), 0.3, 66), b = scheduleWeather(new RNG(5), 0.3, 66);
  assert.deepEqual(a, b);
});

test("wetnessAt traces dry→wet→dry over the rain window", () => {
  const w = scheduleWeather(new RNG(2), 1.0, 66);   // force rain
  assert.ok(w.rains);
  assert.equal(wetnessAt(w, 0), 0);                  // dry at the start
  const peakish = wetnessAt(w, w.onset + w.rise);    // at the top of the rise
  assert.ok(peakish > 0.5, `peak ${peakish}`);
  assert.equal(wetnessAt(w, w.onset + w.rise + w.hold + w.dry + 1), 0); // dried out after
  assert.equal(wetnessAt({ rains: false }, 30), 0);  // never rains
});

test("weatherTerm: slicks fast in the dry, wets fast in the rain (crossover)", () => {
  // dry: a slick beats a wet tyre
  assert.ok(weatherTerm("hard", 0) < weatherTerm("wet", 0));
  // soaked: a wet tyre beats a slick (which aquaplanes)
  assert.ok(weatherTerm("wet", 0.85) < weatherTerm("hard", 0.85));
  // there is a crossover wetness where inter overtakes slick
  assert.ok(weatherTerm("hard", 0.2) < weatherTerm("inter", 0.2));   // still dry-ish: slick ok
  assert.ok(weatherTerm("inter", 0.6) < weatherTerm("hard", 0.6));   // wet enough: inter wins
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/weather.test.js` → FAIL (cannot find module ../src/weather.js).

- [ ] **Step 3: Implement** — `ApexWeb/src/weather.js`:

```js
// ApexWeb/src/weather.js — pure weather: a deterministic rain arc + the compound
// mismatch penalty that drives the slick↔inter↔wet crossover. Draws from erng.
import { COMPOUNDS, WET } from "./data.js";

// decide the race's rain arc. Returns { rains:false } or a dry→rise→hold→dry timeline.
export function scheduleWeather(erng, wetProb, laps) {
  if (erng.unit() >= wetProb) return { rains: false };
  return {
    rains: true,
    onset: Math.floor(laps * (0.15 + 0.40 * erng.unit())), // rain starts 15..55% in
    rise:  3 + Math.floor(4 * erng.unit()),                 // laps to reach peak
    peak:  0.60 + 0.35 * erng.unit(),                       // peak wetness 0.60..0.95
    hold:  4 + Math.floor(8 * erng.unit()),                 // laps at peak
    dry:   5 + Math.floor(6 * erng.unit()),                 // laps to dry out
  };
}

// track wetness 0..1 at a (possibly fractional) lap.
export function wetnessAt(w, lap) {
  if (!w.rains) return 0;
  const t = lap - w.onset;
  if (t <= 0) return 0;
  if (t < w.rise) return w.peak * (t / w.rise);
  if (t < w.rise + w.hold) return w.peak;
  const d = t - w.rise - w.hold;
  if (d < w.dry) return w.peak * (1 - d / w.dry);
  return 0;
}

// pace penalty (s/lap) for running `compound` at the current `wetness`.
export function weatherTerm(compound, wetness) {
  const c = COMPOUNDS[compound];
  let pen = WET.mismatch * Math.abs(wetness - c.wet_opt);
  if (c.wet_opt < 0.1 && wetness > 0.4) pen += WET.slick * (wetness - 0.4); // slicks aquaplane
  return pen;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/weather.test.js` → 3 pass. `node --test` → all green. If the crossover assertions fail, the `WET.mismatch`/`WET.slick` balance is off — but with mismatch 3 / slick 8 they hold (at 0.6: hard = 3·0.6 + 8·0.2 = 3.4; inter = 3·0.1 = 0.3 → inter wins). Do NOT weaken the test.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/weather.js ApexWeb/tests/weather.test.js
git commit -m "feat(apexweb): pure weather (rain timeline, wetnessAt, compound crossover)"
```

---

## Task 3: sim.js — weather state, lap-time term, AI weather pit

**Files:** Modify `ApexWeb/src/sim.js`; Test `ApexWeb/tests/sim.test.js`.

- [ ] **Step 1: Add failing tests** — append to `ApexWeb/tests/sim.test.js`:

```js
test("rain occurs at roughly track.wet across seeds, and wets the track", () => {
  let rained = 0, sawWet = 0;
  for (let s = 0; s < 200; s++) {
    const r = new Race(field(), TRACK, 8000 + s);
    r.gridStart();
    if (r.weather.rains) rained++;
    let g = 0, peak = 0;
    while (!r.finished && g++ < 500000) { r.step(); if (r.wetness > peak) peak = r.wetness; }
    if (peak > 0.3) sawWet++;
  }
  const f = rained / 200;
  assert.ok(f > TRACK.wet - 0.14 && f < TRACK.wet + 0.14, `rain freq ${f} ~ ${TRACK.wet}`);
  assert.ok(sawWet > 0, "at least one race got wet");
});

test("an AI car on slicks boxes for wets once the track is soaked", () => {
  // find a wet race, then confirm some AI car switches off slicks
  let switched = false;
  for (let s = 0; s < 80 && !switched; s++) {
    const r = new Race(field(), TRACK, 8000 + s);
    r.gridStart();
    if (!r.weather.rains) continue;
    let g = 0;
    while (!r.finished && g++ < 500000) {
      r.step();
      if (r.wetness > 0.6 && r.cars.some(c => c.player == null && (c.tyre === "inter" || c.tyre === "wet"))) { switched = true; break; }
    }
  }
  assert.ok(switched, "AI should fit wet-weather tyres when it pours");
});

test("determinism holds with weather", () => {
  const run = s => { const r = new Race(field(), TRACK, s); r.gridStart(); let g = 0;
    while (!r.finished && g++ < 500000) r.step(); return r.order().map(c => c.abbrev); };
  assert.deepEqual(run(8042), run(8042));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/sim.test.js` → FAIL (`r.weather`/`r.wetness` undefined).

- [ ] **Step 3: Apply edits to `ApexWeb/src/sim.js`** (READ first):

**3a.** Add the weather import after the events import (`import { scheduleSC, startIncidentHit } from "./events.js";`):
```js
import { scheduleWeather, wetnessAt, weatherTerm } from "./weather.js";
```
Append `WET` is NOT needed in sim (weather.js owns it). Nothing else changes in the data import.

**3b.** In the constructor, after the SC scheduling line (`this.scLap = scheduleSC(...)` etc.), add:
```js
    this.weather = scheduleWeather(this.erng, track.wet, track.laps);
    this.wetness = 0;
```

**3c.** In `_lapTime`, add the weather term. After the tyre line `s += comp.pace + tyreTerm(c.tyre, c.wear, c.tyreTemp);`, add:
```js
    s += weatherTerm(c.tyre, this.wetness);   // off-condition compound penalty (rain)
```

**3d.** In `step()`, update `this.wetness` each tick from the leader's (fractional) lap. Right after `this.time += dt;` (near the top of step, before the per-car loop), add:
```js
    const lead = this.cars.reduce((m, c) => Math.max(m, c.lap + c.lapFrac), 0);
    this.wetness = wetnessAt(this.weather, lead);
```

**3e.** Give AI a weather-reactive pit. In `_serveLapEnd`, the AI auto-pit block currently is:
```js
    if (c.player == null && c.pitStops === 0 && !c.pitPending) {
      const comp = COMPOUNDS[c.tyre];
      if (c.wear >= comp.cliff * 0.8 && (this.track.laps - c.lap) > 6) {
        c.pitPending = c.tyre === "soft" ? "medium" : "hard";   // fresh, harder set
      }
    }
```
Add a weather reaction BEFORE that block (so weather pits aren't blocked by the one-stop guard):
```js
    // AI weather reaction: get onto the right tyre for the conditions (not blocked by stop count)
    if (c.player == null && !c.pitPending && c.tyreAge > 2) {
      const slick = COMPOUNDS[c.tyre].wet_opt < 0.1;
      if (this.wetness > 0.55 && slick) c.pitPending = this.wetness > 0.8 ? "wet" : "inter";
      else if (this.wetness < 0.35 && !slick) c.pitPending = "medium";
    }
    if (c.player == null && c.pitStops === 0 && !c.pitPending) {
      const comp = COMPOUNDS[c.tyre];
      if (c.wear >= comp.cliff * 0.8 && (this.track.laps - c.lap) > 6) {
        c.pitPending = c.tyre === "soft" ? "medium" : "hard";   // fresh, harder set
      }
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/sim.test.js` → all pass (incl. the 3 new + existing invariant/determinism/SC/etc.). `node --test` → all green. Adding `scheduleWeather` in the constructor draws `erng` (after the SC schedule, before start incidents) — this shifts the events stream; just confirm the whole suite stays green. Do NOT weaken tests.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/sim.js ApexWeb/tests/sim.test.js
git commit -m "feat(apexweb): weather — rain timeline, wet pace term, AI weather pit"
```

---

## Task 4: main.js + race.js — wetness snapshot + weather readout + pit compound picker

**Files:** Modify `ApexWeb/src/main.js`, `ApexWeb/src/ui/race.js`.

- [ ] **Step 1: main.js** — in `raceSnapshot`, add `wetness` to the top-level snapshot. Change:
```js
    speed: ctx.speed || 1, scActive: ctx.race.scActive,
```
to:
```js
    speed: ctx.speed || 1, scActive: ctx.race.scActive, wetness: ctx.race.wetness,
```

- [ ] **Step 2: race.js — weather readout + compound picker.** The pit button currently is built in `buildHud` as:
```js
        <button class="primary" id="d-pit" style="margin-top:10px;background:var(--bad)">⛽ В боксы → ${tyreIcon("hard", 20)} Hard</button>
```
Replace it with a compound picker row + a generic pit button:
```js
        <p class="label" style="margin-top:8px">Пит — компаунд <span id="d-weather"></span></p>
        <div class="seg" id="d-compound">${["soft","medium","hard","inter","wet"].map(t => `<button data-v="${t}">${tyreIcon(t, 18)}</button>`).join("")}</div>
        <button class="primary" id="d-pit" style="margin-top:8px;background:var(--bad)">⛽ В боксы</button>
```
In `buildHud`, after the existing `#d-engine` handler, add the compound picker handler and replace the pit handler. The current pit handler is:
```js
  root.querySelector("#d-pit").onclick = () => { sfx.pit(); ctx.send({ cmd: "request_pit", car: myIdx(), compound: "hard" }); };
```
Change to:
```js
  root.querySelector("#d-compound").onclick = e => { const v = e.target.closest("button") && e.target.closest("button").dataset.v; if (v) { ctx.nextCompound = v; updateHud(root, ctx, ctx.snapshot); } };
  root.querySelector("#d-pit").onclick = () => { sfx.pit(); ctx.send({ cmd: "request_pit", car: myIdx(), compound: ctx.nextCompound || "medium" }); };
```
In `updateHud`, add the weather readout + compound-picker highlight. After the existing `#d-mini` block (or near the tyre label), add:
```js
  const wet = snap.wetness || 0;
  $("#d-weather").innerHTML = wet < 0.1 ? "☀️ сухо" : wet < 0.45 ? "🌦️ сыро " + Math.round(wet * 100) + "%" : "🌧️ дождь " + Math.round(wet * 100) + "%";
  const nc = ctx.nextCompound || "medium";
  for (const b of $("#d-compound").children) b.classList.toggle("on", b.dataset.v === nc);
```

- [ ] **Step 3: Verify**

Run: `node --check ApexWeb/src/main.js ApexWeb/src/ui/race.js` → OK. `node --test` (inside `ApexWeb/`) → all green.

- [ ] **Step 4: Commit**

```
git add ApexWeb/src/main.js ApexWeb/src/ui/race.js
git commit -m "feat(apexweb): wetness snapshot + HUD weather readout + pit compound picker"
```

---

## Task 5: balance.mjs — weather corridor

**Files:** Modify `ApexWeb/tools/balance.mjs`.

- [ ] **Step 1: Implement** — add to `ApexWeb/tools/balance.mjs` after the safety-car block:

```js
// weather corridor: rain occurs near track.wet; in the wet, wets beat slicks (crossover holds).
{
  const { weatherTerm } = await import("../src/weather.js");
  let rained = 0;
  for (let s = 0; s < 60; s++) {
    const r = new Race(field(), TRACK, 9800 + s);
    if (r.weather.rains) rained++;
  }
  const dryGap = weatherTerm("wet", 0) - weatherTerm("hard", 0);     // >0: slick faster in the dry
  const wetGap = weatherTerm("hard", 0.85) - weatherTerm("wet", 0.85); // >0: wet faster in the rain
  console.log(`weather: rained in ${rained}/60 races = ${(rained / 60).toFixed(2)} (expect ~${TRACK.wet}); ` +
    `dry slick advantage ${dryGap.toFixed(1)}s, wet-tyre advantage in rain ${wetGap.toFixed(1)}s (both expect > 0)`);
}
```

- [ ] **Step 2: Run it**

Run (inside `ApexWeb/`): `node tools/balance.mjs`
Expected: `weather: rained in ...≈0.30...; dry slick advantage >0; wet-tyre advantage in rain >0`. Confirm the earlier corridors still print. NOTE: the main race corridor (DNF / pace spread) now includes some rain races — pace spread may read a little higher than before; if it leaves the ~1.5–2.5 band badly, report it (don't tune weather constants for it — weather variance is expected).

- [ ] **Step 3: Commit**

```
git add ApexWeb/tools/balance.mjs
git commit -m "feat(apexweb): balance harness weather corridor"
```

---

## Notes for the implementer

- **Determinism intact:** weather is scheduled from `this.erng` (deterministic); `this.wetness` is a pure function of the leader's lap. No Math.random/Date.
- **Combat invariant untouched** — weather only changes lap time + AI pit choices.
- **`this.wetness` is global** (same for all cars) — realistic enough; per-corner standing water is out of scope.
- **Owner playtest (browser, hard-reload):** sometimes the header/weather readout shows 🌧️ and the lap times balloon for anyone on slicks; pick `inter`/`wet` in the compound row and box to recover; as it dries, switch back to slicks. The AI scrambles for tyres too.
- Next plan: **Phase 7 — FM team model** (13 driver attributes incl. quali, 5 car indicators, personnel: strategist + pit crew).
