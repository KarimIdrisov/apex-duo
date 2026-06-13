// ApexWeb/src/ui/practice.js — live real-time practice SESSION screen.
// Renders the host snapshot (ctx.snapshot when phase==="practice"): a running clock + speed/pause
// controls, a 6-axis setup widget with per-axis knowledge windows + driver feedback, a stint launcher,
// and the shared degradation-curve strategy panel. Compound/laps are local (ctx.pracCompound/pracLaps);
// every actual change is sent to the host (prac_axis / prac_run / prac_speed / prac_pause / prac_auto).
import { TRACK } from "../data.js";
import { AXES } from "../setup.js";

const COMPOUNDS_RU = { soft: "софт", medium: "медиум", hard: "хард" };
const COMP_COL = { soft: "#F31260", medium: "#F5A524", hard: "#d4d4d8", inter: "#17C964", wet: "#006FEE" };
const CLIFF_DROP = 1.4;   // visual "fall off" added at the projected cliff so the curve drops dramatically

// mm:ss clock for the session countdown (game-seconds).
const fmt2 = sec => { const s = Math.max(0, Math.floor(sec)); const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toString().padStart(2, "0")}`; };

// per-axis feedback colour: optimal→good, low/high→warn, vague→muted
const STATE_INK = { optimal: "var(--good)", low: "var(--warn)", high: "var(--warn)", vague: "var(--muted)" };
// the ideal-window band tint behind the slider, by feedback state
const BAND_COL = { optimal: "rgba(23,201,100,.30)", low: "rgba(245,165,36,.26)", high: "rgba(245,165,36,.26)", vague: "rgba(255,255,255,.07)" };

export function render(root, ctx) {
  const snap = (ctx.snapshot && ctx.snapshot.phase === "practice") ? ctx.snapshot : null;
  if (!snap) { root.innerHTML = `<div class="panel"><p class="label">Загрузка практики…</p></div>`; return; }

  // local, persisted across re-renders
  ctx.pracCompound = ctx.pracCompound || "soft";
  ctx.pracLaps = ctx.pracLaps || 10;

  const me = snap.cars[ctx.myPlayer];
  const otherKey = ctx.myPlayer === "p1" ? "p2" : "p1";
  const other = snap.cars[otherKey];

  // ---- 1. header: title + clock + speed/pause + state chip + auto-sim ----
  const speedPills = [1, 2, 4, 8].map(v =>
    `<button class="btn pw-speed${v === snap.speed ? " on" : ""}" data-v="${v}">${v}×</button>`).join("");
  const stateChip = me.onTrack
    ? `на трассе · круг ${me.totalLaps} · ${COMPOUNDS_RU[me.compound] || me.compound}`
    : "в боксах";
  const header = `
    <div class="panel pw-head">
      <div class="pw-head-top">
        <div class="pw-title">Практика P${snap.session}</div>
        <div class="pw-clock">${fmt2(snap.clock)}</div>
      </div>
      <div class="pw-controls">
        <div class="pw-speeds">${speedPills}</div>
        <button class="btn pw-pause" id="pw-pause">${snap.paused ? "▶" : "⏸"}</button>
        <span class="pw-state ${me.onTrack ? "live" : ""}">${stateChip}</span>
        <button class="btn pw-auto" id="pw-auto" ${snap.clock <= 0 ? "disabled" : ""}>Просимулировать остаток</button>
      </div>
    </div>`;

  // ---- 2. setup widget: 6 axis rows (name | track+band+slider | feedback+knowledge) ----
  const axisRows = me.axes.map((ax, i) => {
    const st = ax.feedback.state;
    const bandLeft = Math.max(0, (ax.window.center - ax.window.half)) * 100;
    const bandW = Math.min(100, ax.window.half * 2 * 100);
    const ink = STATE_INK[st] || "var(--muted)";
    return `
      <div class="pw-row">
        <div>
          <div>${AXES[i].name}</div>
          <div class="label" style="margin:0">${AXES[i].char}</div>
        </div>
        <div class="pw-track">
          <div class="pw-band" style="left:${bandLeft.toFixed(1)}%;width:${bandW.toFixed(1)}%;background:${BAND_COL[st] || BAND_COL.vague}"></div>
          <input type="range" min="0" max="1" step="0.01" value="${ax.value}" data-ax="${i}" class="pw-range">
        </div>
        <div class="pw-fb">
          <div class="pw-chip" style="color:${ink}">${ax.feedback.text}</div>
          <div class="bar pw-know"><i style="width:${Math.round(ax.knowledge * 100)}%;background:linear-gradient(90deg,var(--accent),var(--good))"></i></div>
          <div class="label" style="margin:2px 0 0">знание ${Math.round(ax.knowledge * 100)}%</div>
        </div>
      </div>`;
  }).join("");
  const setupPanel = `
    <div class="panel">
      <div class="pw-sec-head">
        <h3 style="margin:0">Сетап машины</h3>
        <div class="pw-sat">${Math.round(me.satisfaction * 100)}%</div>
      </div>
      ${axisRows}
    </div>`;

  // ---- 3. stint launcher: compound + laps + "go" ----
  const compSeg = ["soft", "medium", "hard"].map(c =>
    `<button data-c="${c}" class="${c === ctx.pracCompound ? "on" : ""}">${COMPOUNDS_RU[c]}</button>`).join("");
  const lapBtns = [5, 10, 15].map(n =>
    `<button class="btn pw-lap${n === ctx.pracLaps ? " on" : ""}" data-laps="${n}">${n}</button>`).join("");
  const stintPanel = `
    <div class="panel">
      <h3 style="margin:0 0 10px">Выпустить на трассу</h3>
      <p class="label" style="margin:0 0 4px">Компаунд</p>
      <div class="seg comp-seg" id="pw-compound">${compSeg}</div>
      <p class="label" style="margin:12px 0 4px">Кругов в стинте</p>
      <div class="pw-laps" id="pw-laps">${lapBtns}</div>
      <button class="primary" id="pw-run" style="margin-top:12px" ${me.onTrack ? "disabled" : ""}>Выпустить болид</button>
    </div>`;

  // ---- 4. strategy: shared deg curve (reuse preserved chart) ----
  const stratPanel = `
    <div class="panel">
      <h3 style="margin:0 0 10px">Данные стинтов</h3>
      ${degChartSVG(me.strategy && me.strategy.degByCompound || {})}
    </div>`;

  // ---- 5. partner peek + 6. ready ----
  const partner = `<p class="label pw-partner">Напарник: ${Math.round(other.satisfaction * 100)}% удовлетворённости</p>`;
  const ready = `<button class="ready" id="pw-ready">Готов → ${snap.session < 3 ? "след. сессия" : "Квала"}</button>`;

  root.innerHTML = header + setupPanel + stintPanel + stratPanel + partner + ready;

  // ---- wire handlers ----
  // axis sliders: input = let the native thumb move (no rerender mid-drag); change = commit to host.
  root.querySelectorAll("input.pw-range").forEach(el => {
    el.addEventListener("change", e =>
      ctx.send({ cmd: "prac_axis", player: ctx.myPlayer, i: +e.target.dataset.ax, value: +e.target.value }));
  });
  // speed pills
  root.querySelectorAll(".pw-speed").forEach(el =>
    el.onclick = () => ctx.send({ cmd: "prac_speed", value: +el.dataset.v }));
  // pause / resume
  root.querySelector("#pw-pause").onclick = () => ctx.send({ cmd: "prac_pause" });
  // fast-forward the remaining clock
  root.querySelector("#pw-auto").onclick = () => { if (snap.clock > 0) ctx.send({ cmd: "prac_auto", player: ctx.myPlayer }); };
  // compound picker (local state → repaint)
  root.querySelector("#pw-compound").onclick = e => {
    const btn = e.target.closest("button"); if (!btn || !btn.dataset.c) return;
    ctx.pracCompound = btn.dataset.c; render(root, ctx);
  };
  // laps picker (local state → repaint)
  root.querySelector("#pw-laps").onclick = e => {
    const btn = e.target.closest("button"); if (!btn || !btn.dataset.laps) return;
    ctx.pracLaps = +btn.dataset.laps; render(root, ctx);
  };
  // launch a stint with the chosen compound + laps
  root.querySelector("#pw-run").onclick = () => { if (!me.onTrack) ctx.send({ cmd: "prac_run", player: ctx.myPlayer, compound: ctx.pracCompound, laps: ctx.pracLaps }); };
  // ready up for the next session / quali
  root.querySelector("#pw-ready").onclick = () => ctx.send({ cmd: "ready", player: ctx.myPlayer });
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
