// ApexWeb/src/tyres.js — pure tyre pace model: degradation curve + cliff + warm-up.
// temp is 0..1 (1 = in the operating window). Phase 7 will add driver `tyre` attr.
import { COMPOUNDS, TYRE } from "./data.js";

const clamp01 = x => Math.max(0, Math.min(1, x));

// pace loss (s/lap) from the current tyre state. wear >= 0. temp: 0 = stone cold, 1 = optimal window,
// >1 = overheating (two-sided, §item-2). Below 1 costs warmPen (cold); above 1 costs hotPen (overheat).
export function tyreTerm(compound, wear, temp) {
  const c = COMPOUNDS[compound];
  let deg;
  if (wear <= c.cliff) deg = 0.040 * wear * (1 + (wear / c.cliff) * 0.5); // gently accelerating curve (calibrated stint regime — unchanged)
  else { const o = wear - c.cliff; deg = 0.040 * c.cliff * 1.5 + o * 0.45 + o * o * 0.004; } // sharper, ACCELERATING fall off the cliff (§item-7): over-extending past the cliff is punished harder the further you go
  const cold = (1 - clamp01(temp)) * TYRE.warmPen;                        // unchanged: 0 once temp >= 1
  const hot = Math.max(0, temp - 1) * TYRE.hotPen;                        // overheat: 0 unless driven past the window
  return deg + cold + hot;
}

// temp after one lap, easing toward `target` (default 1 = the optimal window). Aggressive driving sets a
// target > 1 (heats up / overheats); backing off lowers it (cools back toward optimal). Softer compound
// warms/cools faster. At target 1 this is identical to the old warm-only behaviour (back-compatible).
export function warmStep(temp, compound, target = 1) {
  const c = COMPOUNDS[compound];
  return Math.max(0, temp + (target - temp) * c.warm * TYRE.ease);
}
