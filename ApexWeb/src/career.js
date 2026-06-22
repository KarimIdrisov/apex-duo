// ApexWeb/src/career.js — pure career/season state: calendar, standings, prize money, board
// objective. No UI, no I/O. M1 evolves only meta state (the sim is untouched). Deterministic.
import { TEAMS } from "./data.js";
import { backerFor } from "./backers.js";
import { suitorOffer, parentPullout, moneyEvent, gridChurn } from "./team_events.js";
import { defaultSponsors, titleOffers, evaluateSponsor, replacementSponsor } from "./sponsors.js";
import { tickDevelopment, SUPPLY_INCOME, SUPPLY_FEE, runInParts, PU_POOL, PU_GRID_PEN, puWearForRace, PU_TOKENS_PER_SEASON, engineModeStress, eraNote, PART_LABEL, supplyFeeMult } from "./development.js";
import { neutralChassis } from "./chassis.js";
import { CHEM_START, chemAfterRace } from "./perks.js";
import { gapDays, offseasonDays } from "./season_dates.js";
import { initDrivers, developDrivers, retirePass, updateMorale, tickDriverRace, makeDriverRequest, maybeGainTrait, zeroDriverStats, salaryFor, DRIVER_NAME, isPayDriver } from "./drivers.js";
import { driverAttrs, assignTraits, TRAITS, overallToStars, peakArchetype } from "./team.js";
import { initStaff, upkeep, salaryForStaff, applyCalendarLoad, initTeamStaff, tickStaffTrain, tickStaffDevelopment, tickFacility, FAC_LABEL, STAFF_ROLES, ROLE_LABEL, simDriverBoost, staffGrowth } from "./staff.js";
import { mix32 } from "./rng.js";
import { aiChurn } from "./market.js";
import { developAcademy } from "./academy.js";
import { initPitCrew, tickRacePitCrew, restPitCrew, tickInjuriesPerRace, tickOffseasonPitCrew } from "./pitcrew.js";
import { ensureRivals, rivalMoraleDelta } from "./rivalry.js";
import { sponsorIncomeMult, startBudgetMult, puWearMult, driverDevMult } from "./directors.js";
import { pushNews, boardReaction, confidenceDelta } from "./news.js";
import { seasonObjectives, evaluateObjectives, regResetFor, regResetForCareer, regArcNote } from "./board.js";

// championship points for the top 10 finishers (current F1 system).
// §Phase-6 — selectable points systems (an MM-faithful "ruleset" option; balance-safe — scoring only,
// the sim is untouched). career.scoring picks one; pointsFor() reads it. POINTS stays = the default.
export const SCORING = {
  standard: { label: "Современный F1 (25-18-15…)",        pts: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1] },
  classic:  { label: "Классика (10-8-6-5-4-3-2-1)",        pts: [10, 8, 6, 5, 4, 3, 2, 1] },
  flat:     { label: "Плотный (15-12-10-8-7-6-5-4-3-2-1)", pts: [15, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1] },
};
export const POINTS = SCORING.standard.pts;
export function pointsFor(career, i) {
  const s = SCORING[(career && career.scoring) || "standard"] || SCORING.standard;
  return i < s.pts.length ? s.pts[i] : 0;
}
// prize money ($k) by race-finish position — a simple per-race payout (M2 deepens income).
export const PRIZE = [1200, 1000, 850, 720, 620, 540, 470, 410, 360, 320, 280, 250, 220, 200, 180, 160, 150, 140, 130, 120, 110, 100];

export const CAREER_V = 37;           // career save schema version
export const REG_RESET = 0.5;         // each season's regulation change trims everyone's car development
export const RUNNING_COST = 800;      // $k per-race operating cost (M5 facilities refine it)
export const PAY_DRIVER_INCOME = 320; // §Phase-3 $k/race a pay driver brings (sponsorship) — funds a weak-but-paid seat
// §Phase-6 — solvency + the board ultimatum that make money & confidence BITE (career.board.ultimatum is null-safe/additive).
export const INSOLVENCY = { limit: -1500, confHit: 0.18 };  // $k balance below which the board panics; per-race confidence hit while insolvent
export const ULTIMATUM = { conf: 0.18, restore: 0.30, slack: 2 };  // confidence that triggers an ultimatum; confidence restored on meeting it; demand = targetPos + slack (a touch easier than the season target)
export const STEWARD_FINE = 250;   // $k cash fine per on-track stewards' penalty the player's cars drew (§Phase-6)
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
// §Phase-6 — request funds from the board: cash NOW with no repayment, but the board's confidence drops
// (they don't like bailing you out). Once per season. Unlike a loan (bank debt), this trades money for
// JOB SECURITY — leaning on it when desperate can tip you into the ultimatum. Returns the cash drawn (0 if denied).
export const BOARD_FUNDS = { max: 4000, confPer1M: 0.05 };   // up to $4M; −0.05 board confidence per $1M drawn
export function requestBoardFunds(career, amount) {
  if (!career || career.boardFundsUsed || !(amount > 0)) return 0;
  const amt = Math.min(BOARD_FUNDS.max, Math.round(amount));
  career.money += amt;
  career.boardFundsUsed = true;
  if (career.board) career.board.confidence = Math.max(0, (career.board.confidence ?? 0.5) - BOARD_FUNDS.confPer1M * (amt / 1000));
  return amt;
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

// §Phase-6 — per-track running-cost scaling. A longer race weekend burns more operating budget; the
// factor is the round's lap count vs the calendar mean, so the SEASON TOTAL is unchanged (mean-neutral)
// — it only redistributes the flat RUNNING_COST across the calendar (a long Grand Prix bites harder).
const CAL_MEAN_LAPS = CALENDAR.reduce((a, r) => a + (r.laps || 0), 0) / CALENDAR.length;
export function runningCostFor(round) {
  const laps = (round && round.laps) || CAL_MEAN_LAPS;
  return Math.round(RUNNING_COST * (laps / CAL_MEAN_LAPS));
}

function allDrivers() { return TEAMS.flatMap(t => t.drivers.map(d => ({ abbrev: d.abbrev, team: t.name }))); }

// a fresh career. teamIdx = which TEAMS entry the players manage; seed reserved for AI RNG.
export function newCareer({ teamIdx = 0, seed = 1, coop = false, directors = [], scoring = "standard" } = {}) {
  const driverPts = {}, teamPts = {};
  for (const d of allDrivers()) driverPts[d.abbrev] = 0;
  for (const t of TEAMS) teamPts[t.name] = 0;
  const s = seed >>> 0;
  const targetPos = Math.min(TEAMS.length, teamIdx + 1);
  return {
    v: CAREER_V, seed: s, teamIdx, coop,
    season: 1, round: 0, money: Math.round((3000 + (TEAMS.length - teamIdx) * 800) * startBudgetMult({ directors })),   // tier-scaled starting budget ($k)
    driverPts, teamPts,
    board: { targetPos, confidence: 0.5, podiums: 0, pointFinishes: 0, objectives: seasonObjectives(targetPos) },  // meet your tier (P{teamIdx+1}) + season objectives (D8)
    sponsors: defaultSponsors(teamIdx, s), costCap: false, pendingOffers: titleOffers(teamIdx, s),
    parts: {}, projects: [], unproven: [], devSpentThisSeason: 0,   // E1: parallel projects + run-in debts
    directors, rewardMult: 1,                                      // career-start: co-directors + season-ambition reward scaler
    scoring,                                                        // §Phase-6: selected points system (ruleset option)
    partsPrev: {},                                                  // P2: previous-spec snapshots for free revert
    devFocus: 0, nextCar: {},                                       // F1: this/next-year development split

    concept: "balanced",                                            // E3 car concept
    chassis: neutralChassis(),                                      // Phase 4: pre-season chassis design (supplier ritual → character traits)
    mechChem: { p1: CHEM_START, p2: CHEM_START },                   // §Phase-5: per-car race-mechanic chemistry (gates the in-race perks)
    pu: { pool: PU_POOL, used: 1, wear: 0, penalty: 0 }, aiPu: {},   // E4 PU season allocation · E9 AI PU pools
    capSpent: 0, loan: null, seasonPayout: null, sponsorOffer: null, boardFundsUsed: false,   // §Phase-6: once-per-season board cash injection
    backer: backerFor(TEAMS[teamIdx].name),    // funding archetype (works/independent + grant + PU)
    puParts: { power: 0, ers: 0, eff: 0, rel: 0 }, puProject: null, puProgram: null,   // engine program (Phase B / P3)
    puTokens: PU_TOKENS_PER_SEASON,                                            // P3: homologation tokens (engine dev limit)
    puContract: "current",                                                    // P4: customer engine-supply spec (current/prev)
    proposal: null,                                                           // P6: pending co-director decision awaiting sign-off
    acquisitionOffer: null, identity: null, gridBoost: {},                     // events (Phase C)
    drivers: initDrivers(),
    staff: initStaff(TEAMS[teamIdx].facility, s),
    teamStaff: initTeamStaff(TEAMS.map(t => ({ name: t.name, facility: t.facility })), s),   // T1 named staff in every team
    staffTrain: {}, facilityProject: null, _myTeamName: TEAMS[teamIdx].name,                  // T3 training · T4 construction
    pitCrew: initPitCrew(TEAMS[teamIdx].facility, s),                                          // PIT: managed pit crew
    academy: [], academyTier: 0, scoutData: {}, lastFeeder: null, rivalJuniors: [], graduates: [],   // D: junior pipeline
    news: [],
    lastResult: null, history: [], done: false,
  };
}

export function currentRound(career) { return CALENDAR[career.round]; }
export function isSeasonOver(career) { return career.round >= CALENDAR.length; }

// award points + book the race ledger (prize + sponsor income − running cost). classification =
// finishing order [{abbrev, team, retired}] (index 0 = winner). Mutates career; returns a summary.
export function applyResult(career, classification, raceInfo = {}) {
  ensureRivals(career.drivers, career.teamIdx);   // rivalries: keep each player driver's rival valid
  if (career.mechChem) for (const pl of ["p1", "p2"]) career.mechChem[pl] = chemAfterRace(career.mechChem[pl]);   // §Phase-5: a kept mechanic↔driver pairing builds chemistry each race (unlocks stronger perks)
  const posOfAbbrev = {};                          // finishing position by abbrev (for rival morale)
  classification.forEach((c, i) => { posOfAbbrev[c.abbrev] = i + 1; });
  const podium = [];
  let prize = 0, teamPts = 0, bestPos = 99;
  const myTeam = TEAMS[career.teamIdx].name;
  const bestByTeam = {};
  classification.forEach((c, i) => {
    const pts = pointsFor(career, i);
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
    const r = evaluateSponsor(sp, sCtx, !!career.bonusFocus && sp.name === career.bonusFocus);   // §Phase-6: the weekend's focused sponsor pays a boosted bonus
    sponsorIncome += r.payout;
    sp.happiness = Math.max(0, Math.min(1, sp.happiness + r.dHappiness));
  }
  sponsorIncome = Math.round(sponsorIncome * sponsorIncomeMult(career) * appealMult(career));   // §Phase-6: marketability (standing + star drivers + confidence) scales sponsor income (financier specialty also lifts it)
  // living sponsors: a deal whose happiness collapses walks away; a fresh offer surfaces to refill a slot.
  const leavers = (career.sponsors || []).filter(s => s.happiness < 0.16);
  if (leavers.length) {
    career.sponsors = (career.sponsors || []).filter(s => s.happiness >= 0.16);
    for (const s of leavers) pushNews(career, `Спонсор ${s.name} разорвал контракт — низкое довольство.`);
  }
  if (!career.sponsorOffer && (career.sponsors || []).length < 3) career.sponsorOffer = replacementSponsor(career.teamIdx, (career.seed >>> 0) + career.round * 7919);
  // driver morale (whole field) from finish vs the team-tier expectation; salaries (player team) as expense.
  // Player drivers get the richer per-race tick (G1 stats + G2 in-season training + G3 form/morale).
  let salaries = 0, bonuses = 0;   // bonuses = contract performance clauses paid this race
  const playerRes = [];
  classification.forEach((c, i) => {
    const dr = career.drivers && career.drivers[c.abbrev];
    if (!dr) return;
    if (dr.teamIdx === career.teamIdx) {
      salaries += dr.salary;
      playerRes.push({ abbrev: c.abbrev, dr, finishPos: i + 1, start: (raceInfo.starts && raceInfo.starts[c.abbrev]) || null, retired: !!c.retired, points: pointsFor(career, i), expectedPos: 2 + dr.teamIdx * 2 });
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
      tickDriverRace(r.dr, { finishPos: r.finishPos, expectedPos: r.expectedPos, retired: r.retired, points: r.points, isPole: r.start === 1, beatTeammate }, driverDevMult(career) * simDriverBoost(career.staff));   // §Phase-5: the Simulator HQ building speeds driver development
      const cl = r.dr.clauses;   // deep-contract performance bonuses
      if (cl && !r.retired) {
        if (r.finishPos === 1) bonuses += cl.winBonus || 0;
        else if (r.finishPos <= 3) bonuses += cl.podiumBonus || 0;
      }
      if (qAhead === r.abbrev) r.dr.stats.qH2H += 1;
      // rivalry: morale swing vs the personal rival + a news beat (only when both were classified)
      if (r.dr.rival && !r.retired) {
        const rivalPos = posOfAbbrev[r.dr.rival], rivalRetired = classification.find(c => c.abbrev === r.dr.rival && c.retired);
        if (rivalPos != null && !rivalRetired) {
          const dm = rivalMoraleDelta(r.finishPos, rivalPos);
          r.dr.morale = Math.max(0, Math.min(1, (r.dr.morale ?? 0.6) + dm));
          const rn = DRIVER_NAME[r.dr.rival] || r.dr.rival, me = DRIVER_NAME[r.abbrev] || r.abbrev;
          if (dm > 0) pushNews(career, `🤝 Дуэль: ${me} опередил соперника ${rn} (+мораль).`);
          else if (dm < 0) pushNews(career, `🤝 Дуэль: ${me} уступил сопернику ${rn} (−мораль).`);
        }
      }
      const req = makeDriverRequest(r.dr, r.abbrev);
      if (req && !r.dr._reqNewsed) { pushNews(career, `💬 ${req.text}`); r.dr._reqNewsed = true; }
    }
    if (pair) {   // §Phase-3: an under-valued driver (paid far less than the teammate) takes a small morale hit
      const [a, b] = playerRes;
      const under = a.dr.salary < b.dr.salary * 0.8 ? a.dr : (b.dr.salary < a.dr.salary * 0.8 ? b.dr : null);
      if (under) under.morale = Math.max(0, (under.morale ?? 0.6) - 0.015);
    }
  }
  tickRacePitCrew(career.pitCrew);          // PIT: a race weekend tires the crew (+ trains it if enrolled)
  tickInjuriesPerRace(career.pitCrew);      // PIT: count down any injured member's lay-off
  const up = upkeep(career.staff);
  const loanPay = (career.loan && career.loan.remaining > 0) ? Math.min(career.loan.perRace, career.loan.remaining) : 0;
  const grant = career.backer ? Math.round((career.backer.grant || 0) / CALENDAR.length) : 0;   // parent/owner funding floor (per race)
  const supply = career.backer ? (career.backer.puMaker ? SUPPLY_INCOME : -Math.round(SUPPLY_FEE * supplyFeeMult(career))) : 0;   // PU-maker sells (+) / customer buys (−, cheaper on last-year spec, P4)
  const runCost = runningCostFor(CALENDAR[career.round]);   // §Phase-6: per-track running cost (mean-neutral over the season)
  let payIncome = 0;                                        // §Phase-3: pay drivers bring sponsorship cash each race
  for (const ab in career.drivers) { const d = career.drivers[ab]; if (d.teamIdx === career.teamIdx && d.payDriver) payIncome += PAY_DRIVER_INCOME; }
  const net = prize + grant + supply + sponsorIncome + payIncome - runCost - salaries - bonuses - up - loanPay;
  career.money += net;
  if (bonuses > 0) pushNews(career, `Выплачены контрактные бонусы пилотам: $${(bonuses / 1000).toFixed(2)}M.`);
  if (career.loan) { career.loan.remaining -= loanPay; if (career.loan.remaining <= 0.5) { career.loan = null; pushNews(career, "Кредит полностью погашен."); } }
  const summary = {
    round: career.round, gp: CALENDAR[career.round].name, podium, bestPos,
    prize, grant, supply, sponsorIncome, payIncome, runningCost: runCost, salaries, bonuses, upkeep: up, loanPay, net, money: career.money,
    classification: classification.map((c, i) => ({ pos: i + 1, abbrev: c.abbrev, team: c.team, retired: !!c.retired })),
  };
  career.board.confidence = Math.max(0, Math.min(1, (career.board.confidence ?? 0.5) + confidenceDelta(bestPos, career.board.targetPos)));
  pushNews(career, boardReaction(bestPos, career.board.targetPos, summary.gp));
  if (bestPos <= 3) career.board.podiums = (career.board.podiums || 0) + 1;          // D8: objective counters
  if (bestPos <= 10) career.board.pointFinishes = (career.board.pointFinishes || 0) + 1;
  // §Phase-6 — stewards' cash fines: each on-track penalty the player's cars drew costs money + a little
  // board confidence (and can tip a struggling team toward insolvency, below).
  if (raceInfo.penalties > 0) {
    const fine = raceInfo.penalties * STEWARD_FINE;
    career.money -= fine; career.capSpent = (career.capSpent || 0) + fine;
    career.board.confidence = Math.max(0, career.board.confidence - 0.03 * raceInfo.penalties);
    summary.fine = fine;
    pushNews(career, `⚖ Штраф стюардов: $${(fine / 1000).toFixed(2)}M за ${raceInfo.penalties} наруш.`);
  }
  // §Phase-6 — solvency + the board's mid-season ultimatum (insolvency & low confidence now BITE).
  const lastRound = career.round >= CALENDAR.length - 1;
  if (career.money < INSOLVENCY.limit) {                                              // deep in the red → the board panics
    career.board.confidence = Math.max(0, career.board.confidence - INSOLVENCY.confHit);
    summary.insolvent = true;
    pushNews(career, `⚠ Бюджет в глубоком минусе ($${(career.money / 1000).toFixed(1)}M) — совет в ярости.`);
  }
  if (career.board.ultimatum && career.board.ultimatum.round === career.round) {      // an ultimatum came due THIS race
    const u = career.board.ultimatum; career.board.ultimatum = null;
    if (bestPos <= u.demandPos && career.money >= INSOLVENCY.limit) {                 // met the demand AND solvent
      career.board.confidence = Math.min(1, career.board.confidence + ULTIMATUM.restore);
      pushNews(career, `✅ Ультиматум выполнен (P${bestPos} ≤ P${u.demandPos}). Совет даёт второй шанс.`);
      summary.ultimatumMet = true;
    } else {                                                                          // failed → mid-season dismissal
      career.done = true; career.sacked = true;
      pushNews(career, `⛔ Ультиматум провален — совет увольняет вас по ходу сезона.`);
      summary.sacked = true;
    }
  } else if (!lastRound && !career.board.ultimatum && (career.board.confidence < ULTIMATUM.conf || summary.insolvent)) {
    const demandPos = Math.max(1, Math.min(TEAMS.length, (career.board.targetPos || 1) + ULTIMATUM.slack));
    career.board.ultimatum = { round: career.round + 1, demandPos };                 // concrete next-race demand
    pushNews(career, `📋 Ультиматум совета: финишируй не ниже P${demandPos} в следующей гонке — иначе отставка.`);
    summary.ultimatumIssued = demandPos;
  }
  const mev = moneyEvent(career, career.round, (career.seed >>> 0) + career.round * 17);   // rare one-off money event
  if (mev) { career.money += mev.delta; pushNews(career, mev.news); summary.event = mev.news; summary.eventDelta = mev.delta; }   // expose the windfall amount so the money ledger reconciles
  // E1: bed in freshly-fitted parts (decay the run-in reliability debt). E2: regenerate aero/R&D capacity
  // by championship position (trailers test more — honest ATR sliding scale).
  runInParts(career);
  // E4: wear the PU. Power tracks stress it; developed PU reliability spares it. Spending a unit beyond
  // the season pool draws a grid penalty next race.
  if (career.pu) {
    const trk = CALENDAR[career.round] || {};
    const puRel = (career.puParts && career.puParts.rel) || 0;
    // P3: when the full engine-mode mix is present it OWNS mode-based wear (push captured in modeStress),
    // so the legacy pushFrac term is suppressed to avoid double-counting; old callers (no modeMix) keep E6.
    const pushTerm = raceInfo.modeMix ? 0 : (raceInfo.pushFrac || 0);
    // co-director: an engine specialist (Моторист) spares the PU (puWearMult < 1). Player team only — AI wears below.
    career.pu.wear = (career.pu.wear || 0) + puWearForRace(trk, puRel, pushTerm, engineModeStress(raceInfo.modeMix)) * puWearMult(career);
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
  if (career.v < 25) {   // P2/P3: revert snapshots, ERS engine characteristic, homologation tokens
    career.partsPrev = career.partsPrev || {};
    career.puParts = career.puParts || { power: 0, ers: 0, eff: 0, rel: 0 };
    if (career.puParts.ers == null) career.puParts.ers = 0;
    career.puTokens = career.puTokens != null ? career.puTokens : PU_TOKENS_PER_SEASON;
    career.puContract = career.puContract || "current";
    career.proposal = career.proposal ?? null;
    career.v = 25;
  }
  if (career.v < 26) {   // D-v2: academy as a series-ladder pipeline (scouting + roles + programme)
    career.academyTier = career.academyTier || 0;
    career.scoutData = career.scoutData || {};
    career.rivalJuniors = career.rivalJuniors || [];   // prospects claimed by rival academies
    career.graduates = career.graduates || [];         // academy-graduate F1 career chronicle
    if (!career.pitCrew) career.pitCrew = initPitCrew((TEAMS[career.teamIdx] || TEAMS[0]).facility, career.seed || 1);   // PIT crew
    for (const j of (career.academy || [])) {
      if (j.potTrue == null) j.potTrue = j.potential != null ? j.potential : Math.min(0.99, (j.overall || 0.7) + 0.12);
      if (j.scout == null) j.scout = 0.4;                       // already-signed juniors are partly known
      if (j.series == null) j.series = j.overall >= 0.74 ? "F2" : "F3";
      if (j.slHist == null) j.slHist = [Math.max(0, Math.round(j.slPoints || 0))];   // fold the old single counter in
      if (j.contract == null) j.contract = 3;
      if (j.role == null) j.role = (career.reserve && career.reserve === j.abbrev) ? "reserve" : null;
      if (j.loanedTo === undefined) j.loanedTo = null;
      if (j.persona == null) j.persona = "loyal";   // personalities (default = steady)
      if (j.morale == null) j.morale = 0.7;
      delete j.potential; delete j.slPoints;
    }
    if (!career.lastFeeder || Array.isArray(career.lastFeeder)) career.lastFeeder = null;   // old shape was an array
    delete career.reserve;
    career.v = 26;
  }
  if (career.v < 27) {                 // career-start: co-directors + ambition reward
    career.directors = career.directors || [];
    career.rewardMult = career.rewardMult ?? 1;
    career.v = 27;
  }
  if (career.v < 28) {                 // §Phase-5/6: Simulator HQ facility + points-system preset
    if (career.staff && career.staff.facilities && career.staff.facilities.sim == null) career.staff.facilities.sim = career.staff.facilities.factory || 0;
    career.scoring = career.scoring || "standard";
    career.v = 28;
  }
  if (career.v < 29) {                 // §Phase-4: pre-season chassis design (neutral = no effect on old saves)
    career.chassis = career.chassis || neutralChassis();
    career.v = 29;
  }
  if (career.v < 30) {                 // §Phase-4 item 6: gearbox split — seed gearbox = developed pu so total power is conserved
    for (const tn in (career.parts || {})) { const p = career.parts[tn]; if (p && p.gearbox == null) p.gearbox = p.pu || 0; }
    career.v = 30;
  }
  if (career.v < 31) {                 // §Phase-5: Аэротруба + Кадровый центр buildings (seed = factory level, like the Simulator)
    const f = career.staff && career.staff.facilities;
    if (f) { if (f.tunnel == null) f.tunnel = f.factory || 0; if (f.staffctr == null) f.staffctr = f.factory || 0; }
    career.v = 31;
  }
  if (career.v < 32) {                 // §Phase-5: staff age + potential (buy-vs-grow) — backfill from rating
    const ppl = career.staff && career.staff.people;
    if (ppl) for (const role in ppl) { const p = ppl[role]; if (p && (p.age == null || p.potential == null)) { const g = staffGrowth(p.rating || 0.6, (career.seed || 1) + role.charCodeAt(0)); if (p.age == null) p.age = g.age; if (p.potential == null) p.potential = Math.max(p.rating || 0, g.potential); } }
    career.v = 32;
  }
  if (career.v < 33) {                 // §Phase-5: mechanic↔driver chemistry (gates the in-race perks)
    if (career.mechChem == null) career.mechChem = { p1: CHEM_START, p2: CHEM_START };
    career.v = 33;
  }
  if (career.v < 34) {                 // §Phase-6: once-per-season board cash-injection flag
    career.boardFundsUsed = career.boardFundsUsed || false;
    career.v = 34;
  }
  if (career.v < 35) {                 // §Phase-3: per-driver peak-age archetype (early/normal/late)
    for (const ab in (career.drivers || {})) { const dr = career.drivers[ab]; if (dr && dr.peakAge == null) dr.peakAge = peakArchetype(ab); }
    career.v = 35;
  }
  if (career.v < 36) {                 // §Phase-3: pay-driver flag (brings sponsorship cash)
    for (const ab in (career.drivers || {})) { const dr = career.drivers[ab]; if (dr && dr.payDriver == null) dr.payDriver = isPayDriver(ab, dr.overall); }
    career.v = 36;
  }
  if (career.v < 37) {                 // §Phase-5: staff loyalty (poach-resistance / retention)
    const ppl = career.staff && career.staff.people;
    if (ppl) for (const role in ppl) { const p = ppl[role]; if (p && p.loyalty == null) p.loyalty = 0.5; }
    career.v = 37;
  }
  // names of dynamically-added drivers (academy promotions, retirement rookies) live on the driver
  // object, but DRIVER_NAME is rebuilt from the static roster each load — repopulate it so the UI
  // (which often resolves DRIVER_NAME[abbrev]) shows their real names across reloads.
  for (const a in (career.drivers || {})) { const dr = career.drivers[a]; if (dr && dr.name) DRIVER_NAME[a] = dr.name; }
  ensureRivals(career.drivers, career.teamIdx);   // rivalries: assign/repair on load
  return career;
}
// accept a season-start title-sponsor offer: replace the title deal, clear the offers.
// §Phase-6 — upfront-payment-vs-retainer lever: take part of the season's retainer as a LUMP now in
// exchange for a lower per-race retainer. Mean-neutral over the calendar (lump = the foregone retainer
// share × all rounds), so it's a cashflow choice (front-load the budget) not free money.
export const SPONSOR_UPFRONT_SHARE = 0.5;
export function chooseTitleSponsor(career, offerIdx, upfront = false) {
  const chosen = career.pendingOffers && career.pendingOffers[offerIdx];
  if (!chosen) return;
  const deal = { ...chosen, kind: "title" };
  if (upfront) {
    const lump = Math.round(deal.retainer * SPONSOR_UPFRONT_SHARE * CALENDAR.length);   // the whole season's foregone retainer, paid now
    deal.retainer = Math.round(deal.retainer * (1 - SPONSOR_UPFRONT_SHARE));
    career.money += lump;
  }
  const secondaries = (career.sponsors || []).filter(s => s.kind !== "title");
  career.sponsors = [deal, ...secondaries];
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
    } else if (req.type === "bonus") {        // add performance-bonus clauses (no upfront cost, paid on results)
      dr.clauses = dr.clauses || {};
      dr.clauses.podiumBonus = Math.max(dr.clauses.podiumBonus || 0, 300);
      dr.clauses.winBonus = Math.max(dr.clauses.winBonus || 0, 800);
      dr.clauses.titleBonus = Math.max(dr.clauses.titleBonus || 0, 3000);
      dr.morale = Math.min(1, (dr.morale || 0.6) + 0.12);
      pushNews(career, `${DRIVER_NAME[abbrev] || abbrev} получил бонусы за результат в контракте (+мораль).`);
    } else if (req.type === "raise") {        // a salary bump — costs more every race from now on
      dr.salary = Math.round((dr.salary || 200) * 1.25);
      dr.morale = Math.min(1, (dr.morale || 0.6) + 0.12);
      pushNews(career, `${DRIVER_NAME[abbrev] || abbrev} получил прибавку к зарплате (+мораль).`);
    }
  } else {
    // refusing a star's demand stings more than a routine one
    const hit = (req.type === "raise" || req.type === "bonus") ? 0.16 : 0.12;
    dr.morale = Math.max(0, (dr.morale || 0.6) - hit);
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
  if (g != null && career.pitCrew) restPitCrew(career.pitCrew, Math.max(0.08, Math.min(0.30, g / 90)));   // PIT: the crew recovers between races (long gap = more rest; a back-to-back barely)
  const facDone = tickFacility(career, g == null ? 0 : g);   // T4: facility construction advances by calendar days
  if (facDone) pushNews(career, `Достроен объект: ${FAC_LABEL[facDone.which]} → уровень ${facDone.level}.`);
  career.round += 1;
  if (isSeasonOver(career)) {
    career.done = true;
    const fin = constructorStandings(career).find(s => s.isPlayer);   // season-end Constructors' Cup prize fund
    const pos = fin ? fin.pos : TEAMS.length;
    const fund = Math.round(constructorPrizeFund(pos) * (career.rewardMult ?? 1));
    career.money += fund;
    const over = Math.max(0, (career.capSpent || 0) - CAP_LIMIT);     // soft cost-cap: a fine on any season overspend
    const fine = Math.round(over * 0.6);
    if (fine > 0) { career.money -= fine; if (career.board) career.board.confidence = Math.max(0, (career.board.confidence ?? 0.5) - 0.12); }
    { // deep contracts: a title bonus if your driver won the Drivers' Championship
      const champ = driverStandings(career)[0];
      const cd = champ && career.drivers[champ.abbrev];
      if (cd && cd.teamIdx === career.teamIdx && cd.clauses && cd.clauses.titleBonus) {
        career.money -= cd.clauses.titleBonus;
        pushNews(career, `🏆 ${DRIVER_NAME[champ.abbrev] || champ.abbrev} — чемпион! Контрактный титульный бонус $${(cd.clauses.titleBonus / 1000).toFixed(1)}M выплачен.`);
      }
    }
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
// §Phase-6 — team marketability/"appeal" 0..1: championship standing + the two drivers' star power +
// board confidence. A winning team with star drivers attracts richer sponsor deals (appealMult below).
export function teamAppeal(career) {
  const cons = constructorStandings(career);
  const me = cons.find(s => s.isPlayer);
  const pos = me ? me.pos : TEAMS.length;
  const standing = 1 - (pos - 1) / Math.max(1, TEAMS.length - 1);            // P1 → 1, last → 0
  const mine = Object.values(career.drivers || {}).filter(d => d.teamIdx === career.teamIdx);
  const stars = mine.length ? mine.reduce((s, d) => s + overallToStars(d.overall), 0) / (mine.length * 5) : 0.5;
  const conf = career.board ? (career.board.confidence ?? 0.5) : 0.5;
  return Math.max(0, Math.min(1, 0.35 * standing + 0.45 * stars + 0.20 * conf));
}
export function appealMult(career) { return 0.7 + 0.6 * teamAppeal(career); }   // 0.7 (low appeal) .. 1.3 (high)

// §Phase-6 — season-end awards. "Driver of the Season" rewards PERFORMANCE RELATIVE TO MACHINERY
// (MM-style: a midfield driver who scores big can beat the champion), alongside the champion + top rookie.
export function seasonAwards(career) {
  const champ = driverStandings(career)[0] || null;
  let dots = null, bestScore = -1, rookie = null, bestRookiePts = -1;
  for (const ab in career.driverPts) {
    const pts = career.driverPts[ab] || 0, dr = career.drivers[ab];
    const tier = dr ? dr.teamIdx : Math.floor(TEAMS.length / 2);
    const score = pts / Math.max(1, TEAMS.length - tier);   // points per unit of car strength → overperformance
    if (score > bestScore) { bestScore = score; dots = ab; }
    if (dr && dr.fromAcademy && pts > bestRookiePts) { bestRookiePts = pts; rookie = ab; }
  }
  const nm = ab => (career.drivers[ab] && career.drivers[ab].name) || ab;
  // "Move of the Season" (MotS) at the team level — the constructor that most BEAT its tier expectation
  // (a back-marker that climbs the order is the season's standout, MM-style). Tier = strength rank (0 best).
  let mots = null, bestOver = -1e9;
  for (const s of constructorStandings(career)) {
    const tier = TEAMS.findIndex(t => t.name === s.team);
    const over = (tier + 1) - s.pos;   // finished higher than the tier baseline → positive overperformance
    if (over > bestOver) { bestOver = over; mots = s.team; }
  }
  return {
    champion: champ ? champ.abbrev : null, championName: champ ? nm(champ.abbrev) : null,
    dots, dotsName: dots ? nm(dots) : null, dotsPts: dots ? (career.driverPts[dots] || 0) : 0,
    rookie, rookieName: rookie ? nm(rookie) : null, rookiePts: rookie ? bestRookiePts : 0,
    mots, motsOver: mots ? Math.max(0, bestOver) : 0,   // §Phase-6: constructor that most over-performed its tier
  };
}

// §Phase-6 — the board's dynamic expected best-car finish this race: the car's tier baseline blended
// with where the team currently sits in the championship. Surfaced so you know if you over/under-performed.
export function expectedFinish(career) {
  const cons = constructorStandings(career);
  const me = cons.find(s => s.isPlayer);
  const standing = me ? me.pos : TEAMS.length;
  const tier = (career.teamIdx || 0) + 1;
  return Math.max(1, Math.min(TEAMS.length, Math.round(0.55 * standing + 0.45 * tier)));
}

export function boardOutcome(career) {
  const standings = constructorStandings(career);
  const me = standings.find(s => s.isPlayer);
  const finalPos = me ? me.pos : TEAMS.length;
  const target = career.board.targetPos;
  const met = me ? finalPos <= target : false;
  const confidence = career.board.confidence ?? 0.5;
  // §Phase-6: a mid-season ultimatum failure (career.sacked) is a dismissal regardless of the final standing.
  return { finalPos, target, met, confidence, sacked: !!career.sacked || (!met && confidence < 0.25), midSeason: !!career.sacked, objectives: evaluateObjectives(career) };
}
// start a new season: reset round + points, keep team + money + seed, bump the season number.
export function newSeason(career) {
  const fresh = newCareer({ teamIdx: career.teamIdx, seed: career.seed, coop: career.coop, scoring: career.scoring });
  fresh.season = career.season + 1;
  fresh.money = career.money;
  // §Phase-6 — announce last season's awards (Driver of the Season relative to machinery + top rookie).
  const aw = seasonAwards(career); fresh.lastAwards = aw;
  if (aw.dots) pushNews(fresh, `🏆 Пилот сезона ${career.season}: ${aw.dotsName} (${aw.dotsPts} очк. — лучший результат относительно машины).`);
  if (aw.rookie) pushNews(fresh, `🌟 Новичок сезона: ${aw.rookieName}.`);
  if (aw.mots && aw.motsOver > 0) pushNews(fresh, `📈 Прорыв сезона: «${aw.mots}» — финиш выше уровня команды на ${aw.motsOver} ${aw.motsOver === 1 ? "позицию" : "позиции"}.`);
  // deep-copy carried state so the prior season's career object stays immutable
  fresh.parts = JSON.parse(JSON.stringify(career.parts || {}));     // part development carries over (regs reset below)
  fresh.devSpentThisSeason = 0;
  fresh.loan = career.loan || null;                                 // an outstanding loan carries into the new season
  fresh.capSpent = 0; fresh.seasonPayout = null; fresh.sponsorOffer = null;
  fresh.backer = career.backer || backerFor(TEAMS[career.teamIdx].name);   // backer (may have changed via events) carries over
  fresh.puParts = JSON.parse(JSON.stringify(career.puParts || { power: 0, ers: 0, eff: 0, rel: 0 }));   // engine dev carries (regs trim it below)
  if (fresh.puParts.ers == null) fresh.puParts.ers = 0;
  fresh.puTokens = PU_TOKENS_PER_SEASON;                          // P3: homologation tokens refill each season
  fresh.puContract = career.puContract || "current";             // P4: engine-supply contract carries
  fresh.partsPrev = {};                                          // P2: revert offers don't carry across the winter
  fresh.puProgram = career.puProgram || null; fresh.puProject = null;
  fresh.identity = career.identity || null;                                  // a rebrand carries between seasons
  fresh.gridBoost = { ...(career.gridBoost || {}) };
  fresh.concept = career.concept || "balanced";                              // E3: car concept carries (changeable in winter)
  fresh.chassis = career.chassis || neutralChassis();                        // Phase 4: chassis design carries (per-season redesign UI is a follow-up)
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
  { // aging → retirement: veterans hang up the helmet, rookies fill the seats (demand for academy grads)
    const rp = retirePass(fresh.drivers, fresh.season, (fresh.seed >>> 0) + fresh.season * 4099, fresh.teamIdx);
    for (const r of rp.retired) {
      if (r.wasPlayer) pushNews(fresh, `🏁 ${r.name} (${r.age}) завершил карьеру — в твоём составе освободилось место. Подпиши пилота или подними юниора из академии.`);
      else pushNews(fresh, `🏁 ${r.name} (${r.age}) ушёл на пенсию — «${(TEAMS[r.teamIdx] || {}).name || ""}» ищет замену.`);
    }
    for (const r of rp.rookies) if (!r.wasPlayer) pushNews(fresh, `🌱 Дебютант ${r.name} получил боевое место в «${(TEAMS[r.teamIdx] || {}).name || ""}».`);
  }
  { // academy graduate chronicle: bank each graduate's just-finished season (cumulative F1 record + titles)
    fresh.graduates = JSON.parse(JSON.stringify(career.graduates || []));
    const champ = (driverStandings(career)[0] || {}).abbrev;
    for (const ab in (career.drivers || {})) {
      const dr = career.drivers[ab];
      if (!dr.fromAcademy) continue;
      let g = fresh.graduates.find(x => x.abbrev === ab);
      if (!g) { g = { abbrev: ab, name: dr.name || DRIVER_NAME[ab] || ab, promotedSeason: dr.gradSeason || career.season, seasons: 0, wins: 0, podiums: 0, points: 0, titles: 0, active: true, team: "" }; fresh.graduates.push(g); }
      const st = dr.stats || {};
      g.seasons += 1; g.wins += st.wins || 0; g.podiums += st.podiums || 0; g.points += Math.round(st.points || 0);
      if (ab === champ) { g.titles += 1; pushNews(fresh, `🏆 Выпускник академии ${g.name} — чемпион мира!`); }
      g.team = (TEAMS[dr.teamIdx] || {}).name || g.team;
    }
    for (const g of fresh.graduates) g.active = !!(fresh.drivers && fresh.drivers[g.abbrev]);   // still on the grid?
  }
  for (const a in fresh.drivers) {           // G4: a driver may unlock a new trait from a mastered attr
    const dr = fresh.drivers[a]; dr.request = null; dr._reqNewsed = false;
    const tr = maybeGainTrait(dr); if (tr) pushNews(fresh, `${DRIVER_NAME[a] || a} развил черту «${(TRAITS[tr] || {}).label || tr}».`);
  }
  { // off-season: a rival may sign the player's star if their deal ran out OR a release clause exposes
    // them mid-contract (re-sign in-season / avoid release clauses to keep them).
    const stars = Object.keys(fresh.drivers).filter(ab => { const d = fresh.drivers[ab];
      return d.teamIdx === fresh.teamIdx && (d.overall || 0) >= 0.85 && ((d.contractSeasons || 0) <= 0 || (d.clauses && d.clauses.releaseClause)); });
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
  tickStaffDevelopment(fresh);                // §Phase-5: off-season staff growth toward potential (in-season ratings unchanged → corridor byte-identical)
  fresh.pitCrew = JSON.parse(JSON.stringify(career.pitCrew || initPitCrew((TEAMS[career.teamIdx] || TEAMS[0]).facility, career.seed || 1)));
  { const pcn = tickOffseasonPitCrew(fresh.pitCrew, (fresh.seed >>> 0) + fresh.season * 7321);   // PIT: winter rest + chemistry + injuries
    for (const n of pcn) pushNews(fresh, n); }
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
  fresh.academyTier = career.academyTier || 0;
  fresh.scoutData = JSON.parse(JSON.stringify(career.scoutData || {}));
  fresh.rivalJuniors = JSON.parse(JSON.stringify(career.rivalJuniors || []));   // rival-academy claims carry over
  { const ad = developAcademy(fresh, fresh.season);   // D-v2: feeder seasons (SL + dev + graduation), loans & poaching
    for (const n of (ad.news || [])) pushNews(fresh, n); }
  const { reg, deep } = regResetForCareer(fresh.season, fresh.parts);   // §item-7: cadence reset, DEEPENED when the grid has converged near the ceiling (measured on the carried parts, pre-trim)
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
  if (deep) pushNews(fresh, "🏁 Поле сошлось у потолка — глубокий регламентный сброс перетасовал преимущество и открыл новый виток.");   // §item-7: convergence-triggered deep reset
  const en = eraNote(fresh.season);                            // P5: which parts the new regulation era rewards
  pushNews(fresh, `Регламентная эра ${en.era + 1}: упор на «${PART_LABEL[en.hot] || en.hot}», слабее отдача от «${PART_LABEL[en.cold] || en.cold}».`);
  return fresh;
}
