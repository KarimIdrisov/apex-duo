# ApexWeb Team Visuals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ApexWeb UI read in team colours with real driver photos, car renders, logos and tyre icons — via one shared `ui/teamviz.js` layer applied across paddock, race, lobby and quali — with the deterministic sim untouched and the full test suite still green.

**Architecture:** A new pure/DOM helper module `src/ui/teamviz.js` centralises team colour, readable-ink, driver numbers, asset paths, the tyre icon, and two HTML builders (`driverAvatar`, `driverCard`). The user-provided images are first reorganised by our slugs (`assets/drivers/<ABBREV>.png`, `assets/cars/<slug>.png`). Each screen then imports the helpers and calls them where it already renders driver/team rows. No sim, data, snapshot or network changes.

**Tech Stack:** Vanilla JS ES modules, Canvas/SVG, `node --test` (node:test + node:assert/strict). No build step.

**CRITICAL — parallel-WIP discipline:** The owner keeps uncommitted work in this same tree (Godot `ApexDuo_Prototype/*`, `experiments/`, untracked tools, and active career-mode work in `main.js`/`ui/season.js`/`data.js`). For EVERY commit, `git add` ONLY the explicit pathspecs named in the task. NEVER `git add -A`, `git add .`, `git commit -a`, or `git stash`. Do NOT push. Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` (use a second `-m` flag for it). `data.js` and `sim.js` are READ-ONLY for this whole plan.

---

## File Structure

- `assets/drivers/<ABBREV>.png` — 22 driver photos, renamed from the loose `assets/2026-<lastname>.png` (Task 1).
- `assets/cars/<slug>.png` — 11 car renders, renamed from the loose `assets/<team>-<model>-2026-f1-car-…png` (Task 1).
- `src/ui/teamviz.js` — NEW. Shared visual layer: `teamColor`, `teamInk`, `DRIVER_NUM`, `teamLogoSrc`, `carImgSrc`, `tyreIcon` (Task 2); `driverAvatar`, `driverCard` (Task 3).
- `tests/teamviz.test.js` — NEW. Pure-helper unit tests + on-disk asset-presence checks (Task 2; extended in Task 3).
- `src/ui/season.js` — MODIFY (surgical). Пилоты tab → driver cards; Зачёт tab → avatars + team colour (Task 4).
- `src/ui/race.js` — MODIFY. Leaderboard rows get a team-colour accent; route the logo through teamviz (Task 5).
- `src/ui/lobby.js` — MODIFY. Team picker shows the car render + team-colour card (Task 6).
- `src/ui/quali.js` — MODIFY. Tower swatch single-sourced through teamviz; player live-lap card gets a team accent (Task 7).
- `README.md` — MODIFY. Document the team-visual layer + bump the test count (Task 8).

**Out of scope (faithful to the spec):** `practice.js` renders the setup widget + clock, no driver/team identity row — the spec scopes accents to "rows/cards that show drivers", so practice gets no edit this pass. The loose `*-normalized-logo.png` and `2026-leclerc (1).png` stay untouched. The original SVG car silhouette is dropped (real renders supersede it).

---

### Task 1: Organise the user-provided assets into folders

**Files:**
- Create dir: `assets/drivers/` (22 files), `assets/cars/` (11 files)
- Move: the loose `assets/2026-<lastname>.png` and `assets/<team>-…-dashboard.png`

- [ ] **Step 1: Confirm the source PNGs are untracked (so a filesystem move + add is correct)**

Run (from `ApexWeb/`):
```bash
git ls-files assets/ | grep -E '2026-norris|mclaren-mcl40' || echo "UNTRACKED-OK"
```
Expected: `UNTRACKED-OK` (the user just dropped these in; they are not yet in git). If instead a path prints, those files are tracked — use `git mv` in Step 2 rather than `mv`.

- [ ] **Step 2: Create the folders and move every driver photo + car render by our slug**

Run (from `ApexWeb/`, bash — the Bash tool is git-bash):
```bash
mkdir -p assets/drivers assets/cars
declare -A DRV=( [norris]=NOR [piastri]=PIA [antonelli]=ANT [russell]=RUS [verstappen]=VER [hadjar]=HAD [leclerc]=LEC [hamilton]=HAM [sainz]=SAI [albon]=ALB [alonso]=ALO [stroll]=STR [gasly]=GAS [colapinto]=COL [lawson]=LAW [lindblad]=LIN [ocon]=OCO [bearman]=BEA [hulkenberg]=HUL [bortoleto]=BOR [perez]=PER [bottas]=BOT )
for k in "${!DRV[@]}"; do mv "assets/2026-$k.png" "assets/drivers/${DRV[$k]}.png"; done
declare -A CAR=( [mclaren-mcl40-2026-f1-car-formula-1-dashboard]=mclaren [mercedes-w17-2026-f1-car-formula-1-dashboard]=mercedes [redbull-racing-rb22-2026-f1-car-formula-1-dashboard]=red_bull [ferrari-sf26-2026-f1-car-formula-1-dashboard]=ferrari [williams-fw48-2026-f1-car-formula-1-dashboard]=williams [aston-martin-amr26-2026-f1-car-formula-1-dashboard]=aston_martin [alpine-a526-2026-f1-car-formula-1-dashboard]=alpine [racing-bulls-vcarb03-2026-f1-car-formula-1-dashboard]=racing_bulls [haas-vf26-2026-f1-car-formula-1-dashboard]=haas [audi-r26-2026-f1-car-formula-1-dashboard]=audi [cadillac-mac-26-2026-f1-car-formula-1-dashboard]=cadillac )
for k in "${!CAR[@]}"; do mv "assets/$k.png" "assets/cars/${CAR[$k]}.png"; done
```

- [ ] **Step 3: Verify counts + exact names**

Run:
```bash
echo "drivers: $(ls assets/drivers | wc -l)  cars: $(ls assets/cars | wc -l)"
ls assets/drivers | sort | tr '\n' ' '; echo
ls assets/cars | sort | tr '\n' ' '; echo
```
Expected: `drivers: 22  cars: 11`; the driver list is `ALB.png ALO.png ANT.png BEA.png BOR.png BOT.png COL.png GAS.png HAD.png HAM.png HUL.png LAW.png LEC.png LIN.png NOR.png OCO.png PER.png PIA.png RUS.png SAI.png STR.png VER.png`; the car list is `alpine.png aston_martin.png audi.png cadillac.png ferrari.png haas.png mclaren.png mercedes.png racing_bulls.png red_bull.png williams.png`.

- [ ] **Step 4: Commit (explicit pathspecs — the two new folders only)**

```bash
git add assets/drivers assets/cars
git commit -m "assets(apexweb): organise driver photos + car renders into assets/{drivers,cars} by slug" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
Note: the loose `2026-leclerc (1).png` and `*-normalized-logo.png` remain untracked in `assets/` — leave them; do not stage them.

---

### Task 2: `ui/teamviz.js` pure helpers + `DRIVER_NUM` + asset paths (TDD)

**Files:**
- Create: `src/ui/teamviz.js`
- Test: `tests/teamviz.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/teamviz.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { teamColor, teamInk, DRIVER_NUM, teamLogoSrc, carImgSrc, tyreIcon } from "../src/ui/teamviz.js";
import { TEAMS, TEAM_LOGO } from "../src/data.js";

test("teamColor: known team → its hex; unknown → #888 fallback", () => {
  assert.equal(teamColor("McLaren"), "#ff8000");
  assert.equal(teamColor("Ferrari"), "#e8002d");
  assert.equal(teamColor("Nonexistent"), "#888");
});

test("teamInk: light colours get dark ink, dark colours get white", () => {
  assert.equal(teamInk("#ff8000"), "#0a0a0c");  // McLaren orange, lum ~0.59 > 0.55
  assert.equal(teamInk("#27f4d2"), "#0a0a0c");  // Mercedes teal, lum ~0.70
  assert.equal(teamInk("#e8002d"), "#fff");     // Ferrari red, lum ~0.29
  assert.equal(teamInk("#3671c6"), "#fff");     // Red Bull blue, lum ~0.41
});

test("DRIVER_NUM: all 22 grid abbrevs present with the verified 2026 numbers", () => {
  const abbrevs = TEAMS.flatMap(t => t.drivers.map(d => d.abbrev));
  assert.equal(abbrevs.length, 22);
  for (const a of abbrevs) assert.equal(typeof DRIVER_NUM[a], "number", `missing number for ${a}`);
  assert.equal(DRIVER_NUM.NOR, 1);
  assert.equal(DRIVER_NUM.VER, 3);
  assert.equal(DRIVER_NUM.LIN, 41);
  assert.equal(DRIVER_NUM.PIA, 81);
  assert.equal(DRIVER_NUM.BOT, 77);
});

test("teamLogoSrc / carImgSrc build the expected slug paths", () => {
  assert.equal(teamLogoSrc("McLaren"), "assets/teams/mclaren.png");
  assert.equal(teamLogoSrc("Sauber"), "assets/teams/audi.png");          // Sauber→audi
  assert.equal(carImgSrc("McLaren"), "assets/cars/mclaren.png");
  assert.equal(carImgSrc("RB"), "assets/cars/racing_bulls.png");          // RB→racing_bulls
});

test("tyreIcon: an <img> at assets/tyres/<compound>.png", () => {
  const html = tyreIcon("soft", 16);
  assert.match(html, /assets\/tyres\/soft\.png/);
  assert.match(html, /height:16px/);
});

test("asset presence: every grid driver has a photo and every team a car render on disk", () => {
  const here = u => fileURLToPath(new URL(u, import.meta.url));
  for (const t of TEAMS) {
    for (const d of t.drivers) {
      assert.ok(existsSync(here(`../assets/drivers/${d.abbrev}.png`)), `missing assets/drivers/${d.abbrev}.png`);
    }
    assert.ok(existsSync(here(`../assets/cars/${TEAM_LOGO[t.name]}.png`)), `missing car render for ${t.name}`);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `ApexWeb/`): `node --test tests/teamviz.test.js`
Expected: FAIL — `Cannot find module '../src/ui/teamviz.js'`.

- [ ] **Step 3: Implement `src/ui/teamviz.js` (pure helpers only)**

Create `src/ui/teamviz.js`:
```js
// ApexWeb/src/ui/teamviz.js — shared visual layer: team colours, readable ink, driver numbers,
// asset paths, tyre icon, and (Task 3) the driver avatar + card builders. Pure UI; reads data.js
// (read-only). No sim/network state.
import { TEAMS, TEAM_LOGO } from "../data.js";

const COLOR_BY_TEAM = {};
for (const t of TEAMS) COLOR_BY_TEAM[t.name] = t.color;

// team name -> hex; "#888" when unknown
export function teamColor(team) { return COLOR_BY_TEAM[team] || "#888"; }

// hex "#rrggbb" -> a readable text colour on that background. Relative luminance
// 0.299r+0.587g+0.114b (0..1); bright team colours (>0.55) get dark ink, else white.
export function teamInk(hex) {
  const h = (hex || "").replace("#", "");
  if (h.length < 6) return "#fff";
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? "#0a0a0c" : "#fff";
}

// confirmed real 2026 grid numbers (verified online): Norris #1 (reigning champion),
// Verstappen #3 (switched from 33), Lindblad #41 (rookie), Hadjar #6, Bortoleto #5.
export const DRIVER_NUM = {
  NOR: 1, PIA: 81, ANT: 12, RUS: 63, VER: 3, HAD: 6, LEC: 16, HAM: 44, SAI: 55, ALB: 23,
  ALO: 14, STR: 18, GAS: 10, COL: 43, LAW: 30, LIN: 41, OCO: 31, BEA: 87, HUL: 27, BOR: 5, PER: 11, BOT: 77,
};

export function teamLogoSrc(team) { return `assets/teams/${TEAM_LOGO[team]}.png`; }
export function carImgSrc(team)   { return `assets/cars/${TEAM_LOGO[team]}.png`; }

export function tyreIcon(compound, size = 16) {
  return `<img src="assets/tyres/${compound}.png" alt="${compound}" style="height:${size}px;width:${size}px;object-fit:contain;vertical-align:middle">`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/teamviz.test.js`
Expected: PASS — all tests green (the asset-presence test depends on Task 1 being done).

- [ ] **Step 5: Commit (explicit pathspecs)**

```bash
git add src/ui/teamviz.js tests/teamviz.test.js
git commit -m "feat(apexweb): teamviz pure helpers — teamColor/teamInk/DRIVER_NUM/asset paths + tests" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `driverAvatar` + `driverCard` DOM builders

**Files:**
- Modify: `src/ui/teamviz.js` (append two exported builders)
- Test: `tests/teamviz.test.js` (append structural tests)

- [ ] **Step 1: Write the failing tests (append to `tests/teamviz.test.js`)**

Append:
```js
import { driverAvatar, driverCard } from "../src/ui/teamviz.js";

test("driverAvatar: number block base + photo layer with an onerror fallback", () => {
  const html = driverAvatar("VER", "Red Bull", 48);
  assert.match(html, /assets\/drivers\/VER\.png/, "photo src by abbrev");
  assert.match(html, /onerror/, "photo hides on error → reveals the colour block");
  assert.match(html, />3</, "the colour-block shows the driver number 3");
  assert.match(html, /#3671c6/, "uses the Red Bull team colour");
});

test("driverCard: shows name, team chip, avatar; car render only when opts.car", () => {
  const d = { team: "McLaren", abbrev: "NOR", name: "Норрис" };
  const withCar = driverCard(d, { car: true, sub: "ovr 0.950" });
  assert.match(withCar, /Норрис/);
  assert.match(withCar, /assets\/drivers\/NOR\.png/, "avatar photo present");
  assert.match(withCar, /assets\/cars\/mclaren\.png/, "car render present when opts.car");
  assert.match(withCar, /ovr 0\.950/, "sub line rendered");
  const noCar = driverCard(d, {});
  assert.doesNotMatch(noCar, /assets\/cars\//, "no car render without opts.car");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/teamviz.test.js`
Expected: FAIL — `driverAvatar` / `driverCard` are not exported yet.

- [ ] **Step 3: Implement the two builders (append to `src/ui/teamviz.js`)**

Append:
```js
// A fixed-size avatar: base layer = team-colour block with the driver number (teamInk),
// photo layered on top. onerror hides the photo so the block shows when the file is missing.
export function driverAvatar(abbrev, team, size = 44) {
  const col = teamColor(team), ink = teamInk(col);
  const num = (DRIVER_NUM[abbrev] != null) ? DRIVER_NUM[abbrev] : abbrev;
  const fs = Math.round(size * 0.42);
  return `<span style="position:relative;display:inline-block;width:${size}px;height:${size}px;border-radius:8px;overflow:hidden;background:${col};vertical-align:middle;flex:0 0 auto">`
    + `<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${fs}px;color:${ink}">${num}</span>`
    + `<img src="assets/drivers/${abbrev}.png" alt="" onerror="this.style.display='none'" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top center">`
    + `</span>`;
}

// A team-coloured driver card: avatar + name + team chip + a sub-line, optional car render + action HTML.
// d = { team, abbrev, name }. opts = { car?:bool, sub?:html, action?:html }.
export function driverCard(d, opts = {}) {
  const col = teamColor(d.team), ink = teamInk(col);
  const car = opts.car
    ? `<img src="${carImgSrc(d.team)}" alt="" onerror="this.style.display='none'" style="position:absolute;right:6px;bottom:0;height:46px;object-fit:contain;opacity:.92;pointer-events:none">`
    : "";
  const sub = opts.sub ? `<div class="label" style="margin-top:2px">${opts.sub}</div>` : "";
  const act = opts.action || "";
  return `<div style="position:relative;overflow:hidden;background:var(--content2);border-left:4px solid ${col};border-radius:var(--r-md);padding:10px;display:flex;align-items:center;gap:10px;min-height:64px">`
    + driverAvatar(d.abbrev, d.team, 48)
    + `<div style="min-width:0;flex:1">`
    +   `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><b>${d.name}</b>`
    +     `<span style="font-size:11px;color:${ink};background:${col};border-radius:4px;padding:1px 6px">${d.team}</span></div>`
    +   sub + act
    + `</div>` + car + `</div>`;
}
```

- [ ] **Step 4: Run to verify it passes + syntax-check the module**

Run: `node --test tests/teamviz.test.js` → Expected: PASS (all blocks green).
Run: `node --check src/ui/teamviz.js` → Expected: no output (valid).

- [ ] **Step 5: Commit (explicit pathspecs)**

```bash
git add src/ui/teamviz.js tests/teamviz.test.js
git commit -m "feat(apexweb): teamviz driverAvatar + driverCard (photo-over-colour-block fallback)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Paddock — team-coloured driver cards (Пилоты) + avatars in standings (Зачёт)

**Files:**
- Modify: `src/ui/season.js` (import teamviz; the `driversPanel` builder at lines ~62-67; the `consTbl`/`drvTbl` builders at lines ~28-29)

**Scene:** `season.js` is the paddock, reorganised into 8 tabs. It is **owner career WIP** — edit ONLY the three row/card builders below; keep every other panel-builder and all `.resign`/`.devbtn`/`.stf`/etc. click handlers exactly as they are. `git add` only `src/ui/season.js`.

- [ ] **Step 1: Add the teamviz import**

In `src/ui/season.js`, after the existing `import { TEAM_LOGO, TEAMS } from "../data.js";` line, add:
```js
import { teamColor, driverAvatar, driverCard } from "./teamviz.js";
```

- [ ] **Step 2: Restyle the Пилоты tab — the player's two drivers become cards (replace lines ~62-67)**

Find:
```js
  const driverRows = mine.map(([ab, d]) => row([
    `<b>${ab}</b>`, `${d.age} лет`, `ovr ${d.overall.toFixed(3)}`, `мораль ${Math.round(d.morale * 100)}%`,
    `${d.contractSeasons} сез.`, `${m$(d.salary)}/гонка`,
    `<button class="ready resign" data-ab="${ab}" style="padding:3px 8px;font-size:12px">Продлить</button>`,
  ])).join("");
  const driversPanel = mine.length ? `<div class="panel"><p class="label">Пилоты</p><table style="width:100%;border-collapse:collapse"><tbody>${driverRows}</tbody></table></div>` : "";
```
Replace with:
```js
  const driverCards = mine.map(([ab, d]) => driverCard(
    { team: myTeamName, abbrev: ab, name: DRIVER_NAME[ab] || ab },
    { car: true,
      sub: `${d.age} лет · ovr ${d.overall.toFixed(3)} · мораль ${Math.round(d.morale * 100)}% · ${d.contractSeasons} сез. · ${m$(d.salary)}/гонка`,
      action: `<div style="margin-top:6px"><button class="ready resign" data-ab="${ab}" style="padding:3px 8px;font-size:12px">Продлить</button></div>` }
  )).join("");
  const driversPanel = mine.length ? `<div class="panel"><p class="label">Пилоты</p><div style="display:flex;flex-direction:column;gap:8px">${driverCards}</div></div>` : "";
```
(The `.resign` button keeps its `data-ab` so the existing click handler is unaffected. `DRIVER_NAME` and `myTeamName` are already in scope.)

- [ ] **Step 3: Add avatars + team colour to the Зачёт standings tables (replace lines ~28-29)**

Find:
```js
  const consTbl = cons.map(r => row([r.pos, `<img src="assets/teams/${TEAM_LOGO[r.team]}.png" style="height:16px;vertical-align:middle;margin-right:6px">${r.team}`, r.pts], r.isPlayer)).join("");
  const drvTbl = drv.map(r => row([r.pos, r.abbrev, r.team, r.pts])).join("");
```
Replace with:
```js
  const consTbl = cons.map(r => row([r.pos,
    `<span style="display:inline-block;width:3px;height:14px;background:${teamColor(r.team)};border-radius:2px;vertical-align:middle;margin-right:7px"></span>`
    + `<img src="assets/teams/${TEAM_LOGO[r.team]}.png" style="height:16px;vertical-align:middle;margin-right:6px">${r.team}`, r.pts], r.isPlayer)).join("");
  const drvTbl = drv.map(r => row([r.pos,
    `${driverAvatar(r.abbrev, r.team, 22)} <b style="vertical-align:middle">${r.abbrev}</b>`, r.team, r.pts])).join("");
```

- [ ] **Step 4: Verify — full suite, syntax, module load**

Run (from `ApexWeb/`):
```bash
node --check src/ui/season.js && node -e "import('./src/ui/season.js').then(()=>console.log('LOAD-OK'))" && node --test
```
Expected: no `--check` output; `LOAD-OK`; and the suite still reports `# fail 0` (count is 311 + the teamviz tests from Tasks 2-3).

- [ ] **Step 5: Commit (explicit pathspec — season.js only)**

```bash
git add src/ui/season.js
git commit -m "feat(apexweb): paddock — team-coloured driver cards (Пилоты) + avatars in standings (Зачёт)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Race leaderboard — team-colour accent + DRY the logo through teamviz

**Files:**
- Modify: `src/ui/race.js` (the `logo` helper at line ~20; the `board()` row at lines ~349-368)

- [ ] **Step 1: Import teamviz helpers**

In `src/ui/race.js`, the existing top import is `import { TRACK, TRACK_PATH, DRIVER_INFO } from "../data.js";`. Immediately after it add:
```js
import { teamColor, teamLogoSrc } from "./teamviz.js";
```

- [ ] **Step 2: Route the `logo` helper through teamviz (single source of truth for the path)**

Find (line ~20):
```js
const logo = (a, s = 18) => { const l = DRIVER_INFO[a] && DRIVER_INFO[a].logo; return l ? `<img src="assets/teams/${l}.png" alt="" style="height:${s}px;width:${s}px;object-fit:contain;vertical-align:middle;margin-right:6px">` : ""; };
```
Replace with:
```js
const logo = (a, s = 18) => { const info = DRIVER_INFO[a]; return info ? `<img src="${teamLogoSrc(info.team)}" alt="" style="height:${s}px;width:${s}px;object-fit:contain;vertical-align:middle;margin-right:6px">` : ""; };
```
(`teamLogoSrc(info.team)` resolves to the same `assets/teams/<slug>.png`; the keep-alive `tyreIcon` in this file is left as-is.)

- [ ] **Step 3: Add the team-colour left accent to each leaderboard row**

In `board()` (lines ~349-368), find the row template opening:
```js
    return `<tr style="${bg};border-top:1px solid var(--border)">
```
Replace with:
```js
    const accent = teamColor((DRIVER_INFO[c.abbrev] || {}).team);
    return `<tr style="${bg};border-top:1px solid var(--border);border-left:3px solid ${accent}">
```
(The `border-left` paints the team colour down the timing tower; `bg` keeps the player/teammate highlight.)

- [ ] **Step 4: Verify — syntax, module load, suite**

Run:
```bash
node --check src/ui/race.js && node -e "import('./src/ui/race.js').then(()=>console.log('LOAD-OK'))" && node --test
```
Expected: no `--check` output; `LOAD-OK`; `# fail 0`.

- [ ] **Step 5: Commit (explicit pathspec — race.js only)**

```bash
git add src/ui/race.js
git commit -m "feat(apexweb): race leaderboard team-colour accent + logo via teamviz" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Lobby — team picker with car render + team-colour card

**Files:**
- Modify: `src/ui/lobby.js`

- [ ] **Step 1: Import teamviz helpers**

In `src/ui/lobby.js`, change the data import line:
```js
import { TEAMS, TEAM_LOGO, DIFFICULTY } from "../data.js";
```
to keep it, and add below it:
```js
import { teamColor, teamInk, carImgSrc } from "./teamviz.js";
```

- [ ] **Step 2: Build a team card (logo + name + car render) and a small helper to refresh it**

Find:
```js
const logoSrc = i => `assets/teams/${TEAM_LOGO[TEAMS[i].name]}.png`;
```
Replace with:
```js
const logoSrc = i => `assets/teams/${TEAM_LOGO[TEAMS[i].name]}.png`;
const teamCard = i => {
  const t = TEAMS[i], col = teamColor(t.name), ink = teamInk(col);
  return `<div style="position:relative;overflow:hidden;background:var(--content2);border-left:5px solid ${col};border-radius:var(--r-md);padding:12px;min-height:84px;display:flex;align-items:center;gap:12px">
      <img src="${logoSrc(i)}" alt="" style="height:46px;width:46px;object-fit:contain">
      <div style="z-index:1"><div style="font-weight:800;font-size:18px">${t.name}</div>
        <span style="font-size:11px;color:${ink};background:${col};border-radius:4px;padding:1px 6px">${t.drivers[0].abbrev} · ${t.drivers[1].abbrev}</span></div>
      <img src="${carImgSrc(t.name)}" alt="" onerror="this.style.display='none'" style="position:absolute;right:0;bottom:0;height:74px;object-fit:contain;opacity:.95;pointer-events:none">
    </div>`;
};
```

- [ ] **Step 3: Render the card above the `<select>` and refresh it on change**

Find:
```js
      <p class="label">Команда</p>
      <div style="display:flex;align-items:center;gap:10px">
        <img id="teamlogo" src="${logoSrc(ctx.teamIdx)}" alt="" style="height:52px;width:52px;object-fit:contain">
        <select id="team" style="flex:1;padding:8px">${teamOpts}</select>
      </div>
```
Replace with:
```js
      <p class="label">Команда</p>
      <div id="teamcard">${teamCard(ctx.teamIdx)}</div>
      <div style="height:8px"></div>
      <select id="team" style="width:100%;padding:8px">${teamOpts}</select>
```
Then find the team `onchange` handler:
```js
  root.querySelector("#team").onchange = e => {
    ctx.teamIdx = +e.target.value;
    root.querySelector("#teamlogo").src = logoSrc(ctx.teamIdx);
  };
```
Replace with:
```js
  root.querySelector("#team").onchange = e => {
    ctx.teamIdx = +e.target.value;
    root.querySelector("#teamcard").innerHTML = teamCard(ctx.teamIdx);
  };
```
(The old `#teamlogo` img is gone, replaced by `#teamcard`; the `#host`/`#solo`/`#join` handlers are untouched.)

- [ ] **Step 4: Verify — syntax, module load, suite**

`lobby.js` imports `main.js`, which pulls much of the app — a bare `import()` can be heavy but should resolve. Run:
```bash
node --check src/ui/lobby.js && node --test
```
Expected: no `--check` output; `# fail 0`. (Module-load of lobby is exercised at F5; `node --check` covers syntax here.)

- [ ] **Step 5: Commit (explicit pathspec — lobby.js only)**

```bash
git add src/ui/lobby.js
git commit -m "feat(apexweb): lobby team picker — team-colour card with logo + car render" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Quali — single-source the tower swatch + accent the player's live-lap card

**Files:**
- Modify: `src/ui/quali.js` (the tower row swatch at lines ~87-92; the player `q-card` at line ~150)

**Note (practice.js, intentionally untouched):** `practice.js` renders the setup widget + clock and shows no driver/team identity row, so per the spec ("rows/cards that show drivers") there is nothing to accent there. No edit this pass.

- [ ] **Step 1: Import teamColor**

In `src/ui/quali.js`, the existing import is `import { DRIVER_INFO, QUALI2 } from "../data.js";`. After it add:
```js
import { teamColor } from "./teamviz.js";
```

- [ ] **Step 2: Single-source the tower swatch colour through teamviz**

Find (line ~87):
```js
    const col = DRIVER_INFO[row.abbrev] && DRIVER_INFO[row.abbrev].color;
```
Replace with:
```js
    const info = DRIVER_INFO[row.abbrev];
    const col = info ? teamColor(info.team) : null;
```
(The swatch markup `<i class="q-team" style="background:${col}">` at line ~92 is unchanged — it now sources the colour from teamviz, the single source of truth.)

- [ ] **Step 3: Accent the player's live-lap card with the team colour**

Find the player card open (line ~150):
```js
      <div class="panel q-card">
```
Replace with:
```js
      <div class="panel q-card" style="border-left:4px solid ${(me && DRIVER_INFO[me.abbrev]) ? teamColor(DRIVER_INFO[me.abbrev].team) : "var(--border)"}">
```
(`me` is the player's car in scope where `q-card` is built; if its abbrev is unknown the accent degrades to the default border colour.)

- [ ] **Step 4: Verify the player car carries `abbrev` in this scope**

Run (from `ApexWeb/`): `grep -n "me\.abbrev\|me = \|const me" src/ui/quali.js | head`
Expected: a `me` binding (the player's car) exists where `q-card` is rendered. If `me.abbrev` is not present on the car object, fall back to `me.player`'s team is not available — in that case keep the accent expression but it will use the default border (still valid). Then run:
```bash
node --check src/ui/quali.js && node --test
```
Expected: no `--check` output; `# fail 0`.

- [ ] **Step 5: Commit (explicit pathspec — quali.js only)**

```bash
git add src/ui/quali.js
git commit -m "feat(apexweb): quali — tower swatch via teamviz + team-colour accent on the live-lap card" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: README + final verification

**Files:**
- Modify: `README.md` (the ApexWeb feature list / test count)

- [ ] **Step 1: Run the full suite and capture the exact test count**

Run (from `ApexWeb/`): `node --test 2>&1 | tail -4`
Expected: `# fail 0`. Note the `# tests N` number (311 + the teamviz tests added in Tasks 2-3, ~314-315).

- [ ] **Step 2: Syntax-check every file this plan touched**

Run:
```bash
for f in src/ui/teamviz.js src/ui/season.js src/ui/race.js src/ui/lobby.js src/ui/quali.js; do node --check "$f" && echo "OK $f"; done
```
Expected: `OK` for all five.

- [ ] **Step 3: Update the README**

In `README.md`, find the ApexWeb feature/test-count line (the nav-shell commit set it to "test count 311"; search for `311`). Update that number to the count from Step 1, and add a one-line bullet to the feature list:
```
- **Team visuals**: a shared `ui/teamviz.js` layer — team colours, real driver photos (`assets/drivers/`), car renders (`assets/cars/`), logos, tyre icons and verified 2026 driver numbers — applied across paddock cards, the race leaderboard, the lobby team picker and qualifying.
```

- [ ] **Step 4: Commit (explicit pathspec — README only)**

```bash
git add README.md
git commit -m "docs(apexweb): README — team-visual layer + test count" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 5: Final scope check (no owner WIP swept in)**

Run: `git log --oneline -8 --stat | head -40`
Expected: each of the 7 feature/doc commits touches only its named pathspec(s) — `assets/{drivers,cars}`, `src/ui/teamviz.js`, `tests/teamviz.test.js`, `src/ui/season.js`, `src/ui/race.js`, `src/ui/lobby.js`, `src/ui/quali.js`, `README.md`. No `main.js`, `data.js`, `sim.js`, Godot, or `experiments/` files appear. Do NOT push (owner pushes on explicit request).

---

## Self-Review

**1. Spec coverage:**
- Asset organisation (`git mv` into folders) → Task 1. ✓
- `ui/teamviz.js` pure helpers (`teamColor`/`teamInk`/`DRIVER_NUM`/`teamLogoSrc`/`carImgSrc`/`tyreIcon`) → Task 2. ✓
- `driverAvatar` (photo-over-colour-block) + `driverCard` → Task 3. ✓
- Paddock Зачёт + Пилоты team-coloured cards w/ photo + car render → Task 4. ✓
- Race leaderboard team-colour accent → Task 5. ✓
- Lobby team picker with car render → Task 6. ✓
- Quali lighter accent → Task 7. ✓ (Practice: spec scopes to "cards that show drivers"; practice shows none → explicitly no-op, documented.)
- Tests: `tests/teamviz.test.js` pure + existsSync presence → Tasks 2-3; full suite stays green → Tasks 4-8. ✓
- SVG silhouette dropped → not built. ✓

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N" — every code step shows the full before/after. Task 7 Step 4 includes a real grep verification rather than an assumption about `me.abbrev`, with a defined fallback. ✓

**3. Type consistency:** `driverCard(d, opts)` takes `d = {team, abbrev, name}` everywhere it's called (Task 4 constructs exactly that). `driverAvatar(abbrev, team, size)` argument order matches all call sites (Tasks 3, 4). `teamColor(team)` is always passed a team NAME (callers resolve `DRIVER_INFO[abbrev].team` first: Tasks 5, 7). `teamLogoSrc`/`carImgSrc` take a team name (Tasks 5, 6). Helper names are identical across the module and all consumers. ✓
