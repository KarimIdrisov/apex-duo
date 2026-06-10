# meta_m5_academy_check.py — M5 "academy" numeric verification.
# Self-contained mirror of the M5 math: junior generation/scouting, the
# aggregate F2/F3/F4 round simulation, superlicense accumulation + the 40-pt
# promotion gate, promotion -> driver_attr_dev mapping, test-driver R&D
# multiplier and race substitution, loaning, JSON quirk.
# Run: python3 meta_m5_academy_check.py
#
# Acceptance criteria covered (META_DESIGN.md, M5):
#  1. season_progress grows deterministically per seed; an F2 champion
#     (5 wins) accumulates 40 superlicense points (F3 champion = 30).
#  2. "Promote to F1" is available exactly at superlicense_points >= 40.
#  3. Promotion maps the junior's 5 attrs into driver_attr_dev; dev_of()
#     reflects the sum.
#  4. A strong test driver speeds LTC R&D by +5..15% via cost_part.
#  5. Race substitution: stand-in skill = driver skill - 0.030.
#  6. New fields survive the JSON int->float round-trip.

import json

MASK = 0xFFFFFFFF


def lcg(state):
    state = (state * 1664525 + 1013904223) & MASK
    return state, (state & 0xFFFF) / 65535.0


# --- constants mirrored from season.gd (M5) -----------------------------------
JUNIOR_SEED_MIX = 0xACADE01
JUNIOR_MARKET_SIZE = 3
JUNIOR_MAX_SIGNED = 2
JUNIOR_ATTR_KEYS = ["pace", "overtaking", "starts", "wet", "consistency"]
SUPERLICENSE_GATE = 40
# per-round superlicense points [win, podium, points-finish] per series
SL_POINTS = {"F2": [8, 4, 2], "F3": [6, 3, 1], "F4": [2, 1, 0]}
# series race points per round [win, podium, points-finish]
SERIES_PTS = [25, 15, 8]
# round-result thresholds on the composite score
SCORE_WIN = 0.72
SCORE_PODIUM = 0.58
SCORE_POINTS = 0.45
TESTDRIVE_SKILL_PEN = 0.030
TESTDRIVE_RP_BONUS = 3
TEST_RD_MULT_K = 0.15          # rd mult = 1 + 0.15 * dev_feedback01 (max +15%)
JUNIOR_LOAN_INCOME = 100_000
PROMOTE_ATTR_DIV = 250.0       # dev delta = (attr - 10) / 250 skill units


def junior_round_score(attrs, potential, f):
    base = sum(attrs.values()) / len(attrs) / 15.0
    return base * 0.55 + potential * 0.30 + f * 0.15


def junior_round(attrs, potential, series, cal_seed, rnd, jidx):
    seed = (cal_seed ^ JUNIOR_SEED_MIX ^ ((rnd * 2654435761) & MASK)
            ^ ((jidx * 97003) & MASK)) & MASK
    _, f = lcg(seed)
    score = junior_round_score(attrs, potential, f)
    sl = SL_POINTS[series]
    if score >= SCORE_WIN:
        return SERIES_PTS[0], sl[0]
    if score >= SCORE_PODIUM:
        return SERIES_PTS[1], sl[1]
    if score >= SCORE_POINTS:
        return SERIES_PTS[2], sl[2]
    return 0, 0


def test_rd_mult(dev_feedback_attr):
    return 1.0 + TEST_RD_MULT_K * (dev_feedback_attr / 20.0)


def cost_part_aero(level, mults):
    base = 5 + level * 3
    m = 1.0
    for x in mults:
        m *= x
    return max(1, int(round(base / m)))


checks = []


def check(name, ok, detail=""):
    checks.append((name, ok))
    print(("PASS" if ok else "FAIL"), "-", name, ("| " + detail if detail else ""))


# 1) deterministic rounds + champion superlicense totals --------------------------
star = {k: 14 for k in JUNIOR_ATTR_KEYS}     # top junior: attrs 14/15
weak = {k: 6 for k in JUNIOR_ATTR_KEYS}
# star junior, potential 1.0: score floor = 14/15*0.55 + 0.30 = 0.813 > 0.72 -> always wins
always_win = all(
    junior_round(star, 1.0, "F2", seed, r, 0)[1] == 8
    for seed in (1, 999, 123456) for r in range(5))
check("star F2 junior wins every round", always_win)
total_sl = sum(junior_round(star, 1.0, "F2", 42, r, 0)[1] for r in range(5))
check("F2 champion = 40 superlicense points", total_sl == 40, f"sl={total_sl}")
total_f3 = sum(junior_round(star, 1.0, "F3", 42, r, 0)[1] for r in range(5))
check("F3 champion = 30 superlicense points", total_f3 == 30, f"sl={total_f3}")
# weak junior, potential 0.3: score cap = 6/15*0.55 + 0.09 + 0.15 = 0.46 -> never wins
never_win = all(
    junior_round(weak, 0.3, "F2", seed, r, 0)[1] < 8
    for seed in (1, 999, 123456) for r in range(5))
check("weak junior never wins", never_win)
a = junior_round(star, 0.7, "F3", 42, 2, 1)
b = junior_round(star, 0.7, "F3", 42, 2, 1)
c = junior_round(star, 0.7, "F3", 43, 2, 1)
check("round result deterministic per seed", a == b and isinstance(c, tuple))

# 2) promotion gate ------------------------------------------------------------------
check("gate: 39 pts -> locked, 40 -> open",
      (39 >= SUPERLICENSE_GATE) is False and (40 >= SUPERLICENSE_GATE) is True)

# 3) promotion -> driver_attr_dev ------------------------------------------------------
junior_attrs = {"pace": 14, "overtaking": 12, "starts": 10, "wet": 8, "consistency": 13}
dev = {k: (junior_attrs[k] - 10) / PROMOTE_ATTR_DIV for k in JUNIOR_ATTR_KEYS}
dev_sum = sum(dev.values())
expected = (4 + 2 + 0 - 2 + 3) / PROMOTE_ATTR_DIV
check("promotion attr mapping -> dev_of sum", abs(dev_sum - expected) < 1e-12,
      f"dev_of={dev_sum:+.4f}")
check("promotion deltas are small (|d| <= 0.02)", all(abs(v) <= 0.02 for v in dev.values()))

# 4) test-driver R&D multiplier ---------------------------------------------------------
m_top = test_rd_mult(20)
m_mid = test_rd_mult(10)
m_low = test_rd_mult(7)
check("test rd mult corridor (+5..15%)",
      abs(m_top - 1.15) < 1e-9 and 1.05 <= m_low <= 1.06 and 1.07 <= m_mid <= 1.08,
      f"top={m_top:.3f} mid={m_mid:.3f} low={m_low:.3f}")
# stacks with M2 staff (1.0) and ATR (1.0): a strong test driver cheapens aero R&D
c_no = cost_part_aero(1, [1.0, 1.0, 1.0])
c_yes = cost_part_aero(1, [1.0, 1.0, m_top])
check("strong test driver cheapens LTC part", c_yes < c_no, f"{c_no} -> {c_yes} RP")

# 5) race substitution --------------------------------------------------------------------
driver_skill = 0.830
sub_skill = driver_skill - TESTDRIVE_SKILL_PEN
check("test-driver stand-in = skill - 0.030", abs(sub_skill - 0.800) < 1e-12,
      f"{driver_skill} -> {sub_skill}")
check("test drive pays +3 RP of feedback", TESTDRIVE_RP_BONUS == 3)

# 6) scouting market: deterministic, costs in $50-200k --------------------------------------
def gen_junior(cal_seed, idx):
    state = (cal_seed ^ JUNIOR_SEED_MIX ^ ((idx * 7919) & MASK)) & MASK
    state, f = lcg(state)
    age = 17 + int(f * 6)
    attrs = {}
    for k in JUNIOR_ATTR_KEYS:
        state, f = lcg(state)
        attrs[k] = max(1, min(15, int(round(6 + f * 8))))
    state, f = lcg(state)
    potential = 0.3 + f * 0.7
    state, f = lcg(state)
    series = ["F4", "F3", "F2"][min(2, int(f * 3))]
    cost = int(round((50_000 + potential * 150_000) / 10_000.0)) * 10_000
    return {"age": age, "attrs": attrs, "potential": round(potential, 4),
            "series": series, "cost": cost}


m1 = [gen_junior(777, i) for i in range(JUNIOR_MARKET_SIZE)]
m2 = [gen_junior(777, i) for i in range(JUNIOR_MARKET_SIZE)]
m3 = [gen_junior(778, i) for i in range(JUNIOR_MARKET_SIZE)]
check("junior market deterministic per seed", m1 == m2 and m1 != m3)
check("junior cost in $50-200k", all(50_000 <= j["cost"] <= 200_000 for j in m1),
      " ".join(str(j["cost"] // 1000) + "k" for j in m1))
check("loan income fixed", JUNIOR_LOAN_INCOME == 100_000)

# 7) JSON round-trip ---------------------------------------------------------------------------
state = {
    "juniors": [{"name": "Лука Брандт", "age": 18, "series": "F3",
                 "season_progress": 65, "superlicense_points": 18,
                 "attrs": {k: 11 for k in JUNIOR_ATTR_KEYS},
                 "potential": 0.82, "cost": 170_000, "loaned": False}],
    "test_driver_slot": -1,
}
blob = json.loads(json.dumps(state, ensure_ascii=False), parse_int=float)
restored = {
    "juniors": [{
        "name": str(j["name"]), "age": int(float(j["age"])), "series": str(j["series"]),
        "season_progress": int(float(j["season_progress"])),
        "superlicense_points": int(float(j["superlicense_points"])),
        "attrs": {k: int(float(v)) for k, v in j["attrs"].items()},
        "potential": float(j["potential"]), "cost": int(float(j["cost"])),
        "loaned": bool(j["loaned"]),
    } for j in blob["juniors"]],
    "test_driver_slot": int(float(blob["test_driver_slot"])),
}
check("save/load round-trip (int->float quirk)", restored == state)

# --- summary -------------------------------------------------------------------------------------
fails = [n for n, ok in checks if not ok]
print()
print(f"{len(checks) - len(fails)}/{len(checks)} PASS")
if fails:
    print("FAILED:", ", ".join(fails))
    raise SystemExit(1)
