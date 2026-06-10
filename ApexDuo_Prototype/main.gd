extends Control

# ============================================================================
# Apex Duo — prototype HUD + game loop  (Stage 2: co-op, Mode A).
#
# Modes (chosen on the start screen):
#   solo   — you drive car P5 (team lead); P6 is AI.
#   local  — local co-op on one screen: P5 (Директор) + P6 (Инженер), both human.
#   host   — LAN host; authoritative sim, broadcasts state to a joined partner.
#   client — joins a host; drives P6, renders the host's state snapshots.
#
# Networking is host-authoritative: only the host runs RaceSim; clients send
# their pace/pit commands as RPCs and render snapshots pushed by the host.
# ============================================================================

const STEP := 0.25
const BASE_LT := 90.0            # track base laptime (for client-side gap calc)
const PORT := 24555
const SNAPSHOT_HZ := 12.0
# Palette aliases — values now come from Palette (theme.gd).
const ACCENT    := Palette.WINE
const TEAM_COL  := Palette.P5
const ENGI_COL  := Palette.P6
const BG        := Palette.BG
const PANEL     := Palette.PANEL

var game_mode := ""              # "", "solo", "local", "host", "client"
var sim: RaceSim
var sim_accum := 0.0
var net_accum := 0.0
var speed := 1.0
var paused := false
var seed_value := 12345

# pre-race tyre modal
var pre_race_open := false            # true while the modal is visible
var pre_race_panel: Control           # reference to the modal (freed on close)
var start_comp_choices := {}          # car_id -> chosen compound string (local/host choices)
var _client_quali_rows: Array = []    # client: rows received via net_quali_rows RPC
var _quali_list_container: Control    # reference to the quali VBox inside the open modal

# networking
var my_car_id := 4               # host/solo default; client gets assigned 5
var partner_connected := false
var snapshot := {}               # client: latest state from host

# UI
var menu_overlay: Control
var race_root: Control
var status_label: Label
var net_label: Label
var msg_label: Label
var board_rows: Array = []
var feed_rows: Array = []        # event-feed Labels (7 rows, newest-first)
var panels: Array = []           # [{id, role, name_label, tire_label, wear_bar, pace_buttons{}, controllable}]
var ip_input: LineEdit
var paddock_btn: Button          # season: return to paddock (visible when round done)
var season_race := false         # this race is part of a Season
var fast_to_end := false         # quick-sim: run the race to the finish instantly
var _track_char_set := false     # true once the track character strip has been populated
var team_gap_label: Label        # inter-team-car gap on the tactics panel
var track_char_label: RichTextLabel  # 2026 energy/aero track character strip (set once at race start)
var track_map: TrackMap          # live circuit minimap with moving cars
var race_view_3d: RaceView3D     # optional 3D race view (toggle from the HUD)
var view_3d_btn: Button          # 2D ↔ 3D toggle button
var view_is_3d := false          # which race view is currently shown

# ---------------------------------------------------------------- lifecycle
func _ready() -> void:
	theme = Palette.base_theme()
	add_child(Palette.vignette_layer())
	_build_bg()
	race_root = Control.new()
	race_root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	race_root.visible = false
	add_child(race_root)
	_build_race_ui(race_root)
	# Coming back from the paddock to run a season round? Skip the menu.
	if Season.active != null and Season.active.race_pending:
		Season.active.race_pending = false
		season_race = true
		# Online-season host: start the race and notify the client.
		if Net.role() == "host":
			_start("host")
			# Broadcast the race start to the connected client (if any).
			if Net.partner_connected and sim != null:
				var track_name: String = sim.track.name
				Net.net_season_start_race.rpc(track_name, seed_value)
		elif Net.role() == "client":
			# Client enters main.tscn via net_season_start_race RPC — join as client.
			_start("client")
		elif Season.active.coop:
			_start("local")
		else:
			_start("solo")
		if Season.active.race_quick:           # paddock asked to instant-sim it
			Season.active.race_quick = false
			fast_to_end = true
	else:
		_build_menu()

func _process(delta: float) -> void:
	if game_mode == "":
		return
	# quick-sim: run the whole race to the end in one frame (gated: not while pre-race modal open)
	if fast_to_end and not pre_race_open and game_mode != "client" and sim != null and not sim.finished:
		var g := 0
		while not sim.finished and g < 200000:
			sim.step(STEP)
			g += 1
		fast_to_end = false
		if season_race:
			_on_to_paddock()
			return
	# run authoritative sim (solo / local / host) — gated while pre-race modal open
	if game_mode != "client" and sim != null and not paused and not sim.finished and not pre_race_open:
		sim_accum += delta * speed
		var guard := 0
		while sim_accum >= STEP and guard < 4000:
			sim.step(STEP)
			sim_accum -= STEP
			guard += 1
	# host broadcasts snapshots
	if game_mode == "host":
		net_accum += delta
		if net_accum >= 1.0 / SNAPSHOT_HZ:
			net_accum = 0.0
			net_snapshot.rpc(_make_snapshot())
	_update_hud()

# ============================================================================
#  GAME START
# ============================================================================
func _start(m: String) -> void:
	game_mode = m
	if menu_overlay != null:
		menu_overlay.visible = false
	race_root.visible = true
	sim_accum = 0.0
	paused = false
	_track_char_set = false

	match m:
		"solo", "local":
			_make_sim(m == "local")
			my_car_id = 4
		"host":
			_make_sim(true)
			my_car_id = 4
			_setup_server()
		"client":
			my_car_id = 5
			_setup_client(ip_input.text if ip_input != null else "127.0.0.1")
		"online_host":
			# Online-season host: peer already created in Net; just make the sim.
			_make_sim(true)
			my_car_id = 4
			_ensure_host_signals()

	_build_panels()
	# Set the 2026 track character strip once at race start (host/solo/local have sim ready).
	if sim != null:
		_set_track_char_label(sim.track.energy_limit, sim.track.aero_zones, sim.track.corners, sim.track.straight_km, sim.track.evolution)
	elif track_char_label != null:
		track_char_label.text = ""   # client: will be filled on first snapshot
	if paddock_btn != null:
		paddock_btn.visible = season_race
	var hello := "Зелёный свет!"
	if m == "client":
		hello = "Подключение к хосту…"
	elif season_race and Season.active != null:
		hello = "Этап %d/%d — %s. Зелёный свет!" % [
			Season.active.round_index + 1, Season.active.total_rounds(),
			Season.active.round_name()]
	_set_msg(hello)
	# Show pre-race tyre choice modal (host/solo/local only; client waits for the host).
	if m != "client" and sim != null:
		start_comp_choices = {4: "medium", 5: "medium"}
		_show_prerace_modal()

func _make_sim(coop: bool) -> void:
	var track: RaceSim.Track
	if season_race and Season.active != null:
		track = Season.active.current_track()
	else:
		track = RaceSim.Track.new()
	var pteam := 1
	if season_race and Season.active != null:
		pteam = Season.active.player_team
	# Prime team R&D → car static state BEFORE make_field() composes the cars, so the
	# player car carries the season's upgrades — and so a non-season exhibition race
	# never inherits stale upgrades from a prior season (sentinel -1 disables; the
	# team_car() guard keeps opponents unaffected either way).
	if season_race and Season.active != null:
		Season.active.apply_car_rd()
	else:
		F1_2026.apply_rd_upgrades(-1, 0.0, 0.0, 0.0, 0.0, 0.0)
	# M2: the season's persistent staff (the people the players manage) replaces
	# per-race regeneration for the player team's strategist/pit-crew scalars.
	var pstaff: Dictionary = {}
	if season_race and Season.active != null:
		pstaff = Season.active.staff_for_sim()
	var field := RaceSim.make_field(coop, pteam, pstaff)
	if season_race and Season.active != null:
		for d in field:
			if d.team:
				# The car (chassis + engine) is already applied in make_field. Team
				# R&D no longer feeds the sim directly — when R&D is reworked it will
				# develop the car, and influence the race only through it. Here we add
				# just the DRIVER layer on top: development, morale and directive trust.
				# META-2b: per-attribute dev wiring. pace attr -> d.skill (direct pace);
				# all other attrs -> d.attrs[k] in FM scale (targeted sim effects).
				# _attr(d,"pace") is never called in race_sim.gd so pace goes to skill only.
				# No double-count: dev_of() (sum of all attrs) is replaced by pace attr only.
				d.skill += Season.active.attr_dev_of(d.id, "pace") + Season.active.morale_mod(d.id)
				for k in RaceSim.ATTR_KEYS:
					if k != "pace":
						var dv: float = Season.active.attr_dev_of(d.id, k) * 20.0
						d.attrs[k] = clampf(float(d.attrs.get(k, 13)) + dv, 1.0, 20.0)
				d.trust = float(Season.active.morale_of(d.id))   # directive compliance
			else:
				d.skill += Season.active.rival_skill_offset
	sim = RaceSim.new(track, field, seed_value)

# ============================================================================
#  NETWORKING (host-authoritative)
# ============================================================================
func _setup_server() -> void:
	# If Net already owns an active peer (online-season path), don't recreate it.
	if Net.is_online():
		_ensure_host_signals()
		return
	var peer := ENetMultiplayerPeer.new()
	var err := peer.create_server(PORT, 3)
	if err != OK:
		_set_msg("Не удалось поднять сервер (порт занят?).")
		return
	multiplayer.multiplayer_peer = peer
	_ensure_host_signals()

# Wire in-race peer signals (connect once; Net handles the permanent disconnect signals).
func _ensure_host_signals() -> void:
	if not multiplayer.peer_connected.is_connected(_on_peer_connected):
		multiplayer.peer_connected.connect(_on_peer_connected)
	if not multiplayer.peer_disconnected.is_connected(_on_peer_disconnected):
		multiplayer.peer_disconnected.connect(_on_peer_disconnected)
	# Reflect Net's partner state so the HUD label is correct immediately.
	partner_connected = Net.partner_connected

func _setup_client(addr: String) -> void:
	# If Net already owns an active peer (online-season path), don't recreate it.
	if Net.is_online():
		_set_msg("Ты ведёшь P6.")
		return
	# Accept "127.0.0.1", "127.0.0.1:24555", or "  192.168.0.5 : 24555 ".
	var host := addr.strip_edges()
	var port := PORT
	if host.contains(":"):
		var bits := host.split(":")
		host = bits[0].strip_edges()
		if bits.size() > 1 and bits[1].strip_edges().is_valid_int():
			port = int(bits[1].strip_edges())
	if host == "":
		host = "127.0.0.1"
	var err: int = Net.join_client(host + (":" + str(port) if port != PORT else ""))
	if err != OK:
		_set_msg("Не удалось создать клиент для %s:%d (код %d)." % [host, port, err])
		return
	multiplayer.connected_to_server.connect(func(): _set_msg("Подключено к %s:%d! Ты ведёшь P6." % [host, port]))
	multiplayer.connection_failed.connect(func(): _set_msg("Сбой подключения к %s:%d — хост запущен?" % [host, port]))
	multiplayer.server_disconnected.connect(func(): _set_msg("Хост отключился."))
	_set_msg("Подключение к %s:%d…" % [host, port])

func _on_peer_connected(id: int) -> void:
	partner_connected = true
	net_assign.rpc_id(id, 5)     # partner drives car P6
	# Also send the qualifying classification so the client can show it in the modal.
	if sim != null:
		net_quali_rows.rpc_id(id, build_quali_rows(sim))
	_set_msg("Напарник подключился — ведёт P6.")

func _on_peer_disconnected(_id: int) -> void:
	partner_connected = false
	_set_msg("Напарник отключился. P6 на ручном управлении хоста.")

# --- RPCs ---
@rpc("any_peer", "call_remote", "reliable")
func net_set_pace(car_id: int, pmode: String) -> void:
	if multiplayer.is_server() and sim != null:
		sim.set_pace(car_id, pmode)

@rpc("any_peer", "call_remote", "reliable")
func net_set_intent(car_id: int, intent: String) -> void:
	if multiplayer.is_server() and sim != null:
		sim.set_intent(car_id, intent)

@rpc("any_peer", "call_remote", "reliable")
func net_radio_call(car_id: int, call: String) -> void:
	if multiplayer.is_server() and sim != null:
		sim.radio_call(car_id, call)

@rpc("any_peer", "call_remote", "reliable")
func net_request_pit(car_id: int, compound: String) -> void:
	if multiplayer.is_server() and sim != null:
		sim.request_pit(car_id, compound)

@rpc("any_peer", "call_remote", "reliable")
func net_set_ers(car_id: int, mode: String) -> void:
	if multiplayer.is_server() and sim != null:
		sim.set_ers(car_id, mode)

@rpc("any_peer", "call_remote", "reliable")
func net_set_overtake(car_id: int, on: bool) -> void:
	if multiplayer.is_server() and sim != null:
		sim.set_overtake(car_id, on)

# Client sends its chosen starting compound to the host.
@rpc("any_peer", "call_remote", "reliable")
func net_set_start_compound(car_id: int, comp: String) -> void:
	if multiplayer.is_server() and sim != null:
		sim.set_start_compound(car_id, comp)

# Host broadcasts "race is starting now" so the client closes its wait panel.
@rpc("authority", "call_remote", "reliable")
func net_prerace_done() -> void:
	_close_prerace_modal()

@rpc("authority", "call_remote", "reliable")
func net_assign(car_id: int) -> void:
	my_car_id = car_id
	# Client gets assigned a car — show its own waiting panel for the tyre choice.
	_show_prerace_modal()

# Host → client: qualifying classification rows (plain Dicts, RPC-serialisable).
# Sent on peer connect (alongside net_assign) and on race restart (new sim → new quali).
# If the client's modal is already open when this arrives, the list refreshes in-place.
@rpc("authority", "call_remote", "reliable")
func net_quali_rows(rows: Array) -> void:
	_client_quali_rows = rows
	if pre_race_open and _quali_list_container != null:
		_refresh_quali_section(_client_quali_rows)

@rpc("authority", "call_remote", "unreliable_ordered")
func net_snapshot(payload: Dictionary) -> void:
	snapshot = payload

func _make_snapshot() -> Dictionary:
	var ds: Array = []
	for d in sim.drivers:
		ds.append({
			"id": d.id, "name": d.name, "progress": d.progress(),
			"compound": d.compound, "wear": d.tire_wear, "temp": d.tyre_temp, "pit": d.pit_count,
			"finished": d.finished, "finish_time": d.finish_time,
			"pace": d.pace_mode, "role": d.role, "team": d.team,
				"dir_pace": d.dir_pace, "dir_intent": d.dir_intent,
			"soc": d.soc, "ers": d.ers_mode, "overtake": d.overtake, "clipped": d.clipped,
			"color": d.color, "slot": d.slot, "state": _car_state(d), "dnf": d.dnf, "pit_phase": d.pit_phase(),
			"deploy_budget": d.deploy_budget,
			"deploy_budget_max": RaceSim.DEPLOY_BUDGET_BASE * sim.track.energy_limit,
			"last_lap": d.last_lap, "best_lap": d.best_lap, "tyre_laps": d.tyre_laps, "speed": sim.speed_kmh(d),
				"trust": d.trust, "mood": d.mood, "power_cut": d.power_cut,
			# Task B: partner-intent fields for the co-op transparency HUD.
			"pitting": d.pitting, "pit_request_compound": d.pit_request_compound,
		})
	return {"elapsed": sim.elapsed, "laps": sim.track.laps,
		"finished": sim.finished, "drivers": ds, "sc": sim.sc_active,
		"track": sim.track.name, "arch": sim.track.archetype, "pit_lane": sim.track.pit_lane,
		"wet": sim.wetness,
		"energy_limit": sim.track.energy_limit, "aero_zones": sim.track.aero_zones,
		"corners": sim.track.corners, "straight_km": sim.track.straight_km, "evolution": sim.track.evolution,
		"team_pit_cooldown": sim.team_pit_cooldown,
		"events": sim.event_log.slice(maxi(0, sim.event_log.size() - 12))}

# Visual state of a car for the minimap: out / pit / clip / attack / run.
func _car_state(d) -> String:
	if d.finished:
		return "out"
	if d.in_pitlane:
		return "pit"
	if d.clipped:
		return "clip"
	if d.overtake:
		return "attack"
	return "run"

# ============================================================================
#  HUD UPDATE
# ============================================================================
func _collect_entries() -> Array:
	# unify sim drivers and client snapshots into one shape
	if game_mode == "client":
		return snapshot.get("drivers", [])
	var out: Array = []
	if sim == null:
		return out
	for d in sim.drivers:
		out.append({
			"id": d.id, "name": d.name, "progress": d.progress(),
			"compound": d.compound, "wear": d.tire_wear, "temp": d.tyre_temp, "pit": d.pit_count,
			"finished": d.finished, "finish_time": d.finish_time,
			"pace": d.pace_mode, "role": d.role, "team": d.team,
				"dir_pace": d.dir_pace, "dir_intent": d.dir_intent,
			"soc": d.soc, "ers": d.ers_mode, "overtake": d.overtake, "clipped": d.clipped,
			"color": d.color, "slot": d.slot, "state": _car_state(d), "dnf": d.dnf, "pit_phase": d.pit_phase(),
			"deploy_budget": d.deploy_budget,
			"deploy_budget_max": RaceSim.DEPLOY_BUDGET_BASE * sim.track.energy_limit,
			"last_lap": d.last_lap, "best_lap": d.best_lap, "tyre_laps": d.tyre_laps, "speed": sim.speed_kmh(d),
				"trust": d.trust, "mood": d.mood, "power_cut": d.power_cut,
			# Task B: partner-intent fields.
			"pitting": d.pitting, "pit_request_compound": d.pit_request_compound,
		})
	return out

func _update_hud() -> void:
	var entries := _collect_entries()
	if entries.is_empty():
		status_label.text = "Ожидание данных…"
		_update_net_label()
		return
	entries.sort_custom(func(a, b): return a["progress"] > b["progress"])
	var leader: Dictionary = entries[0]
	var total_laps: int = snapshot.get("laps", 50) if game_mode == "client" else sim.track.laps
	var race_done: bool = snapshot.get("finished", false) if game_mode == "client" else sim.finished

	# Client: set track character strip once from the first valid snapshot (one-shot).
	if game_mode == "client" and not _track_char_set and snapshot.has("energy_limit"):
		var el: float = float(snapshot.get("energy_limit", 0.80))
		var az: int = int(snapshot.get("aero_zones", 2))
		_set_track_char_label(el, az, int(snapshot.get("corners", 15)),
			float(snapshot.get("straight_km", 0.9)), float(snapshot.get("evolution", 0.5)))
		_track_char_set = true

	var leader_lap := int(leader["progress"])
	var state := "ГОНКА"
	if race_done:
		state = "ФИНИШ"
	elif paused:
		state = "ПАУЗА"
	var tname: String = String(snapshot.get("track", "Трасса")) if game_mode == "client" else sim.track.name
	var tarch: String = String(snapshot.get("arch", "")) if game_mode == "client" else sim.track.archetype
	var alabel := _arch_label(tarch)
	status_label.text = "%s%s · Круг %d / %d · ×%d · %s · режим: %s" % [
		tname, (" · " + alabel) if alabel != "" else "",
		min(leader_lap + 1, total_laps), total_laps, int(speed), state, _mode_ru_game()]

	# leaderboard — find the fastest lap (purple) across all non-DNF entries
	var fastest_lap: float = 0.0
	for e in entries:
		var bl: float = float(e.get("best_lap", 0.0))
		if bl > 0.0 and (fastest_lap == 0.0 or bl < fastest_lap):
			fastest_lap = bl

	for i in board_rows.size():
		var row: Dictionary = board_rows[i]
		if i >= entries.size():
			for k in ["pos", "name", "gap", "int", "speed", "tire", "wear", "bat", "pit", "lastlap"]:
				row[k].text = ""
			continue
		var e: Dictionary = entries[i]
		# gap to leader
		var gap_s := 0.0
		if e["finished"] and leader["finished"]:
			gap_s = e["finish_time"] - leader["finish_time"]
		else:
			gap_s = (leader["progress"] - e["progress"]) * BASE_LT
		row["pos"].text = "P%d" % (i + 1)
		row["name"].text = e["name"]
		if e.get("dnf", false):
			row["gap"].text = "СХОД"
		elif i == 0:
			row["gap"].text = "ЛИДЕР"
		else:
			row["gap"].text = "+%.1f" % gap_s
		# interval to car directly ahead
		if e.get("dnf", false):
			row["int"].text = "СХОД"
		elif i == 0:
			row["int"].text = "—"
		else:
			var ahead_e: Dictionary = entries[i - 1]
			var int_s := 0.0
			if e["finished"] and ahead_e["finished"]:
				int_s = e["finish_time"] - ahead_e["finish_time"]
			else:
				int_s = (ahead_e["progress"] - e["progress"]) * BASE_LT
			row["int"].text = "+%.1f" % int_s
		# live speed (km/h): grey when stopped/pit, green tint while on Overtake boost
		var spd: int = int(round(float(e.get("speed", 0.0))))
		if e.get("dnf", false) or spd <= 0:
			row["speed"].text = "—"
			row["speed"].add_theme_color_override("font_color", Color("#6b7280"))
		else:
			row["speed"].text = str(spd)
			var scol: Color = Color("#cdd4df")
			if e.get("power_cut", false):
				scol = Color("#ff8c42")            # power-limited on the straight (out of deploy budget)
			elif e.get("overtake", false):
				scol = Color("#5dd17a")
			row["speed"].add_theme_color_override("font_color", scol)
		# tyre column: compound letter + temp arrow + tyre age
		var ttemp: float = float(e.get("temp", 0.55))
		var tmark := "▼" if ttemp < 0.45 else ("▲" if ttemp > 0.90 else "")
		var tage: int = int(e.get("tyre_laps", 0))
		row["tire"].text = String(e["compound"]).to_upper().substr(0, 1) + tmark + " " + str(tage)
		row["tire"].add_theme_color_override("font_color", _tire_color(e["compound"]))
		row["wear"].text = "%d%%" % int(e["wear"])
		row["wear"].add_theme_color_override("font_color", _wear_color(e["wear"]))
		row["bat"].text = "%d%%" % int(e.get("soc", 0.0))
		row["bat"].add_theme_color_override("font_color", _soc_color(e))
		row["pit"].text = str(e["pit"])
		# last lap time
		var ll: float = float(e.get("last_lap", 0.0))
		var ll_txt := "—"
		if ll > 0.0:
			if ll >= 60.0:
				var mins: int = int(ll) / 60
				var secs: float = ll - float(mins * 60)
				ll_txt = "%d:%04.1f" % [mins, secs]
			else:
				ll_txt = "%.1f" % ll
		row["lastlap"].text = ll_txt
		# fastest lap highlight in purple; other last-lap cells in default white
		var bl: float = float(e.get("best_lap", 0.0))
		if fastest_lap > 0.0 and bl > 0.0 and bl == fastest_lap:
			row["lastlap"].add_theme_color_override("font_color", Color("#b15de8"))
		else:
			row["lastlap"].add_theme_color_override("font_color", Color.WHITE)
		# name in the car's team colour; player's pos/gap keep the gold/blue accent
		row["name"].add_theme_color_override("font_color", Color(String(e.get("color", "#ffffff"))))
		var hi := Color.WHITE
		if e["team"]:
			hi = TEAM_COL if int(e["id"]) == 4 else ENGI_COL
		for k in ["pos", "gap"]:
			row[k].add_theme_color_override("font_color", hi)

	_update_panels(entries)
	_update_track_map(entries)
	_update_net_label()

	# one-shot race events from the sim (stacked pit, etc.)
	if game_mode != "client" and sim != null and sim.last_event != "":
		_set_msg(sim.last_event)
		sim.last_event = ""

	_update_feed()

	if race_done and not msg_label.text.begins_with("Финиш"):
		_announce_result(entries)

func _update_feed() -> void:
	if feed_rows.is_empty():
		return
	var evts: Array = []
	if game_mode == "client":
		evts = snapshot.get("events", [])
	elif sim != null:
		evts = sim.event_log
	# show last 7, newest first
	var start: int = maxi(0, evts.size() - 7)
	var shown: int = evts.size() - start
	for i in feed_rows.size():
		var lbl: RichTextLabel = feed_rows[i]
		var idx: int = evts.size() - 1 - i   # newest at row 0
		if i >= shown or idx < 0:
			lbl.text = ""
			continue
		var ev: Dictionary = evts[idx]
		var lap_n: int = int(ev.get("lap", 0))
		var txt: String = String(ev.get("text", ""))
		var knd: String = String(ev.get("kind", ""))
		var col: String
		match knd:
			"overtake": col = Palette.GOOD_HEX
			"pit":      col = Palette.INFO_HEX
			"dnf":      col = Palette.DANG_HEX
			"sc":       col = Palette.WARN_HEX
			"weather":  col = Palette.INFO_HEX
			"radio":    col = Palette.GOOD_HEX
			"flap":     col = Palette.PURP_HEX
			"incident": col = Palette.WARN_HEX
			"team":     col = Palette.GOLD_HEX
			"clip":     col = Palette.MUTED_HEX
			"penalty":  col = Palette.DANG_HEX
			_:          col = Palette.CREAM_HEX
		lbl.text = "[color=%s]Кр.%d · %s[/color]" % [col, lap_n, txt]

func _announce_result(entries: Array) -> void:
	var parts: Array = []
	for i in entries.size():
		var e: Dictionary = entries[i]
		if e["team"]:
			parts.append("%s P%d" % [e["name"], i + 1])
	var txt := "Финиш! Команда: %s." % ", ".join(parts)
	if season_race:
		txt += "  Жми «В паддок →» для зачёта очков и R&D."
	_set_msg(txt)

# Which radio call the car's current directive corresponds to (for button highlight).
func _active_call(e: Dictionary) -> String:
	var dp := String(e.get("dir_pace", "balanced"))
	var di := String(e.get("dir_intent", "free"))
	if dp == "push" and di == "attack":
		return "attack"
	if dp == "conserve":
		return "save"
	if di == "hold":
		return "defend"
	return "calm"

func _update_panels(entries: Array) -> void:
	var by_id := {}
	for e in entries:
		by_id[int(e["id"])] = e
	for p in panels:
		var e = by_id.get(p["id"])
		if e == null:
			continue
		var clipped: bool = bool(e.get("clipped", false))
		p["tire_label"].text = "Шины: %s · темп: %s · ERS: %s%s" % [
			String(e["compound"]).to_upper(), _mode_ru(e["pace"]),
			_ers_ru(e.get("ers", "balanced")), "  ⚠ КЛИППИНГ" if clipped else ""]
		p["wear_bar"].value = e["wear"]
		p["wear_bar"].modulate = _wear_color(e["wear"])
		if p.has("trust_bar"):
			var tr: float = float(e.get("trust", 60.0))
			var tc: Color = Color("#5dd17a") if tr >= 66.0 else (Color("#f2c14e") if tr >= 40.0 else Color("#e23b3b"))
			p["trust_bar"].value = tr
			p["trust_bar"].modulate = tc
			p["trust_label"].text = "Доверие пилота: %d" % int(round(tr))
			p["trust_label"].add_theme_color_override("font_color", tc)
		if p.has("mood_label"):
			var md: float = float(e.get("mood", 0.0))
			var mtxt: String
			var mcol: Color
			if md > 0.5:
				mtxt = "В зоне"; mcol = Color("#5dd17a")
			elif md > 0.15:
				mtxt = "На кураже"; mcol = Color("#a6d96a")
			elif md >= -0.15:
				mtxt = "Спокоен"; mcol = Color("#cdd4df")
			elif md >= -0.5:
				mtxt = "Нервничает"; mcol = Color("#f2c14e")
			else:
				mtxt = "Раздёрган"; mcol = Color("#e23b3b")
			p["mood_label"].text = "Настрой: %s" % mtxt
			p["mood_label"].add_theme_color_override("font_color", mcol)
		if p.has("call_buttons"):
			var active := _active_call(e)
			for k in p["call_buttons"]:
				var b: Button = p["call_buttons"][k]
				b.modulate = Color.WHITE if k == active else Color(0.55, 0.55, 0.55)
		if p.has("soc_bar"):
			p["soc_bar"].value = float(e.get("soc", 0.0))
			p["soc_bar"].modulate = _soc_color(e)
			# per-lap deploy budget bar
			if p.has("deploy_bar"):
				var db: ProgressBar = p["deploy_bar"]
				var dmax: float = float(e.get("deploy_budget_max", RaceSim.DEPLOY_BUDGET_BASE))
				var dval: float = float(e.get("deploy_budget", dmax))
				if dmax > 0.0:
					db.max_value = dmax
					db.value = dval
					var dfrac: float = dval / dmax
					if dfrac >= 0.60:
						db.modulate = Color("#5dd17a")
					elif dfrac >= 0.20:
						db.modulate = Color("#f2c14e")
					else:
						db.modulate = Color("#e23b3b")
			for em in p["ers_buttons"]:
				var eb: Button = p["ers_buttons"][em]
				eb.modulate = Color.WHITE if String(e.get("ers", "")) == em else Color(0.55, 0.55, 0.55)
			var ot: Button = p["ot_button"]
			ot.set_pressed_no_signal(bool(e.get("overtake", false)))
			if clipped:
				ot.text = "⚡ Обгон — батарея пуста"
			elif bool(e.get("overtake", false)):
				ot.text = "⚡ Обгон: ВКЛ (в 1 c)"
			else:
				ot.text = "⚡ Обгон (в пределах 1 c)"
	# inter-team-car gap on the tactics panel
	if team_gap_label != null:
		var tp: Array = []
		for e in entries:
			if e["team"]:
				tp.append(e)
		if tp.size() >= 2:
			var first_ahead: bool = tp[0]["progress"] >= tp[1]["progress"]
			var ahead_e: Dictionary = tp[0] if first_ahead else tp[1]
			var trail_e: Dictionary = tp[1] if first_ahead else tp[0]
			var g := absf(tp[0]["progress"] - tp[1]["progress"]) * BASE_LT
			team_gap_label.text = "%s впереди %s: %.1f c" % [
				ahead_e["name"], trail_e["name"], g]

	# Task B: partner-intent HUD — each player sees the other car's battery,
	# pit intent, crew status and double-stack warning.
	var tcd: float = 0.0
	if game_mode == "client":
		tcd = float(snapshot.get("team_pit_cooldown", 0.0))
	elif sim != null:
		tcd = sim.team_pit_cooldown
	for p in panels:
		if not p.has("partner_label"):
			continue
		var partner_id: int = 5 if int(p["id"]) == 4 else 4
		var pe: Dictionary = by_id.get(partner_id, {})
		if pe.is_empty():
			(p["partner_label"] as Label).text = ""
			if p.has("crew_label"):
				(p["crew_label"] as Label).text = ""
			if p.has("stack_label"):
				(p["stack_label"] as Label).text = ""
			continue
		# Battery line
		var psoc: float = float(pe.get("soc", 0.0))
		(p["partner_label"] as Label).text = "АКБ напарника: %d%%" % int(psoc)
		# Pit intent
		var ppitting: bool = bool(pe.get("pitting", false))
		var pprc: String = String(pe.get("pit_request_compound", ""))
		if ppitting:
			var comp_letter: String = _comp_letter_ru(pprc)
			(p["partner_label"] as Label).text += "   ПИТ → %s" % comp_letter
		# Crew busy
		var crew_txt: String = ""
		if tcd > 0.0:
			var secs_busy: int = int(ceili(tcd))
			crew_txt = "Экипаж занят: %d с" % secs_busy
		if p.has("crew_label"):
			(p["crew_label"] as Label).text = crew_txt
		# Double-stack warning
		var my_e: Dictionary = by_id.get(int(p["id"]), {})
		var my_pitting: bool = bool(my_e.get("pitting", false))
		var stack_warn: String = ""
		if (ppitting and tcd > 0.0) or (ppitting and my_pitting):
			stack_warn = "Дабл-стак: +7 с!"
		if p.has("stack_label"):
			(p["stack_label"] as Label).text = stack_warn

func _update_net_label() -> void:
	if net_label == null:
		return
	match game_mode:
		"host":
			net_label.text = "ХОСТ · порт %d · напарник: %s" % [
				PORT, "в игре" if partner_connected else "ожидание…"]
		"client":
			var ok := not snapshot.is_empty()
			net_label.text = "КЛИЕНТ · %s · ты ведёшь P6" % ("синхрон" if ok else "подключение…")
		"local":
			net_label.text = "ЛОКАЛЬНЫЙ КООП · P5 = Директор, P6 = Инженер"
		_:
			net_label.text = "СОЛО"

# ---------------------------------------------------------------- input
func _on_pace(car_id: int, pmode: String) -> void:
	if game_mode == "client":
		net_set_pace.rpc_id(1, car_id, pmode)
	elif sim != null:
		sim.set_pace(car_id, pmode)

func _on_intent(car_id: int, intent: String) -> void:
	if game_mode == "client":
		net_set_intent.rpc_id(1, car_id, intent)
	elif sim != null:
		sim.set_intent(car_id, intent)

func _on_radio_call(car_id: int, call: String) -> void:
	if game_mode == "client":
		net_radio_call.rpc_id(1, car_id, call)
	elif sim != null and not sim.finished:
		sim.radio_call(car_id, call)

func _on_pit(car_id: int, compound: String) -> void:
	if game_mode == "client":
		net_request_pit.rpc_id(1, car_id, compound)
		_set_msg("Запрос в боксы: %s." % compound.to_upper())
	elif sim != null and not sim.finished:
		sim.request_pit(car_id, compound)
		_set_msg("Боксы для P%d: %s." % [car_id + 1, compound.to_upper()])

func _on_ers(car_id: int, mode: String) -> void:
	if game_mode == "client":
		net_set_ers.rpc_id(1, car_id, mode)
	elif sim != null:
		sim.set_ers(car_id, mode)

func _on_overtake(car_id: int, on: bool) -> void:
	if game_mode == "client":
		net_set_overtake.rpc_id(1, car_id, on)
	elif sim != null:
		sim.set_overtake(car_id, on)

func _on_team_pace(pmode: String) -> void:
	if sim != null:
		sim.set_team_pace(pmode)

func _on_team_swap() -> void:
	if sim != null and not sim.finished:
		sim.team_order_swap()
		_set_msg(sim.last_event)
		sim.last_event = ""

func _on_pause() -> void:
	if game_mode == "client":
		return            # only host controls time flow
	paused = not paused

func _on_speed(s: float) -> void:
	if game_mode == "client":
		return
	speed = s

func _on_fast() -> void:
	if game_mode != "client" and sim != null and not sim.finished:
		fast_to_end = true     # _process runs the rest of the race instantly

func _on_restart() -> void:
	if game_mode == "client":
		return
	seed_value += 1
	_make_sim(game_mode != "solo")
	paused = false
	_set_msg("Новая гонка.")
	# Re-open the pre-race compound modal for the new race.
	if sim != null:
		start_comp_choices = {4: "medium", 5: "medium"}
		_show_prerace_modal()
		# In host mode push fresh quali rows to any connected partner (new sim → new quali).
		if game_mode == "host" and partner_connected:
			net_quali_rows.rpc(build_quali_rows(sim))

# ---------------------------------------------------------------- colors / text
func _tire_color(c) -> Color:
	return Palette.tire_color(String(c))

func _wear_color(w) -> Color:
	return Palette.wear_color(float(w))

func _mode_ru(m) -> String:
	match String(m):
		"conserve": return "БЕРЕЖНО"
		"balanced": return "БАЛАНС"
		"push": return "АТАКА"
	return String(m)

func _mode_ru_game() -> String:
	match game_mode:
		"solo": return "соло"
		"local": return "лок. кооп"
		"host": return "хост"
		"client": return "клиент"
	return game_mode

func _soc_color(e: Dictionary) -> Color:
	return Palette.soc_color(bool(e.get("clipped", false)), float(e.get("soc", 0.0)))

func _ers_ru(m) -> String:
	match String(m):
		"harvest": return "ХАРВЕСТ"
		"balanced": return "БАЛАНС"
		"attack": return "АТАКА"
	return String(m)

func _arch_label(a: String) -> String:
	match a:
		"power": return "силовая трасса"
		"street": return "уличная трасса"
		"highspeed": return "скоростная трасса"
		"technical": return "техничная трасса"
		"modern": return "современная трасса"
	return ""

# Build the BBCode string for the 2026 track character strip (set once at start).
func _track_char_bbcode(energy_limit: float, aero_zones: int, corners: int, straight_km: float, evolution: float) -> String:
	var tier_word: String
	var tier_col: String
	if energy_limit < 0.70:
		tier_word = "НИЗКИЙ"
		tier_col = "#e23b3b"
	elif energy_limit < 0.90:
		tier_word = "СРЕДНИЙ"
		tier_col = "#f2c14e"
	else:
		tier_word = "ВЫСОКИЙ"
		tier_col = "#5dd17a"
	var zones_str: String = "нет" if aero_zones == 0 else str(aero_zones)
	var evo_word: String = "слабая" if evolution < 0.5 else ("средняя" if evolution < 0.7 else "сильная")
	return "Энерголимит: [color=%s]%s[/color] · Прямые зоны: %s · Поворотов: %d · Длинная прямая: %.2f км · Эволюция трассы: [color=#66c2ff]%s[/color]" % [
		tier_col, tier_word, zones_str, corners, straight_km, evo_word]

# Set the track character strip label (called once at race start).
func _set_track_char_label(energy_limit: float, aero_zones: int, corners: int, straight_km: float, evolution: float) -> void:
	if track_char_label != null:
		track_char_label.text = _track_char_bbcode(energy_limit, aero_zones, corners, straight_km, evolution)

func _set_msg(s: String) -> void:
	if msg_label:
		msg_label.text = s

# ============================================================================
#  UI CONSTRUCTION
# ============================================================================
func _build_bg() -> void:
	var bg := ColorRect.new()
	bg.color = BG
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(bg)

func _build_menu() -> void:
	menu_overlay = ColorRect.new()
	(menu_overlay as ColorRect).color = BG
	menu_overlay.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(menu_overlay)

	# CenterContainer (full-rect) truly centres the menu block on both axes — the
	# old PRESET_CENTER anchored the VBox's top-left to the centre, so the content
	# spilled toward the bottom-right and the footer note clipped off-screen.
	var centerc := CenterContainer.new()
	centerc.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	menu_overlay.add_child(centerc)
	var center := VBoxContainer.new()
	center.add_theme_constant_override("separation", 12)
	center.alignment = BoxContainer.ALIGNMENT_CENTER
	centerc.add_child(center)

	var title := Label.new()
	title.text = "APEX DUO"
	title.add_theme_font_size_override("font_size", 52)
	title.add_theme_color_override("font_color", ACCENT)
	title.add_theme_font_override("font", Palette.display_font(700, 6))
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	center.add_child(title)

	var sub := Label.new()
	sub.text = "Кооперативный менеджер гонки · прототип"
	sub.add_theme_font_size_override("font_size", 16)
	sub.add_theme_color_override("font_color", Color("#9aa4b2"))
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	center.add_child(sub)

	center.add_child(_spacer_v(10))

	if Season.has_save():
		center.add_child(_menu_button("▶ ПРОДОЛЖИТЬ СЕЗОН", func(): _continue_season()))
		center.add_child(_spacer_v(6))

	center.add_child(_menu_button("Быстрая гонка — соло", func(): _start("solo")))
	center.add_child(_menu_button("Быстрая гонка — локальный кооп", func(): _start("local")))
	center.add_child(_spacer_v(6))
	center.add_child(_menu_button("СЕЗОН — новый чемпионат", func(): _begin_season_setup()))
	center.add_child(_spacer_v(6))
	center.add_child(_menu_button("Сезон-онлайн (хост)", func(): _begin_online_season_host()))
	center.add_child(_spacer_v(6))
	center.add_child(_menu_button("Создать игру по сети (хост)", func(): _start("host")))

	var join_row := HBoxContainer.new()
	join_row.add_theme_constant_override("separation", 6)
	join_row.alignment = BoxContainer.ALIGNMENT_CENTER
	ip_input = LineEdit.new()
	ip_input.text = "127.0.0.1"
	ip_input.custom_minimum_size = Vector2(180, 38)
	join_row.add_child(ip_input)
	join_row.add_child(_menu_button("Подключиться", func(): _join_online(ip_input.text)))
	center.add_child(join_row)

	var note := Label.new()
	note.text = "Онлайн (бета): нужны 2 копии игры. В одной — «Сезон-онлайн (хост)», в другой\nвведи IP (например 127.0.0.1) и «Подключиться». В редакторе Godot:\nDebug → Run Multiple Instances → Run 2 Instances."
	note.add_theme_font_size_override("font_size", 13)
	note.add_theme_color_override("font_color", Color("#7c8694"))
	note.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	center.add_child(note)

func _menu_button(txt: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = txt
	b.add_theme_font_size_override("font_size", 17)
	b.custom_minimum_size = Vector2(340, 42)
	b.pressed.connect(cb)
	return b

func _spacer_v(h: int) -> Control:
	var c := Control.new()
	c.custom_minimum_size = Vector2(0, h)
	return c

func _begin_season_setup() -> void:
	get_tree().change_scene_to_file("res://season_setup.tscn")

# «Сезон-онлайн (хост)»: raise the ENet server then go to setup.
# The setup screen will detect Net.role() == "host" and set coop+online flags.
func _begin_online_season_host() -> void:
	var err: int = Net.host_server()
	if err != OK:
		_set_msg("Не удалось поднять сервер (порт занят?). Код: %d" % err)
		return
	get_tree().change_scene_to_file("res://season_setup.tscn")

# «Подключиться» in online-season context: connect to host, then wait for
# net_season_full which will route us to season_hub.tscn automatically (via Net).
func _join_online(addr: String) -> void:
	var err: int = Net.join_client(addr)
	if err != OK:
		_set_msg("Не удалось подключиться к %s (код %d)." % [addr, err])
		return
	_set_msg("Подключение к %s…" % addr)

func _continue_season() -> void:
	var s := Season.load_from_disk()
	if s != null:
		Season.active = s
		get_tree().change_scene_to_file("res://season_hub.tscn")

func _on_to_paddock() -> void:
	if sim == null or not sim.finished or Season.active == null:
		return
	var ordered := sim.order()
	var ids: Array = []
	var results: Array = []
	for i in ordered.size():
		var d: RaceSim.Driver = ordered[i]
		ids.append(d.id)
		results.append({"id": d.id, "pos": i + 1, "grid": d.grid_pos,
			"passes": d.passes_made, "best_lap": d.best_lap, "dnf": d.dnf})
	Season.active.record_race(results)
	Season.active.apply_results(ids)
	# Online-season: host saves and syncs updated state to client before scene change.
	if Net.role() == "host":
		Season.active.save_to_disk()
		Net.net_season_full.rpc(Season.active.to_dict())
	get_tree().change_scene_to_file("res://season_hub.tscn")

func _build_race_ui(root: Control) -> void:
	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 18)
	# margin and col are configured fully (children added) before being inserted
	# into the tree, so _ready fires only after all children are in place.

	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 10)

	var title := Label.new()
	title.text = "APEX DUO — гонка"
	title.add_theme_font_size_override("font_size", 26)
	title.add_theme_color_override("font_color", ACCENT)
	title.add_theme_font_override("font", Palette.display_font(600, 3))
	col.add_child(title)

	status_label = _mklabel(16, "#9aa4b2")
	col.add_child(status_label)
	# 2026 track character strip — set once at race start, shows energy_limit tier + aero zones.
	track_char_label = RichTextLabel.new()
	track_char_label.bbcode_enabled = true
	track_char_label.fit_content = true
	track_char_label.scroll_active = false
	track_char_label.add_theme_font_size_override("normal_font_size", 13)
	track_char_label.add_theme_color_override("default_color", Color("#9aa4b2"))
	track_char_label.text = ""
	col.add_child(track_char_label)
	net_label = _mklabel(15, "#66c2ff")
	col.add_child(net_label)

	var mid := HBoxContainer.new()
	mid.add_theme_constant_override("separation", 16)
	mid.size_flags_vertical = Control.SIZE_EXPAND_FILL

	mid.add_child(_build_track_map())
	mid.add_child(_build_leaderboard())

	# Right column: a SCROLLABLE control stack with the race feed pinned below it.
	# The driver panels (trust/mood/calls/ERS/pit) are taller than the row, so the
	# controls live in a ScrollContainer — its small min-height stops the column
	# from forcing the whole HUD taller than the screen (which used to push the
	# bottom bar off-screen). "Controls" is still found by name in _build_panels.
	var ctrl_col := VBoxContainer.new()
	ctrl_col.add_theme_constant_override("separation", 10)
	ctrl_col.custom_minimum_size = Vector2(358, 0)
	var ctrl_scroll := ScrollContainer.new()
	ctrl_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	ctrl_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	ctrl_scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var controls_holder := VBoxContainer.new()
	controls_holder.name = "Controls"
	controls_holder.add_theme_constant_override("separation", 12)
	controls_holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	ctrl_scroll.add_child(controls_holder)
	ctrl_col.add_child(ctrl_scroll)
	ctrl_col.add_child(_build_feed_panel())
	mid.add_child(ctrl_col)

	col.add_child(mid)
	col.add_child(_build_bottom_bar())

	msg_label = _mklabel(16, "#ffd166")
	col.add_child(msg_label)

	margin.add_child(col)
	root.add_child(margin)

func _build_track_map() -> Control:
	var pc := _panel_container()
	pc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	pc.size_flags_stretch_ratio = 2.0          # the race view is the dominant element
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 6)
	v.size_flags_vertical = Control.SIZE_EXPAND_FILL
	# Configure v fully before add_child so _ready fires after all children are set.
	var map_hdr := _mklabel(16, Palette.CREAM_HEX, "ГОНКА")
	map_hdr.add_theme_font_override("font", Palette.display_font(600, 2))
	v.add_child(map_hdr)
	track_map = TrackMap.new()
	track_map.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	track_map.size_flags_vertical = Control.SIZE_EXPAND_FILL
	track_map.custom_minimum_size = Vector2(0, 360)
	v.add_child(track_map)
	# 3D race view — a pure view over the same snapshot (mirrors TrackMap's
	# ensure_built/set_cars contract). Hidden by default; the toggle swaps it in.
	race_view_3d = RaceView3D.new()
	race_view_3d.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	race_view_3d.size_flags_vertical = Control.SIZE_EXPAND_FILL
	race_view_3d.custom_minimum_size = Vector2(0, 360)
	race_view_3d.visible = false
	v.add_child(race_view_3d)
	view_3d_btn = Button.new()
	view_3d_btn.text = "Вид: 2D ▸ 3D"
	view_3d_btn.pressed.connect(_toggle_view_3d)
	v.add_child(view_3d_btn)
	pc.add_child(v)
	return pc

# Circuit-shape seed: track name hash (host has the name; the snapshot carries it
# for clients), so host and client draw the same circuit.
func _track_seed() -> int:
	var nm := ""
	if game_mode == "client":
		nm = String(snapshot.get("track", ""))
	elif sim != null:
		nm = sim.track.name
	if nm == "":
		return 50
	var h := 0
	for ch in nm:
		h = (h * 131 + ch.unicode_at(0)) & 0x7fffffff
	return h

func _update_track_map(entries: Array) -> void:
	if track_map == null:
		return
	var tname := ""
	if game_mode == "client":
		tname = String(snapshot.get("track", ""))
	elif sim != null:
		tname = sim.track.name
	track_map.ensure_built(tname, _track_seed())
	if game_mode == "client":
		track_map.pit_lane = float(snapshot.get("pit_lane", 0.05))
		track_map.aero_zones = int(snapshot.get("aero_zones", 0))
	elif sim != null:
		track_map.pit_lane = sim.track.pit_lane
		track_map.aero_zones = sim.track.aero_zones
	var arr: Array = []
	for i in entries.size():
		var e: Dictionary = entries[i]
		var pr: float = e["progress"]
		arr.append({
			"frac": pr - floor(pr),
			"id": int(e["id"]),
			"team_color": Color(String(e.get("color", "#8a94a6"))),
			"slot": int(e.get("slot", 0)),
			"state": String(e.get("state", "run")),
			"team": e["team"],
			"lead": i == 0,
			"pos": i,
			"pit_phase": float(e.get("pit_phase", 0.0)),
		})
	var sc := false
	if game_mode == "client":
		sc = bool(snapshot.get("sc", false))
	elif sim != null:
		sc = sim.sc_active
	track_map.set_cars(arr, sc)
	# Mirror the same snapshot into the 3D view while it's the active one.
	if view_is_3d and race_view_3d != null:
		race_view_3d.ensure_built(tname, _track_seed())
		race_view_3d.set_cars(arr, sc)

func _toggle_view_3d() -> void:
	view_is_3d = not view_is_3d
	if track_map != null:
		track_map.visible = not view_is_3d
	if race_view_3d != null:
		race_view_3d.visible = view_is_3d
	if view_3d_btn != null:
		view_3d_btn.text = "Вид: 3D ▸ 2D" if view_is_3d else "Вид: 2D ▸ 3D"

func _build_leaderboard() -> Control:
	var pc := _panel_container()
	pc.custom_minimum_size = Vector2(766, 0)       # widened to fit ИНТ + КМ/Ч + Л.КРУГ columns
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 4)

	var header := _row_box()
	var hdr_specs: Array = [["", 46], ["ПИЛОТ", 150], ["ОТРЫВ", 90], ["ИНТ", 72],
		["КМ/Ч", 66], ["ШИНА", 78], ["ИЗНОС", 70], ["БАТ", 56], ["ПИТ", 46], ["Л.КРУГ", 80]]
	for hs in hdr_specs:
		var hcell := _cell(header, String(hs[0]), int(hs[1]), Palette.FINE_HEX)
		hcell.add_theme_font_override("font", Palette.display_font(600, 1))
	v.add_child(header)
	v.add_child(HSeparator.new())

	for i in F1_2026.grid_size():
		var box := _row_box()
		var r := {
			"pos": _cell(box, "", 46, "#ffffff"),
			"name": _cell(box, "", 150, "#ffffff"),
			"gap": _cell(box, "", 90, "#ffffff"),
			"int": _cell(box, "", 72, "#ffffff"),
			"speed": _cell(box, "", 66, "#ffffff"),
			"tire": _cell(box, "", 78, "#ffffff"),
			"wear": _cell(box, "", 70, "#ffffff"),
			"bat": _cell(box, "", 56, "#ffffff"),
			"pit": _cell(box, "", 46, "#ffffff"),
			"lastlap": _cell(box, "", 80, "#ffffff"),
		}
		v.add_child(box)
		board_rows.append(r)

	pc.add_child(v)
	return pc

# Real driver name for a car id (from the sim, or the client snapshot).
func _driver_name(id: int) -> String:
	if sim != null:
		var d := sim.get_driver_by_id(id)
		if d != null:
			return d.name
	for e in snapshot.get("drivers", []):
		if int(e.get("id", -1)) == id:
			return String(e.get("name", ""))
	return "Пилот"

# Build per-driver control panels for the current mode (called at race start).
func _build_panels() -> void:
	panels.clear()
	var holder: Node = race_root.find_child("Controls", true, false)
	if holder == null:
		return
	for child in holder.get_children():
		child.queue_free()

	var specs: Array = []        # [{id, role, name}]
	match game_mode:
		"solo":
			specs = [{"id": 4, "role": "Директор", "name": _driver_name(4)}]
		"local", "host":
			specs = [{"id": 4, "role": "Директор", "name": _driver_name(4)},
				{"id": 5, "role": "Инженер", "name": _driver_name(5)}]
		"client":
			specs = [{"id": my_car_id, "role": "Инженер", "name": _driver_name(my_car_id)}]

	# Shared team-tactics panel (the sim-authoritative side issues team orders).
	if game_mode != "client":
		holder.add_child(_make_team_panel())

	for s in specs:
		holder.add_child(_make_panel(int(s["id"]), String(s["role"]), String(s["name"])))

func _make_team_panel() -> Control:
	var pc := _panel_container()
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	# Configure v fully before add_child so _ready fires after all children are set.
	var tact_hdr := _mklabel(18, Palette.GOLD_HEX, "КОМАНДНАЯ ТАКТИКА")
	tact_hdr.add_theme_font_override("font", Palette.display_font(600, 2))
	v.add_child(tact_hdr)
	team_gap_label = _mklabel(15, "#cccccc", "Разрыв P5–P6: —")
	v.add_child(team_gap_label)

	v.add_child(_mklabel(14, "#9aa4b2", "Темп обеих машин:"))
	var pace_row := _row_box()
	for spec in [["conserve", "Бережно"], ["balanced", "Баланс"], ["push", "Атака"]]:
		var b := _small_button(spec[1])
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var pm: String = spec[0]
		b.pressed.connect(func(): _on_team_pace(pm))
		pace_row.add_child(b)
	v.add_child(pace_row)

	var swap := _small_button("Приказ: пропустить вперёд (свап)")
	swap.pressed.connect(_on_team_swap)
	v.add_child(swap)
	v.add_child(_mklabel(13, "#7c8694",
		"Не пите обе машины в один круг — экипаж один (+штраф)."))
	pc.add_child(v)
	return pc

func _make_panel(car_id: int, role: String, dname: String) -> Control:
	var pc := _panel_container()
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	pc.add_child(v)

	var col := TEAM_COL if car_id == 4 else ENGI_COL
	var head := Label.new()
	head.text = "P%d · %s — %s" % [car_id + 1, dname, role]
	head.add_theme_font_size_override("font_size", 18)
	head.add_theme_color_override("font_color", col)
	head.add_theme_font_override("font", Palette.display_font(600, 1))
	v.add_child(head)

	var tire := _mklabel(15, "#cccccc")
	v.add_child(tire)

	var bar := ProgressBar.new()
	bar.min_value = 0
	bar.max_value = 120
	bar.show_percentage = false
	bar.custom_minimum_size = Vector2(0, 16)
	bar.add_theme_stylebox_override("fill", Palette.bar_fill(Palette.GOOD))
	bar.add_theme_stylebox_override("background", Palette.bar_bg())
	v.add_child(bar)

	# Live driver-trust readout — the engineer↔driver relationship, in-race.
	var trust_label := _mklabel(14, Palette.MUTED_HEX, "Доверие пилота: —")
	v.add_child(trust_label)
	var trust_bar := ProgressBar.new()
	trust_bar.min_value = 0
	trust_bar.max_value = 100
	trust_bar.show_percentage = false
	trust_bar.custom_minimum_size = Vector2(0, 10)
	trust_bar.add_theme_stylebox_override("fill", Palette.bar_fill(Palette.GOOD))
	trust_bar.add_theme_stylebox_override("background", Palette.bar_bg())
	v.add_child(trust_bar)
	var mood_label := _mklabel(14, "#9aa4b2", "Настрой: —")
	v.add_child(mood_label)

	# Radio calls replace the old pace/intent toggles: discrete instructions the
	# driver interprets (accepts / pushes back / refuses) by trust + car state.
	v.add_child(_mklabel(14, "#9aa4b2", "Радио-вызов пилоту:"))
	var call_buttons := {}
	for row_spec in [[["calm", "Спокойно"], ["attack", "Атакуй"]], [["save", "Береги шину"], ["defend", "Защищайся"]]]:
		var cr := _row_box()
		for cspec in row_spec:
			var cb := _small_button(cspec[1])
			cb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			var call_id: String = cspec[0]
			var cidC := car_id
			cb.pressed.connect(func(): _on_radio_call(cidC, call_id))
			call_buttons[call_id] = cb
			cr.add_child(cb)
		v.add_child(cr)
	var encourage := _small_button("📣 Подбодрить пилота")
	var cidM := car_id
	encourage.pressed.connect(func(): _on_radio_call(cidM, "encourage"))
	v.add_child(encourage)

	# --- 2026 energy controls (each player runs their own battery) ---
	v.add_child(_mklabel(14, Palette.MUTED_HEX, "Батарея (заряд):"))
	var soc_bar := ProgressBar.new()
	soc_bar.min_value = 0
	soc_bar.max_value = 100
	soc_bar.show_percentage = false
	soc_bar.custom_minimum_size = Vector2(0, 14)
	soc_bar.add_theme_stylebox_override("fill", Palette.bar_fill(Palette.GOOD))
	soc_bar.add_theme_stylebox_override("background", Palette.bar_bg())
	v.add_child(soc_bar)

	# 2026 per-lap deploy budget bar — shows how much electric deployment remains this lap.
	var deploy_hdr := _mklabel(14, Palette.MUTED_HEX, "ЗАПАС ДЕПЛОЯ (КРУГ):")
	deploy_hdr.add_theme_font_override("font", Palette.display_font(600, 1))
	v.add_child(deploy_hdr)
	var deploy_bar := ProgressBar.new()
	deploy_bar.min_value = 0.0
	deploy_bar.max_value = RaceSim.DEPLOY_BUDGET_BASE   # default; updated each frame via max_value
	deploy_bar.value = RaceSim.DEPLOY_BUDGET_BASE
	deploy_bar.show_percentage = false
	deploy_bar.custom_minimum_size = Vector2(0, 12)
	deploy_bar.add_theme_stylebox_override("fill", Palette.bar_fill(Palette.INFO))
	deploy_bar.add_theme_stylebox_override("background", Palette.bar_bg())
	v.add_child(deploy_bar)

	v.add_child(_mklabel(14, "#9aa4b2", "Режим ERS:"))
	var ers_row := _row_box()
	var ers_buttons := {}
	for spec in [["harvest", "Харвест"], ["balanced", "Баланс"], ["attack", "Атака"]]:
		var b := _small_button(spec[1])
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var em: String = spec[0]
		var cidE := car_id
		b.pressed.connect(func(): _on_ers(cidE, em))
		ers_buttons[em] = b
		ers_row.add_child(b)
	v.add_child(ers_row)

	var ot_btn := _small_button("⚡ Обгон (в пределах 1 c)")
	ot_btn.toggle_mode = true
	var cidO := car_id
	ot_btn.toggled.connect(func(on): _on_overtake(cidO, on))
	v.add_child(ot_btn)

	v.add_child(_mklabel(14, "#9aa4b2", "Пит-стоп:"))
	var pit_row := _row_box()
	for spec in [["soft", "Soft"], ["medium", "Medium"], ["hard", "Hard"], ["inter", "Инт"], ["wet", "Дождь"]]:
		var b := _small_button(spec[1])
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var comp: String = spec[0]
		var cid2 := car_id
		b.pressed.connect(func(): _on_pit(cid2, comp))
		pit_row.add_child(b)
	v.add_child(pit_row)

	# Task B: partner-intent section — shows the OTHER team car's battery, pit
	# intent, crew busy status and double-stack warning.
	v.add_child(HSeparator.new())
	var partner_label := _mklabel(14, "#9aa4b2", "")
	v.add_child(partner_label)
	var crew_label := _mklabel(14, "#f2c14e", "")
	v.add_child(crew_label)
	var stack_label := _mklabel(14, "#e23b3b", "")
	v.add_child(stack_label)

	panels.append({
		"id": car_id, "role": role, "tire_label": tire,
		"wear_bar": bar, "call_buttons": call_buttons,
		"trust_label": trust_label, "trust_bar": trust_bar, "mood_label": mood_label,
		"soc_bar": soc_bar, "deploy_bar": deploy_bar,
		"ers_buttons": ers_buttons, "ot_button": ot_btn,
		"partner_label": partner_label, "crew_label": crew_label, "stack_label": stack_label,
	})
	return pc

# ============================================================================
#  PRE-RACE TYRE MODAL  («Квалификация и стартовая резина»)
# ============================================================================

# Builds display rows for the qualifying classification (pole first).
# Each row: {p: int, name: String, color: String, team: bool,
#            time_s: float, gap: float}
# Pure static helper — no UI, no side effects. Testable headless.
static func build_quali_rows(s: RaceSim) -> Array:
	var rows: Array = []
	if s == null or s.quali_grid.is_empty():
		return rows
	var pole_id: int = int(s.quali_grid[0])
	var pole_score: float = float(s.quali_times.get(pole_id, 0.0))
	# Build driver id → Driver lookup
	var by_id: Dictionary = {}
	for d in s.drivers:
		by_id[int(d.id)] = d
	for p in s.quali_grid.size():
		var did: int = int(s.quali_grid[p])
		var score: float = float(s.quali_times.get(did, 0.0))
		var time_s: float = s.track.base_laptime + score
		var gap: float = score - pole_score        # 0.0 for pole, positive for the rest
		var drv: RaceSim.Driver = by_id.get(did)
		var dname: String  = drv.name  if drv != null else "?"
		var dcol: String   = drv.color if drv != null else "#8a94a6"
		var dteam: bool    = drv.team  if drv != null else false
		rows.append({
			"p":      p + 1,
			"name":   dname,
			"color":  dcol,
			"team":   dteam,
			"time_s": time_s,
			"gap":    gap,
		})
	return rows

# Format a lap time as m:ss.mmm (when ≥ 60 s) or ss.mmm.
static func _fmt_laptime(t: float) -> String:
	if t >= 60.0:
		var mins: int = int(t) / 60
		var secs: float = t - float(mins * 60)
		return "%d:%06.3f" % [mins, secs]
	return "%.3f" % t

# Build the VBoxContainer of RichTextLabel rows for the qualifying list.
func _build_quali_list(rows: Array) -> VBoxContainer:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 2)
	if rows.is_empty():
		var empty := Label.new()
		empty.text = "Квалификация недоступна"
		empty.add_theme_font_size_override("font_size", 14)
		empty.add_theme_color_override("font_color", Color("#9aa4b2"))
		v.add_child(empty)
		return v
	# Track which team-car entries we've already seen (first = P5 gold, second = P6 cyan).
	var team_count: int = 0
	for i in rows.size():
		var row: Dictionary = rows[i]
		var pos: int      = int(row.get("p", i + 1))
		var dname: String = String(row.get("name", ""))
		var dcol: String  = String(row.get("color", "#ffffff"))
		var dteam: bool   = bool(row.get("team", false))
		var time_s: float = float(row.get("time_s", 0.0))
		var gap: float    = float(row.get("gap", 0.0))

		var time_txt: String
		if pos == 1:
			time_txt = _fmt_laptime(time_s)
		else:
			time_txt = "+%.3f" % gap

		var txt: String = "P%-2d  %-18s  %s" % [pos, dname, time_txt]

		# Player team cars: gold (first team car = P5) / cyan (second = P6).
		# All other cars: their team colour.
		var display_col: String
		if dteam:
			display_col = "#ffd166" if team_count == 0 else "#66c2ff"
			team_count += 1
		else:
			display_col = dcol

		var lbl := RichTextLabel.new()
		lbl.bbcode_enabled = true
		lbl.fit_content = true
		lbl.scroll_active = false
		lbl.add_theme_font_size_override("normal_font_size", 14)
		lbl.text = "[color=%s]%s[/color]" % [display_col, txt]
		v.add_child(lbl)
	return v

# Populate / refresh the quali section of the open modal.
# Clears the list_holder VBox and rebuilds it from rows.
func _refresh_quali_section(rows: Array) -> void:
	if _quali_list_container == null:
		return
	for ch in _quali_list_container.get_children():
		ch.queue_free()
	_quali_list_container.add_child(_build_quali_list(rows))

# Returns the Russian single-letter abbreviation for a pit/start compound.
func _comp_letter_ru(comp: String) -> String:
	match comp:
		"soft":   return "С"
		"medium": return "М"
		"hard":   return "Х"
		"inter":  return "И"
		"wet":    return "В"
	return comp.to_upper().substr(0, 1)

func _show_prerace_modal() -> void:
	pre_race_open = true
	_quali_list_container = null      # reset: new modal gets a new container reference
	if pre_race_panel != null:
		pre_race_panel.queue_free()
	var overlay := ColorRect.new()
	overlay.color = Color(0.0, 0.0, 0.0, 0.72)
	overlay.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	pre_race_panel = overlay
	race_root.add_child(overlay)

	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	overlay.add_child(center)

	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 12)
	center.add_child(box)

	var sb := StyleBoxFlat.new()
	sb.bg_color = Palette.PANEL
	sb.set_corner_radius_all(2)
	sb.set_border_width_all(1)
	sb.border_color = Palette.DIV
	sb.set_content_margin_all(22)
	var pc := PanelContainer.new()
	pc.add_theme_stylebox_override("panel", sb)
	box.add_child(pc)

	var inner := VBoxContainer.new()
	inner.add_theme_constant_override("separation", 10)
	pc.add_child(inner)

	# ---- Modal title ----
	var tname: String = sim.track.name if sim != null else "Трасса"
	var title := Label.new()
	title.text = "КВАЛИФИКАЦИЯ И СТАРТОВАЯ РЕЗИНА — %s" % tname
	title.add_theme_font_size_override("font_size", 20)
	title.add_theme_color_override("font_color", ACCENT)
	title.add_theme_font_override("font", Palette.display_font(600, 2))
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	inner.add_child(title)

	# ---- Track info line ----
	var tlaps: int = sim.track.laps if sim != null else 0
	var tabr: float = sim.track.abrasion if sim != null else 1.0
	var twet: int = int(round(float(sim.track.wet_prob if sim != null else 0.2) * 100.0))
	var info := Label.new()
	info.text = "%s · Кругов: %d · Абразив: %.2f · Дождь: %d%%" \
		% [tname, tlaps, tabr, twet]
	info.add_theme_font_size_override("font_size", 14)
	info.add_theme_color_override("font_color", Color("#9aa4b2"))
	info.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	inner.add_child(info)

	inner.add_child(HSeparator.new())

	# ---- Qualifying classification section ----
	var quali_header := Label.new()
	quali_header.text = "КВАЛИФИКАЦИЯ"
	quali_header.add_theme_font_size_override("font_size", 16)
	quali_header.add_theme_color_override("font_color", Palette.MUTED)
	quali_header.add_theme_font_override("font", Palette.display_font(600, 2))
	inner.add_child(quali_header)

	# ScrollContainer caps the list height so the modal stays on screen.
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.custom_minimum_size = Vector2(500, 300)
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL

	# _quali_list_container is the VBox that _refresh_quali_section clears/repopulates.
	var list_holder := VBoxContainer.new()
	list_holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_quali_list_container = list_holder
	scroll.add_child(list_holder)
	inner.add_child(scroll)

	# Populate: host/solo/local use the live sim; client uses rows from net_quali_rows
	# (may be empty until the RPC arrives — net_quali_rows will refresh in-place).
	if sim != null:
		_refresh_quali_section(build_quali_rows(sim))
	else:
		_refresh_quali_section(_client_quali_rows)

	inner.add_child(HSeparator.new())

	# ---- Tyre choice section ----
	var tyre_header := Label.new()
	tyre_header.text = "СТАРТОВАЯ РЕЗИНА"
	tyre_header.add_theme_font_size_override("font_size", 16)
	tyre_header.add_theme_color_override("font_color", Palette.MUTED)
	tyre_header.add_theme_font_override("font", Palette.display_font(600, 2))
	inner.add_child(tyre_header)

	# One row per team car. In online: host edits id=4, client edits id=5.
	var editable_ids: Array = []
	if game_mode == "client":
		editable_ids = [my_car_id]
	else:
		editable_ids = [4, 5] if game_mode in ["local", "host"] else [4]

	# Compound toggle buttons per car row.
	# Keys into start_comp_choices are the actual car ids (ints 4/5).
	var comp_btn_groups: Dictionary = {}   # car_id -> {"soft": Button, "medium": Button, "hard": Button}
	for cid in editable_ids:
		var dname: String = _driver_name(cid)
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 8)
		var lbl := Label.new()
		lbl.text = "P%d · %s:" % [cid + 1, dname]
		lbl.add_theme_font_size_override("font_size", 16)
		lbl.add_theme_color_override("font_color", TEAM_COL if cid == 4 else ENGI_COL)
		lbl.custom_minimum_size = Vector2(180, 0)
		row.add_child(lbl)
		var btns: Dictionary = {}
		for cspec in [["soft", "С (Soft)"], ["medium", "М (Medium)"], ["hard", "Х (Hard)"]]:
			var cb := Button.new()
			cb.text = cspec[1]
			cb.add_theme_font_size_override("font_size", 15)
			cb.custom_minimum_size = Vector2(100, 36)
			cb.toggle_mode = true
			var cname: String = cspec[0]
			var cid_r: int = cid
			cb.pressed.connect(func(): _on_prerace_compound(cid_r, cname, comp_btn_groups))
			btns[cname] = cb
			row.add_child(cb)
		comp_btn_groups[cid] = btns
		inner.add_child(row)
		# Highlight the default choice (medium).
		_prerace_highlight_btns(comp_btn_groups[cid], start_comp_choices.get(cid, "medium"))

	# For the client: show a waiting note instead of the start button.
	if game_mode == "client":
		var wait_lbl := Label.new()
		wait_lbl.text = "Ожидаем «Поехали» от хоста…"
		wait_lbl.add_theme_font_size_override("font_size", 15)
		wait_lbl.add_theme_color_override("font_color", Color("#9aa4b2"))
		wait_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		inner.add_child(wait_lbl)
		return   # client has no start button

	# Host / solo / local: show a «Поехали» button.
	var go_btn := Button.new()
	go_btn.text = "Поехали!"
	go_btn.add_theme_font_size_override("font_size", 18)
	go_btn.custom_minimum_size = Vector2(200, 44)
	go_btn.pressed.connect(_on_prerace_start)
	inner.add_child(go_btn)

func _prerace_highlight_btns(btns: Dictionary, selected: String) -> void:
	for k in btns:
		var b: Button = btns[k]
		b.set_pressed_no_signal(k == selected)
		b.modulate = Color.WHITE if k == selected else Color(0.55, 0.55, 0.55)

func _on_prerace_compound(car_id: int, comp: String, groups: Dictionary) -> void:
	start_comp_choices[car_id] = comp
	# In online client mode, immediately RPC the choice to the host.
	if game_mode == "client":
		net_set_start_compound.rpc_id(1, car_id, comp)
	if groups.has(car_id):
		_prerace_highlight_btns(groups[car_id], comp)

func _on_prerace_start() -> void:
	# Apply choices to the sim, then close and start.
	if sim != null:
		for cid in start_comp_choices:
			sim.set_start_compound(int(cid), String(start_comp_choices[cid]))
	# Notify clients (if any) so they close their wait panel.
	if game_mode == "host":
		net_prerace_done.rpc()
	_close_prerace_modal()

func _close_prerace_modal() -> void:
	pre_race_open = false
	_quali_list_container = null     # panel is about to be freed; drop the dangling ref
	if pre_race_panel != null:
		pre_race_panel.queue_free()
		pre_race_panel = null

func _build_bottom_bar() -> Control:
	var h := _row_box()
	var pause_btn := _small_button("Пауза / Продолжить")
	pause_btn.pressed.connect(_on_pause)
	h.add_child(pause_btn)
	for s in [1.0, 2.0, 5.0]:
		var b := _small_button("×%d" % int(s))
		var sv: float = s
		b.pressed.connect(func(): _on_speed(sv))
		h.add_child(b)
	var fast := _small_button("⏩ Симулировать")
	fast.pressed.connect(_on_fast)
	h.add_child(fast)
	var sp := Control.new()
	sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(sp)
	paddock_btn = _small_button("В паддок →")
	paddock_btn.add_theme_font_size_override("font_size", 15)
	paddock_btn.visible = false
	paddock_btn.pressed.connect(_on_to_paddock)
	h.add_child(paddock_btn)
	var restart := _small_button("Новая гонка")
	restart.pressed.connect(_on_restart)
	h.add_child(restart)
	return h

func _build_feed_panel() -> Control:
	var pc := _panel_container()
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 2)
	var hdr := _mklabel(13, Palette.FINE_HEX, "ЛЕНТА ГОНКИ")
	hdr.add_theme_font_override("font", Palette.display_font(600, 1))
	v.add_child(hdr)
	feed_rows.clear()
	for _i in 7:
		var lbl := RichTextLabel.new()
		lbl.bbcode_enabled = true
		lbl.fit_content = true
		lbl.scroll_active = false
		lbl.add_theme_font_size_override("normal_font_size", 14)
		lbl.add_theme_color_override("default_color", Color("#c8d0db"))
		lbl.text = ""
		feed_rows.append(lbl)
		v.add_child(lbl)
	pc.add_child(v)
	return pc

# ---------------------------------------------------------------- ui helpers
func _panel_container() -> PanelContainer:
	var pc := PanelContainer.new()
	pc.add_theme_stylebox_override("panel", Palette.panel())
	return pc

func _row_box() -> HBoxContainer:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 6)
	return h

func _cell(box: HBoxContainer, txt: String, w: int, col: String) -> Label:
	var l := Label.new()
	l.text = txt
	l.custom_minimum_size = Vector2(w, 0)
	l.add_theme_font_size_override("font_size", 17)
	l.add_theme_color_override("font_color", Color(col))
	box.add_child(l)
	return l

func _mklabel(sz: int, col: String, txt: String = "") -> Label:
	var l := Label.new()
	l.text = txt
	l.add_theme_font_size_override("font_size", sz)
	l.add_theme_color_override("font_color", Color(col))
	return l

func _small_button(txt: String) -> Button:
	var b := Button.new()
	b.text = txt
	b.add_theme_font_size_override("font_size", 14)
	b.custom_minimum_size = Vector2(0, 32)
	return b
