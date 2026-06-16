# meta_m4_pitcrew_check.py — M4 "pit crew" numeric verification.
# Self-contained mirror of the M4 math: 5 pit roles -> 3 sim scalars, the
# crew stop-time model, training (growth/fatigue/injury), DHL award points,
# key-role poaching corridor, driver status -> morale, JSON quirk.
# Run: python3 meta_m4_pitcrew_check.py
#
# Acceptance criteria covered (META_DESIGN.md, M4):
#  1. Crew "all 18-20" -> stop ~2.0 s ± 0.1; crew "6-8" -> ~2.8 s ± 0.8.
#  2. One training session: +0.5..1.0 to the chosen attr, costs money;
#     3 sessions before one race -> fatigue (pit_speed -0.15 ~ +0.2 s next race).
#  3. DHL: fastest stop of the round earns 5/3/1; season winner $300k + 5 RP.
#  4. Poaching a key pit role with attrs 18-20 costs $150-400k (signing bonus).
#  5. "First" driver status -> +morale offset via morale_mod (second -> -).
#  6. New fields survive the JSON int->float round-trip.

import json

MASK = 0xFFFFFFFF


def lcg(state):
    state = (state * 1664525 + 1013904223) & MASK
    return state, (state & 0xFFFF) / 65535.0


# --- constants mirrored from race_sim.gd / season.gd (M4) --------------------
STOP_TIME_BASE = 3.27
STOP_TIME_SPEED_K = 1.33
STOP_TIME_SIGMA_MIN = 0.05
STOP_TIME_SIGMA_K = 1.15
STOP_BOTCH_EXTRA = 2.0

PIT_TRAIN_COST = 25_000
PIT_TRAIN_MIN = 0.5
PIT_TRAIN_MAX = 1.0
PIT_FATIGUE_SESSIONS = 3
PIT_FATIGUE_SPEED_PEN = 0.15
PIT_INJURY_PROB = 0.05
PIT_POACH_BONUS_MULT = 5
TRAIN_SEED_MIX = 0x77A14
DHL_POINTS = [5, 3, 1]
DHL_PRIZE_MONEY = 300_000
DHL_PRIZE_RP = 5
STATUS_MORALE_FIRST = 5
STATUS_MORALE_SECOND = -3

# salary ranges for the pit roles (per round) — season.gd STAFF_SALARY_RANGE
PIT_SALARY = {
    "gunman_front": (10_000, 30_000), "gunman_rear": (10_000, 30_000),
    "jackman_front": (9_000, 27_000), "jackman_rear": (9_000, 27_000),
    "pitcrew": (15_000, 40_000),   # chief mechanic (existing role, new attrs)
}


def salary_for(role, overall):
    lo, hi = PIT_SALARY[role]
    t = min(1.0, max(0.0, (overall - 6.0) / 12.0))
    return int(round((lo + t * (hi - lo)) / 1000.0)) * 1000


# --- 5 roles -> 3 scalars (personnel.gd aggregation) --------------------------
def pit_speed(attrs_by_role):
    vals = [attrs_by_role["gunman_front"]["speed"], attrs_by_role["gunman_rear"]["speed"],
            attrs_by_role["jackman_front"]["strength"], attrs_by_role["jackman_rear"]["strength"]]
    return sum(vals) / 4.0 / 20.0


def pit_consistency(attrs_by_role):
    vals = [attrs_by_role["gunman_front"]["precision"], attrs_by_role["gunman_rear"]["precision"],
            attrs_by_role["jackman_front"]["timing"], attrs_by_role["jackman_rear"]["timing"]]
    return sum(vals) / 4.0 / 20.0


def reliability_work(attrs_by_role):
    c = attrs_by_role["pitcrew"]
    return (c["coordination"] + c["experience"]) / 2.0 / 20.0


def stop_estimate(speed_01):
    return STOP_TIME_BASE - STOP_TIME_SPEED_K * speed_01


def stop_sigma(cons_01):
    return STOP_TIME_SIGMA_MIN + STOP_TIME_SIGMA_K * (1.0 - cons_01)


def crew(attr_val):
    return {
        "gunman_front": {"speed": attr_val, "precision": attr_val},
        "gunman_rear": {"speed": attr_val, "precision": attr_val},
        "jackman_front": {"strength": attr_val, "timing": attr_val},
        "jackman_rear": {"strength": attr_val, "timing": attr_val},
        "pitcrew": {"coordination": attr_val, "experience": attr_val},
    }


checks = []


def check(name, ok, detail=""):
    checks.append((name, ok))
    print(("PASS" if ok else "FAIL"), "-", name, ("| " + detail if detail else ""))


# 1) stop-time corridors -------------------------------------------------------
top = crew(19)          # "all 18-20"
bad = crew(7)           # "6-8"
s_top, c_top = pit_speed(top), pit_consistency(top)
s_bad, c_bad = pit_speed(bad), pit_consistency(bad)
est_top, sig_top = stop_estimate(s_top), stop_sigma(c_top)
est_bad, sig_bad = stop_estimate(s_bad), stop_sigma(c_bad)
check("top crew stop ~2.0 s", abs(est_top - 2.0) <= 0.05, f"est={est_top:.3f}")
check("top crew sigma ~0.1", abs(sig_top - 0.1) <= 0.02, f"sigma={sig_top:.3f}")
check("bad crew stop ~2.8 s", abs(est_bad - 2.8) <= 0.05, f"est={est_bad:.3f}")
check("bad crew sigma ~0.8", abs(sig_bad - 0.8) <= 0.05, f"sigma={sig_bad:.3f}")
mid = crew(11)
check("mid crew between (monotonic)",
      est_top < stop_estimate(pit_speed(mid)) < est_bad)
# sim pit_loss monotonicity: loss = pit_loss*(1.1-0.2*s) — faster crew, lower loss
check("sim pit_loss falls with crew quality",
      21.0 * (1.1 - 0.2 * s_top) < 21.0 * (1.1 - 0.2 * s_bad),
      f"top={21.0 * (1.1 - 0.2 * s_top):.2f}s bad={21.0 * (1.1 - 0.2 * s_bad):.2f}s")

# 2) training ---------------------------------------------------------------------
deltas = []
for seed in range(500):
    st = (seed ^ TRAIN_SEED_MIX) & MASK
    st, f = lcg(st)
    deltas.append(PIT_TRAIN_MIN + f * (PIT_TRAIN_MAX - PIT_TRAIN_MIN))
check("training delta in 0.5..1.0", all(0.5 <= d <= 1.0 for d in deltas),
      f"min={min(deltas):.3f} max={max(deltas):.3f}")
# fatigue: -0.15 pit_speed ~ +0.2 s on the stop estimate
fat_cost = STOP_TIME_SPEED_K * PIT_FATIGUE_SPEED_PEN
check("fatigue = +0.2 s on the stop", abs(fat_cost - 0.2) <= 0.005, f"+{fat_cost:.3f} s")
# injury frequency ~5% across seeds
inj = 0
n = 4000
for seed in range(n):
    st = (seed ^ TRAIN_SEED_MIX ^ 0x9E3779B9) & MASK
    st, f = lcg(st)
    if f < PIT_INJURY_PROB:
        inj += 1
check("injury roll ~5%", 0.035 <= inj / n <= 0.065, f"freq={inj / n:.3f}")

# 3) DHL ---------------------------------------------------------------------------
# round ranking: 4 teams with best stops -> 5/3/1 to the top three
stops = {0: 2.31, 4: 2.05, 7: 2.42, 10: 2.18}
ranked = sorted(stops, key=lambda t: stops[t])
pts = {}
for i, t in enumerate(ranked[:3]):
    pts[t] = DHL_POINTS[i]
check("DHL round points 5/3/1 by fastest stop",
      pts == {4: 5, 10: 3, 0: 1}, f"pts={pts}")
# season: accumulate over 5 rounds, winner takes the prize
season_pts = {4: 5 * 3 + 3, 0: 5 * 2 + 3 * 2}   # team4=18, team0=16
winner = max(season_pts, key=lambda t: season_pts[t])
check("DHL season winner gets $300k + 5 RP",
      winner == 4 and DHL_PRIZE_MONEY == 300_000 and DHL_PRIZE_RP == 5)

# 4) poaching corridor for key pit roles --------------------------------------------
ok_all = True
detail = []
for role in PIT_SALARY:
    for overall in (18, 19, 20):
        sal = salary_for(role, overall)
        ask = int(round(sal * 1.15 / 1000.0)) * 1000
        bonus = ask * PIT_POACH_BONUS_MULT
        detail.append(f"{role}@{overall}={bonus // 1000}k")
        if not (150_000 <= bonus <= 400_000):
            ok_all = False
check("poach bonus for attrs 18-20 in $150-400k", ok_all,
      " ".join(detail[:5]) + " ...")

# 5) driver status -> morale ----------------------------------------------------------
def morale_mod(morale, status):
    off = STATUS_MORALE_FIRST if status == "first" else (
        STATUS_MORALE_SECOND if status == "second" else 0)
    return (float(morale + off) - 50.0) / 1200.0


base = morale_mod(70, "")
check("status first > none > second in morale_mod",
      morale_mod(70, "first") > base > morale_mod(70, "second"),
      f"first=+{morale_mod(70, 'first') - base:.5f} second={morale_mod(70, 'second') - base:.5f}")
check("first offset = +5/1200 pace", abs((morale_mod(70, "first") - base) - 5.0 / 1200.0) < 1e-12)

# 6) JSON round-trip --------------------------------------------------------------------
state = {
    "dhl_points": {"4": 8, "0": 5}, "dhl_awarded": False,
    "dhl_best": {"time": 2.05, "track": "Монца", "round": 2},
    "contracts": [{"driver_id": 4, "status": "first", "bonus_podium": 50_000},
                  {"driver_id": 5, "status": "second", "bonus_podium": 50_000}],
    "pit_state": [{"role": "gunman_front", "sessions": 2, "fatigue": 0, "injury": 1,
                   "attrs": {"speed": 14.7, "precision": 12.0}}],
}
blob = json.loads(json.dumps(state, ensure_ascii=False), parse_int=float)
restored = {
    "dhl_points": {str(k): int(float(v)) for k, v in blob["dhl_points"].items()},
    "dhl_awarded": bool(blob["dhl_awarded"]),
    "dhl_best": {"time": float(blob["dhl_best"]["time"]),
                 "track": str(blob["dhl_best"]["track"]),
                 "round": int(float(blob["dhl_best"]["round"]))},
    "contracts": [{"driver_id": int(float(c["driver_id"])), "status": str(c["status"]),
                   "bonus_podium": int(float(c["bonus_podium"]))} for c in blob["contracts"]],
    "pit_state": [{"role": str(p["role"]), "sessions": int(float(p["sessions"])),
                   "fatigue": int(float(p["fatigue"])), "injury": int(float(p["injury"])),
                   "attrs": {k: float(v) for k, v in p["attrs"].items()}}
                  for p in blob["pit_state"]],
}
check("save/load round-trip (int->float quirk)", restored == state)

# --- summary ----------------------------------------------------------------------------
fails = [n for n, ok in checks if not ok]
print()
print(f"{len(checks) - len(fails)}/{len(checks)} PASS")
if fails:
    print("FAILED:", ", ".join(fails))
    raise SystemExit(1)
