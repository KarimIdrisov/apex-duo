// ApexWeb/src/ui/season.js — the paddock: standings + finances + sponsors + the upcoming-weekend
// gate (and the season-start title-sponsor choice / season-end verdict). Reads ctx.careerView +
// ctx.careerReadyView (set by main on host AND client). Inline styles keep it self-contained.
import { CALENDAR, constructorStandings, driverStandings, boardOutcome } from "../career.js";
import { objectiveLabel } from "../sponsors.js";
import { INDICATORS, INDICATOR_LABEL, PROJECT_SIZE, effectiveCar } from "../development.js";
import { TEAM_LOGO, TEAMS } from "../data.js";

const row = (cells, hot) => `<tr style="${hot ? "font-weight:700;color:var(--good)" : ""}">${cells.map(c => `<td style="padding:3px 8px">${c}</td>`).join("")}</tr>`;
const m$ = k => `$${(k / 1000).toFixed(2)}M`;

export function render(root, ctx) {
  const c = ctx.careerView;
  if (!c) { root.innerHTML = `<div class="panel"><p class="label">Загрузка карьеры…</p></div>`; return; }
  const cons = constructorStandings(c);
  const drv = driverStandings(c).slice(0, 10);
  const lr = c.lastResult;
  const me = cons.find(x => x.isPlayer);
  const ready = ctx.careerReadyView || { p1: false, p2: false };
  const meReady = !!ready[ctx.myPlayer];

  const consTbl = cons.map(r => row([r.pos, `<img src="assets/teams/${TEAM_LOGO[r.team]}.png" style="height:16px;vertical-align:middle;margin-right:6px">${r.team}`, r.pts], r.isPlayer)).join("");
  const drvTbl = drv.map(r => row([r.pos, r.abbrev, r.team, r.pts])).join("");
  const podium = lr ? lr.podium.map((a, i) => `${["🥇", "🥈", "🥉"][i]} ${a}`).join("  ") : "";

  // finances panel
  const ledger = lr ? `<table style="width:100%;border-collapse:collapse">
      ${row(["Призовые", m$(lr.prize)])}${row(["Спонсоры", m$(lr.sponsorIncome)])}${row(["Расходы", "−" + m$(lr.runningCost)])}
      ${row([`<b>Итог гонки</b>`, `<b style="color:${lr.net >= 0 ? "var(--good)" : "var(--bad)"}">${lr.net >= 0 ? "+" : "−"}${m$(Math.abs(lr.net))}</b>`])}</table>` : `<p class="label">Старт сезона</p>`;
  const finances = `<div class="panel" style="flex:1;min-width:240px">
      <p class="label">Финансы · Бюджет ${m$(c.money)}</p>${ledger}</div>`;

  // sponsors panel
  const spons = `<div class="panel" style="flex:1;min-width:240px"><p class="label">Спонсоры</p>
      <table style="width:100%;border-collapse:collapse">
      ${(c.sponsors || []).map(s => row([`${s.kind === "title" ? "★ " : ""}${s.name}`, objectiveLabel(s.objective), `${Math.round(s.happiness * 100)}%`])).join("")}</table></div>`;

  // development panel — the player team's effective car + the active project + start buttons
  const myTeamName = me ? me.team : null;
  const baseCar = myTeamName ? (TEAMS.find(t => t.name === myTeamName) || {}).car : null;
  const dev = (c.carDev && myTeamName) ? c.carDev[myTeamName] : null;
  const eff = baseCar ? effectiveCar(baseCar, dev) : null;
  const bar = (k) => { const v = eff ? eff[k] : 0; const pct = Math.max(4, Math.min(100, Math.round((v - 0.6) / 0.6 * 100))); const up = dev && dev[k] > 0.0001;
    return `<div style="margin:2px 0"><span class="label" style="display:inline-block;width:64px">${INDICATOR_LABEL[k]}</span>
      <span style="display:inline-block;width:120px;height:8px;background:#0003;border-radius:4px;vertical-align:middle"><span style="display:block;height:8px;width:${pct}%;background:${up ? "var(--good)" : "var(--primary)"};border-radius:4px"></span></span>
      <span style="margin-left:6px">${v.toFixed(3)}${up ? " ▲" : ""}</span></div>`; };
  let proj;
  if (c.project) proj = `<p class="label">Проект: ${INDICATOR_LABEL[c.project.indicator]} (${PROJECT_SIZE[c.project.size].label}) — ещё ${c.project.racesLeft} гонк.</p>`;
  else proj = `<div class="label">Запустить проект:</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">${
    INDICATORS.flatMap(k => Object.keys(PROJECT_SIZE).map(sz => `<button class="ready devbtn" data-k="${k}" data-sz="${sz}" ${c.money < PROJECT_SIZE[sz].cost ? "disabled" : ""} style="padding:5px 8px;font-size:12px">${INDICATOR_LABEL[k]} ${PROJECT_SIZE[sz].label} (${m$(PROJECT_SIZE[sz].cost)})</button>`)).join("")}</div>`;
  const devPanel = eff ? `<div class="panel"><p class="label">Разработка машины${c.costCap ? " · cost cap ВКЛ" : ""}</p>${INDICATORS.map(bar).join("")}<div style="height:6px"></div>${proj}</div>` : "";

  // drivers panel — the player team's two drivers (age / overall / morale / contract / salary)
  const myTeamIdx = TEAMS.findIndex(t => t.name === myTeamName);
  const mine = c.drivers ? Object.entries(c.drivers).filter(([, d]) => d.teamIdx === myTeamIdx) : [];
  const driverRows = mine.map(([ab, d]) => row([
    `<b>${ab}</b>`, `${d.age} лет`, `ovr ${d.overall.toFixed(3)}`, `мораль ${Math.round(d.morale * 100)}%`,
    `${d.contractSeasons} сез.`, `${m$(d.salary)}/гонка`,
    `<button class="ready resign" data-ab="${ab}" style="padding:3px 8px;font-size:12px">Продлить</button>`,
  ])).join("");
  const driversPanel = mine.length ? `<div class="panel"><p class="label">Пилоты</p><table style="width:100%;border-collapse:collapse"><tbody>${driverRows}</tbody></table></div>` : "";

  // season-start title-sponsor choice
  let offers = "";
  if (c.pendingOffers && c.pendingOffers.length) {
    offers = `<div class="panel"><p class="label">Выбери титульного спонсора на сезон</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">${c.pendingOffers.map((o, i) => `
        <button class="ready offer" data-i="${i}" style="flex:1;min-width:180px;text-align:left;padding:10px">
          <b>${o.name}</b><br><span class="label">${objectiveLabel(o.objective)}</span><br>
          ретейнер ${m$(o.retainer)} · бонус ${m$(o.bonus)}</button>`).join("")}</div></div>`;
  }

  // weekend gate / season end
  let footer;
  if (c.done) {
    const bo = boardOutcome(c);
    footer = `<div class="panel"><h3>Сезон ${c.season} завершён</h3>
      <p class="label">Цель совета: не ниже P${bo.target} в Кубке конструкторов.</p>
      <p style="font-size:18px;font-weight:700;color:${bo.met ? "var(--good)" : "var(--bad)"}">${bo.met ? "✅ Цель выполнена" : "❌ Цель не выполнена"} — итог P${bo.finalPos}</p>
      <button class="primary" id="newseason">Новый сезон ▶</button></div>`;
  } else {
    const nextR = CALENDAR[c.round];
    const blocked = !!(c.pendingOffers && c.pendingOffers.length);
    footer = `<div class="panel"><p class="label">Следующий этап · раунд ${c.round + 1} из ${CALENDAR.length}</p>
      <h3>${nextR.name}</h3>
      <button class="primary" id="startwknd" ${blocked ? "disabled" : ""}>${meReady ? "Готов ✓ — ждём напарника…" : "Начать уикенд ▶"}</button>
      ${blocked ? `<p class="label">Сначала выбери спонсора.</p>` : ""}</div>`;
  }

  root.innerHTML = `
    <div class="panel"><h2>Сезон ${c.season} · ${me ? me.team : ""} (P${me ? me.pos : "-"})</h2>
      ${lr ? `<p class="label">${lr.gp}: ${podium}</p>` : ""}</div>
    <div style="display:flex;gap:12px;flex-wrap:wrap">${finances}${spons}</div>
    ${devPanel}
    ${driversPanel}
    ${offers}
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <div class="panel" style="flex:1;min-width:240px"><p class="label">Кубок конструкторов</p>
        <table style="width:100%;border-collapse:collapse"><tbody>${consTbl}</tbody></table></div>
      <div class="panel" style="flex:1;min-width:240px"><p class="label">Личный зачёт (топ-10)</p>
        <table style="width:100%;border-collapse:collapse"><tbody>${drvTbl}</tbody></table></div>
    </div>
    ${footer}`;

  root.querySelectorAll("button.offer").forEach(b => b.onclick = () => { root.querySelectorAll("button.offer").forEach(x => x.disabled = true); ctx.send({ cmd: "career_sponsor", player: ctx.myPlayer, offerIdx: +b.dataset.i }); });
  root.querySelectorAll("button.devbtn").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_project", player: ctx.myPlayer, indicator: b.dataset.k, size: b.dataset.sz }); });
  root.querySelectorAll("button.resign").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_resign", player: ctx.myPlayer, abbrev: b.dataset.ab }); });
  const sw = root.querySelector("#startwknd");
  if (sw) sw.onclick = () => { sw.disabled = true; ctx.send({ cmd: "career_start_weekend", player: ctx.myPlayer }); };
  const ns = root.querySelector("#newseason");
  if (ns) ns.onclick = () => { ns.disabled = true; ctx.send({ cmd: "career_newseason", player: ctx.myPlayer }); };
}
