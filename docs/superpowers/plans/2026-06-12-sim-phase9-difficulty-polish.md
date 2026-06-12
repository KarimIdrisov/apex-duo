# Sim Engine Phase 9 — difficulty selector + rebalance polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a player-facing **difficulty** (Лёгкая / Обычная / Сложная) that scales how sharp and fast the AI is, and use it to resolve the two Phase-8 tuning flags — at lower difficulty the AI carries a small pace handicap + more lap noise (slower, sloppier → easier for the player AND more winner variety among the AI field) and is less willing to gamble on the high-risk push (taming DNF); at **Сложная** the AI is razor-sharp and dominant (today's behaviour). One knob, set in the lobby, threaded into the sim.

**Architecture:** A `DIFFICULTY` preset table in `data.js` maps each level to an `ai` scalar in [0,1] (this is the existing `Race.difficulty`). The lobby gets a difficulty `<select>` that stores `ctx.difficulty`; `startRaceHost`/`startSolo` pass it into `new Race(field, track, seed, difficulty)`. In the sim, AI cars (`player == null`) get a difficulty-scaled pace handicap + extra lap noise in `_lapTime`, the strategy plan jitter widens at low difficulty, and `paceMode`'s aggressive push is gated by `race_iq × difficulty`. Human cars are never handicapped. Determinism + the combat invariant are untouched (all new noise rides the existing seeded `rng`).

**Tech Stack:** Vanilla JS ES modules, Node `node --test`. Host-authoritative netcode is unchanged — only the host runs the sim, so difficulty stays host-side (no snapshot/RPC change; the client just renders).

**Spec:** `docs/superpowers/specs/2026-06-12-sim-engine-redesign-design.md` §11 ("Сложность масштабирует остроту решений и шум AI") + §14 phase 9 ("rebalance + UI polish"). This is the final phase.

---

## File Structure

```
ApexWeb/src/data.js          + DIFFICULTY presets + AI_HANDICAP / AI_NOISE consts
ApexWeb/src/ai_strategy.js    planRace jitter widened by difficulty; paceMode push gated by race_iq×difficulty
ApexWeb/src/sim.js            Race(field, track, seed, difficulty); AI pace handicap+noise in _lapTime; pass difficulty to planRace
ApexWeb/src/main.js           startRaceHost / startSolo pass ctx.difficulty into Race
ApexWeb/src/ui/lobby.js       difficulty <select> → ctx.difficulty
ApexWeb/tools/balance.mjs      difficulty corridor (easy slower + more varied than hard; DNF in band each level)
ApexWeb/tests/data.test.js     + DIFFICULTY presets test
ApexWeb/tests/ai_strategy.test.js  + difficulty-gated push test
ApexWeb/tests/sim.test.js      + difficulty-handicap + determinism test
```

---

## Task 1: data.js — DIFFICULTY presets + handicap constants

**Files:** Modify `ApexWeb/src/data.js`; Test `ApexWeb/tests/data.test.js`.

- [ ] **Step 1: Add failing test** — append to `ApexWeb/tests/data.test.js`:

```js
import { DIFFICULTY, AI_HANDICAP, AI_NOISE } from "../src/data.js";
test("difficulty presets ascend easy<normal<hard in [0,1] with labels", () => {
  for (const k of ["easy", "normal", "hard"]) {
    assert.ok(DIFFICULTY[k] && typeof DIFFICULTY[k].label === "string", k);
    assert.ok(DIFFICULTY[k].ai >= 0 && DIFFICULTY[k].ai <= 1, `${k}.ai`);
  }
  assert.ok(DIFFICULTY.easy.ai < DIFFICULTY.normal.ai && DIFFICULTY.normal.ai < DIFFICULTY.hard.ai);
  assert.equal(DIFFICULTY.hard.ai, 1);
  assert.ok(AI_HANDICAP > 0 && AI_NOISE > 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run (inside `ApexWeb/`): `node --test tests/data.test.js` → FAIL (`DIFFICULTY` undefined).

- [ ] **Step 3: Implement** — in `ApexWeb/src/data.js`, after the `ATTRW` const block, add:

```js
// difficulty: the AI sharpness scalar (Race.difficulty). Lower = the AI is slower, sloppier,
// and less willing to gamble -> easier for the player and more winner variety in the field.
export const DIFFICULTY = {
  easy:   { label: "Лёгкая",  ai: 0.55 },
  normal: { label: "Обычная", ai: 0.80 },
  hard:   { label: "Сложная", ai: 1.00 },
};
export const AI_HANDICAP = 0.80;  // s/lap an AI loses at difficulty 0 (scaled by 1-difficulty)
export const AI_NOISE    = 0.45;  // extra lap-noise amplitude for AI at difficulty 0 (scaled by 1-difficulty)
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/data.test.js` → PASS. `node --test` → all green.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/data.js ApexWeb/tests/data.test.js
git commit -m "feat(apexweb): difficulty presets + AI handicap/noise constants (phase 9)"
```

---

## Task 2: ai_strategy.js + sim.js — thread difficulty through the AI

**Files:** Modify `ApexWeb/src/ai_strategy.js`, `ApexWeb/src/sim.js`; Test `ApexWeb/tests/ai_strategy.test.js`, `ApexWeb/tests/sim.test.js`.

- [ ] **Step 1: Add failing tests.**

Append to `ApexWeb/tests/ai_strategy.test.js`:
```js
test("paceMode push is gated by race_iq × difficulty (sharp AI attacks, easy AI doesn't)", () => {
  const c = aiCar();   // race_iq 0.7
  const attack = { dirtyAir: false, canPass: false, gapAhead: 0.7 };
  assert.equal(paceMode(c, { ...attack, difficulty: 1.0 }), "push", "hard AI attacks");
  assert.equal(paceMode(c, { ...attack, difficulty: 0.55 }), "balanced", "easy AI holds station");
});
```
(The earlier paceMode test calls `paceMode(c, {dirtyAir:false,canPass:false,gapAhead:0.7})` with NO difficulty — it must still return "push" via the default. Keep that working: default difficulty inside paceMode is 0.85, and 0.7×0.85=0.595 > 0.5 → push.)

Append to `ApexWeb/tests/sim.test.js`:
```js
test("easy AI laps slower than hard AI (same field, difficulty handicap)", () => {
  const easy = new Race(field(), TRACK, 8001, 0.55);
  const hard = new Race(field(), TRACK, 8001, 1.0);
  easy.gridStart(); hard.gridStart();
  for (let i = 0; i < 4000; i++) { easy.step(); hard.step(); }
  const avg = r => { const f = r.cars.filter(c => !c.retired && c.avgLap > 0); return f.reduce((a, c) => a + c.avgLap, 0) / f.length; };
  assert.ok(avg(easy) > avg(hard), `easy field slower (${avg(easy).toFixed(2)} > ${avg(hard).toFixed(2)})`);
});

test("determinism holds across difficulty", () => {
  const run = d => { const r = new Race(field(), TRACK, 8002, d); r.gridStart(); let g = 0;
    while (!r.finished && g++ < 500000) r.step(); return r.order().map(c => c.abbrev); };
  assert.deepEqual(run(0.8), run(0.8));
  // different difficulty -> (almost surely) a different result, proving the knob bites
  assert.notDeepEqual(run(0.55), run(1.0));
});
```

- [ ] **Step 2: Run to verify the new ones fail**

Run: `node --test tests/ai_strategy.test.js tests/sim.test.js` → the new tests fail (difficulty not threaded yet; Race ignores the 4th arg).

- [ ] **Step 3a: Edit `ApexWeb/src/ai_strategy.js`.**

In `planRace`, widen the jitter at low difficulty. Change the signature and the drift line:
```js
export function planRace(c, track, seed) {
```
to
```js
export function planRace(c, track, seed, difficulty = 0.85) {
```
and change:
```js
  const drift = (1 - strat) * 6 * j;   // up to ~±3 laps for a weak strategist, ~0 for a sharp one
```
to:
```js
  const drift = (1 - strat) * 6 * j + (1 - difficulty) * 8 * j;   // weak strategist OR low difficulty = sloppier timing
```

In `paceMode`, gate the push by `race_iq × difficulty`. Change:
```js
export function paceMode(c, ctx) {
  if (ctx.dirtyAir && !ctx.canPass) return "conserve";    // stuck behind: pushing only kills tyres
  if (ctx.gapAhead != null && ctx.gapAhead < 1.0 && c.wear < COMPOUNDS[c.tyre].cliff * 0.7) return "push";
  return "balanced";
}
```
to:
```js
export function paceMode(c, ctx) {
  if (ctx.dirtyAir && !ctx.canPass) return "conserve";    // stuck behind: pushing only kills tyres
  const iq = (c.attrs && c.attrs.race_iq != null) ? c.attrs.race_iq : 0.5;
  const diff = ctx.difficulty != null ? ctx.difficulty : 0.85;
  if (ctx.gapAhead != null && ctx.gapAhead < 1.0 && c.wear < COMPOUNDS[c.tyre].cliff * 0.7 && iq * diff > 0.5) return "push";
  return "balanced";
}
```

- [ ] **Step 3b: Edit `ApexWeb/src/sim.js`** (READ first).

**Constructor signature + difficulty.** Change:
```js
  constructor(field, track, seed) {
```
to:
```js
  constructor(field, track, seed, difficulty = 0.85) {
```
Change the hard-coded difficulty line added in Phase 8:
```js
    this.difficulty = 0.85;   // scales AI sharpness (UI selection comes in Phase 9)
    for (const c of this.cars) {
      if (c.player == null) { c.aiPlan = planRace(c, track, seed); c.aiStopsDone = 0; }
    }
```
to:
```js
    this.difficulty = difficulty;   // AI sharpness scalar (lobby-selected; default ~Обычная)
    for (const c of this.cars) {
      if (c.player == null) { c.aiPlan = planRace(c, track, seed, this.difficulty); c.aiStopsDone = 0; }
    }
```

**AI pace handicap + noise in `_lapTime`.** Add `AI_HANDICAP, AI_NOISE` to the data import line. Then in `_lapTime`, find the noise line (Phase 7):
```js
    s += this.rng.noise(0.06) * (1.3 - ATTRW.noise * A(c).consistency);      // consistency steadies the lap
```
and add immediately AFTER it:
```js
    if (c.player == null && this.difficulty < 1) {                            // difficulty handicap (AI only)
      s += (1 - this.difficulty) * AI_HANDICAP;                              // easier AI = a touch slower
      s += this.rng.noise((1 - this.difficulty) * AI_NOISE);                 // ...and less consistent (more upsets)
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/ai_strategy.test.js tests/sim.test.js` → all pass. Then `node --test` → ALL green. If `determinism across difficulty` fails on `notDeepEqual` (two difficulties gave the identical order), the handicap/noise isn't biting — check the `_lapTime` edit. Do NOT weaken tests.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/ai_strategy.js ApexWeb/src/sim.js ApexWeb/tests/ai_strategy.test.js ApexWeb/tests/sim.test.js
git commit -m "feat(apexweb): thread difficulty through the AI — pace handicap/noise, plan jitter, gated push"
```

---

## Task 3: main.js + lobby.js — difficulty selector UI

**Files:** Modify `ApexWeb/src/main.js`, `ApexWeb/src/ui/lobby.js`.

- [ ] **Step 1: Implement — `main.js`.**

Import `DIFFICULTY` (add to the data import line in `main.js`):
```js
import { TEAMS, TRACK, STEP, GRID_GAP, DIFFICULTY } from "./data.js";
```
In `startRaceHost()`, change:
```js
  ctx.race = new Race(field, TRACK, ctx.seed);
```
to:
```js
  ctx.race = new Race(field, TRACK, ctx.seed, ctx.difficulty ?? DIFFICULTY.normal.ai);
```

- [ ] **Step 2: Implement — `lobby.js`.**

Import the presets (add to the data import):
```js
import { TEAMS, TEAM_LOGO, DIFFICULTY } from "../data.js";
```
At the top of `render`, default the difficulty key:
```js
  ctx.diffKey = ctx.diffKey || "normal";
  ctx.difficulty = DIFFICULTY[ctx.diffKey].ai;
```
Add a difficulty selector to the markup — insert right after the team `<div>...</div>` block (before the `<div style="height:10px"></div>` that precedes the host button):
```js
      <div style="height:10px"></div>
      <p class="label">Сложность ИИ</p>
      <select id="diff" style="width:100%;padding:8px">${
        Object.entries(DIFFICULTY).map(([k, d]) =>
          `<option value="${k}" ${k === ctx.diffKey ? "selected" : ""}>${d.label}</option>`).join("")
      }</select>
```
Wire its handler (next to the `#team` onchange handler):
```js
  root.querySelector("#diff").onchange = e => {
    ctx.diffKey = e.target.value;
    ctx.difficulty = DIFFICULTY[ctx.diffKey].ai;
  };
```

- [ ] **Step 3: Verify (no DOM in node — check parse + boot).**

Run: `node --check ApexWeb/src/main.js && node --check ApexWeb/src/ui/lobby.js` → OK. `node --test` → all green (unchanged; UI isn't unit-tested). A browser boot smoke is done by the controller after this task.

- [ ] **Step 4: Commit**

```
git add ApexWeb/src/main.js ApexWeb/src/ui/lobby.js
git commit -m "feat(apexweb): lobby difficulty selector (Лёгкая/Обычная/Сложная) -> Race"
```

---

## Task 4: balance.mjs — difficulty corridor + final pass

**Files:** Modify `ApexWeb/tools/balance.mjs`.

- [ ] **Step 1: Implement** — the harness `field()` builds cars; `new Race(field(), TRACK, seed)` currently uses the default difficulty. Add a difficulty corridor after the strategy corridor:

```js
// difficulty corridor: lower difficulty makes the AI field slower and MORE varied (more winners),
// higher difficulty is razor-sharp (the best car dominates). Each level keeps DNF in band.
{
  const sample = (diff, races = 40) => {
    const winners = {}; let dnf = 0, spread = 0, n = 0;
    for (let s = 0; s < races; s++) {
      const r = new Race(field(), TRACK, 1000 + s, diff);
      r.gridStart();
      let g = 0; while (!r.finished && g++ < 500000) r.step();
      const ord = r.order(); winners[ord[0].abbrev] = (winners[ord[0].abbrev] || 0) + 1;
      dnf += r.cars.filter(c => c.retired).length;
      const fin = r.cars.filter(c => !c.retired).map(c => c.avgLap).sort((a, b) => a - b);
      if (fin.length > 1) { spread += fin[fin.length - 1] - fin[0]; n++; }
    }
    return { uniqueWinners: Object.keys(winners).length, topWin: Math.max(...Object.values(winners)),
      dnf: (dnf / races).toFixed(2), spread: (spread / n).toFixed(2), winners };
  };
  const easy = sample(0.55), hard = sample(1.0);
  console.log(`difficulty easy(0.55): ${easy.uniqueWinners} winners, top ${easy.topWin}/40, DNF ${easy.dnf}, spread ${easy.spread}`);
  console.log(`difficulty hard(1.00): ${hard.uniqueWinners} winners, top ${hard.topWin}/40, DNF ${hard.dnf}, spread ${hard.spread}`);
  console.log(`  -> expect easy has >= hard unique winners (more variety) and each DNF ~1-2.5`);
}
```

- [ ] **Step 2: Run it**

Run (inside `ApexWeb/`): `node tools/balance.mjs`
Expected: all prior corridors still sane. The two difficulty lines should show **easy with >= as many unique winners as hard** (more spread of victories) and **both DNF roughly in 1-2.5**. The default-difficulty `winners:`/`avg DNF` lines at the top may shift slightly from Phase 8 (the default is now the mild 0.85 handicap+noise) — DNF should be in 1-2 and spread ~1.5-2.5. If easy does NOT produce more unique winners than hard, the AI noise (`AI_NOISE`) is too small to create upsets — report the numbers (the controller may raise `AI_NOISE`); do NOT silently retune. Report all the numbers you see.

- [ ] **Step 3: Commit**

```
git add ApexWeb/tools/balance.mjs
git commit -m "feat(apexweb): balance harness difficulty corridor (variety vs sharpness)"
```

---

## Notes for the implementer

- **Determinism preserved.** All new AI noise rides the existing seeded `this.rng`; difficulty is a plain number. No Math.random/Date. The "determinism across difficulty" test locks same-seed-same-difficulty reproducibility AND that different difficulties diverge.
- **Combat invariant untouched** — Phase 9 only adds terms to `_lapTime` (the clean lap time) and gates a mode choice; nothing new writes `lap`/`lapFrac`/`wear`.
- **Human cars never handicapped** — the `_lapTime` block guards on `c.player == null`. The player always drives at full pace; difficulty only changes the AI around them.
- **Resolves the Phase-8 flags:** at the default/lower difficulty the AI pace noise creates winner variety (the Phase-7 spread returns as a *tunable*, not a global retune) and the `race_iq×difficulty` push gate means fewer AI cars gamble on the risky push → DNF eases off the 1.95 edge. **Сложная** keeps the sharp, dominant AI for players who want it.
- **Netcode:** difficulty is host-side only (the host runs the sim). No snapshot/RPC change. The client renders whatever the host's sim produces. (If a future online-lobby wants the client to *see* the chosen difficulty, broadcast it in the `phase` message — out of scope here.)
- **Owner playtest (browser, hard-reload):** pick Лёгкая → the AI should be visibly beatable and the podium varies race-to-race; pick Сложная → the top car/driver dominates and punishes mistakes. The selector sits in the lobby above the host/solo buttons.
- **This is the final phase of the sim-engine redesign.** After it, update `ApexWeb/README` (if present) and the project memory with the completed engine. Remaining open items are outside this redesign: explicit undercut/overcut *targeting*, online-lobby difficulty echo, AI strategy/engine HUD readouts, and the broader backlog (online season, audio/tutorial polish).
```
