import { test } from "node:test";
import assert from "node:assert/strict";
// minimal localStorage shim (node has no DOM). track_store reads localStorage lazily (inside
// functions), so setting this before the tests run is sufficient even though imports hoist.
globalThis.localStorage = (() => { let m = {}; return {
  getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); },
  removeItem: (k) => { delete m[k]; }, clear: () => { m = {}; },
}; })();
import { loadAll, saveTrack, clearTrack, effectiveTrack } from "../src/track_store.js";

test("track_store: save -> load round-trip", () => {
  localStorage.clear();
  saveTrack("Монца", { points: [0, 0, 1, 0, 1, 1, 0, 1], objects: [{ type: "tree", x: 0.5, y: 0.5, rot: 0 }] });
  const all = loadAll();
  assert.deepEqual(all["Монца"].points, [0, 0, 1, 0, 1, 1, 0, 1]);
  assert.equal(all["Монца"].objects[0].type, "tree");
});

test("effectiveTrack: preset fallback when nothing saved, edited points when saved", () => {
  localStorage.clear();
  const preset = [0, 0, 1, 0, 1, 1, 0, 1];
  let t = effectiveTrack("Спа", preset);
  assert.deepEqual(t.points, preset); assert.deepEqual(t.objects, []);
  saveTrack("Спа", { points: [0.1, 0.1, 0.9, 0.1, 0.9, 0.9, 0.1, 0.9], objects: [] });
  t = effectiveTrack("Спа", preset);
  assert.deepEqual(t.points, [0.1, 0.1, 0.9, 0.1, 0.9, 0.9, 0.1, 0.9]);
});

test("loadAll: corrupt JSON -> {} without throwing", () => {
  localStorage.setItem("apexweb_tracks", "{not json");
  assert.deepEqual(loadAll(), {});
});

test("clearTrack: removes one entry", () => {
  localStorage.clear();
  saveTrack("Баку", { points: [0, 0, 1, 1, 0, 1], objects: [] });
  clearTrack("Баку");
  assert.equal(loadAll()["Баку"], undefined);
});

test("track_store: round-trips pit / pitLoss / zones / cornerOverrides", () => {
  localStorage.clear();
  saveTrack("Барселона", {
    points: [0, 0, 1, 0, 1, 1, 0, 1],
    objects: [],
    pit: { x: 0.2, y: 0.3 },
    pitLoss: 24.5,
    zones: [{ sectors: [0, 1, 2], ease: 0.55, type: "brake" }],
    cornerOverrides: { 7: "low" },
  });
  const t = effectiveTrack("Барселона", [9, 9, 9, 9]);
  assert.deepEqual(t.pit, { x: 0.2, y: 0.3 });
  assert.equal(t.pitLoss, 24.5);
  assert.equal(t.zones[0].type, "brake");
  assert.deepEqual(t.zones[0].sectors, [0, 1, 2]);
  assert.equal(t.cornerOverrides["7"], "low");
});

test("track_store: old records (no gameplay fields) default cleanly", () => {
  localStorage.clear();
  saveTrack("Стара", { points: [0, 0, 1, 0, 1, 1, 0, 1] });   // no pit/zones/etc.
  const t = effectiveTrack("Стара", [9, 9, 9, 9]);
  assert.equal(t.pit, null);
  assert.equal(t.pitLoss, null);
  assert.deepEqual(t.zones, []);
  assert.equal(t.cornerOverrides, null);
});

test("effectiveTrack: preset fallback also carries default gameplay fields", () => {
  localStorage.clear();
  const t = effectiveTrack("НетТакой", [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(t.points, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(t.zones, []);
  assert.equal(t.pit, null);
});

test("track_store: round-trips pitLane (+ default null for old records)", () => {
  localStorage.clear();
  saveTrack("Питовая", { points: [0, 0, 1, 0, 1, 1, 0, 1], pitLane: { entry: 0.9, exit: 0.08, side: -1, width: 2.5 } });
  assert.deepEqual(effectiveTrack("Питовая", [9, 9, 9, 9]).pitLane, { entry: 0.9, exit: 0.08, side: -1, width: 2.5 });
  saveTrack("Старая", { points: [0, 0, 1, 0, 1, 1, 0, 1] });
  assert.equal(effectiveTrack("Старая", [9, 9, 9, 9]).pitLane, null);
  assert.equal(effectiveTrack("НетТакой", [1, 2, 3, 4]).pitLane, null);
});
