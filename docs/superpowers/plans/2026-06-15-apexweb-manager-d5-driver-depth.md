# D5 — Driver Depth (per-attribute development + traits)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** Today a career driver is one `overall` scalar; every weekend `driverAttrs(abbrev, overall)` re-derives the 13 sim attributes (pace, quali, tyre, overtaking, defending, consistency, composure, aggression, discipline, wet, starts, race_iq, smoothness) *from* that overall, so attributes are frozen relative to it. D5 makes the **13 attributes persistent career state that develop independently** with an age curve (a veteran loses pace but keeps craft; a junior improves racecraft fastest) plus **explicit traits** that bias development and give each driver an identity. The player sees real per-attribute profiles and trait badges.

**Architecture / invariant:** The sim reads `c.attrs` (13-key vector via `A(c)`). D5 only changes what `buildField` *feeds* into `attrs` — for a career driver, the **persistent, developed** attrs; otherwise the existing `driverAttrs(...)` fallback. **`driverAttrs` itself is unchanged → one-off (non-career) races are byte-identical.** `overall` stays the calibrated readout used by salary/value/morale; from season 2 it tracks the developed attrs via `overallFromAttrs`. Pure functions live in `team.js` (near `driverAttrs`) and `drivers.js`. Determinism preserved (seeded, no Math.random/Date).

---

## Task 1: team.js — overall readout, age-curve drift, traits catalog

**Files:** Modify `ApexWeb/src/team.js`; Test `ApexWeb/tests/team.test.js`.

- [ ] **Step 1 (tests first):** append to `ApexWeb/tests/team.test.js`:
```js
import { overallFromAttrs, attrDrift, TRAITS, traitBias, ATTR_PEAK } from "../src/team.js";

test("overallFromAttrs: readout rises with the headline attrs, stays in 0..1", () => {
  const lo = {}, hi = {}; for (const k of ATTR_KEYS) { lo[k] = 0.6; hi[k] = 0.9; }
  assert.ok(overallFromAttrs(hi) > overallFromAttrs(lo));
  assert.ok(overallFromAttrs(hi) > 0 && overallFromAttrs(hi) <= 1);
  assert.ok(Math.abs(overallFromAttrs(lo) - 0.6) < 0.001);   // flat profile -> reads ~its level
});

test("attrDrift: physical attrs decline for a veteran while craft holds; bounded", () => {
  const vetPace = attrDrift("pace", 40), vetIQ = attrDrift("race_iq", 40);
  assert.ok(vetPace < 0 && vetIQ < 0 && vetPace < vetIQ);     // pace falls faster than craft
  assert.ok(attrDrift("pace", 19) > 0);                       // a teenager still improves
  for (const k of ATTR_KEYS) for (const age of [18, 25, 33, 44])
    assert.ok(Math.abs(attrDrift(k, age)) <= 0.025);          // bounded per season
});

test("traitBias: a trait nudges its own attrs and nothing else", () => {
  assert.ok(traitBias(["wet_master"], "wet") > 0);
  assert.equal(traitBias(["wet_master"], "starts"), 0);
  assert.equal(traitBias([], "wet"), 0);
  assert.ok(TRAITS.wet_master && TRAITS.wet_master.label);    // every trait has a RU label
});
```

- [ ] **Step 2:** Run `node --test ApexWeb/tests/team.test.js` → FAIL.

- [ ] **Step 3:** append to `ApexWeb/src/team.js`:
```js
// --- D5: per-attribute development + traits ---

// `overall` as a weighted readout of the headline attributes (pace-led, craft-weighted).
const OVERALL_W = { pace: 0.30, quali: 0.12, race_iq: 0.14, tyre: 0.12, overtaking: 0.10, consistency: 0.10, defending: 0.07, wet: 0.05 };
export function overallFromAttrs(a) {
  let s = 0, w = 0; for (const k in OVERALL_W) { s += OVERALL_W[k] * (a[k] ?? 0.7); w += OVERALL_W[k]; }
  return s / w;
}

// per-attribute peak age: physical (pace/quali/starts) peak early; craft (race_iq/tyre/wet) peak late.
export const ATTR_PEAK = {
  pace: 25, quali: 25, starts: 24, aggression: 26, smoothness: 31,
  overtaking: 28, consistency: 30, defending: 30, composure: 32, discipline: 32, tyre: 33, wet: 33, race_iq: 35,
};
// one season of drift for an attribute at a given age (rise below peak, decline above; bounded ±0.025).
export function attrDrift(key, age) {
  const peak = ATTR_PEAK[key] ?? 28;
  const d = peak - age;                       // >0 improving, <0 declining
  const rate = d >= 0 ? 0.010 : 0.008;        // skills are gained a touch faster than they fade
  return Math.max(-0.025, Math.min(0.025, d * rate * 0.25));
}

// explicit driver traits (RU labels) — bias which attrs develop, surfaced in the paddock.
export const TRAITS = {
  wet_master:     { label: "Дождевик",         attrs: { wet: 1, race_iq: 0.4 } },
  overtaker:      { label: "Атакующий",         attrs: { overtaking: 1, aggression: 0.6 } },
  defender:       { label: "Скала",             attrs: { defending: 1, composure: 0.5 } },
  tyre_whisperer: { label: "Бережёт резину",    attrs: { tyre: 1, smoothness: 0.6 } },
  qualifier:      { label: "Квалифайер",        attrs: { quali: 1 } },
  starter:        { label: "Реактивный старт",  attrs: { starts: 1 } },
  ice_cold:       { label: "Хладнокровный",     attrs: { composure: 1, discipline: 0.6 } },
  strategist:     { label: "Гений гонки",       attrs: { race_iq: 1 } },
};
const TRAIT_DEV = 0.004;   // extra per-season drift on a trait's attrs
export function traitBias(traits, key) {
  let b = 0; for (const t of (traits || [])) { const w = TRAITS[t] && TRAITS[t].attrs[key]; if (w) b += TRAIT_DEV * w; }
  return b;
}

// known signature traits per driver (identity at career start). Others get none until they develop one.
const SIG_TRAIT = {
  VER: ["overtaker"], HAM: ["wet_master", "strategist"], ALO: ["strategist", "defender"],
  LEC: ["qualifier"], NOR: ["qualifier"], PIA: ["tyre_whisperer"], SAI: ["tyre_whisperer"],
  PER: ["tyre_whisperer"], GAS: ["wet_master"], RUS: ["qualifier"],
};
export function assignTraits(abbrev) { return SIG_TRAIT[abbrev] ? [...SIG_TRAIT[abbrev]] : []; }
```

- [ ] **Step 4:** Run → pass. **Step 5:** Commit `feat(apexweb): driver attrs readout + age-curve drift + traits (D5)`.

---

## Task 2: drivers.js — persistent attrs + independent development

**Files:** Modify `ApexWeb/src/drivers.js`; Test `ApexWeb/tests/drivers.test.js` (READ first).

- [ ] **Step 1 (tests):** append to `drivers.test.js`:
```js
import { ATTR_KEYS, overallFromAttrs } from "../src/team.js";

test("initDrivers gives each driver a persistent 13-attr vector + traits", () => {
  const d = initDrivers();
  for (const a in d) { assert.equal(Object.keys(d[a].attrs).length, ATTR_KEYS.length); assert.ok(Array.isArray(d[a].traits)); }
  assert.ok(d.VER.traits.includes("overtaker"));
});

test("developDrivers ages attributes independently: a veteran loses pace, keeps race_iq higher", () => {
  const d = initDrivers(); const vet = "ALO";
  const pace0 = d[vet].attrs.pace, iq0 = d[vet].attrs.race_iq;
  developDrivers(d);
  assert.ok(d[vet].attrs.pace < pace0);                        // pace fades
  assert.ok((iq0 - d[vet].attrs.race_iq) < (pace0 - d[vet].attrs.pace));  // craft fades slower
  assert.ok(Math.abs(d[vet].overall - overallFromAttrs(d[vet].attrs)) < 1e-9);  // overall tracks attrs
});

test("a young driver improves overall over a season", () => {
  const d = initDrivers(); const o0 = d.ANT.overall; developDrivers(d); assert.ok(d.ANT.overall > o0);
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** edit `drivers.js`:
  - import `{ driverAttrs, overallFromAttrs, attrDrift, attrBias?, assignTraits, ATTR_KEYS, traitBias }` from `./team.js` (driverAttrs already lives in team.js; no cycle — team.js imports only rng.js).
  - In `initDrivers()`, after computing `overall`, add `attrs` + `traits`:
```js
    const attrs = driverAttrs(dr.abbrev, overall);     // seed the persistent vector (signature already baked in)
    const traits = assignTraits(dr.abbrev);
    d[dr.abbrev] = { teamIdx: i, age: ..., overall, morale: 0.6, contractSeasons: ..., salary: ..., attrs, traits };
```
  - Rewrite `developDrivers` to drift each attr by the age curve + trait bias, then set overall from the readout:
```js
export function developDrivers(drivers) {
  for (const a in drivers) {
    const dr = drivers[a]; dr.age += 1;
    if (dr.attrs) {
      for (const k of ATTR_KEYS) dr.attrs[k] = clamp01(dr.attrs[k] + attrDrift(k, dr.age) + traitBias(dr.traits, k));
      dr.overall = clampOverall(overallFromAttrs(dr.attrs));
    } else {
      dr.overall = clampOverall(dr.overall + ageDrift(dr.age));   // legacy fallback
    }
    dr.salary = salaryFor(dr.overall);
    dr.contractSeasons = Math.max(0, dr.contractSeasons - 1);
  }
}
```
  (Keep `ageDrift` for the fallback. `clamp01` already defined.)

- [ ] **Step 4:** Run drivers + team tests → pass. **Step 5:** Commit `feat(apexweb): persistent per-driver attributes that develop independently (D5)`.

---

## Task 3: main.js buildField + academy — feed persistent attrs; new drivers get them

**Files:** Modify `ApexWeb/src/main.js`, `ApexWeb/src/academy.js` (READ both first).

- [ ] **Step 1:** In `buildField` (main.js ~258 and the co-op `mk` ~292), feed the persistent attrs when present:
  `attrs: dObj.attrs || driverAttrs(d.abbrev, overall)` (career driver object has `.attrs`; fallback unchanged → one-off play byte-identical). Confirm `dObj` is the career-driver object in scope (from `teamRoster`); if only `overall` is threaded, also thread `attrs`.
- [ ] **Step 2:** In `academy.js` `promoteJunior` (and junior init), give the promoted/junior driver `attrs = driverAttrs(abbrev, overall)` + `traits = assignTraits(abbrev)` so a promoted junior is a full citizen of the attr model. (Import from team.js.)
- [ ] **Step 3:** `node --check` both + `node --test` → green. **Step 4:** Commit `feat(apexweb): buildField + academy use persistent driver attrs (D5)`.

---

## Task 4: career.js migrate v9 + season.js Пилоты tab shows attrs/traits

**Files:** Modify `ApexWeb/src/career.js`, `ApexWeb/src/ui/season.js` (READ season.js — owner edits it).

- [ ] **Step 1:** `career.js` `CAREER_V = 9`; in `migrate`, add a `v < 9` block backfilling any driver missing `attrs`:
```js
  if (career._v < 9) { for (const a in (career.drivers || {})) { const dr = career.drivers[a];
    if (!dr.attrs) { dr.attrs = driverAttrs(a, dr.overall); dr.traits = assignTraits(a); } } }
```
  (import `driverAttrs, assignTraits` from team.js into career.js.)
- [ ] **Step 2:** `season.js` Пилоты tab: under each driver show 3–4 top attrs (e.g. `pace/quali/race_iq`) + trait badges from `TRAITS[t].label`. Pure render; import `TRAITS` from `../team.js`. Re-read season.js first (owner active — teamviz/driverCard may already render attrs; extend, don't clobber).
- [ ] **Step 3:** `node --check` → OK. **Step 4:** Commit `feat(apexweb): paddock shows driver attributes + traits (D5)`.

---

## Task 5: corridor — attrs develop, arcs bounded, overall follows

**Files:** Modify `ApexWeb/tools/career_balance.mjs`. After the season loop / `newSeason`, assert: a young driver's overall rose and a veteran's fell; per-attr drift within ±0.05/season; overall == overallFromAttrs(attrs) post-develop; grid still 2/team. Run → CAREER CORRIDOR OK. Commit `test(apexweb): driver-depth corridor (D5)`.

---

## Final verification
- [ ] `node --test ApexWeb/tests/*.test.js` → green.
- [ ] `node ApexWeb/tools/career_balance.mjs` → OK.
- [ ] Preview: Пилоты tab shows per-attribute bars + trait badges; play a weekend → no console errors.
- [ ] **Confirm one-off (non-career) race is byte-identical** (driverAttrs untouched; only career path reads persistent attrs).

## Self-review
- Persistent attrs ✓ independent dev ✓ traits (identity + dev bias) ✓ overall readout ✓ sim untouched (fallback keeps one-off byte-identical) ✓ migrate v9 ✓ deterministic ✓. Re-read main.js/season.js/academy.js before editing (owner active).
