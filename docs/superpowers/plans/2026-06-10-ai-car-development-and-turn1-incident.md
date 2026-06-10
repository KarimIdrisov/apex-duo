# AI Car Development + Turn-1 Incident — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 10 rival teams develop their cars across the season (ATR catch-up curve) so the grid evolves and the player can't coast, and add a seeded first-lap (Turn-1) incident that shuffles the race start.

**Architecture:** Both features flow through existing channels — AI development adds a per-team delta store in `F1_2026` that `team_car()` applies for rivals (exactly as it already applies the player's R&D), accumulated each round in `season.gd` on the same ATR curve used for the player; the Turn-1 incident rides the existing events RNG (`erng`) and the existing `pit_timer` "distance frozen" mechanism, so it never touches `lap` (combat invariant preserved). No new sim primitives.

**Tech Stack:** Godot 4.6 / GDScript; Python balance harness (self-contained `*_check.py` in `ApexDuo_Prototype/`); `gdparse`/`gdlint` via the fresh-file trick; optional real-engine runs via the godot MCP (`execute_gdscript`).

**Spec:** `docs/superpowers/specs/2026-06-10-ai-car-development-and-turn1-incident-design.md`

**Branch:** `claude/ai-car-development-turn1-incident` (already checked out; the spec is committed there).

---

## Conventions for this plan

- **GDScript can't be unit-tested in the sandbox** (no Godot binary). The "test
  first" discipline maps to: (1) a **Python harness check** that pins the math
  numerically *before* porting, (2) **fresh-file `gdparse`/`gdlint`** for grammar,
  (3) optional **real-engine** confirmation via the godot MCP. This is the
  project's established verify-first workflow (see CLAUDE.md).
- **Fresh-file lint trick (reused throughout):** the mount serves stale/truncated
  copies of large freshly-edited files, so don't lint them whole. Instead copy the
  *new* functions into a small standalone script and lint that:

  ```bash
  # template — paste the new funcs under a minimal wrapper, then:
  #   extends RefCounted
  #   <const declarations the funcs reference>
  #   <the new/edited functions>
  gdparse outputs/_lint_snippet.gd && gdlint outputs/_lint_snippet.gd
  # Expected: no output / exit 0 = grammar OK.
  ```
- **Python:** run checks with `python3 <file>` in the Bash sandbox (fresh files
  read correctly). On Windows/PowerShell the same files run with `python <file>`.
- **Commits:** every task ends with a commit on the feature branch. Small, frequent.

---

# PART A — AI car development over the season

## Task A1: Pin the AI-dev corridors in Python (do this first)

**Files:**
- Create: `ApexDuo_Prototype/ai_dev_check.py`

- [ ] **Step 1: Write the corridor check (the "failing test")**

```python
# ai_dev_check.py — verifies the AI car-development corridors (Feature 1).
# Self-contained (no cross-imports — mount-stale gotcha). Mirrors
# season.gd._advance_ai_dev / _atr_for_position at the SCALAR level.

ATR_P1, ATR_P10 = 0.75, 1.15
AI_DEV_BASELINE_AERO   = 0.010
AI_DEV_BASELINE_POWER  = 0.004
AI_DEV_BASELINE_ENERGY = 0.004
AI_DEV_AERO_REL = 0.012
AI_DEV_PWT_REL  = 0.012
ROUNDS = 5  # opener (round 0, no dev) + 4 increments that actually affect racing

def atr_for_position(pos):
    return max(ATR_P1, min(ATR_P10, 0.75 + (pos - 1) / 9.0 * 0.40))

def accumulate_aero(pos, increments):
    # jitter omitted (mean 1.0); corridors are defined on the mean.
    return AI_DEV_BASELINE_AERO * atr_for_position(pos) * increments

INC = ROUNDS - 1
leader_aero = accumulate_aero(1, INC)    # P1 constructor
mid_aero    = accumulate_aero(6, INC)    # P6
back_aero   = accumulate_aero(11, INC)   # P11

PLAYER_MAXED_AERO = 0.150   # full aero group ceiling (F1_2026.PARTS, verified elsewhere)
PLAYER_IDLE_AERO  = 0.0

def check(name, cond):
    print(("PASS" if cond else "FAIL"), name)
    return cond

ok = True
ok &= check("rivals develop (mid gains aero)",            mid_aero > 0.02)
ok &= check("ATR catch-up: backmarker > leader",          back_aero > leader_aero)
ok &= check("gentle compression (back-leader gap small)", (back_aero - leader_aero) < 0.05)
ok &= check("maxed player stays ahead of best rival",     PLAYER_MAXED_AERO > back_aero)
ok &= check("idle player falls behind even slowest rival",PLAYER_IDLE_AERO < leader_aero)
ok &= check("mid rival ~2 player aero-steps (0.03-0.06)", 0.03 <= mid_aero <= 0.06)

print("\nleader=%.4f mid=%.4f back=%.4f player_max=%.3f"
      % (leader_aero, mid_aero, back_aero, PLAYER_MAXED_AERO))
import sys; sys.exit(0 if ok else 1)
```

- [ ] **Step 2: Run it and confirm every corridor passes**

Run: `python3 ApexDuo_Prototype/ai_dev_check.py`
Expected: 6 × `PASS`, exit 0, and `leader=0.0300 mid=0.0389 back=0.0460 player_max=0.150`.
(If any line FAILs, tune the `AI_DEV_BASELINE_*` constants here — this file is the source of truth the GDScript constants are copied from.)

- [ ] **Step 3: Commit**

```bash
git add ApexDuo_Prototype/ai_dev_check.py
git commit -m "test(ai-dev): pin AI car-development corridors in Python"
```

---

## Task A2: Per-team delta store in `F1_2026`

**Files:**
- Modify: `ApexDuo_Prototype/f1_2026.gd` (static state block ~199; `team_car()` ~322)

- [ ] **Step 1: Add the static store + setter** — after the `_rd_delta_eng_rel` line (`f1_2026.gd:204`), insert:

```gdscript
# AI car development (per RIVAL team). Season.gd accumulates per-round deltas on
# the ATR curve and primes this before each race via apply_ai_dev(). Keyed by
# team_idx; the player's team is NEVER inserted (it develops via _rd_* above), so
# there is no double-count. Empty dict = no AI development (exhibition races).
static var _dev_deltas: Dictionary = {}

# Primes the per-team AI-development state. `deltas` maps team_idx (int) ->
# {d_aero, d_power, d_energy, d_ch_rel, d_eng_rel}. Pass {} to disable.
static func apply_ai_dev(deltas: Dictionary) -> void:
	_dev_deltas = deltas
```

- [ ] **Step 2: Apply it inside `team_car()`** — in `team_car()` ([f1_2026.gd:331-337](ApexDuo_Prototype/f1_2026.gd)), immediately **after** the player-R&D `if ti == _rd_team_idx:` block and **before** the `return {`, insert:

```gdscript
	# AI development for rival teams (never overlaps the player's _rd_* path).
	if _dev_deltas.has(ti):
		var dv: Dictionary = _dev_deltas[ti]
		eng_power  += float(dv.get("d_power", 0.0))
		eng_energy += float(dv.get("d_energy", 0.0))
		eng_rel     = minf(0.99, eng_rel + float(dv.get("d_eng_rel", 0.0)))
		ch_aero    += float(dv.get("d_aero", 0.0))
		ch_rel      = minf(0.99, ch_rel + float(dv.get("d_ch_rel", 0.0)))
```

- [ ] **Step 3: Fresh-file lint** — copy the two new functions + the `team_car()` body into `outputs/_lint_f1.gd` under `extends RefCounted` (stub the `eng_*`/`ch_*` locals with `var eng_power := 0.0` etc.), then:

Run: `gdparse outputs/_lint_f1.gd && gdlint outputs/_lint_f1.gd`
Expected: exit 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add ApexDuo_Prototype/f1_2026.gd
git commit -m "feat(ai-dev): per-team development store applied in team_car()"
```

---

## Task A3: Schedule + accumulation in `season.gd`

**Files:**
- Modify: `ApexDuo_Prototype/season.gd` (constants ~333; state ~426; `configure()` ~2190; `apply_results()` ~2390; `atr_speed()` ~1592; new helpers)

- [ ] **Step 1: Add constants** — after the M3 ATR consts (`season.gd:184`, the `FUEL_DEFAULT` line region) add:

```gdscript
# AI car development (rivals develop each round on the ATR catch-up curve).
# Per-round baseline deltas (proportions match the player's R&D so both sit on
# one balance scale). Pinned in ai_dev_check.py — do not edit without re-running it.
const AI_DEV_BASELINE_AERO: float   = 0.010
const AI_DEV_BASELINE_POWER: float  = 0.004
const AI_DEV_BASELINE_ENERGY: float = 0.004
const AI_DEV_AERO_REL: float = 0.012   # d_ch_rel folded in per round
const AI_DEV_PWT_REL: float  = 0.012   # d_eng_rel folded in per round
const AI_DEV_SEED_MIX: int = 0xA1DE7   # deterministic per-team jitter stream
const AI_DEV_JITTER: float = 0.10      # ±10% seeded jitter around the baseline
```

- [ ] **Step 2: Add state** — after the M3 `bought_parts` declaration (`season.gd:426`) add:

```gdscript
# AI development: rival team_idx (as String, for JSON) -> accumulated 5-scalar dict.
# Player team is never a key. Primed into F1_2026._dev_deltas via apply_ai_dev().
var ai_dev: Dictionary = {}
```

- [ ] **Step 3: Refactor `atr_speed()` to expose a per-position helper** — replace `atr_speed()` ([season.gd:1592-1594](ApexDuo_Prototype/season.gd)) with:

```gdscript
func atr_speed() -> float:
	return _atr_for_position(constructor_position())

# ATR catch-up multiplier for any constructors position (1-based).
# P1 = 0.75 (leader handicapped) … P11+ clamps at 1.15 (underdog catches up).
func _atr_for_position(pos: int) -> float:
	return clampf(0.75 + float(pos - 1) / 9.0 * 0.40, ATR_SPEED_P1, ATR_SPEED_P10)
```

- [ ] **Step 4: Add the team-position + accumulation + prime helpers** — add these four functions near `apply_car_rd()` (e.g. after `season.gd:2312`):

```gdscript
# Per-TEAM constructor position (1-based), keyed by F1_2026 team_idx.
# standings are keyed by GRID id (0..21); the grid maps each id -> team_idx, so we
# sum points per team then rank. Total ordering (points desc, team_idx asc) keeps
# it deterministic regardless of sort stability (determinism is load-bearing).
func _team_positions() -> Dictionary:
	var grid: Array = F1_2026.race_grid(player_team)
	var pts: Dictionary = {}
	for g in grid.size():
		var ti: int = int(grid[g]["team_idx"])
		pts[ti] = int(pts.get(ti, 0)) + int(standings.get(g, 0))
	var order: Array = pts.keys()
	order.sort_custom(func(a, b):
		if int(pts[a]) != int(pts[b]):
			return int(pts[a]) > int(pts[b])
		return int(a) < int(b))
	var out: Dictionary = {}
	for i in order.size():
		out[int(order[i])] = i + 1
	return out

# Advance one round of AI development for every rival team (called at the round bump).
func _advance_ai_dev() -> void:
	var positions: Dictionary = _team_positions()
	for ti in F1_2026.team_count():
		if ti == player_team:
			continue
		var pos: int = int(positions.get(ti, 6))
		var rate: float = _atr_for_position(pos)
		# deterministic ±AI_DEV_JITTER jitter (seeded by team + round)
		var seed: int = (AI_DEV_SEED_MIX ^ (ti * 2654435761) ^ (round_index * 40503)) & 0xFFFFFFFF
		var res: Array = _lcg_step(seed)
		var jitter: float = 1.0 + (float(res[1]) - 0.5) * 2.0 * AI_DEV_JITTER
		var g: float = rate * jitter
		var key: String = str(ti)
		var dd: Dictionary = ai_dev.get(key, _zero_dev())
		dd["d_aero"]    = float(dd["d_aero"])    + AI_DEV_BASELINE_AERO   * g
		dd["d_power"]   = float(dd["d_power"])   + AI_DEV_BASELINE_POWER  * g
		dd["d_energy"]  = float(dd["d_energy"])  + AI_DEV_BASELINE_ENERGY * g
		dd["d_ch_rel"]  = float(dd["d_ch_rel"])  + AI_DEV_AERO_REL * g
		dd["d_eng_rel"] = float(dd["d_eng_rel"]) + AI_DEV_PWT_REL  * g
		ai_dev[key] = dd

# Fresh zeroed development dict.
func _zero_dev() -> Dictionary:
	return {"d_aero": 0.0, "d_power": 0.0, "d_energy": 0.0, "d_ch_rel": 0.0, "d_eng_rel": 0.0}

# Prime F1_2026 with the rivals' accumulated development (int-keyed for team_car()).
func apply_ai_dev() -> void:
	var out: Dictionary = {}
	for key: String in ai_dev:
		out[int(key)] = (ai_dev[key] as Dictionary).duplicate()
	F1_2026.apply_ai_dev(out)
```

- [ ] **Step 5: Initialise + prime in `configure()`** — in `configure()`, immediately after the `apply_car_rd()` call ([season.gd:2190](ApexDuo_Prototype/season.gd)), add:

```gdscript
	# AI development: zero-init every rival once per season (loads restore via _apply_dict).
	if ai_dev.is_empty():
		for ti in F1_2026.team_count():
			if ti != player_team:
				ai_dev[str(ti)] = _zero_dev()
	apply_ai_dev()   # prime F1_2026._dev_deltas for the rivals
```

- [ ] **Step 6: Advance at the round bump** — in `apply_results()`, immediately before `round_index += 1` ([season.gd:2390](ApexDuo_Prototype/season.gd)), add:

```gdscript
	# AI development: rivals improve their cars this round (ATR catch-up curve).
	_advance_ai_dev()
```

- [ ] **Step 7: Fresh-file lint** — copy the four new functions + the refactored `atr_speed`/`_atr_for_position` + the new consts into `outputs/_lint_season.gd` under `extends RefCounted` (stub `player_team`, `round_index`, `ai_dev`, `standings`, `_lcg_step`, `constructor_position`, and a fake `F1_2026` via local helpers as needed), then:

Run: `gdparse outputs/_lint_season.gd && gdlint outputs/_lint_season.gd`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add ApexDuo_Prototype/season.gd
git commit -m "feat(ai-dev): per-round rival development on the ATR curve"
```

---

## Task A4: Prime AI dev before the field is built (`main.gd`)

**Files:**
- Modify: `ApexDuo_Prototype/main.gd` (`_make_sim` ~234-237)

- [ ] **Step 1: Wire the prime call** — in `_make_sim()`, replace the R&D priming block ([main.gd:234-237](ApexDuo_Prototype/main.gd)):

```gdscript
	if season_race and Season.active != null:
		Season.active.apply_car_rd()
	else:
		F1_2026.apply_rd_upgrades(-1, 0.0, 0.0, 0.0, 0.0, 0.0)
```

with:

```gdscript
	if season_race and Season.active != null:
		Season.active.apply_car_rd()
		Season.active.apply_ai_dev()        # rivals' accumulated development
	else:
		F1_2026.apply_rd_upgrades(-1, 0.0, 0.0, 0.0, 0.0, 0.0)
		F1_2026.apply_ai_dev({})            # exhibition race: no AI development
```

- [ ] **Step 2: Fresh-file lint** — copy the edited block into `outputs/_lint_main.gd` inside a dummy `func _make_sim():` under `extends Node`, then:

Run: `gdparse outputs/_lint_main.gd`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add ApexDuo_Prototype/main.gd
git commit -m "feat(ai-dev): prime rival development before make_field()"
```

---

## Task A5: Save/load round-trip for `ai_dev`

**Files:**
- Modify: `ApexDuo_Prototype/season.gd` (`to_dict()` ~2552; `_apply_dict()` ~2603)
- Create: `ApexDuo_Prototype/ai_dev_save_check.py`

- [ ] **Step 1: Serialise** — in `to_dict()`, before the closing `}` of the returned dict ([season.gd:2551](ApexDuo_Prototype/season.gd), after `"replacements_used"`), add:

```gdscript
		# AI development (rival team_idx string -> 5-scalar float dict)
		"ai_dev": ai_dev.duplicate(true),
```

- [ ] **Step 2: Restore** — in `_apply_dict()`, add (anywhere after the part-levels restore, e.g. near the M3 block):

```gdscript
	# AI development restore (rebuild zeros for any rival absent in an old save).
	s.ai_dev = {}
	var raw_dev: Dictionary = data.get("ai_dev", {})
	for ti in F1_2026.team_count():
		if ti == s.player_team:
			continue
		var k: String = str(ti)
		if raw_dev.has(k):
			var src: Dictionary = raw_dev[k]
			s.ai_dev[k] = {
				"d_aero":    float(src.get("d_aero", 0.0)),
				"d_power":   float(src.get("d_power", 0.0)),
				"d_energy":  float(src.get("d_energy", 0.0)),
				"d_ch_rel":  float(src.get("d_ch_rel", 0.0)),
				"d_eng_rel": float(src.get("d_eng_rel", 0.0)),
			}
		else:
			s.ai_dev[k] = s._zero_dev()
```

- [ ] **Step 3: Write the round-trip check** (simulates Godot's JSON int→float quirk):

```python
# ai_dev_save_check.py — verifies ai_dev survives a JSON save/load round-trip.
import json
ai_dev = {str(ti): {"d_aero": 0.03, "d_power": 0.012, "d_energy": 0.012,
                    "d_ch_rel": 0.036, "d_eng_rel": 0.036}
          for ti in range(11) if ti != 4}   # player_team=4 excluded
blob = json.loads(json.dumps(ai_dev))        # JSON round-trip (floats stay floats)
ok = True
for ti in range(11):
    k = str(ti)
    if ti == 4:
        ok &= (k not in ai_dev)
        continue
    ok &= (k in blob and abs(float(blob[k]["d_aero"]) - 0.03) < 1e-9)
print("PASS" if ok else "FAIL", "ai_dev save/load round-trip")
import sys; sys.exit(0 if ok else 1)
```

- [ ] **Step 4: Run it**

Run: `python3 ApexDuo_Prototype/ai_dev_save_check.py`
Expected: `PASS ai_dev save/load round-trip`, exit 0.

- [ ] **Step 5: Fresh-file lint** the edited `to_dict`/`_apply_dict` additions (`outputs/_lint_season_save.gd`):

Run: `gdparse outputs/_lint_season_save.gd && gdlint outputs/_lint_season_save.gd`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add ApexDuo_Prototype/season.gd ApexDuo_Prototype/ai_dev_save_check.py
git commit -m "feat(ai-dev): persist rival development across save/load"
```

---

## Task A6: Real-engine confirmation (godot MCP, if connected)

**Files:** none (verification only)

- [ ] **Step 1: Run a season-shaped scenario in the real engine.** Via the godot
  MCP `script → execute_gdscript` with `project_path = …\ApexDuo_Prototype`
  (needs the `confirm_and_execute` round-trip; one race per call). Build a season,
  call `apply_results(...)` a few times to accumulate `ai_dev`, then print each
  rival team's `F1_2026.team_car(ti)` aero/power before vs after:

```gdscript
var S = load("res://season.gd").new()
S.configure(1, 1, false)                       # mid tier, normal difficulty
var before = []
for ti in F1_2026.team_count(): before.append(F1_2026.team_car(ti)["aero"])
for r in 4:                                     # 4 development increments
	S._advance_ai_dev()
S.apply_ai_dev()
var report = []
for ti in F1_2026.team_count():
	report.append({"team": F1_2026.team_name(ti), "d_aero": F1_2026.team_car(ti)["aero"] - before[ti]})
print(JSON.stringify(report))
```

- [ ] **Step 2: Confirm** every rival's `d_aero` > 0, the player team's is 0, and
  lower-ranked teams gained more than higher-ranked ones (ATR catch-up). If the
  godot MCP is not connected, mark this task skipped and rely on A1/A5.

- [ ] **Step 3: Commit** (only if any numbers were recorded into docs) — otherwise no-op.

---

# PART B — Turn-1 (first-lap) incident

## Task B1: Probability clamp check (Python first)

**Files:**
- Create: `ApexDuo_Prototype/t1_incident_check.py`

- [ ] **Step 1: Write the check**

```python
# t1_incident_check.py — verifies the Turn-1 incident probability model (Feature 2).
T1_BASE = 0.12
T1_TRACK_K = 0.15
def prob(overtaking):
    p = T1_BASE + (0.6 - overtaking) * T1_TRACK_K
    return max(0.04, min(0.30, p))

ok = True
ok &= prob(0.2) > prob(0.8)              # hard-to-pass tracks → more incidents
ok &= 0.04 <= prob(0.0) <= 0.30          # clamps hold at extremes
ok &= 0.04 <= prob(1.0) <= 0.30
ok &= abs(prob(0.6) - 0.12) < 1e-9       # neutral track ≈ base
print("PASS" if ok else "FAIL", "t1 incident probability",
      "| p(0.2)=%.3f p(0.6)=%.3f p(0.8)=%.3f" % (prob(0.2), prob(0.6), prob(0.8)))
import sys; sys.exit(0 if ok else 1)
```

- [ ] **Step 2: Run it**

Run: `python3 ApexDuo_Prototype/t1_incident_check.py`
Expected: `PASS t1 incident probability | p(0.2)=0.180 p(0.6)=0.120 p(0.8)=0.090`, exit 0.

- [ ] **Step 3: Commit**

```bash
git add ApexDuo_Prototype/t1_incident_check.py
git commit -m "test(incident): pin Turn-1 incident probability model"
```

---

## Task B2: Implement the incident in `race_sim.gd`

**Files:**
- Modify: `ApexDuo_Prototype/race_sim.gd` (constants near `PIT_LANE_K` ~347; `_race_start()` ~443-451)

- [ ] **Step 1: Add constants** — after the `PIT_LANE_K` const ([race_sim.gd:346](ApexDuo_Prototype/race_sim.gd)) add:

```gdscript
# First-lap (Turn-1) incident: a seeded chance of a start/spin that freezes the
# victim(s) for a few seconds (uses pit_timer = "distance frozen", so it NEVER
# touches `lap` — combat invariant safe). Rolled on erng at race start; an
# incident can also bring out the safety car. Tunables verified in
# t1_incident_check.py + a real-engine frequency run.
const T1_INCIDENT_BASE := 0.12     # base per-race probability
const T1_INCIDENT_TRACK_K := 0.15  # +prob where the track is hard to pass (low overtaking)
const T1_INCIDENT_DOUBLE := 0.30   # chance a second car is collected
const T1_LOSS_MIN := 3.0           # min time loss (s)
const T1_LOSS_MAX := 14.0          # max time loss (s)
const T1_SC_UPLIFT := 0.35         # chance the incident triggers a safety car (if none scheduled)
```

- [ ] **Step 2: Add the probability helper** — add near `_race_start()` (e.g. just above it, before `race_sim.gd:443`):

```gdscript
# Turn-1 incident probability for this track (more likely where passing is hard).
func _t1_incident_prob() -> float:
	return clampf(T1_INCIDENT_BASE + (0.6 - track.overtaking) * T1_INCIDENT_TRACK_K, 0.04, 0.30)
```

- [ ] **Step 3: Roll the incident in `_race_start()`** — at the **end** of `_race_start()` (after the launch loop closes, `race_sim.gd:451`), add:

```gdscript
	# First-lap incident: a seeded shuffle at Turn 1.
	if erng.unit() < _t1_incident_prob():
		var pool: Array = []
		for d in drivers:
			if not d.finished:
				pool.append(d)
		if not pool.is_empty():
			var n: int = 1 + (1 if erng.unit() < T1_INCIDENT_DOUBLE else 0)
			for _k in mini(n, pool.size()):
				var idx: int = mini(pool.size() - 1, int(erng.unit() * pool.size()))
				var victim: Driver = pool[idx]
				pool.remove_at(idx)
				var loss: float = erng.rangef(T1_LOSS_MIN, T1_LOSS_MAX)
				victim.pit_timer = maxf(victim.pit_timer, loss)   # frozen → drops back; lap untouched
				victim.had_incident = true
				_emit("%s: инцидент на старте — потеря времени." % victim.name, "incident")
			# an opening-lap incident can bring out the safety car
			if sc_deploy_lap < 0 and erng.unit() < T1_SC_UPLIFT:
				sc_deploy_lap = 1
```

- [ ] **Step 4: Fresh-file lint** — copy `_t1_incident_prob()`, the new consts, and a stub `_race_start()` containing the incident block into `outputs/_lint_race.gd` under `extends RefCounted` (stub `erng`, `drivers`, `track`, `sc_deploy_lap`, `_emit`, and a minimal `Driver` class), then:

Run: `gdparse outputs/_lint_race.gd && gdlint outputs/_lint_race.gd`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add ApexDuo_Prototype/race_sim.gd
git commit -m "feat(incident): seeded Turn-1 incident (pit_timer freeze, erng)"
```

---

## Task B3: Verify frequency + invariant (real engine + regression)

**Files:** none (verification only)

- [ ] **Step 1: Combat invariant regression (must still pass).** The incident sets
  `pit_timer`, never `lap`, so the invariant holds by construction. Confirm the
  existing mirror still passes:

Run: `python3 ApexDuo_Prototype/combat_lap_check.py`
Expected: the check's existing PASS output (completions == lap).

- [ ] **Step 2: Real-engine frequency run (godot MCP, if connected).** Via
  `execute_gdscript` (one race per call is the cap, so loop *constructions*, not a
  long sim — only `_init` + `_race_start` are needed to observe the incident roll):

```gdscript
var track = load("res://race_sim.gd").Track.new()   # default overtaking=0.6 → prob≈0.12
var hits = 0
var N = 200
for s in N:
	var f = RaceSim.make_field(false, 1, {})
	var sim = RaceSim.new(track, f, 1000 + s)
	sim.step(0.25)                                   # fires _race_start once
	for d in sim.drivers:
		if d.had_incident:
			hits += 1
			break
print("incident rate = %.3f over %d races (expect ~0.12)" % [float(hits) / float(N), N])
```

- [ ] **Step 3: Confirm** the observed rate is ≈ `_t1_incident_prob()` for the
  default track (~0.10–0.14 over 200 seeds) and that affected cars drop down the
  order without errors. If the godot MCP is unavailable, mark skipped and rely on
  B1 + the invariant regression.

- [ ] **Step 4: Commit** (docs only, if any numbers recorded) — otherwise no-op.

---

# PART C — Docs

## Task C1: Update README + roadmap

**Files:**
- Modify: `ApexDuo_Prototype/README.md`

- [ ] **Step 1:** Add to the implemented-features list: rivals develop their cars
  across the season on the ATR catch-up curve (the `CARS` table is no longer
  static), and a seeded first-lap (Turn-1) incident. Move "car development via
  R&D (rivals)" out of the open-roadmap section. Reference the design doc
  `docs/superpowers/specs/2026-06-10-ai-car-development-and-turn1-incident-design.md`.

- [ ] **Step 2: Commit**

```bash
git add ApexDuo_Prototype/README.md
git commit -m "docs: README + roadmap for AI car development & Turn-1 incident"
```

---

## Final verification checklist (run before calling it done)

- [ ] `python3 ApexDuo_Prototype/ai_dev_check.py` → all PASS
- [ ] `python3 ApexDuo_Prototype/ai_dev_save_check.py` → PASS
- [ ] `python3 ApexDuo_Prototype/t1_incident_check.py` → PASS
- [ ] `python3 ApexDuo_Prototype/combat_lap_check.py` → PASS (invariant intact)
- [ ] Fresh-file `gdparse`/`gdlint` clean for every edited `.gd`
- [ ] (If godot MCP up) rival cars gain pace over the season; lower-ranked gain
      more; player team unchanged by AI dev; Turn-1 incident rate ≈ target
- [ ] README/roadmap updated; spec + plan committed on the branch
