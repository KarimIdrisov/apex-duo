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
