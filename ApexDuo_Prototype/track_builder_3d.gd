class_name TrackBuilder3D
# Pure geometry helper: a normalized closed loop (0..1 coords) → Curve3D + road mesh.
# No UI, no sim state — safe to unit-check in isolation.
#
# Usage:
#   var result: Dictionary = TrackBuilder3D.build(loop, 800.0, 12.0)
#   var curve: Curve3D = result["curve"]
#   var road:  Path3D  = result["road"]   # add as child of your world Node3D
#
# The loop is expected to already be closed (last point == first), as returned by
# TrackShapes.loop_for().  If it is not closed, build() closes it automatically.
#
# Coordinate mapping: loop (x,y) in 0..1 → world (X, 0, Z) in metres.
# Centre of the loop maps to world origin (0, 0, 0).
#
# §13.3 contract (from 3D_VISUALIZATION_RESEARCH.md):
#   static func build(loop, scale, width) -> Dictionary{curve, road}
#   CSGPolygon3D in PATH mode, path_interval small for smooth corners, closed loop.

static func build(loop: PackedVector2Array, scale: float, width: float) -> Dictionary:
	var curve := Curve3D.new()

	# Map each 2D point (0..1) → XZ plane in metres, centred on origin.
	for p in loop:
		var x: float = (p.x - 0.5) * scale
		var z: float = (p.y - 0.5) * scale
		curve.add_point(Vector3(x, 0.0, z))

	# Ensure the curve is closed.  TrackShapes.loop_for() already appends loop[0]
	# as the last point, but guard here so build() is safe to call standalone.
	var n := curve.point_count
	if n > 1:
		var p0 := curve.get_point_position(0)
		var pn := curve.get_point_position(n - 1)
		# Tolerance: if the last point is not already at the first point, add it.
		if p0.distance_to(pn) > 0.01:
			curve.add_point(p0)

	# Road mesh: CSGPolygon3D extruded along the Path3D.
	# path_interval = 0.08 (distance in metres between cross-sections) keeps corners
	# smooth without generating too many polygons.  Use PATH_INTERVAL_DISTANCE so the
	# density is uniform regardless of curve point count.
	# The cross-section is a thin flat rectangle (width × 0.4 m thickness), so the
	# road sits flush with the XZ plane (y=0 is the top surface).
	var path := Path3D.new()
	path.curve = curve

	var road := CSGPolygon3D.new()
	road.mode = CSGPolygon3D.MODE_PATH
	# CSGPolygon3D must be a child of the Path3D it extrudes along — path_node ".."
	# means "my parent", which will be the Path3D we add it to below.
	road.path_node = NodePath("..")
	road.path_interval_type = CSGPolygon3D.PATH_INTERVAL_DISTANCE
	road.path_interval = 0.08          # small = smooth, ~10 cm between sections
	# Flat profile: two pairs of corners making a thin rectangular slab.
	# Half-width left and right of centre, 0.4 m tall (road slab height).
	var hw: float = width * 0.5
	road.polygon = PackedVector2Array([
		Vector2(-hw,  0.0),
		Vector2( hw,  0.0),
		Vector2( hw,  0.4),
		Vector2(-hw,  0.4),
	])
	path.add_child(road)

	return {"curve": curve, "road": path}
