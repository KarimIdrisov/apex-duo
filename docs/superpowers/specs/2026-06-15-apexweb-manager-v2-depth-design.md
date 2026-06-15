# ApexWeb Manager — v2 Depth Pass (D1–D8) — Master Design

**Date:** 2026-06-15
**Status:** Approved (owner: "deepen each system + expand the dataset", real-F1 data; build all phases autonomously)
**Scope:** A second pass over the M1–M8 career layer — deepen every system and ground the world in real F1 data.

---

## 1. Goal & anchors

The M1–M8 career layer is complete (full MM-style career on ApexWeb). This v2 pass **deepens each system** and **expands the dataset with real F1 data**.

Decisions fixed in brainstorming (2026-06-15):
1. **Data source = real F1 (FastF1).** Bake the owner's extracted `tools/track_constants_2024.json` (lt/pit/pw/df/ot) into the calendar; derive driver skills from real 2024 results. Values are **baked into committed code** — the game never imports the owner's untracked WIP files at runtime.
2. **Deepen every system** via the per-phase deferred backlogs from M1–M8.
3. **Same discipline as M1–M8.** The race engine / quali / practice stay **byte-unchanged**; depth flows only through the inputs `buildField` feeds the sim (`c.car` / `c.attrs` / `c.personnel`) and the dynamic roster. Each phase: plan → TDD → headless career corridor → preview smoke → full-suite gate → commit (explicit pathspecs; owner WIP untouched).

**Sequencing:** data-first (a quick, high-leverage foundation), then per-system depth by dependency.

---

## 2. Phase roadmap (D1–D8)

### Data foundation
- **D1 — Real track data.** Bake FastF1 `lt/pit/pw/df/ot` per round into `career.CALENDAR` (map circuit→GP). overtake_zones keep auto-deriving from the now-real `ot`. `laps` stay (real counts); `sc`/`wet` stay estimated; `COMPOUNDS` stay manual (FastF1 can't isolate tyre pace — owner's confirmed conclusion). Re-tune the career corridor to the real spread (no zero-pass races; passes/race in band).
- **D2 — Real driver skills.** Derive established drivers' `overall` from real 2024 results (transparent, baked points→skill mapping); keep estimates for rookies/new entries (Antonelli, Hadjar, Bortoleto, Cadillac line-up, etc.). Bradley-Terry is a later refinement.

### Per-system depth
- **D3 — Car development → MM-style parts** *(centerpiece; may split D3a/D3b).* Replace the 5 abstract `carDev` scalars with **parts** (front wing, rear wing, floor, sidepods, suspension, power unit). Each part has a level + an in-progress project and **composes into** the 5 sim indicators (power/aero/tyre/fuel/rel). Buy-vs-build (suppliers) for transferable parts; per-part reliability. AI develops parts on the same model. `effectiveCar` composes parts→indicators so the sim is still fed the same 5 numbers.
- **D4 — Contracts & market depth.** A **free-agent pool** (expired contracts leave teams open), real **negotiation** (offer salary/length/clauses → driver accepts/rejects from offer vs your competitiveness vs their ambition), rival bidding, buyout clauses. Builds on M4 contracts + M6 swap.
- **D5 — Driver depth.** Per-attribute development (spend a training focus to raise a chosen attribute), **traits/perks** (wet master, tyre-whisperer, qualifier… layered on the existing SIGNATURE), short-term form.
- **D6 — Staff & facilities depth.** More roles (aerodynamicist, per-car race engineer, mechanics) + a **staff market** (hire from a generated pool), a facilities research-tree with prerequisites.
- **D7 — Academy / feeder depth.** A lightweight **F2/F3 feeder-series sim** (juniors gain/lose by simulated results, not a flat curve), reserve/test driver that **stands in for an injured race driver**, scouting that reveals hidden potential.
- **D8 — Board / narrative depth.** Multi-objective board (championship + a secondary goal) with a **mid-season review + sack risk**, richer **regulation arcs** (each season names a specific reg shift that moves which part/indicator matters), a deeper news feed (transfer rumors, milestones, records).

---

## 3. Cross-cutting

- **Back-compat:** each schema change bumps `CAREER_V` with a `migrate` step; old saves keep loading.
- **Determinism + corridors:** every phase keeps the seeded-determinism rule and ships/extends a `career_balance.mjs` corridor.
- **Real-data provenance:** baked values carry a comment citing the source (FastF1 2024 / 2024 results); the owner's WIP `tools/*.json` + `fastf1_extract.py` are the source of truth, read once and baked — never imported by game code.
- **Owner F5:** feel/co-op remain owner-gated; per-phase preview smoke proves render + key action.

---

## 4. Deliverable shape

A roadmap; each D-phase gets its own plan `docs/superpowers/plans/2026-06-15-apexweb-manager-dN-*.md`, executed phase-by-phase, committed with explicit ApexWeb pathspecs. Order: D1 → D8 (data first, then depth by dependency).
