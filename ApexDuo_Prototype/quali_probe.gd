extends SceneTree
# Verifies the rewritten QualiSim "release & watch" logic on the real engine:
# a full solo session (all AI) runs to a 22-car grid, times are sane, the run is
# deterministic, and parc_ferme would trip on first release.
# Run: godot --headless --path . --script res://quali_probe.gd


func _run(seed_v: int) -> Dictionary:
	var rs := load("res://race_sim.gd")
	var qs := load("res://quali_sim.gd")
	var track = rs.real_track(1)
	var field = rs.make_field(false, 1)   # has 2 player cars (4,5) — but no manual release
	var sim = rs.new(track, field, seed_v)
	# make the player cars AI for this probe so they auto-release (no human input)
	for d in sim.drivers:
		d.is_player = false
	var q = qs.new(sim.drivers, seed_v)
	q.set_track(track)
	var ticks := 0
	var first_release_tick := -1
	while not q.finished and ticks < 4000:
		q.tick(0.25)
		ticks += 1
		if first_release_tick < 0 and q.first_release_done:
			first_release_tick = ticks
	# how many cars actually set a (negative) score this session?
	var n_timed := 0
	var tmin := 1e9
	var tmax := -1e9
	for k in q.times:
		var tv: float = float(q.times[k])
		if tv < -0.001 or tv > 0.001:   # any non-zero — quali scores are ~negative
			n_timed += 1
			tmin = minf(tmin, tv)
			tmax = maxf(tmax, tv)
	print(JSON.stringify({"dbg_seed": seed_v, "n_timed": n_timed,
		"tmin": snappedf(tmin, 0.001), "tmax": snappedf(tmax, 0.001),
		"sample_runs": int(q.runs.get(int(q.grid_ids[0]), -1))}))
	# grid sanity
	var pole_t := float(q.times.get(int(q.grid_ids[0]), -1.0)) if q.grid_ids.size() > 0 else -1.0
	var p10_t := float(q.times.get(int(q.grid_ids[9]), -1.0)) if q.grid_ids.size() > 9 else -1.0
	return {
		"seed": seed_v, "grid": q.grid_ids.size(), "finished": q.finished,
		"first_release_tick": first_release_tick,
		"pole_id": q.grid_ids[0] if q.grid_ids.size() > 0 else -1,
		"pole_t": snappedf(pole_t, 0.001), "p10_t": snappedf(p10_t, 0.001),
		"spread_p1_p10": snappedf(p10_t - pole_t, 0.001),
	}


func _initialize() -> void:
	var a := _run(31337)
	var b := _run(31337)   # determinism: same seed → same pole
	print(JSON.stringify(a))
	print(JSON.stringify(_run(32337)))
	print(JSON.stringify({"deterministic": a["pole_id"] == b["pole_id"] and a["pole_t"] == b["pole_t"]}))
	quit()
