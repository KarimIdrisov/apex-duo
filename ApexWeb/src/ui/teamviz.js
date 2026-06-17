// ApexWeb/src/ui/teamviz.js — shared visual layer: team colours, readable ink, driver numbers,
// asset paths, tyre icon, driver avatar + card builders, and the hover skill-tooltip API
// (driverSkillTip/staffSkillTip + attachPersonTips). Pure UI; reads data.js/team.js/staff.js
// (read-only). No sim/network state.
import { TEAMS, TEAM_LOGO } from "../data.js";
import { driverAttrs, ATTR_KEYS, TRAITS } from "../team.js";
import { ROLE_LABEL } from "../staff.js";

const COLOR_BY_TEAM = {};
for (const t of TEAMS) COLOR_BY_TEAM[t.name] = t.color;

// team name -> hex; "#888" when unknown
export function teamColor(team) { return COLOR_BY_TEAM[team] || "#888"; }

// hex "#rrggbb" -> a readable text colour on that background. Relative luminance
// 0.299r+0.587g+0.114b (0..1); bright team colours (>0.55) get dark ink, else white.
export function teamInk(hex) {
  const h = (hex || "").replace("#", "");
  if (h.length < 6) return "#fff";
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? "#0a0a0c" : "#fff";
}

// confirmed real 2026 grid numbers (verified online): Norris #1 (reigning champion),
// Verstappen #3 (switched from 33), Lindblad #41 (rookie), Hadjar #6, Bortoleto #5.
export const DRIVER_NUM = {
  NOR: 1, PIA: 81, ANT: 12, RUS: 63, VER: 3, HAD: 6, LEC: 16, HAM: 44, SAI: 55, ALB: 23,
  ALO: 14, STR: 18, GAS: 10, COL: 43, LAW: 30, LIN: 41, OCO: 31, BEA: 87, HUL: 27, BOR: 5, PER: 11, BOT: 77,
};

export function teamLogoSrc(team) { return `assets/teams/${TEAM_LOGO[team]}.png`; }
export function carImgSrc(team)   { return `assets/cars/${TEAM_LOGO[team]}.png`; }

export function tyreIcon(compound, size = 16) {
  return `<img src="assets/tyres/${compound}.png" alt="${compound}" style="height:${size}px;width:${size}px;object-fit:contain;vertical-align:middle">`;
}

// A fixed-size avatar: base layer = team-colour block with the driver number (teamInk),
// photo layered on top. onerror hides the photo so the block shows when the file is missing.
export function driverAvatar(abbrev, team, size = 44) {
  const col = teamColor(team), ink = teamInk(col);
  const num = (DRIVER_NUM[abbrev] != null) ? DRIVER_NUM[abbrev] : abbrev;
  const fs = Math.round(size * 0.42);
  return `<span style="position:relative;display:inline-block;width:${size}px;height:${size}px;border-radius:8px;overflow:hidden;background:${col};vertical-align:middle;flex:0 0 auto">`
    + `<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${fs}px;color:${ink}">${num}</span>`
    + `<img src="assets/drivers/${abbrev}.png" alt="" onerror="this.style.display='none'" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top center">`
    + `</span>`;
}

// A team-coloured driver card: avatar + name + team chip + sub-line, optional car render + action.
// d = { team, abbrev, name, overall?, age? }. When overall is given, the card is a skill-tooltip trigger.
// opts = { car?:bool, sub?:html, action?:html }.
export function driverCard(d, opts = {}) {
  const col = teamColor(d.team), ink = teamInk(col);
  const tip = (d.overall != null)
    ? " " + personTipAttrs({ abbrev: d.abbrev, overall: d.overall, team: d.team, name: d.name, age: d.age })
    : "";
  const car = opts.car
    ? `<img src="${carImgSrc(d.team)}" alt="" onerror="this.style.display='none'" style="position:absolute;right:-6px;bottom:-22px;height:120px;object-fit:contain;opacity:.10;pointer-events:none">`
    : "";
  const sub = opts.sub ? `<div class="label" style="margin-top:3px">${opts.sub}</div>` : "";
  const act = opts.action ? `<div style="margin-top:6px">${opts.action}</div>` : "";
  return `<div${tip} style="position:relative;overflow:hidden;background:var(--content2);border:1px solid var(--border);border-left:4px solid ${col};border-radius:var(--r-md);padding:11px 12px;min-height:64px">`
    + `<div style="position:relative;display:flex;align-items:flex-start;gap:10px">`
    +   driverAvatar(d.abbrev, d.team, 46)
    +   `<div style="min-width:0;flex:1">`
    +     `<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap"><b>${d.name}</b>`
    +       `<span style="font-size:10px;font-weight:600;color:${ink};background:${col};border-radius:4px;padding:1px 6px">${d.team}</span></div>`
    +     sub + act
    +   `</div>`
    + `</div>` + car + `</div>`;
}

// A compact 13-axis spider/radar of a driver's attributes (pure SVG). Pure visual; reads attrs only.
export function attrRadar(attrs, color, size = 116) {
  const n = ATTR_KEYS.length, cx = size / 2, cy = size / 2, R = size / 2 - 10;
  const cl = v => Math.max(0, Math.min(1, v || 0));
  const pt = (i, r) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; };
  const ring = f => ATTR_KEYS.map((_, i) => pt(i, R * f).map(v => v.toFixed(1)).join(",")).join(" ");
  const rings = [0.25, 0.5, 0.75, 1].map(f => `<polygon points="${ring(f)}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="0.5"/>`).join("");
  const axes = ATTR_KEYS.map((_, i) => { const [x, y] = pt(i, R); return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,.06)" stroke-width="0.5"/>`; }).join("");
  const poly = ATTR_KEYS.map((k, i) => pt(i, R * cl(attrs[k])).map(v => v.toFixed(1)).join(",")).join(" ");
  const dots = ATTR_KEYS.map((k, i) => { const [x, y] = pt(i, R * cl(attrs[k])); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.3" fill="${color}"/>`; }).join("");
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="display:block" aria-hidden="true">${rings}${axes}<polygon points="${poly}" fill="${color}" fill-opacity="0.22" stroke="${color}" stroke-width="1.2" stroke-linejoin="round"/>${dots}</svg>`;
}

// RU labels for the 13 driver attributes (keys = ATTR_KEYS from team.js)
export const ATTR_RU = { pace: "Темп", quali: "Квала", tyre: "Резина", overtaking: "Обгон",
  defending: "Защита", consistency: "Стабильн.", composure: "Хладнокр.", aggression: "Агрессия",
  discipline: "Дисципл.", wet: "Дождь", starts: "Старт", race_iq: "Гонч. IQ", smoothness: "Плавность" };

// what each staff role affects (one line each)
export const STAFF_TIP = {
  designer: "Разработка машины: скорость R&D и прирост деталей.",
  strategist: "Питы, реакция на сейфти-кар и дождь, выбор стратегии гонки.",
  pitCrew: "Скорость пит-стопа — меньше потерь времени в боксах." };

// data-attr strings spliced into a hover target (values are quote-free: team names + Cyrillic names)
export function personTipAttrs({ abbrev, overall, team, name, age }) {
  return `data-driver="${abbrev}" data-ovr="${overall}" data-team="${team}" data-name="${name}" data-age="${age}"`;
}
export function staffTipAttrs({ role, val, team }) {
  return `data-staff="${role}" data-val="${val}" data-team="${team}"`;
}
// junior academy tooltip data (series-coloured, archetype-biased — no team yet)
export const SERIES_COLOR = { F4: "var(--series-f4)", F3: "var(--series-f3)", F2: "var(--series-f2)", F1: "var(--series-f1)" };
const SERIES_RU = { F4: "Ф4", F3: "Ф3", F2: "Ф2", F1: "Ф1" };
const PERSONA_RU = { loyal: "Преданный", mercenary: "Наёмник", hothead: "Вспыльчивый", ambitious: "Амбициозный" };
export function juniorTipAttrs({ abbrev, overall, name, age, series, tag, persona, morale }) {
  return `data-junior="${abbrev}" data-ovr="${overall}" data-name="${name}" data-age="${age}" data-series="${series || ""}" data-tag="${tag || ""}" data-persona="${persona || ""}" data-morale="${morale == null ? "" : morale}"`;
}

// pilot tooltip: header (avatar + name + age + OVR) + 13 team-coloured mini-bars, top-3 starred.
export function driverSkillTip(abbrev, overall, team, name, age) {
  const col = teamColor(team);
  const a = driverAttrs(abbrev, Number(overall));
  const vals = ATTR_KEYS.map(k => Math.round((a[k] || 0) * 100));
  const order = vals.map((v, i) => [v, i]).sort((x, y) => y[0] - x[0] || x[1] - y[1]);
  const topIdx = new Set(order.slice(0, 3).map(x => x[1]));
  const bars = ATTR_KEYS.map((k, i) => {
    const v = vals[i], t = topIdx.has(i);
    return `<div style="display:flex;align-items:center;gap:6px">`
      + `<span style="font-size:11px;color:${t ? "#ECEDEE" : "#A1A1AA"};width:74px;flex:0 0 auto">${ATTR_RU[k]}${t ? ` <span style="color:${col}">★</span>` : ""}</span>`
      + `<span style="flex:1;height:5px;background:rgba(255,255,255,.08);border-radius:3px;overflow:hidden"><span style="display:block;height:5px;width:${v}%;background:${col};opacity:${t ? 1 : 0.78}"></span></span>`
      + `<span style="font-size:11px;font-weight:600;width:18px;text-align:right;color:#ECEDEE">${v}</span></div>`;
  }).join("");
  return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:9px">`
    + driverAvatar(abbrev, team, 40)
    + `<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:14px">${name}</div>`
    +   `<div style="font-size:11px;color:#A1A1AA">${team} · ${age} лет</div></div>`
    + `<div style="text-align:right"><div style="font-size:10px;color:#A1A1AA">OVR</div>`
    +   `<div style="font-weight:800;font-size:20px;color:${col}">${Math.round(Number(overall) * 100)}</div></div></div>`
    + `<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px">${bars}</div>`;
}

// junior tooltip: same 13-bar layout as a pilot, but series-coloured and biased by archetype
// (the tag's attrs are lifted so the starred top-3 match the displayed archetype chip).
export function juniorSkillTip(abbrev, overall, name, age, series, tag, persona, morale) {
  const col = SERIES_COLOR[series] || "#888";
  const a = driverAttrs(abbrev, Number(overall));
  if (tag && TRAITS[tag]) for (const k in TRAITS[tag].attrs) a[k] = Math.min(0.99, (a[k] || 0) + TRAITS[tag].attrs[k] * 0.12);
  const vals = ATTR_KEYS.map(k => Math.round((a[k] || 0) * 100));
  const order = vals.map((v, i) => [v, i]).sort((x, y) => y[0] - x[0] || x[1] - y[1]);
  const topIdx = new Set(order.slice(0, 3).map(x => x[1]));
  const bars = ATTR_KEYS.map((k, i) => {
    const v = vals[i], t = topIdx.has(i);
    return `<div style="display:flex;align-items:center;gap:6px">`
      + `<span style="font-size:11px;color:${t ? "#ECEDEE" : "#A1A1AA"};width:74px;flex:0 0 auto">${ATTR_RU[k]}${t ? ` <span style="color:${col}">★</span>` : ""}</span>`
      + `<span style="flex:1;height:5px;background:rgba(255,255,255,.08);border-radius:3px;overflow:hidden"><span style="display:block;height:5px;width:${v}%;background:${col};opacity:${t ? 1 : 0.78}"></span></span>`
      + `<span style="font-size:11px;font-weight:600;width:18px;text-align:right;color:#ECEDEE">${v}</span></div>`;
  }).join("");
  const arche = (tag && TRAITS[tag]) ? TRAITS[tag].label : "—";
  const pers = persona && PERSONA_RU[persona] ? ` · ${PERSONA_RU[persona]}` : "";
  const mor = (morale !== undefined && morale !== "" && morale != null) ? Math.round(Number(morale) * 100) : null;
  const morLine = mor != null ? `<div style="display:flex;align-items:center;gap:6px;margin-top:7px"><span style="font-size:11px;color:#A1A1AA;width:74px">Мораль</span><span style="flex:1;height:5px;background:rgba(255,255,255,.08);border-radius:3px;overflow:hidden"><span style="display:block;height:5px;width:${mor}%;background:${mor >= 60 ? "var(--good)" : mor >= 40 ? "var(--warn)" : "var(--bad)"}"></span></span><span style="font-size:11px;font-weight:600;width:18px;text-align:right;color:#ECEDEE">${mor}</span></div>` : "";
  const av = `<span style="display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:9px;background:linear-gradient(135deg,${col}33,${col}11);border:1px solid ${col}66;font-weight:800;font-size:14px;color:${col};flex:0 0 auto">${abbrev}</span>`;
  return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:9px">${av}`
    + `<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:14px">${name}</div>`
    +   `<div style="font-size:11px;color:#A1A1AA">${SERIES_RU[series] || series} · ${age} лет · ${arche}${pers}</div></div>`
    + `<div style="text-align:right"><div style="font-size:10px;color:#A1A1AA">OVR</div>`
    +   `<div style="font-weight:800;font-size:20px;color:${col}">${Math.round(Number(overall) * 100)}</div></div></div>`
    + `<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px">${bars}</div>${morLine}`;
}

// staff tooltip: role + rating + bar + effect line. Letter-block avatar (no icon font in the game).
export function staffSkillTip(role, val, team) {
  const col = teamColor(team), ink = teamInk(col), v = Math.round(Number(val) * 100);
  const label = ROLE_LABEL[role] || role;
  return `<div style="display:flex;align-items:center;gap:9px;margin-bottom:9px">`
    + `<div style="width:38px;height:38px;border-radius:9px;background:${col};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;color:${ink}">${label[0]}</div>`
    + `<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:14px">${label}</div>`
    +   `<div style="font-size:11px;color:#A1A1AA">персонал · ${team}</div></div>`
    + `<div style="font-weight:800;font-size:20px;color:${col}">${v}</div></div>`
    + `<div style="height:6px;background:rgba(255,255,255,.08);border-radius:3px;overflow:hidden;margin-bottom:8px"><div style="height:6px;width:${v}%;background:${col};border-radius:3px"></div></div>`
    + `<div style="font-size:11px;color:#A1A1AA;line-height:1.55">${STAFF_TIP[role] || ""}</div>`;
}

// Hover skill tooltips: one body-level singleton + a delegated listener on `root`. Targets carry
// data-driver/-ovr/-team/-name/-age (pilots) or data-staff/-val/-team (staff). Desktop hover; the tip
// is pointer-events:none so it never blocks buttons under it. Idempotent — safe to call every render.
let _personTipEl = null;
export function attachPersonTips(root) {
  if (typeof document === "undefined" || !root || !root.addEventListener) return;
  if (!_personTipEl) {
    _personTipEl = document.createElement("div");
    _personTipEl.id = "apex-person-tip";
    _personTipEl.style.cssText = "position:fixed;z-index:9999;pointer-events:none;min-width:240px;max-width:320px;"
      + "background:#18181b;border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:12px;display:none;"
      + "box-shadow:0 10px 30px rgba(0,0,0,.55);color:#ECEDEE;font-family:inherit";
    document.body.appendChild(_personTipEl);
  }
  const tip = _personTipEl;
  const place = (el) => {
    const r = el.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = Math.min(Math.max(8, r.left), window.innerWidth - tw - 8);
    let top = r.bottom + 8;
    if (top + th > window.innerHeight - 8) top = Math.max(8, r.top - th - 8);
    tip.style.left = left + "px"; tip.style.top = top + "px";
  };
  const show = (el) => {
    const ds = el.dataset;
    const html = ds.driver ? driverSkillTip(ds.driver, ds.ovr, ds.team, ds.name, ds.age)
      : ds.junior ? juniorSkillTip(ds.junior, ds.ovr, ds.name, ds.age, ds.series, ds.tag, ds.persona, ds.morale)
      : ds.staff ? staffSkillTip(ds.staff, ds.val, ds.team) : "";
    if (!html) return;
    tip.innerHTML = html; tip.style.display = "block"; place(el);
  };
  const hide = () => { tip.style.display = "none"; };
  if (root._apexTipOver) { root.removeEventListener("mouseover", root._apexTipOver); root.removeEventListener("mouseout", root._apexTipOut); }
  root._apexTipOver = (e) => { const t = e.target.closest && e.target.closest("[data-driver],[data-staff],[data-junior]"); if (t) show(t); };
  root._apexTipOut = (e) => { const t = e.target.closest && e.target.closest("[data-driver],[data-staff],[data-junior]"); if (t && (!e.relatedTarget || !t.contains(e.relatedTarget))) hide(); };
  root.addEventListener("mouseover", root._apexTipOver);
  root.addEventListener("mouseout", root._apexTipOut);
}
