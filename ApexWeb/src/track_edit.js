// ApexWeb/src/track_edit.js — pure editor helpers that set the start/finish + lap direction by
// REORDERING the control points. No imports. The points order encodes the start (point[0] = lapFrac 0)
// and the direction (winding); the sim/render read it as-is, so this is data-only (balance-safe).

// rotate so pts[idx] becomes the first point (the new start/finish). idx is wrapped; idx 0 -> a copy.
export function rotateToStart(pts, idx) {
  if (!Array.isArray(pts) || pts.length === 0) return [];
  const n = pts.length, i = ((Math.trunc(idx) % n) + n) % n;
  return i === 0 ? pts.slice() : [...pts.slice(i), ...pts.slice(0, i)];
}

// reverse the lap direction while KEEPING the same start point: [p0,p1,…,pN] -> [p0,pN,…,p1].
export function reverseDirection(pts) {
  if (!Array.isArray(pts)) return [];
  if (pts.length < 2) return pts.slice();
  return [pts[0], ...pts.slice(1).reverse()];
}
