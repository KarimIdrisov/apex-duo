// ApexWeb/src/ui/season.js — the paddock: standings + finances + sponsors + the upcoming-weekend
// gate (and the season-start title-sponsor choice / season-end verdict). Reads ctx.careerView +
// ctx.careerReadyView (set by main on host AND client). Inline styles keep it self-contained.
import { CALENDAR, constructorStandings, driverStandings, boardOutcome } from "../career.js";
import { objectiveLabel } from "../sponsors.js";
import { TEAM_LOGO } from "../data.js";

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
    ${offers}
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <div class="panel" style="flex:1;min-width:240px"><p class="label">Кубок конструкторов</p>
        <table style="width:100%;border-collapse:collapse"><tbody>${consTbl}</tbody></table></div>
      <div class="panel" style="flex:1;min-width:240px"><p class="label">Личный зачёт (топ-10)</p>
        <table style="width:100%;border-collapse:collapse"><tbody>${drvTbl}</tbody></table></div>
    </div>
    ${footer}`;

  root.querySelectorAll("button.offer").forEach(b => b.onclick = () => { root.querySelectorAll("button.offer").forEach(x => x.disabled = true); ctx.send({ cmd: "career_sponsor", player: ctx.myPlayer, offerIdx: +b.dataset.i }); });
  const sw = root.querySelector("#startwknd");
  if (sw) sw.onclick = () => { sw.disabled = true; ctx.send({ cmd: "career_start_weekend", player: ctx.myPlayer }); };
  const ns = root.querySelector("#newseason");
  if (ns) ns.onclick = () => { ns.disabled = true; ctx.send({ cmd: "career_newseason", player: ctx.myPlayer }); };
}
