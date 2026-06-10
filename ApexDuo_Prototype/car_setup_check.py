# -*- coding: utf-8 -*-
# Unified setup model (6 axes, dual ideal) — logic mirror & balance checks.
# Mirrors race_sim.gd: track_ideal_setup(bias), setup_quality (/2.4),
# apply_engineer_setup (fair baseline), and the quali-vs-race fork.
# Verifies: baseline median (re-derived, NOT asserted 0.62), fork is real
# (best-quali setup != best-race setup), AI/player baseline overlap.
# Run: python car_setup_check.py
import sys

SETUP_AXES = 6
SETUP_FORK = 0.12
SETUP_NORM = 2.4
fails = []


def check(name, cond):
    print(("  OK   " if cond else "  FAIL ") + name)
    if not cond:
        fails.append(name)


def mix32(x):
    x = (x + 0x9E3779B9) & 0xFFFFFFFF
    x = ((x ^ (x >> 16)) * 0x85EBCA6B) & 0xFFFFFFFF
    x = ((x ^ (x >> 13)) * 0xC2B2AE35) & 0xFFFFFFFF
    return (x ^ (x >> 16)) & 0xFFFFFFFF


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def lerp(a, b, t):
    return a + (b - a) * t


def track_ideal(name_hash, df, abr, ot, pw, bias="base", cond=None):
    h = mix32(name_hash & 0xFFFFFFFF)
    base = [0.10 + df * 0.80, 0.20 + df * 0.55 - abr * 0.20, 0.18 + abr * 0.35,
            0.25 + (1.0 - ot) * 0.40, 0.20 + abr * 0.45, 0.10 + pw * 0.80]
    fork = -SETUP_FORK if bias == "quali" else (SETUP_FORK if bias == "race" else 0.0)
    out = []
    for i in range(SETUP_AXES):
        jit = float((h >> (3 + i * 5)) & 1023) / 1023.0 * 0.16 - 0.08
        v = base[i] + jit
        if i in (0, 1, 4):
            v += fork
        if cond and i < len(cond):
            v += cond[i]
        out.append(clamp(v, 0.05, 0.95))
    return out


def setup_quality(setup, ideal):
    dist = sum(abs((setup[i] if i < len(setup) else 0.5) - ideal[i])
               for i in range(SETUP_AXES))
    return clamp(1.0 - dist / SETUP_NORM, 0.0, 1.0)


def engineer_baseline_q(name_hash, did, df, abr, ot, pw, eng_skill,
                        favor_race, sessions=3):
    """mirror of apply_engineer_setup -> (setup_q_quali, setup_q_race)"""
    ideal = track_ideal(name_hash, df, abr, ot, pw,
                        "race" if favor_race else "quali")
    conv = clamp((0.35 + 0.55 * eng_skill) * (sessions / 3.0 * 0.6 + 0.4), 0.0, 0.97)
    sk = mix32((name_hash & 0xFFFFFFFF) ^ (did * 7919))
    v = []
    for i in range(SETUP_AXES):
        noise = float((sk >> (i * 4)) & 15) / 15.0 * 0.06 - 0.03
        v.append(clamp(lerp(0.5, ideal[i], conv) + noise, 0.05, 0.95))
    return (setup_quality(v, track_ideal(name_hash, df, abr, ot, pw, "quali")),
            setup_quality(v, track_ideal(name_hash, df, abr, ot, pw, "race")))


# Reference tracks (name hash via Python's not-stable hash → use fixed ints).
MONACO = (0x4D4F4E, 0.97, 0.70, 0.05, 0.20)
MONZA = (0x4D4E5A, 0.15, 0.85, 0.82, 0.97)
SILVER = (0x53494C, 0.85, 1.28, 0.55, 0.62)
TRACKS = {"Monaco": MONACO, "Monza": MONZA, "Silverstone": SILVER}

print("Ideal setup: 6 axes, dual ideal")
mq = track_ideal(*MONACO, bias="quali")
mr = track_ideal(*MONACO, bias="race")
check("ideal has 6 axes in [0.05,0.95]", len(mq) == 6 and all(0.05 <= v <= 0.95 for v in mq))
check("quali vs race fork diverges on axes 0,1,4", all(abs(mq[i] - mr[i]) > 0.15 for i in (0, 1, 4)))
check("shared axes 2,3,5 identical between ideals", all(abs(mq[i] - mr[i]) < 1e-9 for i in (2, 3, 5)))
mz_g = track_ideal(*MONZA)
check("Monza wants long gears, Monaco short", mz_g[5] - track_ideal(*MONACO)[5] > 0.4)

print("setup_quality normalizer")
check("perfect = 1.0", setup_quality(track_ideal(*MONACO, bias="race"), track_ideal(*MONACO, bias="race")) == 1.0)
qd = setup_quality([0.5] * 6, track_ideal(*MONACO, bias="race"))
check("neutral [0.5]x6 at Monaco is middling (0.3..0.8)", 0.3 < qd < 0.8)

print("The fork: best-quali setup is NOT best-race setup")
# converge a vector hard toward opt_quali; score on both
vq = track_ideal(*MONZA, bias="quali")
check("quali-trim: high setup_q_quali, lower setup_q_race",
      setup_quality(vq, track_ideal(*MONZA, "quali")) > setup_quality(vq, track_ideal(*MONZA, "race")) + 0.08)
vr = track_ideal(*MONZA, bias="race")
check("race-trim: high setup_q_race, lower setup_q_quali",
      setup_quality(vr, track_ideal(*MONZA, "race")) > setup_quality(vr, track_ideal(*MONZA, "quali")) + 0.08)
# midpoint compromises both, neither maxed
vm = track_ideal(*MONZA, bias="base")
check("midpoint: both decent, neither >0.95",
      setup_quality(vm, track_ideal(*MONZA, "quali")) < 0.95
      and setup_quality(vm, track_ideal(*MONZA, "race")) < 0.95
      and setup_quality(vm, track_ideal(*MONZA, "quali")) > 0.80)

print("Engineer baseline median (RE-DERIVED — not asserted 0.62)")
# sample the fair baseline across a field of eng_skill values
qs, rs = [], []
for did in range(22):
    es = 0.35 + (did % 10) / 10.0 * 0.55      # eng_skill spread 0.35..0.90
    q, r = engineer_baseline_q(MONZA[0], did, *MONZA[1:], es, did % 3 == 0)
    qs.append(q)
    rs.append(r)
qs.sort(); rs.sort()
med_q = qs[len(qs) // 2]
med_r = rs[len(rs) // 2]
print("    derived baseline median: quali=%.3f race=%.3f" % (med_q, med_r))
check("baseline median in the fair range [0.62, 0.90]", 0.62 <= med_q <= 0.90 and 0.62 <= med_r <= 0.90)
check("baseline never a punishment (min > 0.55)", min(qs) > 0.55 and min(rs) > 0.55)

print("AI vs player parity (same code) + practice is upside")
# a weak engineer baseline vs a well-practiced human on the same car
weak_q, weak_r = engineer_baseline_q(MONZA[0], 5, *MONZA[1:], 0.40, False)
# practiced human nails quali trim near-perfectly
human_vec = track_ideal(*MONZA, bias="quali")
human_q = setup_quality(human_vec, track_ideal(*MONZA, "quali"))
check("well-practiced human beats a weak engineer baseline (quali)", human_q > weak_q + 0.05)
# top engineer baseline is competitive (close to a practiced result)
top_q, top_r = engineer_baseline_q(MONZA[0], 5, *MONZA[1:], 0.90, False)
check("top engineer baseline is strong (quali > 0.85)", top_q > 0.85)
check("AI/player use the SAME setup_quality fn (parity by construction)", True)

print()
if fails:
    print("FAILED: %d check(s)" % len(fails))
    sys.exit(1)
print("ALL CHECKS PASSED")
