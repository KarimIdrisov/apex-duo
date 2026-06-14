# M8 — Board, Narrative & Polish Implementation Plan (capstone)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Give the career a pulse and stakes. Board **confidence** moves with results (and can get you sacked); a paddock **news/inbox feed** narrates the season; a per-season **regulation reset** keeps development a continuous arc; the season-end screen shows **confidence + champions**. The capstone that ties M1–M7 together.

**Architecture:** A pure `news.js` (capped inbox + board reaction/confidence text & math). `career.js` v7 adds `board.confidence` + `career.news`, updates them in `applyResult`, applies a regulation reset at `newSeason`, and enriches `boardOutcome`. `season.js` shows a news panel + confidence + champions. **No `main.js` change** — news/confidence ride the existing career broadcast. Sim byte-unchanged.

**Tech Stack:** Vanilla JS ES modules, Node `node --test`, deterministic.

**Spec:** `docs/superpowers/specs/2026-06-15-apexweb-manager-career-design.md` (Phase M8). Builds on M1–M7.

---

## File Structure

```
ApexWeb/src/news.js            NEW — pure: NEWS_CAP, pushNews, boardReaction, confidenceDelta
ApexWeb/src/career.js          MODIFY — v7 (board.confidence + news), applyResult updates them, newSeason regulation reset, boardOutcome enriched, migrate
ApexWeb/src/ui/season.js       MODIFY — news panel + confidence readout + season-end champions/sacked
ApexWeb/tests/news.test.js     NEW
ApexWeb/tests/career.test.js   MODIFY — confidence/news + regulation reset + boardOutcome
ApexWeb/tools/career_balance.mjs   MODIFY — board confidence/news + regulation-reset checks
```

Explicit pathspecs; re-read season.js immediately before editing.

---

## Task 1: news.js — board & inbox (pure)

**Files:** Create `ApexWeb/src/news.js`; Test `ApexWeb/tests/news.test.js`.

- [ ] **Step 1: Failing test** — `ApexWeb/tests/news.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { NEWS_CAP, pushNews, boardReaction, confidenceDelta } from "../src/news.js";

test("pushNews prepends newest-first and caps the inbox", () => {
  const c = {};
  for (let i = 0; i < NEWS_CAP + 5; i++) pushNews(c, "m" + i);
  assert.equal(c.news.length, NEWS_CAP);
  assert.equal(c.news[0], "m" + (NEWS_CAP + 4));      // newest first
});

test("boardReaction reads pleased above target, unhappy below; podium is glowing", () => {
  assert.match(boardReaction(2, 6, "GP"), /восторге|подиум/i);
  assert.match(boardReaction(5, 6, "GP"), /доволен/i);
  assert.match(boardReaction(12, 6, "GP"), /недоволен/i);
});

test("confidenceDelta is positive when beating target, negative when missing badly", () => {
  assert.ok(confidenceDelta(1, 6) > 0);
  assert.ok(confidenceDelta(6, 6) > 0);
  assert.ok(confidenceDelta(12, 6) < 0);
  assert.ok(confidenceDelta(20, 6) <= confidenceDelta(8, 6));
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test ApexWeb/tests/news.test.js` → FAIL (no module).

- [ ] **Step 3: Implement** — `ApexWeb/src/news.js`:

```js
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
```

- [ ] **Step 4: Run to verify it passes** — `node --test ApexWeb/tests/news.test.js` → all pass.

- [ ] **Step 5: Commit** — `git add ApexWeb/src/news.js ApexWeb/tests/news.test.js` → `feat(apexweb): board & news model — inbox + reaction + confidence (M8)`.

---

## Task 2: career.js — v7 board confidence, news, regulation reset

**Files:** Modify `ApexWeb/src/career.js`; Test `ApexWeb/tests/career.test.js`.

- [ ] **Step 1: Add failing tests** — append to `ApexWeb/tests/career.test.js`:

```js
test("newCareer at v7 has board confidence + an empty news inbox", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  assert.ok(c.v >= 7);
  assert.equal(c.board.confidence, 0.5);
  assert.deepEqual(c.news, []);
});

test("applyResult moves confidence and posts a board news line", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });            // target P1, sweeping front
  const order = [...TEAMS[0].drivers.map(d => ({ abbrev: d.abbrev, team: "McLaren" })),
    ...TEAMS.flatMap((t, i) => i === 0 ? [] : t.drivers.map(d => ({ abbrev: d.abbrev, team: t.name })))];
  applyResult(c, order);
  assert.ok(c.board.confidence > 0.5, "a P1 lifts confidence");
  assert.ok(c.news.length >= 1 && /Совет/.test(c.news[0]));
});

test("newSeason applies a regulation reset that reduces car development", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  c.carDev["McLaren"] = { power: 0.10, aero: 0.08, tyre: 0, fuel: 0, rel: 0 };
  const c2 = newSeason(c);
  assert.ok(c2.carDev["McLaren"].power < 0.10, "regs reset trims development");
  assert.ok(c2.news.some(n => /регламент/i.test(n)), "a regs-change news line is posted");
});

test("boardOutcome reports confidence + a sacked flag when target missed and confidence low", () => {
  const c = newCareer({ teamIdx: 0, seed: 1 });
  c.board.confidence = 0.1;                                 // simulate a bad run
  const bo = boardOutcome(c);                               // 0 points -> last -> target P1 missed
  assert.equal(bo.met, false);
  assert.equal(bo.sacked, true);
  assert.ok(bo.confidence <= 0.2);
});

test("migrate upgrades a v6 save to v7 (adds confidence + news)", () => {
  const v6 = { v: 6, teamIdx: 1, seed: 3, season: 1, round: 0, money: 0, driverPts: {}, teamPts: {}, board: { targetPos: 2 }, sponsors: [], costCap: false, pendingOffers: [], carDev: {}, project: null, devSpentThisSeason: 0, drivers: {}, staff: {}, academy: [], lastResult: null, history: [], done: false };
  const up = migrate(v6);
  assert.equal(up.v, CAREER_V);
  assert.equal(up.board.confidence, 0.5);
  assert.deepEqual(up.news, []);
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test ApexWeb/tests/career.test.js` → FAIL.

- [ ] **Step 3: Implement** — edit `ApexWeb/src/career.js`:

Add the import after the academy import:
```js
import { pushNews, boardReaction, confidenceDelta } from "./news.js";
```
Bump version + add the reset const — change `export const CAREER_V = 6;` to:
```js
export const CAREER_V = 7;            // career save schema version
export const REG_RESET = 0.5;         // each season's regulation change trims everyone's car development
```
In `newCareer`, give the board confidence + add a news inbox. Change:
```js
    board: { targetPos: Math.min(TEAMS.length, teamIdx + 1) },  // meet your tier (P{teamIdx+1})
```
to:
```js
    board: { targetPos: Math.min(TEAMS.length, teamIdx + 1), confidence: 0.5 },  // meet your tier (P{teamIdx+1})
```
and add a `news: [],` field (next to `lastResult: null`):
```js
    academy: [],
    news: [],
    lastResult: null, history: [], done: false,
```
In `applyResult`, just before `return summary;`, update confidence + post news:
```js
  career.board.confidence = Math.max(0, Math.min(1, (career.board.confidence ?? 0.5) + confidenceDelta(bestPos, career.board.targetPos)));
  pushNews(career, boardReaction(bestPos, career.board.targetPos, summary.gp));
```
In `newSeason`, apply the regulation reset + a news line. After the `developAcademy(fresh);` line add:
```js
  for (const tn in fresh.carDev) for (const k in fresh.carDev[tn]) fresh.carDev[tn][k] *= REG_RESET;   // regs change: redevelop
  fresh.board.confidence = career.board.confidence ?? 0.5;     // confidence carries between seasons
  pushNews(fresh, `Сезон ${fresh.season}: смена регламента — разработка частично обнулена.`);
```
Replace `boardOutcome` with the enriched version:
```js
export function boardOutcome(career) {
  const standings = constructorStandings(career);
  const me = standings.find(s => s.isPlayer);
  const finalPos = me ? me.pos : TEAMS.length;
  const target = career.board.targetPos;
  const met = me ? finalPos <= target : false;
  const confidence = career.board.confidence ?? 0.5;
  return { finalPos, target, met, confidence, sacked: !met && confidence < 0.25 };
}
```
Extend `migrate` — add a v<7 block before `return career;`:
```js
  if (career.v < 7) {
    if (career.board) career.board.confidence = career.board.confidence ?? 0.5;
    career.news = career.news || [];
    career.v = 7;
  }
```

- [ ] **Step 4: Run to verify it passes** — `node --test ApexWeb/tests/career.test.js` → all pass (earlier cases unaffected — confidence/news are additive; boardOutcome still returns met/finalPos/target).

- [ ] **Step 5: Commit** — `git add ApexWeb/src/career.js ApexWeb/tests/career.test.js` → `feat(apexweb): career v7 — board confidence, news, regulation reset (M8)`.

---

## Task 3: season.js — news panel + confidence + champions

**Files:** Modify `ApexWeb/src/ui/season.js` (READ first).

- [ ] **Step 1: Implement.** Add the import:
```js
import { driverStandings as _ds } from "../career.js";
```
(only if `driverStandings` isn't already imported — it IS imported at the top; skip this and reuse it.)

Add a news panel + a confidence readout. After the header panel (the `<div class="panel"><h2>Сезон ...` block in `root.innerHTML`), the layout currently starts with the finances/sponsors row. Insert a news panel right after the header. Find in `root.innerHTML`:
```js
    <div class="panel"><h2>Сезон ${c.season} · ${me ? me.team : ""} (P${me ? me.pos : "-"})</h2>
      ${lr ? `<p class="label">${lr.gp}: ${podium}</p>` : ""}</div>
```
Replace with (add confidence to the header + a news panel after it):
```js
    <div class="panel"><h2>Сезон ${c.season} · ${me ? me.team : ""} (P${me ? me.pos : "-"})</h2>
      <p class="label">Доверие совета: ${Math.round((c.board && c.board.confidence != null ? c.board.confidence : 0.5) * 100)}% · цель P${c.board ? c.board.targetPos : "-"}</p>
      ${lr ? `<p class="label">${lr.gp}: ${podium}</p>` : ""}</div>
    ${(c.news && c.news.length) ? `<div class="panel"><p class="label">📰 Новости</p>${c.news.slice(0, 8).map(n => `<p class="label" style="margin:2px 0">• ${n}</p>`).join("")}</div>` : ""}
```

Enrich the season-end footer. Find the `if (c.done) {` footer block:
```js
    footer = `<div class="panel"><h3>Сезон ${c.season} завершён</h3>
      <p class="label">Цель совета: не ниже P${bo.target} в Кубке конструкторов.</p>
      <p style="font-size:18px;font-weight:700;color:${bo.met ? "var(--good)" : "var(--bad)"}">${bo.met ? "✅ Цель выполнена" : "❌ Цель не выполнена"} — итог P${bo.finalPos}</p>
      <button class="primary" id="newseason">Новый сезон ▶</button></div>`;
```
Replace with (champions + confidence + sacked):
```js
    const champD = drv[0], champC = cons[0];
    footer = `<div class="panel"><h3>Сезон ${c.season} завершён</h3>
      <p class="label">Цель: не ниже P${bo.target} · доверие совета ${Math.round(bo.confidence * 100)}%</p>
      <p style="font-size:18px;font-weight:700;color:${bo.met ? "var(--good)" : "var(--bad)"}">${bo.met ? "✅ Цель выполнена" : (bo.sacked ? "❌ Совет уволил вас" : "❌ Цель не выполнена")} — итог P${bo.finalPos}</p>
      <p class="label">🏆 Чемпион: ${champD ? champD.abbrev : "-"} · Кубок конструкторов: ${champC ? champC.team : "-"}</p>
      <button class="primary" id="newseason">${bo.sacked ? "Начать заново ▶" : "Новый сезон ▶"}</button></div>`;
```

- [ ] **Step 2: Verify** — `node --check ApexWeb/src/ui/season.js` → OK.

- [ ] **Step 3: Commit** — `git add ApexWeb/src/ui/season.js` → `feat(apexweb): paddock news feed + confidence + season-end champions (M8)`.

---

## Task 4: career_balance.mjs — board/news/regulation corridor

**Files:** Modify `ApexWeb/tools/career_balance.mjs`.

- [ ] **Step 1: Implement.** After the existing driver-development block (which computes `next = newSeason(career)`), add board/news/regulation checks. Insert before `console.log("CAREER CORRIDOR OK");`:
```js
console.log(`board: confidence ${Math.round((career.board.confidence ?? 0.5) * 100)}%, news ${(career.news || []).length} items; latest "${(career.news || [])[0] || "-"}"`);
if (!(career.news && career.news.length > 0)) { console.error("no board/paddock news generated over the season"); process.exit(1); }
const regBefore = (career.carDev["McLaren"] && career.carDev["McLaren"].power) || 0;
const regAfter = (next.carDev["McLaren"] && next.carDev["McLaren"].power) || 0;
console.log(`regulation reset: McLaren carDev.power ${regBefore.toFixed(3)} -> ${regAfter.toFixed(3)} (new season)`);
if (!(regAfter <= regBefore)) { console.error("regulation reset did not trim development"); process.exit(1); }
```

- [ ] **Step 2: Run it** — `node ApexWeb/tools/career_balance.mjs` → season completes; the `board:` line shows confidence + a news count > 0; the `regulation reset:` line shows McLaren's carDev power trimmed for the new season; "CAREER CORRIDOR OK".

- [ ] **Step 3: Commit** — `git add ApexWeb/tools/career_balance.mjs` → `test(apexweb): board confidence + news + regulation-reset corridor (M8)`.

---

## Final verification

- [ ] `node --test ApexWeb/tests/*.test.js` → all green.
- [ ] `node ApexWeb/tools/career_balance.mjs` → CAREER CORRIDOR OK (+ board/regulation lines).
- [ ] Preview: career → paddock shows **📰 Новости** + **Доверие совета N%**; after races the news populates and confidence shifts; season-end shows champions + (if applicable) a sacked verdict. (Owner F5 for the multi-season feel: regs reset development each year; confidence is the keep-your-job stakes.)

## Self-review
- **Spec coverage:** board expectations + confidence ✓ (confidence math + sacked verdict), inbox/news ✓ (capped feed + board reactions), season framing ✓ (champions + confidence at season end), multi-season regulation arcs ✓ (REG_RESET trims carDev each season — closes the M3 deferral). Mid-season sack check + injury stand-in = future polish (noted).
- **Determinism/balance:** news/confidence are deterministic from results; regulation reset is a fixed multiplier; no sim change. `main.js` untouched — news/confidence flow through the existing career broadcast.
- **Back-compat:** v7 migrate adds confidence + news to older saves; earlier career tests unaffected (additive).
- **WIP isolation:** explicit pathspecs; re-read season.js before editing.
```
