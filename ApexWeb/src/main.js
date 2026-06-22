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
import { buildGrid, startCompoundForSlot } from "./quali.js";
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
import * as resultUI from "./ui/result_career.js";
import * as directorCreate from "./ui/director_create.js";
import * as preseasonUI from "./ui/preseason.js";
import { botchMult } from "./directors.js";
import { newCareer, newSeason, currentRound, isSeasonOver, applyResult, advanceRound, chooseTitleSponsor, constructorStandings, takeLoan, requestBoardFunds, acceptAcquisition, declineAcquisition, setDriverTraining, resolveDriverRequest } from "./career.js";
const applyBoost = (car, b) => b ? { ...car, power: Math.min(1.2, car.power + b), aero: Math.min(1.2, car.aero + b) } : car;   // living-grid rival bump
import { pushNews } from "./news.js";
import { careerTrack } from "./track_build.js";
import { effectiveCar, effectiveCarPU, applyRaceMods, applyConceptBias, aiConcept, startProject, startPUProject, startPUProgram, revertPart } from "./development.js";
import { moraleMod, reSign, DRIVER_NAME } from "./drivers.js";
import { composePersonnel, upgradeStaff, startFacilityProject, hireFromMarket, staffMarketAll, reSignStaff } from "./staff.js";
import { composePitCrew, practicePitStops, recruitMember, toggleTraining, pitCrewMarket, PRACTICE_FEE, RECRUIT_FEE } from "./pitcrew.js";
import { signDriver, negotiateSign, applyCounter } from "./market.js";
import { signJunior, promoteJunior, scoutProspect, setRole, loanJunior, extendJunior, upgradeProgram } from "./academy.js";
import { saveCareer, loadCareer, hasCareer, clearCareer } from "./career_store.js";

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
  // wide #app for the 2-col dashboards: race/result, the practice setup grid, and the paddock (its
  // dashboards/tabs lay out in multiple columns on desktop instead of one narrow stack)
  if (phase === "race" || phase === "result" || isPractice(phase) || phase === "quali" || ctx.careerView) cls.push("wide");
  if (phase === ctx._renderedPhase) cls.push("no-anim");          // rebuild of the same screen → no re-entrance
  ctx._renderedPhase = phase;
  root.className = cls.join(" ");
  // a render error must NEVER escape: it runs inside the host rAF loop, so an uncaught throw would skip
  // the loop's reschedule and freeze the whole session ("что-то сломалось" / black screen). Log + show a
  // notice instead, keeping the loop alive and the cause diagnosable in the console.
  try {
    if (ctx.atDirectorCreate) { directorCreate.render(root, ctx, onDirectorsDone); }
    else if (ctx.atPreseason) { preseasonUI.render(root, ctx, onPreseasonDone); }
    else {
      const mod = (ctx.careerView && ctx.atResults) ? resultUI
                : (ctx.careerView && ctx.atPaddock) ? seasonUI
                : SCREENS[phase];
      mod.render(root, ctx);
    }
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
      if (ctx.career) { startProject(ctx.career, cmd.part, cmd.size, cmd.approach, cmd.player); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_revert":                       // P2: roll a regressed part back to its previous spec (free)
      if (ctx.career) { revertPart(ctx.career, cmd.part); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_concept":
      if (ctx.career && ctx.career.concept !== cmd.concept) {
        const applyConcept = (c, k) => { const pre = (c.round === 0 || c.done); if (pre) { c.concept = k; return true; } if (c.money >= 3500) { c.money -= 3500; c.capSpent = (c.capSpent || 0) + 3500; c.concept = k; return true; } return false; };
        if (ctx.career.coop) { ctx.career.proposal = { type: "concept", value: cmd.concept, by: cmd.player }; saveCareer(ctx.career); publishCareer(); rerender(); }   // P6: needs co-director sign-off
        else { applyConcept(ctx.career, cmd.concept); saveCareer(ctx.career); publishCareer(); rerender(); }
      }
      break;
    case "career_devfocus":
      if (ctx.career) {
        const f = Math.max(0, Math.min(0.6, +cmd.focus || 0));
        if (ctx.career.coop) { ctx.career.proposal = { type: "devfocus", value: f, by: cmd.player }; saveCareer(ctx.career); publishCareer(); rerender(); }   // P6: needs co-director sign-off
        else { ctx.career.devFocus = f; saveCareer(ctx.career); publishCareer(); rerender(); }
      }
      break;
    case "career_proposal_resolve":               // P6: the OTHER co-director approves/rejects a pending shared decision
      if (ctx.career && ctx.career.proposal && cmd.player !== ctx.career.proposal.by) {
        const p = ctx.career.proposal;
        if (cmd.approve) {
          if (p.type === "concept") { const c = ctx.career, pre = (c.round === 0 || c.done); if (pre) c.concept = p.value; else if (c.money >= 3500) { c.money -= 3500; c.capSpent = (c.capSpent || 0) + 3500; c.concept = p.value; } }
          else if (p.type === "devfocus") ctx.career.devFocus = p.value;
          else if (p.type === "pu_project") startPUProject(ctx.career, p.value.part, p.value.size);
        }
        ctx.career.proposal = null; saveCareer(ctx.career); publishCareer(); rerender();
      }
      break;
    case "career_train":
      if (ctx.career) { setDriverTraining(ctx.career, cmd.abbrev, cmd.focus); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_driver_req":
      if (ctx.career) { resolveDriverRequest(ctx.career, cmd.abbrev, !!cmd.accept); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_pu_project":
      if (ctx.career) {
        if (ctx.career.coop && cmd.size === "large") { ctx.career.proposal = { type: "pu_project", value: { part: cmd.part, size: cmd.size }, by: cmd.player }; saveCareer(ctx.career); publishCareer(); rerender(); }   // P6: a big token spend needs co-sign
        else { startPUProject(ctx.career, cmd.part, cmd.size); saveCareer(ctx.career); publishCareer(); rerender(); }
      }
      break;
    case "career_pu_program":
      if (ctx.career) { startPUProgram(ctx.career, cmd.kind); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_pu_contract":                  // P4: customer chooses current vs last-year engine spec
      if (ctx.career && !(ctx.career.backer && ctx.career.backer.puMaker)) { ctx.career.puContract = cmd.spec === "prev" ? "prev" : "current"; saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_resign":
      if (ctx.career) { reSign(ctx.career, cmd.abbrev); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_upgrade":
      if (ctx.career) {
        if (cmd.kind === "staff") upgradeStaff(ctx.career, cmd.key);
        else if (cmd.kind === "facility") startFacilityProject(ctx.career, cmd.key);   // T4: build over time
        saveCareer(ctx.career); publishCareer(); rerender();
      }
      break;
    case "career_hire":
      if (ctx.career) {
        const person = staffMarketAll(ctx.career, ctx.career.season || 1).find(p => p.id === cmd.id);   // same seed host & client
        const ok = person ? hireFromMarket(ctx.career, person) : false;   // free agent → hire, rival → poach
        if (person) pushNews(ctx.career, ok ? `${person.name} ${person.team ? "переманен из " + person.team : "нанят в команду"}.` : `Не удалось: ${person.name}.`);
        saveCareer(ctx.career); publishCareer(); rerender();
      }
      break;
    case "career_staff_train":
      if (ctx.career) { ctx.career.staffTrain = ctx.career.staffTrain || {}; ctx.career.staffTrain[cmd.role] = !ctx.career.staffTrain[cmd.role]; saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_resign_staff":
      if (ctx.career) { reSignStaff(ctx.career, cmd.role); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_sign":
      if (ctx.career) {
        const meS = constructorStandings(ctx.career).find(s => s.isPlayer);
        const strength = meS ? 1 - (meS.pos - 1) / (TEAMS.length - 1) : 0.5;
        const opts = { teamStrength: strength, length: cmd.length || 2, clauses: cmd.clauses || null, seed: (ctx.career.round + 1) * 131 + cmd.inAbbrev.charCodeAt(0) };
        const r = negotiateSign(ctx.career, cmd.inAbbrev, cmd.outAbbrev, opts);
        if (r.reason === "counter") {           // agent counter-offer → stash it for the UI banner (no swap yet)
          ctx.career.negotiation = { inAbbrev: cmd.inAbbrev, outAbbrev: cmd.outAbbrev, opts, counter: r.counter };
          pushNews(ctx.career, `💬 Агент ${cmd.inAbbrev}: ${r.counter.label}.`);
        } else {
          ctx.career.negotiation = null;
          pushNews(ctx.career, r.ok ? `Трансфер: ${cmd.inAbbrev} подписан (${cmd.length || 2} сез).` : `Трансфер ${cmd.inAbbrev} сорвался: ${r.reason}.`);
        }
        saveCareer(ctx.career); publishCareer(); rerender();
      }
      break;
    case "career_sign_accept":                 // accept the agent's counter-offer → forced sign on its terms
      if (ctx.career && ctx.career.negotiation) {
        const n = ctx.career.negotiation;
        const r = negotiateSign(ctx.career, n.inAbbrev, n.outAbbrev, applyCounter(n.opts, n.counter));
        pushNews(ctx.career, r.ok ? `Трансфер: ${n.inAbbrev} подписан на условиях агента.` : `Сделка по ${n.inAbbrev} сорвалась: ${r.reason}.`);
        ctx.career.negotiation = null;
        saveCareer(ctx.career); publishCareer(); rerender();
      }
      break;
    case "career_sign_cancel":                 // walk away from the negotiation
      if (ctx.career) { ctx.career.negotiation = null; saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_scout":                       // sign a scouted prospect into the academy
      if (ctx.career) { signJunior(ctx.career, cmd.abbrev); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_scout_more":                  // commission another scouting report on a prospect
      if (ctx.career) { scoutProspect(ctx.career, cmd.abbrev); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_promote":
      if (ctx.career) { promoteJunior(ctx.career, cmd.abbrev, cmd.outAbbrev); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_junior_role":                 // toggle reserve / FP1 development role
      if (ctx.career) { setRole(ctx.career, cmd.abbrev, cmd.role); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_junior_loan":                 // loan a junior to a rival seat for a season
      if (ctx.career) { loanJunior(ctx.career, cmd.abbrev, cmd.team); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_junior_extend":               // extend a junior's academy contract
      if (ctx.career) { extendJunior(ctx.career, cmd.abbrev); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_academy_upgrade":             // invest in the academy programme tier
      if (ctx.career) { upgradeProgram(ctx.career); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_pit_practice":                // PIT: run a between-races pit-practice session
      if (ctx.career && ctx.career.pitCrew && ctx.career.money >= PRACTICE_FEE) { ctx.career.money -= PRACTICE_FEE; practicePitStops(ctx.career.pitCrew); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_pit_train":                   // PIT: toggle the crew's season training programme
      if (ctx.career && ctx.career.pitCrew) { toggleTraining(ctx.career.pitCrew); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_pit_recruit":                 // PIT: recruit a market member into a role
      if (ctx.career && ctx.career.pitCrew && cmd.cand && ctx.career.money >= RECRUIT_FEE) { ctx.career.money -= RECRUIT_FEE; recruitMember(ctx.career.pitCrew, cmd.cand.role, cmd.cand); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_to_paddock":                 // dismiss the post-race results screen -> paddock
      if (ctx.career) { ctx.atResults = false; ctx.atPaddock = true; publishCareer(); rerender(); }
      break;
    case "career_loan":
      if (ctx.career) { takeLoan(ctx.career, +cmd.amount || 0); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_funds":   // §Phase-6: request a one-per-season board cash injection (cash now, confidence cost)
      if (ctx.career) { requestBoardFunds(ctx.career, +cmd.amount || 0); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_sign_sponsor":
      if (ctx.career && ctx.career.sponsorOffer) { ctx.career.sponsors = [...(ctx.career.sponsors || []), ctx.career.sponsorOffer]; ctx.career.sponsorOffer = null; saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_acquire_accept":
      if (ctx.career) { acceptAcquisition(ctx.career, !!cmd.rebrand); saveCareer(ctx.career); publishCareer(); rerender(); }
      break;
    case "career_acquire_decline":
      if (ctx.career) { declineAcquisition(ctx.career); saveCareer(ctx.career); publishCareer(); rerender(); }
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
    case "set_team_order": ctx.race?.setTeamOrder(cmd.mode); break;
    case "deploy_perk": if (ctx.race?.deployPerk(cmd.car, cmd.key)) pushRaceState(); break;   // §Phase-5 mechanic perk (HUD offers only Chemistry-unlocked perks; sim enforces once-per-race)
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
  // E4: serve any PU grid penalty — drop the player's car(s) back N places on the start grid.
  if (ctx.career && ctx.career.pu && ctx.career.pu.penalty > 0) {
    const pen = ctx.career.pu.penalty;
    for (const f of field) {
      if (!f.isPlayer) continue;
      const from = grid.findIndex(g => g.idx === f.idx);
      if (from >= 0) { const [g] = grid.splice(from, 1); grid.splice(Math.min(grid.length, from + pen), 0, g); }
    }
    ctx.career.pu.penalty = 0; saveCareer(ctx.career);   // served once
  }
  // E9: serve rivals' PU grid penalties — drop each penalized AI team's cars back N places.
  if (ctx.career && ctx.career.aiPu) {
    let served = false;
    for (const f of field) {
      if (f.isPlayer) continue;
      const a = ctx.career.aiPu[f.team];
      if (a && a.penalty > 0) {
        const from = grid.findIndex(g => g.idx === f.idx);
        if (from >= 0) { const [g] = grid.splice(from, 1); grid.splice(Math.min(grid.length, from + a.penalty), 0, g); served = true; }
      }
    }
    if (served) { for (const tn in ctx.career.aiPu) if (ctx.career.aiPu[tn].penalty > 0) ctx.career.aiPu[tn].penalty = 0; saveCareer(ctx.career); }
  }
  grid.forEach((g, slot) => {
    const c = ctx.race.cars[g.idx];
    c.lap = 0; c.lapFrac = -slot * (GRID_GAP / ctx.track.lt); c.startPos = slot + 1;
    // F1/MM start-tyre rule: top-10 (Q3) are locked onto the soft they qualified on; rest free to medium.
    if (ctx.qualiSession) c.tyre = startCompoundForSlot(slot);
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
// the managed pit crew OWNS pit-stop speed: override the staff-derived pitMult with the crew's.
function pcPersonnel(base, crew) { if (!crew) return base; return { ...base, pitMult: composePitCrew(crew).pitMult }; }
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
      car: composeCar(ctx.career ? (isPlayerTeam ? applyRaceMods(effectiveCarPU(t.car, ctx.career.parts[t.name], ctx.career.puParts), ctx.career, ctx.track) : applyBoost(applyConceptBias(effectiveCar(t.car, ctx.career.parts[t.name]), aiConcept(t.name)), (ctx.career.gridBoost || {})[t.name])) : t.car), color: t.color, team: t.name, isPlayer: isPlayerTeam, player,
      attrs: (dr && dr.attrs) ? dr.attrs : driverAttrs(d.abbrev, overall),
      // §Phase-3 car-confidence: freshly-fitted (unproven) parts leave the car not-yet-bedded-in → a small early pace hit that recovers; an adaptable (consistent + race-smart) driver settles faster. AI / non-career = settled (1).
      partConfidence: (ctx.career && isPlayerTeam) ? Math.max(0.7, 1 - 0.05 * ((ctx.career.unproven || []).length)) : 1,
      adaptability: (dr && dr.attrs) ? Math.max(0, Math.min(1, ((dr.attrs.consistency || 0.7) + (dr.attrs.race_iq || 0.7)) / 2)) : 0.7,
      personnel: (ctx.career && isPlayerTeam) ? pcPersonnel(composePersonnel(ctx.career.staff), ctx.career.pitCrew) : genPersonnel(t.facility, ti),
      pitCrew: (ctx.career && isPlayerTeam && ctx.career.pitCrew) ? (() => { const pc = composePitCrew(ctx.career.pitCrew), bm = botchMult(ctx.career); return { botchChance: pc.botchChance * bm, disasterChance: pc.disasterChance * bm }; })() : null,   // mechanic co-director (Гл. механик) trims botch/disaster (botchMult < 1)

      rival: (ctx.career && isPlayerTeam && dr) ? (dr.rival || null) : null,   // rivalries: this driver's personal rival
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
  const car = composeCar(ctx.career ? applyRaceMods(effectiveCarPU(t.car, ctx.career.parts[t.name], ctx.career.puParts), ctx.career, ctx.track) : t.car);
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
    speed: ctx.speed || 1, scActive: ctx.race.scActive, vscActive: ctx.race.vscActive, wetness: ctx.race.wetness, weatherInfo: ctx.race.weatherInfo || null, events: newEvents, teamOrder: ctx.race.teamOrder,
    practiceFindings: ctx.practiceFindings || null,
    cars: ctx.race.order().map(c => ({
      idx: c.idx, pos: c.pos, abbrev: c.abbrev, color: c.color, player: c.player,
      lap: c.lap, lapFrac: c.lapFrac, tyre: c.tyre, wear: c.wear,
      pace: c.pace, engine: c.engine, order: c.order, inFight: c._inFight, retired: c.retired, isPlayer: c.isPlayer,
      fuel: c.fuel, fuelLaps: fuelLaps(c.fuel, c.engine, c.car.fuel),
      pitStops: c.pitStops, tyreAge: c.tyreAge, tyreTemp: c.tyreTemp, lastLap: c.lastLap, startPos: c.startPos,
      inPit: c.pitTimer > 0,
      miniColors: c.player ? c.miniColors : undefined, sectorTimes: c.player ? c.sectorTimes : undefined,
      parts: c.player ? c.parts : undefined, partFail: c.player ? c._partFail : undefined,   // §Phase-2 part condition (HUD)
      feedback: (c.player && c.attrs) ? c.attrs.race_iq : undefined,   // §Phase-5: driver Feedback → trustworthiness of the tyre-life readout
      perkUsed: c.player ? !!c._perkUsed : undefined, perkLaps: (c.player && c._perk) ? c._perk.lapsLeft : undefined,   // §Phase-5 mechanic perk state (HUD)
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
    if (!ctx.race.finished && (++ctx._frame % 5) === 0) pushRaceState();   // throttle ~12Hz; STOP once finished so the
    //   results/paddock screen isn't re-rendered every frame (that destroyed buttons mid-click — the freeze bug)
    if (ctx.race.finished && !ctx._raceClosed) {
      ctx._raceClosed = true;
      if (ctx.career) {
        const cls = ctx.race.order().map(c => ({ abbrev: c.abbrev, team: c.team, retired: c.retired }));
        const pcars = ctx.race.cars.filter(c => c.isPlayer);   // E4/E6/P3: engine-mode usage over the race → PU wear
        const pushFrac = pcars.length ? pcars.reduce((s, c) => s + ((c.pushTicks || 0) / Math.max(1, c.runTicks || 0)), 0) / pcars.length : 0;
        // P3: full engine-mode mix (save/standard/push) across the team's cars → single source of mode-based PU wear.
        let modeMix = null;
        if (pcars.length) {
          let run = 0, push = 0, save = 0;
          for (const c of pcars) { run += (c.runTicks || 0); push += (c.pushTicks || 0); save += (c.saveTicks || 0); }
          run = Math.max(1, run);
          modeMix = { push: push / run, save: save / run, standard: Math.max(0, (run - push - save) / run) };
        }
        const starts = {}; for (const cc of ctx.race.cars) starts[cc.abbrev] = cc.startPos;   // G1: grid → poles + quali H2H
        const pIdx = new Set(pcars.map(c => c.idx));   // §Phase-6: count the stewards' penalties the player's cars drew → cash fine
        const penalties = ctx.race.events.filter(e => e.type === "penalty" && pIdx.has(e.a)).length;
        applyResult(ctx.career, cls, { pushFrac, modeMix, starts, penalties });
        advanceRound(ctx.career);            // -> next round (or done)
        saveCareer(ctx.career);
        ctx.atResults = true; ctx.atPaddock = false; publishCareer();
        pushRaceState(); rerender();         // show the post-race RESULTS screen (podium + finances) -> paddock on "В паддок"
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
  if (m.type === "career")   { ctx.careerView = m.career; ctx.careerReadyView = m.ready; ctx.atPaddock = m.atPaddock; ctx.atResults = m.atResults; rerender(); }
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
  if (ctx.net) ctx.net.send({ type: "career", career: ctx.career, ready: ctx.careerReady, atPaddock: !!ctx.atPaddock, atResults: !!ctx.atResults });
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
// begin the career-start flow (team chosen → create co-directors → pre-season → paddock). The career
// is created AFTER director-create so the financier specialty's budget bonus applies. coop=false → solo.
function beginDirectorCreate(teamIdx, coop) {
  ctx.role = "host"; ctx.myPlayer = "p1"; ctx.coop = coop; ctx.solo = !coop;
  ctx.teamIdx = teamIdx;
  ctx._careerSeed = 1000 + Math.floor(Math.random() * 100000);
  ctx.careerReady = { p1: false, p2: false };
  ctx.weekend.solo = !coop;
  ctx.career = null; ctx.careerView = null;
  ctx.atDirectorCreate = true; ctx.atPreseason = false; ctx.atPaddock = false; ctx.atResults = false;
  ctx._directors = null; ctx.pendingDirectors = null; ctx._preBudget0 = null;
  requestAnimationFrame(hostLoop);          // idles until a weekend starts; keeps the host loop alive
  rerender();
}
// director-create confirmed → create the career (with the chosen specialties) → pre-season.
function onDirectorsDone() {
  ctx.career = newCareer({ teamIdx: ctx.teamIdx, seed: ctx._careerSeed, coop: !!ctx.coop, directors: ctx.pendingDirectors || [], scoring: ctx.ruleset || "standard" });
  ctx.atDirectorCreate = false; ctx.atPreseason = true; ctx._preBudget0 = null;
  rerender();
}
// pre-season confirmed → enter the paddock; the career officially begins (leftover budget = season cash).
function onPreseasonDone() {
  ctx.atPreseason = false;
  resetWeekendState(); loadRoundTrack(); ctx.atPaddock = true;
  saveCareer(ctx.career); publishCareer(); rerender();
}
// SOLO career: single player engineers p1; teammate + grid AI.
export function startCareerSolo(teamIdx) { ctx.net = null; beginDirectorCreate(teamIdx, false); }
// resume a saved SOLO career from localStorage. Returns false if there is no save.
export function continueCareer() {
  const saved = loadCareer();
  if (!saved) return false;
  ctx.role = "host"; ctx.myPlayer = "p1"; ctx.solo = true; ctx.net = null;
  ctx.career = saved; ctx.teamIdx = saved.teamIdx;
  ctx.careerReady = { p1: false, p2: false };
  resetWeekendState();
  if (!isSeasonOver(ctx.career)) loadRoundTrack();   // a finished season opens the paddock summary, no round track
  ctx.weekend.solo = true; ctx.atPaddock = true; publishCareer();
  requestAnimationFrame(hostLoop);
  rerender();
  return true;
}
// abandon the saved career (used by the lobby "delete save").
export function deleteCareerSave() { clearCareer(); }
// CO-OP career: host creates it; the first weekend begins when the partner joins (see onMessage hello).
export function hostCareer(teamIdx) { ctx.careerPending = teamIdx; }
function beginCoopCareer() {
  const t = ctx.careerPending; ctx.careerPending = null;
  beginDirectorCreate(t, true);             // host runs director-create + pre-season; client waits for the career broadcast at paddock
}
// advance the season after both players are ready (or solo).
// begin the upcoming round's weekend from the paddock.
function startWeekendFromPaddock() {
  ctx.careerReady = { p1: false, p2: false };
  ctx.atPaddock = false; ctx.atResults = false;
  resetWeekendState(); loadRoundTrack();
  ctx.weekend._goto("practice1");                          // fires onPhase -> practice + broadcasts
}
function startNewSeason() {
  ctx.career = newSeason(ctx.career);
  ctx.careerReady = { p1: false, p2: false };
  resetWeekendState(); loadRoundTrack(); ctx.atPaddock = true; publishCareer(); saveCareer(ctx.career); rerender();
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
