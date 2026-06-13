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

// Resample the centerline into `steps` points and offset by ±halfW along the
// local normal -> left/right edge arrays ([x,y] each). Builds the road ribbon.
export function ribbonEdges(cl, halfW, steps = 240) {
  const left = [], right = [];
  for (let k = 0; k < steps; k++) {
    const f = k / steps;
    const [px, py] = pointAt(cl, f);
    const [tx, ty] = tangentAt(cl, f);
    const nx = -ty, ny = tx;            // unit normal (left of travel)
    left.push([px + nx * halfW, py + ny * halfW]);
    right.push([px - nx * halfW, py - ny * halfW]);
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
