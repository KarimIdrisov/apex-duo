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
