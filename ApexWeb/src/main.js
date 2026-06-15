// ApexWeb/src/main.js
import { Weekend } from "./weekend.js";
import { LocalNet, P2PNet } from "./net.js";
import { Race } from "./sim.js";
import { TEAMS, TRACK, STEP, GRID_GAP, DIFFICULTY, PRAC2 } from "./data.js";
import * as lobby from "./ui/lobby.js";
import * as practice from "./ui/practice.js";
import * as quali from "./ui/quali.js";
import * as race from "./ui/race.js";
import { renderShell, shellSig } from "./ui/shell.js";
import { buildGrid } from "./quali.js";
import { paceBonus, closeness, trackIdeal } from "./setup.js";
import { driverAttrs, composeCar, genPersonnel } from "./team.js";
import { pickTrack } from "./track_shapes.js";
import { fuelLaps } from "./fuel.js";
import { newSession, step as pracStep, sessionSnapshot, setAxis, sendRun, setSpeed, setPaused, autoSim } from "./practice_session.js";
import { newQuali, qualiStep, advanceSegment, qualiSnapshot, release as qRelease, abort as qAbort, setSpeed as qSetSpeed, setPaused as qSetPaused, setPush as qSetPush, finalGrid } from "./quali_session.js";
import { sfx } from "./audio.js";
import { defaultRaceTrack, trackFromEdited } from "./track_build.js";
import { loadAll } from "./track_store.js";
import * as seasonUI from "./ui/season.js";
import { newCareer, newSeason, currentRound, applyResult, advanceRound, chooseTitleSponsor, constructorStandings } from "./career.js";
import { pushNews } from "./news.js";
import { careerTrack } from "./track_build.js";
import { effectiveCar, startProject } from "./development.js";
import { moraleMod, reSign, DRIVER_NAME } from "./drivers.js";
import { composePersonnel, upgradeStaff, upgradeFacility } from "./staff.js";
import { signDriver, negotiateSign } from "./market.js";
import { signJunior, promoteJunior } from "./academy.js";
import { saveCareer } from "./career_store.js";

const SCREENS = { lobby, practice1: practice, practice2: practice, practice3: practice, quali, race, result: race };
const isPractice = p => p === "practice1" || p === "practice2" || p === "practice3";
const root = document.getElementById("app");
const nav = document.getElementById("nav");
// any button press blips (and unlocks the AudioContext on first gesture)
root.addEventListener("click", e => { if (e.target.closest("button")) sfx.click(); });

export const ctx = {
  net: null, role: null, weekend: new Weekend(), race: null,
  myPlayer: null,            // "p1" (host car) | "p2" (client car)
  teamIdx: 0, snapshot: null,
  send(cmd) {
    const msg = { type: "command", ...cmd };
    if (this.role === "host") onCommand(msg);   // host applies its own input directly
    else this.net.send(msg);                    // client -> host
  },
};

const _mmss = sec => { const s = Math.max(0, Math.floor(sec)); const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toString().padStart(2, "0")}`; };

// Live screens (practice/quali) receive a snapshot ~15Hz. A full innerHTML rebuild every frame destroys
// buttons/sliders mid-interaction (clicks land on an element that's already been replaced → "кнопки не
// жмутся", sliders jump). So gate the rebuild on a STRUCTURAL signature — everything the screen draws
// EXCEPT the ticking clock. When only the clock changed, patch its text in place and leave the controls
// alone. Returns null for non-gated phases (lobby/race/result), so they render every call as before.
function liveSig(phase, snap) {
  if (!snap) return null;
  if (isPractice(phase)) {
    const c = p => { const x = snap.cars[p]; if (!x) return "-";
      const ax = x.axes ? x.axes.map(a => Math.round(a.value * 100)).join("-") : "";
      return `${x.onTrack ? 1 : 0}.${x.totalLaps}.${Math.round(x.satisfaction * 100)}.${Math.round((x.trackKnow || 0) * 100)}.${x.compound}.${x.lastCompound || "-"}.${x.stintLeft}.${ax}`; };
    // include the clock-ZERO state (not the value) so run/auto buttons rebuild once to disable at session end
    return `P.${snap.paused ? 1 : 0}.${snap.speed}.${snap.session}.${snap.clock <= 0 ? "Z" : "r"}.${c("p1")}.${c("p2")}`;
  }
  if (phase === "quali") {
    const c = p => { const x = snap.cars[p]; return x ? `${x.phase}.${x.tyre}.${x.softSets}.${x.eliminated ? 1 : 0}.${x.pos}.${x.sector ?? "-"}.${x.push ?? "-"}.${x.lapDeleted ? 1 : 0}.${x.lapSectors ? x.lapSectors.length : 0}` : "-"; };
    const tower = snap.tower.map(t => `${t.pos}:${t.idx}:${t.eliminated ? 1 : 0}:${t.time ? 1 : 0}:${t.phase}`).join(",");
    return `Q.${snap.paused ? 1 : 0}.${snap.speed}.${snap.segment}.${snap.flag ? snap.flag.type : "-"}.${c("p1")}.${c("p2")}.${tower}`;
  }
  return null;
}
// cheap per-frame update when only the clock changed: keep the controls untouched (clickable).
function patchClock(snap) {
  const el = root.querySelector(".pw-clock, .q-clock");
  if (el && snap) el.textContent = _mmss(snap.clock);
}

function rerender() {
  const phase = ctx.weekend.phase;
  const snap = ctx.snapshot;
  // structural gate: same screen + same structure as last render → just tick the clock, keep controls alive.
  // sig runs before the render try/catch, so never let it throw (would kill the host loop) — fall through.
  let sig = null;
  try { sig = liveSig(phase, snap); } catch { sig = null; }
  if (sig !== null && phase === ctx._renderedPhase && sig === ctx._liveSig) { patchClock(snap); return; }
  ctx._liveSig = sig;
  // nav shell: render only when its content changes (phase / career context) so it never rebuilds on
  // the ~12Hz race repaint. Wrapped in try/catch — it runs inside the host rAF loop; a throw must not
  // kill the loop.
  try { const ss = shellSig(ctx); if (ss !== ctx._shellSig) { ctx._shellSig = ss; renderShell(nav, ctx); } } catch (e) { console.error("[shell] render threw:", e); }
  // Entrance flourish (#app>.panel { animation:rise }) plays only on the FIRST render of a phase. Live
  // screens repaint often; re-triggering the fade every rebuild froze panels at opacity 0 → BLACK SCREEN.
  // On a same-phase rebuild, mark #app `no-anim` to suppress the entrance.
  const cls = [];
  // wide #app for the 2-col dashboards: race/result and the practice setup grid (room for a wide slider track)
  if (phase === "race" || phase === "result" || isPractice(phase) || phase === "quali") cls.push("wide");
  if (phase === ctx._renderedPhase) cls.push("no-anim");          // rebuild of the same screen → no re-entrance
  ctx._renderedPhase = phase;
  root.className = cls.join(" ");
  // a render error must NEVER escape: it runs inside the host rAF loop, so an uncaught throw would skip
  // the loop's reschedule and freeze the whole session ("что-то сломалось" / black screen). Log + show a
  // notice instead, keeping the loop alive and the cause diagnosable in the console.
  try {
    const mod = (ctx.careerView && ctx.atPaddock) ? seasonUI : SCREENS[phase];
    mod.render(root, ctx);
  } catch (e) {
    console.error(`[render] phase "${phase}" threw:`, e);
    root.innerHTML = `<div class="panel"><p class="label">Ошибка отрисовки (${phase}). Детали в консоли — пришли их, чтобы починить.</p></div>`;
  }
}
ctx.weekend.onPhase = (phase) => {
  if (ctx.role === "host") {
    onPhaseHost();
    if (ctx.net) ctx.net.send({ type: "phase", phase });
    if (ctx.career && ctx.net) ctx.net.send({ type: "career", career: ctx.career, ready: ctx.careerReady });
  }
  rerender();
};

// HOST: handle inbound commands, run sim during race, broadcast snapshots
function onCommand(cmd) {
  if (ctx.role !== "host") return;
  switch (cmd.cmd) {
    case "ready":     ctx.weekend.setReady(cmd.player); break;
    case "career_sponsor":
      if (ctx.career) { chooseTitleSponsor(ctx.career, cmd.offerIdx); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_project":
      if (ctx.career) { startProject(ctx.career, cmd.part, cmd.size); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_resign":
      if (ctx.career) { reSign(ctx.career, cmd.abbrev); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_upgrade":
      if (ctx.career) {
        if (cmd.kind === "staff") upgradeStaff(ctx.career, cmd.key);
        else if (cmd.kind === "facility") upgradeFacility(ctx.career, cmd.key);
        saveCareer(ctx.career); publishCareer(); rerender();
      }
      break;
    case "career_sign":
      if (ctx.career) {
        const meS = constructorStandings(ctx.career).find(s => s.isPlayer);
        const strength = meS ? 1 - (meS.pos - 1) / (TEAMS.length - 1) : 0.5;
        const r = negotiateSign(ctx.career, cmd.inAbbrev, cmd.outAbbrev, { teamStrength: strength, seed: (ctx.career.round + 1) * 131 + cmd.inAbbrev.charCodeAt(0) });
        pushNews(ctx.career, r.ok ? `Трансфер: ${cmd.inAbbrev} подписан.` : `Трансфер ${cmd.inAbbrev} сорвался: ${r.reason}.`);
        saveCareer(ctx.career); publishCareer(); rerender();
      }
      break;
    case "career_scout":
      if (ctx.career) { signJunior(ctx.career, cmd.abbrev); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_promote":
      if (ctx.career) { promoteJunior(ctx.career, cmd.abbrev, cmd.outAbbrev); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_start_weekend":
      if (ctx.career && !ctx.career.done && !(ctx.career.pendingOffers && ctx.career.pendingOffers.length)) {
        ctx.careerReady[cmd.player] = true; publishCareer(); rerender();
        if (ctx.solo || (ctx.careerReady.p1 && ctx.careerReady.p2)) startWeekendFromPaddock();
      }
      break;
    case "career_newseason":
      if (ctx.career && ctx.career.done) {
        ctx.careerReady[cmd.player] = true;
        if (ctx.solo || (ctx.careerReady.p1 && ctx.careerReady.p2)) startNewSeason();
      }
      break;
    case "set_pace":  ctx.race?.setPace(cmd.car, cmd.mode); break;
    case "set_engine": ctx.race?.setEngine(cmd.car, cmd.mode); break;
    case "set_order":  ctx.race?.setOrder(cmd.car, cmd.mode); break;
    case "request_pit": ctx.race?.requestPit(cmd.car, cmd.compound); break;
    case "toggle_pause":
      ctx.paused = !ctx.paused;
      if (ctx.race) pushRaceState();   // reflect pause on both screens immediately
      break;
    case "set_speed":
      ctx.speed = cmd.value;
      if (ctx.race) pushRaceState();   // reflect new speed on both screens
      break;
    case "set_setup": ctx.setups = ctx.setups || {}; ctx.setups[cmd.player] = cmd.setup; break;
    case "prac_axis":  if (ctx.pracSession) { setAxis(ctx.pracSession, cmd.player, cmd.i, cmd.value); pushPractice(); } break;
    case "prac_run":   if (ctx.pracSession) { sendRun(ctx.pracSession, cmd.player, cmd.compound || "soft", cmd.laps || 12); pushPractice(); } break;
    case "prac_speed": if (ctx.pracSession) { setSpeed(ctx.pracSession, cmd.value); pushPractice(); } break;
    case "prac_pause": if (ctx.pracSession) { setPaused(ctx.pracSession, !ctx.pracSession.paused); pushPractice(); } break;
    case "prac_auto":  if (ctx.pracSession) { autoSim(ctx.pracSession, cmd.player); pushPractice(); } break;
    case "quali_release": if (ctx.qualiSession) { qRelease(ctx.qualiSession, cmd.player, cmd.tyre, cmd.push); pushQuali(); } break;
    case "quali_abort":   if (ctx.qualiSession) { qAbort(ctx.qualiSession, cmd.player); pushQuali(); } break;
    case "quali_speed":   if (ctx.qualiSession) { qSetSpeed(ctx.qualiSession, cmd.value); pushQuali(); } break;
    case "quali_pause":   if (ctx.qualiSession) { qSetPaused(ctx.qualiSession, !ctx.qualiSession.paused); pushQuali(); } break;
    case "quali_push": if (ctx.qualiSession) { qSetPush(ctx.qualiSession, cmd.player, cmd.level); pushQuali(); } break;
  }
}
function onPhaseHost() {
  if (isPractice(ctx.weekend.phase)) {
    if (ctx.seed == null) ctx.seed = 1000 + Math.floor(Math.random() * 100000);  // shared weekend seed
    const n = Number(ctx.weekend.phase.slice(-1));                                // 1 | 2 | 3
    if (!ctx.pracSession) ctx.pracSession = newSession(ctx.seed, practiceCars());
    else { ctx.pracSession.session = n; ctx.pracSession.clock = PRAC2.SESSION_SEC; ctx.pracSession.paused = true;
           ctx.pracSession.cars.p1.onTrack = false; ctx.pracSession.cars.p2.onTrack = false; }   // new session: reset clock, keep knowledge
    ctx._pracFrame = 0; ctx._pracLastTs = 0;
    pushPractice();
  }
  if (ctx.weekend.phase === "quali") {
    if (ctx.seed == null) ctx.seed = 1000 + Math.floor(Math.random() * 100000);
    ctx.qualiSession = newQuali(ctx.seed, qualiField());
    ctx._qFrame = 0; ctx._qLastTs = 0;
    pushQuali();
  }
  if (ctx.weekend.phase === "race") startRaceHost();
}
function startRaceHost() {
  const field = buildField();
  ctx.track = ctx.track || defaultRaceTrack();
  // host picks the race seed once; the sim run stays fully deterministic from it
  if (ctx.seed == null) ctx.seed = 1000 + Math.floor(Math.random() * 100000);
  ctx.race = new Race(field, ctx.track, ctx.seed, ctx.difficulty ?? DIFFICULTY.normal.ai);
  ctx.trackName = ctx.trackName || pickTrack(ctx.seed);   // keep a quick-race's edited circuit; else seed-pick the visual (3D + minimap)
  // apply the quali grid as the start order (fastest quali -> P1), spread by slot
  // starting grid comes from the quali session (P1..P22); fall back to a one-shot grid if quali was skipped
  const grid = ctx.qualiSession ? finalGrid(ctx.qualiSession) : buildGrid(field.map(f => ({ ...f, risk: 0.5 })), ctx.track, 1234);
  grid.forEach((g, slot) => {
    const c = ctx.race.cars[g.idx];
    c.lap = 0; c.lapFrac = -slot * (GRID_GAP / ctx.track.lt); c.startPos = slot + 1;
  });
  ctx.paused = false;
  ctx._frame = 0;
  ctx._acc = 0; ctx._lastTs = 0;        // reset the real-time sim accumulator
  ctx._evtIdx = 0;                      // reset the commentary event cursor
  ctx.speed = ctx.speed || 1;
  ctx.practiceFindings = ctx.pracSession ? analyzeStrategy(ctx.pracSession.cars[ctx.myPlayer].strategy) : null;   // race-HUD aid
}
// a team's drivers as [{abbrev, name, skill}], lead first. Career mode reads the dynamic registry
// (transfers/churn change teamIdx); otherwise the static TEAMS roster.
function teamRoster(ti) {
  if (!ctx.career || !ctx.career.drivers) return TEAMS[ti].drivers.map(d => ({ abbrev: d.abbrev, name: d.name, skill: d.skill }));
  return Object.keys(ctx.career.drivers)
    .filter(ab => ctx.career.drivers[ab].teamIdx === ti)
    .sort((a, b) => ctx.career.drivers[b].overall - ctx.career.drivers[a].overall)
    .map(ab => ({ abbrev: ab, name: ctx.career.drivers[ab].name || DRIVER_NAME[ab] || ab, skill: ctx.career.drivers[ab].overall }));
}
// build the full 22-car field: player team's two drivers flagged, rest AI.
// Reused by quali grid and the race start (Task 15).
function buildField() {
  let idx = 0;
  const ideal = trackIdeal((ctx.track || TRACK).laps * 1000 + Math.round((ctx.track || TRACK).lt));
  return TEAMS.flatMap((t, ti) => teamRoster(ti).map((d, di) => {
    const isPlayerTeam = ti === ctx.teamIdx;
    // solo: only p1 is human, the teammate car runs as AI (player null)
    const player = isPlayerTeam ? (di === 0 ? "p1" : (ctx.solo ? null : "p2")) : null;
    const setup = (player && ctx.setups && ctx.setups[player]) ? ctx.setups[player] : [0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    const dr = ctx.career && ctx.career.drivers ? ctx.career.drivers[d.abbrev] : null;
    const overall = dr ? dr.overall : d.skill;
    const mMod = dr ? moraleMod(dr.morale) : 0;
    return {
      idx: idx++, name: d.name, abbrev: d.abbrev, skill: overall,
      car: composeCar(ctx.career ? effectiveCar(t.car, ctx.career.parts[t.name]) : t.car), color: t.color, team: t.name, isPlayer: isPlayerTeam, player,
      attrs: (dr && dr.attrs) ? dr.attrs : driverAttrs(d.abbrev, overall), personnel: (ctx.career && isPlayerTeam) ? composePersonnel(ctx.career.staff) : genPersonnel(t.facility, ti),
      setup, setupBonus: (player
        ? pracSetupBonus(player) + PRAC2.TRACK_PACE * pracTrackKnow(player)
        : paceBonus(closeness(setup, ideal)) + PRAC2.TRACK_PACE * PRAC2.AI_TRACK_KNOW) + mMod, startTyre: "medium",
    };
  }));
}

// race pace bonus for a player car from its confirmed setup satisfaction (replaces closeness).
function pracSetupBonus(player) {
  if (!ctx.pracSession) return 0;
  const sat = ctx.pracSession.cars[player].confirmedSat.reduce((a, b) => a + b, 0) / PRAC2.AXES;
  return paceBonus(sat);   // sat 1 ⇒ today's best bonus; lower ⇒ less
}
// current track knowledge for a player car (0 if no practice happened).
function pracTrackKnow(player) {
  return ctx.pracSession ? (ctx.pracSession.cars[player]?.trackKnow ?? 0) : 0;
}
// fold the session's accumulated stint data into the race-HUD strategy aid (cliff + recommended stops).
function analyzeStrategy(strategy) {
  const degByCompound = (strategy && strategy.degByCompound) || {};
  let recommendedStops = null;
  for (const c in degByCompound) {
    const st = degByCompound[c].stintLaps;
    if (st > 0) { const n = Math.max(1, Math.ceil((ctx.track || TRACK).laps / st) - 1); recommendedStops = recommendedStops == null ? n : Math.min(recommendedStops, n); }
  }
  return { degByCompound, recommendedStops };
}
// driver+car per player for the live practice session (the session carries the hidden ideal).
function practiceCars() {
  const t = TEAMS[ctx.teamIdx] || TEAMS[0];
  const personnel = ctx.career ? composePersonnel(ctx.career.staff) : genPersonnel(t.facility, ctx.teamIdx || 0);   // staff crew/facility → personnel
  const car = composeCar(ctx.career ? effectiveCar(t.car, ctx.career.parts[t.name]) : t.car);
  const roster = teamRoster(ctx.teamIdx);
  const mk = di => { const d = roster[di] || roster[0]; const cd = ctx.career && ctx.career.drivers ? ctx.career.drivers[d.abbrev] : null;
    return { drv: { skill: d.skill, attrs: (cd && cd.attrs) ? cd.attrs : driverAttrs(d.abbrev, d.skill) }, car, personnel }; };
  return { p1: mk(0), p2: mk(1) };
}
// broadcast the live practice-session snapshot (clock + per-car setup/knowledge) to both screens.
function pushPractice() {
  const snap = sessionSnapshot(ctx.pracSession);
  ctx.snapshot = snap;
  if (ctx.net) ctx.net.send(snap);
  rerender();
}
// the 22-car field for the quali session, mapped from buildField() to the newQuali shape.
function qualiField() {
  return buildField().map(f => ({ idx: f.idx, abbrev: f.abbrev, drv: { skill: f.skill, attrs: f.attrs }, car: f.car, setupBonus: f.setupBonus, player: f.player, trackKnow: f.player ? pracTrackKnow(f.player) : PRAC2.AI_TRACK_KNOW }));
}
// broadcast the live quali snapshot (timing tower + per-car controls) to both screens.
function pushQuali() {
  const snap = qualiSnapshot(ctx.qualiSession);
  ctx.snapshot = snap;
  if (ctx.net) ctx.net.send(snap);
  rerender();
}

// serialise the authoritative race state for the client + the host's own UI.
function raceSnapshot() {
  const evIdx = ctx._evtIdx || 0;
  const newEvents = ctx.race.events.slice(evIdx);   // only events not yet shipped
  ctx._evtIdx = ctx.race.events.length;
  return {
    type: "snapshot", phase: "race", trackName: ctx.trackName, paused: ctx.paused, finished: ctx.race.finished,
    speed: ctx.speed || 1, scActive: ctx.race.scActive, vscActive: ctx.race.vscActive, wetness: ctx.race.wetness, events: newEvents,
    practiceFindings: ctx.practiceFindings || null,
    cars: ctx.race.order().map(c => ({
      idx: c.idx, pos: c.pos, abbrev: c.abbrev, color: c.color, player: c.player,
      lap: c.lap, lapFrac: c.lapFrac, tyre: c.tyre, wear: c.wear,
      pace: c.pace, engine: c.engine, order: c.order, inFight: c._inFight, retired: c.retired, isPlayer: c.isPlayer,
      fuel: c.fuel, fuelLaps: fuelLaps(c.fuel, c.engine, c.car.fuel),
      pitStops: c.pitStops, tyreAge: c.tyreAge, tyreTemp: c.tyreTemp, lastLap: c.lastLap, startPos: c.startPos,
      inPit: c.pitTimer > 0,
      miniColors: c.player ? c.miniColors : undefined, sectorTimes: c.player ? c.sectorTimes : undefined,
    })),
  };
}
function pushRaceState() {
  const snap = raceSnapshot();
  ctx.snapshot = snap;
  if (ctx.net) ctx.net.send(snap);
  rerender();
}
const SIM_RATE = 4;   // sim-seconds per real-second at 1x — watchable (a ~78s lap takes ~20s on screen); 2x/4x fast-forward
function hostLoop(ts) {
  if (ctx.role === "host" && ctx.weekend.phase === "race" && ctx.race && !ctx.paused) {
    // advance by REAL elapsed time (not frame count) so the pace is the same on any monitor;
    // dt capped so a tab stall / unpause doesn't fast-forward the race.
    const dt = Math.min(0.1, ctx._lastTs ? (ts - ctx._lastTs) / 1000 : 0);
    ctx._acc = (ctx._acc || 0) + dt * (ctx.speed || 1) * SIM_RATE;   // sim-seconds owed
    let guard = 0;
    while (ctx._acc >= STEP && !ctx.race.finished && guard++ < 400) { ctx.race.step(STEP); ctx._acc -= STEP; }
    if ((++ctx._frame % 5) === 0) pushRaceState();          // throttle broadcast/render to ~12 Hz
    if (ctx.race.finished && !ctx._raceClosed) {
      ctx._raceClosed = true;
      if (ctx.career) {
        const cls = ctx.race.order().map(c => ({ abbrev: c.abbrev, team: c.team, retired: c.retired }));
        applyResult(ctx.career, cls);
        advanceRound(ctx.career);            // -> next round (or done)
        saveCareer(ctx.career);
        ctx.atPaddock = true; publishCareer();
        pushRaceState(); rerender();         // show the paddock with results + finances
      } else {
        pushRaceState();
        ctx.weekend.setReady("p1"); ctx.weekend.setReady("p2");  // non-career -> result screen
      }
    }
  }
  if (ctx.role === "host" && isPractice(ctx.weekend.phase) && ctx.pracSession && !ctx.pracSession.paused) {
    const dt = Math.min(0.1, ctx._pracLastTs ? (ts - ctx._pracLastTs) / 1000 : 0);
    pracStep(ctx.pracSession, dt * SIM_RATE);
    if ((++ctx._pracFrame % 4) === 0) pushPractice();
  }
  if (ctx.role === "host" && ctx.weekend.phase === "quali" && ctx.qualiSession && !ctx.qualiSession.paused) {
    const dt = Math.min(0.1, ctx._qLastTs ? (ts - ctx._qLastTs) / 1000 : 0);
    qualiStep(ctx.qualiSession, dt * SIM_RATE);
    if (ctx.qualiSession.clock <= 0 && ctx.qualiSession.segment <= 3) advanceSegment(ctx.qualiSession);
    if ((++ctx._qFrame % 4) === 0) pushQuali();
  }
  ctx._qLastTs = ts;
  ctx._pracLastTs = ts;
  ctx._lastTs = ts;
  requestAnimationFrame(hostLoop);
}

// CLIENT: render from snapshots; commands go to host
function onMessage(m) {
  if (m.type === "snapshot") { ctx.snapshot = m; rerender(); }
  if (m.type === "phase")    { ctx.weekend.phase = m.phase; rerender(); }
  if (m.type === "career")   { ctx.careerView = m.career; ctx.careerReadyView = m.ready; ctx.atPaddock = m.atPaddock; rerender(); }
  if (ctx.role === "host" && m.type === "command") onCommand(m);
  if (ctx.role === "host" && m.type === "hello") {
    if (ctx.weekend.phase === "lobby") {
      if (ctx.careerPending != null) beginCoopCareer(); else ctx.weekend.start();  // partner joined -> begin
    } else {                                                 // late joiner mid-weekend: resync
      ctx.net.send({ type: "phase", phase: ctx.weekend.phase });
      if (ctx.snapshot) ctx.net.send({ type: "snapshot", ...ctx.snapshot });
    }
  }
}

// connection entry points used by lobby UI
export async function hostGame(useP2P) {
  ctx.role = "host"; ctx.myPlayer = "p1";
  ctx.net = useP2P ? new P2PNet("host") : new LocalNet("dev", "host");
  ctx.net.onMessage(onMessage);
  const code = useP2P ? await ctx.net.host() : "dev";
  requestAnimationFrame(hostLoop);
  return code;
}
export async function joinGame(code, useP2P) {
  ctx.role = "client"; ctx.myPlayer = "p2";
  ctx.net = useP2P ? new P2PNet("client") : new LocalNet("dev", "client");
  ctx.net.onMessage(onMessage);
  if (useP2P) await ctx.net.join(code);
  ctx.net.send({ type: "hello" });   // ask the host to sync us to the current phase
}

// solo: single player engineers car p1; teammate + grid are AI. No network.
export function startSolo() {
  ctx.role = "host"; ctx.myPlayer = "p1"; ctx.solo = true; ctx.net = null;
  ctx.track = ctx.track || defaultRaceTrack();   // default Barcelona (with mini) unless a quick-race set it
  ctx.weekend.solo = true;
  requestAnimationFrame(hostLoop);
  ctx.weekend.start();
}

// ---- Career (M1) ----------------------------------------------------------
// keep host + client rendering from the same career view
function publishCareer() {
  ctx.careerView = ctx.career;
  ctx.careerReadyView = ctx.careerReady;
  if (ctx.net) ctx.net.send({ type: "career", career: ctx.career, ready: ctx.careerReady, atPaddock: !!ctx.atPaddock });
}
// configure ctx for the career's current round (track visual + sim track) before a weekend.
function loadRoundTrack() {
  const round = currentRound(ctx.career);
  ctx.track = careerTrack(round);
  ctx.trackName = round.shape;
}
// reset the per-weekend scratch so the next round starts clean.
function resetWeekendState() {
  ctx.seed = null; ctx.pracSession = null; ctx.qualiSession = null;
  ctx.race = null; ctx.setups = null; ctx._raceClosed = false;
}
// SOLO career: single player engineers p1; teammate + grid AI.
export function startCareerSolo(teamIdx) {
  ctx.role = "host"; ctx.myPlayer = "p1"; ctx.solo = true; ctx.net = null;
  ctx.teamIdx = teamIdx;
  ctx.career = newCareer({ teamIdx, seed: 1000 + Math.floor(Math.random() * 100000), coop: false });
  ctx.careerReady = { p1: false, p2: false };
  resetWeekendState(); loadRoundTrack(); ctx.atPaddock = true; publishCareer();
  ctx.weekend.solo = true;
  requestAnimationFrame(hostLoop);
  rerender();
}
// CO-OP career: host creates it; the first weekend begins when the partner joins (see onMessage hello).
export function hostCareer(teamIdx) { ctx.careerPending = teamIdx; }
function beginCoopCareer() {
  ctx.teamIdx = ctx.careerPending;
  ctx.career = newCareer({ teamIdx: ctx.careerPending, seed: 1000 + Math.floor(Math.random() * 100000), coop: true });
  ctx.careerReady = { p1: false, p2: false };
  ctx.careerPending = null;
  resetWeekendState(); loadRoundTrack(); ctx.atPaddock = true; publishCareer();
  rerender();
}
// advance the season after both players are ready (or solo).
// begin the upcoming round's weekend from the paddock.
function startWeekendFromPaddock() {
  ctx.careerReady = { p1: false, p2: false };
  ctx.atPaddock = false;
  resetWeekendState(); loadRoundTrack();
  ctx.weekend._goto("practice1");                          // fires onPhase -> practice + broadcasts
}
function startNewSeason() {
  ctx.career = newSeason(ctx.career);
  ctx.careerReady = { p1: false, p2: false };
  resetWeekendState(); loadRoundTrack(); ctx.atPaddock = true; publishCareer(); rerender();
}

// quick race straight onto an edited track (from the editor's 🏁 button) — skip lobby/practice/quali.
export function startQuickRace(edited) {
  ctx.role = "host"; ctx.myPlayer = "p1"; ctx.solo = true; ctx.net = null;
  ctx.track = trackFromEdited(edited);
  ctx.trackName = edited.name || null;            // 3D/minimap reads the edited circuit by name
  ctx.weekend.solo = true;
  requestAnimationFrame(hostLoop);
  ctx.weekend._goto("race");                      // jump to the race phase (fires onPhase -> startRaceHost)
}

const _quick = (typeof localStorage !== "undefined") ? localStorage.getItem("apexweb_race_track") : null;
if (_quick) {
  localStorage.removeItem("apexweb_race_track");
  const saved = loadAll()[_quick];
  if (saved && Array.isArray(saved.points) && saved.points.length >= 8) startQuickRace({ name: _quick, ...saved });
  else rerender();                                // stale flag -> normal boot
} else { rerender(); }
