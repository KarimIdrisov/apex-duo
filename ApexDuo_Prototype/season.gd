class_name Season
extends RefCounted

# ============================================================================
# Apex Duo — season / championship layer (Stage 3 meta).
# Holds the calendar, championship standings, team budget and R&D upgrades.
# A single instance lives in the static `active` slot and survives scene
# changes (paddock hub <-> race) for the whole play session.
# ============================================================================

const POINTS := [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
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
func apply_results(order_ids: Array) -> void:
	# META-3: apply any RP cap penalty accumulated from last round's salary evaluation
	_apply_cap_penalty()
	var gained_pts := 0
	var gained_money := 0
	for i in order_ids.size():
		var id: int = order_ids[i]
		var pts: int = POINTS[i] if i < POINTS.size() else 0
		standings[id] += pts
		if id in TEAM_IDS:
			gained_pts += pts
			gained_money += maxi(0, 11 - (i + 1)) * 60000
	rp += 12 + gained_pts
	money += gained_money
	last_summary = {"round": round_index + 1, "pts": gained_pts,
		"money": gained_money, "rp": rp}
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
	# Path B: no "part_levels" (old META-1 save) -> migrate from step counters using
	#         the slot-map approach (see _migrate_steps_to_parts).
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
		# Distribute evenly: per_attr = old_scalar / n_attrs so that
		# sum(attrs) = old_scalar = dev_of() is back-compat.
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
		s.last_summary = {
			"round": int(ls.get("round", 0)),
			"pts": int(ls.get("pts", 0)),
			"money": int(ls.get("money", 0)),
			"rp": int(ls.get("rp", 0)),
		}
	# --- META-3: contracts + cap state ---
	# Migration path A: save has "contracts" key -> restore each contract dict.
	# Migration path B: no "contracts" key (old save) -> default contracts for tier.
	# int(float(...)) handles JSON int->float quirk for all integer fields.
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
	# Prime F1_2026's static R&D state so the loaded upgrades take effect immediately.
	s.apply_car_rd()
	return s
