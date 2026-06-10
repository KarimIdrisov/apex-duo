# -*- coding: utf-8 -*-
# AI brain Phases 3-4 — logic mirror & checks (strategy layer).
#   M-S1  undercut cover: rivals in the pit window react to a nearby stop
#         (chance scales with strategist skill — weak ones miss it)
#   M-S2  planned two-stop where the wear maths demand it (abrasion-driven
#         track identity, strategist-gated)
#   M-S3  leader gap controller: P1 with a cushion cruises (tyres + battery)
#         instead of flat-out; resumes when the cushion shrinks
# Self-contained. Run: python ai_brain_p3_check.py
import sys

OT_GAP_S = 1.0
fails = []


def check(name, cond):
    print(("  OK   " if cond else "  FAIL ") + name)
    if not cond:
        fails.append(name)


# ---------------- M-S1: undercut cover ----------------

def cover_eligible(o, gap_s, laps_left):
    """mirror of the eligibility filter in the do_pit cover loop
    (the rng roll `unit() < 0.35 + 0.55*strat` sits on top of this)"""
    if o["finished"] or o["is_player"] or o["cover_pit"]:
        return False
    if o["pit_count"] > 0 or o["tire_wear"] < 38.0:
        return False
    if laps_left <= 8:
        return False
    return gap_s < 3.0


def cover_chance(strat):
    return 0.35 + 0.55 * strat


def mk_rival(**kw):
    o = dict(finished=False, is_player=False, cover_pit=False,
             pit_count=0, tire_wear=55.0)
    o.update(kw)
    return o


print("M-S1: undercut cover")
check("rival in window (2.1s, wear 55, 20 laps left) -> eligible",
      cover_eligible(mk_rival(), 2.1, 20))
check("too far (3.5s) -> not eligible", not cover_eligible(mk_rival(), 3.5, 20))
check("already pitted -> not eligible",
      not cover_eligible(mk_rival(pit_count=1), 2.1, 20))
check("fresh tyres (wear 30) -> no point covering",
      not cover_eligible(mk_rival(tire_wear=30.0), 2.1, 20))
check("race almost over (7 laps) -> not eligible",
      not cover_eligible(mk_rival(), 2.1, 7))
check("player car never auto-covers (his call)",
      not cover_eligible(mk_rival(is_player=True), 2.1, 20))
check("top strategist covers 90%, weak one 46%",
      abs(cover_chance(1.0) - 0.90) < 1e-9
      and abs(cover_chance(0.2) - 0.46) < 1e-9)

# ---------------- M-S2: planned two-stop ----------------

def pit_plan(laps, compound_wear, abrasion, wear_mult, strat_skill):
    """mirror of the plan computed at race init"""
    wpl = compound_wear * abrasion * wear_mult
    stints = laps * wpl / 62.0
    return 2 if (stints > 1.6 and strat_skill > 0.55) else 1


def plan2_target(laps, compound_wear, abrasion, wear_mult, base_target):
    """mirror of the 2-stop stint-sized wear target (race split into ~3
    stints; the flat -12 of the first draft left stint 2 short of the
    standard window before the flag — verified on Silverstone)"""
    wpl = compound_wear * abrasion * wear_mult
    return min(max(laps * wpl / 3.0 * 1.15, 36.0), base_target)


def plan2_first_stop_compound(laps_left):
    """mirror: a 2-stop first stop fits rubber for the stint, not the flag"""
    return "medium" if laps_left > 16 else "soft"


def want_pit_wear(tire_wear, ai_pit_wear, laps_left, pit_count, plan):
    """mirror of the wear trigger with pit_count < plan"""
    return tire_wear >= ai_pit_wear and laps_left > 6 and pit_count < plan


print("M-S2: planned two-stop")
check("medium @ abrasion 1.0, 50 laps -> one stop (stints 1.37)",
      pit_plan(50, 1.7, 1.0, 1.0, 0.8) == 1)
check("medium @ abrasion 1.25, 50 laps -> two stops (stints 1.71)",
      pit_plan(50, 1.7, 1.25, 1.0, 0.8) == 2)
check("weak strategist (0.4) never plans two",
      pit_plan(50, 1.7, 1.25, 1.0, 0.4) == 1)
check("soft start raises the maths (wear 2.6): two stops at abrasion 1.0",
      pit_plan(50, 2.6, 1.0, 1.0, 0.8) == 2)
check("street low abrasion (0.8) -> one stop",
      pit_plan(58, 1.7, 0.8, 1.0, 0.8) == 1)
check("plan 2: second wear-stop allowed (pit_count 1 < plan 2)",
      want_pit_wear(64.0, 62.0, 15, 1, 2))
check("plan 1: second wear-stop still blocked",
      not want_pit_wear(64.0, 62.0, 15, 1, 1))
t = plan2_target(52, 1.7, 1.25, 1.0, 62.0)
check("2-stop target ~42 on Silverstone maths (3 stints fit the race)",
      40.0 < t < 45.0)
check("2-stop target never below 36 / above the base window",
      plan2_target(40, 1.1, 0.8, 1.0, 62.0) == 36.0
      and plan2_target(60, 2.6, 1.4, 1.2, 50.0) == 50.0)
check("2-stop first stop fits stint rubber (medium, not hard)",
      plan2_first_stop_compound(34) == "medium"
      and plan2_first_stop_compound(14) == "soft")

# ---------------- M-S3: leader gap controller ----------------

def leader_cruise(ahead_gap, behind_gap, laps_left, tire_wear, cliff,
                  pace_mode, ers_mode, soc_avg):
    """mirror of the M-S3 override in _ai_energy: returns (pace, ers)"""
    if (ahead_gap < 0.0 and behind_gap > 4.0 and laps_left > 5
            and tire_wear < cliff - 12.0):
        if pace_mode == "balanced":
            pace_mode = "conserve"
        if ers_mode == "balanced" and soc_avg < 70.0:
            ers_mode = "harvest"
    return pace_mode, ers_mode


print("M-S3: leader gap controller")
p, e = leader_cruise(-1.0, 6.0, 30, 40.0, 78.0, "balanced", "balanced", 50.0)
check("leader, +6s cushion -> cruises (conserve + harvest)",
      p == "conserve" and e == "harvest")
p, e = leader_cruise(-1.0, 2.5, 30, 40.0, 78.0, "balanced", "balanced", 50.0)
check("cushion shrunk to 2.5s -> back to racing", p == "balanced")
p, e = leader_cruise(0.8, 6.0, 30, 40.0, 78.0, "balanced", "balanced", 50.0)
check("not the leader (car ahead) -> untouched", p == "balanced")
p, e = leader_cruise(-1.0, 6.0, 4, 40.0, 78.0, "balanced", "balanced", 50.0)
check("final laps -> no cruising to the flag", p == "balanced")
p, e = leader_cruise(-1.0, 6.0, 30, 70.0, 78.0, "conserve", "balanced", 50.0)
check("near the cliff: tyre rule already owns the pace", p == "conserve")
p, e = leader_cruise(-1.0, 6.0, 30, 40.0, 78.0, "balanced", "balanced", 75.0)
check("battery already full (75) -> no pointless harvest", e == "balanced")

print()
if fails:
    print("FAILED: %d check(s)" % len(fails))
    sys.exit(1)
print("ALL CHECKS PASSED")
