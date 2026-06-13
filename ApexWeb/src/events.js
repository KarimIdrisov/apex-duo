// ApexWeb/src/events.js — pure deterministic event rolls. Draw from the sim's
// events RNG (erng) so a seed reproduces the same race. Driver attrs come in Phase 7.

// decide if/when a caution happens. Returns { lap, vsc } (the leader-lap it deploys on + whether it's a
// Virtual SC), or null. vscShare of cautions are a VSC (uniform delta, no bunching); the rest a full SC.
export function scheduleSC(erng, scProb, laps, vscShare = 0) {
  if (erng.unit() >= scProb) return null;
  // somewhere in the middle of the race (25%..65% distance)
  const lap = Math.max(1, Math.floor(laps * (0.25 + 0.40 * erng.unit())));
  const vsc = erng.unit() < vscShare;
  return { lap, vsc };
}
