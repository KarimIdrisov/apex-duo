// ApexWeb/tests/net.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalNet } from "../src/net.js";

test("LocalNet delivers messages between host and client", async () => {
  const host = new LocalNet("room1", "host");
  const client = new LocalNet("room1", "client");
  const got = new Promise(res => client.onMessage(m => res(m)));
  await new Promise(r => setTimeout(r, 10));
  host.send({ type: "snapshot", phase: "race" });
  const m = await got;
  assert.equal(m.type, "snapshot");
  assert.equal(m.phase, "race");
  host.close(); client.close();
});
