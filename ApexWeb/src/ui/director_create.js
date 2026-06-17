// ApexWeb/src/ui/director_create.js — co-director creation screen. Each player names a director and
// picks ONE specialty (co-op: two players, must differ — the other's pick shows locked; solo: one
// director + an "assistant" specialty at half effect). On confirm, sets `ctx.pendingDirectors` and
// calls `onDone()`. Local UI state only; the co-op P2P sync of the two columns is wired in main.js
// (this module just renders both columns — feed the remote player's choice into ctx._directors[1]).
import { SPECIALTIES, SPECIALTY_KEYS, validDirectors } from "../directors.js";
import { TEAMS } from "../data.js";
import { teamColor, teamInk } from "./teamviz.js";

const initials = name => ((name || "?").trim().split(/\s+/).map(w => w[0] || "").join("").slice(0, 2).toUpperCase() || "?");
const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

// render the screen. ctx needs { teamIdx, coop }. onDone() is called when the player confirms.
export function render(root, ctx, onDone) {
  const coop = !!ctx.coop;
  const team = TEAMS[ctx.teamIdx || 0];
  const col = teamColor(team.name), ink = teamInk(col);

  if (!ctx._directors) {
    ctx._directors = coop
      ? [{ player: "p1", name: "Директор 1", specialty: null }, { player: "p2", name: "Директор 2", specialty: null }]
      : [{ player: "p1", name: "Директор", specialty: null, assistant: null }];
  }
  const dirs = ctx._directors;
  const takenByOther = (d, key) => coop && dirs.some(o => o !== d && o.specialty === key);

  function chip(d, key, kind) {
    const sp = SPECIALTIES[key], sel = d[kind] === key, lock = kind === "specialty" && takenByOther(d, key);
    const bg = sel ? col : "var(--content2)", fg = sel ? ink : "var(--muted)";
    const style = `font-size:12px;padding:4px 9px;border-radius:6px;background:${bg};color:${fg};` + (lock ? "opacity:.4;pointer-events:none" : "cursor:pointer");
    return `<span class="dchip" data-pl="${d.player}" data-kind="${kind}" data-key="${key}" style="${style}">${sp.label}${lock ? " 🔒" : ""}</span>`;
  }

  function column(d) {
    const sp = d.specialty && SPECIALTIES[d.specialty], asst = d.assistant && SPECIALTIES[d.assistant];
    return `<div class="panel" style="flex:1;min-width:240px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <div style="width:38px;height:38px;border-radius:50%;background:${col};color:${ink};display:flex;align-items:center;justify-content:center;font-weight:700">${initials(d.name)}</div>
        <input class="dname" data-pl="${d.player}" value="${esc(d.name)}" maxlength="24" style="flex:1;padding:6px;font-weight:700" />
      </div>
      <p class="label">Специальность</p>
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px">${SPECIALTY_KEYS.map(k => chip(d, k, "specialty")).join("")}</div>
      <p class="label" style="color:var(--muted)">${sp ? esc(sp.blurb) : "выбери сильную сторону"}</p>
      ${coop ? "" : `<p class="label" style="margin-top:8px">Ассистент · ½ эффекта</p>
        <div style="display:flex;flex-wrap:wrap;gap:5px">${SPECIALTY_KEYS.filter(k => k !== d.specialty).map(k => chip(d, k, "assistant")).join("")}</div>
        ${asst ? `<p class="label" style="color:var(--muted)">+ ½: ${esc(asst.blurb)}</p>` : ""}`}
    </div>`;
  }

  const ready = validDirectors(dirs, coop);
  root.innerHTML = `<div class="panel">
    <h2>Со-директора — ${esc(team.name)}</h2>
    <p class="label">${coop ? "Каждый берёт свою специальность — они должны быть разными" : "Выбери специальность и ассистента"}</p>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin:10px 0">${dirs.map(column).join("")}</div>
    <button class="primary" id="dgo" style="width:100%" ${ready ? "" : "disabled"}>${ready ? "Далее: предсезонка →" : "Выбери специальности"}</button>
  </div>`;

  root.querySelectorAll(".dchip").forEach(el => el.onclick = () => {
    const d = dirs.find(x => x.player === el.dataset.pl); if (!d) return;
    const kind = el.dataset.kind, key = el.dataset.key;
    d[kind] = d[kind] === key ? null : key;
    if (kind === "specialty" && d.assistant === key) d.assistant = null;   // assistant can't duplicate the primary
    render(root, ctx, onDone);
  });
  root.querySelectorAll(".dname").forEach(el => el.oninput = () => {
    const d = dirs.find(x => x.player === el.dataset.pl); if (d) d.name = el.value;
  });
  const go = root.querySelector("#dgo");
  if (go) go.onclick = () => { if (validDirectors(dirs, coop)) { ctx.pendingDirectors = dirs.map(d => ({ ...d })); onDone(); } };
}
