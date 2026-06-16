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
      career.pu.wear -= 1; career.pu.used = (career.pu.used || 1) + 1;
      if (career.pu.used > career.pu.pool) {
        career.pu.penalty = (career.pu.penalty || 0) + PU_GRID_PEN;
        pushNews(career, `Превышен лимит силовых установок (${career.pu.pool}) — штраф ${PU_GRID_PEN} мест на старте следующей гонки.`);
      } else {
        pushNews(career, `Установлена новая силовая установка (${career.pu.used} из ${career.pu.pool}).`);
      }
    }
    summary.puUsed = career.pu.used; summary.puPool = career.pu.pool;
  }
  // E9: AI teams burn their own PU pool too — weaker facilities wear faster and take grid penalties
  // (surfaced in the news feed; applied at the rival's grid slot in main.startRace).
  career.aiPu = career.aiPu || {};
  const trkAi = CALENDAR[career.round] || {};
  TEAMS.forEach((t, ti) => {
    if (ti === career.teamIdx) return;
    const a = career.aiPu[t.name] || (career.aiPu[t.name] = { used: 1, wear: 0, penalty: 0 });
    const aiPuRel = Math.max(0, Math.min(0.25, ((t.facility ?? 0.75) - 0.6) * 0.5));   // better factory → better reliability
    a.wear += puWearForRace(trkAi, aiPuRel, 0.2);                                       // AI runs a moderate engine load
    while (a.wear >= 1) {
      a.wear -= 1; a.used += 1;
      if (a.used > PU_POOL) { a.penalty = (a.penalty || 0) + PU_GRID_PEN; pushNews(career, `${t.name}: исчерпан лимит ДВС — штраф ${PU_GRID_PEN} мест на старте следующей гонки.`); }
    }
  });
  const trainCost = tickStaffTrain(career);   // T3: staff in training develop, drawing a small per-race cost
  if (trainCost) { career.money -= trainCost; career.capSpent = (career.capSpent || 0) + trainCost; summary.staffTrain = trainCost; }
  career.lastResult = summary;
  career.history.push(summary);
  return summary;
}

// accept a pending buyout offer. rebrand=true → new name+livery. Mutates career; clears the offer.
export function acceptAcquisition(career, rebrand) {
  const o = career.acquisitionOffer; if (!o) return false;
  career.money += o.cash;
  career.backer = { type: "works", puMaker: !!o.puMaker, supplier: career.backer ? career.backer.supplier : null, grant: o.grant, boardProfile: o.type === "sovereign" ? "owner" : "oem" };
  if (career.board) career.board.targetPos = o.target;
  if (rebrand) career.identity = { name: o.newName, color: o.newColor };
  pushNews(career, `${o.suitor} (${o.typeLabel}) выкупил команду — грант $${(o.grant / 1000).toFixed(1)}M/сезон${o.puMaker ? ", свой ДВС" : ""}. Новая цель совета: P${o.target}.`);
  career.acquisitionOffer = null;
  return true;
}
export function declineAcquisition(career) {
  if (!career.acquisitionOffer) return false;
  pushNews(career, `Предложение ${career.acquisitionOffer.suitor} отклонено — команда сохраняет независимость.`);
  career.acquisitionOffer = null;
  return true;
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
  if (career.v < 13) {
    career.capSpent = career.capSpent ?? 0;
    career.loan = career.loan ?? null;
    career.seasonPayout = career.seasonPayout ?? null;
    career.sponsorOffer = career.sponsorOffer ?? null;
    career.v = 13;
  }
  if (career.v < 14) {
    career.backer = career.backer || backerFor((TEAMS[career.teamIdx] || TEAMS[0]).name);
    career.v = 14;
  }
  if (career.v < 15) {
    career.puParts = career.puParts || { power: 0, eff: 0, rel: 0 };
    career.puProject = career.puProject ?? null;
    career.puProgram = career.puProgram ?? null;
    career.v = 15;
  }
  if (career.v < 16) {
    career.acquisitionOffer = career.acquisitionOffer ?? null;
    career.identity = career.identity ?? null;
    career.gridBoost = career.gridBoost || {};
    career.v = 16;
  }
  if (career.v < 17) {
    // calendar/time model: convert in-flight projects from races-left to days-left (~14d/race).
    const mig = p => { if (p && p.daysLeft == null) { const races = p.racesLeft != null ? p.racesLeft : (p.races || 1); p.daysLeft = Math.max(1, Math.round(races * 14)); p.days = p.days || p.daysLeft; delete p.racesLeft; } };
    mig(career.project); mig(career.puProject); mig(career.puProgram);
    career.v = 17;
  }
  if (career.v < 18) {
    // E1/E2/E3: single project → parallel projects[]; run-in debts; aero capacity; car concept.
    career.projects = career.projects || (career.project ? [{ ...career.project, approach: career.project.approach || "balanced" }] : []);
    delete career.project;
    career.unproven = career.unproven || [];
    career.concept = career.concept || "balanced";   // (aero capacity removed in v22)
    career.v = 18;
  }
  if (career.v < 19) {
    career.pu = career.pu || { pool: PU_POOL, used: 1, wear: 0, penalty: 0 };   // E4: PU season allocation
    career.v = 19;
  }
  if (career.v < 20) {
    career.aiPu = career.aiPu || {};   // E9: AI PU pools (lazy per-team)
    career.v = 20;
  }
  if (career.v < 21) {
    career.devFocus = career.devFocus || 0;
    career.nextCar = career.nextCar || {};
    career.v = 21;
  }
  if (career.v < 22) {
    // refactor: drop aero R&D capacity; collapse projects back to a single stage (a build-stage project
    // finishes its remaining build time as plain dev days).
    delete career.aero;
    for (const p of (career.projects || [])) {
      if (p.stage === "build") p.daysLeft = p.buildLeft || 0;
      delete p.stage; delete p.buildLeft; delete p.buildDays; delete p.result;
    }
    career.v = 22;
  }
  if (career.v < 23) {
    for (const a in (career.drivers || {})) { const dr = career.drivers[a];   // G1–G4 driver fields
      dr.training = dr.training ?? null; dr.status = dr.status || "equal"; dr.form = dr.form ?? 0.5;
      dr.stats = dr.stats || zeroDriverStats(); dr.request = dr.request ?? null; }
    career.v = 23;
  }
  if (career.v < 24) {   // T1/T3/T4: living staff — named team staff, training, construction
    career.teamStaff = career.teamStaff || initTeamStaff(TEAMS.map(t => ({ name: t.name, facility: t.facility })), career.seed || 1);
    career.staffTrain = career.staffTrain || {};
    career.facilityProject = career.facilityProject ?? null;
    career._myTeamName = career._myTeamName || (TEAMS[career.teamIdx] || TEAMS[0]).name;
    if (career.staff && career.staff.people) for (const r in career.staff.people) { const p = career.staff.people[r]; if (p && p.contractSeasons == null) p.contractSeasons = 3; }
    career.v = 24;
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

// G2: set a player driver's training focus (null clears it).
export function setDriverTraining(career, abbrev, focus) {
  const dr = career.drivers && career.drivers[abbrev]; if (!dr) return false;
  dr.training = focus || null; return true;
}
// G3: accept/decline a driver's standing request (contract renewal or #1 status).
export function resolveDriverRequest(career, abbrev, accept) {
  const dr = career.drivers && career.drivers[abbrev], req = dr && dr.request; if (!req) return false;
  if (accept) {
    if (req.type === "contract") {
      const fee = dr.salary * 4; if (career.money < fee) return false;
      career.money -= fee; dr.contractSeasons = 3; dr.morale = Math.min(1, (dr.morale || 0.6) + 0.15);
      pushNews(career, `${DRIVER_NAME[abbrev] || abbrev} продлил контракт (+мораль).`);
    } else if (req.type === "lead") {
      dr.status = "lead"; dr.morale = Math.min(1, (dr.morale || 0.6) + 0.12);
      for (const a in career.drivers) { const o = career.drivers[a]; if (a !== abbrev && o.teamIdx === dr.teamIdx) { o.status = "support"; o.morale = Math.max(0, (o.morale || 0.6) - 0.08); } }
      pushNews(career, `${DRIVER_NAME[abbrev] || abbrev} получил статус первого номера.`);
    }
  } else {
    dr.morale = Math.max(0, (dr.morale || 0.6) - 0.12);
    pushNews(career, `Запрос ${DRIVER_NAME[abbrev] || abbrev} отклонён (−мораль).`);
  }
  dr.request = null; dr._reqNewsed = false;
  return true;
}

// advance to the next round. Returns true if a next round exists, false if the season ended.
export function advanceRound(career) {
  const g = gapDays(career.season, career.round);   // calendar days until the next race = the dev window
  tickDevelopment(career, g == null ? 0 : g);        // last round: g=null → winter dev happens in newSeason
  applyCalendarLoad(career.staff, g);                // staff fatigue from the turnaround into the next race
  const facDone = tickFacility(career, g == null ? 0 : g);   // T4: facility construction advances by calendar days
  if (facDone) pushNews(career, `Достроен объект: ${FAC_LABEL[facDone.which]} → уровень ${facDone.level}.`);
  career.round += 1;
  if (isSeasonOver(career)) {
    career.done = true;
    const fin = constructorStandings(career).find(s => s.isPlayer);   // season-end Constructors' Cup prize fund
    const pos = fin ? fin.pos : TEAMS.length;
    const fund = constructorPrizeFund(pos);
    career.money += fund;
    const over = Math.max(0, (career.capSpent || 0) - CAP_LIMIT);     // soft cost-cap: a fine on any season overspend
    const fine = Math.round(over * 0.6);
    if (fine > 0) { career.money -= fine; if (career.board) career.board.confidence = Math.max(0, (career.board.confidence ?? 0.5) - 0.12); }
    career.seasonPayout = { pos, fund, capSpent: career.capSpent || 0, over, fine };
    pushNews(career, `Призовой фонд Кубка конструкторов: P${pos} → +$${(fund / 1000).toFixed(1)}M.`);
    if (fine > 0) pushNews(career, `Превышение кост-капа на $${(over / 1000).toFixed(1)}M → штраф $${(fine / 1000).toFixed(1)}M и удар по доверию совета.`);
    return false;
  }
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
  fresh.loan = career.loan || null;                                 // an outstanding loan carries into the new season
  fresh.capSpent = 0; fresh.seasonPayout = null; fresh.sponsorOffer = null;
  fresh.backer = career.backer || backerFor(TEAMS[career.teamIdx].name);   // backer (may have changed via events) carries over
  fresh.puParts = JSON.parse(JSON.stringify(career.puParts || { power: 0, eff: 0, rel: 0 }));   // engine dev carries (regs trim it below)
  fresh.puProgram = career.puProgram || null; fresh.puProject = null;
  fresh.identity = career.identity || null;                                  // a rebrand carries between seasons
  fresh.gridBoost = { ...(career.gridBoost || {}) };
  fresh.concept = career.concept || "balanced";                              // E3: car concept carries (changeable in winter)
  // --- off-season events (Phase C) ---
  const finalPos = (constructorStandings(career).find(s => s.isPlayer) || {}).pos || TEAMS.length;
  const evSeed = (fresh.seed >>> 0) + fresh.season * 2246822519;
  fresh.acquisitionOffer = suitorOffer(fresh, finalPos, evSeed);             // a buyout may await (uses the carried backer)
  if (parentPullout(career, finalPos)) {
    fresh.backer = { ...fresh.backer, type: "independent", puMaker: false, grant: Math.round((fresh.backer.grant || 4000) * 0.4), boardProfile: "owner" };
    pushNews(fresh, "Материнский концерн уходит из проекта: грант срезан, ДВС теперь клиентский.");
  }
  const indepNames = TEAMS.filter(t => backerFor(t.name).type === "independent").map(t => t.name);
  const churn = gridChurn(TEAMS.map(t => t.name), TEAMS[career.teamIdx].name, indepNames, evSeed);
  if (churn) { fresh.gridBoost[churn.team] = (fresh.gridBoost[churn.team] || 0) + 0.02; pushNews(fresh, `${churn.suitorLabel} выкупил команду ${churn.team} — соперник усилится.`); }
  fresh.drivers = JSON.parse(JSON.stringify(career.drivers || initDrivers()));
  developDrivers(fresh.drivers);             // age up, develop/decline (+ winter training), reset season stats
  for (const a in fresh.drivers) {           // G4: a driver may unlock a new trait from a mastered attr
    const dr = fresh.drivers[a]; dr.request = null; dr._reqNewsed = false;
    const tr = maybeGainTrait(dr); if (tr) pushNews(fresh, `${DRIVER_NAME[a] || a} развил черту «${(TRAITS[tr] || {}).label || tr}».`);
  }
  { // off-season: a rival may sign the player's OUT-OF-CONTRACT star (re-sign in-season to keep them)
    const stars = Object.keys(fresh.drivers).filter(ab => fresh.drivers[ab].teamIdx === fresh.teamIdx && (fresh.drivers[ab].contractSeasons || 0) <= 0 && (fresh.drivers[ab].overall || 0) >= 0.85);
    if (stars.length && (mix32(((fresh.seed >>> 0) + fresh.season * 525601) >>> 0) / 4294967296) < 0.45) {
      const ab = stars[0], star = fresh.drivers[ab];
      const pool = Object.keys(fresh.drivers).filter(x => fresh.drivers[x].teamIdx !== fresh.teamIdx).sort((p, q) => fresh.drivers[q].overall - fresh.drivers[p].overall);
      const replAb = pool[Math.min(pool.length - 1, Math.floor(pool.length * 0.5))];
      if (replAb) { const r = fresh.drivers[replAb], t = r.teamIdx; r.teamIdx = fresh.teamIdx; star.teamIdx = t; star.contractSeasons = 3; r.contractSeasons = 3; r.morale = Math.min(1, (r.morale ?? 0.6) + 0.05);
        pushNews(fresh, `${DRIVER_NAME[ab] || ab} ушёл к сопернику — контракт не был продлён. На его место пришёл ${DRIVER_NAME[replAb] || replAb}.`); }
    }
  }
  aiChurn(fresh, (fresh.seed >>> 0) + fresh.season * 2246822519);   // deterministic AI silly-season
  fresh.staff = JSON.parse(JSON.stringify(career.staff || initStaff((TEAMS[career.teamIdx] || TEAMS[0]).facility, career.seed || 1)));
  fresh.staff.fatigue = 0;                    // the winter break fully rests the crew
  // T1/T3/T4: carry the living-staff state across the winter
  fresh.teamStaff = JSON.parse(JSON.stringify(career.teamStaff || initTeamStaff(TEAMS.map(t => ({ name: t.name, facility: t.facility })), career.seed || 1)));
  fresh.staffTrain = { ...(career.staffTrain || {}) };
  fresh.facilityProject = career.facilityProject || null;       // an unfinished build carries over
  fresh._myTeamName = career._myTeamName || TEAMS[career.teamIdx].name;
  for (const r in (fresh.staff.people || {})) { const p = fresh.staff.people[r]; if (p) p.contractSeasons = Math.max(0, (p.contractSeasons ?? 3) - 1); }
  { // a rival may poach a player star whose deal ran out (re-sign in-season to keep them)
    const evSeed = (fresh.seed >>> 0) + fresh.season * 99173;
    const cand = STAFF_ROLES.filter(r => fresh.staff.people && fresh.staff.people[r] && (fresh.staff.people[r].contractSeasons || 0) <= 0 && (fresh.staff[r] || 0) > 0.82);
    if (cand.length && (mix32(evSeed) / 4294967296) < 0.5) {
      const role = cand[mix32((evSeed + 7) >>> 0) % cand.length];
      fresh.staff[role] = Math.max(0.5, (fresh.staff[role] || 0.7) - 0.16);
      fresh.staff.people[role] = { name: "—", specialty: null, rating: fresh.staff[role], salary: salaryForStaff(fresh.staff[role]), contractSeasons: 2 };
      pushNews(fresh, `${ROLE_LABEL[role]} ушёл к сопернику — контракт не был продлён.`);
    }
  }
  fresh.academy = JSON.parse(JSON.stringify(career.academy || []));
  developAcademy(fresh, fresh.season);         // D7: juniors race a feeder season (SL points + dev by results)
  const reg = regResetFor(fresh.season);                       // D8: regulation arc — a big shake-up on a cycle
  for (const tn in fresh.parts) for (const k in fresh.parts[tn]) fresh.parts[tn][k] *= reg;            // regs change: redevelop parts
  for (const k in fresh.puParts) fresh.puParts[k] *= reg;                                              // regs trim engine dev too
  // --- winter window (Phase 3): the off-season is a long development gap. Regs reset (above), then
  // everyone develops the new car over winter; a carried PU program keeps progressing; the player gets
  // a pre-season testing step. This is the calendar's biggest dev opportunity. ---
  const winter = offseasonDays(career.season);                 // ~92 days, Dec → March
  tickDevelopment(fresh, winter);                              // AI catch-up dev + any carried PU program advance
  const myName = TEAMS[fresh.teamIdx].name;
  fresh.parts[myName] = fresh.parts[myName] || {};
  fresh.parts[myName].floor = (fresh.parts[myName].floor || 0) + 0.014;   // pre-season testing: a modest works-car step
  pushNews(fresh, `Зимние тесты (${winter} дн.): команда обкатала новую машину перед сезоном.`);
  // F1: development banked for "next year's car" becomes a head start that survives the regulation reset
  fresh.devFocus = career.devFocus || 0;
  const banked = career.nextCar ? Object.values(career.nextCar).reduce((a, b) => a + b, 0) : 0;
  if (banked > 0.0005) { for (const k in career.nextCar) fresh.parts[myName][k] = (fresh.parts[myName][k] || 0) + career.nextCar[k]; pushNews(fresh, `Задел на новую машину реализован — фора в разработке к старту сезона.`); }
  fresh.board.confidence = career.board.confidence ?? 0.5;     // confidence carries between seasons
  fresh.board.objectives = seasonObjectives(fresh.board.targetPos); fresh.board.podiums = 0; fresh.board.pointFinishes = 0;   // D8: new season's objectives
  pushNews(fresh, regArcNote(fresh.season));                   // D8: telegraph the regulation cadence
  pushNews(fresh, `Сезон ${fresh.season}: смена регламента — разработка частично обнулена.`);
  return fresh;
}
