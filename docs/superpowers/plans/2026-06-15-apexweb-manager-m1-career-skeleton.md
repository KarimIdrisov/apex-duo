# M1 — Career Skeleton & Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A thin, fully playable multi-race season on top of the existing ApexWeb race: a real calendar of circuits, driver + constructor standings, prize money, a board objective, save/continue, and co-op "both ready to advance" — with the sim untouched.

**Architecture:** A pure `career.js` holds the calendar + season state and advance functions; `career_store.js` persists it; `track_build.careerTrack()` turns a calendar round into the sim track (real circuit shape + characteristics); `main.js` drives the loop (set the round's track, run the weekend, record the result once on the host, gate the advance on both players, broadcast the career to the client); `ui/season.js` is the between-races screen. The race engine, quali, and practice are byte-unchanged.

**Tech Stack:** Vanilla JS ES modules, Node `node --test`, deterministic sim.

**Spec:** `docs/superpowers/specs/2026-06-15-apexweb-manager-career-design.md` (Phase M1).

---

## File Structure

```
ApexWeb/src/career.js          NEW — pure: CALENDAR, POINTS, PRIZE, newCareer, applyResult, advanceRound, standings, board
ApexWeb/src/career_store.js    NEW — localStorage save/load/clear + JSON export/import (versioned)
ApexWeb/src/track_build.js     MODIFY — careerTrack(round) + defaultZones(ot)
ApexWeb/src/ui/season.js       NEW — season screen (standings + last race + board + next/ready)
ApexWeb/src/main.js            MODIFY — career start, per-round track, record-once, advance gate, career broadcast, render season after result
ApexWeb/src/ui/lobby.js        MODIFY — "Карьера (сезон)" entry (solo + co-op)
ApexWeb/tests/career.test.js   NEW
ApexWeb/tests/career_store.test.js NEW
ApexWeb/tests/track_build.test.js  NEW
ApexWeb/tools/career_balance.mjs   NEW — sim a full season headlessly (corridor)
```

All commits use explicit pathspecs (never `git add -A`) — the owner keeps parallel WIP in the tree.

---

## Task 1: career.js — calendar, standings, prize, board (pure)

**Files:** Create `ApexWeb/src/career.js`; Test `ApexWeb/tests/career.test.js`.

- [ ] **Step 1: Write the failing test** — `ApexWeb/tests/career.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { TEAMS } from "../src/data.js";
import { CALENDAR, POINTS, newCareer, applyResult, advanceRound, isSeasonOver,
  constructorStandings, driverStandings, boardOutcome, currentRound } from "../src/career.js";

// a finishing order putting the player team's two drivers P1/P2, rest in TEAMS order.
function classify(career) {
  const me = TEAMS[career.teamIdx];
  const head = me.drivers.map(d => ({ abbrev: d.abbrev, team: me.name }));
  const rest = TEAMS.flatMap((t, i) => i === career.teamIdx ? [] : t.drivers.map(d => ({ abbrev: d.abbrev, team: t.name })));
  return [...head, ...rest];
}

test("newCareer initialises zeroed standings for the full grid + a board target", () => {
  const c = newCareer({ teamIdx: 0, seed: 7 });
  assert.equal(Object.keys(c.driverPts).length, TEAMS.flatMap(t => t.drivers).length);
  assert.equal(Object.keys(c.teamPts).length, TEAMS.length);
  assert.ok(Object.values(c.driverPts).every(p => p === 0));
  assert.equal(c.round, 0);
  assert.ok(c.board.targetPos >= 1 && c.board.targetPos <= TEAMS.length);
  assert.ok(CALENDAR.length >= 10, "a real calendar");
  assert.equal(currentRound(c).shape !== undefined, true);
});

test("applyResult awards championship points + prize money to the player team", () => {
  const c = newCareer({ teamIdx: 3, seed: 1 });           // Ferrari
  const order = classify(c);
  const sum = applyResult(c, order);
  assert.equal(c.driverPts[order[0].abbrev], POINTS[0]);  // winner gets 25
  assert.equal(c.driverPts[order[1].abbrev], POINTS[1]);  // 18
  assert.equal(c.teamPts[TEAMS[3].name], POINTS[0] + POINTS[1]);  // both player drivers scored
  assert.ok(c.money > 0 && sum.prize > 0, "prize money paid for the player team");
  assert.equal(sum.podium.length, 3);
  assert.equal(c.lastResult.round, 0);
});

test("standings sort by points; total awarded == sum of POINTS per race", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  applyResult(c, classify(c));
  const cons = constructorStandings(c);
  assert.equal(cons[0].pos, 1);
  assert.equal(cons[0].isPlayer, true);                   // player swept the podium top-2
  const totalDriverPts = Object.values(c.driverPts).reduce((a, b) => a + b, 0);
  assert.equal(totalDriverPts, POINTS.reduce((a, b) => a + b, 0));  // 10 scorers
  assert.equal(driverStandings(c)[0].pts, POINTS[0]);
});

test("advanceRound walks the calendar then ends the season; board outcome reads final pos", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  let guard = 0;
  while (!isSeasonOver(c) && guard++ < 100) { applyResult(c, classify(c)); advanceRound(c); }
  assert.equal(c.done, true);
  const bo = boardOutcome(c);
  assert.equal(bo.finalPos, 1);                            // swept every race
  assert.equal(bo.met, true);                              // P1 beats any target
});

test("deterministic: same inputs -> identical standings", () => {
  const a = newCareer({ teamIdx: 5, seed: 9 }); applyResult(a, classify(a));
  const b = newCareer({ teamIdx: 5, seed: 9 }); applyResult(b, classify(b));
  assert.deepEqual(a.teamPts, b.teamPts);
  assert.deepEqual(a.driverPts, b.driverPts);
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test tests/career.test.js` → FAIL (no module).

- [ ] **Step 3: Implement** — `ApexWeb/src/career.js`:

```js
// ApexWeb/src/career.js — pure career/season state: calendar, standings, prize money, board
// objective. No UI, no I/O. M1 evolves only meta state (the sim is untouched). Deterministic.
import { TEAMS } from "./data.js";

// championship points for the top 10 finishers (current F1 system).
export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
// prize money ($k) by race-finish position — a simple per-race payout (M2 deepens income).
export const PRIZE = [1200, 1000, 850, 720, 620, 540, 470, 410, 360, 320, 280, 250, 220, 200, 180, 160, 150, 140, 130, 120, 110, 100];

// the season calendar: each round picks a real circuit shape (a track_shapes.js key) for the
// visual + geometry, plus the sim characteristics. overtake_zones auto-derive from `ot` in
// track_build.careerTrack() unless a round provides `zones`.
export const CALENDAR = [
  { name: "Гран-при Бахрейна",          shape: "Бахрейн",      laps: 57, lt: 91,  pit: 22.0, df: 0.55, pw: 0.70, ot: 0.55, sc: 0.30, wet: 0.05 },
  { name: "Гран-при Саудовской Аравии", shape: "Джидда",       laps: 50, lt: 90,  pit: 19.5, df: 0.40, pw: 0.80, ot: 0.50, sc: 0.55, wet: 0.05 },
  { name: "Гран-при Австралии",         shape: "Мельбурн",     laps: 58, lt: 80,  pit: 20.0, df: 0.55, pw: 0.60, ot: 0.45, sc: 0.45, wet: 0.25 },
  { name: "Гран-при Японии",            shape: "Сузука",       laps: 53, lt: 91,  pit: 22.0, df: 0.85, pw: 0.45, ot: 0.35, sc: 0.30, wet: 0.35 },
  { name: "Гран-при Майами",            shape: "Майами",       laps: 57, lt: 89,  pit: 19.0, df: 0.50, pw: 0.65, ot: 0.55, sc: 0.40, wet: 0.20 },
  { name: "Гран-при Эмилии-Романьи",    shape: "Имола",        laps: 63, lt: 78,  pit: 26.0, df: 0.70, pw: 0.55, ot: 0.20, sc: 0.40, wet: 0.25 },
  { name: "Гран-при Монако",            shape: "Монако",       laps: 78, lt: 73,  pit: 22.0, df: 0.95, pw: 0.30, ot: 0.05, sc: 0.55, wet: 0.30 },
  { name: "Гран-при Испании",           shape: "Барселона",    laps: 66, lt: 80,  pit: 23.5, df: 0.82, pw: 0.55, ot: 0.30, sc: 0.25, wet: 0.30 },
  { name: "Гран-при Канады",            shape: "Монреаль",     laps: 70, lt: 74,  pit: 18.0, df: 0.45, pw: 0.70, ot: 0.55, sc: 0.55, wet: 0.35 },
  { name: "Гран-при Австрии",           shape: "Шпильберг",    laps: 71, lt: 67,  pit: 20.0, df: 0.45, pw: 0.70, ot: 0.60, sc: 0.40, wet: 0.40 },
  { name: "Гран-при Великобритании",    shape: "Сильверстоун", laps: 52, lt: 88,  pit: 21.0, df: 0.75, pw: 0.60, ot: 0.50, sc: 0.40, wet: 0.45 },
  { name: "Гран-при Бельгии",           shape: "Спа",          laps: 44, lt: 105, pit: 19.0, df: 0.55, pw: 0.75, ot: 0.65, sc: 0.45, wet: 0.55 },
  { name: "Гран-при Венгрии",           shape: "Хунгароринг",  laps: 70, lt: 78,  pit: 21.0, df: 0.88, pw: 0.40, ot: 0.20, sc: 0.35, wet: 0.30 },
  { name: "Гран-при Нидерландов",       shape: "Зандворт",     laps: 72, lt: 72,  pit: 21.0, df: 0.80, pw: 0.50, ot: 0.30, sc: 0.40, wet: 0.40 },
  { name: "Гран-при Италии",            shape: "Монца",        laps: 53, lt: 81,  pit: 24.0, df: 0.20, pw: 0.95, ot: 0.70, sc: 0.35, wet: 0.25 },
  { name: "Гран-при Азербайджана",      shape: "Баку",         laps: 51, lt: 103, pit: 19.0, df: 0.35, pw: 0.85, ot: 0.55, sc: 0.60, wet: 0.15 },
  { name: "Гран-при Сингапура",         shape: "Сингапур",     laps: 62, lt: 96,  pit: 28.0, df: 0.90, pw: 0.40, ot: 0.20, sc: 0.75, wet: 0.35 },
  { name: "Гран-при США",               shape: "Остин",        laps: 56, lt: 96,  pit: 21.0, df: 0.65, pw: 0.65, ot: 0.55, sc: 0.45, wet: 0.30 },
  { name: "Гран-при Мексики",           shape: "Мехико",       laps: 71, lt: 78,  pit: 21.0, df: 0.55, pw: 0.55, ot: 0.45, sc: 0.45, wet: 0.25 },
  { name: "Гран-при Бразилии",          shape: "Интерлагос",   laps: 71, lt: 71,  pit: 20.0, df: 0.60, pw: 0.65, ot: 0.60, sc: 0.50, wet: 0.55 },
  { name: "Гран-при Лас-Вегаса",        shape: "Лас-Вегас",    laps: 50, lt: 95,  pit: 19.0, df: 0.30, pw: 0.85, ot: 0.65, sc: 0.55, wet: 0.10 },
  { name: "Гран-при Катара",            shape: "Лусаил",       laps: 57, lt: 83,  pit: 23.0, df: 0.80, pw: 0.50, ot: 0.35, sc: 0.35, wet: 0.05 },
  { name: "Гран-при Абу-Даби",          shape: "Яс-Марина",    laps: 58, lt: 86,  pit: 21.0, df: 0.60, pw: 0.60, ot: 0.40, sc: 0.40, wet: 0.05 },
];

function allDrivers() { return TEAMS.flatMap(t => t.drivers.map(d => ({ abbrev: d.abbrev, team: t.name }))); }

// a fresh career. teamIdx = which TEAMS entry the players manage; seed reserved for AI RNG.
export function newCareer({ teamIdx = 0, seed = 1, coop = false } = {}) {
  const driverPts = {}, teamPts = {};
  for (const d of allDrivers()) driverPts[d.abbrev] = 0;
  for (const t of TEAMS) teamPts[t.name] = 0;
  return {
    v: 1, seed: seed >>> 0, teamIdx, coop,
    season: 1, round: 0, money: 0,
    driverPts, teamPts,
    board: { targetPos: Math.min(TEAMS.length, teamIdx + 1) },  // meet your tier (P{teamIdx+1})
    lastResult: null, history: [], done: false,
  };
}

export function currentRound(career) { return CALENDAR[career.round]; }
export function isSeasonOver(career) { return career.round >= CALENDAR.length; }

// award points + prize money for a finished race. classification = finishing order
// [{abbrev, team, retired}] (index 0 = winner). Mutates career; returns a summary.
export function applyResult(career, classification) {
  const podium = [];
  let prize = 0;
  const myTeam = TEAMS[career.teamIdx].name;
  classification.forEach((c, i) => {
    const pts = i < POINTS.length ? POINTS[i] : 0;
    if (career.driverPts[c.abbrev] != null) career.driverPts[c.abbrev] += pts;
    if (career.teamPts[c.team] != null) career.teamPts[c.team] += pts;
    if (i < 3) podium.push(c.abbrev);
    if (c.team === myTeam) prize += (i < PRIZE.length ? PRIZE[i] : 100);
  });
  career.money += prize;
  const summary = {
    round: career.round, gp: CALENDAR[career.round].name, podium, prize,
    classification: classification.map((c, i) => ({ pos: i + 1, abbrev: c.abbrev, team: c.team, retired: !!c.retired })),
  };
  career.lastResult = summary;
  career.history.push(summary);
  return summary;
}

// advance to the next round. Returns true if a next round exists, false if the season ended.
export function advanceRound(career) {
  career.round += 1;
  if (isSeasonOver(career)) { career.done = true; return false; }
  return true;
}

export function constructorStandings(career) {
  return TEAMS.map((t, i) => ({ team: t.name, color: t.color, pts: career.teamPts[t.name], isPlayer: i === career.teamIdx }))
    .sort((a, b) => b.pts - a.pts).map((r, i) => ({ ...r, pos: i + 1 }));
}
export function driverStandings(career) {
  const info = {}; for (const d of allDrivers()) info[d.abbrev] = d.team;
  return Object.keys(career.driverPts).map(a => ({ abbrev: a, team: info[a], pts: career.driverPts[a] }))
    .sort((a, b) => b.pts - a.pts).map((r, i) => ({ ...r, pos: i + 1 }));
}
export function boardOutcome(career) {
  const standings = constructorStandings(career);
  const me = standings.find(s => s.isPlayer);
  return { finalPos: me ? me.pos : TEAMS.length, target: career.board.targetPos, met: me ? me.pos <= career.board.targetPos : false };
}
// start a new season: reset round + points, keep team + money + seed, bump the season number.
export function newSeason(career) {
  const fresh = newCareer({ teamIdx: career.teamIdx, seed: career.seed, coop: career.coop });
  fresh.season = career.season + 1;
  fresh.money = career.money;
  return fresh;
}
```

- [ ] **Step 4: Run to verify it passes** — `node --test tests/career.test.js` → all pass. `node --test` → all green.

- [ ] **Step 5: Commit** — `git add ApexWeb/src/career.js ApexWeb/tests/career.test.js` then commit `feat(apexweb): career state — calendar, standings, prize money, board (M1)`.

---

## Task 2: career_store.js — persistence

**Files:** Create `ApexWeb/src/career_store.js`; Test `ApexWeb/tests/career_store.test.js`.

- [ ] **Step 1: Failing test** — `ApexWeb/tests/career_store.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { newCareer, applyResult } from "../src/career.js";
import { TEAMS } from "../src/data.js";

// minimal localStorage mock for Node
globalThis.localStorage = (() => { let m = {}; return {
  getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); },
  removeItem: k => { delete m[k]; }, clear: () => { m = {}; },
}; })();

const { saveCareer, loadCareer, clearCareer, hasCareer, exportCareer, importCareer } = await import("../src/career_store.js");

test("save -> load round-trips the career", () => {
  const c = newCareer({ teamIdx: 2, seed: 5 });
  applyResult(c, TEAMS.flatMap(t => t.drivers.map(d => ({ abbrev: d.abbrev, team: t.name }))));
  assert.equal(saveCareer(c), true);
  assert.equal(hasCareer(), true);
  const back = loadCareer();
  assert.equal(back.teamIdx, 2);
  assert.equal(back.money, c.money);
  assert.deepEqual(back.teamPts, c.teamPts);
});

test("clear removes the save; load returns null", () => {
  saveCareer(newCareer({ teamIdx: 0, seed: 1 }));
  clearCareer();
  assert.equal(loadCareer(), null);
  assert.equal(hasCareer(), false);
});

test("export/import round-trips via JSON; bad JSON -> null", () => {
  const c = newCareer({ teamIdx: 1, seed: 3 });
  const json = exportCareer(c);
  assert.deepEqual(importCareer(json).teamPts, c.teamPts);
  assert.equal(importCareer("{not json"), null);
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test tests/career_store.test.js` → FAIL (no module).

- [ ] **Step 3: Implement** — `ApexWeb/src/career_store.js`:

```js
// ApexWeb/src/career_store.js — persistence for the career/season state (localStorage) + JSON
// export/import. Wrapped so private-mode / quota / corrupt data degrades to "no save".
const KEY = "apexweb_career";
const ls = () => (typeof localStorage !== "undefined" ? localStorage : null);

export function saveCareer(career) {
  const s = ls(); if (!s || !career) return false;
  try { s.setItem(KEY, JSON.stringify(career)); return true; } catch { return false; }
}
export function loadCareer() {
  const s = ls(); if (!s) return null;
  try { const c = JSON.parse(s.getItem(KEY) || "null"); return (c && c.v === 1) ? c : null; } catch { return null; }
}
export function hasCareer() { return !!loadCareer(); }
export function clearCareer() { const s = ls(); if (s) { try { s.removeItem(KEY); } catch {} } }
export function exportCareer(career) { return JSON.stringify(career); }
export function importCareer(json) {
  try { const c = JSON.parse(json); return (c && c.v === 1) ? c : null; } catch { return null; }
}
```

- [ ] **Step 4: Run to verify it passes** — `node --test tests/career_store.test.js` → pass. `node --test` → green.

- [ ] **Step 5: Commit** — `git add ApexWeb/src/career_store.js ApexWeb/tests/career_store.test.js` then `feat(apexweb): career persistence (localStorage + export/import) (M1)`.

---

## Task 3: track_build.js — careerTrack(round)

**Files:** Modify `ApexWeb/src/track_build.js`; Test `ApexWeb/tests/track_build.test.js`.

- [ ] **Step 1: Failing test** — `ApexWeb/tests/track_build.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { CALENDAR } from "../src/career.js";
import { careerTrack, defaultZones } from "../src/track_build.js";
import { N_MINI } from "../src/track.js";

test("careerTrack builds a sim track from a calendar round: mini + params + zones", () => {
  const monza = CALENDAR.find(r => r.shape === "Монца");
  const t = careerTrack(monza);
  assert.equal(t.mini.length, N_MINI);
  assert.equal(t.laps, monza.laps);
  assert.equal(t.pw, monza.pw);
  assert.equal(t.name, monza.name);
  assert.ok(Array.isArray(t.overtake_zones) && t.overtake_zones.length >= 1);
  for (const z of t.overtake_zones) for (const s of z.sectors) assert.ok(s >= 0 && s < N_MINI, "zone sector index in range");
});

test("defaultZones: a more overtakeable track gets easier zones", () => {
  const easy = defaultZones(0.7)[0].ease, hard = defaultZones(0.1)[0].ease;
  assert.ok(easy > hard);
  assert.ok(hard >= 0.2 && easy <= 0.8);
});

test("an unknown shape falls back to the Barcelona outline (still N_MINI sectors)", () => {
  const t = careerTrack({ name: "X", shape: "НЕТ", laps: 50, lt: 80, pit: 22, df: 0.5, pw: 0.5, ot: 0.4, sc: 0.3, wet: 0.1 });
  assert.equal(t.mini.length, N_MINI);
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test tests/track_build.test.js` → FAIL (`careerTrack` undefined).

- [ ] **Step 3: Implement** — add to `ApexWeb/src/track_build.js`. Add the import at the top (after the existing imports):

```js
import { TRACK_SHAPES } from "./track_shapes.js";
```

Append at the end of the file:

```js
// overtake zones derived from a round's `ot`: a braking zone into T1 + a slipstream zone, with
// `ease` scaled by how overtakeable the circuit is. The sim completes passes only inside a zone.
export function defaultZones(ot) {
  const ease = Math.max(0.20, Math.min(0.80, 0.30 + ot * 0.55));
  return [
    { sectors: [0, 1, 2], ease, type: "brake" },
    { sectors: [11, 12], ease: Math.max(0.18, ease * 0.85), type: "slip" },
  ];
}

// build a sim race-track for a career calendar round: visual + geometry from the round's real
// circuit shape; sim characteristics from the round; zones auto-derived unless `round.zones` set.
export function careerTrack(round, base = TRACK) {
  const outline = TRACK_SHAPES[round.shape] || TRACK_PATH;
  return {
    ...base,
    name: round.name, gp: round.name,
    laps: round.laps, lt: round.lt, pit: round.pit,
    df: round.df, pw: round.pw, ot: round.ot, sc: round.sc, wet: round.wet,
    mini: buildMini(outline),
    overtake_zones: Array.isArray(round.zones) ? round.zones : defaultZones(round.ot),
  };
}
```

- [ ] **Step 4: Run to verify it passes** — `node --test tests/track_build.test.js` → pass. `node --test` → green.

- [ ] **Step 5: Commit** — `git add ApexWeb/src/track_build.js ApexWeb/tests/track_build.test.js` then `feat(apexweb): careerTrack — calendar round -> sim track (M1)`.

---

## Task 4: tools/career_balance.mjs — season corridor

**Files:** Create `ApexWeb/tools/career_balance.mjs`.

This proves the loop end-to-end: build a field like the game, run every calendar round to the flag with the real sim, feed the classification to `applyResult`, advance, and check the corridors.

- [ ] **Step 1: Implement** — `ApexWeb/tools/career_balance.mjs`:

```js
// ApexWeb/tools/career_balance.mjs — career-loop corridor. Sims a full season with the real
// engine and checks: every round completes, points conserve, the season ends with a board
// verdict, and passes/race stays in band across the varied calendar. Run: node tools/career_balance.mjs
import { TEAMS } from "../src/data.js";
import { Race } from "../src/sim.js";
import { driverAttrs, composeCar, genPersonnel } from "../src/team.js";
import { CALENDAR, POINTS, newCareer, applyResult, advanceRound, isSeasonOver, constructorStandings, boardOutcome } from "../src/career.js";
import { careerTrack } from "../src/track_build.js";

function field() {
  let idx = 0;
  return TEAMS.flatMap((t, ti) => t.drivers.map(d => ({
    idx: idx++, name: d.name, abbrev: d.abbrev, skill: d.skill,
    car: composeCar(t.car), color: t.color, team: t.name,
    attrs: driverAttrs(d.abbrev, d.skill), personnel: genPersonnel(t.facility, ti),
    setup: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5], setupBonus: 0, startTyre: "medium",
  })));
}
function runRace(track, seed) {
  const r = new Race(field(), track, seed, 0.80);
  r.gridStart();
  let g = 0; while (!r.finished && g++ < 500000) r.step(0.25);
  return r.order().map(c => ({ abbrev: c.abbrev, team: c.team, retired: c.retired, passes: r.events ? r.events.filter(e => e.type === "overtake").length : 0 }));
}

const career = newCareer({ teamIdx: 0, seed: 1 });
let totalPts = 0, minPass = 1e9, maxPass = 0, races = 0;
const expectedPerRace = POINTS.reduce((a, b) => a + b, 0);
while (!isSeasonOver(career)) {
  const round = CALENDAR[career.round];
  const track = careerTrack(round);
  const cls = runRace(track, 1000 + career.round);
  const before = Object.values(career.driverPts).reduce((a, b) => a + b, 0);
  applyResult(career, cls);
  const gained = Object.values(career.driverPts).reduce((a, b) => a + b, 0) - before;
  if (gained !== expectedPerRace) { console.error(`ROUND ${career.round} ${round.name}: points ${gained} != ${expectedPerRace}`); process.exit(1); }
  const passes = cls[0].passes; minPass = Math.min(minPass, passes); maxPass = Math.max(maxPass, passes);
  console.log(`R${String(career.round + 1).padStart(2)} ${round.name.padEnd(28)} win=${cls[0].abbrev} passes≈${passes}`);
  totalPts += gained; races++;
  advanceRound(career);
}
const bo = boardOutcome(career);
const champ = constructorStandings(career)[0];
console.log(`\nseason: ${races} races, ${totalPts} pts awarded, champion=${champ.team} (${champ.pts}), player P${bo.finalPos} target P${bo.target} -> ${bo.met ? "MET" : "MISSED"}`);
console.log(`passes/race across the calendar: ${minPass}..${maxPass} (cumulative event log, sanity only)`);
if (races !== CALENDAR.length) { console.error("season did not complete all rounds"); process.exit(1); }
console.log("CAREER CORRIDOR OK");
```

- [ ] **Step 2: Run it** — `node tools/career_balance.mjs` → every round prints, points conserve each race (`expectedPerRace`), season completes all rounds, ends with "CAREER CORRIDOR OK". (Runtime ~30–60 s for the full calendar.)

- [ ] **Step 3: Commit** — `git add ApexWeb/tools/career_balance.mjs` then `test(apexweb): career-loop season corridor (M1)`.

> NOTE: `runRace` reads `r.events` overtake count only as a sanity readout; if the sim's event `type` differs, adjust the filter. The hard assertions are points-conservation + season completion (engine-independent).

---

## Task 5: ui/season.js — the season screen

**Files:** Create `ApexWeb/src/ui/season.js`.

- [ ] **Step 1: Implement** — `ApexWeb/src/ui/season.js`:

```js
// ApexWeb/src/ui/season.js — between-races season screen: standings, last race, board target,
// and the gate to the next round. Reads ctx.careerView + ctx.careerReadyView (set by main on
// host AND client). Inline styles keep it self-contained (owner can restyle later).
import { CALENDAR, constructorStandings, driverStandings, boardOutcome } from "../career.js";
import { TEAM_LOGO } from "../data.js";

const row = (cells, hot) => `<tr style="${hot ? "font-weight:700;color:var(--good)" : ""}">${cells.map(c => `<td style="padding:3px 8px">${c}</td>`).join("")}</tr>`;

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

  let footer;
  if (c.done) {
    const bo = boardOutcome(c);
    footer = `<div class="panel">
      <h3>Сезон ${c.season} завершён</h3>
      <p class="label">Цель совета: не ниже P${bo.target} в Кубке конструкторов.</p>
      <p style="font-size:18px;font-weight:700;color:${bo.met ? "var(--good)" : "var(--bad)"}">
        ${bo.met ? "✅ Цель выполнена" : "❌ Цель не выполнена"} — итог P${bo.finalPos}</p>
      <button class="primary" id="newseason">Новый сезон ▶</button></div>`;
  } else {
    const nextR = CALENDAR[c.round];
    footer = `<div class="panel">
      <p class="label">Следующий этап · раунд ${c.round + 1} из ${CALENDAR.length}</p>
      <h3>${nextR.name}</h3>
      <p class="label">Бюджет: $${(c.money / 1000).toFixed(2)}M</p>
      <button class="primary" id="next">${meReady ? "Готов ✓ — ждём напарника…" : "К следующей гонке ▶"}</button></div>`;
  }

  root.innerHTML = `
    <div class="panel">
      <h2>Сезон ${c.season} · ${me ? me.team : ""} (P${me ? me.pos : "-"})</h2>
      ${lr ? `<p class="label">${lr.gp}: ${podium} · призовые $${lr.prize}k</p>` : `<p class="label">Старт сезона</p>`}
    </div>
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <div class="panel" style="flex:1;min-width:260px"><p class="label">Кубок конструкторов</p>
        <table style="width:100%;border-collapse:collapse"><tbody>${consTbl}</tbody></table></div>
      <div class="panel" style="flex:1;min-width:260px"><p class="label">Личный зачёт (топ-10)</p>
        <table style="width:100%;border-collapse:collapse"><tbody>${drvTbl}</tbody></table></div>
    </div>
    ${footer}`;

  const nb = root.querySelector("#next");
  if (nb) nb.onclick = () => { nb.disabled = true; ctx.send({ cmd: "career_next", player: ctx.myPlayer }); };
  const ns = root.querySelector("#newseason");
  if (ns) ns.onclick = () => { ns.disabled = true; ctx.send({ cmd: "career_newseason", player: ctx.myPlayer }); };
}
```

- [ ] **Step 2: Verify** — `node --check ApexWeb/src/ui/season.js` → OK.

- [ ] **Step 3: Commit** — `git add ApexWeb/src/ui/season.js` then `feat(apexweb): season screen — standings + board + next/ready (M1)`.

---

## Task 6: main.js — wire the career loop

**Files:** Modify `ApexWeb/src/main.js`.

- [ ] **Step 1: Imports** — after `import { loadAll } from "./track_store.js";` add:

```js
import * as seasonUI from "./ui/season.js";
import { newCareer, newSeason, currentRound, applyResult, advanceRound } from "./career.js";
import { careerTrack } from "./track_build.js";
import { saveCareer } from "./career_store.js";
```

- [ ] **Step 2: Render the season screen after a career race.** In `rerender()`, replace the render call

```js
    SCREENS[phase].render(root, ctx);
```
with
```js
    const mod = (ctx.career && phase === "result") ? seasonUI : SCREENS[phase];
    mod.render(root, ctx);
```

- [ ] **Step 3: Career start (solo + co-op) + helpers.** After `startSolo()` add:

```js
// keep host + client rendering from the same career view
function publishCareer() {
  ctx.careerView = ctx.career;
  ctx.careerReadyView = ctx.careerReady;
  if (ctx.net) ctx.net.send({ type: "career", career: ctx.career, ready: ctx.careerReady });
}
// configure ctx for the career's current round (track visual + sim track) before a weekend.
function loadRoundTrack() {
  const round = currentRound(ctx.career);
  ctx.track = careerTrack(round);
  ctx.trackName = round.shape;
}
// reset the per-weekend scratch so the next round starts clean.
function resetWeekendState() {
  ctx.seed = null; ctx.pracSession = null; ctx.qualiSession = null;
  ctx.race = null; ctx.setups = null; ctx._roundRecorded = null;
}
// SOLO career: single player engineers p1; teammate + grid AI.
export function startCareerSolo(teamIdx) {
  ctx.role = "host"; ctx.myPlayer = "p1"; ctx.solo = true; ctx.net = null;
  ctx.teamIdx = teamIdx;
  ctx.career = newCareer({ teamIdx, seed: 1000 + Math.floor(Math.random() * 100000), coop: false });
  ctx.careerReady = { p1: false, p2: false };
  resetWeekendState(); loadRoundTrack(); publishCareer();
  ctx.weekend.solo = true;
  requestAnimationFrame(hostLoop);
  ctx.weekend.start();
}
// CO-OP career: host creates it; the first weekend begins when the partner joins (see onMessage hello).
export function hostCareer(teamIdx) { ctx.careerPending = teamIdx; }
function beginCoopCareer() {
  ctx.teamIdx = ctx.careerPending;
  ctx.career = newCareer({ teamIdx: ctx.careerPending, seed: 1000 + Math.floor(Math.random() * 100000), coop: true });
  ctx.careerReady = { p1: false, p2: false };
  ctx.careerPending = null;
  resetWeekendState(); loadRoundTrack(); publishCareer();
  ctx.weekend.start();
}
// advance the season after both players are ready (or solo).
function advanceCareer() {
  ctx.careerReady = { p1: false, p2: false };
  const hasNext = advanceRound(ctx.career);
  saveCareer(ctx.career);
  if (!hasNext) { publishCareer(); rerender(); return; }   // season over -> season screen shows the verdict
  resetWeekendState(); loadRoundTrack(); publishCareer();
  ctx.weekend._goto("practice1");                          // fires onPhase -> onPhaseHost sets up practice + broadcasts
}
function startNewSeason() {
  ctx.career = newSeason(ctx.career);
  ctx.careerReady = { p1: false, p2: false };
  resetWeekendState(); loadRoundTrack(); publishCareer();
  ctx.weekend._goto("practice1");
}
```

- [ ] **Step 4: Record the result once, on the host, when the race finishes.** In `hostLoop`, the race-finished block currently reads:

```js
    if (ctx.race.finished) {
      pushRaceState();
      ctx.weekend.setReady("p1"); ctx.weekend.setReady("p2");  // race -> result (onPhase broadcasts)
    }
```
Replace with:
```js
    if (ctx.race.finished) {
      if (ctx.career && ctx._roundRecorded !== ctx.career.round) {
        const cls = ctx.race.order().map(c => ({ abbrev: c.abbrev, team: c.team, retired: c.retired }));
        applyResult(ctx.career, cls);
        ctx._roundRecorded = ctx.career.round;
        saveCareer(ctx.career);
        publishCareer();
      }
      pushRaceState();
      ctx.weekend.setReady("p1"); ctx.weekend.setReady("p2");  // race -> result (onPhase broadcasts)
    }
```

- [ ] **Step 5: Handle the advance commands.** In `onCommand`, add cases (e.g. after the `ready` case):

```js
    case "career_next":
      if (ctx.career) { ctx.careerReady[cmd.player] = true; publishCareer(); rerender();
        if (ctx.solo || (ctx.careerReady.p1 && ctx.careerReady.p2)) advanceCareer(); }
      break;
    case "career_newseason":
      if (ctx.career && ctx.career.done) { ctx.careerReady[cmd.player] = true;
        if (ctx.solo || (ctx.careerReady.p1 && ctx.careerReady.p2)) startNewSeason(); }
      break;
```

- [ ] **Step 6: Client receives the career snapshot + co-op career start.** In `onMessage`, add (after the `phase` handler):

```js
  if (m.type === "career") { ctx.careerView = m.career; ctx.careerReadyView = m.ready; rerender(); }
```
And in the host `hello` handler, replace `ctx.weekend.start();` with:
```js
      if (ctx.careerPending != null) beginCoopCareer(); else ctx.weekend.start();
```

- [ ] **Step 7: Re-broadcast the career on phase changes (client may join mid-season).** In `ctx.weekend.onPhase`, after `if (ctx.net) ctx.net.send({ type: "phase", phase });` add:

```js
    if (ctx.career && ctx.net) ctx.net.send({ type: "career", career: ctx.career, ready: ctx.careerReady });
```

- [ ] **Step 8: Verify** — `node --check ApexWeb/src/main.js` → OK. `node --test` → all green (no test imports main.js; this must not break parsing).

- [ ] **Step 9: Commit** — `git add ApexWeb/src/main.js` then `feat(apexweb): wire the career loop into main (track/round, record-once, advance gate, broadcast) (M1)`.

---

## Task 7: lobby.js — career entry

**Files:** Modify `ApexWeb/src/ui/lobby.js`.

- [ ] **Step 1: Implement** — import the career starters and add a career checkbox.

Change the import line to:
```js
import { hostGame, joinGame, startSolo, startCareerSolo, hostCareer, ctx } from "../main.js";
```
After the difficulty `<select>` block in the template (before the `#host` button), add a career toggle:
```js
      <div style="height:10px"></div>
      <label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="career"> Карьера (сезон 23 этапа)</label>
```
Then change the solo + host handlers:
```js
  root.querySelector("#solo").onclick = () => {
    if (root.querySelector("#career").checked) startCareerSolo(ctx.teamIdx); else startSolo();
  };
  root.querySelector("#host").onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = "Создаём комнату…";
    if (root.querySelector("#career").checked) hostCareer(ctx.teamIdx);   // career begins when partner joins
    const code = await hostGame(useP2P);
    root.querySelector("#status").innerHTML =
      `<div style="margin-top:6px">Код комнаты — передай напарнику:</div>
       <div style="font-size:20px;font-weight:700;color:var(--good);user-select:all;word-break:break-all;margin:6px 0">${code}</div>
       <div>Ждём, когда напарник войдёт по коду…</div>`;
  };
```

- [ ] **Step 2: Verify** — `node --check ApexWeb/src/ui/lobby.js` → OK.

- [ ] **Step 3: Commit** — `git add ApexWeb/src/ui/lobby.js` then `feat(apexweb): lobby career entry (solo + co-op) (M1)`.

---

## Final verification

- [ ] `node --test` (in `ApexWeb/`) → all green (existing + career + career_store + track_build).
- [ ] `node tools/career_balance.mjs` → CAREER CORRIDOR OK (full season, points conserve).
- [ ] `node --check src/main.js src/ui/lobby.js src/ui/season.js` → OK.
- [ ] Owner F5 (browser, not headless-verifiable): lobby → «Карьера» → solo → play a weekend → season screen with standings + prize → «К следующей гонке» → next circuit loads → … → season-end board verdict → «Новый сезон». Co-op: same with a partner, advance gated on both «Готов».

## Self-review notes
- **Spec coverage:** calendar ✓ (CALENDAR, careerTrack), standings ✓, prize money ✓ (PRIZE), save/continue ✓ (career_store + saveCareer on result/advance), board objective ✓ (board.targetPos, boardOutcome), pick a team ✓ (lobby teamIdx → startCareerSolo/hostCareer), co-op both-ready ✓ (career_next gate + career broadcast). Sim untouched ✓ (only buildField reads ctx.teamIdx as before; no sim/quali/practice edits).
- **Determinism:** career math is pure + deterministic; live seed via Math.random is UI-layer only (sim stays deterministic from the chosen seed), corridor uses fixed seeds.
- **WIP isolation:** explicit pathspecs per commit; new files + clean-file edits (main.js, lobby.js, track_build.js) only; owner's sim.js/balance.mjs/tests/sim.test.js untouched.
