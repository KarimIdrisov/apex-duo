# M2 — Finances & Sponsors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Turn the career into a real economy: a paddock hub, sponsors with per-race objectives + happiness, an income/expense ledger (prize + sponsors − running cost), a season-start title-sponsor choice, and a cost-cap flag.

**Architecture:** A pure `sponsors.js` (deals, objectives, evaluation). `career.js` gains the ledger in `applyResult` + sponsor state in `newCareer` + a schema bump (v2) with `migrate`. `season.js` becomes the **paddock** (standings + finances + sponsors + the weekend gate + sponsor offers). `main.js` adds an `atPaddock` home-base state: career start → paddock; race finish → record + advance + back to paddock. The sim is untouched.

**Tech Stack:** Vanilla JS ES modules, Node `node --test`, deterministic.

**Spec:** `docs/superpowers/specs/2026-06-15-apexweb-manager-career-design.md` (Phase M2). Builds on M1.

---

## File Structure

```
ApexWeb/src/sponsors.js        NEW — pure: OBJ kinds, defaultSponsors, titleOffers, evaluateSponsor, objectiveLabel
ApexWeb/src/career.js          MODIFY — v2 schema (sponsors/costCap/pendingOffers), CAREER_V, migrate, chooseTitleSponsor, RUNNING_COST; applyResult ledger
ApexWeb/src/career_store.js    MODIFY — accept v2 + run migrate on load/import
ApexWeb/src/ui/season.js       MODIFY — paddock: finances panel + sponsors panel + title-offer pick + weekend gate
ApexWeb/src/main.js            MODIFY — atPaddock home base, startWeekendFromPaddock, record+advance on finish, career_sponsor/career_start_weekend cmds, atPaddock in broadcast
ApexWeb/tests/sponsors.test.js NEW
ApexWeb/tests/career.test.js   MODIFY — ledger + sponsor cases
ApexWeb/tests/career_store.test.js MODIFY — v1→v2 migrate
ApexWeb/tools/career_balance.mjs   MODIFY — solvency corridor (player solvent; backmarker pressure)
```

Explicit pathspecs per commit; never `git add -A`. Re-read main.js/season.js immediately before editing (owner edits concurrently).

---

## Task 1: sponsors.js — the sponsor model (pure)

**Files:** Create `ApexWeb/src/sponsors.js`; Test `ApexWeb/tests/sponsors.test.js`.

- [ ] **Step 1: Failing test** — `ApexWeb/tests/sponsors.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { OBJ, defaultSponsors, titleOffers, evaluateSponsor, objectiveLabel } from "../src/sponsors.js";

test("defaultSponsors: 1 title + 2 secondary, deterministic, happiness seeded", () => {
  const a = defaultSponsors(0, 5), b = defaultSponsors(0, 5);
  assert.deepEqual(a, b);
  assert.equal(a.length, 3);
  assert.equal(a.filter(s => s.kind === "title").length, 1);
  for (const s of a) { assert.ok(s.retainer > 0 && s.bonus > 0); assert.ok(s.happiness >= 0 && s.happiness <= 1); assert.ok(s.objective && s.objective.type); }
});

test("a top team's title objective is harder (podium/front) than a backmarker's", () => {
  const top = defaultSponsors(0, 1).find(s => s.kind === "title");
  const back = defaultSponsors(10, 1).find(s => s.kind === "title");
  const hardness = o => o.type === OBJ.PODIUM ? 1 : (o.type === OBJ.FINISH_ABOVE ? 1 / o.param : 0);
  assert.ok(hardness(top.objective) > hardness(back.objective), "top deal demands more");
});

test("titleOffers: 3 deterministic offers with a retainer<->ambition tradeoff", () => {
  const offs = titleOffers(3, 2);
  assert.equal(offs.length, 3);
  assert.deepEqual(offs, titleOffers(3, 2));
  assert.ok(offs[2].bonus > offs[0].bonus, "the ambitious offer pays a bigger bonus");
});

test("evaluateSponsor: meeting the objective pays retainer+bonus and lifts happiness", () => {
  const sp = { kind: "title", retainer: 200, bonus: 300, objective: { type: OBJ.FINISH_ABOVE, param: 5 }, happiness: 0.6 };
  const hit = evaluateSponsor(sp, { bestPos: 3, points: 30, beat: new Set() });
  assert.equal(hit.met, true); assert.equal(hit.payout, 500); assert.ok(hit.dHappiness > 0);
  const miss = evaluateSponsor(sp, { bestPos: 9, points: 2, beat: new Set() });
  assert.equal(miss.met, false); assert.equal(miss.payout, 200); assert.ok(miss.dHappiness < 0);
});

test("objectiveLabel renders Russian for each kind", () => {
  assert.match(objectiveLabel({ type: OBJ.PODIUM }), /Подиум/);
  assert.match(objectiveLabel({ type: OBJ.FINISH_ABOVE, param: 6 }), /топ-6/);
  assert.match(objectiveLabel({ type: OBJ.POINTS, param: 8 }), /8/);
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test ApexWeb/tests/sponsors.test.js` → FAIL (no module).

- [ ] **Step 3: Implement** — `ApexWeb/src/sponsors.js`:

```js
// ApexWeb/src/sponsors.js — pure sponsor model: deals with a per-race retainer + an objective
// bonus + a happiness meter. Deterministic generation from team tier + seed. No UI, no I/O.
import { mix32 } from "./rng.js";

export const OBJ = { PODIUM: "podium", FINISH_ABOVE: "finishAbove", POINTS: "points", BEAT: "beatTeam" };

const TITLE_NAMES = ["Aramco", "Oracle", "Petronas", "Rolex", "DHL", "Pirelli", "Heineken", "MoneyGram", "Qualcomm", "Santander"];
const SEC_NAMES = ["Tommy", "Estrella", "CrowdStrike", "Globant", "Tezos", "Lenovo", "Puma", "Cognizant", "Webex", "VodaFone"];

export function objectiveLabel(obj) {
  switch (obj.type) {
    case OBJ.PODIUM: return "Подиум";
    case OBJ.FINISH_ABOVE: return `Финиш в топ-${obj.param}`;
    case OBJ.POINTS: return `Очки: ≥${obj.param}`;
    case OBJ.BEAT: return `Опередить ${obj.param}`;
    default: return "—";
  }
}

// expected best-car finishing position for a team tier (idx 0 = strongest).
function expectedPos(teamIdx) { return Math.min(20, 1 + teamIdx * 2); }
const t = Math.max;

// a deterministic sponsor for a team, indexed by `n`. kind = "title" | "secondary".
function makeSponsor(teamIdx, seed, kind, n) {
  const r = mix32(((teamIdx + 1) * 131 + n * 977 + (seed >>> 0)) >>> 0);
  const names = kind === "title" ? TITLE_NAMES : SEC_NAMES;
  const name = names[r % names.length];
  const exp = expectedPos(teamIdx), strength = 10 - Math.min(10, teamIdx);   // 10 (top) .. 0 (back)
  const retainer = kind === "title" ? 220 + strength * 16 : 110 + strength * 8;
  const bonus = kind === "title" ? 320 + strength * 20 : 160 + strength * 10;
  let objective;
  if (kind === "title" && teamIdx <= 1) objective = { type: OBJ.PODIUM };
  else if (kind === "title") objective = { type: OBJ.FINISH_ABOVE, param: t(1, exp - 2) };
  else objective = { type: OBJ.FINISH_ABOVE, param: Math.min(15, exp + 2) };
  return { name, kind, retainer, bonus, objective, happiness: 0.6 };
}

// the starting roster for a new career: 1 title + 2 secondary, deterministic.
export function defaultSponsors(teamIdx, seed) {
  return [makeSponsor(teamIdx, seed, "title", 0), makeSponsor(teamIdx, seed, "secondary", 1), makeSponsor(teamIdx, seed, "secondary", 2)];
}

// 3 title-sponsor offers to choose from at season start (safe / balanced / ambitious).
export function titleOffers(teamIdx, seed) {
  const exp = expectedPos(teamIdx);
  return [0, 1, 2].map(v => {
    const o = makeSponsor(teamIdx, seed, "title", 10 + v);
    if (v === 0) { o.objective = { type: OBJ.FINISH_ABOVE, param: Math.min(15, exp + 1) }; o.bonus = Math.round(o.bonus * 0.7); o.retainer = Math.round(o.retainer * 1.1); }
    if (v === 2) { o.objective = teamIdx <= 2 ? { type: OBJ.PODIUM } : { type: OBJ.FINISH_ABOVE, param: t(1, exp - 3) }; o.bonus = Math.round(o.bonus * 1.5); o.retainer = Math.round(o.retainer * 0.9); }
    return o;
  });
}

// evaluate a sponsor against a race result for the player team.
// ctx = { bestPos:int, points:int, beat:Set<teamName> }
export function evaluateSponsor(sp, ctx) {
  let met = false;
  switch (sp.objective.type) {
    case OBJ.PODIUM: met = ctx.bestPos <= 3; break;
    case OBJ.FINISH_ABOVE: met = ctx.bestPos <= sp.objective.param; break;
    case OBJ.POINTS: met = ctx.points >= sp.objective.param; break;
    case OBJ.BEAT: met = ctx.beat.has(sp.objective.param); break;
  }
  return { met, payout: sp.retainer + (met ? sp.bonus : 0), dHappiness: met ? 0.06 : -0.05 };
}
```

- [ ] **Step 4: Run to verify it passes** — `node --test ApexWeb/tests/sponsors.test.js` → all pass.

- [ ] **Step 5: Commit** — `git add ApexWeb/src/sponsors.js ApexWeb/tests/sponsors.test.js` → `feat(apexweb): sponsor model — deals, objectives, evaluation (M2)`.

---

## Task 2: career.js — ledger + sponsor state + v2 migrate

**Files:** Modify `ApexWeb/src/career.js`; Test `ApexWeb/tests/career.test.js`.

- [ ] **Step 1: Add failing tests** — append to `ApexWeb/tests/career.test.js`:

```js
import { CAREER_V, migrate, chooseTitleSponsor, RUNNING_COST } from "../src/career.js";

test("newCareer carries sponsors + title offers + costCap flag at v2", () => {
  const c = newCareer({ teamIdx: 4, seed: 2 });
  assert.equal(c.v, CAREER_V);
  assert.ok(c.sponsors.length >= 1 && c.sponsors.some(s => s.kind === "title"));
  assert.equal(c.costCap, false);
  assert.equal(c.pendingOffers.length, 3);
});

test("applyResult books prize + sponsor income minus running cost into a net ledger", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });           // McLaren, sweeps front
  const order = [...TEAMS[0].drivers.map(d => ({ abbrev: d.abbrev, team: "McLaren" })),
    ...TEAMS.flatMap((t, i) => i === 0 ? [] : t.drivers.map(d => ({ abbrev: d.abbrev, team: t.name })))];
  const before = c.money;
  const sum = applyResult(c, order);
  assert.ok(sum.prize > 0 && sum.sponsorIncome > 0 && sum.runningCost === RUNNING_COST);
  assert.equal(sum.net, sum.prize + sum.sponsorIncome - sum.runningCost);
  assert.equal(c.money, before + sum.net);
  assert.equal(sum.bestPos, 1);
});

test("chooseTitleSponsor swaps the title deal and clears offers", () => {
  const c = newCareer({ teamIdx: 6, seed: 3 });
  const want = c.pendingOffers[2];
  chooseTitleSponsor(c, 2);
  assert.equal(c.pendingOffers.length, 0);
  const title = c.sponsors.find(s => s.kind === "title");
  assert.equal(title.bonus, want.bonus);
  assert.equal(c.sponsors.filter(s => s.kind === "title").length, 1);
});

test("migrate upgrades a v1 save to v2 (adds sponsors)", () => {
  const v1 = { v: 1, teamIdx: 2, seed: 9, season: 1, round: 0, money: 0, driverPts: {}, teamPts: {}, board: { targetPos: 3 }, lastResult: null, history: [], done: false };
  const up = migrate(v1);
  assert.equal(up.v, CAREER_V);
  assert.ok(up.sponsors.length >= 1);
  assert.equal(up.costCap, false);
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test ApexWeb/tests/career.test.js` → FAIL (CAREER_V/migrate/sponsors undefined).

- [ ] **Step 3: Implement** — edit `ApexWeb/src/career.js`:

Add the import after `import { TEAMS } from "./data.js";`:
```js
import { defaultSponsors, titleOffers, evaluateSponsor } from "./sponsors.js";
```
Add after the `PRIZE` const:
```js
export const CAREER_V = 2;            // career save schema version
export const RUNNING_COST = 800;      // $k per-race operating cost (M5 facilities refine it)
```
In `newCareer`, change the returned object's version line and add sponsor fields. Replace:
```js
  return {
    v: 1, seed: seed >>> 0, teamIdx, coop,
    season: 1, round: 0, money: 0,
    driverPts, teamPts,
    board: { targetPos: Math.min(TEAMS.length, teamIdx + 1) },  // meet your tier (P{teamIdx+1})
    lastResult: null, history: [], done: false,
  };
```
with:
```js
  const s = seed >>> 0;
  return {
    v: CAREER_V, seed: s, teamIdx, coop,
    season: 1, round: 0, money: 0,
    driverPts, teamPts,
    board: { targetPos: Math.min(TEAMS.length, teamIdx + 1) },  // meet your tier (P{teamIdx+1})
    sponsors: defaultSponsors(teamIdx, s), costCap: false, pendingOffers: titleOffers(teamIdx, s),
    lastResult: null, history: [], done: false,
  };
```
Replace the whole `applyResult` function with the ledger version:
```js
// award points + book the race ledger (prize + sponsor income − running cost). classification =
// finishing order [{abbrev, team, retired}] (index 0 = winner). Mutates career; returns a summary.
export function applyResult(career, classification) {
  const podium = [];
  let prize = 0, teamPts = 0, bestPos = 99;
  const myTeam = TEAMS[career.teamIdx].name;
  const bestByTeam = {};
  classification.forEach((c, i) => {
    const pts = i < POINTS.length ? POINTS[i] : 0;
    if (career.driverPts[c.abbrev] != null) career.driverPts[c.abbrev] += pts;
    if (career.teamPts[c.team] != null) career.teamPts[c.team] += pts;
    if (i < 3) podium.push(c.abbrev);
    if (bestByTeam[c.team] == null) bestByTeam[c.team] = i + 1;
    if (c.team === myTeam) { prize += (i < PRIZE.length ? PRIZE[i] : 100); teamPts += pts; bestPos = Math.min(bestPos, i + 1); }
  });
  // teams my best car beat (their best car finished behind mine)
  const beat = new Set();
  for (const tname in bestByTeam) if (tname !== myTeam && bestByTeam[myTeam] < bestByTeam[tname]) beat.add(tname);
  const sCtx = { bestPos, points: teamPts, beat };
  let sponsorIncome = 0;
  for (const sp of (career.sponsors || [])) {
    const r = evaluateSponsor(sp, sCtx);
    sponsorIncome += r.payout;
    sp.happiness = Math.max(0, Math.min(1, sp.happiness + r.dHappiness));
  }
  const net = prize + sponsorIncome - RUNNING_COST;
  career.money += net;
  const summary = {
    round: career.round, gp: CALENDAR[career.round].name, podium, bestPos,
    prize, sponsorIncome, runningCost: RUNNING_COST, net,
    classification: classification.map((c, i) => ({ pos: i + 1, abbrev: c.abbrev, team: c.team, retired: !!c.retired })),
  };
  career.lastResult = summary;
  career.history.push(summary);
  return summary;
}
```
Add after `applyResult` (before `advanceRound`):
```js
// upgrade an older save in place to the current schema.
export function migrate(career) {
  if (!career) return career;
  if (career.v < 2) {
    career.sponsors = career.sponsors || defaultSponsors(career.teamIdx, career.seed || 1);
    career.costCap = career.costCap ?? false;
    career.pendingOffers = career.pendingOffers || [];
    career.v = 2;
  }
  return career;
}
// accept a season-start title-sponsor offer: replace the title deal, clear the offers.
export function chooseTitleSponsor(career, offerIdx) {
  const chosen = career.pendingOffers && career.pendingOffers[offerIdx];
  if (!chosen) return;
  const secondaries = (career.sponsors || []).filter(s => s.kind !== "title");
  career.sponsors = [{ ...chosen, kind: "title" }, ...secondaries];
  career.pendingOffers = [];
}
```

- [ ] **Step 4: Run to verify it passes** — `node --test ApexWeb/tests/career.test.js` → all pass (M1 cases still green; M1's "total awarded == sum POINTS" still holds — points logic unchanged).

- [ ] **Step 5: Commit** — `git add ApexWeb/src/career.js ApexWeb/tests/career.test.js` → `feat(apexweb): career ledger + sponsor state + v2 migrate (M2)`.

---

## Task 3: career_store.js — accept v2 + migrate on load

**Files:** Modify `ApexWeb/src/career_store.js`; Test `ApexWeb/tests/career_store.test.js`.

- [ ] **Step 1: Add a failing test** — append to `ApexWeb/tests/career_store.test.js`:

```js
import { CAREER_V } from "../src/career.js";

test("loadCareer migrates an older v1 blob to the current version", () => {
  localStorage.setItem("apexweb_career", JSON.stringify({ v: 1, teamIdx: 1, seed: 4, season: 1, round: 0, money: 0, driverPts: {}, teamPts: {}, board: { targetPos: 2 }, lastResult: null, history: [], done: false }));
  const c = loadCareer();
  assert.equal(c.v, CAREER_V);
  assert.ok(c.sponsors.length >= 1);
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test ApexWeb/tests/career_store.test.js` → FAIL (loadCareer rejects v!==1 / returns null on v1-without-migrate path once career emits v2). 

- [ ] **Step 3: Implement** — `ApexWeb/src/career_store.js`. Add the import at the top:
```js
import { migrate } from "./career.js";
```
Change `loadCareer` and `importCareer` to accept any numeric `v` and migrate:
```js
export function loadCareer() {
  const s = ls(); if (!s) return null;
  try { const c = JSON.parse(s.getItem(KEY) || "null"); return (c && typeof c.v === "number") ? migrate(c) : null; } catch { return null; }
}
```
```js
export function importCareer(json) {
  try { const c = JSON.parse(json); return (c && typeof c.v === "number") ? migrate(c) : null; } catch { return null; }
}
```

- [ ] **Step 4: Run to verify it passes** — `node --test ApexWeb/tests/career_store.test.js` → all pass (the M1 round-trip test still passes: a v2 career saves+loads to v2 with sponsors).

- [ ] **Step 5: Commit** — `git add ApexWeb/src/career_store.js ApexWeb/tests/career_store.test.js` → `feat(apexweb): career save migrate v1->v2 (M2)`.

---

## Task 4: career_balance.mjs — solvency corridor

**Files:** Modify `ApexWeb/tools/career_balance.mjs`.

- [ ] **Step 1: Implement** — extend the corridor to track the player's money and a backmarker's, and assert the economy is sane. Replace the file's final reporting block (from `const bo = boardOutcome(career);` to the end) with:

```js
const bo = boardOutcome(career);
const champ = constructorStandings(career)[0];
console.log(`\nseason: ${races} races, ${totalPts} pts awarded, champion=${champ.team} (${champ.pts}), player P${bo.finalPos} target P${bo.target} -> ${bo.met ? "MET" : "MISSED"}`);
console.log(`passes/race across the calendar: ${minPass}..${maxPass}`);
console.log(`player money end of season: $${(career.money / 1000).toFixed(1)}M  (sponsors: ${career.sponsors.map(s => s.name + " " + Math.round(s.happiness * 100) + "%").join(", ")})`);
if (races !== CALENDAR.length) { console.error("season did not complete all rounds"); process.exit(1); }
if (minPass < 1) { console.error("a race had zero passes — check overtake_zones on every calendar track"); process.exit(1); }
if (career.money <= 0) { console.error("a front-running team went broke over a season — economy too harsh"); process.exit(1); }
console.log("CAREER CORRIDOR OK");
```

(The harness already drives the player as `teamIdx:0` = McLaren, a front-runner, so positive money proves the economy is survivable for a strong team. `applyResult` now books the ledger, so `career.money` reflects prize+sponsors−cost.)

- [ ] **Step 2: Run it** — `node ApexWeb/tools/career_balance.mjs` → season completes, points conserve, `player money end of season` is reported and positive, ends "CAREER CORRIDOR OK".

- [ ] **Step 3: Commit** — `git add ApexWeb/tools/career_balance.mjs` → `test(apexweb): career solvency corridor (M2)`.

---

## Task 5: season.js — the paddock (finances + sponsors + offers + weekend gate)

**Files:** Modify `ApexWeb/src/ui/season.js` (it becomes the paddock screen).

- [ ] **Step 1: Implement** — REPLACE the file with the paddock version (READ it first; it is the M1 season screen):

```js
// ApexWeb/src/ui/season.js — the paddock: standings + finances + sponsors + the upcoming-weekend
// gate (and the season-start title-sponsor choice / season-end verdict). Reads ctx.careerView +
// ctx.careerReadyView (set by main on host AND client). Inline styles keep it self-contained.
import { CALENDAR, constructorStandings, driverStandings, boardOutcome } from "../career.js";
import { objectiveLabel } from "../sponsors.js";
import { TEAM_LOGO } from "../data.js";

const row = (cells, hot) => `<tr style="${hot ? "font-weight:700;color:var(--good)" : ""}">${cells.map(c => `<td style="padding:3px 8px">${c}</td>`).join("")}</tr>`;
const m$ = k => `$${(k / 1000).toFixed(2)}M`;

export function render(root, ctx) {
  const c = ctx.careerView;
  if (!c) { root.innerHTML = `<div class="panel"><p class="label">Загрузка карьеры…</p></div>`; return; }
  const cons = constructorStandings(c);
  const drv = driverStandings(c).slice(0, 10);
  const lr = c.lastResult;
  const me = cons.find(x => x.isPlayer);
  const ready = ctx.careerReadyView || { p1: false, p2: false };
  const meReady = !!ready[ctx.myPlayer];

  const consTbl = cons.map(r => row([r.pos, `<img src="assets/teams/${TEAM_LOGO[r.team]}.png" style="height:16px;vertical-align:middle;margin-right:6px">${r.team}`, r.pts], r.isPlayer)).join("");
  const drvTbl = drv.map(r => row([r.pos, r.abbrev, r.team, r.pts])).join("");
  const podium = lr ? lr.podium.map((a, i) => `${["🥇", "🥈", "🥉"][i]} ${a}`).join("  ") : "";

  // finances panel
  const ledger = lr ? `<table style="width:100%;border-collapse:collapse">
      ${row(["Призовые", m$(lr.prize)])}${row(["Спонсоры", m$(lr.sponsorIncome)])}${row(["Расходы", "−" + m$(lr.runningCost)])}
      ${row([`<b>Итог гонки</b>`, `<b style="color:${lr.net >= 0 ? "var(--good)" : "var(--bad)"}">${lr.net >= 0 ? "+" : "−"}${m$(Math.abs(lr.net))}</b>`])}</table>` : `<p class="label">Старт сезона</p>`;
  const finances = `<div class="panel" style="flex:1;min-width:240px">
      <p class="label">Финансы · Бюджет ${m$(c.money)}</p>${ledger}</div>`;

  // sponsors panel
  const spons = `<div class="panel" style="flex:1;min-width:240px"><p class="label">Спонсоры</p>
      <table style="width:100%;border-collapse:collapse">
      ${(c.sponsors || []).map(s => row([`${s.kind === "title" ? "★ " : ""}${s.name}`, objectiveLabel(s.objective), `${Math.round(s.happiness * 100)}%`])).join("")}</table></div>`;

  // season-start title-sponsor choice
  let offers = "";
  if (c.pendingOffers && c.pendingOffers.length) {
    offers = `<div class="panel"><p class="label">Выбери титульного спонсора на сезон</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">${c.pendingOffers.map((o, i) => `
        <button class="ready offer" data-i="${i}" style="flex:1;min-width:180px;text-align:left;padding:10px">
          <b>${o.name}</b><br><span class="label">${objectiveLabel(o.objective)}</span><br>
          ретейнер ${m$(o.retainer)} · бонус ${m$(o.bonus)}</button>`).join("")}</div></div>`;
  }

  // weekend gate / season end
  let footer;
  if (c.done) {
    const bo = boardOutcome(c);
    footer = `<div class="panel"><h3>Сезон ${c.season} завершён</h3>
      <p class="label">Цель совета: не ниже P${bo.target} в Кубке конструкторов.</p>
      <p style="font-size:18px;font-weight:700;color:${bo.met ? "var(--good)" : "var(--bad)"}">${bo.met ? "✅ Цель выполнена" : "❌ Цель не выполнена"} — итог P${bo.finalPos}</p>
      <button class="primary" id="newseason">Новый сезон ▶</button></div>`;
  } else {
    const nextR = CALENDAR[c.round];
    footer = `<div class="panel"><p class="label">Следующий этап · раунд ${c.round + 1} из ${CALENDAR.length}</p>
      <h3>${nextR.name}</h3>
      <button class="primary" id="startwknd" ${c.pendingOffers && c.pendingOffers.length ? "disabled" : ""}>${meReady ? "Готов ✓ — ждём напарника…" : "Начать уикенд ▶"}</button>
      ${c.pendingOffers && c.pendingOffers.length ? `<p class="label">Сначала выбери спонсора.</p>` : ""}</div>`;
  }

  root.innerHTML = `
    <div class="panel"><h2>Сезон ${c.season} · ${me ? me.team : ""} (P${me ? me.pos : "-"})</h2>
      ${lr ? `<p class="label">${lr.gp}: ${podium}</p>` : ""}</div>
    <div style="display:flex;gap:12px;flex-wrap:wrap">${finances}${spons}</div>
    ${offers}
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <div class="panel" style="flex:1;min-width:240px"><p class="label">Кубок конструкторов</p>
        <table style="width:100%;border-collapse:collapse"><tbody>${consTbl}</tbody></table></div>
      <div class="panel" style="flex:1;min-width:240px"><p class="label">Личный зачёт (топ-10)</p>
        <table style="width:100%;border-collapse:collapse"><tbody>${drvTbl}</tbody></table></div>
    </div>
    ${footer}`;

  root.querySelectorAll("button.offer").forEach(b => b.onclick = () => { root.querySelectorAll("button.offer").forEach(x => x.disabled = true); ctx.send({ cmd: "career_sponsor", player: ctx.myPlayer, offerIdx: +b.dataset.i }); });
  const sw = root.querySelector("#startwknd");
  if (sw) sw.onclick = () => { sw.disabled = true; ctx.send({ cmd: "career_start_weekend", player: ctx.myPlayer }); };
  const ns = root.querySelector("#newseason");
  if (ns) ns.onclick = () => { ns.disabled = true; ctx.send({ cmd: "career_newseason", player: ctx.myPlayer }); };
}
```

- [ ] **Step 2: Verify** — `node --check ApexWeb/src/ui/season.js` → OK.

- [ ] **Step 3: Commit** — `git add ApexWeb/src/ui/season.js` → `feat(apexweb): paddock screen — finances, sponsors, offers, weekend gate (M2)`.

---

## Task 6: main.js — paddock home base + flow

**Files:** Modify `ApexWeb/src/main.js` (READ it first — owner edits concurrently).

- [ ] **Step 1: Imports.** Add `chooseTitleSponsor` to the career import:
```js
import { newCareer, newSeason, currentRound, applyResult, advanceRound, chooseTitleSponsor } from "./career.js";
```

- [ ] **Step 2: Render the paddock when atPaddock.** In `rerender()`, change the screen-select line:
```js
    const mod = (ctx.career && phase === "result") ? seasonUI : SCREENS[phase];
```
to:
```js
    const mod = (ctx.careerView && ctx.atPaddock) ? seasonUI : SCREENS[phase];
```

- [ ] **Step 3: publishCareer carries atPaddock.** Replace `publishCareer`:
```js
function publishCareer() {
  ctx.careerView = ctx.career;
  ctx.careerReadyView = ctx.careerReady;
  if (ctx.net) ctx.net.send({ type: "career", career: ctx.career, ready: ctx.careerReady, atPaddock: !!ctx.atPaddock });
}
```

- [ ] **Step 4: resetWeekendState clears the race-closed guard.** Replace `resetWeekendState`:
```js
function resetWeekendState() {
  ctx.seed = null; ctx.pracSession = null; ctx.qualiSession = null;
  ctx.race = null; ctx.setups = null; ctx._raceClosed = false;
}
```

- [ ] **Step 5: Career start opens the paddock (not the weekend).** In `startCareerSolo`, replace the tail
```js
  resetWeekendState(); loadRoundTrack(); publishCareer();
  ctx.weekend.solo = true;
  requestAnimationFrame(hostLoop);
  ctx.weekend.start();
}
```
with:
```js
  resetWeekendState(); loadRoundTrack(); ctx.atPaddock = true; publishCareer();
  ctx.weekend.solo = true;
  requestAnimationFrame(hostLoop);
  rerender();
}
```
And in `beginCoopCareer`, replace the tail
```js
  resetWeekendState(); loadRoundTrack(); publishCareer();
  ctx.weekend.start();
}
```
with:
```js
  resetWeekendState(); loadRoundTrack(); ctx.atPaddock = true; publishCareer();
  rerender();
}
```

- [ ] **Step 6: Replace advanceCareer/startNewSeason with paddock-based versions, add startWeekendFromPaddock.** Replace both `advanceCareer` and `startNewSeason`:
```js
// begin the upcoming round's weekend from the paddock.
function startWeekendFromPaddock() {
  ctx.careerReady = { p1: false, p2: false };
  ctx.atPaddock = false;
  resetWeekendState(); loadRoundTrack();
  ctx.weekend._goto("practice1");                          // fires onPhase -> practice + broadcasts
}
function startNewSeason() {
  ctx.career = newSeason(ctx.career);
  ctx.careerReady = { p1: false, p2: false };
  resetWeekendState(); loadRoundTrack(); ctx.atPaddock = true; publishCareer(); rerender();
}
```

- [ ] **Step 7: Record + advance on finish, return to the paddock.** Replace the `if (ctx.race.finished)` block in `hostLoop`:
```js
    if (ctx.race.finished && !ctx._raceClosed) {
      ctx._raceClosed = true;
      if (ctx.career) {
        const cls = ctx.race.order().map(c => ({ abbrev: c.abbrev, team: c.team, retired: c.retired }));
        applyResult(ctx.career, cls);
        advanceRound(ctx.career);            // -> next round (or done)
        saveCareer(ctx.career);
        ctx.atPaddock = true; publishCareer();
        pushRaceState(); rerender();         // show the paddock with results + finances
      } else {
        pushRaceState();
        ctx.weekend.setReady("p1"); ctx.weekend.setReady("p2");  // non-career -> result screen
      }
    }
```

- [ ] **Step 8: Commands — sponsor pick + start-weekend gate.** Replace the M1 `career_next`/`career_newseason` cases with:
```js
    case "career_sponsor":
      if (ctx.career) { chooseTitleSponsor(ctx.career, cmd.offerIdx); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_start_weekend":
      if (ctx.career && !ctx.career.done && !(ctx.career.pendingOffers && ctx.career.pendingOffers.length)) {
        ctx.careerReady[cmd.player] = true; publishCareer(); rerender();
        if (ctx.solo || (ctx.careerReady.p1 && ctx.careerReady.p2)) startWeekendFromPaddock();
      }
      break;
    case "career_newseason":
      if (ctx.career && ctx.career.done) {
        ctx.careerReady[cmd.player] = true;
        if (ctx.solo || (ctx.careerReady.p1 && ctx.careerReady.p2)) startNewSeason();
      }
      break;
```

- [ ] **Step 9: Client mirrors atPaddock.** In `onMessage`, change the career handler:
```js
  if (m.type === "career")   { ctx.careerView = m.career; ctx.careerReadyView = m.ready; ctx.atPaddock = m.atPaddock; rerender(); }
```

- [ ] **Step 10: Verify** — `node --check ApexWeb/src/main.js` → OK. `node --test` → all green.

- [ ] **Step 11: Commit** — `git add ApexWeb/src/main.js` → `feat(apexweb): paddock home base + finances/sponsor flow into main (M2)`.

---

## Final verification

- [ ] `node --test ApexWeb/tests/*.test.js` → all green.
- [ ] `node ApexWeb/tools/career_balance.mjs` → CAREER CORRIDOR OK + positive end-of-season money.
- [ ] Preview boot: lobby → «Карьера» solo → **paddock** shows finances + sponsors + 3 title offers; pick one → «Начать уикенд» enables → enters practice. (Owner F5 for the full visual + a real race → paddock-with-results.)

## Self-review
- **Spec coverage:** sponsors-with-objectives ✓, retainer+bonus+happiness ✓, income (prize+sponsors) ✓, expenses (running cost) ✓, cost-cap flag ✓ (stored; bites in M3), negotiate/choose sponsor ✓ (season-start title offers). Paddock hub ✓.
- **Determinism:** sponsors generated from team+seed; ledger pure; no Math.random in the modules (UI seed only).
- **Back-compat:** v2 migrate keeps M1 saves loading; non-career flows untouched (atPaddock only set in career paths); M1 points/standings logic unchanged.
- **WIP isolation:** explicit pathspecs; re-read main.js/season.js before editing.
