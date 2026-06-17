# Mirror of car_dev_season.gd: assembles CarDev + CarDevData into a full per-team
# development subsystem (state + ATR windows + project loop + facilities + compose).
# Proves the end-to-end loop before the GDScript port.

# ---- inlined minimal CarDev ----
ATR_BASE=100.0; ATR_BANK_CAP=0.20; GAIN_PER_HOUR=0.00012; PERF_SOFT_KNEE=0.70
AERO_TOTAL_CEILING=0.15; REL_TRICKLE=0.002; RISK_MULT={"safe":0.8,"normal":1.0,"aggressive":1.4}
DEADEND_YIELD=0.30; DEADEND_REL_MALUS=0.02; AERO_CEILING_PER_FACILITY=0.02
CFD_GAIN_MULT_PER_LEVEL=0.06; FACILITY_MAX_LEVEL=5; EXPERTISE_GAIN_MAX=0.50
EXPERTISE_PER_HOUR=0.0015; DESIGN_CENTRE_SLOTS=[2,2,3,3,4,4]; FACILITY_UPKEEP=30_000
DEADEND_SEED_MIX=0x0EA12D0
def atr_scale(p): p=max(1,min(11,p)); return 0.70+0.05*(p-1)
def atr_hours(p): return ATR_BASE*atr_scale(p)
def atr_rollover(u): return max(0.0,min(u,ATR_BANK_CAP*ATR_BASE))
def p_deadend(p): p=max(1,min(11,p)); return max(0.0,0.25-0.02*(p-1))
def eff_ceiling(bc,t): t=max(0,min(FACILITY_MAX_LEVEL,t)); return min(AERO_TOTAL_CEILING,bc+AERO_CEILING_PER_FACILITY*t)
def gphe(c): c=max(0,min(FACILITY_MAX_LEVEL,c)); return GAIN_PER_HOUR*(1.0+CFD_GAIN_MULT_PER_LEVEL*c)
def diminish(perf,c):
    if c<=0: return 0.0
    k=PERF_SOFT_KNEE*c
    if perf<=k: return 1.0
    if perf>=c: return 0.0
    return (c-perf)/(c-k)
def expu(e): return 1.0+EXPERTISE_GAIN_MAX*max(0.0,min(1.0,e))
def exp_after(e,h): return max(0.0,min(1.0,e+EXPERTISE_PER_HOUR*h))
def slots(lv): return DESIGN_CENTRE_SLOTS[max(0,min(FACILITY_MAX_LEVEL,lv))]
def mix32(x):
    x&=0xFFFFFFFF
    x=((x^(x>>16))*0x45D9F3B)&0xFFFFFFFF; x=((x^(x>>16))*0x45D9F3B)&0xFFFFFFFF
    return (x^(x>>16))&0xFFFFFFFF
def u01(s): return mix32(s)/4294967296.0
def cd_run(perf,bc,h,a,risk,tun,cfd,pos,seed,e):
    c=eff_ceiling(bc,tun); raw=h*gphe(cfd)*diminish(perf,c)*RISK_MULT[risk]*expu(e)
    a=max(0.0,min(1.0,a)); de=(risk=="aggressive" and u01(seed^DEADEND_SEED_MIX)<p_deadend(pos))
    pp=raw*a*(DEADEND_YIELD if de else 1.0); rp=raw*(1-a)+REL_TRICKLE-(DEADEND_REL_MALUS if de else 0)
    np=min(c,perf+pp); return dict(perf_gain=np-perf,rel_gain=rp,deadend=de,new_perf=np,ceiling=c)

# ---- inlined minimal CarDevData ----
COND_FLOOR=0.6; WORN_THRESHOLD=0.30; WORN_REL_MALUS=0.025
PARTS={  # key:(group,scalar,ceiling,rel_weight)
 "front_wing":("aero","d_aero",0.024,0.030),"rear_wing":("aero","d_aero",0.020,0.030),
 "floor":("aero","d_aero",0.020,0.030),"sidepods":("aero","d_aero",0.013,0.025),
 "suspension_geo":("aero","d_aero",0.012,0.030),"monocoque":("aero","d_aero",0.011,0.040),
 "ice":("power","d_power",0.018,0.020),"turbo":("power","d_power",0.009,0.020),
 "battery":("energy","d_energy",0.015,0.018),"ers":("energy","d_energy",0.008,0.017),
 "gearbox":("reliability","d_ch_rel",0.012,0.0),"hydraulics":("reliability","d_ch_rel",0.010,0.0),
 "cooling":("reliability","d_ch_rel",0.012,0.0),"differential":("reliability","d_ch_rel",0.010,0.0),
 "brakes":("reliability","d_ch_rel",0.0,0.0),"fuel":("power","d_power",0.0,0.0),
}
def cond_scale(c): return COND_FLOOR+(1-COND_FLOOR)*max(0.0,min(1.0,c))
def ceiling_of(k): return PARTS[k][2] if k in PARTS else 0.0
def compose_v2(parts):
    out={"d_aero":0.0,"d_power":0.0,"d_energy":0.0,"d_ch_rel":0.0,"d_eng_rel":0.0}
    for k,st in parts.items():
        if k not in PARTS: continue
        grp,scalar,ceil,relw=PARTS[k]
        perf=st["perf"]; rel=st["reliability"]; cond=st["condition"]
        out[scalar]+=perf*cond_scale(cond)
        rt="d_eng_rel" if grp in("power","energy") else "d_ch_rel"
        out[rt]+=rel*relw
        if cond<WORN_THRESHOLD: out[rt]-=WORN_REL_MALUS
    out['d_aero']=min(out['d_aero'],AERO_TOTAL_CEILING)
    out['d_ch_rel']=max(-0.05,min(0.05,out['d_ch_rel']))
    out['d_eng_rel']=max(-0.05,min(0.05,out['d_eng_rel']))
    return out

# ---- CarDevSeason (the new orchestration under test) ----
def make_state():
    parts={k:{"perf":0.0,"reliability":0.0,"condition":1.0,"expertise":0.0} for k in PARTS}
    return {"parts":parts,"facilities":{"tunnel":0,"cfd":0,"design_centre":0,"factory":0,"scout":0},
            "atr_banked":0.0,"window_index":0}
def window_hours(state,pos): return atr_hours(pos)+state["atr_banked"]
def run_project(state,key,hours,alloc,risk,pos,seed):
    p=state["parts"][key]; f=state["facilities"]
    r=cd_run(p["perf"],ceiling_of(key),hours,alloc,risk,f["tunnel"],f["cfd"],pos,seed,p["expertise"])
    p["perf"]=r["new_perf"]; p["reliability"]=max(0.0,min(1.0,p["reliability"]+r["rel_gain"]))
    p["expertise"]=exp_after(p["expertise"],hours)
    return r
def close_window(state,unused):
    state["atr_banked"]=atr_rollover(unused); state["window_index"]+=1
def compose(state): return compose_v2(state["parts"])
def project_slots(state): return slots(state["facilities"]["design_centre"])

# ================= TESTS =================
fails=0
def check(n,c):
    global fails; print(("PASS" if c else "FAIL")+f"  {n}");
    if not c: fails+=1

st=make_state()
check("state has 16 parts",len(st["parts"])==16)
check("fresh compose ~ baseline rel only",abs(compose(st)["d_aero"])<1e-9)
check("project slots from design centre (0->2)",project_slots(st)==2)

# Season loop: backmarker (pos 10) develops 'floor' full-aero each window for 6 windows
st=make_state()
for w in range(6):
    h=window_hours(st,10)
    run_project(st,"floor",h,1.0,"normal",10,1000+w)
    close_window(st,0.0)
c=compose(st)
check(f"floor perf grows toward base ceiling 0.020 (got {st['parts']['floor']['perf']:.4f})",0.015<st['parts']['floor']['perf']<=0.020+1e-9)
check(f"d_aero within corridor (got {c['d_aero']:.4f} <=0.15)",c['d_aero']<=0.15+1e-9)

# Banking: leftover hours carry (<=20) into next window's pool
st=make_state(); close_window(st,100.0)
check(f"banking caps at 20 (got {st['atr_banked']})",st['atr_banked']==20.0)
check("banked hours add to next window",window_hours(st,1)==atr_hours(1)+20.0)

# Determinism: same seed -> identical state evolution
a=make_state(); b=make_state()
for w in range(3):
    run_project(a,"ice",80,1.0,"aggressive",1,7+w); run_project(b,"ice",80,1.0,"aggressive",1,7+w)
check("deterministic loop",a["parts"]["ice"]==b["parts"]["ice"])

# Facilities: tunnel raises reachable ceiling above base
st=make_state(); st["facilities"]["tunnel"]=3
for w in range(10): run_project(st,"floor",window_hours(st,10),1.0,"normal",10,w); close_window(st,0.0)
check(f"tunnel lifts ceiling >base 0.030 (got {st['parts']['floor']['perf']:.4f})",st['parts']['floor']['perf']>0.030)
check("design centre lvl4 -> 4 slots",slots(4)==4)

# Reliability project raises reliability; PU reliability -> d_eng_rel
st=make_state()
for w in range(6): run_project(st,"ice",window_hours(st,8),0.0,"normal",8,w); close_window(st,0.0)
check(f"reliability rises from 0 (got {st['parts']['ice']['reliability']:.3f})",st['parts']['ice']['reliability']>0.0)
check("PU reliability feeds d_eng_rel",compose(st)["d_eng_rel"]>0.0)

# Whole-car compose stays in corridors after a full maxed season
st=make_state(); st["facilities"]["tunnel"]=5; st["facilities"]["cfd"]=5
for w in range(12):
    for k in ("front_wing","rear_wing","floor","sidepods","suspension_geo","monocoque"):
        run_project(st,k,40,1.0,"normal",10,w*100+hash(k)%1000)
    close_window(st,0.0)
cc=compose(st)
check(f"maxed aero compose <= AERO_TOTAL_CEILING (got {cc['d_aero']:.4f})",cc['d_aero']<=0.15+1e-9)

print(f"\n{'ALL PASS' if fails==0 else str(fails)+' FAILED'}")
