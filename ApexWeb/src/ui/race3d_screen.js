// ApexWeb/src/ui/race3d_screen.js — full-screen wrapper around the 3D orbital race
// view (race3d.js). race.js delegates here while ctx.view3d is on, and rerender()
// calls it every snapshot tick. The FIRST call builds the DOM and boots race3d.init
// once (guarded by ctx._s3dReady); every later call only pumps the shared
// interpolation buffers, so cars keep moving without re-creating the WebGL context.
// Leaving 3D (back button, or any rerender that drops the canvas) disposes the view.
import * as race3d from "./race3d.js";
import { pumpBuffers } from "./race.js";

export function render(root, ctx, onExit) {
  if (!ctx._s3dReady || !root.querySelector("#r3d-canvas")) {
    if (ctx._s3d && ctx._s3d.dispose) ctx._s3d.dispose();   // tear down any stale instance
    root.innerHTML = `
      <div id="r3d-bar" class="panel">
        <button class="btn" id="r3d-back">← 2D</button>
        <div class="label" style="margin:0">${(ctx.snapshot && ctx.snapshot.scActive) ? "🟡 SAFETY CAR" : "ГОНКА"}</div>
        <div class="label" style="margin:0">тащи мышью — поворот камеры</div>
      </div>
      <canvas id="r3d-canvas"></canvas>`;
    const canvas = root.querySelector("#r3d-canvas");
    ctx._s3d = race3d.init(canvas, ctx);
    root.querySelector("#r3d-back").onclick = () => {
      if (ctx._s3d && ctx._s3d.dispose) ctx._s3d.dispose();
      ctx._s3d = null; ctx._s3dReady = false;
      onExit();
    };
    ctx._s3dReady = true;
  }
  if (ctx.snapshot) pumpBuffers(ctx, ctx.snapshot);   // keep buffers fresh for the RAF loop
}
