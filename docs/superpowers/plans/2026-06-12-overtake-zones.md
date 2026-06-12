# Overtake Zones (TODO #2b, MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give overtakes *texture* — a pass now completes only in a real **overtake zone** (braking into Turn 1, or a slipstream zone), not "somewhere on the lap". Credit still builds everywhere within combat range; the follower is held until it reaches a zone, then passes if its credit beats the zone's local resistance. The pass event carries the zone type so the radio feed can say "обгон на торможении в 1-й поворот!". Single track (Barcelona), 2 manual zones. (TODO §2b, phases A–C; auto-zones from curvature = phase D, deferred.)

**Architecture:** `data.js` gains `TRACK.overtake_zones` (mini-sector index ranges + `ease` + `type`). A pure helper `zoneFor(zones, mini)` in `overtake.js` resolves a follower's mini-sector to a zone (or null). `sim.js _resolveCombat` keeps accruing pass-credit everywhere inside `COMBAT_GAP`, but **completion is gated on being in a zone**: outside any zone the resistance is effectively infinite (stay pinned, credit accumulates — "built the tow"); inside a zone the resistance is `(1−ease)·k`. The combat `lapFrac`-only invariant and determinism are untouched (zones are static data; `zoneFor` is pure; no new RNG). The pass event gains `zone` (the type) and `commentary.js` adds zone-specific lines.

**Tech Stack:** Vanilla JS ES modules, Node `node --test` + `tools/balance.mjs`.

**Spec source:** `ApexWeb/TODO.md` §2b. Combat anchor: `sim.js _resolveCombat` — credit line, `resist` line, and the `if (me._passCredit < resist) { pin } else { reset + emit pass }` block (~lines 169-209). `sampleAt(lapFrac)` (track.js) returns `{mini, sector, straightness}`; `N_MINI = 18`.

---

## File Structure

```
ApexWeb/src/data.js        + TRACK.overtake_zones (2 Barcelona zones)
ApexWeb/src/overtake.js    + zoneFor(zones, mini) pure helper
ApexWeb/src/sim.js         _resolveCombat: zone-gated pass completion; pass event carries zone type
ApexWeb/src/commentary.js  zone-aware pass templates (brake / slip / default)
ApexWeb/tools/balance.mjs   overtaking corridor re-tuned; assert passes happen only in zones
ApexWeb/tests/overtake.test.js   + zoneFor cases
ApexWeb/tests/sim.test.js        + "passes complete only in zones" + determinism
ApexWeb/tests/commentary.test.js + zone-line cases
```

---

## Task 1: data.js zones + overtake.js `zoneFor`

**Files:** Modify `ApexWeb/src/data.js`, `ApexWeb/src/overtake.js`; Test `ApexWeb/tests/overtake.test.js`.

- [ ] **Step 1: Add failing test** — append to `ApexWeb/tests/overtake.test.js`:

```js
import { zoneFor } from "../src/overtake.js";
import { TRACK } from "../src/data.js";

test("TRACK has 2 overtake zones; zoneFor resolves a mini-sector to a zone or null", () => {
  assert.ok(Array.isArray(TRACK.overtake_zones) && TRACK.overtake_zones.length === 2, "2 zones");
  for (const z of TRACK.overtake_zones) {
    assert.ok(Array.isArray(z.sectors) && z.sectors.length > 0, "zone has sectors");
    assert.ok(z.ease > 0 && z.ease <= 1, "ease in (0,1]");
    assert.ok(z.type === "brake" || z.type === "slip", "type brake|slip");
  }
  const inZoneMini = TRACK.overtake_zones[0].sectors[0];
  assert.ok(zoneFor(TRACK.overtake_zones, inZoneMini), "in-zone mini resolves");
  // a mini in NO zone -> null
  const all = new Set(TRACK.overtake_zones.flatMap(z => z.sectors));
  let outMini = -1; for (let m = 0; m < 18; m++) if (!all.has(m)) { outMini = m; break; }
  assert.equal(zoneFor(TRACK.overtake_zones, outMini), null, "out-of-zone mini -> null");
  assert.equal(zoneFor(undefined, 0), null, "missing zones -> null (safe)");
});
```

- [ ] **Step 2: Run to verify it fails**

Run (inside `ApexWeb/`): `node --test tests/overtake.test.js` → FAIL (`zoneFor` undefined / no `overtake_zones`).

- [ ] **Step 3: Implement.**

In `ApexWeb/src/data.js`, find the `TRACK` object (it has `name, gp, laps, lt, pw, df, ot, sc, abr, pit, wet, ...`). Add an `overtake_zones` field to it (mini-sector indices 0..17; 2 zones spread around the lap):
```js
  overtake_zones: [
    { sectors: [0, 1, 2], ease: 0.55, type: "brake" },   // Turn 1 — heavy braking after the main straight
    { sectors: [11, 12],   ease: 0.45, type: "slip" },    // slipstream into the final-sector entry
  ],
```
(Place it as a normal property inside the `TRACK = { ... }` literal. Keep `ot` — it stays the fallback for the resistance scale `k`.)

In `ApexWeb/src/overtake.js`, add the pure helper (anywhere, exported):
```js
// resolve a follower's mini-sector index to the overtake zone it's in, or null.
export function zoneFor(zones, mini) {
  if (!zones) return null;
  for (const z of zones) if (z.sectors.includes(mini)) return z;
  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/overtake.test.js` → pass. `node --test` → all green.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/data.js ApexWeb/src/overtake.js ApexWeb/tests/overtake.test.js
git commit -m "feat(apexweb): overtake zones data (2 Barcelona zones) + zoneFor helper"
```

---

## Task 2: sim.js — zone-gated pass completion

**Files:** Modify `ApexWeb/src/sim.js`; Test `ApexWeb/tests/sim.test.js`.

- [ ] **Step 1: Add failing tests** — append to `ApexWeb/tests/sim.test.js`:

```js
test("overtakes complete only inside overtake zones", () => {
  const { zoneFor } = require ? {} : {};   // (ESM: import at top instead — see note)
  const r = new Race(field(), TRACK, 6601); r.gridStart();
  let g = 0; while (!r.finished && g++ < 500000) r.step();
  const passes = r.events.filter(e => e.type === "pass");
  assert.ok(passes.length > 0, "some passes happened");
  for (const p of passes) assert.ok(p.zone === "brake" || p.zone === "slip", `pass carries a zone (${p.zone})`);
});

test("determinism holds with overtake zones", () => {
  const run = s => { const r = new Race(field(), TRACK, s); r.gridStart(); let g = 0;
    while (!r.finished && g++ < 500000) r.step(); return r.order().map(c => c.abbrev).join(","); };
  assert.equal(run(6602), run(6602));
});
```
NOTE (ESM): delete the bogus `const { zoneFor } = ...` line — it's a placeholder reminder. The first test only needs `r.events`; no extra import. Keep the two assertions.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/sim.test.js` → the "complete only inside zones" test fails (passes currently carry no `zone`).

- [ ] **Step 3: Edit `ApexWeb/src/sim.js`** (READ `_resolveCombat` fully first).

**3a. Import `zoneFor`.** The overtake import currently is:
```js
import { slipstream, dirtyWear, passAccrual } from "./overtake.js";
```
Change to:
```js
import { slipstream, dirtyWear, passAccrual, zoneFor } from "./overtake.js";
```

**3b. Zone-gated completion.** In `_resolveCombat`, the close-combat block computes `edge`, `tow`, accrues `me._passCredit`, then has:
```js
        const resist = (1 - this.track.ot) * 2.0 * (0.7 + ATTRW.defending * A(ahead).defending);
```
Replace that single `resist` line with zone resolution + zone-aware resistance:
```js
        const zone = zoneFor(this.track.overtake_zones, sampleAt(me.lapFrac).mini);   // follower's local zone (or null)
        const ease = zone ? zone.ease : this.track.ot;
        // outside any zone a pass cannot complete (resist = Infinity): the follower stays pinned and credit keeps building
        const resist = zone ? (1 - ease) * 2.0 * (0.7 + ATTRW.defending * A(ahead).defending) : Infinity;
```
Then in the existing pass-won branch (the `else` after `if (me._passCredit < resist)`), add the zone type to the emitted event. The current emit is:
```js
            this._emit({ type: "pass", lap: me.lap, a: me.idx, abbr: me.abbrev, b: ahead.idx, abbrB: ahead.abbrev });
```
Change to:
```js
            this._emit({ type: "pass", lap: me.lap, a: me.idx, abbr: me.abbrev, b: ahead.idx, abbrB: ahead.abbrev, zone: zone ? zone.type : null });
```
(Since `resist` is `Infinity` outside a zone, the `else` branch only runs when `zone` is non-null, so `zone.type` is always defined there — the `zone ? ... : null` is just defensive. Do NOT change the pin branch; it still writes only `lapFrac`.)

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/sim.test.js` → all pass. `node --test` → ALL green. The combat-invariant test must still pass (only `lapFrac` is written in the pin branch; the new code only READS `sampleAt`/zones and adds a field to the event). If determinism fails, you used non-deterministic state. Do NOT weaken tests.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/sim.js ApexWeb/tests/sim.test.js
git commit -m "feat(apexweb): combat completes passes only in overtake zones (credit builds, releases in-zone)"
```

---

## Task 3: commentary.js — zone-aware overtake lines

**Files:** Modify `ApexWeb/src/commentary.js`; Test `ApexWeb/tests/commentary.test.js`.

- [ ] **Step 1: Add failing tests** — append to `ApexWeb/tests/commentary.test.js`:

```js
test("zone passes get zone-flavoured lines (brake / slip)", () => {
  const brake = describe({ type: "pass", lap: 5, abbr: "NOR", abbrB: "LEC", zone: "brake" });
  const slip = describe({ type: "pass", lap: 5, abbr: "NOR", abbrB: "LEC", zone: "slip" });
  assert.ok(/торм/i.test(brake), "brake mentions braking");
  assert.ok(/слип|выхлоп|прям/i.test(slip), "slip mentions slipstream/straight");
  assert.ok(brake.includes("NOR") && brake.includes("LEC"));
});

test("a pass without a zone still works (default line)", () => {
  const s = describe({ type: "pass", lap: 5, abbr: "NOR", abbrB: "LEC" });
  assert.ok(typeof s === "string" && s.includes("NOR") && s.includes("LEC"));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/commentary.test.js` → the brake/slip test fails (no zone variants yet).

- [ ] **Step 3: Implement.** In `ApexWeb/src/commentary.js`, restructure the `pass` templates into zone buckets and make `describe` pick by `ev.zone`. Replace the existing `pass: [...]` entry in the `T` object with three sibling lists (keep `T.pass` as the default bucket; add `T.pass_brake` and `T.pass_slip`):

Change the `T` object's `pass` line from:
```js
  pass: ["{a} обходит {b}!", "{a} проходит {b} — отличный манёвр!", "Обгон! {a} впереди {b}.", "{a} дожимает {b} и выходит вперёд!"],
```
to:
```js
  pass: ["{a} обходит {b}!", "{a} проходит {b} — отличный манёвр!", "Обгон! {a} впереди {b}.", "{a} дожимает {b} и выходит вперёд!"],
  pass_brake: ["{a} обходит {b} на торможении!", "Поздний тормоз — {a} переигрывает {b}!", "{a} ныряет внутрь под торможение и опережает {b}!"],
  pass_slip: ["{a} ловит выхлоп и проходит {b}!", "В слипстриме {a} опережает {b}!", "{a} выстреливает на прямой мимо {b}!"],
```
Then in `describe`, change the type lookup so a `pass` with a zone uses the flavoured bucket. The current body starts:
```js
export function describe(ev) {
  if (!ev || !T[ev.type]) return "";
  const list = T[ev.type];
```
Change those lines to:
```js
export function describe(ev) {
  if (!ev || !T[ev.type]) return "";
  const key = (ev.type === "pass" && ev.zone && T["pass_" + ev.zone]) ? "pass_" + ev.zone : ev.type;
  const list = T[key];
```
(Leave the rest of `describe` — `list[pick(ev, list.length)]` and the `.replace(...)` chain — unchanged. `pick` already varies by event fields.)

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/commentary.test.js` → all pass. `node --test` → all green.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/commentary.js ApexWeb/tests/commentary.test.js
git commit -m "feat(apexweb): zone-flavoured overtake commentary (braking / slipstream lines)"
```

---

## Task 4: balance.mjs — re-tune the overtaking corridor

**Files:** Modify `ApexWeb/tools/balance.mjs`.

- [ ] **Step 1: Implement.** The existing overtaking corridor measures `avg |grid→finish| position change`. Zones cluster passes, so the count may drop. Extend that corridor block to ALSO report that passes happen only in zones, using the sim's event log. Find the overtaking corridor block (prints `overtaking: avg |grid→finish| ...`) and, inside its race loop, additionally collect the pass events. After the loop, add to the printed line the fraction of pass events that carry a zone (should be 1.0 by construction) and the average passes/race:
```js
  // (inside the existing `for (let s = 0; s < 20; s++)` loop, after the race completes:)
  //   passEvents += r.events.filter(e => e.type === "pass").length;
  //   zonedPasses += r.events.filter(e => e.type === "pass" && e.zone).length;
```
Declare `let passEvents = 0, zonedPasses = 0;` before the loop, accumulate as above, and append to the corridor's `console.log`:
```
 + `; passes/race ${(passEvents / 20).toFixed(1)}, in-zone ${passEvents ? (100 * zonedPasses / passEvents).toFixed(0) : 0}%`
```

- [ ] **Step 2: Run it**

Run (inside `ApexWeb/`): `node tools/balance.mjs`
Expected: every corridor still prints. The overtaking line should show **avg |grid→finish| still ~1-5 places/car** and **in-zone 100%**. If the position-change collapses below ~1 (zones too restrictive — the field processions), the controller will widen the zones or raise `ease`; if it explodes above ~6 (zones too easy), lower `ease`. Report the numbers — do NOT silently retune the data.

- [ ] **Step 3: Commit**

```
git add ApexWeb/tools/balance.mjs
git commit -m "feat(apexweb): balance harness reports overtaking with zones (passes/race, in-zone %)"
```

---

## Notes for the implementer

- **Combat invariant intact.** Only the pin branch writes `lapFrac` (unchanged). The new code READS `sampleAt(me.lapFrac).mini` + zone data and adds a field to the emitted event.
- **Determinism preserved.** Zones are static `data.js`; `zoneFor` is pure; resistance is a deterministic function of state. No new RNG/Date.
- **Why `resist = Infinity` outside a zone:** the follower stays pinned (the existing `if (me._passCredit < resist)` is always true), and `me._passCredit` keeps accumulating because we're still inside the `COMBAT_GAP` branch (the credit-reset only happens when the follower leaves combat range). When it reaches a zone, the (now large) credit beats the finite zone resistance → pass. This is the "built up the tow, releases in the braking zone" model from the TODO.
- **Balance expectation:** zones reduce "random" twisty-section passes and concentrate them — the overtaking corridor (~1-5 places/car) is the guard. Re-tune `ease`/zone width in `data.js` if it drifts; the harness now also prints passes/race + in-zone %.
- **Owner playtest (browser, hard-reload):** overtakes should now read with texture in the radio feed — "{driver} обходит {other} на торможении!" at Turn 1, "ловит выхлоп" in the slip zone — and feel like they happen at real overtaking spots rather than anywhere.
- **Deferred (phase D):** semi-automatic zones from track curvature via `tools/fastf1_extract.py` — only needed when the game grows past the single Barcelona track.
```
