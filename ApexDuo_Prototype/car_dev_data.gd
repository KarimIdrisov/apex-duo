class_name CarDevData
extends RefCounted

# ============================================================
# CarDevData — каталог 16 деталей нового car-dev (фаза P2, §4).
# ---------------------------------------------------------------
# Самодостаточная таблица данных + compose_v2(): переводит состояние
# деталей (perf / reliability / condition) в 5 скаляров болида
# (d_aero / d_power / d_energy / d_ch_rel / d_eng_rel), которые читает
# team_car() в f1_2026.gd. Существующий PARTS не трогается — это
# параллельная модель «с нуля» под непрерывный perf + потолок.
#
# Коридоры (сверено в cardev_data_check.py / cardev_season_check.py):
#   • сумма БАЗОВЫХ аэро-потолков = 0.100 (Аэротруба поднимает к жёсткому
#     общему потолку 0.15 = CarDev.AERO_TOTAL_CEILING; compose_v2 клампит сумму),
#   • сумма PU power+energy = 0.050 (== CarDev.PU_TOTAL_CEILING),
#   • 14 различных профилей трасс → нет «игнорируемых» деталей.
#
# Поля детали: group / scalar / ceiling(базовый потолок perf) /
#   layer (A=PU, B=аэро LTC, C=трансферная) / rel_weight (надёжность→rel
#   скаляр) / bias (профиль трассы) / buy (можно купить у другой команды).
# ============================================================

const COND_SCALE_FLOOR: float = 0.6   # вклад изношенной детали (floor)
const WORN_THRESHOLD: float = 0.30    # ниже — критическая
const WORN_REL_MALUS: float = 0.025   # пеня надёжности за критическую деталь
const REL_DELTA_CAP: float = 0.05     # коридор суммарной дельты надёжности (±)

const PARTS := {
	# --- АЭРО (слой B, LTC — только своя разработка) → d_aero ---
	"front_wing":     {"group": "aero", "scalar": "d_aero", "ceiling": 0.024,
		"layer": "B", "rel_weight": 0.030, "bias": "slow_corners", "buy": false},
	"rear_wing":      {"group": "aero", "scalar": "d_aero", "ceiling": 0.020,
		"layer": "B", "rel_weight": 0.030, "bias": "drag_balance", "buy": false},
	"floor":          {"group": "aero", "scalar": "d_aero", "ceiling": 0.020,
		"layer": "B", "rel_weight": 0.030, "bias": "fast_corners", "buy": false},
	"sidepods":       {"group": "aero", "scalar": "d_aero", "ceiling": 0.013,
		"layer": "B", "rel_weight": 0.025, "bias": "cooling_power", "buy": false},
	"suspension_geo": {"group": "aero", "scalar": "d_aero", "ceiling": 0.012,
		"layer": "B", "rel_weight": 0.030, "bias": "kerbs", "buy": false},
	"monocoque":      {"group": "aero", "scalar": "d_aero", "ceiling": 0.011,
		"layer": "B", "rel_weight": 0.040, "bias": "stiffness_all", "buy": false},
	# --- ДВС / ЭНЕРГИЯ (слой A) → d_power / d_energy ---
	"ice":            {"group": "power", "scalar": "d_power", "ceiling": 0.018,
		"layer": "A", "rel_weight": 0.020, "bias": "power", "buy": false},
	"turbo":          {"group": "power", "scalar": "d_power", "ceiling": 0.009,
		"layer": "A", "rel_weight": 0.020, "bias": "power", "buy": false},
	"battery":        {"group": "energy", "scalar": "d_energy", "ceiling": 0.015,
		"layer": "A", "rel_weight": 0.018, "bias": "ers_recovery", "buy": false},
	"ers":            {"group": "energy", "scalar": "d_energy", "ceiling": 0.008,
		"layer": "A", "rel_weight": 0.017, "bias": "ers_deploy", "buy": false},
	# --- ТРАНСФЕРНЫЕ (слой C, можно купить) → d_ch_rel ---
	"gearbox":        {"group": "reliability", "scalar": "d_ch_rel", "ceiling": 0.012,
		"layer": "C", "rel_weight": 0.0, "bias": "shift", "buy": true},
	"hydraulics":     {"group": "reliability", "scalar": "d_ch_rel", "ceiling": 0.010,
		"layer": "C", "rel_weight": 0.0, "bias": "systems", "buy": true},
	"cooling":        {"group": "reliability", "scalar": "d_ch_rel", "ceiling": 0.012,
		"layer": "C", "rel_weight": 0.0, "bias": "hot_tracks", "buy": true},
	"differential":   {"group": "reliability", "scalar": "d_ch_rel", "ceiling": 0.010,
		"layer": "C", "rel_weight": 0.0, "bias": "traction", "buy": true},
	# --- ПОСТАВЩИКИ (выбор, не уровневая разработка) — ceiling 0 ---
	"brakes":         {"group": "reliability", "scalar": "d_ch_rel", "ceiling": 0.0,
		"layer": "C", "rel_weight": 0.0, "bias": "braking", "buy": true},
	"fuel":           {"group": "power", "scalar": "d_power", "ceiling": 0.0,
		"layer": "A", "rel_weight": 0.0, "bias": "power", "buy": true},
}

# Масштаб вклада по износу: 1.0 при condition=1, COND_SCALE_FLOOR при 0.
static func cond_scale(condition: float) -> float:
	return COND_SCALE_FLOOR + (1.0 - COND_SCALE_FLOOR) * clampf(condition, 0.0, 1.0)

# Базовый потолок детали (до бонуса зданий).
static func ceiling_of(part_key: String) -> float:
	if not PARTS.has(part_key):
		return 0.0
	var pdef: Dictionary = PARTS[part_key]
	return float(pdef["ceiling"])

# compose_v2: состояние деталей → 5 скаляров болида.
# states[part_key] = {"perf": float, "reliability": float, "condition": float}.
static func compose_v2(states: Dictionary) -> Dictionary:
	var out := {"d_aero": 0.0, "d_power": 0.0, "d_energy": 0.0,
		"d_ch_rel": 0.0, "d_eng_rel": 0.0}
	for part_key: String in states:
		if not PARTS.has(part_key):
			continue
		var pdef: Dictionary = PARTS[part_key]
		var st: Dictionary = states[part_key]
		var grp: String = String(pdef["group"])
		var scalar: String = String(pdef["scalar"])
		var rel_weight: float = float(pdef["rel_weight"])
		var perf: float = float(st.get("perf", 0.0))
		var rel: float = float(st.get("reliability", 0.0))
		var cond: float = float(st.get("condition", 1.0))
		var sc: float = cond_scale(cond)
		# Темп → основной скаляр (масштаб по износу).
		out[scalar] = float(out[scalar]) + perf * sc
		# Надёжность → rel-скаляр группы.
		var rel_target: String = "d_eng_rel" \
			if (grp == "power" or grp == "energy") else "d_ch_rel"
		out[rel_target] = float(out[rel_target]) + rel * rel_weight
		# Критическая деталь бьёт по надёжности группы.
		if cond < WORN_THRESHOLD:
			out[rel_target] = float(out[rel_target]) - WORN_REL_MALUS
	# Жёсткий суммарный потолок аэро (база сумм 0.10 + Аэротруба → клампим к 0.15).
	out["d_aero"] = minf(float(out["d_aero"]), CarDev.AERO_TOTAL_CEILING)
	# Коридор надёжности (сумма по деталям не выходит за ±REL_DELTA_CAP).
	out["d_ch_rel"] = clampf(float(out["d_ch_rel"]), -REL_DELTA_CAP, REL_DELTA_CAP)
	out["d_eng_rel"] = clampf(float(out["d_eng_rel"]), -REL_DELTA_CAP, REL_DELTA_CAP)
	return out
