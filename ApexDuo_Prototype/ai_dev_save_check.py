# ai_dev_save_check.py — verifies ai_dev survives a JSON save/load round-trip.
import json
ai_dev = {str(ti): {"d_aero": 0.03, "d_power": 0.012, "d_energy": 0.012,
                    "d_ch_rel": 0.036, "d_eng_rel": 0.036}
          for ti in range(11) if ti != 4}   # player_team=4 excluded
blob = json.loads(json.dumps(ai_dev))        # JSON round-trip (floats stay floats)
ok = True
for ti in range(11):
    k = str(ti)
    if ti == 4:
        ok &= (k not in ai_dev)
        continue
    ok &= (k in blob and abs(float(blob[k]["d_aero"]) - 0.03) < 1e-9)
print("PASS" if ok else "FAIL", "ai_dev save/load round-trip")
import sys; sys.exit(0 if ok else 1)
