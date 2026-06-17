extends Node

# ============================================================================
# Apex Duo — Net autoload (singleton at /root/Net).
#
# Owns the ENet peer lifecycle: creates it ONCE and never recreates while
# connected.  Exposes host_server() / join_client() / is_online() / role.
# Carries all season-level @rpc functions (net_season_*) so they survive
# scene transitions (RPC target = /root/Net, always present).
#
# In-race RPCs (pace/pit/ers/overtake/snapshot/quali/assign/prerace) stay on
# main.gd — they are only needed while main.tscn is loaded and the NodePath
# is valid.
# ============================================================================

const PORT := 24555

# Exposed state (read-only from other nodes).
var is_host := false
var partner_connected := false

# Pending-join flag: host is in-race when a client connects.
var _net_join_pending := false

# Internal: true once connected_to_server fired (client side).
var _client_connected := false

# ---------------------------------------------------------------- lifecycle

func _ready() -> void:
	# Disconnect signals are wired permanently here so they survive scene changes.
	multiplayer.peer_connected.connect(_on_peer_connected)
	multiplayer.peer_disconnected.connect(_on_peer_disconnected)
	multiplayer.connected_to_server.connect(_on_connected_to_server)
	multiplayer.connection_failed.connect(_on_connection_failed)
	multiplayer.server_disconnected.connect(_on_server_disconnected)

# ---------------------------------------------------------------- public API

func is_online() -> bool:
	return multiplayer.multiplayer_peer != null and \
		multiplayer.multiplayer_peer.get_connection_status() != MultiplayerPeer.CONNECTION_DISCONNECTED

# Returns the role string: "host", "client", or "" (offline).
func role() -> String:
	if not is_online():
		return ""
	if multiplayer.is_server():
		return "host"
	return "client"

# Create the ENet server if not already connected.
# Returns OK on success or an error code.
func host_server() -> int:
	if is_online():
		return OK   # already up — idempotent
	var peer := ENetMultiplayerPeer.new()
	var err: int = peer.create_server(PORT, 3)
	if err != OK:
		return err
	multiplayer.multiplayer_peer = peer
	is_host = true
	partner_connected = false
	return OK

# Connect to a remote host as a client. addr may include ":port".
# Returns OK on success or an error code.
func join_client(addr: String) -> int:
	if is_online():
		return OK   # already connected — idempotent
	var host := addr.strip_edges()
	var port: int = PORT
	if host.contains(":"):
		var bits := host.split(":")
		host = bits[0].strip_edges()
		if bits.size() > 1 and bits[1].strip_edges().is_valid_int():
			port = int(bits[1].strip_edges())
	if host == "":
		host = "127.0.0.1"
	var peer := ENetMultiplayerPeer.new()
	var err: int = peer.create_client(host, port)
	if err != OK:
		return err
	multiplayer.multiplayer_peer = peer
	is_host = false
	_client_connected = false
	return OK

# Cleanly close the connection (called on "quit to menu" in online-season context).
func disconnect_peer() -> void:
	if multiplayer.multiplayer_peer != null:
		multiplayer.multiplayer_peer.close()
		multiplayer.multiplayer_peer = null
	is_host = false
	partner_connected = false
	_client_connected = false
	_net_join_pending = false

# ---------------------------------------------------------------- signal handlers (permanent)

func _on_peer_connected(id: int) -> void:
	if not multiplayer.is_server():
		return
	partner_connected = true
	# Determine whether we are in the paddock hub or in the race scene.
	# Only send net_season_full when we are in the hub (season_hub.tscn).
	# If the current scene is main.tscn (race), the existing race RPCs handle
	# the mid-race join (net_assign / net_snapshot) — we don't interfere.
	var scene := get_tree().current_scene
	var in_hub: bool = scene != null and scene.name == "SeasonHub"
	if in_hub and Season.active != null:
		# Host is in the paddock: send the full season state to the new client.
		net_season_full.rpc_id(id, Season.active.to_dict())
	else:
		# Either in-race or no season active: flag for deferred handling.
		_net_join_pending = true

func _on_peer_disconnected(_id: int) -> void:
	if multiplayer.is_server():
		partner_connected = false
		# Notify the hub (if it is the active scene) via a scene-agnostic group call.
		get_tree().call_group("season_hub", "_on_partner_disconnected")
	else:
		# Client lost the server while in the hub — will be handled via server_disconnected.
		pass

func _on_connected_to_server() -> void:
	_client_connected = true
	# Client immediately requests the current season state from the host.
	net_season_hello.rpc_id(1)

func _on_connection_failed() -> void:
	_client_connected = false
	multiplayer.multiplayer_peer = null

func _on_server_disconnected() -> void:
	_client_connected = false
	partner_connected = false
	multiplayer.multiplayer_peer = null
	is_host = false
	# Notify any active hub that the host dropped.
	get_tree().call_group("season_hub", "_on_host_disconnected")

# ---------------------------------------------------------------- season-level RPCs
# All declared on /root/Net (this node) so they survive scene changes.
# Reliable channel; direction noted in name comments.

# client → host: "I just connected, send me the season state".
@rpc("any_peer", "call_remote", "reliable")
func net_season_hello() -> void:
	if not multiplayer.is_server():
		return
	if Season.active == null:
		return
	var sender_id: int = multiplayer.get_remote_sender_id()
	net_season_full.rpc_id(sender_id, Season.active.to_dict())

# host → client: full season state.  Client reconstructs its mirror from this.
@rpc("authority", "call_remote", "reliable")
func net_season_full(state: Dictionary) -> void:
	# Ignore on host (should never arrive, but guard anyway).
	if multiplayer.is_server():
		return
	Season.active = Season.from_dict(state)
	# Navigate to the paddock hub if we are not already there.
	var tree := get_tree()
	if tree.current_scene == null or tree.current_scene.name != "SeasonHub":
		tree.change_scene_to_file("res://season_hub.tscn")

# client → host: buy one part level for part_key.
@rpc("any_peer", "call_remote", "reliable")
func net_season_buy_part(part_key: String) -> void:
	if not multiplayer.is_server():
		return
	if Season.active == null:
		return
	var part_name: String = part_key
	var pdef: Variant = F1_2026.PARTS.get(part_key, null)
	if pdef != null:
		var lbl: String = String((pdef as Dictionary).get("label", part_key))
		part_name = lbl
	if Season.active.dev_run_project(part_key):
		Season.active.save_to_disk()
		net_season_full.rpc(Season.active.to_dict())
		net_season_feed.rpc("Партнёр: проект «%s»" % part_name)
		# Notify local hub to refresh.
		get_tree().call_group("season_hub", "_on_season_updated")

# client → host: buy one tyre programme level.
@rpc("any_peer", "call_remote", "reliable")
func net_season_buy_tyre() -> void:
	if not multiplayer.is_server():
		return
	if Season.active == null:
		return
	if Season.active.buy_tyre():
		Season.active.save_to_disk()
		net_season_full.rpc(Season.active.to_dict())
		net_season_feed.rpc("Партнёр: куплена шинная программа")
		get_tree().call_group("season_hub", "_on_season_updated")

# client → host: sign a sponsor from the market by offer id (M1).
# Host applies, autosaves, rebroadcasts net_season_full + net_season_feed.
@rpc("any_peer", "call_remote", "reliable")
func net_season_sign_sponsor(offer_id: int) -> void:
	if not multiplayer.is_server():
		return
	if Season.active == null:
		return
	var offers: Array = Season.active.list_sponsor_offers()
	var sp_name: String = "?"
	for sp in offers:
		if int((sp as Dictionary).get("id", -1)) == offer_id:
			sp_name = String((sp as Dictionary).get("name", "?"))
			break
	if Season.active.sign_sponsor(offer_id):
		Season.active.save_to_disk()
		net_season_full.rpc(Season.active.to_dict())
		net_season_feed.rpc("Партнёр: подписан спонсор «%s»" % sp_name)
		get_tree().call_group("season_hub", "_on_season_updated")

# client → host: switch a supplier ("brake"/"fuel") to the given key (M3).
@rpc("any_peer", "call_remote", "reliable")
func net_season_set_supplier(kind: String, key: String) -> void:
	if not multiplayer.is_server():
		return
	if Season.active == null:
		return
	if Season.active.set_supplier(kind, key):
		Season.active.save_to_disk()
		net_season_full.rpc(Season.active.to_dict())
		var label: String = String(Season.active.supplier_def(kind).get("label", key))
		net_season_feed.rpc("Партнёр: выбран поставщик «%s»" % label)
		get_tree().call_group("season_hub", "_on_season_updated")

# client → host: buy a transferable part from its supplier (M3).
@rpc("any_peer", "call_remote", "reliable")
func net_season_buy_supplier_part(part_key: String) -> void:
	if not multiplayer.is_server():
		return
	if Season.active == null:
		return
	if Season.active.buy_part_supplier(part_key):
		Season.active.save_to_disk()
		net_season_full.rpc(Season.active.to_dict())
		var pdef: Variant = F1_2026.PARTS.get(part_key, null)
		var part_name: String = part_key
		if pdef != null:
			part_name = String((pdef as Dictionary).get("label", part_key))
		net_season_feed.rpc("Партнёр: куплена деталь «%s» у поставщика" % part_name)
		get_tree().call_group("season_hub", "_on_season_updated")

# client → host: replace a worn developed part (CAR-2).
@rpc("any_peer", "call_remote", "reliable")
func net_season_replace_part(part_key: String) -> void:
	if not multiplayer.is_server():
		return
	if Season.active == null:
		return
	if Season.active.replace_part(part_key):
		Season.active.save_to_disk()
		net_season_full.rpc(Season.active.to_dict())
		var pdef: Variant = F1_2026.PARTS.get(part_key, null)
		var part_name: String = part_key
		if pdef != null:
			part_name = String((pdef as Dictionary).get("label", part_key))
		net_season_feed.rpc("Партнёр: заменена деталь «%s»" % part_name)
		get_tree().call_group("season_hub", "_on_season_updated")

# client → host: sign a scouting-market junior (M5).
@rpc("any_peer", "call_remote", "reliable")
func net_season_sign_junior(junior_id: int) -> void:
	if not multiplayer.is_server():
		return
	if Season.active == null:
		return
	if Season.active.sign_junior(junior_id):
		Season.active.save_to_disk()
		net_season_full.rpc(Season.active.to_dict())
		net_season_feed.rpc("Партнёр: подписан юниор в академию")
		get_tree().call_group("season_hub", "_on_season_updated")

# client → host: promote a junior (>=40 superlicense pts) into an F1 seat (M5).
@rpc("any_peer", "call_remote", "reliable")
func net_season_promote_junior(ji: int, driver_id: int) -> void:
	if not multiplayer.is_server():
		return
	if Season.active == null:
		return
	if Season.active.promote_junior(ji, driver_id):
		Season.active.save_to_disk()
		net_season_full.rpc(Season.active.to_dict())
		net_season_feed.rpc("Партнёр: юниор повышен в Формулу-1 (%s)" %
			Season.active.driver_name(driver_id))
		get_tree().call_group("season_hub", "_on_season_updated")

# client → host: loan a junior to the PU-alliance client team (M5).
@rpc("any_peer", "call_remote", "reliable")
func net_season_loan_junior(ji: int) -> void:
	if not multiplayer.is_server():
		return
	if Season.active == null:
		return
	if Season.active.loan_junior(ji):
		Season.active.save_to_disk()
		net_season_full.rpc(Season.active.to_dict())
		net_season_feed.rpc("Партнёр: юниор одолжен клиентской команде")
		get_tree().call_group("season_hub", "_on_season_updated")

# client → host: schedule/clear the test-driver stand-in for next race (M5).
@rpc("any_peer", "call_remote", "reliable")
func net_season_set_testdrive(driver_id: int) -> void:
	if not multiplayer.is_server():
		return
	if Season.active == null:
		return
	if Season.active.set_test_drive(driver_id):
		Season.active.save_to_disk()
		net_season_full.rpc(Season.active.to_dict())
		var msg: String = "Партнёр: тест-пилот отменён"
		if driver_id >= 0:
			msg = "Партнёр: тест-пилот заменит %s" % Season.active.driver_name(driver_id)
		net_season_feed.rpc(msg)
		get_tree().call_group("season_hub", "_on_season_updated")

# client → host: train one pit-crew role for $25k (M4).
@rpc("any_peer", "call_remote", "reliable")
func net_season_train_pit(role: String) -> void:
	if not multiplayer.is_server():
		return
	if Season.active == null:
		return
	if Season.active.train_pit_role(role) == "ok":
		Season.active.save_to_disk()
		net_season_full.rpc(Season.active.to_dict())
		net_season_feed.rpc("Партнёр: тренировка пит-экипажа (%s)" %
			Season.active.staff_role_ru(role))
		get_tree().call_group("season_hub", "_on_season_updated")

# client → host: make a driver the team's FIRST driver (M4 status).
@rpc("any_peer", "call_remote", "reliable")
func net_season_set_first(driver_id: int) -> void:
	if not multiplayer.is_server():
		return
	if Season.active == null:
		return
	if Season.active.set_first_driver(driver_id):
		Season.active.save_to_disk()
		net_season_full.rpc(Season.active.to_dict())
		net_season_feed.rpc("Партнёр: первый пилот — %s" %
			Season.active.driver_name(driver_id))
		get_tree().call_group("season_hub", "_on_season_updated")

# client → host: poach a staff-market candidate by id (M2).
# Host applies (deterministic roll), autosaves, rebroadcasts state + feed.
@rpc("any_peer", "call_remote", "reliable")
func net_season_hire_staff(cand_id: int) -> void:
	if not multiplayer.is_server():
		return
	if Season.active == null:
		return
	Season.active.ensure_staff_market()
	var cand_name: String = "?"
	for cand in Season.active.staff_market:
		if int((cand as Dictionary).get("id", -1)) == cand_id:
			cand_name = String((cand as Dictionary).get("name", "?"))
			break
	var result: String = Season.active.hire_staff(cand_id)
	if result == "hired" or result == "refused":
		Season.active.save_to_disk()
		net_season_full.rpc(Season.active.to_dict())
		var verb: String = "нанят" if result == "hired" else "отказался"
		net_season_feed.rpc("Партнёр: переманивание — %s %s" % [cand_name, verb])
		get_tree().call_group("season_hub", "_on_season_updated")

# client → host: start building an HQ facility (HQ buildings system).
@rpc("any_peer", "call_remote", "reliable")
func net_season_hq_build(building_id: String) -> void:
	if not multiplayer.is_server():
		return
	if Season.active == null:
		return
	if Season.active.hq_start_build(building_id):
		Season.active.save_to_disk()
		net_season_full.rpc(Season.active.to_dict())
		var bname: String = building_id
		var bdef: Variant = Season.HQ_BUILDINGS.get(building_id, null)
		if bdef != null:
			bname = String((bdef as Dictionary).get("name", building_id))
		net_season_feed.rpc("Партнёр: строится «%s»" % bname)
		get_tree().call_group("season_hub", "_on_season_updated")

# client → host: readiness ping (informational; not required to start the race).
@rpc("any_peer", "call_remote", "reliable")
func net_season_ready(ready: bool) -> void:
	if not multiplayer.is_server():
		return
	# Broadcast an informational feed line so the host (and client) see it.
	var state_word: String = "готов к старту" if ready else "не готов"
	net_season_feed.rpc("Партнёр: %s" % state_word)

# host → client: a feed line to display ("Партнёр: …").
@rpc("authority", "call_remote", "reliable")
func net_season_feed(line: String) -> void:
	if multiplayer.is_server():
		return
	get_tree().call_group("season_hub", "_on_feed_line", line)

# host → client: start the race now (move to main.tscn as client).
# track_name and seed_val are carried for future use (mid-race join / display);
# v1 uses them for the feed line so they are "consumed" (lint-safe).
@rpc("authority", "call_remote", "reliable")
func net_season_start_race(track_name: String, seed_val: int) -> void:
	if multiplayer.is_server():
		return
	# Log so the parameters are considered used (v1 doesn't need them beyond acknowledgement).
	print("Net: net_season_start_race track=%s seed=%d" % [track_name, seed_val])
	# Store the race pending flag in the active season mirror.
	if Season.active != null:
		Season.active.race_pending = true
	# Client transitions to main.tscn which will start in client mode.
	get_tree().change_scene_to_file("res://main.tscn")
