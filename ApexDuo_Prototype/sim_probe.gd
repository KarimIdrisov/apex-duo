extends SceneTree
# Parameter probe: directly measures Δ laptime from current_laptime() when one
# input changes (driver / car / engine / weather), averaged to cancel rng noise.
# Instant (no full races). Run: godot --headless --path <proj> --script res://sim_probe.gd

const N := 3000

func _initialize() -> void:
	var RS = load("res://race_sim.gd")
	print("=== parameter probe — Δ laptime s/lap (avg %d, ahead_gap=-1) ===" % N)
	print("%-24s | Монако   | Монца    | expect" % "param")
	var sims := {}
	for ti in [0, 1]:
		var track = RS.real_track(ti)
		var field = RS.make_field(false, 1)
		sims[ti] = RS.new(track, field, 4242)
	_probe(sims, "driver skill +0.05", func(d): d.skill += 0.05, "- both (faster)")
	_probe(sims, "chassis aero +0.10", func(d): d.car_aero += 0.10, "Монако - / Монца +")
	_probe(sims, "engine power +0.10", func(d): d.car_power += 0.10, "Монако + / Монца -")
	_probe(sims, "ERS attack vs balanced", func(d): d.ers_mode = "attack", "- ; Монца меньше (тейпер)")
	_probe(sims, "compound soft", func(d): d.compound = "soft", "- both (~0.55)")
	_probe(sims, "tire_wear 25->60", func(d): d.tire_wear = 60.0, "+ both (износ/обрыв)")
	_probe(sims, "tyre_temp 0.55->0.30", func(d): d.tyre_temp = 0.30, "+ both (холодные)")
	_probe_wet(sims)
	print("=== done ===")
	quit()

func _setup(d, _track) -> void:
	d.soc = 55.0
	d.soc_avg = 55.0       # v0.6: attack ERS pace gates on soc_avg, not a budget
	d.clipped = false
	d.tyre_temp = 0.55
	d.tire_wear = 25.0
	d.fuel_laps = 20.0
	d.aero_damage = 0.0
	d.yield_laps = 0
	d.ers_mode = "balanced"
	d.pace_mode = "balanced"
	d.compound = "medium"
	d.car_power = 0.78
	d.car_aero = 0.78
	d.skill = 0.80
	d.attrs["wet"] = 13.0

func _avg(sim, d) -> float:
	var s := 0.0
	for i in range(N):
		s += sim.current_laptime(d, -1.0)
	return s / float(N)

func _probe(sims, label: String, mut: Callable, expect: String) -> void:
	var out := []
	for ti in [0, 1]:
		var sim = sims[ti]
		var d = sim.drivers[11]
		_setup(d, sim.track)
		var base := _avg(sim, d)
		mut.call(d)
		out.append(_avg(sim, d) - base)
	print("%-24s | %+7.3f | %+7.3f | %s" % [label, out[0], out[1], expect])

func _probe_wet(sims) -> void:
	var pen := []
	var relief := []
	for ti in [0, 1]:
		var sim = sims[ti]
		var d = sim.drivers[11]
		_setup(d, sim.track)
		sim.wetness = 0.0
		var dry := _avg(sim, d)
		sim.wetness = 0.6
		var wlo := _avg(sim, d)
		d.attrs["wet"] = 19.0
		var whi := _avg(sim, d)
		sim.wetness = 0.0
		pen.append(wlo - dry)
		relief.append(whi - wlo)
	print("%-24s | %+7.3f | %+7.3f | %s" % ["wetness 0.6 on slick", pen[0], pen[1], "big + (slick wet)"])
	print("%-24s | %+7.3f | %+7.3f | %s" % ["  + wet attr 13->19", relief[0], relief[1], "- (rain master)"])
