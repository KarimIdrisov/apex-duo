class_name DriverPortrait
extends Control

# ============================================================================
# Apex Duo — процедурный портрет-плейсхолдер (формальный, §5 VISUAL_STYLE.md).
# Серый силуэт «голова+плечи» + инициалы в тонкой рамке с командной baseline.
# Заменить на PNG-арт позже. Никаких свечений — сдержанно.
# ============================================================================

var _initials := ""
var _accent: Color = Palette.GOLD

func setup(full_name: String, accent: Color = Palette.GOLD) -> void:
	_initials = _make_initials(full_name)
	_accent = accent
	queue_redraw()

func _make_initials(n: String) -> String:
	var parts := n.strip_edges().split(" ", false)
	var s := ""
	for p in parts:
		if String(p).length() > 0:
			s += String(p).substr(0, 1)
		if s.length() >= 2:
			break
	return s.to_upper()

func _draw() -> void:
	var w := size.x
	var h := size.y
	# panel bg + thin hairline frame
	draw_rect(Rect2(Vector2.ZERO, size), Palette.PANEL2, true)
	draw_rect(Rect2(Vector2.ZERO, size), Palette.DIV, false, 1.0)
	# desaturated grey silhouette: head + shoulders
	var grey := Color("#3A3A3E")
	var cx := w * 0.5
	draw_circle(Vector2(cx, h * 0.40), w * 0.20, grey)
	var sh := PackedVector2Array([
		Vector2(w * 0.16, h), Vector2(w * 0.30, h * 0.62),
		Vector2(w * 0.70, h * 0.62), Vector2(w * 0.84, h)])
	draw_colored_polygon(sh, grey)
	# initials over the silhouette
	if _initials != "":
		var font: Font = Palette.display_font(600, 0)
		var fs := int(maxf(h * 0.20, 14.0))
		var ts := font.get_string_size(_initials, HORIZONTAL_ALIGNMENT_LEFT, -1, fs)
		draw_string(font, Vector2(cx - ts.x * 0.5, h * 0.47), _initials,
			HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Palette.MUTED)
	# one restrained team-colour baseline
	draw_line(Vector2(0.0, h - 1.0), Vector2(w, h - 1.0), _accent, 1.0)
