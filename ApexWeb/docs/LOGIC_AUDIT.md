# Apex Web — Sim Logic Audit Brief

**Purpose.** A single self-contained description of the current race-simulation logic of *Apex Web* (a browser co-op F1 manager). Hand this to a reviewing agent to audit correctness, realism, balance, and design. It covers every mechanic with the actual formulas, constants, invariants, and current balance numbers, and ends with **open questions worth scrutiny**. File/function names are given so an agent with the repo can dig in; the formulas are reproduced so an agent without it can still critique.

**What to audit for:** physical/sporting realism, internal consistency, balance (does each lever matter, is anything dominant/dead), determinism safety, edge cases, and "is this the right model". Flag anything dubious; propose concrete changes with expected effects.

**Scope note.** One track (Barcelona-Catalunya), real 2026-style grid (11 teams / 22 drivers), 66 laps. Deterministic — same seed reproduces the race exactly (this underpins host-authoritative netcode and a Python/Node balance harness). The whole game is ~1700 lines of vanilla JS (ES modules), no build step.

---

## 1. Architecture & data flow

- **`sim.js` (`class Race`, ~300 LOC)** — the entire deterministic race core. Pure logic, no DOM. Advances by a fixed `STEP = 0.25 s` tick. This is the audit's main subject.
- **Pure helper modules** (each unit-tested): `tyres.js`, `fuel.js`, `track.js` (sectors/geometry), `overtake.js` (combat helpers + zones), `events.js` (safety-car schedule), `weather.js`, `team.js` (FM model generation), `ai_strategy.js`, `quali.js`, `setup.js`, `rng.js` (seeded LCG + `mix32`).
- **`data.js`** — all tunables as `const` tables (compounds, modes, attribute weights, event/SC/weather/difficulty constants, the track, the 22-car grid).
- **`main.js`** — host game loop + host-authoritative netcode. Only the host runs `Race`; it broadcasts state snapshots; clients render and send pace/engine/pit commands by RPC. The loop advances sim time by **real elapsed time** (`dt × speed × SIM_RATE`, `SIM_RATE = 4` → 1× ≈ 4× real-time, ~20 s/lap on screen; 2×/4× fast-forward).
- **`ui/race.js`** — the race screen: real SVG circuit minimap with smooth 60 fps car interpolation (renders ~120 ms behind the snapshot stream, lerps between buffered samples), driver labels, sector colouring, battle lines, a radio commentary feed.
- **Verification** — `node --test` (103 tests) + `tools/balance.mjs` (numeric balance corridors). No physics engine; correctness is by tests + corridors.

**Two RNG streams** (both seeded, deterministic): `rng` (per-tick pace/wear noise) and a separate **events `erng`** seeded via `mix32(seed)` (safety-car roll, weather arc, start launch, DNF rolls). Splitting them keeps consecutive race seeds from giving near-identical events.

---

## 2. The deterministic tick (`Race.step(dt=0.25)`)

Per tick, in order:
1. **First tick only:** `_standingStart()` (the launch, §9) + emit a `start` event.
2. Compute `wetness = wetnessAt(weather, leaderProgress)`.
3. **Per car** (skip retired): if in the pit box (`pitTimer>0`) drain the stop (§10) and `continue`; else `lapFrac += dt / _lapTime(car)`, accumulate lap time, and on `lapFrac ≥ 1` do lap-end bookkeeping: record mini-sectors, **fastest-lap** check/event, wear+fuel burn, tyre warm step, `_serveLapEnd` (pit + DNF).
4. **`_resolveCombat()`** (skipped under safety car) — wheel-to-wheel (§8).
5. **`_aiDrive()`** — AI engine/pace choice for non-human cars (§13).
6. Safety-car lifecycle (deploy/retract, §11), `_resolveSC()` bunching, SC on/off events.
7. Newly-retired cars → `dnf` events; if all cars retired-or-finished → `finished`, emit `finish`.

Each `_emit` only **reads** state and pushes a structured event to `this.events` (the commentary log); never writes sim state.

---

## 3. Clean lap-time model (`_lapTime(car)` → seconds)

Base `lt = 80.0`. Summed terms (negative = faster):

```
s  = 80.0
   − SKILL_K(7.0) · (attrs.pace − 0.5)                         // driver pace
   − CAR_K(1.2)  · (car.power − car.aero) · (track.pw − track.df)   // track-character bias; (pw−df)=0.55−0.82=−0.27 (AERO track)
   + COMPOUNDS[tyre].pace + tyreTerm(tyre, wear, tyreTemp)     // §5
   + weatherTerm(tyre, wetness) · (1.3 − ATTRW.wet(0.6)·attrs.wet)  // §12
   + PACE_MODES[pace].pace                                     // conserve +0.45 / balanced 0 / push −0.45
   + engineTerm(engine)                                        // save +0.35 / std 0 / push −0.30
   + weightTerm(fuel) = FUEL.weightK(0.020) · fuel             // heavy early, ~0 at the end
   + setupBonus (≤0)                                           // from the setup puzzle (closeness to a hidden ideal)
   + rng.noise(0.06) · (1.3 − ATTRW.noise(0.6)·attrs.consistency)   // per-tick noise, steadier for consistent drivers
   + [AI only, difficulty<1]:  (1−diff)·AI_HANDICAP(0.8) + car._aiForm + rng.noise((1−diff)·AI_NOISE(0.25))   // §13
   + [lap 0 only]:  car._launch                               // standing-start launch delta (§9)
s *= (scActive ? scPaceMult(1.40) : 1)                         // everyone slow under the safety car
```

`SKILL_K(7.0)` over the driver-pace spread is the dominant differentiator; `CAR_K(1.2)` adds car/track character. Note `rng.noise(amp)` returns a symmetric value in `[−amp,+amp]`; the per-tick noise is integrated over ~320 ticks/lap, so lap-to-lap variation is far smaller than ±0.06.

---

## 4. The grid, qualifying & the field

- **Quali** (`quali.js`): each car runs one flying lap on softs — `lt + COMPOUNDS.soft.pace − SKILL_K·(attrs.quali−0.5) − CAR_K·… + setupBonus − 0.35·risk + noise(0.08+0.45·risk)`, plus a `0.12·risk` chance of a `range(0.8,2.5)` mistake. Sorted fastest-first → the grid. **Quali uses `attrs.quali`, the race uses `attrs.pace`** — so "qualifiers vs racers" differ.
- **Grid placement** (`main.js startRaceHost`): car `slot` starts at `lapFrac = −slot · GRID_GAP(0.20)/lt`, i.e. spread by 0.20 s/slot (≈4.4 s P1→P22). `startPos` recorded for the +/- column. (Negative `lapFrac` is the one allowed exception to the §16 invariant.)

---

## 5. Tyres (`tyres.js`, compounds in `data.js`)

Compounds (`pace` s/lap vs medium, `wear` units/lap, `cliff` in wear-units, `warm` rate, `wet_opt`):
```
soft  −0.55  2.6  65  1.4  0.0      medium 0.00 1.7 78 1.0 0.0      hard +0.55 1.1 90 0.7 0.0
inter +0.30  1.9  70  1.1  0.5      wet   +0.50 1.6 75 1.0 0.9
```
- **Degradation** `tyreTerm`: below the cliff `deg = 0.040·wear·(1+0.5·wear/cliff)` (gently accelerating); past the cliff `deg = 0.040·cliff·1.5 + 0.32·(wear−cliff)` (steep). ~1.66 s/lap off a fresh medium at 20 laps.
- **Wear accrual** (per lap, in `step`): `wear += compound.wear · PACE_MODES[pace].wear · drvTyre · carTyre + dirtyWear`, where `drvTyre = 1 − ATTRW.wear(0.3)·(attrs.tyre−0.5)·2` (kinder driver, ±30%) and `carTyre = 1.2 − ATTRW.carWear(0.2)·car.tyre` (car 1.0 = neutral).
- **Warm-up** `warmStep`: temp eases toward 1 each lap by `compound.warm · TYRE.ease(0.5)·(1−temp)`. Cold penalty in `tyreTerm` = `(1−temp)·TYRE.warmPen(1.2)`. Start at `gridTemp 0.55`; leave the pits at `pitTemp 0.20` (cold out-lap → natural undercut). Soft warms fastest.

---

## 6. Fuel & engine modes (`fuel.js`)

- Start with `laps·(1+FUEL.margin 0.06)` lap-equivalents. Burn `ENGINE_MODES[mode].burn / car.fuel` per lap (save 0.85 / standard 1.0 / push 1.20). Empty tank → DNF.
- `weightTerm = 0.020 · fuel` s/lap (a full tank ≈ +1.4 s/lap early, fading to ~0).
- Engine pace offset: save +0.35 / std 0 / push −0.30 s/lap. So **push = faster now, burns more, may run dry**; the lever is a fuel↔pace trade.

---

## 7. Sectors & mini-sectors (`track.js`)

18 mini-sectors / 3 sectors derived from `TRACK_PATH` curvature (a per-mini `straightness` 0..1). `miniSplits(lapTime, car)` distributes a lap time across minis by the car's power(straights)/aero(corners) fit (`FIT_K 0.6`); the splits **sum exactly to the lap time** (display + the data combat samples). `sampleAt(lapFrac)` → `{mini, sector, straightness}` (used by combat for local track character).

---

## 8. Overtaking (`_resolveCombat`, helpers in `overtake.js`)

Per adjacent pair (leaders-first order), skipping retired or in-pit cars:
- **Dirty air:** a follower within `DIRTY_GAP(1.5 s)` accrues `dirtyWear(straightness) = DIRTY_WEAR(0.006)·(1−straightness)` into `_dirtyWear` (applied at lap-end). Worse in corners.
- **Close combat:** within `COMBAT_GAP(0.8 s)` on the same lap:
  - pace edge `edge = lapTime(ahead) − lapTime(me)` (>0 = me faster); tow `slipstream(straightness, me.car.power) = SLIP_K(0.25)·straightness·power` (straights only).
  - `me._passCredit += passAccrual(edge, tow, engine, straightness) · (0.7 + ATTRW.overtaking(0.6)·attrs.overtaking)`, where `passAccrual = (max(0,edge)+tow)·(push?1.3:1)·(0.5+straightness)`.
  - **Overtake zones (TODO #2b):** `zone = zoneFor(track.overtake_zones, mini)`. `resist = zone ? (1−zone.ease)·2.0·(0.7+ATTRW.defending(0.6)·ahead.attrs.defending) : Infinity`. Barcelona zones: minis [0,1,2] brake ease 0.55, minis [11,12] slip ease 0.45. **Outside a zone resist = ∞ → the follower stays pinned and credit keeps building ("the tow"); a pass completes only inside a zone.**
  - If `credit < resist`: pin behind (write only `lapFrac`, clamped ≥0). Else: pass completes (reset credit; emit a `pass` event with the zone type — suppressed while `lap===0` to avoid grid-settle spam).

**Invariant (load-bearing):** combat writes **only** `lapFrac` (and scratch fields), never `lap`/`wear`. Lap bookkeeping is phase-3's alone.

Current corridor: ~3.0 grid→finish places/car, ~27–37 passes/race, 100% in-zone.

---

## 9. Standing start (`_standingStart`, first tick)

Bounded launch shuffle, **applied as a lap-0 lap-TIME delta** `car._launch` (added in `_lapTime` while `lap===0`):
```
launch = (fieldMeanStarts − attrs.starts)·startLaunch(2.0) + erng.noise(startReact 0.30)   // seconds lost; good starter <0
launch = clamp(launch, −startCap(0.9), +startCap(0.9))
if erng.unit() < startP(0.02):  launch += startLoss(1.8);  if erng.unit()<startDnf(0.12): retire   // rare bog-down
car._launch = launch
```
Measured against the **field mean** so only the spread shuffles positions. Lap-1 reshuffle ≈ **2.58 places/car** (was wild before — the old model gave a flat 4 s penalty to ~1 car/race). The quali grid is otherwise respected. **It is applied to lap-time, not `lapFrac`, on purpose** — a raw negative `lapFrac` double-counts laps and breaks §16.

---

## 10. Pit stops (`_serveLapEnd` + the `step` freeze)

- Decision sets `pitPending` (player via RPC; AI via `ai_strategy`). At lap-end the tyre is fitted (`wear/tyreAge` reset, `tyreTemp = pitTemp 0.20`) and `pitTimer = track.pit(23.5) · (scActive?scPitMult 0.55:1) · personnel.pitMult`.
- **Freeze model:** while `pitTimer>0`, `step` drains it — race time passes, `lapTimeAccum`/`totalTime` accrue, **no `lapFrac` advance** — so the car sits in the box, rivals gain, and the out-lap shows ~+pit-loss (≈1:43). Combat skips in-pit cars. (This replaced a bug where `lapFrac -= pitLoss/lt` got clamped to 0 and the stop cost ≈0.)

---

## 11. Safety car (`events.js` + `_resolveSC`)

`scheduleSC(erng, track.sc 0.25, laps)` picks a deploy leader-lap (or none) — ~23% of races. While active: every `lapTime ×= scPaceMult 1.40`; combat suspended; `_resolveSC` bunches same-lap cars into a train `scTrainGap 0.6 s` apart (writes only `lapFrac`, forward-only); pits are cheaper (`scPitMult 0.55`). Retracts after `scMinLaps 3` leader-laps.

---

## 12. Weather (`weather.js`)

`scheduleWeather(erng, track.wet 0.30, laps)` → a dry→rise→hold→dry rain arc (or none); ~30–37% of races. `wetnessAt` gives 0..1 over the race. `weatherTerm(compound, wetness) = WET.mismatch(3.0)·|wetness − wet_opt| + (slick & wetness>0.4 ? WET.slick(8.0)·(wetness−0.4) : 0)`. Drives the slick↔inter↔wet crossover. In `_lapTime` it's scaled by the driver `wet` attribute. AI reacts (pits for inters/wets at wetness>0.55, back to slicks <0.35).

---

## 13. FM team model & AI (`team.js`, `ai_strategy.js`, difficulty)

- **13 driver attributes** (`team.js driverAttrs(abbrev, overall)`): pace, quali, tyre, overtaking, defending, consistency, composure, aggression, discipline, wet, starts, race_iq, smoothness — each `clamp01(overall + seededNoise(0.06) + signatureTrait)`. Generated around the driver's `overall` (the hand-set `skill`); star signatures (e.g. VER overtaking, HAM/ALO wet, LEC quali). **Wired** attrs: pace/quali/tyre/overtaking/defending/wet/consistency/starts/smoothness. **Carried but only used by the AI:** race_iq, composure, aggression, discipline.
- **5 car indicators** (`composeCar`): power, aero, reliability (rel), tyre, fuel — from the per-team `car` in `data.js`.
- **Personnel** (`genPersonnel(facility, seed)`): `pitMult` (0.75 great → 1.15 poor) and `strategy` (AI sharpness). Same for both of a team's drivers.
- **All attribute → sim influence is CENTERED** (attr 0.5 / car 1.0 = neutral) so an average grid reproduces the pre-attribute balance; only the spread widens.
- **AI strategy** (`ai_strategy.js`, for `player==null` cars): `planRace` picks a 1- or 2-stop plan (target laps + compounds) from estimated stint life, jittered by `personnel.strategy` and difficulty; `pitDecision` fires on weather crossover / safety-car opportunism / the planned lap / a cliff emergency; `engineMode`/`paceMode` manage fuel (save when short), attack (push chasing in clean air), and protect (conserve stuck in dirty air), gated by `race_iq × difficulty`.
- **Difficulty** (lobby `Лёгкая 0.55 / Обычная 0.80 / Сложная 1.0` → `Race.difficulty`): scales (a) a uniform AI pace handicap `(1−diff)·0.8`, (b) a **per-race form offset** `_aiForm` = seeded[−1,1]·(1−diff)·1.0 (a fixed whole-race swing that does NOT average out → real upsets at low difficulty), (c) per-lap AI noise `(1−diff)·0.25`, (d) the push gate and plan jitter. Easy → slower, sloppier, more varied; Hard → razor-sharp, dominant.

---

## 14. Lap-time precision (sub-step)

The sim ticks in 0.25 s, but the car crosses the line mid-tick. At lap-end: `carry = (lapFrac−1)·lt`, `lastLap = lapTimeAccum − carry`, `lapTimeAccum = carry` (the remainder seeds the next lap). So displayed lap times carry real milliseconds (not quantized to 0.25 s). Display-only for positions (`lapFrac`/`lap` unchanged) → determinism preserved.

---

## 15. Co-op, netcode, weekend flow

Two players co-direct one team and each engineer one car (pace/engine/pit). Weekend: Practice (a setup-finding puzzle) → Quali (risk-based flying lap) → Race. Host-authoritative: only the host runs `Race`; ~12 Hz snapshots carry per-car {pos, lap, lapFrac, tyre, wear, fuel, engine, pace, pitStops, tyreAge, tyreTemp, lastLap, inPit, retired} + race-level {scActive, wetness, finished, speed, new events}. Online via WebRTC P2P (PeerJS).

---

## 16. Load-bearing invariants (do not break)

1. **Determinism:** same seed (+difficulty) ⇒ identical race. No `Math.random`/`Date`/unordered-dict-iteration in the numeric path. Two seeded streams (`rng`, `erng`); attribute/form generation is seeded via `mix32`.
2. **Combat writes only `lapFrac`** (+ scratch), never `lap`/`wear`. Phase-3 lap-end owns all bookkeeping.
3. **`lapFrac ∈ [0,1)`** every tick — *except* the negative grid-start spread. Position/time costs (start launch, pit-loss) are modelled as lap-time or a freeze, **never** a raw negative `lapFrac` (that double-counts laps).

---

## 17. Current balance corridors (`tools/balance.mjs`, 40-race samples, default difficulty)

```
DNF/race            1.77   (target ~1-2)
pace spread         1.85 s/lap best→worst finisher (target ~1.5-2.5)
winners             ~4 distinct (top team McLaren dominant ~80%)
fuel run-outs       push-all-race 173 dry / standard 0
tyre deg            1.66 s/lap @20 laps medium
sectors             power car −0.88 s in the straight sector, +0.65 s in the twisty one
overtaking          ~3.0 grid→finish places/car; ~27-37 passes/race; 100% in-zone
safety car          ~0.23 of races (track.sc 0.25)
weather             ~0.37 of races rain; dry slick adv 2.7 s; wet adv in rain 6.0 s
start               2.58 |grid→lap1| places/car
strategy            AI 1.47 stops/race, mean stop lap ~35/66, 0 fuel run-outs
difficulty          easy 4-5 winners / DNF ~1.5 ; hard 2-4 winners / DNF ~1.8
```

---

## 18. Open questions / things to audit hardest

1. **Winner concentration.** The best car+driver+strategist+crew compound → McLaren wins ~80% at default. Realistic but flat for a game. Is the spread (`SKILL_K`, `CAR_K`, attribute generation) right? Should there be more car-vs-driver tension?
2. **`track.ot` is now dead.** With overtake zones, the non-zone branch returns `resist=∞`, so `track.ot` is computed but unused in combat. Vestigial — remove or repurpose? Are 2 manual zones (≈28% of the lap) the right coverage; does pace-edge → credit → zone-release feel right, or do passes still clump unrealistically?
3. **Start vs lap-1 chaos.** Launch is applied as a lap-0 time delta (spreads over the whole opening lap, not a T1 burst). Is 2.58 places/car too much / too little? Grid gaps are only 0.20 s/slot, so any time delta = big position swings — is the model sound, or should the opening lap "hold station" (bunched) with passing from lap 1?
4. **Pit realism.** Pit-loss is a full stationary freeze (~23.5 s on the out-lap). No in-lap slow-down, no pit-lane travel; the whole loss lands on the out-lap. Acceptable abstraction?
5. **Quali ≠ race pace.** `attrs.quali` vs `attrs.pace` differ by ≤~0.18 → up to ~1.3 s/lap; combined with tiny grid gaps this drives early movement. Intended texture or a balance hazard?
6. **Tyre model.** Deg curve coefficients (0.040 / 0.32) and cliffs (65/78/90) are hand-tuned, not data-derived (FastF1 can't isolate tyre pace). Are the 1-vs-2-stop economics right given the corrected 23.5 s pit-loss? Does the cold-out-lap undercut actually bite?
7. **Centered attribute wiring.** Every attribute effect is centered on its midpoint so the average is balance-neutral — does that under-power individual attributes (do drivers feel distinct enough)? `composure`/`aggression`/`discipline` are generated but unused by the sim (AI-only). Dead weight?
8. **Difficulty model.** Handicap + per-race form + per-lap noise + decision gates. Does Easy feel beatable-and-varied vs Hard dominant, or are the knobs muddled? Is the AI's 1.47-stop strategy actually good, or just adequate?
9. **Determinism surface.** Audit for any hidden non-determinism (iteration order feeding numbers, float accumulation drift over 66 laps × 22 cars × ~320 ticks).
10. **Single-track calibration.** `lt/pw/df` validated vs FastF1; `pit` corrected to 23.5 s; compounds kept manual. Multi-track would need real per-track constants (already extracted to `tools/track_constants_*.json`) + outlines.

---

*Generated 2026-06-12 from the live code. Constants live in `ApexWeb/src/data.js`; the core loop in `ApexWeb/src/sim.js`. Run `node --test` (103 tests) and `node tools/balance.mjs` (corridors) from `ApexWeb/`.*
