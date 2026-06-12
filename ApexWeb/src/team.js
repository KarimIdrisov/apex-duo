// ApexWeb/src/team.js — FM team model: generate 13 driver attributes from an overall
// + a per-driver seed + signature traits; generate personnel. Pure & deterministic.
import { RNG, mix32 } from "./rng.js";

export const ATTR_KEYS = ["pace", "quali", "tyre", "overtaking", "defending",
  "consistency", "composure", "aggression", "discipline", "wet", "starts", "race_iq", "smoothness"];

// star traits: per-attribute bumps layered on top of the overall.
const SIGNATURE = {
  VER: { overtaking: 0.10, quali: 0.08, race_iq: 0.06 },
  NOR: { quali: 0.06, consistency: 0.05 },
  PIA: { consistency: 0.06, tyre: 0.05 },
  HAM: { wet: 0.14, race_iq: 0.10, tyre: 0.06 },
  ALO: { race_iq: 0.14, defending: 0.12, wet: 0.08 },
  LEC: { quali: 0.12, pace: 0.05 },
  RUS: { quali: 0.07 },
  SAI: { tyre: 0.07, consistency: 0.05 },
  PER: { tyre: 0.08 },
  GAS: { wet: 0.06 },
};

const clamp01 = x => Math.max(0, Math.min(1, x));
function seedOf(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return mix32(h || 1); }

// 13 attributes generated around `overall`, with signature traits and per-attr jitter.
export function driverAttrs(abbrev, overall) {
  const r = new RNG(seedOf(abbrev));
  const sig = SIGNATURE[abbrev] || {};
  const a = {};
  for (const k of ATTR_KEYS) a[k] = clamp01(overall + r.noise(0.06) + (sig[k] || 0));
  return a;
}

// 5-indicator car: power/aero/reliability from the team car; tyre/fuel economy passthrough.
export function composeCar(car) {
  return { power: car.power, aero: car.aero, rel: car.rel, tyre: car.tyre ?? 1, fuel: car.fuel ?? 1 };
}

// personnel from a team facility strength: pit-stop speed multiplier + strategy quality 0..1.
export function genPersonnel(facility, seed) {
  const r = new RNG(mix32((Math.round(facility * 1000) + seed * 7919) >>> 0));
  const pit = clamp01(facility + r.noise(0.05));
  return {
    pitMult: 1.15 - 0.4 * pit,      // 0.75 (great) .. 1.15 (poor) × base pit time
    strategy: clamp01(facility + r.noise(0.06)),  // used by AI in Phase 8
  };
}
