// ApexWeb/src/ui/lobby.js
import { TEAMS, TEAM_LOGO, DIFFICULTY } from "../data.js";
import { teamColor, teamInk, carImgSrc } from "./teamviz.js";
import { hostGame, joinGame, startSolo, startCareerSolo, hostCareer } from "../main.js";

const logoSrc = i => `assets/teams/${TEAM_LOGO[TEAMS[i].name]}.png`;
const teamCard = i => {
  const t = TEAMS[i], col = teamColor(t.name), ink = teamInk(col);
  return `<div style="position:relative;overflow:hidden;background:var(--content2);border-left:5px solid ${col};border-radius:var(--r-md);padding:12px;min-height:84px;display:flex;align-items:center;gap:12px">
      <img src="${logoSrc(i)}" alt="" style="height:46px;width:46px;object-fit:contain">
      <div style="z-index:1"><div style="font-weight:800;font-size:18px">${t.name}</div>
        <span style="font-size:11px;color:${ink};background:${col};border-radius:4px;padding:1px 6px">${t.drivers[0].abbrev} · ${t.drivers[1].abbrev}</span></div>
      <img src="${carImgSrc(t.name)}" alt="" onerror="this.style.display='none'" style="position:absolute;right:0;bottom:0;height:74px;object-fit:contain;opacity:.95;pointer-events:none">
    </div>`;
};

export function render(root, ctx) {
  ctx.teamIdx = ctx.teamIdx || 0;
  ctx.diffKey = ctx.diffKey || "normal";
  ctx.difficulty = DIFFICULTY[ctx.diffKey].ai;
  const teamOpts = TEAMS.map((t,i)=>`<option value="${i}" ${i===ctx.teamIdx?"selected":""}>${t.name}</option>`).join("");
  const diffOpts = Object.entries(DIFFICULTY).map(([k,d])=>`<option value="${k}" ${k===ctx.diffKey?"selected":""}>${d.label}</option>`).join("");
  root.innerHTML = `
    <div class="panel">
      <h2>Apex Web — кооп-уикенд</h2>
      <p class="label">Команда</p>
      <div id="teamcard">${teamCard(ctx.teamIdx)}</div>
      <div style="height:8px"></div>
      <select id="team" style="width:100%;padding:8px">${teamOpts}</select>
      <div style="height:10px"></div>
      <p class="label">Сложность ИИ</p>
      <select id="diff" style="width:100%;padding:8px">${diffOpts}</select>
      <div style="height:10px"></div>
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><input type="checkbox" id="career"> Карьера (сезон, 23 этапа)</label>
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
    root.querySelector("#teamcard").innerHTML = teamCard(ctx.teamIdx);
  };
  root.querySelector("#diff").onchange = e => {
    ctx.diffKey = e.target.value;
    ctx.difficulty = DIFFICULTY[ctx.diffKey].ai;
  };
  root.querySelector("#host").onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = "Создаём комнату…";
    if (root.querySelector("#career").checked) hostCareer(ctx.teamIdx);   // career begins when the partner joins
    const code = await hostGame(useP2P);   // stay in lobby; the weekend starts when the partner joins
    root.querySelector("#status").innerHTML =
      `<div style="margin-top:6px">Код комнаты — передай напарнику:</div>
       <div style="font-size:20px;font-weight:700;color:var(--good);user-select:all;word-break:break-all;margin:6px 0">${code}</div>
       <div>Ждём, когда напарник войдёт по коду…</div>`;
  };
  root.querySelector("#solo").onclick = () => {
    if (root.querySelector("#career").checked) startCareerSolo(ctx.teamIdx); else startSolo();   // career or one-off weekend
  };
  root.querySelector("#join").onclick = async () => {
    const code = root.querySelector("#code").value.trim();
    await joinGame(code, useP2P);
    root.querySelector("#status").textContent = "Подключено. Ждём старт уикенда…";
  };
}
