// ApexWeb/src/data.js — ported from ApexDuo_Prototype (f1_2026.gd, race_sim.gd).
// car{} = composed team_car() scalars (power from engine, aero from chassis,
// rel = engine.rel*chassis.rel). Values track the prototype's tier order.

export const TEAMS = [
  { name:"McLaren",      color:"#ff8000", facility:0.95, car:{power:0.93, aero:0.97, energy:0.90, rel:0.95, tyre:1.05, fuel:1.05},
    drivers:[{name:"Норрис",abbrev:"NOR",skill:0.950},{name:"Пиастри",abbrev:"PIA",skill:0.942}] },
  { name:"Mercedes",     color:"#27f4d2", facility:0.92, car:{power:0.95, aero:0.90, energy:0.93, rel:0.94, tyre:1.04, fuel:1.04},
    drivers:[{name:"Антонелли",abbrev:"ANT",skill:0.934},{name:"Расселл",abbrev:"RUS",skill:0.928}] },
  { name:"Red Bull",     color:"#3671c6", facility:0.90, car:{power:0.90, aero:0.93, energy:0.88, rel:0.90, tyre:1.03, fuel:1.02},
    drivers:[{name:"Ферстаппен",abbrev:"VER",skill:0.944},{name:"Аджар",abbrev:"HAD",skill:0.848}] },
  { name:"Ferrari",      color:"#e8002d", facility:0.88, car:{power:0.94, aero:0.88, energy:0.90, rel:0.91, tyre:1.02, fuel:1.02},
    drivers:[{name:"Леклер",abbrev:"LEC",skill:0.898},{name:"Хэмилтон",abbrev:"HAM",skill:0.886}] },
  { name:"Williams",     color:"#64c4ff", facility:0.80, car:{power:0.94, aero:0.82, energy:0.90, rel:0.88, tyre:0.99, fuel:1.00},
    drivers:[{name:"Сайнс",abbrev:"SAI",skill:0.862},{name:"Албон",abbrev:"ALB",skill:0.852}] },
  { name:"Aston Martin", color:"#229971", facility:0.82, car:{power:0.90, aero:0.83, energy:0.88, rel:0.89, tyre:1.00, fuel:1.00},
    drivers:[{name:"Алонсо",abbrev:"ALO",skill:0.846},{name:"Стролл",abbrev:"STR",skill:0.800}] },
  { name:"Alpine",       color:"#0093cc", facility:0.74, car:{power:0.86, aero:0.84, energy:0.85, rel:0.86, tyre:0.98, fuel:0.99},
    drivers:[{name:"Гасли",abbrev:"GAS",skill:0.816},{name:"Колапинто",abbrev:"COL",skill:0.788}] },
  { name:"RB",           color:"#6692ff", facility:0.78, car:{power:0.90, aero:0.81, energy:0.88, rel:0.88, tyre:0.99, fuel:1.00},
    drivers:[{name:"Лоусон",abbrev:"LAW",skill:0.798},{name:"Линдблад",abbrev:"LIN",skill:0.768}] },
  { name:"Haas",         color:"#b6babd", facility:0.72, car:{power:0.94, aero:0.79, energy:0.90, rel:0.87, tyre:0.97, fuel:0.99},
    drivers:[{name:"Окон",abbrev:"OCO",skill:0.786},{name:"Бирман",abbrev:"BEA",skill:0.760}] },
  { name:"Sauber",       color:"#52e252", facility:0.70, car:{power:0.88, aero:0.80, energy:0.86, rel:0.86, tyre:0.98, fuel:0.99},
    drivers:[{name:"Хюлькенберг",abbrev:"HUL",skill:0.764},{name:"Бортолето",abbrev:"BOR",skill:0.738}] },
  { name:"Cadillac",     color:"#c9a227", facility:0.68, car:{power:0.94, aero:0.78, energy:0.90, rel:0.84, tyre:0.97, fuel:0.98},
    drivers:[{name:"Перес",abbrev:"PER",skill:0.742},{name:"Боттас",abbrev:"BOT",skill:0.726}] },
];

export const TRACK = {
  // lt/pw/df validated vs FastF1 2024 (Spain): lt 79.5–82, pw−df −0.25 ≈ our −0.27 (AERO). pit
  // corrected 21.5→23.5 (real green-ref pit-loss 23.4/23.7). compounds stay manual (FastF1 can't
  // isolate tyre pace; soft/hard −0.55/+0.55 symmetry confirmed). ot now vestigial (overtake_zones).
  name:"Барселона", gp:"Гран-при Испании", laps:66, lt:80.0, pit:23.5,
  df:0.82, pw:0.55, ot:0.30, abr:1.25, harv:0.58, dep:0.55, sc:0.25, wet:0.30, el:0.82,
  // overtake zones (mini-sector indices 0..17): a pass completes only here (TODO #2b)
  overtake_zones: [
    { sectors: [0, 1, 2], ease: 0.55, type: "brake" },   // Turn 1 — heavy braking after the main straight
    { sectors: [11, 12],   ease: 0.45, type: "slip" },    // slipstream into the final-sector entry
  ],
};

// real circuit outline (Barcelona-Catalunya), normalized 0..1, ported from the
// Godot track_shapes.gd (f1-circuits-svg, CC BY 4.0). Flat [x0,y0,x1,y1,...].
export const TRACK_PATH = [
  0.8964,0.1926, 0.8787,0.2206, 0.8610,0.2486, 0.8434,0.2767, 0.8257,0.3047, 0.8080,0.3328,
  0.7904,0.3608, 0.7727,0.3889, 0.7550,0.4170, 0.7374,0.4450, 0.7197,0.4731, 0.7020,0.5011,
  0.6844,0.5292, 0.6667,0.5573, 0.6491,0.5853, 0.6314,0.6134, 0.6138,0.6414, 0.5961,0.6695,
  0.5784,0.6976, 0.5608,0.7256, 0.5431,0.7537, 0.5255,0.7818, 0.5078,0.8098, 0.4902,0.8379,
  0.4725,0.8659, 0.4549,0.8940, 0.4372,0.9221, 0.4182,0.9491, 0.3880,0.9597, 0.3591,0.9441,
  0.3282,0.9339, 0.2974,0.9447, 0.2707,0.9644, 0.2439,0.9839, 0.2144,0.9983, 0.1815,1.0000,
  0.1495,0.9918, 0.1219,0.9737, 0.1039,0.9461, 0.0937,0.9146, 0.0907,0.8817, 0.0943,0.8488,
  0.1039,0.8171, 0.1192,0.7877, 0.1367,0.7596, 0.1542,0.7314, 0.1718,0.7033, 0.1894,0.6752,
  0.2071,0.6472, 0.2251,0.6193, 0.2505,0.5992, 0.2829,0.6022, 0.3078,0.6232, 0.3189,0.6542,
  0.3190,0.6872, 0.3062,0.7174, 0.2888,0.7457, 0.2715,0.7740, 0.2543,0.8023, 0.2371,0.8306,
  0.2221,0.8600, 0.2322,0.8896, 0.2638,0.8937, 0.2938,0.8796, 0.3237,0.8652, 0.3535,0.8508,
  0.3831,0.8359, 0.4098,0.8163, 0.4331,0.7928, 0.4526,0.7659, 0.4709,0.7383, 0.4889,0.7105,
  0.4877,0.6787, 0.4620,0.6583, 0.4365,0.6375, 0.4211,0.6082, 0.4081,0.5777, 0.3952,0.5472,
  0.3824,0.5166, 0.3697,0.4860, 0.3615,0.4541, 0.3685,0.4220, 0.3889,0.3963, 0.4172,0.3791,
  0.4468,0.3643, 0.4764,0.3493, 0.5060,0.3343, 0.5355,0.3193, 0.5651,0.3042, 0.5946,0.2892,
  0.6240,0.2739, 0.6534,0.2585, 0.6827,0.2431, 0.7121,0.2277, 0.7415,0.2123, 0.7708,0.1968,
  0.7898,0.1711, 0.7747,0.1433, 0.7446,0.1302, 0.7116,0.1308, 0.6804,0.1416, 0.6540,0.1616,
  0.6255,0.1769, 0.5931,0.1718, 0.5721,0.1472, 0.5700,0.1148, 0.5898,0.0889, 0.6152,0.0676,
  0.6407,0.0464, 0.6662,0.0252, 0.6929,0.0059, 0.7253,0.0000, 0.7571,0.0085, 0.7865,0.0237,
  0.8139,0.0424, 0.8418,0.0603, 0.8696,0.0784, 0.8947,0.0997, 0.9090,0.1293, 0.9093,0.1622,
];

export const COMPOUNDS = {
  soft:   { pace:-0.55, wear:2.6, cliff:65, warm:1.4, wet_opt:0.0 },
  medium: { pace: 0.00, wear:1.7, cliff:78, warm:1.0, wet_opt:0.0 },
  hard:   { pace: 0.55, wear:1.1, cliff:90, warm:0.7, wet_opt:0.0 },
  inter:  { pace: 0.30, wear:1.9, cliff:70, warm:1.1, wet_opt:0.5 },
  wet:    { pace: 0.50, wear:1.6, cliff:75, warm:1.0, wet_opt:0.9 },
};

// tyre temperature model. temp 0..1 (1 = in the window). Fresh tyres are cold.
export const TYRE = {
  warmPen:  1.2,   // s/lap when fully cold (temp 0) -> rewards warming up
  ease:     0.5,   // how fast temp eases toward 1 each lap (× compound.warm)
  gridTemp: 0.55,  // tyre temp at the race start (formation lap warmed them)
  pitTemp:  0.20,  // tyre temp leaving the pits (cold out-lap)
};

// per-sector car fit: how strongly power (straights) / aero (corners) reshapes the
// mini-sector split distribution. 0 = flat splits; bigger = more sector specialism.
export const FIT_K = 0.6;

// overtaking model (Phase 4). slipstream tow on straights; dirty air in corners.
export const SLIP_K     = 0.25;  // pass-credit/tick from tow, × straightness × car.power
export const EDGE_REF   = 0.35;  // s/lap pace edge at which the tow converts in full; below this the tow is
                                 // scaled down so the draft AMPLIFIES a real edge, never builds a pass from nothing (§18.13)
export const PASS_CREDIT_CAP   = 2.5;   // max bankable pass-credit — a whole straight of tow can't be cashed in one tick (§18.13)
export const PASS_CREDIT_DECAY = 0.97;  // per-tick credit bleed (recency) — stale draft from laps ago doesn't carry (§18.13)
export const BLUE_GAP   = 0.5;   // seconds: a car a lap+ down within this far AHEAD on track triggers a lapping (blue flags)
export const BLUE_PACE  = 0.5;   // s/lap rate the lapping car loses while spending its blue-flag budget
export const BLUE_COST  = 0.12;  // total s lost PER backmarker cleared — a fixed one-shot cost (no closing-rate runaway);
                                 // ~1.5 s/race for a leader threading the backmarkers it laps (realistic)
export const DIRTY_GAP  = 1.5;   // seconds: within this behind a car you are in dirty air
export const DIRTY_WEAR = 0.006; // extra tyre wear/tick in dirty air, × (1 - straightness)
export const DIRTY_PACE_K = 1.1; // s/lap the follower LOSES in dirty air at ZERO gap, × (1 - straightness) × (1 - gap/DIRTY_GAP):
                                 // lost downforce, graded by proximity (close hurts more); ~0.8 at the typical ~0.4 s pinned gap (§18.11)
                                 // costs pace, worse in corners — following is genuinely hard (the tow still pays on straights) (§18.11)

// events (Phase 5): start incident + safety car.
export const EVENT = {
  startReact: 0.30,  // s: random reaction spread off the line at lights-out
  startLaunch: 2.0,  // s per unit of start-skill deviation from the field mean (the launch shuffle)
  startCap:   0.9,   // s: max a launch can gain/lose (bounds the opening-lap shuffle)
  startP:     0.02,  // per-car chance of a bog-down / anti-stall off the line
  startLoss:  1.8,   // seconds lost in a bog-down
  startDnf:   0.12,  // chance a bog-down becomes a DNF
  scPaceMult: 1.40,  // everyone laps at 140% under the safety car
  scMinLaps:  3,     // the SC stays out this many leader-laps
  scTrainGap: 0.6,   // seconds between cars in the bunched SC train
  scPitMult:  0.55,  // pit time-loss multiplier under SC (a cheap stop)
};

// weather (Phase 6): wet pace penalty for using a compound off its optimal wetness.
export const WET = {
  mismatch: 3.0,  // s/lap per unit |wetness - compound.wet_opt|
  slick:    8.0,  // s/lap extra for a slick once standing water forms (× wetness over 0.4)
};

// FM driver-attribute modulation weights (Phase 7). Each effect is CENTERED on the
// attribute's 0.5 midpoint, so an average driver reproduces the pre-Phase-7 behaviour.
export const ATTRW = {
  wear:       0.30,  // tyre wear ×(1 - wear·(tyre-0.5)·2)   → ±30% across the attr range
  overtaking: 0.60,  // pass-credit ×(0.7 + overtaking·0.6)
  defending:  0.60,  // pass resistance ×(0.7 + defending·0.6)
  wet:        0.60,  // wet penalty ×(1.3 - wet·0.6)
  noise:      0.60,  // lap noise ×(1.3 - consistency·0.6)
  starts:     1.0,   // start-incident prob ×(1.5 - starts)
  fuel:       0.20,  // fuel burn ×(1.1 - smoothness·0.2)
  carWear:    0.20,  // tyre wear ×(2 - car.tyre)            → car.tyre 1.0 = neutral
  composure:  0.50,  // bog-down + quali-mistake prob ×(1 - composure·(comp-0.5)·2)  → calmer under pressure (§18.7)
  aggression: 0.40,  // pass-credit ×(1 + aggression·(aggr-0.5)·2)                    → braver overtaker (§18.7)
  discipline: 0.40,  // dirty-air wear ×(1 - discipline·(disc-0.5)·2)                 → cleaner in traffic (§18.7)
};

// difficulty: the AI sharpness scalar (Race.difficulty). Lower = the AI is slower, sloppier,
// and less willing to gamble -> easier for the player and more winner variety in the field.
export const DIFFICULTY = {
  easy:   { label: "Лёгкая",  ai: 0.55 },
  normal: { label: "Обычная", ai: 0.80 },
  hard:   { label: "Сложная", ai: 1.00 },
};
export const AI_HANDICAP = 0.80;  // s/lap an AI loses at difficulty 0 (scaled by 1-difficulty)
export const AI_NOISE    = 0.25;  // extra per-lap noise amplitude for AI at difficulty 0 (scaled by 1-difficulty)
export const AI_FORM     = 1.0;   // per-RACE form swing amplitude for AI at difficulty 0 (scaled by 1-difficulty);
                                  // a fixed whole-race offset per car → genuine upsets at low difficulty (doesn't average out)
export const RACE_FORM   = 0.15;  // ±s/lap per-RACE "form" swing applied to EVERY car (incl. at hard difficulty);
                                  // a fixed whole-race offset, seeded → "off/on weekend for anyone", breaks the
                                  // deterministic best-package lock the car-pace term would otherwise create (§18.1)

// pace modes: pace offset (s/lap), wear multiplier, mechanical-risk multiplier
export const PACE_MODES = {
  conserve: { pace: 0.45, wear:0.80, risk:0.4 },
  balanced: { pace: 0.00, wear:1.00, risk:1.0 },
  push:     { pace:-0.45, wear:1.30, risk:1.8 },
};

// tuning constants (start points from race_sim.gd; calibrated in tools/balance.mjs)
export const SKILL_K   = 4.5;    // s/lap per unit driver-pace above 0.5 (compressed from 7.0 so the CAR is co-primary — §18.1)
export const CAR_PACE_K = 9.0;   // s/lap per unit ((power+aero)/2 − fieldMean): the ABSOLUTE car-performance term (§18.1)
export const CAR_K     = 1.2;    // s/lap per (power-aero)*(pw-df) track-character bias (on top of the absolute term)
export const DNF_BASE  = 0.0075; // per-lap mechanical-failure scale * (1-rel)
export const STEP      = 0.25;   // sim time-step (seconds)
export const COMBAT_GAP = 0.8;   // seconds: within this, two cars fight
export const PASS_K    = 1.6;    // pass-credit accrual per unit track.ot
// bold out-of-zone lunge (§18.2): a much-faster, aggressive driver risks a move where you "can't pass".
// Instantaneous + cooldown-gated + contact risk (no credit banking) so it can't be spammed.
export const AGGR_PASS_EDGE = 1.0;  // min pace edge (s/lap) to even attempt a bold move
export const AGGR_PASS_ATTR = 0.70; // min driver aggression to attempt
export const AGGR_PASS_REF  = 1.0;  // edge (above the threshold) at which the success factor saturates
export const AGGR_PASS_K    = 1.6;  // overall success scalar (tuned so out-of-zone passes stay ~1-2/race)
export const AGGR_PASS_DNF  = 0.02; // chance a FAILED lunge ends in contact → the attacker retires
export const AGGR_PASS_SCRUB = 0.15;// tyre-temp scrubbed off on a SUCCESSFUL lunge (lock-up/run-wide) — a transient,
                                    // self-healing pace cost so the bold move isn't free (§18.2 round-2)
// anti-spam: ONE bold attempt per rival-ahead (keyed on ahead.idx), not a recurring time cooldown — over a
// multi-thousand-second race a time cooldown would allow hundreds of risky attempts and inflate DNF.
export const GRID_GAP  = 0.25;   // starting time spread per grid slot (seconds) — widened from 0.20 so a launch delta causes fewer swaps (§18.3)
export const LAP1_CAUTION = 0.4; // pass-credit multiplier on the opening lap (lap 0): the field settles the launch/grid order through T1, racing opens from lap 1 (§18.3)

// engine modes: pace offset (s/lap), fuel burn multiplier. Replaces ERS_MODES.
export const ENGINE_MODES = {
  save:     { pace:  0.35, burn: 0.85 },
  standard: { pace:  0.00, burn: 1.00 },
  push:     { pace: -0.30, burn: 1.20 },
};
// fuel as a hard resource. fuel is measured in lap-equivalents of standard burn.
export const FUEL = {
  margin:  0.06,   // start with +6% over the exact race need
  weightK: 0.020,  // s/lap added per lap-equivalent of fuel still aboard (heavy early)
};

// team name -> logo file in assets/teams/ (Godot art; Sauber=audi, RB=racing_bulls)
export const TEAM_LOGO = {
  "McLaren": "mclaren", "Mercedes": "mercedes", "Red Bull": "red_bull", "Ferrari": "ferrari",
  "Williams": "williams", "Aston Martin": "aston_martin", "Alpine": "alpine", "RB": "racing_bulls",
  "Haas": "haas", "Sauber": "audi", "Cadillac": "cadillac",
};

// driver abbrev -> { logo, color, team } so UI can show a logo from just an abbrev
export const DRIVER_INFO = {};
for (const t of TEAMS) for (const d of t.drivers) {
  DRIVER_INFO[d.abbrev] = { logo: TEAM_LOGO[t.name], color: t.color, team: t.name };
}
