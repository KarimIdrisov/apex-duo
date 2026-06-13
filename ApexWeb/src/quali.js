// ApexWeb/src/quali.js
import { SKILL_K, CAR_K, CAR_PACE_K, COMPOUNDS, ATTRW } from "./data.js";
import { RNG } from "./rng.js";

// one flying lap on softs. risk in [0,1]: faster mean, bigger spread, mistake chance.
// carMean = field-mean (power+aero)/2, so the absolute car-pace term (§18.1) shapes the grid too
// (a better car qualifies better, consistent with the race).
// setupBonus = precomputed paceBonus(closeness(setup,ideal)) — caller supplies it (≤0, faster when set well).
export function qualiLap(drv, car, track, setupBonus, risk, rng, carMean = 0) {
  let s = track.lt + COMPOUNDS.soft.pace;
  s -= SKILL_K * ((drv.attrs ? drv.attrs.quali : drv.skill) - 0.5);   // one-lap pace
  s -= CAR_PACE_K * ((car.power + car.aero) / 2 - carMean);           // absolute car performance (§18.1) — shapes the grid like the race
  s -= CAR_K * ((car.power - car.aero) * (track.pw - track.df));
  s += setupBonus;
  s -= 0.35 * risk;                                  // pushing harder = faster
  s += rng.noise(0.08 + 0.45 * risk);                // ...but more variance
  const composed = drv.attrs ? 1 - ATTRW.composure * (drv.attrs.composure - 0.5) * 2 : 1;  // composed drivers lock up less (§18.7)
  if (rng.unit() < 0.12 * risk * composed) s += rng.range(0.8, 2.5);  // mistake / lock-up
  return s;
}

export function buildGrid(field, track, seed) {
  const r = new RNG(seed);
  const carMean = field.reduce((a, f) => a + (f.car.power + f.car.aero) / 2, 0) / field.length;
  return field
    .map(f => ({ idx: f.idx, abbrev: f.abbrev, time: qualiLap(f, f.car, track, f.setupBonus ?? 0, f.risk ?? 0.5, r, carMean) }))
    .sort((a, b) => a.time - b.time);
}
