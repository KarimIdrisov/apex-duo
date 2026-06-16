import { test } from "node:test";
import assert from "node:assert/strict";
import { RNG, mix32 } from "../src/rng.js";

test("same seed yields same sequence", () => {
  const a = new RNG(123), b = new RNG(123);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});

test("unit() is in [0,1)", () => {
  const r = new RNG(7);
  for (let i = 0; i < 1000; i++) {
    const u = r.unit();
    assert.ok(u >= 0 && u < 1, `u=${u}`);
  }
});

test("different seeds diverge", () => {
  const a = new RNG(1), b = new RNG(2);
  assert.notEqual(a.next(), b.next());
});

test("mix32 spreads consecutive seeds", () => {
  const u1 = new RNG(mix32(1000)).unit();
  const u2 = new RNG(mix32(1001)).unit();
  assert.ok(Math.abs(u1 - u2) > 0.05, `u1=${u1} u2=${u2}`);
});
