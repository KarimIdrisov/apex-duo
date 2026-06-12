// ApexWeb/src/overtake.js — pure wheel-to-wheel helpers. Straightness (0..1) comes
// from track.sampleAt(). Driver overtaking/defending attrs arrive in Phase 7.
import { SLIP_K, DIRTY_WEAR, EDGE_REF } from "./data.js";

// slipstream tow (pass-credit/tick) — only on straights; powerful cars tow better.
export function slipstream(straightness, power) {
  return SLIP_K * straightness * power;
}

// extra tyre wear/tick while in dirty air — worse in corners, zero on a clean straight.
export function dirtyWear(straightness) {
  return DIRTY_WEAR * (1 - straightness);
}

// pass-credit accrued this tick: (pace edge + gated tow), faster in braking zones (high straightness),
// boosted by an engine push. The tow AMPLIFIES a real pace edge — it is scaled by clamp(edge/EDGE_REF)
// so a slower/equal car can't build a pass from the slipstream alone (§18.13). Negative edge floored at 0.
export function passAccrual(edge, tow, engine, straightness) {
  const push = engine === "push" ? 1.3 : 1;
  const towEff = tow * Math.max(0, Math.min(1, edge / EDGE_REF));
  return (Math.max(0, edge) + towEff) * push * (0.5 + straightness);
}

// resolve a follower's mini-sector index to the overtake zone it's in, or null (TODO #2b).
export function zoneFor(zones, mini) {
  if (!zones) return null;
  for (const z of zones) if (z.sectors.includes(mini)) return z;
  return null;
}
