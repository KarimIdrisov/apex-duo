class_name QualiSim
extends RefCounted

# ============================================================================
# Apex Duo — timer-based interactive qualifying.
#
# Session model: Q1 (22 cars, 18 min) → Q2 (16 cars, 15 min) → Q3 (10 cars, 12 min).
# Player presses "Отправить" at any moment; the car does an out-lap then
# consecutive flying laps until "В боксы" is pressed or time expires.
# AI auto-boxes after one flying lap (can schedule a 2nd stint in Q3).
#
# Determinism:
#   qrng = mix32(mix32(seed)) — own instance, never touches sim.rng.
#   AI releases are scheduled at _run_time (deterministic from policy).
#   Player releases are real-time button presses → same as race pace commands.
#   apply_to_sim() writes only final grid/time fields; does NOT tick sim.rng.
# ============================================================================

# ---- Tunables ---------------------------------------------------------------
const SEG_DURATIONS       := [1080.0, 900.0, 720.0]  # Q1/Q2/Q3 sim-seconds (18/15/12 min)
const OUTLAP_SECONDS      := 30.0   # sim-seconds for the warm-up lap
const PUSH_SECONDS        := 30.0   # sim-seconds per flying lap (sector splits revealed live)
const EVO_GAIN            := 0.18   # s/lap track evolution bonus over a full segment
const ATTACK_DELTA        := -0.12  # mean gain in attack/flyer mode
const ATTACK_SIGMA        := 1.6    # noise multiplier for flyer vs banker
const SECOND_RUN_THRESHOLD := 0.35  # AI does a 2nd stint in Q3 if gap to cut > this (s)

# Out-lap tyre-prep heat delivered vs ideal peak — affects lap quality.
const OUTLAP_AGGR    := {"cold": 0.55, "normal": 0.85, "hot": 1.15}
const OUTLAP_IDEAL   := 0.90
const OUTLAP_FALLOFF := 0.35
const OUTLAP_PEN     := 0.30

# Traffic and tow (all deterministic — derived from release timing, no RNG).
const TRAFFIC_WINDOW := 8.0
const TRAFFIC_PEN    := 0.035
const TRAFFIC_CAP    := 0.40
const TOW_WINDOW     := 5.0
const TOW_MAX        := 0.10

const NO_TIME := 1.0e18   # sentinel: no lap set (scores are negative floats)

# ---- Session state ----------------------------------------------------------
var segment: int      = 0
var elapsed: float    = 0.0
var seg_duration: float = 1080.0   # current segment length; updated per segment
var finished: bool    = false

var drivers: Array       = []
var times: Dictionary    = {}   # driver_id (int) -> best lap score (float, negative)
var runs: Dictionary     = {}   # driver_id -> total flying laps completed
var eliminated: Array    = []   # driver_ids eliminated so far
var grid_ids: Array      = []   # pole-first list after Q3

var qrng: RaceSim.RNG
var sim_track_power:     float = 0.6
var sim_track_downforce: float = 0.6

# ---- Per-driver per-segment state -------------------------------------------
var _run_time: Dictionary    = {}  # AI: scheduled release (sim-elapsed); NO_TIME = player (manual)
var _run_count: Dictionary   = {}
var _time_set_at: Dictionary = {}
var _active_ids: Array       = []
var _released: Dictionary    = {}  # on track this stint?
var _release_t: Dictionary   = {}  # sim-elapsed at stint start
var _outlap_aggr: Dictionary = {}  # "cold"/"normal"/"hot"
var _run_type: Dictionary    = {}  # "banker"/"flyer"
var _push_start: Dictionary  = {}  # sim-elapsed when the flying lap begins
var _pending_lap: Dictionary = {}  # locked-in lap score for current push lap
var _ai_attempts: Dictionary = {}  # max stints AI will make this segment
var _auto_box: Dictionary    = {}  # AI flag: box after each flying lap
var _boxing: Dictionary      = {}  # player flag: box after the current flying lap
var _stint_laps: Dictionary  = {}  # flying laps completed in the current stint
var _track: RaceSim.Track    = null
var first_release_done: bool = false


# ---- _init ------------------------------------------------------------------
func _init(drivers_in: Array, seed_value: int) -> void:
	drivers = drivers_in
	qrng = RaceSim.RNG.new(RaceSim.mix32(RaceSim.mix32(seed_value)))
	_active_ids = []
	for d in drivers:
		var did: int = int(d.id)
		_active_ids.append(did)
		times[did] = NO_TIME
		runs[did]  = 0
	_start_segment()


# ---- Public API -------------------------------------------------------------

# Send the car onto the circuit (player button press, or AI auto-release).
# Ignored if: car already on track, not active, or not enough time left for
# one full outlap + flying lap before the segment ends.
func release(driver_id: int, aggr: String = "normal", run_type: String = "flyer") -> void:
	var did: int = int(driver_id)
	if not _active_ids.has(did):
		return
	if bool(_released.get(did, false)):
		return
	if finished or elapsed + OUTLAP_SECONDS + PUSH_SECONDS > seg_duration:
		return
	_released[did]    = true
	_release_t[did]   = elapsed
	_push_start[did]  = elapsed + OUTLAP_SECONDS
	_pending_lap[did] = NO_TIME
	_stint_laps[did]  = 0
	_boxing[did]      = false
	if aggr in OUTLAP_AGGR:
		_outlap_aggr[did] = aggr
	if run_type == "banker" or run_type == "flyer":
		_run_type[did] = run_type
	if not first_release_done:
		first_release_done = true

# Flag the car to return to the pits after the current flying lap ends.
# Has no effect during the out-lap (lap hasn't started yet).
func box(driver_id: int) -> void:
	var did: int = int(driver_id)
	if bool(_released.get(did, false)):
		_boxing[did] = true

# Set out-lap tyre-prep aggression for the next release.
func set_outlap(driver_id: int, aggr: String) -> void:
	if aggr in OUTLAP_AGGR:
		_outlap_aggr[int(driver_id)] = aggr

# Advance the qualifying simulation by dt sim-seconds.
func tick(dt: float) -> void:
	if finished:
		return
	elapsed += dt
	for did_v in _active_ids:
		var did: int = int(did_v)
		var d: RaceSim.Driver = _get_driver(did)
		# AI scheduled auto-release
		if not bool(_released.get(did, false)) \
				and int(runs.get(did, 0)) < int(_ai_attempts.get(did, 1)) \
				and elapsed >= float(_run_time.get(did, NO_TIME)):
			release(did, String(_outlap_aggr.get(did, "normal")),
				String(_run_type.get(did, "flyer")))
		# On-track: compute lap score at push-start, finalise at push-end
		if bool(_released.get(did, false)):
			var pstart: float = float(_push_start.get(did, NO_TIME))
			if elapsed >= pstart and float(_pending_lap.get(did, NO_TIME)) > 1.0e17:
				_pending_lap[did] = _calc_laptime(did, pstart + PUSH_SECONDS)
			if elapsed >= pstart + PUSH_SECONDS and float(_pending_lap.get(did, NO_TIME)) < 1.0e17:
				# Flying lap complete — bank the time
				var t: float = float(_pending_lap[did])
				runs[did] = int(runs.get(did, 0)) + 1
				_run_count[did] = int(runs[did])
				_stint_laps[did] = int(_stint_laps.get(did, 0)) + 1
				if t < float(times.get(did, NO_TIME)):
					times[did] = t
					_time_set_at[did] = elapsed
				_pending_lap[did] = NO_TIME
				# Box or start the next flying lap?
				var want_box: bool  = bool(_boxing.get(did, false)) or bool(_auto_box.get(did, false))
				var has_room: bool  = elapsed + PUSH_SECONDS < seg_duration
				if want_box or not has_room:
					_released[did] = false
					_boxing[did]   = false
					if d != null and not d.is_player:
						_ai_maybe_request_second(did, t)
				else:
					# Continue stint: next flying lap begins immediately (tyres warm)
					_outlap_aggr[did] = "normal"
					_push_start[did]  = elapsed
	if elapsed >= seg_duration:
		_close_segment()

# Write qualifying results into an already-constructed RaceSim.
func apply_to_sim(sim: RaceSim) -> void:
	sim.quali_times = times.duplicate()
	sim.quali_grid  = grid_ids.duplicate()
	var n: int = grid_ids.size()
	for gp in n:
		var did: int = int(grid_ids[gp])
		var d: RaceSim.Driver = sim.get_driver_by_id(did)
		if d == null:
			continue
		d.grid_pos  = gp + 1
		d.lap_frac  = float(n - 1 - gp) * RaceSim.GRID_GAP
		d.tyre_temp = RaceSim.TYRE_TEMP_GRID

# Per-car HUD state: state name + live sector splits + best time + lap count.
# state: "garage" / "outlap" / "push" / "elimd"
# can_release: enough time for an outlap + flying lap
func car_state(did: int) -> Dictionary:
	var splits: Array = [-1.0, -1.0, -1.0]
	var st := "garage"
	var lap_num: int = int(_stint_laps.get(did, 0))
	if not _active_ids.has(int(did)):
		st = "elimd"
	elif bool(_released.get(did, false)):
		var pstart: float = float(_push_start.get(did, 1e18))
		if elapsed < pstart:
			st = "outlap"
		else:
			st = "push"
			var score: float = float(_pending_lap.get(did, NO_TIME))
			if score < 1.0e17:
				var lap: float = _track.base_laptime + score if _track != null else 80.0 + score
				var prog: float = clampf((elapsed - pstart) / PUSH_SECONDS, 0.0, 1.0)
				var b1: float = 0.33
				var b2: float = 0.67
				if _track != null and _track.sector_bounds.size() >= 2:
					b1 = float(_track.sector_bounds[0])
					b2 = float(_track.sector_bounds[1])
				var bounds: Array = [b1, b2, 1.0]
				var prev := 0.0
				for i in 3:
					if prog >= float(bounds[i]):
						splits[i] = lap * (float(bounds[i]) - prev)
					prev = float(bounds[i])
	var can_release: bool = not bool(_released.get(did, false)) \
		and _active_ids.has(int(did)) \
		and elapsed + OUTLAP_SECONDS + PUSH_SECONDS < seg_duration
	return {
		"state":       st,
		"splits":      splits,
		"best":        float(times.get(int(did), NO_TIME)),
		"lap_num":     lap_num + 1,
		"can_release": can_release,
		"boxing":      bool(_boxing.get(did, false)),
	}

# Compact snapshot for network broadcast (~12 Hz, unreliable_ordered).
func make_snapshot() -> Dictionary:
	var times_str: Dictionary = {}
	for k in times:
		times_str[str(k)] = float(times[k])
	var cars: Dictionary = {}
	for did_v in _active_ids:
		cars[str(int(did_v))] = car_state(int(did_v))
	var elim_copy: Array = []
	for v in eliminated:
		elim_copy.append(int(v))
	return {
		"segment":      segment,
		"elapsed":      elapsed,
		"seg_duration": seg_duration,
		"times":        times_str,
		"cars":         cars,
		"eliminated":   elim_copy,
		"finished":     finished,
	}

func set_track(track: RaceSim.Track) -> void:
	_track              = track
	sim_track_power     = track.power
	sim_track_downforce = track.downforce


# ---- Internal helpers -------------------------------------------------------

func _calc_laptime(driver_id: int, set_elapsed: float,
		_window_override: String = "", mode_override: String = "") -> float:
	var d: RaceSim.Driver = _get_driver(driver_id)
	if d == null:
		return 1000.0
	var did: int = int(driver_id)
	var run_type: String = String(_run_type.get(did, "flyer"))
	var mode: String = mode_override if mode_override != "" \
		else ("attack" if run_type == "flyer" else "bank")

	# Base pace (mirrors _run_qualifying)
	var qt: float = -d.skill * RaceSim.SKILL_K
	qt -= (d.car_power - d.car_aero) * (sim_track_power - sim_track_downforce) * RaceSim.CAR_K
	qt += (1.0 - d.setup_q_quali) * RaceSim.SETUP_PEN
	qt += float(RaceSim.COMPOUNDS["soft"]["pace"])

	# Later in the segment = more rubber = faster track (the release-timing gamble)
	var evo_frac: float = clampf(set_elapsed / seg_duration, 0.0, 1.0)
	qt -= evo_frac * EVO_GAIN

	qt += (1.0 - _outlap_quality(did)) * OUTLAP_PEN
	qt += _traffic_pen(did)
	qt -= _tow_bonus(did)

	var noise_mult: float = 1.0
	if mode == "attack":
		qt += ATTACK_DELTA
		noise_mult = ATTACK_SIGMA

	var consist: float = _attr(d, "consistency")
	var qnoise: float  = float(RaceSim.QUALI_NOISE_BASE) * (1.3 - consist * 0.6) * noise_mult
	qt += qrng.rangef(-qnoise, qnoise)

	var comp: float      = _attr(d, "composure")
	var scrappy_p: float = float(RaceSim.QUALI_SCRAPPY_P) * (1.3 - comp * 0.6)
	if mode == "attack":
		scrappy_p *= 1.6
	if evo_frac > 0.8:
		scrappy_p *= 1.6
	if qrng.unit() < scrappy_p:
		qt += qrng.rangef(float(RaceSim.QUALI_SCRAPPY_MIN), float(RaceSim.QUALI_SCRAPPY_MAX))

	return qt

func _outlap_quality(did: int) -> float:
	var d: RaceSim.Driver = _get_driver(did)
	var aggr: String = String(_outlap_aggr.get(did, "normal"))
	var heat: float = float(OUTLAP_AGGR.get(aggr, 0.85))
	if d != null:
		heat += (_attr(d, "tyre") - 0.5) * 0.10 + (_attr(d, "race_iq") - 0.5) * 0.06
	var miss: float = heat - OUTLAP_IDEAL
	return clampf(1.0 - OUTLAP_FALLOFF * miss * miss, 0.0, 1.0)

func _traffic_pen(did: int) -> float:
	var my_t: float = float(_release_t.get(did, -1.0))
	if my_t < 0.0:
		return 0.0
	var cluster := 0
	for od_v in _active_ids:
		var od: int = int(od_v)
		if od == did:
			continue
		var ot: float = float(_release_t.get(od, -1e9))
		if ot >= 0.0 and ot < my_t and my_t - ot < TRAFFIC_WINDOW:
			cluster += 1
	return minf(TRAFFIC_CAP, TRAFFIC_PEN * float(cluster))

func _tow_bonus(did: int) -> float:
	var my_t: float = float(_release_t.get(did, -1.0))
	if my_t < 0.0:
		return 0.0
	var best := 0.0
	for od_v in _active_ids:
		var od: int = int(od_v)
		if od == did:
			continue
		var ot: float = float(_release_t.get(od, -1e9))
		var gap: float = my_t - ot
		if gap > 0.0 and gap < TOW_WINDOW:
			best = maxf(best, (1.0 - gap / TOW_WINDOW) * TOW_MAX * sim_track_power)
	return best

func _ai_policy_for(driver_id: int) -> Dictionary:
	var d: RaceSim.Driver = _get_driver(driver_id)
	var aggr: float = _attr(d, "aggression") if d != null else 0.5
	var typ := "flyer" if aggr > 0.45 else "banker"
	var ol  := "hot" if aggr > 0.65 else ("normal" if aggr > 0.40 else "cold")
	return {"aggr": ol, "type": typ}

# Schedule the AI's first stint: timing based on aggression + strat_skill noise.
func _apply_ai_policy(driver_id: int) -> void:
	var d: RaceSim.Driver = _get_driver(driver_id)
	if d == null:
		return
	var did: int = int(driver_id)
	var aggr: float = _attr(d, "aggression")
	var base_frac: float = 0.22 + aggr * 0.45
	var jitter: float = qrng.rangef(-0.15, 0.15) * (1.2 - d.strat_skill)
	var latest: float = (seg_duration - OUTLAP_SECONDS - PUSH_SECONDS - 1.0) / seg_duration
	var rel_frac: float = clampf(base_frac + jitter, 0.04, maxf(0.04, latest))
	_run_time[did]    = seg_duration * rel_frac
	_ai_attempts[did] = 1
	_auto_box[did]    = true   # AI boxes after one flying lap; may schedule a 2nd stint below
	var pol: Dictionary = _ai_policy_for(did)
	_outlap_aggr[did] = String(pol["aggr"])
	_run_type[did]    = String(pol["type"])

# After the AI's first stint in Q3: optionally schedule a second if time vs cut gap warrants.
func _ai_maybe_request_second(driver_id: int, lap_time: float) -> void:
	var did: int = int(driver_id)
	if segment != 2:
		return
	var d: RaceSim.Driver = _get_driver(did)
	if d == null or _attr(d, "aggression") <= 0.50:
		return
	var known: Array = []
	for k in times:
		var tv: float = float(times[k])
		if tv < 1.0e17:
			known.append(tv)
	if known.size() < 4:
		return
	known.sort()
	var p_cut: float = float(known[mini(9, known.size() - 1)])
	if lap_time > p_cut + SECOND_RUN_THRESHOLD \
			and elapsed + OUTLAP_SECONDS + PUSH_SECONDS < seg_duration:
		_ai_attempts[did] = 2
		_run_time[did]    = elapsed + 1.0

# (Re-)initialise per-driver state for a new segment.
func _start_segment() -> void:
	seg_duration = float(SEG_DURATIONS[mini(segment, SEG_DURATIONS.size() - 1)])
	for did_v in _active_ids:
		var did: int = int(did_v)
		var d: RaceSim.Driver = _get_driver(did)
		_run_count[did]     = 0
		_time_set_at[did]   = -1.0
		runs[did]           = 0
		_released[did]      = false
		_release_t[did]     = -1.0
		_push_start[did]    = NO_TIME
		_pending_lap[did]   = NO_TIME
		_ai_attempts[did]   = 1
		_outlap_aggr[did]   = "normal"
		_run_type[did]      = "flyer"
		_boxing[did]        = false
		_auto_box[did]      = false
		_stint_laps[did]    = 0
		if d != null and not d.is_player:
			_apply_ai_policy(did)
		else:
			_run_time[did] = NO_TIME   # player releases manually

func _close_segment() -> void:
	var elim_count: int = 0
	if segment < 2:
		elim_count = 6   # Q1 and Q2 each eliminate 6; Q3 crowns the top 10
	if elim_count > 0:
		var sorted_ids: Array = _active_ids.duplicate()
		sorted_ids.sort_custom(func(a, b):
			var ta: float = float(times.get(int(a), 1e9))
			var tb: float = float(times.get(int(b), 1e9))
			if absf(ta - tb) > 0.0001:
				return ta < tb
			return float(_time_set_at.get(int(a), 1e9)) < float(_time_set_at.get(int(b), 1e9))
		)
		for i in range(sorted_ids.size() - elim_count, sorted_ids.size()):
			eliminated.append(int(sorted_ids[i]))
		_active_ids = sorted_ids.slice(0, sorted_ids.size() - elim_count)
	segment += 1
	elapsed  = 0.0
	if segment >= 3:
		_build_final_grid()
		finished = true
	else:
		_start_segment()

# Build the pole-first starting grid after Q3 finishes.
func _build_final_grid() -> void:
	var q3_sorted: Array = _active_ids.duplicate()
	q3_sorted.sort_custom(func(a, b):
		var ta: float = float(times.get(int(a), 1e9))
		var tb: float = float(times.get(int(b), 1e9))
		if absf(ta - tb) > 0.0001:
			return ta < tb
		return float(_time_set_at.get(int(a), 1e9)) < float(_time_set_at.get(int(b), 1e9))
	)
	grid_ids = []
	for did in q3_sorted:
		grid_ids.append(int(did))
	var q1_elim: Array = []
	var q2_elim: Array = []
	for i in eliminated.size():
		if i < 6:
			q1_elim.append(int(eliminated[i]))
		else:
			q2_elim.append(int(eliminated[i]))
	q2_elim.sort_custom(func(a, b):
		return float(times.get(int(a), 1e9)) > float(times.get(int(b), 1e9))
	)
	q1_elim.sort_custom(func(a, b):
		return float(times.get(int(a), 1e9)) > float(times.get(int(b), 1e9))
	)
	for did in q2_elim:
		grid_ids.append(int(did))
	for did in q1_elim:
		grid_ids.append(int(did))

func _get_driver(driver_id: int) -> RaceSim.Driver:
	for d in drivers:
		if int(d.id) == driver_id:
			return d
	return null

func _attr(d: RaceSim.Driver, key: String) -> float:
	return float(d.attrs.get(key, 13)) / 20.0
