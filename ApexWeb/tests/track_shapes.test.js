import { test } from "node:test";
import assert from "node:assert/strict";
import { TRACK_SHAPES, TRACK_NAMES, pickTrack } from "../src/track_shapes.js";

test("track_shapes: the registry holds valid normalized circuit outlines", () => {
  assert.ok(TRACK_NAMES.length >= 20, `expected the full calendar, got ${TRACK_NAMES.length}`);
  for (const name of TRACK_NAMES) {
    const p = TRACK_SHAPES[name];
    assert.ok(Array.isArray(p) && p.length >= 24 && p.length % 2 === 0, `${name}: flat even-length path`);
    for (const v of p) assert.ok(v >= 0 && v <= 1, `${name}: coords normalized 0..1`);
  }
});

test("pickTrack: deterministic from a seed, always returns a real circuit", () => {
  assert.equal(pickTrack(12345), pickTrack(12345), "same seed -> same circuit");
  for (const seed of [1, 2, 1000, 99999, 0]) assert.ok(TRACK_NAMES.includes(pickTrack(seed)), `seed ${seed} -> a known circuit`);
});
