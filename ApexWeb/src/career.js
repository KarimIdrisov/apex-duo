// ApexWeb/src/career.js — pure career/season state: calendar, standings, prize money, board
// objective. No UI, no I/O. M1 evolves only meta state (the sim is untouched). Deterministic.
import { TEAMS } from "./data.js";
import { defaultSponsors, titleOffers, evaluateSponsor } from "./sponsors.js";
import { tickDevelopment } from "./development.js";
import { initDrivers, developDrivers, updateMorale } from "./drivers.js";
import { driverAttrs, assignTraits } from "./team.js";
import { initStaff, upkeep, salaryForStaff } from "./staff.js";
import { aiChurn } from "./market.js";
import { developAcademy } from "./academy.js";
import { pushNews, boardReaction, confidenceDelta } from "./news.js";
import { seasonObjectives, evaluateObjectives, regResetFor, regArcNote } from "./board.js";

// championship points for the top 10 finishers (current F1 system).
export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
// prize money ($k) by race-finish position — a simple per-race payout (M2 deepens income).
export const PRIZE = [1200, 1000, 850, 720, 620, 540, 470, 410, 360, 320, 280, 250, 220, 200, 180, 160, 150, 140, 130, 120, 110, 100];

export const CAREER_V = 12;           // career save schema version
export const REG_RESET = 0.5;         // each season's regulation change trims everyone's car development
export const RUNNING_COST = 800;      // $k per-race operating cost (M5 facilities refine it)

// the season calendar: each round picks a real circuit shape (a track_shapes.js key) for the
// visual + geometry, plus the sim characteristics. lt/pit/pw/df/ot are BAKED from real FastF1 2024
// data (tools/track_constants_2024.json, owner's extractor). laps are real counts; sc/wet stay
// estimated; COMPOUNDS stay manual (FastF1 can't isolate tyre pace). overtake_zones auto-derive
// from the real `ot` in track_build.careerTrack() unless a round provides `zones`. (D1)
export const CALENDAR = [
  { name: "Гран-при Бахрейна",          shape: "Бахрейн",      laps: 57, lt: 95.7,  pit: 25.3, df: 0.22, pw: 0.51, ot: 0.29, sc: 0.30, wet: 0.05 },
  { name: "Гран-при Саудовской Аравии", shape: "Джидда",       laps: 50, lt: 92.9,  pit: 19.9, df: 0.82, pw: 0.71, ot: 0.29, sc: 0.55, wet: 0.05 },
  { name: "Гран-при Австралии",         shape: "Мельбурн",     laps: 58, lt: 81.5,  pit: 20.7, df: 0.73, pw: 0.64, ot: 0.10, sc: 0.45, wet: 0.25 },
  { name: "Гран-при Японии",            shape: "Сузука",       laps: 53, lt: 95.9,  pit: 23.3, df: 0.93, pw: 0.59, ot: 0.57, sc: 0.30, wet: 0.35 },
  { name: "Гран-при Майами",            shape: "Майами",       laps: 57, lt: 92.1,  pit: 23.4, df: 0.50, pw: 0.82, ot: 0.31, sc: 0.40, wet: 0.20 },
  { name: "Гран-при Эмилии-Романьи",    shape: "Имола",        laps: 63, lt: 80.9,  pit: 28.2, df: 0.41, pw: 0.85, ot: 0.29, sc: 0.40, wet: 0.25 },
  { name: "Гран-при Монако",            shape: "Монако",       laps: 78, lt: 77.9,  pit: 18.4, df: 0.83, pw: 0.00, ot: 0.00, sc: 0.55, wet: 0.30 },
  { name: "Гран-при Испании",           shape: "Барселона",    laps: 66, lt: 79.5,  pit: 23.4, df: 0.86, pw: 0.61, ot: 0.54, sc: 0.25, wet: 0.30 },
  { name: "Гран-при Канады",            shape: "Монреаль",     laps: 70, lt: 80.0,  pit: 20.6, df: 0.02, pw: 0.66, ot: 0.52, sc: 0.55, wet: 0.35 },
  { name: "Гран-при Австрии",           shape: "Шпильберг",    laps: 71, lt: 70.4,  pit: 21.4, df: 0.43, pw: 0.59, ot: 0.30, sc: 0.40, wet: 0.40 },
  { name: "Гран-при Великобритании",    shape: "Сильверстоун", laps: 52, lt: 91.1,  pit: 31.4, df: 0.88, pw: 0.61, ot: 0.40, sc: 0.40, wet: 0.45 },
  { name: "Гран-при Бельгии",           shape: "Спа",          laps: 44, lt: 107.8, pit: 20.4, df: 0.45, pw: 0.51, ot: 0.32, sc: 0.45, wet: 0.55 },
  { name: "Гран-при Венгрии",           shape: "Хунгароринг",  laps: 70, lt: 83.1,  pit: 20.7, df: 0.62, pw: 0.41, ot: 0.32, sc: 0.35, wet: 0.30 },
  { name: "Гран-при Нидерландов",       shape: "Зандворт",     laps: 72, lt: 75.1,  pit: 24.3, df: 1.00, pw: 0.67, ot: 0.38, sc: 0.40, wet: 0.40 },
  { name: "Гран-при Италии",            shape: "Монца",        laps: 53, lt: 83.6,  pit: 26.9, df: 0.21, pw: 0.97, ot: 0.50, sc: 0.35, wet: 0.25 },
  { name: "Гран-при Азербайджана",      shape: "Баку",         laps: 51, lt: 107.8, pit: 22.8, df: 0.00, pw: 0.84, ot: 0.71, sc: 0.60, wet: 0.15 },
  { name: "Гран-при Сингапура",         shape: "Сингапур",     laps: 62, lt: 97.7,  pit: 30.4, df: 0.20, pw: 0.41, ot: 0.22, sc: 0.75, wet: 0.35 },
  { name: "Гран-при США",               shape: "Остин",        laps: 56, lt: 98.8,  pit: 22.1, df: 0.76, pw: 0.64, ot: 0.58, sc: 0.45, wet: 0.30 },
  { name: "Гран-при Мексики",           shape: "Мехико",       laps: 71, lt: 81.1,  pit: 24.0, df: 0.14, pw: 1.00, ot: 0.43, sc: 0.45, wet: 0.25 },
  { name: "Гран-при Бразилии",          shape: "Интерлагос",   laps: 71, lt: 82.7,  pit: 26.4, df: 0.28, pw: 0.33, ot: 0.61, sc: 0.50, wet: 0.55 },
  { name: "Гран-при Лас-Вегаса",        shape: "Лас-Вегас",    laps: 50, lt: 97.2,  pit: 23.4, df: 0.24, pw: 0.97, ot: 1.00, sc: 0.55, wet: 0.10 },
  { name: "Гран-при Катара",            shape: "Лусаил",       laps: 57, lt: 84.6,  pit: 27.1, df: 0.87, pw: 0.59, ot: 0.46, sc: 0.35, wet: 0.05 },
  { name: "Гран-при Абу-Даби",          shape: "Яс-Марина",    laps: 58, lt: 88.5,  pit: 24.2, df: 0.48, pw: 0.59, ot: 0.42, sc: 0.40, wet: 0.05 },
];

function allDrivers() { return TEAMS.flatMap(t => t.drivers.map(d => ({ abbrev: d.abbrev, team: t.name }))); }

// a fresh career. teamIdx = which TEAMS entry the players manage; seed reserved for AI RNG.
export function newCareer({ teamIdx = 0, seed = 1, coop = false } = {}) {
  const driverPts = {}, teamPts = {};
  for (const d of allDrivers()) driverPts[d.abbrev] = 0;
  for (const t of TEAMS) teamPts[t.name] = 0;
  const s = seed >>> 0;
  const targetPos = Math.min(TEAMS.length, teamIdx + 1);
  return {
    v: CAREER_V, seed: s, teamIdx, coop,
    season: 1, round: 0, money: 3000 + (TEAMS.length - teamIdx) * 800,   // tier-scaled starting budget ($k)
    driverPts, teamPts,
    board: { targetPos, confidence: 0.5, podiums: 0, pointFinishes: 0, objectives: seasonObjectives(targetPos) },  // meet your tier (P{teamIdx+1}) + season objectives (D8)
    sponsors: defaultSponsors(teamIdx, s), costCap: false, pendingOffers: titleOffers(teamIdx, s),
    parts: {}, project: null, devSpentThisSeason: 0,
    drivers: initDrivers(),
    staff: initStaff(TEAMS[teamIdx].facility, s),
    academy: [], reserve: null,
    news: [],
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
  career.board.confidence = Math.max(0, Math.min(1, (career.board.confidence ?? 0.5) + confidenceDelta(bestPos, career.board.targetPos)));
  pushNews(career, boardReaction(bestPos, career.board.targetPos, summary.gp));
  if (bestPos <= 3) career.board.podiums = (career.board.podiums || 0) + 1;          // D8: objective counters
  if (bestPos <= 10) career.board.pointFinishes = (career.board.pointFinishes || 0) + 1;
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
  if (career.v < 6) {
    career.academy = career.academy || [];
    career.v = 6;
  }
  if (career.v < 7) {
    if (career.board) career.board.confidence = career.board.confidence ?? 0.5;
    career.news = career.news || [];
    career.v = 7;
  }
  if (career.v < 8) {
    career.parts = career.parts || {};   // parts replace the old carDev deltas (dev reset on upgrade; regs reset anyway)
    delete career.carDev;
    career.v = 8;
  }
  if (career.v < 9) {
    for (const a in (career.drivers || {})) {           // D5: backfill the persistent attr vector + traits
      const dr = career.drivers[a];
      if (!dr.attrs) { dr.attrs = driverAttrs(a, dr.overall); dr.traits = assignTraits(a); }
    }
    career.v = 9;
  }
  if (career.v < 10) {
    if (career.staff && !career.staff.people) {          // D6: backfill named staff from the current scalars
      const mk = r => ({ name: "—", specialty: null, rating: career.staff[r], salary: salaryForStaff(career.staff[r]) });
      career.staff.people = { designer: mk("designer"), strategist: mk("strategist"), pitCrew: mk("pitCrew") };
    }
    career.v = 10;
  }
  if (career.v < 11) {
    for (const j of (career.academy || [])) { if (j.slPoints == null) { j.slPoints = 0; j.series = j.series || "F2"; } }   // D7: feeder state
    career.reserve = career.reserve ?? null;
    career.v = 11;
  }
  if (career.v < 12) {
    if (career.board && !career.board.objectives) {     // D8: season objectives + counters
      career.board.objectives = seasonObjectives(career.board.targetPos);
      career.board.podiums = career.board.podiums || 0; career.board.pointFinishes = career.board.pointFinishes || 0;
    }
    career.v = 12;
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
  const finalPos = me ? me.pos : TEAMS.length;
  const target = career.board.targetPos;
  const met = me ? finalPos <= target : false;
  const confidence = career.board.confidence ?? 0.5;
  return { finalPos, target, met, confidence, sacked: !met && confidence < 0.25, objectives: evaluateObjectives(career) };
}
// start a new season: reset round + points, keep team + money + seed, bump the season number.
export function newSeason(career) {
  const fresh = newCareer({ teamIdx: career.teamIdx, seed: career.seed, coop: career.coop });
  fresh.season = career.season + 1;
  fresh.money = career.money;
  // deep-copy carried state so the prior season's career object stays immutable
  fresh.parts = JSON.parse(JSON.stringify(career.parts || {}));     // part development carries over (regs reset below)
  fresh.devSpentThisSeason = 0;
  fresh.drivers = JSON.parse(JSON.stringify(career.drivers || initDrivers()));
  developDrivers(fresh.drivers);             // age up, develop/decline, tick contracts
  aiChurn(fresh, (fresh.seed >>> 0) + fresh.season * 2246822519);   // deterministic AI silly-season
  fresh.staff = JSON.parse(JSON.stringify(career.staff || initStaff((TEAMS[career.teamIdx] || TEAMS[0]).facility, career.seed || 1)));
  fresh.academy = JSON.parse(JSON.stringify(career.academy || []));
  developAcademy(fresh, fresh.season);         // D7: juniors race a feeder season (SL points + dev by results)
  const reg = regResetFor(fresh.season);                       // D8: regulation arc — a big shake-up on a cycle
  for (const tn in fresh.parts) for (const k in fresh.parts[tn]) fresh.parts[tn][k] *= reg;            // regs change: redevelop parts
  fresh.board.confidence = career.board.confidence ?? 0.5;     // confidence carries between seasons
  fresh.board.objectives = seasonObjectives(fresh.board.targetPos); fresh.board.podiums = 0; fresh.board.pointFinishes = 0;   // D8: new season's objectives
  pushNews(fresh, regArcNote(fresh.season));                   // D8: telegraph the regulation cadence
  pushNews(fresh, `Сезон ${fresh.season}: смена регламента — разработка частично обнулена.`);
  return fresh;
}
