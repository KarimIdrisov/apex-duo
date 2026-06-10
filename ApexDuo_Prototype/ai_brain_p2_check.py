# -*- coding: utf-8 -*-
# AI brain Phase 2 — logic mirror & checks. Balance-first framing:
#   P2-F  player order fairness: "attack"/"hold" become sector-aware (parity
#         with the AI brain's banking smarts — orders must not be a trap)
#   M-D1  defensive ERS is sector-targeted (spend where the attacker strikes;
#         defense costs battery -> battery poker, not a free stat bonus)
#   M-C1  pass-sticks: the passed car gets a mood hit + short attack freeze
#         (no instant re-pass ping-pong)
#   M-D2  pressure scalar: sustained siege raises the defender's error risk,
#         scaled by composure; decays when the threat is gone
# Self-contained. Run: python ai_brain_p2_check.py
import sys

OT_GAP_S = 1.0
fails = []


def check(name, cond):
    print(("  OK   " if cond else "  FAIL ") + name)
    if not cond:
        fails.append(name)


def attr(d, key):
    return d.get(key, 13) / 20.0


def drs_armable(sector_chars, cur_sector, sector_frac):
    if not sector_chars:
        return True
    if sector_chars[cur_sector]["drs"]:
        return True
    nsi = (cur_sector + 1) % 3
    return sector_chars[nsi]["drs"] and sector_frac > 0.8


# ---------------- P2-F: player brain, sector-aware orders ----------------

def player_attack_order(d, ahead_gap, sector_chars, cur_sector, sector_frac):
    """mirror of the new dir_intent == "attack" branch in _player_brain"""
    in_range = 0.0 <= ahead_gap < OT_GAP_S and d["soc_avg"] > 35.0
    if in_range and drs_armable(sector_chars, cur_sector, sector_frac):
        return "attack", True
    if in_range:
        # banking sector: charge for the zone instead of burning attack
        return ("harvest" if d["soc_avg"] < 50.0 else "balanced"), False
    return "balanced", False


def player_hold_order(d, behind_gap, sector_chars, cur_sector, sector_frac):
    """mirror of the new dir_intent == "hold" branch in _player_brain"""
    threat = 0.0 <= behind_gap < OT_GAP_S and d["soc_avg"] > 50.0
    if threat and drs_armable(sector_chars, cur_sector, sector_frac):
        return "attack", False     # defensive spend where the attacker strikes
    if threat:
        return "balanced", False   # hold pace, bank for the zone
    return "balanced", False


# ---------------- M-D1: AI defensive spend is sector-targeted ----------------

def ai_defense(d, behind_gap, floor_soc, sector_chars, cur_sector, sector_frac):
    """mirror of the behind-threat branch in _situational_energy"""
    if 0.0 <= behind_gap < OT_GAP_S and d["soc_avg"] > floor_soc + 12.0:
        if drs_armable(sector_chars, cur_sector, sector_frac):
            return "attack", False
        return "balanced", False
    return None


# ---------------- M-C1: pass-sticks ----------------

def pass_sticks(loser, winner):
    """mirror of the pass-completion bundle in _resolve_combat.
    Deterministic, no rng. Loser: rattled + short attack freeze (his
    attack_laps go negative -> needs laps to re-commit). Winner: nothing
    extra (the boost already carried him; the freeze kills the ping-pong)."""
    comp = attr(loser, "composure")
    loser["mood"] = max(-1.0, loser["mood"] - (0.20 + 0.20 * (1.0 - comp)))
    loser["attack_laps"] = -2
    loser["atk_latch"] = False
    loser["pressure"] = 0.0       # the fight is over; the hunt restarts


# ---------------- M-D2: pressure ----------------

def update_pressure(d, hunted_now):
    """mirror of the per-lap pressure update in _on_lap_complete"""
    comp = attr(d, "composure")
    if hunted_now:
        d["pressure"] = min(1.0, d["pressure"] + 0.12)
    else:
        d["pressure"] = max(0.0, d["pressure"] - (0.15 + 0.35 * comp))


def pressure_risk_factor(d):
    """mirror of the multiplier added to the incident-risk cond in step()"""
    comp = attr(d, "composure")
    return 1.0 + d["pressure"] * 0.8 * (1.2 - comp)


def mk(**kw):
    d = dict(soc_avg=60.0, mood=0.0, pressure=0.0, attack_laps=3,
             atk_latch=True, composure=13)
    d.update(kw)
    return d


MONACO = [{"drs": False}, {"drs": False}, {"drs": False}]
MONZA = [{"drs": False}, {"drs": True}, {"drs": True}]

# ---------------- P2-F checks ----------------
print("P2-F: player orders are sector-aware (parity with AI)")
m, ot = player_attack_order(mk(soc_avg=40.0), 0.6, MONZA, 1, 0.4)
check("attack order, DRS sector -> attack+overtake", m == "attack" and ot)
m, ot = player_attack_order(mk(soc_avg=40.0), 0.6, MONZA, 0, 0.4)
check("attack order, banking sector, soc 40 -> harvest (not wasted attack)",
      m == "harvest" and not ot)
m, ot = player_attack_order(mk(soc_avg=70.0), 0.6, MONZA, 0, 0.4)
check("attack order, banking sector, battery ready -> balanced",
      m == "balanced" and not ot)
m, ot = player_attack_order(mk(soc_avg=70.0), 0.6, MONZA, 0, 0.85)
check("attack order, run-up to DRS sector -> pre-arms", m == "attack" and ot)
m, ot = player_attack_order(mk(soc_avg=70.0), 2.0, MONZA, 1, 0.4)
check("attack order, nobody in range -> balanced", m == "balanced" and not ot)
m, ot = player_attack_order(mk(soc_avg=70.0), 0.6, MONACO, 1, 0.4)
check("attack order at Monaco -> never burns attack mode", m == "balanced")
m, ot = player_hold_order(mk(soc_avg=70.0), 0.5, MONZA, 1, 0.4)
check("hold order, threat behind, DRS sector -> defensive spend",
      m == "attack" and not ot)
m, ot = player_hold_order(mk(soc_avg=70.0), 0.5, MONZA, 0, 0.4)
check("hold order, threat behind, banking sector -> balanced (bank)",
      m == "balanced")
m, ot = player_hold_order(mk(soc_avg=70.0), 2.5, MONZA, 1, 0.4)
check("hold order, no threat -> balanced", m == "balanced")
m, ot = player_hold_order(mk(soc_avg=40.0), 0.5, MONZA, 1, 0.4)
check("hold order, battery low (<50) -> no defensive spend", m == "balanced")

# ---------------- M-D1 checks ----------------
print("M-D1: AI defensive spend sector-targeted")
r = ai_defense(mk(soc_avg=70.0), 0.5, 46.0, MONZA, 1, 0.4)
check("threat behind, DRS sector, battery rich -> defensive attack",
      r == ("attack", False))
r = ai_defense(mk(soc_avg=70.0), 0.5, 46.0, MONZA, 0, 0.4)
check("threat behind, banking sector -> balanced (no waste)",
      r == ("balanced", False))
r = ai_defense(mk(soc_avg=70.0), 0.5, 46.0, MONACO, 1, 0.4)
check("Monaco: no defensive battery war (boost dead anyway)",
      r == ("balanced", False))
r = ai_defense(mk(soc_avg=50.0), 0.5, 46.0, MONZA, 1, 0.4)
check("threat behind but battery poor (<floor+12) -> no spend", r is None)

# ---------------- M-C1 checks ----------------
print("M-C1: pass-sticks")
lo = mk(mood=0.3, composure=8)        # comp 0.4
pass_sticks(lo, mk())
check("loser rattled: mood 0.3 -> ~-0.02 (comp-scaled hit)",
      abs(lo["mood"] - (0.3 - 0.32)) < 1e-9)
check("loser attack frozen (attack_laps=-2, latch off, pressure reset)",
      lo["attack_laps"] == -2 and not lo["atk_latch"] and lo["pressure"] == 0.0)
hi = mk(mood=0.3, composure=18)       # comp 0.9
pass_sticks(hi, mk())
check("composed loser shrugs it off more (smaller mood hit)",
      hi["mood"] > lo["mood"])

# ---------------- M-D2 checks ----------------
print("M-D2: pressure")
d = mk(pressure=0.0, composure=10)
for lap in range(6):
    update_pressure(d, True)
check("6 laps hunted -> pressure 0.72", abs(d["pressure"] - 0.72) < 1e-9)
rf = pressure_risk_factor(d)
check("risk factor ~1.4x for comp 0.5 at p=0.72",
      abs(rf - (1.0 + 0.72 * 0.8 * 0.7)) < 1e-9)
d_cool = mk(pressure=0.72, composure=18)
d_hot = mk(pressure=0.72, composure=6)
check("low composure suffers more under the same siege",
      pressure_risk_factor(d_hot) > pressure_risk_factor(d_cool))
update_pressure(d_cool, False)
update_pressure(d_hot, False)
check("composed driver sheds pressure faster",
      d_cool["pressure"] < d_hot["pressure"])
for lap in range(4):
    update_pressure(d_hot, False)
check("pressure fully decays once free", d_hot["pressure"] == 0.0)
check("hunter carries no pressure factor when calm: rf == 1.0",
      pressure_risk_factor(mk(pressure=0.0)) == 1.0)

print()
if fails:
    print("FAILED: %d check(s)" % len(fails))
    sys.exit(1)
print("ALL CHECKS PASSED")
