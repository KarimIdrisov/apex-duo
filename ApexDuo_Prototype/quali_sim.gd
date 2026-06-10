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
var _window: Dictionary = {}    # driver_id -> "early"/"mid"/"late"
var _mode:   Dictionary = {}    # driver_id -> "bank"/"attack"
var _run_time: Dictionary = {}  # driver_id -> sim-elapsed when first run fires
var _run_count: Dictionary = {} # driver_id -> 0/1/2
var _second_requested: Dictionary = {} # driver_id -> bool
var _second_run_time:  Dictionary = {} # driver_id -> float (or -1 if not scheduled)
var _time_set_at: Dictionary = {}      # driver_id -> elapsed when best segment time set
var _active_ids: Array = []            # driver_ids still competing (not eliminated)

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
		times[did]     = -1.0   # -1 = no time yet
		runs[did]      = 0
	_start_segment()

# ---- Public API -------------------------------------------------------------

# Set a player's choices before or during the segment.
# window: "early"/"mid"/"late", mode: "bank"/"attack"
# If the run has already fired (run_count >= 1), the call is silently ignored.
func set_player_choice(driver_id: int, window: String, mode: String) -> void:
	var did: int = int(driver_id)
	if not _active_ids.has(did):
		return
	if int(_run_count.get(did, 0)) >= 1:
		return   # attempt already resolved; choice is too late
	if window in WINDOW_MIDPOINTS:
		_window[did] = window
		_run_time[did] = SEG_DURATION * float(WINDOW_MIDPOINTS[window])
	if mode == "bank" or mode == "attack":
		_mode[did] = mode

# Request a second flying lap for driver_id (human call).
# Allowed only if: first run completed, segment not ended, not already requested.
func request_second_run(driver_id: int) -> void:
	var did: int = int(driver_id)
	if not _active_ids.has(did):
		return
	if int(_run_count.get(did, 0)) != 1:
		return
	if bool(_second_requested.get(did, false)):
		return
	if finished or elapsed >= SEG_DURATION:
		return
	_second_requested[did] = true
	_second_run_time[did]  = SEG_DURATION * 0.88   # late window for the 2nd lap

# Tick the simulation forward by dt sim-seconds.
func tick(dt: float) -> void:
	if finished:
		return
	elapsed += dt
	# Resolve any car whose scheduled run time has passed.
	for did_v in _active_ids:
		var did: int = int(did_v)
		# First run
		if int(_run_count.get(did, 0)) == 0 and elapsed >= float(_run_time.get(did, SEG_DURATION)):
			var t: float = _calc_laptime(did, elapsed)
			_run_count[did] = 1
			_time_set_at[did] = elapsed
			runs[did] = 1
			if float(times.get(did, -1.0)) < 0.0 or t < float(times.get(did, 1e9)):
				times[did] = t
			# AI second-run decision
			if not bool(_second_requested.get(did, false)):
				_ai_maybe_request_second(did, t)
		# Second run
		if int(_run_count.get(did, 0)) == 1 \
				and bool(_second_requested.get(did, false)) \
				and float(_second_run_time.get(did, -1.0)) >= 0.0 \
				and elapsed >= float(_second_run_time.get(did, SEG_DURATION + 1.0)):
			var t2: float = _calc_laptime(did, elapsed, "late", "attack")
			_run_count[did] = 2
			runs[did] = 2
			var prev: float = float(times.get(did, 1e9))
			if t2 < prev:
				times[did] = t2
				_time_set_at[did] = elapsed
	# Segment end
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
func _calc_laptime(driver_id: int, cur_elapsed: float,
		window_override: String = "", mode_override: String = "") -> float:
	var d: RaceSim.Driver = _get_driver(driver_id)
	if d == null:
		return 1000.0
	var did: int = int(driver_id)
	var window: String = window_override if window_override != "" else String(_window.get(did, "mid"))
	var mode:   String = mode_override   if mode_override   != "" else String(_mode.get(did,   "bank"))

	# Base pace (same terms as _run_qualifying)
	var qt: float = -d.skill * RaceSim.SKILL_K
	qt -= (d.car_power - d.car_aero) * (sim_track_power - sim_track_downforce) * RaceSim.CAR_K
	qt += (1.0 - d.setup_q_quali) * RaceSim.SETUP_PEN   # qualifying reads the one-lap ideal
	qt += float(RaceSim.COMPOUNDS["soft"]["pace"])

	# Evolution bonus (§4.1): late car on a rubbered-in track is faster
	var evo_frac: float = cur_elapsed / SEG_DURATION
	var win_off: float  = float(WINDOW_OFFSETS.get(window, 0.5))
	qt -= evo_frac * win_off * EVO_GAIN

	# Mode delta (§4.2)
	var noise_mult: float = 1.0
	if mode == "attack":
		qt += ATTACK_DELTA
		noise_mult = ATTACK_SIGMA

	# Noise (§4.3)
	var consist: float = _attr(d, "consistency")
	var qnoise: float  = float(RaceSim.QUALI_NOISE_BASE) * (1.3 - consist * 0.6) * noise_mult
	qt += qrng.rangef(-qnoise, qnoise)

	# Scrappy penalty (§4.4)
	var comp: float     = _attr(d, "composure")
	var scrappy_p: float = float(RaceSim.QUALI_SCRAPPY_P) * (1.3 - comp * 0.6)
	if mode == "attack":
		scrappy_p *= 1.6
	if window == "late":
		scrappy_p *= 2.0
	if qrng.unit() < scrappy_p:
		qt += qrng.rangef(float(RaceSim.QUALI_SCRAPPY_MIN), float(RaceSim.QUALI_SCRAPPY_MAX))

	return qt

# AI policy (§4.5): deterministic from attrs + qrng.
# Called once per car at the start of each segment.
func _apply_ai_policy(driver_id: int) -> void:
	var d: RaceSim.Driver = _get_driver(driver_id)
	if d == null:
		return
	var did: int = int(driver_id)
	var aggr: float = _attr(d, "aggression")
	var window: String
	var mode: String
	if aggr > 0.65:
		window = "late"
		mode   = "attack"
	elif aggr > 0.40:
		window = "mid"
		mode   = "attack" if qrng.unit() < 0.5 else "bank"
	else:
		window = "early"
		mode   = "bank"
	_window[did]   = window
	_mode[did]     = mode
	_run_time[did] = SEG_DURATION * float(WINDOW_MIDPOINTS.get(window, 0.50))

# AI second-run request: Q3 + time worse than estimated cut + aggressive.
func _ai_maybe_request_second(driver_id: int, lap_time: float) -> void:
	var did: int = int(driver_id)
	if segment != 2:
		return
	var d: RaceSim.Driver = _get_driver(did)
	if d == null or _attr(d, "aggression") <= 0.50:
		return
	# Estimate the P10 cut time from current times array.
	var known: Array = []
	for k in times:
		var tv: float = float(times[k])
		if tv >= 0.0:
			known.append(tv)
	if known.size() < 4:
		return
	known.sort()
	var cut_idx: int = mini(9, known.size() - 1)
	var p_cut: float = float(known[cut_idx])
	if lap_time > p_cut + SECOND_RUN_THRESHOLD:
		_second_requested[did] = true
		_second_run_time[did]  = SEG_DURATION * 0.88

# Start a new segment: assign AI policy, schedule run times.
func _start_segment() -> void:
	for did_v in _active_ids:
		var did: int = int(did_v)
		_run_count[did]        = 0
		_second_requested[did] = false
		_second_run_time[did]  = -1.0
		_time_set_at[did]      = -1.0
		runs[did]              = 0
		_apply_ai_policy(did)   # sets _window/_mode/_run_time for non-players

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

# Build a compact snapshot Dictionary for network broadcast.
func make_snapshot() -> Dictionary:
	var times_str: Dictionary = {}
	for k in times:
		times_str[str(k)] = float(times[k])
	var on_lap: Array = []
	for did_v in _active_ids:
		var did: int = int(did_v)
		if int(_run_count.get(did, 0)) == 0 and float(_run_time.get(did, SEG_DURATION)) <= elapsed:
			on_lap.append(did)
	var elim_copy: Array = []
	for v in eliminated:
		elim_copy.append(int(v))
	return {
		"segment":      segment,
		"elapsed":      elapsed,
		"seg_duration": SEG_DURATION,
		"times":        times_str,
		"on_lap":       on_lap,
		"eliminated":   elim_copy,
		"finished":     finished,
	}

# Convenience: set track params from the RaceSim track.
func set_track(track: RaceSim.Track) -> void:
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
