# QUALI_DESIGN.md — Интерактивная квалификация Apex Duo
_Спецификация для программиста. Версия 1.0 · 2026-06-10_

---

## 1. Цель и рамки

Заменить мгновенный результат `_run_qualifying()` на живую
сессию Q1 → Q2 → Q3, которую оба игрока наблюдают и в которой каждый
принимает несколько ключевых решений за свою машину.

**V1 (этот спек):** три сегмента, башня времён, выбор окна/режима, до 2 попыток.
**V2 (не в этом спеке):** наборы шин, жёлтые флаги, секторные времена.

---

## 2. Ключевые числа

| Параметр | Значение | Обоснование |
|---|---|---|
| Длина одного сегмента (sim-время) | **240 с** | Типичный Q-сегмент ≈ 18 мин → 4,5 мин при сжатии ×4,5; при ×1 — 4 мин, при ×4 — 1 мин; вся сессия при ×4 ≈ 3 мин |
| Прогрессия эволюции трассы в сегменте | **+0,18 с/круг** к концу от начала (линейно) | Реальный выигрыш «поздней» попытки ≈ 0,15–0,20 с; делает выбор окна осмысленным без доминирования |
| Дельта «атака» vs «банк» | **−0,12 с** среднее время на круге | Соответствует QUALI_NOISE_BASE 0.08; атака быстрее, но разброс шире (σ×1,6) |
| Риск «испорченной попытки» (окно «поздно», режим «атака», composure < 0,55) | **P = 0,16** | Базовый QUALI_SCRAPPY_P 0,05 × (1,3−composure×0,6) × 2 (позднее окно) × 1,6 (атака); число верифицировать в Python |
| Стоимость второй попытки (V1) | **0** (материальных штрафов нет) | Шины/топливо — V2; второй выезд только если первый провальный (см. §5) |

---

## 3. Архитектура — новые файлы и изменения

### 3.1 Новый файл `ApexDuo_Prototype/quali_sim.gd`

```
class_name QualiSim
extends RefCounted
```

Чистый симулятор квалификации, без UI. Зеркалит стиль RaceSim:
const-тюнинги наверху, шаг по времени `tick(dt)`, никаких Node.

**Поля состояния:**
- `var segment: int = 0`  — текущий сегмент (0=Q1, 1=Q2, 2=Q3)
- `var elapsed: float = 0.0`  — время внутри текущего сегмента (с)
- `var seg_duration: float = 240.0`  — TUNABLE
- `var finished: bool = false`
- `var drivers: Array`  — Array[RaceSim.Driver], все 22
- `var times: Dictionary`  — driver_id → лучшее время (float, меньше = быстрее)
- `var runs: Dictionary`  — driver_id → число завершённых попыток в этом сегменте (0/1/2)
- `var eliminated: Array`  — driver_ids выбывших водителей (не участвуют в следующем сегменте)
- `var grid_ids: Array`  — финальная сетка pole-first после Q3
- `var qrng: RaceSim.RNG`  — подаётся из _init, тот же поток что seed mix32(mix32(seed))

**Const-тюнинги (top of file):**
```gdscript
const SEG_DURATION   := 240.0   # sim-секунды на сегмент
const EVO_GAIN       := 0.18    # с/круг выигрыш от полной эволюции трассы (линейно за сегмент)
const ATTACK_DELTA   := -0.12   # с/круг быстрее в режиме атаки
const ATTACK_SIGMA   := 1.6     # множитель шума (vs банк = 1.0)
const LATE_EVO_BONUS := 0.18    # дополнительная эволюция для окна «поздно»
const EARLY_CLEAN_P  := 1.0     # гарантированно чистая попытка (без риска пробки)
const LATE_RISK_P    := 0.08    # базовый риск пробки/жёлтого в окне «поздно» (без учёта composure)
const SECOND_RUN_THRESHOLD := 0.35  # запросить 2-ю попытку, если 1-я хуже P_CUT + этот порог (с)
```

**Метод `tick(dt: float)`:**
- Продвигает `elapsed += dt`
- Для каждого водителя: если его запланированный `run_time` <= elapsed и он ещё не выехал — рассчитать время (§4), записать в `times`
- При `elapsed >= seg_duration`: закрыть сегмент, выбить 6 медленнейших (`_eliminate()`), обнулить `elapsed`, `segment += 1`; если segment == 3 — `finished = true`, собрать `grid_ids`

**Метод `set_player_choice(driver_id: int, window: String, mode: String)`**
- Записывает выбор игрока (`"early"/"mid"/"late"`, `"bank"/"attack"`)
- Если выбор пришёл после того как run_time уже прошёл — игнорировать (попытка уже рассчитана с дефолтом AI)
- Вызывается из main.gd до старта сегмента (или во время)

**Метод `request_second_run(driver_id: int)`**
- Разрешает вторую попытку, если `runs[driver_id] == 1` и текущий сегмент не завершён
- Планирует `run_time` для второй попытки

**Метод `apply_to_sim(sim: RaceSim)`**
- Записывает результат в уже созданный RaceSim:
  - Для каждого driver: `d.grid_pos`, `d.lap_frac = float(n-1-pos) * RaceSim.GRID_GAP`, `d.tyre_temp = RaceSim.TYRE_TEMP_GRID`
  - Перезаписывает `sim.quali_times` и `sim.quali_grid`
  - НЕ потребляет `sim.rng` — только читает/пишет итоговые поля

### 3.2 Изменения в `race_sim.gd`

**Добавить метод `apply_quali_results(grid_ids: Array, times_dict: Dictionary)`:**
```gdscript
func apply_quali_results(grid_ids: Array, times_dict: Dictionary) -> void:
    quali_times = times_dict
    quali_grid = grid_ids
    var n: int = grid_ids.size()
    for gp in n:
        var did: int = int(grid_ids[gp])
        var d: RaceSim.Driver = get_driver_by_id(did)
        if d == null:
            continue
        d.grid_pos = gp + 1
        d.lap_frac = float(n - 1 - gp) * GRID_GAP
        d.tyre_temp = TYRE_TEMP_GRID
```

Метод `_run_qualifying()` ОСТАЁТСЯ без изменений как fallback.
Конструктор `_init` по-прежнему вызывает `_run_qualifying()` —
`apply_quali_results` вызывается ПОСЛЕ, перезаписывая результаты.
Это важно: `qrng` всё равно должен быть полностью исчерпан
(сделать `_run_qualifying` idempotent-safe: она не потребляет rng,
только qrng — ок, qrng изолирован).

### 3.3 Изменения в `main.gd`

**Новые переменные:**
```gdscript
var quali_sim: QualiSim          # активная квалификационная сессия
var quali_phase := false         # true пока идёт интерактивная квалификация
var quali_accum := 0.0
var _player_choices: Dictionary = {}  # car_id → {window, mode, second_requested}
```

**Новый метод `_start_quali_phase()`** — вызывается вместо/до `_show_prerace_modal()`:
- Создаёт `QualiSim` с теми же drivers что в `sim` и тем же seed
- Устанавливает `quali_phase = true`, `pre_race_open = true` (блокирует гонку)
- Показывает UI квалификации (§6)

**В `_process()`:**
```gdscript
if quali_phase and not paused:
    quali_accum += delta * speed
    while quali_accum >= STEP and not quali_sim.finished:
        quali_sim.tick(STEP)
        quali_accum -= STEP
    _update_quali_hud()
    if quali_sim.finished:
        quali_sim.apply_to_sim(sim)
        _finish_quali_phase()
```

**`_finish_quali_phase()`:**
- `quali_phase = false`
- Отправить `net_quali_rows.rpc(build_quali_rows(sim))` хосту/клиенту
- Вызвать `_show_prerace_modal()` (уже существующий флоу — тайры и «Поехали»)

**«Симулировать квалу» (fallback):**
- Кнопка в UI квалификации (§6.4)
- Завершает `QualiSim` мгновенно: пока `not quali_sim.finished` — `quali_sim.tick(STEP)`
- Далее тот же `apply_to_sim` → `_finish_quali_phase()`
- Также является fallback если `game_mode == "client"` (клиент не управляет квали — хост тикает, клиент получает результат через `net_quali_rows`)

---

## 4. Формула времени круга квалификации

```
qt = base_laptime
   − skill × SKILL_K
   − (car_power − car_aero) × (track.power − track.downforce) × CAR_K
   + COMPOUNDS["soft"]["pace"]
   + evo_bonus
   + mode_delta
   + noise
   + scrappy_penalty
```

### 4.1 Эволюция трассы (evo_bonus)

```
evo_frac = elapsed / seg_duration  # 0..1 в текущем сегменте
window_offset = {early: 0.15, mid: 0.5, late: 0.85}[window]
evo_at_run = evo_frac × window_offset × EVO_GAIN
evo_bonus = −evo_at_run   # отрицательный = быстрее
```

Поздняя попытка в конце сегмента: evo_frac ≈ 0.90, window_offset = 0.85 →
evo_bonus ≈ −0.138 с. В начале сегмента (early): ≈ −0.02 с.
Среднее за сегмент (mid): ≈ −0.08 с.

### 4.2 Режим

```
mode_delta = {bank: 0.0, attack: ATTACK_DELTA}[mode]
noise_sigma_mult = {bank: 1.0, attack: ATTACK_SIGMA}[mode]
```

### 4.3 Шум (используется qrng)

```
qnoise = QUALI_NOISE_BASE × (1.3 − consistency × 0.6) × noise_sigma_mult
noise = qrng.rangef(−qnoise, qnoise)
```

### 4.4 Испорченная попытка (scrappy)

Базовый расчёт из `_run_qualifying` плюс модификаторы:

```
scrappy_p = QUALI_SCRAPPY_P × (1.3 − composure × 0.6)
if mode == "attack":   scrappy_p × 1.6
if window == "late":   scrappy_p × 2.0
if qrng.unit() < scrappy_p:
    qt += qrng.rangef(QUALI_SCRAPPY_MIN, QUALI_SCRAPPY_MAX)
```

Итог при composure=0.4, mode=attack, window=late:
`scrappy_p ≈ 0.05 × 1.06 × 1.6 × 2.0 ≈ 0.17` — примерно 1 из 6 попыток.

### 4.5 AI-политика (детерминированная, только qrng)

Агрессивность (aggression attr) определяет выбор:
```
if aggression > 0.65:
    window = "late", mode = "attack"
elif aggression > 0.40:
    window = "mid",  mode = qrng.unit() < 0.5 ? "attack" : "bank"
else:
    window = "early", mode = "bank"
```
Вторая попытка: AI запрашивает её если первое время хуже P_CUT + 0,35 с И
это Q3 И aggression > 0.50.

Весь AI-расчёт вызывается единожды в начале сегмента (до тика) — deterministic.

---

## 5. Правила выбывания и тай-брейк

| Сегмент | Стартуют | Выбывают | Продолжают |
|---|---|---|---|
| Q1 | 22 | 6 медленнейших | 16 |
| Q2 | 16 | 6 медленнейших | 10 |
| Q3 | 10 | — | итоговая сетка |

Тай-брейк: при равных лучших временах (float equal) — сначала тот, кто
показал время раньше по `elapsed` (вышел и установил время первым). Это
воспроизводимо при одинаковом seed + inputs.

Выбывшие в Q1 занимают P17–P22 в итоговой сетке по убыванию их Q1-времени.
Выбывшие в Q2 занимают P11–P16.

---

## 6. UI — компоновка и спецификация

### 6.1 Общая компоновка

Заменяет `_show_prerace_modal()` для хоста/соло/локала.
Полноэкранный overlay (как текущий модал, `Color(0,0,0,0.72)`).
Внутри HBoxContainer с двумя колонками:

```
┌────────────────────────────────────────────────────────────┐
│  БАШНЯ ВРЕМЁН (60%)        │  МОИ МАШИНЫ (40%)            │
│  22/16/10 строк             │  P5 панель (золото)           │
│  Позиция · Имя · Время     │  P6 панель (синий)            │
│  Полоса Q1/Q2/Q3           │  — статус / кнопки выбора     │
│                             │  Таймер сегмента              │
│                             │  Скорость × / Симулировать    │
└────────────────────────────────────────────────────────────┘
```

### 6.2 Башня времён (левая колонка, ~60% ширины)

Заголовок:
```
[GOLD Oswald 600] КВАЛИФИКАЦИЯ — Q1/Q2/Q3 · Трасса · Таймер: MM:SS
```

Строка на каждый из 22/16/10 активных пилотов:
```
[pos] [name]              [время или "—"]  [gap к лидеру]
```
- `pos`: P1–P22, Oswald 500 14px, CREAM
- `name`: Jost 400 14px, цвет команды (d.color); команда игрока — GOLD/P6
- `время`: `1:XX.XXX` если есть, иначе `—`; лидер сегмента — GOLD
- `gap`: `+0.000` серый MUTED; P10/P16 (линия выбывания) — DANG полоса снизу строки
- Выбывшие (ниже черты) — FINE цвет, курсив если поддерживается
- Строки без времени мигают при активном выезде (bool `on_lap` в snapshot)

Полоса прогресса сегмента под заголовком: 1px PANEL2 фон, заполнение GOLD.

### 6.3 Панель «Мои машины» (правая колонка, ~40%)

По одной карточке на каждую из двух машин команды.

**Карточка P5 (border GOLD P5):**
```
[Oswald 600 20px GOLD] МАШИНА P5 · [имя пилота]
Статус: [текст — см. §6.3а]
───────────────────────
ОКНО ВЫЕЗДА
[ Рано ] [ Середина* ] [ Поздно ]   (* = активная кнопка)
РЕЖИМ
[ Банк ] [ Атака ]
───────────────────────
[Кнопка: Выехать]  (появляется когда окно открыто)
[Кнопка: 2-я попытка]  (если 1-я завершена, плохой результат)
───────────────────────
Лучшее: 1:XX.XXX   P#
```

**Карточка P6** — зеркало, border P6 (синий).

**§6.3а Статус карточки** (строковые состояния):
- `"Ожидает старта сегмента"` — MUTED
- `"Окно открыто — выберите режим!"` — WARN (мигает)
- `"На круге…"` — INFO + прогресс-бар анимация
- `"Лучшее время: X.XXX"` — GOOD если улучшение, CREAM иначе
- `"Испорченная попытка! Ошибка пилота"` — DANG
- `"Выбыли (P##)"` — FINE

### 6.4 Нижняя полоса (внутри overlay)

```
[×1] [×4] [×8]   [Симулировать до конца]   [Пропустить квалу (instant)]
```
- `×1/×4/×8` — множитель скорости симуляции (передаётся через `speed` main.gd)
- `Симулировать до конца` — доигрывает текущий сегмент до конца instant, затем продолжает
- `Пропустить квалу (instant)` — мгновенно прогоняет всю квалификацию через `_run_qualifying()` fallback (старый код)

**Кнопки отключены** пока `game_mode == "client"` (клиент не управляет квали).

### 6.5 Переход к гонке

После `quali_sim.finished`:
1. Башня замирает (все 22 строки с финальными временами, 2 с задержки)
2. Полоса статуса: `"КВАЛИФИКАЦИЯ ЗАВЕРШЕНА"` GOLD
3. Автоматически открывается текущий `_show_prerace_modal()` — СТАРТОВАЯ РЕЗИНА — как есть сейчас

---

## 7. Сетевой протокол (онлайн co-op)

Принцип: хост запускает `QualiSim` авторитетно; клиент отправляет свои
выборы через один новый RPC; хост рассылает компактные снапшоты.

### Новые RPC в `main.gd`

```gdscript
# Клиент → хост: выбор окна и режима для машины клиента (car_id = 5)
@rpc("any_peer", "call_remote", "reliable")
func net_quali_choice(car_id: int, window: String, mode: String) -> void:
    if multiplayer.is_server() and quali_sim != null:
        quali_sim.set_player_choice(car_id, window, mode)

# Клиент → хост: запрос второй попытки
@rpc("any_peer", "call_remote", "reliable")
func net_quali_second_run(car_id: int) -> void:
    if multiplayer.is_server() and quali_sim != null:
        quali_sim.request_second_run(car_id)

# Хост → клиент: снапшот квалификационной сессии (unreliable_ordered, ~12 Hz)
@rpc("authority", "call_remote", "unreliable_ordered")
func net_quali_snapshot(payload: Dictionary) -> void:
    _apply_quali_snapshot(payload)
```

**Структура `net_quali_snapshot` payload:**
```json
{
  "segment": 0,
  "elapsed": 123.5,
  "seg_duration": 240.0,
  "times": {"4": 87.32, "12": 87.55, ...},
  "on_lap": [4, 7],
  "eliminated": [18, 20, ...],
  "finished": false
}
```
Клиент рендерит башню из этого снапшота. Никаких вычислений на клиенте.

После `quali_sim.finished` хост вызывает уже существующий `net_quali_rows.rpc()`
для передачи финальной таблицы — изменений в этом RPC не нужно.

---

## 8. Детерминизм — гарантии

1. `QualiSim` использует **только** `qrng` (тот же `mix32(mix32(seed))`).
   Никаких вызовов `sim.rng` или `sim.erng`.
2. AI-выборы детерминированы из attrs + qrng: одинаковый seed → одинаковая сетка AI.
3. Выборы игрока входят в формулу как параметры — `(seed, player_inputs) → grid`.
4. `apply_to_sim` пишет только финальные поля (grid_pos, lap_frac, tyre_temp,
   quali_times, quali_grid). Не тикает `sim.rng`.
5. Фолбэк `_run_qualifying()` внутри `_init` отрабатывает до `apply_to_sim` —
   итоговые поля перезаписываются, rng-поток `sim.rng` не затронут ни в одном пути.

---

## 9. Критерии приёмки (верифицируемые headless)

Все критерии проверяются Python-скриптом `quali_check.py` в harness:

**AC-1 Детерминизм**
Два прогона с одинаковым `seed=12345` и одинаковыми `player_inputs`
(`window=mid, mode=bank` для обоих) → финальный `grid_ids` идентичен.

**AC-2 Эволюция трассы**
Для 100 случайных AI-сессий: среднее время круга в окне «поздно»
должно быть на **0,10–0,20 с** быстрее, чем в окне «рано» при прочих равных.

**AC-3 Премия за атаку с риском**
Для 500 попыток (фиксированный водитель, composure=0.5):
- Среднее `attack` быстрее `bank` на **0,08–0,15 с**
- Стандартное отклонение `attack` ≥ 1,5× стандартного отклонения `bank`

**AC-4 Выбывание**
После полной квалификации (22 водителя): `len(grid_ids) == 22`,
`len(eliminated_q1) == 6`, `len(eliminated_q2) == 6`, `len(q3_finishers) == 10`.

**AC-5 Скорость прогона**
Полная сессия (×1, три сегмента по 240 с) в Python-зеркале завершается за < 1 с.

**AC-6 Реалистичный разброс сетки**
Топ-команда (skill ≈ 0,92) занимает позицию P1–P5 в ≥ 70% из 50 прогонов.
Аутсайдер (skill ≈ 0,73) занимает P18–P22 в ≥ 65% из 50 прогонов.

---

## 10. Файлы и ответственность

| Файл | Что меняется |
|---|---|
| `quali_sim.gd` | **НОВЫЙ** — весь симулятор квалификации |
| `race_sim.gd` | +`apply_quali_results()` метод (≈ 12 строк), `_run_qualifying` без изменений |
| `main.gd` | +`_start_quali_phase()`, +`_update_quali_hud()`, +`_finish_quali_phase()`, +3 новых RPC, в `_process` ветка `quali_phase`, в `_start` вызов `_start_quali_phase` вместо прямого `_show_prerace_modal` |

Сцены не меняются. `QualiSim` — `RefCounted`, не `Node`.

---

## 11. V2 — за рамками этого спека

- Наборы шин (отслеживание использованных комплектов мягкой)
- Жёлтые флаги / красная флаг в квалификации
- Секторные времена в башне (S1/S2/S3 с цветовой кодировкой)
- Мокрая квалификация (выбор шины перед выездом)
- Анимация выезда на миникарте
