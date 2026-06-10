"""
car_components_check.py -- CAR-1 Component Car Model verification harness.
Self-contained (no cross-imports). Verifies:
  (a) Leveling a part raises exactly its target scalar by per_level (composition correct).
  (b) A fully-developed aero branch composes to ~= the old META-1 aero delta (no balance jump).
  (c) save/load round-trips part_levels + old-save migration maps to equivalent composed scalars.
  (d) The pace effect flows through the verified sim scalars (CAR_K relation).

All constants are mirrored from their GDScript equivalents.
"""

import json

# ============================================================================
# PARTS table (mirrors f1_2026.gd PARTS const)
# Layout: part_key -> {group, label, scalar, per_level, max_level, also, also_rel}
#
# Calibration targets from META-1:
#   Full aero branch:  total d_aero  = +0.150  (6 * RD_AERO_STEP=0.025)
#                      total d_ch_rel = +0.180  (6 * RD_AERO_REL_STEP=0.030)
#   Full PWT branch:   total d_power  = +0.050  (5 * RD_PWT_POWER_STEP=0.010)
#                      total d_energy = +0.050  (5 * RD_PWT_ENERGY_STEP=0.010)
#                      total d_eng_rel= +0.150  (5 * RD_PWT_REL_STEP=0.030)
#
# Aero group (3 parts x max_level=2 = 6 total levels == RD_AERO_MAX_STEPS):
#   front_wing: 2*0.030=0.060 aero,  2*0.030=0.060 ch_rel
#   rear_wing:  2*0.025=0.050 aero,  2*0.030=0.060 ch_rel
#   floor:      2*0.020=0.040 aero,  2*0.030=0.060 ch_rel
#   TOTAL:      0.150 aero, 0.180 ch_rel   [matches META-1 exactly]
#
# Power group (2 parts x max_level=2 = 4 total for 5 slots but levels max out):
#   ice:   2*0.015=0.030 power, 2*0.020=0.040 eng_rel
#   turbo: 2*0.010=0.020 power, 2*0.020=0.040 eng_rel
#   TOTAL at max: 0.050 power, 0.080 eng_rel
#
# Energy group (2 parts x max_level=2):
#   battery: 2*0.015=0.030 energy, 2*0.018=0.036 eng_rel
#   ers:     2*0.010=0.020 energy, 2*0.017=0.034 eng_rel
#   TOTAL at max: 0.050 energy, 0.070 eng_rel
#
# Combined power+energy eng_rel: 0.080 + 0.070 = 0.150  [matches META-1 exactly]
#
# Reliability group (bonus, beyond META-1):
#   gearbox: 2*0.025=0.050 ch_rel + tiny aero
#   cooling: 2*0.025=0.050 ch_rel + tiny power
# ============================================================================

PARTS = {
    # --- aero group ---
    "front_wing": {
        "group": "aero",
        "label": "Переднее крыло",
        "scalar": "d_aero",
        "per_level": 0.030,
        "max_level": 2,
        "also": {},
        "also_rel": {"d_ch_rel": 0.030},
    },
    "rear_wing": {
        "group": "aero",
        "label": "Заднее крыло",
        "scalar": "d_aero",
        "per_level": 0.025,
        "max_level": 2,
        "also": {},
        "also_rel": {"d_ch_rel": 0.030},
    },
    "floor": {
        "group": "aero",
        "label": "Днище",
        "scalar": "d_aero",
        "per_level": 0.020,
        "max_level": 2,
        "also": {},
        "also_rel": {"d_ch_rel": 0.030},
    },
    # --- power group ---
    "ice": {
        "group": "power",
        "label": "ДВС",
        "scalar": "d_power",
        "per_level": 0.015,
        "max_level": 2,
        "also": {},
        "also_rel": {"d_eng_rel": 0.020},
    },
    "turbo": {
        "group": "power",
        "label": "Турбо",
        "scalar": "d_power",
        "per_level": 0.010,
        "max_level": 2,
        "also": {},
        "also_rel": {"d_eng_rel": 0.020},
    },
    # --- energy group ---
    "battery": {
        "group": "energy",
        "label": "Батарея",
        "scalar": "d_energy",
        "per_level": 0.015,
        "max_level": 2,
        "also": {},
        "also_rel": {"d_eng_rel": 0.018},
    },
    "ers": {
        "group": "energy",
        "label": "MGU-K / ERS",
        "scalar": "d_energy",
        "per_level": 0.010,
        "max_level": 2,
        "also": {},
        "also_rel": {"d_eng_rel": 0.017},
    },
    # --- reliability group ---
    "gearbox": {
        "group": "reliability",
        "label": "КПП",
        "scalar": "d_ch_rel",
        "per_level": 0.025,
        "max_level": 2,
        "also": {"d_aero": 0.005},
        "also_rel": {},
    },
    "cooling": {
        "group": "reliability",
        "label": "Охлаждение",
        "scalar": "d_ch_rel",
        "per_level": 0.025,
        "max_level": 2,
        "also": {"d_power": 0.005},
        "also_rel": {},
    },
}

# META-1 R&D targets (full branch totals — must be preserved exactly)
META1_AERO_FULL_D_AERO    = 0.150   # 6 * 0.025
META1_AERO_FULL_D_CH_REL  = 0.180   # 6 * 0.030
META1_PWT_FULL_D_POWER    = 0.050   # 5 * 0.010
META1_PWT_FULL_D_ENERGY   = 0.050   # 5 * 0.010
META1_PWT_FULL_D_ENG_REL  = 0.150   # 5 * 0.030

# META-1 step constants (for migration calculation)
RD_AERO_STEP       = 0.025
RD_AERO_MAX_STEPS  = 6
RD_AERO_REL_STEP   = 0.030
RD_PWT_POWER_STEP  = 0.010
RD_PWT_ENERGY_STEP = 0.010
RD_PWT_MAX_STEPS   = 5
RD_PWT_REL_STEP    = 0.030

# Baseline Williams car (from f1_2026.gd — team index 4)
BASE_ENGINE  = {"power": 0.88, "energy": 0.86, "rel": 0.93}
BASE_CHASSIS = {"aero":  0.74, "rel": 0.92}

# CAR_K bias constant (from race_sim.gd)
CAR_K = 2.5

# Track definitions
MONACO      = {"name": "Monaco",      "df": 0.97, "pw": 0.20}
MONZA       = {"name": "Monza",       "df": 0.15, "pw": 0.97}
SILVERSTONE = {"name": "Silverstone", "df": 0.85, "pw": 0.62}

TOLERANCE = 1e-9


# ============================================================================
# compose_part_deltas: mirrors f1_2026.gd static func compose_part_deltas()
# ============================================================================

def compose_part_deltas(levels: dict) -> dict:
    """Sum contributions from all part levels -> {d_aero, d_power, d_energy, d_ch_rel, d_eng_rel}."""
    out = {"d_aero": 0.0, "d_power": 0.0, "d_energy": 0.0, "d_ch_rel": 0.0, "d_eng_rel": 0.0}
    for key, lvl in levels.items():
        if key not in PARTS:
            continue
        p = PARTS[key]
        lvl = max(0, min(lvl, p["max_level"]))
        out[p["scalar"]] += p["per_level"] * lvl
        for sk, sv in p.get("also", {}).items():
            if sk in out:
                out[sk] += sv * lvl
        for rk, rv in p.get("also_rel", {}).items():
            if rk in out:
                out[rk] += rv * lvl
    return out


def max_levels_for_group(group: str) -> dict:
    """Return a levels dict with all parts in a group at their max level."""
    return {k: v["max_level"] for k, v in PARTS.items() if v["group"] == group}


def sum_deltas(*dicts):
    """Merge delta dicts by summing corresponding keys."""
    out = {"d_aero": 0.0, "d_power": 0.0, "d_energy": 0.0, "d_ch_rel": 0.0, "d_eng_rel": 0.0}
    for d in dicts:
        for k in out:
            out[k] += d.get(k, 0.0)
    return out


def car_from_deltas(deltas: dict) -> dict:
    """Apply deltas to the baseline Williams car."""
    return {
        "power":   BASE_ENGINE["power"]   + deltas["d_power"],
        "aero":    BASE_CHASSIS["aero"]   + deltas["d_aero"],
        "energy":  BASE_ENGINE["energy"]  + deltas["d_energy"],
        "rel":     min(0.99, BASE_ENGINE["rel"] + deltas["d_eng_rel"])
                   * min(0.99, BASE_CHASSIS["rel"] + deltas["d_ch_rel"]),
        "eng_rel": min(0.99, BASE_ENGINE["rel"] + deltas["d_eng_rel"]),
        "ch_rel":  min(0.99, BASE_CHASSIS["rel"] + deltas["d_ch_rel"]),
    }


def car_bias(car: dict, track: dict) -> float:
    """CAR_K bias: (power - aero) * (track_pw - track_df) * CAR_K. Higher = faster."""
    return (car["power"] - car["aero"]) * (track["pw"] - track["df"]) * CAR_K


def pace_gain_s(base_c: dict, upg_c: dict, track: dict) -> float:
    """s/lap gained by upgrade vs baseline (positive = faster)."""
    return car_bias(upg_c, track) - car_bias(base_c, track)


def meta1_deltas(aero_steps: int, pwt_steps: int) -> dict:
    """Compute META-1 composed deltas directly from step counts."""
    a = max(0, min(aero_steps, RD_AERO_MAX_STEPS))
    p = max(0, min(pwt_steps,  RD_PWT_MAX_STEPS))
    return {
        "d_aero":    a * RD_AERO_STEP,
        "d_power":   p * RD_PWT_POWER_STEP,
        "d_energy":  p * RD_PWT_ENERGY_STEP,
        "d_ch_rel":  a * RD_AERO_REL_STEP,
        "d_eng_rel": p * RD_PWT_REL_STEP,
    }


# ============================================================================
# MIGRATION: old car_aero_steps/car_pwt_steps -> part_levels
#
# The migration goal is: composed deltas from migrated part_levels should
# closely match META-1 deltas. Exact matching at boundary (0, max) is
# guaranteed by design. For intermediate steps we aim for a proportional
# mapping that is close enough (within rounding of one level).
#
# Aero slot map: 6 old steps map to 6 part-level increments.
# The slot sequence distributes across parts evenly (one level per part
# in round-robin order), so partial investment distributes fairly.
#   slot 0 -> front_wing level 1 (contributes 0.030 aero, 0.030 ch_rel)
#   slot 1 -> rear_wing  level 1 (contributes 0.025 aero, 0.030 ch_rel)
#   slot 2 -> floor      level 1 (contributes 0.020 aero, 0.030 ch_rel)
#   slot 3 -> front_wing level 2 (contributes 0.030 aero, 0.030 ch_rel)
#   slot 4 -> rear_wing  level 2 (contributes 0.025 aero, 0.030 ch_rel)
#   slot 5 -> floor      level 2 (contributes 0.020 aero, 0.030 ch_rel)
# Full 6 slots: 0.060+0.050+0.040=0.150 aero, 6*0.030=0.180 ch_rel. Exact.
# Partial (e.g. 2 steps): 0.030+0.025=0.055 vs meta1=2*0.025=0.050 (diff 0.005 ~ 1 pos/10)
#   This is acceptable rounding error; the car stays within ~5% of META-1 value.
#
# PWT slot map: 5 old steps map to power+energy part levels.
# Power parts total capacity: 2+2=4 levels (< 5 steps).
# Energy parts total capacity: 2+2=4 levels (< 5 steps).
# At max (pwt=5), both groups are full (4/4 levels) so composed=META-1 exactly.
# For intermediate, map proportionally: ratio = pwt/5 -> each part level = round(ratio * max_level).
# Special case: partial steps are approximate but within rounding.
# ============================================================================

# Aero slot map: (part_key, level) for each old step slot
AERO_SLOT_MAP = [
    ("front_wing", 1), ("rear_wing", 1), ("floor", 1),
    ("front_wing", 2), ("rear_wing", 2), ("floor", 2),
]


def migrate_from_steps(aero_steps: int, pwt_steps: int) -> dict:
    """
    Convert old (car_aero_steps, car_pwt_steps) to part_levels.
    Returns a levels dict that approximates META-1 deltas for the given steps.
    Exact at step=0 and step=max; proportional rounding for intermediate values.
    """
    levels = {k: 0 for k in PARTS}
    aero_steps = max(0, min(aero_steps, RD_AERO_MAX_STEPS))
    pwt_steps  = max(0, min(pwt_steps,  RD_PWT_MAX_STEPS))

    # Aero: fill slots sequentially
    for i in range(aero_steps):
        part, lvl = AERO_SLOT_MAP[i]
        levels[part] = lvl

    # PWT: proportional fill — ratio maps each part's levels proportionally
    # At pwt=5 (max), all parts reach max_level -> composed == META-1.
    # At pwt=0, all are 0.
    # For intermediate: use ratio * max_level rounded, clamped to max.
    if pwt_steps == 0:
        pass  # all stay 0
    elif pwt_steps == RD_PWT_MAX_STEPS:
        # Max: fill all PWT parts to maximum
        for part in ["ice", "turbo", "battery", "ers"]:
            levels[part] = PARTS[part]["max_level"]
    else:
        ratio = pwt_steps / RD_PWT_MAX_STEPS
        # Use round() to get the closest integer level
        for part in ["ice", "turbo", "battery", "ers"]:
            levels[part] = min(PARTS[part]["max_level"], round(ratio * PARTS[part]["max_level"]))

    return levels


# ============================================================================
# JSON save/load round-trip simulation
# ============================================================================

def json_round_trip_parts(part_levels: dict) -> dict:
    """Simulate Godot JSON round-trip: write then read back part_levels."""
    serialised = json.dumps({"part_levels": part_levels})
    parsed = json.loads(serialised)
    raw = parsed["part_levels"]
    # Godot: int(float(v)) handles JSON int->float quirk
    restored = {k: int(float(v)) for k, v in raw.items()}
    return restored


# ============================================================================
# TEST RUNNER
# ============================================================================

def run_tests():
    passes = 0
    fails  = 0

    def check(name, cond, msg=""):
        nonlocal passes, fails
        status = "PASS" if cond else "FAIL"
        print(f"  {status}  {name}" + (f" — {msg}" if msg else ""))
        if cond:
            passes += 1
        else:
            fails += 1
        return cond

    print("=" * 70)
    print("CAR-1 Component Model -- Python verification harness")
    print("=" * 70)
    print()

    # ==================================================================
    # (a) Leveling a single part raises exactly its scalar by per_level
    # ==================================================================
    print("--- (a) Single-part level composition (each part at level 1 vs level 0) ---")
    for part_key, pdef in PARTS.items():
        lvl1 = compose_part_deltas({k: (1 if k == part_key else 0) for k in PARTS})
        lvl0 = compose_part_deltas({k: 0 for k in PARTS})
        primary_scalar = pdef["scalar"]
        expected_primary = pdef["per_level"]
        actual_primary = lvl1[primary_scalar] - lvl0[primary_scalar]
        check(
            f"{part_key}(+1).{primary_scalar}",
            abs(actual_primary - expected_primary) < TOLERANCE,
            f"expected {expected_primary:.4f}, got {actual_primary:.4f}",
        )
        for sk, sv in pdef.get("also", {}).items():
            actual_secondary = lvl1[sk] - lvl0[sk]
            check(
                f"{part_key}(+1).{sk}",
                abs(actual_secondary - sv) < TOLERANCE,
                f"expected {sv:.4f}, got {actual_secondary:.4f}",
            )
        for rk, rv in pdef.get("also_rel", {}).items():
            actual_rel = lvl1[rk] - lvl0[rk]
            check(
                f"{part_key}(+1).{rk}",
                abs(actual_rel - rv) < TOLERANCE,
                f"expected {rv:.4f}, got {actual_rel:.4f}",
            )
    print()

    # ==================================================================
    # (b) Full branch balance preservation vs META-1
    # ==================================================================
    print("--- (b) Full-branch balance preservation vs META-1 ---")

    aero_max = max_levels_for_group("aero")
    power_max = max_levels_for_group("power")
    energy_max = max_levels_for_group("energy")

    d_aero_full   = compose_part_deltas(aero_max)
    d_power_full  = compose_part_deltas(power_max)
    d_energy_full = compose_part_deltas(energy_max)
    d_pwt_full    = sum_deltas(d_power_full, d_energy_full)

    check("full_aero.d_aero == 0.150",
          abs(d_aero_full["d_aero"] - META1_AERO_FULL_D_AERO) < TOLERANCE,
          f"{d_aero_full['d_aero']:.4f} vs {META1_AERO_FULL_D_AERO:.4f}")
    check("full_aero.d_ch_rel == 0.180",
          abs(d_aero_full["d_ch_rel"] - META1_AERO_FULL_D_CH_REL) < TOLERANCE,
          f"{d_aero_full['d_ch_rel']:.4f} vs {META1_AERO_FULL_D_CH_REL:.4f}")
    check("full_power.d_power == 0.050",
          abs(d_power_full["d_power"] - META1_PWT_FULL_D_POWER) < TOLERANCE,
          f"{d_power_full['d_power']:.4f} vs {META1_PWT_FULL_D_POWER:.4f}")
    check("full_energy.d_energy == 0.050",
          abs(d_energy_full["d_energy"] - META1_PWT_FULL_D_ENERGY) < TOLERANCE,
          f"{d_energy_full['d_energy']:.4f} vs {META1_PWT_FULL_D_ENERGY:.4f}")
    check("full_pwt.d_eng_rel == 0.150",
          abs(d_pwt_full["d_eng_rel"] - META1_PWT_FULL_D_ENG_REL) < TOLERANCE,
          f"{d_pwt_full['d_eng_rel']:.4f} vs {META1_PWT_FULL_D_ENG_REL:.4f}")

    print()
    print("  Full aero group deltas:")
    for k, v in d_aero_full.items():
        if abs(v) > 0: print(f"    {k}: {v:.4f}")
    print("  Full PWT combined deltas:")
    for k, v in d_pwt_full.items():
        if abs(v) > 0: print(f"    {k}: {v:.4f}")
    print()

    # ==================================================================
    # (c) Save/load round-trip + old-save migration
    # ==================================================================
    print("--- (c) Save/load round-trip + old-save migration ---")

    # c1: round-trip of part_levels
    test_levels = {k: v["max_level"] for k, v in PARTS.items()}
    restored = json_round_trip_parts(test_levels)
    all_match = all(restored[k] == test_levels[k] for k in test_levels)
    check("part_levels JSON round-trip (int->float quirk)", all_match)

    # c2: migration from old steps — exact match at boundaries (0, max)
    # Intermediate steps are approximate (within rounding of one level).
    exact_cases = [(0, 0), (RD_AERO_MAX_STEPS, 0), (0, RD_PWT_MAX_STEPS), (RD_AERO_MAX_STEPS, RD_PWT_MAX_STEPS)]
    for (as_, ps_) in exact_cases:
        migrated = migrate_from_steps(as_, ps_)
        composed = compose_part_deltas(migrated)
        meta1    = meta1_deltas(as_, ps_)
        ok_all = all(abs(composed[k] - meta1[k]) < TOLERANCE for k in meta1)
        check(f"migrate(aero={as_},pwt={ps_}) exact match",
              ok_all,
              "composed=%s meta1=%s" % (
                  {k: f"{v:.4f}" for k, v in composed.items() if abs(v) > 0 or abs(meta1[k]) > 0},
                  {k: f"{v:.4f}" for k, v in meta1.items() if abs(v) > 0}) if not ok_all else "")

    # c3: intermediate steps — require d_aero and d_power within ±0.020 of META-1
    APPROX_TOL = 0.020
    print(f"  Intermediate migration (approximate within ±{APPROX_TOL}):")
    for as_ in [2, 4]:
        for ps_ in [2]:
            migrated = migrate_from_steps(as_, ps_)
            composed = compose_part_deltas(migrated)
            meta1    = meta1_deltas(as_, ps_)
            close = all(abs(composed[k] - meta1[k]) <= APPROX_TOL for k in meta1)
            details = " | ".join(
                f"{k}: composed={composed[k]:.4f} meta1={meta1[k]:.4f} diff={composed[k]-meta1[k]:+.4f}"
                for k in meta1
            )
            check(f"migrate(aero={as_},pwt={ps_}) within ±{APPROX_TOL}", close, details if not close else "")
    print()

    # ==================================================================
    # (d) Pace effect flows through sim scalars
    # ==================================================================
    print("--- (d) Pace effect: CAR_K bias at Monaco vs Monza ---")

    base_c      = car_from_deltas({"d_aero": 0.0, "d_power": 0.0, "d_energy": 0.0,
                                    "d_ch_rel": 0.0, "d_eng_rel": 0.0})
    full_aero_c = car_from_deltas(d_aero_full)
    full_pwt_c  = car_from_deltas(d_pwt_full)   # power+energy fully upgraded

    aero_monaco = pace_gain_s(base_c, full_aero_c, MONACO)
    aero_monza  = pace_gain_s(base_c, full_aero_c, MONZA)
    pwt_monaco  = pace_gain_s(base_c, full_pwt_c,  MONACO)
    pwt_monza   = pace_gain_s(base_c, full_pwt_c,  MONZA)

    print(f"  Full aero at Monaco:  {aero_monaco:+.3f} s/lap")
    print(f"  Full aero at Monza:   {aero_monza:+.3f} s/lap")
    print(f"  Full PWT at Monza:    {pwt_monza:+.3f} s/lap")
    print(f"  Full PWT at Monaco:   {pwt_monaco:+.3f} s/lap")
    print()

    check("aero helps Monaco (> 0.10 s/lap)",     aero_monaco > 0.10, f"{aero_monaco:.3f} s/lap")
    check("aero Monaco > Monza (track-char)",      aero_monaco > aero_monza,
          f"Monaco={aero_monaco:.3f} Monza={aero_monza:.3f}")
    check("PWT helps Monza (> 0.05 s/lap)",        pwt_monza > 0.05,  f"{pwt_monza:.3f} s/lap")
    check("PWT Monza > Monaco (track-char)",        pwt_monza > pwt_monaco,
          f"Monza={pwt_monza:.3f} Monaco={pwt_monaco:.3f}")
    print()

    # ==================================================================
    # Summary
    # ==================================================================
    total = passes + fails
    print("=" * 70)
    print(f"RESULTS: {passes} PASS  /  {fails} FAIL  (total {total})")
    print("=" * 70)
    if fails == 0:
        print("ALL PASS — component model is correct and balanced vs META-1.")
    else:
        print("FAILURES detected — check the FAIL lines above.")
    print()

    print("Verified PARTS table for f1_2026.gd:")
    print(f"  {'Part':<12}  {'Group':<12}  {'Primary':<8}  {'per_lv':>8}  {'max_lv':>6}  Rel contributions")
    for k, p in PARTS.items():
        rel_str = ", ".join(f"{rk}+{rv:.3f}/lv" for rk, rv in p.get("also_rel", {}).items())
        also_str = ", ".join(f"{sk}+{sv:.3f}/lv" for sk, sv in p.get("also", {}).items())
        notes = " | ".join(filter(None, [rel_str, also_str]))
        print(f"  {k:<12}  {p['group']:<12}  {p['scalar']:<8}  {p['per_level']:>8.4f}  {p['max_level']:>6}  {notes}")

    return passes, fails


if __name__ == "__main__":
    run_tests()
