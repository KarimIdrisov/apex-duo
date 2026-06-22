// ApexWeb/src/sim.js
import { RNG, mix32 } from "./rng.js";
import { COMPOUNDS, PACE_MODES, ENGINE_MODES, SKILL_K, CAR_K, CAR_PACE_K, STEP, DNF_BASE, GRID_GAP, COMBAT_GAP, TYRE, DIRTY_GAP, EVENT, ATTRW, AI_HANDICAP, AI_NOISE, AI_FORM, RACE_FORM, DEFEND_ROLL, DEFEND_MAX, DNF_CONSIST, INCIDENT, FATIGUE_K, FATIGUE_PUSH } from "./data.js";
import { startFuel, burnFor, weightTerm, engineTerm, fuelLaps } from "./fuel.js";
import { tyreTerm, warmStep } from "./tyres.js";
import { perkEffect } from "./perks.js";
import { miniSplits, N_MINI, sampleAt } from "./track.js";
import { slipstream, dirtyWear, passAccrual, zoneFor } from "./overtake.js";
import { PASS_CREDIT_CAP, PASS_CREDIT_DECAY, DIRTY_PACE_K, LAP1_CAUTION,
  AGGR_PASS_EDGE, AGGR_PASS_ATTR, AGGR_PASS_REF, AGGR_PASS_K, AGGR_PASS_DNF, AGGR_PASS_SCRUB,
  BLUE_GAP, BLUE_PACE, BLUE_COST, ATTACK_CREDIT_K, DEFEND_ORDER_K,
  ATTACK_WEAR_MULT, ATTACK_SCRUB, DEFEND_WEAR_MULT, DEFEND_SCRUB,
  ORDER_MISTAKE_BASE, ORDER_MISTAKE_RAMP, ORDER_MISTAKE_RAMP_CAP, ORDER_MISTAKE_SCRUB_MIN, ORDER_MISTAKE_SCRUB_MAX } from "./data.js";
import { incidentChance, cautionFromIncident } from "./events.js";
import { PARTS, PART_WEAR } from "./data.js";
import { initParts, partWear, failChance, partZone, PART_KEYS } from "./parts.js";
import { scheduleWeather, wetnessAt, weatherTerm, liveForecast } from "./weather.js";
import { planRace, pitDecision, engineMode, paceMode, combatOrder } from "./ai_strategy.js";
import { ATTR_KEYS } from "./team.js";

const ENGINE_KEYS = new Set(Object.keys(ENGINE_MODES));   // save/standard/push + overtake/superovertake (MM burst modes)
const ORDER_KEYS = new Set(["none", "attack", "defend"]);
const TEAM_ORDER_KEYS = new Set(["none", "hold", "swap"]);   // MM team orders for the player's two cars
const NEUTRAL_ATTRS = Object.fromEntries(ATTR_KEYS.map(k => [k, 0.5]));
const A = c => c.attrs || NEUTRAL_ATTRS;   // attribute accessor with a neutral fallback

export class Race {
  constructor(field, track, seed, difficulty = 0.85, opts = {}) {
    // §Phase-6 lobby rules (neutral defaults → byte-identical for every existing caller):
    this.startType = opts.startType || "standing";   // "standing" | "rolling"
    this.cautionMult = opts.cautionMult ?? 1;         // scales caution probability (0 = no safety cars)
    this.track = track;
    this.rng = new RNG(seed);
    this.erng = new RNG(mix32(seed));
    this.seed = seed >>> 0;   // base seed for the stateless lap-keyed event RNGs (orders, incidents)
    this.time = 0;
    this.finished = false;
    this.sessionBestMini = new Array(N_MINI).fill(Infinity);
    this.scActive = false; this.vscActive = false; this.scEverActive = false; this.scStartLap = 0; this._started = false;
    this._cautionsDone = 0;   // live cautions triggered so far (capped at INCIDENT.maxCautions)
    this._vscWas = false;
    this.weather = scheduleWeather(this.erng, track.wet, track.laps);
    this.wetness = 0;
    this.cars = field.map((f, i) => ({
      idx: i, name: f.name, abbrev: f.abbrev, skill: f.skill, car: f.car,
      attrs: f.attrs ?? null, personnel: f.personnel ?? null, pitCrew: f.pitCrew ?? null, rival: f.rival ?? null,
      color: f.color, team: f.team, isPlayer: !!f.isPlayer, player: f.player ?? null,
      driverStatus: f.driverStatus ?? null,   // §Phase-3: "lead" (#1) / "support" / "equal"(null) — gates double-stack pit priority

      setup: f.setup ?? [0.5, 0.5, 0.5], setupBonus: f.setupBonus ?? 0,
      lap: 0, lapFrac: 0, lapTimeAccum: 0, lastLap: 0, totalTime: 0,
      avgLap: 0, _lapSum: 0, _lapN: 0,
      tyre: f.startTyre ?? "medium", wear: 0, tyreAge: 0, tyreTemp: TYRE.gridTemp,
      fuel: startFuel(track, f.fuelMargin), engine: "standard",   // §Phase-1: player can set a leaner/heavier start fuel load (f.fuelMargin; undefined → tuned default)
      pace: "balanced",
      retired: false, pitPending: null, pos: i + 1, startPos: i + 1,
      pitStops: 0, pitTimer: 0, penaltyTimer: 0,
      lastMini: [], bestMini: new Array(N_MINI).fill(Infinity), miniColors: [], sectorTimes: [0, 0, 0],
      _dirtyWear: 0, _dirtyPace: 0, _blueDelay: 0, _blueBudget: 0, _blueLast: -1, _creditVs: -1, _launch: 0,
      order: "none", _orderBit: false, _orderLaps: 0, _inFight: false,
      parts: initParts(), _brakeLimp: 0, _partFail: null, _dnfPart: null,   // §Phase-2 in-race part condition; _partFail = failed brake (limp); _dnfPart = the critical part that retired the car
      _conf: f.partConfidence ?? 1, _adapt: f.adaptability ?? 0.7,   // §Phase-3 car-confidence: a freshly-changed car (unproven parts) starts <1 and costs pace until bedded in; adaptability speeds recovery. Default 1 = settled → byte-identical.
    }));
    // field-mean car performance ((power+aero)/2), fixed for the race — the anchor the
    // absolute car-pace term is measured against, so a better-than-average car is faster (§18.1).
    this.carMean = this.cars.reduce((s, c) => s + (c.car.power + c.car.aero) / 2, 0) / this.cars.length;
    // field-mean consistency — the DNF modulation is centered on THIS (not 0.5) so it shifts incidents
    // between drivers without changing the field-wide DNF rate (attrs cluster around each driver's overall, not 0.5).
    this.consMean = this.cars.reduce((s, c) => s + A(c).consistency, 0) / this.cars.length;
    // field-mean fitness — the late-race fatigue fade is centered on THIS so it adds fit-vs-unfit texture
    // without shifting the field-wide pace (§Phase-3).
    this.fitMean = this.cars.reduce((s, c) => s + A(c).fitness, 0) / this.cars.length;
    this.difficulty = difficulty;   // AI sharpness scalar (lobby-selected; default ~Обычная)
    for (const c of this.cars) {
      // per-race "form": a fixed whole-race pace offset, seeded (no rng draw → other streams untouched),
      // applied to EVERY car — an off/on weekend for anyone. Breaks the deterministic best-package lock
      // the absolute car-pace term would otherwise create (§18.1).
      const ff = ((mix32(((seed >>> 0) + (c.idx >>> 0) * 0x85ebca6b) >>> 0) % 2000) / 1000) - 1;  // [-1,1]
      c._form = ff * RACE_FORM;
      if (c.player == null) {
        c.aiPlan = planRace(c, track, seed, this.difficulty); c.aiStopsDone = 0;
        // extra form swing for AI at low difficulty (a separate, decorrelated stream),
        // scaled by 1-difficulty → easy AI has bigger off/on weekends (upsets); hard AI razor-flat.
        const f = ((mix32(((seed >>> 0) + (c.idx >>> 0) * 0x9e3779b1) >>> 0) % 2000) / 1000) - 1;  // [-1,1]
        c._aiForm = f * (1 - this.difficulty) * AI_FORM;
      }
    }
    this.events = [];                 // deterministic structured event log (string-free)
    this._fastLap = Infinity;         // best lap time seen so far (for "fastest lap" events)
    this._scWas = false;              // safety-car edge detector
    this._retiredSeen = new Set();    // idx already announced as DNF
    this.teamOrder = "none";          // MM team order for the player's two cars: none | hold | swap
  }

  _emit(ev) { this.events.push(ev); }   // append a structured event (read-only w.r.t. the sim)

  // command entry points — bounds/validate the (possibly network-supplied) car index + mode so a
  // malformed peer can't crash the host sim (host-authoritative trust boundary; audit r3).
  setPace(i, mode) { const c = this.cars[i]; if (c && PACE_MODES[mode]) { c.pace = mode; c._pin = true; } }
  setEngine(i, mode) { const c = this.cars[i]; if (c && ENGINE_KEYS.has(mode)) { c.engine = mode; c._pin = true; } }

  // player combat order for their own car (validated; player cars are skipped by the AI brain already)
  setOrder(i, mode) { const c = this.cars[i]; if (c && ORDER_KEYS.has(mode)) c.order = mode; }

  // MM team order for the player's two cars (team-level; either co-op player or the solo human can set it).
  // "hold" = the trailing teammate holds station (no intra-team pass); "swap" = wave the trailing car
  // through (one-shot reposition). Applied in _resolveCombat only between two isPlayer same-team cars.
  setTeamOrder(mode) { if (TEAM_ORDER_KEYS.has(mode)) this.teamOrder = mode; }

  // §Phase-5 mechanic perk: deploy a once-per-race, bounded effect on a player car. One-shot perks
  // (cooldown) apply instantly (reset tyre temp into the window); the rest arm a few-lap wear/fuel/pace
  // modifier (decremented at each lap end). Ignored if the car already used its perk this race. Returns
  // true if applied. Perks are opt-in deploys — a car never auto-gets one, so the balance harness is
  // byte-identical (c._perk stays null).
  deployPerk(i, key) {
    const c = this.cars[i]; if (!c || c.retired || c._perkUsed) return false;
    const fx = perkEffect(key); if (!fx) return false;
    c._perkUsed = true;
    if (fx.oneShot) { c.tyreTemp = 1; return true; }        // instant: tyres back in the operating window
    c._perk = { ...fx, lapsLeft: fx.laps };
    return true;
  }

  // stateless lap-keyed RNG for event rolls (order lock-up, incident, caution) — deterministic,
  // independent of the per-tick rng/erng streams and of draw order. kind: 1=lockup 2=incident 3=caution.
  _keyRng(idx, lap, kind) {
    return new RNG(mix32(((this.seed + (idx >>> 0) * 2654435761 + (lap >>> 0) * 40503 + (kind >>> 0) * 2246822519) >>> 0)));
  }

  // clean lap time for one car right now (seconds)
  _lapTime(c) {
    const t = this.track, comp = COMPOUNDS[c.tyre], pm = PACE_MODES[c.pace];
    let s = t.lt;
    s -= SKILL_K * (A(c).pace - 0.5);                    // driver pace attribute
    s -= CAR_PACE_K * ((c.car.power + c.car.aero) / 2 - this.carMean);   // absolute car performance (§18.1): a better car is faster on any track
    s -= CAR_K * ((c.car.power - c.car.aero) * (t.pw - t.df));   // track-character bias (power on straights vs aero in corners)
    s += comp.pace + tyreTerm(c.tyre, c.wear, c.tyreTemp);
    s += weatherTerm(c.tyre, this.wetness) * (1.3 - ATTRW.wet * A(c).wet);   // wet skill cuts the penalty
    s += pm.pace;
    s += engineTerm(c.engine);          // fuel push/save lever
    s += weightTerm(c.fuel);            // heavy tank = slower (eases as fuel burns)
    s += c.setupBonus;                                           // <=0, faster when set well
    if (c._perk) s -= c._perk.paceBonus;                         // §Phase-5: an active "pushnow" mechanic perk (default perk = none → 0)
    s += (1 - (c._conf ?? 1)) * 0.6;                             // §Phase-3 car-confidence: a not-yet-bedded-in car (unproven parts) costs pace; 0 when settled (default)
    s += this.rng.noise(0.06) * (1.3 - ATTRW.noise * A(c).consistency);      // consistency steadies the lap
    s += c._dirtyPace || 0;                                                   // dirty-air pace loss (set by _resolveCombat, §18.11)
    s += c._brakeLimp || 0;                                                   // limping with a failed non-critical part (§Phase-2)
    s += c._blueDelay || 0;                                                   // time threading past a lapped car (blue flags, set by _resolveBlueFlags)
    s += c._form || 0;                                                        // per-race form (off/on weekend), every car
    // §Phase-3 stamina: an unfit driver fades late in the race (centered on the field mean → field-neutral);
    // sustained pushing tires faster. Fit drivers actually gain a touch in the closing laps.
    s += FATIGUE_K * (c.lap / Math.max(1, t.laps)) * (this.fitMean - A(c).fitness) * 2 * (pm.risk > 1 ? 1 + FATIGUE_PUSH : 1);
    if (c.player == null && this.difficulty < 1) {                            // difficulty handicap (AI only)
      s += (1 - this.difficulty) * AI_HANDICAP;                              // easier AI = a touch slower
      s += (c._aiForm || 0);                                                 // per-race form: off/on weekend (creates upsets)
      s += this.rng.noise((1 - this.difficulty) * AI_NOISE);                 // ...and less consistent lap-to-lap
    }
    if (c.lap === 0) s += c._launch || 0;       // standing-start launch (graded: good launch = faster opening lap)
    if (this.scActive) s *= EVENT.scPaceMult;        // everyone crawls behind the safety car
    else if (this.vscActive) s *= EVENT.vscPaceMult; // a milder, uniform delta under the virtual SC
    return s;
  }

  step(dt = STEP) {
    if (this.finished) return;
    if (!this._started) {
      this._started = true; this._standingStart();
      const pole = this.order()[0];
      this._emit({ type: "start", lap: 0, a: pole.idx, abbr: pole.abbrev });
    }
    this.time += dt;
    const leadProg = this.cars.reduce((m, c) => Math.max(m, c.lap + c.lapFrac), 0);
    this.wetness = wetnessAt(this.weather, leadProg);
    this.weatherInfo = liveForecast(this.weather, leadProg, this.track.laps);   // player-facing radar (anticipation)
    for (const c of this.cars) {
      if (c.retired) continue;
      if (c.pitTimer > 0) {                 // stationary in the pit box: race time passes, no track progress
        const d = Math.min(dt, c.pitTimer);
        c.pitTimer -= d;
        c.lapTimeAccum += d;                // the stop time lands on the out-lap (shows as a slow lap)
        c.totalTime += d;
        continue;
      }
      if (c.penaltyTimer > 0) {             // serving a time penalty on track: lose time, no progress
        const d = Math.min(dt, c.penaltyTimer);
        c.penaltyTimer -= d; c.lapTimeAccum += d; c.totalTime += d;
        continue;
      }
      const lt = this._lapTime(c);
      c.lapFrac += dt / lt;
      c.lapTimeAccum += dt;
      c.runTicks = (c.runTicks || 0) + 1;                                  // E4/P3: track running time + engine-mode usage
      if (ENGINE_MODES[c.engine] && ENGINE_MODES[c.engine].spend) c.pushTicks = (c.pushTicks || 0) + 1;  // push/overtake/superovertake spend the PU (feeds PU wear)
      else if (c.engine === "save") c.saveTicks = (c.saveTicks || 0) + 1;  //     → save spares it (lift & coast)
      if (c.lapFrac >= 1) {            // lap completed (phase 3 owns bookkeeping)
        const carry = (c.lapFrac - 1) * lt;   // time already spent past the line this tick (sub-step precision)
        c.lapFrac -= 1;
        c.lap += 1;
        c.lastLap = c.lapTimeAccum - carry;   // precise lap time (not quantized to STEP)
        this._recordMinis(c);
        if (c.lap > 1 && !this.scActive && c.lastLap < this._fastLap) {   // new overall fastest (ignore lap 1 / SC laps)
          this._fastLap = c.lastLap;
          this._emit({ type: "fastlap", lap: c.lap, a: c.idx, abbr: c.abbrev, t: c.lastLap });
        }
        c._lapSum += c.lastLap; c._lapN++; c.avgLap = c._lapSum / c._lapN;
        c.totalTime += c.lastLap;
        c.lapTimeAccum = carry;               // carry the post-line remainder into the next lap
        // per-lap wear + fuel burn
        const comp = COMPOUNDS[c.tyre], pm = PACE_MODES[c.pace];
        const drvTyre = 1 - ATTRW.wear * (A(c).tyre - 0.5) * 2;          // <1 = kinder driver
        const carTyre = 1.2 - ATTRW.carWear * (c.car.tyre ?? 1);         // car.tyre 1.0 = neutral (1.0)
        const drvSmooth = 1 - ATTRW.smoothWear * (A(c).smoothness - 0.5) * 2;   // smooth inputs save the tyres a touch (§18.7 r3)
        const orderWear = c._orderBit ? (c.order === "attack" ? ATTACK_WEAR_MULT : c.order === "defend" ? DEFEND_WEAR_MULT : 1) : 1;
        const hotWear = 1 + TYRE.hotWearK * Math.max(0, c.tyreTemp - 1);   // overheating chews the tyre (§item-2)
        c.wear += (comp.wear * pm.wear * drvTyre * carTyre * drvSmooth * orderWear * hotWear * (c._perk ? c._perk.wearMult : 1)) + c._dirtyWear;
        c._dirtyWear = 0;
        // two-sided temp: aggressive pace/engine drives the target above the optimal window (overheat); easing toward it cools when backed off.
        // Phase 4: the chassis "Tyre Heating" trait (car.tyreHeat, default 1) scales how hard the same effort overheats — a cool chassis tolerates aggression, a hot one forces style-flicking.
        const heatTarget = 1 + Math.max(0, pm.heat + ((ENGINE_MODES[c.engine] && ENGINE_MODES[c.engine].heat) || 0)) * (c.car.tyreHeat ?? 1);
        c.tyreTemp = warmStep(c.tyreTemp, c.tyre, heatTarget);
        this._serveOrderCost(c);   // temp scrub + held-lap counter + lap-keyed lock-up roll (clears _orderBit)
        const smooth = 1.1 - ATTRW.fuel * A(c).smoothness;              // smoother driver burns a touch less
        c.fuel -= burnFor(c.engine, c.car.fuel) * smooth * (c._perk ? c._perk.fuelMult : 1);
        c.tyreAge += 1;
        if (c._perk && --c._perk.lapsLeft <= 0) c._perk = null;          // §Phase-5: the perk's few-lap window expires
        if (c._conf < 1) c._conf = Math.min(1, c._conf + 0.04 * (0.5 + (c._adapt ?? 0.7)));   // §Phase-3: confidence recovers each lap, faster for an adaptable driver
        this._serveLapEnd(c); // phase 3: pit + DNF (finishers handled in order())
      }
    }
    if (!this.scActive && !this.vscActive) { this._resolveCombat(); this._resolveBlueFlags(dt); }   // no green-flag passing/lapping under any caution
    else for (const c of this.cars) { c._dirtyPace = 0; c._blueDelay = 0; }                          // neutral while a caution is out
    this._aiDrive();   // AI engine/pace management (post-combat: pos + pass-credit are fresh)
    // safety-car lifecycle, driven by the leader's lap count
    const leadLap = this.cars.reduce((m, c) => Math.max(m, c.lap), 0);   // incidents deploy the caution live (in _tryCaution); this just runs the retract/edge logic
    if (this.scActive && leadLap >= this.scStartLap + EVENT.scMinLaps) this.scActive = false;       // full SC retracts after scMinLaps
    if (this.vscActive && leadLap >= this.scStartLap + EVENT.vscMinLaps) this.vscActive = false;    // VSC clears faster
    if (this.scActive && !this._scWas) this._emit({ type: "sc_on", lap: leadLap });
    if (!this.scActive && this._scWas) this._emit({ type: "sc_off", lap: leadLap });
    if (this.vscActive && !this._vscWas) this._emit({ type: "vsc_on", lap: leadLap });
    if (!this.vscActive && this._vscWas) this._emit({ type: "vsc_off", lap: leadLap });
    this._scWas = this.scActive; this._vscWas = this.vscActive;
    this._resolveSC();   // bunching is full-SC only (it checks this.scActive)
    for (const c of this.cars) {
      if (c.retired && !this._retiredSeen.has(c.idx)) { this._retiredSeen.add(c.idx); this._emit({ type: "dnf", lap: c.lap, a: c.idx, abbr: c.abbrev, part: c._dnfPart || null }); }   // part = the failed critical part (§Phase-2) or null
    }
    if (this.cars.every(c => c.retired || c.lap >= this.track.laps)) {
      if (!this.finished) { const w = this.order()[0]; this._emit({ type: "finish", lap: w.lap, a: w.idx, abbr: w.abbrev }); }
      this.finished = true;
    }
  }

  requestPit(i, compound) { const c = this.cars[i]; if (c && COMPOUNDS[compound]) c.pitPending = compound; }

  // spread the start by skill: best skill -> P1, GRID_GAP seconds per slot
  gridStart() {
    const sorted = [...this.cars].sort((a, b) => b.skill - a.skill);
    sorted.forEach((c, slot) => { c.lap = 0; c.lapFrac = -slot * (GRID_GAP / this.track.lt); });
  }

  // standing start: launch off the line — a bounded shuffle from each driver's start skill
  // + reaction, measured against the field mean so only the SPREAD moves positions. The grid
  // (quali order) is otherwise respected; a rare bog-down gives the occasional big drop.
  _standingStart() {
    // §Phase-6 lobby: a rolling start keeps grid order — shrink the launch shuffle + bog-down odds (×rollK).
    // rollK = 1 for a standing start, so the erng draw order/count is untouched → byte-identical.
    const rollK = this.startType === "rolling" ? EVENT.rollingLaunchK : 1;
    let mean = 0; for (const c of this.cars) mean += A(c).starts; mean /= this.cars.length;
    for (const c of this.cars) {
      let launch = (mean - A(c).starts) * EVENT.startLaunch + this.erng.noise(EVENT.startReact);  // s lost (good starter < 0)
      launch = Math.max(-EVENT.startCap, Math.min(EVENT.startCap, launch)) * rollK;
      const composed = 1 - ATTRW.composure * (A(c).composure - 0.5) * 2;   // a composed driver bogs down less often (§18.7)
      if (this.erng.unit() < EVENT.startP * composed * rollK) {        // rare bog-down / anti-stall
        launch += EVENT.startLoss;
        if (this.erng.unit() < EVENT.startDnf) { c.retired = true; this._emit({ type: "incident", lap: 0, a: c.idx, abbr: c.abbrev, dnf: true }); this._tryCaution(this._keyRng(c.idx, 0, 3), true); }
      }
      c._launch = launch;   // graded launch delta, applied to the opening-lap time (good launch < 0 = faster lap 1 = gains)
      if (launch <= -EVENT.startCap * 0.6) this._emit({ type: "launch_good", lap: 0, a: c.idx, abbr: c.abbrev });
      else if (launch >= EVENT.startCap * 0.6) this._emit({ type: "launch_bad", lap: 0, a: c.idx, abbr: c.abbrev });
    }
  }

  // bunch same-lap running cars into a tight train behind the leader (writes only lapFrac)
  _resolveSC() {
    if (!this.scActive) return;
    const ord = this.order();
    for (let i = 1; i < ord.length; i++) {
      const ahead = ord[i - 1], me = ord[i];
      if (me.retired || ahead.retired || me.lap !== ahead.lap) continue;
      const minBehind = ahead.lapFrac - EVENT.scTrainGap / this.track.lt;
      if (me.lapFrac < minBehind) me.lapFrac = minBehind;   // catch up into the train (forward only)
    }
  }

  // combat: a follower within COMBAT_GAP of the car ahead is held up and builds
  // pass-credit from its pace edge; passes when credit beats track resistance.
  // Writes ONLY lapFrac (relative to the car's own lap). Never assigns lap.
  _resolveCombat() {
    const ord = this.order(); // sorted leaders-first; pos set
    for (const c of this.cars) { c._dirtyPace = 0; c._inFight = false; }   // fresh each green tick
    for (let i = 1; i < ord.length; i++) {
      const ahead = ord[i - 1], me = ord[i];
      if (me.retired || ahead.retired || me.pitTimer > 0 || ahead.pitTimer > 0) continue;  // a car in the pits isn't racing
      const gapSec = ((ahead.lap + ahead.lapFrac) - (me.lap + me.lapFrac)) * this.track.lt;
      const s = sampleAt(this.track, me.lapFrac).straightness;          // local track character at the follower
      // dirty air: sitting close (even outside passing range) costs the follower tyre life AND pace, worse in corners
      if (gapSec > 0 && gapSec < DIRTY_GAP) {
        me._dirtyWear += dirtyWear(s) * (1 - ATTRW.discipline * (A(me).discipline - 0.5) * 2);   // a disciplined driver runs cleaner in traffic (§18.7)
        me._dirtyPace = DIRTY_PACE_K * (1 - s) * (1 - gapSec / DIRTY_GAP);   // ramps with proximity — close hurts more, 0 at the edge of DIRTY_GAP (§18.11 round-2)
      }
      // close combat: hold-up + pass-credit, with slipstream and braking-zone concentration
      if (gapSec > 0 && gapSec < COMBAT_GAP && me.lap === ahead.lap) {
        me._inFight = true; ahead._inFight = true;                 // both are racing (incident-traffic + HUD)
        // MM team orders: between two of the player's OWN cars, the manager freezes the order (hold) or
        // waves the trailing car through (swap). Skips normal intra-team combat. Writes only lapFrac (invariant).
        if (this.teamOrder !== "none" && me.isPlayer && ahead.isPlayer && me.team === ahead.team) {
          if (this.teamOrder === "swap") {
            const slot = ahead.lapFrac + (COMBAT_GAP * 0.1) / this.track.lt;   // nip the trailing car just ahead
            if (slot < 1) {                                                    // guard the lap boundary (§16 invariant)
              me.lapFrac = slot; me._passCredit = 0; this.teamOrder = "none";  // one-shot reposition, then auto-clear
              this._emit({ type: "team_order", order: "swap", lap: me.lap, a: me.idx, abbr: me.abbrev, b: ahead.idx, abbrB: ahead.abbrev });
              continue;
            }
          }
          // hold (or a swap blocked by the lap line): pin the trailing teammate behind, bank no credit
          me._passCredit = 0; me._creditVs = ahead.idx;
          const tFrac = (ahead.lap + ahead.lapFrac) - (COMBAT_GAP * 0.5) / this.track.lt - me.lap;
          if (tFrac < me.lapFrac) me.lapFrac = Math.max(0, tFrac);
          continue;
        }
        if (me.order === "attack") me._orderBit = true;            // attacking this lap → pays the cost at lap end
        if (ahead.order === "defend") ahead._orderBit = true;      // defender pays too
        const edge = this._lapTime(ahead) - (this._lapTime(me) - (me._dirtyPace || 0));   // >0 => me faster on CLEAN pace; dirty air slows me on track but must not zero my passing intent (audit r3)
        const tow = slipstream(s, me.car.power);
        // recency bleed + accrual, then cap: the draft can't be banked over a whole straight and
        // cashed in one tick on zone entry (the verified credit-banking over-power, §18.13).
        if (me._creditVs !== ahead.idx) { me._passCredit = 0; me._creditVs = ahead.idx; }   // credit is earned vs a SPECIFIC rival — don't carry a bank onto a newly-ahead car (audit r3)
        const cautious = me.lap === 0 ? LAP1_CAUTION : 1;   // opening-lap caution: let the launch/grid order settle through T1 (§18.3)
        const aggr = 1 + ATTRW.aggression * (A(me).aggression - 0.5) * 2;   // a braver driver commits harder to the move (§18.7)
        const atk = me.order === "attack" ? ATTACK_CREDIT_K : 1;   // attack amplifies the accrual (race depth)
        const cr = (me._passCredit ?? 0) * PASS_CREDIT_DECAY
                 + passAccrual(edge, tow, me.engine, s) * (0.7 + ATTRW.overtaking * A(me).overtaking) * cautious * aggr * atk;
        me._passCredit = Math.min(cr, PASS_CREDIT_CAP);
        const zone = zoneFor(this.track.overtake_zones, sampleAt(this.track, me.lapFrac).mini);   // follower's local zone (or null)
        // bold out-of-zone lunge (§18.2): a much-faster, aggressive driver tries a move where you "can't pass".
        // Instantaneous (no credit banking), cooldown-gated (anti-spam), with a contact risk. Repurposes track.ot.
        if (!zone && me.lap >= 1 && edge > AGGR_PASS_EDGE && A(me).aggression >= AGGR_PASS_ATTR
            && me._aggrTried !== ahead.idx) {
          me._aggrTried = ahead.idx;   // one bold attempt per rival-ahead (anti-spam: not a recurring time cooldown)
          const p = this.track.ot * AGGR_PASS_K * (0.5 + A(me).aggression) * Math.min(1, (edge - AGGR_PASS_EDGE) / AGGR_PASS_REF);
          if (this.erng.unit() < p) {
            const slot = ahead.lapFrac + (COMBAT_GAP * 0.1) / this.track.lt;   // nip just ahead of the car
            if (slot < 1) {   // guard the lap boundary — combat never writes lap (§16 invariant)
              me.lapFrac = slot; me._passCredit = 0;
              me.tyreTemp = Math.max(0.1, me.tyreTemp - AGGR_PASS_SCRUB);   // scrubbed/flat-spotted tyres — the lunge isn't free (§18.2 round-2)
              if (me._passedIdx !== ahead.idx && (me._passCd ?? -1) <= this.time) {
                this._emit({ type: "pass", lap: me.lap, a: me.idx, abbr: me.abbrev, b: ahead.idx, abbrB: ahead.abbrev, zone: "bold", rivalry: (me.rival === ahead.abbrev || ahead.rival === me.abbrev) });
                me._passedIdx = ahead.idx; me._passCd = this.time + 4;
                // stewards: a messy bold lunge can draw a 5s time penalty for contact (served on track)
                if (this._keyRng(me.idx, me.lap, 11).unit() < 0.14) {
                  me.penaltyTimer = (me.penaltyTimer || 0) + 5;
                  this._emit({ type: "penalty", lap: me.lap, a: me.idx, abbr: me.abbrev, sec: 5 });
                }
              }
              continue;   // move done this tick — skip the pin
            }
          } else if (this.erng.unit() < AGGR_PASS_DNF) {
            me.retired = true;             // the lunge went wrong — into the gravel
            this._emit({ type: "incident", lap: me.lap, a: me.idx, abbr: me.abbrev, dnf: true });
            this._tryCaution(this._keyRng(me.idx, me.lap, 3), true);
            continue;
          }
        }
        const ease = zone ? zone.ease : 0;   // ease is only read in the in-zone resist below; 0 is a dead-safe fallback
        // outside any zone a pass cannot complete (resist = Infinity): stay pinned, credit keeps building
        const def = ahead.order === "defend" ? DEFEND_ORDER_K : 1;   // defend amplifies the resist (race depth)
        const resist = zone ? (1 - ease) * 2.0 * (0.7 + ATTRW.defending * A(ahead).defending) * def : Infinity;
        // defence roll: at the threshold a strong defender can repel the move THIS tick — credit is KEPT,
        // so a genuinely faster car still gets by within a few ticks (bounded; makes defending/overtaking matter, §18.7).
        const repelled = me._passCredit >= resist && me.lap >= 1
          && this.erng.unit() < Math.min(DEFEND_MAX, Math.max(0, 0.5 + DEFEND_ROLL * (A(ahead).defending - A(me).overtaking)));
        if (me._passCredit < resist || repelled) {
          // pinned behind the car ahead (writes ONLY lapFrac — invariant)
          const target = (ahead.lap + ahead.lapFrac) - (COMBAT_GAP * 0.5) / this.track.lt;
          const desiredFrac = target - me.lap;
          if (desiredFrac < me.lapFrac) me.lapFrac = Math.max(0, desiredFrac);
        } else {
          me._passCredit = 0; // pass completes naturally next ticks (no lap write)
          // announce once per pass episode: a fresh opponent (not the one we just cleared)
          // and not within the per-car cooldown — bounds the log to genuine on-track passes.
          if (me.lap >= 1 && me._passedIdx !== ahead.idx && (me._passCd ?? -1) <= this.time) {  // skip the lap-0 grid settle
            this._emit({ type: "pass", lap: me.lap, a: me.idx, abbr: me.abbrev, b: ahead.idx, abbrB: ahead.abbrev, zone: zone ? zone.type : null, rivalry: (me.rival === ahead.abbrev || ahead.rival === me.abbrev) });
            me._passedIdx = ahead.idx;
            me._passCd = this.time + 4;
          }
        }
      } else {
        me._passCredit = 0;
      }
    }
  }

  // blue flags: a car catching a backmarker (a car a lap+ down, just AHEAD on track) loses a small,
  // FIXED amount of time threading past it. The backmarker yields, so this is a one-shot cost on the
  // LAPPING car (BLUE_COST per backmarker, spent down through _blueDelay so the closing-rate can't make it
  // run away) — not a pin. Writes only scratch scalars (read by _lapTime) — never lap/lapFrac/wear (invariant).
  _resolveBlueFlags(dt = STEP) {
    let lo = Infinity, hi = -Infinity;
    for (const c of this.cars) { if (c.retired) continue; if (c.lap < lo) lo = c.lap; if (c.lap > hi) hi = c.lap; }
    const lapped = hi - lo >= 1;   // someone is a full lap down → lapped traffic exists
    for (const me of this.cars) {
      me._blueDelay = 0;
      if (!lapped || me.retired || me.pitTimer > 0) { me._blueLast = -1; me._blueBudget = 0; continue; }
      // anti-flicker: while still tangled with the last backmarker (within 3×gap, the penalty itself can push
      // it just out of the gap and back), keep _blueLast and DON'T re-charge — one charge per lapping episode.
      let stillLast = false;
      if (me._blueLast >= 0) {
        const last = this.cars[me._blueLast];
        if (last && !last.retired && last.lap < me.lap) {
          const d = (((last.lapFrac - me.lapFrac) % 1) + 1) % 1;
          if (Math.min(d, 1 - d) * this.track.lt < BLUE_GAP * 3) stillLast = true;
        }
      }
      if (!stillLast) {
        let bmIdx = -1;
        for (const bm of this.cars) {
          if (bm === me || bm.retired || bm.pitTimer > 0 || bm.lap >= me.lap) continue;   // only cars a lap+ DOWN are backmarkers to me
          const ahead = (((bm.lapFrac - me.lapFrac) % 1) + 1) % 1;   // forward track distance me→bm, in laps (0..1), wrapped
          if (ahead * this.track.lt < BLUE_GAP) { bmIdx = bm.idx; break; }   // a backmarker is right ahead on track
        }
        if (bmIdx >= 0) { me._blueBudget = (me._blueBudget || 0) + BLUE_COST; me._blueLast = bmIdx; }  // a fresh backmarker → one-shot charge
        else me._blueLast = -1;   // clear of all backmarkers → a future re-lap can charge again
      }
      if ((me._blueBudget || 0) > 0) {     // spend the budget down at BLUE_PACE (read by _lapTime as a pace loss)
        me._blueDelay = BLUE_PACE;
        me._blueBudget = Math.max(0, me._blueBudget - BLUE_PACE * dt / this.track.lt);   // drain over the tick's real dt, not a hardcoded STEP (audit r3)
      }
    }
  }

  // AI drivers pick an engine/pace mode each tick from their race situation (writes only engine/pace)
  _aiDrive() {
    const ord = this.order();   // leaders-first; sets pos
    for (let i = 0; i < ord.length; i++) {
      const c = ord[i];
      if (c.player != null || c.retired || c._pin) continue;   // human or explicitly-pinned mode wins over the AI brain
      const ahead = ord[i - 1], behind = ord[i + 1];
      const prog = x => x.lap + x.lapFrac;
      const gapAhead = (ahead && !ahead.retired) ? (prog(ahead) - prog(c)) * this.track.lt : null;
      const gapBehind = (behind && !behind.retired) ? (prog(c) - prog(behind)) * this.track.lt : null;
      const dirtyAir = gapAhead != null && gapAhead < DIRTY_GAP && ahead.lap === c.lap;
      const canPass = (c._passCredit || 0) > 0;
      const lapsLeft = this.track.laps - c.lap;
      const fl = fuelLaps(c.fuel, c.engine, c.car.fuel);
      const edgeAhead = (ahead && !ahead.retired) ? (this._lapTime(ahead) - this._lapTime(c)) : 0;   // >0 = c faster than the car ahead
      const behindFaster = (behind && !behind.retired) ? (this._lapTime(c) - this._lapTime(behind)) > 0.1 : false;
      const ctx = { pos: c.pos, gapAhead, gapBehind, dirtyAir, canPass, lapsLeft, fuelLaps: fl, difficulty: this.difficulty, edgeAhead, behindFaster };
      c.engine = engineMode(c, ctx);
      c.pace = paceMode(c, ctx);
      c.order = combatOrder(c, ctx);
    }
  }

  // finalise a completed lap's mini-sector splits, colours, and sector totals
  _recordMinis(c) {
    const sp = miniSplits(this.track, c.lastLap, c.car);
    c.lastMini = sp;
    const colors = new Array(N_MINI), sectors = [0, 0, 0];
    for (let i = 0; i < N_MINI; i++) {
      const t = sp[i];
      colors[i] = t < this.sessionBestMini[i] ? "p" : (t <= c.bestMini[i] ? "g" : "y");
      if (t < this.sessionBestMini[i]) this.sessionBestMini[i] = t;
      if (t < c.bestMini[i]) c.bestMini[i] = t;
      sectors[this.track.mini[i].sector] += t;
    }
    c.miniColors = colors;
    c.sectorTimes = sectors;
  }

  _serveLapEnd(c) {
    // called at lap completion in step(); handles pit + DNF
    // AI cars (no human engineer) auto-pit once near the tyre cliff if enough race remains
    // AI weather reaction: get onto the right tyre for the conditions (not blocked by stop count)
    // AI strategy: planned stops, SC opportunism, weather changes, emergency cliff (ai_strategy.js)
    if (c.player == null && !c.pitPending && c.tyreAge > 1) {
      const ord = this.order();                          // car immediately behind, for undercut cover
      const behind = ord[c.pos];                         // pos is 1-based → ord[c.pos] is one place back
      const prog = x => x.lap + x.lapFrac;
      const gapBehind = (behind && !behind.retired && behind.lap === c.lap) ? (prog(c) - prog(behind)) * this.track.lt : null;
      const threatBehind = gapBehind != null && gapBehind < 2.5 && (behind.tyreAge || 0) >= 6 && !behind.pitPending;
      const want = pitDecision(c, { wetness: this.wetness, scActive: this.scActive || this.vscActive, laps: this.track.laps, threatBehind, difficulty: this.difficulty });
      if (want) {
        c.pitPending = want.compound;
        if (want.reason !== "weather") c.aiStopsDone = (c.aiStopsDone || 0) + 1;  // consume a dry plan stop
      }
    }
    if (c.pitPending) {
      c.tyre = c.pitPending; c.pitPending = null; c.wear = 0; c.tyreAge = 0; c.tyreTemp = TYRE.pitTemp;
      const cautionPit = this.scActive ? EVENT.scPitMult : (this.vscActive ? EVENT.vscPitMult : 1);   // full SC cheapest, VSC mid, green full
      let pitLoss = this.track.pit * cautionPit * (c.personnel ? c.personnel.pitMult : 1);
      let pitMishap = null;
      if (c.pitCrew) {   // PIT: the managed crew can botch the stop — a slow stop or a rare disaster
        const pr = this._keyRng(c.idx, c.lap, 7).unit();
        if (pr < c.pitCrew.disasterChance) { pitLoss += 8 + 6 * this._keyRng(c.idx, c.lap, 8).unit(); pitMishap = "disaster"; }
        else if (pr < c.pitCrew.botchChance) { pitLoss += 1.5 + 2.5 * this._keyRng(c.idx, c.lap, 9).unit(); pitMishap = "slow"; }
      }
      // §Phase-2: a pit repairs worn/failed parts — fixes a brake limp and tops up any part in the red
      // zone, folding the repair time into the stationary stop. Clears the limp so the out-lap is clean.
      if (c.parts) {
        let repaired = 0;
        for (const k of PART_KEYS) {
          if (c._partFail === k || c.parts[k] < PART_WEAR.red) {
            c.parts[k] = Math.min(1, c.parts[k] + PART_WEAR.repair);
            repaired = Math.max(repaired, PART_WEAR.repairTime[k] || 0);
          }
        }
        if (repaired) pitLoss += repaired;
        c._brakeLimp = 0; c._partFail = null;
      }
      // §Phase-3: #1 double-stack priority. If this car is NOT the team's #1 but its lead teammate is
      // still being serviced in the box right now, the crew finishes the lead first → this car waits.
      // Pure lead↔non-lead asymmetry, so equal/equal teams (AI, harness, fresh saves) are byte-identical.
      if (c.driverStatus !== "lead") {
        for (const tm of this.cars) {
          if (tm !== c && tm.team === c.team && tm.driverStatus === "lead" && tm.pitTimer > 0) {
            pitLoss += Math.min(tm.pitTimer, EVENT.pitStackWait); break;
          }
        }
      }
      c.pitStops += 1;
      c.pitTimer = pitLoss;   // sit stationary in the box for pitLoss s — drained in step() (race time passes, rivals gain, the out-lap shows it). Replaces the old lapFrac subtraction that got clamped to ~0.
      this._emit({ type: "pit", lap: c.lap, a: c.idx, abbr: c.abbrev, compound: c.tyre, mishap: pitMishap });
    }
    if (c.fuel <= 0) { c.retired = true; return; }   // ran the tank dry
    this._wearParts(c);   // §Phase-2: part condition wears + red-zone failures (replaces the flat mechanical DNF roll)
    if (c.retired) return;
    this._rollIncident(c);
  }

  // §Phase-2: wear each part by this lap's stress, then roll failures for parts in the red zone. A failed
  // critical part (engine/gearbox) retires the car; a failed non-critical part (brakes) costs pace and
  // forces a pit. Reliability (car.rel) slows the wear. Uses lap-keyed RNG (per-part stream) so it doesn't
  // perturb the erng caution stream. Jittery drivers (consistency<field) fail a touch more (§18.7 r3 preserved).
  _wearParts(c) {
    const pm = PACE_MODES[c.pace], em = ENGINE_MODES[c.engine];
    const consist = 1 + DNF_CONSIST * (this.consMean - A(c).consistency) * 2;
    const paceStress = 1 + PART_WEAR.riskK * (pm.risk - 1);
    const stress = { engine: 1 + PART_WEAR.engK * ((em && em.heat) || 0), gearbox: paceStress, brakes: paceStress };
    let mult = 1, worstCrit = null, worstCond = 2;
    for (const k of PART_KEYS) {
      c.parts[k] = Math.max(0, c.parts[k] - partWear(k, stress[k], c.car.rel));
      const z = partZone(c.parts[k]);
      if (z !== "green") mult += (z === "red" ? PART_WEAR.redRisk : PART_WEAR.yellowRisk);   // degraded parts amplify the failure chance
      if (PARTS[k].critical) { if (c.parts[k] < worstCond) { worstCond = c.parts[k]; worstCrit = k; } }
      else if (c.parts[k] < PART_WEAR.red && !c._partFail                                     // non-critical (brakes) in the red zone can fail → limp + forced pit (once)
        && this._keyRng(c.idx, c.lap, 22).unit() < failChance(c.parts[k]) * consist) {
        c._partFail = k; c._brakeLimp = PART_WEAR.brakeLimp;
        if (c.player == null && !c.pitPending) c.pitPending = c.tyre;                          // the AI limps straight to the box
        this._emit({ type: "part", lap: c.lap, a: c.idx, abbr: c.abbrev, part: k });
      }
    }
    // critical mechanical DNF: the calibrated flat rate (erng-stream-preserving — one draw, as before),
    // AMPLIFIED by part degradation so a red engine/gearbox is the warned, likely cause of a retirement.
    // A mechanical failure retires the car SILENTLY (no caution — matches the old flat roll, keeps the SC
    // corridor); the cause part rides the single dnf announcement (line ~212) for the lenta.
    if (this.erng.unit() < DNF_BASE * (1 - c.car.rel) * pm.risk * consist * mult) {
      c.retired = true; c._dnfPart = worstCrit;
    }
  }

  // on-track incident roll for a car at a completed lap (lap-keyed, deterministic). An incident loses
  // the move, sometimes retires the car, and may draw a caution. Reuses the existing SC lifecycle.
  _rollIncident(c) {
    if (c.retired) return;
    const pm = PACE_MODES[c.pace];
    let p = incidentChance(INCIDENT.base, pm.risk, A(c).composure, c._inFight, c.lap, INCIDENT);
    p *= 1 + INCIDENT.wetK * (this.wetness || 0);                          // §Phase-3: a wet track breeds mistakes
    const cliff = COMPOUNDS[c.tyre] ? COMPOUNDS[c.tyre].cliff : Infinity;
    if (c.wear > cliff) p *= 1 + INCIDENT.cliffK;                          // §Phase-3: worn past the cliff → twitchy
    const ir = this._keyRng(c.idx, c.lap, 2);
    if (ir.unit() >= p) return;
    let wasDNF = false;
    if (ir.unit() < INCIDENT.dnfShare) { c.retired = true; wasDNF = true; }
    else { c.tyreTemp = Math.max(0.1, c.tyreTemp - INCIDENT.timeScrub); c._passCredit = 0; }   // a recovered moment still costs (felt as pace)
    this._emit({ type: "incident", lap: c.lap, a: c.idx, abbr: c.abbrev, dnf: wasDNF });
    this._tryCaution(ir, wasDNF);
  }

  // an incident may deploy a caution: one at a time, capped, kind by track.sc + vscShare. Reuses
  // scActive/vscActive (the existing lifecycle bunches, cheapens pits and retracts after scMinLaps).
  _tryCaution(rng, wasDNF) {
    if (this.scActive || this.vscActive || this._cautionsDone >= INCIDENT.maxCautions) return;
    if (this.cautionMult <= 0) return;   // §Phase-6 lobby: "no safety cars" regime
    const kind = cautionFromIncident(rng, this.track.sc * this.cautionMult, wasDNF, EVENT.vscShare, INCIDENT);
    if (!kind) return;
    this._cautionsDone += 1;
    this.scEverActive = true;
    this.scStartLap = this.cars.reduce((m, x) => Math.max(m, x.lap), 0);
    if (kind === "vsc") this.vscActive = true; else this.scActive = true;
  }

  // order upkeep at a completed lap: while an order bit this lap, scrub temp + count held laps + roll a
  // lock-up (lap-keyed). A lock-up scrubs a chunk of tyre temp (organic pace loss as it re-warms) and
  // wipes pass-credit (the move is lost). NEVER a DNF — explicit contact risk stays on the bold lunge.
  _serveOrderCost(c) {
    if (!c._orderBit) { c._orderLaps = 0; return; }
    c._orderLaps += 1;
    const scrub = c.order === "attack" ? ATTACK_SCRUB : DEFEND_SCRUB;
    c.tyreTemp = Math.max(0.1, c.tyreTemp - scrub);
    if (c.lap >= 1) {
      const mr = this._keyRng(c.idx, c.lap, 1);
      const focus = c.order === "attack" ? (1 - A(c).composure) : (1 - A(c).discipline);   // composed/disciplined err less
      const wearTemp = 1 + c.wear / 100 + (1 - c.tyreTemp);                                 // worn/cold tyres → riskier
      const p = ORDER_MISTAKE_BASE * (1 + ORDER_MISTAKE_RAMP * Math.min(c._orderLaps, ORDER_MISTAKE_RAMP_CAP)) * wearTemp * (0.5 + focus);
      if (mr.unit() < p) {
        c.tyreTemp = Math.max(0.1, c.tyreTemp - mr.range(ORDER_MISTAKE_SCRUB_MIN, ORDER_MISTAKE_SCRUB_MAX));
        c._passCredit = 0;
        this._emit({ type: "lockup", lap: c.lap, a: c.idx, abbr: c.abbrev });
      }
    }
    c._orderBit = false;
  }

  // race position: more laps first, then further along current lap
  order() {
    return [...this.cars].sort((a, b) => {
      const al = a.lap + a.lapFrac, bl = b.lap + b.lapFrac;
      if (a.retired !== b.retired) return a.retired ? 1 : -1;
      return bl - al;
    }).map((c, i) => { c.pos = i + 1; return c; });
  }
}
