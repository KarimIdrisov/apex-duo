# Race View — Visual Spec v1 (designer)

Implementable spec to make the race view colourful and vivid. Targets
`track_map.gd` (`_draw`, `set_cars`) and the HUD palette consts in `main.gd`;
team colours live in `f1_2026.gd` `TEAMS[].color`. Godot `_draw` primitives only
(lines, polylines, circles, arcs, polygons); must stay legible at ~400×380 px and
performant with 22 cars at 60fps. Colour-blind safe: every key distinction also
has a *shape*, never red/green alone.

## 1. Car markers

Extend the per-car payload `set_cars` receives to:
`{frac, id, team_color, pos (0=leader), slot (0/1 within team), state, team, lead}`,
`state ∈ {run, attack, clip, pit, out}`.

- **Base marker:** `draw_circle(p, R, team_color)` + 1.5px dark outline ring
  `draw_arc(p, R, 0, TAU, 24, #14161a, 1.5)` so same-colour cars don't merge into
  the track. `R = 5.0` rivals, `6.5` player cars.
- **Teammate distinction (shape):** slot 0 = solid disc; slot 1 = disc with a
  `#14161a` inner hole (`draw_circle(p, R*0.45, #14161a)`) → a ring. Two Ferraris
  read as "filled red" vs "red donut".
- **Player cars:** team colour + permanent halo `draw_arc(p, R+3, 0, TAU, 28,
  #ffffff, 2.0)` then accent `draw_arc(p, R+5, …, #ffd166|#66c2ff, 1.5)`. Larger R.
- **Leader:** white crown ring `draw_arc(p, R+4, 0, TAU, 28, #ffffff, 3.0)` + a
  `#ffd166` pip dot above.
- **Z order:** rivals → player → leader (last on top); within a group by `pos`.
- **State cues:** `attack` = hot trail + faint orange aura `#ff7a1a`; `clip` =
  desaturate team colour 45% toward `#3a4049`, drop trail, cyan-grey under-arc;
  `pit` = hollow ring only; `out` = dim `#5a606b` disc + small ✕, never on top.

## 2. Track styling

- Tarmac base `#23272e` w15; surface `#3d444e` w9; **racing line** inset polyline
  `#5a6470` w2.
- **Kerbs:** every ~7th segment alternate `#d23b3b`/`#e8e8e8` 3px stubs offset
  outside the edge (iterate `loop` step 3, parity toggles colour).
- **Start/finish:** 2-row checker (alt `#e8e8e8`/`#1b1d22` 3×4 quads across the
  normal at `pts[0]`).
- **Direction arrow:** small filled triangle (7px) along `dir` at ~12% lap.
- **Sector tint (faint):** S1 `#3d444e` / S2 `#3f4651` / S3 `#414853`.
- **Grip feel:** high-grip → surface `#444b56` + crisp kerbs; street → `#363c45`,
  sparser kerbs. Drive off a `grip` field.

## 3. Motion / feel

- **Trail:** retain last 4 positions per car (ring buffer keyed by `id`). Draw
  oldest→newest fading discs: alpha `0.12·i`, radius `R·(0.4+0.15·i)`, team colour
  (orange-blended for `attack`). ~88 circles for 22 cars — cheap.
- **Speed read:** trail length encodes it (5 samples full-pace, 1 on `clip`).
- **Safety car:** translucent yellow band under the field (surface pass `#caa23a`
  alpha 0.18 w13) + a blinking `SC` chip top-left.

## 4. HUD palette (vivid-but-dark)

| Role | New |
|---|---|
| bg | **#101216** |
| panel | **#1b2027** |
| row | **#232a33** |
| accent | **#ff2e43** |
| text | **#e6ebf2** |
| muted | **#7e8a9c** |
| good / warn / bad | **#41e07a / #ffc23d / #ff4d4d** |
| tyre S/M/H | **#ff3b3b / #ffcf33 / #f0f0f0** (+1px outline) |

- **Leaderboard rows:** 4px team-colour bar on the left edge (the only saturated
  element per row → no clutter). Player rows get a 1px gold/blue top+bottom hairline.
- **Battery bar:** ramps `>60% #41e07a`, `25–60% #ffc23d`, `<25% #ff4d4d`;
  **clipping** flashes `#4a6b78` + a small lightning glyph (not colour-only).

## 5. Legend / readability

- **Mini legend** bottom-left of the map: gold haloed disc "Вы P5", blue haloed
  ring "Вы P6", white-crown "лидер". Teaches the halo+shape language once.
- No per-car labels on the map (unreadable at 22 cars) — the leaderboard's team
  bars pair map↔list for full name↔colour mapping.

## Programmer notes

- Thread `team_color`, `pos`, `slot`, `state`, `safety_car`, frame `t` from
  `main.gd` into `set_cars` (today it passes only `{frac,color,lead,team}`).
- Trails need a per-`id` ring buffer in the widget (the array is replaced each
  frame).
- Mind the CLAUDE.md type gotcha: `draw_*` take `Color`; keep hex-string vs Color
  palette helpers separate.
- Budget: ~88 trail circles + 22 markers + kerb/checker stubs ≈ <300 primitives/
  frame — safe at 60fps.
