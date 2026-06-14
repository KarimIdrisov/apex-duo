// ApexWeb/src/quali.js
import { SKILL_K, CAR_K, CAR_PACE_K, COMPOUNDS, ATTRW, QUALI2 } from "./data.js";
import { RNG } from "./rng.js";

// the deterministic, clean part of a flying lap (no push/risk/noise) — the base the live sector model splits.
export function qualiLapClean(drv, car, track, setupBonus, carMean = 0, opts = {}) {
  const grip = opts.grip ?? 0, traffic = opts.traffic ?? 0;
  let s = track.lt + COMPOUNDS.soft.pace;
  s -= SKILL_K * ((drv.attrs ? drv.attrs.quali : drv.skill) - 0.5);   // one-lap pace
  s -= CAR_PACE_K * ((car.power + car.aero) / 2 - carMean);           // absolute car performance (§18.1)
  s -= CAR_K * ((car.power - car.aero) * (track.pw - track.df));
  s += setupBonus;
  s -= QUALI2.GRIP_GAIN * grip;                                       // track evolution: rubbered = faster
  if (opts.tyre === "used") s += QUALI2.USED_PENALTY;                 // a re-used warm set is slower than fresh
  s += traffic;                                                       // time lost to traffic (0..TRAFFIC_MAX)
  if (opts.yellow) s += QUALI2.YELLOW_PENALTY;                        // a yellow sector slows the lap
  return s;
}

// legacy single-shot flying lap (buildGrid fallback + tests): clean base + push-risk/noise/mistake. Unchanged behaviour.
export function qualiLap(drv, car, track, setupBonus, risk, rng, carMean = 0, opts = {}) {
  let s = qualiLapClean(drv, car, track, setupBonus, carMean, opts);
  s -= 0.35 * risk;                                                   // pushing harder = faster
  s += rng.noise(0.08 + 0.45 * risk);                                // ...but more variance
  const composed = drv.attrs ? 1 - ATTRW.composure * (drv.attrs.composure - 0.5) * 2 : 1;  // composed drivers lock up less (§18.7)
  if (rng.unit() < 0.12 * risk * composed) s += rng.range(0.8, 2.5);  // mistake / lock-up
  return s;
}

// one sector of a LIVE flying lap. base = clean lap time; frac = this sector's share (≈1/3).
// push 0..3, trackKnow 0..1, composure 0..1 (driver attr). Returns { time, event } where event ∈ null | "lockup" | "off".
export function qualiSector(base, frac, push, trackKnow, rng, composure = 0.5) {
  const pushN = push / 3;                                             // 0..1
  const safety = 1 - QUALI2.TRACK_SAFETY * trackKnow;                 // track knowledge tightens risk + variance
  const composed = 1 - ATTRW.composure * (composure - 0.5) * 2;       // composed drivers lock up / spin less (§18.7)
  let s = base * frac;
  s -= QUALI2.PUSH_GAIN * frac * pushN;                              // pushing this sector = faster (∝ sector size)
  s += rng.noise((QUALI2.SEC_VAR_BASE + QUALI2.SEC_VAR_PUSH * pushN) * safety);
  let event = null;
  const r = rng.unit();
  const offChance  = QUALI2.OFF_BASE  * pushN * pushN * safety * composed;   // big mistake (push²) → lap deleted
  const lockChance = QUALI2.LOCK_BASE * pushN * safety * composed;          // small mistake → +time
  if (r < offChance) event = "off";
  else if (r < offChance + lockChance) { event = "lockup"; s += rng.range(QUALI2.LOCK_MIN, QUALI2.LOCK_MAX); }
  return { time: s, event };
}

export function buildGrid(field, track, seed) {
  const r = new RNG(seed);
  const carMean = field.reduce((a, f) => a + (f.car.power + f.car.aero) / 2, 0) / field.length;
  return field
    .map(f => ({ idx: f.idx, abbrev: f.abbrev, time: qualiLap(f, f.car, track, f.setupBonus ?? 0, f.risk ?? 0.5, r, carMean) }))
    .sort((a, b) => a.time - b.time);
}
