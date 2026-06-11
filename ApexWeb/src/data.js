// ApexWeb/src/data.js — ported from ApexDuo_Prototype (f1_2026.gd, race_sim.gd).
// car{} = composed team_car() scalars (power from engine, aero from chassis,
// rel = engine.rel*chassis.rel). Values track the prototype's tier order.

export const TEAMS = [
  { name:"McLaren",      color:"#ff8000", car:{power:0.93, aero:0.97, energy:0.90, rel:0.95},
    drivers:[{name:"Норрис",abbrev:"NOR",skill:0.950},{name:"Пиастри",abbrev:"PIA",skill:0.942}] },
  { name:"Mercedes",     color:"#27f4d2", car:{power:0.95, aero:0.90, energy:0.93, rel:0.94},
    drivers:[{name:"Антонелли",abbrev:"ANT",skill:0.934},{name:"Расселл",abbrev:"RUS",skill:0.928}] },
  { name:"Red Bull",     color:"#3671c6", car:{power:0.90, aero:0.93, energy:0.88, rel:0.90},
    drivers:[{name:"Ферстаппен",abbrev:"VER",skill:0.944},{name:"Аджар",abbrev:"HAD",skill:0.848}] },
  { name:"Ferrari",      color:"#e8002d", car:{power:0.94, aero:0.88, energy:0.90, rel:0.91},
    drivers:[{name:"Леклер",abbrev:"LEC",skill:0.898},{name:"Хэмилтон",abbrev:"HAM",skill:0.886}] },
  { name:"Williams",     color:"#64c4ff", car:{power:0.94, aero:0.82, energy:0.90, rel:0.88},
    drivers:[{name:"Сайнс",abbrev:"SAI",skill:0.862},{name:"Албон",abbrev:"ALB",skill:0.852}] },
  { name:"Aston Martin", color:"#229971", car:{power:0.90, aero:0.83, energy:0.88, rel:0.89},
    drivers:[{name:"Алонсо",abbrev:"ALO",skill:0.846},{name:"Стролл",abbrev:"STR",skill:0.800}] },
  { name:"Alpine",       color:"#0093cc", car:{power:0.86, aero:0.84, energy:0.85, rel:0.86},
    drivers:[{name:"Гасли",abbrev:"GAS",skill:0.816},{name:"Колапинто",abbrev:"COL",skill:0.788}] },
  { name:"RB",           color:"#6692ff", car:{power:0.90, aero:0.81, energy:0.88, rel:0.88},
    drivers:[{name:"Лоусон",abbrev:"LAW",skill:0.798},{name:"Линдблад",abbrev:"LIN",skill:0.768}] },
  { name:"Haas",         color:"#b6babd", car:{power:0.94, aero:0.79, energy:0.90, rel:0.87},
    drivers:[{name:"Окон",abbrev:"OCO",skill:0.786},{name:"Бирман",abbrev:"BEA",skill:0.760}] },
  { name:"Sauber",       color:"#52e252", car:{power:0.88, aero:0.80, energy:0.86, rel:0.86},
    drivers:[{name:"Хюлькенберг",abbrev:"HUL",skill:0.764},{name:"Бортолето",abbrev:"BOR",skill:0.738}] },
  { name:"Cadillac",     color:"#c9a227", car:{power:0.94, aero:0.78, energy:0.90, rel:0.84},
    drivers:[{name:"Перес",abbrev:"PER",skill:0.742},{name:"Боттас",abbrev:"BOT",skill:0.726}] },
];

export const TRACK = {
  name:"Барселона", laps:66, lt:80.0, pit:21.5,
  df:0.82, pw:0.55, ot:0.30, abr:1.25, harv:0.58, dep:0.55, sc:0.25, el:0.82,
};

export const COMPOUNDS = {
  soft:   { pace:-0.55, wear:2.6, cliff:65 },
  medium: { pace: 0.00, wear:1.7, cliff:78 },
  hard:   { pace: 0.55, wear:1.1, cliff:90 },
};

// pace modes: pace offset (s/lap), wear multiplier, mechanical-risk multiplier
export const PACE_MODES = {
  conserve: { pace: 0.45, wear:0.80, risk:0.4 },
  balanced: { pace: 0.00, wear:1.00, risk:1.0 },
  push:     { pace:-0.45, wear:1.30, risk:1.8 },
};

// ERS modes: pace offset (s/lap), SoC change %/lap (+harvest / -deploy)
export const ERS_MODES = {
  harvest:  { pace: 0.30, soc: 6.0 },
  balanced: { pace: 0.00, soc: 0.0 },
  attack:   { pace:-0.38, soc:-6.5 },
};

// tuning constants (start points from race_sim.gd; calibrated in tools/balance.mjs)
export const SKILL_K   = 3.0;    // s/lap per unit skill above 0.5
export const CAR_K     = 1.2;    // s/lap per (power-aero)*(pw-df) track-character bias
export const DNF_BASE  = 0.005;  // per-lap mechanical-failure scale * (1-rel)
export const CLIP_PEN  = 0.32;   // s/lap when battery spent
export const STEP      = 0.25;   // sim time-step (seconds)
export const COMBAT_GAP = 0.8;   // seconds: within this, two cars fight
export const PASS_K    = 1.6;    // pass-credit accrual per unit track.ot
export const GRID_GAP  = 0.20;   // starting time spread per grid slot (seconds)
