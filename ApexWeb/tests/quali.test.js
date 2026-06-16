// ApexWeb/tests/quali.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { qualiLap, qualiLapClean, qualiSector, buildGrid } from "../src/quali.js";
import { TEAMS, TRACK, QUALI2 } from "../src/data.js";
import { RNG } from "../src/rng.js";
import { driverAttrs } from "../src/team.js";

const drv = TEAMS[0].drivers[0], car = TEAMS[0].car;
// setupBonus: a midfield setup (~neutral closeness) ≈ 0; a perfect setup ≈ -0.15
const NEUTRAL_BONUS = 0;

test("a strong qualifier out-qualifies a same-overall racer", () => {
  const quali = { abbrev: "LEC", skill: 0.85, attrs: driverAttrs("LEC", 0.85) };  // LEC: +0.12 quali signature
  const racer = { abbrev: "PER", skill: 0.85, attrs: driverAttrs("PER", 0.85) };  // PER: no quali bump
  let qWins = 0;
  for (let s = 0; s < 100; s++) {
    if (qualiLap(quali, car, TRACK, NEUTRAL_BONUS, 0.3, new RNG(s)) <
        qualiLap(racer, car, TRACK, NEUTRAL_BONUS, 0.3, new RNG(s))) qWins++;
  }
  assert.ok(qWins > 60, `the qualifier should usually be faster (${qWins}/100)`);
});

test("higher risk lowers the mean lap time but raises variance", () => {
  const safe = [], risky = [];
  for (let s = 0; s < 200; s++) {
    safe.push(qualiLap(drv, car, TRACK, NEUTRAL_BONUS, 0.1, new RNG(s)));
    risky.push(qualiLap(drv, car, TRACK, NEUTRAL_BONUS, 0.9, new RNG(s)));
  }
  const mean = a => a.reduce((x,y)=>x+y,0)/a.length;
  const variance = a => { const m=mean(a); return mean(a.map(v=>(v-m)**2)); };
  assert.ok(mean(risky) < mean(safe), "risky should be faster on average");
  assert.ok(variance(risky) > variance(safe), "risky should be more variable");
});

test("a composed driver loses less time to lock-ups under pressure (§18.7)", () => {
  const base = driverAttrs("NOR", 0.8);
  const calm    = { abbrev: "X", skill: 0.8, attrs: { ...base, composure: 0.95 } };
  const rattled = { abbrev: "Y", skill: 0.8, attrs: { ...base, composure: 0.05 } };
  const cm = (car.power + car.aero) / 2;   // single-car mean → car-pace term zero, times realistic
  let calmSum = 0, rattSum = 0;
  for (let s = 0; s < 300; s++) {          // high risk → mistakes matter; same seed → same noise, only the lock-up roll differs
    calmSum += qualiLap(calm, car, TRACK, NEUTRAL_BONUS, 0.9, new RNG(s), cm);
    rattSum += qualiLap(rattled, car, TRACK, NEUTRAL_BONUS, 0.9, new RNG(s), cm);
  }
  assert.ok(rattSum > calmSum, `rattled driver loses more time to lock-ups (${rattSum.toFixed(1)} vs ${calmSum.toFixed(1)})`);
});

test("buildGrid returns all cars sorted fastest-first", () => {
  let idx = 0;
  const field = TEAMS.flatMap(t => t.drivers.map(d => ({
    idx: idx++, abbrev:d.abbrev, skill:d.skill, car:t.car, setupBonus:0, risk:0.5,
  })));
  const grid = buildGrid(field, TRACK, 123);
  assert.equal(grid.length, 22);
  for (let i = 1; i < grid.length; i++) assert.ok(grid[i].time >= grid[i-1].time);
});

test("a better-satisfied setup qualifies ahead of a worse one (via setupBonus)", () => {
  const base = { idx:0, abbrev:"AAA", car:{power:0.85,aero:0.85}, risk:0.5, skill:0.85 };
  const field = [ { ...base, idx:0, abbrev:"GOOD", setupBonus:-0.15 }, { ...base, idx:1, abbrev:"BAD", setupBonus:0 } ];
  const grid = buildGrid(field, TRACK, 1234);
  assert.equal(grid[0].abbrev, "GOOD", "better setupBonus qualifies ahead");
});

test("qualiLap modifiers: more grip faster, used slower than fresh, traffic + yellow add time", () => {
  const drv = { skill: 0.9, attrs: { quali: 0.9, composure: 0.8 } };
  const car = { power: 0.85, aero: 0.85 };
  const base = (opts) => qualiLap(drv, car, TRACK, 0, 0.5, new RNG(1), 0.85, opts);
  const green = base({ grip: 0 }), rubbered = base({ grip: 1 });
  assert.ok(rubbered < green, `grip helps (${rubbered} < ${green})`);
  assert.ok(base({ grip: 0.5, tyre: "used" }) > base({ grip: 0.5, tyre: "fresh" }), "used slower than fresh");
  assert.ok(base({ grip: 0.5, traffic: 0.4 }) > base({ grip: 0.5, traffic: 0 }), "traffic adds time");
  assert.ok(base({ grip: 0.5, yellow: true }) > base({ grip: 0.5, yellow: false }), "yellow adds time");
});

test("qualiLapClean is the deterministic base (no risk/noise)", () => {
  const drv = { skill: 0.8 }, car = { power: 0.8, aero: 0.8 };
  const a = qualiLapClean(drv, car, TRACK, 0, 0, { grip: 0 });
  const b = qualiLapClean(drv, car, TRACK, 0, 0, { grip: 0 });
  assert.equal(a, b, "pure function, same inputs → same output");
  assert.ok(a > 50 && a < 120, `sane lap base (${a})`);
});

test("qualiSector: higher push = faster mean; off deletes, lock-up adds time", () => {
  const base = 90;
  const mean = (push, tk) => { let sum = 0, n = 200;
    for (let i = 0; i < n; i++) sum += qualiSector(base, 1/3, push, tk, new RNG(100 + i)).time; return sum / n; };
  assert.ok(mean(3, 1) < mean(0, 1), "max push faster than save (clean driver)");
  const offRate = (tk) => { let off = 0, n = 600;
    for (let i = 0; i < n; i++) if (qualiSector(base, 1/3, 3, tk, new RNG(7000 + i)).event === "off") off++; return off / n; };
  assert.ok(offRate(0) > offRate(1) * 2, `low track knowledge offs far more (${offRate(0)} vs ${offRate(1)})`);
  let safeOff = 0; for (let i = 0; i < 600; i++) if (qualiSector(base, 1/3, 0, 0, new RNG(i)).event === "off") safeOff++;
  assert.ok(safeOff === 0, "save push never offs");
});

test("qualiSector: composed drivers make fewer mistakes (off + lock-up)", () => {
  const off = (composure) => { let n = 0; for (let i = 0; i < 1000; i++) {
    const e = qualiSector(90, 1/3, 3, 0, new RNG(5000 + i), composure).event; if (e === "off" || e === "lockup") n++; } return n; };
  assert.ok(off(1.0) < off(0.0), `composed driver errs less (${off(1.0)} vs ${off(0.0)})`);
  // default (no composure arg) == composure 0.5 → composed factor 1 → unchanged from before
  let a = 0, b = 0; for (let i = 0; i < 400; i++) {
    if (qualiSector(90, 1/3, 2, 0.3, new RNG(i)).event) a++;
    if (qualiSector(90, 1/3, 2, 0.3, new RNG(i), 0.5).event) b++; }
  assert.equal(a, b, "omitting composure equals composure 0.5");
});
