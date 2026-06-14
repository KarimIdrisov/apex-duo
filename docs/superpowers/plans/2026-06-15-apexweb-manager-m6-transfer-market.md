# M6 — Transfer Market & Negotiation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** A living driver market. The player signs a driver from a rival (a swap that pays a transfer fee); AI teams churn their line-ups each season. The grid genuinely changes — `buildField` races the *career roster* (drivers grouped by their current team) instead of the static table, so a transfer changes who's on track.

**Architecture:** A pure `market.js` (`driverValue`, `availableDrivers`, `signDriver` = a two-team swap, `aiChurn`). `drivers.js` exports `DRIVER_NAME`. `career.js` runs `aiChurn` at `newSeason` (deterministic). `buildField` (and the harness `field()`) build each team from the career registry by `teamIdx` (lead first), so transfers + churn take effect. `season.js` gets a transfer panel. No new career fields — the registry's `teamIdx` is the single source of truth (already present since M4); the swap keeps every team at exactly 2 drivers. Sim/quali/practice byte-unchanged.

**Tech Stack:** Vanilla JS ES modules, Node `node --test`, deterministic.

**Spec:** `docs/superpowers/specs/2026-06-15-apexweb-manager-career-design.md` (Phase M6). Builds on M1–M5.

---

## File Structure

```
ApexWeb/src/market.js          NEW — pure: driverValue, availableDrivers, signDriver (swap), aiChurn
ApexWeb/src/drivers.js         MODIFY — export DRIVER_NAME (abbrev -> display name)
ApexWeb/src/career.js          MODIFY — aiChurn at newSeason
ApexWeb/src/main.js            MODIFY — teamRoster() helper; buildField + practiceCars build from the roster; career_sign command
ApexWeb/src/ui/season.js       MODIFY — transfer panel (top available drivers + swap-with buttons)
ApexWeb/tests/market.test.js   NEW
ApexWeb/tests/career.test.js   MODIFY — aiChurn keeps the grid at 2/team
ApexWeb/tools/career_balance.mjs   MODIFY — field() from the roster; a transfer happens; grid integrity holds
```

Explicit pathspecs; re-read main.js/season.js immediately before editing.

---

## Task 1: market.js + DRIVER_NAME (pure)

**Files:** Create `ApexWeb/src/market.js`; Modify `ApexWeb/src/drivers.js`; Test `ApexWeb/tests/market.test.js`.

- [ ] **Step 1: Failing test** — `ApexWeb/tests/market.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { initDrivers, DRIVER_NAME } from "../src/drivers.js";
import { driverValue, availableDrivers, signDriver, aiChurn } from "../src/market.js";

function career(teamIdx = 0) { return { teamIdx, money: 200000, drivers: initDrivers(), seed: 1 }; }
const grid2 = c => { const n = {}; for (const a in c.drivers) n[c.drivers[a].teamIdx] = (n[c.drivers[a].teamIdx] || 0) + 1; return n; };

test("DRIVER_NAME maps every grid abbrev to a display name", () => {
  assert.ok(DRIVER_NAME["NOR"] && DRIVER_NAME["VER"]);
});

test("driverValue rises with overall and is discounted for older drivers", () => {
  assert.ok(driverValue({ overall: 0.95, age: 25 }) > driverValue({ overall: 0.80, age: 25 }));
  assert.ok(driverValue({ overall: 0.90, age: 40 }) < driverValue({ overall: 0.90, age: 25 }));
});

test("availableDrivers lists everyone NOT on the player team, best first, with a value", () => {
  const c = career(0);
  const av = availableDrivers(c);
  assert.ok(av.every(d => c.drivers[d.abbrev].teamIdx !== 0));
  assert.ok(av[0].overall >= av[1].overall && av[0].value > 0);
  assert.ok(!av.some(d => d.abbrev === "NOR"), "your own driver isn't on the market");
});

test("signDriver swaps the rival in for your driver, pays the fee, keeps every team at 2", () => {
  const c = career(0);
  const ver = "VER", out = "PIA";                       // VER (Red Bull) <-> PIA (McLaren)
  const rivalTeam = c.drivers[ver].teamIdx;
  const fee = driverValue(c.drivers[ver]);
  assert.equal(signDriver(c, ver, out), true);
  assert.equal(c.drivers[ver].teamIdx, 0);              // VER now drives for the player
  assert.equal(c.drivers[out].teamIdx, rivalTeam);      // PIA took the Red Bull seat
  assert.equal(c.money, 200000 - fee);
  for (const k in grid2(c)) assert.equal(grid2(c)[k], 2, "every team still has 2 drivers");
  assert.equal(signDriver(c, "NOR", "VER"), false);     // can't sign your own driver
});

test("signDriver refused when broke", () => {
  const c = career(0); c.money = 1;
  assert.equal(signDriver(c, "VER", "PIA"), false);
});

test("aiChurn swaps AI drivers deterministically, never touches the player team, keeps 2/team", () => {
  const c = career(0), d = career(0);
  const e1 = aiChurn(c, 42), e2 = aiChurn(d, 42);
  assert.deepEqual(e1, e2);                             // deterministic
  for (const k in grid2(c)) assert.equal(grid2(c)[k], 2);
  assert.equal(c.drivers["NOR"].teamIdx, 0);            // player team untouched
  assert.equal(c.drivers["PIA"].teamIdx, 0);
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test ApexWeb/tests/market.test.js` → FAIL (no module / no DRIVER_NAME).

- [ ] **Step 3a: Implement DRIVER_NAME** — in `ApexWeb/src/drivers.js`, after the `DRIVER_AGE` const add:

```js
// abbrev -> display name (for the dynamic roster, since the field no longer reads the static TEAMS roster).
export const DRIVER_NAME = {};
for (const t of TEAMS) for (const d of t.drivers) DRIVER_NAME[d.abbrev] = d.name;
```

- [ ] **Step 3b: Implement market.js** — `ApexWeb/src/market.js`:

```js
// ApexWeb/src/market.js — pure driver transfer market. Transfers swap two drivers between teams
// (the registry's teamIdx is the source of truth), so every team always keeps exactly 2 drivers.
import { mix32 } from "./rng.js";

// transfer fee ($k) — steep with overall, discounted for older drivers.
export function driverValue(driver) {
  const ageFactor = driver.age <= 30 ? 1 : Math.max(0.4, 1 - (driver.age - 30) * 0.06);
  return Math.round((2000 + Math.pow(Math.max(0, driver.overall - 0.7), 1.7) * 60000) * ageFactor);
}

// drivers available to sign (everyone not on the player team), best first, with a value.
export function availableDrivers(career) {
  return Object.keys(career.drivers)
    .filter(ab => career.drivers[ab].teamIdx !== career.teamIdx)
    .map(ab => ({ abbrev: ab, ...career.drivers[ab], value: driverValue(career.drivers[ab]) }))
    .sort((a, b) => b.overall - a.overall);
}

// sign inAbbrev (a rival) by swapping with outAbbrev (one of the player's drivers). Pays the fee.
export function signDriver(career, inAbbrev, outAbbrev) {
  const inDr = career.drivers[inAbbrev], outDr = career.drivers[outAbbrev];
  if (!inDr || !outDr) return false;
  if (inDr.teamIdx === career.teamIdx || outDr.teamIdx !== career.teamIdx) return false;   // in = rival, out = mine
  const fee = driverValue(inDr);
  if (career.money < fee) return false;
  career.money -= fee;
  const rivalTeam = inDr.teamIdx;
  inDr.teamIdx = career.teamIdx;          // joins the player
  outDr.teamIdx = rivalTeam;              // dropped driver takes the rival seat (swap keeps both at 2)
  inDr.morale = Math.min(1, inDr.morale + 0.1);
  inDr.contractSeasons = 3;
  return true;
}

// deterministic season-end AI churn: a couple of swaps among AI teams to keep the grid alive.
export function aiChurn(career, seed) {
  const ai = Object.keys(career.drivers).filter(ab => career.drivers[ab].teamIdx !== career.teamIdx);
  const events = [];
  for (let k = 0; k < 2 && ai.length >= 2; k++) {
    const r = mix32(((seed >>> 0) + k * 40503) >>> 0);
    const a = ai[r % ai.length], b = ai[(r >>> 8) % ai.length];
    const da = career.drivers[a], db = career.drivers[b];
    if (a === b || da.teamIdx === db.teamIdx) continue;     // need two different AI teams
    const ta = da.teamIdx; da.teamIdx = db.teamIdx; db.teamIdx = ta;
    events.push({ a, b });
  }
  return events;
}
```

- [ ] **Step 4: Run to verify it passes** — `node --test ApexWeb/tests/market.test.js` → all pass. `node --test ApexWeb/tests/drivers.test.js` → still green.

- [ ] **Step 5: Commit** — `git add ApexWeb/src/market.js ApexWeb/src/drivers.js ApexWeb/tests/market.test.js` → `feat(apexweb): driver transfer market — value/available/sign(swap)/aiChurn (M6)`.

---

## Task 2: career.js — AI churn at season end

**Files:** Modify `ApexWeb/src/career.js`; Test `ApexWeb/tests/career.test.js`.

- [ ] **Step 1: Add a failing test** — append to `ApexWeb/tests/career.test.js`:

```js
test("newSeason runs AI churn but keeps every team at 2 drivers and the player team intact", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  const c2 = newSeason(c);
  const counts = {};
  for (const a in c2.drivers) counts[c2.drivers[a].teamIdx] = (counts[c2.drivers[a].teamIdx] || 0) + 1;
  for (const k in counts) assert.equal(counts[k], 2);
  assert.equal(c2.drivers["NOR"].teamIdx, 0);            // player team not churned
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test ApexWeb/tests/career.test.js` → likely still PASSES (churn not wired yet but the grid is already 2/team). To make it meaningful, ALSO assert churn changed at least one AI seat: append inside the test, before the closing brace:
```js
  let moved = 0; for (const a in c.drivers) if (c.drivers[a].teamIdx !== c2.drivers[a].teamIdx) moved++;
  assert.ok(moved >= 2, "AI churn moved at least one pair");
```
Now it FAILS (no churn → moved 0).

- [ ] **Step 3: Implement** — in `ApexWeb/src/career.js`, add the import after the staff import:
```js
import { aiChurn } from "./market.js";
```
In `newSeason`, after the `developDrivers(fresh.drivers);` line add:
```js
  aiChurn(fresh, (fresh.seed >>> 0) + fresh.season * 2246822519);   // deterministic AI silly-season
```

- [ ] **Step 4: Run to verify it passes** — `node --test ApexWeb/tests/career.test.js` → all pass.

- [ ] **Step 5: Commit** — `git add ApexWeb/src/career.js ApexWeb/tests/career.test.js` → `feat(apexweb): AI driver churn at season end (M6)`.

---

## Task 3: main.js — race the career roster + sign command

**Files:** Modify `ApexWeb/src/main.js` (READ first).

- [ ] **Step 1: Imports.** Add after the staff import:
```js
import { DRIVER_NAME } from "./drivers.js";
import { signDriver } from "./market.js";
```

- [ ] **Step 2: Add the teamRoster helper.** Just above `function buildField() {`, add:
```js
// a team's drivers as [{abbrev, name, skill}], lead first. Career mode reads the dynamic registry
// (transfers/churn change teamIdx); otherwise the static TEAMS roster.
function teamRoster(ti) {
  if (!ctx.career || !ctx.career.drivers) return TEAMS[ti].drivers.map(d => ({ abbrev: d.abbrev, name: d.name, skill: d.skill }));
  return Object.keys(ctx.career.drivers)
    .filter(ab => ctx.career.drivers[ab].teamIdx === ti)
    .sort((a, b) => ctx.career.drivers[b].overall - ctx.career.drivers[a].overall)
    .map(ab => ({ abbrev: ab, name: DRIVER_NAME[ab] || ab, skill: ctx.career.drivers[ab].overall }));
}
```

- [ ] **Step 3: buildField iterates the roster.** Change:
```js
  return TEAMS.flatMap((t, ti) => t.drivers.map((d, di) => {
```
to:
```js
  return TEAMS.flatMap((t, ti) => teamRoster(ti).map((d, di) => {
```
(The map body is unchanged: it already reads `d.abbrev`, `d.name`, `d.skill`, and looks up `ctx.career.drivers[d.abbrev]`.)

- [ ] **Step 4: practiceCars uses the roster.** Change:
```js
  const t = TEAMS[ctx.teamIdx] || TEAMS[0];
  const personnel = ctx.career ? composePersonnel(ctx.career.staff) : genPersonnel(t.facility, ctx.teamIdx || 0);   // staff crew/facility → personnel
  const mk = di => ({ drv: { skill: t.drivers[di].skill, attrs: driverAttrs(t.drivers[di].abbrev, t.drivers[di].skill) }, car, personnel });
  return { p1: mk(0), p2: mk(1) };
```
to:
```js
  const t = TEAMS[ctx.teamIdx] || TEAMS[0];
  const personnel = ctx.career ? composePersonnel(ctx.career.staff) : genPersonnel(t.facility, ctx.teamIdx || 0);   // staff crew/facility → personnel
  const roster = teamRoster(ctx.teamIdx);
  const mk = di => { const d = roster[di] || roster[0]; return { drv: { skill: d.skill, attrs: driverAttrs(d.abbrev, d.skill) }, car, personnel }; };
  return { p1: mk(0), p2: mk(1) };
```

- [ ] **Step 5: Sign command.** In `onCommand`, after the `career_upgrade` case:
```js
    case "career_sign":
      if (ctx.career) { signDriver(ctx.career, cmd.inAbbrev, cmd.outAbbrev); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
```

- [ ] **Step 6: Verify** — `node --check ApexWeb/src/main.js` → OK. `node --test` → all green.

- [ ] **Step 7: Commit** — `git add ApexWeb/src/main.js` → `feat(apexweb): race the career roster (transfers change the grid) + sign command (M6)`.

---

## Task 4: season.js — transfer panel

**Files:** Modify `ApexWeb/src/ui/season.js` (READ first).

- [ ] **Step 1: Implement.** Add the imports:
```js
import { availableDrivers } from "../market.js";
import { DRIVER_NAME } from "../drivers.js";
```
Build a transfer panel after the staff panel (`staffPanel`) — insert before `// season-start title-sponsor choice`:
```js
  // transfer panel — top available drivers; swap one in for one of yours
  const mineAbbrevs = mine.map(([ab]) => ab);
  const avail = c.drivers ? availableDrivers(c).slice(0, 6) : [];
  const transferPanel = (mineAbbrevs.length && avail.length) ? `<div class="panel"><p class="label">Трансферы — подписать пилота (обмен)</p>
    <table style="width:100%;border-collapse:collapse">
    ${avail.map(d => row([`<b>${d.abbrev}</b> ${DRIVER_NAME[d.abbrev] || ""}`, `ovr ${d.overall.toFixed(3)}`, `${d.age} л.`, m$(d.value),
      mineAbbrevs.map(ab => `<button class="ready sign" data-in="${d.abbrev}" data-out="${ab}" ${c.money < d.value ? "disabled" : ""} style="padding:3px 6px;font-size:11px;margin-left:4px">↔${ab}</button>`).join("")])).join("")}
    </table></div>` : "";
```
Insert `${transferPanel}` into the layout — after `${staffPanel}`:
```js
    ${staffPanel}
    ${transferPanel}
    ${offers}
```
Wire the sign buttons — after the staff (`button.stf`) wiring:
```js
  root.querySelectorAll("button.sign").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_sign", player: ctx.myPlayer, inAbbrev: b.dataset.in, outAbbrev: b.dataset.out }); });
```

- [ ] **Step 2: Verify** — `node --check ApexWeb/src/ui/season.js` → OK.

- [ ] **Step 3: Commit** — `git add ApexWeb/src/ui/season.js` → `feat(apexweb): paddock transfer panel — sign a driver (M6)`.

---

## Task 5: career_balance.mjs — race the roster + transfer integrity

**Files:** Modify `ApexWeb/tools/career_balance.mjs`.

- [ ] **Step 1: Implement.** The harness `field()` must build from the registry like the game (else a transfer wouldn't race). Add the import:
```js
import { signDriver, availableDrivers } from "../src/market.js";
import { DRIVER_NAME } from "../src/drivers.js";
```
Replace the `field()` function with a roster-based one:
```js
function field() {
  let idx = 0;
  const rosterOf = ti => Object.keys(career.drivers || {}).filter(ab => career.drivers[ab].teamIdx === ti)
    .sort((a, b) => career.drivers[b].overall - career.drivers[a].overall);
  return TEAMS.flatMap((t, ti) => rosterOf(ti).map(ab => {
    const dr = career.drivers[ab];
    return {
      idx: idx++, name: DRIVER_NAME[ab] || ab, abbrev: ab, skill: dr.overall,
      car: composeCar(effectiveCar(t.car, career.carDev && career.carDev[t.name])), color: t.color, team: t.name,
      attrs: driverAttrs(ab, dr.overall), personnel: (ti === career.teamIdx && career.staff) ? composePersonnel(career.staff) : genPersonnel(t.facility, ti),
      setup: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5], setupBonus: moraleMod(dr.morale), startTyre: "medium",
    };
  }));
}
```
Right after `const career = newCareer({ teamIdx: 0, seed: 1 });`, sign a marquee driver to prove the transfer races:
```js
{ const av = availableDrivers(career)[0]; const out = Object.keys(career.drivers).find(a => career.drivers[a].teamIdx === 0);
  const ok = signDriver(career, av.abbrev, out); console.log(`transfer: signed ${av.abbrev} (ovr ${av.overall.toFixed(3)}) for ${out} -> ${ok}`); }
```
After the loop, assert grid integrity (every team has 2 drivers) + report. Before `console.log("CAREER CORRIDOR OK");`:
```js
const counts = {}; for (const a in career.drivers) counts[career.drivers[a].teamIdx] = (counts[career.drivers[a].teamIdx] || 0) + 1;
const bad = Object.entries(counts).filter(([, n]) => n !== 2);
console.log(`grid integrity: ${Object.keys(counts).length} teams, ${bad.length === 0 ? "all 2 drivers" : "BAD " + JSON.stringify(bad)}`);
if (bad.length) { console.error("a team does not have exactly 2 drivers after transfers/churn"); process.exit(1); }
```

- [ ] **Step 2: Run it** — `node ApexWeb/tools/career_balance.mjs` → the `transfer:` line shows the signing, the season runs (the signed driver now races for the player), grid integrity = all 2 drivers, "CAREER CORRIDOR OK". (The champion may now read the signed driver's abbrev for the player team — expected.)

- [ ] **Step 3: Commit** — `git add ApexWeb/tools/career_balance.mjs` → `test(apexweb): roster-based field + transfer integrity corridor (M6)`.

---

## Final verification

- [ ] `node --test ApexWeb/tests/*.test.js` → all green.
- [ ] `node ApexWeb/tools/career_balance.mjs` → CAREER CORRIDOR OK (+ transfer + grid integrity lines).
- [ ] Preview: career → paddock → **Трансферы** panel lists top available drivers with value + ↔ buttons; signing swaps a driver onto your team (the **Пилоты** panel updates, money drops). (Owner F5: the signed driver races next round; AI line-ups shift between seasons.)

## Self-review
- **Spec coverage:** poach drivers ✓ (signDriver swap + fee), negotiate (fee/contract on signing; deeper haggling deferred), AI competes/churns ✓ (aiChurn each season), grid changes ✓ (buildField races the roster). Staff poaching = M5 upgrades.
- **Determinism/integrity:** aiChurn seeded; the swap keeps every team at exactly 2 drivers (corridor asserts it); no new career fields (teamIdx is the truth). Sim untouched.
- **Integration risk:** buildField now iterates `teamRoster(ti)` — the map body is unchanged (reads d.abbrev/name/skill). Non-career returns the static roster (identical behaviour). The harness field() mirrors this.
- **WIP isolation:** explicit pathspecs; re-read main.js/season.js before editing.
