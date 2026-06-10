# Design — AI car development over the season + first-lap (Turn-1) incident

- **Date:** 2026-06-10
- **Status:** Approved (design); pending spec review → implementation plan
- **Author:** Claude (with Karim)
- **Origin:** Ideas borrowed from the open-source F1 manager **Pitwall_Flet**
  (see memory `pitwall-flet-reference`). GPLv3 — we take ideas/numbers, not code.
- **Project focus alignment:** CLAUDE.md current focus is *playability &
  challenge — tune/fix, don't add sprawling new systems*. Both features serve
  that: rivals stop being static (the player can't coast) and race starts gain
  drama. Neither adds a new sim primitive; both ride existing channels.

## 1. Goal

Two independent improvements, designed together, implemented in this pass:

1. **AI car development over the season** — the 10 rival teams improve their
   cars round-to-round so the grid evolves. Today every rival car is **static
   all season**: `F1_2026.team_car()` applies R&D deltas *only* for the player
   team (`_rd_team_idx`); the sole race-to-race change to rivals is a flat
   global `rival_skill_offset` (difficulty). This closes the open roadmap item
   "car development via R&D — the `CARS` table is currently static".
2. **First-lap / Turn-1 incident** — a seeded chance of a start/spin incident
   that shuffles the opening lap, adding variety and drama cheaply.

## 2. Key decisions (from brainstorm)

- **Development model: "Development + ATR catch-up."** All teams develop each
  round; the per-round rate follows the **same ATR curve already used for the
  player** (`ATR_SPEED_P1 = 0.75` … `ATR_SPEED_P10 = 1.15` — leader researches
  slower, backmarker faster). The grid evolves and *gently compresses* toward
  the finale, consistent with the FIA aero-testing-restriction rule we already
  model for the player.
- **Player development = the player's own R&D.** "All 11 teams develop" is the
  fiction; mechanically the player's progression is their R&D spend
  (`part_levels`). Auto-development applies to the **10 rivals only**. If the
  player under-invests, the 10 rivals out-develop them and they slide back —
  that is the intended "can't coast" pressure. A maxed-R&D player still finishes
  ahead. (Ceiling-vs-AI corridor pinned by the Python harness.)
- **Both features ship in this pass.**
- **No new sim primitives.** AI dev flows through `team_car()` scalars (so it
  interacts with `CAR_K` track-character bias + reliability/DNF automatically);
  the incident rides the existing events RNG (`erng`) — the same stream that
  rolls the safety car.

## 3. Feature 1 — AI car development

### 3.1 Storage (`f1_2026.gd`)

Mirror the existing player-R&D static state (`_rd_team_idx` / `_rd_delta_*` at
`f1_2026.gd:199-221`) with a **per-team** store:

- `static var _dev_deltas: Dictionary` — `team_idx (int) → {d_aero, d_power,
  d_energy, d_ch_rel, d_eng_rel}`.
- `static func apply_ai_dev(deltas: Dictionary) -> void` — twin of
  `apply_rd_upgrades()`; sets `_dev_deltas`. A sentinel/empty dict disables it
  (exhibition races, no season).
- In `team_car()` (`f1_2026.gd:322`), **after** the existing player-R&D block,
  add: if `_dev_deltas.has(ti)`, apply those 5 deltas with the same
  `minf(0.99, …)` reliability clamps. The player team is never inserted into
  `_dev_deltas`, so there is no double-count with the `_rd_*` path.

### 3.2 Schedule + accumulation (`season.gd`)

- New persisted state `ai_dev: Dictionary` — `str(team_idx) → 5-scalar dict`
  (string keys for JSON). Initialised to zero for every rival team in
  `configure()`.
- `_advance_ai_dev()` — called in `apply_results()` at the round bump
  (`season.gd:2390`, where `round_index += 1`). For each rival team:
  - `pos = team constructor position` (1-based).
  - `rate = atr_for_position(pos)` — reuse the ATR slope.
  - `gain` is split across the 5 scalars in the **same proportions as the
    player's R&D** (aero-heavy, smaller power/energy, reliability folded in) so
    AI dev and player R&D sit on one balance scale.
  - Add a tiny **seeded** jitter (LCG from a new `AI_DEV_SEED_MIX`, mixed with
    team_idx + round) so teams don't develop identically. Deterministic.
  - Accumulate into `ai_dev[str(team_idx)]`.
- `_team_positions()` helper — sum `standings` per team across the 22-driver
  grid, rank all 11 teams, return `team_idx → 1-based position`. Same shape as
  the existing `constructor_position()`. (Early season: all tied at 0 → all get
  mid ATR; fine.)
- `atr_for_position(pos)` helper — linear interpolation of `ATR_SPEED_P1 …
  ATR_SPEED_P10` across positions 1..11 (clamp/extrapolate the 11th).
- `apply_ai_dev()` (Season method, twin of `apply_car_rd()`) — pushes `ai_dev`
  into `F1_2026._dev_deltas`. Called from `configure()` and from
  `main.gd._make_sim` right beside the existing `apply_car_rd()` call
  (`main.gd:235`).

### 3.3 Constants (top of `season.gd`, data-driven)

`AI_DEV_BASELINE_AERO`, `AI_DEV_BASELINE_POWER`, `AI_DEV_BASELINE_ENERGY`,
reliability fold factors, `AI_DEV_SEED_MIX`. **Values are pinned by the Python
harness, not guessed.** Corridor targets:

- A midfield rival gains ≈ a couple of player aero-steps (`RD_AERO_STEP = 0.025`
  each) over the 5-round season.
- An **idle** player (buys no R&D) drifts back ~one grid row by the finale.
- A **maxed-R&D** player still finishes ahead of the developed field.
- The grid **gently compresses** (backmarker teams close on leaders) **without
  inverting** the driver-skill ladder (skill remains the dominant pace term,
  `SKILL_K = 3.0`).

## 4. Feature 2 — First-lap / Turn-1 incident

### 4.1 Where (`race_sim.gd`)

Uses the existing **events RNG `erng`** (seeded from `mix32(seed)`, already used
for the safety-car roll) — deterministic, host-authoritative-safe, reproducible
in the harness. **No new RNG stream.**

- At race start, one `erng` roll vs `T1_INCIDENT_BASE`. Probability is
  track-nudged (higher where `overtaking` is low / a tight first corner); a flat
  base is acceptable for v1.
- On trigger: seed-pick 1–2 cars and apply a **one-off time loss** (range
  const, ≈ 3–15 s) modelling a poor start / spin, dropping them down the order.
  Applied the **same way pit loss is** — **never** by assigning `lap` (respects
  the combat invariant; `combat_lap_check.py` must still pass).
- **Synergy:** an incident may raise this race's safety-car chance (we already
  have SC field-bunching + cheaper pits) — drama from existing machinery.
- Optional rare sub-case: a true DNF (off the back of the incident). Default
  **off** unless the harness/real-engine check shows it reads well.

### 4.2 Constants (top of `race_sim.gd`, data-driven)

`T1_INCIDENT_BASE` (probability), incident time-loss range, max cars affected,
optional SC-uplift factor, optional DNF sub-probability.

## 5. Cross-cutting

- **Determinism (load-bearing):** AI-dev jitter from a seeded LCG; incident from
  `erng`. No real time, no unordered dict iteration feeding the sim. Same seed →
  same race; underpins host-authoritative netcode + the Python harness.
- **Save/load:** add `ai_dev` to the season JSON dict (`str` keys, float
  values). Round-trip verified (Godot's int→float quirk is a non-issue here —
  all values are floats).
- **Netcode:** AI dev lives in season state + `F1_2026` static, primed before
  `make_field()` on the host; the host broadcasts state snapshots as today —
  clients need no change. The incident is inside the host's seeded sim.

## 6. Verification plan (per CLAUDE.md)

1. **`ai_dev_check.py`** (self-contained) — simulate 5 rounds of AI dev +
   mirrored race model; assert the §3.3 corridors: grid evolution, gentle
   compression, idle-player drift-back, maxed-player-stays-ahead. Pins the
   baseline constants **before** porting to GDScript.
2. **First-lap incident** — verify against the **real engine** via the godot MCP
   (`execute_gdscript`, one race per call): incident frequency ≈ target over N
   seeds, field ordering stays sane, lap bookkeeping intact.
3. **Invariant regression:** `combat_lap_check.py` still passes (completions ==
   lap; combat never assigns `lap`).
4. **Lint:** fresh-file `gdparse`/`gdlint` trick for new functions (mount-stale
   gotcha).
5. **Docs:** update `ApexDuo_Prototype/README.md` feature list + roadmap; this
   design doc is the reference.

## 7. Non-goals / out of scope

- Player car auto-development (the player develops via R&D — unchanged).
- Discrete Minor/Medium/Major upgrade packages, news/email feed for rival
  upgrades (a possible later polish; the "Development + ATR" model was chosen
  over the Pitwall-style discrete model).
- Rich-get-richer / rubber-band-to-player development models (considered,
  rejected in brainstorm).
- Multi-lap incident chains, full lap-1 collision physics. v1 is a single
  start/spin time-loss event.

## 8. Acceptance criteria

- [ ] Rival cars measurably improve across a 5-round season (verified numerically).
- [ ] ATR catch-up: backmarker teams develop faster than leaders; grid gently
      compresses without inverting the skill ladder.
- [ ] An idle player slides back; a maxed-R&D player stays ahead (corridors met).
- [ ] AI dev flows only through `team_car()` scalars (no flat skill bonus added
      to the sim).
- [ ] `ai_dev` survives save/load round-trip.
- [ ] First-lap incident triggers at ≈ the configured rate, shuffles lap 1, and
      does **not** violate the combat invariant (`combat_lap_check.py` passes).
- [ ] Determinism preserved: same seed → same race (AI dev + incident included).
- [ ] GDScript lints clean (fresh-file trick); README/roadmap updated.
