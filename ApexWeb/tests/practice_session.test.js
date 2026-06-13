import { test } from "node:test";
import assert from "node:assert/strict";
import { newSession, sendRun, step, carView } from "../src/practice_session.js";
import { TEAMS } from "../src/data.js";
import { driverAttrs, composeCar } from "../src/team.js";

function mkCars() {
  const t = TEAMS[0];
  const mk = di => ({ drv:{ skill:t.drivers[di].skill, attrs:driverAttrs(t.drivers[di].abbrev, t.drivers[di].skill) }, car:composeCar(t.car) });
  return { p1: mk(0), p2: mk(1) };
}

test("a stint runs laps and banks knowledge (capped at 1)", () => {
  let s = newSession(1234, mkCars());
  s.paused = false;
  s = sendRun(s, "p1", "soft", 12);
  for (let i = 0; i < 400; i++) s = step(s, 1.0);   // plenty of game-seconds
  const v = carView(s, "p1");
  assert.ok(v.totalLaps >= 8, `ran laps (${v.totalLaps})`);
  assert.ok(v.knowledge.every(k => k > 0 && k <= 1), "knowledge banked, capped");
});

test("satisfaction is only confirmed after CONFIRM_LAPS on a value", () => {
  let s = newSession(1234, mkCars());
  s.paused = false;
  const ideal = s.cars.p1.ideal.slice();
  for (let i = 0; i < 6; i++) s.cars.p1.setup[i] = ideal[i];
  assert.ok(carView(s, "p1").satisfaction < 0.01, "unconfirmed until run");
  s = sendRun(s, "p1", "soft", 6);
  for (let i = 0; i < 200; i++) s = step(s, 1.0);
  assert.ok(carView(s, "p1").satisfaction > 0.9, "perfect setup confirms to ~100%");
});

test("determinism: same seed + same commands → identical laps & knowledge", () => {
  const run = () => { let s = newSession(77, mkCars()); s.paused = false; s = sendRun(s, "p1", "medium", 10);
    for (let i = 0; i < 300; i++) s = step(s, 1.0); return carView(s, "p1"); };
  const a = run(), b = run();
  assert.deepEqual(a.knowledge, b.knowledge);
  assert.equal(a.totalLaps, b.totalLaps);
});
