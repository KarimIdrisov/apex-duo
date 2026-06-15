# D6 — Staff & Facilities Depth (named staff market + specialties)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** Today staff are three anonymous scalar ratings (designer/strategist/pitCrew) you nudge up in +0.06 steps. D6 turns them into **named specialists you hire from a market** (parallel to the D4 driver market): each has a rating, a **specialty** (a small targeted edge), a hire fee and a modest salary; the market refreshes each season. Hiring jumps the role to the specialist's rating (vs the slow incremental upgrade), so there's a real buy-vs-grind choice. Facilities are unchanged. **Expands the dataset** (a roster of fictional engineers/strategists/pit chiefs) and **deepens** the team layer.

**Architecture / invariant:** The sim reads `personnel` (pitMult/strategy) + `devMult` + `upkeep`, all composed from `career.staff` scalars. D6 keeps those scalars as the sim-facing source of truth — a hire **sets** `staff[role]` to the specialist's rating (+ a specialty term), so `composePersonnel`/`devMult` are essentially unchanged and the **grid stays balance-neutral until the player acts**. Recurring staff salary is added to the ledger only if the corridor stays solvent (Task 5 tunes it; default-hired staff are cheap so the baseline economy barely moves). Pure, deterministic (seeded market, no Math.random/Date). The incremental `upgradeStaff` lever stays as a cheaper alternative.

---

## Task 1: staff.js — staff market, specialties, salaries

**Files:** Modify `ApexWeb/src/staff.js`; Test `ApexWeb/tests/staff.test.js` (READ first).

- [ ] **Step 1 (tests):** append to `staff.test.js` (mirror existing import style):
```js
import { STAFF_MARKET_POOL, staffMarket, hireStaff, staffSalaries, SPECIALTIES, initStaff, composePersonnel } from "../src/staff.js";

test("staffMarket lists hireable specialists for each role, deterministic", () => {
  const m1 = staffMarket(1), m2 = staffMarket(1);
  assert.deepEqual(m1, m2);
  for (const role of ["designer", "strategist", "pitCrew"]) assert.ok(m1.some(p => p.role === role));
  assert.ok(m1.every(p => p.rating > 0 && p.rating <= 0.99 && p.salary > 0 && SPECIALTIES[p.specialty]));
});

test("hireStaff sets the role to the specialist's rating, pays the fee, records the person", () => {
  const c = { money: 1e6, staff: initStaff(0.6, 1), seed: 1 };
  const person = staffMarket(1).find(p => p.role === "designer" && p.rating > c.staff.designer);
  const before = c.money;
  assert.equal(hireStaff(c, person), true);
  assert.equal(c.staff.designer, person.rating);
  assert.equal(c.staff.people.designer.name, person.name);
  assert.ok(c.money < before);
  assert.equal(hireStaff({ money: 1, staff: initStaff(0.6, 1) }, person), false);   // broke
});

test("staffSalaries sums the hired people's wages; initStaff seeds cheap default staff", () => {
  const c = { staff: initStaff(0.75, 1) };
  assert.ok(staffSalaries(c.staff) >= 0 && staffSalaries(c.staff) < 300);   // baseline stays modest
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** edit `staff.js`:
  - `export const SPECIALTIES = { aero: {label:"Аэродинамик", role:"designer", bonus:0.02}, mechanical:{label:"Механик", role:"designer", bonus:0.02}, tactician:{label:"Тактик", role:"strategist", bonus:0.02}, pitace:{label:"Ас пит-стопа", role:"pitCrew", bonus:0.02} };` (specialty `bonus` is a tiny extra added to the scalar on hire — see below).
  - A fictional `STAFF_MARKET_POOL` (≥9 named specialists spread across the 3 roles, varied rating 0.7..0.95 + specialty). Names fictional (no real people).
  - `salaryForStaff(rating)` → `Math.round(40 + Math.pow(max(0,rating-0.6),1.6)*900)` (cheap; a star ~150).
  - `staffMarket(seed)` → deterministic subset/ordering of the pool (e.g. seeded shuffle, top N), each `{...person, salary: salaryForStaff(rating)}`.
  - `hireStaff(career, person)`: validate role/person; fee = `salaryForStaff(rating)*8` (≈8 races); if `money < fee` return false; pay; `career.staff[role] = clamp01(person.rating + (SPECIALTIES[person.specialty]?.bonus||0))`; `career.staff.people[role] = { name, specialty, rating, salary }`. Return true.
  - `staffSalaries(staff)` → sum of `staff.people[role].salary` over roles (0 if none).
  - `initStaff`: add `people: { designer:{name:"—",specialty:null,rating:base,salary:salaryForStaff(base)}, strategist:{...}, pitCrew:{...} }` so baseline salaries exist and migrate has a shape to match.

- [ ] **Step 4:** Run staff tests → pass. **Step 5:** Commit `feat(apexweb): named staff market + specialties + salaries (D6)`.

---

## Task 2: career.js — staff salaries in the ledger + migrate v10

**Files:** Modify `ApexWeb/src/career.js`; Test `ApexWeb/tests/career.test.js`.

- [ ] **Step 1:** import `staffSalaries` from staff.js. In `applyResult`'s ledger, subtract `staffSalaries(career.staff)` (alongside `upkeep`/driver salaries). **Keep the magnitude small** — Task 5 corridor must stay solvent; if it doesn't, trim `salaryForStaff` and/or reduce facility `upkeep` rate to compensate.
- [ ] **Step 2:** `CAREER_V = 10`; migrate `v < 10`: if `career.staff && !career.staff.people`, backfill `people` for each role from the current scalar (`{name:"—",specialty:null,rating:staff[role],salary:salaryForStaff(staff[role])}`).
- [ ] **Step 3:** test: a v9 staff without `people` migrates to v10 with `people` per role; `node --test career.test.js` green. **Step 4:** Commit `feat(apexweb): staff salaries in ledger + migrate v10 (D6)`.

---

## Task 3: main.js — career_hire command

**Files:** Modify `ApexWeb/src/main.js` (READ first).

- [ ] **Step 1:** import `hireStaff` from staff.js. Add a `career_hire` case: find the market person by id (`staffMarket(seed)` keyed by round/season so host & client agree), `hireStaff(ctx.career, person)`, `pushNews` the outcome, `saveCareer/publishCareer/rerender`. (Reuse the existing `career_upgrade` pattern.)
- [ ] **Step 2:** `node --check` + `node --test` → green. **Step 3:** Commit `feat(apexweb): hire staff from the market in main (D6)`.

---

## Task 4: season.js — Команда tab shows hired people + a hire market

**Files:** Modify `ApexWeb/src/ui/season.js` (READ first — owner edits it).

- [ ] **Step 1:** In the staff panel, show each role's hired person (name + specialty label) next to the rating. Add a compact **staff-market** sub-panel listing `staffMarket(season)` specialists with rating/specialty/fee + a Нанять button (`data-id`) dispatching `career_hire`. Keep the incremental `+` upgrade button (the cheap grind path). Import `staffMarket, SPECIALTIES, salaryForStaff` from `../staff.js`.
- [ ] **Step 2:** wire the new button class in the click handlers (mirror `button.stf`). `node --check` → OK. **Step 3:** Commit `feat(apexweb): paddock staff market UI (D6)`.

---

## Task 5: corridor — staff market solvency + hiring raises rating

**Files:** Modify `ApexWeb/tools/career_balance.mjs`. Hire one affordable better specialist early; assert the role rating rose, the season stays solvent (money > 0 with staff salaries now in the ledger), grid integrity holds. Run → CAREER CORRIDOR OK (tune `salaryForStaff`/`upkeep` if it goes red). Commit `test(apexweb): staff-market corridor (D6)`.

---

## Final verification
- [ ] `node --test ApexWeb/tests/*.test.js` → green.
- [ ] `node ApexWeb/tools/career_balance.mjs` → OK (solvent with staff salaries).
- [ ] Preview: Команда tab shows hired names + a hire market; hiring posts news + raises the rating; no console errors.
- [ ] One-off (non-career) race byte-identical (no career.staff → genPersonnel path untouched).

## Self-review
- Named market ✓ specialties ✓ hire-fee + small salary ✓ buy-vs-grind (incremental upgrade kept) ✓ sim-facing scalars unchanged ✓ migrate v10 ✓ corridor solvency gate ✓ deterministic ✓. Re-read main.js/season.js before editing (owner active).
