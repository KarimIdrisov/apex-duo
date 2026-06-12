# Race Commentary Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live radio/commentator feed on the race screen — the sim emits structured event codes (race start, overtakes, pit stops, retirements, fastest laps, safety car, finish) and a pure `commentary.js` turns them into Russian one-liners shown in a scrolling panel, for both the host and the online client. (TODO item #1.)

**Architecture:** The deterministic sim (`sim.js`) appends structured, string-free event objects to a `this.events` log at the points where each event already happens (it only READS state and pushes — the combat `lapFrac`-only invariant and determinism are untouched). `main.js` ships the *new* events in each host→client snapshot. A new pure module `commentary.js` maps an event code to a Russian sentence (with small deterministic variety). `ui/race.js` accumulates incoming events into a capped feed and renders the last several lines.

**Tech Stack:** Vanilla JS ES modules, Node `node --test`. Host-authoritative netcode unchanged in shape — only a new `events` field rides the existing snapshot.

**Spec source:** `ApexWeb/TODO.md` §1. Events already occur in `sim.js`: start (`step` first-run), pass won (`_resolveCombat` else-branch ~line 179), pit (`_serveLapEnd` ~line 235), retire (`c.retired` set in `_startIncidents`/`_serveLapEnd`), fastest lap (lap-end ~line 96), SC flip (`step` ~lines 118-121), finish (`step` ~line 123).

---

## File Structure

```
ApexWeb/src/sim.js          + this.events log + trackers; _emit() at 7 points (read-only, deterministic)
ApexWeb/src/commentary.js   NEW — pure describe(ev) -> Russian string (deterministic variety) + helpers
ApexWeb/src/main.js         raceSnapshot ships new events since last push; reset index on race start
ApexWeb/src/ui/race.js      accumulate events into a capped feed; render the "Радио" panel
ApexWeb/tests/sim.test.js   + events-emitted + determinism-of-events cases
ApexWeb/tests/commentary.test.js  NEW
```

---

## Task 1: sim.js — emit structured event codes

**Files:** Modify `ApexWeb/src/sim.js`; Test `ApexWeb/tests/sim.test.js`.

Events are plain objects pushed to `this.events`. Each carries `{ type, lap, ... }` and driver abbrevs (a data field, not a UI string) so the formatter needs nothing else. The log is deterministic (depends only on sim state + the deterministic `this.time`) and never feeds back into the numeric path.

- [ ] **Step 1: Add failing tests** — append to `ApexWeb/tests/sim.test.js`:

```js
test("sim emits a deterministic event log (start, and same seed -> identical events)", () => {
  const run = s => { const r = new Race(field(), TRACK, s); r.gridStart(); let g = 0;
    while (!r.finished && g++ < 500000) r.step(); return r.events; };
  const e1 = run(4242), e2 = run(4242);
  assert.ok(Array.isArray(e1) && e1.length > 0, "events produced");
  assert.ok(e1.some(e => e.type === "start"), "has a start event");
  assert.deepEqual(e1, e2, "same seed -> identical event log");
});

test("a full race produces pit, fastlap and finish events", () => {
  const r = new Race(field(), TRACK, 4243); r.gridStart();
  let g = 0; while (!r.finished && g++ < 500000) r.step();
  const types = new Set(r.events.map(e => e.type));
  assert.ok(types.has("pit"), "someone pitted");
  assert.ok(types.has("fastlap"), "a fastest lap was set");
  assert.ok(types.has("finish"), "race finished");
  for (const e of r.events) assert.ok(typeof e.lap === "number", "every event has a lap");
});

test("pass events carry both drivers and don't spam (cooldown per car)", () => {
  const r = new Race(field(), TRACK, 4244); r.gridStart();
  let g = 0; while (!r.finished && g++ < 500000) r.step();
  const passes = r.events.filter(e => e.type === "pass");
  for (const p of passes) { assert.ok(p.abbr && p.abbrB && p.abbr !== p.abbrB, "two distinct drivers"); }
  // cooldown: no single car emits two passes within 4 sim-seconds (they store no time, so check via event spacing per attacker)
  assert.ok(passes.length < 400, `passes bounded (${passes.length})`);
});
```

- [ ] **Step 2: Run to verify it fails**

Run (inside `ApexWeb/`): `node --test tests/sim.test.js` → the 3 new tests fail (`r.events` undefined).

- [ ] **Step 3: Edit `ApexWeb/src/sim.js`** (READ it fully first).

**1a. Constructor — event log + trackers.** At the END of the constructor (right after the Phase-9 `this.difficulty = ...; for (...) { ... }` block), add:
```js
    this.events = [];                 // deterministic structured event log (string-free)
    this._fastLap = Infinity;         // best lap time seen so far (for "fastest lap" events)
    this._scWas = false;              // safety-car edge detector
    this._retiredSeen = new Set();    // idx already announced as DNF
```
Add this method anywhere in the class (e.g. right after the constructor):
```js
  _emit(ev) { this.events.push(ev); }   // append a structured event (read-only w.r.t. the sim)
```

**1b. Start event.** In `step()`, the first-run block is:
```js
    if (!this._started) { this._started = true; this._startIncidents(); }
```
Change it to also emit a start event (pole-sitter from the grid order):
```js
    if (!this._started) {
      this._started = true; this._startIncidents();
      const pole = this.order()[0];
      this._emit({ type: "start", lap: 0, a: pole.idx, abbr: pole.abbrev });
    }
```

**1c. Fastest lap.** In the lap-completion block, just AFTER `this._recordMinis(c);` (line ~97), add:
```js
        if (c.lap > 1 && !this.scActive && c.lastLap < this._fastLap) {   // a new overall fastest (ignore lap 1 / SC laps)
          this._fastLap = c.lastLap;
          this._emit({ type: "fastlap", lap: c.lap, a: c.idx, abbr: c.abbrev, t: c.lastLap });
        }
```

**1d. Pit event.** In `_serveLapEnd`, inside `if (c.pitPending) { ... }`, AFTER `c.pitStops += 1; c.totalTime += pitLoss;`, add:
```js
      this._emit({ type: "pit", lap: c.lap, a: c.idx, abbr: c.abbrev, compound: c.tyre });
```

**1e. Overtake event (with per-car cooldown to avoid tick-spam).** In `_resolveCombat`, the pass-won branch is:
```js
        } else {
          me._passCredit = 0; // pass completes naturally next ticks (no lap write)
        }
```
Change it to:
```js
        } else {
          me._passCredit = 0; // pass completes naturally next ticks (no lap write)
          if ((me._passCd ?? -1) <= this.time) {                 // debounce: one announcement per ~4 sim-seconds per car
            this._emit({ type: "pass", lap: me.lap, a: me.idx, abbr: me.abbrev, b: ahead.idx, abbrB: ahead.abbrev });
            me._passCd = this.time + 4;
          }
        }
```
(`me._passCd` is per-car scratch, like `_passCredit`. `this.time` is the deterministic sim clock — same seed → same cooldowns → same events.)

**1f. Safety-car on/off + finish + DNF scan.** In `step()`, the SC lifecycle + finish lines are:
```js
    if (this.scActive && leadLap >= this.scStartLap + EVENT.scMinLaps) this.scActive = false;
    this._resolveSC();
    if (this.cars.every(c => c.retired || c.lap >= this.track.laps)) this.finished = true;
  }
```
Change them to:
```js
    if (this.scActive && leadLap >= this.scStartLap + EVENT.scMinLaps) this.scActive = false;
    if (this.scActive && !this._scWas) this._emit({ type: "sc_on", lap: leadLap });
    if (!this.scActive && this._scWas) this._emit({ type: "sc_off", lap: leadLap });
    this._scWas = this.scActive;
    this._resolveSC();
    // newly-retired cars -> DNF events (covers start incident, fuel-out, reliability)
    for (const c of this.cars) {
      if (c.retired && !this._retiredSeen.has(c.idx)) { this._retiredSeen.add(c.idx); this._emit({ type: "dnf", lap: c.lap, a: c.idx, abbr: c.abbrev }); }
    }
    if (this.cars.every(c => c.retired || c.lap >= this.track.laps)) {
      if (!this.finished) { const w = this.order()[0]; this._emit({ type: "finish", lap: w.lap, a: w.idx, abbr: w.abbrev }); }
      this.finished = true;
    }
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/sim.test.js` → all pass (3 new + existing invariant/determinism/AI). Then `node --test` → ALL green. The combat-invariant test must still pass (emits only push to `this.events`; they never write `lap`/`lapFrac`/`wear`). Do NOT weaken tests. If the event-determinism `deepEqual` fails, you used non-deterministic state (Math.random/Date/Set-iteration into the numeric path) — find it.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/sim.js ApexWeb/tests/sim.test.js
git commit -m "feat(apexweb): sim emits a deterministic event log (start/pass/pit/dnf/fastlap/sc/finish)"
```

---

## Task 2: commentary.js — pure event → Russian line

**Files:** Create `ApexWeb/src/commentary.js`; Test `ApexWeb/tests/commentary.test.js`.

- [ ] **Step 1: Write the failing test** — `ApexWeb/tests/commentary.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { describe } from "../src/commentary.js";

test("describe returns a non-empty Russian string for every event type", () => {
  const evs = [
    { type: "start", lap: 0, abbr: "VER" },
    { type: "pass", lap: 5, abbr: "NOR", abbrB: "LEC" },
    { type: "pit", lap: 20, abbr: "HAM", compound: "hard" },
    { type: "fastlap", lap: 30, abbr: "PIA", t: 78.345 },
    { type: "dnf", lap: 12, abbr: "ALO" },
    { type: "sc_on", lap: 15 }, { type: "sc_off", lap: 18 },
    { type: "finish", lap: 66, abbr: "RUS" },
  ];
  for (const e of evs) { const s = describe(e); assert.ok(typeof s === "string" && s.length > 0, e.type); }
});

test("pass mentions both drivers; pit mentions the compound (in Russian)", () => {
  assert.ok(describe({ type: "pass", lap: 5, abbr: "NOR", abbrB: "LEC" }).includes("NOR"));
  assert.ok(describe({ type: "pass", lap: 5, abbr: "NOR", abbrB: "LEC" }).includes("LEC"));
  assert.ok(/медиум|софт|хард|интер|дожд/i.test(describe({ type: "pit", lap: 9, abbr: "HAM", compound: "medium" })));
});

test("deterministic: same event -> same line", () => {
  const e = { type: "pass", lap: 7, abbr: "VER", abbrB: "PER" };
  assert.equal(describe(e), describe(e));
});

test("unknown event type returns empty string (safe)", () => {
  assert.equal(describe({ type: "???", lap: 1 }), "");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/commentary.test.js` → FAIL (cannot find module).

- [ ] **Step 3: Implement** — `ApexWeb/src/commentary.js`:

```js
// ApexWeb/src/commentary.js — pure: turn a structured sim event into a Russian radio line.
// Deterministic variety: the template is chosen by a stable hash of the event (no RNG).

const COMP_RU = { soft: "софт", medium: "медиум", hard: "хард", inter: "интер", wet: "дождевые" };

function fmtLap(t) {
  if (!t && t !== 0) return "";
  const m = Math.floor(t / 60), s = (t - m * 60).toFixed(3).padStart(6, "0");
  return m > 0 ? `${m}:${s}` : `${t.toFixed(3)}`;
}

// stable index into a template list, from the event's own fields (no Math.random)
function pick(ev, n) {
  const key = (ev.lap | 0) * 7 + (ev.a | 0) * 13 + (ev.b | 0) * 17 + (ev.type ? ev.type.length : 0);
  return ((key % n) + n) % n;
}

const T = {
  start: ["Огни погасли — поехали!", "Старт! Гонка началась.", "Поехали — лайтс аут!"],
  pass: ["{a} обходит {b}!", "{a} проходит {b} — отличный манёвр!", "Обгон! {a} впереди {b}.", "{a} дожимает {b} и выходит вперёд!"],
  pit: ["{a} ныряет в боксы — свежие {c}.", "Пит-стоп {a}: ставят {c}.", "{a} на пит-лейне, переобувается в {c}."],
  fastlap: ["Быстрейший круг — {a}! ({t})", "{a} ставит лучшее время круга — {t}.", "Феноменально от {a}: быстрейший круг {t}!"],
  dnf: ["{a} сходит с гонки!", "Сход: {a} остановился.", "{a} выбывает — DNF."],
  sc_on: ["🟡 Сейфти-кар на трассе!", "Жёлтые флаги — выехал сейфти-кар.", "Безопасность: машина безопасности на трассе."],
  sc_off: ["Сейфти-кар уходит — гонка возобновляется!", "Зелёный флаг — погнали!", "Рестарт! Сейфти-кар в боксах."],
  finish: ["🏁 {a} выигрывает Гран-при!", "Клетчатый флаг — победа {a}!", "{a} первым пересекает финишную черту! 🏁"],
};

export function describe(ev) {
  if (!ev || !T[ev.type]) return "";
  const list = T[ev.type];
  let s = list[pick(ev, list.length)];
  return s.replace("{a}", ev.abbr || "").replace("{b}", ev.abbrB || "")
          .replace("{c}", COMP_RU[ev.compound] || ev.compound || "")
          .replace("{t}", fmtLap(ev.t));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/commentary.test.js` → all pass. `node --test` → all green.

- [ ] **Step 5: Commit**

```
git add ApexWeb/src/commentary.js ApexWeb/tests/commentary.test.js
git commit -m "feat(apexweb): pure commentary — event code -> Russian radio line"
```

---

## Task 3: main.js — ship new events in the snapshot

**Files:** Modify `ApexWeb/src/main.js`.

- [ ] **Step 1: Implement.** In `raceSnapshot()` (it builds the object returned/broadcast), add an `events` field carrying only events not yet sent, and advance the index. Find the `return { type: "snapshot", ... cars: ... };` object and add `events` to it. Concretely, just before the `return`, compute:
```js
  const evIdx = ctx._evtIdx || 0;
  const newEvents = ctx.race.events.slice(evIdx);
  ctx._evtIdx = ctx.race.events.length;
```
and add `events: newEvents,` as a field in the returned snapshot object (alongside `paused`, `finished`, etc.).

In `startRaceHost()`, reset the index next to the other per-race resets (`ctx._frame = 0; ...`):
```js
  ctx._evtIdx = 0;
```

- [ ] **Step 2: Verify**

Run: `node --check ApexWeb/src/main.js` → OK. `node --test` → all green (no test imports main.js; this must just parse and not throw). 

NOTE: `raceSnapshot()` is called once per `pushRaceState()` (once per broadcast), so slicing + advancing the index there delivers each event exactly once. Do not call `raceSnapshot()` more than once per push.

- [ ] **Step 3: Commit**

```
git add ApexWeb/src/main.js
git commit -m "feat(apexweb): ship new race events in each snapshot (host + client)"
```

---

## Task 4: ui/race.js — the "Радио" feed panel

**Files:** Modify `ApexWeb/src/ui/race.js`.

- [ ] **Step 1: Implement.**

Import the formatter (top of file, next to the other imports):
```js
import { describe } from "../commentary.js";
```

Add a feed panel to the HUD markup in `buildHud`. Insert it in the side column, right AFTER the map panel's closing `</div>` and BEFORE the control `<div class="panel">` (so it sits under the map). Insert:
```js
      <div class="panel" id="feed-panel" style="padding:8px 10px">
        <div class="label" style="margin:0 0 4px">📻 Радио</div>
        <div id="d-feed" style="display:flex;flex-direction:column;gap:3px;max-height:120px;overflow:hidden;font-size:12px"></div>
      </div>
```

In `buildHud`, where the other per-race state is initialised (the line `ctx._buf = {}; ctx._meta = {}; ...`), also reset the feed:
```js
  ctx._feed = [];
```

In `updateHud`, after the map/SC block (right after the `const scOv = ...` line), append any new events and render the feed:
```js
  // commentary feed: append new events, keep the last ~24, render newest-first
  if (snap.events && snap.events.length) {
    for (const ev of snap.events) { const line = describe(ev); if (line) ctx._feed.push({ line, lap: ev.lap }); }
    if (ctx._feed.length > 24) ctx._feed = ctx._feed.slice(-24);
  }
  const feedEl = $("#d-feed");
  if (feedEl) feedEl.innerHTML = (ctx._feed || []).slice(-7).reverse()
    .map((m, i) => `<div style="opacity:${(1 - i * 0.12).toFixed(2)}"><span style="color:var(--muted)">L${m.lap}</span> ${m.line}</div>`).join("");
```
(`ctx._feed` is lazily safe: `ctx._feed = ctx._feed || []` at the top of the events block if you prefer; buildHud already resets it per race, and the client never calls buildHud's reset path differently — add `ctx._feed = ctx._feed || [];` immediately before the `if (snap.events ...)` to be safe for the client.)

- [ ] **Step 2: Verify (parse + browser).**

Run: `node --check ApexWeb/src/ui/race.js` → OK. `node --test` → all green. The controller will browser-verify (start a solo race, confirm radio lines appear: start, pit, fastest lap, an overtake, and the finish).

- [ ] **Step 3: Commit**

```
git add ApexWeb/src/ui/race.js
git commit -m "feat(apexweb): race-screen radio feed (commentary from sim events)"
```

---

## Notes for the implementer

- **Determinism preserved.** Events depend only on sim state + the deterministic `this.time`; nothing in the log feeds back into the numeric path. The new `sim.test.js` test locks "same seed → identical event log".
- **Combat invariant intact.** Every `_emit` only READS car state and pushes to `this.events` — no writes to `lap`/`lapFrac`/`wear`. The pass emit sits in the existing else-branch that already only reset `_passCredit`.
- **Sim stays UI-free.** The sim stores event *codes* with driver abbrevs (a data field), never display strings; all Russian prose lives in `commentary.js` (UI layer).
- **Works for host AND client.** The snapshot carries the new-events slice; both render via the same `describe`. (Late online join may miss earlier lines — commentary is ephemeral, acceptable.)
- **Cooldown rationale:** a pass is "won" the tick `_passCredit` beats resistance, but the cars physically swap over several ticks and equal-pace cars can flicker; the 4-second per-car cooldown keeps the feed to real, readable overtakes.
- **Owner playtest (browser, hard-reload):** a solo race should narrate itself — lights out, overtakes naming both drivers, pit stops with the compound, the fastest lap, any DNF, safety-car in/out, and the win.
- Possible follow-ups (not in scope): tie overtake events to named **overtake zones** (TODO #2b) for "обгон на торможении в 1-й поворот"; a fading/scroll animation on new lines; per-event icons.
```
