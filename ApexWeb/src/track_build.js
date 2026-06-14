// ApexWeb/src/track_build.js — build the sim's race-track object. Either the default (Barcelona +
// its mini) or one from an edited track record (geometry -> mini, authored zones/pit; the rest
// inherits Barcelona). Pure. The sim reads track.mini (Task 1) + overtake_zones + pit.
import { TRACK, TRACK_PATH } from "./data.js";
import { buildMini } from "./track.js";
import { splinePath } from "./geom3d.js";

// the default race track (Barcelona) with its mini attached.
export function defaultRaceTrack() { return { ...TRACK, mini: buildMini(TRACK_PATH) }; }

// build a sim track from an edited track record {points, zones, pitLoss, ...}. The sparse control
// points are densified via splinePath so buildMini's per-vertex angle is smooth. Non-authored stats
// (lt/pw/df/ot/abr/sc/wet/laps) inherit Barcelona (`base`).
export function trackFromEdited(edited, base = TRACK) {
  return {
    ...base,
    name: edited.name || base.name,
    mini: buildMini(splinePath(edited.points)),
    overtake_zones: Array.isArray(edited.zones) ? edited.zones : [],
    pit: (typeof edited.pitLoss === "number") ? edited.pitLoss : base.pit,
  };
}
