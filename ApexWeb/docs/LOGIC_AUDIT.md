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
> **⚙ State as of 2026-06-13 — audit the NEW engine.** A **§18 priority pass shipped** (commits `d7c47c0..32c8ddf`): items §18.1 (absolute car-pace term + driver compression + per-race form), §18.13 (slipstream tow-gate + credit cap/decay), §18.11 (dirty-air pace penalty), §18.3 (opening-lap caution + wider grid), §18.7 (composure/aggression/discipline wired), and §18.2 (bold out-of-zone lunge) are now **✅ DONE** — each marked inline in §18 with the implemented formula and before/after numbers. **Review the current behaviour**, and feel free to challenge the *new* tuning (the constants are first-pass calibrations, not sacred). Note the winner-concentration *residual* (McLaren ~95%) is **DECIDED WONTFIX-by-design** (§18.1): it's grid-data, faithful to the real 2026 grid — please don't re-flag it or propose variance/reliability/grid hacks to "fix" it.

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
4. **`_resolveCombat()`** + **`_resolveBlueFlags()`** (both skipped under safety car) — wheel-to-wheel same-lap combat + lapped-traffic/blue-flag cost (§8).
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
- **Dirty air:** a follower within `DIRTY_GAP(1.5 s)` takes both (1) extra wear `dirtyWear(straightness) = DIRTY_WEAR(0.006)·(1−straightness)` into `_dirtyWear` (applied at lap-end) and (2) a **pace loss** `_dirtyPace = DIRTY_PACE_K(1.1)·(1−straightness)·(1−gap/DIRTY_GAP)` added to its lap time (graded by proximity — ~0.8 s/lap at the typical ~0.4 s pinned gap in the twisty sector, more when closer, 0 at the edge of `DIRTY_GAP`; §18.11, implemented 2026-06-13). Both worse in corners; `_dirtyPace` is reset every green tick and cleared under the SC. Following is genuinely hard — but the straight-line tow still lets a faster car attack.
- **Close combat:** within `COMBAT_GAP(0.8 s)` on the same lap:
  - pace edge `edge = lapTime(ahead) − (lapTime(me) − me._dirtyPace)` (>0 = me faster on **clean** pace; dirty air still slows the follower's *lap time* but must NOT zero its passing intent — the audit-r3 fix, see §18.11); tow `slipstream(straightness, me.car.power) = SLIP_K(0.25)·straightness·power` (straights only).
  - `me._passCredit = min(_passCredit·PASS_CREDIT_DECAY(0.97) + passAccrual(edge, towEff, engine, straightness)·(0.7 + ATTRW.overtaking(0.6)·attrs.overtaking), PASS_CREDIT_CAP(2.5))`, where `passAccrual = (max(0,edge)+towEff)·(push?1.3:1)·(0.5+straightness)` and **`towEff = tow·clamp(edge/EDGE_REF(0.35), 0, 1)`** — the tow now AMPLIFIES a real pace edge (it can't build a pass from nothing) and credit is **capped + decayed** so a whole straight of draft can't be banked and cashed in one tick (the verified over-power, fixed 2026-06-13; §18.13).
  - **Overtake zones (TODO #2b):** `zone = zoneFor(track.overtake_zones, mini)`. `resist = zone ? (1−zone.ease)·2.0·(0.7+ATTRW.defending(0.6)·ahead.attrs.defending) : Infinity`. Barcelona zones: minis [0,1,2] brake ease 0.55, minis [11,12] slip ease 0.45. **Outside a zone resist = ∞ → the follower stays pinned and credit keeps building ("the tow"); a pass completes only inside a zone.**
  - If `credit < resist`: pin behind (write only `lapFrac`, clamped ≥0). Else: pass completes (reset credit; emit a `pass` event with the zone type — suppressed while `lap===0` to avoid grid-settle spam).
  - **Bold out-of-zone lunge (§18.2):** outside a zone, if the follower is `>AGGR_PASS_EDGE(1.0)` s/lap faster, has `aggression ≥ AGGR_PASS_ATTR(0.70)`, and **hasn't already tried this rival** (`_aggrTried`, one shot per car-ahead — anti-spam), it rolls a bold move with `p = track.ot·AGGR_PASS_K(1.6)·(0.5+aggression)·clamp((edge−1)/AGGR_PASS_REF(1.0))`. On success it nips just ahead (`lapFrac = ahead.lapFrac + small`, guarded `<1` so combat never writes `lap`) **and scrubs its tyre temp by `AGGR_PASS_SCRUB(0.15)`** (a transient cost so the move isn't free — §18.2 round-2), emitting a `zone:"bold"` pass. On failure, an `AGGR_PASS_DNF(0.02)` chance of contact → DNF. Measured: **~0.95 bold passes/race, DNF stays ~1.7** (the one-shot-per-rival key is essential — a time cooldown allowed hundreds of risky attempts and pushed DNF to ~8).

**Not a traffic jam.** The pin only holds the follower `COMBAT_GAP·0.5 ≈ 0.4 s` behind — it keeps building credit ("getting the tow"), and a zone recurs every ~28% of the lap, so a genuinely faster car clears the car ahead within roughly a lap. `resist = ∞` outside a zone is the mechanism for "you can't pass *here*; wait for the braking zone", not "you can never pass". (A reviewer who reads `∞` as a permanent block has missed the zone cadence.)

**Lapped traffic / blue flags (`_resolveBlueFlags`, 2026-06-13).** Separate from same-lap combat: a car catching a **backmarker a lap+ down that's just ahead on _track_** (by `lapFrac` proximity within `BLUE_GAP 0.5 s`, ignoring lap count) takes a small **fixed** time loss threading past it — `BLUE_COST(0.12) s` per backmarker, charged once and spent down via a `_blueDelay = BLUE_PACE(0.5)` lap-time penalty (so the closing-rate can't make it run away). A 3×gap hysteresis on `_blueLast` prevents the penalty from flickering the backmarker in/out of range and re-charging. The backmarker *yields* (no pin). Measured: a leader loses **~1.5 s/race** to the backmarkers it laps — realistic, and a real factor in undercut battles (clean air is worth more). Writes only scratch scalars (invariant-safe); deterministic (no RNG). Cleared under the SC.

**Invariant (load-bearing):** combat writes **only** `lapFrac` (and scratch fields), never `lap`/`wear`. Lap bookkeeping is phase-3's alone. (`_resolveBlueFlags` writes only `_blueDelay`/`_blueBudget`/`_blueLast` scratch — same guarantee.)

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

## 11. Safety car & VSC (`events.js` + `_resolveSC`)

`scheduleSC(erng, track.sc 0.25, laps, vscShare 0.6)` picks a deploy leader-lap + a **caution type** (or none) — ~23% of races; `vscShare 0.6` of those are a **Virtual SC**, the rest a full SC.
- **Full SC** (`scActive`): every `lapTime ×= scPaceMult 1.40`; combat suspended; `_resolveSC` bunches same-lap cars into a train `scTrainGap 0.6 s` apart (writes only `lapFrac`, forward-only); pits cheaper (`scPitMult 0.55`); retracts after `scMinLaps 3` leader-laps.
- **Virtual SC** (`vscActive`, §21 r3): a **milder, uniform delta** `lapTime ×= vscPaceMult 1.22` with **NO bunching** (`_resolveSC` is full-SC only); combat suspended; pits `vscPitMult 0.78` (cheaper than green's 1.0, pricier than the full SC's 0.55) — so a VSC pit is a real but weaker strategic opportunity; clears faster (`vscMinLaps 2`). The two are mutually exclusive; emits `vsc_on`/`vsc_off` events + a "🟡 VSC" HUD chip. The AI treats either caution as a pit opportunity (`scActive || vscActive`).

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
DNF/race            ~1.35 (target ~1-2)   ← consistency→DNF (§18.7 r3, field-centered) trimmed it from ~1.7
pace spread         ~2.3-2.5 s/lap best→worst finisher (target ~1.5-2.5)   ← car-pace term (§18.1); the VSC erng-draw reshuffles the sample near the top edge
winners             3 distinct drivers (NOR/PIA/RUS over 40); top TEAM McLaren ~95%  ← grid-data dominance (best car + both top drivers); see §18.1
fuel run-outs       push-all-race ~171 dry / standard 0
tyre deg            1.66 s/lap @20 laps medium
sectors             power car −0.88 s in the straight sector, +0.65 s in the twisty one
overtaking          ~2.7 grid→finish places/car; ~24-27 passes/race (incl. ~0.95 bold out-of-zone §18.2, defence-roll trims a few §18.7 r3); rest in-zone
safety car          ~0.23 of races (track.sc 0.25), split ~60% VSC / 40% full SC (§11)
weather             ~0.37 of races rain; dry slick adv 2.7 s; wet adv in rain 6.0 s
start               2.15 |grid→lap1| places/car   ← calmer since the tow-gate also throttles lap-1 draft swaps (§18.13/§18.3)
strategy            AI ~1.5-1.7 stops/race, mean stop lap ~36/66, 0 fuel run-outs   ← VSC pit opportunism nudged it up (§11)
difficulty          easy 3 winners / DNF ~1.9 ; hard 2 winners / DNF ~1.8 (easy ≥ hard variety holds; high-variance over 40 races)
```
*(Updated 2026-06-13 after the §18 priority pass: §18.1 (car-pace `CAR_PACE_K 9.0`, `SKILL_K 4.5`, `RACE_FORM 0.15`), §18.13 (tow-gate + credit cap/decay), §18.11 (dirty-air pace `DIRTY_PACE_K 0.8`), §18.3 (lap-1 caution + `GRID_GAP 0.25`), §18.7 (composure/aggression/discipline wired), §18.2 (bold out-of-zone lunge). 110 node tests green; DNF ~1.7, bold ~0.95/race.)*

---

## 18. Open questions / things to audit hardest

Each item carries our current **stance** (as of 2026-06-13, after a first review pass) so you don't re-propose something already weighed. `→ PLANNED` = we intend to do it; `→ REJECTED` = considered and declined, with the reason; `→ OPEN` = genuinely undecided, dig in.

1. **✅ DONE (2026-06-13) — car is now co-primary; driver≫car inversion FIXED. Residual: winner concentration is grid-data, not the model.**
   - **Implemented:** absolute car-pace term `−CAR_PACE_K(9.0)·((power+aero)/2 − Race.carMean)` in `_lapTime`; `SKILL_K 7.0→4.5` (compress driver); `RACE_FORM(0.15)` per-race form on *every* car. Verified: car spread ≈ driver spread (~1.0 s/lap each) — the 24:1 driver-dominance is gone; a better car is now genuinely faster on any track (new test `better car … laps faster`). Corridors held (§17): DNF 1.75, spread 2.24, 104 tests green.
   - **Residual (known, NOT a model bug):** McLaren still wins ~95-100%. This is **grid-data dominance** — McLaren has the best car *and* both top-2 drivers (Norris/Piastri), so it leads on every axis; it already won ~95% at baseline (before the car term). `RACE_FORM` adds race-to-race texture but a ±0.15 form can't overturn a ~0.3 s/lap package edge on *both* their cars. **Genuine championship variety needs a separate lever** (not this task): rebalance the `TEAMS` grid so the top team isn't uniformly best, a bigger difficulty-scaled "car day" handicap, or accepting realistic single-team dominance (cf. 2023 Red Bull). → **✓ DECIDED (2026-06-13, owner) — accept realistic dominance (option A).** The `TEAMS` table stays faithful to the real 2026 grid; **no rebalance.** McLaren's ~95% is a *correct* reflection of the best car + both top-2 drivers, and the saturating-car trial (below) proved no sim-side lever can break it without eroding the manager game's "develop the best car" core. **This is now WONTFIX-by-design** — do not re-propose reliability nerfs, forced variance, or grid edits to "fix" winner concentration; it is intended. (Variety still comes from difficulty/SC/weather/DNF/strategy, and the player's own car development over a season.)
   - → **↪ ROUND-2 POST-SHIP REVIEW (ChatGPT, 2026-06-13) — PARTIALLY AGREE.** Argues the residual is *not purely* grid-data: the model under-provides **race-dynamics variance** (low per-tick micro-variance; the car term is a flat linear superposition with no saturation), so even a slightly-better package wins almost deterministically. Two proposals: **(a)** a **saturating/diminishing car term** (e.g. `CAR_PACE_K·tanh(k·dev)` or `·(1−e^{−k·dev})`) to compress the *top-end* package where McLaren lives; **(b)** raise `SKILL_K 4.5→~5.2` and add a small per-lap deterministic noise (~0.08). **Our stance:** *both* the grid-data and the low race-variance contribute — fair sharpening. BUT we **empirically measured** that `RACE_FORM 0.15→0.18` barely dents McLaren (95→98%), so adding plain variance won't fix it without sliding into "blind luck" (the §18.1 warning). The **saturating car term (a)** is the more promising lever — it specifically squeezes the leader's package, not the whole field — and re-inflating `SKILL_K` (b) partly *undoes* the just-won "car co-primary" goal, so prefer the car-saturation over the driver-reinflation.
   - → **✗ TRIALLED & REVERTED (2026-06-13) — confirms the grid-data thesis (3rd time).** Implemented `−CAR_PACE_K·tanh(CAR_SAT·dev)/CAR_SAT` (near-0 slope unchanged, top outlier compressed) and swept it. Results: `CAR_SAT=20` → default still **98%** McLaren, spread 2.03; `CAR_SAT=35` → default **92%** (3 teams), spread **1.89** (in ChatGPT's target band), but **hard stayed 97%** and it cost two things: (1) it flattens the *midfield* car axis too (~78% slope), weakening the manager game's core "develop the best car" payoff, and (2) the stronger curve perturbed two sensitive tests (the pace-leader colour pick + a marginal dirty-air margin). **Verdict:** car-saturation can't break the monopoly without an unacceptable side-cost — McLaren is best on *every* axis with *two* cars, so trimming only the car edge can't let a rival beat *both* McLarens at default/hard. Reverted to the clean linear term. **The monopoly is genuinely grid-data; the only real fix is a `TEAMS` rebalance (a design call — fidelity to the real 2026 grid vs. championship variety), or accepting realistic single-team dominance.**
   - **Historical context (the original finding, now resolved):** McLaren won ~80-95% at default. **Measured** (over the real grid, `node` sensitivity check): the **car contributed only a ±0.065 s/lap spread** to lap time while the **driver-skill spread was ~1.57 s/lap → a 24:1 ratio.**
   - **Why (structural, not just "linear"):** the only car term in `_lapTime` is `−CAR_K·(power−aero)·(pw−df)` — a *track-character bias* on the power-vs-aero **difference**, **not** an absolute car-performance term. So a car with power=aero=0.99 and one with power=aero=0.50 lap *identically*. The 5 Phase-7 car indicators are therefore nearly **pace-inert** (power/aero also feed the sector-split distribution, but those sum back to the same lap time; and tyre/fuel/reliability). **The "monopoly" is driver-skill concentration (McLaren = the top-2 drivers), not the car.** "Best car wins" is effectively false in the current model.
   - **Calibration target (industry):** real F1 is **car-dominant** (~60–80% car / 20–40% driver); our model is **inverted** (~90% driver). For a *manager* game the car is the player's R&D project, so car-significance is doubly desirable. Aim to flip the ratio so the **car is at least co-primary** (car ≈ driver, or car-primary), not a rounding error. (Independently confirmed: 3 separate numerical reviews land on driver:car ≈ 17–25×.)
   - → **✅ DONE:** the **absolute car-pace term** `−CAR_PACE_K(9.0)·((car.power + car.aero)/2 − fieldMean)` is in `_lapTime`, with `SKILL_K 7.0→4.5`. Car spread ≈ driver spread (~1.0 s/lap each) — co-primary. (A `sqrt` diminishing-return on the driver term was considered but unneeded — the linear compression landed the corridor.)
   - → **CONSIDERED (variance lever):** our per-lap *tick* variance (~0.05–0.15 s) is still low vs the genre, but the per-race **form** offset (below) now supplies race-to-race variance. Further raising tick noise is available if races still feel too deterministic; tune against the §17 spread/winners corridors so it doesn't become "blind luck".
   - → **✅ DONE:** a **per-race "form" offset `RACE_FORM(0.15)` to *every* car each race** (`car._form`, seeded, decorrelated from `_aiForm`) — realistic "off-weekend for anyone". It adds field-wide race-to-race variance (midfield order shifts) but, as measured, a ±0.15 swing does **not** overturn McLaren's structural package edge — that's the grid-data residual noted above, not a form-tuning miss.
   - → **REJECTED:** an `interaction = MIX_K·pace·car_quality` term — a *positive* pace×car interaction *amplifies* the best package (more domination), the opposite of the goal.
   - → **REJECTED:** making top teams *less reliable* — anti-realistic (real top teams are *more* reliable) and it undercuts the "best car" fantasy.
   - → **OPEN:** whether to also make `setupBonus` a bigger player lever (helps the human, not AI-vs-AI spread).
   - → **↪ ROUND-2 (Qwen, 2026-06-13) — agrees it's grid-data; proposes a player-side mitigation.** Concretely: give the human two levers to beat the grid monopoly without anti-realistic reliability nerfs — (1) a meaningful, discoverable **`setupBonus` ceiling (~−0.15 s)** in Practice, and (2) raise **`RACE_FORM` to ±0.20–0.25** so a "hot" weekend can occasionally bridge the gap. **Stance:** the `setupBonus` lever is a clean, player-only fix (doesn't touch AI-vs-AI spread) — **OPEN, with a concrete −0.15 s target.** On `RACE_FORM`: note it is **already per-car** (`car._form`, seeded by `idx` — Qwen's "ensure per-car" is satisfied); raising it to ±0.20–0.25 is the same variance lever as the ChatGPT note above (we measured ±0.18 barely dents McLaren, so treat as a *texture* knob, not a monopoly fix).
2. **✅ DONE (2026-06-13) — `track.ot` repurposed as the bold-lunge base.** Implemented the aggressive out-of-zone pass (see §8): gated on `edge>1.0` + `aggression≥0.70` + **one shot per rival-ahead** (`_aggrTried`), with `track.ot·AGGR_PASS_K` success and an `AGGR_PASS_DNF(0.02)` contact risk on failure. Instantaneous (a guarded `lapFrac` nip just ahead — never writes `lap`), no credit banking. Validated: **~0.95 out-of-zone passes/race, DNF ~1.7** (in the §17 corridor). **Key lesson (the anti-spam was load-bearing):** an early *time* cooldown allowed hundreds of attempts over a multi-thousand-second race → DNF ~8; switching to **one-shot-per-rival** fixed it.
   - → **↪ ROUND-2 POST-SHIP REVIEW (ChatGPT, 2026-06-13) — AGREE on the artifact, PLANNED with a caveat.** Flags the instantaneous `lapFrac` "nip ahead" as a discrete **teleport** (breaks motion continuity; can read as a visually-impossible jump). Proposes replacing it with a **temporary pace burst over ~0.15–0.25 lap** with the same integral effect. **Stance:** agree it's cleaner/more physical → **PLANNED**, *but* with the load-bearing caveat that nearly killed this feature: a follower closes only ~`edge` per lap, so a >1 s/lap-faster car still needs ~0.4 lap of un-pinned running to clear a 0.4 s gap — a *short* burst may not actually **complete** the pass within its window (the very pass-completion-dynamics problem the teleport sidesteps). So the burst must (a) suppress the pin for its whole window AND (b) be large enough to physically clear, then re-validate ~0.95/race + the DNF corridor. (Also minor: ChatGPT suggests a **context-sensitive** failed-lunge DNF — `f(gap, tyre_wear, speed_delta)` instead of a flat 0.02. Reasonable polish, low priority.) → **DEFERRED (burst replaces teleport) + minor (context DNF).** *Why deferred:* the closing-rate math is the blocker — a >1 s/lap-faster car still gains only ~`edge·dt/lt` ≈ 0.003 s of track position per tick, so even a multi-tick pace burst (or running "alongside" then edging by) **cannot complete the overtake within a realistic window** (it's the same reason zone passes need a long sustained release). The teleport is currently the only mechanism that reliably *completes* a pass inside the tick model. Revisit only after the exact zone-pass-completion dynamics are nailed down; until then the **micro-cost below** delivers most of the realism the burst was for.
   - → **↪ ROUND-2 (Qwen, 2026-06-13) — AGREE, micro-cost on SUCCESS (PLANNED minor).** Qwen praises the one-shot-per-rival anti-spam as "load-bearing" but notes a *successful* lunge is currently free (instant nip, no consequence), so it reads as a zero-risk "get-out-of-jail" card. Proposes a small cost on success — scrub tyre temp (`tyreTemp -= ~0.15`) or a +0.15 s next-lap penalty — modelling the lock-up/run-wide of a desperate move. **Stance:** agree, good texture → **✅ DONE (2026-06-13):** a successful bold pass now scrubs the attacker's tyre temp `tyreTemp = max(0.1, tyreTemp − AGGR_PASS_SCRUB(0.15))` — a transient, self-healing cold/flat-spot pace cost (~0.18 s/lap, warming back over a lap or two via the existing `warmStep`), so the lunge carries a real reward-vs-risk. Verified: ~0.95 bold/race and DNF held (1.68); new test asserts a successful lunge drops the attacker's temp. (This delivers the realism the deferred burst was for, without the closing-rate completion problem.)
   - *Original:* with overtake zones the non-zone branch returned `resist=∞`, so `track.ot` was computed but unused.
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
11. **✅ DONE (2026-06-13) — dirty air now cuts pace, not just wear.** Added `_dirtyPace = DIRTY_PACE_K(0.8)·(1−straightness)` to the follower's lap time while within `DIRTY_GAP` (≈0.64 s/lap in the twisty sector, in the real 0.5–1.5 s/lap band), reset every green tick, cleared under the SC. Verified: a follower in dirty air laps slower (new test); the straight-line tow still lets a faster car attack (passes held 22/race). Side-benefit observed: **easy-mode winner variety rose (4→5)** — midfield cars stuck in traffic lose pace, adding the variance §18.11 predicted. Corridors held (DNF 1.73, spread 2.30).
   - → **↪ ROUND-2 POST-SHIP REVIEW (ChatGPT, 2026-06-13) — AGREE, refinement PLANNED.** The penalty is currently **binary** (full `DIRTY_PACE_K·(1−straightness)` anywhere inside `DIRTY_GAP 1.5 s`, zero outside). Real downforce loss scales with *proximity* — running 0.3 s back hurts far more than 1.4 s back. Proposes grading it by gap (`∝ 1/gap^1.5` or a `smoothstep(gap)` ramp). **Stance:** sensible "traffic-compression gradient". (A second round-2 reviewer (Qwen) independently affirmed the `DIRTY_PACE_K=0.8` *magnitude* — so the plan was grade the gap-falloff, keep the depth.) → **✅ DONE (2026-06-13):** `_dirtyPace = DIRTY_PACE_K·(1−straightness)·(1−gap/DIRTY_GAP)` — a linear proximity ramp (full at zero gap, 0 at the edge of `DIRTY_GAP`); `DIRTY_PACE_K 0.8→1.1` so the typical ~0.4 s pinned distance still costs ~0.8 s/lap while *closer* hurts more and *farther* less. Measured: passes/race **25.8 → 28.0** (slightly easier far-following → tighter racing, toward the reviewers' "more overtakes" ask, still Barcelona-realistic), DNF **1.63**, spread 2.26, easy 4 ≥ hard 2 winners — corridors held. New test: dirty-air pace stronger at 0.3 s than at 1.2 s.
   - → **⚠ FOLLOW-UP BUG this introduced — FIXED (audit r3, 2026-06-13).** Because `_dirtyPace` is added to `_lapTime`, and combat computed `edge = lapTime(ahead) − lapTime(me)`, the follower's dirty-air penalty **zeroed its own pass-edge**: a 0.3–0.8 s/lap-faster car in the ~0.4 s pinned gap had `edge ≤ 0` → no credit accrual → **moderate-edge on-track passing became near-impossible** (the self-audit measured a faster car passing ~flat ~2–4/15 regardless of edge — processional racing). Dirty air was double-counting: it *should* cost the follower lap-time/position (it does), but not erase its intent to pass. **Fix:** `edge` now uses the follower's **clean** pace (`+ me._dirtyPace` added back), and `PASS_CREDIT_DECAY 0.97→0.99` so zone-built credit survives the dirty-air laps between zones. Verified: 1v1 passing now **scales with edge** (0.8 s/lap: 2→7 /15), corridor held (passes 28, DNF 1.82, spread 2.25, in-zone 100%). New regression test locks it ("on-track passing scales with the pace edge"). *Original (now resolved):* following within `DIRTY_GAP` added only tyre *wear* (`_dirtyWear`); in reality lost downforce also costs *pace* (worse in corners). → add `lapTime += DIRTY_PACE_K·(1−straightness)` while in dirty air. This makes following genuinely hard (the follower's pace edge shrinks), the undercut more valuable (clean air after a stop), and — paired with the straight-line slipstream tow — gives realistic "hard to follow, but you get the tow on the straight" dynamics. It also indirectly **eases the §18.1 monopoly** (midfield cars stuck in traffic lose pace, adding variance). Needs careful tuning so passing doesn't become *too* hard (the slipstream must still let a faster car attack). **Suggested start `DIRTY_PACE_K ≈ 0.8`** (~0.4 s/lap lost in the twisty sector while following — in line with the real 0.5–1.5 s/lap dirty-air loss — with the straight-line tow still compensating). Pairs naturally with §18.13 (tow gated on edge): hard to follow in the corners, but the tow lets a genuinely faster car attack on the straight.
12. **Smaller observations.** → **OPEN/minor:** `GRID_GAP` is now `0.25 s` (raised from 0.20 in §18.3). Fuel has no explicit lift-and-coast / safety-margin behaviour (the engine `save` mode is a coarse stand-in). Weather wetness is **uniform across the track** (no sector-local rain) — a realistic but larger future addition.
13. **✅ DONE (2026-06-13) — slipstream tow over-power FIXED.** Implemented both parts: (a) **tow gated on a real edge** — `towEff = tow·clamp(edge/EDGE_REF(0.35),0,1)` in `passAccrual`, so the draft amplifies a pace edge and a slower/equal car can't pass on the tow alone (new unit test); (b) **credit capped + decayed** — `_passCredit = min(_passCredit·0.97 + accrual, 2.5)` in `_resolveCombat`, so a whole straight of draft can't be banked and cashed in one tick. Effect (measured): passes/race **34 → 23** (the removed ~11 were the artificial equal-car swaps), grid→finish **3.2 → 2.7 places/car**, lap-1 shuffle **2.88 → 2.16** (the tow-gate also calms the opening lap), in-zone still 100%, DNF 1.55 / spread 2.25 / easy 4 winners > hard 2. 105 tests green.
   - → **↪ ROUND-2 POST-SHIP REVIEW (ChatGPT, 2026-06-13) — lever noted, PARTLY DISAGREE.** Flags ~23–26 passes as over-corrected vs a "30–38/race realistic envelope" and proposes loosening: `EDGE_REF 0.35→0.25`, `decay 0.97→0.985`, `cap 3.0`, + a `smoothstep(gap)` on the tow. **Our stance:** the 30–38 envelope is for a *generic* circuit — **Barcelona is a genuinely LOW-overtaking track** (~10–30 real on-track passes), so 23–26 is in-band, not obviously too few. Keep as the calibration knob: if a live playtest feels static, loosen `EDGE_REF`/`decay`/`cap` in that order (the `smoothstep(gap)` tow-vs-proximity idea is a clean addition either way). → **OPEN (playtest-gated).**
   - → **↪ ROUND-2 (Qwen, 2026-06-13) — claim REFUTED by the numbers, but same lever.** Qwen argued `PASS_CREDIT_CAP(2.5)` **hard-caps modest-edge cars below `resist`**, citing `resist` reaching "1.8–2.2". **Verified false** (`node` check over all zones × defender skill): **max `resist` = 1.43** (slip zone, `defending=1.0`) — the cap 2.5 is comfortably *above* it, and a modest `edge=0.15` has a steady-state credit equilibrium of **~6.6** (capped to 2.5) ≫ any resist, so a genuine-edge car always reaches the threshold. There is **no "impossible block"**; the only thing that trims passes is the **gate** (`edge≤0 → towEff=0 → no accrual`), which is the intended fix. So the cap/decay are fine; the single lever for "more passes" is **lowering `EDGE_REF`** (Qwen's `0.35→0.20` = ChatGPT's `0.25`), still playtest-gated per the Barcelona caveat above.
   - *Original finding (now resolved) below:*
   - `passAccrual = (max(0,edge) + tow)·push·(0.5+straightness)` let the **tow alone** build credit — even at `edge ≤ 0` (equal or slower pace). **Measured** in a brake zone: tow ≈ `SLIP_K(0.25)·straightness(0.8)·power(0.95)` ≈ 0.19/tick → credit ≈ `(0+0.19)·(0.5+0.8)·(0.7+0.6·overtaking)` ≈ 0.29/tick; against `resist ≈ 1.06` that's **~3.7 ticks ≈ 0.9 s → a pass with no pace advantage.** Risk: equal-pace cars swap positions every zone (artificial). **Mitigating context:** the overall pass corridor (27–37/race, ~3 places/car) shows it isn't currently catastrophic — a slower car can't *stay* pinned (the pin only pushes back, never pulls forward), and per-tick noise keeps `edge` off exactly 0 — so it self-limits. Hence **major (realism), not critical.**
   - **Sharper root — credit *banking* (verified):** `_passCredit` has **no cap and no decay**; it's reset only when the follower leaves `COMBAT_GAP` or completes a pass. So a car drafting the full main straight (~48 ticks) **banks ~13.6 credit** before reaching the T1 brake zone, where `resist ≈ 0.9` — the pass then completes in **~1 tick on zone entry**, even for a car that's *slower in the corners* (it just needs straight-line draft). The issue isn't only the per-tick tow magnitude; it's unbounded accumulation.
   - → **PROPOSED (two parts):** (a) make the tow *amplify a real edge* rather than create a pass from nothing — `tow_eff = tow · clamp(edge/EDGE_REF, 0..1)` (require some positive `edge` to convert). **Do NOT** hard-zero the tow at `edge ≤ 0` — that kills the realistic draft pass of an equal car, which *should* be possible, just not instantly. (b) **cap and/or decay `_passCredit`** (e.g. clamp to ~2×max-resist, bleed a fraction each corner) so it can't be banked over a whole straight and cashed in one tick. Tune so a tow pass of a near-equal car takes a few zones (laps), not one; re-check the §17 overtaking corridor.
14. **✅ DONE (2026-06-13) — lapped traffic / blue flags (was a real fidelity gap).** Combat is same-lap only (`me.lap === ahead.lap`), so before this **a leader catching a backmarker never interacted with it** — no time lost, no blue-flag yield (a known omission; lapped cars only ranked correctly in the standings). Added `_resolveBlueFlags` (see §8): a car catching a car **a lap+ down, just ahead on _track_** (lapFrac proximity within `BLUE_GAP 0.5 s`) pays a **fixed one-shot `BLUE_COST 0.12 s` per backmarker** (spent down via a `_blueDelay` pace penalty, with 3×gap hysteresis so the closing-rate can't flicker-recharge it). Measured: a leader loses **~1.5 s/race** to lapped traffic — realistic, and a genuine undercut factor (clean air is now worth more). **Tuning history (important):** a naive per-tick rate was catastrophic — the closing-rate stickiness + backmarker density + a penalty→slower-closing→longer-window feedback gave the *winner* **~11.8 s/race**; the fix was the **fixed one-shot cost + hysteresis** (same "bound it, don't let a per-tick effect compound" lesson as §18.13/§18.2). Corridors held (DNF 1.75, spread 2.27, passes 27). 113 tests. **Related — traffic after a pit stop IS modelled** (for same-lap cars): the pit freeze drops you ~0.3 lap back among same-lap rivals on cold tyres, and the normal combat + dirty-air apply — that's where the undercut/overcut bite comes from. Not modelled: pit-exit-specific effects (unsafe release, pit-lane geometry). → **OPEN/minor (future):** a `pass`-style radio line for lapping ("X laps the field"); a tiny time cost to the *backmarker* for going off-line (currently lapper-only).

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
| `AGGR_PASS_EDGE/ATTR/K/REF/DNF/SCRUB` | 1.0 / 0.70 / 1.6 / 1.0 / 0.02 / 0.15 | bold out-of-zone lunge: min edge / min aggression / success scalar / edge ref / failed-lunge DNF / successful-lunge tyre-temp scrub (§18.2) |
| `COMBAT_GAP` | 0.8 s | within this two cars fight |
| `DEFEND_ROLL / DEFEND_MAX` | 0.4 / 0.55 | defence roll: (defending−overtaking) weight / per-tick repel cap (§18.7 r3) |
| `DNF_CONSIST` | 0.4 | DNF ×(1 + ·(consMean−consistency)·2) — jittery-vs-field driver retires more (§18.7 r3) |
| `DIRTY_GAP` | 1.5 s | within this you're in dirty air |
| `DIRTY_PACE_K` | 1.1 | s/lap pace lost in dirty air at zero gap (× 1−straightness × 1−gap/DIRTY_GAP, §18.11) |
| `BLUE_GAP / PACE / COST` | 0.5 s / 0.5 / 0.12 | lapped-traffic: trigger gap / spend rate / fixed s lost per backmarker (§18.14) |
| `SLIP_K` | 0.25 | slipstream tow / tick (× straightness × power, then × clamp(edge/EDGE_REF)) |
| `EDGE_REF` | 0.35 | s/lap pace edge at which the tow converts in full (gate, §18.13) |
| `PASS_CREDIT_CAP / DECAY` | 2.5 / 0.99 | max bankable pass-credit / per-tick recency bleed (DECAY 0.97→0.99, audit r3 so credit survives between zones) |
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
| `EVENT.scPaceMult/MinLaps/TrainGap/PitMult` | 1.40 / 3 / 0.6 / 0.55 | full SC pace, min laps, train gap, cheap-pit mult |
| `EVENT.vscShare/vscPaceMult/vscMinLaps/vscPitMult` | 0.6 / 1.22 / 2 / 0.78 | VSC share of cautions, milder delta, shorter, mid-cost pit (§21 r3) |
| `WET.mismatch/slick` | 3.0 / 8.0 | s/lap per wetness-mismatch / aquaplaning a slick |
| `ATTRW` (wear/overtaking/defending/wet/noise/starts/fuel/carWear/composure/aggression/discipline/smoothWear) | 0.30/0.60/0.60/0.60/0.60/1.0/0.20/0.20/0.50/0.40/0.40/0.15 | centered attribute-effect weights |
| `DIFFICULTY ai` | easy 0.55 · normal 0.80 · hard 1.0 | AI sharpness scalar |
| `AI_HANDICAP/NOISE/FORM` | 0.80 / 0.25 / 1.0 | difficulty handicap, per-lap noise, per-race form (all × 1−diff) |
| `TRACK` | lt 80, pit 23.5, pw 0.55, df 0.82, sc 0.25, wet 0.30, laps 66 | Barcelona; `ot 0.30` now vestigial |
| `TRACK.overtake_zones` | minis [0,1,2] brake ease 0.55 · [11,12] slip ease 0.45 | where passes complete |

---

---

## 21. Self-audit — 4 parallel agents (2026-06-13)

Four independent agents audited the live engine, each from one angle, each verifying claims against the real code (not memory). **No `critical` issues** — the determinism agent *empirically* confirmed all three §16 invariants over 174k+ ticks (0 writes to `lap`/`wear` from combat/blue-flags; `lapFrac ∈ [0,1)` on lap ≥ 1; byte-identical final-state hashes across runs). Findings, with our stance:

**✅ FIXED — the headline (passing too hard → processional racing).** The balance agent measured (and I reproduced) that on-track passing was **~flat ~2–4/15 regardless of pace edge** — a 0.6–0.8 s/lap-faster car couldn't clear a similar car. Root cause: `_dirtyPace` (added in §18.11) fed into the combat `edge`, **zeroing the follower's own pass-edge** in the pinned gap (dirty air double-counted: it should cost lap-time, not erase pass-intent). **Fixed** (clean-pace `edge` + `PASS_CREDIT_DECAY 0.97→0.99`): passing now scales with edge (0.8 s/lap: 2→7/15); corridors held (DNF 1.82, passes 28, spread 2.25). Regression test added. *See §18.11 follow-up.*

**✅ DONE (this pass, on top of the headline fix):**
- **Undercut — VERIFIED FINE, no change.** The balance agent's ~4/20 was a mis-attribution: in a *clean* controlled probe the 2-lap undercut works **24/24** at the current `pitTemp 0.20`. The reported "failure" was the undercutter **rejoining into traffic and getting stuck** — i.e. the *passing* bug above, now fixed. The undercut mechanic and the cold out-lap are healthy; left untouched (and the realism agent's "cold out-lap is realistic" is preserved).
- **Attributes wired (3 more now matter):** **defence roll** — at the pass threshold a strong defender repels for the tick (bounded `DEFEND_MAX 0.55`, credit kept → a faster car still gets by) so `defending`/`overtaking` shift who wins a battle; **consistency → DNF** — `×(1 + DNF_CONSIST(0.4)·(fieldMeanConsistency − consistency)·2)`, centered on the **field mean** (`Race.consMean`) so a jittery-vs-field driver retires more *without* shifting the field DNF rate; **smoothness → wear** — `×(1 − ATTRW.smoothWear(0.15)·(smoothness−0.5)·2)`. New tests for smoothness-wear.
- **dt/STEP** — `_resolveBlueFlags(dt)` now drains its budget over the tick's real `dt`.
- **`_passCredit` rival-key** — `_creditVs` guard added: banked credit can't carry onto a newly-ahead car.
- **RPC car-index** — `setPace`/`setEngine`/`requestPit` bounds-check the index + validate the mode/compound.
- **Dead code** — removed `PASS_K`, `wearMod`, `startIncidentHit`; killed the dead `ease` fallback; commented the inert `car.energy`/`track.{abr,harv,dep,el}`. **Correction:** `_pin` is NOT dead (the balance harness + fuel tests force `setEngine` on AI cars and rely on it) — kept.

**✅ DONE (deferred pass, 2026-06-13):** the **VSC caution variant** (§11) — `vscShare 0.6` of cautions are now a Virtual SC: a uniform `vscPaceMult 1.22` delta with **no bunching**, a mid-cost pit (`vscPitMult 0.78`, between green and full SC), shorter duration, `vsc_on`/`vsc_off` events + a "🟡 VSC" HUD chip, and the AI taking VSC pit opportunities. Adds a real second caution-strategy axis (a VSC pit is cheaper than green but not the bargain a full SC is). Tests: VSC occurs + is SC-exclusive + slows the field; both caution types occur. Corridors held.

**🟢 REMAINING — investigated / lower-priority (with rationale):**
- **deg-magnitude / 1-vs-2-stop economics** (realism agent) — **left as-is.** The balance agent's evidence wins: the 1-stop dominance is *correct emergent behaviour* for Barcelona (a forced 2-stop loses to traffic on rejoin), and a clean undercut already works (24/24 in clear air). Changing deg risks flipping a healthy, realistic strategy character — not worth it without a multi-track reason.
- True polish, **deliberately not tacked onto this balance-touching session:** a tyre **"switch-on" plateau** before the cliff; **weather** drying-line / softening the slick hinge at wetness 0.4 (risks the calibrated weather corridor for an imperceptible knee); **bold-lunge DNF** scaling with the defender (the bold-DNF contribution is ~0.1/race — marginal); **start bog-down DNF** 0.12→0.04 (would push the already-low DNF further down). Each is a realism *upgrade*, not a bug.
- **Perf** (code agent N4): `order()` runs ~2–3×/tick; computing it once would ~halve the combat sort cost (the sim is now ~1.45 s/race → harness ~7 min), BUT reusing a single pre-combat order would *shift_results* (`_aiDrive` would see the pre-combat order), so it's a behaviour change, not a free optimisation — deferred to avoid re-tuning the corridors.

**Verdict across all four:** the engine is **correct (invariants empirically intact), well-structured, and balanced on the macro corridors**; the headline game-feel issue (processional racing) was a real interaction bug and is now fixed. **Post-audit pass landed:** the passing fix + all the queued hardening (dt, credit-key, RPC), the dead-code sweep, and the attribute wiring (defence-roll, consistency→DNF, smoothness→wear) are done; the undercut was verified healthy (the "failure" was the passing bug). Final corridors: **DNF 1.32, spread 2.27, passes 25.5, strategy 1.47, easy 4 ≥ hard 3 winners** — all in band. Remaining: the larger realism *upgrades* (VSC, tyre switch-on plateau, deg-economics revisit) flagged for a dedicated pass.

---

*Generated 2026-06-12, stances added 2026-06-13, self-audit (4 agents) folded + actioned 2026-06-13. From the live code. Constants live in `ApexWeb/src/data.js`; the core loop in `ApexWeb/src/sim.js`. Run `node --test` (123 tests) and `node tools/balance.mjs` (corridors) from `ApexWeb/`.*
