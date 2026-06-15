# ApexWeb Navigation Shell + Paddock Tabs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent top navigation shell (weekend stepper + career context) across every screen, and reorganise the paddock from a ~10-panel vertical wall into 8 tabs.

**Architecture:** A sibling `<header id="nav">` ABOVE `<div id="app">` (so existing `#app`-targeted CSS is untouched). `main.js` renders the shell into `#nav`, gated by a `shellSig` so it never rebuilds on the ~12 Hz race repaint. The paddock (`ui/season.js`) keeps its panel-builders but routes them into tabs (`ctx._padTab`) with a persistent next-weekend footer. **No sim/data files are touched — the full 236-test suite must stay green.**

**Tech stack:** vanilla JS ES modules, `node --test` (built-in), CSS. No build step.

**Constraints (every task):** pure UI; **never touch the sim/data** (`sim.js`, `data.js`, `events.js`, etc.); user-facing strings **Russian**; commit with **explicit pathspecs only** — never `git add -A`/`.`/`commit -a`, never `git stash` (the owner keeps parallel career-mode WIP in `main.js` and `ui/season.js`; edit those two surgically). **Do not push.** Commit subjects end with the `Co-Authored-By` trailer below, passed as a separate `-m`.

**Theme tokens (from `style.css` `:root`):** `--bg #0a0a0c`, `--panel #18181b`, `--content2 #27272a`, `--content3 #3f3f46`, `--ink #ECEDEE`, `--muted #A1A1AA`, `--border rgba(255,255,255,.10)`, `--accent #006FEE`, `--good #17C964`, `--warn`, `--bad`, `--r-sm 8px`, `--r-md 12px`, `--r-lg 16px`, `--ease`. `#app{max-width:720px;margin:0 auto;padding:18px}`, `#app.wide{max-width:1160px}`.

---

## File map

- `ApexWeb/src/ui/shell.js` (new) — `weekendSteps(phase)` (pure), `shellSig(ctx)` (pure string), `renderShell(nav, ctx)` (writes `#nav`).
- `ApexWeb/index.html` — add `<header id="nav"></header>` above `<div id="app">`.
- `ApexWeb/src/main.js` — import the shell; `const nav = …#nav`; the gated `renderShell` call in `rerender()`. **Surgical** (owner WIP).
- `ApexWeb/src/ui/season.js` — paddock → tabs (`ctx._padTab`, per-tab routing, persistent footer). **Surgical** (owner WIP).
- `ApexWeb/style.css` — `.nav*` and `.pad-tab*` rules.
- `ApexWeb/tests/shell.test.js` (new) — `weekendSteps` + `shellSig`.
- `ApexWeb/README.md` — note the shell + paddock tabs.

---

### Task 1: `ui/shell.js` — `weekendSteps` (pure) + test

**Files:**
- Create: `ApexWeb/src/ui/shell.js`
- Test: `ApexWeb/tests/shell.test.js` (create)

- [ ] **Step 1: Write the failing test** — create `ApexWeb/tests/shell.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { weekendSteps } from "../src/ui/shell.js";

test("weekendSteps: lobby all upcoming; practice2 current+label; quali done/current; result paddock current", () => {
  const lobby = weekendSteps("lobby");
  assert.equal(lobby.length, 4);
  assert.ok(lobby.every(s => s.state === "upcoming"), "lobby → all upcoming");

  const p2 = weekendSteps("practice2");
  assert.equal(p2[0].label, "Практика P2");
  assert.equal(p2[0].state, "current");
  assert.equal(p2[1].state, "upcoming");

  const q = weekendSteps("quali");
  assert.equal(q[0].state, "done");
  assert.equal(q[1].state, "current");

  const r = weekendSteps("result");
  assert.deepEqual(r.map(s => s.state), ["done", "done", "done", "current"]);
  assert.deepEqual(r.map(s => s.key), ["practice", "quali", "race", "paddock"]);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd ApexWeb && node --test tests/shell.test.js`
Expected: FAIL — cannot find module `../src/ui/shell.js`.

- [ ] **Step 3: Implement** — create `ApexWeb/src/ui/shell.js`:

```js
// ApexWeb/src/ui/shell.js — the persistent top navigation shell (sibling #nav above #app).
// weekendSteps + shellSig are pure; renderShell writes the #nav element.
import { constructorStandings, CALENDAR } from "../career.js";   // same source ui/season.js uses

const stateFor = (i, idx) => i < idx ? "done" : i === idx ? "current" : "upcoming";

// map a phase to the 4-step weekend stepper. state ∈ "done" | "current" | "upcoming".
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
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd ApexWeb && node --test tests/shell.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/ui/shell.js ApexWeb/tests/shell.test.js
git commit -m "feat(apexweb): nav shell weekendSteps (pure weekend stepper state)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `ui/shell.js` — `shellSig` + `renderShell`

**Files:**
- Modify: `ApexWeb/src/ui/shell.js`
- Test: `ApexWeb/tests/shell.test.js`

- [ ] **Step 1: Write the failing test** — append to `ApexWeb/tests/shell.test.js`:

```js
import { shellSig } from "../src/ui/shell.js";

test("shellSig: stable for same context; changes with phase / round / money / mode", () => {
  const base = { weekend: { phase: "result" }, careerView: { season: 1, round: 2, money: 42e6, board: { confidence: 0.63 } } };
  assert.equal(shellSig(base), shellSig({ ...base }), "same context → same sig");
  assert.notEqual(shellSig(base), shellSig({ ...base, weekend: { phase: "race" } }), "phase changes it");
  assert.notEqual(shellSig(base), shellSig({ weekend: { phase: "result" }, careerView: { ...base.careerView, round: 3 } }), "round changes it");
  assert.notEqual(shellSig(base), shellSig({ weekend: { phase: "result" }, careerView: { ...base.careerView, money: 50e6 } }), "money changes it");
  assert.ok(shellSig({ weekend: { phase: "race" }, careerView: null }).includes("solo"), "no career → solo");
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd ApexWeb && node --test tests/shell.test.js`
Expected: FAIL — `shellSig` is not exported.

- [ ] **Step 3: Implement** — append to `ApexWeb/src/ui/shell.js`:

```js
// a cheap signature of everything the shell displays — main.js re-renders the shell only when this
// changes, so it never rebuilds on the ~12Hz race repaint. money is bucketed to 0.1M to avoid churn.
export function shellSig(ctx) {
  const phase = ctx.weekend.phase;
  const c = ctx.careerView;
  return c ? `${phase}|${c.season}.${c.round}.${Math.round((c.money || 0) / 1e5)}.${c.board ? c.board.confidence : 0}` : `${phase}|solo`;
}

export function renderShell(nav, ctx) {
  const phase = ctx.weekend.phase;
  const c = ctx.careerView;
  if (phase === "lobby") { nav.innerHTML = `<div class="nav"><span class="nav-brand">Apex Web</span></div>`; return; }
  const steps = weekendSteps(phase)
    .map(s => `<span class="nav-step nav-${s.state}">${s.state === "done" ? "✓ " : ""}${s.label}</span>`)
    .join('<span class="nav-sep">›</span>');
  let ctxChip = "";
  if (c) {
    const team = (constructorStandings(c).find(x => x.isPlayer) || {}).team || "";   // derived (no c.teamName field)
    ctxChip = `<span class="nav-ctx">Сезон ${c.season} · R${(c.round || 0) + 1}/${CALENDAR.length}</span>
      <span class="nav-ctx">${team}</span>
      <span class="nav-money">$${((c.money || 0) / 1e6).toFixed(1)}M</span>`;
  }
  nav.innerHTML = `<div class="nav">
      <span class="nav-brand">Apex Web</span>
      <div class="nav-steps">${steps}</div>
      <div class="nav-ctxs">${ctxChip}</div>
    </div>`;
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd ApexWeb && node --test tests/shell.test.js`
Expected: PASS (both tests). `renderShell` is DOM-writing so it has no node unit test — it is covered by the syntax check below + the owner's F5.

Then syntax-check the new module: `node --check src/ui/shell.js` → no output (OK).

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/ui/shell.js ApexWeb/tests/shell.test.js
git commit -m "feat(apexweb): nav shell renderShell + shellSig (stepper + career context chip)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `index.html` + `main.js` wiring (the sibling `#nav` + gated render)

**Files:**
- Modify: `ApexWeb/index.html`
- Modify: `ApexWeb/src/main.js` (SURGICAL — owner WIP; match on code text, the line numbers below are approximate)

- [ ] **Step 1: `index.html`** — replace:

```html
  <div id="app"></div>
```

with:

```html
  <header id="nav"></header>
  <div id="app"></div>
```

- [ ] **Step 2: `main.js` — import the shell.** Near the other `./ui/*` imports (there is a line `import * as race from "./ui/race.js";`), add:

```js
import { renderShell, shellSig } from "./ui/shell.js";
```

- [ ] **Step 3: `main.js` — grab the nav element.** Find:

```js
const root = document.getElementById("app");
```

Add immediately after it:

```js
const nav = document.getElementById("nav");
```

- [ ] **Step 4: `main.js` — render the shell, gated.** In `rerender()`, find the line that runs right after the `patchClock` early-return (it reads `ctx._liveSig = sig;`). Insert the gated shell render right after it:

```js
  ctx._liveSig = sig;
  // nav shell: render only when its content changes (phase / career context) so it never rebuilds on
  // the ~12Hz race repaint. Wrapped in try/catch — it runs inside the host rAF loop; a throw must not
  // kill the loop.
  try { const ss = shellSig(ctx); if (ss !== ctx._shellSig) { ctx._shellSig = ss; renderShell(nav, ctx); } } catch (e) { console.error("[shell] render threw:", e); }
```

(The rest of `rerender()` — `cls`, `root.className`, the screen `mod.render(root, ctx)` — is unchanged.)

- [ ] **Step 5: Verify — syntax + the suite still green**

Run: `cd ApexWeb && node --check src/main.js && node --check src/ui/shell.js && echo "syntax OK"`
Expected: `syntax OK`. (main.js drives the DOM, so it can't be `node`-imported; `--check` validates syntax. The live shell behaviour is F5-verified.)

Run: `cd ApexWeb && node --test tests/shell.test.js` → still PASS.

- [ ] **Step 6: Commit**

```bash
git add ApexWeb/index.html ApexWeb/src/main.js
git commit -m "feat(apexweb): wire the nav shell into main (sibling #nav, shellSig-gated)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `style.css` — `.nav*` rules

**Files:**
- Modify: `ApexWeb/style.css` (append at the end)

- [ ] **Step 1: Implement** — append to `ApexWeb/style.css`:

```css
/* nav shell (sibling #nav above #app) — sticky top bar: brand + weekend stepper + career context */
#nav{position:sticky;top:0;z-index:5;background:var(--panel);border-bottom:1px solid var(--border)}
.nav{display:flex;align-items:center;gap:12px;flex-wrap:wrap;max-width:1160px;margin:0 auto;padding:8px 18px}
.nav-brand{font-weight:700;font-size:15px;color:var(--ink);white-space:nowrap}
.nav-steps{display:flex;align-items:center;gap:6px;flex:1;min-width:200px;flex-wrap:wrap}
.nav-step{font-size:12px;color:var(--muted);padding:3px 8px;border-radius:var(--r-sm);white-space:nowrap}
.nav-done{color:var(--good)}
.nav-current{color:#fff;background:var(--accent);font-weight:600}
.nav-upcoming{color:var(--muted);opacity:.55}
.nav-sep{color:var(--muted);opacity:.4;font-size:12px}
.nav-ctxs{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.nav-ctx{font-size:12px;color:var(--muted);white-space:nowrap}
.nav-money{font-size:12px;color:var(--good);font-weight:700;white-space:nowrap}
```

- [ ] **Step 2: Verify** — open the page; the sticky bar shows on every screen. (No automated test for CSS.)

Run: `cd ApexWeb && node --test 2>&1 | grep -E "^# (pass|fail)"`
Expected: `# pass 238 # fail 0` (236 prior + the 2 new shell tests; sim untouched).

- [ ] **Step 3: Commit**

```bash
git add ApexWeb/style.css
git commit -m "style(apexweb): nav shell bar (sticky stepper + context chip)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `ui/season.js` — paddock → 8 tabs

**Files:**
- Modify: `ApexWeb/src/ui/season.js` (SURGICAL — owner WIP. Read the CURRENT file first; it may have drifted. Preserve ALL panel-builder code and ALL existing button handlers; only the final assembly + a tab bar + a tab-click handler change.)

The current `render()` computes panel-string variables (`finances`, `spons`, `devPanel`, `driversPanel`, `staffPanel`, `transferPanel`, `academyPanel`, `offers`, `consTbl`, `drvTbl`, `footer`, plus the header/news inline) and then assigns one big `root.innerHTML` stacking them all, followed by the button-handler wiring. **Keep every panel-builder and every handler.** Replace only the final assembly.

- [ ] **Step 1: Add the tab default + empty helper.** Near the top of `render()` (after `const c = ctx.careerView;` and its null guard), add:

```js
  ctx._padTab = ctx._padTab || "overview";
  const emptyMsg = t => `<div class="panel"><p class="label">${t}</p></div>`;
```

- [ ] **Step 2: Replace the final `root.innerHTML = …` assembly.** The current assembly stacks: a season-header panel, the news panel, `finances`+`spons`, `devPanel`, `driversPanel`, `staffPanel`, `transferPanel`, `academyPanel`, `offers`, the two standings panels, and `footer`. Replace that whole `root.innerHTML = \`…\`;` statement with the tabbed assembly below. Reuse the SAME inline header/news markup the file already builds (copy the existing season-header `<div class="panel">…</div>` and the news `<div class="panel">…</div>` expressions into the `headerPanel`/`newsPanel` locals — do not invent new content):

```js
  const headerPanel = `<div class="panel"><h2>Сезон ${c.season} · ${me ? me.team : ""} (P${me ? me.pos : "-"})</h2>
      <p class="label">Доверие совета: ${Math.round((c.board && c.board.confidence != null ? c.board.confidence : 0.5) * 100)}% · цель P${c.board ? c.board.targetPos : "-"}</p>
      ${lr ? `<p class="label">${lr.gp}: ${podium}</p>` : ""}</div>`;
  const newsPanel = (c.news && c.news.length) ? `<div class="panel"><p class="label">📰 Новости</p>${c.news.slice(0, 8).map(n => `<p class="label" style="margin:2px 0">• ${n}</p>`).join("")}</div>` : "";
  const financeTab = `<div style="display:flex;gap:12px;flex-wrap:wrap">${finances}${spons}</div>`;
  const standingsTab = `<div style="display:flex;gap:12px;flex-wrap:wrap">
      <div class="panel" style="flex:1;min-width:240px"><p class="label">Кубок конструкторов</p>
        <table style="width:100%;border-collapse:collapse"><tbody>${consTbl}</tbody></table></div>
      <div class="panel" style="flex:1;min-width:240px"><p class="label">Личный зачёт (топ-10)</p>
        <table style="width:100%;border-collapse:collapse"><tbody>${drvTbl}</tbody></table></div>
    </div>`;

  const TABS = [["overview","Обзор"],["finance","Финансы"],["car","Машина"],["drivers","Пилоты"],["staff","Команда"],["transfers","Трансферы"],["academy","Академия"],["standings","Зачёт"]];
  const TAB_CONTENT = {
    overview:  headerPanel + newsPanel + offers,
    finance:   financeTab,
    car:       devPanel || emptyMsg("Нет данных по машине"),
    drivers:   driversPanel || emptyMsg("Нет пилотов"),
    staff:     staffPanel || emptyMsg("Нет данных по команде"),
    transfers: transferPanel || emptyMsg("Нет доступных трансферов"),
    academy:   academyPanel || emptyMsg("Академия недоступна"),
    standings: standingsTab,
  };
  const tabBar = `<div class="pad-tabs">${TABS.map(([k, l]) => `<button class="pad-tab${k === ctx._padTab ? " on" : ""}" data-tab="${k}">${l}</button>`).join("")}</div>`;

  root.innerHTML = tabBar + `<div id="pad-content">${TAB_CONTENT[ctx._padTab] || TAB_CONTENT.overview}</div>` + `<div class="pad-foot">${footer}</div>`;

  root.querySelectorAll(".pad-tab").forEach(b => b.onclick = () => { ctx._padTab = b.dataset.tab; render(root, ctx); });
```

> Note: `me`, `lr`, `podium`, `finances`, `spons`, `devPanel`, `driversPanel`, `staffPanel`, `transferPanel`, `academyPanel`, `offers`, `consTbl`, `drvTbl`, `footer` are the existing locals — already computed above in the same function. If the owner renamed any, map to the current names. The existing button-handler block (`button.offer`, `button.devbtn`, `button.resign`, `button.stf`, `button.sign`, `button.scout`, `button.promote`, `#startwknd`, `#newseason`) stays **after** this assembly, unchanged — each binds only to the buttons present in the active tab (a no-op when that tab isn't shown).

- [ ] **Step 3: Verify — syntax + suite**

Run: `cd ApexWeb && node --check src/ui/season.js && echo OK`
Expected: `OK`.

Run: `cd ApexWeb && node --test 2>&1 | grep -E "^# (pass|fail)"`
Expected: `# pass 238 # fail 0`.

- [ ] **Step 4: Commit**

```bash
git add ApexWeb/src/ui/season.js
git commit -m "feat(apexweb): paddock as 8 tabs + persistent next-weekend footer" -m "Overview/Finance/Car/Drivers/Staff/Transfers/Academy/Standings via ctx._padTab; the panel-builders and per-action handlers are unchanged — only the assembly is tabbed. The Начать уикенд / Новый сезон footer stays visible below every tab." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `style.css` — `.pad-tab*` rules

**Files:**
- Modify: `ApexWeb/style.css` (append at the end)

- [ ] **Step 1: Implement** — append to `ApexWeb/style.css`:

```css
/* paddock tabs */
.pad-tabs{display:flex;gap:4px;flex-wrap:wrap;background:var(--content2);padding:4px;border-radius:var(--r-md);margin-bottom:12px}
.pad-tab{padding:7px 12px;border-radius:var(--r-sm);background:transparent;color:var(--muted);font-weight:600;font-size:13px;border:none;cursor:pointer}
.pad-tab:hover{color:var(--ink);background:rgba(255,255,255,.05)}
.pad-tab.on{background:var(--accent);color:#fff}
.pad-foot{margin-top:12px}
```

- [ ] **Step 2: Verify** — open the paddock; the tab bar renders, clicking a tab swaps the section, the footer stays below. (No automated test for CSS.)

- [ ] **Step 3: Commit**

```bash
git add ApexWeb/style.css
git commit -m "style(apexweb): paddock tab bar" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: README + final verification

**Files:**
- Modify: `ApexWeb/README.md`

- [ ] **Step 1: Update the README** — in the intro / structure section, note: a persistent top **nav shell** (weekend stepper Практика→Квала→Гонка→Паддок + season/team/money context) on every screen, and the **paddock is now tabbed** (Обзор/Финансы/Машина/Пилоты/Команда/Трансферы/Академия/Зачёт) instead of one long scroll. Bump the `node --test` count note from 236 to 238. Add `src/ui/shell.js` to the file list if one is present.

- [ ] **Step 2: Full suite**

Run: `cd ApexWeb && node --test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 238 # pass 238 # fail 0` (sim untouched → all prior tests intact).

- [ ] **Step 3: Syntax sweep of every touched module**

Run: `cd ApexWeb && node --check src/ui/shell.js && node --check src/ui/season.js && node --check src/main.js && echo "all OK"`
Expected: `all OK`.

- [ ] **Step 4: Commit**

```bash
git add ApexWeb/README.md
git commit -m "docs(apexweb): README — nav shell + paddock tabs; test count 238" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final notes for the executor

- **Sim is untouched.** No task edits `sim.js`/`data.js`/`events.js`/etc. The full suite stays 238 (236 + 2 shell tests). If any pre-existing test fails, something went wrong — stop and diagnose.
- **`shellSig` gate is load-bearing.** Without it the `#nav` rebuilds ~12 Hz on the race screen. The render is wrapped in try/catch so a throw can't kill the host rAF loop.
- **Surgical edits to `main.js` + `ui/season.js`.** The owner has active career-mode WIP in both. Read the current file, change only the lines this plan specifies, and `git add` only those exact files. Never `git add -A`/`.`/`commit -a`/`git stash`.
- **Do not push.** Stop after Task 7 and report.
- **Owner F5** is the only check for the live sticky shell across screens + the paddock tab interaction end-to-end (reaching the paddock needs a full weekend playthrough), same as all prior ApexWeb UI work.
