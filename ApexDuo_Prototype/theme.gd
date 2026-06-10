class_name Palette

# ============================================================================
# Apex Duo — единый источник стиля (Stage 0 / Stage 1).
# Все цвета §2 VISUAL_STYLE.md. Хелперы для StyleBoxFlat, тайров и семантики.
# Синхронизировать с docs/VISUAL_STYLE.md при изменениях.
# ============================================================================

# --- 2.1 Поверхности ---
const BG      := Color("#0C0C0D")
const BG2     := Color("#101011")
const PANEL   := Color("#141416")
const PANEL2  := Color("#1A1A1C")
const DIV     := Color("#28282C")
const HAIR    := Color("#202023")

# --- 2.2 Золото / акцент ---
const GOLD    := Color("#C9A227")
const GOLD_D  := Color("#7E6A22")

# --- 2.3 Текст ---
const CREAM   := Color("#E7E3D8")
const MUTED   := Color("#8C8A82")
const FINE    := Color("#5C5A54")

# Hex-string варианты для мест, где требуется String (BBCode, _mklabel, _label, _cell)
const BG_HEX      := "#0C0C0D"
const BG2_HEX     := "#101011"
const PANEL_HEX   := "#141416"
const PANEL2_HEX  := "#1A1A1C"
const DIV_HEX     := "#28282C"
const HAIR_HEX    := "#202023"
const GOLD_HEX    := "#C9A227"
const GOLD_D_HEX  := "#7E6A22"
const CREAM_HEX   := "#E7E3D8"
const MUTED_HEX   := "#8C8A82"
const FINE_HEX    := "#5C5A54"

# --- 2.4 Команды игрока ---
const P5   := Color("#C9A227")   # золото — P5
const P6   := Color("#6E97A6")   # сине-стальной — P6
const WINE := Color("#9A3B33")   # приглушённое вино — критичные действия

const P5_HEX   := "#C9A227"
const P6_HEX   := "#6E97A6"
const WINE_HEX := "#9A3B33"

# --- 2.5 Семантические ---
const GOOD := Color("#5E9467")
const WARN := Color("#BE9638")
const DANG := Color("#B0473D")
const INFO := Color("#6E97A6")
const PURP := Color("#8E6FA0")

const GOOD_HEX := "#5E9467"
const WARN_HEX := "#BE9638"
const DANG_HEX := "#B0473D"
const INFO_HEX := "#6E97A6"
const PURP_HEX := "#8E6FA0"

# --- 2.6 Шины ---
const TYRE_SOFT   := Color("#C24A44")
const TYRE_MEDIUM := Color("#C9A24A")
const TYRE_HARD   := Color("#D8D4CC")
const TYRE_INTER  := Color("#4E9560")
const TYRE_WET    := Color("#3F6FA8")

const TYRE_SOFT_HEX   := "#C24A44"
const TYRE_MEDIUM_HEX := "#C9A24A"
const TYRE_HARD_HEX   := "#D8D4CC"
const TYRE_INTER_HEX  := "#4E9560"
const TYRE_WET_HEX    := "#3F6FA8"

# ============================================================================
# Шрифты §3 — Oswald (дисплей/капс/числа) + Jost (тело). Оба с кириллицей.
# Variable-fonts: вес пиним через FontVariation, чтобы не зависеть от дефолта.
# ============================================================================
const _OSWALD := preload("res://fonts/Oswald.ttf")
const _JOST   := preload("res://fonts/Jost.ttf")

# Пост-слой §6 — шейдер виньетки (только затемнение краёв, без сепия-грейда).
# Не читает SCREEN_TEXTURE (совместимо с gl_compatibility). См. vignette_layer().
const _VIGNETTE_SHADER := """shader_type canvas_item;
uniform float strength : hint_range(0.0, 1.0) = 0.30;
uniform float inner : hint_range(0.0, 1.0) = 0.55;
void fragment() {
	vec2 d = UV - vec2(0.5);
	float r = length(d) * 1.41421356;
	float v = smoothstep(inner, 1.0, r);
	COLOR = vec4(0.0, 0.0, 0.0, v * strength);
}"""

# Тело/данные — Jost (по умолчанию Regular).
static func body_font(weight: int = 400) -> FontVariation:
	var fv := FontVariation.new()
	fv.base_font = _JOST
	fv.variation_opentype = {"wght": float(weight)}
	return fv

# Дисплей/заголовки/числа — Oswald, капс-вид. tracking = межбуквенный интервал (px).
static func display_font(weight: int = 600, tracking: int = 0) -> FontVariation:
	var fv := FontVariation.new()
	fv.base_font = _OSWALD
	fv.variation_opentype = {"wght": float(weight)}
	if tracking != 0:
		fv.set_spacing(TextServer.SPACING_GLYPH, tracking)
	return fv

# Базовая тема: Jost как дефолтный шрифт всего дерева Control. Назначать на корень.
static func base_theme() -> Theme:
	var t := Theme.new()
	t.default_font = body_font(400)
	t.default_font_size = 14
	return t

# Полноэкранный слой-виньетка (§6). mouse_filter=IGNORE, чтобы не перехватывать
# ввод; центр кадра прозрачный. Добавлять на корень сцены: add_child(Palette.vignette_layer()).
static func vignette_layer(strength: float = 0.30) -> CanvasLayer:
	var cl := CanvasLayer.new()
	cl.layer = 100
	var cr := ColorRect.new()
	cr.set_anchors_preset(Control.PRESET_FULL_RECT)
	cr.mouse_filter = Control.MOUSE_FILTER_IGNORE
	cr.color = Color(0, 0, 0, 0)
	var sh := Shader.new()
	sh.code = _VIGNETTE_SHADER
	var mat := ShaderMaterial.new()
	mat.shader = sh
	mat.set_shader_parameter("strength", strength)
	cr.material = mat
	cl.add_child(cr)
	return cl

# ============================================================================
# Хелперы
# ============================================================================

# Базовая панель §4: PANEL bg, скругление 2px, граница 1px DIV, отступы 14.
static func panel() -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = PANEL
	sb.set_corner_radius_all(2)
	sb.set_border_width_all(1)
	sb.border_color = DIV
	sb.set_content_margin_all(14)
	return sb

# Плоский бар: rx=0, hairline-обводка, залить цветом заливки (семантика).
static func bar_fill(fill_col: Color) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = fill_col
	sb.set_corner_radius_all(0)
	sb.set_border_width_all(1)
	sb.border_color = HAIR
	return sb

# Фоновая «желобина» бара: почти-чёрный, rx=0.
static func bar_bg() -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color("#0F0F10")
	sb.set_corner_radius_all(0)
	sb.set_border_width_all(1)
	sb.border_color = HAIR
	return sb

# Цвет шины по строке-ключу компаунда.
static func tire_color(c: String) -> Color:
	match c:
		"soft":   return TYRE_SOFT
		"medium": return TYRE_MEDIUM
		"hard":   return TYRE_HARD
		"inter":  return TYRE_INTER
		"wet":    return TYRE_WET
	return CREAM

# Hex-строка цвета шины (для BBCode / _label / _cell).
static func tire_color_hex(c: String) -> String:
	match c:
		"soft":   return TYRE_SOFT_HEX
		"medium": return TYRE_MEDIUM_HEX
		"hard":   return TYRE_HARD_HEX
		"inter":  return TYRE_INTER_HEX
		"wet":    return TYRE_WET_HEX
	return CREAM_HEX

# Семантический цвет износа шин (0..120, «worn» = выше = хуже).
static func wear_color(w: float) -> Color:
	if w < 50.0:
		return GOOD
	if w < 78.0:
		return WARN
	return DANG

# Семантический цвет SoC (с учётом clipping).
static func soc_color(clipped: bool, soc: float) -> Color:
	if clipped:
		return DANG
	if soc < 20.0:
		return DANG
	if soc < 45.0:
		return WARN
	return GOOD
