// ApexWeb/src/pitcrew.js — the named pit crew as a managed unit. Assemble members across the five
// pit-stop roles, train them, manage fatigue, injuries and chemistry (cohesion). The crew composes
// into the two things the sim cares about: pitMult (how fast the stop is) and the chance of a botched
// or disastrous stop. Pure & deterministic (mix32) so it mirrors in the Node harness and is coop-safe.
import { mix32 } from "./rng.js";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const clamp01 = v => clamp(v, 0, 1);
const rnd = s => mix32(s >>> 0) / 4294967296;

// the five pit-stop roles. wSpeed = contribution to stop speed; wRisk = contribution to error risk.
export const PIT_ROLES = [
  { key: "frontjack", label: "Передний домкрат", wSpeed: 0.18, wRisk: 0.26 },
  { key: "rearjack",  label: "Задний домкрат",   wSpeed: 0.18, wRisk: 0.20 },
  { key: "gunner",    label: "Гайковёрт",        wSpeed: 0.34, wRisk: 0.30 },
  { key: "changer",   label: "Колёсный",         wSpeed: 0.22, wRisk: 0.14 },
  { key: "stopman",   label: "Стоп-мен",         wSpeed: 0.08, wRisk: 0.10 },
];
export const ROLE_LABEL = Object.fromEntries(PIT_ROLES.map(r => [r.key, r.label]));

const CREW_NAMES = ["Дитрих", "Морелли", "Сэндс", "Кубица-ст.", "Рами", "Бошан", "Танака", "Олссон",
  "Феррейра", "Гржелак", "Ван дер Берг", "Кэрролл", "Нгуен", "Сократис", "Мбаппе-мл.", "Холт",
  "Ибаньес", "Краузе", "Лефевр", "Сато", "Принс", "Дюбуа", "Эспозито", "Уокер"];

export const PRACTICE_FEE = 240;   // $k for a between-races pit-practice session
export const RECRUIT_FEE = 380;    // $k to bring in a market member
const RACE_FATIGUE = 0.05;         // fatigue added per race weekend
const TRAIN_FATIGUE = 0.04;        // extra fatigue when the crew is in a training programme
const TRAIN_GAIN = 0.012;          // per-race skill gain (diminishing) when training
const PRACTICE_GAIN = 0.018;       // per-session skill gain (diminishing)
const INJURY_GATE = 0.78;          // fatigue above this risks an injury at season roll
const BACKUP_PENALTY = 0.18;       // a stand-in is this much weaker

function mkMember(name, skill) { return { name, skill: clamp01(skill), fatigue: 0, injuredFor: 0 }; }

// build a crew sized to a facility/team strength (0..1-ish). Deterministic from seed.
export function initPitCrew(strength, seed) {
  const s = (seed >>> 0) || 1;
  const base = clamp01(0.10 + 0.85 * (strength ?? 0.6));   // strength→skill: widened (was 0.55+0.30·s) so crew quality meaningfully moves botch rates
  const members = {};
  PIT_ROLES.forEach((r, i) => {
    const jitter = (rnd(s + i * 7919) - 0.5) * 0.10;
    members[r.key] = mkMember(CREW_NAMES[(s + i * 5) % CREW_NAMES.length], base + jitter);
  });
  return { members, cohesion: 0.5, training: false };
}

// effective skill of a member right now (fatigue saps it; an injured member is replaced by a backup).
export function effSkill(m) {
  if (!m) return 0.5;
  if (m.injuredFor > 0) return clamp01((m.skill - BACKUP_PENALTY) * (1 - 0.25 * (m.fatigue || 0)));
  return clamp01(m.skill * (1 - 0.25 * (m.fatigue || 0)));
}

// compose the crew into what the sim reads: pitMult (lower = faster) + botch/disaster chance.
export function composePitCrew(crew) {
  if (!crew || !crew.members) return { pitMult: 1.0, botchChance: 0.06, disasterChance: 0.006, speed: 0.6, risk: 0.4, fatigueAvg: 0 };
  let speed = 0, risk = 0, fatSum = 0;
  for (const r of PIT_ROLES) {
    const m = crew.members[r.key], es = effSkill(m);
    speed += r.wSpeed * es;
    risk += r.wRisk * (1 - es);
    fatSum += (m && m.fatigue) || 0;
  }
  const coh = clamp01(crew.cohesion ?? 0.5), fatigueAvg = fatSum / PIT_ROLES.length;
  risk = clamp01(risk + 0.30 * fatigueAvg - 0.20 * coh);
  const pitMult = clamp(1.18 - 0.42 * speed - 0.10 * coh, 0.62, 1.30);
  const botchChance = clamp(0.04 + 0.20 * risk, 0.01, 0.35);
  return { pitMult, botchChance, disasterChance: botchChance * 0.12, speed, risk, fatigueAvg };
}

// one race weekend's wear + optional training. Mutates crew. (called from applyResult)
export function tickRacePitCrew(crew) {
  if (!crew || !crew.members) return;
  for (const r of PIT_ROLES) {
    const m = crew.members[r.key]; if (!m) continue;
    m.fatigue = clamp01((m.fatigue || 0) + RACE_FATIGUE + (crew.training ? TRAIN_FATIGUE : 0));
    if (crew.training) m.skill = clamp01(m.skill + TRAIN_GAIN * (1 - m.skill));   // diminishing returns
  }
}

// rest between races / over winter: a fraction `rest` (0..1) of fatigue recovers.
export function restPitCrew(crew, rest) {
  if (!crew || !crew.members) return;
  const k = clamp01(rest);
  for (const r of PIT_ROLES) { const m = crew.members[r.key]; if (m) m.fatigue = clamp01((m.fatigue || 0) * (1 - k)); }
}

// a between-races pit-practice session: skill + cohesion up, but it tires the crew. (cost booked by career)
export function practicePitStops(crew) {
  if (!crew || !crew.members) return false;
  for (const r of PIT_ROLES) { const m = crew.members[r.key]; if (!m) continue;
    m.skill = clamp01(m.skill + PRACTICE_GAIN * (1 - m.skill));
    m.fatigue = clamp01((m.fatigue || 0) + 0.12);
  }
  crew.cohesion = clamp01((crew.cohesion ?? 0.5) + 0.05);
  return true;
}

// toggle the season-long training programme (small per-race skill gains for a running fatigue cost).
export function toggleTraining(crew) { if (crew) crew.training = !crew.training; return !!(crew && crew.training); }

// recruit a market member into a role — fresh chemistry, so cohesion drops.
export function recruitMember(crew, roleKey, cand) {
  if (!crew || !crew.members || !PIT_ROLES.some(r => r.key === roleKey) || !cand) return false;
  crew.members[roleKey] = mkMember(cand.name, cand.skill);
  crew.cohesion = clamp01((crew.cohesion ?? 0.5) * 0.6);   // new member resets some of the chemistry
  return true;
}

// season-roll housekeeping: deep winter rest, chemistry grows for a settled crew, injuries resolve and
// a heavily-fatigued member may pick up a knock (out for 1–2 races into the new season). Deterministic.
export function tickOffseasonPitCrew(crew, seed) {
  if (!crew || !crew.members) return [];
  const s = (seed >>> 0) || 1, news = [];
  crew.cohesion = clamp01((crew.cohesion ?? 0.5) + 0.06);   // a year together builds chemistry
  PIT_ROLES.forEach((r, i) => {   // assess injuries on END-OF-SEASON exhaustion, BEFORE the winter rest
    const m = crew.members[r.key]; if (!m) return;
    if (m.injuredFor > 0) { m.injuredFor = Math.max(0, m.injuredFor - 1); return; }
    if ((m.fatigue || 0) > INJURY_GATE && rnd(s + i * 911) < 0.30) {
      m.injuredFor = 1 + (mix32((s + i * 53) >>> 0) % 2);
      news.push(`🩹 ${m.name} (${r.label}) травмирован на ${m.injuredFor} гонк. — выходит дублёр.`);
    }
  });
  restPitCrew(crew, 0.7);                                   // then winter recovers most fatigue
  return news;
}
export function tickInjuriesPerRace(crew) {   // count an injured member's race down each weekend
  if (!crew || !crew.members) return;
  for (const r of PIT_ROLES) { const m = crew.members[r.key]; if (m && m.injuredFor > 0) m.injuredFor -= 1; }
}

// a small recruitable market: candidates per open consideration, skill spread around the team level.
export function pitCrewMarket(seed, strength, n = 4) {
  const s = (seed >>> 0) || 1, base = clamp01(0.55 + 0.30 * (strength ?? 0.6)), out = [];
  for (let i = 0; i < n; i++) {
    const sk = clamp01(base + (rnd(s + i * 2654435761) - 0.4) * 0.30);
    out.push({ id: "pc" + s + "_" + i, name: CREW_NAMES[(s * 3 + i * 7) % CREW_NAMES.length], skill: sk,
      role: PIT_ROLES[(s + i) % PIT_ROLES.length].key });
  }
  return out;
}
