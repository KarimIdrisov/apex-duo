extends SceneTree
# Battery v0.6 verification probe (gates A-B). Forces one ERS mode per car by
# subclassing RaceSim and overriding _ai_energy (the step-order gotcha: _ai_energy
# re-picks ers_mode each tick before _update_soc, so pinning d.ers_mode between
# steps does NOT work — must override). Measures per-lap net ΔSoC, intra-lap
# soc_min, clip-tick%, soc_avg per (track, mode).
# Run: godot --headless --path . --script res://soc_probe.gd

const TRACKS := {0: "Монако", 1: "Монца", 3: "Сильверстоун", 7: "Бахрейн"}
const MODES := ["harvest", "balanced", "attack"]


func _measure(ti: int, mode: String) -> Dictionary:
	var rs := load("res://race_sim.gd")
	var forced = load("res://soc_forced.gd")
	var track = rs.real_track(ti)
	var field = rs.make_field(false, 1)
	var sim = forced.new(track, field, 4242)
	sim.forced_mode = mode
	# pick one representative non-player midfield car
	var probe = null
	for d in sim.drivers:
		if not d.is_player:
			probe = d
			break
	var ticks := 0
	var clip_ticks := 0
	var total_ticks := 0
	var soc_sum := 0.0
	var lap_start_soc: float = probe.soc
	var lap_start_lap: int = probe.lap
	var lap_min := 999.0
	var net_sum := 0.0
	var net_n := 0
	var minlap_sum := 0.0
	while not sim.finished and ticks < 200000:
		sim.step(0.25)
		ticks += 1
		if probe.finished:
			break
		total_ticks += 1
		soc_sum += probe.soc
		if probe.clipped:
			clip_ticks += 1
		if probe.soc < lap_min:
			lap_min = probe.soc
		if probe.lap > lap_start_lap:
			# lap completed: record net delta + min, reset window (skip first 3 laps warmup)
			if probe.lap > 4:
				net_sum += (probe.soc - lap_start_soc)
				minlap_sum += lap_min
				net_n += 1
			lap_start_soc = probe.soc
			lap_start_lap = probe.lap
			lap_min = 999.0
	var n := float(max(1, net_n))
	return {
		"track": track.name, "mode": mode,
		"net_per_lap": snappedf(net_sum / n, 0.1),
		"soc_min_avg": snappedf(minlap_sum / n, 0.1),
		"soc_avg": snappedf(soc_sum / float(max(1, total_ticks)), 0.1),
		"clip_pct": snappedf(100.0 * float(clip_ticks) / float(max(1, total_ticks)), 1.0),
	}


func _initialize() -> void:
	for ti in TRACKS:
		for mode in MODES:
			print(JSON.stringify(_measure(int(ti), mode)))
	quit()
