import { test } from "node:test";
import assert from "node:assert/strict";
import { initPitCrew, composePitCrew, tickRacePitCrew, restPitCrew, practicePitStops, effSkill, PIT_ROLES } from "../src/pitcrew.js";

// Smoke coverage for the managed pit crew (PIT milestone). Pure + deterministic; composes into the
// two scalars the sim reads (pitMult + botch/disaster chance).

test("initPitCrew staffs every role deterministically", () => {
  const a = initPitCrew(0.7, 1), b = initPitCrew(0.7, 1);
  assert.deepEqual(a, b, "same seed → identical crew");
  for (const r of PIT_ROLES) assert.ok(a.members[r.key] && a.members[r.key].skill > 0, `${r.key} staffed`);
  assert.ok(a.cohesion > 0);
});

test("composePitCrew: a stronger crew pits faster and botches less, within bounds", () => {
  const weak = composePitCrew(initPitCrew(0.2, 1));
  const strong = composePitCrew(initPitCrew(1.0, 1));
  assert.ok(strong.pitMult < weak.pitMult, "better crew pits faster (lower pitMult)");
  assert.ok(strong.botchChance < weak.botchChance, "better crew botches less");
  assert.ok(weak.pitMult <= 1.30 && strong.pitMult >= 0.62, "pitMult is bounded");
});

test("a race weekend tires the crew; rest recovers it", () => {
  const crew = initPitCrew(0.7, 1);
  const eff0 = effSkill(crew.members.gunner);
  tickRacePitCrew(crew);
  assert.ok(crew.members.gunner.fatigue > 0, "a race adds fatigue");
  assert.ok(effSkill(crew.members.gunner) < eff0, "fatigue saps effective skill");
  restPitCrew(crew, 1);
  assert.equal(crew.members.gunner.fatigue, 0, "full rest clears fatigue");
});

test("practicePitStops lifts skill and cohesion", () => {
  const crew = initPitCrew(0.5, 1);
  const skill0 = crew.members.gunner.skill, coh0 = crew.cohesion;
  assert.equal(practicePitStops(crew), true);
  assert.ok(crew.members.gunner.skill > skill0 && crew.cohesion > coh0);
});
