# D3 — Car Development → MM-style Parts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Replace M3's 5 abstract dev scalars with real **car parts** (front wing, rear wing, floor, sidepods, suspension, power unit). Each part develops via a project and **composes into** the 5 sim indicators (power/aero/tyre/fuel/rel) through a contribution matrix — so the sim is still fed the same 5 numbers, but the player now designs parts like in Motorsport Manager.

**Architecture:** `development.js` swaps the per-indicator `carDev` deltas for per-team **part levels** (`career.parts`); `partsToDeltas()` maps part levels → indicator deltas via `PART_CONTRIB`; `effectiveCar(base, parts)` composes them. Projects/AI dev/regulation-reset all operate on parts. `career.js` v8 stores `career.parts` (replaces `carDev`); migrate resets parts (dev-only saves; regs reset anyway). All `carDev` references (main/season/corridor) rename to `parts`. Sim/quali/practice byte-unchanged (still get 5 indicators via `composeCar(effectiveCar(...))`). Suppliers/buy-vs-build deferred (D3 follow-up).

**Tech Stack:** Vanilla JS ES modules, Node `node --test`, deterministic.

**Spec:** `docs/superpowers/specs/2026-06-15-apexweb-manager-v2-depth-design.md` (D3). Builds on M3/M5/M7/M8 dev model.

---

## File Structure

```
ApexWeb/src/development.js     MODIFY — PARTS + PART_CONTRIB + partsToDeltas; effectiveCar(base, parts); startProject(part); tickDevelopment over parts
ApexWeb/src/career.js          MODIFY — v8: career.parts (replaces carDev); migrate; newCareer; newSeason regulation reset over parts
ApexWeb/src/main.js            MODIFY — buildField/practiceCars compose from parts; career_project takes {part,size}
ApexWeb/src/ui/season.js       MODIFY — dev panel shows part levels + per-part projects + composed-car readout
ApexWeb/tests/development.test.js MODIFY — parts model
ApexWeb/tests/career.test.js   MODIFY — parts state + migrate v7->v8
ApexWeb/tools/career_balance.mjs  MODIFY — develop parts; composed car improves; spread bounded
```

Explicit pathspecs; re-read main.js/season.js immediately before editing.

---

## Task 1: development.js — the parts model

**Files:** Modify `ApexWeb/src/development.js`; Test `ApexWeb/tests/development.test.js`.

- [ ] **Step 1: Replace the indicator-delta model with parts.** REPLACE the whole of `development.js` with:

```js
// ApexWeb/src/development.js — pure MM-style car-development model. The player develops PARTS;
// parts compose into the 5 sim indicators (power/aero/tyre/fuel/rel) via PART_CONTRIB. The sim still
// reads the 5 composed indicators (composeCar). AI develops parts deterministically (catch-up biased).
import { mix32 } from "./rng.js";
import { TEAMS } from "./data.js";
import { devMult } from "./staff.js";
import { academyDevBonus } from "./academy.js";

export const INDICATORS = ["power", "aero", "tyre", "fuel", "rel"];

// the developable parts and how each contributes to the indicators (per unit of part level).
export const PARTS = ["fw", "rw", "floor", "sidepods", "susp", "pu"];
export const PART_LABEL = { fw: "Переднее крыло", rw: "Заднее крыло", floor: "Днище", sidepods: "Понтоны", susp: "Подвеска", pu: "Силовая установка" };
export const PART_CONTRIB = {
  fw:       { aero: 0.50, tyre: 0.20 },
  rw:       { aero: 0.45, fuel: 0.10 },
  floor:    { aero: 0.60, tyre: 0.15 },
  sidepods: { fuel: 0.40, rel: 0.20, aero: 0.15 },
  susp:     { tyre: 0.50, aero: 0.20 },
  pu:       { power: 0.70, fuel: 0.30, rel: 0.15 },
};

// upgrade sizes: part-level gain, $k cost, races to complete, risk (chance-weighted shortfall).
export const PROJECT_SIZE = {
  small:  { gain: 0.012, cost: 1200, races: 1, risk: 0.10, label: "Малый" },
  medium: { gain: 0.024, cost: 3000, races: 2, risk: 0.20, label: "Средний" },
  large:  { gain: 0.042, cost: 6000, races: 3, risk: 0.32, label: "Крупный" },
};

export const COST_CAP = 30000;
const AI_DEV_RATE = 0.0060;   // per round, × facility × catch-up, spread over the team's parts

const zeroParts = () => ({ fw: 0, rw: 0, floor: 0, sidepods: 0, susp: 0, pu: 0 });
function clampInd(k, v) { return k === "rel" ? Math.max(0.3, Math.min(0.995, v)) : Math.max(0.3, Math.min(1.20, v)); }

// part levels -> indicator deltas via PART_CONTRIB.
export function partsToDeltas(parts) {
  const d = { power: 0, aero: 0, tyre: 0, fuel: 0, rel: 0 };
  if (!parts) return d;
  for (const p of PARTS) { const lvl = parts[p] || 0; const c = PART_CONTRIB[p];
    for (const k in c) d[k] += lvl * c[k]; }
  return d;
}

// base car + composed part deltas -> the effective car the sim composes. energy passes through.
export function effectiveCar(baseCar, parts) {
  const dlt = partsToDeltas(parts);
  const out = { ...baseCar };
  for (const k of INDICATORS) {
    const b = baseCar[k] ?? (k === "tyre" || k === "fuel" ? 1 : 0.85);
    out[k] = clampInd(k, b + (dlt[k] || 0));
  }
  return out;
}

// start a player upgrade project on a PART. Returns the project, or null (busy / can't afford / cost cap / invalid).
export function startProject(career, part, size) {
  if (career.project) return null;
  const spec = PROJECT_SIZE[size];
  if (!spec || !PARTS.includes(part)) return null;
  if (career.money < spec.cost) return null;
  if (career.costCap && (career.devSpentThisSeason || 0) + spec.cost > COST_CAP) return null;
  career.money -= spec.cost;
  career.devSpentThisSeason = (career.devSpentThisSeason || 0) + spec.cost;
  career.project = { part, size, racesLeft: spec.races, gain: spec.gain, risk: spec.risk };
  return career.project;
}

// advance development one round: progress the player's part project (complete -> risk-shaved gain,
// scaled by design office + academy R&D) and develop every AI team's parts deterministically.
export function tickDevelopment(career) {
  career.parts = career.parts || {};
  for (const t of TEAMS) career.parts[t.name] = career.parts[t.name] || zeroParts();
  const events = [];
  if (career.project) {
    career.project.racesLeft -= 1;
    if (career.project.racesLeft <= 0) {
      const p = career.project;
      const roll = mix32(((career.seed >>> 0) + career.round * 2654435761) >>> 0) / 4294967296;
      const gain = p.gain * (1 - p.risk * roll) * devMult(career.staff) * (1 + academyDevBonus(career));
      career.parts[TEAMS[career.teamIdx].name][p.part] += gain;
      events.push({ type: "project_done", part: p.part, gain });
      career.project = null;
    }
  }
  TEAMS.forEach((t, i) => {
    if (i === career.teamIdx) return;
    const catchUp = 0.5 + i * 0.06;
    const base = AI_DEV_RATE * (t.facility ?? 0.75) * catchUp;
    // AI spreads dev across the two biggest-bang parts (floor + pu)
    career.parts[t.name].floor += base;
    career.parts[t.name].pu += base;
  });
  return events;
}
```

- [ ] **Step 2: Rewrite the development tests** — REPLACE `ApexWeb/tests/development.test.js` with:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { TEAMS } from "../src/data.js";
import { PARTS, PART_CONTRIB, PROJECT_SIZE, partsToDeltas, effectiveCar, startProject, tickDevelopment } from "../src/development.js";
import { initStaff } from "../src/staff.js";

function fakeCareer(over = {}) {
  return { seed: 1, teamIdx: 0, round: 0, money: 1e6, costCap: false, devSpentThisSeason: 0, parts: {}, project: null, staff: initStaff(0.6, 1), academy: [], ...over };
}

test("partsToDeltas composes part levels into indicator deltas via PART_CONTRIB", () => {
  const d = partsToDeltas({ pu: 0.1, floor: 0.1 });
  assert.ok(Math.abs(d.power - 0.07) < 1e-9, "pu 0.1 -> +0.07 power");
  assert.ok(d.aero > 0.05, "floor lifts aero");
  assert.deepEqual(partsToDeltas(null), { power: 0, aero: 0, tyre: 0, fuel: 0, rel: 0 });
});

test("effectiveCar adds composed part deltas onto the base car; rel clamped", () => {
  const base = TEAMS[5].car;
  const eff = effectiveCar(base, { pu: 0.2 });
  assert.ok(eff.power > base.power && eff.rel <= 0.995);
  assert.equal(effectiveCar(base, null).power, base.power);
});

test("startProject targets a PART, spends money, blocks a second; rejects invalid part", () => {
  const c = fakeCareer();
  assert.ok(startProject(c, "floor", "medium"));
  assert.equal(c.money, 1e6 - PROJECT_SIZE.medium.cost);
  assert.equal(startProject(c, "pu", "small"), null);          // one project at a time
  assert.equal(startProject(fakeCareer(), "wing", "small"), null);
});

test("tickDevelopment completes a part project + develops AI parts (catch-up: backmarker > top)", () => {
  const c = fakeCareer();
  startProject(c, "pu", "small");
  tickDevelopment(c);
  assert.equal(c.project, null);
  assert.ok(c.parts["McLaren"].pu > 0);
  assert.ok(c.parts[TEAMS[10].name].pu > c.parts[TEAMS[1].name].pu, "weaker team develops faster");
});

test("devMult + academy scale the part gain; deterministic", () => {
  const weak = (() => { const c = fakeCareer({ staff: initStaff(0.6, 1) }); startProject(c, "pu", "small"); tickDevelopment(c); return c.parts["McLaren"].pu; })();
  const strong = (() => { const c = fakeCareer({ staff: { ...initStaff(0.99, 1), facilities: { design: 5, pit: 5, factory: 5 } }, academy: [{ abbrev: "X" }] }); startProject(c, "pu", "small"); tickDevelopment(c); return c.parts["McLaren"].pu; })();
  assert.ok(strong > weak, "better design office + academy develops more");
});
```

- [ ] **Step 3: Run** — `node --test ApexWeb/tests/development.test.js` → all pass.

- [ ] **Step 4: Commit** — `git add ApexWeb/src/development.js ApexWeb/tests/development.test.js` → `feat(apexweb): car development → MM-style parts model (D3)`.

---

## Task 2: career.js — v8 parts (replaces carDev)

**Files:** Modify `ApexWeb/src/career.js`; Test `ApexWeb/tests/career.test.js`.

- [ ] **Step 1: Add failing tests** — append to `ApexWeb/tests/career.test.js`:

```js
import { startProject as startPartProject } from "../src/development.js";

test("D3: newCareer at v8 carries parts (not carDev)", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  assert.ok(c.v >= 8);
  assert.ok(c.parts && typeof c.parts === "object");
});

test("D3: advanceRound develops parts; newSeason regulation-resets parts", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  startPartProject(c, "floor", "small"); advanceRound(c);
  assert.ok(c.parts["McLaren"].floor > 0);
  c.parts["McLaren"].floor = 0.1;
  const c2 = newSeason(c);
  assert.ok(c2.parts["McLaren"].floor < 0.1, "regs trim parts");
});

test("D3: migrate upgrades a v7 save to v8 (adds parts)", () => {
  const v7 = { v: 7, teamIdx: 1, seed: 3, season: 1, round: 0, money: 0, driverPts: {}, teamPts: {}, board: { targetPos: 2, confidence: 0.5 }, sponsors: [], costCap: false, pendingOffers: [], carDev: { McLaren: { power: 0.1 } }, project: null, devSpentThisSeason: 0, drivers: {}, staff: {}, academy: [], news: [], lastResult: null, history: [], done: false };
  const up = migrate(v7);
  assert.equal(up.v, CAREER_V);
  assert.ok(up.parts && typeof up.parts === "object");
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test ApexWeb/tests/career.test.js` → FAIL.

- [ ] **Step 3: Implement** — edit `ApexWeb/src/career.js`:

Bump `export const CAREER_V = 7;` → `8`.
In `newCareer`, change `carDev: {}, project: null, devSpentThisSeason: 0,` → `parts: {}, project: null, devSpentThisSeason: 0,`.
In `newSeason`, change the deep-copy + regulation-reset lines:
```js
  fresh.carDev = JSON.parse(JSON.stringify(career.carDev || {}));   // development carries over (M8 adds regulation resets)
```
becomes
```js
  fresh.parts = JSON.parse(JSON.stringify(career.parts || {}));     // part development carries over
```
and the reg-reset
```js
  for (const tn in fresh.carDev) for (const k in fresh.carDev[tn]) fresh.carDev[tn][k] *= REG_RESET;   // regs change: redevelop
```
becomes
```js
  for (const tn in fresh.parts) for (const k in fresh.parts[tn]) fresh.parts[tn][k] *= REG_RESET;      // regs change: redevelop parts
```
Extend `migrate` — add a v<8 block before `return career;`:
```js
  if (career.v < 8) {
    career.parts = career.parts || {};   // parts replace the old carDev deltas (dev reset on upgrade; regs reset anyway)
    delete career.carDev;
    career.v = 8;
  }
```

- [ ] **Step 4: Run to verify it passes** — `node --test ApexWeb/tests/career.test.js` → all pass.

- [ ] **Step 5: Commit** — `git add ApexWeb/src/career.js ApexWeb/tests/career.test.js` → `feat(apexweb): career v8 — parts replace carDev + regs reset parts (D3)`.

---

## Task 3: main.js — compose the car from parts

**Files:** Modify `ApexWeb/src/main.js` (READ first). Replace the two `effectiveCar(t.car, ctx.career.carDev[t.name])` calls and the project command.

- [ ] **Step 1:** In `buildField`, change `effectiveCar(t.car, ctx.career.carDev[t.name])` → `effectiveCar(t.car, ctx.career.parts[t.name])`.
- [ ] **Step 2:** In `practiceCars`, the same change `effectiveCar(t.car, ctx.career.parts[t.name])`.
- [ ] **Step 3:** The `career_project` case currently passes `cmd.indicator`; change to `cmd.part`:
```js
    case "career_project":
      if (ctx.career) { startProject(ctx.career, cmd.part, cmd.size); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
```
- [ ] **Step 4: Verify** — `node --check ApexWeb/src/main.js` → OK. `node --test` → green.
- [ ] **Step 5: Commit** — `git add ApexWeb/src/main.js` → `feat(apexweb): field composes the car from developed parts (D3)`.

---

## Task 4: season.js — parts dev panel

**Files:** Modify `ApexWeb/src/ui/season.js` (READ first). The development panel currently shows the 5 indicators + per-indicator project buttons. Replace its internals to show **parts** (level + project buttons) plus a compact composed-indicator readout.

- [ ] **Step 1:** Change the development.js import to the parts API:
```js
import { PARTS, PART_LABEL, PROJECT_SIZE, partsToDeltas, effectiveCar } from "../development.js";
```
- [ ] **Step 2:** Replace the dev-panel builder block (the `// development panel …` through `const devPanel = …;`) with a parts version:
```js
  // development panel — the player team's PARTS (level + projects) + the composed car indicators
  const myTeamName = me ? me.team : null;
  const baseCar = myTeamName ? (TEAMS.find(t => t.name === myTeamName) || {}).car : null;
  const parts = (c.parts && myTeamName) ? c.parts[myTeamName] : null;
  const eff = baseCar ? effectiveCar(baseCar, parts) : null;
  const partRow = (pk) => { const lvl = parts ? (parts[pk] || 0) : 0;
    return row([PART_LABEL[pk], `ур. ${(lvl * 100).toFixed(0)}`,
      c.project && c.project.part === pk ? `<span class="label">в разработке (${c.project.racesLeft})</span>`
      : Object.keys(PROJECT_SIZE).map(sz => `<button class="ready devbtn" data-k="${pk}" data-sz="${sz}" ${(c.project || c.money < PROJECT_SIZE[sz].cost) ? "disabled" : ""} style="padding:3px 6px;font-size:11px;margin-left:3px">${PROJECT_SIZE[sz].label} (${m$(PROJECT_SIZE[sz].cost)})</button>`).join("")]); };
  const carLine = eff ? `<p class="label">Машина: мотор ${eff.power.toFixed(3)} · аэро ${eff.aero.toFixed(3)} · шина ${eff.tyre.toFixed(3)} · эконом ${eff.fuel.toFixed(3)} · надёжн ${eff.rel.toFixed(3)}</p>` : "";
  const devPanel = baseCar ? `<div class="panel"><p class="label">Разработка — детали машины${c.costCap ? " · cost cap ВКЛ" : ""}</p>
    ${carLine}<table style="width:100%;border-collapse:collapse"><tbody>${PARTS.map(partRow).join("")}</tbody></table></div>` : "";
```
(The `devbtn` data attribute is now `data-k` = part key, `data-sz` = size — the existing wiring sends `cmd:"career_project"`; update its payload below.)
- [ ] **Step 3:** Update the devbtn wiring to send `part` (was `indicator`):
```js
  root.querySelectorAll("button.devbtn").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_project", player: ctx.myPlayer, part: b.dataset.k, size: b.dataset.sz }); });
```
- [ ] **Step 4: Verify** — `node --check ApexWeb/src/ui/season.js` → OK.
- [ ] **Step 5: Commit** — `git add ApexWeb/src/ui/season.js` → `feat(apexweb): paddock parts development panel (D3)`.

---

## Task 5: career_balance.mjs — parts corridor

**Files:** Modify `ApexWeb/tools/career_balance.mjs`. Replace all `carDev`/`effectiveCar(..., carDev)` with `parts`, and the dev loop to develop parts.

- [ ] **Step 1:** In `field()`, `effectiveCar(t.car, career.carDev && career.carDev[t.name])` → `effectiveCar(t.car, career.parts && career.parts[t.name])`.
- [ ] **Step 2:** The in-loop `startProject(career, ["power","aero","tyre"][career.round % 3], "small")` → develop parts: `startProject(career, ["floor","pu","fw"][career.round % 3], "small")`.
- [ ] **Step 3:** The dev report + spread block: replace `career.carDev` reads with a composed-car spread using `effectiveCar`:
```js
const effAvg = t => { const e = effectiveCar(t.car, career.parts && career.parts[t.name]); return (e.power + e.aero) / 2; };
const avgs = TEAMS.map(effAvg);
const spread = Math.max(...avgs) - Math.min(...avgs);
const myParts = career.parts[TEAMS[0].name] || {};
console.log(`dev: player parts floor +${(myParts.floor||0).toFixed(3)} pu +${(myParts.pu||0).toFixed(3)}; field (power+aero)/2 spread ${spread.toFixed(3)}`);
if (!(Object.values(myParts).some(v => v > 0))) { console.error("player car did not develop over the season"); process.exit(1); }
if (spread > 0.45) { console.error(`grid spread ${spread.toFixed(3)} too wide`); process.exit(1); }
```
- [ ] **Step 4:** The D8 regulation-reset check `regBefore/regAfter` reading `career.carDev["McLaren"].power` → read a part: `(career.parts["McLaren"]&&career.parts["McLaren"].floor)||0` vs `next.parts[...]`.
- [ ] **Step 5: Run** — `node ApexWeb/tools/career_balance.mjs` → season completes, player parts grew, composed-car spread < 0.45, regulation reset trims parts, "CAREER CORRIDOR OK". Tune `AI_DEV_RATE` / part contributions if spread drifts (report, don't silently widen).
- [ ] **Step 6: Commit** — `git add ApexWeb/tools/career_balance.mjs` → `test(apexweb): parts-development corridor (D3)`.

---

## Final verification
- [ ] `node --test ApexWeb/tests/*.test.js` → all green.
- [ ] `node ApexWeb/tools/career_balance.mjs` → CAREER CORRIDOR OK (+ parts line).
- [ ] Preview: career → paddock → **Разработка — детали машины** shows 6 part rows (level + project buttons) + a composed-car line; start a part project → money drops, "в разработке". (Owner F5: develop a part over races → its level rises → the composed indicator improves → faster car.)

## Self-review
- **Spec coverage:** MM-style parts ✓ (6 parts → 5 indicators via PART_CONTRIB), per-part projects ✓, AI parts dev ✓, regulation reset on parts ✓, composed-car readout ✓. Suppliers/buy-vs-build = deferred (noted).
- **Sim untouched:** `effectiveCar` still returns the 5 indicators `composeCar` reads; `partsToDeltas` is the only new composition.
- **Migration:** v8 resets parts (lossy carDev→parts is avoided; dev-only saves + regs reset make this safe); `delete carDev`.
- **WIP isolation:** explicit pathspecs; re-read main.js/season.js before editing.
```
