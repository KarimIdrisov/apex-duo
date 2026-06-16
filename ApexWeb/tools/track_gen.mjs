// PROTOTYPE: procedural smooth race-track generator (throwaway, for owner preview).
// Control points on a perturbed circle -> periodic cubic B-spline (C2 smooth) -> dense loop.
// Bounded radius modulation keeps the minimum corner radius well above the road half-width,
// so the ribbon can never self-intersect and corners are never faceted.
import { buildCenterline, ribbonEdges, radiusAt, cornerMask, pointAt, bounds } from "../src/geom3d.js";

const WORLD = 120, HALF_W = 3.8, STEPS = 320;

function rngFrom(seed) { let s = (seed >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// Generate a normalized [x0,y0,...] closed loop from a seed.
export function generateTrack(seed, K = 12) {
  const rnd = rngFrom(seed);
  const harm = [2, 3, 5].map((h) => ({ h, a: 0.08 + 0.16 * rnd(), p: rnd() * Math.PI * 2 }));   // bounded amplitudes
  const cp = [];
  for (let i = 0; i < K; i++) {
    const th = i / K * Math.PI * 2 + (rnd() - 0.5) * 0.16;           // slight angular jitter
    let r = 1;
    for (const { h, a, p } of harm) r += a * Math.sin(h * th + p);
    r = Math.max(0.5, r);                                            // floor so it never collapses inward
    cp.push([Math.cos(th) * r, Math.sin(th) * r]);
  }
  const S = 26, raw = [];                                            // periodic cubic B-spline
  for (let i = 0; i < K; i++) {
    const p0 = cp[(i - 1 + K) % K], p1 = cp[i], p2 = cp[(i + 1) % K], p3 = cp[(i + 2) % K];
    for (let s = 0; s < S; s++) {
      const t = s / S, t2 = t * t, t3 = t2 * t;
      const b0 = ((1 - t) ** 3) / 6, b1 = (3 * t3 - 6 * t2 + 4) / 6, b2 = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6, b3 = t3 / 6;
      raw.push(b0 * p0[0] + b1 * p1[0] + b2 * p2[0] + b3 * p3[0], b0 * p0[1] + b1 * p1[1] + b2 * p2[1] + b3 * p3[1]);
    }
  }
  // normalize to 0..1 (match TRACK_PATH convention)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < raw.length; i += 2) { minX = Math.min(minX, raw[i]); maxX = Math.max(maxX, raw[i]); minY = Math.min(minY, raw[i + 1]); maxY = Math.max(maxY, raw[i + 1]); }
  const span = Math.max(maxX - minX, maxY - minY) || 1, out = [];
  for (let i = 0; i < raw.length; i += 2) { out.push((raw[i] - minX) / span, (raw[i + 1] - minY) / span); }
  return out;
}

// quality stats: min corner radius vs half-width, and fold count
function stats(path) {
  const cl = buildCenterline(path), b = bounds(cl), HW_N = HALF_W / (WORLD / b.size);
  let minR = Infinity;
  for (let k = 0; k < STEPS; k++) minR = Math.min(minR, radiusAt(cl, k / STEPS, 1 / STEPS));
  const { left, right } = ribbonEdges(cl, HW_N, STEPS);
  let folds = 0;
  for (const edge of [left, right]) for (let k = 0; k < STEPS; k++) {
    const a = edge[k], c = edge[(k + 1) % STEPS], f = (k + 0.5) / STEPS, p0 = pointAt(cl, f - 1e-3), p1 = pointAt(cl, f + 1e-3);
    const tx = p1[0] - p0[0], ty = p1[1] - p0[1];
    if ((c[0] - a[0]) * tx + (c[1] - a[1]) * ty < -1e-9) folds++;
  }
  const cornerPct = Math.round(cornerMask(cl, STEPS, 0.10).filter(Boolean).length / STEPS * 100);
  return { pts: path.length / 2, ratio: (minR / HW_N).toFixed(2), folds, cornerPct };
}

for (let seed = 1; seed <= 8; seed++) {
  const s = stats(generateTrack(seed));
  console.log(`seed ${seed}: ${s.pts} pts  minR/halfW ${s.ratio}  folds ${s.folds}  corners ${s.cornerPct}%`);
}
