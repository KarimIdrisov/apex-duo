// ApexWeb/src/ui/season.js — the paddock: standings + finances + sponsors + the upcoming-weekend
// gate (and the season-start title-sponsor choice / season-end verdict). Reads ctx.careerView +
// ctx.careerReadyView (set by main on host AND client). Inline styles keep it self-contained.
import { CALENDAR, constructorStandings, driverStandings, boardOutcome, RUNNING_COST, CAP_LIMIT, LOAN_RACES, LOAN_INTEREST, constructorPrizeFund } from "../career.js";
import { fmtDate, fmtDateShort, gapDays, gapLabel, offseasonDays, SPRINTS } from "../season_dates.js";
import { evaluateObjectives, regArcNote } from "../board.js";
import { objectiveLabel } from "../sponsors.js";
import { PARTS, PART_LABEL, PROJECT_SIZE, effectiveCar, effectiveCarPU, PU_PARTS, PU_LABEL, PU_PROGRAM, SUPPLY_INCOME, SUPPLY_FEE, APPROACH, maxProjects, PART_CEILING, CONCEPT, aiConcept } from "../development.js";
import { availableDrivers, signCost, freeAgent, interest, signCostAt, buyout, rivalInterest } from "../market.js";
import { availableJuniors, SUPERLICENSE, SCOUT_FEE, SL_NEEDED } from "../academy.js";
import { DRIVER_NAME, TRAINING, moraleReason } from "../drivers.js";
import { STAFF_ROLES, ROLE_LABEL, FACILITIES, FAC_LABEL, FAC_MAX, STAFF_UPGRADE_COST, FAC_UPGRADE_BASE, upkeep, staffMarket, SPECIALTIES, salaryForStaff, composePersonnel, devMult, staffSalaries, staffMarketAll, staffHireFee } from "../staff.js";
import { TEAM_LOGO, TEAMS, DRIVER_INFO } from "../data.js";
import { backerLabel } from "../backers.js";
import { teamColor, teamInk, driverAvatar, driverCard, personTipAttrs, staffTipAttrs, attachPersonTips, ATTR_RU } from "./teamviz.js";
import { TRAITS, ATTR_KEYS, ATTR_PEAK, attrDrift } from "../team.js";

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
// dashboard helpers (Обзор)
const barEl = (pct, col, h = 6) => `<div style="height:${h}px;background:rgba(255,255,255,.1);border-radius:${h / 2}px;margin-top:6px;overflow:hidden"><div style="height:100%;width:${Math.max(0, Math.min(100, pct))}%;background:${col};border-radius:${h / 2}px"></div></div>`;
const kpiCard = (label, value, extra = "") => `<div style="background:var(--content2);border-radius:var(--r-md);padding:12px 14px"><div style="font-size:12px;color:var(--muted)">${label}</div><div style="font-size:22px;font-weight:800;line-height:1.15;margin-top:2px">${value}</div>${extra}</div>`;
const confColor = v => v >= 0.6 ? "var(--good)" : v >= 0.35 ? "#e0a92a" : "var(--bad)";
const miniBar = (label, v) => `<div style="margin:4px 0"><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted)"><span>${label}</span><span>${Math.round((v || 0) * 100)}</span></div>${barEl((v || 0) * 100, "var(--accent)", 5)}</div>`;

// which round a project with `daysLeft` will be ready for, walking the calendar gaps from the current round.
function devReadyRound(c, daysLeft) {
  let rem = daysLeft, r = c.round;
  while (r < CALENDAR.length) { const g = gapDays(c.season, r); if (g == null) return null; rem -= g; if (rem <= 0) return r + 1; r++; }
  return null;   // not before season end → lands over the winter
}
function devTotalLeft(p) { return p ? Math.max(0, p.daysLeft || 0) : 0; }
// "≈14 дн → к «Австралии»" — days remaining + which GP the upgrade lands for.
function devEta(c, proj) {
  if (!proj) return "в разработке";
  const ready = devReadyRound(c, devTotalLeft(proj));
  const to = (ready != null && CALENDAR[ready]) ? `к «${CALENDAR[ready].name.replace("Гран-при ", "")}»` : "к зим. тестам";
  return `≈${Math.max(1, Math.round(proj.daysLeft || 0))} дн → ${to}`;
}

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

  const conceptTag = (team, isPlayer) => { const k = isPlayer ? (c.concept || "balanced") : aiConcept(team);
    const short = k === "downforce" ? "приж" : k === "power" ? "мощн" : "сбал", col = k === "downforce" ? "#5aa9ff" : k === "power" ? "#ff6b6b" : "var(--muted)";
    return `<span title="${(CONCEPT[k] || {}).label || ""}" style="font-size:10px;color:${col};border:1px solid ${col};border-radius:4px;padding:0 5px">${short}</span>`; };
  const consTbl = cons.map(r => row([r.pos,
    `<span style="display:inline-block;width:3px;height:14px;background:${teamColor(r.team)};border-radius:2px;vertical-align:middle;margin-right:7px"></span>`
    + `<img src="assets/teams/${TEAM_LOGO[r.team]}.png" style="height:16px;vertical-align:middle;margin-right:6px">${r.team}`, conceptTag(r.team, r.isPlayer), r.pts], r.isPlayer)).join("");
  const drvTbl = drv.map(r => { const dd = (c.drivers && c.drivers[r.abbrev]) || {};
    const tip = dd.overall != null ? personTipAttrs({ abbrev: r.abbrev, overall: dd.overall, team: r.team, name: DRIVER_NAME[r.abbrev] || r.abbrev, age: dd.age }) : "";
    return row([r.pos,
      `<span ${tip} style="cursor:default">${driverAvatar(r.abbrev, r.team, 22)} <b style="vertical-align:middle">${r.abbrev}</b></span>`, r.team, r.pts]);
  }).join("");
  const podium = lr ? lr.podium.map((a, i) => `${["🥇", "🥈", "🥉"][i]} ${a}`).join("  ") : "";

  // ---- Финансы dashboard ----
  const hist = c.history || [];
  const sumBy = k => hist.reduce((a, s) => a + (s[k] || 0), 0);
  const seasonIncome = sumBy("prize") + sumBy("sponsorIncome");
  const seasonExpense = sumBy("runningCost") + sumBy("salaries") + sumBy("upkeep") + sumBy("loanPay");
  const seasonNet = seasonIncome - seasonExpense;
  const myIdxF = TEAMS.findIndex(t => me && t.name === me.team);
  const salariesPerRace = c.drivers ? Object.values(c.drivers).filter(d => d.teamIdx === myIdxF).reduce((a, d) => a + (d.salary || 0), 0) : 0;
  const upkF = c.staff ? upkeep(c.staff) : 0;
  const loanPerRace = c.loan ? c.loan.perRace : 0;
  const fixedExpense = RUNNING_COST + salariesPerRace + upkF + loanPerRace;
  const lastNetF = lr ? `${lr.net >= 0 ? "+" : "−"}${m$(Math.abs(lr.net))} прошлый этап` : "старт сезона";
  const potentialFund = me ? constructorPrizeFund(me.pos) : 0;
  const finHero = `<div class="panel"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">
      ${kpiCard("Бюджет", m$(c.money), `<div style="font-size:11px;color:var(--muted);margin-top:4px">${lastNetF}</div>`)}
      ${kpiCard("Чистыми за сезон", `<span style="color:${seasonNet >= 0 ? "var(--good)" : "var(--bad)"}">${seasonNet >= 0 ? "+" : "−"}${m$(Math.abs(seasonNet))}</span>`, `<div style="font-size:11px;color:var(--muted);margin-top:4px">доход ${m$(seasonIncome)} · расход ${m$(seasonExpense)}</div>`)}
      ${kpiCard("Расходы / этап", m$(fixedExpense), `<div style="font-size:11px;color:var(--muted);margin-top:4px">операц.+зарплаты+персонал${loanPerRace ? "+кредит" : ""}</div>`)}
      ${kpiCard(`Призовой фонд (P${me ? me.pos : "-"})`, m$(potentialFund), `<div style="font-size:11px;color:var(--muted);margin-top:4px">выплата в конце сезона</div>`)}
    </div></div>`;
  const moneyPts = hist.map(s => s.money).filter(v => typeof v === "number");
  const chartBody = moneyPts.length >= 2 ? (() => {
    const w = 100, h = 36, mn = Math.min(...moneyPts), mx = Math.max(...moneyPts), rg = (mx - mn) || 1;
    const d = moneyPts.map((v, i) => `${i ? "L" : "M"}${((i / (moneyPts.length - 1)) * w).toFixed(1)} ${(h - ((v - mn) / rg) * h).toFixed(1)}`).join(" ");
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:64px;display:block"><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted)"><span>${m$(mn)}</span><span>${m$(mx)}</span></div>`;
  })() : `<p class="label">График наполнится за несколько этапов сезона.</p>`;
  const budgetChart = `<div class="panel" style="flex:1;min-width:260px"><p class="label">Бюджет по сезону</p>${chartBody}</div>`;
  const incMax = Math.max(1, sumBy("prize"), sumBy("sponsorIncome"), sumBy("grant"));
  const expMax = Math.max(1, sumBy("runningCost"), sumBy("salaries"), sumBy("upkeep"), sumBy("loanPay"));
  const brk = (label, val, max, col) => `<div style="margin:5px 0"><div style="display:flex;justify-content:space-between;font-size:12px"><span style="color:var(--muted)">${label}</span><span>${m$(val)}</span></div>${barEl(val / max * 100, col, 7)}</div>`;
  const breakdown = `<div class="panel" style="flex:1;min-width:260px"><p class="label">Доходы / расходы за сезон</p>
    ${brk("Призовые", sumBy("prize"), incMax, "var(--good)")}${brk("Спонсоры", sumBy("sponsorIncome"), incMax, "var(--good)")}${sumBy("grant") > 0 ? brk("Грант бекера", sumBy("grant"), incMax, "var(--good)") : ""}
    <div style="height:8px"></div>
    ${brk("Операционка", sumBy("runningCost"), expMax, "var(--bad)")}${brk("Зарплаты", sumBy("salaries"), expMax, "var(--bad)")}${brk("Персонал", sumBy("upkeep"), expMax, "var(--bad)")}${sumBy("loanPay") > 0 ? brk("Кредит", sumBy("loanPay"), expMax, "var(--bad)") : ""}</div>`;
  const capPct = Math.min(100, (c.capSpent || 0) / CAP_LIMIT * 100);
  const capCol = (c.capSpent || 0) > CAP_LIMIT ? "var(--bad)" : capPct > 80 ? "#e0a92a" : "var(--good)";
  const capMeter = `<div class="panel"><p class="label">Кост-кап сезона</p>
    <div style="display:flex;justify-content:space-between;font-size:13px"><span>Потрачено ${m$(c.capSpent || 0)}</span><span style="color:var(--muted)">лимит ${m$(CAP_LIMIT)}</span></div>
    ${barEl(capPct, capCol, 8)}
    <p class="label" style="margin-top:6px;opacity:.75">${(c.capSpent || 0) > CAP_LIMIT ? `Перерасход ${m$((c.capSpent || 0) - CAP_LIMIT)} — штраф и −доверие в конце сезона` : "Разработка + персонал + трансферы. Перерасход штрафуется в конце сезона."}</p></div>`;
  const LOAN_OPTS = [2000, 4000, 6000];
  const loanPanel = c.loan
    ? `<div class="panel"><p class="label">Кредит</p>
        <div style="display:flex;justify-content:space-between;font-size:13px"><span>Осталось вернуть</span><span style="font-weight:700">${m$(c.loan.remaining)}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--muted)">Списание/этап</span><span>${m$(c.loan.perRace)}</span></div>
        ${barEl((1 - c.loan.remaining / c.loan.total) * 100, "var(--accent)", 7)}</div>`
    : `<div class="panel"><p class="label">Кредит — деньги сейчас, возврат с процентами за ${LOAN_RACES} этапов</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${LOAN_OPTS.map(a => `<button class="ready loanbtn" data-amt="${a}" style="flex:1;min-width:120px;padding:8px"><b>Взять ${m$(a)}</b><br><span style="font-size:11px;color:rgba(6,18,31,.78)">вернуть ${m$(Math.round(a * (1 + LOAN_INTEREST)))}</span></button>`).join("")}</div></div>`;
  const sponsorCard = s => { const hp = Math.round(s.happiness * 100), risk = s.happiness < 0.3;
    const hc = s.happiness >= 0.6 ? "var(--good)" : s.happiness >= 0.3 ? "#e0a92a" : "var(--bad)";
    return `<div style="background:var(--content2);border-radius:var(--r-md);padding:10px 12px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center"><span style="font-weight:700">${s.kind === "title" ? "★ " : ""}${s.name}${risk ? ` <span style="color:var(--bad);font-size:11px;font-weight:700">под угрозой</span>` : ""}</span><span style="font-size:12px;color:var(--muted)">${objectiveLabel(s.objective)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-top:2px"><span>довольство ${hp}%</span><span>ретейнер ${m$(s.retainer)} · бонус ${m$(s.bonus)}</span></div>
      ${barEl(hp, hc, 6)}</div>`; };
  const offerCard = c.sponsorOffer ? `<div style="border:2px solid var(--accent);border-radius:var(--r-md);padding:10px 12px;margin-top:6px">
      <div style="display:flex;justify-content:space-between"><span style="font-weight:700">Новое предложение: ${c.sponsorOffer.name}</span><span style="font-size:12px;color:var(--muted)">${objectiveLabel(c.sponsorOffer.objective)}</span></div>
      <div style="font-size:12px;color:var(--muted);margin:4px 0">ретейнер ${m$(c.sponsorOffer.retainer)} · бонус ${m$(c.sponsorOffer.bonus)}</div>
      <button class="ready signsponsor" style="padding:6px 12px">Подписать спонсора</button></div>` : "";
  const sponsorsPanel = `<div class="panel" style="flex:1;min-width:260px"><p class="label">Спонсоры (${(c.sponsors || []).length}/3)</p>${(c.sponsors || []).map(sponsorCard).join("")}${offerCard}</div>`;
  const bk = c.backer || {};
  const backerPanel = `<div class="panel"><p class="label">Финансирование команды</p>
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span style="font-weight:800;font-size:16px;color:${bk.type === "works" ? "var(--good)" : "var(--ink)"}">${backerLabel(bk)}</span>
      <span style="font-size:12px;color:var(--muted)">${bk.puMaker ? "★ свой ДВС" : `ДВС: ${bk.supplier || "клиентский"}`}</span></div>
    <div style="display:flex;justify-content:space-between;font-size:13px;margin-top:6px"><span style="color:var(--muted)">Годовой грант</span><span style="font-weight:700">${m$(bk.grant || 0)}/сезон</span></div>
    <p class="label" style="margin-top:6px;opacity:.75">${bk.type === "works" ? "Концерн финансирует команду" + (bk.puMaker ? " и разрабатывает ДВС (вне кост-капа)." : ".") : "Независимая: живёт на призовые + спонсоры + грант владельца."}</p></div>`;
  const financeTab = finHero
    + `<div style="display:flex;gap:12px;flex-wrap:wrap">${budgetChart}${breakdown}</div>`
    + `<div style="display:flex;gap:12px;flex-wrap:wrap">${sponsorsPanel}<div style="flex:1;min-width:260px;display:flex;flex-direction:column;gap:12px">${backerPanel}${capMeter}${loanPanel}</div></div>`;

  // development panel (D3) — the player team's PARTS (level + per-part projects) + the composed car
  const myTeamName = me ? me.team : null;
  const baseCar = myTeamName ? (TEAMS.find(t => t.name === myTeamName) || {}).car : null;
  const parts = (c.parts && myTeamName) ? c.parts[myTeamName] : null;
  const eff = baseCar ? effectiveCarPU(baseCar, parts, c.puParts) : null;
  // ===== Машина tab: inner sub-tabs (Шасси / ДВС / Стратегия) + compact shared controls =====
  const carTab = ctx._carTab || "chassis";
  const devSize = ctx._devSize || "medium", devApproach = ctx._devApproach || "balanced";
  const projOn = (pk) => (c.projects || []).find(p => p.part === pk);
  const slotsUsed = (c.projects || []).length, slotsMax = maxProjects(c);
  const pu = c.puParts || {}, bkr = c.backer || {};
  // compact car-performance bars (one mini-bar per indicator)
  const STAT = [["power", "Мотор"], ["aero", "Аэро"], ["tyre", "Шина"], ["fuel", "Эконом"], ["rel", "Надёжн"]];
  const statPct = (k, v) => { const lo = 0.3, hi = k === "rel" ? 0.995 : 1.2; return Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100)); };
  const statBars = eff ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin:2px 0 14px">${STAT.map(([k, l]) => `<div><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted)"><span>${l}</span><span style="color:var(--ink);font-weight:700">${(eff[k]).toFixed(2)}</span></div>${barEl(statPct(k, eff[k]), "var(--accent)", 5)}</div>`).join("")}</div>` : "";
  // shared "new upgrade" selectors: size + approach
  const seg = (active, label, cls, data, sub) => `<button class="${cls}" ${data} style="flex:1;padding:6px 4px;border-radius:7px;border:1px solid ${active ? "var(--accent)" : "var(--border)"};background:${active ? "var(--accent)" : "transparent"};color:${active ? "#fff" : "var(--ink)"};font-size:11px;font-weight:600;line-height:1.25">${label}${sub ? `<br><span style="font-size:9px;opacity:.85;font-weight:400">${sub}</span>` : ""}</button>`;
  const sizeSeg = `<div style="display:flex;gap:5px">${Object.entries(PROJECT_SIZE).map(([k, s]) => seg(k === devSize, s.label, "devsize", `data-sz="${k}"`, `${m$(s.cost)} · ${s.days}д`)).join("")}</div>`;
  const apSeg = `<div style="display:flex;gap:5px">${Object.entries(APPROACH).map(([k, a]) => seg(k === devApproach, a.label, "devapproach", `data-ap="${k}"`, a.hint)).join("")}</div>`;
  // a single develop button (or active-project ETA) per row
  const devBtn = (cls, data, can) => `<button class="${cls}" ${data} ${can ? "" : "disabled"} style="padding:5px 14px;border-radius:7px;background:${can ? "var(--good)" : "var(--content2)"};color:${can ? "#04190d" : "var(--muted)"};font-weight:700;font-size:12px">Развивать</button>`;
  const partRow = (pk) => { const lvl = parts ? (parts[pk] || 0) : 0; const pj = projOn(pk);
    const mat = Math.min(100, lvl / PART_CEILING * 100), spec = PROJECT_SIZE[devSize];
    const can = !pj && slotsUsed < slotsMax && c.money >= spec.cost;
    const action = pj ? `<span style="font-size:11px;color:var(--accent);font-weight:600">${devEta(c, pj)}</span>`
      : devBtn("devbtn", `data-k="${pk}" data-sz="${devSize}" data-ap="${devApproach}"`, can);
    return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid var(--border)">
        <div style="flex:1;min-width:0"><div style="display:flex;justify-content:space-between;font-size:13px"><span style="font-weight:600">${PART_LABEL[pk]}</span><span style="color:var(--muted);font-size:11px">ур.${(lvl * 100).toFixed(0)} · зрел.${mat.toFixed(0)}%</span></div>${barEl(mat, "var(--muted)", 4)}</div>
        <div style="flex:none;width:165px;text-align:right">${action}</div></div>`; };
  const unprovenLine = (c.unproven || []).length ? `<p class="label" style="color:#e0a92a;margin:10px 0 0">⚠ Необкатанные: ${(c.unproven || []).map(u => `${PART_LABEL[u.part]} (${u.racesLeft})`).join(", ")} — риск отказа в гонке</p>` : "";
  const chassisView = baseCar ? `<div class="panel">${statBars}
   