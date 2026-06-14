// ApexWeb/src/track_build.js — build the sim's race-track object. Either the default (Barcelona +
// its mini), one from an edited track record (geometry -> mini, authored zones/pit; the rest
// inherits Barcelona), or one from a career calendar round. Pure. The sim reads track.mini +
// overtake_zones + pit.
import { TRACK, TRACK_PATH } from "./data.js";
import { buildMini } from "./track.js";
import { splinePath } from "./geom3d.js";
import { TRACK_SHAPES } from "./track_shapes.js";

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

// overtake zones derived from a round's `ot`: a braking zone into T1 + a slipstream zone, with
// `ease` scaled by how overtakeable the circuit is. The sim completes passes only inside a zone.
export function defaultZones(ot) {
  const ease = Math.max(0.20, Math.min(0.80, 0.30 + ot * 0.55));
  return [
    { sectors: [0, 1, 2], ease, type: "brake" },
    { sectors: [11, 12], ease: Math.max(0.18, ease * 0.85), type: "slip" },
  ];
}

// build a sim race-track for a career calendar round: visual + geometry from the round's real
// circuit shape; sim characteristics from the round; zones auto-derived unless `round.zones` set.
export function careerTrack(round, base = TRACK) {
  const outline = TRACK_SHAPES[round.shape] || TRACK_PATH;
  return {
    ...base,
    name: round.name, gp: round.name,
    laps: round.laps, lt: round.lt, pit: round.pit,
    df: round.df, pw: round.pw, ot: round.ot, sc: round.sc, wet: round.wet,
    mini: buildMini(outline),
    overtake_zones: Array.isArray(round.zones) ? round.zones : defaultZones(round.ot),
  };
}
