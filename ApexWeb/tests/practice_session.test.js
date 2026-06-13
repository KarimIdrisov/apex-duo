import { test } from "node:test";
import assert from "node:assert/strict";
import { newSession, sendRun, step, carView, setSpeed, setPaused, autoSim, sessionSnapshot } from "../src/practice_session.js";
import { TEAMS, TRACK } from "../src/data.js";
import { driverAttrs, composeCar } from "../src/team.js";

function mkCars() {
  const t = TEAMS[0];
  const mk = di => ({ drv:{ skill:t.drivers[di].skill, attrs:driverAttrs(t.drivers[di].abbrev, t.drivers[di].skill) }, car:composeCar(t.car) });
  return { p1: mk(0), p2: mk(1) };
}

test("a stint runs laps and banks knowledge (capped at 1)", () => {
  let s = newSession(1234, mkCars());
  s.paused = false; s.speed = 8;   // accelerate so the stint completes within the loop
  s = sendRun(s, "p1", "soft", 12);
  for (let i = 0; i < 400; i++) s = step(s, 1.0);   // plenty of game-seconds
  const v = carView(s, "p1");
  assert.ok(v.totalLaps >= 8, `ran laps (${v.totalLaps})`);
  assert.ok(v.knowledge.every(k => k > 0 && k <= 1), "knowledge banked, capped");
});

test("satisfaction is only confirmed after CONFIRM_LAPS on a value", () => {
  let s = newSession(1234, mkCars());
  s.paused = false; s.speed = 8;
  const ideal = s.cars.p1.ideal.slice();
  for (let i = 0; i < 6; i++) s.cars.p1.setup[i] = ideal[i];
  assert.ok(carView(s, "p1").satisfaction < 0.01, "unconfirmed until run");
  s = sendRun(s, "p1", "soft", 6);
  for (let i = 0; i < 200; i++) s = step(s, 1.0);
  assert.ok(carView(s, "p1").satisfaction > 0.9, "perfect setup confirms to ~100%");
});

test("determinism: same seed + same commands → identical laps & knowledge", () => {
  const run = () => { let s = newSession(77, mkCars()); s.paused = false; s.speed = 8; s = sendRun(s, "p1", "medium", 10);
    for (let i = 0; i < 300; i++) s = step(s, 1.0); return carView(s, "p1"); };
  const a = run(), b = run();
  assert.deepEqual(a.knowledge, b.knowledge);
  assert.equal(a.totalLaps, b.totalLaps);
});

test("clock counts down only while running; speed scales it", () => {
  let s = newSession(1, mkCars()); s = setPaused(s, false); s = setSpeed(s, 4);
  s = step(s, 1.0);
  assert.ok(Math.abs((1800 - s.clock) - 4) < 1e-6, "4x → 4 game-seconds for 1 real-second");
  let p = newSession(1, mkCars());  // paused by default
  p = step(p, 5.0);
  assert.equal(p.clock, 1800, "paused → clock frozen");
});

test("autoSim banks less knowledge than the same number of laps run hands-on", () => {
  const LAPS = 5;   // well under the ~14-lap knowledge cap, so the 0.8x rate is visible
  const hands = () => { let s = newSession(9, mkCars()); s.paused = false; s.speed = 8; s = sendRun(s, "p1", "soft", LAPS);
    for (let i = 0; i < 200; i++) s = step(s, 1.0); return carView(s, "p1"); };
  const auto = () => { let s = newSession(9, mkCars()); s.clock = LAPS * TRACK.lt;   // cap auto to the same lap count
    s = autoSim(s, "p1"); return carView(s, "p1"); };
  const h = hands(), a = auto();
  assert.equal(h.totalLaps, LAPS, `hands ran the stint (${h.totalLaps})`);
  assert.equal(a.totalLaps, LAPS, `auto ran the same laps (${a.totalLaps})`);
  assert.ok(a.knowledge[0] < h.knowledge[0], `auto-sim underperforms (${a.knowledge[0]} < ${h.knowledge[0]})`);
});

test("sessionSnapshot exposes per-car windows + feedback + satisfaction", () => {
  let s = newSession(1, mkCars()); s = sendRun(s, "p1", "soft", 6); s.paused = false; s.speed = 8;
  for (let i = 0; i < 200; i++) s = step(s, 1.0);
  const snap = sessionSnapshot(s);
  assert.equal(snap.phase, "practice");
  assert.equal(snap.cars.p1.axes.length, 6);
  assert.ok(snap.cars.p1.axes[0].window && snap.cars.p1.axes[0].feedback, "axis carries window+feedback");
  assert.ok(typeof snap.cars.p1.satisfaction === "number");
});
