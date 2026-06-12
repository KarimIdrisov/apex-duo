import { test } from "node:test";
import assert from "node:assert/strict";
import { slipstream, dirtyWear, passAccrual } from "../src/overtake.js";

test("slipstream is stronger on straights and for powerful cars", () => {
  assert.ok(slipstream(1, 0.95) > slipstream(0, 0.95));
  assert.ok(slipstream(1, 0.95) > slipstream(1, 0.78));
  assert.equal(slipstream(0, 0.95), 0);
});

test("dirty air wears more in corners than on straights", () => {
  assert.ok(dirtyWear(0) > dirtyWear(1));
  assert.equal(dirtyWear(1), 0);
});

test("pass-credit accrues faster on straights, with tow, and on push", () => {
  const edge = 0.3;
  assert.ok(passAccrual(edge, 0, "standard", 1) > passAccrual(edge, 0, "standard", 0));
  assert.ok(passAccrual(edge, 0.2, "standard", 1) > passAccrual(edge, 0, "standard", 1));
  assert.ok(passAccrual(edge, 0, "push", 1) > passAccrual(edge, 0, "standard", 1));
  assert.equal(passAccrual(-1, 0, "standard", 1), passAccrual(0, 0, "standard", 1));
});
