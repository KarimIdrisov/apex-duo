# ApexWeb Auto-Place Overtake Zones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An «Авто-зоны» button in the track editor that fills overtake zones from the track's corner geometry (brake zones at the main braking points + a slip zone on the longest straight), which the owner then edits.

**Architecture:** A pure, import-free heuristic `suggestZonesFromClasses(classes)` over the 18 corner-class strings the editor already computes for its overlay. The editor button computes the effective classes (auto + the owner's right-click overrides), calls the heuristic, and **replaces** the `zones` array. Data-authoring only — the sim/combat already consumes `zones`, so nothing in `sim.js`/`data.js` changes.

**Tech Stack:** Vanilla ES modules, `node --test`.

**Spec:** `docs/superpowers/specs/2026-06-15-apexweb-auto-zones-design.md`

## Conventions (apply to every task)

- **Run all commands from the `ApexWeb/` directory.**
- **Commits use explicit pathspecs — never `git add -A`.** The repo holds unrelated uncommitted owner WIP.
- **End every commit message** with a blank line then `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- User-facing strings **Russian**; code/comments English.

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `src/autozones.js` | Create | **Pure, import-free** `suggestZonesFromClasses(classes, opts)`. Unit-tested. |
| `src/ui/editor.js` | Modify | «Авто-зоны» handler: effective classes → heuristic → replace `zones` + toast. |
| `editor.html` | Modify | An «🎯 Авто» button in the Зоны panel (`#zonectl`). |
| `tests/autozones.test.js` | Create | Unit tests for the heuristic. |
| `README.md` | Modify | One line under the Зоны description. |

**Untouched:** `sim.js`, `data.js`, `track.js`, `overtake.js`, `track_store.js`, netcode.

---

### Task 1: `autozones.js` — the pure heuristic

**Files:**
- Create: `ApexWeb/src/autozones.js`
- Test: `ApexWeb/tests/autozones.test.js`

- [ ] **Step 1: Write the failing test**

Create `ApexWeb/tests/autozones.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestZonesFromClasses } from "../src/autozones.js";

const S = (n, fill = "straight") => Array(n).fill(fill);

test("oval (all straight): one slip zone, no brakes", () => {
  const z = suggestZonesFromClasses(S(18));
  assert.equal(z.length, 1);
  assert.equal(z[0].type, "slip");
  assert.equal(z[0].sectors.length, 3);
  assert.equal(z[0].ease, 0.45);
});

test("all medium corners (no fast sectors): no zones", () => {
  assert.deepEqual(suggestZonesFromClasses(S(18, "med")), []);
});

test("one hairpin after a long straight: a brake zone at it + a disjoint slip", () => {
  const c = S(18); c[5] = "low";
  const z = suggestZonesFromClasses(c);
  const brake = z.find((x) => x.type === "brake");
  const slip = z.find((x) => x.type === "slip");
  assert.ok(brake, "has a brake zone");
  assert.deepEqual(brake.sectors, [3, 4, 5]);
  assert.equal(brake.ease, 0.5);
  assert.ok(slip, "has a slip zone");
  assert.equal(slip.sectors.length, 3);
  assert.ok(slip.sectors.every((s) => c[s] === "straight"), "slip only on straights");
  assert.ok(slip.sectors.every((s) => !brake.sectors.includes(s)), "slip disjoint from brake");
});

test("caps + structural properties on a four-corner pattern", () => {
  const c = S(18);
  for (const i of [3, 7, 11, 15]) c[i] = "low";
  const z = suggestZonesFromClasses(c);
  const brakes = z.filter((x) => x.type === "brake");
  assert.ok(brakes.length <= 3, "at most maxBrakes brake zones");
  const all = z.flatMap((x) => x.sectors);
  assert.ok(all.every((s) => Number.isInteger(s) && s >= 0 && s < 18), "indices in range");
  const seen = new Set();
  for (const b of brakes) for (const s of b.sectors) { assert.ok(!seen.has(s), "brakes disjoint"); seen.add(s); }
  for (const b of brakes) assert.ok(b.sectors.some((s) => ["low", "med"].includes(c[s])), "brake covers a slow sector");
});

test("empty / too-short input: []", () => {
  assert.deepEqual(suggestZonesFromClasses([]), []);
  assert.deepEqual(suggestZonesFromClasses(["straight"]), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/autozones.test.js`
Expected: FAIL — cannot find module `../src/autozones.js`.

- [ ] **Step 3: Write the implementation**

Create `ApexWeb/src/autozones.js`:

```js
// ApexWeb/src/autozones.js — pure heuristic that suggests overtake zones from a track's 18 corner
// classes. NO imports: the caller (editor) computes the classes (it already does for the overlay) and
// passes them in. Returns the same {sectors, ease, type} shape the editor paints + the sim reads.
const RANK = { straight: 3, high: 2, med: 1, low: 0 };

// classes: array of "straight"|"high"|"med"|"low" (length N, =18 in the editor). Returns
// [{sectors:[asc], ease, type:"brake"|"slip"}]. Deterministic; [] when no zones are found.
export function suggestZonesFromClasses(classes, opts = {}) {
  const { maxBrakes = 3, brakeEase = 0.5, slipEase = 0.45, brakeLen = 3, slipLen = 3 } = opts;
  const N = Array.isArray(classes) ? classes.length : 0;
  if (N < 2) return [];
  const wrap = (i) => ((i % N) + N) % N;
  const r = (i) => { const v = RANK[classes[wrap(i)]]; return v === undefined ? 3 : v; };
  const fast = (i) => r(i) >= 2, slow = (i) => r(i) <= 1;

  // braking points: a slow corner right after a fast sector; score by the approach (fast-run) length.
  const pts = [];
  for (let i = 0; i < N; i++) {
    if (slow(i) && fast(i - 1)) {
      let len = 0, j = i - 1;
      while (len < N && fast(j)) { len++; j--; }
      pts.push({ entry: i, approach: len });
    }
  }
  pts.sort((a, b) => b.approach - a.approach || a.entry - b.entry);

  const covered = new Set(), zones = [];
  for (const p of pts) {
    if (zones.length >= maxBrakes) break;
    if (covered.has(p.entry)) continue;
    const secs = [p.entry];
    let j = p.entry - 1;
    while (secs.length < brakeLen && fast(j)) { secs.push(wrap(j)); j--; }
    if (secs.some((s) => covered.has(s))) continue;   // would overlap an earlier brake zone
    secs.forEach((s) => covered.add(s));
    zones.push({ sectors: secs.slice().sort((a, b) => a - b), ease: brakeEase, type: "brake" });
  }

  // slip: longest wrap-aware run of consecutive "straight" sectors, minus covered, capped to slipLen.
  const run = longestStraightRun(classes, N);
  if (run.length >= 2) {
    const free = run.filter((s) => !covered.has(s)).slice(0, slipLen);
    if (free.length >= 2) zones.push({ sectors: free.slice().sort((a, b) => a - b), ease: slipEase, type: "slip" });
  }
  return zones;
}

// longest run of consecutive "straight" sectors round the loop, as indices in track order from the
// run's start. [] if there is no straight sector; the whole loop if every sector is straight.
function longestStraightRun(classes, N) {
  const isS = (i) => classes[((i % N) + N) % N] === "straight";
  let any = false; for (let i = 0; i < N; i++) if (isS(i)) { any = true; break; }
  if (!any) return [];
  let start = 0; while (start < N && isS(start)) start++;
  if (start === N) return Array.from({ length: N }, (_, i) => i);   // all straight
  let best = [], cur = [];
  for (let k = 0; k < N; k++) {
    const i = (start + k) % N;
    if (isS(i)) { cur.push(i); if (cur.length > best.length) best = cur.slice(); }
    else cur = [];
  }
  return best;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/autozones.test.js`
Expected: PASS — 5 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/autozones.js tests/autozones.test.js
git commit -m "feat(apexweb): autozones — pure suggestZonesFromClasses heuristic (brake points + slip)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `editor.html` — the «Авто» button

**Files:**
- Modify: `ApexWeb/editor.html`

- [ ] **Step 1: Add the button to the Зоны panel**

In `ApexWeb/editor.html`, find:

```html
  <div class="row" id="zonectl" hidden><button id="z-brake">+ тормозная</button> <button id="z-slip">+ слипстрим</button><br>
```

Replace it with (add the «🎯 Авто» button after z-slip):

```html
  <div class="row" id="zonectl" hidden><button id="z-brake">+ тормозная</button> <button id="z-slip">+ слипстрим</button> <button id="autozones">🎯 Авто</button><br>
```

- [ ] **Step 2: Commit**

```bash
git add editor.html
git commit -m "feat(apexweb): editor «🎯 Авто» (auto-zones) button in the Зоны panel" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `editor.js` — wire the auto-zones handler

**Files:**
- Modify: `ApexWeb/src/ui/editor.js`

UI change — no unit test. Gate: `node --check src/ui/editor.js`.

- [ ] **Step 1: Add the import**

In `ApexWeb/src/ui/editor.js`, find:

```js
import { fitOutline } from "../editor_preview.js";   // pure, THREE-free — safe to import statically
```

Add after it:

```js
import { fitOutline } from "../editor_preview.js";   // pure, THREE-free — safe to import statically
import { suggestZonesFromClasses } from "../autozones.js";   // pure heuristic for the «Авто» button
```

- [ ] **Step 2: Add the handler**

In `ApexWeb/src/ui/editor.js`, find the slip-zone button wiring:

```js
document.getElementById("z-slip").onclick = () => addZone("slip");
```

Add immediately after it:

```js
document.getElementById("autozones").onclick = () => {   // suggest zones from the corner classes (you edit after)
  const cl = buildCenterline(splinePath(toFlat(pts)));
  const auto = sectorCornerClasses(cl, N_MINI);
  const eff = auto.map((c, m) => cornerOverrides[m] || c);   // honour right-click corner overrides
  const zs = suggestZonesFromClasses(eff);
  zones.length = 0; for (const z of zs) zones.push(z);
  activeZone = -1; refreshZoneList(); render();
  toast(zs.length ? ("Авто-зоны: " + zs.length) : "Зоны не найдены — расставь вручную");
};
```

- [ ] **Step 3: Verify syntax**

Run: `node --check src/ui/editor.js`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/ui/editor.js
git commit -m "feat(apexweb): editor «Авто» zones — effective classes → suggestZonesFromClasses → replace zones" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: README + final verification

**Files:**
- Modify: `ApexWeb/README.md`

- [ ] **Step 1: Update the Зоны description**

In `ApexWeb/README.md`, in the **## Редактор трассы** section, find the text describing **Зоны** (it mentions «красишь зоны обгона тормозн./слип + ease; ПКМ по сектору — класс поворота»). Append to that sentence, before its closing `)`:

` · 🎯 Авто — расставить зоны по геометрии (правишь после)`

So the parenthetical ends with `… ПКМ по сектору — класс поворота · 🎯 Авто — расставить зоны по геометрии (правишь после))`.

If the exact text differs, READ the section and append the same `🎯 Авто …` note to the Зоны description; report any adaptation.

- [ ] **Step 2: Run the new test + syntax check**

Run:
```bash
node --test tests/autozones.test.js
node --check src/ui/editor.js
```
Expected: 5 tests PASS; `node --check` exit 0.

- [ ] **Step 3: Run the full suite (regression gate)**

Run: `node --test`
Expected: the whole suite is green (existing + the 5 new). `autozones.js` is pure and isolated; `editor.js` is the only other change and has no unit test — nothing else's behavior changes. (~10 min.)

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(apexweb): editor 🎯 Авто-зоны in README" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Owner F5 (manual — visual)

1. `cd ApexWeb && node tools/editor_server.mjs` (or `python -m http.server 8000`), open `localhost:8000/editor.html`.
2. Pick a circuit → **Зоны** mode → **🎯 Авто** → brake zones appear at the heavy braking points (long straight → slow corner) + a slip zone on the longest straight; the painted overlay matches; the toast shows the count.
3. Right-click a sector to change its corner class, hit **🎯 Авто** again → the suggestion respects the override.
4. Edit/clear the suggested zones (existing zone UI) → works. **🏁 Гонять** → overtakes cluster at the suggested zones.

## Self-Review

**1. Spec coverage:**
- Pure heuristic over corner classes (brake points + slip) → Task 1. ✓
- Editor «Авто» button, replace + toast, honours `cornerOverrides` → Tasks 2, 3. ✓
- Data-authoring only (no sim/data/overtake/track_store/netcode edits) → file list + full-suite gate Task 4. ✓
- Error handling: no zones → toast «Зоны не найдены»; `[]`-safe on degenerate/short input → Task 1 (tests) + Task 3 (toast). ✓
- README → Task 4. ✓

**2. Placeholder scan:** No TBD/TODO; every code step has full content. ✓

**3. Type consistency:** `suggestZonesFromClasses(classes, opts) -> [{sectors:number[], ease:number, type:"brake"|"slip"}]` used identically in the test, the heuristic, and the editor handler; the editor passes `eff` (string[] of classes) and consumes `z.sectors/ease/type` into the existing `zones` array (same shape the rest of editor.js + the sim already use). ✓
