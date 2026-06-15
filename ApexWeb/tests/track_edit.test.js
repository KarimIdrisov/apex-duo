import { test } from "node:test";
import assert from "node:assert/strict";
import { rotateToStart, reverseDirection } from "../src/track_edit.js";

const P = [[0, 0], [1, 0], [1, 1], [0, 1]];

test("rotateToStart: makes pts[idx] the first point", () => {
  assert.deepEqual(rotateToStart(P, 2), [[1, 1], [0, 1], [0, 0], [1, 0]]);
});

test("rotateToStart: idx 0 -> unchanged copy (new ref)", () => {
  const r = rotateToStart(P, 0);
  assert.deepEqual(r, P);
  assert.notEqual(r, P);
});

test("rotateToStart: wraps the index + preserves all points", () => {
  assert.equal(rotateToStart(P, 5).length, 4);          // 5 % 4 = 1
  assert.deepEqual(rotateToStart(P, 5), rotateToStart(P, 1));
});

test("reverseDirection: keeps the start, reverses the rest", () => {
  assert.deepEqual(reverseDirection(P), [[0, 0], [0, 1], [1, 1], [1, 0]]);
});

test("reverseDirection: double reverse is identity", () => {
  assert.deepEqual(reverseDirection(reverseDirection(P)), P);
});

test("edge: tiny / empty inputs do not throw", () => {
  assert.deepEqual(rotateToStart([], 2), []);
  assert.deepEqual(reverseDirection([[0, 0]]), [[0, 0]]);
});
