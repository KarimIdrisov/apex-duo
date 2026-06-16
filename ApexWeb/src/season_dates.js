// ApexWeb/src/season_dates.js — real-calendar time model (MM-like). Each round has a weekend date;
// the GAP (days) between consecutive rounds is the development/preparation window, so when you start
// an upgrade relative to the calendar matters. Dates follow the real 2026 F1 rhythm (March→December:
// weekly cadence, back-to-backs, a summer break, an end-of-year triple-header), mapped onto our
// 23-round order. Pure data + helpers, deterministic, no RNG. Year scales with the season number
// (season 1 = 2026). Used by career.js (dev days, off-season) and the paddock UI (dates, calendar tab).

// race-Sunday [month, day] per round, in our calendar order. 23 entries — same length as CALENDAR.
export const ROUND_MD = [
  [3, 8], [3, 15], [3, 29], [4, 12], [4, 19], [5, 3], [5, 24], [6, 7], [6, 14], [6, 28],
  [7, 5], [7, 19], [7, 26], [8, 23], [9, 6], [9, 27], [10, 11], [10, 25], [11, 1], [11, 8],
  [11, 22], [11, 29], [12, 6],
];
// sprint weekends (0-based round index) — cosmetic flavor for the calendar (sim doesn't run sprints).
export const SPRINTS = new Set([4, 10, 11, 15, 17, 19]);

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MON_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const DAY = 86400000;

export function yearFor(season) { return 2025 + Math.max(1, season || 1); }   // season 1 → 2026
export function roundDate(season, i) { const md = ROUND_MD[i]; return md ? new Date(yearFor(season), md[0] - 1, md[1]) : null; }

// "8 марта 2026" / "8 мар" — display strings.
export function fmtDate(season, i) { const md = ROUND_MD[i]; return md ? `${md[1]} ${MONTHS[md[0] - 1]} ${yearFor(season)}` : "—"; }
export function fmtDateShort(i) { const md = ROUND_MD[i]; return md ? `${md[1]} ${MON_SHORT[md[0] - 1]}` : "—"; }

// days from round i to round i+1 within the same season (the dev/prep window after round i).
export function gapDays(season, i) {
  const a = roundDate(season, i), b = roundDate(season, i + 1);
  return (a && b) ? Math.round((b - a) / DAY) : null;
}
// the winter window: last round of `season` → round 1 of the next season.
export function offseasonDays(season) {
  const a = roundDate(season, ROUND_MD.length - 1), b = roundDate(season + 1, 0);
  return (a && b) ? Math.round((b - a) / DAY) : 90;
}
// classify a gap for display + (later) staff fatigue.
export function gapLabel(d) {
  if (d == null) return "";
  if (d <= 8) return "бэк-ту-бэк";
  if (d >= 25) return "летний перерыв";
  if (d >= 19) return "длинный перерыв";
  return "обычный";
}
