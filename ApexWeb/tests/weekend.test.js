// ApexWeb/tests/weekend.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { Weekend } from "../src/weekend.js";

test("starts in lobby, advances only when both ready", () => {
  const w = new Weekend();
  assert.equal(w.phase, "lobby");
  w.start();
  assert.equal(w.phase, "practice");
  w.setReady("p1");
  assert.equal(w.phase, "practice", "one ready is not enough");
  w.setReady("p2");
  assert.equal(w.phase, "setup", "both ready advances");
});

test("ready flags reset on each new phase", () => {
  const w = new Weekend(); w.start();
  w.setReady("p1"); w.setReady("p2");          // -> setup
  assert.equal(w.ready.p1, false);
  assert.equal(w.ready.p2, false);
});

test("full phase order ends at result", () => {
  const w = new Weekend(); w.start();
  const seen = [w.phase];
  for (let i = 0; i < 4; i++) { w.setReady("p1"); w.setReady("p2"); seen.push(w.phase); }
  assert.deepEqual(seen, ["practice","setup","quali","race","result"]);
});
