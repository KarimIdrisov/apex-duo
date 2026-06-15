// ApexWeb/src/ui/teamviz.js — shared visual layer: team colours, readable ink, driver numbers,
// asset paths, tyre icon, and (Task 3) the driver avatar + card builders. Pure UI; reads data.js
// (read-only). No sim/network state.
import { TEAMS, TEAM_LOGO } from "../data.js";
import { driverAttrs, ATTR_KEYS } from "../team.js";
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

// A team-coloured driver card: avatar + name + team chip + a sub-line, optional car render + action HTML.
// d = { team, abbrev, name }. opts = { car?:bool, sub?:html, action?:html }.
export function driverCard(d, opts = {}) {
  const col = teamColor(d.team), ink = teamInk(col);
  const car = opts.car
    ? `<img src="${carImgSrc(d.team)}" alt="" onerror="this.style.display='none'" style="position:absolute;right:6px;bottom:0;height:46px;object-fit:contain;opacity:.92;pointer-events:none">`
    : "";
  const sub = opts.sub ? `<div class="label" style="margin-top:2px">${opts.sub}</div>` : "";
  const act = opts.action || "";
  return `<div style="position:relative;overflow:hidden;background:var(--content2);border-left:4px solid ${col};border-radius:var(--r-md);padding:10px;display:flex;align-items:center;gap:10px;min-height:64px">`
    + driverAvatar(d.abbrev, d.team, 48)
    + `<div style="min-width:0;flex:1">`
    +   `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><b>${d.name}</b>`
    +     `<span style="font-size:11px;color:${ink};background:${col};border-radius:4px;padding:1px 6px">${d.team}</span></div>`
    +   sub + act
    + `</div>` + car + `</div>`;
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
