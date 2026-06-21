// ApexWeb/src/perks.js — §Phase-5 mechanic perks: a once-per-race, Chemistry-gated in-race lever. Each
// player car's race mechanic builds CHEMISTRY with its driver over the season; higher chemistry unlocks
// stronger perks. The player DEPLOYS one perk per race in the HUD; the sim applies a bounded, temporary
// effect (a few laps of wear/fuel/pace modifier, or a one-shot tyre-temp reset). Perks are OPT-IN deploys
// absent from the balance harness, so tools/balance.mjs stays byte-identical. Pure data + helpers, no I/O.
//
// effect fields read by the sim (all neutral by default): laps (active window), wearMult, fuelMult,
// paceBonus (s/lap faster), oneShot (applied instantly on deploy — resets tyre temperature to the window).
export const PERKS = {
  cooldown: { key: "cooldown", label: "Холодный расчёт", chemReq: 0.45, oneShot: true, desc: "сразу вернуть температуру шин в рабочее окно" },
  tyresave: { key: "tyresave", label: "Бережём резину",  chemReq: 0.55, laps: 5, wearMult: 0.70, desc: "−30% износа шин на 5 кругов" },
  fuelsave: { key: "fuelsave", label: "Топливный план",  chemReq: 0.55, laps: 6, fuelMult: 0.82, desc: "−18% расхода топлива на 6 кругов" },
  pushnow:  { key: "pushnow",  label: "Прорыв",           chemReq: 0.70, laps: 3, paceBonus: 0.18, wearMult: 1.15, desc: "+темп на 3 круга (ценой износа)" },
};
export const PERK_KEYS = Object.keys(PERKS);
export const CHEM_START = 0.5;        // a mechanic's starting chemistry with a driver
export const CHEM_PER_RACE = 0.03;    // chemistry gained each race the pairing stays together (capped 1)

// the perks a mechanic of the given chemistry can deploy (chem unlocks stronger ones).
export function availablePerks(chem) {
  const c = chem == null ? CHEM_START : chem;
  return PERK_KEYS.map(k => PERKS[k]).filter(p => c >= p.chemReq);
}
export function perkUnlocked(chem, key) { const p = PERKS[key]; return !!p && (chem == null ? CHEM_START : chem) >= p.chemReq; }

// the neutral-defaulted effect the sim applies for a perk key (null for an unknown key).
export function perkEffect(key) {
  const p = PERKS[key]; if (!p) return null;
  return { key, laps: p.laps || 0, wearMult: p.wearMult ?? 1, fuelMult: p.fuelMult ?? 1, paceBonus: p.paceBonus ?? 0, oneShot: !!p.oneShot };
}

// grow a mechanic's chemistry one race (capped at 1). A driver change should reset it to CHEM_START
// (handled by the caller, which knows the pairing); this helper just advances a continuing pairing.
export function chemAfterRace(chem) { return Math.min(1, (chem == null ? CHEM_START : chem) + CHEM_PER_RACE); }
