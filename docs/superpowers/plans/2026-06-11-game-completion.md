# Game Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5 features to the Apex Duo prototype — Visible Car Stats, HQ Buildings, Random Events, Weather system, and Transfer Market improvements — turning the working engine into a complete FM-style career mode.

**Architecture:** All 5 features are independently shippable; each builds on existing patterns in `season.gd` (data model + save/load) and `season_hub.gd` (paddock UI). Weather is the only feature touching `race_sim.gd`; follow determinism rules carefully there. Every new `season.gd` state field must appear in both `to_dict()` and `_apply_dict()`.

**Tech Stack:** Godot 4.6, GDScript. Tabs for indent, `snake_case` vars, `PascalCase` classes, `CONSTANT_CASE` consts. Verify with `python -m gdtoolkit.parser <file>` (git-bash). Boot-test after every `main.gd` or `season_hub.gd` edit: `godot --headless --quit-after 30` and grep for errors.

---

## File map

| File | Changes |
|------|---------|
| `ApexDuo_Prototype/season_hub.gd` | Tasks 1, 2, 3, 5: new UI sections & new tab |
| `ApexDuo_Prototype/season.gd` | Tasks 2, 3: new state vars + save/load |
| `ApexDuo_Prototype/race_sim.gd` | Task 4: weather states + pace penalties |
| `ApexDuo_Prototype/main.gd` | Task 4: weather alert in event feed |

---

## Task 1: Visible Car Stats bars in БОЛИД tab

**Files:**
- Modify: `ApexDuo_Prototype/season_hub.gd` — `_build_page_car()` and `_build_rnd()`

Current state: `_build_page_car()` at line ~564 just calls `_build_rnd(s)` and `_build_suppliers(s)`. `_build_rnd()` shows text-only R&D state. We add a 4-bar stat panel at the top of the page, and a field-comparison section at the bottom gated by no unlock condition for now.

- [ ] **Step 1: Read current _build_page_car and _build_rnd**

```
python -m gdtoolkit.parser ApexDuo_Prototype/season_hub.gd
```
Expected: no output (= clean parse). Confirm baseline is clean before editing.

- [ ] **Step 2: Add `_build_car_stats()` helper function**

In `season_hub.gd`, add this new function before `_build_rnd()` (around line 610):

```gdscript
# ---------------------------------------------------------------- CAR STATS (visual bars)
func _build_car_stats(s: Season) -> Control:
	var pc := _panel()
	pc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 10)
	v.add_child(_hlabel("ХАРАКТЕРИСТИКИ МАШИНЫ", 16, Palette.CREAM_HEX))
	v.add_child(_spacer(2))

	# Apply current R&D to get up-to-date scalars
	s.apply_car_rd()
	var car: Dictionary = F1_2026.team_car(s.player_team)

	var stats: Array = [
		["МОЩНОСТЬ",    float(car.get("power",  0.5)), Palette.WARN_HEX],
		["АЭРО",        float(car.get("aero",   0.5)), Palette.GOLD_HEX],
		["ЭНЕРГИЯ ERS", float(car.get("energy", 0.5)), Palette.INFO_HEX],
		["НАДЁЖНОСТЬ",  float(car.get("rel",    0.5)), Palette.GOOD_HEX],
	]

	for stat in stats:
		var label_txt: String = String(stat[0])
		var val: float = float(stat[1])
		var col: String = String(stat[2])

		var row := VBoxContainer.new()
		row.add_theme_constant_override("separation", 3)

		var header_row := HBoxContainer.new()
		header_row.add_child(_label(label_txt, 13, col))
		var spacer_h := Control.new()
		spacer_h.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		header_row.add_child(spacer_h)
		header_row.add_child(_label("%.0f%%" % (val * 100.0), 13, Palette.CREAM_HEX))
		row.add_child(header_row)

		var bar_bg := PanelContainer.new()
		bar_bg.custom_minimum_size = Vector2(0, 10)
		bar_bg.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var sb_bg := StyleBoxFlat.new()
		sb_bg.bg_color = Color(0.2, 0.2, 0.2, 1.0)
		bar_bg.add_theme_stylebox_override("panel", sb_bg)

		var bar_fill := PanelContainer.new()
		bar_fill.custom_minimum_size = Vector2(0, 10)
		bar_fill.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var sb_fill := StyleBoxFlat.new()
		sb_fill.bg_color = Color(col)
		bar_fill.add_theme_stylebox_override("panel", sb_fill)
		# Use anchors to fill proportionally: anchor_right = val (0..1)
		bar_fill.set_anchor_and_offset(SIDE_RIGHT, val, 0.0)
		bar_fill.set_anchor_and_offset(SIDE_LEFT,  0.0, 0.0)
		bar_fill.set_anchor_and_offset(SIDE_TOP,   0.0, 0.0)
		bar_fill.set_anchor_and_offset(SIDE_BOTTOM, 1.0, 0.0)

		bar_bg.add_child(bar_fill)
		row.add_child(bar_bg)
		v.add_child(row)

	v.add_child(_spacer(6))
	v.add_child(_hlabel("СРАВНЕНИЕ С ПЕЛОТОНОМ", 14, Palette.MUTED_HEX))
	v.add_child(_build_field_comparison(s))

	pc.add_child(v)
	return pc
```

- [ ] **Step 3: Add `_build_field_comparison()` helper**

Add this right after `_build_car_stats()`:

```gdscript
func _build_field_comparison(s: Season) -> Control:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 4)
	s.apply_car_rd()
	s.apply_ai_dev()
	var all_cars: Array = []
	for ti in range(11):
		var c: Dictionary = F1_2026.team_car(ti)
		var tname: String = String(F1_2026.TEAMS[ti].get("name", "Team %d" % ti))
		var is_player: bool = ti == s.player_team
		all_cars.append({"name": tname, "power": float(c.get("power", 0.5)),
			"aero": float(c.get("aero", 0.5)), "is_player": is_player})
	all_cars.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return (float(a["power"]) + float(a["aero"])) > (float(b["power"]) + float(b["aero"])))

	for entry in all_cars:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 6)
		var col: String = Palette.GOLD_HEX if bool(entry["is_player"]) else Palette.MUTED_HEX
		var name_l := _label(String(entry["name"]), 12, col)
		name_l.custom_minimum_size = Vector2(120, 0)
		row.add_child(name_l)
		var combined: float = (float(entry["power"]) + float(entry["aero"])) * 0.5
		var bar_w: float = combined * 150.0
		var bar := PanelContainer.new()
		bar.custom_minimum_size = Vector2(bar_w, 8)
		var sb := StyleBoxFlat.new()
		sb.bg_color = Color(Palette.GOLD_HEX) if bool(entry["is_player"]) else Color(0.35, 0.35, 0.45, 1.0)
		bar.add_theme_stylebox_override("panel", sb)
		row.add_child(bar)
		v.add_child(row)
	return v
```

- [ ] **Step 4: Wire `_build_car_stats()` into `_build_page_car()`**

Replace the existing `_build_page_car` function (line ~564):

```gdscript
func _build_page_car(v: VBoxContainer, s: Season) -> void:
	v.add_child(_build_car_stats(s))
	v.add_child(_build_rnd(s))
	v.add_child(_build_suppliers(s))
```

- [ ] **Step 5: Syntax check**

```
python -m gdtoolkit.parser ApexDuo_Prototype/season_hub.gd
```
Expected: no output.

- [ ] **Step 6: Boot test**

```
"C:\Users\Karim\Desktop\Godot_v4.6.3-stable_win64.exe\Godot_v4.6.3-stable_win64.exe" --headless --path ApexDuo_Prototype --quit-after 30 2>&1 | Select-String -Pattern "ERROR|SCRIPT ERROR|Parse Error"
```
Expected: no matches.

- [ ] **Step 7: Commit**

```
git add ApexDuo_Prototype/season_hub.gd
git commit -m "feat(ui): visible car stats bars + field comparison in БОЛИД tab"
```

---

## Task 2: HQ Buildings

**Files:**
- Modify: `ApexDuo_Prototype/season.gd` — new state vars, new `hq_*` methods, `to_dict()`, `_apply_dict()`
- Modify: `ApexDuo_Prototype/season_hub.gd` — new `TAB_BASE=5`, `_build_page_base()`, `_populate_page()`, `rd_speed_mult()` caller, commercial income multiplier

### 2a: Data model in season.gd

- [ ] **Step 1: Add HQ constants near the top of season.gd** (after the M5 constants section, around line 350)

```gdscript
# ============================================================
# HQ BUILDINGS
# ---------------------------------------------------------------
# 9 buildings × 3 levels. One build per period (between two races).
# Each entry: {name, effects: [lvl1, lvl2, lvl3], costs: [l1, l2, l3],
#              unlock: "" or "building_id@level", unlock_season: int}
const HQ_BUILDINGS := {
	"factory":      {"name": "Завод",                    "costs": [300_000, 500_000, 800_000]},
	"design_centre":{"name": "Дизайн-центр",             "costs": [350_000, 600_000, 900_000]},
	"wind_tunnel":  {"name": "Аэродинамическая труба",   "costs": [400_000, 650_000, 1_000_000]},
	"simulator":    {"name": "Симулятор",                "costs": [400_000, 600_000, 850_000]},
	"pit_workshop": {"name": "Мастерская пит-крю",       "costs": [300_000, 550_000, 800_000]},
	"academy_hq":   {"name": "Академия",                 "costs": [350_000, 600_000, 950_000]},
	"telemetry":    {"name": "Телеметрия",               "costs": [500_000, 750_000, 1_100_000], "unlock": "factory@3"},
	"commercial":   {"name": "Коммерческий отдел",       "costs": [450_000, 700_000, 1_000_000], "unlock": "design_centre@2"},
	"weather_centre":{"name":"Метеоцентр",               "costs": [400_000, 600_000, 850_000],   "unlock_season": 3},
}
const HQ_BUILD_ROUNDS: int = 1   # races between start and completion

# Human-readable effect descriptions per building per level (for UI only).
const HQ_EFFECT_DESC := {
	"factory":       ["R&D скорость ×1.15", "R&D скорость ×1.30", "R&D скорость ×1.50"],
	"design_centre": ["Базовое аэро +0.010", "Базовое аэро +0.020", "Базовое аэро +0.030"],
	"wind_tunnel":   ["Аэро-R&D ×1.20", "Аэро-R&D ×1.40", "Аэро-R&D ×1.60"],
	"simulator":     ["FP1 инженер +0.15", "Все FP +0.15", "Все FP +0.25"],
	"pit_workshop":  ["Пит-стоп −0.10с", "Пит-стоп −0.20с", "Пит-стоп −0.30с"],
	"academy_hq":    ["1 скаут/сезон", "2 скаута", "3 скаута"],
	"telemetry":     ["Прогноз износа шин", "HUD окна пит-стопов", "Предиктивная модель"],
	"commercial":    ["Спонсоры +20%", "Спонсоры +35%", "Спонсоры +50% + $100к/этап"],
	"weather_centre":["Точный прогноз", "Прогноз квалы", "Мгновенные оповещения"],
}
```

- [ ] **Step 2: Add HQ instance variables** (near the other var declarations, around line 385)

```gdscript
# HQ Buildings state
var hq_levels: Dictionary = {}              # building_id -> level (0=unbuilt)
var hq_building_in_progress: String = ""    # "" = none building
var hq_build_completes_after: int = -1      # round_index when build finishes
```

- [ ] **Step 3: Add HQ methods** (add after `apply_car_rd()`, around line 2340)

```gdscript
# ---------------------------------------------------------------- HQ helpers
func hq_level(id: String) -> int:
	return int(hq_levels.get(id, 0))

func hq_can_unlock(id: String) -> bool:
	if not HQ_BUILDINGS.has(id):
		return false
	var bdef: Dictionary = HQ_BUILDINGS[id]
	if bdef.has("unlock_season"):
		var needed_season: int = int(bdef["unlock_season"])
		var cur_season: int = round_index / 25 + 1
		if cur_season < needed_season:
			return false
	if bdef.has("unlock"):
		var parts: Array = String(bdef["unlock"]).split("@")
		if parts.size() == 2:
			var req_id: String = String(parts[0])
			var req_lv: int = int(parts[1])
			if hq_level(req_id) < req_lv:
				return false
	return true

func hq_build_cost(id: String) -> int:
	var lv: int = hq_level(id)
	if lv >= 3:
		return 0
	var costs: Array = HQ_BUILDINGS[id]["costs"]
	return int(costs[lv])

func hq_start_build(id: String) -> bool:
	if not HQ_BUILDINGS.has(id):
		return false
	if not hq_can_unlock(id):
		return false
	if hq_level(id) >= 3:
		return false
	if hq_building_in_progress != "":
		return false
	var cost: int = hq_build_cost(id)
	if money < cost:
		return false
	money -= cost
	hq_building_in_progress = id
	hq_build_completes_after = round_index + HQ_BUILD_ROUNDS
	return true

func hq_try_complete() -> String:
	if hq_building_in_progress.is_empty():
		return ""
	if round_index < hq_build_completes_after:
		return ""
	var id: String = hq_building_in_progress
	var cur: int = hq_level(id)
	hq_levels[id] = cur + 1
	hq_building_in_progress = ""
	hq_build_completes_after = -1
	return id

# Multiplier from factory + wind_tunnel on R&D speed (layered on existing rd_speed_mult).
func hq_rd_mult() -> float:
	var factory_mults: Array = [1.0, 1.15, 1.30, 1.50]
	return float(factory_mults[hq_level("factory")])

# Aero base bonus from design_centre (flat delta to car.aero before simulation).
func hq_aero_bonus() -> float:
	return float(hq_level("design_centre")) * 0.010

# Sponsor income multiplier from commercial building.
func hq_commercial_mult() -> float:
	var mults: Array = [1.0, 1.20, 1.35, 1.50]
	return float(mults[hq_level("commercial")])

# Flat income per race from commercial lvl 3.
func hq_commercial_flat() -> int:
	return 100_000 if hq_level("commercial") >= 3 else 0

# Pit stop time reduction from pit_workshop (seconds).
func hq_pit_reduction() -> float:
	var reductions: Array = [0.0, 0.10, 0.20, 0.30]
	return float(reductions[hq_level("pit_workshop")])
```

- [ ] **Step 4: Wire `hq_rd_mult()` into `rd_speed_mult()`**

Find the return statement in `rd_speed_mult()` (around line 1335) — it currently returns a float. Multiply by `hq_rd_mult()`:

```gdscript
# Before (approx):
	return clampf(mult, RD_SPEED_MULT_MIN, RD_SPEED_MULT_MAX)

# After:
	return clampf(mult * hq_rd_mult(), RD_SPEED_MULT_MIN * hq_rd_mult(), RD_SPEED_MULT_MAX * hq_rd_mult())
```

- [ ] **Step 5: Wire `hq_aero_bonus()` into `apply_car_rd()`**

Find `apply_car_rd()` (around line 2328). Add the aero bonus delta to the existing `d_aero`:

```gdscript
func apply_car_rd() -> void:
	var d: Dictionary = car_rd_deltas()
	F1_2026.apply_rd_upgrades(
		player_team,
		float(d["d_aero"]) + hq_aero_bonus(),   # ← add hq_aero_bonus here
		float(d["d_power"]),
		float(d["d_energy"]),
		float(d["d_ch_rel"]),
		float(d["d_eng_rel"])
	)
```

- [ ] **Step 6: Wire commercial multiplier into income_per_round()**

Find `income_per_round()` in `season.gd`. Locate the sponsor income sum line and multiply:

```gdscript
# Find this (approximate pattern):
	for sp in active_sponsors:
		total += int(sp.get("base_payment", 0))

# Replace with:
	var comm_mult: float = hq_commercial_mult()
	for sp: Dictionary in active_sponsors:
		total += int(float(sp.get("base_payment", 0)) * comm_mult)
	total += hq_commercial_flat()
```

- [ ] **Step 7: Add HQ fields to `to_dict()`**

In `to_dict()`, add after the `"ai_dev"` line:

```gdscript
		# HQ Buildings
		"hq_levels":                hq_levels.duplicate(true),
		"hq_building_in_progress":  hq_building_in_progress,
		"hq_build_completes_after": hq_build_completes_after,
```

- [ ] **Step 8: Load HQ fields in `_apply_dict()`**

Find `_apply_dict()` in `season.gd`. Add after the `ai_dev` load block:

```gdscript
	# HQ Buildings
	if data.has("hq_levels"):
		for k: String in (data["hq_levels"] as Dictionary):
			s.hq_levels[k] = int(float((data["hq_levels"] as Dictionary)[k]))
	s.hq_building_in_progress = String(data.get("hq_building_in_progress", ""))
	s.hq_build_completes_after = int(float(data.get("hq_build_completes_after", -1)))
```

- [ ] **Step 9: Parse check season.gd**

```
python -m gdtoolkit.parser ApexDuo_Prototype/season.gd
```
Expected: no output.

### 2b: HQ tab UI in season_hub.gd

- [ ] **Step 10: Add TAB_BASE constant and extend TAB_NAMES**

```gdscript
# Add after TAB_PILOTS = 4:
const TAB_BASE      := 5

# Replace:
const TAB_NAMES: Array = ["ОБЗОР", "БОЛИД", "СПОНСОРЫ", "ШТАБ", "ПИЛОТЫ"]
# With:
const TAB_NAMES: Array = ["ОБЗОР", "БОЛИД", "СПОНСОРЫ", "ШТАБ", "ПИЛОТЫ", "БАЗА"]
```

- [ ] **Step 11: Add `TAB_BASE` case to `_populate_page()`**

```gdscript
		TAB_BASE:
			_build_page_base(v, s)
```

- [ ] **Step 12: Add `_build_page_base()` and `_build_hq()` functions**

```gdscript
# ================================================================ PAGE: БАЗА
func _build_page_base(v: VBoxContainer, s: Season) -> void:
	v.add_child(_build_hq(s))

func _build_hq(s: Season) -> Control:
	var pc := _panel()
	pc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 10)
	v.add_child(_hlabel("ШТАБ-КВАРТИРА КОМАНДЫ", 18, Palette.CREAM_HEX))

	if s.hq_building_in_progress != "":
		var rem: int = s.hq_build_completes_after - s.round_index
		var bname: String = String(Season.HQ_BUILDINGS[s.hq_building_in_progress].get("name", ""))
		v.add_child(_label("Строится: %s (осталось %d этапов)" % [bname, rem], 14, Palette.INFO_HEX))
	v.add_child(_spacer(4))

	var grid := GridContainer.new()
	grid.columns = 3
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL

	for bid: String in Season.HQ_BUILDINGS:
		var bdef: Dictionary = Season.HQ_BUILDINGS[bid]
		var cur_lv: int = s.hq_level(bid)
		var can_unlock: bool = s.hq_can_unlock(bid)
		var building_card := _panel()
		building_card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var bv := VBoxContainer.new()
		bv.add_theme_constant_override("separation", 5)

		var name_col: String = Palette.GOLD_HEX if cur_lv > 0 else (Palette.CREAM_HEX if can_unlock else Palette.MUTED_HEX)
		bv.add_child(_hlabel(String(bdef.get("name", bid)), 14, name_col))

		# Level pips
		var pip_row := HBoxContainer.new()
		pip_row.add_theme_constant_override("separation", 4)
		for li in range(3):
			var pip := PanelContainer.new()
			pip.custom_minimum_size = Vector2(16, 8)
			var pip_sb := StyleBoxFlat.new()
			pip_sb.bg_color = Color(Palette.GOLD_HEX) if li < cur_lv else Color(0.3, 0.3, 0.3, 1.0)
			pip.add_theme_stylebox_override("panel", pip_sb)
			pip_row.add_child(pip)
		bv.add_child(pip_row)

		# Effect text
		if cur_lv > 0 and cur_lv <= 3:
			var eff_arr: Array = Season.HQ_EFFECT_DESC.get(bid, [])
			if eff_arr.size() >= cur_lv:
				bv.add_child(_label(String(eff_arr[cur_lv - 1]), 12, Palette.GOOD_HEX))

		if cur_lv < 3 and can_unlock:
			var cost: int = s.hq_build_cost(bid)
			var desc_arr: Array = Season.HQ_EFFECT_DESC.get(bid, [""])
			var next_eff: String = String(desc_arr[cur_lv]) if desc_arr.size() > cur_lv else ""
			bv.add_child(_label("Ур.%d: %s · $%s" % [cur_lv + 1, next_eff, _money(cost)], 11, Palette.MUTED_HEX))
			var can_build: bool = s.hq_building_in_progress.is_empty() and s.money >= cost
			var build_btn := _button("Построить Ур.%d" % (cur_lv + 1), 12)
			build_btn.disabled = not can_build
			var bid_cap := bid
			var net_role2: String = Net.role()
			if net_role2 == "client":
				build_btn.pressed.connect(func():
					Net.net_season_hq_build.rpc_id(1, bid_cap))
			else:
				build_btn.pressed.connect(func():
					if s.hq_start_build(bid_cap):
						_rebuild())
			bv.add_child(build_btn)
		elif not can_unlock:
			var bdef2: Dictionary = Season.HQ_BUILDINGS.get(bid, {})
			var lock_txt: String = ""
			if bdef2.has("unlock"):
				lock_txt = "Требует: %s" % String(bdef2["unlock"]).replace("@", " Ур.")
			elif bdef2.has("unlock_season"):
				lock_txt = "Доступно с %d-го сезона" % int(bdef2["unlock_season"])
			bv.add_child(_label(lock_txt, 11, Palette.MUTED_HEX))

		building_card.add_child(bv)
		grid.add_child(building_card)

	v.add_child(grid)
	pc.add_child(v)
	return pc
```

- [ ] **Step 13: Add `net_season_hq_build` RPC stub**

Open `main.gd`, find the other `net_season_*` RPC functions (they are in a Net-forwarding pattern). Add:

```gdscript
@rpc("any_peer", "call_local", "reliable")
func net_season_hq_build(building_id: String) -> void:
	if Net.role() != "host":
		return
	if Season.active != null:
		Season.active.hq_start_build(building_id)
		Net.net_season_full.rpc(Season.active.to_dict())
```

If `net_season_*` RPCs live in `Net.gd` instead of `main.gd`, add the equivalent there following the existing pattern (e.g., `net_season_buy_supplier_part`).

- [ ] **Step 14: Call `hq_try_complete()` at round end**

Find `_end_race()` or `advance_round()` in `season.gd`. Find where `round_index` is incremented. Just after that increment, call:

```gdscript
	var completed_building: String = hq_try_complete()
	# completed_building is "" if nothing completed; caller can log it if needed
```

- [ ] **Step 15: Parse and boot test**

```
python -m gdtoolkit.parser ApexDuo_Prototype/season.gd
python -m gdtoolkit.parser ApexDuo_Prototype/season_hub.gd
python -m gdtoolkit.parser ApexDuo_Prototype/main.gd
```
Then:
```
"C:\Users\Karim\Desktop\Godot_v4.6.3-stable_win64.exe\Godot_v4.6.3-stable_win64.exe" --headless --path ApexDuo_Prototype --quit-after 30 2>&1 | Select-String -Pattern "ERROR|SCRIPT ERROR|Parse Error"
```

- [ ] **Step 16: Commit**

```
git add ApexDuo_Prototype/season.gd ApexDuo_Prototype/season_hub.gd ApexDuo_Prototype/main.gd
git commit -m "feat(hq): HQ Buildings — 9 buildings, 3 levels, БАЗА tab, wired into R&D/income"
```

---

## Task 3: Random Events

**Files:**
- Modify: `ApexDuo_Prototype/season.gd` — state vars, event generation, effect application, save/load
- Modify: `ApexDuo_Prototype/season_hub.gd` — modal at hub entry

### 3a: Data model in season.gd

- [ ] **Step 1: Add event constants** (after HQ_BUILDINGS constants)

```gdscript
# ============================================================
# RANDOM EVENTS
# ---------------------------------------------------------------
const EVENT_CHANCE: float = 0.70     # 70% chance of an event each paddock visit
const EVENT_SEED_MIX2: int = 0xEVE77 # separate stream from staff EVENT_SEED_MIX

# Template list — {id, title, body_template, opt_a, opt_b, eff_a, eff_b}
# eff: {money, morale, car_aero, car_power, car_rel, expires_after: int}
# Use {N} in body_template — filled from a seeded number when generated.
const EVENT_TEMPLATES: Array = [
	{
		"id": "engineering",
		"title": "Инженерное решение",
		"body": "Инженеры предлагают рискованный апгрейд: +{A}% мощности на {B} этапа, но стоит ${C}к.",
		"opt_a": "Одобрить (риск)",
		"opt_b": "Отказаться",
		"eff_a": {"money": -80_000, "car_power": 0.015, "expires_after": 2},
		"eff_b": {}
	},
	{
		"id": "sponsor_bonus",
		"title": "Спонсорский бонус",
		"body": "Спонсор предлагает ${A}к немедленно или ${B}к если финишируем в топ-8.",
		"opt_a": "Взять сейчас (+${A}к)",
		"opt_b": "Поставить на результат",
		"eff_a": {"money": 60_000},
		"eff_b": {"conditional_money": 100_000, "condition": "top8", "expires_after": 1}
	},
	{
		"id": "driver_conflict",
		"title": "Конфликт в гараже",
		"body": "Пилоты поссорились из-за тактики. Штраф $40к или −{A} морали у обоих.",
		"opt_a": "Заплатить ($40к)",
		"opt_b": "Принять потери (−мораль)",
		"eff_a": {"money": -40_000},
		"eff_b": {"morale": -0.10}
	},
	{
		"id": "part_failure",
		"title": "Отказ компонента",
		"body": "Обнаружена трещина в шасси. Замена $70к или рискуем надёжностью на {A} этапа.",
		"opt_a": "Заменить ($70к)",
		"opt_b": "Рискнуть",
		"eff_a": {"money": -70_000},
		"eff_b": {"car_rel": -0.020, "expires_after": 2}
	},
	{
		"id": "staff_offer",
		"title": "Предложение сотруднику",
		"body": "Соперник переманивает нашего {role}. Удержать (+$50к) или отпустить.",
		"opt_a": "Удержать (+$50к/этап)",
		"opt_b": "Отпустить",
		"eff_a": {"money": -50_000},
		"eff_b": {"staff_loyalty": -0.15}
	},
	{
		"id": "media",
		"title": "Медийный момент",
		"body": "Интервью пилота вирусное: +{A} морали команды. Никаких решений не нужно.",
		"opt_a": "Отлично!",
		"opt_b": "Без комментариев",
		"eff_a": {"morale": 0.05},
		"eff_b": {}
	},
	{
		"id": "rule_vote",
		"title": "Голосование FIA",
		"body": "Голосование по изменению технического регламента. Поддержать (выгодно нам) или заблокировать.",
		"opt_a": "Поддержать",
		"opt_b": "Заблокировать",
		"eff_a": {"car_aero": 0.008, "expires_after": 4},
		"eff_b": {"car_power": 0.008, "expires_after": 4}
	},
	{
		"id": "logistics",
		"title": "Логистический кризис",
		"body": "Груз застрял на таможне. Экстренная доставка $60к или опоздание (-мораль).",
		"opt_a": "Экстренная доставка ($60к)",
		"opt_b": "Опоздать",
		"eff_a": {"money": -60_000},
		"eff_b": {"morale": -0.08}
	},
]
```

- [ ] **Step 2: Add event instance variables** (near the hq vars)

```gdscript
# Random events
var pending_event: Dictionary = {}         # {} = no event; set by generate_event()
var active_event_effects: Array = []       # Array[Dictionary] each: {type, magnitude, expires_after_race}
```

- [ ] **Step 3: Add event generation and resolution methods** (after hq methods)

```gdscript
# ---------------------------------------------------------------- Random events
func generate_event() -> void:
	pending_event = {}
	var erng2 := LCG.new()
	erng2.seed = mix32(mix32(cal_seed + round_index) ^ EVENT_SEED_MIX2)
	if erng2.unit() > EVENT_CHANCE:
		return
	var tidx: int = erng2.rng.randi() % EVENT_TEMPLATES.size()
	pending_event = EVENT_TEMPLATES[tidx].duplicate(true)
	# Fill numeric placeholders with seeded values
	pending_event["body"] = String(pending_event.get("body", "")) \
		.replace("{A}", str(erng2.rng.randi_range(10, 25))) \
		.replace("{B}", str(erng2.rng.randi_range(2, 4))) \
		.replace("{C}", str(erng2.rng.randi_range(60, 120))) \
		.replace("{role}", _random_role_name(erng2))

func _random_role_name(erng: LCG) -> String:
	var roles: Array = ["стратег", "инженер", "дизайнер", "механик"]
	return String(roles[erng.rng.randi() % roles.size()])

func resolve_event(choice: int) -> void:
	# choice: 0 = option A, 1 = option B
	if pending_event.is_empty():
		return
	var eff_key: String = "eff_a" if choice == 0 else "eff_b"
	var eff: Dictionary = pending_event.get(eff_key, {})
	_apply_event_effect(eff)
	pending_event = {}

func _apply_event_effect(eff: Dictionary) -> void:
	if eff.is_empty():
		return
	if eff.has("money"):
		money += int(eff["money"])
	if eff.has("morale"):
		for id in TEAM_IDS:
			driver_morale[id] = clampf(float(driver_morale.get(id, 0.75)) + float(eff["morale"]), 0.0, 1.0)
	if eff.has("staff_loyalty"):
		for s: Dictionary in staff:
			s["loyalty"] = clampf(float(s.get("loyalty", 0.5)) + float(eff["staff_loyalty"]), 0.0, 1.0)
	# Timed effects (car stat modifiers, conditional money)
	if eff.has("car_aero") or eff.has("car_power") or eff.has("car_rel") or eff.has("conditional_money"):
		var entry: Dictionary = eff.duplicate(true)
		entry["expires_after_race"] = round_index + int(eff.get("expires_after", 1))
		active_event_effects.append(entry)

func tick_event_effects() -> void:
	# Call at round end — expire old effects.
	var keep: Array = []
	for e: Dictionary in active_event_effects:
		if round_index < int(e.get("expires_after_race", 0)):
			keep.append(e)
	active_event_effects = keep

# Returns the combined car stat delta from active event effects.
func event_car_delta() -> Dictionary:
	var out := {"d_aero": 0.0, "d_power": 0.0, "d_rel": 0.0}
	for e: Dictionary in active_event_effects:
		out["d_aero"]  += float(e.get("car_aero",  0.0))
		out["d_power"] += float(e.get("car_power", 0.0))
		out["d_rel"]   += float(e.get("car_rel",   0.0))
	return out
```

- [ ] **Step 4: Wire `event_car_delta()` into `apply_car_rd()`**

```gdscript
func apply_car_rd() -> void:
	var d: Dictionary = car_rd_deltas()
	var ev: Dictionary = event_car_delta()
	F1_2026.apply_rd_upgrades(
		player_team,
		float(d["d_aero"]) + hq_aero_bonus() + float(ev["d_aero"]),
		float(d["d_power"]) + float(ev["d_power"]),
		float(d["d_energy"]),
		float(d["d_ch_rel"]) + float(ev["d_rel"]),
		float(d["d_eng_rel"])
	)
```

- [ ] **Step 5: Add events to `to_dict()`**

```gdscript
		# Random events
		"pending_event":        pending_event.duplicate(true),
		"active_event_effects": active_event_effects.duplicate(true),
```

- [ ] **Step 6: Load events in `_apply_dict()`**

```gdscript
	# Random events
	if data.has("pending_event"):
		s.pending_event = (data["pending_event"] as Dictionary).duplicate(true)
	if data.has("active_event_effects"):
		for e: Dictionary in (data["active_event_effects"] as Array):
			s.active_event_effects.append(e.duplicate(true))
```

- [ ] **Step 7: Call `generate_event()` at round start and `tick_event_effects()` at round end**

Find where the paddock hub is entered after a race (the `advance_round()` or equivalent in `season.gd`). At the END of the advance (after incrementing `round_index`):

```gdscript
	tick_event_effects()
	generate_event()   # generates pending_event for next paddock visit
```

Also call `generate_event()` once in `configure()` (new season start) so the very first round has an event.

- [ ] **Step 8: Parse check**

```
python -m gdtoolkit.parser ApexDuo_Prototype/season.gd
```

### 3b: Event modal UI in season_hub.gd

- [ ] **Step 9: Add `_build_event_modal()` helper and call it from `_ready()`**

In `_ready()`, after `_rebuild()`:

```gdscript
	_show_pending_event()
```

Add the function:

```gdscript
func _show_pending_event() -> void:
	var s: Season = Season.active
	if s == null or s.pending_event.is_empty():
		return
	var ev: Dictionary = s.pending_event

	var overlay := PanelContainer.new()
	overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	var ob_sb := StyleBoxFlat.new()
	ob_sb.bg_color = Color(0, 0, 0, 0.65)
	overlay.add_theme_stylebox_override("panel", ob_sb)
	add_child(overlay)

	var modal := PanelContainer.new()
	modal.custom_minimum_size = Vector2(480, 0)
	modal.set_anchors_preset(Control.PRESET_CENTER)
	add_child(modal)

	var mv := VBoxContainer.new()
	mv.add_theme_constant_override("separation", 14)
	var title_txt: String = String(ev.get("title", "Событие"))
	mv.add_child(_hlabel(title_txt, 20, Palette.GOLD_HEX))
	mv.add_child(_label(String(ev.get("body", "")), 14, Palette.CREAM_HEX))
	mv.add_child(_spacer(8))

	var btn_row := HBoxContainer.new()
	btn_row.add_theme_constant_override("separation", 12)
	btn_row.size_flags_horizontal = Control.SIZE_EXPAND_FILL

	var btn_a := _button(String(ev.get("opt_a", "А")), 14)
	btn_a.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	btn_a.pressed.connect(func():
		s.resolve_event(0)
		overlay.queue_free()
		modal.queue_free()
		_rebuild())
	btn_row.add_child(btn_a)

	var btn_b := _button(String(ev.get("opt_b", "Б")), 14)
	btn_b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	btn_b.pressed.connect(func():
		s.resolve_event(1)
		overlay.queue_free()
		modal.queue_free()
		_rebuild())
	btn_row.add_child(btn_b)

	mv.add_child(btn_row)
	modal.add_child(mv)
```

- [ ] **Step 10: Parse and boot test**

```
python -m gdtoolkit.parser ApexDuo_Prototype/season.gd
python -m gdtoolkit.parser ApexDuo_Prototype/season_hub.gd
```
Then boot test as in Task 2 Step 15.

- [ ] **Step 11: Commit**

```
git add ApexDuo_Prototype/season.gd ApexDuo_Prototype/season_hub.gd
git commit -m "feat(events): random event system — 8 types, binary choice, modal UI, timed effects"
```

---

## Task 4: Weather System

**Files:**
- Modify: `ApexDuo_Prototype/race_sim.gd` — weather state enum, pace penalty table, `_car_pace()` compound check
- Modify: `ApexDuo_Prototype/main.gd` — weather alert in the event feed when state changes

### Background

`race_sim.gd` already has a `wetness` float (0..1), `wet_start`/`wet_end` lap fractions, and `_m_weather()` that penalises the wrong compound using the continuous `wetness` value. We add discrete named states derived from `wetness` and a separate penalty table for compound mismatch — this replaces/supplements the existing smooth penalty with clearer named states. Determinism is untouched because we derive state purely from existing `wetness` value, which is already deterministically seeded.

- [ ] **Step 1: Add weather state constants** (at the top of `race_sim.gd`, near the other `const` blocks)

```gdscript
# Weather states (derived from wetness each tick — no new RNG needed)
const WEATHER_DRY      := "dry"
const WEATHER_VARIABLE := "variable"
const WEATHER_RAIN     := "rain"
const WEATHER_STORM    := "storm"

# Compound penalty table: [dry, variable, rain, storm] for each compound category.
# Index: 0=slick (soft/med/hard), 1=inter, 2=wet
# Values are lap-time penalties in seconds.
const WEATHER_COMPOUND_PENALTY: Array = [
	# slick penalties per state:
	[0.0,  1.5,  4.0,  8.0],
	# inter penalties:
	[3.0,  0.0,  0.5,  2.0],
	# wet penalties:
	[6.0,  2.0,  0.0,  0.0],
]
```

- [ ] **Step 2: Add `weather_state` instance var and `_current_weather_state()` helper**

Find the `var wetness` line (around line 655) and add below it:

```gdscript
var weather_state: String = WEATHER_DRY   # updated each tick from wetness
```

Add a helper function near `_m_weather()`:

```gdscript
func _current_weather_state() -> String:
	if wetness < 0.15:
		return WEATHER_DRY
	elif wetness < 0.40:
		return WEATHER_VARIABLE
	elif wetness < 0.75:
		return WEATHER_RAIN
	else:
		return WEATHER_STORM

func _compound_category(compound: String) -> int:
	if compound == "inter":
		return 1
	elif compound == "wet":
		return 2
	return 0  # slick (soft/medium/hard/hyper)
```

- [ ] **Step 3: Update `weather_state` each tick and detect transitions**

Find the `step()` function in `race_sim.gd`. At the start of each tick (before the phase loop), add:

```gdscript
	var prev_weather: String = weather_state
	weather_state = _current_weather_state()
	if weather_state != prev_weather:
		_events.append({"type": "weather", "state": weather_state, "lap": _current_lap_estimate()})
		# Track evolution reset on rain transition
		if weather_state == WEATHER_RAIN or weather_state == WEATHER_VARIABLE:
			track_evo = 0.0
```

If `_current_lap_estimate()` does not exist, add it:

```gdscript
func _current_lap_estimate() -> int:
	if cars.is_empty():
		return 0
	return int(round(float((cars[0] as Driver).lap) + float((cars[0] as Driver).lap_frac)))
```

- [ ] **Step 4: Add compound-mismatch penalty to `_car_pace()`**

In `_car_pace()`, after the `_m_weather(d)` line (around line 1014), add:

```gdscript
	# Compound mismatch penalty (on top of the continuous wetness model)
	var w_state: String = _current_weather_state()
	var state_idx: int = [WEATHER_DRY, WEATHER_VARIABLE, WEATHER_RAIN, WEATHER_STORM].find(w_state)
	if state_idx < 0:
		state_idx = 0
	var comp_cat: int = _compound_category(d.compound)
	lt += float(WEATHER_COMPOUND_PENALTY[comp_cat][state_idx])
```

- [ ] **Step 5: Include `weather_state` in `make_snapshot()`**

Find `make_snapshot()` in `race_sim.gd`. Add:

```gdscript
		"weather_state": weather_state,
```

- [ ] **Step 6: Parse check race_sim.gd**

```
python -m gdtoolkit.parser ApexDuo_Prototype/race_sim.gd
```
Expected: no output.

- [ ] **Step 7: Add weather alert display in main.gd**

Find `_process_events()` or wherever the event feed is processed in `main.gd` (look for where `{"type": "sc"}` or similar events are handled in the HUD). Add a weather case:

```gdscript
			"weather":
				var wnames: Dictionary = {
					"dry": "Трасса высыхает",
					"variable": "Переменная погода",
					"rain": "Дождь!",
					"storm": "Ливень!"
				}
				var wname: String = String(wnames.get(String(ev.get("state", "")), "Погода меняется"))
				_add_event_line("[погода] %s (круг %d)" % [wname, int(ev.get("lap", 0))], "info")
```

- [ ] **Step 8: Show weather state in HUD status line**

Find in `main.gd` where the race status line is built (SC/safety car status). Add after the SC line:

```gdscript
	if _sim != null:
		var wstate: String = _sim.weather_state
		if wstate != RaceSim.WEATHER_DRY:
			var wlabels: Dictionary = {
				"variable": "ПЕРЕМЕННО",
				"rain": "ДОЖДЬ",
				"storm": "ЛИВЕНЬ"
			}
			var wlbl: String = String(wlabels.get(wstate, wstate.to_upper()))
			# Add to status label or weather chip — follow existing SC status pattern
```

- [ ] **Step 9: Parse and boot test**

```
python -m gdtoolkit.parser ApexDuo_Prototype/race_sim.gd
python -m gdtoolkit.parser ApexDuo_Prototype/main.gd
```
Then:
```
"C:\Users\Karim\Desktop\Godot_v4.6.3-stable_win64.exe\Godot_v4.6.3-stable_win64.exe" --headless --path ApexDuo_Prototype --quit-after 30 2>&1 | Select-String -Pattern "ERROR|SCRIPT ERROR|Parse Error"
```

- [ ] **Step 10: Verify weather triggers correctly with headless sim**

Write a test script `ApexDuo_Prototype/test_weather.gd`:

```gdscript
extends SceneTree
func _init() -> void:
	var sim := load("res://race_sim.gd").new()
	var tracks := sim.REAL_TRACKS
	var found_rain := false
	for t in tracks:
		if float(t["wet_prob"]) > 0.5:
			# High wet_prob track — run a race and check weather events appear
			sim.configure(t["name"], 42, 11)
			var rain_ticks := 0
			for _i in range(80000):
				sim.step(0.25)
				if sim.weather_state != sim.WEATHER_DRY:
					rain_ticks += 1
			if rain_ticks > 100:
				found_rain = true
				print("OK: %s had %d rain ticks" % [t["name"], rain_ticks])
			break
	if not found_rain:
		print("WARN: No rain detected on wet track — check wet_prob values")
	quit()
```

Run:
```
"C:\Users\Karim\Desktop\Godot_v4.6.3-stable_win64.exe\Godot_v4.6.3-stable_win64.exe" --headless --script res://test_weather.gd --path ApexDuo_Prototype 2>&1
```

Clean up: delete `test_weather.gd` after passing.

- [ ] **Step 11: Commit**

```
git add ApexDuo_Prototype/race_sim.gd ApexDuo_Prototype/main.gd
git commit -m "feat(weather): discrete weather states — dry/variable/rain/storm, compound penalties, HUD alerts"
```

---

## Task 5: Transfer Market Improvements

**Files:**
- Modify: `ApexDuo_Prototype/season_hub.gd` — `_build_contracts()` → expand to full transfer market
- Modify: `ApexDuo_Prototype/season.gd` — add `age` field to driver records; add `sign_free_agent()` with offer flow

### 5a: Driver age in season.gd

- [ ] **Step 1: Add age to driver generation**

In `season.gd`, find where player drivers are initialised (look for `driver_morale` or `TEAM_IDS` loop in `configure()`). For each driver, add:

```gdscript
	# Assign ages deterministically from cal_seed
	var age_rng := LCG.new()
	age_rng.seed = mix32(cal_seed ^ 0xA6E5)
	driver_age = {}
	for did in TEAM_IDS:
		driver_age[did] = age_rng.rng.randi_range(20, 30)
```

Add `var driver_age: Dictionary = {}` to the instance vars.

- [ ] **Step 2: Age skill decline model**

Add a helper function:

```gdscript
func driver_effective_skill(driver_id: int) -> float:
	var base: float = float(contracts.get(str(driver_id), {}).get("skill", 0.80))
	var age: int = int(driver_age.get(driver_id, 27))
	if age > 33:
		base -= float(age - 33) * 0.005
	return clampf(base, 0.50, 1.0)
```

- [ ] **Step 3: Add age/skill to `to_dict()` and `_apply_dict()`**

In `to_dict()`:
```gdscript
		"driver_age": driver_age.duplicate(true),
```

In `_apply_dict()`:
```gdscript
	if data.has("driver_age"):
		for k: String in (data["driver_age"] as Dictionary):
			s.driver_age[int(k)] = int(float((data["driver_age"] as Dictionary)[k]))
```

- [ ] **Step 4: Add `sign_free_agent()` method**

```gdscript
func sign_free_agent(slot: int, skill: float, salary: int, age: int) -> bool:
	# slot: 4 or 5 (P5/P6); fee = 3 races × salary
	var fee: int = salary * 3
	if money < fee:
		return false
	money -= fee
	var did: int = TEAM_IDS[slot - 4]
	contracts[str(did)] = {
		"skill": skill,
		"salary": salary,
		"remaining_races": 5,
		"status": "second"
	}
	driver_age[did] = age
	return true
```

### 5b: Transfer market UI in season_hub.gd

- [ ] **Step 5: Expand `_build_contracts()` with full market section**

The existing function shows 5 rivals from the current grid. Add below the existing rival rows a "ТРАНСФЕРНЫЙ РЫНОК" section with all non-contracted drivers plus expiring-contract drivers from real grid:

```gdscript
	v.add_child(_spacer(10))
	v.add_child(_hlabel("ТРАНСФЕРНЫЙ РЫНОК", 16, Palette.CREAM_HEX))
	v.add_child(_label("Свободные агенты и гонщики с истекающим контрактом:", 12, MUTED))

	# Build a market list from the F1_2026 grid (real 2026 drivers not in our team)
	s.apply_car_rd()
	var our_ids: Array = Season.TEAM_IDS
	var market_grid: Array = F1_2026.race_grid({})
	var net_role3: String = Net.role()

	for gi in market_grid.size():
		var gd: Dictionary = market_grid[gi]
		var gid: int = int(gd.get("id", -1))
		if our_ids.has(gid):
			continue
		var gname: String = String(gd.get("name", ""))
		var gskill: float = float(gd.get("skill", 0.5))
		var gage: int = 20 + (gid % 22)   # deterministic age from grid position
		var gsalary: int = int(gskill * 30_000) + 10_000
		var fee: int = gsalary * 3
		var tier_diff: float = gskill - (float(s.team_tier) / 10.0)
		var accept_prob: String = "высокая" if tier_diff >= 0.0 else ("средняя" if tier_diff > -0.1 else "низкая")

		var trow := HBoxContainer.new()
		trow.add_theme_constant_override("separation", 8)
		trow.add_child(_label(gname, 13, Palette.CREAM_HEX))
		trow.add_child(_label("Возраст: %d" % gage, 12, MUTED))
		trow.add_child(_label("★%.0f%%" % (gskill * 100.0), 13, Palette.GOLD_HEX))
		trow.add_child(_label("Сбор: $%s" % _money(fee), 12, Palette.WARN_HEX))
		trow.add_child(_label("Шанс принять: %s" % accept_prob, 12,
			Palette.GOOD_HEX if accept_prob == "высокая" else Palette.MUTED_HEX))

		var s5b := _button("→P5 $%s" % _money(fee), 11)
		s5b.disabled = s.money < fee
		var gi_cap := gi
		s5b.pressed.connect(func():
			if s.sign_free_agent(4, float(market_grid[gi_cap].get("skill", 0.5)), gsalary, gage):
				_rebuild())
		if net_role3 == "client":
			s5b.disabled = true
		trow.add_child(s5b)

		var s6b := _button("→P6 $%s" % _money(fee), 11)
		s6b.disabled = s.money < fee
		s6b.pressed.connect(func():
			if s.sign_free_agent(5, float(market_grid[gi_cap].get("skill", 0.5)), gsalary, gage):
				_rebuild())
		if net_role3 == "client":
			s6b.disabled = true
		trow.add_child(s6b)

		v.add_child(trow)
```

Note: The `gsalary` and `gage` captures inside closures will be stale if the loop continues; capture them explicitly:

```gdscript
		# Capture loop vars for closures
		var gsalary_cap: int = gsalary
		var gage_cap: int = gage
		var gskill_cap: float = gskill
		s5b.pressed.connect(func():
			if s.sign_free_agent(4, gskill_cap, gsalary_cap, gage_cap):
				_rebuild())
		s6b.pressed.connect(func():
			if s.sign_free_agent(5, gskill_cap, gsalary_cap, gage_cap):
				_rebuild())
```

- [ ] **Step 6: Parse and boot test**

```
python -m gdtoolkit.parser ApexDuo_Prototype/season.gd
python -m gdtoolkit.parser ApexDuo_Prototype/season_hub.gd
```
Then:
```
"C:\Users\Karim\Desktop\Godot_v4.6.3-stable_win64.exe\Godot_v4.6.3-stable_win64.exe" --headless --path ApexDuo_Prototype --quit-after 30 2>&1 | Select-String -Pattern "ERROR|SCRIPT ERROR|Parse Error"
```

- [ ] **Step 7: Commit**

```
git add ApexDuo_Prototype/season.gd ApexDuo_Prototype/season_hub.gd
git commit -m "feat(market): full transfer market — driver age/decline, free agent list, offer flow"
```

---

## Post-implementation checklist

- [ ] F5 the game and navigate through: ОБЗОР → БОЛИД (stat bars visible) → БАЗА (9 building cards, one build queues) → ПИЛОТЫ (transfer market rows with sign buttons)
- [ ] Start a race, confirm weather HUD alert appears on wet-probability tracks (Singapore, Brazil, Japan)
- [ ] Trigger an event by forcing `pending_event` in `_ready()` temporarily to verify modal renders and both buttons work
- [ ] Verify save/load round-trip: start a game, build one HQ building, save, reload, confirm `hq_levels` is restored

---

## Known gotchas

- `race_sim.gd` `_car_pace()` already calls `_m_weather(d)` which adds a continuous penalty from `wetness`. Task 4 adds a SECOND term from the compound mismatch table. These stack — if it feels too punishing in playtesting, halve `WEATHER_COMPOUND_PENALTY` values.
- The `LCG` class: `season.gd` uses `mix32()` as a standalone function, not an `LCG` object for event generation. Check whether `LCG.new()` is available or whether you should use the `rng` member directly — if LCG isn't a class in scope, replace `LCG.new()` / `erng2.rng.randi_range()` calls with `RandomNumberGenerator.new()` + `seed` + `randi_range()`.
- Tab clamping: `_active_tab = clampi(_active_tab, 0, TAB_NAMES.size() - 1)` already exists in `_ready()`. After adding TAB_BASE, the clamp will cover 0–5 automatically — no change needed.
- `net_season_hq_build` RPC: if `Net.gd` owns all `net_season_*` RPCs (not `main.gd`), add it there instead, following the same pattern as `net_season_buy_supplier_part`.
