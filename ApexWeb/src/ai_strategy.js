// ApexWeb/src/ai_strategy.js — deterministic AI race strategy for non-human cars.
// Pure functions of car state + a small race-context struct. Sharpness scales with the
// team strategist (personnel.strategy) and the driver's race_iq. No Math.random / real time.
import { COMPOUNDS, ATTRW } from "./data.js";
import { mix32 } from "./rng.js";

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// laps a compound lasts before its cliff, for this car at balanced pace (mirrors sim wear math)
export function stintLife(compound, c) {
  const comp = COMPOUNDS[compound];
  const drvTyre = 1 - ATTRW.wear * (((c.attrs && c.attrs.tyre != null ? c.attrs.tyre : 0.5)) - 0.5) * 2;
  const carTyre = 1.2 - ATTRW.carWear * ((c.car && c.car.tyre != null ? c.car.tyre : 1));
  return comp.cliff / (comp.wear * drvTyre * carTyre);
}

// choose a stop plan: target laps + compound to fit at each. 1 or 2 stops, seeded jitter by strategist.
export function planRace(c, track, seed, difficulty = 0.85) {
  const T = track.laps;
  const Lh = stintLife("hard", c), Lm = stintLife("medium", c);
  const strat = (c.personnel && c.personnel.strategy != null) ? c.personnel.strategy : 0.6;
  const j = ((mix32(((seed >>> 0) + (c.idx >>> 0) * 2654435761) >>> 0) % 1000) / 1000) - 0.5; // [-0.5,0.5]
  const drift = (1 - strat) * 6 * j + (1 - difficulty) * 8 * j;   // weak strategist OR low difficulty = sloppier timing
  let stops;
  if (Lm + Lh >= T * 0.98) {
    const lap = clamp(Math.round(Math.min(Lm * 0.9, T * 0.55) + drift), 8, T - 6);
    stops = [{ lap, compound: "hard" }];
  } else {
    const a = clamp(Math.round(T / 3 + drift), 6, T - 12);
    const b = clamp(Math.round((2 * T) / 3 + drift), a + 6, T - 5);
    stops = [{ lap: a, compound: "medium" }, { lap: b, compound: "hard" }];
  }
  // low-difficulty strategic BLUNDER: a rare real timing error (pits well off the optimal window) — so
  // an easy/normal field is beatable through opportunism, not only because the AI is slower. Hard: ~0.
  const blunder = (1 - difficulty) * 0.45;   // easy ~0.20 · normal ~0.09 · hard 0
  if ((mix32(((seed >>> 0) + (c.idx >>> 0) * 374761393 + 555) >>> 0) % 1000) / 1000 < blunder) {
    const bj = ((mix32(((seed >>> 0) + (c.idx >>> 0) * 668265263 + 99) >>> 0) % 1000) / 1000 - 0.5) * 18;   // ±9 laps
    stops = stops.map(s => ({ ...s, lap: clamp(Math.round(s.lap + bj), 5, T - 4) }));
  }
  return { stops, n: stops.length };
}

// decide whether to pit at this lap boundary. Returns {compound, reason} or null.
// reasons: "weather" (does NOT consume a dry plan stop), "sc", "plan", "emergency" (do consume).
export function pitDecision(c, ctx) {
  const onSlick = COMPOUNDS[c.tyre].wet_opt < 0.1;
  if (ctx.wetness > 0.55 && onSlick) return { compound: ctx.wetness > 0.8 ? "wet" : "inter", reason: "weather" };
  if (ctx.wetness < 0.35 && !onSlick) return { compound: "medium", reason: "weather" };
  if (ctx.wetness >= 0.35) return null;            // settled wet running: hold the wet tyre
  const plan = c.aiPlan; if (!plan) return null;
  const done = c.aiStopsDone || 0;
  const next = plan.stops[done];
  const lapsLeft = ctx.laps - c.lap;
  if (c.wear >= COMPOUNDS[c.tyre].cliff && lapsLeft > 4) return { compound: next ? next.compound : "hard", reason: "emergency" };
  if (!next) return null;
  // undercut COVER (reactive AI, high difficulty only): a close threat behind near our stop window →
  // pit early to protect track position. A sharp team covers; an easy field doesn't → it's exploitable.
  if (ctx.threatBehind && (ctx.difficulty != null ? ctx.difficulty : 0.85) > 0.7 && c.lap >= next.lap - 3 && lapsLeft > 5 && c.wear > COMPOUNDS[c.tyre].cliff * 0.5) {
    return { compound: next.compound, reason: "cover" };
  }
  if (ctx.scActive && c.lap >= next.lap - 8 && lapsLeft > 5) return { compound: next.compound, reason: "sc" };
  if (c.lap >= next.lap && lapsLeft > 4) return { compound: next.compound, reason: "plan" };
  return null;
}

// engine fuel-mode for an AI car given its situation. Conservative: standard unless a clear reason.
export function engineMode(c, ctx) {
  if (ctx.fuelLaps < ctx.lapsLeft + 0.5) return "save";   // must reach the flag
  const iq = (c.attrs && c.attrs.race_iq != null) ? c.attrs.race_iq : 0.5;
  if (ctx.gapAhead != null && ctx.gapAhead < 1.2 && iq > 0.45 && ctx.fuelLaps > ctx.lapsLeft + 2) return "push";
  return "standard";
}

// pace-mode for an AI car (tyre management vs attack). Conservative defaults.
export function paceMode(c, ctx) {
  if (ctx.dirtyAi