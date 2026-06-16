// ApexWeb/src/development.js — pure MM-style car-development model. The player develops PARTS;
// parts compose into the 5 sim indicators (power/aero/tyre/fuel/rel) via PART_CONTRIB. The sim still
// reads the 5 composed indicators (composeCar). AI develops parts deterministically (catch-up biased).
import { mix32 } from "./rng.js";
import { TEAMS } from "./data.js";
import { devMult, staffRelBonus } from "./staff.js";
import { academyDevBonus } from "./academy.js";

export const INDICATORS = ["power", "aero", "tyre", "fuel", "rel"];

// the developable parts and how each contributes to the indicators (per unit of part level).
export const PARTS = ["fw", "rw", "floor", "sidepods", "susp", "pu"];
export const PART_LABEL = { fw: "Переднее крыло", rw: "Заднее крыло", floor: "Днище", sidepods: "Понтоны", susp: "Подвеска", pu: "Силовая установка" };
export const PART_CONTRIB = {
  fw:       { aero: 0.50, tyre: 0.20 },
  rw:       { aero: 0.45, fuel: 0.10 },
  floor:    { aero: 0.60, tyre: 0.15 },
  sidepods: { fuel: 0.40, rel: 0.20, aero: 0.15 },
  susp:     { tyre: 0.50, aero: 0.20 },
  pu:       { power: 0.70, fuel: 0.30, rel: 0.15 },
};

// upgrade sizes: part-level gain, $k cost, DAYS to complete, risk (chance-weighted shortfall).
// days are spent from the calendar gap between races — a small fits one normal (14d) gap; a large
// needs a long gap (summer break) or several gaps. (`races` kept as a coarse legacy hint.)
// days = DESIGN time (R&D); buildDays = MANUFACTURING time after design before the part is fitted (F2,
// MM-style design→build→fit). The outcome is rolled when design finishes (you see what you got), then
// the part is built, then fitted (applied + run-in).
export const PROJECT_SIZE = {
  small:  { gain: 0.012, cost: 1200, days: 8,  buildDays: 6,  races: 1, risk: 0.10, label: "Малый" },
  medium: { gain: 0.024, cost: 3000, days: 20, buildDays: 12, races: 2, risk: 0.20, label: "Средний" },
  large:  { gain: 0.042, cost: 6000, days: 34, buildDays: 20, races: 3, risk: 0.32, label: "Крупный" },
};

export const COST_CAP = 30000;
const AI_DEV_RATE = 0.0060;          // per ~14-day race gap, × facility × catch-up, over the team's parts
const AI_DEV_PER_DAY = AI_DEV_RATE / 14;   // calendar-driven: AI gains scale with the gap length

// --- E1: development approach, diminishing returns, outcome tiers, parallel projects, run-in -------
// Each upgrade is now a gamble. Approach scales the target gain, the outcome variance, and the
// reliability hit the new part carries until it's run in. Aggressive = bigger target but it can flop
// and it hurts reliability; conservative = safe and modest.
export const APPROACH = {
  safe:       { gainK: 0.78, varK: 0.5, relDebt: 0.000, label: "Консервативный", hint: "надёжно, меньше прирост" },
  balanced:   { gainK: 1.00, varK: 1.0, relDebt: 0.012, label: "Сбалансированный", hint: "баланс риска и отдачи" },
  aggressive: { gainK: 1.35, varK: 2.0, relDebt: 0.032, label: "Агрессивный",     hint: "большой прирост, риск надёжности" },
};
export const PART_CEILING = 0.34;    // per-part development ceiling under current regs → diminishing returns
export const RUNIN_RACES = 3;        // races a freshly-fitted part stays "unproven" (elevated breakage)
const SIZE_DEBT = { small: 0.7, medium: 1.0, large: 1.3 };   // bigger parts carry more run-in risk

// parallel programs: a bigger factory runs more at once (factory 0→1 slot, 2→2, 4→3).
export function maxProjects(career) {
  const fac = (career && career.staff && career.staff.facilities) ? (career.staff.facilities.factory || 0) : 0;
  return 1 + Math.floor(fac / 2);
}
// diminishing-returns factor as a part matures toward the regulation ceiling (never fully zero).
export function maturityFactor(level) { return Math.max(0.15, 1 - (level || 0) / PART_CEILING); }
// seeded outcome tier for a completed project. Aggressive widens BOTH tails (more прорыв AND more провал).
export function projectOutcome(approachKey, roll) {
  const a = APPROACH[approachKey] || APPROACH.balanced;
  const tail = 0.10 * a.varK;   // провал mass
  const brk  = 0.10 * a.varK;   // прорыв mass
  if (roll < tail)         return { mult: 0.15, label: "провал",   extraDebt: 0.020 };
  if (roll < 0.45)         return { mult: 0.65, label: "частично", extraDebt: 0.000 };
  if (roll < 1 - brk)      return { mult: 1.00, label: "успех",    extraDebt: 0.000 };
  return                          { mult: 1.45, label: "прорыв",   extraDebt: 0.000 };
}
// total reliability debt this race from parts not yet run in (lowers the player car's effective rel
// → higher in-race breakage; decays each race via runInParts).
export function unprovenDebt(career) {
  return ((career && career.unproven) || []).reduce((s, u) => s + (u.debt || 0), 0);
}
// per-race decay of the run-in: bed parts in, drop the ones that are proven.
export function runInParts(career) {
  if (!career || !career.unproven) return;
  for (const u of career.unproven) u.racesLeft -= 1;
  career.unproven = career.unproven.filter(u => u.racesLeft > 0);
}


// --- Power Unit (engine) program (Phase B) -------------------------------------------------------
// A SEPARATE engine-development layer for works PU-makers (own engine). PU dev is OFF the cost cap
// (parent-funded) — the realistic works advantage. Composes on TOP of the chassis car. Customers
// can't develop their (supplied) engine but can pursue a multi-season PU program to become a maker.
export const PU_PARTS = ["power", "eff", "rel"];
export const PU_LABEL = { power: "Мощность ДВС", eff: "Эффективность", rel: "Надёжность ДВС" };
export const PU_CONTRIB = { power: { power: 1.0 }, eff: { fuel: 0.8 }, rel: { rel: 1.0 } };   // per part-level → indicator
export const PU_PROGRAM = { full: { days: 380, races: 16, cost: 9000, label: "Полная программа (свой ДВС)" }, badge: { days: 120, races: 6, cost: 4500, label: "Бейдж-партнёрство" } };
export const SUPPLY_INCOME = 400;   // $k/race a PU-maker earns supplying customer teams
export const SUPPLY_FEE = 250;      // $k/race a customer pays for its engine

// --- E4: PU as a season-long resource (allocation + penalties) ------------------------------------
// A limited pool of power units per season. Each race wears the current unit (more on power-hungry
// tracks, less with developed PU reliability). When a unit is spent, the next is fitted; exceeding the
// pool draws a grid penalty at the next race. Developing PU reliability extends unit life.
export const PU_POOL = 4;           // power units allowed per season before penalties
export const PU_WEAR_BASE = 0.16;   // base life consumed per race (~1/PU_WEAR_BASE ≈ 6 races/unit at neutral stress)
export const PU_GRID_PEN = 5;       // grid places lost when the pool is exceeded
// life consumed this race: power tracks stress the engine; running it hard (push mode) spends it
// faster; developed PU reliability spares it. pushFrac = share of racing time the car spent in push.
export function puWearForRace(track, puRelLevel, pushFrac = 0) {
  const stress = 1 + 0.5 * (((track && track.pw != null ? track.pw : 0.5) - 0.5) * 2) + 0.7 * (pushFrac || 0) - 1.2 * (puRelLevel || 0);
  return PU_WEAR_BASE * Math.max(0.4, stress);
}
const zeroPU = () => ({ power: 0, eff: 0, rel: 0 });
export function puToDeltas(pu) {
  const d = { power: 0, aero: 0, tyre: 0, fuel: 0, rel: 0 };
  if (!pu) return d;
  for (const p of PU_PARTS) { const lvl = pu[p] || 0, c = PU_CONTRIB[p]; for (const k in c) d[k] += lvl * c[k]; }
  return d;
}
// chassis-effective car + PU-program deltas (power/fuel/rel). Used to feed the player's sim car.
export function effectiveCarPU(baseCar, parts, pu) {
  const c = effectiveCar(baseCar, parts), d = puToDeltas(pu);
  for (const k of INDICATORS) c[k] = clampInd(k, (c[k] ?? 0) + (d[k] || 0));
  return c;
}

// per-race modifiers on the player's effective car (E1 unproven reliability + E3 concept track bias).
// `ind` = effectiveCarPU output; `track` carries df/pw (0..1) for the concept bias. Returns a new object.
export function applyRaceMods(ind, career, track) {
  let out = { ...ind };
  const debt = unprovenDebt(career);                 // E1: not-yet-run-in parts → lower reliability this race
  if (debt) out.rel = clampInd("rel", (out.rel ?? 0.9) - debt);
  const relB = staffRelBonus(career && career.staff);   // T2: a mechanical specialist lifts reliability
  if (relB) out.rel = clampInd("rel", (out.rel ?? 0.9) + relB);
  out = applyConceptBias(out, career && career.concept);   // E3: concept skews aero↔power (sim weights it by track)
  return out;
}

// --- E3: car concept — a season-long aero↔power philosophy. Symmetric so it doesn't change absolute
// performance ((power+aero)/2): the sim's track-character term ((power−aero)×(pw−df)) makes a downforce
// car quick in the corners (high-df tracks) and a power car quick on the straights (high-pw tracks). ---
export const CONCEPT = {
  downforce: { aero: 0.05, power: -0.05, label: "Прижимной",       hint: "силён на трассах прижима, слабее на мощностных" },
  balanced:  { aero: 0.00, power: 0.00,  label: "Сбалансированный", hint: "ровный по всему календарю" },
  power:     { aero: -0.05, power: 0.05, label: "Мощностной",       hint: "силён на мощностных трассах, слабее в поворотах" },
};
export function conceptBias(career) {
  const c = career && career.concept, spec = c && CONCEPT[c];
  return (spec && (spec.aero || spec.power)) ? { aero: spec.aero, power: spec.power } : null;
}
// apply a concept's symmetric aero↔power skew to an indicator object (player + AI share this).
export function applyConceptBias(ind, conceptKey) {
  const spec = CONCEPT[conceptKey];
  if (!spec || (!spec.aero && !spec.power)) return ind;
  return { ...ind, aero: clampInd("aero", (ind.aero ?? 0.85) + spec.aero), power: clampInd("power", (ind.power ?? 0.85) + spec.power) };
}
// E7: each AI team carries a stable season concept so the grid's strengths vary by circuit character —
// some teams quick on power tracks, some in the corners. Assigned by ranking teams on their base car's
// power−aero lean and splitting into thirds: this is deterministic, evenly spread, and thematic (a
// power-leaning car gets the power concept). Ties break by grid order, so the spread holds regardless.
export function aiConcept(teamName) {
  const ranked = TEAMS.map(t => ({ name: t.name, lean: ((t.car && t.car.power) || 0.85) - ((t.car && t.car.aero) || 0.85) })).sort((a, b) => a.lean - b.lean);
  const i = ranked.findIndex(r => r.name === teamName);
  if (i < 0) return "balanced";
  const n = ranked.length, third = Math.floor(n / 3);
  if (i < third) return "downforce";       // most aero-leaning cars → corner-quick concept
  if (i >= n - third) return "power";       // most power-leaning cars → straight-line concept
  return "balanced";
}

const zeroParts = () => ({ fw: 0, rw: 0, floor: 0, sidepods: 0, susp: 0, pu: 0 });
function clampInd(k, v) { return k === "rel" ? Math.max(0.3, Math.min(0.995, v)) : Math.max(0.3, Math.min(1.20, v)); }

// part levels -> indicator deltas via PART_CONTRIB.
export function partsToDeltas(parts) {
  const d = { power: 0, aero: 0, tyre: 0, fuel: 0, rel: 0 };
  if (!parts) return d;
  for (const p of PARTS) {
    const lvl = parts[p] || 0, c = PART_CONTRIB[p];
    for (const k in c) d[k] += lvl * c[k];
  }
  return d;
}

// base car + composed part deltas -> the effective car the sim composes. energy passes through.
export function effectiveCar(baseCar, parts) {
  const dlt = partsToDeltas(parts);
  const out = { ...baseCar };
  for (const k of INDICATORS) {
    const b = baseCar[k] ?? (k === "tyre" || k === "fuel" ? 1 : 0.85);
    out[k] = clampInd(k, b + (dlt[k] || 0));
  }
  return out;
}

// start a player upgrade project on a PART with an APPROACH. Multiple run in parallel up to the factory
// slot cap. Returns the project, or null (slots full / part already in dev / can't afford / cost cap / invalid).
export function startProject(career, part, size, approach = "balanced") {
  career.projects = career.projects || [];
  if (!PROJECT_SIZE[size] || !PARTS.includes(part)) return null;
  if (career.projects.length >= maxProjects(career)) return null;       // all slots busy
  if (career.projects.some(p => p.part === part)) return null;          // one program per part at a time
  const spec = PROJECT_SIZE[size], ap = APPROACH[approach] || APPROACH.balanced;
  if (career.money < spec.cost) return null;
  if (career.costCap && (career.devSpentThisSeason || 0) + spec.cost > COST_CAP) return null;
  career.money -= spec.cost;
  career.devSpentThisSeason = (career.devSpentThisSeason || 0) + spec.cost;
  career.capSpent = (career.capSpent || 0) + spec.cost;   // cost-cap accounting (dev + staff + transfers)
  const proj = { part, size, approach, daysLeft: spec.days, days: spec.days, gain: spec.gain };
  career.projects.push(proj);
  return proj;
}

// advance development by `days` (the calendar gap since the last race, or the off-season window):
// burn down the player's part project (complete -> risk-shaved gain, scaled by design office +
// academy R&D) and develop every AI team's parts deterministically, scaled by the elapsed days.
export function tickDevelopment(career, days = 14) {
  const dt = Math.max(0, days || 0);
  career.parts = career.parts || {};
  for (const t of TEAMS) career.parts[t.name] = career.parts[t.name] || zeroParts();
  career.projects = career.projects || [];
  career.unproven = career.unproven || [];
  const events = [];
  const myParts = career.parts[TEAMS[career.teamIdx].name];
  // Each project develops over its days, then is FITTED: a seeded outcome × diminishing returns gives
  // the gain, split between the current car and next year's car by `devFocus` (F1), and the fresh part
  // carries a run-in reliability debt (E1).
  const focus = Math.max(0, Math.min(0.6, career.devFocus || 0));
  career.nextCar = career.nextCar || {};
  const stillGoing = []; let done = 0;
  for (const p of career.projects) {
    p.daysLeft -= dt;
    if (p.daysLeft > 0) { stillGoing.push(p); continue; }
    const seed = ((career.seed >>> 0) + career.round * 2654435761 + (PARTS.indexOf(p.part) + 1) * 374761393 + (done++) * 40499) >>> 0;
    const out = projectOutcome(p.approach, mix32(seed) / 4294967296);
    const ap = APPROACH[p.approach] || APPROACH.balanced;
    const level = myParts[p.part] || 0;
    const gain = p.gain * ap.gainK * out.mult * maturityFactor(level) * devMult(career.staff) * (1 + academyDevBonus(career));
    const debt = (ap.relDebt + out.extraDebt) * (SIZE_DEBT[p.size] || 1);
    myParts[p.part] = level + gain * (1 - focus);                              // F1: current car gets (1−focus)
    if (focus > 0) career.nextCar[p.part] = (career.nextCar[p.part] || 0) + gain * focus;   // …rest banks for next year
    if (debt > 0) career.unproven.push({ part: p.part, debt, racesLeft: RUNIN_RACES });
    events.push({ type: "project_done", part: p.part, gain: gain * (1 - focus), banked: gain * focus, outcome: out.label, approach: p.approach });
  }
  career.projects = stillGoing;
  // E8: AI development economy — ATR catch-up by LIVE championship position (trailers develop faster,
  // leaders slower; keeps the field tight, like the player's aero ATR), seeded per-team form swings
  // (occasional breakthrough/flop period), and concept-aligned part focus. Average progression is at
  // parity with the old flat model, so balance corridors hold.
  const aiOrder = TEAMS.map(t => ({ name: t.name, pts: (career.teamPts && career.teamPts[t.name]) || 0 })).sort((a, b) => b.pts - a.pts);
  const posOf = {}; aiOrder.forEach((o, idx) => { posOf[o.name] = idx + 1; });
  const N = TEAMS.length;
  TEAMS.forEach((t, i) => {
    if (i === career.teamIdx) return;
    const pos = posOf[t.name] || N;
    const atr = 0.55 + 0.5 * (pos - 1) / (N - 1);                 // P1 0.55 … last 1.05 (catch-up; avg ~0.8 = old)
    const vr = mix32(((career.seed >>> 0) + career.round * 2246822519 + i * 2654435761) >>> 0) / 4294967296;
    const variance = vr < 0.12 ? 0.5 : vr > 0.88 ? 1.45 : 1.0;    // mean-neutral flop / breakthrough swing
    const amt = AI_DEV_PER_DAY * dt * (t.facility ?? 0.75) * atr * variance * 2;   // ×2 = split across two parts (parity)
    const P = career.parts[t.name], k = aiConcept(t.name);
    if (k === "power") { P.pu += amt * 0.7; P.sidepods += amt * 0.3; }            // straight-line lean (power/eff)
    else if (k === "downforce") { P.floor += amt * 0.6; P.fw += amt * 0.4; }      // cornering lean (aero)
    else { P.floor += amt * 0.5; P.pu += amt * 0.5; }                              // balanced
  });
  // PU engine project (works) — completes like a chassis project; OFF the cost cap.
  if (career.puProject) {
    career.puProject.daysLeft -= dt;
    if (career.puProject.daysLeft <= 0) {
      const p = career.puProject;
      const roll = mix32(((career.seed >>> 0) + career.round * 40503 + 7) >>> 0) / 4294967296;
      const gain = p.gain * (1 - p.risk * roll) * devMult(career.staff);
      career.puParts = career.puParts || zeroPU();
      career.puParts[p.part] = (career.puParts[p.part] || 0) + gain;
      events.push({ type: "pu_done", part: p.part, gain });
      career.puProject = null;
    }
  }
  // PU program (customer → works): multi-season build; on completion you become a PU-maker.
  if (career.puProgram) {
    career.puProgram.daysLeft -= dt;
    if (career.puProgram.daysLeft <= 0) {
      if (career.backer) career.backer.puMaker = true;
      career.puParts = career.puParts || zeroPU();
      career.puProgram = null;
      events.push({ type: "pu_program_done" });
    }
  }
  return events;
}

// start a PU engine upgrade (works PU-makers only). OFF the cost cap (parent-funded). null on fail.
export function startPUProject(career, part, size) {
  if (!career || !career.backer || !career.backer.puMaker) return null;
  if (career.puProject || !PU_PARTS.includes(part)) return null;
  const spec = PROJECT_SIZE[size]; if (!spec) return null;
  if (career.money < spec.cost) return null;
  career.money -= spec.cost;                         // costs money, but NOT booked to the cost cap
  career.puProject = { part, size, daysLeft: spec.days, days: spec.days, gain: spec.gain, risk: spec.risk };
  return career.puProject;
}

// start a multi-season PU program (customer team → become a maker). Counts to the cost cap (your spend).
export function startPUProgram(career, kind) {
  if (!career || (career.backer && career.backer.puMaker) || career.puProgram) return null;
  const spec = PU_PROGRAM[kind]; if (!spec) return null;
  if (career.money < spec.cost) return null;
  career.money -= spec.cost;
  career.capSpent = (career.capSpent || 0) + spec.cost;
  career.puProgram = { kind, daysLeft: spec.days, days: spec.days };
  return career.puProgram;
}
