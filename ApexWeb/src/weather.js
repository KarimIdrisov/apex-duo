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
