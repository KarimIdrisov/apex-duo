// ApexWeb/src/academy.js — pure young-driver academy: scout juniors (off-grid), develop them in
// your program, promote a ready one into a race seat (injects into the driver registry).
import { driverAttrs, assignTraits } from "./team.js";
import { mix32 } from "./rng.js";
const clampOverall = v => Math.max(0.50, Math.min(0.99, v));

export const SUPERLICENSE = 0.78;   // overall needed to promote a junior to a race seat
export const SCOUT_FEE = 800;       // $k to sign a junior into the academy
export const SL_NEEDED = 40;        // superlicense points to qualify for a race seat (real-world gate)
export const SL_TABLE = [40, 30, 25, 20, 16, 12, 8, 6, 4, 2];   // SL points by feeder finishing position

// a fictional F2 feeder field the academy juniors race against (names invented).
export const FEEDER_FILLER = [
  { name: "Леклер-мл.", overall: 0.82 }, { name: "Фиттипальди", overall: 0.80 }, { name: "Браунинг", overall: 0.78 },
  { name: "Марти", overall: 0.76 }, { name: "Кроуфорд", overall: 0.75 }, { name: "Аль-Дхаэри", overall: 0.73 },
  { name: "Вершор", overall: 0.72 }, { name: "Бенавидес", overall: 0.70 }, { name: "Касер", overall: 0.68 }, { name: "Линдблад", overall: 0.66 },
];

// the junior talent pool (fictional F2/F3-style young drivers; abbrevs avoid the grid's).
export const JUNIOR_POOL = [
  { abbrev: "DOO", name: "Дуэн",        age: 19, overall: 0.78, potential: 0.90 },
  { abbrev: "BAR", name: "Барнард",     age: 18, overall: 0.74, potential: 0.88 },
  { abbrev: "HIR", name: "Хиракава",    age: 20, overall: 0.80, potential: 0.86 },
  { abbrev: "MTS", name: "Мартинс",     age: 19, overall: 0.76, potential: 0.89 },
  { abbrev: "OSU", name: "О'Салливан",  age: 20, overall: 0.79, potential: 0.85 },
  { abbrev: "VIL", name: "Виллагомес",  age: 17, overall: 0.71, potential: 0.93 },
  { abbrev: "STN", name: "Стенсхорн",   age: 18, overall: 0.73, potential: 0.90 },
  { abbrev: "DUN", name: "Данн",        age: 18, overall: 0.72, potential: 0.91 },
];

// juniors available to scout (pool minus those already in the academy or promoted onto the grid).
export function availableJuniors(career) {
  const taken = new Set([...(career.academy || []).map(j => j.abbrev), ...Object.keys(career.drivers || {})]);
  return JUNIOR_POOL.filter(j => !taken.has(j.abbrev));
}

// sign a junior into the academy. Returns true if applied.
export function signJunior(career, abbrev) {
  if (career.money < SCOUT_FEE) return false;
  if ((career.academy || []).some(j => j.abbrev === abbrev)) return false;
  const j = JUNIOR_POOL.find(p => p.abbrev === abbrev);
  if (!j) return false;
  career.money -= SCOUT_FEE;
  career.academy = career.academy || [];
  career.academy.push({ ...j, slPoints: Math.max(0, Math.round((j.overall - 0.6) * 40)), series: "F2" });   // D7: feeder pedigree on signing
  return true;
}

// develop academy juniors one season: age them up, then race a feeder season (which earns
// superlicense points + develops them by results).
export function developAcademy(career, seed) {
  for (const j of (career.academy || [])) j.age += 1;
  runFeeder(career, seed ?? career.season ?? career.seed ?? 1);
}

// run one feeder season: juniors + filler ranked by form; juniors earn superlicense points by
// finishing position and develop by results. Pure & deterministic (seeded). Returns { standings }.
export function runFeeder(career, seed) {
  const s = (seed >>> 0) || 1;
  const field = [
    ...(career.academy || []).map(j => ({ abbrev: j.abbrev, name: j.name, overall: j.overall, _j: j })),
    ...FEEDER_FILLER.map((f, i) => ({ name: f.name, overall: f.overall, _filler: i })),
  ];
  for (const e of field) {                            // season form = overall + bounded deterministic noise
    const key = e.abbrev || ("f" + e._filler);
    e._form = e.overall + (mix32((s * 2654435761 + key.charCodeAt(0) * 131 + (key.charCodeAt(1) || 7)) >>> 0) / 4294967296 - 0.5) * 0.06;
  }
  field.sort((a, b) => b._form - a._form);
  const n = field.length;
  field.forEach((e, pos) => {
    if (!e._j) return;
    e._j.slPoints = (e._j.slPoints || 0) + (SL_TABLE[pos] || 0);
    const rq = 1 - pos / n;                           // 1 = won, ~0 = last — a better result develops faster
    e._j.overall = clampOverall(e._j.overall + Math.max(0, (e._j.potential - e._j.overall) * (0.25 + 0.15 * rq)));
  });
  return { standings: field.map((e, pos) => ({ pos: pos + 1, name: e.name, abbrev: e.abbrev, pts: SL_TABLE[pos] || 0 })) };
}

// promote a ready junior into a race seat, retiring the player driver `outAbbrev`. Returns true if applied.
export function promoteJunior(career, juniorAbbrev, outAbbrev) {
  const ji = (career.academy || []).findIndex(j => j.abbrev === juniorAbbrev);
  if (ji < 0) return false;
  const j = career.academy[ji];
  if (j.overall < SUPERLICENSE && (j.slPoints || 0) < SL_NEEDED) return false;   // superlicense gate (overall OR SL points)
  const out = career.drivers[outAbbrev];
  if (!out || out.teamIdx !== career.teamIdx) return false;          // must drop one of your own
  delete career.drivers[outAbbrev];                                  // the veteran retires off the grid
  career.drivers[juniorAbbrev] = {
    teamIdx: career.teamIdx, age: j.age, overall: j.overall, morale: 0.7,
    contractSeasons: 3, salary: 200, name: j.name,                   // cheap rookie salary; name for the roster
    attrs: driverAttrs(juniorAbbrev, j.overall), traits: assignTraits(juniorAbbrev),  // D5: a full citizen of the attr model
  };
  if (career.driverPts) career.driverPts[juniorAbbrev] = career.driverPts[juniorAbbrev] || 0;  // count in the standings
  career.academy.splice(ji, 1);                                     // leaves the academy
  return true;
}

// test-driver R&D benefit: each academy junior contributes a development bonus; the reserve more.
export function reserveBonus(isReserve) { return isReserve ? 0.06 : 0.04; }
export function academyDevBonus(career) {
  return (career.academy || []).reduce((s, j) => s + reserveBonus(j.abbrev === career.reserve), 0);
}
