import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduleWeather, wetnessAt, weatherTerm } from "../src/weather.js";
import { RNG } from "../src/rng.js";

test("scheduleWeather rains at ~the given probability and is deterministic", () => {
  let rains = 0;
  for (let s = 0; s < 400; s++) if (scheduleWeather(new RNG(s + 1), 0.3, 66).rains) rains++;
  const f = rains / 400;
  assert.ok(f > 0.22 && f < 0.38, `rain frequency ${f} ~ 0.3`);
  const a = scheduleWeather(new RNG(5), 0.3, 66), b = scheduleWeather(new RNG(5), 0.3, 66);
  assert.deepEqual(a, b);
});

test("wetnessAt traces dry→wet→dry over the rain window", () => {
  const w = scheduleWeather(new RNG(2), 1.0, 66);
  assert.ok(w.rains);
  assert.equal(wetnessAt(w, 0), 0);
  const peakish = wetnessAt(w, w.onset + w.rise);
  assert.ok(peakish > 0.5, `peak ${peakish}`);
  assert.equal(wetnessAt(w, w.onset + w.rise + w.hold + w.dry + 1), 0);
  assert.equal(wetnessAt({ rains: false }, 30), 0);
});

test("weatherTerm: slicks fast in the dry, wets fast in the rain (crossover)", () => {
  assert.ok(weatherTerm("hard", 0) < weatherTerm("wet", 0));
  assert.ok(weatherTerm("wet", 0.85) < weatherTerm("hard", 0.85));
  assert.ok(weatherTerm("hard", 0.2) < weatherTerm("inter", 0.2));
  assert.ok(weatherTerm("inter", 0.6) < weatherTerm("hard", 0.6));
});
