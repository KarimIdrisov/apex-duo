# Apex Duo — Game Completion Design
**Date:** 2026-06-11  
**Status:** Approved — ready for implementation

## Overview

Five new/improved systems that turn the current prototype into a playable FM-style endless career mode, modelled after Motorsport Manager (PC, 2016) but with symmetric co-op.

Season length: 25 rounds (real 2026 calendar) — **done**.  
Timer-based qualifying — **done**.

---

## 1. HQ Buildings (`season.gd` + `season_hub.gd`)

Persistent team base with 9 buildings (3 levels each). Buildings survive season resets. One build per period (between two races), cost paid immediately.

### Data model (in `season.gd`)

```gdscript
# hq_levels: Dictionary  building_id -> level (0=unbuilt, 1/2/3)
# hq_building_in_progress: String  building id being built ("" = none)
# hq_build_completes_after: int  race_index when build finishes
```

### Buildings table

| ID | Name | Lvl 1 | Lvl 2 | Lvl 3 | Unlock |
|----|------|--------|--------|--------|--------|
| factory | Завод | rd_speed ×1.15, $300k | ×1.30, $500k | ×1.50, $800k → unlocks telemetry | — |
| design_centre | Дизайн-центр | +0.010 aero base, $350k | +0.020, $600k → unlocks commercial | +0.030, $900k | — |
| wind_tunnel | Аэродинамическая труба | aero-R&D ×1.20, $400k | ×1.40, $650k | ×1.60, $1.0M | — |
| simulator | Симулятор | FP1 eng_base +0.15, $400k | all FP +0.15, $600k | all FP +0.25, $850k | — |
| pit_workshop | Мастерская пит-крю | pitstop −0.10s, $300k | −0.20s, $550k | −0.30s, $800k | — |
| academy | Академия | 1 scout/season, $350k | 2 scouts, $600k | 3 scouts, $950k | — |
| telemetry | Телеметрия | tyre-life estimate, $500k | pit-window HUD, $750k | predictive model, $1.1M | factory Lvl 3 |
| commercial | Коммерческий отдел | sponsors +20%, $450k | +35%, $700k | +50%+$100k/race, $1.0M | design_centre Lvl 2 |
| weather_centre | Метеоцентр | exact forecast, $400k | quali forecast too, $600k | instant rain alert, $850k | season ≥ 3 |

### Effects wired into existing scalars

- `factory.lvl` → multiplies `rd_speed_mult` in `season.gd`
- `design_centre.lvl` → adds flat bonus to `car_base_aero` (new field, added to `team_car()`)
- `wind_tunnel.lvl` → multiplies aero-branch R&D speed
- `simulator.lvl` → `eng_base_bonus` read by practice phase
- `pit_workshop.lvl` → subtracted from pit crew time scalar
- `commercial.lvl` → multiplier on sponsor income in `_end_race_income()`

### UI (new tab in `season_hub.gd`)

New "БАЗА" tab. Grid of 9 building cards. Each card shows: name, current level visual (0–3 pips), effect summary, cost + build time. Button "Построить Ур.N" (disabled if already building or insufficient funds).

---

## 2. Random Events (`season.gd` + `season_hub.gd`)

One event popup appears in the paddock before each race (70% chance). Binary A/B choice. Deterministic from `race_seed + event_rng`. No "correct" answer — always a trade-off.

### Data model

```gdscript
# pending_event: Dictionary  {type, title, body, option_a, option_b}  or {}
# Shown as modal at start of hub scene; resolved before race.
```

### Event generation

```python
EVENT_TYPES = [
  "engineering",  # money ↔ temp perf boost
  "sponsor_bonus", # guaranteed ↔ conditional extra
  "driver_conflict", # money ↔ morale
  "part_failure",  # money ↔ DNF risk
  "staff_offer",   # keep ↔ rival poaches
  "media",        # morale / no effect
  "rule_vote",    # vote for/against (1×/season)
]
```

Each type has 3–5 template strings with fill-in numbers from the seed. Consequences applied immediately on choice (morale delta, budget delta, temp car bonus dict valid for N races).

### Active effects carried in season state

```gdscript
# active_event_effects: Array[Dictionary]
# Each: {type, magnitude, expires_after_race: int}
# Applied in team_car() / _end_race_income() / practice setup
```

---

## 3. Visible Car Stats — upgrade preview (`season_hub.gd`)

In the "БОЛИД" paddock tab, replace the plain text R&D list with:

- 4 horizontal bars: Power / Aero / Energy / Reliability (0–1 scale, labelled)
- Each bar shows current value (filled) + pending upgrade delta (green overlay)
- Below bars: track affinity list (current calendar races, icon ↑↑/→/↓)
- "Compare with field" mini-chart (horizontal bars for all 11 teams) — unlocked by Design Centre Lvl 1

No new data — just visualises existing `team_car()` scalars already in `season.gd`.

---

## 4. Weather in the race (`race_sim.gd`)

Four states: `dry` → `variable` → `rain` → `storm`.

### Trigger

`wet_prob` already exists on every Track. Weather is sampled from `erng` (existing events stream) at race start. Transition laps drawn from the same stream.

```gdscript
# weather_state: "dry"/"variable"/"rain"/"storm"  (new field on RaceSim)
# weather_change_lap: int  lap when next transition happens (NO_CHANGE = 99999)
```

### Pace penalty for wrong compound

| Track state | Slick | Inter | Wet |
|-------------|-------|-------|-----|
| dry | 0 | +3.0s | +6.0s |
| variable | +1.5s | 0 | +2.0s |
| rain | +4.0s | +0.5s | 0 |
| storm | +8.0s | +2.0s | 0 |

Penalty added to `_car_pace()` based on `d.compound` vs `weather_state`.

### Track evolution reset

When state transitions to `rain` or `variable`: `track_evo` resets to 0 (wet surface = green track). Existing mechanic, just call the reset.

### Tyre change under SC/VSC

AI and player can switch compounds when a pit stop is taken. Weather alert in event feed when state changes.

### Forecast

Without Weather Centre HQ: show "Вероятность дождя: N%" only.  
Weather Centre Lvl 1: show exact lap and intensity.

---

## 5. Transfer Market improvements (`season_hub.gd`)

Replace the current top-5 driver list with:

- Full free-agent list (all non-contracted drivers) + drivers with expiring contracts (last 3 races of season)
- Each entry shows: name, age, skill rating ★, contract status, transfer fee
- **Without Academy Lvl 2 (scout)**: exact attributes hidden — show ★ rating only with ±1 uncertainty
- **With scout**: full attributes revealed
- Offer flow: click → confirm cost → driver evaluates (1 race wait) → accept/reject based on team reputation + salary vs rivals
- Age: drivers have `age` field (18–40). Peak 25–32. Decline −0.005 skill/year after 33.
- No rival bidding simulation needed in v1 — just deterministic accept/reject based on team_tier vs driver_tier

---

## Implementation order

1. **Visible Car Stats** — pure UI, touches only `season_hub.gd`, zero risk
2. **HQ Buildings** — data in `season.gd`, UI in `season_hub.gd`, effects wired into existing scalars
3. **Random Events** — data in `season.gd`, UI modal in `season_hub.gd`
4. **Weather** — touches `race_sim.gd` (careful: determinism) + HUD in `main.gd`
5. **Transfer Market improvements** — `season_hub.gd` only, no new data model needed beyond `age`

Each feature is independently shippable. Implement and verify before moving to the next.
