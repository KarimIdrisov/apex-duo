extends Control

# ============================================================================
# Apex Duo — new-season setup. Pick any of the 11 real 2026 teams, difficulty,
# and co-op mode. Builds a configured Season and hands off to the paddock hub.
# ============================================================================

# Palette aliases — keep thin local aliases to minimise churn.
const BG    := Palette.BG
const PANEL := Palette.PANEL
const MUTED := Palette.MUTED_HEX

# Default: Williams (rank 4) — mid-grid, good learning experience.
var sel_team := 4
var sel_diff := 1
var sel_coop := false

func _ready() -> void:
	theme = Palette.base_theme()
	add_child(Palette.vignette_layer())
	_rebuild()

func _rebuild() -> void:
	for c in get_children():
		c.queue_free()

	var bg := ColorRect.new()
	bg.color = BG
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(bg)

	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 30)
	add_child(margin)

	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 10)
	margin.add_child(col)

	var heading := _label("НОВЫЙ СЕЗОН — НАСТРОЙКА", 30, Palette.GOLD_HEX)
	heading.add_theme_font_override("font", Palette.display_font(600, 2))
	col.add_child(heading)

	# --- team picker ---
	var team_hdr := _label("КОМАНДА:", 18, Palette.CREAM_HEX)
	team_hdr.add_theme_font_override("font", Palette.display_font(600, 2))
	col.add_child(team_hdr)

	# Scrollable list of all 11 teams
	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(0, 340)
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(scroll)

	var list := VBoxContainer.new()
	list.add_theme_constant_override("separation", 4)
	list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(list)

	for ti in F1_2026.TEAMS.size():
		list.add_child(_team_row(ti))

	# --- difficulty ---
	var diff_hdr := _label("СЛОЖНОСТЬ (СИЛА СОПЕРНИКОВ):", 18, Palette.CREAM_HEX)
	diff_hdr.add_theme_font_override("font", Palette.display_font(600, 2))
	col.add_child(diff_hdr)
	var drow := HBoxContainer.new()
	drow.add_theme_constant_override("separation", 8)
	col.add_child(drow)
	for i in Season.DIFFICULTY.size():
		var dd: Dictionary = Season.DIFFICULTY[i]
		var b := _button(String(dd["name"]), 16)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.modulate = Color.WHITE if i == sel_diff else Color(0.5, 0.5, 0.5)
		var idx := i
		b.pressed.connect(func(): sel_diff = idx; _rebuild())
		drow.add_child(b)

	# --- mode ---
	var mode_hdr := _label("РЕЖИМ:", 18, Palette.CREAM_HEX)
	mode_hdr.add_theme_font_override("font", Palette.display_font(600, 2))
	col.add_child(mode_hdr)
	var mrow := HBoxContainer.new()
	mrow.add_theme_constant_override("separation", 8)
	col.add_child(mrow)
	var is_online_host: bool = Net.role() == "host"
	if is_online_host:
		var online_lbl := _label("Онлайн-кооп (хост) — сервер поднят, ожидание партнёра…", 15, Palette.INFO_HEX)
		mrow.add_child(online_lbl)
	else:
		var solo_b := _button("Соло (1 игрок)", 16)
		solo_b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		solo_b.modulate = Color.WHITE if not sel_coop else Color(0.5, 0.5, 0.5)
		solo_b.pressed.connect(func(): sel_coop = false; _rebuild())
		mrow.add_child(solo_b)
		var coop_b := _button("Локальный кооп (2 игрока)", 16)
		coop_b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		coop_b.modulate = Color.WHITE if sel_coop else Color(0.5, 0.5, 0.5)
		coop_b.pressed.connect(func(): sel_coop = true; _rebuild())
		mrow.add_child(coop_b)

	# --- action bar ---
	var grow := Control.new()
	grow.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(grow)
	var bar := HBoxContainer.new()
	bar.add_theme_constant_override("separation", 10)
	col.add_child(bar)
	var start := _button("Начать сезон →", 18)
	start.custom_minimum_size = Vector2(220, 46)
	start.pressed.connect(_on_start)
	bar.add_child(start)
	var sp := Control.new()
	sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	bar.add_child(sp)
	var back := _button("Назад", 15)
	back.pressed.connect(func(): get_tree().change_scene_to_file("res://main.tscn"))
	bar.add_child(back)

# Build one team row for the picker. Shows: colour chip | team name & difficulty
# label | both drivers (name + rating «88»=skill*100) | car bars | Select button.
func _team_row(ti: int) -> Control:
	var tdef: Dictionary = F1_2026.TEAMS[ti]
	var tname: String = String(tdef["name"])
	var tcol: String = String(tdef["color"])
	var drivers: Array = tdef["drivers"]
	var car: Dictionary = F1_2026.team_car(ti)

	var selected: bool = (ti == sel_team)

	var pc := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Palette.PANEL2 if selected else Palette.PANEL
	sb.set_corner_radius_all(2)
	sb.set_content_margin_all(8)
	sb.set_border_width_all(1)
	sb.border_color = Palette.GOLD if selected else Palette.DIV
	pc.add_theme_stylebox_override("panel", sb)
	pc.size_flags_horizontal = Control.SIZE_EXPAND_FILL

	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	pc.add_child(row)

	# Colour chip
	var chip := ColorRect.new()
	chip.color = Color(tcol)
	chip.custom_minimum_size = Vector2(6, 0)
	row.add_child(chip)

	# Team name + difficulty label
	var name_col := VBoxContainer.new()
	name_col.add_theme_constant_override("separation", 2)
	name_col.custom_minimum_size = Vector2(160, 0)
	var tname_lbl := _label(tname, 15, Palette.GOLD_HEX if selected else Palette.CREAM_HEX)
	tname_lbl.add_theme_font_override("font", Palette.display_font(600, 1))
	name_col.add_child(tname_lbl)
	name_col.add_child(_label(_rank_label(ti), 12, MUTED))
	row.add_child(name_col)

	# Drivers column
	var drv_col := VBoxContainer.new()
	drv_col.add_theme_constant_override("separation", 2)
	drv_col.custom_minimum_size = Vector2(190, 0)
	for di in drivers.size():
		var d: Dictionary = drivers[di]
		var dname: String = String(d["name"])
		var dskill: float = float(d["skill"])
		var rating: int = int(round(dskill * 100.0))
		var drow2 := HBoxContainer.new()
		drow2.add_theme_constant_override("separation", 6)
		drow2.add_child(_label(dname, 13, Palette.CREAM_HEX))
		drow2.add_child(_label(str(rating), 13, Palette.INFO_HEX))
		drv_col.add_child(drow2)
	row.add_child(drv_col)

	# Car stats (power + aero as mini-bars or numbers)
	var car_col := VBoxContainer.new()
	car_col.add_theme_constant_override("separation", 2)
	car_col.custom_minimum_size = Vector2(120, 0)
	var pwr: float = float(car["power"])
	var aero: float = float(car["aero"])
	var pwr_row := HBoxContainer.new()
	pwr_row.add_theme_constant_override("separation", 4)
	pwr_row.add_child(_label("МОЩ", 11, MUTED))
	pwr_row.add_child(_mini_bar(pwr, Palette.WARN))
	car_col.add_child(pwr_row)
	var aero_row := HBoxContainer.new()
	aero_row.add_theme_constant_override("separation", 4)
	aero_row.add_child(_label("АЭРО", 11, MUTED))
	aero_row.add_child(_mini_bar(aero, Palette.INFO))
	car_col.add_child(aero_row)
	row.add_child(car_col)

	# Budget hint
	var budget_col := VBoxContainer.new()
	budget_col.add_theme_constant_override("separation", 2)
	budget_col.custom_minimum_size = Vector2(110, 0)
	var mon: int = Season._rank_money(ti)
	var rp_val: int = Season._rank_rp(ti)
	budget_col.add_child(_label("$%d М · %d RP" % [mon / 1_000_000, rp_val], 12, Palette.GOOD_HEX))
	budget_col.add_child(_label(Season._rank_goal(ti), 11, MUTED))
	row.add_child(budget_col)

	# Flexible spacer + select button
	var flex := Control.new()
	flex.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(flex)

	var pick := _button("✔ Выбрано" if selected else "Выбрать", 13)
	pick.custom_minimum_size = Vector2(90, 28)
	if not selected:
		pick.modulate = Color(0.7, 0.7, 0.7)
	var cap_ti := ti
	pick.pressed.connect(func(): sel_team = cap_ti; _rebuild())
	row.add_child(pick)

	return pc

# A small horizontal fill-bar (0..1) for power/aero display.
func _mini_bar(value: float, fill_col: Color) -> Control:
	var w: int = 80
	var h: int = 8
	var container := Control.new()
	container.custom_minimum_size = Vector2(w, h)
	var bg := ColorRect.new()
	bg.color = Color(0.08, 0.08, 0.09)
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	container.add_child(bg)
	var fill := ColorRect.new()
	fill.color = fill_col
	fill.set_anchor(SIDE_LEFT, 0.0)
	fill.set_anchor(SIDE_TOP, 0.0)
	fill.set_anchor(SIDE_BOTTOM, 1.0)
	fill.set_anchor(SIDE_RIGHT, 0.0)
	fill.set_offset(SIDE_RIGHT, clampf(value, 0.0, 1.0) * float(w))
	container.add_child(fill)
	return container

# Difficulty label by team rank: 0-1 Контендер, 2-4 Претендент, 5-7 Середняк, 8-10 Андердог.
func _rank_label(rank: int) -> String:
	if rank <= 1:
		return "Контендер"
	if rank <= 4:
		return "Претендент"
	if rank <= 7:
		return "Середняк"
	return "Андердог"

func _on_start() -> void:
	var s := Season.new()
	var is_online_host: bool = Net.role() == "host"
	s.configure(sel_team, sel_diff, sel_coop or is_online_host)
	Season.active = s
	get_tree().change_scene_to_file("res://season_hub.tscn")

# ---------------------------------------------------------------- helpers
func _label(txt: String, sz: int, col: String) -> Label:
	var l := Label.new()
	l.text = txt
	l.add_theme_font_size_override("font_size", sz)
	l.add_theme_color_override("font_color", Color(col))
	return l

func _button(txt: String, sz: int) -> Button:
	var b := Button.new()
	b.text = txt
	b.add_theme_font_size_override("font_size", sz)
	b.custom_minimum_size = Vector2(0, 34)
	return b

func _spacer(h: int) -> Control:
	var c := Control.new()
	c.custom_minimum_size = Vector2(0, h)
	return c
