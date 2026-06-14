import { test } from "node:test";
import assert from "node:assert/strict";
import { MINI, N_MINI, N_SECTOR, sampleAt, miniSplits, buildMini } from "../src/track.js";
import { TRACK_PATH } from "../src/data.js";

test("18 mini-sectors in 3 sectors, straightness in [0,1], lenFracs sum to 1", () => {
  assert.equal(N_MINI, 18);
  assert.equal(N_SECTOR, 3);
  assert.equal(MINI.length, 18);
  let sum = 0;
  for (const m of MINI) {
    assert.ok(m.straightness >= 0 && m.straightness <= 1, `straightness ${m.straightness}`);
    assert.ok(m.sector >= 0 && m.sector < 3);
    sum += m.lenFrac;
  }
  assert.ok(Math.abs(sum - 1) < 1e-9, `lenFracs sum ${sum}`);
  const sArr = MINI.map(m => m.straightness);
  assert.ok(Math.max(...sArr) - Math.min(...sArr) > 0.2, "needs straight/corner contrast");
});

test("sampleAt maps lapFrac to a mini within range", () => {
  const track = { mini: MINI };
  const a = sampleAt(track, 0), b = sampleAt(track, 0.5), c = sampleAt(track, 0.999);
  for (const x of [a, b, c]) { assert.ok(x.mini >= 0 && x.mini < 18); assert.ok(x.sector >= 0 && x.sector < 3); }
  assert.ok(b.mini > a.mini);
});

test("miniSplits sum exactly to the lap time; a power car is faster in the straightest mini", () => {
  const lap = 80;
  const track = { mini: MINI };
  const powerCar = { power: 0.95, aero: 0.78 };
  const aeroCar  = { power: 0.78, aero: 0.95 };
  const sp = miniSplits(track, lap, powerCar);
  assert.ok(Math.abs(sp.reduce((a, b) => a + b, 0) - lap) < 1e-6, "splits must sum to the lap time");
  let si = 0; for (let i = 1; i < MINI.length; i++) if (MINI[i].straightness > MINI[si].straightness) si = i;
  const spA = miniSplits(track, lap, aeroCar);
  assert.ok(sp[si] < spA[si], "power car faster in the straightest mini");
});

// buildMini(TRACK_PATH) must reproduce the pre-refactor Barcelona MINI exactly (race unchanged).
const BARCELONA_MINI_STRAIGHTNESS = [0.945627, 0.996998, 0.998472, 0.993176, 0.289701, 0.432803, 0.794887, 0.398023, 0.737879, 0.212744, 0.460927, 0.825647, 0.571955, 0.994913, 0.195195, 0, 0.624737, 0.582625];
test("buildMini(TRACK_PATH) == reference Barcelona MINI (behaviour-preserving)", () => {
  const mini = buildMini(TRACK_PATH);
  assert.equal(mini.length, 18);
  for (let i = 0; i < 18; i++) {
    assert.ok(Math.abs(mini[i].straightness - BARCELONA_MINI_STRAIGHTNESS[i]) < 1e-5, `sector ${i}: ${mini[i].straightness} vs ${BARCELONA_MINI_STRAIGHTNESS[i]}`);
    assert.ok(Math.abs(mini[i].lenFrac - 1 / 18) < 1e-9);
    assert.equal(mini[i].sector, Math.floor(i / 6));
  }
});
test("sampleAt(track, frac) + miniSplits(track, …) read track.mini", () => {
  const mini = buildMini(TRACK_PATH), track = { mini, lt: 80 };
  const s = sampleAt(track, 0.0);
  assert.ok(s.mini === 0 && s.sector === 0 && typeof s.straightness === "number");
  assert.equal(sampleAt(track, 0.999).mini, 17);
  const sp = miniSplits(track, 80, { power: 0.6, aero: 0.6 });
  assert.equal(sp.length, 18);
  assert.ok(Math.abs(sp.reduce((a, b) => a + b, 0) - 80) < 1, "splits sum ≈ lap time");
});
