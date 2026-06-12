// ApexWeb/src/sim.js
import { RNG, mix32 } from "./rng.js";
import { COMPOUNDS, PACE_MODES, SKILL_K, CAR_K, STEP, DNF_BASE, GRID_GAP, COMBAT_GAP } from "./data.js";
import { startFuel, burnFor, weightTerm, engineTerm } from "./fuel.js";

const ENGINE_KEYS = new Set(["save", "standard", "push"]);

export class Race {
  constructor(field, track, seed) {
    this.track = track;
    this.rng = new RNG(seed);
    this.erng = new RNG(mix32(seed));
    this.time = 0;
    this.finished = false;
    this.cars = field.map((f, i) => ({
      idx: i, name: f.name, abbrev: f.abbrev, skill: f.skill, car: f.car,
      color: f.color, team: f.team, isPlayer: !!f.isPlayer, player: f.player ?? null,
      setup: f.setup ?? [0.5, 0.5, 0.5], setupBonus: f.setupBonus ?? 0,
      lap: 0, lapFrac: 0, lapTimeAccum: 0, lastLap: 0, totalTime: 0,
      avgLap: 0, _lapSum: 0, _lapN: 0,
      tyre: f.startTyre ?? "medium", wear: 0, tyreAge: 0,
      fuel: startFuel(track), engine: "standard",
      pace: "balanced",
      retired: false, pitPending: null, pos: i + 1, startPos: i + 1,
      pitStops: 0, pitTimer: 0,
    }));
  }

  setPace(i, mode) { if (PACE_MODES[mode]) this.cars[i].pace = mode; }
  setEngine(i, mode) { if (ENGINE_KEYS.has(mode)) this.cars[i].engine = mode; }

  // clean lap time for one car right now (seconds)
  _lapTime(c) {
    const t = this.track, comp = COMPOUNDS[c.tyre], pm = PACE_MODES[c.pace];
    let s = t.lt;
    s -= SKILL_K * (c.skill - 0.5);
    s -= CAR_K * ((c.car.power - c.car.aero) * (t.pw - t.df));   // track-character bias
    s += comp.pace + this._wearTerm(c, comp);
    s += pm.pace;
    s += engineTerm(c.engine);          // fuel push/save lever
    s += weightTerm(c.fuel);            // heavy tank = slower (eases as fuel burns)
    s += c.setupBonus;                                           // <=0, faster when set well
    s += this.rng.noise(0.06);
    return s;
  }

  _wearTerm(c, comp) {
    // linear up to the cliff, then steep
    if (c.wear <= comp.cliff) return c.wear * 0.012;
    return comp.cliff * 0.012 + (c.wear - comp.cliff) * 0.10;
  }

  step(dt = STEP) {
    if (this.finished) return;
    this.time += dt;
    for (const c of this.cars) {
      if (c.retired) continue;
      const lt = this._lapTime(c);
      c.lapFrac += dt / lt;
      c.lapTimeAccum += dt;
      if (c.lapFrac >= 1) {            // lap completed (phase 3 owns bookkeeping)
        c.lapFrac -= 1;
        c.lap += 1;
        c.lastLap = c.lapTimeAccum;
        c._lapSum += c.lastLap; c._lapN++; c.avgLap = c._lapSum / c._lapN;
        c.totalTime += c.lastLap;
        c.lapTimeAccum = 0;
        // per-lap wear + fuel burn
        const comp = COMPOUNDS[c.tyre], pm = PACE_MODES[c.pace];
        c.wear += comp.wear * pm.wear;
        c.fuel -= burnFor(c.engine, c.car.fuel);   // c.car.fuel: economy rating (1=standard), wired in Phase 7
        c.tyreAge += 1;
        this._serveLapEnd(c); // phase 3: pit + DNF (finishers handled in order())
      }
    }
    this._resolveCombat();
    if (this.cars.every(c => c.retired || c.lap >= this.track.laps)) this.finished = true;
  }

  requestPit(i, compound) { this.cars[i].pitPending = compound; }

  // spread the start by skill: best skill -> P1, GRID_GAP seconds per slot
  gridStart() {
    const sorted = [...this.cars].sort((a, b) => b.skill - a.skill);
    sorted.forEach((c, slot) => { c.lap = 0; c.lapFrac = -slot * (GRID_GAP / this.track.lt); });
  }

  // combat: a follower within COMBAT_GAP of the car ahead is held up and builds
  // pass-credit from its pace edge; passes when credit beats track resistance.
  // Writes ONLY lapFrac (relative to the car's own lap). Never assigns lap.
  _resolveCombat() {
    const ord = this.order(); // sorted leaders-first; pos set
    for (let i = 1; i < ord.length; i++) {
      const ahead = ord[i - 1], me = ord[i];
      if (me.retired || ahead.retired) continue;
      const gapLaps = (ahead.lap + ahead.lapFrac) - (me.lap + me.lapFrac);
      const gapSec = gapLaps * this.track.lt;
      if (gapSec > 0 && gapSec < COMBAT_GAP && me.lap === ahead.lap) {
        const edge = this._lapTime(ahead) - this._lapTime(me);   // >0 => me faster
        me._passCredit = (me._passCredit ?? 0) + Math.max(0, edge) * (me.engine === "push" ? 1.3 : 1);
        const resist = (1 - this.track.ot) * 2.0;                 // high where ot low
        if (me._passCredit < resist) {
          // pinned: clamp just behind the car ahead (dirty-air hold-up)
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

  _serveLapEnd(c) {
    // called at lap completion in step(); handles pit + DNF
    // AI cars (no human engineer) auto-pit once near the tyre cliff if enough race remains
    if (c.player == null && c.pitStops === 0 && !c.pitPending) {
      const comp = COMPOUNDS[c.tyre];
      if (c.wear >= comp.cliff * 0.8 && (this.track.laps - c.lap) > 6) {
        c.pitPending = c.tyre === "soft" ? "medium" : "hard";   // fresh, harder set
      }
    }
    if (c.pitPending) {
      c.tyre = c.pitPending; c.pitPending = null; c.wear = 0; c.tyreAge = 0;
      c.pitStops += 1; c.totalTime += this.track.pit;
      c.lapFrac -= this.track.pit / this.track.lt;            // lose pit time on track
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
