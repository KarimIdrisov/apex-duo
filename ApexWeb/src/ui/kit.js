// ApexWeb/src/ui/kit.js — the "Broadcast" UI kit. Reusable, design-system-consistent components so
// feature panels stop hand-rolling markup with hardcoded colours. Pure string builders (no DOM).
// Pairs with the .bcard/.bchip/.bmeter/.brow classes + semantic tokens in style.css.

const esc = v => (v == null ? "" : String(v));

// semantic colour maps — reference tokens, never raw hex, so the palette is changeable in one place.
export const TYRE_COL = { soft: "var(--tyre-soft)", medium: "var(--tyre-medium)", hard: "var(--tyre-hard)", inter: "var(--tyre-inter)", wet: "var(--tyre-wet)" };
export const SERIES_COL = { F4: "var(--series-f4)", F3: "var(--series-f3)", F2: "var(--series-f2)", F1: "var(--series-f1)" };
export const moraleCol = m => m >= 0.6 ? "var(--good)" : m >= 0.4 ? "var(--warn)" : "var(--bad)";
export const fatigueCol = f => f < 0.3 ? "var(--good)" : f < 0.6 ? "var(--warn)" : "var(--bad)";

// a skewed broadcast chip. bg defaults to the teal accent (via the class); text auto-counter-skews.
export function bchip(text, bg) { return `<span class="bchip"${bg ? ` style="background:${bg}"` : ""}><span>${esc(text)}</span></span>`; }

// a broadcast card: team-/semantic-colour spine + uppercase title + optional chip + body html.
export function bcard({ title, chip, spine, body, id }) {
  return `<div class="bcard"${spine ? ` style="--spine:${spine}"` : ""}${id ? ` id="${id}"` : ""}>`
    + `<div class="bcard-hd"><p class="bcard-title">${esc(title)}</p>${chip ? (typeof chip === "string" ? bchip(chip) : chip) : ""}</div>`
    + (body || "") + "</div>";
}

// a thin meter bar (0..100). `color` overrides the cyan default.
export function bbar(pct, color, h = 7) {
  const p = Math.max(0, Math.min(100, pct || 0));
  return `<span class="bmeter" style="height:${h}px"><i style="width:${p}%${color ? `;background:${color}` : ""}"></i></span>`;
}

// a labelled meter ROW: name (left) · bar · value (right). value defaults to the rounded pct.
export function meterRow(name, pct, color, value) {
  const p = Math.round(pct || 0);
  return `<div class="brow"><span style="font-size:12px;color:var(--ink);flex:0 0 auto;min-width:92px">${esc(name)}</span>`
    + bbar(p, color) + `<span class="bnum" style="font-size:13px;width:30px;text-align:right${color ? `;color:${color}` : ""}">${value != null ? esc(value) : p}</span></div>`;
}

// a compact inline KPI: label + bold value.
export function bkpi(label, value, color) {
  return `<span class="bkpi">${esc(label)} <b${color ? ` style="color:${color}"` : ""}>${esc(value)}</b></span>`;
}

// a horizontal strip of KPIs: items = [[label, value, color?], ...].
export function bkpiStrip(items) {
  return `<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px">${items.map(([l, v, c]) => bkpi(l, v, c)).join("")}</div>`;
}
