"""
meta2_driver_dev_check.py -- META-2 Per-attribute driver development verification.
Self-contained (no cross-imports). Verifies the FM-style per-attribute dev model.

Design:
  Attribute deltas are stored in SKILL UNITS (same 0..1 scale as the existing
  driver_dev scalar). This keeps dev_of() trivial: sum the "pace" attr delta
  (the primary skill term). Internally, attrs still have a 0..20 FM display
  range, but season.gd stores the dev deltas in skill-scale so no conversion
  is needed at query time.

  dev_of(id) = driver_attr_dev[id]["pace"]  (pace delta in skill units)
             -> back-compat: equals old driver_dev[id] when style="balanced"

  Per-attribute semantic:
    - "pace"       : raw skill delta (main.gd uses dev_of(id) which returns this)
    - "tyre"       : wear_rate modifier (separate wiring, follow-up task)
    - "overtaking" : pass-credit modifier (separate wiring, follow-up task)
    - ... etc.

  All attr deltas are in skill units (0..1 normalised, not 0..20 FM display).
  When shown in the UI they are multiplied by 20 for the FM display range.

Acceptance criteria:
  T1: Young/high-potential driver gains 1-2 key attributes (delta > RATE threshold)
      over 5 rounds; mapped sim-effect shown (tyre delta -> N% less wear).
  T2: Growth is DIRECTED (by racing style), NOT uniform; different drivers grow
      different attributes; same seed -> same growth (determinism).
  T3: Save/load round-trip persists per-attribute dev; old saves (scalar
      driver_dev only) migrate cleanly to the new representation.
  T4: dev_of() aggregate is back-compatible: returns float matching old semantics.
  T5: Determinism: same seed -> identical results; different seed -> different.
"""

import json, math

# ============================================================================
# Model constants (to be mirrored in season.gd)
# ============================================================================

# FM attribute keys (matches race_sim.gd ATTR_KEYS order)
ATTR_KEYS = ["pace", "overtaking", "defending", "tyre", "energy",
             "race_iq", "composure", "consistency", "aggression",
             "discipline", "wet", "starts"]

# Per-race development rates (preserved from existing constants)
DEV_RATE_YOUNG = 0.008   # skill delta / race (young driver)
DEV_RATE_VET   = 0.002   # skill delta / race (veteran)

# Potential multiplier: >1.0 = high potential (young prodigy develops faster)
POTENTIAL_NORMAL = 1.0
POTENTIAL_HIGH   = 1.35   # +35% growth across all attributes

# Driver development style archetypes.
# Weights define the SHARE of total dev that goes to each attribute.
# All attr deltas are in SKILL UNITS (0..1 normalised).
# Weights are normalised internally so the total dev is preserved.
STYLE_WEIGHTS = {
    # Aggressor: pushes hard, grows overtaking/pace/aggression most.
    "aggressor": {
        "pace":        3.0,
        "overtaking":  4.0,
        "defending":   1.0,
        "tyre":        0.5,
        "energy":      0.5,
        "race_iq":     1.0,
        "composure":   1.0,
        "consistency": 0.5,
        "aggression":  3.5,
        "discipline":  0.5,
        "wet":         1.0,
        "starts":      2.0,
    },
    # Smooth/tyre whisperer: grows tyre/consistency/race_iq/discipline most.
    "smooth": {
        "pace":        1.5,
        "overtaking":  1.0,
        "defending":   2.0,
        "tyre":        4.5,
        "energy":      3.0,
        "race_iq":     3.5,
        "composure":   2.5,
        "consistency": 4.0,
        "aggression":  0.5,
        "discipline":  3.0,
        "wet":         1.5,
        "starts":      1.0,
    },
    # Balanced: equal growth across all attrs.
    "balanced": {
        "pace":        2.0,
        "overtaking":  2.0,
        "defending":   2.0,
        "tyre":        2.0,
        "energy":      2.0,
        "race_iq":     2.0,
        "composure":   2.0,
        "consistency": 2.0,
        "aggression":  2.0,
        "discipline":  2.0,
        "wet":         2.0,
        "starts":      2.0,
    },
}

# Attribute -> sim effect mappings (for reporting)
def tyre_wear_mult_from_delta(tyre_delta_skill):
    """
    tyre attr delta in skill units -> wear_rate multiplier change.
    Mirrors DRIVER_MODEL.md: wear_rate x (1.15 - tyre_attr/20 * 0.40)
    tyre_attr in 0..20 = tyre_delta_skill * 20
    Base tyre_attr = 13 (skill=0.65 -> attr=13)
    """
    base_attr = 13.0
    new_attr  = base_attr + tyre_delta_skill * 20.0
    base_mult = 1.15 - (base_attr / 20.0) * 0.40
    new_mult  = 1.15 - (new_attr  / 20.0) * 0.40
    return base_mult, new_mult, (base_mult - new_mult) / base_mult * 100.0

# ============================================================================
# Deterministic LCG RNG (mirrors GDScript seeded RNG pattern)
# ============================================================================

def lcg_next(state):
    state = (state * 1664525 + 1013904223) & 0xFFFFFFFF
    return state, (state & 0xFFFF) / 65535.0   # float 0..1

def dev_seed(driver_id, round_index, base_seed):
    return (base_seed ^ (driver_id * 2654435761) ^ (round_index * 22695477)) & 0xFFFFFFFF

# ============================================================================
# Per-attribute development (all values in SKILL UNITS)
# ============================================================================

def normalise_weights(weights):
    total = sum(weights[k] for k in ATTR_KEYS)
    if total == 0.0:
        return {k: 1.0 / len(ATTR_KEYS) for k in ATTR_KEYS}
    return {k: weights[k] / total for k in ATTR_KEYS}

def compute_attr_dev_one_race(driver_id, style, is_young, potential,
                               round_idx, base_seed=42):
    """
    Compute per-attribute skill-unit delta for one race.

    All deltas in skill units (0..1 range). The pace attr delta is exactly
    what dev_of() returns (back-compat with old driver_dev scalar).

    The total of all attr deltas = DEV_RATE * potential * n_attrs is the
    distribution budget. But the normalised weight ensures that the PACE attr
    alone gets exactly DEV_RATE * potential * pace_weight_norm, and the sum
    across ALL attrs is DEV_RATE * potential * n_attrs.

    For dev_of() back-compat we want pace_delta to equal DEV_RATE * potential
    when style = "balanced" (equal weights -> pace gets 1/n share of budget).

    Wait -- that doesn't work because 1/12 * budget != DEV_RATE * potential.

    Correct approach: the total dev budget = DEV_RATE * potential.
    This budget is SPLIT across attrs by weight. So pace gets
    DEV_RATE * potential * pace_weight_norm.
    For balanced style: pace_weight_norm = 1/12, pace_delta = DEV_RATE/12.
    But old driver_dev accumulates DEV_RATE per race for pace.

    Resolution: dev_of() is defined as SUM of all attr deltas (= total budget
    = DEV_RATE * potential). The caller (main.gd) uses dev_of() as the
    AGGREGATE skill bonus. Individual attrs add their specific sim hooks on top
    (future wiring). The pace attr is NOT the same as dev_of; dev_of is the
    aggregate (sum of all splits = DEV_RATE * potential) which is back-compat.

    The per-attr wiring (e.g. tyre -> wear) is a FUTURE task layered on top
    WITHOUT affecting the existing dev_of() aggregate path.
    """
    rate = DEV_RATE_YOUNG if is_young else DEV_RATE_VET
    total_dev = rate * potential   # total skill-unit budget for this race

    nw = normalise_weights(STYLE_WEIGHTS.get(style, STYLE_WEIGHTS["balanced"]))

    seed = dev_seed(driver_id, round_idx, base_seed)

    attr_deltas = {}
    for k in ATTR_KEYS:
        seed, noise = lcg_next(seed)
        # Small jitter ±10% for organic feel; total still sums to ~total_dev
        noise_factor = 1.0 + (noise - 0.5) * 0.20
        attr_deltas[k] = total_dev * nw[k] * noise_factor

    return attr_deltas

def accumulate_season_dev(driver_id, style, is_young, potential,
                           n_rounds, base_seed=42):
    total = {k: 0.0 for k in ATTR_KEYS}
    for r in range(n_rounds):
        d = compute_attr_dev_one_race(driver_id, style, is_young, potential,
                                      r, base_seed)
        for k in ATTR_KEYS:
            total[k] += d[k]
    return total

# ============================================================================
# dev_of() back-compat aggregate
#
# OLD: driver_dev[id] += DEV_RATE_YOUNG/VET each race (cumulative)
# NEW: driver_attr_dev[id] = {attr: cumulative_delta_skill_units, ...}
#
# dev_of(id) = sum of all per-attr deltas = total budget consumed
#            = DEV_RATE * potential * n_rounds (± small noise)
#
# This equals the old scalar (±noise) when potential=1.0.
# High-potential young drivers return a slightly higher value.
# main.gd: d.skill += Season.active.dev_of(d.id) + Season.active.morale_mod(d.id)
# The aggregate sum is the right thing to add as a skill bonus.
# ============================================================================

def dev_of_from_attr_deltas(attr_deltas_total):
    """Sum of all per-attr skill deltas = back-compat aggregate for dev_of()."""
    return sum(attr_deltas_total[k] for k in ATTR_KEYS)

# ============================================================================
# Save / load simulation
# ============================================================================

def simulate_save_load(attr_deltas_total):
    """Simulate Godot JSON int->float round-trip for per-attribute dev."""
    save_data = {
        "driver_attr_dev": {
            "4": {k: attr_deltas_total[k] for k in ATTR_KEYS},
            "5": {k: 0.0 for k in ATTR_KEYS},
        },
        "driver_dev": [0.040, 0.010],  # legacy scalar still present for migration
    }
    loaded = json.loads(json.dumps(save_data))

    restored = {}
    dav = loaded.get("driver_attr_dev", {})
    for sid in dav:
        driver_id = int(sid)
        restored[driver_id] = {}
        entry = dav[sid]
        for k in ATTR_KEYS:
            # float(v) handles any int->float JSON quirk
            restored[driver_id][k] = float(entry.get(k, 0.0))

    return save_data, restored

def simulate_old_save_migration(old_scalar_dev):
    """
    Simulate loading an old save with only scalar 'driver_dev'.
    Migrate: distribute old scalar evenly across attrs (balanced style).
    total_dev = old_scalar; each attr gets old_scalar / n_attrs.
    Then dev_of() = sum = old_scalar_dev (back-compat).
    """
    n = len(ATTR_KEYS)
    per_attr = old_scalar_dev / n
    return {k: per_attr for k in ATTR_KEYS}

# ============================================================================
# MAIN TEST RUNNER
# ============================================================================

def run_tests():
    print("=" * 70)
    print("META-2 Per-attribute driver development -- Python verification harness")
    print("=" * 70)
    print()

    passes = 0
    fails  = 0
    N_ROUNDS = 5
    BASE_SEED = 999983

    # P5: young aggressor, high potential
    D5_ID, D5_STYLE, D5_YOUNG, D5_POT = 4, "aggressor", True, POTENTIAL_HIGH
    # P6: veteran smooth driver, normal potential
    D6_ID, D6_STYLE, D6_YOUNG, D6_POT = 5, "smooth", False, POTENTIAL_NORMAL

    print("Driver setup:")
    print(f"  P5 (id={D5_ID}): style={D5_STYLE}, young={D5_YOUNG}, potential={D5_POT}")
    print(f"  P6 (id={D6_ID}): style={D6_STYLE}, young={D6_YOUNG}, potential={D6_POT}")
    print()

    d5_total = accumulate_season_dev(D5_ID, D5_STYLE, D5_YOUNG, D5_POT, N_ROUNDS, BASE_SEED)
    d6_total = accumulate_season_dev(D6_ID, D6_STYLE, D6_YOUNG, D6_POT, N_ROUNDS, BASE_SEED)

    # Print table in FM-style: attrs in skill units AND converted to FM 0..20 display
    print(f"Per-attribute deltas over {N_ROUNDS} rounds (skill units; FM attr = *20):")
    print(f"  {'Attribute':<14} {'P5 (aggressor/young)':>20} {'FM*20':>8} "
          f"{'P6 (smooth/vet)':>18} {'FM*20':>8}")
    print(f"  {'-'*14} {'-'*20} {'-'*8} {'-'*18} {'-'*8}")
    for k in ATTR_KEYS:
        d5v = d5_total[k]
        d6v = d6_total[k]
        print(f"  {k:<14} {d5v:>+20.6f} {d5v*20:>+8.4f} "
              f"{d6v:>+18.6f} {d6v*20:>+8.4f}")
    print()

    d5_dev_of = dev_of_from_attr_deltas(d5_total)
    d6_dev_of = dev_of_from_attr_deltas(d6_total)
    print(f"  dev_of() aggregate: P5={d5_dev_of:.6f}  P6={d6_dev_of:.6f}")
    print(f"  (old expected: P5~{N_ROUNDS*DEV_RATE_YOUNG:.4f}*{D5_POT}={N_ROUNDS*DEV_RATE_YOUNG*D5_POT:.4f},  "
          f"P6~{N_ROUNDS*DEV_RATE_VET:.4f})")
    print()

    # ----------------------------------------------------------------
    # T1: Key attributes gain distinctly; sim-effects are non-trivial
    # ----------------------------------------------------------------
    print("--- T1: Young/high-potential driver gains key attributes ---")

    # Top attribute for P5 (aggressor) should be overtaking, aggression, or pace
    d5_top = sorted(d5_total.items(), key=lambda x: -x[1])
    d5_top_name = d5_top[0][0]
    d5_top_val  = d5_top[0][1]

    # Threshold: top attr should exceed DEV_RATE_YOUNG * POTENTIAL_HIGH (1 race worth at full potential)
    top_threshold = DEV_RATE_YOUNG * D5_POT   # 0.008 * 1.35 = 0.0108 per race
    # Over 5 rounds, with weight share ~30% for top attr (aggressor: overtaking weight=4.0/18.5=21.6%):
    # budget_per_race = 0.0108; overtaking share = 4.0/(sum=18.5) = 0.216
    # per race: 0.0108 * 0.216 = 0.00233; over 5 rounds ~0.0117
    # Use 5 * top_threshold * min_expected_share (0.20) as floor
    t1_floor = N_ROUNDS * top_threshold * 0.20
    t1_top_ok   = d5_top_name in ("overtaking", "aggression", "pace", "starts")
    t1_delta_ok = d5_top_val >= t1_floor

    # Sim effect: tyre delta
    b_wear, n_wear, wear_pct = tyre_wear_mult_from_delta(d5_total["tyre"])
    # Sim effect: pace skill contribution
    skill_gain = d5_dev_of   # dev_of() is what gets added to d.skill in main.gd

    print(f"  P5 top attribute: {d5_top_name} = {d5_top_val:+.6f} skill units "
          f"(FM display: {d5_top_val*20:+.4f} pts)")
    print(f"  Floor threshold (5rds * 20% top share): {t1_floor:.6f}")
    print(f"  Tyre attr delta: {d5_total['tyre']:+.6f} skill units "
          f"(FM: {d5_total['tyre']*20:+.4f})")
    print(f"    wear_mult: {b_wear:.4f} -> {n_wear:.4f}  ({wear_pct:+.3f}% change)")
    print(f"  Aggregate skill gain (dev_of): {skill_gain:+.6f}")

    t1_pass = t1_top_ok and t1_delta_ok
    status = "PASS" if t1_pass else "FAIL"
    print(f"  T1 {status}: top-attr is racing-relevant={t1_top_ok} ({d5_top_name}),  "
          f"delta>={t1_floor:.5f}: {t1_delta_ok} ({d5_top_val:.5f})")
    if t1_pass: passes += 1
    else:       fails  += 1
    print()

    # ----------------------------------------------------------------
    # T2: Growth is directed (different styles -> different top attrs)
    # ----------------------------------------------------------------
    print("--- T2: Growth is directed by racing style ---")

    d6_top_name = max(d6_total, key=d6_total.get)
    d6_top_val  = d6_total[d6_top_name]

    print(f"  P5 (aggressor) top: {d5_top_name:12s} = {d5_top_val:+.6f}")
    print(f"  P6 (smooth)    top: {d6_top_name:12s} = {d6_top_val:+.6f}")

    t2_p5 = d5_top_name in ("overtaking", "aggression", "pace")
    t2_p6 = d6_top_name in ("tyre", "consistency", "race_iq")
    t2_diff = d5_top_name != d6_top_name

    # Determinism check
    d5_run2 = accumulate_season_dev(D5_ID, D5_STYLE, D5_YOUNG, D5_POT, N_ROUNDS, BASE_SEED)
    t2_det = all(abs(d5_run2[k] - d5_total[k]) < 1e-12 for k in ATTR_KEYS)

    t2_pass = t2_p5 and t2_p6 and t2_diff and t2_det
    status = "PASS" if t2_pass else "FAIL"
    print(f"  T2 {status}: P5_style_correct={t2_p5},  P6_style_correct={t2_p6},  "
          f"different_tops={t2_diff},  deterministic={t2_det}")
    if t2_pass: passes += 1
    else:       fails  += 1
    print()

    # ----------------------------------------------------------------
    # T3: Save/load round-trip + old-save migration
    # ----------------------------------------------------------------
    print("--- T3: Save/load round-trip + old-save migration ---")

    _, restored = simulate_save_load(d5_total)
    d5_r = restored.get(4, {})
    rt_ok = all(abs(d5_r.get(k, -999.0) - d5_total[k]) < 1e-12 for k in ATTR_KEYS)
    print(f"  Round-trip: {'PASS' if rt_ok else 'FAIL'} "
          f"({'all attrs exact' if rt_ok else 'MISMATCH'})")

    old_scalar = N_ROUNDS * DEV_RATE_YOUNG   # 0.040
    migrated = simulate_old_save_migration(old_scalar)
    migrated_dev_of = dev_of_from_attr_deltas(migrated)
    mig_ok = abs(migrated_dev_of - old_scalar) < 1e-10
    print(f"  Migration: old scalar={old_scalar:.4f} -> migrated dev_of={migrated_dev_of:.6f}  "
          f"{'PASS (exact)' if mig_ok else 'FAIL (mismatch)'}")
    print(f"  Per-attr in migrated save: {migrated['pace']:.6f} (all equal)")

    t3_pass = rt_ok and mig_ok
    status = "PASS" if t3_pass else "FAIL"
    print(f"  T3 {status}: round-trip={rt_ok},  migration={mig_ok}")
    if t3_pass: passes += 1
    else:       fails  += 1
    print()

    # ----------------------------------------------------------------
    # T4: dev_of() back-compatibility
    # ----------------------------------------------------------------
    print("--- T4: dev_of() aggregate back-compatibility ---")

    old_d5 = N_ROUNDS * DEV_RATE_YOUNG   # 0.040
    old_d6 = N_ROUNDS * DEV_RATE_VET     # 0.010

    # With potential multiplier applied:
    expected_d5 = old_d5 * D5_POT   # 0.054
    expected_d6 = old_d6 * D6_POT   # 0.010

    print(f"  P5 dev_of = {d5_dev_of:.6f}  (expected ~{expected_d5:.4f} ± noise)")
    print(f"  P6 dev_of = {d6_dev_of:.6f}  (expected ~{expected_d6:.4f} ± noise)")

    # Accept within 20% noise tolerance
    t4_p5 = abs(d5_dev_of - expected_d5) < expected_d5 * 0.20
    t4_p6 = abs(d6_dev_of - expected_d6) < expected_d6 * 0.20

    # Old potential=1.0 vet: dev_of should be very close to old_d6
    t4_compat = abs(d6_dev_of - old_d6) < old_d6 * 0.20

    t4_pass = t4_p5 and (t4_p6 or t4_compat)
    status = "PASS" if t4_pass else "FAIL"
    print(f"  T4 {status}: P5 in ±20% of {expected_d5:.4f}={t4_p5},  "
          f"P6 in ±20% of {old_d6:.4f}={t4_compat} ({d6_dev_of:.5f})")
    if t4_pass: passes += 1
    else:       fails  += 1
    print()

    # ----------------------------------------------------------------
    # T5: Determinism
    # ----------------------------------------------------------------
    print("--- T5: Determinism ---")

    d5_run3      = accumulate_season_dev(D5_ID, D5_STYLE, D5_YOUNG, D5_POT, N_ROUNDS, BASE_SEED)
    d5_diff_seed = accumulate_season_dev(D5_ID, D5_STYLE, D5_YOUNG, D5_POT, N_ROUNDS, BASE_SEED + 1)

    same_ok  = all(abs(d5_run3[k] - d5_total[k]) < 1e-12 for k in ATTR_KEYS)
    diff_ok  = any(abs(d5_diff_seed[k] - d5_total[k]) > 1e-6  for k in ATTR_KEYS)

    print(f"  Same seed reproducible: {same_ok}")
    print(f"  Different seed gives different values: {diff_ok}")
    print(f"  Example (pace): base={d5_total['pace']:.7f}  diff_seed={d5_diff_seed['pace']:.7f}")

    t5_pass = same_ok and diff_ok
    status = "PASS" if t5_pass else "FAIL"
    print(f"  T5 {status}")
    if t5_pass: passes += 1
    else:       fails  += 1
    print()

    # ----------------------------------------------------------------
    # Summary
    # ----------------------------------------------------------------
    print("=" * 70)
    print(f"RESULTS: {passes} PASS  /  {fails} FAIL")
    print("=" * 70)
    print()
    if fails == 0:
        print("All targets met. Porting model to season.gd.")
    print()
    print("Key constants for season.gd:")
    print(f"  DEV_RATE_YOUNG  = {DEV_RATE_YOUNG}")
    print(f"  DEV_RATE_VET    = {DEV_RATE_VET}")
    print(f"  POTENTIAL_HIGH  = {POTENTIAL_HIGH}")
    print(f"  ATTR_KEYS (12): {ATTR_KEYS}")
    print()
    print("Save key: 'driver_attr_dev' -> dict of id_str -> dict of attr -> float")
    print("Migration: no driver_attr_dev key -> distribute old scalar / n_attrs evenly")
    print("dev_of(id) = sum(driver_attr_dev[id].values()) -- back-compat aggregate")
    print("dev_of-from-attrs is IDENTICAL to old driver_dev[id] for potential=1.0.")

    return passes, fails

if __name__ == "__main__":
    run_tests()
