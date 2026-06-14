# ApexWeb Practice Depth — Design Spec

**Date:** 2026-06-14
**Status:** approved (design), pending implementation plan
**Area:** ApexWeb live Practice (`src/practice_session.js`, `src/setup.js`, `src/ui/practice.js`, `src/main.js`, `src/data.js`, `style.css`)

## Goal

Make Practice a meaningful three-session activity instead of a one-session formality, and redesign its screen for desktop. Four owner asks from the F5 playtest:

1. Too easy — the car is fully set up in one session; add depth/challenge.
2. Pit-prep time should be dynamic — scale with stint length (laps) and whether the tyre compound changed (on top of the existing setup-change cost).
3. Add a "track learned" indicator that grows with laps and rewards lapping.
4. Redesign the Practice screen to be PC/desktop-friendly (it currently reads as mobile-first, single column).

## Why it's too easy today

Per-axis setup `knowledge` banks at `KNOW_PER_LAP 0.06`/lap (≈17 laps to max). The revealed ideal window (`windowFor`) narrows to `MIN_HALF 0.02` and its centre converges **exactly** to the hidden optimum (`centre = opt + jitter·WIN_JITTER·(1-k)`, → `opt` at k=1). So in one ~18-lap session a player banks full knowledge, the window collapses onto the truth, and following the window centre yields ~100% satisfaction. There is no residual uncertainty and nothing that spans P1→P2→P3. Also: laps bank **all** axes equally (a stint isn't "an axis"), so per-axis knowledge is already uniform — effectively one scalar wearing six hats.

## Decisions (owner-approved)

- **Core mechanic:** a single per-driver **track knowledge** that GATES setup precision *and* gives a pace buff. (Not a parallel independent buff; not drifting conditions.)
- **Pace/curve:** ~3 sessions to max. P1 ≈ 40% track / 60% setup, P2 ≈ 70% / 80%, P3 ≈ 100% / 95-100%.
- **Dynamic pit-prep:** tyre-change (compound-dependent) + fuel-by-laps + setup-apply.
- **Layout:** Variant A — full-width header, large setup widget left, narrow right column (metrics / stint / strategy / partner), collapses to one column on narrow screens.

## 1. Track knowledge (new core)

Replace the per-axis `knowledge[]` array with a single scalar `trackKnow` ∈ [0,1] per car. (Per-axis knowledge was always uniform, so this loses nothing and simplifies the model and UI.) Persists across P1/P2/P3 like the old knowledge did (kept on session reset).

- **Banking:** on each completed flying lap, `trackKnow = min(1, trackKnow + TRACK_PER_LAP · feedbackMult(car))`, reusing the existing `feedbackMult = 0.75 + IQ_LEARN·race_iq` (a sharp driver learns the track faster too). Auto-sim banks at `AUTOSIM_MULT` like setup knowledge does.
- **Gate on setup precision:** `windowFor` is driven by `trackKnow` instead of per-axis knowledge. So all six axis windows widen/narrow together as you lap, and their centres carry the same `(1-trackKnow)` jitter. Below `KNOW_VAGUE` the feedback still reads "мало кругов". Consequence: at low track knowledge even infinite laps leave wide, off-centre windows → a perfect setup is unreachable until you've learned the track.
- **Confirmation unchanged:** per-axis `lapsOnVal[]` + `confirmedSat[]` stay. Satisfaction is still confirmed only after `CONFIRM_LAPS` flying laps on a value, and `confirmedSat[i] = axisSat(setup[i], ideal[i])` (true closeness). The gate works because the player navigates via the *revealed window*, which is off-centre at low track knowledge — they can't knowingly beat it. (A lucky probe can; that's acceptable skill expression.)
- **Pace buff:** add `trackBonus = TRACK_PACE · trackKnow` to the player's race pace, on top of the existing satisfaction `setupBonus`. So after setup is maxed for the current track knowledge, more laps still help (higher trackKnow → faster). AI cars get a **baseline** `trackBonus` at an assumed `AI_TRACK_KNOW` (they "know" the track), so the player's practice is a *delta* — good practice pulls ahead, skipped practice falls behind — not a free flat advantage.

### Tuning targets (verified in the corridor, tune to hit)

- `TRACK_PER_LAP ≈ 0.022` (×feedbackMult) → ~0.4 after P1's ~18 laps, ~0.7 after P2, ~1.0 after P3.
- `WIN_JITTER 0.30 → ~0.40`. With the bell `axisSat = 1-(error/SAT_TOL)²` and `error ≈ 0.5·WIN_JITTER·(1-trackKnow)`, this lands mean setup satisfaction ≈ 60% at trackKnow 0.4, ≈ 85% at 0.7, 100% at 1.0. (Current 0.30 gives ~75% at 0.4 — too easy.)
- `TRACK_PACE ≈ −0.08 s/lap` at full knowledge; `AI_TRACK_KNOW ≈ 0.7`. Net: a perfect 3-session practice gives the player ≈ −0.08 vs the AI's ≈ −0.056 baseline → a modest, earned edge. Tune against a real race so the player isn't auto-winning.

## 2. Dynamic pit-prep

Replace the flat `PIT_PREP_SEC 45` with a composed, decision-sensitive cost. On `sendRun(player, compound, laps)`:

```
prep = (compound !== lastCompound ? TYRE_CHANGE_SEC : TYRE_REFIT_SEC)   // new compound costs more
     + FUEL_PER_LAP · laps                                              // longer stint = more fuel load
     + SETUP_APPLY_SEC · Σ|setup − lastRunSetup|                        // unchanged setup-apply term
```

Track `car.lastCompound` (the previous stint's compound; starts unset → first run counts as a change). Deduct from the clock (clamped ≥ 0) as today; clear `lastCompound = compound` and `lastRunSetup = setup` after.

Starting consts: `TYRE_CHANGE_SEC 30`, `TYRE_REFIT_SEC 12`, `FUEL_PER_LAP 2`, keep `SETUP_APPLY_SEC 35`. Examples: 10-lap new-compound run ≈ 30+20+setup ≈ 50s+; 5-lap same-compound ≈ 12+10+setup ≈ 22s+. Retire the flat `PIT_PREP_SEC`. autoSim charges a flat `TYRE_CHANGE_SEC` once (its single notional pit-out) — keep it simple.

The snapshot keeps exposing `prepCost` (computed for the *currently selected* compound + laps, so it updates as the player changes the stint picker); the run button shows the `−Xс` total and the right-column stint card shows the breakdown (shины / топливо / настройки).

## 3. Track-learned indicator + screen redesign (Variant A)

**Metrics:** the right column leads with two bars — **Знание трассы %** (the new headline) and **Удовлетворённость %** — as labelled progress bars (metric-card style). The six per-axis knowledge bars are removed (knowledge is global now); each axis row keeps its name/char, the ideal-window band + slider, the feedback chip, and a confirmed/unconfirmed tick.

**Layout (`ui/practice.js` + `style.css`):**
- Full-width **header**: large clock, ×1/2/4/8 + pause, "просимулировать остаток", state chip (в боксах / на трассе · круг N · compound).
- **Left (wide, ~1.5fr):** the setup widget — six axis rows, the centrepiece.
- **Right (~1fr):** stacked cards — [Знание трассы + Удовлетворённость], [Выезд: compound + laps + «Выпустить · −Xс» + cost breakdown], [Стратегия: deg curve], [Напарник %].
- CSS grid `grid-template-columns: 1.5fr 1fr` with a `@media (max-width: 760px)` collapse to a single column (mobile keeps working). Use `minmax(0, …)` to avoid overflow.
- The 15Hz repaint gate (`liveSig` in `main.js`) must include `trackKnow` (rounded) so the meter updates on laps; the clock keeps patching in place.

## Const summary (PRAC2)

Add: `TRACK_PER_LAP`, `TRACK_PACE`, `AI_TRACK_KNOW`, `TYRE_CHANGE_SEC`, `TYRE_REFIT_SEC`, `FUEL_PER_LAP`. Change: `WIN_JITTER 0.30 → 0.40`. Remove: `PIT_PREP_SEC` (replaced by the dynamic prep) and `KNOW_PER_LAP` (replaced by `TRACK_PER_LAP`; the model no longer banks per-axis knowledge). Keep `MAX_HALF/MIN_HALF/WIN_P` (now driven by trackKnow), `KNOW_VAGUE`, `CONFIRM_LAPS`, `SAT_TOL`, `AUTOSIM_MULT`, `IQ_LEARN`.

## File-by-file

- `src/data.js` — PRAC2 const changes above.
- `src/setup.js` — `windowFor`/`feedbackFor` take `trackKnow`; signatures unchanged in shape (still a 0..1 scalar), just fed the global value. `axisSat`/`satisfaction`/`idealFor`/`trackIdeal` unchanged.
- `src/practice_session.js` — car carries `trackKnow` (scalar) + `lastCompound`; `completeLap`/`autoSim` bank trackKnow; `windowFor(car.trackKnow, …)`; dynamic `prepCostFor(car, compound, laps)`; snapshot exposes top-level/per-car `trackKnow` and the axis objects drop `knowledge`.
- `src/main.js` — race pace buff = `pracSetupBonus(player)` + `TRACK_PACE·trackKnow`; AI field gets baseline `TRACK_PACE·AI_TRACK_KNOW`; `liveSig` includes `trackKnow`; `prepCost` preview uses the selected compound+laps.
- `src/ui/practice.js` — Variant A 2-column layout; track-knowledge + satisfaction metric bars; per-axis rows lose the knowledge bar; stint card shows the prep breakdown.
- `style.css` — practice dashboard grid + responsive collapse; metric bars.
- Tests — `tests/practice_session.test.js`: trackKnow banking + gate (window wider at low trackKnow), dynamic prep (compound change vs same, laps scaling). `tools/balance.mjs`: extend the convergence corridor to assert the P1/P2/P3 curve (one session ≈ 60% setup, three ≈ 95%+; track knowledge ≈ 0.4/0.7/1.0).

## Verification

- Unit (Node): trackKnow growth is deterministic and reaches ~1.0 over ~55 laps; `windowFor` half-width at trackKnow 0.4 is materially wider than at 1.0; `prepCostFor` exact for (new vs same compound) × (laps) × (Σ|Δsetup|).
- Balance corridor: good-policy after **1** session ≈ 60% satisfaction (not ~100%), after **3** ≈ 95%+; track knowledge ≈ 0.4 / 0.7 / 1.0 per session; auto-sim still clearly worse. Race corridors (DNF, spread) unchanged.
- In-browser (cache-busted imports + a real solo drive): the 2-column layout renders, collapses under 760px; the track-knowledge meter rises with laps; controls stay clickable (the gate already handles this); a perfect practice gives a sane race pace edge, not domination.

## Out of scope / deferred

- Per-axis *independent* learning (run-this-corner) — laps bank globally; not pursued.
- Practice "programs" (aero/tyre/race-sim objectives, F1-Manager style) — possible later layer.
- Drifting ideal across sessions (weather/temperature) — rejected for this pass.
- The race-screen 15Hz rebuild gate extension (race HUD) — separate from Practice.

## Open questions for the plan

None blocking. Magnitudes (`TRACK_PER_LAP`, `WIN_JITTER`, `TRACK_PACE`, pit-prep consts) are starting points to tune against the corridor and one real race; the plan should sequence the math + corridor before the UI so numbers are locked first.
