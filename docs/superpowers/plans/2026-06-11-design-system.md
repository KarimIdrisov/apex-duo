# Apex Duo Design System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `design_system.gd` with 8 factory-function components and rebuild the start menu, season setup, and paddock hub screens to use it, replacing the old `Palette`-based ad-hoc styling.

**Architecture:** A single `DesignSystem` class (`design_system.gd`) exposes colour/spacing constants, `setup_fonts()` (called once from `main.gd _ready()`), and 8 static factory functions that return fully-styled `Control` subtrees. Every screen calls these factories at build time and caches the resulting node references for per-tick updates. The race HUD is out of scope here — it has its own spec.

**Tech Stack:** Godot 4.6 · GDScript · `theme.gd` (Palette) stays for backward-compat during migration; will be removed once all screens are updated.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| **Create** | `ApexDuo_Prototype/design_system.gd` | All DS tokens, fonts, 8 factory functions |
| **Modify** | `ApexDuo_Prototype/main.gd` | Call `setup_fonts()` in `_ready()`; rebuild `_build_menu()` |
| **Modify** | `ApexDuo_Prototype/season_setup.gd` | Rebuild `_rebuild()` with DS |
| **Modify** | `ApexDuo_Prototype/season_hub.gd` | Rebuild `_rebuild()` header, sidebar, tabs |

---

## Lint / Verify workflow (read before all tasks)

**Lint new GDScript:** extract the new functions to `ApexDuo_Prototype/ds_check.gd`,
run `gdparse ds_check.gd && gdlint ds_check.gd`, then delete the file.

**Boot test (after modifying main.gd / season files):**
```powershell
& "C:\Users\Karim\Desktop\Godot_v4.6.3-stable_win64.exe\Godot_v4.6.3-stable_win64.exe" `
  --headless --path "C:\Users\Karim\Desktop\Coop motorsport manager game\ApexDuo_Prototype" `
  --quit-after 30 2>&1 | Select-String -Pattern "ERROR|SCRIPT ERROR|Failed"
```
Pass = no matches. Any `ERROR` line is a blocker.

---

## Task 1 — design_system.gd skeleton: tokens + fonts + `_sb` helper

**Files:**
- Create: `ApexDuo_Prototype/design_system.gd`

- [ ] **Step 1: Create the file with colour tokens, spacing constants, font vars and helpers**

```gdscript
# design_system.gd
class_name DesignSystem

# ── Colour tokens ────────────────────────────────────────────────────────────
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

# ── Spacing ──────────────────────────────────────────────────────────────────
const SP_XS  := 4;  const SP_SM  := 8;  const SP_MD  := 12
const SP_LG  := 16; const SP_XL  := 24; const SP_XXL := 32

# ── Fonts (load once via setup_fonts()) ──────────────────────────────────────
static var MONO_FONT: Font = null

static func setup_fonts() -> void:
    MONO_FONT = load("res://assets/fonts/JetBrainsMono-Regular.ttf")

# ── Internal helper ───────────────────────────────────────────────────────────
static func _sb(bg: Color, border: Color, radius: int = 4) -> StyleBoxFlat:
    var sb := StyleBoxFlat.new()
    sb.bg_color = bg
    sb.border_color = border
    sb.set_border_width_all(1)
    sb.set_corner_radius_all(radius)
    return sb
```

- [ ] **Step 2: Lint — extract to fresh file and parse**

Copy the above into `ApexDuo_Prototype/ds_check.gd` (class name `DSCheck` to avoid collision), run:
```bash
gdparse ApexDuo_Prototype/ds_check.gd && gdlint ApexDuo_Prototype/ds_check.gd
```
Expected: no errors. Delete `ds_check.gd`.

- [ ] **Step 3: Commit**

```bash
git add ApexDuo_Prototype/design_system.gd
git commit -m "feat(ds): design_system.gd skeleton — tokens, spacing, fonts, _sb helper"
```

---

## Task 2 — `make_team_stripe`, `make_section_header`, `make_badge`

**Files:**
- Modify: `ApexDuo_Prototype/design_system.gd`

- [ ] **Step 1: Append the three factory functions to `design_system.gd`**

```gdscript
# ── make_team_stripe ─────────────────────────────────────────────────────────
static func make_team_stripe(color: Color) -> ColorRect:
    var cr := ColorRect.new()
    cr.color = color
    cr.custom_minimum_size = Vector2(3.0, 0.0)
    cr.size_flags_vertical = Control.SIZE_EXPAND_FILL
    return cr

# ── make_section_header ──────────────────────────────────────────────────────
static func make_section_header(title: String) -> HBoxContainer:
    var row := HBoxContainer.new()
    row.add_theme_constant_override("separation", SP_SM)
    var lbl := Label.new()
    lbl.text = title
    lbl.add_theme_color_override("font_color", TEXT_3)
    lbl.add_theme_font_size_override("font_size", 10)
    row.add_child(lbl)
    var sep := HSeparator.new()
    sep.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    sep.add_theme_color_override("color", BORDER)
    row.add_child(sep)
    return row

# ── make_badge ───────────────────────────────────────────────────────────────
static func make_badge(text: String, color: Color) -> PanelContainer:
    var panel := PanelContainer.new()
    var sb := StyleBoxFlat.new()
    sb.bg_color = Color(color.r, color.g, color.b, 0.12)
    sb.border_color = Color(color.r, color.g, color.b, 0.50)
    sb.set_border_width_all(1)
    sb.set_corner_radius_all(10)
    sb.content_margin_left  = 10.0
    sb.content_margin_right = 10.0
    sb.content_margin_top   = 3.0
    sb.content_margin_bottom = 3.0
    panel.add_theme_stylebox_override("panel", sb)
    var lbl := Label.new()
    lbl.text = text
    lbl.add_theme_color_override("font_color", color)
    lbl.add_theme_font_size_override("font_size", 10)
    panel.add_child(lbl)
    return panel
```

- [ ] **Step 2: Lint — fresh file with just these three functions**

Copy these three functions into `ApexDuo_Prototype/ds_check.gd` (with an `extends Control` header — no class_name — and dummy colour consts at top so it parses standalone). Run:
```bash
gdparse ApexDuo_Prototype/ds_check.gd
```
Expected: OK. Delete `ds_check.gd`.

- [ ] **Step 3: Commit**

```bash
git add ApexDuo_Prototype/design_system.gd
git commit -m "feat(ds): make_team_stripe, make_section_header, make_badge"
```

---

## Task 3 — `make_button`

**Files:**
- Modify: `ApexDuo_Prototype/design_system.gd`

- [ ] **Step 1: Append `make_button` to `design_system.gd`**

```gdscript
# ── make_button ──────────────────────────────────────────────────────────────
# Returns a Button node with custom StyleBoxes for normal/hover/pressed.
# style: "primary" (gold) | "secondary" (outline) | "danger" (red)
static func make_button(text: String, style: String = "primary") -> Button:
    var btn := Button.new()
    btn.text = text
    btn.custom_minimum_size = Vector2(0.0, 34.0)
    btn.add_theme_font_size_override("font_size", 11)

    var lbl_color: Color
    var sb_n: StyleBoxFlat
    var sb_h: StyleBoxFlat
    var sb_p: StyleBoxFlat

    match style:
        "primary":
            lbl_color = GOLD
            sb_n = _sb(Color(GOLD.r,  GOLD.r,  GOLD.b,  0.10), Color(GOLD.r,  GOLD.g,  GOLD.b,  0.70))
            sb_h = _sb(Color(GOLD.r,  GOLD.g,  GOLD.b,  0.20), Color(GOLD.r,  GOLD.g,  GOLD.b,  0.90))
            sb_p = _sb(Color(GOLD.r,  GOLD.g,  GOLD.b,  0.06), Color(GOLD.r,  GOLD.g,  GOLD.b,  0.50))
        "danger":
            lbl_color = RED
            sb_n = _sb(Color(RED.r, RED.g, RED.b, 0.10), Color(RED.r, RED.g, RED.b, 0.60))
            sb_h = _sb(Color(RED.r, RED.g, RED.b, 0.20), Color(RED.r, RED.g, RED.b, 0.80))
            sb_p = _sb(Color(RED.r, RED.g, RED.b, 0.06), Color(RED.r, RED.g, RED.b, 0.40))
        _:  # secondary
            lbl_color = TEXT_2
            sb_n = _sb(Color(0.0, 0.0, 0.0, 0.00), BORDER)
            sb_h = _sb(Color(1.0, 1.0, 1.0, 0.05), BORDER)
            sb_p = _sb(Color(0.0, 0.0, 0.0, 0.00), BORDER)

    btn.add_theme_stylebox_override("normal",  sb_n)
    btn.add_theme_stylebox_override("hover",   sb_h)
    btn.add_theme_stylebox_override("pressed", sb_p)
    btn.add_theme_color_override("font_color",         lbl_color)
    btn.add_theme_color_override("font_hover_color",   lbl_color)
    btn.add_theme_color_override("font_pressed_color", lbl_color)
    btn.add_theme_color_override("font_focus_color",   lbl_color)
    return btn
```

> **Bug to watch:** `_sb(Color(GOLD.r, GOLD.r, GOLD.b, 0.10), ...)` — the second channel should be `GOLD.g`, not `GOLD.r`. Double-check all three `.r/.g/.b` channel references.

- [ ] **Step 2: Fix the typo noted above in the primary branch first line:**

In `design_system.gd`, confirm the primary `sb_n` line reads:
```gdscript
sb_n = _sb(Color(GOLD.r, GOLD.g, GOLD.b, 0.10), Color(GOLD.r, GOLD.g, GOLD.b, 0.70))
```
(both `Color(...)` calls use `GOLD.r, GOLD.g, GOLD.b` — not `.r, .r, .b`.)

- [ ] **Step 3: Lint**

```bash
gdparse ApexDuo_Prototype/design_system.gd
```
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add ApexDuo_Prototype/design_system.gd
git commit -m "feat(ds): make_button (primary/secondary/danger)"
```

---

## Task 4 — `make_progress_bar` and `make_stat_label`

**Files:**
- Modify: `ApexDuo_Prototype/design_system.gd`

- [ ] **Step 1: Append both functions**

```gdscript
# ── make_progress_bar ────────────────────────────────────────────────────────
# Returns a VBox: key row (label + pct) + ProgressBar (height 5 px).
# Caller updates pb.value per tick — get it via returned dict "pb" key.
static func make_progress_bar(label_text: String, value: float, max_val: float, color: Color) -> Dictionary:
    var col := VBoxContainer.new()
    col.add_theme_constant_override("separation", 3)

    var row := HBoxContainer.new()
    col.add_child(row)

    var key_lbl := Label.new()
    key_lbl.text = label_text
    key_lbl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    key_lbl.add_theme_color_override("font_color", TEXT_3)
    key_lbl.add_theme_font_size_override("font_size", 9)
    row.add_child(key_lbl)

    var safe_max: float = max_val if max_val > 0.0 else 1.0
    var pct: int = int(value / safe_max * 100.0)
    var val_lbl := Label.new()
    val_lbl.text = "%d%%" % pct
    val_lbl.add_theme_color_override("font_color", TEXT_3)
    val_lbl.add_theme_font_size_override("font_size", 9)
    if MONO_FONT != null:
        val_lbl.add_theme_font_override("font", MONO_FONT)
    row.add_child(val_lbl)

    var pb := ProgressBar.new()
    pb.custom_minimum_size = Vector2(0.0, 5.0)
    pb.max_value = safe_max
    pb.value = value
    pb.show_percentage = false
    var fill_sb := StyleBoxFlat.new()
    fill_sb.bg_color = color
    fill_sb.set_corner_radius_all(3)
    var bg_sb := StyleBoxFlat.new()
    bg_sb.bg_color = BORDER
    bg_sb.set_corner_radius_all(3)
    pb.add_theme_stylebox_override("fill", fill_sb)
    pb.add_theme_stylebox_override("background", bg_sb)
    col.add_child(pb)

    return {"node": col, "pb": pb, "val_lbl": val_lbl}

# ── make_stat_label ──────────────────────────────────────────────────────────
# Returns a PanelContainer: small key label above large mono value.
static func make_stat_label(key: String, value: String, value_color: Color = TEXT_1) -> PanelContainer:
    var panel := PanelContainer.new()
    var sb := StyleBoxFlat.new()
    sb.bg_color = BG_RAISED
    sb.set_corner_radius_all(4)
    sb.content_margin_left   = float(SP_SM)
    sb.content_margin_right  = float(SP_SM)
    sb.content_margin_top    = float(SP_SM)
    sb.content_margin_bottom = float(SP_SM)
    panel.add_theme_stylebox_override("panel", sb)

    var col := VBoxContainer.new()
    col.add_theme_constant_override("separation", 4)
    panel.add_child(col)

    var key_lbl := Label.new()
    key_lbl.text = key
    key_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    key_lbl.add_theme_color_override("font_color", TEXT_3)
    key_lbl.add_theme_font_size_override("font_size", 9)
    col.add_child(key_lbl)

    var val_lbl := Label.new()
    val_lbl.text = value
    val_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    val_lbl.add_theme_color_override("font_color", value_color)
    val_lbl.add_theme_font_size_override("font_size", 15)
    if MONO_FONT != null:
        val_lbl.add_theme_font_override("font", MONO_FONT)
    col.add_child(val_lbl)

    return panel
```

- [ ] **Step 2: Lint**

```bash
gdparse ApexDuo_Prototype/design_system.gd
```
Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add ApexDuo_Prototype/design_system.gd
git commit -m "feat(ds): make_progress_bar, make_stat_label"
```

---

## Task 5 — `make_card` and `make_data_row`

**Files:**
- Modify: `ApexDuo_Prototype/design_system.gd`

- [ ] **Step 1: Append both functions**

```gdscript
# ── make_card ────────────────────────────────────────────────────────────────
# Dark panel with optional titled header row.
# Returns PanelContainer; content is placed inside a MarginContainer (SP_MD).
static func make_card(title: String, content: Control) -> PanelContainer:
    var panel := PanelContainer.new()
    var sb := StyleBoxFlat.new()
    sb.bg_color = BG_CARD
    sb.border_color = BORDER
    sb.set_border_width_all(1)
    sb.set_corner_radius_all(6)
    panel.add_theme_stylebox_override("panel", sb)

    var col := VBoxContainer.new()
    col.add_theme_constant_override("separation", 0)
    panel.add_child(col)

    if title != "":
        var header := PanelContainer.new()
        var hdr_sb := StyleBoxFlat.new()
        hdr_sb.bg_color = Color(0.0, 0.0, 0.0, 0.0)
        hdr_sb.border_color = BORDER
        hdr_sb.border_width_bottom = 1
        hdr_sb.content_margin_left   = float(SP_MD)
        hdr_sb.content_margin_right  = float(SP_MD)
        hdr_sb.content_margin_top    = float(SP_SM)
        hdr_sb.content_margin_bottom = float(SP_SM)
        header.custom_minimum_size = Vector2(0.0, 34.0)
        header.add_theme_stylebox_override("panel", hdr_sb)
        var hdr_lbl := Label.new()
        hdr_lbl.text = title
        hdr_lbl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
        hdr_lbl.add_theme_color_override("font_color", TEXT_2)
        hdr_lbl.add_theme_font_size_override("font_size", 12)
        header.add_child(hdr_lbl)
        col.add_child(header)

    var wrap := MarginContainer.new()
    for side: String in ["left", "right", "top", "bottom"]:
        wrap.add_theme_constant_override("margin_" + side, SP_MD)
    wrap.add_child(content)
    col.add_child(wrap)

    return panel

# ── make_data_row ─────────────────────────────────────────────────────────────
# Horizontal row (height 28 px) for leaderboard / stat rows.
# cols: Array of { "text": String, "width": int, "color": Color, "mono": bool }
# Returns { "node": PanelContainer, "cells": Array } — caller updates cells[i].text per tick.
static func make_data_row(cols: Array) -> Dictionary:
    var panel := PanelContainer.new()
    panel.custom_minimum_size = Vector2(0.0, 28.0)
    var sb := StyleBoxFlat.new()
    sb.bg_color = BG_RAISED
    sb.set_corner_radius_all(3)
    sb.content_margin_top    = 0.0
    sb.content_margin_bottom = 0.0
    sb.content_margin_left   = 0.0
    sb.content_margin_right  = 0.0
    panel.add_theme_stylebox_override("panel", sb)

    var row := HBoxContainer.new()
    row.add_theme_constant_override("separation", 0)
    panel.add_child(row)

    var cells: Array = []
    for col_data: Dictionary in cols:
        var lbl := Label.new()
        lbl.text = col_data.get("text", "")
        var w: int = col_data.get("width", 0)
        if w > 0:
            lbl.custom_minimum_size = Vector2(float(w), 0.0)
        var col_color: Color = col_data.get("color", TEXT_1)
        lbl.add_theme_color_override("font_color", col_color)
        lbl.add_theme_font_size_override("font_size", 11)
        lbl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
        var is_mono: bool = col_data.get("mono", false)
        if is_mono and MONO_FONT != null:
            lbl.add_theme_font_override("font", MONO_FONT)
        row.add_child(lbl)
        cells.append(lbl)

    return {"node": panel, "cells": cells}
```

- [ ] **Step 2: Lint**

```bash
gdparse ApexDuo_Prototype/design_system.gd
```
Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add ApexDuo_Prototype/design_system.gd
git commit -m "feat(ds): make_card, make_data_row — full component library complete"
```

---

## Task 6 — Wire `setup_fonts()` into `main.gd` and rebuild start menu

**Files:**
- Modify: `ApexDuo_Prototype/main.gd` (lines ~1184–1262)

- [ ] **Step 1: Call `DesignSystem.setup_fonts()` in `main.gd _ready()`**

Find the opening of `_ready()` in `main.gd` (around line 100). Add this as the **first line** of `_ready()`:

```gdscript
func _ready() -> void:
    DesignSystem.setup_fonts()
    # ... existing code continues unchanged below
```

- [ ] **Step 2: Replace `_build_menu()` with the DS version**

Replace the entire `_build_menu()` function (lines 1184–1246) and `_menu_button()` helper (lines 1248–1254):

```gdscript
func _build_menu() -> void:
    menu_overlay = ColorRect.new()
    (menu_overlay as ColorRect).color = DesignSystem.BG_PRIMARY
    menu_overlay.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
    add_child(menu_overlay)

    var centerc := CenterContainer.new()
    centerc.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
    menu_overlay.add_child(centerc)

    var center := VBoxContainer.new()
    center.add_theme_constant_override("separation", DesignSystem.SP_SM)
    center.alignment = BoxContainer.ALIGNMENT_CENTER
    centerc.add_child(center)

    var wordmark := Label.new()
    wordmark.text = "APEX DUO"
    wordmark.add_theme_color_override("font_color", DesignSystem.TEXT_3)
    wordmark.add_theme_font_size_override("font_size", 10)
    wordmark.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    center.add_child(wordmark)

    var title := Label.new()
    title.text = "ФОРМУЛА 1"
    title.add_theme_font_size_override("font_size", 36)
    title.add_theme_color_override("font_color", DesignSystem.TEXT_1)
    title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    center.add_child(title)

    var season_lbl := Label.new()
    season_lbl.text = "Сезон 2026"
    season_lbl.add_theme_font_size_override("font_size", 13)
    season_lbl.add_theme_color_override("font_color", DesignSystem.GOLD)
    season_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    center.add_child(season_lbl)

    center.add_child(_spacer_v(DesignSystem.SP_XL))

    var btn_wrap := VBoxContainer.new()
    btn_wrap.add_theme_constant_override("separation", DesignSystem.SP_SM)
    btn_wrap.custom_minimum_size = Vector2(340.0, 0.0)
    center.add_child(btn_wrap)

    if Season.has_save():
        var b_cont: Button = DesignSystem.make_button("▶ ПРОДОЛЖИТЬ СЕЗОН", "primary")
        b_cont.pressed.connect(func(): _continue_season())
        btn_wrap.add_child(b_cont)

    var b_solo: Button = DesignSystem.make_button("Быстрая гонка — соло", "secondary")
    b_solo.pressed.connect(func(): _start("solo"))
    btn_wrap.add_child(b_solo)

    var b_local: Button = DesignSystem.make_button("Быстрая гонка — локальный кооп", "secondary")
    b_local.pressed.connect(func(): _start("local"))
    btn_wrap.add_child(b_local)

    btn_wrap.add_child(_spacer_v(DesignSystem.SP_XS))

    var b_season: Button = DesignSystem.make_button("СЕЗОН — новый чемпионат", "primary")
    b_season.pressed.connect(func(): _begin_season_setup())
    btn_wrap.add_child(b_season)

    btn_wrap.add_child(_spacer_v(DesignSystem.SP_XS))

    var b_host: Button = DesignSystem.make_button("Сезон-онлайн (хост)", "secondary")
    b_host.pressed.connect(func(): _begin_online_season_host())
    btn_wrap.add_child(b_host)

    var b_net: Button = DesignSystem.make_button("Создать игру по сети (хост)", "secondary")
    b_net.pressed.connect(func(): _start("host"))
    btn_wrap.add_child(b_net)

    var join_row := HBoxContainer.new()
    join_row.add_theme_constant_override("separation", DesignSystem.SP_SM)
    join_row.alignment = BoxContainer.ALIGNMENT_CENTER
    ip_input = LineEdit.new()
    ip_input.text = "127.0.0.1"
    ip_input.custom_minimum_size = Vector2(180.0, 38.0)
    join_row.add_child(ip_input)
    var b_join: Button = DesignSystem.make_button("Подключиться", "secondary")
    b_join.pressed.connect(func(): _join_online(ip_input.text))
    join_row.add_child(b_join)
    btn_wrap.add_child(join_row)

    var note := Label.new()
    note.text = "Онлайн (бета): нужны 2 копии игры. Debug → Run Multiple Instances → 2."
    note.add_theme_font_size_override("font_size", 11)
    note.add_theme_color_override("font_color", DesignSystem.TEXT_3)
    note.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    center.add_child(note)
```

Delete the old `_menu_button()` helper (it is no longer used — `make_button()` replaces it).

- [ ] **Step 3: Boot test**

```powershell
& "C:\Users\Karim\Desktop\Godot_v4.6.3-stable_win64.exe\Godot_v4.6.3-stable_win64.exe" `
  --headless --path "C:\Users\Karim\Desktop\Coop motorsport manager game\ApexDuo_Prototype" `
  --quit-after 30 2>&1 | Select-String -Pattern "ERROR|SCRIPT ERROR"
```
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add ApexDuo_Prototype/main.gd
git commit -m "feat(ui): rebuild start menu with DesignSystem"
```

---

## Task 7 — Rebuild `season_setup.gd`

**Files:**
- Modify: `ApexDuo_Prototype/season_setup.gd`

- [ ] **Step 1: Replace the imports + `_rebuild()` content**

At the top of `season_setup.gd`, the old `Palette` aliases can stay temporarily; the rebuild uses `DesignSystem` instead. Replace the `_rebuild()` function body:

```gdscript
func _rebuild() -> void:
    for c in get_children():
        c.queue_free()

    var bg := ColorRect.new()
    bg.color = DesignSystem.BG_PRIMARY
    bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
    add_child(bg)

    var margin := MarginContainer.new()
    margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
    for side: String in ["left", "right", "top", "bottom"]:
        margin.add_theme_constant_override("margin_" + side, DesignSystem.SP_XL)
    add_child(margin)

    var col := VBoxContainer.new()
    col.add_theme_constant_override("separation", DesignSystem.SP_LG)
    margin.add_child(col)

    # ── Header ──
    var hdr := Label.new()
    hdr.text = "НОВЫЙ СЕЗОН"
    hdr.add_theme_font_size_override("font_size", 22)
    hdr.add_theme_color_override("font_color", DesignSystem.TEXT_1)
    col.add_child(hdr)

    # ── Step indicator ──
    col.add_child(DesignSystem.make_section_header("ШАГ 1 — ВЫБЕРИТЕ КОМАНДУ"))

    # ── Team grid ──
    var grid := GridContainer.new()
    grid.columns = 4
    grid.add_theme_constant_override("h_separation", DesignSystem.SP_SM)
    grid.add_theme_constant_override("v_separation", DesignSystem.SP_SM)
    col.add_child(grid)

    var teams: Array = F1_2026.TEAMS
    for i: int in range(teams.size()):
        var team: Dictionary = teams[i]
        var tile := _make_team_tile(i, team)
        grid.add_child(tile)

    col.add_child(DesignSystem.make_section_header("СЛОЖНОСТЬ"))

    # ── Difficulty row ──
    var diff_row := HBoxContainer.new()
    diff_row.add_theme_constant_override("separation", DesignSystem.SP_SM)
    col.add_child(diff_row)
    var diff_labels: Array = ["Лёгкая", "Средняя", "Сложная"]
    for d: int in range(diff_labels.size()):
        var db: Button = DesignSystem.make_button(diff_labels[d], "primary" if d == sel_diff else "secondary")
        db.size_flags_horizontal = Control.SIZE_EXPAND_FILL
        var d_cap := d
        db.pressed.connect(func():
            sel_diff = d_cap
            _rebuild()
        )
        diff_row.add_child(db)

    # ── Footer ──
    var footer := HBoxContainer.new()
    footer.alignment = BoxContainer.ALIGNMENT_END
    col.add_child(footer)
    var next_btn: Button = DesignSystem.make_button("ДАЛЕЕ →", "primary")
    next_btn.custom_minimum_size = Vector2(160.0, 40.0)
    next_btn.pressed.connect(_on_next)
    footer.add_child(next_btn)


func _make_team_tile(idx: int, team: Dictionary) -> PanelContainer:
    var selected: bool = idx == sel_team
    var t_color: Color = Color(team.get("color", "#888888"))

    var panel := PanelContainer.new()
    var sb := StyleBoxFlat.new()
    sb.bg_color = Color(t_color.r, t_color.g, t_color.b, 0.08) if selected else DesignSystem.BG_CARD
    sb.border_color = Color(t_color.r, t_color.g, t_color.b, 0.6) if selected else DesignSystem.BORDER
    sb.set_border_width_all(1 if selected else 1)
    sb.set_corner_radius_all(5)
    sb.content_margin_top    = float(DesignSystem.SP_SM)
    sb.content_margin_bottom = float(DesignSystem.SP_SM)
    sb.content_margin_left   = float(DesignSystem.SP_SM)
    sb.content_margin_right  = float(DesignSystem.SP_SM)
    panel.add_theme_stylebox_override("panel", sb)
    panel.custom_minimum_size = Vector2(0.0, 72.0)

    var col := VBoxContainer.new()
    col.add_theme_constant_override("separation", DesignSystem.SP_XS)
    panel.add_child(col)

    var logo_rect := TextureRect.new()
    logo_rect.custom_minimum_size = Vector2(0.0, 28.0)
    logo_rect.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
    logo_rect.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    var logo_path: String = "res://assets/teams/" + _team_logo_slug(team.get("name", "")) + ".png"
    if ResourceLoader.exists(logo_path):
        logo_rect.texture = load(logo_path)
    col.add_child(logo_rect)

    var abbrev_lbl := Label.new()
    abbrev_lbl.text = team.get("abbrev", "???")
    abbrev_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    abbrev_lbl.add_theme_color_override("font_color", t_color if selected else DesignSystem.TEXT_3)
    abbrev_lbl.add_theme_font_size_override("font_size", 10)
    col.add_child(abbrev_lbl)

    if selected:
        var dot := Panel.new()
        dot.custom_minimum_size = Vector2(6.0, 6.0)
        var dot_sb := StyleBoxFlat.new()
        dot_sb.bg_color = DesignSystem.GOLD
        dot_sb.set_corner_radius_all(3)
        dot.add_theme_stylebox_override("panel", dot_sb)
        col.add_child(dot)

    var i_cap := idx
    panel.gui_input.connect(func(event: InputEvent):
        if event is InputEventMouseButton and (event as InputEventMouseButton).pressed:
            sel_team = i_cap
            _rebuild()
    )
    return panel


# Maps team name to logo filename slug (matches assets/teams/)
func _team_logo_slug(name: String) -> String:
    match name:
        "McLaren":          return "mclaren"
        "Mercedes":         return "mercedes"
        "Red Bull Racing":  return "red_bull"
        "Ferrari":          return "ferrari"
        "Williams":         return "williams"
        "Aston Martin":     return "aston_martin"
        "Alpine":           return "alpine"
        "Racing Bulls":     return "racing_bulls"
        "Haas":             return "haas"
        "Audi":             return "audi"
        "Cadillac":         return "cadillac"
        _:                  return "mclaren"
```

`_on_next()` already exists in `season_setup.gd` — do not remove it.

- [ ] **Step 2: Boot test**

```powershell
& "C:\Users\Karim\Desktop\Godot_v4.6.3-stable_win64.exe\Godot_v4.6.3-stable_win64.exe" `
  --headless --path "C:\Users\Karim\Desktop\Coop motorsport manager game\ApexDuo_Prototype" `
  --quit-after 30 2>&1 | Select-String -Pattern "ERROR|SCRIPT ERROR"
```

- [ ] **Step 3: Commit**

```bash
git add ApexDuo_Prototype/season_setup.gd
git commit -m "feat(ui): rebuild season setup screen with DesignSystem"
```

---

## Task 8 — Rebuild `season_hub.gd`

**Files:**
- Modify: `ApexDuo_Prototype/season_hub.gd`

- [ ] **Step 1: Replace `_rebuild()` with the DS layout**

The hub uses the existing `_active_tab` var and TAB_NAMES. Replace `_rebuild()` body:

```gdscript
func _rebuild() -> void:
    # Free all dynamic children except the vignette layer (first child added in _ready).
    for i: int in range(get_child_count() - 1, -1, -1):
        var ch: Node = get_child(i)
        if ch.name != "VignetteLayer":
            ch.queue_free()

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
    sb.content_margin_top = 0.0; sb.content_margin_bottom = 0.0
    sb.content_margin_left = 0.0; sb.content_margin_right = 0.0
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

    var team_color: Color = Color(s.team.get("color", "#888888"))
    var stripe := DesignSystem.make_team_stripe(team_color)
    id_row.add_child(stripe)

    var id_col := VBoxContainer.new()
    id_col.add_theme_constant_override("separation", 2)
    id_row.add_child(id_col)
    var name_lbl := Label.new()
    name_lbl.text = s.team.get("name", "")
    name_lbl.add_theme_color_override("font_color", team_color)
    name_lbl.add_theme_font_size_override("font_size", 11)
    id_col.add_child(name_lbl)
    var standing_lbl := Label.new()
    var pts: int = s.constructor_points.get(s.team.get("name", ""), 0)
    standing_lbl.text = "P%d · %d очков" % [_team_position(s), pts]
    standing_lbl.add_theme_color_override("font_color", DesignSystem.TEXT_3)
    standing_lbl.add_theme_font_size_override("font_size", 9)
    id_col.add_child(standing_lbl)

    # Divider
    var div := HSeparator.new()
    div.add_theme_color_override("color", DesignSystem.BORDER)
    col.add_child(div)

    # Nav tabs
    for i: int in range(TAB_NAMES.size()):
        var nav_item := _make_nav_item(i, TAB_NAMES[i])
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
    var pts: int = s.constructor_points.get(s.team.get("name", ""), 0)
    var pos: int = 1
    for team_name: String in s.constructor_points:
        var other: int = s.constructor_points[team_name]
        if other > pts:
            pos += 1
    return pos


func _build_tab_content(tab: int) -> Control:
    var margin := MarginContainer.new()
    for side: String in ["left", "right", "top", "bottom"]:
        margin.add_theme_constant_override("margin_" + side, DesignSystem.SP_LG)

    var col := VBoxContainer.new()
    col.add_theme_constant_override("separation", DesignSystem.SP_LG)
    margin.add_child(col)

    match tab:
        TAB_OVERVIEW: _build_tab_overview(col)
        TAB_CAR:      _build_tab_car(col)
        TAB_SPONSORS: _build_tab_sponsors(col)
        TAB_STAFF:    _build_tab_staff(col)
        TAB_PILOTS:   _build_tab_pilots(col)
    return margin
```

- [ ] **Step 2: Before coding tabs — verify Season field names**

Open `ApexDuo_Prototype/season.gd` and confirm:
- Budget field: `s.money` (not `s.budget`)
- Constructor standings: `s.constructor_points` (dict `team_name → int`)
- R&D levels: `s.part_levels` (see `compose_part_deltas`) — NOTE: the hub's existing code may use different names; check before using `rd_levels`/`rd_progress` below
- Current round: `s.round` (int)
- Calendar entry: `s.calendar[s.round]` (dict with `"name"` key for track)
- Handler methods already in hub: `_on_start_race` / `_on_rd_invest` — verify they exist; if not, add stubs

Adjust the code below to match actual field names before committing.

- [ ] **Step 3: Add `_build_tab_overview()` (Следующая гонка)**

```gdscript
func _build_tab_overview(col: VBoxContainer) -> void:
    var s := Season.active
    col.add_child(DesignSystem.make_section_header("СЛЕДУЮЩАЯ ГОНКА"))

    var track_name: String = "—"
    if s.round < s.calendar.size():
        track_name = s.calendar[s.round].get("name", "—")

    # Stat row: track / character / weather
    var stats_row := HBoxContainer.new()
    stats_row.add_theme_constant_override("separation", DesignSystem.SP_SM)
    stats_row.add_child(DesignSystem.make_stat_label("ТРАССА",    track_name,                      DesignSystem.TEXT_1))
    stats_row.add_child(DesignSystem.make_stat_label("ОЧКИ",       str(s.constructor_points.get(s.team.get("name",""),0)), DesignSystem.GOLD))
    stats_row.add_child(DesignSystem.make_stat_label("БЮДЖЕТ",    "$%dM" % int(s.money / 1_000_000.0), DesignSystem.GREEN))
    for child in stats_row.get_children():
        (child as Control).size_flags_horizontal = Control.SIZE_EXPAND_FILL
    col.add_child(stats_row)

    col.add_child(DesignSystem.make_section_header("ГОНКА"))
    var btn_race: Button = DesignSystem.make_button("▶ К ГОНКЕ", "primary")
    btn_race.custom_minimum_size = Vector2(0.0, 44.0)
    btn_race.pressed.connect(_on_start_race)
    col.add_child(btn_race)
```

- [ ] **Step 3: Add `_build_tab_car()` (R&D)**

```gdscript
func _build_tab_car(col: VBoxContainer) -> void:
    var s := Season.active
    col.add_child(DesignSystem.make_section_header("РАЗВИТИЕ БОЛИДА"))

    var branch_names: Array = ["АЭРОДИНАМИКА", "ШИНЫ", "ДВИГАТЕЛЬ"]
    var branch_keys: Array  = ["aero", "tyres", "powertrain"]

    for bi: int in range(branch_names.size()):
        var key: String = branch_keys[bi]
        var level: int  = s.rd_levels.get(key, 0)
        var progress: float = s.rd_progress.get(key, 0.0)

        var inner_col := VBoxContainer.new()
        inner_col.add_theme_constant_override("separation", DesignSystem.SP_SM)
        var pb_dict: Dictionary = DesignSystem.make_progress_bar(
            "Ур. %d → %d" % [level, level + 1], progress, 1.0, DesignSystem.GOLD)
        inner_col.add_child(pb_dict["node"])

        var invest_btn: Button = DesignSystem.make_button("ИНВЕСТИРОВАТЬ", "primary")
        invest_btn.size_flags_horizontal = Control.SIZE_EXPAND_FILL
        var k_cap := key
        invest_btn.pressed.connect(func(): _on_rd_invest(k_cap))
        inner_col.add_child(invest_btn)

        col.add_child(DesignSystem.make_card(branch_names[bi] + " (Ур. %d)" % level, inner_col))
```

- [ ] **Step 4: Add stub tabs for Sponsors, Staff, Pilots**

```gdscript
func _build_tab_sponsors(col: VBoxContainer) -> void:
    col.add_child(DesignSystem.make_section_header("СПОНСОРЫ"))
    var lbl := Label.new()
    lbl.text = "Спонсорские контракты — скоро"
    lbl.add_theme_color_override("font_color", DesignSystem.TEXT_3)
    col.add_child(lbl)

func _build_tab_staff(col: VBoxContainer) -> void:
    col.add_child(DesignSystem.make_section_header("ПЕРСОНАЛ"))
    var s := Season.active
    if not s.has_method("staff_list"):
        var lbl := Label.new()
        lbl.text = "Нет данных о персонале"
        lbl.add_theme_color_override("font_color", DesignSystem.TEXT_3)
        col.add_child(lbl)
        return
    for person: Dictionary in s.staff_list():
        var row_dict: Dictionary = DesignSystem.make_data_row([
            {"text": person.get("name","?"), "width": 120, "color": DesignSystem.TEXT_1, "mono": false},
            {"text": person.get("role","?"), "width": 100, "color": DesignSystem.TEXT_3, "mono": false},
            {"text": str(person.get("level",0)), "width": 40,  "color": DesignSystem.GOLD, "mono": true},
        ])
        col.add_child(row_dict["node"])

func _build_tab_pilots(col: VBoxContainer) -> void:
    col.add_child(DesignSystem.make_section_header("ПИЛОТЫ"))
    var s := Season.active
    var drivers: Array = s.team.get("drivers", [])
    for d: Dictionary in drivers:
        var inner := VBoxContainer.new()
        inner.add_theme_constant_override("separation", DesignSystem.SP_SM)
        var stats_row := HBoxContainer.new()
        stats_row.add_theme_constant_override("separation", DesignSystem.SP_SM)
        stats_row.add_child(DesignSystem.make_stat_label("ТЕМП",   str(d.get("pace",0)),   DesignSystem.GOLD))
        stats_row.add_child(DesignSystem.make_stat_label("МОРАЛЬНЫЙ ДУХ", "%d%%" % int(d.get("morale",1.0)*100.0), DesignSystem.GREEN))
        for ch in stats_row.get_children():
            (ch as Control).size_flags_horizontal = Control.SIZE_EXPAND_FILL
        inner.add_child(stats_row)
        var pb_dict: Dictionary = DesignSystem.make_progress_bar("МОРАЛЬНЫЙ ДУХ", d.get("morale",1.0), 1.0, DesignSystem.GREEN)
        inner.add_child(pb_dict["node"])
        col.add_child(DesignSystem.make_card(d.get("name","Пилот"), inner))
```

- [ ] **Step 5: Boot test**

```powershell
& "C:\Users\Karim\Desktop\Godot_v4.6.3-stable_win64.exe\Godot_v4.6.3-stable_win64.exe" `
  --headless --path "C:\Users\Karim\Desktop\Coop motorsport manager game\ApexDuo_Prototype" `
  --quit-after 30 2>&1 | Select-String -Pattern "ERROR|SCRIPT ERROR"
```

- [ ] **Step 6: Commit**

```bash
git add ApexDuo_Prototype/season_hub.gd
git commit -m "feat(ui): rebuild paddock hub with DesignSystem (sidebar + 5 tabs)"
```

---

## Task 9 — Final lint and headless verification

**Files:** read-only

- [ ] **Step 1: Lint all modified files**

```bash
gdparse ApexDuo_Prototype/design_system.gd
gdparse ApexDuo_Prototype/main.gd
gdparse ApexDuo_Prototype/season_setup.gd
gdparse ApexDuo_Prototype/season_hub.gd
```
Expected: all OK.

- [ ] **Step 2: Full headless boot — confirm no errors**

```powershell
& "C:\Users\Karim\Desktop\Godot_v4.6.3-stable_win64.exe\Godot_v4.6.3-stable_win64.exe" `
  --headless --path "C:\Users\Karim\Desktop\Coop motorsport manager game\ApexDuo_Prototype" `
  --quit-after 30 2>&1
```
Inspect full output. Pass = no `ERROR` or `SCRIPT ERROR` lines.

- [ ] **Step 3: Visual check note**

The headless test confirms scripts load. Visual correctness (colours, layout, fonts) requires pressing **F5** in the Godot editor. Tell the owner:
> "Boot test passes. Please open the project in Godot and press F5 to verify: start menu (dark BG + gold buttons), season setup (team grid tiles), paddock hub (sidebar + tabs)."

- [ ] **Step 4: Final commit if any last fixes applied**

```bash
git add -p
git commit -m "fix(ds): post-verification fixes"
```

---

## Open items (not in this plan)

- Race HUD rebuild — covered by `docs/superpowers/specs/2026-06-11-race-hud-f1-dashboard-redesign.md`
- `Palette` class (`theme.gd`) deletion — do after race HUD is migrated
- Inter font bundling — check visually at F5 time; if default font is acceptable, skip
- Online client path for season hub — existing `_on_season_updated()` RPC hook calls `_rebuild()` which works with the new code
