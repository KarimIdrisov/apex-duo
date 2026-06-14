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
