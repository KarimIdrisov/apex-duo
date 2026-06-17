// ApexWeb/src/ui/preseason.js — pre-season setup screen: build the car (budget → part levels), pick a
// title sponsor, set the season ambition. Mutates `ctx.career`; "начать сезон" calls `onDone()` (the
// leftover budget already sits in career.money → carries as season cash). The car build is additive
// with a "сбросить" reset: the area→part mapping is many-to-one, so a per-area undo would be ambiguous
// — reset restores the snapshot taken on entry. All math comes from the pure preseason.js module.
import { stepCost, buildStep, autoBuild, AMBITIONS, applyAmbition } from "../preseason.js";
import { DEV_AREAS } from "../development.js";
import { chooseTitleSponsor } from "../career.js";
import { objectiveLabel } from "../sponsors.js";

const fmtM = k => "$" + (Math.round(k) / 1000).toFixed(1) + "M";
const AREA_LABEL = { aero: "Аэро / прижим", power: "Мотор / ERS", tyre: "Резина / баланс", fuel: "Эффективность", rel: "Надёжность" };

// render the screen. ctx needs { career }. onDone() is called when the player starts the season.
export function render(root, ctx, onDone) {
  const c = ctx.career;
  if (ctx._preBudget0 == null) { ctx._preBudget0 = c.money; ctx._preParts0 = JSON.stringify(c.parts || {}); }
  const total = ctx._preBudget0;
  const pct = Math.max(0, Math.min(100, total ? (c.money / total) * 100 : 0));
  const ambKey = Object.keys(AMBITIONS).find(k => AMBITIONS[k].reward === c.rewardMult) || null;
  const offers = c.pendingOffers || [];
  const titleName = (c.sponsors || []).find(s => s.kind === "title");

  const areaRow = a => {
    const cost = stepCost(c, a.key), can = c.money >= cost && isFinite(cost);
    return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--content2)">
      <span style="flex:1">${AREA_LABEL[a.key] || a.key}</span>
      <button class="preplus" data-a="${a.key}" ${can ? "" : "disabled"} style="padding:2px 10px">+ ${fmtM(cost)}</button>
    </div>`;
  };
  const offerChip = (o, i) => `<button class="presp" data-i="${i}" style="text-align:left;padding:7px 10px;margin:0 6px 6px 0">
    <b>${o.name}</b><br><span class="label">${fmtM(o.retainer)}/гонка + ${fmtM(o.bonus)} за «${objectiveLabel(o.objective)}»</span></button>`;
  const ambChip = k => { const a = AMBITIONS[k], sel = k === ambKey;
    return `<button class="preamb" data-k="${k}" style="text-align:left;padding:7px 10px;margin:0 6px 6px 0;${sel ? "outline:2px solid var(--good)" : ""}">
      <b>${a.label}</b><br><span class="label">цель тир${a.offset >= 0 ? "+" : ""}${a.offset} · награда ×${a.reward}</span></button>`; };

  root.innerHTML = `<div class="panel">
    <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:10px">
      <h2>Предсезонка — постройка болида</h2>
      <div style="text-align:right"><div class="label">осталось бюджета</div><div style="font-size:20px;font-weight:800">${fmtM(c.money)} <span class="label">/ ${fmtM(total)}</span></div></div>
    </div>
    <div style="height:8px;background:var(--content2);border-radius:4px;overflow:hidden;margin:8px 0 14px"><div style="width:${pct}%;height:100%;background:var(--good)"></div></div>

    <p class="label">Машина · по областям</p>
    ${DEV_AREAS.map(areaRow).join("")}
    <div style="margin-top:8px;display:flex;gap:8px">
      <button id="preauto">Авто · заполнить</button>
      <button id="prereset">Сбросить</button>
    </div>

    <p class="label" style="margin-top:14px">Титульный спонсор</p>
    <div>${offers.length ? offers.map(offerChip).join("") : `<span class="label" style="color:var(--muted)">выбран: ${titleName ? titleName.name : "—"}</span>`}</div>

    <p class="label" style="margin-top:10px">Амбиции на сезон</p>
    <div>${Object.keys(AMBITIONS).map(ambChip).join("")}</div>

    <button class="primary" id="prego" style="width:100%;margin-top:14px">Начать сезон · остаток ${fmtM(c.money)} в кассу →</button>
  </div>`;

  root.querySelectorAll(".preplus").forEach(el => el.onclick = () => { buildStep(c, el.dataset.a); render(root, ctx, onDone); });
  root.querySelector("#preauto").onclick = () => { autoBuild(c); render(root, ctx, onDone); };
  root.querySelector("#prereset").onclick = () => { c.money = ctx._preBudget0; c.parts = JSON.parse(ctx._preParts0); render(root, ctx, onDone); };
  root.querySelectorAll(".presp").forEach(el => el.onclick = () => { chooseTitleSponsor(c, +el.dataset.i); render(root, ctx, onDone); });
  root.querySelectorAll(".preamb").forEach(el => el.onclick = () => { applyAmbition(c, el.dataset.k); render(root, ctx, onDone); });
  root.querySelector("#prego").onclick = () => onDone();
}
