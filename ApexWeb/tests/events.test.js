import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduleSC } from "../src/events.js";
import { RNG } from "../src/rng.js";

test("scheduleSC returns a mid-race lap roughly at the given probability", () => {
  let scCount = 0, sample = null, vscCount = 0;
  for (let s = 0; s < 400; s++) {
    const c = scheduleSC(new RNG(s + 1), 0.25, 66, 0.6);
    if (c != null) { scCount++; sample = c.lap; if (c.vsc) vscCount++; }
  }
  const freq = scCount / 400;
  assert.ok(freq > 0.18 && freq < 0.32, `caution frequency ${freq} should be ~0.25`);
  assert.ok(sample > 0 && sample < 66, `caution lap ${sample} should be inside the race`);
  assert.ok(vscCount > 0 && vscCount < scCount, `some but not all cautions are VSC (${vscCount}/${scCount})`);
});

test("scheduleSC is deterministic for a seed", () => {
  assert.deepEqual(scheduleSC(new RNG(5), 0.25, 66, 0.6), scheduleSC(new RNG(5), 0.25, 66, 0.6));
});
