# ApexWeb Race Depth — Combat Orders + Live Safety Cars (Design)

**Date:** 2026-06-14
**Status:** approved (design), pending spec review
**Topic:** deepen the live race — more player agency in the fight, less predictable race shape.

## Goal

Two linked additions to the deterministic race sim, chosen from a full race-sim analysis as the
highest-leverage "harder + more interesting" wins:

- **Part A — Combat orders.** The player *drives the fight*. Beyond the global pace/engine/pit
  levers, each car gets a contextual **Attack / Defend / Neutral** order that boosts its overtaking
  (or its defence) in a wheel-to-wheel duel, paid for in tyre life + temperature and a lock-up risk.
- **Part B — Live safety cars.** The caution emerges from **real on-track incidents** instead of a
  single pre-scheduled roll. An incident (spin / off / contact) can cost time, end in a DNF, and/or
  bring out an SC or VSC — so a race has an emergent **0, 1, or 2+** cautions, with elevated
  first-lap chaos. This replaces `scheduleSC`'s one pre-race coin-flip.

Both preserve the load-bearing invariants: **deterministic** (lap-/event-keyed RNG, never per-tick),
**co-op** (two players each engineer one car), **combat writes only `lapFrac`** (§16 invariant),
commits use **explicit pathspecs** (owner has parallel WIP), **no push** without the owner's word.

## Current state (what we build on)

- Player in-race levers today: **three** — `setPace` (conserve/balanced/push), `setEngine`
  (save/standard/push), `requestPit`. The fight in `_resolveCombat` runs entirely automatically.
- Cautions: `scheduleSC(erng, track.sc, laps, vscShare)` rolls **once at construction** → at most
  one caution, on a pre-decided leader-lap, **disconnected from on-track events**. The SC *lifecycle*
  (deploy → bunch via `_resolveSC` → cheap pits → retract after `scMinLaps`; VSC variant) is already
  built and reused as-is — only the **trigger** changes.
- DNF today: one `erng` roll in `_serveLapEnd`, weighted by `(1-rel) × pace.risk × consistency`.
  It is purely *mechanical* and never causes a caution.
- Determinism idiom already in the codebase (quali/practice): randomness keyed to **lap/sector
  events via a stateless seed** (`new RNG(mix32(seed + idx*k1 + lap*k2 + kind*k3))`), never per-tick.

---

## Part A — Combat orders

### A.1 The order lever

- New per-car state `c.order ∈ {"attack","defend","none"}` (default `"none"`).
- New command `set_order(i, mode)` on `Race`, bounds-/enum-validated exactly like `setPace`
  (host-authoritative trust boundary). Sets `c.order` and `c._pin` (an explicit player order, like
  pace/engine, overrides the AI brain for that car).
- **3-state, mutually exclusive.** In a "sandwich" (cars ahead *and* behind in range) the player picks
  one priority. One UI control, three states.
- **Contextual.** The order only *does* something while the car is in a fight:
  - `attack` bites only when a car is within `COMBAT_GAP` **ahead** (same lap).
  - `defend` bites only when a car is within `COMBAT_GAP` **behind**.
  - Otherwise the order is inert (no boost, no cost) — the lever is shown but waits for a duel.
- Co-op: each player sets the order for their own car. AI cars get an order from `ai_strategy.js`
  (below). The snapshot carries `order` + an `inFight` flag so the HUD can highlight the active lever.

### A.2 Attack mechanics (in `_resolveCombat`)

When `me.order === "attack"` and `me` is the follower within `COMBAT_GAP` of `ahead`:

- **Credit boost:** the pass-credit accrued this tick is multiplied by `ATTACK_CREDIT_K` (on top of
  the existing `(0.7 + ATTRW.overtaking·overtaking)·cautious·aggr` factor). A genuinely faster,
  braver driver closes a pass markedly sooner.
- **Cost — tyre wear:** while attacking, the per-lap wear gains a multiplier `ATTACK_WEAR_MULT`
  (applied in the lap-completion wear line in `step()` via a scratch flag `c._orderWear` set during
  combat). Permanent — brings the cliff closer.
- **Cost — temperature:** a per-lap temp scrub `ATTACK_SCRUB` (reuses the existing
  `tyreTemp = max(0.1, tyreTemp − scrub)` mechanism from the bold lunge) — a transient, self-healing
  cold/flat-spot patch that costs pace now.

### A.3 Defend mechanics (in `_resolveCombat`)

When `ahead.order === "defend"` (the car being attacked is defending) — i.e. evaluated from the
**defender's** perspective while resolving the follower `me` vs `ahead`:

- **Resist boost:** the `resist` the follower must beat is multiplied by `DEFEND_ORDER_K`
  (stacks with the existing `(0.7 + ATTRW.defending·defending)` factor). Defence holds longer.
- **Cost — tyre/temp:** the defender pays `DEFEND_WEAR_MULT` extra wear + `DEFEND_SCRUB` temp per lap
  while actively defending (a car behind in range), same scratch mechanism.

> Note: the per-tick *repel roll* already keys off `defending` vs `overtaking`; the order does not
> touch the roll, only the credit threshold — keeping the "a faster car still gets by within a few
> ticks" bound intact (no permanent road-block).

### A.4 The lock-up (mistake)

- Rolled **once per completed lap** while an order is active and biting (not per-tick), using a
  **stateless lap-keyed RNG** `orderRng(seed, idx, lap)` — deterministic, decoupled from `erng`/`rng`.
- Probability:
  `ORDER_MISTAKE_BASE × (1 + ORDER_MISTAKE_RAMP · c._orderLaps) × wearTempFactor × focus`
  where `c._orderLaps` = consecutive laps the order has been held (pushing harder for longer is
  riskier), `wearTempFactor` rises with wear and cold temp, and `focus` is
  `(1 − composure)` for attack / `(1 − discipline)` for defend (a composed/disciplined driver errs less).
- On fire: **+`ORDER_MISTAKE_TIME`** added to the lap (`rng.range(MIN,MAX)` from the same keyed RNG —
  e.g. 0.4–1.2 s, a lock-up that drops you back), a temp scrub, and `me._passCredit = 0` (the move is
  lost). **Never a DNF.** Explicit contact/DNF risk stays only on the rare bold lunge (`AGGR_PASS_DNF`).
- `c._orderLaps` resets to 0 when the order clears or the fight ends.

### A.5 AI orders (`ai_strategy.js`)

A new pure `combatOrder(c, ctx)` returns `"attack" | "defend" | "none"`:

- `attack` when a clear pace edge over a close car ahead **and** tyres healthy enough
  (`wear < cliff·0.8`), scaled by `race_iq × difficulty` and `aggression`.
- `defend` when a faster car is close behind and this car is the slower one, scaled by `defending`.
- `none` otherwise (the conservative default). Called from `_aiDrive` (writes only `c.order`).

### A.6 Part-A constants (data.js — starting points, calibrated in the corridor)

```js
export const ATTACK_CREDIT_K   = 1.6;   // ×pass-credit accrual while attacking
export const ATTACK_WEAR_MULT  = 1.5;   // ×per-lap wear while attacking
export const ATTACK_SCRUB      = 0.10;  // temp scrubbed/lap while attacking
export const DEFEND_ORDER_K    = 1.5;   // ×resist while the car ahead defends
export const DEFEND_WEAR_MULT  = 1.3;   // ×per-lap wear while defending
export const DEFEND_SCRUB      = 0.07;  // temp scrubbed/lap while defending
export const ORDER_MISTAKE_BASE = 0.04; // base per-lap lock-up chance while an order bites
export const ORDER_MISTAKE_RAMP = 0.35; // extra chance per consecutive lap held
export const ORDER_MISTAKE_MIN  = 0.4;  // s lost on a lock-up (min)
export const ORDER_MISTAKE_MAX  = 1.2;  // s lost on a lock-up (max)
```

`ATTRW` gains no new keys — attack/defend reuse `overtaking`/`defending`/`aggression`/`composure`/
`discipline`, which are already centred on 0.5 (a neutral driver reproduces the current behaviour
*modulo the order multiplier*, which is 1.0 when `order==="none"`).

---

## Part B — Live safety cars

### B.1 Incident roll

In `_serveLapEnd` (lap boundary), after the existing mechanical-DNF roll, a **separate incident roll**
per car, on a **stateless lap-keyed RNG** `incidentRng(seed, idx, lap)`:

```
P(incident) = INCIDENT_BASE × pace.risk × (1 + INCIDENT_PRESSURE·(1 − composure))
              × (inFight ? INCIDENT_TRAFFIC : 1) × (lap === 1 ? INCIDENT_LAP1 : 1)
```

- `inFight` = the car was within `COMBAT_GAP` of another this lap (close racing → more incidents).
- `lap === 1` (the opening lap) gets a large `INCIDENT_LAP1` multiplier → real first-corner chaos.
- Modulated by `pace.risk` (pushing crashes more) and `(1 − composure)` (nervy drivers err more).

### B.2 Incident outcomes

When an incident fires for car `c`:

1. **Time loss (always):** `c` loses `INCIDENT_TIME_LOSS` on this lap (a spin/off recovered) — the
   incident is *felt* even when it neither retires the car nor brings a caution.
2. **DNF (some fraction):** with `INCIDENT_DNF_SHARE`, `c` retires (crashed/beached) instead of (1).
3. **Caution (×track.sc):** independently, roll whether the incident draws a caution:
   `P(caution) = track.sc × (wasDNF ? INCIDENT_SC_DNF : INCIDENT_SC_MINOR)`. If it draws one, split
   into a **full SC** vs **VSC** by the existing `EVENT.vscShare`. A stranded/DNF car is likelier to
   bring the full SC; a minor off more likely a VSC or nothing.

The existing **start bog-down DNF** (`_standingStart`) and **bold-lunge contact DNF**
(`AGGR_PASS_DNF`) are reclassified as *incidents* → they feed the same caution roll (a first-lap
shunt or a failed lunge can bring out the SC).

### B.3 Caution lifecycle (reuse) + emergent count

- When an incident draws a caution, set `scActive`/`vscActive` **live** (the same fields the lifecycle
  already drives), record `scStartLap = leadLap`, and reuse the existing retract-after-`scMinLaps` /
  `vscMinLaps`, bunching (`_resolveSC`), cheap-pit (`scPitMult`), and pace-mult logic **unchanged**.
- **One caution at a time.** An incident while a caution is already out does not stack (it may extend:
  reset `scStartLap` to the current leader-lap so the period runs its minimum from the new incident).
- **Emergent total:** each lap any car can trigger an incident → **0, 1, 2+** cautions per race
  naturally. A backstop `MAX_CAUTIONS = 3` caps runaway (after the cap, incidents still cost
  time/DNF but draw no further caution).
- `scheduleSC` is **removed** (and its single construction `erng` draw with it). `this.scLap`/
  `scIsVsc` pre-roll state is deleted; the caution is now event-driven. `scheduleWeather` is untouched.

### B.4 Events / commentary

- New structured events: `{type:"incident", lap, a, abbr, dnf:bool}` and the existing
  `sc_on/off`, `vsc_on/off` now fire from live triggers. `commentary.js` gains lines for an incident
  and for "SC deployed after <driver>'s incident".

### B.5 Part-B constants (data.js — starting points, calibrated in the corridor)

```js
export const INCIDENT = {
  base:      0.0010, // per-lap per-car base incident chance
  pressure:  0.8,    // ×(1 + pressure·(1−composure))
  traffic:   2.5,    // ×this when racing within COMBAT_GAP (close combat → incidents)
  lap1:      6.0,    // ×this on the opening lap (first-corner chaos)
  timeLoss:  2.5,    // s lost on a non-DNF incident (recovered spin/off)
  dnfShare:  0.30,   // fraction of incidents that end the car's race
  scDnf:     1.0,    // caution-roll weight when the incident was a DNF (×track.sc)
  scMinor:   0.5,    // caution-roll weight when the incident was minor (×track.sc)
  maxCautions: 3,    // backstop on cautions per race
};
```

---

## Data flow & files

- **`data.js`** — the `ATTACK_*` / `DEFEND_*` / `ORDER_MISTAKE_*` consts and the `INCIDENT` block.
- **`sim.js`** —
  - `c.order`, `c._orderLaps`, `c._orderWear` (scratch) on the car; `setOrder(i, mode)` command.
  - `_resolveCombat`: apply attack credit boost + defend resist boost; set `c._orderWear`/scrub;
    roll the lock-up at lap boundary (via a helper or in `step()` lap completion); track `_orderLaps`
    and `inFight`.
  - `_serveLapEnd` / a new `_rollIncident(c, leadLap)`: incident roll → time loss / DNF / caution;
    reclassify start + lunge DNFs as incidents for the caution roll.
  - Remove `scheduleSC` usage + `scLap`/`scIsVsc`; keep the lifecycle block but trigger live.
  - New stateless helpers `orderRng`/`incidentRng` (or one `eventRng(seed, idx, lap, kind)`).
- **`events.js`** — replace `scheduleSC` with a pure `incidentDraw(rng, ctx)` /
  `cautionFromIncident(rng, track, wasDNF, vscShare)` helper(s) (pure, testable).
- **`ai_strategy.js`** — `combatOrder(c, ctx)`; wired in `_aiDrive`.
- **`main.js`** — `set_order` command; snapshot per car adds `order` + `inFight`; `liveSig` race path
  (if gated) includes order/inFight so the buttons stay clickable.
- **`ui/race.js`** — an **Attack / Defend / Neutral** control per player car, highlighted when
  `inFight`; an incident/SC banner already exists for cautions (extend copy).
- **`tools/balance.mjs`** — new corridors (below). **`README.md`** — feature list + levers.

## Balance corridors (tools/balance.mjs)

- **Combat orders:** over many seeded races, `attack` raises a faster car's on-track pass rate vs
  `none` **and** costs measurably more tyre life; `defend` lowers the rate a follower passes a
  defending car. Lock-ups stay rare-but-present (~a handful/race at sustained attack), never a DNF.
- **Live SC frequency:** distribution of cautions/race is **0/1/2+** (not always ≤1); ~the current
  share of races see ≥1 caution (≈25–35%, `track.sc`-driven); first-lap incidents are a visible
  minority; `MAX_CAUTIONS` rarely binds.
- **Determinism:** same seed → byte-identical race (orders off) and same race with a fixed order
  script; the new keyed RNGs reproduce across time-acceleration.
- **No regression:** DNF budget, grid spread, undercut, sector, overtaking, weather, strategy,
  difficulty corridors stay in range (re-verified — the `scheduleSC` removal shifts the `erng`
  sequence by one draw, so DNF/start numbers are re-checked, not assumed).

## Testing (node --test)

- `set_order` validates/bounds; order is inert with no car in range; attack boosts credit; defend
  boosts resist; order adds wear/scrub; lock-up roll is deterministic + never a DNF; `_orderLaps`
  ramps + resets.
- Incident roll deterministic + lap-keyed; lap-1 elevated; DNF-share splits; incident→caution split
  (full SC vs VSC); multiple cautions in one race; `MAX_CAUTIONS` caps; start/lunge DNFs feed the
  caution roll; full determinism (same seed → same race).

## Out of scope (YAGNI for v1)

- The one-shot **"lunge / cover" burst** button (brainstorm option C) — layer later.
- **Debris/random scheduled cautions** independent of incidents (hybrid option C) — only if the
  incident-driven frequency proves too low in the corridor.
- Reworking the **tyre temperature** model (no new overheating physics — we reuse wear + the existing
  transient temp scrub).
- New driver attributes — orders reuse the existing centred attrs.

## Determinism guarantees

- All new randomness (order lock-up, incident, caution split) uses **stateless lap-keyed RNGs**
  seeded from `mix32(seed + idx·k1 + lap·k2 + kind·k3)` — never `Date.now`/`Math.random`, never a
  per-tick draw. Time-acceleration and host/client reproduce identically.
- Combat still **writes only `lapFrac`** (§16): the order changes *credit/resist/cost*, never `lap`.
  The lock-up adds time via the lap-completion path (like a slow lap), not a combat `lap` write.
