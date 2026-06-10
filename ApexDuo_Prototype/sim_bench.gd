extends SceneTree
# Headless real-engine race-runner (SIM-VER). Runs full RaceSim races across all
# real tracks × many seeds and reports the metrics the Python harness CANNOT judge
# (overtaking, dirty-air, weather, SC) — per CLAUDE.md. Throwaway dev tool.
# Run:  godot --headless --path <proj> --script res://sim_bench.gd

const SEEDS := 12
const STEP := 0.25
# Target corridors (CLAUDE.md / README). Only Monaco & Monza are pinned; others
# are reference. SC%/wet% targets are each track's own sc_prob/wet_prob.
const OT_TARGET := {              # [min, max] overtakes/race
	"Монако": [1, 6], "Монца": [60, 110],
}

func _initialize() -> void:
	var RS = load("res://race_sim.gd")
	print("=== Apex Duo SIM-VER — real engine, %d seeds/track ===" % SEEDS)
	print("track          | ovt avg [min..max] | pole→win | avgGrid | DNF avg | SC%% (prob) | wet%% (prob) | laps")

	# determinism spot-check: same seed twice → identical result
	var det_ok := _determinism_check(RS)

	for ti in range(10):
		var ot_sum := 0.0
		var ot_min := 1000000
		var ot_max := 0
		var pole_wins := 0
		var grid_sum := 0.0
		var dnf_sum := 0.0
		var sc_count := 0
		var wet_count := 0
		var tname := ""
		var tlaps := 0
		var tscp := 0.0
		var twp := 0.0
		for s in range(SEEDS):
			var track = RS.real_track(ti)
			tname = track.name
			tlaps = track.laps
			tscp = track.sc_prob
			twp = track.wet_prob
			var field = RS.make_field(false, 1)
			var sim = RS.new(track, field, 7000 + s)
			var guard := 0
			while not sim.finished and guard < 300000:
				sim.step(STEP)
				guard += 1
			var ot := 0
			var dnf := 0
			for d in sim.drivers:
				ot += d.passes_made
				if d.dnf:
					dnf += 1
			ot_sum += ot
			ot_min = mini(ot_min, ot)
			ot_max = maxi(ot_max, ot)
			dnf_sum += dnf
			if sim.sc_deploy_lap >= 0:
				sc_count += 1
			if sim.wet_start <= 1.0:
				wet_count += 1
			var ordered = sim.order()
			var winner = ordered[0]
			grid_sum += float(winner.grid_pos)
			if winner.grid_pos == 1:
				pole_wins += 1
		var ot_avg := ot_sum / float(SEEDS)
		var pole_pct := 100.0 * float(pole_wins) / float(SEEDS)
		var sc_pct := 100.0 * float(sc_count) / float(SEEDS)
		var wet_pct := 100.0 * float(wet_count) / float(SEEDS)
		var flag := ""
		if OT_TARGET.has(tname):
			var lo: int = OT_TARGET[tname][0]
			var hi: int = OT_TARGET[tname][1]
			flag = "  [target %d..%d %s]" % [lo, hi, "OK" if (ot_avg >= lo and ot_avg <= hi) else "OFF"]
		print("%-14s | %5.1f [%3d..%3d]   |  %5.1f%%  |  %5.2f  |  %5.2f  | %3.0f%% (%2.0f) | %3.0f%% (%2.0f) | %3d%s" % [
			tname, ot_avg, ot_min, ot_max, pole_pct, grid_sum / float(SEEDS),
			dnf_sum / float(SEEDS), sc_pct, tscp * 100.0, wet_pct, twp * 100.0, tlaps, flag])

	print("determinism (same seed → same race): %s" % ("OK" if det_ok else "*** FAIL ***"))
	print("=== done ===")
	quit()

func _determinism_check(RS) -> bool:
	var a = _one(RS, 0, 7001)
	var b = _one(RS, 0, 7001)
	var c = _one(RS, 0, 7002)
	return a == b and a != c

func _one(RS, ti: int, seed_v: int) -> String:
	var track = RS.real_track(ti)
	var field = RS.make_field(false, 1)
	var sim = RS.new(track, field, seed_v)
	var guard := 0
	while not sim.finished and guard < 300000:
		sim.step(STEP)
		guard += 1
	var ot := 0
	for d in sim.drivers:
		ot += d.passes_made
	var w = sim.order()[0]
	return "%d:%d:%d" % [w.id, w.grid_pos, ot]
