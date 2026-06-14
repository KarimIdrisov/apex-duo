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
