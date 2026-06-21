// ApexWeb/src/parts.js — §Phase-2 in-race part condition model. Pure & deterministic.
// Each part has a condition 1..0 that wears down over the race under stress (engine mode, pace) and is
// slowed by reliability (car.rel). In the red zone a part can fail: a critical part (engine/gearbox)
// retires the car (replacing the flat DNF roll); a non-critical one (brakes) costs pace + forces a pit.
import { PARTS, PART_WEAR } from "./data.js";

export const PART_KEYS = Object.keys(PARTS);

// fresh condition vector (all green)
export function initParts() { const p = {}; for (const k of PART_KEYS) p[k] = 1; return p; }

// reliability factor: a sturdier car (higher rel) wears its parts slower. Centered on the ~field-mean
// rel (0.85) so the spread, not the absolute, moves wear. Floored so it never goes non-positive.
export function relFactor(rel) { return Math.max(0.2, 1 - PART_WEAR.relK * ((rel ?? 0.85) - 0.85)); }

// condition lost by one part this lap. stress >= ~0.5 (1 = nominal); higher mode/pace stress wears faster.
export function partWear(part, stress, rel) {
  return PARTS[part].base * Math.max(0.4, stress) * relFactor(rel);
}

// zone of a condition value: green (safe) > yellow (watch) > red (failure risk)
export function partZone(cond) { return cond > PART_WEAR.yellow ? "green" : cond > PART_WEAR.red ? "yellow" : "red"; }

// per-lap failure probability for a part: 0 above the red threshold, rising linearly to failK at cond 0.
export function failChance(cond) {
  if (cond > PART_WEAR.red) return 0;
  return PART_WEAR.failK * (PART_WEAR.red - cond) / PART_WEAR.red;
}

// the worst (lowest-condition) part, for HUD + attributing a failure
export function worstPart(parts) {
  let k = PART_KEYS[0];
  for (const p of PART_KEYS) if ((parts[p] ?? 1) < (parts[k] ?? 1)) k = p;
  return k;
}
