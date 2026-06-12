// ApexWeb/src/ui/quali.js
import { DRIVER_INFO } from "../data.js";
export function render(root, ctx) {
  ctx.myRisk = ctx.myRisk ?? 0.5;          // this player's risk slider (NOT the host risk map)
  const grid = ctx.snapshot?.grid;          // host computes + broadcasts after a run
  root.innerHTML = `
    <div class="panel">
      <h2>Квала — один быстрый круг</h2>
      <p class="label">Риск: ${Math.round(ctx.myRisk*100)}%</p>
      <input type="range" min="0" max="1" step="0.05" value="${ctx.myRisk}" id="risk" style="width:100%">
      <button class="primary" id="go" style="margin-top:8px">🏁 Поехать круг</button>
      <button class="ready" id="ready" style="margin-top:8px">Готов → Гонка</button>
      <div id="grid" style="margin-top:10px">${grid?gridHtml(grid):""}</div>
    </div>`;
  root.querySelector("#risk").oninput = e => ctx.myRisk = +e.target.value;
  root.querySelector("#go").onclick = () =>
    ctx.send({ cmd:"quali_risk", player:ctx.myPlayer, risk: ctx.myRisk });
  root.querySelector("#ready").onclick = () => ctx.send({ cmd:"ready", player: ctx.myPlayer });
}
function logo(abbrev){
  const l = DRIVER_INFO[abbrev] && DRIVER_INFO[abbrev].logo;
  return l ? `<img src="assets/teams/${l}.png" alt="" style="height:24px;width:24px;object-fit:contain;vertical-align:middle;margin-right:8px">` : "";
}
function gridHtml(grid){
  return `<p class="label">Стартовая решётка</p>` + grid.map((g,i)=>
    `<div style="display:flex;justify-content:space-between;padding:2px 6px">
       <span>${i+1}. ${logo(g.abbrev)}${g.abbrev}</span><span>${g.time.toFixed(3)}</span></div>`).join("");
}
