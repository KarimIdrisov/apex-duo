// ApexWeb/src/news.js — pure board & paddock news: a capped inbox plus the board's reaction text
// and confidence math. No UI, no I/O.
export const NEWS_CAP = 14;

// prepend a news line (newest first), capped.
export function pushNews(career, text) {
  career.news = career.news || [];
  career.news.unshift(text);
  if (career.news.length > NEWS_CAP) career.news.length = NEWS_CAP;
}

// the board's reaction to a race result vs the target finishing position.
export function boardReaction(bestPos, target, gp) {
  if (bestPos <= 3) return `Совет в восторге: ${gp} — подиум (P${bestPos}).`;
  if (bestPos <= target) return `Совет доволен: ${gp} — P${bestPos} (цель P${target}).`;
  return `Совет недоволен: ${gp} — лишь P${bestPos} (ждали P${target}).`;
}

// confidence delta from a race result vs target (beat -> up, miss -> down).
export function confidenceDelta(bestPos, target) {
  if (bestPos <= Math.max(1, target - 2)) return 0.05;
  if (bestPos <= target) return 0.02;
  if (bestPos <= target + 3) return -0.02;
  return -0.05;
}
