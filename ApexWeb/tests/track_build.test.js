import { test } from "node:test";
import assert from "node:assert/strict";
import { TRACK, TRACK_PATH } from "../src/data.js";
import { buildMini } from "../src/track.js";
import { defaultRaceTrack, trackFromEdited } from "../src/track_build.js";

test("defaultRaceTrack: Barcelona + its mini", () => {
  const t = defaultRaceTrack();
  assert.equal(t.name, TRACK.name);
  assert.equal(t.lt, TRACK.lt);
  assert.deepEqual(t.mini, buildMini(TRACK_PATH));
});

test("trackFromEdited: inherits Barcelona defaults, applies zones + pitLoss, builds mini from the points", () => {
  const edited = {
    name: "Моя",
    points: [0.1, 0.1, 0.9, 0.1, 0.9, 0.9, 0.1, 0.9],   // a square-ish loop
    zones: [{ sectors: [0, 1], ease: 0.5, type: "brake" }],
    pitLoss: 19.5,
  };
  const t = trackFromEdited(edited);
  assert.equal(t.name, "Моя");
  assert.equal(t.lt, TRACK.lt, "non-authored stat inherits Barcelona");
  assert.equal(t.laps, TRACK.laps);
  assert.equal(t.pit, 19.5, "pitLoss -> track.pit");
  assert.deepEqual(t.overtake_zones, edited.zones);
  assert.equal(t.mini.length, 18);
  assert.ok(t.mini.every(m => m.straightness >= 0 && m.straightness <= 1));
});

test("trackFromEdited: no pitLoss -> inherits base pit", () => {
  const t = trackFromEdited({ points: [0, 0, 1, 0, 1, 1, 0, 1] });
  assert.equal(t.pit, TRACK.pit);
  assert.deepEqual(t.overtake_zones, []);
});
