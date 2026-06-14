// ApexWeb/src/academy.js — pure young-driver academy: scout juniors (off-grid), develop them in
// your program, promote a ready one into a race seat (injects into the driver registry).
const clampOverall = v => Math.max(0.50, Math.min(0.99, v));

export const SUPERLICENSE = 0.78;   // overall needed to promote a junior to a race seat
export const SCOUT_FEE = 800;       // $k to sign a junior into the academy

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
  career.academy.push({ ...j });     // clone so the pool stays pristine
  return true;
}

// develop academy juniors one season: they close a chunk of the gap to their potential.
export function developAcademy(career) {
  for (const j of (career.academy || [])) {
    j.age += 1;
    j.overall = clampOverall(j.overall + Math.max(0, (j.potential - j.overall) * 0.35));
  }
}

// promote a ready junior into a race seat, retiring the player driver `outAbbrev`. Returns true if applied.
export function promoteJunior(career, juniorAbbrev, outAbbrev) {
  const ji = (career.academy || []).findIndex(j => j.abbrev === juniorAbbrev);
  if (ji < 0) return false;
  const j = career.academy[ji];
  if (j.overall < SUPERLICENSE) return false;                       // superlicense gate
  const out = career.drivers[outAbbrev];
  if (!out || out.teamIdx !== career.teamIdx) return false;          // must drop one of your own
  delete career.drivers[outAbbrev];                                  // the veteran retires off the grid
  career.drivers[juniorAbbrev] = {
    teamIdx: career.teamIdx, age: j.age, overall: j.overall, morale: 0.7,
    contractSeasons: 3, salary: 200, name: j.name,                   // cheap rookie salary; name for the roster
  };
  if (career.driverPts) career.driverPts[juniorAbbrev] = career.driverPts[juniorAbbrev] || 0;  // count in the standings
  career.academy.splice(ji, 1);                                     // leaves the academy
  return true;
}

// test-driver R&D benefit: each academy junior contributes a small development bonus.
export function academyDevBonus(career) {
  return (career.academy || []).length * 0.04;   // +4% dev per junior testing parts
}
