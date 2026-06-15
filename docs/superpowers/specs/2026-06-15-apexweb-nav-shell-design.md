# ApexWeb Navigation Shell + Paddock Tabs (Design)

**Date:** 2026-06-15
**Status:** approved (design), pending spec review
**Topic:** a consistent navigation shell across the whole game + the paddock reorganised from a long
scroll into tabs — "разбить всё по меню, чтобы удобней было смотреть".

## Goal

Two linked UI improvements (no sim changes):

- **A persistent navigation shell** — a thin top bar present on every screen: brand + a **weekend
  stepper** (Практика → Квала → Гонка → Паддок, current highlighted, past with a check) + a career
  context chip (season · round · team · money). Gives consistent "where am I in the weekend / season"
  orientation that the game currently lacks (every screen is a bare full-page render).
- **Paddock tabs** — the season/paddock screen (`ui/season.js`), today a ~10-panel vertical wall, becomes
  **8 tabs** (Обзор / Финансы / Машина / Пилоты / Команда / Трансферы / Академия / Зачёт) showing one
  section at a time, with the "Начать уикенд / Новый сезон" action as a persistent footer.

**Constraints:** the deterministic **sim is untouched** (the full 236-test suite + balance corridor must
stay green); user-facing strings **Russian**, UI built in code; commit with **explicit pathspecs only**
(the owner keeps parallel career-mode WIP in the tree); **do not push**.

## Current state

- `index.html` is bare: `<div id="app"></div>`. Each screen module's `render(root, ctx)` does a full
  `root.innerHTML = …` into `#app`. There is **no persistent chrome**.
- `main.js` `rerender()` orchestrates: computes `phase`, a `liveSig(phase, snap)` structural signature for
  the **live** screens (practice/quali) — on a clock-only tick it calls `patchClock(snap)` and returns
  (controls untouched); otherwise it sets `root.className` (`wide`/`no-anim`) and calls `mod.render(root)`.
  The **race** screen is not `liveSig`-gated (returns null) → `rerender()` runs `mod.render` every frame;
  `ui/race.js` builds its skeleton once (`ctx._hudReady`) and mutates via `updateHud`.
- The career **paddock** is phase `result` with `ctx.career` set (`main.js`: `ctx.career && phase ===
  "result" → seasonUI`). The weekend phases are `practice1/2/3 → quali → race → result`.
- `ui/season.js` renders, in one `#app.innerHTML`, stacked panels: header → news → finances+sponsors →
  development → drivers → staff → transfers → academy → sponsor-offers → standings → next-weekend footer.

## Architecture — the shell is a sibling above `#app` (NOT a split inside it)

To avoid touching the existing `#app`-targeted CSS (`#app.wide` 2-col dashboards, the
`#app:not(.no-anim)>.panel` entrance animation, the dashboard grids), the shell is a **sibling header
above `#app`**, not a wrapper that re-parents the content:

```html
<body>
  <header id="nav"></header>
  <div id="app"></div>
  <script type="module" src="src/main.js"></script>
</body>
```

- Screens still render into `#app` exactly as today — **render target unchanged**, CSS unchanged,
  `patchClock` (queries `.pw-clock`/`.q-clock` from `#app`) unchanged.
- `main.js` renders the shell into `#nav` (sibling). `#nav` is `position: sticky; top: 0` so it stays
  visible while the paddock scrolls.

### Shell render gating (critical — must not rebuild every frame)

`rerender()` runs every frame for the race screen. The shell must **not** rebuild on every call (flicker /
churn). Gate it on a signature that only changes when the shell's content changes:

```js
function shellSig(ctx) {
  const phase = ctx.weekend.phase;
  const c = ctx.careerView;
  return c ? `${phase}|${c.season}.${c.round}.${Math.round(c.money/1e5)}.${c.board?.confidence ?? 0}` : `${phase}|solo`;
}
```

In `rerender()`, after the `patchClock` early-return path (so a clock tick never touches the shell):

```js
const ssig = shellSig(ctx);
if (ssig !== ctx._shellSig) { ctx._shellSig = ssig; renderShell(nav, ctx); }
```

`renderShell` is pure display (no inputs/controls) so rebuilding it on a real context change is harmless.
For the race screen `shellSig` is stable → the shell renders once on entering the phase, then is skipped.

## Component: `ui/shell.js` (new)

```js
// pure: map a phase to the 4-step weekend stepper state. "done" | "current" | "upcoming".
const stateFor = (i, idx) => i < idx ? "done" : i === idx ? "current" : "upcoming";
export function weekendSteps(phase) {
  const idx = phase && phase.startsWith("practice") ? 0 : phase === "quali" ? 1 : phase === "race" ? 2 : phase === "result" ? 3 : -1;
  const sub = phase && phase.startsWith("practice") ? phase.slice(-1) : null;   // "1" | "2" | "3"
  return [
    { key: "practice", label: sub ? `Практика P${sub}` : "Практика", state: stateFor(0, idx) },
    { key: "quali",    label: "Квала",  state: stateFor(1, idx) },
    { key: "race",     label: "Гонка",  state: stateFor(2, idx) },
    { key: "paddock",  label: "Паддок", state: stateFor(3, idx) },
  ];
}

import { constructorStandings, CALENDAR } from "../career.js";   // same source ui/season.js uses

export function renderShell(nav, ctx) {
  const phase = ctx.weekend.phase;
  const c = ctx.careerView;
  // lobby: brand only (the lobby IS the menu — no weekend yet)
  if (phase === "lobby") { nav.innerHTML = `<div class="nav"><span class="nav-brand">Apex Web</span></div>`; return; }
  const steps = weekendSteps(phase).map(s =>
    `<span class="nav-step nav-${s.state}">${s.state === "done" ? "✓ " : ""}${s.label}</span>`).join('<span class="nav-sep">›</span>');
  let ctxChip = "";
  if (c) {
    const team = (constructorStandings(c).find(x => x.isPlayer) || {}).team || "";   // derived, not a careerView field
    ctxChip = `<span class="nav-ctx">Сезон ${c.season} · R${(c.round ?? 0) + 1}/${CALENDAR.length}</span>
       <span class="nav-ctx">${team}</span>
       <span class="nav-money">$${((c.money ?? 0) / 1e6).toFixed(1)}M</span>`;
  }
  nav.innerHTML = `<div class="nav">
      <span class="nav-brand">Apex Web</span>
      <div class="nav-steps">${steps}</div>
      <div class="nav-ctxs">${ctxChip}</div>
    </div>`;
}
```

> The team name is **derived** via `constructorStandings(c).find(isPlayer).team` (there is no
> `c.teamName` field) — the same way `ui/season.js` gets it. `ctx.careerView` is maintained on host +
> client. Read other fields defensively (`?? 0`) so a partial snapshot degrades gracefully.

Live screens (race/practice/quali) keep the shell as the same thin top strip; their own headers (the race
`dash-head` with track/lap/3D/speed/pause, etc.) render below it inside `#app` for screen-specific
controls. The shell is orientation only — it never holds screen controls.

## Component: `ui/season.js` (paddock → tabs)

The single `#app.innerHTML` wall becomes a **tab bar + one active section + a persistent footer**.

- **Tab state:** `ctx._padTab` (UI-only, NOT networked — each player can view a different tab), default
  `"overview"`. Tab order + labels:
  `overview` Обзор · `finance` Финансы · `car` Машина · `drivers` Пилоты · `staff` Команда ·
  `transfers` Трансферы · `academy` Академия · `standings` Зачёт.
- **Section grouping** (reuse the existing panel-builders, just route them per tab):
  - **Обзор** — season/team/board header + news + last-result line + **sponsor offers** (if
    `c.pendingOffers`, with the "выбери спонсора" notice — they block the weekend start).
  - **Финансы** — finances ledger + sponsors panels.
  - **Машина** — development panel.
  - **Пилоты** — drivers panel.
  - **Команда** — staff & facilities panel.
  - **Трансферы** — transfer panel.
  - **Академия** — academy panel.
  - **Зачёт** — constructor + driver standings.
- **Persistent footer** (always below the tab content, every tab): the next-weekend gate
  (`Начать уикенд ▶` / `Готов ✓ — ждём напарника…`) or the season-end verdict + `Новый сезон ▶`. So the
  primary action is never buried in a tab. If `c.pendingOffers` blocks the start, the footer button is
  disabled with a hint pointing to the Обзор tab.
- **Re-render on tab click:** the tab buttons set `ctx._padTab` and re-run the paddock render
  (`render(root, ctx)` — the season screen is not `liveSig`-gated and is static, so a full re-render is
  fine). The existing per-action button handlers (`career_project`, `career_sign`, …) are wired only for
  the buttons present in the active tab.
- Empty tabs (e.g. no juniors yet) show a muted "пусто" line rather than vanishing.

## Data flow

- Shell reads `ctx.weekend.phase` + `ctx.careerView` (both already set on host and client). **No new sim
  or network data.**
- Paddock tab state is `ctx._padTab` — pure client-side UI, never sent over the wire.

## CSS (`style.css`)

New rules (scoped, additive — no existing selector changes):
- `#nav { position: sticky; top: 0; z-index: 5; }` `.nav { display:flex; align-items:center; gap:12px;
  flex-wrap:wrap; padding:8px 14px; … }` `.nav-brand` `.nav-steps`/`.nav-step`/`.nav-sep`
  (`.nav-done`/`.nav-current`/`.nav-upcoming` colour states) `.nav-ctxs`/`.nav-ctx`/`.nav-money`.
- `.pad-tabs { display:flex; gap:4px; flex-wrap:wrap; … }` `.pad-tab` (+ `.pad-tab.on` active state)
  `.pad-foot` (the persistent footer bar). Match the existing dark theme tokens (`var(--…)`).

## Testing

- **Unit (`tests/shell.test.js`, new):** `weekendSteps` — lobby → all upcoming; `practice2` → practice
  current + label `Практика P2`, rest upcoming; `quali` → practice done, quali current; `result` → first
  three done, paddock current. Pure function, fast.
- **Boot/syntax:** `node --check src/ui/shell.js src/ui/season.js src/main.js`; cache-busted dynamic import
  of the module graph loads clean.
- **Full suite unchanged:** `node --test` stays **236/236** (no sim/data files touched).
- **Preview + F5 (owner):** the live host-loop + the paddock tab interaction + the sticky shell across
  screens are not headless-verifiable end-to-end (reaching the paddock needs a full weekend playthrough) —
  same F5 gate as all prior ApexWeb UI work. Verify the paddock tabs render + switch via the preview where
  reachable.

## Files

- `index.html` — add `<header id="nav"></header>` above `<div id="app">`.
- `src/ui/shell.js` (new) — `weekendSteps` + `renderShell`.
- `src/main.js` — `nav = document.getElementById("nav")`; `shellSig` + the gated `renderShell` call in
  `rerender()` (after the `patchClock` early return); expose `c.teamName`/`_calLen` to the shell if needed.
- `src/ui/season.js` — tab bar + per-tab section routing + persistent footer + `ctx._padTab`.
- `style.css` — `.nav*` + `.pad-tab*` rules.
- `tests/shell.test.js` (new) — `weekendSteps`.
- `README.md` — note the nav shell + paddock tabs.

## Out of scope (YAGNI for v1)

- Free navigation between weekend phases (the flow is linear — the stepper is orientation, not jump-links).
- Restructuring the live race/practice/quali screens into tabs (they need everything visible at once).
- A left sidebar (rejected — eats horizontal width the live dashboards need on a narrow viewport).
- Networking the active paddock tab (it's per-player UI state).

## Risks / notes

- **Shell rebuild churn:** the `shellSig` gate is load-bearing — without it the nav rebuilds ~12 Hz on the
  race screen. Verify the `#nav` node is stable across race frames (only re-rendered on phase/context change).
- **`careerView` shape:** the chip reads the owner's `career.js` snapshot fields; read defensively and
  degrade if a field is absent (don't assume `board.confidence`/`teamName` exist).
- **Parallel WIP:** `ui/season.js` and `main.js` carry the owner's active career work — edit surgically and
  commit only the exact lines for this feature with explicit pathspecs; never `git add -A`/`.`/`stash`.
