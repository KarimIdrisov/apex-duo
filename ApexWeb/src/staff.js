// ApexWeb/src/staff.js — pure staff & facilities model. Composes into personnel (pitMult/strategy),
// a development multiplier, and a per-race upkeep. Deterministic. At the start (no upgrades) the
// composed personnel matches genPersonnel's range, so the grid stays balance-neutral.
import { mix32 } from "./rng.js";

export const STAFF_ROLES = ["designer", "strategist", "pitCrew"];
export const ROLE_LABEL = { designer: "Гл. конструктор", strategist: "Стратег", pitCrew: "Пит-крю" };
// §Phase-5 — the R&D building tree. Beyond КБ/Пит-бокс/Завод: Симулятор (driver dev), Аэротруба
// (aero component quality → Known Components), Кадровый центр (staff training speed).
export const FACILITIES = ["design", "pit", "factory", "sim", "tunnel", "staffctr"];
export const FAC_LABEL = { design: "КБ", pit: "Пит-бокс", factory: "Завод", sim: "Симулятор", tunnel: "Аэротруба", staffctr: "Кадровый центр" };
export const FAC_MAX = 5;

// §Phase-5 — building PREREQUISITE tree: an advanced R&D building can't outrun its base. To raise it to
// level N, the base building must be at least N−1 (so you can't max a Wind Tunnel on a weak КБ). The
// three base buildings (design/pit/factory) have no prerequisite. Corridor-neutral (gates WHEN you can
// upgrade, not the effect); a seeded team — all facilities at the same level — can always step up by one.
export const FAC_PREREQ = { sim: "design", tunnel: "design", staffctr: "factory" };
export function facPrereqMet(staff, which) {
  const base = FAC_PREREQ[which];
  if (!base || !staff || !staff.facilities) return true;
  const target = (staff.facilities[which] || 0) + 1;        // the level we'd be upgrading TO
  return (staff.facilities[base] || 0) >= target - 1;        // the base must be within one level of it
}

export const STAFF_UPGRADE_COST = 2500;   // $k to raise a staff rating one step
export const FAC_UPGRADE_BASE = 3500;     // $k base for a facility level (×(level+1))
const STAFF_STEP = 0.06;

const clamp01 = v => Math.max(0, Math.min(1, v));

// §Phase-5 — staff have an AGE and a POTENTIAL ceiling: a young staffer can grow well above their current
// rating, a veteran is near their peak. This is the "buy proven-but-expensive vs young-cheap-with-upside"
// decision. Growth is applied OFF-SEASON only (tickStaffDevelopment in newSeason), so the in-season dev
// corridor is byte-identical — ratings are static across a season.
export const STAFF_AGE_MIN = 30, STAFF_AGE_MAX = 56, STAFF_PEAK_AGE = 50;
// seeded { age, potential } for a staffer of a given rating (deterministic). Younger ⇒ more headroom.
export function staffGrowth(rating, seed) {
  const s = seed >>> 0;
  const age = STAFF_AGE_MIN + Math.floor((mix32(s) / 4294967296) * (STAFF_AGE_MAX - STAFF_AGE_MIN));
  const youth = Math.max(0, Math.min(1, (STAFF_PEAK_AGE - age) / (STAFF_PEAK_AGE - STAFF_AGE_MIN)));   // 1 young → 0 at peak
  const potential = clamp01(rating + youth * 0.20 * (mix32((s ^ 0x9e3779b9) >>> 0) / 4294967296));     // up to +0.20 for the youngest
  return { age, potential };
}

// initial staff/facilities seeded from the team facility strength (0..1).
export function initStaff(teamFacility, seed) {
  const f = teamFacility ?? 0.75;
  const r = mix32((Math.round(f * 1000) + (seed >>> 0) * 7919) >>> 0) / 4294967296;
  const base = clamp01(f + (r - 0.5) * 0.06);
  const lv = Math.max(0, Math.min(FAC_MAX, Math.round(f * 3)));
  const dft = (ri) => { const g = staffGrowth(base, (seed >>> 0) + ri * 7919); return { name: "—", specialty: null, rating: base, salary: salaryForStaff(base), contractSeasons: 3, age: g.age, potential: g.potential }; };   // default in-house staff
  return { designer: base, strategist: base, pitCrew: base, fatigue: 0, facilities: { design: lv, pit: lv, factory: lv, sim: lv, tunnel: lv, staffctr: lv },
    people: { designer: dft(0), strategist: dft(1), pitCrew: dft(2) } };
}

// staff fatigue (Phase 4): calendar density wears the crew down — tight turnarounds (back-to-backs,
// triple-headers) accumulate fatigue; normal weeks recover a little; long breaks reset most of it.
// Fatigue makes pit stops slower and slows development; a long gap / the winter rests it fully.
export const FATIGUE_MAX = 0.85;
export function applyCalendarLoad(staff, gapDays) {
  if (!staff) return;
  const d = gapDays == null ? 14 : gapDays;
  let delta;
  if (d <= 8) delta = 0.16;          // back-to-back: crew runs hot
  else if (d >= 25) delta = -0.55;   // summer/winter break: big reset
  else if (d >= 19) delta = -0.28;   // long gap: real rest
  else delta = -0.04;                // normal week: slight recovery
  staff.fatigue = Math.max(0, Math.min(FATIGUE_MAX, (staff.fatigue || 0) + delta));
}

// personnel the sim reads: pit crew + pit facility -> pitMult (lower = faster); strategist + design -> strategy.
// fatigue slows the stop (higher pitMult).
export function composePersonnel(staff) {
  if (!staff) return { pitMult: 1.0, strategy: 0.75 };
  const fat = staff.fatigue || 0;
  const pit = clamp01(staff.pitCrew + (staff.facilities.pit / FAC_MAX) * 0.15);
  const pitMult = (1.15 - 0.4 * pit) * (1 + fat * 0.10) - specialtyBonus(staff, "pit");   // T2: pit-ace specialist
  return { pitMult: Math.max(0.6, pitMult), strategy: clamp01(staff.strategist + (staff.facilities.design / FAC_MAX) * 0.05 + specialtyBonus(staff, "strategy")) };
}

// development multiplier from the chief designer + the design office + the factory (1.0 neutral at
// designer 0.6 / no facilities). The design office is the primary R&D lever; the §Phase-5 FACTORY term
// adds manufacturing throughput (the AI already scales its dev by team facility, so this brings the
// player to parity, not a buff). Fatigue drags it down a little; an aero specialist speeds R&D (T2).
export const FACTORY_DEV = 0.12;   // factory's max contribution to dev speed (at FAC_MAX), below the design office's 0.3
export function devMult(staff) {
  if (!staff) return 1.0;
  const fat = staff.fatigue || 0;
  return (1 + (staff.designer - 0.6) * 0.5 + (staff.facilities.design / FAC_MAX) * 0.3 + ((staff.facilities.factory || 0) / FAC_MAX) * FACTORY_DEV + specialtyBonus(staff, "dev")) * (1 - fat * 0.12);
}

// per-race upkeep ($k) — bigger facilities cost more to run (tuned so a top team can run a full
// facility set + develop + pay salaries and stay comfortably solvent; M5 corridor).
export function upkeep(staff) {
  if (!staff) return 0;
  const lv = staff.facilities;
  return 70 * (lv.design + lv.pit + lv.factory + (lv.sim || 0) + (lv.tunnel || 0) + (lv.staffctr || 0));
}

// §Phase-5 — the Simulator (HQ building) speeds the player's driver development: a higher sim → more
// per-race growth. Null-safe (old saves without the sim facility read as level 0 = neutral ×1).
export function simDriverBoost(staff) {
  const lv = (staff && staff.facilities && staff.facilities.sim) || 0;
  return 1 + (lv / FAC_MAX) * 0.30;   // up to +30% driver development at a maxed Simulator
}

// upgrade a staff rating one step. Returns true if applied.
export function upgradeStaff(career, role) {
  if (!STAFF_ROLES.includes(role) || !career.staff) return false;
  if (career.money < STAFF_UPGRADE_COST || career.staff[role] >= 0.99) return false;
  career.money -= STAFF_UPGRADE_COST;
  career.capSpent = (career.capSpent || 0) + STAFF_UPGRADE_COST;   // cost-cap accounting
  career.staff[role] = clamp01(career.staff[role] + STAFF_STEP);
  return true;
}

// upgrade a facility one level (cost scales with the next level). Returns true if applied.
export function upgradeFacility(career, which) {
  if (!FACILITIES.includes(which) || !career.staff) return false;
  if (!facPrereqMet(career.staff, which)) return false;     // §Phase-5: base building must keep pace
  const lvl = career.staff.facilities[which];
  if (lvl >= FAC_MAX) return false;
  const cost = FAC_UPGRADE_BASE * (lvl + 1);
  if (career.money < cost) return false;
  career.money -= cost;
  career.capSpent = (career.capSpent || 0) + cost;   // cost-cap accounting
  career.staff.facilities[which] = lvl + 1;
  return true;
}

// --- D6: named staff market + specialties ---

// specialty tags — each belongs to one role and now grants a CONCRETE bonus (T2): aero → faster R&D,
// mechanical → car reliability, tactician → race strategy (SC/pit/wet), pit ace → faster stops.
export const SPECIALTIES = {
  aero:       { label: "Аэродинамик",          role: "designer",   fx: "dev",      fxVal: 0.06,  fxLabel: "+6% к разработке" },
  mechanical: { label: "Механик",              role: "designer",   fx: "rel",      fxVal: 0.015, fxLabel: "+надёжность машины" },
  powertrain: { label: "Моторный конструктор", role: "designer",   fx: "dev",      fxVal: 0.06,  fxLabel: "+6% к разработке" },
  tactician:  { label: "Тактик",               role: "strategist", fx: "strategy", fxVal: 0.05,  fxLabel: "+стратегия (SC/питы/дождь)" },
  pitace:     { label: "Ас пит-стопа",         role: "pitCrew",    fx: "pit",      fxVal: 0.04,  fxLabel: "быстрее пит-стопы" },
};
// §Phase-4 — the chief designer's expertise is AREA-SPECIFIC, not just a global rating: a designer
// develops their specialty's area faster and off-area parts a touch slower ("engine designer ≠ wing
// designer", masterplan §5.5). A generalist designer (specialty null — the default) is NEUTRAL, so
// development stays byte-identical. Mapped onto the dev-area vocabulary (aero/tyre/fuel/rel/power).
export const DESIGNER_FOCUS = 0.10;                                  // ± per-area gain swing of a specialist designer
const DESIGNER_AREA = { aero: "aero", mechanical: "rel", powertrain: "power" };
export function designerFocus(staff, areaKey) {
  const sp = staff && staff.people && staff.people.designer && staff.people.designer.specialty;
  const area = DESIGNER_AREA[sp];
  if (!area) return 1;                                               // generalist → neutral (balance-safe default)
  return areaKey === area ? 1 + DESIGNER_FOCUS : 1 - DESIGNER_FOCUS * 0.5;
}
// total bonus of a given kind across the team's hired specialists.
export function specialtyBonus(staff, kind) {
  if (!staff || !staff.people) return 0;
  let b = 0;
  for (const r of STAFF_ROLES) { const sp = staff.people[r] && staff.people[r].specialty, fx = sp && SPECIALTIES[sp]; if (fx && fx.fx === kind) b += fx.fxVal; }
  return b;
}
// reliability bonus the team's mechanical specialist adds to the player's car (read in applyRaceMods).
export function staffRelBonus(staff) { return specialtyBonus(staff, "rel"); }

// a fictional market of specialists (≥3 per role; names invented, no real people).
export const STAFF_MARKET_POOL = [
  { id: "d1", name: "Адриан Коул",  role: "designer",   specialty: "aero",       rating: 0.93 },
  { id: "d2", name: "Лука Ферри",   role: "designer",   specialty: "mechanical", rating: 0.85 },
  { id: "d3", name: "Йонас Берг",   role: "designer",   specialty: "aero",       rating: 0.78 },
  { id: "d4", name: "Рэй Окада",    role: "designer",   specialty: "powertrain", rating: 0.86 },
  { id: "s1", name: "Мария Сантос", role: "strategist", specialty: "tactician",  rating: 0.91 },
  { id: "s2", name: "Том Прайс",    role: "strategist", specialty: "tactician",  rating: 0.83 },
  { id: "s3", name: "Икэр Руис",    role: "strategist", specialty: "tactician",  rating: 0.76 },
  { id: "p1", name: "Ганс Вебер",   role: "pitCrew",    specialty: "pitace",     rating: 0.90 },
  { id: "p2", name: "Дэв Капур",    role: "pitCrew",    specialty: "pitace",     rating: 0.82 },
  { id: "p3", name: "Сэм О'Брайен", role: "pitCrew",    specialty: "pitace",     rating: 0.75 },
];

// staff wage ($k/race) for a rating — used for the hire fee + displayed salary (cheap; a star ~$0.2M).
export function salaryForStaff(rating) { return Math.round(40 + Math.pow(Math.max(0, rating - 0.6), 1.6) * 900); }

// the hireable market for a season seed — deterministic order (refreshes by seed), each priced.
export function staffMarket(seed) {
  const s = seed >>> 0;
  return STAFF_MARKET_POOL
    .map(p => ({ ...p, salary: salaryForStaff(p.rating), ...staffGrowth(p.rating, (s + p.id.charCodeAt(0) * 131 + p.id.charCodeAt(1)) >>> 0), _o: mix32((s * 2654435761 + p.id.charCodeAt(0) * 131 + p.id.charCodeAt(1)) >>> 0) }))
    .sort((a, b) => a._o - b._o)
    .map(({ _o, ...p }) => p);
}

// hire a specialist: pay a lump fee (≈8 races of wage), jump that role's rating, record the person.
export function hireStaff(career, person) {
  if (!career || !career.staff || !person || !STAFF_ROLES.includes(person.role)) return false;
  const fee = salaryForStaff(person.rating) * 8;
  if (career.money < fee) return false;
  career.money -= fee;
  career.capSpent = (career.capSpent || 0) + fee;   // cost-cap accounting
  career.staff[person.role] = clamp01(person.rating);
  career.staff.people = career.staff.people || {};
  career.staff.people[person.role] = { name: person.name, specialty: person.specialty, rating: person.rating, salary: salaryForStaff(person.rating) };
  return true;
}

// total staff wage bill ($k/race) — a displayed readout (NOT deducted, to keep the economy safe).
export function staffSalaries(staff) {
  if (!staff || !staff.people) return 0;
  return STAFF_ROLES.reduce((s, r) => s + ((staff.people[r] && staff.people[r].salary) || 0), 0);
}

// ===== T1/T3: living staff — named staff in every team, a poach market, contracts, development =====

// fictional staff names (no real people). Enough to fill 11 teams × 3 roles + free agents.
const NAME_POOL = [
  "Адриан Коул", "Лука Ферри", "Йонас Берг", "Мария Сантос", "Том Прайс", "Икэр Руис", "Ганс Вебер", "Дэв Капур",
  "Сэм О'Брайен", "Нильс Хофман", "Элиза Романо", "Карл Юнг", "Пьер Дюбуа", "Анна Ковач", "Рауль Мендес",
  "Финн Ларсен", "Юки Танака", "Олег Дунаев", "Мартин Свобода", "Эмре Йылдыз", "Лео Бьянки", "Софи Лоран",
  "Дитер Фукс", "Хуан Морено", "Кенджи Сато", "Бьёрн Нильсен", "Грег Уоллес", "Чжан Вэй", "Андре Силва",
  "Мик Доусон", "Паоло Конти", "Ларс Эриксон", "Надим Хан", "Густаво Лима", "Виктор Попов", "Тео Морель",
  "Якоб Майер", "Рик ван дер Берг", "Сантьяго Вега", "Имре Надь", "Феликс Браун", "Дани Ортис", "Нора Линд",
  "Хьюго Мартин", "Зейн Малик", "Артуро Росси",
];
const ROLE_SPECS = { designer: ["aero", "mechanical", "powertrain"], strategist: ["tactician"], pitCrew: ["pitace"] };
const STAFF_CONTRACT_RACES = 999;   // (display only; contracts tick per season)

// one named staffer for a role at a target rating, deterministic by (name, role, seed).
function genStaffer(name, role, rating, seed) {
  const r = mix32((seed >>> 0) + name.charCodeAt(0) * 131 + name.length) / 4294967296;
  const specs = ROLE_SPECS[role] || [];
  const specialty = (r < 0.62 && specs.length) ? specs[Math.floor(r * 997) % specs.length] : null;   // ~62% are specialists
  const g = staffGrowth(clamp01(rating), (seed >>> 0) + name.length * 2654435761);
  return { name, role, specialty, rating: clamp01(rating), salary: salaryForStaff(rating), contractSeasons: 1 + (Math.floor(r * 7) % 3), age: g.age, potential: g.potential };
}

// named staff for every team, ratings scaled by team facility strength. Stored on the career so poaching
// can persist (a rival actually loses the person). teams = [{name, facility}], in grid order.
export function initTeamStaff(teams, seed) {
  const out = {};
  teams.forEach((t, ti) => {
    const fac = t.facility ?? 0.75;
    out[t.name] = {};
    STAFF_ROLES.forEach((role, ri) => {
      const idx = (ti * 3 + ri) % NAME_POOL.length;
      const jit = (mix32((seed >>> 0) + ti * 9176 + ri * 311) / 4294967296 - 0.5) * 0.08;
      out[t.name][role] = genStaffer(NAME_POOL[idx], role, clamp01(fac + jit), (seed >>> 0) + ti * 100 + ri);
    });
  });
  return out;
}

// the hire market: free agents (seeded pool) + every rival team's staff (poachable). Each entry tagged
// with `team` (null = free agent) so the UI/career can price + apply a poach correctly.
export function staffMarketAll(career, seed) {
  const s = (seed >>> 0);
  const free = staffMarket(s).map(p => ({ ...p, team: null }));   // the classic free-agent pool
  const rivals = [];
  const ts = career && career.teamStaff;
  const myTeam = career && career._myTeamName;
  if (ts) for (const tn in ts) { if (tn === myTeam) continue; for (const role of STAFF_ROLES) { const p = ts[tn][role]; if (p) rivals.push({ ...p, team: tn, id: `${tn}:${role}` }); } }
  return [...free, ...rivals].sort((a, b) => b.rating - a.rating);
}

// poach fee — a free agent costs ~8 races of wage; prying someone from a rival adds a ~60% premium.
export function staffHireFee(person) { return Math.round(salaryForStaff(person.rating) * (person.team ? 12.8 : 8)); }

// hire from the market. Free agent → straight hire. Rival → poach: the rival loses the person (replaced
// by a weaker stand-in) and takes a small competitiveness hit (negative gridBoost). Returns true on success.
export function hireFromMarket(career, person) {
  if (!career || !career.staff || !STAFF_ROLES.includes(person.role)) return false;
  const fee = staffHireFee(person);
  if (career.money < fee) return false;
  career.money -= fee;
  career.capSpent = (career.capSpent || 0) + fee;
  career.staff[person.role] = clamp01(person.rating);
  career.staff.people = career.staff.people || {};
  career.staff.people[person.role] = { name: person.name, specialty: person.specialty, rating: person.rating, salary: salaryForStaff(person.rating), contractSeasons: 3 };
  if (person.team && career.teamStaff && career.teamStaff[person.team]) {       // poach → weaken the rival
    const repl = genStaffer(NAME_POOL[(person.name.length * 7) % NAME_POOL.length], person.role, clamp01(person.rating - 0.18), (career.seed >>> 0) + 777);
    career.teamStaff[person.team][person.role] = repl;
    career.gridBoost = career.gridBoost || {};
    career.gridBoost[person.team] = (career.gridBoost[person.team] || 0) - 0.012;
  }
  return true;
}

// re-sign one of the player's named staff (reset contract). Fee ≈ 5 races of wage.
export function reSignStaff(career, role) {
  const p = career && career.staff && career.staff.people && career.staff.people[role];
  if (!p) return false;
  const fee = salaryForStaff(p.rating || career.staff[role]) * 5;
  if (career.money < fee) return false;
  career.money -= fee; career.capSpent = (career.capSpent || 0) + fee;
  p.contractSeasons = 3;
  return true;
}

// T3: per-race staff development. Roles flagged in career.staffTrain creep up, the design office (КБ)
// accelerating; a small per-race cost is folded into the return for the ledger. Returns $k spent.
export const STAFF_TRAIN_COST = 120;   // $k/race while a role is in training
export function tickStaffTrain(career) {
  const st = career && career.staff; if (!st || !career.staffTrain) return 0;
  let spent = 0;
  for (const role of STAFF_ROLES) {
    if (!career.staffTrain[role]) continue;
    const accel = 1 + (st.facilities.design / FAC_MAX) * 0.6 + ((st.facilities.staffctr || 0) / FAC_MAX) * 0.6;   // §Phase-5: the Кадровый центр accelerates staff training
    st[role] = clamp01(st[role] + 0.0045 * accel);
    if (st.people && st.people[role]) st.people[role].rating = st[role];
    spent += STAFF_TRAIN_COST;
  }
  return spent;
}

// §Phase-5 — off-season staff development: each hired staffer drifts toward their POTENTIAL (faster when
// young), ages a year, and gently declines past the peak age. Called from career.newSeason only, so
// in-season ratings (and the dev corridor) are unchanged. Mirrors the driver-development curve.
export function tickStaffDevelopment(career) {
  const st = career && career.staff; if (!st || !st.people) return;
  for (const role of STAFF_ROLES) {
    const p = st.people[role]; if (!p) continue;
    p.age = (p.age || 42) + 1;
    const pot = (p.potential != null) ? p.potential : (st[role] || p.rating || 0.6);
    const cur = (st[role] != null) ? st[role] : (p.rating || 0.6);
    let next = cur;
    if (p.age <= STAFF_PEAK_AGE && cur < pot) {
      const youth = Math.max(0, Math.min(1, (STAFF_PEAK_AGE - p.age) / (STAFF_PEAK_AGE - STAFF_AGE_MIN)));
      next = clamp01(cur + (pot - cur) * (0.18 + 0.30 * youth));          // grow toward potential, faster young
    } else if (p.age > STAFF_PEAK_AGE) {
      next = clamp01(cur - 0.008 * (p.age - STAFF_PEAK_AGE));             // gentle post-peak decline
    }
    st[role] = next; p.rating = next; p.salary = salaryForStaff(next);
  }
}

// --- T4: facility upgrades as timed construction projects ---
export const FAC_BUILD_DAYS = { 1: 40, 2: 55, 3: 75, 4: 100, 5: 130 };   // days to build the Nth level
export function startFacilityProject(career, which) {
  if (!FACILITIES.includes(which) || !career.staff || career.facilityProject) return false;
  if (!facPrereqMet(career.staff, which)) return false;     // §Phase-5: base building must keep pace
  const lvl = career.staff.facilities[which];
  if (lvl >= FAC_MAX) return false;
  const cost = FAC_UPGRADE_BASE * (lvl + 1);
  if (career.money < cost) return false;
  career.money -= cost; career.capSpent = (career.capSpent || 0) + cost;
  career.facilityProject = { which, daysLeft: FAC_BUILD_DAYS[lvl + 1] || 90, days: FAC_BUILD_DAYS[lvl + 1] || 90 };
  return true;
}
// advance construction by elapsed days; on completion bump the facility level. Returns a done event or null.
export function tickFacility(career, days) {
  const fp = career && career.facilityProject; if (!fp) return null;
  fp.daysLeft -= Math.max(0, days || 0);
  if (fp.daysLeft > 0) return null;
  career.staff.facilities[fp.which] = Math.min(FAC_MAX, career.staff.facilities[fp.which] + 1);
  const which = fp.which; career.facilityProject = null;
  return { which, level: career.staff.facilities[which] };
}
