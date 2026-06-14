// ApexWeb/src/career.js — pure career/season state: calendar, standings, prize money, board
// objective. No UI, no I/O. M1 evolves only meta state (the sim is untouched). Deterministic.
import { TEAMS } from "./data.js";
import { defaultSponsors, titleOffers, evaluateSponsor } from "./sponsors.js";
import { tickDevelopment } from "./development.js";
import { initDrivers, developDrivers, updateMorale } from "./drivers.js";
import { initStaff, upkeep } from "./staff.js";

// championship points for the top 10 finishers (current F1 system).
export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
// prize money ($k) by race-finish position — a simple per-race payout (M2 deepens income).
export const PRIZE = [1200, 1000, 850, 720, 620, 540, 470, 410, 360, 320, 280, 250, 220, 200, 180, 160, 150, 140, 130, 120, 110, 100];

export const CAREER_V = 5;            // career save schema version
export const RUNNING_COST = 800;      // $k per-race operating cost (M5 facilities refine it)

// the season calendar: each round picks a real circuit shape (a track_shapes.js key) for the
// visual + geometry, plus the sim characteristics. overtake_zones auto-derive from `ot` in
// track_build.careerTrack() unless a round provides `zones`.
export const CALENDAR = [
  { name: "Гран-при Бахрейна",          shape: "Бахрейн",      laps: 57, lt: 91,  pit: 22.0, df: 0.55, pw: 0.70, ot: 0.55, sc: 0.30, wet: 0.05 },
  { name: "Гран-при Саудовской Аравии", shape: "Джидда",       laps: 50, lt: 90,  pit: 19.5, df: 0.40, pw: 0.80, ot: 0.50, sc: 0.55, wet: 0.05 },
  { name: "Гран-при Австралии",         shape: "Мельбурн",     laps: 58, lt: 80,  pit: 20.0, df: 0.55, pw: 0.60, ot: 0.45, sc: 0.45, wet: 0.25 },
  { name: "Гран-при Японии",            shape: "Сузука",       laps: 53, lt: 91,  pit: 22.0, df: 0.85, pw: 0.45, ot: 0.35, sc: 0.30, wet: 0.35 },
  { name: "Гран-при Майами",            shape: "Майами",       laps: 57, lt: 89,  pit: 19.0, df: 0.50, pw: 0.65, ot: 0.55, sc: 0.40, wet: 0.20 },
  { name: "Гран-при Эмилии-Романьи",    shape: "Имола",        laps: 63, lt: 78,  pit: 26.0, df: 0.70, pw: 0.55, ot: 0.20, sc: 0.40, wet: 0.25 },
  { name: "Гран-при Монако",            shape: "Монако",       laps: 78, lt: 73,  pit: 22.0, df: 0.95, pw: 0.30, ot: 0.05, sc: 0.55, wet: 0.30 },
  { name: "Гран-при Испании",           shape: "Барселона",    laps: 66, lt: 80,  pit: 23.5, df: 0.82, pw: 0.55, ot: 0.30, sc: 0.25, wet: 0.30 },
  { name: "Гран-при Канады",            shape: "Монреаль",     laps: 70, lt: 74,  pit: 18.0, df: 0.45, pw: 0.70, ot: 0.55, sc: 0.55, wet: 0.35 },
  { name: "Гран-при Австрии",           shape: "Шпильберг",    laps: 71, lt: 67,  pit: 20.0, df: 0.45, pw: 0.70, ot: 0.60, sc: 0.40, wet: 0.40 },
  { name: "Гран-при Великобритании",    shape: "Сильверстоун", laps: 52, lt: 88,  pit: 21.0, df: 0.75, pw: 0.60, ot: 0.50, sc: 0.40, wet: 0.45 },
  { name: "Гран-при Бельгии",           shape: "Спа",          laps: 44, lt: 105, pit: 19.0, df: 0.55, pw: 0.75, ot: 0.65, sc: 0.45, wet: 0.55 },
  { name: "Гран-при Венгрии",           shape: "Хунгароринг",  laps: 70, lt: 78,  pit: 21.0, df: 0.88, pw: 0.40, ot: 0.20, sc: 0.35, wet: 0.30 },
  { name: "Гран-при Нидерландов",       shape: "Зандворт",     laps: 72, lt: 72,  pit: 21.0, df: 0.80, pw: 0.50, ot: 0.30, sc: 0.40, wet: 0.40 },
  { name: "Гран-при Италии",            shape: "Монца",        laps: 53, lt: 81,  pit: 24.0, df: 0.20, pw: 0.95, ot: 0.70, sc: 0.35, wet: 0.25 },
  { name: "Гран-при Азербайджана",      shape: "Баку",         laps: 51, lt: 103, pit: 19.0, df: 0.35, pw: 0.85, ot: 0.55, sc: 0.60, wet: 0.15 },
  { name: "Гран-при Сингапура",         shape: "Сингапур",     laps: 62, lt: 96,  pit: 28.0, df: 0.90, pw: 0.40, ot: 0.20, sc: 0.75, wet: 0.35 },
  { name: "Гран-при США",               shape: "Остин",        laps: 56, lt: 96,  pit: 21.0, df: 0.65, pw: 0.65, ot: 0.55, sc: 0.45, wet: 0.30 },
  { name: "Гран-при Мексики",           shape: "Мехико",       laps: 71, lt: 78,  pit: 21.0, df: 0.55, pw: 0.55, ot: 0.45, sc: 0.45, wet: 0.25 },
  { name: "Гран-при Бразилии",          shape: "Интерлагос",   laps: 71, lt: 71,  pit: 20.0, df: 0.60, pw: 0.65, ot: 0.60, sc: 0.50, wet: 0.55 },
  { name: "Гран-при Лас-Вегаса",        shape: "Лас-Вегас",    laps: 50, lt: 95,  pit: 19.0, df: 0.30, pw: 0.85, ot: 0.65, sc: 0.55, wet: 0.10 },
  { name: "Гран-при Катара",            shape: "Лусаил",       laps: 57, lt: 83,  pit: 23.0, df: 0.80, pw: 0.50, ot: 0.35, sc: 0.35, wet: 0.05 },
  { name: "Гран-при Абу-Даби",          shape: "Яс-Марина",    laps: 58, lt: 86,  pit: 21.0, df: 0.60, pw: 0.60, ot: 0.40, sc: 0.40, wet: 0.05 },
];

function allDrivers() { return TEAMS.flatMap(t => t.drivers.map(d => ({ abbrev: d.abbrev, team: t.name }))); }

// a fresh career. teamIdx = which TEAMS entry the players manage; seed reserved for AI RNG.
export function newCareer({ teamIdx = 0, seed = 1, coop = false } = {}) {
  const driverPts = {}, teamPts = {};
  for (const d of allDrivers()) driverPts[d.abbrev] = 0;
  for (const t of TEAMS) teamPts[t.name] = 0;
  const s = seed >>> 0;
  return {
    v: CAREER_V, seed: s, teamIdx, coop,
    season: 1, round: 0, money: 3000 + (TEAMS.length - teamIdx) * 800,   // tier-scaled starting budget ($k)
    driverPts, teamPts,
    board: { targetPos: Math.min(TEAMS.length, teamIdx + 1) },  // meet your tier (P{teamIdx+1})
    sponsors: defaultSponsors(teamIdx, s), costCap: false, pendingOffers: titleOffers(teamIdx, s),
    carDev: {}, project: null, devSpentThisSeason: 0,
    drivers: initDrivers(),
    staff: initStaff(TEAMS[teamIdx].facility, s),
    lastResult: null, history: [], done: false,
  };
}

export function currentRound(career) { return CALENDAR[career.round]; }
export function isSeasonOver(career) { return career.round >= CALENDAR.length; }

// award points + book the race ledger (prize + sponsor income − running cost). classification =
// finishing order [{abbrev, team, retired}] (index 0 = winner). Mutates career; returns a summary.
export function applyResult(career, classification) {
  const podium = [];
  let prize = 0, teamPts = 0, bestPos = 99;
  const myTeam = TEAMS[career.teamIdx].name;
  const bestByTeam = {};
  classification.forEach((c, i) => {
    const pts = i < POINTS.length ? POINTS[i] : 0;
    if (career.driverPts[c.abbrev] != null) career.driverPts[c.abbrev] += pts;
    if (career.teamPts[c.team] != null) career.teamPts[c.team] += pts;
    if (i < 3) podium.push(c.abbrev);
    if (bestByTeam[c.team] == null) bestByTeam[c.team] = i + 1;
    if (c.team === myTeam) { prize += (i < PRIZE.length ? PRIZE[i] : 100); teamPts += pts; bestPos = Math.min(bestPos, i + 1); }
  });
  // teams my best car beat (their best car finished behind mine)
  const beat = new Set();
  for (const tname in bestByTeam) if (tname !== myTeam && bestByTeam[myTeam] < bestByTeam[tname]) beat.add(tname);
  const sCtx = { bestPos, points: teamPts, beat };
  let sponsorIncome = 0;
  for (const sp of (career.sponsors || [])) {
    const r = evaluateSponsor(sp, sCtx);
    sponsorIncome += r.payout;
    sp.happiness = Math.max(0, Math.min(1, sp.happiness + r.dHappiness));
  }
  // driver morale (whole field) from finish vs the team-tier expectation; salaries (player team) as expense.
  let salaries = 0;
  classification.forEach((c, i) => {
    const dr = career.drivers && career.drivers[c.abbrev];
    if (!dr) return;
    updateMorale(dr, i + 1, 2 + dr.teamIdx * 2);   // a 2-car expectation band (lead + teammate), so the #2 isn't perma-unhappy
    if (dr.teamIdx === career.teamIdx) salaries += dr.salary;
  });
  const up = upkeep(career.staff);
  const net = prize + sponsorIncome - RUNNING_COST - salaries - up;
  career.money += net;
  const summary = {
    round: career.round, gp: CALENDAR[career.round].name, podium, bestPos,
    prize, sponsorIncome, runningCost: RUNNING_COST, salaries, upkeep: up, net,
    classification: classification.map((c, i) => ({ pos: i + 1, abbrev: c.abbrev, team: c.team, retired: !!c.retired })),
  };
  career.lastResult = summary;
  career.history.push(summary);
  return summary;
}

// upgrade an older save in place to the current schema.
export function migrate(career) {
  if (!career) return career;
  if (career.v < 2) {
    career.sponsors = career.sponsors || defaultSponsors(career.teamIdx, career.seed || 1);
    career.costCap = career.costCap ?? false;
    career.pendingOffers = career.pendingOffers || [];
    career.v = 2;
  }
  if (career.v < 3) {
    career.carDev = career.carDev || {};
    career.project = career.project ?? null;
    career.devSpentThisSeason = career.devSpentThisSeason ?? 0;
    career.v = 3;
  }
  if (career.v < 4) {
    career.drivers = career.drivers || initDrivers();
    career.v = 4;
  }
  if (career.v < 5) {
    career.staff = career.staff || initStaff((TEAMS[career.teamIdx] || TEAMS[0]).facility, career.seed || 1);
    career.v = 5;
  }
  return career;
}
// accept a season-start title-sponsor offer: replace the title deal, clear the offers.
export function chooseTitleSponsor(career, offerIdx) {
  const chosen = career.pendingOffers && career.pendingOffers[offerIdx];
  if (!chosen) return;
  const secondaries = (career.sponsors || []).filter(s => s.kind !== "title");
  career.sponsors = [{ ...chosen, kind: "title" }, ...secondaries];
  career.pendingOffers = [];
}
export { reSign } from "./drivers.js";

// advance to the next round. Returns true if a next round exists, false if the season ended.
export function advanceRound(career) {
  tickDevelopment(career);          // progress the player project + AI dev for the round just completed
  career.round += 1;
  if (isSeasonOver(career)) { career.done = true; return false; }
  return true;
}

export function constructorStandings(career) {
  return TEAMS.map((t, i) => ({ team: t.name, color: t.color, pts: career.teamPts[t.name], isPlayer: i === career.teamIdx }))
    .sort((a, b) => b.pts - a.pts).map((r, i) => ({ ...r, pos: i + 1 }));
}
export function driverStandings(career) {
  const info = {}; for (const d of allDrivers()) info[d.abbrev] = d.team;
  return Object.keys(career.driverPts).map(a => ({ abbrev: a, team: info[a], pts: career.driverPts[a] }))
    .sort((a, b) => b.pts - a.pts).map((r, i) => ({ ...r, pos: i + 1 }));
}
export function boardOutcome(career) {
  const standings = constructorStandings(career);
  const me = standings.find(s => s.isPlayer);
  return { finalPos: me ? me.pos : TEAMS.length, target: career.board.targetPos, met: me ? me.pos <= career.board.targetPos : false };
}
// start a new season: reset round + points, keep team + money + seed, bump the season number.
export function newSeason(career) {
  const fresh = newCareer({ teamIdx: career.teamIdx, seed: career.seed, coop: career.coop });
  fresh.season = career.season + 1;
  fresh.money = career.money;
  // deep-copy carried state so the prior season's career object stays immutable
  fresh.carDev = JSON.parse(JSON.stringify(career.carDev || {}));   // development carries over (M8 adds regulation resets)
  fresh.devSpentThisSeason = 0;
  fresh.drivers = JSON.parse(JSON.stringify(career.drivers || initDrivers()));
  developDrivers(fresh.drivers);             // age up, develop/decline, tick contracts
  fresh.staff = JSON.parse(JSON.stringify(career.staff || initStaff((TEAMS[career.teamIdx] || TEAMS[0]).facility, career.seed || 1)));
  return fresh;
}
