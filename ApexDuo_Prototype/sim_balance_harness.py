import math, copy

# ============================================================================
# Apex Duo 2026 race-core verification harness (Python mirror of planned GDScript)
# ============================================================================

COMPOUNDS = {
    "soft":   {"pace": -0.55, "wear": 2.6, "cliff": 65.0},
    "medium": {"pace":  0.00, "wear": 1.7, "cliff": 78.0},
    "hard":   {"pace":  0.55, "wear": 1.1, "cliff": 90.0},
}
PACE_MODES = {  # ICE/tyre push: pace, tyre wear mult, fuel mult, error risk
    "conserve": {"pace":  0.45, "wear": 0.80, "fuel": 0.90, "risk": 0.4},
    "balanced": {"pace":  0.00, "wear": 1.00, "fuel": 1.00, "risk": 1.0},
    "push":     {"pace": -0.45, "wear": 1.30, "fuel": 1.15, "risk": 1.8},
}
ERS_MODES = {   # battery deploy/harvest: pace, soc %/lap (+regen / -deploy), risk add
    "harvest":  {"pace":  0.30, "soc":  6.0, "risk": 0.0},
    "balanced": {"pace":  0.00, "soc":  0.0, "risk": 0.0},
    "attack":   {"pace": -0.38, "soc": -6.5, "risk": 0.5},
}
CLIP_PENALTY = 0.55      # s/lap lost when battery empty (scaled by power_sensitivity)
OT_PACE      = -0.55     # s/lap overtake boost when effective (scaled by power_sens)
OT_DRAIN     = 9.0       # extra soc %/lap while overtaking
OT_MIN_SOC   = 14.0      # below this, overtake can't fire
OT_GAP_S     = 1.0       # must be within 1.0s of car ahead
PASSIVE_REGEN= 4.0       # forced regen when clipped
DA_THRESH    = 0.7       # dirty-air time gap threshold (s)
DA_COEF      = 0.42

class RNG:
    def __init__(self, s): self.state = s & 0xFFFFFFFF
    def u32(self):
        self.state = (1664525*self.state + 1013904223) & 0xFFFFFFFF
        return self.state
    def unit(self): return self.u32()/4294967296.0
    def rangef(self,a,b): return a+(b-a)*self.unit()

class Track:
    def __init__(s, **k):
        s.name=k.get("name","Test"); s.laps=k.get("laps",50)
        s.base_laptime=k.get("lt",90.0); s.pit_loss=k.get("pit",21.0)
        s.abrasion=k.get("abr",1.0); s.downforce=k.get("df",0.6)
        s.power=k.get("pw",0.6); s.overtaking=k.get("ot",0.6)
        s.harvest=k.get("harv",0.6); s.deploy=k.get("dep",0.6)
        s.sc=k.get("sc",0.2); s.wet=k.get("wet",0.2); s.arch=k.get("arch","mixed")

class Driver:
    def __init__(s,i,name,skill):
        s.id=i; s.name=name; s.skill=skill
        s.is_player=False; s.team=False; s.role=""
        s.compound="medium"; s.tire_wear=0.0; s.wear_mult=1.0
        s.pace_mode="balanced"; s.ers_mode="balanced"; s.overtake=False
        s.soc=80.0; s.soc_max=100.0; s.harvest_mult=1.0
        s.fuel_laps=0.0; s.lap=0; s.lap_frac=0.0; s.last_lap=0.0
        s.pit_count=0; s.pit_timer=0.0; s.ai_pit_wear=0.0
        s.finished=False; s.finish_time=-1.0
        s.pitting=False; s.pit_req=""
        s.clipped=False
        s.clip_laps=0; s.ot_laps=0     # diagnostics
    def progress(s): return s.lap+s.lap_frac

class Sim:
    def __init__(s, track, drivers, seed=12345):
        s.track=track; s.drivers=drivers; s.rng=RNG(seed)
        s.elapsed=0.0; s.finished=False
        for d in s.drivers:
            d.fuel_laps=float(track.laps)
            d.ai_pit_wear=s.rng.rangef(55.0,72.0)

    def order(s):
        fin=[d for d in s.drivers if d.finished]
        unf=[d for d in s.drivers if not d.finished]
        fin.sort(key=lambda d:d.finish_time)
        unf.sort(key=lambda d:-d.progress())
        return fin+unf

    def ot_effective(s,d,ahead_gap):
        return (d.overtake and not d.clipped and d.soc>OT_MIN_SOC and 0.0<=ahead_gap<OT_GAP_S)

    def laptime(s,d,ahead_gap,noise=True):
        t=s.track
        lt=t.base_laptime
        lt-=d.skill*1.0
        lt+=COMPOUNDS[d.compound]["pace"]
        lt+=PACE_MODES[d.pace_mode]["pace"]
        # energy deploy (clipped = battery spent, no deploy until recovered)
        if d.clipped:
            lt+=CLIP_PENALTY*(0.6+0.8*t.power)
        else:
            lt+=ERS_MODES[d.ers_mode]["pace"]
        if s.ot_effective(d,ahead_gap):
            lt+=OT_PACE*(0.6+0.8*t.power)
        # tyres
        c=COMPOUNDS[d.compound]; w=d.tire_wear
        lt+=w*0.012
        if w>c["cliff"]: lt+=(w-c["cliff"])*0.10
        lt+=d.fuel_laps*0.018
        # dirty air, scaled by downforce demand & inverse overtaking
        if 0.0<=ahead_gap<DA_THRESH and not s.ot_effective(d,ahead_gap):
            lt+=(DA_THRESH-ahead_gap)*DA_COEF*(0.5+d_df(t))*(1.4-t.overtaking)
        if noise: lt+=s.rng.rangef(-0.05,0.05)
        return max(lt, 10.0)

    def soc_update(s,d,dt,lt,ahead_gap):
        t=s.track
        if d.clipped:
            rate=PASSIVE_REGEN*(0.5+t.harvest)*d.harvest_mult   # forced recharge
        else:
            rate=ERS_MODES[d.ers_mode]["soc"]
            if rate>=0: rate=rate*(0.5+t.harvest)*d.harvest_mult
            else:       rate=rate*(0.6+0.8*t.deploy)
            if s.ot_effective(d,ahead_gap):
                rate-=OT_DRAIN*(0.6+0.8*t.deploy)
        d.soc=min(d.soc_max, max(0.0, d.soc+rate*(dt/lt)))
        if d.soc<=0.0: d.clipped=True
        elif d.soc>=20.0: d.clipped=False

    def ai_energy(s,d,ahead_gap,behind_gap):
        if d.is_player: return
        # simple deterministic energy strategy
        if d.soc<24.0:
            d.ers_mode="harvest"; d.overtake=False
        elif 0.0<=ahead_gap<OT_GAP_S and d.soc>40.0:
            d.ers_mode="attack"; d.overtake=True          # attack car ahead
        elif 0.0<=behind_gap<OT_GAP_S and d.soc>55.0:
            d.ers_mode="attack"; d.overtake=False          # defend
        else:
            d.ers_mode="balanced"; d.overtake=False

    def step(s,dt):
        if s.finished: return
        s.elapsed+=dt
        ordered=s.order()
        n=len(ordered)
        for i,d in enumerate(ordered):
            if d.finished: continue
            if d.pit_timer>0:
                d.pit_timer=max(0.0,d.pit_timer-dt); continue
            ahead_gap=-1.0; behind_gap=-1.0
            if i>0:
                ahead_gap=(ordered[i-1].progress()-d.progress())*s.track.base_laptime
            if i<n-1:
                behind_gap=(d.progress()-ordered[i+1].progress())*s.track.base_laptime
            s.ai_energy(d,ahead_gap,behind_gap)
            lt=s.laptime(d,ahead_gap)
            if d.clipped: d.clip_laps+=1
            if s.ot_effective(d,ahead_gap): d.ot_laps+=1
            d.lap_frac+=dt/lt
            risk=(PACE_MODES[d.pace_mode]["risk"]+ERS_MODES[d.ers_mode]["risk"])*(1.0+d.tire_wear/120.0)
            if s.rng.unit()<risk*dt*0.00010:
                d.pit_timer+=s.rng.rangef(1.5,4.0)
            wr=COMPOUNDS[d.compound]["wear"]*PACE_MODES[d.pace_mode]["wear"]*s.track.abrasion*d.wear_mult*(0.7+0.6*d_df(s.track))
            d.tire_wear=min(120.0,d.tire_wear+wr*(dt/lt))
            s.soc_update(d,dt,lt,ahead_gap)
            while d.lap_frac>=1.0:
                d.lap_frac-=1.0; d.lap+=1; d.last_lap=lt
                d.fuel_laps=max(0.0,d.fuel_laps-1.0)
                if d.lap>=s.track.laps:
                    d.finished=True; d.lap_frac=0.0; d.finish_time=s.elapsed; break
                s.on_lap(d)
        if all(d.finished for d in s.drivers): s.finished=True

    def on_lap(s,d):
        do=False; nc=d.compound
        if d.is_player:
            if d.pitting:
                do=True; nc=d.pit_req or d.compound; d.pitting=False
        else:
            left=s.track.laps-d.lap
            if (d.tire_wear>=d.ai_pit_wear and left>6 and d.pit_count==0) or (d.tire_wear>=92.0 and left>3):
                do=True
                nc="hard" if left>22 else ("medium" if left>10 else "soft")
        if do:
            d.pit_timer+=s.track.pit_loss; d.tire_wear=0.0; d.compound=nc
            d.pit_count+=1; d.ai_pit_wear=s.rng.rangef(58.0,75.0)

def d_df(t):  # downforce demand 0..1 helper
    return t.downforce

def make_field(coop=False):
    names=["Rossi","Vance","Kade","Moreau","Silva","Reyes","Berg","Novak","Costa","Aziz"]
    arr=[]
    for i,nm in enumerate(names):
        d=Driver(i,nm,0.95-i*0.045)
        if i==4: d.team=True; d.is_player=True; d.role="Director"
        elif i==5: d.team=True; d.role="Engineer"; d.is_player=coop
        arr.append(d)
    return arr

# ---- track generator (archetype + deterministic jitter) ----
ARCH={
 "power":    dict(laps=53,lt=82,abr=0.85,df=0.25,pw=0.95,ot=0.72,harv=0.42,dep=0.92,sc=0.12,wet=0.20),
 "street":   dict(laps=58,lt=78,abr=0.80,df=0.95,pw=0.45,ot=0.20,harv=0.78,dep=0.42,sc=0.55,wet=0.20),
 "highspeed":dict(laps=44,lt=98,abr=1.22,df=0.82,pw=0.74,ot=0.66,harv=0.55,dep=0.70,sc=0.18,wet=0.35),
 "technical":dict(laps=50,lt=80,abr=1.15,df=0.85,pw=0.50,ot=0.42,harv=0.66,dep=0.50,sc=0.20,wet=0.25),
 "modern":   dict(laps=50,lt=90,abr=1.00,df=0.55,pw=0.72,ot=0.76,harv=0.70,dep=0.76,sc=0.30,wet=0.20),
}
NAMES={
 "power":["Velocita Park","Nord Autodrome"],"street":["Harbour Streets","Bayfront Night"],
 "highspeed":["Green Hills","Ardennes Forest"],"technical":["Catalan Heights","Estoril Rise"],
 "modern":["Desert Mile","Marina Circuit"],
}
def jit(rng,v,frac=0.10,lo=0.0,hi=1.0):
    return max(lo,min(hi, v*(1.0+rng.rangef(-frac,frac))))
def gen_track(rng,arch=None):
    keys=list(ARCH.keys())
    if arch is None: arch=keys[rng.u32()%len(keys)]
    a=ARCH[arch]
    laps=int(round(a["laps"]*(1.0+rng.rangef(-0.08,0.08))))
    nm=NAMES[arch][rng.u32()%len(NAMES[arch])]
    t=Track(name=nm,arch=arch,laps=laps,
        lt=a["lt"]*(1.0+rng.rangef(-0.05,0.05)),
        pit=jit(rng,20.0+ (1.0-a["ot"])*4.0,0.06,16,26),
        abr=jit(rng,a["abr"],0.10,0.6,1.4),
        df=jit(rng,a["df"],0.08),pw=jit(rng,a["pw"],0.08),
        ot=jit(rng,a["ot"],0.10),harv=jit(rng,a["harv"],0.10),
        dep=jit(rng,a["dep"],0.08),sc=a["sc"],wet=a["wet"])
    return t
def gen_calendar(seed,n=6):
    rng=RNG(seed); order=["power","street","highspeed","technical","modern"]
    cal=[]
    for i in range(n): cal.append(gen_track(rng,order[i%len(order)]))
    return cal

# ============================================================================
#  TESTS
# ============================================================================
def run(track, field, seed, dt=0.25, maxsteps=400000):
    s=Sim(track,field,seed); n=0
    while not s.finished and n<maxsteps:
        s.step(dt); n+=1
    return s

def t_determinism():
    a=run(Track(),make_field(),777); b=run(Track(),make_field(),777)
    oa=[d.id for d in a.order()]; ob=[d.id for d in b.order()]
    ta=round(a.order()[0].finish_time,4); tb=round(b.order()[0].finish_time,4)
    ok=(oa==ob and ta==tb)
    print(f"[determinism] same seed -> same order & time: {ok} (winner t={ta})")
    return ok

def t_field():
    s=run(Track(),make_field(),12345)
    o=s.order()
    # soc bounds & monotonic gaps
    soc_ok=all(0.0<=d.soc<=100.0 for d in s.drivers)
    gaps=[(o[i].finish_time-o[0].finish_time) for i in range(len(o))]
    mono=all(gaps[i+1]>=gaps[i]-1e-6 for i in range(len(gaps)-1))
    # winner among the quicker half
    win_id=o[0].id
    print(f"[field] winner P1={o[0].name}(id{win_id}) soc_in_bounds={soc_ok} gaps_monotonic={mono}")
    print(f"        finishing gaps to leader: "+", ".join(f'{g:.1f}' for g in gaps))
    return soc_ok and mono and win_id<=3

def t_soc_traces():
    # isolated single car on a power track, three ERS modes, no traffic
    res={}
    for mode in ["balanced","attack","harvest"]:
        t=Track(**{**ARCH["power"],"name":"P"}); 
        d=Driver(0,"Solo",0.8); d.is_player=True; d.soc=80.0; d.ers_mode=mode
        s=Sim(t,[d],42)
        trace=[]
        for _ in range(int(t.laps/ (0.25/ (t.base_laptime)) )):
            pass
        # step ~ to lap 16
        steps=0
        while d.lap<16 and steps<200000:
            s.step(0.25); steps+=1
        res[mode]=round(d.soc,1)
    print(f"[soc] after 16 laps power-track  balanced={res['balanced']}  attack={res['attack']}  harvest={res['harvest']}")
    # expect: attack drains to ~0 (clip), harvest high, balanced in between/stable-ish
    return res["attack"] < res["balanced"]-30 and res["balanced"] <= res["harvest"]+1 and res["harvest"]>=95

def t_strategy():
    # power track: compare three strategies for an isolated reference car vs field-free,
    # measure total race time. naive attack-all should clip and NOT beat smart rationing.
    t=Track(**{**ARCH["power"],"name":"Pw"})
    def race(strategy):
        d=Driver(0,"X",0.8); d.is_player=True; d.soc=80.0
        s=Sim(t,[d],99)
        st=0
        while not d.finished and st<400000:
            # strategy sets ers each step based on soc
            if strategy=="attack_all": d.ers_mode="attack"
            elif strategy=="balanced": d.ers_mode="balanced"
            elif strategy=="smart":
                d.ers_mode="attack" if d.soc>30 else "harvest"
            s.step(0.25); st+=1
        return d.finish_time, d.clip_laps
    a=race("attack_all"); b=race("balanced"); c=race("smart")
    print(f"[strategy] power-track total time  attack_all={a[0]:.1f}s(clip {a[1]}t)  balanced={b[0]:.1f}s  smart={c[0]:.1f}s(clip {c[1]}t)")
    # smart should be <= attack_all (rationing avoids clipping losses); all finite
    return c[0]<=a[0]+0.5 and a[1]>0

def t_overtake():
    # Unit-test the Overtake mechanic directly (noise-free):
    #  (a) within 1s of car ahead -> clear laptime boost
    #  (b) beyond 1s -> no effect
    #  (c) firing it drains SoC faster than not
    #  (d) a clipped / empty battery cannot fire it
    t=Track(**{**ARCH["power"],"name":"U"})
    s=Sim(t,[Driver(0,"X",0.80)],1)
    d=s.drivers[0]; d.is_player=True; d.soc=80.0; d.ers_mode="balanced"
    d.overtake=False; off=s.laptime(d,0.5,noise=False)
    d.overtake=True;  on =s.laptime(d,0.5,noise=False)
    boost=off-on
    d.overtake=True;  far_on =s.laptime(d,1.6,noise=False)
    d.overtake=False; far_off=s.laptime(d,1.6,noise=False)
    far_eq=abs(far_on-far_off)<1e-9
    # SoC drain over one lap of holding OT vs not (soc_update is deterministic)
    da=Driver(0,"a",0.8); da.is_player=True; da.soc=80.0; da.overtake=True
    db=Driver(0,"b",0.8); db.is_player=True; db.soc=80.0; db.overtake=False
    sa=Sim(t,[da],1); sb=Sim(t,[db],1)
    for _ in range(360): sa.soc_update(da,0.25,80.0,0.5)
    for _ in range(360): sb.soc_update(db,0.25,80.0,0.5)
    drains_more=da.soc<db.soc
    dc=Driver(0,"c",0.8); dc.is_player=True; dc.soc=0.0; dc.clipped=True; dc.overtake=True
    sc=Sim(t,[dc],1); blocked=not sc.ot_effective(dc,0.5)
    print(f"[overtake] within-1s boost={boost:.2f}s  beyond-1s no-effect={far_eq}  "
          f"OT drains faster={drains_more} (soc {da.soc:.0f} vs {db.soc:.0f})  blocked-when-empty={blocked}")
    return boost>0.3 and far_eq and drains_more and blocked

def t_undercut():
    # Undercut is a stochastic edge; verify it over many seeds by mean margin.
    def margin(seed):
        a=Driver(0,"A",0.80); a.is_player=True
        b=Driver(1,"B",0.80); b.is_player=True
        a.compound=b.compound="medium"
        t=Track(name="U",laps=34,lt=90,abr=1.0)
        s=Sim(t,[a,b],seed)
        st=0
        while not s.finished and st<400000:
            a.pace_mode=b.pace_mode="balanced"; a.ers_mode=b.ers_mode="balanced"
            if a.lap==16 and a.pit_count==0 and not a.pitting: a.pitting=True; a.pit_req="soft"
            if b.lap==18 and b.pit_count==0 and not b.pitting: b.pitting=True; b.pit_req="soft"
            s.step(0.25); st+=1
        return b.finish_time-a.finish_time      # >0 => undercutter A faster
    ms=[margin(sd) for sd in range(16)]
    wins=sum(1 for m in ms if m>0); mean=sum(ms)/len(ms)
    print(f"[undercut] undercutter faster on {wins}/16 seeds, mean margin {mean:+.2f}s")
    return wins>=11 and mean>0.3

def t_track_variety():
    cal=gen_calendar(2026, 6)
    print("[calendar] generated circuits:")
    dfs=[];pws=[];abrs=[]
    for t in cal:
        dfs.append(t.downforce);pws.append(t.power);abrs.append(t.abrasion)
        print(f"   {t.name:16s} {t.arch:9s} laps={t.laps:2d} lt={t.base_laptime:5.1f} "
              f"abr={t.abrasion:.2f} df={t.downforce:.2f} pw={t.power:.2f} ot={t.overtaking:.2f} "
              f"harv={t.harvest:.2f} dep={t.deploy:.2f}")
    spread=lambda x:max(x)-min(x)
    print(f"   characteristic spread  df={spread(dfs):.2f} pw={spread(pws):.2f} abr={spread(abrs):.2f}")
    # greedy player (always attack+overtake) clips more on a power track than a street track
    def greedy_clip(arch):
        t=Track(**{**ARCH[arch],"name":arch})
        field=make_field()
        g=field[4]                      # the player car
        s=Sim(t,field,21)
        st=0
        while not s.finished and st<400000:
            g.ers_mode="attack"; g.overtake=True
            s.step(0.25); st+=1
        return g.clip_laps
    pc=greedy_clip("power"); sc=greedy_clip("street")
    print(f"   greedy-player clip ticks  power={pc}  street={sc}  (power should clip more)")
    return spread(dfs)>0.4 and spread(pws)>0.3 and pc>sc

if __name__=="__main__":
    print("="*70); print("APEX DUO 2026 CORE — VERIFICATION"); print("="*70)
    results={}
    results["determinism"]=t_determinism()
    results["field"]=t_field()
    results["soc_traces"]=t_soc_traces()
    results["strategy"]=t_strategy()
    results["overtake"]=t_overtake()
    results["undercut"]=t_undercut()
    results["track_variety"]=t_track_variety()
    print("="*70)
    print("RESULTS:", {k:("PASS" if v else "FAIL") for k,v in results.items()})
    print("ALL PASS:", all(results.values()))
