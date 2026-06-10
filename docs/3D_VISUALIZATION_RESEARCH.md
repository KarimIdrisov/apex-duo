# 3D-визуализация гонки в Godot 4.6 — ресёрч-бриф

Статус: **только исследование, без изменений кода.** Это план и шпаргалка по
тому, как перевести гоночный вид из текущего 2D top-down (`track_map.gd`) в 3D,
сохранив архитектуру (детерминированный сим, кооп Mode A, авторитет хоста).

---

## TL;DR (рекомендация)

3D-вид — это **чистый «вид» поверх сима**, ровно как сейчас `track_map.gd`: сим
остаётся авторитетным, физики болидов нет, машины расставляются **кинематически**
по позиции на круге (`frac` → точка на 3D-кривой трассы). Никаких новых источников
недетерминизма — 3D только *читает* снапшот, как и 2D-миникарта сегодня.

Технический каркас минимален и весь на штатных узлах Godot:

- **Трасса** = `Path3D` с `Curve3D`, построенной из существующих контуров
  `TRACK_SHAPES`; дорога — `CSGPolygon3D` в режиме `PATH` (быстро) или свой
  `ArrayMesh` (красиво/с бэнкингом).
- **Болиды** = `MeshInstance3D` (22 штуки — это копейки для GPU), позиция и поворот
  берутся из `Curve3D.sample_baked_with_rotation(frac * длина)`.
- **Кооп split-screen** = два `SubViewport` + `SubViewportContainer`, общий мир,
  по камере на P5/P6. 3D-сцена живёт внутри `SubViewport`, который встраивается в
  уже существующий HUD как `Control` — это даёт **постепенную миграцию** и позволяет
  оставить нынешнюю миникарту оверлеем.

Целиться стоит в **«бродкаст-стилизацию»** (low-poly + PBR-материалы, небо, мягкие
тени, лёгкий glow, ТВ-камеры) — выглядит дорого, а по ассетам дёшево. Начать с
голого 3D-каркаса (плоская трасса + кубики-машины) и наращивать.

---

## 1. Ключевой принцип: 3D не трогает симуляцию

Сейчас связка работает так: сим выдаёт каждой машине `frac` (доля круга 0..1),
`main.gd` раз в кадр кормит `track_map.set_cars(...)`, а `_process` плавно
интерполирует отображаемую позицию (`disp`, `EASE`-lerp) между тиками 0.25 c.

В 3D **меняется только последний шаг** — отрисовка. Тот же `frac` отображается на
точку 3D-кривой. Поэтому:

- **Детерминизм сохраняется** — 3D-слой не пишет в сим, только читает (правило из
  `CLAUDE.md`: «Sim stays UI-free»).
- **Нетворкинг не ломается** — хост-авторитет уже шлёт снапшоты с `frac`; клиент
  рендерит снапшот хоть в 2D, хоть в 3D. 3D-вид целиком локальный.
- **Физика не нужна.** Godot 4.6 сделал Jolt физикой по умолчанию, но нам она ни к
  чему: машины не симулируются физически, а ставятся на кривую кинематически. Это
  и проще, и детерминированнее, чем `VehicleBody3D`.

---

## 2. Godot 4.6 — что важно для нас

Версия проекта — 4.6 (январь 2026). Релевантные для визуализации моменты:

- **Рендереры:** `Forward+` (десктоп, максимум эффектов — наш выбор по умолчанию),
  `Mobile` (в 4.6 заметно подтянули: дебандинг материалов в 3D, хорош и на десктопе
  как «быстрый» режим — пригодится для split-screen, где сцена рендерится дважды),
  `Compatibility` (GLES3/веб, если когда-нибудь будет web-сборка).
- **Backend на Windows:** по умолчанию теперь **Direct3D 12** (Vulkan остаётся
  поддержан). На качество картинки не влияет, но знать полезно при отладке драйверов.
- **Картинка из коробки лучше:** переписанные **SSR** (отражения без мерцания на
  скользящих углах), **reflection/radiance-пробы на октаэдральных картах** (дешевле
  по GPU и памяти), **glow теперь блендится до тонмаппинга** (Screen по умолчанию —
  корректнее и не дороже). Всё это — через `WorldEnvironment`/`Environment`.

Вывод: для «красиво» в 4.6 не нужен тяжёлый арт — достаточно грамотного
`WorldEnvironment` (небо, тонмаппинг, мягкий glow, лёгкий SSAO) и пары источников
света.

---

## 3. Трасса в 3D из существующего контура

У нас уже есть нормализованные контуры (`TRACK_SHAPES`: Монца, Монако,
Сильверстоун) и процедурный fallback по сиду. Их можно переиспользовать напрямую.

### Шаг 1. Контур → `Curve3D`

Берём точки контура (x, y в 0..1), раскладываем в плоскость XZ (y = высота = 0
пока плоско), масштабируем в метры (например, ×800 для условного «километрового»
круга) и добавляем как точки в `Curve3D` родителя `Path3D`. Кривую **замкнуть**
(последняя точка = первая), как уже делается в `_draw()` (`closed.append(pts[0])`).
`Curve3D` сама сглаживает безье между точками — контур станет плавным.

Полезные методы `Curve3D`: `get_baked_length()` (полная длина для пересчёта
`frac` в offset), `sample_baked(offset)` (позиция), `sample_baked_with_rotation(offset)`
(сразу `Transform3D` с ориентацией — см. §5).

### Шаг 2. Кривая → меш дороги

**Вариант A — `CSGPolygon3D` (быстрый прототип).** Узел `Path3D` → дочерний
`CSGPolygon3D`, у которого `mode = PATH`, `path_node` указывает на путь, а `polygon`
— это 2D-профиль поперечного сечения дороги (плоский прямоугольник нужной ширины).
CSG «протягивает» профиль вдоль кривой.
*Важная деталь из практики:* `path_interval` управляет частотой сэмплирования
вдоль пути — при крупном значении меш получается гранёным и «срезает» повороты.
Ставить мелким (**0.1, можно 0.05**) для гладкой трассы. Поребрики/обочина — второй
`CSGPolygon3D` пошире и пониже под основным, или отдельные полосы по краям.

**Вариант B — свой `ArrayMesh` + `SurfaceTool` (красиво/гибко).** Вручную идём по
кривой с шагом, на каждом сэмпле берём `sample_baked_with_rotation`, строим пару
вершин слева/справа от центра (по `basis.x`), сшиваем в ленту-триангл-стрип. Даёт
полный контроль: **бэнкинг** (наклон полотна в поворотах через поворот по `basis.z`),
**UV** под текстуру асфальта, переменную ширину, нарисованную **гоночную линию**,
зоны run-off. Это апгрейд, когда CSG упрётся в лимиты ориентации.

> Рекомендация: начать с **A** (за вечер видно трассу в 3D), переехать на **B**,
> когда понадобятся бэнкинг/текстуры/гоночная линия.

### Шаг 3. Рельеф (позже)

Пока y = 0 (плоско) — этого достаточно для читаемого вида сверху-сбоку. Позже
можно задать высоту точкам кривой (подъёмы Спа/Сузуки) и подложить простой террейн
или плоскость с шейдером.

---

## 4. Болиды в 3D

### Меши

- **Заглушки сразу:** CC0-наборы **Kenney** — `Racing Kit` (110 ассетов),
  `Car Kit` (45), `Racing Pack` (420). Low-poly, GLTF/OBJ, бесплатны даже коммерчески.
  Ставятся как `MeshInstance3D` за минуты.
- **Свои F1 позже:** простой формульный силуэт можно собрать из примитивов или
  смоделировать; текущий 2D-силуэт (`BODY`/`WHEELS`) — готовый референс пропорций.

### Сколько узлов на 22 машины

- **22 × `MeshInstance3D`** — абсолютно нормально, GPU этого даже не заметит. Плюс:
  у каждой свой материал (цвет команды), легко красить состояния (атака/клиппинг/
  пит/сход), вешать ореолы P5/P6 и шеврон лидера. **Рекомендую для старта.**
- **`MultiMeshInstance3D`** — один draw call на все инстансы, обновление через
  `set_instance_transform(i, xf)` в цикле; тянет тысячи объектов. Для 22 болидов это
  избыточно, но **идеально для декора** (трибуны, деревья, отбойники, толпа). Цвет
  per-instance возможен (`use_colors` + `set_instance_color`), но индивидуальные
  состояния/обводки делать сложнее. Держать в уме для окружения, не для машин.

### Цвета и состояния

Цвет команды — `StandardMaterial3D.albedo_color` (как нынешний `team_color`).
Состояния переносятся 1-в-1 из 2D-логики: атака → оранжевый ореол/эмиссия,
клиппинг → приглушённый albedo, пит → полупрозрачность/контур, сход → серый и
стоп. P5/P6 — кольцо/эмиссия (жёлтый/голубой), лидер — 3D-шеврон над машиной
(billboard-спрайт или маленький `MeshInstance3D`).

---

## 5. Мост «позиция на круге → 3D» (сердце визуализации)

На каждый кадр для каждой машины:

```
offset = frac * curve.get_baked_length()
xf     = curve.sample_baked_with_rotation(offset, cubic=true)
# xf.origin   — позиция на осевой линии
# -xf.basis.z — направление «вперёд» (forward), машина ориентируется бесплатно
# xf.basis.x  — вбок: сюда смещаем для разных гоночных линий / обгонов
car.global_transform = path.global_transform * xf
```

Заметки:

- `sample_baked_with_rotation` отдаёт `Transform3D`, где `basis.z` — forward,
  `basis.y` — up, `basis.x` — вбок. **Ориентация по движению получается даром** —
  в 2D мы её сейчас считаем вручную через соседнюю точку (`_norm_pos(fr+0.004)`).
- **Локальные координаты:** сэмплы — в системе самой кривой и игнорируют трансформ
  узла `Path3D`. Поэтому умножаем на `path.global_transform` (см. issue #90188).
- **Боковое смещение** (разводка машин, чтобы не ехали по одной линии, и визуальные
  обгоны): `xf.origin += xf.basis.x * lateral`, где `lateral` — небольшой сдвиг
  (например, по слоту/состоянию). Это чисто косметика поверх `frac`.
- **Плавность между тиками 0.25 c:** оставляем тот же приём, что в `track_map._process`
  — лерп отображаемого `frac` к целевому (`EASE`). В 3D лерпим позицию и **slerp-им
  ориентацию** (через `Quaternion` или `Basis.slerp`), чтобы повороты были плавными.
  Godot 4 умеет и встроенную физ-интерполяцию, но ручной лерп здесь точнее под наши
  тики.
- **`PathFollow3D`** — альтернатива: узел-ребёнок пути, ставим `progress_ratio = frac`,
  машина — его ребёнок. Удобно для 1–2 объектов (например, камера-«режиссёр» едет по
  своей траектории), но для 22 машин дешевле и гибче вручную `sample_baked`.

---

## 6. Камеры (то, что делает «красиво»)

Несколько режимов, переключаемых игроком/режиссёром:

- **Погоня (chase)** — за машиной игрока (P5/P6): камера лерпит к точке за/над
  болидом и делает `look_at` цели. Классика для «своей» машины.
- **ТВ/трекинговые** — набор фиксированных точек вдоль трассы (или `PathFollow3D` по
  внешнему контуру), каждая смотрит на лидирующую группу; переключение по зонам —
  узнаваемый телевизионный вид.
- **Орбитальная / кокпит** — для повторов и «вкусных» ракурсов.
- **Режиссёр (позже)** — авто-переключение на события: обгон, пит-стоп, выезд
  сейфти-кара. У нас эти события уже есть в сим-снапшоте — камере достаточно их читать.

Быстрый старт — плагин **Racing Cameras** из Godot Asset Library: готовые
`RacingChaseCamera`, `RacingTrackCamera`, `RacingOrbitCamera`, `RacingCockpitCamera`.
Минимум — как референс реализации сглаживания (лерп позиции + поворот к цели).

---

## 7. Кооп split-screen (Mode A) — критично для проекта

Mode A = два игрока за одним ПК (Директор P5 + Инженер P6). В 3D это штатный паттерн
Godot 4:

- На каждого игрока — пара **`SubViewportContainer` → `SubViewport`**, внутри своя
  **`Camera3D`**. Оба `SubViewport` смотрят в **общий мир** (`world_3d`), просто с
  разных камер. Эталон — демо **gdquest/godot-4-split-screen-coop** и гайд GDQuest
  (обновлён под 4.5).
- **Встраивание в текущий HUD:** весь HUD сейчас строится кодом в `main.gd` поверх
  почти пустого `main.tscn`. 3D-сцена кладётся в `SubViewportContainer`, который —
  обычный `Control`, т.е. встаёт в существующий layout рядом/вместо миникарты.
  **2D-оверлеи (таблица, пульты, миникарта) рисуются поверх** как сейчас. Это и есть
  путь постепенной миграции — `track_map.gd` можно сохранить как маленькую миникарту
  в углу.
- **Цена:** split-screen рендерит сцену **дважды** (две камеры) → следить за тенями и
  пост-эффектами; на слабых машинах для коопа можно временно занижать качество
  (вариант — `Mobile`-рендер или урезанные тени в split-режиме).

---

## 8. Производительность и бюджеты

- **22 машины — тривиально.** Основные расходы не в них, а в: тенях
  (`DirectionalLight3D` shadow), пост-обработке (SSAO/SSR/glow), и **×2 на
  split-screen**.
- **Рекомендации:** `Forward+` на десктопе для соло; для split-screen рассмотреть
  более дешёвые тени/`Mobile`-рендер. Декор (трибуны, деревья, отбойники) — через
  `MultiMeshInstance3D`. LOD по расстоянию для дальних объектов (в Godot 4 у
  `MeshInstance3D`/импортов есть встроенный visibility-range/LOD).
- **Godot нельзя запустить в этой песочнице** (правило из `CLAUDE.md`: нет бинаря/
  сети). Любой 3D-прототип проверяется в редакторе у тебя; здесь — только код, лор и
  численные модели.

---

## 9. Уровни амбиции (выбрать стиль)

**A. Минимальный 3D / стилизованный.** Плоская трасса, low-poly машины, плоские
цвета, одна камера. Дёшево, читаемо, «как настольный бродкаст Motorsport Manager».
Хорош как первый шаг и как запасной «быстрый» режим для слабого железа.

**B. Бродкаст-стилизация (цель).** Те же low-poly формы, но PBR-материалы, небо и
освещение через `WorldEnvironment`, мягкие тени, лёгкий glow/SSAO, поребрики,
гоночная линия, ТВ-камеры. Выглядит дорого, арт-затраты низкие. **Рекомендуемая
цель.**

**C. Реализм.** Импортные детальные модели F1, проработанное окружение, рельеф,
отражения. Дорого по арту и времени; не для прототипа.

> Путь: каркас по **A** → довести до **B**. **C** — только если появится художник.

---

## 10. Поэтапный план миграции (это план, не действие)

- **Фаза 0 — спайк.** Отдельная сцена `Node3D`: `Path3D` из одного контура
  `TRACK_SHAPES`, дорога `CSGPolygon3D`, одна `Camera3D`, N кубиков-машин, скормить им
  `frac` из снапшота. Цель — убедиться, что вид читается и машины едут правильно.
- **Фаза 1 — обёртка.** Завернуть 3D в `SubViewportContainer`, встроить в HUD
  `main.gd` рядом с миникартой (миникарту оставить оверлеем).
- **Фаза 2 — болиды.** Модели (Kenney-заглушки) + цвета команд + состояния
  (атака/клиппинг/пит/сход), ореолы P5/P6, шеврон лидера — перенос 2D-логики.
- **Фаза 3 — атмосфера.** `WorldEnvironment` (небо/тонмаппинг/glow/SSAO), свет, тени;
  камеры chase + ТВ.
- **Фаза 4 — кооп.** Второй `SubViewport`/камера, split-screen P5/P6, проверка цены
  рендера.
- **Фаза 5 — полировка.** Переезд дороги на `ArrayMesh` (бэнкинг, текстуры, гоночная
  линия), заливка трассы жёлтым под сейфти-каром, декор через `MultiMesh`,
  камера-режиссёр на события.

Каждая фаза по рабочему соглашению проекта: research → проверка чисел (где есть) →
имплементация → lint (трюк со свежим файлом) → обновить README/доки → сдать.

---

## 11. Подводные камни (прочитать до реализации)

- **CSGPolygon3D + ориентация/up-vector** — известная боль (гранёность при крупном
  `path_interval`, «закрутка» полотна). Лечится мелким `path_interval` и режимами
  rotation; при сложных трассах — переход на `ArrayMesh`.
- **`sample_baked*` отдаёт локальные координаты пути** — не забыть умножить на
  `path.global_transform` (issue #90188).
- **Замыкание кривой** — задать так же, как 2D-`loop` замыкается добавлением первой
  точки; иначе будет разрыв на старт/финише.
- **Детерминизм** — 3D-слой только читает снапшот; ничего из 3D (время кадра, порядок
  обхода узлов) не должно попадать обратно в сим.
- **Песочница** — Godot тут не запустить; проверка только у тебя в редакторе.

---

## 12. Шпаргалка по узлам/API

- **Сцена/камера:** `Node3D`, `Camera3D` (`current`, `look_at`, `fov`).
- **Свет/атмосфера:** `DirectionalLight3D` (+ shadow), `WorldEnvironment` →
  `Environment` (`Sky`, `tonemap`, `glow`, `ssao`, `ssr`), `OmniLight3D`/`SpotLight3D`
  точечно.
- **Трасса:** `Path3D` + `Curve3D` (`add_point`, `get_baked_length`, `sample_baked`,
  `sample_baked_with_rotation`); меш — `CSGPolygon3D` (`mode=PATH`, `path_node`,
  `polygon`, `path_interval`, `path_rotation`) **или** `ArrayMesh` + `SurfaceTool`.
- **Болиды:** `MeshInstance3D` (+ `StandardMaterial3D.albedo_color`/`emission`),
  для декора — `MultiMeshInstance3D` + `MultiMesh` (`set_instance_transform`,
  `set_instance_color`).
- **Движение по пути:** ручной `sample_baked_with_rotation` (много объектов) или
  `PathFollow3D` (`progress_ratio`) для одиночных.
- **Кооп/встраивание:** `SubViewport` (`world_3d`) + `SubViewportContainer` (это
  `Control` — встаёт в текущий HUD).

---

## 13. Детальный план реализации

Конкретный план сборки 3D-вида. Принцип — **новый виджет повторяет контракт
`TrackMap`** (`ensure_built` + `set_cars`), поэтому интеграция в `main.gd` сводится
к нескольким строкам, а 2D-миникарту можно оставить как fallback/оверлей. 3D ничего
не считает — только читает снапшот сима (детерминизм и хост-авторитет не затронуты).
`main.gd` — общий хотспот (см. `docs/WORKFLOW.md`): правки там координировать.

### 13.1. Новые файлы и контракт данных

- **`track_shapes.gd`** (`class TrackShapes`) — рефактор: вынести `TRACK_SHAPES` и
  процедурный генератор контура из `track_map.gd` в общий модуль, чтобы 2D и 3D брали
  **один источник правды**. API: `static func loop_for(name, seed) -> PackedVector2Array`.
- **`track_builder_3d.gd`** (`class TrackBuilder3D`) — чистая геометрия:
  нормализованный контур → `{curve: Curve3D, road: Path3D}`. Без UI и состояния —
  легко проверить в изоляции.
- **`race_view_3d.gd`** (`class RaceView3D`) — виджет вида. **Тот же API, что у
  `TrackMap`:** `ensure_built(track_name, seed)` и `set_cars(arr, sc)`.
- **(опц.) `car_view_3d.gd`** — контроллер одной машины, если логика состояний
  разрастётся (ореолы, шеврон, эмиссия). На старте — инлайн в `RaceView3D`.

**Контракт по машине** (ровно то, что вид уже получает в `set_cars` сегодня — вид
НЕ читает гоночные числа):

| поле | тип | зачем во вью |
|---|---|---|
| `id` | int | ключ узла и интерполяции |
| `frac` | float 0..1 | позиция на круге → точка на кривой |
| `team_color` | Color | материал болида |
| `state` | String | `clean`/`attack`/`clip`/`pit`/`out` → визуал состояния |
| `team` | bool | своя машина (ореол) |
| `lead` | bool | лидер (шеврон) |
| `slot` | int | 0 = P5 жёлтый, 1 = P6 голубой |

### 13.2. `RaceView3D` — каркас (проверено `gdparse` + `gdlint`)

```gdscript
class_name RaceView3D
extends Control
# 3D race view. Mirrors TrackMap's API (ensure_built / set_cars) so main.gd can
# feed it exactly like the 2D minimap. Pure view: reads the sim snapshot only.

const EASE := 9.0
const TRACK_SCALE := 800.0
const ROAD_W := 12.0

var _box: HBoxContainer
var _world: Node3D                 # holds track, cars, lights, env, main camera
var _vp_main: SubViewport
var _vp_side: SubViewport           # second screen for coop (optional)
var _curve: Curve3D
var _cars: Array = []
var _nodes: Dictionary = {}         # id -> MeshInstance3D
var _disp: Dictionary = {}          # id -> display frac
var _sc_active := false
var _key := ""

func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	_box = HBoxContainer.new()
	_box.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(_box)
	var c1 := SubViewportContainer.new()
	c1.stretch = true
	c1.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_box.add_child(c1)
	_vp_main = SubViewport.new()
	_vp_main.own_world_3d = true
	c1.add_child(_vp_main)
	_world = Node3D.new()
	_vp_main.add_child(_world)
	_setup_environment()
	_setup_camera(_world)
	set_process(true)

func ensure_built(track_name: String, seed_value: int) -> void:
	if track_name == _key and _curve != null:
		return
	_key = track_name
	var loop: PackedVector2Array = TrackShapes.loop_for(track_name, seed_value)
	var built: Dictionary = TrackBuilder3D.build(loop, TRACK_SCALE, ROAD_W)
	_curve = built["curve"]
	_world.add_child(built["road"])

func set_cars(arr: Array, sc: bool) -> void:
	_cars = arr
	_sc_active = sc

func _process(delta: float) -> void:
	if _cars.is_empty() or _curve == null:
		return
	var f := clampf(delta * EASE, 0.0, 1.0)
	var total := _curve.get_baked_length()
	for c in _cars:
		var id: int = int(c["id"])
		var tgt: float = float(c["frac"])
		var d: float = _disp.get(id, tgt)
		if tgt < d - 0.5:                 # wrapped past the line — go forward
			tgt += 1.0
		d = fposmod(lerp(d, tgt, f), 1.0)
		_disp[id] = d
		var node := _ensure_node(c)
		var xf: Transform3D = _curve.sample_baked_with_rotation(d * total, true)
		node.transform = xf
		_apply_state(node, c)

func enable_split() -> void:
	# Coop Mode A: a second SubViewport sharing the same World3D, own camera.
	var c2 := SubViewportContainer.new()
	c2.stretch = true
	c2.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_box.add_child(c2)
	_vp_side = SubViewport.new()
	_vp_side.world_3d = _vp_main.world_3d      # share the world the cars live in
	c2.add_child(_vp_side)
	_setup_camera(_vp_side)                     # camera lives in the 2nd viewport

func _ensure_node(c: Dictionary) -> MeshInstance3D:
	var id: int = int(c["id"])
	if _nodes.has(id):
		return _nodes[id]
	var m := MeshInstance3D.new()
	m.mesh = BoxMesh.new()
	var mat := StandardMaterial3D.new()
	mat.albedo_color = c["team_color"]
	m.material_override = mat
	_world.add_child(m)
	_nodes[id] = m
	return m

func _apply_state(node: MeshInstance3D, c: Dictionary) -> void:
	var mat := node.material_override as StandardMaterial3D
	var col: Color = c["team_color"]
	match String(c["state"]):
		"clip":
			col = col.lerp(Color("#3a4049"), 0.45)
		"out":
			col = Color("#555b66")
	mat.albedo_color = col

func _setup_camera(parent: Node) -> void:
	var cam := Camera3D.new()
	cam.position = Vector3(0.0, 700.0, 700.0)
	cam.current = true
	parent.add_child(cam)
	cam.look_at(Vector3.ZERO, Vector3.UP)

func _setup_environment() -> void:
	var we := WorldEnvironment.new()
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = Sky.new()
	env.glow_enabled = true
	we.environment = env
	_world.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-55.0, -35.0, 0.0)
	sun.shadow_enabled = true
	_world.add_child(sun)
```

> Здесь и в §13.3 опущена «начинка» (модели, ореолы, материал асфальта) — это каркас
> Фаз 2–3. `BoxMesh`-болиды и одна верхняя камера служат для проверки движения;
> позже `BoxMesh` меняется на модель, `_setup_camera` — на chase/ТВ-камеры (§6).

### 13.3. `TrackBuilder3D` — геометрия трассы (проверено)

```gdscript
class_name TrackBuilder3D
# Pure geometry helper: a normalized closed loop (0..1) -> Curve3D + road mesh.
# No UI, no sim state — safe to unit-check in isolation.

static func build(loop: PackedVector2Array, scale: float, width: float) -> Dictionary:
	var curve := Curve3D.new()
	for p in loop:
		var x: float = (p.x - 0.5) * scale
		var z: float = (p.y - 0.5) * scale
		curve.add_point(Vector3(x, 0.0, z))
	curve.add_point(curve.get_point_position(0))      # close the loop
	var path := Path3D.new()
	path.curve = curve
	var road := CSGPolygon3D.new()
	road.mode = CSGPolygon3D.MODE_PATH
	road.path_node = NodePath("..")                   # CSG is a child of the Path3D
	road.path_interval_type = CSGPolygon3D.PATH_INTERVAL_DISTANCE
	road.path_interval = 0.08                          # small = smooth corners
	road.polygon = PackedVector2Array([
		Vector2(-width * 0.5, 0.0), Vector2(width * 0.5, 0.0),
		Vector2(width * 0.5, 0.4), Vector2(-width * 0.5, 0.4)])
	path.add_child(road)
	return {"curve": curve, "road": path}
```

### 13.4. Интеграция в `main.gd` (точки касания)

Минимально и обратимо:

1. Рядом с контейнером миникарты добавить `RaceView3D` (тоже `Control`).
2. Там же, где сейчас зовётся `track_map.set_cars(snapshot, sc)`, добавить
   `race_view_3d.set_cars(snapshot, sc)` — **тот же массив**.
3. На старте гонки — `race_view_3d.ensure_built(track_name, seed)` (как
   `track_map.ensure_built`).
4. Кнопка-переключатель **«2D / 3D»** (рус. подпись): показывать один из вью;
   миникарту можно держать маленьким оверлеем поверх 3D.

### 13.5. Кооп split-screen (Mode A)

`RaceView3D.enable_split()` (см. §13.2): второй `SubViewport`, чей `world_3d`
указывает на мир основного вьюпорта (трасса/болиды/свет живут там), и **своя
`Camera3D` внутри второго вьюпорта**. Камеры P5/P6 наводятся на узлы болидов
(`_nodes[id]`). Цена — рендер сцены дважды; на слабом железе занижать тени/качество
(вариант — `Mobile`-рендер).

### 13.6. Порядок работ

| Фаза | Файлы | Готово, когда |
|---|---|---|
| 0. Спайк | отдельная сцена (throwaway) | трасса узнаётся, кубики едут по `frac`, ориентация верная |
| 1. Геометрия | `track_shapes.gd`, `track_builder_3d.gd` | кривая замкнута, длина/шаг ок, дорога гладкая |
| 2. Виджет | `race_view_3d.gd` | один вьюпорт, болиды-боксы по снапшоту, плавно |
| 3. Интеграция | `main.gd` (+ toggle) | 3D показывается в HUD, переключатель 2D/3D |
| 4. Болиды | `race_view_3d.gd` / `car_view_3d.gd` | модели, цвета команд, состояния, ореолы P5/P6, шеврон лидера |
| 5. Камеры + атмосфера | `race_view_3d.gd` | chase/ТВ-камеры, небо/свет/тени/glow |
| 6. Кооп | `race_view_3d.gd`, `main.gd` | split-screen P5/P6, цена рендера приемлема |
| 7. Полировка | `track_builder_3d.gd` (+) | `ArrayMesh`-дорога (бэнкинг/текстуры/гоночная линия), жёлтый под SC, декор `MultiMesh`, камера-режиссёр на события |

### 13.7. Верификация (под правила проекта)

- **Свежий-файл lint** каждого нового `.gd` (`gdparse` + `gdlint`) — обойти лаг
  маунта (gotcha #1 в `CLAUDE.md`). Сниппеты §13.2–13.3 **уже прогнаны**: оба
  `PARSE_OK`, `gdlint: no problems`.
- **Геометрию** (`TrackBuilder3D`) проверить численно по образцу Python-harness:
  длина кривой, равномерность шага, замыкание контура.
- **Визуал** — только в редакторе Godot у тебя (движок в песочнице не запускается,
  gotcha #2).
- **Детерминизм** — убедиться, что 3D-слой не пишет в сим, только читает снапшот.

### 13.8. Риски интеграции

- `main.gd` — общий файл (`docs/WORKFLOW.md`): правки координировать, не ломать
  существующий HUD/нетворкинг.
- Миникарту оставить как fallback/оверлей до стабилизации 3D.
- CSG-ориентация / `path_interval` — при сложных трассах переехать на `ArrayMesh`
  (§3, вариант B).
- Split-screen рендерит дважды — следить за тенями/постом.

---

## Источники

- [Godot 4.6 Release: It's all about your flow](https://godotengine.org/releases/4.6/)
- [Godot 4.6 Arrives With Major CG-Friendly Updates — Digital Production](https://digitalproduction.com/2026/01/28/godot-4-6-arrives-with-major-cg-friendly-updates/)
- [Discover 5 (plus 5) key features for CG artists in Godot 4.6 — CG Channel](https://www.cgchannel.com/2026/01/discover-5-key-features-for-cg-artists-in-godot-4-6/)
- [CSGPolygon3D — Godot Engine docs](https://docs.godotengine.org/en/stable/classes/class_csgpolygon3d.html)
- [Curve3D — Godot Engine docs](https://docs.godotengine.org/en/stable/classes/class_curve3d.html)
- [Path3D — Godot Engine docs](https://docs.godotengine.org/en/stable/classes/class_path3d.html)
- [Make a 3D Racing Game from Scratch in Godot — gameidea.org](https://gameidea.org/2024/08/30/make-a-3d-racing-game-from-scratch-in-godot/)
- [How to Make a 3D Road Generator in Godot (Bezier curves) — See More Games](https://seemore.games/how-to-make-roads-with-bezier-curves/)
- [Custom 3D Paths with an Attached Mesh in Godot 4 (racetracks) — YouTube](https://www.youtube.com/watch?v=HJTBNbl52jY)
- [Split Screen Coop — GDQuest Library](https://www.gdquest.com/library/split_screen_coop/)
- [godot-4-split-screen-coop — GitHub demo (SubViewport/SubViewportContainer)](https://github.com/gdquest-demos/godot-4-split-screen-coop)
- [Using MultiMeshInstance3D — Godot Engine docs](https://docs.godotengine.org/en/stable/tutorials/3d/using_multi_mesh_instance.html)
- [Optimization using MultiMeshes — Godot Engine docs](https://docs.godotengine.org/en/stable/tutorials/performance/using_multimesh.html)
- [Racing Cameras — Godot Asset Library](https://godotengine.org/asset-library/asset/3242)
- [Interpolated Camera — Godot 4 Recipes (KidsCanCode)](https://kidscancode.org/godot_recipes/4.x/3d/interpolated_camera/index.html)
- [Kenney — Racing Kit (CC0)](https://kenney.nl/assets/racing-kit) · [Car Kit](https://kenney.nl/assets/car-kit) · [Racing Pack](https://kenney.nl/assets/racing-pack)
- [Curve3D.sample_baked ignores parent transform — issue #90188](https://github.com/godotengine/godot/issues/90188)
