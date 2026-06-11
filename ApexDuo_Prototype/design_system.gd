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
	mono_font = load("res://assets/fonts/JetBrainsMono-Regular.ttf")

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
