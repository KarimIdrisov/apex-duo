// ApexWeb/src/track.js — circuit geometry: 3 sectors / 18 mini-sectors with a
// per-position "straightness" derived from the real outline (TRACK_PATH curvature).
// Pure module. sampleAt() locates a car for Phase-4 combat; miniSplits() distributes
// a lap time across the minis by the car's power(straights)/aero(corners) fit.
import { FIT_K, TRACK_PATH, TRACK } from "./data.js";

export const N_MINI = 18, N_SECTOR = 3;

// turn angle at vertex i of a flat outline's point array (0 = straight, up to PI = hairpin).
function turnAngle(PTS, i) {
  const NP = PTS.length, a = PTS[(i - 1 + NP) % NP], b = PTS[i], c = PTS[(i + 1) % NP];
  const v1x = b[0] - a[0], v1y = b[1] - a[1], v2x = c[0] - b[0], v2y = c[1] - b[1];
  const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
  if (m1 < 1e-9 || m2 < 1e-9) return 0;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (m1 * m2)));
  return Math.acos(cos);
}

// 18 mini-sectors from a flat outline [x0,y0,...]: per-sector straightness (1=straight, 0=tightest),
// equal lenFrac, sector 0/1/2. Pure — used by the default track and by trackFromEdited. (Unchanged math.)
export function buildMini(outline) {
  const PTS = [];
  for (let i = 0; i < outline.length; i += 2) PTS.push([outline[i], outline[i + 1]]);
  const NP = PTS.length, per = NP / N_MINI, raw = [];
  for (let m = 0; m < N_MINI; m++) {
    let sum = 0, n = 0;
    for (let i = Math.floor(m * per); i < Math.floor((m + 1) * per); i++) { sum += turnAngle(PTS, i); n++; }
    raw.push(n ? sum / n : 0);
  }
  const maxA = Math.max(...raw, 1e-6);
  return raw.map((a, m) => ({ straightness: 1 - a / maxA, lenFrac: 1 / N_MINI, sector: Math.floor(m / (N_MINI / N_SECTOR)) }));
}

export const MINI = buildMini(TRACK_PATH);
// Stamp mini onto the default TRACK object so Race(field, TRACK, seed) works without callers
// having to manually set track.mini. Other tracks must set their own .mini before passing to Race.
if (!TRACK.mini) TRACK.mini = MINI;

// locate a car on the track's mini-sectors. `track.mini` is the buildMini() array.
export function sampleAt(track, lapFrac) {
  const f = ((lapFrac % 1) + 1) % 1, mini = Math.min(N_MINI - 1, Math.floor(f * N_MINI)), M = track.mini[mini];
  return { mini, sector: M.sector, straightness: M.straightness };
}

// distribute a lap time across the track's mini-sectors by the car's power(straights)/aero(corners) fit.
export function miniSplits(track, lapTime, car) {
  const MINI = track.mini;
  const avgS = MINI.reduce((a, m) => a + m.straightness * m.lenFrac, 0);
  const carAvg = car.power * avgS + car.aero * (1 - avgS);
  return MINI.map(m => {
    const localPace = car.power * m.straightness + car.aero * (1 - m.straightness);
    return lapTime * m.lenFrac * (1 - FIT_K * (localPace - carAvg));
  });
}
