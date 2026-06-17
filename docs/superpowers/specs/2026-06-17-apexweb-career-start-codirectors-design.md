# ApexWeb — career start: co-director creation + pre-season car build

Date: 2026-06-17 · Status: design approved in brainstorm, awaiting spec review · Target: **ApexWeb** (JS browser prototype)

## Goal

Give the career a real beginning. Today a career starts abruptly: you pick a team + difficulty in
the lobby and drop straight into round 0 with an all-zero car. This adds a short, meaningful start
flow that establishes **identity** (each co-op player is a co-director with a specialty) and a
**strategic first decision** (build the car for the new year under a fixed budget). It is also the
first piece of onboarding — a guided, low-surface entry instead of dropping a newcomer into the full
paddock.

## Start flow

```
1. Team select   →   2. Create co-directors   →   3. Pre-season: build the car   →   4. Season
   (exists)            (NEW)                        (NEW)                              (exists)
```

Steps 1 and 4 are unchanged. Steps 2 and 3 are new and run once, at career start, before round 0.
In co-op they are lobby/paddock steps synced over the existing host-authoritative channel.

## Scope

**In:** co-director character (name + specialty), the 6-specialty system (meta + race effects), and a
pre-season **setup** phase = (a) **build the car** under a budget, (b) **choose a title sponsor**,
(c) **set season ambition**. **Out (deliberately — develops in-season, which already exists):**
pre-season staff/facilities/pit-crew/driver/academy *development*; avatars/photos; director
progression/leveling. Per owner the **build/upgrade allocation is car-only** (*"в начале только
болид; остальное качается по мере игры"*); sponsors and ambition are one-time setup decisions, not
things you "build up", so they belong at the start too.

## 1. Co-director character system

Each player creates one co-director: **name + one specialty** (+ the team colour for identity).
Design pattern = **specialist** (pick one strength), not point-buy or archetype. A specialty affects
both **meta** (a team-management area) **and the race** (the car that player engineers) — this is the
point of two co-directors: division of labour that is felt both in the paddock and on track.

Data on the career object:

```
career.directors = [
  { player: "p1", name: "...", specialty: "strategist" },
  { player: "p2", name: "...", specialty: "engine" },
]
```

The six specialties and where each hooks into existing code:

| Specialty (RU)        | key          | Meta effect                                            | Race effect (their car)              | Pre-season build |
|-----------------------|--------------|-------------------------------------------------------|--------------------------------------|------------------|
| Аэродинамик           | `aero`       | aero-area car dev cheaper / higher gain (`development.js`) | —                                | discount on aero |
| Моторист              | `engine`     | PU dev cheaper/faster, softer PU wear (`development.js`)   | more ERS payoff (sim energy)     | discount on power |
| Стратег               | `strategist` | tighter pit-window / weather-forecast info            | better pit calls + SC reaction (`ai_strategy.js` / player assist) | — |
| Гл. механик           | `mechanic`   | pit-crew cheaper to build + lower botch (`pitcrew.js`)     | (crew already acts in-race)      | — |
| Финансист             | `financier`  | +sponsor income, softer cost-cap (`career.js`/`sponsors.js`) | —                              | **+starting budget** |
| Наставник             | `mentor`     | faster driver growth + morale (`drivers.js`)              | softer morale drop for their driver | — |

Specialties "sound" at different moments — this is intended. At the **pre-season** only `aero`,
`engine` (build discounts) and `financier` (bigger budget) bite; the rest pay off across the season
and in races. All meta→sim influence still flows only through the existing scalar hooks
(`team_car()` / parts / `Personnel` / `morale`), never a flat bonus bolted onto the sim.

**Two-player rule:** in co-op the two directors must pick **different** specialties (the other's pick
is shown locked). **Solo:** one director + an "assistant" giving **half** of a second specialty's
bonus (player picks both).

**Magnitude:** noticeable but not balance-breaking — roughly one development-level / ~10–20 % on the
specialty's lever. Verified against the balance harness (same discipline as the pit-crew pass), must
hold the existing corridors (winners spread, DNF, pace spread, etc.).

## 2. Pre-season setup

A short setup phase with three decisions: build the car, pick a title sponsor, set the season ambition.

### 2a. Build the car (car-only)

A budget-allocation screen: spend the **starting budget** to build the car for the new year.

- **Budget** = the career's starting money (`newCareer` already tier-scales it); the `financier`
  specialty raises it.
- **Allocate across the car's development areas** — reuse `development.js` `DEV_AREAS`
  (aero, power, tyre, fuel, reliability). Each "+" step buys instant part-development for the best
  part in that area (reuse `bestPartForArea` + the gain model), paid from the budget — i.e. it is
  pre-bought, instant, no dev-days.
- **Specialty discounts** apply here: `aero` cheaper aero, `engine` cheaper power.
- **Leftover budget carries into the season as cash** (`career.money`) — banking is itself a valid
  strategy; nothing is wasted.
- **Output:** sets the initial `career.parts[myTeamName]` levels (instead of all-zero), so the
  season-1 car reflects the build.
- **Skippable:** a "skip / auto" option applies a balanced default build so a newcomer isn't blocked.

This replaces the all-zero starting car with a player-shaped one, and is the strategic hook of the
start (strong car now vs. cash banked for in-season development).

### 2b. Title sponsor

Bring the existing title-sponsor choice forward into the start. `newCareer` already generates three
title offers (`titleOffers`) and `chooseTitleSponsor` swaps the chosen one in. The pre-season surfaces
those offers as an explicit decision: each pays a different per-race amount and carries a different
**happiness expectation** (higher pay → harder to keep happy — e.g. "expects podiums" vs "expects
points"). No new system — `chooseTitleSponsor` wired to a start-screen section. Secondary sponsors
stay as the existing defaults.

### 2c. Season ambition

The player picks an ambition that sets the board's target and a reward/pressure modifier — agency over
"what counts as a good season", hooking into the existing `board.targetPos` + `seasonObjectives` +
`constructorPrizeFund` + confidence/sacking (`boardOutcome`):

- **Скромная** — target = tier + 2 (easier), reward ×~0.8, low sacking pressure.
- **Реалистичная** — target = your tier (default), reward ×1.0.
- **Амбициозная** — target = tier − 2 (harder), reward ×~1.3 (bigger budget/confidence on success),
  higher sacking risk on failure.

Concretely: ambition sets `board.targetPos` and a `rewardMult` that scales the season-end constructor
prize fund (and/or a confidence buffer). `seasonObjectives` already keys off `targetPos`, so the
board's stated objectives follow automatically.

## 3. Integration & data model

- **Schema bump:** `CAREER_V` 26 → **27**, with a `migrate` v26→v27 step that backfills `directors`
  (default: a neutral pair with no specialty, so the bonus layer is a no-op for old saves) and leaves
  existing `parts` untouched. (Invariant reminder from the 2026-06-17 fix: adding a `migrate` step
  means bumping `CAREER_V` — the `assert.equal(up.v, CAREER_V)` test guards this.)
- **`newCareer`** gains `directors` (and, for solo, the assistant). The pre-season build runs after
  creation and writes `career.parts` + adjusts `career.money` before round 0.
- **Sponsors & ambition** reuse existing systems: `chooseTitleSponsor` for the title pick; season
  ambition sets `board.targetPos` and a new `rewardMult` (scales `constructorPrizeFund` / a confidence
  buffer) — `seasonObjectives` follows `targetPos` automatically.
- **Specialty effects** are pure helper functions (new `directors.js`-style module) that the existing
  systems consult: a dev-cost/gain multiplier, a PU-wear multiplier, a sponsor-income multiplier, a
  driver-dev/morale multiplier, a pit-crew/strategy modifier. Each is a thin, testable scalar.
- **UI:** two new screens built in code (like the rest of ApexWeb UI) — a co-director creation screen
  and a pre-season build screen — inserted between the lobby and the first weekend when "career" is on.

## 4. Co-op / netcode

Both new steps are host-authoritative, reusing the existing lobby P2P/RPC channel:
- **Creation:** host and client each set name + specialty; host enforces "different specialties"; both
  ready → advance.
- **Pre-season build:** a **joint** paddock decision on a shared budget (per the co-op GDD: meta
  decisions are taken together). Host holds the authoritative budget/allocation; client sees and
  co-edits; both confirm → season starts.

## 5. Testing

- **Unit (Node, pure):** each specialty scalar; the pre-season build math (budget spend, discounts,
  leftover→cash, resulting `parts`); the skip/auto default; the title-sponsor pick; ambition →
  `targetPos` + `rewardMult`; `migrate` v26→v27.
- **Balance (harness):** specialty magnitudes don't break the established corridors; pre-season builds
  produce a sensible starting-car spread (not a runaway).
- **UI (owner F5 — not sandbox-verifiable):** the two new screens, co-op sync, solo path.

## Open tuning knobs (defaults set, owner can adjust)

- Exact specialty magnitudes (start ~10–20 %).
- Season-ambition target offsets (default ±2 from tier) and reward multipliers (~0.8 / 1.0 / 1.3);
  title-sponsor offer count + pay/expectation spread.
- Pre-season area set (default = the 5 `DEV_AREAS`) and the per-step cost curve.
- Whether later seasons reuse the pre-season build screen as the "winter" step (out of scope now;
  the existing `newSeason` winter logic stays).
