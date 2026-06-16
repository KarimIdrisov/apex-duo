// ApexWeb/src/scenery.js — deterministic procedural trackside scenery PLACEMENT (pure: no THREE, no DOM).
// Returns placement descriptors in NORMALIZED track space (the same 0..1 space as TRACK_PATH); the 3D
// renderer (race3d.js) turns these into meshes. Everything is seeded from the track name so a circuit's
// grandstands/barriers/trees are identical every load (no per-frame Math.random scenery jitter).
import { pointAt, tangentAt, offsetPoint, cornerMask, cornerRuns, bounds } from "./geom3d.js";

// FNV-1a hash of a string -> 32-bit seed (stable across runs).
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  const s = str || "apex";
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) || 1;
}

// mulberry32 PRNG -> () => float in [0,1). Deterministic, fast, good enough for placement jitter.
export function mulberry(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Straight (non-corner) runs around the lap — the complement of cornerRuns. Each run is
// { start, len } in sample indices over `steps` (a run covers (start+0 .. start+len-1) mod steps).
// `minLen` drops tiny straights so we don't drop a grandstand onto a 2-sample sliver.
export function straightRuns(cl, steps = 600, maxR = 0.10, { w = 1 / 200, minLen = 14 } = {}) {
  const corner = cornerMask(cl, steps, maxR, w);           // true = cornering
  const straight = corner.map((v) => !v);
  if (straight.every(Boolean)) return [{ start: 0, len: steps }];
  if (!straight.some(Boolean)) return [];
  const start0 = straight.indexOf(false);                  // rotate to begin on a corner -> no run wraps the seam
  const rot = []; for (let i = 0; i < steps; i++) rot.push(straight[(i + start0) % steps]);
  const runs = [];
  for (let i = 0; i < steps;) {
    if (!rot[i]) { i++; continue; }
    let j = i; while (j < steps && rot[j]) j++;
    runs.push([i, j]); i = j;
  }
  return runs.filter((r) => r[1] - r[0] >= minLen)
    .map((r) => ({ start: (r[0] + start0) % steps, len: r[1] - r[0] }));
}

// The single longest straight run -> { start, len, mid (centre lap-fraction), frac0, frac1 }.
// Returns null if the track has no straight long enough.
export function longestStraight(cl, steps = 600, maxR = 0.10, opts = {}) {
  const runs = straightRuns(cl, steps, maxR, opts);
  if (!runs.length) return null;
  let best = runs[0];
  for (const r of runs) if (r.len > best.len) best = r;
  const mid = ((best.start + best.len / 2) % steps) / steps;
  return { start: best.start, len: best.len, mid, frac0: best.start / steps, frac1: ((best.start + best.len) % steps) / steps };
}

// Which lateral sign (+1 / -1) at `frac` points AWAY from the track centroid (i.e. the OUTSIDE of
// the lap). offsetPoint moves along the left normal for +lat; we pick whichever lands farther from
// the centroid so grandstands/barriers sit on the outside of corners and straights.
export function farSide(cl, frac, centroid) {
  const c = centroid || bounds(cl);
  const cx = c.cx, cy = c.cy;
  const pPlus = offsetPoint(cl, frac, 0.01), pMinus = offsetPoint(cl, frac, -0.01);
  const dPlus = (pPlus[0] - cx) ** 2 + (pPlus[1] - cy) ** 2;
  const dMinus = (pMinus[0] - cx) ** 2 + (pMinus[1] - cy) ** 2;
  return dPlus >= dMinus ? 1 : -1;
}

// Evenly spaced lap-fractions across a {start,len} run (inclusive of both ends unless `inset`>0),
// `n` items. `steps` is the run's sample resolution. Returns an array of fracs in [0,1).
export function spaceFracs(run, n, steps = 600, inset = 0) {
  if (n <= 0) return [];
  const out = [];
  const a = inset, b = run.len - inset;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : a + (b - a) * (i / (n - 1));
    out.push(((run.start + t) % steps) / steps);
  }
  return out;
}

// High-level scenery plan for a track: returns descriptors the renderer consumes. All fracs are
// lap-fractions in [0,1); `side` is the outward lateral sign; `latN`-scaled distances are decided
// by the renderer (it knows world scale / half-width). Deterministic from `name`.
//   grandstands : along the 1-2 longest straights, outside edge
//   hoardings   : advertising boards lining straights, outside edge (just past the barrier)
//   barriers    : sampled fracs along every corner's OUTSIDE edge (tyre walls)
//   trees       : scattered background points (outside the run-off), seeded
//   marshals    : one post near each corner entry, outside edge
export function planScenery(cl, name, { steps = 600, maxR = 0.10 } = {}) {
  const seed = hashSeed(name);
  const rnd = mulberry(seed);
  const cen = bounds(cl);
  const corners = cornerRuns(cl, steps, maxR);
  const straights = straightRuns(cl, steps, maxR).sort((a, b) => b.len - a.len);

  // grandstands on the two longest straights (plus always the start/finish straight if distinct)
  const grandstands = [];
  const standStraights = straights.slice(0, Math.min(3, straights.length));
  for (const run of standStraights) {
    const nBays = Math.max(2, Math.min(5, Math.round(run.len / steps * 14)));
    const fr = spaceFracs(run, nBays, steps, Math.max(3, run.len * 0.12));
    for (const f of fr) grandstands.push({ frac: f, side: farSide(cl, f, cen), tiers: 2 + (rnd() < 0.5 ? 1 : 0) });
  }

  // advertising hoardings: a denser line of boards along the longest straights
  const hoardings = [];
  for (const run of standStraights) {
    const n = Math.max(3, Math.min(10, Math.round(run.len / steps * 26)));
    for (const f of spaceFracs(run, n, steps, run.len * 0.06)) hoardings.push({ frac: f, side: farSide(cl, f, cen) });
  }

  // tyre barriers along the OUTSIDE of every corner
  const barriers = [];
  for (const run of corners) {
    const n = Math.max(3, Math.round(run.len / 10));
    for (let i = 0; i < n; i++) {
      const f = ((run.start + (run.len * (i + 0.5)) / n) % steps) / steps;
      barriers.push({ frac: f, side: farSide(cl, f, cen) });
    }
  }

  // marshal post near each corner entry
  const marshals = [];
  for (const run of corners) {
    const f = ((run.start + 2) % steps) / steps;
    marshals.push({ frac: f, side: farSide(cl, f, cen) });
  }

  // scattered background trees (deterministic): random lap-frac, outward, random extra distance
  const trees = [];
  const nTrees = 46;
  for (let i = 0; i < nTrees; i++) {
    const f = rnd();
    trees.push({ frac: f, side: rnd() < 0.5 ? 1 : -1, dist: 1.8 + rnd() * 2.6, scale: 0.7 + rnd() * 0.9 });
  }

  return { seed, grandstands, hoardings, barriers, marshals, trees };
}

// Helper for the renderer: world point + heading (radians, atan2(tx,ty)) at a frac offset sideways
// by `latN` normalized units on `side`. Kept here so placement math has one home.
export function placeAt(cl, frac, side, latN) {
  const p = offsetPoint(cl, frac, side * latN);
  const t = tangentAt(cl, frac);
  return { x: p[0], y: p[1], rot: Math.atan2(t[0], t[1]) };
}
