// ApexWeb/tests/sim_edited_track.test.js — gate: an edited-track race is sane + deterministic.
// field() is copied verbatim from tests/sim.test.js (the 22-car grid builder).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Race } from "../src/sim.js";
import { TEAMS } from "../src/data.js";
import { driverAttrs } from "../src/team.js";
import { trackFromEdited } from "../src/track_build.js";

function field() {
  // flat field: every team's two drivers, no players yet
  let idx = 0;
  return TEAMS.flatMap(t => t.drivers.map(d => ({
    idx: idx++, name:d.name, abbrev:d.abbrev, skill:d.skill,
    car:t.car, color:t.color, team:t.name,
    setup:[0.5,0.5,0.5], startTyre:"medium",
    attrs: driverAttrs(d.abbrev, d.skill),
  })));
}

// a twisty oval-ish edited track (sparse control points), with a brake zone + pit loss.
const EDITED = {
  name: "Тест-овал",
  points: (() => { const a = []; for (let i = 0; i < 14; i++) { const t = i / 14 * Math.PI * 2; a.push(0.5 + 0.4 * Math.cos(t), 0.5 + 0.18 * Math.sin(t)); } return a; })(),
  zones: [{ sectors: [3, 4], ease: 0.5, type: "brake" }],
  pitLoss: 20,
};

function runToFinish(seed) {
  const r = new Race(field(), trackFromEdited(EDITED), seed);
  let guard = 0; while (!r.finished && guard++ < 500000) r.step();
  return r;
}

test("edited-track race completes with sane, finite results", () => {
  const r = runToFinish(7);
  assert.ok(r.finished, "race finished");
  const ord = r.order();
  assert.equal(ord.length, 22);
  for (const c of ord) assert.ok(Number.isFinite(c.lap + c.lapFrac), `finite progress for ${c.abbrev}`);
});

test("edited-track race is deterministic (same seed -> identical finishing order)", () => {
  const a = runToFinish(7).order().map(c => c.abbrev);
  const b = runToFinish(7).order().map(c => c.abbrev);
  assert.deepEqual(a, b);
});
