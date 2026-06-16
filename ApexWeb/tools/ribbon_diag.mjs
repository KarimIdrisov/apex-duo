// Diagnostic: does the track ribbon self-intersect at tight corners?
// Mirrors race3d.js geometry: cl = buildCenterline(splinePath(TRACK_PATH)), HW_N = 3.8*b.size/120.
import { TRACK_PATH } from "../src/data.js";
import { buildCenterline, splinePath, bounds, ribbonEdges, pointAt, tangentAt } from "../src/geom3d.js";

const WORLD = 120, HALF_W = 3.8, STEPS = 320;
const raw = TRACK_PATH;
const splined = splinePath(raw);
const cl = buildCenterline(splined);
const b = bounds(cl);
const sc = WORLD / b.size;
const HW_N = HALF_W / sc;

console.log(`source points: ${raw.length / 2}  splined: ${splined.length / 2}  centerline len(norm): ${cl.total.toFixed(3)}`);
console.log(`bounds size: ${b.size.toFixed(3)}  HALF_W(norm): ${HW_N.toFixed(4)}  (=${(HW_N / b.size * 100).toFixed(2)}% of track size)`);

const { left, right } = ribbonEdges(cl, HW_N, STEPS);

// A "fold" = the edge moves backward relative to the local centerline tangent (inner edge pinch).
function folds(edge, name) {
  let n = 0; const spots = [];
  for (let k = 0; k < STEPS; k++) {
    const a = edge[k], c = edge[(k + 1) % STEPS];
    const [tx, ty] = tangentAt(cl, (k + 0.5) / STEPS);
    const dx = c[0] - a[0], dy = c[1] - a[1];
    if (dx * tx + dy * ty < 0) { n++; spots.push((k / STEPS)); }   // edge segment opposes travel -> folded
  }
  return { n, spots };
}
const lf = folds(left, "left"), rf = folds(right, "right");
console.log(`\nFOLDS (edge segment runs BACKWARD = self-intersection / pinch):`);
console.log(`  left edge:  ${lf.n}/${STEPS} folded`);
console.log(`  right edge: ${rf.n}/${STEPS} folded`);

// Local radius of curvature along the centerline (min = sharpest corner).
let minR = Infinity, minAt = 0;
for (let k = 0; k < STEPS; k++) {
  const f = k / STEPS, e = 1 / STEPS;
  const p0 = pointAt(cl, f - e), p1 = pointAt(cl, f), p2 = pointAt(cl, f + e);
  const ax = p1[0] - p0[0], ay = p1[1] - p0[1], bx = p2[0] - p1[0], by = p2[1] - p1[1];
  const cross = ax * by - ay * bx, la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
  const dtheta = Math.asin(Math.max(-1, Math.min(1, cross / (la * lb || 1))));
  const r = Math.abs(dtheta) > 1e-6 ? (la + lb) / 2 / Math.abs(dtheta) : Infinity;
  if (r < minR) { minR = r; minAt = f; }
}
console.log(`\nsharpest corner: radius ${minR.toFixed(4)} (norm) at lap-frac ${minAt.toFixed(3)}`);
console.log(`  half-width / min-radius = ${(HW_N / minR).toFixed(2)}  (>1 => inner edge self-intersects there)`);

// How many corners are tighter than the half-width (each is a pinch site)?
let tight = 0;
for (let k = 0; k < STEPS; k++) {
  const f = k / STEPS, e = 1 / STEPS;
  const p0 = pointAt(cl, f - e), p1 = pointAt(cl, f), p2 = pointAt(cl, f + e);
  const ax = p1[0] - p0[0], ay = p1[1] - p0[1], bx = p2[0] - p1[0], by = p2[1] - p1[1];
  const cross = ax * by - ay * bx, la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
  const dtheta = Math.asin(Math.max(-1, Math.min(1, cross / (la * lb || 1))));
  const r = Math.abs(dtheta) > 1e-6 ? (la + lb) / 2 / Math.abs(dtheta) : Infinity;
  if (r < HW_N) tight++;
}
console.log(`samples where radius < half-width (pinch zone): ${tight}/${STEPS}`);
