import { test } from "node:test";
import assert from "node:assert/strict";
import { MINI, N_MINI, N_SECTOR, sampleAt, miniSplits } from "../src/track.js";

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
  const a = sampleAt(0), b = sampleAt(0.5), c = sampleAt(0.999);
  for (const x of [a, b, c]) { assert.ok(x.mini >= 0 && x.mini < 18); assert.ok(x.sector >= 0 && x.sector < 3); }
  assert.ok(b.mini > a.mini);
});

test("miniSplits sum exactly to the lap time; a power car is faster in the straightest mini", () => {
  const lap = 80;
  const powerCar = { power: 0.95, aero: 0.78 };
  const aeroCar  = { power: 0.78, aero: 0.95 };
  const sp = miniSplits(lap, powerCar);
  assert.ok(Math.abs(sp.reduce((a, b) => a + b, 0) - lap) < 1e-6, "splits must sum to the lap time");
  let si = 0; for (let i = 1; i < MINI.length; i++) if (MINI[i].straightness > MINI[si].straightness) si = i;
  const spA = miniSplits(lap, aeroCar);
  assert.ok(sp[si] < spA[si], "power car faster in the straightest mini");
});
