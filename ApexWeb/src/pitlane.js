// ApexWeb/src/pitlane.js — pure helpers for the pit-lane drive animation (render-only). No imports.
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (t) => t * t * (3 - 2 * t);                       // smoothstep ease
function fwd(a, b, t) { const d = ((b - a) % 1 + 1) % 1; return ((a + d * t) % 1 + 1) % 1; }   // forward along the lap

// position along the pit lane at `phase` 0..1. box is implicitly frac 0 (start/finish).
// [0,0.5): in-lap entry->0, latUnit 0->side ; [0.5,1]: out-lap 0->exit, latUnit side->0.
// returns { frac (0..1), latUnit (-1..1; box depth = ±1) }; each renderer scales latUnit by width×halfWidth.
export function pitLaneSample(phase, lane) {
  const { entry = 0.95, exit = 0.06, side = 1 } = lane || {};
  const p = clamp01(phase);
  if (p < 0.5) { const t = p / 0.5; return { frac: fwd(entry, 0, t), latUnit: side * smooth(t) }; }
  const t = (p - 0.5) / 0.5; return { frac: fwd(0, exit, t), latUnit: side * (1 - smooth(t)) };
}

// advance a car's pit-anim state off the inPit flag (no snapshot/pitTimer change). state {phase, active}.
// fresh inPit -> phase 0; while inPit ramp to 0.5 (in-lap) then hold (box); once inPit clears ramp to 1
// (out-lap) then active=false (car back to its normal on-track position).
export function advancePitPhase(state, inPit, dt, opts = {}) {
  const { inSec = 1.2, outSec = 1.2 } = opts;
  let phase = (state && state.phase) || 0, active = !!(state && state.active);
  if (inPit) {
    if (!active) phase = 0;
    active = true;
    phase = Math.min(0.5, phase + dt * 0.5 / inSec);
  } else if (active) {
    phase = phase + dt * 0.5 / outSec;
    if (phase >= 1) { phase = 1; active = false; }
  }
  return { phase, active };
}
