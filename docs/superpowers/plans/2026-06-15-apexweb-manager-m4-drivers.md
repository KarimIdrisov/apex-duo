# M4 — Drivers: Development, Morale & Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Drivers become living careers. Each has an age, an evolving `overall` (the old `skill`), a morale meter, and a contract. Age drives a per-season development curve (young grow, veterans decline); morale shifts with race results and feeds back into pace; contracts cost salary and can be re-signed. The player's two drivers are managed in the paddock.

**Architecture:** A pure `drivers.js` (ages, `initDrivers`, `developDrivers`, `updateMorale`, `moraleMod`, `salaryFor`, `reSign`). `career.js` v4 stores `career.drivers` (per-abbrev state), books salaries + updates morale in `applyResult`, and develops drivers at `newSeason`. `buildField` reads each driver's evolved `overall` → `driverAttrs`, and adds `moraleMod` to its `setupBonus` (centered on the 0.6 starting morale, so a fresh grid reproduces today's balance). `season.js` gains a drivers panel. Sim/quali/practice byte-unchanged.

**Tech Stack:** Vanilla JS ES modules, Node `node --test`, deterministic.

**Spec:** `docs/superpowers/specs/2026-06-15-apexweb-manager-career-design.md` (Phase M4). Builds on M1–M3.

---

## File Structure

```
ApexWeb/src/drivers.js         NEW — pure: DRIVER_AGE, initDrivers, developDrivers, updateMorale, moraleMod, salaryFor, reSign
ApexWeb/src/career.js          MODIFY — v4 (career.drivers), salaries+morale in applyResult, develop in newSeason, migrate, re-sign passthrough
ApexWeb/src/main.js            MODIFY — buildField uses driver overall/attrs + moraleMod; career_resign command
ApexWeb/src/ui/season.js       MODIFY — drivers panel (age/overall/morale/contract/salary + Продлить)
ApexWeb/tests/drivers.test.js  NEW
ApexWeb/tests/career.test.js   MODIFY — driver state + ledger-with-salaries + season development
ApexWeb/tools/career_balance.mjs   MODIFY — salaries are an expense; drivers develop across a season boundary
```

Explicit pathspecs; re-read main.js/season.js immediately before editing.

---

## Task 1: drivers.js — the driver career model (pure)

**Files:** Create `ApexWeb/src/drivers.js`; Test `ApexWeb/tests/drivers.test.js`.

- [ ] **Step 1: Failing test** — `ApexWeb/tests/drivers.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { TEAMS } from "../src/data.js";
import { DRIVER_AGE, initDrivers, developDrivers, updateMorale, moraleMod, salaryFor, reSign } from "../src/drivers.js";

test("initDrivers builds a record per grid driver with age/overall/morale/contract/salary", () => {
  const d = initDrivers();
  assert.equal(Object.keys(d).length, TEAMS.flatMap(t => t.drivers).length);
  const nor = d["NOR"];
  assert.equal(nor.age, DRIVER_AGE["NOR"]);
  assert.ok(nor.overall > 0.9 && nor.morale === 0.6 && nor.salary > 0 && nor.contractSeasons >= 1);
  assert.equal(nor.teamIdx, 0);
});

test("salaryFor rises steeply with overall (a star costs far more than a rookie)", () => {
  assert.ok(salaryFor(0.95) > salaryFor(0.80) * 2);
  assert.ok(salaryFor(0.72) > 0);
});

test("developDrivers ages everyone; the young improve, veterans decline, contracts tick", () => {
  const d = initDrivers();
  const youngBefore = d["ANT"].overall, vetBefore = d["ALO"].overall, cBefore = d["NOR"].contractSeasons;
  developDrivers(d);
  assert.equal(d["ANT"].age, DRIVER_AGE["ANT"] + 1);
  assert.ok(d["ANT"].overall > youngBefore, "a teenager develops");
  assert.ok(d["ALO"].overall < vetBefore, "a 44-year-old declines");
  assert.equal(d["NOR"].contractSeasons, cBefore - 1);
});

test("morale: beating the expected position lifts it, missing drops it; mod is centered on 0.6", () => {
  const dr = { morale: 0.6 };
  updateMorale(dr, 2, 5); assert.ok(dr.morale > 0.6);
  const dr2 = { morale: 0.6 };
  updateMorale(dr2, 12, 5); assert.ok(dr2.morale < 0.6);
  assert.equal(moraleMod(0.6), 0);                 // start morale = neutral pace
  assert.ok(moraleMod(1.0) > 0 && moraleMod(0.2) < 0);
});

test("reSign pays a fee, extends the contract, lifts morale; refused when broke", () => {
  const career = { money: 100000, drivers: initDrivers() };
  const ok = reSign(career, "NOR");
  assert.equal(ok, true);
  assert.ok(career.drivers["NOR"].contractSeasons >= 3 && career.money < 100000);
  assert.equal(reSign({ money: 1, drivers: initDrivers() }, "NOR"), false);
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test ApexWeb/tests/drivers.test.js` → FAIL (no module).

- [ ] **Step 3: Implement** — `ApexWeb/src/drivers.js`:

```js
// ApexWeb/src/drivers.js — pure driver career model: age, evolving overall, morale, contracts.
// All meta→sim influence flows through the driver's overall (-> driverAttrs) and moraleMod (-> setupBonus).
import { TEAMS } from "./data.js";

// approximate 2026 driver ages (abbrev -> age).
export const DRIVER_AGE = {
  NOR: 26, PIA: 25, ANT: 19, RUS: 28, VER: 28, HAD: 19, LEC: 28, HAM: 41, SAI: 31, ALB: 30,
  ALO: 44, STR: 27, GAS: 30, COL: 22, LAW: 24, LIN: 18, OCO: 29, BEA: 20, HUL: 38, BOR: 21, PER: 36, BOT: 36,
};

export const MORALE_PACE = 0.5;   // s/lap swing from morale extremes (centered on the 0.6 start)

const clampOverall = v => Math.max(0.50, Math.min(0.99, v));
const clamp01 = v => Math.max(0, Math.min(1, v));

// per-season overall drift by age: young grow toward a peak (~26), veterans decline.
function ageDrift(age) { return Math.max(-0.020, Math.min(0.020, (26 - age) * 0.0032)); }

// salary ($k/race) for a driver of this overall — stars cost far more than rookies.
export function salaryFor(overall) { return Math.round(120 + Math.pow(Math.max(0, overall - 0.7), 1.6) * 4200); }

// per-driver registry from the grid: abbrev -> {teamIdx, age, overall, morale, contractSeasons, salary}.
export function initDrivers() {
  const d = {};
  TEAMS.forEach((t, i) => t.drivers.forEach(dr => {
    const overall = dr.skill;
    d[dr.abbrev] = {
      teamIdx: i, age: DRIVER_AGE[dr.abbrev] ?? 28, overall, morale: 0.6,
      contractSeasons: dr.skill > 0.85 ? 3 : 2, salary: salaryFor(overall),
    };
  }));
  return d;
}

// advance all drivers one season: age up, drift overall by age, refresh salary, tick contracts.
export function developDrivers(drivers) {
  for (const a in drivers) {
    const dr = drivers[a];
    dr.age += 1;
    dr.overall = clampOverall(dr.overall + ageDrift(dr.age));
    dr.salary = salaryFor(dr.overall);
    dr.contractSeasons = Math.max(0, dr.contractSeasons - 1);
  }
}

// update morale from a race finish vs an expected position. Decays toward 0.6 so it never sticks
// at an extreme (steady over-performer ~0.9, under-performer ~0.3).
export function updateMorale(driver, finishPos, expectedPos) {
  const delta = finishPos <= expectedPos ? 0.03 : -0.03;
  driver.morale = clamp01(driver.morale * 0.90 + 0.6 * 0.10 + delta);
}

// morale -> pace modifier (s/lap, centered on the 0.6 start; positive = faster).
export function moraleMod(morale) { return ((morale ?? 0.6) - 0.6) * MORALE_PACE; }

// re-sign a player driver: pay a signing fee (~6 races of salary), reset contract, lift morale.
export function reSign(career, abbrev) {
  const dr = career.drivers && career.drivers[abbrev];
  if (!dr) return false;
  const fee = dr.salary * 6;
  if (career.money < fee) return false;
  career.money -= fee;
  dr.contractSeasons = 3;
  dr.morale = clamp01(dr.morale + 0.15);
  return true;
}
```

- [ ] **Step 4: Run to verify it passes** — `node --test ApexWeb/tests/drivers.test.js` → all pass.

- [ ] **Step 5: Commit** — `git add ApexWeb/src/drivers.js ApexWeb/tests/drivers.test.js` → `feat(apexweb): driver career model — age/overall/morale/contracts (M4)`.

---

## Task 2: career.js — v4 driver state, salaries, morale, season development

**Files:** Modify `ApexWeb/src/career.js`; Test `ApexWeb/tests/career.test.js`.

- [ ] **Step 1: Add failing tests** — append to `ApexWeb/tests/career.test.js`:

```js
import { reSign } from "../src/drivers.js";

test("newCareer at v4 carries a driver registry", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  assert.ok(c.v >= 4);
  assert.ok(c.drivers && c.drivers["NOR"] && c.drivers["NOR"].overall > 0.9);
});

test("applyResult books driver salaries as an expense + updates driver morale", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  const order = [...TEAMS[0].drivers.map(d => ({ abbrev: d.abbrev, team: "McLaren" })),
    ...TEAMS.flatMap((t, i) => i === 0 ? [] : t.drivers.map(d => ({ abbrev: d.abbrev, team: t.name })))];
  const sum = applyResult(c, order);
  assert.ok(sum.salaries > 0, "player driver salaries charged");
  assert.equal(sum.net, sum.prize + sum.sponsorIncome - sum.runningCost - sum.salaries);
  assert.ok(c.drivers["NOR"].morale > 0.6, "a P1 finish (beats expected) lifts morale");
});

test("newSeason develops drivers (a teenager improves) and carries the registry", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  const antBefore = c.drivers["ANT"].overall;
  const c2 = newSeason(c);
  assert.ok(c2.drivers["ANT"].overall > antBefore);
  assert.equal(c2.drivers["ANT"].age, c.drivers["ANT"].age + 1);
});

test("migrate upgrades a v3 save to v4 (adds drivers)", () => {
  const v3 = { v: 3, teamIdx: 1, seed: 3, season: 1, round: 0, money: 0, driverPts: {}, teamPts: {}, board: { targetPos: 2 }, sponsors: [], costCap: false, pendingOffers: [], carDev: {}, project: null, devSpentThisSeason: 0, lastResult: null, history: [], done: false };
  const up = migrate(v3);
  assert.equal(up.v, CAREER_V);
  assert.ok(up.drivers && up.drivers["VER"]);
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test ApexWeb/tests/career.test.js` → FAIL.

- [ ] **Step 3: Implement** — edit `ApexWeb/src/career.js`:

Add the import after the development import:
```js
import { initDrivers, developDrivers, updateMorale } from "./drivers.js";
```
Bump the version — change `export const CAREER_V = 3;` to:
```js
export const CAREER_V = 4;            // career save schema version
```
In `newCareer`, add the driver registry — change:
```js
    carDev: {}, project: null, devSpentThisSeason: 0,
```
to:
```js
    carDev: {}, project: null, devSpentThisSeason: 0,
    drivers: initDrivers(),
```
In `applyResult`, book salaries + update morale. Find the block:
```js
  const net = prize + sponsorIncome - RUNNING_COST;
  career.money += net;
  const summary = {
    round: career.round, gp: CALENDAR[career.round].name, podium, bestPos,
    prize, sponsorIncome, runningCost: RUNNING_COST, net,
    classification: classification.map((c, i) => ({ pos: i + 1, abbrev: c.abbrev, team: c.team, retired: !!c.retired })),
  };
```
and replace it with (salaries expense + morale update on the full field):
```js
  // driver morale (whole field) from finish vs the team-tier expectation; salaries (player team) as expense.
  let salaries = 0;
  classification.forEach((c, i) => {
    const dr = career.drivers && career.drivers[c.abbrev];
    if (!dr) return;
    updateMorale(dr, i + 1, 1 + dr.teamIdx * 2);
    if (dr.teamIdx === career.teamIdx) salaries += dr.salary;
  });
  const net = prize + sponsorIncome - RUNNING_COST - salaries;
  career.money += net;
  const summary = {
    round: career.round, gp: CALENDAR[career.round].name, podium, bestPos,
    prize, sponsorIncome, runningCost: RUNNING_COST, salaries, net,
    classification: classification.map((c, i) => ({ pos: i + 1, abbrev: c.abbrev, team: c.team, retired: !!c.retired })),
  };
```
Extend `migrate` — add a v<4 block before `return career;`:
```js
  if (career.v < 4) {
    career.drivers = career.drivers || initDrivers();
    career.v = 4;
  }
```
In `newSeason`, carry + develop the registry — change:
```js
  fresh.carDev = career.carDev || {};        // development carries into the new season (M8 adds regulation resets)
  fresh.devSpentThisSeason = 0;
  return fresh;
```
to:
```js
  fresh.carDev = career.carDev || {};        // development carries into the new season (M8 adds regulation resets)
  fresh.devSpentThisSeason = 0;
  fresh.drivers = career.drivers || initDrivers();
  developDrivers(fresh.drivers);             // age up, develop/decline, tick contracts
  return fresh;
```
Add a re-sign passthrough after `chooseTitleSponsor` (so main.js imports it from career.js consistently):
```js
export { reSign } from "./drivers.js";
```

- [ ] **Step 4: Run to verify it passes** — `node --test ApexWeb/tests/career.test.js` → all pass (the M2 ledger test still holds — its `sum.net` formula in the M2 test does NOT include salaries; UPDATE that one test). NOTE: the M2 test "applyResult books prize + sponsor income minus running cost into a net ledger" asserts `sum.net === sum.prize + sum.sponsorIncome - sum.runningCost`. That is now off by `salaries`. Change that assertion to `assert.equal(sum.net, sum.prize + sum.sponsorIncome - sum.runningCost - sum.salaries);` and add `assert.ok(sum.salaries >= 0);`.

- [ ] **Step 5: Commit** — `git add ApexWeb/src/career.js ApexWeb/tests/career.test.js` → `feat(apexweb): career v4 — driver registry, salaries, morale, season development (M4)`.

---

## Task 3: main.js — driver overall/attrs + morale in the field

**Files:** Modify `ApexWeb/src/main.js` (READ first).

- [ ] **Step 1: Import.** Add after the development import:
```js
import { moraleMod, reSign } from "./drivers.js";
```

- [ ] **Step 2: buildField uses the evolved driver.** In `buildField`, the per-driver object currently reads `skill: d.skill` and `attrs: driverAttrs(d.abbrev, d.skill)` and computes `setupBonus`. Replace the whole returned object's relevant lines:
```js
      idx: idx++, name: d.name, abbrev: d.abbrev, skill: d.skill,
      car: composeCar(ctx.career ? effectiveCar(t.car, ctx.career.carDev[t.name]) : t.car), color: t.color, team: t.name, isPlayer: isPlayerTeam, player,
      attrs: driverAttrs(d.abbrev, d.skill), personnel: genPersonnel(t.facility, ti),
      setup, setupBonus: player
        ? pracSetupBonus(player) + PRAC2.TRACK_PACE * pracTrackKnow(player)
        : paceBonus(closeness(setup, ideal)) + PRAC2.TRACK_PACE * PRAC2.AI_TRACK_KNOW, startTyre: "medium",
```
with:
```js
      const dr = ctx.career && ctx.career.drivers ? ctx.career.drivers[d.abbrev] : null;
      const overall = dr ? dr.overall : d.skill;
      const mMod = dr ? moraleMod(dr.morale) : 0;
      return {
      idx: idx++, name: d.name, abbrev: d.abbrev, skill: overall,
      car: composeCar(ctx.career ? effectiveCar(t.car, ctx.career.carDev[t.name]) : t.car), color: t.color, team: t.name, isPlayer: isPlayerTeam, player,
      attrs: driverAttrs(d.abbrev, overall), personnel: genPersonnel(t.facility, ti),
      setup, setupBonus: (player
        ? pracSetupBonus(player) + PRAC2.TRACK_PACE * pracTrackKnow(player)
        : paceBonus(closeness(setup, ideal)) + PRAC2.TRACK_PACE * PRAC2.AI_TRACK_KNOW) + mMod, startTyre: "medium",
```
(NOTE: the current code is `return {` directly; change it to first declare `dr`/`overall`/`mMod` then `return {`. So the map body becomes a block. Make sure the arrow `t.drivers.map((d, di) => {` already uses a block body — it does, because it has `const isPlayerTeam = ...` lines before `return {`. So just insert the three `const` lines before `return {` and edit the fields.)

- [ ] **Step 3: Re-sign command.** In `onCommand`, after the `career_project` case:
```js
    case "career_resign":
      if (ctx.career) { reSign(ctx.career, cmd.abbrev); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
```

- [ ] **Step 4: Verify** — `node --check ApexWeb/src/main.js` → OK. `node --test` → all green.

- [ ] **Step 5: Commit** — `git add ApexWeb/src/main.js` → `feat(apexweb): field reads evolved driver overall + morale; re-sign command (M4)`.

---

## Task 4: season.js — drivers panel

**Files:** Modify `ApexWeb/src/ui/season.js` (READ first).

- [ ] **Step 1: Implement.** Add the import:
```js
import { moraleMod } from "../drivers.js";
```
Build a drivers panel after the development panel (`devPanel`) — insert before `// season-start title-sponsor choice`:
```js
  // drivers panel — the player team's two drivers (age / overall / morale / contract / salary)
  const myDrivers = (myTeamName && c.drivers) ? Object.entries(c.drivers).filter(([, d]) => d.teamIdx === (me ? cons.findIndex(x => x.isPlayer) : -1)) : [];
  // teamIdx lives on the driver record; match it to the player's team index from TEAMS
  const myTeamIdx = TEAMS.findIndex(t => t.name === myTeamName);
  const mine = (c.drivers) ? Object.entries(c.drivers).filter(([, d]) => d.teamIdx === myTeamIdx) : [];
  const driverRows = mine.map(([ab, d]) => row([
    `<b>${ab}</b>`, `${d.age} лет`, `ovr ${d.overall.toFixed(3)}`, `мораль ${Math.round(d.morale * 100)}%`,
    `контракт ${d.contractSeasons} сез.`, `${m$(d.salary)}/гонка`,
    `<button class="ready resign" data-ab="${ab}" style="padding:3px 8px;font-size:12px">Продлить</button>`,
  ])).join("");
  const driversPanel = mine.length ? `<div class="panel"><p class="label">Пилоты</p><table style="width:100%;border-collapse:collapse"><tbody>${driverRows}</tbody></table></div>` : "";
```
(Remove the dead `myDrivers` line — keep only `myTeamIdx`/`mine`. Use exactly:)
```js
  // drivers panel — the player team's two drivers (age / overall / morale / contract / salary)
  const myTeamIdx = TEAMS.findIndex(t => t.name === myTeamName);
  const mine = c.drivers ? Object.entries(c.drivers).filter(([, d]) => d.teamIdx === myTeamIdx) : [];
  const driverRows = mine.map(([ab, d]) => row([
    `<b>${ab}</b>`, `${d.age} лет`, `ovr ${d.overall.toFixed(3)}`, `мораль ${Math.round(d.morale * 100)}%`,
    `${d.contractSeasons} сез.`, `${m$(d.salary)}/гонка`,
    `<button class="ready resign" data-ab="${ab}" style="padding:3px 8px;font-size:12px">Продлить</button>`,
  ])).join("");
  const driversPanel = mine.length ? `<div class="panel"><p class="label">Пилоты</p><table style="width:100%;border-collapse:collapse"><tbody>${driverRows}</tbody></table></div>` : "";
```
Insert `${driversPanel}` into the layout — after `${devPanel}`:
```js
    ${devPanel}
    ${driversPanel}
    ${offers}
```
Wire the re-sign buttons — after the devbtn wiring:
```js
  root.querySelectorAll("button.resign").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_resign", player: ctx.myPlayer, abbrev: b.dataset.ab }); });
```

- [ ] **Step 2: Verify** — `node --check ApexWeb/src/ui/season.js` → OK.

- [ ] **Step 3: Commit** — `git add ApexWeb/src/ui/season.js` → `feat(apexweb): paddock drivers panel — age/overall/morale/contract + re-sign (M4)`.

---

## Task 5: career_balance.mjs — salaries + driver development

**Files:** Modify `ApexWeb/tools/career_balance.mjs`.

- [ ] **Step 1: Implement.** The harness `field()` should use the evolved driver overall + morale (so morale/development actually affect the corridor races). Add the import:
```js
import { driverAttrs as _da } from "../src/team.js";
import { moraleMod } from "../src/drivers.js";
import { newSeason } from "../src/career.js";
```
(`newCareer`/`applyResult`/etc. are already imported; add `newSeason`.)

Change `field()` to read the registry (defensive — the harness career exists by call time):
```js
function field() {
  let idx = 0;
  return TEAMS.flatMap((t, ti) => t.drivers.map(d => {
    const dr = career.drivers && career.drivers[d.abbrev];
    const overall = dr ? dr.overall : d.skill;
    return {
      idx: idx++, name: d.name, abbrev: d.abbrev, skill: overall,
      car: composeCar(effectiveCar(t.car, career.carDev && career.carDev[t.name])), color: t.color, team: t.name,
      attrs: _da(d.abbrev, overall), personnel: genPersonnel(t.facility, ti),
      setup: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5], setupBonus: dr ? moraleMod(dr.morale) : 0, startTyre: "medium",
    };
  }));
}
```
(Remove the old `driverAttrs` usage in `field()` if it referenced the team import directly; this uses the aliased `_da`. The existing top import `import { driverAttrs, composeCar, genPersonnel } from "../src/team.js";` already gives `driverAttrs` — you may keep it and use `driverAttrs` instead of `_da`; if so, skip the `_da` alias import. Use whichever avoids a duplicate-binding error.)

After the season loop + the existing dev report, add a driver-development check (advance a season and confirm the curve):
```js
const antBefore = career.drivers["ANT"].overall, aloBefore = career.drivers["ALO"].overall;
const next = newSeason(career);
console.log(`drivers: ANT ${antBefore.toFixed(3)}->${next.drivers["ANT"].overall.toFixed(3)} (age ${next.drivers["ANT"].age}), ALO ${aloBefore.toFixed(3)}->${next.drivers["ALO"].overall.toFixed(3)}; player morale ${TEAMS[0].drivers.map(d => Math.round(career.drivers[d.abbrev].morale * 100) + "%").join("/")}`);
if (!(next.drivers["ANT"].overall > antBefore && next.drivers["ALO"].overall < aloBefore)) { console.error("driver development curve broken (young should rise, veteran fall)"); process.exit(1); }
```
(Place this block before `console.log("CAREER CORRIDOR OK");`.)

- [ ] **Step 2: Run it** — `node ApexWeb/tools/career_balance.mjs` → season completes, money still > 0 (salaries didn't bankrupt the top team), the `drivers:` line shows ANT rising / ALO falling, "CAREER CORRIDOR OK". (If salaries make the top team go broke, they're too high — report and dial `salaryFor`.)

- [ ] **Step 3: Commit** — `git add ApexWeb/tools/career_balance.mjs` → `test(apexweb): salaries expense + driver development corridor (M4)`.

---

## Final verification

- [ ] `node --test ApexWeb/tests/*.test.js` → all green.
- [ ] `node ApexWeb/tools/career_balance.mjs` → CAREER CORRIDOR OK (+ drivers line).
- [ ] Preview: career → paddock → **Пилоты** panel shows your two drivers (age / ovr / morale / contract / salary); Продлить spends money + resets the contract. (Owner F5: morale shifts across races; a young signing improves season-to-season.)

## Self-review
- **Spec coverage:** 13-attr development ✓ (via evolving `overall` → `driverAttrs`; per-attr targeting deferred), age curve ✓, morale ✓ (results → morale → pace, centered/bounded), contracts ✓ (salary expense + re-sign). Replacement/transfer market = **M6**.
- **Determinism/balance:** moraleMod centered on the 0.6 start → a fresh grid is balance-neutral; development is a deterministic age formula; morale decays toward 0.6 (no spiral). Sim untouched.
- **Integration:** only buildField/practiceCars read the registry; non-career = static skill. Ledger now includes salaries; the M2 ledger test is updated for the new net formula.
- **WIP isolation:** explicit pathspecs; re-read main.js/season.js before editing.
