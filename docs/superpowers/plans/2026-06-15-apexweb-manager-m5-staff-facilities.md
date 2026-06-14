# M5 — Staff & Facilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** People and buildings you invest in. Three staff roles — chief designer (→ development speed), strategist (→ `personnel.strategy`), pit crew (→ `personnel.pitMult`) — and three facilities (design / pit / factory) with levels. Upgrades cost money; facilities carry a per-race upkeep. Better staff/facilities compound: faster development and quicker stops over a season.

**Architecture:** A pure `staff.js` (`initStaff`, `composePersonnel`, `devMult`, `upkeep`, upgrades). `career.js` v5 stores `career.staff` (ratings + facility levels), books upkeep in `applyResult`, carries staff at `newSeason`. `development.tickDevelopment` multiplies the player's project gain by `devMult`. `buildField` composes the player team's personnel from `career.staff` (AI teams keep `genPersonnel`). `season.js` gains a team panel. Sim/quali/practice byte-unchanged; at the start (no upgrades) personnel ≈ today's `genPersonnel`, so balance is neutral.

**Tech Stack:** Vanilla JS ES modules, Node `node --test`, deterministic.

**Spec:** `docs/superpowers/specs/2026-06-15-apexweb-manager-career-design.md` (Phase M5). Builds on M1–M4.

---

## File Structure

```
ApexWeb/src/staff.js           NEW — pure: STAFF_ROLES, FACILITIES, initStaff, composePersonnel, devMult, upkeep, upgradeStaff, upgradeFacility
ApexWeb/src/career.js          MODIFY — v5 (career.staff), upkeep in applyResult, carry at newSeason, migrate
ApexWeb/src/development.js      MODIFY — tickDevelopment multiplies player gain by devMult(career.staff)
ApexWeb/src/main.js            MODIFY — buildField/practiceCars compose player personnel from staff; career_upgrade command
ApexWeb/src/ui/season.js       MODIFY — team panel (staff ratings + facility levels + upgrade buttons + upkeep)
ApexWeb/tests/staff.test.js    NEW
ApexWeb/tests/career.test.js   MODIFY — staff state + upkeep ledger
ApexWeb/tests/development.test.js MODIFY — devMult scales the project gain
ApexWeb/tools/career_balance.mjs   MODIFY — upgrade staff/facility over a season; upkeep expense; solvent
```

Explicit pathspecs; re-read main.js/season.js immediately before editing.

---

## Task 1: staff.js — staff & facilities model (pure)

**Files:** Create `ApexWeb/src/staff.js`; Test `ApexWeb/tests/staff.test.js`.

- [ ] **Step 1: Failing test** — `ApexWeb/tests/staff.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { STAFF_ROLES, FACILITIES, FAC_MAX, initStaff, composePersonnel, devMult, upkeep, upgradeStaff, upgradeFacility, STAFF_UPGRADE_COST } from "../src/staff.js";

test("initStaff seeds ratings + facility levels from the team facility strength", () => {
  const strong = initStaff(0.95, 1), weak = initStaff(0.68, 1);
  for (const r of STAFF_ROLES) assert.ok(strong[r] > weak[r], `${r} stronger for a top team`);
  for (const f of FACILITIES) assert.ok(strong.facilities[f] >= weak.facilities[f]);
  assert.deepEqual(initStaff(0.8, 5), initStaff(0.8, 5));     // deterministic
});

test("composePersonnel: better pit crew -> faster stops (lower pitMult); strategist -> strategy", () => {
  const good = composePersonnel(initStaff(0.95, 1)), poor = composePersonnel(initStaff(0.68, 1));
  assert.ok(good.pitMult < poor.pitMult);
  assert.ok(good.strategy > poor.strategy);
  assert.ok(good.pitMult > 0.7 && poor.pitMult < 1.2);       // same range as genPersonnel (balance-safe)
  assert.deepEqual(composePersonnel(null), { pitMult: 1.0, strategy: 0.75 });
});

test("devMult: a neutral office is ~1.0, a maxed one is well above 1", () => {
  const neutral = devMult({ designer: 0.6, facilities: { design: 0, pit: 0, factory: 0 } });
  assert.ok(Math.abs(neutral - 1.0) < 1e-9);
  const maxed = devMult({ designer: 0.99, facilities: { design: FAC_MAX, pit: 0, factory: 0 } });
  assert.ok(maxed > 1.2);
  assert.equal(devMult(null), 1.0);
});

test("upkeep rises with facility levels", () => {
  assert.ok(upkeep(initStaff(0.95, 1)) > upkeep(initStaff(0.68, 1)));
});

test("upgradeStaff / upgradeFacility spend money and improve; refused when broke / maxed", () => {
  const c = { money: 100000, staff: initStaff(0.75, 1) };
  const before = c.staff.designer;
  assert.equal(upgradeStaff(c, "designer"), true);
  assert.ok(c.staff.designer > before && c.money < 100000);
  assert.equal(upgradeStaff({ money: 1, staff: initStaff(0.75, 1) }, "designer"), false);
  const lvl = c.staff.facilities.design;
  assert.equal(upgradeFacility(c, "design"), true);
  assert.equal(c.staff.facilities.design, lvl + 1);
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test ApexWeb/tests/staff.test.js` → FAIL (no module).

- [ ] **Step 3: Implement** — `ApexWeb/src/staff.js`:

```js
// ApexWeb/src/staff.js — pure staff & facilities model. Composes into personnel (pitMult/strategy),
// a development multiplier, and a per-race upkeep. Deterministic. At the start (no upgrades) the
// composed personnel matches genPersonnel's range, so the grid stays balance-neutral.
import { mix32 } from "./rng.js";

export const STAFF_ROLES = ["designer", "strategist", "pitCrew"];
export const ROLE_LABEL = { designer: "Гл. конструктор", strategist: "Стратег", pitCrew: "Пит-крю" };
export const FACILITIES = ["design", "pit", "factory"];
export const FAC_LABEL = { design: "КБ", pit: "Пит-бокс", factory: "Завод" };
export const FAC_MAX = 5;

export const STAFF_UPGRADE_COST = 2500;   // $k to raise a staff rating one step
export const FAC_UPGRADE_BASE = 3500;     // $k base for a facility level (×(level+1))
const STAFF_STEP = 0.06;

const clamp01 = v => Math.max(0, Math.min(1, v));

// initial staff/facilities seeded from the team facility strength (0..1).
export function initStaff(teamFacility, seed) {
  const f = teamFacility ?? 0.75;
  const r = mix32((Math.round(f * 1000) + (seed >>> 0) * 7919) >>> 0) / 4294967296;
  const base = clamp01(f + (r - 0.5) * 0.06);
  const lv = Math.max(0, Math.min(FAC_MAX, Math.round(f * 3)));
  return { designer: base, strategist: base, pitCrew: base, facilities: { design: lv, pit: lv, factory: lv } };
}

// personnel the sim reads: pit crew + pit facility -> pitMult (lower = faster); strategist + design -> strategy.
export function composePersonnel(staff) {
  if (!staff) return { pitMult: 1.0, strategy: 0.75 };
  const pit = clamp01(staff.pitCrew + (staff.facilities.pit / FAC_MAX) * 0.15);
  return { pitMult: 1.15 - 0.4 * pit, strategy: clamp01(staff.strategist + (staff.facilities.design / FAC_MAX) * 0.05) };
}

// development multiplier from the chief designer + the design office (1.0 neutral at designer 0.6 / no facility).
export function devMult(staff) {
  if (!staff) return 1.0;
  return 1 + (staff.designer - 0.6) * 0.5 + (staff.facilities.design / FAC_MAX) * 0.3;
}

// per-race upkeep ($k) — bigger facilities cost more to run.
export function upkeep(staff) {
  if (!staff) return 0;
  const lv = staff.facilities;
  return 120 * (lv.design + lv.pit + lv.factory);
}

// upgrade a staff rating one step. Returns true if applied.
export function upgradeStaff(career, role) {
  if (!STAFF_ROLES.includes(role) || !career.staff) return false;
  if (career.money < STAFF_UPGRADE_COST || career.staff[role] >= 0.99) return false;
  career.money -= STAFF_UPGRADE_COST;
  career.staff[role] = clamp01(career.staff[role] + STAFF_STEP);
  return true;
}

// upgrade a facility one level (cost scales with the next level). Returns true if applied.
export function upgradeFacility(career, which) {
  if (!FACILITIES.includes(which) || !career.staff) return false;
  const lvl = career.staff.facilities[which];
  if (lvl >= FAC_MAX) return false;
  const cost = FAC_UPGRADE_BASE * (lvl + 1);
  if (career.money < cost) return false;
  career.money -= cost;
  career.staff.facilities[which] = lvl + 1;
  return true;
}
```

- [ ] **Step 4: Run to verify it passes** — `node --test ApexWeb/tests/staff.test.js` → all pass.

- [ ] **Step 5: Commit** — `git add ApexWeb/src/staff.js ApexWeb/tests/staff.test.js` → `feat(apexweb): staff & facilities model — personnel/devMult/upkeep/upgrades (M5)`.

---

## Task 2: development.js — devMult scales the project gain

**Files:** Modify `ApexWeb/src/development.js`; Test `ApexWeb/tests/development.test.js`.

- [ ] **Step 1: Add a failing test** — append to `ApexWeb/tests/development.test.js`:

```js
import { initStaff } from "../src/staff.js";

test("tickDevelopment scales the player project gain by the design office (devMult)", () => {
  const mk = staff => { const c = { seed: 1, teamIdx: 0, round: 0, money: 1e6, costCap: false, devSpentThisSeason: 0, carDev: {}, project: null, staff };
    startProject(c, "power", "small"); tickDevelopment(c); return c.carDev["McLaren"].power; };
  const weak = mk(initStaff(0.60, 1));      // ~neutral office
  const strong = mk(initStaff(0.99, 1));    // strong designer
  // give the strong office a maxed design facility to be sure it out-develops
  const c = { seed: 1, teamIdx: 0, round: 0, money: 1e6, costCap: false, devSpentThisSeason: 0, carDev: {}, project: null, staff: { ...initStaff(0.99, 1), facilities: { design: 5, pit: 5, factory: 5 } } };
  startProject(c, "power", "small"); tickDevelopment(c);
  assert.ok(c.carDev["McLaren"].power > weak, "a better design office develops more per project");
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test ApexWeb/tests/development.test.js` → FAIL (gain not scaled — devMult not applied).

- [ ] **Step 3: Implement** — in `ApexWeb/src/development.js`, add the import at the top (after the TEAMS import):
```js
import { devMult } from "./staff.js";
```
In `tickDevelopment`, change the gain line:
```js
      const gain = p.gain * (1 - p.risk * roll);
```
to:
```js
      const gain = p.gain * (1 - p.risk * roll) * devMult(career.staff);
```

- [ ] **Step 4: Run to verify it passes** — `node --test ApexWeb/tests/development.test.js` → all pass. (The M3 cases still pass: with no `career.staff`, `devMult(undefined)` = 1.0, so the gain is unchanged.)

- [ ] **Step 5: Commit** — `git add ApexWeb/src/development.js ApexWeb/tests/development.test.js` → `feat(apexweb): development scales by the design office (M5)`.

---

## Task 3: career.js — v5 staff state + upkeep

**Files:** Modify `ApexWeb/src/career.js`; Test `ApexWeb/tests/career.test.js`.

- [ ] **Step 1: Add failing tests** — append to `ApexWeb/tests/career.test.js`:

```js
import { upgradeFacility } from "../src/staff.js";

test("newCareer at v5 carries staff + facilities", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  assert.ok(c.v >= 5);
  assert.ok(c.staff && c.staff.designer > 0 && c.staff.facilities && c.staff.facilities.design >= 0);
});

test("applyResult books facility upkeep as an expense", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  upgradeFacility(c, "design"); upgradeFacility(c, "pit");      // raise upkeep
  const order = [...TEAMS[0].drivers.map(d => ({ abbrev: d.abbrev, team: "McLaren" })),
    ...TEAMS.flatMap((t, i) => i === 0 ? [] : t.drivers.map(d => ({ abbrev: d.abbrev, team: t.name })))];
  const sum = applyResult(c, order);
  assert.ok(sum.upkeep > 0, "upkeep charged");
  assert.equal(sum.net, sum.prize + sum.sponsorIncome - sum.runningCost - sum.salaries - sum.upkeep);
});

test("migrate upgrades a v4 save to v5 (adds staff)", () => {
  const v4 = { v: 4, teamIdx: 1, seed: 3, season: 1, round: 0, money: 0, driverPts: {}, teamPts: {}, board: { targetPos: 2 }, sponsors: [], costCap: false, pendingOffers: [], carDev: {}, project: null, devSpentThisSeason: 0, drivers: {}, lastResult: null, history: [], done: false };
  const up = migrate(v4);
  assert.equal(up.v, CAREER_V);
  assert.ok(up.staff && up.staff.facilities);
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test ApexWeb/tests/career.test.js` → FAIL.

- [ ] **Step 3: Implement** — edit `ApexWeb/src/career.js`:

Add the import after the drivers import:
```js
import { initStaff, upkeep } from "./staff.js";
```
Bump version — `export const CAREER_V = 4;` → `export const CAREER_V = 5;            // career save schema version`.
In `newCareer`, add the staff after `drivers: initDrivers(),`:
```js
    drivers: initDrivers(),
    staff: initStaff(TEAMS[teamIdx].facility, s),
```
In `applyResult`, add upkeep to the ledger. Change:
```js
  const net = prize + sponsorIncome - RUNNING_COST - salaries;
  career.money += net;
  const summary = {
    round: career.round, gp: CALENDAR[career.round].name, podium, bestPos,
    prize, sponsorIncome, runningCost: RUNNING_COST, salaries, net,
```
to:
```js
  const up = upkeep(career.staff);
  const net = prize + sponsorIncome - RUNNING_COST - salaries - up;
  career.money += net;
  const summary = {
    round: career.round, gp: CALENDAR[career.round].name, podium, bestPos,
    prize, sponsorIncome, runningCost: RUNNING_COST, salaries, upkeep: up, net,
```
Extend `migrate` — add a v<5 block before `return career;`:
```js
  if (career.v < 5) {
    career.staff = career.staff || initStaff((TEAMS[career.teamIdx] || TEAMS[0]).facility, career.seed || 1);
    career.v = 5;
  }
```
In `newSeason`, carry the staff (deep-copy) — after the drivers deep-copy line add:
```js
  fresh.staff = JSON.parse(JSON.stringify(career.staff || initStaff((TEAMS[career.teamIdx] || TEAMS[0]).facility, career.seed || 1)));
```

- [ ] **Step 4: Run to verify it passes** — `node --test ApexWeb/tests/career.test.js` → all pass (the M4 ledger test still holds — it doesn't reference upkeep; the new test does). NOTE: the M4 test "applyResult books driver salaries" asserts `sum.net === prize + sponsorIncome - runningCost - salaries`. That's now off by `upkeep`. At a fresh McLaren career the facilities are level 2 (0.95×3≈3 → upkeep>0), so that assert breaks. UPDATE the M4 test's net assertion to `- sum.salaries - sum.upkeep` and add `assert.ok(sum.upkeep >= 0)`.

- [ ] **Step 5: Commit** — `git add ApexWeb/src/career.js ApexWeb/tests/career.test.js` → `feat(apexweb): career v5 — staff/facilities + upkeep (M5)`.

---

## Task 4: main.js — player personnel from staff + upgrade command

**Files:** Modify `ApexWeb/src/main.js` (READ first).

- [ ] **Step 1: Import.** Add after the drivers import:
```js
import { composePersonnel, upgradeStaff, upgradeFacility } from "./staff.js";
```

- [ ] **Step 2: buildField composes the player team's personnel from staff.** In `buildField`, change:
```js
      attrs: driverAttrs(d.abbrev, overall), personnel: genPersonnel(t.facility, ti),
```
to:
```js
      attrs: driverAttrs(d.abbrev, overall), personnel: (ctx.career && isPlayerTeam) ? composePersonnel(ctx.career.staff) : genPersonnel(t.facility, ti),
```

- [ ] **Step 3: practiceCars uses staff personnel for the player team.** In `practiceCars`, change:
```js
  const personnel = genPersonnel(t.facility, ctx.teamIdx || 0);   // shared crew/facility → speeds setup learning a little
```
to:
```js
  const personnel = ctx.career ? composePersonnel(ctx.career.staff) : genPersonnel(t.facility, ctx.teamIdx || 0);
```

- [ ] **Step 4: Upgrade command.** In `onCommand`, after the `career_resign` case:
```js
    case "career_upgrade":
      if (ctx.career) {
        if (cmd.kind === "staff") upgradeStaff(ctx.career, cmd.key);
        else if (cmd.kind === "facility") upgradeFacility(ctx.career, cmd.key);
        saveCareer(ctx.career); publishCareer(); rerender();
      }
      break;
```

- [ ] **Step 5: Verify** — `node --check ApexWeb/src/main.js` → OK. `node --test` → all green.

- [ ] **Step 6: Commit** — `git add ApexWeb/src/main.js` → `feat(apexweb): player personnel from staff + upgrade command (M5)`.

---

## Task 5: season.js — team (staff & facilities) panel

**Files:** Modify `ApexWeb/src/ui/season.js` (READ first).

- [ ] **Step 1: Implement.** Add the import:
```js
import { STAFF_ROLES, ROLE_LABEL, FACILITIES, FAC_LABEL, FAC_MAX, STAFF_UPGRADE_COST, FAC_UPGRADE_BASE, upkeep } from "../staff.js";
```
Build a team panel after the drivers panel (`driversPanel`) — insert before `// season-start title-sponsor choice`:
```js
  // staff & facilities panel
  const st = c.staff;
  const staffPanel = st ? `<div class="panel"><p class="label">Команда · содержание ${m$(upkeep(st))}/гонка</p>
    <table style="width:100%;border-collapse:collapse">
    ${STAFF_ROLES.map(rk => row([ROLE_LABEL[rk], `${Math.round(st[rk] * 100)}`,
      `<button class="ready stf" data-kind="staff" data-key="${rk}" ${c.money < STAFF_UPGRADE_COST || st[rk] >= 0.99 ? "disabled" : ""} style="padding:3px 8px;font-size:12px">+ (${m$(STAFF_UPGRADE_COST)})</button>`])).join("")}
    ${FACILITIES.map(fk => { const lvl = st.facilities[fk]; const cost = FAC_UPGRADE_BASE * (lvl + 1);
      return row([FAC_LABEL[fk], `ур. ${lvl}/${FAC_MAX}`,
      `<button class="ready stf" data-kind="facility" data-key="${fk}" ${lvl >= FAC_MAX || c.money < cost ? "disabled" : ""} style="padding:3px 8px;font-size:12px">+ (${m$(cost)})</button>`]); }).join("")}
    </table></div>` : "";
```
Insert `${staffPanel}` into the layout — after `${driversPanel}`:
```js
    ${driversPanel}
    ${staffPanel}
    ${offers}
```
Wire the upgrade buttons — after the resign wiring:
```js
  root.querySelectorAll("button.stf").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_upgrade", player: ctx.myPlayer, kind: b.dataset.kind, key: b.dataset.key }); });
```

- [ ] **Step 2: Verify** — `node --check ApexWeb/src/ui/season.js` → OK.

- [ ] **Step 3: Commit** — `git add ApexWeb/src/ui/season.js` → `feat(apexweb): paddock team panel — staff & facilities upgrades (M5)`.

---

## Task 6: career_balance.mjs — staff corridor

**Files:** Modify `ApexWeb/tools/career_balance.mjs`.

- [ ] **Step 1: Implement.** The harness `field()` should compose the player team's personnel from staff (so upgrades show). Add the import:
```js
import { composePersonnel, upgradeStaff, upgradeFacility, upkeep } from "../src/staff.js";
```
In `field()`, change the personnel for the player team (teamIdx 0 in the corridor). Replace the `personnel:` in the field object:
```js
      attrs: driverAttrs(d.abbrev, overall), personnel: genPersonnel(t.facility, ti),
```
with:
```js
      attrs: driverAttrs(d.abbrev, overall), personnel: (ti === career.teamIdx && career.staff) ? composePersonnel(career.staff) : genPersonnel(t.facility, ti),
```
In the season loop, upgrade the design office a few times early (when affordable) — after the existing `startProject(...)` line:
```js
  if (career.round < 6 && career.money > 8000) { upgradeStaff(career, "designer"); upgradeFacility(career, "design"); }
```
After the dev report block, log upkeep + assert solvency held with upkeep. Before `console.log("CAREER CORRIDOR OK");` add:
```js
console.log(`staff: designer ${Math.round(career.staff.designer * 100)}, design office L${career.staff.facilities.design}, upkeep ${(upkeep(career.staff)).toFixed(0)}k/race`);
```
(The existing `if (career.money <= 0)` solvency assert now covers upkeep + salaries + dev spend together.)

- [ ] **Step 2: Run it** — `node ApexWeb/tools/career_balance.mjs` → season completes, money still > 0 (upkeep + salaries + dev didn't bankrupt the top team), the `staff:` line shows the upgraded design office, "CAREER CORRIDOR OK".

- [ ] **Step 3: Commit** — `git add ApexWeb/tools/career_balance.mjs` → `test(apexweb): staff upgrades + upkeep corridor (M5)`.

---

## Final verification

- [ ] `node --test ApexWeb/tests/*.test.js` → all green.
- [ ] `node ApexWeb/tools/career_balance.mjs` → CAREER CORRIDOR OK (+ staff line).
- [ ] Preview: career → paddock → **Команда** panel (3 staff ratings + 3 facilities with + buttons + upkeep); upgrade one → money drops, rating/level rises. (Owner F5: a better design office out-develops rivals; a better pit crew = quicker stops.)

## Self-review
- **Spec coverage:** staff as people ✓ (designer→dev, strategist→strategy, pitCrew→pitMult), facilities ✓ (3 with levels + cost + upkeep), hire/upgrade ✓. Staff market (poaching) = **M6**.
- **Determinism/balance:** at start, composed personnel ≈ genPersonnel range (neutral); devMult 1.0 at a neutral office; upkeep is a deterministic expense. Sim untouched.
- **Integration:** only buildField/practiceCars (player team) + tickDevelopment read staff; AI teams keep genPersonnel. Ledger now includes upkeep; the M4 ledger test updated.
- **WIP isolation:** explicit pathspecs; re-read main.js/season.js before editing.
