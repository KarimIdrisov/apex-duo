// ApexWeb/src/career.js — pure career/season state: calendar, standings, prize money, board
// objective. No UI, no I/O. M1 evolves only meta state (the sim is untouched). Deterministic.
import { TEAMS } from "./data.js";
import { backerFor } from "./backers.js";
import { suitorOffer, parentPullout, moneyEvent, gridChurn } from "./team_events.js";
import { defaultSponsors, titleOffers, evaluateSponsor, replacementSponsor } from "./sponsors.js";
import { tickDevelopment, SUPPLY_INCOME, SUPPLY_FEE, runInParts, PU_POOL, PU_GRID_PEN, puWearForRace } from "./development.js";
import { gapDays, offseasonDays } from "./season_dates.js";
import { initDrivers, developDrivers, updateMorale, tickDriverRace, makeDriverRequest, maybeGainTrait, zeroDriverStats, salaryFor, DRIVER_NAME } from "./drivers.js";
import { driverAttrs, assignTraits, TRAITS } from "./team.js";
import { initStaff, upkeep, salaryForStaff, applyCalendarLoad, initTeamStaff, tickStaffTrain, tickFacility, FAC_LABEL, STAFF_ROLES, ROLE_LABEL } from "./staff.js";
import { mix32 } from "./rng.js";
import { aiChurn } from "./market.js";
import { developAcademy } from "./academy.js";
import { pushNews, boardReaction, confidenceDelta } from "./news.js";
import { seasonObjectives, evaluateObjectives, regResetFor, regArcNote } from "./board.js";

// championship points for the top 10 finishers (current F1 system).
export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
// prize money ($k) by race-finish position — a simple per-race payout (M2 deepens income).
export const PRIZE = [1200, 1000, 850, 720, 620, 540, 470, 410, 360, 320, 280, 250, 220, 200, 180, 160, 150, 140, 130, 120, 110, 100];

export const CAREER_V = 24;           // career save schema version
export const REG_RESET = 0.5;         // each season's regulation change trims everyone's car development
export const RUNNING_COST = 800;      // $k per-race operating cost (M5 facilities refine it)
export const CAP_LIMIT = 22000;       // $k — soft season cap on discretionary spend (dev + staff + transfers)
export const LOAN_INTEREST = 0.18;    // total interest on a loan, repaid over LOAN_RACES
export const LOAN_RACES = 8;
// season-end Constructors' Cup prize fund ($k) by final championship position (1-based). FLAT, like
// real F1: last gets ~43% of first (~2.3× spread) — deliberately anti-runaway, not top-heavy.
export const PRIZE_FUND_BASE = 16000;   // P1 payout ($k); last ≈ 0.43× this
export function constructorPrizeFund(pos, teams = 11) {
  const N = Math.max(2, teams), p = Math.max(1, Math.min(N, pos | 0));
  return Math.round(PRIZE_FUND_BASE * (0.43 + 0.57 * (N - p) / (N - 1)));
}
// book a discretionary spend against the season cost cap (dev/staff/transfers call this).
export function bookSpend(career, cost) { if (career && cost > 0) career.capSpent = (career.capSpent || 0) + cost; }
// take a loan: cash now, repaid with interest over LOAN_RACES via applyResult. One active loan at a time.
export function takeLoan(career, amount) {
  if (!career || career.loan || !(amount > 0)) return false;
  const total = Math.round(amount * (1 + LOAN_INTEREST));
  career.money += amount;
  career.loan = { borrowed: amount, total, remaining: total, perRace: Math.ceil(total / LOAN_RACES) };
  return true;
}

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
    parts: {}, projects: [], unproven: [], devSpentThisSeason: 0,   // E1: parallel projects + run-in debts
    devFocus: 0, nextCar: {},                                       // F1: this/next-year development split

    concept: "balanced",                                            // E3 car concept
    pu: { pool: PU_POOL, used: 1, wear: 0, penalty: 0 }, aiPu: {},   // E4 PU season allocation · E9 AI PU pools
    capSpent: 0, loan: null, seasonPayout: null, sponsorOffer: null,
    backer: backerFor(TEAMS[teamIdx].name),    // funding archetype (works/independent + grant + PU)
    puParts: { power: 0, eff: 0, rel: 0 }, puProject: null, puProgram: null,   // engine program (Phase B)
    acquisitionOffer: null, identity: null, gridBoost: {},                     // events (Phase C)
    drivers: initDrivers(),
    staff: initStaff(TEAMS[teamIdx].facility, s),
    teamStaff: initTeamStaff(TEAMS.map(t => ({ name: t.name, facility: t.facility })), s),   // T1 named staff in every team
    staffTrain: {}, facilityProject: null, _myTeamName: TEAMS[teamIdx].name,                  // T3 training · T4 construction
    academy: [], reserve: null,
    news: [],
    lastResult: null, history: [], done: false,
  };
}

export function currentRound(career) { return CALENDAR[career.round]; }
export function isSeasonOver(career) { return career.round >= CALENDAR.length; }

// award points + book the race ledger (prize + sponsor income − running cost). classification =
// finishing order [{abbrev, team, retired}] (index 0 = winner). Mutates career; returns a summary.
export function applyResult(career, classification, raceInfo = {}) {
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
  // living sponsors: a deal whose happiness collapses walks away; a fresh offer surfaces to refill a slot.
  const leavers = (career.sponsors || []).filter(s => s.happiness < 0.16);
  if (leavers.length) {
    career.sponsors = (career.sponsors || []).filter(s => s.happiness >= 0.16);
    for (const s of leavers) pushNews(career, `Спонсор ${s.name} разорвал контракт — низкое довольство.`);
  }
  if (!career.sponsorOffer && (career.sponsors || []).length < 3) career.sponsorOffer = replacementSponsor(career.teamIdx, (career.seed >>> 0) + career.round * 7919);
  // driver morale (whole field) from finish vs the team-tier expectation; salaries (player team) as expense.
  // Player drivers get the richer per-race tick (G1 stats + G2 in-season training + G3 form/morale).
  let salaries = 0;
  const playerRes = [];
  classification.forEach((c, i) => {
    const dr = career.drivers && career.drivers[c.abbrev];
    if (!dr) return;
    if (dr.teamIdx === career.teamIdx) {
      salaries += dr.salary;
      playerRes.push({ abbrev: c.abbrev, dr, finishPos: i + 1, start: (raceInfo.starts && raceInfo.starts[c.abbrev]) || null, retired: !!c.retired, points: i < POINTS.length ? POINTS[i] : 0, expectedPos: 2 + dr.teamIdx * 2 });
    } else {
      updateMorale(dr, i + 1, 2 + dr.teamIdx * 2);   // AI: cheap morale only
    }
  });
  if (playerRes.length) {
    const keyOf = r => r.retired ? 99 + r.finishPos : r.finishPos;     // retired counts behind any finisher
    const pair = playerRes.length === 2;
    const raceAhead = pair ? (keyOf(playerRes[0]) <= keyOf(playerRes[1]) ? playerRes[0].abbrev : playerRes[1].abbrev) : null;
    const qAhead = (pair && playerRes[0].start && playerRes[1].start) ? (playerRes[0].start <= playerRes[1].start ? playerRes[0].abbrev : playerRes[1].abbrev) : null;
    for (const r of playerRes) {
      const beatTeammate = pair ? (r.abbrev === raceAhead) : null;
      tickDriverRace(r.dr, { finishPos: r.finishPos, expectedPos: r.expectedPos, retired: r.retired, points: r.points, isPole: r.start === 1, beatTeammate });
      if (qAhead === r.abbrev) r.dr.stats.qH2H += 1;
      const req = makeDriverRequest(r.dr, r.abbrev);
      if (req && !r.dr._reqNewsed) { pushNews(career, `💬 ${req.text}`); r.dr._reqNewsed = true; }
    }
  }
  const up = upkeep(career.staff);
  const loanPay = (career.loan && career.loan.remaining > 0) ? Math.min(career.loan.perRace, career.loan.remaining) : 0;
  const grant = career.backer ? Math.round((career.backer.grant || 0) / CALENDAR.length) : 0;   // parent/owner funding floor (per race)
  const supply = career.backer ? (career.backer.puMaker ? SUPPLY_INCOME : -SUPPLY_FEE) : 0;       // PU-maker sells engines (+) / customer buys (−)
  const net = prize + grant + supply + sponsorIncome - RUNNING_COST - salaries - up - loanPay;
  career.money += net;
  if (career.loan) { career.loan.remaining -= loanPay; if (career.loan.remaining <= 0.5) { career.loan = null; pushNews(career, "Кредит полностью погашен."); } }
  const summary = {
    round: career.round, gp: CALENDAR[career.round].name, podium, bestPos,
    prize, grant, supply, sponsorIncome, runningCost: RUNNING_COST, salaries, upkeep: up, loanPay, net, money: career.money,
    classification: classification.map((c, i) => ({ pos: i + 1, abbrev: c.abbrev, team: c.team, retired: !!c.retired })),
  };
  career.board.confidence = Math.max(0, Math.min(1, (career.board.confidence ?? 0.5) + confidenceDelta(bestPos, career.board.targetPos)));
  pushNews(career, boardReaction(bestPos, career.board.targetPos, summary.gp));
  if (bestPos <= 3) career.board.podiums = (career.board.podiums || 0) + 1;          // D8: objective counters
  if (bestPos <= 10) career.board.pointFinishes = (career.board.pointFinishes || 0) + 1;
  const mev = moneyEvent(career, career.round, (career.seed >>> 0) + career.round * 17);   // rare one-off money event
  if (mev) { career.money += mev.delta; pushNews(career, mev.news); summary.event = mev.news; }
  // E1: bed in freshly-fitted parts (decay the run-in reliability debt). E2: regenerate aero/R&D capacity
  // by championship position (trailers test more — honest ATR sliding scale).
  runInParts(career);
  // E4: wear the PU. Power tracks stress it; developed PU reliability spares it. Spending a unit beyond
  // the season pool draws a grid penalty next race.
  if (career.pu) {
    const trk = CALENDAR[career.round] || {};
    const puRel = (career.puParts && career.puParts.rel) || 0;
    career.pu.wear = (career.pu.wear || 0) + puWearForRace(trk, puRel, raceInfo.pushFrac || 0);
    while (career.pu.wear >= 1) {
      career.pu.wear -= 1;