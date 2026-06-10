"""
energy2026_check.py — self-contained Python verification harness for the
2026 ERS/active-aero rework (Apex Duo engine v0.4).

Four proofs required:
  (a) attack on a low-energy_limit track exhausts the per-lap deploy budget
      and loses the boost late in the lap.
  (b) taper makes attack worth less at Monza than Monaco.
  (c) aero_zones give a measurable per-lap pace gain that scales with car power.
  (d) Overtake potency is higher at Monza than Monaco.

No imports from other harness files — fully self-contained.
"""

# ---------------------------------------------------------------------------
# Constants mirroring the GDScript changes
# ---------------------------------------------------------------------------
DEPLOY_BUDGET_BASE = 8.5    # abstract deploy units per lap (reset each lap)
TAPER_K            = 0.35   # ERS attack pace is worth less on high-power tracks
AERO_ZONE_K        = 0.012  # s/lap per aero zone per unit of car_power blend
# Overtake: scale = (0.5 + 0.5*track.power) * (0.4 + 0.15*track.aero_zones)
OT_PACE            = -0.55  # base Overtake pace benefit (s/lap)

# Existing constants (unchanged)
ERS_MODES = {
    "harvest":  {"pace":  0.30, "soc":  6.0},
    "balanced": {"pace":  0.00, "soc":  0.0},
    "attack":   {"pace": -0.38, "soc": -6.5},
}
CLIP_PENALTY   = 0.55
OT_DRAIN       = 9.0
OT_MIN_SOC     = 14.0
OT_GAP_S       = 1.0
PASSIVE_REGEN  = 4.0
SOC_RECOVER    = 20.0
PASS_DEADZONE  = 0.02

# ---------------------------------------------------------------------------
# Track table — now includes energy_limit and aero_zones
# ---------------------------------------------------------------------------
TRACKS = {
    "Монако":        {"lt": 73.5,  "power": 0.20, "downforce": 0.97, "overtaking": 0.05,
                      "harvest": 0.78, "deploy": 0.40, "energy_limit": 1.00, "aero_zones": 0},
    "Монца":         {"lt": 81.5,  "power": 0.97, "downforce": 0.15, "overtaking": 0.82,
                      "harvest": 0.38, "deploy": 0.95, "energy_limit": 0.55, "aero_zones": 4},
    "Спа":           {"lt": 106.0, "power": 0.88, "downforce": 0.42, "overtaking": 0.72,
                      "harvest": 0.55, "deploy": 0.88, "energy_limit": 0.65, "aero_zones": 3},
    "Сильверстоун":  {"lt": 88.0,  "power": 0.62, "downforce": 0.85, "overtaking": 0.55,
                      "harvest": 0.58, "deploy": 0.60, "energy_limit": 0.80, "aero_zones": 2},
    "Бахрейн":       {"lt": 92.0,  "power": 0.72, "downforce": 0.55, "overtaking": 0.78,
                      "harvest": 0.70, "deploy": 0.78, "energy_limit": 0.70, "aero_zones": 3},
    "Сузука":        {"lt": 91.0,  "power": 0.58, "downforce": 0.82, "overtaking": 0.40,
                      "harvest": 0.55, "deploy": 0.55, "energy_limit": 0.85, "aero_zones": 2},
    "Зандворт":      {"lt": 72.0,  "power": 0.45, "downforce": 0.88, "overtaking": 0.20,
                      "harvest": 0.60, "deploy": 0.45, "energy_limit": 0.92, "aero_zones": 1},
    "Хунгароринг":   {"lt": 78.0,  "power": 0.35, "downforce": 0.90, "overtaking": 0.12,
                      "harvest": 0.66, "deploy": 0.42, "energy_limit": 0.98, "aero_zones": 1},
    "Сингапур":      {"lt": 94.0,  "power": 0.40, "downforce": 0.92, "overtaking": 0.18,
                      "harvest": 0.80, "deploy": 0.48, "energy_limit": 0.95, "aero_zones": 1},
    "Баку":          {"lt": 103.0, "power": 0.95, "downforce": 0.30, "overtaking": 0.80,
                      "harvest": 0.62, "deploy": 0.92, "energy_limit": 0.58, "aero_zones": 4},
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def ers_attack_pace(track, deploy_budget_frac):
    """
    Net ERS attack pace benefit for one tick, after applying:
      1. taper: reduces value on high-power tracks
      2. budget gate: if budget exhausted, benefit -> 0
    deploy_budget_frac: remaining fraction of lap deploy budget (0..1)
    Returns a (negative = faster) pace delta in s/lap
    """
    base_pace = ERS_MODES["attack"]["pace"]  # -0.38
    # taper: worth less on high-power tracks
    taper_factor = 1.0 - TAPER_K * track["power"]
    tapered_pace = base_pace * taper_factor
    # budget gate: soft cap — benefit tapers to 0 as budget runs out
    gated_pace = tapered_pace * deploy_budget_frac
    return gated_pace


def aero_zone_pace(track, car_power):
    """
    Pace gain from low-drag straight zones.
    Returns negative (faster) delta in s/lap.
    """
    return -AERO_ZONE_K * track["aero_zones"] * (0.5 + 0.5 * car_power)


def overtake_potency(track):
    """
    Overtake pace multiplier — stronger on long-straight/high-aero-zone tracks.
    Returns a scale factor.
    """
    return (0.5 + 0.5 * track["power"]) * (0.4 + 0.15 * track["aero_zones"])


def budget_spend_rate(track, dt_over_lt):
    """
    How much deploy budget is consumed per tick when in attack mode.
    attack soc drain: ERS_MODES["attack"]["soc"] = -6.5 %/lap, scaled by deploy.
    We model budget spend proportionally to ERS soc spend.
    """
    soc_drain_per_lap = abs(ERS_MODES["attack"]["soc"]) * (0.6 + 0.8 * track["deploy"])
    # budget is normalised to DEPLOY_BUDGET_BASE units per lap
    # budget consumed per tick = (soc_drain fraction of full-lap budget) * dt_over_lt
    return soc_drain_per_lap * dt_over_lt  # in soc-% units, compare to budget in same units


# ---------------------------------------------------------------------------
# Test (a): per-lap budget exhaustion on a low-energy_limit track
# ---------------------------------------------------------------------------
def test_a_budget_exhaustion():
    """
    Simulate ~one lap at Monza (low energy_limit=0.55) in attack mode.
    The deploy budget = DEPLOY_BUDGET_BASE * energy_limit = 8.5 * 0.55 = 4.675 units.
    After exhausting it, pace boost drops to 0.
    Prove: boost is active early in the lap but gone by the end.
    """
    print("\n--- Test (a): Deploy budget exhaustion at Монца (energy_limit=0.55) ---")
    track = TRACKS["Монца"]
    lt = track["lt"]
    energy_limit = track["energy_limit"]
    budget = DEPLOY_BUDGET_BASE * energy_limit

    # model: budget is in abstract units; SoC drain in attack ~6.5*deploy_scale per lap
    # normalise: budget_units depleted per tick proportional to SoC drain
    deploy_scale = abs(ERS_MODES["attack"]["soc"]) * (0.6 + 0.8 * track["deploy"])
    # total SoC drain per full lap in attack = deploy_scale * (lt/lt) = deploy_scale
    # budget is 4.675 abstract units; full-lap SoC drain is deploy_scale
    # fractional exhaustion time = budget / deploy_scale
    budget_fraction_of_lap = budget / deploy_scale
    print(f"  energy_limit: {energy_limit}")
    print(f"  deploy budget: {budget:.3f} units  (DEPLOY_BUDGET_BASE={DEPLOY_BUDGET_BASE} x {energy_limit})")
    print(f"  full-lap SoC drain in attack: {deploy_scale:.3f} units/lap")
    print(f"  budget exhausted after {budget_fraction_of_lap*100:.1f}% of lap")

    # Simulate tick by tick through one lap
    DT = 0.25
    dt_over_lt = DT / lt
    remaining_budget = budget
    early_boost = None
    late_boost = None
    mid_frac = 0.0

    while mid_frac < 1.0:
        bfrac = max(0.0, remaining_budget / budget)  # 0..1 remaining fraction
        pace_benefit = ers_attack_pace(track, bfrac)
        if early_boost is None and mid_frac < 0.05:
            early_boost = pace_benefit
        if mid_frac >= 0.90:
            late_boost = pace_benefit
        # deplete budget
        remaining_budget = max(0.0, remaining_budget - deploy_scale * dt_over_lt)
        mid_frac += dt_over_lt

    print(f"  Attack pace benefit  early-lap: {early_boost:.4f} s  late-lap: {late_boost:.4f} s")
    exhaustion_ok = (early_boost < -0.10) and (abs(late_boost) < 0.01)
    print(f"  PASS: boost active early AND lost late? {'PASS' if exhaustion_ok else 'FAIL'}")
    return exhaustion_ok


# ---------------------------------------------------------------------------
# Test (b): taper makes attack worth less at Monza than Monaco
# ---------------------------------------------------------------------------
def test_b_taper():
    """
    Compare the taper-adjusted ERS attack pace at Monza (high power=0.97)
    vs Monaco (low power=0.20), at full budget (budget_frac=1.0).
    """
    print("\n--- Test (b): Taper — attack worth less at Монца than Монако ---")
    results = {}
    for name in ["Монца", "Монако"]:
        tr = TRACKS[name]
        # Full budget fraction (early lap, no exhaustion)
        pace = ers_attack_pace(tr, 1.0)
        taper_factor = 1.0 - TAPER_K * tr["power"]
        results[name] = {"pace": pace, "taper_factor": taper_factor, "power": tr["power"]}
        print(f"  {name}: power={tr['power']:.2f}  taper_factor={taper_factor:.3f}  "
              f"attack_pace={pace:.4f} s/lap")

    monza_pace  = results["Монца"]["pace"]
    monaco_pace = results["Монако"]["pace"]
    # Both are negative (faster), but Monza should be LESS negative (smaller benefit)
    taper_ok = (monza_pace > monaco_pace)  # closer to 0 = worth less
    print(f"  Монца attack benefit {monza_pace:.4f} s  <  Монако {monaco_pace:.4f} s")
    print(f"  PASS: taper reduces attack at Монца vs Монако? {'PASS' if taper_ok else 'FAIL'}")
    return taper_ok


# ---------------------------------------------------------------------------
# Test (c): aero_zones pace gain scales with car_power
# ---------------------------------------------------------------------------
def test_c_aero_zones():
    """
    At Monza (4 aero zones), compare the aero_zone pace gain for:
      - weak car (car_power=0.30)
      - strong car (car_power=0.90)
    The stronger power car should gain more from low-drag zones.
    Also verify Monaco (0 aero zones) gives 0 benefit.
    """
    print("\n--- Test (c): Aero-zone pace gains scale with car_power ---")
    monza  = TRACKS["Монца"]
    monaco = TRACKS["Монако"]

    weak_monza   = aero_zone_pace(monza,  0.30)
    strong_monza = aero_zone_pace(monza,  0.90)
    any_monaco   = aero_zone_pace(monaco, 0.80)

    print(f"  Монца  (zones=4)  weak car (0.30):   {weak_monza:.4f} s/lap")
    print(f"  Монца  (zones=4)  strong car (0.90): {strong_monza:.4f} s/lap")
    print(f"  Монако (zones=0)  any car (0.80):    {any_monaco:.4f} s/lap")

    scale_ok = (strong_monza < weak_monza < 0.0)   # both negative, strong more negative
    monaco_ok = (abs(any_monaco) < 1e-9)            # exactly 0 at Monaco
    print(f"  PASS: strong car gains more at Монца? {'PASS' if scale_ok else 'FAIL'}")
    print(f"  PASS: no gain at Монако (0 zones)?   {'PASS' if monaco_ok else 'FAIL'}")
    return scale_ok and monaco_ok


# ---------------------------------------------------------------------------
# Test (d): Overtake potency higher at Monza than Monaco
# ---------------------------------------------------------------------------
def test_d_overtake_potency():
    """
    The Overtake scaling factor = (0.5 + 0.5*power) * (0.4 + 0.15*aero_zones)
    This should make Overtake far more useful at Monza than Monaco.
    """
    print("\n--- Test (d): Overtake potency — Монца > Монако ---")
    results = {}
    for name in ["Монца", "Монако", "Баку", "Хунгароринг"]:
        tr = TRACKS[name]
        scale = overtake_potency(tr)
        effective_pace = OT_PACE * scale
        results[name] = scale
        print(f"  {name:16s}: power={tr['power']:.2f} zones={tr['aero_zones']}  "
              f"OT_scale={scale:.3f}  effective_pace={effective_pace:.3f} s/lap")

    monza_scale  = results["Монца"]
    monaco_scale = results["Монако"]
    potency_ok = (monza_scale > monaco_scale * 2.0)  # substantially stronger at Monza
    print(f"\n  Монца OT scale {monza_scale:.3f}  >>  Монако {monaco_scale:.3f}")
    print(f"  PASS: Monza Overtake > 2x Monaco? {'PASS' if potency_ok else 'FAIL'}")
    return potency_ok


# ---------------------------------------------------------------------------
# Extra: SoC regen bonus from aero_zones (small per-lap SoC gain)
# ---------------------------------------------------------------------------
def show_soc_aero_regen():
    """
    Active-aero low-drag zones reduce aero drag => less energy needed =>
    small positive SoC term each lap. Show the numbers.
    """
    AERO_SOC_K = 0.8  # SoC %/lap per aero zone (used in _update_soc)
    print("\n--- Aero-zone SoC regen bonus (informational) ---")
    for name in ["Монца", "Монако", "Баку", "Хунгароринг"]:
        tr = TRACKS[name]
        regen = AERO_SOC_K * tr["aero_zones"]
        print(f"  {name:16s}: zones={tr['aero_zones']}  SoC regen bonus +{regen:.1f}%/lap")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print("=" * 70)
    print("APEX DUO energy2026_check.py — 2026 ERS/Active-Aero Rework")
    print("=" * 70)

    results = {
        "a_budget_exhaustion": test_a_budget_exhaustion(),
        "b_taper":             test_b_taper(),
        "c_aero_zones":        test_c_aero_zones(),
        "d_overtake_potency":  test_d_overtake_potency(),
    }

    show_soc_aero_regen()

    print("\n" + "=" * 70)
    print("RESULTS:")
    all_pass = True
    for k, v in results.items():
        status = "PASS" if v else "FAIL"
        if not v:
            all_pass = False
        print(f"  {status}  {k}")
    print("\nALL PASS:", all_pass)
    print("=" * 70)

    if not all_pass:
        raise SystemExit(1)
