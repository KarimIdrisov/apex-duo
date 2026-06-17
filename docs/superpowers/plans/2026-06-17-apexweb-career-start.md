# ApexWeb career start (co-directors + pre-season) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a career start flow — create two co-directors (each with a specialty that buffs a team area + the race) and a pre-season setup (build the car under budget, pick a title sponsor, set season ambition) — before round 0.

**Architecture:** Two new pure modules (`directors.js`, `preseason.js`) provide thin multiplier helpers + budget/ambition math, consulted by existing systems. `career.js` gains `directors` + `rewardMult` and a schema bump (26→27). Two new in-code UI screens slot between the lobby and the first weekend. Specialty effects flow only through existing scalar hooks (parts, money, morale, pit crew, PU wear) — never a flat bonus on the sim.

**Tech stack:** vanilla ESM JS, `node --test`, existing `development.js`/`career.js`/`pitcrew.js`/`sponsors.js`.

**Source of truth:** `docs/superpowers/specs/2026-06-17-apexweb-career-start-codirectors-design.md`.

**Owner-WIP guard:** the working tree holds the owner's uncommitted WIP. Execute in an isolated git worktree (superpowers:using-git-worktrees) OR commit with **explicit pathspecs** (the files named in each task) — never `git add -A`. Run tests from `ApexWeb/`.

**Fast test command** (skips the slow race suites): from `ApexWeb/`:
`node --test "tests/!(sim|sim_edited_track|quali_session|practice_session|ai_strategy).test.js"`

---

## File structure

| File | Responsibility |
|---|---|
| `ApexWeb/src/directors.js` (new) | the 6 specialties + pure multiplier helpers + solo-assistant weight + validation |
| `ApexWeb/src/preseason.js` (new) | car-build budget math (reuses `development.js` parts), season ambition, default auto-build |
| `ApexWeb/src/career.js` (modify) | `directors`+`rewardMult` on the career; `CAREER_V` 26→27 + migrate; prize × rewardMult; specialty hooks |
| `ApexWeb/src/development.js` (modify) | in-season dev gain consults the aero/engine specialty |
| `ApexWeb/src/ui/director_create.js` (new) | co-director creation screen (name + specialty, co-op + solo) |
| `ApexWeb/src/ui/preseason.js` (new) | pre-season setup screen (build / sponsor / ambition) |
| `ApexWeb/src/main.js` + `ui/lobby.js` (modify) | wire the two screens into the career start; co-op sync |
| `ApexWeb/tests/directors.test.js` (new) | directors.js |
| `ApexWeb/tests/preseason.test.js` (new) | preseason.js |
| `ApexWeb/tests/career.test.js` (modify) | v26→v27 migrate, newCareer fields, prize × rewardMult |

Phases 1–3 are pure logic (fully TDD-tested here). Phase 4 (UI) and the race-side specialty hooks (Phase 5) are owner-F5-verified — the sandbox can't run a browser or judge race feel; those tasks give exact structure + manual checks.

---

## Phase 1 — Co-director specialty system (`directors.js`)

### Task 1: directors.js — specialties + multiplier helpers

**Files:**
- Create: `ApexWeb/src/directors.js`
- Test: `ApexWeb/tests/directors.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { SPECIALTIES, SPECIALTY_KEYS, specialtyWeight, devCostMult, devGainMult,
  puWearMult, sponsorIncomeMult, startBudgetMult, driverDevMult, botchMult, validDirectors } from "../src/directors.js";

const coop = (a, b) => ({ teamIdx: 0, coop: true, directors: [{ player: "p1", specialty: a }, { player: "p2", specialty: b }] });
const solo = (s, asst) => ({ teamIdx: 0, coop: false, directors: [{ player: "p1", specialty: s, assistant: asst }] });

test("six specialties exist with keys", () => {
  assert.equal(SPECIALTY_KEYS.length, 6);
  for (const k of ["aero", "engine", "strategist", "mechanic", "financier", "mentor"]) assert.ok(SPECIALTIES[k], `${k} missing`);
});

test("specialtyWeight: primary = 1, solo assistant = 0.5, absent = 0", () => {
  const c = coop("aero", "engine");
  assert.equal(specialtyWeight(c, "aero"), 1);
  assert.equal(specialtyWeight(c, "mentor"), 0);
  assert.equal(specialtyWeight(solo("strategist", "mentor"), "mentor"), 0.5);
});

test("dev multipliers: an aero specialist makes aero cheaper + higher-gain; power untouched", () => {
  const c = coop("aero", "engine");
  assert.ok(devCostMult(c, "aero") < 1 && devGainMult(c, "aero") > 1);
  assert.ok(devCostMult(c, "power") < 1, "engine specialist discounts power");
  assert.equal(devCostMult(c, "tyre"), 1, "no specialist for tyre");
});

test("financier/mentor/mechanic/engine scalar helpers move the right lever", () => {
  assert.ok(sponsorIncomeMult(coop("financier", "aero")) > 1);
  assert.ok(startBudgetMult(coop("financier", "aero")) > 1);
  assert.ok(driverDevMult(coop("mentor", "aero")) > 1);
  assert.ok(botchMult(coop("mechanic", "aero")) < 1);
  assert.ok(puWearMult(coop("engine", "aero")) < 1);
  assert.equal(sponsorIncomeMult(coop("aero", "engine")), 1, "no financier → neutral");
});

test("validDirectors: co-op needs two different specialties; solo needs one valid", () => {
  assert.equal(validDirectors([{ specialty: "aero" }, { specialty: "engine" }], true), true);
  assert.equal(validDirectors([{ specialty: "aero" }, { specialty: "aero" }], true), false);
  assert.equal(validDirectors([{ specialty: "nope" }], false), false);
  assert.equal(validDirectors([{ specialty: "aero" }], false), true);
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `node --test tests/directors.test.js`
Expected: FAIL — `Cannot find module '../src/directors.js'`.

- [ ] **Step 3: Implement `directors.js`**

```js
// ApexWeb/src/directors.js — co-director specialty system. Pure & deterministic. Each player's
// director has a specialty that buffs a team area (meta) and, for some, the race. Existing systems
// consult these thin multiplier helpers; no new sim-influence path is introduced.

export const SPECIALTIES = {
  aero:       { key: "aero",       label: "Аэродинамик", area: "aero",  race: false, blurb: "разработка аэро дешевле и эффективнее" },
  engine:     { key: "engine",     label: "Моторист",    area: "power", race: true,  blurb: "развитие ДВС дешевле, мягче износ, больше от ERS" },
  strategist: { key: "strategist", label: "Стратег",     area: null,    race: true,  blurb: "точнее окна пита и прогноз; лучше пит-колы в гонке" },
  mechanic:   { key: "mechanic",   label: "Гл. механик", area: null,    race: false, blurb: "крепче пит-крю, меньше брака на пит-стопе" },
  financier:  { key: "financier",  label: "Финансист",   area: null,    race: false, blurb: "больше стартовый бюджет и доход спонсоров" },
  mentor:     { key: "mentor",     label: "Наставник",   area: null,    race: true,  blurb: "пилоты растут быстрее, мягче падение морали" },
};
export const SPECIALTY_KEYS = Object.keys(SPECIALTIES);

// tuning knobs (spec §"Open tuning knobs"); start conservative, balance-check before raising.
export const DEV_DISCOUNT = 0.18, DEV_GAIN = 0.15, PU_WEAR_REDUCE = 0.15,
  SPONSOR_BONUS = 0.15, BUDGET_BONUS = 0.15, DRIVER_DEV_BONUS = 0.20, BOTCH_REDUCE = 0.15;

// weight of a specialty on the team: 1 if a primary director has it, 0.5 if only a solo assistant carries it.
export function specialtyWeight(career, key) {
  let w = 0;
  for (const d of (career && career.directors) || []) {
    if (d.specialty === key) w = Math.max(w, 1);
    if (d.assistant === key) w = Math.max(w, 0.5);
  }
  return w;
}

const areaOf = key => SPECIALTIES[key] && SPECIALTIES[key].area;
function areaWeight(career, areaKey) {                       // weight of whichever specialty owns this area
  for (const k of SPECIALTY_KEYS) if (areaOf(k) === areaKey) return specialtyWeight(career, k);
  return 0;
}

export function devCostMult(career, areaKey) { return 1 - DEV_DISCOUNT * areaWeight(career, areaKey); }
export function devGainMult(career, areaKey) { return 1 + DEV_GAIN * areaWeight(career, areaKey); }
export function puWearMult(career)       { return 1 - PU_WEAR_REDUCE * specialtyWeight(career, "engine"); }
export function sponsorIncomeMult(career){ return 1 + SPONSOR_BONUS * specialtyWeight(career, "financier"); }
export function startBudgetMult(career)  { return 1 + BUDGET_BONUS * specialtyWeight(career, "financier"); }
export function driverDevMult(career)    { return 1 + DRIVER_DEV_BONUS * specialtyWeight(career, "mentor"); }
export function botchMult(career)        { return 1 - BOTCH_REDUCE * specialtyWeight(career, "mechanic"); }

// co-op: two primary directors with different valid specialties; solo: one valid specialty.
export function validDirectors(directors, coop) {
  if (!Array.isArray(directors) || !directors.length) return false;
  for (const d of directors) if (!SPECIALTIES[d.specialty]) return false;
  if (coop) { if (directors.length < 2) return false; if (directors[0].specialty === directors[1].specialty) return false; }
  return true;
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --test tests/directors.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/directors.js ApexWeb/tests/directors.test.js
git commit -m "feat(apexweb): co-director specialty system (directors.js)"
```

---

## Phase 2 — Pre-season setup math (`preseason.js`)

### Task 2: preseason.js — car build + ambition

**Files:**
- Create: `ApexWeb/src/preseason.js`
- Test: `ApexWeb/tests/preseason.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILD_STEP_GAIN, stepCost, buildStep, AMBITIONS, applyAmbition, autoBuild } from "../src/preseason.js";

function career(over = {}) {
  return { teamIdx: 0, _myTeamName: "McLaren", money: 11000, parts: {}, projects: [], board: { targetPos: 1 }, directors: [], ...over };
}

test("stepCost is positive, rises with invested level, and an aero specialist pays less", () => {
  const c = career();
  const c0 = stepCost(c, "aero");
  assert.ok(c0 > 0);
  buildStep(c, "aero");
  assert.ok(stepCost(c, "aero") > c0, "diminishing returns: next step costs more");
  const withSpec = career({ directors: [{ specialty: "aero" }, { specialty: "engine" }] });
  assert.ok(stepCost(withSpec, "aero") < stepCost(career(), "aero"), "aero specialist discount");
});

test("buildStep spends money and raises a part; fails when broke", () => {
  const c = career();
  const before = c.money;
  assert.equal(buildStep(c, "aero"), true);
  assert.ok(c.money < before, "money spent");
  const tn = c._myTeamName;
  const raised = Object.values(c.parts[tn]).some(v => v >= BUILD_STEP_GAIN);
  assert.ok(raised, "a part level went up by the step gain");
  assert.equal(buildStep(career({ money: 0 }), "aero"), false, "can't afford → false");
});

test("applyAmbition sets board.targetPos from tier+offset and a rewardMult", () => {
  assert.equal(applyAmbition(career({ teamIdx: 4 }), "realistic"), 5, "tier 5 → P5");
  const amb = career({ teamIdx: 4 });
  applyAmbition(amb, "ambitious");
  assert.equal(amb.board.targetPos, 3, "ambitious = tier − 2");
  assert.equal(amb.rewardMult, AMBITIONS.ambitious.reward);
  const mod = career({ teamIdx: 0 });
  applyAmbition(mod, "modest");
  assert.equal(mod.board.targetPos, 3, "tier 1 + 2 = P3");
});

test("autoBuild spends most of the budget without overspending", () => {
  const c = career({ money: 9000 });
  autoBuild(c);
  assert.ok(c.money >= 0, "never overspends");
  assert.ok(c.money < 9000, "actually built something");
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `node --test tests/preseason.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `preseason.js`**

```js
// ApexWeb/src/preseason.js — pre-season setup math: car build (budget → part levels, reusing the
// development.js part model), season ambition (board target + reward multiplier), and a default
// auto-build. Pure & deterministic. The title-sponsor pick reuses career.chooseTitleSponsor as-is.
import { DEV_AREAS, bestPartForArea } from "./development.js";
import { devCostMult } from "./directors.js";
import { TEAMS } from "./data.js";

export const BUILD_STEP_GAIN = 0.04;     // part-level gained per build step
export const BUILD_STEP_BASE = 1200;     // $k base cost of a step (pre discount / maturity)

function teamName(career) { return (career && career._myTeamName) || TEAMS[(career && career.teamIdx) || 0].name; }
function partForArea(career, areaKey) {
  const a = DEV_AREAS.find(x => x.key === areaKey);            // DEV_AREAS: key === indicator
  return a ? bestPartForArea(career, a.indicator) : null;
}

// cost of the next build step in an area: base × maturity (rises with level) × specialty discount.
export function stepCost(career, areaKey) {
  const part = partForArea(career, areaKey); if (!part) return Infinity;
  const lvl = ((career.parts && career.parts[teamName(career)]) || {})[part] || 0;
  return Math.round(BUILD_STEP_BASE * (1 + lvl * 4) * devCostMult(career, areaKey));
}

// buy one build step in an area: spend, raise that area's best part by BUILD_STEP_GAIN. false if broke.
export function buildStep(career, areaKey) {
  const cost = stepCost(career, areaKey), part = partForArea(career, areaKey);
  if (!part || career.money < cost) return false;
  const tn = teamName(career);
  career.parts = career.parts || {}; career.parts[tn] = career.parts[tn] || {};
  career.parts[tn][part] = (career.parts[tn][part] || 0) + BUILD_STEP_GAIN;
  career.money -= cost;
  return true;
}

// season ambition → board target (tier ± offset) + a reward multiplier (scales the season prize fund).
export const AMBITIONS = {
  modest:    { key: "modest",    label: "Скромная",     offset: +2, reward: 0.8 },
  realistic: { key: "realistic", label: "Реалистичная", offset: 0,  reward: 1.0 },
  ambitious: { key: "ambitious", label: "Амбициозная",  offset: -2, reward: 1.3 },
};
export function applyAmbition(career, key) {
  const a = AMBITIONS[key] || AMBITIONS.realistic, tier = (career.teamIdx || 0) + 1;
  career.board = career.board || {};
  career.board.targetPos = Math.max(1, Math.min(TEAMS.length, tier + a.offset));
  career.rewardMult = a.reward;
  return career.board.targetPos;
}

// the "skip" default: spread the budget across areas in round-robin until the cheapest step is unaffordable.
export function autoBuild(career) {
  const areas = DEV_AREAS.map(a => a.key);
  let guard = 0;
  while (guard++ < 1000) {
    const affordable = areas.filter(a => career.money >= stepCost(career, a));
    if (!affordable.length) break;
    affordable.sort((x, y) => stepCost(career, x) - stepCost(career, y));
    buildStep(career, affordable[0]);
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --test tests/preseason.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/preseason.js ApexWeb/tests/preseason.test.js
git commit -m "feat(apexweb): pre-season car-build + ambition math (preseason.js)"
```

---

## Phase 3 — career.js integration + schema bump

### Task 3: newCareer fields + CAREER_V 26→27 + migrate + prize × rewardMult

**Files:**
- Modify: `ApexWeb/src/career.js` (`CAREER_V`, `newCareer`, `migrate`, `advanceRound` prize)
- Test: `ApexWeb/tests/career.test.js` (append)

- [ ] **Step 1: Write the failing tests** (append to `tests/career.test.js`)

```js
// --- career start: co-directors + ambition reward (v27) ---
import { newSeason as _ns } from "../src/career.js";   // (already imported above; keep one import)

test("newCareer carries directors[] + rewardMult and bumps to v27", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  assert.equal(c.v, CAREER_V);
  assert.ok(c.v >= 27);
  assert.deepEqual(c.directors, []);
  assert.equal(c.rewardMult, 1);
});

test("migrate v26 → v27 backfills directors + rewardMult", () => {
  const v26 = { v: 26, teamIdx: 0, seed: 1, board: { targetPos: 1 }, driverPts: {}, teamPts: {} };
  const up = migrate(v26);
  assert.equal(up.v, CAREER_V);
  assert.deepEqual(up.directors, []);
  assert.equal(up.rewardMult, 1);
});

test("an ambitious season multiplies the end-of-season constructor prize", () => {
  const base = newCareer({ teamIdx: 0, seed: 1 });
  const amb = newCareer({ teamIdx: 0, seed: 1 }); amb.rewardMult = 1.3;
  let g = 0; while (!isSeasonOver(base) && g++ < 100) { advanceRound(base); }
  g = 0; while (!isSeasonOver(amb) && g++ < 100) { advanceRound(amb); }
  assert.ok(amb.seasonPayout.fund > base.seasonPayout.fund, "rewardMult scales the prize fund");
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run (from `ApexWeb/`): `node --test tests/career.test.js`
Expected: FAIL — `c.directors` is `undefined`; `up.v` is 26 not 27; prize funds equal.

- [ ] **Step 3: Edit `career.js`**

3a. Bump the version constant:
```js
export const CAREER_V = 27;           // career save schema version
```

3b. In `newCareer`'s returned object, add two fields (next to `parts: {}, projects: []`):
```js
    directors: [], rewardMult: 1,      // career-start: co-directors + season-ambition reward scaler
```

3c. Add a migrate step at the end of the `migrate` ladder (immediately after the `if (career.v < 26)` block closes, before the trailing `DRIVER_NAME`/`ensureRivals` lines):
```js
  if (career.v < 27) {                 // career-start: co-directors + ambition reward
    career.directors = career.directors || [];
    career.rewardMult = career.rewardMult ?? 1;
    career.v = 27;
  }
```

3d. In `advanceRound`, at the season-end prize, scale by `rewardMult`. Change:
```js
    const fund = constructorPrizeFund(pos);
```
to:
```js
    const fund = Math.round(constructorPrizeFund(pos) * (career.rewardMult || 1));
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `node --test tests/career.test.js`
Expected: PASS (incl. the 3 new tests). Then run the fast subset to confirm no regression:
`node --test "tests/!(sim|sim_edited_track|quali_session|practice_session|ai_strategy).test.js"` → 0 fail.

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/career.js ApexWeb/tests/career.test.js
git commit -m "feat(apexweb): career schema v27 — directors + ambition reward"
```

### Task 4: meta specialty hooks (budget, sponsor income, driver dev, in-season aero/engine dev)

**Files:**
- Modify: `ApexWeb/src/career.js` (newCareer budget; applyResult sponsor income), `ApexWeb/src/development.js` (dev gain)
- Test: `ApexWeb/tests/directors.test.js` (append integration asserts)

- [ ] **Step 1: Write the failing test** (append to `tests/directors.test.js`)

```js
import { newCareer, applyResult } from "../src/career.js";
import { tickDevelopment, startProject } from "../src/development.js";
import { TEAMS } from "../src/data.js";

test("financier raises the starting budget", () => {
  const plain = newCareer({ teamIdx: 0, seed: 1 });
  const fin = newCareer({ teamIdx: 0, seed: 1, directors: [{ specialty: "financier" }, { specialty: "aero" }] });
  assert.ok(fin.money > plain.money, "financier director starts richer");
});

test("an aero specialist develops aero parts faster in-season", () => {
  const mk = dirs => { const c = newCareer({ teamIdx: 0, seed: 1, directors: dirs }); startProject(c, "floor", "small"); tickDevelopment(c, 14); return c.parts[TEAMS[0].name].floor; };
  const plain = mk([]);
  const aero = mk([{ specialty: "aero" }, { specialty: "engine" }]);
  assert.ok(aero > plain, "aero specialist → bigger floor (aero) gain");
});
```

- [ ] **Step 2: Run, verify it fails** — `node --test tests/directors.test.js` → the new asserts fail (budgets equal; gains equal).

- [ ] **Step 3: Edit `career.js` + `development.js`**

3a. `career.js` — `newCareer` must accept `directors` and apply the budget multiplier. Add `directors = []` to the destructured params, set `directors` from it, and scale money. Change the signature + money line:
```js
export function newCareer({ teamIdx = 0, seed = 1, coop = false, directors = [] } = {}) {
```
Set the field to the passed value (replace `directors: [],` from Task 3 with):
```js
    directors, rewardMult: 1,
```
And scale the starting money by the financier multiplier — import at top:
```js
import { sponsorIncomeMult, startBudgetMult } from "./directors.js";
```
then change the `money:` initialiser to multiply by `startBudgetMult({ directors })` (round to int):
```js
    money: Math.round((3000 + (TEAMS.length - teamIdx) * 800) * startBudgetMult({ directors })),
```

3b. `career.js` — `applyResult` sponsor income: scale the accumulated `sponsorIncome` by `sponsorIncomeMult(career)`. After the sponsor loop (the line `sponsorIncome += r.payout;` is inside it), apply once after the loop:
```js
  sponsorIncome = Math.round(sponsorIncome * sponsorIncomeMult(career));
```
(Place immediately after the `for (const sp of (career.sponsors || []))` loop closes.)

3c. `development.js` — in-season aero/engine dev gain. Import the helper at top:
```js
import { devGainMult } from "./directors.js";
```
In `tickDevelopment`, the player project gain is computed as `intended` (`const intended = p.gain * ap.gainK * ...`). Multiply it by the area's specialty bonus. The part's area = its dominant indicator; reuse the existing `PART_CONTRIB`. Add, right after `intended` is computed:
```js
    const areaKey = Object.keys(PART_CONTRIB[p.part] || {}).sort((a, b) => PART_CONTRIB[p.part][b] - PART_CONTRIB[p.part][a])[0];
    const dirGain = devGainMult(career, areaKey);
```
and use `intended * dirGain` wherever `intended` feeds `gain` (the line `let gain = intended, ...` → `let gain = intended * dirGain, ...`, and the miscorrelation branch `gain = intended - penalty;` → `gain = intended * dirGain - penalty;`).

- [ ] **Step 4: Run tests** — `node --test tests/directors.test.js` (PASS) then the fast subset (0 fail). Note: `development.test.js` test "devMult + academy scale the part gain" still holds (no directors → mult 1).

- [ ] **Step 5: Commit**

```bash
git add ApexWeb/src/career.js ApexWeb/src/development.js ApexWeb/tests/directors.test.js
git commit -m "feat(apexweb): meta specialty hooks (budget, sponsors, aero/engine dev)"
```

---

## Phase 4 — UI screens + flow wiring (owner-F5-verified)

These build the two new in-code screens and splice them into the career start. They are **not** unit-tested (ApexWeb UI is built in code and verified by the owner in-browser; the sandbox has no DOM). Each task lists the exact module, its export, what it renders, and a manual F5 checklist. Keep the visual language of `ui/lobby.js`/`ui/teamviz.js` (panels, team colours, `kit.js` if present).

### Task 5: `ui/director_create.js` — co-director creation screen

**Files:** Create `ApexWeb/src/ui/director_create.js`. Reference mockup: spec + the brainstorm widget `co_director_creation_screen`.

- [ ] **Step 1: Implement `render(root, ctx, onDone)`**
  - Reads `ctx.teamIdx`, `ctx.coop`. Renders one column per player (two in co-op, one + an "assistant" specialty picker in solo).
  - Each column: a name `<input>` and the six `SPECIALTIES` as selectable chips (import from `../directors.js`). The other player's pick is rendered disabled/locked (enforce `validDirectors`). Show the selected specialty's `blurb` (meta + race line).
  - On confirm (enabled only when `validDirectors(directors, ctx.coop)`): set `ctx.pendingDirectors = directors` and call `onDone()`.
  - Co-op: the two columns are filled by the two peers — P1 (host) and P2 (client) each edit their own column; mirror the other's selection read-only (see Task 7 for the sync wiring).

- [ ] **Step 2: Manual F5 check** — start a career (solo): screen appears after team select; pick a name + specialty; assistant picker shows; confirm advances. Co-op: each browser edits its own director, sees the other's locked, both-ready advances. No console errors.

- [ ] **Step 3: Commit** — `git add ApexWeb/src/ui/director_create.js && git commit -m "feat(apexweb): co-director creation screen"`

### Task 6: `ui/preseason.js` — pre-season setup screen

**Files:** Create `ApexWeb/src/ui/preseason.js`. Reference: widgets `preseason_budget_build` + `preseason_expanded_sections`.

- [ ] **Step 1: Implement `render(root, ctx, onDone)`** — three sections on one screen:
  - **Болид:** the 5 `DEV_AREAS` as rows, each with the current level (from `ctx.career.parts`), a `−/+` stepper calling `buildStep(ctx.career, areaKey)` (and an inverse for `−`), the `stepCost`, and a live "осталось бюджета" bar from `ctx.career.money`. A "пропустить (авто)" button calls `autoBuild`.
  - **Спонсоры:** list `ctx.career.pendingOffers` (title offers already on the career); selecting one calls `chooseTitleSponsor(ctx.career, idx)`.
  - **Цели:** the three `AMBITIONS` as options; selecting one calls `applyAmbition(ctx.career, key)`.
  - "Начать сезон" → `onDone()` (leftover `career.money` already reflects the build; nothing else to do — it carries as cash).
  - Imports: `buildStep, stepCost, AMBITIONS, applyAmbition, autoBuild` from `../preseason.js`, `DEV_AREAS` from `../development.js`, `chooseTitleSponsor` from `../career.js`.

- [ ] **Step 2: Manual F5 check** — budget bar decrements as you add parts; can't overspend (button disables at 0); auto fills a balanced build; sponsor + ambition selections persist; "начать сезон" enters round 0 with the built car (check the team's car indicators in the paddock differ from a zero build).

- [ ] **Step 3: Commit** — `git add ApexWeb/src/ui/preseason.js && git commit -m "feat(apexweb): pre-season setup screen (build + sponsor + ambition)"`

### Task 7: wire the screens into the start (`main.js`, `ui/lobby.js`) + co-op sync

**Files:** Modify `ApexWeb/src/main.js`, `ApexWeb/src/ui/lobby.js`.

- [ ] **Step 1: Solo path** — in `startCareerSolo(teamIdx)` (main.js), instead of dropping straight into the weekend, set a screen state to `director_create` → on done, `newCareer({ teamIdx, seed, coop:false, directors: ctx.pendingDirectors })` → `preseason` screen → on done, start round 0. Route the new screens through whatever screen-switch `main.js` already uses (follow the existing menu/lobby/season render dispatch).

- [ ] **Step 2: Co-op path** — `hostCareer`/the join handshake: after both peers connect, run `director_create` synced (each peer sends its `{name, specialty}` over the existing P2P/RPC channel; host validates "different", rejects a duplicate). Then the host runs the authoritative `preseason` screen as a joint decision (host holds `career`; broadcast the allocation/sponsor/ambition state to the client; both confirm). Host then begins round 0 and broadcasts the season snapshot as today.

- [ ] **Step 3: Manual F5 check** — full solo run (team → directors → pre-season → race) and full two-browser co-op run. No desync; the built car + sponsor + target are identical on host and client.

- [ ] **Step 4: Commit** — `git add ApexWeb/src/main.js ApexWeb/src/ui/lobby.js && git commit -m "feat(apexweb): wire co-director + pre-season into career start"`

---

## Phase 5 — Race-side specialty hooks + balance (owner-F5 + harness)

### Task 8: race-side hooks (engine ERS, mechanic botch, strategist/mentor)

**Files:** Modify `ApexWeb/src/career.js` (PU wear; pit-crew feed), and the race-build path that hands the player car/crew to the sim (`main.js` start-race, or wherever `buildField` composes the player car + `pitCrew`).

- [ ] **Step 1: Engine — softer PU wear.** In `career.js applyResult`, the PU wear line is `career.pu.wear = (career.pu.wear || 0) + puWearForRace(...)`. Multiply the added term by `puWearMult(career)` (import from `./directors.js`).
- [ ] **Step 2: Mechanic — fewer botches.** Where the player's `pitCrew` is composed for the race (`composePitCrew`), scale the resulting `botchChance`/`disasterChance` by `botchMult(career)` before handing to the sim. (Apply at the feed site, not inside `pitcrew.js`, so the pure crew math stays untouched.)
- [ ] **Step 3: Mentor — softer in-race morale drop.** Where `tickDriverRace`/`updateMorale` applies a negative morale delta to a player driver, attenuate the negative part by `(2 - driverDevMult(career))` (≈ ×0.8 with a mentor). Keep positive deltas unchanged.
- [ ] **Step 4: Strategist — better pit/SC reaction.** Lightest hook: if the player car uses the AI strategy assist (`ai_strategy.js`), nudge its pit-window decision quality with a strategist flag. If no clean hook exists yet, leave a `// TODO strategist race hook` and ship the other three — record it in the plan's "deferred" note rather than forcing a fragile change.
- [ ] **Step 5: Manual F5 + reasoning** — confirm an engine team gets more PU life, a mechanic team visibly botches less, a mentor team's drivers sulk less after a bad race. These are feel checks (F5), not unit tests.
- [ ] **Step 6: Commit** — explicit pathspecs for the files touched.

### Task 9: balance pass

- [ ] **Step 1:** Run the harness from `ApexWeb/`: `node tools/balance.mjs`. Capture the corridors.
- [ ] **Step 2:** Write a small probe (like the pit-crew `_botch2.mjs`) that builds a career with each specialty and confirms the magnitudes (budget +15%, sponsor income +15%, aero/engine dev delta, botch −15%) and that a full pre-season `autoBuild` yields a sane starting-car spread (not a runaway vs a zero build). Delete the probe after.
- [ ] **Step 3:** If any specialty visibly breaks a corridor (winners spread, DNF, pace spread), dial its knob in `directors.js` down and re-run. Record final magnitudes.
- [ ] **Step 4:** Full suite green: the fast subset (0 fail) and the heavy race suites (`node --test tests/sim.test.js …`).

---

## Self-review

**Spec coverage:**
- Co-director specialty system (6, meta + race, solo/co-op) → Tasks 1, 4, 8. ✓
- Pre-season car build under budget → Task 2 (math) + Task 6 (screen). ✓
- Title sponsor in pre-season → Task 6 (reuses `chooseTitleSponsor`). ✓
- Season ambition → Task 2 (`applyAmbition`) + Task 3 (prize × rewardMult) + Task 6 (screen). ✓
- Schema bump 26→27 + migrate (the invariant) → Task 3. ✓
- Two UI screens + co-op sync → Tasks 5–7. ✓
- Balance via harness → Task 9. ✓

**Placeholder scan:** the only deferred item is the strategist race hook (Task 8 Step 4), explicitly conditional with a fallback — not a silent TODO. Everything else has concrete code or an exact F5 checklist.

**Type/name consistency:** `directors.js` exports (`specialtyWeight`, `devCostMult`, `devGainMult`, `puWearMult`, `sponsorIncomeMult`, `startBudgetMult`, `driverDevMult`, `botchMult`, `validDirectors`, `SPECIALTIES`) are used consistently across Tasks 1/4/8. `preseason.js` exports (`stepCost`, `buildStep`, `AMBITIONS`, `applyAmbition`, `autoBuild`, `BUILD_STEP_GAIN`) match across Tasks 2/6. `career.rewardMult` set in Task 2/3 and read in Task 3's prize. `DEV_AREAS` key === indicator assumption is noted where used.

**Deferred (not in this plan):** reusing the pre-season screen as the per-season winter step; richer character identity (photos); strategist race hook if no clean assist seam exists.
