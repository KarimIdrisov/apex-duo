# Apex Duo — Sim Realism Research (deepening race_sim.gd)

Cited research brief comparing our race sim to real 2026 F1 and reference games
(Motorsport Manager, F1 Manager 2023/2024, Team Principal). Grounded in a full
read of `ApexDuo_Prototype/race_sim.gd` + `f1_2026.gd`. Date: 2026-06-09.

**Headline:** the model is already unusually deep for a prototype and in several
places **ahead** of the reference games. The biggest authenticity gap is the
defining 2026 dynamic — **batteries dying on the straights / lift-and-coast**.

## 1. Tyre model
- **Now:** single `tire_wear` 0–120, linear `wear*0.012` + a `cliff` knee
  (`+0.10`/unit past cliff), one `tyre_temp` scalar (cold deficit, hot extra-wear),
  per-driver tyre attribute. Global `COLD_TEMP`/`HOT_TEMP` (same for all compounds).
- **Real / refs:** two distinct modes — **graining** (cold sliding, surface rubber
  balls up, grip loss that **recovers** once temp comes in) vs **blistering**
  (overheating, permanent). Pirelli tunes **thermal deg** most aggressively; cliff =
  "fine, fine, fine, then half a second in two laps." Each compound has its **own
  operating window**; softer = faster warm-up, earlier cliff. Motorsport Manager
  models cold=graining-style extra wear + loss of save-bonus, hot=loss of push-bonus
  + extra wear + more mistakes (≈ our structure, but per-compound windows).
- **Verdict:** GOOD (warm-up deficit + overheat + cliff already). SHALLOW: one global
  window for all compounds; graining not a separate recoverable state.

## 2. Overtaking & dirty air
- **Now:** hold-up + `credit` accrual; `_pass_resist = 3.0 + 8.0*(1-overtaking)`;
  dirty-air `DA_COEF` (<0.7s) cuts pace, slipstream `SLIP_COEF` (<1.4s) adds it,
  Overtake boost negates dirty air + adds pass pressure.
- **Real / refs:** 2026 ground-effect cut reduces clean-vs-dirty delta → sustainable
  multi-lap battles, not one-shot DRS. **Overtake Mode** (rebranded Manual Override)
  = extra battery within 1s, deployable **anywhere** (not zone-locked). New reality:
  "DRS trains" become **battery-management trains** — a chaser who burns energy to
  attack arrives at the next straight flat ("power limit pending"), so passes don't
  stick. MMgr's 5s/lap dirty-air loss is unrealistic — we correctly avoided it
  (`DA_COEF=0.42`).
- **Verdict:** GOOD, arguably ahead of the games. MISSING: (a) the "spent your boost,
  now you're vulnerable" counter-swing — OT only ever helps the attacker; (b) no
  multi-car **train** sharing one DRS-equivalent (pairs resolved independently).

## 3. Strategy realism
- **Now:** undercut via fresh-tyre pace + cold out-lap (`TYRE_TEMP_START=0.20`); AI
  windows via strategist skill; cheaper SC pits; tyre/weather crossover.
- **Missing:** (a) **track evolution / rubbering-in** — no grip-over-time term, so an
  early and late stint on identical tyres are identical; (b) **overcut** weak (only
  raw `last_lt`, no explicit clean-air-vs-traffic delta feeding the AI); (c) no
  player **lift-and-coast / fuel-save** pace lever; (d) no explicit slow in-lap.
- Refs: a 0.4–0.6s warm-up deficit can negate an undercut; fresh tyres ~1–2s/lap.

## 4. 2026 power-unit & aero regs (verification) — mostly RIGHT
- ~50/50 ICE/electric: ✅ implied. No MGU-H: ✅ N/A. MGU-K 350kW: ✅ implicit.
- **Per-lap deploy budget = 8.5 units:** ✅ **matches the real 8.5 MJ/lap baseline.**
  `energy_limit`→~0.55 at Monza maps onto "FIA can cut deployable energy to ~5 MJ at
  energy-starved venues." Genuinely accurate.
- Active-aero Straight/Corner modes: ✅ (`aero_zones` + low-drag gain + SoC regen).
- Override within 1s, no zones: ✅. High-speed taper (~290 km/h): ✅ (`TAPER_K`).
- **WRONG / MISSING:**
  - **Lift-and-coast / straight-line "power-limit" cut** — *the* 2026 story. Real cars
    can't fully recharge on long straights and must lift early, **losing time on the
    straight itself**. Our `clipped` is a smooth per-lap penalty, not a mid-straight cut
    that makes Monza/Baku/Spa qualitatively different.
  - **Lift-and-coast as the strategic recharge lever** — abstracted in `harvest`, not
    surfaced as a decision.
  - **Override +0.5 MJ recharge bonus** — we model only the drain side.
  - Note: mid-2026 FIA lowered baseline 8.5→7 MJ. `DEPLOY_BUDGET_BASE` could drop to
    ~7.0; 8.5 is the published technical baseline and defensible.

## 5. Pace / lap-time & variability
- **Now:** modular sum + **uniform** noise `rangef(-amp,amp)`, `amp` narrowed by
  consistency. Quali wider + a discrete scrappy-lap.
- **Real / refs:** additive lap time is right (F1 Manager runs "thousands of scenarios
  per lap"). But scatter is **Gaussian**, not uniform — most laps near the mean, rare
  big errors in the tails. Uniform feels "twitchy-but-bounded"; a normal (sum-of-3
  uniforms, cheap + deterministic) + a rare fat-tail error matches reality and costs
  almost nothing.

## Prioritized recommendations (impact-per-effort)

| # | Improvement | Rough mechanic / numbers | Impact | Effort | Verify |
|---|---|---|---|---|---|
| 1 | **Track evolution / rubbering-in** | `track_grip` 0→1 over race: `-EVO_MAX*frac`, `EVO_MAX≈0.6s/lap`; softens after rain | Early stints slower, late pace creep, rewards overcut & late quali | **S** | Harness: laps trend ~0.5s faster end-vs-start |
| 2 | **Gaussian lap-time noise** | sum-of-3-uniforms (≈normal), same σ; +rare fat-tail p≈0.5% → +0.3–0.8s, gated by composure | Consistent-with-moments feel; sharper skill separation | **S** | Harness: per-lap delta histogram bell-shaped |
| 3 | **Lift-and-coast lever + straight-line clip** | L&C costs ~+0.15–0.25s/lap, recovers budget faster; budget=0 on high-`power` track → extra mid-lap power-limit penalty ∝ `track.power` | *The* 2026 dynamic; Monza/Baku/Spa play distinctly; rich co-op call | **M** | Harness: attack-every-lap loses net time vs managed |
| 4 | **Per-compound operating windows** | each compound `temp_lo/hi` + warm-up rate; targets off `track_temp` | Compound choice track-temp-dependent | **M** | Harness: soft grains cold, hard slow warm-up |
| 5 | **Graining as recoverable state** | `graining` 0..1 builds when cold under load, **decays** when temp recovers; pace penalty distinct from wear | Out-laps/cold cost grip that returns | **M** | Harness: cold out-lap graining decays 2–3 laps |
| 6 | **Overcommit counter-swing on OT** | after OT, debit extra budget → attacker likelier to hit straight-line clip next sector | Passing = calculated risk; less ping-pong | **S–M** | Real engine: OT spam self-limits |
| 7 | **Clean-air vs traffic in AI strategy** | weight stay-out/box by dirty-air (already in `_m_following`); pit into clean air | Smarter human-like pit calls | **S** | Harness: AI in a train pits earlier |
| 8 | **Override +0.5 MJ harvest bonus** | small SoC regen alongside OT drain | Chasers sustain pressure ~1 lap longer | **S** | Harness: OT sustainable +1 lap |
| 9 | **Slow in-lap + warm-up profile** | in-lap push penalty; 2–3 lap warm-up curve vs single cold lap | Undercut/overcut becomes temp-sensitive | **M** | Harness: undercut success track/temp-dependent |
| 10 | **Live deploy baseline (opt)** | `DEPLOY_BUDGET_BASE 8.5→7.0`, starved tracks →~5 | Tracks mid-2026 tweak | **S** | Harness regression |

**Do first:** #1 + #2 — both **S**, high realism, verifiable purely in the Python
harness. **Most important for 2026 authenticity:** #3 (lift-and-coast + straight-line
clip) — **M**, validate partly on the real engine.

## Build log — "упор на трассах" (track focus)
Plan agreed: **Direction A (track evolution + richer data) → then Direction B
(segment-based lap model).**

- ✅ **A — DONE (engine v0.8):** `#1` track evolution / rubbering-in shipped:
  `track.evolution` (0..1, street tracks high) + `EVO_MAX=0.8`; `race_frac` (leader
  progress) drives `lt -= EVO_MAX*evolution*race_frac*(1-wetness)` in `current_laptime`
  (rain washes the rubber). Added real per-track geometry — `TRACK_EVOLUTION`,
  `TRACK_CORNERS`, `TRACK_STRAIGHT_KM` (foundation for B). Track-character HUD strip
  now shows corners + longest straight + evolution tier. **Verified on the real
  engine:** per-track dry gain == `evolution*0.8` exactly (Монако +0.72 … Монца +0.32),
  rubber washes when wet, full-race determinism PASS.
- 🔶 **B — IN PROGRESS (engine v0.9):** segment-based lap model.
  - **B-1 DONE — segment profile + segment energy.** Each track now has a
    `segments` profile (alternating straights/corners) generated deterministically
    from the geometry (`_build_segments`): main/pit straight + corners, `frac` summing
    to 1, `seg_at(frac)` lookup. Verified sensible per track (Баку 53% straight / 32%
    main straight, Монца 54%, Монако 23% — corner-heavy). **Energy is now
    segment-shaped:** the per-lap deploy budget **drains on straights** (where you
    deploy) and **regens under braking in corners** (`CORNER_DEPLOY_REGEN=4.0`). So
    corner-heavy tracks recover and stay easy; straight-heavy tracks deplete and the
    ERS-attack benefit fades. **Verified on the real engine:** avg deploy budget
    8.27 (Монако) → 4.71 (Бахрейн) → 3.46 (Баку) → 3.18 (Монца), monotone with
    straight%; overtaking corridors intact (Монако 1.3); determinism PASS. Pace/clip/
    combat formulas untouched → lap-time calibration and corridors preserved.
  - **B-2 DONE — straight-line power cut + lift-and-coast (`#3`).** When a car is
    low on the per-lap deploy budget **while on a straight**, it suffers a power-cut
    penalty (`STRAIGHT_CLIP=1.2 × (starve − 0.22) × seg-intensity × power`) — the 2026
    "power-limit-pending" moment. **Lift-and-coast lever:** harvesting now banks the
    deploy budget (`HARVEST_BUDGET_REGEN=5.0`) so the engineer can coast to save energy
    for the straights (verified: harvest 2.34→4.68 banks, attack→0 drains). **Key fix —
    decoupled from combat:** the power-cut slows a car's *advance / speed / lap time*
    (it falls back over a stint) but is **subtracted from the pass-credit edge**
    (`power_cut_pen`), so it doesn't scramble the tuned overtaking corridors. **Verified
    on the real engine:** power-cut time-share 1.2% (Монако) → 11% (Бахрейн) → 16% (Баку)
    → 19% (Монца); overtaking corridors intact/restored (Монца 48.5, was 25 when coupled,
    B-1 baseline 42); determinism PASS. Player cue: leaderboard КМ/Ч cell turns orange
    while power-limited.
  - **B-3 DONE — segment-aware overtaking.** Pass-credit now builds ~4× faster on
    straights than in corners (`PASS_STRAIGHT_BIAS=1.0` / `PASS_CORNER_BIAS=0.25`),
    **normalized per track so the lap-average is 1** → passes concentrate at braking
    zones without changing corridor totals. **Verified on the real engine:** corridors
    intact (Монако 1.5, Бахрейн 31, Монца 42.8, Баку 43 — all in range); **73–84% of
    completed passes now happen on a straight**; determinism PASS.
  - **B-4 DONE — energy zones on the minimap.** The map now highlights **Overtake
    zones** (blue straights) and **harvest/braking markers** (green, at the end of the
    long straights → corner entry) with a small **legend**, so the deploy→harvest rhythm
    reads off the map. (Verified via the headless capture harness.)
  - ⏭️ **Open:** slipstream tow stronger specifically on straights; `#6` OT overcommit swing.

### `#4/#5` Tyre operating windows + graining — DONE (engine v0.13)
- **#4 per-compound windows:** each compound now has its own `tlo`/`thi` operating
  window + `warm` warm-up-rate (soft: heats fast, narrow/low window, overheats sooner;
  hard: heats slowly, wide/high window). `_m_thermal` uses the window; wear-overheat uses
  the compound's `thi`. Calibrated so all compounds are usable at a normal ~30° track
  (hards just need a warm-up), with the optimum flipping at extremes.
- **#5 graining (recoverable):** a separate `graining` 0..1 that builds when the tyre runs
  BELOW its window under load (cold sliding) and DECAYS once temp comes back in — distinct
  from permanent wear; costs grip (`GRAIN_PACE`) + a little extra wear (`GRAIN_WEAR`);
  tyre-smart drivers grain less; resets on a fresh set.
- **Verified on the real engine (Монца laptime, track-temp sweep):** soft warms faster
  than hard at every temp; cold 14° → soft 0.57s vs hard 2.54s penalty (softs preferred);
  hot 46° → hard 0.0 vs soft overheating (hards preferred); graining recovers (30° hard
  0.38→0, 46° hard 0.16→0); corridors intact (Монако 2.0, Монца 43); determinism PASS.

### `#2` Gaussian lap noise — DONE (engine v0.12)
Replaced the uniform per-lap noise `rangef(-amp,amp)` with a **sum of 3 uniforms ≈
normal** at the SAME std (`u = amp/√3`). Most laps cluster near the mean with rarer
bigger deviations in the tails — drivers feel consistent-with-moments, not
twitchy-uniform. **Verified on the real engine:** distribution 37% within 0.5σ
(uniform 29%), **67% within 1σ (Gaussian ≈68)**, 96% within 2σ, tails to 2.9σ (uniform
1.73); std unchanged; overtaking corridors in range (Монако 2.0, Монца 40.7, Баку 37.3);
determinism PASS.
- Still open from the table: `#2` Gaussian noise (S, independent of tracks), `#4/#5`
  per-compound windows + graining, `#6` OT overcommit swing.

## Sources
- formula1.com — 2026 power units explainer
- raceteq.com — 2026 energy system (8.5 MJ/lap, 4 MJ deploy, +0.5 MJ Override) · tyre deg science
- speedcafe.com — 8.5→7→5 MJ mid-season tweaks
- planetf1.com — superclipping / battery on straights
- espn.com — Overtake Mode terminology
- sportsnaut.com — 2026 dirty air
- thef1db.com — graining vs blistering · fastestpitstop.net — heat/cold tyres
- themotorsportmetrics.com / motorsport.com — undercut vs overcut
- motorsportmanagerpc.fandom.com — tyre temp & fuel · news.xbox.com — F1 Manager 2024 sim data
