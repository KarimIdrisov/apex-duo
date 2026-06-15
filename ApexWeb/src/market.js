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

// will the driver accept a move to a team of this competitiveness (0..1, 1 = champions)? A star
// balks at a weak team; ambition (younger) weights competitiveness more. Deterministic via seed.
export function willJoin(driver, teamStrength, seed) {
  const ambition = driver.age <= 28 ? 1 : 0.6;                 // veterans less fussy
  const demand = (driver.overall - 0.78) * 2.2 * ambition;     // how much competitiveness a star demands
  const accept = 0.5 + ((teamStrength ?? 0.5) - demand);
  const roll = mix32(((seed >>> 0) * 2246822519 + 12345) >>> 0) / 4294967296;
  return roll < Math.max(0.05, Math.min(0.97, accept));
}

// negotiate a signing: swap inAbbrev in for outAbbrev (the player's). opts = { teamStrength, seed }.
// Returns { ok, reason }. reason: "деньги" | "отказ" | "перебили" | "ошибка".
export function negotiateSign(career, inAbbrev, outAbbrev, opts = {}) {
  const inDr = career.drivers[inAbbrev], outDr = career.drivers[outAbbrev];
  if (!inDr || !outDr) return { ok: false, reason: "ошибка" };
  if (inDr.teamIdx === career.teamIdx || outDr.teamIdx !== career.teamIdx) return { ok: false, reason: "ошибка" };
  const cost = signCost(inDr);
  if (career.money < cost) return { ok: false, reason: "деньги" };
  const seed = (opts.seed ?? 1) >>> 0;
  if (!willJoin(inDr, opts.teamStrength ?? 0.5, seed)) return { ok: false, reason: "отказ" };
  if ((mix32((seed * 40503 + 777) >>> 0) / 4294967296) < 0.15) return { ok: false, reason: "перебили" };  // a rival outbid
  career.money -= cost;
  const rivalTeam = inDr.teamIdx;
  inDr.teamIdx = career.teamIdx; outDr.teamIdx = rivalTeam;
  inDr.contractSeasons = 3; inDr.morale = Math.min(1, (inDr.morale ?? 0.6) + 0.1);
  return { ok: true, cost };
}
