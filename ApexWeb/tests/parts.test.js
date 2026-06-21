import { test } from "node:test";
import assert from "node:assert/strict";
import { initParts, partWear, relFactor, partZone, failChance, worstPart, PART_KEYS } from "../src/parts.js";
import { PARTS, PART_WEAR } from "../src/data.js";

test("initParts gives every part a fresh (green) condition", () => {
  const p = initParts();
  assert.deepEqual(Object.keys(p).sort(), PART_KEYS.slice().sort());
  for (const k of PART_KEYS) { assert.equal(p[k], 1); assert.equal(partZone(p[k]), "green"); }
});

test("a reliable car wears its parts slower (relFactor falls with rel)", () => {
  assert.ok(relFactor(0.95) < relFactor(0.85), "more reliable = less wear");
  assert.ok(relFactor(0.85) <= relFactor(0.80) + 1e-9, "less reliable = at least as much wear");
  assert.ok(relFactor(0.99) > 0, "floored positive");
  // same stress, a sturdier car loses less condition
  assert.ok(partWear("engine", 1, 0.95) < partWear("engine", 1, 0.84), "reliable engine lasts longer");
});

test("partWear grows with stress and is part-specific", () => {
  assert.ok(partWear("engine", 1.5, 0.88) > partWear("engine", 1.0, 0.88), "more stress = more wear");
  assert.equal(partWear("engine", 0, 0.88), partWear("engine", 0.4, 0.88), "stress is floored at 0.4");
});

test("zones + failure chance: safe above red, rising toward 0", () => {
  assert.equal(partZone(1), "green");
  assert.equal(partZone((PART_WEAR.yellow + PART_WEAR.red) / 2), "yellow");
  assert.equal(partZone(PART_WEAR.red - 0.01), "red");
  assert.equal(failChance(PART_WEAR.yellow), 0, "no failure risk above the red zone");
  assert.ok(failChance(0.05) > failChance(PART_WEAR.red - 0.01), "deeper red = higher failure chance");
  assert.ok(Math.abs(failChance(0) - PART_WEAR.failK) < 1e-9, "at condition 0 the per-lap fail chance = failK");
});

test("worstPart picks the lowest-condition part", () => {
  const p = initParts(); p.gearbox = 0.1; p.engine = 0.5;
  assert.equal(worstPart(p), "gearbox");
});

test("each part is flagged critical (DNF) or not (limp)", () => {
  assert.equal(PARTS.engine.critical, true);
  assert.equal(PARTS.gearbox.critical, true);
  assert.equal(PARTS.brakes.critical, false);
});
