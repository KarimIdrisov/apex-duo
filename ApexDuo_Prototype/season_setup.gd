extends Control

# ============================================================================
# Apex Duo — new-season setup. Pick any of the 11 real 2026 teams, difficulty,
# and co-op mode. Builds a configured Season and hands off to the paddock hub.
# ============================================================================

const _LOGO_SLUGS := {
	"McLaren": "mclaren", "Mercedes": "mercedes", "Red Bull Racing": "red_bull",
	"Ferrari": "ferrari", "Williams": "williams", "Aston Martin": "aston_martin",
	"Alpine": "alpine", "Racing Bulls": "racing_bulls", "Haas": "haas",
	"Audi": "audi", "Cadillac": "cadillac",
}
const _ABBREVS := {
	"McLaren": "MCL", "Mercedes": "MER", "Red Bull Racing": "RBR",
	"Ferrari": "FER", "Williams": "WIL", "Aston Martin": "AMR",
	"Alpine": "ALP", "Racing Bulls": "RB", "Haas": "HAA",
	"Audi": "AUD", "Cadillac": "CAD",
}

# Default: Williams (rank 4) — mid-grid, good learning experience.
var sel_team := 4
var sel_diff := 1
var sel_coop := false

func _ready() -> void:
	_rebuild()

func _rebuild() -> void:
	for c in get_children():
		c.queue_free()

	var bg := ColorRect.new()
	bg.color = DesignSystem.BG_PRIMARY
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(bg)

	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for side: String in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, DesignSystem.SP_XL)
	add_child(margin)

	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", DesignSystem.SP_LG)
	margin.add_child(col)

	# ── Header ──
	var hdr := Label.new()
	hdr.text = "НОВЫЙ СЕЗОН"
	hdr.add_theme_font_size_override("font_size", 22)
	hdr.add_theme_color_override("font_color", DesignSystem.TEXT_1)
	col.add_child(hdr)

	# ── Step indicator ──
	col.add_child(DesignSystem.make_section_header("ШАГ 1 — ВЫБЕРИТЕ КОМАНДУ"))

	# ── Team grid ──
	var grid := GridContainer.new()
	grid.columns = 4
	grid.add_theme_constant_override("h_separation", DesignSystem.SP_SM)
	grid.add_theme_constant_override("v_separation", DesignSystem.SP_SM)
	col.add_child(grid)

	var teams: Array = F1_2026.TEAMS
	for i: int in range(teams.size()):
		var team: Dictionary = teams[i]
		var tile := _make_team_tile(i, team)
		grid.add_child(tile)

	col.add_child(DesignSystem.make_section_header("СЛОЖНОСТЬ"))

	# ── Difficulty row ──
	var diff_row := HBoxContainer.new()
	diff_row.add_theme_constant_override("separation", DesignSystem.SP_SM)
	col.add_child(diff_row)
	var diff_labels: Array = ["Лёгкая", "Средняя", "Сложная"]
	for d: int in range(diff_labels.size()):
		var d_style: String = "primary" if d == sel_diff else "secondary"
		var db: Button = DesignSystem.make_button(diff_labels[d], d_style)
		db.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var d_cap := d
		db.pressed.connect(func():
			sel_diff = d_cap
			_rebuild()
		)
		diff_row.add_child(db)

	# ── Footer ──
	var footer := HBoxContainer.new()
	footer.alignment = BoxContainer.ALIGNMENT_END
	col.add_child(footer)
	var next_btn: Button = DesignSystem.make_button("ДАЛЕЕ →", "primary")
	next_btn.custom_minimum_size = Vector2(160.0, 40.0)
	next_btn.pressed.connect(_on_start)
	footer.add_child(next_btn)


func _make_team_tile(idx: int, team: Dictionary) -> PanelContainer:
	var selected: bool = idx == sel_team
	var t_color: Color = Color(team.get("color", "#888888"))

	var panel := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(t_color.r, t_color.g, t_color.b, 0.08) if selected else DesignSystem.BG_CARD
	sb.border_color = Color(t_color.r, t_color.g, t_color.b, 0.6) if selected else DesignSystem.BORDER
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(5)
	sb.content_margin_top    = float(DesignSystem.SP_SM)
	sb.content_margin_bottom = float(DesignSystem.SP_SM)
	sb.content_margin_left   = float(DesignSystem.SP_SM)
	sb.content_margin_right  = float(DesignSystem.SP_SM)
	panel.add_theme_stylebox_override("panel", sb)
	panel.custom_minimum_size = Vector2(0.0, 72.0)

	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", DesignSystem.SP_XS)
	panel.add_child(col)

	var logo_rect := TextureRect.new()
	logo_rect.custom_minimum_size = Vector2(0.0, 28.0)
	logo_rect.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	logo_rect.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var logo_path: String = "res://assets/teams/" + _team_logo_slug(team.get("name", "")) + ".png"
	if ResourceLoader.exists(logo_path):
		logo_rect.texture = load(logo_path)
	col.add_child(logo_rect)

	var abbrev_lbl := Label.new()
	abbrev_lbl.text = _team_abbrev(team.get("name", "???"))
	abbrev_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	abbrev_lbl.add_theme_color_override("font_color", t_color if selected else DesignSystem.TEXT_3)
	abbrev_lbl.add_theme_font_size_override("font_size", 10)
	col.add_child(abbrev_lbl)

	if selected:
		var dot := Panel.new()
		dot.custom_minimum_size = Vector2(6.0, 6.0)
		var dot_sb := StyleBoxFlat.new()
		dot_sb.bg_color = DesignSystem.GOLD
		dot_sb.set_corner_radius_all(3)
		dot.add_theme_stylebox_override("panel", dot_sb)
		col.add_child(dot)

	var i_cap := idx
	panel.gui_input.connect(func(event: InputEvent):
		if event is InputEventMouseButton and (event as InputEventMouseButton).pressed:
			sel_team = i_cap
			_rebuild()
	)
	return panel


func _team_logo_slug(name: String) -> String:
	return _LOGO_SLUGS.get(name, "mclaren")


func _team_abbrev(name: String) -> String:
	return _ABBREVS.get(name, "???")


func _on_start() -> void:
	var s := Season.new()
	var is_online_host: bool = Net.role() == "host"
	s.configure(sel_team, sel_diff, sel_coop or is_online_host)
	Season.active = s
	get_tree().change_scene_to_file("res://season_hub.tscn")
