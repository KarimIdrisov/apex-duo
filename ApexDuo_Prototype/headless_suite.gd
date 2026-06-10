extends SceneTree
# Headless balance suite: full races on reference tracks, corridor stats as
# JSON lines. Run (no MCP cap, one process):
#   godot --headless --path ApexDuo_Prototype --script res://headless_suite.gd
# Corridors (memory/balance-baseline + ai-brain-v2): Monaco passes <=5,
# Monza 17-37 (no-SC lower edge), winners top teams, order() violations 0.


func _run_race(ti: int, seed_v: int) -> Dictionary:
	var rs := load("res://race_sim.gd")
	var track = rs.real_track(ti)
	var field = rs.make_field(false, 1)
	var sim = rs.new(track, field, seed_v)
	var ticks := 0
	while not sim.finished and ticks < 200000:
		sim.step(0.25)
		ticks += 1
	var passes := 0
	var dnfs := 0
	var pits := 0
	var plan2 := 0
	var two_stop := 0
	var soc_sum := 0.0
	var nfin := 0
	for d in sim.drivers:
		passes += d.passes_made
		pits += d.pit_count
		if d.pit_plan >= 2:
			plan2 += 1
		if d.pit_count >= 2:
			two_stop += 1
		if d.dnf:
			dnfs += 1
		else:
			soc_sum += d.soc
			nfin += 1
	var covers: int = sim.covers_called
	var sq_min := 1.0
	var sq_max := 0.0
	for d in sim.drivers:
		sq_min = minf(sq_min, d.setup_q)
		sq_max = maxf(sq_max, d.setup_q)
	var ord: Array = sim.order()
	var viol := 0
	for i in range(ord.size() - 1):
		if sim._cmp_position(ord[i + 1], ord[i]):
			viol += 1
	return {
		"track": track.name, "seed": seed_v, "passes": passes, "dnfs": dnfs,
		"avg_pits": snappedf(float(pits) / float(sim.drivers.size()), 0.01),
		"plan2": plan2, "two_stoppers": two_stop, "covers": covers,
		"fin_soc": snappedf(soc_sum / float(max(1, nfin)), 0.1),
		"winner": ord[0].name, "p2": ord[1].name,
		"win_gap": snappedf(ord[1].finish_key - ord[0].finish_key, 0.01),
		"sort_violations": viol, "sc": sim.sc_done,
		"setup_q": [snappedf(sq_min, 0.01), snappedf(sq_max, 0.01)],
	}


func _initialize() -> void:
	for cfg in [[0, 31337], [1, 32337], [1, 40256], [3, 34337]]:
		print(JSON.stringify(_run_race(cfg[0], cfg[1])))
	quit()
