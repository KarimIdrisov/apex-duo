# ApexWeb — Manager / Career Layer (Motorsport-Manager-style) — Master Design

**Date:** 2026-06-15
**Status:** Approved (owner mandate: build all phases autonomously, no per-step approval)
**Scope:** Add a full career-management layer on top of ApexWeb's existing race engine,
in the spirit of Motorsport Manager, for symmetric co-op.

---

## 1. Goal & anchors

ApexWeb today is a single race weekend (Practice → Quali → Race) on real/editable
tracks with a deep, well-tuned deterministic sim. There is **no career layer**: no
season, money, R&D, contracts, staff, or persistence. This design adds that layer.

Three decisions fixed in brainstorming (2026-06-15):

1. **Target codebase:** ApexWeb (browser/JS) — build the manager on the good race.
2. **Co-op model:** *fully shared / together* — both co-directors see the same paddock;
   decisions are joint; **big commitments need "both confirm"**; advancing a weekend
   needs **"both ready."** Host-authoritative, reuses `net.js`.
3. **Design source:** *fresh, with Motorsport Manager as the reference* — not bound to
   the Godot M1–M5 work (though we may borrow ideas where they fit).

**Sequencing:** breadth-first ("skeleton first, then deepen"). M1 is a thin, fully
playable season loop; each later phase deepens one pillar.

---

## 2. Core architectural principle

> **The race engine does not change. The manager layer evolves the numbers the engine
> already reads.**

The sim consumes, per car: `c.car` = `{power, aero, rel, tyre, fuel}`, `c.attrs` = the
13 driver attributes, `c.personnel` = `{pitMult, strategy}`. Today these are static
(`data.js` `TEAMS[].car`, `TEAMS[].facility`, driver `skill`). The career layer turns
them into **state that changes across a season**, for the player team *and every AI team*.

All sim modules (`sim.js`, `quali.js`, `practice.js`, `events.js`, …) stay **byte-untouched**.
Balance is protected by construction; the only new coupling is at `buildField`.

### Modules (all pure + deterministic unless noted)

| File | Role |
|---|---|
| `src/career.js` | Career state object + pure advance functions: season, calendar index, standings (drivers + constructors), money, contracts, car-dev levels, staff, facilities, board status, sponsors, `seed`. No UI, no I/O. |
| `src/career_store.js` | Persistence: save/load/continue to `localStorage` + JSON export/import. Modelled on `track_store.js`. Handles the Godot-style int→float / versioning concerns. |
| `src/career_ai.js` | Deterministic AI-team manager decisions (development spend, contracts, hires) so the grid is a living paddock and the harness is reproducible. |
| `src/ui/paddock.js` + per-pillar screens | The between-races UI, added phase by phase. |
| `tools/career_balance.mjs` | Career corridors harness (separate from the owner's `balance.mjs`). |

### Integration point — `buildField` (in `main.js`)

`buildField` stops reading static team data and instead reads the **career-evolved**
values for all teams, composing the same `{car, attrs, personnel}` the sim already
attaches. When no career is active (quick race / editor preview), it falls back to the
current static path — so existing flows are unchanged.

### Co-op

Career state lives on the host. The client renders from a snapshot. Meta actions are
`@rpc` *proposals*; the host validates and applies. A small **commit-gate** wraps
irreversible/expensive actions (`sign`, `commit upgrade`, `accept sponsor`, `advance
weekend`) requiring acknowledgement from both peers before the host applies them. No new
netcode paradigm — same host-authoritative model as the race.

### Determinism, persistence & balance discipline

- Career RNG is **seeded**; AI manager decisions are deterministic-from-seed → a co-op
  career is reproducible and unit-/corridor-testable.
- Every phase ships `node --test` modules + at least one `career_balance.mjs` corridor.
- **WIP isolation:** new files only + minimal additive hooks to *clean* files
  (`main.js`, `data.js`). The owner's uncommitted WIP (`sim.js`, `balance.mjs`,
  `tests/sim.test.js`, Godot, `TODO.md`, `experiments/`) is never touched. Commits use
  explicit pathspecs; never `git add -A`.

---

## 3. Phase roadmap

Each phase = self-contained: own spec/plan → TDD → tests → balance corridor → commit.
"Moves" = which sim hook the phase begins to evolve.

### M1 — Career skeleton & persistence *(first playable layer)*
- Multi-race **season** over a calendar (reuse `track_constants` / editable tracks),
  **driver + constructor standings** with points, **prize money** by finish (simple
  table), **save/continue** (`career_store`), **pick a 2026 team** at start, a **board
  objective** (target championship position) checked at season end → continue or fail.
  Co-op: shared career synced host→client, **"both ready"** before each weekend, results
  applied to standings.
- **Moves:** nothing in the sim yet — this is the *frame* (current static cars/attrs).
- **MM ref:** season/championship shell + chairman objective.
- **Acceptance:** play a full season of weekends; standings build; money accrues;
  hit/miss the board target; roll into a new season with state saved/restored.

### M2 — Finances & sponsors *(economy spine)*
- Real **balance**; income = prize money + **sponsors** (title + secondary, each with an
  **objective** e.g. "finish above P{n}", "beat {team}", "score points" → per-race payout
  + season bonus, with a relationship/happiness meter); expenses = driver/staff salaries
  + part manufacturing + facility upkeep; optional **cost-cap** toggle. Negotiate/renew
  sponsor deals.
- **Moves:** gates everything downstream (no money → no dev/hire). No sim scalar yet.
- **MM ref:** sponsors-with-objectives + finances; cost cap = modern-F1 twist.
- **Acceptance:** money is a real constraint; sponsor choice (achievable objectives vs
  payout) matters; a corridor proves a hands-off top team stays solvent and a reckless
  one can go broke.

### M3 — Car development *(the MM heart)*
- Invest money + time into **parts/projects** that raise the 5 car indicators
  (`power/aero/rel/tyre/fuel`) with a **cost / time / risk** trade-off (push harder →
  bigger gain but reliability/failure risk); **build + fit**; parts age as rivals
  progress. A per-season **rule change** reshuffles which indicators matter. **AI teams
  develop too** (deterministic curve) so the order shifts across the season.
- **Moves:** `c.car` (per team, race-to-race).
- **MM ref:** part design with stat trade-offs + the regulation reset; ATR/catch-up
  flavour optional.
- **Acceptance:** a development war — invest, climb the order, manage reliability risk,
  react to the rule change; corridor keeps grid spread in band across a season.

### M4 — Drivers: development, morale, contracts
- The 13 attributes **develop** on an age curve (young grow, veterans plateau/decline);
  **morale/happiness** (results, car, teammate, promises); **contracts** (length,
  salary, win/podium bonuses, clauses). Re-sign or lose drivers.
- **Moves:** `c.attrs` (per driver, season-to-season).
- **MM ref:** driver stats + development + morale + contracts.
- **Acceptance:** a young signing measurably improves; a happy driver overperforms;
  contract decisions have teeth.

### M5 — Staff & facilities
- **Staff as people:** chief designer (→ dev speed/quality), strategist (→
  `personnel.strategy`), pit crew (→ `personnel.pitMult`), each with attributes;
  hire/fire. **Facilities/HQ** upgrades (design / manufacturing / pit) raising dev rate /
  pit speed / reliability, with build cost + upkeep.
- **Moves:** `c.personnel` + the M3 dev rates.
- **MM ref:** staff roles + HQ/facility upgrades.
- **Acceptance:** investment in people/buildings compounds — a better design office
  out-develops rivals over a season.

### M6 — Transfer market & negotiation
- Living market: poach drivers + staff from rivals; **negotiate** (salary/length/
  clauses/buyouts); AI teams compete for talent and react to expiries; contract churn
  across the whole grid season to season.
- **Moves:** who occupies each `c` (driver/staff swaps) — builds on M4/M5.
- **MM ref:** transfer market + negotiation.
- **Acceptance:** the silly-season — the grid's lineup genuinely changes over careers,
  deterministically reproducible.

### M7 — Academy & young drivers
- Scout/sign **juniors**; a lightweight **feeder-series** sim that develops them; a
  reserve/test driver (R&D benefit + race stand-in); a superlicense-style readiness gate;
  promote to the race seat.
- **Moves:** feeds new drivers (with `attrs`) into M4/M6.
- **MM ref:** young-driver academy + reserve.
- **Acceptance:** you can grow your own star instead of buying one.

### M8 — Board, narrative & polish
- Richer **board expectations + confidence** (multi-objective, mid-season check,
  sacking/renewal); an **inbox / news feed** (reuse the commentary/event style for
  paddock news + objective updates); season-end awards/summary; **multi-season
  regulation arcs**; polish (audio/tutorial/onboarding for manager screens).
- **Moves:** the meta-narrative around everything; win/lose condition matures.
- **MM ref:** chairman/board + inbox + season framing.
- **Acceptance:** the career has a pulse and stakes beyond raw results.

---

## 4. Cross-cutting

- **AI as a living paddock:** from M3 on, AI teams develop, spend, and (M6) trade,
  deterministically. This is what keeps the championship alive and the player honest.
- **Save format & versioning:** `career_store` writes a versioned JSON blob; a
  `migrate(vN→vN+1)` step accompanies any schema change so existing saves survive new
  phases. Numbers reload as the right types (Godot int→float lesson).
- **Testing per phase:** pure-module unit tests + a `career_balance.mjs` corridor
  (multi-season Monte-Carlo over seeds), checked before the phase is called done.
- **Owner playtest (F5):** UI/feel for each phase is owner-verified in the browser; the
  harness proves numbers, not feel.

---

## 5. Deliverable shape

This is a **roadmap**; each phase below gets its own plan file
`docs/superpowers/plans/2026-06-15-apexweb-manager-mN-*.md`, executed via
subagent-driven development with TDD, then committed with explicit ApexWeb pathspecs.
Order is strictly sequential by dependency (M1 → M8).
