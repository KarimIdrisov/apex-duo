# combat_lap_check.py — regression test for the combat-pin lap-bookkeeping fix.
#
# Bug (fixed 2026-06-10): _resolve_combat assigned b.lap = a.lap directly in the
# pass / hold-up branches, so a pinned follower's start/finish crossings bypassed
# step() phase 3 (the `while lap_frac >= 1.0` loop) — fuel burn, deploy-budget
# reset, pit execution, tyre age and trust/mood were silently skipped.
# Fix: combat writes ONLY lap_frac, relative to the car's own lap
# (b.lap_frac = a.progress() +/- mg - b.lap); phase 3 owns all lap bookkeeping.
#
# This file is self-contained (no cross-imports — see CLAUDE.md mount gotcha).
# It mirrors the 3-phase tick at the minimal level needed for the invariant:
#   INVARIANT: for every car, phase-3 completions == final lap counter.
#
# Scenarios:
#   1. "pinned"    — faster follower held behind a leader for 30 laps (hold-up
#                    branch crosses the line every lap).
#   2. "ping-pong" — trivial pass resistance, whichever car is behind is faster,
#                    so thousands of passes happen at all lap positions,
#                    including across the start/finish line (pass branch).
# Each scenario runs with OLD (buggy) and NEW (fixed) combat logic: OLD must
# violate the invariant (proves the test catches the bug), NEW must hold it.

import sys

DT = 0.25
BL = 90.0                 # base laptime, s
COMBAT_GAP = 0.8          # s
MIN_GAP_S = 0.25          # s
MG = MIN_GAP_S / BL       # in lap fraction
DEADZONE = 0.02


class Car:
    def __init__(self, name, frac=0.0):
        self.name = name
        self.lap = 0
        self.frac = frac
        self.lt = BL
        self.credit = 0.0
        self.completions = 0

    def progress(self):
        return self.lap + self.frac


def run(old_logic, resist, ping_pong, laps=30):
    a0 = Car("A", frac=0.0066)   # starts ~3 grid slots ahead
    b0 = Car("B")
    cars = [a0, b0]
    ticks = 0
    while min(c.lap for c in cars) < laps and ticks < 400000:
        ticks += 1
        # who is ahead right now (combat pair ordering)
        ahead, behind = sorted(cars, key=lambda c: -c.progress())
        # pace: the car behind is slightly faster (keeps combat alive forever)
        if ping_pong or behind is b0:
            ahead.lt, behind.lt = 90.0, 89.7
        # phase 1 — advance
        for c in cars:
            c.frac += DT / c.lt
        # phase 2 — combat (re-sort, like _resolve_combat does)
        a, b = sorted(cars, key=lambda c: -c.progress())
        gap_s = (a.progress() - b.progress()) * BL
        if gap_s >= COMBAT_GAP:
            b.credit = 0.0
        else:
            edge = a.lt - b.lt
            if edge > DEADZONE:
                b.credit += (edge - DEADZONE) * (DT / BL) * 50.0
            else:
                b.credit = max(0.0, b.credit - 0.30 * DT)
            if b.credit >= resist:                      # pass branch
                b.credit = 0.0
                a.credit = 0.0
                if old_logic:
                    b.lap = a.lap
                    b.frac = a.frac + MG
                    if b.frac >= 1.0:
                        b.frac -= 1.0
                        b.lap += 1
                else:
                    b.frac = a.progress() + MG - float(b.lap)
            elif b.progress() > a.progress() - MG:      # hold-up branch
                if old_logic:
                    b.lap = a.lap
                    b.frac = a.frac - MG
                    if b.frac < 0.0:
                        b.frac += 1.0
                        b.lap -= 1
                else:
                    b.frac = a.progress() - MG - float(b.lap)
        # phase 3 — lap completion (the bookkeeping path)
        for c in cars:
            while c.frac >= 1.0:
                c.frac -= 1.0
                c.lap += 1
                c.completions += 1
    return cars


def check(label, old_logic, resist, ping_pong):
    cars = run(old_logic, resist, ping_pong)
    ok = all(c.completions == c.lap for c in cars)
    detail = "  ".join("%s: lap=%d completions=%d" % (c.name, c.lap, c.completions)
                       for c in cars)
    print("%-28s %s   (%s)" % (label, "invariant HOLDS" if ok else "invariant BROKEN", detail))
    return ok


def main():
    failures = []
    # OLD logic must break the invariant (the test would be useless otherwise).
    if check("pinned / OLD (buggy)", True, resist=1e18, ping_pong=False):
        failures.append("pinned/OLD unexpectedly passed — test lost its teeth")
    if check("ping-pong / OLD (buggy)", True, resist=0.01, ping_pong=True):
        failures.append("ping-pong/OLD unexpectedly passed — test lost its teeth")
    # NEW logic must hold it.
    if not check("pinned / NEW (fixed)", False, resist=1e18, ping_pong=False):
        failures.append("pinned/NEW broke the invariant")
    if not check("ping-pong / NEW (fixed)", False, resist=0.01, ping_pong=True):
        failures.append("ping-pong/NEW broke the invariant")
    if failures:
        print("FAIL:", "; ".join(failures))
        sys.exit(1)
    print("PASS: combat writes lap_frac only; phase 3 owns lap bookkeeping.")
    sys.exit(0)


if __name__ == "__main__":
    main()
