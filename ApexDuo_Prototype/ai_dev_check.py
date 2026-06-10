# ai_dev_check.py — verifies the AI car-development corridors (Feature 1).
# Self-contained (no cross-imports — mount-stale gotcha). Mirrors
# season.gd._advance_ai_dev / _atr_for_position at the SCALAR level.

ATR_P1, ATR_P10 = 0.75, 1.15
AI_DEV_BASELINE_AERO   = 0.010
AI_DEV_BASELINE_POWER  = 0.004
AI_DEV_BASELINE_ENERGY = 0.004
AI_DEV_AERO_REL = 0.012
AI_DEV_PWT_REL  = 0.012
ROUNDS = 5  # opener (round 0, no dev) + 4 increments that actually affect racing

def atr_for_position(pos):
    return max(ATR_P1, min(ATR_P10, 0.75 + (pos - 1) / 9.0 * 0.40))

def accumulate_aero(pos, increments):
    # jitter omitted (mean 1.0); corridors are defined on the mean.
    return AI_DEV_BASELINE_AERO * atr_for_position(pos) * increments

INC = ROUNDS - 1
leader_aero = accumulate_aero(1, INC)    # P1 constructor
mid_aero    = accumulate_aero(6, INC)    # P6
back_aero   = accumulate_aero(11, INC)   # P11

PLAYER_MAXED_AERO = 0.150   # full aero group ceiling (F1_2026.PARTS, verified elsewhere)
PLAYER_IDLE_AERO  = 0.0

def check(name, cond):
    print(("PASS" if cond else "FAIL"), name)
    return cond

ok = True
ok &= check("rivals develop (mid gains aero)",            mid_aero > 0.02)
ok &= check("ATR catch-up: backmarker > leader",          back_aero > leader_aero)
ok &= check("gentle compression (back-leader gap small)", (back_aero - leader_aero) < 0.05)
ok &= check("maxed player stays ahead of best rival",     PLAYER_MAXED_AERO > back_aero)
ok &= check("idle player falls behind even slowest rival",PLAYER_IDLE_AERO < leader_aero)
ok &= check("mid rival ~2 player aero-steps (0.03-0.06)", 0.03 <= mid_aero <= 0.06)

print("\nleader=%.4f mid=%.4f back=%.4f player_max=%.3f"
      % (leader_aero, mid_aero, back_aero, PLAYER_MAXED_AERO))
import sys; sys.exit(0 if ok else 1)
