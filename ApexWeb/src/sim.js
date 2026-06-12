// ApexWeb/src/sim.js
import { RNG, mix32 } from "./rng.js";
import { COMPOUNDS, PACE_MODES, SKILL_K, CAR_K, CAR_PACE_K, STEP, DNF_BASE, GRID_GAP, COMBAT_GAP, TYRE, DIRTY_GAP, EVENT, ATTRW, AI_HANDICAP, AI_NOISE, AI_FORM, RACE_FORM } from "./data.js";
import { startFuel, burnFor, weightTerm, engineTerm, fuelLaps } from "./fuel.js";
import { tyreTerm, warmStep } from "./tyres.js";
import { miniSplits, MINI, N_MINI, sampleAt } from "./track.js";
import { slipstream, dirtyWear, passAccrual, zoneFor } from "./overtake.js";
import { PASS_CREDIT_CAP, PASS_CREDIT_DECAY } from "./data.js";
import { scheduleSC } from "./events.js";
import { scheduleWeather, wetnessAt, weatherTerm } from "./weather.js";
import { planRace, pitDecision, engineMode, paceMode } from "./ai_strategy.js";
import { ATTR_KEYS } from "./team.js";

const ENGINE_KEYS = new Set(["save", "standard", "push"]);
const NEUTRAL_ATTRS = Object.fromEntries(ATTR_KEYS.map(k => [k, 0.5]));
const A = c => c.attrs || NEUTRAL_ATTRS;   // attribute accessor with a neutral fallback

export class Race {
  constructor(field, track, seed, difficulty = 0.85) {
    this.track = track;
    this.rng = new RNG(seed);
    this.erng = new RNG(mix32(seed));
    this.time = 0;
    this.finished = false;
    this.sessionBestMini = new Array(N_MINI).fill(Infinity);
    this.scLap = scheduleSC(this.erng, track.sc, track.laps);  // leader-lap it deploys on, or null
    this.scActive = false; this.scEverActive = false; this.scStartLap = 0; this._started = false;
    this.weather = scheduleWeather(this.erng, track.wet, track.laps);
    this.wetness = 0;
    this.cars = field.map((f, i) => ({
      idx: i, name: f.name, abbrev: f.abbrev, skill: f.skill, car: f.car,
      attrs: f.attrs ?? null, personnel: f.personnel ?? null,
      color: f.color, team: f.team, isPlayer: !!f.isPlayer, player: f.player ?? null,
      setup: f.setup ?? [0.5, 0.5, 0.5], setupBonus: f.setupBonus ?? 0,
      lap: 0, lapFrac: 0, lapTimeAccum: 0, lastLap: 0, totalTime: 0,
      avgLap: 0, _lapSum: 0, _lapN: 0,
      tyre: f.startTyre ?? "medium", wear: 0, tyreAge: 0, tyreTemp: TYRE.gridTemp,
      fuel: startFuel(track), engine: "standard",
      pace: "balanced",
      retired: false, pitPending: null, pos: i + 1, startPos: i + 1,
      pitStops: 0, pitTimer: 0,
      lastMini: [], bestMini: new Array(N_MINI).fill(Infinity), miniColors: [], sectorTimes: [0, 0, 0],
      _dirtyWear: 0, _launch: 0,
    }));
    // field-mean car performance ((power+aero)/2), fixed for the race — the anchor the
    // absolute car-pace term is measured against, so a better-than-average car is faster (§18.1).
    this.carMean = this.cars.reduce((s, c) => s + (c.car.power + c.car.aero) / 2, 0) / this.cars.length;
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
  }

  _emit(ev) { this.events.push(ev); }   // append a structured event (read-only w.r.t. the sim)

  setPace(i, mode) { if (PACE_MODES[mode]) { this.cars[i].pace = mode; this.cars[i]._pin = true; } }
  setEngine(i, mode) { if (ENGINE_KEYS.has(mode)) { this.cars[i].engine = mode; this.cars[i]._pin = true; } }

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
    s += this.rng.noise(0.06) * (1.3 - ATTRW.noise * A(c).consistency);      // consistency steadies the lap
    s += c._form || 0;                                                        // per-race form (off/on weekend), every car
    if (c.player == null && this.difficulty < 1) {                            // difficulty handicap (AI only)
      s += (1 - this.difficulty) * AI_HANDICAP;                              // easier AI = a touch slower
      s += (c._aiForm || 0);                                                 // per-race form: off/on weekend (creates upsets)
      s += this.rng.noise((1 - this.difficulty) * AI_NOISE);                 // ...and less consistent lap-to-lap
    }
    if (c.lap === 0) s += c._launch || 0;       // standing-start launch (graded: good launch = faster opening lap)
    if (this.scActive) s *= EVENT.scPaceMult;   // everyone crawls behind the safety car
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
    for (const c of this.cars) {
      if (c.retired) continue;
      if (c.pitTimer > 0) {                 // stationary in the pit box: race time passes, no track progress
        const d = Math.min(dt, c.pitTimer);
        c.pitTimer -= d;
        c.lapTimeAccum += d;                // the stop time lands on the out-lap (shows as a slow lap)
        c.totalTime += d;
        continue;
      }
      const lt = this._lapTime(c);
      c.lapFrac += dt / lt;
      c.lapTimeAccum += dt;
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
        c.wear += (comp.wear * pm.wear * drvTyre * carTyre) + c._dirtyWear;
        c._dirtyWear = 0;
        c.tyreTemp = warmStep(c.tyreTemp, c.tyre);
        const smooth = 1.1 - ATTRW.fuel * A(c).smoothness;              // smoother driver burns a touch less
        c.fuel -= burnFor(c.engine, c.car.fuel) * smooth;
        c.tyreAge += 1;
        this._serveLapEnd(c); // phase 3: pit + DNF (finishers handled in order())
      }
    }
    if (!this.scActive) this._resolveCombat();   // no green-flag passing under the safety car
    this._aiDrive();   // AI engine/pace management (post-combat: pos + pass-credit are fresh)
    // safety-car lifecycle, driven by the leader's lap count
    const leadLap = this.cars.reduce((m, c) => Math.max(m, c.lap), 0);
    if (this.scLap != null && !this.scActive && !this.scEverActive && leadLap >= this.scLap) {
      this.scActive = true; this.scEverActive = true; this.scStartLap = leadLap;
    }
    if (this.scActive && leadLap >= this.scStartLap + EVENT.scMinLaps) this.scActive = false;
    if (this.scActive && !this._scWas) this._emit({ type: "sc_on", lap: leadLap });
    if (!this.scActive && this._scWas) this._emit({ type: "sc_off", lap: leadLap });
    this._scWas = this.scActive;
    this._resolveSC();
    for (const c of this.cars) {
      if (c.retired && !this._retiredSeen.has(c.idx)) { this._retiredSeen.add(c.idx); this._emit({ type: "dnf", lap: c.lap, a: c.idx, abbr: c.abbrev }); }
    }
    if (this.cars.every(c => c.retired || c.lap >= this.track.laps)) {
      if (!this.finished) { const w = this.order()[0]; this._emit({ type: "finish", lap: w.lap, a: w.idx, abbr: w.abbrev }); }
      this.finished = true;
    }
  }

  requestPit(i, compound) { this.cars[i].pitPending = compound; }

  // spread the start by skill: best skill -> P1, GRID_GAP seconds per slot
  gridStart() {
    const sorted = [...this.cars].sort((a, b) => b.skill - a.skill);
    sorted.forEach((c, slot) => { c.lap = 0; c.lapFrac = -slot * (GRID_GAP / this.track.lt); });
  }

  // standing start: launch off the line — a bounded shuffle from each driver's start skill
  // + reaction, measured against the field mean so only the SPREAD moves positions. The grid
  // (quali order) is otherwise respected; a rare bog-down gives the occasional big drop.
  _standingStart() {
    let mean = 0; for (const c of this.cars) mean += A(c).starts; mean /= this.cars.length;
    for (const c of this.cars) {
      let launch = (mean - A(c).starts) * EVENT.startLaunch + this.erng.noise(EVENT.startReact);  // s lost (good starter < 0)
      launch = Math.max(-EVENT.startCap, Math.min(EVENT.startCap, launch));
      if (this.erng.unit() < EVENT.startP) {                   // rare bog-down / anti-stall
        launch += EVENT.startLoss;
        if (this.erng.unit() < EVENT.startDnf) c.retired = true;
      }
      c._launch = launch;   // graded launch delta, applied to the opening-lap time (good launch < 0 = faster lap 1 = gains)
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
    for (let i = 1; i < ord.length; i++) {
      const ahead = ord[i - 1], me = ord[i];
      if (me.retired || ahead.retired || me.pitTimer > 0 || ahead.pitTimer > 0) continue;  // a car in the pits isn't racing
      const gapSec = ((ahead.lap + ahead.lapFrac) - (me.lap + me.lapFrac)) * this.track.lt;
      const s = sampleAt(me.lapFrac).straightness;          // local track character at the follower
      // dirty air: sitting close (even outside passing range) costs the follower tyre life, worse in corners
      if (gapSec > 0 && gapSec < DIRTY_GAP) me._dirtyWear += dirtyWear(s);
      // close combat: hold-up + pass-credit, with slipstream and braking-zone concentration
      if (gapSec > 0 && gapSec < COMBAT_GAP && me.lap === ahead.lap) {
        const edge = this._lapTime(ahead) - this._lapTime(me);   // >0 => me faster
        const tow = slipstream(s, me.car.power);
        // recency bleed + accrual, then cap: the draft can't be banked over a whole straight and
        // cashed in one tick on zone entry (the verified credit-banking over-power, §18.13).
        const cr = (me._passCredit ?? 0) * PASS_CREDIT_DECAY
                 + passAccrual(edge, tow, me.engine, s) * (0.7 + ATTRW.overtaking * A(me).overtaking);
        me._passCredit = Math.min(cr, PASS_CREDIT_CAP);
        const zone = zoneFor(this.track.overtake_zones, sampleAt(me.lapFrac).mini);   // follower's local zone (or null)
        const ease = zone ? zone.ease : this.track.ot;
        // outside any zone a pass cannot complete (resist = Infinity): stay pinned, credit keeps building
        const resist = zone ? (1 - ease) * 2.0 * (0.7 + ATTRW.defending * A(ahead).defending) : Infinity;
        if (me._passCredit < resist) {
          // pinned behind the car ahead (writes ONLY lapFrac — invariant)
          const target = (ahead.lap + ahead.lapFrac) - (COMBAT_GAP * 0.5) / this.track.lt;
          const desiredFrac = target - me.lap;
          if (desiredFrac < me.lapFrac) me.lapFrac = Math.max(0, desiredFrac);
        } else {
          me._passCredit = 0; // pass completes naturally next ticks (no lap write)
          // announce once per pass episode: a fresh opponent (not the one we just cleared)
          // and not within the per-car cooldown — bounds the log to genuine on-track passes.
          if (me.lap >= 1 && me._passedIdx !== ahead.idx && (me._passCd ?? -1) <= this.time) {  // skip the lap-0 grid settle
            this._emit({ type: "pass", lap: me.lap, a: me.idx, abbr: me.abbrev, b: ahead.idx, abbrB: ahead.abbrev, zone: zone ? zone.type : null });
            me._passedIdx = ahead.idx;
            me._passCd = this.time + 4;
          }
        }
      } else {
        me._passCredit = 0;
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
      const ctx = { pos: c.pos, gapAhead, gapBehind, dirtyAir, canPass, lapsLeft, fuelLaps: fl, difficulty: this.difficulty };
      c.engine = engineMode(c, ctx);
      c.pace = paceMode(c, ctx);
    }
  }

  // finalise a completed lap's mini-sector splits, colours, and sector totals
  _recordMinis(c) {
    const sp = miniSplits(c.lastLap, c.car);
    c.lastMini = sp;
    const colors = new Array(N_MINI), sectors = [0, 0, 0];
    for (let i = 0; i < N_MINI; i++) {
      const t = sp[i];
      colors[i] = t < this.sessionBestMini[i] ? "p" : (t <= c.bestMini[i] ? "g" : "y");
      if (t < this.sessionBestMini[i]) this.sessionBestMini[i] = t;
      if (t < c.bestMini[i]) c.bestMini[i] = t;
      sectors[MINI[i].sector] += t;
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
      const want = pitDecision(c, { wetness: this.wetness, scActive: this.scActive, laps: this.track.laps });
      if (want) {
        c.pitPending = want.compound;
        if (want.reason !== "weather") c.aiStopsDone = (c.aiStopsDone || 0) + 1;  // consume a dry plan stop
      }
    }
    if (c.pitPending) {
      c.tyre = c.pitPending; c.pitPending = null; c.wear = 0; c.tyreAge = 0; c.tyreTemp = TYRE.pitTemp;
      const pitLoss = this.track.pit * (this.scActive ? EVENT.scPitMult : 1) * (c.personnel ? c.personnel.pitMult : 1);
      c.pitStops += 1;
      c.pitTimer = pitLoss;   // sit stationary in the box for pitLoss s — drained in step() (race time passes, rivals gain, the out-lap shows it). Replaces the old lapFrac subtraction that got clamped to ~0.
      this._emit({ type: "pit", lap: c.lap, a: c.idx, abbr: c.abbrev, compound: c.tyre });
    }
    if (c.fuel <= 0) { c.retired = true; return; }   // ran the tank dry
    const pm = PACE_MODES[c.pace];
    if (this.erng.unit() < DNF_BASE * (1 - c.car.rel) * pm.risk) c.retired = true;
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
