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

import { TYRE } from "../src/data.js";

test("compounds have a warm-up rate; TYRE constants present", () => {
  for (const c of ["soft", "medium", "hard"]) assert.ok(COMPOUNDS[c].warm > 0, c);
  assert.ok(COMPOUNDS.soft.warm > COMPOUNDS.hard.warm);
  assert.ok(TYRE.warmPen > 0 && TYRE.ease > 0);
  assert.ok(TYRE.pitTemp < TYRE.gridTemp && TYRE.gridTemp < 1);
});

import { FIT_K } from "../src/data.js";
test("FIT_K present (per-sector car-fit strength)", () => {
  assert.ok(FIT_K > 0 && FIT_K < 2);
});

import { SLIP_K, DIRTY_GAP, DIRTY_WEAR } from "../src/data.js";
test("overtaking constants present and sane", () => {
  assert.ok(SLIP_K > 0);
  assert.ok(DIRTY_GAP > 0.8);
  assert.ok(DIRTY_WEAR > 0);
});

import { EVENT } from "../src/data.js";
test("event constants present and sane", () => {
  assert.ok(EVENT.startP > 0 && EVENT.startP < 0.2);
  assert.ok(EVENT.startLoss > 0);
  assert.ok(EVENT.scPaceMult > 1);
  assert.ok(EVENT.scMinLaps >= 1);
  assert.ok(EVENT.scTrainGap > 0);
  assert.ok(EVENT.scPitMult > 0 && EVENT.scPitMult < 1);
});

import { WET, ATTRW } from "../src/data.js";
test("wet compounds + wet_opt + weather constants", () => {
  for (const c of ["soft", "medium", "hard", "inter", "wet"]) {
    assert.ok(COMPOUNDS[c], c);
    assert.ok(COMPOUNDS[c].wet_opt >= 0 && COMPOUNDS[c].wet_opt <= 1, `${c}.wet_opt`);
  }
  assert.equal(COMPOUNDS.hard.wet_opt, 0);
  assert.ok(COMPOUNDS.inter.wet_opt > 0.2 && COMPOUNDS.inter.wet_opt < 0.8);
  assert.ok(COMPOUNDS.wet.wet_opt > 0.7);
  assert.ok(TRACK.wet > 0 && TRACK.wet < 1);
  assert.ok(WET.mismatch > 0 && WET.slick > 0);
});

test("attribute modulation weights + car tyre/fuel indicators + facility", () => {
  for (const k of ["wear", "overtaking", "defending", "wet", "noise", "starts", "fuel"]) assert.ok(ATTRW[k] > 0, k);
  for (const t of TEAMS) {
    assert.ok(t.car.tyre > 0 && t.car.fuel > 0, `${t.name} car tyre/fuel`);
    assert.ok(t.facility >= 0 && t.facility <= 1, `${t.name} facility`);
  }
});

import { DIFFICULTY, AI_HANDICAP, AI_NOISE, AI_FORM } from "../src/data.js";
test("difficulty presets ascend easy<normal<hard in [0,1] with labels", () => {
  for (const k of ["easy", "normal", "hard"]) {
    assert.ok(DIFFICULTY[k] && typeof DIFFICULTY[k].label === "string", k);
    assert.ok(DIFFICULTY[k].ai >= 0 && DIFFICULTY[k].ai <= 1, `${k}.ai`);
  }
  assert.ok(DIFFICULTY.easy.ai < DIFFICULTY.normal.ai && DIFFICULTY.normal.ai < DIFFICULTY.hard.ai);
  assert.equal(DIFFICULTY.hard.ai, 1);
  assert.ok(AI_HANDICAP > 0 && AI_NOISE > 0 && AI_FORM > 0);
});

import { PRAC2 } from "../src/data.js";
test("PRAC2 has sane knowledge/session tuning", () => {
  assert.ok(PRAC2.AXES === 6, "6 setup axes");
  assert.ok(PRAC2.TRACK_PER_LAP > 0 && PRAC2.TRACK_PER_LAP < 0.2);
  assert.ok(PRAC2.MAX_HALF > 0.3 && PRAC2.MAX_HALF <= 0.5);
  assert.ok(PRAC2.CONFIRM_LAPS >= 1 && PRAC2.SAT_TOL > 0.1 && PRAC2.SAT_TOL < 0.3);
  assert.ok(PRAC2.SESSION_SEC >= 600 && PRAC2.SPEEDS.includes(8) && PRAC2.AUTOSIM_MULT < 1);
});

test("PRAC2 carries track-knowledge + dynamic pit-prep tuning", () => {
  assert.ok(PRAC2.TRACK_PER_LAP > 0 && PRAC2.TRACK_PER_LAP < 0.1, "track knowledge per lap");
  assert.ok(PRAC2.TRACK_PACE < 0, "track pace buff is negative (faster)");
  assert.ok(PRAC2.AI_TRACK_KNOW >= 0 && PRAC2.AI_TRACK_KNOW <= 1, "AI baseline track knowledge");
  assert.ok(PRAC2.TYRE_CHANGE_SEC > PRAC2.TYRE_REFIT_SEC, "new compound costs more than a re-fit");
  assert.ok(PRAC2.FUEL_PER_LAP > 0, "fuel load scales with laps");
  assert.ok(PRAC2.WIN_JITTER > 0.1 && PRAC2.WIN_JITTER < 0.5, "window jitter set (tuned for the P1 setup ceiling)");
  assert.equal(PRAC2.PIT_PREP_SEC, undefined, "flat prep retired");
  assert.equal(PRAC2.KNOW_PER_LAP, undefined, "per-axis knowledge retired");
});

import { QUALI2 } from "../src/data.js";
test("QUALI2 has a sane knockout structure + tuning", () => {
  assert.deepEqual(QUALI2.IN, [22, 15, 10]);
  assert.deepEqual(QUALI2.ELIM, [7, 5, 0]);
  assert.equal(QUALI2.IN[0] - QUALI2.ELIM[0], QUALI2.IN[1], "Q1 survivors → Q2 field");
  assert.equal(QUALI2.IN[1] - QUALI2.ELIM[1], QUALI2.IN[2], "Q2 survivors → Q3 field");
  assert.ok(QUALI2.SEG_SEC.length === 3 && QUALI2.SEG_SEC.every(s => s >= 240));
  assert.ok(QUALI2.GRIP_GAIN > 0.5 && QUALI2.QUALI_SOFT_SETS >= 2 && QUALI2.SPEEDS.includes(8));
});
