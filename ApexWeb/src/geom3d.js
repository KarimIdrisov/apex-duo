// ApexWeb/src/geom3d.js — pure geometry + interpolation for the 3D race view.
// No THREE, no DOM. Centerline sampling from a normalized TRACK_PATH, ribbon edges,
// camera framing, and the snapshot interpolation. All deterministic + unit-testable.

// Centerline from a flat normalized path [x0,y0,x1,y1,...] (a closed loop).
export function buildCenterline(path) {
  const pts = [];
  for (let i = 0; i < path.length; i += 2) pts.push([path[i], path[i + 1]]);
  const seg = []; let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    seg.push({ a, b, d, acc: total }); total += d;
  }
  return { pts, seg, total };
}

// [x,y] on the centerline at fractional lap position (wraps mod 1).
export function pointAt(cl, frac) {
  let t = (((frac % 1) + 1) % 1) * cl.total;
  for (const s of cl.seg) {
    if (t <= s.d) { const r = s.d ? t / s.d : 0; return [s.a[0] + (s.b[0] - s.a[0]) * r, s.a[1] + (s.b[1] - s.a[1]) * r]; }
    t -= s.d;
  }
  return cl.pts[0].slice();
}

// Unit tangent [dx,dy] at frac (central difference).
export function tangentAt(cl, frac) {
  const e = 1 / 2048;
  const a = pointAt(cl, frac - e), b = pointAt(cl, frac + e);
  const dx = b[0] - a[0], dy = b[1] - a[1], m = Math.hypot(dx, dy) || 1;
  return [dx / m, dy / m];
}

// Axis-aligned bounds + centroid of the centerline (normalized space).
export function bounds(cl) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of cl.pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, size: Math.max(maxX - minX, maxY - minY) || 1 };
}

// Orbital camera that frames the whole track. Returns world-space pos + target
// (ground plane = XZ, y up). Pure: caller scales to world units.
export function cameraFromBounds(b, { elevDeg = 42, azimDeg = -35, fill = 1.5 } = {}) {
  const target = [b.cx, 0, b.cy];
  const dist = b.size * fill;
  const el = elevDeg * Math.PI / 180, az = azimDeg * Math.PI / 180;
  const horiz = Math.cos(el) * dist;
  return { target, dist, pos: [target[0] + Math.sin(az) * horiz, dist * Math.sin(el), target[2] + Math.cos(az) * horiz] };
}

// Local turn radius of the centerline at frac, measured over a small symmetric window `w`
// (the arc through three samples). Returns Infinity on a straight. Used to keep the road
// ribbon from self-intersecting at corners tighter than its own half-width.
// Keep `w` small enough that the per-window turn stays well under 90°: beyond that the asin
// saturates and the radius is over-estimated (the unsafe direction for fold prevention).
export function radiusAt(cl, frac, w = 1 / 240) {
  const a = pointAt(cl, frac - w), b = pointAt(cl, frac), c = pointAt(cl, frac + w);
  const v1x = b[0] - a[0], v1y = b[1] - a[1], v2x = c[0] - b[0], v2y = c[1] - b[1];
  const la = Math.hypot(v1x, v1y) || 1e-9, lb = Math.hypot(v2x, v2y) || 1e-9;
  const cross = v1x * v2y - v1y * v2x;
  const dtheta = Math.abs(Math.asin(Math.max(-1, Math.min(1, cross / (la * lb)))));
  return dtheta > 1e-6 ? (la + lb) / 2 / dtheta : Infinity;
}

// Per-sample boolean around the lap: true where the centerline is cornering (radius < maxR),
// false on straights. `steps` samples evenly from frac 0. `w` is the radius-detection window;
// it defaults to the sample spacing but accepts a coarser fixed window so corner classification
// stays stable (not noisy) as the mesh `steps` rises.
export function cornerMask(cl, steps, maxR, w = 1 / steps) {
  const m = [];
  for (let k = 0; k < steps; k++) m.push(radiusAt(cl, k / steps, w) < maxR);
  return m;
}

// Contiguous corner spans around the lap as [{start, len}] (a run covers samples
// (start+0 .. start+len-1) mod steps). Built from cornerMask, then runs separated by <= `gap`
// straight samples are merged and runs shorter than `minLen` dropped — so kerbs drawn from this
// are clean continuous strips, not the per-sample flicker a raw mask produces near the threshold.
export function cornerRuns(cl, steps, maxR, { w = 1 / 200, gap = 3, minLen = 5 } = {}) {
  const m = cornerMask(cl, steps, maxR, w);
  if (m.every(Boolean)) return [{ start: 0, len: steps }];
  if (!m.some(Boolean)) return [];
  const start0 = m.indexOf(false);                       // rotate to start on a straight -> no run wraps the seam
  const rot = []; for (let i = 0; i < steps; i++) rot.push(m[(i + start0) % steps]);
  const runs = [];
  for (let i = 0; i < steps;) {
    if (!rot[i]) { i++; continue; }
    let j = i; while (j < steps && rot[j]) j++;
    runs.push([i, j]); i = j;
  }
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] <= gap) last[1] = r[1];   // bridge a tiny straight gap inside one corner
    else merged.push([r[0], r[1]]);
  }
  return merged.filter((r) => r[1] - r[0] >= minLen)
    .map((r) => ({ start: (r[0] + start0) % steps, len: r[1] - r[0] }));
}

// Fraction of the local corner radius the road half-width is clamped to, so the inner ribbon
// edge can never reach the centreline (no self-intersection). Empirical: 0.6 clears ALL 25 real
// circuits fold-free at the render resolution (STEPS=800) — tight street circuits (Monaco, Baku)
// need it lower than Barcelona alone did; smaller = safer but narrower at the sharpest corners.
// race3d reuses this for the car-position clamp so cars track the same narrowed road.
export const RIBBON_CLAMP = 0.6;

// Resample the centerline into `steps` points and offset by ±halfW along the
// local normal -> left/right edge arrays ([x,y] each). Builds the road ribbon.
export function ribbonEdges(cl, halfW, steps = 240) {
  const left = [], right = [];
  for (let k = 0; k < steps; k++) {
    const f = k / steps;
    const [px, py] = pointAt(cl, f);
    const [tx, ty] = tangentAt(cl, f);
    const nx = -ty, ny = tx;                                   // unit normal (left of travel)
    const hw = Math.min(halfW, radiusAt(cl, f, 1 / steps) * RIBBON_CLAMP);   // clamp: inner edge can't reach the centre -> no fold
    left.push([px + nx * hw, py + ny * hw]);
    right.push([px - nx * hw, py - ny * hw]);
  }
  return { left, right };
}

// Smooth cumulative progress (lap+lapFrac) between ~12 Hz snapshots.
// buf: array of {prog, t(ms)} oldest..newest; rt: render time (ms).
export function sampleProg(buf, rt) {
  if (!buf || !buf.length) return 0;
  if (buf.length === 1 || rt <= buf[0].t) return buf[0].prog;
  for (let i = buf.length - 1; i > 0; i--) {
    const a = buf[i - 1], b = buf[i];
    if (rt >= a.t) {
      const span = b.t - a.t || 1, v = (b.prog - a.prog) / span;
      return rt <= b.t ? a.prog + (b.prog - a.prog) * ((rt - a.t) / span)
                       : b.prog + v * Math.min(rt - b.t, 140);
    }
  }
  return buf[buf.length - 1].prog;
}

// Signed bend of the track over a window `w` around frac (cross of the incoming
// vs outgoing travel direction). + = turns left, - = right, ~0 on a straight.
// Uses a window (not an infinitesimal) so it captures a whole corner on a
// piecewise-linear path, where curvature otherwise concentrates at the vertices.
export function turnRateAt(cl, frac, w = 1 / 48) {
  const a = pointAt(cl, frac - w), b = pointAt(cl, frac), c = pointAt(cl, frac + w);
  const v1x = b[0] - a[0], v1y = b[1] - a[1], m1 = Math.hypot(v1x, v1y) || 1;
  const v2x = c[0] - b[0], v2y = c[1] - b[1], m2 = Math.hypot(v2x, v2y) || 1;
  return (v1x / m1) * (v2y / m2) - (v1y / m1) * (v2x / m2);
}

// Lateral offset (normalized units) of the racing line at frac: hugs the INSIDE
// of corners (sign follows the turn), ~0 on straights, bounded to ±maxLat.
// +offset is the left of travel (matches ribbonEdges' left normal nx=-ty, ny=tx).
export function racingLineOffset(cl, frac, maxLat = 1, gain = 8) {
  const m = Math.max(-1, Math.min(1, turnRateAt(cl, frac) * gain));
  return m * maxLat;
}

// Point at frac displaced sideways by `lat` (normalized units) along the left normal.
export function offsetPoint(cl, frac, lat) {
  const [px, py] = pointAt(cl, frac);
  const [tx, ty] = tangentAt(cl, frac);
  return [px + (-ty) * lat, py + tx * lat];
}

// CENTRIPETAL Catmull-Rom resample of a closed polygon path into a denser, SMOOTH loop
// that still passes through every original point (`sub` samples per original segment).
// Centripetal (alpha=0.5, knots spaced by sqrt of chord length) avoids the overshoot and
// self-intersecting cusps that uniform Catmull-Rom produces at sharp corners — so the
// track + car heading round even tight corners cleanly instead of bulging.
export function splinePath(path, sub = 8) {
  const pts = [];
  for (let i = 0; i < path.length; i += 2) pts.push([path[i], path[i + 1]]);
  const n = pts.length;
  if (n < 3) return path.slice();
  const knot = (ti, pi, pj) => ti + Math.sqrt(Math.hypot(pj[0] - pi[0], pj[1] - pi[1]) || 1e-9);   // alpha = 0.5
  const lp = (a, c, ta, tc, t) => { const d = (tc - ta) || 1, f = (t - ta) / d; return [a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f]; };
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const t0 = 0, t1 = knot(t0, p0, p1), t2 = knot(t1, p1, p2), t3 = knot(t2, p2, p3);
    for (let s = 0; s < sub; s++) {
      const t = t1 + (t2 - t1) * (s / sub);                       // Barry-Goldman pyramidal eval at t in [t1,t2]
      const a1 = lp(p0, p1, t0, t1, t), a2 = lp(p1, p2, t1, t2, t), a3 = lp(p2, p3, t2, t3, t);
      const b1 = lp(a1, a2, t0, t2, t), b2 = lp(a2, a3, t1, t3, t);
      const c = lp(b1, b2, t1, t2, t);
      out.push(c[0], c[1]);
    }
  }
  return out;
}

// Smooth periodic elevation profile in [0,1] along the lap (frac wraps 0..1). Integer harmonics
// keep it exactly loop-continuous (no step at start/finish). Deterministic from `seed` so a track
// always undulates the same way. The render scales this to world height; the sim never sees it.
export function elevation(frac, seed = 1) {
  let s = (seed >>> 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  let v = 0, amp = 0;
  for (const h of [1, 2, 3]) {                          // one big hill + two finer undulations
    const a = (h === 1 ? 1.0 : 0.5 / h) * (0.6 + 0.4 * rnd()), p = rnd() * Math.PI * 2;
    v += a * Math.sin(2 * Math.PI * h * frac + p); amp += a;
  }
  return 0.5 + 0.5 * v / (amp || 1);                    // [0,1]; sin period 1 for integer h -> elevation(0)==elevation(1)
}
