# D8 — Board / Narrative Depth (multi-objective board + regulation arc)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** Today the board is one number — `targetPos` (a championship-position target) → confidence. D8 makes it a **set of season objectives** (championship + a tier-specific goal like podiums / points-in-N-races / develop-the-car), each tracked and shown with met/progress, and adds a **multi-season regulation arc** (a big reg shake-up on a cycle, telegraphed a season ahead) instead of the flat ×0.5 reset. **Deepens** the narrative layer and **expands the dataset** (objective types + reg-arc cadence).

**Architecture / invariant:** Board/narrative is meta-only — it never touches the sim. Per-race confidence stays as-is (`confidenceDelta` + `boardReaction`) so the confidence corridor holds; D8 *adds* objective counters (podiums / point-finishes) incremented in `applyResult`, objective evaluation, and a reg-arc reset multiplier. New pure module `board.js` (imports only `data.js` for TEAMS — no cycle with career.js). Deterministic. Migrate v12.

---

## Task 1: board.js — season objectives + regulation arc

**Files:** Create `ApexWeb/src/board.js`; Test `ApexWeb/tests/board.test.js` (new).

- [ ] **Step 1 (tests):** create `board.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { seasonObjectives, evaluateObjectives, regResetFor, regArcNote } from "../src/board.js";
import { TEAMS } from "../src/data.js";

test("seasonObjectives: a championship goal + a tier-specific goal", () => {
  const top = seasonObjectives(1), mid = seasonObjectives(6), back = seasonObjectives(10);
  for (const o of [top, mid, back]) { assert.ok(o.length >= 2); assert.equal(o[0].type, "championship"); }
  assert.equal(top[1].type, "podiums"); assert.equal(mid[1].type, "points"); assert.equal(back[1].type, "develop");
});

test("evaluateObjectives: reports met/progress from career state", () => {
  const career = { teamIdx: 0, teamPts: {}, parts: {}, board: { targetPos: 1, podiums: 9, pointFinishes: 20, objectives: seasonObjectives(1) } };
  for (const t of TEAMS) career.teamPts[t.name] = t.name === TEAMS[0].name ? 500 : 100;   // player leads
  const ev = evaluateObjectives(career);
  assert.equal(ev.length, career.board.objectives.length);
  assert.ok(ev[0].met);                                   // P1 meets "<= P1"
  assert.ok(ev[1].met);                                   // 9 >= 8 podiums
  assert.ok(ev.every(o => o.progress >= 0 && o.progress <= 1 && o.label));
});

test("regResetFor: a big reg shake-up on a cycle, otherwise a normal trim; always < 1", () => {
  let big = 0; for (let s = 2; s <= 10; s++) { const r = regResetFor(s); assert.ok(r > 0 && r < 1); if (r < 0.5) big++; }
  assert.ok(big >= 1 && big < 9);                         // some big years, not all
  assert.ok(typeof regArcNote(3) === "string");
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** create `board.js`:
```js
// ApexWeb/src/board.js — pure board/narrative: season objectives + the regulation arc. No UI, no cycle
// (imports only TEAMS). Confidence math stays in news.js; this adds the objective + reg-cadence layer.
import { TEAMS } from "./data.js";

// the season's objectives from the board's championship target (tier-specific second goal).
export function seasonObjectives(targetPos) {
  const objs = [{ type: "championship", label: `Финиш в чемпионате ≤ P${targetPos}`, target: targetPos }];
  if (targetPos <= 3) objs.push({ type: "podiums", label: "8 подиумов за сезон", target: 8 });
  else if (targetPos <= 7) objs.push({ type: "points", label: "Очки в 8 гонках", target: 8 });
  else objs.push({ type: "develop", label: "Развить машину (деталь +0.05)", target: 0.05 });
  return objs;
}

function playerPos(career) {
  const pts = career.teamPts || {}, mine = pts[TEAMS[career.teamIdx].name] || 0;
  return 1 + Object.keys(pts).filter(n => pts[n] > mine).length;
}
const clamp01 = v => Math.max(0, Math.min(1, v));

// evaluate each objective from the live career state -> [{ type, label, met, progress }].
export function evaluateObjectives(career) {
  const b = career.board || {};
  return (b.objectives || []).map(o => {
    let cur = 0, met = false, progress = 0;
    if (o.type === "championship") { const pos = playerPos(career); met = pos <= o.target; progress = clamp01(o.target / pos); cur = pos; }
    else if (o.type === "podiums") { cur = b.podiums || 0; met = cur >= o.target; progress = clamp01(cur / o.target); }
    else if (o.type === "points") { cur = b.pointFinishes || 0; met = cur >= o.target; progress = clamp01(cur / o.target); }
    else if (o.type === "develop") { const p = (career.parts && career.parts[TEAMS[career.teamIdx].name]) || {}; cur = Math.max(0, ...Object.values(p), 0); met = cur >= o.target; progress = clamp01(cur / o.target); }
    return { type: o.type, label: o.label, met, progress, cur };
  });
}

// regulation arc: a big shake-up every 3rd season (deeper reset), otherwise a normal trim. <1 always.
export function regResetFor(season) { return (season % 3 === 0) ? 0.35 : 0.6; }
export function regArcNote(season) {
  return (season % 3 === 0)
    ? "⚠ Большие изменения регламента: разработка сильно обнулится."
    : "Регламент стабилен: развитие частично переносится.";
}
```

- [ ] **Step 4:** Run → pass. **Step 5:** Commit `feat(apexweb): board objectives + regulation arc module (D8)`.

---

## Task 2: career.js — objectives + counters + reg arc + migrate v12

**Files:** Modify `ApexWeb/src/career.js`; Test `ApexWeb/tests/career.test.js`.

- [ ] **Step 1:** import `seasonObjectives, evaluateObjectives, regResetFor, regArcNote` from board.js.
- [ ] **Step 2:** newCareer `board`: compute `targetPos` first, then `board: { targetPos, confidence: 0.5, podiums: 0, pointFinishes: 0, objectives: seasonObjectives(targetPos) }`.
- [ ] **Step 3:** applyResult: after the confidence update, increment counters: `if (bestPos<=3) board.podiums=(board.podiums||0)+1; if (bestPos<=10) board.pointFinishes=(board.pointFinishes||0)+1;`.
- [ ] **Step 4:** newSeason: replace the flat `*= REG_RESET` with `const reg = regResetFor(fresh.season); ... *= reg;`; reset counters + regenerate objectives (`fresh.board.objectives = seasonObjectives(fresh.board.targetPos); fresh.board.podiums = 0; fresh.board.pointFinishes = 0;`); `pushNews(fresh, regArcNote(fresh.season))`.
- [ ] **Step 5:** boardOutcome: add `objectives: evaluateObjectives(career)` to the return (enriches the verdict).
- [ ] **Step 6:** `CAREER_V = 12`; migrate `v < 12`: if `career.board && !career.board.objectives` set `objectives: seasonObjectives(board.targetPos), podiums: board.podiums||0, pointFinishes: board.pointFinishes||0`.
- [ ] **Step 7:** test (career.test.js): newCareer board has objectives; after an applyResult a podium increments `board.podiums`; migrate v11→v12 adds objectives; `regResetFor` used (a new season's parts shrank). `node --test` green. **Step 8:** Commit `feat(apexweb): season objectives + reg arc in career + migrate v12 (D8)`.

---

## Task 3: season.js — board objectives + reg-arc note in the Обзор tab

**Files:** Modify `ApexWeb/src/ui/season.js` (READ first — owner edits it).

- [ ] **Step 1:** import `evaluateObjectives, regArcNote` from `../board.js`. In the overview/board area, render the objectives list (each: label + ✓/✗ + a progress %), and a one-line reg-arc note for the upcoming season. Pure render.
- [ ] **Step 2:** `node --check` → OK. **Step 3:** Commit `feat(apexweb): paddock shows board objectives + reg arc (D8)`.

---

## Task 4: corridor — objectives evaluated + reg arc applied

**Files:** Modify `ApexWeb/tools/career_balance.mjs`. After the season, assert `evaluateObjectives(career)` returns ≥2 items with the championship met for McLaren, and that the reg arc applied (parts shrank into the next season per `regResetFor`). Run → CAREER CORRIDOR OK. Commit `test(apexweb): board-objectives/reg-arc corridor (D8)`.

---

## Final verification
- [ ] `node --test ApexWeb/tests/*.test.js` → green (the FULL suite — D-pass end gate).
- [ ] `node ApexWeb/tools/career_balance.mjs` → OK.
- [ ] Preview: Обзор shows objectives with ✓/✗ + progress + reg note; no console errors.
- [ ] One-off race byte-identical (board never touches the sim).

## Self-review
- Multi-objective board ✓ (championship + tier goal) tracked via counters ✓ reg arc (telegraphed) ✓ confidence corridor unchanged ✓ no cycle (board.js imports only TEAMS) ✓ migrate v12 ✓ deterministic ✓. Re-read season.js before editing (owner active).
