class_name F1_2026
extends RefCounted

# ============================================================================
# Apex Duo — real 2026 Formula 1 grid (editable data module).
#
# 11 teams, 22 drivers, power units, team principals and the personnel role
# structure the game models. Driver "skill" is a combined car+driver pace
# rating (0..1) reflecting early-2026 form; tweak freely for balance.
#
# NOTE ON LICENSING: Formula 1, team and driver names are trademarks of their
# owners. For a commercial release you need a licence (as F1 Manager does) or
# fictional names with mod support (as Motorsport Manager does). This file is
# the single place to swap real data for fictional — nothing else hard-codes
# names. Roles/principals are as of the start of the 2026 season.
# ============================================================================

# Teams ordered strongest -> weakest (2026 form). Each has two drivers.
const TEAMS := [
	{"name": "McLaren", "pu": "Mercedes", "principal": "Андреа Стелла", "color": "#ff8000",
		"drivers": [{"name": "Норрис", "skill": 0.950}, {"name": "Пиастри", "skill": 0.945}]},
	{"name": "Mercedes", "pu": "Mercedes", "principal": "Тото Вольфф", "color": "#27f4d2",
		"drivers": [{"name": "Антонелли", "skill": 0.940}, {"name": "Расселл", "skill": 0.935}]},
	{"name": "Red Bull Racing", "pu": "Red Bull Ford", "principal": "Лоран Мекис", "color": "#3671c6",
		"drivers": [{"name": "Ферстаппен", "skill": 0.930}, {"name": "Аджар", "skill": 0.800}]},
	{"name": "Ferrari", "pu": "Ferrari", "principal": "Фредерик Вассёр", "color": "#e8002d",
		"drivers": [{"name": "Леклер", "skill": 0.925}, {"name": "Хэмилтон", "skill": 0.915}]},
	{"name": "Williams", "pu": "Mercedes", "principal": "Джеймс Воулз", "color": "#64c4ff",
		"drivers": [{"name": "Сайнс", "skill": 0.830}, {"name": "Албон", "skill": 0.825}]},
	{"name": "Aston Martin", "pu": "Honda", "principal": "Эдриан Ньюи", "color": "#229971",
		"drivers": [{"name": "Алонсо", "skill": 0.815}, {"name": "Стролл", "skill": 0.755}]},
	{"name": "Alpine", "pu": "Mercedes", "principal": "Флавио Бриаторе", "color": "#0093cc",
		"drivers": [{"name": "Гасли", "skill": 0.800}, {"name": "Колапинто", "skill": 0.745}]},
	{"name": "Racing Bulls", "pu": "Red Bull Ford", "principal": "Алан Перман", "color": "#6692ff",
		"drivers": [{"name": "Лоусон", "skill": 0.785}, {"name": "Линдблад", "skill": 0.720}]},
	{"name": "Haas", "pu": "Ferrari", "principal": "Аяо Комацу", "color": "#b6babd",
		"drivers": [{"name": "Окон", "skill": 0.790}, {"name": "Бирман", "skill": 0.760}]},
	{"name": "Audi", "pu": "Audi", "principal": "Маттиа Бинотто", "color": "#00e701",
		"drivers": [{"name": "Хюлькенберг", "skill": 0.780}, {"name": "Бортолето", "skill": 0.730}]},
	{"name": "Cadillac", "pu": "Ferrari", "principal": "Грэм Лаудон", "color": "#c69d6e",
		"drivers": [{"name": "Перес", "skill": 0.760}, {"name": "Боттас", "skill": 0.755}]},
]

# Personnel roles the game models (per team). In Mode A the two race engineers
# are the players' avatars.
const PERSONNEL_ROLES := [
	"Руководитель команды", "Гоночный инженер №1", "Гоночный инженер №2",
	"Технический директор", "Главный конструктор", "Спортивный директор",
	"Главный механик / пит-экипаж", "Стратег", "Тест/резервный пилот",
]

# Career team presets (index into TEAMS) by competitive level.
const TIER_TEAMS := {"top": 0, "mid": 4, "back": 10}   # McLaren / Williams / Cadillac

# --- POWER UNITS (engines) ----------------------------------------------------
# In F1 the engine is built by a separate manufacturer and SHARED by customer
# teams (e.g. Ferrari powers Ferrari, Haas and Cadillac). Keyed by the team `pu`
# field above. power = straight-line/deployment, energy = ERS harvest efficiency,
# rel = engine reliability. The sim composes engine + chassis into one car.
const ENGINES := {
	"Mercedes":      {"power": 0.88, "energy": 0.86, "rel": 0.93},
	"Ferrari":       {"power": 0.87, "energy": 0.84, "rel": 0.88},
	"Honda":         {"power": 0.85, "energy": 0.88, "rel": 0.91},
	"Red Bull Ford": {"power": 0.80, "energy": 0.80, "rel": 0.82},   # brand-new PU
	"Audi":          {"power": 0.78, "energy": 0.82, "rel": 0.78},   # new entrant
}

# --- CHASSIS (per team) -------------------------------------------------------
# The team's own car: aero = downforce, rel = mechanical reliability. Ordered as
# TEAMS. Engine power vs chassis aero gives each car a track-character BIAS
# (power car gains on fast circuits, aero car in the corners); absolute pace
# stays in driver skill. Total reliability = engine.rel × chassis.rel.
const CHASSIS := [
	{"aero": 0.95, "rel": 0.95},   # McLaren — class-leading aero
	{"aero": 0.92, "rel": 0.95},   # Mercedes
	{"aero": 0.90, "rel": 0.92},   # Red Bull — strong chassis, new engine
	{"aero": 0.84, "rel": 0.92},   # Ferrari
	{"aero": 0.74, "rel": 0.92},   # Williams — Merc power, modest aero
	{"aero": 0.84, "rel": 0.90},   # Aston Martin — Newey aero
	{"aero": 0.74, "rel": 0.88},   # Alpine
	{"aero": 0.76, "rel": 0.90},   # Racing Bulls
	{"aero": 0.70, "rel": 0.90},   # Haas — Ferrari power, low downforce
	{"aero": 0.76, "rel": 0.88},   # Audi
	{"aero": 0.70, "rel": 0.86},   # Cadillac — new team, weak chassis
]

# --- CAR-1: Component parts table --------------------------------------------
# Each part develops one primary scalar per level, plus a reliability side-bonus.
# The part_key is the canonical identifier used in season.part_levels.
# Structure per part: {group, label, scalar, per_level, max_level, also, also_rel}
#   group:    "aero" | "power" | "energy" | "reliability"  (UI grouping)
#   scalar:   "d_aero" | "d_power" | "d_energy" | "d_ch_rel"  (primary delta target)
#   per_level: delta added per level for the primary scalar
#   max_level: maximum allowed level for this part
#   also:     {scalar_key: delta_per_level} for secondary bonuses
#   also_rel: {rel_key: delta_per_level} for reliability bonuses
#
# Balance (verified in car_components_check.py):
#   Full aero group (all 3 parts at max):   d_aero = +0.150, d_ch_rel = +0.180
#   Full power group (both at max):         d_power = +0.050
#   Full energy group (both at max):        d_energy = +0.050
#   Full power+energy (combined):           d_eng_rel = +0.150
# These match the META-1 R&D totals exactly — no balance change.
#
# NOTE: PackedVector2Array([...]) and dicts-of-dicts with Vector2 are NOT
# constant expressions in Godot 4. This is a const of plain dicts — valid.
const PARTS := {
	"front_wing": {"group": "aero",         "label": "Переднее крыло",
		"scalar": "d_aero",   "per_level": 0.030, "max_level": 2,
		"also": {},           "also_rel": {"d_ch_rel": 0.030}},
	"rear_wing":  {"group": "aero",         "label": "Заднее крыло",
		"scalar": "d_aero",   "per_level": 0.025, "max_level": 2,
		"also": {},           "also_rel": {"d_ch_rel": 0.030}},
	"floor":      {"group": "aero",         "label": "Днище",
		"scalar": "d_aero",   "per_level": 0.020, "max_level": 2,
		"also": {},           "also_rel": {"d_ch_rel": 0.030}},
	"ice":        {"group": "power",        "label": "ДВС",
		"scalar": "d_power",  "per_level": 0.015, "max_level": 2,
		"also": {},           "also_rel": {"d_eng_rel": 0.020}},
	"turbo":      {"group": "power",        "label": "Турбо",
		"scalar": "d_power",  "per_level": 0.010, "max_level": 2,
		"also": {},           "also_rel": {"d_eng_rel": 0.020}},
	"battery":    {"group": "energy",       "label": "Батарея",
		"scalar": "d_energy", "per_level": 0.015, "max_level": 2,
		"also": {},           "also_rel": {"d_eng_rel": 0.018}},
	"ers":        {"group": "energy",       "label": "MGU-K / ERS",
		"scalar": "d_energy", "per_level": 0.010, "max_level": 2,
		"also": {},           "also_rel": {"d_eng_rel": 0.017}},
	"gearbox":    {"group": "reliability",  "label": "КПП",
		"scalar": "d_ch_rel", "per_level": 0.025, "max_level": 2,
		"also": {"d_aero": 0.005}, "also_rel": {}},
	"cooling":    {"group": "reliability",  "label": "Охлаждение",
		"scalar": "d_ch_rel", "per_level": 0.025, "max_level": 2,
		"also": {"d_power": 0.005}, "also_rel": {}},
}

# --- R&D car-upgrade state (META-1) ------------------------------------------
# Season.gd calls apply_rd_upgrades() before each race to prime these static
# vars. team_car() then applies them when building the player's team car.
# Opponents are never affected. Set _rd_team_idx = -1 to disable (no upgrades).
static var _rd_team_idx: int = -1
static var _rd_delta_aero: float = 0.0
static var _rd_delta_power: float = 0.0
static var _rd_delta_energy: float = 0.0
static var _rd_delta_ch_rel: float = 0.0
static var _rd_delta_eng_rel: float = 0.0

# Primes the static R&D upgrade state. Called by Season.apply_car_rd() before
# _make_sim so that team_car() for the player team returns the upgraded car.
static func apply_rd_upgrades(
		team_idx: int,
		d_aero: float,
		d_power: float,
		d_energy: float,
		d_ch_rel: float,
		d_eng_rel: float
) -> void:
	_rd_team_idx      = team_idx
	_rd_delta_aero    = d_aero
	_rd_delta_power   = d_power
	_rd_delta_energy  = d_energy
	_rd_delta_ch_rel  = d_ch_rel
	_rd_delta_eng_rel = d_eng_rel

# CAR-1: Compose part levels -> {d_aero, d_power, d_energy, d_ch_rel, d_eng_rel}.
# Sums each part's per_level contribution for the actual level held.
# This is the translation layer between tangible part levels (in season.part_levels)
# and the 5 car-scalar deltas passed to apply_rd_upgrades() / team_car().
# Signature and output format are intentionally identical to car_rd_deltas() in season.gd
# so the existing apply_car_rd() call chain needs no changes.
static func compose_part_deltas(levels: Dictionary) -> Dictionary:
	var out := {"d_aero": 0.0, "d_power": 0.0, "d_energy": 0.0, "d_ch_rel": 0.0, "d_eng_rel": 0.0}
	for part_key: String in levels:
		if not PARTS.has(part_key):
			continue
		var pdef: Dictionary = PARTS[part_key]
		var max_lv: int = int(pdef["max_level"])
		var lvl: int = clampi(int(levels[part_key]), 0, max_lv)
		if lvl <= 0:
			continue
		# Primary scalar
		var primary: String = String(pdef["scalar"])
		out[primary] = float(out[primary]) + float(pdef["per_level"]) * float(lvl)
		# Secondary "also" bonuses (e.g. gearbox -> tiny aero)
		var also: Dictionary = pdef["also"]
		for sk: String in also:
			if out.has(sk):
				out[sk] = float(out[sk]) + float(also[sk]) * float(lvl)
		# Reliability side-bonus (e.g. front_wing -> d_ch_rel)
		var also_rel: Dictionary = pdef["also_rel"]
		for rk: String in also_rel:
			if out.has(rk):
				out[rk] = float(out[rk]) + float(also_rel[rk]) * float(lvl)
	return out

static func team_count() -> int:
	return TEAMS.size()

static func team_name(player_team: int) -> String:
	return TEAMS[clampi(player_team, 0, TEAMS.size() - 1)]["name"]

static func team_principal(player_team: int) -> String:
	return TEAMS[clampi(player_team, 0, TEAMS.size() - 1)]["principal"]

static func team_pu(player_team: int) -> String:
	return TEAMS[clampi(player_team, 0, TEAMS.size() - 1)]["pu"]

# Builds the FULL race grid (all teams × 2 = 22 cars) for the chosen player team.
# The player team's two drivers take ids 4 and 5 (team = true); every other
# driver fills the remaining ids in skill order. Deterministic, so season
# standings stay aligned with the field across rounds.
static func grid_size() -> int:
	return TEAMS.size() * 2

static func team_engine(team_idx: int) -> Dictionary:
	var pu: String = TEAMS[clampi(team_idx, 0, TEAMS.size() - 1)]["pu"]
	return ENGINES.get(pu, {"power": 0.78, "energy": 0.78, "rel": 0.80})

# Composes the shared engine with the team's chassis into one car the sim reads:
# power/energy from the engine, aero from the chassis, reliability = the product.
# If the player's team (tracked by _rd_team_idx) has R&D upgrades primed via
# apply_rd_upgrades(), those deltas are applied here — so the upgrade flows through
# the existing CAR_K track-character bias and harvest_mult, not as a flat bonus.
static func team_car(team_idx: int) -> Dictionary:
	var ti: int = clampi(team_idx, 0, TEAMS.size() - 1)
	var eng: Dictionary = team_engine(ti)
	var ch: Dictionary = CHASSIS[ti]
	var eng_power: float = float(eng["power"])
	var eng_energy: float = float(eng["energy"])
	var eng_rel: float = float(eng["rel"])
	var ch_aero: float = float(ch["aero"])
	var ch_rel: float = float(ch["rel"])
	# Apply R&D upgrades for the player's team if primed by season.gd
	if ti == _rd_team_idx:
		eng_power  += _rd_delta_power
		eng_energy += _rd_delta_energy
		eng_rel     = minf(0.99, eng_rel + _rd_delta_eng_rel)
		ch_aero    += _rd_delta_aero
		ch_rel      = minf(0.99, ch_rel + _rd_delta_ch_rel)
	return {
		"power": eng_power, "aero": ch_aero,
		"energy": eng_energy, "rel": eng_rel * ch_rel,
		"pu": String(TEAMS[ti]["pu"]),
	}

static func race_grid(player_team: int) -> Array:
	var pt := clampi(player_team, 0, TEAMS.size() - 1)
	var rivals: Array = []
	for ti in TEAMS.size():
		if ti == pt:
			continue
		var dl: Array = TEAMS[ti]["drivers"]
		for di in dl.size():
			rivals.append({"name": dl[di]["name"], "skill": dl[di]["skill"],
				"color": TEAMS[ti]["color"], "slot": di, "team_name": TEAMS[ti]["name"],
				"car": team_car(ti), "team_idx": ti})
	rivals.sort_custom(func(a, b): return a["skill"] > b["skill"])
	var total := TEAMS.size() * 2
	var grid: Array = []
	grid.resize(total)
	var pd: Array = TEAMS[pt]["drivers"]
	var pc: String = TEAMS[pt]["color"]
	var pn: String = TEAMS[pt]["name"]
	var pcar: Dictionary = team_car(pt)
	grid[4] = {"name": pd[0]["name"], "skill": pd[0]["skill"], "team": true, "color": pc, "slot": 0, "team_name": pn, "car": pcar, "team_idx": pt}
	grid[5] = {"name": pd[1]["name"], "skill": pd[1]["skill"], "team": true, "color": pc, "slot": 1, "team_name": pn, "car": pcar, "team_idx": pt}
	var ri := 0
	for gid in total:
		if gid == 4 or gid == 5:
			continue
		var r: Dictionary = rivals[ri]
		grid[gid] = {"name": r["name"], "skill": r["skill"], "team": false,
			"color": r["color"], "slot": r["slot"], "team_name": r["team_name"], "car": r["car"],
			"team_idx": r["team_idx"]}
		ri += 1
	return grid

# The 10 grid driver names in id order (for season standings labels).
static func grid_names(player_team: int) -> Array:
	var out: Array = []
	for e in race_grid(player_team):
		out.append(e["name"])
	return out
