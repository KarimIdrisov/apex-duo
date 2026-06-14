// ApexWeb/src/editor3d.js — editor 3D preview controller. Reuses the GAME renderer (race3d) on a
// synthetic editor-preview ctx, so the preview shows the same track/scenery/car models as the game.
// A small ticker advances a few cars round the lap; race3d's own loop renders them. Render-only.
// Imported dynamically by editor.js so a missing CDN/THREE never breaks 2D editing.
import { init as race3dInit } from "./ui/race3d.js";
import { advanceFrac, buildPreviewCars } from "./editor_preview.js";

const CAR_COLS = ["#e8453c", "#3d7aa0", "#ffd24a", "#46d08a", "#b06fd0", "#e07a1a"];

// start a 3D preview of an edited track on `canvas`. edit = { points: flat 0..1, objects:[...] }.
// returns { dispose } — call it before rebuilding or when tearing the preview down.
export function startPreview(canvas, edit, opts = {}) {
  const n = opts.cars || 5, lapSeconds = opts.lapSeconds || 7;
  const cars = buildPreviewCars(n, CAR_COLS);
  const ctx = {
    editorPreview: true,
    snapshot: { trackName: null, points: edit.points, objects: edit.objects || [], cars },
    _buf: {}, _cam3d: { mode: "orbit" },
  };
  const r3d = race3dInit(canvas, ctx);
  let raf = 0, last = 0, alive = true;
  function tick(t) {
    if (!alive) return;
    const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
    for (const c of cars) { const a = advanceFrac(c.lap, c.lapFrac, dt, lapSeconds); c.lap = a.lap; c.lapFrac = a.lapFrac; }
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);
  return { dispose() { if (!alive) return; alive = false; cancelAnimationFrame(raf); r3d.dispose(); } };
}
