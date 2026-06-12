// ApexWeb/src/ui/lobby.js
import { TEAMS } from "../data.js";
import { hostGame, joinGame, startSolo } from "../main.js";

export function render(root, ctx) {
  const teamOpts = TEAMS.map((t,i)=>`<option value="${i}">${t.name}</option>`).join("");
  root.innerHTML = `
    <div class="panel">
      <h2>Apex Web — кооп-уикенд</h2>
      <p class="label">Команда</p>
      <select id="team">${teamOpts}</select>
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
  root.querySelector("#team").onchange = e => ctx.teamIdx = +e.target.value;
  root.querySelector("#host").onclick = async () => {
    const code = await hostGame(useP2P);
    root.querySelector("#status").textContent = `Код комнаты: ${code} — передай напарнику. Жми «Готов», когда оба тут.`;
    ctx.weekend.start();          // host -> practice; onPhase broadcasts it, hello re-syncs late joiners
  };
  root.querySelector("#solo").onclick = () => startSolo();   // single-player vs AI
  root.querySelector("#join").onclick = async () => {
    const code = root.querySelector("#code").value.trim();
    await joinGame(code, useP2P);
    root.querySelector("#status").textContent = "Подключено. Ждём старт уикенда…";
  };
}
