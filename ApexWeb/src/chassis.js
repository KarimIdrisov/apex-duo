// ApexWeb/src/chassis.js — pre-season CHASSIS DESIGN: the MM "supplier ritual". Before a season the
// player picks ONE supplier tier in each of four categories (engine / fuel / material / brakes). Each
// pick is a cost-vs-effect bet that shapes the car's four CHASSIS CHARACTER TRAITS — star-rated and
// LOCKED for the season. This is the highest-leverage MM ritual we were missing (MM_PARITY_ROADMAP §4):
// it ties pre-season spending to the whole season's race feel and dev curve.
//
// Traits are 0..1, 0.5 = neutral (3★). They influence the game ONLY through existing channels
// (CAR_PU_DEV_MASTERPLAN §5.1 — the sim core is untouched), wired in development.js / sim.js:
//   tyreLife → tyre indicator   (kinder wear)            [MM "Tyre Wear"]
//   cooling  → in-race heat target (runs cooler)         [MM "Tyre Heating"]
//   economy  → fuel indicator   (less burn)              [MM "Fuel Consumption"]
//   improv   → effective PART_CEILING (season dev cap)   [MM "Improvability"]
//
// A NEUTRAL chassis (all 0.5, no picks) applies ZERO deltas — so a career that never designs one, an
// old save, or an AI team is byte-identical to before. Pure, deterministic, no I/O, no RNG.
// The trait→game wiring (effCeiling, indicator deltas, heat scalar) lives in development.js, which owns
// PART_CEILING; this module only defines the ritual, the traits and their display.

export const TRAIT_KEYS = ["tyreLife", "cooling", "economy", "improv"];
export const TRAIT_LABEL = {
  tyreLife: "Износ шин",
  cooling:  "Охлаждение шин",
  economy:  "Экономичность",
  improv:   "Развиваемость",
};
export const TRAIT_HINT = {
  tyreLife: "выше — мягче к резине, медленнее износ в гонке",
  cooling:  "выше — шины меньше перегреваются под атакой",
  economy:  "выше — ниже расход топлива, длиннее стинты",
  improv:   "выше — выше потолок развития деталей в этом сезоне",
};

// Four supplier categories. Each pick contributes to a PRIMARY trait (full delta) and a SECONDARY
// (×SECONDARY_K), so the four categories together set all four traits with overlap (a real design web).
export const CATEGORIES = [
  { key: "engine",   label: "Двигатель (интеграция)", primary: "improv",   secondary: "economy"  },
  { key: "fuel",     label: "Топливная система",       primary: "economy",  secondary: "cooling"  },
  { key: "material", label: "Материалы шасси",         primary: "tyreLife", secondary: "improv"   },
  { key: "brakes",   label: "Тормозная система",       primary: "cooling",  secondary: "tyreLife" },
];
// Three supplier tiers per category: budget (cheap, weak trait), standard (mid), elite (pricey, strong).
// Costs are $k, GAME-SCALED to Apex's economy (tune here). The spread is the whole point — money spent on
// premium suppliers is money NOT spent on the car build, so the design is a genuine trade-off.
export const TIERS = {
  budget:   { key: "budget",   label: "Бюджетный",   cost: 400,  d: -0.12 },
  standard: { key: "standard", label: "Стандартный", cost: 1100, d: +0.06 },
  elite:    { key: "elite",    label: "Премиум",     cost: 2400, d: +0.22 },
};
export const TIER_ORDER = ["budget", "standard", "elite"];
const SECONDARY_K = 0.4;
const NEUTRAL = 0.5;
const clamp01 = x => Math.max(0.05, Math.min(0.95, x));

// a neutral chassis (no picks): every trait 3★, no cost, zero game effect. The default for fresh/old
// careers and for AI teams.
export function neutralChassis() {
  return { tyreLife: NEUTRAL, cooling: NEUTRAL, economy: NEUTRAL, improv: NEUTRAL, picks: {}, spent: 0 };
}

// compose a {category → tier} pick map into a chassis trait set. UNPICKED categories contribute nothing
// (neutral, free) so the player can design progressively. Returns traits + the cleaned pick map + $ spent.
export function composeChassis(picks) {
  const t = { tyreLife: NEUTRAL, cooling: NEUTRAL, economy: NEUTRAL, improv: NEUTRAL };
  let spent = 0; const chosen = {};
  for (const cat of CATEGORIES) {
    const tier = TIERS[picks && picks[cat.key]];
    if (!tier) continue;                         // category not designed yet → neutral, no cost
    chosen[cat.key] = tier.key;
    spent += tier.cost;
    t[cat.primary] += tier.d;
    t[cat.secondary] += tier.d * SECONDARY_K;
  }
  for (const k of TRAIT_KEYS) t[k] = clamp01(t[k]);
  return { ...t, picks: chosen, spent };
}

// total $ cost of a pick map (without applying) — for the pre-season affordability check.
export function chassisCost(picks) { return composeChassis(picks).spent; }

// set ONE category's supplier tier on the career, charging/refunding the COST DELTA vs the current
// chassis. Returns false (no change) if the upgrade is unaffordable. Switching down refunds.
export function setChassisPick(career, catKey, tierKey) {
  if (!career || !CATEGORIES.some(c => c.key === catKey) || !TIERS[tierKey]) return false;
  const picks = { ...((career.chassis && career.chassis.picks) || {}), [catKey]: tierKey };
  const next = composeChassis(picks);
  const delta = next.spent - ((career.chassis && career.chassis.spent) || 0);
  if (delta > 0 && (career.money || 0) < delta) return false;   // can't afford this upgrade
  career.money = (career.money || 0) - delta;
  career.chassis = next;
  return true;
}

// 0..1 trait value → 1..5 stars (half-star steps), matching the driver-card star vocabulary. Neutral
// 0.5 → 3★; the achievable design range (~0.33..0.81) reads ~2.5★..4★.
export function traitStars(v) {
  return Math.max(0.5, Math.min(5, Math.round((1 + (Number(v) || 0) * 4) * 2) / 2));
}
