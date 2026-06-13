// ApexWeb/src/ui/practice.js — Practice "run plans": hero run-picker + setup sliders + a shared findings board.
// Renders from the host practice snapshot (ctx.snapshot when phase==="practice"); sliders/compound are local.
import { PRAC_COST, PRAC_BUDGET, TRACK } from "../data.js";
import { AXES } from "../setup.js";

const fmt = t => { const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(3).padStart(6, "0")}`; };
const COMPOUNDS_RU = { soft: "софт", medium: "медиум", hard: "хард" };
const COMP_COL = { soft: "#F31260", medium: "#F5A524", hard: "#d4d4d8", inter: "#17C964", wet: "#006FEE" };
const CLIFF_DROP = 1.4;   // visual "fall off" added at the projected cliff so the curve drops dramatically

export function render(root, ctx) {
  ctx.setup = ctx.setup || [0.5, 0.5, 0.5];
  ctx.pracCompound = ctx.pracCompound || "soft";
  const snap = (ctx.snapshot && ctx.snapshot.phase === "practice") ? ctx.snapshot
    : { budget: PRAC_BUDGET, spent: 0, findings: [], board: { degByCompound: {}, quali: null, idealFound: 0, recommendedStops: null } };
  const left = snap.budget - snap.spent;
  const canRun = type => left >= (PRAC_COST[type] || 1);
  const b = snap.board;

  // shared trek-time budget meter (spent cells dim, remaining cells glow)
  const budget = Array.from({ length: snap.budget }, (_, i) =>
    `<i class="${i < snap.spent ? "spent" : "left"}"></i>`).join("");

  // run-plan picker cards
  const RUNS = [
    { type: "setup", ico: "🎯", nm: "Setup-тест", ds: "сигнал + фидбэк пилота" },
    { type: "long",  ico: "📉", nm: "Long-run",   ds: "износ + проекция клиффа" },
    { type: "quali", ico: "⏱️", nm: "Quali-sim",  ds: "темп одного круга" },
  ];
  const runCards = RUNS.map(r => `
    <button class="run-card" id="run-${r.type}" ${canRun(r.type) ? "" : "disabled"}>
      <span class="cost">·${PRAC_COST[r.type]}</span>
      <span class="ico">${r.ico}</span><span class="nm">${r.nm}</span><span class="ds">${r.ds}</span>
    </button>`).join("");

  const compSeg = ["soft", "medium", "hard"].map(c =>
    `<button data-c="${c}" class="${c === ctx.pracCompound ? "on" : ""}">${COMPOUNDS_RU[c]}</button>`).join("");

  const sliders = AXES.map((ax, i) => `
    <div style="display:flex;align-items:center;gap:10px;margin:6px 0">
      <span class="label" style="width:90px;margin:0">${ax.name}</span>
      <input type="range" min="0" max="1" step="0.01" value="${ctx.setup[i]}" data-ax="${i}" style="flex:1">
      <span style="width:36px;text-align:right">${(+ctx.setup[i]).toFixed(2)}</span>
    </div>`).join("");

  // strategy stat tiles
  const stats = `
    <div class="stat-row">
      <div class="stat"><div class="label" style="margin:0 0 4px">Идеал сетапа</div>
        <div class="v">${Math.round(b.idealFound * 100)}%</div>
        <div class="bar" style="margin-top:6px"><i style="width:${Math.round(b.idealFound * 100)}%;background:linear-gradient(90deg,var(--accent),var(--good))"></i></div></div>
      <div class="stat"><div class="label" style="margin:0 0 4px">Квали-темп</div>
        <div class="v ${b.quali ? "sm" : ""}">${b.quali ? fmt(b.quali) : "—"}</div></div>
      <div class="stat"><div class="label" style="margin:0 0 4px">Стратегия</div>
        <div class="v">${b.recommendedStops != null ? b.recommendedStops : "—"}<span style="font-size:13px;font-weight:600;color:var(--muted)">${b.recommendedStops != null ? " стоп" : ""}</span></div>
        <div class="label" style="margin:4px 0 0;text-transform:none;letter-spacing:0">по long-run</div></div>
    </div>`;

  const feed = snap.findings.slice(-6).reverse().map(f => feedRow(f)).join("")
    || "<div class='feed-row'><span class='label' style='margin:0'>пока нет прогонов — выбери прогон выше</span></div>";

  root.innerHTML = `
    <div class="panel">
      <h2>Практика — настройка и разведка</h2>
      <p class="label" style="margin:0">Трек-тайм команды · осталось <b style="color:var(--ink)">${left}</b> из ${snap.budget}</p>
      <div class="prac-budget">${budget}</div>
      <div class="run-grid">${runCards}</div>
      <p class="label" style="margin:2px 0 4px">Компаунд long-run</p>
      <div class="seg comp-seg" id="prac-compound">${compSeg}</div>
      <p class="label" style="margin:14px 0 2px">Сетап машины <span style="text-transform:none;letter-spacing:0;font-weight:500;color:var(--muted)">— крути перед setup-тестом</span></p>
      ${sliders}
    </div>
    <div class="panel">
      <h3 style="margin:0 0 10px">Общая доска находок</h3>
      ${stats}
      <p class="label" style="margin:0 0 4px">Кривая износа · проекция клиффа</p>
      ${degChartSVG(b.degByCompound)}
      ${feed}
    </div>
    <button class="ready" id="ready" style="margin-top:8px">Готов → Квала</button>`;

  root.querySelectorAll("input[type=range]").forEach(el => {
    el.oninput = e => { ctx.setup[+e.target.dataset.ax] = +e.target.value;
      e.target.nextElementSibling.textContent = (+e.target.value).toFixed(2); };
  });
  root.querySelector("#prac-compound").onclick = e => {
    const btn = e.target.closest("button"); if (!btn || !btn.dataset.c) return;
    ctx.pracCompound = btn.dataset.c; render(root, ctx);    // repaint to reflect the active pill
  };
  const run = type => ctx.send({ cmd: "practice_run", player: ctx.myPlayer, type, compound: ctx.pracCompound, setup: ctx.setup.slice() });
  for (const r of RUNS) root.querySelector(`#run-${r.type}`).onclick = () => canRun(r.type) && run(r.type);
  root.querySelector("#ready").onclick = () => {
    ctx.send({ cmd: "set_setup", player: ctx.myPlayer, setup: ctx.setup });
    ctx.send({ cmd: "ready", player: ctx.myPlayer });
  };
}

// one findings-feed row: a coloured type/compound chip + the run summary + the player tag.
function feedRow(f) {
  let chip, col, ink = "#0a0a0c", text;
  if (f.type === "long") { chip = COMPOUNDS_RU[f.compound]; col = COMP_COL[f.compound] || "#aaa";
    if (f.compound === "hard") ink = "#18181b";
    text = `Long-run → клифф ${f.cliffLap || "—"} · стинт ~${f.stintLaps} кр`; }
  else if (f.type === "quali") { chip = "квали"; col = "var(--warn)"; ink = "#1a1205"; text = `Quali-sim → ${fmt(f.qualiPace)}`; }
  else { chip = "сетап"; col = "var(--accent)"; ink = "#fff"; text = `Setup-тест → «${f.feedback}»`; }
  return `<div class="feed-row"><span class="feed-chip" style="background:${col};color:${ink}">${chip}</span>
    <span>${text}</span><span class="feed-pl">${f.player || ""}</span></div>`;
}

// SVG degradation-curve chart: per-compound solid measured line + dashed projection to the cliff + a cliff marker.
function degChartSVG(deg) {
  const comps = Object.keys(deg).filter(c => deg[c] && deg[c].lapTimes && deg[c].lapTimes.length > 2);
  if (!comps.length) return `<div class="prac-empty">Сделай <b>long-run</b>, чтобы увидеть кривую износа и где резина «упадёт с обрыва».</div>`;

  const W = 680, H = 250, L = 46, R = 660, T = 18, B = 196;
  let xMax = 6;
  for (const c of comps) xMax = Math.max(xMax, deg[c].cliffLap || deg[c].lapTimes.length);
  xMax = Math.min(xMax + 2, TRACK.laps);

  let yMin = 1e9, yMax = -1e9, yRef = 1e9;
  const series = comps.map(c => {
    const lt = deg[c].lapTimes, N = lt.length;
    const i0 = Math.min(2, N - 2);                                  // skip the cold out-lap when reading the slope
    const slope = (lt[N - 1] - lt[i0]) / Math.max(1, (N - 1 - i0));
    const cliff = deg[c].cliffLap || N;
    const yCliff = lt[N - 1] + slope * Math.max(0, cliff - N) + CLIFF_DROP;
    for (const t of lt) { yMin = Math.min(yMin, t); yMax = Math.max(yMax, t); yRef = Math.min(yRef, t); }
    yMax = Math.max(yMax, yCliff);
    return { c, lt, N, slope, cliff, yCliff, col: COMP_COL[c] || "#aaa", stint: deg[c].stintLaps };
  });
  const pad = (yMax - yMin) * 0.08 || 0.5; yMin -= pad; yMax += pad * 1.3;
  const X = lap => L + (lap - 1) / (xMax - 1) * (R - L);
  const Y = t => B - (t - yMin) / (yMax - yMin) * (B - T);

  // gridlines: 4 horizontal (labelled +Δs vs the peak lap) + a few vertical lap ticks
  let grid = "";
  for (let g = 0; g <= 3; g++) {
    const t = yMin + (yMax - yMin) * g / 3, y = Y(t).toFixed(1);
    grid += `<line x1="${L}" y1="${y}" x2="${R}" y2="${y}" stroke="rgba(255,255,255,.06)" stroke-width="1"/>`;
    grid += `<text x="${L - 6}" y="${(+y + 3).toFixed(1)}" fill="var(--muted)" font-size="10" text-anchor="end">+${(t - yRef).toFixed(1)}</text>`;
  }
  const step = xMax <= 12 ? 2 : xMax <= 30 ? 5 : 10;
  for (let lap = 1; lap <= xMax; lap += step) {
    const x = X(lap).toFixed(1);
    grid += `<line x1="${x}" y1="${T}" x2="${x}" y2="${B}" stroke="rgba(255,255,255,.04)" stroke-width="1"/>`;
    grid += `<text x="${x}" y="${B + 14}" fill="var(--muted)" font-size="10" text-anchor="middle">${lap}</text>`;
  }
  grid += `<text x="${(L + R) / 2}" y="${H - 2}" fill="var(--muted)" font-size="10" text-anchor="middle">круги стинта</text>`;

  // per-compound curves
  let curves = "", legend = "";
  series.forEach((s, k) => {
    const meas = s.lt.map((t, i) => `${X(i + 1).toFixed(1)},${Y(t).toFixed(1)}`).join(" ");
    curves += `<polyline points="${meas}" fill="none" stroke="${s.col}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
    const px = X(s.N).toFixed(1), py = Y(s.lt[s.N - 1]).toFixed(1);
    if (s.cliff <= xMax) {
      // the cliff falls within the chart: dashed projection to the cliff + a "fall off" marker
      const cx = X(s.cliff).toFixed(1), cyCliff = Y(s.yCliff).toFixed(1);
      curves += `<polyline points="${px},${py} ${cx},${cyCliff}" fill="none" stroke="${s.col}" stroke-width="2" stroke-dasharray="4 3" opacity="0.75"/>`;
      curves += `<line x1="${cx}" y1="${T}" x2="${cx}" y2="${B}" stroke="${s.col}" stroke-width="1" stroke-dasharray="2 3" opacity="0.28"/>`;
      curves += `<path d="M${cx} ${(+cyCliff - 4).toFixed(1)} l4 4 l-4 4 l-4 -4 z" fill="${s.col}"/>`;
      const lx = Math.min(+cx, R - 52);
      curves += `<text x="${lx}" y="${T + 10}" fill="${s.col}" font-size="10" font-weight="700" text-anchor="middle">клифф ${s.cliff}</text>`;
    } else {
      // stint outlasts the race: gentle dashed projection to the edge, no cliff drop
      const ey = Y(s.lt[s.N - 1] + s.slope * (xMax - s.N)).toFixed(1);
      curves += `<polyline points="${px},${py} ${X(xMax).toFixed(1)},${ey}" fill="none" stroke="${s.col}" stroke-width="2" stroke-dasharray="4 3" opacity="0.6"/>`;
      curves += `<text x="${R - 4}" y="${(+ey - 4).toFixed(1)}" fill="${s.col}" font-size="9" font-weight="700" text-anchor="end">клифф ${s.cliff} (за гонкой)</text>`;
    }
    // legend (top-left, stacked)
    legend += `<g transform="translate(${L + 6},${T + 8 + k * 15})">
      <rect x="0" y="-7" width="9" height="9" rx="2" fill="${s.col}"/>
      <text x="14" y="1" fill="var(--ink)" font-size="11" font-weight="600">${COMPOUNDS_RU[s.c] || s.c} · стинт ~${s.stint}</text></g>`;
  });

  return `<svg class="deg-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
    ${grid}${curves}${legend}</svg>`;
}
