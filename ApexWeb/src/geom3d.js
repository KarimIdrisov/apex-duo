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
