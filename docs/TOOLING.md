# TOOLING — MCPs & skills for Apex Duo

Research on which connectors (MCPs) and skills help this project, mapped to the
six roles. Based on the MCP registry + the currently installed plugins/skills.

## TL;DR

- **A Godot MCP is now connected and verified working on this machine** (Godot
  **4.6.3** binary wired). It exposes `get_project_info`, `validate_scripts`,
  headless run/test and screenshots. This is the long-awaited "engine bridge":
  it does **real engine-level GDScript parse/type checking that gdtoolkit
  cannot** (CLAUDE.md: *"type errors are invisible to gdtoolkit — only Godot
  catches them"*), plus headless run/test and screenshots. It does **not**
  replace the toolchain below — keep `gdtoolkit` + the **Python balance harness**
  + **git** worktrees for fast lint/balance/version control; use the Godot MCP as
  the authoritative final type/parse gate and for engine-truth balance tuning
  (e.g. track-specific overtaking, which the simplified harness can't judge).
- **Linear is connected** → use it for the PM backlog now.
- The **design plugin** is installed → designer is well covered.
- Highest-leverage *new* thing isn't a connector — it's a **custom skill** that
  encodes our verification workflow (below).

## Already available (use these now)

| Tool | Type | Use for | Role |
|------|------|--------|------|
| **godot** | MCP (connected, Godot 4.6.3) | engine-level GDScript validation (`validate_scripts`), `get_project_info`, headless run/test, screenshots | programmer, tester |
| **Linear** | MCP (connected) | roadmap, issues, cycles | pm |
| **design** plugin | skills | critique, design-system, ux-copy, a11y, handoff, research | designer |
| **deep-research** | skill | multi-source F1 rules / engine research | researcher |
| **gdtoolkit** (`gdparse`,`gdlint`) | sandbox CLI | GDScript syntax/lint | programmer, tester |
| **Python 3** (sandbox) | runtime | balance harness, save round-trips | tester, programmer |
| **git** (sandbox shell) | CLI | version control, worktrees for parallel tracks | all |
| **docx / pdf / pptx / xlsx** | skills | specs, GDD edits, balance sheets, slides | pm, designer |
| **skill-creator** | skill | build the custom verify skill (below) | programmer |
| **mcp-builder** | skill | build a Godot/verify MCP later (below) | programmer |
| **schedule** | skill | recurring playtest/regression runs | pm, tester |
| Figma / Notion / Slack | via design plugin | mockups, docs, comms | designer, pm |

## Worth adding (optional, by need)

| Connector | When it pays off | Role |
|-----------|------------------|------|
| **Notion** | a living GDD / design wiki alongside the .docx | pm, designer |
| **Atlassian (Jira/Confluence)** | only if you prefer it over Linear | pm |
| **Supabase** | *future:* online-season backend — accounts, saved seasons, leaderboards | programmer |
| **Sentry** | *future:* crash/error reporting after a public build | tester |
| **PostHog / Mixpanel** | *future:* playtest telemetry (which strategies players pick) | pm, designer |

Don't connect these yet — they only matter once the game has an online backend or
real players. Adding connectors you don't use is just noise.

## Two high-leverage builds (recommended)

1. **Custom skill: `godot-verify`** (build with **skill-creator**).
   Encode our verify-first workflow so every agent runs the same rigorous checks:
   - extract changed functions to a fresh `.gd`, run `gdparse` + `gdlint`
     (works around the mount-truncation gotcha);
   - run the relevant Python balance check and report pass/fail numbers;
   - remind to update README/GDD.
   This turns the discipline in CLAUDE.md into a one-command habit.

2. **Custom MCP: a Godot bridge** — ✅ **now connected** (Godot 4.6.3).
   The engine bridge exists: `validate_scripts` parse/type-checks the project
   with the real engine (catches the type errors gdtoolkit misses),
   `get_project_info` introspects it, and headless run/test + screenshots are
   available. Use it as the **authoritative final gate** in the verify-first
   pipeline (after the fresh-file gdlint pass) and to tune balance that needs the
   real engine, not the simplified Python harness (track-specific overtaking).
   Note: it already flagged real issues — see BACKLOG task TD-1.

## Role → tooling cheat-sheet

- **pm:** Linear (backlog) · docx/pptx (specs, GDD) · deep-research (market) ·
  design:research-synthesis.
- **designer:** design:* skills · Figma · ux-copy · accessibility-review.
- **programmer:** Read/Edit/Write · bash (gdtoolkit, Python, git) · **godot MCP
  (`validate_scripts` as final gate)** · skill-creator / mcp-builder for tooling ·
  web for Godot docs.
- **reviewer:** Read/Grep/bash · `/review`, `/security-review` commands.
- **tester:** bash (Python harness, gdparse/gdlint) · **godot MCP (engine
  validation + headless run/test)** · the `godot-verify` skill.
- **researcher:** WebSearch/WebFetch · deep-research.

## How to add things

- **Connectors:** ask Claude (e.g. "connect Notion") or use the connector picker;
  Claude can surface them via the registry.
- **Skills you don't have:** ask Claude to recommend/add skills for a topic.
- **Custom skill/MCP:** invoke `skill-creator` / `mcp-builder` and follow it.
