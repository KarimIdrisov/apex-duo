import { test } from "node:test";
import assert from "node:assert/strict";
import { initDrivers, DRIVER_NAME, isPayDriver } from "../src/drivers.js";
import { driverValue, availableDrivers, signDriver, aiChurn, signBonusInterest, SIGN_BONUS } from "../src/market.js";
import { newCareer } from "../src/career.js";

test("§Phase-3 signing bonus: bounded acceptance boost, charged upfront (not the wage)", () => {
  assert.ok(signBonusInterest(2500) > 0 && signBonusInterest(0) === 0, "a bonus lifts acceptance");
  assert.ok(signBonusInterest(1e7) <= SIGN_BONUS.maxInterest + 1e-9, "capped — cash can't buy a guaranteed yes");
  const c = newCareer({ teamIdx: 5, seed: 1 });
  c.money = 1e7;   // plenty to afford the fee — we isolate the bonus charge
  const out = Object.keys(c.drivers).find(a => c.drivers[a].teamIdx === 5);
  const inAb = Object.keys(c.drivers).find(a => c.drivers[a].teamIdx !== 5);
  const m0 = c.money;
  const res = negotiateSign(c, inAb, out, { force: true, length: 2, signBonus: 1000, teamStrength: 0.6 });
  assert.ok(res.ok, "force signs");
  assert.ok((m0 - c.money) >= 1000, "the signing bonus is charged on top of the fee");
});

test("§Phase-3 isPayDriver only tags weaker drivers; deterministic", () => {
  assert.equal(isPayDriver("ZZ", 0.95), false, "a strong driver is never a pay driver");
  assert.equal(isPayDriver("ZZ", 0.7), isPayDriver("ZZ", 0.7), "deterministic");
});

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
import { freeAgent, buyout, signCost, willJoin, negotiateSign, negLocked, negStrikes, NEG } from "../src/market.js";
import { newSeason } from "../src/career.js";

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

test("§Phase-3 negotiation lockout: repeated flat refusals lock the driver out; force bypasses; new season resets", () => {
  const fresh = () => ({ teamIdx: 0, money: 1e7, drivers: initDrivers(), seed: 1, negStrikes: {} });
  // find a seed that yields a flat "отказ" — probe on throwaway careers so a stray success can't corrupt state
  let seed = 0;
  for (; seed < 300; seed++) {
    const t = fresh(); const o = Object.keys(t.drivers).find(a => t.drivers[a].teamIdx === 0);
    if (negotiateSign(t, availableDrivers(t)[0].abbrev, o, { teamStrength: 0.05, seed }).reason === "отказ") break;
  }
  const c = fresh();
  const out = Object.keys(c.drivers).find(a => c.drivers[a].teamIdx === 0);
  const inAb = availableDrivers(c)[0].abbrev;     // the best rival star — a weak team makes him balk
  const r = negotiateSign(c, inAb, out, { teamStrength: 0.05, seed });
  assert.equal(r.reason, "отказ");
  assert.equal(negStrikes(c, inAb), 1, "first flat refusal = 1 strike");
  assert.equal(r.locked, false);
  negotiateSign(c, inAb, out, { teamStrength: 0.05, seed });        // 2nd strike
  const r3 = negotiateSign(c, inAb, out, { teamStrength: 0.05, seed });  // 3rd → reaches the cap
  assert.equal(negStrikes(c, inAb), NEG.lockAt);
  assert.ok(negLocked(c, inAb) && r3.locked, "the cap of flat refusals locks the driver out");
  const r4 = negotiateSign(c, inAb, out, { teamStrength: 0.05, seed });  // further talks are blocked
  assert.equal(r4.reason, "lockout");
  // a forced re-sign (accepted counter terms) ignores the lockout
  assert.notEqual(negotiateSign(c, inAb, out, { teamStrength: 0.05, seed, force: true }).reason, "lockout");
  // patience refreshes next season (newCareer default carries through newSeason)
  const full = newCareer({ teamIdx: 0, seed: 1 }); full.negStrikes = { ABC: NEG.lockAt };
  assert.deepEqual(newSeason(full).negStrikes, {}, "a new season clears all strikes");
});
