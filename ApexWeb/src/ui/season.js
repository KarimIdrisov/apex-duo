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
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--muted);margin-bottom:6px"><span style="font-weight:600;color:var(--ink)">Новый апгрейд</span><span>слоты ${slotsUsed}/${slotsMax}${c.costCap ? " · cost cap" : ""}</span></div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:3px">Размер:</div>${sizeSeg}
      <div style="font-size:11px;color:var(--muted);margin:6px 0 3px">Подход (риск ↔ надёжность):</div>${apSeg}
      <div style="margin-top:6px">${PARTS.map(partRow).join("")}</div>${unprovenLine}</div>` : "";
  // --- ДВС sub-tab: season PU resource + engine development ---
  const puResBlock = c.pu ? (() => { const used = c.pu.used || 1, pool = c.pu.pool || 4, wear = c.pu.wear || 0, pen = c.pu.penalty || 0; const life = Math.round((1 - wear) * 100);
    const cells = Array.from({ length: Math.max(pool, used) }, (_, i) => `<div style="flex:1;height:9px;border-radius:3px;background:${i < used - 1 ? "var(--muted)" : i === used - 1 ? "var(--good)" : "var(--content2)"};${i >= pool ? "outline:1px solid var(--bad)" : ""}"></div>`).join("");
    return `<div style="display:flex;gap:5px;margin:2px 0 6px">${cells}</div><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span style="color:var(--muted)">Силовые установки ${used}/${pool} · ресурс ${life}%</span>${pen ? `<span style="color:var(--bad);font-weight:700">штраф ${pen} мест</span>` : ""}</div>${barEl(life, life < 25 ? "var(--bad)" : life < 50 ? "#e0a92a" : "var(--good)", 5)}`; })() : "";
  const puRow = (pk) => { const lvl = pu[pk] || 0; const pj = (c.puProject && c.puProject.part === pk) ? c.puProject : null; const spec = PROJECT_SIZE[devSize]; const can = !c.puProject && c.money >= spec.cost;
    const action = pj ? `<span style="font-size:11px;color:var(--accent);font-weight:600">${devEta(c, pj)}</span>` : devBtn("pubtn", `data-k="${pk}" data-sz="${devSize}"`, can);
    return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid var(--border)"><div style="flex:1"><span style="font-weight:600;font-size:13px">${PU_LABEL[pk]}</span> <span style="color:var(--muted);font-size:11px">ур.${(lvl * 100).toFixed(0)}</span></div><div style="width:165px;text-align:right">${action}</div></div>`; };
  let engineView;
  if (bkr.puMaker) {
    engineView = `<div class="panel">${puResBlock}<p class="label" style="margin-top:12px">Свой ДВС — разработка ВНЕ кост-капа · поставка клиентам +${m$(SUPPLY_INCOME)}/этап</p><div style="font-size:11px;color:var(--muted);margin-bottom:3px">Размер:</div>${sizeSeg}<div style="margin-top:4px">${PU_PARTS.map(puRow).join("")}</div></div>`;
  } else if (c.puProgram) {
    engineView = `<div class="panel">${puResBlock}<p class="label" style="margin-top:12px">Программа своего ДВС</p><div style="font-weight:700">${(PU_PROGRAM[c.puProgram.kind] || {}).label || c.puProgram.kind}</div><p class="label" style="margin-top:4px">Готовность: ${devEta(c, c.puProgram)} → станешь заводской PU-командой.</p></div>`;
  } else {
    engineView = `<div class="panel">${puResBlock}<p class="label" style="margin-top:12px">Клиентский ДВС (поставщик ${bkr.supplier || "—"}, −${m$(SUPPLY_FEE)}/этап). Построй свой, чтобы развивать и продавать клиентам:</p><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">${Object.entries(PU_PROGRAM).map(([k, s]) => `<button class="puprog" data-kind="${k}" ${c.money < s.cost ? "disabled" : ""} style="flex:1;min-width:160px;padding:10px;text-align:left;border-radius:8px;background:var(--good);color:#04190d;font-weight:600">${s.label}<br><span style="font-size:11px;color:rgba(6,18,31,.78)">${m$(s.cost)} · ≈${s.days} дн.</span></button>`).join("")}</div></div>`;
  }
  // --- Стратегия sub-tab: concept + this/next-year focus ---
  const conceptCards = `<div style="display:flex;gap:8px;flex-wrap:wrap">${Object.entries(CONCEPT).map(([k, cc]) => { const on = k === (c.concept || "balanced"); return `<button class="conceptbtn" data-c="${k}" ${on ? "disabled" : ""} style="flex:1;min-width:150px;padding:10px;border-radius:8px;border:1px solid ${on ? "var(--good)" : "var(--border)"};background:${on ? "var(--good)" : "transparent"};color:${on ? "#04190d" : "var(--ink)"};text-align:left"><b>${cc.label}${on ? " ✓" : ""}</b><br><span style="font-size:11px;opacity:.85">${cc.hint}</span></button>`; }).join("")}</div>`;
  const FOCUS_OPTS = [[0, "Весь сезон сейчас"], [0.25, "25% на след. год"], [0.5, "50% на след. год"]];
  const focusOn = f => Math.abs((c.devFocus || 0) - f) < 0.01;
  const focusSeg = `<div style="display:flex;gap:6px">${FOCUS_OPTS.map(([f, l]) => `<button class="devfocus" data-f="${f}" style="flex:1;padding:8px 6px;border-radius:8px;border:1px solid ${focusOn(f) ? "var(--accent)" : "var(--border)"};background:${focusOn(f) ? "var(--accent)" : "transparent"};color:${focusOn(f) ? "#fff" : "var(--ink)"};font-size:11px;font-weight:600">${l}</button>`).join("")}</div>`;
  const bankedTot = c.nextCar ? Object.values(c.nextCar).reduce((a, b) => a + b, 0) : 0;
  const bankedLine = bankedTot > 0.0005 ? `<p class="label" style="opacity:.8;margin-top:4px">📦 Задел на след. год: +${(bankedTot * 100).toFixed(1)} — реализуется на старте сезона</p>` : "";
  const strategyView = me ? `<div class="panel"><p class="label">Концепт болида${(c.round === 0 || c.done) ? " · смена бесплатна (предсезон)" : " · смена в сезоне $3.5M"}</p>${conceptCards}
      <p class="label" style="margin-top:16px">Фокус разработки: текущая ↔ будущая машина</p>${focusSeg}${bankedLine}</div>` : "";
  const carTabBar = `<div class="seg" style="margin-bottom:12px">${[["chassis", "Шасси"], ["engine", "ДВС"], ["strategy", "Стратегия"]].map(([k, l]) => `<button class="cartab${k === carTab ? " on" : ""}" data-ct="${k}">${l}</button>`).join("")}</div>`;
  const carView = carTabBar + (carTab === "engine" ? engineView : carTab === "strategy" ? strategyView : chassisView);

  // drivers panel — the player team's two drivers (age / overall / morale / contract / salary)
  const myTeamIdx = TEAMS.findIndex(t => t.name === myTeamName);
  const mine = c.drivers ? Object.entries(c.drivers).filter(([, d]) => d.teamIdx === myTeamIdx) : [];
  // --- rich driver card (G1–G4): identity, form/morale, contract, season stats, teammate H2H, training, attrs ---
  const dvCol = myTeamName ? teamColor(myTeamName) : "#888";
  const trChips = d => (d.traits || []).map(t => TRAITS[t] && TRAITS[t].label).filter(Boolean).map(l => `<span style="font-size:10px;background:var(--good);color:#06121f;border-radius:4px;padding:1px 6px;margin-right:4px">${l}</span>`).join("");
  const focusSet = d => new Set(((TRAINING[d.training] || {}).attrs) || []);
  const arrow = (d, k) => { const dr = attrDrift(k, d.age) + (focusSet(d).has(k) ? 0.004 : 0); return dr > 0.002 ? `<span style="color:var(--good)">▲</span>` : dr < -0.002 ? `<span style="color:var(--bad)">▼</span>` : ""; };
  const attrGrid = d => `<div style="display:grid;grid-template-columns:1fr 1fr;gap:3px 12px;margin-top:8px">${ATTR_KEYS.map(k => { const v = Math.round((d.attrs[k] || 0) * 100); return `<div style="display:flex;align-items:center;gap:5px"><span style="font-size:10px;color:var(--muted);width:66px;flex:none">${ATTR_RU[k]}</span><span style="flex:1;height:4px;background:rgba(255,255,255,.08);border-radius:2px;overflow:hidden"><span style="display:block;height:4px;width:${v}%;background:${dvCol}"></span></span><span style="font-size:10px;width:30px;text-align:right">${v}${arrow(d, k)}</span></div>`; }).join("")}</div>`;
  const statStrip = d => { const s = d.stats || {}; return `<div style="display:flex;flex-wrap:wrap;gap:10px;font-size:12px;margin-top:8px;color:var(--muted)"><span>🏆 <b style="color:var(--ink)">${s.wins || 0}</b></span><span>🥇 ${s.podiums || 0}</span><span>⚡ ${s.poles || 0}</span><span><b style="color:var(--ink)">${s.points || 0}</b> очк</span><span>🚩 ${s.dnf || 0}</span>${s.bestFin && s.bestFin < 99 ? `<span>луч. P${s.bestFin}</span>` : ""}</div>`; };
  const h2h = (ab, d) => { const tm = mine.find(([a]) => a !== ab); if (!tm) return ""; const o = tm[1].stats || {}, s = d.stats || {}; return `<div style="font-size:12px;margin-top:6px;color:var(--muted)">Дуэль с напарником — квала <b style="color:var(--ink)">${s.qH2H || 0}–${o.qH2H || 0}</b> · гонка <b style="color:var(--ink)">${s.rH2H || 0}–${o.rH2H || 0}</b></div>`; };
  const trainSel = (ab, d) => `<div style="margin-top:8px"><div style="font-size:11px;color:var(--muted);margin-bottom:3px">Тренировка (ускоряет навыки):</div><div style="display:flex;gap:4px;flex-wrap:wrap">${[...Object.entries(TRAINING), ["", { label: "— нет" }]].map(([k, t]) => { const on = (d.training || "") === k; return `<button class="trainbtn" data-ab="${ab}" data-f="${k}" style="padding:4px 8px;border-radius:6px;border:1px solid ${on ? "var(--accent)" : "var(--border)"};background:${on ? "var(--accent)" : "transparent"};color:${on ? "#fff" : "var(--ink)"};font-size:11px">${t.label}</button>`; }).join("")}</div></div>`;
  const reqPanel = (ab, d) => d.request ? `<div style="margin-top:8px;padding:8px 10px;border:1px solid var(--accent);border-radius:8px;background:rgba(56,139,253,.08)"><div style="font-size:12px;margin-bottom:6px">💬 ${d.request.text}</div><div style="display:flex;gap:6px"><button class="reqbtn" data-ab="${ab}" data-ok="1" style="padding:5px 12px;border-radius:7px;background:var(--good);color:#04190d;font-weight:700;font-size:12px">Принять</button><button class="reqbtn" data-ab="${ab}" data-ok="0" style="padding:5px 12px;border-radius:7px;background:transparent;border:1px solid var(--border);color:var(--ink);font-size:12px">Отклонить</button></div></div>` : "";
  const statusChip = d => d.status === "lead" ? `<span style="font-size:10px;background:#e0a92a;color:#1a1205;border-radius:4px;padding:1px 6px;font-weight:700">★ 1-й номер</span>` : d.status === "support" ? `<span style="font-size:10px;color:var(--muted);border:1px solid var(--border);border-radius:4px;padding:0 6px">саппорт</span>` : "";
  const mCol = m => m >= 0.6 ? "var(--good)" : m >= 0.4 ? "#e0a92a" : "var(--bad)";
  const dCard = (ab, d) => { const m = d.morale ?? 0.6, f = d.form ?? 0.5; return `<div style="background:var(--content2);border:1px solid var(--border);border-left:4px solid ${dvCol};border-radius:var(--r-md);padding:12px">
      <div style="display:flex;align-items:flex-start;gap:10px">${driverAvatar(ab, myTeamName, 46)}
        <div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap"><b>${DRIVER_NAME[ab] || ab}</b>${statusChip(d)}<span style="font-size:11px;color:var(--muted)">${d.age} лет</span></div><div style="margin-top:4px">${trChips(d)}</div></div>
        <div style="text-align:right"><div style="font-size:10px;color:var(--muted)">OVR</div><div style="font-weight:800;font-size:22px;color:${dvCol}">${Math.round(d.overall * 100)}</div></div></div>
      <div style="display:flex;gap:14px;margin-top:10px;font-size:12px">
        <div style="flex:1"><div style="display:flex;justify-content:space-between;color:var(--muted)"><span>Форма</span><span>${Math.round(f * 100)}%</span></div>${barEl(f * 100, "var(--accent)", 4)}</div>
        <div style="flex:1"><div style="display:flex;justify-content:space-between;color:var(--muted)"><span>Настроение</span><span style="color:${mCol(m)}">${moraleReason(d)}</span></div>${barEl(m * 100, mCol(m), 4)}</div></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-size:12px"><span style="color:var(--muted)">Контракт: <b style="color:var(--ink)">${d.contractSeasons}</b> сез · ${m$(d.salary)}/гонка</span><button class="resign" data-ab="${ab}" style="background:transparent;border:1px solid var(--border);color:var(--ink);border-radius:7px;padding:4px 10px;font-size:12px;font-weight:600">Продлить</button></div>
      ${reqPanel(ab, d)}${statStrip(d)}${h2h(ab, d)}${trainSel(ab, d)}${attrGrid(d)}</div>`; };
  const driversPanel = mine.length ? `<div class="panel"><p class="label">Пилоты</p><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:12px">${mine.map(([ab, d]) => dCard(ab, d)).join("")}</div></div>` : "";

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
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:11px"><span style="color:${contrLow ? "#e0a92a" : "var(--muted)"}">контракт ${contr} сез</span><button class="rsstaff" data-role="${rk}" style="padding:2px 8px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--ink);font-size:11px">Продлить</button></div>
        <div style="display:flex;gap:6px;margin-top:7px"><button class="trainstaff" data-role="${rk}" style="flex:1;padding:5px;border-radius:7px;border:1px solid ${trainOn(rk) ? "var(--accent)" : "var(--border)"};background:${trainOn(rk) ? "var(--accent)" : "transparent"};color:${trainOn(rk) ? "#fff" : "var(--ink)"};font-size:11px;font-weight:600">${trainOn(rk) ? "🎓 обучение ✓" : "🎓 обучать"}</button>${upBtn("ready stf", `data-kind="staff" data-key="${rk}"`, can, `+ ${m$(cost)}`)}</div></div>`; };
  const facBuilding = which => c.facilityProject && c.facilityProject.which === which ? c.facilityProject : null;
  const facCard = fk => { const lvl = st.facilities[fk], cost = FAC_UPGRADE_BASE * (lvl + 1); const bp = facBuilding(fk); const busy = !!c.facilityProject;
    const can = lvl < FAC_MAX && c.money >= cost && !busy;
    const affects = fk === "design" ? "ускоряет разработку и стратегию" : fk === "pit" ? "ускоряет пит-стопы" : `слотов разработки ${1 + Math.floor(lvl / 2)} · содержание`;
    const action = lvl >= FAC_MAX ? `<span style="font-size:11px;color:var(--muted)">максимум</span>`
      : bp ? `<span style="font-size:11px;color:var(--accent)">🏗 ${devEta(c, bp)}</span>`
      : busy ? `<span style="font-size:11px;color:var(--muted)">идёт другая стройка</span>`
      : upBtn("ready stf", `data-kind="facility" data-key="${fk}"`, can, `Строить ${m$(cost)}`);
    return `<div style="background:var(--content2);border:1px solid var(--border);border-radius:var(--r-md);padding:11px 12px">
        <div style="display:flex;justify-content:space-between;align-items:baseline"><b style="font-size:13px">${FAC_LABEL[fk]}</b><span style="font-size:12px;color:var(--muted)">ур. <b style="color:var(--ink)">${lvl}</b>/${FAC_MAX}</span></div>
        <div style="font-size:11px;color:var(--muted);margin:2px 0 5px">${affects}</div><div style="display:flex;gap:3px">${Array.from({ length: FAC_MAX }, (_, i) => `<div style="flex:1;height:6px;border-radius:2px;background:${i < lvl ? dvCol : (bp && i === lvl ? "var(--accent)" : "var(--content3)")}"></div>`).join("")}</div>
        <div style="margin-top:8px;text-align:right">${action}</div></div>`; };
  const staffPanel = st ? `<div class="panel"><p class="label">Штаб</p>${hqHeader}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(205px,1fr));gap:10px">${STAFF_ROLES.map(roleCard).join("")}${FACILITIES.map(facCard).join("")}</div></div>` : "";
  // staff market — compact, role-filterable; specialists give concrete bonuses (T2)
  const mktFilter = ctx._staffFilter || "all";
  const mkt = st ? staffMarketAll(c, c.season || 1) : [];   // free agents + poachable rival staff
  const filtered = mkt.filter(p => mktFilter === "all" || p.role === mktFilter).slice(0, 14);
  const filterBar = `<div style="display:flex;gap:5px;margin-bottom:8px;flex-wrap:wrap">${[["all", "Все"], ...STAFF_ROLES.map(r => [r, ROLE_LABEL[r]])].map(([k, l]) => `<button class="stafffilter" data-f="${k}" style="padding:4px 9px;border-radius:6px;border:1px solid ${k === mktFilter ? "var(--accent)" : "var(--border)"};background:${k === mktFilter ? "var(--accent)" : "transparent"};color:${k === mktFilter ? "#fff" : "var(--ink)"};font-size:11px">${l}</button>`).join("")}</div>`;
  const mktRow = p => { const fee = staffHireFee(p), better = p.rating > (st[p.role] || 0), sp = SPECIALTIES[p.specialty], can = c.money >= fee && better;
    return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid var(--border)">
        <div style="flex:1;min-width:0"><div style="font-size:13px"><b>${p.name}</b> <span style="font-size:11px;color:var(--muted)">${ROLE_LABEL[p.role]}</span>${p.team ? ` <span style="font-size:10px;color:#e0a92a;border:1px solid #e0a92a;border-radius:4px;padding:0 5px">${p.team}</span>` : ` <span style="font-size:10px;color:var(--good)">свободен</span>`}</div>${sp ? `<div style="font-size:11px;color:var(--accent)">${sp.label} · ${sp.fxLabel}</div>` : ""}</div>
        <span style="font-size:14px;font-weight:800;width:38px;text-align:right;color:${better ? "var(--good)" : "var(--muted)"}">${Math.round(p.rating * 100)}</span>
        <button class="ready hire" data-id="${p.id}" ${can ? "" : "disabled"} title="${p.team ? "переманить (с премией)" : "нанять"}" style="padding:4px 10px;border-radius:7px;background:${can ? "var(--good)" : "var(--content2)"};color:${can ? "#04190d" : "var(--muted)"};font-size:12px;font-weight:700;width:128px">${p.team ? "Переманить" : "Нанять"} ${m$(fee)}</button></div>`; };
  const staffMarketPanel = st ? `<div class="panel"><p class="label">Рынок специалистов · свободные + соперники</p>${filterBar}${filtered.map(mktRow).join("") || `<p class="label">Нет по фильтру</p>`}</div>` : "";

  // --- Трансферы: rich market cards + interest + negotiation + rumors ---
  const mineAbbrevs = mine.map(([ab]) => ab);
  const signLen = ctx._signLen || 2;
  const meStrength = me ? 1 - (me.pos - 1) / Math.max(1, cons.length - 1) : 0.5;
  const intCol = p => p >= 66 ? "var(--good)" : p >= 40 ? "#e0a92a" : "var(--bad)";
  const TATTR = [["pace", "Темп"], ["quali", "Квала"], ["race_iq", "Гонка"], ["tyre", "Резина"], ["overtaking", "Обгон"], ["wet", "Дождь"]];
  const faOnly = !!ctx._mktFA, sortKey = ctx._mktSort || "ovr";
  let avail = c.drivers ? availableDrivers(c) : [];
  if (faOnly) avail = avail.filter(freeAgent);
  avail = avail.sort((a, b) => sortKey === "value" ? signCostAt(a, signLen) - signCostAt(b, signLen) : sortKey === "age" ? a.age - b.age : b.overall - a.overall).slice(0, 8);
  const segB = (on, l, cls, data) => `<button class="${cls}" ${data} style="padding:4px 9px;border-radius:6px;border:1px solid ${on ? "var(--accent)" : "var(--border)"};background:${on ? "var(--accent)" : "transparent"};color:${on ? "#fff" : "var(--ink)"};font-size:11px">${l}</button>`;
  const tcontrols = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
      <div style="display:flex;gap:5px">${[["ovr", "OVR"], ["value", "Цена"], ["age", "Возраст"]].map(([k, l]) => segB(k === sortKey, l, "mktsort", `data-k="${k}"`)).join("")}</div>
      ${segB(faOnly, "Только свободные", "mktfa", "")}
      <div style="margin-left:auto;display:flex;align-items:center;gap:5px"><span style="font-size:11px;color:var(--muted)">Контракт:</span>${[1, 2, 3].map(L => segB(L === signLen, `${L} сез`, "signlen", `data-l="${L}"`)).join("")}</div></div>`;
  const mktCard = d => { const fa = freeAgent(d), cost = signCostAt(d, signLen), ip = Math.round(interest(d, meStrength, signLen) * 100), curTeam = (TEAMS[d.teamIdx] || {}).name || "", buy = buyout(d), can = c.money >= cost;
    const attrs = TATTR.map(([k, l]) => `<span style="font-size:10px;color:var(--muted)">${l} <b style="color:var(--ink)">${Math.round((d.attrs && d.attrs[k] || 0) * 100)}</b></span>`).join(" · ");
    return `<div style="background:var(--content2);border:1px solid var(--border);border-radius:var(--r-md);padding:11px 12px">
        <div style="display:flex;align-items:flex-start;gap:10px">${driverAvatar(d.abbrev, curTeam, 44)}
          <div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><b>${DRIVER_NAME[d.abbrev] || d.abbrev}</b><span style="font-size:10px;color:var(--muted);border:1px solid var(--border);border-radius:4px;padding:0 5px">${curTeam}</span>${fa ? `<span style="font-size:10px;color:var(--good);font-weight:700">свободен</span>` : ""}<span style="font-size:11px;color:var(--muted)">${d.age} л.</span></div><div style="margin-top:4px">${attrs}</div></div>
          <div style="text-align:right"><div style="font-size:10px;color:var(--muted)">OVR</div><div style="font-weight:800;font-size:20px;color:var(--accent)">${Math.round(d.overall * 100)}</div></div></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;font-size:12px"><span style="color:var(--muted)">Интерес к нам</span><span style="font-weight:700;color:${intCol(ip)}">${ip}%</span></div>${barEl(ip, intCol(ip), 4)}
        <div style="display:flex;justify-content:space-between;margin-top:7px;font-size:12px"><span style="color:var(--muted)">Цена${buy ? " (трансфер+выкуп)" : " (свободен)"}</span><b>${m$(cost)}</b></div>
        <div style="display:flex;gap:6px;margin-top:8px">${mine.map(([ab]) => `<button class="ready sign" data-in="${d.abbrev}" data-out="${ab}" data-len="${signLen}" ${can ? "" : "disabled"} style="flex:1;padding:5px;border-radius:7px;background:${can ? "var(--good)" : "var(--content2)"};color:${can ? "#04190d" : "var(--muted)"};font-size:11px;font-weight:700">Вместо ${ab}</button>`).join("")}</div></div>`; };
  const transferPanel = (mineAbbrevs.length && c.drivers) ? `<div class="panel"><p class="label">Трансферы — подписать пилота (замена одного из твоих)</p>${tcontrols}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px">${avail.map(mktCard).join("") || `<p class="label">Нет пилотов по фильтру</p>`}</div></div>` : "";
  // rumors feed: rival interest in your drivers + free-agent count + recent moves
  const ri = c.drivers ? rivalInterest(c) : [];
  const faCount = c.drivers ? availableDrivers(c).filter(freeAgent).length : 0;
  const transferRumors = c.drivers ? `<div class="panel"><p class="label">📰 Слухи рынка</p>
      ${ri.length ? ri.map(x => `<p class="label" style="color:#e0a92a;margin:3px 0">⚠ Соперники интересуются ${DRIVER_NAME[x.abbrev] || x.abbrev} (контракт кончается) — продли, чтобы не потерять.</p>`).join("") : `<p class="label" style="margin:3px 0">Твои пилоты под контролем.</p>`}
      <p class="label" style="margin:5px 0">Свободных агентов на рынке: <b style="color:var(--ink)">${faCount}</b></p>
      ${(c.news || []).filter(n => /Трансфер|ушёл к сопернику|подписан/i.test(n)).slice(0, 4).map(n => `<p class="label" style="margin:2px 0">• ${n}</p>`).join("")}</div>` : "";

  // academy panel — your juniors (develop -> promote) + scouting from the pool
  const acad = c.academy || [];
  const scout = c.drivers ? availableJuniors(c).slice(0, 4) : [];
  const jtip = j => personTipAttrs({ abbrev: j.abbrev, overall: j.overall, team: myTeamName, name: j.name, age: j.age });
  const canPromote = j => j.overall >= SUPERLICENSE || (j.slPoints || 0) >= SL_NEEDED;   // D7: overall OR superlicense points
  const acadRows = acad.map(j => { const isRes = c.reserve === j.abbrev;
    return row([`<span ${jtip(j)} style="cursor:default"><b>${j.abbrev}</b> ${j.name}</span>`,
    `${j.age} л.`, `ovr ${j.overall.toFixed(3)}`, `СЛ ${j.slPoints || 0}/${SL_NEEDED}`,
    `<button class="ready reserve" data-ab="${j.abbrev}" style="padding:3px 6px;font-size:11px;${isRes ? "background:var(--good);color:#06121f" : ""}">${isRes ? "★ резерв" : "резерв"}</button>`,
    canPromote(j)
      ? mineAbbrevs.map(ab => `<button class="ready promote" data-j="${j.abbrev}" data-out="${ab}" style="padding:3px 6px;font-size:11px;margin-left:4px">▲${ab}</button>`).join("")
      : `<span class="label">нужен ovr ${SUPERLICENSE} или СЛ ${SL_NEEDED}</span>`]); }).join("");
  const scoutRows = scout.map(j => row([`<span ${jtip(j)} style="cursor:default"><b>${j.abbrev}</b> ${j.name}</span>`, `${j.age} л.`, `ovr ${j.overall.toFixed(3)}`, `пот. ${j.potential.toFixed(2)}`,
    `<button class="ready scout" data-j="${j.abbrev}" ${c.money < SCOUT_FEE ? "disabled" : ""} style="padding:3px 8px;font-size:11px">Подписать (${m$(SCOUT_FEE)})</button>`])).join("");
  const academyPanel = c.drivers ? `<div class="panel"><p class="label">Академия</p>
    ${acad.length ? `<table style="width:100%;border-collapse:collapse"><tbody>${acadRows}</tbody></table>` : `<p class="label">нет юниоров</p>`}
    ${(c.lastFeeder && c.lastFeeder.length) ? `<div style="height:6px"></div><p class="label">Серия F2 — прошлый сезон</p>
    <table style="width:100%;border-collapse:collapse"><tbody>${c.lastFeeder.map(s => row([`${s.pos}`, `${s.name || s.abbrev}${s.abbrev ? ` <span class="label">(академия)</span>` : ""}`, `${s.pts} оч.`])).join("")}</tbody></table>` : ""}
    <div style="height:6px"></div><p class="label">Скаутинг</p>
    <table style="width:100%;border-collapse:collapse"><tbody>${scoutRows}</tbody></table></div>` : "";

  // season-start title-sponsor choice
  let offers = "";
  if (c.pendingOffers && c.pendingOffers.length) {
    offers = `<div class="panel"><p class="label">Выбери титульного спонсора на сезон</p>
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
    footer = `<div class="panel"><h3>Сезон ${c.season} завершён</h3>
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
    footer = `<div class="panel"><p class="label">Следующий этап · раунд ${c.round + 1} из ${CALENDAR.length}</p>
      <h3 style="margin-bottom:2px">${nextR.name}</h3>
      <p class="label" style="margin:0 0 2px">${nextR.shape} · ${nextR.laps} кругов</p>
      <p class="label" style="margin:0 0 4px">📅 ${fmtDate(c.season, c.round)}${SPRINTS.has(c.round) ? ` · <span style="color:var(--accent)">спринт</span>` : ""}</p>
      ${(c.pu && c.pu.penalty) ? `<p class="label" style="color:var(--bad);margin:0 0 6px">⚠ Штраф ДВС: старт на ${c.pu.penalty} мест ниже</p>` : ""}
      ${gapHint}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin:6px 0 12px">
        ${miniBar("Прижим", nextR.df)}${miniBar("Мощность", nextR.pw)}${miniBar("Обгон", nextR.ot)}${miniBar("Дождь", nextR.wet)}</div>
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
  const dashboardHero = me ? `<div class="panel">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
        ${heroBadge}
        <div><div style="font-size:12px;color:var(--muted)">Сезон ${c.season} · цель P${c.board ? c.board.targetPos : "-"} · 📅 ${c.done ? "межсезонье" : fmtDate(c.season, c.round)}</div>
          <div style="font-size:22px;font-weight:800">${teamName}</div></div>
        <div style="margin-left:auto;text-align:right"><div style="font-size:12px;color:var(--muted)">Кубок конструкторов</div>
          <div style="font-size:28px;font-weight:800;line-height:1;color:${teamCol}">P${me.pos}<span style="font-size:14px;color:var(--muted)"> / ${cons.length}</span></div></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">
        ${kpiCard("Бюджет", m$(c.money), `<div style="font-size:11px;color:var(--muted);margin-top:4px">${lastNet}</div>`)}
        ${kpiCard("Очки команды", me.pts, `<div style="font-size:11px;color:var(--muted);margin-top:4px">${gapTxt}</div>`)}
        ${kpiCard("Доверие совета", `${Math.round(conf * 100)}%`, barEl(conf * 100, confColor(conf)))}
        ${kpiCard("Прогресс сезона", `${c.round} / ${total}`, barEl(c.round / total * 100, "var(--accent)"))}
      </div></div>` : "";
  const standRow = (r) => `<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;${r.isPlayer ? "background:var(--content2)" : ""}">
      <span style="width:20px;text-align:right;font-weight:800;color:var(--muted)">${r.pos}</span>
      <span style="width:4px;height:16px;background:${teamColor(r.team)};border-radius:2px"></span>
      <img src="assets/teams/${TEAM_LOGO[r.team]}.png" style="height:16px">
      <span style="flex:1;font-weight:${r.isPlayer ? 700 : 500}">${r.team}</span>
      <span style="font-weight:800">${r.pts}</span></div>`;
  const playerExtra = (me && me.pos > 5) ? `<div style="border-top:1px dashed var(--border);margin-top:4px;padding-top:4px">${standRow(me)}</div>` : "";
  const miniStandings = `<div class="panel" style="flex:1;min-width:260px"><p class="label">Кубок конструкторов</p>${cons.slice(0, 5).map(standRow).join("")}${playerExtra}</div>`;
  const top3 = lr ? (lr.classification || []).slice(0, 3) : [];
  const myCars = (lr && me) ? (lr.classification || []).filter(x => x.team === me.team).map(x => `P${x.pos}`).join(" · ") : "";
  const lastRaceCard = `<div class="panel" style="flex:1;min-width:260px"><p class="label">Последняя гонка${lr ? ` · ${lr.gp}` : ""}</p>
    ${lr ? `<div style="display:flex;gap:6px;margin:8px 0">
        ${top3.map((x, i) => { const col = teamColor(x.team); return `<div style="flex:1;background:${col};color:${teamInk(col)};border-radius:8px;padding:8px;text-align:center"><div style="font-size:11px;opacity:.85">${["🥇", "🥈", "🥉"][i]} P${x.pos}</div><div style="font-weight:800">${x.abbrev}</div></div>`; }).join("")}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--muted)">Твои машины</span><span style="font-weight:700">${myCars || "—"}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-top:3px"><span style="color:var(--muted)">Итог по деньгам</span><span style="font-weight:700;color:${lr.net >= 0 ? "var(--good)" : "var(--bad)"}">${lr.net >= 0 ? "+" : "−"}${m$(Math.abs(lr.net))}</span></div>`
      : `<p class="label">Сезон ещё не начинался — впереди ${total} этапов.</p>`}</div>`;
  const objs = (c.board && c.board.objectives) ? evaluateObjectives(c) : [];
  const objectivesPanel = objs.length ? `<div class="panel"><p class="label">Задачи совета на сезон</p>
    ${objs.map(o => `<div style="margin:8px 0"><div style="display:flex;justify-content:space-between;font-size:13px"><span>${o.met ? "✅ " : ""}${o.label}</span><span style="color:var(--muted)">${Math.round(o.progress * 100)}%</span></div>${barEl(Math.min(1, o.progress) * 100, o.met ? "var(--good)" : "var(--accent)", 7)}</div>`).join("")}
    <p class="label" style="margin-top:8px;opacity:.7">След. сезон: ${regArcNote((c.season || 1) + 1)}</p></div>` : "";
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
  const newsPanel = (c.news && c.news.length) ? `<div class="panel"><p class="label">📰 Новости</p>${c.news.slice(0, 8).map(n => `<p class="label" style="margin:2px 0">• ${n}</p>`).join("")}</div>` : "";
  const standingsTab = `<div style="display:flex;gap:12px;flex-wrap:wrap">
      <div class="panel" style="flex:1;min-width:240px"><p class="label">Кубок конструкторов</p>
        <table style="width:100%;border-collapse:collapse"><tbody>${consTbl}</tbody></table></div>
      <div class="panel" style="flex:1;min-width:240px"><p class="label">Личный зачёт (топ-10)</p>
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
  const calendarTab = `<div class="panel"><p class="label">Календарь сезона ${c.season} · ${CALENDAR.length} этапов · ${fmtDate(c.season, 0)} — ${fmtDate(c.season, CALENDAR.length - 1)}</p>
    ${(c.projects || []).length ? `<p class="label" style="opacity:.85;color:var(--good)">✦ В разработке: ${(c.projects || []).map(p => `${PART_LABEL[p.part]} (${devEta(c, p)})`).join("; ")}</p>` : ""}
    ${calRows}
    <p class="label" style="margin-top:8px;opacity:.7">S — спринт · ✦ — готовность апгрейда · «бэк-ту-бэк» = мало времени на разработку, «перерыв» = много</p></div>`;
  const TABS = [["overview", "Обзор"], ["calendar", "Календарь"], ["finance", "Финансы"], ["car", "Машина"], ["drivers", "Пилоты"], ["staff", "Команда"], ["transfers", "Трансферы"], ["academy", "Академия"], ["standings", "Зачёт"]];
  const TAB_CONTENT = {
    overview:  dashboardHero + acquirePanel + `<div style="display:flex;gap:12px;flex-wrap:wrap">${miniStandings}${lastRaceCard}</div>` + objectivesPanel + newsPanel + offers,
    calendar:  calendarTab,
    finance:   financeTab,
    car:       me ? carView : emptyMsg("Нет данных по машине"),
    drivers:   driversPanel || emptyMsg("Нет пилотов"),
    staff:     st ? `<div class="prow">${staffPanel}${staffMarketPanel}</div>` : emptyMsg("Нет данных по команде"),
    transfers: transferPanel ? transferRumors + transferPanel : emptyMsg("Нет доступных трансферов"),
    academy:   academyPanel || emptyMsg("Академия недоступна"),
    standings: standingsTab,
  };
  const tabBar = `<div class="pad-tabs">${TABS.map(([k, l]) => `<button class="pad-tab${k === ctx._padTab ? " on" : ""}" data-tab="${k}">${l}</button>`).join("")}</div>`;
  root.innerHTML = tabBar + `<div id="pad-content">${TAB_CONTENT[ctx._padTab] || TAB_CONTENT.overview}</div>` + `<div class="pad-foot">${footer}</div>`;
  attachPersonTips(root);
  root.querySelectorAll(".pad-tab").forEach(b => b.onclick = () => { ctx._padTab = b.dataset.tab; render(root, ctx); });

  root.querySelectorAll("button.offer").forEach(b => b.onclick = () => { root.querySelectorAll("button.offer").forEach(x => x.disabled = true); ctx.send({ cmd: "career_sponsor", player: ctx.myPlayer, offerIdx: +b.dataset.i }); });
  root.querySelectorAll("button.devbtn").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_project", player: ctx.myPlayer, part: b.dataset.k, size: b.dataset.sz, approach: b.dataset.ap }); });
  root.querySelectorAll("button.devapproach").forEach(b => b.onclick = () => { ctx._devApproach = b.dataset.ap; render(root, ctx); });
  root.querySelectorAll("button.cartab").forEach(b => b.onclick = () => { ctx._carTab = b.dataset.ct; render(root, ctx); });
  root.querySelectorAll("button.devsize").forEach(b => b.onclick = () => { ctx._devSize = b.dataset.sz; render(root, ctx); });
  root.querySelectorAll("button.conceptbtn").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_concept", player: ctx.myPlayer, concept: b.dataset.c }); });
  root.querySelectorAll("button.devfocus").forEach(b => b.onclick = () => { ctx.send({ cmd: "career_devfocus", player: ctx.myPlayer, focus: +b.dataset.f }); });
  root.querySelectorAll("button.pubtn").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_pu_project", player: ctx.myPlayer, part: b.dataset.k, size: b.dataset.sz }); });
  root.querySelectorAll("button.puprog").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_pu_program", player: ctx.myPlayer, kind: b.dataset.kind }); });
  root.querySelectorAll("button.resign").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_resign", player: ctx.myPlayer, abbrev: b.dataset.ab }); });
  root.querySelectorAll("button.trainbtn").forEach(b => b.onclick = () => { ctx.send({ cmd: "career_train", player: ctx.myPlayer, abbrev: b.dataset.ab, focus: b.dataset.f }); });
  root.querySelectorAll("button.reqbtn").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_driver_req", player: ctx.myPlayer, abbrev: b.dataset.ab, accept: b.dataset.ok === "1" }); });
  root.querySelectorAll("button.stf").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_upgrade", player: ctx.myPlayer, kind: b.dataset.kind, key: b.dataset.key }); });
  root.querySelectorAll("button.hire").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_hire", player: ctx.myPlayer, id: b.dataset.id }); });
  root.querySelectorAll("button.stafffilter").forEach(b => b.onclick = () => { ctx._staffFilter = b.dataset.f; render(root, ctx); });
  root.querySelectorAll("button.trainstaff").forEach(b => b.onclick = () => { ctx.send({ cmd: "career_staff_train", player: ctx.myPlayer, role: b.dataset.role }); });
  root.querySelectorAll("button.rsstaff").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_resign_staff", player: ctx.myPlayer, role: b.dataset.role }); });
  root.querySelectorAll("button.sign").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_sign", player: ctx.myPlayer, inAbbrev: b.dataset.in, outAbbrev: b.dataset.out, length: +(b.dataset.len || 2) }); });
  root.querySelectorAll("button.mktsort").forEach(b => b.onclick = () => { ctx._mktSort = b.dataset.k; render(root, ctx); });
  root.querySelectorAll("button.mktfa").forEach(b => b.onclick = () => { ctx._mktFA = !ctx._mktFA; render(root, ctx); });
  root.querySelectorAll("button.signlen").forEach(b => b.onclick = () => { ctx._signLen = +b.dataset.l; render(root, ctx); });
  root.querySelectorAll("button.scout").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_scout", player: ctx.myPlayer, abbrev: b.dataset.j }); });
  root.querySelectorAll("button.promote").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_promote", player: ctx.myPlayer, abbrev: b.dataset.j, outAbbrev: b.dataset.out }); });
  root.querySelectorAll("button.reserve").forEach(b => b.onclick = () => { ctx.send({ cmd: "career_reserve", player: ctx.myPlayer, abbrev: b.dataset.ab }); });
  root.querySelectorAll("button.loanbtn").forEach(b => b.onclick = () => { b.disabled = true; ctx.send({ cmd: "career_loan", player: ctx.myPlayer, amount: +b.dataset.amt }); });
  const ssp = root.querySelector("button.signsponsor"); if (ssp) ssp.onclick = () => { ssp.disabled = true; ctx.send({ cmd: "career_sign_sponsor", player: ctx.myPlayer }); };
  const akeep = root.querySelector("button.acq-keep"); if (akeep) akeep.onclick = () => { akeep.disabled = true; ctx.send({ cmd: "career_acquire_accept", player: ctx.myPlayer, rebrand: false }); };
  const areb = root.querySelector("button.acq-rebrand"); if (areb) areb.onclick = () => { areb.disabled = true; ctx.send({ cmd: "career_acquire_accept", player: ctx.myPlayer, rebrand: true }); };
  const adec = root.querySelector("button.acq-decline"); if (adec) adec.onclick = () => { adec.disabled = true; ctx.send({ cmd: "career_acquire_decline", player: ctx.myPlayer }); };
  const sw = root.querySelector("#startwknd");
  if (sw) sw.onclick = () => { sw.disabled = true; ctx.send({ cmd: "career_start_weekend", player: ctx.myPlayer }); };
  const ns = root.querySelector("#newseason");
  if (ns) ns.onclick = () => { ns.disabled = true; ctx.send({ cmd: "career_newseason", player: ctx.myPlayer }); };
}
