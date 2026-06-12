// ApexWeb/src/ui/lobby.js
import { TEAMS, TEAM_LOGO } from "../data.js";
import { hostGame, joinGame, startSolo } from "../main.js";

const logoSrc = i => `assets/teams/${TEAM_LOGO[TEAMS[i].name]}.png`;

export function render(root, ctx) {
  ctx.teamIdx = ctx.teamIdx || 0;
  const teamOpts = TEAMS.map((t,i)=>`<option value="${i}" ${i===ctx.teamIdx?"selected":""}>${t.name}</option>`).join("");
  root.innerHTML = `
    <div class="panel">
      <h2>Apex Web — кооп-уикенд</h2>
      <p class="label">Команда</p>
      <div style="display:flex;align-items:center;gap:10px">
        <img id="teamlogo" src="${logoSrc(ctx.teamIdx)}" alt="" style="height:52px;width:52px;object-fit:contain">
        <select id="team" style="flex:1;padding:8px">${teamOpts}</select>
      </div>
      <div style="height:10px"></div>
      <button class="primary" id="host">Создать комнату</button>
      <div style="height:8px"></div>
      <button class="ready" id="solo">Играть одному (vs AI)</button>
      <div style="height:14px"></div>
      <p class="label">…или войти к напарнику</p>
      <input id="code" placeholder="код комнаты" style="width:100%;padding:10px" />
      <button class="primary" id="join" style="margin-top:8px">Войти</button>
      <p id="status" class="label" style="margin-top:10px"></p>
    </div>`;
  const useP2P = true;            // set false to dev with two tabs (LocalNet)
  root.querySelector("#team").onchange = e => {
    ctx.teamIdx = +e.target.value;
    root.querySelector("#teamlogo").src = logoSrc(ctx.teamIdx);
  };
  root.querySelector("#host").onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = "Создаём комнату…";
    const code = await hostGame(useP2P);   // stay in lobby; the weekend starts when the partner joins
    root.querySelector("#status").innerHTML =
      `<div style="margin-top:6px">Код комнаты — передай напарнику:</div>
       <div style="font-size:20px;font-weight:700;color:var(--good);user-select:all;word-break:break-all;margin:6px 0">${code}</div>
       <div>Ждём, когда напарник войдёт по коду…</div>`;
  };
  root.querySelector("#solo").onclick = () => startSolo();   // single-player vs AI
  root.querySelector("#join").onclick = async () => {
    const code = root.querySelector("#code").value.trim();
    await joinGame(code, useP2P);
    root.querySelector("#status").textContent = "Подключено. Ждём старт уикенда…";
  };
}
