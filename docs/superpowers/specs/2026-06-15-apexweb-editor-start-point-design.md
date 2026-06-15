# ApexWeb Editor — Move Start/Finish + Reverse Direction — Design

**Date:** 2026-06-15
**Status:** Approved (brainstorm), pending build.
**Topic:** Let the owner set where the start/finish line sits on a track, and flip the lap direction, in the editor.

---

## Goal

Imported/preset circuits put the start/finish (`lapFrac 0`) at an arbitrary control point, and the lap can run the wrong way. The owner wants to (a) **move the start/finish** to the right place and (b) **reverse the direction**.

## Key fact / framing

The start/finish line is drawn at `pointAt(cl, 0)` (`track_paint.js:30`) — i.e. the **first control point** of the loop. The lap boundary, the sim grid, the mini-sectors, and the pit lane (which lives at `frac 0`) are all relative to point[0]. So:

- **Move start** = rotate the `points` array so a chosen point becomes index 0.
- **Reverse direction** = reverse the loop while keeping the same start point.

Both are **render/data-only** (reorder the points). **`sim` / `data` / `track_store` are untouched** → balance/determinism safe. No new data field — the points *order* already encodes both start (point[0]) and direction (winding); backward-compatible (existing tracks keep their current start).

## Pure core — `src/track_edit.js` (no imports, unit-tested)

- `rotateToStart(pts, idx) -> pts'` — return the points rotated so `pts[idx]` is first: `[...pts.slice(idx), ...pts.slice(0, idx)]`. `idx<=0` (or out of range) → a copy unchanged.
- `reverseDirection(pts) -> pts'` — reverse the lap but keep the start point: `[pts[0], ...pts.slice(1).reverse()]`. (So `[p0,p1,p2,p3] → [p0,p3,p2,p1]` — traversal flips, start stays at p0.)

`pts` here are the editor's control points (`[[x,y], …]`).

## Editor wiring (`editor.html` + `src/ui/editor.js`)

- A 4th mode button **«Старт»** (alongside Точки/Пит/Зоны), with a `#startctl` row: a hint «клик по трассе — сюда старт/финиш» + a **«↺ Развернуть»** button.
- In **Старт** mode, a left-click on the canvas finds the **nearest control point** to the click and `pts = rotateToStart(pts, idx)` → `base = null; render()`. The S/F stripe (drawn by paintTrack at frac 0) moves there immediately.
- **«↺ Развернуть»** → `pts = reverseDirection(pts)` → `base = null; render()`.
- Persist: `pts` are already saved in every record (save / 🏁 / export) — no change needed. `base = null` re-fits after the reorder.

## Caveat (documented, not blocking)

Overtake **zones** and **corner-class overrides** are indexed by mini-sector **from the start**, so moving the start shifts them relative to the track — set the start *before* zones, or re-run **🎯 Авто** afterward. The **pit lane** re-anchors to the new start/finish automatically (it's defined at `frac 0`), which is correct.

## Error handling

- `< 3` points: Старт-click and Развернуть no-op (need a loop). Guard like the other mode handlers.
- The handlers operate on the in-memory `pts`; a fresh fit (`base = null`) avoids stale zoom/pan.

## Testing

- `tests/track_edit.test.js`: `rotateToStart` (rotates so idx is first; idx 0 → unchanged; preserves all points/length); `reverseDirection` (start kept at [0], remainder reversed, length preserved, double-reverse is identity).
- `node --check src/ui/editor.js`.
- Full `node --test` green (pure module + the editor has no unit test; nothing else changes).
- **Owner / preview verify:** Старт mode → click → the S/F stripe jumps to the click; Развернуть flips the lap; Save persists.

## Scope / YAGNI

- **In:** the two pure helpers, the «Старт» mode + «↺ Развернуть» button, click-to-set-start, persist, README line.
- **Out:** start at an arbitrary point *between* control points (snaps to nearest — add a point there first if needed); auto-shifting zones to follow the start (re-run Авто instead).
