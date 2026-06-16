import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPack, hydratePack } from "../src/track_pack.js";

// stub global fetch: map url -> json value; any url not in the map answers 404.
function stubFetch(map) {
  globalThis.fetch = async (url) => (url in map)
    ? { ok: true, status: 200, json: async () => map[url] }
    : { ok: false, status: 404, json: async () => ({}) };
}

test("loadPack: reads the manifest then each track record", async () => {
  stubFetch({
    "tracks/index.json": [{ slug: "moya", name: "Моя" }],
    "tracks/moya.json": { name: "Моя", points: [0, 0, 1, 0, 1, 1, 0, 1], zones: [] },
  });
  const pack = await loadPack();
  assert.equal(pack.length, 1);
  assert.equal(pack[0].name, "Моя");
  assert.deepEqual(pack[0].record.points, [0, 0, 1, 0, 1, 1, 0, 1]);
});

test("loadPack: missing manifest -> [] (no throw)", async () => {
  stubFetch({});
  assert.deepEqual(await loadPack(), []);
});

test("loadPack: skips a track with too few points", async () => {
  stubFetch({
    "tracks/index.json": [{ slug: "bad", name: "Bad" }, { slug: "ok", name: "Ok" }],
    "tracks/bad.json": { name: "Bad", points: [0, 0] },
    "tracks/ok.json": { name: "Ok", points: [0, 0, 1, 0, 1, 1, 0, 1] },
  });
  const pack = await loadPack();
  assert.deepEqual(pack.map((t) => t.name), ["Ok"]);
});

test("hydratePack: writes each record via the injected saveTrack, returns names", async () => {
  stubFetch({
    "tracks/index.json": [{ slug: "moya", name: "Моя" }],
    "tracks/moya.json": { name: "Моя", points: [0, 0, 1, 0, 1, 1, 0, 1] },
  });
  const calls = [];
  const names = await hydratePack((n, rec) => calls.push([n, rec]));
  assert.deepEqual(names, ["Моя"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "Моя");
  assert.deepEqual(calls[0][1].points, [0, 0, 1, 0, 1, 1, 0, 1]);
});
