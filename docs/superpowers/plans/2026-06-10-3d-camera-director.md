# 3D Broadcast Camera Director — Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static top-down camera in the 3D race view with a broadcast **camera director** — a ring of TV "tower" cameras that smoothly tracks the action, a chase mode, an orbit mode, and an auto-director that cuts to events the sim already emits.

**Architecture:** A new pure-ish helper `RaceCameraDirector` (`extends RefCounted`) owns one `Camera3D`, builds tower positions from the race `Curve3D`, and each frame reads the car `MeshInstance3D` world transforms + the snapshot to position the camera. It never writes to the sim (CLAUDE.md "Sim stays UI-free"). `race_view_3d.gd` creates it in place of `_setup_camera` and drives it from `_process`. Spec: `docs/superpowers/specs/2026-06-10-3d-broadcast-race-view-design.md`.

**Tech Stack:** Godot 4.6 / GDScript. Verification: `gdtoolkit` (`python -m gdtoolkit.parser|linter`) for syntax, and the **godot MCP** (`script.execute_gdscript`, `project_path = …\ApexDuo_Prototype`) for real-engine runtime assertions (this project can't run scenes headlessly otherwise — see CLAUDE.md). Visual acceptance is the user in the editor.

---

## Verification approach (read first — this project has no GDScript unit runner)

There is **no pytest/GUT here**. Each "test" is one of:
1. **Syntax** — `cd <repo>; PYTHONUTF8=1 python -m gdtoolkit.parser ApexDuo_Prototype/race_camera_3d.gd` → expect `OK`, then `... -m gdtoolkit.linter ...` (naming-convention warnings on `CONSTANT_CASE static var` are pre-existing project style, not failures).
2. **Runtime assertion** — a small GDScript snippet run via the **godot MCP** `script` tool, `action=execute_gdscript`, `project_path=<repo>\ApexDuo_Prototype` (needs a `confirm_and_execute` round-trip). The snippet builds inputs, calls the function, and uses `assert(...)` + `print("PASS …")`. Expected: output contains the `PASS` line and no `SCRIPT ERROR` / failed `assert`.

Each task's test snippet is **self-contained** — it constructs its own `Curve3D` and fake car nodes, so it does not need a running race.

**Commits use explicit pathspecs only** (`git add <exact files>`), never `git add -A`/`git add .` — the working tree holds the user's unrelated uncommitted work (track_shapes.gd, README, CLAUDE.md, tools/). Do not sweep it into these commits.

Helper used by several test snippets (a closed ~circular `Curve3D`, radius 200, centred at origin):

```gdscript
func _ring() -> Curve3D:
	var cv := Curve3D.new()
	for a in 16:
		var t := TAU * float(a) / 16.0
		cv.add_point(Vector3(cos(t) * 200.0, 0.0, sin(t) * 200.0))
	cv.add_point(cv.get_point_position(0))   # close
	return cv
```

---

## File structure

- **Create:** `ApexDuo_Prototype/race_camera_3d.gd` (`class_name RaceCameraDirector`) — the whole director. One responsibility: turn (car transforms + snapshot + dt) into a `Camera3D` pose. ~150 lines.
- **Modify:** `ApexDuo_Prototype/race_view_3d.gd` — swap the static camera for the director; drive it in `_process`; expose a mode API; update `enable_split`.
- **No new committed test files** — tests are godot-MCP snippets (above).

`RaceCameraDirector` public API (locked here; later tasks must match exactly):

```gdscript
enum Mode { TV, CHASE, ORBIT }
func setup(curve: Curve3D, parent: Node) -> Camera3D      # build towers, make camera, return it
func set_mode(m: int) -> void                             # Mode.TV / CHASE / ORBIT
func set_chase_id(id: int) -> void                        # car id for CHASE / preferred TV subject; -1 = leader
func update(car_nodes: Dictionary, cars: Array, sc_active: bool, dt: float) -> void
```

`car_nodes`: `{ id:int -> MeshInstance3D }` (exactly `race_view_3d.gd`'s `_nodes`). `cars`: the snapshot array from `set_cars` (dicts with `id`, `state`, `team`, `lead`, `slot`). `sc_active`: bool.

---

### Task 1: Skeleton + `setup()` + tower ring

**Files:**
- Create: `ApexDuo_Prototype/race_camera_3d.gd`

- [ ] **Step 1: Write the failing test** (godot MCP `execute_gdscript`)

```gdscript
# paste _ring() from the Verification section above this snippet, then:
var d = RaceCameraDirector.new()
var root = Node3D.new()
var cam = d.setup(_ring(), root)
assert(cam != null, "camera created")
assert(cam is Camera3D, "is Camera3D")
assert(cam.get_parent() == root, "camera parented to root")
assert(d._towers.size() == RaceCameraDirector.TOWER_COUNT, "tower count")
# every tower sits outside the centreline radius (200) and above the road
for tw in d._towers:
	var horiz = Vector2(tw.x, tw.z).length()
	assert(horiz > 200.0, "tower pushed outward, got %f" % horiz)
	assert(tw.y > 10.0, "tower raised, got %f" % tw.y)
print("PASS task1")
```

- [ ] **Step 2: Run to verify it fails**

Run via godot MCP: `script` / `execute_gdscript`, `project_path` = `…\ApexDuo_Prototype`, then `confirm_and_execute`.
Expected: `SCRIPT ERROR` (class `RaceCameraDirector` does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `ApexDuo_Prototype/race_camera_3d.gd`:

```gdscript
class_name RaceCameraDirector
extends RefCounted
# Broadcast camera director for the 3D race view (Phase 1).
# Pure-ish helper: owns one Camera3D, reads car node transforms + the snapshot,
# positions the camera. NEVER writes to the sim (CLAUDE.md "Sim stays UI-free").

enum Mode { TV, CHASE, ORBIT }

const TOWER_COUNT := 14         # ring of broadcast tower cameras
const TOWER_OUT   := 90.0       # metres outward from the centreline
const TOWER_UP    := 55.0       # metres above the road
const MOVE_EASE   := 2.5        # camera position lerp speed (per second)
const LOOK_EASE   := 4.0        # look-direction lerp speed (per second)
const CHASE_BACK  := 26.0       # chase: metres behind the car
const CHASE_UP    := 9.0        # chase: metres above the car
const CUT_HOLD    := 3.5        # seconds to hold an auto-director event shot
const ORBIT_RATE  := 0.25       # rad/s orbit speed

var camera: Camera3D
var mode: int = Mode.TV
var chase_id: int = -1
var _towers: PackedVector3Array = PackedVector3Array()
var _centroid := Vector3.ZERO
var _radius := 300.0
var _cam_pos := Vector3(0.0, 200.0, 200.0)
var _look := Vector3.ZERO
var _cut_id: int = -1
var _cut_timer := 0.0
var _orbit_ang := 0.0

func setup(curve: Curve3D, parent: Node) -> Camera3D:
	_build_towers(curve)
	camera = Camera3D.new()
	camera.fov = 38.0
	camera.position = _cam_pos
	camera.current = true
	parent.add_child(camera)
	if _cam_pos.distance_to(_centroid) > 0.1:
		camera.look_at(_centroid, Vector3.UP)
	return camera

func set_mode(m: int) -> void:
	mode = m

func set_chase_id(id: int) -> void:
	chase_id = id

func _build_towers(curve: Curve3D) -> void:
	_towers = PackedVector3Array()
	if curve == null or curve.get_baked_length() <= 0.0:
		return
	var pts := curve.get_baked_points()
	var c := Vector3.ZERO
	for p in pts:
		c += p
	c /= float(maxi(1, pts.size()))
	_centroid = c
	var total := curve.get_baked_length()
	var rsum := 0.0
	for i in TOWER_COUNT:
		var on := curve.sample_baked(total * float(i) / float(TOWER_COUNT))
		var outward := on - _centroid
		outward.y = 0.0
		if outward.length() < 0.001:
			outward = Vector3(1.0, 0.0, 0.0)
		outward = outward.normalized()
		_towers.append(on + outward * TOWER_OUT + Vector3.UP * TOWER_UP)
		rsum += (on - _centroid).length()
	_radius = rsum / float(TOWER_COUNT) + TOWER_OUT
	_cam_pos = _towers[0]
```

- [ ] **Step 4: Run to verify it passes**

Run the Step-1 snippet again via the godot MCP. Expected: `PASS task1`, no errors.
Also run `python -m gdtoolkit.parser ApexDuo_Prototype/race_camera_3d.gd` → `OK`.

- [ ] **Step 5: Commit**

```bash
git add ApexDuo_Prototype/race_camera_3d.gd
git commit -m "feat(3d): RaceCameraDirector skeleton + broadcast tower ring"
```

---

### Task 2: subject picking (`_leader_id`, `_subject_pos`)

**Files:**
- Modify: `ApexDuo_Prototype/race_camera_3d.gd`

- [ ] **Step 1: Write the failing test**

```gdscript
var d = RaceCameraDirector.new()
d.setup(_ring(), Node3D.new())
# fake car nodes: id 5 = leader at (10,0,0), id 6 at (0,0,30)
var n5 = Node3D.new(); n5.position = Vector3(10, 0, 0)
var n6 = Node3D.new(); n6.position = Vector3(0, 0, 30)
var nodes = {5: n5, 6: n6}
var cars = [{"id": 5, "lead": true, "team": true, "slot": 0, "state": "run"},
			{"id": 6, "lead": false, "team": true, "slot": 1, "state": "run"}]
assert(d._leader_id(cars) == 5, "leader is 5")
assert(d._subject_pos(nodes, cars) == Vector3(10, 0, 0), "subject = leader pos")
d.set_chase_id(6)
assert(d._subject_pos(nodes, cars) == Vector3(0, 0, 30), "subject follows chase_id")
print("PASS task2")
```

- [ ] **Step 2: Run to verify it fails**

Expected: `SCRIPT ERROR` — `_leader_id` / `_subject_pos` not found.

- [ ] **Step 3: Write minimal implementation** (append to `race_camera_3d.gd`)

```gdscript
func _leader_id(cars: Array) -> int:
	for c in cars:
		if bool(c.get("lead", false)):
			return int(c["id"])
	return int(cars[0]["id"]) if cars.size() > 0 else -1

# World position the camera should watch: an active auto-cut target, else the
# chase/preferred car, else the leader.
func _subject_pos(car_nodes: Dictionary, cars: Array) -> Vector3:
	var id: int = _cut_id
	if id < 0:
		id = chase_id if chase_id >= 0 else _leader_id(cars)
	if car_nodes.has(id):
		return (car_nodes[id] as Node3D).global_transform.origin
	return _centroid
```

- [ ] **Step 4: Run to verify it passes** — Expected: `PASS task2`. Then `gdtoolkit.parser` → `OK`.

- [ ] **Step 5: Commit**

```bash
git add ApexDuo_Prototype/race_camera_3d.gd
git commit -m "feat(3d): camera subject picking (leader / chase target)"
```

---

### Task 3: nearest-tower selection (`_best_tower`)

**Files:**
- Modify: `ApexDuo_Prototype/race_camera_3d.gd`

- [ ] **Step 1: Write the failing test**

```gdscript
var d = RaceCameraDirector.new()
d.setup(_ring(), Node3D.new())
# a subject right next to tower 0 must select tower 0
var t0 = d._towers[0]
var i = d._best_tower(t0 + Vector3(1, 0, 1))
assert(i == 0, "nearest tower to t0 is 0, got %d" % i)
# subject near tower 5 selects 5
var i5 = d._best_tower(d._towers[5] + Vector3(2, 0, 0))
assert(i5 == 5, "nearest tower is 5, got %d" % i5)
print("PASS task3")
```

- [ ] **Step 2: Run to verify it fails** — Expected: `_best_tower` not found.

- [ ] **Step 3: Write minimal implementation**

```gdscript
# Index of the tower closest to the subject (simple, robust framing heuristic).
func _best_tower(subject: Vector3) -> int:
	var best := 0
	var best_d := 1.0e30
	for i in _towers.size():
		var dd := _towers[i].distance_squared_to(subject)
		if dd < best_d:
			best_d = dd
			best = i
	return best
```

- [ ] **Step 4: Run to verify it passes** — Expected: `PASS task3`. `gdtoolkit.parser` → `OK`.

- [ ] **Step 5: Commit**

```bash
git add ApexDuo_Prototype/race_camera_3d.gd
git commit -m "feat(3d): nearest-tower selection for the TV camera"
```

---

### Task 4: auto-director priority (`_event_id`)

**Files:**
- Modify: `ApexDuo_Prototype/race_camera_3d.gd`

- [ ] **Step 1: Write the failing test**

```gdscript
var d = RaceCameraDirector.new()
d.setup(_ring(), Node3D.new())
var lead_only = [{"id": 1, "lead": true, "team": false, "state": "run"},
				 {"id": 5, "lead": false, "team": true, "state": "run"}]
assert(d._event_id(lead_only, false) == -1, "no event -> -1")
# team car attacking takes top priority
var attack = [{"id": 1, "lead": true, "team": false, "state": "run"},
			  {"id": 5, "lead": false, "team": true, "state": "attack"}]
assert(d._event_id(attack, false) == 5, "team attack -> 5")
# safety car (no team event) -> leader
assert(d._event_id(lead_only, true) == 1, "SC -> leader 1")
# team pit when nothing higher
var pit = [{"id": 1, "lead": true, "team": false, "state": "run"},
		   {"id": 6, "lead": false, "team": true, "state": "pit"}]
assert(d._event_id(pit, false) == 6, "team pit -> 6")
print("PASS task4")
```

- [ ] **Step 2: Run to verify it fails** — Expected: `_event_id` not found.

- [ ] **Step 3: Write minimal implementation**

```gdscript
# Highest-priority auto-cut subject id, or -1. Reads only snapshot flags the sim
# already emits. Priority: your car battling (attack) > safety car > your pit stop.
func _event_id(cars: Array, sc_active: bool) -> int:
	var team_attack := -1
	var team_pit := -1
	for c in cars:
		if not bool(c.get("team", false)):
			continue
		var st := String(c.get("state", "run"))
		if st == "attack" and team_attack < 0:
			team_attack = int(c["id"])
		elif st == "pit" and team_pit < 0:
			team_pit = int(c["id"])
	if team_attack >= 0:
		return team_attack
	if sc_active:
		return _leader_id(cars)
	if team_pit >= 0:
		return team_pit
	return -1
```

- [ ] **Step 4: Run to verify it passes** — Expected: `PASS task4`. `gdtoolkit.parser` → `OK`.

- [ ] **Step 5: Commit**

```bash
git add ApexDuo_Prototype/race_camera_3d.gd
git commit -m "feat(3d): auto-director event priority (battle/SC/pit)"
```

---

### Task 5: chase position (`_chase_pos`)

**Files:**
- Modify: `ApexDuo_Prototype/race_camera_3d.gd`

- [ ] **Step 1: Write the failing test**

```gdscript
var d = RaceCameraDirector.new()
d.setup(_ring(), Node3D.new())
# a car at origin facing -Z (forward). sample_baked_with_rotation convention:
# forward = -basis.z, so "behind" is +Z. Chase cam should sit behind and above.
var car = Node3D.new()
car.global_transform = Transform3D(Basis(), Vector3.ZERO)   # identity: forward = -Z
var nodes = {5: car}
var cars = [{"id": 5, "lead": true, "team": true, "state": "run"}]
d.set_chase_id(5)
var p = d._chase_pos(nodes, cars, Vector3.ZERO)
assert(p.z > 20.0, "chase sits behind (+Z), got z=%f" % p.z)
assert(p.y > 5.0, "chase sits above, got y=%f" % p.y)
assert(absf(p.x) < 0.01, "chase stays centred in x, got x=%f" % p.x)
print("PASS task5")
```

- [ ] **Step 2: Run to verify it fails** — Expected: `_chase_pos` not found.

- [ ] **Step 3: Write minimal implementation**

```gdscript
# Camera pose for CHASE: behind and above the chased car, using its facing.
func _chase_pos(car_nodes: Dictionary, cars: Array, _subject: Vector3) -> Vector3:
	var id: int = chase_id if chase_id >= 0 else _leader_id(cars)
	if not car_nodes.has(id):
		return _cam_pos
	var xf: Transform3D = (car_nodes[id] as Node3D).global_transform
	var fwd: Vector3 = -xf.basis.z.normalized()        # forward = -z
	return xf.origin - fwd * CHASE_BACK + Vector3.UP * CHASE_UP
```

- [ ] **Step 4: Run to verify it passes** — Expected: `PASS task5`. `gdtoolkit.parser` → `OK`.

- [ ] **Step 5: Commit**

```bash
git add ApexDuo_Prototype/race_camera_3d.gd
git commit -m "feat(3d): chase camera position behind the followed car"
```

---

### Task 6: `update()` — smoothing, modes, auto-cut latch

**Files:**
- Modify: `ApexDuo_Prototype/race_camera_3d.gd`

- [ ] **Step 1: Write the failing test**

```gdscript
var d = RaceCameraDirector.new()
var root = Node3D.new()
d.setup(_ring(), root)
var n5 = Node3D.new(); n5.position = Vector3(180, 0, 0)   # near tower(s) on +x
var nodes = {5: n5}
var cars = [{"id": 5, "lead": true, "team": true, "slot": 0, "state": "run"}]
# TV mode: after many frames the camera converges toward the best tower and looks at the car
var best = d._towers[d._best_tower(n5.global_transform.origin)]
for i in 200:
	d.update(nodes, cars, false, 0.1)
assert(d.camera.global_position.distance_to(best) < 5.0, "camera reached best tower, d=%f" % d.camera.global_position.distance_to(best))
var fwd = -d.camera.global_transform.basis.z.normalized()
var to_car = (n5.global_transform.origin - d.camera.global_position).normalized()
assert(fwd.dot(to_car) > 0.95, "camera looks at the car, dot=%f" % fwd.dot(to_car))
# auto-cut: a team car attacking latches the cut target for CUT_HOLD
cars[0]["state"] = "attack"
d.update(nodes, cars, false, 0.1)
assert(d._cut_id == 5, "attack latched the cut, got %d" % d._cut_id)
print("PASS task6")
```

- [ ] **Step 2: Run to verify it fails** — Expected: `update` not found / no convergence.

- [ ] **Step 3: Write minimal implementation**

```gdscript
func update(car_nodes: Dictionary, cars: Array, sc_active: bool, dt: float) -> void:
	if camera == null:
		return
	# auto-director: latch a high-priority event for CUT_HOLD seconds (TV only)
	if mode == Mode.TV:
		var ev := _event_id(cars, sc_active)
		if ev >= 0 and ev != _cut_id:
			_cut_id = ev
			_cut_timer = CUT_HOLD
		elif _cut_timer > 0.0:
			_cut_timer -= dt
			if _cut_timer <= 0.0:
				_cut_id = -1
	else:
		_cut_id = -1
		_cut_timer = 0.0
	var subject := _subject_pos(car_nodes, cars)
	var target := _cam_pos
	match mode:
		Mode.CHASE:
			target = _chase_pos(car_nodes, cars, subject)
		Mode.ORBIT:
			_orbit_ang += ORBIT_RATE * dt
			target = _centroid + Vector3(cos(_orbit_ang), 0.0, sin(_orbit_ang)) * _radius + Vector3.UP * TOWER_UP
		_:  # Mode.TV
			if _towers.size() > 0:
				target = _towers[_best_tower(subject)]
	_cam_pos = _cam_pos.lerp(target, clampf(MOVE_EASE * dt, 0.0, 1.0))
	_look = _look.lerp(subject, clampf(LOOK_EASE * dt, 0.0, 1.0))
	camera.global_position = _cam_pos
	if _cam_pos.distance_to(_look) > 0.1:
		camera.look_at(_look, Vector3.UP)
```

- [ ] **Step 4: Run to verify it passes** — Expected: `PASS task6`. `gdtoolkit.parser` → `OK`, `gdtoolkit.linter` → only the pre-existing CONSTANT_CASE naming notes.

- [ ] **Step 5: Commit**

```bash
git add ApexDuo_Prototype/race_camera_3d.gd
git commit -m "feat(3d): camera update() — TV/chase/orbit + smoothing + auto-cut"
```

---

### Task 7: integrate the director into `race_view_3d.gd`

**Files:**
- Modify: `ApexDuo_Prototype/race_view_3d.gd`

Context — current relevant code (`race_view_3d.gd`):
- `_ready()` calls `_setup_environment()` then `_setup_camera(_world)` (creates a static Camera3D).
- `_process(delta)` loops over `_cars`, positions each `_nodes[id]` via `sample_baked_with_rotation`.
- `enable_split()` calls `_setup_camera(_vp_side)` for the second viewport.
- `_setup_camera(parent)` makes the fixed camera.

- [ ] **Step 1: Write the failing test** (smoke: the view builds a director-driven camera and `update()` runs without error)

```gdscript
var V = load("res://race_view_3d.gd").new()
var holder = Node.new()
holder.add_child(V)            # fires _ready()
V.ensure_built("Монца", 50)    # builds curve + road + director camera
assert(V._director != null, "director created")
assert(V._director.camera != null, "director has a camera")
# feed one snapshot and pump a few frames — must not error
V.set_cars([{ "id": 0, "frac": 0.1, "team_color": Color("#ff0000"),
	"slot": 0, "state": "run", "team": true, "lead": true, "pos": 0, "pit_phase": 0.0 }], false)
for i in 5:
	V._process(0.1)
assert(V._director.camera.global_position.length() > 0.0, "camera positioned")
print("PASS task7")
```

- [ ] **Step 2: Run to verify it fails**

Expected: `SCRIPT ERROR` — `_director` does not exist yet (still the static `_setup_camera`).

- [ ] **Step 3: Write minimal implementation**

In `race_view_3d.gd`, add the field near the other state vars (after `var _path: Path3D`):

```gdscript
var _director: RaceCameraDirector      # broadcast camera director (Phase 1)
```

Replace the `_ready()` camera call: change `_setup_camera(_world)` to **nothing here** (the camera is created in `ensure_built`, once the curve exists). Concretely, delete the `_setup_camera(_world)` line in `_ready()`.

At the end of `ensure_built(...)`, after `_world.add_child(_path)`, create the director from the curve:

```gdscript
	# Broadcast camera director (Phase 1) — replaces the static top-down camera.
	if _director == null:
		_director = RaceCameraDirector.new()
		_director.setup(_curve, _world)
```

In `_process(delta)`, after the `for c in _cars:` loop that sets node transforms, drive the director (it reads the now-updated node transforms):

```gdscript
	if _director != null:
		_director.update(_nodes, _cars, _sc_active, delta)
```

Leave the old `_setup_camera(parent)` function in place for now — `enable_split()` still uses it for the second viewport (Task: coop chase is a later phase). It no longer runs for the main view.

- [ ] **Step 4: Run to verify it passes**

Run the Step-1 snippet via the godot MCP. Expected: `PASS task7`.
Then `python -m gdtoolkit.parser ApexDuo_Prototype/race_view_3d.gd` → `OK`.
Then confirm the whole view still compiles in-engine: `execute_gdscript` → `print(load("res://race_view_3d.gd") != null)` → `true`, no errors.

- [ ] **Step 5: Commit**

```bash
git add ApexDuo_Prototype/race_view_3d.gd
git commit -m "feat(3d): drive the race view with RaceCameraDirector"
```

---

### Task 8: camera mode buttons + visual acceptance

**Files:**
- Modify: `ApexDuo_Prototype/race_view_3d.gd`

- [ ] **Step 1: Write the failing test**

```gdscript
var V = load("res://race_view_3d.gd").new()
var holder = Node.new(); holder.add_child(V)
V.ensure_built("Монца", 50)
# public mode hooks exist and flip the director
V.cam_tv()
assert(V._director.mode == RaceCameraDirector.Mode.TV, "tv mode")
V.cam_orbit()
assert(V._director.mode == RaceCameraDirector.Mode.ORBIT, "orbit mode")
V.cam_chase(7)
assert(V._director.mode == RaceCameraDirector.Mode.CHASE, "chase mode")
assert(V._director.chase_id == 7, "chase id set")
print("PASS task8")
```

- [ ] **Step 2: Run to verify it fails** — Expected: `cam_tv` not found.

- [ ] **Step 3: Write minimal implementation**

Add these public hooks to `race_view_3d.gd`:

```gdscript
func cam_tv() -> void:
	if _director != null:
		_director.set_mode(RaceCameraDirector.Mode.TV)

func cam_orbit() -> void:
	if _director != null:
		_director.set_mode(RaceCameraDirector.Mode.ORBIT)

func cam_chase(id: int) -> void:
	if _director != null:
		_director.set_chase_id(id)
		_director.set_mode(RaceCameraDirector.Mode.CHASE)
```

Then add an overlay button row inside the view so the user can switch live. In `_ready()`, after `add_child(_box)`, add a small `HBoxContainer` anchored bottom-centre with buttons «Реж.», «Лидер», «Облёт» (P5/P6 chase need the team car ids, wired when the snapshot is known — keep «Лидер» = chase the leader id for now):

```gdscript
	var bar := HBoxContainer.new()
	bar.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	bar.add_theme_constant_override("separation", 6)
	add_child(bar)
	var b_tv := Button.new(); b_tv.text = "Реж."; b_tv.pressed.connect(cam_tv); bar.add_child(b_tv)
	var b_lead := Button.new(); b_lead.text = "Лидер"
	b_lead.pressed.connect(func(): if _director != null: cam_chase(_director._leader_id(_cars)))
	bar.add_child(b_lead)
	var b_orb := Button.new(); b_orb.text = "Облёт"; b_orb.pressed.connect(cam_orbit); bar.add_child(b_orb)
```

- [ ] **Step 4: Run to verify it passes** — Expected: `PASS task8`. `gdtoolkit.parser` → `OK`.

- [ ] **Step 5: Commit**

```bash
git add ApexDuo_Prototype/race_view_3d.gd
git commit -m "feat(3d): camera mode buttons (director / leader chase / orbit)"
```

- [ ] **Step 6: Visual acceptance (user, in the Godot editor)**

Run the project (F5), start a race, toggle **«Вид: 2D ▸ 3D»**. Confirm by eye:
- the camera tracks the leading group and pans smoothly (no teleport/jitter),
- «Облёт» orbits the circuit, «Лидер» rides behind the leader, «Реж.» returns to TV,
- when your P5/P6 enters a battle (orange/attack) or pits, the director cuts to it and returns after a few seconds,
- frame rate is fine on the target machine.

Note any feel issues (too fast/slow pans, FOV, tower distance) → tune the `const`s at the top of `race_camera_3d.gd` (`MOVE_EASE`, `LOOK_EASE`, `TOWER_OUT`, `TOWER_UP`, `CUT_HOLD`, `camera.fov`).

---

## Self-review (done)

- **Spec coverage (§6.1 camera director):** TV tower ring (T1,T3,T6), chase (T5,T6), orbit (T6), auto-director priority battle/SC/pit (T4,T6), smoothing lerp/slerp (T6), mode controls/buttons (T8), integration as pure view reading node transforms + snapshot (T7). Subject = your car/leader (T2). Determinism/“no writes to sim”: the director only reads `car_nodes`+`cars`+`sc_active` and sets its own `Camera3D` — covered by design, nothing calls into the sim. ✅ Phases 2–6 are explicitly out of scope for this plan.
- **Placeholders:** none — every step has real code and a concrete godot-MCP run + expected `PASS`.
- **Type/name consistency:** `setup/set_mode/set_chase_id/update`, fields `camera/mode/chase_id/_towers/_centroid/_radius/_cam_pos/_look/_cut_id/_cut_timer/_orbit_ang`, helpers `_build_towers/_leader_id/_subject_pos/_best_tower/_event_id/_chase_pos`, view hooks `cam_tv/cam_orbit/cam_chase` and field `_director` — all referenced consistently across tasks. `Mode.{TV,CHASE,ORBIT}` used uniformly.
- **Open follow-ups (not this plan):** P5/P6 dedicated chase buttons need the team car ids from the snapshot (wire when integrating with `main.gd`’s slot mapping); coop split chase (`enable_split`) is Phase 5; FOV breathing / micro-sway polish deferred.
