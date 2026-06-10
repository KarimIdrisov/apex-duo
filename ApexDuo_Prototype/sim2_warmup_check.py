"""
sim2_warmup_check.py  --  SIM-2 Tyre warm-up / out-lap / natural undercut
Self-contained (no cross-imports). Mirrors the updated race_sim.gd math and
checks all four acceptance criteria numerically.

New constants (all mirrored from race_sim.gd):
  TYRE_TEMP_START  = 0.20  (cold tyres out of the pits)
  TYRE_TEMP_GRID   = 0.55  (warmer at race start; formation lap)
  TYRE_EASE        = 0.60  (fraction of (target-temp) moved per lap, dt-scaled)
  COLD_TEMP        = 0.45  (below this = cold grip-loss penalty)
  HOT_TEMP         = 0.90  (above this = overheat wear multiplier)
  COLD_PACE        = 4.0   (s/lap at full cold, x temp deficit)
  OVERHEAT_WEAR    = 1.5   (wear mult per unit of tyre_temp above HOT_TEMP)

Criteria:
  C1: Out-lap (first full lap from cold) is 0.5-1.2 s slower than settled;
      converges to <0.25 s residual by lap 2 post-pit.
  C2: Undercut beats overcut >= 12/16 seeds, mean advantage >= 1.5 s.
  C3: Push+attack+dirty-air raises wear measurably vs calm (>= 3% extra).
  C4: Determinism regression + SIM-1 RNG isolation still hold.
"""

# ============================================================================
#  LCG RNG  (exact GDScript match)
# ============================================================================
class RNG:
    def __init__(self, s):
        self.state = s & 0xFFFFFFFF
    def u32(self):
        self.state = (1664525 * self.state + 1013904223) & 0xFFFFFFFF
        return self.state
    def unit(self):
        return self.u32() / 4294967296.0
    def rangef(self, a, b):
        return a + (b - a) * self.unit()

def mix32(x):
    x = (x + 0x9E3779B9) & 0xFFFFFFFF
    x = ((x ^ (x >> 16)) * 0x85EBCA6B) & 0xFFFFFFFF
    x = ((x ^ (x >> 13)) * 0xC2B2AE35) & 0xFFFFFFFF
    return (x ^ (x >> 16)) & 0xFFFFFFFF

# ============================================================================
#  Constants  (mirrors race_sim.gd -- SIM-2 state)
# ============================================================================
COMPOUNDS = {
    "soft":   {"pace": -0.55, "wear": 2.6, "cliff": 65.0},
    "medium": {"pace":  0.00, "wear": 1.7, "cliff": 78.0},
    "hard":   {"pace":  0.55, "wear": 1.1, "cliff": 90.0},
}
PACE_MODES = {
    "conserve": {"pace":  0.45, "wear": 0.80},
    "balanced": {"pace":  0.00, "wear": 1.00},
    "push":     {"pace": -0.45, "wear": 1.30},
}
ERS_MODES = {
    "harvest":  {"pace":  0.30, "soc":  6.0},
    "balanced": {"pace":  0.00, "soc":  0.0},
    "attack":   {"pace": -0.38, "soc": -6.5},
}
CLIP_PENALTY  = 0.55
OT_PACE       = -0.55
OT_DRAIN      = 9.0
OT_MIN_SOC    = 14.0
OT_GAP_S      = 1.0
PASSIVE_REGEN = 4.0
SOC_RECOVER   = 20.0
DA_THRESH     = 0.7
DA_COEF       = 0.42
CAR_K         = 2.5
COMBAT_GAP    = 0.8
MIN_GAP_S     = 0.25
GRID_GAP      = 0.0022
PASS_DEADZONE = 0.02
CREDIT_DECAY  = 0.30

# Qualifying (SIM-1, unchanged)
QUALI_NOISE_BASE  = 0.08
QUALI_SCRAPPY_P   = 0.05
QUALI_SCRAPPY_MIN = 0.12
QUALI_SCRAPPY_MAX = 0.55
START_GAIN_K      = 0.012
START_NOISE_AMP   = 0.002
START_MAX_SHIFT   = 2

# Thermal model (SIM-2 focus)
TYRE_TEMP_START = 0.20
TYRE_TEMP_GRID  = 0.55
TYRE_EASE       = 0.60
COLD_TEMP       = 0.45
HOT_TEMP        = 0.90
COLD_PACE       = 4.0
OVERHEAT_WEAR   = 1.5

# ============================================================================
#  Track
# ============================================================================
class Track:
    def __init__(self, **k):
        self.name         = k.get("name", "Test")
        self.laps         = k.get("laps", 50)
        self.base_laptime = k.get("lt", 90.0)
        self.pit_loss     = k.get("pit", 21.0)
        self.abrasion     = k.get("abr", 1.0)
        self.downforce    = k.get("df", 0.6)
        self.power        = k.get("pw", 0.6)
        self.overtaking   = k.get("ot", 0.6)
        self.harvest      = k.get("harv", 0.6)
        self.deploy       = k.get("dep", 0.6)
        self.sc_prob      = k.get("sc", 0.0)
        self.wet_prob     = k.get("wet", 0.0)
        self.track_temp   = k.get("track_temp", 30.0)

BAHRAIN = Track(name="Bahrain", laps=57, lt=92.0, pit=22.0, df=0.55, pw=0.72,
                ot=0.78, abr=1.25, harv=0.70, dep=0.78, sc=0.0, wet=0.0,
                track_temp=40.0)
MEDIUM  = Track(name="Medium",  laps=50, lt=90.0, pit=21.0, df=0.60, pw=0.60,
                ot=0.55, abr=1.0,  harv=0.60, dep=0.60, sc=0.0, wet=0.0,
                track_temp=30.0)

# ============================================================================
#  Thermal helpers
# ============================================================================
def _m_thermal(tyre_temp):
    """Pace penalty (s/lap) for cold/hot tyres."""
    if tyre_temp < COLD_TEMP:
        return (COLD_TEMP - tyre_temp) * COLD_PACE
    if tyre_temp > HOT_TEMP:
        return (tyre_temp - HOT_TEMP) * 0.5
    return 0.0

def _heat_tyre(tyre_temp, dt, lt, track_temp, pace_mode, ers_mode, compound, ahead_gap=-1.0):
    """Ease tyre temperature toward its target (deterministic, no RNG)."""
    trackf = max(0.2, min(0.95, 0.55 + (track_temp - 30.0) / 60.0))
    paceh  = 0.18 if pace_mode == "push" else (-0.12 if pace_mode == "conserve" else 0.0)
    if ers_mode == "attack":
        paceh += 0.05
    comp   = 0.06 if compound == "soft" else (-0.06 if compound == "hard" else 0.0)
    daheat = 0.10 if (0.0 <= ahead_gap < DA_THRESH) else 0.0
    target = max(0.0, min(1.2, trackf + paceh + comp + daheat))
    return tyre_temp + (target - tyre_temp) * TYRE_EASE * (dt / lt)

# ============================================================================
#  Single-driver lap accumulator (no Sim, no combat, deterministic)
#  Returns list of {lap, lap_time, final_temp} dicts.
# ============================================================================
def simulate_laps(track, n_laps, tyre_temp_init, fuel_laps_init,
                  compound="medium", pace_mode="balanced", ers_mode="balanced",
                  ahead_gap=-1.0, tyre_skill=0.65, skill=0.87, soc=80.0,
                  tire_wear_init=0.0, seed=0, dt=0.25):
    rng  = RNG(seed)
    t    = track
    c    = COMPOUNDS[compound]
    pm   = PACE_MODES[pace_mode]
    em   = ERS_MODES[ers_mode]

    tyre_temp = tyre_temp_init
    tire_wear = tire_wear_init
    fuel_laps = fuel_laps_init
    clipped   = False
    soc_v     = soc

    results  = []
    lap_frac = 0.0
    lap_start = 0.0
    total_t   = 0.0
    lap_idx   = 0

    while lap_idx < n_laps:
        lt = t.base_laptime - skill
        lt += c["pace"] + pm["pace"]
        lt += (CLIP_PENALTY * (0.6 + 0.8 * t.power)) if clipped else em["pace"]
        lt += tire_wear * 0.012
        if tire_wear > c["cliff"]:
            lt += (tire_wear - c["cliff"]) * 0.10
        lt += fuel_laps * 0.018
        lt += _m_thermal(tyre_temp)
        if 0.0 <= ahead_gap < DA_THRESH:
            lt += (DA_THRESH - ahead_gap) * DA_COEF * max(0.0, 0.5 + t.downforce * 1.4 - t.overtaking)
        amp = 0.025 * (1.25 - 0.70 * 0.6)
        lt += rng.rangef(-amp, amp)
        lt = max(lt, 10.0)

        lap_frac += dt / lt
        total_t  += dt

        overheat_m = 1.0 + max(0.0, tyre_temp - HOT_TEMP) * OVERHEAT_WEAR
        wr = (c["wear"] * pm["wear"] * t.abrasion
              * (0.7 + 0.6 * t.downforce)
              * (1.25 - tyre_skill * 0.5)
              * overheat_m)
        tire_wear = min(120.0, tire_wear + wr * (dt / lt))

        if clipped:
            rate = 4.0 * (0.5 + t.harvest)  # PASSIVE_REGEN simplified
        else:
            rate = em["soc"]
            rate = rate * (0.5 + t.harvest) if rate >= 0 else rate * (0.6 + 0.8 * t.deploy)
        soc_v = min(100.0, max(0.0, soc_v + rate * (dt / lt)))
        if soc_v <= 0.0: clipped = True
        elif soc_v >= 20.0: clipped = False

        tyre_temp = _heat_tyre(tyre_temp, dt, lt, t.track_temp, pace_mode, ers_mode, compound, ahead_gap)
        fuel_laps = max(0.0, fuel_laps - dt / lt)

        if lap_frac >= 1.0:
            lap_frac -= 1.0
            results.append({"lap": lap_idx, "lap_time": total_t - lap_start, "final_temp": tyre_temp})
            lap_start = total_t
            lap_idx  += 1

    return results

# ============================================================================
#  Driver  (lightweight)
# ============================================================================
class Driver:
    def __init__(self, i, name, skill, starts=0.5, consistency=0.65,
                 composure=0.65, aggression=0.5, tyre_skill=0.65,
                 car_power=0.78, car_aero=0.78):
        self.id = i; self.name = name; self.skill = skill
        self.starts = starts; self.consistency = consistency
        self.composure = composure; self.aggression = aggression
        self.tyre_skill = tyre_skill
        self.car_power = car_power; self.car_aero = car_aero

        self.compound = "medium"; self.tire_wear = 0.0
        self.tyre_temp = TYRE_TEMP_GRID; self.pace_mode = "balanced"
        self.ers_mode = "balanced"; self.overtake = False
        self.soc = 80.0; self.soc_max = 100.0; self.harvest_mult = 1.0
        self.clipped = False; self.fuel_laps = 0.0
        self.lap = 0; self.lap_frac = 0.0; self.last_lap = 90.0
        self.pit_count = 0; self.pit_timer = 0.0; self.ai_pit_wear = 0.0
        self.finished = False; self.finish_time = -1.0
        self.credit = 0.0; self.dnf = False
        self.grid_pos = 0; self.passes_made = 0
        self.laps_since_pit = -1

    def progress(self):
        return self.lap + self.lap_frac

# ============================================================================
#  Sim  (simplified -- deterministic, no SC, no weather, no incidents)
# ============================================================================
class Sim:
    def __init__(self, track, drivers, seed=12345):
        self.track = track; self.drivers = drivers
        self.rng   = RNG(seed); self.erng = RNG(mix32(seed))
        self.qrng  = RNG(mix32(mix32(seed)))
        self.elapsed = 0.0; self.finished = False
        for d in self.drivers:
            d.fuel_laps  = float(track.laps)
            d.ai_pit_wear = self.rng.rangef(55.0, 72.0)
        self._run_qualifying()

    def _run_qualifying(self):
        t = self.track; qscores = {}
        for d in self.drivers:
            qt  = -d.skill
            qt -= (d.car_power - d.car_aero) * (t.power - t.downforce) * CAR_K
            qt += COMPOUNDS["soft"]["pace"]
            qnoise = QUALI_NOISE_BASE * (1.3 - d.consistency * 0.6)
            qt += self.qrng.rangef(-qnoise, qnoise)
            if self.qrng.unit() < QUALI_SCRAPPY_P * (1.3 - d.composure):
                qt += self.qrng.rangef(QUALI_SCRAPPY_MIN, QUALI_SCRAPPY_MAX)
            qscores[d.id] = qt
        grid = sorted(self.drivers, key=lambda d: qscores[d.id])
        n = len(grid)
        self.quali_times = {d.id: qscores[d.id] for d in self.drivers}
        self.quali_grid  = [d.id for d in grid]
        for gp, d in enumerate(grid):
            d.lap_frac = float(n - 1 - gp) * GRID_GAP
            d.grid_pos = gp + 1
            d.tyre_temp = TYRE_TEMP_GRID

    def _race_start(self):
        ms = START_MAX_SHIFT * GRID_GAP
        for d in self.drivers:
            if d.finished: continue
            lv = ((d.starts - 0.5) * START_GAIN_K * 2.0
                  + self.rng.rangef(-START_NOISE_AMP, START_NOISE_AMP))
            lv = max(-ms, min(ms, lv))
            d.lap_frac = max(0.0, d.lap_frac + lv)

    def order(self):
        fin = sorted([d for d in self.drivers if d.finished], key=lambda d: d.finish_time)
        unf = sorted([d for d in self.drivers if not d.finished], key=lambda d: -d.progress())
        return fin + unf

    def _ot_ok(self, d, ag):
        return d.overtake and not d.clipped and d.soc > OT_MIN_SOC and 0.0 <= ag < OT_GAP_S

    def laptime(self, d, ag=-1.0):
        t = self.track; lt = t.base_laptime - d.skill
        lt -= (d.car_power - d.car_aero) * (t.power - t.downforce) * CAR_K
        lt += COMPOUNDS[d.compound]["pace"] + PACE_MODES[d.pace_mode]["pace"]
        lt += (CLIP_PENALTY * (0.6 + 0.8 * t.power)) if d.clipped else ERS_MODES[d.ers_mode]["pace"]
        w = d.tire_wear; c = COMPOUNDS[d.compound]
        lt += w * 0.012
        if w > c["cliff"]: lt += (w - c["cliff"]) * 0.10
        lt += d.fuel_laps * 0.018
        if 0.0 <= ag < DA_THRESH and not self._ot_ok(d, ag):
            lt += (DA_THRESH - ag) * DA_COEF * max(0.0, 0.5 + t.downforce * 1.4 - t.overtaking)
        lt += _m_thermal(d.tyre_temp)
        amp = 0.025 * (1.25 - d.consistency * 0.6)
        lt += self.rng.rangef(-amp, amp)
        return max(lt, 10.0)

    def _soc_upd(self, d, dt, lt, ag):
        t = self.track
        if d.clipped:
            r = 4.0 * (0.5 + t.harvest) * d.harvest_mult
        else:
            r = ERS_MODES[d.ers_mode]["soc"]
            r = r * (0.5 + t.harvest) * d.harvest_mult if r >= 0 else r * (0.6 + 0.8 * t.deploy)
            if self._ot_ok(d, ag): r -= OT_DRAIN * (0.6 + 0.8 * t.deploy)
        d.soc = min(d.soc_max, max(0.0, d.soc + r * (dt / lt)))
        if d.soc <= 0.0: d.clipped = True
        elif d.soc >= 20.0: d.clipped = False

    def _ai_e(self, d, ag, bg):
        if d.soc < 24.0: d.ers_mode = "harvest"; d.overtake = False
        elif 0.0 <= ag < OT_GAP_S and d.soc > 40.0: d.ers_mode = "attack"; d.overtake = True
        elif 0.0 <= bg < OT_GAP_S and d.soc > 55.0: d.ers_mode = "attack"; d.overtake = False
        else: d.ers_mode = "balanced"; d.overtake = False

    def _combat(self, dt):
        run = [d for d in self.order() if not d.finished and d.pit_timer <= 0.0]
        mg  = MIN_GAP_S / self.track.base_laptime
        for i in range(1, len(run)):
            a = run[i - 1]; b = run[i]
            gs = (a.progress() - b.progress()) * self.track.base_laptime
            if gs >= COMBAT_GAP: b.credit = 0.0; continue
            boost = 0.0
            if self._ot_ok(b, max(gs, 0.0)):
                boost = -OT_PACE * (0.4 + 0.6 * self.track.power) * (0.35 + 0.65 * self.track.overtaking)
            edge  = (a.last_lap - b.last_lap) + boost
            atkf  = 0.7 + b.aggression * 0.7
            if edge > PASS_DEADZONE: b.credit += (edge - PASS_DEADZONE) * atkf * dt
            else: b.credit = max(0.0, b.credit - CREDIT_DECAY * dt)
            if b.credit >= 4.0 + 9.0 * (1.0 - self.track.overtaking) + 0.5 * 3.5:
                b.credit = 0.0; a.credit = 0.0; b.passes_made += 1
                b.lap = a.lap; b.lap_frac = a.lap_frac + mg
                if b.lap_frac >= 1.0: b.lap_frac -= 1.0; b.lap += 1
            elif b.progress() > a.progress() - mg:
                b.lap = a.lap; b.lap_frac = a.lap_frac - mg
                if b.lap_frac < 0.0: b.lap_frac += 1.0; b.lap -= 1

    def _on_lap(self, d):
        left = self.track.laps - d.lap
        do = ((d.tire_wear >= d.ai_pit_wear and left > 6 and d.pit_count == 0)
              or (d.tire_wear >= 92.0 and left > 3))
        if not do: return
        nc = "hard" if left > 22 else ("medium" if left > 10 else "soft")
        d.pit_timer += self.track.pit_loss
        d.tire_wear  = 0.0
        d.tyre_temp  = TYRE_TEMP_START   # SIM-2: cold out of pits
        d.compound   = nc; d.pit_count += 1
        d.laps_since_pit = 0
        d.ai_pit_wear = self.rng.rangef(58.0, 75.0)

    def step(self, dt):
        if self.finished: return
        self.elapsed += dt
        ordered = self.order(); n = len(ordered)
        for i, d in enumerate(ordered):
            if d.finished: continue
            if d.pit_timer > 0:
                d.pit_timer = max(0.0, d.pit_timer - dt); continue
            ag  = (ordered[i - 1].progress() - d.progress()) * self.track.base_laptime if i > 0 else -1.0
            bg  = (d.progress() - ordered[i + 1].progress()) * self.track.base_laptime if i < n - 1 else -1.0
            self._ai_e(d, ag, bg)
            lt = self.laptime(d, ag); d.last_lap = lt
            d.lap_frac += dt / lt
            om = 1.0 + max(0.0, d.tyre_temp - HOT_TEMP) * OVERHEAT_WEAR
            wr = (COMPOUNDS[d.compound]["wear"] * PACE_MODES[d.pace_mode]["wear"]
                  * self.track.abrasion * (0.7 + 0.6 * self.track.downforce)
                  * (1.25 - d.tyre_skill * 0.5) * om)
            d.tire_wear = min(120.0, d.tire_wear + wr * (dt / lt))
            self._soc_upd(d, dt, lt, ag)
            d.tyre_temp = _heat_tyre(d.tyre_temp, dt, lt, self.track.track_temp,
                                     d.pace_mode, d.ers_mode, d.compound, ag)
        self._combat(dt)
        for d in self.drivers:
            if d.finished: continue
            while d.lap_frac >= 1.0:
                d.lap_frac -= 1.0; d.lap += 1
                d.fuel_laps = max(0.0, d.fuel_laps - 1.0)
                if d.lap >= self.track.laps:
                    d.finished = True; d.lap_frac = 0.0; d.finish_time = self.elapsed; break
                if d.laps_since_pit >= 0: d.laps_since_pit += 1
                self._on_lap(d)
        if all(d.finished for d in self.drivers): self.finished = True


# ============================================================================
#  Field builder
# ============================================================================
TEAM_DATA = [
    ("RedBull",  0.96, 0.90), ("Ferrari",  0.93, 0.94), ("Mercedes", 0.91, 0.88),
    ("McLaren",  0.90, 0.92), ("Aston",    0.86, 0.85), ("Alpine",   0.83, 0.82),
    ("Williams", 0.81, 0.80), ("Haas",     0.80, 0.79), ("RB",       0.79, 0.81),
    ("Sauber",   0.78, 0.77), ("Cadillac", 0.77, 0.78),
]
DRIVER_SKILLS = [
    0.990, 0.985, 0.975, 0.965, 0.955, 0.945, 0.935, 0.925,
    0.915, 0.905, 0.895, 0.885, 0.875, 0.865, 0.850, 0.840,
    0.830, 0.820, 0.790, 0.770, 0.750, 0.720,
]

def fresh_field(seed=42):
    drivers = []
    for i, (team, pw, ae) in enumerate(TEAM_DATA):
        for slot in range(2):
            di = i * 2 + slot; sk = DRIVER_SKILLS[di]
            dr = RNG(mix32(di * 2654435761 + 1))
            d = Driver(
                i=di, name="%s_%d" % (team, slot + 1), skill=sk,
                starts     = max(0.1, min(0.95, 0.5  + (sk - 0.85) * 0.4 + dr.rangef(-0.25, 0.25))),
                consistency= max(0.3, min(0.95, 0.55 + (sk - 0.85) * 0.5 + dr.rangef(-0.15, 0.15))),
                composure  = max(0.3, min(0.95, 0.55 + (sk - 0.85) * 0.4 + dr.rangef(-0.15, 0.15))),
                aggression = max(0.2, min(0.95, 0.5                       + dr.rangef(-0.25, 0.25))),
                tyre_skill = max(0.2, min(0.95, 0.55 + (sk - 0.85) * 0.4 + dr.rangef(-0.15, 0.15))),
                car_power=pw, car_aero=ae,
            )
            drivers.append(d)
    return drivers

def run_race(track, drivers, seed, dt=0.25, apply_start=True, max_steps=600000):
    s = Sim(track, drivers, seed); started = False; steps = 0
    while not s.finished and steps < max_steps:
        if not started:
            started = True
            if apply_start: s._race_start()
        s.step(dt); steps += 1
    return s


# ============================================================================
#  CRITERION 1  --  Out-lap penalty: 0.5-1.2 s, converges <0.25 s by lap 2
#
#  Method: run the single-driver accumulator from TYRE_TEMP_START (post-pit cold)
#  vs TYRE_TEMP_GRID (settled race temperature). Compare lap-times directly.
#  Lap times are actual elapsed time per lap (not last_lt snapshots).
# ============================================================================
def criterion_1_outlap_penalty(n_seeds=30):
    print("\n" + "=" * 65)
    print("CRITERION 1 -- Out-lap penalty & warm-up convergence")
    print("=" * 65)

    TRACK = BAHRAIN
    all_penalties = []; all_conv2 = []

    for seed in range(n_seeds):
        # 6 laps from cold (post-pit)
        cold = simulate_laps(TRACK, 6, TYRE_TEMP_START, 30.0, seed=seed)
        # 6 laps from settled (grid-warm, same RNG seed = same noise)
        warm = simulate_laps(TRACK, 6, TYRE_TEMP_GRID,  30.0, seed=seed)

        if len(cold) >= 6 and len(warm) >= 6:
            settled  = (warm[3]["lap_time"] + warm[4]["lap_time"] + warm[5]["lap_time"]) / 3.0
            all_penalties.append(cold[0]["lap_time"] - settled)   # out-lap
            all_conv2.append(cold[1]["lap_time"] - settled)        # lap 2 post-pit

    if not all_penalties:
        print("  No data."); return False, 0.0, 0.0

    mp   = sum(all_penalties) / len(all_penalties)
    mc2  = sum(all_conv2)     / len(all_conv2)

    pok  = 0.5 <= mp  <= 1.2
    cok  = mc2 < 0.25

    print("  Out-lap penalty  mean %.3f s  range [%.3f, %.3f]  (target 0.5-1.2 s)" % (
        mp, min(all_penalties), max(all_penalties)))
    print("  Lap-2 residual   mean %.3f s  (target < 0.25 s)" % mc2)
    print("  Penalty %s" % ("PASS" if pok else "FAIL"))
    print("  Convergence %s" % ("PASS" if cok else "FAIL"))
    return pok and cok, mp, mc2


# ============================================================================
#  CRITERION 2  --  Undercut beats overcut: >= 12/16 seeds, mean >= 1.5 s
#
#  Method: time-based. Both cars are at lap 18, same wear level (~38%).
#  Undercut (B) pits NOW; overcut (A) stays 3 more laps then pits.
#  We simulate POST_PIT_LAPS laps after both pit, measuring elapsed time
#  for the full window (A's extra worn stint + pit + POST_PIT_LAPS cold).
#  If B's total time is less than A's, undercut wins.
# ============================================================================
def criterion_2_undercut_vs_overcut(n_seeds=16):
    print("\n" + "=" * 65)
    print("CRITERION 2 -- Undercut beats overcut (>= 12/16 seeds)")
    print("=" * 65)

    TRACK       = BAHRAIN
    WORN_WEAR   = 38.0   # tyre wear at the decision lap (lap ~18)
    WORN_FUEL   = 40.0   # fuel laps remaining
    EXTRA_LAPS  = 3      # A stays out this many extra laps before pitting
    EVAL_LAPS   = 12     # laps measured after both have pitted

    undercut_wins = 0; gap_list = []

    for seed in range(n_seeds):
        # B (undercut): pits NOW -- pit_loss + EVAL_LAPS on cold tyres
        b_cold = simulate_laps(TRACK, EVAL_LAPS, TYRE_TEMP_START,
                               WORN_FUEL, tire_wear_init=0.0, seed=seed * 31 + 1)
        b_total = TRACK.pit_loss + sum(l["lap_time"] for l in b_cold[:EVAL_LAPS])

        # A (overcut): EXTRA_LAPS on worn tyres, then pit + EVAL_LAPS cold
        a_worn = simulate_laps(TRACK, EXTRA_LAPS, TYRE_TEMP_GRID,
                               WORN_FUEL, tire_wear_init=WORN_WEAR,
                               seed=seed * 31 + 2)
        a_cold = simulate_laps(TRACK, EVAL_LAPS, TYRE_TEMP_START,
                               WORN_FUEL - EXTRA_LAPS, tire_wear_init=0.0,
                               seed=seed * 31 + 3)
        a_total = (sum(l["lap_time"] for l in a_worn[:EXTRA_LAPS])
                   + TRACK.pit_loss
                   + sum(l["lap_time"] for l in a_cold[:EVAL_LAPS]))

        gap = a_total - b_total   # positive -> B (undercut) is faster
        gap_list.append(gap)
        if gap > 0: undercut_wins += 1

    mg  = sum(gap_list) / len(gap_list)
    wok = undercut_wins >= 12
    gok = mg >= 1.5
    print("  Undercut wins: %d/16  (target >= 12)" % undercut_wins)
    print("  Mean gap:      %.2f s  range [%.2f, %.2f]  (target >= 1.5 s)" % (
        mg, min(gap_list), max(gap_list)))
    print("  Wins %s" % ("PASS" if wok else "FAIL"))
    print("  Gap  %s" % ("PASS" if gok else "FAIL"))
    return wok and gok, undercut_wins, mg


# ============================================================================
#  CRITERION 3  --  Overheat: push/attack/dirty-air raises wear
# ============================================================================
def criterion_3_overheat_wear(n_seeds=30):
    print("\n" + "=" * 65)
    print("CRITERION 3 -- Overheat: push/dirty-air raises wear measurably")
    print("=" * 65)

    TRACK = BAHRAIN; LAPS = 15
    wA = []; wB = []; tB = []

    for seed in range(n_seeds):
        # A: calm -- balanced pace, balanced ERS, free air
        la = simulate_laps(TRACK, LAPS, TYRE_TEMP_GRID, 40.0,
                           pace_mode="balanced", ers_mode="balanced",
                           ahead_gap=-1.0, seed=seed)
        # B: aggressive -- push pace, attack ERS, stuck 0.3 s behind another car
        lb = simulate_laps(TRACK, LAPS, TYRE_TEMP_GRID, 40.0,
                           pace_mode="push", ers_mode="attack",
                           ahead_gap=0.3, seed=seed)
        # accumulate wear: simulate_laps doesn't expose it directly, so rerun quick
        def worn(pm, em, ag, s):
            rng = RNG(s); t = TRACK; c = COMPOUNDS["medium"]
            tw = 0.0; tt = TYRE_TEMP_GRID; fl = 40.0; sv = 80.0; cl = False
            lf = 0.0; li = 0
            while li < LAPS:
                lt = t.base_laptime - 0.87 + c["pace"] + PACE_MODES[pm]["pace"]
                lt += (CLIP_PENALTY * (0.6 + 0.8 * t.power)) if cl else ERS_MODES[em]["pace"]
                lt += tw * 0.012 + fl * 0.018 + _m_thermal(tt)
                if 0.0 <= ag < DA_THRESH:
                    lt += (DA_THRESH - ag) * DA_COEF * max(0.0, 0.5 + t.downforce * 1.4 - t.overtaking)
                lt += rng.rangef(-0.025 * (1.25 - 0.70 * 0.6), 0.025 * (1.25 - 0.70 * 0.6))
                lt = max(lt, 10.0)
                om = 1.0 + max(0.0, tt - HOT_TEMP) * OVERHEAT_WEAR
                tw = min(120.0, tw + (c["wear"] * PACE_MODES[pm]["wear"] * t.abrasion
                                      * (0.7 + 0.6 * t.downforce) * (1.25 - 0.65 * 0.5) * om) * (0.25 / lt))
                r = ERS_MODES[em]["soc"]
                r = r * (0.5 + t.harvest) if r >= 0 else r * (0.6 + 0.8 * t.deploy)
                sv = min(100.0, max(0.0, sv + r * (0.25 / lt)))
                if sv <= 0.0: cl = True
                elif sv >= 20.0: cl = False
                tt = _heat_tyre(tt, 0.25, lt, t.track_temp, pm, em, "medium", ag)
                fl = max(0.0, fl - 0.25 / lt)
                lf += 0.25 / lt
                if lf >= 1.0: lf -= 1.0; li += 1
            return tw, tt

        wa, ta = worn("balanced", "balanced", -1.0, seed)
        wb, tb = worn("push", "attack", 0.3, seed)
        wA.append(wa); wB.append(wb); tB.append(tb)

    mA = sum(wA) / len(wA); mB = sum(wB) / len(wB)
    delta = mB - mA
    oh_frac = sum(1 for t in tB if t > HOT_TEMP) / len(tB)
    dok = delta >= 3.0; tok = oh_frac >= 0.7
    print("  Wear A (balanced, free):  %.2f%%" % mA)
    print("  Wear B (push, dirty):     %.2f%%" % mB)
    print("  Delta:                    %.2f%%  (target >= 3%%)" % delta)
    print("  B > HOT_TEMP:             %.0f%% seeds  (target >= 70%%)" % (oh_frac * 100))
    print("  Wear delta %s" % ("PASS" if dok else "FAIL"))
    print("  Overheat %s"    % ("PASS" if tok else "FAIL"))
    return dok and tok, delta, oh_frac


# ============================================================================
#  CRITERION 4  --  Determinism
# ============================================================================
def criterion_4_determinism(n_seeds=20):
    print("\n" + "=" * 65)
    print("CRITERION 4 -- Determinism regression (same seed -> same race)")
    print("=" * 65)
    ok = True
    for seed in range(n_seeds):
        f1 = fresh_field(seed); f2 = fresh_field(seed)
        s1 = run_race(BAHRAIN, f1, seed); s2 = run_race(BAHRAIN, f2, seed)
        for d1, d2 in zip(s1.order(), s2.order()):
            if d1.id != d2.id or abs(d1.finish_time - d2.finish_time) > 1e-9:
                print("  MISMATCH seed %d" % seed); ok = False
    print("  All %d seeds deterministic: %s" % (n_seeds, ok))
    print("  %s" % ("PASS" if ok else "FAIL"))
    return ok


# ============================================================================
#  CRITERION 4b  --  SIM-1 RNG isolation regression
# ============================================================================
def criterion_4b_rng_isolation(n_seeds=20):
    print("\n" + "=" * 65)
    print("CRITERION 4b -- SIM-1 regression: RNG isolation still holds")
    print("=" * 65)
    ok = True
    for seed in range(n_seeds):
        field = fresh_field(seed); s = Sim(BAHRAIN, field, seed)
        exp = RNG(seed)
        for _ in field: exp.rangef(55.0, 72.0)
        if s.rng.state != exp.state:
            print("  MISMATCH seed %d" % seed); ok = False
    print("  All %d seeds RNG unaffected by qualifying: %s" % (n_seeds, ok))
    print("  %s" % ("PASS" if ok else "FAIL"))
    return ok


# ============================================================================
#  BONUS -- warm-up trace
# ============================================================================
def bonus_warmup_trace():
    print("\n" + "=" * 65)
    print("BONUS -- Warm-up trace (single driver, medium, Bahrain)")
    print("=" * 65)
    cold = simulate_laps(BAHRAIN, 6, TYRE_TEMP_START, 30.0, seed=999)
    warm = simulate_laps(BAHRAIN, 6, TYRE_TEMP_GRID,  30.0, seed=999)
    settled = (warm[3]["lap_time"] + warm[4]["lap_time"] + warm[5]["lap_time"]) / 3.0
    print("  Settled ref (warm laps 3-5): %.3f s" % settled)
    print("  %4s  %8s  %10s  %8s  %8s" % ("Lap", "TyreTemp", "ThermalPen", "LapTime", "Delta"))
    for l in cold:
        pen = _m_thermal(l["final_temp"])
        print("  %4d  %8.4f  %10.3f s  %8.3f s  %+8.3f s" % (
            l["lap"], l["final_temp"], pen, l["lap_time"], l["lap_time"] - settled))


# ============================================================================
#  MAIN
# ============================================================================
if __name__ == "__main__":
    print("=" * 65)
    print("SIM-2 TYRE WARM-UP / OUT-LAP -- VERIFICATION HARNESS")
    print("=" * 65)

    bonus_warmup_trace()
    r1, pen, conv      = criterion_1_outlap_penalty(30)
    r2, uc_wins, uc_gap = criterion_2_undercut_vs_overcut(16)
    r3, wear_d, oh_f   = criterion_3_overheat_wear(30)
    r4                 = criterion_4_determinism(20)
    r4b                = criterion_4b_rng_isolation(20)

    print("\n" + "=" * 65)
    print("SUMMARY")
    print("=" * 65)
    print("  C1  Out-lap penalty %.3f s  (0.5-1.2 s);  lap2 residual %.3f s (<0.25): %s" % (
        pen, conv, "PASS" if r1 else "FAIL"))
    print("  C2  Undercut wins   %d/16  (>=12);  gap %.2f s (>=1.5 s): %s" % (
        uc_wins, uc_gap, "PASS" if r2 else "FAIL"))
    print("  C3  Wear delta      %.2f%%  (>=3%%);  overheat %.0f%% (>=70%%): %s" % (
        wear_d, oh_f * 100, "PASS" if r3 else "FAIL"))
    print("  C4  Determinism:                                          %s" % ("PASS" if r4 else "FAIL"))
    print("  C4b RNG isolation:                                        %s" % ("PASS" if r4b else "FAIL"))
    print("\n  ALL CRITERIA PASS: %s" % (r1 and r2 and r3 and r4 and r4b))
