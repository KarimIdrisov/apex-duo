// ApexWeb/src/ui/season.js — the paddock: standings + finances + sponsors + the upcoming-weekend
// gate (and the season-start title-sponsor choice / season-end verdict). Reads ctx.careerView +
// ctx.careerReadyView (set by main on host AND client). Inline styles keep it self-contained.
import { CALENDAR, constructorStandings, driverStandings, boardOutcome, RUNNING_COST, CAP_LIMIT, LOAN_RACES, LOAN_INTEREST, constructorPrizeFund, teamAppeal, expectedFinish, BOARD_FUNDS } from "../career.js";
import { fmtDate, fmtDateShort, gapDays, gapLabel, offseasonDays, SPRINTS } from "../season_dates.js";
import { evaluateObjectives, regArcNote } from "../board.js";
import { objectiveLabel } from "../sponsors.js";
import { PARTS, PART_LABEL, PROJECT_SIZE, effectiveCar, effectiveCarPU, PU_PARTS, PU_LABEL, PU_PROGRAM, SUPPLY_INCOME, SUPPLY_FEE, APPROACH, maxProjects, PART_CEILING, CONCEPT, aiConcept,
  forecastRange, regressedParts, puTokensLeft, PU_TOKEN_COST, PU_TOKENS_PER_SEASON, eraNote, PU_SUPPLY_SPEC,
  DEV_AREAS, INTENSITY, bestPartForArea, fieldAvg, knownTier, KNOWN_TIERS } from "../development.js";
import { availableDrivers, signCost, freeAgent, interest, signCostAt, buyout, rivalInterest, CLAUSE, negLocked, negStrikes, NEG } from "../market.js";
import { availableJuniors, scoutBand, scoutOf, signCostJunior, programTier, programSlots, programDevRate,
  upgradeCost, TIER_MAX, TIER_LABEL, superlicensePts, eligible, SL_GATE, SERIES, SERIES_LABEL, SERIES_UP,
  ARCHETYPE, loanTeams, SCOUT_STEP_FEE, EXTEND_FEE, extendCost, LOAN_FEE, JUNIOR_POOL, PERSONA, rivalCourting } from "../academy.js";
import { DRIVER_NAME, TRAINING, moraleReason, ageTrend } from "../drivers.js";
import { STAFF_ROLES, ROLE_LABEL, FACILITIES, FAC_LABEL, FAC_MAX, STAFF_UPGRADE_COST, FAC_UPGRADE_BASE, upkeep, staffMarket, SPECIALTIES, salaryForStaff, composePersonnel, devMult, staffSalaries, staffMarketAll, staffHireFee, facPrereqMet, FAC_PREREQ } from "../staff.js";
import { TEAM_LOGO, TEAMS, DRIVER_INFO } from "../data.js";
import { composePitCrew, effSkill, PIT_ROLES, ROLE_LABEL as PIT_ROLE_LABEL, pitCrewMarket, PRACTICE_FEE, RECRUIT_FEE } from "../pitcrew.js";
import { bcard, bchip, bbar, meterRow, bkpi, bkpiStrip, fatigueCol } from "./kit.js";
import { backerLabel } from "../backers.js";
import { teamColor, teamInk, driverAvatar, driverCard, personTipAttrs, juniorTipAttrs, staffTipAttrs, attachPersonTips, ATTR_RU, attrRadar } from "./teamviz.js";
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
const confColor = v => v >= 0.6 ? "var(--good)" : v >= 0.35 ? "var(--warn)" : "var(--bad)";
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
  if (!c) { root.innerHTML = `<div class="bcard" style="--spine:var(--bc)"><p class="bcard-title">Загрузка карьеры…</p></div>`; return; }
  ctx._padTab = ctx._padTab || "overview";
  const emptyMsg = t => `<div class="bcard" style="--spine:var(--bc)"><p class="bcard-title">${t}</p></div>`;
  const cons = constructorStandings(c);
  const drv = driverStandings(c).slice(0, 10);
  const lr = c.lastResult;
  const me = cons.find(x => x.isPlayer);
  const ready = ctx.careerReadyView || { p1: false, p2: false };
  const meReady = !!ready[ctx.myPlayer];

  const conceptTag = (team, isPlayer) => { const k = isPlayer ? (c.concept || "balanced") : aiConcept(team);
    const short = k === "downforce" ? "приж" : k === "power" ? "мощн" : "сбал", col = k === "downforce" ? "var(--info)" : k === "power" ? "#ff6b6b" : "var(--muted)";
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
  const finHero = `<div class="bcard" style="--spine:var(--bc)"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">
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
  const budgetChart = `<div class="bcard" style="--spine:var(--bc);flex:1;min-width:260px"><p class="bcard-title">Бюджет по сезону</p>${chartBody}</div>`;
  const incMax = Math.max(1, sumBy("prize"), sumBy("sponsorIncome"), sumBy("grant"));
  const expMax = Math.max(1, sumBy("runningCost"), sumBy("salaries"), sumBy("upkeep"), sumBy("loanPay"));
  const brk = (label, val, max, col) => `<div style="margin:5px 0"><div style="display:flex;justify-content:space-between;font-size:12px"><span style="color:var(--muted)">${label}</span><span>${m$(val)}</span></div>${barEl(val / max * 100, col, 7)}</div>`;
  const breakdown = `<div class="bcard" style="--spine:var(--bc);flex:1;min-width:260px"><p class="bcard-title">Доходы / расходы за сезон</p>
    ${brk("Призовые", sumBy("prize"), incMax, "var(--good)")}${brk("Спонсоры", sumBy("sponsorIncome"), incMax, "var(--good)")}${sumBy("grant") > 0 ? brk("Грант бекера", sumBy("grant"), incMax, "var(--good)") : ""}
    <div style="height:8px"></div>
    ${brk("Операционка", sumBy("runningCost"), expMax, "var(--bad)")}${brk("Зарплаты", sumBy("salaries"), expMax, "var(--bad)")}${brk("Персонал", sumBy("upkeep"), expMax, "var(--bad)")}${sumBy("loanPay") > 0 ? brk("Кредит", sumBy("loanPay"), expMax, "var(--bad)") : ""}</div>`;
  const capPct = Math.min(100, (c.capSpent || 0) / CAP_LIMIT * 100);
  const capCol = (c.capSpent || 0) > CAP_LIMIT ? "var(--bad)" : capPct > 80 ? "var(--warn)" : "var(--good)";
  const capMeter = `<div class="bcard" style="--spine:var(--bc)"><p class="bcard-title">Кост-кап сезона</p>
    <div style="display:flex;justify-content:space-between;font-size:13px"><span>Потрачено ${m$(c.capSpent || 0)}</span><span style="color:var(--muted)">лимит ${m$(CAP_LIMIT)}</span></div>
    ${barEl(capPct, capCol, 8)}
    <p class="label" style="margin-top:6px;opacity:.75">${(c.capSpent || 0) > CAP_LIMIT ? `Перерасход ${m$((c.capSpent || 0) - CAP_LIMIT)} — штраф и −доверие в конце сезона` : "Разработка + персонал + трансферы. Перерасход штрафуется в конце сезона."}</p></div>`;
  const LOAN_OPTS = [2000, 4000, 6000];
  const loanPanel = c.loan
    ? `<div class="bcard" style="--spine:var(--bc)"><p class="bcard-title">Кредит</p>
        <div style="display:flex;justify-content:space-between;font-size:13px"><span>Осталось вернуть</span><span style="font-weight:700">${m$(c.loan.remaining)}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--muted)">Списание/этап</span><span>${m$(c.loan.perRace)}</span></div>
        ${barEl((1 - c.loan.remaining / c.loan.total) * 100, "var(--accent)", 7)}</div>`
    : `<div class="bcard" style="--spine:var(--bc)"><p class="bcard-title">Кредит — деньги сейчас, возврат с процентами за ${LOAN_RACES} этапов</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${LOAN_OPTS.map(a => `<button class="ready loanbtn" data-amt="${a}" style="flex:1;min-width:120px;padding:8px"><b>Взять ${m$(a)}</b><br><span style="font-size:11px;color:rgba(6,18,31,.78)">вернуть ${m$(Math.round(a * (1 + LOAN_INTEREST)))}</span></button>`).join("")}</div></div>`;
  // §Phase-6: request funds from the board — cash now, no repayment, but board confidence drops; once per season.
  const fundsPanel = c.boardFundsUsed
    ? `<div class="bcard" style="--spine:var(--bc)"><p class="bcard-title">Средства от совета</p><p class="label" style="margin:0;opacity:.65">в этом сезоне уже запрошены</p></div>`
    : `<div class="bcard" style="--spine:var(--bc)"><p class="bcard-title">Средства от совета — деньги сразу, без возврата, но падает доверие</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${[2000, 4000].map(a => `<button class="ready fundsbtn" data-amt="${a}" style="flex:1;min-width:120px;padding:8px"><b>Запросить ${m$(a)}</b><br><span style="font-size:11px;color:rgba(6,18,31,.78)">−${Math.round(BOARD_FUNDS.confPer1M * (a / 1000) * 100)}% доверия совета</span></button>`).join("")}</div></div>`;
  const sponsorCard = s => { const hp = Math.round(s.happiness * 100), risk = s.happiness < 0.3;
    const hc = s.happiness >= 0.6 ? "var(--good)" : s.happiness >= 0.3 ? "var(--warn)" : "var(--bad)";
    return `<div style="background:var(--content2);border-radius:var(--r-md);padding:10px 12px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center"><span style="font-weight:700">${s.kind === "title" ? "★ " : ""}${s.name}${risk ? ` <span style="color:var(--bad);font-size:11px;font-weight:700">под угрозой</span>` : ""}</span><span style="font-size:12px;color:var(--muted)">${objectiveLabel(s.objective)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-top:2px"><span>довольство ${hp}%</span><span>ретейнер ${m$(s.retainer)} · бонус ${m$(s.bonus)}</span></div>
      ${barEl(hp, hc, 6)}
      <div style="margin-top:5px">${c.bonusFocus === s.name
        ? `<span style="font-size:11px;color:var(--good);font-weight:700">★ фокус уикенда (бонус ×1.5)</span>`
        : `<button class="focussp" data-name="${s.name}" style="font-size:11px;padding:2px 8px">сделать фокусом уикенда</button>`}</div></div>`; };
  const offerCard = c.sponsorOffer ? `<div style="border:2px solid var(--accent);border-radius:var(--r-md);padding:10px 12px;margin-top:6px">
      <div style="display:flex;justify-content:space-between"><span style="font-weight:700">Новое предложение: ${c.sponsorOffer.name}</span><span style="font-size:12px;color:var(--muted)">${objectiveLabel(c.sponsorOffer.objective)}</span></div>
      <div style="font-size:12px;color:var(--muted);margin:4px 0">ретейнер ${m$(c.sponsorOffer.retainer)} · бонус ${m$(c.sponsorOffer.bonus)}</div>
      <button class="ready signsponsor" style="padding:6px 12px">Подписать спонсора</button></div>` : "";
  const sponsorsPanel = `<div class="bcard" style="--spine:var(--bc);flex:1;min-width:260px"><p class="bcard-title">Спонсоры (${(c.sponsors || []).length}/3)</p>${(c.sponsors || []).map(sponsorCard).join("")}${offerCard}</div>`;
  const bk = c.backer || {};
  const backerPanel = `<div class="bcard" style="--spine:var(--bc)"><p class="bcard-title">Финансирование команды</p>
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span style="font-weight:800;font-size:16px;color:${bk.type === "works" ? "var(--good)" : "var(--ink)"}">${backerLabel(bk)}</span>
      <span style="font-size:12px;color:var(--muted)">${bk.puMaker ? "★ свой ДВС" : `ДВС: ${bk.supplier || "клиентский"}`}</span></div>
    <div style="display:flex;justify-content:space-between;font-size:13px;margin-top:6px"><span style="color:var(--muted)">Годовой грант</span><span style="font-weight:700">${m$(bk.grant || 0)}/сезон</span></div>
    <p class="label" style="margin-top:6px;opacity:.75">${bk.type === "works" ? "Концерн финансирует команду" + (bk.puMaker ? " и разрабатывает ДВС (вне кост-капа)." : ".") : "Независимая: живёт на призовые + спонсоры + грант владельца."}</p></div>`;
  const financeTab = finHero
    + `<div style="display:flex;gap:12px;flex-wrap:wrap">${budgetChart}${breakdown}</div>`
    + `<div style="display:flex;gap:12px;flex-wrap:wrap">${sponsorsPanel}<div style="flex:1;min-width:260px;display:flex;flex-direction:column;gap:12px">${backerPanel}${capMeter}${loanPanel}${fundsPanel}</div></div>`;

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
  const regParts = regressedParts(c) || [];
  const partRow = (pk) => { const lvl = parts ? (parts[pk] || 0) : 0; const pj = projOn(pk);
    const mat = Math.min(100, lvl / PART_CEILING * 100), spec = PROJECT_SIZE[devSize];
    const can = !pj && slotsUsed < slotsMax && c.money >= spec.cost;
    const regressed = regParts.includes(pk);
    const fc = !pj ? forecastRange(c, pk, devSize, devApproach) : null;   // P1: forecast band, not an exact number
    const fcLine = fc ? `<div style="font-size:10px;color:var(--muted);margin-top:2px">прогноз +${(fc.low * 100).toFixed(1)}…+${(fc.high * 100).toFixed(1)} · корр. ${Math.round(fc.corrQuality * 100)}% · риск несхода ${Math.round(fc.miscorr * 100)}%</div>` : "";
    const ownerTag = (pj && pj.owner != null && c.coop) ? ` <span style="font-size:10px;color:var(--muted)">👤${typeof pj.owner === "number" ? "П" + (pj.owner + 1) : pj.owner}</span>` : "";
    const action = pj ? `<span style="font-size:11px;color:var(--accent);font-weight:600">${devEta(c, pj)}${ownerTag}</span>`
      : devBtn("devbtn", `data-k="${pk}" data-sz="${devSize}" data-ap="${devApproach}"`, can);
    const revert = regressed ? `<button class="revertbtn" data-k="${pk}" style="margin-top:4px;padding:3px 9px;border-radius:6px;background:var(--bad);color:#fff;font-size:10px;font-weight:700">↩ откатить</button>` : "";
    return `<div style="display:flex;align-items:flex-start;gap:10px;padding:7px 0;border-top:1px solid var(--border)">
        <div style="flex:1;min-width:0"><div style="display:flex;justify-content:space-between;font-size:13px"><span style="font-weight:600">${PART_LABEL[pk]}${regressed ? ' <span style="color:var(--bad);font-size:10px">↓ хуже</span>' : ""}${knownTier(c, pk) > 0 ? ` <span title="Известный компонент — конструктор строит выше заводского потолка" style="font-size:10px;color:var(--good)">★${KNOWN_TIERS[knownTier(c, pk)]}</span>` : ""}</span><span style="color:var(--muted);font-size:11px">ур.${(lvl * 100).toFixed(0)} · зрел.${mat.toFixed(0)}%</span></div>${barEl(mat, "var(--muted)", 4)}${fcLine}</div>
        <div style="flex:none;width:165px;text-align:right">${action}${revert}</div></div>`; };
  const unprovenLine = (c.unproven || []).length ? `<p class="label" style="color:var(--warn);margin:10px 0 0">⚠ Необкатанные: ${(c.unproven || []).map(u => `${PART_LABEL[u.part]} (${u.racesLeft})`).join(", ")} — риск отказа в гонке</p>` : "";
  const eb = eraNote(c.season || 1);
  const eraBanner = `<p class="label" style="margin:0 0 8px;opacity:.85">🏛 Регламентная эра ${eb.era + 1}: упор на «${PART_LABEL[eb.hot] || eb.hot}», слабее отдача от «${PART_LABEL[eb.cold] || eb.cold}»</p>`;
  const chassisView = baseCar ? `<div class="bcard" style="--spine:var(--bc)">${statBars}${eraBanner}
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--muted);margin-bottom:6px"><span style="font-weight:600;color:var(--ink)">Новый апгрейд</span><span>слоты ${slotsUsed}/${slotsMax}${c.costCap ? " · cost cap" : ""}</span></div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:3px">Размер:</div>${sizeSeg}
      <div style="font-size:11px;color:var(--muted);margin:6px 0 3px">Подход (риск ↔ надёжность):</div>${apSeg}
      <div style="margin-top:6px">${PARTS.map(partRow).join("")}</div>${unprovenLine}</div>` : "";
  // --- NEW default: develop-by-AREA screen (you vs field + recommendation + one intensity) ---
  const devMode = ctx._devMode || "areas", devIntensity = ctx._devIntensity || "standard";
  const areaData = DEV_AREAS.filter(a => !a.engine).map(a => ({ ...a, you: eff ? eff[a.indicator] : 0, field: fieldAvg(c, a.indicator) }));
  const weakest = areaData.slice().sort((x, y) => (x.you - x.field) - (y.you - y.field))[0];
  const intSeg = `<div style="display:flex;gap:5px">${Object.entries(INTENSITY).map(([k, v]) => { const s = PROJECT_SIZE[v.size]; return seg(k === devIntensity, v.label, "devintensity", `data-i="${k}"`, `${m$(s.cost)} · ${s.days}д`); }).join("")}</div>`;
  const areaRow = a => { const you = eff ? eff[a.indicator] : 0, field = fieldAvg(c, a.indicator), gap = Math.round((you - field) * 100);
    const youPct = statPct(a.indicator, you), fieldPct = statPct(a.indicator, field);
    const part = a.engine ? null : bestPartForArea(c, a.indicator), inProj = part ? projOn(part) : null;
    const isWeak = !a.engine && weakest && a.key === weakest.key && (you - field) < -0.003;
    const spec = PROJECT_SIZE[INTENSITY[devIntensity].size], can = !a.engine && part && !inProj && slotsUsed < slotsMax && c.money >= spec.cost;
    const action = a.engine ? `<span style="font-size:11px;color:var(--muted)">→ вкладка ДВС</span>`
      : inProj ? `<span style="font-size:11px;color:var(--bc);font-weight:600">${devEta(c, inProj)}</span>`
      : `<button class="devbtn" data-k="${part}" data-sz="${INTENSITY[devIntensity].size}" data-ap="${INTENSITY[devIntensity].approach}" ${can ? "" : "disabled"} style="padding:5px 12px;border-radius:7px;background:${can ? (isWeak ? "var(--bc)" : "var(--good)") : "var(--content2)"};color:${can ? "#04190d" : "var(--muted)"};font-weight:700;font-size:12px">Развивать</button>`;
    return `<div class="brow" style="margin:7px 0">
      <div style="width:122px;flex:0 0 auto;font-size:12px;color:var(--ink)">${a.label}${isWeak ? ` <span style="font-size:10px;font-weight:800;color:#04190d;background:var(--bad);padding:0 5px;border-radius:3px">СЛАБО</span>` : ""}</div>
      <div style="flex:1;position:relative;height:10px;background:rgba(255,255,255,.06)"><div style="position:absolute;left:0;height:100%;width:${youPct.toFixed(0)}%;background:${isWeak ? "var(--bad)" : "var(--bc)"}"></div><div style="position:absolute;left:${fieldPct.toFixed(0)}%;top:-2px;width:2px;height:14px;background:#fff"></div></div>
      <div style="width:38px;text-align:right;font-size:12px;font-weight:800;color:${gap < 0 ? "var(--bad)" : "var(--good)"}">${gap > 0 ? "+" : ""}${gap}</div>
      <div style="width:120px;text-align:right;flex:0 0 auto">${action}</div></div>`; };
  const recLine = (weakest && (weakest.you - weakest.field) < -0.003)
    ? `<div style="font-size:12px;color:var(--bc);margin-bottom:10px"><b>⚙ Совет инженеров:</b> отстаём в «${weakest.label}» от поля — развивай это направление.</div>`
    : `<div style="font-size:12px;color:var(--good);margin-bottom:10px"><b>⚙ Совет инженеров:</b> по всем направлениям держимся поля — развивай по вкусу.</div>`;
  const areaForecast = (() => { if (!weakest) return ""; const part = bestPartForArea(c, weakest.indicator); if (!part) return ""; const I = INTENSITY[devIntensity]; const fc = forecastRange(c, part, I.size, I.approach); return fc ? `<p class="label" style="margin-top:8px;opacity:.85">📈 Прогноз для «${weakest.label}»: +${(fc.low * 100).toFixed(1)}…+${(fc.high * 100).toFixed(1)} к показателю</p>` : ""; })();
  const dvCol = myTeamName ? teamColor(myTeamName) : "#888";   // moved up: areasView (--spine) uses it before its old decl (TDZ fix)
  const modeToggle = `<div style="display:flex;justify-content:flex-end;margin-bottom:8px"><button class="devmode" data-m="${devMode === "areas" ? "parts" : "areas"}" style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--muted)">${devMode === "areas" ? "⚙ по деталям →" : "← по направлениям"}</button></div>`;
  const areasView = baseCar ? `<div class="bcard" style="--spine:${dvCol}"><div style="display:flex;justify-content:space-between;align-items:baseline"><p class="bcard-title">Разработка машины</p><span style="font-size:11px;color:var(--muted)">слоты ${slotsUsed}/${slotsMax}${c.costCap ? " · cost cap" : ""}</span></div>${recLine}<div>${DEV_AREAS.map(areaRow).join("")}</div><div style="margin-top:12px;border-top:1px solid var(--border);padding-top:10px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:700;margin-bottom:6px">Интенсивность</div>${intSeg}${areaForecast}</div></div>` : "";
  const chassisOut = modeToggle + (devMode === "parts" ? chassisView : areasView);
  // --- ДВС sub-tab: season PU resource + engine development ---
  const puResBlock = c.pu ? (() => { const used = c.pu.used || 1, pool = c.pu.pool || 4, wear = c.pu.wear || 0, pen = c.pu.penalty || 0; const life = Math.round((1 - wear) * 100);
    const cells = Array.from({ length: Math.max(pool, used) }, (_, i) => `<div style="flex:1;height:9px;border-radius:3px;background:${i < used - 1 ? "var(--muted)" : i === used - 1 ? "var(--good)" : "var(--content2)"};${i >= pool ? "outline:1px solid var(--bad)" : ""}"></div>`).join("");
    return `<div style="display:flex;gap:5px;margin:2px 0 6px">${cells}</div><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span style="color:var(--muted)">Силовые установки ${used}/${pool} · ресурс ${life}%</span>${pen ? `<span style="color:var(--bad);font-weight:700">штраф ${pen} мест</span>` : ""}</div>${barEl(life, life < 25 ? "var(--bad)" : life < 50 ? "var(--warn)" : "var(--good)", 5)}`; })() : "";
  const tokLeft = puTokensLeft(c), tokCost = PU_TOKEN_COST[devSize] || 0;
  const tokenLine = `<div style="display:flex;justify-content:space-between;font-size:12px;margin:10px 0 2px"><span style="color:var(--muted)">Токены гомологации</span><span style="font-weight:700;color:${tokLeft < tokCost ? "var(--bad)" : "var(--good)"}">${tokLeft}/${PU_TOKENS_PER_SEASON}</span></div><p class="label" style="margin:0 0 4px;font-size:10px;opacity:.7">Лимит развития ДВС за сезон — не покупается за деньги (этот размер: ${tokCost} ток.)</p>`;
  const puRow = (pk) => { const lvl = pu[pk] || 0; const pj = (c.puProject && c.puProject.part === pk) ? c.puProject : null; const spec = PROJECT_SIZE[devSize]; const can = !c.puProject && c.money >= spec.cost && puTokensLeft(c) >= (PU_TOKEN_COST[devSize] || 0);
    const action = pj ? `<span style="font-size:11px;color:var(--accent);font-weight:600">${devEta(c, pj)}</span>` : devBtn("pubtn", `data-k="${pk}" data-sz="${devSize}"`, can);
    return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid var(--border)"><div style="flex:1"><span style="font-weight:600;font-size:13px">${PU_LABEL[pk]}</span> <span style="color:var(--muted);font-size:11px">ур.${(lvl * 100).toFixed(0)}</span></div><div style="width:165px;text-align:right">${action}</div></div>`; };
  let engineView;
  if (bkr.puMaker) {
    engineView = `<div class="bcard" style="--spine:var(--bc)">${puResBlock}<p class="label" style="margin-top:12px">Свой ДВС — разработка ВНЕ кост-капа · поставка клиентам +${m$(SUPPLY_INCOME)}/этап</p>${tokenLine}<div style="font-size:11px;color:var(--muted);margin-bottom:3px">Размер:</div>${sizeSeg}<div style="margin-top:4px">${PU_PARTS.map(puRow).join("")}</div></div>`;
  } else if (c.puProgram) {
    engineView = `<div class="bcard" style="--spine:var(--bc)">${puResBlock}<p class="label" style="margin-top:12px">Программа своего ДВС</p><div style="font-weight:700">${(PU_PROGRAM[c.puProgram.kind] || {}).label || c.puProgram.kind}</div><p class="label" style="margin-top:4px">Готовность: ${devEta(c, c.puProgram)} → станешь заводской PU-командой.</p></div>`;
  } else {
    const contractSeg = `<div style="display:flex;gap:6px;margin:8px 0 4px">${Object.entries(PU_SUPPLY_SPEC).map(([k, s]) => { const on = k === (c.puContract || "current"); return `<button class="pucontract" data-k="${k}" ${on ? "disabled" : ""} style="flex:1;padding:8px;border-radius:8px;border:1px solid ${on ? "var(--good)" : "var(--border)"};background:${on ? "var(--good)" : "transparent"};color:${on ? "#04190d" : "var(--ink)"};text-align:left;font-size:11px"><b>${s.label}${on ? " ✓" : ""}</b><br><span style="opacity:.85">${s.hint} · −${m$(Math.round(SUPPLY_FEE * s.feeMult))}/этап</span></button>`; }).join("")}</div>`;
    engineView = `<div class="bcard" style="--spine:var(--bc)">${puResBlock}<p class="label" style="margin-top:12px">Клиентский ДВС (поставщик ${bkr.supplier || "—"}). Контракт на спеку:</p>${contractSeg}<p class="label" style="margin-top:10px">Построй свой ДВС, чтобы развивать и продавать клиентам:</p><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">${Object.entries(PU_PROGRAM).map(([k, s]) => `<button class="puprog" data-kind="${k}" ${c.money < s.cost ? "disabled" : ""} style="flex:1;min-width:160px;padding:10px;text-align:left;border-radius:8px;background:var(--good);color:#04190d;font-weight:600">${s.label}<br><span style="font-size:11px;color:rgba(6,18,31,.78)">${m$(s.cost)} · ≈${s.days} дн.</span></button>`).join("")}</div></div>`;
  }
  // --- Стратегия sub-tab: concept + this/next-year focus ---
  const conceptCards = `<div style="display:flex;gap:8px;flex-wrap:wrap">${Object.entries(CONCEPT).map(([k, cc]) => { const on = k === (c.concept || "balanced"); return `<button class="conceptbtn" data-c="${k}" ${on ? "disabled" : ""} style="flex:1;min-width:150px;padding:10px;border-radius:8px;border:1px solid ${on ? "var(--good)" : "var(--border)"};background:${on ? "var(--good)" : "transparent"};color:${on ? "#04190d" : "var(--ink)"};text-align:left"><b>${cc.label}${on ? " ✓" : ""}</b><br><span style="font-size:11px;opacity:.85">${cc.hint}</span></button>`; }).join("")}</div>`;
  const FOCUS_OPTS = [[0, "Весь сезон сейчас"], [0.25, "25% на след. год"], [0.5, "50% на след. год"]];
  const focusOn = f => Math.abs((c.devFocus || 0) - f) < 0.01;
  const focusSeg = `<div style="display:flex;gap:6px">${FOCUS_OPTS.map(([f, l]) => `<button class="devfocus" data-f="${f}" style="flex:1;padding:8px 6px;border-radius:8px;border:1px solid ${focusOn(f) ? "var(--accent)" : "var(--border)"};background:${focusOn(f) ? "var(--accent)" : "transparent"};color:${focusOn(f) ? "#fff" : "var(--ink)"};font-size:11px;font-weight:600">${l}</button>`).join("")}</div>`;
  const bankedTot = c.nextCar ? Object.values(c.nextCar).reduce((a, b) => a + b, 0) : 0;
  const bankedLine = bankedTot > 0.0005 ? `<p class="label" style="opacity:.8;margin-top:4px">📦 Задел на след. год: +${(bankedTot * 100).toFixed(1)} — реализуется на старте сезона</p>` : "";
  // §Phase-1: pre-race fuel-load strategy. Lean = lighter & faster but risks running dry; Safe = heavy & slow.
  // Empty string ("") = tuned default (byte-identical to the AI / harness).
  const FUEL_OPTS = [["0.02", "Облегчённый", "−вес, риск сухого бака"], ["", "Стандарт", "сбалансированно"], ["0.12", "С запасом", "тяжелее, но надёжно"]];
  const fuelOn = v => (v === "" ? (c.fuelLoad == null) : Math.abs((c.fuelLoad ?? -9) - parseFloat(v)) < 0.001);
  const fuelSeg = `<div style="display:flex;gap:6px">${FUEL_OPTS.map(([v, l, h]) => `<button class="fuelload" data-fl="${v}" style="flex:1;padding:8px 6px;border-radius:8px;border:1px solid ${fuelOn(v) ? "var(--accent)" : "var(--border)"};background:${fuelOn(v) ? "var(--accent)" : "transparent"};color:${fuelOn(v) ? "#fff" : "var(--ink)"};font-size:11px;font-weight:600;text-align:center"><b>${l}</b><br><span style="font-size:10px;opacity:.8;font-weight:400">${h}</span></button>`).join("")}</div>`;
  const strategyView = me ? `<div class="bcard" style="--spine:var(--bc)"><p class="bcard-title">Концепт болида${(c.round === 0 || c.done) ? " · смена бесплатна (предсезон)" : " · смена в сезоне $3.5M"}</p>${conceptCards}
      <p class="label" style="margin-top:16px">Фокус разработки: текущая ↔ будущая машина</p>${focusSeg}${bankedLine}
      <p class="label" style="margin-top:16px">Топливо на старт гонки</p>${fuelSeg}</div>` : "";
  const carTabBar = `<div class="seg" style="margin-bottom:12px">${[["chassis", "Шасси"], ["engine", "ДВС"], ["strategy", "Стратегия"]].map(([k, l]) => `<button class="cartab${k === carTab ? " on" : ""}" data-ct="${k}">${l}</button>`).join("")}</div>`;
  // P6: a pending shared decision awaiting the co-director's sign-off (co-op only).
  const prop = c.proposal;
  const propDesc = prop ? (prop.type === "concept" ? `сменить концепт на «${(CONCEPT[prop.value] || {}).label || prop.value}»`
    : prop.type === "devfocus" ? `фокус разработки ${Math.round(prop.value * 100)}% на след. год`
    : prop.type === "pu_project" ? `крупный проект ДВС: ${PU_LABEL[prop.value.part] || prop.value.part} (${PU_TOKEN_COST.large} ток.)`
    : "решение") : "";
  const proposalBanner = prop ? (ctx.myPlayer === prop.by
    ? `<div class="panel" style="border:1px solid var(--accent);margin-bottom:10px"><p class="label" style="margin:0">⏳ Ждём согласия со-директора: <b>${propDesc}</b></p></div>`
    : `<div class="panel" style="border:1px solid var(--accent);margin-bottom:10px"><p class="label" style="margin:0 0 8px">🤝 Со-директор предлагает: <b>${propDesc}</b></p><div style="display:flex;gap:8px"><button class="propok" style="flex:1;padding:8px;border-radius:7px;background:var(--good);color:#04190d;font-weight:700">Согласовать</button><button class="propno" style="flex:1;padding:8px;border-radius:7px;background:var(--bad);color:#fff;font-weight:700">Отклонить</button></div></div>`)
    : "";
  // P6: upgrade planner — every active program (chassis + PU) with the GP it lands for, on one horizon.
  const allProj = [
    ...(c.projects || []).map(p => ({ label: PART_LABEL[p.part] || p.part, p, owner: p.owner })),
    ...(c.puProject ? [{ label: PU_LABEL[c.puProject.part] || c.puProject.part, p: c.puProject, owner: null, pu: true }] : []),
  ];
  const plannerBlock = allProj.length ? `<div class="panel" style="margin-bottom:10px"><p class="label" style="margin:0 0 4px">📅 Планировщик разработки</p>${allProj.map(x => {
      const ready = devReadyRound(c, devTotalLeft(x.p)), gp = (ready != null && CALENDAR[ready]) ? CALENDAR[ready].name.replace("Гран-при ", "") : "зим. тесты";
      const own = (x.owner != null && c.coop) ? ` <span style="color:var(--muted)">👤${typeof x.owner === "number" ? "П" + (x.owner + 1) : x.owner}</span>` : "";
      return `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;border-top:1px solid var(--border)"><span>${x.pu ? "⚙ " : ""}${x.label}${own}</span><span style="color:var(--accent)">${gp} · ≈${Math.max(1, Math.round(x.p.daysLeft || 0))}д</span></div>`;
    }).join("")}</div>` : "";
  const carView = proposalBanner + plannerBlock + carTabBar + (carTab === "engine" ? engineView : carTab === "strategy" ? strategyView : chassisOut);

  // drivers panel — the player team's two drivers (age / overall / morale / contract / salary)
  const myTeamIdx = TEAMS.findIndex(t => t.name === myTeamName);
  const mine = c.drivers ? Object.entries(c.drivers).filter(([, d]) => d.teamIdx === myTeamIdx) : [];
  // --- rich driver card (G1–G4): identity, form/morale, contract, season stats, teammate H2H, training, attrs ---
  const trChips = d => (d.traits || []).map(t => TRAITS[t] && TRAITS[t].label).filter(Boolean).map(l => `<span style="font-size:10px;background:var(--good);color:#06121f;border-radius:4px;padding:1px 6px;margin-right:4px">${l}</span>`).join("");
  const focusSet = d => new Set(((TRAINING[d.training] || {}).attrs) || []);
  const arrow = (d, k) => { const dr = attrDrift(k, d.age) + (focusSet(d).has(k) ? 0.004 : 0); return dr > 0.002 ? `<span style="color:var(--good)">▲</span>` : dr < -0.002 ? `<span style="color:var(--bad)">▼</span>` : ""; };
  const attrBars = d => `<div style="flex:1;min-width:0;display:grid;grid-template-columns:1fr 1fr;gap:3px 12px">${ATTR_KEYS.map(k => { const v = Math.round((d.attrs[k] || 0) * 100); return `<div style="display:flex;align-items:center;gap:5px"><span style="font-size:10px;color:var(--muted);width:66px;flex:none">${ATTR_RU[k]}</span><span style="flex:1;height:4px;background:rgba(255,255,255,.08);border-radius:2px;overflow:hidden"><span style="display:block;height:4px;width:${v}%;background:${dvCol}"></span></span><span style="font-size:10px;width:30px;text-align:right">${v}${arrow(d, k)}</span></div>`; }).join("")}</div>`;
  const attrGrid = d => `<div style="display:flex;gap:10px;align-items:center;margin-top:8px"><div style="flex:0 0 auto">${attrRadar(d.attrs, dvCol, 116)}</div>${attrBars(d)}</div>`;
  const statStrip = d => { const s = d.stats || {}; return `<div style="display:flex;flex-wrap:wrap;gap:10px;font-size:12px;margin-top:8px;color:var(--muted)"><span>🏆 <b style="color:var(--ink)">${s.wins || 0}</b></span><span>🥇 ${s.podiums || 0}</span><span>⚡ ${s.poles || 0}</span><span><b style="color:var(--ink)">${s.points || 0}</b> очк</span><span>🚩 ${s.dnf || 0}</span>${s.bestFin && s.bestFin < 99 ? `<span>луч. P${s.bestFin}</span>` : ""}</div>`; };
  const h2h = (ab, d) => { const tm = mine.find(([a]) => a !== ab); if (!tm) return ""; const o = tm[1].stats || {}, s = d.stats || {}; return `<div style="font-size:12px;margin-top:6px;color:var(--muted)">Дуэль с напарником — квала <b style="color:var(--ink)">${s.qH2H || 0}–${o.qH2H || 0}</b> · гонка <b style="color:var(--ink)">${s.rH2H || 0}–${o.rH2H || 0}</b></div>`; };
  const trainSel = (ab, d) => `<div style="margin-top:8px"><div style="font-size:11px;color:var(--muted);margin-bottom:3px">Тренировка (ускоряет навыки):</div><div style="display:flex;gap:4px;flex-wrap:wrap">${[...Object.entries(TRAINING), ["", { label: "— нет" }]].map(([k, t]) => { const on = (d.training || "") === k; return `<button class="trainbtn" data-ab="${ab}" data-f="${k}" style="padding:4px 8px;border-radius:6px;border:1px solid ${on ? "var(--accent)" : "var(--border)"};background:${on ? "var(--accent)" : "transparent"};color:${on ? "#fff" : "var(--ink)"};font-size:11px">${t.label}</button>`; }).join("")}</div></div>`;
  const reqHint = t => t === "contract" ? "Принять: продление, стоит ~4×зарплаты сейчас, +мораль" : t === "lead" ? "Принять: статус №1 (напарник — в поддержку, −его мораль)" : t === "bonus" ? "Принять: бонусы за подиум/победу/титул — платятся из бюджета по результатам" : t === "raise" ? "Принять: +25% к зарплате каждую гонку, зато доволен" : "";
  const reqPanel = (ab, d) => d.request ? `<div style="margin-top:8px;padding:8px 10px;border:1px solid var(--accent);border-radius:8px;background:rgba(56,139,253,.08)"><div style="font-size:12px;margin-bottom:4px">💬 ${d.request.text}</div><div class="label" style="font-size:11px;margin-bottom:6px">${reqHint(d.request.type)}</div><div style="display:flex;gap:6px"><button class="reqbtn" data-ab="${ab}" data-ok="1" style="padding:5px 12px;border-radius:7px;background:var(--good);color:#04190d;font-weight:700;font-size:12px">Принять</button><button class="reqbtn" data-ab="${ab}" data-ok="0" style="padding:5px 12px;border-radius:7px;background:transparent;border:1px solid var(--border);color:var(--ink);font-size:12px">Отклонить</button></div></div>` : "";
  const statusChip = d => d.status === "lead" ? `<span title="приоритет на пит-стопе при сдвоенном заезде + бонус морали" style="font-size:10px;background:var(--warn);color:#1a1205;border-radius:4px;padding:1px 6px;font-weight:700">★ 1-й номер</span>` : d.status === "support" ? `<span title="уступает приоритет первому номеру в боксах" style="font-size:10px;color:var(--muted);border:1px solid var(--border);border-radius:4px;padding:0 6px">саппорт</span>` : "";
  const mCol = m => m >= 0.6 ? "var(--good)" : m >= 0.4 ? "var(--warn)" : "var(--bad)";
  const rivalLine = d => d.rival ? `<div style="font-size:11px;color:var(--muted);margin-top:7px">⚔ Принципиальный соперник: <b style="color:var(--ink)">${DRIVER_NAME[d.rival] || d.rival}</b></div>` : "";
  const clauseChips = d => { const cl = d.clauses; if (!cl) return ""; const chips = [];
    if (cl.guaranteedLead) chips.push(`<span style="font-size:10px;color:var(--warn);border:1px solid var(--warn);border-radius:4px;padding:0 5px" title="гарантия статуса первого номера">№1 в контракте</span>`);
    if (cl.winBonus || cl.podiumBonus) chips.push(`<span style="font-size:10px;color:var(--good);border:1px solid var(--good);border-radius:4px;padding:0 5px" title="подиум ${m$(cl.podiumBonus || 0)} · победа ${m$(cl.winBonus || 0)} · титул ${m$(cl.titleBonus || 0)}">бонусы за результат</span>`);
    if (cl.releaseClause) chips.push(`<span style="font-size:10px;color:var(--bad);border:1px solid var(--bad);border-radius:4px;padding:0 5px" title="соперник может выкупить за ${m$(cl.releaseClause)}">пункт выкупа ${m$(cl.releaseClause)}</span>`);
    return chips.length ? `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:8px">${chips.join("")}</div>` : ""; };
  const dCard = (ab, d) => { const m = d.morale ?? 0.6, f = d.form ?? 0.5; return `<div style="background:var(--content2);border:1px solid var(--border);border-left:4px solid ${dvCol};border-radius:var(--r-md);padding:12px">
      <div style="display:flex;align-items:flex-start;gap:10px">${driverAvatar(ab, myTeamName, 46)}
        <div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap"><b>${DRIVER_NAME[ab] || ab}</b>${statusChip(d)}<span style="font-size:11px;color:var(--muted)">${d.age} лет ${ageTrend(d.age) > 0 ? `<span style="color:var(--good)" title="растущий талант">↗</span>` : ageTrend(d.age) < 0 ? `<span style="color:var(--warn)" title="ветеран на спаде — задумайся о смене">↘</span>` : ""}</span></div><div style="margin-top:4px">${trChips(d)}</div></div>
        <div style="text-align:right"><div style="font-size:10px;color:var(--muted)">OVR</div><div style="font-weight:800;font-size:22px;color:${dvCol}">${Math.round(d.overall * 100)}</div></div></div>
      <div style="display:flex;gap:14px;margin-top:10px;font-size:12px">
        <div style="flex:1"><div style="display:flex;justify-content:space-between;color:var(--muted)"><span>Форма</span><span>${Math.round(f * 100)}%</span></div>${barEl(f * 100, "var(--accent)", 4)}</div>
        <div style="flex:1"><div style="display:flex;justify-content:space-between;color:var(--muted)"><span>Настроение</span><span style="color:${mCol(m)}">${moraleReason(d)}</span></div>${barEl(m * 100, mCol(m), 4)}</div></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-size:12px"><span style="color:var(--muted)">Контракт: <b style="color:var(--ink)">${d.contractSeasons}</b> сез · ${m$(d.salary)}/гонка</span><button class="resign" data-ab="${ab}" style="background:transparent;border:1px solid var(--border);color:var(--ink);border-radius:7px;padding:4px 10px;font-size:12px;font-weight:600">Продлить</button></div>
      ${clauseChips(d)}${rivalLine(d)}${reqPanel(ab, d)}${statStrip(d)}${h2h(ab, d)}${trainSel(ab, d)}${attrGrid(d)}</div>`; };
  const driversPanel = mine.length ? `<div class="bcard" style="--spine:${dvCol}"><p class="bcard-title">Пилоты</p><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:12px">${mine.map(([ab, d]) => dCard(ab, d)).join("")}</div></div>` : "";

  // --- Штаб: departments as cards (3 staff roles + 3 facilities) with effect readouts + one action ---
  const st = c.staff;
  const perf = st ? composePersonnel(st) : null;
  const hqHeader = st ? `<div style="display:flex;flex-wrap:wrap;gap:16px;font-size:12px;color:var(--muted);margin-bottom:12px">
      <span>Содержание <b style="color:var(--ink)">${m$(upkeep(st))}</b>/гонка</span><span>Зарплаты <b style="color:var(--ink)">${m$(staffSalaries(st))}</b>/гонка</span>
      <span style="flex:1;min-width:150px">${(() => { const f = st.fatigue || 0, col = f < 0.3 ? "var(--good)" : f < 0.6 ? "#e0b341" : "var(--bad)"; return `Усталость крю <b style="color:${col}">${Math.round(f * 100)}%</b>`; })()}</span></div>` : "";
  const upBtn = (cls, data, can, lbl) => `<button class="${cls}" ${data} ${can ? "" : "disabled"} style="padding:4px 12px;border-radius:7px;background:${can ? "var(--good)" : "var(--content2)"};color:${can ? "#04190d" : "var(--muted)"};font-size:12px;font-weight:700">${lbl}</button>`;
  const trainOn = rk => !!(c.staffTrain && c.staffTrain[rk]);
  const roleCard = rk => { const p = (st.people && st.people[rk]) || {}, named = p.name && p.name !== "—", sp = p.specialty && SPECIALTIES[p.specialty];
    const rating = st[rk], cost = STAFF_UPGRADE_COST, can = c.money >= cost && rating < 0.99;
    const affects = rk === "designer" ? "разработка машины" : rk === "strategist" ? "питы · сейфти-кар · дождь" : "скорость пит-стопов";
    const eff = rk === "designer" ? `×${devMult(st).toFixed(2)}` : rk === "strategist" ? `${Math.round(perf.strategy * 100)}` : `×${perf.pitMult.toFixed(2)}`;
    const contr = (p.contractSeasons != null) ? p.contractSeasons : 3, contrLow = contr <= 1;
    return `<div ${staffTipAttrs({ role: rk, val: rating, team: myTeamName })} style="background:var(--content2);border:1px solid var(--border);border-radius:var(--r-md);padding:11px 12px;cursor:default">
        <div style="display:flex;justify-content:space-between;align-items:baseline"><b style="font-size:13px">${ROLE_LABEL[rk]}</b><span style="font-size:17px;font-weight:800;color:${dvCol}">${Math.round(rating * 100)}</span></div>
        ${named ? `<div style="font-size:11px;color:var(--muted);margin:2px 0">${p.name}${sp ? ` · <span style="color:var(--accent)">${sp.label}</span>` : ""}</div>` : ""}
        <div style="font-size:11px;color:var(--muted)">${affects} · <b style="color:var(--ink)">${eff}</b></div>${barEl(rating * 100, dvCol, 4)}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:11px"><span style="color:${contrLow ? "var(--warn)" : "var(--muted)"}">контракт ${contr} сез</span><button class="rsstaff" data-role="${rk}" style="padding:2px 8px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--ink);font-size:11px">Продлить</button></div>
        <div style="display:flex;gap:6px;margin-top:7px"><button class="trainstaff" data-role="${rk}" style="flex:1;padding:5px;border-radius:7px;border:1px solid ${trainOn(rk) ? "var(--accent)" : "var(--border)"};background:${trainOn(rk) ? "var(--accent)" : "transparent"};color:${trainOn(rk) ? "#fff" : "var(--ink)"};font-size:11px;font-weight:600">${trainOn(rk) ? "🎓 обучение ✓" : "🎓 обучать"}</button>${upBtn("ready stf", `data-kind="staff" data-key="${rk}"`, can, `+ ${m$(cost)}`)}</div></div>`; };
  const facBuilding = which => c.facilityProject && c.facilityProject.which === which ? c.facilityProject : null;
  const facCard = fk => { const lvl = st.facilities[fk] || 0, cost = FAC_UPGRADE_BASE * (lvl + 1); const bp = facBuilding(fk); const busy = !!c.facilityProject;
    const prereqOk = facPrereqMet(st, fk);
    const can = lvl < FAC_MAX && c.money >= cost && !busy && prereqOk;
    const affects = fk === "design" ? "ускоряет разработку и стратегию" : fk === "pit" ? "ускоряет пит-стопы" : fk === "sim" ? "ускоряет развитие пилотов" : fk === "tunnel" ? "качество аэро-деталей (known components)" : fk === "staffctr" ? "ускоряет обучение штата" : `слотов разработки ${1 + Math.floor(lvl / 2)} · содержание`;
    const action = lvl >= FAC_MAX ? `<span style="font-size:11px;color:var(--muted)">максимум</span>`
      : bp ? `<span style="font-size:11px;color:var(--accent)">🏗 ${devEta(c, bp)}</span>`
      : busy ? `<span style="font-size:11px;color:var(--muted)">идёт другая стройка</span>`
      : !prereqOk ? `<span style="font-size:11px;color:var(--warn)">🔒 нужно «${FAC_LABEL[FAC_PREREQ[fk]]}» ур.${lvl + 1}</span>`
      : upBtn("ready stf", `data-kind="facility" data-key="${fk}"`, can, `Строить ${m$(cost)}`);
    return `<div style="background:var(--content2);border:1px solid var(--border);border-radius:var(--r-md);padding:11px 12px">
        <div style="display:flex;justify-content:space-between;align-items:baseline"><b style="font-size:13px">${FAC_LABEL[fk]}</b><span style="font-size:12px;color:var(--muted)">ур. <b style="color:var(--ink)">${lvl}</b>/${FAC_MAX}</span></div>
        <div style="font-size:11px;color:var(--muted);margin:2px 0 5px">${affects}</div><div style="display:flex;gap:3px">${Array.from({ length: FAC_MAX }, (_, i) => `<div style="flex:1;height:6px;border-radius:2px;background:${i < lvl ? dvCol : (bp && i === lvl ? "var(--accent)" : "var(--content3)")}"></div>`).join("")}</div>
        <div style="margin-top:8px;text-align:right">${action}</div></div>`; };
  const staffPanel = st ? `<div class="bcard" style="--spine:${dvCol}"><p class="bcard-title">Штаб</p>${hqHeader}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(205px,1fr));gap:10px">${STAFF_ROLES.map(roleCard).join("")}${FACILITIES.map(facCard).join("")}</div></div>` : "";
  // staff market — compact, role-filterable; specialists give concrete bonuses (T2)
  const mktFilter = ctx._staffFilter || "all";
  const mkt = st ? staffMarketAll(c, c.season || 1) : [];   // free agents + poachable rival staff
  const filtered = mkt.filter(p => mktFilter === "all" || p.role === mktFilter).slice(0, 14);
  const filterBar = `<div style="display:flex;gap:5px;margin-bottom:8px;flex-wrap:wrap">${[["all", "Все"], ...STAFF_ROLES.map(r => [r, ROLE_LABEL[r]])].map(([k, l]) => `<button class="stafffilter" data-f="${k}" style="padding:4px 9px;border-radius:6px;border:1px solid ${k === mktFilter ? "var(--accent)" : "var(--border)"};background:${k === mktFilter ? "var(--accent)" : "transparent"};color:${k === mktFilter ? "#fff" : "var(--ink)"};font-size:11px">${l}</button>`).join("")}</div>`;
  const mktRow = p => { const fee = staffHireFee(p), better = p.rating > (st[p.role] || 0), sp = SPECIALTIES[p.specialty], can = c.money >= fee && better;
    return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid var(--border)">
        <div style="flex:1;min-width:0"><div style="font-size:13px"><b>${p.name}</b> <span style="font-size:11px;color:var(--muted)">${ROLE_LABEL[p.role]}</span>${p.team ? ` <span style="font-size:10px;color:var(--warn);border:1px solid var(--warn);border-radius:4px;padding:0 5px">${p.team}</span>` : ` <span style="font-size:10px;color:var(--good)">свободен</span>`}</div>${sp ? `<div style="font-size:11px;color:var(--accent)">${sp.label} · ${sp.fxLabel}</div>` : ""}</div>
        <span style="font-size:14px;font-weight:800;width:38px;text-align:right;color:${better ? "var(--good)" : "var(--muted)"}">${Math.round(p.rating * 100)}</span>
        <span style="font-size:10px;color:var(--muted);width:60px;text-align:right" title="потенциал · возраст (молодой растёт)">↗${Math.round((p.potential ?? p.rating) * 100)} · ${p.age ?? "—"}л</span>
        <button class="ready hire" data-id="${p.id}" ${can ? "" : "disabled"} title="${p.team ? "переманить (с премией)" : "нанять"}" style="padding:4px 10px;border-radius:7px;background:${can ? "var(--good)" : "var(--content2)"};color:${can ? "#04190d" : "var(--muted)"};font-size:12px;font-weight:700;width:128px">${p.team ? "Переманить" : "Нанять"} ${m$(fee)}</button></div>`; };
  const staffMarketPanel = st ? `<div class="bcard" style="--spine:var(--bc)"><p class="bcard-title">Рынок специалистов · свободные + соперники</p>${filterBar}${filtered.map(mktRow).join("") || `<p class="label">Нет по фильтру</p>`}</div>` : "";

  // --- Пит-крю (эталон бродкаст-кита): 5 ролей, тренировка/практика, усталость/травмы, рынок ---
  const pcCrew = c.pitCrew;
  const pcPanel = (st && pcCrew && pcCrew.members) ? (() => {
    const pcc = composePitCrew(pcCrew);
    const coh = Math.round((pcCrew.cohesion ?? 0.5) * 100), fat = Math.round(pcc.fatigueAvg * 100);
    const speedPct = Math.round(pcc.speed * 100), botch = Math.round(pcc.botchChance * 100), trainOn = !!pcCrew.training;
    const facStrength = (myIdxF >= 0 && TEAMS[myIdxF]) ? TEAMS[myIdxF].facility : 0.6;
    const pcSeed = ((c.seed >>> 0) + (c.round || 0) * 131 + (c.season || 1) * 99173) >>> 0;
    const market = pitCrewMarket(pcSeed, facStrength, 4);
    const memberCard = r => { const m = pcCrew.members[r.key] || {}; const inj = (m.injuredFor || 0) > 0;
      const sk = Math.round(effSkill(m) * 100), mf = Math.round((m.fatigue || 0) * 100);
      return `<div style="background:var(--content2);border-radius:var(--r-sm);padding:9px 11px">
        <div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:700">${PIT_ROLE_LABEL[r.key]}</span>${inj ? bchip("🩹 " + m.injuredFor, "var(--bad)") : `<span class="bnum" style="font-size:18px;color:var(--bc)">${sk}</span>`}</div>
        <div style="font-size:11px;color:var(--muted);margin:2px 0 4px">${m.name || "—"}${inj ? " · дублёр" : ""}</div>${bbar(sk, inj ? "var(--muted)" : "var(--bc)", 5)}
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--muted);margin-top:5px"><span>усталость</span><span style="color:${fatigueCol(m.fatigue || 0)}">${mf}%</span></div>${bbar(mf, fatigueCol(m.fatigue || 0), 3)}</div>`; };
    const mktRow2 = cand => `<div class="brow" style="border-top:1px solid var(--border);padding:7px 0;margin:0">
      <div style="flex:1;min-width:0"><b style="font-size:12px">${cand.name}</b> <span style="font-size:10px;color:var(--muted)">в роль: ${PIT_ROLE_LABEL[cand.role]}</span></div>
      <span class="bnum" style="font-size:14px;color:var(--bc);width:30px;text-align:right">${Math.round(cand.skill * 100)}</span>
      <button class="ready pcrecruit" data-cand='${JSON.stringify({ name: cand.name, skill: cand.skill, role: cand.role })}' ${c.money < RECRUIT_FEE ? "disabled" : ""} style="padding:4px 10px;font-size:11px;width:auto">Нанять · ${m$(RECRUIT_FEE)}</button></div>`;
    const body = bkpiStrip([["Темп стопа", speedPct], ["Сыгранность", coh + "%"], ["Усталость", fat + "%", fatigueCol(pcc.fatigueAvg)], ["Риск брака", botch + "%", botch > 12 ? "var(--bad)" : "var(--ink)"]])
      + `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px">${PIT_ROLES.map(memberCard).join("")}</div>`
      + `<div style="display:flex;gap:6px;margin-top:12px">
          <button class="ready pctrain" style="flex:1;padding:7px;font-size:11px;border:1px solid ${trainOn ? "var(--bc)" : "var(--border)"};background:${trainOn ? "var(--bc)" : "transparent"};color:${trainOn ? "#0c0c0f" : "var(--ink)"}">${trainOn ? "🎓 тренировка ✓" : "🎓 тренировать крю"}</button>
          <button class="ready pcpractice" ${c.money < PRACTICE_FEE ? "disabled" : ""} style="flex:1;padding:7px;font-size:11px">🔧 практика стопов · ${m$(PRACTICE_FEE)}</button></div>`
      + `<p class="label" style="margin-top:8px;opacity:.8">Практика растит скилл и сыгранность ценой усталости; тренировка качает скилл весь сезон. Уставший/несыгранный крю чаще «мажет» на стопе.</p>`
      + `<div style="height:6px"></div><div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:700;margin-bottom:2px">Рынок механиков</div>${market.map(mktRow2).join("")}`;
    return bcard({ title: "Пит-крю", chip: `ТЕМП ${speedPct}`, spine: dvCol, body });
  })() : "";

  // --- Трансферы: rich market cards + interest + negotiation + rumors ---
  const mineAbbrevs = mine.map(([ab]) => ab);
  const signLen = ctx._signLen || 2;
  const clauses = { bonuses: !!ctx._clBonus, lead: !!ctx._clLead, release: !!ctx._clRelease };
  const meStrength = me ? 1 - (me.pos - 1) / Math.max(1, cons.length - 1) : 0.5;
  const intCol = p => p >= 66 ? "var(--good)" : p >= 40 ? "var(--warn)" : "var(--bad)";
  const TATTR = [["pace", "Темп"], ["quali", "Квала"], ["race_iq", "Гонка"], ["tyre", "Резина"], ["overtaking", "Обгон"], ["wet", "Дождь"]];
  const faOnly = !!ctx._mktFA, sortKey = ctx._mktSort || "ovr";
  let avail = c.drivers ? availableDrivers(c) : [];
  if (faOnly) avail = avail.filter(freeAgent);
  avail = avail.sort((a, b) => sortKey === "value" ? signCostAt(a, signLen) - signCostAt(b, signLen) : sortKey === "age" ? a.age - b.age : b.overall - a.overall).slice(0, 8);
  const segB = (on, l, cls, data) => `<button class="${cls}" ${data} style="padding:4px 9px;border-radius:6px;border:1px solid ${on ? "var(--accent)" : "var(--border)"};background:${on ? "var(--accent)" : "transparent"};color:${on ? "#fff" : "var(--ink)"};font-size:11px">${l}</button>`;
  const clBtn = (on, l, key, tip) => `<button class="clbtn" data-cl="${key}" title="${tip}" style="padding:4px 9px;border-radius:6px;border:1px solid ${on ? "var(--good)" : "var(--border)"};background:${on ? "var(--good)" : "transparent"};color:${on ? "#04190d" : "var(--ink)"};font-size:11px;font-weight:${on ? 700 : 400}">${on ? "✓ " : ""}${l}</button>`;
  const tcontrols = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:6px">
      <div style="display:flex;gap:5px">${[["ovr", "OVR"], ["value", "Цена"], ["age", "Возраст"]].map(([k, l]) => segB(k === sortKey, l, "mktsort", `data-k="${k}"`)).join("")}</div>
      ${segB(faOnly, "Только свободные", "mktfa", "")}
      <div style="margin-left:auto;display:flex;align-items:center;gap:5px"><span style="font-size:11px;color:var(--muted)">Контракт:</span>${[1, 2, 3].map(L => segB(L === signLen, `${L} сез`, "signlen", `data-l="${L}"`)).join("")}</div></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px"><span style="font-size:11px;color:var(--muted)">Клаусулы:</span>
      ${clBtn(clauses.bonuses, "Бонусы за результат", "bonuses", `подиум +${m$(CLAUSE.podiumBonus)}, победа +${m$(CLAUSE.winBonus)}, титул +${m$(CLAUSE.titleBonus)} — но дешевле аванс`)}
      ${clBtn(clauses.lead, "Гарантия №1", "lead", "пилот охотнее переходит, получает статус первого номера")}
      ${clBtn(clauses.release, "Пункт выкупа", "release", "дешевле сейчас, но соперник может выкупить его из контракта")}</div>`;
  const mktCard = d => { const fa = freeAgent(d), cost = signCostAt(d, signLen, clauses), ipRaw = interest(d, meStrength, signLen) + (clauses.lead ? CLAUSE.leadInterest : 0), ip = Math.round(Math.min(0.97, ipRaw) * 100), curTeam = (TEAMS[d.teamIdx] || {}).name || "", buy = buyout(d), locked = negLocked(c, d.abbrev), strikes = negStrikes(c, d.abbrev), can = c.money >= cost && !locked;
    const attrs = TATTR.map(([k, l]) => `<span style="font-size:10px;color:var(--muted)">${l} <b style="color:var(--ink)">${Math.round((d.attrs && d.attrs[k] || 0) * 100)}</b></span>`).join(" · ");
    const clTags = [clauses.bonuses ? "бонусы" : "", clauses.lead ? "№1" : "", clauses.release ? "выкуп" : ""].filter(Boolean);
    return `<div style="background:var(--content2);border:1px solid var(--border);border-radius:var(--r-md);padding:11px 12px">
        <div style="display:flex;align-items:flex-start;gap:10px">${driverAvatar(d.abbrev, curTeam, 44)}
          <div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><b>${DRIVER_NAME[d.abbrev] || d.abbrev}</b><span style="font-size:10px;color:var(--muted);border:1px solid var(--border);border-radius:4px;padding:0 5px">${curTeam}</span>${fa ? `<span style="font-size:10px;color:var(--good);font-weight:700">свободен</span>` : ""}<span style="font-size:11px;color:var(--muted)">${d.age} л.</span></div><div style="margin-top:4px">${attrs}</div></div>
          <div style="text-align:right"><div style="font-size:10px;color:var(--muted)">OVR</div><div style="font-weight:800;font-size:20px;color:var(--accent)">${Math.round(d.overall * 100)}</div></div></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;font-size:12px"><span style="color:var(--muted)">Интерес к нам${clauses.lead ? ' <span style="color:var(--good)">+№1</span>' : ""}</span><span style="font-weight:700;color:${intCol(ip)}">${ip}%</span></div>${barEl(ip, intCol(ip), 4)}
        <div style="display:flex;justify-content:space-between;margin-top:7px;font-size:12px"><span style="color:var(--muted)">Цена${buy ? " (трансфер+выкуп)" : " (свободен)"}${clTags.length ? ` · <span style="color:var(--good)">${clTags.join("/")}</span>` : ""}</span><b>${m$(cost)}</b></div>
        ${locked ? `<div style="margin-top:7px;font-size:11px;color:var(--bad)">🚫 Переговоры закрыты до конца окна — слишком много отказов</div>`
          : strikes > 0 ? `<div style="margin-top:7px;font-size:11px;color:var(--warn)">⏳ Терпение агента: отказ ${strikes}/${NEG.lockAt}</div>` : ""}
        <div style="display:flex;gap:6px;margin-top:8px">${mine.map(([ab]) => `<button class="ready sign" data-in="${d.abbrev}" data-out="${ab}" data-len="${signLen}" data-clb="${clauses.bonuses ? 1 : 0}" data-cll="${clauses.lead ? 1 : 0}" data-clr="${clauses.release ? 1 : 0}" ${can ? "" : "disabled"} style="flex:1;padding:5px;border-radius:7px;background:${can ? "var(--good)" : "var(--content2)"};color:${can ? "#04190d" : "var(--muted)"};font-size:11px;font-weight:700">${locked ? "Закрыто" : "Вместо " + ab}</button>`).join("")}</div>
        ${(c.negotiation && c.negotiation.inAbbrev === d.abbrev) ? `<div style="margin-top:8px;padding:8px 10px;border:1px solid var(--warn);border-radius:8px;background:rgba(224,169,42,.1)"><div style="font-size:12px;margin-bottom:6px">💬 <b>Агент:</b> ${c.negotiation.counter.label}</div><div style="display:flex;gap:6px"><button class="ready signaccept" style="flex:1;padding:5px;border-radius:7px;background:var(--good);color:#04190d;font-size:11px;font-weight:700">Принять условия</button><button class="signcancel" style="padding:5px 10px;border-radius:7px;background:transparent;border:1px solid var(--border);color:var(--ink);font-size:11px">Отказаться</button></div></div>` : ""}</div>`; };
  const transferPanel = (mineAbbrevs.length && c.drivers) ? `<div class="bcard" style="--spine:var(--bc)"><p class="bcard-title">Трансферы — подписать пилота (замена одного из твоих)</p>${tcontrols}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px">${avail.map(mktCard).join("") || `<p class="label">Нет пилотов по фильтру</p>`}</div></div>` : "";
  // rumors feed: rival interest in your drivers + free-agent count + recent moves
  const ri = c.drivers ? rivalInterest(c) : [];
  const faCount = c.drivers ? availableDrivers(c).filter(freeAgent).length : 0;
  const transferRumors = c.drivers ? `<div class="bcard" style="--spine:var(--bc)"><p class="bcard-title">📰 Слухи рынка</p>
      ${ri.length ? ri.map(x => `<p class="label" style="color:var(--warn);margin:3px 0">⚠ Соперники интересуются ${DRIVER_NAME[x.abbrev] || x.abbrev} (контракт кончается) — продли, чтобы не потерять.</p>`).join("") : `<p class="label" style="margin:3px 0">Твои пилоты под контролем.</p>`}
      <p class="label" style="margin:5px 0">Свободных агентов на рынке: <b style="color:var(--ink)">${faCount}</b></p>
      ${(c.news || []).filter(n => /Трансфер|ушёл к сопернику|подписан/i.test(n)).slice(0, 4).map(n => `<p class="label" style="margin:2px 0">• ${n}</p>`).join("")}</div>` : "";

  // === Академия: программа + лестница серий + богатые карточки юниоров + фидер-таблицы + скаутинг ===
  const acad = c.academy || [];
  const aTier = programTier(c), aSlots = programSlots(aTier), aTeams = loanTeams(c).slice(0, 4);
  const SER_COL = { F4: "var(--series-f4)", F3: "var(--info)", F2: "var(--warn)", F1: "var(--good)" };
  const stars = n => `<span style="letter-spacing:1px">${"★".repeat(n)}<span style="opacity:.3">${"☆".repeat(5 - n)}</span></span>`;
  const serChip = s => `<span style="font-size:10px;font-weight:700;color:#0a0a0c;background:${SER_COL[s] || "#888"};border-radius:4px;padding:1px 6px">${SERIES_LABEL[s] || s}</span>`;
  const jAvatar = (j, size = 44) => { const col = SER_COL[j.series] || "#888"; const fs = Math.round(size * 0.36);
    return `<span style="position:relative;display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:9px;background:linear-gradient(135deg,${col}33,${col}11);border:1px solid ${col}66;font-weight:800;font-size:${fs}px;color:${col};flex:0 0 auto">${j.abbrev}</span>`; };
  const jtip = j => juniorTipAttrs({ abbrev: j.abbrev, overall: j.overall, name: j.name, age: j.age, series: j.series, tag: j.tag, persona: j.persona, morale: j.morale });
  const PERSONA_COL = { loyal: "var(--good)", mercenary: "var(--warn)", hothead: "var(--bad)", ambitious: "var(--info)" };
  const personaChip = j => j.persona && PERSONA[j.persona] ? `<span title="${PERSONA[j.persona].desc}" style="font-size:10px;color:${PERSONA_COL[j.persona] || "var(--muted)"};border:1px solid ${PERSONA_COL[j.persona] || "var(--border)"};border-radius:4px;padding:1px 6px">${PERSONA[j.persona].label}</span>` : "";
  const mCol2 = m => m >= 0.6 ? "var(--good)" : m >= 0.4 ? "var(--warn)" : "var(--bad)";

  // --- programme header (buy-vs-wait facility tier) ---
  const progCost = upgradeCost(aTier), canUp = aTier < TIER_MAX && c.money >= progCost;
  const programPanel = c.drivers ? `<div class="bcard" style="--spine:var(--bc)"><p class="bcard-title">Программа академии</p>
    <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
      <div style="flex:1;min-width:200px">
        <div style="font-size:18px;font-weight:800">${TIER_LABEL[aTier]}<span style="font-size:12px;color:var(--muted);font-weight:600"> · уровень ${aTier}/${TIER_MAX}</span></div>
        <div style="display:flex;gap:3px;margin-top:6px">${Array.from({ length: TIER_MAX }, (_, i) => `<div style="flex:1;height:7px;border-radius:2px;background:${i < aTier ? "var(--good)" : "var(--content3)"}"></div>`).join("")}</div>
        <div class="label" style="margin-top:7px;font-size:11px">развитие ×${programDevRate(aTier).toFixed(2)} · слотов ${acad.length}/${aSlots} · глубже скаутинг · ярче таланты в пуле</div>
      </div>
      <div style="text-align:right">${aTier < TIER_MAX
        ? `<button class="ready acadup" ${canUp ? "" : "disabled"} style="padding:7px 14px;border-radius:8px;background:${canUp ? "var(--good)" : "var(--content2)"};color:${canUp ? "#04190d" : "var(--muted)"};font-weight:700;font-size:12px">Развить программу · ${m$(progCost)}</button><div class="label" style="margin-top:4px;font-size:11px">→ ${TIER_LABEL[aTier + 1]}</div>`
        : `<span class="label">максимальный уровень</span>`}</div>
    </div></div>` : "";

  // --- pipeline ladder F4 → F3 → F2 → F1 (your juniors as chips on their rung) ---
  const rungChip = j => `<span ${jtip(j)} style="cursor:default;display:inline-flex;align-items:center;gap:4px;background:var(--content3);border:1px solid var(--border);border-radius:6px;padding:2px 6px;margin:2px;font-size:11px"><b>${j.abbrev}</b> <span style="color:var(--muted)">${Math.round(j.overall * 100)}</span></span>`;
  const promotedMine = c.drivers ? Object.entries(c.drivers).filter(([, d]) => d.teamIdx === myTeamIdx && d.age <= 23) : [];
  const ladder = c.drivers ? `<div class="bcard" style="--spine:var(--bc)"><p class="bcard-title">Пайплайн талантов</p>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
      ${["F4", "F3", "F2", "F1"].map(s => { const here = s === "F1" ? [] : acad.filter(j => j.series === s);
        const f1 = s === "F1" ? promotedMine.map(([ab, d]) => `<span style="display:inline-flex;align-items:center;gap:4px;background:var(--good);color:#04190d;border-radius:6px;padding:2px 6px;margin:2px;font-size:11px;font-weight:700">${ab} ${Math.round(d.overall * 100)}</span>`).join("") : "";
        return `<div style="background:var(--content2);border-radius:var(--r-md);border-top:3px solid ${SER_COL[s]};padding:8px;min-height:62px">
          <div style="font-size:12px;font-weight:700;color:${SER_COL[s]}">${SERIES_LABEL[s]}</div>
          <div style="margin-top:4px">${s === "F1" ? (f1 || `<span class="label" style="font-size:11px">—</span>`) : (here.length ? here.map(rungChip).join("") : `<span class="label" style="font-size:11px">пусто</span>`)}</div></div>`; }).join("")}
    </div></div>` : "";

  // --- rich junior cards ---
  const slBar = j => { const pts = superlicensePts(j), pct = Math.min(100, pts / SL_GATE * 100), ok = pts >= SL_GATE;
    return `<div style="margin-top:8px"><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted)"><span>Суперлицензия</span><span style="color:${ok ? "var(--good)" : "var(--ink)"}">${pts}/${SL_GATE}${ok ? " ✓" : ""}</span></div>${barEl(pct, ok ? "var(--good)" : "var(--warn)", 5)}<div class="label" style="font-size:10px;margin-top:3px">за ${SL_GATE} оч. в 3 сезонах: ${(j.slHist || []).join(" + ") || "0"}</div></div>`; };
  const potBar = j => { const b = scoutBand(j, j.scout || 0); const lo = Math.round(b.lo * 100), hi = Math.round(b.hi * 100), ovr = Math.round(j.overall * 100);
    const headroom = Math.max(0, ((b.lo + b.hi) / 2 * 100) - ovr);
    return `<div style="margin-top:8px"><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted)"><span>Потолок ${lo}–${hi}</span><span style="color:var(--warn)">${stars(b.stars)}</span></div>
      <div style="position:relative;height:7px;background:rgba(255,255,255,.08);border-radius:4px;margin-top:5px;overflow:hidden"><div style="position:absolute;left:0;height:100%;width:${ovr}%;background:var(--accent);opacity:.55"></div><div style="position:absolute;left:${lo}%;width:${Math.max(2, hi - lo)}%;height:100%;background:var(--warn)"></div></div>
      <div class="label" style="font-size:10px;margin-top:3px">резерв роста ≈ +${headroom.toFixed(0)} к ovr</div></div>`; };
  const readyCol = j => eligible(j) ? "var(--good)" : superlicensePts(j) >= SL_GATE * 0.6 ? "var(--warn)" : "var(--accent)";
  const lastPos = j => j._lastPos ? `<span style="font-size:10px;color:var(--muted);border:1px solid var(--border);border-radius:4px;padding:0 5px">фидер P${j._lastPos}</span>` : "";
  const jCard = j => { const col = readyCol(j), tag = ARCHETYPE[j.tag], lowContract = (j.contract || 0) <= 1;
    const roleBtn = (role, lbl) => `<button class="ready jrole" data-ab="${j.abbrev}" data-role="${role}" style="flex:1;padding:5px;border-radius:7px;border:1px solid ${j.role === role ? "var(--accent)" : "var(--border)"};background:${j.role === role ? "var(--accent)" : "transparent"};color:${j.role === role ? "#fff" : "var(--ink)"};font-size:11px;font-weight:600">${j.role === role ? "✓ " : ""}${lbl}</button>`;
    const loanRow = aTeams.length ? `<div style="margin-top:7px"><div class="label" style="font-size:10px;margin-bottom:3px">Аренда в боевой кокпит (опыт + $${(LOAN_FEE / 1000).toFixed(1)}M, риск выкупа):</div><div style="display:flex;gap:4px;flex-wrap:wrap">${aTeams.map(t => `<button class="ready jloan" data-ab="${j.abbrev}" data-team="${t}" style="padding:3px 8px;border-radius:6px;border:1px solid ${j.loanedTo === t ? "var(--good)" : "var(--border)"};background:${j.loanedTo === t ? "var(--good)" : "transparent"};color:${j.loanedTo === t ? "#04190d" : "var(--ink)"};font-size:10px">${j.loanedTo === t ? "✓ " : ""}${t}</button>`).join("")}</div></div>` : "";
    const promoteRow = eligible(j)
      ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)"><div class="label" style="font-size:11px;color:var(--good);margin-bottom:4px">✓ Готов к Формуле 1 — поставить вместо:</div><div style="display:flex;gap:6px;flex-wrap:wrap">${mineAbbrevs.map(ab => `<button class="ready promote" data-j="${j.abbrev}" data-out="${ab}" style="flex:1;padding:5px;border-radius:7px;background:var(--good);color:#04190d;font-size:11px;font-weight:700">▲ вместо ${ab}</button>`).join("")}</div></div>`
      : `<div class="label" style="margin-top:8px;font-size:11px">до Ф1 нужно ${SL_GATE} оч. суперлицензии</div>`;
    return `<div ${jtip(j)} style="cursor:default;background:var(--content2);border:1px solid var(--border);border-left:4px solid ${col};border-radius:var(--r-md);padding:12px">
      <div style="display:flex;align-items:flex-start;gap:10px">${jAvatar(j, 46)}
        <div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><b>${j.name}</b>${serChip(j.series)}<span style="font-size:11px;color:var(--muted)">${j.age} л.</span>${lastPos(j)}</div>
          <div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;align-items:center">${tag ? `<span style="font-size:10px;background:var(--accent);color:#fff;border-radius:4px;padding:1px 6px">${tag}</span>` : ""}${personaChip(j)}${j.loanedTo ? `<span style="font-size:10px;color:var(--warn)">в аренде: ${j.loanedTo}</span>` : ""}</div></div>
        <div style="text-align:right"><div style="font-size:10px;color:var(--muted)">OVR</div><div style="font-weight:800;font-size:22px;color:${col}">${Math.round(j.overall * 100)}</div></div></div>
      ${potBar(j)}${slBar(j)}
      <div style="margin-top:8px"><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted)"><span>Мораль</span><span style="color:${mCol2(j.morale ?? 0.7)}">${Math.round((j.morale ?? 0.7) * 100)}%</span></div>${barEl((j.morale ?? 0.7) * 100, mCol2(j.morale ?? 0.7), 4)}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:9px;font-size:12px"><span style="color:${lowContract ? "var(--warn)" : "var(--muted)"}">Контракт: <b style="color:var(--ink)">${j.contract || 0}</b> сез${lowContract ? " ⚠" : ""}</span><button class="ready jextend" data-ab="${j.abbrev}" ${c.money < extendCost(j) ? "disabled" : ""} style="padding:3px 10px;border-radius:7px;border:1px solid var(--border);background:transparent;color:var(--ink);font-size:11px">Продлить · ${m$(extendCost(j))}</button></div>
      <div style="display:flex;gap:6px;margin-top:8px">${roleBtn("reserve", "Резерв")}${roleBtn("fp1", "FP1")}</div>
      ${loanRow}${promoteRow}</div>`; };
  const juniorsPanel = c.drivers ? `<div class="bcard" style="--spine:var(--bc)"><p class="bcard-title">Твои юниоры · ${acad.length}/${aSlots}</p>
    ${acad.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px">${acad.map(jCard).join("")}</div>`
      : `<p class="label">Академия пуста — законтрактуй юниоров из скаутинга ниже.</p>`}</div>` : "";

  // --- feeder championship tables (per series, your juniors highlighted) ---
  const feeder = (c.lastFeeder && !Array.isArray(c.lastFeeder)) ? c.lastFeeder : null;
  const feederPanel = (feeder && SERIES.some(s => (feeder[s] || []).length)) ? `<div class="bcard" style="--spine:var(--bc)"><p class="bcard-title">Фидер-чемпионаты · прошлый сезон</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px">
      ${SERIES.filter(s => (feeder[s] || []).length).map(s => `<div><div style="font-size:12px;font-weight:700;color:${SER_COL[s]};margin-bottom:4px">${SERIES_LABEL[s]}</div>
        <table style="width:100%;border-collapse:collapse"><tbody>${(feeder[s] || []).slice(0, 8).map(r => `<tr style="${r.mine ? "color:var(--good);font-weight:700" : ""}"><td style="padding:2px 6px;width:22px;color:var(--muted)">${r.pos}</td><td style="padding:2px 6px">${r.name || r.abbrev}${r.mine ? " ★" : ""}</td><td style="padding:2px 6px;text-align:right;color:var(--muted)">${r.pts}</td></tr>`).join("")}</tbody></table></div>`).join("")}
    </div></div>` : "";

  // --- scouting: prospects to scout/sign (rich cards, gated by tier + slots) ---
  const noSlot = acad.length >= aSlots;
  const scoutList = c.drivers ? availableJuniors(c).slice(0, 6) : [];
  const scoutCard = p => { const sc = scoutOf(c, p.abbrev), b = scoutBand(p, sc), tag = ARCHETYPE[p.tag];
    const fee = signCostJunior(p, sc), canScout = c.money >= SCOUT_STEP_FEE, canSign = c.money >= fee && !noSlot;
    return `<div ${jtip(p)} style="cursor:default;background:var(--content2);border:1px solid var(--border);border-radius:var(--r-md);padding:11px 12px">
      <div style="display:flex;align-items:flex-start;gap:10px">${jAvatar(p, 40)}
        <div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><b>${p.name}</b>${serChip(p.series)}<span style="font-size:11px;color:var(--muted)">${p.age} л.</span></div>
          <div style="margin-top:3px;display:flex;gap:4px;flex-wrap:wrap">${tag ? `<span style="font-size:10px;background:var(--content3);color:var(--ink);border-radius:4px;padding:1px 6px">${tag}</span>` : ""}${personaChip(p)}${rivalCourting(c, p) ? `<span title="яркий проспект — соперники-академии могут увести его в межсезонье" style="font-size:10px;color:var(--bad);border:1px solid var(--bad);border-radius:4px;padding:1px 6px">🔥 соперники присматриваются</span>` : ""}</div></div>
        <div style="text-align:right"><div style="font-size:10px;color:var(--muted)">OVR</div><div style="font-weight:800;font-size:18px;color:var(--ink)">${Math.round(p.overall * 100)}</div></div></div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-top:8px"><span>Потолок ${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)}</span><span style="color:var(--warn)">${stars(b.stars)}</span></div>${barEl(((b.lo + b.hi) / 2) * 100, "var(--warn)", 4)}
      <div style="display:flex;gap:6px;margin-top:9px">
        <button class="ready scoutmore" data-j="${p.abbrev}" ${canScout && b.stars < 5 ? "" : "disabled"} style="flex:1;padding:5px;border-radius:7px;border:1px solid var(--border);background:transparent;color:var(--ink);font-size:11px">🔍 Скаутить · ${m$(SCOUT_STEP_FEE)}</button>
        <button class="ready scout" data-j="${p.abbrev}" ${canSign ? "" : "disabled"} style="flex:1;padding:5px;border-radius:7px;background:${canSign ? "var(--good)" : "var(--content2)"};color:${canSign ? "#04190d" : "var(--muted)"};font-size:11px;font-weight:700">Подписать · ${m$(fee)}</button></div></div>`; };
  const lockedCount = c.drivers ? JUNIOR_POOL.filter(p => (p.minTier || 0) > aTier).length : 0;
  const scoutPanel = c.drivers ? `<div class="bcard" style="--spine:var(--bc)"><p class="bcard-title">Скаутинг · открытый пул${noSlot ? ` <span style="color:var(--warn)">(нет свободных слотов — развей программу)</span>` : ""}</p>
    ${scoutList.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px">${scoutList.map(scoutCard).join("")}</div>` : `<p class="label">Пул исчерпан.</p>`}
    ${lockedCount ? `<p class="label" style="margin-top:8px;font-size:11px;opacity:.8">🔒 ${lockedCount} ярких талантов раскроется на более высоком уровне программы.</p>` : ""}</div>` : "";

  // --- academy graduates: the F1 career chronicle of juniors you promoted ---
  const grads = (c.graduates || []).slice().sort((a, b) => (b.titles - a.titles) || (b.wins - a.wins) || (b.points - a.points));
  const gradCard = g => { const col = g.titles > 0 ? "var(--good)" : g.wins > 0 ? "var(--warn)" : "var(--accent)";
    const teamTag = g.active ? `<span style="font-size:10px;color:var(--muted);border:1px solid var(--border);border-radius:4px;padding:0 5px">${g.team || "—"}</span>` : `<span style="font-size:10px;color:var(--muted)">завершил карьеру</span>`;
    return `<div style="background:var(--content2);border:1px solid var(--border);border-left:4px solid ${col};border-radius:var(--r-md);padding:10px 12px">
      <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap"><b>${g.name}</b>${teamTag}${g.titles > 0 ? `<span style="font-size:11px;color:var(--good);font-weight:700">${"★".repeat(Math.min(5, g.titles))} чемпион${g.titles > 1 ? ` ×${g.titles}` : ""}</span>` : ""}</div>
      <div class="label" style="font-size:11px;margin-top:5px">с ${g.promotedSeason}-го сезона · ${g.seasons} сез · 🏆 ${g.wins} побед · 🥉 ${g.podiums} подиумов · ${g.points} оч.</div></div>`; };
  const graduatesPanel = (c.drivers && grads.length) ? `<div class="bcard" style="--spine:var(--bc)"><p class="bcard-title">🎓 Выпускники академии · ${grads.length}</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px">${grads.map(gradCard).join("")}</div></div>` : "";

  // --- academy rumors (graduations, poaching, loans) ---
  const acadNews = (c.news || []).filter(n => /^[🎓🏴💼⚠🏆🌱]/.test(n)).slice(0, 6);
  const acadRumors = (c.drivers && acadNews.length) ? `<div class="bcard" style="--spine:var(--bc)"><p class="bcard-title">📰 Академия — новости</p>${acadNews.map(n => `<p class="label" style="margin:3px 0">• ${n}</p>`).join("")}</div>` : "";

  const academyPanel = c.drivers ? programPanel + ladder + juniorsPanel + graduatesPanel + feederPanel + scoutPanel + acadRumors : "";

  // season-start title-sponsor choice
  let offers = "";
  if (c.pendingOffers && c.pendingOffers.length) {
    offers = `<div class="bcard" style="--spine:var(--bc)"><p class="bcard-title">Выбери титульного спонсора на сезон</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">${c.pendingOffers.map((o, i) => `
        <button class="ready offer" data-i="${i}" style="flex:1;min-width:180px;text-align:left;padding:10px">
          <b>${o.name}</b><br><span style="font-size:11px;color:rgba(6,18,31,.78)">${objectiveLabel(o.objective)}</span><br>
          ретейнер ${m$(o.retainer)} · бонус ${m$(o.bonus)}</button>`).join("")}</div></div>`;
  }

  // weekend gate / season end
  let footer;
  if (c.done) {
    const bo = boardOutcome(c);
    const champD = drv[0], champC = cons[0];
    footer = `<div class="bcard" style="--spine:var(--bc)"><h3>Сезон ${c.season} завершён</h3>
      <p class="label">Цель: не ниже P${bo.target} · доверие совета ${Math.round(bo.confidence * 100)}%</p>
      <p style="font-size:18px;font-weight:700;color:${bo.met ? "var(--good)" : "var(--bad)"}">${bo.met ? "✅ Цель выполнена" : (bo.sacked ? "❌ Совет уволил вас" : "❌ Цель не выполнена")} — итог P${bo.finalPos}</p>
      <p class="label">🏆 Чемпион: ${champD ? champD.abbrev : "-"} · Кубок конструкторов: ${champC ? champC.team : "-"}</p>
      <button class="primary" id="newseason">${bo.sacked ? "Начать заново ▶" : "Новый сезон ▶"}</button></div>`;
  } else {
    const nextR = CALENDAR[c.round];
    const blocked = !!(c.pendingOffers && c.pendingOffers.length);
    const gNext = gapDays(c.season, c.round);
    const gapHint = gNext != null
      ? `<p class="label" style="opacity:.7;margin:0 0 8px">После гонки — ${gNext} дн. до «${CALENDAR[c.round + 1].name.replace("Гран-при ", "")}» (${gapLabel(gNext)})</p>`
      : `<p class="label" style="opacity:.7;margin:0 0 8px">Финал сезона — впереди зимние тесты (${offseasonDays(c.season)} дн.)</p>`;
    footer = `<div class="bcard" style="--spine:var(--bc)"><p class="bcard-title">Следующий этап · раунд ${c.round + 1} из ${CALENDAR.length}</p>
      <h3 style="margin-bottom:2px">${nextR.name}</h3>
      <p class="label" style="margin:0 0 2px">${nextR.shape} · ${nextR.laps} кругов</p>
      <p class="label" style="margin:0 0 4px">📅 ${fmtDate(c.season, c.round)}${SPRINTS.has(c.round) ? ` · <span style="color:var(--accent)">спринт</span>` : ""}</p>
      ${(c.pu && c.pu.penalty) ? `<p class="label" style="color:var(--bad);margin:0 0 6px">⚠ Штраф ДВС: старт на ${c.pu.penalty} мест ниже</p>` : ""}
      ${gapHint}
      ${(() => { const wp = Math.round((nextR.wet || 0) * 100); const lbl = wp >= 55 ? ["🌧️", "высокая вероятность дождя", "var(--info)"] : wp >= 30 ? ["🌦️", "дождь возможен — держи стратегию гибкой", "var(--warn)"] : wp >= 12 ? ["🌥️", "небольшой шанс осадков", "var(--muted)"] : ["☀️", "ожидается сухо", "var(--muted)"];
        return `<p class="label" style="margin:0 0 4px;color:${lbl[2]}">${lbl[0]} Прогноз: ${lbl[1]} (${wp}%)</p>`; })()}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin:6px 0 10px">
        ${miniBar("Прижим", nextR.df)}${miniBar("Мощность", nextR.pw)}${miniBar("Обгон", nextR.ot)}${miniBar("Дождь", nextR.wet)}</div>
      ${(c.sponsors && c.sponsors.length) ? `<div style="margin:0 0 12px;font-size:11px;color:var(--muted)">🎯 Цели спонсоров на гонку: ${c.sponsors.slice(0, 3).map(sp => `${sp.name} — <b style="color:var(--ink)">${objectiveLabel(sp.objective)}</b> <span style="color:var(--good)">+${m$(sp.bonus)}</span>`).join(" · ")}</div>` : ""}
      <button class="primary" id="startwknd" ${blocked ? "disabled" : ""}>${meReady ? "Готов ✓ — ждём напарника…" : "Начать уикенд ▶"}</button>
      ${blocked ? `<p class="label">Сначала выбери спонсора.</p>` : ""}</div>`;
  }

  // --- Обзор dashboard ---
  const conf = (c.board && c.board.confidence != null) ? c.board.confidence : 0.5;
  const total = CALENDAR.length;
  const above = me ? cons[me.pos - 2] : null, below = me ? cons[me.pos] : null;
  const gapTxt = !me ? "" : (me.pos > 1 ? `−${above ? above.pts - me.pts : 0} до P${me.pos - 1}` : (below ? `+${me.pts - below.pts} над P2` : "лидер"));
  const lastNet = lr ? `${lr.net >= 0 ? "+" : "−"}${m$(Math.abs(lr.net))} прошлый этап` : "старт сезона";
  const teamName = (c.identity && c.identity.name) || (me ? me.team : "");
  const teamCol = (c.identity && c.identity.color) || (me ? teamColor(me.team) : "#888");
  const heroBadge = c.identity ? `<div style="width:46px;height:46px;border-radius:8px;background:${teamCol};flex:none"></div>` : `<img src="assets/teams/${TEAM_LOGO[me ? me.team : ""]}.png" style="height:46px;width:46px;object-fit:contain">`;
  const dashboardHero = me ? `<div class="bcard" style="--spine:var(--bc)">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
        ${heroBadge}
        <div><div style="font-size:12px;color:var(--muted)">Сезон ${c.season} · цель P${c.board ? c.board.targetPos : "-"} · 📅 ${c.done ? "межсезонье" : fmtDate(c.season, c.round)}</div>
          <div style="font-size:22px;font-weight:800">${teamName}</div></div>
        <div style="margin-left:auto;text-align:right"><div style="font-size:12px;color:var(--muted)">Кубок конструкторов</div>
          <div style="font-size:28px;font-weight:800;line-height:1;color:${teamCol}">P${me.pos}<span style="font-size:14px;color:var(--muted)"> / ${cons.length}</span></div></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">
        ${kpiCard("Бюджет", m$(c.money), `<div style="font-size:11px;color:var(--muted);margin-top:4px">${lastNet}</div>`)}
        ${kpiCard("Очки команды", me.pts, `<div style="font-size:11px;color:var(--muted);margin-top:4px">${gapTxt} · ожид. финиш P${expectedFinish(c)}</div>`)}
        ${kpiCard("Доверие совета", `${Math.round(conf * 100)}%`, barEl(conf * 100, confColor(conf)))}
        ${(() => { const ap = teamAppeal(c); return kpiCard("Привлекательность", `${Math.round(ap * 100)}%`, barEl(ap * 100, "var(--accent2,#e7c84b)") + `<div style="font-size:11px;color:var(--muted);margin-top:4px">спонсоры: ×${(0.7 + 0.6 * ap).toFixed(2)} к доходу</div>`); })()}
        ${kpiCard("Прогресс сезона", `${c.round} / ${total}`, barEl(c.round / total * 100, "var(--accent)"))}
      </div></div>` : "";
  const standRow = (r) => `<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;${r.isPlayer ? "background:var(--content2)" : ""}">
      <span style="width:20px;text-align:right;font-weight:800;color:var(--muted)">${r.pos}</span>
      <span style="width:4px;height:16px;background:${teamColor(r.team)};border-radius:2px"></span>
      <img src="assets/teams/${TEAM_LOGO[r.team]}.png" style="height:16px">
      <span style="flex:1;font-weight:${r.isPlayer ? 700 : 500}">${r.team}</span>
      <span style="font-weight:800">${r.pts}</span></div>`;
  const playerExtra = (me && me.pos > 5) ? `<div style="border-top:1px dashed var(--border);margin-top:4px;padding-top:4px">${standRow(me)}</div>` : "";
  const miniStandings = `<div class="bcard" style="--spine:var(--bc);flex:1;min-width:260px"><p class="bcard-title">Кубок конструкторов</p>${cons.slice(0, 5).map(standRow).join("")}${playerExtra}</div>`;
  const top3 = lr ? (lr.classification || []).slice(0, 3) : [];
  const myCars = (lr && me) ? (lr.classification || []).filter(x => x.team === me.team).map(x => `P${x.pos}`).join(" · ") : "";
  const lastRaceCard = `<div class="bcard" style="--spine:var(--bc);flex:1;min-width:260px"><p class="bcard-title">Последняя гонка${lr ? ` · ${lr.gp}` : ""}</p>
    ${lr ? `<div style="display:flex;gap:6px;margin:8px 0">
        ${top3.map((x, i) => { const col = teamColor(x.team); return `<div style="flex:1;background:${col};color:${teamInk(col)};border-radius:8px;padding:8px;text-align:center"><div style="font-size:11px;opacity:.85">${["🥇", "🥈", "🥉"][i]} P${x.pos}</div><div style="font-weight:800">${x.abbrev}</div></div>`; }).join("")}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--muted)">Твои машины</span><span style="font-weight:700">${myCars || "—"}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-top:3px"><span style="color:var(--muted)">Итог по деньгам</span><span style="font-weight:700;color:${lr.net >= 0 ? "var(--good)" : "var(--bad)"}">${lr.net >= 0 ? "+" : "−"}${m$(Math.abs(lr.net))}</span></div>`
      : `<p class="label">Сезон ещё не начинался — впереди ${total} этапов.</p>`}</div>`;
  const objs = (c.board && c.board.objectives) ? evaluateObjectives(c) : [];
  const objectivesPanel = objs.length ? `<div class="bcard" style="--spine:var(--bc)"><p class="bcard-title">Задачи совета на сезон</p>
    ${objs.map(o => `<div style="margin:8px 0"><div style="display:flex;justify-content:space-between;font-size:13px"><span>${o.met ? "✅ " : ""}${o.label}</span><span style="color:var(--muted)">${Math.round(o.progress * 100)}%</span></div>${barEl(Math.min(1, o.progress) * 100, o.met ? "var(--good)" : "var(--accent)", 7)}</div>`).join("")}
    <p class="label" style="margin-top:8px;opacity:.7">След. сезон: ${regArcNote((c.season || 1) + 1)}</p></div>` : "";
  // §Phase-6: a high-stakes ultimatum banner — you are one race from a mid-season sack
  const ult = c.board && c.board.ultimatum;
  const ultimatumPanel = ult ? `<div class="panel" style="border:2px solid var(--bad);background:rgba(231,85,59,.08)">
      <div style="font-weight:800;font-size:15px;color:var(--bad)">⛔ Ультиматум совета</div>
      <div style="font-size:13px;margin-top:4px">Финишируй <b>не ниже P${ult.demandPos}</b> в следующей гонке — иначе отставка по ходу сезона.${(c.money < 0) ? " Плюс выведи бюджет из минуса." : ""}</div></div>` : "";
  const offer = c.acquisitionOffer;
  const acquirePanel = offer ? `<div class="panel" style="border:2px solid var(--accent)">
      <p class="label">Предложение о выкупе команды</p>
      <div style="font-weight:800;font-size:17px">${offer.suitor} <span style="font-size:12px;color:var(--muted)">(${offer.typeLabel})</span></div>
      <div style="font-size:13px;margin:6px 0;color:var(--muted)">Разовый кэш ${m$(offer.cash)} · грант ${m$(offer.grant)}/сезон${offer.puMaker ? " · приносит свой ДВС" : ""} · новая цель совета P${offer.target}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
        <button class="ready acq-keep" style="padding:8px 12px">Принять (сохранить имя)</button>
        <button class="ready acq-rebrand" style="padding:8px 12px">Принять + ребрендинг → ${offer.newName}</button>
        <button class="ready acq-decline" style="padding:8px 12px;background:transparent;border:1px solid var(--border);color:var(--ink)">Отклонить</button>
      </div></div>` : "";
  const newsPanel = (c.news && c.news.length) ? `<div class="bcard" style="--spine:var(--bc)"><p class="bcard-title">📰 Новости</p>${c.news.slice(0, 8).map(n => `<p class="label" style="margin:2px 0">• ${n}</p>`).join("")}</div>` : "";
  // season story: the arc of the team's best finish over the rounds, with podium/points bands
  const momentumPanel = (() => {
    const pts = hist.map(h => h.bestPos).filter(v => typeof v === "number" && v > 0);
    if (pts.length < 2) return "";
    const w = 300, h = 64, n = pts.length, maxP = Math.max(11, ...pts);
    const X = i => (i / (n - 1)) * w, Y = p => ((p - 1) / (maxP - 1)) * h;   // P1 at the top
    const path = pts.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(p).toFixed(1)}`).join(" ");
    const bandPod = Y(3).toFixed(1), bandPts = Y(10).toFixed(1);
    const best = Math.min(...pts), wins = hist.filter(s => s.bestPos === 1).length, pods = hist.filter(s => s.bestPos > 0 && s.bestPos <= 3).length;
    return `<div class="bcard" style="--spine:var(--bc)"><p class="bcard-title">История сезона · лучший финиш по этапам</p>
      <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:78px;display:block">
        <rect x="0" y="0" width="${w}" height="${bandPod}" fill="var(--good)" opacity="0.08"/>
        <rect x="0" y="${bandPod}" width="${w}" height="${(Y(10) - Y(3)).toFixed(1)}" fill="var(--info)" opacity="0.07"/>
        <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-top:3px"><span style="color:var(--good)">зона подиума</span><span>лучший P${best} · 🏆 ${wins} · 🥉 ${pods}</span><span>P${maxP}</span></div></div>`;
  })();
  const standingsTab = `<div style="display:flex;gap:12px;flex-wrap:wrap">
      <div class="bcard" style="--spine:var(--bc);flex:1;min-width:240px"><p class="bcard-title">Кубок конструкторов</p>
        <table style="width:100%;border-collapse:collapse"><tbody>${consTbl}</tbody></table></div>
      <div class="bcard" style="--spine:var(--bc);flex:1;min-width:240px"><p class="bcard-title">Личный зачёт (топ-10)</p>
        <table style="width:100%;border-collapse:collapse"><tbody>${drvTbl}</tbody></table></div>
    </div>`;
  // --- Календарь tab: every round with date, status, finish, and the gap (dev window) to the next ---
  const histByRound = {}; (c.history || []).forEach(h => { histByRound[h.round] = h; });
  const projReadySet = new Set((c.projects || []).map(p => devReadyRound(c, devTotalLeft(p))).filter(r => r != null));
  const calRows = CALENDAR.map((r, i) => {
    const done = i < c.round, isNext = (i === c.round && !c.done);
    const g = gapDays(c.season, i), h = histByRound[i];
    const resTxt = h ? `P${h.bestPos}` : (isNext ? "след." : "");
    const gapTxt = g != null ? `${g} дн · ${gapLabel(g)}` : "финал";
    const nameClean = r.name.replace("Гран-при ", "");
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;${isNext ? "background:var(--content2);" : ""}font-size:13px;${done ? "opacity:.55" : ""}">
        <span style="width:14px;color:var(--muted)">${done ? "✓" : isNext ? "▶" : ""}</span>
        <span style="width:20px;text-align:right;color:var(--muted);font-weight:700">${i + 1}</span>
        <span style="width:52px;color:var(--muted)">${fmtDateShort(i)}</span>
        <span style="flex:1;font-weight:${isNext ? 700 : 500}">${nameClean}${SPRINTS.has(i) ? ` <span style="font-size:10px;color:var(--accent)">S</span>` : ""}${projReadySet.has(i) ? ` <span title="апгрейд готов" style="color:var(--good)">✦</span>` : ""}</span>
        <span style="width:54px;text-align:right;font-weight:700">${resTxt}</span>
        <span style="width:118px;text-align:right;color:var(--muted);font-size:11px">${gapTxt}</span>
      </div>`;
  }).join("");
  const calendarTab = `<div class="bcard" style="--spine:var(--bc)"><p class="bcard-title">Календарь сезона ${c.season} · ${CALENDAR.length} этапов · ${fmtDate(c.season, 0)} — ${fmtDate(c.season, CALENDAR.length - 1)}</p>
    ${(c.projects || []).length ? `<p class="label" style="opacity:.85;color:var(--good)">✦ В разработке: ${(c.projects || []).map(p => `${PART_LABEL[p.part]} (${devEta(c, p)})`).join("; ")}</p>` : ""}
    ${calRows}
    <p class="label" style="margin-top:8px;opacity:.7">S — спринт · ✦ — готовность апгрейда · «бэк-ту-бэк» = мало времени на разработку, «перерыв» = много</p></div>`;
  // 2-level navigation: top groups → sub-tabs. Pit-crew is its own sub-tab under Гараж.
  const GROUPS = [
    { key: "overview",  label: "Обзор",   tabs: [["overview", "Обзор"]] },
    { key: "weekend",   label: "Уикенд",  tabs: [["calendar", "Календарь"]] },
    { key: "garage",    label: "Гараж",   tabs: [["car", "Машина"], ["pitcrew", "Пит-крю"], ["staff", "Штаб"]] },
    { key: "roster",    label: "Состав",  tabs: [["drivers", "Пилоты"], ["academy", "Академия"], ["transfers", "Трансферы"]] },
    { key: "finance",   label: "Финансы", tabs: [["finance", "Финансы"]] },
    { key: "standings", label: "Зачёт",   tabs: [["standings", "Зачёт"]] },
  ];
  const TAB_CONTENT = {
    overview:  ultimatumPanel + dashboardHero + acquirePanel + `<div style="display:flex;gap:12px;flex-wrap:wrap">${miniStandings}${lastRaceCard}</div>` + momentumPanel + objectivesPanel + newsPanel + offers,
    calendar:  calendarTab,
    finance:   financeTab,
    car:       me ? carView : emptyMsg("Нет данных по машине"),
    drivers:   driversPanel || emptyMsg("Нет пилотов"),
    staff:     st ? `<div class="prow">${staffPanel}${staffMarketPanel}</div>` : emptyMsg("Нет данных по команде"),
    pitcrew:   pcPanel || emptyMsg("Пит-крю недоступен"),
    transfers: transferPanel ? transferRumors + transferPanel : emptyMsg("Нет доступных трансферов"),
    academy:   academyPanel || emptyMsg("Академия недоступна"),
    standings: standingsTab,
  };
  const activeGroup = GROUPS.find(g => g.tabs.some(([k]) => k === ctx._padTab)) || GROUPS[0];
  const groupBar = `<div class="pad-group">${GROUPS.map(g => `<button class="pad-gtab${g === activeGroup ? " on" : ""}" data-group="${g.key}">${g.label}</button>`).join("")}</div>`;
  const subBar = activeGroup.tabs.length > 1
    ? `<div class="pad-subtabs">${activeGroup.tabs.map(([k, l]) => `<button class="pad-subtab${k === ctx._padTab ? " on" : ""}" data-tab="${k}">${l}</button>`).join("")}</div>`
    : "";
  root.innerHTML = groupBar + subBar + `<div id="pad-content">${TAB_CONTENT[ctx._padTab] || TAB_CONTENT.overview}</div>` + `<div class="pad-foot">${footer}</div>`;
  attachPersonTips(root);
  root.querySelectorAll(".pad-gtab").forEach(b => b.onclick = () => { const g = GROUPS.find(x => x.key === b.dataset.group); if (g) { ctx._padTab = g.tabs[0][0]; render(root, ctx); } });
  root.querySelectorAll(".pad-subtab").forEach(b => b.onclick = () => { ctx._padTab = b.dataset.tab; render(root, ctx); });

  root.querySelectorAll("button.offer").forEach(b => b.onclick = () => { root.querySelectorAll("button.offer").forEach(x => x.disabled = true); ctx.send({ cmd: "career_sponsor", player: ctx.myPlayer, offerIdx: +b.dataset.i }); });
  root.querySelectorAll("button.devbtn").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_project", player: ctx.myPlayer, part: b.dataset.k, size: b.dataset.sz, approach: b.dataset.ap }); });
  root.querySelectorAll("button.revertbtn").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_revert", player: ctx.myPlayer, part: b.dataset.k }); });
  root.querySelectorAll("button.devapproach").forEach(b => b.onclick = () => { ctx._devApproach = b.dataset.ap; render(root, ctx); });
  root.querySelectorAll("button.cartab").forEach(b => b.onclick = () => { ctx._carTab = b.dataset.ct; render(root, ctx); });
  root.querySelectorAll("button.devsize").forEach(b => b.onclick = () => { ctx._devSize = b.dataset.sz; render(root, ctx); });
  root.querySelectorAll("button.devintensity").forEach(b => b.onclick = () => { ctx._devIntensity = b.dataset.i; render(root, ctx); });
  root.querySelectorAll("button.devmode").forEach(b => b.onclick = () => { ctx._devMode = b.dataset.m; render(root, ctx); });
  root.querySelectorAll("button.conceptbtn").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_concept", player: ctx.myPlayer, concept: b.dataset.c }); });
  root.querySelectorAll("button.devfocus").forEach(b => b.onclick = () => { ctx.send({ cmd: "career_devfocus", player: ctx.myPlayer, focus: +b.dataset.f }); });
  root.querySelectorAll("button.fuelload").forEach(b => b.onclick = () => { ctx.send({ cmd: "set_fuel_load", value: b.dataset.fl === "" ? null : parseFloat(b.dataset.fl) }); });
  root.querySelectorAll("button.pubtn").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_pu_project", player: ctx.myPlayer, part: b.dataset.k, size: b.dataset.sz }); });
  root.querySelectorAll("button.puprog").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_pu_program", player: ctx.myPlayer, kind: b.dataset.kind }); });
  root.querySelectorAll("button.pucontract").forEach(b => b.onclick = () => { ctx.send({ cmd: "career_pu_contract", player: ctx.myPlayer, spec: b.dataset.k }); });
  root.querySelectorAll("button.propok").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_proposal_resolve", player: ctx.myPlayer, approve: true }); });
  root.querySelectorAll("button.propno").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_proposal_resolve", player: ctx.myPlayer, approve: false }); });
  root.querySelectorAll("button.resign").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_resign", player: ctx.myPlayer, abbrev: b.dataset.ab }); });
  root.querySelectorAll("button.trainbtn").forEach(b => b.onclick = () => { ctx.send({ cmd: "career_train", player: ctx.myPlayer, abbrev: b.dataset.ab, focus: b.dataset.f }); });
  root.querySelectorAll("button.reqbtn").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_driver_req", player: ctx.myPlayer, abbrev: b.dataset.ab, accept: b.dataset.ok === "1" }); });
  root.querySelectorAll("button.stf").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_upgrade", player: ctx.myPlayer, kind: b.dataset.kind, key: b.dataset.key }); });
  root.querySelectorAll("button.hire").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_hire", player: ctx.myPlayer, id: b.dataset.id }); });
  root.querySelectorAll("button.stafffilter").forEach(b => b.onclick = () => { ctx._staffFilter = b.dataset.f; render(root, ctx); });
  root.querySelectorAll("button.trainstaff").forEach(b => b.onclick = () => { ctx.send({ cmd: "career_staff_train", player: ctx.myPlayer, role: b.dataset.role }); });
  root.querySelectorAll("button.pctrain").forEach(b => b.onclick = () => { ctx.send({ cmd: "career_pit_train", player: ctx.myPlayer }); });
  root.querySelectorAll("button.pcpractice").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_pit_practice", player: ctx.myPlayer }); });
  root.querySelectorAll("button.pcrecruit").forEach(b => b.onclick = () => { b.disabled = true; let cand = null; try { cand = JSON.parse(b.dataset.cand); } catch (e) {} ctx.send({ cmd: "career_pit_recruit", player: ctx.myPlayer, cand }); });
  root.querySelectorAll("button.rsstaff").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_resign_staff", player: ctx.myPlayer, role: b.dataset.role }); });
  root.querySelectorAll("button.clbtn").forEach(b => b.onclick = () => { const k = b.dataset.cl; const key = k === "bonuses" ? "_clBonus" : k === "lead" ? "_clLead" : "_clRelease"; ctx[key] = !ctx[key]; render(root, ctx); });
  root.querySelectorAll("button.sign").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_sign", player: ctx.myPlayer, inAbbrev: b.dataset.in, outAbbrev: b.dataset.out, length: +(b.dataset.len || 2), clauses: { bonuses: b.dataset.clb === "1", lead: b.dataset.cll === "1", release: b.dataset.clr === "1" } }); });
  root.querySelectorAll("button.signaccept").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_sign_accept", player: ctx.myPlayer }); });
  root.querySelectorAll("button.signcancel").forEach(b => b.onclick = () => { ctx.send({ cmd: "career_sign_cancel", player: ctx.myPlayer }); });
  root.querySelectorAll("button.mktsort").forEach(b => b.onclick = () => { ctx._mktSort = b.dataset.k; render(root, ctx); });
  root.querySelectorAll("button.mktfa").forEach(b => b.onclick = () => { ctx._mktFA = !ctx._mktFA; render(root, ctx); });
  root.querySelectorAll("button.signlen").forEach(b => b.onclick = () => { ctx._signLen = +b.dataset.l; render(root, ctx); });
  root.querySelectorAll("button.scout").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_scout", player: ctx.myPlayer, abbrev: b.dataset.j }); });
  root.querySelectorAll("button.scoutmore").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_scout_more", player: ctx.myPlayer, abbrev: b.dataset.j }); });
  root.querySelectorAll("button.promote").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_promote", player: ctx.myPlayer, abbrev: b.dataset.j, outAbbrev: b.dataset.out }); });
  root.querySelectorAll("button.jrole").forEach(b => b.onclick = () => { ctx.send({ cmd: "career_junior_role", player: ctx.myPlayer, abbrev: b.dataset.ab, role: b.dataset.role }); });
  root.querySelectorAll("button.jloan").forEach(b => b.onclick = () => { ctx.send({ cmd: "career_junior_loan", player: ctx.myPlayer, abbrev: b.dataset.ab, team: b.dataset.team }); });
  root.querySelectorAll("button.jextend").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_junior_extend", player: ctx.myPlayer, abbrev: b.dataset.ab }); });
  root.querySelectorAll("button.acadup").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_academy_upgrade", player: ctx.myPlayer }); });
  root.querySelectorAll("button.loanbtn").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_loan", player: ctx.myPlayer, amount: +b.dataset.amt }); });
  root.querySelectorAll("button.fundsbtn").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_funds", player: ctx.myPlayer, amount: +b.dataset.amt }); });
  root.querySelectorAll("button.focussp").forEach(b => b.onclick = () => ctx.send({ cmd: "set_bonus_focus", name: b.dataset.name }));
  const ssp = root.querySelector("button.signsponsor"); if (ssp) ssp.onclick = () => { ssp.disabled = true; ctx.send({ cmd: "career_sign_sponsor", player: ctx.myPlayer }); };
  const akeep = root.querySelector("button.acq-keep"); if (akeep) akeep.onclick = () => { akeep.disabled = true; ctx.send({ cmd: "career_acquire_accept", player: ctx.myPlayer, rebrand: false }); };
  const areb = root.querySelector("button.acq-rebrand"); if (areb) areb.onclick = () => { areb.disabled = true; ctx.send({ cmd: "career_acquire_accept", player: ctx.myPlayer, rebrand: true }); };
  const adec = root.querySelector("button.acq-decline"); if (adec) adec.onclick = () => { adec.disabled = true; ctx.send({ cmd: "career_acquire_decline", player: ctx.myPlayer }); };
  const sw = root.querySelector("#startwknd");
  if (sw) sw.onclick = () => { sw.disabled = true; ctx.send({ cmd: "career_start_weekend", player: ctx.myPlayer }); };
  const ns = root.querySelector("#newseason");
  if (ns) ns.onclick = () => { ns.disabled = true; ctx.send({ cmd: "career_newseason", player: ctx.myPlayer }); };
}
