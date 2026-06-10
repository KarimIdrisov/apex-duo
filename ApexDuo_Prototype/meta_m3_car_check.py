# meta_m3_car_check.py — M3 "deep car" numeric verification.
# Self-contained mirror of the f1_2026.gd PARTS table + season.gd M3 math
# (supplier deltas, buy-vs-develop, integration penalty, ATR cost multiplier,
# JSON int->float round-trip). Run: python3 meta_m3_car_check.py
#
# Acceptance criteria covered (META_DESIGN.md, M3):
#  1. Full aero group (5 LTC parts at max) -> d_aero = +0.200, d_ch_rel = +0.290;
#     the existing 9 parts keep their old contributions (no balance regression).
#  2. Buying a transferable part gives 1.5x per_level immediately (incl. rel)
#     and locks development; own max-level exceeds bought by 0.010-0.015 for a
#     full PU (ice+turbo).
#  3. Supplier change mid-season: new supplier effect = 90% for 2 rounds, then 100%.
#  4. ATR catch-up: research SPEED 0.75x (P1) .. 1.15x (P10) => LTC cost for P1
#     is HIGHER than for P10 (cost = base / speed). NOTE: the design doc's
#     acceptance line had this inverted vs its own stated intent ("замедляет
#     лидеров"); implemented per intent, doc line fixed alongside.
#  5. Shell = best d_power, Petronas = best d_energy; best-vs-worst ~ 0.010.
#  6. Save round-trip for the new fields survives the int->float quirk.
# Extra: supplier net cost (cost - tech-partner pay) stays inside M1 income.

import json

# --- PARTS table mirrored from f1_2026.gd (M3: 12 parts) ---------------------
PARTS = {
    "front_wing":     {"group": "aero", "scalar": "d_aero", "per_level": 0.030,
                       "max_level": 2, "also": {}, "also_rel": {"d_ch_rel": 0.030}},
    "rear_wing":      {"group": "aero", "scalar": "d_aero", "per_level": 0.025,
                       "max_level": 2, "also": {}, "also_rel": {"d_ch_rel": 0.030}},
    "floor":          {"group": "aero", "scalar": "d_aero", "per_level": 0.020,
                       "max_level": 2, "also": {}, "also_rel": {"d_ch_rel": 0.030}},
    "sidepods":       {"group": "aero", "scalar": "d_aero", "per_level": 0.015,
                       "max_level": 2, "also": {}, "also_rel": {"d_ch_rel": 0.025}},
    "suspension_geo": {"group": "aero", "scalar": "d_aero", "per_level": 0.010,
                       "max_level": 2, "also": {}, "also_rel": {"d_ch_rel": 0.030}},
    "ice":            {"group": "power", "scalar": "d_power", "per_level": 0.015,
                       "max_level": 2, "also": {}, "also_rel": {"d_eng_rel": 0.020},
                       "buy_cost": 200_000},
    "turbo":          {"group": "power", "scalar": "d_power", "per_level": 0.010,
                       "max_level": 2, "also": {}, "also_rel": {"d_eng_rel": 0.020},
                       "buy_cost": 150_000},
    "battery":        {"group": "energy", "scalar": "d_energy", "per_level": 0.015,
                       "max_level": 2, "also": {}, "also_rel": {"d_eng_rel": 0.018},
                       "buy_cost": 150_000},
    "ers":            {"group": "energy", "scalar": "d_energy", "per_level": 0.010,
                       "max_level": 2, "also": {}, "also_rel": {"d_eng_rel": 0.017},
                       "buy_cost": 120_000},
    "gearbox":        {"group": "reliability", "scalar": "d_ch_rel", "per_level": 0.025,
                       "max_level": 2, "also": {"d_aero": 0.005}, "also_rel": {},
                       "buy_cost": 120_000},
    "hydraulics":     {"group": "reliability", "scalar": "d_ch_rel", "per_level": 0.020,
                       "max_level": 2, "also": {}, "also_rel": {},
                       "buy_cost": 100_000},
    "cooling":        {"group": "reliability", "scalar": "d_ch_rel", "per_level": 0.025,
                       "max_level": 2, "also": {"d_power": 0.005}, "also_rel": {}},
}
SUPPLIER_LEVEL_EQ = 1.5   # bought part == 1.5 own levels

BRAKE_SUPPLIERS = {
    "brembo": {"d_ch_rel": 0.035, "pit_cons": 0.06, "cost": 180_000, "partner_pay": 90_000},
    "ap":     {"d_ch_rel": 0.025, "pit_cons": 0.03, "cost": 120_000, "partner_pay": 70_000},
    "ci":     {"d_ch_rel": 0.020, "pit_cons": 0.02, "cost": 80_000,  "partner_pay": 60_000},
}
FUEL_SUPPLIERS = {
    "shell":    {"d_power": 0.018, "d_energy": 0.010, "cost": 200_000, "partner_pay": 90_000},
    "petronas": {"d_power": 0.012, "d_energy": 0.020, "cost": 200_000, "partner_pay": 90_000},
    "exxon":    {"d_power": 0.015, "d_energy": 0.012, "cost": 150_000, "partner_pay": 75_000},
    "aramco":   {"d_power": 0.010, "d_energy": 0.010, "cost": 130_000, "partner_pay": 70_000},
    "castrol":  {"d_power": 0.008, "d_energy": 0.015, "cost": 100_000, "partner_pay": 60_000},
}
INTEGRATION_SCALE = 0.9
INTEGRATION_ROUNDS = 2
ATR_SPEED_P1 = 0.75
ATR_SPEED_P10 = 1.15


def compose_part_deltas(levels):
    out = {"d_aero": 0.0, "d_power": 0.0, "d_energy": 0.0, "d_ch_rel": 0.0, "d_eng_rel": 0.0}
    for key, lvl in levels.items():
        p = PARTS[key]
        lvl = max(0, min(p["max_level"], lvl))
        if lvl <= 0:
            continue
        out[p["scalar"]] += p["per_level"] * lvl
        for sk, dv in p["also"].items():
            out[sk] += dv * lvl
        for rk, dv in p["also_rel"].items():
            out[rk] += dv * lvl
    return out


def compose_supplier_deltas(bought):
    out = {"d_aero": 0.0, "d_power": 0.0, "d_energy": 0.0, "d_ch_rel": 0.0, "d_eng_rel": 0.0}
    for key, flag in bought.items():
        if not flag or "buy_cost" not in PARTS.get(key, {}):
            continue
        p = PARTS[key]
        out[p["scalar"]] += p["per_level"] * SUPPLIER_LEVEL_EQ
        for sk, dv in p["also"].items():
            out[sk] += dv * SUPPLIER_LEVEL_EQ
        for rk, dv in p["also_rel"].items():
            out[rk] += dv * SUPPLIER_LEVEL_EQ
    return out


def atr_speed(pos):
    return max(ATR_SPEED_P1, min(ATR_SPEED_P10, 0.75 + (pos - 1) / 9.0 * 0.40))


def cost_part_aero(level, rd_mult, pos):
    base = 5 + level * 3
    return max(1, int(round(base / (rd_mult * atr_speed(pos)))))


checks = []


def check(name, ok, detail=""):
    checks.append((name, ok))
    print(("PASS" if ok else "FAIL"), "-", name, ("| " + detail if detail else ""))


approx = lambda a, b, eps=1e-9: abs(a - b) < eps

# 1) full aero group + no regression for the old 9 parts -----------------------
full_aero = compose_part_deltas({k: 2 for k, p in PARTS.items() if p["group"] == "aero"})
check("full 5-part aero: d_aero = +0.200", approx(full_aero["d_aero"], 0.200),
      f"d_aero={full_aero['d_aero']:.3f}")
check("full 5-part aero: d_ch_rel = +0.290", approx(full_aero["d_ch_rel"], 0.290),
      f"d_ch_rel={full_aero['d_ch_rel']:.3f}")
old_aero = compose_part_deltas({"front_wing": 2, "rear_wing": 2, "floor": 2})
check("old 3-part aero unchanged (0.150/0.180)",
      approx(old_aero["d_aero"], 0.150) and approx(old_aero["d_ch_rel"], 0.180))
old_pwt = compose_part_deltas({"ice": 2, "turbo": 2, "battery": 2, "ers": 2})
check("old power/energy unchanged (0.050/0.050/0.150)",
      approx(old_pwt["d_power"], 0.050) and approx(old_pwt["d_energy"], 0.050)
      and approx(old_pwt["d_eng_rel"], 0.150))

# 2) buy vs develop --------------------------------------------------------------
bought_pu = compose_supplier_deltas({"ice": True, "turbo": True})
own_pu = compose_part_deltas({"ice": 2, "turbo": 2})
check("bought PU: immediate d_power = 1.5 levels", approx(bought_pu["d_power"], 0.0375),
      f"d_power={bought_pu['d_power']:.4f}")
check("bought PU: immediate d_eng_rel", approx(bought_pu["d_eng_rel"], 0.060),
      f"d_eng_rel={bought_pu['d_eng_rel']:.3f}")
pu_gap = own_pu["d_power"] - bought_pu["d_power"]
check("own max PU beats bought by 0.010-0.015", 0.010 <= pu_gap <= 0.015,
      f"gap={pu_gap:.4f}")
check("aero parts are NOT buyable (LTC)",
      all("buy_cost" not in PARTS[k] for k, p in PARTS.items() if p["group"] == "aero"))

# 3) integration penalty ----------------------------------------------------------
timeline = []
integration = INTEGRATION_ROUNDS   # just switched mid-season
for _ in range(4):
    scale = INTEGRATION_SCALE if integration > 0 else 1.0
    timeline.append(scale)
    integration = max(0, integration - 1)
check("integration: 90% for 2 rounds then 100%", timeline == [0.9, 0.9, 1.0, 1.0],
      f"timeline={timeline}")
eff = BRAKE_SUPPLIERS["brembo"]["d_ch_rel"] * INTEGRATION_SCALE
check("brembo at 90% integration", approx(eff, 0.0315), f"eff={eff:.4f}")

# 4) ATR catch-up ------------------------------------------------------------------
c_p1 = cost_part_aero(0, 1.0, 1)
c_p10 = cost_part_aero(0, 1.0, 10)
check("ATR: P1 pays MORE than P10 for LTC", c_p1 > c_p10, f"P1={c_p1} RP, P10={c_p10} RP")
check("ATR speed corridor 0.75..1.15",
      approx(atr_speed(1), 0.75) and approx(atr_speed(10), 1.15) and approx(atr_speed(11), 1.15))

# 5) fuel suppliers -----------------------------------------------------------------
best_power = max(FUEL_SUPPLIERS, key=lambda k: FUEL_SUPPLIERS[k]["d_power"])
best_energy = max(FUEL_SUPPLIERS, key=lambda k: FUEL_SUPPLIERS[k]["d_energy"])
check("Shell = best d_power, Petronas = best d_energy",
      best_power == "shell" and best_energy == "petronas")
p_spread = FUEL_SUPPLIERS["shell"]["d_power"] - min(s["d_power"] for s in FUEL_SUPPLIERS.values())
e_spread = FUEL_SUPPLIERS["petronas"]["d_energy"] - min(s["d_energy"] for s in FUEL_SUPPLIERS.values())
check("best-vs-worst spread ~ 0.010", approx(p_spread, 0.010) and approx(e_spread, 0.010),
      f"power={p_spread:.3f} energy={e_spread:.3f}")

# 6) economy: net supplier cost (cost - partner pay) -----------------------------------
for bk, b in BRAKE_SUPPLIERS.items():
    check(f"brakes {bk}: net cost positive & <= 100k",
          0 < b["cost"] - b["partner_pay"] <= 100_000,
          f"net={b['cost'] - b['partner_pay']}")
default_net = (BRAKE_SUPPLIERS["ap"]["cost"] - BRAKE_SUPPLIERS["ap"]["partner_pay"]
               + FUEL_SUPPLIERS["aramco"]["cost"] - FUEL_SUPPLIERS["aramco"]["partner_pay"])
max_net = (BRAKE_SUPPLIERS["brembo"]["cost"] - BRAKE_SUPPLIERS["brembo"]["partner_pay"]
           + FUEL_SUPPLIERS["shell"]["cost"] - FUEL_SUPPLIERS["shell"]["partner_pay"])
check("default suppliers net <= 130k/round (underdog-safe)", default_net <= 130_000,
      f"net={default_net}")
check("max suppliers net <= 220k/round (contender-safe)", max_net <= 220_000,
      f"net={max_net}")

# 7) JSON int->float round-trip of the new season fields --------------------------------
state = {
    "brake_supplier": "brembo", "fuel_supplier": "petronas",
    "brake_integration": 2, "fuel_integration": 0,
    "bought_parts": {"ice": True, "gearbox": True},
}
blob = json.loads(json.dumps(state), parse_int=float)
restored = {
    "brake_supplier": str(blob["brake_supplier"]),
    "fuel_supplier": str(blob["fuel_supplier"]),
    "brake_integration": int(float(blob["brake_integration"])),
    "fuel_integration": int(float(blob["fuel_integration"])),
    "bought_parts": {str(k): bool(v) for k, v in blob["bought_parts"].items()},
}
check("save/load round-trip (int->float quirk)", restored == state)

# --- summary ------------------------------------------------------------------------------
fails = [n for n, ok in checks if not ok]
print()
print(f"{len(checks) - len(fails)}/{len(checks)} PASS")
if fails:
    print("FAILED:", ", ".join(fails))
    raise SystemExit(1)
