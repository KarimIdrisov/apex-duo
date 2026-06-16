import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestZonesFromClasses } from "../src/autozones.js";

const S = (n, fill = "straight") => Array(n).fill(fill);

test("oval (all straight): one slip zone, no brakes", () => {
  const z = suggestZonesFromClasses(S(18));
  assert.equal(z.length, 1);
  assert.equal(z[0].type, "slip");
  assert.equal(z[0].sectors.length, 3);
  assert.equal(z[0].ease, 0.45);
});

test("all medium corners (no fast sectors): no zones", () => {
  assert.deepEqual(suggestZonesFromClasses(S(18, "med")), []);
});

test("one hairpin after a long straight: a brake zone at it + a disjoint slip", () => {
  const c = S(18); c[5] = "low";
  const z = suggestZonesFromClasses(c);
  const brake = z.find((x) => x.type === "brake");
  const slip = z.find((x) => x.type === "slip");
  assert.ok(brake, "has a brake zone");
  assert.deepEqual(brake.sectors, [3, 4, 5]);
  assert.equal(brake.ease, 0.5);
  assert.ok(slip, "has a slip zone");
  assert.equal(slip.sectors.length, 3);
  assert.ok(slip.sectors.every((s) => c[s] === "straight"), "slip only on straights");
  assert.ok(slip.sectors.every((s) => !brake.sectors.includes(s)), "slip disjoint from brake");
});

test("caps + structural properties on a four-corner pattern", () => {
  const c = S(18);
  for (const i of [3, 7, 11, 15]) c[i] = "low";
  const z = suggestZonesFromClasses(c);
  const brakes = z.filter((x) => x.type === "brake");
  assert.ok(brakes.length <= 3, "at most maxBrakes brake zones");
  const all = z.flatMap((x) => x.sectors);
  assert.ok(all.every((s) => Number.isInteger(s) && s >= 0 && s < 18), "indices in range");
  const seen = new Set();
  for (const b of brakes) for (const s of b.sectors) { assert.ok(!seen.has(s), "brakes disjoint"); seen.add(s); }
  for (const b of brakes) assert.ok(b.sectors.some((s) => ["low", "med"].includes(c[s])), "brake covers a slow sector");
});

test("empty / too-short input: []", () => {
  assert.deepEqual(suggestZonesFromClasses([]), []);
  assert.deepEqual(suggestZonesFromClasses(["straight"]), []);
});
