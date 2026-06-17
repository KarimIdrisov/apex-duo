// ApexWeb/src/academy.js — the junior academy as a real talent pipeline.
//
// Juniors climb a series ladder F4 → F3 → F2 → F1. Each off-season every junior races a
// deterministic feeder season in their current series, earning real-style superlicence points
// (a rolling 3-season window, gate 40) and developing toward a HIDDEN potential that you only
// learn through scouting (a confidence band + stars). You sign juniors to academy contracts;
// rivals poach the uncontracted ones. A ready junior can be given an FP1 programme, kept as
// reserve/test driver, loaned to a rival seat (fee + experience, with a poaching risk) or
// promoted into one of your race seats. Investing in the academy PROGRAMME (tier) develops
// juniors faster, scouts cheaper/deeper, unlocks more slots and attracts higher-ceiling talent.
//
// Pure & deterministic (seeded with mix32) so it mirrors cleanly in the Node balance harness and
// stays netcode-safe. All meta→sim influence still flows only through academyDevBonus().
import { driverAttrs, assignTraits, TRAITS } from "./team.js";
import { mix32 } from "./rng.js";
import { TEAMS } from "./data.js";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const clampOverall = v => clamp(v, 0.50, 0.99);
const rnd = (seed) => mix32(seed >>> 0) / 4294967296;   // deterministic 0..1 from an int seed

// ---- the series ladder -----------------------------------------------------------------------
export const SERIES = ["F4", "F3", "F2"];               // climbing order; "F1" is graduation
export const SERIES_LABEL = { F4: "Ф4", F3: "Ф3", F2: "Ф2", F1: "Ф1" };
export const SERIES_UP = { F4: "F3", F3: "F2", F2: "F1" };
// FIA-style superlicence points by finishing position, per series (descending). F2 is worth most.
export const SL_BY_SERIES = {
  F2: [40, 40, 30, 25, 20, 16, 12, 8, 6, 4, 3, 2],
  F3: [30, 25, 20, 16, 12, 10, 7, 5, 3, 1, 0, 0],
  F4: [12, 10, 7, 5, 3, 1, 0, 0, 0, 0, 0, 0],
};
export const SL_GATE = 40;     // superlicence points (over SL_WINDOW seasons) needed for an F1 seat
export const SL_WINDOW = 3;    // rolling window of seasons counted toward the licence
export const SL_NEEDED = SL_GATE;   // back-compat alias

// ---- academy programme (a buy-vs-wait facility tier) -----------------------------------------
export const TIER_MAX = 5;
export const TIER_LABEL = ["Любительская", "Региональная", "Признанная", "Топ-программа", "Элитная", "Легендарная"];
export function upgradeCost(tier) { return 1500 * (tier + 1); }            // $k to reach tier+1
export function programSlots(tier) { return 2 + tier; }                    // how many juniors you can hold
export function programDevRate(tier) { return 1 + tier * 0.13; }           // junior growth multiplier
export function programScoutStep(tier) { return 0.16 + tier * 0.05; }      // scouting reveal per $ step

// ---- scouting --------------------------------------------------------------------------------
export const SCOUT_STEP_FEE = 220;   // $k to commission another scouting report on a prospect
export const SCOUT_FEE = 800;        // base sign-on (scaled by ceiling) — kept for back-compat refs

// ---- archetypes: a junior's headline trait (drives the card tag + their dev focus) -----------
export const ARCHETYPE = {
  qualifier:      "Квалифайер",
  wet_master:     "Дождевик",
  overtaker:      "Атакующий",
  tyre_whisperer: "Бережёт резину",
  ice_cold:       "Хладнокровный",
  strategist:     "Гений гонки",
  defender:       "Скала",
  starter:        "Реактивный старт",
};

// Personalities — a junior's character shapes loyalty, morale and demands (not raw pace).
export const PERSONA = {
  loyal:     { label: "Преданный",   desc: "редко уходит к сопернику, дешевле продлевать" },
  mercenary: { label: "Наёмник",     desc: "высокий риск ухода, дорогое продление" },
  hothead:   { label: "Вспыльчивый", desc: "падает мораль без игрового времени, нестабилен" },
  ambitious: { label: "Амбициозный", desc: "растёт быстрее, но рвётся в Ф1 — не держи на скамейке" },
};

// The scoutable prospect pool: fictional young drivers across the ladder. `pot` is the HIDDEN
// ceiling (revealed only by scouting). `minTier` gates the brightest talents behind a real
// academy programme. `persona` shapes loyalty/morale. Abbrevs avoid the 2026 grid's.
export const JUNIOR_POOL = [
  { abbrev: "VIL", name: "Виллагомес",  age: 16, series: "F4", overall: 0.61, pot: 0.94, tag: "overtaker",      minTier: 2, persona: "ambitious" },
  { abbrev: "DUN", name: "Данн",        age: 17, series: "F4", overall: 0.60, pot: 0.91, tag: "qualifier",      minTier: 1, persona: "loyal" },
  { abbrev: "KOV", name: "Ковальски",   age: 16, series: "F4", overall: 0.58, pot: 0.88, tag: "ice_cold",      minTier: 1, persona: "hothead" },
  { abbrev: "STN", name: "Стенсхорн",   age: 17, series: "F3", overall: 0.66, pot: 0.92, tag: "wet_master",    minTier: 2, persona: "mercenary" },
  { abbrev: "BAR", name: "Барнард",     age: 18, series: "F3", overall: 0.68, pot: 0.89, tag: "strategist",    minTier: 1, persona: "loyal" },
  { abbrev: "MTS", name: "Мартинс",     age: 18, series: "F3", overall: 0.70, pot: 0.90, tag: "overtaker",     minTier: 1, persona: "ambitious" },
  { abbrev: "AKI", name: "Аоки",        age: 18, series: "F3", overall: 0.67, pot: 0.84, tag: "tyre_whisperer", minTier: 0, persona: "loyal" },
  { abbrev: "DOO", name: "Дуэн",        age: 19, series: "F2", overall: 0.76, pot: 0.91, tag: "qualifier",      minTier: 2, persona: "ambitious" },
  { abbrev: "OSU", name: "О'Салливан",  age: 20, series: "F2", overall: 0.78, pot: 0.86, tag: "strategist",    minTier: 0, persona: "hothead" },
  { abbrev: "HIR", name: "Хиракава",    age: 20, series: "F2", overall: 0.79, pot: 0.85, tag: "ice_cold",      minTier: 0, persona: "loyal" },
  { abbrev: "REY", name: "Рейес",       age: 19, series: "F2", overall: 0.74, pot: 0.88, tag: "defender",      minTier: 1, persona: "mercenary" },
  { abbrev: "FAB", name: "Фабри",       age: 21, series: "F2", overall: 0.80, pot: 0.83, tag: "starter",       minTier: 0, persona: "ambitious" },
];

// per-series filler fields the academy juniors race against (names invented; overalls by tier).
export const FILLER = {
  F2: [0.81, 0.79, 0.77, 0.75, 0.73, 0.71, 0.69, 0.67, 0.65, 0.63],
  F3: [0.72, 0.70, 0.68, 0.66, 0.64, 0.62, 0.60, 0.58, 0.56, 0.54],
  F4: [0.64, 0.62, 0.60, 0.58, 0.56, 0.54, 0.52, 0.50, 0.50, 0.50],
};
const FILLER_NAMES = ["Фиттипальди", "Браунинг", "Марти", "Кроуфорд", "Аль-Дхаэри", "Вершор",
  "Бенавидес", "Касер", "Линдблад", "Леклер-мл.", "Монтойя", "Дзампьери"];

// ---- helpers ---------------------------------------------------------------------------------
export function programTier(career) { return Math.max(0, Math.min(TIER_MAX, career.academyTier || 0)); }
export function superlicensePts(j) { return (j.slHist || []).reduce((a, b) => a + b, 0); }
export function eligible(j) { return superlicensePts(j) >= SL_GATE; }

// A scouting estimate of a hidden potential: a confidence band [lo,hi] + 1..5 stars. At low
// confidence the band is wide and its centre is deterministically offset (you can be misled);
// scouting narrows the band and pulls the centre to the truth.
export function scoutBand(prospect, scout) {
  const s = clamp(scout || 0, 0, 1);
  const bias = (rnd(prospect.abbrev.charCodeAt(0) * 911 + (prospect.abbrev.charCodeAt(1) || 5) * 37) - 0.5) * 0.16;
  const centre = clamp(prospect.pot + bias * (1 - s), 0.55, 0.99);
  const half = (0.16 * (1 - s)) + 0.012;
  return { lo: clamp(centre - half, 0.5, 0.99), hi: clamp(centre + half, 0.5, 0.99), stars: 1 + Math.round(s * 4) };
}

// sign-on fee scales with the (scouted) ceiling — a brighter prospect costs more.
export function signCostJunior(prospect, scout) {
  const band = scoutBand(prospect, scout);
  const est = (band.lo + band.hi) / 2;
  return Math.round((400 + Math.max(0, est - 0.78) * 9000) / 10) * 10;   // ~$0.4M..$2.3M
}

// prospects available to scout/sign: pool minus those already signed or already on the grid,
// gated by the academy programme tier.
export function availableJuniors(career) {
  const tier = programTier(career);
  const taken = new Set([...(career.academy || []).map(j => j.abbrev), ...Object.keys(career.drivers || {}), ...(career.rivalJuniors || [])]);
  return JUNIOR_POOL.filter(j => !taken.has(j.abbrev) && (j.minTier || 0) <= tier);
}
// is a prospect being courted by rival academies (urgency cue)? bright, unsigned, unlocked talents.
export function rivalCourting(career, prospect) {
  if (!prospect || prospect.pot < 0.88) return false;
  const taken = new Set([...(career.academy || []).map(j => j.abbrev), ...(career.rivalJuniors || [])]);
  return !taken.has(prospect.abbrev) && (prospect.minTier || 0) <= programTier(career) + 1;
}
export function scoutOf(career, abbrev) { return (career.scoutData && career.scoutData[abbrev]) || 0; }

// commission a scouting report on a pool prospect: raises confidence (diminishing), tier helps.
export function scoutProspect(career, abbrev) {
  if (career.money < SCOUT_STEP_FEE) return false;
  if (!JUNIOR_POOL.some(p => p.abbrev === abbrev)) return false;
  career.money -= SCOUT_STEP_FEE;
  career.scoutData = career.scoutData || {};
  const cur = career.scoutData[abbrev] || 0;
  career.scoutData[abbrev] = clamp(cur + programScoutStep(programTier(career)) * (1 - cur), 0, 1);
  return true;
}

// sign a scouted prospect into the academy (consumes a programme slot).
export function signJunior(career, abbrev) {
  career.academy = career.academy || [];
  if (career.academy.length >= programSlots(programTier(career))) return false;   // no free slot
  if (career.academy.some(j => j.abbrev === abbrev)) return false;
  const p = JUNIOR_POOL.find(x => x.abbrev === abbrev);
  if (!p || (p.minTier || 0) > programTier(career)) return false;
  const scout = scoutOf(career, abbrev);
  const fee = signCostJunior(p, scout);
  if (career.money < fee) return false;
  career.money -= fee;
  career.academy.push({
    abbrev: p.abbrev, name: p.name, age: p.age, series: p.series,
    overall: p.overall, potTrue: p.pot, tag: p.tag, persona: p.persona || "loyal", morale: 0.7,
    scout: clamp(scout + 0.25, 0, 1),   // signing reveals more than an outside report
    slHist: [Math.max(0, Math.round((p.overall - 0.62) * 30))],   // a little pedigree on signing
    contract: 3, role: null, loanedTo: null,
  });
  return true;
}

// pay to extend a junior's academy contract (keeps rivals from poaching them).
export const EXTEND_FEE = 350;
// a junior's persona changes the price of a contract extension (mercenaries hold out, loyals are cheap).
export function extendCost(j) {
  const k = j && j.persona === "mercenary" ? 1.8 : j && j.persona === "loyal" ? 0.6 : 1;
  return Math.round(EXTEND_FEE * k / 10) * 10;
}
export function extendJunior(career, abbrev) {
  const j = (career.academy || []).find(x => x.abbrev === abbrev);
  if (!j) return false;
  const cost = extendCost(j);
  if (career.money < cost) return false;
  career.money -= cost;
  j.contract = Math.min(4, (j.contract || 0) + 2);
  j.morale = clamp((j.morale ?? 0.7) + 0.06, 0, 1);   // being kept lifts spirits
  return true;
}

// toggle a junior's development role. Only one reserve and one FP1 driver at a time.
export function setRole(career, abbrev, role) {
  const j = (career.academy || []).find(x => x.abbrev === abbrev);
  if (!j) return false;
  if (j.role === role) { j.role = null; return true; }       // toggle off
  if (role === "reserve" || role === "fp1") {
    for (const o of career.academy) if (o.role === role) o.role = null;   // unique slot
    j.role = role;
  }
  return true;
}

// loan a junior to a rival seat for a season: big experience + a fee, but a poaching risk.
export const LOAN_FEE = 600;   // $k you receive (booked at season roll)
export function loanJunior(career, abbrev, team) {
  const j = (career.academy || []).find(x => x.abbrev === abbrev);
  if (!j) return false;
  j.loanedTo = j.loanedTo === team ? null : (team || null);   // toggle / set
  if (j.loanedTo) j.role = null;                              // loaned out → no home role
  return true;
}
export function loanTeams(career) {
  // rival teams (by grid index) a junior can be loaned to — drivers carry teamIdx, not a team name.
  return TEAMS.map((t, i) => ({ name: t.name, i })).filter(t => t.i !== career.teamIdx).map(t => t.name);
}

// upgrade the academy programme one tier.
export function upgradeProgram(career) {
  const tier = programTier(career);
  if (tier >= TIER_MAX) return false;
  const cost = upgradeCost(tier);
  if (career.money < cost) return false;
  career.money -= cost;
  career.academyTier = tier + 1;
  return true;
}

// ---- the off-season engine -------------------------------------------------------------------
// Run one feeder season for a series: the academy juniors in that series + filler ranked by form.
// Returns standings [{pos,name,abbrev,pts,mine}]. Pure & deterministic.
export function runFeeder(career, series, seed) {
  const s = (seed >>> 0) || 1;
  const juniors = (career.academy || []).filter(j => j.series === series);
  const field = [
    ...juniors.map(j => ({ abbrev: j.abbrev, name: j.name, overall: j.overall, mine: true, _j: j })),
    ...FILLER[series].map((ov, i) => ({ abbrev: null, name: FILLER_NAMES[i % FILLER_NAMES.length], overall: ov, _f: i })),
  ];
  for (const e of field) {
    const key = e.abbrev ? (e.abbrev.charCodeAt(0) * 131 + (e.abbrev.charCodeAt(1) || 7)) : (9000 + e._f * 53);
    e._form = e.overall + (rnd(s * 2654435761 + key + series.charCodeAt(1) * 17) - 0.5) * 0.06;
  }
  field.sort((a, b) => b._form - a._form);
  return field.map((e, pos) => ({ pos: pos + 1, name: e.name, abbrev: e.abbrev, mine: !!e.mine, pts: SL_BY_SERIES[series][pos] || 0 }));
}

// Advance the whole academy one season: feeder results → SL points + development + graduation,
// loan payouts/poaching, programme effects, then rival poaching of uncontracted standouts.
// Mutates `career`; returns { feeder:{series:standings}, news:[...] }.
export function developAcademy(career, seed) {
  const s = (seed >>> 0) || 1;
  career.academy = career.academy || [];
  const tier = programTier(career);
  const devRate = programDevRate(tier);
  const news = [];
  const feeder = {};

  // 1) run a feeder season per series and apply per-junior results
  for (const series of SERIES) {
    const standings = runFeeder(career, series, s + series.charCodeAt(1));
    feeder[series] = standings.slice(0, 10);
    for (const r of standings) {
      if (!r.mine) continue;
      const j = career.academy.find(x => x.abbrev === r.abbrev);
      if (!j) continue;
      // FP1 outings & loans add experience on top of the feeder result.
      const fp1 = j.role === "fp1" ? 4 : 0;
      const loan = j.loanedTo ? 6 : 0;
      const earned = (r.pts || 0) + fp1 + loan;
      j.slHist = [earned, ...(j.slHist || [])].slice(0, SL_WINDOW);
      const rq = 1 - (r.pos - 1) / standings.length;          // result quality 0..1 (1 = won)
      const roleK = (j.role === "reserve" ? 1.15 : j.role === "fp1" ? 1.25 : 1) * (j.loanedTo ? 1.35 : 1);
      const moraleK = 0.85 + 0.3 * (j.morale ?? 0.7);   // a happy junior develops faster (0.85..1.15)
      const head = Math.max(0, j.potTrue - j.overall);
      j.overall = clampOverall(j.overall + head * (0.18 + 0.16 * rq) * devRate * roleK * moraleK * 0.5);
      j._lastPos = r.pos;
      // graduation is DEFERRED (applied after all series run) so a junior climbs at most one
      // rung per off-season and isn't re-entered into the next series' race the same year.
      if (r.pos <= 3 && SERIES_UP[j.series] && SERIES_UP[j.series] !== "F1") j._grad = SERIES_UP[j.series];
      else if (r.pos <= 2 && j.series === "F2") news.push(`🏆 ${j.name} в топ-2 Ф2 — на пороге Формулы 1.`);
    }
  }
  for (const j of career.academy) {   // apply the one-rung-per-season graduation
    if (j._grad) { news.push(`🎓 ${j.name} поднялся ${SERIES_LABEL[j.series]} → ${SERIES_LABEL[j._grad]}.`); j.series = j._grad; delete j._grad; }
  }
  career.lastFeeder = feeder;

  // 2) age, contracts, morale (persona-driven), scouting, loans resolve
  const someoneFavoured = career.academy.some(o => o.role || o.loanedTo);
  for (const j of career.academy) {
    j.age += 1;
    j.contract = Math.max(0, (j.contract || 0) - 1);
    j.scout = clamp((j.scout || 0) + 0.08, 0, 1);   // a year in the programme reveals more
    // morale drift by how the junior is treated, coloured by persona; decays toward 0.7
    let dm = (j.role || j.loanedTo) ? 0.06 : 0;
    if (j.persona === "hothead" && !j.role && !j.loanedTo && someoneFavoured) dm -= 0.10;   // sees a sibling favoured
    if (j.persona === "ambitious" && eligible(j) && !j.loanedTo) dm -= 0.12;                // ready for F1, stuck on the bench
    if (j.persona === "loyal") dm += 0.03;
    j.morale = clamp((j.morale ?? 0.7) + dm + (0.7 - (j.morale ?? 0.7)) * 0.10, 0, 1);
    if (j.loanedTo) {
      career.money += LOAN_FEE;
      news.push(`💼 Аренда ${j.name} в «${j.loanedTo}» принесла $${(LOAN_FEE / 1000).toFixed(1)}M.`);
      // the host team may try to keep a star permanently
      if (eligible(j) && rnd(s + j.abbrev.charCodeAt(0) * 277) < 0.18) {
        news.push(`⚠ «${j.loanedTo}» хочет выкупить ${j.name} из аренды — верни его или потеряешь.`);
      }
      j.loanedTo = null;   // loan is one season
    }
  }

  // 3) rivals poach bright juniors — persona & morale set the odds. Uncontracted+role-less is the
  //    usual exposure; an unhappy/ambitious star can force a move even mid-contract.
  const survivors = [];
  for (const j of career.academy) {
    const bright = j.potTrue >= 0.86 && j.overall >= 0.72;
    const exposed = (j.contract || 0) <= 0 && !j.role;
    const forced = (j.morale ?? 0.7) < 0.35 || (j.persona === "ambitious" && eligible(j) && (j.morale ?? 0.7) < 0.55);
    if (bright && (exposed || forced)) {
      const pK = j.persona === "loyal" ? 0.3 : j.persona === "mercenary" ? 1.6 : j.persona === "ambitious" ? 1.3 : 1;
      const mK = (j.morale ?? 0.7) < 0.4 ? 1.5 : 1;
      const base = forced && !exposed ? 0.35 : 0.5;
      if (rnd(s + j.abbrev.charCodeAt(0) * 613 + 5) < Math.min(0.95, base * pK * mK)) {
        news.push(`🏴 Соперник переманил ${j.name}${exposed ? " — контракт истёк" : " — недоволен ролью в академии"}.`);
        continue;   // junior leaves
      }
    }
    survivors.push(j);
  }
  career.academy = survivors;

  // 4) rival academies sign loose talent from the open pool — the brightest unclaimed prospects get
  //    courted away each off-season, so dawdling on scouting costs you the best juniors.
  career.rivalJuniors = career.rivalJuniors || [];
  const claimed = new Set([...career.rivalJuniors, ...career.academy.map(j => j.abbrev), ...Object.keys(career.drivers || {})]);
  const openPool = JUNIOR_POOL.filter(p => !claimed.has(p.abbrev)).sort((a, b) => b.pot - a.pot);
  let claims = 0;
  for (const p of openPool) {
    if (claims >= 2) break;                                          // up to two prospects poached per winter
    const chance = clamp(0.22 + 0.55 * (p.pot - 0.82), 0, 0.85);     // brighter → more likely courted
    if (rnd(s + p.abbrev.charCodeAt(0) * 733 + 3) < chance) {
      career.rivalJuniors.push(p.abbrev);
      news.push(`🏴 Академия соперника подписала проспекта ${p.name} (потенциал ${Math.round(p.pot * 100)}).`);
      claims++;
    }
  }
  return { feeder, news };
}

// promote a ready junior into a race seat, retiring `outAbbrev` (must be one of yours).
export function promoteJunior(career, juniorAbbrev, outAbbrev) {
  const ji = (career.academy || []).findIndex(j => j.abbrev === juniorAbbrev);
  if (ji < 0) return false;
  const j = career.academy[ji];
  if (!eligible(j)) return false;                                   // superlicence gate (40 pts)
  const out = career.drivers[outAbbrev];
  if (!out || out.teamIdx !== career.teamIdx) return false;
  delete career.drivers[outAbbrev];
  career.drivers[juniorAbbrev] = {
    teamIdx: career.teamIdx, age: j.age, overall: j.overall, morale: 0.72,
    contractSeasons: 3, salary: 200, name: j.name, team: (career._myTeamName || ""),
    attrs: driverAttrs(juniorAbbrev, j.overall), traits: (TRAITS[j.tag] ? [j.tag] : assignTraits(juniorAbbrev)),
    training: null, status: "equal", form: 0.5,
    fromAcademy: true, gradSeason: career.season || 1,   // chronicle: this driver is an academy product
  };
  if (career.driverPts) career.driverPts[juniorAbbrev] = career.driverPts[juniorAbbrev] || 0;
  career.academy.splice(ji, 1);
  return true;
}

// ---- meta → sim influence (the ONLY hook into development) ------------------------------------
export function personaLabel(p) { return (PERSONA[p] && PERSONA[p].label) || ""; }
export function reserveBonus(role) { return role === "reserve" ? 0.06 : role === "fp1" ? 0.03 : 0.02; }
export function academyDevBonus(career) {
  const tierBase = programTier(career) * 0.012;
  const juniors = (career.academy || []).reduce((acc, j) => acc + reserveBonus(j.role), 0);
  return tierBase + juniors;
}
