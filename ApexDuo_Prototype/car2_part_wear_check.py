# car2_part_wear_check.py — CAR-2 "part condition/wear" numeric verification.
# Self-contained mirror of the part-wear math: per-round decay with track
# character bias, condition scaling of part contributions, the reliability
# malus for badly worn parts, replacement economy + the component-pool RP
# penalty, supplier-part exemption, JSON quirk.
# Run: python3 car2_part_wear_check.py
#
# Acceptance criteria (README "Дальше": состояние/износ деталей + пенальти):
#  1. Wear is deterministic per seed; aero parts wear faster on high-downforce
#     tracks (Monaco) than power tracks (Monza); power parts — the opposite.
#  2. Condition scales a developed part's contribution: floor 60% at cond 0,
#     full at 1.0 (e.g. cond 0.5 -> x0.80).
#  3. A part below 0.30 condition adds a reliability malus (-0.025) to its
#     group's rel scalar (aero/reliability -> d_ch_rel, power/energy -> d_eng_rel).
#  4. Replacement restores condition to 1.0 for money; beyond the free pool of
#     3 replacements each one costs an extra RP penalty (real-F1 pool analogy).
#  5. Supplier-bought parts do NOT wear (the supplier maintains them).
#  6. Season sanity: a developed aero part on a downforce-heavy calendar needs
#     ~1 replacement over 5 rounds (ends ~0.2-0.5 without one).
#  7. New fields survive the JSON int->float round-trip.

import json

MASK = 0xFFFFFFFF


def lcg(state):
    state = (state * 1664525 + 1013904223) & MASK
    return state, (state & 0xFFFF) / 65535.0


# --- constants mirrored from season.gd (CAR-2) --------------------------------
WEAR_SEED_MIX = 0x0EA12D0
WEAR_BASE = 0.10                 # base condition loss per round (developed part)
WEAR_TRACK_K = 0.06              # extra loss x track character (df for aero, pw for power)
WEAR_REL_FLAT = 0.03             # reliability-group parts: flat extra
WEAR_JITTER = 0.02               # deterministic +/- jitter per part per round
COND_SCALE_FLOOR = 0.6           # contribution scale at condition 0
WORN_THRESHOLD = 0.30            # below this the part is "critical"
WORN_REL_MALUS = 0.025           # rel malus per critical part
PART_REPLACE_COST = {"aero": 60_000, "power": 80_000, "energy": 70_000,
                     "reliability": 50_000}
FREE_REPLACEMENTS = 3            # season pool; beyond -> RP penalty each
POOL_PENALTY_RP = 2

PART_GROUPS = {
    "front_wing": "aero", "rear_wing": "aero", "floor": "aero",
    "sidepods": "aero", "suspension_geo": "aero",
    "ice": "power", "turbo": "power", "battery": "energy", "ers": "energy",
    "gearbox": "reliability", "hydraulics": "reliability", "cooling": "reliability",
}
PART_ORDER = list(PART_GROUPS)   # stable iteration order (mirrors F1_2026.PARTS)


def cond_scale(cond):
    return COND_SCALE_FLOOR + (1.0 - COND_SCALE_FLOOR) * cond


def wear_one_round(cond, part_key, cal_seed, rnd, downforce, power):
    grp = PART_GROUPS[part_key]
    decay = WEAR_BASE
    if grp == "aero":
        decay += WEAR_TRACK_K * downforce
    elif grp in ("power", "energy"):
        decay += WEAR_TRACK_K * power
    else:
        decay += WEAR_REL_FLAT
    pidx = PART_ORDER.index(part_key)
    seed = (cal_seed ^ WEAR_SEED_MIX ^ ((rnd * 2654435761) & MASK)
            ^ ((pidx * 97003) & MASK)) & MASK
    _, f = lcg(seed)
    decay += (f - 0.5) * 2.0 * WEAR_JITTER
    return max(0.0, cond - decay)


checks = []


def check(name, ok, detail=""):
    checks.append((name, ok))
    print(("PASS" if ok else "FAIL"), "-", name, ("| " + detail if detail else ""))


# 1) determinism + track bias ---------------------------------------------------
monaco = {"df": 0.95, "pw": 0.45}
monza = {"df": 0.25, "pw": 0.95}
a = wear_one_round(1.0, "front_wing", 42, 0, monaco["df"], monaco["pw"])
b = wear_one_round(1.0, "front_wing", 42, 0, monaco["df"], monaco["pw"])
check("wear deterministic per seed", a == b)
# average over jitter via many rounds: aero loses more at Monaco than Monza
aero_mc = sum(1.0 - wear_one_round(1.0, "front_wing", s, 1, monaco["df"], monaco["pw"])
              for s in range(300)) / 300
aero_mz = sum(1.0 - wear_one_round(1.0, "front_wing", s, 1, monza["df"], monza["pw"])
              for s in range(300)) / 300
ice_mc = sum(1.0 - wear_one_round(1.0, "ice", s, 1, monaco["df"], monaco["pw"])
             for s in range(300)) / 300
ice_mz = sum(1.0 - wear_one_round(1.0, "ice", s, 1, monza["df"], monza["pw"])
             for s in range(300)) / 300
check("aero wears faster at Monaco than Monza", aero_mc > aero_mz,
      f"mc={aero_mc:.3f} mz={aero_mz:.3f}")
check("power wears faster at Monza than Monaco", ice_mz > ice_mc,
      f"mz={ice_mz:.3f} mc={ice_mc:.3f}")

# 2) condition scaling -------------------------------------------------------------
check("contribution scale: 1.0 -> x1.00, 0.5 -> x0.80, 0.0 -> x0.60",
      abs(cond_scale(1.0) - 1.0) < 1e-12 and abs(cond_scale(0.5) - 0.8) < 1e-12
      and abs(cond_scale(0.0) - 0.6) < 1e-12)
# maxed front wing (0.030 x 2 = 0.060 d_aero) at cond 0.5 -> 0.048
eff = 0.060 * cond_scale(0.5)
check("worn front wing loses downforce", abs(eff - 0.048) < 1e-12, f"0.060 -> {eff:.3f}")

# 3) critical-part rel malus ----------------------------------------------------------
check("cond 0.29 is critical, 0.31 is not",
      (0.29 < WORN_THRESHOLD) and not (0.31 < WORN_THRESHOLD))
# two critical chassis parts -> -0.050 d_ch_rel
malus = 2 * WORN_REL_MALUS
check("2 critical parts = -0.050 rel", abs(malus - 0.050) < 1e-12)

# 4) replacement economy + pool penalty --------------------------------------------------
money = 1_000_000
rp_pen = 0
used = 0
for i in range(5):                       # replace 5 parts over a season
    cost = PART_REPLACE_COST["aero"]
    money -= cost
    used += 1
    if used > FREE_REPLACEMENTS:
        rp_pen += POOL_PENALTY_RP
check("5 replacements: money -300k, RP penalty 4 (2 beyond pool)",
      money == 700_000 and rp_pen == 4, f"money={money} rp_pen={rp_pen}")
check("replacement costs within $50-80k", all(
    50_000 <= c <= 80_000 for c in PART_REPLACE_COST.values()))

# 5) supplier parts exempt (logic-level: wear loop skips bought keys) ----------------------
bought = {"ice": True}
worn = {}
for key in ("ice", "turbo"):
    if bought.get(key):
        continue
    worn[key] = wear_one_round(1.0, key, 42, 0, monza["df"], monza["pw"])
check("bought part skipped by the wear loop", "ice" not in worn and "turbo" in worn)

# 6) season sanity: 5 high-downforce rounds without replacement ----------------------------
cond = 1.0
for rnd in range(5):
    cond = wear_one_round(cond, "front_wing", 4242, rnd, 0.85, 0.5)
check("5-round season leaves a developed aero part at 0.15-0.55", 0.15 <= cond <= 0.55,
      f"end condition={cond:.3f}")
# with ONE mid-season replacement the part stays healthy (>0.55)
cond2 = 1.0
for rnd in range(5):
    if rnd == 3:
        cond2 = 1.0
    cond2 = wear_one_round(cond2, "front_wing", 4242, rnd, 0.85, 0.5)
check("one replacement keeps it healthy", cond2 > 0.55, f"end={cond2:.3f}")

# 7) JSON round-trip ------------------------------------------------------------------------
state = {"part_condition": {"front_wing": 0.62, "ice": 1.0},
         "replacements_used": 2}
blob = json.loads(json.dumps(state), parse_int=float)
restored = {
    "part_condition": {str(k): float(v) for k, v in blob["part_condition"].items()},
    "replacements_used": int(float(blob["replacements_used"])),
}
check("save/load round-trip (int->float quirk)", restored == state)

# --- summary ---------------------------------------------------------------------------------
fails = [n for n, ok in checks if not ok]
print()
print(f"{len(checks) - len(fails)}/{len(checks)} PASS")
if fails:
    print("FAILED:", ", ".join(fails))
    raise SystemExit(1)
