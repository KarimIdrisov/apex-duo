# -*- coding: utf-8 -*-
# AI brain Phase 1 (M-A1 sector-aware attack, M-A2 patience/back-off, M-A3
# final-laps battery dump) — logic mirror of the new _situational_energy /
# _on_lap_complete accounting in race_sim.gd. Self-contained (no imports of
# other scratch files). Run: python ai_brain_p1_check.py
import sys

OT_GAP_S = 1.0
PASS_RESIST_MONACO = 3.0 + 8.0 * (1.0 - 0.05)   # track.overtaking=0.05 -> 10.6
PASS_RESIST_MONZA = 3.0 + 8.0 * (1.0 - 0.90)    # 3.8

fails = []


def check(name, cond):
    print(("  OK   " if cond else "  FAIL ") + name)
    if not cond:
        fails.append(name)


# ---------------- mirrors of the new GDScript ----------------

def attr(d, key):
    return d.get(key, 13) / 20.0


def drs_armable(sector_chars, cur_sector, sector_frac):
    """mirror of _drs_armable()"""
    if not sector_chars:
        return True
    if sector_chars[cur_sector]["drs"]:
        return True
    nsi = (cur_sector + 1) % 3
    return sector_chars[nsi]["drs"] and sector_frac > 0.8


def patience_laps(d):
    """mirror of _patience_laps()"""
    p = 2.0 + attr(d, "race_iq") * 2.0 + attr(d, "composure") * 2.0 \
        - min(max(attr(d, "aggression") - attr(d, "discipline"), 0.0), 1.0) * 2.0
    return max(1, int(p))


def situational_energy(d, ahead_gap, behind_gap, laps_left, sector_chars,
                       cur_sector, sector_frac):
    """mirror of the new _situational_energy() (without the old harvest
    lookahead tail, which is unchanged). Returns (ers_mode, overtake,
    floor_soc, hard_floor) so M-A3 thresholds are inspectable."""
    aggr = attr(d, "aggression")
    attacking = d["ers_mode"] == "attack" or d["atk_latch"]
    atk_on = 56.0 - aggr * 10.0
    atk_off = 34.0 - aggr * 8.0
    floor_soc = atk_off if attacking else atk_on
    hard_floor = 24.0
    if laps_left <= 3:                      # M-A3: 3 left -> 50%, 2 -> 25%, last lap -> all-in
        k = max(0.0, laps_left - 1.0) / 4.0
        floor_soc = 12.0 + (floor_soc - 12.0) * k
        hard_floor = 14.0
    if d["soc_avg"] < hard_floor:
        d["atk_latch"] = False
        return "harvest", False, floor_soc, hard_floor
    # Committed fighters (camped 1+ laps) work with a lower SoC bar and a
    # slightly wider window: the engage thresholds were tuned for cruising,
    # but a driver already in the fight commits deliberately (2026: harvest
    # in the tow, then deploy in the zone).
    committed = d["attack_laps"] >= 1
    if committed:
        floor_soc = min(floor_soc, atk_off + 10.0)
    window = OT_GAP_S * (1.3 if committed else 1.0)
    in_fight = (0.0 <= ahead_gap < window and aggr > 0.45
                and not d["attack_backed"])
    if in_fight:
        if (drs_armable(sector_chars, cur_sector, sector_frac)
                and d["soc_avg"] > floor_soc):                   # M-A1
            d["atk_latch"] = True
            return "attack", True, floor_soc, hard_floor
        # not attacking right now (banking sector or battery not ready):
        # actively charge for the zone; the latch keeps the fight live —
        # unless the spell's charge is spent (below atk_off): then the next
        # engage must climb back to the full bar (no flapping at the line)
        if d["soc_avg"] <= atk_off:
            d["atk_latch"] = False
        if d["soc_avg"] < atk_on:
            return "harvest", False, floor_soc, hard_floor
        return "balanced", False, floor_soc, hard_floor
    d["atk_latch"] = False
    if 0.0 <= behind_gap < OT_GAP_S and d["soc_avg"] > floor_soc + 12.0:
        return "attack", False, floor_soc, hard_floor
    return "balanced", False, floor_soc, hard_floor


def lap_accounting(d, fight_gap, ahead_pit_timer, ahead_wear, laps_left,
                   track_overtaking, clean_edge):
    """mirror of the M-A2 block in _on_lap_complete(). Mutates d.
    clean_edge = raw per-lap pace edge with following effects (dirty air /
    slipstream) and power-cut removed from BOTH cars: positive = we are
    genuinely faster. Smoothed by EMA for the stall call (single snapshots
    are noisy); the re-engage check uses the raw value (one clearly-faster
    lap is enough to rejoin the fight).
    Stall threshold scales with how hard passing is here: at Monaco only a
    big clean edge justifies grinding past patience; at Monza a small one."""
    if 0.0 <= fight_gap < OT_GAP_S * 1.5:
        d["edge_ema"] = d["edge_ema"] * 0.5 + clean_edge * 0.5
    else:
        d["edge_ema"] = 0.0
    stall_edge = max(0.0, 0.30 - track_overtaking * 0.30)
    if d["attack_backed"]:
        if (fight_gap < 0.0 or fight_gap > 3.0 or ahead_pit_timer > 0.0
                or d["tyre_laps"] <= 2
                or ahead_wear - d["tire_wear"] >= 15.0
                or clean_edge >= 0.5
                or laps_left <= 3):
            d["attack_backed"] = False
            d["attack_laps"] = 0
    elif 0.0 <= fight_gap < OT_GAP_S * 1.5:
        d["attack_laps"] += 1
        if d["attack_laps"] > patience_laps(d) and d["edge_ema"] < stall_edge:
            d["attack_backed"] = True
    else:
        d["attack_laps"] = 0


def mk_driver(**kw):
    d = dict(ers_mode="balanced", soc_avg=80.0, attack_backed=False,
             attack_laps=0, credit=0.0, tire_wear=40.0, tyre_laps=10,
             atk_latch=False, edge_ema=0.0,
             aggression=14, race_iq=13, composure=13, discipline=13)
    d.update(kw)
    return d


MONACO = [{"drs": False}, {"drs": False}, {"drs": False}]
MONZA = [{"drs": False}, {"drs": True}, {"drs": True}]   # S2+S3 DRS

# ---------------- M-A1: sector-aware attack arming ----------------
print("M-A1: sector-aware attack arming")
d = mk_driver()
m, ot, _, _ = situational_energy(d, 0.6, -1.0, 30, MONZA, 1, 0.4)
check("DRS sector -> attack+overtake", m == "attack" and ot)
m, ot, _, _ = situational_energy(d, 0.6, -1.0, 30, MONZA, 0, 0.4)
check("non-DRS sector mid, battery full -> balanced", m == "balanced" and not ot)
m, ot, _, _ = situational_energy(mk_driver(soc_avg=35.0), 0.6, -1.0, 30,
                                 MONZA, 0, 0.4)
check("non-DRS sector, battery low -> harvest for the zone", m == "harvest")
dc = mk_driver(soc_avg=40.0, attack_laps=2)   # committed: bar atk_off+10=38.4
m, ot, _, _ = situational_energy(dc, 1.15, -1.0, 30, MONZA, 1, 0.4)
check("committed fighter: arms at soc 40 / gap 1.15 (lower bar, wider window)",
      m == "attack" and ot)
m, ot, _, _ = situational_energy(mk_driver(soc_avg=40.0), 0.6, -1.0, 30,
                                 MONZA, 1, 0.4)
check("fresh fight at soc 40 -> not armed yet (full atk_on bar)", m != "attack")
m, ot, _, _ = situational_energy(d, 0.6, -1.0, 30, MONZA, 0, 0.85)
check("pre-arm before DRS sector (sfrac>0.8)", m == "attack" and ot)
m, ot, _, _ = situational_energy(d, 0.6, -1.0, 30, MONACO, 1, 0.85)
check("Monaco: never armed anywhere", m == "balanced" and not ot)
m, ot, _, _ = situational_energy(d, 0.6, -1.0, 30, [], 0, 0.4)
check("no sector data (legacy) -> attack allowed", m == "attack" and ot)
m, ot, _, _ = situational_energy(d, 1.4, 0.5, 30, MONACO, 0, 0.4)
check("defense branch NOT sector-gated (Monaco, threat behind)",
      m == "attack" and not ot)

# ---------------- M-A1b: hysteresis latch across sector cycling ----------------
print("M-A1b: attack hysteresis survives non-DRS sectors (latch)")
d = mk_driver(soc_avg=50.0)   # atk_on=49, atk_off=28.4 (aggr 0.7)
m, ot, _, _ = situational_energy(d, 0.6, -1.0, 30, MONZA, 1, 0.5)
check("engages in DRS sector at soc 50 (> atk_on 49)", m == "attack" and ot)
d["ers_mode"] = "attack"
d["soc_avg"] = 40.0           # drained below atk_on, above atk_off
m, ot, _, _ = situational_energy(d, 0.6, -1.0, 30, MONZA, 0, 0.4)
check("S1 (non-DRS): banks (harvest), latch kept", m == "harvest" and d["atk_latch"])
d["ers_mode"] = m             # balanced now — old code would lose hysteresis here
m, ot, _, _ = situational_energy(d, 0.6, -1.0, 30, MONZA, 1, 0.3)
check("back in DRS sector at soc 40: re-arms via latch (atk_off floor)",
      m == "attack" and ot)
d["ers_mode"] = "attack"
d["soc_avg"] = 25.0           # below atk_off -> spell charge spent
m, ot, _, _ = situational_energy(d, 0.6, -1.0, 30, MONZA, 1, 0.3)
check("soc below atk_off: disengages (recharges), clears latch",
      m == "harvest" and not d["atk_latch"])
d["ers_mode"] = m
d["soc_avg"] = 40.0
m, ot, _, _ = situational_energy(d, 0.6, -1.0, 30, MONZA, 1, 0.3)
check("re-engage at soc 40 now needs the full bar again (charges, no attack)",
      m != "attack")
d2 = mk_driver(soc_avg=60.0, atk_latch=True)
m, ot, _, _ = situational_energy(d2, 2.5, -1.0, 30, MONZA, 1, 0.3)
check("fight lost (gap 2.5s): latch cleared", not d2["atk_latch"])

# ---------------- M-A2: patience & back-off FSM ----------------
print("M-A2: patience / back-off")
check("patience range sane: default 4",
      patience_laps(mk_driver()) == 4)
hamilton = mk_driver(race_iq=19, composure=19, aggression=13, discipline=15)
maxv = mk_driver(race_iq=15, composure=14, aggression=19, discipline=8)
rookie = mk_driver(race_iq=8, composure=9, aggression=16, discipline=10)
check("patient type waits longer than overcommitter",
      patience_laps(hamilton) > patience_laps(maxv))
check("rookie patience short (<=3)", patience_laps(rookie) <= 3)

MONACO_OT = 0.05   # track.overtaking
MONZA_OT = 0.90

d = mk_driver()
pl = patience_laps(d)
for lap in range(pl + 1):
    lap_accounting(d, 0.5, 0.0, 45.0, 30, MONACO_OT, 0.20)
check("backs off after patience laps, edge 0.20 too small for Monaco",
      d["attack_backed"])

d2 = mk_driver()
for lap in range(patience_laps(d2) + 3):
    lap_accounting(d2, 0.5, 0.0, 45.0, 30, MONZA_OT, 0.20)
check("same 0.20 edge at Monza -> keeps attacking (stall thr 0.125)",
      not d2["attack_backed"])

d3 = mk_driver()
for lap in range(patience_laps(d3) + 3):
    lap_accounting(d3, 0.5, 0.0, 45.0, 30, MONACO_OT, 0.45)
check("big clean edge 0.45 at Monaco -> grinds on past patience",
      not d3["attack_backed"])

d4 = mk_driver()
for lap in range(patience_laps(d4) + 3):
    lap_accounting(d4, 0.5, 0.0, 45.0, 30, MONZA_OT, -0.1)
check("genuinely slower (-0.1) even at Monza -> backs off",
      d4["attack_backed"])

m, ot, _, _ = situational_energy(d, 0.6, -1.0, 30, MONZA, 1, 0.4)
check("backed driver does not attack even in DRS sector",
      m == "balanced" and not ot)
m, ot, _, _ = situational_energy(d, 1.4, 0.5, 30, MONZA, 1, 0.4)
check("backed driver still defends a threat behind", m == "attack" and not ot)

for trig, kw in [("target pitted", dict(ahead_pit_timer=8.0)),
                 ("fresh own tyres", dict(own_tyre_laps=1)),
                 ("15+ wear edge", dict(ahead_wear=70.0)),
                 ("became clearly faster (0.5+)", dict(clean_edge=0.6)),
                 ("final 3 laps", dict(laps_left=3)),
                 ("gap opened >3s", dict(fight_gap=4.0))]:
    db = mk_driver(attack_backed=True, attack_laps=6, tire_wear=50.0)
    db["tyre_laps"] = kw.get("own_tyre_laps", 10)
    lap_accounting(db, kw.get("fight_gap", 0.8), kw.get("ahead_pit_timer", 0.0),
                   kw.get("ahead_wear", 52.0), kw.get("laps_left", 30),
                   MONACO_OT, kw.get("clean_edge", 0.1))
    check("re-engage on " + trig, not db["attack_backed"])

db = mk_driver(attack_backed=True, attack_laps=6, tire_wear=50.0)
lap_accounting(db, 1.2, 0.0, 52.0, 30, MONACO_OT, 0.1)
check("no trigger -> stays backed (camped at 1.2s)", db["attack_backed"])

# ---------------- M-A3: final-laps battery dump ----------------
print("M-A3: final-laps battery dump")
d = mk_driver()
floors = []
for ll in [5, 3, 2, 1, 0]:
    _, _, fs, hf = situational_energy(d, 0.6, -1.0, ll, MONZA, 1, 0.4)
    floors.append((ll, fs, hf))
check("floor unchanged with 5 laps left", floors[0][1] > 40.0)
check("floor non-increasing 3->0 laps left",
      floors[1][1] > floors[2][1] > floors[3][1] >= floors[4][1])
check("floor hits 12 on last lap (all-in)", floors[3][1] == 12.0)
check("hard harvest floor drops 24 -> 14 in final laps",
      floors[0][2] == 24.0 and floors[1][2] == 14.0)
d_low = mk_driver(soc_avg=22.0)
m, ot, _, _ = situational_energy(d_low, 0.6, -1.0, 2, MONZA, 1, 0.4)
check("soc 22% with 2 laps left -> can still attack (was: forced harvest)",
      m == "attack" and ot)
m, ot, _, _ = situational_energy(mk_driver(soc_avg=15.0), 0.6, -1.0, 1,
                                 MONZA, 1, 0.4)
check("last lap soc 15% -> all-in attack", m == "attack" and ot)
m, ot, _, _ = situational_energy(d_low, 0.6, -1.0, 10, MONZA, 1, 0.4)
check("soc 22% mid-race -> harvest as before", m == "harvest")

print()
if fails:
    print("FAILED: %d check(s)" % len(fails))
    sys.exit(1)
print("ALL CHECKS PASSED")
