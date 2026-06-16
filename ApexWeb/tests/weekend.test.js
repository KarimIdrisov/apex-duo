// ApexWeb/tests/weekend.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { Weekend } from "../src/weekend.js";

test("starts in lobby, advances only when both ready", () => {
  const w = new Weekend();
  assert.equal(w.phase, "lobby");
  w.start();
  assert.equal(w.phase, "practice1");
  w.setReady("p1");
  assert.equal(w.phase, "practice1", "one ready is not enough");
  w.setReady("p2");
  assert.equal(w.phase, "practice2", "both ready advances");
});

test("ready flags reset on each new phase", () => {
  const w = new Weekend(); w.start();
  w.setReady("p1"); w.setReady("p2");          // -> practice2
  assert.equal(w.ready.p1, false);
  assert.equal(w.ready.p2, false);
});

test("full phase order ends at result", () => {
  const w = new Weekend(); w.start();
  const seen = [w.phase];
  for (let i = 0; i < 5; i++) { w.setReady("p1"); w.setReady("p2"); seen.push(w.phase); }
  assert.deepEqual(seen, ["practice1","practice2","practice3","quali","race","result"]);
});

test("weekend runs three practice sessions before quali", () => {
  const w = new Weekend(); w.solo = true; const seen = [];
  w.onPhase = p => seen.push(p);
  w.start();                       // -> practice1
  w.setReady("p1");                // -> practice2
  w.setReady("p1");                // -> practice3
  w.setReady("p1");                // -> quali
  assert.deepEqual(seen, ["practice1", "practice2", "practice3", "quali"]);
});
