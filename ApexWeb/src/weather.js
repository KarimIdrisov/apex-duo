// ApexWeb/src/weather.js — pure weather: a deterministic rain arc + the compound
// mismatch penalty that drives the slick↔inter↔wet crossover. Draws from erng.
import { COMPOUNDS, WET } from "./data.js";

// decide the race's rain arc. Returns { rains:false } or a dry→rise→hold→dry timeline.
export function scheduleWeather(erng, wetProb, laps) {
  if (erng.unit() >= wetProb) return { rains: false };
  return {
    rains: true,
    onset: Math.floor(laps * (0.15 + 0.40 * erng.unit())),
    rise:  3 + Math.floor(4 * erng.unit()),
    peak:  0.60 + 0.35 * erng.unit(),
    hold:  4 + Math.floor(8 * erng.unit()),
    dry:   5 + Math.floor(6 * erng.unit()),
  };
}

// track wetness 0..1 at a (possibly fractional) lap.
export function wetnessAt(w, lap) {
  if (!w.rains) return 0;
  const t = lap - w.onset;
  if (t <= 0) return 0;
  if (t < w.rise) return w.peak * (t / w.rise);
  if (t < w.rise + w.hold) return w.peak;
  const d = t - w.rise - w.hold;
  if (d < w.dry) return w.peak * (1 - d / w.dry);
  return 0;
}

// pace penalty (s/lap) for running `compound` at the current `wetness`.
export function weatherTerm(compound, wetness) {
  const c = COMPOUNDS[compound];
  let pen = WET.mismatch * Math.abs(wetness - c.wet_opt);
  if (c.wet_opt < 0.1 && wetness > 0.4) pen += WET.slick * (wetness - 0.4);
  return pen;
}

// A player-facing forecast derived from the (hidden) rain arc at the current lap. Deterministic:
// confidence sharpens as the onset approaches, so a distant front is a vague "переменно" and a near
// one is a sharp ETA window — the basis for the slick↔inter↔wet gamble. Returns:
//   { state: "dry"|"variable"|"incoming"|"damp"|"rain"|"drying", chance, etaLow, etaHigh, peak, dryIn }
export const FORECAST_HORIZON = 12;   // laps ahead the radar can "see"
export function liveForecast(w, lap, laps) {
  if (!w || !w.rains) return { state: "dry", chance: 0, etaLow: null, etaHigh: null, peak: 0, dryIn: null };
  const cur = wetnessAt(w, lap);
  if (cur > 0.05) {                                   // it's wet now → forecast the dry-out
    const dryStart = w.onset + w.rise + w.hold;
    const dryIn = Math.max(0, Math.round(dryStart + w.dry - lap));
    const easing = lap >= dryStart;
    return { state: easing ? "drying" : (cur >= 0.45 ? "rain" : "damp"), chance: 100, etaLow: null, etaHigh: null, peak: w.peak, dryIn };
  }
  const away = w.onset - lap;                         // laps until the rain arrives
  if (away <= 0) return { state: "dry", chance: 0, etaLow: null, etaHigh: null, peak: 0, dryIn: null };
  if (away > FORECAST_HORIZON) return { state: "variable", chance: 15, etaLow: null, etaHigh: null, peak: w.peak, dryIn: null };
  const conf = 1 - away / FORECAST_HORIZON;           // 0 (far) .. 1 (imminent)
  const spread = Math.max(1, Math.round((1 - conf) * 5));
  return { state: "incoming", chance: Math.round(40 + 55 * conf), etaLow: Math.max(1, away - spread), etaHigh: away + spread, peak: w.peak, dryIn: null };
}
