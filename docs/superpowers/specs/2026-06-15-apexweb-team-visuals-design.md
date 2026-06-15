# ApexWeb Team Visuals — colours, driver photos, car renders, logos, tyre icons (Design)

**Date:** 2026-06-15
**Status:** approved (design), pending spec review
**Topic:** make the UI beautiful — team colours everywhere, real driver photos + car renders (user-provided),
team logos + tyre icons wherever apt. Inspired by formula1dashboard's team/driver cards.

## Goal

A shared **team-visual layer** (`ui/teamviz.js`) + the assets the user dropped into `assets/`, applied
across every screen so the game reads in team colours with driver photos, car renders, logos and tyre
icons. No sim changes — the full **311-test suite stays green**.

**Constraints:** pure UI/CSS; **deterministic sim untouched** (`sim.js`/`data.js`/etc. — read-only);
user-facing strings **Russian**; build UI in code; commit with **explicit pathspecs only** (the owner keeps
parallel career-mode WIP in `main.js`/`ui/season.js`); **do not push**. The image files were downloaded and
placed by the **user** — we organise + consume local files they provided (we do not fetch anything remote).

## Current state / assets the user added

`assets/` had `teams/*.png` (11 logos) + `tyres/*.png` (5). The user dropped, **loose in `assets/`**:
- **22 driver photos** `2026-<lastname>.png` (~0.5 MB each), one per grid driver. (A duplicate
  `2026-leclerc (1).png` exists — ignore it.)
- **11 car renders** `<team>-<model>-2026-f1-car-formula-1-dashboard.png` (~70–130 KB), one per team.
- **alt "normalized" team logos** `<team>-normalized-logo.png` — alternatives to the existing
  `assets/teams/`. **Out of scope:** keep the existing `assets/teams/` logos the game already uses; the
  loose normalized logos are left untouched (the user can ask to swap later).

Team colour already lives in data: `TEAMS[i].color` (e.g. McLaren `#ff8000`, Mercedes `#27f4d2`) and
`DRIVER_INFO[abbrev] = {color, team, logo}`. `TEAM_LOGO[name]` maps team → asset slug
(`mclaren`/`audi`/`racing_bulls`/…). The visual layer reuses these.

## Asset organisation (first plan task — `git mv` into folders by our slugs)

**Drivers → `assets/drivers/<ABBREV>.png`** (uppercase abbrev = `DRIVER_INFO` key):

| file | → | file | → | file | → |
|---|---|---|---|---|---|
| 2026-norris | NOR | 2026-piastri | PIA | 2026-antonelli | ANT |
| 2026-russell | RUS | 2026-verstappen | VER | 2026-hadjar | HAD |
| 2026-leclerc | LEC | 2026-hamilton | HAM | 2026-sainz | SAI |
| 2026-albon | ALB | 2026-alonso | ALO | 2026-stroll | STR |
| 2026-gasly | GAS | 2026-colapinto | COL | 2026-lawson | LAW |
| 2026-lindblad | LIN | 2026-ocon | OCO | 2026-bearman | BEA |
| 2026-hulkenberg | HUL | 2026-bortoleto | BOR | 2026-perez | PER |
| 2026-bottas | BOT | | | | |

**Cars → `assets/cars/<slug>.png`** (slug = `TEAM_LOGO` value):

| file | → slug (team) |
|---|---|
| mclaren-mcl40-… | `mclaren` (McLaren) |
| mercedes-w17-… | `mercedes` (Mercedes) |
| redbull-racing-rb22-… | `red_bull` (Red Bull) |
| ferrari-sf26-… | `ferrari` (Ferrari) |
| williams-fw48-… | `williams` (Williams) |
| aston-martin-amr26-… | `aston_martin` (Aston Martin) |
| alpine-a526-… | `alpine` (Alpine) |
| racing-bulls-vcarb03-… | `racing_bulls` (RB) |
| haas-vf26-… | `haas` (Haas) |
| audi-r26-… | `audi` (Sauber) |
| cadillac-mac-26-… | `cadillac` (Cadillac) |

Use `git mv "assets/2026-norris.png" "assets/drivers/NOR.png"` etc. (the source names have no spaces except
the ignored leclerc duplicate). The renamed files are tracked; commit them as the org task.

## Component: `ui/teamviz.js` (new — shared visual helpers)

Imports `TEAMS`, `DRIVER_INFO`, `TEAM_LOGO` from `../data.js` (read-only). API:

```js
// pure
export function teamColor(team) { … }          // team name → hex (from TEAMS[].color); "#888" fallback
export function teamInk(hex) { … }              // hex → readable text colour on it: dark "#0a0a0c" if the
                                                // colour is light (luminance > 0.55), else "#fff". (testable)
export const DRIVER_NUM = { NOR:1, PIA:81, ANT:12, RUS:63, VER:3, HAD:6, LEC:16, HAM:44, SAI:55, ALB:23,
  ALO:14, STR:18, GAS:10, COL:43, LAW:30, LIN:41, OCO:31, BEA:87, HUL:27, BOR:5, PER:11, BOT:77 };
  // ↑ confirmed real 2026 grid numbers (verified online): Norris #1 (reigning champion), Verstappen #3
  // (switched from 33), Lindblad #41 (rookie), Hadjar #6, Bortoleto #5.
export function teamLogoSrc(team) { return `assets/teams/${TEAM_LOGO[team]}.png`; }
export function carImgSrc(team)   { return `assets/cars/${TEAM_LOGO[team]}.png`; }
export function tyreIcon(compound, size) { … }  // <img assets/tyres/…> (existing pattern, centralised)

// HTML builders (DOM/visual — preview/F5 verified)
export function driverAvatar(abbrev, team, size) { … }   // photo with colour-block fallback (below)
export function driverCard(d, opts) { … }                 // avatar + name + team + logo + rank/pts + car
```

**`teamInk` (testable):** parse hex → relative luminance `0.299r+0.587g+0.114b` (0..1); return the dark ink
when luminance > ~0.55 (bright team colours like McLaren orange / Mercedes teal get dark text), else `#fff`.

**`driverAvatar` fallback mechanism:** a fixed-size container whose **base layer is the colour block**
(team colour bg + `teamInk` number from `DRIVER_NUM[abbrev]`, or the abbrev if no number), with the photo as
an `<img src="assets/drivers/<ABBREV>.png">` layered on top; `onerror="this.style.display='none'"` reveals
the block when the file is missing. So real photos show when present, the team-coloured number block
otherwise — no extra JS, no per-driver checks.

**Numbers:** all 22 are the **confirmed real 2026 grid numbers** (verified online via the official 2026
number announcement) — no guesses. Notably Norris runs **#1** as reigning champion and Verstappen **#3**.

> `carSilhouette(team)` (the original SVG car) is **dropped** — the real renders supersede it. `carImgSrc`
> can `onerror`-hide if a render is missing (degrades to no car image, not a broken icon).

## Per-screen application (each an isolated task)

- **Paddock — `ui/season.js`** (surgical, owner WIP): the **Зачёт** tab rows + **Пилоты** tab become
  team-coloured (left accent in `teamColor`, logo, photo avatar, number) — driver/standings cards like the
  reference dashboard. The player-team driver cards get the **car render**.
- **Race — `ui/race.js`**: the leaderboard rows gain a team-colour left accent + tint and the (existing)
  logo + tyre icon, routed through `teamviz`. (The minimap car dots already use `c.color`.)
- **Lobby — `ui/lobby.js`**: the team picker shows the selected team's **car render** + colour + logo
  (a proper "pick your team" card instead of just a `<select>` + small logo).
- **Quali / Practice — `ui/quali.js` / `ui/practice.js`**: team-colour accents on the rows/cards that show
  drivers (tower rows, the per-player car cards), via `teamviz` — lighter touch.

## Data flow

`teamviz` reads `TEAMS`/`DRIVER_INFO`/`TEAM_LOGO` (already imported across the UI) + the new image files by
slug/abbrev. **No sim or network data**; no snapshot changes. Screens import the helpers and call them where
they already render driver/team rows.

## Testing

- **Unit (`tests/teamviz.test.js`, new):** `teamColor` (known team → its hex; unknown → fallback);
  `teamInk` (light colour → dark ink, dark colour → `#fff`); `DRIVER_NUM` has all 22 grid abbrevs;
  `carImgSrc`/`teamLogoSrc` build the expected `assets/cars/<slug>.png` / `assets/teams/<slug>.png` paths.
  Pure, fast.
- **Asset presence (`tests/teamviz.test.js`):** assert every grid abbrev has a `assets/drivers/<ABBREV>.png`
  and every team a `assets/cars/<slug>.png` on disk (`node:fs existsSync`) — catches a rename/typo so a card
  never points at a missing file.
- **Boot/syntax:** `node --check` the touched UI modules; module-load the screens.
- **Full suite unchanged:** `node --test` stays **311** + the new teamviz tests (~3) → ~314; sim untouched.
- **Preview + F5 (owner):** the cards/photos/renders are visual — verify the paddock cards in the preview
  where reachable; the live screens + photo loading are F5-gated, same as all prior ApexWeb UI.

## Out of scope (YAGNI)

- Swapping the existing `assets/teams/` logos for the loose "normalized" ones (kept as-is; offer later).
- The original SVG car silhouette (real renders replace it).
- Animating/3D the car renders (they're flat images on cards).
- Networking any of this (pure client-side rendering of shared data).

## Risks / notes

- **Surgical edits to `ui/season.js`** (owner career WIP) — change only the row/card markup of the Зачёт +
  Пилоты tabs, keep every panel-builder + handler; `git add` only that file.
- **Missing-asset safety:** every photo/car/logo `<img>` uses `onerror` so a missing/mis-named file degrades
  to the colour block (driver) or nothing (car/logo), never a broken-image icon. The `existsSync` test
  guards the rename so this shouldn't trigger in practice.
- **Asset size:** ~11 MB of photos + ~1 MB renders — fine for a local static page; `<img>` loads lazily.
