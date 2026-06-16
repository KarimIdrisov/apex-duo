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
      const normPerWorld = pxPerWorld / pxPerNorm;
      const p = offsetPoint(cl, f, s * latWorld * normPerWorld), c = C(p);
      if (!started) { g.moveTo(c[0], c[1]); started = true; } else g.lineTo(c[0], c[1]);
    }
    g.lineWidth = width * pxPerWorld; g.strokeStyle = color; g.stroke();
  };
  for (const run of runs) {
    const f0 = ((run.start - 4) % STEPS + STEPS) % STEPS / STEPS;       // overrun a touch past the corner ends
    const f1 = (run.start + run.len + 4) % STEPS / STEPS;
    offStroke(f0, f1, halfW * 1.7, halfW * 2.4, o.gravel);             // gravel trap (outer)
    offStroke(f0, f1, halfW * 1.05, halfW * 1.0, o.runoff);           // paved run-off apron (just outside the kerb)
  }

  lap(0); g.lineWidth = (halfW * 2 + 9) * pxPerWorld; g.strokeStyle = o.shoulder; g.stroke();   // run-off shoulder (grass-green)
  lap(0); g.lineWidth = (halfW * 2 + 1.8) * pxPerWorld; g.strokeStyle = o.line; g.stroke();     // white edge line (kerb rim overrides it in corners)
  {                                                                                  // red/white kerb RIM along the centerline through corners (peeks out both edges)
    const CH = 7, KW = (halfW * 2 + 2.6) * pxPerWorld;
    for (const run of runs) for (let s = 0; s < run.len; s += CH) {
      g.beginPath();
      for (let j = 0; j <= CH && s + j <= run.len; j++) { const k = (run.start + s + j) % STEPS, c = C(pointAt(cl, k / STEPS)); j ? g.lineTo(c[0], c[1]) : g.moveTo(c[0], c[1]); }
      g.lineWidth = KW; g.strokeStyle = (Math.floor(s / CH) % 2) ? o.kerbA : o.kerbB; g.stroke();
    }
  }
  lap(0); g.lineWidth = halfW * 2 * pxPerWorld; g.strokeStyle = o.asphalt; g.stroke();          // asphalt on top -> kerb rim peeks out
  lap(0); g.lineWidth = (halfW * 2 - 0.5) * pxPerWorld; g.strokeStyle = o.asphalt; g.stroke();  // (double-pass keeps the inner asphalt clean under the kerb rim)
  g.globalAlpha = 0.5; lap(0); g.lineWidth = halfW * 0.95 * pxPerWorld; g.strokeStyle = o.rubber; g.stroke(); g.globalAlpha = 1;   // rubbered-in racing line down the middle
  {                                                                                  // start/finish stripe (perpendicular across the road, computed in canvas space)
    const p0 = C(pointAt(cl, 0)), p1 = C(pointAt(cl, 0.002));
    let dx = p1[0] - p0[0], dy = p1[1] - p0[1], m = Math.hypot(dx, dy) || 1; const nx = -dy / m, ny = dx / m, L = halfW * pxPerWorld;
    g.beginPath(); g.moveTo(p0[0] + nx * L, p0[1] + ny * L); g.lineTo(p0[0] - nx * L, p0[1] - ny * L); g.lineWidth = 1.6 * pxPerWorld; g.strokeStyle = o.start; g.stroke();
  }
}
