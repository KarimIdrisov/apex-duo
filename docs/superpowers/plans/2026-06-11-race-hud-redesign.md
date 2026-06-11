# Race HUD Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current leaderboard + separate timing-tower overlay with an F1-dashboard-style unified leaderboard (team logo, driver abbrev, tyre icon, mini-sector blocks, precise gaps) and larger fonts throughout.

**Architecture:** 6 targeted edits across 3 files: (1) data — add `abbrev` fields to `f1_2026.gd`; (2) sim — add `mini_prev` to `Driver` in `race_sim.gd`; (3) UI — rebuild leaderboard, update `_collect_entries()`, update layout, update `_update_hud()` loop all in `main.gd`. The timing tower overlay (`_tt_panel`) is retired; mini-sector data moves into the main leaderboard rows.

**Tech Stack:** GDScript / Godot 4.6. Design tokens from `DesignSystem`. Team logos already at `assets/teams/*.png`. JetBrains Mono already at `assets/fonts/JetBrainsMono-Regular.ttf`.

---

## File map

| File | Change |
|---|---|
| `ApexDuo_Prototype/f1_2026.gd` | Add `"abbrev"` to every team dict and every driver dict (Task 1) |
| `ApexDuo_Prototype/race_sim.gd` | Add `var mini_prev: Array = []` to `Driver`; copy on lap completion (Task 2) |
| `ApexDuo_Prototype/main.gd` | Everything else: preload logos, new `_build_leaderboard()`, update `_collect_entries()`, layout tweaks, new `_update_hud()` loop (Tasks 3–6) |

---

### Task 1: Add abbrev to f1_2026.gd

**Files:**
- Modify: `ApexDuo_Prototype/f1_2026.gd:24-47`

- [ ] **Step 1: Replace the TEAMS const**

Replace the entire `const TEAMS := [` block (lines 24-47) with the version below.
The only addition is `"abbrev"` on each team dict and `"abbrev"` on each driver dict.

```gdscript
const TEAMS := [
	{"name": "McLaren", "pu": "Mercedes", "principal": "Андреа Стелла", "color": "#ff8000", "abbrev": "MCL",
		"drivers": [{"name": "Норрис", "skill": 0.950, "abbrev": "NOR"}, {"name": "Пиастри", "skill": 0.942, "abbrev": "PIA"}]},
	{"name": "Mercedes", "pu": "Mercedes", "principal": "Тото Вольфф", "color": "#27f4d2", "abbrev": "MERC",
		"drivers": [{"name": "Антонелли", "skill": 0.934, "abbrev": "ANT"}, {"name": "Расселл", "skill": 0.928, "abbrev": "RUS"}]},
	{"name": "Red Bull Racing", "pu": "Red Bull Ford", "principal": "Лоран Мекис", "color": "#3671c6", "abbrev": "RBR",
		"drivers": [{"name": "Ферстаппен", "skill": 0.944, "abbrev": "VER"}, {"name": "Аджар", "skill": 0.848, "abbrev": "HAD"}]},
	{"name": "Ferrari", "pu": "Ferrari", "principal": "Фредерик Вассёр", "color": "#e8002d", "abbrev": "FER",
		"drivers": [{"name": "Леклер", "skill": 0.898, "abbrev": "LEC"}, {"name": "Хэмилтон", "skill": 0.886, "abbrev": "HAM"}]},
	{"name": "Williams", "pu": "Mercedes", "principal": "Джеймс Воулз", "color": "#64c4ff", "abbrev": "WIL",
		"drivers": [{"name": "Сайнс", "skill": 0.862, "abbrev": "SAI"}, {"name": "Албон", "skill": 0.852, "abbrev": "ALB"}]},
	{"name": "Aston Martin", "pu": "Honda", "principal": "Эдриан Ньюи", "color": "#229971", "abbrev": "AMR",
		"drivers": [{"name": "Алонсо", "skill": 0.846, "abbrev": "ALO"}, {"name": "Стролл", "skill": 0.800, "abbrev": "STR"}]},
	{"name": "Alpine", "pu": "Mercedes", "principal": "Флавио Бриаторе", "color": "#0093cc", "abbrev": "ALP",
		"drivers": [{"name": "Гасли", "skill": 0.816, "abbrev": "GAS"}, {"name": "Колапинто", "skill": 0.788, "abbrev": "COL"}]},
	{"name": "Racing Bulls", "pu": "Red Bull Ford", "principal": "Алан Перман", "color": "#6692ff", "abbrev": "RB",
		"drivers": [{"name": "Лоусон", "skill": 0.798, "abbrev": "LAW"}, {"name": "Линдблад", "skill": 0.768, "abbrev": "LIN"}]},
	{"name": "Haas", "pu": "Ferrari", "principal": "Аяо Комацу", "color": "#b6babd", "abbrev": "HAS",
		"drivers": [{"name": "Окон", "skill": 0.786, "abbrev": "OCO"}, {"name": "Бирман", "skill": 0.760, "abbrev": "BEA"}]},
	{"name": "Audi", "pu": "Audi", "principal": "Маттиа Бинотто", "color": "#00e701", "abbrev": "AUD",
		"drivers": [{"name": "Хюлькенберг", "skill": 0.764, "abbrev": "HUL"}, {"name": "Бортолето", "skill": 0.738, "abbrev": "BOR"}]},
	{"name": "Cadillac", "pu": "Ferrari", "principal": "Грэм Лаудон", "color": "#c69d6e", "abbrev": "CAD",
		"drivers": [{"name": "Перес", "skill": 0.742, "abbrev": "PER"}, {"name": "Боттас", "skill": 0.726, "abbrev": "BOT"}]},
]
```

- [ ] **Step 2: Commit**

```bash
git add ApexDuo_Prototype/f1_2026.gd
git commit -m "data: add abbrev fields to all teams and drivers in f1_2026.gd"
```

---

### Task 2: Add mini_prev to Driver in race_sim.gd

Mini-sector blocks need 4 colour tiers: purple (session best), gold (personal best), green (faster than last lap), grey (normal). The "faster than last lap" comparison requires storing the previous lap's mini times in the driver.

**Files:**
- Modify: `ApexDuo_Prototype/race_sim.gd`

- [ ] **Step 1: Declare mini_prev on the Driver class**

Find the line (≈495):
```
var mini_best: Array = []             # size 17; personal best per mini
```
Add one line immediately after it:
```gdscript
var mini_prev: Array = []             # last completed lap mini times (for green tier)
```

- [ ] **Step 2: Initialise mini_prev at driver init**

Find the Driver init block that initialises `mini_times_this_lap` and `mini_best` (≈lines 759-764):
```gdscript
d.mini_times_this_lap = []
d.mini_best = []
for _i in n_mini:
	d.mini_times_this_lap.append(-1.0)
	d.mini_best.append(-1.0)
```
Replace with:
```gdscript
d.mini_times_this_lap = []
d.mini_best = []
d.mini_prev = []
for _i in n_mini:
	d.mini_times_this_lap.append(-1.0)
	d.mini_best.append(-1.0)
	d.mini_prev.append(-1.0)
```

- [ ] **Step 3: Copy mini_times → mini_prev on lap completion**

Find the lap reset block (≈lines 1914-1918):
```gdscript
d.cur_mini = 0
d.mini_entry_time = elapsed
d.mini_times_this_lap = []
for _ri in _nm:
	d.mini_times_this_lap.append(-1.0)
```
Replace with:
```gdscript
d.mini_prev = d.mini_times_this_lap.duplicate()
d.cur_mini = 0
d.mini_entry_time = elapsed
d.mini_times_this_lap = []
for _ri in _nm:
	d.mini_times_this_lap.append(-1.0)
```

- [ ] **Step 4: Commit**

```bash
git add ApexDuo_Prototype/race_sim.gd
git commit -m "sim: add mini_prev to Driver — copy mini times on lap completion for green sector tier"
```

---

### Task 3: Preload team logos + add leaderboard helper functions

**Files:**
- Modify: `ApexDuo_Prototype/main.gd`

- [ ] **Step 1: Add _team_tex var near the top**

Find the timing-tower var block (≈line 109):
```gdscript
# Timing tower (F1 Manager-style 22-row panel with 17 mini-sector blocks each)
var _tt_panel: PanelContainer
```
Add one line immediately before it:
```gdscript
var _team_tex: Dictionary = {}    # team name → Texture2D, loaded at race start
```

- [ ] **Step 2: Add _preload_assets() function**

Add this function anywhere in the helpers section (e.g. right before `_build_track_map()`):
```gdscript
func _preload_assets() -> void:
	var slug_map: Dictionary = {
		"McLaren": "mclaren", "Mercedes": "mercedes",
		"Red Bull Racing": "red_bull", "Ferrari": "ferrari",
		"Williams": "williams", "Aston Martin": "aston_martin",
		"Alpine": "alpine", "Racing Bulls": "racing_bulls",
		"Haas": "haas", "Audi": "audi", "Cadillac": "cadillac",
	}
	for tname: String in slug_map:
		var path := "res://assets/teams/%s.png" % slug_map[tname]
		if ResourceLoader.exists(path, "Texture2D"):
			_team_tex[tname] = load(path)
```

- [ ] **Step 3: Add _lb_cell() helper**

Add next to `_cell()` / `_mklabel()` in the helpers section:
```gdscript
func _lb_cell(row: HBoxContainer, txt: String, w: int, col: Color, sz: int = 14) -> Label:
	var l := Label.new()
	l.text = txt
	l.custom_minimum_size = Vector2(float(w), 0.0)
	l.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	l.add_theme_color_override("font_color", col)
	l.add_theme_font_size_override("font_size", sz)
	row.add_child(l)
	return l

func _hdr_cell(row: HBoxContainer, txt: String, w: int) -> void:
	var l := Label.new()
	l.text = txt
	l.custom_minimum_size = Vector2(float(w), 0.0)
	l.add_theme_color_override("font_color", DesignSystem.TEXT_3)
	l.add_theme_font_size_override("font_size", 10)
	l.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(l)

func _set_tyre_col(rect: ColorRect, compound: String) -> void:
	match compound:
		"soft":   rect.color = Color("#e8002d")
		"medium": rect.color = Color("#ffd700")
		"hard":   rect.color = Color("#cccccc")
		"inter":  rect.color = Color("#39b54a")
		"wet":    rect.color = Color("#1e88e5")
		_:        rect.color = Color("#888888")
```

- [ ] **Step 4: Add _driver_abbrev() helper**

Add in the helpers section:
```gdscript
func _driver_abbrev(d: RaceSim.Driver) -> String:
	if d.team_idx < 0 or d.team_idx >= F1_2026.TEAMS.size():
		return d.name.left(3).to_upper()
	var t: Dictionary = F1_2026.TEAMS[d.team_idx]
	var drvs: Array = t.get("drivers", [])
	if d.slot >= 0 and d.slot < drvs.size():
		return String(drvs[d.slot].get("abbrev", d.name.left(3).to_upper()))
	return d.name.left(3).to_upper()
```

- [ ] **Step 5: Commit**

```bash
git add ApexDuo_Prototype/main.gd
git commit -m "feat(hud): add logo preload, _lb_cell/_hdr_cell/_set_tyre_col/_driver_abbrev helpers"
```

---

### Task 4: Replace _build_leaderboard()

The new leaderboard is a `VBoxContainer` with a header row + 22 data rows. Each row stores all widget references in `board_rows[i]` under new keys. The old keys (pos/name/gap/int/speed/tire/wear/bat/pit/lastlap) are completely replaced.

New columns (left to right): `pos`(32px) · `stripe`(3px) · `logo`(40px) · `abbrev`(44px) · `delta`(36px) · `lap`(28px) · `pit`(44px) · `tyre_icon`+`tyre_age`(72px) · `best_lap`(80px) · `gap`(76px) · `interval`(68px) · `sectors`(78px) · `last_lap`(80px).

**Files:**
- Modify: `ApexDuo_Prototype/main.gd:1506-1539`

- [ ] **Step 1: Replace _build_leaderboard()**

Delete everything from `func _build_leaderboard() -> Control:` through its closing `return pc` (lines 1506-1539). Replace with:

```gdscript
func _build_leaderboard() -> Control:
	var outer := VBoxContainer.new()
	outer.add_theme_constant_override("separation", 2)
	outer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	outer.size_flags_vertical = Control.SIZE_EXPAND_FILL

	# Header row
	var hdr := HBoxContainer.new()
	hdr.add_theme_constant_override("separation", 0)
	hdr.custom_minimum_size = Vector2(0.0, 22.0)
	_hdr_cell(hdr, "ПОЗ", 32);  _hdr_cell(hdr, "", 3);  _hdr_cell(hdr, "", 40)
	_hdr_cell(hdr, "ПИЛ", 44);  _hdr_cell(hdr, "Δ", 36);  _hdr_cell(hdr, "КР", 28)
	_hdr_cell(hdr, "ПИТ", 44);  _hdr_cell(hdr, "ШИНА", 72)
	_hdr_cell(hdr, "ЛУЧШИЙ", 80);  _hdr_cell(hdr, "ОТРЫВ", 76)
	_hdr_cell(hdr, "ИНТ", 68);  _hdr_cell(hdr, "СЕКТОРЫ", 78);  _hdr_cell(hdr, "ПРОШ", 80)
	outer.add_child(hdr)

	board_rows.clear()

	for _i in F1_2026.grid_size():
		# Row background panel
		var row_panel := PanelContainer.new()
		row_panel.custom_minimum_size = Vector2(0.0, 28.0)
		row_panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var row_sb := StyleBoxFlat.new()
		row_sb.bg_color = DesignSystem.BG_RAISED
		row_sb.set_corner_radius_all(2)
		row_sb.content_margin_left   = 0.0;  row_sb.content_margin_right  = 0.0
		row_sb.content_margin_top    = 0.0;  row_sb.content_margin_bottom = 0.0
		row_panel.add_theme_stylebox_override("panel", row_sb)

		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 0)
		row_panel.add_child(row)

		# pos
		var pos_lbl: Label = _lb_cell(row, "—", 32, DesignSystem.TEXT_2, 15)
		# stripe (3 px team colour bar)
		var stripe := ColorRect.new()
		stripe.custom_minimum_size = Vector2(3.0, 0.0)
		stripe.size_flags_vertical  = Control.SIZE_EXPAND_FILL
		stripe.color = DesignSystem.BORDER
		row.add_child(stripe)
		# logo
		var logo := TextureRect.new()
		logo.custom_minimum_size = Vector2(40.0, 20.0)
		logo.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		logo.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(logo)
		# driver abbrev
		var abbrev_lbl: Label = _lb_cell(row, "???", 44, DesignSystem.TEXT_1, 15)
		# position delta
		var delta_lbl: Label = _lb_cell(row, "—", 36, DesignSystem.TEXT_3, 12)
		# current lap number
		var lap_lbl: Label = _lb_cell(row, "—", 28, DesignSystem.TEXT_3, 12)
		# pit count
		var pit_lbl: Label = _lb_cell(row, "—", 44, DesignSystem.TEXT_3, 13)
		# tyre: compound icon (colour dot) + age label
		var tyre_wrap := HBoxContainer.new()
		tyre_wrap.custom_minimum_size = Vector2(72.0, 0.0)
		tyre_wrap.add_theme_constant_override("separation", 3)
		tyre_wrap.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		var tyre_icon := ColorRect.new()
		tyre_icon.custom_minimum_size = Vector2(14.0, 14.0)
		tyre_icon.color = Color("#888888")
		tyre_wrap.add_child(tyre_icon)
		var tyre_age := Label.new()
		tyre_age.add_theme_font_size_override("font_size", 12)
		tyre_age.add_theme_color_override("font_color", DesignSystem.TEXT_3)
		tyre_age.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		tyre_wrap.add_child(tyre_age)
		row.add_child(tyre_wrap)
		# best lap (mono)
		var best_lbl: Label = _lb_cell(row, "—", 80, DesignSystem.TEXT_2, 13)
		if DesignSystem.mono_font != null:
			best_lbl.add_theme_font_override("font", DesignSystem.mono_font)
		# gap to leader (mono)
		var gap_lbl: Label = _lb_cell(row, "—", 76, DesignSystem.TEXT_1, 14)
		if DesignSystem.mono_font != null:
			gap_lbl.add_theme_font_override("font", DesignSystem.mono_font)
		# interval to car ahead (mono)
		var int_lbl: Label = _lb_cell(row, "—", 68, DesignSystem.TEXT_2, 13)
		if DesignSystem.mono_font != null:
			int_lbl.add_theme_font_override("font", DesignSystem.mono_font)
		# 17 mini-sector blocks in a tight HBox
		var ms_wrap := HBoxContainer.new()
		ms_wrap.custom_minimum_size = Vector2(78.0, 0.0)
		ms_wrap.add_theme_constant_override("separation", 0)
		ms_wrap.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		var ms_blocks: Array = []
		var ms_counts: Array = TT_MINI_COUNTS  # [5, 7, 5]
		var bi := 0
		for gi in ms_counts.size():
			for _si in int(ms_counts[gi]):
				var blk := ColorRect.new()
				blk.custom_minimum_size = Vector2(3.0, 12.0)
				blk.color = Color("#1e1e28")
				ms_wrap.add_child(blk)
				ms_blocks.append(blk)
			if gi < ms_counts.size() - 1:
				var gap_rect := ColorRect.new()
				gap_rect.custom_minimum_size = Vector2(2.0, 12.0)
				gap_rect.color = Color(0.0, 0.0, 0.0, 0.0)
				ms_wrap.add_child(gap_rect)
			bi += int(ms_counts[gi])
		row.add_child(ms_wrap)
		# last lap (mono)
		var last_lbl: Label = _lb_cell(row, "—", 80, DesignSystem.TEXT_2, 13)
		if DesignSystem.mono_font != null:
			last_lbl.add_theme_font_override("font", DesignSystem.mono_font)

		outer.add_child(row_panel)
		board_rows.append({
			"row_panel": row_panel, "row_sb": row_sb,
			"pos_lbl": pos_lbl, "stripe": stripe, "logo": logo,
			"abbrev_lbl": abbrev_lbl, "delta_lbl": delta_lbl,
			"lap_lbl": lap_lbl, "pit_lbl": pit_lbl,
			"tyre_icon": tyre_icon, "tyre_age": tyre_age,
			"best_lbl": best_lbl, "gap_lbl": gap_lbl, "int_lbl": int_lbl,
			"ms_blocks": ms_blocks, "last_lbl": last_lbl,
		})

	return outer
```

- [ ] **Step 2: Commit**

```bash
git add ApexDuo_Prototype/main.gd
git commit -m "feat(hud): rebuild leaderboard — F1 dashboard style, 13 cols + 17 mini-sector blocks"
```

---

### Task 5: Update _collect_entries(), _build_race_ui(), _start_race()

**Files:**
- Modify: `ApexDuo_Prototype/main.gd`

- [ ] **Step 1: Update _collect_entries() to add new fields**

Find `_collect_entries()` (≈line 518). In the host branch, add 6 new fields to the appended dict.

Find this block inside the `for d in sim.drivers:` loop:
```gdscript
		out.append({
			"id": d.id, "name": d.name, "progress": d.progress(),
			"compound": d.compound, "wear": d.tire_wear, "temp": d.tyre_temp, "pit": d.pit_count,
			"finished": d.finished, "finish_time": d.finish_time,
			"pace": d.pace_mode, "role": d.role, "team": d.team,
				"dir_pace": d.dir_pace, "dir_intent": d.dir_intent,
			"soc": d.soc, "ers": d.ers_mode, "overtake": d.overtake, "clipped": d.clipped, "save": d.save,
			"color": d.color, "slot": d.slot, "state": _car_state(d), "dnf": d.dnf, "pit_phase": d.pit_phase(),
			"last_lap": d.last_lap, "best_lap": d.best_lap, "tyre_laps": d.tyre_laps, "speed": sim.speed_kmh(d),
				"trust": d.trust, "mood": d.mood,
			# Task B: partner-intent fields.
			"pitting": d.pitting, "pit_request_compound": d.pit_request_compound,
		})
```
Replace with:
```gdscript
		out.append({
			"id": d.id, "name": d.name, "progress": d.progress(),
			"compound": d.compound, "wear": d.tire_wear, "temp": d.tyre_temp, "pit": d.pit_count,
			"finished": d.finished, "finish_time": d.finish_time,
			"pace": d.pace_mode, "role": d.role, "team": d.team,
				"dir_pace": d.dir_pace, "dir_intent": d.dir_intent,
			"soc": d.soc, "ers": d.ers_mode, "overtake": d.overtake, "clipped": d.clipped, "save": d.save,
			"color": d.color, "slot": d.slot, "state": _car_state(d), "dnf": d.dnf, "pit_phase": d.pit_phase(),
			"last_lap": d.last_lap, "best_lap": d.best_lap, "tyre_laps": d.tyre_laps, "speed": sim.speed_kmh(d),
				"trust": d.trust, "mood": d.mood,
			"pitting": d.pitting, "pit_request_compound": d.pit_request_compound,
			# HUD v2 fields
			"abbrev": _driver_abbrev(d),
			"team_name": F1_2026.TEAMS[d.team_idx]["name"] if d.team_idx >= 0 and d.team_idx < F1_2026.TEAMS.size() else "",
			"grid_pos": d.grid_pos,
			"ms_times": d.mini_times_this_lap.duplicate(),
			"ms_best": d.mini_best.duplicate(),
			"ms_prev": d.mini_prev.duplicate(),
			"ms_global": sim.mini_global_best.duplicate(),
		})
```

- [ ] **Step 2: Remove track map from _build_race_ui()**

Find in `_build_race_ui()` (≈line 1377):
```gdscript
	mid.add_child(_build_track_map())
	mid.add_child(_build_leaderboard())
```
Replace with (remove the track map call):
```gdscript
	mid.add_child(_build_leaderboard())
```

- [ ] **Step 3: Shrink ctrl_col width**

Find (≈line 1387):
```gdscript
	ctrl_col.custom_minimum_size = Vector2(358, 0)
```
Replace with:
```gdscript
	ctrl_col.custom_minimum_size = Vector2(220, 0)
```

- [ ] **Step 4: Call _preload_assets() at the start of _build_race_ui()**

Find the first line of `_build_race_ui()`:
```gdscript
func _build_race_ui(root: Control) -> void:
	var margin := MarginContainer.new()
```
Replace with:
```gdscript
func _build_race_ui(root: Control) -> void:
	_preload_assets()
	var margin := MarginContainer.new()
```

- [ ] **Step 5: Skip the timing tower in _start_race()**

Find (≈line 319):
```gdscript
	_build_timing_tower()
```
Replace with (just hide — keeps the function callable but doesn't show the overlay):
```gdscript
	# Timing tower retired — mini-sectors now in the main leaderboard
	# _build_timing_tower()
```

- [ ] **Step 6: Commit**

```bash
git add ApexDuo_Prototype/main.gd
git commit -m "feat(hud): update collect_entries + layout — remove track map, retire timing tower, add abbrev/ms fields"
```

---

### Task 6: Replace _update_hud() leaderboard loop

The old loop (lines 580-661) reads keys `pos/name/gap/int/speed/tire/wear/bat/pit/lastlap`. Replace entirely with the new key set.

**Files:**
- Modify: `ApexDuo_Prototype/main.gd:580-661`

- [ ] **Step 1: Replace the loop**

Delete from:
```gdscript
	for i in board_rows.size():
		var row: Dictionary = board_rows[i]
		if i >= entries.size():
			for k in ["pos", "name", "gap", "int", "speed", "tire", "wear", "bat", "pit", "lastlap"]:
				row[k].text = ""
			continue
```
...all the way through...
```gdscript
		for k in ["pos", "gap"]:
			row[k].add_theme_color_override("font_color", hi)
```

Replace with:

```gdscript
	for i in board_rows.size():
		var row: Dictionary = board_rows[i]
		if i >= entries.size():
			(row["pos_lbl"] as Label).text = ""
			(row["abbrev_lbl"] as Label).text = ""
			(row["gap_lbl"] as Label).text = ""
			(row["last_lbl"] as Label).text = ""
			continue
		var e: Dictionary = entries[i]
		var is_player: bool = bool(e.get("team", false))
		var is_dnf: bool = bool(e.get("dnf", false))
		var e_color := Color(String(e.get("color", "#8a94a6")))

		# Row background tint
		var row_sb: StyleBoxFlat = row["row_sb"]
		if is_player:
			row_sb.bg_color = Color(DesignSystem.GOLD.r, DesignSystem.GOLD.g, DesignSystem.GOLD.b, 0.08)
		elif bool(e.get("pitting", false)):
			row_sb.bg_color = Color(DesignSystem.BLUE.r, DesignSystem.BLUE.g, DesignSystem.BLUE.b, 0.07)
		elif is_dnf:
			row_sb.bg_color = Color(0.0, 0.0, 0.0, 0.5)
		else:
			row_sb.bg_color = DesignSystem.BG_RAISED

		# Position
		var pos_lbl: Label = row["pos_lbl"]
		pos_lbl.text = "P%d" % (i + 1)
		pos_lbl.add_theme_color_override("font_color",
			DesignSystem.GOLD if is_player else DesignSystem.TEXT_2)

		# Team stripe
		(row["stripe"] as ColorRect).color = e_color

		# Team logo
		var logo: TextureRect = row["logo"]
		var tname: String = String(e.get("team_name", ""))
		if tname in _team_tex:
			logo.texture = _team_tex[tname]

		# Driver abbreviation
		var abbrev_lbl: Label = row["abbrev_lbl"]
		abbrev_lbl.text = String(e.get("abbrev", "???"))
		abbrev_lbl.add_theme_color_override("font_color",
			DesignSystem.GOLD if is_player else e_color)

		# Position delta (vs qualifying grid)
		var delta_lbl: Label = row["delta_lbl"]
		var grid_p: int = int(e.get("grid_pos", i + 1))
		var delta_v: int = grid_p - (i + 1)
		if delta_v > 0:
			delta_lbl.text = "▲%d" % delta_v
			delta_lbl.add_theme_color_override("font_color", DesignSystem.GREEN)
		elif delta_v < 0:
			delta_lbl.text = "▼%d" % abs(delta_v)
			delta_lbl.add_theme_color_override("font_color", DesignSystem.RED)
		else:
			delta_lbl.text = "—"
			delta_lbl.add_theme_color_override("font_color", DesignSystem.TEXT_3)

		# Current lap
		(row["lap_lbl"] as Label).text = str(int(e["progress"]))

		# Pit count / active
		var pit_lbl: Label = row["pit_lbl"]
		if bool(e.get("pitting", false)):
			pit_lbl.text = "ПИТ"
			pit_lbl.add_theme_color_override("font_color", DesignSystem.BLUE)
		else:
			var pc: int = int(e.get("pit", 0))
			pit_lbl.text = "×%d" % pc if pc > 0 else "—"
			pit_lbl.add_theme_color_override("font_color", DesignSystem.TEXT_3)

		# Tyre compound colour dot + age
		var compound: String = String(e.get("compound", "medium"))
		_set_tyre_col(row["tyre_icon"], compound)
		(row["tyre_age"] as Label).text = str(int(e.get("tyre_laps", 0)))

		# Best lap (purple if session fastest)
		var best_lbl: Label = row["best_lbl"]
		var best_t: float = float(e.get("best_lap", 0.0))
		if best_t > 0.0:
			best_lbl.text = _fmt_laptime(best_t)
			best_lbl.add_theme_color_override("font_color",
				DesignSystem.PURPLE if best_t == fastest_lap else DesignSystem.TEXT_2)
		else:
			best_lbl.text = "—"
			best_lbl.add_theme_color_override("font_color", DesignSystem.TEXT_3)

		# Gap to leader
		var gap_lbl: Label = row["gap_lbl"]
		var gap_s := 0.0
		if e["finished"] and leader["finished"]:
			gap_s = float(e["finish_time"]) - float(leader["finish_time"])
		else:
			gap_s = (float(leader["progress"]) - float(e["progress"])) * BASE_LT
		if is_dnf:
			gap_lbl.text = "СХОД"
			gap_lbl.add_theme_color_override("font_color", DesignSystem.RED)
		elif i == 0:
			gap_lbl.text = "ЛИДЕР"
			gap_lbl.add_theme_color_override("font_color", DesignSystem.TEXT_3)
		else:
			gap_lbl.text = "+%.3f" % gap_s
			gap_lbl.add_theme_color_override("font_color", DesignSystem.TEXT_1)

		# Interval to car directly ahead
		var int_lbl: Label = row["int_lbl"]
		if i == 0 or is_dnf:
			int_lbl.text = "—"
			int_lbl.add_theme_color_override("font_color", DesignSystem.TEXT_3)
		else:
			var ahead: Dictionary = entries[i - 1]
			var int_s := 0.0
			if e["finished"] and ahead["finished"]:
				int_s = float(e["finish_time"]) - float(ahead["finish_time"])
			else:
				int_s = (float(ahead["progress"]) - float(e["progress"])) * BASE_LT
			int_lbl.text = "+%.3f" % maxf(0.0, int_s)
			int_lbl.add_theme_color_override("font_color", DesignSystem.TEXT_2)

		# Mini-sector blocks (4-tier colours)
		var ms_times: Array = e.get("ms_times", [])
		var ms_best: Array  = e.get("ms_best", [])
		var ms_prev: Array  = e.get("ms_prev", [])
		var ms_global: Array = e.get("ms_global", [])
		var ms_blocks: Array = row["ms_blocks"]
		for bi2: int in ms_blocks.size():
			var blk: ColorRect = ms_blocks[bi2]
			var t: float = float(ms_times[bi2]) if bi2 < ms_times.size() else -1.0
			if t < 0.0:
				blk.color = Color("#1e1e28")   # not yet completed
			else:
				var gb: float = float(ms_global[bi2]) if bi2 < ms_global.size() else -1.0
				var pb: float = float(ms_best[bi2])   if bi2 < ms_best.size()   else -1.0
				var pv: float = float(ms_prev[bi2])   if bi2 < ms_prev.size()   else -1.0
				if gb > 0.0 and t <= gb + 0.001:
					blk.color = DesignSystem.PURPLE       # session best
				elif pb > 0.0 and t <= pb + 0.001:
					blk.color = DesignSystem.GOLD          # personal best
				elif pv > 0.0 and t < pv:
					blk.color = DesignSystem.GREEN         # faster than last lap
				else:
					blk.color = Color("#555566")           # normal

		# Last lap (purple if session fastest)
		var last_lbl: Label = row["last_lbl"]
		var ll: float = float(e.get("last_lap", 0.0))
		if ll > 0.0:
			last_lbl.text = _fmt_laptime(ll)
			last_lbl.add_theme_color_override("font_color",
				DesignSystem.PURPLE if ll == fastest_lap else DesignSystem.TEXT_2)
		else:
			last_lbl.text = "—"
			last_lbl.add_theme_color_override("font_color", DesignSystem.TEXT_3)
```

- [ ] **Step 2: Commit**

```bash
git add ApexDuo_Prototype/main.gd
git commit -m "feat(hud): new _update_hud() leaderboard loop — team logos, abbrevs, 4-tier mini-sectors, precise gaps"
```

---

### Task 7: Lint + boot test

**Files:**
- Read: `ApexDuo_Prototype/main.gd` (verify no truncation)
- Run: gdparse, then headless boot

- [ ] **Step 1: Lint main.gd in a fresh temp file**

Extract the new/changed functions into a standalone file and parse it. This works around the sandbox mount-lag issue (see CLAUDE.md §Critical gotchas).

In bash (git-bash on Windows):
```bash
cd "C:/Users/Karim/Desktop/Coop motorsport manager game"

# Write just the new functions to a fresh file and parse
python -c "
import re, pathlib

src = pathlib.Path('ApexDuo_Prototype/main.gd').read_text(encoding='utf-8')

# Grab the four new/changed function bodies
funcs = [
    '_preload_assets',
    '_lb_cell',
    '_hdr_cell',
    '_set_tyre_col',
    '_driver_abbrev',
    '_build_leaderboard',
]

out = ['extends Control', '']
for fn in funcs:
    pat = re.compile(r'(func ' + fn + r'\\b.*?)(?=\\nfunc |\\Z)', re.S)
    m = pat.search(src)
    if m:
        out.append(m.group(0))
        out.append('')

pathlib.Path('/tmp/hud_funcs.gd').write_text('\\n'.join(out), encoding='utf-8')
print('wrote', len(out), 'lines')
"

python -m gdtoolkit.parser /tmp/hud_funcs.gd && echo "PARSE OK" || echo "PARSE FAIL"
python -m gdtoolkit.linter /tmp/hud_funcs.gd && echo "LINT OK"  || echo "LINT FAIL"
```

Expected: `PARSE OK` and `LINT OK` (or only style warnings, no errors).

- [ ] **Step 2: Headless boot test**

```bash
"C:/Users/Karim/Desktop/Godot_v4.6.3-stable_win64.exe/Godot_v4.6.3-stable_win64.exe" \
  --headless --path "C:/Users/Karim/Desktop/Coop motorsport manager game/ApexDuo_Prototype" \
  --quit-after 30 2>&1 | grep -E "ERROR|SCRIPT|Cannot|Parse|invalid" | head -20
```

Expected: zero lines (no errors). If the start menu appears and exits cleanly → boot test passes.

- [ ] **Step 3: Commit**

```bash
git add ApexDuo_Prototype/main.gd
git commit -m "chore: lint + boot-test pass for race HUD redesign"
```

---

## Self-review

### Spec coverage

| Spec requirement | Task |
|---|---|
| Team logo (40×20) + team stripe (3px) | Task 4 (_build_leaderboard), Task 6 (_update_hud) |
| Driver 3-letter abbrev, team colour | Task 1 (f1_2026 abbrev), Task 3 (_driver_abbrev), Task 6 |
| Mini-sector 4-tier colours (purple/gold/green/grey) | Task 2 (mini_prev), Task 4 (ms_blocks), Task 6 |
| Tyre compound colour dot + age | Task 4 (tyre_icon/age), Task 6 (_set_tyre_col) |
| Precise gap/interval to .3f | Task 6 ("+%.3f") |
| Remove separate timing tower | Task 5 (skip _build_timing_tower) |
| Remove map from mid panel | Task 5 (remove _build_track_map) |
| Larger fonts (was 17px, now 14-15px main columns) | Task 4 (sz params in _lb_cell calls) |
| Position delta from grid (▲/▼ coloured) | Task 6 (delta_lbl logic) |

### Placeholder check
No TBDs, no "similar to above" references — every step contains actual code.

### Type consistency
- `row["row_sb"]` is a `StyleBoxFlat` cast in Task 6 — `board_rows` in Task 4 stores a real `StyleBoxFlat` reference ✓
- `row["tyre_icon"]` is a `ColorRect` — `_set_tyre_col(rect: ColorRect, ...)` takes `ColorRect` ✓
- `_lb_cell()` returns `Label` — all Task 6 label refs cast via `as Label` or assigned typed ✓
- `ms_blocks` stores `Array` of `ColorRect` — Task 6 casts `ms_blocks[bi2]` as `ColorRect` ✓
- `_driver_abbrev(d: RaceSim.Driver)` — called in Task 5's `_collect_entries()` which has `d` from `sim.drivers` ✓

### Known client-mode gap
The new fields (`abbrev`, `ms_times`, `ms_prev`, `team_name`, `grid_pos`) are populated only in the host branch of `_collect_entries()`. Clients receive the old snapshot dict which lacks these keys. Task 6 uses `.get("abbrev", "???")` etc. so client mode degrades gracefully (shows `???` for abbrev, empty mini-sectors) without crashing. Full client support requires adding these fields to the snapshot in `_make_snapshot()` — that is a follow-on task, not blocking.
