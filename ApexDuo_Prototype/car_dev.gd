class_name CarDev
extends RefCounted

# ============================================================
# CarDev — детерминированное ядро разработки болида (фаза P1).
# ---------------------------------------------------------------
# Чистая логика, без UI и без связи с race_sim.gd. Реализует:
#   • ATR-часы и скользящую шкалу по месту в КЧ (анти-снежный ком #1),
#   • затухание отдачи у потолка (анти-снежный ком #2),
#   • потолок/эффективность от инфраструктуры (Аэротруба/CFD, §7.5),
#   • резолв проекта: слайдер темп↔надёжность + шкала риска с
#     ДЕТЕРМИНИРОВАННЫМ тупиком (поток drng = mix32-хеш сида).
#
# Дизайн: docs/CAR_DEV_DESIGN.md (§5, §6, §7.5, §8, §14).
# Числа сверены 1:1 с Python-мирором cardev_module_check.py (15/15 PASS):
# тот же 32-битный хеш => тот же бросок тупика при том же сиде.
# Выход run_project() — прирост perf/reliability, который season.gd
# складывает в существующие 5 скаляров через compose_part_deltas().
# ============================================================

# --- Анти-снежный ком / ATR ---
const ATR_BASE: float = 100.0          # часов на окно (база, до шкалы)
const ATR_BANK_CAP: float = 0.20       # доля базы, переносимая на следующее окно
const GAIN_PER_HOUR: float = 0.00012   # сырой d_aero на час при полном diminish
const PERF_SOFT_KNEE: float = 0.70     # доля потолка, после которой растёт цена
const AERO_TOTAL_CEILING: float = 0.15 # жёсткий суммарный потолок аэро-развития

# --- Проект: компромиссы ---
const REL_TRICKLE: float = 0.002       # трикл надёжности даже при alloc=0 (из MM)
const RISK_MULT := {"safe": 0.8, "normal": 1.0, "aggressive": 1.4}
const DEADEND_YIELD: float = 0.30      # тупик отдаёт 0.3× ожидаемого темпа
const DEADEND_REL_MALUS: float = 0.02  # тупик ещё и бьёт по надёжности

# --- Экспертиза (на деталь, §4 решение E) ---
const EXPERTISE_GAIN_MAX: float = 0.50 # экспертиза 1.0 → +50% отдачи проекта
const EXPERTISE_PER_HOUR: float = 0.0015 # прирост экспертизы за час проекта

# --- ДВС: конвергенция (§7) ---
const PU_CONVERGE_GAP: float = 0.025   # дефицит PU, ниже которого мотор заморожен
const PU_CONVERGE_RATE: float = 0.40   # доля дефицита сверх порога → шаг развития
const PU_TOTAL_CEILING: float = 0.05   # суммарный размах PU-развития в сезоне

# --- Инфраструктура (§7.5) ---
const AERO_CEILING_PER_FACILITY: float = 0.02 # +потолок за уровень Аэротрубы
const CFD_GAIN_MULT_PER_LEVEL: float = 0.06   # ×(1+0.06·lvl) к отдаче за уровень CFD
const FACILITY_MAX_LEVEL: int = 5
const FACILITY_UPKEEP: int = 30_000           # апкип за окно за уровень здания
# Дизайн-центр: уровень 0..5 → слотов проектов (PROJECT_SLOTS_BASE..MAX).
const DESIGN_CENTRE_SLOTS: Array = [2, 2, 3, 3, 4, 4]
# Сезонный капекс-лимит на здания по тиру (0=контендер, 1=середняк, 2=андердог).
const CAPEX_ALLOWANCE: Array = [2_500_000, 3_000_000, 3_500_000]

# Сид-смесь для броска тупика (отдельный поток, как erng в race_sim).
const DEADEND_SEED_MIX: int = 0x0EA12D0

# ------------------------------------------------------------------
# ATR: скользящая шкала по месту в КЧ (1→0.70 … 11→1.20).
static func atr_scale(pos: int) -> float:
	var p: int = clampi(pos, 1, 11)
	return 0.70 + 0.05 * float(p - 1)

# Часы ATR, начисляемые команде на окно (база × шкала).
static func atr_hours(pos: int) -> float:
	return ATR_BASE * atr_scale(pos)

# Сколько неиспользованных часов переносится на следующее окно (банк, §6).
static func atr_rollover(unused: float) -> float:
	return clampf(unused, 0.0, ATR_BANK_CAP * ATR_BASE)

# Шанс тупика на agressive по месту (лидер 0.25 → аутсайдер ~0.05).
static func p_deadend(pos: int) -> float:
	var p: int = clampi(pos, 1, 11)
	return maxf(0.0, 0.25 - 0.02 * float(p - 1))

# Эффективный потолок детали с учётом Аэротрубы (не выше жёсткого AERO_TOTAL_CEILING).
static func eff_ceiling(base_ceiling: float, tunnel_level: int) -> float:
	var t: int = clampi(tunnel_level, 0, FACILITY_MAX_LEVEL)
	return minf(AERO_TOTAL_CEILING, base_ceiling + AERO_CEILING_PER_FACILITY * float(t))

# Отдача на час с учётом CFD-центра.
static func gain_per_hour_eff(cfd_level: int) -> float:
	var c: int = clampi(cfd_level, 0, FACILITY_MAX_LEVEL)
	return GAIN_PER_HOUR * (1.0 + CFD_GAIN_MULT_PER_LEVEL * float(c))

# Кривая затухания: 1.0 ниже колена, 0.0 у потолка.
static func diminish(perf: float, ceiling: float) -> float:
	if ceiling <= 0.0:
		return 0.0
	var knee: float = PERF_SOFT_KNEE * ceiling
	if perf <= knee:
		return 1.0
	if perf >= ceiling:
		return 0.0
	return (ceiling - perf) / (ceiling - knee)

# --- Детерминированный 32-битный mix-хеш (повторяет Python-мирор бит-в-бит) ---
static func mix32(x: int) -> int:
	var v: int = x & 0xFFFFFFFF
	v = ((v ^ (v >> 16)) * 0x45D9F3B) & 0xFFFFFFFF
	v = ((v ^ (v >> 16)) * 0x45D9F3B) & 0xFFFFFFFF
	v = (v ^ (v >> 16)) & 0xFFFFFFFF
	return v

static func u01(seed_val: int) -> float:
	return float(mix32(seed_val)) / 4294967296.0

# --- Экспертиза (на деталь) ---
# Множитель отдачи проекта от накопленной экспертизы (1.0 .. 1.5).
static func expertise_gain_mult(expertise: float) -> float:
	return 1.0 + EXPERTISE_GAIN_MAX * clampf(expertise, 0.0, 1.0)

# Экспертиза после проекта в `hours` часов (растёт, насыщается на 1.0).
static func expertise_after(expertise: float, hours: float) -> float:
	return clampf(expertise + EXPERTISE_PER_HOUR * hours, 0.0, 1.0)

# --- Конвергенция ДВС (§7) ---
# По дефициту мощности относительно лидера: лидер (дефицит ≤ порога) заморожен → 0;
# отстающий получает шаг развития, пропорциональный дефициту, но не выше PU_TOTAL_CEILING.
static func pu_converge_step(deficit: float) -> float:
	if deficit <= PU_CONVERGE_GAP:
		return 0.0
	return clampf((deficit - PU_CONVERGE_GAP) * PU_CONVERGE_RATE, 0.0, PU_TOTAL_CEILING)

# --- Инфраструктура (§7.5) ---
# Слотов проектов по уровню Дизайн-центра (2..4).
static func design_centre_slots(level: int) -> int:
	var lv: int = clampi(level, 0, FACILITY_MAX_LEVEL)
	return int(DESIGN_CENTRE_SLOTS[lv])

# Апкип зданий за окно (суммарные уровни × ставка).
static func facility_upkeep(total_levels: int) -> int:
	return total_levels * FACILITY_UPKEEP

# Сезонный капекс-лимит на здания по тиру команды.
static func capex_allowance(tier: int) -> int:
	var t: int = clampi(tier, 0, 2)
	return int(CAPEX_ALLOWANCE[t])

# ------------------------------------------------------------------
# Резолв одного проекта разработки детали.
#   perf          — текущий уровень темпа детали
#   base_ceiling  — базовый потолок детали (до зданий)
#   hours         — выделенные часы ATR
#   alloc         — слайдер 0..1: доля вложения в ТЕМП (1−alloc → надёжность)
#   risk          — "safe" | "normal" | "aggressive"
#   tunnel_level  — уровень Аэротрубы (поднимает потолок)
#   cfd_level     — уровень CFD-центра (поднимает отдачу/час)
#   pos           — место в КЧ (для шанса тупика)
#   seed_val      — детерминированный сид окна/детали
#   expertise     — накопленная экспертиза детали 0..1 (опц., усиливает отдачу)
# Возврат: {perf_gain, rel_gain, deadend, new_perf, ceiling}.
static func run_project(
		perf: float, base_ceiling: float, hours: float, alloc: float,
		risk: String, tunnel_level: int, cfd_level: int, pos: int, seed_val: int,
		expertise: float = 0.0
) -> Dictionary:
	var ceiling: float = eff_ceiling(base_ceiling, tunnel_level)
	var dim: float = diminish(perf, ceiling)
	var rmult: float = float(RISK_MULT.get(risk, 1.0))
	var raw: float = hours * gain_per_hour_eff(cfd_level) * dim * rmult \
		* expertise_gain_mult(expertise)
	var a: float = clampf(alloc, 0.0, 1.0)

	var deadend: bool = false
	if risk == "aggressive":
		if u01(seed_val ^ DEADEND_SEED_MIX) < p_deadend(pos):
			deadend = true

	var perf_part: float = raw * a
	if deadend:
		perf_part *= DEADEND_YIELD
	var rel_part: float = raw * (1.0 - a) + REL_TRICKLE
	if deadend:
		rel_part -= DEADEND_REL_MALUS

	var new_perf: float = minf(ceiling, perf + perf_part)
	return {
		"perf_gain": new_perf - perf,
		"rel_gain": rel_part,
		"deadend": deadend,
		"new_perf": new_perf,
		"ceiling": ceiling,
	}
