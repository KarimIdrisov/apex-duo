class_name Personnel
extends RefCounted

# ============================================================================
# Apex Duo — team personnel (FM-style staff). Every team has a full staff; each
# role carries attributes (1..20). Some roles feed the RACE SIM (strategist →
# AI strategy quality; race engineers → player info accuracy + driver rapport;
# pit crew → stop time/variance/reliability), the rest are META (R&D, money,
# contracts) handled by season.gd. Generation is deterministic from team
# strength + a role seed, like driver attributes — no hand-authoring 11×9 staff.
# ============================================================================

# role key -> {name, attrs[], sim}. sim=true means it influences the live race.
const ROLES := {
	"principal": {"name": "Руководитель команды", "sim": false,
		"attrs": ["leadership", "vision", "sponsorship"]},
	"strategist": {"name": "Стратег", "sim": true,
		"attrs": ["strategy", "composure", "adaptability"]},
	"engineer1": {"name": "Гоночный инженер №1", "sim": true,
		"attrs": ["telemetry", "tyre_sense", "energy_sense", "rapport"]},
	"engineer2": {"name": "Гоночный инженер №2", "sim": true,
		"attrs": ["telemetry", "tyre_sense", "energy_sense", "rapport"]},
	# M4: "pitcrew" is the CHIEF MECHANIC of the 5-role pit crew (see below).
	# Old attrs (pit_speed/...) replaced: the 3 sim scalars now aggregate from
	# the gunmen/jackmen + chief — see pit_speed()/pit_consistency()/reliability_work().
	"pitcrew": {"name": "Ведущий механик", "sim": true,
		"attrs": ["coordination", "experience"]},
	"techdir": {"name": "Технический директор", "sim": false,
		"attrs": ["development", "aero_dev", "pu_liaison"]},
	"designer": {"name": "Главный конструктор", "sim": false,
		"attrs": ["aero_dev", "innovation", "durability"]},
	"sporting": {"name": "Спортивный директор", "sim": false,
		"attrs": ["negotiation", "politics", "scouting"]},
	"testdriver": {"name": "Тест/резервный пилот", "sim": true,
		"attrs": ["dev_feedback", "pace", "adaptability"]},
	# M4: the four over-the-wall key roles (gunmen drive stop SPEED, jackmen
	# drive stop CONSISTENCY; the chief mechanic above drives reliability_work).
	"gunman_front": {"name": "Передний ганмен", "sim": true,
		"attrs": ["speed", "precision"]},
	"gunman_rear": {"name": "Задний ганмен", "sim": true,
		"attrs": ["speed", "precision"]},
	"jackman_front": {"name": "Передний джекмен", "sim": true,
		"attrs": ["strength", "timing"]},
	"jackman_rear": {"name": "Задний джекмен", "sim": true,
		"attrs": ["strength", "timing"]},
}

# Stable role order (deterministic seeding offset per role; never iterate ROLES
# unordered into the sim). M4 roles appended at the END so existing roles keep
# their per-role seeds (rival staff stays identical for old indices).
const ROLE_ORDER := ["principal", "strategist", "engineer1", "engineer2",
	"pitcrew", "techdir", "designer", "sporting", "testdriver",
	"gunman_front", "gunman_rear", "jackman_front", "jackman_rear"]

class Staff:
	var role: String = ""
	var name: String = ""
	var attrs: Dictionary = {}     # attr key -> 1..20

	func a(key: String) -> int:
		return int(attrs.get(key, 10))
	func a01(key: String) -> float:
		return float(attrs.get(key, 10)) / 20.0
	# Overall 1..20 (mean of the role's attributes) for display.
	func overall() -> int:
		if attrs.is_empty():
			return 10
		var s := 0
		for k in attrs:
			s += int(attrs[k])
		return int(round(float(s) / float(attrs.size())))

# Deterministic staff member: band ~6..18 from team strength + per-attr jitter.
static func gen_staff(role_key: String, strength: float, seed_value: int) -> Staff:
	var r := RaceSim.RNG.new(RaceSim.mix32(seed_value))
	var base := 6.0 + clampf(strength, 0.0, 1.0) * 12.0
	var s := Staff.new()
	s.role = role_key
	s.name = String(ROLES[role_key]["name"])
	var keys: Array = ROLES[role_key]["attrs"]
	for k in keys:
		s.attrs[k] = clampi(int(round(base + r.rangef(-2.0, 2.5))), 1, 20)
	return s

# M2: build a Staff from a persisted Season staff dict ({role, name, attrs{..}}).
# Attr values arrive as int-or-float (JSON quirk) — clamp to 1..20.
static func staff_from_saved(d: Dictionary) -> Staff:
	var s := Staff.new()
	s.role = String(d.get("role", ""))
	s.name = String(d.get("name", ""))
	var raw: Variant = d.get("attrs", {})
	if typeof(raw) == TYPE_DICTIONARY:
		for k in (raw as Dictionary):
			# float-preserving: M4 pit training accumulates fractional attrs
			s.attrs[String(k)] = clampf(float((raw as Dictionary)[k]), 1.0, 20.0)
	return s

# M2: neutral stand-in (all attrs 10) for a role whose person is unavailable
# (gardening leave) — the team falls back to an average replacement.
static func neutral_staff(role_key: String) -> Staff:
	var s := Staff.new()
	s.role = role_key
	s.name = String(ROLES.get(role_key, {}).get("name", role_key))
	var keys: Array = ROLES.get(role_key, {}).get("attrs", [])
	for k in keys:
		s.attrs[k] = 10
	return s

# Full staff for a team (key -> Staff). Strength derives from team index (0 =
# strongest); a star can still appear at a weak team via the per-role jitter.
static func team_staff(team_idx: int, season_seed: int = 0) -> Dictionary:
	var n := F1_2026.team_count()
	var strength := 1.0 - float(clampi(team_idx, 0, n - 1)) / float(maxi(1, n - 1))
	var out := {}
	for ri in ROLE_ORDER.size():
		var rk: String = ROLE_ORDER[ri]
		out[rk] = gen_staff(rk, strength, season_seed * 131 + team_idx * 977 + ri * 7919)
	return out

# --- sim-facing scalars (0..1) -------------------------------------------------
# These are what race_sim reads; computed from the relevant staff member.
static func strategist_skill(staff: Dictionary) -> float:
	return _s01(staff, "strategist", "strategy")
# M4: stop speed = mean of the gunmen's speed + jackmen's strength (design:
# "среднее speed/strength × 0.05" = /20). Verified in meta_m4_pitcrew_check.py.
static func pit_speed(staff: Dictionary) -> float:
	if staff.has("gunman_front"):
		return (_s01(staff, "gunman_front", "speed") + _s01(staff, "gunman_rear", "speed")
			+ _s01(staff, "jackman_front", "strength")
			+ _s01(staff, "jackman_rear", "strength")) / 4.0
	return _s01(staff, "pitcrew", "pit_speed")   # legacy dicts (pre-M4)
# M4: stop consistency = mean of the gunmen's precision + jackmen's timing.
static func pit_consistency(staff: Dictionary) -> float:
	if staff.has("gunman_front"):
		return (_s01(staff, "gunman_front", "precision") + _s01(staff, "gunman_rear", "precision")
			+ _s01(staff, "jackman_front", "timing")
			+ _s01(staff, "jackman_rear", "timing")) / 4.0
	return _s01(staff, "pitcrew", "pit_consistency")
# M4: garage quality = the chief mechanic's coordination + experience.
static func reliability_work(staff: Dictionary) -> float:
	if staff.has("pitcrew"):
		var chief: Staff = staff["pitcrew"]
		if chief.attrs.has("coordination"):
			return (chief.a01("coordination") + chief.a01("experience")) / 2.0
	return _s01(staff, "pitcrew", "reliability_work")
# Race engineer for a given car slot (0 -> engineer1, 1 -> engineer2).
static func engineer_telemetry(staff: Dictionary, slot: int) -> float:
	return _s01(staff, "engineer2" if slot == 1 else "engineer1", "telemetry")
static func engineer_rapport(staff: Dictionary, slot: int) -> float:
	return _s01(staff, "engineer2" if slot == 1 else "engineer1", "rapport")
static func test_feedback(staff: Dictionary) -> float:
	return _s01(staff, "testdriver", "dev_feedback")

static func _s01(staff: Dictionary, role_key: String, attr: String) -> float:
	if not staff.has(role_key):
		return 0.5
	var st: Staff = staff[role_key]
	return st.a01(attr)
