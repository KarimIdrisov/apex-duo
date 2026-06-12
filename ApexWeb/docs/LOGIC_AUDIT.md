# Apex Web — Sim Logic Audit Brief

> ## ▶ For the reviewing agent (read first)
> **You are a senior motorsport-simulation engineer reviewing this race engine.** Audit it for: physical/sporting **realism**, **balance** (does every lever matter; is anything dominant or dead), internal **consistency**, **determinism** safety, and **edge cases** — and judge "is this the right *model*", not just "is the code correct".
>
> **Return your findings as a list**, each item with:
> - **severity** — `critical` (breaks correctness/determinism/an invariant) · `major` (clear realism/balance flaw) · `minor` (polish);
> - **location** — the file/function/§ it concerns (e.g. `sim.js _resolveCombat` / §8);
> - **finding** — what's wrong or weak, with the reasoning;
> - **proposed change** — concrete, with the **expected effect on the balance corridors** in §17.
>
> Prefer specific, testable proposals over general advice. If you think a mechanic is fine, say so explicitly. **Before flagging something, check §16 (invariants), §18 (already-considered trade-offs), and §19 (strengths to preserve)** so you don't propose something that breaks a load-bearing rule or that's already been weighed and rejected.
>
> **Severity calibration (apply strictly):** `critical` is reserved for things that **break correctness, determinism, or a §16 invariant**. A balance/realism imperfection — even an important one like winner concentration or dirty-air-pace — is **`major`**, not critical (the sim still runs correctly and reproducibly). Prior reviewers have inflated balance issues to "critical"; don't.
>
> **⚙ State as of 2026-06-13 — audit the NEW engine.** A **§18 priority pass shipped** (commits `d7c47c0..32c8ddf`): items §18.1 (absolute car-pace term + driver compression + per-race form), §18.13 (slipstream tow-gate + credit cap/decay), §18.11 (dirty-air pace penalty), §18.3 (opening-lap caution + wider grid), §18.7 (composure/aggression/discipline wired), and §18.2 (bold out-of-zone lunge) are now **✅ DONE** — each marked inline in §18 with the implemented formula and before/after numbers. **Review the current behaviour**, and feel free to challenge the *new* tuning (the constants are first-pass calibrations, not sacred). The one big **OPEN** item remaining is the winner-concentration *residual* (§18.1: McLaren ~95% is grid-data, not the model).

**Purpose.** A single self-contained description of the current race-simulation logic of *Apex Web* (a browser co-op F1 manager). It covers every mechanic with the actual formulas, constants, invariants, and current balance numbers, and ends with **open questions worth scrutiny**. File/function names are given so an agent with the repo can dig in; the formulas are reproduced so an agent without it can still critique. All formulas below were verified 1:1 against the live code (2026-06-13, after the §18 priority pass).

**Scope note.** One track (Barcelona-Catalunya), real 2026-style grid (11 teams / 22 drivers), 66 laps. Deterministic — same seed reproduces the race exactly. The whole game is ~1700 lines of vanilla JS (ES modules), no build step.

> **⚠ Two things reviewers consistently misread — don't:**
> 1. **There is no host/client desync risk.** The netcode is **host-authoritative: only the host runs the sim**; clients render the host's broadcast snapshots and never simulate. So determinism is needed only for *harness reproducibility*, and float-point drift cannot cause a multiplayer desync (there is only one authority). The drift is itself deterministic (same seed → same drift → same result).
> 2. **Overtake zones are not "traffic jams".** Outside a zone a follower is held only ~0.4 s back (a pin, not a glue), and a pass completes inside a zone — which recurs every **~28% of the lap**. So a faster car passes within roughly a lap; it just has to wait for the braking/slip zone, exactly like a real "you can't pass here, wait for Turn 1" situation.

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
   − SKILL_K(4.5) · (attrs.pace − 0.5)                         // driver pace
   − CAR_PACE_K(9.0) · ((car.power + car.aero)/2 − fieldMean)  // ABSOLUTE car performance (§18.1 — implemented 2026-06-13)
   − CAR_K(1.2)  · (car.power − car.aero) · (track.pw − track.df)   // track-character bias; (pw−df)=0.55−0.82=−0.27 (AERO track)
   + COMPOUNDS[tyre].pace + tyreTerm(tyre, wear, tyreTemp)     // §5
   + weatherTerm(tyre, wetness) · (1.3 − ATTRW.wet(0.6)·attrs.wet)  // §12
   + PACE_MODES[pace].pace                                     // conserve +0.45 / balanced 0 / push −0.45
   + engineTerm(engine)                                        // save +0.35 / std 0 / push −0.30
   + weightTerm(fuel) = FUEL.weightK(0.020) · fuel             // heavy early, ~0 at the end
   + setupBonus (≤0)                                           // from the setup puzzle (closeness to a hidden ideal)
   + rng.noise(0.06) · (1.3 − ATTRW.noise(0.6)·attrs.consistency)   // per-tick noise, steadier for consistent drivers
   + car._form   (= seeded[−1,1]·RACE_FORM(0.15))             // per-RACE form, EVERY car: off/on weekend (§18.1)
   + [AI only, difficulty<1]:  (1−diff)·AI_HANDICAP(0.8) + car._aiForm + rng.noise((1−diff)·AI_NOISE(0.25))   // §13
   + [lap 0 only]:  car._launch                               // standing-start launch delta (§9)
s *= (scActive ? scPaceMult(1.40) : 1)                         // everyone slow under the safety car
```

`fieldMean` = the field's mean `(power+aero)/2`, fixed for the race (`Race.carMean`). The driver term (`SKILL_K 4.5`, compressed from 7.0) and the **absolute car term** (`CAR_PACE_K 9.0`) now contribute **comparable** spreads (~1.0 s/lap each across the real grid) — the car is **co-primary** with the driver (was ~24:1 driver-dominant; see §18.1). `CAR_K(1.2)` adds the power-vs-aero track character on top. `car._form` is a fixed per-race offset on *every* car (seeded, decorrelated from `_aiForm`) — realistic race-to-race variance. Note `rng.noise(amp)` returns a symmetric value in `[−amp,+amp]`; the per-tick noise is integrated over ~320 ticks/lap, so lap-to-lap variation is far smaller than ±0.06.

---

## 4. The grid, qualifying & the field

- **Quali** (`quali.js`): each car runs one flying lap on softs — `lt + COMPOUNDS.soft.pace − SKILL_K·(attrs.quali−0.5) − CAR_PACE_K·((power+aero)/2−carMean) − CAR_K·… + setupBonus − 0.35·risk + noise(0.08+0.45·risk)`, plus a `0.12·risk·(composure factor)` chance of a `range(0.8,2.5)` lock-up. Sorted fastest-first → the grid. **The absolute car-pace term (§18.1) shapes the grid like the race** (a better car qualifies better); **quali uses `attrs.quali`, the race uses `attrs.pace`** — so "qualifiers vs racers" differ; **`composure` cuts the lock-up chance** (§18.7).
- **Grid placement** (`main.js startRaceHost`): car `slot` starts at `lapFrac = −slot · GRID_GAP(0.25)/lt`, i.e. spread by 0.25 s/slot (≈5.5 s P1→P22; widened from 0.20 in §18.3 so a launch delta causes fewer swaps). `startPos` recorded for the +/- column. (Negative `lapFrac` is the one allowed exception to the §16 invariant.)

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

- Start with `laps·(1+FUEL.margin 0.06)` lap-equivalents. Burn `ENGINE_MODES[mode].burn / car.fuel` per lap (save 0.85 / standard 1.0 / push 1.20). **`car.fuel` is a fuel-*efficiency* scalar (1.0 = neutral, >1 = more efficient → burns less); it is NOT a tank size or the remaining fuel.** Empty tank (`fuel ≤ 0`) → DNF (fuel starvation).
- `weightTerm = 0.020 · fuel` s/lap (a full tank ≈ +1.4 s/lap early, fading to ~0).
- Engine pace offset: save +0.35 / std 0 / push −0.30 s/lap. So **push = faster now, burns more, may run dry**; the lever is a fuel↔pace trade.

---

## 7. Sectors & mini-sectors (`track.js`)

18 mini-sectors / 3 sectors derived from `TRACK_PATH` curvature (a per-mini `straightness` 0..1). `miniSplits(lapTime, car)` distributes a lap time across minis by the car's power(straights)/aero(corners) fit (`FIT_K 0.6`); the splits **sum exactly to the lap time** (display + the data combat samples). `sampleAt(lapFrac)` → `{mini, sector, straightness}` (used by combat for local track character).

---

## 8. Overtaking (`_resolveCombat`, helpers in `overtake.js`)

Per adjacent pair (leaders-first order), skipping retired or in-pit cars:
- **Dirty air:** a follower within `DIRTY_GAP(1.5 s)` takes both (1) extra wear `dirtyWear(straightness) = DIRTY_WEAR(0.006)·(1−straightness)` into `_dirtyWear` (applied at lap-end) and (2) a **pace loss** `_dirtyPace = DIRTY_PACE_K(0.8)·(1−straightness)` added to its lap time (≈0.64 s/lap in the twisty sector; §18.11, implemented 2026-06-13). Both worse in corners; `_dirtyPace` is reset every green tick and cleared under the SC. Following is genuinely hard — but the straight-line tow still lets a faster car attack.
- **Close combat:** within `COMBAT_GAP(0.8 s)` on the same lap:
  - pace edge `edge = lapTime(ahead) − lapTime(me)` (>0 = me faster); tow `slipstream(straightness, me.car.power) = SLIP_K(0.25)·straightness·power` (straights only).
  - `me._passCredit = min(_passCredit·PASS_CREDIT_DECAY(0.97) + passAccrual(edge, towEff, engine, straightness)·(0.7 + ATTRW.overtaking(0.6)·attrs.overtaking), PASS_CREDIT_CAP(2.5))`, where `passAccrual = (max(0,edge)+towEff)·(push?1.3:1)·(0.5+straightness)` and **`towEff = tow·clamp(edge/EDGE_REF(0.35), 0, 1)`** — the tow now AMPLIFIES a real pace edge (it can't build a pass from nothing) and credit is **capped + decayed** so a whole straight of draft can't be banked and cashed in one tick (the verified over-power, fixed 2026-06-13; §18.13).
  - **Overtake zones (TODO #2b):** `zone = zoneFor(track.overtake_zones, mini)`. `resist = zone ? (1−zone.ease)·2.0·(0.7+ATTRW.defending(0.6)·ahead.attrs.defending) : Infinity`. Barcelona zones: minis [0,1,2] brake ease 0.55, minis [11,12] slip ease 0.45. **Outside a zone resist = ∞ → the follower stays pinned and credit keeps building ("the tow"); a pass completes only inside a zone.**
  - If `credit < resist`: pin behind (write only `lapFrac`, clamped ≥0). Else: pass completes (reset credit; emit a `pass` event with the zone type — suppressed while `lap===0` to avoid grid-settle spam).
  - **Bold out-of-zone lunge (§18.2):** outside a zone, if the follower is `>AGGR_PASS_EDGE(1.0)` s/lap faster, has `aggression ≥ AGGR_PASS_ATTR(0.70)`, and **hasn't already tried this rival** (`_aggrTried`, one shot per car-ahead — anti-spam), it rolls a bold move with `p = track.ot·AGGR_PASS_K(1.6)·(0.5+aggression)·clamp((edge−1)/AGGR_PASS_REF(1.0))`. On success it nips just ahead (`lapFrac = ahead.lapFrac + small`, guarded `<1` so combat never writes `lap`), emitting a `zone:"bold"` pass. On failure, an `AGGR_PASS_DNF(0.02)` chance of contact → DNF. Measured: **~0.95 bold passes/race, DNF stays ~1.7** (the one-shot-per-rival key is essential — a time cooldown allowed hundreds of risky attempts and pushed DNF to ~8).

**Not a traffic jam.** The pin only holds the follower `COMBAT_GAP·0.5 ≈ 0.4 s` behind — it keeps building credit ("getting the tow"), and a zone recurs every ~28% of the lap, so a genuinely faster car clears the car ahead within roughly a lap. `resist = ∞` outside a zone is the mechanism for "you can't pass *here*; wait for the braking zone", not "you can never pass". (A reviewer who reads `∞` as a permanent block has missed the zone cadence.)

**Invariant (load-bearing):** combat writes **only** `lapFrac` (and scratch fields), never `lap`/`wear`. Lap bookkeeping is phase-3's alone.

Current corridor: ~2.7 grid→finish places/car, **~23 passes/race**, 100% in-zone. (Passes dropped from ~34 after the §18.13 tow-gate removed the artificial equal-car draft swaps; the remainder are genuine pace-edge passes.)

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

- **13 driver attributes** (`team.js driverAttrs(abbrev, overall)`): pace, quali, tyre, overtaking, defending, consistency, composure, aggression, discipline, wet, starts, race_iq, smoothness — each `clamp01(overall + seededNoise(0.06) + signatureTrait)`. Generated around the driver's `overall` (the hand-set `skill`); star signatures (e.g. VER overtaking, HAM/ALO wet, LEC quali). **Wired** attrs: pace/quali/tyre/overtaking/defending/wet/consistency/starts/smoothness, plus (§18.7) **composure** (bog-down + quali lock-up chance), **aggression** (pass-credit), **discipline** (dirty-air wear). **Carried but only used by the AI:** race_iq.
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

1. **Determinism:** same seed (+difficulty) ⇒ identical race. No `Math.random`/`Date`/unordered-dict-iteration in the numeric path. Two seeded streams (`rng`, `erng`); attribute/form generation is seeded via `mix32`. **Why it matters:** *only* the harness/replay reproducibility — **not** multiplayer sync (the host is the sole simulator, see §15). Float-point accumulation is fine: `lapFrac` is reset (`-= 1`) every lap (it never accumulates across the race), and any drift is itself deterministic, so it can't desync anything.
2. **Combat writes only `lapFrac`** (+ scratch), never `lap`/`wear`. Phase-3 lap-end owns all bookkeeping. **Two sanctioned exceptions in `_resolveCombat` (§18.2 bold lunge, 2026-06-13):** on a successful bold pass it writes `lapFrac = ahead.lapFrac + small` (guarded `< 1`, so still never `lap`); on a failed bold lunge it may set `retired = true` (an on-track contact — the only place combat retires a car). Both are deterministic (`erng`-rolled) and don't touch `lap`/`wear`. Keep any future combat additions to `lapFrac`/scratch/this one DNF path.
3. **`lapFrac ∈ [0,1)`** every tick — *except* the negative grid-start spread. Position/time costs (start launch, pit-loss) are modelled as lap-time or a freeze, **never** a raw negative `lapFrac` (that double-counts laps). The §18.2 bold-pass nip is guarded `< 1` so it preserves this.

---

## 17. Current balance corridors (`tools/balance.mjs`, 40-race samples, default difficulty)

```
DNF/race            1.80   (target ~1-2)   ← incl. ~0.1 from the §18.2 bold-lunge contact risk
pace spread         2.25 s/lap best→worst finisher (target ~1.5-2.5)   ← wider since the car-pace term (§18.1) added a real car axis
winners             3 distinct drivers (NOR 30 / PIA 8 / RUS 2 over 40); top TEAM McLaren ~95%  ← grid-data dominance (best car + both top drivers); see §18.1
fuel run-outs       push-all-race ~171 dry / standard 0
tyre deg            1.66 s/lap @20 laps medium
sectors             power car −0.88 s in the straight sector, +0.65 s in the twisty one
overtaking          ~2.7 grid→finish places/car; ~26 passes/race (incl. ~0.95 bold out-of-zone, §18.2); rest in-zone
safety car          ~0.23 of races (track.sc 0.25)
weather             ~0.37 of races rain; dry slick adv 2.7 s; wet adv in rain 6.0 s
start               2.15 |grid→lap1| places/car   ← calmer since the tow-gate also throttles lap-1 draft swaps (§18.13/§18.3)
strategy            AI 1.48 stops/race, mean stop lap ~35/66, 0 fuel run-outs
difficulty          easy 3 winners / DNF ~1.9 ; hard 2 winners / DNF ~1.8 (easy ≥ hard variety holds; high-variance over 40 races)
```
*(Updated 2026-06-13 after the §18 priority pass: §18.1 (car-pace `CAR_PACE_K 9.0`, `SKILL_K 4.5`, `RACE_FORM 0.15`), §18.13 (tow-gate + credit cap/decay), §18.11 (dirty-air pace `DIRTY_PACE_K 0.8`), §18.3 (lap-1 caution + `GRID_GAP 0.25`), §18.7 (composure/aggression/discipline wired), §18.2 (bold out-of-zone lunge). 110 node tests green; DNF ~1.7, bold ~0.95/race.)*

---

## 18. Open questions / things to audit hardest

Each item carries our current **stance** (as of 2026-06-13, after a first review pass) so you don't re-propose something already weighed. `→ PLANNED` = we intend to do it; `→ REJECTED` = considered and declined, with the reason; `→ OPEN` = genuinely undecided, dig in.

1. **✅ DONE (2026-06-13) — car is now co-primary; driver≫car inversion FIXED. Residual: winner concentration is grid-data, not the model.**
   - **Implemented:** absolute car-pace term `−CAR_PACE_K(9.0)·((power+aero)/2 − Race.carMean)` in `_lapTime`; `SKILL_K 7.0→4.5` (compress driver); `RACE_FORM(0.15)` per-race form on *every* car. Verified: car spread ≈ driver spread (~1.0 s/lap each) — the 24:1 driver-dominance is gone; a better car is now genuinely faster on any track (new test `better car … laps faster`). Corridors held (§17): DNF 1.75, spread 2.24, 104 tests green.
   - **Residual (known, NOT a model bug):** McLaren still wins ~95-100%. This is **grid-data dominance** — McLaren has the best car *and* both top-2 drivers (Norris/Piastri), so it leads on every axis; it already won ~95% at baseline (before the car term). `RACE_FORM` adds race-to-race texture but a ±0.15 form can't overturn a ~0.3 s/lap package edge on *both* their cars. **Genuine championship variety needs a separate lever** (not this task): rebalance the `TEAMS` grid so the top team isn't uniformly best, a bigger difficulty-scaled "car day" handicap, or accepting realistic single-team dominance (cf. 2023 Red Bull). → **OPEN (follow-up):** grid-data variety pass.
   - **Historical context (the original finding, now resolved):** McLaren won ~80-95% at default. **Measured** (over the real grid, `node` sensitivity check): the **car contributed only a ±0.065 s/lap spread** to lap time while the **driver-skill spread was ~1.57 s/lap → a 24:1 ratio.**
   - **Why (structural, not just "linear"):** the only car term in `_lapTime` is `−CAR_K·(power−aero)·(pw−df)` — a *track-character bias* on the power-vs-aero **difference**, **not** an absolute car-performance term. So a car with power=aero=0.99 and one with power=aero=0.50 lap *identically*. The 5 Phase-7 car indicators are therefore nearly **pace-inert** (power/aero also feed the sector-split distribution, but those sum back to the same lap time; and tyre/fuel/reliability). **The "monopoly" is driver-skill concentration (McLaren = the top-2 drivers), not the car.** "Best car wins" is effectively false in the current model.
   - **Calibration target (industry):** real F1 is **car-dominant** (~60–80% car / 20–40% driver); our model is **inverted** (~90% driver). For a *manager* game the car is the player's R&D project, so car-significance is doubly desirable. Aim to flip the ratio so the **car is at least co-primary** (car ≈ driver, or car-primary), not a rounding error. (Independently confirmed: 3 separate numerical reviews land on driver:car ≈ 17–25×.)
   - → **✅ DONE:** the **absolute car-pace term** `−CAR_PACE_K(9.0)·((car.power + car.aero)/2 − fieldMean)` is in `_lapTime`, with `SKILL_K 7.0→4.5`. Car spread ≈ driver spread (~1.0 s/lap each) — co-primary. (A `sqrt` diminishing-return on the driver term was considered but unneeded — the linear compression landed the corridor.)
   - → **CONSIDERED (variance lever):** our per-lap *tick* variance (~0.05–0.15 s) is still low vs the genre, but the per-race **form** offset (below) now supplies race-to-race variance. Further raising tick noise is available if races still feel too deterministic; tune against the §17 spread/winners corridors so it doesn't become "blind luck".
   - → **✅ DONE:** a **per-race "form" offset `RACE_FORM(0.15)` to *every* car each race** (`car._form`, seeded, decorrelated from `_aiForm`) — realistic "off-weekend for anyone". It adds field-wide race-to-race variance (midfield order shifts) but, as measured, a ±0.15 swing does **not** overturn McLaren's structural package edge — that's the grid-data residual noted above, not a form-tuning miss.
   - → **REJECTED:** an `interaction = MIX_K·pace·car_quality` term — a *positive* pace×car interaction *amplifies* the best package (more domination), the opposite of the goal.
   - → **REJECTED:** making top teams *less reliable* — anti-realistic (real top teams are *more* reliable) and it undercuts the "best car" fantasy.
   - → **OPEN:** whether to also make `setupBonus` a bigger player lever (helps the human, not AI-vs-AI spread).
2. **✅ DONE (2026-06-13) — `track.ot` repurposed as the bold-lunge base.** Implemented the aggressive out-of-zone pass (see §8): gated on `edge>1.0` + `aggression≥0.70` + **one shot per rival-ahead** (`_aggrTried`), with `track.ot·AGGR_PASS_K` success and an `AGGR_PASS_DNF(0.02)` contact risk on failure. Instantaneous (a guarded `lapFrac` nip just ahead — never writes `lap`), no credit banking. Validated: **~0.95 out-of-zone passes/race, DNF ~1.7** (in the §17 corridor). **Key lesson (the anti-spam was load-bearing):** an early *time* cooldown allowed hundreds of attempts over a multi-thousand-second race → DNF ~8; switching to **one-shot-per-rival** fixed it. *Original:* with overtake zones the non-zone branch returned `resist=∞`, so `track.ot` was computed but unused.
   - **We agree the hard `∞` reads as too "gamey"** (multiple reviewers flag it) — hence the gated aggressive pass above. But the *flat* fixes proposed don't work:
   - → **REJECTED:** a *general* finite out-of-zone `resist` (e.g. 2.5–3.5) or a time-decaying one. **Trap:** pass-credit *accumulates* while in `COMBAT_GAP` (it's only reset when the follower drops out of range), so any finite out-of-zone resist is beaten within a lap or two → passes happen everywhere → zones become meaningless.
   - → **REJECTED:** a flat per-tick `random_pass_chance` (~0.01–0.03) outside zones — over the dozens of ticks a follower spends in range, the cumulative probability is high → frequent out-of-zone passes, eroding zones the same way. (A *low per-attempt* chance gated on a real pace edge is fine — that's the aggressive pass.) The fix that works keeps credit un-accumulated outside zones and requires an *instantaneous* big edge.
   - → **OPEN (deterministic-pass guarantee):** because credit *accumulates* and a zone always recurs, a faster car is *guaranteed* to pass eventually — there's no probabilistic defence (a defender can never "hold" a faster car over a stint). Real racing has `P(pass) < 1`. Consider a **defence roll** at the release moment — e.g. `P(complete) = sigmoid(credit − resist + defenderSkillTerm)` — so a strong defender (`attrs.defending`/`composure`) sometimes repels even a faster car, and the pass isn't a certainty. Adds drama; must stay bounded so it doesn't create permanent road-blocks. (Keep the credit *core* — §19 — this only changes the release from a hard threshold to a gated roll.)
3. **✅ DONE (2026-06-13) — opening-lap caution + wider grid.** Implemented `LAP1_CAUTION(0.4)` (pass-credit ×0.4 while `lap===0` — the field settles the launch/grid order through T1, racing opens lap 1) and `GRID_GAP 0.20→0.25`. The start metric was **already in-corridor (~2.2)** after the §18.13 tow-gate calmed lap-1 draft swaps, so this is a *reinforcement* (robustness + "racing opens lap 1" correctness), not a big mover — as §18.3 intended, the launch shuffle (§9) is kept; only lap-1 combat is throttled. Sorting still happens (metric ~2.2, not frozen). *Original note:* Launch is a lap-0 time delta; 2.58 places/car reshuffle; grid gaps were only 0.20 s/slot so any time delta = big swings.
   - → **ALT/COMPLEMENT (considered):** temporarily widen `COMBAT_GAP` (≈0.8→1.2 s) in the first few mini-sectors of lap 1 — models the physical T1/chicane bottleneck where cars can't attack *regardless* of credit. Cleaner "first-corner caution" than only throttling accrual.
   - **Nuance:** the metric won't (and shouldn't) drop near 0 — some pace-vs-quali sorting *is* desirable (a racer with race-pace above his quali should climb). The goal is to kill the *opening-lap* spike, not to freeze the quali order for the whole race. A reviewer noting "this just delays the sorting to lap 2" is right that the underlying pace-sort persists by design; we're only smoothing the first-lap burst.
4. **Pit realism.** Pit-loss is a full stationary freeze, and the **out-lap is already slow** (cold tyres, `tyreTemp = pitTemp 0.20` → `tyreTerm` cold penalty). So the model is freeze + cold-out-lap; there's no *in-lap* slow-down.
   - → **LOW-PRIORITY (open):** split a little of the loss onto the in-lap (lift for the pit entry) for richer in/out-lap undercut timing — even without pit-lane geometry. Valid but small; the freeze + cold-out-lap already give a working undercut.
   - → **REJECTED:** a dedicated `inLapPush` multiplier — the existing engine/pace push modes already let a player push the in-lap, so it's near-duplicate.
5. **Quali ≠ race pace.** `attrs.quali` vs `attrs.pace` differ by ≤~0.18 → up to ~0.8 s/lap (smaller now that `SKILL_K` is 4.5); with the wider grid this drives early movement. → **OPEN:** intended "qualifiers vs racers" texture or a balance hazard? (Partly mitigated now that §18.3's cautious lap 1 is shipped.)
6. **Tyre model.** Deg coefficients (0.040 / 0.32) and cliffs (65/78/90) are hand-tuned, not data-derived (FastF1 can't isolate tyre pace). → **OPEN:** are the 1-vs-2-stop economics right at the corrected 23.5 s pit-loss? Does the cold-out-lap undercut actually bite? (High-value to verify.)
7. **✅ DONE (2026-06-13) — composure/aggression/discipline now wired (were AI-only).** All three are centered (average = neutral, only the spread widens): **composure** scales the bog-down prob (`_standingStart`) and the quali lock-up prob (`quali.js`) by `(1 − ATTRW.composure(0.5)·(comp−0.5)·2)`; **aggression** scales pass-credit by `(1 + ATTRW.aggression(0.4)·(aggr−0.5)·2)` in `_resolveCombat` (and will power §18.2's out-of-zone move); **discipline** scales dirty-air wear by `(1 − ATTRW.discipline(0.4)·(disc−0.5)·2)`. Verified by 3 new tests (aggression→more credit, discipline→less dirty-air wear, composure→fewer lock-ups). Corridors held (centered → neutral on the flat field). Only `race_iq` remains AI-only. *Original:* attribute effects are *centered* — do drivers feel distinct enough? `composure`/`aggression`/`discipline` were generated but unused by the sim (AI-only).
8. **Difficulty model & AI "cleanliness".** Handicap + per-race form + per-lap noise + decision gates. → **OPEN:** does Easy feel beatable-and-varied vs Hard dominant? The AI is **deterministically optimal** in strategy (its 1.47-stop calls never *misfire*, and it reacts to race *state* but not specifically to the player — e.g. it won't actively cover a player undercut). Consider **difficulty-scaled strategic mistakes** (an occasional mistimed/skipped stop at low difficulty) and light player-reactive logic, so the AI feels less robotic. Distinguish "smart" from "frozen-optimal".
9. **Determinism surface.** → **PLANNED:** add a stronger lock — run a fixed seed N times and assert an identical **hash of the final state**. → **REJECTED:** normalizing `lapFrac % 1` "to avoid drift" — unnecessary (`lapFrac` is reset every lap, never accumulates) and drift can't desync anything (host-authoritative; see §16.1 / the top warning).
10. **Single-track calibration.** `lt/pw/df` validated vs FastF1; `pit` corrected to 23.5 s; compounds kept manual. → **OPEN/FUTURE:** multi-track needs real per-track constants (already extracted to `tools/track_constants_*.json`) + per-track outlines.
11. **✅ DONE (2026-06-13) — dirty air now cuts pace, not just wear.** Added `_dirtyPace = DIRTY_PACE_K(0.8)·(1−straightness)` to the follower's lap time while within `DIRTY_GAP` (≈0.64 s/lap in the twisty sector, in the real 0.5–1.5 s/lap band), reset every green tick, cleared under the SC. Verified: a follower in dirty air laps slower (new test); the straight-line tow still lets a faster car attack (passes held 22/race). Side-benefit observed: **easy-mode winner variety rose (4→5)** — midfield cars stuck in traffic lose pace, adding the variance §18.11 predicted. Corridors held (DNF 1.73, spread 2.30). *Original (now resolved):* following within `DIRTY_GAP` added only tyre *wear* (`_dirtyWear`); in reality lost downforce also costs *pace* (worse in corners). → add `lapTime += DIRTY_PACE_K·(1−straightness)` while in dirty air. This makes following genuinely hard (the follower's pace edge shrinks), the undercut more valuable (clean air after a stop), and — paired with the straight-line slipstream tow — gives realistic "hard to follow, but you get the tow on the straight" dynamics. It also indirectly **eases the §18.1 monopoly** (midfield cars stuck in traffic lose pace, adding variance). Needs careful tuning so passing doesn't become *too* hard (the slipstream must still let a faster car attack). **Suggested start `DIRTY_PACE_K ≈ 0.8`** (~0.4 s/lap lost in the twisty sector while following — in line with the real 0.5–1.5 s/lap dirty-air loss — with the straight-line tow still compensating). Pairs naturally with §18.13 (tow gated on edge): hard to follow in the corners, but the tow lets a genuinely faster car attack on the straight.
12. **Smaller observations.** → **OPEN/minor:** `GRID_GAP` is now `0.25 s` (raised from 0.20 in §18.3). Fuel has no explicit lift-and-coast / safety-margin behaviour (the engine `save` mode is a coarse stand-in). Weather wetness is **uniform across the track** (no sector-local rain) — a realistic but larger future addition.
13. **✅ DONE (2026-06-13) — slipstream tow over-power FIXED.** Implemented both parts: (a) **tow gated on a real edge** — `towEff = tow·clamp(edge/EDGE_REF(0.35),0,1)` in `passAccrual`, so the draft amplifies a pace edge and a slower/equal car can't pass on the tow alone (new unit test); (b) **credit capped + decayed** — `_passCredit = min(_passCredit·0.97 + accrual, 2.5)` in `_resolveCombat`, so a whole straight of draft can't be banked and cashed in one tick. Effect (measured): passes/race **34 → 23** (the removed ~11 were the artificial equal-car swaps), grid→finish **3.2 → 2.7 places/car**, lap-1 shuffle **2.88 → 2.16** (the tow-gate also calms the opening lap), in-zone still 100%, DNF 1.55 / spread 2.25 / easy 4 winners > hard 2. 105 tests green. *Original finding (now resolved) below:*
   - `passAccrual = (max(0,edge) + tow)·push·(0.5+straightness)` let the **tow alone** build credit — even at `edge ≤ 0` (equal or slower pace). **Measured** in a brake zone: tow ≈ `SLIP_K(0.25)·straightness(0.8)·power(0.95)` ≈ 0.19/tick → credit ≈ `(0+0.19)·(0.5+0.8)·(0.7+0.6·overtaking)` ≈ 0.29/tick; against `resist ≈ 1.06` that's **~3.7 ticks ≈ 0.9 s → a pass with no pace advantage.** Risk: equal-pace cars swap positions every zone (artificial). **Mitigating context:** the overall pass corridor (27–37/race, ~3 places/car) shows it isn't currently catastrophic — a slower car can't *stay* pinned (the pin only pushes back, never pulls forward), and per-tick noise keeps `edge` off exactly 0 — so it self-limits. Hence **major (realism), not critical.**
   - **Sharper root — credit *banking* (verified):** `_passCredit` has **no cap and no decay**; it's reset only when the follower leaves `COMBAT_GAP` or completes a pass. So a car drafting the full main straight (~48 ticks) **banks ~13.6 credit** before reaching the T1 brake zone, where `resist ≈ 0.9` — the pass then completes in **~1 tick on zone entry**, even for a car that's *slower in the corners* (it just needs straight-line draft). The issue isn't only the per-tick tow magnitude; it's unbounded accumulation.
   - → **PROPOSED (two parts):** (a) make the tow *amplify a real edge* rather than create a pass from nothing — `tow_eff = tow · clamp(edge/EDGE_REF, 0..1)` (require some positive `edge` to convert). **Do NOT** hard-zero the tow at `edge ≤ 0` — that kills the realistic draft pass of an equal car, which *should* be possible, just not instantly. (b) **cap and/or decay `_passCredit`** (e.g. clamp to ~2×max-resist, bleed a fraction each corner) so it can't be banked over a whole straight and cashed in one tick. Tune so a tow pass of a near-equal car takes a few zones (laps), not one; re-check the §17 overtaking corridor.

---

## 19. Strengths — keep, don't "fix"

Independent reviews repeatedly flagged these as the model's load-bearing strengths. **Do not "improve" them away** — proposals that weaken any of these are regressions, not fixes:
- **Determinism** (§16.1) — full seed-reproducibility; rare to get right. Untouchable.
- **Split RNG streams** (`rng` per-tick vs `erng` for events) — keeps consecutive race seeds from giving near-identical events; a deliberate, correct choice.
- **Tyre cliff** (§5) — the accelerating curve + hard cliff is what makes stint length and the undercut matter. Good model.
- **Credit-based overtaking** (§8) — pace-edge → accruing pass-credit → release is a strong, emergent model (vs random or instantaneous passes). Now gated by zones **with the §18.2 bold-lunge as the escape valve** for the rare "can't pass here but I'll force it" move — keep both the credit core and the zone+bold structure.
- **Pit-stop freeze model** (§10) — `pitTimer` stationary-in-the-box + cold-out-lap tyres captures the time loss, position drop, and undercut/overcut tactics with no pit-lane geometry. Multiple reviewers called this an exemplary lightweight abstraction; keep it (the §18.4 in-lap split is optional polish, not a fix).

## 20. Constants quick-reference (`src/data.js`)

| Const | Value | Meaning |
|---|---|---|
| `STEP` | 0.25 s | sim tick |
| `SKILL_K` | 4.5 | s/lap per (driver pace − 0.5) — co-primary with the car (was 7.0) |
| `CAR_PACE_K` | 9.0 | s/lap per ((power+aero)/2 − fieldMean) — the absolute car-performance term (§18.1) |
| `RACE_FORM` | 0.15 | ±s/lap per-race form swing on every car (off/on weekend) |
| `CAR_K` | 1.2 | s/lap per (power−aero)·(track.pw−df) car/track-character bias |
| `GRID_GAP` | 0.25 s | grid spread per slot (widened from 0.20, §18.3) |
| `LAP1_CAUTION` | 0.4 | pass-credit × on lap 0 — opening-lap caution (§18.3) |
| `AGGR_PASS_EDGE/ATTR/K/REF/DNF` | 1.0 / 0.70 / 1.6 / 1.0 / 0.02 | bold out-of-zone lunge: min edge / min aggression / success scalar / edge ref / failed-lunge DNF (§18.2) |
| `COMBAT_GAP` | 0.8 s | within this two cars fight |
| `DIRTY_GAP` | 1.5 s | within this you're in dirty air |
| `DIRTY_PACE_K` | 0.8 | s/lap pace lost in dirty air (× 1−straightness, §18.11) |
| `SLIP_K` | 0.25 | slipstream tow / tick (× straightness × power, then × clamp(edge/EDGE_REF)) |
| `EDGE_REF` | 0.35 | s/lap pace edge at which the tow converts in full (gate, §18.13) |
| `PASS_CREDIT_CAP / DECAY` | 2.5 / 0.97 | max bankable pass-credit / per-tick recency bleed (§18.13) |
| `DIRTY_WEAR` | 0.006 | extra wear/tick in dirty air (× 1−straightness) |
| `DNF_BASE` | 0.0075 | per-lap mechanical-failure scale × (1−rel) × pace.risk |
| `FIT_K` | 0.6 | sector-specialism strength |
| `FUEL.margin / weightK` | 0.06 / 0.020 | start fuel margin / s-lap per fuel-unit aboard |
| `TYRE.warmPen/ease/gridTemp/pitTemp` | 1.2 / 0.5 / 0.55 / 0.20 | cold penalty s/lap, warm rate, start temp, pit-exit temp |
| `COMPOUNDS pace/wear/cliff` | S −0.55/2.6/65 · M 0/1.7/78 · H +0.55/1.1/90 · I +0.30/1.9/70 · W +0.50/1.6/75 | per-compound pace, wear/lap, cliff |
| `PACE_MODES pace/wear/risk` | conserve +0.45/0.80/0.4 · balanced 0/1/1 · push −0.45/1.30/1.8 | |
| `ENGINE_MODES pace/burn` | save +0.35/0.85 · standard 0/1 · push −0.30/1.20 | |
| `EVENT.startReact/Launch/Cap` | 0.30 / 2.0 / 0.9 | launch reaction spread / skill weight / ± cap (s) |
| `EVENT.startP/Loss/Dnf` | 0.02 / 1.8 / 0.12 | bog-down chance / s lost / DNF chance |
| `EVENT.scPaceMult/MinLaps/TrainGap/PitMult` | 1.40 / 3 / 0.6 / 0.55 | SC pace, min laps, train gap, cheap-pit mult |
| `WET.mismatch/slick` | 3.0 / 8.0 | s/lap per wetness-mismatch / aquaplaning a slick |
| `ATTRW` (wear/overtaking/defending/wet/noise/starts/fuel/carWear/composure/aggression/discipline) | 0.30/0.60/0.60/0.60/0.60/1.0/0.20/0.20/0.50/0.40/0.40 | centered attribute-effect weights |
| `DIFFICULTY ai` | easy 0.55 · normal 0.80 · hard 1.0 | AI sharpness scalar |
| `AI_HANDICAP/NOISE/FORM` | 0.80 / 0.25 / 1.0 | difficulty handicap, per-lap noise, per-race form (all × 1−diff) |
| `TRACK` | lt 80, pit 23.5, pw 0.55, df 0.82, sc 0.25, wet 0.30, laps 66 | Barcelona; `ot 0.30` now vestigial |
| `TRACK.overtake_zones` | minis [0,1,2] brake ease 0.55 · [11,12] slip ease 0.45 | where passes complete |

---

*Generated 2026-06-12, stances added 2026-06-13, from the live code. Constants live in `ApexWeb/src/data.js`; the core loop in `ApexWeb/src/sim.js`. Run `node --test` (103 tests) and `node tools/balance.mjs` (corridors) from `ApexWeb/`.*
