extends Control

# ============================================================================
# Apex Duo — driver profile & scouting screen. Your two drivers show exact
# attributes; rivals show only a scout's star rating (FM-style fog). Attributes
# are regenerated deterministically (same seed as make_field) so they match the
# numbers the race actually uses.
# ============================================================================

const BG := Color("#101216")
const PANEL := Color("#1b2027")
const ATTR_RU := {
	"pace": "Темп", "overtaking": "Обгон", "defending": "Защита", "tyre": "Шины",
	"energy": "Энергия", "race_iq": "Расчёт", "composure": "Хладнокровие",
	"consistency": "Стабильность", "aggression": "Агрессия", "discipline": "Дисциплина",
	"wet": "Дождь", "starts": "Старт"}

func _ready() -> void:
	if Season.active == null:
		get_tree().change_scene_to_file("res://main.tscn")
		return
	_rebuild()

func _stars(v: float) -> String:
	var n := clampi(int(round(v / 4.0)), 1, 5)
	return "★".repeat(n) + "☆".repeat(5 - n)

func _ca(attrs: Dictionary) -> float:
	var s := 0.0
	var c := 0
	for k in attrs:
		s += float(attrs[k])
		c += 1
	return s / float(maxi(1, c))

func _rebuild() -> void:
	for ch in get_children():
		ch.queue_free()
	var bg := ColorRect.new()
	bg.color = BG
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(bg)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 8)
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var scroll := ScrollContainer.new()
	scroll.add_child(col)
	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 26)
	margin.add_child(scroll)
	add_child(margin)

	col.add_child(_label("ПИЛОТЫ — ПРОФИЛЬ И СКАУТИНГ", 28, "#ff2e43"))
	col.add_child(_label("Свои пилоты — точные атрибуты. Соперники — оценка скаутов (звёзды).",
		14, "#7e8a9c"))

	var grid := F1_2026.race_grid(Season.active.player_team)
	# your two drivers in full detail
	for i in grid.size():
		var g: Dictionary = grid[i]
		if bool(g.get("team", false)):
			_driver_card(col, i, g)

	col.add_child(_label("СКАУТИНГ — ВЕСЬ ГРИД (общая оценка)", 18, "#ffffff"))
	for i in grid.size():
		var g: Dictionary = grid[i]
		var attrs := RaceSim.gen_attributes(float(g["skill"]), i * 2654435761)
		col.add_child(_label("%s — %s" % [String(g["name"]), _stars(_ca(attrs))],
			14, String(g.get("color", "#cfd6e0"))))

	var back := Button.new()
	back.text = "← В паддок"
	back.add_theme_font_size_override("font_size", 16)
	back.custom_minimum_size = Vector2(160, 38)
	back.pressed.connect(func(): get_tree().change_scene_to_file("res://season_hub.tscn"))
	col.add_child(back)

func _driver_card(col: VBoxContainer, i: int, g: Dictionary) -> void:
	var attrs := RaceSim.gen_attributes(float(g["skill"]), i * 2654435761)
	var pc := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = PANEL
	sb.set_corner_radius_all(10)
	sb.set_content_margin_all(12)
	pc.add_theme_stylebox_override("panel", sb)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 4)
	pc.add_child(v)
	var role := "Директор · P5" if i == 4 else "Инженер · P6"
	v.add_child(_label("%s — %s — Общий %s" % [role, String(g["name"]), _stars(_ca(attrs))],
		19, String(g.get("color", "#ffd166"))))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 24)
	v.add_child(row)
	var ca := VBoxContainer.new()
	var cb := VBoxContainer.new()
	row.add_child(ca)
	row.add_child(cb)
	var idx := 0
	for k in RaceSim.ATTR_KEYS:
		var ru: String = ATTR_RU.get(k, k)
		var av := float(attrs.get(k, 13))
		var line := "%s: %d  %s" % [ru, int(av), _stars(av)]
		var target := ca if idx % 2 == 0 else cb
		target.add_child(_label(line, 14, "#cfd6e0"))
		idx += 1
	col.add_child(pc)

func _label(txt: String, sz: int, col: String) -> Label:
	var l := Label.new()
	l.text = txt
	l.add_theme_font_size_override("font_size", sz)
	l.add_theme_color_override("font_color", Color(col))
	return l
