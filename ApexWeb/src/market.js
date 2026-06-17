// ApexWeb/src/market.js — pure driver transfer market. Transfers swap two drivers between teams
// (the registry's teamIdx is the source of truth), so every team always keeps exactly 2 drivers.
import { mix32 } from "./rng.js";

// transfer fee ($k) — steep with overall, discounted for older drivers.
export function driverValue(driver) {
  const ageFactor = driver.age <= 30 ? 1 : Math.max(0.4, 1 - (driver.age - 30) * 0.06);
  return Math.round((2000 + Math.pow(Math.max(0, driver.overall - 0.7), 1.7) * 60000) * ageFactor);
}

// drivers available to sign (everyone not on the player team), best first, with a value.
export function availableDrivers(career) {
  return Object.keys(career.drivers)
    .filter(ab => career.drivers[ab].teamIdx !== career.teamIdx)
    .map(ab => ({ abbrev: ab, ...career.drivers[ab], value: driverValue(career.drivers[ab]) }))
    .sort((a, b) => b.overall - a.overall);
}

// sign inAbbrev (a rival) by swapping with outAbbrev (one of the player's drivers). Pays the fee.
export function signDriver(career, inAbbrev, outAbbrev) {
  const inDr = career.drivers[inAbbrev], outDr = career.drivers[outAbbrev];
  if (!inDr || !outDr) return false;
  if (inDr.teamIdx === career.teamIdx || outDr.teamIdx !== career.teamIdx) return false;   // in = rival, out = mine
  const fee = driverValue(inDr);
  if (career.money < fee) return false;
  career.money -= fee;
  const rivalTeam = inDr.teamIdx;
  inDr.teamIdx = career.teamIdx;          // joins the player
  outDr.teamIdx = rivalTeam;              // dropped driver takes the rival seat (swap keeps both at 2)
  inDr.morale = Math.min(1, inDr.morale + 0.1);
  inDr.contractSeasons = 3;
  return true;
}

// deterministic season-end AI churn: a couple of swaps among AI teams to keep the grid alive.
export function aiChurn(career, seed) {
  const ai = Object.keys(career.drivers).filter(ab => career.drivers[ab].teamIdx !== career.teamIdx);
  const events = [];
  for (let k = 0; k < 2 && ai.length >= 2; k++) {
    const r = mix32(((seed >>> 0) + k * 40503) >>> 0);
    const a = ai[r % ai.length], b = ai[(r >>> 8) % ai.length];
    const da = career.drivers[a], db = career.drivers[b];
    if (a === b || da.teamIdx === db.teamIdx) continue;     // need two different AI teams
    const ta = da.teamIdx; da.teamIdx = db.teamIdx; db.teamIdx = ta;
    events.push({ a, b });
  }
  return events;
}

// --- D4: contracts & negotiation ---

// a driver whose contract has run out is a free agent — no buyout, more willing to move.
export function freeAgent(driver) { return (driver.contractSeasons || 0) <= 0; }
// $k to prise a contracted driver from their deal (0 for a free agent).
export function buyout(driver) { return freeAgent(driver) ? 0 : Math.round((driver.salary || 0) * driver.contractSeasons * 1.5); }
// total cost to sign: transfer value + buyout.
export function signCost(driver) { return driverValue(driver) + buyout(driver); }

// interest 0..1 — how willing a driver is to join a team of `teamStrength` (1 = champions). A star
// balks at a weak team; ambition (younger) weights competitiveness more. A longer offered contract adds
// a little security appeal. This is the acceptance probability surfaced in the UI before you bid.
export function interest(driver, teamStrength, length = 2) {
  const ambition = driver.age <= 28 ? 1 : 0.6;                 // veterans less fussy
  const demand = (driver.overall - 0.78) * 2.2 * ambition;     // how much competitiveness a star demands
  const lenBonus = (length - 2) * 0.05;                        // 3yr +0.05 (security), 1yr −0.05
  return Math.max(0.05, Math.min(0.97, 0.5 + ((teamStrength ?? 0.5) - demand) + lenBonus));
}
export function willJoin(driver, teamStrength, seed, length = 2) {
  const roll = mix32(((seed >>> 0) * 2246822519 + 12345) >>> 0) / 4294967296;
  return roll < interest(driver, teamStrength, length);
}
// total cost of a signing at an offered contract length (longer = more guaranteed salary → costlier).
const LEN_MULT = { 1: 0.85, 2: 1.0, 3: 1.2 };
// contract clauses the player can attach when signing (deep contracts):
//  bonuses  — performance pay (podium/win/title) for a lower upfront fee (driver trades fixed for variable)
//  lead     — guaranteed #1 status: the driver is more willing to join
//  release  — a release clause: cheaper now, but a rival can trigger it to poach them mid-deal
export const CLAUSE = {
  podiumBonus: 300, winBonus: 800, titleBonus: 3000,   // $k payouts
  bonusesDiscount: 0.88, releaseDiscount: 0.82, leadInterest: 0.08, releaseMult: 1.3,
};
function clauseMult(clauses) {
  let m = 1;
  if (clauses && clauses.bonuses) m *= CLAUSE.bonusesDiscount;
  if (clauses && clauses.release) m *= CLAUSE.releaseDiscount;
  return m;
}
export function signCostAt(driver, length = 2, clauses = null) {
  return Math.round(signCost(driver) * (LEN_MULT[length] || 1) * clauseMult(clauses));
}
// the clause object stamped onto a driver at signing (and its release value for rivals).
export function buildClauses(driver, clauses) {
  const cl = clauses || {};
  return {
    winBonus: cl.bonuses ? CLAUSE.winBonus : 0, podiumBonus: cl.bonuses ? CLAUSE.podiumBonus : 0,
    titleBonus: cl.bonuses ? CLAUSE.titleBonus : 0, guaranteedLead: !!cl.lead,
    releaseClause: cl.release ? Math.round(signCost(driver) * CLAUSE.releaseMult) : 0,
  };
}

// the agent's counter-offer when a driver is BORDERLINE (would refuse, but a sweetener closes it).
// Deterministic from the offer seed. kinds: "money" (+20% fee), "lead" (#1 guarantee), "length" (3yr).
export const COUNTER_MARGIN = 0.20;   // how far below acceptance still triggers a counter (vs a flat no)
export function buildCounter(inDr, opts, seed) {
  const cl = opts.clauses || {};
  const pick = mix32(((seed >>> 0) * 2654435761 + 91) >>> 0) % 3;
  if (pick === 1 && !cl.lead) return { kind: "lead", label: "требует гарантию статуса №1" };
  if (pick === 2 && (opts.length || 2) < 3) return { kind: "length", label: "хочет контракт на 3 сезона" };
  return { kind: "money", feeMult: 1.20, label: "требует выше гонорар (+20%)" };
}
// apply a counter's terms onto an offer opts → the sweetened opts used for the forced re-sign.
export function applyCounter(opts, counter) {
  const o = { ...opts, clauses: { ...(opts.clauses || {}) }, force: true };
  if (!counter) return o;
  if (counter.kind === "lead") o.clauses.lead = true;
  if (counter.kind === "length") o.length = 3;
  if (counter.kind === "money") o.feeMult = (o.feeMult || 1) * (counter.feeMult || 1.2);
  return o;
}

// negotiate a signing: swap inAbbrev in for outAbbrev (the player's).
// opts = { teamStrength, seed, length, clauses, force?, feeMult? }.
// Returns { ok, reason, counter? }. reason: "деньги" | "отказ" | "counter" | "перебили" | "ошибка".
export function negotiateSign(career, inAbbrev, outAbbrev, opts = {}) {
  const inDr = career.drivers[inAbbrev], outDr = career.drivers[outAbbrev];
  if (!inDr || !outDr) return { ok: false, reason: "ошибка" };
  if (inDr.teamIdx === career.teamIdx || outDr.teamIdx !== career.teamIdx) return { ok: false, reason: "ошибка" };
  const length = Math.max(1, Math.min(3, opts.length || 2));
  const clauses = opts.clauses || null;
  const cost = Math.round(signCostAt(inDr, length, clauses) * (opts.feeMult || 1));
  if (career.money < cost) return { ok: false, reason: "деньги" };
  const seed = (opts.seed ?? 1) >>> 0;
  const roll = mix32((seed * 2246822519 + 12345) >>> 0) / 4294967296;     // accept roll (+lead clause sweetens)
  const accept = interest(inDr, opts.teamStrength ?? 0.5, length) + (clauses && clauses.lead ? CLAUSE.leadInterest : 0);
  if (!opts.force && roll >= accept) {
    // borderline? the agent counters with a demand the player can accept; otherwise a flat refusal.
    if (roll < accept + COUNTER_MARGIN) return { ok: false, reason: "counter", counter: buildCounter(inDr, opts, seed) };
    return { ok: false, reason: "отказ" };
  }
  if (!opts.force && (mix32((seed * 40503 + 777) >>> 0) / 4294967296) < 0.15) return { ok: false, reason: "перебили" };  // a rival outbid
  career.money -= cost;
  career.capSpent = (career.capSpent || 0) + cost;   // cost-cap accounting
  const built = buildClauses(inDr, clauses);
  const rivalTeam = inDr.teamIdx;
  inDr.teamIdx = career.teamIdx; outDr.teamIdx = rivalTeam;
  inDr.contractSeasons = length; inDr.morale = Math.min(1, (inDr.morale ?? 0.6) + 0.1);
  inDr.clauses = built;
  if (built.guaranteedLead) { inDr.status = "lead"; if (outDr) outDr.status = "equal"; }   // #1 guarantee
  return { ok: true, cost };
}

// rumors: which of the player's drivers a rival covets (high overall + their deal running down). Used for
// the "интерес соперников" warnings and the off-season poach risk. Returns [{abbrev, by}].
export function rivalInterest(career) {
  const out = [];
  for (const ab in (career.drivers || {})) { const d = career.drivers[ab];
    if (d.teamIdx !== career.teamIdx) continue;
    const expiring = (d.contractSeasons ?? 9) <= 1;
    const release = !!(d.clauses && d.clauses.releaseClause);   // a release clause exposes a star even mid-deal
    if ((d.overall || 0) >= 0.85 && (expiring || release)) out.push({ abbrev: ab, overall: d.overall, release });
  }
  return out;
}
