// ApexWeb/src/tyres.js — pure tyre pace model: degradation curve + cliff + warm-up.
// temp is 0..1 (1 = in the operating window). Phase 7 will add driver `tyre` attr.
import { COMPOUNDS, TYRE } from "./data.js";

const clamp01 = x => Math.max(0, Math.min(1, x));

// pace loss (s/lap) from the current tyre state. wear >= 0, temp 0..1.
export function tyreTerm(compound, wear, temp) {
  const c = COMPOUNDS[compound];
  let deg;
  if (wear <= c.cliff) deg = 0.040 * wear * (1 + (wear / c.cliff) * 0.5); // gently accelerating curve
  else deg = 0.040 * c.cliff * 1.5 + (wear - c.cliff) * 0.32;             // steep past the cliff
  const cold = (1 - clamp01(temp)) * TYRE.warmPen;
  return deg + cold;
}

// temp after one lap (eases toward 1; softer compound warms faster)
export function warmStep(temp, compound) {
  const c = COMPOUNDS[compound];
  return Math.min(1, temp + c.warm * TYRE.ease * (1 - clamp01(temp)));
}
