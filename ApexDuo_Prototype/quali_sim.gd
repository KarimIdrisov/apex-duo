class_name QualiSim
extends RefCounted

# ============================================================================
# Apex Duo — deterministic interactive qualifying simulation.
# Pure sim, no UI, no Node.  Mirrors the style of RaceSim:
#   const tunables at the top, step-based tick(), seeded RNG.
#
# Session model: Q1 (22 cars) → Q2 (16 cars) → Q3 (10 cars).
# Each segment runs for SEG_DURATION sim-seconds.  Cars have one
# scheduled flying lap; a second is available if the first was poor.
#
# Determinism guarantee:
#   qrng is seeded from mix32(mix32(seed)) — the SAME formula used by
#   RaceSim._init.  We construct our OWN RNG instance here, never touch
#   sim.rng or sim.erng.  The whole session is a pure function of
#   (seed, player_inputs).
#
# apply_to_sim() writes only final positional fields (grid_pos, lap_frac,
# tyre_temp, quali_times, quali_grid) — it does NOT tick sim.rng.
# ============================================================================

# ---- Tunables ---------------------------------------------------------------
const SEG_DURATION          := 240.0   # sim-seconds per segment
const EVO_GAIN              := 0.18    # s/lap track evolution over full segment
const ATTACK_DELTA          := -0.12   # s/lap mean gain in attack mode
const ATTACK_SIGMA          := 1.6     # noise multiplier for attack vs bank
const LATE_EVO_BONUS        := 0.18    # (mirrors spec constant; absorbed into formula)
const LATE_RISK_P           := 0.08    # base late-window scrappy risk
const SECOND_RUN_THRESHOLD  := 0.35    # request 2nd run if 1st > P_CUT + this (s)

# Window offsets: fraction of segment elapsed when the car crosses the line.
# "early" = first 15%, "mid" = 50%, "late" = 85%.
const WINDOW_OFFSETS := {"early": 0.15, "mid": 0.50, "late": 0.85}
# Scheduled run time midpoints inside the segment (deterministic, no extra rng).
const WINDOW_MIDPOINTS := {"early": 0.15, "mid": 0.50, "late": 0.81}

# ---- Release & watch (interactive: the player sends the car out, then watches
# the flying lap unfold sector-by-sector). All deterministic. ----
const OUTLAP_SECONDS := 6.0     # sim-seconds of out-lap before the push lap begins
const PUSH_SECONDS   := 6.0     # sim-seconds the push lap takes (splits revealed across it)
const INLAP_SECONDS  := 4.0     # cooldown after a push before the car can run again
# Out-lap aggression → tyre-window heat delivered; quality peaks near OUTLAP_IDEAL.
const OUTLAP_AGGR := {"cold": 0.55, "normal": 0.85, "hot": 1.15}
const OUTLAP_IDEAL := 0.90
const OUTLAP_FALLOFF := 0.35     # s/lap lost per unit² of heat miss
const OUTLAP_PEN := 0.30         # scales (1-quality) into the lap time
# Deterministic traffic: cars releasing within TRAFFIC_WINDOW of each other (and
# ahead on the road) cost the later car time. Derived, never rolled.
const TRAFFIC_WINDOW := 5.0      # sim-seconds proximity that shares the track
const TRAFFIC_PEN := 0.035       # s/lap per clustered car ahead
const TRAFFIC_CAP := 0.40        # max traffic loss
# Tow: a car released just ahead gives a one-lap slipstream (power tracks).
const TOW_WINDOW := 3.0
const TOW_MAX := 0.10
const NO_TIME := 1.0e18          # sentinel: no lap set (quali scores are NEGATIVE,
								 # so 0/-1 collide with real values — use a huge value)

# ---- State ------------------------------------------------------------------
var segment: int = 0            # 0=Q1, 1=Q2, 2=Q3
var elapsed: float = 0.0        # sim-seconds elapsed in the current segment
var finished: bool = false

var drivers: Array = []         # Array[RaceSim.Driver] — all 22
var times: Dictionary = {}      # driver_id (int) -> best lap time this session (float)
var runs: Dictionary = {}       # driver_id (int) -> attempts completed this segment (int)
var eliminated: Array = []      # driver_ids (int) eliminated so far
var grid_ids: Array = []        # pole-first list of driver ids (int) after Q3

var qrng: RaceSim.RNG           # qualifying RNG (injected in _init)
# Track characteristics (set via set_track(); used by _calc_laptime)
var sim_track_power:     float = 0.6
var sim_track_downforce: float = 0.6

# Per-driver internal state for the current segment (reset each segment).
# Stored as parallel Dictionaries for easy lookup without adding fields to Driver.
var _run_time: Dictionary = {}  # driver_id -> sim-elapsed scheduled AI auto-release (1e9 = player/manual)
var _run_count: Dictionary = {} # driver_id -> attempts completed (mirrors runs)
var _time_set_at: Dictionary = {}      # driver_id -> elapsed when best segment time set
var _active_ids: Array = []            # driver_ids still competing (not eliminated)
# Release & watch per-car state (current run):
var _released: Dictionary = {}         # driver_id -> bool (out on track this run)
var _release_t: Dictionary = {}        # driver_id -> elapsed at release
var _outlap_aggr: Dictionary = {}      # driver_id -> "cold"/"normal"/"hot"
var _run_type: Dictionary = {}         # driver_id -> "banker"/"flyer"
var _push_start: Dictionary = {}       # driver_id -> elapsed when the push lap begins
var _pending_lap: Dictionary = {}      # driver_id -> the computed lap time of the in-progress push
var _ai_attempts: Dictionary = {}      # driver_id -> how many auto-releases the AI will make
var _track: RaceSim.Track = null       # for sector bounds (live splits)
var first_release_done: bool = false   # parc fermé trips on the first release in Q1

# ---- _init ------------------------------------------------------------------
func _init(drivers_in: Array, seed_value: int) -> void:
	drivers = drivers_in
	# Own RNG from mix32(mix32(seed)) — identical formula to RaceSim._init's qrng.
	# We construct our OWN instance so we never touch the sim's qrng.
	qrng = RaceSim.RNG.new(RaceSim.mix32(RaceSim.mix32(seed_value)))
	_active_ids = []
	for d in drivers:
		var did: int = int(d.id)
		_active_ids.append(did)
		times[did]     = NO_TIME   # sentinel: no time yet (quali scores are negative,
		runs[did]      = 0         # so 0/-1 can't be a sentinel — use a huge value)
	_start_segment()

# ---- Public API -------------------------------------------------------------

# RELEASE the car onto the circuit now (the core interactive action). It does an
# out-lap (OUTLAP_SECONDS), then a push lap (PUSH_SECONDS, splits revealed live),
# then sets its time. aggr: "cold"/"normal"/"hot" out-lap; run_type: "banker"/"flyer".
# Up to 2 attempts per segment; ignored while already out or out of attempts/time.
func release(driver_id: int, aggr: String = "normal", run_type: String = "flyer") -> void:
	var did: int = int(driver_id)
	if not _active_ids.has(did):
		return
	if bool(_released.get(did, false)):
		return                                   # already on track this run
	if int(runs.get(did, 0)) >= 2:
		return                                   # used both attempts
	# need room for out-lap + push before the segment ends
	if finished or elapsed + OUTLAP_SECONDS + PUSH_SECONDS > SEG_DURATION:
		return
	_released[did] = true
	_release_t[did] = elapsed
	_push_start[did] = elapsed + OUTLAP_SECONDS
	_pending_lap[did] = NO_TIME
	if aggr in OUTLAP_AGGR:
		_outlap_aggr[did] = aggr
	if run_type == "banker" or run_type == "flyer":
		_run_type[did] = run_type
	if not first_release_done:
		first_release_done = true                # parc fermé trips here (read by main.gd)

# Window/mode UI → SCHEDULE the release: window picks when in the segment the car
# goes out (early=greener track, late=more rubber but busier), mode picks the run
# type. Deterministic (the car auto-releases at the scheduled tick — not on the
# button press), so player release timing can't desync host/client.
func set_player_choice(driver_id: int, window: String, mode: String) -> void:
	var did: int = int(driver_id)
	if not _active_ids.has(did) or int(runs.get(did, 0)) >= 1:
		return
	var frac: float = float(WINDOW_MIDPOINTS.get(window, 0.50))
	var latest: float = (SEG_DURATION - OUTLAP_SECONDS - PUSH_SECONDS - 1.0) / SEG_DURATION
	_run_time[did] = SEG_DURATION * clampf(frac, 0.04, maxf(0.04, latest))
	_run_type[did] = "flyer" if mode == "attack" else "banker"
	if not _outlap_aggr.has(did):
		_outlap_aggr[did] = "normal"

# Set the out-lap aggression for the next release (cold/normal/hot).
func set_outlap(driver_id: int, aggr: String) -> void:
	if aggr in OUTLAP_AGGR:
		_outlap_aggr[int(driver_id)] = aggr

# Second run = schedule another release now (kept for the old call site).
func request_second_run(driver_id: int) -> void:
	var did: int = int(driver_id)
	if not _active_ids.has(did) or int(runs.get(did, 0)) != 1:
		return
	if elapsed + OUTLAP_SECONDS + PUSH_SECONDS > SEG_DURATION:
		return
	_ai_attempts[did] = 2
	_run_time[did] = elapsed + 0.5

# Tick the simulation forward by dt sim-seconds.
func tick(dt: float) -> void:
	if finished:
		return
	elapsed += dt
	for did_v in _active_ids:
		var did: int = int(did_v)
		var d: RaceSim.Driver = _get_driver(did)
		# Scheduled auto-release at _run_time. AI cars are scheduled in
		# _start_segment; player cars are scheduled from their window choice
		# (set_player_choice) or an explicit release() that sets _run_time=elapsed.
		# Deterministic (a scheduled tick, not a real-time button press → no desync).
		if not bool(_released.get(did, false)) \
				and int(runs.get(did, 0)) < int(_ai_attempts.get(did, 1)) \
				and elapsed >= float(_run_time.get(did, NO_TIME)):
			release(did, String(_outlap_aggr.get(did, "normal")),
				String(_run_type.get(did, "flyer")))
		# A released car: compute the push lap at push-start, finalize at push-end.
		if bool(_released.get(did, false)):
			var pstart: float = float(_push_start.get(did, NO_TIME))
			if elapsed >= pstart and float(_pending_lap.get(did, NO_TIME)) > 1.0e17:
				# push begins: lock in the lap score (splits revealed live during PUSH)
				_pending_lap[did] = _calc_laptime(did, pstart + PUSH_SECONDS)
			if elapsed >= pstart + PUSH_SECONDS and float(_pending_lap.get(did, NO_TIME)) < 1.0e17:
				# push complete: bank the time (keep the BEST across attempts)
				var t: float = float(_pending_lap[did])
				runs[did] = int(runs.get(did, 0)) + 1
				_run_count[did] = int(runs[did])
				if t < float(times.get(did, NO_TIME)):
					times[did] = t
					_time_set_at[did] = elapsed
				_released[did] = false
				_pending_lap[did] = NO_TIME
				# AI: decide on a second run (schedule another auto-release)
				if d != null and not d.is_player and int(runs[did]) < 2:
					_ai_maybe_request_second(did, t)
	if elapsed >= SEG_DURATION:
		_close_segment()

# Write qualifying results into an already-constructed RaceSim.
# This mirrors the tail of RaceSim._run_qualifying exactly:
#   grid_pos, lap_frac (GRID_GAP spacing), tyre_temp, quali_times, quali_grid.
# Does NOT consume sim.rng — reads/writes only final state fields.
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

# ---- Internal helpers -------------------------------------------------------

# Calculate a qualifying lap time for the given driver id.
# If window/mode are not provided, looks them up from _window/_mode.
func _calc_laptime(driver_id: int, set_elapsed: float,
		_window_override: String = "", mode_override: String = "") -> float:
	var d: RaceSim.Driver = _get_driver(driver_id)
	if d == null:
		return 1000.0
	var did: int = int(driver_id)
	var run_type: String = String(_run_type.get(did, "flyer"))
	var mode: String = mode_override if mode_override != "" \
		else ("attack" if run_type == "flyer" else "bank")

	# Base pace (same terms as _run_qualifying)
	var qt: float = -d.skill * RaceSim.SKILL_K
	qt -= (d.car_power - d.car_aero) * (sim_track_power - sim_track_downforce) * RaceSim.CAR_K
	qt += (1.0 - d.setup_q_quali) * RaceSim.SETUP_PEN   # qualifying reads the one-lap ideal
	qt += float(RaceSim.COMPOUNDS["soft"]["pace"])

	# Track evolution: WHEN you set the lap matters — later in the segment the
	# surface is more rubbered-in (faster). This is the early-vs-late gamble.
	var evo_frac: float = clampf(set_elapsed / SEG_DURATION, 0.0, 1.0)
	qt -= evo_frac * EVO_GAIN

	# Out-lap quality: hitting the tyre window (peaks near OUTLAP_IDEAL).
	qt += (1.0 - _outlap_quality(did)) * OUTLAP_PEN
	# Traffic (deterministic) + tow (slipstream on power tracks).
	qt += _traffic_pen(did)
	qt -= _tow_bonus(did)

	# Mode delta (flyer = attack)
	var noise_mult: float = 1.0
	if mode == "attack":
		qt += ATTACK_DELTA
		noise_mult = ATTACK_SIGMA

	# Noise
	var consist: float = _attr(d, "consistency")
	var qnoise: float  = float(RaceSim.QUALI_NOISE_BASE) * (1.3 - consist * 0.6) * noise_mult
	qt += qrng.rangef(-qnoise, qnoise)

	# Scrappy penalty (worse on attack + late, when the track is busiest)
	var comp: float     = _attr(d, "composure")
	var scrappy_p: float = float(RaceSim.QUALI_SCRAPPY_P) * (1.3 - comp * 0.6)
	if mode == "attack":
		scrappy_p *= 1.6
	if evo_frac > 0.8:
		scrappy_p *= 1.6
	if qrng.unit() < scrappy_p:
		qt += qrng.rangef(float(RaceSim.QUALI_SCRAPPY_MIN), float(RaceSim.QUALI_SCRAPPY_MAX))

	return qt


# Out-lap quality 0..1 — heat delivered into the tyre window vs the ideal. Skill
# (tyre + race_iq) nudges it toward ideal; the default "normal" is already near it.
func _outlap_quality(did: int) -> float:
	var d: RaceSim.Driver = _get_driver(did)
	var aggr: String = String(_outlap_aggr.get(did, "normal"))
	var heat: float = float(OUTLAP_AGGR.get(aggr, 0.85))
	if d != null:
		heat += (_attr(d, "tyre") - 0.5) * 0.10 + (_attr(d, "race_iq") - 0.5) * 0.06
	var miss: float = heat - OUTLAP_IDEAL
	return clampf(1.0 - OUTLAP_FALLOFF * miss * miss, 0.0, 1.0)


# Deterministic traffic: count cars released within TRAFFIC_WINDOW of this car and
# ahead on the road (earlier release_t). Iterate the fixed _active_ids order.
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


# Tow: a car released just ahead (within TOW_WINDOW) gives a slipstream, strong on
# power tracks (Monza), ~0 on downforce circuits (Monaco).
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

# AI out-lap aggression + run type from aggression (used at auto-release).
func _ai_policy_for(driver_id: int) -> Dictionary:
	var d: RaceSim.Driver = _get_driver(driver_id)
	var aggr: float = _attr(d, "aggression") if d != null else 0.5
	var typ := "flyer" if aggr > 0.45 else "banker"
	var ol := "hot" if aggr > 0.65 else ("normal" if aggr > 0.40 else "cold")
	return {"aggr": ol, "type": typ}

# AI release scheduling (§4.5): pick WHEN to send the car out. Aggressive drivers
# go later (more rubber, more risk); the timing is NOISED by strat_skill so a good
# human can match a good AI rather than face an analytic optimum (fairness rule).
func _apply_ai_policy(driver_id: int) -> void:
	var d: RaceSim.Driver = _get_driver(driver_id)
	if d == null:
		return
	var did: int = int(driver_id)
	var aggr: float = _attr(d, "aggression")
	var base_frac: float = 0.22 + aggr * 0.45            # later for aggressive
	var jitter: float = qrng.rangef(-0.15, 0.15) * (1.2 - d.strat_skill)
	var latest: float = (SEG_DURATION - OUTLAP_SECONDS - PUSH_SECONDS - 1.0) / SEG_DURATION
	var rel_frac: float = clampf(base_frac + jitter, 0.04, maxf(0.04, latest))
	_run_time[did] = SEG_DURATION * rel_frac
	_ai_attempts[did] = 1
	var pol: Dictionary = _ai_policy_for(did)
	_outlap_aggr[did] = String(pol["aggr"])
	_run_type[did] = String(pol["type"])

# AI second-run: Q3 + time worse than the estimated cut + aggressive → schedule
# one more auto-release later in the segment.
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
		if tv < 1.0e17:                  # has a real (negative) score
			known.append(tv)
	if known.size() < 4:
		return
	known.sort()
	var p_cut: float = float(known[mini(9, known.size() - 1)])
	if lap_time > p_cut + SECOND_RUN_THRESHOLD \
			and elapsed + OUTLAP_SECONDS + PUSH_SECONDS < SEG_DURATION:
		_ai_attempts[did] = 2
		_run_time[did] = elapsed + 1.0                  # go again now

# Start a new segment: assign AI policy, schedule run times.
func _start_segment() -> void:
	for did_v in _active_ids:
		var did: int = int(did_v)
		var d: RaceSim.Driver = _get_driver(did)
		_run_count[did]        = 0
		_time_set_at[did]      = -1.0
		runs[did]              = 0
		_released[did]         = false
		_release_t[did]        = -1.0
		_push_start[did]       = NO_TIME
		_pending_lap[did]      = NO_TIME
		_ai_attempts[did]      = 1
		_outlap_aggr[did]      = "normal"
		_run_type[did]         = "flyer"
		if d != null and not d.is_player:
			_apply_ai_policy(did)       # AI: schedule auto-release by aggression
		else:
			# player default: a mid-window run if the engineer leaves it alone
			# (never a punishment); the window/mode UI overrides this.
			_run_time[did] = SEG_DURATION * 0.50

# Close the current segment: eliminate the slowest cars, advance to next.
func _close_segment() -> void:
	var elim_count: int = 0
	if segment < 2:
		elim_count = 6   # Q1 and Q2 each eliminate 6

	if elim_count > 0:
		# Sort active_ids by best time (tiebreak: earliest time_set_at).
		var sorted_ids: Array = _active_ids.duplicate()
		sorted_ids.sort_custom(func(a, b):
			var ta: float = float(times.get(int(a), 1e9))
			var tb: float = float(times.get(int(b), 1e9))
			if absf(ta - tb) > 0.0001:
				return ta < tb
			return float(_time_set_at.get(int(a), 1e9)) < float(_time_set_at.get(int(b), 1e9))
		)
		# Slowest elim_count are out
		for i in range(sorted_ids.size() - elim_count, sorted_ids.size()):
			var did: int = int(sorted_ids[i])
			eliminated.append(did)
		_active_ids = sorted_ids.slice(0, sorted_ids.size() - elim_count)

	segment += 1
	elapsed   = 0.0

	if segment >= 3:
		# All done: build the final grid
		_build_final_grid()
		finished = true
	else:
		_start_segment()

# Build the pole-first grid after Q3.
# Order: Q3 finishers (P1–P10) + Q2 eliminated (P11–P16) + Q1 eliminated (P17–P22).
func _build_final_grid() -> void:
	# Q3 finishers sorted fastest first
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

	# Collect which ids were eliminated in Q2 vs Q1
	# eliminated array is in order of elimination; Q1 first 6, Q2 next 6.
	var q1_elim: Array = []
	var q2_elim: Array = []
	for i in eliminated.size():
		if i < 6:
			q1_elim.append(int(eliminated[i]))
		else:
			q2_elim.append(int(eliminated[i]))

	# Sort eliminated groups slowest first (worst P16/P22 at the back)
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

# Per-car interactive state for the watch UI: state name + live sector splits.
# state: "garage" / "outlap" / "push" / "done". splits: 3 floats (-1 = not yet).
func car_state(did: int) -> Dictionary:
	var splits: Array = [-1.0, -1.0, -1.0]
	var st := "garage"
	if not _active_ids.has(int(did)):
		st = "done"
	elif bool(_released.get(did, false)):
		var pstart: float = float(_push_start.get(did, 1e18))
		if elapsed < pstart:
			st = "outlap"
		else:
			st = "push"
			var score: float = float(_pending_lap.get(did, NO_TIME))
			if score < 1.0e17:
				# absolute lap time for display = base + relative quali score
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
	elif int(runs.get(did, 0)) > 0:
		st = "done"
	return {"state": st, "splits": splits, "best": float(times.get(int(did), -1.0))}

# Build a compact snapshot Dictionary for network broadcast.
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
		"seg_duration": SEG_DURATION,
		"times":        times_str,
		"cars":         cars,
		"eliminated":   elim_copy,
		"finished":     finished,
	}

# Convenience: set track params from the RaceSim track.
func set_track(track: RaceSim.Track) -> void:
	_track              = track
	sim_track_power     = track.power
	sim_track_downforce = track.downforce

# ---- Utility ----------------------------------------------------------------
func _get_driver(driver_id: int) -> RaceSim.Driver:
	for d in drivers:
		if int(d.id) == driver_id:
			return d
	return null

func _attr(d: RaceSim.Driver, key: String) -> float:
	return float(d.attrs.get(key, 13)) / 20.0
