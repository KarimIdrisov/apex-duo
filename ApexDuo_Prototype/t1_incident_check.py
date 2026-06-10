# t1_incident_check.py — verifies the Turn-1 incident probability model (Feature 2).
T1_BASE = 0.12
T1_TRACK_K = 0.15
def prob(overtaking):
    p = T1_BASE + (0.6 - overtaking) * T1_TRACK_K
    return max(0.04, min(0.30, p))

ok = True
ok &= prob(0.2) > prob(0.8)              # hard-to-pass tracks → more incidents
ok &= 0.04 <= prob(0.0) <= 0.30          # clamps hold at extremes
ok &= 0.04 <= prob(1.0) <= 0.30
ok &= abs(prob(0.6) - 0.12) < 1e-9       # neutral track ≈ base
print("PASS" if ok else "FAIL", "t1 incident probability",
      "| p(0.2)=%.3f p(0.6)=%.3f p(0.8)=%.3f" % (prob(0.2), prob(0.6), prob(0.8)))
import sys; sys.exit(0 if ok else 1)
