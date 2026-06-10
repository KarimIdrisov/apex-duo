# Race HUD — F1 Dashboard Redesign

**Date:** 2026-06-11  
**Status:** Draft  
**Scope:** Race screen only (`main.gd` + `race_sim.gd` + `f1_2026.gd` + new `assets/`)

---

## Goal

Rebuild the race HUD to match the visual style of formula1dashboard.com:
dark background, team logo per row, 3-letter driver code, position delta,
tyre compound icon, 15 mini-sector colour blocks, live status bar.

The track minimap is **removed** for now. The leaderboard becomes the
centrepiece, flanked by player control panels on the right.

**Reference screenshot:** Monaco Grand Prix leaderboard from
`app.formula1dashboard.com/live-timing`

---

## Layout

```
┌─────────────────────────────────────────────────────────────┐
│  TOP STATUS BAR  (track · lap X/Y · timer · weather)        │
├──────────────────────────────────────┬──────────────────────┤
│                                      │  УПРАВЛЕНИЕ          │
│  LEADERBOARD TABLE  (F1 Dashboard    │  P5 card             │
│  style, full height, scrollable)     │    photo · wear bars │
│                                      │    ERS · tempo · пит │
│                                      │  P6 card             │
│                                      │    photo · wear bars │
│                                      │    ERS · tempo · пит │
│                                      ├──────────────────────┤
│                                      │  Лучший круг сессии  │
└──────────────────────────────────────┴──────────────────────┘
```

Width split: leaderboard ~75 %, controls ~25 % (≈ 172 px at 1080p).  
Track map and 3D view are **hidden** (`visible = false`), not deleted — they can be restored later. Their build functions remain in place.

---

## Top Status Bar

Single `HBoxContainer` row, height 36 px, background `#0e0e1a`.

| Slot | Content | Notes |
|---|---|---|
| Track name | `sim.track.name` bold white 13 px | |
| Sub-label | "ГОНКА" muted 9 px below | |
| LIVE chip | `● В ЭФИРЕ` green pill | hidden after `sim.finished` |
| SC chip | `🟡 АВТО-БЕЗОПАСНОСТЬ` yellow | visible while `sim.sc_active` |
| Timer | elapsed race time `MM:SS` amber chip | accumulated in `_process` |
| Spacer | `HBoxContainer` expand fill | |
| Круги | `XX / YY` bold + "КРУГИ" muted label | |
| Divider | 1 px vertical line | |
| Воздух | `23°` + "ВОЗДУХ" label | static placeholder for now |
| Трасса | track temp placeholder | static |
| Осадки | "Сухо" / "Дождь" coloured | static, extend with weather later |

---

## Leaderboard Table

### Column spec

| # | Key | Width (px) | Content | Colour rules |
|---|---|---|---|---|
| 1 | pos | 28 | `P1`–`P22` | White; player rows gold `#f5c518` |
| 2 | stripe | 3 | Vertical bar | Team colour, full row height |
| 3 | logo | 40 × 24 | `TextureRect` from `assets/teams/` | — |
| 4 | abbrev | 36 | 3-letter driver code (ANT/HAM…) | Team colour; player rows gold bold |
| 5 | delta | 32 | `▲3` / `▼1` / `—` | Green ▲, red ▼, muted — |
| 6 | lap | 26 | Current lap int | Muted grey |
| 7 | pit | 52 | "В ПИТ" blue badge OR pit count | Badge when `car.pitting`; else count |
| 8 | tyre | 64 | `TextureRect` 22×22 from `assets/tyres/{compound}.png` + age laps label | PNG icons generated (128px, tread+letter); Godot scales to 22px |
| 9 | best_lap | 72 | Best lap `M:SS.mmm` | Purple `#b15de8` if session fastest; yellow if personal best |
| 10 | gap | 58 | `+5.209` / `ЛИДЕР` / `СХОД` | White; red for СХОД |
| 11 | interval | 52 | `+1.386` / `—` | White |
| 12 | sectors | 72 | 15 mini-sector blocks (3 groups of 5) | See Mini-Sectors |
| 13 | last_lap | 68 | Last lap `M:SS.mmm` | Purple if == session fastest |

**Row height:** 26 px (no sub-row bars — keeps table compact like the reference).  
**Row tints:**
- Player car: `rgba(245,197,24, 0.07)` background, gold stripe
- In pit: `rgba(59,130,246, 0.07)` background
- DNF: `opacity 0.35`, gap cell shows `СХОД` in red
- SC bunched: no extra tint (gap already compresses visually)

### Tyre compound icon

`ColorRect` 20×20 px, `border_radius 10` (circle), colour fill + letter label:

| Compound | Fill | Border | Letter |
|---|---|---|---|
| soft | `#3d0a0a` | `#e8002d` | S red |
| medium | `#3d3200` | `#ffd700` | M yellow |
| hard | `#1e1e28` | `#cccccc` | H white |
| inter | `#0a2e1a` | `#39b54a` | I green |
| wet | `#0a1a3d` | `#1e88e5` | W blue |

### Position delta

Computed once per lap completion: `grid_pos[id] - current_pos`.  
Stored in `car.delta_pos` (int).  Show `▲N` green / `▼N` red / `—` grey for 0.

---

## Mini-Sectors

### Sim side (`race_sim.gd`)

**Constants (top of file):**
```gdscript
const MINI_S := 15          # mini-sectors per lap
const MINI_S_GROUPS := 3    # groups shown (one per macro-sector)
```

**Per-car state** (add to `_make_car()` dict):
```gdscript
"ms_accum":   0.0,                       # time accumulating in current mini-sector
"ms_cur":     0,                         # current mini-sector index (0..14)
"ms_times":   [],                        # [float×15] in-progress current lap (reset each lap)
"ms_best":    [],                        # [float×15] personal best per mini-sector (all-time)
"ms_prev":    [],                        # [float×15] last COMPLETED lap (for green comparison)
```

**Session state** (add to `RaceSim` vars):
```gdscript
var session_ms_best: Array = []          # [float×15] absolute session best
```

**Per tick** (inside the main step loop, after lap_frac update):
```
bucket = int(car.lap_frac * MINI_S)
if bucket != car.ms_cur:
    finalize previous bucket: ms_accum → ms_times[ms_cur]
    reset ms_accum = 0, ms_cur = bucket
ms_accum += STEP
```

**On lap completion** (in phase-3 lap bookkeeping):
```
finalize final bucket
for i in MINI_S:
    if ms_times[i] < ms_best[i] or ms_best[i] == 0:
        ms_best[i] = ms_times[i]
    if ms_times[i] < session_ms_best[i] or session_ms_best[i] == 0:
        session_ms_best[i] = ms_times[i]
copy ms_times → ms_prev_times (for "faster than previous" comparison)
reset ms_times = []×15, ms_accum = 0, ms_cur = 0
```

**Exposed in `_collect_entries()`:**
Add `"ms_times"`, `"ms_best"`, `"ms_prev"` arrays to each entry dict.  
Add `"session_ms_best"` once (from sim or snapshot).

### HUD side (`main.gd`)

Per row, render 15 `ColorRect` 14×10 px with gaps every 5 (group separator 3 px).  
Colour per block `i`:

```
t = ms_times[i]
if t == 0:          → #1e1e28  (no data)
elif t == session_ms_best[i]: → #b15de8  (purple — session best)
elif t == ms_best[i]:         → #ffd700  (yellow — personal best)
elif t < ms_prev[i]:          → #4ade80  (green — faster than last lap)
else:                         → #888888  (grey — normal)
```

---

## Assets

### Directory structure

```
ApexDuo_Prototype/
└── assets/
    ├── tyres/
    │   ├── soft.png       # red,   128×128, tread+letter S
    │   ├── medium.png     # yellow, 128×128, tread+letter M
    │   ├── hard.png       # white,  128×128, tread+letter H
    │   ├── inter.png      # green,  128×128, tread+letter I
    │   └── wet.png        # blue,   128×128, tread+letter W
    ├── teams/
    │   ├── mercedes.png
    │   ├── ferrari.png
    │   ├── mclaren.png
    │   ├── red_bull.png
    │   ├── williams.png
    │   ├── aston_martin.png
    │   ├── alpine.png
    │   ├── racing_bulls.png
    │   ├── haas.png
    │   ├── audi.png
    │   └── cadillac.png
    └── drivers/
        ├── antonelli.png
        ├── russell.png
        ├── verstappen.png
        ├── hadjar.png
        ├── leclerc.png
        ├── hamilton.png
        ├── sainz.png
        ├── albon.png
        ├── alonso.png
        ├── stroll.png
        ├── gasly.png
        ├── colapinto.png
        ├── lawson.png
        ├── lindblad.png
        ├── ocon.png
        ├── bearman.png
        ├── norris.png
        ├── piastri.png
        ├── hulkenberg.png
        ├── bortoleto.png
        ├── perez.png
        └── bottas.png
```

### Download source

CDN: `https://cdn.formula1dashboard.com`  
Requires header: `Referer: https://app.formula1dashboard.com/`

Team logos URL pattern:
```
/cdn-cgi/image/width=80,height=48,fit=contain,format=png,dpr=1/team-logos/{SLUG}-normalized-logo.png
```

Team slug mapping (CDN slug → local filename):
```
2026-mercedes   → mercedes.png
ferrari         → ferrari.png
mclaren         → mclaren.png
rbr             → red_bull.png
2026-williams   → williams.png
aston-martin    → aston_martin.png
alpine          → alpine.png
rb              → racing_bulls.png
haas            → haas.png
audi            → audi.png
cadillac        → cadillac.png
```

Driver portrait URL pattern:
```
/cdn-cgi/image/width=200,height=200,fit=crop,format=png,dpr=1/drivers/2026/portrait/2026-{slug}.png
```

Driver slug = lowercase last name (e.g. `antonelli`, `hamilton`, `verstappen`).

### Godot loading

Add to `F1_2026`:
```gdscript
static func team_logo_path(team_name: String) -> String:
    return "res://assets/teams/" + _TEAM_LOGO_SLUGS[team_name] + ".png"

static func driver_photo_path(driver_name: String) -> String:
    return "res://assets/drivers/" + _DRIVER_PHOTO_SLUGS[driver_name] + ".png"
```

Load at HUD build time (not per-tick):
```gdscript
var tex := load(F1_2026.team_logo_path(team_name)) as Texture2D
logo_rect.texture = tex
```

---

## `f1_2026.gd` changes

Add `"abbrev"` (3-letter, English, uppercase) and update team dict to include `"abbrev"` (4-letter team code):

```gdscript
# Teams — add "abbrev" field:
{"name": "McLaren",          "abbrev": "MCL",  ...}
{"name": "Mercedes",         "abbrev": "MERC", ...}
{"name": "Red Bull Racing",  "abbrev": "RBR",  ...}
{"name": "Ferrari",          "abbrev": "FERR", ...}
{"name": "Williams",         "abbrev": "WIL",  ...}
{"name": "Aston Martin",     "abbrev": "AMR",  ...}
{"name": "Alpine",           "abbrev": "ALP",  ...}
{"name": "Racing Bulls",     "abbrev": "RB",   ...}
{"name": "Haas",             "abbrev": "HAAS", ...}
{"name": "Audi",             "abbrev": "AUDI", ...}
{"name": "Cadillac",         "abbrev": "CAD",  ...}

# Drivers — add "abbrev" field:
{"name": "Антонелли", "abbrev": "ANT", ...}
{"name": "Расселл",   "abbrev": "RUS", ...}
{"name": "Ферстаппен","abbrev": "VER", ...}
{"name": "Аджар",     "abbrev": "HAD", ...}
{"name": "Леклер",    "abbrev": "LEC", ...}
{"name": "Хэмилтон",  "abbrev": "HAM", ...}
{"name": "Сайнс",     "abbrev": "SAI", ...}
{"name": "Албон",     "abbrev": "ALB", ...}
{"name": "Алонсо",    "abbrev": "ALO", ...}
{"name": "Стролл",    "abbrev": "STR", ...}
{"name": "Гасли",     "abbrev": "GAS", ...}
{"name": "Колапинто", "abbrev": "COL", ...}
{"name": "Лоусон",    "abbrev": "LAW", ...}
{"name": "Линдблад",  "abbrev": "LIN", ...}
{"name": "Окон",      "abbrev": "OCO", ...}
{"name": "Бирман",    "abbrev": "BEA", ...}
{"name": "Норрис",    "abbrev": "NOR", ...}
{"name": "Пиастри",   "abbrev": "PIA", ...}
{"name": "Хюлькенберг","abbrev": "HUL",...}
{"name": "Бортолето", "abbrev": "BOR", ...}
{"name": "Перес",     "abbrev": "PER", ...}
{"name": "Боттас",    "abbrev": "BOT", ...}
```

`_collect_entries()` must expose `"abbrev"` and `"team_abbrev"` from the car's driver/team data.

---

## Right Control Panel

Width: 172 px. `VBoxContainer`, background `#0c0c18`, left border `1 px #161622`.

**Per player card** (P5 and P6):
- Header: driver photo `TextureRect` 36×36 px (circle-clip via `StyleBoxFlat` with radius) + name + position delta badge
- Wear bars: шина + батарея (same as current but using the new bar style)
- ERS buttons row: Э1 / Э2 / Э3 / Э4 (current mode highlighted)
- Tempo buttons row: Т1 / Т2 / Т3
- ПИТ button (full width, amber border when recommended)

**Footer:** "ЛУЧШИЙ КРУГ СЕССИИ" label + time in purple `#b15de8` + driver abbrev.

---

## Removed / deferred

| Item | Disposition |
|---|---|
| Track minimap (`track_map.gd`) | Hidden (`visible = false`) — not deleted, re-enable later |
| 3D race view (`race_view_3d`) | Hidden, button removed from HUD |
| Speed column (КМ/Ч) | Removed from leaderboard (data still in sim) |
| Wear % column | Removed — represented by tyre icon colour degradation |
| Pit count column | Replaced by "В ПИТ" badge when active; total pit stops shown as muted `×N` suffix inside the badge cell when car is not in pit (e.g. `×2`) |
| Event feed | Moved: keep as a small scrolling overlay in the bottom-left corner |

---

## Godot Implementation Guidelines

Best practices to follow during implementation (from Godot 4 docs + community research).

### Typography — monospace font required

Timing columns (gap, interval, best_lap, last_lap, sectors) contain numbers that change every tick.
A **proportional font causes digit jitter** — column width shifts as `1` and `8` have different advance widths.

**Font:** JetBrains Mono (Apache 2.0 — free to bundle).  
Place at `assets/fonts/JetBrainsMono-Regular.ttf`.  
Load once at HUD build time: `label.add_theme_font_override("font", mono_font)`.

### Drawing architecture — one `_draw()` Control per row

330 `ColorRect` nodes (22 rows × 15 sector blocks) is the naive approach; it floods the scene tree and
triggers a layout pass over hundreds of nodes every tick.

**Pattern:** give each leaderboard row its own `Control` and batch all graphical primitives in a single
`_draw()` call per row:
- the 3 px team colour stripe (`draw_rect`)
- the 15 mini-sector blocks with group gaps (`draw_rect` × 15 — one pass)
- the tyre ring (`TextureRect` for the PNG icon — Godot batches texture draws cheaply)

This mirrors the existing `track_map.gd` pattern (`TrackMap._draw()`).  
Call `queue_redraw()` on the row Control once per sim tick — **never inside `_draw()` itself** (infinite loop).

### Asset loading — cache textures at build time

```gdscript
var _team_tex: Dictionary = {}   # team_name → Texture2D
var _tyre_tex: Dictionary = {}   # compound  → Texture2D

func _preload_assets() -> void:
    for team in F1_2026.TEAMS:
        var path := F1_2026.team_logo_path(team.name)
        if ResourceLoader.exists(path):
            _team_tex[team.name] = load(path)
    for c in ["soft", "medium", "hard", "inter", "wet"]:
        var path := "res://assets/tyres/%s.png" % c
        if ResourceLoader.exists(path):
            _tyre_tex[c] = load(path)
```

Godot generates `.import` sidecar files the first time the editor opens after new PNGs are added.
**Commit the `.png` files; the editor regenerates `.import` on first open.**
Do NOT commit hand-added `.import` files — they contain machine-local paths.

### Theme — extend `theme.gd`, not inline StyleBoxFlat per widget

Scatter `StyleBoxFlat` allocations in `main.gd` per-tick = hundreds of redundant object creations.
Instead, add dark-panel, row-highlight, and pill-button styles to the existing project theme (`theme.gd`)
and reference them via `add_theme_stylebox_override()` at **build time only** — one shared instance per style.

### HUD refresh cadence

`_process` runs at 60 fps; the sim ticks at 4 Hz. **Only call `_update_hud()` when a sim tick is consumed.**

Guard every Label assignment to skip Godot's text layout pass when the value hasn't changed:
```gdscript
if lbl.text != new_val:
    lbl.text = new_val
```

### Anti-patterns to avoid

| Anti-pattern | Problem | Fix |
|---|---|---|
| `queue_redraw()` inside `_draw()` | Infinite redraw loop | Call from `_update_hud()` only |
| `ScrollContainer` for 22 rows | Extra layout pass every frame | Fixed `VBoxContainer` + `clip_contents = true` on parent |
| Rebuilding row nodes every tick | Destroys/re-creates hundreds of Controls | Build once in `_build_leaderboard()`, update values in `_update_hud()` |
| `load()` inside `_update_hud()` | Disk read per tick → stutter | Pre-load into `_team_tex` / `_tyre_tex` at build time |
| `add_theme_*_override()` per tick | Allocates objects; triggers layout invalidation | Set overrides once at build time |

---

## Implementation order

1. Download assets (bash script, no Godot changes)
2. Add `abbrev` fields to `f1_2026.gd`
3. Add mini-sector tracking to `race_sim.gd` (sim-only, no UI yet)
4. Verify mini-sector output with `execute_gdscript` headless run
5. Rebuild `_build_leaderboard()` and `_update_hud()` in `main.gd`
6. Rebuild `_build_race_ui()` top bar + layout (remove map, resize panels)
7. Rebuild right control panel with photos + new button layout
8. Lint new code (fresh-file trick)
9. Headless verification: race outputs correct mini-sector colours

---

## Open questions

- **Player team logo / abbrev:** the player team is named dynamically at season setup. Need a fallback logo (generic star icon) and a user-defined 3-letter abbrev. For now: display `★` + first 3 letters of team name.
- **Quali / SC states:** "В ПИТ" badge reuses the same slot during qual. Confirm no visual conflict.
- **Netcode snapshot:** mini-sector arrays must be included in the host→client snapshot. Max overhead per tick: 22 cars × 15 floats × 4 bytes ≈ 1.3 kB — acceptable at 12 Hz.
