# ApexWeb — Qualifying Rework (real-time Q1/Q2/Q3 knockout) — Design

**Date:** 2026-06-14
**Status:** approved (brainstorm) — ready for implementation plan
**Builds on:** the real-time practice live-session engine (`docs/superpowers/specs/2026-06-14-apexweb-realtime-practice-design.md`) — reuses its clock/speed/pause + host-loop + snapshot/netcode patterns.

## Goal

Replace the one-shot risk-slider qualifying with a **real-time Q1/Q2/Q3 knockout session**: a live
clock you pause/accelerate, you **release your car** for an out-lap → flying lap and watch the
**timing tower**, managing **track evolution**, a **limited soft-tyre allocation**, **traffic**, and
**red/yellow flags**. Eliminations across three segments set the starting grid. Symmetric co-op:
**each player runs one car**.

## What changes vs today

| | Today (`quali.js` + `ui/quali.js`) | New |
|---|---|---|
| Interaction | one risk slider → "Поехать круг" → host computes 22 instant laps → grid | live Q1/Q2/Q3 session; release car, watch the tower, manage tyres/traffic/grip/flags |
| Structure | single shot | **Q1 (22→15) → Q2 (15→10) → Q3 (top-10)** knockout |
| Time | instant | live clock per segment (pause + ×2/×4/×8) |
| Output | `buildGrid` sorts one lap each | the session's segment eliminations build the grid |
| Co-op | each picks a risk | **per-car**: each releases/aborts their own car; clock shared; eliminated player spectates |

**Kept / reused:** the lap-time core `qualiLap` (extended), the live-session patterns from practice
(clock, host loop, snapshot, netcode), `setupBonus` from practice satisfaction (parc fermé — setup is
already locked entering quali). **Retired:** the `quali_risk` one-shot command + `buildGrid` as the
grid source + the risk-slider screen.

## Structure — the knockout

22 cars (11 teams × 2). Three segments, each a live timed sub-session; grip + tyre state carry across.

| Segment | Cars in | Length (game-sec) | Eliminated | Grid slots set |
|---|---|---|---|---|
| **Q1** | 22 | `Q_SEG_SEC[0]` ≈ 480 | slowest 7 | P16–P22 (by Q1 best) |
| **Q2** | 15 | `Q_SEG_SEC[1]` ≈ 420 | slowest 5 | P11–P15 (by Q2 best) |
| **Q3** | 10 | `Q_SEG_SEC[2]` ≈ 360 | — | P1–P10 (by Q3 best) |

A car with **no time** when a segment ends is classified behind cars that set one (in car-index order).
At each segment end: sort the segment's runners by best lap, eliminate the tail, lock their grid slots,
carry the survivors (with their grip/tyre state) into the next segment, reset the clock. The session
starts each new segment **paused** so players plan their first release.

## The live loop (per car)

A car cycles through phases: `pit → outlap → flying → (optional 2nd flying) → inlap → pit`.
- **Release** (player command `quali_release {player, tyre, push}`): pit → outlap. Choose tyre
  (`fresh` consumes a soft set; `used` reuses an already-run warm set, no consumption) and push
  (`steady`/`attack`). The **out-lap** is one lap that warms the tyre (cold → optimal) and does not
  count.
- **Flying lap**: the next completed lap is **timed** via `qualiLap` (extended, below). If on `fresh`
  tyres the car can immediately do a **2nd flying lap** on the now-warm set before pitting; on `used`
  it gets one.
- **Abort** (`quali_abort {player}`): from any on-track phase, go to `inlap → pit` (e.g. to save the
  set, or because of traffic).
- The clock advances in accelerated game-time (`pracStep`-style `dt × SIM_RATE × speed`); a lap
  completes when accumulated game-time ≥ `TRACK.lt`.

## Depth mechanic 1 — track evolution (the when-to-run core)

One scalar `grip ∈ [0,1]` per session, **rising** with elapsed session time + total laps run by the
field (rubber), and **carrying up** across Q1→Q2→Q3. The flying-lap bonus is `-GRIP_GAIN × grip`
(`GRIP_GAIN ≈ 1.2 s` from a green to a fully rubbered track). Tension: late laps are faster, but you
risk traffic, a late flag, or not completing the lap before the clock — so a **banker** (an early safe
time) trades pace for safety.

## Depth mechanic 2 — soft-tyre allocation

Each car has `softSets = QUALI_SOFT_SETS` (≈ 3) fresh soft sets for the whole quali. A `fresh` release
consumes one (best grip); a `used` release reuses a previously-run set (warm but ~`USED_PENALTY`
≈ 0.25 s slower, slightly more worn — no consumption). Run out of fresh sets → only `used` remains.
The decision: burn a fresh set early for a banker, or hoard for a late fast-track run.

## Depth mechanic 3 — traffic

When a car starts its **flying** lap, its time gets `+trafficLoss` where `trafficLoss` scales with how
many **other cars are on a flying/out lap in the same track window** at release. Few cars out → clean
(≈0); a crowded track → up to `TRAFFIC_MAX` (≈ 0.5 s) lost. Modeled deterministically from the set of
on-track cars + a seeded roll. This makes the **release window** a real decision (go when the track is
clear, not just when grip is high). The UI shows a "traffic ahead: clear / busy" read at the release.

## Depth mechanic 4 — red / yellow flags

Each tick, a small `flagProb` (raised by `push=attack` and low early grip) can trigger an **incident**
(a car "crashes"): a **red flag** freezes the session clock, voids all in-progress (uncompleted) laps,
and after `RED_FREEZE_SEC` resumes — if it hits late, cars without a time risk elimination (banker
reward). A milder **yellow** slows one sector (a flat time penalty on laps crossing it) for a short
window. Flags are seeded → deterministic. Frequency tuned low (most sessions: 0–1 flag).

## Lap-time model (extend `qualiLap`)

`qualiLap(drv, car, track, setupBonus, risk, rng, carMean)` gains terms (keep the existing skill /
absolute-car / track-bias / setupBonus / risk-mean-and-mistake structure):
- `− GRIP_GAIN × grip` (track evolution),
- `+ tyreTerm` (cold out-lap penalty → ~0 warm fresh → `USED_PENALTY` on used),
- `+ trafficLoss`,
- `+ yellow penalty` if a yellow sector is active.
`push=attack` raises `risk` (faster mean, bigger spread, higher mistake + flag chance); `steady`
lowers it. Out-laps are not scored (they only warm the tyre + advance grip).

## AI cars

The 20 AI cars (and the human teammate's car in solo) are **host-simulated**: each picks sensible
release windows from its attributes + the clock (a banker run mid-segment, a final run late for grip,
avoiding the most crowded windows), fits fresh sets while it has them, and sets times via the extended
`qualiLap`. Deterministic from the seed. They populate the timing tower alongside the human car(s).

## Co-op / netcode

- **Per-car.** Each player owns one car: `quali_release` (tyre + push), `quali_abort`. The **clock**
  and **segment** are shared (host-driven). Soft sets are **per-car**. If a player's car is eliminated
  (Q1/Q2), that player **spectates** the rest (their grid slot locked) — they still see the live tower.
- **Host-authoritative**, mirroring practice: the host runs the quali session loop (`qualiStep`),
  advances all cars' laps, applies grip/traffic/flags/eliminations, and broadcasts a snapshot. Clients
  send `quali_release/quali_abort/set_speed/toggle_pause/ready`. The screen renders the local car's
  controls + the shared tower.

## The screen (`ui/quali.js`)

Live timing-tower layout (HeroUI dark): header (segment `Q1/Q2/Q3` + clock + grip/"трасса +Xс"
indicator + flag banner + speed pills + pause); the **timing tower** (all segment cars, position,
driver+team, best time, gap, tyre dot, status `в боксах / out-lap / на круге / нет времени`, the
**drop-zone cut line** in danger colour, your car + teammate highlighted); a **control card** for your
car (status, fresh/used tyre chooser with sets-left, traffic read, grip bar, «Выпустить на круг» /
«Прервать», push toggle); a partner mini-status; a ready button (after Q3) → race.

## Output → grid → race

The session's classification (Q3 order P1–10, Q2-eliminated P11–15, Q1-eliminated P16–22; no-time
cars last) becomes the **starting grid** consumed by `startRaceHost` (replacing `buildGrid`). Setup is
**parc fermé** (locked from practice — no setup UI in quali). The race start spread uses this grid as
today.

## Architecture / files

- `src/quali_session.js` (**NEW**) — pure deterministic session model: state
  `{seed, segment, clock, grip, flag, cars:{...}, classified:[]}` with per-car
  `{drv, car, ideal/setupBonus, phase, tyre, softSets, lapAcc, bestTime, segBest, eliminated, gridPos,
  risk}`; `qualiStep(s, dt)` (advance laps, grip, traffic, flags, segment transitions/eliminations),
  reducers `release/abort/setSpeed/setPaused`, AI release logic, `qualiSnapshot(s)`, `finalGrid(s)`.
  Reuses `qualiLap` from `quali.js`, the `LAP_SEC = TRACK.lt` cadence, seeded `RNG`.
- `src/quali.js` — extend `qualiLap` (grip/tyre/traffic/yellow terms). Retire `buildGrid` as the grid
  source (the session produces the grid); keep `qualiLap`.
- `src/ui/quali.js` — rewrite to the live timing-tower screen.
- `src/main.js` — host quali loop (`qualiStep` in `hostLoop`), `onPhaseHost` quali bootstrap,
  `quali_release/quali_abort` (+ reuse speed/pause) command handlers, `pushQuali` snapshot;
  `startRaceHost` uses `finalGrid(ctx.qualiSession)`.
- `src/data.js` — `QUALI2` consts (segment lengths + elimination counts, `GRIP_GAIN`, grip-rise rate,
  `QUALI_SOFT_SETS`, `USED_PENALTY`, `TRAFFIC_MAX`, `flagProb`, `RED_FREEZE_SEC`, speed steps).
- `src/weekend.js` — the `quali` phase stays single (segments are internal to the session); no change
  beyond what practice already did.
- Tests: `tests/quali_session.test.js` (**new**), `tests/quali.test.js` (extend). `tools/balance.mjs`
  (grid realism block).

## Determinism & testing

- Seeded; same seed + same player commands → identical session + grid. Flags, traffic, AI releases,
  lap noise all from seeded `RNG`/`mix32`. No `Date.now`/`Math.random` in the model. Tests drive
  `qualiStep(dt)` with fixed `dt`.
- **Unit (`quali_session.test.js`):** Q1 eliminates exactly the slowest 7 (15 advance) and locks
  P16–22; grip rises monotonically and a later identical run is faster; a fresh release consumes a set
  and run-out leaves only `used`; `used` is slower than `fresh`; traffic loss rises with cars-on-track;
  a red flag freezes the clock + voids in-progress laps; a car with a banker time survives a late red
  flag that catches a no-time car; determinism (same seed+commands → identical `finalGrid`); every AI
  car sets a time (none stuck); full Q1→Q2→Q3 produces a 22-car grid.
- **Unit (`quali.test.js`):** extended `qualiLap` monotonic — more grip faster, fresh < used < cold,
  traffic adds time, a better `setupBonus`/quali-attr qualifies ahead.
- **Balance (`tools/balance.mjs`):** pole-to-last spread realistic (~2.5–4 s), Q1/Q2 cut margins tight
  (drama), track evo ~1–1.5 s over the session, AI all classified, a good-setup clean late run beats a
  sloppy one.

## Balance targets (first cut, tune in implementation)

`Q_SEG_SEC ≈ [480,420,360]`; eliminate `[7,5,0]` (22→15→10); `GRIP_GAIN ≈ 1.2`;
`QUALI_SOFT_SETS ≈ 3`; `USED_PENALTY ≈ 0.25`; `TRAFFIC_MAX ≈ 0.5`; `flagProb` tuned to ~0.3–0.5
flags/session; `RED_FREEZE_SEC ≈ 90`. Lap ≈ `TRACK.lt` (~80 s game-time); ~2 flying runs fit a segment.

## Out of scope (v1)

Wet/changing-weather quali; engine-mode management in quali; DRS/slipstream trains on the quali lap;
high-fidelity tyre-warmup curve; sprint-weekend quali format. Backlog.

## Migration notes

- `ui/quali.js` rewritten; `main.js` quali handlers replaced (`quali_risk`→`quali_release/abort`);
  `buildGrid` retired as the grid source (kept only if still referenced by a test — otherwise removed);
  the risk-slider screen gone.
- Reuses `setupBonus` (already per-car from practice satisfaction). Parc fermé documented.
- Update `README.md` (Quali section → real-time knockout) and the project memory.
- Scope: large — the plan sequences it (session skeleton + Q1 eliminations → grip → tyres → traffic →
  flags → AI → screen → grid wiring → balance → docs).
