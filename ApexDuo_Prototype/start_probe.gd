extends SceneTree
# Getaway-incident rate over many seeds (build sim, step a few ticks to fire
# _race_start, read sim.start_incidents). Target ~1-1.5 incidents/race.
# Run: godot --headless --path . --script res://start_probe.gd


func _initialize() -> void:
	var rs := load("res://race_sim.gd")
	var total := 0
	var n := 40
	for i in range(n):
		var track = rs.real_track(i % 8)
		var field = rs.make_field(false, 1)
		var sim = rs.new(track, field, 70000 + i * 37)
		for _t in range(5):
			sim.step(0.25)
		total += sim.start_incidents
	print(JSON.stringify({"races": n, "total_incidents": total,
		"avg_per_race": snappedf(float(total) / float(n), 0.01)}))
	quit()
