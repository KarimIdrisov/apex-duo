# Sim Engine Phase 3 — Track sectors + mini-sectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the lap into 3 sectors / 18 mini-sectors with per-position **straightness** derived from the real circuit outline; compute per-mini lap-time splits that reflect each car's power(straights)/aero(corners) fit; and show the player a live, coloured mini-sector strip (purple = session best, green = personal best, yellow = slower) like a real F1 timing dashboard.

**Architecture:** A pure `track.js` module derives straightness from `TRACK_PATH` (polyline curvature, binned into 18 equal-length mini-sectors → 3 sectors), exposes `sampleAt(lapFrac)` (for Phase-4 combat locality) and `miniSplits(lapTime, car)` (distributes a lap time across the 18 minis by car fit, summing exactly to the lap time). `sim.js` finalises each lap's 18 mini times, tracks session-best + per-car personal-best per mini, and colours them; the snapshot carries the player car's mini times + colours; `race.js` renders the strip. **The whole-lap lap time is unchanged** — per-sector fit only shapes the splits (display) and feeds Phase 4. No balance recalibration.

**Tech Stack:** Vanilla JS ES modules, Node `node --test`. No new deps. Driver attributes are Phase 7.

**Spec:** `docs/superpowers/specs/2026-06-12-sim-engine-redesign-design.md` §5 (Phase 3 of §14).

---

## File Structure

```
ApexWeb/src/data.js     + FIT_K const (per-sector car-fit strength)
ApexWeb/src/track.js    NEW — straightness from TRACK_PATH; MINI[18]; sampleAt; miniSplits
ApexWeb/src/sim.js      per-lap mini splits + session/personal best + colours + sectorTimes on car
ApexWeb/src/main.js     snapshot: player car lastMini + miniColors
ApexWeb/src/ui/race.js  coloured mini-sector strip in the player control panel
ApexWeb/tools/balance.mjs   sector corridor (power car relatively faster in straight sectors)
ApexWeb/tests/track.test.js NEW
ApexWeb/tests/sim.test.js   + mini-split cases
```

---

## Task 1: data.js — FIT_K constant

**Files:** Modify `ApexWeb/src/data.js`; Test `ApexWeb/tests/data.test.js`.

- [ ] **Step 1: Add failing test** — append to `ApexWeb/tests/data.test.js`:

```js
import { FIT_K } from "../src/data.js";
test("FIT_K present (per-sector car-fit strength)", () => {
  assert.ok(FIT_K > 0 && FIT_K < 2);
});
```

- [ ] **Step 2: Run to verify it fails**

Run (inside `ApexWeb/`): `node --test tests/data.test.js` → FAIL (`FIT_K` undefined).

- [ ] **Step 3: Implement** — add to `ApexWeb/src/data.js` right after the `TYRE` const block:

```js
// per-sector car fit: how strongly power (straights) / aero (corners) reshapes the
// mini-sector split distribution. 0 = flat splits; bigger = more sector specialism.
export const FIT_K = 0.6;
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/data.test.js` → PASS. `node --test` → all green.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/data.js ApexWeb/tests/data.test.js
git commit -m "feat(apexweb): FIT_K per-sector car-fit constant (phase 3)"
```

---

## Task 2: track.js — sectors, straightness, sampleAt, miniSplits

**Files:** Create `ApexWeb/src/track.js`; Test `ApexWeb/tests/track.test.js`.

- [ ] **Step 1: Write the failing test** — `ApexWeb/tests/track.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { MINI, N_MINI, N_SECTOR, sampleAt, miniSplits } from "../src/track.js";

test("18 mini-sectors in 3 sectors, straightness in [0,1], lenFracs sum to 1", () => {
  assert.equal(N_MINI, 18);
  assert.equal(N_SECTOR, 3);
  assert.equal(MINI.length, 18);
  let sum = 0;
  for (const m of MINI) {
    assert.ok(m.straightness >= 0 && m.straightness <= 1, `straightness ${m.straightness}`);
    assert.ok(m.sector >= 0 && m.sector < 3);
    sum += m.lenFrac;
  }
  assert.ok(Math.abs(sum - 1) < 1e-9, `lenFracs sum ${sum}`);
  // the circuit has a mix of straights and corners (not all the same)
  const sArr = MINI.map(m => m.straightness);
  assert.ok(Math.max(...sArr) - Math.min(...sArr) > 0.2, "needs straight/corner contrast");
});

test("sampleAt maps lapFrac to a mini within range", () => {
  const a = sampleAt(0), b = sampleAt(0.5), c = sampleAt(0.999);
  for (const x of [a, b, c]) { assert.ok(x.mini >= 0 && x.mini < 18); assert.ok(x.sector >= 0 && x.sector < 3); }
  assert.ok(b.mini > a.mini);
});

test("miniSplits sum exactly to the lap time; a power car is faster in the straightest mini", () => {
  const lap = 80;
  const powerCar = { power: 0.95, aero: 0.78 };
  const aeroCar  = { power: 0.78, aero: 0.95 };
  const sp = miniSplits(lap, powerCar);
  assert.ok(Math.abs(sp.reduce((a, b) => a + b, 0) - lap) < 1e-6, "splits must sum to the lap time");
  // index of the straightest mini
  let si = 0; for (let i = 1; i < MINI.length; i++) if (MINI[i].straightness > MINI[si].straightness) si = i;
  const spA = miniSplits(lap, aeroCar);
  // power car spends relatively less time than the aero car in the straightest mini
  assert.ok(sp[si] < spA[si], "power car faster in the straightest mini");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/track.test.js` → FAIL (cannot find module ../src/track.js).

- [ ] **Step 3: Implement** — `ApexWeb/src/track.js`:

```js
// ApexWeb/src/track.js — circuit geometry: 3 sectors / 18 mini-sectors with a
// per-position "straightness" derived from the real outline (TRACK_PATH curvature).
// Pure module. sampleAt() locates a car for Phase-4 combat; miniSplits() distributes
// a lap time across the minis by the car's power(straights)/aero(corners) fit.
import { TRACK_PATH, FIT_K } from "./data.js";

export const N_MINI = 18, N_SECTOR = 3;

// --- build points + per-point turning angle (curvature) ---
const PTS = [];
for (let i = 0; i < TRACK_PATH.length; i += 2) PTS.push([TRACK_PATH[i], TRACK_PATH[i + 1]]);
const NP = PTS.length;

function turnAngle(i) {
  const a = PTS[(i - 1 + NP) % NP], b = PTS[i], c = PTS[(i + 1) % NP];
  const v1x = b[0] - a[0], v1y = b[1] - a[1], v2x = c[0] - b[0], v2y = c[1] - b[1];
  const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
  if (m1 < 1e-9 || m2 < 1e-9) return 0;
  let cos = (v1x * v2x + v1y * v2y) / (m1 * m2);
  cos = Math.max(-1, Math.min(1, cos));
  return Math.acos(cos);   // 0 = straight ahead, up to PI = hairpin
}

// 18 equal-count bins over the point list; straightness = 1 - normalised avg turn angle.
function buildMini() {
  const per = NP / N_MINI;
  const raw = [];
  for (let m = 0; m < N_MINI; m++) {
    let sum = 0, n = 0;
    for (let i = Math.floor(m * per); i < Math.floor((m + 1) * per); i++) { sum += turnAngle(i); n++; }
    raw.push(n ? sum / n : 0);
  }
  const maxA = Math.max(...raw, 1e-6);
  return raw.map((a, m) => ({
    straightness: 1 - a / maxA,         // 0 = sharpest corner bin, 1 = straightest
    lenFrac: 1 / N_MINI,                // equal-length bins
    sector: Math.floor(m / (N_MINI / N_SECTOR)),
  }));
}
export const MINI = buildMini();

// where on the lap is a car (lapFrac 0..1)?
export function sampleAt(lapFrac) {
  const f = ((lapFrac % 1) + 1) % 1;
  const mini = Math.min(N_MINI - 1, Math.floor(f * N_MINI));
  return { mini, sector: MINI[mini].sector, straightness: MINI[mini].straightness };
}

// distribute a lap time across the 18 minis by car fit. Sums exactly to lapTime.
export function miniSplits(lapTime, car) {
  const avgS = MINI.reduce((a, m) => a + m.straightness * m.lenFrac, 0);
  const carAvg = car.power * avgS + car.aero * (1 - avgS);
  return MINI.map(m => {
    const localPace = car.power * m.straightness + car.aero * (1 - m.straightness);
    const fit = 1 - FIT_K * (localPace - carAvg);   // <1 where the car is strong (faster mini)
    return lapTime * m.lenFrac * fit;               // Σ lenFrac·fit = 1 → Σ = lapTime
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/track.test.js` → 3 pass. `node --test` → all green. If the "straight/corner contrast" assertion fails (all straightness similar), the binning is too coarse — but with 120 contour points / 18 bins (~6-7 points each) Barcelona has clear corners, so it should pass. Do NOT weaken the test.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/track.js ApexWeb/tests/track.test.js
git commit -m "feat(apexweb): track sectors/mini-sectors from real outline (sampleAt, miniSplits)"
```

---

## Task 3: sim.js — per-lap mini splits, session/personal best, colours

**Files:** Modify `ApexWeb/src/sim.js`; Test `ApexWeb/tests/sim.test.js`.

On each lap completion, split the lap into 18 mini times, colour each (purple = new session best, green = new personal best, yellow = slower), update bests, and store sector totals.

- [ ] **Step 1: Add failing tests** — append to `ApexWeb/tests/sim.test.js`:

```js
import { N_MINI } from "../src/track.js";

test("a completed lap records 18 mini-sector times that sum to the lap time + 3 sector totals", () => {
  const r = new Race(field(), TRACK, 31);
  const c = r.cars[0];
  let guard = 0;
  while (c.lap < 2 && guard++ < 80000) r.step();   // complete a couple of laps
  assert.equal(c.lastMini.length, N_MINI);
  const sum = c.lastMini.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - c.lastLap) < 1e-6, `mini sum ${sum} vs lap ${c.lastLap}`);
  assert.equal(c.sectorTimes.length, 3);
  assert.ok(Math.abs(c.sectorTimes.reduce((a, b) => a + b, 0) - c.lastLap) < 1e-6);
});

test("first flier colours are all session-best (purple) and determinism holds", () => {
  const r = new Race(field(), TRACK, 32);
  // leader (highest skill) sets the first session bests on its first lap
  const lead = r.cars.reduce((a, b) => (a.skill >= b.skill ? a : b));
  let guard = 0;
  while (lead.lap < 1 && guard++ < 80000) r.step();
  assert.ok(lead.miniColors.every(x => x === "p"), "leader's first lap should be all session bests");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/sim.test.js` → FAIL (`c.lastMini` undefined).

- [ ] **Step 3: Apply edits to `ApexWeb/src/sim.js`** (READ first):

**3a.** Add the track import after the tyres import:
```js
import { miniSplits, MINI, N_MINI } from "./track.js";
```

**3b.** In the constructor, before `this.cars = field.map(...)`, add a session-best array:
```js
    this.sessionBestMini = new Array(N_MINI).fill(Infinity);
```
And in the car object, add the mini/sector fields (after `pitStops: 0, pitTimer: 0,`):
```js
      lastMini: [], bestMini: new Array(N_MINI).fill(Infinity), miniColors: [], sectorTimes: [0, 0, 0],
```

**3c.** Add a method to the class (place it just before `_serveLapEnd`):
```js
  // finalise a completed lap's mini-sector splits, colours, and sector totals
  _recordMinis(c) {
    const sp = miniSplits(c.lastLap, c.car);
    c.lastMini = sp;
    const colors = new Array(N_MINI), sectors = [0, 0, 0];
    for (let i = 0; i < N_MINI; i++) {
      const t = sp[i];
      colors[i] = t < this.sessionBestMini[i] ? "p" : (t <= c.bestMini[i] ? "g" : "y");
      if (t < this.sessionBestMini[i]) this.sessionBestMini[i] = t;
      if (t < c.bestMini[i]) c.bestMini[i] = t;
      sectors[MINI[i].sector] += t;
    }
    c.miniColors = colors;
    c.sectorTimes = sectors;
  }
```

**3d.** In `step()` lap completion, call it right after `c.lastLap = c.lapTimeAccum;` is set and before the wear/fuel block. The current lines are:
```js
        c.lastLap = c.lapTimeAccum;
        c._lapSum += c.lastLap; c._lapN++; c.avgLap = c._lapSum / c._lapN;
```
Change to:
```js
        c.lastLap = c.lapTimeAccum;
        this._recordMinis(c);
        c._lapSum += c.lastLap; c._lapN++; c.avgLap = c._lapSum / c._lapN;
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/sim.test.js` → all pass (incl. 2 new). `node --test` → all green. Determinism: `_recordMinis` is pure-from-state, no RNG — the existing determinism tests still pass.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/sim.js ApexWeb/tests/sim.test.js
git commit -m "feat(apexweb): per-lap mini-sector splits, session/personal best colours, sector totals"
```

---

## Task 4: main.js — snapshot player mini data

**Files:** Modify `ApexWeb/src/main.js`.

Carry the mini colours + times only on player cars (the only ones rendered as a strip).

- [ ] **Step 1: Implement** — in `raceSnapshot`, extend the player-car fields. Change:
```js
      pitStops: c.pitStops, tyreAge: c.tyreAge, tyreTemp: c.tyreTemp, lastLap: c.lastLap, startPos: c.startPos,
```
to:
```js
      pitStops: c.pitStops, tyreAge: c.tyreAge, tyreTemp: c.tyreTemp, lastLap: c.lastLap, startPos: c.startPos,
      miniColors: c.player ? c.miniColors : undefined, sectorTimes: c.player ? c.sectorTimes : undefined,
```

- [ ] **Step 2: Verify**

Run: `node --check ApexWeb/src/main.js` → OK. `node --test` → all green.

- [ ] **Step 3: Commit**

```
git add ApexWeb/src/main.js
git commit -m "feat(apexweb): snapshot player mini-sector colours + sector times"
```

---

## Task 5: race.js — coloured mini-sector strip

**Files:** Modify `ApexWeb/src/ui/race.js`.

Show the player's last-lap mini-sector strip (18 cells, coloured) + the 3 sector times in the control panel, between the gaps line and the tyre label.

- [ ] **Step 1: Implement** — in `buildHud`, find the player control panel. After the gaps block (the `<div ... id="d-gaps"></div>` line and its closing `</div>`) and BEFORE the tyre label `<p class="label" id="d-tyrelabel"></p>`, insert a mini-sector container:
```html
        <div id="d-mini" style="display:flex;gap:2px;margin:2px 0 8px"></div>
```

Then in `updateHud`, render it. Add this right after the `#d-tyrelabel` line (purple = session best, green = personal best, yellow = slower):
```js
  const COLORS = { p: "#b14aef", g: "#3ddc84", y: "#e7c84b" };
  const cols = me.miniColors || [];
  $("#d-mini").innerHTML = cols.length
    ? cols.map((k, i) => `<div title="мини-сектор ${i + 1}" style="flex:1;height:8px;border-radius:2px;background:${COLORS[k] || "#3f3f46"}"></div>`).join("")
    : `<div class="label" style="margin:0">мини-сектора появятся после первого круга</div>`;
```

- [ ] **Step 2: Verify**

Run: `node --check ApexWeb/src/ui/race.js` → OK. `node --test` → all green.

- [ ] **Step 3: Commit**

```
git add ApexWeb/src/ui/race.js
git commit -m "feat(apexweb): HUD mini-sector colour strip (purple/green/yellow)"
```

---

## Task 6: balance.mjs — sector corridor

**Files:** Modify `ApexWeb/tools/balance.mjs`.

Prove sector specialism: a power car's straight-sector time share is lower (faster) than an aero car's, and vice-versa in the corner sector.

- [ ] **Step 1: Implement** — add to `ApexWeb/tools/balance.mjs` after the tyre-deg block:

```js
// sector specialism: power car relatively faster in the straightest sector, aero car in the twistiest.
{
  const { MINI, miniSplits, N_SECTOR } = await import("../src/track.js");
  const sectorStraightness = Array.from({ length: N_SECTOR }, (_, s) =>
    MINI.filter(m => m.sector === s).reduce((a, m) => a + m.straightness, 0) /
    MINI.filter(m => m.sector === s).length);
  const straightSec = sectorStraightness.indexOf(Math.max(...sectorStraightness));
  const twistySec = sectorStraightness.indexOf(Math.min(...sectorStraightness));
  const secTime = (car, sec) => miniSplits(80, car).filter((_, i) => MINI[i].sector === sec).reduce((a, b) => a + b, 0);
  const powerCar = { power: 0.95, aero: 0.78 }, aeroCar = { power: 0.78, aero: 0.95 };
  console.log(`sectors: power car ${(secTime(powerCar, straightSec) - secTime(aeroCar, straightSec)).toFixed(3)}s vs aero car in straight S${straightSec + 1} (expect negative = faster), ` +
    `${(secTime(powerCar, twistySec) - secTime(aeroCar, twistySec)).toFixed(3)}s in twisty S${twistySec + 1} (expect positive)`);
}
```

- [ ] **Step 2: Run it**

Run (inside `ApexWeb/`): `node tools/balance.mjs`
Expected: the sectors line prints a negative number for the straight sector (power car faster) and a positive number for the twisty sector. If both are ~0, raise `FIT_K` in `data.js` (and re-run `node --test`).

- [ ] **Step 3: Commit**

```
git add ApexWeb/tools/balance.mjs
git commit -m "feat(apexweb): balance harness sector-specialism corridor"
```

---

## Notes for the implementer

- **Whole-lap lap time is unchanged** this phase — `miniSplits` only redistributes `lastLap` for display; `Σ minis = lastLap` exactly. No balance recalibration.
- **Determinism intact:** `track.js` and `miniSplits` are pure; `_recordMinis` uses no RNG.
- **Combat invariant untouched** — `sampleAt` is built now but `_resolveCombat` is not changed until Phase 4.
- **Owner playtest (browser, hard-reload):** after the first lap a row of 18 little bars appears under the gaps; cells are purple (you set the session best for that mini-sector), green (your own best), or yellow (slower). Power-strong teams light up the straight sectors; aero-strong teams the corner sectors.
- Next plan: **Phase 4 — overtaking v2** (slipstream + dirty-air, using `sampleAt`).
