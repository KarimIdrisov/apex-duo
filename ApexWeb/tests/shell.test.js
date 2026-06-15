import { test } from "node:test";
import assert from "node:assert/strict";
import { weekendSteps } from "../src/ui/shell.js";

test("weekendSteps: lobby all upcoming; practice2 current+label; quali done/current; result paddock current", () => {
  const lobby = weekendSteps("lobby");
  assert.equal(lobby.length, 4);
  assert.ok(lobby.every(s => s.state === "upcoming"), "lobby → all upcoming");

  const p2 = weekendSteps("practice2");
  assert.equal(p2[0].label, "Практика P2");
  assert.equal(p2[0].state, "current");
  assert.equal(p2[1].state, "upcoming");

  const q = weekendSteps("quali");
  assert.equal(q[0].state, "done");
  assert.equal(q[1].state, "current");

  const r = weekendSteps("result");
  assert.deepEqual(r.map(s => s.state), ["done", "done", "done", "current"]);
  assert.deepEqual(r.map(s => s.key), ["practice", "quali", "race", "paddock"]);
});

import { shellSig } from "../src/ui/shell.js";

test("shellSig: stable for same context; changes with phase / round / money / mode", () => {
  const base = { weekend: { phase: "result" }, careerView: { season: 1, round: 2, money: 42e6, board: { confidence: 0.63 } } };
  assert.equal(shellSig(base), shellSig({ ...base }), "same context → same sig");
  assert.notEqual(shellSig(base), shellSig({ ...base, weekend: { phase: "race" } }), "phase changes it");
  assert.notEqual(shellSig(base), shellSig({ weekend: { phase: "result" }, careerView: { ...base.careerView, round: 3 } }), "round changes it");
  assert.notEqual(shellSig(base), shellSig({ weekend: { phase: "result" }, careerView: { ...base.careerView, money: 50e6 } }), "money changes it");
  assert.ok(shellSig({ weekend: { phase: "race" }, careerView: null }).includes("solo"), "no career → solo");
});
