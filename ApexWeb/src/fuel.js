// ApexWeb/src/fuel.js — fuel as a hard resource (lap-equivalents of standard burn).
import { ENGINE_MODES, FUEL } from "./data.js";

// §Phase-1 — start fuel load. `margin` is the extra fuel (lap-equivalents) carried over the race distance:
// the player can run LEANER (lighter, faster, but risks running dry) or HEAVIER (safe but slow). Default
// FUEL.margin (the tuned value) → byte-identical for any caller that doesn't pass a margin (AI, harness).
export function startFuel(track, margin) { return track.laps * (1 + (margin == null ? FUEL.margin : margin)); }

// fuel units burned this lap. carFuel (>1 = efficient) defaults to 1 until Phase 7.
export function burnFor(engineMode, carFuel) {
  const m = ENGINE_MODES[engineMode] || ENGINE_MODES.standard;
  return m.burn / (carFuel || 1);
}

// s/lap added by the fuel still aboard (heavy early, ~0 at the end)
export function weightTerm(fuel) { return Math.max(0, fuel) * FUEL.weightK; }

// s/lap engine-mode pace offset (negative = faster)
export function engineTerm(engineMode) {
  const m = ENGINE_MODES[engineMode];
  return m ? m.pace : 0;
}

// how many more laps the current fuel lasts at the current burn (for the gauge)
export function fuelLaps(fuel, engineMode, carFuel) {
  const b = burnFor(engineMode, carFuel);
  return b > 0 ? fuel / b : Infinity;
}
