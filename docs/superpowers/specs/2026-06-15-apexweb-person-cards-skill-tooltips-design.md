# ApexWeb Person Cards + Skill Tooltips (Design)

**Date:** 2026-06-15
**Status:** approved (design), pending spec review
**Topic:** fix the ugly paddock driver cards (the «Продлить» button stretched full-width and collided
with the car render) and add a hover tooltip showing a person's skills — for **pilots and personnel** —
everywhere in the paddock. Follow-up polish to the team-visuals layer.

## Goal

A compact, good-looking driver card (small inline action, car render as a faint backdrop) plus a shared
**skill tooltip**: hovering any pilot or staff member in the paddock pops a floating mini-card with their
skills (driver = the 13 FM attributes as team-coloured bars; staff = the role rating + what it affects).

**Constraints:** pure UI/JS/CSS; **deterministic sim + `data.js` untouched**; user-facing strings
**Russian**; build UI in code; commit with **explicit pathspecs only** (the owner is actively committing
**D4 market** work and editing `season.js`/`market.js`/`development.js`/`market.test.js` in parallel);
**do not push**. Desktop hover (the game is two friends on laptops); no touch/mobile fallback needed.

## Data facts (verified — why this needs no owner-WIP plumbing)

- **Driver skills are derivable in the UI.** `team.js` exports a pure, deterministic
  `driverAttrs(abbrev, overall)` → the 13 attributes
  `ATTR_KEYS = [pace, quali, tyre, overtaking, defending, consistency, composure, aggression, discipline,
  wet, starts, race_iq, smoothness]` (signature traits + per-attr jitter seeded by abbrev). The UI computes
  skills from `(abbrev, overall)` — it never needs them threaded through the snapshot.
- **`overall` is available everywhere a person is shown.** `careerView` IS the full career object
  (`m.career`), so `careerView.drivers[abbrev] = {overall, age, teamIdx, morale, …}` exists for **all 22
  drivers** (`initDrivers()` covers every `TEAMS[].drivers[]`). Paddock rows that lack `overall` inline
  (the Зачёт standings rows carry only `{abbrev, team, pts}`) resolve it from `careerView.drivers[abbrev]`
  at render time. Academy juniors carry their own `overall`/`age`/`name` on the junior object.
- **Staff = 3 roles.** `staff.js`: `STAFF_ROLES = ["designer", "strategist", "pitCrew"]`,
  `ROLE_LABEL = {designer:"Гл. конструктор", strategist:"Стратег", pitCrew:"Пит-крю"}`; `careerView.staff[role]`
  is a 0..1 rating (the Команда tab already shows it). Facilities (design/pit/factory) are buildings, not
  people → no tooltip.
- **The card bug:** `style.css` `.ready { … width:100% }` — the global green primary button. The
  «Продлить» button used `class="ready resign"`, so it stretched full-width and swallowed the card. Fix:
  drop `.ready`; use a compact inline-styled button that keeps `class="…resign"` for the existing handler.

## Component A — driver card redesign (`ui/teamviz.js` `driverCard`)

Rework `driverCard(d, opts)` layout so it reads like the mockup:
- One flex row: **avatar (48px)** · **info (flex:1)** · **compact action button** — with the **car render
  as a faint backdrop** (`position:absolute; right; opacity ~0.10; pointer-events:none`) behind the text,
  so it never collides with controls.
- Info: line 1 = `<b>name</b>` + team chip; line 2 = the compact stat line (`sub`).
- The action button is whatever the caller passes (`opts.action`); the **caller** (season.js) supplies a
  compact button (`class="resign"` + small inline style), NOT the full-width `.ready`.
- `driverCard` also stamps the **driver tip-attrs** (below) on the card root when `d.overall` is provided,
  so the whole card is a hover target.

`d` grows to `{ team, abbrev, name, overall, age }` (overall/age optional — when present, the card becomes a
skill-tooltip trigger). `opts` unchanged (`{car, sub, action}`).

## Component B — skill tooltip API (`ui/teamviz.js`, additive)

All pure/string builders are exported (testable); `attachPersonTips` is the only DOM piece.

```js
// RU labels for the 13 driver attributes (keyed by ATTR_KEYS from team.js)
export const ATTR_RU = { pace:"Темп", quali:"Квала", tyre:"Резина", overtaking:"Обгон",
  defending:"Защита", consistency:"Стабильность", composure:"Хладнокровие", aggression:"Агрессия",
  discipline:"Дисциплина", wet:"Дождь", starts:"Старт", race_iq:"Гонч. IQ", smoothness:"Плавность" };

// what each staff role affects (one line each)
export const STAFF_TIP = { designer:"Разработка машины: скорость R&D и прирост деталей.",
  strategist:"Питы, реакция на сейфти-кар и дождь, выбор стратегии гонки.",
  pitCrew:"Скорость пит-стопа — меньше потерь времени в боксах." };

// data-attr strings spliced into any hover target (self-contained — the handler reads only these)
export function personTipAttrs({abbrev, overall, team, name, age}) { … }  // data-driver/-ovr/-team/-name/-age
export function staffTipAttrs({role, val, team}) { … }                    // data-staff/-val/-team

// pure HTML builders (return a string; team-coloured, dark game theme inline)
export function driverSkillTip(abbrev, overall, team, name, age) { … }    // header + 13 bars, top-3 starred
export function staffSkillTip(role, val, team) { … }                      // role + rating + bar + effect

// DOM: one delegated handler + a singleton floating element (F5-verified)
export function attachPersonTips(root) { … }
```

- **`driverSkillTip`**: header = `driverAvatar(abbrev, team, 42)` + name + `${team} · ${age} лет` +
  big `OVR` (round `overall*100`). Body = the 13 `driverAttrs(abbrev, overall)` values as compact
  two-column mini-bars (`ATTR_RU` label + track + team-colour fill at value% + the rounded value); the
  **top-3** values get a `ti-star` and full-opacity fill, the rest 0.78 opacity.
- **`staffSkillTip`**: header = role icon + `ROLE_LABEL[role]` + `персонал` + big rating (round `val*100`);
  one team-colour bar + the `STAFF_TIP[role]` effect line.
- **`attachPersonTips(root)`**: creates a body-level singleton `<div>` ONCE (id `apex-person-tip`,
  `position:fixed; z-index:9999; pointer-events:none; max-width:320px`, dark panel inline style, hidden by
  default). Adds delegated `mouseover`/`mouseout` listeners on `root`: on a target matching
  `[data-driver]` or `[data-staff]`, fill the singleton via the right builder (reading the data-attrs) and
  position it next to the target's `getBoundingClientRect()` (prefer below; flip above if it would clip the
  viewport bottom; clamp horizontally). On `mouseout` of the target, hide. Idempotent — re-calling
  `attachPersonTips` on a re-rendered `root` re-binds without duplicating the singleton.

`teamColor`/`teamInk`/`driverAvatar`/`DRIVER_NUM` are reused. `driverAttrs`/`ATTR_KEYS` are imported from
`../team.js` (read-only). No sim/data writes.

## Component C — paddock wiring (`ui/season.js`, surgical)

Owner-WIP file — change ONLY the row/card markup of the five person-bearing areas to add tip-attrs, swap
the card button to compact, and call `attachPersonTips(root)` once at the end of `render()`. Keep every
panel-builder and handler intact.

- **Пилоты** (cards): pass `overall`/`age` into `driverCard` (so it becomes a trigger) and supply a
  **compact** `action` button (`class="resign"` + small inline style, not `.ready`).
- **Зачёт** (driver standings rows): wrap the abbrev/avatar cell as a trigger via `personTipAttrs(...)`,
  resolving `overall`/`age`/`name` from `careerView.drivers[r.abbrev]` (+ `DRIVER_NAME`).
- **Команда** (staff rows): each `STAFF_ROLES` row gets `staffTipAttrs({role:rk, val:st[rk], team:myTeamName})`.
- **Трансферы** (available drivers): each row gets `personTipAttrs(...)` from `d.abbrev/d.overall/d.age` +
  `DRIVER_NAME[d.abbrev]`.
- **Академия** (juniors + scout pool): each row gets `personTipAttrs(...)` from `j.abbrev/j.overall/j.age/j.name`.
- End of `render(root, ctx)`: `attachPersonTips(root)`.

No `style.css` edit — the tooltip singleton and the compact button are inline-styled (keeps the change to
two files: `teamviz.js` + `season.js`).

## Data flow

`teamviz` reads `TEAMS`/`DRIVER_INFO`/`TEAM_LOGO` (already) + `driverAttrs`/`ATTR_KEYS` from `team.js`. The
tooltip handler is **self-contained**: it reads the person's data only from the hover target's `data-*`
attributes (stamped at render time from data already in `careerView`). No snapshot changes, no network,
no `careerView` dependency inside the handler.

## Testing

- **Unit (`tests/teamviz.test.js`, extend):** `ATTR_RU` has all 13 `ATTR_KEYS`; `driverSkillTip("VER",0.94,
  "Red Bull","Ферстаппен",28)` contains the name, "OVR", every RU label, and at least one bar width;
  `staffSkillTip("strategist",0.82,"Mercedes")` contains "Стратег", "82", and the effect text;
  `personTipAttrs({abbrev:"VER",overall:0.94,team:"Red Bull",name:"Ферстаппен",age:28})` contains
  `data-driver="VER"` and `data-ovr`; `staffTipAttrs` contains `data-staff` + `data-val`.
- **Boot/syntax:** `node --check` the two touched modules; module-load `teamviz.js`.
- **Suite:** stays green (only `teamviz.test.js` imports a touched module; `season.js` isn't test-imported).
  Run the fast non-sim suite per task; the full ~12-min suite once at the end. NEVER run `node --test`
  concurrently (it contends and looks hung).
- **F5 (owner):** hover behaviour + positioning + the card layout are visual → owner playtest, like all UI.

## Out of scope (YAGNI)

- Tooltips in the race HUD / quali tower (the live snapshot carries no attributes; would touch owner-WIP
  netcode — and hovering mid-session is awkward).
- Facility tooltips (buildings, not people).
- Touch/long-press fallback (desktop game).
- Click-to-pin / a full driver profile modal (hover tooltip only).
- `style.css` changes (everything inline-styled).

## Risks / notes

- **Surgical `season.js` edits on owner D4 WIP** — change only the five row/card markups + one
  `attachPersonTips(root)` call; `git add` only `ui/season.js` + `ui/teamviz.js` (+ the test). The controller
  makes the `season.js` edit directly for pathspec safety (as in the team-visuals pass).
- **Idempotent attach** — `render()` runs on every paddock interaction (tab switch re-renders); the singleton
  is created once and listeners are re-bound to the fresh `root` without leaks.
- **`pointer-events:none`** on the tip so it never blocks the «Продлить»/action buttons under it.
- **Missing data** — if a target lacks `overall` (shouldn't happen), the builder guards (no bars, header
  only) rather than throwing.
