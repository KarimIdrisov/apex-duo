// ApexWeb/src/events.js — pure deterministic event rolls. Draw from the sim's
// events RNG (erng) so a seed reproduces the same race. Driver attrs come in Phase 7.

// decide if/when a safety car happens. Returns the leader-lap it deploys on, or null.
export function scheduleSC(erng, scProb, laps) {
  if (erng.unit() >= scProb) return null;
  // somewhere in the middle of the race (25%..65% distance)
  return Math.max(1, Math.floor(laps * (0.25 + 0.40 * erng.unit())));
}

// per-car lap-1 start-incident roll.
export function startIncidentHit(erng, prob) {
  return erng.unit() < prob;
}
