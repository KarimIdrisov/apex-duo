# Sector System + ERS Integration (Вариант Б) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full 3-sector + 17 mini-sector racing system with timing tower HUD (F1 Manager 2024-style coloured blocks), sector-aware ERS/DRS, and elastic minimap animation.

**Architecture:** `Track` gains `sector_bounds [s1_end, s2_end]`, `sector_chars [3]` (power/aero/harvest/drs per sector), and `mini_sector_bounds [17]` computed from equal subdivision. `Driver` tracks `cur_sector`, `sector_times[3]`, `sector_best[3]`, `soc_at_sector[3]`, `cur_mini`, `mini_times_this_lap[17]`, `mini_best[17]`. `current_laptime()` is **unchanged** (balance preserved); DRS restriction moves into `_ot_effective()`; ERS AI gains sector lookahead; a new timing tower in `main.gd` shows per-driver mini-sector blocks (purple / green / yellow / grey); `track_map.gd` applies an elastic visual remap so cars visually slow in corners.

**Tech Stack:** GDScript 4.6, Godot 4.6.3, Python harness (`simcheck.py`), `gdparse` / `gdlint` for syntax.

---

## File Map

| File | What changes |
|---|---|
| `ApexDuo_Prototype/race_sim.gd` | `Track`: new sector fields + `_build_mini_bounds()`. `Driver`: sector / mini state. `_init()`: init global bests + driver sector state. `step()` phase 1: call `_check_sector_crossing()`. `_on_lap_complete()`: record S3 + reset. `_ot_effective()`: DRS sector gate. `_situational_energy()`: sector lookahead. New funcs: `_check_sector_crossing()`, `_sector_frac()`, `_sector_ers_hint()`, `_build_default_sectors()`. New `static var`: `SECTOR_BOUNDS`, `SECTOR_CHARS`. |
| `ApexDuo_Prototype/main.gd` | New: `_build_timing_tower()`, `_update_timing_tower()`. Call `_update_timing_tower()` in `_process()`. Pass `sim.track.mini_sector_bounds` to timing tower at race start. |
| `ApexDuo_Prototype/track_map.gd` | New: `set_segments()`, `_build_visual_remap()`, `_visual_frac()`. Use remap in `_norm_pos()`. New fields: `_segments`, `_vis_map`. |

---

## Task 1 — Track Sector Data Model

**Files:**
- Modify: `ApexDuo_Prototype/race_sim.gd` — `class Track` + `real_track()` + `generate_track()` + new static vars + new static funcs

- [ ] **Step 1.1 — Add fields to `class Track`**

Insert after the existing `var segments: Array = []` line (≈ line 321):

```gdscript
	# --- sector model ---
	# sector_bounds: lap_frac where S1 ends, then S2 ends (S3 always ends at 1.0)
	var sector_bounds: Array = [0.33, 0.67]
	# sector_chars: per-sector {power, aero, harvest, drs} — shapes DRS eligibility and
	# ERS AI decisions; does NOT change current_laptime() (balance preserved).
	var sector_chars: Array = [
		{"power": 0.5, "aero": 0.5, "harvest": 0.6, "drs": false},
		{"power": 0.6, "aero": 0.4, "harvest": 0.5, "drs": true},
		{"power": 0.5, "aero": 0.5, "harvest": 0.5, "drs": false},
	]
	# mini_sector_bounds: 17 lap_frac values marking end of each mini-sector.
	# 5 in S1, 7 in S2, 5 in S3. Populated by _build_mini_bounds().
	var mini_sector_bounds: Array = []

	# Populate mini_sector_bounds from sector_bounds (call after setting sector_bounds).
	func _build_mini_bounds() -> void:
		mini_sector_bounds = []
		var counts: Array = [5, 7, 5]
		var s_start := 0.0
		for si in 3:
			var s_end: float = float(sector_bounds[si]) if si < 2 else 1.0
			var n: int = int(counts[si])
			for mi in n:
				mini_sector_bounds.append(s_start + (s_end - s_start) * float(mi + 1) / float(n))
			s_start = s_end
```

- [ ] **Step 1.2 — Add `SECTOR_BOUNDS` and `SECTOR_CHARS` static vars**

Insert after the `TRACK_STRAIGHT_KM` const (≈ line 1687), before `REAL_TRACKS`:

```gdscript
# Per-circuit sector boundaries and character. Sector bounds = lap_frac where S1 ends,
# then where S2 ends. Chars: power/aero bias + DRS availability per sector.
# Research basis: real F1 sector timing maps (S1/S2/S3 boundaries per circuit).
static var SECTOR_BOUNDS: Dictionary = {
	"Монако":       [0.36, 0.65],
	"Монца":        [0.33, 0.67],
	"Спа":          [0.34, 0.68],
	"Сильверстоун": [0.35, 0.70],
	"Сингапур":     [0.38, 0.70],
	"Бахрейн":      [0.35, 0.70],
	"Хунгароринг":  [0.38, 0.72],
	"Сузука":       [0.38, 0.72],
	"Баку":         [0.35, 0.68],
	"Зандворт":     [0.38, 0.72],
}

# {power, aero, harvest, drs} per S1/S2/S3. Values shape AI ERS decisions and
# DRS eligibility; they don't change current_laptime() (balance stays intact).
static var SECTOR_CHARS: Dictionary = {
	"Монако": [
		{"power": 0.15, "aero": 0.95, "harvest": 0.75, "drs": false},
		{"power": 0.35, "aero": 0.75, "harvest": 0.70, "drs": false},
		{"power": 0.20, "aero": 0.90, "harvest": 0.80, "drs": false},
	],
	"Монца": [
		{"power": 0.75, "aero": 0.25, "harvest": 0.45, "drs": false},
		{"power": 0.97, "aero": 0.15, "harvest": 0.38, "drs": true},
		{"power": 0.90, "aero": 0.20, "harvest": 0.40, "drs": true},
	],
	"Спа": [
		{"power": 0.88, "aero": 0.60, "harvest": 0.50, "drs": true},
		{"power": 0.70, "aero": 0.75, "harvest": 0.58, "drs": false},
		{"power": 0.80, "aero": 0.50, "harvest": 0.55, "drs": true},
	],
	"Сильверстоун": [
		{"power": 0.50, "aero": 0.90, "harvest": 0.55, "drs": false},
		{"power": 0.70, "aero": 0.55, "harvest": 0.58, "drs": true},
		{"power": 0.55, "aero": 0.75, "harvest": 0.60, "drs": false},
	],
	"Сингапур": [
		{"power": 0.30, "aero": 0.88, "harvest": 0.80, "drs": false},
		{"power": 0.35, "aero": 0.90, "harvest": 0.82, "drs": false},
		{"power": 0.45, "aero": 0.85, "harvest": 0.78, "drs": true},
	],
	"Бахрейн": [
		{"power": 0.70, "aero": 0.55, "harvest": 0.68, "drs": true},
		{"power": 0.55, "aero": 0.75, "harvest": 0.72, "drs": false},
		{"power": 0.75, "aero": 0.45, "harvest": 0.65, "drs": true},
	],
	"Хунгароринг": [
		{"power": 0.30, "aero": 0.88, "harvest": 0.65, "drs": false},
		{"power": 0.25, "aero": 0.92, "harvest": 0.68, "drs": false},
		{"power": 0.40, "aero": 0.80, "harvest": 0.62, "drs": true},
	],
	"Сузука": [
		{"power": 0.55, "aero": 0.85, "harvest": 0.52, "drs": false},
		{"power": 0.68, "aero": 0.62, "harvest": 0.55, "drs": true},
		{"power": 0.50, "aero": 0.80, "harvest": 0.58, "drs": false},
	],
	"Баку": [
		{"power": 0.97, "aero": 0.20, "harvest": 0.58, "drs": true},
		{"power": 0.30, "aero": 0.85, "harvest": 0.68, "drs": false},
		{"power": 0.90, "aero": 0.30, "harvest": 0.62, "drs": true},
	],
	"Зандворт": [
		{"power": 0.35, "aero": 0.90, "harvest": 0.60, "drs": false},
		{"power": 0.45, "aero": 0.88, "harvest": 0.62, "drs": false},
		{"power": 0.48, "aero": 0.85, "harvest": 0.58, "drs": true},
	],
}
```

- [ ] **Step 1.3 — Add `_build_default_sectors()` static func**

Insert immediately after the `_build_segments()` static func:

```gdscript
# Default sector model for generated (fictional) tracks. Uses the archetype's
# power/downforce/harvest to infer per-sector character. S2 always gets DRS.
static func _build_default_sectors(t: Track) -> void:
	t.sector_bounds = [0.33, 0.67]
	var p := t.power
	var a := t.downforce
	var h := t.harvest
	t.sector_chars = [
		{"power": clampf(p * 0.7, 0.0, 1.0), "aero": clampf(a * 1.1, 0.0, 1.0),
		 "harvest": clampf(h * 1.1, 0.0, 1.0), "drs": false},
		{"power": clampf(p * 1.3, 0.0, 1.0), "aero": clampf(a * 0.8, 0.0, 1.0),
		 "harvest": clampf(h * 0.8, 0.0, 1.0), "drs": true},
		{"power": p, "aero": a, "harvest": h, "drs": false},
	]
```

- [ ] **Step 1.4 — Wire sector data into `real_track()`**

In `real_track()`, after the `_build_segments(t)` call, add:

```gdscript
	# Sector model
	if SECTOR_BOUNDS.has(t.name):
		t.sector_bounds = Array(SECTOR_BOUNDS[t.name])
		t.sector_chars  = Array(SECTOR_CHARS[t.name])
	else:
		_build_default_sectors(t)
	t._build_mini_bounds()
```

- [ ] **Step 1.5 — Wire sector data into `generate_track()`**

In `generate_track()`, after the `return t` line (actually before it — the last lines are `t.air_temp = ...`), add just before the `return t`:

```gdscript
	_build_default_sectors(t)
	t._build_mini_bounds()
```

- [ ] **Step 1.6 — Lint check in a fresh file**

Copy the new Track fields, `_build_mini_bounds()`, `_build_default_sectors()`, and the two static vars into a temp file `outputs/sector_track_check.gd` and run:

```
python -m gdtoolkit.parser outputs/sector_track_check.gd
```

Expected: `No syntax errors found`.

- [ ] **Step 1.7 — Commit**

```
git add ApexDuo_Prototype/race_sim.gd
git commit -m "feat(sector): Track sector bounds + chars + mini_sector_bounds for 10 real tracks"
```

---

## Task 2 — Driver Sector State + RaceSim Global Bests

**Files:**
- Modify: `ApexDuo_Prototype/race_sim.gd` — `class Driver` + `_init()`

- [ ] **Step 2.1 — Add fields to `class Driver`**

Insert after `var compounds_used: Array = []` (the last existing Driver field, ≈ line 283):

```gdscript
	# --- sector timing ---
	var cur_sector: int = 0               # 0 / 1 / 2 — current macro sector
	var sector_entry_time: float = -1.0   # elapsed when entered current sector
	var sector_times: Array = [-1.0, -1.0, -1.0]   # last completed S1/S2/S3 (s)
	var sector_best:  Array = [-1.0, -1.0, -1.0]   # personal best per sector (s)
	var soc_at_sector: Array = [80.0, 80.0, 80.0]  # SoC when entering each sector
	# --- mini-sector timing (17 total: 5+7+5) ---
	var cur_mini: int = 0                 # index of next unfinished mini-sector
	var mini_entry_time: float = -1.0     # elapsed when entered current mini-sector
	var mini_times_this_lap: Array = []   # size 17; -1.0 = not yet done this lap
	var mini_best: Array = []             # size 17; personal best per mini
```

- [ ] **Step 2.2 — Add global-best fields to `RaceSim` sim state block**

After `var fastest_id: int = -1` (≈ line 361), add:

```gdscript
var sector_global_best: Array = [-1.0, -1.0, -1.0]  # track record per macro sector (s)
var mini_global_best: Array = []                      # track record per mini-sector (17 floats)
```

- [ ] **Step 2.3 — Initialise global bests and driver sector state in `_init()`**

At the end of `_init()`, after `_run_qualifying()`, add:

```gdscript
	# Global best arrays sized to match mini_sector_bounds
	var _n_mini: int = track.mini_sector_bounds.size()
	sector_global_best = [-1.0, -1.0, -1.0]
	mini_global_best = []
	for _mi in _n_mini:
		mini_global_best.append(-1.0)
	# Per-driver sector state (after qualifying sets lap_frac)
	for _d in drivers:
		_init_sector_state(_d)
```

- [ ] **Step 2.4 — Add `_init_sector_state()` helper**

Insert after `_run_qualifying()` func (before `_race_start()`):

```gdscript
# Initialise sector tracking for one driver. Called in _init() and on reset.
func _init_sector_state(d: Driver) -> void:
	# Determine starting sector from lap_frac (qualifying grid spacing)
	d.cur_sector = 0
	if track.sector_bounds.size() >= 2:
		for si in 2:
			if d.lap_frac >= float(track.sector_bounds[si]):
				d.cur_sector = si + 1
	d.sector_entry_time = elapsed   # 0.0 at sim start
	d.soc_at_sector[0] = d.soc
	# Mini-sector state
	var n_mini: int = track.mini_sector_bounds.size()
	d.mini_times_this_lap = []
	d.mini_best = []
	for _i in n_mini:
		d.mini_times_this_lap.append(-1.0)
		d.mini_best.append(-1.0)
	d.cur_mini = 0
	for mi in n_mini:
		if d.lap_frac >= float(track.mini_sector_bounds[mi]):
			d.cur_mini = mi + 1
		else:
			break
	d.mini_entry_time = elapsed
```

- [ ] **Step 2.5 — Commit**

```
git add ApexDuo_Prototype/race_sim.gd
git commit -m "feat(sector): Driver sector/mini state + RaceSim global bests"
```

---

## Task 3 — Sector Crossing Detection

**Files:**
- Modify: `ApexDuo_Prototype/race_sim.gd` — `step()` + new `_check_sector_crossing()`

- [ ] **Step 3.1 — Add `_check_sector_crossing()` func**

Insert before `_race_start()`:

```gdscript
# Detect macro-sector and mini-sector boundary crossings for one driver.
# Called in step() phase 1 after lap_frac advances; prev_frac is the value before.
# Pitting / finished drivers are skipped (lap_frac frozen).
func _check_sector_crossing(d: Driver, prev_frac: float) -> void:
	if d.finished or d.pit_timer > 0.0:
		return
	var new_frac: float = d.lap_frac
	# --- Macro sectors (two internal boundaries: S1→S2 and S2→S3) ---
	if track.sector_bounds.size() >= 2:
		for si in 2:
			var bound: float = float(track.sector_bounds[si])
			if prev_frac < bound and new_frac >= bound:
				# Record time for sector si (just completed)
				if d.sector_entry_time >= 0.0:
					var t: float = elapsed - d.sector_entry_time
					d.sector_times[si] = t
					if float(d.sector_best[si]) < 0.0 or t < float(d.sector_best[si]):
						d.sector_best[si] = t
					if float(sector_global_best[si]) < 0.0 or t < float(sector_global_best[si]):
						sector_global_best[si] = t
				# Enter next sector
				d.cur_sector = si + 1
				d.sector_entry_time = elapsed
				d.soc_at_sector[si + 1] = d.soc_avg
				if d.team:
					_sector_ers_hint(d)
	# --- Mini-sectors ---
	var n_mini: int = track.mini_sector_bounds.size()
	if n_mini == 0 or d.mini_times_this_lap.is_empty():
		return
	while d.cur_mini < n_mini:
		var mb: float = float(track.mini_sector_bounds[d.cur_mini])
		if new_frac < mb:
			break
		if prev_frac < mb:   # crossed this boundary this tick
			if d.mini_entry_time >= 0.0:
				var mt: float = elapsed - d.mini_entry_time
				d.mini_times_this_lap[d.cur_mini] = mt
				if float(d.mini_best[d.cur_mini]) < 0.0 or mt < float(d.mini_best[d.cur_mini]):
					d.mini_best[d.cur_mini] = mt
				if float(mini_global_best[d.cur_mini]) < 0.0 or mt < float(mini_global_best[d.cur_mini]):
					mini_global_best[d.cur_mini] = mt
			d.mini_entry_time = elapsed
		d.cur_mini += 1
```

- [ ] **Step 3.2 — Call `_check_sector_crossing()` in `step()` phase 1**

In `step()`, after the line `d.lap_frac += dt / lt` (≈ in the phase-1 loop, after updating wear/soc/temp), add:

```gdscript
			var _prev_frac := d.lap_frac - dt / lt   # value before this tick's advance
			_check_sector_crossing(d, _prev_frac)
```

> **Note:** `_prev_frac` must be saved **before** adding `dt/lt`. Restructure to: save `var prev_frac := d.lap_frac` before the line `d.lap_frac += dt / lt`, then pass `prev_frac` to `_check_sector_crossing(d, prev_frac)`.

Exact edit — before `d.lap_frac += dt / lt`:

```gdscript
			var _sector_prev := d.lap_frac
			d.lap_frac += dt / lt
			_check_sector_crossing(d, _sector_prev)
```

- [ ] **Step 3.3 — Add `_sector_ers_hint()` helper** (called from crossing detection)

Insert after `_check_sector_crossing()`:

```gdscript
# Radio hint when entering a new sector: tells the engineer about battery vs DRS.
# Only fires for team cars, respects radio_cd.
func _sector_ers_hint(d: Driver) -> void:
	if d.radio_cd > 0 or track.sector_chars.is_empty():
		return
	var sc: Dictionary = track.sector_chars[d.cur_sector]
	var is_drs: bool = bool(sc.get("drs", false))
	var next_si: int = (d.cur_sector + 1) % 3
	var next_sc: Dictionary = track.sector_chars[next_si] if not track.sector_chars.is_empty() else {}
	var msg := ""
	if is_drs:
		if d.soc_avg < 38.0:
			msg = "S%d: DRS-зона, батарея %d%% — будет трудно!" % [d.cur_sector + 1, int(d.soc_avg)]
		elif d.soc_avg > 68.0:
			msg = "S%d: DRS, %d%% — атакуй!" % [d.cur_sector + 1, int(d.soc_avg)]
	elif bool(next_sc.get("drs", false)) and d.soc_avg < 48.0:
		msg = "S%d: харвест — следующий сектор DRS" % [d.cur_sector + 1]
	if msg != "":
		_emit("Инженер → %s: «%s»" % [d.name, msg], "radio")
		d.radio_cd = 3
```

- [ ] **Step 3.4 — Commit**

```
git add ApexDuo_Prototype/race_sim.gd
git commit -m "feat(sector): sector crossing detection + ERS sector radio hints"
```

---

## Task 4 — S3 Completion and Reset in `_on_lap_complete()`

**Files:**
- Modify: `ApexDuo_Prototype/race_sim.gd` — `_on_lap_complete()`

- [ ] **Step 4.1 — Record S3 time and reset sector state at lap start**

At the **very beginning** of `_on_lap_complete(d)`, before the existing `d.deploy_budget = ...` line, insert:

```gdscript
	# --- Sector 2 (S3) completion at the lap boundary ---
	if d.sector_entry_time >= 0.0 and d.cur_sector == 2:
		var _t3: float = elapsed - d.sector_entry_time
		d.sector_times[2] = _t3
		if float(d.sector_best[2]) < 0.0 or _t3 < float(d.sector_best[2]):
			d.sector_best[2] = _t3
		if float(sector_global_best[2]) < 0.0 or _t3 < float(sector_global_best[2]):
			sector_global_best[2] = _t3
	# Record the final mini-sector if the loop didn't already catch it
	var _nm: int = track.mini_sector_bounds.size()
	if _nm > 0 and not d.mini_times_this_lap.is_empty() \
			and d.cur_mini == _nm - 1 and d.mini_entry_time >= 0.0:
		var _mlt: float = elapsed - d.mini_entry_time
		d.mini_times_this_lap[_nm - 1] = _mlt
		if float(d.mini_best[_nm - 1]) < 0.0 or _mlt < float(d.mini_best[_nm - 1]):
			d.mini_best[_nm - 1] = _mlt
		if float(mini_global_best[_nm - 1]) < 0.0 or _mlt < float(mini_global_best[_nm - 1]):
			mini_global_best[_nm - 1] = _mlt
	# Reset for new lap
	d.cur_sector = 0
	d.sector_entry_time = elapsed
	d.soc_at_sector[0] = d.soc_avg
	d.cur_mini = 0
	d.mini_entry_time = elapsed
	d.mini_times_this_lap = []
	for _ri in _nm:
		d.mini_times_this_lap.append(-1.0)
```

- [ ] **Step 4.2 — Lint the changed `_on_lap_complete()` in a fresh file**

Copy `_on_lap_complete()` into `outputs/on_lap_complete_check.gd` and run:

```
python -m gdtoolkit.parser outputs/on_lap_complete_check.gd
```

Expected: no errors.

- [ ] **Step 4.3 — Commit**

```
git add ApexDuo_Prototype/race_sim.gd
git commit -m "feat(sector): S3 completion + sector state reset at lap boundary"
```

---

## Task 5 — DRS Sector Gate + Sector-Aware ERS AI

**Files:**
- Modify: `ApexDuo_Prototype/race_sim.gd` — `_ot_effective()`, `_situational_energy()`

- [ ] **Step 5.1 — Gate `_ot_effective()` on DRS sector**

Replace the existing `_ot_effective()` func:

```gdscript
func _ot_effective(d: Driver, ahead_gap: float) -> bool:
	# DRS / Overtake only fires in designated sectors (track.sector_chars[si].drs == true).
	# If sector data is absent (generated tracks without chars), allow everywhere.
	if not track.sector_chars.is_empty():
		var _sc: Dictionary = track.sector_chars[d.cur_sector]
		if not bool(_sc.get("drs", false)):
			return false
	return d.overtake and not d.clipped and d.soc > OT_MIN_SOC \
		and ahead_gap >= 0.0 and ahead_gap < OT_GAP_S
```

- [ ] **Step 5.2 — Add sector lookahead to `_situational_energy()`**

At the **end** of `_situational_energy()`, before the closing `}`, add:

```gdscript
	# Sector lookahead: approaching end of sector, next sector is DRS, SoC low → harvest now.
	if not track.sector_chars.is_empty() and not d.clipped:
		var _next_si: int = (d.cur_sector + 1) % 3
		var _next_sc: Dictionary = track.sector_chars[_next_si]
		var _sfrac: float = _sector_frac(d)
		if bool(_next_sc.get("drs", false)) and _sfrac > 0.75 and d.soc_avg < 45.0 \
				and d.ers_mode != "harvest":
			d.ers_mode = "harvest"
			d.overtake = false
```

- [ ] **Step 5.3 — Add `_sector_frac()` helper**

Insert after `_sector_ers_hint()`:

```gdscript
# How far through the current macro sector the driver is (0.0 = just entered, 1.0 = at end).
func _sector_frac(d: Driver) -> float:
	if track.sector_bounds.size() < 2:
		return d.lap_frac
	var s_start: float = 0.0 if d.cur_sector == 0 else float(track.sector_bounds[d.cur_sector - 1])
	var s_end: float = float(track.sector_bounds[d.cur_sector]) if d.cur_sector < 2 else 1.0
	return clampf((d.lap_frac - s_start) / maxf(0.001, s_end - s_start), 0.0, 1.0)
```

- [ ] **Step 5.4 — Commit**

```
git add ApexDuo_Prototype/race_sim.gd
git commit -m "feat(sector): DRS restricted to sector chars + ERS AI sector lookahead"
```

---

## Task 6 — Python Balance Verification

**Files:**
- Read: `tools/simcheck.py` or `outputs/simcheck.py`

- [ ] **Step 6.1 — Run baseline Монза race and record gaps**

```
python outputs/simcheck.py 2>&1 | head -60
```

Expected: P1–P5 gaps roughly 0–8 s, top team (Ferrari/power) winning Monza, no assertion errors.

- [ ] **Step 6.2 — Verify DRS restriction doesn't collapse overtaking**

Write a small inline Python script `outputs/sector_balance_check.py`:

```python
# Quick check: does DRS sector restriction reduce passes at Monaco vs Monza?
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
# Monaco: all drs=false → passes should be rare
# Monza:  S2+S3 drs=true → passes should be common
# We can't run GDScript here, so just verify the sector bounds logic.
SECTOR_BOUNDS = {"Монако": [0.36, 0.65], "Монца": [0.33, 0.67]}
SECTOR_CHARS = {
    "Монако": [{"drs": False}, {"drs": False}, {"drs": False}],
    "Монца":  [{"drs": False}, {"drs": True},  {"drs": True}],
}

for track, bounds in SECTOR_BOUNDS.items():
    drs_sectors = [i for i, sc in enumerate(SECTOR_CHARS[track]) if sc["drs"]]
    print(f"{track}: DRS in sectors {drs_sectors}, bounds={bounds}")

# Sector frac coverage
for track, bounds in SECTOR_BOUNDS.items():
    s_sizes = [bounds[0], bounds[1]-bounds[0], 1.0-bounds[1]]
    print(f"  sector sizes: {[f'{s:.2f}' for s in s_sizes]} (sum={sum(s_sizes):.2f})")
```

```
python outputs/sector_balance_check.py
```

Expected output:
```
Монако: DRS in sectors [], bounds=[0.36, 0.65]
  sector sizes: ['0.36', '0.29', '0.35'] (sum=1.00)
Монца: DRS in sectors [1, 2], bounds=[0.33, 0.67]
  sector sizes: ['0.33', '0.34', '0.33'] (sum=1.00)
```

- [ ] **Step 6.3 — Real-engine headless verification (optional, if Godot MCP available)**

Via `mcp__godot__script`, run one race at Monza seed=1, check that `passes_made` totals are reasonable (>5 across top-10) and no errors thrown. Compare with a pre-DRS-gate run.

- [ ] **Step 6.4 — Commit verification script**

```
git add outputs/sector_balance_check.py
git commit -m "test(sector): balance verification script for DRS sector restriction"
```

---

## Task 7 — Timing Tower HUD

**Files:**
- Modify: `ApexDuo_Prototype/main.gd` — add timing tower panel

- [ ] **Step 7.1 — Add timing tower instance vars to the top of `main.gd`**

Near the top of `main.gd` where other HUD node refs are stored, add:

```gdscript
var _tt_panel: PanelContainer
var _tt_rows: Array = []       # [{row, pos_lbl, drv_lbl, lap_lbl, pit_lbl,
                               #    tyre_lbl, best_lbl, gap_lbl, int_lbl,
                               #    last_lbl, minis: Array[ColorRect]}]
const TT_MINI_COUNTS: Array = [5, 7, 5]   # mini-sectors per S1/S2/S3
const TT_MINI_TOTAL: int = 17
const TT_COL_MINI_W: int = 8    # px per mini-sector block
const TT_COL_MINI_H: int = 14
const TT_COL_SEP: int = 4       # px gap between macro sectors
```

- [ ] **Step 7.2 — Add `_build_timing_tower()` function**

```gdscript
func _build_timing_tower() -> void:
	if _tt_panel != null:
		_tt_panel.queue_free()
	_tt_rows.clear()

	_tt_panel = PanelContainer.new()
	_tt_panel.add_theme_stylebox_override("panel", _dark_panel_style())
	# Position: right side of screen, below the race feed
	_tt_panel.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	_tt_panel.position = Vector2(-420.0, 120.0)
	_tt_panel.custom_minimum_size = Vector2(410.0, 0.0)
	add_child(_tt_panel)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 1)
	_tt_panel.add_child(vbox)

	# Header row
	var hdr := _tt_header_row()
	vbox.add_child(hdr)
	vbox.add_child(_separator_line())

	# Driver rows (22 max)
	for _i in 22:
		var rd := _build_tt_row()
		_tt_rows.append(rd)
		vbox.add_child(rd["row"])

func _dark_panel_style() -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = Color(0.05, 0.06, 0.08, 0.92)
	s.set_corner_radius_all(6)
	return s

func _separator_line() -> HSeparator:
	var sep := HSeparator.new()
	sep.add_theme_color_override("color", Color(0.2, 0.22, 0.26))
	return sep

func _tt_header_row() -> HBoxContainer:
	var hb := HBoxContainer.new()
	hb.add_theme_constant_override("separation", 4)
	var cols := [["#", 22], ["Гонщик", 58], ["Кр", 28], ["Пит", 24],
	             ["Ш", 22], ["Лучший", 64], ["Отрыв", 58], ["Инт", 52],
	             ["Мини-секторы", 145], ["Посл", 58]]
	for col in cols:
		var lbl := Label.new()
		lbl.text = String(col[0])
		lbl.custom_minimum_size = Vector2(int(col[1]), 0)
		lbl.add_theme_color_override("font_color", Color(0.55, 0.58, 0.65))
		lbl.add_theme_font_size_override("font_size", 10)
		hb.add_child(lbl)
	return hb

func _build_tt_row() -> Dictionary:
	var hb := HBoxContainer.new()
	hb.add_theme_constant_override("separation", 4)
	hb.custom_minimum_size = Vector2(0, 20)

	func _lbl(w: int) -> Label:
		var l := Label.new()
		l.custom_minimum_size = Vector2(w, 0)
		l.add_theme_font_size_override("font_size", 11)
		l.add_theme_color_override("font_color", Color(0.85, 0.88, 0.92))
		l.clip_contents = true
		hb.add_child(l)
		return l

	var pos_lbl  := _lbl(22)
	var drv_lbl  := _lbl(58)
	var lap_lbl  := _lbl(28)
	var pit_lbl  := _lbl(24)
	var tyr_lbl  := _lbl(22)
	var best_lbl := _lbl(64)
	var gap_lbl  := _lbl(58)
	var int_lbl  := _lbl(52)

	# Mini-sector blocks: 3 groups separated by a small gap
	var mini_hb := HBoxContainer.new()
	mini_hb.custom_minimum_size = Vector2(145, 0)
	mini_hb.add_theme_constant_override("separation", 1)
	hb.add_child(mini_hb)
	var minis: Array = []
	for si in 3:
		if si > 0:
			var gap := Control.new()
			gap.custom_minimum_size = Vector2(TT_COL_SEP, 1)
			mini_hb.add_child(gap)
		for _mi in TT_MINI_COUNTS[si]:
			var rect := ColorRect.new()
			rect.custom_minimum_size = Vector2(TT_COL_MINI_W, TT_COL_MINI_H)
			rect.color = Color(0.18, 0.20, 0.24)
			mini_hb.add_child(rect)
			minis.append(rect)

	var last_lbl := _lbl(58)

	return {
		"row": hb, "pos": pos_lbl, "drv": drv_lbl, "lap": lap_lbl,
		"pit": pit_lbl, "tyr": tyr_lbl, "best": best_lbl,
		"gap": gap_lbl, "int": int_lbl, "last": last_lbl,
		"minis": minis,
	}
```

> **GDScript note:** inner `func _lbl(...)` is a lambda declared with `func`. In GDScript 4, you cannot declare a named inner func inside another func. Use a lambda assigned to a variable instead:
> `var _lbl := func(w: int) -> Label: ...` then call it as `_lbl.call(22)`.

- [ ] **Step 7.3 — Add `_update_timing_tower()` function**

```gdscript
func _update_timing_tower(sim: RaceSim) -> void:
	if _tt_rows.is_empty() or sim == null:
		return
	var sorted := sim.order()
	var leader_time := -1.0
	for i in mini(_tt_rows.size(), sorted.size()):
		var d: RaceSim.Driver = sorted[i]
		var rd: Dictionary = _tt_rows[i]
		rd["row"].visible = true
		rd["pos"].text = str(i + 1)
		# Driver abbreviation (first 3 chars of last name)
		var parts := d.name.split(" ")
		rd["drv"].text = parts[parts.size() - 1].left(3).to_upper()
		rd["drv"].add_theme_color_override("font_color",
			d.color if d.color != "" else Color(0.85, 0.88, 0.92))
		rd["lap"].text = str(d.lap + 1)
		rd["pit"].text = str(d.pit_count)
		rd["tyr"].text = d.compound.left(1).to_upper()
		rd["best"].text = "—" if d.best_lap <= 0.0 else _fmt_laptime(d.best_lap)
		# Gap to leader
		if i == 0:
			leader_time = d.finish_time if d.finished else sim.elapsed
			rd["gap"].text = "INT"
		else:
			if d.finished:
				var delta: float = d.finish_time - float(sorted[0].finish_time)
				rd["gap"].text = "+%.3f" % delta
			else:
				var prog_delta: float = (float(sorted[0].progress()) - d.progress()) * d.last_lt
				rd["gap"].text = "+%.1f" % maxf(0.0, prog_delta)
		# Interval to car ahead
		if i == 0:
			rd["int"].text = "—"
		else:
			var prev: RaceSim.Driver = sorted[i - 1]
			var iv: float = (prev.progress() - d.progress()) * d.last_lt
			rd["int"].text = "+%.2f" % maxf(0.0, iv)
		rd["last"].text = "—" if d.last_lap <= 0.0 else _fmt_laptime(d.last_lap)
		# Mini-sector colours
		_update_mini_colours(rd["minis"], d, sim)
	# Hide unused rows
	for i in range(sorted.size(), _tt_rows.size()):
		_tt_rows[i]["row"].visible = false

func _update_mini_colours(minis: Array, d: RaceSim.Driver, sim: RaceSim) -> void:
	if d.mini_times_this_lap.is_empty():
		return
	for mi in mini(minis.size(), d.mini_times_this_lap.size()):
		var rect: ColorRect = minis[mi]
		var t: float = float(d.mini_times_this_lap[mi])
		if mi >= d.cur_mini or t < 0.0:
			rect.color = Color(0.18, 0.20, 0.24)   # grey — not yet done this lap
		else:
			var gb: float = float(sim.mini_global_best[mi])
			var pb: float = float(d.mini_best[mi])
			if gb >= 0.0 and absf(t - gb) < 0.002:
				rect.color = Color(0.73, 0.40, 0.80)  # purple — track record
			elif pb >= 0.0 and absf(t - pb) < 0.002:
				rect.color = Color(0.30, 0.69, 0.31)  # green — personal best
			else:
				rect.color = Color(0.99, 0.85, 0.21)  # yellow — slower

func _fmt_laptime(t: float) -> String:
	var mins := int(t / 60.0)
	var secs := t - float(mins) * 60.0
	return "%d:%06.3f" % [mins, secs]
```

- [ ] **Step 7.4 — Wire into `_process()`**

In the race `_process()` block where the HUD is updated each frame, add:

```gdscript
	if _tt_panel != null and sim != null:
		_update_timing_tower(sim)
```

And call `_build_timing_tower()` when a race starts (wherever `sim` is initialised).

- [ ] **Step 7.5 — Pass segment data to TrackMap**

When calling `track_map.ensure_built(...)`, also call:

```gdscript
	track_map.set_segments(sim.track.segments, sim.track.straight_frac)
```

- [ ] **Step 7.6 — Commit**

```
git add ApexDuo_Prototype/main.gd
git commit -m "feat(sector): timing tower HUD with 17 mini-sector colour blocks"
```

---

## Task 8 — Elastic Minimap Animation

**Files:**
- Modify: `ApexDuo_Prototype/track_map.gd`

- [ ] **Step 8.1 — Add fields and constants to `TrackMap`**

After the existing `var aero_zones := 0` line, add:

```gdscript
# Elastic visual remap: makes cars appear to slow in corners and sprint on straights.
# _vis_map[i] = cumulative visual_frac at lap_frac = i / VIS_N.
const VIS_N := 200           # table resolution
const VIS_STRAIGHT_K := 1.6  # straights get 1.6× visual weight → appear to move faster
const VIS_CORNER_K   := 0.7  # corners get 0.7× visual weight → appear to move slower
var _segments: Array = []    # copy of sim Track.segments (from set_segments())
var _vis_map: PackedFloat32Array = PackedFloat32Array()
```

- [ ] **Step 8.2 — Add `set_segments()` and `_build_visual_remap()`**

After the `set_cars()` function:

```gdscript
# Called by main.gd after ensure_built() when segment data is available.
func set_segments(segs: Array, _straight_frac: float) -> void:
	_segments = segs
	_build_visual_remap()

func _build_visual_remap() -> void:
	_vis_map = PackedFloat32Array()
	if _segments.is_empty():
		return
	# Compute weight for VIS_N evenly-spaced lap_frac samples
	var weights: Array = []
	var total_w := 0.0
	for i in VIS_N:
		var frac: float = float(i) / float(VIS_N)
		var seg := _seg_at_frac(frac)
		var kind: String = String(seg.get("kind", "straight"))
		var w: float = VIS_STRAIGHT_K if kind == "straight" else VIS_CORNER_K
		weights.append(w)
		total_w += w
	# Build cumulative table
	var acc := 0.0
	for i in VIS_N:
		_vis_map.append(acc / total_w)
		acc += float(weights[i])

func _seg_at_frac(frac: float) -> Dictionary:
	var ff := fposmod(frac, 1.0)
	for s in _segments:
		var s_start: float = float(s.get("start", 0.0))
		var s_frac: float  = float(s.get("frac",  1.0))
		if ff >= s_start and ff < s_start + s_frac:
			return s
	return _segments[0] if not _segments.is_empty() else {}
```

- [ ] **Step 8.3 — Add `_visual_frac()` mapping helper**

After `_build_visual_remap()`:

```gdscript
# Map a sim lap_frac to a visual position frac using the elastic remap table.
# Falls back to the input if the table isn't built.
func _visual_frac(frac: float) -> float:
	if _vis_map.is_empty():
		return frac
	var ff := fposmod(frac, 1.0)
	var idx_f: float = ff * float(VIS_N)
	var idx0: int = int(idx_f) % VIS_N
	var idx1: int = (idx0 + 1) % VIS_N
	var t: float = idx_f - float(idx0)
	var v0: float = _vis_map[idx0]
	var v1: float = _vis_map[idx1] if idx1 > 0 else 1.0
	return v0 + (v1 - v0) * t
```

- [ ] **Step 8.4 — Apply remap in car position and angle calculations**

In `_draw_car()`, replace:

```gdscript
	var fr: float = disp.get(int(c["id"]), float(c["frac"]))
	var pos := _to_px(_norm_pos(fr), area, off)
	var ang := (_to_px(_norm_pos(fr + 0.004), area, off) - pos).angle()
```

with:

```gdscript
	var fr: float = disp.get(int(c["id"]), float(c["frac"]))
	var vfr := _visual_frac(fr)
	var pos := _to_px(_norm_pos(vfr), area, off)
	var ang := (_to_px(_norm_pos(_visual_frac(fr + 0.004)), area, off) - pos).angle()
```

Also apply the same change in `_draw_pos_labels()` where `fr` is used for car position:

```gdscript
	var fr: float = disp.get(int(c["id"]), float(c["frac"]))
	var pos := _to_px(_norm_pos(_visual_frac(fr)), area, off)
```

- [ ] **Step 8.5 — Rebuild remap when ensure_built() regenerates the track**

At the end of `ensure_built()`, after `queue_redraw()`, add:

```gdscript
	if not _segments.is_empty():
		_build_visual_remap()
```

- [ ] **Step 8.6 — Lint check**

Copy `set_segments()`, `_build_visual_remap()`, `_seg_at_frac()`, `_visual_frac()` into `outputs/trackmap_elastic_check.gd` and run:

```
python -m gdtoolkit.parser outputs/trackmap_elastic_check.gd
```

Expected: no errors.

- [ ] **Step 8.7 — Commit**

```
git add ApexDuo_Prototype/track_map.gd
git commit -m "feat(sector): elastic minimap visual remap — cars visually slow in corners"
```

---

## Task 9 — Final Integration Smoke Test

- [ ] **Step 9.1 — Open Godot 4.6.3 and press F5**

Expected: game launches without script errors in the output panel.

- [ ] **Step 9.2 — Start a race at Монца, observe timing tower**

- Mini-sector blocks appear as grey initially.
- As cars complete mini-sectors, blocks turn yellow/green/purple.
- Driver abbreviations, lap count, tyre letter, gap/interval update each frame.

- [ ] **Step 9.3 — Verify minimap elastic motion**

Cars on the main/pit straight should visually move noticeably faster than in the Parabolica. If the effect is too strong, lower `VIS_STRAIGHT_K` (try 1.3).

- [ ] **Step 9.4 — Verify DRS restriction at Монако**

Start a race at Монако. The race feed should NOT show "Атакуй!" ERS hints during normal laps (no DRS sectors). Overtake boost should be suppressed — watch `passes_made` in the race log.

- [ ] **Step 9.5 — Verify sector ERS hints at Монца**

Race feed at Монца should show messages like «S2: DRS, 72% — атакуй!» or «S1: харвест — следующий сектор DRS» when team cars cross sector boundaries.

- [ ] **Step 9.6 — Commit the final smoke-test README note**

```
git add ApexDuo_Prototype/README.md
git commit -m "docs: sector system (Вариант Б) — timing tower, elastic minimap, DRS sectors, ERS AI"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** Track sectors ✓, Driver tracking ✓, DRS restriction ✓, ERS lookahead ✓, Timing tower ✓, Minimap elastic ✓
- [x] **Placeholder scan:** No TBDs or "add appropriate X" phrases present
- [x] **Type consistency:** `sector_bounds[si]` always cast `float()` before arithmetic; `mini_sector_bounds` same; `sector_chars[d.cur_sector]` always guarded with `is_empty()` check; `ColorRect.color` assigned `Color(...)` not String
- [x] **Balance preserved:** `current_laptime()` is untouched; DRS restriction only gates the Overtake boost (combat credit path, not laptime); sector ERS lookahead is additive on top of existing hysteresis
- [x] **GDScript const safety:** `SECTOR_BOUNDS` and `SECTOR_CHARS` are `static var` (not `const`) — avoids "non-constant const" error for nested dicts
- [x] **Inner func gotcha:** `_build_tt_row()` uses a lambda `var _lbl := func(w): ...` and calls it with `.call(w)` — not a named inner func (GDScript 4 doesn't support those inside regular funcs)
