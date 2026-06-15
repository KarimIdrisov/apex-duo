// ApexWeb/src/ui/quali.js — live qualifying SESSION screen (timing tower).
// Renders the host snapshot (ctx.snapshot when phase==="quali"): a running game-clock + speed/pause
// controls, a track-grip read + flag banner, a 22-car live timing tower with a drop-zone cut line, and
// a per-player live-lap card (tyre / sector deltas / live push / release / abort). The tyre pick is LOCAL
// state (ctx.qTyre); push is host state set live via quali_push. Every committed action is sent to the host
// (quali_release / quali_abort / quali_push / quali_speed / quali_pause / ready). The host pushes a fresh
// snapshot ~15 Hz; the repaint gate keeps controls clickable while the clock patches in place.
import { DRIVER_INFO, QUALI2 } from "../data.js";
import { teamColor } from "./teamviz.js";

// mm:ss for the game-seconds session clock.
const fmtClock = sec => { const s = Math.max(0, Math.floor(sec)); const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toString().padStart(2, "0")}`; };
// m:ss.mmm for a lap time in seconds, e.g. 76.842 -> "1:16.842".
const fmtLap = sec => {
  const m = Math.floor(sec / 60);
  const rest = sec - m * 60;                       // 0..59.999
  const whole = Math.floor(rest);
  const ms = Math.round((rest - whole) * 1000);
  // guard the 999.5→1000 rounding edge so we never print ":60.000"
  const ss = (ms === 1000) ? (whole + 1) : whole;
  const mm = (ms === 1000) ? 0 : ms;
  return `${m}:${ss.toString().padStart(2, "0")}.${mm.toString().padStart(3, "0")}`;
};

// per-phase Russian status for the control card heading.
const statusRu = ph => ({ pit: "в боксах", outlap: "прогревочный круг", flying: "на быстром круге", inlap: "заезд в боксы" }[ph] || "—");
// terse per-row status word for the tower.
const rowStatusRu = (row) => row.eliminated ? "вылет"
  : ({ pit: "боксы", outlap: "прогрев", flying: "быстрый", inlap: "возврат" }[row.phase] || "");

export function render(root, ctx) {
  const snap = (ctx.snapshot && ctx.snapshot.phase === "quali") ? ctx.snapshot : null;
  if (!snap) { root.innerHTML = `<div class="panel"><p class="label">Загрузка квалификации…</p></div>`; return; }

  // local picks, persisted across re-renders
  ctx.qTyre = ctx.qTyre || "fresh";

  const done = snap.segment === 4;                          // sentinel: quali complete, grid set
  const me = snap.cars[ctx.myPlayer];
  const otherKey = ctx.myPlayer === "p1" ? "p2" : "p1";
  const other = snap.cars[otherKey];

  // ---- 1. header: segment + clock + grip + flag + speed/pause ----
  const segLabel = done ? "Квалификация окончена" : "Q" + snap.segment;
  const speedPills = [1, 2, 4, 8].map(v =>
    `<button class="btn q-speed${v === snap.speed ? " on" : ""}" data-v="${v}">${v}×</button>`).join("");
  const flagBanner = snap.flag
    ? (snap.flag.type === "red"
        ? `<div class="q-flag red">🚩 Красный флаг</div>`
        : `<div class="q-flag yellow">⚠ Жёлтый флаг</div>`)
    : "";
  const header = `
    <div class="panel q-head">
      <div class="q-head-top">
        <div>
          <div class="q-seg">${segLabel}</div>
          <div class="q-grip-wrap">
            <span class="label q-grip-lbl">трасса +${(snap.grip * QUALI2.GRIP_GAIN).toFixed(1)}с</span>
            <div class="q-grip"><i style="width:${Math.round(snap.grip * 100)}%"></i></div>
          </div>
        </div>
        <div class="q-clock">${fmtClock(snap.clock)}</div>
      </div>
      ${flagBanner}
      <div class="q-controls">
        <div class="q-speeds">${speedPills}</div>
        <button class="btn q-pause" id="q-pause">${snap.paused ? "▶" : "⏸"}</button>
      </div>
    </div>`;

  // ---- 2. timing tower: one row per car, with a drop-zone cut line ----
  let rows = "";
  snap.tower.forEach((row, i) => {
    const mine = row.player === "p1";
    const mate = row.player === "p2";
    const dropZone = !done && !row.eliminated && row.pos > snap.cut;     // survives only the cut while running
    const cls = ["q-row"];
    if (mine) cls.push("me");
    if (mate) cls.push("mate");
    if (row.eliminated) cls.push("out");
    else if (dropZone) cls.push("danger");

    const timeTxt = row.time != null ? fmtLap(row.time)
      : (row.phase === "flying" ? "на круге…"
        : (row.eliminated || row.phase === "pit" ? "нет времени" : "—"));
    const gapTxt = row.gap != null ? "+" + row.gap.toFixed(3) : "";
    const dot = row.tyre === "fresh" ? "fresh" : "used";
    const info = DRIVER_INFO[row.abbrev];
    const col = info ? teamColor(info.team) : null;

    rows += `
      <div class="${cls.join(" ")}">
        <span class="q-pos">${row.pos}</span>
        <span class="q-name">${col ? `<i class="q-team" style="background:${col}"></i>` : ""}${row.abbrev}</span>
        <span class="q-time">${timeTxt}</span>
        <span class="q-gap">${gapTxt}</span>
        <span class="q-tyre ${dot}"></span>
        <span class="q-status">${rowStatusRu(row)}</span>
      </div>`;

    // insert the cut line between the survivors and the drop zone (only meaningful mid-quali)
    if (!done && row.pos === snap.cut && i < snap.tower.length - 1) {
      rows += `<div class="q-cut"><span>граница вылета</span></div>`;
    }
  });
  const tower = `<div class="panel q-tower">${rows}</div>`;

  // ---- 3. control card (from `me`) ----
  let control = "";
  if (me) {
    const statusTxt = me.eliminated ? "выбыл — наблюдаешь" : statusRu(me.phase);
    let body = `<p class="label q-set-lbl">комплектов софта: ${me.softSets}</p>`;
    if (!me.eliminated) {
      const freshDisabled = me.softSets <= 0;
      const tyreSeg = `
        <div class="seg q-tyre-seg" id="q-tyre">
          <button data-t="fresh" class="${ctx.qTyre === "fresh" ? "on" : ""}" ${freshDisabled ? "disabled" : ""}>свежий софт ×${me.softSets}</button>
          <button data-t="used" class="${ctx.qTyre === "used" ? "on" : ""}">тёплый</button>
        </div>`;
      // show each completed sector's TIME (always informative, incl. the first lap), coloured by the delta
      // vs the car's best sector: green = personal best, amber = slower, neutral when there's no reference yet.
      const secCells = [0, 1, 2].map(i => {
        const t = me.lapSectors && me.lapSectors[i];
        const done = t != null;
        const d = me.sectorDelta && me.sectorDelta[i];
        const cls = !done ? "" : (d == null ? "" : (d <= 0 ? "good" : "warn"));
        return `<div class="q-sec ${i === me.sector && me.phase === "flying" ? "live" : ""} ${cls}">
          <span class="q-sec-n">S${i + 1}</span><span class="q-sec-d">${done ? t.toFixed(2) : "—"}</span></div>`;
      }).join("");
      const sectorStrip = `<div class="q-sectors">${secCells}</div>${me.lapDeleted ? `<div class="q-deleted">круг аннулирован</div>` : ""}`;
      const pushLabels = ["сейв", "норма", "атака", "предел"];
      const pushSeg = `<div class="seg q-push-seg" id="q-push">` +
        pushLabels.map((l, i) => `<button data-lvl="${i}" class="${me.push === i ? "on" : ""}">${l}</button>`).join("") + `</div>`;
      const canRelease = me.phase === "pit";
      const canAbort = me.phase === "outlap" || me.phase === "flying";
      const d = me.traffic ?? 0;                                    // live traffic density (0 clear .. 1 packed)
      const traf = d < 0.2 ? { t: "чисто — окно открыто", c: "good" } : d < 0.5 ? { t: "средне", c: "warn" } : { t: "плотно — рискуешь", c: "bad" };
      body = `
        <p class="label" style="margin:0 0 4px">Резина</p>
        ${tyreSeg}
        <p class="label" style="margin:12px 0 4px">Быстрый круг по секторам</p>
        ${sectorStrip}
        <p class="label" style="margin:12px 0 4px">Темп круга</p>
        ${pushSeg}
        <p class="label" style="margin:12px 0 4px">Трафик на трассе</p>
        <div class="q-traffic ${traf.c}">${traf.t}</div>
        <button class="primary" id="q-release" style="margin-top:12px" ${canRelease ? "" : "disabled"}>Выпустить на круг</button>
        <button class="btn q-abort" id="q-abort" style="margin-top:8px;width:100%" ${canAbort ? "" : "disabled"}>Прервать круг</button>
        <p class="label q-set-lbl">комплектов софта: ${me.softSets}</p>`;
    }
    control = `
      <div class="panel q-card" style="border-left:4px solid ${(me && DRIVER_INFO[me.abbrev]) ? teamColor(DRIVER_INFO[me.abbrev].team) : "var(--border)"}">
        <div class="q-card-head">
          <h3 style="margin:0">Твой болид</h3>
          <span class="q-card-status${me.eliminated ? " out" : ""}">${statusTxt}</span>
        </div>
        ${body}
      </div>`;
  }

  // ---- 4. partner peek ----
  const partner = other
    ? `<p class="label q-partner">Напарник: P${other.pos}${other.eliminated ? " (выбыл)" : ""}</p>`
    : "";

  // ---- 5. ready (only once quali is complete) ----
  const ready = done ? `<button class="ready" id="q-ready">Готов → Гонка</button>` : "";

  root.innerHTML = header
    + `<div class="q-grid"><div class="q-main">${tower}</div><div class="q-side">${control}${partner}</div></div>`
    + ready;

  // ---- wire handlers ----
  root.querySelectorAll(".q-speed").forEach(el =>
    el.onclick = () => ctx.send({ cmd: "quali_speed", value: +el.dataset.v }));
  root.querySelector("#q-pause").onclick = () => ctx.send({ cmd: "quali_pause" });

  const tyreEl = root.querySelector("#q-tyre");
  if (tyreEl) tyreEl.onclick = e => {
    const btn = e.target.closest("button"); if (!btn || !btn.dataset.t || btn.disabled) return;
    ctx.qTyre = btn.dataset.t; render(root, ctx);
  };
  const pushEl = root.querySelector("#q-push");
  if (pushEl) pushEl.onclick = e => {
    const b = e.target.closest("button"); if (!b || b.dataset.lvl == null) return;
    ctx.send({ cmd: "quali_push", player: ctx.myPlayer, level: +b.dataset.lvl });
  };
  const releaseEl = root.querySelector("#q-release");
  if (releaseEl) releaseEl.onclick = () => {
    if (me && me.phase === "pit") ctx.send({ cmd: "quali_release", player: ctx.myPlayer, tyre: ctx.qTyre });   // push is live via #q-push (defaults to steady on release)
  };
  const abortEl = root.querySelector("#q-abort");
  if (abortEl) abortEl.onclick = () => {
    if (me && (me.phase === "outlap" || me.phase === "flying")) ctx.send({ cmd: "quali_abort", player: ctx.myPlayer });
  };
  const readyEl = root.querySelector("#q-ready");
  if (readyEl) readyEl.onclick = () => ctx.send({ cmd: "ready", player: ctx.myPlayer });
}
