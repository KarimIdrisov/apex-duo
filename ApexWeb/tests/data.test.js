// ApexWeb/tests/data.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { TEAMS, TRACK, COMPOUNDS, PACE_MODES } from "../src/data.js";

test("11 teams, 22 drivers", () => {
  assert.equal(TEAMS.length, 11);
  const drivers = TEAMS.flatMap(t => t.drivers);
  assert.equal(drivers.length, 22);
});

test("driver skills in [0.5, 1.0], abbrevs unique", () => {
  const drivers = TEAMS.flatMap(t => t.drivers);
  for (const d of drivers) assert.ok(d.skill >= 0.5 && d.skill <= 1.0, d.name);
  const abbrevs = new Set(drivers.map(d => d.abbrev));
  assert.equal(abbrevs.size, 22);
});

test("each team car has power/aero/energy/rel in (0,1]", () => {
  for (const t of TEAMS)
    for (const k of ["power", "aero", "energy", "rel"])
      assert.ok(t.car[k] > 0 && t.car[k] <= 1, `${t.name}.${k}`);
});

test("track + compound/mode tables present", () => {
  assert.equal(TRACK.name, "Барселона");
  assert.ok(TRACK.laps > 0 && TRACK.lt > 0);
  for (const c of ["soft", "medium", "hard"]) assert.ok(COMPOUNDS[c]);
  for (const m of ["conserve", "balanced", "push"]) assert.ok(PACE_MODES[m]);
});

import { ENGINE_MODES, FUEL } from "../src/data.js";

test("engine modes + fuel constants present and ordered", () => {
  for (const m of ["save", "standard", "push"]) assert.ok(ENGINE_MODES[m], m);
  // push is faster (more negative pace) but burns more; save is the opposite
  assert.ok(ENGINE_MODES.push.pace < ENGINE_MODES.standard.pace);
  assert.ok(ENGINE_MODES.save.pace > ENGINE_MODES.standard.pace);
  assert.ok(ENGINE_MODES.push.burn > ENGINE_MODES.save.burn);
  assert.ok(FUEL.margin > 0 && FUEL.weightK > 0);
});
