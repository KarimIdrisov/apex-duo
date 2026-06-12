// ApexWeb/src/quali.js
import { SKILL_K, CAR_K, COMPOUNDS } from "./data.js";
import { RNG } from "./rng.js";
import { closeness, paceBonus, trackIdeal } from "./setup.js";

// one flying lap on softs. risk in [0,1]: faster mean, bigger spread, mistake chance.
export function qualiLap(drv, car, track, setup, risk, rng) {
  const ideal = trackIdeal(track.laps * 1000 + Math.round(track.lt));
  const close = closeness(setup, ideal);
  let s = track.lt + COMPOUNDS.soft.pace;
  s -= SKILL_K * ((drv.attrs ? drv.attrs.quali : drv.skill) - 0.5);   // one-lap pace
  s -= CAR_K * ((car.power - car.aero) * (track.pw - track.df));
  s += paceBonus(close);
  s -= 0.35 * risk;                                  // pushing harder = faster
  s += rng.noise(0.08 + 0.45 * risk);                // ...but more variance
  if (rng.unit() < 0.12 * risk) s += rng.range(0.8, 2.5);  // mistake / lock-up
  return s;
}

export function buildGrid(field, track, seed) {
  const r = new RNG(seed);
  return field
    .map(f => ({ idx: f.idx, abbrev: f.abbrev, time: qualiLap(f, f.car, track, f.setup, f.risk ?? 0.5, r) }))
    .sort((a, b) => a.time - b.time);
}
