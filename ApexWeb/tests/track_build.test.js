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

// --- M1 career calendar tracks ---
import { CALENDAR } from "../src/career.js";
import { careerTrack, defaultZones } from "../src/track_build.js";
import { N_MINI } from "../src/track.js";

test("careerTrack builds a sim track from a calendar round: mini + params + zones", () => {
  const monza = CALENDAR.find(r => r.shape === "Монца");
  const t = careerTrack(monza);
  assert.equal(t.mini.length, N_MINI);
  assert.equal(t.laps, monza.laps);
  assert.equal(t.pw, monza.pw);
  assert.equal(t.name, monza.name);
  assert.ok(Array.isArray(t.overtake_zones) && t.overtake_zones.length >= 1);
  for (const z of t.overtake_zones) for (const s of z.sectors) assert.ok(s >= 0 && s < N_MINI, "zone sector index in range");
});

test("defaultZones: a more overtakeable track gets easier zones", () => {
  const easy = defaultZones(0.7)[0].ease, hard = defaultZones(0.1)[0].ease;
  assert.ok(easy > hard);
  assert.ok(hard >= 0.2 && easy <= 0.8);
});

test("careerTrack: an unknown shape falls back to the Barcelona outline (still N_MINI sectors)", () => {
  const t = careerTrack({ name: "X", shape: "НЕТ", laps: 50, lt: 80, pit: 22, df: 0.5, pw: 0.5, ot: 0.4, sc: 0.3, wet: 0.1 });
  assert.equal(t.mini.length, N_MINI);
});
