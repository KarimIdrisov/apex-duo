# WORKFLOW — parallel development for Apex Duo

How the six role agents (`.claude/agents/`) collaborate, how work is split into
parallel tracks, and how to avoid stepping on each other. Read `CLAUDE.md` first.

## The delivery pipeline (per feature)

```
PM ──▶ Researcher ──▶ Designer ──▶ Tester ──▶ Programmer ──▶ Tester ──▶ Reviewer
(spec)   (facts)      (feel/UI)   (targets    (implement)   (verify)   (approve)
                                   in Python)
```

1. **PM** writes a thin spec: goal, acceptance criteria, track, owning roles.
2. **Researcher** supplies any external facts (F1 rules, Godot API). Optional.
3. **Designer** specs feel/UI and **target numbers** a tester can check.
4. **Tester** encodes those targets in the Python harness (they fail = "red").
5. **Programmer** implements, lints via the fresh-file trick, ports the numbers.
6. **Tester** re-runs the harness ("green") and checks regressions.
7. **Reviewer** reviews; **PM** updates roadmap + README.

Verify-first is the rule: prove the numbers in Python **before** writing GDScript.

## Parallel tracks (run concurrently)

| Track | Scope | Primary files | Roles |
|------|-------|---------------|-------|
| **A — Sim & balance** | race model, tyres, ERS/battery, dirty air, tracks, safety car | `race_sim.gd`, `f1_2026.gd`, Python harness (`simcheck.py`) | programmer, tester, researcher |
| **B — Meta / season** | calendar, points, R&D, finances, morale, save | `season.gd`, `season_setup.gd`, `season_hub.gd` | programmer, pm |
| **C — UI / HUD** | race HUD, minimap, paddock, setup screens, copy | `main.gd` (UI funcs), `track_map.gd`, `*_hub/setup.gd` | designer, programmer |
| **D — Netcode** | host/client, RPC, snapshots, online season | `main.gd` (net funcs) | programmer, researcher |

Tracks A and B are **file-isolated** → safest to parallelize. C and D both touch
`main.gd` → coordinate (below).

## The `main.gd` hotspot

`main.gd` holds menu, HUD, co-op panels, team tactics, netcode and season hand-off.
Parallel edits here collide.

Rules:
- Only **one agent edits `main.gd` at a time** per merge cycle. Sequence C and D.
- Make **minimal, localized** edits; don't reflow unrelated code.
- **Recommended refactor (PM to schedule):** extract netcode into its own
  `net.gd` node and HUD-building into `hud.gd`, leaving `main.gd` as a thin
  coordinator. This removes the contention and lets C and D run truly in parallel.

## Running agents in parallel (mechanics)

- **Spawn role agents** with the Agent tool. Independent tracks (e.g. A and B) can
  be launched in the **same message** so they run concurrently; dependent steps
  (programmer → tester) run in sequence.
- **Isolate file edits** with `isolation: "worktree"` so each track works on its
  own git worktree; the PM/lead merges results. This is the clean way to let two
  agents edit code at once without clobbering.
- Keep a shared **task list** (one per feature) so progress is visible.
- The **lead/PM** owns integration: merge worktrees, resolve `main.gd`, run the
  full Python harness once more, then hand to the reviewer.

## Example: "add cost cap + contracts"

- PM: spec + split → Track B (cost cap, contracts data) and Track C (contract UI
  in paddock). Researcher: real cost-cap & contract rules.
- Launch in parallel: programmer+tester on Track B (worktree 1); designer+
  programmer on Track C (worktree 2).
- Tester gates each with harness/lint; reviewer reviews both diffs; PM merges,
  resolves any `main.gd` overlap, updates README + GDD.

## Definition of done (any feature)
Spec met · numbers verified in Python · code parses + lints (fresh-file trick) ·
README/GDD updated · reviewer approved · (human) manual Godot play-check passed.
