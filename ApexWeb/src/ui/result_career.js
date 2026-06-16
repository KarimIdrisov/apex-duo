// ApexWeb/src/ui/result_career.js — post-race RESULTS screen for career mode: podium (top-3),
// stage finances and the full classification, with a "В паддок →" button. Render-only; reads
// ctx.careerView.lastResult (host + client both render from the broadcast career view). The button
// sends a coop-safe command (career_to_paddock) so either player can dismiss it; the host applies.
import { TEAMS } from "../data.js";
import { teamColor, teamInk, driverAvatar } from "./teamviz.js";

// money values are in $k; show $X.XXM at scale, $Xk below, with a sign.
const fmt = (n) => { const v = n || 0, a = Math.abs(v); const s = a >= 1000 ? `$${(a / 1000).toFixed(2)}M` : `$${Math.round(a)}k`; return (v < 0 ? "−" : "") + s; };

export function render(root, ctx) {
  const car = ctx.careerView, r = car && car.lastResult;
  if (!r) { root.innerHTML = `<div class="panel"><p class="label">Нет данных о гонке.</p></div>`; return; }
  const cls = r.classification || [];
  const myTeam = (TEAMS[car.teamIdx] || {}).name;

  // podium: render 2nd · 1st · 3rd so the winner is centred and tallest
  const order = [cls[1], cls[0], cls[2]], stepH = [104, 140, 84], medal = ["🥈", "🥇", "🥉"];
  const podium = order.map((c, i) => {
    if (!c) return `<div style="flex:1"></div>`;
    const col = teamColor(c.team), ink = teamInk(col);
    return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:8px">
        <div>${driverAvatar(c.abbrev, c.team, 54)}</div>
        <div style="font-weight:800;font-size:15px">${c.abbrev}</div>
        <div style="width:100%;height:${stepH[i]}px;background:${col};color:${ink};border-radius:8px 8px 0 0;display:flex;align-items:flex-start;justify-content:center;padding-top:8px;font-weight:800;font-size:20px">${medal[i]} P${c.pos}</div>
      </div>`;
  }).join("");

  const finRows = [
    ["Призовые Кубка конструкторов", r.prize], ["Спонсоры", r.sponsorIncome], ["Грант бекера", r.grant], ["ДВС (поставка/закупка)", r.supply],
    ["Операционные расходы", -r.runningCost], ["Зарплаты пилотов", -r.salaries], ["Персонал", -r.upkeep], ["Возврат кредита", -(r.loanPay || 0)],
  ].filter(([, v]) => v).map(([k, v]) => `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:13px"><span style="color:var(--muted)">${k}</span><span style="color:${(v || 0) < 0 ? 'var(--bad)' : 'var(--good)'}">${fmt(v)}</span></div>`).join("");

  const table = cls.map((c) => {
    const mine = c.team === myTeam, col = teamColor(c.team);
    return `<div style="display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:6px;${mine ? 'background:var(--content2)' : ''}">
        <span style="width:22px;text-align:right;font-weight:700;color:var(--muted)">${c.pos}</span>
        <span style="width:4px;height:16px;background:${col};border-radius:2px"></span>
        <span style="font-weight:700;width:46px">${c.abbrev}</span>
        <span style="color:var(--muted);font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.team}</span>
        ${c.retired ? `<span style="color:var(--bad);font-size:11px;font-weight:700">DNF</span>` : ""}
      </div>`;
  }).join("");

  root.innerHTML = `
    <div class="panel">
      <p class="label">Результат гонки</p>
      <h2 style="margin-top:2px">${r.gp}</h2>
      <div style="display:flex;align-items:flex-end;gap:10px;margin:14px 0 20px">${podium}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div>
          <p class="label">Финансы этапа</p>
          ${finRows}
          <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);margin-top:6px;padding-top:6px;font-weight:800"><span>Итого за этап</span><span style="color:${(r.net || 0) < 0 ? 'var(--bad)' : 'var(--good)'}">${fmt(r.net)}</span></div>
        </div>
        <div>
          <p class="label">Классификация</p>
          <div style="max-height:248px;overflow:auto">${table}</div>
        </div>
      </div>
      <button class="primary" id="toPaddock" style="width:100%;margin-top:18px">В паддок 