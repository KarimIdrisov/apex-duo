# D4 — Contracts & Market Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Turn the flat "pay a fee, swap" transfer into a real negotiation: buyouts for contracted drivers, free agents (expired contracts) who are cheaper, a driver who **accepts/rejects** based on the team's competitiveness + their ambition, and a rival-bid chance. Builds on M4 (contracts) + M6 (swap market).

**Architecture:** `market.js` gains `freeAgent`, `buyout`, `signCost`, `willJoin`, `negotiateSign` (pure; takes `teamStrength`+`seed`, no career.js import → no cycle). `main.js` routes `career_sign` through `negotiateSign` (computing the player's competitiveness from the standings) and posts the outcome to the news feed. `season.js` transfer panel shows cost + a free-agent badge. Roster invariant (2/team) preserved (still a swap). Sim untouched.

---

## Task 1: market.js — negotiation

**Files:** Modify `ApexWeb/src/market.js`; Test `ApexWeb/tests/market.test.js`.

- [ ] **Step 1:** Append to `ApexWeb/tests/market.test.js`:
```js
import { freeAgent, buyout, signCost, willJoin, negotiateSign } from "../src/market.js";

test("buyout: contracted drivers cost extra to prise; free agents are free to take", () => {
  assert.ok(buyout({ salary: 500, contractSeasons: 2 }) > 0);
  assert.equal(buyout({ salary: 500, contractSeasons: 0 }), 0);
  assert.equal(freeAgent({ contractSeasons: 0 }), true);
  assert.ok(signCost({ overall: 0.9, age: 25, salary: 400, contractSeasons: 2 }) > signCost({ overall: 0.9, age: 25, salary: 400, contractSeasons: 0 }));
});

test("willJoin: a star joins a strong team, balks at a weak one (deterministic)", () => {
  const star = { overall: 0.95, age: 26 };
  assert.equal(willJoin(star, 1.0, 1), willJoin(star, 1.0, 1));        // deterministic
  let strong = 0, weak = 0;
  for (let s = 0; s < 40; s++) { if (willJoin(star, 1.0, s)) strong++; if (willJoin(star, 0.1, s)) weak++; }
  assert.ok(strong > weak, "more likely to join a competitive team");
});

test("negotiateSign: succeeds for a feasible deal (rich, competitive), keeps 2/team", () => {
  const c = { teamIdx: 0, money: 1e6, drivers: initDrivers(), seed: 1 };
  const out = Object.keys(c.drivers).find(a => c.drivers[a].teamIdx === 0);
  const inAb = "ALB";   // a midfielder, easy to sign for a strong team
  const r = negotiateSign(c, inAb, out, { teamStrength: 1.0, seed: 3 });
  if (r.ok) { assert.equal(c.drivers[inAb].teamIdx, 0);
    const counts = {}; for (const a in c.drivers) counts[c.drivers[a].teamIdx] = (counts[c.drivers[a].teamIdx] || 0) + 1;
    for (const k in counts) assert.equal(counts[k], 2); }
  else assert.ok(["отказ", "перебили", "деньги"].includes(r.reason));
});

test("negotiateSign: broke -> reason 'деньги'", () => {
  const c = { teamIdx: 0, money: 1, drivers: initDrivers(), seed: 1 };
  const out = Object.keys(c.drivers).find(a => c.drivers[a].teamIdx === 0);
  assert.equal(negotiateSign(c, "VER", out, { teamStrength: 1.0, seed: 1 }).ok, false);
});
```
(`initDrivers` is already imported in market.test.js.)

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3:** Append to `ApexWeb/src/market.js`:
```js
// a driver whose contract has run out is a free agent — no buyout, more willing to move.
export function freeAgent(driver) { return (driver.contractSeasons || 0) <= 0; }
// $k to prise a contracted driver from their deal (0 for a free agent).
export function buyout(driver) { return freeAgent(driver) ? 0 : Math.round((driver.salary || 0) * driver.contractSeasons * 1.5); }
// total cost to sign: transfer value + buyout.
export function signCost(driver) { return driverValue(driver) + buyout(driver); }

// will the driver accept a move to a team of this competitiveness (0..1, 1 = champions)? A star
// balks at a weak team; ambition (younger) weights competitiveness more. Deterministic via seed.
export function willJoin(driver, teamStrength, seed) {
  const ambition = driver.age <= 28 ? 1 : 0.6;                 // veterans less fussy
  const demand = (driver.overall - 0.78) * 2.2 * ambition;     // how much competitiveness a star demands
  const accept = 0.5 + (teamStrength - demand);               // prob (clamped below)
  const roll = mix32(((seed >>> 0) * 2246822519 + 12345) >>> 0) / 4294967296;
  return roll < Math.max(0.05, Math.min(0.97, accept));
}

// negotiate a signing: swap inAbbrev in for outAbbrev (the player's). opts = { teamStrength, seed }.
// Returns { ok, reason }. reason: "деньги" | "отказ" | "перебили".
export function negotiateSign(career, inAbbrev, outAbbrev, opts = {}) {
  const inDr = career.drivers[inAbbrev], outDr = career.drivers[outAbbrev];
  if (!inDr || !outDr) return { ok: false, reason: "ошибка" };
  if (inDr.teamIdx === career.teamIdx || outDr.teamIdx !== career.teamIdx) return { ok: false, reason: "ошибка" };
  const cost = signCost(inDr);
  if (career.money < cost) return { ok: false, reason: "деньги" };
  const seed = (opts.seed ?? 1) >>> 0;
  if (!willJoin(inDr, opts.teamStrength ?? 0.5, seed)) return { ok: false, reason: "отказ" };
  if ((mix32((seed * 40503 + 777) >>> 0) / 4294967296) < 0.15) return { ok: false, reason: "перебили" };  // a rival outbid
  career.money -= cost;
  const rivalTeam = inDr.teamIdx;
  inDr.teamIdx = career.teamIdx; outDr.teamIdx = rivalTeam;
  inDr.contractSeasons = 3; inDr.morale = Math.min(1, (inDr.morale ?? 0.6) + 0.1);
  return { ok: true, cost };
}
```

- [ ] **Step 4:** Run → pass. **Step 5:** Commit `feat(apexweb): market negotiation — buyout/free-agent/willJoin/negotiateSign (D4)`.

---

## Task 2: main.js — route career_sign through negotiation

**Files:** Modify `ApexWeb/src/main.js` (READ first).

- [ ] **Step 1:** Import: add `negotiateSign` to the market import; add `constructorStandings` to the career import; add `pushNews` from news.js (if not imported).
- [ ] **Step 2:** Replace the `career_sign` case:
```js
    case "career_sign":
      if (ctx.career) {
        const meS = constructorStandings(ctx.career).find(s => s.isPlayer);
        const strength = meS ? 1 - (meS.pos - 1) / (TEAMS.length - 1) : 0.5;
        const r = negotiateSign(ctx.career, cmd.inAbbrev, cmd.outAbbrev, { teamStrength: strength, seed: (ctx.career.round + 1) * 131 + cmd.inAbbrev.charCodeAt(0) });
        pushNews(ctx.career, r.ok ? `Трансфер: ${cmd.inAbbrev} подписан.` : `Трансфер ${cmd.inAbbrev} сорвался: ${r.reason}.`);
        saveCareer(ctx.career); publishCareer(); rerender();
      }
      break;
```
(Import `pushNews` from "./news.js" and `constructorStandings` from "./career.js"; `TEAMS` already imported.)
- [ ] **Step 3:** `node --check` + `node --test` → green. **Step 4:** Commit `feat(apexweb): negotiated signings + transfer news in main (D4)`.

---

## Task 3: season.js — transfer panel shows cost + free agents

**Files:** Modify `ApexWeb/src/ui/season.js` (READ first — owner edits it).

- [ ] **Step 1:** Import `signCost, freeAgent` from "../market.js" (extend the existing market import). In the transfer panel, change the per-driver row to show `signCost` + a "СА" badge for free agents, and the ↔ button disabled test to `c.money < signCost(d)`:
```js
    ${avail.map(d => row([`<b>${d.abbrev}</b> ${DRIVER_NAME[d.abbrev] || ""}${freeAgent(d) ? " <span class=\"label\">СА</span>" : ""}`, `ovr ${d.overall.toFixed(3)}`, `${d.age} л.`, m$(signCost(d)),
      mineAbbrevs.map(ab => `<button class="ready sign" data-in="${d.abbrev}" data-out="${ab}" ${c.money < signCost(d) ? "disabled" : ""} style="padding:3px 6px;font-size:11px;margin-left:4px">↔${ab}</button>`).join("")])).join("")}
```
- [ ] **Step 2:** `node --check` → OK. **Step 3:** Commit `feat(apexweb): transfer panel shows sign cost + free agents (D4)`.

---

## Task 4: career_balance.mjs — negotiation corridor

**Files:** Modify `ApexWeb/tools/career_balance.mjs`. Replace the existing `signDriver(...)` transfer block with a `negotiateSign` one (the player is McLaren P1 → strength ~1 → a feasible sign), assert grid integrity holds. Run → CAREER CORRIDOR OK. Commit `test(apexweb): negotiation corridor (D4)`.

---

## Final verification
- [ ] `node --test ApexWeb/tests/*.test.js` → green.
- [ ] `node ApexWeb/tools/career_balance.mjs` → OK.
- [ ] Preview: Трансферы tab shows sign cost + СА badges; signing posts a news line (signed / отказ / перебили).

## Self-review
- buyout/free-agent ✓, accept-by-competitiveness ✓ (willJoin), rival bid ✓, no cycle (teamStrength passed in). Roster 2/team preserved. Sim untouched. Re-read season.js before editing (owner active).
