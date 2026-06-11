// ApexWeb/src/sim.js
import { RNG, mix32 } from "./rng.js";
import { COMPOUNDS, PACE_MODES, ERS_MODES, SKILL_K, CAR_K, CLIP_PEN, STEP } from "./data.js";

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
      tyre: f.startTyre ?? "medium", wear: 0, soc: 60,
      pace: "balanced", ers: "balanced",
      retired: false, pitPending: null, pos: i + 1,
    }));
  }

  setPace(i, mode) { if (PACE_MODES[mode]) this.cars[i].pace = mode; }
  setErs(i, mode) { if (ERS_MODES[mode]) this.cars[i].ers = mode; }

  // clean lap time for one car right now (seconds)
  _lapTime(c) {
    const t = this.track, comp = COMPOUNDS[c.tyre], pm = PACE_MODES[c.pace], em = ERS_MODES[c.ers];
    let s = t.lt;
    s -= SKILL_K * (c.skill - 0.5);
    s -= CAR_K * ((c.car.power - c.car.aero) * (t.pw - t.df));   // track-character bias
    s += comp.pace + this._wearTerm(c, comp);
    s += pm.pace;
    s += em.pace + (c.soc <= 0 ? CLIP_PEN : 0);
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
        // per-lap wear + SoC
        const comp = COMPOUNDS[c.tyre], pm = PACE_MODES[c.pace], em = ERS_MODES[c.ers];
        c.wear += comp.wear * pm.wear;
        c.soc = Math.max(0, Math.min(100, c.soc + em.soc));
        if (c.lap >= this.track.laps) c.retired = c.retired; // finishers handled in order()
      }
    }
    if (this.cars.every(c => c.retired || c.lap >= this.track.laps)) this.finished = true;
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
