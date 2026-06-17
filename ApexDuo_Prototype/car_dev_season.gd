class_name CarDevSeason
extends RefCounted

# ============================================================
# CarDevSeason — сезонный слой новой разработки (фаза P2).
# ---------------------------------------------------------------
# Собирает CarDev (движок-математика) + CarDevData (каталог 16 деталей)
# в полноценную подсистему развития команды:
#   • per-part состояние: perf / reliability / condition / expertise,
#   • окна ATR с банкингом неиспользованных часов,
#   • запуск проекта (слайдер темп↔надёжность + риск + детерминированный тупик),
#   • инфраструктура (Аэротруба/CFD/Дизайн-центр/Завод/Разведотдел),
#   • свёртка в 5 скаляров болида (с жёстким аэро-потолком).
#
# Статические функции над plain-Dictionary `state` — состояние сериализуемо
# в JSON (для save/load Season). Мирор: cardev_season_check.py (ALL PASS).
# Дизайн: docs/CAR_DEV_DESIGN.md (§4, §5, §6, §7.5).
# НЕ трогает race_sim.gd: compose() отдаёт те же 5 скаляров, что и сейчас.
# ============================================================

# Свежее состояние развития команды (старт сезона / новая команда).
static func make_state() -> Dictionary:
	var parts: Dictionary = {}
	for k: String in CarDevData.PARTS:
		parts[k] = {"perf": 0.0, "reliability": 0.0, "condition": 1.0, "expertise": 0.0}
	return {
		"parts": parts,
		"facilities": {"tunnel": 0, "cfd": 0, "design_centre": 0, "factory": 0, "scout": 0},
		"atr_banked": 0.0,
		"atr_available": 100.0,
		"window_index": 0,
	}

# Часы ATR, доступные команде в текущем окне (грант по месту в КЧ + банк).
static func window_hours(state: Dictionary, kc_pos: int) -> float:
	return CarDev.atr_hours(kc_pos) + float(state.get("atr_banked", 0.0))

# Запуск проекта: тратит часы, двигает perf / надёжность / экспертизу детали.
# Возврат — результат CarDev.run_project (perf_gain, rel_gain, deadend, …).
static func run_project(state: Dictionary, part_key: String, hours: float,
		alloc: float, risk: String, kc_pos: int, seed_val: int) -> Dictionary:
	var parts: Dictionary = state["parts"]
	if not parts.has(part_key):
		return {}
	var p: Dictionary = parts[part_key]
	var fac: Dictionary = state["facilities"]
	var r: Dictionary = CarDev.run_project(
		float(p["perf"]), CarDevData.ceiling_of(part_key), hours, alloc, risk,
		int(fac["tunnel"]), int(fac["cfd"]), kc_pos, seed_val, float(p["expertise"]))
	p["perf"] = float(r["new_perf"])
	p["reliability"] = clampf(float(p["reliability"]) + float(r["rel_gain"]), 0.0, 1.0)
	p["expertise"] = CarDev.expertise_after(float(p["expertise"]), hours)
	return r

# Закрыть окно: банкуем остаток часов (≤20%), переходим к следующему окну.
static func close_window(state: Dictionary, unused_hours: float) -> void:
	state["atr_banked"] = CarDev.atr_rollover(unused_hours)
	state["window_index"] = int(state.get("window_index", 0)) + 1

# Свернуть состояние в 5 скаляров болида (compose_v2 клампит аэро к 0.15).
static func compose(state: Dictionary) -> Dictionary:
	return CarDevData.compose_v2(state["parts"])

# Слотов проектов от уровня Дизайн-центра (2..4).
static func project_slots(state: Dictionary) -> int:
	var fac: Dictionary = state["facilities"]
	return CarDev.design_centre_slots(int(fac["design_centre"]))

# Апкип зданий за окно (сумма уровней всех зданий × ставка).
static func facility_upkeep(state: Dictionary) -> int:
	var fac: Dictionary = state["facilities"]
	var total: int = int(fac["tunnel"]) + int(fac["cfd"]) \
		+ int(fac["design_centre"]) + int(fac["factory"]) + int(fac["scout"])
	return CarDev.facility_upkeep(total)
