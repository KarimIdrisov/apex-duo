import { test } from "node:test";
import assert from "node:assert/strict";
import { startFuel, burnFor, weightTerm, engineTerm, fuelLaps } from "../src/fuel.js";
import { TRACK } from "../src/data.js";

test("startFuel covers the race plus margin", () => {
  const f = startFuel(TRACK);
  assert.ok(f > TRACK.laps, "must exceed exact race need");
  assert.ok(f < TRACK.laps * 1.5, "but not wildly over");
});

test("push burns more than standard than save; car.fuel improves economy", () => {
  assert.ok(burnFor("push", 1) > burnFor("standard", 1));
  assert.ok(burnFor("standard", 1) > burnFor("save", 1));
  assert.ok(burnFor("standard", 1.2) < burnFor("standard", 1)); // efficient car burns less
  assert.equal(burnFor("standard", undefined), burnFor("standard", 1)); // defaults to 1
});

test("weight term: more fuel = slower, empty = 0", () => {
  assert.ok(weightTerm(60) > weightTerm(10));
  assert.equal(weightTerm(0), 0);
  assert.equal(weightTerm(-5), 0);
});

test("engine term: push faster (negative), save slower", () => {
  assert.ok(engineTerm("push") < 0);
  assert.ok(engineTerm("save") > 0);
  assert.equal(engineTerm("bogus"), 0);
});

test("fuelLaps = remaining laps of fuel at current burn", () => {
  assert.ok(Math.abs(fuelLaps(10, "standard", 1) - 10) < 1e-9);
  assert.ok(fuelLaps(10, "push", 1) < 10);   // pushing burns it faster
});
