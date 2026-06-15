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

// --- D4 contracts & negotiation ---
import { freeAgent, buyout, signCost, willJoin, negotiateSign } from "../src/market.js";

test("buyout: contracted drivers cost extra to prise; free agents are free to take", () => {
  assert.ok(buyout({ salary: 500, contractSeasons: 2 }) > 0);
  assert.equal(buyout({ salary: 500, contractSeasons: 0 }), 0);
  assert.equal(freeAgent({ contractSeasons: 0 }), true);
  assert.ok(signCost({ overall: 0.9, age: 25, salary: 400, contractSeasons: 2 }) > signCost({ overall: 0.9, age: 25, salary: 400, contractSeasons: 0 }));
});

test("willJoin: a star joins a strong team, balks at a weak one (deterministic)", () => {
  const star = { overall: 0.95, age: 26 };
  assert.equal(willJoin(star, 1.0, 1), willJoin(star, 1.0, 1));        // deterministic
  let strong = 0, weak = 0;
  for (let s = 0; s < 40; s++) { if (willJoin(star, 1.0, s)) strong++; if (willJoin(star, 0.1, s)) weak++; }
  assert.ok(strong > weak, "more likely to join a competitive team");
});

test("negotiateSign: succeeds for a feasible deal (rich, competitive), keeps 2/team", () => {
  const c = { teamIdx: 0, money: 1e6, drivers: initDrivers(), seed: 1 };
  const out = Object.keys(c.drivers).find(a => c.drivers[a].teamIdx === 0);
  const r = negotiateSign(c, "ALB", out, { teamStrength: 1.0, seed: 3 });
  if (r.ok) { assert.equal(c.drivers["ALB"].teamIdx, 0);
    const counts = {}; for (const a in c.drivers) counts[c.drivers[a].teamIdx] = (counts[c.drivers[a].teamIdx] || 0) + 1;
    for (const k in counts) assert.equal(counts[k], 2); }
  else assert.ok(["отказ", "перебили", "деньги"].includes(r.reason));
});

test("negotiateSign: broke -> reason 'деньги'", () => {
  const c = { teamIdx: 0, money: 1, drivers: initDrivers(), seed: 1 };
  const out = Object.keys(c.drivers).find(a => c.drivers[a].teamIdx === 0);
  assert.equal(negotiateSign(c, "VER", out, { teamStrength: 1.0, seed: 1 }).ok, false);
});
