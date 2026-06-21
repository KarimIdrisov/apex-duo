// ApexWeb/src/team.js — FM team model: generate 13 driver attributes from an overall
// + a per-driver seed + signature traits; generate personnel. Pure & deterministic.
import { RNG, mix32 } from "./rng.js";

export const ATTR_KEYS = ["pace", "quali", "tyre", "overtaking", "defending",
  "consistency", "composure", "aggression", "discipline", "wet", "starts", "race_iq", "smoothness", "fitness"];
// fitness (§Phase-3): stamina — a fit driver holds pace late in the race; an unfit one fades. The effect
// is centered on the field mean (sim.js), so it adds texture without shifting the field-wide pace.

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
  for (const k of ATTR_KEYS) {
    // fitness is its OWN axis (centered ~0.70, independent of overall) so the late-race fade doesn't
    // systematically favour the already-fast cars — it stays a separate "manage the human" trait (§Phase-3).
    a[k] = k === "fitness" ? clamp01(0.70 + r.noise(0.20) + (sig[k] || 0))
                           : clamp01(overall + r.noise(0.06) + (sig[k] || 0));
  }
  return a;
}

// 5-indicator car: power/aero/reliability from the team car; tyre/fuel economy passthrough. tyreHeat
// (Phase 4 chassis "Tyre Heating" trait) also passes through to the sim's overheat target; default 1 =
// neutral, so a car composed without a chassis (AI, balance harness) behaves exactly as before.
export function composeCar(car) {
  return { power: car.power, aero: car.aero, rel: car.rel, tyre: car.tyre ?? 1, fuel: car.fuel ?? 1, tyreHeat: car.tyreHeat ?? 1 };
}

// --- D5: per-attribute development + traits ---

// `overall` as a weighted readout of the headline attributes (pace-led, craft-weighted).
const OVERALL_W = { pace: 0.30, quali: 0.12, race_iq: 0.14, tyre: 0.12, overtaking: 0.10, consistency: 0.10, defending: 0.07, wet: 0.05 };
export function overallFromAttrs(a) {
  let s = 0, w = 0; for (const k in OVERALL_W) { s += OVERALL_W[k] * (a[k] ?? 0.7); w += OVERALL_W[k]; }
  return s / w;
}

// §Phase-3 — MM-style 0..5 star rating from an overall (half-star steps). The F1 pool spans ~0.65..0.97,
// mapped so a rookie reads ~1-2★ and an elite ~5★. Used in the driver card next to the OVR number.
export function overallToStars(overall) {
  const x = (Number(overall) - 0.55) / 0.084;          // 0.55→0★ .. 0.97→5★
  return Math.max(0, Math.min(5, Math.round(x * 2) / 2));  // clamp 0..5, half-star granularity
}

// per-attribute peak age: physical (pace/quali/starts) peak early; craft (race_iq/tyre/wet) peak late.
export const ATTR_PEAK = {
  pace: 25, quali: 25, starts: 24, aggression: 26, smoothness: 31, fitness: 26,
  overtaking: 28, consistency: 30, defending: 30, composure: 32, discipline: 32, tyre: 33, wet: 33, race_iq: 35,
};
// §Phase-3 — per-driver peak-age ARCHETYPE: some drivers peak EARLY (burn bright, fade young), some LATE
// (long careers), most NORMAL. A deterministic ±2-year offset on every attribute's peak age, salted by
// abbreviation. Stored on the driver record (dr.peakAge) and threaded into attrDrift.
export function peakArchetype(abbrev) {
  const s = String(abbrev || "");
  const r = mix32(((s.charCodeAt(0) || 65) * 2654435761 + (s.charCodeAt(1) || 90) * 131 + s.length) >>> 0) / 4294967296;
  return r < 0.30 ? -2 : (r > 0.70 ? 2 : 0);   // ~30% early peak, ~30% late peak, ~40% normal
}
// one season of drift for an attribute at a given age (rise below peak, decline above; bounded ±0.025).
// `peakOffset` shifts the attr's peak age for early/late-peaking drivers (§Phase-3 archetype).
export function attrDrift(key, age, peakOffset = 0) {
  const peak = (ATTR_PEAK[key] ?? 28) + peakOffset;
  const d = peak - age;                       // >0 improving, <0 declining
  const rate = d >= 0 ? 0.010 : 0.008;        // skills are gained a touch faster than they fade
  return Math.max(-0.025, Math.min(0.025, d * rate * 0.25));
}
// §Phase-3 — projected PEAK overall: walk the attrs forward applying only growth until every attr is past
// its (archetype-shifted) peak. For a young driver this is their ghost peak-potential (shown as ghost stars
// on the senior card); for a veteran past peak it ≈ their current overall. Pure, deterministic.
export function peakOverall(dr) {
  if (!dr || !dr.attrs || dr.age == null) return dr ? (dr.overall || 0) : 0;
  const off = dr.peakAge || 0, a = { ...dr.attrs };
  for (let age = dr.age; age < 38; age++) {
    let rising = false;
    for (const k of ATTR_KEYS) { const dd = attrDrift(k, age, off); if (dd > 0) { a[k] = Math.min(0.999, a[k] + dd); rising = true; } }
    if (!rising) break;
  }
  return overallFromAttrs(a);
}

// explicit driver traits (RU labels) — bias which attrs develop, surfaced in the paddock.
export const TRAITS = {
  wet_master:     { label: "Дождевик",         attrs: { wet: 1, race_iq: 0.4 } },
  overtaker:      { label: "Атакующий",         attrs: { overtaking: 1, aggression: 0.6 } },
  defender:       { label: "Скала",             attrs: { defending: 1, composure: 0.5 } },
  tyre_whisperer: { label: "Бережёт резину",    attrs: { tyre: 1, smoothness: 0.6 } },
  qualifier:      { label: "Квалифайер",        attrs: { quali: 1 } },
  starter:        { label: "Реактивный старт",  attrs: { starts: 1 } },
  ice_cold:       { label: "Хладнокровный",     attrs: { composure: 1, discipline: 0.6 } },
  strategist:     { label: "Гений гонки",       attrs: { race_iq: 1 } },
};
const TRAIT_DEV = 0.004;   // extra per-season drift on a trait's attrs
export function traitBias(traits, key) {
  let b = 0; for (const t of (traits || [])) { const w = TRAITS[t] && TRAITS[t].attrs[key]; if (w) b += TRAIT_DEV * w; }
  return b;
}

// known signature traits per driver (identity at career start). Others get none until they develop one.
const SIG_TRAIT = {
  VER: ["overtaker"], HAM: ["wet_master", "strategist"], ALO: ["strategist", "defender"],
  LEC: ["qualifier"], NOR: ["qualifier"], PIA: ["tyre_whisperer"], SAI: ["tyre_whisperer"],
  PER: ["tyre_whisperer"], GAS: ["wet_master"], RUS: ["qualifier"],
};
export function assignTraits(abbrev) { return SIG_TRAIT[abbrev] ? [...SIG_TRAIT[abbrev]] : []; }

// personnel from a team facility strength: pit-stop speed multiplier + strategy quality 0..1.
export function genPersonnel(facility, seed) {
  const r = new RNG(mix32((Math.round(facility * 1000) + seed * 7919) >>> 0));
  const pit = clamp01(facility + r.noise(0.05));
  return {
    pitMult: 1.15 - 0.4 * pit,      // 0.75 (great) .. 1.15 (poor) × base pit time
    strategy: clamp01(facility + r.noise(0.06)),  // used by AI in Phase 8
  };
}
