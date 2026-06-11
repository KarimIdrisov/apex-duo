// ApexWeb/src/ui/practice.js
import { TRACK } from "../data.js";
import { trackIdeal, closeness, feedback } from "../setup.js";

export function render(root, ctx) {
  ctx.setup = ctx.setup || [0.5,0.5,0.5];
  ctx.runs = ctx.runs || 0;
  const ideal = trackIdeal(TRACK.laps*1000 + Math.round(TRACK.lt));
  const close = ctx.runs > 0 ? closeness(ctx.setup, ideal) : 0;
  const fb = ctx.runs > 0 ? feedback(ctx.setup, ideal) : "Сделай прогон, чтобы пилот дал фидбэк.";
  root.innerHTML = `
    <div class="panel">
      <h2>Практика</h2>
      <p class="label">Близость к идеалу: ${ctx.runs?Math.round(close*100):"—"}%</p>
      <div class="bar"><i style="width:${close*100}%;background:linear-gradient(90deg,#e7553b,#e7c84b 60%,#3ddc84)"></i></div>
      <div class="panel" style="border-left:3px solid var(--accent)">🗣️ ${fb}</div>
      <button class="primary" id="run" ${ctx.runs>=3?"disabled":""}>▶ Прогон (${ctx.runs}/3)</button>
      <button class="ready" id="ready" style="margin-top:8px">Готов → Сетап</button>
    </div>`;
  root.querySelector("#run").onclick = () => { ctx.runs++; ctx._revealed = true; render(root, ctx); };
  root.querySelector("#ready").onclick = () => ctx.send({ cmd:"ready", player: ctx.myPlayer });
}
