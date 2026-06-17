# Python mirror of car_dev.gd core (MUST match GDScript port bit-for-bit).
# Covers: ATR scale+banking, diminishing returns, expertise, PU convergence,
# facility ceiling/efficiency/slots/upkeep/capex, and project resolution with
# deterministic deadend. Self-contained.

ATR_BASE=100.0; GAIN_PER_HOUR=0.00012; PERF_SOFT_KNEE=0.70; AERO_TOTAL_CEILING=0.15
ATR_BANK_CAP=0.20
REL_TRICKLE=0.002; RISK_MULT={"safe":0.8,"normal":1.0,"aggressive":1.4}
DEADEND_YIELD=0.30; DEADEND_REL_MALUS=0.02
AERO_CEILING_PER_FACILITY=0.02; CFD_GAIN_MULT_PER_LEVEL=0.06; FACILITY_MAX_LEVEL=5
EXPERTISE_GAIN_MAX=0.50; EXPERTISE_PER_HOUR=0.0015
PU_CONVERGE_GAP=0.025; PU_CONVERGE_RATE=0.40; PU_TOTAL_CEILING=0.05
DESIGN_CENTRE_SLOTS=[2,2,3,3,4,4]; FACILITY_UPKEEP=30_000
CAPEX_ALLOWANCE=[2_500_000,3_000_000,3_500_000]  # tier 0=contender,1=mid,2=underdog
DEADEND_SEED_MIX=0x0EA12D0

def atr_scale(pos): p=max(1,min(11,pos)); return 0.70+0.05*(p-1)
def atr_hours(pos): return ATR_BASE*atr_scale(pos)
def atr_rollover(unused): return max(0.0, min(unused, ATR_BANK_CAP*ATR_BASE))  # carried to next window
def p_deadend(pos): p=max(1,min(11,pos)); return max(0.0,0.25-0.02*(p-1))
def eff_ceiling(bc,t): t=max(0,min(FACILITY_MAX_LEVEL,t)); return min(AERO_TOTAL_CEILING,bc+AERO_CEILING_PER_FACILITY*t)
def gain_per_hour_eff(c): c=max(0,min(FACILITY_MAX_LEVEL,c)); return GAIN_PER_HOUR*(1.0+CFD_GAIN_MULT_PER_LEVEL*c)
def diminish(perf,ceiling):
    if ceiling<=0.0: return 0.0
    knee=PERF_SOFT_KNEE*ceiling
    if perf<=knee: return 1.0
    if perf>=ceiling: return 0.0
    return (ceiling-perf)/(ceiling-knee)
def expertise_gain_mult(e): return 1.0+EXPERTISE_GAIN_MAX*max(0.0,min(1.0,e))
def expertise_after(e,hours): return max(0.0,min(1.0,e+EXPERTISE_PER_HOUR*hours))
def pu_converge_step(deficit):  # leader (deficit<=GAP) frozen ->0; laggard gets step, capped
    if deficit<=PU_CONVERGE_GAP: return 0.0
    return max(0.0,min((deficit-PU_CONVERGE_GAP)*PU_CONVERGE_RATE, PU_TOTAL_CEILING))
def design_centre_slots(level): return DESIGN_CENTRE_SLOTS[max(0,min(FACILITY_MAX_LEVEL,level))]
def facility_upkeep(total_levels): return total_levels*FACILITY_UPKEEP
def capex_allowance(tier): return CAPEX_ALLOWANCE[max(0,min(2,tier))]

def mix32(x):
    x&=0xFFFFFFFF
    x=((x^(x>>16))*0x45D9F3B)&0xFFFFFFFF
    x=((x^(x>>16))*0x45D9F3B)&0xFFFFFFFF
    x=(x^(x>>16))&0xFFFFFFFF
    return x
def u01(s): return mix32(s)/4294967296.0

def run_project(perf,base_ceiling,hours,alloc,risk,tunnel,cfd,pos,seed,expertise=0.0):
    ceiling=eff_ceiling(base_ceiling,tunnel); dim=diminish(perf,ceiling)
    raw=hours*gain_per_hour_eff(cfd)*dim*RISK_MULT[risk]*expertise_gain_mult(expertise)
    a=max(0.0,min(1.0,alloc)); deadend=False
    if risk=="aggressive" and u01(seed^DEADEND_SEED_MIX)<p_deadend(pos): deadend=True
    perf_part=raw*a
    if deadend: perf_part*=DEADEND_YIELD
    rel_part=raw*(1.0-a)+REL_TRICKLE
    if deadend: rel_part-=DEADEND_REL_MALUS
    new_perf=min(ceiling,perf+perf_part)
    return dict(perf_gain=new_perf-perf,rel_gain=rel_part,deadend=deadend,new_perf=new_perf,ceiling=ceiling)

fails=0
def check(n,c):
    global fails; print(("PASS" if c else "FAIL")+f"  {n}");
    if not c: fails+=1

check("atr_scale p1/p11",abs(atr_scale(1)-0.70)<1e-9 and abs(atr_scale(11)-1.20)<1e-9)
check("atr banking caps at 20%",atr_rollover(100)==20.0 and atr_rollover(5)==5.0)
check("diminish edges",diminish(0,0.1)==1.0 and diminish(0.1,0.1)==0.0)
check("ceiling raise+cap",eff_ceiling(0.10,3)==min(0.15,0.16) and eff_ceiling(0.14,5)==0.15)
check("expertise gain mult 1.0..1.5",expertise_gain_mult(0)==1.0 and abs(expertise_gain_mult(1)-1.5)<1e-9)
check("expertise accrues+caps",expertise_after(0,80)==0.12 and expertise_after(0.95,80)==1.0)
# PU convergence: leader frozen, laggard scaled, capped at PU_TOTAL_CEILING
check("pu leader frozen",pu_converge_step(0.01)==0.0 and pu_converge_step(0.025)==0.0)
check("pu laggard gets step",abs(pu_converge_step(0.05)-(0.025*0.40))<1e-9)
check("pu step capped",pu_converge_step(0.5)==PU_TOTAL_CEILING)
check("design slots 2..4",design_centre_slots(0)==2 and design_centre_slots(5)==4)
check("upkeep/capex",facility_upkeep(16)==480_000 and capex_allowance(0)==2_500_000 and capex_allowance(2)==3_500_000)
# determinism + deadend frequency
check("deterministic",run_project(0.02,0.1,80,1,"aggressive",0,1,1,123)==run_project(0.02,0.1,80,1,"aggressive",0,1,1,123))
def dr(pos,n=20000): return sum(run_project(0.02,0.1,80,1,"aggressive",0,1,pos,s)["deadend"] for s in range(n))/n
check("deadend leader~0.25 / back~0.05",0.22<dr(1)<0.28 and 0.03<dr(11)<0.07)
# expertise makes a project deliver more
base=run_project(0.02,0.1,80,1,"normal",0,1,5,7,0.0)["perf_gain"]
exp =run_project(0.02,0.1,80,1,"normal",0,1,5,7,1.0)["perf_gain"]
check(f"expertise boosts gain (+{(exp/base-1)*100:.0f}%)",abs(exp/base-1.5)<0.01)
# tradeoff sanity
check("alloc=1 rel=trickle",abs(run_project(0.02,0.1,80,1,"normal",0,1,5,7)["rel_gain"]-REL_TRICKLE)<1e-9)
check("alloc=0 perf=0",abs(run_project(0.02,0.1,80,0,"normal",0,1,5,7)["perf_gain"])<1e-12)
# bounded + convergence
check("per-project bounded",run_project(0.0,0.1,115,1,"aggressive",5,5,11,3,0.5)["perf_gain"]<0.05)
L,B=0.09,0.01
for _ in range(8):
    L=run_project(L,0.1,atr_hours(1),1,"normal",2,2,1,0)["new_perf"]
    B=run_project(B,0.1,atr_hours(10),1,"normal",1,1,10,0)["new_perf"]
check(f"gap converges (L{L:.3f}~B{B:.3f})",abs(L-B)<0.05)

print(f"\n{'ALL PASS' if fails==0 else str(fails)+' FAILED'}")
