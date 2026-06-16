import { test } from "node:test";
import assert from "node:assert/strict";
import { newSession, sendRun, step, carView, setSpeed, setPaused, autoSim, setAxis, prepCostFor, sessionSnapshot } from "../src/practice_session.js";
import { TEAMS, TRACK, PRAC2 } from "../src/data.js";
import { windowFor } from "../src/setup.js";
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
  assert.ok(v.trackKnow > 0 && v.trackKnow <= 1, "track knowledge banked, capped");
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
  assert.equal(a.trackKnow, b.trackKnow);
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
  const auto = () => { let s = newSession(9, mkCars()); s.clock = LAPS * TRACK.lt + PRAC2.TYRE_CHANGE_SEC;   // cap auto to the same lap count (+ its one pit-out)
    s = autoSim(s, "p1"); return carView(s, "p1"); };
  const h = hands(), a = auto();
  assert.equal(h.totalLaps, LAPS, `hands ran the stint (${h.totalLaps})`);
  assert.equal(a.totalLaps, LAPS, `auto ran the same laps (${a.totalLaps})`);
  assert.ok(a.trackKnow < h.trackKnow, `auto-sim underperforms (${a.trackKnow} < ${h.trackKnow})`);
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

test("dynamic pit-prep: tyre change + fuel-by-laps + setup change", () => {
  let s = newSession(7, mkCars());
  const c0 = s.clock;
  // first run: lastCompound null → counts as a change; soft, 5 laps, no setup move
  s = sendRun(s, "p1", "soft", 5);
  const expect1 = PRAC2.TYRE_CHANGE_SEC + PRAC2.FUEL_PER_LAP * 5;
  assert.ok(Math.abs((c0 - s.clock) - expect1) < 1e-6, `change+fuel (${c0 - s.clock} vs ${expect1})`);
  // same compound next run, longer stint, one axis moved 0.5
  s.cars.p1.onTrack = false;
  s = setAxis(s, "p1", 0, 1.0);
  const c1 = s.clock;
  s = sendRun(s, "p1", "soft", 10);
  const expect2 = PRAC2.TYRE_REFIT_SEC + PRAC2.FUEL_PER_LAP * 10 + PRAC2.SETUP_APPLY_SEC * 0.5;
  assert.ok(Math.abs((c1 - s.clock) - expect2) < 1e-6, `refit+fuel+setup (${c1 - s.clock} vs ${expect2})`);
  // prepCostFor preview matches what a launch would charge for a chosen compound/laps
  s.cars.p1.onTrack = false;
  assert.ok(Math.abs(prepCostFor(s.cars.p1, "medium", 8) - (PRAC2.TYRE_CHANGE_SEC + PRAC2.FUEL_PER_LAP * 8)) < 1e-6,
    "preview: new compound + fuel, no setup change");
});

test("track knowledge banks per lap and gates the ideal window", () => {
  let s = newSession(4, mkCars()); s.paused = false; s.speed = 8;
  assert.equal(carView(s, "p1").trackKnow, 0, "starts at 0");
  s = sendRun(s, "p1", "soft", 12);
  for (let i = 0; i < 400; i++) s = step(s, 1.0);
  const tk = carView(s, "p1").trackKnow;
  assert.ok(tk > 0 && tk <= 1, `banked track knowledge (${tk})`);
  const wEarly = windowFor(0.4, 0.5, 123, 0).half;
  const wLate  = windowFor(1.0, 0.5, 123, 0).half;
  assert.ok(wEarly > wLate * 3, `window narrows with track knowledge (${wEarly} vs ${wLate})`);
});

test("team facility (engineering) speeds setup learning; neutral at ENG_REF", () => {
  // same driver + car, two engineering levels → the stronger facility banks more knowledge over identical laps
  const t = TEAMS[0];
  const drv = { skill: t.drivers[0].skill, attrs: driverAttrs(t.drivers[0].abbrev, t.drivers[0].skill) };
  const car = composeCar(t.car);
  const bank = personnel => {
    let s = newSession(5, { p1: { drv, car, personnel }, p2: { drv, car, personnel } });
    s.paused = false; s.speed = 8; s = sendRun(s, "p1", "soft", 6);
    for (let i = 0; i < 200; i++) s = step(s, 1.0);
    return carView(s, "p1").trackKnow;
  };
  const top = bank({ strategy: 0.95 }), back = bank({ strategy: 0.68 });
  assert.ok(top > back, `better facility banks faster (${top} vs ${back})`);
  // a car at the reference facility (or with no personnel at all) is the neutral baseline → identical learning
  const ref = bank({ strategy: PRAC2.ENG_REF });
  const none = bank(undefined);
  assert.equal(ref, none, "ENG_REF facility == no personnel (neutral, calibration preserved)");
});

test("snapshot exposes scalar trackKnow and axes no longer carry per-axis knowledge", () => {
  let s = newSession(4, mkCars()); s = sendRun(s, "p1", "soft", 6); s.paused = false; s.speed = 8;
  for (let i = 0; i < 200; i++) s = step(s, 1.0);
  const snap = sessionSnapshot(s);
  assert.ok(typeof snap.cars.p1.trackKnow === "number", "per-car trackKnow present");
  assert.equal(snap.cars.p1.axes[0].knowledge, undefined, "per-axis knowledge removed");
  assert.ok(snap.cars.p1.axes[0].window && snap.cars.p1.axes[0].feedback, "window+feedback still there");
});
