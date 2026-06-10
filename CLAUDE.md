# CLAUDE.md — Apex Duo

Guidance for Claude (and any sub-agent) working in this repository. Read this
first. Keep it up to date when architecture or conventions change.

## What this is

**Apex Duo** — a co-op Formula‑1 team-management game prototype, built in
**Godot 4.6** (GDScript). The headline feature is **symmetric co-op**
(decision 2026-06-10): two players are *co-directors* of one team — meta
decisions (R&D, race tyre choice, strategy) are taken together in the paddock;
in the race each player runs **one car** (P5 / P6) as its race engineer (pace,
ERS, pits, radio). The old asymmetric "Mode A" (Director + Engineer roles) is
backlog as a possible Mode B; the GDD still describes it and needs a revision
pass. Current focus: **playability & challenge** — tune/fix existing mechanics,
don't add new systems.

The full design lives in **`Apex_Duo_GDD.docx`** (repo root). The playable
prototype lives in **`ApexDuo_Prototype/`**.

Current state (stages 0–3.5, "engine v0.3"). Implemented:
- **Race core** with a **2026 energy model**: battery State-of-Charge, clipping
  when spent, Overtake boost (DRS successor, only within ~1s), active-aero/dirty
  air, tyres (compound + wear + cliff), fuel, pace modes.
- **Real circuits 2026** (10 named tracks with researched 0..1 characteristics)
  and a **safety car** driven by each track's `sc_prob` (field bunching, cheaper
  pit). A hashed **events RNG** (`mix32`) keeps the SC roll well-distributed.
- **Real 2026 grid** (11 teams / 22 drivers / power units) in `f1_2026.gd`.
- **Symmetric co-op** (local split-screen + online host/client; each player
  engineers one of the team's two cars), **team tactics** (shared pace, swap
  order, pit coordination).
- **Season/championship**: 5 real rounds, points, money, **3 R&D branches**
  (aero / tyres / powertrain), team tier + difficulty selection, driver
  morale & development, JSON save/load.
- **Race visualization**: a live circuit **minimap** (`track_map.gd`) with cars
  moving around a procedurally-drawn track.

## Repo layout

```
Coop motorsport manager game/
├── Apex_Duo_GDD.docx        # full game design document
├── CLAUDE.md                # this file
├── docs/
│   ├── WORKFLOW.md          # parallel-development plan & file ownership
│   └── TOOLING.md           # recommended MCPs & skills per role
├── .claude/agents/          # role sub-agents (pm, designer, programmer, ...)
└── ApexDuo_Prototype/       # the Godot 4.6 project
    ├── project.godot
    ├── main.tscn / main.gd          # start menu, race HUD, game loop, netcode (HOTSPOT)
    ├── race_sim.gd                  # deterministic race core + real tracks + SC (class RaceSim)
    ├── f1_2026.gd                   # real 2026 grid: teams, drivers, engines+chassis
    ├── personnel.gd                 # team staff (FM-style roles+attrs) → AI strategy/pits
    ├── track_map.gd                 # race minimap widget (class TrackMap, _draw)
    ├── season.gd                    # season/championship meta (class Season)
    ├── season_setup.tscn / .gd      # team + difficulty selection
    ├── season_hub.tscn / .gd        # the paddock (between races)
    ├── icon.svg
    └── README.md                    # how to run + full feature list (keep current)
```
`.godot/`, `*.uid`, `*.import` are Godot-generated — do not hand-edit.
Each `.gd` with a `class_name` is globally referencable (`RaceSim`, `Season`,
`F1_2026`, `TrackMap`).

## How to run

Install **Godot 4.2+** (project is on 4.6), open `ApexDuo_Prototype/project.godot`,
press **F5**. For online co-op testing: Godot editor → *Debug → Run Multiple
Instances → 2*, host in one window, join `127.0.0.1` in the other.

## Architecture

- **Deterministic sim core (`race_sim.gd`).** Pure logic, no UI. Advances the
  race by a fixed time-step (`STEP = 0.25s`) in **three phases per tick**:
  (1) every car advances at its *clean* lap time (skill, tyre compound +
  wear/cliff, pace mode, 2026 ERS/battery SoC + clipping, fuel, **per-team car
  power/aero track-character bias** via `CAR_K`, small noise) — and may **retire
  (DNF)** on a `reliability`-weighted roll (`DNF_BASE`, ×1.6 while pushing);
  (2) **`_resolve_combat`** — wheel-to-wheel: a follower within `COMBAT_GAP` is
  pinned behind the car ahead and builds "pass credit" from its pace edge (+
  Overtake boost) until it beats the track's `_pass_resist()` (high where
  `overtaking` is low) and completes the pass; (3) lap completion + pits. Cars
  start from a **qualifying grid** (skill-ordered, spread). This hold-up model
  replaced free progress-swapping, which let noise make cars overtake endlessly.
  **Invariant (fix 2026-06-10):** combat writes only `lap_frac` (relative to the
  car's *own* `lap`) and never assigns `lap` — phase 3 owns all lap bookkeeping
  (fuel burn, deploy-budget reset, pit execution, trust/mood). Keep it that way;
  regression test: `combat_lap_check.py` (invariant: completions == lap).
  Uses a **seeded LCG RNG** so the same seed
  reproduces the same race. **Determinism is load-bearing** — it underpins the
  host-authoritative netcode and the Python balance harness. Don't introduce
  non-deterministic state (real time, unordered iteration over dictionaries that
  feeds the sim, etc.). Two RNG streams: `rng` (per-tick pace/wear/pits) and a
  separate **events `erng`** seeded from `mix32(seed)` (the SC roll) so that
  consecutive race seeds (restart = seed+1) don't give near-identical races.
  Tracks come from `REAL_TRACKS` + `real_calendar()`; the safety car triggers on
  `track.sc_prob`, bunches the field and makes pits cheaper.
- **Real grid (`f1_2026.gd`, class `F1_2026`).** Data tables for the 2026 teams,
  drivers and power units; `race_grid()` builds the full 22-car grid. The **car is
  split into engine + chassis**: `ENGINES` (keyed by the team `pu`, **shared** by
  customer teams — Ferrari powers Ferrari/Haas/Cadillac, etc.) carries
  power/energy/reliability; `CHASSIS` (per team) carries aero/reliability;
  `team_car()` composes them (power from engine, aero from chassis, reliability =
  engine.rel × chassis.rel) into the `{power, aero, energy, rel, pu}` the sim reads.
- **Race minimap (`track_map.gd`, class `TrackMap`).** A pure `Control` with a
  `_draw()`; `main.gd` feeds it car lap-fractions each frame via `set_cars()`.
  Circuit shape is procedural from a track-name seed (host & client match because
  the snapshot carries `track`).
- **Meta layer (`season.gd`, class `Season`).** Calendar, standings, money, R&D,
  team tiers, difficulty, driver morale/development, and JSON save/load to
  `user://apex_duo_season.json`. A `static var active` holds the current season
  across scene changes. **R&D develops the car, not the sim** — part levels
  (`part_levels`, 12 parts) compose into 5 scalars via
  `F1_2026.compose_part_deltas()` → `apply_rd_upgrades()` → `team_car()`; never
  re-add flat team bonuses to the sim. **Meta v2 (М1–М5, 2026-06-10) is fully
  implemented** per `docs/META_DESIGN.md`: М1 income (constructor prizes +
  sponsors), М2 personnel-as-people (persistent `staff`, `rd_speed_mult`, top-3
  cap exemption, staff market), М3 deep car (suppliers brake/fuel + integration
  penalty, buy-vs-develop for transferable parts, ATR catch-up), М4 pit crew
  (5 roles → 3 sim scalars, training/fatigue/injury, DHL award, driver status),
  М5 academy (juniors + F2/F3/F4 aggregate sim, superlicense gate 40,
  test-driver R&D mult + race stand-in). All meta→sim influence flows through
  `team_car()` scalars, `Personnel` scalars and `morale_mod()` only. Each
  milestone has a self-contained Python mirror: `meta_m2_staff_check.py` …
  `meta_m5_academy_check.py` (run before touching the math).
- **UI + game loop (`main.gd`).** Builds the entire HUD in code (the `.tscn` is a
  near-empty root Control). Runs the authoritative sim in `_process`. This file
  is the **integration hotspot** — menu, race HUD, co-op panels, team tactics,
  netcode and season hand-off all live here.
- **Netcode.** Host-authoritative: only the host runs `RaceSim`; clients send
  pace/pit commands via `@rpc` and render state snapshots the host broadcasts.
- **Scene flow:** `main.tscn` (menu) → `season_setup.tscn` → `season_hub.tscn`
  (paddock) ↔ `main.tscn` (race) → back to hub → champion.

## Conventions

- **GDScript, tabs for indent** (Godot standard). `snake_case` funcs/vars,
  `PascalCase` classes, `CONSTANT_CASE` consts.
- **Build UI in code**, not in `.tscn`. Keep scenes trivial (root + script).
- **Data-driven:** tunables are `const` dictionaries at the top of the file
  (compounds, pace/ERS modes, team tiers, difficulty). Balance changes happen
  there, not scattered through logic.
- **Sim stays UI-free.** Gameplay numbers and rules live in `race_sim.gd` /
  `season.gd`; `main.gd` only reads state and sends commands.
- **Russian** for user-facing strings and in-game text; English for code,
  comments are fine in either but prefer concise.
- **Type errors are invisible to gdtoolkit — only Godot catches them.**
  `gdparse`/`gdlint` check *grammar*, not types or function signatures. Classes
  that pass the linter but fail in Godot:
  - *Non-constant `const`:* a `const` must be a *constant expression*. Constructed
    `Vector2(...)`, `Color(...)` inside an array are usually fine, but
    `PackedVector2Array([...])` and dicts containing them are **not** — *"Assigned
    value for constant isn't a constant expression"*. Use `static var` for that
    data (runtime-initialised once).
  - *Inference from Variant:* reading an untyped `Array`/`Dictionary` yields a
    `Variant`, so `var x := POINTS[i]` (or a ternary with a Variant branch) fails
    with *"Cannot infer the type of x"*. Use an explicit type:
    `var pts: int = POINTS[i] if i < POINTS.size() else 0`. A ternary infers only
    when **both** branches are the same concrete type (two `float`s, `Color`s…).
  - *Argument type mismatch:* passing the wrong type to a typed parameter, e.g. a
    `Color` constant into a helper declared `col: String` → *"Cannot pass a value
    of type Color as String"*. Keep colour helpers consistent: a `col: String`
    param always gets a hex string (`"#ffd166"`), a `col: Color` param gets a
    `Color`. **Reviewer/tester: eyeball helper call sites — the linter won't.**

## Critical gotchas (read before you "fix" something)

1. **Sandbox file mount lags badly.** This session edits files on the Windows
   side; the Linux sandbox (`bash`, and `Read` on `/sessions/...` paths) often
   serves a **stale, truncated copy** of recently-written files. The **`Read`
   tool on the real `C:\…` path is authoritative.** If `bash` shows a file
   shorter than you wrote, that's the cache, not data loss — verify with `Read`.
2. **Godot can't run in the sandbox** (no binary, no network to fetch it).
   You cannot launch the game here. Verify code by other means (below).
3. **Don't trust a single full-file lint via the mount.** Because of (1), a full
   `gdparse`/`gdlint` of a large freshly-edited file may fail on a truncated
   copy. Verify new logic in small fresh files instead (see workflow).

## Verification workflow (established, works around the gotchas)

- **Syntax/lint:** `gdtoolkit` is installed (`pip install gdtoolkit`,
  `gdparse` + `gdlint` on `$PATH` under `~/.local/bin`). It parses **GDScript
  grammar** (not full semantics). For big edited files that the mount truncates,
  **extract the new functions into a small standalone `.gd` in the outputs dir
  and `gdparse`/`gdlint` that** — fresh files read correctly.
- **Balance/behaviour:** a **Python balance harness** in the outputs scratchpad
  mirrors the sim's math. `race_model.py` = original; `race_model2.py` /
  **`simcheck.py`** mirror the *current* energy-aware model + real tracks + safety
  car (simcheck is self-contained — preferred, see note below). Use it to prove
  changes numerically (gaps, undercut, pace-mode/ERS trade-offs, team-tier spread,
  morale/dev, SC occurrence ≈ `sc_prob`, field bunching) **before** porting to
  GDScript. The harness simplifies the SoC/energy loop, so it can't faithfully
  judge the *overtaking* (dirty-air vs Overtake) interaction — tune that against
  the real engine, not the harness.
- **Mount-stale imports:** a Python harness that `import`s another scratchpad file
  can run a **stale** copy of it (same mount lag as gotcha #1). Prefer a single
  **self-contained** test file (no cross-import); fresh filenames read correctly.
- **Save/load:** verify round-trips by simulating Godot's JSON int→float quirk
  in Python (numbers come back as floats; loaders cast back to int).
- **Real-engine headless runs via the godot MCP** (when the `mcp__godot__*`
  tools are connected): `script → execute_gdscript` with
  `project_path = ...\ApexDuo_Prototype` runs code INSIDE the real project on
  the Windows side (Godot 4.6.3) — `load("res://race_sim.gd")`, build a field,
  loop `sim.step(0.25)`, print JSON stats. This is the preferred way to verify
  balance corridors and engine behaviour (gotcha #2 only applies to the Linux
  bash sandbox). Notes: each call needs a `confirm_and_execute` round-trip;
  the process has a hard ~120 s cap and the sim costs ~1 ms/tick → run ONE race
  per call (a 53-78 lap race ≈ 18-26k ticks ≈ 25-45 s). `runtime`/`batch` tools
  can also launch the editor, run scenes and validate files.
- **Always run a final verification step** and report what was checked.

## Roadmap status

Done: stages 0–3.5 + engine v0.3 — 2026 energy model, real circuits, safety car,
race minimap, **per-team car model** (power/aero track-character bias +
reliability/DNF; `CARS` table in `f1_2026.gd`, `CAR_K`/`DNF_BASE` in `race_sim.gd`,
verified in `simcar.py`/`simcar2.py`) (see README for the full ✅ list). Researched
next steps (a sim-engine research brief informed the recent work; see the engine
roadmap in README): **qualifying + grid/start spread**, **tyre warm-up / out-lap**
(natural undercut), **weather** (slick↔wet crossover), **track-specific overtaking
tuning** (needs the real engine, not the harness), **car development via R&D** (the
`CARS` table is currently static). Also still open:
**cost cap & driver/staff contracts (transfer market)**, **online season**,
**lobby with role selection**, **polish (audio, tutorial, art)**.

## Working agreement for sub-agents

Each role in `.claude/agents/` owns part of the system. Before editing, check
`docs/WORKFLOW.md` for **file ownership** — `main.gd` is shared, so coordinate
edits there. Always: research → verify numbers (Python) → implement → lint
(fresh-file trick) → update README/docs → hand back.
