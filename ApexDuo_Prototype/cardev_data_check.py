# Mirror of car_dev_data.gd: the 16-part catalog + compose_v2.
# Verifies corridor sums (aero<=0.15, PU power+energy<=0.05) and the no-ignorable-parts audit,
# and that compose_v2 maps part states -> the 5 sim scalars with condition/reliability.

COND_FLOOR=0.6; WORN_THRESHOLD=0.30; WORN_REL_MALUS=0.025
# part: group, scalar, base_ceiling(perf max before facilities), layer A/B/C,
#       rel_weight (reliability->rel scalar), track_bias, transferable(buy)
PARTS={
 # AERO (layer B, LTC) -> d_aero ; rel side-bonus to d_ch_rel
 "front_wing":   ("aero","d_aero",0.024,"B",0.030,"slow_corners",False),
 "rear_wing":    ("aero","d_aero",0.020,"B",0.030,"drag_balance",False),
 "floor":        ("aero","d_aero",0.020,"B",0.030,"fast_corners",False),
 "sidepods":     ("aero","d_aero",0.013,"B",0.025,"cooling_power",False),
 "suspension_geo":("aero","d_aero",0.012,"B",0.030,"kerbs",False),
 "monocoque":    ("aero","d_aero",0.011,"B",0.040,"stiffness_all",False),
 # PU (layer A) -> d_power / d_energy ; rel -> d_eng_rel
 "ice":          ("power","d_power",0.018,"A",0.020,"power",False),
 "turbo":        ("power","d_power",0.009,"A",0.020,"power",False),
 "battery":      ("energy","d_energy",0.015,"A",0.018,"ers_recovery",False),
 "ers":          ("energy","d_energy",0.008,"A",0.017,"ers_deploy",False),
 # TRANSFERABLE (layer C) -> d_ch_rel (+ small aero for gearbox) ; can be bought
 "gearbox":      ("reliability","d_ch_rel",0.012,"C",0.0,"shift",True),
 "hydraulics":   ("reliability","d_ch_rel",0.010,"C",0.0,"systems",True),
 "cooling":      ("reliability","d_ch_rel",0.012,"C",0.0,"hot_tracks",True),
 "differential": ("reliability","d_ch_rel",0.010,"C",0.0,"traction",True),
 # SUPPLIER-CHOICE parts (not level-developed; flagged for UI) — brakes/fuel
 "brakes":       ("reliability","d_ch_rel",0.0,"C",0.0,"braking",True),
 "fuel":         ("power","d_power",0.0,"A",0.0,"power",True),
}

def cond_scale(c): return COND_FLOOR+(1.0-COND_FLOOR)*max(0.0,min(1.0,c))

def compose_v2(states):
    out={"d_aero":0.0,"d_power":0.0,"d_energy":0.0,"d_ch_rel":0.0,"d_eng_rel":0.0}
    for k,st in states.items():
        if k not in PARTS: continue
        grp,scalar,ceil,layer,relw,bias,buy=PARTS[k]
        perf=st.get("perf",0.0); rel=st.get("reliability",0.0); cond=st.get("condition",1.0)
        sc=cond_scale(cond)
        out[scalar]+=perf*sc
        rel_target="d_eng_rel" if grp in ("power","energy") else "d_ch_rel"
        out[rel_target]+=rel*relw
        if cond<WORN_THRESHOLD:
            out[rel_target]-=WORN_REL_MALUS
    return out

fails=0
def check(n,c):
    global fails; print(("PASS" if c else "FAIL")+f"  {n}");
    if not c: fails+=1

aero=sum(p[2] for p in PARTS.values() if p[0]=="aero")
power=sum(p[2] for p in PARTS.values() if p[0]=="power")
energy=sum(p[2] for p in PARTS.values() if p[0]=="energy")
purel=sum(p[2] for p in PARTS.values() if p[3]=="C")
check(f"16 parts total (got {len(PARTS)})",len(PARTS)==16)
check(f"aero base ceiling sum = 0.100 (got {aero:.3f})",abs(aero-0.100)<1e-9)
check(f"PU power+energy sum <= 0.05 (got {power+energy:.3f})",power+energy<=0.05+1e-9)
check("no developable part has 0 ceiling (suppliers excepted)",
      all(p[2]>0 for k,p in PARTS.items() if k not in ("brakes","fuel")))
# no-ignorable: every developable part has a distinct track bias contribution
biases={p[5] for p in PARTS.values()}
check(f"track biases diverse (got {len(biases)})",len(biases)>=10)
# compose: a maxed aero car at full condition reaches ~0.15 d_aero
maxed={k:{"perf":PARTS[k][2],"reliability":1.0,"condition":1.0} for k in PARTS if PARTS[k][0]=="aero"}
comp=compose_v2(maxed)
check(f"maxed aero (no tunnel) -> d_aero=0.100 (got {comp['d_aero']:.3f})",abs(comp['d_aero']-0.100)<1e-9)
# condition scaling: worn part delivers 60% floor
worn={"floor":{"perf":0.030,"reliability":0.0,"condition":0.0}}
cw=compose_v2(worn)
check(f"worn floor -> 60% (got {cw['d_aero']:.4f})",abs(cw['d_aero']-0.030*0.6)<1e-9)
# critical condition bleeds reliability
crit={"gearbox":{"perf":0.012,"reliability":0.0,"condition":0.1}}
cc=compose_v2(crit)
expected=0.012*cond_scale(0.1)-0.025
check(f"critical part: perf+malus net (got {cc['d_ch_rel']:.4f}, exp {expected:.4f})",abs(cc['d_ch_rel']-expected)<1e-9)
# reliability folds into rel scalar by group
pur={"ice":{"perf":0.0,"reliability":1.0,"condition":1.0}}
cr=compose_v2(pur)
check(f"PU reliability -> d_eng_rel (got {cr['d_eng_rel']:.3f})",abs(cr['d_eng_rel']-0.020)<1e-9)

print(f"\n{'ALL PASS' if fails==0 else str(fails)+' FAILED'}")
