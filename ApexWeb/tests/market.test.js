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
