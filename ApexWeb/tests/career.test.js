import { test } from "node:test";
import assert from "node:assert/strict";
import { TEAMS } from "../src/data.js";
import { CALENDAR, POINTS, newCareer, applyResult, advanceRound, isSeasonOver,
  constructorStandings, driverStandings, boardOutcome, currentRound, newSeason } from "../src/career.js";

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

// --- M2 finances + sponsors ---
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
  assert.ok(sum.salaries >= 0);
  assert.equal(sum.net, sum.prize + sum.sponsorIncome - sum.runningCost - sum.salaries - sum.upkeep);
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

// --- M3 car development ---
import { startProject } from "../src/development.js";

test("newCareer at v3 carries carDev + a null project + a season dev-spend counter", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  assert.equal(c.v, CAREER_V);
  assert.ok(c.v >= 3);
  assert.deepEqual(c.project, null);
  assert.equal(c.devSpentThisSeason, 0);
  assert.ok(c.parts && typeof c.parts === "object");
});

test("advanceRound develops the car: a finished project lands + AI teams gain", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  startProject(c, "pu", "small");                     // completes after 1 round (part project)
  advanceRound(c);
  assert.ok(c.parts["McLaren"].pu > 0, "player part gain applied on advance");
  assert.ok(c.parts[TEAMS[8].name].pu > 0, "AI developed parts");
});

test("migrate upgrades a v2 save to v3 (adds carDev/project)", () => {
  const v2 = { v: 2, teamIdx: 1, seed: 3, season: 1, round: 0, money: 0, driverPts: {}, teamPts: {}, board: { targetPos: 2 }, sponsors: [], costCap: false, pendingOffers: [], lastResult: null, history: [], done: false };
  const up = migrate(v2);
  assert.equal(up.v, CAREER_V);
  assert.deepEqual(up.project, null);
  assert.ok(up.parts && typeof up.parts === "object");   // D3: carDev -> parts at v8
});

test("migrate v8 -> v9 backfills persistent driver attrs + traits (D5)", () => {
  const v8 = { v: 8, teamIdx: 0, seed: 1, season: 1, round: 0, money: 0, driverPts: {}, teamPts: {}, board: { targetPos: 1, confidence: 0.5 }, sponsors: [], costCap: false, pendingOffers: [], parts: {}, news: [], academy: [], staff: {},
    drivers: { VER: { teamIdx: 1, age: 28, overall: 0.95, morale: 0.6, contractSeasons: 3, salary: 500 } } };
  const up = migrate(v8);
  assert.equal(up.v, CAREER_V);
  assert.equal(Object.keys(up.drivers.VER.attrs).length, 13);
  assert.ok(up.drivers.VER.traits.includes("overtaker"));
});

// --- M4 drivers ---
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
  assert.equal(sum.net, sum.prize + sum.sponsorIncome - sum.runningCost - sum.salaries - sum.upkeep);
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

// --- M5 staff & facilities ---
import { upgradeFacility } from "../src/staff.js";

test("newCareer at v5 carries staff + facilities", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  assert.ok(c.v >= 5);
  assert.ok(c.staff && c.staff.designer > 0 && c.staff.facilities && c.staff.facilities.design >= 0);
});

test("applyResult books facility upkeep as an expense", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  upgradeFacility(c, "design"); upgradeFacility(c, "pit");
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

// --- M6 transfer market ---
test("newSeason runs AI churn but keeps every team at 2 drivers and the player team intact", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  const c2 = newSeason(c);
  const counts = {};
  for (const a in c2.drivers) counts[c2.drivers[a].teamIdx] = (counts[c2.drivers[a].teamIdx] || 0) + 1;
  for (const k in counts) assert.equal(counts[k], 2);
  assert.equal(c2.drivers["NOR"].teamIdx, 0);            // player team not churned
  let moved = 0; for (const a in c.drivers) if (c.drivers[a].teamIdx !== c2.drivers[a].teamIdx) moved++;
  assert.ok(moved >= 2, "AI churn moved at least one pair");
});

// --- M7 academy ---
import { signJunior } from "../src/academy.js";

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

// --- M8 board, news, regulation ---
test("newCareer at v7 has board confidence + an empty news inbox", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  assert.ok(c.v >= 7);
  assert.equal(c.board.confidence, 0.5);
  assert.deepEqual(c.news, []);
});

test("applyResult moves confidence and posts a board news line", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  const order = [...TEAMS[0].drivers.map(d => ({ abbrev: d.abbrev, team: "McLaren" })),
    ...TEAMS.flatMap((t, i) => i === 0 ? [] : t.drivers.map(d => ({ abbrev: d.abbrev, team: t.name })))];
  applyResult(c, order);
  assert.ok(c.board.confidence > 0.5, "a P1 lifts confidence");
  assert.ok(c.news.length >= 1 && /Совет/.test(c.news[0]));
});

test("newSeason applies a regulation reset that reduces car development", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  c.parts["McLaren"] = { fw: 0, rw: 0, floor: 0.10, sidepods: 0, susp: 0, pu: 0.08 };
  const c2 = newSeason(c);
  assert.ok(c2.parts["McLaren"].floor < 0.10, "regs reset trims part development");
  assert.ok(c2.news.some(n => /регламент/i.test(n)), "a regs-change news line is posted");
});

test("boardOutcome reports confidence + a sacked flag when target missed and confidence low", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  c.teamPts["Mercedes"] = 100;                              // a rival leads -> player misses P1
  c.board.confidence = 0.1;
  const bo = boardOutcome(c);
  assert.equal(bo.met, false);
  assert.equal(bo.sacked, true);
  assert.ok(bo.confidence <= 0.2);
});

// --- D1 real FastF1 track data ---
test("D1: calendar baked with real FastF1 values (Monaco/Spa/Vegas/Austria)", () => {
  const m = CALENDAR.find(r => r.shape === "Монако");
  assert.ok(Math.abs(m.lt - 77.9) < 0.5 && m.ot === 0.00, "Monaco: real low lt, zero overtaking");
  assert.ok(CALENDAR.find(r => r.shape === "Спа").lt > 105, "Spa: ~107.8s real lap");
  assert.equal(CALENDAR.find(r => r.shape === "Лас-Вегас").ot, 1.00, "Vegas: top overtaking");
  assert.ok(CALENDAR.find(r => r.shape === "Шпильберг").lt < 72, "Austria: ~70.4s real lap");
});

test("migrate upgrades a v6 save to v7 (adds confidence + news)", () => {
  const v6 = { v: 6, teamIdx: 1, seed: 3, season: 1, round: 0, money: 0, driverPts: {}, teamPts: {}, board: { targetPos: 2 }, sponsors: [], costCap: false, pendingOffers: [], carDev: {}, project: null, devSpentThisSeason: 0, drivers: {}, staff: {}, academy: [], lastResult: null, history: [], done: false };
  const up = migrate(v6);
  assert.equal(up.v, CAREER_V);
  assert.equal(up.board.confidence, 0.5);
  assert.deepEqual(up.news, []);
});

// --- D3 parts migration ---
test("D3: migrate upgrades a v7 save to v8 (carDev -> parts)", () => {
  const v7 = { v: 7, teamIdx: 1, seed: 3, season: 1, round: 0, money: 0, driverPts: {}, teamPts: {}, board: { targetPos: 2, confidence: 0.5 }, sponsors: [], costCap: false, pendingOffers: [], carDev: { McLaren: { power: 0.1 } }, project: null, devSpentThisSeason: 0, drivers: {}, staff: {}, academy: [], news: [], lastResult: null, history: [], done: false };
  const up = migrate(v7);
  assert.equal(up.v, CAREER_V);
  assert.ok(up.parts && typeof up.parts === "object");
  assert.equal(up.carDev, undefined, "old carDev removed");
});
