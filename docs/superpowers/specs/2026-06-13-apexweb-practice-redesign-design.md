# Apex Web — Practice redesign ("run plans") design

**Date:** 2026-06-13
**Status:** approved (design), pending spec review → implementation plan
**Scope:** the ApexWeb browser game's Practice session only (`ApexWeb/`). Does not touch the Godot prototype.

## Goal

Turn Practice from a solved-for-you 3-slider setup minigame into a **run-plan session**: the two co-directors share a limited track-time budget, spend it across **run types** that each gather different intel (setup signal, tyre-degradation curve, quali pace), and converge — together, in real time — on a setup AND a race strategy. It connects Practice to the deep race sim (tyres/deg/cliff), leverages co-op, gives the FM driver model a role, and gets a richer screen.

Covers the four approved directions: **A** purpose (strategy scouting), **B** co-op collaboration, **C** skill (noise + driver feedback quality), **D** UX (findings board).

## Current state (what we replace)

- `ApexWeb/src/ui/practice.js` — 3 sliders, hidden ideal (`setup.js trackIdeal`), **4 local runs**, feedback names the worst axis + direction, confidence %. Deterministic, no noise.
- `ApexWeb/src/setup.js` — `trackIdeal`, `closeness`, `paceBonus` (→ `setupBonus` ≤ −0.15 s/lap), `feedback`.
- Practice is **local per player** (no RPC during the phase); each player's setup is sent only on "Ready" (`set_setup`), collected on the host, applied to the field in `buildField` (`main.js`).
- Does not use driver attributes; no tyres/fuel/sessions.

## Design

### 1. Run-plan mechanic (the new core loop)

A **shared team budget** of `PRAC_BUDGET = 8` track-time units. Each run draws from it:

| Run type | Cost | What it does / reveals |
|---|---|---|
| **Setup-тест** | 1 | a short, **noisy** setup-signal lap → updates the worst-axis feedback + the "ideal found %" |
| **Long-run** | 3 | a ~`LONG_RUN_LAPS = 10`-lap stint on a chosen compound → the **tyre-degradation curve**, `cliffLap`, recommended stint length / stop count |
| **Quali-sim** | 1 | one low-fuel soft flying lap → representative quali pace |

You cannot do everything (8 units); the allocation is the strategy. The two players spend from the same pool — division of labour is the co-op synergy.

### 2. Long-run = the real sim (new pure module `ApexWeb/src/practice.js`)

`longRun(drv, car, compound, setup, laps, seed)` simulates **one car's stint** reusing the calibrated engine — NO new balance numbers:
- per lap: the `_lapTime`-style base (SKILL_K·pace, CAR_PACE_K, CAR_K, setupBonus) + `tyreTerm(compound, wear, tyreTemp)` + `weightTerm(fuel)` + small seeded noise; advance `wear` via the same accrual (compound.wear·drvTyre·carTyre·drvSmooth), `tyreTemp` via `warmStep`, fuel via `burnFor`.
- returns `{ lapTimes:[…], cliffLap, stintLaps, recommendedStops }` — `cliffLap` = first lap where the per-lap deg jumps past the cliff; `recommendedStops` from total race laps / `stintLaps`.

Other helpers in `practice.js`:
- `setupTestLap(drv, car, setup, ideal, seed)` — a setup-signal lap time with noise `rng.noise(amp)` where `amp` grows with `(1 − consistency)` (skill C). The lap-time signal still tracks `closeness(setup, ideal)` (amplified for feel) so the player can read the trend across runs.
- `feedbackLine(setup, ideal, raceIq, seed)` — feedback whose **clarity scales with `race_iq`** (skill C): high `race_iq` → the current precise "axis + direction" hint; low → fuzzed (a chance it names the wrong axis, drops the direction, or only says "баланс не тот"). Supersedes/wraps `setup.js feedback`.
- `qualiSimLap(drv, car, setup, ideal, seed)` — reuse `quali.js qualiLap` semantics (low fuel, soft) for a representative pace.
- `analyzeFindings(findings)` — fold the run log into the board summary: best deg curve per compound, `recommendedStops`, best quali pace, "ideal found %" (= best `closeness` seen).

All pure + **seeded** (a practice RNG seeded from the weekend seed + a per-run index) so host re-runs match and tests are deterministic.

### 3. Co-op netcode (full, host-authoritative)

Mirrors the race's host-authoritative model. The host owns the practice state:

```
ctx.practice = {
  budget: 8, spent: 0,
  findings: [ { runId, player, type, compound?, result } ],  // result = run-type-specific (lapTimes/cliffLap | feedback/closeness | qualiPace)
  setups:  { p1:[…], p2:[…] },
  board:   analyzeFindings(findings),       // derived summary for the UI
}
```

- New RPC **`practice_run`** `{ player, type, compound, setup }` → host: validate budget (`spent + cost ≤ budget`), run the relevant `practice.js` helper (seeded by `weekendSeed + runId`), append the finding, `spent += cost`, recompute `board`, **broadcast a practice snapshot**.
- **Practice snapshot** `{ type:"practice", budget, spent, findings, board, setups }` — both browsers render the shared findings board live.
- Existing `set_setup` (per-player setup) + `ready` unchanged. A player's setup is also carried on each `practice_run` (so the run uses their current sliders).
- Solo: the host IS the only player; the same path works with one player drawing the budget.

`main.js` gains a practice-phase command handler (`practice_run`) + a practice-snapshot broadcaster, analogous to the race host loop but event-driven (no per-tick loop — runs are discrete).

### 4. Skill model (C) — summary

- Setup-тест laps are noisy (amp ∝ 1−consistency) → the signal must be read over runs, not one lap.
- Feedback clarity ∝ `race_iq` → a low-feedback driver is genuinely harder to dial in.
- These make the puzzle a skill and make drivers feel distinct in Practice (the FM model now bites here).

### 5. Screen (D) — `ApexWeb/src/ui/practice.js` rewrite

Per the approved mockup: header with the shared **budget dots**; a **your-car** card (3 setup sliders + the driver-feedback line + confidence bar); a **run-picker** card (the 3 run-type buttons with costs + a compound `<select>` on Long-run); and a full-width **shared findings board** (a small inline-SVG deg chart, metric cards for stint length / recommended stops / quali pace / ideal-found %, and a P1/P2-tagged run log). Footer: "Готов → Квала" (sends `set_setup` + `ready`). Renders from the practice snapshot + local sliders.

### 6. What carries to the race

- **Setup** → `setupBonus` (mechanical, exactly as today).
- **Findings** → **information**, not pace: the discovered `cliffLap` / `recommendedStops` are stashed (`ctx.practiceFindings`) and surfaced in the race HUD as a player aid (e.g. "прогноз клиффа ~круг 22"). Honest: Practice yields *knowledge* to make better pit calls, not free speed. (The AI already "knows" deg — it's the sim.) This race-HUD aid is a small, optional add; the spine of the feature is the practice session itself.

## File structure

- **Create** `ApexWeb/src/practice.js` — pure run-sim + helpers (longRun, setupTestLap, feedbackLine, qualiSimLap, analyzeFindings). Reuses `tyres.js`/`fuel.js`/`quali.js`/`setup.js`/`rng.js`/`data.js`.
- **Create** `ApexWeb/tests/practice.test.js` — unit tests (below).
- **Add** consts to `ApexWeb/src/data.js` — `PRAC_BUDGET`, `PRAC_COST`, `LONG_RUN_LAPS`, skill-noise/clarity weights.
- **Rewrite** `ApexWeb/src/ui/practice.js` — the new screen, rendering from the practice snapshot.
- **Modify** `ApexWeb/src/main.js` — host practice state, `practice_run` handler, practice-snapshot broadcast, carry `ctx.practiceFindings` into the race.
- **Modify** `ApexWeb/src/ui/race.js` (small) — show the practice cliff/stop aid in the race HUD (optional final task).
- `ApexWeb/src/setup.js` — keep `closeness`/`paceBonus`/`trackIdeal`; `feedback` may move into `practice.js` (or be wrapped).

## Determinism

Every run is seeded (`weekendSeed + runId`) so a re-run is reproducible and tests are deterministic. No `Math.random`/`Date` in the run path. The practice RNG is separate from the race `rng`/`erng`.

## Testing strategy

`practice.test.js`:
- `longRun` produces a monotonically-rising deg curve and a `cliffLap` near the compound's cliff; `recommendedStops` is sane for the race length.
- `setupTestLap` noise amplitude grows as `consistency` drops (lower consistency → wider spread over N seeds).
- `feedbackLine` clarity: high `race_iq` names the worst axis far more reliably than low `race_iq` over N seeds.
- budget enforcement: a `practice_run` over budget is rejected (host-side helper).
- `analyzeFindings` aggregates correctly (best per compound, ideal-found %).
- determinism: same seed → identical run result.

`weekend.test.js` — practice phase still gates Practice→Quali.

Headless-verifiable: the run sim, skill, budget, findings, setup carry. **NOT headless (owner F5 playtest):** the live two-browser shared findings board over RPC.

## Open tunables (fix during implementation)

`PRAC_BUDGET 8`, `PRAC_COST {setup:1, long:3, quali:1}`, `LONG_RUN_LAPS 10`, the setup-test signal amplification, the skill noise/clarity weights. Calibrate so a thoughtful 8-unit plan can dial the setup AND learn the tyre story, but can't do everything.

## Out of scope (this pass)

FP1/FP2/FP3 multi-session; weather during practice; fuel-load run plans beyond the three types; setup templates / load-base-setup. Each could be a later pass.
