import { test } from "node:test";
import assert from "node:assert/strict";
import { TEAMS } from "../src/data.js";
import { CALENDAR, POINTS, newCareer, applyResult, advanceRound, isSeasonOver,
  constructorStandings, driverStandings, boardOutcome, currentRound, newSeason, teamAppeal, appealMult, seasonAwards, expectedFinish, STEWARD_FINE } from "../src/career.js";
import { CHEM_START } from "../src/perks.js";
import { requestBoardFunds, runningCostFor } from "../src/career.js";

test("§Phase-6 requestBoardFunds: cash now, confidence cost, once per season", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  c.board.confidence = 0.6;
  const m0 = c.money;
  assert.equal(requestBoardFunds(c, 4000), 4000, "draws the requested cash (capped)");
  assert.equal(c.money, m0 + 4000, "cash added");
  assert.ok(c.board.confidence < 0.6, "board confidence dropped");
  assert.equal(c.boardFundsUsed, true);
  assert.equal(requestBoardFunds(c, 2000), 0, "only once per season");
  assert.equal(requestBoardFunds(newCareer({ teamIdx: 0, seed: 1 }), -5), 0, "rejects a non-positive request");
});

test("§Phase-6 seasonAwards: MotS = the constructor that most beat its tier", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  const back = TEAMS[10].name;                 // weakest tier
  c.teamPts[back] = 9999;                       // a back-marker leading the constructors = big over-performance
  const aw = seasonAwards(c);
  assert.equal(aw.mots, back, "the over-performing back-marker is Move of the Season");
  assert.ok(aw.motsOver > 0);
});

test("§Phase-3 pay driver brings sponsorship cash each race (income line)", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  const a = Object.keys(c.drivers).find(ab => c.drivers[ab].teamIdx === 0);
  c.drivers[a].payDriver = true;
  const sum = applyResult(c, TEAMS.flatMap(t => t.drivers.map(d => ({ abbrev: d.abbrev, team: t.name, retired: false }))));
  assert.ok(sum.payIncome >= 320, "a pay driver in the lineup adds an income line");
});

test("§Phase-3 under-valuing a driver (paid far less than teammate) costs morale vs equal pay", () => {
  const mk = gap => {
    const c = newCareer({ teamIdx: 0, seed: 1 });
    const [a, b] = Object.keys(c.drivers).filter(ab => c.drivers[ab].teamIdx === 0);
    c.drivers[a].salary = 100; c.drivers[b].salary = gap ? 1000 : 100;
    applyResult(c, TEAMS.flatMap(t => t.drivers.map(d => ({ abbrev: d.abbrev, team: t.name, retired: false }))));
    return c.drivers[a].morale;
  };
  assert.ok(mk(true) < mk(false), "an under-valued driver ends with lower morale than an equal-pay control");
});

test("§Phase-6 sponsor upfront-vs-retainer: lump now, lower retainer, mean-neutral over the season", () => {
  const base = newCareer({ teamIdx: 0, seed: 1 }), up = newCareer({ teamIdx: 0, seed: 1 });
  const m0 = up.money;
  chooseTitleSponsor(base, 0, false);
  chooseTitleSponsor(up, 0, true);
  const bt = base.sponsors.find(s => s.kind === "title"), ut = up.sponsors.find(s => s.kind === "title");
  assert.ok(up.money > m0, "upfront pays a lump now");
  assert.ok(ut.retainer < bt.retainer, "and a lower per-race retainer");
  const N = CALENDAR.length, upTotal = (up.money - m0) + ut.retainer * N, baseTotal = bt.retainer * N;
  assert.ok(Math.abs(upTotal - baseTotal) / baseTotal < 0.02, "season total ≈ neutral (cashflow choice, not free money)");
});

test("§Phase-6 runningCostFor scales with race length; mean-neutral over the calendar", () => {
  assert.ok(runningCostFor({ laps: 78 }) > runningCostFor({ laps: 44 }), "a longer race costs more to run");
  const total = CALENDAR.reduce((a, r) => a + runningCostFor(r), 0), flat = CALENDAR.length * RUNNING_COST;
  assert.ok(Math.abs(total - flat) / flat < 0.01, "season total ≈ flat RUNNING_COST (mean-neutral)");
});

test("§Phase-5 mechChem: initialised at start, grows each race, migrates from v32", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  assert.ok(c.mechChem && c.mechChem.p1 === CHEM_START && c.mechChem.p2 === CHEM_START, "init at the start value");
  const before = c.mechChem.p1;
  const order = TEAMS.flatMap(t => t.drivers.map(d => ({ abbrev: d.abbrev, team: t.name, retired: false })));
  applyResult(c, order);
  assert.ok(c.mechChem.p1 > before && c.mechChem.p2 > before, "chemistry grows after a race");
});

test("§Phase-6 stewards' fines: on-track penalties cost cash + board confidence", () => {
  const clean = newCareer({ teamIdx: 0, seed: 1 });
  const fined = newCareer({ teamIdx: 0, seed: 1 });
  const s0 = applyResult(clean, classify(clean), {});
  const s1 = applyResult(fined, classify(fined), { penalties: 2 });
  assert.equal(s1.fine, 2 * STEWARD_FINE, "fine = penalties × STEWARD_FINE");
  assert.equal(clean.money - fined.money, 2 * STEWARD_FINE, "the fined team is exactly the fine poorer");
  assert.ok(fined.board.confidence < clean.board.confidence, "the fine also dings board confidence");
  assert.equal(s0.fine, undefined, "no penalties → no fine");
});

test("§Phase-6 expected finish: bounded 1..N; a top team is expected ahead of a back team", () => {
  const top = newCareer({ teamIdx: 0, seed: 1 });
  const back = newCareer({ teamIdx: 10, seed: 1 });
  assert.ok(expectedFinish(top) < expectedFinish(back), "the best car is expected ahead of the worst");
  for (const c of [top, back]) { const e = expectedFinish(c); assert.ok(e >= 1 && e <= TEAMS.length, `bounded (${e})`); }
});

test("§Phase-6 ruleset: a career scores under its selected points system; persists across seasons", () => {
  const std = newCareer({ teamIdx: 0, seed: 1 });
  const cls = newCareer({ teamIdx: 0, seed: 1, scoring: "classic" });
  assert.equal(std.scoring, "standard"); assert.equal(cls.scoring, "classic");
  applyResult(std, classify(std)); applyResult(cls, classify(cls));
  assert.equal(std.driverPts[classify(std)[0].abbrev], 25, "standard P1 = 25");
  assert.equal(cls.driverPts[classify(cls)[0].abbrev], 10, "classic P1 = 10");
  // run to season end and start the next — the scoring preset carries over
  let g = 0; while (!isSeasonOver(cls) && g++ < 100) { applyResult(cls, classify(cls)); advanceRound(cls); }
  assert.equal(newSeason(cls).scoring, "classic", "the ruleset persists into the next season");
});

test("§Phase-6 season awards: Driver of the Season rewards points relative to machinery; champion = most points", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  const back = TEAMS[10].drivers[0].abbrev;   // a weak-car driver
  const top = TEAMS[0].drivers[0].abbrev;      // the best-car driver
  c.driverPts[back] = 200; c.driverPts[top] = 210;
  const aw = seasonAwards(c);
  assert.equal(aw.champion, top, "champion = most points");
  assert.equal(aw.dots, back, "Driver of the Season = the overperformer relative to machinery");
  assert.ok(aw.dotsName && aw.championName, "award names resolve");
});

test("§Phase-6 marketability: a top team with star drivers has more sponsor appeal than a struggling one", () => {
  const top = newCareer({ teamIdx: 0, seed: 1 });    // McLaren — star drivers, top tier
  const back = newCareer({ teamIdx: 10, seed: 1 });  // Cadillac — weaker
  assert.ok(teamAppeal(top) > teamAppeal(back), "stronger team + star drivers = more appeal");
  assert.ok(appealMult(top) > appealMult(back), "appeal scales sponsor income");
  for (const c of [top, back]) { const m = appealMult(c); assert.ok(m >= 0.7 - 1e-9 && m <= 1.3 + 1e-9, `mult ${m} bounded 0.7..1.3`); }
});

// a finishing order putting the player team's two drivers P1/P2, rest in TEAMS order.
function classify(career) {
  const me = TEAMS[career.teamIdx];
  const head = me.drivers.map(d => ({ abbrev: d.abbrev, team: me.name }));
  const rest = TEAMS.flatMap((t, i) => i === career.teamIdx ? [] : t.drivers.map(d => ({ abbrev: d.abbrev, team: t.name })));
  return [...head, ...rest];
}
// the opposite: the player's two drivers finish LAST (a result that crushes board confidence).
function loseClassify(career) {
  const me = TEAMS[career.teamIdx];
  const rest = TEAMS.flatMap((t, i) => i === career.teamIdx ? [] : t.drivers.map(d => ({ abbrev: d.abbrev, team: t.name })));
  const mine = me.drivers.map(d => ({ abbrev: d.abbrev, team: me.name }));
  return [...rest, ...mine];
}

test("§Phase-6: insolvency flags + a mid-season ultimatum that can sack you or grant a reprieve", () => {
  // insolvent + low confidence → an ultimatum is issued; failing it next race sacks you mid-season
  const c = newCareer({ teamIdx: 0, seed: 1 });
  c.money = -3000; c.board.confidence = 0.15;
  const s1 = applyResult(c, loseClassify(c));
  assert.ok(s1.insolvent, "a deep negative balance flags insolvency");
  assert.ok(c.board.ultimatum && c.board.ultimatum.round === 1, "an ultimatum is issued for next race");
  advanceRound(c);
  const s2 = applyResult(c, loseClassify(c));
  assert.ok(s2.sacked && c.done === true && c.sacked === true, "failing the ultimatum sacks you mid-season");
  assert.equal(boardOutcome(c).midSeason, true);

  // reprieve path: low confidence issues an ultimatum, a strong result meets it
  const c2 = newCareer({ teamIdx: 5, seed: 2 });
  c2.board.confidence = 0.10;
  applyResult(c2, loseClassify(c2)); advanceRound(c2);
  assert.ok(c2.board.ultimatum, "low confidence issues an ultimatum");
  const sr = applyResult(c2, classify(c2));
  assert.ok(sr.ultimatumMet && !c2.sacked && !c2.done, "meeting the demand earns a reprieve, not a sack");
  assert.equal(c2.board.ultimatum, null, "the ultimatum clears once resolved");
});

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

test("engine co-director (Моторист) spares the player PU — less wear per race, AI untouched", () => {
  const plain = newCareer({ teamIdx: 4, seed: 3, directors: [] });
  const engineer = newCareer({ teamIdx: 4, seed: 3, directors: [{ specialty: "engine" }] });
  applyResult(plain, classify(plain));
  applyResult(engineer, classify(engineer));
  assert.ok(plain.pu.wear > 0, "the PU wears over a race");
  assert.ok(engineer.pu.wear < plain.pu.wear, "the engine specialist wears it slower");
  assert.ok(Math.abs(engineer.pu.wear / plain.pu.wear - 0.85) < 1e-6, "exactly puWearMult(engine)=0.85 applied");
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
  assert.ok(sum.prize > 0 && sum.sponsorIncome > 0 && sum.runningCost === runningCostFor(CALENDAR[0]));   // §Phase-6: per-track running cost (round 0)
  assert.ok(sum.salaries >= 0);
  assert.equal(sum.net, sum.prize + sum.grant + sum.supply + sum.sponsorIncome + sum.payIncome - sum.runningCost - sum.salaries - sum.bonuses - sum.upkeep - sum.loanPay);
  assert.equal(c.money, before + sum.net + (sum.eventDelta || 0));   // a rare one-off money event is booked outside the race ledger
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
import { startProject, partsToDeltas } from "../src/development.js";

test("newCareer at v3 carries carDev + a null project + a season dev-spend counter", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  assert.equal(c.v, CAREER_V);
  assert.ok(c.v >= 3);
  assert.deepEqual(c.projects, []);
  assert.equal(c.devSpentThisSeason, 0);
  assert.ok(c.parts && typeof c.parts === "object");
});

test("advanceRound develops the car: a finished project lands + AI teams gain", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  startProject(c, "pu", "small");                     // small = 8 dev-days
  advanceRound(c); advanceRound(c);                   // opener (Бахрейн→Джидда) is a 7-day back-to-back → lands after the 2nd gap
  assert.ok(c.parts["McLaren"].pu > 0, "player part gain applied on advance");
  assert.ok(c.parts[TEAMS[8].name].pu > 0, "AI developed parts");
});

test("migrate upgrades a v2 save to v3 (adds carDev/project)", () => {
  const v2 = { v: 2, teamIdx: 1, seed: 3, season: 1, round: 0, money: 0, driverPts: {}, teamPts: {}, board: { targetPos: 2 }, sponsors: [], costCap: false, pendingOffers: [], lastResult: null, history: [], done: false };
  const up = migrate(v2);
  assert.equal(up.v, CAREER_V);
  assert.deepEqual(up.projects, []);
  assert.ok(up.parts && typeof up.parts === "object");   // D3: carDev -> parts at v8
});

test("migrate v8 -> v9 backfills persistent driver attrs + traits (D5)", () => {
  const v8 = { v: 8, teamIdx: 0, seed: 1, season: 1, round: 0, money: 0, driverPts: {}, teamPts: {}, board: { targetPos: 1, confidence: 0.5 }, sponsors: [], costCap: false, pendingOffers: [], parts: {}, news: [], academy: [], staff: {},
    drivers: { VER: { teamIdx: 1, age: 28, overall: 0.95, morale: 0.6, contractSeasons: 3, salary: 500 } } };
  const up = migrate(v8);
  assert.equal(up.v, CAREER_V);
  assert.equal(Object.keys(up.drivers.VER.attrs).length, 14);   // 13 skill attrs + fitness (§Phase-3)
  assert.ok(up.drivers.VER.traits.includes("overtaker"));
});

test("migrate v9 -> v10 backfills named staff people (D6)", () => {
  const v9 = { v: 9, teamIdx: 0, seed: 1, season: 1, round: 0, money: 0, driverPts: {}, teamPts: {}, board: { targetPos: 1, confidence: 0.5 }, sponsors: [], costCap: false, pendingOffers: [], parts: {}, news: [], academy: [], drivers: {},
    staff: { designer: 0.8, strategist: 0.7, pitCrew: 0.75, facilities: { design: 2, pit: 2, factory: 2 } } };
  const up = migrate(v9);
  assert.equal(up.v, CAREER_V);
  assert.ok(up.staff.people && up.staff.people.designer.rating === 0.8 && up.staff.people.designer.salary > 0);
});

test("D8: newCareer has board objectives; a podium increments the counter; migrate v11->v12 backfills objectives", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  assert.ok(c.board.objectives && c.board.objectives.length >= 2 && c.board.objectives[0].type === "championship");
  assert.equal(c.board.podiums, 0);
  applyResult(c, [{ abbrev: "NOR", team: TEAMS[0].name }, { abbrev: "VER", team: TEAMS[1].name }, { abbrev: "LEC", team: TEAMS[2].name }]);
  assert.ok(c.board.podiums >= 1, "a P1 finish counts as a podium");
  const v11 = { v: 11, teamIdx: 0, seed: 1, season: 1, round: 0, money: 0, driverPts: {}, teamPts: {}, sponsors: [], costCap: false, pendingOffers: [], parts: {}, news: [], academy: [], reserve: null, drivers: {},
    staff: { designer: 0.8, strategist: 0.7, pitCrew: 0.75, facilities: { design: 2, pit: 2, factory: 2 }, people: {} }, board: { targetPos: 1, confidence: 0.5 } };
  const up = migrate(v11);
  assert.equal(up.v, CAREER_V);
  assert.ok(up.board.objectives && up.board.objectives.length >= 2);
});

test("migrate v10 -> v11 backfills academy feeder state (slPoints) + reserve (D7)", () => {
  const v10 = { v: 10, teamIdx: 0, seed: 1, season: 1, round: 0, money: 0, driverPts: {}, teamPts: {}, board: { targetPos: 1, confidence: 0.5 }, sponsors: [], costCap: false, pendingOffers: [], parts: {}, news: [], drivers: {},
    staff: { designer: 0.8, strategist: 0.7, pitCrew: 0.75, facilities: { design: 2, pit: 2, factory: 2 }, people: {} },
    academy: [{ abbrev: "DOO", name: "Дуэн", age: 19, overall: 0.8, potential: 0.9 }] };
  const up = migrate(v10);
  assert.equal(up.v, CAREER_V);
  assert.deepEqual(up.academy[0].slHist, [0]);   // v26 folds the old single slPoints counter into a rolling slHist window
  assert.equal(up.academy[0].role, null);        // v26 replaces the single `reserve` slot with per-junior roles
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
  assert.equal(sum.net, sum.prize + sum.grant + sum.supply + sum.sponsorIncome + sum.payIncome - sum.runningCost - sum.salaries - sum.bonuses - sum.upkeep - sum.loanPay);
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
  assert.equal(sum.net, sum.prize + sum.grant + sum.supply + sum.sponsorIncome + sum.payIncome - sum.runningCost - sum.salaries - sum.bonuses - sum.upkeep - sum.loanPay);
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
  let moved = 0; for (const a in c.drivers) if (c2.drivers[a] && c.drivers[a].teamIdx !== c2.drivers[a].teamIdx) moved++;   // retired drivers leave the registry (rookies take new abbrevs)
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
  signJunior(c, "AKI");                                 // a tier-0 prospect (VIL is gated behind programme tier 2)
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
  assert.ok(c.news.length >= 1 && c.news.some(n => /Совет/.test(n)));   // the board always reacts (a later money-event may sit on top of the inbox)
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

test("§Phase-4 item 6: migrate seeds gearbox = developed pu so total power is conserved", () => {
  const old = { v: 29, teamIdx: 0, seed: 1, board: { targetPos: 1 }, driverPts: {}, teamPts: {},
    parts: { McLaren: { pu: 0.2, floor: 0.1 }, Ferrari: { pu: 0.15 } } };
  const up = migrate(old);
  assert.equal(up.v, CAREER_V);
  assert.equal(up.parts.McLaren.gearbox, 0.2, "gearbox seeded to the developed pu level");
  assert.equal(up.parts.Ferrari.gearbox, 0.15);
  // power is conserved: 0.45·pu + 0.25·gearbox(=pu) == old 0.70·pu
  assert.ok(Math.abs(partsToDeltas(up.parts.McLaren).power - 0.70 * 0.2) < 1e-9, "old single-part power preserved");
});

test("an ambitious season multiplies the end-of-season constructor prize", () => {
  const base = newCareer({ teamIdx: 0, seed: 1 });
  const amb = newCareer({ teamIdx: 0, seed: 1 }); amb.rewardMult = 1.3;
  let g = 0; while (!isSeasonOver(base) && g++ < 100) { advanceRound(base); }
  g = 0; while (!isSeasonOver(amb) && g++ < 100) { advanceRound(amb); }
  assert.ok(amb.seasonPayout.fund > base.seasonPayout.fund, "rewardMult scales the prize fund");
});
