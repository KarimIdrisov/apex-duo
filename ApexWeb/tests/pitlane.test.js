import { test } from "node:test";
import assert from "node:assert/strict";
import { pitLaneSample, advancePitPhase } from "../src/pitlane.js";

const LANE = { entry: 0.95, exit: 0.06, side: 1 };

test("pitLaneSample: endpoints (entry / box / exit)", () => {
  assert.deepEqual(pitLaneSample(0, LANE), { frac: 0.95, latUnit: 0 });
  const box = pitLaneSample(0.5, LANE);
  assert.ok(Math.abs(box.frac - 0) < 1e-9 && Math.abs(box.latUnit - 1) < 1e-9);
  const ex = pitLaneSample(1, LANE);
  assert.ok(Math.abs(ex.frac - 0.06) < 1e-9 && Math.abs(ex.latUnit) < 1e-9);
});

test("pitLaneSample: in-lap frac goes forward across S/F", () => {
  for (const p of [0.1, 0.4]) { const f = pitLaneSample(p, LANE).frac; assert.ok(f >= 0.95 || f < 1e-6, `f=${f}`); }
});

test("pitLaneSample: side flips lateral sign; clamps; missing lane defaults", () => {
  assert.ok(pitLaneSample(0.5, { entry: 0.95, exit: 0.06, side: -1 }).latUnit < 0);
  assert.equal(pitLaneSample(-1, LANE).frac, 0.95);
  assert.ok(pitLaneSample(0.5, undefined).latUnit !== undefined);
});

test("advancePitPhase: in-lap ramps to 0.5 then holds while inPit", () => {
  let s = advancePitPhase({ phase: 0, active: false }, true, 0.6);
  assert.ok(Math.abs(s.phase - 0.25) < 1e-9 && s.active);
  s = advancePitPhase(s, true, 10);
  assert.ok(Math.abs(s.phase - 0.5) < 1e-9 && s.active);
});

test("advancePitPhase: out-lap ramps to 1 then releases", () => {
  let s = advancePitPhase({ phase: 0.5, active: true }, false, 0.6);
  assert.ok(Math.abs(s.phase - 0.75) < 1e-9 && s.active);
  s = advancePitPhase(s, false, 10);
  assert.ok(s.phase === 1 && !s.active);
});

test("advancePitPhase: fresh inPit after release resets phase to 0", () => {
  const s = advancePitPhase({ phase: 1, active: false }, true, 0);
  assert.ok(s.phase === 0 && s.active);
});
