# design_system.gd — shared visual tokens, spacing, fonts and style helpers
# Usage: access constants directly (DesignSystem.BG_PRIMARY),
#        call DesignSystem.setup_fonts() once from main.gd _ready(),
#        call DesignSystem._sb() to build StyleBoxFlat values.
class_name DesignSystem

# ── Colour tokens ────────────────────────────────────────────────────────────
const BG_PRIMARY := Color("#0e0e1a")
const BG_CARD    := Color("#0c0c18")
const BG_RAISED  := Color("#12121f")
const BORDER     := Color("#1e1e2e")
const GOLD       := Color("#f5c518")
const PURPLE     := Color("#b15de8")
const GREEN      := Color("#4ade80")
const RED        := Color("#e8002d")
const BLUE       := Color("#3b82f6")
const AMBER      := Color("#f59e0b")
const TEXT_1     := Color("#ffffff")
const TEXT_2     := Color("#cccccc")
const TEXT_3     := Color("#666666")

# ── Spacing ──────────────────────────────────────────────────────────────────
const SP_XS  := 4;  const SP_SM  := 8;  const SP_MD  := 12
const SP_LG  := 16; const SP_XL  := 24; const SP_XXL := 32

# ── Fonts (load once via setup_fonts()) ──────────────────────────────────────
static var mono_font: Font = null

static func setup_fonts() -> void:
	var path := "res://assets/fonts/JetBrainsMono-Regular.ttf"
	if ResourceLoader.exists(path, "FontFile"):
		mono_font = load(path)

# ── StyleBox helper ───────────────────────────────────────────────────────────
static func _sb(bg: Color, border: Color, radius: int = 4) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.border_color = border
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(radius)
	return sb

# ── make_team_stripe ─────────────────────────────────────────────────────────
static func make_team_stripe(color: Color) -> ColorRect:
	var cr := ColorRect.new()
	cr.color = color
	cr.custom_minimum_size = Vector2(3.0, 0.0)
	cr.size_flags_vertical = Control.SIZE_EXPAND_FILL
	return cr

# ── make_section_header ──────────────────────────────────────────────────────
static func make_section_header(title: String) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", SP_SM)
	var lbl := Label.new()
	lbl.text = title
	lbl.add_theme_color_override("font_color", TEXT_3)
	lbl.add_theme_font_size_override("font_size", 10)
	row.add_child(lbl)
	var sep := HSeparator.new()
	sep.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sep.add_theme_color_override("color", BORDER)
	row.add_child(sep)
	return row

# ── make_badge ───────────────────────────────────────────────────────────────
static func make_badge(text: String, color: Color) -> PanelContainer:
	var panel := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(color.r, color.g, color.b, 0.12)
	sb.border_color = Color(color.r, color.g, color.b, 0.50)
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(10)
	sb.content_margin_left  = 10.0
	sb.content_margin_right = 10.0
	sb.content_margin_top   = 3.0
	sb.content_margin_bottom = 3.0
	panel.add_theme_stylebox_override("panel", sb)
	var lbl := Label.new()
	lbl.text = text
	lbl.add_theme_color_override("font_color", color)
	lbl.add_theme_font_size_override("font_size", 10)
	panel.add_child(lbl)
	return panel

# ── make_button ──────────────────────────────────────────────────────────────
# Returns a Button node with custom StyleBoxes for normal/hover/pressed.
# style: "primary" (gold) | "secondary" (outline) | "danger" (red)
static func make_button(text: String, style: String = "primary") -> Button:
	var btn := Button.new()
	btn.text = text
	btn.custom_minimum_size = Vector2(0.0, 34.0)
	btn.add_theme_font_size_override("font_size", 11)

	var lbl_color: Color
	var sb_n: StyleBoxFlat
	var sb_h: StyleBoxFlat
	var sb_p: StyleBoxFlat

	match style:
		"primary":
			lbl_color = GOLD
			sb_n = _sb(BG_RAISED, Color(GOLD.r, GOLD.g, GOLD.b, 0.70))
			sb_h = _sb(Color(GOLD.r, GOLD.g, GOLD.b, 0.12), Color(GOLD.r, GOLD.g, GOLD.b, 0.90))
			sb_p = _sb(Color(GOLD.r, GOLD.g, GOLD.b, 0.06), Color(GOLD.r, GOLD.g, GOLD.b, 0.50))
		"danger":
			lbl_color = RED
			sb_n = _sb(Color(0.0, 0.0, 0.0, 0.00), Color(RED.r, RED.g, RED.b, 0.60))
			sb_h = _sb(Color(RED.r, RED.g, RED.b, 0.10), Color(RED.r, RED.g, RED.b, 0.80))
			sb_p = _sb(Color(RED.r, RED.g, RED.b, 0.06), Color(RED.r, RED.g, RED.b, 0.40))
		_:  # secondary
			lbl_color = TEXT_2
			sb_n = _sb(Color(0.0, 0.0, 0.0, 0.00), BORDER)
			sb_h = _sb(Color(1.0, 1.0, 1.0, 0.05), BORDER)
			sb_p = _sb(Color(0.0, 0.0, 0.0, 0.00), BORDER)

	btn.add_theme_stylebox_override("normal",  sb_n)
	btn.add_theme_stylebox_override("hover",   sb_h)
	btn.add_theme_stylebox_override("pressed", sb_p)
	btn.add_theme_color_override("font_color",         lbl_color)
	btn.add_theme_color_override("font_hover_color",   lbl_color)
	btn.add_theme_color_override("font_pressed_color", lbl_color)
	btn.add_theme_color_override("font_focus_color",   lbl_color)
	return btn

# ── make_progress_bar ────────────────────────────────────────────────────────
# Returns a VBox: key row (label + pct) + ProgressBar (height 5 px).
# Caller updates pb.value per tick — get it via returned dict "pb" key.
static func make_progress_bar(
		label_text: String, value: float, max_val: float, color: Color) -> Dictionary:
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 3)

	var row := HBoxContainer.new()
	col.add_child(row)

	var key_lbl := Label.new()
	key_lbl.text = label_text
	key_lbl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	key_lbl.add_theme_color_override("font_color", TEXT_3)
	key_lbl.add_theme_font_size_override("font_size", 9)
	row.add_child(key_lbl)

	var safe_max: float = max_val if max_val > 0.0 else 1.0
	var pct: int = int(value / safe_max * 100.0)
	var val_lbl := Label.new()
	val_lbl.text = "%d%%" % pct
	val_lbl.add_theme_color_override("font_color", TEXT_3)
	val_lbl.add_theme_font_size_override("font_size", 9)
	if mono_font != null:
		val_lbl.add_theme_font_override("font", mono_font)
	row.add_child(val_lbl)

	var pb := ProgressBar.new()
	pb.custom_minimum_size = Vector2(0.0, 5.0)
	pb.max_value = safe_max
	pb.value = value
	pb.show_percentage = false
	var fill_sb := StyleBoxFlat.new()
	fill_sb.bg_color = color
	fill_sb.set_corner_radius_all(3)
	var bg_sb := StyleBoxFlat.new()
	bg_sb.bg_color = BORDER
	bg_sb.set_corner_radius_all(3)
	pb.add_theme_stylebox_override("fill", fill_sb)
	pb.add_theme_stylebox_override("background", bg_sb)
	col.add_child(pb)

	return {"node": col, "pb": pb, "val_lbl": val_lbl}

# ── make_stat_label ──────────────────────────────────────────────────────────
# Returns a PanelContainer: small key label above large mono value.
static func make_stat_label(
		key: String, value: String, value_color: Color = TEXT_1) -> PanelContainer:
	var panel := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = BG_RAISED
	sb.set_corner_radius_all(4)
	sb.content_margin_left   = float(SP_SM)
	sb.content_margin_right  = float(SP_SM)
	sb.content_margin_top    = float(SP_SM)
	sb.content_margin_bottom = float(SP_SM)
	panel.add_theme_stylebox_override("panel", sb)

	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 4)
	panel.add_child(col)

	var key_lbl := Label.new()
	key_lbl.text = key.to_upper()
	key_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	key_lbl.add_theme_color_override("font_color", TEXT_3)
	key_lbl.add_theme_font_size_override("font_size", 9)
	col.add_child(key_lbl)

	var val_lbl := Label.new()
	val_lbl.text = value
	val_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	val_lbl.add_theme_color_override("font_color", value_color)
	val_lbl.add_theme_font_size_override("font_size", 15)
	if mono_font != null:
		val_lbl.add_theme_font_override("font", mono_font)
	col.add_child(val_lbl)

	return panel

# ── make_card ────────────────────────────────────────────────────────────────
# Dark panel with optional titled header row.
# Returns PanelContainer; content is placed inside a MarginContainer (SP_MD).
static func make_card(title: String, content: Control) -> PanelContainer:
	var panel := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = BG_CARD
	sb.border_color = BORDER
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(6)
	panel.add_theme_stylebox_override("panel", sb)

	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 0)
	panel.add_child(col)

	if title != "":
		var header := PanelContainer.new()
		var hdr_sb := StyleBoxFlat.new()
		hdr_sb.bg_color = Color(0.0, 0.0, 0.0, 0.0)
		hdr_sb.border_color = BORDER
		hdr_sb.border_width_bottom = 1
		hdr_sb.content_margin_left   = float(SP_MD)
		hdr_sb.content_margin_right  = float(SP_MD)
		hdr_sb.content_margin_top    = float(SP_SM)
		hdr_sb.content_margin_bottom = float(SP_SM)
		header.custom_minimum_size = Vector2(0.0, 34.0)
		header.add_theme_stylebox_override("panel", hdr_sb)
		var hdr_lbl := Label.new()
		hdr_lbl.text = title
		hdr_lbl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		hdr_lbl.add_theme_color_override("font_color", TEXT_2)
		hdr_lbl.add_theme_font_size_override("font_size", 12)
		header.add_child(hdr_lbl)
		col.add_child(header)

	var wrap := MarginContainer.new()
	for side: String in ["left", "right", "top", "bottom"]:
		wrap.add_theme_constant_override("margin_" + side, SP_MD)
	wrap.add_child(content)
	col.add_child(wrap)

	return panel

# ── make_data_row ─────────────────────────────────────────────────────────────
# Horizontal row (height 28 px) for leaderboard / stat rows.
# cols: Array of { "text": String, "width": int, "color": Color, "mono": bool }
# Returns { "node": PanelContainer, "cells": Array } — caller updates cells[i].text per tick.
static func make_data_row(cols: Array) -> Dictionary:
	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(0.0, 28.0)
	var sb := StyleBoxFlat.new()
	sb.bg_color = BG_RAISED
	sb.set_corner_radius_all(3)
	sb.content_margin_top    = 0.0
	sb.content_margin_bottom = 0.0
	sb.content_margin_left   = 0.0
	sb.content_margin_right  = 0.0
	panel.add_theme_stylebox_override("panel", sb)

	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 0)
	panel.add_child(row)

	var cells: Array = []
	for col_data: Dictionary in cols:
		var lbl := Label.new()
		lbl.text = col_data.get("text", "")
		var w: int = col_data.get("width", 0)
		if w > 0:
			lbl.custom_minimum_size = Vector2(float(w), 0.0)
		var col_color: Color = col_data.get("color", TEXT_1)
		lbl.add_theme_color_override("font_color", col_color)
		lbl.add_theme_font_size_override("font_size", 11)
		lbl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		var is_mono: bool = col_data.get("mono", false)
		if is_mono and mono_font != null:
			lbl.add_theme_font_override("font", mono_font)
		row.add_child(lbl)
		cells.append(lbl)

	return {"node": panel, "cells": cells}
