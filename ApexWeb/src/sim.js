// ApexWeb/src/sim.js
import { RNG, mix32 } from "./rng.js";
import { COMPOUNDS, PACE_MODES, SKILL_K, CAR_K, STEP, DNF_BASE, GRID_GAP, COMBAT_GAP, TYRE, DIRTY_GAP, EVENT, ATTRW } from "./data.js";
import { startFuel, burnFor, weightTerm, engineTerm } from "./fuel.js";
import { tyreTerm, warmStep } from "./tyres.js";
import { miniSplits, MINI, N_MINI, sampleAt } from "./track.js";
import { slipstream, dirtyWear, passAccrual } from "./overtake.js";
import { scheduleSC, startIncidentHit } from "./events.js";
import { scheduleWeather, wetnessAt, weatherTerm } from "./weather.js";
import { ATTR_KEYS } from "./team.js";

const ENGINE_KEYS = new Set(["save", "standard", "push"]);
const NEUTRAL_ATTRS = Object.fromEntries(ATTR_KEYS.map(k => [k, 0.5]));
const A = c => c.attrs || NEUTRAL_ATTRS;   // attribute accessor with a neutral fallback

export class Race {
  constructor(field, track, seed) {
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
      _dirtyWear: 0, _startPenalty: 0,
    }));
  }

  setPace(i, mode) { if (PACE_MODES[mode]) this.cars[i].pace = mode; }
  setEngine(i, mode) { if (ENGINE_KEYS.has(mode)) this.cars[i].engine = mode; }

  // clean lap time for one car right now (seconds)
  _lapTime(c) {
    const t = this.track, comp = COMPOUNDS[c.tyre], pm = PACE_MODES[c.pace];
    let s = t.lt;
    s -= SKILL_K * (A(c).pace - 0.5);                    // driver pace attribute
    s -= CAR_K * ((c.car.power - c.car.aero) * (t.pw - t.df));   // track-character bias
    s += comp.pace + tyreTerm(c.tyre, c.wear, c.tyreTemp);
    s += weatherTerm(c.tyre, this.wetness) * (1.3 - ATTRW.wet * A(c).wet);   // wet skill cuts the penalty
    s += pm.pace;
    s += engineTerm(c.engine);          // fuel push/save lever
    s += weightTerm(c.fuel);            // heavy tank = slower (eases as fuel burns)
    s += c.setupBonus;                                           // <=0, faster when set well
    s += this.rng.noise(0.06) * (1.3 - ATTRW.noise * A(c).consistency);      // consistency steadies the lap
    if (c.lap === 0 && c._startPenalty) s += c._startPenalty;   // lost time from a start incident (lap 1 only)
    if (this.scActive) s *= EVENT.scPaceMult;   // everyone crawls behind the safety car
    return s;
  }

  step(dt = STEP) {
    if (this.finished) return;
    if (!this._started) { this._started = true; this._startIncidents(); }
    this.time += dt;
    const leadProg = this.cars.reduce((m, c) => Math.max(m, c.lap + c.lapFrac), 0);
    this.wetness = wetnessAt(this.weather, leadProg);
    for (const c of this.cars) {
      if (c.retired) continue;
      const lt = this._lapTime(c);
      c.lapFrac += dt / lt;
      c.lapTimeAccum += dt;
      if (c.lapFrac >= 1) {            // lap completed (phase 3 owns bookkeeping)
        c.lapFrac -= 1;
        c.lap += 1;
        c.lastLap = c.lapTimeAccum;
        this._recordMinis(c);
        c._lapSum += c.lastLap; c._lapN++; c.avgLap = c._lapSum / c._lapN;
        c.totalTime += c.lastLap;
        c.lapTimeAccum = 0;
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
    // safety-car lifecycle, driven by the leader's lap count
    const leadLap = this.cars.reduce((m, c) => Math.max(m, c.lap), 0);
    if (this.scLap != null && !this.scActive && !this.scEverActive && leadLap >= this.scLap) {
      this.scActive = true; this.scEverActive = true; this.scStartLap = leadLap;
    }
    if (this.scActive && leadLap >= this.scStartLap + EVENT.scMinLaps) this.scActive = false;
    this._resolveSC();
    if (this.cars.every(c => c.retired || c.lap >= this.track.laps)) this.finished = true;
  }

  requestPit(i, compound) { this.cars[i].pitPending = compound; }

  // spread the start by skill: best skill -> P1, GRID_GAP seconds per slot
  gridStart() {
    const sorted = [...this.cars].sort((a, b) => b.skill - a.skill);
    sorted.forEach((c, slot) => { c.lap = 0; c.lapFrac = -slot * (GRID_GAP / this.track.lt); });
  }

  _startIncidents() {
    for (const c of this.cars) {
      if (startIncidentHit(this.erng, EVENT.startP * (1.5 - ATTRW.starts * A(c).starts))) {
        c._startPenalty = EVENT.startLoss;                       // a slow lap 1 (applied in _lapTime), drops the car back
        if (this.erng.unit() < EVENT.startDnf) c.retired = true; // rare: out on the spot
      }
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
      if (me.retired || ahead.retired) continue;
      const gapSec = ((ahead.lap + ahead.lapFrac) - (me.lap + me.lapFrac)) * this.track.lt;
      const s = sampleAt(me.lapFrac).straightness;          // local track character at the follower
      // dirty air: sitting close (even outside passing range) costs the follower tyre life, worse in corners
      if (gapSec > 0 && gapSec < DIRTY_GAP) me._dirtyWear += dirtyWear(s);
      // close combat: hold-up + pass-credit, with slipstream and braking-zone concentration
      if (gapSec > 0 && gapSec < COMBAT_GAP && me.lap === ahead.lap) {
        const edge = this._lapTime(ahead) - this._lapTime(me);   // >0 => me faster
        const tow = slipstream(s, me.car.power);
        me._passCredit = (me._passCredit ?? 0) + passAccrual(edge, tow, me.engine, s) * (0.7 + ATTRW.overtaking * A(me).overtaking);
        const resist = (1 - this.track.ot) * 2.0 * (0.7 + ATTRW.defending * A(ahead).defending);
        if (me._passCredit < resist) {
          // pinned behind the car ahead (writes ONLY lapFrac — invariant)
          const target = (ahead.lap + ahead.lapFrac) - (COMBAT_GAP * 0.5) / this.track.lt;
          const desiredFrac = target - me.lap;
          if (desiredFrac < me.lapFrac) me.lapFrac = Math.max(0, desiredFrac);
        } else {
          me._passCredit = 0; // pass completes naturally next ticks (no lap write)
        }
      } else {
        me._passCredit = 0;
      }
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
    if (c.player == null && !c.pitPending && c.tyreAge > 2) {
      const slick = COMPOUNDS[c.tyre].wet_opt < 0.1;
      if (this.wetness > 0.55 && slick) c.pitPending = this.wetness > 0.8 ? "wet" : "inter";
      else if (this.wetness < 0.35 && !slick) c.pitPending = "medium";
    }
    if (c.player == null && c.pitStops === 0 && !c.pitPending) {
      const comp = COMPOUNDS[c.tyre];
      if (c.wear >= comp.cliff * 0.8 && (this.track.laps - c.lap) > 6) {
        c.pitPending = c.tyre === "soft" ? "medium" : "hard";   // fresh, harder set
      }
    }
    if (c.pitPending) {
      c.tyre = c.pitPending; c.pitPending = null; c.wear = 0; c.tyreAge = 0; c.tyreTemp = TYRE.pitTemp;
      const pitLoss = this.track.pit * (this.scActive ? EVENT.scPitMult : 1) * (c.personnel ? c.personnel.pitMult : 1);
      c.pitStops += 1; c.totalTime += pitLoss;
      c.lapFrac -= pitLoss / this.track.lt;                   // lose pit time on track (cheaper under SC)
      if (c.lapFrac < 0) c.lapFrac = 0;
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
