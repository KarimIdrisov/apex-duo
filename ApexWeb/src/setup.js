// ApexWeb/src/setup.js
import { RNG } from "./rng.js";

export const AXES = [
  { name:"Прижим",   low:"скользит в быстрых поворотах", high:"не хватает прижима в медленных" },
  { name:"Передачи", low:"упирается в потолок на прямой", high:"проседает на разгоне из поворота" },
  { name:"Подвеска", low:"нервная на поребриках",         high:"вялый отклик в связках" },
];

export function trackIdeal(seed) {
  const r = new RNG(seed ^ 0x5e7);
  return [r.unit(), r.unit(), r.unit()];
}

export function closeness(setup, ideal) {
  let err = 0;
  for (let i = 0; i < 3; i++) err += Math.abs(setup[i] - ideal[i]);
  return 1 - err / 3;                      // 1 = perfect, 0 = worst case
}

// max ~0.15 s/lap gain at perfect setup (negative = faster)
export function paceBonus(close) { return -0.15 * Math.max(0, close); }

// wear multiplier: a bad setup chews tyres up to +20%
export function wearMod(close) { return 1 + 0.2 * (1 - Math.max(0, close)); }

export function feedback(setup, ideal) {
  let worst = 0, worstErr = -1, sign = 0;
  for (let i = 0; i < 3; i++) {
    const e = Math.abs(setup[i] - ideal[i]);
    if (e > worstErr) { worstErr = e; worst = i; sign = setup[i] < ideal[i] ? -1 : 1; }
  }
  if (worstErr < 0.08) return "Машина сбалансирована — так держать.";
  const ax = AXES[worst];
  return `${ax.name}: ${sign < 0 ? ax.high : ax.low}.`;
}
