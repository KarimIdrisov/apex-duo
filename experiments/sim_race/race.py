#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SPIKE / proof-of-concept — NOT the game, NOT final engine.

Goal: prove that a positional race animation "like the bicycle_race experiment"
can be driven by an ABSTRACT lap-time management engine instead of by steering
physics. There is NO bicycle model, NO Stanley/PID here: each car's position on
track comes from a single scalar `progress = lap + lap_frac`, advanced every tick
by an abstract lap-time model (skill + tyre wear + fuel + pit stops + wheel-to-
wheel hold-up). The renderer then maps `lap_frac` to a point on the SVG track
centreline — exactly the data a manager game needs to draw its own race view.

This is the "approach C" runtime sketch: a time-discrete engine (advances a
fraction of a lap per dt) so the animation is smooth natively, with the lap-time
NUMBERS being where real physics/calibration (TUMFTM laptime-simulation) would
later be baked in.

Run:
  python experiments/sim_race/race.py                      # live animation
  python experiments/sim_race/race.py --svg svg/monza-7.svg --laps 18
  python experiments/sim_race/race.py --headless           # no render, print result
  python experiments/sim_race/race.py --save out.gif       # save a GIF
"""

import argparse
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SVG_DIR = os.path.join(HERE, "..", "bicycle_race", "svg")  # reuse the experiment's tracks

DT = 0.25                      # sim time-step [s]  (time-discrete, like race_sim.gd)
TIME_SCALE = 12.0              # speed up wall-clock so a race plays in seconds

# --- abstract lap-time model (seconds) — this is the "engine", no geometry here ---
BASE_LAP = 90.0                # reference clean lap [s] for a baseline car/track
SKILL_SPREAD = 0.020           # pace multiplier spread between cars (fraction)
FUEL_PER_LAP = 0.035           # [s/lap] each lap of fuel still onboard costs this
PIT_LOSS = 22.0               # [s] time lost serving a pit stop
GRID_GAP = 0.9                # [s] spacing between grid slots (tight pack behind S/F)

COMPOUNDS = {                  # pace = s/lap vs baseline; deg = s/lap of tyre age
    "S": {"pace": -0.7, "deg": 0.085, "cliff_age": 15, "cliff": 0.55, "col": "#e8002d"},
    "M": {"pace":  0.0, "deg": 0.055, "cliff_age": 24, "cliff": 0.40, "col": "#ffd12e"},
    "H": {"pace":  0.6, "deg": 0.030, "cliff_age": 34, "cliff": 0.30, "col": "#cfcfcf"},
}

# --- wheel-to-wheel (all in SECONDS of on-track gap) ------------------------------
COMBAT_GAP = 1.0     # within this gap the follower is held up (can't drive through)
DIRTY_AIR = 0.22     # [s/lap] pace penalty while stuck in the gap (lost downforce)
PASS_NEED = 0.6      # accumulated pace-edge "credit" [s] needed to attempt a pass
CREDIT_DECAY = 0.02  # [credit/s] credit bleeds this slowly when out of the gap
MIN_GAP = 0.25       # min gap kept nose-to-tail [s]

# --- racing line / trajectory (a better line is faster) ---------------------------
LINE_LAP_GAIN = 1.6  # [s/lap] swing between the worst and best line skill
OFFLINE_CORNER_COST = 0.22  # corner-speed loss when fully off the ideal line (wide)

# --- collisions / incidents (an overtake attempt can go wrong) --------------------
INCIDENT_BASE = 0.09        # base chance a pass attempt ends in contact
INCIDENT_CORNER_MULT = 3.0  # ...multiplied up in slow corners (riskier there)
INCIDENT_LIGHT_LOSS = 2.5   # [s] time lost in a light wheel-bang (pass aborted)
INCIDENT_SPIN_LOSS = 13.0   # [s] time lost in a spin
INCIDENT_SPIN_FRAC = 0.40   # fraction of incidents that are spins (vs light)
INCIDENT_DNF_FRAC = 0.09    # fraction of spins that end the race (retirement)

# --- rendering only ---------------------------------------------------------------
TRACK_WIDTH = 42.0
TARGET_LEN = 2600.0
N_POINTS = 480
OFFSET = 12.0        # lateral shift [units] shown while overtaking (cosmetic)
OFFSET_RATE = 0.9
CAR_LENGTH = 20.0    # drawn + used for the no-overlap separation net [units]
CAR_WIDTH = 9.0      # lateral car size [units] (two cars overlap if |Δoffset| < this)

# --- speed profile (g-g idea borrowed from fastest-lap / laptime-simulation) ------
# Friction-limited corner speed + braking/traction passes. SHAPE only: the absolute
# scale cancels in the lap-time normalisation, so each car still hits its exact
# clean_laptime() over the lap — the profile only decides WHERE it is slow (corners)
# and fast (straights). Reimplemented here, no external code/DLL.
VMAX_U = 90.0        # top speed [track units/s]
A_LAT = 30.0         # lateral grip [units/s^2]  -> corner speed = sqrt(A_LAT/kappa)
A_BRAKE = 55.0       # braking deceleration [units/s^2]
A_DRIVE = 22.0       # power-limited acceleration [units/s^2]
PALETTE = ["#ff8000", "#27f4d2", "#3671c6", "#e8002d", "#64c4ff",
           "#229971", "#b6babd", "#52e252", "#6692ff", "#c9a227"]
NAMES = ["VER", "NOR", "LEC", "RUS", "PIA", "HAM", "ALO", "SAI", "PER", "GAS"]


# ---------------------------------------------------------------------------------
# Track geometry (rendering): a closed centreline + per-point unit left-normal.
# ---------------------------------------------------------------------------------
def load_track(svg_path):
    import importlib.util
    tool = os.path.join(HERE, "..", "..", "tools", "svg_to_trackshapes.py")
    spec = importlib.util.spec_from_file_location("svgtool", tool)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    poly, _ = mod.flatten(mod.get_d(svg_path))
    pts = np.array(mod.resample_closed(poly, N_POINTS), float)
    pts[:, 1] = -pts[:, 1]                                  # SVG y-down -> up
    seg = np.hypot(np.diff(pts[:, 0], append=pts[:1, 0]),
                   np.diff(pts[:, 1], append=pts[:1, 1]))
    pts *= TARGET_LEN / seg.sum()                           # scale to a sane size

    x, y = pts[:, 0], pts[:, 1]
    tx = np.roll(x, -1) - np.roll(x, 1)
    ty = np.roll(y, -1) - np.roll(y, 1)
    nrm = np.hypot(tx, ty)
    nrm[nrm == 0] = 1.0
    tx, ty = tx / nrm, ty / nrm
    normals = np.column_stack([-ty, tx])                    # left normal
    return pts, normals


def _smooth_cyclic(a, k=5):
    pad = np.concatenate([a[-k:], a, a[:k]])
    return np.convolve(pad, np.ones(k) / k, mode="same")[k:-k]


def speed_profile(pts):
    """Quasi-steady-state speed at each centreline point: friction-limited corner
    speed (v = sqrt(A_LAT / curvature), capped at VMAX_U), then a backward braking
    pass and a forward traction pass (cyclic). Returns v[i] in track units/s. This
    is the g-g idea from fastest-lap / laptime-simulation, reimplemented locally."""
    n = len(pts)
    x, y = pts[:, 0], pts[:, 1]
    dx, dy = np.roll(x, -1) - x, np.roll(y, -1) - y
    ds = np.hypot(dx, dy)
    ds[ds == 0] = 1e-6
    theta = np.arctan2(dy, dx)
    dth = np.abs(((np.roll(theta, -1) - theta + np.pi) % (2 * np.pi)) - np.pi)
    kappa = _smooth_cyclic(dth / ds, 5)                    # 1/R at each point
    v = np.sqrt(A_LAT / np.maximum(kappa, A_LAT / VMAX_U ** 2))   # corner limit
    for _ in range(3):                                     # converge across the seam
        for i in range(n - 1, -1, -1):                    # braking: look at next pt
            j = (i + 1) % n
            v[i] = min(v[i], np.sqrt(v[j] ** 2 + 2 * A_BRAKE * ds[i]))
        for i in range(n):                                # traction: look at prev pt
            j = (i - 1) % n
            v[i] = min(v[i], np.sqrt(v[j] ** 2 + 2 * A_DRIVE * ds[j]))
    return v


class Track:
    """Geometry + a precomputed speed profile. `cornerness[i]` in [0,1] is 0 on the
    fastest straight and 1 in the slowest corner (used for line/incident risk)."""
    def __init__(self, pts, normals):
        self.pts = pts
        self.normals = normals
        self.n = len(pts)
        self.vprof = speed_profile(pts)
        self.vrecip_mean = float(np.mean(1.0 / self.vprof))   # lap-time normaliser
        rng = self.vprof.max() - self.vprof.min() + 1e-9
        self.cornerness = 1.0 - (self.vprof - self.vprof.min()) / rng

    def at(self, frac):
        """Map a lap fraction [0,1) to (point, heading, left-normal, index)."""
        t = (frac % 1.0) * self.n
        i = int(t) % self.n
        a = t - int(t)
        j = (i + 1) % self.n
        p = self.pts[i] * (1 - a) + self.pts[j] * a
        heading = np.arctan2(self.pts[j][1] - self.pts[i][1],
                             self.pts[j][0] - self.pts[i][0])
        return p, heading, self.normals[i], i


# ---------------------------------------------------------------------------------
# The abstract lap-time engine.  A Driver owns no x/y — only a scalar progress.
# ---------------------------------------------------------------------------------
class Driver:
    def __init__(self, i, skill, line, grid_slot, total_laps, rng):
        self.i = i
        self.name = NAMES[i % len(NAMES)]
        self.color = PALETTE[i % len(PALETTE)]
        self.skill = skill                       # pace multiplier (lower = faster)
        self.line = line                         # racing-line quality 0..1 (1 = ideal)
        self.rng = np.random.default_rng(1000 + i)  # per-driver incident RNG (seeded)
        self.compound = "M" if i % 2 == 0 else "S"
        self.tyre_age = 0
        self.fuel = float(total_laps)            # laps of fuel onboard
        self.total_laps = total_laps
        self.lap = 0
        # tight starting grid: all cars lined up just BEHIND the S/F line, GRID_GAP
        # seconds apart (P1 at the front). progress measured in laps.
        self.frac = -(grid_slot + 1) * (GRID_GAP / BASE_LAP)
        self.progress = self.lap + self.frac
        self.finished = False
        self.dnf = False
        self.finish_time = None
        self.grid_pos = grid_slot + 1
        # one planned pit stop, roughly mid-race with a little spread
        self.pit_lap = int(total_laps * 0.5 + rng.integers(-2, 3))
        self.pit_done = False
        self.pit_timer = 0.0                     # seconds still being served
        self.next_compound = "H" if self.compound == "S" else "S"
        self.penalty_timer = 0.0                 # seconds lost recovering an incident
        self.pass_credit = 0.0                   # toward overtaking the car ahead
        self.offset = 0.0                        # lateral position (line / overtake)
        self.target_offset = 0.0
        self.overtakes = 0
        self.incidents = 0

    def clean_laptime(self):
        """Current clean lap time [s] from the abstract model."""
        c = COMPOUNDS[self.compound]
        t = BASE_LAP * self.skill + c["pace"]
        t += LINE_LAP_GAIN * (1.0 - self.line)             # a worse line is slower
        t += c["deg"] * self.tyre_age                      # linear wear
        if self.tyre_age > c["cliff_age"]:                 # tyre cliff
            t += c["cliff"] * (self.tyre_age - c["cliff_age"])
        t += FUEL_PER_LAP * self.fuel                      # heavy car = slow
        return t

    def _attempt_pass(self, ahead, corner):
        """Resolve an earned overtake attempt. Risk rises in slow corners and with
        poorer racing lines (both cars). Clean -> slot ahead; contact -> light bang
        (pass aborted, time lost), a spin (big loss), or rarely a retirement."""
        self.pass_credit = 0.0
        risk = INCIDENT_BASE * (1.0 + INCIDENT_CORNER_MULT * corner)
        risk *= 0.5 + (2.0 - self.line - ahead.line)       # poorer lines => riskier
        if self.rng.random() > risk:                       # clean pass
            self.progress = ahead.progress + MIN_GAP / BASE_LAP
            self.lap = int(self.progress)
            self.frac = self.progress - self.lap
            self.overtakes += 1
            return
        self.incidents += 1                                # contact
        if self.rng.random() < INCIDENT_SPIN_FRAC:         # a spin (or worse)
            if self.rng.random() < INCIDENT_DNF_FRAC:
                self.finished = True
                self.dnf = True
                return
            self.penalty_timer = INCIDENT_SPIN_LOSS
            ahead.penalty_timer = max(ahead.penalty_timer, INCIDENT_LIGHT_LOSS)
        else:                                              # light wheel-bang
            self.penalty_timer = INCIDENT_LIGHT_LOSS

    def advance(self, dt, ahead, gap, sim_time, track):
        if self.finished:
            return
        # serving a pit stop or recovering from an incident: frozen, no progress
        if self.pit_timer > 0.0:
            self.pit_timer -= dt
            return
        if self.penalty_timer > 0.0:
            self.penalty_timer -= dt
            return

        idx = int((self.frac % 1.0) * track.n) % track.n
        corner = track.cornerness[idx]                      # 0 straight .. 1 hairpin
        laptime = self.clean_laptime()

        # --- wheel-to-wheel: held up behind a car within COMBAT_GAP ---
        held = False
        if ahead is not None and 0.0 < gap < COMBAT_GAP:
            laptime += DIRTY_AIR                            # dirty air costs pace
            edge = ahead.clean_laptime() - self.clean_laptime()  # >0 => we're faster
            if edge > 0:
                self.pass_credit += edge * (dt / laptime)
            if self.pass_credit >= PASS_NEED:
                self._attempt_pass(ahead, corner)           # earned a move -> risk it
            else:
                held = True                                 # can't get through yet
        else:
            self.pass_credit = max(0.0, self.pass_credit - dt * CREDIT_DECAY)
        if self.finished:                                   # a DNF may have happened
            return

        # pull off the ideal line when attacking, return to it otherwise
        self.target_offset = OFFSET if (held or self.pass_credit > 0.4) else 0.0
        self.offset += float(np.clip(self.target_offset - self.offset,
                                     -OFFSET_RATE, OFFSET_RATE))

        # fraction of a lap this tick, SHAPED by the local speed (slow in corners,
        # fast on straights). vrecip_mean normalises so a clean lap takes exactly
        # `laptime`. Being OFF the ideal line costs corner speed (overtaking wide /
        # being shoved out) -> natural switchbacks; this is an un-normalised loss.
        v_local = track.vprof[idx]
        offline = abs(self.offset) / max(OFFSET, 1e-6)
        v_local *= 1.0 - OFFLINE_CORNER_COST * offline * corner
        dfrac = v_local * track.vrecip_mean / laptime * dt
        if held:
            cap = (ahead.progress - MIN_GAP / BASE_LAP) - self.progress
            dfrac = max(0.0, min(dfrac, cap))

        self.frac += dfrac
        self.progress = self.lap + self.frac

        # --- lap completion: bookkeeping (fuel, wear, pit) lives HERE only ---
        if self.frac >= 1.0:
            self.frac -= 1.0
            self.lap += 1
            self.tyre_age += 1
            self.fuel = max(0.0, self.fuel - 1.0)
            self.progress = self.lap + self.frac
            if not self.pit_done and self.lap >= self.pit_lap:
                self.pit_done = True
                self.pit_timer = PIT_LOSS
                self.compound = self.next_compound
                self.tyre_age = 0
            if self.lap >= self.total_laps:
                self.finished = True
                self.finish_time = sim_time


def build_field(n_cars, total_laps, seed=7):
    rng = np.random.default_rng(seed)
    drivers = []
    for slot in range(n_cars):
        # fast cars start at the BACK so they must overtake (demonstrates combat),
        # mirroring the bicycle_race spike. lower skill mult = faster lap time.
        skill = 1.0 - (slot - n_cars / 2) * SKILL_SPREAD + rng.normal(0, 0.002)
        line = float(np.clip(rng.normal(0.93, 0.05), 0.80, 1.0))  # racing-line quality
        drivers.append(Driver(slot, skill, line, slot, total_laps, rng))
    return drivers


def step_field(drivers, dt, sim_time, track):
    """One sim tick: find each car's car-ahead + gap (in seconds), advance all, then
    a geometric no-overlap safety net so cars in the same lane never render on top
    of each other (push the rear car back along the track)."""
    order = sorted([d for d in drivers if not d.finished],
                   key=lambda d: d.progress, reverse=True)
    for k, d in enumerate(order):
        ahead = order[k - 1] if k > 0 else None
        gap = (ahead.progress - d.progress) * BASE_LAP if ahead else 1e9
        d.advance(dt, ahead, gap, sim_time, track)

    # no-overlap net: same-lane cars kept at least MIN_GAP apart (skip ones serving
    # a pit/penalty — they're stationary off the racing line).
    active = [d for d in order if d.pit_timer <= 0 and d.penalty_timer <= 0]
    active.sort(key=lambda d: d.progress, reverse=True)
    min_sep = MIN_GAP / BASE_LAP
    for k in range(1, len(active)):
        front, rear = active[k - 1], active[k]
        if abs(front.offset - rear.offset) < CAR_WIDTH and \
                front.progress - rear.progress < min_sep:
            rear.progress = front.progress - min_sep
            rear.lap = int(rear.progress)
            rear.frac = rear.progress - rear.lap


def _shrink_gif(path, fps, colors=64):
    """Re-quantise a saved GIF to ONE shared palette — the speed-coloured line forces
    a huge per-frame palette otherwise. A shared palette lets the static background
    diff out between frames, cutting file size several-fold with no visible change."""
    from PIL import Image
    im = Image.open(path)
    rgb = []
    for i in range(im.n_frames):
        im.seek(i)
        rgb.append(im.convert("RGB"))
    palette = rgb[0].quantize(colors=colors, method=Image.MEDIANCUT)   # one palette
    frames = [f.quantize(palette=palette, dither=Image.NONE) for f in rgb]
    frames[0].save(path, save_all=True, append_images=frames[1:],
                   duration=int(1000 / fps), loop=0, optimize=True)


def standings(drivers):
    """Order the field: classified finishers (by finish time) on top, then cars still
    running (by progress), then retirements (DNF) last."""
    def key(d):
        if d.dnf:
            return (0, d.progress)                 # retirements at the bottom
        if d.finished:
            return (2, -d.finish_time)             # finishers: earlier = higher
        return (1, d.progress)                     # still running: further = higher
    return sorted(drivers, key=key, reverse=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cars", type=int, default=6)
    ap.add_argument("--laps", type=int, default=16)
    ap.add_argument("--svg", default="svg/monza-7.svg",
                    help="circuit SVG relative to bicycle_race/svg, or an abs path")
    ap.add_argument("--save", default=None, help="save animation to this GIF path")
    ap.add_argument("--spf", type=float, default=1.0,
                    help="sim SECONDS advanced per rendered frame (smaller = smoother/slower)")
    ap.add_argument("--fps", type=int, default=30, help="GIF playback frames per second")
    ap.add_argument("--seed", type=int, default=7, help="race seed (grid + incidents)")
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--max-steps", type=int, default=200000)
    args = ap.parse_args()

    svg = args.svg if os.path.isabs(args.svg) else os.path.join(
        SVG_DIR, os.path.basename(args.svg))
    pts, normals = load_track(svg)
    track = Track(pts, normals)
    vprof = track.vprof
    drivers = build_field(args.cars, args.laps, seed=args.seed)
    print(f"track: {os.path.basename(svg)} ({track.n} pts) | {args.cars} cars | "
          f"{args.laps} laps | speed {vprof.min():.0f}-{vprof.max():.0f} u/s "
          f"(corner/straight {vprof.min() / vprof.max():.2f})")

    if args.headless:
        sim_time = 0.0
        for step in range(args.max_steps):
            step_field(drivers, DT, sim_time, track)
            sim_time += DT
            if all(d.finished for d in drivers):
                break
        print(f"\nfinished after {sim_time:.1f}s sim time\n")
        print("FIN  DRIVER  grid  gained  line  tyre  ot  inc  result")
        order = standings(drivers)
        for p, d in enumerate(order, 1):
            gained = d.grid_pos - p
            arrow = f"+{gained}" if gained > 0 else (str(gained) if gained else " 0")
            result = "DNF" if d.dnf else (f"{d.finish_time:.1f}s" if d.finish_time else "-")
            print(f"{p:>3}  {d.name:<6}  P{d.grid_pos:<3}  {arrow:>6}  {d.line:.2f}  "
                  f"{d.compound:>3}  {d.overtakes:>2}  {d.incidents:>3}  {result:>9}")
        return

    # --- live / saved animation (renderer reused from the bicycle_race spike) ---
    import matplotlib
    if args.save:
        matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.animation import FuncAnimation
    from matplotlib.patches import Polygon
    from matplotlib.collections import LineCollection

    fig, ax = plt.subplots(figsize=(7, 7))
    left = pts + (TRACK_WIDTH / 2) * normals
    right = pts - (TRACK_WIDTH / 2) * normals
    ax.add_patch(Polygon(np.vstack([left, right[::-1]]), closed=True,
                         facecolor="#e9e9ea", edgecolor="none", zorder=0))
    ax.plot(left[:, 0], left[:, 1], "-", color="#222", lw=1.2, zorder=1)
    ax.plot(right[:, 0], right[:, 1], "-", color="#222", lw=1.2, zorder=1)
    ax.plot([left[0, 0], right[0, 0]], [left[0, 1], right[0, 1]], "k-", lw=2.5, zorder=2)
    # colour the centreline by the speed profile: green = fast, red = slow corners
    segs = np.stack([pts, np.roll(pts, -1, axis=0)], axis=1)
    lc = LineCollection(segs, cmap="RdYlGn", zorder=1, linewidths=2.5)
    lc.set_array((vprof - vprof.min()) / (vprof.max() - vprof.min() + 1e-9))
    ax.add_collection(lc)
    ax.set_aspect("equal")
    ax.axis("off")

    def corners(p, yaw, length=CAR_LENGTH, width=CAR_WIDTH):
        hl, hw = length / 2, width / 2
        box = [(-hl, -hw), (hl, -hw), (hl, hw), (-hl, hw)]
        ca, sa = np.cos(yaw), np.sin(yaw)
        return [(p[0] + bx * ca - by * sa, p[1] + bx * sa + by * ca) for bx, by in box]

    boxes, labels = [], []
    for d in drivers:
        poly = Polygon([(0, 0)] * 4, closed=True, facecolor=d.color,
                       edgecolor="black", lw=0.6, zorder=5)
        ax.add_patch(poly)
        boxes.append(poly)
        labels.append(ax.text(0, 0, d.name, fontsize=7, color=d.color, zorder=6))
    title = ax.set_title("")
    state = {"t": 0.0, "step": 0}
    steps_per_frame = max(1, int(round(args.spf / DT)))  # sim seconds per frame

    def update(_):
        for _ in range(steps_per_frame):
            step_field(drivers, DT, state["t"], track)
            state["t"] += DT
            state["step"] += 1
        for d, box, lab in zip(drivers, boxes, labels):
            p, yaw, nrm, _i = track.at(d.frac)
            p = p + d.offset * nrm
            box.set_xy(corners(p, yaw))
            box.set_alpha(0.35 if d.dnf else 1.0)          # retired car dimmed
            lab.set_position((p[0] + 14, p[1] + 14))
        order = standings(drivers)
        lead = order[0]
        rows = []
        for pos, d in enumerate(order, 1):
            gap = (lead.progress - d.progress) * BASE_LAP
            tag = "DNF" if d.dnf else ("" if pos == 1 else f"+{gap:.1f}")
            rows.append(f"{pos}.{d.name}{tag}")
        lap_now = min(args.laps, max(0, lead.lap) + 1)
        title.set_text(f"Lap {lap_now}/{args.laps}   " + "  ".join(rows[:6]))
        if all(d.finished for d in drivers) and not args.save:
            anim.event_source.stop()
        return boxes + labels + [title]

    def frames():
        f = 0
        while not all(d.finished for d in drivers) and state["step"] < args.max_steps:
            yield f
            f += 1
        yield f

    anim = FuncAnimation(fig, update, frames=frames, interval=1000 // args.fps,
                         blit=False, repeat=False, save_count=20000)
    if args.save:
        from matplotlib.animation import PillowWriter
        anim.save(args.save, writer=PillowWriter(fps=args.fps))
        _shrink_gif(args.save, args.fps)               # quantise palette -> smaller
        print(f"saved {args.save}")
    else:
        plt.show()


if __name__ == "__main__":
    main()
