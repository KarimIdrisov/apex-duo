class_name TrackShapes
# Shared source of truth for 2D circuit outlines (normalized 0..1, closed loops).
# Both the 2D minimap (track_map.gd) and the 3D race view (race_view_3d.gd) call
# loop_for() so they always draw the same shape.
#
# NOTE: track_map.gd still carries its own copy of TRACK_SHAPES and the procedural
# generator. De-duplicating track_map.gd to call TrackShapes.loop_for() instead is a
# follow-up refactor (keep that as the next tidy-up task for the lead).
#
# static var (not const): PackedVector2Array built from Vector2 literals is NOT a
# constant expression — Godot rejects it inside a const block.

static var TRACK_SHAPES: Dictionary = {
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

# Returns a closed, normalized (0..1) loop for the named track.
# Falls back to a deterministic procedural loop when the track has no authored shape.
# The returned array has the closure point appended (last == first) so callers can
# treat it as a closed polygon without extra logic.
static func loop_for(track_name: String, seed_value: int) -> PackedVector2Array:
	var raw: PackedVector2Array
	if TRACK_SHAPES.has(track_name):
		raw = TRACK_SHAPES[track_name]
	else:
		raw = _generate(seed_value)
	return _fit_and_close(raw)


# ---------------------------------------------------------------- internals

# Re-normalise a raw point cloud to 0..1 in both axes, then append the first
# point to close the loop.
static func _fit_and_close(src: PackedVector2Array) -> PackedVector2Array:
	if src.size() == 0:
		return PackedVector2Array()
	var minx := 1.0e9
	var miny := 1.0e9
	var maxx := -1.0e9
	var maxy := -1.0e9
	for p in src:
		minx = minf(minx, p.x)
		miny = minf(miny, p.y)
		maxx = maxf(maxx, p.x)
		maxy = maxf(maxy, p.y)
	var w := maxf(maxx - minx, 0.001)
	var h := maxf(maxy - miny, 0.001)
	var out := PackedVector2Array()
	for p in src:
		out.append(Vector2((p.x - minx) / w, (p.y - miny) / h))
	out.append(out[0])   # close the loop
	return out


# Procedural harmonic loop — identical algorithm to track_map.gd._generate() so
# host and client always produce the same shape for the same seed.
# Uses RaceSim.RNG (seeded LCG) and RaceSim.mix32 for the events-stream separation,
# exactly as track_map.gd does.
static func _generate(seed_value: int) -> PackedVector2Array:
	var r := RaceSim.RNG.new(RaceSim.mix32(seed_value))
	var harm: Array = []
	for _i in 3:
		harm.append([2 + int(r.next_u32() % 4), r.rangef(0.06, 0.18), r.rangef(0.0, TAU)])
	var n := 200
	var raw: Array = []
	for i in n:
		var th := TAU * float(i) / float(n)
		var rad := 1.0
		for hh in harm:
			rad += float(hh[1]) * sin(float(hh[0]) * th + float(hh[2]))
		raw.append(Vector2(cos(th), sin(th)) * rad)
	var fit := PackedVector2Array()
	for p in raw:
		fit.append(p)
	return fit
