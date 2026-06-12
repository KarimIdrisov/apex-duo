// ApexWeb/src/track.js — circuit geometry: 3 sectors / 18 mini-sectors with a
// per-position "straightness" derived from the real outline (TRACK_PATH curvature).
// Pure module. sampleAt() locates a car for Phase-4 combat; miniSplits() distributes
// a lap time across the minis by the car's power(straights)/aero(corners) fit.
import { TRACK_PATH, FIT_K } from "./data.js";

export const N_MINI = 18, N_SECTOR = 3;

const PTS = [];
for (let i = 0; i < TRACK_PATH.length; i += 2) PTS.push([TRACK_PATH[i], TRACK_PATH[i + 1]]);
const NP = PTS.length;

function turnAngle(i) {
  const a = PTS[(i - 1 + NP) % NP], b = PTS[i], c = PTS[(i + 1) % NP];
  const v1x = b[0] - a[0], v1y = b[1] - a[1], v2x = c[0] - b[0], v2y = c[1] - b[1];
  const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
  if (m1 < 1e-9 || m2 < 1e-9) return 0;
  let cos = (v1x * v2x + v1y * v2y) / (m1 * m2);
  cos = Math.max(-1, Math.min(1, cos));
  return Math.acos(cos);   // 0 = straight ahead, up to PI = hairpin
}

function buildMini() {
  const per = NP / N_MINI;
  const raw = [];
  for (let m = 0; m < N_MINI; m++) {
    let sum = 0, n = 0;
    for (let i = Math.floor(m * per); i < Math.floor((m + 1) * per); i++) { sum += turnAngle(i); n++; }
    raw.push(n ? sum / n : 0);
  }
  const maxA = Math.max(...raw, 1e-6);
  return raw.map((a, m) => ({
    straightness: 1 - a / maxA,
    lenFrac: 1 / N_MINI,
    sector: Math.floor(m / (N_MINI / N_SECTOR)),
  }));
}
export const MINI = buildMini();

export function sampleAt(lapFrac) {
  const f = ((lapFrac % 1) + 1) % 1;
  const mini = Math.min(N_MINI - 1, Math.floor(f * N_MINI));
  return { mini, sector: MINI[mini].sector, straightness: MINI[mini].straightness };
}

export function miniSplits(lapTime, car) {
  const avgS = MINI.reduce((a, m) => a + m.straightness * m.lenFrac, 0);
  const carAvg = car.power * avgS + car.aero * (1 - avgS);
  return MINI.map(m => {
    const localPace = car.power * m.straightness + car.aero * (1 - m.straightness);
    const fit = 1 - FIT_K * (localPace - carAvg);
    return lapTime * m.lenFrac * fit;
  });
}
