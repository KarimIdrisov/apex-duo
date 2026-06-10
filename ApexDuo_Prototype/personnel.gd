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
	"pitcrew": {"name": "Главный механик / пит-экипаж", "sim": true,
		"attrs": ["pit_speed", "pit_consistency", "reliability_work"]},
	"techdir": {"name": "Технический директор", "sim": false,
		"attrs": ["development", "aero_dev", "pu_liaison"]},
	"designer": {"name": "Главный конструктор", "sim": false,
		"attrs": ["aero_dev", "innovation", "durability"]},
	"sporting": {"name": "Спортивный директор", "sim": false,
		"attrs": ["negotiation", "politics", "scouting"]},
	"testdriver": {"name": "Тест/резервный пилот", "sim": true,
		"attrs": ["dev_feedback", "pace", "adaptability"]},
}

# Stable role order (deterministic seeding offset per role; never iterate ROLES
# unordered into the sim).
const ROLE_ORDER := ["principal", "strategist", "engineer1", "engineer2",
	"pitcrew", "techdir", "designer", "sporting", "testdriver"]

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
static func pit_speed(staff: Dictionary) -> float:
	return _s01(staff, "pitcrew", "pit_speed")
static func pit_consistency(staff: Dictionary) -> float:
	return _s01(staff, "pitcrew", "pit_consistency")
static func reliability_work(staff: Dictionary) -> float:
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
