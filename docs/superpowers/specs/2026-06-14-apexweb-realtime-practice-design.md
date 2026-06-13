# ApexWeb — Real-time Practice (F1-Manager-style) — Design

**Date:** 2026-06-14
**Status:** approved (brainstorm) — ready for implementation plan
**Supersedes:** the run-plans practice (`2026-06-13-apexweb-practice-redesign-design.md`) as the *screen model*; reuses its deg-curve chart and race-HUD aid.

## Goal

Replace the click-to-run "run plans + budget" practice with an **F1-Manager-style real-time
practice**: a live session clock you pause and fast-forward, **6 setup axes**, you send the car
out on stints, and **the driver banks "setup knowledge" each lap** — a hidden per-axis optimum is
revealed through a **narrowing "ideal window"** plus driver feedback, converging to a
**satisfaction %** that buffs qualifying and the race. **Three sessions P1/P2/P3.** Symmetric
co-op: **each player owns one car** (own setup, own runs, own knowledge).

## What changes vs today

| Area | Today (run-plans) | New (real-time) |
|---|---|---|
| Interaction | click a run (setup/long/quali), spend from budget 8, instant result | live session clock; set setup, send car on a stint, watch laps accrue knowledge |
| Setup | 3 axes (Прижим/Передачи/Подвеска), `closeness`→`paceBonus` | **6 axes**, hidden per-axis optimum, **knowledge + narrowing window + feedback**, **satisfaction %** |
| Sessions | 1 practice | **3 sessions P1/P2/P3** (knowledge carries over) |
| Co-op | shared findings board | **per-car** (own setup/knowledge); session clock + ready-gate shared |
| Strategy data | the deg board IS the screen | a **by-product panel** (reuse `degChartSVG`) of running stints |
| Output to race | `setupBonus` from closeness | `setupBonus` from **confirmed satisfaction**; strategy → HUD aid (kept) |

**Kept / reused:** `degChartSVG` (strategy-data panel), the race-HUD `practiceFindings` aid, the
per-lap pace+deg math (`practiceLapBase`, `tyres.js`, `fuel.js`), the host-authoritative netcode
pattern, the real-time accumulator from the race loop.

**Retired:** the budget model (`PRAC_BUDGET`/`PRAC_COST`), the instant `runQuali`/`runSetupTest`
as the screen interaction, the shared findings board layout. The lap-math inside `runLong` is
folded into the session loop.

## The setup model — 6 axes

Setup values stay **normalized `[0,1]`** (as today) for engine simplicity; UI labels them in F1
terms. Each axis maps 1:1 to one handling **characteristic** (this is what makes the narrowing
window legible).

| Axis (RU UI) | Characteristic (RU UI) |
|---|---|
| Переднее крыло | поворачиваемость (turn-in) |
| Заднее крыло | прямые / стабильность сзади |
| Подвеска | тяга на выходе |
| Развал колёс | держак в поворотах |
| Передаточные числа | разгон / тормозные зоны |
| Тормозной баланс | стабильность в торможении |

**Hidden optimum** per **(car, track, driver)**: extend today's `trackIdeal(seed)` to 6 axes,
derived from the track's character (downforce vs power, `TRACK.pw/df`) plus a small
**per-driver** jitter (so the two cars' optima differ slightly — F1M behaviour). Deterministic
from a weekend seed; fixed for the whole weekend (P1–P3 share it).

## The knowledge loop (the core mechanic)

Per car, per axis, track three numbers: `knowledge ∈ [0,1]`, `confirmedValue` (the setup value
the car has actually run enough laps on), and `confirmedSat ∈ [0,1]`.

1. **Banking knowledge.** Each *completed flying lap* on the current setup adds
   `KNOW_PER_LAP × feedbackMult(driver)` to every axis's `knowledge` (capped at 1).
   Longer stints → more laps → more knowledge. `feedbackMult` scales with the driver's
   `race_iq`/`consistency` (a sharp driver learns the car faster and reads it cleaner).

2. **The narrowing window (what the player sees).** Each axis shows an *ideal window* on its
   slider: `center = optimum + jitter`, `halfWidth = MAX_HALF × (1 - knowledge)^WIN_P`.
   - `jitter = (1 - knowledge) × NOISE × signed(seed,axis)` — at low knowledge the window is
     **wide and off-centre** (ambiguous); as knowledge → 1 it **tightens and homes onto the
     true optimum**. `MAX_HALF ≈ 0.45` (≈ whole range), floor `≈ 0.02`.
   - Below a `knowledge` floor (`KNOW_VAGUE ≈ 0.25`) the axis reads "мало кругов / почти нет
     данных" and shows no usable window.

3. **Feedback line.** Compares the current slider to the revealed `center`, clarity scaled by
   knowledge + `race_iq`:
   - in-window → **«оптимально»** (green);
   - outside, clear → directional **«← чуть меньше» / «нужно жёстче →»** (amber, points to
     `center`);
   - low knowledge → vague **«мало кругов»** (grey).

4. **Confirm-after-laps (F1M rule).** Satisfaction only counts for a value the car *ran on*.
   Changing a slider marks the axis **"не подтверждено"**; after `CONFIRM_LAPS` flying laps on
   the new value, `confirmedValue ← value` and `confirmedSat ← sat(value, optimum)`.
   `sat = clamp(1 - (|value-optimum| / SAT_TOL)^2, 0, 1)`.

5. **Overall satisfaction** `= mean(confirmedSat over 6 axes) × 100`. Per-axis ≥75% is "good";
   100% overall is the target and grants the full race buff. Un-run changes don't count — you
   must test.

## Sessions P1/P2/P3

- Three sessions, each `SESSION_MIN ≈ 30` game-minutes. `knowledge`, `confirmed*`, strategy data
  and acclimatisation **carry across** P1→P2→P3 (cumulative); the hidden optimum is fixed for the
  weekend. Ready-gate advances P1→P2→P3→quali (both players).
- **Tyre/fuel** per car is a limited inventory across the three sessions (a few sets) — a soft
  resource so you can't run infinitely; running stints costs sets.
- **Acclimatisation/preparation**: grows with total laps run (capped) → a tiny race pace buff,
  separate from setup satisfaction (the "you ran the track" reward).

## Time controls

- Clock counts **down** `SESSION_MIN`. Speeds: **pause, 1×, 2×, 4×, 8×** (multipliers over a base
  `SIM_RATE`, same real-time `dt` accumulator as the race loop in `main.js`).
- **«Просимулировать остаток»**: fast-forwards to session end, banking knowledge as if running the
  current setup but at `AUTOSIM_MULT ≈ 0.8×` rate (simulating underperforms — rewards hands-on
  play, as in F1M).

## Co-op / netcode

- **Per-car.** Each player owns their car's 6-axis setup, its runs, knowledge, confirmed
  satisfaction, and strategy data. The two cars have **different hidden optima** (per-driver).
- **Host-authoritative**, mirroring the race netcode. The host runs the **session sim loop**
  (a `practiceLoop` like `hostLoop`): a real-time `dt` accumulator advances both cars' laps in
  accelerated time, banks knowledge, and broadcasts a **practice snapshot**
  (clock, speed, paused, per-car `{setup, onTrack, lap, compound, knowledge[6], window[6],
  feedback[6], confirmedSat[6], satisfaction, strategyData}`).
- **Client → host commands** (via `ctx.send`, applied in `onCommand`): `set_axis {car, i, value}`,
  `send_run {car, compound, laps}`, `set_speed {value}`, `toggle_pause`, `auto_sim`, `ready`.
- The screen renders the **local player's** car; a compact read-only peek at the partner's
  satisfaction/clock keeps co-op shared awareness.

## Outputs into quali/race

- **Satisfaction → `setupBonus`.** Replace today's `closeness→paceBonus` with
  `satisfaction→setupBonus` (same scale/sign: 100% ⇒ today's best bonus; lower ⇒ less). Applied in
  `quali.js` (setup_q term) and `main.js buildField` for the race, per car.
- **Strategy data → race HUD aid.** Reuse the existing `practiceFindings` plumbing
  (cliff/recommended-stops) → `#d-prac-aid`. The session's long stints produce it.
- **Acclimatisation → tiny race pace buff** (small, capped).

## Architecture / files

- `src/setup.js` — grow to **6 axes** (`AXES` array of 6 `{name, char}`); `trackIdeal6(seed)` →
  per-axis optimum (track character + per-driver jitter); `axisSat(value, opt)`,
  `windowFor(knowledge, opt, seed, i)`, `feedbackFor(value, center, knowledge, raceIq)`.
  **Replace** `closeness`→`paceBonus` with `satisfaction`→`setupBonus` (the pace term keys off
  confirmed satisfaction, not raw closeness); keep `paceBonus`'s scale/sign so the race corridor
  is unchanged.
- `src/practice_session.js` (**NEW**) — pure, deterministic session model. State + `step(dt)`
  (advance laps in accelerated time, bank knowledge, recompute windows/feedback/confirmedSat),
  and reducers `setAxis`, `sendRun`, `autoSim`, `tickClock`. Reuses `practiceLapBase`, `tyres.js`,
  `fuel.js` for per-lap pace + deg. No `Date.now`/`Math.random` (seeded).
- `src/practice.js` — keep `degChartSVG` data shape + the per-lap deg math; drop the instant
  run-sim *interaction*. (May be merged into `practice_session.js`.)
- `src/ui/practice.js` — **rewrite** to the live-session screen (HeroUI dark, per the mockup):
  header (clock + speed pills + pause + auto-sim), the **6-axis setup widget** (slider with the
  narrowing ideal window + feedback chip + per-axis knowledge bar), a stint picker (compound +
  laps + «Выпустить»), the **strategy-data panel** (reuse `degChartSVG`), a satisfaction summary,
  partner peek, and ready.
- `src/main.js` — host `practiceLoop` (rAF, real-time `dt`), command handlers, snapshot
  broadcast; `onPhaseHost` per session; wire `setupBonus` from satisfaction into `buildField`.
- `src/weekend.js` — **3 practice phases** P1/P2/P3 in the state machine + ready-gate each.
- `src/data.js` — new consts: 6-axis ranges/labels, `KNOW_PER_LAP`, `MAX_HALF`, `WIN_P`,
  `KNOW_VAGUE`, `CONFIRM_LAPS`, `SAT_TOL`, `SESSION_MIN`, speed steps, `AUTOSIM_MULT`,
  acclimatisation cap.
- `src/race.js` HUD aid — unchanged (reuse).

## Determinism & testing

- Seeded; same seed + same command sequence → identical session. The real-time clock only decides
  **how many** sim-steps run; each step/lap outcome is deterministic. Tests drive `step(dt)` with
  fixed `dt`.
- **Unit (`practice_session.test.js`):** knowledge rises with laps and caps at 1; window
  half-width shrinks monotonically with knowledge and centres on the optimum as knowledge→1;
  satisfaction only updates after `CONFIRM_LAPS` on a value (confirm-after-laps); feedback points
  toward the optimum; auto-sim banks less knowledge than hands-on; determinism (same
  seed+commands ⇒ identical); driver `race_iq` raises learn rate / feedback clarity.
- **Unit (`setup.test.js` extended):** 6-axis ideal in range; per-driver optima differ; `axisSat`
  bell-curve; perfect setup ⇒ satisfaction ~100%.
- **Balance (`tools/balance.mjs`):** *convergence corridor* — a "good" tuning policy reaches
  **≥75% on all 6 axes within ~2 of the 3 sessions** (not trivial, not impossible); full auto-sim
  reaches only **~60–70%**; the race `setupBonus` from satisfaction stays within today's pace
  corridor (no balance regression in the race sim).

## Balance targets (first cut, tune in implementation)

- `SESSION_MIN ≈ 30`, lap ≈ 80 s game-time, speeds up to 8× → ~20 laps/session of running.
- `KNOW_PER_LAP ≈ 0.06` (sharp driver ~0.08) → a tight window (~knowledge 0.8) in ~10–14 laps/axis.
- `CONFIRM_LAPS ≈ 2`, `SAT_TOL ≈ 0.18`, `MAX_HALF ≈ 0.45`, `WIN_P ≈ 1.5`, `AUTOSIM_MULT ≈ 0.8`.

## Out of scope (v1)

Weather-dependent optima; setup presets/sharing UI beyond the partner peek; component wear/penalty
management; a separate quali vs race setup fork (single optimum for v1). These are backlog.

## Migration notes

- `setup.js` consumers (`quali.js`, `main.js buildField`, the old `practice.js`/`ui/practice.js`)
  move from 3-axis closeness to 6-axis satisfaction in lockstep.
- Update `README.md` (Practice section → real-time sessions) and the practice memory.
- Scope: large — the implementation plan will sequence it (setup-6 → session model → host loop +
  netcode → screen → 3-session weekend flow → quali/race wiring → balance → docs).
