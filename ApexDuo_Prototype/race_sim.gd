class_name RaceSim
extends RefCounted

# ============================================================================
# Apex Duo — deterministic race-core simulation (2026 ruleset).
# Ported from a Python balance harness that is numerically verified:
# realistic gaps, working undercut, pace-mode trade-offs AND the new 2026
# energy model (battery State-of-Charge, clipping, Overtake boost, active-aero
# following) plus characteristic-driven tracks generated from F1 archetypes.
# Deterministic LCG RNG so the same seed reproduces the same race — the
# foundation for host-authoritative co-op netcode.
# ============================================================================

# Tire compounds: pace offset (s/lap, negative = faster), wear %/lap, cliff %.
# Tire compounds: pace offset (s/lap, negative = faster), wear %/lap, cliff %.
# wet_opt = the track wetness (0..1) the tyre is happiest at: slicks 0 (dry),
# intermediates ~0.45, full wets ~0.85. inter/wet pace is their DRY pace (slow) —
# the weather term (_m_weather) is what makes slicks hopeless once it rains.
# tlo/thi = the compound's operating WINDOW (temp 0..~1.2); warm = warm-up-rate
# multiplier. Soft: heats fast, low/narrow window (overheats sooner). Hard: heats
# slow, high/wide window (hard to switch on, never overheats). Drives #4/#5.
const COMPOUNDS := {
	"soft":   {"pace": -0.55, "wear": 2.6, "cliff": 65.0, "wet_opt": 0.0,  "tlo": 0.38, "thi": 0.76, "warm": 1.45},
	"medium": {"pace":  0.00, "wear": 1.7, "cliff": 78.0, "wet_opt": 0.0,  "tlo": 0.42, "thi": 0.88, "warm": 1.00},
	"hard":   {"pace":  0.55, "wear": 1.1, "cliff": 90.0, "wet_opt": 0.0,  "tlo": 0.44, "thi": 0.98, "warm": 0.65},
	"inter":  {"pace":  1.8,  "wear": 1.9, "cliff": 70.0, "wet_opt": 0.45, "tlo": 0.32, "thi": 0.80, "warm": 1.10},
	"wet":    {"pace":  3.6,  "wear": 1.6, "cliff": 78.0, "wet_opt": 0.85, "tlo": 0.28, "thi": 0.74, "warm": 1.00},
}

# Pace modes (ICE / tyre push): pace offset, wear multiplier, fuel multiplier, error risk.
const PACE_MODES := {
	"conserve": {"pace":  0.45, "wear": 0.80, "fuel": 0.90, "risk": 0.4},
	"balanced": {"pace":  0.00, "wear": 1.00, "fuel": 1.00, "risk": 1.0},
	"push":     {"pace": -0.45, "wear": 1.30, "fuel": 1.15, "risk": 1.8},
}

# 2026 ERS / battery modes: pace offset (s/lap), SoC change %/lap
# (+ = regen / harvest, − = deploy), extra PU-stress risk.
const ERS_MODES := {
	"harvest":  {"pace":  0.30, "soc":  6.0, "risk": 0.0},   # lift & coast, recharge
	"balanced": {"pace":  0.00, "soc":  0.0, "risk": 0.0},   # sustainable deploy
	"attack":   {"pace": -0.38, "soc": -6.5, "risk": 0.5},   # full deploy, drains fast
}

# Energy tuning (locked by the Python balance harness).
const CLIP_PENALTY := 0.32     # s/lap lost when battery spent  (× 0.6 + 0.8·power)
								# v0.6: clipping is now a RARE event, so the sting is
								# "annoying, not race-ending" (was 0.55).
const OT_PACE := -0.55         # s/lap Overtake boost           (× 0.6 + 0.8·power)
const SETUP_PEN := 0.45        # s/lap at setup_q=0 — car-setup miss penalty
                               # (max < CAR_K track-character swing: setup matters,
                               # never dominates; perfect setup = 0)
# --- Unified setup model (6 grouped axes, dual ideal) — spec 2026-06-11 -------
# 6 axes: 0 aero_balance · 1 ride_rake · 2 mech_balance · 3 diff · 4 brakes_cool
# · 5 gears. Two hidden ideals (opt_quali / opt_race) diverge on axes 0,1,4 so a
# one-lap setup can't also be the best race setup — the player picks a point on
# the line. setup_q_race additionally drives tyre wear/temp (the fork "bites").
const SETUP_AXES := 6
const SETUP_FORK := 0.12       # opt_quali vs opt_race divergence on axes 0,1,4
const SETUP_NORM := 2.4        # setup_quality normalizer (6 axes × 0.40 noticeable)
const SETUP_WEAR_K := 0.30     # extra tyre-wear mult at full race-setup miss
const SETUP_TEMP_K := 0.06     # extra tyre-temp target at full race-setup miss
# Blistering: the lasting cost of an over-aggressive (quali-trim) setup on a hot
# track — builds above the tyre's thermal window, never decays in-stint (only a
# pit clears it), mirror of graining with the sign flipped.
const BLISTER_BUILD := 0.9     # build rate above the window (× over-temp × load)
const BLISTER_PACE := 1.2      # s/lap at full blister (kept modest per review)
const BLISTER_WEAR := 0.6      # extra wear mult at full blister
# Weekend conditions (deterministic per seed, own stream — the "fresh puzzle").
const COND_TEMP_LO := 22.0     # cool weekend track temp (°C-ish)
const COND_TEMP_HI := 40.0     # hot weekend track temp
const COND_WIND_MAX := 0.12    # max optimum displacement from wind (axes 0,1)
# --- 2026 store dynamics (energy rework v0.6) --------------------------------
# ONE cycling store (the v0.4 deploy_budget counter was DELETED — it double-
# counted deploy and disagreed with soc, the diagnosed root cause). The 4 MJ
# store cycles WITHIN a lap so the battery visibly "breathes": down the
# straights (deploy), up through the braking zones (regen). Rates are %/s (× dt).
# v0.6 fix: deploy is rationed HARD on low-energy_limit power tracks via a
# squared el_scale, and regen has a floor so power tracks aren't double-starved —
# so balanced no longer pins at zero on Монца (was 40% of the lap clipped).
const SOC_DEPLOY_PS := {"harvest": 0.6, "balanced": 2.7, "attack": 4.6}
const SOC_EL_SCALE0 := 0.20    # deploy-rate floor of the energy_limit scaling
const SOC_EL_EXP := 2.0        # square the el term → power tracks ration deploy hard,
								# technical (high-el) tracks stay near-unaffected
const SOC_REGEN_PS := 1.6      # %/s braking regen (× harvest char × intensity)
const SOC_HARVEST_REGEN := 1.6 # harvest mode: extra regen (lift & coast)
const SOC_HARVEST_FLOOR := 0.60 # floor on the (0.5+harvest) regen factor so power/
								# street tracks that already ration deploy via el
								# don't ALSO get starved of regen (double penalty)
const OT_DRAIN_PS := 1.6       # extra SoC %/s while the Overtake boost fires
								# (kept cheap: the real MOM recharges every braking
								# zone, so a chaser can press for laps on end)
const CLIP_TRICKLE_PS := 1.0   # straight-line recharge while clipped (was 0.4 —
								# too slow to escape a clip within one straight+brake)
const OT_MIN_SOC := 8.0        # below this the Overtake boost can't fire (v0.5:
								# raw SoC dips low at the end of straights — the
								# boost must stay alive deeper into the discharge)
const OT_GAP_S := 1.0          # Overtake works only within 1.0s of the car ahead
const SOC_RECOVER := 15.0      # SoC to exit a clip (hysteresis). ABOVE OT_MIN_SOC=8
								# so a car leaving a clip has a usable boost reserve;
								# fast recovery comes from CLIP_TRICKLE_PS + regen.
const SOC_ATTACK_GATE := 40.0  # attack ERS pace gets full benefit at/above this SoC,
								# scaling to 0 at empty (replaces the deleted budget gate)
const SOC_AVG_TAU := 20.0      # s — soc_avg smoothing for AI/radio decisions
const DA_THRESH := 0.7         # dirty-air time gap (s) — smaller than pre-2026
const DA_COEF := 0.42          # dirty-air strength (× 0.5 + downforce × 1.4 − overtaking)
const SLIP_THRESH := 1.4       # slipstream tow zone (s) — wider than dirty air
const SLIP_COEF := 0.48        # max tow pace gain (s/lap) at zero gap (× power+overtaking−0.72)
const PASS_OT_BASE := 0.48     # pass-credit accrual floor (raised v0.5: the fast
								# store cycle interrupts OT pressure more often)
const PASS_OT_K := 1.6         # pass-credit accrual gain per unit track.overtaking

# 2026 high-speed taper (energy rework v0.4 budget DELETED in v0.6 — the attack
# pace gate now reads live soc_avg, not a separate per-lap counter).
# TAPER_K: high-speed taper — attack mode is worth less on high-power tracks
# (electric power wasted above ~290 km/h where the MGU-K output tapers to zero).
const TAPER_K            := 0.35 # attack pace scaling loss per unit of track.power
# Active-aero (Straight Mode zones) — low-drag straights give a small per-lap
# pace gain (proportional to car power). The old per-zone SoC bonus was folded
# into the v0.5 store dynamics (energy_limit scaling of the deploy rate).
const AERO_ZONE_K  := 0.012      # s/lap pace gain per zone per unit of car-power blend

# Safety car (driven by track.sc_prob). Verified in the Python harness:
# occurrence ≈ sc_prob, field bunches to a tight train, pits get cheaper.
const SC_PACE_MULT := 1.40     # everyone laps at 140% of base under the SC
const SC_MIN_LAPS := 3         # SC stays out at least this many laps
const SC_MAX_LAPS := 5
# The field is NOT teleported into a train on deploy (that un-lapped lapped
# cars and ate lap bookkeeping). Cars far behind the one ahead close up at a
# catch-up pace instead, so the train forms physically over the SC laps.
const SC_CATCH_GAP := 0.7      # s: further than this behind the car ahead → catch up
const SC_CATCH_MULT := 1.08    # catch-up pace multiplier (vs SC_PACE_MULT of the train)
const SC_PIT_FACTOR := 0.55    # pit stop costs less under SC (slow field)
const SC_EARLIEST := 0.15      # deploy window as a fraction of race distance
const SC_LATEST := 0.70

# Track-position / overtaking model. A following car is pinned behind the car
# ahead until it earns the pass: it must build up a cumulative pace edge that
# beats the track's resistance (high on low-overtaking circuits). This replaces
# free progress-swapping (which let noise make cars overtake endlessly).
const COMBAT_GAP := 0.8        # seconds: within this, two cars fight for position
const MIN_GAP_S := 0.25        # a held car sits this far behind the leader (s)
const GRID_GAP := 0.0022       # qualifying start spacing (laps) per grid slot
const PASS_DEADZONE := 0.02    # must be clearly faster than this (s/lap) to build pressure
const CREDIT_DECAY := 0.30     # built-up pressure bleeds off when not faster

# Qualifying simulation (one flying lap per car on softs, separate qrng stream).
# QUALI_NOISE_BASE: per-lap noise width σ = base × (1.3 − consistency×0.6).
# Wider than race noise (0.025) because a single flying lap is riskier.
# Scrappy-lap: composure gates the chance; adds a meaningful time loss to the
# quali score so composure-less drivers can qualify poorly even if fast.
const QUALI_NOISE_BASE  := 0.08    # s — wider than race noise (single-lap variance)
const QUALI_SCRAPPY_P   := 0.05    # per-car probability of a messy qualifying lap
const QUALI_SCRAPPY_MIN := 0.12    # minimum time cost of a scrappy lap (s)
const QUALI_SCRAPPY_MAX := 0.55    # maximum time cost of a scrappy lap (s)

# Race-start spread (lap 1 only; applied once in _race_start on the first tick).
# Good starters (attr "starts" > 0.5) gain lap_frac; poor starters lose it.
# START_GAIN_K: lap-frac delta per unit starts deviation from 0.5 × 2.
# Hard cap at START_MAX_SHIFT slots prevents any car teleporting past the field.
# START_GAIN_K 0.012: a starts=0.80 driver gains ~0.36 × 0.012 = 0.0043 lap_frac
# ≈ 2 grid slots; a starts=0.20 driver loses ~0.30 × 0.012 = 0.0036 ≈ 1.6 slots.
const START_GAIN_K     := 0.012   # lap-frac per (starts − 0.5) unit
const START_NOISE_AMP  := 0.002   # random noise added to the start launch (lap-frac)
const START_MAX_SHIFT  := 2       # hard cap: max grid slots gained/lost at start
# Getaway outcomes (one erng roll per car at lights-out, by attributes — NOT a
# reaction minigame, so co-op latency / AFK is never punished; AI rolls the same).
const BOG_BASE := 0.60            # bog-down chance scale × (1−starts) × (1.3−composure)
								  # (tuned for ~1.3 bogs/race with a high-skill F1 field)
const BOG_LOSS_MIN := 1.2
const BOG_LOSS_MAX := 3.5
const JUMP_BASE := 0.06           # jump-start chance × (1−discipline) × (1−composure)
const JUMP_PENALTY := 5.0         # s added to finish_time + finish_key (like 2-compound +20)
const JUMP_GAIN := 0.0015         # small launch gain from anticipating (lap-frac)
const STALL_BASE := 0.035         # stall chance × (1−starts)²  (rare, big loss)
const STALL_LOSS_MIN := 6.0
const STALL_LOSS_MAX := 12.0
# In-race "save" lever (lift-and-coast): trade pace for energy bank + fuel margin.
const SAVE_PACE := 0.25           # s/lap slower while saving
const SAVE_SOC_REGEN := 0.6       # extra %/s SoC regen on straights while saving
const SAVE_FUEL_RATE := 0.82      # fuel laps burned per lap while saving (vs 1.0)
const FUEL_PUSH_BURN := 1.06      # fuel laps burned per lap in push pace
const FUEL_MARGIN_LAPS := 1.0     # default load = race distance + this (so doing nothing is safe)
const FUEL_CRITICAL := 0.4        # below this many laps of fuel → starvation penalty
const FUEL_STARVE_PEN := 1.5      # s/lap when starving (v1: pace-only, NO DNF)

# FM-style driver attributes (1..20). Verified in the Python harness: they shape
# behaviour (tyre life, overtaking, defending, errors) on top of base pace.
const ATTR_KEYS := ["pace", "overtaking", "defending", "tyre", "energy", "race_iq",
	"composure", "consistency", "aggression", "discipline", "wet", "starts"]

# Car model: power/aero bias character + reliability failure scale.
# SKILL_K: s/lap of pace per unit of combined driver+car skill (0..1). Raised
# 1.0 → 3.0 (balance pass 2026-06-10): the old field spread (0.23 s/lap) was
# smaller than the CAR_K track bias, so backmarker power-cars out-qualified the
# top teams at Monza. CAR_K cut 2.5 → 1.2 in the same pass: track character is
# a flavour (±~0.17 s/lap), not a verdict. Tuned against the real-engine suite
# (godot-MCP headless runs: Монако/Монца/Бахрейн × 2 seeds).
const SKILL_K := 3.0           # s/lap per unit skill (race + quali — keep in sync)
const CAR_K := 1.2             # s/lap per (power−aero)·(track power−downforce)
const DNF_BASE := 0.005        # per-lap mechanical-failure scale × (1−reliability)

# Incidents & wear-out (Wave 3): driver errors, contact, damage, component health.
const INCIDENT_K := 0.00010   # base per-tick driver-error scale (× situational risk)
const MOOD_PACE := 0.004      # in-the-zone pace swing as a fraction of base laptime (±0.4%)
const EVO_MAX := 0.8          # max grip gain from a fully rubbered-in track (s/lap, ×evolution)
# (v0.6: CORNER_DEPLOY_REGEN / STRAIGHT_CLIP / STRAIGHT_CLIP_DEADZONE /
# HARVEST_BUDGET_REGEN deleted with the per-lap deploy_budget counter. Clipping
# is now a pure raw-SoC event; lift-and-coast banks energy via harvest-mode SoC regen.)
# Segment-aware overtaking: pass-credit builds far faster on straights (where the
# slipstream run + Overtake make the move) than in corners. Normalized per track so
# the lap-average is 1 → passes concentrate at braking zones WITHOUT changing the
# tuned corridor totals.
const PASS_STRAIGHT_BIAS := 1.0
const PASS_CORNER_BIAS := 0.25
const COL_BASE := 0.025       # wheel-to-wheel contact chance per lap of close fighting
const DMG_K := 3.2            # s/lap of pace lost at full aero damage
const PU_WEAR := 0.0011       # component health lost per lap of racing (× push stress)

# Weather (Wave 4): wet pace loss when the tyre doesn't suit the conditions.
const WET_K := 16.0          # s/lap per (wetness − tyre wet_opt)² mismatch
const WET_BASE := 3.0        # base wet-running slowdown (× wetness, × inverse wet skill)

# Discrete weather states — derived each tick from the continuous wetness float.
const WEATHER_DRY      := "dry"
const WEATHER_VARIABLE := "variable"
const WEATHER_RAIN     := "rain"
const WEATHER_STORM    := "storm"

# Lap-time penalty (seconds) for compound mismatch with the current weather state.
# Rows: 0=slick (soft/med/hard), 1=inter, 2=wet
# Cols indexed by [dry, variable, rain, storm]
const WEATHER_COMPOUND_PENALTY: Array = [
	[0.0, 1.5, 4.0, 8.0],   # slick
	[3.0, 0.0, 0.5, 2.0],   # inter
	[6.0, 2.0, 0.0, 0.0],   # wet
]

# Thermal model: tyre temperature (0..~1.2), optimal window, warm-up/overheat.
const TYRE_TEMP_START := 0.20  # cold tyres out of the pits (forces an out-lap cost)
const TYRE_TEMP_GRID := 0.55   # warmer at the race start (formation lap)
const TYRE_EASE := 0.6         # how fast tyre temp eases toward target (per lap)
const COLD_TEMP := 0.45        # below this the tyre is cold (grip loss)
const HOT_TEMP := 0.90         # above this the tyre overheats (extra wear)
const COLD_PACE := 4.0         # s/lap lost when fully cold (× temp deficit below the window)
const OVERHEAT_WEAR := 1.5     # extra wear multiplier at full overheat
# #5 graining: a separate, RECOVERABLE state that builds when the tyre runs below its
# operating window under load (cold sliding) and decays once temp comes back in.
const GRAIN_BUILD := 1.25      # graining accumulation rate (× temp deficit × load)
const GRAIN_DECAY := 0.85      # graining recovery rate once back in the window (per lap)
const GRAIN_PACE := 1.7        # s/lap lost at full graining
const GRAIN_WEAR := 0.45       # extra wear multiplier at full graining

# -------------------- deterministic RNG (LCG) --------------------
class RNG:
	var state: int
	func _init(s: int) -> void:
		state = s & 0xFFFFFFFF
	func next_u32() -> int:
		state = (1664525 * state + 1013904223) & 0xFFFFFFFF
		return state
	func unit() -> float:
		return float(next_u32()) / 4294967296.0
	func rangef(a: float, b: float) -> float:
		return a + (b - a) * unit()

# SplitMix-style 32-bit hash: decorrelates consecutive seeds. Used to seed a
# separate race-events RNG so the safety-car roll is well-distributed even when
# races use sequential seeds (e.g. restart = seed + 1).
static func mix32(x: int) -> int:
	x = (x + 0x9E3779B9) & 0xFFFFFFFF
	x = ((x ^ (x >> 16)) * 0x85EBCA6B) & 0xFFFFFFFF
	x = ((x ^ (x >> 13)) * 0xC2B2AE35) & 0xFFFFFFFF
	return (x ^ (x >> 16)) & 0xFFFFFFFF


# ============================================================================
#  CAR SETUP (practice weekend phase) — verified in car_setup_check.py
#  6 grouped axes, each with a hidden ideal that shifts with track character +
#  a name-hash jitter (+ weekend conditions). Two ideals (quali / race) diverge
#  so one setup can't win both — the player converges a point on the line via
#  practice feedback; engineers build every car a fair baseline (same code for
#  AI and player), so skipping practice is never a punishment.
# ============================================================================

# Hidden ideal setup vector (6 axes). bias: "base" (midpoint), "quali" (one-lap
# trim), or "race" (stint trim) — quali/race diverge by SETUP_FORK on axes 0,1,4.
# cond_off is an optional per-weekend displacement (wind, from weekend_conditions).
static func track_ideal_setup(t: Track, bias: String = "base", cond_off: Array = []) -> Array:
	var h := mix32(int(t.name.hash()))
	var jit: Array = []
	for i in SETUP_AXES:
		jit.append(float((h >> (3 + i * 5)) & 1023) / 1023.0 * 0.16 - 0.08)
	var base: Array = [
		0.10 + t.downforce * 0.80,                       # 0 aero_balance
		0.20 + t.downforce * 0.55 - t.abrasion * 0.20,   # 1 ride_rake
		0.18 + t.abrasion * 0.35,                        # 2 mech_balance
		0.25 + (1.0 - t.overtaking) * 0.40,              # 3 diff
		0.20 + t.abrasion * 0.45,                        # 4 brakes_cool
		0.10 + t.power * 0.80,                            # 5 gears
	]
	# fork on axes 0,1,4: quali trims them low (aggressive, runs hot), race high.
	var fork := 0.0
	if bias == "quali":
		fork = -SETUP_FORK
	elif bias == "race":
		fork = SETUP_FORK
	var out: Array = []
	for i in SETUP_AXES:
		var v: float = float(base[i]) + jit[i]
		if i == 0 or i == 1 or i == 4:
			v += fork
		if i < cond_off.size():
			v += float(cond_off[i])
		out.append(clampf(v, 0.05, 0.95))
	return out


# Setup quality 0..1 from L1 distance to an ideal vector over SETUP_AXES (missing
# axes treated as neutral 0.5 so legacy/short vectors degrade gracefully).
static func setup_quality(setup: Array, ideal: Array) -> float:
	var dist := 0.0
	for i in SETUP_AXES:
		var s: float = float(setup[i]) if i < setup.size() else 0.5
		dist += absf(s - float(ideal[i]))
	return clampf(1.0 - dist / SETUP_NORM, 0.0, 1.0)


# Score a setup vector against BOTH ideals and write the two quality fields.
func _apply_setup_vector(d: Driver, setup: Array) -> void:
	d.setup_q_quali = setup_quality(setup, track_ideal_setup(track, "quali", cond_setup_off))
	d.setup_q_race = setup_quality(setup, track_ideal_setup(track, "race", cond_setup_off))


# The engineers build a fair baseline: a vector converged from neutral toward the
# crew's favoured ideal by engineer skill × sessions. SAME code for every car —
# AI teams and a player who skips practice both land here (no side has an edge
# beyond staff quality). A practicing human overrides this via set_setup().
func apply_engineer_setup(d: Driver, sessions: int = 3) -> void:
	var favor_race: bool = d.pit_plan >= 2 or d.strat_skill > 0.6
	var ideal := track_ideal_setup(track, "race" if favor_race else "quali", cond_setup_off)
	var conv: float = clampf((0.35 + 0.55 * d.eng_skill) * (float(sessions) / 3.0 * 0.6 + 0.4), 0.0, 0.97)
	var sk := mix32(int(track.name.hash()) ^ (d.id * 7919))
	var v: Array = []
	for i in SETUP_AXES:
		var noise := float((sk >> (i * 4)) & 15) / 15.0 * 0.06 - 0.03
		v.append(clampf(lerp(0.5, float(ideal[i]), conv) + noise, 0.05, 0.95))
	_apply_setup_vector(d, v)


# Apply a player-tuned setup (sliders 0..1). Pre-race only and never under parc
# fermé (locked at qualifying start) — the race reads only the resulting setup_q.
func set_setup(car_id: int, setup: Array) -> void:
	var d := get_driver_by_id(car_id)
	if d != null and not _started and not parc_ferme:
		_apply_setup_vector(d, setup)


# Deterministic per-weekend conditions (own seed stream; never touches rng/erng/
# qrng so practice/skip can't desync the race). race_temp drives the tyre loop;
# cond_setup_off displaces the optimum (wind) so each weekend is a fresh puzzle.
func weekend_conditions() -> Dictionary:
	var cs := mix32(mix32(race_seed) ^ 0xC04D)
	var temp_u := float(cs & 0xFFFF) / 65535.0
	var wind0 := float((cs >> 8) & 1023) / 1023.0 * 2.0 - 1.0
	var wind1 := float((cs >> 18) & 1023) / 1023.0 * 2.0 - 1.0
	return {
		"race_temp": COND_TEMP_LO + (COND_TEMP_HI - COND_TEMP_LO) * temp_u,
		"wind_off": [wind0 * COND_WIND_MAX, wind1 * COND_WIND_MAX, 0.0, 0.0, 0.0, 0.0],
	}

# One practice run: lap time on the given setup + the driver's per-axis read.
# Deterministic from (track, driver, setup, run_idx) via its own hash — does
# NOT touch the sim's rng streams, so practice cannot desync the race.
# fb codes per axis: 0 sweet spot · ±1 a bit high/low · ±2 way high/low ·
# 9 driver can't read it. Precision = race_iq + engineer telemetry.
# run_type: "short" (quali-sim, reveals axes 0,3,5 vs the QUALI ideal), "long"
# (race-sim, reveals axes 1,2,4 vs the RACE ideal), "install"/"" (all axes vs race
# ideal). cond_off = the weekend wind displacement (pass sim.cond_setup_off).
static func practice_run(t: Track, d: Driver, setup: Array, run_idx: int,
		run_type: String = "", cond_off: Array = []) -> Dictionary:
	var bias := "quali" if run_type == "short" else "race"
	var ideal := track_ideal_setup(t, bias, cond_off)
	var q := setup_quality(setup, ideal)
	var hk := 0
	for i in SETUP_AXES:
		var sv: float = float(setup[i]) if i < setup.size() else 0.5
		hk ^= (int(sv * 977.0) << (i * 3))
	var h := mix32(int(t.name.hash()) ^ (d.id * 7919) ^ (run_idx * 104729) ^ hk)
	var consist := float(d.attrs.get("consistency", 13)) / 20.0
	var noise := (float(h & 0xFFFF) / 65535.0 * 2.0 - 1.0) \
		* (0.10 + (1.0 - consist) * 0.25)
	var time := t.base_laptime - d.skill * SKILL_K \
		- (d.car_power - d.car_aero) * (t.power - t.downforce) * CAR_K \
		+ float(COMPOUNDS["medium"]["pace"]) \
		+ (1.0 - q) * SETUP_PEN * 2.0 + 1.2 + noise
	var iq := float(d.attrs.get("race_iq", 13)) / 20.0
	var acc := clampf(0.45 + iq * 0.35 + d.eng_skill * 0.20, 0.0, 0.97)
	var band := lerpf(0.18, 0.03, acc)        # telemetry numeric precision (±band)
	# which axes this run type lets the driver read (others return 9 "can't tell")
	var reveal: Array
	if run_type == "short":
		reveal = [0, 3, 5]
	elif run_type == "long":
		reveal = [1, 2, 4]
	else:
		reveal = [0, 1, 2, 3, 4, 5]
	var fb: Array = []
	for i in SETUP_AXES:
		var s: float = float(setup[i]) if i < setup.size() else 0.5
		var err := s - float(ideal[i])
		var sense_u := float((h >> (8 + i * 4)) & 127) / 127.0
		if not (i in reveal):
			fb.append(9)
		elif absf(err) < 0.06:
			fb.append(0)
		elif sense_u < acc:
			fb.append((2 if absf(err) > 0.20 else 1) * (1 if err > 0.0 else -1))
		else:
			fb.append(9)
	return {"time": time, "fb": fb, "band": band, "q": q}

# -------------------- driver --------------------
class Driver:
	var id: int
	var name: String
	var skill: float          # 0..1 (combined car+driver pace)
	var is_player: bool = false   # human-controlled (you or co-op partner)
	var team: bool = false        # belongs to the player's team
	var role: String = ""         # "Директор" / "Инженер" (co-op label)
	var compound: String = "medium"
	var tire_wear: float = 0.0
	var tyre_temp: float = 0.20    # 0..~1.2 thermal state (cold → grip loss, hot → wear)
	var graining: float = 0.0      # 0..1 recoverable grip loss from cold sliding (#5)
	var wear_mult: float = 1.0     # <1.0 = tyre R&D reduces wear (season upgrades)
	var pace_mode: String = "balanced"
	# --- 2026 energy (battery State of Charge) ---
	var ers_mode: String = "balanced"  # harvest / balanced / attack
	var save: bool = false             # lift-and-coast: bank energy + fuel for SAVE_PACE s/lap
	var overtake: bool = false         # Overtake boost armed (fires within 1s)
	var soc: float = 80.0              # battery charge 0..100 (%) — pulses within a lap (v0.5)
	var soc_avg: float = 80.0          # lap-smoothed SoC: AI/radio decisions read this, not the raw pulse
	var soc_max: float = 100.0         # usable battery (energy R&D can raise it)
	var harvest_mult: float = 1.0      # >1 = better regen (energy R&D)
	var clipped: bool = false          # battery spent: no deploy until recovered
	# (v0.6: deploy_budget / power_cut / power_cut_pen DELETED — one cycling store)
	var fuel_laps: float = 0.0
	var lap: int = 0
	var lap_frac: float = 0.0
	var last_lap: float = 0.0
	var pit_count: int = 0
	var pitting: bool = false
	var pit_request_compound: String = ""
	var finished: bool = false
	var time_penalty: float = 0.0  # added to finish_time + finish_key (jump-start, etc.)
	var finish_time: float = -1.0
	var finish_key: float = 0.0    # classification: shared-timeline instant the
	                               # finish line was crossed (sub-tick precise);
	                               # finish_time is kept for gap display only
	var pit_timer: float = 0.0     # >0 = in pit lane / stalled, distance frozen
	var ai_pit_wear: float = 0.0
	var yield_laps: int = 0        # team order: ease off to let teammate through
	var credit: float = 0.0        # overtake pressure built up on the car ahead
	var last_lt: float = 0.0       # this tick's clean lap time (for combat edge)
	var color: String = "#8a94a6"  # team colour (for the minimap)
	var slot: int = 0              # 0 / 1 — which of the team's two cars
	var attrs: Dictionary = {}     # FM-style ability attributes (1..20)
	var grid_pos: int = 0          # qualifying grid position (1 = pole)
	var passes_made: int = 0       # on-track overtakes completed this race
	var best_lap: float = 0.0      # fastest lap this race (0 = none yet)
	var tyre_laps: int = 0         # laps on the current set of tyres (reset on pit)
	# hybrid control: the engineer sets a directive, the driver executes it
	# (or defies it by personality). dir_pace/dir_intent are the orders.
	var dir_pace: String = "balanced"   # push / balanced / conserve
	var dir_intent: String = "free"     # free / attack / hold
	var obey: bool = true               # is the driver following orders this lap?
	var trust: float = 60.0             # 0..100 driver trust (gates compliance, drifts in-race)
	var trust_last_pos: int = 0         # race position at lap start (for trust outcome eval)
	var radio_cd: int = 2               # laps until this driver's next radio message
	var had_incident: bool = false      # an incident happened this lap (trust penalty hook)
	var next_call_time: float = 0.0     # sim-time before the engineer can issue the next radio call
	var mood: float = 0.0               # -1..+1 in-race confidence ("in the zone" ↔ rattled); team cars only
	# car (per team): power/aero are a track-character bias; reliability → DNF.
	var car_power: float = 0.78
	var car_aero: float = 0.78
	var reliability: float = 0.80
	var dnf: bool = false               # retired (mechanical failure)
	# team personnel (Wave 2): staff skills 0..1 that feed the race
	var strat_skill: float = 0.5        # strategist → AI pit/strategy quality
	var pit_speed: float = 0.5          # pit crew → faster stops
	var pit_consistency: float = 0.5    # pit crew → less variance / fewer botched stops
	var reliability_work: float = 0.5   # garage → lowers mechanical-failure risk
	var team_idx: int = -1              # M4: owning team (DHL fastest-stop zachet)
	var best_stop: float = 999.0        # M4: fastest crew-box stop this race (s)
	var pit_total: float = 0.0          # total duration of the current pit stop (map phase)
	var in_pitlane: bool = false        # truly in the pit lane (vs a brief on-track stall)
	var aero_damage: float = 0.0        # 0..1 floor/wing damage → pace penalty until repaired
	var pu_health: float = 1.0          # 1..0 component condition (drops with use → more DNF)
	var compounds_used: Array = []      # strings (set): tracks which slick compounds this driver has used
	# --- sector timing ---
	var cur_sector: int = 0               # 0 / 1 / 2 — current macro sector
	var sector_entry_time: float = -1.0   # elapsed when entered current sector
	var sector_times: Array = [-1.0, -1.0, -1.0]   # last completed S1/S2/S3 (s)
	var sector_best:  Array = [-1.0, -1.0, -1.0]   # personal best per sector (s)
	var soc_at_sector: Array = [80.0, 80.0, 80.0]  # SoC when entering each sector
	# --- mini-sector timing (17 total: 5+7+5) ---
	var cur_mini: int = 0                 # index of next unfinished mini-sector
	var mini_entry_time: float = -1.0     # elapsed when entered current mini-sector
	var mini_times_this_lap: Array = []   # size 17; -1.0 = not yet done this lap
	var mini_best: Array = []             # size 17; personal best per mini
	var mini_prev: Array = []             # last completed lap mini times (for green sector tier)
	# --- AI brain v2 (Phase 1): attack patience ---
	var attack_laps: int = 0       # consecutive laps camped within attack range
	var attack_backed: bool = false  # stalled attack abandoned — strike at the stops
	var atk_latch: bool = false    # fight is live: hysteresis floor stays at the
	                               # release threshold across non-DRS (banking) sectors
	var pressure: float = 0.0      # 0..1 hunted-pressure: builds under a sustained
	                               # threat behind, decays by composure; raises error risk
	var cover_pit: bool = false    # M-S1: strategist calls a stop to cover a rival's pit
	var pit_plan: int = 1          # M-S2: planned stops (2 where wear maths demand it)
	# --- car setup (practice weekend phase) — dual ideal (quali vs race) ---
	var setup_q_quali: float = 0.6 # 0..1 vs opt_quali → drives QUALIFYING pace
	var setup_q_race: float = 0.6  # 0..1 vs opt_race → drives RACE pace + tyre wear/temp
	var blister: float = 0.0       # 0..1 thermal blistering (over-aggressive setup on a hot
	                               # track); permanent in-stint, clears on a pit stop
	var eng_skill: float = 0.5     # race engineer telemetry (per car slot) — baseline
	                               # setup quality + sharper practice feedback
	var follow_pen: float = 0.0    # this tick's net following term (dirty air − slipstream)
	var da_pen: float = 0.0        # dirty-air part only — excluded from the M-A2 stall
	                               # edge (an armed Overtake waives it); the tow stays in
	var edge_ema: float = 0.0      # lap-smoothed fight pace edge on the car ahead
	func progress() -> float:
		return float(lap) + lap_frac
	# 0..1 progress through the pit stop (for the minimap pit-lane animation).
	func pit_phase() -> float:
		if not in_pitlane or pit_total <= 0.0:
			return 0.0
		return clampf(1.0 - pit_timer / pit_total, 0.0, 1.0)

# -------------------- track --------------------
class Track:
	var name: String = "Test Circuit"
	var laps: int = 50
	var base_laptime: float = 90.0
	var pit_loss: float = 21.0
	var abrasion: float = 1.0
	# --- 2026 character (0..1) — shapes how the new mechanics play out here ---
	var downforce: float = 0.6     # cornering demand: tyre stress + dirty-air strength
	var power: float = 0.6         # straight-line / deploy sensitivity + clipping cost
	var overtaking: float = 0.6    # ease of passing (inverse dirty-air strength)
	var harvest: float = 0.6       # braking-zone energy-recovery opportunity per lap
	var deploy: float = 0.6        # how fast attack / Overtake drains the battery
	var sc_prob: float = 0.2       # safety-car probability (calendar/flavour hook)
	var wet_prob: float = 0.2      # rain probability (calendar/flavour hook)
	var archetype: String = "mixed"
	var air_temp: float = 20.0     # ambient air (°C) — flavour + thermal base
	var track_temp: float = 30.0   # track surface (°C) — drives the tyre warm-up window
	var pit_lane: float = 0.05     # pit-lane length, fraction of a lap → pit_loss + the map
	# 2026 energy rework v0.4
	var energy_limit: float = 0.80 # per-lap deployable-energy scale (0.55 power → 1.0 technical)
	var aero_zones: int = 2        # count of low-drag Straight Mode zones (0 Monaco → 4 Monza)
	var length_km: float = 5.0     # circuit length (km) — turns laptime into a km/h readout
	var evolution: float = 0.5     # 0..1 how much the track rubbers-in over a race (street = high)
	var corners: int = 15          # number of corners (flavour + foundation for the segment model)
	var straight_km: float = 0.9   # longest straight (km) — flavour + future slipstream/energy use
	# Segment model (Direction B): the lap as an alternating sequence of straights
	# and corners. Each seg = {kind:"straight"/"corner", frac, intensity, start}.
	# `frac` sums to 1.0; `start` is the cumulative lap-fraction where the seg begins.
	var segments: Array = []
	# --- sector model ---
	# sector_bounds: lap_frac where S1 ends, then S2 ends (S3 always ends at 1.0)
	var sector_bounds: Array = [0.33, 0.67]
	# sector_chars: per-sector {power, aero, harvest, drs} — shapes DRS eligibility and
	# ERS AI decisions; does NOT change current_laptime() (balance preserved).
	var sector_chars: Array = [
		{"power": 0.5, "aero": 0.5, "harvest": 0.6, "drs": false},
		{"power": 0.6, "aero": 0.4, "harvest": 0.5, "drs": true},
		{"power": 0.5, "aero": 0.5, "harvest": 0.5, "drs": false},
	]
	# mini_sector_bounds: 17 lap_frac values marking end of each mini-sector.
	# 5 in S1, 7 in S2, 5 in S3. Populated by _build_mini_bounds().
	var mini_sector_bounds: Array = []

	# Populate mini_sector_bounds from sector_bounds (call after setting sector_bounds).
	func _build_mini_bounds() -> void:
		mini_sector_bounds = []
		var counts: Array = [5, 7, 5]
		var s_start := 0.0
		for si in 3:
			var s_end: float = float(sector_bounds[si]) if si < 2 else 1.0
			var n: int = int(counts[si])
			for mi in n:
				mini_sector_bounds.append(s_start + (s_end - s_start) * float(mi + 1) / float(n))
			s_start = s_end

	var straight_frac: float = 0.4 # total fraction of the lap spent on straights (cached)
	# Which segment a lap-fraction falls in (returns the seg Dictionary, or {}).
	func seg_at(frac: float) -> Dictionary:
		var ff: float = fposmod(frac, 1.0)
		for s in segments:
			if ff >= float(s["start"]) and ff < float(s["start"]) + float(s["frac"]):
				return s
		return segments[0] if not segments.is_empty() else {}

# team pit crew: a single crew can't service both cars at once
const PIT_STACK_PENALTY := 7.0    # extra sec for a stacked (same-window) team stop
const TEAM_CREW_BUSY := 7.0       # how long the crew stays busy after a team stop
# M4: crew-box stop-time model (the DHL "fastest stop" readout, seconds).
# Derived from the same noise rolls as the pit loss — adds NO new rng draws,
# so race outcomes for a given seed are unchanged. Corridors (verified in
# meta_m4_pitcrew_check.py): crew 18-20 → ~2.0 s ± 0.1; crew 6-8 → ~2.8 s ± 0.8.
const STOP_TIME_BASE := 3.27       # stop at pit_speed = 0
const STOP_TIME_SPEED_K := 1.33    # seconds shaved per 1.0 pit_speed
const STOP_TIME_SIGMA_MIN := 0.05  # variance floor (perfect crew still wobbles)
const STOP_TIME_SIGMA_K := 1.15    # variance from (1 - pit_consistency)
const STOP_BOTCH_EXTRA := 2.0      # botched stop (cross-threaded wheel) penalty
# Pit-lane → time: total stop ≈ stationary base + lane transit (∝ pit-lane length),
# so a longer pit lane costs more and the map's drawn lane matches the time lost.
const PIT_BASE := 13.0            # stationary stop + entry/exit delta (s)
const PIT_LANE_K := 140.0         # s per unit of pit-lane fraction (longer lane = more loss)

# First-lap (Turn-1) incident: a seeded chance of a start/spin that freezes the
# victim(s) for a few seconds (uses pit_timer = "distance frozen", so it NEVER
# touches `lap` — combat invariant safe). Rolled on erng at race start; an
# incident can also bring out the safety car. Tunables verified in
# t1_incident_check.py + a real-engine frequency run.
const T1_INCIDENT_BASE := 0.12     # base per-race probability
const T1_INCIDENT_TRACK_K := 0.15  # +prob where the track is hard to pass (low overtaking)
const T1_INCIDENT_DOUBLE := 0.30   # chance a second car is collected
const T1_LOSS_MIN := 3.0           # min time loss (s)
const T1_LOSS_MAX := 14.0          # max time loss (s)
const T1_SC_UPLIFT := 0.35         # chance the incident triggers a safety car (if none scheduled)

# -------------------- sim state --------------------
var track: Track
var drivers: Array = []           # Array[Driver]
var rng: RNG
var elapsed: float = 0.0
var finished: bool = false
var team_pit_cooldown: float = 0.0   # >0 = team pit crew busy
var last_event: String = ""          # one-shot race message for the UI to show
var event_log: Array = []            # persistent feed: [{lap, text, kind}], capped at 24
var fastest_lap: float = 0.0         # race fastest lap time (0 = none yet)
var fastest_id: int = -1             # driver id that holds the fastest lap
var sector_global_best: Array = [-1.0, -1.0, -1.0]  # track record per macro sector (s)
var mini_global_best: Array = []                      # track record per mini-sector (17 floats)
# safety car
var erng: RNG                        # race-events RNG (hashed seed)
var sc_active: bool = false
var wetness: float = 0.0             # 0..1 track wetness (0 = dry)
var weather_state: String = WEATHER_DRY  # discrete state derived from wetness each tick
var race_frac: float = 0.0           # 0..1 race completion (leader) — drives track rubbering-in
var passes_on_straight: int = 0      # diagnostics: how many completed passes happened on a straight
var covers_called: int = 0           # diagnostics: undercut-cover calls made (M-S1)
var start_incidents: int = 0         # diagnostics: getaway incidents (bog/jump/stall) at the start
var wet_start: float = 1.1           # race fraction the rain starts (>1 = stays dry)
var wet_end: float = 1.2             # race fraction the rain stops
var wet_peak: float = 0.7            # peak wetness of the shower
var _wet_announced: bool = false
var had_wet: bool = false            # true once wetness > 0.30 during this race (waives two-compound rule)
var sc_done: bool = false            # this race already had its safety car
var sc_deploy_lap: int = -1          # leader lap at which the SC comes out (-1 = none)
var sc_until_lap: int = -1           # leader lap at which the SC comes back in
var sc_reason: String = ""           # why the SC came out — every SC must name a cause
var _started: bool = false           # race-start launch applied yet?
var race_seed: int = 0               # the seed this race was built from (for weekend_conditions)
var parc_ferme: bool = false         # setup locked (set at qualifying start) — set_setup refused
var conditions: Dictionary = {}      # per-weekend conditions (race_temp, wind) from the seed
var cond_setup_off: Array = []       # wind displacement of the ideal-setup optimum (6 axes)
# qualifying results (populated in _init before the race starts)
var qrng: RNG                        # qualifying RNG (seeded from mix32(mix32(seed)))
var quali_times: Dictionary = {}     # driver_id -> qualifying time (lower = faster)
var quali_grid: Array = []           # driver ids sorted pole-first (index 0 = pole)

func _init(track_in: Track, drivers_in: Array, seed_value: int = 12345) -> void:
	track = track_in
	drivers = drivers_in
	race_seed = seed_value
	rng = RNG.new(seed_value)
	# Per-weekend conditions (deterministic, own hash stream — no rng/erng/qrng use):
	# a track temperature and a wind displacement of the setup optimum. race_temp
	# overwrites the track's nominal temp so each weekend's tyre behaviour + ideal
	# setup are a fresh puzzle.
	conditions = weekend_conditions()
	cond_setup_off = conditions["wind_off"]
	track.track_temp = float(conditions["race_temp"])
	# events RNG seeded from a hashed seed so the SC roll is well-distributed.
	erng = RNG.new(mix32(seed_value))
	if erng.unit() < track.sc_prob:
		sc_deploy_lap = int(erng.rangef(SC_EARLIEST, SC_LATEST) * float(track.laps))
	# weather: roll a rain window on the events RNG (decorrelated from the pace RNG)
	if erng.unit() < track.wet_prob:
		wet_start = erng.rangef(0.10, 0.55)
		wet_end = minf(1.0, wet_start + erng.rangef(0.25, 0.55))
		wet_peak = erng.rangef(0.45, 0.95)
	# qualifying RNG: seeded from mix32(mix32(seed)) — a third independent stream.
	# Using a doubly-hashed seed keeps it well-separated from both rng (pace) and
	# erng (events). Qualifying must NOT consume rng calls so that the per-tick race
	# RNG sequence (pace/wear/pits) is identical to a sim that had no qualifying at all.
	qrng = RNG.new(mix32(mix32(seed_value)))
	for d in drivers:
		# default load = race distance + margin → finishing without managing fuel is
		# always safe; pushing burns it faster (risk), saving banks it (FUEL_*).
		d.fuel_laps = float(track.laps) + FUEL_MARGIN_LAPS
		d.ai_pit_wear = _strat_pit_wear(d)
		# M-S2: plan two stops where the wear maths demand it (abrasive track
		# identity); only a competent strategist commits to the aggressive plan.
		# The 2-stop target splits the race into ~3 stints (flat -12 was not
		# enough: stint 2 never reached the standard window before the flag).
		var wpl: float = COMPOUNDS[d.compound]["wear"] * track.abrasion * d.wear_mult
		if float(track.laps) * wpl / 62.0 > 1.6 and d.strat_skill > 0.55:
			d.pit_plan = 2
			d.ai_pit_wear = clampf(float(track.laps) * wpl / 3.0 * 1.15, 36.0, d.ai_pit_wear)
		# Car setup baseline: engineers converge a fair setup (same code for AI and
		# a player who skips practice). Needs pit_plan first (a 2-stop favours race
		# trim). A practicing human overrides this via set_setup(). Deterministic
		# (hash-based, consumes no rng), so skipping costs zero RNG divergence.
		apply_engineer_setup(d, 3)
	# Run qualifying (populates quali_times, quali_grid, grid_pos, lap_frac, tyre_temp).
	_run_qualifying()
	# Global best arrays sized to match mini_sector_bounds
	var _n_mini: int = track.mini_sector_bounds.size()
	sector_global_best = [-1.0, -1.0, -1.0]
	mini_global_best = []
	for _mi in _n_mini:
		mini_global_best.append(-1.0)
	# Per-driver sector state (after qualifying sets lap_frac)
	for _d in drivers:
		_init_sector_state(_d)

# Qualifying simulation: one flying lap per car on softs using the separate qrng
# stream. Score = clean-lap pace model (skill + car track-character + soft tyre
# offset) + consistency-scaled noise + occasional scrappy lap (composure gated).
# Lower qscore = faster = closer to pole. Populates quali_times and quali_grid
# (exposed for the UI), then sets each driver's starting lap_frac and grid_pos.
# Uses qrng exclusively — rng (per-tick race pace) is not consumed here, so the
# race RNG sequence is identical regardless of qualifying results.
func _run_qualifying() -> void:
	var qscore: Dictionary = {}
	for d in drivers:
		var qt: float = -d.skill * SKILL_K
		qt -= (d.car_power - d.car_aero) * (track.power - track.downforce) * CAR_K
		qt += (1.0 - d.setup_q_quali) * SETUP_PEN   # qualifying reads the one-lap ideal
		qt += COMPOUNDS["soft"]["pace"]
		var qnoise: float = QUALI_NOISE_BASE * (1.3 - _attr(d, "consistency") * 0.6)
		qt += qrng.rangef(-qnoise, qnoise)
		# scrappy lap: composure gates the probability of a messy flying lap
		if qrng.unit() < QUALI_SCRAPPY_P * (1.3 - _attr(d, "composure")):
			qt += qrng.rangef(QUALI_SCRAPPY_MIN, QUALI_SCRAPPY_MAX)
		qscore[d.id] = qt
	# sort ascending: lowest time = pole
	var grid := drivers.duplicate()
	grid.sort_custom(func(a, b): return float(qscore[a.id]) < float(qscore[b.id]))
	# store results for the UI / HUD to read
	quali_times = qscore
	quali_grid = []
	var gn: int = grid.size()
	for gp in gn:
		var gd: Driver = grid[gp]
		quali_grid.append(gd.id)
		gd.lap_frac = float(gn - 1 - gp) * GRID_GAP
		gd.grid_pos = gp + 1
		gd.tyre_temp = TYRE_TEMP_GRID     # warmed on the formation lap

# Initialise sector tracking for one driver. Called in _init() and on reset.
func _init_sector_state(d: Driver) -> void:
	# Determine starting sector from lap_frac (qualifying grid spacing)
	d.cur_sector = 0
	if track.sector_bounds.size() >= 2:
		for si in 2:
			if d.lap_frac >= float(track.sector_bounds[si]):
				d.cur_sector = si + 1
	d.sector_entry_time = elapsed   # 0.0 at sim start
	d.soc_at_sector[0] = d.soc
	# Mini-sector state
	var n_mini: int = track.mini_sector_bounds.size()
	d.mini_times_this_lap = []
	d.mini_best = []
	d.mini_prev = []
	for _i in n_mini:
		d.mini_times_this_lap.append(-1.0)
		d.mini_best.append(-1.0)
		d.mini_prev.append(-1.0)
	d.cur_mini = 0
	for mi in n_mini:
		if d.lap_frac >= float(track.mini_sector_bounds[mi]):
			d.cur_mini = mi + 1
		else:
			break
	d.mini_entry_time = elapsed

# Turn-1 incident probability for this track (more likely where passing is hard).
func _t1_incident_prob() -> float:
	return clampf(T1_INCIDENT_BASE + (0.6 - track.overtaking) * T1_INCIDENT_TRACK_K, 0.04, 0.30)

# Detect macro-sector and mini-sector boundary crossings for one driver.
# Called in step() phase 1 after lap_frac advances; prev_frac is the value before.
# Pitting / finished drivers are skipped (lap_frac frozen).
func _check_sector_crossing(d: Driver, prev_frac: float) -> void:
	if d.finished or d.pit_timer > 0.0:
		return
	var new_frac: float = d.lap_frac
	# --- Macro sectors (two internal boundaries: S1→S2 and S2→S3) ---
	if track.sector_bounds.size() >= 2:
		for si in 2:
			var bound: float = float(track.sector_bounds[si])
			if d.cur_sector == si and prev_frac < bound and new_frac >= bound:
				# Record time for sector si (just completed)
				if d.sector_entry_time >= 0.0:
					var t: float = elapsed - d.sector_entry_time
					d.sector_times[si] = t
					if float(d.sector_best[si]) < 0.0 or t < float(d.sector_best[si]):
						d.sector_best[si] = t
					if float(sector_global_best[si]) < 0.0 or t < float(sector_global_best[si]):
						sector_global_best[si] = t
				# Enter next sector
				d.cur_sector = si + 1
				d.sector_entry_time = elapsed
				d.soc_at_sector[si + 1] = d.soc_avg
				if d.team:
					_sector_ers_hint(d)
	# --- Mini-sectors ---
	var n_mini: int = track.mini_sector_bounds.size()
	if n_mini == 0 or d.mini_times_this_lap.is_empty():
		return
	while d.cur_mini < n_mini:
		var mb: float = float(track.mini_sector_bounds[d.cur_mini])
		if new_frac < mb:
			break
		if prev_frac < mb:   # crossed this boundary this tick
			if d.mini_entry_time >= 0.0:
				var mt: float = elapsed - d.mini_entry_time
				d.mini_times_this_lap[d.cur_mini] = mt
				if float(d.mini_best[d.cur_mini]) < 0.0 or mt < float(d.mini_best[d.cur_mini]):
					d.mini_best[d.cur_mini] = mt
				if float(mini_global_best[d.cur_mini]) < 0.0 or mt < float(mini_global_best[d.cur_mini]):
					mini_global_best[d.cur_mini] = mt
			d.mini_entry_time = elapsed
		d.cur_mini += 1

# Radio hint when entering a new sector: tells the engineer about battery vs DRS.
# Only fires for team cars, respects radio_cd.
func _sector_ers_hint(d: Driver) -> void:
	if d.radio_cd > 0 or track.sector_chars.is_empty():
		return
	var sc: Dictionary = track.sector_chars[d.cur_sector]
	var is_drs: bool = bool(sc.get("drs", false))
	var next_si: int = (d.cur_sector + 1) % 3
	var next_sc: Dictionary = track.sector_chars[next_si] if not track.sector_chars.is_empty() else {}
	var msg := ""
	if is_drs:
		if d.soc_avg < 38.0:
			msg = "S%d: DRS-зона, батарея %d%% — будет трудно!" % [d.cur_sector + 1, int(d.soc_avg)]
		elif d.soc_avg > 68.0:
			msg = "S%d: DRS, %d%% — атакуй!" % [d.cur_sector + 1, int(d.soc_avg)]
	elif bool(next_sc.get("drs", false)) and d.soc_avg < 48.0:
		msg = "S%d: харвест — следующий сектор DRS" % [d.cur_sector + 1]
	if msg != "":
		_emit("Инженер → %s: «%s»" % [d.name, msg], "radio")
		d.radio_cd = 3

# How far through the current macro sector the driver is (0.0 = just entered, 1.0 = at end).
func _sector_frac(d: Driver) -> float:
	if track.sector_bounds.size() < 2:
		return d.lap_frac
	var s_start: float = 0.0 if d.cur_sector == 0 else float(track.sector_bounds[d.cur_sector - 1])
	var s_end: float = float(track.sector_bounds[d.cur_sector]) if d.cur_sector < 2 else 1.0
	return clampf((d.lap_frac - s_start) / maxf(0.001, s_end - s_start), 0.0, 1.0)

# Race start: a one-off launch off the grid. A good starter (attr "starts") gains
# a place or two; a bog loses them — the opening-lap shuffle, applied on tick one.
# Uses rng (main race RNG) to contribute to the deterministic race sequence.
# Hard cap of START_MAX_SHIFT grid slots prevents teleporting past the whole field.
func _race_start() -> void:
	var max_shift: float = float(START_MAX_SHIFT) * GRID_GAP
	for d in drivers:
		if d.finished:
			continue
		var launch: float = (_attr(d, "starts") - 0.5) * START_GAIN_K * 2.0 \
			+ rng.rangef(-START_NOISE_AMP, START_NOISE_AMP)
		launch = clampf(launch, -max_shift, max_shift)
		d.lap_frac = maxf(0.0, d.lap_frac + launch)
		# Getaway outcome — one erng roll per car, by attributes (no reaction input).
		var st: float = _attr(d, "starts")
		var comp: float = _attr(d, "composure")
		var p_stall: float = STALL_BASE * pow(1.0 - st, 2.0)
		var p_jump: float = JUMP_BASE * (1.0 - _attr(d, "discipline")) * (1.0 - comp)
		var p_bog: float = BOG_BASE * (1.0 - st) * (1.3 - comp)
		var g: float = erng.unit()
		if g < p_stall:
			d.pit_timer = maxf(d.pit_timer, erng.rangef(STALL_LOSS_MIN, STALL_LOSS_MAX))
			d.had_incident = true
			start_incidents += 1
			_emit("%s: заглох на старте!" % d.name, "incident")
		elif g < p_stall + p_jump:
			d.lap_frac = maxf(0.0, d.lap_frac + JUMP_GAIN)   # anticipated → small jump
			d.time_penalty += JUMP_PENALTY                   # but a 5 s penalty
			start_incidents += 1
			_emit("%s: фальстарт — штраф 5 секунд." % d.name, "penalty")
		elif g < p_stall + p_jump + p_bog:
			d.pit_timer = maxf(d.pit_timer, erng.rangef(BOG_LOSS_MIN, BOG_LOSS_MAX))
			start_incidents += 1
			_emit("%s: пробуксовка на старте — потеря позиций." % d.name, "incident")
	# First-lap incident: a seeded shuffle at Turn 1.
	if erng.unit() < _t1_incident_prob():
		var pool: Array = []
		for d in drivers:
			if not d.finished:
				pool.append(d)
		if not pool.is_empty():
			var n: int = 1 + (1 if erng.unit() < T1_INCIDENT_DOUBLE else 0)
			for _k in mini(n, pool.size()):
				var idx: int = mini(pool.size() - 1, int(erng.unit() * pool.size()))
				var victim: Driver = pool[idx]
				pool.remove_at(idx)
				var loss: float = erng.rangef(T1_LOSS_MIN, T1_LOSS_MAX)
				victim.pit_timer = maxf(victim.pit_timer, loss)   # frozen → drops back; lap untouched
				victim.had_incident = true
				_emit("%s: инцидент на старте — потеря времени." % victim.name, "incident")
			# an opening-lap incident can bring out the safety car
			if sc_deploy_lap < 0 and erng.unit() < T1_SC_UPLIFT:
				sc_deploy_lap = 1
				sc_reason = "столкновение на старте"

# Dirty-air pace loss: a car stuck within ~DA_THRESH behind another loses time in
# the corners (worse on high-downforce / low-overtaking tracks) unless its Overtake
# boost is firing. Models the 2026 following deficit the hold-up model only implied.
func _m_following(d: Driver, ahead_gap: float) -> float:
	d.da_pen = 0.0
	if ahead_gap < 0.0:
		return 0.0
	var net := 0.0
	# Dirty air: corner-downforce loss in the close zone (high-downforce / low-
	# overtaking tracks), unless the Overtake boost is firing.
	if ahead_gap < DA_THRESH and not _ot_effective(d, ahead_gap):
		d.da_pen = (DA_THRESH - ahead_gap) * DA_COEF \
			* maxf(0.0, 0.5 + track.downforce * 1.4 - track.overtaking)
		net += d.da_pen
	# Slipstream tow: a straight-line GAIN in a wider zone on high-power / high-
	# overtaking tracks (Monza/Baku). The chaser closes up and gets a run — this is
	# what actually creates wheel-to-wheel racing there, instead of the field
	# dispersing into clean air. Near-zero on downforce/street circuits (Monaco).
	if ahead_gap < SLIP_THRESH:
		net -= (SLIP_THRESH - ahead_gap) / SLIP_THRESH * SLIP_COEF \
			* maxf(0.0, track.power + track.overtaking - 0.72)
	return net

# Tyre thermal window: cold tyres (fresh out of the pits) lack grip → an out-lap
# deficit the undercut must overcome; overheated tyres mostly cost wear (see step).
func _m_thermal(d: Driver) -> float:
	var c: Dictionary = COMPOUNDS[d.compound]
	var lo: float = c["tlo"]
	var hi: float = c["thi"]
	var pen := 0.0
	if d.tyre_temp < lo:                       # below the compound's window → cold grip loss
		pen += (lo - d.tyre_temp) * COLD_PACE
	elif d.tyre_temp > hi:                      # above it → overheating grip loss
		pen += (d.tyre_temp - hi) * 0.5
	pen += d.graining * GRAIN_PACE              # #5 graining costs grip until it cleans up
	return pen

# Map continuous wetness to a named weather state.
func _current_weather_state() -> String:
	if wetness < 0.15:
		return WEATHER_DRY
	elif wetness < 0.40:
		return WEATHER_VARIABLE
	elif wetness < 0.75:
		return WEATHER_RAIN
	else:
		return WEATHER_STORM

# Compound category index for the WEATHER_COMPOUND_PENALTY table.
func _compound_category(compound: String) -> int:
	if compound == "inter":
		return 1
	elif compound == "wet":
		return 2
	return 0  # slick (soft / medium / hard)

# Wet running: a slick in the rain is hopeless; intermediates/wets suit a wetter
# track. Penalty grows with the mismatch between wetness and the tyre's wet_opt,
# plus a base wet slowdown a wet-skilled driver (attr "wet") softens.
func _m_weather(d: Driver) -> float:
	if wetness <= 0.01:
		return 0.0
	var wopt: float = float(COMPOUNDS[d.compound].get("wet_opt", 0.0))
	var mis := wetness - wopt
	return WET_K * mis * mis + wetness * WET_BASE * (1.3 - _attr(d, "wet"))

# Clean lap time (the pace a car would run in free air). Combat placement (who
# passes whom) stays in _resolve_combat(); dirty air and tyre temperature enter the
# pace here as modular terms (_m_following / _m_thermal).
func current_laptime(d: Driver, ahead_gap: float = -1.0) -> float:
	var lt := track.base_laptime
	if sc_active:
		# Behind the safety car: the train circulates at SC pace; a car far
		# behind the one ahead runs a catch-up delta until it joins the queue.
		if ahead_gap >= 0.0 and ahead_gap > SC_CATCH_GAP:
			return lt * SC_CATCH_MULT
		return lt * SC_PACE_MULT
	lt -= d.skill * SKILL_K
	# mood: a driver "in the zone" finds a few tenths; a rattled one loses them.
	# Only the player's team cars carry mood (AI mood stays 0 → no effect).
	lt -= d.mood * MOOD_PACE * track.base_laptime
	# track evolution: the surface rubbers-in over the race (street tracks most),
	# so the whole field is slower on a green track and quicker late on. Rain
	# washes the rubber off, undoing the gain.
	lt -= EVO_MAX * track.evolution * race_frac * (1.0 - wetness)
	# car character: a power-biased car gains on power circuits and loses on
	# downforce ones (and vice-versa) — net zero on an average track.
	lt -= (d.car_power - d.car_aero) * (track.power - track.downforce) * CAR_K
	lt += (1.0 - d.setup_q_race) * SETUP_PEN     # race reads the stint ideal
	lt += d.blister * BLISTER_PACE               # thermal blistering (aggressive setup, hot track)
	d.follow_pen = _m_following(d, ahead_gap)
	lt += d.follow_pen
	lt += d.aero_damage * DMG_K        # floor/wing damage until repaired in the pits
	lt += COMPOUNDS[d.compound]["pace"]
	lt += PACE_MODES[d.pace_mode]["pace"]
	if d.save:
		lt += SAVE_PACE                # lift-and-coast: slower, but banks energy + fuel
	if d.fuel_laps < FUEL_CRITICAL and not d.finished:
		lt += FUEL_STARVE_PEN          # running on fumes (v1: pace-only, no DNF)
	# 2026 energy: a spent battery loses the electric boost (worse on power tracks).
	if d.clipped:
		lt += CLIP_PENALTY * (0.6 + 0.8 * track.power)
	else:
		var ers_pace: float = float(ERS_MODES[d.ers_mode]["pace"])
		if d.ers_mode == "attack":
			# taper: attack is worth less on high-power/low-downforce tracks (energy
			# "wasted" above the ~290 km/h high-speed taper threshold).
			ers_pace *= (1.0 - TAPER_K * track.power)
			# v0.6 SoC gate: attack pace scales with the live store (a flat battery
			# genuinely can't deploy). Full benefit at/above SOC_ATTACK_GATE, → 0 empty.
			ers_pace *= clampf(d.soc_avg / SOC_ATTACK_GATE, 0.0, 1.0)
		lt += ers_pace
	# Active-aero Straight Mode zones: low-drag designated zones give a small
	# per-lap pace gain that scales with the car's power bias — power-biased cars
	# carry more speed on those straights and benefit more.
	lt -= AERO_ZONE_K * float(track.aero_zones) * (0.5 + 0.5 * d.car_power)
	if d.yield_laps > 0:
		lt += 0.8                # team order: ease off so the teammate can pass
	var c: Dictionary = COMPOUNDS[d.compound]
	var wear := d.tire_wear
	lt += wear * 0.012
	if wear > c["cliff"]:
		lt += (wear - c["cliff"]) * 0.10
	lt += _m_thermal(d)
	lt += _m_weather(d)
	# Compound mismatch penalty for the current discrete weather state.
	var weather_states_ordered: Array = [WEATHER_DRY, WEATHER_VARIABLE, WEATHER_RAIN, WEATHER_STORM]
	var state_idx: int = weather_states_ordered.find(weather_state)
	if state_idx < 0:
		state_idx = 0
	var comp_cat: int = _compound_category(d.compound)
	lt += float(WEATHER_COMPOUND_PENALTY[comp_cat][state_idx])
	lt += d.fuel_laps * 0.018
	var amp := 0.025 * (1.25 - _attr(d, "consistency") * 0.6)   # consistent = tighter
	# Gaussian-ish lap noise (sum of 3 uniforms ≈ normal, SAME std as the old uniform
	# via u = amp/√3): most laps cluster near the mean, with rarer bigger deviations in
	# the tails — feels consistent-with-occasional-moments instead of twitchy-uniform.
	var u := amp * 0.57735
	lt += rng.rangef(-u, u) + rng.rangef(-u, u) + rng.rangef(-u, u)
	return lt

# True when a driver's armed Overtake boost is actually firing.
func _ot_effective(d: Driver, ahead_gap: float) -> bool:
	# DRS / Overtake only fires in designated sectors (track.sector_chars[si].drs == true).
	# If sector data is absent (generated tracks without chars), allow everywhere.
	if not track.sector_chars.is_empty():
		var sc: Dictionary = track.sector_chars[d.cur_sector]
		if not bool(sc.get("drs", false)):
			return false
	return d.overtake and not d.clipped and d.soc > OT_MIN_SOC \
		and ahead_gap >= 0.0 and ahead_gap < OT_GAP_S

# Battery update for one tick (store dynamics v0.6 — ONE cycling store). The 4 MJ
# store cycles WITHIN a lap: deploy drains it on the straights (rationed by a
# SQUARED track.energy_limit — low-el power tracks like Монца cut deploy hard) and
# braking regen refills it in the corners (scaled by the track's harvest character,
# floored so power tracks aren't double-starved, and corner intensity). Rates are
# %/s (× dt). Clipping is a pure raw-SoC event now (no separate budget counter).
# AI and radio read the smoothed soc_avg so intra-lap pulses don't flap them.
func _update_soc(d: Driver, dt: float, lt: float, ahead_gap: float) -> void:
	var seg: Dictionary = track.seg_at(d.lap_frac)
	var on_straight: bool = seg.is_empty() or String(seg.get("kind", "")) == "straight"
	var rate := 0.0                       # %/s of the store
	if on_straight:
		if d.clipped:
			rate = CLIP_TRICKLE_PS        # limp down the straight, recover at braking
		else:
			# v0.6: squared energy_limit scaling rations deploy HARD on low-el power
			# tracks (Монца el=0.55 → el_scale 0.44, a 55% cut vs the old 27%), so the
			# store no longer bottoms out in balanced. High-el tracks ~unaffected.
			var el_scale: float = SOC_EL_SCALE0 + (1.0 - SOC_EL_SCALE0) * pow(track.energy_limit, SOC_EL_EXP)
			rate = -float(SOC_DEPLOY_PS[d.ers_mode]) * el_scale
			if d.save:
				rate += SAVE_SOC_REGEN    # lift before the braking zone → bank charge
			if _ot_effective(d, ahead_gap):
				rate -= OT_DRAIN_PS
	else:
		var inten: float = float(seg.get("intensity", 0.7))
		# v0.6: floor the harvest-character factor so power/street tracks that already
		# ration deploy via el aren't ALSO starved of regen (the diagnosed double penalty).
		var hfac: float = maxf(SOC_HARVEST_FLOOR, 0.5 + track.harvest)
		rate = SOC_REGEN_PS * hfac * d.harvest_mult * (0.5 + inten)
		if d.ers_mode == "harvest":
			rate *= SOC_HARVEST_REGEN     # lift & coast: bank the braking energy
		# dirty air hurts cooling → worse energy recovery while stuck behind a car
		if ahead_gap >= 0.0 and ahead_gap < DA_THRESH:
			rate *= 0.9
	d.soc = clampf(d.soc + rate * dt, 0.0, d.soc_max)
	d.soc_avg += (d.soc - d.soc_avg) * minf(1.0, dt / SOC_AVG_TAU)
	if d.soc <= 0.0:
		if not d.clipped and d.is_player:
			_emit("%s: батарея разряжена — клиппинг! Нужен харвест." % d.name, "clip")
		d.clipped = true
	elif d.soc >= SOC_RECOVER:
		d.clipped = false

# Tyre temperature eases toward a target set by track temp, pace mode (push heats,
# conserve cools), dirty air (following heats) and compound. Cold tyres lack grip
# (_m_thermal); hot tyres wear faster (overheat multiplier in step). No RNG.
func _update_tyre_temp(d: Driver, dt: float, lt: float, ahead_gap: float) -> void:
	var trackf := clampf(0.55 + (track.track_temp - 30.0) / 60.0, 0.2, 0.95)
	var paceh := 0.0
	if d.pace_mode == "push":
		paceh = 0.18
	elif d.pace_mode == "conserve":
		paceh = -0.12
	if d.ers_mode == "attack":
		paceh += 0.05
	var comp := 0.0
	if d.compound == "soft":
		comp = 0.08            # softs run hotter for the same conditions
	elif d.compound == "hard":
		comp = -0.05           # hards run cooler (need a hot track to switch on)
	var daheat := 0.10 if (ahead_gap >= 0.0 and ahead_gap < DA_THRESH) else 0.0
	# a setup far from the race ideal (e.g. a quali-trim setup) runs the tyre hotter
	var setuph := (1.0 - d.setup_q_race) * SETUP_TEMP_K
	var target := clampf(trackf + paceh + comp + daheat + setuph, 0.0, 1.2)
	# warm-up RATE is per compound (#4): softs heat fast, hards slowly.
	var warm: float = COMPOUNDS[d.compound]["warm"]
	d.tyre_temp += (target - d.tyre_temp) * TYRE_EASE * warm * (dt / lt)
	_update_graining(d, dt, lt)

# #5 graining: builds when the tyre runs BELOW its window under load (cold sliding),
# and DECAYS once temp comes back into the window — a recoverable grip loss, distinct
# from permanent wear. Tyre-smart drivers grain less. Deterministic.
func _update_graining(d: Driver, dt: float, lt: float) -> void:
	var lo: float = COMPOUNDS[d.compound]["tlo"]
	if d.tyre_temp < lo:
		var load: float = PACE_MODES[d.pace_mode]["wear"]      # pushing slides more → grains more
		var build: float = GRAIN_BUILD * (lo - d.tyre_temp) * load * (1.3 - _attr(d, "tyre") * 0.6)
		d.graining = minf(1.0, d.graining + build * (dt / lt))
	else:
		d.graining = maxf(0.0, d.graining - GRAIN_DECAY * (dt / lt))

# Blistering: the mirror of graining above the window. Builds when the tyre runs
# ABOVE its high window under load (an over-aggressive / quali-trim setup on a hot
# track) and — unlike graining — NEVER decays in-stint: only a pit clears it. This
# is the lasting cost a player who chased one-lap pace pays over the race.
func _update_blister(d: Driver, dt: float, lt: float) -> void:
	var thi: float = COMPOUNDS[d.compound]["thi"]
	if d.tyre_temp > thi:
		var load: float = PACE_MODES[d.pace_mode]["wear"]
		var build: float = BLISTER_BUILD * (d.tyre_temp - thi) * load * (1.3 - _attr(d, "tyre") * 0.6)
		d.blister = minf(1.0, d.blister + build * (dt / lt))

# Deterministic AI driver brain: chooses pace mode + energy strategy from the
# car's attributes and the race situation (the player keeps direct control).
# Aggressive drivers push & attack more; tyre-aware drivers back off near the cliff.
func _ai_energy(d: Driver, ahead_gap: float, behind_gap: float) -> void:
	if d.is_player:
		_player_brain(d, ahead_gap, behind_gap)
		return
	d.pace_mode = _situational_pace(d, ahead_gap)
	_situational_energy(d, ahead_gap, behind_gap)
	# Fuel save (lift-and-coast): an AI lifts only when it lacks a comfortable
	# margin to the flag; a smart driver (race_iq) saves a touch earlier. With the
	# default load this almost never fires — it bites a car that over-pushed.
	var fuel_left := track.laps - d.lap
	d.save = fuel_left > 1 and d.fuel_laps - float(fuel_left) < (0.3 + _attr(d, "race_iq") * 0.5)
	if d.save and d.pace_mode == "push":
		d.pace_mode = "balanced"
	# M-S3: the race leader manages the gap, not flat-out — with a 4s+ cushion
	# and healthy tyres he cruises (saves tyres, banks battery); racing resumes
	# when the cushion shrinks. Never in the final laps.
	if ahead_gap < 0.0 and behind_gap > 4.0 and track.laps - d.lap > 5 \
			and d.tire_wear < float(COMPOUNDS[d.compound]["cliff"]) - 12.0:
		if d.pace_mode == "balanced":
			d.pace_mode = "conserve"
		if d.ers_mode == "balanced" and d.soc_avg < 70.0:
			d.ers_mode = "harvest"

# Natural pace choice from tyres + chasing + aggression.
func _situational_pace(d: Driver, ahead_gap: float) -> String:
	var c: Dictionary = COMPOUNDS[d.compound]
	if d.tire_wear > c["cliff"] - 6.0 or (d.tire_wear > 55.0 and _attr(d, "tyre") < 0.55):
		return "conserve"
	# M-A2: attack abandoned — drop out of the dirty air, bank tyre life for the stops.
	if d.attack_backed:
		return "conserve" if d.tire_wear > 30.0 else "balanced"
	if ahead_gap >= 0.0 and ahead_gap < 1.6 and _attr(d, "aggression") > 0.62:
		return "push"
	return "balanced"

# True where arming Overtake/attack pays off: in a DRS sector or on the run-up
# to one (the boost itself is sector-gated in _ot_effective; arming elsewhere
# just burns SoC for nothing).
func _drs_armable(d: Driver) -> bool:
	if track.sector_chars.is_empty():
		return true
	if bool(track.sector_chars[d.cur_sector].get("drs", false)):
		return true
	var nsi: int = (d.cur_sector + 1) % 3
	return bool(track.sector_chars[nsi].get("drs", false)) and _sector_frac(d) > 0.8

# Laps a driver will sit in attack range before giving up a stalled attack.
# Patient racers (race_iq + composure) wait long; overcommitters (aggression
# over discipline — and most rookies) keep lunging every lap.
func _patience_laps(d: Driver) -> int:
	var p := 2.0 + _attr(d, "race_iq") * 2.0 + _attr(d, "composure") * 2.0 \
		- clampf(_attr(d, "aggression") - _attr(d, "discipline"), 0.0, 1.0) * 2.0
	return maxi(1, int(p))

# Natural energy / overtake choice from the race situation.
func _situational_energy(d: Driver, ahead_gap: float, behind_gap: float) -> void:
	# Per-driver HYSTERESIS. The engage (ON) threshold sits well above the
	# release (OFF) threshold, so SoC drifting near the line can't flip
	# attack<->balanced every tick (the old single-40% gate caused cars to park
	# at ~39% and toggle boost mode constantly). Aggressive drivers attack on a
	# thinner reserve and hold the boost longer; cautious drivers bank more.
	var aggr := _attr(d, "aggression")
	# atk_latch keeps the fight "live" across non-DRS (banking) sectors, where
	# M-A1 parks ers_mode at balanced — without it the engage threshold would
	# reset every sector and the attack could never re-arm on drained tracks.
	var attacking := d.ers_mode == "attack" or d.atk_latch
	var atk_on := 56.0 - aggr * 10.0          # engage attack: ~46..56
	var atk_off := 34.0 - aggr * 8.0          # release attack: ~26..34
	var floor_soc := atk_off if attacking else atk_on
	var hard_floor := 24.0
	# M-A3: final laps — banked energy is worthless at the flag. The reserve
	# floor melts away: 3 laps left -> 50%, 2 -> 25%, last lap -> all-in (12%).
	var laps_left := track.laps - d.lap
	if laps_left <= 3:
		var dump_k := maxf(0.0, float(laps_left) - 1.0) / 4.0
		floor_soc = 12.0 + (floor_soc - 12.0) * dump_k
		hard_floor = 14.0
	# Committed fighters (camped 1+ laps) work with a lower SoC bar and a
	# slightly wider window: the engage thresholds were tuned for cruising,
	# but a driver already in the fight commits deliberately (2026: harvest
	# in the tow, then deploy in the zone).
	var committed := d.attack_laps >= 1
	if committed:
		floor_soc = minf(floor_soc, atk_off + 10.0)
	var window := OT_GAP_S * (1.3 if committed else 1.0)
	var in_fight := ahead_gap >= 0.0 and ahead_gap < window \
		and aggr > 0.45 and not d.attack_backed
	if d.soc_avg < hard_floor:
		d.ers_mode = "harvest"
		d.overtake = false
		d.atk_latch = false
	elif in_fight:
		# M-A1: arm the attack only where the boost can fire (DRS sectors +
		# the run-up to one) and with the battery ready.
		if _drs_armable(d) and d.soc_avg > floor_soc:
			d.ers_mode = "attack"
			d.overtake = true
			d.atk_latch = true
		else:
			# Not attacking right now (banking sector or battery not ready):
			# actively charge for the zone; the latch keeps the fight live —
			# unless the spell's charge is spent (below atk_off): then the
			# next engage must climb the full bar again (no flapping).
			if d.soc_avg <= atk_off:
				d.atk_latch = false
			d.ers_mode = "harvest" if d.soc_avg < atk_on else "balanced"
			d.overtake = false
	elif behind_gap >= 0.0 and behind_gap < OT_GAP_S and d.soc_avg > floor_soc + 12.0:
		# M-D1: defensive spend is sector-targeted — burn battery only where
		# the attacker's boost strikes (battery poker, not a free stat).
		d.ers_mode = "attack" if _drs_armable(d) else "balanced"
		d.overtake = false
		d.atk_latch = false
	else:
		d.ers_mode = "balanced"
		d.overtake = false
		d.atk_latch = false
	# Sector lookahead: approaching end of sector, next sector is DRS, SoC low → harvest now.
	if not track.sector_chars.is_empty() and not d.clipped:
		var next_si: int = (d.cur_sector + 1) % 3
		var next_sc: Dictionary = track.sector_chars[next_si]
		var sfrac: float = _sector_frac(d)
		if bool(next_sc.get("drs", false)) and sfrac > 0.75 and d.soc_avg < 45.0 \
				and d.ers_mode != "harvest":
			d.ers_mode = "harvest"
			d.overtake = false

# The player's driver executes the engineer's directive — unless this lap it
# defies the order (d.obey, rolled in _on_lap_complete) and drives to character.
func _player_brain(d: Driver, ahead_gap: float, behind_gap: float) -> void:
	var in_range := ahead_gap >= 0.0 and ahead_gap < OT_GAP_S and d.soc_avg > 35.0
	var in_drs := in_range and _drs_armable(d)
	if d.obey:
		d.pace_mode = d.dir_pace
		if d.dir_intent == "attack":
			# The order means "fight now" — the driver executes it with the
			# same sector smarts as the AI brain (an order must not be a
			# trap): burn attack only where the boost fires, bank elsewhere.
			if in_drs:
				d.ers_mode = "attack"
				d.overtake = true
			elif in_range:
				d.ers_mode = "harvest" if d.soc_avg < 50.0 else "balanced"
				d.overtake = false
			else:
				d.ers_mode = "balanced"
				d.overtake = false
		elif d.dir_intent == "hold":
			# Defensive spend only where the attacker's boost strikes (M-D1).
			var threat := behind_gap >= 0.0 and behind_gap < OT_GAP_S and d.soc_avg > 50.0
			d.ers_mode = "attack" if (threat and _drs_armable(d)) else "balanced"
			d.overtake = false
		else:
			_situational_energy(d, ahead_gap, behind_gap)
	elif _attr(d, "aggression") > 0.6:        # defiant & aggressive: send it
		d.pace_mode = "push"
		d.ers_mode = "attack" if in_drs else "balanced"
		d.overtake = in_drs
	else:                                     # defiant & cautious: back off
		d.pace_mode = "conserve"
		d.ers_mode = "harvest"
		d.overtake = false
	if d.soc_avg < 22.0:
		d.ers_mode = "harvest"

# Once a lap, decide whether the player's driver obeys the directive. Costly
# orders (conserve/hold to an aggressive driver) get defied more often; higher
# discipline + trust = more obedient.
func _roll_obey(d: Driver) -> bool:
	if d.dir_intent == "free" and d.dir_pace == "balanced":
		return true
	var cost := 0.0
	if d.dir_pace == "conserve" or d.dir_intent == "hold":
		cost = _attr(d, "aggression") * 0.5
	var p := clampf(0.45 + _attr(d, "discipline") * 0.4 + d.trust / 100.0 * 0.3 - cost, 0.2, 0.97)
	if rng.unit() < p:
		return true
	_emit("%s игнорирует команду — едет по-своему!" % d.name, "team")
	return false

# Current 1-based race position of a driver (finished cars rank ahead).
func _position_of(d: Driver) -> int:
	var pos := 1
	for o in drivers:
		if o == d:
			continue
		if o.finished and not d.finished:
			pos += 1
		elif o.finished == d.finished and o.progress() > d.progress():
			pos += 1
	return pos

# The running car directly ahead of d on the road (nearest higher progress).
func _car_ahead(d: Driver) -> Driver:
	var best: Driver = null
	var best_p := 1.0e18
	for o in drivers:
		if o == d or o.finished:
			continue
		var p: float = o.progress()
		if p > d.progress() and p < best_p:
			best = o
			best_p = p
	return best

# Trust drifts from how the last lap went vs the engineer's directive — the core
# of the engineer↔driver relationship. FIXED deltas (no rng) so the sim's RNG
# stream — and thus the rest of the field — is unchanged; only the player car's
# own compliance threshold moves.
func _update_trust(d: Driver, gained: int) -> void:
	if d.trust_last_pos == 0:
		return                                       # first lap: no reference yet
	var trivial := d.dir_intent == "free" and d.dir_pace == "balanced"
	if d.had_incident and d.dir_pace == "push":
		d.trust = maxf(0.0, d.trust - 5.0)          # pushed a struggling driver into a mistake
	elif not d.obey:
		if gained >= 0:
			d.trust = maxf(0.0, d.trust - 5.0)      # defied the order and was right → credibility hit
		else:
			d.trust = minf(100.0, d.trust + 1.5)    # defied and lost → learns to listen
	elif not trivial:
		if gained > 0:
			d.trust = minf(100.0, d.trust + 4.0)    # obeyed and it paid off
		else:
			d.trust = minf(100.0, d.trust + 1.0)    # obeyed — small credit for cooperation

# Mood ("in the zone" ↔ rattled) drifts from the lap: positions gained lift it,
# mistakes and dirty air sap it, and it recenters toward calm (composed drivers
# faster). Deterministic. Feeds pace, mistake risk and call willingness.
func _update_mood(d: Driver, gained: int) -> void:
	var comp := _attr(d, "composure")
	var step := 0.08 + (1.0 - comp) * 0.12          # low composure → bigger swings
	var delta := 0.0
	if d.had_incident:
		delta -= 0.25 + (1.0 - comp) * 0.15         # a mistake rattles the driver
	if gained > 0:
		delta += step
	elif gained < 0:
		delta -= step
	var ah := _car_ahead(d)
	if ah != null and (ah.progress() - d.progress()) * track.base_laptime < DA_THRESH:
		delta -= 0.05                               # stuck in dirty air saps confidence
	d.mood += delta
	d.mood -= d.mood * (0.10 + comp * 0.15)         # recenter toward calm
	d.mood = clampf(d.mood, -1.0, 1.0)

# The driver reports state over the radio — the information half of the loop.
# Cooldown-gated so it's a paced conversation, not spam. Team cars only (the
# engineer hears their own driver). Pure flavour now; a hook for future requests.
func _driver_radio(d: Driver) -> void:
	if not d.team or d.finished or d.dnf:
		return
	if d.radio_cd > 0:
		d.radio_cd -= 1
		return
	var on_slick: bool = d.compound in ["soft", "medium", "hard"]
	var msg := ""
	if on_slick and wetness > 0.40:
		msg = "трасса плывёт — нужна дождевая резина!"
	elif not on_slick and wetness < 0.12:
		msg = "трасса сохнет, я на дождевой — теряю кучу времени!"
	elif d.tire_wear > 86.0:
		msg = "резина на исходе, ещё пара кругов и всё!"
	elif d.clipped and track.power > 0.7:
		msg = "батарея садится на прямой — дайте харвест"
	elif d.tyre_temp < COLD_TEMP and d.tyre_laps <= 2:
		msg = "шины холодные, нет зацепа на торможении"
	elif d.tire_wear > 66.0:
		msg = "передние подъедены, начинаю блокировать в шпильках"
	else:
		var ahead := _car_ahead(d)
		if ahead != null:
			var gap := (ahead.progress() - d.progress()) * track.base_laptime
			if gap > 0.0 and gap < 2.0 and _attr(d, "aggression") > 0.42:
				msg = "я быстрее %s — дайте боевой режим!" % ahead.name
	if msg != "":
		_emit("%s по радио: «%s»" % [d.name, msg], "radio")
		d.radio_cd = 4 + (d.id % 3)

# ============================================================================
#  RADIO CALLS — the engineer's controls become discrete instructions the driver
#  interprets (accepts / pushes back / refuses) by trust + his read of the car.
#  Replaces the old persistent pace/intent toggles. Deterministic (no rng).
# ============================================================================
const CALL_COOLDOWN := 6.0          # sim-seconds between calls to the same car
const CALLS := {
	"calm":   {"pace": "balanced", "intent": "free",   "say": "Спокойно, держим темп"},
	"attack": {"pace": "push",     "intent": "attack", "say": "Атакуй, в бой!"},
	"save":   {"pace": "conserve", "intent": "free",   "say": "Береги резину"},
	"defend": {"pace": "balanced", "intent": "hold",   "say": "Держи позицию, защищайся"},
}

# nearest car behind d within `secs` seconds?
func _someone_behind(d: Driver, secs: float) -> bool:
	for o in drivers:
		if o == d or o.finished:
			continue
		var g: float = (d.progress() - o.progress()) * track.base_laptime
		if g > 0.0 and g < secs:
			return true
	return false

# is d wheel-to-wheel (a car within 1.5s ahead or behind)?
func _in_fight(d: Driver) -> bool:
	var ah := _car_ahead(d)
	if ah != null and (ah.progress() - d.progress()) * track.base_laptime < 1.5:
		return true
	return _someone_behind(d, 1.5)

# How the driver reacts to a call: accept / pushback (complies, complains) /
# refuse (ignores). Disagreement comes from his car state; low trust turns
# disagreement into outright refusal.
func _eval_call(d: Driver, call: String) -> String:
	var disagree := false
	match call:
		"attack":
			disagree = d.tire_wear > 85.0 or d.soc_avg < 18.0
		"save":
			disagree = _in_fight(d) and _attr(d, "aggression") > 0.5
		"defend":
			disagree = not _someone_behind(d, 3.0)
		_:
			disagree = false
	if not disagree:
		return "accept"
	# in the zone → less likely to flat-out refuse; rattled → refuses more readily
	return "refuse" if d.trust < 35.0 - d.mood * 15.0 else "pushback"

func _pushback_line(d: Driver, call: String) -> String:
	match call:
		"attack":
			return "резина на исходе, но попробую" if d.tire_wear > 85.0 else "батарея пустая, без боста"
		"save":
			return "я в борьбе — беречь нечем!"
		"defend":
			return "сзади чисто, но прикрою"
		_:
			return "принял"

# The engineer issues a radio call to a player car. Sets the underlying directive
# unless the driver refuses; always emits the two-way exchange to the feed.
func radio_call(car_id: int, call: String) -> void:
	var d := get_driver_by_id(car_id)
	if d == null or not d.is_player or d.finished:
		return
	if call != "encourage" and not CALLS.has(call):
		return
	if elapsed < d.next_call_time:
		_emit("%s: «дай отработать, инженер»" % d.name, "radio")
		return
	d.next_call_time = elapsed + CALL_COOLDOWN
	# "Подбодрить": a pep talk lifts mood — but only a TRUSTED engineer's words land.
	if call == "encourage":
		d.mood = clampf(d.mood + 0.35 * (0.4 + 0.6 * d.trust / 100.0), -1.0, 1.0)
		_emit("Инженер → %s: «Соберись — ты быстрее всех, покажи им!»" % d.name, "team")
		_emit("%s: «принял, поехали!»" % d.name if d.trust >= 50.0 \
			else "%s: «…ага, конечно»" % d.name, "radio")
		return
	var c: Dictionary = CALLS[call]
	var reaction := _eval_call(d, call)
	_emit("Инженер → %s: «%s»" % [d.name, c["say"]], "team")
	if reaction == "refuse":
		_emit("%s: «нет, я знаю что делаю»" % d.name, "radio")
		d.trust = maxf(0.0, d.trust - 2.0)
		return
	d.dir_pace = c["pace"]
	d.dir_intent = c["intent"]
	if reaction == "pushback":
		_emit("%s: «%s»" % [d.name, _pushback_line(d, call)], "radio")
	else:
		_emit("%s: «принял»" % d.name, "radio")
		d.trust = minf(100.0, d.trust + 1.0)

# Append a race-feed entry and keep last_event in sync for the one-shot banner.
# No RNG, no sim-affecting state — determinism-safe (reads lap only).
func _emit(text: String, kind: String) -> void:
	last_event = text
	var lap_n := 1
	for d in drivers:
		if not d.finished:
			lap_n = maxi(lap_n, d.lap + 1)
	event_log.append({"lap": lap_n, "text": text, "kind": kind})
	while event_log.size() > 24:
		event_log.pop_front()

# Live speed (km/h) from the car's current effective laptime — reflects tyres,
# fuel, ERS, pace mode, weather, track and the safety car (lt balloons under SC).
func speed_kmh(d: Driver) -> float:
	if d.finished or d.last_lt <= 0.0:
		return 0.0
	return track.length_km / (d.last_lt / 3600.0)

# Returns drivers sorted by race position. Finished cars rank by finish time;
# the rest by track progress.
func order() -> Array:
	# Manual insertion sort. On Godot 4.6.3 BOTH sort_custom(bound-method
	# Callable) and Array.sort() over nested-array keys came back UNSORTED
	# here (lambda comparators do work — see _update_safety_car); plain
	# method calls are always safe. n=22 → O(n²) is nothing; deterministic
	# via the id tie-break in _cmp_position.
	var arr: Array = []
	for d in drivers:
		var i := 0
		while i < arr.size() and not _cmp_position(d, arr[i]):
			i += 1
		arr.insert(i, d)
	return arr

# Race-position comparator (strict total order): finished cars by the
# crossing instant (finish_key — finish_time is display-only), then running
# cars by track progress; unique id breaks all ties.
func _cmp_position(a: Driver, b: Driver) -> bool:
	if a.finished != b.finished:
		return a.finished
	if a.finished:
		if a.finish_key != b.finish_key:
			return a.finish_key < b.finish_key
		return a.id < b.id
	if a.progress() != b.progress():
		return a.progress() > b.progress()
	return a.id < b.id

func step(dt: float) -> void:
	if finished:
		return
	elapsed += dt
	if not _started:
		# Record each driver's starting compound BEFORE the launch (pre-race
		# tyre choice is captured here, not in _init, so set_start_compound has fired).
		for d in drivers:
			if not (d.compound in d.compounds_used):
				d.compounds_used.append(d.compound)
		_started = true
		_race_start()
	if team_pit_cooldown > 0.0:
		team_pit_cooldown = max(0.0, team_pit_cooldown - dt)
	_update_safety_car()
	_update_weather()
	# Discrete weather state: derived from the just-updated wetness. Emit a feed
	# event when the state changes and reset track_evo if rain starts (rubber washes off).
	var prev_weather: String = weather_state
	weather_state = _current_weather_state()
	if weather_state != prev_weather:
		var cur_lap_est: int = 0
		if not drivers.is_empty():
			cur_lap_est = int((drivers[0] as Driver).lap)
		var wstate_names: Dictionary = {
			WEATHER_DRY:      "Трасса высыхает",
			WEATHER_VARIABLE: "Переменная погода",
			WEATHER_RAIN:     "Дождь!",
			WEATHER_STORM:    "Ливень!",
		}
		var wmsg: String = String(wstate_names.get(weather_state, "Погода меняется"))
		_emit("[погода] %s (круг %d)" % [wmsg, cur_lap_est], "weather")
		if weather_state == WEATHER_RAIN or weather_state == WEATHER_VARIABLE:
			race_frac = 0.0
	# phase 1 — advance every car at its own clean pace
	var ordered := order()
	# track rubbering-in: race completion (leader) drives the grip-evolution term
	if not ordered.is_empty():
		race_frac = clampf(ordered[0].progress() / float(maxi(1, track.laps)), 0.0, 1.0)
	for i in ordered.size():
		var d: Driver = ordered[i]
		if d.finished:
			continue
		if d.pit_timer > 0.0:
			d.pit_timer = max(0.0, d.pit_timer - dt)
			if d.pit_timer == 0.0:
				d.in_pitlane = false        # left the pit lane, rejoined the track
			continue
		var ahead_gap := -1.0
		if i > 0:
			ahead_gap = (ordered[i - 1].progress() - d.progress()) * track.base_laptime
		var behind_gap := -1.0
		if i < ordered.size() - 1:
			behind_gap = (d.progress() - ordered[i + 1].progress()) * track.base_laptime
		_ai_energy(d, ahead_gap, behind_gap)
		var lt := current_laptime(d, ahead_gap)
		d.last_lt = lt
		# reliability: a mechanical failure ends the race (worse while pushing)
		if not sc_active:
			var stress := 1.6 if d.pace_mode == "push" else 1.0
			if rng.unit() < DNF_BASE * (1.0 - d.reliability) * stress \
					* (1.0 - 0.3 * d.reliability_work) * (2.0 - d.pu_health) * (dt / lt):
				d.finished = true
				d.dnf = true
				d.finish_time = 100000.0 - float(d.lap)   # classified behind finishers
				d.finish_key = 1.0e9 - float(d.lap)
				_emit("%s: сход — отказ техники." % d.name, "dnf")
				continue
		var _sector_prev := d.lap_frac
		d.lap_frac += dt / lt
		_check_sector_crossing(d, _sector_prev)
		var risk: float = (PACE_MODES[d.pace_mode]["risk"] + ERS_MODES[d.ers_mode]["risk"]) \
			* (1.0 + d.tire_wear / 120.0) \
			* (1.3 - _attr(d, "composure") * 0.45) * (1.3 - _attr(d, "consistency") * 0.45) \
			* (1.0 - d.mood * 0.3)        # in the zone → fewer mistakes; rattled → more
		var cond := 1.0 + wetness * 1.6
		if d.tyre_temp < COLD_TEMP:
			cond += 0.4
		if ahead_gap >= 0.0 and ahead_gap < DA_THRESH:
			cond += 0.3
		# M-D2: a hunted driver cracks — siege pressure raises the error
		# roll, low composure amplifies it (the classic defending lock-up).
		cond *= 1.0 + d.pressure * 0.8 * (1.2 - _attr(d, "composure"))
		if rng.unit() < risk * cond * dt * INCIDENT_K:
			_driver_incident(d)
		d.pu_health = maxf(0.0, d.pu_health - PU_WEAR * (1.5 if d.pace_mode == "push" else 1.0) * (dt / lt))
		if not sc_active:
			var wear_rate: float = COMPOUNDS[d.compound]["wear"] \
				* PACE_MODES[d.pace_mode]["wear"] * track.abrasion * d.wear_mult \
				* (0.7 + 0.6 * track.downforce) \
				* (1.25 - _attr(d, "tyre") * 0.5) \
				* (1.0 + maxf(0.0, d.tyre_temp - float(COMPOUNDS[d.compound]["thi"])) * OVERHEAT_WEAR) \
				* (1.0 + d.graining * GRAIN_WEAR) \
				* (1.0 + (1.0 - d.setup_q_race) * SETUP_WEAR_K) \
				* (1.0 + d.blister * BLISTER_WEAR)
			d.tire_wear = min(120.0, d.tire_wear + wear_rate * (dt / lt))
			_update_blister(d, dt, lt)
		_update_soc(d, dt, lt, ahead_gap)
		_update_tyre_temp(d, dt, lt, ahead_gap)
	# phase 2 — wheel-to-wheel: hold a follower behind until it earns the pass
	if not sc_active:
		_resolve_combat(dt)
	# phase 3 — complete laps
	for d in drivers:
		if d.finished:
			continue
		while d.lap_frac >= 1.0:
			d.lap_frac -= 1.0
			d.lap += 1
			d.last_lap = d.last_lt
			if not sc_active and (d.best_lap == 0.0 or d.last_lt < d.best_lap):
				d.best_lap = d.last_lt
				if fastest_id == -1 or d.best_lap < fastest_lap:
					fastest_lap = d.best_lap
					fastest_id = d.id
					_emit("%s — быстрейший круг (%.1f)" % [d.name, d.best_lap], "flap")
			# fuel burn rate: push burns more, save (lift-and-coast) burns less.
			var burn := 1.0
			if d.save:
				burn = SAVE_FUEL_RATE
			elif d.pace_mode == "push":
				burn = FUEL_PUSH_BURN
			d.fuel_laps = max(0.0, d.fuel_laps - burn)
			if d.yield_laps > 0:
				d.yield_laps -= 1
			if d.lap >= track.laps:
				d.finished = true
				# Classification key: back out the overshoot to the sub-tick
				# instant the line was crossed. finish_time (own elapsed) is
				# distorted by the SC catch-up physics — display only.
				d.finish_key = elapsed - clampf(d.lap_frac, 0.0, 1.0) * maxf(d.last_lt, 1.0)
				d.lap_frac = 0.0
				d.finish_time = elapsed
				# accrued time penalties (jump-start, etc.) apply to both the
				# displayed time and the classification key.
				if d.time_penalty > 0.0:
					d.finish_time += d.time_penalty
					d.finish_key += d.time_penalty
				# Two-compound rule: in a dry race, at least two different slick
				# compounds must be used. AI always complies; this only bites a human
				# car that started and finished on the same compound without a pit stop.
				if not had_wet:
					var slicks_used := 0
					for cu in d.compounds_used:
						if String(cu) in ["soft", "medium", "hard"]:
							slicks_used += 1
					if slicks_used < 2:
						d.finish_time += 20.0
						d.finish_key += 20.0
						_emit("%s: +20 с — не использованы два состава шин (правило)." % d.name, "penalty")
				break
			_on_lap_complete(d)
	var all_done := true
	for d in drivers:
		if not d.finished:
			all_done = false
			break
	if all_done:
		finished = true

# Wheel-to-wheel resolution. Walk the running order front→back: a follower within
# COMBAT_GAP is pinned just behind the car ahead and builds "pass credit" from its
# clean pace edge (+ Overtake boost). When that beats the track's resistance it
# completes the pass. This makes overtaking earned and track-dependent instead of
# cars endlessly swapping on raw progress + noise.
func _resolve_combat(dt: float) -> void:
	var run: Array = []
	for d in order():
		if not d.finished and d.pit_timer <= 0.0:
			run.append(d)
	var mg := MIN_GAP_S / track.base_laptime
	for i in range(1, run.size()):
		var a: Driver = run[i - 1]
		var b: Driver = run[i]
		var gap_s := (a.progress() - b.progress()) * track.base_laptime
		if gap_s >= COMBAT_GAP:
			b.credit = 0.0
			continue
		var boost := 0.0
		if _ot_effective(b, maxf(gap_s, 0.0)):
			# 2026 v0.4: Overtake is strongest on high-power/many-zone tracks (the
			# chaser keeps high-speed electric power the leader has lost to the taper,
			# and the aero zones give it a clean run).
			boost = -OT_PACE * (0.5 + 0.5 * track.power) * (0.4 + 0.15 * float(track.aero_zones))
		# Combat edge uses the CLEAN pace (straight-line power-cut removed): the cut
		# still slows a car's advance and lap time (it falls back over a stint) but
		# must not scramble the tuned pass-credit — energy cost is the budget gate.
		var edge := (a.last_lt - b.last_lt) + boost
		var atkf := 0.7 + _attr(b, "overtaking") * 0.5 + _attr(b, "aggression") * 0.2
		# segment-aware: credit builds on the straight (slipstream run / Overtake), not
		# mid-corner. seg_mult is normalized so its lap-average is 1 (corridor-preserving).
		var seg_b: Dictionary = track.seg_at(b.lap_frac)
		var on_str_b: bool = seg_b.is_empty() or String(seg_b.get("kind", "")) == "straight"
		var seg_avg: float = track.straight_frac * PASS_STRAIGHT_BIAS + (1.0 - track.straight_frac) * PASS_CORNER_BIAS
		var seg_mult: float = (PASS_STRAIGHT_BIAS if on_str_b else PASS_CORNER_BIAS) / maxf(0.1, seg_avg)
		if edge > PASS_DEADZONE:
			var colp := COL_BASE * _attr(b, "aggression") * (1.4 - _attr(a, "composure")) \
				* (1.0 + wetness * 2.0) * (dt / track.base_laptime)
			if a.team and b.team:
				colp *= 1.6
			if rng.unit() < colp:
				_collision(a, b)
			b.credit += (edge - PASS_DEADZONE) * atkf * (dt / track.base_laptime) \
				* (PASS_OT_BASE + track.overtaking * PASS_OT_K) * seg_mult
		else:
			b.credit = maxf(0.0, b.credit - CREDIT_DECAY * dt)
		if b.credit >= _pass_resist() + _attr(a, "defending") * 3.5:   # earned the pass
			b.credit = 0.0
			a.credit = 0.0
			b.passes_made += 1
			if on_str_b:
				passes_on_straight += 1
			# M-C1 pass-sticks: the passed car is rattled (mood — team cars
			# only, they have the per-lap recovery loop) and its attack is
			# frozen for a couple of laps — no instant re-pass ping-pong.
			if a.team:
				a.mood = maxf(-1.0, a.mood - (0.20 + 0.20 * (1.0 - _attr(a, "composure"))))
			a.attack_laps = -2
			a.atk_latch = false
			a.pressure = 0.0
			_emit("%s обошёл %s" % [b.name, a.name], "overtake")
			# Never assign b.lap here: lap bookkeeping (fuel, deploy budget, pits,
			# trust/mood) belongs to step() phase 3, which wraps lap_frac >= 1.0.
			b.lap_frac = a.progress() + mg - float(b.lap)
		elif b.progress() > a.progress() - mg:          # held up behind a
			# lap_frac may go slightly negative here (held just behind the line):
			# progress() stays correct and seg_at() uses fposmod, so that's safe.
			b.lap_frac = a.progress() - mg - float(b.lap)

# Cumulative pace edge (seconds) a follower must build to pass here.
# Low-overtaking circuits (Monaco) demand far more than easy ones (Monza).
func _pass_resist() -> float:
	return 3.0 + 8.0 * (1.0 - track.overtaking)

# Safety car: deploy at sc_deploy_lap, bunch the running field into a tight
# train behind the leader, then pull in after a few laps. Pure host-side state.
func _update_safety_car() -> void:
	var run: Array = []
	for d in drivers:
		if not d.finished:
			run.append(d)
	if run.is_empty():
		return
	run.sort_custom(func(a, b): return a.progress() > b.progress())
	var leader_lap: int = run[0].lap
	if not sc_active and not sc_done and sc_deploy_lap >= 0 and leader_lap >= sc_deploy_lap:
		sc_active = true
		sc_done = true
		sc_until_lap = leader_lap + int(erng.rangef(SC_MIN_LAPS, SC_MAX_LAPS + 1))
		# No teleport: the field concertinas via SC_CATCH_MULT in current_laptime
		# (lap counters are never assigned — see the combat invariant in CLAUDE.md).
		# Every SC must name a cause. Incidents set sc_reason when they trigger it;
		# a scheduled (sc_prob) SC has none yet, so manufacture a plausible cause.
		if sc_reason == "":
			sc_reason = _fabricate_sc_cause(run)
		_emit("Сейфти-кар: %s. Пелотон собран — дешёвый пит даёт шанс." % sc_reason, "sc")
	elif sc_active and leader_lap >= sc_until_lap:
		sc_active = false
		_emit("Сейфти-кар уезжает — рестарт!", "sc")

# Strategist quality sets the pit window: a better strategist pits closer to the
# optimum with far less random spread (a weak one mistimes the stop).
func _strat_pit_wear(d: Driver) -> float:
	var spread := (1.0 - d.strat_skill) * 15.0
	return clampf(62.0 + rng.rangef(-spread, spread), 46.0, 84.0)

# A driver error, severity rolled: lock-up → spin → heavy crash → retirement.
func _driver_incident(d: Driver) -> void:
	d.had_incident = true        # flagged for the per-lap trust review (push → mistake)
	var sev := rng.unit()
	if sev < 0.70:
		d.pit_timer += rng.rangef(0.4, 1.8)
		if d.team:
			_emit("%s: блокировка колёс — потеря времени." % d.name, "incident")
	elif sev < 0.90:
		d.pit_timer += rng.rangef(3.5, 8.0)
		d.aero_damage = minf(1.0, d.aero_damage + rng.rangef(0.10, 0.30))
		_emit("%s: вылет в эскейп — потеря времени и повреждения." % d.name, "incident")
	elif sev < 0.99:
		d.pit_timer += rng.rangef(7.0, 15.0)
		d.aero_damage = minf(1.0, d.aero_damage + rng.rangef(0.30, 0.60))
		_emit("%s: авария! Серьёзные повреждения." % d.name, "incident")
		# not every crash needs a safety car — gate it, or SC appears ~every race
		if rng.unit() < 0.55:
			_trigger_incident_sc(d.lap, "%s — авария, машина в барьере" % d.name)
	else:
		d.finished = true
		d.dnf = true
		d.finish_time = 100000.0 - float(d.lap)
		d.finish_key = 1.0e9 - float(d.lap)
		_emit("%s: тяжёлый вылет — сход!" % d.name, "dnf")
		_trigger_incident_sc(d.lap, "%s — тяжёлый сход, уборка машины" % d.name)

# Two cars touch: the follower (and sometimes both) lose time and take damage;
# teammates fighting is the worst case (and is more likely to bring out the SC).
func _collision(a: Driver, b: Driver) -> void:
	b.pit_timer += rng.rangef(1.5, 5.0)
	b.aero_damage = minf(1.0, b.aero_damage + rng.rangef(0.10, 0.40))
	if rng.unit() < 0.45:
		a.pit_timer += rng.rangef(1.0, 4.0)
		a.aero_damage = minf(1.0, a.aero_damage + rng.rangef(0.10, 0.30))
	if a.team and b.team:
		_emit("Контакт напарников! %s и %s — разводите машины!" % [a.name, b.name], "incident")
	else:
		_emit("Контакт: %s и %s не поделили поворот." % [b.name, a.name], "incident")
	if rng.unit() < 0.12:
		_trigger_incident_sc(b.lap, "контакт: %s и %s, обломки на трассе" % [b.name, a.name])

# A serious incident can bring out the safety car (causal, not only scripted).
# The reason is recorded so the SC deploy message can name the actual cause.
func _trigger_incident_sc(at_lap: int, reason: String = "") -> void:
	if not sc_active and not sc_done:
		sc_deploy_lap = at_lap
		if reason != "":
			sc_reason = reason

# Manufacture a plausible cause for a scheduled (sc_prob) safety car, so it never
# appears out of nowhere. Deterministic — uses the events RNG only at deploy.
func _fabricate_sc_cause(run: Array) -> String:
	var pool: Array = []
	for d in run:
		if not d.is_player:
			pool.append(d)            # blame a non-player car
	if pool.is_empty():
		pool = run
	var victim: Driver = pool[mini(pool.size() - 1, int(erng.unit() * pool.size()))]
	var roll := erng.unit()
	if roll < 0.42:
		return "%s в стене" % victim.name
	elif roll < 0.68:
		return "обломки на трассе после контакта в группе"
	elif roll < 0.86:
		return "%s встал на трассе (отказ техники)" % victim.name
	else:
		return "авария в средней группе"

# Track wetness over the race: a triangular shower between wet_start and wet_end,
# peaking at wet_peak, read off the leader's lap fraction. Drives the wet pace
# term, AI tyre choice and raised incident risk.
func _update_weather() -> void:
	if wet_start > 1.0:
		return
	var lead_lap := 0
	for d in drivers:
		if not d.finished and d.lap > lead_lap:
			lead_lap = d.lap
	var frac := clampf(float(lead_lap) / float(maxi(1, track.laps)), 0.0, 1.0)
	var w := 0.0
	if frac >= wet_start and frac <= wet_end:
		var span := maxf(0.001, wet_end - wet_start)
		var mid := wet_start + span * 0.5
		w = wet_peak * (1.0 - absf(frac - mid) / (span * 0.5))
	wetness = clampf(w, 0.0, 1.0)
	if wetness > 0.30:
		had_wet = true
	if wetness > 0.05 and not _wet_announced:
		_wet_announced = true
		_emit("Начинается дождь! Время думать про дождевую резину.", "weather")

func _on_lap_complete(d: Driver) -> void:
	# --- Sector 2 (S3) completion at the lap boundary ---
	if d.sector_entry_time >= 0.0 and d.cur_sector == 2:
		var _t3: float = elapsed - d.sector_entry_time
		d.sector_times[2] = _t3
		if float(d.sector_best[2]) < 0.0 or _t3 < float(d.sector_best[2]):
			d.sector_best[2] = _t3
		if float(sector_global_best[2]) < 0.0 or _t3 < float(sector_global_best[2]):
			sector_global_best[2] = _t3
	# Record the final mini-sector if the loop didn't already catch it
	var _nm: int = track.mini_sector_bounds.size()
	if _nm > 0 and not d.mini_times_this_lap.is_empty() \
			and d.cur_mini == _nm - 1 and d.mini_entry_time >= 0.0:
		var _mlt: float = elapsed - d.mini_entry_time
		d.mini_times_this_lap[_nm - 1] = _mlt
		if float(d.mini_best[_nm - 1]) < 0.0 or _mlt < float(d.mini_best[_nm - 1]):
			d.mini_best[_nm - 1] = _mlt
		if float(mini_global_best[_nm - 1]) < 0.0 or _mlt < float(mini_global_best[_nm - 1]):
			mini_global_best[_nm - 1] = _mlt
	# Reset for new lap
	d.cur_sector = 0
	d.sector_entry_time = elapsed
	d.soc_at_sector[0] = d.soc_avg
	d.mini_prev = d.mini_times_this_lap.duplicate()
	d.cur_mini = 0
	d.mini_entry_time = elapsed
	d.mini_times_this_lap = []
	for _ri in _nm:
		d.mini_times_this_lap.append(-1.0)
	# (v0.6: no per-lap deploy budget to reset — the SoC store cycles continuously)
	# tyre age: count every completed lap on the current set
	d.tyre_laps += 1
	# engineer↔driver loop: review the lap just finished (trust + mood from the
	# same position outcome, then driver radio) BEFORE deciding new-lap compliance.
	if d.team:
		var pos := _position_of(d)
		var gained := 0
		if d.trust_last_pos > 0:
			gained = d.trust_last_pos - pos        # +ve = moved up the order
		_update_mood(d, gained)
		if d.is_player:
			_update_trust(d, gained)
		d.trust_last_pos = pos
		_driver_radio(d)
	d.had_incident = false
	# M-A2: attack patience — count laps camped in attack range; a stalled
	# attack (pass credit not building toward the track's resistance) gets
	# abandoned: sit back, save the car, strike at the stops. Re-engage when
	# the picture changes (target pits/errs, fresh-tyre edge, race runs out).
	var ahd := _car_ahead(d)
	var fight_gap := -1.0
	var raw_edge := 0.0            # + = faster in fight terms: dirty air removed
	if ahd != null:                # (Overtake waives it) but the tow kept — at Monza
		# the slipstream is exactly what makes a pass possible without a clean edge
		fight_gap = (ahd.progress() - d.progress()) * track.base_laptime
		raw_edge = (ahd.last_lt - ahd.da_pen) - (d.last_lt - d.da_pen)
	if fight_gap >= 0.0 and fight_gap < OT_GAP_S * 1.5:
		d.edge_ema = d.edge_ema * 0.5 + raw_edge * 0.5
	else:
		d.edge_ema = 0.0
	# Stall threshold scales with how hard passing is here: at Monaco only a
	# big clean edge justifies grinding past patience; at Monza near-parity
	# plus the tow is enough to keep working the car ahead.
	var stall_edge := maxf(0.0, 0.30 - track.overtaking * 0.30)
	if d.attack_backed:
		if ahd == null or fight_gap > 3.0 or ahd.pit_timer > 0.0 \
				or d.tyre_laps <= 2 or ahd.tire_wear - d.tire_wear >= 15.0 \
				or raw_edge >= 0.5 or track.laps - d.lap <= 3:
			d.attack_backed = false
			d.attack_laps = 0
	elif fight_gap >= 0.0 and fight_gap < OT_GAP_S * 1.5:
		d.attack_laps += 1
		if d.attack_laps > _patience_laps(d) and d.edge_ema < stall_edge:
			d.attack_backed = true
			if d.team and d.radio_cd <= 0:
				_emit("%s по радио: «его не пройти — возьмём на питах»" % d.name, "radio")
				d.radio_cd = 5
	else:
		d.attack_laps = 0
	# M-D2: pressure — being hunted inside Overtake range builds it; freedom
	# (and composure) sheds it. Feeds the incident-risk cond in step phase 1.
	if _someone_behind(d, OT_GAP_S):
		d.pressure = minf(1.0, d.pressure + 0.12)
	else:
		d.pressure = maxf(0.0, d.pressure - (0.15 + 0.35 * _attr(d, "composure")))
	if d.is_player:
		d.obey = _roll_obey(d)        # decide compliance for the new lap
	var do_pit := false
	var new_comp := d.compound
	if d.is_player:
		if d.pitting:
			do_pit = true
			new_comp = d.pit_request_compound if d.pit_request_compound != "" else d.compound
			d.pitting = false
	else:
		var laps_left := track.laps - d.lap
		var want_pit := (d.tire_wear >= d.ai_pit_wear and laps_left > 6 and d.pit_count < d.pit_plan) \
				or (d.tire_wear >= 92.0 and laps_left > 3) \
				or d.cover_pit
		# Mandatory-stop rule (dry): the AI never runs flag-to-flag on low wear —
		# it banks the required stop late (two-compound rule, sim side; player-side
		# enforcement arrives with the pre-race tyre-choice UI).
		if d.pit_count == 0 and wetness < 0.30 and laps_left <= 12 and laps_left > 3:
			want_pit = true
		# tyre/weather crossover: slicks in the rain or wets on a drying track → box
		var on_slick: bool = d.compound in ["soft", "medium", "hard"]
		if laps_left > 2 and ((on_slick and wetness > 0.40) or (not on_slick and wetness < 0.15)):
			want_pit = true
		# opportunistic cheap stop while the safety car is out
		if sc_active and d.pit_count == 0 and laps_left > 4 and d.tire_wear > 30.0 and rng.unit() < 0.4 + 0.6 * d.strat_skill:
			want_pit = true
		if want_pit:
			do_pit = true
			if laps_left > 22:
				new_comp = "hard"
			elif laps_left > 10:
				new_comp = "medium"
			else:
				new_comp = "soft"
			# M-S2: a 2-stop first stop fits rubber for the STINT, not the
			# flag — a hard here would last to the end and eat the plan.
			if d.pit_plan == 2 and d.pit_count == 0:
				new_comp = "medium" if laps_left > 16 else "soft"
			if wetness > 0.70:
				new_comp = "wet"
			elif wetness > 0.38:
				new_comp = "inter"
			elif new_comp == d.compound:
				# two-compound rule: a dry stop must fit a different compound
				new_comp = "soft" if laps_left <= 16 else "hard"
	if do_pit:
		# M4: the noise rolls are hoisted so the crew-box stop time can reuse
		# them — draw order is identical to the old inline expression.
		var stop_noise := rng.rangef(-1.5, 1.5)
		var botched := rng.unit() < (1.0 - d.pit_consistency) * 0.05
		var botch_extra := rng.rangef(3.0, 6.0) if botched else 0.0
		var loss := track.pit_loss * (1.1 - 0.2 * d.pit_speed) \
			+ stop_noise * (1.0 - d.pit_consistency) + botch_extra
		# M4: crew-box stop time (seconds) for the DHL fastest-stop zachet.
		var crew_time := STOP_TIME_BASE - STOP_TIME_SPEED_K * d.pit_speed \
			+ (stop_noise / 1.5) \
			* (STOP_TIME_SIGMA_MIN + STOP_TIME_SIGMA_K * (1.0 - d.pit_consistency)) \
			+ (STOP_BOTCH_EXTRA if botched else 0.0)
		d.best_stop = minf(d.best_stop, maxf(1.6, crew_time))
		if sc_active:
			loss *= SC_PIT_FACTOR        # cheaper to stop when the field is slow
		if d.team:
			if team_pit_cooldown > 0.0:
				loss += PIT_STACK_PENALTY
				_emit("Двойной пит! %s ждёт экипаж (+%.0f c). Разводите заезды!" % [
					d.name, PIT_STACK_PENALTY], "pit")
			team_pit_cooldown = TEAM_CREW_BUSY
		d.pit_total = loss                # for the minimap pit-lane animation
		d.in_pitlane = true
		d.pit_timer += loss
		d.tire_wear = 0.0
		d.tyre_laps = 0                   # new set: reset tyre age
		d.tyre_temp = TYRE_TEMP_START     # fresh tyres come out cold → out-lap deficit
		d.graining = 0.0                  # fresh rubber: no graining
		d.blister = 0.0                   # fresh rubber: blistering cleared
		d.aero_damage = 0.0               # the stop also repairs floor/wing damage
		d.compound = new_comp
		if not (new_comp in d.compounds_used):
			d.compounds_used.append(new_comp)
		_emit("%s — пит-стоп (%s)" % [d.name, new_comp.capitalize()], "pit")
		d.pit_count += 1
		d.cover_pit = false
		d.ai_pit_wear = _strat_pit_wear(d)
		# M-S2: while the 2-stop plan still owes a stop, keep the stint-sized
		# target (the standard ~62 window would not come around again in time).
		if d.pit_count < d.pit_plan:
			var wpl_now: float = COMPOUNDS[d.compound]["wear"] * track.abrasion * d.wear_mult
			d.ai_pit_wear = clampf(float(track.laps) * wpl_now / 3.0 * 1.15, 36.0, d.ai_pit_wear)
		# M-S1: undercut cover — rivals in this car's pit window may react
		# (chance scales with their strategist; a weak one misses the call).
		# Player cars never auto-cover: their stops are their own call.
		var lapsleft_now := track.laps - d.lap
		for o in drivers:
			if o == d or o.finished or o.is_player or o.cover_pit:
				continue
			if o.pit_count > 0 or o.tire_wear < 38.0 or lapsleft_now <= 8:
				continue
			var gp: float = absf(o.progress() - d.progress()) * track.base_laptime
			if gp < 3.0 and rng.unit() < 0.35 + 0.55 * o.strat_skill:
				o.cover_pit = true
				covers_called += 1
				if o.team:
					_emit("%s: накрываем андеркат — в боксы на следующем круге!" % o.name, "pit")

# Apply results from an interactive QualiSim session to this sim.
# Overwrites quali_times, quali_grid and per-driver positional state exactly
# like the tail of _run_qualifying.  Guard: only callable before the first tick.
# Does NOT consume rng — reads/writes only the qualifying result fields.
func apply_quali_results(grid_ids: Array, times_dict: Dictionary) -> void:
	if _started:
		return
	quali_times = times_dict.duplicate()
	quali_grid  = []
	var n: int = grid_ids.size()
	for gp in n:
		var did: int = int(grid_ids[gp])
		quali_grid.append(did)
		var d: Driver = get_driver_by_id(did)
		if d == null:
			continue
		d.grid_pos  = gp + 1
		d.lap_frac  = float(n - 1 - gp) * GRID_GAP
		d.tyre_temp = TYRE_TEMP_GRID

# Pre-race starting compound (the co-directors' joint call). Only before the
# first tick, only team cars, slicks only (races always start dry).
func set_start_compound(car_id: int, comp: String) -> void:
	var d := get_driver_by_id(car_id)
	if d == null or _started or not d.team:
		return
	if comp in ["soft", "medium", "hard"]:
		d.compound = comp

# --- per-car control (works for any human-driven car: solo or co-op team) ---
func request_pit(car_id: int, compound: String) -> void:
	var d := get_driver_by_id(car_id)
	if d != null and d.is_player:
		d.pitting = true
		d.pit_request_compound = compound

func set_pace(car_id: int, mode: String) -> void:
	var d := get_driver_by_id(car_id)
	if d != null and d.is_player and PACE_MODES.has(mode):
		d.dir_pace = mode             # a directive, not direct control

func set_intent(car_id: int, intent: String) -> void:
	var d := get_driver_by_id(car_id)
	if d != null and d.is_player:
		d.dir_intent = intent

# 2026 energy controls — each player manages their own car's battery.
func set_ers(car_id: int, mode: String) -> void:
	var d := get_driver_by_id(car_id)
	if d != null and d.is_player and ERS_MODES.has(mode):
		d.ers_mode = mode

func set_overtake(car_id: int, on: bool) -> void:
	var d := get_driver_by_id(car_id)
	if d != null and d.is_player:
		d.overtake = on

func set_save(car_id: int, on: bool) -> void:
	var d := get_driver_by_id(car_id)
	if d != null and d.is_player:
		d.save = on

func get_driver_by_id(car_id: int) -> Driver:
	for d in drivers:
		if d.id == car_id:
			return d
	return null

func get_player() -> Driver:
	for d in drivers:
		if d.is_player:
			return d
	return null

# Human-controlled team cars, sorted by id (P5 then P6 on the grid).
func get_team() -> Array:
	var arr: Array = []
	for d in drivers:
		if d.team:
			arr.append(d)
	arr.sort_custom(func(a, b): return a.id < b.id)
	return arr

# Backwards-compatible single-car pit request.
func player_pit(compound: String) -> void:
	var p := get_player()
	if p != null:
		request_pit(p.id, compound)

# --- team orders (co-op coordination) ---
# Set the same pace mode on both team cars at once (director's call).
func set_team_pace(mode: String) -> void:
	if not PACE_MODES.has(mode):
		return
	for d in get_team():
		if d.is_player:
			d.dir_pace = mode
	_emit("Команда: обе машины — директива темпа %s." % mode, "team")

# Order the leading team car to ease off so the teammate can pass.
func team_order_swap() -> void:
	var team := get_team()
	if team.size() < 2:
		return
	var ahead: Driver = team[0]
	var behind: Driver = team[1]
	if behind.progress() > ahead.progress():
		var tmp := ahead
		ahead = behind
		behind = tmp
	ahead.yield_laps = 3
	_emit("Командный приказ: %s пропускает %s." % [ahead.name, behind.name], "team")

# Attribute value 0..1 (default 13/20 if missing).
func _attr(d: Driver, key: String) -> float:
	return float(d.attrs.get(key, 13)) / 20.0

# Deterministic attribute profile from overall skill + a personality seed, so we
# don't hand-author 22×12 numbers. Generated once per field build.
static func gen_attributes(skill: float, seed_value: int) -> Dictionary:
	var r := RNG.new(mix32(seed_value))
	# Overall band drifts per driver so two equal-skill drivers aren't clones.
	var base := 5.0 + clampf(skill, 0.0, 1.0) * 13.0 + r.rangef(-1.0, 1.0)   # ~4..19
	var a := {}
	for k in ATTR_KEYS:
		a[k] = base + r.rangef(-3.0, 3.0)                # wider per-attr spread
	match int(r.next_u32() % 5):                          # personality archetype (all 5 shape the driver)
		0:
			a["pace"] += 3.0; a["energy"] += 3.0; a["overtaking"] -= 2.0; a["defending"] -= 2.0
		1:
			a["aggression"] += 6.0; a["overtaking"] += 4.0; a["tyre"] -= 4.0; a["composure"] -= 3.0
		2:
			a["tyre"] += 6.0; a["race_iq"] += 4.0; a["aggression"] -= 5.0; a["consistency"] += 3.0
		3:
			a["pace"] += 3.0; a["aggression"] += 4.0; a["consistency"] -= 6.0; a["composure"] -= 5.0
		4:
			a["defending"] += 6.0; a["consistency"] += 5.0; a["composure"] += 4.0; a["aggression"] -= 5.0
	for k in a:
		a[k] = clampi(int(round(float(a[k]))), 1, 20)
	return a

# Builds the full race grid from the real 2026 roster (see f1_2026.gd).
# player_team selects which real team you run; its drivers take ids 4
# (Директор) and 5 (Инженер). In co-op both are human; in solo P6 is AI.
# player_staff (M2): optional {role -> Personnel.Staff} for the player team —
# the season's persistent people (Season.staff_for_sim()). Empty = generate.
static func make_field(coop: bool = false, player_team: int = 1,
		player_staff: Dictionary = {}) -> Array:
	var grid := F1_2026.race_grid(player_team)
	var arr: Array = []
	var staff_cache := {}              # team_idx -> staff dict (built once per team)
	for i in grid.size():
		var g: Dictionary = grid[i]
		var d := Driver.new()
		d.id = i
		d.name = g["name"]
		d.skill = g["skill"]
		d.compound = "medium"
		d.color = g.get("color", "#8a94a6")
		d.slot = int(g.get("slot", 0))
		d.attrs = gen_attributes(d.skill, i * 2654435761)
		d.team_idx = int(g.get("team_idx", -1))   # M4: DHL zachet needs the owner team
		var car: Dictionary = g.get("car", {})
		d.car_power = float(car.get("power", 0.78))
		d.car_aero = float(car.get("aero", 0.78))
		d.reliability = float(car.get("rel", 0.80))
		# engine ERS efficiency → battery harvest rate (≈0.94..1.09)
		d.harvest_mult = 1.0 + (float(car.get("energy", 0.82)) - 0.82) * 1.5
		# team personnel: strategist (AI strategy) + pit crew (stop time / reliability)
		var tidx := int(g.get("team_idx", 1))
		if not staff_cache.has(tidx):
			# M2: the player team uses the season's persistent people when given.
			if tidx == player_team and not player_staff.is_empty():
				staff_cache[tidx] = player_staff
			else:
				staff_cache[tidx] = Personnel.team_staff(tidx)
		var staff: Dictionary = staff_cache[tidx]
		d.strat_skill = Personnel.strategist_skill(staff)
		d.pit_speed = Personnel.pit_speed(staff)
		d.pit_consistency = Personnel.pit_consistency(staff)
		d.reliability_work = Personnel.reliability_work(staff)
		d.eng_skill = Personnel.engineer_telemetry(staff, i % 2)
		if g["team"]:
			d.team = true
			if i == 4:
				d.is_player = true
				d.role = "Директор"
			else:
				d.role = "Инженер"
				d.is_player = coop      # human only in co-op
		arr.append(d)
	return arr

# ============================================================================
#  TRACK GENERATION — fictional circuits sampled from real F1 archetypes.
#  Each archetype is grounded in real circuit character (Monza = power, Monaco
#  = street, Silverstone/Spa = high-speed, Barcelona = technical, modern mix).
#  The generator jitters every characteristic deterministically, so a seed
#  yields a fixed but unique calendar.
# ============================================================================
const ARCHETYPES := {
	"power":     {"laps": 53, "lt": 82.0, "abr": 0.85, "df": 0.25, "pw": 0.95, "ot": 0.72, "harv": 0.42, "dep": 0.92, "sc": 0.12, "wet": 0.20, "el": 0.57, "az": 4},
	"street":    {"laps": 58, "lt": 78.0, "abr": 0.80, "df": 0.95, "pw": 0.45, "ot": 0.20, "harv": 0.78, "dep": 0.42, "sc": 0.55, "wet": 0.20, "el": 0.97, "az": 1},
	"highspeed": {"laps": 44, "lt": 98.0, "abr": 1.22, "df": 0.82, "pw": 0.74, "ot": 0.66, "harv": 0.55, "dep": 0.70, "sc": 0.18, "wet": 0.35, "el": 0.72, "az": 3},
	"technical": {"laps": 50, "lt": 80.0, "abr": 1.15, "df": 0.85, "pw": 0.50, "ot": 0.42, "harv": 0.66, "dep": 0.50, "sc": 0.20, "wet": 0.25, "el": 0.91, "az": 1},
	"modern":    {"laps": 50, "lt": 90.0, "abr": 1.00, "df": 0.55, "pw": 0.72, "ot": 0.76, "harv": 0.70, "dep": 0.76, "sc": 0.30, "wet": 0.20, "el": 0.75, "az": 3},
}
const ARCH_NAMES := {
	"power":     ["Velocità Park", "Nord Autodrome"],
	"street":    ["Harbour Streets", "Bayfront Night"],
	"highspeed": ["Green Hills", "Ardennes Forest"],
	"technical": ["Catalan Heights", "Estoril Rise"],
	"modern":    ["Desert Mile", "Marina Circuit"],
}
const ARCH_ORDER := ["power", "street", "highspeed", "technical", "modern"]
const ARCH_LABELS := {
	"power": "силовая", "street": "уличная", "highspeed": "скоростная",
	"technical": "техничная", "modern": "современная", "mixed": "смешанная",
}

static func _jit(r: RNG, v: float, frac: float, lo: float = 0.0, hi: float = 1.0) -> float:
	return clampf(v * (1.0 + r.rangef(-frac, frac)), lo, hi)

static func generate_track(seed_value: int, archetype: String = "") -> Track:
	var r := RNG.new(seed_value)
	var arch := archetype
	if arch == "" or not ARCHETYPES.has(arch):
		arch = ARCH_ORDER[r.next_u32() % ARCH_ORDER.size()]
	var a: Dictionary = ARCHETYPES[arch]
	var t := Track.new()
	t.archetype = arch
	var names: Array = ARCH_NAMES[arch]
	t.name = names[r.next_u32() % names.size()]
	t.laps = int(round(a["laps"] * (1.0 + r.rangef(-0.08, 0.08))))
	t.base_laptime = a["lt"] * (1.0 + r.rangef(-0.05, 0.05))
	t.pit_lane = clampf(0.04 + r.rangef(0.0, 0.05), 0.03, 0.09)
	t.pit_loss = PIT_BASE + t.pit_lane * PIT_LANE_K
	t.abrasion = _jit(r, a["abr"], 0.10, 0.6, 1.4)
	t.downforce = _jit(r, a["df"], 0.08)
	t.power = _jit(r, a["pw"], 0.08)
	t.overtaking = _jit(r, a["ot"], 0.10)
	t.harvest = _jit(r, a["harv"], 0.10)
	t.deploy = _jit(r, a["dep"], 0.08)
	t.sc_prob = a["sc"]
	t.wet_prob = a["wet"]
	t.energy_limit = _jit(r, float(a["el"]), 0.08, 0.45, 1.0)
	t.aero_zones = int(a["az"])
	t.track_temp = clampf(30.0 + r.rangef(-7.0, 12.0), 15.0, 45.0)
	t.air_temp = t.track_temp - 9.0
	_build_default_sectors(t)
	t._build_mini_bounds()
	return t

# A varied championship calendar: one of each archetype, cycling if n > 5.
static func generate_calendar(seed_value: int, n: int = 5) -> Array:
	var r := RNG.new(seed_value)
	var cal: Array = []
	for i in n:
		var arch: String = ARCH_ORDER[i % ARCH_ORDER.size()]
		cal.append(generate_track(seed_value + i * 7919 + int(r.next_u32() % 1000), arch))
	return cal

# ============================================================================
#  REAL CIRCUITS — named tracks with researched 2026 characteristics.
#  Each row's numbers come from real circuit data (downforce / power /
#  overtaking difficulty / Pirelli abrasion / energy harvest+deploy / SC + wet
#  probability). `arch` reuses the existing label keys so the UI needs no change.
# ============================================================================
# Track surface temperature (°C) per real circuit — drives the tyre warm-up window.
const TRACK_TEMPS := {
	"Монако": 32.0, "Монца": 34.0, "Спа": 21.0, "Сильверстоун": 25.0,
	"Сингапур": 33.0, "Бахрейн": 40.0, "Хунгароринг": 43.0, "Сузука": 27.0,
	"Баку": 31.0, "Зандворт": 23.0,
	"Джидда": 30.0, "Мельбурн": 24.0, "Шанхай": 22.0, "Майами": 32.0, "Имола": 25.0,
	"Монреаль": 24.0, "Барселона": 30.0, "Шпильберг": 28.0, "Остин": 30.0, "Мехико": 24.0,
	"Интерлагос": 26.0, "Лас-Вегас": 18.0, "Лусаил": 33.0, "Яс-Марина": 30.0, "Мадрид": 28.0,
}

# Pit-lane length per circuit (fraction of a lap). Drives both the time lost in
# the pits (PIT_BASE + lane×PIT_LANE_K) and the lane drawn on the minimap — long
# at Singapore/Monaco, short at Monza.
const TRACK_PIT_LANES := {
	"Монако": 0.079, "Монца": 0.043, "Спа": 0.046, "Сильверстоун": 0.057,
	"Сингапур": 0.089, "Бахрейн": 0.064, "Хунгароринг": 0.054, "Сузука": 0.064,
	"Баку": 0.050, "Зандворт": 0.057,
	"Джидда": 0.050, "Мельбурн": 0.052, "Шанхай": 0.057, "Майами": 0.060, "Имола": 0.058,
	"Монреаль": 0.050, "Барселона": 0.055, "Шпильберг": 0.050, "Остин": 0.058, "Мехико": 0.052,
	"Интерлагос": 0.050, "Лас-Вегас": 0.052, "Лусаил": 0.060, "Яс-Марина": 0.058, "Мадрид": 0.058,
}

# Real circuit lengths (km) — used only to turn a laptime into a km/h readout.
const TRACK_LENGTHS_KM := {
	"Монако": 3.337, "Монца": 5.793, "Спа": 7.004, "Сильверстоун": 5.891,
	"Сингапур": 4.940, "Бахрейн": 5.412, "Хунгароринг": 4.381, "Сузука": 5.807,
	"Баку": 6.003, "Зандворт": 4.259,
	"Джидда": 6.174, "Мельбурн": 5.278, "Шанхай": 5.451, "Майами": 5.412, "Имола": 4.909,
	"Монреаль": 4.361, "Барселона": 4.657, "Шпильберг": 4.318, "Остин": 5.513, "Мехико": 4.304,
	"Интерлагос": 4.309, "Лас-Вегас": 6.201, "Лусаил": 5.419, "Яс-Марина": 5.281, "Мадрид": 5.474,
}

# How much each track rubbers-in over a race (0..1). Street/low-grip surfaces
# start "green" and gain the most; established high-grip permanents gain least.
const TRACK_EVOLUTION := {
	"Монако": 0.90, "Монца": 0.40, "Спа": 0.42, "Сильверстоун": 0.45,
	"Сингапур": 0.88, "Бахрейн": 0.55, "Хунгароринг": 0.55, "Сузука": 0.45,
	"Баку": 0.72, "Зандворт": 0.50,
	"Джидда": 0.72, "Мельбурн": 0.65, "Шанхай": 0.55, "Майами": 0.68, "Имола": 0.50,
	"Монреаль": 0.60, "Барселона": 0.45, "Шпильберг": 0.50, "Остин": 0.55, "Мехико": 0.58,
	"Интерлагос": 0.55, "Лас-Вегас": 0.75, "Лусаил": 0.50, "Яс-Марина": 0.55, "Мадрид": 0.70,
}

# Real circuit geometry: corner count + longest straight (km). Flavour now;
# the foundation for the upcoming segment model (Direction B).
const TRACK_CORNERS := {
	"Монако": 19, "Монца": 11, "Спа": 19, "Сильверстоун": 18, "Сингапур": 19,
	"Бахрейн": 15, "Хунгароринг": 14, "Сузука": 18, "Баку": 20, "Зандворт": 14,
	"Джидда": 27, "Мельбурн": 14, "Шанхай": 16, "Майами": 19, "Имола": 19,
	"Монреаль": 14, "Барселона": 14, "Шпильберг": 10, "Остин": 20, "Мехико": 17,
	"Интерлагос": 15, "Лас-Вегас": 17, "Лусаил": 16, "Яс-Марина": 16, "Мадрид": 22,
}
const TRACK_STRAIGHT_KM := {
	"Монако": 0.67, "Монца": 1.10, "Спа": 1.00, "Сильверстоун": 0.77,
	"Сингапур": 0.83, "Бахрейн": 1.06, "Хунгароринг": 0.91, "Сузука": 0.89,
	"Баку": 2.20, "Зандворт": 0.70,
	"Джидда": 1.10, "Мельбурн": 0.90, "Шанхай": 1.17, "Майами": 1.10, "Имола": 0.65,
	"Монреаль": 1.00, "Барселона": 1.05, "Шпильберг": 0.95, "Остин": 1.00, "Мехико": 1.20,
	"Интерлагос": 0.95, "Лас-Вегас": 1.90, "Лусаил": 1.05, "Яс-Марина": 1.00, "Мадрид": 1.00,
}

# Per-circuit sector boundaries and character. Sector bounds = lap_frac where S1 ends,
# then where S2 ends. Chars: power/aero bias + DRS availability per sector.
# Research basis: real F1 sector timing maps (S1/S2/S3 boundaries per circuit).
static var SECTOR_BOUNDS: Dictionary = {
	"Монако":       [0.36, 0.65],
	"Монца":        [0.33, 0.67],
	"Спа":          [0.34, 0.68],
	"Сильверстоун": [0.35, 0.70],
	"Сингапур":     [0.38, 0.70],
	"Бахрейн":      [0.35, 0.70],
	"Хунгароринг":  [0.38, 0.72],
	"Сузука":       [0.38, 0.72],
	"Баку":         [0.35, 0.68],
	"Зандворт":     [0.38, 0.72],
}

# {power, aero, harvest, drs} per S1/S2/S3. Values shape AI ERS decisions and
# DRS eligibility; they don't change current_laptime() (balance stays intact).
static var SECTOR_CHARS: Dictionary = {
	"Монако": [
		{"power": 0.15, "aero": 0.95, "harvest": 0.75, "drs": false},
		{"power": 0.35, "aero": 0.75, "harvest": 0.70, "drs": false},
		{"power": 0.20, "aero": 0.90, "harvest": 0.80, "drs": false},
	],
	"Монца": [
		{"power": 0.75, "aero": 0.25, "harvest": 0.45, "drs": false},
		{"power": 0.97, "aero": 0.15, "harvest": 0.38, "drs": true},
		{"power": 0.90, "aero": 0.20, "harvest": 0.40, "drs": true},
	],
	"Спа": [
		{"power": 0.88, "aero": 0.60, "harvest": 0.50, "drs": true},
		{"power": 0.70, "aero": 0.75, "harvest": 0.58, "drs": false},
		{"power": 0.80, "aero": 0.50, "harvest": 0.55, "drs": true},
	],
	"Сильверстоун": [
		{"power": 0.50, "aero": 0.90, "harvest": 0.55, "drs": false},
		{"power": 0.70, "aero": 0.55, "harvest": 0.58, "drs": true},
		{"power": 0.55, "aero": 0.75, "harvest": 0.60, "drs": false},
	],
	"Сингапур": [
		{"power": 0.30, "aero": 0.88, "harvest": 0.80, "drs": false},
		{"power": 0.35, "aero": 0.90, "harvest": 0.82, "drs": false},
		{"power": 0.45, "aero": 0.85, "harvest": 0.78, "drs": true},
	],
	"Бахрейн": [
		{"power": 0.70, "aero": 0.55, "harvest": 0.68, "drs": true},
		{"power": 0.55, "aero": 0.75, "harvest": 0.72, "drs": false},
		{"power": 0.75, "aero": 0.45, "harvest": 0.65, "drs": true},
	],
	"Хунгароринг": [
		{"power": 0.30, "aero": 0.88, "harvest": 0.65, "drs": false},
		{"power": 0.25, "aero": 0.92, "harvest": 0.68, "drs": false},
		{"power": 0.40, "aero": 0.80, "harvest": 0.62, "drs": true},
	],
	"Сузука": [
		{"power": 0.55, "aero": 0.85, "harvest": 0.52, "drs": false},
		{"power": 0.68, "aero": 0.62, "harvest": 0.55, "drs": true},
		{"power": 0.50, "aero": 0.80, "harvest": 0.58, "drs": false},
	],
	"Баку": [
		{"power": 0.97, "aero": 0.20, "harvest": 0.58, "drs": true},
		{"power": 0.30, "aero": 0.85, "harvest": 0.68, "drs": false},
		{"power": 0.90, "aero": 0.30, "harvest": 0.62, "drs": true},
	],
	"Зандворт": [
		{"power": 0.35, "aero": 0.90, "harvest": 0.60, "drs": false},
		{"power": 0.45, "aero": 0.88, "harvest": 0.62, "drs": false},
		{"power": 0.48, "aero": 0.85, "harvest": 0.58, "drs": true},
	],
}

const REAL_TRACKS := [
	{"name": "Монако",       "arch": "street",    "laps": 78, "lt":  73.5, "pit": 24.0, "df": 0.97, "pw": 0.20, "ot": 0.05, "abr": 0.70, "harv": 0.78, "dep": 0.40, "sc": 0.65, "wet": 0.25, "el": 1.00, "az": 0},
	{"name": "Монца",        "arch": "power",     "laps": 53, "lt":  81.5, "pit": 19.0, "df": 0.15, "pw": 0.97, "ot": 0.82, "abr": 0.85, "harv": 0.38, "dep": 0.95, "sc": 0.18, "wet": 0.20, "el": 0.55, "az": 4},
	{"name": "Спа",          "arch": "highspeed", "laps": 44, "lt": 106.0, "pit": 19.5, "df": 0.42, "pw": 0.88, "ot": 0.72, "abr": 1.18, "harv": 0.55, "dep": 0.88, "sc": 0.30, "wet": 0.45, "el": 0.65, "az": 3},
	{"name": "Сильверстоун", "arch": "highspeed", "laps": 52, "lt":  88.0, "pit": 21.0, "df": 0.85, "pw": 0.62, "ot": 0.55, "abr": 1.28, "harv": 0.58, "dep": 0.60, "sc": 0.22, "wet": 0.40, "el": 0.80, "az": 2},
	{"name": "Сингапур",     "arch": "street",    "laps": 62, "lt":  94.0, "pit": 25.5, "df": 0.92, "pw": 0.40, "ot": 0.18, "abr": 0.82, "harv": 0.80, "dep": 0.48, "sc": 0.85, "wet": 0.35, "el": 0.95, "az": 1},
	{"name": "Бахрейн",      "arch": "modern",    "laps": 57, "lt":  92.0, "pit": 22.0, "df": 0.55, "pw": 0.72, "ot": 0.78, "abr": 1.25, "harv": 0.70, "dep": 0.78, "sc": 0.20, "wet": 0.05, "el": 0.70, "az": 3},
	{"name": "Хунгароринг",  "arch": "technical", "laps": 70, "lt":  78.0, "pit": 20.5, "df": 0.90, "pw": 0.35, "ot": 0.12, "abr": 0.92, "harv": 0.66, "dep": 0.42, "sc": 0.35, "wet": 0.30, "el": 0.98, "az": 1},
	{"name": "Сузука",       "arch": "technical", "laps": 53, "lt":  91.0, "pit": 22.0, "df": 0.82, "pw": 0.58, "ot": 0.40, "abr": 1.30, "harv": 0.55, "dep": 0.55, "sc": 0.25, "wet": 0.40, "el": 0.85, "az": 2},
	{"name": "Баку",         "arch": "power",     "laps": 51, "lt": 103.0, "pit": 20.0, "df": 0.30, "pw": 0.95, "ot": 0.80, "abr": 0.80, "harv": 0.62, "dep": 0.92, "sc": 0.60, "wet": 0.15, "el": 0.58, "az": 4},
	{"name": "Зандворт",     "arch": "technical", "laps": 72, "lt":  72.0, "pit": 21.0, "df": 0.88, "pw": 0.45, "ot": 0.20, "abr": 1.27, "harv": 0.60, "dep": 0.45, "sc": 0.30, "wet": 0.45, "el": 0.92, "az": 1},
	{"name": "Джидда",       "arch": "highspeed", "laps": 50, "lt":  91.0, "pit": 20.0, "df": 0.40, "pw": 0.85, "ot": 0.55, "abr": 0.75, "harv": 0.50, "dep": 0.85, "sc": 0.70, "wet": 0.05, "el": 0.62, "az": 3},
	{"name": "Мельбурн",     "arch": "modern",    "laps": 58, "lt":  82.0, "pit": 21.0, "df": 0.55, "pw": 0.62, "ot": 0.45, "abr": 0.85, "harv": 0.58, "dep": 0.65, "sc": 0.50, "wet": 0.30, "el": 0.72, "az": 3},
	{"name": "Шанхай",       "arch": "modern",    "laps": 56, "lt":  95.0, "pit": 21.0, "df": 0.60, "pw": 0.68, "ot": 0.62, "abr": 1.05, "harv": 0.62, "dep": 0.72, "sc": 0.30, "wet": 0.35, "el": 0.70, "az": 2},
	{"name": "Майами",       "arch": "modern",    "laps": 57, "lt":  91.0, "pit": 22.0, "df": 0.55, "pw": 0.70, "ot": 0.58, "abr": 0.90, "harv": 0.60, "dep": 0.74, "sc": 0.45, "wet": 0.20, "el": 0.68, "az": 3},
	{"name": "Имола",        "arch": "technical", "laps": 63, "lt":  80.0, "pit": 21.0, "df": 0.72, "pw": 0.58, "ot": 0.20, "abr": 1.10, "harv": 0.55, "dep": 0.55, "sc": 0.35, "wet": 0.40, "el": 0.82, "az": 1},
	{"name": "Монреаль",     "arch": "power",     "laps": 70, "lt":  76.0, "pit": 20.0, "df": 0.45, "pw": 0.82, "ot": 0.65, "abr": 0.85, "harv": 0.66, "dep": 0.85, "sc": 0.55, "wet": 0.35, "el": 0.62, "az": 3},
	{"name": "Барселона",    "arch": "technical", "laps": 66, "lt":  80.0, "pit": 21.5, "df": 0.82, "pw": 0.55, "ot": 0.30, "abr": 1.25, "harv": 0.58, "dep": 0.55, "sc": 0.25, "wet": 0.30, "el": 0.82, "az": 2},
	{"name": "Шпильберг",    "arch": "power",     "laps": 71, "lt":  70.0, "pit": 20.0, "df": 0.45, "pw": 0.80, "ot": 0.60, "abr": 1.10, "harv": 0.62, "dep": 0.82, "sc": 0.30, "wet": 0.40, "el": 0.65, "az": 3},
	{"name": "Остин",        "arch": "highspeed", "laps": 56, "lt":  99.0, "pit": 21.0, "df": 0.70, "pw": 0.62, "ot": 0.55, "abr": 1.20, "harv": 0.58, "dep": 0.62, "sc": 0.30, "wet": 0.30, "el": 0.78, "az": 2},
	{"name": "Мехико",       "arch": "power",     "laps": 71, "lt":  80.0, "pit": 20.5, "df": 0.50, "pw": 0.72, "ot": 0.55, "abr": 0.80, "harv": 0.55, "dep": 0.78, "sc": 0.40, "wet": 0.20, "el": 0.62, "az": 3},
	{"name": "Интерлагос",   "arch": "highspeed", "laps": 71, "lt":  75.0, "pit": 20.0, "df": 0.62, "pw": 0.68, "ot": 0.60, "abr": 1.05, "harv": 0.62, "dep": 0.70, "sc": 0.40, "wet": 0.45, "el": 0.70, "az": 2},
	{"name": "Лас-Вегас",    "arch": "power",     "laps": 50, "lt":  95.0, "pit": 20.0, "df": 0.25, "pw": 0.95, "ot": 0.70, "abr": 0.80, "harv": 0.55, "dep": 0.92, "sc": 0.55, "wet": 0.10, "el": 0.58, "az": 4},
	{"name": "Лусаил",       "arch": "highspeed", "laps": 57, "lt":  84.0, "pit": 22.0, "df": 0.78, "pw": 0.60, "ot": 0.40, "abr": 1.30, "harv": 0.55, "dep": 0.58, "sc": 0.25, "wet": 0.05, "el": 0.80, "az": 2},
	{"name": "Яс-Марина",    "arch": "modern",    "laps": 58, "lt":  86.0, "pit": 21.0, "df": 0.65, "pw": 0.62, "ot": 0.45, "abr": 0.85, "harv": 0.62, "dep": 0.68, "sc": 0.30, "wet": 0.05, "el": 0.72, "az": 3},
	{"name": "Мадрид",       "arch": "modern",    "laps": 57, "lt":  88.0, "pit": 21.0, "df": 0.60, "pw": 0.65, "ot": 0.50, "abr": 0.95, "harv": 0.60, "dep": 0.70, "sc": 0.45, "wet": 0.20, "el": 0.70, "az": 3},
]

# Build the segment profile (straights + corners) for a track from its geometry.
# Deterministic. frac 0 starts on the main (pit) straight, then corners alternate
# with minor straights. High-power tracks get more straight; high-downforce tracks
# get heavier (slower, more dirty-air) corners.
static func _build_segments(t: Track) -> void:
	var nc: int = clampi(t.corners, 6, 24)
	var total_straight: float = clampf(0.15 + 0.40 * t.power, 0.18, 0.55)
	var main_straight: float = clampf(t.straight_km / maxf(t.length_km, 0.1), 0.10, 0.32)
	main_straight = minf(main_straight, total_straight * 0.7)
	var n_minor: int = maxi(1, nc - 1)
	var minor_each: float = maxf(0.0, total_straight - main_straight) / float(n_minor)
	var corner_each: float = (1.0 - total_straight) / float(nc)
	var segs: Array = []
	segs.append({"kind": "straight", "frac": main_straight, "intensity": 1.0})   # main/pit straight
	for i in range(nc):
		segs.append({"kind": "corner", "frac": corner_each, "intensity": clampf(0.4 + 0.6 * t.downforce, 0.0, 1.0)})
		if i < n_minor:
			segs.append({"kind": "straight", "frac": minor_each, "intensity": 0.5})
	var sum := 0.0
	for s in segs:
		sum += float(s["frac"])
	sum = maxf(sum, 0.0001)
	var acc := 0.0
	for s in segs:
		s["frac"] = float(s["frac"]) / sum
		s["start"] = acc
		acc += float(s["frac"])
	t.segments = segs
	t.straight_frac = total_straight

# Default sector model for generated (fictional) tracks. Uses the archetype's
# power/downforce/harvest to infer per-sector character. S2 always gets DRS.
static func _build_default_sectors(t: Track) -> void:
	t.sector_bounds = [0.33, 0.67]
	var p := t.power
	var a := t.downforce
	var h := t.harvest
	t.sector_chars = [
		{"power": clampf(p * 0.7, 0.0, 1.0), "aero": clampf(a * 1.1, 0.0, 1.0), "harvest": clampf(h * 1.1, 0.0, 1.0), "drs": false},
		{"power": clampf(p * 1.3, 0.0, 1.0), "aero": clampf(a * 0.8, 0.0, 1.0), "harvest": clampf(h * 0.8, 0.0, 1.0), "drs": true},
		{"power": p, "aero": a, "harvest": h, "drs": false},
	]

static func real_track(i: int) -> Track:
	var a: Dictionary = REAL_TRACKS[i % REAL_TRACKS.size()]
	var t := Track.new()
	t.name = a["name"]
	t.archetype = a["arch"]
	t.laps = int(a["laps"])
	t.base_laptime = float(a["lt"])
	t.pit_lane = float(TRACK_PIT_LANES.get(a["name"], 0.055))
	t.pit_loss = PIT_BASE + t.pit_lane * PIT_LANE_K
	t.downforce = float(a["df"])
	t.power = float(a["pw"])
	t.overtaking = float(a["ot"])
	t.abrasion = float(a["abr"])
	t.harvest = float(a["harv"])
	t.deploy = float(a["dep"])
	t.sc_prob = float(a["sc"])
	t.wet_prob = float(a["wet"])
	t.energy_limit = float(a.get("el", 0.80))
	t.aero_zones = int(a.get("az", 2))
	t.length_km = float(TRACK_LENGTHS_KM.get(a["name"], t.base_laptime / 16.5))
	t.evolution = float(TRACK_EVOLUTION.get(a["name"], 0.5))
	t.corners = int(TRACK_CORNERS.get(a["name"], 15))
	t.straight_km = float(TRACK_STRAIGHT_KM.get(a["name"], 0.9))
	_build_segments(t)
	# Sector model
	if SECTOR_BOUNDS.has(t.name):
		t.sector_bounds = Array(SECTOR_BOUNDS[t.name])
		t.sector_chars  = Array(SECTOR_CHARS[t.name])
	else:
		_build_default_sectors(t)
	t._build_mini_bounds()
	t.track_temp = float(TRACK_TEMPS.get(a["name"], 30.0))
	t.air_temp = t.track_temp - 9.0
	return t

# A varied calendar of n real circuits, deterministically selected from the seed.
static func real_calendar(seed_value: int, n: int = 5) -> Array:
	var r := RNG.new(mix32(seed_value))
	var idx: Array = []
	for i in REAL_TRACKS.size():
		idx.append(i)
	for i in range(idx.size() - 1, 0, -1):     # Fisher-Yates shuffle (seed-stable)
		var j: int = r.next_u32() % (i + 1)
		var tmp: int = idx[i]
		idx[i] = idx[j]
		idx[j] = tmp
	var cal: Array = []
	for i in mini(n, idx.size()):
		cal.append(real_track(idx[i]))
	return cal
