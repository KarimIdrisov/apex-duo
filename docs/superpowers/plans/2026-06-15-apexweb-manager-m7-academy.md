# M7 — Academy & Young Drivers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Grow your own star. Scout junior drivers (off-grid) into your academy; they develop toward their potential each season (faster than grid drivers, and they give a small R&D test-driver bonus); promote a ready one (past a superlicense gate) into a race seat, retiring a current driver.

**Architecture:** A pure `academy.js` (`JUNIOR_POOL`, `signJunior`, `developAcademy`, `promoteJunior`, `academyDevBonus`). `career.js` v6 stores `career.academy`, develops it at `newSeason`, and `promoteJunior` injects the junior into the driver registry (so the existing roster/transfer machinery races them). `development.tickDevelopment` adds the academy R&D bonus. `buildField`/`teamRoster` show a promoted junior's name. `season.js` gets an academy panel. Sim/quali/practice byte-unchanged.

**Tech Stack:** Vanilla JS ES modules, Node `node --test`, deterministic.

**Spec:** `docs/superpowers/specs/2026-06-15-apexweb-manager-career-design.md` (Phase M7). Builds on M1–M6.

---

## File Structure

```
ApexWeb/src/academy.js         NEW — pure: JUNIOR_POOL, SUPERLICENSE, signJunior, developAcademy, promoteJunior, academyDevBonus
ApexWeb/src/career.js          MODIFY — v6 (career.academy), developAcademy at newSeason, migrate
ApexWeb/src/development.js      MODIFY — tickDevelopment adds the academy R&D bonus
ApexWeb/src/main.js            MODIFY — teamRoster shows a promoted junior's name; career_scout / career_promote commands
ApexWeb/src/ui/season.js       MODIFY — academy panel (juniors + scout + promote)
ApexWeb/tests/academy.test.js  NEW
ApexWeb/tests/career.test.js   MODIFY — academy carry/develop + promote-into-grid
ApexWeb/tools/career_balance.mjs   MODIFY — scout + develop + promote; junior races; grid integrity
```

Explicit pathspecs; re-read main.js/season.js immediately before editing.

---

## Task 1: academy.js — the academy model (pure)

**Files:** Create `ApexWeb/src/academy.js`; Test `ApexWeb/tests/academy.test.js`.

- [ ] **Step 1: Failing test** — `ApexWeb/tests/academy.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { initDrivers } from "../src/drivers.js";
import { JUNIOR_POOL, SUPERLICENSE, availableJuniors, signJunior, developAcademy, promoteJunior, academyDevBonus } from "../src/academy.js";

function career(teamIdx = 0) { return { teamIdx, money: 100000, drivers: initDrivers(), academy: [], driverPts: {} }; }
const gridCount = c => { const n = {}; for (const a in c.drivers) n[c.drivers[a].teamIdx] = (n[c.drivers[a].teamIdx] || 0) + 1; return n; };

test("JUNIOR_POOL abbrevs don't collide with the grid; availableJuniors excludes signed/promoted", () => {
  const c = career();
  const grid = new Set(Object.keys(c.drivers));
  for (const j of JUNIOR_POOL) assert.ok(!grid.has(j.abbrev), `${j.abbrev} collides with the grid`);
  const av0 = availableJuniors(c).length;
  signJunior(c, JUNIOR_POOL[0].abbrev);
  assert.equal(availableJuniors(c).length, av0 - 1);
});

test("signJunior spends the fee + adds to the academy; refused when broke / dup", () => {
  const c = career();
  assert.equal(signJunior(c, "VIL"), true);
  assert.ok(c.academy.some(j => j.abbrev === "VIL") && c.money < 100000);
  assert.equal(signJunior(c, "VIL"), false);                 // already in academy
  assert.equal(signJunior(career(), "NOPE"), false);
});

test("developAcademy grows juniors toward potential (and faster than a grid driver would)", () => {
  const c = career(); signJunior(c, "VIL");                  // ovr 0.71, pot 0.93
  const before = c.academy[0].overall;
  developAcademy(c);
  assert.ok(c.academy[0].overall > before + 0.02, "a high-potential teenager jumps");
  assert.equal(c.academy[0].age, JUNIOR_POOL.find(j => j.abbrev === "VIL").age + 1);
});

test("promoteJunior gates on the superlicense, injects into the grid, retires the dropped driver, keeps 2/team", () => {
  const c = career();
  signJunior(c, "VIL");                                       // 0.71 < gate -> can't promote yet
  assert.equal(promoteJunior(c, "VIL", "NOR"), false);
  signJunior(c, "HIR");                                       // 0.80 >= gate
  assert.ok(SUPERLICENSE <= 0.80);
  assert.equal(promoteJunior(c, "HIR", "NOR"), true);
  assert.equal(c.drivers["HIR"].teamIdx, 0);                 // junior now races for the player
  assert.equal(c.drivers["NOR"], undefined, "the dropped driver retired off the grid");
  assert.equal(c.driverPts["HIR"], 0, "junior is in the standings");
  assert.ok(!c.academy.some(j => j.abbrev === "HIR"));
  for (const k in gridCount(c)) assert.equal(gridCount(c)[k], 2);
});

test("academyDevBonus scales with academy size", () => {
  const c = career();
  assert.equal(academyDevBonus(c), 0);
  signJunior(c, "VIL"); signJunior(c, "HIR");
  assert.ok(academyDevBonus(c) > 0);
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test ApexWeb/tests/academy.test.js` → FAIL (no module).

- [ ] **Step 3: Implement** — `ApexWeb/src/academy.js`:

```js
// ApexWeb/src/academy.js — pure young-driver academy: scout juniors (off-grid), develop them in
// your program, promote a ready one into a race seat (injects into the driver registry).
const clampOverall = v => Math.max(0.50, Math.min(0.99, v));

export const SUPERLICENSE = 0.78;   // overall needed to promote a junior to a race seat
export const SCOUT_FEE = 800;       // $k to sign a junior into the academy

// the junior talent pool (fictional F2/F3-style young drivers; abbrevs avoid the grid's).
export const JUNIOR_POOL = [
  { abbrev: "DOO", name: "Дуэн",        age: 19, overall: 0.78, potential: 0.90 },
  { abbrev: "BAR", name: "Барнард",     age: 18, overall: 0.74, potential: 0.88 },
  { abbrev: "HIR", name: "Хиракава",    age: 20, overall: 0.80, potential: 0.86 },
  { abbrev: "MTS", name: "Мартинс",     age: 19, overall: 0.76, potential: 0.89 },
  { abbrev: "OSU", name: "О'Салливан",  age: 20, overall: 0.79, potential: 0.85 },
  { abbrev: "VIL", name: "Виллагомес",  age: 17, overall: 0.71, potential: 0.93 },
  { abbrev: "STN", name: "Стенсхорн",   age: 18, overall: 0.73, potential: 0.90 },
  { abbrev: "DUN", name: "Данн",        age: 18, overall: 0.72, potential: 0.91 },
];

// juniors available to scout (pool minus those already in the academy or promoted onto the grid).
export function availableJuniors(career) {
  const taken = new Set([...(career.academy || []).map(j => j.abbrev), ...Object.keys(career.drivers || {})]);
  return JUNIOR_POOL.filter(j => !taken.has(j.abbrev));
}

// sign a junior into the academy. Returns true if applied.
export function signJunior(career, abbrev) {
  if (career.money < SCOUT_FEE) return false;
  if ((career.academy || []).some(j => j.abbrev === abbrev)) return false;
  const j = JUNIOR_POOL.find(p => p.abbrev === abbrev);
  if (!j) return false;
  career.money -= SCOUT_FEE;
  career.academy = career.academy || [];
  career.academy.push({ ...j });     // clone so the pool stays pristine
  return true;
}

// develop academy juniors one season: they close a chunk of the gap to their potential.
export function developAcademy(career) {
  for (const j of (career.academy || [])) {
    j.age += 1;
    j.overall = clampOverall(j.overall + Math.max(0, (j.potential - j.overall) * 0.35));
  }
}

// promote a ready junior into a race seat, retiring the player driver `outAbbrev`. Returns true if applied.
export function promoteJunior(career, juniorAbbrev, outAbbrev) {
  const ji = (career.academy || []).findIndex(j => j.abbrev === juniorAbbrev);
  if (ji < 0) return false;
  const j = career.academy[ji];
  if (j.overall < SUPERLICENSE) return false;                       // superlicense gate
  const out = career.drivers[outAbbrev];
  if (!out || out.teamIdx !== career.teamIdx) return false;          // must drop one of your own
  delete career.drivers[outAbbrev];                                  // the veteran retires off the grid
  career.drivers[juniorAbbrev] = {
    teamIdx: career.teamIdx, age: j.age, overall: j.overall, morale: 0.7,
    contractSeasons: 3, salary: 200, name: j.name,                   // cheap rookie salary; name for the roster
  };
  if (career.driverPts) career.driverPts[juniorAbbrev] = career.driverPts[juniorAbbrev] || 0;  // count in the standings
  career.academy.splice(ji, 1);                                     // leaves the academy
  return true;
}

// test-driver R&D benefit: each academy junior contributes a small development bonus.
export function academyDevBonus(career) {
  return (career.academy || []).length * 0.04;   // +4% dev per junior testing parts
}
```

- [ ] **Step 4: Run to verify it passes** — `node --test ApexWeb/tests/academy.test.js` → all pass.

- [ ] **Step 5: Commit** — `git add ApexWeb/src/academy.js ApexWeb/tests/academy.test.js` → `feat(apexweb): young-driver academy — scout/develop/promote (M7)`.

---

## Task 2: career.js — v6 academy + development bonus wiring

**Files:** Modify `ApexWeb/src/career.js`, `ApexWeb/src/development.js`; Test `ApexWeb/tests/career.test.js`.

- [ ] **Step 1: Add failing tests** — append to `ApexWeb/tests/career.test.js`:

```js
import { signJunior, promoteJunior } from "../src/academy.js";

test("newCareer at v6 carries an empty academy", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  assert.ok(c.v >= 6);
  assert.deepEqual(c.academy, []);
});

test("newSeason develops academy juniors (and keeps them across seasons)", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  signJunior(c, "VIL");
  const before = c.academy[0].overall;
  const c2 = newSeason(c);
  assert.ok(c2.academy.length === 1 && c2.academy[0].overall > before);
  assert.equal(c.academy[0].overall, before, "the prior career is untouched (deep-copied)");
});

test("migrate upgrades a v5 save to v6 (adds academy)", () => {
  const v5 = { v: 5, teamIdx: 1, seed: 3, season: 1, round: 0, money: 0, driverPts: {}, teamPts: {}, board: { targetPos: 2 }, sponsors: [], costCap: false, pendingOffers: [], carDev: {}, project: null, devSpentThisSeason: 0, drivers: {}, staff: {}, lastResult: null, history: [], done: false };
  const up = migrate(v5);
  assert.equal(up.v, CAREER_V);
  assert.deepEqual(up.academy, []);
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test ApexWeb/tests/career.test.js` → FAIL.

- [ ] **Step 3a: Implement career.js** — add the import after the market import:
```js
import { developAcademy } from "./academy.js";
```
Bump version — `export const CAREER_V = 5;` → `export const CAREER_V = 6;            // career save schema version`.
In `newCareer`, add the academy after `staff: initStaff(...),`:
```js
    staff: initStaff(TEAMS[teamIdx].facility, s),
    academy: [],
```
Extend `migrate` — add a v<6 block before `return career;`:
```js
  if (career.v < 6) {
    career.academy = career.academy || [];
    career.v = 6;
  }
```
In `newSeason`, carry + develop the academy — after the `fresh.staff = ...` line add:
```js
  fresh.academy = JSON.parse(JSON.stringify(career.academy || []));
  developAcademy(fresh);                       // juniors grow toward potential each season
```

- [ ] **Step 3b: Implement development.js** — add the import after the staff import:
```js
import { academyDevBonus } from "./academy.js";
```
In `tickDevelopment`, change the gain line:
```js
      const gain = p.gain * (1 - p.risk * roll) * devMult(career.staff);
```
to:
```js
      const gain = p.gain * (1 - p.risk * roll) * devMult(career.staff) * (1 + academyDevBonus(career));
```

- [ ] **Step 4: Run to verify it passes** — `node --test ApexWeb/tests/career.test.js` + `node --test ApexWeb/tests/development.test.js` → all pass (academyDevBonus is 0 with no academy → development cases unchanged).

- [ ] **Step 5: Commit** — `git add ApexWeb/src/career.js ApexWeb/src/development.js ApexWeb/tests/career.test.js` → `feat(apexweb): career v6 — academy state, season development, R&D bonus (M7)`.

---

## Task 3: main.js — show promoted-junior names + scout/promote commands

**Files:** Modify `ApexWeb/src/main.js` (READ first).

- [ ] **Step 1: Import.** Add after the market import:
```js
import { signJunior, promoteJunior } from "./academy.js";
```

- [ ] **Step 2: teamRoster shows a promoted junior's name.** In `teamRoster`, change the career-mode `.map(...)`:
```js
    .map(ab => ({ abbrev: ab, name: DRIVER_NAME[ab] || ab, skill: ctx.career.drivers[ab].overall }));
```
to (prefer a stored name — promoted juniors carry one; grid drivers fall back to DRIVER_NAME):
```js
    .map(ab => ({ abbrev: ab, name: ctx.career.drivers[ab].name || DRIVER_NAME[ab] || ab, skill: ctx.career.drivers[ab].overall }));
```

- [ ] **Step 3: Commands.** In `onCommand`, after the `career_sign` case:
```js
    case "career_scout":
      if (ctx.career) { signJunior(ctx.career, cmd.abbrev); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_promote":
      if (ctx.career) { promoteJunior(ctx.career, cmd.abbrev, cmd.outAbbrev); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
```

- [ ] **Step 4: Verify** — `node --check ApexWeb/src/main.js` → OK. `node --test` → all green.

- [ ] **Step 5: Commit** — `git add ApexWeb/src/main.js` → `feat(apexweb): scout/promote commands + promoted-junior names in the roster (M7)`.

---

## Task 4: season.js — academy panel

**Files:** Modify `ApexWeb/src/ui/season.js` (READ first).

- [ ] **Step 1: Implement.** Add the import:
```js
import { availableJuniors, SUPERLICENSE, SCOUT_FEE } from "../academy.js";
```
Build an academy panel after the transfer panel (`transferPanel`) — insert before `// season-start title-sponsor choice`:
```js
  // academy panel — your juniors (develop -> promote) + scouting from the pool
  const acad = c.academy || [];
  const scout = c.drivers ? availableJuniors(c).slice(0, 4) : [];
  const acadRows = acad.map(j => row([`<b>${j.abbrev}</b> ${j.name}`, `${j.age} л.`, `ovr ${j.overall.toFixed(3)}`, `пот. ${j.potential.toFixed(2)}`,
    j.overall >= SUPERLICENSE
      ? mineAbbrevs.map(ab => `<button class="ready promote" data-j="${j.abbrev}" data-out="${ab}" style="padding:3px 6px;font-size:11px;margin-left:4px">▲${ab}</button>`).join("")
      : `<span class="label">нужен ovr ${SUPERLICENSE}</span>`])).join("");
  const scoutRows = scout.map(j => row([`<b>${j.abbrev}</b> ${j.name}`, `${j.age} л.`, `ovr ${j.overall.toFixed(3)}`, `пот. ${j.potential.toFixed(2)}`,
    `<button class="ready scout" data-j="${j.abbrev}" ${c.money < SCOUT_FEE ? "disabled" : ""} style="padding:3px 8px;font-size:11px">Подписать (${m$(SCOUT_FEE)})</button>`])).join("");
  const academyPanel = c.drivers ? `<div class="panel"><p class="label">Академия</p>
    ${acad.length ? `<table style="width:100%;border-collapse:collapse"><tbody>${acadRows}</tbody></table>` : `<p class="label">нет юниоров</p>`}
    <div style="height:6px"></div><p class="label">Скаутинг</p>
    <table style="width:100%;border-collapse:collapse"><tbody>${scoutRows}</tbody></table></div>` : "";
```
Insert `${academyPanel}` into the layout — after `${transferPanel}`:
```js
    ${transferPanel}
    ${academyPanel}
    ${offers}
```
Wire the buttons — after the sign (`button.sign`) wiring:
```js
  root.querySelectorAll("button.scout").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_scout", player: ctx.myPlayer, abbrev: b.dataset.j }); });
  root.querySelectorAll("button.promote").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_promote", player: ctx.myPlayer, abbrev: b.dataset.j, outAbbrev: b.dataset.out }); });
```

- [ ] **Step 2: Verify** — `node --check ApexWeb/src/ui/season.js` → OK.

- [ ] **Step 3: Commit** — `git add ApexWeb/src/ui/season.js` → `feat(apexweb): paddock academy panel — scout + promote (M7)`.

---

## Task 5: career_balance.mjs — academy corridor

**Files:** Modify `ApexWeb/tools/career_balance.mjs`.

- [ ] **Step 1: Implement.** Add the import:
```js
import { signJunior, promoteJunior, SUPERLICENSE } from "../src/academy.js";
```
After the transfer block (the `{ const av = availableDrivers... }` block), scout + promote a junior:
```js
{ signJunior(career, "HIR"); const out = Object.keys(career.drivers).find(a => career.drivers[a].teamIdx === 0);
  const ok = promoteJunior(career, "HIR", out); console.log(`academy: signed+promoted HIR for ${out} -> ${ok} (gate ${SUPERLICENSE})`); }
```
The grid-integrity block already added in M6 covers the post-promote grid. Add a junior-races check before `console.log("CAREER CORRIDOR OK");`:
```js
if (!career.drivers["HIR"] || career.drivers["HIR"].teamIdx !== 0) { console.error("promoted junior is not racing for the player"); process.exit(1); }
console.log(`academy: HIR racing for player (ovr ${career.drivers["HIR"].overall.toFixed(3)})`);
```

- [ ] **Step 2: Run it** — `node ApexWeb/tools/career_balance.mjs` → the `academy:` line shows the sign+promote, the season runs with HIR racing for the player, grid integrity all-2, HIR-races check passes, "CAREER CORRIDOR OK".

- [ ] **Step 3: Commit** — `git add ApexWeb/tools/career_balance.mjs` → `test(apexweb): academy scout/promote corridor (M7)`.

---

## Final verification

- [ ] `node --test ApexWeb/tests/*.test.js` → all green.
- [ ] `node ApexWeb/tools/career_balance.mjs` → CAREER CORRIDOR OK (+ academy line).
- [ ] Preview: career → paddock → **Академия** panel (scout from the pool; a junior past the gate shows ▲ promote buttons); scout a junior → money drops; promote a ready one → the junior appears in **Пилоты**, the dropped driver leaves. (Owner F5: a scouted teenager develops over seasons into a race-ready driver.)

## Self-review
- **Spec coverage:** scout/sign juniors ✓, feeder development ✓ (developAcademy toward potential), superlicense gate ✓ (SUPERLICENSE), promote to race seat ✓ (injects into the registry, reuses the roster machinery), test-driver R&D benefit ✓ (academyDevBonus). Race stand-in for injury = deferred (no injury system; M8 candidate).
- **Determinism/integrity:** academy development is a deterministic curve; promote keeps every team at exactly 2 (corridor asserts) and registers the junior in driverPts. Sim untouched.
- **Cosmetic note:** a promoted junior shows in the constructor standings (team points count); in the *driver* standings its team label may be blank (driverStandings reads the static TEAMS map) — points still count. Acceptable for M7.
- **WIP isolation:** explicit pathspecs; re-read main.js/season.js before editing.
