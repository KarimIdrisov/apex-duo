// ApexWeb/src/ui/setup.js
import { TRACK } from "../data.js";
import { AXES, trackIdeal } from "../setup.js";

export function render(root, ctx) {
  ctx.setup = ctx.setup || [0.5,0.5,0.5];
  const ideal = trackIdeal(TRACK.laps*1000 + Math.round(TRACK.lt));
  const reveal = ctx._revealed;            // green mark only after a practice run
  const sliders = AXES.map((ax,i)=>`
    <div style="margin:12px 0">
      <p class="label">${ax.name}</p>
      <div style="position:relative">
        ${reveal?`<div style="position:absolute;left:${ideal[i]*100}%;top:-3px;width:2px;height:20px;background:var(--good)"></div>`:""}
        <input type="range" min="0" max="1" step="0.01" value="${ctx.setup[i]}" data-ax="${i}" style="width:100%">
      </div>
    </div>`).join("");
  root.innerHTML = `<div class="panel"><h2>Сетап</h2>${sliders}
    <button class="ready" id="ready">Готов → Квала</button></div>`;
  root.querySelectorAll("input[type=range]").forEach(el=>{
    el.oninput = e => { ctx.setup[+e.target.dataset.ax] = +e.target.value;
      ctx.send({ cmd:"set_setup", player:ctx.myPlayer, setup: ctx.setup }); };
  });
  root.querySelector("#ready").onclick = () => {
    ctx.send({ cmd:"set_setup", player: ctx.myPlayer, setup: ctx.setup });  // commit final setup
    ctx.send({ cmd:"ready", player: ctx.myPlayer });
  };
}
