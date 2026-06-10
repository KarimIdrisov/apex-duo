# Apex Duo — code audit backlog (2026-06-10)

Findings from a deep 3-part audit (sim core, meta layer, UI/netcode). Determinism
discipline confirmed intact (no real-time/`randf`/unordered-dict-into-sim). Ordered
roughly by impact; execution order is the numbered task list below.

## Execution order (tasks)
1. **Dead-code purge.** race_sim: fictional-track generator (`ARCHETYPES`, `ARCH_NAMES/ORDER/LABELS`, `_jit`, `generate_track`, `generate_calendar`, ~120 lines, only used by each other). main.gd: `_on_pace`/`_on_intent`/`net_set_pace`/`net_set_intent` (orphaned after radio calls). race_view_3d: `enable_split`/`_vp_side` split machinery (never called). season_setup: `_spacer` (unused). season: legacy `buy_aero`/`buy_energy`/`cost_aero`/`cost_energy` if unreferenced by the hub.
2. **Save on paddock exit (data loss).** `season_hub.gd` "Выйти в меню" nulls `Season.active` without saving → R&D/contract spend since entry is lost. Save on exit (and/or after each purchase).
3. **`energy_bonus` 0.03 vs 0.06 inconsistency.** `_sync_legacy_steps` uses 0.03; `buy_energy`/load use 0.06 → display/save mismatch after buying parts. Unify.
4. **Wire dead tyre/energy R&D into the sim.** `team_wear_mult`/`team_soc_max`/`team_harvest_mult` have no callers; tyre-R&D (up to −36% wear) and the SoC bump are purchasable but do nothing. Set `d.wear_mult`/`d.soc_max` for team cars in main.gd's season-car loop (or fold into the PARTS/car model). Update CLAUDE.md's stale "R&D decoupled" note.
5. **Clamp safety car vs race end.** A late scheduled or causal incident SC can strand the race finishing behind the SC. Clamp `sc_deploy_lap`/`sc_until_lap` against `track.laps` (or suppress causal SC in the final laps).
6. **Reconcile `COLD_TEMP`/`HOT_TEMP` with per-compound windows.** The radio ("шины холодные") + incident-risk cold/hot flags still use global 0.45/0.90, now inconsistent with each compound's `tlo`/`thi`. Derive the flags from the compound window; drop the now-stale globals.
7. **Unify the "leader" computation.** `step` (`order()[0]`), `_update_safety_car` (own sort), `_update_weather` (own `lap`-only scan) each derive the leader differently and can disagree. Compute once per `step()` and pass in.
8. **Promote magic numbers to consts + fix doc drift.** `current_laptime`/radio cluster of inline tunables (fuel 0.018, wear 0.012, cliff 0.10, yield 0.8, overheat 0.5, radio wear 86/66) → named consts per CLAUDE.md convention. Promote `_pass_resist` `3.0`/`8.0` to `PASS_RESIST_BASE/K`; fix stale `4.0+9.0` in docs.
9. **Show live wetness in the HUD.** `sim.wetness`/`snapshot["wet"]` is shipped but never displayed → player can't make the wet-tyre call. Add a wetness label/bar.
10. **Co-op client robustness.** Rebuild/relabel the client control panel on `net_assign`/first snapshot (built before snapshot → empty name/wrong id); send the first snapshot reliably; hide/disable time-control + restart buttons for clients (currently live-looking no-ops).
11. **Local co-op control layout.** Two full driver panels + team panel + feed in one 358px vertical scroll → the Engineer's P6 controls can be scrolled out of reach while the Director uses P5. Side-by-side (or per-player) for local co-op.
12. **`driver_profile` back button pinned.** "← В паддок" is inside the scrolled column → scrolls away on a long grid. Pin outside the scroll (as hub/stats do).
13. **`apply_results` `is_complete` guard.** No guard → calling it after the final round keeps incrementing `round_index`, paying salaries, accruing cap penalties past `calendar.size()`.
14. **Lower-priority polish (batch):** transfer market actually swaps the driver identity (currently salary-only); personnel `engineer_telemetry/rapport/test_feedback` dead + staff seed always 0 (wire or remove); verify 3D `global_transform` math in-engine (#90188 reliance); perf — compute `_pit_path()` once per `_draw`; `track_map` use `TrackShapes.loop_for` to de-dup shapes; `apply_results`/`record_race` fold together to avoid out-of-sync; persist `grid_names` for save integrity; add a save `version` key; `_resolve_combat` snapshot progresses before mutating (train edge); CLAUDE.md R&D note; segment-population guard in `generate_track`/`Track.new` (dead path, cheap safety).

## Notes
- **Verified clean / not bugs:** `set_pace`/`set_intent` (alive via net), `TYRE_TEMP_GRID`, `_pass_resist`, clip hysteresis, div-by-zero (all guarded), save/load int→float quirk (handled), `mood`/`_eval_call` guards.
- **Shallow mechanics (future depth, not bugs):** qualifying is one flying lap (no Q1/Q2/Q3, no evolution/tow); weather is one triangular shower (no drying line / per-sector); `pu_health` & `aero_damage` are thin; tow vs pass-credit may double-count on power tracks (tune on real engine).
- **Missing roadmap features:** full cost cap (only soft salary cap), staff contracts, online season, lobby/role-selection.
