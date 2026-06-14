// ApexWeb/src/track_paint.js — paint a track onto a 2D canvas context. Shared by the 3D race view
// (onto a CanvasTexture) and the editor (onto its display canvas) so both render IDENTICALLY.
// `cl` = buildCenterline(splinePath(points)); `C(p)` maps a normalized track point -> [canvasX,
// canvasY]; `pxPerWorld` scales line widths from world units; `halfW` = road half-width (world).
import { pointAt, tangentAt, cornerRuns, offsetPoint } from "./geom3d.js";

export const DEFAULT_COLORS = { grass: "#2f5236", shoulder: "#3a5a38", edge: "#5a5a64",
  asphalt: "#30303a", kerbA: "#d83b3b", kerbB: "#ededed", start: "#ffffff" };

export function paintTrack(g, cl, C, pxPerWorld, halfW, opts = {}) {
  const o = { ...DEFAULT_COLORS, ...opts }, STEPS = 600, CORNER_R = 0.10;
  g.lineJoin = "round"; g.lineCap = "round";
  const lap = (offN) => {
    g.beginPath();
    for (let k = 0; k <= STEPS; k++) { const f = k / STEPS, pp = offN ? offsetPoint(cl, f, offN) : pointAt(cl, f), c = C(pp); k ? g.lineTo(c[0], c[1]) : g.moveTo(c[0], c[1]); }
    g.closePath();
  };
  g.fillStyle = o.grass; g.fillRect(0, 0, g.canvas.width, g.canvas.height);          // grass
  lap(0); g.lineWidth = (halfW * 2 + 9) * pxPerWorld; g.strokeStyle = o.shoulder; g.stroke();   // run-off shoulder
  lap(0); g.lineWidth = (halfW * 2 + 0.8) * pxPerWorld; g.strokeStyle = o.edge; g.stroke();     // thin road edge
  {                                                                                  // red/white kerb RIM along the centerline through corners (peeks out both edges)
    const runs = cornerRuns(cl, STEPS, CORNER_R), CH = 7, KW = (halfW * 2 + 2.6) * pxPerWorld;
    for (const run of runs) for (let s = 0; s < run.len; s += CH) {
      g.beginPath();
      for (let j = 0; j <= CH && s + j <= run.len; j++) { const k = (run.start + s + j) % STEPS, c = C(pointAt(cl, k / STEPS)); j ? g.lineTo(c[0], c[1]) : g.moveTo(c[0], c[1]); }
      g.lineWidth = KW; g.strokeStyle = (Math.floor(s / CH) % 2) ? o.kerbA : o.kerbB; g.stroke();
    }
  }
  lap(0); g.lineWidth = halfW * 2 * pxPerWorld; g.strokeStyle = o.asphalt; g.stroke();          // asphalt on top -> kerb rim peeks out
  {                                                                                  // start/finish stripe (perpendicular across the road, computed in canvas space)
    const p0 = C(pointAt(cl, 0)), p1 = C(pointAt(cl, 0.002));
    let dx = p1[0] - p0[0], dy = p1[1] - p0[1], m = Math.hypot(dx, dy) || 1; const nx = -dy / m, ny = dx / m, L = halfW * pxPerWorld;
    g.beginPath(); g.moveTo(p0[0] + nx * L, p0[1] + ny * L); g.lineTo(p0[0] - nx * L, p0[1] - ny * L); g.lineWidth = 1.6 * pxPerWorld; g.strokeStyle = o.start; g.stroke();
  }
}
