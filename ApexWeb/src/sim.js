// ApexWeb/src/sim.js
import { RNG, mix32 } from "./rng.js";
import { COMPOUNDS, PACE_MODES, SKILL_K, CAR_K, CAR_PACE_K, STEP, DNF_BASE, GRID_GAP, COMBAT_GAP, TYRE, DIRTY_GAP, EVENT, ATTRW, AI_HANDICAP, AI_NOISE, AI_FORM, RACE_FORM, DEFEND_ROLL, DEFEND_MAX, DNF_CONSIST } from "./data.js";
import { startFuel, burnFor, weightTerm, engineTerm, fuelLaps } from "./fuel.js";
import { tyreTerm, warmStep } from "./tyres.js";
import { miniSplits, MINI, N_MINI, sampleAt } from "./track.js";
import { slipstream, dirtyWear, passAccrual, zoneFor } from "./overtake.js";
import { PASS_CREDIT_CAP, PASS_CREDIT_DECAY, DIRTY_PACE_K, LAP1_CAUTION,
  AGGR_PASS_EDGE, AGGR_PASS_ATTR, AGGR_PASS_REF, AGGR_PASS_K, AGGR_PASS_DNF, AGGR_PASS_SCRUB,
  BLUE_GAP, BLUE_PACE, BLUE_COST } from "./data.js";
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
    const caution = scheduleSC(this.erng, track.sc, track.laps, EVENT.vscShare);  // { lap, vsc } or null
    this.scLap = caution ? caution.lap : null; this.scIsVsc = caution ? caution.vsc : false;  // VSC = uniform delta, no bunching
    this.scActive = false; this.vscActive = false; this.scEverActive = false; this.scStartLap = 0; this._started = false;
    this._vscWas = false;
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
      _dirtyWear: 0, _dirtyPace: 0, _blueDelay: 0, _blueBudget: 0, _blueLast: -1, _creditVs: -1, _launch: 0,
    }));
    // field-mean car performance ((power+aero)/2), fixed for the race — the anchor the
    // absolute car-pace term is measured against, so a better-than-average car is faster (§18.1).
    this.carMean = this.cars.reduce((s, c) => s + (c.car.power + c.car.aero) / 2, 0) / this.cars.length;
    // field-mean consistency — the DNF modulation is centered on THIS (not 0.5) so it shifts incidents
    // between drivers without changing the field-wide DNF rate (attrs cluster around each driver's overall, not 0.5).
    this.consMean = this.cars.reduce((s, c) => s + A(c).consistency, 0) / this.cars.length;
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

  // command entry points — bounds/validate the (possibly network-supplied) car index + mode so a
  // malformed peer can't crash the host sim (host-authoritative trust boundary; audit r3).
  setPace(i, mode) { const c = this.cars[i]; if (c && PACE_MODES[mode]) { c.pace = mode; c._pin = true; } }
  setEngine(i, mode) { const c = this.cars[i]; if (c && ENGINE_KEYS.has(mode)) { c.engine = mode; c._pin = true; } }

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
    s += c._dirtyPace || 0;                                                   // dirty-air pace loss (set by _resolveCombat, §18.11)
    s += c._blueDelay || 0;                                                   // time threading past a lapped car (blue flags, set by _resolveBlueFlags)
    s += c._form || 0;                                                        // per-race form (off/on weekend), every car
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
        const drvSmooth = 1 - ATTRW.smoothWear * (A(c).smoothness - 0.5) * 2;   // smooth inputs save the tyres a touch (§18.7 r3)
        c.wear += (comp.wear * pm.wear * drvTyre * carTyre * drvSmooth) + c._dirtyWear;
        c._dirtyWear = 0;
        c.tyreTemp = warmStep(c.tyreTemp, c.tyre);
        const smooth = 1.1 - ATTRW.fuel * A(c).smoothness;              // smoother driver burns a touch less
        c.fuel -= burnFor(c.engine, c.car.fuel) * smooth;
        c.tyreAge += 1;
        this._serveLapEnd(c); // phase 3: pit + DNF (finishers handled in order())
      }
    }
    if (!this.scActive && !this.vscActive) { this._resolveCombat(); this._resolveBlueFlags(dt); }   // no green-flag passing/lapping under any caution
    else for (const c of this.cars) { c._dirtyPace = 0; c._blueDelay = 0; }                          // neutral while a caution is out
    this._aiDrive();   // AI engine/pace management (post-combat: pos + pass-credit are fresh)
    // safety-car lifecycle, driven by the leader's lap count
    const leadLap = this.cars.reduce((m, c) => Math.max(m, c.lap), 0);
    if (this.scLap != null && !this.scEverActive && leadLap >= this.scLap) {   // deploy the scheduled caution (full SC or VSC)
      this.scEverActive = true; this.scStartLap = leadLap;
      if (this.scIsVsc) this.vscActive = true; else this.scActive = true;
    }
    if (this.scActive && leadLap >= this.scStartLap + EVENT.scMinLaps) this.scActive = false;       // full SC retracts after scMinLaps
    if (this.vscActive && leadLap >= this.scStartLap + EVENT.vscMinLaps) this.vscActive = false;    // VSC clears faster
    if (this.scActive && !this._scWas) this._emit({ type: "sc_on", lap: leadLap });
    if (!this.scActive && this._scWas) this._emit({ type: "sc_off", lap: leadLap });
    if (this.vscActive && !this._vscWas) this._emit({ type: "vsc_on", lap: leadLap });
    if (!this.vscActive && this._vscWas) this._emit({ type: "vsc_off", lap: leadLap });
    this._scWas = this.scActive; this._vscWas = this.vscActive;
    this._resolveSC();   // bunching is full-SC only (it checks this.scActive)
    for (const c of this.cars) {
      if (c.retired && !this._retiredSeen.has(c.idx)) { this._retiredSeen.add(c.idx); this._emit({ type: "dnf", lap: c.lap, a: c.idx, abbr: c.abbrev }); }
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
    let mean = 0; for (const c of this.cars) mean += A(c).starts; mean /= this.cars.length;
    for (const c of this.cars) {
      let launch = (mean - A(c).starts) * EVENT.startLaunch + this.erng.noise(EVENT.startReact);  // s lost (good starter < 0)
      launch = Math.max(-EVENT.startCap, Math.min(EVENT.startCap, launch));
      const composed = 1 - ATTRW.composure * (A(c).composure - 0.5) * 2;   // a composed driver bogs down less often (§18.7)
      if (this.erng.unit() < EVENT.startP * composed) {        // rare bog-down / anti-stall
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
    for (const c of this.cars) c._dirtyPace = 0;   // fresh each green tick — dirty-air pace penalty is instantaneous
    for (let i = 1; i < ord.length; i++) {
      const ahead = ord[i - 1], me = ord[i];
      if (me.retired || ahead.retired || me.pitTimer > 0 || ahead.pitTimer > 0) continue;  // a car in the pits isn't racing
      const gapSec = ((ahead.lap + ahead.lapFrac) - (me.lap + me.lapFrac)) * this.track.lt;
      const s = sampleAt(me.lapFrac).straightness;          // local track character at the follower
      // dirty air: sitting close (even outside passing range) costs the follower tyre life AND pace, worse in corners
      if (gapSec > 0 && gapSec < DIRTY_GAP) {
        me._dirtyWear += dirtyWear(s) * (1 - ATTRW.discipline * (A(me).discipline - 0.5) * 2);   // a disciplined driver runs cleaner in traffic (§18.7)
        me._dirtyPace = DIRTY_PACE_K * (1 - s) * (1 - gapSec / DIRTY_GAP);   // ramps with proximity — close hurts more, 0 at the edge of DIRTY_GAP (§18.11 round-2)
      }
      // close combat: hold-up + pass-credit, with slipstream and braking-zone concentration
      if (gapSec > 0 && gapSec < COMBAT_GAP && me.lap === ahead.lap) {
        const edge = this._lapTime(ahead) - (this._lapTime(me) - (me._dirtyPace || 0));   // >0 => me faster on CLEAN pace; dirty air slows me on track but must not zero my passing intent (audit r3)
        const tow = slipstream(s, me.car.power);
        // recency bleed + accrual, then cap: the draft can't be banked over a whole straight and
        // cashed in one tick on zone entry (the verified credit-banking over-power, §18.13).
        if (me._creditVs !== ahead.idx) { me._passCredit = 0; me._creditVs = ahead.idx; }   // credit is earned vs a SPECIFIC rival — don't carry a bank onto a newly-ahead car (audit r3)
        const cautious = me.lap === 0 ? LAP1_CAUTION : 1;   // opening-lap caution: let the launch/grid order settle through T1 (§18.3)
        const aggr = 1 + ATTRW.aggression * (A(me).aggression - 0.5) * 2;   // a braver driver commits harder to the move (§18.7)
        const cr = (me._passCredit ?? 0) * PASS_CREDIT_DECAY
                 + passAccrual(edge, tow, me.engine, s) * (0.7 + ATTRW.overtaking * A(me).overtaking) * cautious * aggr;
        me._passCredit = Math.min(cr, PASS_CREDIT_CAP);
        const zone = zoneFor(this.track.overtake_zones, sampleAt(me.lapFrac).mini);   // follower's local zone (or null)
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
                this._emit({ type: "pass", lap: me.lap, a: me.idx, abbr: me.abbrev, b: ahead.idx, abbrB: ahead.abbrev, zone: "bold" });
                me._passedIdx = ahead.idx; me._passCd = this.time + 4;
              }
              continue;   // move done this tick — skip the pin
            }
          } else if (this.erng.unit() < AGGR_PASS_DNF) {
            me.retired = true; continue;   // the lunge went wrong — into the gravel
          }
        }
        const ease = zone ? zone.ease : 0;   // ease is only read in the in-zone resist below; 0 is a dead-safe fallback
        // outside any zone a pass cannot complete (resist = Infinity): stay pinned, credit keeps building
        const resist = zone ? (1 - ease) * 2.0 * (0.7 + ATTRW.defending * A(ahead).defending) : Infinity;
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
      const want = pitDecision(c, { wetness: this.wetness, scActive: this.scActive || this.vscActive, laps: this.track.laps });
      if (want) {
        c.pitPending = want.compound;
        if (want.reason !== "weather") c.aiStopsDone = (c.aiStopsDone || 0) + 1;  // consume a dry plan stop
      }
    }
    if (c.pitPending) {
      c.tyre = c.pitPending; c.pitPending = null; c.wear = 0; c.tyreAge = 0; c.tyreTemp = TYRE.pitTemp;
      const cautionPit = this.scActive ? EVENT.scPitMult : (this.vscActive ? EVENT.vscPitMult : 1);   // full SC cheapest, VSC mid, green full
      const pitLoss = this.track.pit * cautionPit * (c.personnel ? c.personnel.pitMult : 1);
      c.pitStops += 1;
      c.pitTimer = pitLoss;   // sit stationary in the box for pitLoss s — drained in step() (race time passes, rivals gain, the out-lap shows it). Replaces the old lapFrac subtraction that got clamped to ~0.
      this._emit({ type: "pit", lap: c.lap, a: c.idx, abbr: c.abbrev, compound: c.tyre });
    }
    if (c.fuel <= 0) { c.retired = true; return; }   // ran the tank dry
    const pm = PACE_MODES[c.pace];
    const consist = 1 + DNF_CONSIST * (this.consMean - A(c).consistency) * 2;   // jittery-vs-field driver → more incidents; field-neutral so the DNF rate holds (§18.7 r3)
    if (this.erng.unit() < DNF_BASE * (1 - c.car.rel) * pm.risk * consist) c.retired = true;
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
