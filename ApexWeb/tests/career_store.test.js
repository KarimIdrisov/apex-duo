import { test } from "node:test";
import assert from "node:assert/strict";
import { newCareer, applyResult } from "../src/career.js";
import { TEAMS } from "../src/data.js";

// minimal localStorage mock for Node
globalThis.localStorage = (() => { let m = {}; return {
  getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); },
  removeItem: k => { delete m[k]; }, clear: () => { m = {}; },
}; })();

const { saveCareer, loadCareer, clearCareer, hasCareer, exportCareer, importCareer } = await import("../src/career_store.js");

test("save -> load round-trips the career", () => {
  const c = newCareer({ teamIdx: 2, seed: 5 });
  applyResult(c, TEAMS.flatMap(t => t.drivers.map(d => ({ abbrev: d.abbrev, team: t.name }))));
  assert.equal(saveCareer(c), true);
  assert.equal(hasCareer(), true);
  const back = loadCareer();
  assert.equal(back.teamIdx, 2);
  assert.equal(back.money, c.money);
  assert.deepEqual(back.teamPts, c.teamPts);
});

test("clear removes the save; load returns null", () => {
  saveCareer(newCareer({ teamIdx: 0, seed: 1 }));
  clearCareer();
  assert.equal(loadCareer(), null);
  assert.equal(hasCareer(), false);
});

test("export/import round-trips via JSON; bad JSON -> null", () => {
  const c = newCareer({ teamIdx: 1, seed: 3 });
  const json = exportCareer(c);
  assert.deepEqual(importCareer(json).teamPts, c.teamPts);
  assert.equal(importCareer("{not json"), null);
});
