import { test } from "node:test";
import assert from "node:assert/strict";
import { saveToRepo, publish } from "../src/track_repo.js";

test("saveToRepo: no helper (fetch throws) -> {ok:false, offline:true}", async () => {
  globalThis.fetch = async () => { throw new Error("ECONNREFUSED"); };
  const r = await saveToRepo({ name: "x", points: [0, 0, 1, 0, 1, 1, 0, 1] });
  assert.equal(r.ok, false);
  assert.equal(r.offline, true);
});

test("saveToRepo: helper ok -> {ok:true, slug}", async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, slug: "x" }) });
  const r = await saveToRepo({ name: "x", points: [0, 0, 1, 0, 1, 1, 0, 1] });
  assert.equal(r.ok, true);
  assert.equal(r.slug, "x");
});

test("publish: no helper -> {ok:false}", async () => {
  globalThis.fetch = async () => { throw new Error("ECONNREFUSED"); };
  const r = await publish();
  assert.equal(r.ok, false);
});

test("publish: helper result is passed through", async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, message: "опубликовано" }) });
  const r = await publish();
  assert.equal(r.ok, true);
  assert.equal(r.message, "опубликовано");
});
