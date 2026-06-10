class_name Season
extends RefCounted

# ============================================================================
# Apex Duo — season / championship layer (Stage 3 meta).
# Holds the calendar, championship standings, team budget and R&D upgrades.
# A single instance lives in the static `active` slot and survives scene
# changes (paddock hub <-> race) for the whole play session.
# ============================================================================

const POINTS := [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]

# ============================================================
# M1: CONSTRUCTOR PRIZE TABLE (per round, per team, scaled)
# ---------------------------------------------------------------
# Source: real 2026 prize-fund proportions scaled to game economy.
# P1 ≈ 5.6× P10 (real ratio preserved; absolute numbers scaled down
# so $3–8M starting budgets remain meaningful over a 5-round season).
# Design corridors (acceptance criterion 6):
#   Underdog  P10 + full sponsor pack → $350–550k/round  ✓
#   Contender P1  + full sponsor pack → $700–1000k/round ✓
# Indexed 0 = P1 constructor … 10 = P11 constructor.
const CONSTRUCTOR_PRIZE := [
	280_000,   # P1  constructor
	240_000,   # P2
	200_000,   # P3
	170_000,   # P4
	140_000,   # P5
	115_000,   # P6
	 95_000,   # P7
	 78_000,   # P8
	 62_000,   # P9
	 50_000,   # P10
	 38_000,   # P11 (safety floor)
]

# ============================================================
# M1: SPONSOR SYSTEM
# ---------------------------------------------------------------
# Slots: 1 title (exclusive) + 2 partner slots.
# Tech-partner slot is M3 scope — not implemented here.
# Each sponsor is a Dictionary with these keys (see _new_sponsor()):
#   id, name, tier, base_payment, goal_type, goal_target,
#   goal_scope, bonus_payment, duration_seasons, exclusive,
#   active, goal_progress, goal_met, goal_failed
#
# goal_type values: "position" | "points" | "both_finish" |
#                   "no_dnf"   | "fastest_lap"
# goal_scope values: "season" | "single_race" | "any_3_races"
#
# Title sponsor payment range: $300k–$600k base/round + $150–400k bonus
# Partner sponsor range:        $80k–$200k base/round + $50–$150k bonus
#
# These base ranges are encoded in the generated offers (SPONSOR_OFFERS_*).
# Justification: keeps underdog full-package in $350–550k corridor and
# contender in $700–1000k corridor (verified meta_m1_income_check.py).

# Sponsor offer generation seed material.
# Mixed with cal_seed so offers are unique per season, not per save-load.
const SPONSOR_SEED_MIX: int = 0xDEADF00D

# Max sponsors from the market shown at once.
const SPONSOR_MARKET_SIZE: int = 5

# Slot counts (tech partner excluded until M3).
const SPONSOR_SLOT_TITLE: int    = 1
const SPONSOR_SLOT_PARTNER: int  = 2

# ---- Sponsor name pool (const — plain string arrays, valid const expressions) ----
const SPONSOR_NAMES_TITLE := [
	"GlobalFuel Corp", "TechDrive AI", "Apex Capital", "CityBank F1",
	"NovaPower Group", "VeloSport International", "QuantumMotors",
	"OmniRacing Ltd", "HyperDrive Finance", "Atlas Performance",
]
const SPONSOR_NAMES_PARTNER := [
	"SpeedLink Pro", "FasterCar Systems", "ElectroDrive", "PrecisionAero",
	"UltraCharge", "NanoTech Racing", "GridEdge", "ApexWear",
	"Torque Analytics", "SlipStream Media", "RacePulse", "VectorFuel",
]

# ---- Goal pools for title / partner (tier-appropriate) ----
# Each entry: [goal_type, goal_target, goal_scope, bonus]
# goal_target meaning: position goal = finish position P≤N; points goal = season total.
const SPONSOR_GOALS_TITLE := [
	["position",    8, "season",       250_000],   # finish in top-8 constructors
	["points",     30, "season",       300_000],   # 30+ team points this season
	["both_finish", 0, "any_3_races",  350_000],   # both finish in any 3 races
	["no_dnf",      0, "season",       400_000],   # zero DNFs entire season
]
const SPONSOR_GOALS_PARTNER := [
	["both_finish", 0, "single_race",   80_000],   # both finish in one specific race
	["fastest_lap", 0, "any_3_races",   90_000],   # fastest lap in any 3 races
	["points",     12, "season",        70_000],   # 12+ team points this season
	["no_dnf",      0, "any_3_races",  100_000],   # no DNF across any 3 races
	["position",    6, "single_race",   60_000],   # finish P6 or better in one race
]
const NAMES := ["Норрис", "Пиастри", "Ферстаппен", "Леклер", "Антонелли",
	"Расселл", "Хэмилтон", "Сайнс", "Албон", "Алонсо"]   # default grid (Mercedes player)
const TEAM_IDS := [4, 5]
const TEAM_NAME := "Apex Duo Racing"
const SAVE_FILE := "apex_duo_season.json"
const SAVE_PATH := "user://apex_duo_season.json"

# Starting teams (career identity). skill = pace offset for both team cars.
const TEAM_TIERS := [
	{"name": "Контендер", "team": 0, "money": 8_000_000, "rp": 8,
		"goal": "Бороться за титул", "desc": "McLaren — топ-команда: быстрая машина, мало бюджета на рост."},
	{"name": "Середняк", "team": 4, "money": 5_000_000, "rp": 14,
		"goal": "Очки и подиумы", "desc": "Williams — середина пелотона: сбалансированный старт."},
	{"name": "Андердог", "team": 10, "money": 3_000_000, "rp": 22,
		"goal": "Прогресс сезона", "desc": "Cadillac — аутсайдер: слабая машина, зато большой R&D-задел."},
]
# Difficulty shifts every rival's pace (negative = rivals slower = easier).
const DIFFICULTY := [
	{"name": "Лёгкая", "rival": -0.12},
	{"name": "Обычная", "rival": 0.0},
	{"name": "Сложная", "rival": 0.12},
]
# Driver development: young drivers grow faster than veterans.
const DRIVER_YOUNG := {4: true, 5: false}   # P5 — растущий пилот, P6 — стабильный
const DEV_RATE_YOUNG := 0.008               # skill gained per race (young)  [preserved]
const DEV_RATE_VET := 0.002                 # skill gained per race (veteran) [preserved]

# META-2: Per-attribute development. Verified in meta2_driver_dev_check.py.
# All attr deltas are in SKILL UNITS (0..1 normalised), NOT FM 0..20 display scale.
# dev_of(id) = sum(driver_attr_dev[id]) — identical to old driver_dev[id] semantics.
# Potential multiplier: a high-potential young driver grows faster across all attrs.
const DEV_POTENTIAL_HIGH: float = 1.35     # +35% growth vs normal
# Which driver ids get the high-potential multiplier.
const DRIVER_HIGH_POTENTIAL := {4: true, 5: false}   # P5 = young prodigy
# Racing-style archetypes: determines which attrs grow most.
# Values are un-normalised weights; they are normalised per-call.
# Stored as an Array-of-Arrays (not dict-of-dict) to stay a constant expression.
# Layout: each inner array is [key, weight] for each of the 12 ATTR_KEYS.
# ATTR_KEYS order: pace, overtaking, defending, tyre, energy,
#                  race_iq, composure, consistency, aggression, discipline, wet, starts
const DEV_STYLE_AGGRESSOR := [3.0, 4.0, 1.0, 0.5, 0.5, 1.0, 1.0, 0.5, 3.5, 0.5, 1.0, 2.0]
const DEV_STYLE_SMOOTH     := [1.5, 1.0, 2.0, 4.5, 3.0, 3.5, 2.5, 4.0, 0.5, 3.0, 1.5, 1.0]
const DEV_STYLE_BALANCED   := [2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0]
# Which style each driver uses (index: 0=aggressor, 1=smooth, 2=balanced).
const DRIVER_DEV_STYLE := {4: 0, 5: 1}   # P5 aggressor, P6 smooth
# Dev RNG base seed (deterministic; mixed with driver id + round).
const DEV_BASE_SEED := 999983

# R&D → Car constants (META-1). Verified in meta1_rnd_car_check.py.
# Aero branch: each step adds delta_aero to the player chassis aero (max 6 steps).
# Track-character effect: +aero helps at high-downforce tracks (Monaco/Singapore),
# trades away some power-track advantage (Monza/Bahrain) — flows through CAR_K.
const RD_AERO_STEP: float = 0.025       # chassis aero per step
const RD_AERO_MAX_STEPS: int = 6        # max 6 steps -> +0.150 total aero
const RD_AERO_REL_STEP: float = 0.030   # chassis rel per step (reliability folded in)
# Powertrain branch: each step adds delta_power + delta_energy to the player engine.
const RD_PWT_POWER_STEP: float = 0.010   # engine power per step
const RD_PWT_ENERGY_STEP: float = 0.010  # engine energy per step (-> harvest_mult)
const RD_PWT_MAX_STEPS: int = 5          # max 5 steps -> +0.050 total power/energy (matches existing UI cap)
const RD_PWT_REL_STEP: float = 0.030    # engine rel per step (reliability folded in)

# META-3: Cost cap + driver contracts. Verified in meta3_costcap_check.py.
# Cap rule: SOFT PENALTY. Cumulative driver salary spend over the season is
# tracked. If it exceeds SALARY_CAP, the excess incurs an RP penalty next round
# (CAP_PENALTY_DIVISOR: each 100_000 over cap = -1 RP). This is a soft rule —
# no hard block — so new players are never softlocked; they pay a mild tax for
# overspending. R&D is funded by RP (separate resource) and is NOT capped here.
# Budget units: abstract units consistent with the prototype money economy.
const SALARY_CAP: int = 4_000_000         # cumulative salary budget per season
const CAP_PENALTY_DIVISOR: int = 100_000  # 1 RP penalty per 100k over cap per round
# Default per-round driver salary by team tier (index 0/1/2 = contender/mid/back).
const SALARY_DEFAULT := [300_000, 200_000, 100_000]
# Premium salary — used when signing a star driver (re-sign or transfer).
const SALARY_PREMIUM := [600_000, 450_000, 300_000]
# Transfer fee to sign a rival driver: BASE + skill * MULT (no RNG, deterministic).
const TRANSFER_FEE_BASE: int = 500_000
const TRANSFER_FEE_SKILL_MULT: float = 2_000_000.0
# Re-sign cost on contract expiry (renewing your own driver).
const RESIGN_COST_BASE: int = 200_000
# Default contract length in seasons for a new team.
const CONTRACT_LENGTH_DEFAULT: int = 2

static var active: Season

var round_index := 0
var coop := false
var race_pending := false
var race_quick := false            # instant-sim the next round (no live race view)
var money := 5_000_000
var rp := 14                       # start with a little R&D to spend
# Legacy display fields (read by season_hub.gd for upgrade labels). The new
# car-delta system uses car_aero_steps / car_pwt_steps as the canonical counters.
var skill_bonus := 0.0             # mirrors car_aero_steps * RD_AERO_STEP (display only)
var wear_bonus := 0.0              # 0..0.36; tyre R&D (not part of car-delta system)
var energy_bonus := 0.0            # mirrors car_pwt_steps * 0.06, capped 0..0.30 (display)
# Car R&D step counters — kept as legacy mirrors for season_hub.gd display
# compatibility and old-save migration. The canonical per-part state is
# part_levels (below). buy_aero/buy_energy are superseded by buy_part() but
# kept so any remaining hub code that calls them still works.
var car_aero_steps: int = 0        # 0..RD_AERO_MAX_STEPS  (derived from part_levels)
var car_pwt_steps: int = 0         # 0..RD_PWT_MAX_STEPS   (derived from part_levels)
# CAR-1: per-part level dictionary (part_key -> level). Canonical R&D state.
# Keys must match F1_2026.PARTS. Default = all 0 (initialised below).
var part_levels: Dictionary = {}
var cal_seed := 0                  # seed for the procedurally generated calendar
var team_tier := 1                 # index into TEAM_TIERS
var difficulty := 1                # index into DIFFICULTY
var team_name := TEAM_NAME
var goal := ""
var team_base_skill := 0.0         # tier pace offset applied to team cars
var rival_skill_offset := 0.0      # difficulty pace offset applied to rivals
var player_team := 1               # index into F1_2026.TEAMS (the team you run)
var grid_names: Array = []         # 10 driver names by grid id (for standings)
var driver_dev := {}               # team driver id -> accumulated skill growth (LEGACY; kept for migration)
var driver_attr_dev := {}          # META-2: driver id -> {attr: cumulative_skill_delta}
var driver_morale := {}            # team driver id -> morale 0..100
var standings := {}                # driver id -> championship points
var calendar := []
var last_summary := {}             # filled after each race for the hub
var stats := {}                    # driver id -> FM-style season stats
# META-3: Cost cap + contracts state
# contracts[i] is a dict with keys: driver_id, salary_per_round, length_seasons, rounds_remaining
# Indexed 0 = P5 (TEAM_IDS[0]=4), 1 = P6 (TEAM_IDS[1]=5).
var contracts: Array = []
var cumulative_salary_spend: int = 0   # tracks total salary paid this season (vs SALARY_CAP)
var cap_penalty_pending: int = 0       # RP to deduct at start of next race weekend

# M1: Sponsor system state
# active_sponsors: Array of sponsor Dicts (max 3: 1 title + 2 partner).
# sponsor_offers:  Array of currently available market offers (generated once per season).
# payout_log:      Array of {"round": int, "amount": int, "from": String} (display only).
var active_sponsors: Array = []
var sponsor_offers: Array = []
var payout_log: Array = []

func _init() -> void:
	for id in TEAM_IDS:
		driver_dev[id] = 0.0
		driver_morale[id] = 70
		driver_attr_dev[id] = _new_attr_dev()
	grid_names = F1_2026.grid_names(player_team)
	for i in grid_names.size():        # full grid (all teams × 2)
		standings[i] = 0
		stats[i] = _new_stat()
	cal_seed = _new_cal_seed()
	_rebuild_calendar()
	# META-3: default contracts (salary set properly by configure())
	_init_default_contracts(1)   # mid-tier default; configure() overwrites
	# CAR-1: initialise all part levels to 0
	_init_part_levels()
	# M1: initialise sponsor offers (empty until configure() sets cal_seed properly)
	active_sponsors = []
	sponsor_offers = []
	payout_log = []

func _new_stat() -> Dictionary:
	return {"races": 0, "wins": 0, "podiums": 0, "poles": 0, "fl": 0,
		"overtakes": 0, "gained": 0, "best": 0, "dnf": 0}

# Returns a zeroed per-attribute dev dict (skill units; all 12 attrs = 0.0).
# Key order matches RaceSim.ATTR_KEYS.
func _new_attr_dev() -> Dictionary:
	return {"pace": 0.0, "overtaking": 0.0, "defending": 0.0, "tyre": 0.0,
		"energy": 0.0, "race_iq": 0.0, "composure": 0.0, "consistency": 0.0,
		"aggression": 0.0, "discipline": 0.0, "wet": 0.0, "starts": 0.0}

# LCG step — mirrors the Python harness RNG (deterministic, no real-time).
func _lcg_step(state: int) -> Array:
	var next_state: int = (state * 1664525 + 1013904223) & 0xFFFFFFFF
	var fval: float = float(next_state & 0xFFFF) / 65535.0
	return [next_state, fval]

# Deterministic per-driver-per-round dev seed.
func _dev_seed(driver_id: int, round_idx: int) -> int:
	return (DEV_BASE_SEED ^ (driver_id * 2654435761) ^ (round_idx * 22695477)) & 0xFFFFFFFF

# Returns the un-normalised weight array for a driver's style.
func _style_weights(driver_id: int) -> Array:
	var style_idx: int = DRIVER_DEV_STYLE.get(driver_id, 2)
	match style_idx:
		0: return DEV_STYLE_AGGRESSOR
		1: return DEV_STYLE_SMOOTH
		_: return DEV_STYLE_BALANCED

# Compute and accumulate per-attribute skill-unit deltas for one race.
# Adds to driver_attr_dev[id] in place.
func _develop_driver_attrs(id: int, round_idx: int) -> void:
	var is_young: bool = bool(DRIVER_YOUNG.get(id, false))
	var rate: float = DEV_RATE_YOUNG if is_young else DEV_RATE_VET
	var potential: float = DEV_POTENTIAL_HIGH if bool(DRIVER_HIGH_POTENTIAL.get(id, false)) else 1.0
	var total_dev: float = rate * potential

	var raw_weights: Array = _style_weights(id)
	# Normalise weights
	var w_sum: float = 0.0
	for w in raw_weights:
		w_sum += float(w)
	if w_sum <= 0.0:
		w_sum = 1.0

	var seed: int = _dev_seed(id, round_idx)
	var ad: Dictionary = driver_attr_dev.get(id, _new_attr_dev())
	var attr_keys: Array = ["pace", "overtaking", "defending", "tyre",
		"energy", "race_iq", "composure", "consistency",
		"aggression", "discipline", "wet", "starts"]
	for i in attr_keys.size():
		var res: Array = _lcg_step(seed)
		seed = int(res[0])
		var noise_f: float = float(res[1])
		# jitter ±10% around 1.0
		var noise_factor: float = 1.0 + (noise_f - 0.5) * 0.20
		var w: float = float(raw_weights[i]) / w_sum
		var delta: float = total_dev * w * noise_factor
		var k: String = attr_keys[i]
		ad[k] = float(ad.get(k, 0.0)) + delta
	driver_attr_dev[id] = ad

# Accumulate FM-style season stats from a finished race.
# results: [{id, pos, grid, passes, best_lap}], any order.
func record_race(results: Array) -> void:
	var fl_id := -1
	var fl_time := 1.0e9
	for r in results:
		var bl: float = float(r.get("best_lap", 0.0))
		if bl > 0.0 and bl < fl_time:
			fl_time = bl
			fl_id = int(r["id"])
	for r in results:
		var id: int = int(r["id"])
		if not stats.has(id):
			stats[id] = _new_stat()
		var st: Dictionary = stats[id]
		var pos: int = int(r["pos"])
		var grid: int = int(r.get("grid", pos))
		st["races"] += 1
		if pos == 1:
			st["wins"] += 1
		if pos <= 3:
			st["podiums"] += 1
		if grid == 1:
			st["poles"] += 1
		st["overtakes"] += int(r.get("passes", 0))
		st["gained"] += grid - pos
		if not bool(r.get("dnf", false)) and (int(st["best"]) == 0 or pos < int(st["best"])):
			st["best"] = pos
		if bool(r.get("dnf", false)):
			st["dnf"] += 1
		if id == fl_id:
			st["fl"] += 1

func stat_of(id: int) -> Dictionary:
	return stats.get(id, _new_stat())

# Season leader for a stat key, e.g. "wins" or "overtakes".
func stats_leader(key: String) -> Dictionary:
	var best_id := -1
	var best_val := -1
	for id in stats:
		var v: int = int(stats[id].get(key, 0))
		if v > best_val:
			best_val = v
			best_id = id
	if best_id < 0:
		return {}
	return {"id": best_id, "name": driver_name(best_id), "val": best_val}

func _stats_to_array() -> Array:
	var out: Array = []
	for i in grid_names.size():
		out.append(stats.get(i, _new_stat()))
	return out

func _new_cal_seed() -> int:
	var s := int(Time.get_unix_time_from_system() * 1000.0) ^ randi()
	return s if s != 0 else 999983

# CAR-1: Initialise part_levels dict from F1_2026.PARTS keys (all zero).
func _init_part_levels() -> void:
	part_levels = {}
	for k: String in F1_2026.PARTS:
		part_levels[k] = 0

# CAR-1: Cost to upgrade a part by one level.
# Base cost = 5 + current_level * 3 (matches old aero/energy cost curves).
func cost_part(part_key: String) -> int:
	var lvl: int = int(part_levels.get(part_key, 0))
	return 5 + lvl * 3

# CAR-1: Buy one level for a part. Deducts RP, updates part_levels, mirrors
# legacy counters (car_aero_steps / car_pwt_steps), re-primes F1_2026 state.
# Returns true on success (enough RP, part not maxed).
func buy_part(part_key: String) -> bool:
	if not F1_2026.PARTS.has(part_key):
		return false
	var pdef: Dictionary = F1_2026.PARTS[part_key]
	var max_lv: int = int(pdef["max_level"])
	var cur_lv: int = int(part_levels.get(part_key, 0))
	if cur_lv >= max_lv:
		return false
	var c: int = cost_part(part_key)
	if rp < c:
		return false
	rp -= c
	part_levels[part_key] = cur_lv + 1
	_sync_legacy_steps()
	apply_car_rd()
	return true

# CAR-1: Sync the legacy step counters from part_levels so existing hub code
# that reads car_aero_steps / car_pwt_steps still shows sensible values.
# car_aero_steps = sum of aero-group levels (max 6).
# car_pwt_steps  = sum of power+energy-group levels clamped to 5.
func _sync_legacy_steps() -> void:
	var aero_sum: int = 0
	var pwt_sum: int = 0
	for k: String in F1_2026.PARTS:
		var pdef: Dictionary = F1_2026.PARTS[k]
		var lvl: int = int(part_levels.get(k, 0))
		var grp: String = String(pdef["group"])
		if grp == "aero":
			aero_sum += lvl
		elif grp == "power" or grp == "energy":
			pwt_sum += lvl
	car_aero_steps = clampi(aero_sum, 0, RD_AERO_MAX_STEPS)
	car_pwt_steps  = clampi(pwt_sum,  0, RD_PWT_MAX_STEPS * 2)  # combined can exceed old max
	# Keep display mirrors in sync
	skill_bonus  = float(car_aero_steps) * RD_AERO_STEP
	energy_bonus = minf(0.30, float(car_pwt_steps) * 0.03)

# Build the season calendar from the F1-archetype track generator: one circuit
# of each character (power / street / high-speed / technical / modern), jittered.
func _rebuild_calendar() -> void:
	calendar = RaceSim.real_calendar(cal_seed, 5)

# ---------------------------------------------------------------- META-3 helpers

# Returns a fresh contract dict for a given driver id and tier.
func _new_contract(driver_id: int, tier: int) -> Dictionary:
	var sal: int = int(SALARY_DEFAULT[clampi(tier, 0, 2)])
	return {
		"driver_id": driver_id,
		"salary_per_round": sal,
		"length_seasons": CONTRACT_LENGTH_DEFAULT,
		"rounds_remaining": CONTRACT_LENGTH_DEFAULT * 5,
	}

# Initialise both driver contracts to tier defaults.
# Call once at start of a new season (or after migration).
func _init_default_contracts(tier: int) -> void:
	contracts = []
	for id in TEAM_IDS:
		contracts.append(_new_contract(id, tier))

# Transfer fee to sign a rival driver (deterministic: based on skill only).
func transfer_fee(rival_skill: float) -> int:
	return int(TRANSFER_FEE_BASE + rival_skill * TRANSFER_FEE_SKILL_MULT)

# Re-sign cost for a player driver at contract expiry.
func resign_cost(_driver_id: int) -> int:
	var tier_idx: int = clampi(team_tier, 0, 2)
	return RESIGN_COST_BASE + int(SALARY_PREMIUM[tier_idx]) / 2

# Returns the contract dict for a given driver id (by TEAM_IDS index).
# Returns an empty dict if not found.
func contract_of(driver_id: int) -> Dictionary:
	for c in contracts:
		if int((c as Dictionary).get("driver_id", -1)) == driver_id:
			return c as Dictionary
	return {}

# Pay salary for all contracted drivers this round.
# Deducts from money (clamped to 0, never negative), records cumulative spend,
# evaluates cap, and stores any pending RP penalty.
func _pay_salaries() -> void:
	var salary_this_round: int = 0
	for i in contracts.size():
		var c: Dictionary = contracts[i]
		var sal: int = int(c.get("salary_per_round", 0))
		var actual: int = mini(money, sal)
		money -= actual
		salary_this_round += actual
		# decrement rounds_remaining
		var rem: int = int(c.get("rounds_remaining", 0))
		c["rounds_remaining"] = maxi(0, rem - 1)
	cumulative_salary_spend += salary_this_round
	# Evaluate soft cap: overspend -> RP penalty next round
	var overspend: int = maxi(0, cumulative_salary_spend - SALARY_CAP)
	if overspend > 0:
		cap_penalty_pending = maxi(1, overspend / CAP_PENALTY_DIVISOR)
	else:
		cap_penalty_pending = 0

# Apply any pending cap RP penalty (call at start of apply_results or buy phase).
func _apply_cap_penalty() -> void:
	if cap_penalty_pending > 0:
		rp = maxi(0, rp - cap_penalty_pending)
		cap_penalty_pending = 0

# Returns true if a driver's contract has expired (rounds_remaining == 0).
func contract_expired(driver_id: int) -> bool:
	var c: Dictionary = contract_of(driver_id)
	if c.is_empty():
		return false
	return int(c.get("rounds_remaining", 1)) <= 0

# Re-sign a driver at contract expiry. Costs RESIGN_COST_BASE money.
# Returns true on success, false if insufficient funds or not expired.
func resign_driver(driver_id: int) -> bool:
	if not contract_expired(driver_id):
		return false
	var cost: int = resign_cost(driver_id)
	if money < cost:
		return false
	money -= cost
	for i in contracts.size():
		var c: Dictionary = contracts[i]
		if int(c.get("driver_id", -1)) == driver_id:
			c["rounds_remaining"] = CONTRACT_LENGTH_DEFAULT * 5
			c["length_seasons"] = CONTRACT_LENGTH_DEFAULT
			return true
	return false

# Sign a rival driver from the grid (basic transfer market).
# rival_skill: the driver's skill value (from F1_2026 grid); rival_name unused here.
# Replaces the contract slot for driver_id (P5 or P6 only).
# Returns true on success (funds deducted), false if not enough money.
func sign_rival(driver_id: int, rival_skill: float, rival_salary: int) -> bool:
	if not (driver_id in TEAM_IDS):
		return false
	var fee: int = transfer_fee(rival_skill)
	if money < fee:
		return false
	money -= fee
	# Update contract slot for this driver with the new salary
	for i in contracts.size():
		var c: Dictionary = contracts[i]
		if int(c.get("driver_id", -1)) == driver_id:
			c["salary_per_round"] = rival_salary
			c["rounds_remaining"] = CONTRACT_LENGTH_DEFAULT * 5
			c["length_seasons"] = CONTRACT_LENGTH_DEFAULT
			return true
	return false

# Upgrade salary for a driver (promotes default -> premium).
# Returns true if money was sufficient.
func upgrade_salary(driver_id: int) -> bool:
	var tier_idx: int = clampi(team_tier, 0, 2)
	var premium: int = int(SALARY_PREMIUM[tier_idx])
	for i in contracts.size():
		var c: Dictionary = contracts[i]
		if int(c.get("driver_id", -1)) == driver_id:
			var current_sal: int = int(c.get("salary_per_round", 0))
			if current_sal >= premium:
				return false   # already at premium
			# cost = difference for remaining rounds (one-time upgrade fee)
			var rem: int = maxi(1, int(c.get("rounds_remaining", 1)))
			var upgrade_cost: int = (premium - current_sal) * rem
			if money < upgrade_cost:
				return false
			money -= upgrade_cost
			c["salary_per_round"] = premium
			return true
	return false

# ---------------------------------------------------------------- M1 helpers

# Returns the constructor-prize income for a given 1-based position.
# Position ≥ 12 or < 1 returns 0 (safety; 11 teams in 2026 grid).
func constructor_prize(pos_1indexed: int) -> int:
	var i: int = pos_1indexed - 1
	if i < 0 or i >= CONSTRUCTOR_PRIZE.size():
		return 0
	return int(CONSTRUCTOR_PRIZE[i])

# Returns the player team's current constructor position (1-based).
# Computed from standings: count unique team-point-totals above the player total.
# Simplified (single-team model): counts how many teams score more combined points.
func constructor_position() -> int:
	# Sum points for each team index across the 22-driver grid (2 per team).
	# F1_2026 grid is ordered: TEAMS × 2 drivers, starting at index 0.
	# Player team ids are always TEAM_IDS = [4, 5]. Rivals fill the rest.
	var player_pts: int = constructor_points()
	# Build rival team totals: F1_2026 has 11 teams × 2 drivers = 22 grid IDs.
	# Grid IDs 0..21 in order. Player team is at TEAM_IDS (4, 5).
	# Rivals: 10 other teams; their 2 driver IDs are all IDs except 4 and 5.
	# Simple approach: count how many NON-player-team total-point-blocks beat us.
	var rival_team_totals: Array = []
	for base in range(0, 22, 2):
		if base == 4:   # player team slot (IDs 4 and 5)
			continue
		var team_pts: int = int(standings.get(base, 0)) + int(standings.get(base + 1, 0))
		rival_team_totals.append(team_pts)
	var above: int = 0
	for rp_val in rival_team_totals:
		if int(rp_val) > player_pts:
			above += 1
	return above + 1   # P1 if no one is above

# Builds a new (empty) sponsor dict with all required fields.
func _new_sponsor(id_val: int, name_val: String, tier_val: String,
		base_val: int, goal_type_val: String, goal_target_val: int,
		goal_scope_val: String, bonus_val: int, duration_val: int,
		exclusive_val: bool) -> Dictionary:
	return {
		"id":             id_val,
		"name":           name_val,
		"tier":           tier_val,
		"base_payment":   base_val,
		"goal_type":      goal_type_val,
		"goal_target":    goal_target_val,
		"goal_scope":     goal_scope_val,
		"bonus_payment":  bonus_val,
		"duration_seasons": duration_val,
		"exclusive":      exclusive_val,
		"active":         true,
		"goal_progress":  0,       # races in which goal was met so far
		"goal_met":       false,   # season-scope: permanently met
		"goal_failed":    false,   # season-scope: permanently failed (no_dnf after a DNF)
	}

# Deterministic LCG step (same polynomial as _lcg_step; separated for clarity).
func _sponsor_lcg(state: int) -> Array:
	var next_state: int = (state * 1664525 + 1013904223) & 0xFFFFFFFF
	var fval: float = float(next_state & 0xFFFF) / 65535.0
	return [next_state, fval]

# Generate the season's sponsor-market offers deterministically from cal_seed.
# Two calls with the same cal_seed always produce the same list (acceptance #4).
func _generate_sponsor_offers() -> Array:
	# Mix cal_seed with SPONSOR_SEED_MIX so offers are independent of race RNG.
	var s: int = (int(cal_seed) ^ int(SPONSOR_SEED_MIX)) & 0xFFFFFFFF
	var offers: Array = []
	# Title slots: 2 offers
	for _ti in 2:
		var res: Array = _sponsor_lcg(s)
		s = int(res[0])
		var name_idx: int = int(float(res[1]) * float(SPONSOR_NAMES_TITLE.size()))
		name_idx = clampi(name_idx, 0, SPONSOR_NAMES_TITLE.size() - 1)

		res = _sponsor_lcg(s)
		s = int(res[0])
		var base_pay: int = int(300_000 + float(res[1]) * 300_000.0)  # 300k..600k

		res = _sponsor_lcg(s)
		s = int(res[0])
		var goal_idx: int = int(float(res[1]) * float(SPONSOR_GOALS_TITLE.size()))
		goal_idx = clampi(goal_idx, 0, SPONSOR_GOALS_TITLE.size() - 1)
		var gdef: Array = SPONSOR_GOALS_TITLE[goal_idx]

		offers.append(_new_sponsor(
			offers.size(),
			String(SPONSOR_NAMES_TITLE[name_idx]),
			"title",
			base_pay,
			String(gdef[0]),
			int(gdef[1]),
			String(gdef[2]),
			int(gdef[3]),
			1,
			true
		))

	# Partner slots: 3 offers
	for _pi in 3:
		var res2: Array = _sponsor_lcg(s)
		s = int(res2[0])
		var name_idx2: int = int(float(res2[1]) * float(SPONSOR_NAMES_PARTNER.size()))
		name_idx2 = clampi(name_idx2, 0, SPONSOR_NAMES_PARTNER.size() - 1)

		res2 = _sponsor_lcg(s)
		s = int(res2[0])
		var base_pay2: int = int(80_000 + float(res2[1]) * 120_000.0)  # 80k..200k

		res2 = _sponsor_lcg(s)
		s = int(res2[0])
		var goal_idx2: int = int(float(res2[1]) * float(SPONSOR_GOALS_PARTNER.size()))
		goal_idx2 = clampi(goal_idx2, 0, SPONSOR_GOALS_PARTNER.size() - 1)
		var gdef2: Array = SPONSOR_GOALS_PARTNER[goal_idx2]

		offers.append(_new_sponsor(
			offers.size(),
			String(SPONSOR_NAMES_PARTNER[name_idx2]),
			"partner",
			base_pay2,
			String(gdef2[0]),
			int(gdef2[1]),
			String(gdef2[2]),
			int(gdef2[3]),
			1,
			false
		))

	return offers

# Public: regenerate sponsor offers (call after configure() sets cal_seed, or on
# a new season). Idempotent if already generated — call once per season start.
func ensure_sponsor_offers() -> void:
	if sponsor_offers.is_empty():
		sponsor_offers = _generate_sponsor_offers()

# Count active sponsors of a given tier.
func _sponsor_count(tier: String) -> int:
	var n: int = 0
	for sp in active_sponsors:
		if String((sp as Dictionary).get("tier", "")) == tier and bool((sp as Dictionary).get("active", true)):
			n += 1
	return n

# Public: list current market offers (generates on first call per season).
func list_sponsor_offers() -> Array:
	ensure_sponsor_offers()
	return sponsor_offers

# Public: sign a sponsor from the offer list by offer id.
# Returns true on success, false if the slot is full or offer not found.
# The signed sponsor is removed from sponsor_offers and added to active_sponsors.
func sign_sponsor(offer_id: int) -> bool:
	ensure_sponsor_offers()
	var offer_idx: int = -1
	for i in sponsor_offers.size():
		if int((sponsor_offers[i] as Dictionary).get("id", -1)) == offer_id:
			offer_idx = i
			break
	if offer_idx < 0:
		return false
	var sp: Dictionary = sponsor_offers[offer_idx]
	var tier: String = String(sp.get("tier", "partner"))
	# Check slot availability
	if tier == "title" and _sponsor_count("title") >= SPONSOR_SLOT_TITLE:
		return false
	if tier == "partner" and _sponsor_count("partner") >= SPONSOR_SLOT_PARTNER:
		return false
	# Sign: move from offers to active
	active_sponsors.append(sp.duplicate(true))
	sponsor_offers.remove_at(offer_idx)
	return true

# ---- Goal evaluation (called from apply_results) ----

# Returns true if driver id is in order_ids (not DNF).
func _driver_finished(id: int, order_ids: Array, dnf_ids: Array) -> bool:
	return (id in order_ids) and not (id in dnf_ids)

# Evaluate all active sponsor goals against a race result.
# dnf_ids: Array of driver ids that DNF'd this race.
# fl_id: driver id with fastest lap (-1 if none).
# team_pos: team P5 and P6 finishing positions dict {id: 1-based pos}.
# Called BEFORE round_index is incremented.
func _evaluate_sponsor_goals(order_ids: Array, dnf_ids: Array, fl_id: int) -> void:
	# Determine team car positions
	var team_pos: Dictionary = {}
	for i in order_ids.size():
		var id: int = int(order_ids[i])
		if id in TEAM_IDS:
			team_pos[id] = i + 1

	for i in active_sponsors.size():
		var sp: Dictionary = active_sponsors[i]
		if not bool(sp.get("active", true)):
			continue
		if bool(sp.get("goal_failed", false)):
			continue
		if bool(sp.get("goal_met", false)):
			continue
		var gtype: String = String(sp.get("goal_type", ""))
		var gtarget: int = int(sp.get("goal_target", 0))
		var gscope: String = String(sp.get("goal_scope", "season"))

		var race_met: bool = false
		match gtype:
			"position":
				# Team's BEST finish this race <= gtarget
				for id in TEAM_IDS:
					if team_pos.has(id) and not (id in dnf_ids):
						if int(team_pos[id]) <= gtarget:
							race_met = true
			"points":
				# Season scope: total team points this season (updated in apply_results
				# before here — we read constructor_points() post-update)
				if gscope == "season":
					if constructor_points() >= gtarget:
						race_met = true
			"both_finish":
				# Both team cars in order_ids AND neither DNF'd
				var p5_ok: bool = _driver_finished(TEAM_IDS[0], order_ids, dnf_ids)
				var p6_ok: bool = _driver_finished(TEAM_IDS[1], order_ids, dnf_ids)
				race_met = p5_ok and p6_ok
			"no_dnf":
				# Any team-car DNF fails the goal permanently
				if TEAM_IDS[0] in dnf_ids or TEAM_IDS[1] in dnf_ids:
					sp["goal_failed"] = true
					continue   # skip progress update
				race_met = true   # this race clean — progress irrelevant, not met until scope
			"fastest_lap":
				race_met = (fl_id in TEAM_IDS)

		if race_met:
			sp["goal_progress"] = int(sp.get("goal_progress", 0)) + 1

		# Check if the goal is now fully met based on scope
		var progress: int = int(sp.get("goal_progress", 0))
		match gscope:
			"single_race":
				if race_met:
					sp["goal_met"] = true
			"any_3_races":
				if progress >= 3:
					sp["goal_met"] = true
			"season":
				if gtype == "no_dnf":
					# Season no_dnf: met only at end of season if never failed.
					# Mark as met at the last round (round_index == total_rounds - 1).
					if round_index == total_rounds() - 1 and not bool(sp.get("goal_failed", false)):
						sp["goal_met"] = true
				else:
					if race_met:
						sp["goal_met"] = true

# Collect sponsor income for the current round. Called inside apply_results.
# Returns total payout and appends to payout_log.
func _collect_sponsor_income(dnf_ids: Array, fl_id: int, order_ids: Array) -> int:
	# Goals are evaluated first (before income collection).
	_evaluate_sponsor_goals(order_ids, dnf_ids, fl_id)
	var total: int = 0
	for sp in active_sponsors:
		if not bool(sp.get("active", true)):
			continue
		var base: int = int(sp.get("base_payment", 0))
		total += base
		# Bonus: single-race goals that were just met this round, or any-3-races that
		# just hit 3, or season-scope that just met.
		if bool(sp.get("goal_met", false)):
			var already_paid: bool = bool(sp.get("bonus_paid", false))
			if not already_paid:
				total += int(sp.get("bonus_payment", 0))
				sp["bonus_paid"] = true
				payout_log.append({
					"round": round_index + 1,
					"amount": int(sp.get("bonus_payment", 0)),
					"from": String(sp.get("name", "?")) + " (бонус)"
				})
		payout_log.append({"round": round_index + 1, "amount": base,
			"from": String(sp.get("name", "?"))})
	# Trim log to last 20 entries (UI only needs recent)
	if payout_log.size() > 20:
		payout_log = payout_log.slice(payout_log.size() - 20)
	return total

# Public: current income per round (prize + base sponsor payments). Used by UI.
func income_per_round() -> int:
	var pos: int = constructor_position()
	var prize: int = constructor_prize(pos)
	var sponsor_base: int = 0
	for sp in active_sponsors:
		if bool((sp as Dictionary).get("active", true)):
			sponsor_base += int((sp as Dictionary).get("base_payment", 0))
	return prize + sponsor_base

# ---- Sponsor serialisation helpers ----

func _sponsors_to_array(slist: Array) -> Array:
	var out: Array = []
	for sp in slist:
		var d: Dictionary = (sp as Dictionary).duplicate(true)
		# Ensure all int fields survive JSON float round-trip by storing as int.
		d["id"]               = int(d.get("id", 0))
		d["base_payment"]     = int(d.get("base_payment", 0))
		d["goal_target"]      = int(d.get("goal_target", 0))
		d["bonus_payment"]    = int(d.get("bonus_payment", 0))
		d["duration_seasons"] = int(d.get("duration_seasons", 1))
		d["goal_progress"]    = int(d.get("goal_progress", 0))
		out.append(d)
	return out

func _sponsors_from_array(raw: Array) -> Array:
	var out: Array = []
	for entry in raw:
		if typeof(entry) != TYPE_DICTIONARY:
			continue
		var sd: Dictionary = entry as Dictionary
		out.append(_new_sponsor(
			int(float(sd.get("id", 0))),
			String(sd.get("name", "?")),
			String(sd.get("tier", "partner")),
			int(float(sd.get("base_payment", 0))),
			String(sd.get("goal_type", "points")),
			int(float(sd.get("goal_target", 0))),
			String(sd.get("goal_scope", "season")),
			int(float(sd.get("bonus_payment", 0))),
			int(float(sd.get("duration_seasons", 1))),
			bool(sd.get("exclusive", false))
		))
		# Restore mutable state fields
		var sp: Dictionary = out[out.size() - 1]
		sp["active"]       = bool(sd.get("active", true))
		sp["goal_progress"]= int(float(sd.get("goal_progress", 0)))
		sp["goal_met"]     = bool(sd.get("goal_met", false))
		sp["goal_failed"]  = bool(sd.get("goal_failed", false))
		if sd.has("bonus_paid"):
			sp["bonus_paid"] = bool(sd.get("bonus_paid", false))
	return out

# Return a human-readable cap status string (for UI). Russian.
func cap_status_text() -> String:
	var over: int = maxi(0, cumulative_salary_spend - SALARY_CAP)
	if over == 0:
		var remaining: int = SALARY_CAP - cumulative_salary_spend
		return "Зарплатный кап: в рамках (остаток $%s)" % _format_money(remaining)
	var penalty: int = maxi(1, over / CAP_PENALTY_DIVISOR)
	return "Зарплатный кап: ПРЕВЫШЕН на $%s (штраф %d RP)" % [_format_money(over), penalty]

# Simple money formatter (no Godot deps — mirrors _money() in season_hub.gd).
func _format_money(v: int) -> String:
	var s := str(absi(v))
	var out := ""
	var cnt := 0
	for i in range(s.length() - 1, -1, -1):
		out = s[i] + out
		cnt += 1
		if cnt % 3 == 0 and i > 0:
			out = " " + out
	return out

# Apply the chosen team tier + difficulty (called from the setup screen).
func configure(tier: int, diff: int, is_coop: bool) -> void:
	team_tier = clampi(tier, 0, TEAM_TIERS.size() - 1)
	difficulty = clampi(diff, 0, DIFFICULTY.size() - 1)
	coop = is_coop
	var t: Dictionary = TEAM_TIERS[team_tier]
	player_team = int(t["team"])
	team_name = F1_2026.team_name(player_team)
	team_base_skill = 0.0          # competitiveness comes from the real drivers
	grid_names = F1_2026.grid_names(player_team)
	money = int(t["money"])
	rp = int(t["rp"])
	goal = t["goal"]
	rival_skill_offset = DIFFICULTY[difficulty]["rival"]
	# CAR-1: initialise part_levels if not yet set (fresh season or called before _init)
	if part_levels.is_empty():
		_init_part_levels()
	apply_car_rd()   # prime F1_2026's static R&D state for the new team
	# META-3: set default contracts for the chosen tier (only if contracts are empty
	# so that load_from_disk() calling configure() doesn't overwrite loaded contracts)
	if contracts.is_empty():
		_init_default_contracts(team_tier)
	# M1: generate sponsor market offers deterministically from cal_seed (only if not
	# already loaded from a save — _apply_dict restores sponsor_offers directly).
	if sponsor_offers.is_empty() and active_sponsors.is_empty():
		sponsor_offers = _generate_sponsor_offers()

func difficulty_name() -> String:
	return DIFFICULTY[difficulty]["name"]

func total_rounds() -> int:
	return calendar.size()

func is_complete() -> bool:
	return round_index >= calendar.size()

func round_name() -> String:
	if is_complete():
		return "Сезон завершён"
	return calendar[round_index].name

func current_track() -> RaceSim.Track:
	return calendar[round_index]

# Archetype of the upcoming circuit (for the paddock preview).
func round_archetype() -> String:
	if is_complete():
		return ""
	return calendar[round_index].archetype

func team_wear_mult() -> float:
	return maxf(0.6, 1.0 - wear_bonus)

# --- R&D economy ---
func cost_aero() -> int:
	return 6 + car_aero_steps * 3

func cost_tyre() -> int:
	return 5 + int(round(wear_bonus / 0.06)) * 3

# buy_aero(): increments car_aero_steps (car R&D) and keeps legacy skill_bonus
# in sync for season_hub.gd display. Capped at RD_AERO_MAX_STEPS.
func buy_aero() -> bool:
	var c := cost_aero()
	if rp >= c and car_aero_steps < RD_AERO_MAX_STEPS:
		rp -= c
		car_aero_steps += 1
		skill_bonus = float(car_aero_steps) * RD_AERO_STEP   # keep display in sync
		apply_car_rd()   # immediately update F1_2026 static state
		return true
	return false

func buy_tyre() -> bool:
	var c := cost_tyre()
	if rp >= c and wear_bonus < 0.36:
		rp -= c
		wear_bonus += 0.06
		return true
	return false

func cost_energy() -> int:
	return 5 + car_pwt_steps * 3

# buy_energy(): increments car_pwt_steps (car R&D) and keeps legacy energy_bonus
# in sync for season_hub.gd display. Capped at RD_PWT_MAX_STEPS (=5).
func buy_energy() -> bool:
	var c := cost_energy()
	if rp >= c and car_pwt_steps < RD_PWT_MAX_STEPS:
		rp -= c
		car_pwt_steps += 1
		# Keep display in sync (energy_bonus display was 0..0.30 at 5 steps of 0.06)
		energy_bonus = minf(0.30, float(car_pwt_steps) * 0.06)
		apply_car_rd()   # immediately update F1_2026 static state
		return true
	return false

# Returns the current R&D car deltas (used by apply_car_rd).
# CAR-1: uses compose_part_deltas when part_levels has been populated;
# falls back to legacy step-counter formula for safety (should not happen
# in normal play, but guards against race conditions in loading).
func car_rd_deltas() -> Dictionary:
	if not part_levels.is_empty():
		return F1_2026.compose_part_deltas(part_levels)
	# Legacy fallback (e.g. called before _init_part_levels in edge cases)
	var aero_s: int = clampi(car_aero_steps, 0, RD_AERO_MAX_STEPS)
	var pwt_s: int = clampi(car_pwt_steps, 0, RD_PWT_MAX_STEPS)
	return {
		"d_aero":    float(aero_s) * RD_AERO_STEP,
		"d_power":   float(pwt_s)  * RD_PWT_POWER_STEP,
		"d_energy":  float(pwt_s)  * RD_PWT_ENERGY_STEP,
		"d_ch_rel":  float(aero_s) * RD_AERO_REL_STEP,
		"d_eng_rel": float(pwt_s)  * RD_PWT_REL_STEP,
	}

# Primes F1_2026's static R&D state so that team_car() returns the upgraded
# player car for this race. Call this before _make_sim (e.g. from the race launch).
func apply_car_rd() -> void:
	var d: Dictionary = car_rd_deltas()
	F1_2026.apply_rd_upgrades(
		player_team,
		float(d["d_aero"]),
		float(d["d_power"]),
		float(d["d_energy"]),
		float(d["d_ch_rel"]),
		float(d["d_eng_rel"])
	)

# Powertrain R&D display helpers (kept for season_hub.gd compatibility).
# Note: energy_bonus is now a display mirror of car_pwt_steps * 0.06 (max 0.30).
func team_soc_max() -> float:
	return 100.0 + energy_bonus * 100.0     # up to 130% usable charge
func team_harvest_mult() -> float:
	return 1.0 + energy_bonus * 1.2         # up to ~1.36x regen

# --- results ---
# order_ids: driver ids in finishing order (index 0 = P1).
# dnf_ids: (optional) Array of driver ids that retired — used for sponsor goal eval.
# fl_id:   (optional) driver id who set fastest lap (-1 = none).
func apply_results(order_ids: Array, dnf_ids: Array = [], fl_id: int = -1) -> void:
	# META-3: apply any RP cap penalty accumulated from last round's salary evaluation
	_apply_cap_penalty()
	var gained_pts := 0
	for i in order_ids.size():
		var id: int = int(order_ids[i])
		var pts: int = POINTS[i] if i < POINTS.size() else 0
		standings[id] += pts
		if id in TEAM_IDS:
			gained_pts += pts

	# M1: constructor-prize income (replaces old per-car positional formula)
	var constructor_pos: int = constructor_position()
	var prize_income: int = constructor_prize(constructor_pos)
	# M1: sponsor base payments + goal evaluation + bonuses
	var sponsor_income: int = _collect_sponsor_income(dnf_ids, fl_id, order_ids)
	var gained_money: int = prize_income + sponsor_income

	rp += 12 + gained_pts
	money += gained_money
	last_summary = {
		"round": round_index + 1,
		"pts": gained_pts,
		"money": gained_money,
		"prize": prize_income,
		"sponsor": sponsor_income,
		"constructor_pos": constructor_pos,
		"rp": rp,
	}
	_update_drivers(order_ids)
	round_index += 1
	# META-3: pay driver salaries and evaluate cap after each round
	_pay_salaries()

# Update team drivers' morale (by result + teammate duel) and development.
func _update_drivers(order_ids: Array) -> void:
	var pos := {}
	for i in order_ids.size():
		pos[order_ids[i]] = i + 1
	for id in TEAM_IDS:
		var p: int = pos.get(id, 20)
		var m: int = driver_morale[id]
		if p <= 3:
			m += 8
		elif p <= 6:
			m += 4
		elif p <= 10:
			m += 1
		else:
			m -= 5
		driver_morale[id] = clampi(m, 0, 100)
		# META-2: per-attribute development (back-compat: driver_dev[id] mirrors dev_of(id))
		_develop_driver_attrs(id, round_index)
		driver_dev[id] = dev_of(id)   # keep legacy field in sync for migration safety
	# teammate head-to-head
	var a: int = TEAM_IDS[0]
	var b: int = TEAM_IDS[1]
	var pa: int = pos.get(a, 99)
	var pb: int = pos.get(b, 99)
	if pa < pb:
		driver_morale[a] = clampi(driver_morale[a] + 5, 0, 100)
		driver_morale[b] = clampi(driver_morale[b] - 5, 0, 100)
	elif pb < pa:
		driver_morale[b] = clampi(driver_morale[b] + 5, 0, 100)
		driver_morale[a] = clampi(driver_morale[a] - 5, 0, 100)

# Pace bonus/penalty from morale (~±0.04 skill at the extremes).
func morale_mod(id: int) -> float:
	return (float(driver_morale.get(id, 50)) - 50.0) / 1200.0

# dev_of(id) — back-compat public API used by main.gd and season_hub.gd.
# Returns the aggregate skill delta: sum of all per-attr deltas in skill units.
# Equals old driver_dev[id] semantics (within noise) for potential=1.0 drivers.
# High-potential drivers (DRIVER_HIGH_POTENTIAL) return slightly more.
func dev_of(id: int) -> float:
	var ad: Dictionary = driver_attr_dev.get(id, {})
	if ad.is_empty():
		return float(driver_dev.get(id, 0.0))   # fallback for pre-META-2 state
	var total: float = 0.0
	for k in ad:
		total += float(ad[k])
	return total

# NEW accessor: per-attribute delta in skill units for a given attr key.
# Returns 0.0 if id or attr is unknown. Used for future sim-wiring (follow-up).
func attr_dev_of(id: int, attr: String) -> float:
	var ad: Dictionary = driver_attr_dev.get(id, {})
	return float(ad.get(attr, 0.0))

func morale_of(id: int) -> int:
	return driver_morale.get(id, 70)

func driver_name(id: int) -> String:
	if id >= 0 and id < grid_names.size() and String(grid_names[id]) != "":
		return String(grid_names[id])
	return NAMES[id] if (id >= 0 and id < NAMES.size()) else "?"

func standings_sorted() -> Array:
	var arr: Array = []
	for id in standings:
		arr.append({"id": id, "name": driver_name(id), "points": standings[id],
			"team": id in TEAM_IDS})
	arr.sort_custom(func(a, b): return a["points"] > b["points"])
	return arr

func constructor_points() -> int:
	var p := 0
	for id in TEAM_IDS:
		p += standings[id]
	return p

func champion_name() -> String:
	var s := standings_sorted()
	return s[0]["name"] if s.size() > 0 else "?"

# ---------------------------------------------------------------- save / load

# Serialise driver_attr_dev to a JSON-safe dict keyed by string id.
# Values are float skill-unit deltas; float() on load handles int->float quirk.
func _attr_dev_to_dict() -> Dictionary:
	var out := {}
	for id in TEAM_IDS:
		var ad: Dictionary = driver_attr_dev.get(id, _new_attr_dev())
		out[str(id)] = ad.duplicate()
	return out

func to_dict() -> Dictionary:
	var st: Array = []
	for i in grid_names.size():
		st.append(standings[i])
	# CAR-1: serialise part_levels as a plain dict (string keys, int values)
	var pl_out: Dictionary = {}
	for k: String in part_levels:
		pl_out[k] = int(part_levels[k])
	return {
		"round_index": round_index,
		"coop": coop,
		"money": money,
		"rp": rp,
		# Legacy display fields (kept so old saves don't corrupt season_hub.gd UI)
		"skill_bonus": skill_bonus,
		"wear_bonus": wear_bonus,
		"energy_bonus": energy_bonus,
		# Legacy step counters (kept for backward-compat; derived from part_levels now)
		"car_aero_steps": car_aero_steps,
		"car_pwt_steps": car_pwt_steps,
		# CAR-1: per-part levels (canonical R&D state)
		"part_levels": pl_out,
		"cal_seed": cal_seed,
		"player_team": player_team,
		"team_tier": team_tier,
		"difficulty": difficulty,
		"driver_dev": [driver_dev[TEAM_IDS[0]], driver_dev[TEAM_IDS[1]]],
		"driver_morale": [driver_morale[TEAM_IDS[0]], driver_morale[TEAM_IDS[1]]],
		# META-2: per-attribute dev (keyed by string id so JSON round-trips cleanly)
		"driver_attr_dev": _attr_dev_to_dict(),
		"standings": st,
		"stats": _stats_to_array(),
		"last_summary": last_summary,
		# META-3: cost cap + contracts
		"cumulative_salary_spend": cumulative_salary_spend,
		"cap_penalty_pending": cap_penalty_pending,
		"contracts": contracts.duplicate(true),
		# M1: sponsor system
		"active_sponsors": _sponsors_to_array(active_sponsors),
		"sponsor_offers":  _sponsors_to_array(sponsor_offers),
		"payout_log":      payout_log.duplicate(true),
	}

func save_to_disk() -> void:
	var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if f != null:
		f.store_string(JSON.stringify(to_dict()))
		f.close()

static func has_save() -> bool:
	return FileAccess.file_exists(SAVE_PATH)

static func delete_save() -> void:
	var d := DirAccess.open("user://")
	if d != null and d.file_exists(SAVE_FILE):
		d.remove(SAVE_FILE)

# CAR-1: Migrate old step counters to part_levels.
# Aero slot map: 6 slots map to part levels in round-robin so partial
# investment distributes fairly. Full 6 steps produce d_aero=+0.150, d_ch_rel=+0.180.
# PWT: interleaved power/energy slot fill (5 old steps → 8 part-levels), monotone and
# exact at 0 and full investment (partial saves keep power+energy roughly balanced).
# Called only once per old save; no balance jump at full investment.
static func _migrate_steps_to_parts(s: Season, aero_steps: int, pwt_steps: int) -> void:
	# Aero slot map: (part_key, level) for each of the 6 old-step slots
	var aero_slots: Array = [
		["front_wing", 1], ["rear_wing", 1], ["floor", 1],
		["front_wing", 2], ["rear_wing", 2], ["floor", 2],
	]
	var a_clamped: int = clampi(aero_steps, 0, 6)
	for i in a_clamped:
		var slot: Array = aero_slots[i]
		s.part_levels[String(slot[0])] = int(slot[1])

	# PWT: interleaved power/energy slot fill (5 old steps → 8 part-levels). Monotone —
	# low investment is never lost (the old proportional round dropped pwt_steps=1 to 0);
	# exact at 0 and at full investment, power+energy stay roughly balanced in between.
	var pwt_slots: Array = [
		["ice", 1], ["battery", 1], ["turbo", 1], ["ers", 1],
		["ice", 2], ["battery", 2], ["turbo", 2], ["ers", 2],
	]
	var p_clamped: int = clampi(pwt_steps, 0, RD_PWT_MAX_STEPS)
	var n_slots: int = int(round(float(p_clamped) * float(pwt_slots.size()) / float(RD_PWT_MAX_STEPS)))
	for i in n_slots:
		var pslot: Array = pwt_slots[i]
		s.part_levels[String(pslot[0])] = int(pslot[1])

# ---------------------------------------------------------------- from_dict / load_from_disk
# Common parser: applies a Dictionary payload to a freshly-created Season instance.
# Used by both load_from_disk (from file JSON) and from_dict (from RPC payload).
# All int(float(...)) casts are intentional: JSON and RPC both produce floats for
# integer fields, so this guard handles both paths identically.
static func _apply_dict(s: Season, data: Dictionary) -> void:
	s.round_index = int(data.get("round_index", 0))
	s.coop = bool(data.get("coop", false))
	s.money = int(data.get("money", 5_000_000))
	s.rp = int(data.get("rp", 0))
	# Legacy display fields (kept inert — the car-delta system uses step counters)
	s.skill_bonus  = float(data.get("skill_bonus",  0.0))
	s.wear_bonus   = float(data.get("wear_bonus",   0.0))
	s.energy_bonus = float(data.get("energy_bonus", 0.0))
	# Car R&D step counters (META-1).
	# Migration: if not present (old save), derive from legacy bonus fields.
	if data.has("car_aero_steps"):
		s.car_aero_steps = int(float(data["car_aero_steps"]))   # int(float()) handles JSON int->float
	else:
		s.car_aero_steps = int(round(s.skill_bonus / 0.025))    # migrate from legacy
	if data.has("car_pwt_steps"):
		s.car_pwt_steps = int(float(data["car_pwt_steps"]))
	else:
		s.car_pwt_steps = int(round(s.energy_bonus / 0.06))     # migrate from legacy
	# Clamp to valid range in case of corrupted saves
	s.car_aero_steps = clampi(s.car_aero_steps, 0, RD_AERO_MAX_STEPS)
	s.car_pwt_steps  = clampi(s.car_pwt_steps,  0, RD_PWT_MAX_STEPS)
	# Re-sync legacy display fields from canonical step counters (keeps hub UI correct)
	s.skill_bonus  = float(s.car_aero_steps) * RD_AERO_STEP
	s.energy_bonus = minf(0.30, float(s.car_pwt_steps) * 0.06)
	# --- CAR-1: part_levels loading + migration ---
	# Path A: save has "part_levels" dict -> restore directly (int(float()) for quirk).
	# Path B: no "part_levels" (old META-1 save) -> migrate from step counters.
	s._init_part_levels()   # start with all-zero dict with correct keys
	var pl_raw: Variant = data.get("part_levels", null)
	if typeof(pl_raw) == TYPE_DICTIONARY:
		# Path A: new save — read levels, clamp to valid range, ignore unknown keys
		for pk: String in F1_2026.PARTS:
			var pl_dict: Dictionary = pl_raw as Dictionary
			if pl_dict.has(pk):
				var max_lv: int = int(F1_2026.PARTS[pk]["max_level"])
				s.part_levels[pk] = clampi(int(float(pl_dict[pk])), 0, max_lv)
	else:
		# Path B: old save — migrate step counters to part_levels
		_migrate_steps_to_parts(s, s.car_aero_steps, s.car_pwt_steps)
	s._sync_legacy_steps()   # keep legacy counters in sync with loaded part_levels
	# restore team tier + difficulty (also rebuilds derived offsets/name/goal)
	s.configure(int(data.get("team_tier", 1)), int(data.get("difficulty", 1)),
		bool(data.get("coop", false)))
	# restore the procedurally generated calendar deterministically
	s.cal_seed = int(data.get("cal_seed", s.cal_seed))
	s._rebuild_calendar()
	s.player_team = int(data.get("player_team", s.player_team))
	s.grid_names = F1_2026.grid_names(s.player_team)
	# configure() resets money/rp to tier defaults — restore saved values after
	s.money = int(data.get("money", 5_000_000))
	s.rp = int(data.get("rp", 0))
	var st: Variant = data.get("standings", [])
	if typeof(st) == TYPE_ARRAY:
		for i in mini(st.size(), s.grid_names.size()):
			s.standings[i] = int(st[i])
	var sa: Variant = data.get("stats", [])
	if typeof(sa) == TYPE_ARRAY:
		for i in mini(sa.size(), s.grid_names.size()):
			var sd: Variant = sa[i]
			if typeof(sd) == TYPE_DICTIONARY:
				var nst := s._new_stat()
				for k in nst:
					nst[k] = int((sd as Dictionary).get(k, 0))
				s.stats[i] = nst
	# --- driver_dev (legacy scalar) ---
	var dv: Variant = data.get("driver_dev", [])
	if typeof(dv) == TYPE_ARRAY and dv.size() == TEAM_IDS.size():
		for i in TEAM_IDS.size():
			s.driver_dev[TEAM_IDS[i]] = float(dv[i])
	# --- META-2: per-attribute dev + migration ---
	# Migration path A: save has "driver_attr_dev" -> restore floats directly.
	# Migration path B: no "driver_attr_dev" key (old save) -> distribute old scalar evenly.
	var dav: Variant = data.get("driver_attr_dev", null)
	var attr_keys_load := ["pace", "overtaking", "defending", "tyre",
		"energy", "race_iq", "composure", "consistency",
		"aggression", "discipline", "wet", "starts"]
	var n_attrs: int = attr_keys_load.size()
	if typeof(dav) == TYPE_DICTIONARY:
		# Path A: new save — read per-attr floats (handles int->float JSON quirk)
		for id in TEAM_IDS:
			var sid := str(id)
			if (dav as Dictionary).has(sid):
				var entry: Variant = (dav as Dictionary)[sid]
				if typeof(entry) == TYPE_DICTIONARY:
					var ad := s._new_attr_dev()
					for k in attr_keys_load:
						ad[k] = float((entry as Dictionary).get(k, 0.0))
					s.driver_attr_dev[id] = ad
				else:
					s.driver_attr_dev[id] = s._new_attr_dev()
			else:
				s.driver_attr_dev[id] = s._new_attr_dev()
	else:
		# Path B: old save — migrate scalar to balanced-distributed attr deltas.
		for id in TEAM_IDS:
			var old_scalar: float = float(s.driver_dev.get(id, 0.0))
			var per_attr: float = old_scalar / float(n_attrs)
			var ad := s._new_attr_dev()
			for k in attr_keys_load:
				ad[k] = per_attr
			s.driver_attr_dev[id] = ad
	# Keep legacy driver_dev in sync with the new representation
	for id in TEAM_IDS:
		s.driver_dev[id] = s.dev_of(id)
	# ---
	var mr: Variant = data.get("driver_morale", [])
	if typeof(mr) == TYPE_ARRAY and mr.size() == TEAM_IDS.size():
		for i in TEAM_IDS.size():
			s.driver_morale[TEAM_IDS[i]] = int(mr[i])
	var ls: Variant = data.get("last_summary", {})
	if typeof(ls) == TYPE_DICTIONARY and not (ls as Dictionary).is_empty():
		var lsd: Dictionary = ls as Dictionary
		s.last_summary = {
			"round":           int(float(lsd.get("round",           0))),
			"pts":             int(float(lsd.get("pts",             0))),
			"money":           int(float(lsd.get("money",           0))),
			"rp":              int(float(lsd.get("rp",              0))),
			# M1 additions (default 0 for old saves)
			"prize":           int(float(lsd.get("prize",           0))),
			"sponsor":         int(float(lsd.get("sponsor",         0))),
			"constructor_pos": int(float(lsd.get("constructor_pos", 0))),
		}
	# --- META-3: contracts + cap state ---
	# Migration path A: save has "contracts" key -> restore each contract dict.
	# Migration path B: no "contracts" key (old save) -> default contracts for tier.
	var contracts_raw: Variant = data.get("contracts", null)
	if typeof(contracts_raw) == TYPE_ARRAY and (contracts_raw as Array).size() > 0:
		# Path A: new save
		s.contracts = []
		for cr in (contracts_raw as Array):
			if typeof(cr) == TYPE_DICTIONARY:
				var cd: Dictionary = cr as Dictionary
				var fallback_id: int = TEAM_IDS[clampi(s.contracts.size(), 0, TEAM_IDS.size() - 1)]
				var fallback_sal: int = int(SALARY_DEFAULT[clampi(s.team_tier, 0, 2)])
				s.contracts.append({
					"driver_id":         int(float(cd.get("driver_id", fallback_id))),
					"salary_per_round":  int(float(cd.get("salary_per_round", fallback_sal))),
					"length_seasons":    int(float(cd.get("length_seasons", CONTRACT_LENGTH_DEFAULT))),
					"rounds_remaining":  int(float(cd.get("rounds_remaining", CONTRACT_LENGTH_DEFAULT * 5))),
				})
		# If fewer contracts than expected (e.g. partially corrupt), pad with defaults
		var padded: int = s.contracts.size()
		for i in (TEAM_IDS.size() - padded):
			s.contracts.append(s._new_contract(TEAM_IDS[padded + i], s.team_tier))
	else:
		# Path B: old save (no contracts key) -> default contracts for the loaded tier
		s._init_default_contracts(s.team_tier)
	# Restore cap state (default 0 for old saves)
	s.cumulative_salary_spend = int(float(data.get("cumulative_salary_spend", 0)))
	s.cap_penalty_pending = int(float(data.get("cap_penalty_pending", 0)))
	# M1: sponsor system — restore active_sponsors, sponsor_offers, payout_log.
	# Migration: old saves without "active_sponsors" get an empty list; fresh offers
	# generated by configure() -> _generate_sponsor_offers() already ran above.
	var asp_raw: Variant = data.get("active_sponsors", null)
	if typeof(asp_raw) == TYPE_ARRAY:
		s.active_sponsors = s._sponsors_from_array(asp_raw as Array)
	else:
		s.active_sponsors = []
	var sof_raw: Variant = data.get("sponsor_offers", null)
	if typeof(sof_raw) == TYPE_ARRAY:
		s.sponsor_offers = s._sponsors_from_array(sof_raw as Array)
	else:
		# Old save: generate fresh offers from the restored cal_seed.
		s.sponsor_offers = s._generate_sponsor_offers()
	var plog_raw: Variant = data.get("payout_log", null)
	if typeof(plog_raw) == TYPE_ARRAY:
		s.payout_log = []
		for entry in (plog_raw as Array):
			if typeof(entry) == TYPE_DICTIONARY:
				var ed: Dictionary = entry as Dictionary
				s.payout_log.append({
					"round":  int(float(ed.get("round",  0))),
					"amount": int(float(ed.get("amount", 0))),
					"from":   String(ed.get("from", "?")),
				})
	else:
		s.payout_log = []
	# Prime F1_2026's static R&D state so the loaded upgrades take effect immediately.
	s.apply_car_rd()

# Construct a Season from an already-parsed Dictionary (e.g. RPC payload from host).
# Behaviour-identical to load_from_disk but takes a Dictionary instead of reading a file.
# All int(float(...)) casts handle the JSON/RPC float quirk the same way.
static func from_dict(data: Dictionary) -> Season:
	var s := Season.new()
	_apply_dict(s, data)
	return s

static func load_from_disk() -> Season:
	if not FileAccess.file_exists(SAVE_PATH):
		return null
	var f := FileAccess.open(SAVE_PATH, FileAccess.READ)
	if f == null:
		return null
	var txt := f.get_as_text()
	f.close()
	var data: Variant = JSON.parse_string(txt)
	if typeof(data) != TYPE_DICTIONARY:
		return null
	var s := Season.new()
	_apply_dict(s, data as Dictionary)
	return s
