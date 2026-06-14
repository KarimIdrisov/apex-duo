// ApexWeb/src/events.js — pure deterministic incident model. Cautions emerge from on-track incidents
// (sim rolls per car per lap with a stateless lap-keyed RNG and calls these helpers).

// probability of an on-track incident for a car this lap. base/pace_risk/composure 0..1; inFight bool.
export function incidentChance(base, pace_risk, composure, inFight, lap, K) {
  const lap1 = lap <= 1 ? K.lap1 : 1;
  const fight = inFight ? K.traffic : 1;
  return base * pace_risk * (1 + K.pressure * (1 - composure)) * fight * lap1;
}

// given an incident occurred, draw whether it brings a caution and which kind. Returns "sc" | "vsc" | null.
export function cautionFromIncident(rng, trackSc, wasDNF, vscShare, K) {
  const weight = wasDNF ? K.scDnf : K.scMinor;
  if (rng.unit() >= trackSc * weight) return null;
  return rng.unit() < vscShare ? "vsc" : "sc";
}
