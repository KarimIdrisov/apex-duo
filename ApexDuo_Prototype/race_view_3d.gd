class_name RaceView3D
extends Control
# 3D race view widget.  Mirrors TrackMap's API (ensure_built / set_cars) so
# main.gd can feed it exactly like the 2D minimap — pure view, reads the sim
# snapshot only, never writes back to the sim (CLAUDE.md: "Sim stays UI-free").
#
# Per-car snapshot fields consumed (exactly as _update_track_map builds them in
# main.gd, lines ~756-769):
#   id         int     unique car ID (0-based index)
#   frac       float   fractional lap position 0..1
#   team_color Color   livery colour for the car mesh
#   state      String  "run" | "attack" | "clip" | "pit" | "out"
#   team       bool    true = player's car (highlight ring)
#   lead       bool    true = race leader (chevron above)
#   slot       int     0 = P5 (yellow highlight), 1 = P6 (blue highlight)
#   pos        int     leaderboard position (0-based)
#   pit_phase  float   0..1 progress through pit stop (used when state="pit")
#
# Architecture notes:
#   - _vp_main owns its own World3D (own_world_3d = true); _vp_side shares it.
#   - Cars are MeshInstance3D nodes parented to _world; positions are set every
#     frame via Curve3D.sample_baked_with_rotation — no physics.
#   - Interpolation: display frac is lerp'd toward the sim target each frame
#     (same EASE constant as TrackMap) so 0.25 s ticks look smooth.
#   - Wrap-around: when frac jumps backwards > 0.5 we add 1.0 to the target
#     (car crossed the start/finish line) — identical to track_map.gd logic.
#
# Issue #90188 (Godot): Curve3D.sample_baked_with_rotation returns a Transform3D
# in the curve's local space, not world space.  We therefore multiply by
# path.global_transform before assigning to node.global_transform.  The lead
# must verify this on the real engine; if the road Path3D is a direct child of
# _world (no extra offset transform) the product is correct.

# ---- tunables ---------------------------------------------------------------
const EASE        := 9.0     # interpolation speed (higher = snappier, same as TrackMap)
const TRACK_SCALE := 800.0   # metres — 0..1 loop maps to –400..+400 m in XZ
const ROAD_W      := 26.0    # road width in metres (exaggerated for top-down readability)
const CAR_SIZE    := Vector3(18.0, 5.0, 9.0)   # box extents (L,H,W) — broadcast-scale, readable from above
const CAM_HEIGHT  := 520.0   # top-down camera height (metres above origin)
const CAM_TILT    := 430.0   # camera Z offset (isometric tilt when > 0)
const SUN_DEG     := Vector3(-55.0, -35.0, 0.0)   # sun rotation_degrees

# ---- state ------------------------------------------------------------------
var _box: HBoxContainer        # root layout: holds the SubViewportContainers
var _world: Node3D             # holds track, cars, lights, environment, main cam
var _vp_main: SubViewport
var _vp_side: SubViewport      # second screen for coop (created by enable_split)
var _curve: Curve3D
var _path: Path3D              # the road Path3D whose global_transform we need
var _cars: Array = []          # latest snapshot from set_cars()
var _nodes: Dictionary = {}    # id (int) -> MeshInstance3D
var _disp: Dictionary = {}     # id (int) -> display frac (float, interpolated)
var _sc_active := false
var _key := ""                 # last track_name used to build the track

# ---- lifecycle --------------------------------------------------------------
func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	# HBoxContainer fills this Control; SubViewportContainers are added to it.
	_box = HBoxContainer.new()
	_box.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(_box)

	# Main viewport — owns its own World3D.
	var c1 := SubViewportContainer.new()
	c1.stretch = true
	c1.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_box.add_child(c1)

	_vp_main = SubViewport.new()
	_vp_main.own_world_3d = true
	c1.add_child(_vp_main)

	# Scene root living inside the main viewport.
	_world = Node3D.new()
	_vp_main.add_child(_world)

	_setup_environment()
	_setup_camera(_world)
	set_process(true)


# ---- public API (mirrors TrackMap) ------------------------------------------

# Call once per race (or when the track changes).  Builds the Curve3D and road
# mesh; subsequent calls with the same name/seed are no-ops.
func ensure_built(track_name: String, seed_value: int) -> void:
	if track_name == _key and _curve != null:
		return
	_key = track_name

	# Remove the old road Path3D if we're rebuilding (e.g. track changed).
	if _path != null and is_instance_valid(_path):
		_path.queue_free()
		_path = null
	_curve = null

	var loop: PackedVector2Array = TrackShapes.loop_for(track_name, seed_value)
	var built: Dictionary = TrackBuilder3D.build(loop, TRACK_SCALE, ROAD_W)
	_curve = built["curve"]
	_path  = built["road"]
	_world.add_child(_path)


# Feed a new snapshot.  arr matches the shape built in main.gd _update_track_map.
func set_cars(arr: Array, sc: bool) -> void:
	_cars = arr
	_sc_active = sc


# ---- per-frame update -------------------------------------------------------
func _process(delta: float) -> void:
	if _cars.is_empty() or _curve == null:
		return

	var f := clampf(delta * EASE, 0.0, 1.0)
	var total: float = _curve.get_baked_length()
	if total <= 0.0:
		return

	for c in _cars:
		var id: int = int(c["id"])
		var tgt: float = float(c["frac"])
		var d: float = _disp.get(id, tgt)
		# Wrap-around: if the target jumped backwards by more than half a lap,
		# the car crossed start/finish going forward — add 1.0 so lerp goes
		# forward instead of rewinding.
		if tgt < d - 0.5:
			tgt += 1.0
		d = fposmod(lerp(d, tgt, f), 1.0)
		_disp[id] = d

		var node := _ensure_node(c)
		var offset: float = d * total
		# sample_baked_with_rotation returns a Transform3D in curve-local space.
		# Multiply by path.global_transform to get world space (issue #90188).
		var xf: Transform3D = _curve.sample_baked_with_rotation(offset, true)
		node.global_transform = _path.global_transform * xf
		_apply_state(node, c)


# ---- coop split-screen (Mode A) --------------------------------------------

# Call once to add a second SubViewport sharing the same World3D, with its own
# camera.  The two SubViewportContainers sit side-by-side in _box.
# Camera positioning for P5/P6 (chase cameras) is a follow-up — this sets up a
# second top-down view as a baseline; the lead should wire up chase targeting.
func enable_split() -> void:
	if _vp_side != null:
		return    # already enabled

	var c2 := SubViewportContainer.new()
	c2.stretch = true
	c2.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_box.add_child(c2)

	_vp_side = SubViewport.new()
	# Share the world that holds the track and cars (not own_world_3d).
	_vp_side.world_3d = _vp_main.world_3d
	c2.add_child(_vp_side)

	# Camera lives inside the second viewport node itself so it is independent.
	_setup_camera(_vp_side)


# ---- helpers ----------------------------------------------------------------

# Return the MeshInstance3D for a car, creating it if it doesn't exist yet.
func _ensure_node(c: Dictionary) -> MeshInstance3D:
	var id: int = int(c["id"])
	if _nodes.has(id):
		return _nodes[id]

	var m := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = CAR_SIZE
	m.mesh = bm

	var mat := StandardMaterial3D.new()
	mat.albedo_color = c["team_color"]
	m.material_override = mat

	_world.add_child(m)
	_nodes[id] = m
	return m


# Apply per-frame visual state: colour tint, emission, visibility.
func _apply_state(node: MeshInstance3D, c: Dictionary) -> void:
	var mat := node.material_override as StandardMaterial3D
	if mat == null:
		return

	var base_col: Color = c["team_color"]
	var state: String = String(c["state"])
	var is_team: bool = bool(c["team"])

	match state:
		"out":
			# Retired car: grey, no emission.
			mat.albedo_color = Color("#555b66")
			mat.emission_enabled = false
			node.visible = true
			return
		"clip":
			# Clipping (battery depleted): darker livery.
			mat.albedo_color = base_col.lerp(Color("#3a4049"), 0.45)
			mat.emission_enabled = false
		"attack":
			# Overtake boost active: orange glow.
			mat.albedo_color = base_col
			mat.emission_enabled = true
			mat.emission = Color("#ff7a1a")
			mat.emission_energy_multiplier = 1.2
		"pit":
			# In pit lane: livery unchanged, slight transparency hint via emission off.
			mat.albedo_color = base_col.lerp(Color("#ffffff"), 0.15)
			mat.emission_enabled = false
		_:  # "run" and anything else
			mat.albedo_color = base_col
			mat.emission_enabled = false

	# Player car highlight: white emission ring effect (approximated via emission).
	if is_team:
		mat.emission_enabled = true
		var hc := Color("#ffd166") if int(c["slot"]) == 0 else Color("#66c2ff")
		mat.emission = hc
		mat.emission_energy_multiplier = 0.6

	node.visible = true


# Top-down / isometric camera.
# parent can be a Node3D (main world) or a SubViewport (second viewport's camera
# must be parented to the viewport so it is picked up by that viewport's renderer).
func _setup_camera(parent: Node) -> void:
	var cam := Camera3D.new()
	cam.position = Vector3(0.0, CAM_HEIGHT, CAM_TILT)
	cam.current = true
	parent.add_child(cam)
	cam.look_at(Vector3.ZERO, Vector3.UP)


# WorldEnvironment + directional sun.  Called once for the main world.
func _setup_environment() -> void:
	var we := WorldEnvironment.new()
	var env := Environment.new()

	# Sky background (ProceduralSkyMaterial = the built-in gradient sky).
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	sky.sky_material = ProceduralSkyMaterial.new()
	env.sky = sky

	# Tonemapping: Filmic for broadcast look.
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC

	# Subtle glow — "broadcast" look without being heavy.
	env.glow_enabled = true
	env.glow_bloom = 0.05
	env.glow_intensity = 0.6

	# Very light SSAO for depth (may be disabled on Mobile renderer).
	env.ssao_enabled = true
	env.ssao_radius = 1.0
	env.ssao_intensity = 0.5

	we.environment = env
	_world.add_child(we)

	# Directional sun with soft shadows.
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = SUN_DEG
	sun.shadow_enabled = true
	sun.light_energy = 1.2
	_world.add_child(sun)
