# meta_m2_staff_check.py — M2 "personnel as people" numeric verification.
# Self-contained mirror of the season.gd M2 math (LCG, staff generation,
# salaries, rd_speed_mult, cost-cap top-3 exemption, hire/leave probabilities,
# JSON int->float round-trip). Run: python3 meta_m2_staff_check.py
#
# Acceptance criteria covered (META_DESIGN.md, M2):
#  1. >=6 persistent staff with unique names; full field round-trip via JSON.
#  2. rd_speed_mult shifts LTC part cost: weak TD (0.85) >= strong (1.20);
#     difference over a season ~ 1 extra R&D step.
#  3. Top-3 staff salaries excluded from the cost cap; the 4th counts.
#  4. Hire with +$100k season salary diff -> ~65% success, deterministic.
#  5. Loyalty < 0.25 -> departure chance ~30% per round, deterministic.
#  6. (sim wiring is GDScript-side; here we verify the staff->scalar mapping)
# Extra: per-tier staff payroll stays inside the M1 income economy.

import json

MASK = 0xFFFFFFFF


def lcg(state):
    state = (state * 1664525 + 1013904223) & MASK
    return state, (state & 0xFFFF) / 65535.0


# --- constants mirrored from season.gd (M2) ---------------------------------
STAFF_SEED_MIX = 0xC0FFEE11
MARKET_SEED_MIX = 0x5EEDA77E
EVENT_SEED_MIX = 0x10C0DE
HIRE_SEED_MIX = 0x5A1E

STAFF_ROLE_ORDER = ["strategist", "engineer1", "engineer2", "pitcrew",
                    "techdir", "designer", "sporting", "testdriver"]
ROLE_ATTRS = {
    "strategist": ["strategy", "composure", "adaptability"],
    "engineer1": ["telemetry", "tyre_sense", "energy_sense", "rapport"],
    "engineer2": ["telemetry", "tyre_sense", "energy_sense", "rapport"],
    "pitcrew": ["pit_speed", "pit_consistency", "reliability_work"],
    "techdir": ["development", "aero_dev", "pu_liaison"],
    "designer": ["aero_dev", "innovation", "durability"],
    "sporting": ["negotiation", "politics", "scouting"],
    "testdriver": ["dev_feedback", "pace", "adaptability"],
}
STAFF_SALARY = {
    "techdir": (40_000, 110_000),
    "designer": (30_000, 85_000),
    "strategist": (18_000, 55_000),
    "engineer1": (12_000, 35_000),
    "engineer2": (12_000, 35_000),
    "pitcrew": (15_000, 40_000),
    "sporting": (10_000, 28_000),
    "testdriver": (8_000, 25_000),
}
STAFF_TRAITS = ["Перфекционист", "Ментор", "Рискованный стратег",
                "Верный", "Амбициозный"]
STAFF_FIRST = ["Джеймс", "Питер", "Лука", "Марко", "Ян", "Карлос", "Том",
               "Рори", "Энцо", "Пьер", "Андреа", "Микель", "Роберт",
               "Даниэль", "Хуан", "Лоран"]
STAFF_LAST = ["Кларк", "Бьянки", "Майер", "Сато", "Линдгрен", "Мендес",
              "Уокер", "Краус", "Дюбуа", "Ковач", "Сильва", "Брандт",
              "Моретти", "Ярвинен", "Греко", "Холт"]

RD_SPEED_MULT_MIN = 0.85
RD_SPEED_MULT_MAX = 1.20
STAFF_CAP_EXEMPT = 3
STAFF_MARKET_EVERY = 2
STAFF_MARKET_SIZE = 4
HIRE_BASE = 0.50
HIRE_SALARY_K = 0.15        # per $100k of per-season salary diff
HIRE_LOYALTY_K = 0.4
HIRE_REP_BONUS = 0.20
LEAVE_LOYALTY = 0.25
LEAVE_PROB = 0.30
ROUNDS_PER_SEASON = 5
SALARY_CAP = 4_000_000
CAP_PENALTY_DIVISOR = 100_000


def salary_for(role, overall):
    lo, hi = STAFF_SALARY[role]
    t = min(1.0, max(0.0, (overall - 6.0) / 12.0))
    return int(round((lo + t * (hi - lo)) / 1000.0)) * 1000


def gen_staff_member(role, role_idx, strength, state, taken_names):
    """Mirror of season.gd _gen_staff_member: fixed LCG draw order:
    first-name, last-name, per-attr, age, loyalty, trait, dev_rate."""
    state, f = lcg(state)
    fi = min(int(f * len(STAFF_FIRST)), len(STAFF_FIRST) - 1)
    state, f = lcg(state)
    li = min(int(f * len(STAFF_LAST)), len(STAFF_LAST) - 1)
    name = STAFF_FIRST[fi] + " " + STAFF_LAST[li]
    probe = 0
    while name in taken_names and probe < 32:
        probe += 1
        li = (li + 1) % len(STAFF_LAST)
        name = STAFF_FIRST[fi] + " " + STAFF_LAST[li]
    taken_names.add(name)

    base = 6.0 + max(0.0, min(1.0, strength)) * 12.0
    attrs = {}
    for k in ROLE_ATTRS[role]:
        state, f = lcg(state)
        attrs[k] = max(1, min(20, int(round(base + (f - 0.5) * 5.0))))
    state, f = lcg(state)
    age = 28 + int(f * 34)
    state, f = lcg(state)
    loyalty = 0.35 + f * 0.6
    state, f = lcg(state)
    trait = STAFF_TRAITS[min(int(f * len(STAFF_TRAITS)), len(STAFF_TRAITS) - 1)]
    state, f = lcg(state)
    dev_rate = 0.2 + f * 0.8

    primary = ROLE_ATTRS[role][0]
    if trait == "Перфекционист":
        attrs[primary] = min(20, attrs[primary] + 2)
    elif trait == "Рискованный стратег" and "strategy" in attrs:
        attrs["strategy"] = min(20, attrs["strategy"] + 3)
    elif trait == "Верный":
        loyalty = max(loyalty, 0.7)

    overall = round(sum(attrs.values()) / float(len(attrs)))
    return state, {
        "role": role, "name": name, "age": age,
        "salary": salary_for(role, overall),
        "loyalty": round(loyalty, 4), "trait": trait,
        "dev_rate": round(dev_rate, 4), "gardening": 0, "attrs": attrs,
    }


def init_staff(cal_seed, team_idx, n_teams=11):
    strength = 1.0 - min(max(team_idx, 0), n_teams - 1) / float(n_teams - 1)
    state = (cal_seed ^ STAFF_SEED_MIX) & MASK
    taken = set()
    out = []
    for i, role in enumerate(STAFF_ROLE_ORDER):
        state, m = gen_staff_member(role, i, strength, state, taken)
        out.append(m)
    return out


def rd_speed_mult(staff):
    td = des = 10
    for m in staff:
        if m["role"] == "techdir":
            td = m["attrs"]["development"]
        elif m["role"] == "designer":
            des = m["attrs"]["aero_dev"]
    avg = (td + des) / 2.0
    return max(RD_SPEED_MULT_MIN,
               min(RD_SPEED_MULT_MAX, 0.85 + (avg - 6.0) / 12.0 * 0.35))


def cost_part_aero(level, mult):
    return max(1, int(round((5 + level * 3) / mult)))


def hire_probability(offer_salary, cur_salary, loyalty, constructor_pos):
    rep = 0.0
    if constructor_pos <= 3:
        rep = HIRE_REP_BONUS
    elif constructor_pos >= 8:
        rep = -HIRE_REP_BONUS
    season_diff = (offer_salary - cur_salary) * ROUNDS_PER_SEASON
    p = (HIRE_BASE + HIRE_SALARY_K * season_diff / 100_000.0 + rep
         - (loyalty - 0.5) * HIRE_LOYALTY_K)
    return max(0.05, min(0.95, p))


def staff_cap_spend(staff):
    """Per-round staff salary counted toward the cap: all minus top-3."""
    sals = sorted((m["salary"] for m in staff), reverse=True)
    return sum(sals[STAFF_CAP_EXEMPT:])


checks = []


def check(name, ok, detail=""):
    checks.append((name, ok))
    print(("PASS" if ok else "FAIL"), "-", name, ("| " + detail if detail else ""))


# 1) determinism + uniqueness ------------------------------------------------
a = init_staff(123456, 4)
b = init_staff(123456, 4)
c = init_staff(123457, 4)
names = [m["name"] for m in a]
check("staff deterministic from seed", a == b)
check("different seed -> different staff", a != c)
check(">=6 staff, unique names", len(a) >= 6 and len(set(names)) == len(names),
      f"{len(a)} people")

# 2) rd_speed_mult corridor + cost effect -------------------------------------
weak = [{"role": "techdir", "attrs": {"development": 6, "aero_dev": 6, "pu_liaison": 6}},
        {"role": "designer", "attrs": {"aero_dev": 6, "innovation": 6, "durability": 6}}]
strong = [{"role": "techdir", "attrs": {"development": 18, "aero_dev": 18, "pu_liaison": 18}},
          {"role": "designer", "attrs": {"aero_dev": 18, "innovation": 18, "durability": 18}}]
mw, ms = rd_speed_mult(weak), rd_speed_mult(strong)
check("rd_speed_mult corridor 0.85..1.20",
      abs(mw - 0.85) < 1e-9 and abs(ms - 1.20) < 1e-9, f"weak={mw:.2f} strong={ms:.2f}")
# season cost of one full aero part (levels 0->1->2) + a second part level 0->1
season_weak = cost_part_aero(0, mw) + cost_part_aero(1, mw) + cost_part_aero(0, mw)
season_strong = cost_part_aero(0, ms) + cost_part_aero(1, ms) + cost_part_aero(0, ms)
diff = season_weak - season_strong
check("weak TD costs more; gap ~ 1 R&D step over a season",
      season_weak > season_strong and 4 <= diff <= 8,
      f"weak={season_weak} RP strong={season_strong} RP diff={diff}")

# 3) cost-cap top-3 exemption --------------------------------------------------
base_staff = init_staff(99, 4)
spend0 = staff_cap_spend(base_staff)
expensive_td = dict(base_staff[4])
expensive_td["salary"] = 500_000          # techdir -> clearly top-1
staff_td = [expensive_td if m["role"] == "techdir" else m for m in base_staff]
spend_td = staff_cap_spend(staff_td)
# raising the 4th-highest salary must raise the counted spend
sals = sorted(((m["salary"], m["role"]) for m in base_staff), reverse=True)
fourth_role = sals[3][1]
staff_4th = [dict(m, salary=m["salary"] + 50_000) if m["role"] == fourth_role else m
             for m in base_staff]
spend_4th = staff_cap_spend(staff_4th)
check("expensive top-3 (TD) does NOT raise cap spend", spend_td <= spend0,
      f"base={spend0} with500kTD={spend_td}")
check("expensive 4th salary DOES raise cap spend", spend_4th > spend0,
      f"base={spend0} 4th+50k={spend_4th}")

# 4) hire probability ----------------------------------------------------------
# +$100k per-season diff, neutral rep (P5), neutral loyalty 0.5 -> 0.65
p = hire_probability(20_000 + 0, 0, 0.5, 5)
# craft exact: per-season diff = 100k -> per-round diff = 20k
p100 = hire_probability(70_000, 50_000, 0.5, 5)
check("hire prob +100k/season = 65%", abs(p100 - 0.65) < 1e-9, f"p={p100:.3f}")
check("hire prob: top team rep +20%",
      abs(hire_probability(70_000, 50_000, 0.5, 1) - 0.85) < 1e-9)
check("hire prob: loyal candidate harder",
      hire_probability(70_000, 50_000, 0.9, 5) < p100)
# determinism of the roll itself
def hire_roll(cal_seed, epoch, cand_id):
    s = (cal_seed ^ HIRE_SEED_MIX ^ (epoch * 2654435761) ^ (cand_id * 97003)) & MASK
    _, f = lcg(s)
    return f
check("hire roll deterministic",
      hire_roll(42, 1, 2) == hire_roll(42, 1, 2)
      and hire_roll(42, 1, 2) != hire_roll(42, 1, 3))

# 5) departure frequency ~30% ---------------------------------------------------
hits = 0
n = 4000
for seed in range(n):
    s = (seed ^ EVENT_SEED_MIX ^ (3 * 2654435761) ^ (2 * 97003)) & MASK
    _, f = lcg(s)
    if f < LEAVE_PROB:
        hits += 1
freq = hits / n
check("departure roll ~30% across seeds", 0.27 <= freq <= 0.33, f"freq={freq:.3f}")

# 6) economy: per-tier payroll inside M1 income corridors -----------------------
for tier_name, tidx, cap in [("contender(McLaren,0)", 0, 450_000),
                             ("mid(Williams,4)", 4, 330_000),
                             ("underdog(Cadillac,10)", 10, 220_000)]:
    st = init_staff(777, tidx)
    payroll = sum(m["salary"] for m in st)
    check(f"payroll {tier_name} <= {cap}", payroll <= cap, f"payroll={payroll}")

# cap headroom: mid tier drivers (2x200k) + non-exempt staff over 5 rounds < cap
mid_staff = init_staff(777, 4)
season_spend = 2 * 200_000 * ROUNDS_PER_SEASON + staff_cap_spend(mid_staff) * ROUNDS_PER_SEASON
check("mid tier stays under cap with default contracts",
      season_spend < SALARY_CAP, f"season_spend={season_spend}")

# 7) JSON int->float round-trip --------------------------------------------------
blob = json.loads(json.dumps({"staff": a}, ensure_ascii=False),
                  parse_int=float)  # Godot JSON returns floats for all numbers
restored = []
for m in blob["staff"]:
    restored.append({
        "role": str(m["role"]), "name": str(m["name"]),
        "age": int(float(m["age"])), "salary": int(float(m["salary"])),
        "loyalty": float(m["loyalty"]), "trait": str(m["trait"]),
        "dev_rate": float(m["dev_rate"]), "gardening": int(float(m["gardening"])),
        "attrs": {k: int(float(v)) for k, v in m["attrs"].items()},
    })
check("save/load round-trip (int->float quirk)", restored == a)

# --- summary --------------------------------------------------------------------
fails = [n for n, ok in checks if not ok]
print()
print(f"{len(checks) - len(fails)}/{len(checks)} PASS")
if fails:
    print("FAILED:", ", ".join(fails))
    raise SystemExit(1)
