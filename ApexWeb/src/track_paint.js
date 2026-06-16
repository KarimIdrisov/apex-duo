// ApexWeb/src/track_paint.js — paint a track onto a 2D canvas context. Shared by the 3D race view
// (onto a CanvasTexture) and the editor (onto its display canvas) so both render IDENTICALLY.
// `cl` = buildCenterline(splinePath(points)); `C(p)` maps a normalized track point -> [canvasX,
// canvasY]; `pxPerWorld` scales line widths from world units; `halfW` = road half-width (world).
import { pointAt, tangentAt, cornerRuns, offsetPoint, bounds } from "./geom3d.js";

export const DEFAULT_COLORS = { grass: "#2f5236", shoulder: "#3a5a38", edge: "#5a5a64",
  asphalt: "#53535e", kerbA: "#e0463f", kerbB: "#f2f2f2", start: "#ffffff",
  gravel: "#ccb27e", runoff: "#5e5e69", line: "#e2e2ea", rubber: "#3f3f48" };

// outward lateral sign at frac (away from the track centroid) — gravel/run-off sit OUTSIDE corners.
function outward(cl, frac, cen) {
  const a = offsetPoint(cl, frac, 0.01), b = offsetPoint(cl, frac, -0.01);
  return ((a[0] - cen.cx) ** 2 + (a[1] - cen.cy) ** 2) >= ((b[0] - cen.cx) ** 2 + (b[1] - cen.cy) ** 2) ? 1 : -1;
}

export function paintTrack(g, cl, C, pxPerWorld, halfW, opts = {}) {
  const o = { ...DEFAULT_COLORS, ...opts }, STEPS = 600, CORNER_R = 0.10;
  g.lineJoin = "round"; g.lineCap = "round";
  const lap = (offN) => {
    g.beginPath();
    for (let k = 0; k <= STEPS; k++) { const f = k / STEPS, pp = offN ? offsetPoint(cl, f, offN) : pointAt(cl, f), c = C(pp); k ? g.lineTo(c[0], c[1]) : g.moveTo(c[0], c[1]); }
    g.closePath();
  };
  g.fillStyle = o.grass; g.fillRect(0, 0, g.canvas.width, g.canvas.height);          // grass

  const cen = bounds(cl);
  const runs = cornerRuns(cl, STEPS, CORNER_R);
  // --- corner run-off: a tan GRAVEL band then a grey ASPHALT apron on the OUTSIDE of each corner,
  // painted before the road so the road + kerb sit on top. Gives corners a real run-off look. ---
  const offStroke = (frac0, frac1, latWorld, width, color) => {
    g.beginPath();
    let started = false;
    const span = ((frac1 - frac0) + 1) % 1 || 1;
    const n = Math.max(2, Math.round(span * STEPS));
    for (let i = 0; i <= n; i++) {
      const f = (frac0 + span * (i / n)) % 1;
      const s = outward(cl, f, cen);
      // convert a world lateral distance to normalized using the local C scale is awkward; instead
      // offset in normalized units approximated from pxPerWorld: 1 world unit ≈ (pxPerWorld) canvas px,
      // and offsetPoint takes NORMALIZED units, so derive normalized-per-world from two sample points.
      const here = pointAt(cl, f), hereC = C(here), nextC = C(pointAt(cl, (f + 1 / STEPS) % 1));
      const pxPerNorm = Math.hypot(nextC[0] - hereC[0], nextC[1] - hereC[1]) * STEPS || 1;   // canvas px per 1.0 normalized
      const normPerWorld = pxPe