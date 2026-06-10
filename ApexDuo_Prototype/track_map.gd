class_name TrackMap
extends Control

# ============================================================================
# Apex Duo — large top-down race view. Draws a real (or procedurally smooth)
# circuit and an F1-silhouette per car, rotated to its direction of travel,
# moving SMOOTHLY: car positions are interpolated toward the sim target each
# frame so 0.25s sim ticks don't look jerky. Pure view; main.gd feeds it cars.
#
# Real circuit outlines live in TRACK_SHAPES (normalized, closed). Tracks without
# an authored shape fall back to a smooth procedural loop. Authored shapes are a
# starting point — refine against screenshots.
# ============================================================================

const PAD := 26.0
const EASE := 9.0        # position interpolation speed (higher = snappier)

# Hand-authored circuit outlines (normalized; re-fitted to the view). A few
# iconic layouts to start; everything else uses the procedural fallback.
# static var (not const): constructed Vector2/PackedVector2Array aren't constant
# expressions, so Godot rejects them in a const.
static var TRACK_SHAPES := {
	"Монца": PackedVector2Array([
		Vector2(0.42, 0.98), Vector2(0.42, 0.62), Vector2(0.36, 0.55), Vector2(0.40, 0.50),
		Vector2(0.34, 0.40), Vector2(0.40, 0.22), Vector2(0.52, 0.10), Vector2(0.60, 0.12),
		Vector2(0.62, 0.22), Vector2(0.56, 0.30), Vector2(0.66, 0.40), Vector2(0.80, 0.44),
		Vector2(0.86, 0.56), Vector2(0.80, 0.64), Vector2(0.86, 0.74), Vector2(0.82, 0.90),
		Vector2(0.70, 0.96), Vector2(0.55, 0.92)]),
	"Монако": PackedVector2Array([
		Vector2(0.18, 0.86), Vector2(0.16, 0.60), Vector2(0.24, 0.48), Vector2(0.20, 0.40),
		Vector2(0.30, 0.30), Vector2(0.30, 0.20), Vector2(0.42, 0.14), Vector2(0.52, 0.20),
		Vector2(0.50, 0.32), Vector2(0.62, 0.34), Vector2(0.72, 0.26), Vector2(0.82, 0.34),
		Vector2(0.78, 0.48), Vector2(0.86, 0.58), Vector2(0.80, 0.72), Vector2(0.64, 0.74),
		Vector2(0.58, 0.66), Vector2(0.46, 0.72), Vector2(0.40, 0.86), Vector2(0.28, 0.90)]),
	"Сильверстоун": PackedVector2Array([
		Vector2(0.30, 0.90), Vector2(0.20, 0.74), Vector2(0.26, 0.60), Vector2(0.16, 0.48),
		Vector2(0.24, 0.34), Vector2(0.40, 0.30), Vector2(0.46, 0.18), Vector2(0.58, 0.14),
		Vector2(0.66, 0.22), Vector2(0.60, 0.34), Vector2(0.74, 0.36), Vector2(0.86, 0.30),
		Vector2(0.90, 0.44), Vector2(0.78, 0.54), Vector2(0.84, 0.66), Vector2(0.72, 0.78),
		Vector2(0.56, 0.74), Vector2(0.48, 0.86), Vector2(0.40, 0.94)]),
}

var loop: PackedVector2Array = PackedVector2Array()   # circuit outline, normalized 0..1
var cum: PackedFloat32Array = PackedFloat32Array()    # cumulative arc-length per point
var cars: Array = []
var disp: Dictionary = {}                             # id -> interpolated display frac
var sc_active := false
var pit_lane := 0.05      # current track's pit-lane length (fraction of lap)
var aero_zones := 0       # active-aero / Overtake zones, drawn on the longest straights
var _key := ""

func _ready() -> void:
	resized.connect(queue_redraw)
	set_process(true)

func ensure_built(track_name: String, seed_value: int) -> void:
	if track_name == _key and loop.size() > 0:
		return
	_key = track_name
	disp.clear()
	if TRACK_SHAPES.has(track_name):
		_fit_points(TRACK_SHAPES[track_name])
	else:
		_generate(seed_value)
	queue_redraw()

func set_cars(arr: Array, sc: bool) -> void:
	cars = arr
	sc_active = sc

func _process(delta: float) -> void:
	if cars.is_empty() or loop.size() < 2:
		return
	var f := clampf(delta * EASE, 0.0, 1.0)
	for c in cars:
		var id: int = int(c["id"])
		var tgt: float = float(c["frac"])
		var d: float = disp.get(id, tgt)
		if tgt < d - 0.5:                 # the car wrapped past the line — go forward
			tgt += 1.0
		d = fposmod(lerp(d, tgt, f), 1.0)
		disp[id] = d
	queue_redraw()

# ---------------------------------------------------------------- geometry
func _fit_points(src: PackedVector2Array) -> void:
	var minx := 1.0e9
	var miny := 1.0e9
	var maxx := -1.0e9
	var maxy := -1.0e9
	for p in src:
		minx = minf(minx, p.x); miny = minf(miny, p.y)
		maxx = maxf(maxx, p.x); maxy = maxf(maxy, p.y)
	var w := maxf(maxx - minx, 0.001)
	var h := maxf(maxy - miny, 0.001)
	var ctrl := PackedVector2Array()
	for p in src:
		ctrl.append(Vector2((p.x - minx) / w, (p.y - miny) / h))
	# Smooth the control polygon into a dense Catmull-Rom loop so corners are
	# curved (not faceted) — fixes both the drawn outline AND car motion (which
	# follows `loop`). Sparse authored shapes get many subdivisions; the already
	# dense procedural loop gets ~1.
	var sub: int = maxi(1, int(round(240.0 / maxf(1.0, float(ctrl.size())))))
	loop = _smooth_closed(ctrl, sub)
	_rotate_to_straight()    # put the start/finish (frac 0) + pit lane on a straight
	_build_cum()

func _generate(seed_value: int) -> void:
	var r := RaceSim.RNG.new(RaceSim.mix32(seed_value))
	var harm: Array = []
	for i in 3:
		harm.append([2 + int(r.next_u32() % 4), r.rangef(0.06, 0.18), r.rangef(0.0, TAU)])
	var n := 200
	var raw: Array = []
	for i in n:
		var th := TAU * float(i) / float(n)
		var rad := 1.0
		for h in harm:
			rad += float(h[1]) * sin(float(h[0]) * th + float(h[2]))
		raw.append(Vector2(cos(th), sin(th)) * rad)
	var fit := PackedVector2Array()
	for p in raw:
		fit.append(p)
	_fit_points(fit)

func _build_cum() -> void:
	cum = PackedFloat32Array()
	var lens: Array = []
	var total := 0.0
	var cnt := loop.size()
	for i in cnt:
		var d := loop[i].distance_to(loop[(i + 1) % cnt])
		lens.append(d)
		total += d
	total = maxf(total, 0.001)
	var acc := 0.0
	for i in cnt:
		cum.append(acc / total)
		acc += float(lens[i])

# Catmull-Rom smoothing of a closed control polygon → dense smooth loop.
static func _smooth_closed(src: PackedVector2Array, subdiv: int) -> PackedVector2Array:
	var n := src.size()
	if n < 3 or subdiv <= 1:
		return src.duplicate()
	var out := PackedVector2Array()
	for i in n:
		var p0: Vector2 = src[(i - 1 + n) % n]
		var p1: Vector2 = src[i]
		var p2: Vector2 = src[(i + 1) % n]
		var p3: Vector2 = src[(i + 2) % n]
		for s in subdiv:
			out.append(_catmull(p0, p1, p2, p3, float(s) / float(subdiv)))
	return out

static func _catmull(p0: Vector2, p1: Vector2, p2: Vector2, p3: Vector2, t: float) -> Vector2:
	var t2 := t * t
	var t3 := t2 * t
	return 0.5 * ((2.0 * p1) + (p2 - p0) * t \
		+ (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 \
		+ (3.0 * p1 - 3.0 * p2 + p3 - p0) * t3)

# Rotate `loop` so index 0 (frac 0 = start/finish) sits on the longest straight,
# so the start line + pit lane render on a straight, not in a corner. Cosmetic only
# (the sim's frac is independent of the map's point indexing).
func _rotate_to_straight() -> void:
	var n := loop.size()
	if n < 8:
		return
	var sp: int = maxi(1, n / 60)
	# curvature per point
	var curv := PackedFloat32Array()
	for i in n:
		var a: Vector2 = loop[(i - sp + n) % n]
		var b: Vector2 = loop[i]
		var cc: Vector2 = loop[(i + sp) % n]
		curv.append(absf((b - a).normalized().angle_to((cc - b).normalized())))
	# contiguous low-curvature runs = straights (with wrap-around merge)
	var thr := 0.05
	var runs: Array = []
	var j := 0
	while j < n:
		if curv[j] < thr:
			var rs := j
			while j < n and curv[j] < thr:
				j += 1
			runs.append([rs, j - rs])
		else:
			j += 1
	if runs.is_empty():
		return
	if runs.size() >= 2 and int(runs[0][0]) == 0 and int(runs[-1][0]) + int(runs[-1][1]) == n:
		runs[0] = [int(runs[-1][0]), int(runs[-1][1]) + int(runs[0][1])]
		runs.remove_at(runs.size() - 1)
	runs.sort_custom(func(x, y): return int(x[1]) > int(y[1]))
	# put frac 0 at the MIDDLE of the longest straight — that's the pit straight,
	# so the start line + pit lane render on a real straight, not in a corner.
	var best_i: int = (int(runs[0][0]) + int(runs[0][1]) / 2) % n
	if best_i != 0:
		var rot := PackedVector2Array()
		for i in n:
			rot.append(loop[(best_i + i) % n])
		loop = rot

func _norm_pos(frac: float) -> Vector2:
	var cnt := loop.size()
	if cnt < 2:
		return Vector2(0.5, 0.5)
	var ff := fposmod(frac, 1.0)
	for i in cnt:
		var c0 := cum[i]
		var c1 := 1.0 if i == cnt - 1 else cum[i + 1]
		if ff >= c0 and ff < c1 and c1 > c0:
			var t := (ff - c0) / (c1 - c0)
			return loop[i].lerp(loop[(i + 1) % cnt], t)
	return loop[0]

func _to_px(np: Vector2, area: Vector2, off: Vector2) -> Vector2:
	return off + Vector2(np.x * area.x, np.y * area.y)

# Pit lane: a stylised lane offset inward alongside the start/finish straight.
# Its length scales with pit_lane (longer at Singapore/Monaco, short at Monza).
# Returns 4 normalised points: entry (on track) → lane_in → lane_out → exit.
func _pit_path() -> PackedVector2Array:
	var n := loop.size()
	if n < 8:
		return PackedVector2Array()
	var cen := Vector2.ZERO
	for q in loop:
		cen += q
	cen /= float(n)
	# Sample the track over the pit span and offset each sample INWARD by a tapered
	# amount — the lane then parallels the real track curve (no more angular zigzag)
	# and merges smoothly into the track at entry/exit.
	var halff := clampf(0.03 + pit_lane * 0.45, 0.03, 0.09)
	var steps := 16
	var out := PackedVector2Array()
	for k in steps + 1:
		var f := -halff + (2.0 * halff) * float(k) / float(steps)
		var p := _norm_pos(fposmod(f, 1.0))
		var pa := _norm_pos(fposmod(f - 0.004, 1.0))
		var pb := _norm_pos(fposmod(f + 0.004, 1.0))
		var nor := (pb - pa).normalized().orthogonal()
		if (p + nor).distance_to(cen) > (p - nor).distance_to(cen):
			nor = -nor                                  # keep the lane inside the circuit
		var edge := minf(float(k), float(steps - k)) / float(steps)   # 0 at ends, 0.5 mid
		var depth := 0.036 * clampf(edge * 4.0, 0.18, 1.0)            # taper into the track at the ends
		out.append(p + nor * depth)
	return out

# Normalised position of a pitting car at phase p (0..1): in → box → dwell → out.
func _pit_pos(path: PackedVector2Array, p: float) -> Vector2:
	if path.size() < 2:
		return Vector2(0.5, 0.5)
	# walk the lane entry→exit with a dwell at the box (middle of the lane)
	var t := clampf(p, 0.0, 1.0)
	var mid := float(path.size() - 1) * 0.5
	var idxf: float
	if t < 0.32:
		idxf = (t / 0.32) * mid
	elif t < 0.68:
		idxf = mid
	else:
		idxf = mid + ((t - 0.68) / 0.32) * mid
	var i := int(idxf)
	if i >= path.size() - 1:
		return path[path.size() - 1]
	return path[i].lerp(path[i + 1], idxf - float(i))

# ---------------------------------------------------------------- draw
func _draw() -> void:
	if loop.size() < 2:
		return
	# keep the circuit's aspect ratio centred in the control
	var avail := Vector2(maxf(size.x - 2.0 * PAD, 1.0), maxf(size.y - 2.0 * PAD, 1.0))
	var s := minf(avail.x, avail.y)
	var area := Vector2(s, s)
	var off := Vector2(PAD, PAD) + (avail - area) * 0.5
	var carlen := clampf(s * 0.038, 16.0, 32.0)

	var pts := PackedVector2Array()
	for p in loop:
		pts.append(_to_px(p, area, off))
	var closed := pts.duplicate()
	closed.append(pts[0])

	var tw := maxf(s * 0.05, 14.0)        # track width scales with the view
	# subtle infield fill — the land enclosed by the lap, for depth vs the black outside
	if pts.size() >= 3:
		draw_colored_polygon(pts, Color("#121110"))           # neutral dark infield
	if sc_active:
		draw_polyline(closed, Color(0.74, 0.59, 0.22, 0.18), tw + 2.0, true)  # SC amber (subdued)
	draw_polyline(closed, Color("#05050a"), tw + 6.0, true)   # outer shadow for depth
	draw_polyline(closed, Color("#14120E"), tw + 4.0, true)   # run-off / edge
	draw_polyline(closed, Color("#34322C"), tw, true)         # tarmac (warm muted grey)
	draw_polyline(closed, Color("#4A453A"), tw * 0.30, true)  # racing line (rubbered-in centre)
	_draw_zones(pts, tw)
	_draw_kerbs(pts, tw)
	_draw_startline(pts, tw)
	_draw_pit(area, off, tw)
	_draw_cars(area, off, carlen)
	_draw_pos_labels(area, off, carlen)
	_draw_label()
	_draw_legend()

func _draw_kerbs(pts: PackedVector2Array, tw: float) -> void:
	var n := pts.size()
	var half := tw * 0.5
	var step := 4
	for i in range(0, n, step):
		var a: Vector2 = pts[i]
		var b: Vector2 = pts[(i + step) % n]
		var c: Vector2 = pts[(i + 2 * step) % n]
		# kerb only the corners (where the track turns) — keeps straights clean
		var turn: float = absf((b - a).normalized().angle_to((c - b).normalized()))
		if turn < 0.30:
			continue
		var nor: Vector2 = (b - a).normalized().orthogonal()
		var col := Color("#d8392f") if int(i / step) % 2 == 0 else Color("#eaeaea")
		draw_line(a + nor * half, b + nor * half, col, 3.5)
		draw_line(a - nor * half, b - nor * half, col, 3.5)

func _draw_startline(pts: PackedVector2Array, tw: float) -> void:
	var p0 := pts[0]
	var sspan: int = maxi(1, int(round(float(pts.size()) * 0.02)))
	var dir := (pts[sspan % pts.size()] - p0).normalized()
	var nor := dir.orthogonal()
	var ncol := 8
	var sq := maxf(tw / float(ncol), 4.0)
	for row in 2:
		for ccol in ncol:
			var on := (row + ccol) % 2 == 0
			var col := Color("#f2f2f2") if on else Color("#15171c")
			var c := p0 + nor * ((float(ccol) - (float(ncol) - 1.0) * 0.5) * sq) + dir * ((float(row) - 0.5) * sq)
			draw_rect(Rect2(c - Vector2(sq * 0.5, sq * 0.5), Vector2(sq, sq)), col)

# Draws the pit lane (offset inward at the start/finish) and the box marker.
func _draw_pit(area: Vector2, off: Vector2, tw: float) -> void:
	var path := _pit_path()
	if path.size() < 4:
		return
	var px := PackedVector2Array()
	for q in path:
		px.append(_to_px(q, area, off))
	var lw := maxf(tw * 0.46, 7.0)
	draw_polyline(px, Color("#05070a"), lw + 3.0)         # dark edge
	draw_polyline(px, Color("#3b434f"), lw)               # pit tarmac — lighter so it reads
	# pit boxes: white ticks along the inner middle stretch of the lane
	for i in range(2, px.size() - 2):
		if i % 2 != 0:
			continue
		var pn := (px[i + 1] - px[i - 1]).normalized().orthogonal()
		draw_line(px[i] - pn * lw * 0.42, px[i] + pn * lw * 0.42, Color("#aab3c0"), 1.5)
	draw_circle(px[0], maxf(tw * 0.11, 2.5), Palette.INFO)                 # entry blip
	draw_circle(px[px.size() - 1], maxf(tw * 0.11, 2.5), Palette.GOOD)     # exit blip

# Segment zones: visualises the energy model on the track. Every straight is a
# DEPLOY zone (faint amber); the `aero_zones` longest are the OVERTAKE / active-aero
# zones (bright blue); a green braking marker at the end of the long straights shows
# where energy is recovered (harvest) entering the corner.
func _draw_zones(pts: PackedVector2Array, tw: float) -> void:
	var n := pts.size()
	if n < 12:
		return
	var sp: int = maxi(1, n / 60)
	var curv := PackedFloat32Array()
	for i in n:
		var a: Vector2 = pts[(i - sp + n) % n]
		var b: Vector2 = pts[i]
		var cc: Vector2 = pts[(i + sp) % n]
		curv.append(absf((b - a).normalized().angle_to((cc - b).normalized())))
	# contiguous low-curvature runs = straights
	var thr := 0.06
	var runs: Array = []
	var j := 0
	while j < n:
		if curv[j] < thr:
			var rs := j
			while j < n and curv[j] < thr:
				j += 1
			runs.append([rs, j - rs])
		else:
			j += 1
	# merge a run that wraps across the start of the array
	if runs.size() >= 2 and int(runs[0][0]) == 0 and int(runs[-1][0]) + int(runs[-1][1]) == n:
		runs[0] = [int(runs[-1][0]), int(runs[-1][1]) + int(runs[0][1])]
		runs.remove_at(runs.size() - 1)
	runs.sort_custom(func(x, y): return int(x[1]) > int(y[1]))
	var ot_take: int = mini(aero_zones, runs.size())
	for z in runs.size():
		var rs: int = int(runs[z][0])
		var rl: int = int(runs[z][1])
		if rl < 3:
			continue
		var seg := PackedVector2Array()
		for k in rl + 1:
			seg.append(pts[(rs + k) % n])
		if z < ot_take:
			var iz := Palette.INFO
			draw_polyline(seg, Color(iz.r, iz.g, iz.b, 0.30), tw * 0.72, true)   # Overtake / active-aero zone (subdued)
		# braking / harvest marker at the END of the longer straights (corner entry)
		if rl >= 5:
			var e: Vector2 = pts[(rs + rl) % n]
			var ep: Vector2 = pts[(rs + rl - 1) % n]
			var bn: Vector2 = (e - ep).normalized().orthogonal()
			draw_line(e - bn * tw * 0.66, e + bn * tw * 0.66, Palette.GOOD, 3.0)
			draw_circle(e, maxf(tw * 0.12, 2.5), Palette.GOOD)

# Position numbers over the cars (drawn last so they sit on top). Team cars and
# the leader get a bigger, colour-coded number; everyone else a small white one.
func _draw_pos_labels(area: Vector2, off: Vector2, l: float) -> void:
	var font: Font = Palette.display_font(600, 0)
	if font == null:
		return
	for c in cars:
		var state := String(c["state"])
		if state == "out":
			continue
		var fr: float = disp.get(int(c["id"]), float(c["frac"]))
		var pos := _to_px(_norm_pos(fr), area, off)
		if state == "pit":
			var pp := _pit_path()
			pos = _to_px(_pit_pos(pp, float(c.get("pit_phase", 0.0))), area, off)
		var is_team := bool(c["team"])
		var is_lead := bool(c["lead"])
		var num := str(int(c.get("pos", 0)) + 1)
		var fs: int = int(maxf(l * 0.7, 12.0)) if (is_team or is_lead) else int(maxf(l * 0.55, 10.0))
		var lp := pos + Vector2(l * 0.5, -l * 0.5)
		# crisp dark halo so the number reads on any background (track, kerb, infield)
		var oc := Color(0.0, 0.0, 0.0, 0.85)
		for ox in [Vector2(1.2, 0), Vector2(-1.2, 0), Vector2(0, 1.2), Vector2(0, -1.2),
				Vector2(1.0, 1.0), Vector2(-1.0, 1.0), Vector2(1.0, -1.0), Vector2(-1.0, -1.0)]:
			draw_string(font, lp + ox, num, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, oc)
		var col := Color("#e8edf3")
		if is_team:
			col = Palette.P5 if int(c["slot"]) == 0 else Palette.P6
		elif is_lead:
			col = Palette.P5
		draw_string(font, lp, num, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, col)

# Small legend (bottom-left) so the zone colours teach the energy model.
func _draw_legend() -> void:
	var font := get_theme_default_font()
	if font == null:
		return
	var x := PAD + 4.0
	var y := size.y - PAD - 52.0
	var items := [
		[Palette.INFO, "Обгон-зона"],
		[Palette.GOOD, "Рекуперация (торможение)"],
	]
	for it in items:
		var col: Color = it[0]
		draw_rect(Rect2(Vector2(x, y - 9.0), Vector2(12.0, 12.0)), col)
		draw_string(font, Vector2(x + 21.0, y + 2.0), String(it[1]),
			HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Palette.MUTED)
		y += 18.0

# Track name in the corner of the view.
func _draw_label() -> void:
	if _key == "":
		return
	var font: Font = Palette.display_font(600, 2)
	draw_string(font, Vector2(PAD + 4.0, PAD + 22.0), _key.to_upper(),
		HORIZONTAL_ALIGNMENT_LEFT, -1, 22, Palette.CREAM)

func _draw_cars(area: Vector2, off: Vector2, carlen: float) -> void:
	for c in cars:
		if not bool(c["team"]) and not bool(c["lead"]):
			_draw_car(c, area, off, carlen)
	for c in cars:
		if bool(c["team"]) and not bool(c["lead"]):
			_draw_car(c, area, off, carlen)
	for c in cars:
		if bool(c["lead"]):
			_draw_car(c, area, off, carlen)

# F1 silhouette, forward = +x, in units of car length L. Body + wings + 4 wheels.
# static var (not const) — constructed Vector2/PackedVector2Array aren't constant.
static var BODY := PackedVector2Array([
	Vector2(0.50, 0.00), Vector2(0.30, -0.07), Vector2(0.10, -0.10), Vector2(-0.20, -0.11),
	Vector2(-0.45, -0.12), Vector2(-0.50, -0.06), Vector2(-0.50, 0.06), Vector2(-0.45, 0.12),
	Vector2(-0.20, 0.11), Vector2(0.10, 0.10), Vector2(0.30, 0.07)])
static var WHEELS := [Vector2(0.26, 0.18), Vector2(0.26, -0.18), Vector2(-0.30, 0.18), Vector2(-0.30, -0.18)]

func _xf(local: Vector2, l: float, pos: Vector2, ang: float) -> Vector2:
	return pos + (local * l).rotated(ang)

func _poly(src: PackedVector2Array, l: float, pos: Vector2, ang: float) -> PackedVector2Array:
	var out := PackedVector2Array()
	for v in src:
		out.append(_xf(v, l, pos, ang))
	return out

func _draw_car(c: Dictionary, area: Vector2, off: Vector2, l: float) -> void:
	var fr: float = disp.get(int(c["id"]), float(c["frac"]))
	var pos := _to_px(_norm_pos(fr), area, off)
	var ang := (_to_px(_norm_pos(fr + 0.004), area, off) - pos).angle()
	var state := String(c["state"])
	var is_team := bool(c["team"])
	if state == "pit":
		var pp := _pit_path()
		var php := float(c.get("pit_phase", 0.0))
		pos = _to_px(_pit_pos(pp, php), area, off)
		ang = (_to_px(_pit_pos(pp, minf(php + 0.03, 1.0)), area, off) - pos).angle()
	if state == "out":
		draw_circle(pos, l * 0.25, Color("#555b66"))
		return
	# soft drop shadow for depth (offset down-right)
	draw_circle(pos + Vector2(l * 0.12, l * 0.16), l * 0.46, Color(0.0, 0.0, 0.0, 0.22))
	var col: Color = c["team_color"]
	if state == "clip":
		col = col.lerp(Color("#3a4049"), 0.45)
	# wheels (dark), drawn under the body
	for w in WHEELS:
		var wc: Vector2 = w
		var wp := PackedVector2Array([
			_xf(wc + Vector2(0.10, 0.05), l, pos, ang), _xf(wc + Vector2(0.10, -0.05), l, pos, ang),
			_xf(wc + Vector2(-0.10, -0.05), l, pos, ang), _xf(wc + Vector2(-0.10, 0.05), l, pos, ang)])
		draw_colored_polygon(wp, Color("#0e1014"))
	# wings
	draw_line(_xf(Vector2(0.46, -0.22), l, pos, ang), _xf(Vector2(0.46, 0.22), l, pos, ang), Color("#0e1014"), maxf(l * 0.05, 1.5))
	draw_line(_xf(Vector2(-0.48, -0.20), l, pos, ang), _xf(Vector2(-0.48, 0.20), l, pos, ang), Color("#0e1014"), maxf(l * 0.06, 2.0))
	# body
	if state == "pit":
		var ob := _poly(BODY, l, pos, ang)
		ob.append(ob[0])
		draw_polyline(ob, col, 1.5, true)         # hollow in the pits
	else:
		draw_colored_polygon(_poly(BODY, l, pos, ang), col)
		var ob2 := _poly(BODY, l, pos, ang)        # crisp dark outline so the car pops off the tarmac
		ob2.append(ob2[0])
		draw_polyline(ob2, Color("#05070a"), maxf(l * 0.045, 1.0), true)
	draw_circle(_xf(Vector2(-0.02, 0.0), l, pos, ang), l * 0.07, Color("#0e1014"))  # cockpit
	# thin team-colour ring identifies the player's two cars (P5 gold / P6 steel-blue)
	if is_team:
		var hc: Color = Palette.P5 if int(c["slot"]) == 0 else Palette.P6
		draw_arc(pos, l * 0.74, 0.0, TAU, 32, hc, 1.6, true)
	if bool(c["lead"]):
		var up := pos - Vector2(0.0, l * 0.95)
		draw_colored_polygon(PackedVector2Array([up + Vector2(-l * 0.18, -l * 0.18),
			up + Vector2(l * 0.18, -l * 0.18), up + Vector2(0.0, l * 0.06)]), Palette.P5)
