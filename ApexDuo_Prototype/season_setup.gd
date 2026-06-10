extends Control

# ============================================================================
# Apex Duo — new-season setup. Pick team (career identity), difficulty, mode.
# Builds a configured Season and hands off to the paddock hub.
# ============================================================================

const BG := Color("#14161a")
const PANEL := Color("#1f242b")
const MUTED := "#9aa4b2"

var sel_team := 1
var sel_diff := 1
var sel_coop := false

func _ready() -> void:
	_rebuild()

func _rebuild() -> void:
	for c in get_children():
		c.queue_free()

	var bg := ColorRect.new()
	bg.color = BG
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(bg)

	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 10)
	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 30)
	margin.add_child(col)
	add_child(margin)

	col.add_child(_label("НОВЫЙ СЕЗОН — НАСТРОЙКА", 30, "#c8102e"))

	# --- team ---
	col.add_child(_label("Команда (карьерный старт):", 18, "#ffffff"))
	var trow := HBoxContainer.new()
	trow.add_theme_constant_override("separation", 8)
	col.add_child(trow)
	for i in Season.TEAM_TIERS.size():
		trow.add_child(_team_card(i))

	# --- difficulty ---
	col.add_child(_label("Сложность (сила соперников):", 18, "#ffffff"))
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
	col.add_child(_label("Режим:", 18, "#ffffff"))
	var mrow := HBoxContainer.new()
	mrow.add_theme_constant_override("separation", 8)
	col.add_child(mrow)
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

	# --- actions --- (flexible spacer pins the action bar to the bottom)
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

func _team_card(i: int) -> Control:
	var t: Dictionary = Season.TEAM_TIERS[i]
	var pc := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = PANEL
	sb.set_corner_radius_all(10)
	sb.set_content_margin_all(12)
	if i == sel_team:
		sb.set_border_width_all(3)
		sb.border_color = Color("#c8102e")
	pc.add_theme_stylebox_override("panel", sb)
	pc.size_flags_horizontal = Control.SIZE_EXPAND_FILL

	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 6)
	v.add_child(_label(String(t["name"]), 20, "#ffd166"))
	var desc := _label(String(t["desc"]), 14, MUTED)
	desc.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(desc)
	v.add_child(_label("Бюджет: $%d млн · R&D: %d" % [
		int(t["money"]) / 1000000, int(t["rp"])], 13, "#5dd17a"))
	v.add_child(_label("Цель: %s" % String(t["goal"]), 13, "#66c2ff"))
	var pick := _button("Выбрать" if i != sel_team else "✔ Выбрано", 14)
	pick.pressed.connect(func(): sel_team = i; _rebuild())
	v.add_child(pick)
	pc.add_child(v)
	return pc

func _on_start() -> void:
	var s := Season.new()
	s.configure(sel_team, sel_diff, sel_coop)
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
