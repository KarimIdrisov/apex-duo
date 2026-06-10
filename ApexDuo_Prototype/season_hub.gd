extends Control

# ============================================================================
# Apex Duo — paddock hub (between races). Reads Season.active.
# Shows championship standings, budget, R&D upgrades, and starts the next race.
# ============================================================================

const ACCENT := Color("#c8102e")
const TEAM_COL := Color("#ffd166")
const ENGI_COL := Color("#66c2ff")
const BG := Color("#14161a")
const PANEL := Color("#1f242b")
const MUTED := "#9aa4b2"

func _ready() -> void:
	if Season.active == null:
		get_tree().change_scene_to_file("res://main.tscn")
		return
	Season.active.save_to_disk()      # auto-save every time we reach the paddock
	_rebuild()

func _rebuild() -> void:
	for c in get_children():
		c.queue_free()

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

	var title := _label("ПАДДОК · %s" % s.team_name, 30, "#c8102e")
	col.add_child(title)

	var round_txt := ""
	if s.is_complete():
		round_txt = "Сезон завершён · чемпион: %s" % s.champion_name()
	else:
		round_txt = "Этап %d из %d — %s" % [s.round_index + 1, s.total_rounds(), s.round_name()]
	col.add_child(_label(round_txt, 18, MUTED))
	col.add_child(_label("Сложность: %s · цель команды: %s" % [
		s.difficulty_name(), s.goal], 15, "#66c2ff"))
	if not s.is_complete():
		col.add_child(_label("Следующая трасса: %s · %s" % [
			s.round_name(), _arch_ru(s.round_archetype())], 15, "#ff8c42"))

	col.add_child(_label("Бюджет: $%s   ·   R&D очки: %d   ·   очки конструкторов: %d" % [
		_money(s.money), s.rp, s.constructor_points()], 16, "#5dd17a"))
	col.add_child(_label("Прогресс автоматически сохранён — можно выйти и продолжить позже.",
		13, "#7c8694"))

	# team drivers: morale + development
	for id in Season.TEAM_IDS:
		var mor := s.morale_of(id)
		var mcol := "#5dd17a"
		if mor < 40:
			mcol = "#e23b3b"
		elif mor < 66:
			mcol = "#f2c14e"
		col.add_child(_label("%s — настрой %d/100 · развитие +%.3f к темпу" % [
			s.driver_name(id), mor, s.dev_of(id)], 14, mcol))

	# FM-style season statistics
	col.add_child(_label("Статистика сезона:", 14, "#9aa4b2"))
	for id in Season.TEAM_IDS:
		var st := s.stat_of(id)
		var best_txt := "—" if int(st["best"]) == 0 else str(int(st["best"]))
		col.add_child(_label("%s — гонок %d · побед %d · подиумов %d · обгонов %d · лучший P%s · мест +%d" % [
			s.driver_name(id), int(st["races"]), int(st["wins"]), int(st["podiums"]),
			int(st["overtakes"]), best_txt, int(st["gained"])], 13, "#cfd6e0"))
	var lw := s.stats_leader("wins")
	if not lw.is_empty() and int(lw["val"]) > 0:
		var lo := s.stats_leader("overtakes")
		col.add_child(_label("Лидеры сезона: побед — %s (%d) · обгонов — %s (%d)" % [
			lw["name"], int(lw["val"]), lo["name"], int(lo["val"])], 13, "#66c2ff"))

	if not s.last_summary.is_empty():
		var ls: Dictionary = s.last_summary
		col.add_child(_label("Прошлый этап: команда +%d очк., +$%s призовых." % [
			ls["pts"], _money(ls["money"])], 15, "#66c2ff"))

	# main area: standings (left) + R&D (right) + contracts (below)
	var mid := HBoxContainer.new()
	mid.add_theme_constant_override("separation", 18)
	col.add_child(mid)
	mid.add_child(_build_standings(s))
	mid.add_child(_build_rnd(s))
	col.add_child(_build_contracts(s))

	# bottom actions — pinned below the scroll so they're always visible
	var bar := HBoxContainer.new()
	bar.add_theme_constant_override("separation", 10)
	outer.add_child(bar)

	if s.is_complete():
		var to_menu := _button("В главное меню", 17)
		to_menu.pressed.connect(func():
			Season.delete_save()       # season over: clear the save slot
			Season.active = null
			get_tree().change_scene_to_file("res://main.tscn"))
		bar.add_child(to_menu)
	else:
		var mode_txt := "лок. кооп" if s.coop else "соло"
		var start := _button("Старт гонки →  (%s)" % mode_txt, 18)
		start.custom_minimum_size = Vector2(260, 44)
		start.pressed.connect(func():
			s.race_pending = true
			get_tree().change_scene_to_file("res://main.tscn"))
		bar.add_child(start)
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
			get_tree().change_scene_to_file("res://main.tscn"))
		bar.add_child(quit)

# ---------------------------------------------------------------- standings
func _build_standings(s: Season) -> Control:
	var pc := _panel()
	pc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 4)
	v.add_child(_label("ЧЕМПИОНАТ ПИЛОТОВ", 18, "#ffffff"))
	v.add_child(HSeparator.new())

	var rows := s.standings_sorted()
	for i in rows.size():
		var r: Dictionary = rows[i]
		var box := HBoxContainer.new()
		box.add_theme_constant_override("separation", 8)
		var col := Color.WHITE
		if r["team"]:
			col = TEAM_COL if int(r["id"]) == 4 else ENGI_COL
		box.add_child(_cell("P%d" % (i + 1), 50, col))
		box.add_child(_cell(r["name"], 160, col))
		box.add_child(_cell("%d очк." % r["points"], 90, col))
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
	v.add_child(_label("R&D — РАЗВИТИЕ МАШИНЫ", 18, "#ffffff"))
	v.add_child(_label("Доступно R&D очков: %d" % s.rp, 15, "#5dd17a"))
	v.add_child(_spacer(4))

	# Group metadata: [group_key, group_title, accent_colour, description]
	var groups: Array = [
		["aero",        "АЭРОДИНАМИКА",    "#ffd166",
			"Прижимная сила — помогает на технических трассах (Монако)."],
		["power",       "МОТОР / ДВС",     "#ff8c42",
			"Мощность — прибавка на скоростных трассах (Монца)."],
		["energy",      "ЭНЕРГИЯ / ERS",   "#66c2ff",
			"Батарея и рекуперация — больше тяги из ERS в 2026."],
		["reliability", "НАДЁЖНОСТЬ",      "#b0e06e",
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
				btn.pressed.connect(func():
					if s.buy_part(pk_cap):
						_rebuild())
				row.add_child(btn)
			else:
				row.add_child(_label("  МАКС", 12, "#5dd17a"))

			part_rows_v.add_child(row)

		v.add_child(part_rows_v)

		if gi < groups.size() - 1:
			v.add_child(_spacer(6))

	# Tyre program (unchanged mechanic from META-1)
	v.add_child(_spacer(8))
	v.add_child(HSeparator.new())
	v.add_child(_spacer(4))
	v.add_child(_label("ШИНЫ", 15, "#c8e6ff"))
	v.add_child(_label("Шинная программа — снижает износ шин команды.", 12, MUTED))
	v.add_child(_label("Текущий бонус: −%d%% износа" % int(s.wear_bonus * 100.0), 12, "#66c2ff"))
	var tyre_row := HBoxContainer.new()
	tyre_row.add_theme_constant_override("separation", 8)
	var tyre := _button("Купить шинную программу · %d RP" % s.cost_tyre(), 14)
	tyre.disabled = s.rp < s.cost_tyre() or s.wear_bonus >= 0.36
	tyre.pressed.connect(func():
		if s.buy_tyre():
			_rebuild())
	tyre_row.add_child(tyre)
	v.add_child(tyre_row)

	v.add_child(_spacer(8))
	v.add_child(_label("R&D очки начисляются за каждый этап и за результат команды.",
		12, "#7c8694"))

	# META-3: cap status line
	v.add_child(_spacer(6))
	var cap_col := "#5dd17a"
	if s.cumulative_salary_spend > s.SALARY_CAP:
		cap_col = "#e23b3b"
	elif s.cumulative_salary_spend > s.SALARY_CAP * 3 / 4:
		cap_col = "#f2c14e"
	v.add_child(_label(s.cap_status_text(), 13, cap_col))

	pc.add_child(v)
	return pc

# ---------------------------------------------------------------- contracts (META-3)
func _build_contracts(s: Season) -> Control:
	var pc := _panel()
	pc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	v.add_child(_label("КОНТРАКТЫ ПИЛОТОВ", 18, "#ffffff"))
	v.add_child(HSeparator.new())

	for idx in s.TEAM_IDS.size():
		var driver_id: int = s.TEAM_IDS[idx]
		var c: Dictionary = s.contract_of(driver_id)
		var dname: String = s.driver_name(driver_id)
		var role_txt := "Директор · P5" if driver_id == 4 else "Инженер · P6"

		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 10)

		if c.is_empty():
			row.add_child(_label("%s (%s) — контракт отсутствует" % [dname, role_txt], 14, "#e23b3b"))
		else:
			var sal: int = int(c.get("salary_per_round", 0))
			var rem: int = int(c.get("rounds_remaining", 0))
			var contract_col := "#cfd6e0"
			if rem <= 1:
				contract_col = "#e23b3b"
			elif rem <= 2:
				contract_col = "#f2c14e"
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
	var cap_col := "#5dd17a"
	if s.cumulative_salary_spend > s.SALARY_CAP:
		cap_col = "#e23b3b"
	elif s.cumulative_salary_spend > s.SALARY_CAP * 3 / 4:
		cap_col = "#f2c14e"
	v.add_child(_label(s.cap_status_text(), 14, cap_col))
	v.add_child(_label(
		"Израсходовано: $%s  из  $%s  кап-бюджета" % [
			_money(s.cumulative_salary_spend), _money(s.SALARY_CAP)], 13, "#9aa4b2"))
	if s.cap_penalty_pending > 0:
		v.add_child(_label("Следующий штраф за превышение: -%d RP" % s.cap_penalty_pending,
			13, "#e23b3b"))

	# Basic transfer market: list available rival drivers to sign
	v.add_child(_spacer(8))
	v.add_child(_label("Трансферный рынок:", 15, "#ffffff"))
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
		trow.add_child(_label("%s · темп %.0f%%" % [rname, rskill * 100.0], 13, "#cfd6e0"))
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
	var sb := StyleBoxFlat.new()
	sb.bg_color = PANEL
	sb.set_corner_radius_all(10)
	sb.set_content_margin_all(14)
	pc.add_theme_stylebox_override("panel", sb)
	return pc

func _label(txt: String, sz: int, col: String) -> Label:
	var l := Label.new()
	l.text = txt
	l.add_theme_font_size_override("font_size", sz)
	l.add_theme_color_override("font_color", Color(col))
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
