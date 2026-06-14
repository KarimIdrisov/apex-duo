# ApexWeb Qualifying Depth — Design Spec

**Date:** 2026-06-14
**Status:** approved (design), pending implementation plan
**Area:** ApexWeb live Qualifying (`src/quali.js`, `src/quali_session.js`, `src/main.js`, `src/ui/quali.js`, `src/data.js`, `style.css`)

## Goal

Make Qualifying harder and more interesting — turn the flying lap from a one-shot resolve-and-watch into a **live, sector-by-sector lap the player manages under execution risk**, tie it to the practice **track knowledge**, and redesign the screen for desktop. Owner direction (F5 round-2): "сложнее и интереснее, больше агентности, не просто смотреть"; tie in the new track knowledge; PC layout.

## Why it's flat today

The flying lap resolves as a single `qualiLap` call at lap completion. The only player input is a binary push (steady/attack) chosen at release; then you watch. There is no live agency, no per-sector drama, no real cost of error, and practice doesn't affect quali at all.

## Decisions (owner-approved)

- **Core:** a **live flying lap over 3 sectors** with **execution risk**, gated by **track knowledge** (from practice). Not out-lap-prep, not tow-timing as the core (possible later layers).
- **Agency:** live — the player sets push **per sector** and can **save** (back off) mid-lap.
- **Mistakes:** lock-up → +time in that sector; a big off → **the lap is deleted** (run scrapped).
- **Layout:** Variant A — full-width header, timing tower LEFT (wide), live-lap card RIGHT; wide `#app`, collapses to one column ≤760px.

## 1. Live sector flying lap

When a car is in the `flying` phase it advances through **3 sectors** in game-time (each ≈ `TRACK.lt / 3` game-seconds), instead of resolving the whole lap at once.

- On entering `flying` (from the out-lap), stamp the lap's **clean base time** once: `base = qualiLapClean(drv, car, TRACK, setupBonus, carMean, {grip, tyre, traffic, yellow})` — all the deterministic `qualiLap` terms (track.lt + compound + skill + car + grip + tyre + traffic + yellow + setup) with **no push/risk/noise**. Reset `sector=0, secAcc=0, lapSectors=[]`.
- `qualiStep` advances a flying car by **sectors**: `secAcc += adv`; while `secAcc ≥ SECTOR_SEC` complete the current sector via `completeSector`. Out-lap / in-lap still advance by whole laps as today.
- **`completeSector`** computes the sector time + a risk event (see §2), pushes it to `lapSectors`. On the 3rd sector done: lap time = `Σ lapSectors`; update `bestTime`/`segBest`; then the existing run logic (a fresh run does a 2nd flying lap, `lapsThisRun<2 && tyre==="fresh" → used`, else → in-lap). A deleted lap (§2) sends the car straight to in-lap with no time.

**`qualiSector` (new, in `quali.js`):**
```
export function qualiSector(base, frac, push, trackKnow, rng) {
  const pushN = push / 3;                                  // push 0..3 → 0..1
  const safety = 1 - QUALI2.TRACK_SAFETY * trackKnow;      // track knowledge tightens risk + variance
  let s = base * frac;                                     // this sector's share of the clean lap
  s -= QUALI2.PUSH_GAIN * frac * pushN;                    // pushing this sector = faster (∝ sector size)
  s += rng.noise((QUALI2.SEC_VAR_BASE + QUALI2.SEC_VAR_PUSH * pushN) * safety);   // variance, tightened by trackKnow
  let event = null;
  const r = rng.unit();
  const offChance  = QUALI2.OFF_BASE  * pushN * pushN * safety;   // big mistake (push²) → lap deleted
  const lockChance = QUALI2.LOCK_BASE * pushN * safety;           // small mistake → +time
  if (r < offChance) event = "off";
  else if (r < offChance + lockChance) { event = "lockup"; s += rng.range(QUALI2.LOCK_MIN, QUALI2.LOCK_MAX); }
  return { time: s, event };
}
```
`qualiLap` (legacy) is refactored to `qualiLapClean(...) + the existing risk/noise/mistake` so `buildGrid` and its tests keep working unchanged; the live session uses `qualiLapClean` + `qualiSector`.

## 2. Execution risk + track-knowledge gate

Each sector rolls a stateless, per-sector risk event keyed to `lapRng(s, car.idx, car.lapIdx*10 + sector)` (deterministic across speeds, like the existing flag/traffic rolls):

- **Lock-up** (small): `+QUALI2.LOCK_MIN..LOCK_MAX s` in that sector. Frequency rises with push.
- **Off / spin** (big): the **lap is deleted** — `completeSector` marks `lapDeleted`, the car drops to `inlap` immediately, no time recorded (the soft set, if fresh, is still consumed). Frequency ∝ `push²` → only a real gamble at max push.
- **Variance**: sector noise widens with push.

**Track knowledge** (`car.trackKnow` ∈ [0,1], from practice) multiplies all three down via `safety = 1 - TRACK_SAFETY·trackKnow`: a well-practiced driver (high trackKnow) runs tight, clean sectors; one who skipped practice (low trackKnow) has wild variance and frequent deletions. AI cars use `PRAC2.AI_TRACK_KNOW` (0.7). **Always-safe out:** at push 0 (save) `offChance`/`lockChance` are ~0, so a cautious player always sets a valid (if slow) time — no one is auto-eliminated by bad luck.

## 3. Push control (live, per sector)

Four levels: **0 save · 1 steady · 2 attack · 3 max** on `car.push`, default steady. The player changes it any time via `quali_push {player, level}`; it applies to the sector currently being driven and the rest. **Save (0)** drops risk to ~0 for the remaining sectors — the "secure the lap" button when a sector went bad or you're protecting a banker. Higher push = faster mean but more variance + mistake/delete chance. AI sets push deterministically (attack on banker/final runs; max only on a last desperate run when behind the cut).

## 4. Track-knowledge into the quali field + UI (Variant A)

- **Field:** `qualiField()` in `main.js` attaches `trackKnow` per car — player: `pracTrackKnow(player)`; AI: `PRAC2.AI_TRACK_KNOW`. `newQuali` stores it on each car; `qualiSector` reads it.
- **Snapshot:** the per-player block adds `sector` (0..3), `lapSectors` (the completed sector times this lap), `push` (0..3), and a transient `lapDeleted` flag (for a flash). The tower is unchanged.
- **Screen (`ui/quali.js` + `style.css`):**
  - Full-width header: segment (Q1/Q2/Q3), clock, grip read, flag banner, ×1/2/4/8 + pause (existing).
  - **Left (wide):** the 22-row timing tower with the drop-zone cut line (existing).
  - **Right:** the **live-lap card** — current sector + the three sector times (each coloured vs the car's best-lap sector: green = personal best, neutral otherwise; "—" until run), running lap time + delta vs the car's best; the **push control** (4-level segment → `quali_push`); tyre (fresh/used), release / abort; traffic cue + partner (existing).
  - Practice and quali both use the wide `#app`; `@media ≤760px` collapses the grid to one column.
  - The 15Hz repaint gate (`liveSig` quali branch) must include `sector`, `push`, and the lap-sector progress so the live card updates on sector completions while the clock patches in place.

## Const summary (QUALI2 additions)

`PUSH_GAIN` (s/lap save→max), `TRACK_SAFETY` (0..1, how much trackKnow cuts risk/variance), `SEC_VAR_BASE`, `SEC_VAR_PUSH`, `OFF_BASE`, `LOCK_BASE`, `LOCK_MIN`, `LOCK_MAX`. Reuse `PRAC2.AI_TRACK_KNOW`. Sector duration = `TRACK.lt / 3` (no const needed) or a `SECTOR_FRAC` array if uneven sectors are wanted (start equal thirds).

Starting magnitudes (tune in the corridor): `PUSH_GAIN 0.6` (save→max ≈ 0.6s/lap), `TRACK_SAFETY 0.7` (trackKnow 1 cuts risk/variance to 30%), `SEC_VAR_BASE 0.03`, `SEC_VAR_PUSH 0.10`, `OFF_BASE 0.05` (max push, trackKnow 0 → ~5%/sector ≈ 14%/lap off; trackKnow 1 → ~1.5%/sector), `LOCK_BASE 0.10`, `LOCK_MIN 0.2`, `LOCK_MAX 0.8`.

## File-by-file

- `src/data.js` — QUALI2 risk/push/variance consts.
- `src/quali.js` — extract `qualiLapClean`; add `qualiSector`; `qualiLap` = clean + existing risk (unchanged behaviour for `buildGrid`/tests).
- `src/quali_session.js` — flying car advances by sectors; `completeSector` (sector time + risk + lap finish/delete); car carries `sector`/`secAcc`/`lapSectors`/`push`/`trackKnow`/`lapDeleted`; `newQuali` seeds `trackKnow` per car; snapshot exposes the live-lap fields; a `setPush(s, player, level)` export.
- `src/main.js` — `qualiField()` attaches `trackKnow`; `quali_push` command → `setPush` + `pushQuali`; `liveSig` quali branch includes `sector`/`push`/lap progress; quali joins the wide-`#app` condition.
- `src/ui/quali.js` — 2-col dashboard (tower left, live-lap card right); sector deltas; push control.
- `style.css` — quali grid + live-lap card + push control + responsive collapse.
- Tests — `tests/quali_session.test.js`: sector lap completes (3 sectors → a lap time), a deleted lap records no time + scraps the run, track knowledge reduces deletion rate, push raises mean speed + risk, determinism (same seed+push → identical). `tools/balance.mjs`: grid still realistic (all classified, pole→P22 ~1.5-5s) AND a deletion-rate corridor (low trackKnow + max push deletes much more than high trackKnow; a save-policy always sets a time).

## Verification

- **Unit (Node):** a flying lap completes through 3 sectors into a summed time; `qualiSector` faster mean at higher push; `off` event deletes the lap (no time, run scrapped); `TRACK_SAFETY` makes high-trackKnow deletion rate ≪ low-trackKnow; deterministic across speeds (sector RNG keyed to lapIdx·10+sector).
- **Balance corridor:** all 22 classified each session; pole→P22 spread stays ~1.5-5s (not chaos); deletion rate at (trackKnow 0, max push) ≫ (trackKnow 1, attack); a pure-save policy never fails to set a time.
- **In-browser (cache-busted + solo drive):** the live-lap card shows sector deltas updating per sector; push control changes `car.push` (host); a deleted lap flashes + scraps the run; controls stay clickable (the gate); 2-col layout on desktop, collapses ≤760px.

## Out of scope / deferred

- Out-lap tyre-prep mini-game and slipstream/tow timing (possible later layers).
- Track-limits "deleted lap" as a separate cause beyond the off (the off covers it).
- Per-sector *track characteristics* (different risk per real sector) — start with equal thirds + uniform risk.

## Open questions for the plan

None blocking. Magnitudes (`PUSH_GAIN`, `TRACK_SAFETY`, `OFF_BASE`/`LOCK_BASE`, variance) are starting points to tune against the corridor; sequence the math (qualiLapClean/qualiSector) + corridor before the UI so numbers are locked first.
