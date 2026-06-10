extends Control

# ============================================================================
# Apex Duo — paddock hub (between races). Reads Season.active.
# Shows championship standings, budget, R&D upgrades, and starts the next race.
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
	# Only the host autosaves; clients never write the season file (spec §0.6).
	if Net.role() != "client":
		Season.active.save_to_disk()
	# Host: send the initial season state to any connected client.
	if Net.role() == "host" and Net.partner_connected:
		Net.net_season_full.rpc(Season.active.to_dict())
	_rebuild()

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

func _rebuild() -> void:
	for c in get_children():
		c.queue_free()
	_feed_label = null   # reset reference — will be reassigned below

	var bg := ColorRect.new()
	bg.color = BG
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(bg)

	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 10)
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(col)
	var outer := VBoxContainer.new()
	outer.add_theme_constant_override("separation", 10)
	outer.add_child(scroll)
	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 26)
	margin.add_child(outer)
	add_child(margin)

	var s := Season.active

	# Online-season status bar (only when networked).
	var net_role: String = Net.role()
	if net_role != "":
		var net_status_col := Palette.INFO_HEX if net_role == "host" else Palette.GOLD_HEX
		var partner_status: String
		if net_role == "host":
			partner_status = "партнёр в игре" if Net.partner_connected else "ожидание партнёра…"
			col.add_child(_label("ОНЛАЙН-СЕЗОН · хост · %s" % partner_status, 14, net_status_col))
		else:
			col.add_child(_label("ОНЛАЙН-СЕЗОН · клиент (зеркало)", 14, net_status_col))
		# Partner feed (online actions log).
		_feed_label = _label("", 13, Palette.MUTED_HEX)
		_feed_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		col.add_child(_feed_label)
		_update_feed_label()

	var title := _hlabel("ПАДДОК · %s" % s.team_name, 30, Palette.GOLD_HEX, 2)
	col.add_child(title)

	var round_txt := ""
	if s.is_complete():
		round_txt = "Сезон завершён · чемпион: %s" % s.champion_name()
	else:
		round_txt = "Этап %d из %d — %s" % [s.round_index + 1, s.total_rounds(), s.round_name()]
	col.add_child(_label(round_txt, 18, MUTED))
	col.add_child(_label("Сложность: %s · цель команды: %s" % [
		s.difficulty_name(), s.goal], 15, Palette.INFO_HEX))
	if not s.is_complete():
		col.add_child(_label("Следующая трасса: %s · %s" % [
			s.round_name(), _arch_ru(s.round_archetype())], 15, Palette.WARN_HEX))

	col.add_child(_label("Бюджет: $%s   ·   R&D очки: %d   ·   очки конструкторов: %d" % [
		_money(s.money), s.rp, s.constructor_points()], 16, Palette.GOOD_HEX))
	col.add_child(_label("Прогресс автоматически сохранён — можно выйти и продолжить позже.",
		13, Palette.FINE_HEX))

	# team drivers: morale + development
	for id in Season.TEAM_IDS:
		var mor := s.morale_of(id)
		var mcol := Palette.GOOD_HEX
		if mor < 40:
			mcol = Palette.DANG_HEX
		elif mor < 66:
			mcol = Palette.WARN_HEX
		col.add_child(_label("%s — настрой %d/100 · развитие +%.3f к темпу" % [
			s.driver_name(id), mor, s.dev_of(id)], 14, mcol))

	# FM-style season statistics
	col.add_child(_label("Статистика сезона:", 14, Palette.MUTED_HEX))
	for id in Season.TEAM_IDS:
		var st := s.stat_of(id)
		var best_txt := "—" if int(st["best"]) == 0 else str(int(st["best"]))
		col.add_child(_label("%s — гонок %d · побед %d · подиумов %d · обгонов %d · лучший P%s · мест +%d" % [
			s.driver_name(id), int(st["races"]), int(st["wins"]), int(st["podiums"]),
			int(st["overtakes"]), best_txt, int(st["gained"])], 13, Palette.CREAM_HEX))
	var lw := s.stats_leader("wins")
	if not lw.is_empty() and int(lw["val"]) > 0:
		var lo := s.stats_leader("overtakes")
		col.add_child(_label("Лидеры сезона: побед — %s (%d) · обгонов — %s (%d)" % [
			lw["name"], int(lw["val"]), lo["name"], int(lo["val"])], 13, Palette.INFO_HEX))

	if not s.last_summary.is_empty():
		var ls: Dictionary = s.last_summary
		col.add_child(_label("Прошлый этап: команда +%d очк., +$%s призовых." % [
			ls["pts"], _money(ls["money"])], 15, Palette.INFO_HEX))

	# M1: income-per-round summary line
	var inc: int = s.income_per_round()
	var cpos: int = s.constructor_position()
	var prize_line: int = s.constructor_prize(cpos)
	col.add_child(_label(
		"Доход/этап (прогноз): $%s  (призовые P%d: $%s + спонсоры: $%s)" % [
			_money(inc), cpos, _money(prize_line), _money(inc - prize_line)],
		15, Palette.GOOD_HEX))

	# main area: standings (left) + R&D (right) + contracts (below) + sponsors
	var mid := HBoxContainer.new()
	mid.add_theme_constant_override("separation", 18)
	col.add_child(mid)
	mid.add_child(_build_standings(s))
	mid.add_child(_build_rnd(s))
	col.add_child(_build_contracts(s))
	col.add_child(_build_staff(s))
	col.add_child(_build_sponsors(s))

	# bottom actions — pinned below the scroll so they're always visible
	var bar := HBoxContainer.new()
	bar.add_theme_constant_override("separation", 10)
	outer.add_child(bar)

	var net_role2: String = Net.role()
	if s.is_complete():
		var to_menu := _button("В главное меню", 17)
		to_menu.pressed.connect(func():
			Season.delete_save()       # season over: clear the save slot
			Season.active = null
			if net_role2 != "":
				Net.disconnect_peer()
			get_tree().change_scene_to_file("res://main.tscn"))
		bar.add_child(to_menu)
	elif net_role2 == "client":
		# Client mirror: only a "Ready" ping and "Quit" — no start/simulate.
		var ready_btn := _button("✔ Готов к старту", 16)
		ready_btn.pressed.connect(func():
			Net.net_season_ready.rpc_id(1, true))
		bar.add_child(ready_btn)
		var spacer_c := Control.new()
		spacer_c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		bar.add_child(spacer_c)
		var quit_c := _button("Выйти в меню", 15)
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
		var start := _button("Старт гонки →  (%s)" % mode_txt, 18)
		start.custom_minimum_size = Vector2(260, 44)
		start.pressed.connect(func():
			s.race_pending = true
			if net_role2 == "host":
				# Notify the client to enter the race scene.
				var track_name: String = s.round_name()
				Net.net_season_start_race.rpc(track_name, 0)
			get_tree().change_scene_to_file("res://main.tscn"))
		bar.add_child(start)
		if net_role2 != "host":
			# Quick-sim only available offline.
			var quick := _button("⏩ Симулировать этап", 15)
			quick.pressed.connect(func():
				s.race_pending = true
				s.race_quick = true
				get_tree().change_scene_to_file("res://main.tscn"))
			bar.add_child(quick)
		var profile := _button("Пилоты", 15)
		profile.pressed.connect(func(): get_tree().change_scene_to_file("res://driver_profile.tscn"))
		bar.add_child(profile)
		var statsb := _button("Статистика", 15)
		statsb.pressed.connect(func(): get_tree().change_scene_to_file("res://stats.tscn"))
		bar.add_child(statsb)
		var spacer := Control.new()
		spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		bar.add_child(spacer)
		var quit := _button("Выйти в меню", 15)
		quit.pressed.connect(func():
			Season.active = null
			if net_role2 != "":
				Net.disconnect_peer()
			get_tree().change_scene_to_file("res://main.tscn"))
		bar.add_child(quit)

# ---------------------------------------------------------------- standings
func _build_standings(s: Season) -> Control:
	var pc := _panel()
	pc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 4)
	v.add_child(_hlabel("ЧЕМПИОНАТ ПИЛОТОВ", 18, Palette.CREAM_HEX))
	v.add_child(HSeparator.new())

	var rows := s.standings_sorted()
	for i in rows.size():
		var r: Dictionary = rows[i]
		var box := HBoxContainer.new()
		box.add_theme_constant_override("separation", 8)
		var col := Color.WHITE
		if r["team"]:
			col = TEAM_COL if int(r["id"]) == 4 else ENGI_COL
		var pos_cell := _cell("P%d" % (i + 1), 50, col)
		pos_cell.add_theme_font_override("font", Palette.display_font(600, 0))
		box.add_child(pos_cell)
		box.add_child(_cell(r["name"], 160, col))
		var pts_cell := _cell("%d очк." % r["points"], 90, col)
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
	pc.custom_minimum_size = Vector2(380, 0)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	v.add_child(_hlabel("R&D — РАЗВИТИЕ МАШИНЫ", 18, Palette.CREAM_HEX))
	v.add_child(_label("Доступно R&D очков: %d" % s.rp, 15, Palette.GOOD_HEX))
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

	var deltas: Dictionary = F1_2026.compose_part_deltas(s.part_levels)

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

			if cur_lv < max_lv:
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
			else:
				row.add_child(_label("  МАКС", 12, Palette.GOOD_HEX))

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
	var cap_col := Palette.GOOD_HEX
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
		var role_txt := "Директор · P5" if driver_id == 4 else "Инженер · P6"

		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 10)

		if c.is_empty():
			row.add_child(_label("%s (%s) — контракт отсутствует" % [dname, role_txt], 14, Palette.DANG_HEX))
		else:
			var sal: int = int(c.get("salary_per_round", 0))
			var rem: int = int(c.get("rounds_remaining", 0))
			var contract_col := Palette.CREAM_HEX
			if rem <= 1:
				contract_col = Palette.DANG_HEX
			elif rem <= 2:
				contract_col = Palette.WARN_HEX
			var rem_txt := "контракт истёк!" if rem <= 0 else "%d эт. осталось" % rem
			row.add_child(_label("%s (%s) — зарплата $%s / эт. · %s" % [
				dname, role_txt, _money(sal), rem_txt], 14, contract_col))

			var bar2 := HBoxContainer.new()
			bar2.add_theme_constant_override("separation", 6)

			# Re-sign button if expired
			if rem <= 0:
				var resign_btn := _button("Продлить · $%s" % _money(s.resign_cost(driver_id)), 13)
				resign_btn.disabled = s.money < s.resign_cost(driver_id)
				resign_btn.pressed.connect(func():
					if s.resign_driver(driver_id):
						_rebuild())
				bar2.add_child(resign_btn)

			# Upgrade salary button (if not already premium)
			var tier_idx: int = clampi(s.team_tier, 0, 2)
			var premium: int = int(s.SALARY_PREMIUM[tier_idx])
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
	var cap_col := Palette.GOOD_HEX
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

	# Basic transfer market: list available rival drivers to sign
	v.add_child(_spacer(8))
	v.add_child(_label("Трансферный рынок:", 15, Palette.CREAM_HEX))
	var grid := F1_2026.race_grid(s.player_team)
	var shown := 0
	for gi in grid.size():
		if shown >= 5:
			break
		var gd: Dictionary = grid[gi]
		if bool(gd.get("team", false)):
			continue
		var rskill: float = float(gd.get("skill", 0.0))
		var rname: String = String(gd.get("name", "?"))
		var fee: int = s.transfer_fee(rskill)
		var rival_sal: int = int(s.SALARY_DEFAULT[clampi(s.team_tier, 0, 2)])
		var trow := HBoxContainer.new()
		trow.add_theme_constant_override("separation", 8)
		trow.add_child(_label("%s · темп %.0f%%" % [rname, rskill * 100.0], 13, Palette.CREAM_HEX))
		# Sign as P5 button
		var s5_btn := _button("→P5 · $%s" % _money(fee), 12)
		s5_btn.disabled = s.money < fee
		var cap_gid := gi
		s5_btn.pressed.connect(func():
			if s.sign_rival(4, float(grid[cap_gid].get("skill", 0.0)), rival_sal):
				_rebuild())
		trow.add_child(s5_btn)
		# Sign as P6 button
		var s6_btn := _button("→P6 · $%s" % _money(fee), 12)
		s6_btn.disabled = s.money < fee
		s6_btn.pressed.connect(func():
			if s.sign_rival(5, float(grid[cap_gid].get("skill", 0.0)), rival_sal):
				_rebuild())
		trow.add_child(s6_btn)
		v.add_child(trow)
		shown += 1

	pc.add_child(v)
	return pc

# ---------------------------------------------------------------- helpers
func _panel() -> PanelContainer:
	var pc := PanelContainer.new()
	pc.add_theme_stylebox_override("panel", Palette.panel())
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
	var payroll_txt := "Зарплаты персонала: $%s/этап · топ-3 (★) вне кост-кэпа" % _money(
		s.staff_payroll_per_round())
	v.add_child(_label(payroll_txt, 13, Palette.MUTED_HEX))

	var exempt: Array = s.cap_exempt_roles()
	for m in s.staff:
		var md: Dictionary = m as Dictionary
		var role: String = String(md.get("role", ""))
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
