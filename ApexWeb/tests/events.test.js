import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduleSC } from "../src/events.js";
import { RNG } from "../src/rng.js";

test("scheduleSC returns a mid-race lap roughly at the given probability", () => {
  let scCount = 0, sample = null;
  for (let s = 0; s < 400; s++) {
    const lap = scheduleSC(new RNG(s + 1), 0.25, 66);
    if (lap != null) { scCount++; sample = lap; }
  }
  const freq = scCount / 400;
  assert.ok(freq > 0.18 && freq < 0.32, `SC frequency ${freq} should be ~0.25`);
  assert.ok(sample > 0 && sample < 66, `SC lap ${sample} should be inside the race`);
});

test("scheduleSC is deterministic for a seed", () => {
  assert.equal(scheduleSC(new RNG(5), 0.25, 66), scheduleSC(new RNG(5), 0.25, 66));
});
