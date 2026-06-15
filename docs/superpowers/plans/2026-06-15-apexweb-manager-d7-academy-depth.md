# D7 — Academy / Feeder Depth (F2 feeder championship + superlicense + reserve)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** Today academy juniors develop by an abstract `overall += (potential-overall)*0.35` each season. D7 gives them a **real F2 feeder championship**: juniors race a deterministic aggregate season against a fictional feeder field, earn **points + superlicense points** by finishing position, and develop *by results*. Promotion gains a real-world **superlicense alternate gate** (40 SL points, additive — the existing `overall ≥ 0.78` gate still works). A **reserve/test driver** designation gives a bigger R&D test bonus. **Expands the dataset** (a feeder grid + standings) and **deepens** the academy into a believable talent pipeline.

**Architecture / invariant:** Academy is meta-only — it never touches the sim; it injects a promoted junior into `career.drivers` (already does, with D5 attrs/traits). D7 adds feeder state to juniors + a feeder aggregate-sim (pure, seeded — NO Math.random/Date) run at the season boundary. Promote gate stays backward-compatible (`overall ≥ SUPERLICENSE` **OR** `slPoints ≥ SL_NEEDED`) so the M7 path + corridor keep working. Reserve is a designation that scales `academyDevBonus`.

---

## Task 1: academy.js — feeder championship + superlicense points + reserve

**Files:** Modify `ApexWeb/src/academy.js`; Test `ApexWeb/tests/academy.test.js` (READ first).

- [ ] **Step 1 (tests):** append to `academy.test.js`:
```js
import { runFeeder, SL_NEEDED, FEEDER_FILLER, reserveBonus } from "../src/academy.js";

test("runFeeder: juniors race the feeder, earn superlicense points + develop, deterministic", () => {
  const c = { money: 1e6, academy: [{ abbrev: "DOO", name: "Дуэн", age: 19, overall: 0.80, potential: 0.92, slPoints: 0 }], seed: 1 };
  const d = JSON.parse(JSON.stringify(c));
  const a = runFeeder(c, 3), b = runFeeder(d, 3);
  assert.deepEqual(a, b);                                   // deterministic
  assert.ok(c.academy[0].slPoints > 0);                    // earned SL points
  assert.ok(c.academy[0].overall > 0.80);                  // developed by racing
  assert.ok(a.standings.length >= FEEDER_FILLER.length);   // full feeder grid
  assert.ok(a.standings.some(s => s.abbrev === "DOO"));
});

test("promoteJunior: superlicense points are an alternate gate to the overall gate", () => {
  const c = { teamIdx: 0, drivers: { NOR: { teamIdx: 0, overall: 0.9 }, X: { teamIdx: 0, overall: 0.5 } },
    academy: [{ abbrev: "DOO", name: "Дуэн", age: 20, overall: 0.74, potential: 0.9, slPoints: 45 }], driverPts: {} };
  assert.equal(promoteJunior(c, "DOO", "X"), true);        // below 0.78 overall but 45 SL -> promotable
});

test("reserveBonus: the reserve junior contributes a bigger dev bonus than a bench junior", () => {
  assert.ok(reserveBonus(true) > reserveBonus(false));
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** edit `academy.js`:
  - `export const SL_NEEDED = 40;` `export const SL_TABLE = [40, 30, 25, 20, 16, 12, 8, 6, 4, 2];` (superlicense points by feeder finishing pos; champion 40 like real F2).
  - `export const FEEDER_FILLER = [ ...~10 fictional F2 regulars { name, overall } spread 0.66..0.82 ]`.
  - `signJunior`: give a scouted junior `slPoints: Math.round((j.overall-0.6)*40)` initial pedigree (so a strong junior starts partway to the gate) + `series: "F2"`.
  - `runFeeder(career, seed)`: build field = academy juniors `{abbrev, overall}` + FEEDER_FILLER; rank by `overall + mix32(seed,entry)` noise; award SL points (`SL_TABLE[pos]||0`, accumulated into `junior.slPoints`) + develop each junior `overall += (potential-overall) * (0.25 + 0.15*resultQuality)` (a podium develops faster). Return `{ standings: [{name/abbrev, pos, pts}] }`. Pure/deterministic.
  - Replace the body of `developAcademy` to call `runFeeder` (keeps the season-boundary entry point + the age++).
  - `promoteJunior` gate: `if (j.overall < SUPERLICENSE && (j.slPoints||0) < SL_NEEDED) return false;` (additive OR).
  - `reserveBonus(isReserve)` → `isReserve ? 0.06 : 0.04`; `academyDevBonus(career)` sums `reserveBonus(j.abbrev === career.reserve)` over juniors.

- [ ] **Step 4:** Run academy tests → pass (existing M7 tests stay green — overall gate still works). **Step 5:** Commit `feat(apexweb): F2 feeder championship + superlicense points + reserve (D7)`.

---

## Task 2: career.js — run the feeder each season + migrate v11

**Files:** Modify `ApexWeb/src/career.js`; Test `ApexWeb/tests/career.test.js`.

- [ ] **Step 1:** `developAcademy` is already called in `newSeason` — confirm it now runs the feeder (Task 1 rewired it). Ensure `newSeason` passes a seed (e.g. `career.season`) into `developAcademy`/`runFeeder` if the signature needs it.
- [ ] **Step 2:** `CAREER_V = 11`; migrate `v < 11`: for each `career.academy` junior missing `slPoints`, set `slPoints: 0, series: "F2"`; `career.reserve = career.reserve ?? null`.
- [ ] **Step 3:** test: a v10 academy junior without slPoints migrates to v11 with slPoints; `node --test career.test.js` green. **Step 4:** Commit `feat(apexweb): feeder at season boundary + migrate v11 (D7)`.

---

## Task 3: main.js — career_reserve command

**Files:** Modify `ApexWeb/src/main.js` (READ first).

- [ ] **Step 1:** Add a `career_reserve` case: toggle `ctx.career.reserve = (ctx.career.reserve === cmd.abbrev ? null : cmd.abbrev)`; save/publish/rerender. (No new import needed.)
- [ ] **Step 2:** `node --check` + `node --test` → green. **Step 3:** Commit `feat(apexweb): designate a reserve junior in main (D7)`.

---

## Task 4: season.js — Академия tab shows feeder standings + SL progress + reserve

**Files:** Modify `ApexWeb/src/ui/season.js` (READ first — owner edits it).

- [ ] **Step 1:** In the academy panel, per junior show a **superlicense progress** readout (`slPoints/40`) + series, and a **★ Резерв** toggle button (`data-ab`, dispatch `career_reserve`, highlighted when it's the reserve). If the last feeder standings are available (store `career.lastFeeder` from runFeeder, optional), show a compact top-5 feeder table. Import what's needed (`SL_NEEDED` from `../academy.js`).
- [ ] **Step 2:** wire `button.reserve` click → `career_reserve`. `node --check` → OK. **Step 3:** Commit `feat(apexweb): academy feeder standings + superlicense UI (D7)`.

---

## Task 5: corridor — feeder runs, juniors gain SL + develop by results

**Files:** Modify `ApexWeb/tools/career_balance.mjs`. After a `newSeason`, assert an academy junior's `slPoints > 0` and `overall` rose (developed by the feeder), and the promote path still works. Run → CAREER CORRIDOR OK. Commit `test(apexweb): feeder/superlicense corridor (D7)`.

---

## Final verification
- [ ] `node --test ApexWeb/tests/*.test.js` → green.
- [ ] `node ApexWeb/tools/career_balance.mjs` → OK.
- [ ] Preview: Академия tab shows SL progress + feeder + reserve toggle; scouting/promote still work; no console errors.
- [ ] One-off race byte-identical (academy never touches the sim).

## Self-review
- Feeder championship ✓ superlicense points (real 40 gate, additive) ✓ develop-by-results ✓ reserve/test-driver ✓ migrate v11 ✓ promote backward-compatible ✓ deterministic ✓. Re-read main.js/season.js before editing (owner active).
