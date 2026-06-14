# ApexWeb Qualifying Depth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the qualifying flying lap into a live, sector-by-sector lap the player manages under execution risk (push per sector, lock-ups, deletable laps), gated by practice track knowledge, with a Variant-A desktop dashboard.

**Architecture:** Pure math in `quali.js` (`qualiLapClean` + `qualiSector`); the live state machine in `quali_session.js` advances a `flying` car by sectors and resolves each sector's time + risk; `main.js` feeds `trackKnow` into the field, wires the `quali_push` command, and gates repaints; `ui/quali.js` + `style.css` render. Lock the numbers against the Node corridor BEFORE the UI.

**Tech Stack:** Vanilla JS ES modules, `node --test`, `tools/balance.mjs` corridor, Canvas/HTML UI.

**Spec:** `docs/superpowers/specs/2026-06-14-apexweb-quali-depth-design.md`

---

## File structure

- `src/data.js` — `QUALI2` adds push/risk/variance consts.
- `src/quali.js` — extract `qualiLapClean`; add `qualiSector`; `qualiLap` = clean + the existing single-shot risk (unchanged behaviour for `buildGrid`).
- `src/quali_session.js` — flying car advances by sectors; `completeSector` (time + risk + lap finish/delete); car carries `sector/secAcc/lapSectors/base/push/trackKnow/lapDeleted/bestSectors`; `newQuali` seeds them; `setPush` export; snapshot exposes the live-lap fields.
- `src/main.js` — `qualiField` attaches `trackKnow`; `quali_push` command; `liveSig` quali branch includes sector/push; quali joins the wide-`#app` condition.
- `src/ui/quali.js` — 2-col dashboard: tower left, live-lap card (sector deltas + push control) right.
- `style.css` — quali grid + live-lap card + push control + responsive collapse.
- `tests/quali_session.test.js`, `tests/quali.test.js` — sector/risk/determinism.
- `tools/balance.mjs` — grid realism + deletion-rate corridor.
- `README.md` — quali section + test count.

---

### Task 1: QUALI2 risk/push/variance consts

**Files:** Modify `src/data.js` (the `QUALI2` block). Test: `tests/data.test.js`.

- [ ] **Step 1: Write the failing test** — append to `tests/data.test.js`:

```javascript
test("QUALI2 carries live-lap push/risk tuning", () => {
  assert.ok(QUALI2.PUSH_GAIN > 0, "push gain (save→max, s/lap)");
  assert.ok(QUALI2.TRACK_SAFETY > 0 && QUALI2.TRACK_SAFETY <= 1, "track knowledge cuts risk");
  assert.ok(QUALI2.OFF_BASE > 0 && QUALI2.OFF_BASE < 0.2, "per-sector off (delete) base chance");
  assert.ok(QUALI2.LOCK_BASE > QUALI2.OFF_BASE, "lock-ups commoner than offs");
  assert.ok(QUALI2.LOCK_MAX > QUALI2.LOCK_MIN && QUALI2.LOCK_MIN > 0, "lock-up time range");
  assert.ok(QUALI2.SEC_VAR_PUSH >= QUALI2.SEC_VAR_BASE, "push widens sector variance");
});
```

- [ ] **Step 2: Run, verify FAIL:** `cd ApexWeb && node --test tests/data.test.js`

- [ ] **Step 3:** In `src/data.js`, add these keys to the `QUALI2` object (just before its closing `}`):

```javascript
  PUSH_GAIN: 0.6,         // s/lap from save(0) to max(3) push (full-lap; per sector ∝ frac)
  TRACK_SAFETY: 0.7,      // track knowledge cuts risk + variance: safety = 1 - TRACK_SAFETY*trackKnow
  SEC_VAR_BASE: 0.03,     // sector time noise at push 0
  SEC_VAR_PUSH: 0.10,     // + this much noise at push 3
  OFF_BASE: 0.05,         // per-sector "off" (lap-deleting) chance at push 3, trackKnow 0 (× pushN² × safety)
  LOCK_BASE: 0.10,        // per-sector lock-up chance at push 3, trackKnow 0 (× pushN × safety)
  LOCK_MIN: 0.2,          // lock-up time loss min (s)
  LOCK_MAX: 0.8,          // lock-up time loss max (s)
```

- [ ] **Step 4: Run, verify PASS:** `cd ApexWeb && node --test tests/data.test.js`

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/data.js ApexWeb/tests/data.test.js
git commit -m "feat(apexweb): QUALI2 live-lap push/risk/variance consts"
```

---

### Task 2: `qualiLapClean` + `qualiSector`

**Files:** Modify `src/quali.js`. Test: `tests/quali.test.js`.

Context: `qualiLap(drv, car, track, setupBonus, risk, rng, carMean, opts)` currently does the clean terms then `-0.35*risk`, `+noise`, and a mistake roll. We split the clean part out and add a per-sector resolver. `qualiLap` keeps identical behaviour so `buildGrid` + its tests are untouched.

- [ ] **Step 1: Write the failing tests** — append to `tests/quali.test.js` (it imports `qualiLap`, `RNG`, `TRACK`/track data; add `qualiLapClean, qualiSector` to the import from `../src/quali.js` and `QUALI2` from `../src/data.js`):

```javascript
test("qualiLapClean is the deterministic base (no risk/noise)", () => {
  const drv = { skill: 0.8 }, car = { power: 0.8, aero: 0.8 };
  const a = qualiLapClean(drv, car, TRACK, 0, 0, { grip: 0 });
  const b = qualiLapClean(drv, car, TRACK, 0, 0, { grip: 0 });
  assert.equal(a, b, "pure function, same inputs → same output");
  assert.ok(a > 50 && a < 120, `sane lap base (${a})`);
});

test("qualiSector: higher push = faster mean; off deletes, lock-up adds time", () => {
  const base = 90;
  const mean = (push, tk) => { const r = new RNG(1); let sum = 0, n = 200;
    for (let i = 0; i < n; i++) sum += qualiSector(base, 1/3, push, tk, new RNG(100 + i)).time; return sum / n; };
  assert.ok(mean(3, 1) < mean(0, 1), "max push faster than save (clean driver)");
  // track knowledge cuts the off (delete) rate
  const offRate = (tk) => { let off = 0, n = 600;
    for (let i = 0; i < n; i++) if (qualiSector(base, 1/3, 3, tk, new RNG(7000 + i)).event === "off") off++; return off / n; };
  assert.ok(offRate(0) > offRate(1) * 2, `low track knowledge offs far more (${offRate(0)} vs ${offRate(1)})`);
  // save (push 0) almost never offs
  let safeOff = 0; for (let i = 0; i < 600; i++) if (qualiSector(base, 1/3, 0, 0, new RNG(i)).event === "off") safeOff++;
  assert.ok(safeOff === 0, "save push never offs");
});
```

- [ ] **Step 2: Run, verify FAIL:** `cd ApexWeb && node --test tests/quali.test.js`

- [ ] **Step 3:** In `src/quali.js`, replace the `qualiLap` function with the split + the new sector resolver:

```javascript
// the deterministic, clean part of a flying lap (no push/risk/noise) — the base the live sector model splits.
export function qualiLapClean(drv, car, track, setupBonus, carMean = 0, opts = {}) {
  const grip = opts.grip ?? 0, traffic = opts.traffic ?? 0;
  let s = track.lt + COMPOUNDS.soft.pace;
  s -= SKILL_K * ((drv.attrs ? drv.attrs.quali : drv.skill) - 0.5);   // one-lap pace
  s -= CAR_PACE_K * ((car.power + car.aero) / 2 - carMean);           // absolute car performance (§18.1)
  s -= CAR_K * ((car.power - car.aero) * (track.pw - track.df));
  s += setupBonus;
  s -= QUALI2.GRIP_GAIN * grip;                                       // track evolution
  if (opts.tyre === "used") s += QUALI2.USED_PENALTY;
  s += traffic;
  if (opts.yellow) s += QUALI2.YELLOW_PENALTY;
  return s;
}

// legacy single-shot flying lap (buildGrid fallback + tests): clean base + push-risk/noise/mistake. Unchanged behaviour.
export function qualiLap(drv, car, track, setupBonus, risk, rng, carMean = 0, opts = {}) {
  let s = qualiLapClean(drv, car, track, setupBonus, carMean, opts);
  s -= 0.35 * risk;                                                   // pushing harder = faster
  s += rng.noise(0.08 + 0.45 * risk);                                // ...but more variance
  const composed = drv.attrs ? 1 - ATTRW.composure * (drv.attrs.composure - 0.5) * 2 : 1;
  if (rng.unit() < 0.12 * risk * composed) s += rng.range(0.8, 2.5);  // mistake / lock-up
  return s;
}

// one sector of a LIVE flying lap. base = clean lap time; frac = this sector's share (≈1/3).
// push 0..3, trackKnow 0..1. Returns { time, event } where event ∈ null | "lockup" | "off" (off → caller deletes the lap).
export function qualiSector(base, frac, push, trackKnow, rng) {
  const pushN = push / 3;                                             // 0..1
  const safety = 1 - QUALI2.TRACK_SAFETY * trackKnow;                 // track knowledge tightens risk + variance
  let s = base * frac;
  s -= QUALI2.PUSH_GAIN * frac * pushN;                              // pushing this sector = faster (∝ sector size)
  s += rng.noise((QUALI2.SEC_VAR_BASE + QUALI2.SEC_VAR_PUSH * pushN) * safety);
  let event = null;
  const r = rng.unit();
  const offChance  = QUALI2.OFF_BASE  * pushN * pushN * safety;       // big mistake (push²) → lap deleted
  const lockChance = QUALI2.LOCK_BASE * pushN * safety;              // small mistake → +time
  if (r < offChance) event = "off";
  else if (r < offChance + lockChance) { event = "lockup"; s += rng.range(QUALI2.LOCK_MIN, QUALI2.LOCK_MAX); }
  return { time: s, event };
}
```

Add `QUALI2` to the existing `data.js` import if not present (the file already imports `SKILL_K, CAR_K, CAR_PACE_K, COMPOUNDS, ATTRW, QUALI2`).

- [ ] **Step 4: Run, verify PASS:** `cd ApexWeb && node --test tests/quali.test.js`

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/quali.js ApexWeb/tests/quali.test.js
git commit -m "feat(apexweb): qualiLapClean + qualiSector (live-lap risk model)"
```

---

### Task 3: Sector-stepped live flying lap (quali_session.js)

**Files:** Modify `src/quali_session.js`. Test: `tests/quali_session.test.js`.

Context (read the file first): today `qualiStep` advances every on-track car by whole laps (`lapAcc`), and `completeLap(s, car)` handles `outlap→flying` (stamp traffic), `flying→` (one `qualiLap`, best, 2nd-lap-or-inlap), `inlap→pit`. We change the `flying` phase to advance by **sectors** and resolve each via `qualiSector`. The car gains live-lap state; the flag roll moves to the first sector.

- [ ] **Step 1: Write the failing tests** — append to `tests/quali_session.test.js` (it imports from `../src/quali_session.js`; add `setPush` to that import):

```javascript
test("a flying lap completes through 3 sectors into a summed time", () => {
  let s = newQuali(7, field()); s.paused = false; s.speed = 8;
  s = release(s, "p1", "fresh", "attack");
  for (let i = 0; i < 800; i++) s = qualiStep(s, 1.0);
  const v = carView(s, "p1");
  assert.ok(v.bestTime > 60 && v.bestTime < 110, `set a sector-summed flying time (${v.bestTime})`);
});

test("track knowledge cuts the deleted-lap rate at max push", () => {
  const deletes = (tk) => {
    let s = newQuali(3, field()); s.paused = false; s.speed = 8;
    Object.values(s.cars).forEach(c => { c.trackKnow = tk; });
    let del = 0, prevLaps = 0;
    for (let run = 0; run < 12; run++) {
      const car = Object.values(s.cars).find(c => c.player === "p1");
      car.phase = "pit"; car.softSets = 9;
      s = release(s, "p1", "fresh", "max"); setPush(s, "p1", 3);
      for (let i = 0; i < 400 && Object.values(s.cars).find(c=>c.player==="p1").phase!=="pit"; i++) s = qualiStep(s, 1.0);
      const c2 = Object.values(s.cars).find(c => c.player === "p1");
      if (c2._lastDeleted) del++;
    }
    return del;
  };
  assert.ok(deletes(0) > deletes(1), `low track knowledge deletes more (${deletes(0)} vs ${deletes(1)})`);
});

test("determinism: same seed + same push → identical flying time", () => {
  const run = () => { let s = newQuali(5, field()); s.paused = false; s.speed = 8;
    s = release(s, "p1", "fresh", "attack"); setPush(s, "p1", 2);
    for (let i = 0; i < 800; i++) s = qualiStep(s, 1.0); return carView(s, "p1").bestTime; };
  assert.equal(run(), run());
});
```

(The `deletes` test references `c._lastDeleted` — set it in step 3 when a lap is deleted. `field()` and the imports already exist in the test file.)

- [ ] **Step 2: Run, verify FAIL:** `cd ApexWeb && node --test tests/quali_session.test.js`

- [ ] **Step 3: Edit `src/quali_session.js`.**

(a) Import `qualiLapClean` + `qualiSector` (the file imports `qualiLap` from `./quali.js`):
```javascript
import { qualiLap, qualiLapClean, qualiSector } from "./quali.js";
```

(b) Add a sector-duration helper next to `LAP_SEC`:
```javascript
const SECTOR_SEC = () => TRACK.lt / 3;   // 3 equal sectors per flying lap
```

(c) In `newQuali`, give each car the live-lap fields. In the `cars[f.idx] = { … }` literal add:
```javascript
    push: 1, trackKnow: f.trackKnow ?? 0.5,                          // push 0..3 (steady default); track knowledge gates risk
    sector: 0, secAcc: 0, lapSectors: [], base: 0, lapDeleted: false, bestSectors: [Infinity, Infinity, Infinity],
    lastLap: Infinity, _lastDeleted: false,
```

(d) In `startRun`, set `car.push` from the push label (keep `car.risk` for the legacy path). After the existing `car.risk = …` line add:
```javascript
  car.push = { save: 0, steady: 1, attack: 2, max: 3 }[push] ?? 1;
```

(e) Add a `setPush` export (near `setSpeed`/`setPaused`):
```javascript
export function setPush(s, player, level) {
  const car = Object.values(s.cars).find(c => c.player === player);
  if (car && !car.eliminated) car.push = Math.max(0, Math.min(3, level | 0));
  return s;
}
```

(f) Replace `completeLap` so it no longer resolves the flying lap (it now only handles out-lap→flying and in-lap→pit; starting a flying lap stamps the base + sector state and bumps `lapIdx` so each flying lap gets a distinct RNG):
```javascript
// out-lap warms the tyre then BEGINS the live flying lap; in-lap returns to the pit. (flying laps resolve in completeSector.)
function completeLap(s, car) {
  if (car.phase === "outlap") { startFlyingLap(s, car); return; }
  if (car.phase === "inlap")  { car.phase = "pit"; return; }
}

// stamp the clean base for a fresh flying lap + reset sector state. Bumps lapIdx → unique sector RNG per flying lap.
function startFlyingLap(s, car) {
  car.lapIdx += 1;
  car._traffic = trafficFor(s, car, car.lapIdx);
  car.base = qualiLapClean(car.drv, car.car, TRACK, car.setupBonus, s.carMean,
    { grip: s.grip, tyre: car.tyre, traffic: car._traffic || 0, yellow: !!(s.flag && s.flag.type === "yellow") });
  car.phase = "flying"; car.sector = 0; car.secAcc = 0; car.lapSectors = []; car.lapDeleted = false;
}

// one sector of a live flying lap: roll the flag on sector 0; resolve time + risk; finish/delete on the 3rd sector.
function completeSector(s, car) {
  if (car.sector === 0) {
    const pushLabel = car.push >= 2 ? "attack" : "steady";
    const inc = rollFlag(s, car.lapIdx, pushLabel);
    if (inc === "red") { redFlag(s); return; }                       // red sends on-track cars to inlap
    if (inc === "yellow" && !s.flag) s.flag = { type: "yellow", ySecLeft: QUALI2.YELLOW_SEC };
  }
  const rng = lapRng(s, car.idx, car.lapIdx * 10 + car.sector);
  const r = qualiSector(car.base, 1 / 3, car.push, car.trackKnow, rng);
  if (r.event === "off") {                                           // big mistake → lap deleted, no time, run over
    car.lapDeleted = true; car._lastDeleted = true; car.lapsThisRun += 1;
    car.phase = "inlap"; car.lapAcc = 0; return;
  }
  car._lastDeleted = false;
  car.lapSectors.push(r.time);
  car.sector += 1;
  if (car.sector < 3) return;                                        // mid-lap
  const t = car.lapSectors.reduce((a, b) => a + b, 0);              // lap done
  car.lastLap = t; car.bestTime = Math.min(car.bestTime, t); car.segBest = Math.min(car.segBest, t);
  for (let i = 0; i < 3; i++) car.bestSectors[i] = Math.min(car.bestSectors[i], car.lapSectors[i]);
  car.lapsThisRun += 1;
  if (car.lapsThisRun < 2 && car.tyre === "fresh") { car.tyre = "used"; startFlyingLap(s, car); return; }  // 2nd flying lap
  car.phase = "inlap"; car.lapAcc = 0;
}
```

(g) In `qualiStep`, split the car-advance loop so flying cars step by sectors. Replace the `for (const idx in s.cars) { … }` block with:
```javascript
  for (const idx in s.cars) {
    const car = s.cars[idx];
    if (car.eliminated || car.phase === "pit") continue;
    if (car.phase === "flying") {
      car.secAcc += adv;
      let guard = 0;
      while (car.secAcc >= SECTOR_SEC() && car.phase === "flying" && guard++ < 8) { car.secAcc -= SECTOR_SEC(); completeSector(s, car); }
    } else {
      car.lapAcc += adv;
      let guard = 0;
      while (car.lapAcc >= LAP_SEC() && (car.phase === "outlap" || car.phase === "inlap") && guard++ < 8) { car.lapAcc -= LAP_SEC(); completeLap(s, car); }
    }
  }
```

(h) In `qualiSnapshot`, expose the live-lap fields on each player block. The per-player block built by `block(player)` — add to its returned object:
```javascript
    sector: c.sector, push: c.push, lapSectors: c.lapSectors.slice(),
    sectorDelta: c.lapSectors.map((t, i) => (isFinite(c.bestSectors[i]) ? t - c.bestSectors[i] : null)),
    lapDeleted: c.lapDeleted, lastLap: isFinite(c.lastLap) ? c.lastLap : null,
```

- [ ] **Step 4: Run, verify PASS:** `cd ApexWeb && node --test tests/quali_session.test.js` (all pass; the existing knockout/traffic/flag/snapshot tests still green).

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/quali_session.js ApexWeb/tests/quali_session.test.js
git commit -m "feat(apexweb): live sector-by-sector flying lap + risk + setPush"
```

---

### Task 4: Field track-knowledge + quali_push command + gate + wide app

**Files:** Modify `src/main.js`.

- [ ] **Step 1:** `qualiField()` attaches `trackKnow` per car (player: practiced; AI: baseline). Change its `.map` so each entry includes:
```javascript
      trackKnow: f.player ? pracTrackKnow(f.player) : PRAC2.AI_TRACK_KNOW,
```
(The map currently returns `{ idx, abbrev, drv, car, setupBonus, player }`; add the `trackKnow` field. `pracTrackKnow` already exists from the practice-depth work; `PRAC2` is imported.)

- [ ] **Step 2:** Import `setPush` from quali_session and add the command. In the quali_session import line add `setPush as qSetPush`. In `onCommand`, after the other `quali_*` cases add:
```javascript
    case "quali_push": if (ctx.qualiSession) { qSetPush(ctx.qualiSession, cmd.player, cmd.level); pushQuali(); } break;
```

- [ ] **Step 3:** Extend the `liveSig` quali per-car closure so the live card repaints on sector/push changes. Change the quali branch's per-car closure to:
```javascript
    const c = p => { const x = snap.cars[p]; return x ? `${x.phase}.${x.tyre}.${x.softSets}.${x.eliminated ? 1 : 0}.${x.pos}.${x.sector ?? "-"}.${x.push ?? "-"}.${x.lapDeleted ? 1 : 0}.${x.lapSectors ? x.lapSectors.length : 0}` : "-"; };
```

- [ ] **Step 4:** Add quali to the wide-`#app` condition in `rerender` (so the 2-col dashboard has room). Change the wide push to:
```javascript
  if (phase === "race" || phase === "result" || isPractice(phase) || phase === "quali") cls.push("wide");
```

- [ ] **Step 5: Syntax check + commit**

```bash
cd ApexWeb && node --check src/main.js && echo OK
git add ApexWeb/src/main.js
git commit -m "feat(apexweb): quali field track-knowledge + quali_push + gate + wide app"
```

---

### Task 5: Balance corridor — grid realism + deletion rate + tune

**Files:** Modify `tools/balance.mjs` (the quali corridor block).

- [ ] **Step 1:** Read the quali corridor in `tools/balance.mjs` (search `runQuali`). It builds a quali field and runs full sessions. Ensure the field entries carry `trackKnow` (add `trackKnow: 0.7` to the field map in `qualiField`/`runQuali` if absent, so AI cars behave). Then ADD a deletion-rate probe after the existing quali prints:
```javascript
  {
    const { newQuali, release, setPush, qualiStep, carView } = await import("../src/quali_session.js");
    const probe = (tk, push) => {
      let s = newQuali(4242, qualiField()); s.paused = false; s.speed = 8;
      let del = 0, set = 0;
      for (let run = 0; run < 20; run++) {
        const car = Object.values(s.cars).find(c => c.player === "p1") || Object.values(s.cars)[0];
        car.phase = "pit"; car.softSets = 9; car.trackKnow = tk;
        s = release(s, car.player || "p1", "fresh", push); if (car.player) setPush(s, car.player, push === "max" ? 3 : 2);
        for (let i = 0; i < 400 && car.phase !== "pit"; i++) s = qualiStep(s, 1.0);
        if (car._lastDeleted) del++; else if (isFinite(car.bestTime)) set++;
      }
      return { del, set };
    };
    const lo = probe(0.0, "max"), hi = probe(1.0, "max"), safe = probe(0.0, "save");
    console.log(`quali risk: max-push deletes — trackKnow 0: ${lo.del}/20, trackKnow 1: ${hi.del}/20 (expect 0≫1)`);
    console.log(`quali risk: save policy always sets a time — ${safe.set}/20 (expect 20)`);
  }
```
(If the player-less harness field makes `release`/`setPush` awkward, give the field a `player:"p1"` entry for car 0 in `qualiField()` so the probe can drive it; keep the rest AI.)

- [ ] **Step 2: Run:** `cd ApexWeb && node tools/balance.mjs 2>&1 | grep -i quali`
Expected: existing lines (all classified, pole→P22 ~1.5-5s, evolution ~1.3s) PLUS the two risk lines.

- [ ] **Step 3: TUNE** `OFF_BASE`/`LOCK_BASE`/`PUSH_GAIN`/`TRACK_SAFETY`/`SEC_VAR_*` in `src/data.js` until: pole→P22 spread stays ~1.5-5s; max-push deletes at trackKnow 0 are frequent (~5-12/20) and at trackKnow 1 rare (~0-3/20); the save policy sets a time 20/20. Levers: `OFF_BASE` ↑ → more deletes; `TRACK_SAFETY` ↑ → bigger gap between trackKnow 0 and 1; `PUSH_GAIN` sets how much faster pushing is. Re-run after each change.

- [ ] **Step 4:** Confirm the race corridors are unchanged: `node tools/balance.mjs 2>&1 | grep -iE 'DNF|spread|practice'` (DNF ~1-2, race spread ~1.5-2.5, practice 58%/100%).

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/tools/balance.mjs ApexWeb/src/data.js
git commit -m "test(apexweb): quali deletion-rate corridor + grid realism; tune risk consts"
```

---

### Task 6: Variant-A desktop dashboard + live-lap card (ui/quali.js)

**Files:** Modify `src/ui/quali.js`.

Context: the screen builds `header + tower + control + partner + ready` as one column. Restructure into header + a 2-col grid: tower left, the control card (now the **live-lap card**) right. Add sector deltas + a push control.

- [ ] **Step 1:** Build the sector-delta strip + push control inside the control card. In the `me`-block (where the control card is built, currently gated `if (me)`), before `control = …`, add:
```javascript
    const fmtDelta = d => d == null ? "—" : (d <= 0 ? "−" : "+") + Math.abs(d).toFixed(3);
    const secCells = [0, 1, 2].map(i => {
      const dn = me.lapSectors && me.lapSectors[i] != null;
      const d = me.sectorDelta && me.sectorDelta[i];
      const cls = !dn ? "" : (d != null && d <= 0 ? "good" : "warn");
      return `<div class="q-sec ${i === me.sector && me.phase === "flying" ? "live" : ""} ${cls}">
        <span class="q-sec-n">S${i + 1}</span><span class="q-sec-d">${dn ? fmtDelta(d) : "—"}</span></div>`;
    }).join("");
    const sectorStrip = `<div class="q-sectors">${secCells}</div>
      ${me.lapDeleted ? `<div class="q-deleted">круг аннулирован</div>` : ""}`;
    const pushLabels = ["сейв", "норма", "атака", "предел"];
    const pushSeg = `<div class="seg q-push-seg" id="q-push">` +
      pushLabels.map((l, i) => `<button data-lvl="${i}" class="${me.push === i ? "on" : ""}">${l}</button>`).join("") + `</div>`;
```

- [ ] **Step 2:** Insert `sectorStrip` and `pushSeg` into the control card body (after the tyre row / before release-abort). In the existing `body = \`…\`` template for the live (not eliminated) car, add near the top:
```javascript
        <p class="label" style="margin:0 0 4px">Быстрый круг по секторам</p>
        ${sectorStrip}
        <p class="label" style="margin:12px 0 4px">Темп круга</p>
        ${pushSeg}
```
(Replace the old steady/attack `pushSeg` if one exists — this 4-level one supersedes it.)

- [ ] **Step 3:** Wrap the body in the 2-col grid. Change the final `root.innerHTML = header + tower + control + partner + ready;` to:
```javascript
  root.innerHTML = header
    + `<div class="q-grid"><div class="q-main">${tower}</div><div class="q-side">${control}${partner}</div></div>`
    + ready;
```

- [ ] **Step 4:** Wire the push control. In the handler block add:
```javascript
  const pushEl = root.querySelector("#q-push");
  if (pushEl) pushEl.onclick = e => {
    const b = e.target.closest("button"); if (!b || b.dataset.lvl == null) return;
    ctx.send({ cmd: "quali_push", player: ctx.myPlayer, level: +b.dataset.lvl });
  };
```

- [ ] **Step 5:** `node --check src/ui/quali.js && echo OK`; then commit:
```bash
git add ApexWeb/src/ui/quali.js
git commit -m "feat(apexweb): quali 2-col dashboard + live sector strip + push control"
```

---

### Task 7: Quali dashboard CSS

**Files:** Modify `style.css`.

- [ ] **Step 1:** Add near the `/* Qualifying screen */` block:
```css
.q-grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:14px;align-items:start}
.q-side{display:flex;flex-direction:column;gap:14px}
@media (max-width:760px){ .q-grid{grid-template-columns:1fr} }
.q-sectors{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.q-sec{background:var(--content2);border-radius:var(--r-sm);padding:8px;text-align:center}
.q-sec.live{outline:2px solid var(--accent)}
.q-sec.good .q-sec-d{color:var(--good)} .q-sec.warn .q-sec-d{color:var(--warn)}
.q-sec-n{display:block;font-size:11px;color:var(--muted);font-weight:600}
.q-sec-d{font-size:15px;font-weight:700;font-variant-numeric:tabular-nums}
.q-deleted{margin-top:8px;color:var(--bad);font-weight:700;font-size:13px;text-align:center}
.q-push-seg button.on{background:var(--accent);color:#fff}
```

- [ ] **Step 2:** Verify with `preview_inspect` (cache-busted CSS): `.q-grid` is two tracks ≥760px, one ≤760px; `.q-sec.good` delta is the success colour.

- [ ] **Step 3: Commit**
```bash
git add ApexWeb/style.css
git commit -m "style(apexweb): quali dashboard grid + sector strip + push control"
```

---

### Task 8: README + final verification

**Files:** Modify `README.md`.

- [ ] **Step 1:** Update the quali section of `README.md` to describe the live sector lap (push per sector, lock-up/off→deleted), the track-knowledge gate, and the desktop dashboard; bump the test count.

- [ ] **Step 2:** Full non-sim suite: `cd ApexWeb && node --test $(ls tests/*.test.js | grep -v 'sim.test.js') 2>&1 | grep -E '^# (tests|pass|fail)'` → 0 fail.

- [ ] **Step 3:** Balance: `node tools/balance.mjs` → race/practice/quali corridors all in range; quali deletion-rate on target.

- [ ] **Step 4:** In-browser (cache-busted solo drive): release the car, watch the 3 sector deltas fill in live, change push (save/attack/max), see a deleted lap flash on a bad max-push run, controls stay clickable; 2-col layout on desktop.

- [ ] **Step 5: Commit**
```bash
git add ApexWeb/README.md
git commit -m "docs(apexweb): README — quali live sector lap + execution risk + desktop dashboard"
```

---

## After all tasks

Dispatch a final whole-implementation review, then summarise (work is on `main` with explicit pathspecs; push only when the owner asks). Owner F5 two-browser playtest is the only non-headless item; the 2-col layout needs a >760px viewport (the preview iframe is ~484px).
