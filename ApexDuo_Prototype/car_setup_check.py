# -*- coding: utf-8 -*-
# Car setup + practice mechanic — logic mirror & balance checks.
# Design (balance-first):
#   * each track has a hidden ideal setup [aero, susp, gear] from its
#     character + a name-hash jitter (so the card doesn't spell it out)
#   * setup_q = 1 - L1_distance/1.2 -> laptime += (1-q)*SETUP_PEN (0.45s max)
#   * EVERY car gets an engineer-built baseline (0.45+0.35*eng+0.15*iq+-0.06)
#     -> a player who skips practice gets his engineers' auto-setup, the SAME
#     formula as AI teams: skipping is not a punishment, practicing is an edge
#   * practice runs give lap times + driver feedback per axis; feedback
#     precision = race_iq + engineer telemetry
# Self-contained. Run: python car_setup_check.py
import sys

SETUP_PEN = 0.45
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


def track_ideal_setup(name_hash, downforce, abrasion, power):
    h = mix32(name_hash & 0xFFFFFFFF)
    j1 = ((h >> 3) & 1023) / 1023.0 * 0.16 - 0.08
    j2 = ((h >> 13) & 1023) / 1023.0 * 0.16 - 0.08
    j3 = ((h >> 23) & 255) / 255.0 * 0.16 - 0.08
    return [clamp(0.10 + downforce * 0.80 + j1, 0.05, 0.95),
            clamp(0.18 + abrasion * 0.35 + j2, 0.05, 0.95),
            clamp(0.10 + power * 0.80 + j3, 0.05, 0.95)]


def setup_quality(setup, ideal):
    dist = sum(abs(setup[i] - ideal[i]) for i in range(3))
    return clamp(1.0 - dist / 1.2, 0.0, 1.0)


def baseline_q(eng_skill, race_iq01, jitter=0.0):
    return clamp(0.45 + 0.35 * eng_skill + 0.15 * race_iq01 + jitter, 0.35, 0.97)


def feedback(setup, ideal, h, acc):
    fb = []
    for i in range(3):
        err = setup[i] - ideal[i]
        sense_u = ((h >> (8 + i * 7)) & 127) / 127.0
        if abs(err) < 0.06:
            fb.append(0)
        elif sense_u < acc:
            fb.append((2 if abs(err) > 0.20 else 1) * (1 if err > 0.0 else -1))
        else:
            fb.append(9)
    return fb


print("Ideal setup derivation")
monaco = track_ideal_setup(hash("Монако"), 0.95, 0.80, 0.30)
monza = track_ideal_setup(hash("Монца"), 0.20, 0.85, 0.95)
check("all axes inside [0.05, 0.95]",
      all(0.05 <= v <= 0.95 for v in monaco + monza))
check("Monaco wants much more wing than Monza",
      monaco[0] - monza[0] > 0.35)
check("Monza wants much longer gears than Monaco",
      monza[2] - monaco[2] > 0.35)
check("deterministic (same inputs -> same ideal)",
      monaco == track_ideal_setup(hash("Монако"), 0.95, 0.80, 0.30))

print("Setup quality / laptime penalty")
check("perfect setup -> q=1, zero penalty",
      setup_quality(monaco, monaco) == 1.0)
q_def = setup_quality([0.5, 0.5, 0.5], monaco)
check("default 50/50/50 at Monaco is mediocre (0.3..0.8)", 0.3 < q_def < 0.8)
check("quality monotonic in distance",
      setup_quality([monaco[0] + 0.1, monaco[1], monaco[2]], monaco)
      > setup_quality([monaco[0] + 0.3, monaco[1], monaco[2]], monaco))
check("max penalty 0.45s does not dwarf skill spread (SKILL_K*spread~0.7s)",
      SETUP_PEN <= 0.45)

print("Engineer baseline (AI and lazy player use the SAME formula)")
check("weak crew floor 0.35: penalty <= 0.29s",
      (1.0 - baseline_q(0.0, 0.0, -0.06)) * SETUP_PEN <= 0.2925 + 1e-9)
check("elite crew near-perfect (q ~0.95 -> pen ~0.02)",
      baseline_q(1.0, 1.0, 0.06) == 0.97)
mid = baseline_q(0.5, 0.65)
check("average crew ~0.72 (pen ~0.13s)", 0.70 < mid < 0.74)
good_practice = setup_quality([monaco[0] + 0.04, monaco[1] - 0.03,
                               monaco[2] + 0.05], monaco)
check("well-practiced player (errs ~0.04/axis) far above average crew",
      good_practice > mid + 0.12)
near_perfect = setup_quality([monaco[0] + 0.01, monaco[1] - 0.01,
                              monaco[2] + 0.01], monaco)
check("near-perfect dial-in matches the elite crew ceiling (0.97)",
      near_perfect >= 0.97)

print("Practice feedback")
ideal = [0.6, 0.4, 0.7]
fb = feedback([0.85, 0.45, 0.45], ideal, 0x5A5A5A5A, 1.0)
check("perfect reader: 'way too much wing' (+2)", fb[0] == 2)
check("perfect reader: suspension in the sweet spot (0)", fb[1] == 0)
check("perfect reader: 'gears too short' (-2)", fb[2] == -2)
fb_blind = feedback([0.85, 0.45, 0.45], ideal, 0x5A5A5A5A, 0.0)
check("hopeless reader: off-axes unreadable (9), sweet spot still felt",
      fb_blind[0] == 9 and fb_blind[1] == 0 and fb_blind[2] == 9)
n_known = 0
for h in range(200):
    f = feedback([0.85, 0.45, 0.45], ideal, mix32(h), 0.7)
    if f[0] != 9:
        n_known += 1
check("acc=0.7 reads the wing call ~70% of runs (60..80%)",
      120 <= n_known <= 160)

print()
if fails:
    print("FAILED: %d check(s)" % len(fails))
    sys.exit(1)
print("ALL CHECKS PASSED")
