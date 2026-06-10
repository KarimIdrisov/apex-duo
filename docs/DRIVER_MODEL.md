# Driver Model — attributes, intelligence & the hybrid control loop

Design for Apex Duo's deepened driver system. Decisions locked with the user:
**hybrid control** (driver runs the micro, engineer owns strategy + key
interventions), **full Football-Manager-style** attributes (scouting with
uncertainty, hidden attributes), implemented in verified slices.

This is the design of record. Implement against it; keep it updated.

---

## 1. Vision — from "drive the car" to "manage the driver"

Today the engineer (player) sets pace/ERS/pit directly, as if flipping switches
on the car. The new model makes the **driver a semi-autonomous agent** with a
personality and a skill profile. The driver decides *how* to drive moment-to-
moment; the engineer **coaches and strategises**.

Why it fits the co-op USP: the Director owns the team & strategy; each Race
Engineer now *manages a human* — reading their driver, choosing when to push
them, when to trust them, when to insist. Two players managing two very different
personalities under pressure is a richer co-op fantasy than two players flipping
the same switches.

## 2. Hybrid control — who decides what

| Layer | Owner | Examples |
|------|-------|----------|
| **Strategy** | Engineer (player) | tyre choice, pit windows, target stint length, fuel/energy plan |
| **Directives** | Engineer (player) | pace intent, race intent, team orders (see below) |
| **Execution (micro)** | Driver (AI) | exact pace each lap, when to attack/defend, lift-and-coast, managing the cliff, risk in a fight |
| **Key interventions** | Engineer (player) | "Box this lap", "Attack now", "Hold position", "Plan B" — strong directives the driver usually obeys |

### Engineer directives (the new in-race control)
Instead of setting `pace_mode` directly, the engineer sets a **directive** that
*biases* the driver. The driver obeys based on **Discipline + Trust − Ego**:

- **Pace intent:** `Push` · `Balanced` · `Conserve (tyres)` · `Save energy/fuel`
- **Race intent:** `Attack the car ahead` · `Hold / defend` · `Bring it home (no risks)` · `Let teammate by` (team order)
- **Strength:** a normal call vs **"Insist"** (spends Trust; overrides personality once) vs **"Your call"** (let them drive — happy drivers reward this).

**Compliance** = `clamp(0.15..0.98)` of
`base(Discipline) + Trust/200 − Ego·cost(order) + situational`.
A disciplined, high-trust driver almost always follows. A high-ego, low-trust
driver told to "hold position" while a slower car is ahead may **ignore it and
attack** — sometimes brilliantly, sometimes into the gravel. That tension *is*
the game. Outcomes feed back into Trust/Morale.

## 3. Attribute system (FM-style, 1–20)

Grouped. Each attribute names its **sim hook** — the exact term it modulates in
`race_sim.gd`. Most map onto levers that already exist (pace, wear, pass-credit,
pass-resist, error risk, SoC, quali).

### Pace & car control
| Attribute (RU) | Affects | Sim hook |
|---|---|---|
| Темп (Pace) | raw one-lap speed | primary term in `current_laptime` (replaces flat `skill`) |
| Торможение (Braking) | corner entry, late braking | small pace gain + lock-up/error risk on entry |
| Повороты (Cornering) | mid-corner speed | pace, **weighted by track.downforce** |
| Тяга (Traction) | corner exit, putting power down | pace **weighted by track.power** + exit tyre stress |

### Racecraft
| Обгон (Overtaking) | completing passes | **pass-credit accrual** in `_resolve_combat` |
| Защита (Defending) | holding position | raises **`_pass_resist`** against the car behind |
| Контроль (Wheel-to-wheel) | clean fights | incident/contact avoidance, SC restarts |
| Старт (Starts) | launch off the grid | lap-1 positions gained/lost (start phase) |

### Resource management
| Шины (Tyre mgmt) | tyre life | **wear-rate multiplier** (lower = longer stints) |
| Энергия (Energy mgmt) | battery use | SoC efficiency, avoids clipping (`_update_soc`) |
| Расчёт (Race intelligence) | hitting targets | when to push vs save, lift-and-coast, reacting to the race |

### Mental
| Хладнокровие (Composure) | performance under pressure | **error/stall risk** when battling, leading, late, wet |
| Стабильность (Consistency) | lap-to-lap repeatability | **lap-noise amplitude** (consistent = tighter) + error baseline |
| Агрессия (Aggression) ⭑ | risk appetite | bias toward attacking/defending hard in `driver_decide`; resists "hold" orders |
| Дисциплина (Discipline) ⭑ | obeys the pit wall | **compliance** with directives |
| Концентрация (Concentration) | late-stint focus | error risk rises late in a stint if low |
| Целеустремлённость (Determination) ◆ | comebacks, growth | development speed, pace when recovering positions |

### Physical & conditions
| Выносливость (Stamina) | late-race fade | pace drop in the final third (worse on heat/street) |
| Реакция (Reactions) | starts, avoidance, wet | start phase, incident rolls |
| Дождь (Wet) | rain pace | pace multiplier when `weather = wet` |
| Обратная связь (Feedback) | setup & data | setup quality + how well the engineer "sees" the car |

⭑ = personality (drives behaviour & compliance). ◆ = partly hidden.

## 4. Hidden attributes & FM-style scouting

Not everything is a clean number you can read.

- **Visible attributes** are shown with **uncertainty that narrows with data**:
  early on you see a *range* or *star band* (e.g. Темп **14–17**), which tightens
  to a point value as the driver races for you or scouts file reports. Knowledge
  is **per-driver**: your own drivers are well known; rivals are fuzzy until
  scouted.
- **Hidden attributes** (never shown as numbers; only hinted by scout prose and
  revealed through results):
  - **Потенциал / Peak (PA)** — the ceiling the driver can grow to.
  - **Характер (personality archetype)** — the hidden weave of Aggression / Ego /
    Professionalism / Determination ("hothead", "ice-cold pro", "qualifying
    specialist", "wet-weather genius", "fragile talent"…).
  - **Биг-гейм (clutch)** — over- or under-performs in title deciders / big races.
  - **Адаптивность (adaptability)** — how fast they master a new car / regs.
  - **Возрастная кривая** — when they peak and decline.
- **Current Ability (CA)** = weighted sum of current attributes (single "overall"
  for quick comparison & transfer value). **PA** is the hidden cap. CA → PA over a
  career, gated by Determination / age / car quality (extends the existing
  morale/development system).
- **Scout reports** turn hidden traits into *language*: "thrives under pressure",
  "hard on his tyres", "questionable in the wet", "doesn't always listen". This is
  how the player learns personality without seeing the numbers.

## 5. The driver decision loop (`driver_decide`)

Runs each decision interval (≈ once per lap, or on a situation change). Pure,
deterministic from the seeded RNG. Replaces the old `_ai_energy` and becomes the
single brain for **every** car (rivals and the player team) — the player's input
is the *directive*, not the lever.

```
inputs:  situation {pos, gap_ahead, gap_behind, laps_left, wear, soc, fuel, weather, stint_age},
         directive {pace_intent, race_intent, insist},
         attrs, trust/morale
1. Base pace target  ← directive.pace_intent
2. Personality tilt  ← Aggression: chasers push harder, leaders protect a lead
3. Resource guard    ← Race-intelligence/Tyre/Energy: if near the cliff or low SoC,
                       the driver may override toward conserve/harvest
4. Combat intent     ← if car ahead within ~1.5s AND (Aggression high OR intent=Attack)
                       AND tyre/energy OK → commit (attack ERS + overtake),
                       strength scaled by Overtaking; risk scaled by Composure
5. Defence           ← if pressured AND intent≠"let by" → defend (raises resist),
                       scaled by Defending
6. Compliance blend  ← obey directive vs do-what-personality-wants, by P(obey)
outputs: pace_mode, ers_mode, overtake(bool), defend(bool), risk_level
```

`risk_level` feeds the error/stall roll (high risk + low Composure/Consistency =
lock-ups, run-offs, DNFs). This is where a fragile-but-fast driver throws away a
race, and a cool veteran brings it home.

## 6. Mapping onto the current sim (concrete)

The hold-up engine already exposes the right levers; attributes just weight them.

- **Lap pace** (`current_laptime`): the flat `skill*1.0` term becomes a blend
  `pace_rating(attrs, track)` = Pace + Cornering·downforce + Traction·power +
  Braking, with Stamina fade and Wet in the rain.
- **Tyre wear** (`wear_rate`): `× (1.15 − Tyre/20·0.4)` and pace-mode the driver chose.
- **Pass credit** (`_resolve_combat`, attacker): `× f(Overtaking, Aggression)`.
- **Pass resist** (`_pass_resist`, defender): `+ g(Defending of the car ahead)`.
- **Error/stall risk** (`risk` roll in `step`): base `× h(Composure, Consistency,
  Concentration)`, amplified by `risk_level`, battling, leading, late stint, wet.
- **Energy** (`_update_soc`/decisions): efficiency & clip-avoidance `× f(Energy mgmt)`.
- **Qualifying grid** (`_init`): grid order by `pace_rating + Starts/Reactions
  noise` instead of flat skill.
- **Lap noise**: amplitude `× (1.2 − Consistency/20·0.6)`.

`skill` is kept as a **derived overall** (= CA/100) for code that still wants one
number, so nothing else breaks during migration.

## 7. Personality, morale & trust (the drama layer)

- **Trust** (engineer↔driver) rises when the engineer's calls pay off and when
  the driver is given autonomy and rewards it; falls on contradictory orders,
  ignored radio, being told to hold when they had pace. Trust gates compliance.
- **Morale** (existing) interacts: low morale + high Ego → ignores orders, intra-
  team friction with the other car (the co-op's two drivers can clash).
- **Personality events**: "let me race him!", "these tyres are gone", refusing a
  team order, a charge from the back when Determined — surfaced on the radio and
  to both players.

## 8. Development (extends current dev/morale)

Per-attribute growth/decline toward PA, gated by age curve, Determination, car
quality and race experience. Young drivers improve fastest; veterans hold then
fade physically (Stamina/Reactions) while keeping mental attributes. The current
single-number `driver_dev` becomes per-attribute deltas.

## 9. UI

- **Driver profile**: attribute bars **with uncertainty bands** (FM look),
  CA/PA stars, scout-prose traits, form & morale, contract.
- **In-race directive panel** (replaces today's raw pace buttons for the player):
  pace intent · race intent · Insist / Your-call, plus the radio feed of what the
  driver is actually doing and saying.
- **Scouting**: assign scouting, reports narrow uncertainty over time.

## 10. Implementation phases (verify-first, one slice at a time)

1. **Model + Python proof (this turn).** Define the attribute schema and
   `driver_decide`; prove in the harness that archetypes behave distinctly
   (aggressor passes more; tyre-whisperer stops later; fragile driver errs more;
   rock-solid defender is hard to pass). No GDScript yet.
2. **GDScript slice — attributes + AI brain.** Add the attribute data (generated
   deterministically from each driver's `skill` + a personality seed, so we don't
   hand-author 22×20 numbers yet), wire the sim hooks, replace `_ai_energy` with
   `driver_decide` for **AI cars only** (player keeps direct control). Verify by
   extract-lint + harness parity. *Do this only after the current hold-up build is
   confirmed running in Godot.*
3. **Hybrid for the player.** Swap the player's pace buttons for the directive
   panel; route player cars through `driver_decide` + compliance.
4. **FM scouting & hidden attributes UI.** Uncertainty bands, CA/PA, scout prose,
   reveal over time.
5. **Personality & development.** Per-attribute growth, personality events,
   teammate dynamics.

## 11. Open questions / tradeoffs for review

- **Attribute count.** ~22 attributes (above) vs a leaner ~12. More = FM depth but
  harder to balance and surface. Proposal: ship ~14 core now, reserve the rest.
- **Hand-authored vs generated attributes.** Phase 2 generates plausible spreads
  from `skill` + personality so the 22-driver grid isn't hand-tuned. Real per-
  driver authoring (e.g. Verstappen = elite racecraft, average-for-elite tyre
  mgmt) can come later in `f1_2026.gd`.
- **How disobedient can drivers be?** The "ignore the order and attack" moments
  are the spice — but too frequent feels like loss of control. Tunable via a
  global compliance floor.
- **Decision cadence.** Per-lap is cheap and readable; per-corner is finer but
  noisier and costs CPU. Proposal: per-lap + on big events (SC, rain, pressure).
