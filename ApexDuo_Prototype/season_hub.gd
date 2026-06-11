extends Control

# ============================================================================
# Apex Duo — paddock hub (between races). Reads Season.active.
# Shows championship standings, budget, R&D upgrades, and starts the next race.
#
# Layout (tabbed):
#   Persistent header: team name, round info, money/RP chips, action buttons.
#   Online status/feed line (when networked).
#   Tab bar: ОБЗОР | БОЛИД | СПОНСОРЫ | ШТАБ | ПИЛОТЫ
#   Page area: ScrollContainer + VBox populated from _build_* helpers.
#
# Tab state: _active_tab (int, 0-based) is a plain member var.
# _rebuild() rebuilds the whole UI; the active tab index is written to
# Season.active.hub_tab before rebuild and restored from it — survives
# scene re-entry because Season.active persists across scene changes.
#
# Online-season networking:
#   Host: authoritative — buys/upgrades, saves, broadcasts via Net RPC.
#   Client: mirror — buttons send net_season_* RPCs instead of mutating Season.
#   The group "season_hub" is used by Net to deliver callbacks here.
# ============================================================================

# Palette aliases — route to Palette (theme.gd) for formal colours.
const ACCENT   := Palette.WINE
const TEAM_COL := Palette.P5
const ENGI_COL := Palette.P6
const BG       := Palette.BG
const PANEL    := Palette.PANEL
const MUTED    := Palette.MUTED_HEX

# Tab indices
const TAB_OVERVIEW  := 0
const TAB_CAR       := 1
const TAB_SPONSORS  := 2
const TAB_STAFF     := 3
const TAB_PILOTS    := 4
const TAB_BASE      := 5

const TAB_NAMES: Array = ["ОБЗОР", "БОЛИД", "СПОНСОРЫ", "ШТАБ", "ПИЛОТЫ", "БАЗА"]

# Active tab — static so it survives scene re-entry (the script class persists
# in memory even after scene change; reset to 0 when season starts fresh).
static var _active_tab: int = 0

# Feed lines for the partner-action log (newest-first, max 5 entries).
var _feed_lines: Array = []
var _feed_label: Label

func _ready() -> void:
	theme = Palette.base_theme()
	add_child(Palette.vignette_layer())
	if Season.active == null:
		get_tree().change_scene_to_file("res://main.tscn")
		return
	# Register with the "season_hub" group so Net can deliver callbacks here.
	add_to_group("season_hub")
	# Clamp active tab in case TAB_NAMES length changes across updates.
	_active_tab = clampi(_active_tab, 0, TAB_NAMES.size() - 1)
	# Only the host autosaves; clients never write the season file (spec §0.6).
	if Net.role() != "client":
		Season.active.save_to_disk()
	# Host: send the initial season state to any connected client.
	if Net.role() == "host" and Net.partner_connected:
		Net.net_season_full.rpc(Season.active.to_dict())
	_rebuild()
	_show_pending_event()

# Called by Net when the host broadcasts net_season_full (client side only).
func _on_season_updated() -> void:
	_rebuild()

# Called by Net on both sides after a partner action (feed line from net_season_feed).
func _on_feed_line(line: String) -> void:
	_feed_lines.push_front(line)
	if _feed_lines.size() > 5:
		_feed_lines.resize(5)
	_update_feed_label()

# Called by Net when the partner disconnects (host side).
func _on_partner_disconnected() -> void:
	_on_feed_line("Партнёр отключился — следующую гонку P6 ведёт ИИ")
	_rebuild()

# Called by Net when the host disconnects (client side).
func _on_host_disconnected() -> void:
	Season.active = null
	get_tree().change_scene_to_file("res://main.tscn")

func _update_feed_label() -> void:
	if _feed_label == null:
		return
	if _feed_lines.is_empty():
		_feed_label.text = ""
		return
	_feed_label.text = "\n".join(_feed_lines)

# ---------------------------------------------------------------- rebuild
# Full rebuild: clears children, builds sidebar + tab content area.
func _rebuild() -> void:
	for c in get_children():
		c.queue_free()
	_feed_label = null   # reset reference — will be reassigned below

	var bg := ColorRect.new()
	bg.color = DesignSystem.BG_PRIMARY
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(bg)

	var root := HBoxContainer.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.add_theme_constant_override("separation", 0)
	add_child(root)

	# ── Sidebar ─────────────────────────────────────────────────────────────
	var sidebar := _build_sidebar()
	root.add_child(sidebar)

	# ── Main content ────────────────────────────────────────────────────────
	var content := _build_tab_content(_active_tab)
	content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	content.size_flags_vertical   = Control.SIZE_EXPAND_FILL
	root.add_child(content)


func _build_sidebar() -> PanelContainer:
	var s := Season.active
	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(148.0, 0.0)
	var sb := StyleBoxFlat.new()
	sb.bg_color = DesignSystem.BG_CARD
	sb.border_color = DesignSystem.BORDER
	sb.border_width_right = 1
	sb.content_margin_top    = 0.0
	sb.content_margin_bottom = 0.0
	sb.content_margin_left   = 0.0
	sb.content_margin_right  = 0.0
	panel.add_theme_stylebox_override("panel", sb)

	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 0)
	panel.add_child(col)

	# Team identity block
	var id_row := HBoxContainer.new()
	id_row.add_theme_constant_override("separation", DesignSystem.SP_SM)
	id_row.custom_minimum_size = Vector2(0.0, 52.0)
	var margin_id := MarginContainer.new()
	for side: String in ["left", "right", "top", "bottom"]:
		margin_id.add_theme_constant_override("margin_" + side, DesignSystem.SP_MD)
	margin_id.add_child(id_row)
	col.add_child(margin_id)

	var team_data: Dictionary = F1_2026.TEAMS[s.player_team]
	var team_color: Color = Color(String(team_data.get("color", "#888888")))
	var stripe := DesignSystem.make_team_stripe(team_color)
	id_row.add_child(stripe)

	var id_col := VBoxContainer.new()
	id_col.add_theme_constant_override("separation", 2)
	id_row.add_child(id_col)
	var name_lbl := Label.new()
	name_lbl.text = s.team_name
	name_lbl.add_theme_color_override("font_color", team_color)
	name_lbl.add_theme_font_size_override("font_size", 11)
	id_col.add_child(name_lbl)
	var standing_lbl := Label.new()
	var cpts: int = s.constructor_points()
	standing_lbl.text = "P%d · %d очков" % [_team_position(s), cpts]
	standing_lbl.add_theme_color_override("font_color", DesignSystem.TEXT_3)
	standing_lbl.add_theme_font_size_override("font_size", 9)
	id_col.add_child(standing_lbl)

	# Divider
	var div := HSeparator.new()
	div.add_theme_color_override("color", DesignSystem.BORDER)
	col.add_child(div)

	# Nav tabs
	for i: int in range(TAB_NAMES.size()):
		var nav_item := _make_nav_item(i, String(TAB_NAMES[i]))
		col.add_child(nav_item)

	return panel


func _make_nav_item(idx: int, label: String) -> PanelContainer:
	var active: bool = idx == _active_tab
	var panel := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = DesignSystem.BG_RAISED if active else Color(0.0, 0.0, 0.0, 0.0)
	sb.border_color = DesignSystem.GOLD if active else Color(0.0, 0.0, 0.0, 0.0)
	sb.border_width_right = 2 if active else 0
	sb.content_margin_left   = float(DesignSystem.SP_LG)
	sb.content_margin_right  = float(DesignSystem.SP_SM)
	sb.content_margin_top    = float(DesignSystem.SP_SM)
	sb.content_margin_bottom = float(DesignSystem.SP_SM)
	panel.add_theme_stylebox_override("panel", sb)

	var lbl := Label.new()
	lbl.text = label
	lbl.add_theme_color_override("font_color", DesignSystem.GOLD if active else DesignSystem.TEXT_3)
	lbl.add_theme_font_size_override("font_size", 10)
	panel.add_child(lbl)

	var i_cap := idx
	panel.gui_input.connect(func(event: InputEvent):
		if event is InputEventMouseButton and (event as InputEventMouseButton).pressed:
			_active_tab = i_cap
			_rebuild()
	)
	return panel


func _team_position(s: Season) -> int:
	var team_pts: int = s.constructor_points()
	var pos: int = 1
	# Count how many rival teams have more constructor points than we do.
	# s.standings maps driver_id -> points; rival ids are NOT in TEAM_IDS.
	var rival_pts_by_team: Dictionary = {}
	for id in s.standings:
		if id in Season.TEAM_IDS:
			continue
		# Pair ids: 0/1 -> team0, 2/3 -> team1, etc. (grid order pairs).
		var tid: int = int(id) / 2
		var prev: int = rival_pts_by_team.get(tid, 0)
		rival_pts_by_team[tid] = prev + int(s.standings[id])
	for tid in rival_pts_by_team:
		if int(rival_pts_by_team[tid]) > team_pts:
			pos += 1
	return pos


func _build_tab_content(tab: int) -> Control:
	var s: Season = Season.active
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED

	var margin := MarginContainer.new()
	margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side: String in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, DesignSystem.SP_LG)
	scroll.add_child(margin)

	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", DesignSystem.SP_LG)
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	margin.add_child(col)

	match tab:
		TAB_OVERVIEW: _build_tab_overview(col, s)
		TAB_CAR:      _build_tab_car(col, s)
		TAB_SPONSORS: _build_tab_sponsors_ds(col, s)
		TAB_STAFF:    _build_tab_staff_ds(col, s)
		TAB_PILOTS:   _build_tab_pilots_ds(col, s)
	return scroll


func _build_tab_overview(col: VBoxContainer, s: Season) -> void:
	col.add_child(DesignSystem.make_section_header("СЛЕДУЮЩАЯ ГОНКА"))

	var track_name: String = "—"
	if s.round_index < s.calendar.size():
		track_name = s.round_name()

	var stats_row := HBoxContainer.new()
	stats_row.add_theme_constant_override("separation", DesignSystem.SP_SM)
	var cpts: int = s.constructor_points()
	stats_row.add_child(DesignSystem.make_stat_label("ТРАССА", track_name, DesignSystem.TEXT_1))
	stats_row.add_child(DesignSystem.make_stat_label("ОЧКИ", str(cpts), DesignSystem.GOLD))
	var budget_str: String = "$%dM" % int(s.money / 1_000_000.0)
	stats_row.add_child(DesignSystem.make_stat_label("БЮДЖЕТ", budget_str, DesignSystem.GREEN))
	for child in stats_row.get_children():
		(child as Control).size_flags_horizontal = Control.SIZE_EXPAND_FILL
	col.add_child(stats_row)

	col.add_child(DesignSystem.make_section_header("ГОНКА"))
	var btn_race: Button = DesignSystem.make_button("▶ К ГОНКЕ", "primary")
	btn_race.custom_minimum_size = Vector2(0.0, 44.0)
	btn_race.pressed.connect(_on_start_race)
	col.add_child(btn_race)

	# Also embed the full legacy overview content below
	_build_page_overview(col, s)


func _build_tab_car(col: VBoxContainer, s: Season) -> void:
	col.add_child(DesignSystem.make_section_header("РАЗВИТИЕ БОЛИДА"))

	var branch_names: Array = ["АЭРОДИНАМИКА", "МОТОР", "ЭНЕРГИЯ", "НАДЁЖНОСТЬ"]
	var branch_keys: Array  = ["aero", "power", "energy", "reliability"]

	for bi: int in range(branch_names.size()):
		var key: String = String(branch_keys[bi])
		# Sum part_levels for all parts belonging to this group
		var group_level: int = 0
		var group_max: int = 0
		for pk: String in F1_2026.PARTS:
			var pdef: Dictionary = F1_2026.PARTS[pk]
			if String(pdef.get("group", "")) == key:
				group_level += int(s.part_levels.get(pk, 0))
				group_max   += int(pdef.get("max_level", 1))
		var progress: float = float(group_level) / float(maxi(group_max, 1))

		var inner_col := VBoxContainer.new()
		inner_col.add_theme_constant_override("separation", DesignSystem.SP_SM)
		var pb_dict: Dictionary = DesignSystem.make_progress_bar(
			"Ур. %d / %d" % [group_level, group_max], progress, 1.0, DesignSystem.GOLD)
		inner_col.add_child(pb_dict["node"])

		var card_title: String = String(branch_names[bi]) + " (%d/%d)" % [group_level, group_max]
		col.add_child(DesignSystem.make_card(card_title, inner_col))

	# Also embed the full legacy car content below
	_build_page_car(col, s)


func _build_tab_sponsors_ds(col: VBoxContainer, s: Season) -> void:
	col.add_child(DesignSystem.make_section_header("СПОНСОРЫ"))
	col.add_child(_build_sponsors(s))


func _build_tab_staff_ds(col: VBoxContainer, s: Season) -> void:
	col.add_child(DesignSystem.make_section_header("ПЕРСОНАЛ"))
	_build_page_staff(col, s)


func _build_tab_pilots_ds(col: VBoxContainer, s: Season) -> void:
	col.add_child(DesignSystem.make_section_header("ПИЛОТЫ"))
	_build_page_pilots(col, s)


func _on_start_race() -> void:
	var s := Season.active
	if s == null:
		return
	s.race_pending = true
	get_tree().change_scene_to_file("res://main.tscn")


func _on_rd_invest(_key: String) -> void:
	pass

# ---- Persistent header ----
# Contains: team name + round info, money/RP/cost-cap chips, action buttons.
func _build_header(s: Season) -> Control:
	var pc := _panel()
	pc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 6)

	# Team name + round line
	var title := _hlabel("ПАДДОК · %s" % s.team_name, 28, Palette.GOLD_HEX, 2)
	v.add_child(title)

	var round_txt: String
	if s.is_complete():
		round_txt = "Сезон завершён · чемпион: %s" % s.champion_name()
	else:
		round_txt = "Этап %d из %d — %s" % [s.round_index + 1, s.total_rounds(), s.round_name()]
	v.add_child(_label(round_txt, 16, MUTED))

	if not s.is_complete():
		v.add_child(_label("Следующая трасса: %s · %s" % [
			s.round_name(), _arch_ru(s.round_archetype())], 13, Palette.WARN_HEX))

	# Budget / RP / constructor points chips row
	var chips := HBoxContainer.new()
	chips.add_theme_constant_override("separation", 14)
	chips.add_child(_label("Бюджет: $%s" % _money(s.money), 15, Palette.GOOD_HEX))
	chips.add_child(_label("R&D: %d оч." % s.rp, 15, Palette.INFO_HEX))
	chips.add_child(_label("Конструкторы: %d оч." % s.constructor_points(), 15, Palette.CREAM_HEX))
	# Cost-cap chip
	var cap_col: String
	if s.cumulative_salary_spend > s.SALARY_CAP:
		cap_col = Palette.DANG_HEX
	elif s.cumulative_salary_spend > s.SALARY_CAP * 3 / 4:
		cap_col = Palette.WARN_HEX
	else:
		cap_col = Palette.FINE_HEX
	chips.add_child(_label(s.cap_status_text(), 13, cap_col))
	v.add_child(chips)

	v.add_child(_label("Прогресс автоматически сохранён — можно выйти и продолжить позже.",
		12, Palette.FINE_HEX))

	# ---- ACTION BUTTONS ----
	var bar := HBoxContainer.new()
	bar.add_theme_constant_override("separation", 10)

	var net_role2: String = Net.role()
	if s.is_complete():
		var to_menu := _button("В главное меню", 16)
		to_menu.pressed.connect(func():
			Season.delete_save()
			Season.active = null
			if net_role2 != "":
				Net.disconnect_peer()
			get_tree().change_scene_to_file("res://main.tscn"))
		bar.add_child(to_menu)
	elif net_role2 == "client":
		var ready_btn := _button("✔ Готов к старту", 15)
		ready_btn.pressed.connect(func():
			Net.net_season_ready.rpc_id(1, true))
		bar.add_child(ready_btn)
		var spacer_c := Control.new()
		spacer_c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		bar.add_child(spacer_c)
		var quit_c := _button("Выйти в меню", 14)
		quit_c.pressed.connect(func():
			Net.disconnect_peer()
			Season.active = null
			get_tree().change_scene_to_file("res://main.tscn"))
		bar.add_child(quit_c)
	else:
		# Host or local/solo: full controls.
		var mode_txt: String
		if net_role2 == "host":
			mode_txt = "онлайн-хост"
		elif s.coop:
			mode_txt = "лок. кооп"
		else:
			mode_txt = "соло"
		var start := _button("Старт гонки →  (%s)" % mode_txt, 17)
		start.custom_minimum_size = Vector2(240, 40)
		start.pressed.connect(func():
			s.race_pending = true
			if net_role2 == "host":
				var track_name: String = s.round_name()
				Net.net_season_start_race.rpc(track_name, 0)
			get_tree().change_scene_to_file("res://main.tscn"))
		bar.add_child(start)
		if net_role2 != "host":
			var quick := _button("⏩ Симулировать этап", 14)
			quick.pressed.connect(func():
				s.race_pending = true
				s.race_quick = true
				get_tree().change_scene_to_file("res://main.tscn"))
			bar.add_child(quick)
		var profile := _button("Пилоты", 14)
		profile.pressed.connect(func(): get_tree().change_scene_to_file("res://driver_profile.tscn"))
		bar.add_child(profile)
		var statsb := _button("Статистика", 14)
		statsb.pressed.connect(func(): get_tree().change_scene_to_file("res://stats.tscn"))
		bar.add_child(statsb)
		var spacer := Control.new()
		spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		bar.add_child(spacer)
		var quit := _button("Выйти в меню", 14)
		quit.pressed.connect(func():
			Season.active = null
			if net_role2 != "":
				Net.disconnect_peer()
			get_tree().change_scene_to_file("res://main.tscn"))
		bar.add_child(quit)

	v.add_child(bar)
	pc.add_child(v)
	return pc

# ---- Tab bar ----
# Gold underline on active tab; PANEL2 fill; muted text on inactive tabs.
func _build_tab_bar() -> Control:
	var hb := HBoxContainer.new()
	hb.add_theme_constant_override("separation", 2)
	for i in TAB_NAMES.size():
		var tab_name: String = String(TAB_NAMES[i])
		var btn := Button.new()
		btn.text = tab_name
		btn.add_theme_font_size_override("font_size", 14)
		btn.add_theme_font_override("font", Palette.display_font(600, 1))
		btn.custom_minimum_size = Vector2(110, 36)
		btn.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var is_active: bool = i == _active_tab
		var sb_normal := StyleBoxFlat.new()
		sb_normal.bg_color = Palette.PANEL2 if is_active else Palette.PANEL
		sb_normal.set_corner_radius_all(0)
		sb_normal.set_border_width_all(1)
		sb_normal.border_color = Palette.DIV
		if is_active:
			# Gold bottom border = active indicator
			sb_normal.border_color = Palette.GOLD
			sb_normal.set_content_margin_all(6)
		else:
			sb_normal.set_content_margin_all(6)
		btn.add_theme_stylebox_override("normal", sb_normal)
		btn.add_theme_stylebox_override("pressed", sb_normal)
		var hover_sb := StyleBoxFlat.new()
		hover_sb.bg_color = Palette.PANEL2
		hover_sb.set_corner_radius_all(0)
		hover_sb.set_border_width_all(1)
		hover_sb.border_color = Palette.GOLD_D
		hover_sb.set_content_margin_all(6)
		btn.add_theme_stylebox_override("hover", hover_sb)
		var text_col: String = Palette.GOLD_HEX if is_active else Palette.MUTED_HEX
		btn.add_theme_color_override("font_color", Color(text_col))
		btn.add_theme_color_override("font_hover_color", Color(Palette.CREAM_HEX))
		btn.add_theme_color_override("font_pressed_color", Color(Palette.GOLD_HEX))
		var tab_idx := i   # capture for closure
		btn.pressed.connect(func():
			_active_tab = tab_idx
			_rebuild())
		hb.add_child(btn)
	return hb

# ---- Page content dispatcher ----
func _populate_page(v: VBoxContainer, s: Season) -> void:
	match _active_tab:
		TAB_OVERVIEW:
			_build_page_overview(v, s)
		TAB_CAR:
			_build_page_car(v, s)
		TAB_SPONSORS:
			v.add_child(_build_sponsors(s))
		TAB_STAFF:
			_build_page_staff(v, s)
		TAB_PILOTS:
			_build_page_pilots(v, s)
		TAB_BASE:
			_build_page_base(v, s)

# ================================================================ PAGE: ОБЗОР
func _build_page_overview(v: VBoxContainer, s: Season) -> void:
	# Driver portrait cards
	var drow := HBoxContainer.new()
	drow.add_theme_constant_override("separation", 12)
	var dslot := 0
	for id in Season.TEAM_IDS:
		drow.add_child(_driver_card(s, int(id), dslot))
		dslot += 1
	v.add_child(drow)

	# FM-style season statistics
	v.add_child(_label("Статистика сезона:", 14, Palette.MUTED_HEX))
	for id in Season.TEAM_IDS:
		var st: Dictionary = s.stat_of(id)
		var best_txt: String = "—" if int(st["best"]) == 0 else str(int(st["best"]))
		v.add_child(_label("%s — гонок %d · побед %d · подиумов %d · обгонов %d · лучший P%s · мест +%d" % [
			s.driver_name(id), int(st["races"]), int(st["wins"]), int(st["podiums"]),
			int(st["overtakes"]), best_txt, int(st["gained"])], 13, Palette.CREAM_HEX))
	var lw: Dictionary = s.stats_leader("wins")
	if not lw.is_empty() and int(lw["val"]) > 0:
		var lo: Dictionary = s.stats_leader("overtakes")
		v.add_child(_label("Лидеры сезона: побед — %s (%d) · обгонов — %s (%d)" % [
			lw["name"], int(lw["val"]), lo["name"], int(lo["val"])], 13, Palette.INFO_HEX))

	if not s.last_summary.is_empty():
		var ls: Dictionary = s.last_summary
		v.add_child(_label("Прошлый этап: команда +%d очк., +$%s призовых." % [
			ls["pts"], _money(ls["money"])], 15, Palette.INFO_HEX))

	# M1: income-per-round summary line
	var inc: int = s.income_per_round()
	var cpos: int = s.constructor_position()
	var prize_line: int = s.constructor_prize(cpos)
	v.add_child(_label(
		"Доход/этап (прогноз): $%s  (призовые P%d: $%s + спонсоры: $%s)" % [
			_money(inc), cpos, _money(prize_line), _money(inc - prize_line)],
		15, Palette.GOOD_HEX))

	v.add_child(_label("Сложность: %s · цель команды: %s" % [
		s.difficulty_name(), s.goal], 14, Palette.INFO_HEX))

	# Championship standings table
	v.add_child(_build_standings(s))

# ================================================================ PAGE: БОЛИД
func _build_car_stats(s: Season) -> Control:
	s.apply_car_rd()
	var car: Dictionary = F1_2026.team_car(s.player_team)
	var power_val: float = float(car.get("power", 0.0))
	var aero_val: float = float(car.get("aero", 0.0))
	var energy_val: float = float(car.get("energy", 0.0))
	var rel_val: float = float(car.get("rel", 0.0))

	var pc := _panel()
	pc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	v.add_child(_hlabel("ХАРАКТЕРИСТИКИ БОЛИДА", 16, Palette.CREAM_HEX))

	var stats: Array = [
		["МОЩНОСТЬ",    power_val,  Palette.WARN_HEX],
		["АЭРО",        aero_val,   Palette.GOLD_HEX],
		["ЭНЕРГИЯ",     energy_val, Palette.INFO_HEX],
		["НАДЁЖНОСТЬ",  rel_val,    Palette.GOOD_HEX],
	]

	for si: int in range(stats.size()):
		var stat_info: Array = stats[si]
		var stat_name: String = String(stat_info[0])
		var stat_val: float = float(stat_info[1])
		var stat_col: String = String(stat_info[2])

		var row_lbl := HBoxContainer.new()
		row_lbl.add_theme_constant_override("separation", 4)
		var name_l := _label(stat_name, 12, stat_col)
		name_l.custom_minimum_size = Vector2(110.0, 0.0)
		row_lbl.add_child(name_l)
		row_lbl.add_child(_label("%d%%" % int(round(stat_val * 100.0)), 12, Palette.CREAM_HEX))
		v.add_child(row_lbl)

		var pb := ProgressBar.new()
		pb.show_percentage = false
		pb.max_value = 1.0
		pb.value = stat_val
		pb.custom_minimum_size = Vector2(0.0, 10.0)
		pb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		pb.add_theme_color_override("fill_color", Color(stat_col))
		v.add_child(pb)

	pc.add_child(v)
	return pc


func _build_field_comparison(s: Season) -> Control:
	s.apply_car_rd()
	s.apply_ai_dev()

	var pc := _panel()
	pc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 4)
	v.add_child(_hlabel("СРАВНЕНИЕ С ПЕЛОТОНОМ", 16, Palette.CREAM_HEX))

	# Build list of [combined, team_name, is_player]
	var teams_data: Array = []
	for ti: int in range(11):
		var tc: Dictionary = F1_2026.team_car(ti)
		var combined: float = float(tc.get("power", 0.0)) + float(tc.get("aero", 0.0))
		var tname: String = String((F1_2026.TEAMS[ti] as Dictionary).get("name", "?"))
		var is_player: bool = ti == s.player_team
		teams_data.append([combined, tname, is_player])

	# Sort descending by combined
	teams_data.sort_custom(func(a: Array, b: Array) -> bool:
		return float(a[0]) > float(b[0]))

	for td_entry in teams_data:
		var combined: float = float(td_entry[0])
		var tname: String = String(td_entry[1])
		var is_player: bool = bool(td_entry[2])
		var bar_col: String = Palette.GOLD_HEX if is_player else Palette.MUTED_HEX

		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 6)

		var name_lbl := _label(tname, 11, bar_col)
		name_lbl.custom_minimum_size = Vector2(120.0, 0.0)
		name_lbl.clip_text = true
		row.add_child(name_lbl)

		var bar_outer := PanelContainer.new()
		bar_outer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var bar_outer_sb := StyleBoxFlat.new()
		bar_outer_sb.bg_color = Color(0.12, 0.12, 0.16, 1.0)
		bar_outer_sb.content_margin_top    = 0.0
		bar_outer_sb.content_margin_bottom = 0.0
		bar_outer_sb.content_margin_left   = 0.0
		bar_outer_sb.content_margin_right  = 0.0
		bar_outer.add_theme_stylebox_override("panel", bar_outer_sb)

		var bar_inner := ColorRect.new()
		bar_inner.color = Color(bar_col)
		# combined max is ~2.0 (two stats each up to ~1.0); scale bar to 150px per unit
		bar_inner.custom_minimum_size = Vector2(combined * 150.0, 12.0)
		bar_outer.add_child(bar_inner)
		row.add_child(bar_outer)

		row.add_child(_label("%.0f" % (combined * 50.0), 11, Palette.MUTED_HEX))
		v.add_child(row)

	pc.add_child(v)
	return pc


func _build_page_car(v: VBoxContainer, s: Season) -> void:
	v.add_child(_build_car_stats(s))
	v.add_child(_build_field_comparison(s))
	v.add_child(_build_rnd(s))
	v.add_child(_build_suppliers(s))

# ================================================================ PAGE: ШТАБ
func _build_page_staff(v: VBoxContainer, s: Season) -> void:
	v.add_child(_build_staff(s))
	v.add_child(_build_pitcrew(s))

# ================================================================ PAGE: ПИЛОТЫ
func _build_page_pilots(v: VBoxContainer, s: Season) -> void:
	v.add_child(_build_contracts(s))
	v.add_child(_build_academy(s))

# ================================================================ PAGE: БАЗА
func _build_page_base(v: VBoxContainer, s: Season) -> void:
	v.add_child(_build_hq(s))

func _build_hq(s: Season) -> Control:
	var pc := _panel()
	pc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 10)
	v.add_child(_hlabel("ШТАБ-КВАРТИРА КОМАНДЫ", 18, Palette.CREAM_HEX))

	if s.hq_building_in_progress != "":
		var rem: int = s.hq_build_completes_after - s.round_index
		var bname: String = String(Season.HQ_BUILDINGS[s.hq_building_in_progress].get("name", ""))
		v.add_child(_label("Строится: %s (осталось %d этапов)" % [bname, rem], 14, Palette.INFO_HEX))
	v.add_child(_spacer(4))

	var grid := GridContainer.new()
	grid.columns = 3
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL

	for bid: String in Season.HQ_BUILDINGS:
		var bdef: Dictionary = Season.HQ_BUILDINGS[bid]
		var cur_lv: int = s.hq_level(bid)
		var can_unlock: bool = s.hq_can_unlock(bid)

		var building_card := _panel()
		building_card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var bv := VBoxContainer.new()
		bv.add_theme_constant_override("separation", 5)

		var name_col: String = Palette.GOLD_HEX if cur_lv > 0 else (Palette.CREAM_HEX if can_unlock else Palette.MUTED_HEX)
		bv.add_child(_hlabel(String(bdef.get("name", bid)), 14, name_col))

		var pip_row := HBoxContainer.new()
		pip_row.add_theme_constant_override("separation", 4)
		for li: int in range(3):
			var pip := PanelContainer.new()
			pip.custom_minimum_size = Vector2(16, 8)
			var pip_sb := StyleBoxFlat.new()
			pip_sb.bg_color = Color(Palette.GOLD_HEX) if li < cur_lv else Color(0.3, 0.3, 0.3, 1.0)
			pip.add_theme_stylebox_override("panel", pip_sb)
			pip_row.add_child(pip)
		bv.add_child(pip_row)

		if cur_lv > 0 and cur_lv <= 3:
			var eff_arr: Array = Season.HQ_EFFECT_DESC.get(bid, [])
			if eff_arr.size() >= cur_lv:
				bv.add_child(_label(String(eff_arr[cur_lv - 1]), 12, Palette.GOOD_HEX))
			var unimplemented_buildings: Array = ["wind_tunnel", "simulator", "academy_hq", "telemetry"]
			if unimplemented_buildings.has(bid):
				bv.add_child(_label("(эффект в разработке)", 10, Palette.MUTED_HEX))

		if cur_lv < 3 and can_unlock:
			var cost: int = s.hq_build_cost(bid)
			var desc_arr: Array = Season.HQ_EFFECT_DESC.get(bid, [""])
			var next_eff: String = String(desc_arr[cur_lv]) if desc_arr.size() > cur_lv else ""
			bv.add_child(_label("Ур.%d: %s · $%s" % [cur_lv + 1, next_eff, _money(cost)], 11, Palette.MUTED_HEX))
			var can_build: bool = s.hq_building_in_progress.is_empty() and s.money >= cost
			var build_btn := _button("Построить Ур.%d" % (cur_lv + 1), 12)
			build_btn.disabled = not can_build
			var bid_cap: String = bid
			var net_role2: String = Net.role()
			if net_role2 == "client":
				build_btn.pressed.connect(func():
					Net.net_season_hq_build.rpc_id(1, bid_cap))
			else:
				build_btn.pressed.connect(func():
					if s.hq_start_build(bid_cap):
						_rebuild())
			bv.add_child(build_btn)
		elif not can_unlock:
			var bdef2: Dictionary = Season.HQ_BUILDINGS.get(bid, {})
			var lock_txt: String = ""
			if bdef2.has("unlock"):
				lock_txt = "Требует: %s" % String(bdef2["unlock"]).replace("@", " Ур.")
			elif bdef2.has("unlock_season"):
				lock_txt = "Доступно после %d этапов" % (int(bdef2["unlock_season"]) * 8)
			bv.add_child(_label(lock_txt, 11, Palette.MUTED_HEX))

		building_card.add_child(bv)
		grid.add_child(building_card)

	v.add_child(grid)
	pc.add_child(v)
	return pc

# ---------------------------------------------------------------- standings
func _build_standings(s: Season) -> Control:
	var pc := _panel()
	pc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 4)
	v.add_child(_hlabel("ЧЕМПИОНАТ ПИЛОТОВ", 18, Palette.CREAM_HEX))
	v.add_child(HSeparator.new())

	var rows: Array = s.standings_sorted()
	for i in rows.size():
		var r: Dictionary = rows[i]
		var box := HBoxContainer.new()
		box.add_theme_constant_override("separation", 8)
		var row_col := Color.WHITE
		if r["team"]:
			row_col = TEAM_COL if int(r["id"]) == 4 else ENGI_COL
		var pos_cell := _cell("P%d" % (i + 1), 50, row_col)
		pos_cell.add_theme_font_override("font", Palette.display_font(600, 0))
		box.add_child(pos_cell)
		box.add_child(_cell(r["name"], 160, row_col))
		var pts_cell := _cell("%d очк." % r["points"], 90, row_col)
		pts_cell.add_theme_font_override("font", Palette.display_font(600, 0))
		box.add_child(pts_cell)
		v.add_child(box)
	pc.add_child(v)
	return pc

# ---------------------------------------------------------------- R&D (CAR-1)
# Shows part groups (Аэро / Мотор / Энергия / Надёжность) with per-part
# level indicators and develop buttons.  Tyre program kept as a standalone
# row beneath the parts (unchanged mechanic).
func _build_rnd(s: Season) -> Control:
	var pc := _panel()
	pc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	v.add_child(_hlabel("R&D — РАЗВИТИЕ МАШИНЫ", 18, Palette.CREAM_HEX))
	v.add_child(_label("Доступно R&D очков: %d" % s.rp, 15, Palette.GOOD_HEX))
	# M3: aero (LTC) price modifiers — staff quality (M2) × ATR catch-up
	v.add_child(_label("Цена аэро-R&D: персонал ×%.2f · ATR ×%.2f (P%d конструкторов)" % [
		s.rd_speed_mult(), s.atr_speed(), s.constructor_position()], 12, MUTED))
	# CAR-2: season component pool status
	var pool_ok: bool = s.replacements_used <= Season.FREE_REPLACEMENTS
	var pool_col: String = Palette.MUTED_HEX if pool_ok else Palette.WARN_HEX
	v.add_child(_label("Замены деталей: %d (бесплатно %d, далее −%d RP за замену)" % [
		s.replacements_used, Season.FREE_REPLACEMENTS, Season.POOL_PENALTY_RP], 12, pool_col))
	v.add_child(_spacer(4))

	# Group metadata: [group_key, group_title, accent_colour, description]
	var groups: Array = [
		["aero",        "АЭРОДИНАМИКА",    Palette.GOLD_HEX,
			"Прижимная сила — помогает на технических трассах (Монако)."],
		["power",       "МОТОР / ДВС",     Palette.WARN_HEX,
			"Мощность — прибавка на скоростных трассах (Монца)."],
		["energy",      "ЭНЕРГИЯ / ERS",   Palette.INFO_HEX,
			"Батарея и рекуперация — больше тяги из ERS в 2026."],
		["reliability", "НАДЁЖНОСТЬ",      Palette.GOOD_HEX,
			"КПП и охлаждение — снижают риск поломки + малый бонус."],
	]

	# M3: show TOTAL deltas (developed + bought parts + suppliers) — what the car gets.
	var deltas: Dictionary = s.car_rd_deltas()

	for gi in groups.size():
		var ginfo: Array = groups[gi]
		var grp_key: String  = String(ginfo[0])
		var grp_title: String = String(ginfo[1])
		var grp_col: String  = String(ginfo[2])
		var grp_desc: String  = String(ginfo[3])

		v.add_child(_label(grp_title, 15, grp_col))
		v.add_child(_label(grp_desc, 12, MUTED))

		# Show current scalar value for this group
		match grp_key:
			"aero":
				v.add_child(_label("Аэро: +%.3f  |  Надёжн. шасси: +%.3f" % [
					float(deltas["d_aero"]), float(deltas["d_ch_rel"])], 12, grp_col))
			"power":
				v.add_child(_label("Мощность: +%.3f" % float(deltas["d_power"]), 12, grp_col))
			"energy":
				v.add_child(_label("Энергия: +%.3f" % float(deltas["d_energy"]), 12, grp_col))
			"reliability":
				pass   # ch_rel shown under aero already

		# Build subtree fully before add_child (TD-1/TD-2 guard)
		var part_rows_v := VBoxContainer.new()
		part_rows_v.add_theme_constant_override("separation", 4)

		for pk: String in F1_2026.PARTS:
			var pdef: Dictionary = F1_2026.PARTS[pk]
			if String(pdef["group"]) != grp_key:
				continue
			var max_lv: int = int(pdef["max_level"])
			var cur_lv: int = int(s.part_levels.get(pk, 0))
			var label_str: String = String(pdef["label"])
			var stars: String = ""
			for _li in max_lv:
				if _li < cur_lv:
					stars += "★"
				else:
					stars += "☆"

			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 8)

			var name_lbl := _label("  %s %s" % [label_str, stars], 13, grp_col)
			name_lbl.custom_minimum_size = Vector2(200, 0)
			row.add_child(name_lbl)

			var bought_flag: bool = bool(s.bought_parts.get(pk, false))
			if bought_flag:
				# M3: supplier part — instant 1.5-level effect, development locked.
				row.add_child(_label("  ПОКУПНОЕ · потолок заблокирован", 12, "#66c2ff"))
			elif cur_lv < max_lv:
				var cost_val: int = s.cost_part(pk)
				var btn := _button("Развить · %d RP" % cost_val, 12)
				btn.disabled = s.rp < cost_val
				var pk_cap := pk   # capture for closure
				if Net.role() == "client":
					# Client: send command to host; host applies and rebroadcasts.
					btn.pressed.connect(func():
						Net.net_season_buy_part.rpc_id(1, pk_cap))
				else:
					btn.pressed.connect(func():
						if s.buy_part(pk_cap):
							if Net.role() == "host":
								Season.active.save_to_disk()
								Net.net_season_full.rpc(Season.active.to_dict())
								Net.net_season_feed.rpc("Партнёр: куплено «%s»" % String(F1_2026.PARTS[pk_cap]["label"]))
							_rebuild())
				row.add_child(btn)
				# M3: buy-from-supplier path (transferable parts, only while undeveloped)
				if cur_lv == 0 and s.part_buy_cost(pk) > 0:
					var buy_val: int = s.part_buy_cost(pk)
					var bbtn := _button("Купить · $%s" % _money(buy_val), 12)
					bbtn.disabled = s.money < buy_val
					var pk_cap2 := pk
					if Net.role() == "client":
						bbtn.pressed.connect(func():
							Net.net_season_buy_supplier_part.rpc_id(1, pk_cap2))
					else:
						bbtn.pressed.connect(func():
							if s.buy_part_supplier(pk_cap2):
								if Net.role() == "host":
									Season.active.save_to_disk()
									Net.net_season_full.rpc(Season.active.to_dict())
									Net.net_season_feed.rpc("Партнёр: куплена деталь «%s» у поставщика"
										% String(F1_2026.PARTS[pk_cap2]["label"]))
								_rebuild())
					row.add_child(bbtn)
			else:
				row.add_child(_label("  МАКС", 12, Palette.GOOD_HEX))

			# CAR-2: condition readout + replacement for developed (non-bought) parts
			if cur_lv > 0 and not bought_flag:
				var cond: float = float(s.part_condition.get(pk, 1.0))
				var cond_col := "#5dd17a"
				if cond < F1_2026.WORN_THRESHOLD:
					cond_col = "#e23b3b"
				elif cond < 0.6:
					cond_col = "#f2c14e"
				row.add_child(_label("%d%%" % int(round(cond * 100.0)), 12, cond_col))
				if cond < 0.7:
					var rep_cost: int = s.part_replace_cost(pk)
					var rbtn := _button("Заменить · $%s" % _money(rep_cost), 12)
					rbtn.disabled = s.money < rep_cost
					var pk_cap3 := pk
					if Net.role() == "client":
						rbtn.pressed.connect(func():
							Net.net_season_replace_part.rpc_id(1, pk_cap3))
					else:
						rbtn.pressed.connect(func():
							if s.replace_part(pk_cap3):
								if Net.role() == "host":
									Season.active.save_to_disk()
									Net.net_season_full.rpc(Season.active.to_dict())
									Net.net_season_feed.rpc("Партнёр: заменена деталь «%s»"
										% String(F1_2026.PARTS[pk_cap3]["label"]))
								_rebuild())
					row.add_child(rbtn)

			part_rows_v.add_child(row)

		v.add_child(part_rows_v)

		if gi < groups.size() - 1:
			v.add_child(_spacer(6))

	# Tyre program (unchanged mechanic from META-1)
	v.add_child(_spacer(8))
	v.add_child(HSeparator.new())
	v.add_child(_spacer(4))
	v.add_child(_label("ШИНЫ", 15, Palette.INFO_HEX))
	v.add_child(_label("Шинная программа — снижает износ шин команды.", 12, MUTED))
	v.add_child(_label("Текущий бонус: −%d%% износа" % int(s.wear_bonus * 100.0), 12, Palette.INFO_HEX))
	var tyre_row := HBoxContainer.new()
	tyre_row.add_theme_constant_override("separation", 8)
	var tyre := _button("Купить шинную программу · %d RP" % s.cost_tyre(), 14)
	tyre.disabled = s.rp < s.cost_tyre() or s.wear_bonus >= 0.36
	if Net.role() == "client":
		tyre.pressed.connect(func():
			Net.net_season_buy_tyre.rpc_id(1))
	else:
		tyre.pressed.connect(func():
			if s.buy_tyre():
				if Net.role() == "host":
					Season.active.save_to_disk()
					Net.net_season_full.rpc(Season.active.to_dict())
					Net.net_season_feed.rpc("Партнёр: куплена шинная программа")
				_rebuild())
	tyre_row.add_child(tyre)
	v.add_child(tyre_row)

	v.add_child(_spacer(8))
	v.add_child(_label("R&D очки начисляются за каждый этап и за результат команды.",
		12, Palette.FINE_HEX))

	# META-3: cap status line
	v.add_child(_spacer(6))
	var cap_col: String = Palette.GOOD_HEX
	if s.cumulative_salary_spend > s.SALARY_CAP:
		cap_col = Palette.DANG_HEX
	elif s.cumulative_salary_spend > s.SALARY_CAP * 3 / 4:
		cap_col = Palette.WARN_HEX
	v.add_child(_label(s.cap_status_text(), 13, cap_col))

	pc.add_child(v)
	return pc

# ---------------------------------------------------------------- contracts (META-3)
func _build_contracts(s: Season) -> Control:
	var pc := _panel()
	pc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	v.add_child(_hlabel("КОНТРАКТЫ ПИЛОТОВ", 18, Palette.CREAM_HEX))
	v.add_child(HSeparator.new())

	for idx in s.TEAM_IDS.size():
		var driver_id: int = s.TEAM_IDS[idx]
		var c: Dictionary = s.contract_of(driver_id)
		var dname: String = s.driver_name(driver_id)
		var role_txt: String = "Директор · P5" if driver_id == 4 else "Инженер · P6"

		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 10)

		if c.is_empty():
			row.add_child(_label("%s (%s) — контракт отсутствует" % [dname, role_txt], 14, Palette.DANG_HEX))
		else:
			var sal: int = int(c.get("salary_per_round", 0))
			var rem: int = int(c.get("rounds_remaining", 0))
			var contract_col: String = Palette.CREAM_HEX
			if rem <= 1:
				contract_col = Palette.DANG_HEX
			elif rem <= 2:
				contract_col = Palette.WARN_HEX
			var rem_txt: String = "контракт истёк!" if rem <= 0 else "%d эт. осталось" % rem
			# M4: driver status (Первый/Второй) + podium bonus clause readout
			var status: String = s.driver_status(driver_id)
			var status_txt: String = "статус не назначен"
			if status == "first":
				status_txt = "● Первый пилот"
			elif status == "second":
				status_txt = "○ Второй пилот (−$%s/эт.)" % _money(s.SECOND_SALARY_DISCOUNT)
			row.add_child(_label("%s (%s) — зарплата $%s / эт. · %s · %s" % [
				dname, role_txt, _money(sal), rem_txt, status_txt], 14, contract_col))
			row.add_child(_label("клауза: +$%s пилоту за подиум" % _money(
				int(c.get("bonus_podium", 0))), 12, "#7c8694"))
			var age_lbl := _label("(возраст %d)" % s.driver_age.get(driver_id, 27), 12, MUTED)
			row.add_child(age_lbl)

			var bar2 := HBoxContainer.new()
			bar2.add_theme_constant_override("separation", 6)

			# M4: assign FIRST status (the teammate becomes second) — co-op
			# decision: each player wants their own car first.
			if status != "first":
				var first_btn := _button("Сделать первым", 13)
				var did_cap := driver_id
				if Net.role() == "client":
					first_btn.pressed.connect(func():
						Net.net_season_set_first.rpc_id(1, did_cap))
				else:
					first_btn.pressed.connect(func():
						if s.set_first_driver(did_cap):
							if Net.role() == "host":
								Season.active.save_to_disk()
								Net.net_season_full.rpc(Season.active.to_dict())
								Net.net_season_feed.rpc("Партнёр: первый пилот — %s"
									% s.driver_name(did_cap))
							_rebuild())
				bar2.add_child(first_btn)

			# Re-sign button if expired
			if rem <= 0:
				var resign_btn := _button("Продлить · $%s" % _money(s.resign_cost(driver_id)), 13)
				resign_btn.disabled = s.money < s.resign_cost(driver_id)
				resign_btn.pressed.connect(func():
					if s.resign_driver(driver_id):
						_rebuild())
				bar2.add_child(resign_btn)

			# Upgrade salary button (if not already premium)
			var premium: int = int(s.SALARY_PREMIUM[s._salary_tier_idx()])
			if sal < premium:
				var upgrade_cost_preview: int = (premium - sal) * maxi(1, rem)
				var upg_btn := _button("Повысить зарплату · $%s" % _money(upgrade_cost_preview), 13)
				upg_btn.disabled = s.money < upgrade_cost_preview
				upg_btn.pressed.connect(func():
					if s.upgrade_salary(driver_id):
						_rebuild())
				bar2.add_child(upg_btn)

			if bar2.get_child_count() > 0:
				v.add_child(row)
				v.add_child(bar2)
			else:
				v.add_child(row)
			continue
		v.add_child(row)

	# Salary cap summary
	v.add_child(_spacer(6))
	v.add_child(HSeparator.new())
	var cap_col: String = Palette.GOOD_HEX
	if s.cumulative_salary_spend > s.SALARY_CAP:
		cap_col = Palette.DANG_HEX
	elif s.cumulative_salary_spend > s.SALARY_CAP * 3 / 4:
		cap_col = Palette.WARN_HEX
	v.add_child(_label(s.cap_status_text(), 14, cap_col))
	v.add_child(_label(
		"Израсходовано: $%s  из  $%s  кап-бюджета" % [
			_money(s.cumulative_salary_spend), _money(s.SALARY_CAP)], 13, Palette.MUTED_HEX))
	if s.cap_penalty_pending > 0:
		v.add_child(_label("Следующий штраф за превышение: -%d RP" % s.cap_penalty_pending,
			13, Palette.DANG_HEX))

	# Transfer market: full 2026 pelotone free agents
	v.add_child(_spacer(10))
	v.add_child(_hlabel("ТРАНСФЕРНЫЙ РЫНОК", 16, Palette.CREAM_HEX))
	v.add_child(_label("Свободные агенты и гонщики из 2026 пелотона:", 12, MUTED))
	v.add_child(_spacer(4))

	s.apply_car_rd()
	s.apply_ai_dev()
	var market_grid: Array = F1_2026.race_grid({})
	var net_role_mkt: String = Net.role()

	for gi: int in range(market_grid.size()):
		var gd: Dictionary = market_grid[gi]
		var gid: int = int(gd.get("id", -1))
		if Season.TEAM_IDS.has(gid):
			continue

		var gname: String = String(gd.get("name", ""))
		var gskill: float = float(gd.get("skill", 0.5))
		var gage: int = 20 + (gid % 22)
		var gsalary: int = int(gskill * 30_000.0) + 10_000
		var fee: int = gsalary * 3
		var tier_diff: float = gskill - float(s.team_tier) / 10.0
		var accept_col: String = Palette.GOOD_HEX if tier_diff >= 0.0 else Palette.MUTED_HEX
		var accept_txt: String = "высокая" if tier_diff >= 0.0 else ("средняя" if tier_diff > -0.1 else "низкая")

		var trow := HBoxContainer.new()
		trow.add_theme_constant_override("separation", 8)

		var name_lbl := _label(gname, 13, Palette.CREAM_HEX)
		name_lbl.custom_minimum_size = Vector2(140, 0)
		trow.add_child(name_lbl)

		trow.add_child(_label("Возраст: %d" % gage, 12, MUTED))
		trow.add_child(_label("★%.0f%%" % (gskill * 100.0), 13, Palette.GOLD_HEX))
		trow.add_child(_label("$%s" % _money(fee), 12, Palette.WARN_HEX))
		trow.add_child(_label(accept_txt, 12, accept_col))

		var gskill_cap: float = gskill
		var gsalary_cap: int = gsalary
		var gage_cap: int = gage

		var s5b := _button("→P5", 11)
		s5b.disabled = s.money < fee or net_role_mkt == "client"
		s5b.pressed.connect(func():
			if s.sign_free_agent(4, gskill_cap, gsalary_cap, gage_cap):
				_rebuild())
		trow.add_child(s5b)

		var s6b := _button("→P6", 11)
		s6b.disabled = s.money < fee or net_role_mkt == "client"
		s6b.pressed.connect(func():
			if s.sign_free_agent(5, gskill_cap, gsalary_cap, gage_cap):
				_rebuild())
		trow.add_child(s6b)

		v.add_child(trow)

	pc.add_child(v)
	return pc

# ---------------------------------------------------------------- helpers
func _panel() -> PanelContainer:
	var pc := PanelContainer.new()
	pc.add_theme_stylebox_override("panel", Palette.panel())
	return pc

# Driver portrait card (§5): grey-silhouette portrait + caps name + morale/dev.
func _driver_card(s: Season, id: int, slot: int) -> PanelContainer:
	var pc := PanelContainer.new()
	pc.add_theme_stylebox_override("panel", Palette.panel())
	pc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var hb := HBoxContainer.new()
	hb.add_theme_constant_override("separation", 12)
	var accent: Color = Palette.P5 if slot == 0 else Palette.P6
	var port := DriverPortrait.new()
	port.custom_minimum_size = Vector2(84, 100)
	port.setup(s.driver_name(id), accent)
	hb.add_child(port)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 4)
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var tag := _label("P5" if slot == 0 else "P6", 15, Palette.P5_HEX if slot == 0 else Palette.P6_HEX)
	tag.add_theme_font_override("font", Palette.display_font(600, 2))
	v.add_child(tag)
	var nm := _label(s.driver_name(id).to_upper(), 18, Palette.CREAM_HEX)
	nm.add_theme_font_override("font", Palette.display_font(600, 1))
	v.add_child(nm)
	var mor: int = s.morale_of(id)
	var mcol: String = Palette.GOOD_HEX
	if mor < 40:
		mcol = Palette.DANG_HEX
	elif mor < 66:
		mcol = Palette.WARN_HEX
	v.add_child(_label("Настрой: %d/100" % mor, 14, mcol))
	v.add_child(_label("Развитие: +%.3f к темпу" % s.dev_of(id), 13, Palette.INFO_HEX))
	hb.add_child(v)
	pc.add_child(hb)
	return pc

func _label(txt: String, sz: int, col: String) -> Label:
	var l := Label.new()
	l.text = txt
	l.add_theme_font_size_override("font_size", sz)
	l.add_theme_color_override("font_color", Color(col))
	return l

# Heading label — Oswald display font (caps, weight 600).
func _hlabel(txt: String, sz: int, col: String, tracking: int = 2) -> Label:
	var l := _label(txt, sz, col)
	l.add_theme_font_override("font", Palette.display_font(600, tracking))
	return l

func _cell(txt: String, w: int, col: Color) -> Label:
	var l := Label.new()
	l.text = txt
	l.custom_minimum_size = Vector2(w, 0)
	l.add_theme_font_size_override("font_size", 17)
	l.add_theme_color_override("font_color", col)
	return l

func _button(txt: String, sz: int) -> Button:
	var b := Button.new()
	b.text = txt
	b.add_theme_font_size_override("font_size", sz)
	b.custom_minimum_size = Vector2(0, 36)
	return b

func _spacer(h: int) -> Control:
	var c := Control.new()
	c.custom_minimum_size = Vector2(0, h)
	return c

# ---------------------------------------------------------------- sponsors (M1)
func _build_sponsors(s: Season) -> Control:
	var pc := _panel()
	pc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	v.add_child(_hlabel("СПОНСОРЫ", 18, Palette.CREAM_HEX))
	v.add_child(HSeparator.new())

	# Active sponsor slots
	if s.active_sponsors.is_empty():
		v.add_child(_label("Нет активных спонсоров — используй рынок ниже.", 13, Palette.MUTED_HEX))
	else:
		v.add_child(_label("Активные контракты:", 14, Palette.CREAM_HEX))
		for sp in s.active_sponsors:
			var spd: Dictionary = sp as Dictionary
			var sp_name: String = String(spd.get("name", "?"))
			var tier: String = String(spd.get("tier", "partner"))
			var base_pay: int = int(spd.get("base_payment", 0))
			var bonus: int = int(spd.get("bonus_payment", 0))
			var progress: int = int(spd.get("goal_progress", 0))
			var g_met: bool = bool(spd.get("goal_met", false))
			var g_failed: bool = bool(spd.get("goal_failed", false))
			var tier_col: String = Palette.GOLD_HEX if tier == "title" else Palette.INFO_HEX
			var tier_ru: String = "ТИТУЛЬНЫЙ" if tier == "title" else "ПАРТНЁР"
			var status_txt: String
			if g_met:
				status_txt = "✔ Цель выполнена"
			elif g_failed:
				status_txt = "✘ Цель провалена"
			else:
				status_txt = "цель: %s (прогресс %d)" % [_goal_ru(spd), progress]
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 8)
			row.add_child(_label("[%s] %s" % [tier_ru, sp_name], 14, tier_col))
			row.add_child(_label("$%s/эт. + $%s бонус" % [_money(base_pay), _money(bonus)], 13, Palette.CREAM_HEX))
			v.add_child(row)
			v.add_child(_label("  %s" % status_txt, 12, Palette.MUTED_HEX))

	# Slot summary
	var title_used: int = 0
	var partner_used: int = 0
	for sp in s.active_sponsors:
		var spd: Dictionary = sp as Dictionary
		if bool(spd.get("active", true)):
			if String(spd.get("tier", "")) == "title":
				title_used += 1
			elif String(spd.get("tier", "")) == "partner":
				partner_used += 1
	v.add_child(_label("Слоты: Титульный %d/1 · Партнёр %d/2" % [title_used, partner_used],
		13, Palette.FINE_HEX))

	v.add_child(_spacer(6))
	v.add_child(HSeparator.new())
	v.add_child(_label("Рынок спонсоров:", 15, Palette.CREAM_HEX))

	var net_role2: String = Net.role()
	var offers: Array = s.list_sponsor_offers()
	if offers.is_empty():
		v.add_child(_label("Все предложения подписаны или рынок пуст.", 13, Palette.MUTED_HEX))
	else:
		for offer in offers:
			var od: Dictionary = offer as Dictionary
			var offer_id: int = int(od.get("id", -1))
			var tier: String = String(od.get("tier", "partner"))
			var tier_ru: String = "ТИТУЛ." if tier == "title" else "ПАРТНЁР"
			var tier_col: String = Palette.GOLD_HEX if tier == "title" else Palette.INFO_HEX
			var base_pay: int = int(od.get("base_payment", 0))
			var bonus: int = int(od.get("bonus_payment", 0))

			# Check if slot available
			var slot_full: bool = false
			if tier == "title" and title_used >= Season.SPONSOR_SLOT_TITLE:
				slot_full = true
			elif tier == "partner" and partner_used >= Season.SPONSOR_SLOT_PARTNER:
				slot_full = true

			var orow := HBoxContainer.new()
			orow.add_theme_constant_override("separation", 8)
			orow.add_child(_label("[%s] %s" % [tier_ru, String(od.get("name", "?"))],
				13, tier_col))
			orow.add_child(_label("$%s/эт. + бонус $%s" % [_money(base_pay), _money(bonus)],
				12, Palette.CREAM_HEX))
			orow.add_child(_label("Цель: %s" % _goal_ru(od), 12, Palette.MUTED_HEX))

			var sign_btn := _button("Подписать", 12)
			sign_btn.disabled = slot_full
			var cap_id := offer_id
			if net_role2 == "client":
				sign_btn.pressed.connect(func():
					Net.net_season_sign_sponsor.rpc_id(1, cap_id))
			else:
				sign_btn.pressed.connect(func():
					if s.sign_sponsor(cap_id):
						if net_role2 == "host":
							Season.active.save_to_disk()
							Net.net_season_full.rpc(Season.active.to_dict())
							Net.net_season_feed.rpc("Партнёр: подписан спонсор «%s»" % String(od.get("name", "?")))
						_rebuild())
			orow.add_child(sign_btn)
			v.add_child(orow)

	pc.add_child(v)
	return pc

# ---------------------------------------------------------------- suppliers (M3)
# Seasonal brake + fuel supplier choice. Mid-season change = integration
# penalty (90% effect for 2 rounds). Suppliers pay back as tech partners.
func _build_suppliers(s: Season) -> Control:
	var pc := _panel()
	pc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 6)
	v.add_child(_label("ПОСТАВЩИКИ", 18, "#ffffff"))
	v.add_child(HSeparator.new())
	var net_cost: int = s.supplier_cost_per_round() - s.supplier_income_per_round()
	v.add_child(_label("Поставка: $%s/этап − техпартнёрство $%s/этап = $%s/этап" % [
		_money(s.supplier_cost_per_round()), _money(s.supplier_income_per_round()),
		_money(net_cost)], 13, "#9aa4b2"))
	if s.round_index > 0:
		v.add_child(_label("Смена в середине сезона: −10% эффекта на 2 этапа (интеграция).",
			12, "#f2c14e"))

	_add_supplier_rows(s, v, "brake", "ТОРМОЗА", F1_2026.BRAKE_SUPPLIERS,
		s.brake_supplier, s.brake_integration)
	v.add_child(_spacer(4))
	_add_supplier_rows(s, v, "fuel", "ТОПЛИВО / МАСЛА", F1_2026.FUEL_SUPPLIERS,
		s.fuel_supplier, s.fuel_integration)

	pc.add_child(v)
	return pc

# One supplier category: header + a row per option with a select button.
func _add_supplier_rows(s: Season, v: VBoxContainer, kind: String, title: String,
		table: Dictionary, current: String, integration: int) -> void:
	var head: String = title
	if integration > 0:
		head += "  ·  ИНТЕГРАЦИЯ: −10% ещё %d эт." % integration
	v.add_child(_label(head, 15, "#ffd166" if kind == "brake" else "#66c2ff"))
	var net_role2: String = Net.role()
	for key: String in table:
		var sdef: Dictionary = table[key]
		var eff: String
		if kind == "brake":
			eff = "надёжн. +%.3f · пит-стабильн. +%.2f" % [
				float(sdef.get("d_ch_rel", 0.0)), float(sdef.get("pit_cons", 0.0))]
		else:
			eff = "мощность +%.3f · энергия +%.3f" % [
				float(sdef.get("d_power", 0.0)), float(sdef.get("d_energy", 0.0))]
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 8)
		var is_cur: bool = key == current
		var name_col := Color("#5dd17a") if is_cur else Color.WHITE
		var mark: String = "● " if is_cur else "○ "
		row.add_child(_cell(mark + String(sdef.get("label", key)), 170, name_col))
		row.add_child(_cell(eff, 270, Color("#cfd6e0")))
		row.add_child(_cell("$%s/эт. (−$%s)" % [_money(int(sdef.get("cost", 0))),
			_money(int(sdef.get("partner_pay", 0)))], 130, Color("#9aa4b2")))
		if not is_cur:
			var sel := _button("Выбрать", 12)
			var kind_cap := kind
			var key_cap := key
			if net_role2 == "client":
				sel.pressed.connect(func():
					Net.net_season_set_supplier.rpc_id(1, kind_cap, key_cap))
			else:
				sel.pressed.connect(func():
					if s.set_supplier(kind_cap, key_cap):
						if net_role2 == "host":
							Season.active.save_to_disk()
							Net.net_season_full.rpc(Season.active.to_dict())
							Net.net_season_feed.rpc("Партнёр: выбран поставщик «%s»"
								% String(table[key_cap].get("label", key_cap)))
						_rebuild())
			row.add_child(sel)
		v.add_child(row)

# ---------------------------------------------------------------- pit crew (M4)
# The 5 over-the-wall roles, training buttons, fatigue/injury status and the
# DHL Fastest Pit Stop season zachet.
func _build_pitcrew(s: Season) -> Control:
	var pc := _panel()
	pc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 6)
	v.add_child(_label("ПИТ-ЭКИПАЖ", 18, "#ffffff"))
	v.add_child(HSeparator.new())

	# Stop estimate from the live crew scalars (same model as the race).
	var sim_staff: Dictionary = s.staff_for_sim()
	var spd: float = Personnel.pit_speed(sim_staff)
	var cons: float = Personnel.pit_consistency(sim_staff)
	var est_base: float = RaceSim.STOP_TIME_BASE - RaceSim.STOP_TIME_SPEED_K * spd
	var est: float = s.pit_crew_time(est_base)
	var sig: float = RaceSim.STOP_TIME_SIGMA_MIN + RaceSim.STOP_TIME_SIGMA_K * (1.0 - cons)
	v.add_child(_label("Расчётный стоп: %.2f с ± %.2f с" % [est, sig], 14, "#5dd17a"))
	if s.pit_fatigue_penalty() > 0.0:
		v.add_child(_label("Экипаж перетренирован — на следующем этапе стоп ≈ +0.2 с",
			13, "#f2c14e"))

	var net_role2: String = Net.role()
	for role_v in Season.PIT_CREW_ROLES:
		var role: String = String(role_v)
		var md: Dictionary = s.staff_member(role)
		if md.is_empty():
			continue
		var sessions: int = int(md.get("sessions", 0))
		var status_txt: String = "Готов"
		var status_col: String = "#5dd17a"
		if int(md.get("injury", 0)) > 0:
			status_txt = "ТРАВМА — пропустит этап"
			status_col = "#e23b3b"
		elif int(md.get("fatigue", 0)) > 0:
			status_txt = "Усталость"
			status_col = "#f2c14e"
		elif int(md.get("gardening", 0)) > 0:
			status_txt = "На скамейке"
			status_col = "#f2c14e"
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 8)
		row.add_child(_cell(String(md.get("name", "?")), 160, Color.WHITE))
		row.add_child(_cell(s.staff_role_ru(role), 170, Color("#9aa4b2")))
		row.add_child(_cell("рейт. %d" % s.staff_overall(md), 70, Color("#cfd6e0")))
		row.add_child(_cell(status_txt, 180, Color(status_col)))
		var risk_txt: String = "нет"
		if sessions >= Season.PIT_FATIGUE_SESSIONS - 1:
			risk_txt = "высокий"
		elif sessions >= 1:
			risk_txt = "умеренный"
		var tbtn := _button("Тренировать · $%s (риск: %s)" % [
			_money(Season.PIT_TRAIN_COST), risk_txt], 12)
		tbtn.disabled = s.money < Season.PIT_TRAIN_COST or int(md.get("injury", 0)) > 0
		var role_cap := role
		if net_role2 == "client":
			tbtn.pressed.connect(func():
				Net.net_season_train_pit.rpc_id(1, role_cap))
		else:
			tbtn.pressed.connect(func():
				if s.train_pit_role(role_cap) == "ok":
					if net_role2 == "host":
						Season.active.save_to_disk()
						Net.net_season_full.rpc(Season.active.to_dict())
						Net.net_season_feed.rpc("Партнёр: тренировка пит-экипажа (%s)"
							% Season.active.staff_role_ru(role_cap))
					_rebuild())
		row.add_child(tbtn)
		v.add_child(row)

	# DHL zachet status line
	v.add_child(_spacer(4))
	v.add_child(HSeparator.new())
	var dhl_line: String = "DHL Fastest Pit Stop: %d очк. · P%d в зачёте" % [
		s.dhl_player_points(), s.dhl_player_rank()]
	if not s.dhl_best.is_empty():
		dhl_line += "  ·  лучший стоп: %.2f с — %s (этап %d)" % [
			float(s.dhl_best.get("time", 0.0)), String(s.dhl_best.get("track", "?")),
			int(s.dhl_best.get("round", 0))]
	v.add_child(_label(dhl_line, 13, "#ffd166"))
	v.add_child(_label("Победа в сезонном зачёте: +$%s и +%d RP." % [
		_money(Season.DHL_PRIZE_MONEY), Season.DHL_PRIZE_RP], 12, "#7c8694"))

	pc.add_child(v)
	return pc

# ---------------------------------------------------------------- academy (M5)
# Test-driver card (R&D feedback + race stand-in), the signed juniors with
# their superlicense progress, and the season scouting market.
func _build_academy(s: Season) -> Control:
	var pc := _panel()
	pc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 6)
	v.add_child(_label("АКАДЕМИЯ", 18, "#ffffff"))
	v.add_child(HSeparator.new())
	var net_role2: String = Net.role()

	# Test driver card
	var td: Dictionary = s.staff_member("testdriver")
	var fb: int = int(round(float((td.get("attrs", {}) as Dictionary).get("dev_feedback", 10))))
	v.add_child(_label("Тест-пилот: %s · фидбэк %d/20 · ускоряет аэро-R&D ×%.2f" % [
		s.testdriver_name(), fb, s.test_rd_mult()], 14, "#5dd17a"))
	if s.test_driver_slot >= 0:
		v.add_child(_label("Следующий этап: заменит %s (−0.030 темпа, +%d RP фидбэка)" % [
			s.driver_name(s.test_driver_slot), Season.TESTDRIVE_RP_BONUS], 13, "#f2c14e"))
	var td_row := HBoxContainer.new()
	td_row.add_theme_constant_override("separation", 8)
	for opt in [[4, "Выставить вместо P5"], [5, "Выставить вместо P6"], [-1, "Отменить"]]:
		var oid: int = int(opt[0])
		if oid == -1 and s.test_driver_slot < 0:
			continue
		if oid >= 0 and s.test_driver_slot == oid:
			continue
		var tdb := _button(String(opt[1]), 12)
		var oid_cap := oid
		if net_role2 == "client":
			tdb.pressed.connect(func():
				Net.net_season_set_testdrive.rpc_id(1, oid_cap))
		else:
			tdb.pressed.connect(func():
				if s.set_test_drive(oid_cap):
					if net_role2 == "host":
						Season.active.save_to_disk()
						Net.net_season_full.rpc(Season.active.to_dict())
					_rebuild())
		td_row.add_child(tdb)
	v.add_child(td_row)

	# Signed juniors
	v.add_child(_spacer(4))
	v.add_child(_label("Юниоры (%d/%d):" % [s.juniors.size(), Season.JUNIOR_MAX_SIGNED],
		15, "#ffffff"))
	if s.juniors.is_empty():
		v.add_child(_label("Нет юниоров — скаутинг ниже.", 13, "#9aa4b2"))
	for ji in s.juniors.size():
		var j: Dictionary = s.juniors[ji]
		var sl: int = int(j.get("superlicense_points", 0))
		var stars: String = "★".repeat(clampi(int(round(float(j.get("potential", 0.5)) * 5.0)), 1, 5))
		var jrow := HBoxContainer.new()
		jrow.add_theme_constant_override("separation", 8)
		jrow.add_child(_cell(String(j.get("name", "?")), 160, Color.WHITE))
		jrow.add_child(_cell(String(j.get("series", "?")), 50, Color("#66c2ff")))
		jrow.add_child(_cell("очки: %d" % int(j.get("season_progress", 0)), 90, Color("#cfd6e0")))
		var sl_col := Color("#5dd17a") if sl >= Season.SUPERLICENSE_GATE else Color("#9aa4b2")
		jrow.add_child(_cell("лицензия: %d/%d" % [sl, Season.SUPERLICENSE_GATE], 120, sl_col))
		jrow.add_child(_cell("потенциал %s" % stars, 130, Color("#ffd166")))
		if bool(j.get("loaned", false)):
			jrow.add_child(_cell("ОДОЛЖЕН", 90, Color("#f2c14e")))
		else:
			# Promotion (hard superlicense gate) — into either seat.
			for slot in [[4, "→P5"], [5, "→P6"]]:
				var pbtn := _button("Повысить %s" % String(slot[1]), 12)
				pbtn.disabled = not s.can_promote_junior(ji)
				var ji_cap := ji
				var did_cap: int = int(slot[0])
				if net_role2 == "client":
					pbtn.pressed.connect(func():
						Net.net_season_promote_junior.rpc_id(1, ji_cap, did_cap))
				else:
					pbtn.pressed.connect(func():
						if s.promote_junior(ji_cap, did_cap):
							if net_role2 == "host":
								Season.active.save_to_disk()
								Net.net_season_full.rpc(Season.active.to_dict())
								Net.net_season_feed.rpc("Партнёр: юниор повышен в Ф-1")
							_rebuild())
				jrow.add_child(pbtn)
			if s.has_pu_client():
				var lbtn := _button("Одолжить · +$%s" % _money(Season.JUNIOR_LOAN_INCOME), 12)
				var ji_cap2 := ji
				if net_role2 == "client":
					lbtn.pressed.connect(func():
						Net.net_season_loan_junior.rpc_id(1, ji_cap2))
				else:
					lbtn.pressed.connect(func():
						if s.loan_junior(ji_cap2):
							if net_role2 == "host":
								Season.active.save_to_disk()
								Net.net_season_full.rpc(Season.active.to_dict())
							_rebuild())
				jrow.add_child(lbtn)
		v.add_child(jrow)
	v.add_child(_label("Суперлицензия (%d очков) обязательна для Ф-1 — регламент FIA." %
		Season.SUPERLICENSE_GATE, 12, "#7c8694"))

	# Scouting market
	v.add_child(_spacer(4))
	v.add_child(HSeparator.new())
	v.add_child(_label("Скаутинг (раз в сезон):", 15, "#ffffff"))
	if s.junior_market.is_empty():
		v.add_child(_label("Рынок молодёжи пуст до следующего сезона.", 13, "#9aa4b2"))
	for cand in s.junior_market:
		var cd: Dictionary = cand as Dictionary
		var cstars: String = "★".repeat(clampi(int(round(float(cd.get("potential", 0.5)) * 5.0)), 1, 5))
		var crow := HBoxContainer.new()
		crow.add_theme_constant_override("separation", 8)
		crow.add_child(_cell(String(cd.get("name", "?")), 160, Color("#66c2ff")))
		crow.add_child(_cell("%s · %d л." % [String(cd.get("series", "?")),
			int(cd.get("age", 18))], 90, Color("#9aa4b2")))
		crow.add_child(_cell("потенциал %s" % cstars, 130, Color("#ffd166")))
		var jcost: int = int(cd.get("cost", 0))
		var sbtn := _button("Подписать · $%s/сезон" % _money(jcost), 12)
		sbtn.disabled = s.money < jcost or s.juniors.size() >= Season.JUNIOR_MAX_SIGNED
		var cid_cap: int = int(cd.get("id", -1))
		if net_role2 == "client":
			sbtn.pressed.connect(func():
				Net.net_season_sign_junior.rpc_id(1, cid_cap))
		else:
			sbtn.pressed.connect(func():
				if s.sign_junior(cid_cap):
					if net_role2 == "host":
						Season.active.save_to_disk()
						Net.net_season_full.rpc(Season.active.to_dict())
						Net.net_season_feed.rpc("Партнёр: подписан юниор в академию")
					_rebuild())
		crow.add_child(sbtn)
		v.add_child(crow)

	pc.add_child(v)
	return pc

# ---------------------------------------------------------------- staff (M2)
# People with name/age/salary/loyalty/trait. Top-3 salaries marked as cap-exempt.
# Market section opens a fresh candidate list every 2 rounds (poaching).
func _build_staff(s: Season) -> Control:
	var pc := _panel()
	pc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 6)
	v.add_child(_hlabel("ПЕРСОНАЛ", 18, Palette.CREAM_HEX))
	v.add_child(HSeparator.new())

	v.add_child(_label("Скорость R&D (аэро): ×%.2f — техдиректор и конструктор" % s.rd_speed_mult(),
		14, Palette.GOOD_HEX))
	var payroll_txt: String = "Зарплаты персонала: $%s/этап · топ-3 (★) вне кост-кэпа" % _money(
		s.staff_payroll_per_round())
	v.add_child(_label(payroll_txt, 13, Palette.MUTED_HEX))

	var exempt: Array = s.cap_exempt_roles()
	for m in s.staff:
		var md: Dictionary = m as Dictionary
		var role: String = String(md.get("role", ""))
		if role in Season.PIT_CREW_ROLES:
			continue   # M4: пит-роли показаны на панели «ПИТ-ЭКИПАЖ»
		var loy: float = float(md.get("loyalty", 0.5))
		var loy_col: String = Palette.GOOD_HEX
		if loy < 0.25:
			loy_col = Palette.DANG_HEX
		elif loy < 0.5:
			loy_col = Palette.WARN_HEX
		var star: String = "★ " if role in exempt else ""
		var status: String = ""
		if int(md.get("gardening", 0)) > 0:
			status = " · НА СКАМЕЙКЕ (1 этап)"
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 8)
		row.add_child(_cell("%s%s" % [star, String(md.get("name", "?"))], 170, Color.WHITE))
		row.add_child(_cell(s.staff_role_ru(role), 200, Palette.MUTED))
		row.add_child(_cell("%d л. · рейт. %d" % [int(md.get("age", 40)), s.staff_overall(md)],
			110, Palette.CREAM))
		row.add_child(_cell("$%s/эт." % _money(int(md.get("salary", 0))), 90, Palette.CREAM))
		row.add_child(_cell("лояльн. %d%%" % int(round(loy * 100.0)), 100, Color(loy_col)))
		v.add_child(row)
		v.add_child(_label("  %s%s" % [String(md.get("trait", "")), status], 12, Palette.FINE_HEX))

	if not s.staff_log.is_empty():
		v.add_child(_spacer(4))
		v.add_child(_label("События:", 13, Palette.MUTED_HEX))
		for line in s.staff_log:
			v.add_child(_label("· %s" % String(line), 12, Palette.CREAM_HEX))

	# Market (refreshes every STAFF_MARKET_EVERY rounds; deterministic per epoch).
	v.add_child(_spacer(6))
	v.add_child(HSeparator.new())
	v.add_child(_label("Рынок персонала (обновляется раз в %d этапа):" % Season.STAFF_MARKET_EVERY,
		15, Palette.CREAM_HEX))
	s.ensure_staff_market()
	var net_role2: String = Net.role()
	if s.staff_market.is_empty():
		v.add_child(_label("Кандидатов нет — рынок обновится со следующей эпохой.", 13, Palette.MUTED_HEX))
	else:
		for cand in s.staff_market:
			var cd: Dictionary = cand as Dictionary
			var cand_id: int = int(cd.get("id", -1))
			var prob: int = int(round(s.hire_probability(cd) * 100.0))
			var bonus: int = int(cd.get("bonus", 0))
			var crow := HBoxContainer.new()
			crow.add_theme_constant_override("separation", 8)
			crow.add_child(_cell(String(cd.get("name", "?")), 170, Palette.INFO))
			crow.add_child(_cell(s.staff_role_ru(String(cd.get("role", ""))), 200, Palette.MUTED))
			crow.add_child(_cell("рейт. %d" % s.staff_overall(cd), 70, Palette.CREAM))
			crow.add_child(_cell("$%s/эт." % _money(int(cd.get("salary", 0))), 90, Palette.CREAM))
			var hire_btn := _button("Переманить — $%s (%d%%)" % [_money(bonus), prob], 12)
			hire_btn.disabled = s.money < bonus
			var cap_cid := cand_id
			if net_role2 == "client":
				hire_btn.pressed.connect(func():
					Net.net_season_hire_staff.rpc_id(1, cap_cid))
			else:
				hire_btn.pressed.connect(func():
					var result: String = s.hire_staff(cap_cid)
					if result == "hired" or result == "refused":
						if net_role2 == "host":
							Season.active.save_to_disk()
							Net.net_season_full.rpc(Season.active.to_dict())
							Net.net_season_feed.rpc("Партнёр: попытка переманивания (%s)" % result)
						_rebuild())
			crow.add_child(hire_btn)
			v.add_child(crow)
		v.add_child(_label("Неудача: кандидат отказывается и уходит с рынка (деньги не тратятся).",
			12, Palette.FINE_HEX))

	pc.add_child(v)
	return pc

func _goal_ru(sp: Dictionary) -> String:
	var gtype: String = String(sp.get("goal_type", ""))
	var gtarget: int = int(sp.get("goal_target", 0))
	var gscope: String = String(sp.get("goal_scope", "season"))
	var scope_ru: String
	match gscope:
		"season":      scope_ru = "за сезон"
		"single_race": scope_ru = "в одной гонке"
		"any_3_races": scope_ru = "в любых 3 гонках"
		_:             scope_ru = gscope
	match gtype:
		"position":    return "Финиш P%d или выше (%s)" % [gtarget, scope_ru]
		"points":      return "%d+ очков команды (%s)" % [gtarget, scope_ru]
		"both_finish": return "Оба финишируют (%s)" % scope_ru
		"no_dnf":      return "Ни одного схода (%s)" % scope_ru
		"fastest_lap": return "Быстрейший круг (%s)" % scope_ru
	return gtype

func _show_pending_event() -> void:
	var s: Season = Season.active
	if s == null or s.pending_event.is_empty():
		return
	var ev: Dictionary = s.pending_event

	# Dark overlay covering the whole scene
	var overlay := ColorRect.new()
	overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	overlay.color = Color(0.0, 0.0, 0.0, 0.65)
	add_child(overlay)

	# Modal card centred on screen
	var modal := PanelContainer.new()
	modal.custom_minimum_size = Vector2(480.0, 0.0)
	modal.set_anchors_preset(Control.PRESET_CENTER)
	add_child(modal)

	var mv := VBoxContainer.new()
	mv.add_theme_constant_override("separation", 14)
	mv.custom_minimum_size = Vector2(440.0, 0.0)
	var title_txt: String = String(ev.get("title", "Событие"))
	mv.add_child(_hlabel(title_txt, 20, Palette.GOLD_HEX))
	mv.add_child(_label(String(ev.get("body", "")), 14, Palette.CREAM_HEX))
	mv.add_child(_spacer(8))

	var btn_row := HBoxContainer.new()
	btn_row.add_theme_constant_override("separation", 12)
	btn_row.size_flags_horizontal = Control.SIZE_EXPAND_FILL

	var btn_a := _button(String(ev.get("opt_a", "А")), 14)
	btn_a.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	btn_a.pressed.connect(func():
		s.resolve_event(0)
		overlay.queue_free()
		modal.queue_free()
		_rebuild())
	btn_row.add_child(btn_a)

	var btn_b := _button(String(ev.get("opt_b", "Б")), 14)
	btn_b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	btn_b.pressed.connect(func():
		s.resolve_event(1)
		overlay.queue_free()
		modal.queue_free()
		_rebuild())
	btn_row.add_child(btn_b)

	mv.add_child(btn_row)
	modal.add_child(mv)

func _arch_ru(a: String) -> String:
	match a:
		"power": return "силовая трасса"
		"street": return "уличная трасса"
		"highspeed": return "скоростная трасса"
		"technical": return "техничная трасса"
		"modern": return "современная трасса"
	return "трасса"

func _money(v: int) -> String:
	# group thousands with spaces
	var s := str(absi(v))
	var out := ""
	var cnt := 0
	for i in range(s.length() - 1, -1, -1):
		out = s[i] + out
		cnt += 1
		if cnt % 3 == 0 and i > 0:
			out = " " + out
	return out
