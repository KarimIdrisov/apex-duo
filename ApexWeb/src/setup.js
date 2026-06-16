// ApexWeb/src/setup.js — 6-axis setup: hidden ideal (per car/track/driver), per-axis
// satisfaction, and the knowledge-window + feedback model used by the live practice session.
import { RNG } from "./rng.js";
import { PRAC2 } from "./data.js";

export const AXES = [
  { name:"Переднее крыло",     char:"поворачиваемость",        low:"вяло заходит в поворот", high:"остро ныряет, теряет зад" },
  { name:"Заднее крыло",       char:"прямые / стабильность",   low:"проседает на прямых",   high:"тяжёлый на прямых" },
  { name:"Подвеска",           char:"тяга на выходе",          low:"буксует на выходе",      high:"глухая на поребриках" },
  { name:"Развал колёс",       char:"держак в поворотах",      low:"не держит дугу",         high:"жрёт резину" },
  { name:"Передаточные числа", char:"разгон / торм. зоны",     low:"провал на разгоне",      high:"упирается на прямой" },
  { name:"Тормозной баланс",   char:"стабильн. в торможении",  low:"блокирует зад",          high:"длинно тормозит" },
];

// hidden optimum for the weekend, derived from the track seed
export function trackIdeal(seed) {
  const r = new RNG(seed ^ 0x5e7);
  return Array.from({ length: PRAC2.AXES }, () => r.unit());
}

// per-driver optimum: the track ideal nudged a little for each driver (driverSeed 0 / 1).
// salt a fresh RNG per (driver, axis) — the LCG avalanche removes the cross-seed collisions a
// plain additive hash would have (two seeds spaced by 131 would otherwise share a jitter pattern).
export function idealFor(seed, driverSeed) {
  const base = trackIdeal(seed);
  return base.map((v, i) => {
    const j = new RNG(((seed >>> 0) ^ (driverSeed * 7919 + i * 131 + 1)) >>> 0).unit() * 2 - 1; // [-1,1)
    return Math.min(1, Math.max(0, v + j * 0.12));
  });
}

// per-axis satisfaction: bell curve around the optimum
export function axisSat(value, opt) {
  const d = Math.abs(value - opt) / PRAC2.SAT_TOL;
  return Math.max(0, Math.min(1, 1 - d * d));
}

export function satisfaction(confirmedSat) {
  if (!confirmedSat.length) return 0;
  return confirmedSat.reduce((a, b) => a + b, 0) / confirmedSat.length;
}

// legacy closeness/paceBonus/feedback — generalised over AXES.length so existing consumers
// keep working until the switchover moves them to satisfaction.
export function closeness(setup, ideal) {
  let err = 0; const n = ideal.length;
  for (let i = 0; i < n; i++) err += Math.abs(setup[i] - ideal[i]);
  return 1 - err / n;
}
export function paceBonus(close) { return -0.15 * Math.max(0, close); }
export function feedback(setup, ideal) {
  let worst = 0, worstErr = -1, sign = 0;
  for (let i = 0; i < ideal.length; i++) {
    const e = Math.abs(setup[i] - ideal[i]);
    if (e > worstErr) { worstErr = e; worst = i; sign = setup[i] < ideal[i] ? -1 : 1; }
  }
  if (worstErr < 0.08) return "Машина сбалансирована — так держать.";
  const ax = AXES[worst];
  return `${ax.name}: ${sign < 0 ? ax.high : ax.low}.`;
}

// the revealed ideal window for an axis: centre = optimum + jitter (shrinks with track knowledge),
// half-width shrinks from MAX_HALF to MIN_HALF as track knowledge → 1. Gated by track knowledge.
export function windowFor(knowledge, opt, seed, i) {
  const k = Math.max(0, Math.min(1, knowledge));
  const j = new RNG(((seed >>> 0) ^ (i * 977 + 0x9e3)) >>> 0).unit() * 2 - 1; // stable [-1,1)
  const center = opt + j * PRAC2.WIN_JITTER * (1 - k);
  const half = PRAC2.MIN_HALF + (PRAC2.MAX_HALF - PRAC2.MIN_HALF) * Math.pow(1 - k, PRAC2.WIN_P);
  return { center, half };
}

// feedback for one axis. clarity (vague→directional) gated by track knowledge + race_iq.
export function feedbackFor(value, win, knowledge, raceIq) {
  if (knowledge < PRAC2.KNOW_VAGUE) return { state:"vague", text: knowledge < 0.12 ? "почти нет данных" : "мало кругов" };
  const d = value - win.center;
  if (Math.abs(d) <= win.half) return { state:"optimal", text:"оптимально" };
  const big = Math.abs(d) > win.half * 3;
  const sharp = raceIq >= 0.55;
  if (d < 0) return { state:"low",  text: sharp ? (big ? "нужно заметно больше →" : "чуть больше →") : "больше →" };
  return       { state:"high", text: sharp ? (big ? "← нужно заметно меньше" : "← чуть меньше") : "← меньше" };
}
