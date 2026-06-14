# M3 — Car Development Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** The career develops the car. The player invests money + time into upgrade projects that raise the 5 car indicators (power/aero/tyre/fuel/rel) with a cost/time/risk trade-off; AI teams develop deterministically with a catch-up bias so the grid order shifts across a season. This is the first phase whose state changes the race result (via `c.car`).

**Architecture:** A pure `development.js` (project sizes, `startProject`, `tickDevelopment` for player-project progress + AI dev, `effectiveCar` = base + deltas). `career.js` v3 stores per-team `carDev` deltas + the active `project`, and calls `tickDevelopment` on `advanceRound`. The one sim coupling: `buildField` composes the car from `effectiveCar(base, carDev[team])` when a career is active. `season.js` gains a development panel. The sim/quali/practice code is byte-unchanged.

**Tech Stack:** Vanilla JS ES modules, Node `node --test`, deterministic.

**Spec:** `docs/superpowers/specs/2026-06-15-apexweb-manager-career-design.md` (Phase M3). Builds on M1/M2.

---

## File Structure

```
ApexWeb/src/development.js     NEW — pure: INDICATORS, PROJECT_SIZE, effectiveCar, startProject, tickDevelopment, COST_CAP
ApexWeb/src/career.js          MODIFY — v3 (carDev/project/devSpentThisSeason), migrate, advanceRound -> tickDevelopment, newSeason reset
ApexWeb/src/main.js            MODIFY — buildField + practiceCars use effectiveCar; career_project command
ApexWeb/src/ui/season.js       MODIFY — development panel (car bars + project + start buttons)
ApexWeb/tests/development.test.js  NEW
ApexWeb/tests/career.test.js   MODIFY — carDev/project/tick cases
ApexWeb/tools/career_balance.mjs   MODIFY — player develops over a season; grid spread stays bounded
```

Explicit pathspecs; re-read main.js/season.js immediately before editing.

---

## Task 1: development.js — the development model (pure)

**Files:** Create `ApexWeb/src/development.js`; Test `ApexWeb/tests/development.test.js`.

- [ ] **Step 1: Failing test** — `ApexWeb/tests/development.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { TEAMS } from "../src/data.js";
import { INDICATORS, PROJECT_SIZE, effectiveCar, startProject, tickDevelopment } from "../src/development.js";

function fakeCareer(over = {}) {
  return { seed: 1, teamIdx: 0, round: 0, money: 100000, costCap: false, devSpentThisSeason: 0, carDev: {}, project: null, ...over };
}

test("effectiveCar adds deltas onto the base car, clamped; rel never exceeds ~1", () => {
  const base = TEAMS[5].car;
  const eff = effectiveCar(base, { power: 0.05, aero: 0.02, rel: 0.50, tyre: 0, fuel: 0 });
  assert.ok(Math.abs(eff.power - (base.power + 0.05)) < 1e-9);
  assert.ok(eff.rel <= 0.995, "rel clamped below 1");
  const none = effectiveCar(base, null);
  assert.equal(none.power, base.power);
});

test("startProject spends money, queues a project, blocks a second one", () => {
  const c = fakeCareer();
  const p = startProject(c, "power", "medium");
  assert.ok(p && p.indicator === "power");
  assert.equal(c.money, 100000 - PROJECT_SIZE.medium.cost);
  assert.equal(startProject(c, "aero", "small"), null, "only one project at a time");
});

test("startProject refuses when broke or indicator/size invalid", () => {
  assert.equal(startProject(fakeCareer({ money: 10 }), "power", "large"), null);
  assert.equal(startProject(fakeCareer(), "nope", "small"), null);
  assert.equal(startProject(fakeCareer(), "power", "huge"), null);
});

test("tickDevelopment completes a finished project (applies a risk-shaved gain) and develops AI", () => {
  const c = fakeCareer({ teamIdx: 0 });
  startProject(c, "power", "small");                  // 1-race project
  const evs = tickDevelopment(c);                     // racesLeft 1 -> 0 -> complete
  assert.equal(c.project, null);
  assert.ok(c.carDev["McLaren"].power > 0 && c.carDev["McLaren"].power <= PROJECT_SIZE.small.gain + 1e-9);
  assert.ok(evs.some(e => e.type === "project_done"));
  // an AI team gained some development too
  assert.ok(c.carDev[TEAMS[5].name].power > 0);
});

test("tickDevelopment is deterministic and stream-clean (same seed/round -> same gain)", () => {
  const mk = () => { const c = fakeCareer(); startProject(c, "aero", "medium"); tickDevelopment(c); tickDevelopment(c); return c.carDev["McLaren"].aero; };
  assert.equal(mk(), mk());
});

test("AI catch-up: a backmarker develops faster than a top team per round", () => {
  const c = fakeCareer({ teamIdx: 0 });
  tickDevelopment(c);
  const top = c.carDev[TEAMS[1].name].power;          // Mercedes (strong)
  const back = c.carDev[TEAMS[10].name].power;         // Cadillac (weak)
  assert.ok(back > top, "weaker teams catch up faster");
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test ApexWeb/tests/development.test.js` → FAIL (no module).

- [ ] **Step 3: Implement** — `ApexWeb/src/development.js`:

```js
// ApexWeb/src/development.js — pure car-development model. Deltas add onto TEAMS[].car; the sim
// reads the composed effective car. AI dev is deterministic (facility-scaled, catch-up biased).
import { mix32 } from "./rng.js";
import { TEAMS } from "./data.js";

export const INDICATORS = ["power", "aero", "tyre", "fuel", "rel"];
export const INDICATOR_LABEL = { power: "Мотор", aero: "Аэро", tyre: "Шина", fuel: "Эконом", rel: "Надёжн." };

// upgrade sizes: gain to the indicator, $k cost, races to complete, risk (chance-weighted shortfall).
export const PROJECT_SIZE = {
  small:  { gain: 0.008, cost: 1200, races: 1, risk: 0.10, label: "Малый" },
  medium: { gain: 0.016, cost: 3000, races: 2, risk: 0.20, label: "Средний" },
  large:  { gain: 0.028, cost: 6000, races: 3, risk: 0.32, label: "Крупный" },
};

export const COST_CAP = 30000;     // $k/season dev-spend ceiling when career.costCap is on
// AI development tuning (per round): rate × facility × catch-up(team index).
const AI_DEV_RATE = 0.0040;

const zeroDev = () => ({ power: 0, aero: 0, tyre: 0, fuel: 0, rel: 0 });
function clampInd(k, v) { return k === "rel" ? Math.max(0.3, Math.min(0.995, v)) : Math.max(0.3, Math.min(1.20, v)); }

// base car + dev deltas -> the effective car the sim composes. energy passes through (composeCar drops it).
export function effectiveCar(baseCar, dev) {
  const d = dev || zeroDev();
  const out = { ...baseCar };
  for (const k of INDICATORS) {
    const b = baseCar[k] ?? (k === "tyre" || k === "fuel" ? 1 : 0.85);
    out[k] = clampInd(k, b + (d[k] || 0));
  }
  return out;
}

// start a player upgrade project. Returns the project, or null (busy / can't afford / cost cap / invalid).
export function startProject(career, indicator, size) {
  if (career.project) return null;
  const spec = PROJECT_SIZE[size];
  if (!spec || !INDICATORS.includes(indicator)) return null;
  if (career.money < spec.cost) return null;
  if (career.costCap && (career.devSpentThisSeason || 0) + spec.cost > COST_CAP) return null;
  career.money -= spec.cost;
  career.devSpentThisSeason = (career.devSpentThisSeason || 0) + spec.cost;
  career.project = { indicator, size, racesLeft: spec.races, gain: spec.gain, risk: spec.risk };
  return career.project;
}

// advance development one round: progress the player's project (complete -> risk-shaved gain) and
// develop every AI team deterministically (facility-scaled, weaker teams catch up faster).
export function tickDevelopment(career) {
  career.carDev = career.carDev || {};
  for (const t of TEAMS) career.carDev[t.name] = career.carDev[t.name] || zeroDev();
  const events = [];
  if (career.project) {
    career.project.racesLeft -= 1;
    if (career.project.racesLeft <= 0) {
      const p = career.project;
      const roll = mix32(((career.seed >>> 0) + career.round * 2654435761) >>> 0) / 4294967296;  // hash, not a stream draw
      const gain = p.gain * (1 - p.risk * roll);
      career.carDev[TEAMS[career.teamIdx].name][p.indicator] += gain;
      events.push({ type: "project_done", indicator: p.indicator, gain });
      career.project = null;
    }
  }
  TEAMS.forEach((t, i) => {
    if (i === career.teamIdx) return;
    const catchUp = 0.5 + i * 0.06;                  // weaker teams (higher index) develop faster
    const base = AI_DEV_RATE * (t.facility ?? 0.75) * catchUp;
    career.carDev[t.name].power += base;
    career.carDev[t.name].aero += base;
  });
  return events;
}
```

- [ ] **Step 4: Run to verify it passes** — `node --test ApexWeb/tests/development.test.js` → all pass.

- [ ] **Step 5: Commit** — `git add ApexWeb/src/development.js ApexWeb/tests/development.test.js` → `feat(apexweb): car-development model — projects + AI dev + effectiveCar (M3)`.

---

## Task 2: career.js — v3 carDev/project + develop on advance

**Files:** Modify `ApexWeb/src/career.js`; Test `ApexWeb/tests/career.test.js`.

- [ ] **Step 1: Add failing tests** — append to `ApexWeb/tests/career.test.js`:

```js
import { startProject } from "../src/development.js";

test("newCareer at v3 carries carDev + a null project + a season dev-spend counter", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  assert.equal(c.v, CAREER_V);
  assert.ok(c.v >= 3);
  assert.deepEqual(c.project, null);
  assert.equal(c.devSpentThisSeason, 0);
  assert.ok(c.carDev && typeof c.carDev === "object");
});

test("advanceRound develops the car: a finished project lands + AI teams gain", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  startProject(c, "power", "small");                  // completes after 1 round
  advanceRound(c);
  assert.ok(c.carDev["McLaren"].power > 0, "player gain applied on advance");
  assert.ok(c.carDev[TEAMS[8].name].power > 0, "AI developed");
});

test("migrate upgrades a v2 save to v3 (adds carDev/project)", () => {
  const v2 = { v: 2, teamIdx: 1, seed: 3, season: 1, round: 0, money: 0, driverPts: {}, teamPts: {}, board: { targetPos: 2 }, sponsors: [], costCap: false, pendingOffers: [], lastResult: null, history: [], done: false };
  const up = migrate(v2);
  assert.equal(up.v, CAREER_V);
  assert.deepEqual(up.project, null);
  assert.ok(up.carDev && typeof up.carDev === "object");
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test ApexWeb/tests/career.test.js` → FAIL (v<3 fields missing).

- [ ] **Step 3: Implement** — edit `ApexWeb/src/career.js`:

Add the import after the sponsors import:
```js
import { tickDevelopment } from "./development.js";
```
Change `export const CAREER_V = 2;` to:
```js
export const CAREER_V = 3;            // career save schema version
```
In `newCareer`, add the dev fields to the returned object (after the `sponsors:` line):
```js
    sponsors: defaultSponsors(teamIdx, s), costCap: false, pendingOffers: titleOffers(teamIdx, s),
    carDev: {}, project: null, devSpentThisSeason: 0,
```
In `advanceRound`, develop before bumping the round-pointer. Replace:
```js
export function advanceRound(career) {
  career.round += 1;
  if (isSeasonOver(career)) { career.done = true; return false; }
  return true;
}
```
with:
```js
export function advanceRound(career) {
  tickDevelopment(career);          // progress the player project + AI dev for the round just completed
  career.round += 1;
  if (isSeasonOver(career)) { career.done = true; return false; }
  return true;
}
```
Extend `migrate` to cover v2→v3 — replace the migrate body:
```js
export function migrate(career) {
  if (!career) return career;
  if (career.v < 2) {
    career.sponsors = career.sponsors || defaultSponsors(career.teamIdx, career.seed || 1);
    career.costCap = career.costCap ?? false;
    career.pendingOffers = career.pendingOffers || [];
    career.v = 2;
  }
  if (career.v < 3) {
    career.carDev = career.carDev || {};
    career.project = career.project ?? null;
    career.devSpentThisSeason = career.devSpentThisSeason ?? 0;
    career.v = 3;
  }
  return career;
}
```
In `newSeason`, reset the season dev-spend counter (carDev carries over; full regulation reset is M8). Replace:
```js
export function newSeason(career) {
  const fresh = newCareer({ teamIdx: career.teamIdx, seed: career.seed, coop: career.coop });
  fresh.season = career.season + 1;
  fresh.money = career.money;
  return fresh;
}
```
with:
```js
export function newSeason(career) {
  const fresh = newCareer({ teamIdx: career.teamIdx, seed: career.seed, coop: career.coop });
  fresh.season = career.season + 1;
  fresh.money = career.money;
  fresh.carDev = career.carDev || {};        // development carries into the new season (M8 adds regulation resets)
  fresh.devSpentThisSeason = 0;
  return fresh;
}
```

- [ ] **Step 4: Run to verify it passes** — `node --test ApexWeb/tests/career.test.js` → all pass (M1/M2 cases still green; note the determinism test still holds — tickDevelopment is a hash, no stream draw).

- [ ] **Step 5: Commit** — `git add ApexWeb/src/career.js ApexWeb/tests/career.test.js` → `feat(apexweb): career v3 — carDev + project, develop on advance (M3)`.

---

## Task 3: main.js — effectiveCar in the field + project command

**Files:** Modify `ApexWeb/src/main.js` (READ first).

- [ ] **Step 1: Import.** Add after the `careerTrack` import:
```js
import { effectiveCar, startProject } from "./development.js";
```

- [ ] **Step 2: buildField uses the effective car.** In `buildField`, change:
```js
      car: composeCar(t.car), color: t.color, team: t.name, isPlayer: isPlayerTeam, player,
```
to:
```js
      car: composeCar(ctx.career ? effectiveCar(t.car, ctx.career.carDev[t.name]) : t.car), color: t.color, team: t.name, isPlayer: isPlayerTeam, player,
```

- [ ] **Step 3: practiceCars uses the effective car for the player team.** In `practiceCars`, change:
```js
  const mk = di => ({ drv: { skill: t.drivers[di].skill, attrs: driverAttrs(t.drivers[di].abbrev, t.drivers[di].skill) }, car: composeCar(t.car), personnel });
```
to:
```js
  const car = composeCar(ctx.career ? effectiveCar(t.car, ctx.career.carDev[t.name]) : t.car);
  const mk = di => ({ drv: { skill: t.drivers[di].skill, attrs: driverAttrs(t.drivers[di].abbrev, t.drivers[di].skill) }, car, personnel });
```

- [ ] **Step 4: Project command.** In `onCommand`, add after the `career_sponsor` case:
```js
    case "career_project":
      if (ctx.career) { startProject(ctx.career, cmd.indicator, cmd.size); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
```

- [ ] **Step 5: Verify** — `node --check ApexWeb/src/main.js` → OK. `node --test` → all green.

- [ ] **Step 6: Commit** — `git add ApexWeb/src/main.js` → `feat(apexweb): field composes the career-developed car + project command (M3)`.

---

## Task 4: season.js — development panel

**Files:** Modify `ApexWeb/src/ui/season.js` (READ first).

- [ ] **Step 1: Implement.** Add the import:
```js
import { INDICATORS, INDICATOR_LABEL, PROJECT_SIZE, effectiveCar } from "../development.js";
import { TEAMS } from "../data.js";
```
(Adjust the existing `import { TEAM_LOGO } from "../data.js";` to `import { TEAM_LOGO, TEAMS } from "../data.js";` instead of a duplicate import.)

Add a development panel builder before `root.innerHTML =` (after the sponsors panel `spons`):
```js
  // development panel — the player team's effective car + the active project + start buttons
  const myTeamName = me ? me.team : null;
  const baseCar = myTeamName ? (TEAMS.find(t => t.name === myTeamName) || {}).car : null;
  const dev = (c.carDev && myTeamName) ? c.carDev[myTeamName] : null;
  const eff = baseCar ? effectiveCar(baseCar, dev) : null;
  const bar = (k) => { const v = eff ? eff[k] : 0; const pct = Math.max(4, Math.min(100, Math.round((v - 0.6) / 0.6 * 100))); const up = dev && dev[k] > 0.0001;
    return `<div style="margin:2px 0"><span class="label" style="display:inline-block;width:64px">${INDICATOR_LABEL[k]}</span>
      <span style="display:inline-block;width:120px;height:8px;background:#0003;border-radius:4px;vertical-align:middle"><span style="display:block;height:8px;width:${pct}%;background:${up ? "var(--good)" : "var(--primary)"};border-radius:4px"></span></span>
      <span style="margin-left:6px">${v.toFixed(3)}${up ? " ▲" : ""}</span></div>`; };
  let proj;
  if (c.project) proj = `<p class="label">Проект: ${INDICATOR_LABEL[c.project.indicator]} (${PROJECT_SIZE[c.project.size].label}) — ещё ${c.project.racesLeft} гонк.</p>`;
  else proj = `<div class="label">Запустить проект:</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">${
    INDICATORS.flatMap(k => Object.keys(PROJECT_SIZE).map(sz => `<button class="ready devbtn" data-k="${k}" data-sz="${sz}" ${c.money < PROJECT_SIZE[sz].cost ? "disabled" : ""} style="padding:5px 8px;font-size:12px">${INDICATOR_LABEL[k]} ${PROJECT_SIZE[sz].label} (${m$(PROJECT_SIZE[sz].cost)})</button>`)).join("")}</div>`;
  const devPanel = eff ? `<div class="panel"><p class="label">Разработка машины${c.costCap ? " · cost cap ВКЛ" : ""}</p>${INDICATORS.map(bar).join("")}<div style="height:6px"></div>${proj}</div>` : "";
```

Insert `${devPanel}` into the layout — change the offers line region from:
```js
    ${offers}
```
to:
```js
    ${devPanel}
    ${offers}
```

Wire the dev buttons — add near the other handlers (after the offer-button wiring):
```js
  root.querySelectorAll("button.devbtn").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_project", player: ctx.myPlayer, indicator: b.dataset.k, size: b.dataset.sz }); });
```

- [ ] **Step 2: Verify** — `node --check ApexWeb/src/ui/season.js` → OK.

- [ ] **Step 3: Commit** — `git add ApexWeb/src/ui/season.js` → `feat(apexweb): paddock development panel — car bars + projects (M3)`.

---

## Task 5: career_balance.mjs — development corridor

**Files:** Modify `ApexWeb/tools/career_balance.mjs`.

- [ ] **Step 1: Implement.** The harness must (a) build the field from the developed car and (b) drive the player to develop. Add the import:
```js
import { effectiveCar, startProject } from "../src/development.js";
```
Change the harness `field()` car line from:
```js
    car: composeCar(t.car), color: t.color, team: t.name,
```
to:
```js
    car: composeCar(effectiveCar(t.car, career.carDev[t.name])), color: t.color, team: t.name,
```
(The harness already has `career` in module scope — `field()` is called inside the season loop after `career` exists. Ensure `field()` is defined after `const career = ...`, or read `career.carDev` defensively: `effectiveCar(t.car, career.carDev && career.carDev[t.name])`. Use the defensive form.)

So use:
```js
    car: composeCar(effectiveCar(t.car, career.carDev && career.carDev[t.name])), color: t.color, team: t.name,
```

In the season loop, start a project each round when idle + affordable (just before `applyResult`):
```js
  if (!career.project && career.money > 2000) startProject(career, ["power", "aero", "tyre"][career.round % 3], "small");
```

After the loop, report + assert development happened and the spread is bounded. Add before `console.log("CAREER CORRIDOR OK");`:
```js
const effAvg = t => { const e = effectiveCar(t.car, career.carDev[t.name]); return (e.power + e.aero) / 2; };
const avgs = TEAMS.map(effAvg);
const spread = Math.max(...avgs) - Math.min(...avgs);
const myDev = career.carDev[TEAMS[0].name];
console.log(`dev: player McLaren carDev power +${myDev.power.toFixed(3)} aero +${myDev.aero.toFixed(3)}; field (power+aero)/2 spread ${spread.toFixed(3)}`);
if (!(myDev.power > 0 || myDev.aero > 0 || myDev.tyre > 0)) { console.error("player car did not develop over the season"); process.exit(1); }
if (spread > 0.45) { console.error(`grid spread ${spread.toFixed(3)} too wide — development ran away`); process.exit(1); }
```

- [ ] **Step 2: Run it** — `node ApexWeb/tools/career_balance.mjs` → season completes, player carDev grew, spread reported and < 0.45, "CAREER CORRIDOR OK". (If the AI catch-up over-compresses or the player runs away, tune `AI_DEV_RATE` / `PROJECT_SIZE.*.gain` and re-run — report the numbers, don't silently widen the assert.)

- [ ] **Step 3: Commit** — `git add ApexWeb/tools/career_balance.mjs` → `test(apexweb): car-development corridor — growth + bounded spread (M3)`.

---

## Final verification

- [ ] `node --test ApexWeb/tests/*.test.js` → all green.
- [ ] `node ApexWeb/tools/career_balance.mjs` → CAREER CORRIDOR OK (+ dev line).
- [ ] Preview: career → paddock → development panel shows car bars; start a small project → money drops, "Проект: … ещё N гонк." appears; (owner F5: over races the bar rises ▲ and the car gets faster).

## Self-review
- **Spec coverage:** invest money+time into the 5 indicators ✓ (projects), cost/time/risk ✓ (PROJECT_SIZE), build+fit (gain lands on completion → car) ✓, AI develops ✓ (deterministic, catch-up), per-season regulation reset → **deferred to M8** (carDev carries over; noted). cost-cap now bites ✓ (startProject checks it).
- **Determinism:** AI dev = pure formula; player project risk = `mix32` hash on seed+round (no rng/erng stream draw) → sim determinism intact. Combat invariant untouched (no sim edits).
- **Integration:** only `buildField`/`practiceCars` read the developed car (career-only; non-career = base car). Sim/quali/practice modules byte-unchanged.
- **WIP isolation:** explicit pathspecs; re-read main.js/season.js before editing.
