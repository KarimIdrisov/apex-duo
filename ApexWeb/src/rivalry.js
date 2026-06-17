// ApexWeb/src/rivalry.js — personal driver rivalries. Each of your drivers has a rival on another
// team (the closest-overall benchmark). Beating them on track lifts morale; losing to them stings;
// their wheel-to-wheel passes are flagged for the commentary as a "duel". Pure & deterministic.

// pick a rival for `abbrev`: the closest-overall driver on a DIFFERENT team. Deterministic
// (ties broken by abbrev order). Returns the rival's abbrev or null.
export function pickRival(drivers, abbrev) {
  const me = drivers && drivers[abbrev]; if (!me) return null;
  let best = null, bestD = Infinity;
  for (const ab of Object.keys(drivers).sort()) {
    const d = drivers[ab];
    if (ab === abbrev || d.teamIdx === me.teamIdx) continue;
    const diff = Math.abs((d.overall || 0) - (me.overall || 0));
    if (diff < bestD) { bestD = diff; best = ab; }
  }
  return best;
}

// ensure every player-team driver has a VALID rival (assign/repair). Mutates drivers. Returns count set.
export function ensureRivals(drivers, teamIdx) {
  if (!drivers) return 0;
  let n = 0;
  for (const ab of Object.keys(drivers)) {
    const d = drivers[ab];
    if (d.teamIdx !== teamIdx) continue;
    const valid = d.rival && drivers[d.rival] && drivers[d.rival].teamIdx !== teamIdx;
    if (!valid) { d.rival = pickRival(drivers, ab); n++; }
  }
  return n;
}

// morale swing from a race finish vs the rival: + if you finished ahead, − if behind, 0 if no rival/DNF.
export function rivalMoraleDelta(myPos, rivalPos) {
  if (myPos == null || rivalPos == null) return 0;
  return myPos < rivalPos ? 0.05 : -0.05;
}
