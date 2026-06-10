# Apex Duo — Design System

**Date:** 2026-06-11  
**Status:** Approved  
**Scope:** All screens — Main Menu, Season Setup, Paddock Hub, Race HUD

---

## Goal

A unified visual language for every screen in Apex Duo, inspired by
formula1dashboard.com but with game character. The system is implemented as
a single `design_system.gd` file containing static factory functions that
every screen calls to build its nodes — one change in the factory updates
all screens automatically.

---

## Tone

Dashboard-inspired, not a pure utility. Dark base + readable data density
from the reference site; team colours, gold accents and light motion to make
it feel like a game, not an analytics tool. No decorative chrome — every
visual element communicates information.

---

## Colour Tokens

All tokens are `const` in `design_system.gd`.

### Backgrounds

| Token | Hex | Usage |
|---|---|---|
| `BG_PRIMARY` | `#0e0e1a` | Screen backgrounds |
| `BG_CARD` | `#0c0c18` | Cards, panels, sidebar |
| `BG_RAISED` | `#12121f` | Buttons, hovered rows, inputs |
| `BORDER` | `#1e1e2e` | All dividers and outlines |

### Accents

| Token | Hex | Usage |
|---|---|---|
| `GOLD` | `#f5c518` | Primary actions, player car highlight |
| `PURPLE` | `#b15de8` | Session fastest lap |
| `GREEN` | `#4ade80` | Faster sector, positive delta, profit |
| `RED` | `#e8002d` | DNF, danger, soft tyre |
| `BLUE` | `#3b82f6` | Pit stop active, info badges |
| `AMBER` | `#f59e0b` | Safety car, warnings |

### Text

| Token | Hex | Usage |
|---|---|---|
| `TEXT_1` | `#ffffff` | Primary content |
| `TEXT_2` | `#cccccc` | Secondary content |
| `TEXT_3` | `#666666` | Muted / disabled |

### Team colours

Team colours (McLaren `#ff8000`, Mercedes `#27f4d2`, Ferrari `#e8002d`, etc.)
are **not tokens** — they come from `F1_2026.TEAMS[i].color`. They are used
**only** for: team identity stripe (3 px vertical bar), team logo tint,
driver abbreviation label. Never used for buttons, backgrounds, or navigation.

---

## Typography

Inter is the system sans-serif. JetBrains Mono (Apache 2.0, bundled at
`assets/fonts/JetBrainsMono-Regular.ttf`) is used exclusively for numeric
content — timing, gaps, positions, counts.

| Role | Font | Size | Weight | Usage |
|---|---|---|---|---|
| Display | Inter | 22 px | Bold 700 | Screen titles, event headlines |
| Heading | Inter | 16 px | SemiBold 600 | Section headers, card titles |
| Body | Inter | 13 px | Regular 400 | Descriptions, notes |
| Label | Inter | 10 px | Medium 500, uppercase, +1 px tracking | Column headers, metadata keys |
| Mono | JetBrains Mono | 13 px | Regular 400 | All numbers: times, gaps, positions, lap counts |

Godot rule: assign `add_theme_font_override("font", DS.MONO_FONT)` to every
Label that shows numeric data. Never mix proportional digits into timing columns.

---

## Spacing Scale

| Token | Value | Typical usage |
|---|---|---|
| `SP_XS` | 4 px | Icon gap, tight inline padding |
| `SP_SM` | 8 px | Between items in a row |
| `SP_MD` | 12 px | Card inner padding |
| `SP_LG` | 16 px | Between cards, section gaps |
| `SP_XL` | 24 px | Screen-level vertical rhythm |
| `SP_XXL` | 32 px | Hero spacing (menu title area) |

---

## Component Library

Eight static factory functions in `design_system.gd`. Each returns a fully
configured `Control` subtree ready to `add_child()`. Build-time only — never
call factories inside `_process` or `_update_hud`.

### `make_button(text: String, style: String) → Control`

`style` ∈ `"primary"` · `"secondary"` · `"danger"`

- **primary** — `BG_RAISED` + `GOLD` border 1 px + `GOLD` label; hover: `GOLD` bg at 12 % alpha
- **secondary** — transparent + `BORDER` border + `TEXT_2` label
- **danger** — transparent + `RED` border 1 px + `RED` label

Height 34 px, border-radius 4 px, Label font Inter SemiBold 11 px uppercase.

### `make_badge(text: String, color: Color) → Control`

Pill shape, border-radius 20 px, height 20 px, horizontal padding 10 px.  
Background: `color` at 12 % alpha. Border: `color` at 50 % alpha. Label: `color`, Inter 10 px.

Standard colours: `GREEN` (LIVE), `AMBER` (SC), `BLUE` (В ПИТ), `RED` (СХОД), `PURPLE` (ЛУЧШИЙ КРУГ).

### `make_card(title: String, content: Control) → Control`

`BG_CARD` panel, `BORDER` outline, border-radius 6 px.  
If `title != ""`: header row (border-bottom `BORDER`, 34 px, Heading font) above `content`.  
No title → just the content with `SP_MD` padding.

### `make_stat_label(key: String, value: String, value_color: Color) → Control`

Vertical stack: Label key (`TEXT_3`, Label role, uppercase) above Label value (Mono 15 px, `value_color`).  
`BG_RAISED` background, border-radius 4 px, padding `SP_SM` all sides, text centred.

### `make_progress_bar(value: float, max_val: float, color: Color) → Control`

`HBoxContainer`: key Label (Label role) left, percentage Label (Mono 9 px) right, bar row below.  
Bar track: `BORDER` fill, height 5 px, border-radius 3 px.  
Bar fill: `color`, width = `value / max_val * track_width`.  
Caller updates fill width per tick via `bar.custom_minimum_size.x`.

### `make_data_row(cols: Array[Dictionary]) → Control`

`HBoxContainer`, height 28 px, background `BG_RAISED`, border-radius 3 px.  
Each `col` dict: `{ "text": String, "width": int, "color": Color, "mono": bool }`.  
Creates one Label per column; mono columns get `MONO_FONT` override.  
Caller holds references and updates `.text` per tick.

### `make_team_stripe(color: Color) → Control`

`ColorRect`, width 3 px, full-height, `color`. Placed as first child of a data row or card.

### `make_section_header(title: String) → Control`

`HBoxContainer`: Label (`TEXT_3`, Label role, uppercase) + `HSeparator` (expanding).  
Margin-bottom `SP_SM`.

---

## Motion

Minimal — information clarity takes priority over decoration.

| Event | Animation | Duration |
|---|---|---|
| Screen transition (push) | Opacity fade 0→1 | 200 ms |
| New badge appear (SC, pit) | Scale 0.8→1.0 + fade | 150 ms |
| Fastest lap flash | `PURPLE` bg pulse on row | 300 ms, once |
| Data updates (numbers) | Instant — no tween | — |

Never animate leaderboard row reordering mid-lap; positions snap at lap completion only.

---

## Screen Patterns

### Main Menu

Full-screen `BG_PRIMARY`. Centred `VBoxContainer` max-width 400 px:
- Game wordmark: `APEX DUO` Label role uppercase + Display title `ФОРМУЛА 1` + `GOLD` season label
- 4 stacked `make_button()`: НОВЫЙ СЕЗОН (primary), СОВМЕСТНАЯ ИГРА (primary), ПРОДОЛЖИТЬ (secondary), НАСТРОЙКИ (secondary)
- Bottom bar `TEXT_3` version string

### Season Setup

Full-screen `BG_PRIMARY`. Top: step indicator (step label + progress dots).  
**Step 1 — Team grid:** 3-column grid of `make_card()` tiles, one per team.
Each tile: logo `TextureRect` + team abbrev + tier badge. Selected tile gets
`GOLD` border + gold dot indicator. ДАЛЕЕ → button enabled once selection made.  
**Step 2 — Difficulty:** 3 `make_card()` options stacked, similar pattern.

### Paddock Hub

`HSplitContainer`. Left sidebar 140 px `BG_CARD`:
- Team identity block: `make_team_stripe()` + logo + team name + standing stat
- Nav items: Label rows, active item has `GOLD` right-border + `GOLD` text + `BG_RAISED` tint

Right content area `BG_PRIMARY`, switches per nav tab:
- **Следующая гонка** — 3 `make_stat_label()` (track / character / weather) + `make_card()` driver prep + СТАРТОВАТЬ button
- **R&D** — 3 branch cards with `make_progress_bar()` each + invest button
- **Пилоты** — 2 driver cards: photo + `make_stat_label()` grid (pace, morale, dev) + `make_progress_bar()` morale
- **Финансы** — `make_stat_label()` grid (budget / income / spend) + spend breakdown card
- **Персонал** — staff list using `make_data_row()` + hire button

### Race HUD

See `docs/superpowers/specs/2026-06-11-race-hud-f1-dashboard-redesign.md`.  
Uses `make_data_row()` + `make_team_stripe()` + `make_badge()` + `make_progress_bar()`.

---

## `design_system.gd` Skeleton

```gdscript
class_name DesignSystem

# — Colour tokens —
const BG_PRIMARY := Color("#0e0e1a")
const BG_CARD    := Color("#0c0c18")
const BG_RAISED  := Color("#12121f")
const BORDER     := Color("#1e1e2e")
const GOLD       := Color("#f5c518")
const PURPLE     := Color("#b15de8")
const GREEN      := Color("#4ade80")
const RED        := Color("#e8002d")
const BLUE       := Color("#3b82f6")
const AMBER      := Color("#f59e0b")
const TEXT_1     := Color("#ffffff")
const TEXT_2     := Color("#cccccc")
const TEXT_3     := Color("#666666")

# — Spacing —
const SP_XS  := 4;  const SP_SM  := 8;  const SP_MD  := 12
const SP_LG  := 16; const SP_XL  := 24; const SP_XXL := 32

# — Fonts (loaded once) —
static var MONO_FONT: Font  # JetBrains Mono — numbers, timing
# UI font comes from project theme (no explicit load needed)

static func setup_fonts() -> void:
    MONO_FONT = load("res://assets/fonts/JetBrainsMono-Regular.ttf")

# — Factory functions —
static func make_button(text: String, style: String) -> Control: ...
static func make_badge(text: String, color: Color) -> Control: ...
static func make_card(title: String, content: Control) -> Control: ...
static func make_stat_label(key: String, value: String, value_color: Color) -> Control: ...
static func make_progress_bar(value: float, max_val: float, color: Color) -> Control: ...
static func make_data_row(cols: Array) -> Control: ...
static func make_team_stripe(color: Color) -> Control: ...
static func make_section_header(title: String) -> Control: ...
```

`DesignSystem.setup_fonts()` is called once from `main.gd` `_ready()` before any screen builds.

---

## Relationship to Race HUD Spec

The race HUD spec defines *what data to show and in what columns*.  
This design system spec defines *how every visual element looks*.  
When implementing the HUD, both specs apply simultaneously.

---

## Open Questions

- **Inter font bundling:** Godot uses a built-in sans-serif by default. If the default
  font is visually close enough, skip bundling. If not, add Inter TTF (OFL licence — free).
  Decision at implementation time: compare screenshots, bundle only if noticeable difference.
- **Player team colour in menus:** When the player picks a team, does the sidebar stripe
  and setup highlight use that team's colour (dynamic) or always GOLD? Recommendation: use
  the team colour wherever there's an explicit team identity element; GOLD for all action
  buttons regardless of team.
