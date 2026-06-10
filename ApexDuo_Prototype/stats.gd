extends Control

# ============================================================================
# Apex Duo — season statistics screen: Constructors' Championship (teams),
# Drivers' Championship, and FM-style season leaders. Reached from the paddock.
# ============================================================================

const BG := Color("#101216")

func _ready() -> void:
	if Season.active == null:
		get_tree().change_scene_to_file("res://main.tscn")
		return
	_rebuild()

func _rebuild() -> void:
	for ch in get_children():
		ch.queue_free()
	var bg := ColorRect.new()
	bg.color = BG
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(bg)
	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 26)
	add_child(margin)
	var outer := VBoxContainer.new()
	outer.add_theme_constant_override("separation", 10)
	margin.add_child(outer)
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	outer.add_child(scroll)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 6)
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(col)

	var s := Season.active
	col.add_child(_label("СТАТИСТИКА СЕЗОНА — %s, этап %d/%d" % [
		s.team_name, mini(s.round_index + 1, s.total_rounds()), s.total_rounds()], 26, "#ff2e43"))

	var grid := F1_2026.race_grid(s.player_team)

	# Constructors' championship
	col.add_child(_label("КУБОК КОНСТРУКТОРОВ", 19, "#ffffff"))
	var cons := {}
	var ccolor := {}
	var ccar := {}
	for i in grid.size():
		var tn := String(grid[i]["team_name"])
		cons[tn] = int(cons.get(tn, 0)) + int(s.standings.get(i, 0))
		ccolor[tn] = String(grid[i]["color"])
		ccar[tn] = grid[i]["car"]
	var carr: Array = []
	for tn in cons:
		carr.append({"name": tn, "pts": int(cons[tn]), "color": String(ccolor[tn]), "car": ccar[tn]})
	carr.sort_custom(func(a, b): return a["pts"] > b["pts"])
	for i in carr.size():
		var c: Dictionary = carr[i]
		var car: Dictionary = c["car"]
		col.add_child(_label("P%d  %s — %d очк.   [ДВС %s · мощн %s · аэро %s · надёж %s]" % [
			i + 1, c["name"], int(c["pts"]), String(car.get("pu", "?")),
			_cs(float(car["power"])), _cs(float(car["aero"])), _cs(float(car["rel"]))],
			15, String(c["color"])))

	# Drivers' championship
	col.add_child(_label("ЧЕМПИОНАТ ПИЛОТОВ", 19, "#ffffff"))
	var ds := s.standings_sorted()
	for i in ds.size():
		var d: Dictionary = ds[i]
		var st := s.stat_of(int(d["id"]))
		var line := "P%d  %s — %d очк.   (поб %d · под %d · обг %d)" % [
			i + 1, String(d["name"]), int(d["points"]),
			int(st["wins"]), int(st["podiums"]), int(st["overtakes"])]
		var dcol := "#cfd6e0"
		if int(d["id"]) < grid.size():
			dcol = String(grid[int(d["id"])]["color"])
		col.add_child(_label(line, 14, dcol))

	# Season leaders
	col.add_child(_label("ЛИДЕРЫ СЕЗОНА", 19, "#ffffff"))
	for spec in [["wins", "Побед"], ["podiums", "Подиумов"], ["poles", "Поулов"],
			["fl", "Быстрых кругов"], ["overtakes", "Обгонов"], ["gained", "Отыграно мест"]]:
		var ld := s.stats_leader(String(spec[0]))
		if not ld.is_empty() and int(ld["val"]) > 0:
			col.add_child(_label("%s: %s (%d)" % [String(spec[1]), String(ld["name"]), int(ld["val"])],
				14, "#66c2ff"))

	# pinned back bar
	var bar := HBoxContainer.new()
	outer.add_child(bar)
	var back := _button("← В паддок", 16)
	back.pressed.connect(func(): get_tree().change_scene_to_file("res://season_hub.tscn"))
	bar.add_child(back)
	var pilots := _button("Пилоты", 16)
	pilots.pressed.connect(func(): get_tree().change_scene_to_file("res://driver_profile.tscn"))
	bar.add_child(pilots)

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
	b.custom_minimum_size = Vector2(150, 38)
	return b

# Map a 0..1 car rating (≈0.6..0.95 in practice) to 1..5 stars.
func _cs(v: float) -> String:
	var n: int = clampi(int(round((v - 0.55) / 0.085)), 1, 5)
	return "★".repeat(n) + "☆".repeat(5 - n)
