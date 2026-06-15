// ApexWeb/src/ui/season.js — the paddock: standings + finances + sponsors + the upcoming-weekend
// gate (and the season-start title-sponsor choice / season-end verdict). Reads ctx.careerView +
// ctx.careerReadyView (set by main on host AND client). Inline styles keep it self-contained.
import { CALENDAR, constructorStandings, driverStandings, boardOutcome } from "../career.js";
import { objectiveLabel } from "../sponsors.js";
import { PARTS, PART_LABEL, PROJECT_SIZE, effectiveCar } from "../development.js";
import { availableDrivers, signCost, freeAgent } from "../market.js";
import { availableJuniors, SUPERLICENSE, SCOUT_FEE } from "../academy.js";
import { DRIVER_NAME } from "../drivers.js";
import { STAFF_ROLES, ROLE_LABEL, FACILITIES, FAC_LABEL, FAC_MAX, STAFF_UPGRADE_COST, FAC_UPGRADE_BASE, upkeep } from "../staff.js";
import { TEAM_LOGO, TEAMS } from "../data.js";
import { teamColor, driverAvatar, driverCard } from "./teamviz.js";
import { TRAITS } from "../team.js";

const row = (cells, hot) => `<tr style="${hot ? "font-weight:700;color:var(--good)" : ""}">${cells.map(c => `<td style="padding:3px 8px">${c}</td>`).join("")}</tr>`;

// D5: a driver's trait chips + a compact headline-attribute line for the Пилоты card.
const ATTR_SHOW = [["pace", "темп"], ["quali", "квал"], ["race_iq", "гонка"], ["tyre", "шины"], ["overtaking", "обгон"], ["wet", "дождь"]];
function driverDepth(d) {
  if (!d.attrs) return "";
  const chips = (d.traits || []).map(t => TRAITS[t] && TRAITS[t].label).filter(Boolean)
    .map(l => `<span style="font-size:10px;background:var(--good);color:#06121f;border-radius:4px;padding:1px 6px;margin-right:4px">${l}</span>`).join("");
  const attrs = ATTR_SHOW.map(([k, l]) => `${l} <b>${Math.round((d.attrs[k] ?? 0) * 100)}</b>`).join(" · ");
  return `${chips ? `<div style="margin-top:4px">${chips}</div>` : ""}<div class="label" style="margin-top:3px;font-size:11px">${attrs}</div>`;
}
const m$ = k => `$${(k / 1000).toFixed(2)}M`;

export function render(root, ctx) {
  const c = ctx.careerView;
  if (!c) { root.innerHTML = `<div class="panel"><p class="label">Загрузка карьеры…</p></div>`; return; }
  ctx._padTab = ctx._padTab || "overview";
  const emptyMsg = t => `<div class="panel"><p class="label">${t}</p></div>`;
  const cons = constructorStandings(c);
  const drv = driverStandings(c).slice(0, 10);
  const lr = c.lastResult;
  const me = cons.find(x => x.isPlayer);
  const ready = ctx.careerReadyView || { p1: false, p2: false };
  const meReady = !!ready[ctx.myPlayer];

  const consTbl = cons.map(r => row([r.pos,
    `<span style="display:inline-block;width:3px;height:14px;background:${teamColor(r.team)};border-radius:2px;vertical-align:middle;margin-right:7px"></span>`
    + `<img src="assets/teams/${TEAM_LOGO[r.team]}.png" style="height:16px;vertical-align:middle;margin-right:6px">${r.team}`, r.pts], r.isPlayer)).join("");
  const drvTbl = drv.map(r => row([r.pos,
    `${driverAvatar(r.abbrev, r.team, 22)} <b style="vertical-align:middle">${r.abbrev}</b>`, r.team, r.pts])).join("");
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

  // development panel (D3) — the player team's PARTS (level + per-part projects) + the composed car
  const myTeamName = me ? me.team : null;
  const baseCar = myTeamName ? (TEAMS.find(t => t.name === myTeamName) || {}).car : null;
  const parts = (c.parts && myTeamName) ? c.parts[myTeamName] : null;
  const eff = baseCar ? effectiveCar(baseCar, parts) : null;
  const partRow = (pk) => { const lvl = parts ? (parts[pk] || 0) : 0;
    return row([PART_LABEL[pk], `ур. ${(lvl * 100).toFixed(0)}`,
      c.project && c.project.part === pk ? `<span class="label">в разработке (${c.project.racesLeft})</span>`
      : Object.keys(PROJECT_SIZE).map(sz => `<button class="ready devbtn" data-k="${pk}" data-sz="${sz}" ${(c.project || c.money < PROJECT_SIZE[sz].cost) ? "disabled" : ""} style="padding:3px 6px;font-size:11px;margin-left:3px">${PROJECT_SIZE[sz].label} (${m$(PROJECT_SIZE[sz].cost)})</button>`).join("")]); };
  const carLine = eff ? `<p class="label">Машина: мотор ${eff.power.toFixed(3)} · аэро ${eff.aero.toFixed(3)} · шина ${eff.tyre.toFixed(3)} · эконом ${eff.fuel.toFixed(3)} · надёжн ${eff.rel.toFixed(3)}</p>` : "";
  const devPanel = baseCar ? `<div class="panel"><p class="label">Разработка — детали машины${c.costCap ? " · cost cap ВКЛ" : ""}</p>
    ${carLine}<table style="width:100%;border-collapse:collapse"><tbody>${PARTS.map(partRow).join("")}</tbody></table></div>` : "";

  // drivers panel — the player team's two drivers (age / overall / morale / contract / salary)
  const myTeamIdx = TEAMS.findIndex(t => t.name === myTeamName);
  const mine = c.drivers ? Object.entries(c.drivers).filter(([, d]) => d.teamIdx === myTeamIdx) : [];
  const driverCards = mine.map(([ab, d]) => driverCard(
    { team: myTeamName, abbrev: ab, name: DRIVER_NAME[ab] || ab },
    { car: true,
      sub: `${d.age} лет · ovr ${d.overall.toFixed(3)} · мораль ${Math.round(d.morale * 100)}% · ${d.contractSeasons} сез. · ${m$(d.salary)}/гонка`,
      action: `${driverDepth(d)}<div style="margin-top:6px"><button class="ready resign" data-ab="${ab}" style="padding:3px 8px;font-size:12px">Продлить</button></div>` }
  )).join("");
  const driversPanel = mine.length ? `<div class="panel"><p class="label">Пилоты</p><div style="display:flex;flex-direction:column;gap:8px">${driverCards}</div></div>` : "";

  // staff & facilities panel
  const st = c.staff;
  const staffPanel = st ? `<div class="panel"><p class="label">Команда · содержание ${m$(upkeep(st))}/гонка</p>
    <table style="width:100%;border-collapse:collapse">
    ${STAFF_ROLES.map(rk => row([ROLE_LABEL[rk], `${Math.round(st[rk] * 100)}`,
      `<button class="ready stf" data-kind="staff" data-key="${rk}" ${c.money < STAFF_UPGRADE_COST || st[rk] >= 0.99 ? "disabled" : ""} style="padding:3px 8px;font-size:12px">+ (${m$(STAFF_UPGRADE_COST)})</button>`])).join("")}
    ${FACILITIES.map(fk => { const lvl = st.facilities[fk]; const cost = FAC_UPGRADE_BASE * (lvl + 1);
      return row([FAC_LABEL[fk], `ур. ${lvl}/${FAC_MAX}`,
      `<button class="ready stf" data-kind="facility" data-key="${fk}" ${lvl >= FAC_MAX || c.money < cost ? "disabled" : ""} style="padding:3px 8px;font-size:12px">+ (${m$(cost)})</button>`]); }).join("")}
    </table></div>` : "";

  // transfer panel — top available drivers; swap one in for one of yours
  const mineAbbrevs = mine.map(([ab]) => ab);
  const avail = c.drivers ? availableDrivers(c).slice(0, 6) : [];
  const transferPanel = (mineAbbrevs.length && avail.length) ? `<div class="panel"><p class="label">Трансферы — подписать пилота (обмен)</p>
    <table style="width:100%;border-collapse:collapse">
    ${avail.map(d => row([`<b>${d.abbrev}</b> ${DRIVER_NAME[d.abbrev] || ""}${freeAgent(d) ? ` <span class="label">СА</span>` : ""}`, `ovr ${d.overall.toFixed(3)}`, `${d.age} л.`, m$(signCost(d)),
      mineAbbrevs.map(ab => `<button class="ready sign" data-in="${d.abbrev}" data-out="${ab}" ${c.money < signCost(d) ? "disabled" : ""} style="padding:3px 6px;font-size:11px;margin-left:4px">↔${ab}</button>`).join("")])).join("")}
    </table></div>` : "";

  // academy panel — your juniors (develop -> promote) + scouting from the pool
  const acad = c.academy || [];
  const scout = c.drivers ? availableJuniors(c).slice(0, 4) : [];
  const acadRows = acad.map(j => row([`<b>${j.abbrev}</b> ${j.name}`, `${j.age} л.`, `ovr ${j.overall.toFixed(3)}`, `пот. ${j.potential.toFixed(2)}`,
    j.overall >= SUPERLICENSE
      ? mineAbbrevs.map(ab => `<button class="ready promote" data-j="${j.abbrev}" data-out="${ab}" style="padding:3px 6px;font-size:11px;margin-left:4px">▲${ab}</button>`).join("")
      : `<span class="label">нужен ovr ${SUPERLICENSE}</span>`])).join("");
  const scoutRows = scout.map(j => row([`<b>${j.abbrev}</b> ${j.name}`, `${j.age} л.`, `ovr ${j.overall.toFixed(3)}`, `пот. ${j.potential.toFixed(2)}`,
    `<button class="ready scout" data-j="${j.abbrev}" ${c.money < SCOUT_FEE ? "disabled" : ""} style="padding:3px 8px;font-size:11px">Подписать (${m$(SCOUT_FEE)})</button>`])).join("");
  const academyPanel = c.drivers ? `<div class="panel"><p class="label">Академия</p>
    ${acad.length ? `<table style="width:100%;border-collapse:collapse"><tbody>${acadRows}</tbody></table>` : `<p class="label">нет юниоров</p>`}
    <div style="height:6px"></div><p class="label">Скаутинг</p>
    <table style="width:100%;border-collapse:collapse"><tbody>${scoutRows}</tbody></table></div>` : "";

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
    const champD = drv[0], champC = cons[0];
    footer = `<div class="panel"><h3>Сезон ${c.season} завершён</h3>
      <p class="label">Цель: не ниже P${bo.target} · доверие совета ${Math.round(bo.confidence * 100)}%</p>
      <p style="font-size:18px;font-weight:700;color:${bo.met ? "var(--good)" : "var(--bad)"}">${bo.met ? "✅ Цель выполнена" : (bo.sacked ? "❌ Совет уволил вас" : "❌ Цель не выполнена")} — итог P${bo.finalPos}</p>
      <p class="label">🏆 Чемпион: ${champD ? champD.abbrev : "-"} · Кубок конструкторов: ${champC ? champC.team : "-"}</p>
      <button class="primary" id="newseason">${bo.sacked ? "Начать заново ▶" : "Новый сезон ▶"}</button></div>`;
  } else {
    const nextR = CALENDAR[c.round];
    const blocked = !!(c.pendingOffers && c.pendingOffers.length);
    footer = `<div class="panel"><p class="label">Следующий этап · раунд ${c.round + 1} из ${CALENDAR.length}</p>
      <h3>${nextR.name}</h3>
      <button class="primary" id="startwknd" ${blocked ? "disabled" : ""}>${meReady ? "Готов ✓ — ждём напарника…" : "Начать уикенд ▶"}</button>
      ${blocked ? `<p class="label">Сначала выбери спонсора.</p>` : ""}</div>`;
  }

  const headerPanel = `<div class="panel"><h2>Сезон ${c.season} · ${me ? me.team : ""} (P${me ? me.pos : "-"})</h2>
      <p class="label">Доверие совета: ${Math.round((c.board && c.board.confidence != null ? c.board.confidence : 0.5) * 100)}% · цель P${c.board ? c.board.targetPos : "-"}</p>
      ${lr ? `<p class="label">${lr.gp}: ${podium}</p>` : ""}</div>`;
  const newsPanel = (c.news && c.news.length) ? `<div class="panel"><p class="label">📰 Новости</p>${c.news.slice(0, 8).map(n => `<p class="label" style="margin:2px 0">• ${n}</p>`).join("")}</div>` : "";
  const financeTab = `<div style="display:flex;gap:12px;flex-wrap:wrap">${finances}${spons}</div>`;
  const standingsTab = `<div style="display:flex;gap:12px;flex-wrap:wrap">
      <div class="panel" style="flex:1;min-width:240px"><p class="label">Кубок конструкторов</p>
        <table style="width:100%;border-collapse:collapse"><tbody>${consTbl}</tbody></table></div>
      <div class="panel" style="flex:1;min-width:240px"><p class="label">Личный зачёт (топ-10)</p>
        <table style="width:100%;border-collapse:collapse"><tbody>${drvTbl}</tbody></table></div>
    </div>`;
  const TABS = [["overview", "Обзор"], ["finance", "Финансы"], ["car", "Машина"], ["drivers", "Пилоты"], ["staff", "Команда"], ["transfers", "Трансферы"], ["academy", "Академия"], ["standings", "Зачёт"]];
  const TAB_CONTENT = {
    overview:  headerPanel + newsPanel + offers,
    finance:   financeTab,
    car:       devPanel || emptyMsg("Нет данных по машине"),
    drivers:   driversPanel || emptyMsg("Нет пилотов"),
    staff:     staffPanel || emptyMsg("Нет данных по команде"),
    transfers: transferPanel || emptyMsg("Нет доступных трансферов"),
    academy:   academyPanel || emptyMsg("Академия недоступна"),
    standings: standingsTab,
  };
  const tabBar = `<div class="pad-tabs">${TABS.map(([k, l]) => `<button class="pad-tab${k === ctx._padTab ? " on" : ""}" data-tab="${k}">${l}</button>`).join("")}</div>`;
  root.innerHTML = tabBar + `<div id="pad-content">${TAB_CONTENT[ctx._padTab] || TAB_CONTENT.overview}</div>` + `<div class="pad-foot">${footer}</div>`;
  root.querySelectorAll(".pad-tab").forEach(b => b.onclick = () => { ctx._padTab = b.dataset.tab; render(root, ctx); });

  root.querySelectorAll("button.offer").forEach(b => b.onclick = () => { root.querySelectorAll("button.offer").forEach(x => x.disabled = true); ctx.send({ cmd: "career_sponsor", player: ctx.myPlayer, offerIdx: +b.dataset.i }); });
  root.querySelectorAll("button.devbtn").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_project", player: ctx.myPlayer, part: b.dataset.k, size: b.dataset.sz }); });
  root.querySelectorAll("button.resign").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_resign", player: ctx.myPlayer, abbrev: b.dataset.ab }); });
  root.querySelectorAll("button.stf").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_upgrade", player: ctx.myPlayer, kind: b.dataset.kind, key: b.dataset.key }); });
  root.querySelectorAll("button.sign").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_sign", player: ctx.myPlayer, inAbbrev: b.dataset.in, outAbbrev: b.dataset.out }); });
  root.querySelectorAll("button.scout").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_scout", player: ctx.myPlayer, abbrev: b.dataset.j }); });
  root.querySelectorAll("button.promote").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_promote", player: ctx.myPlayer, abbrev: b.dataset.j, outAbbrev: b.dataset.out }); });
  const sw = root.querySelector("#startwknd");
  if (sw) sw.onclick = () => { sw.disabled = true; ctx.send({ cmd: "career_start_weekend", player: ctx.myPlayer }); };
  const ns = root.querySelector("#newseason");
  if (ns) ns.onclick = () => { ns.disabled = true; ctx.send({ cmd: "career_newseason", player: ctx.myPlayer }); };
}
