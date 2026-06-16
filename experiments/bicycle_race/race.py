#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
THROWAWAY EXPERIMENT — NOT part of the game.

A minimal "F1 race" built on the PathTrackingBicycle engine
(https://github.com/DongChen06/PathTrackingBicycle): a kinematic bicycle model
+ Stanley (lateral) + PID (longitudinal), each car tracking the same racing line
(racetrack_waypoints.txt, which carries a per-point target speed — slower in
corners). N cars with different "skill" (speed multiplier) sprint from a
staggered grid to the finish; we watch them via a matplotlib animation.

This is purely to feel how a positional/trajectory engine behaves — it is the
opposite of the game's abstract lap-time sim, kept entirely separate on purpose.

Run:
  python experiments/bicycle_race/race.py                 # live animation
  python experiments/bicycle_race/race.py --cars 8        # more cars
  python experiments/bicycle_race/race.py --save out.gif  # save a GIF instead
  python experiments/bicycle_race/race.py --headless      # no render, print result
"""

import argparse
import os

import numpy as np

# --- bicycle model constants (from DongChen06/PathTrackingBicycle) ------------
DT = 0.1
L = 2.9                       # wheelbase [m]
MAX_STEER = np.radians(42.0)  # [rad] (toy: allow tighter turns for sharp chicanes)
WINDOW = 10                   # waypoints of lookahead (short => tracks corners tightly)
HERE = os.path.dirname(os.path.abspath(__file__))

# --- car size + track width + overtaking + collision tuning (track units) -----
# Car drawn AND collided as 20x9 units (exaggerated for visibility on a ~2400-unit
# track; real 5x2 m would be an invisible dot). Physics and render use one size.
CAR_LENGTH = 20.0
CAR_WIDTH = 9.0
TRACK_WIDTH = 72.0                       # full track width (sized to contain the controller's
MAX_PERP = TRACK_WIDTH / 2 - CAR_WIDTH / 2  # racing line + corner overshoot, so limits rarely fire)
LAT_CONFLICT = 11.0  # centres within this laterally => same "lane" (would touch)
MIN_SEP = 24.0       # min centre-to-centre gap kept nose-to-tail (no overlap)
SAFE_GAP = 60.0      # start car-following (ease speed to the car ahead)
FOLLOW_DIST = 75.0   # react to a car ahead at all
ATTACK_DIST = 48.0   # commit to a pass (pull off the line)
OFFSET = min(20.0, MAX_PERP)  # overtaking line offset (kept inside the track edge)
OFFSET_RATE = 1.2    # [units/tick] how fast the car slides sideways


def normalize_angle(a):
    while a > np.pi:
        a -= 2.0 * np.pi
    while a < -np.pi:
        a += 2.0 * np.pi
    return a


class KinematicBicycle:
    """Rear-axle kinematic bicycle. update(throttle, delta)."""
    def __init__(self, x, y, yaw, v=0.0):
        self.x, self.y, self.yaw, self.v = x, y, yaw, v

    def update(self, throttle, delta):
        delta = float(np.clip(delta, -MAX_STEER, MAX_STEER))
        self.x += self.v * np.cos(self.yaw) * DT
        self.y += self.v * np.sin(self.yaw) * DT
        self.yaw = normalize_angle(self.yaw + self.v / L * np.tan(delta) * DT)
        self.v += throttle * DT
        if self.v < 0:
            self.v = 0.0


class Controller:
    """Stanley steering + PID speed, adapted from controller2d.py. Fed a forward
    window of waypoints each tick; returns (throttle [-1,1], steer [rad])."""
    K_P, K_I, K_D = 1.0, 0.3, 0.001
    K_E, K_V = 0.55, 14.0         # Stanley gains (firmer crosstrack correction)

    def __init__(self):
        self.e_hist = []

    def control(self, x, y, yaw, v, window, v_desired):
        # ---- longitudinal: PID on speed error ----
        e = v_desired - v
        self.e_hist.append(e)
        if len(self.e_hist) > 20:
            self.e_hist.pop(0)
        de = (self.e_hist[-1] - self.e_hist[-2]) / DT if len(self.e_hist) >= 2 else 0.0
        ie = sum(self.e_hist) * DT
        throttle = np.clip(self.K_P * e + self.K_D * de / DT + self.K_I * ie * DT, -1.0, 1.0)

        # ---- lateral: Stanley ----
        wp = np.asarray(window)[:, :2]
        yaw_path = np.arctan2(wp[-1, 1] - wp[0, 1], wp[-1, 0] - wp[0, 0])
        yaw_diff = normalize_angle(yaw_path - yaw)
        # crosstrack error = nearest distance to the path window, signed
        d2 = np.sum((np.array([x, y]) - wp) ** 2, axis=1)
        cte = np.sqrt(d2.min())
        yaw_ct = np.arctan2(y - wp[0, 1], x - wp[0, 0])
        cte = cte if normalize_angle(yaw_path - yaw_ct) > 0 else -cte
        steer = yaw_diff + np.arctan(self.K_E * cte / (self.K_V + v))
        return float(throttle), float(np.clip(normalize_angle(steer), -MAX_STEER, MAX_STEER))


# --- driver = car + controller + race state -----------------------------------
PALETTE = ["#ff8000", "#27f4d2", "#3671c6", "#e8002d", "#64c4ff",
           "#229971", "#b6babd", "#52e252", "#6692ff", "#c9a227"]
NAMES = ["VER", "NOR", "LEC", "RUS", "PIA", "HAM", "ALO", "SAI", "PER", "GAS"]


class Driver:
    def __init__(self, i, wps, start_idx, skill, speed_scale):
        x, y = wps[start_idx, 0], wps[start_idx, 1]
        nxt = wps[min(start_idx + 1, len(wps) - 1), :2]
        yaw = np.arctan2(nxt[1] - y, nxt[0] - x)
        self.car = KinematicBicycle(x, y, yaw, v=2.0)
        self.ctrl = Controller()
        self.skill = skill
        self.speed_scale = speed_scale
        self.idx = start_idx        # progress along the path
        self.name = NAMES[i % len(NAMES)]
        self.color = PALETTE[i % len(PALETTE)]
        self.finished = False
        self.finish_step = None
        self.offset = 0.0           # current lateral offset from the racing line
        self.target_offset = 0.0    # where the overtake logic wants the car
        self.overtakes = 0
        self.lap = 0
        self.progress = float(start_idx)  # global progress = lap*n + idx (for ordering)
        self.closed = False         # set by build_field for SVG loops
        self.target_laps = 1
        self.n = 1

    def step(self, wps, n, step_no, ahead, gap):
        if self.finished:
            return
        c = self.car
        # nearest waypoint ahead, searched over a forward band (cyclic if closed)
        idxs = (self.idx + np.arange(WINDOW)) % n if self.closed else \
            np.arange(self.idx, min(self.idx + WINDOW, n))
        band = wps[idxs, :2]
        new_idx = int(idxs[int(np.sum((np.array([c.x, c.y]) - band) ** 2, axis=1).argmin())])
        if self.closed:
            if new_idx < self.idx and self.idx - new_idx > n // 2:   # wrapped past start/finish
                self.lap += 1
            self.idx = new_idx
            self.progress = self.lap * n + self.idx
            if self.lap >= self.target_laps:
                self.finished = True
                self.finish_step = step_no
                return
        else:
            self.idx = new_idx
            self.progress = float(self.idx)
            if self.idx >= n - 2:
                self.finished = True
                self.finish_step = step_no
                return
        window = wps[idxs].copy()
        v_des = window[0, 2] * self.skill * self.speed_scale

        # lateral conflict = car ahead shares our "lane" (centres close laterally)
        same_lane = ahead is not None and abs(self.offset - ahead.offset) < LAT_CONFLICT

        # --- overtaking decision: to get past, you MUST clear the lane (offset) ---
        if same_lane and gap < ATTACK_DIST and c.v >= ahead.car.v - 0.5:
            side = -1.0 if ahead.offset > 1.0 else 1.0  # pass on the OPPOSITE side to the
            self.target_offset = side * OFFSET          # car ahead (else both pile one lane -> deadlock)
        elif ahead is None or gap > FOLLOW_DIST:
            self.target_offset = 0.0             # clear ahead: return to the racing line

        # --- car-following: never close past MIN_SEP while in the same lane ---
        if same_lane and gap < SAFE_GAP:
            v_follow = ahead.car.v + 0.3 * (gap - MIN_SEP)   # match speed at MIN_SEP
            v_des = min(v_des, max(0.0, v_follow))

        # ease the lateral offset toward its target, kept inside the track edge
        self.target_offset = float(np.clip(self.target_offset, -MAX_PERP, MAX_PERP))
        self.offset += float(np.clip(self.target_offset - self.offset, -OFFSET_RATE, OFFSET_RATE))

        # shift the tracked line sideways by `offset` along the precomputed normals
        # (Stanley then follows that parallel line inside the track)
        if abs(self.offset) > 1e-3:
            window = window.copy()
            window[:, :2] = window[:, :2] + self.offset * window[:, 3:5]

        throttle, steer = self.ctrl.control(c.x, c.y, c.yaw, c.v, window, v_des)
        c.update(throttle, steer)

        # --- track limits: nudge the car body back inside the edges if it ran
        # wide (don't touch self.offset — that's the INTENDED line; letting it
        # snap to the edge would make the car track the wall forever) ---
        ctr = wps[self.idx, :2]
        nrm = wps[self.idx, 3:5]
        perp = (c.x - ctr[0]) * nrm[0] + (c.y - ctr[1]) * nrm[1]
        if abs(perp) > MAX_PERP:
            corr = float(np.clip(perp, -MAX_PERP, MAX_PERP)) - perp
            c.x += corr * nrm[0]
            c.y += corr * nrm[1]


def car_corners(x, y, yaw, length=CAR_LENGTH, width=CAR_WIDTH):
    """4 corners of an oriented car box centred at (x,y), nose along yaw."""
    hl, hw = length / 2, width / 2
    pts = [(-hl, -hw), (hl, -hw), (hl, hw), (-hl, hw)]
    ca, sa = np.cos(yaw), np.sin(yaw)
    return [(x + px * ca - py * sa, y + px * sa + py * ca) for px, py in pts]


def _with_normals(a, closed):
    """a = Nx3 [x,y,v]; append per-point unit LEFT-normal (nx,ny) -> Nx5. Normals
    define the track's lateral axis (edges, lane offsets, track-limit clamp)."""
    x, y = a[:, 0], a[:, 1]
    if closed:
        tx, ty = np.roll(x, -1) - np.roll(x, 1), np.roll(y, -1) - np.roll(y, 1)
    else:
        tx, ty = np.gradient(x), np.gradient(y)
    nrm = np.hypot(tx, ty)
    nrm[nrm == 0] = 1.0
    tx, ty = tx / nrm, ty / nrm
    return np.column_stack([x, y, a[:, 2], -ty, tx])   # left normal = (-ty, tx)


def load_waypoints():
    a = np.loadtxt(os.path.join(HERE, "racetrack_waypoints.txt"), delimiter=",")
    return _with_normals(a, closed=False)


def _smooth_cyclic(a, k=7):
    pad = np.concatenate([a[-k:], a, a[:k]])
    sm = np.convolve(pad, np.ones(k) / k, mode="same")
    return sm[k:-k]


def load_svg_track(svg_path, n_points=460, target_len=2400.0, vmin=3.0, vmax=22.0):
    """Real circuit from an SVG outline (f1-circuits-svg, CC BY 4.0) -> a CLOSED
    waypoint loop with a per-point target speed derived from curvature (slower in
    corners, with a braking ramp into them). Reuses the game's SVG path parser."""
    import importlib.util
    tool = os.path.join(HERE, "..", "..", "tools", "svg_to_trackshapes.py")
    spec = importlib.util.spec_from_file_location("svgtool", tool)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    poly, _ = mod.flatten(mod.get_d(svg_path))
    pts = np.array(mod.resample_closed(poly, n_points), float)  # even-spaced closed loop
    pts[:, 1] = -pts[:, 1]                                      # SVG y is down -> flip up
    # scale to a sensible size (so the 20-unit car stays ~1% of the track)
    seg = np.hypot(np.diff(pts[:, 0], append=pts[:1, 0]),
                   np.diff(pts[:, 1], append=pts[:1, 1]))
    pts *= target_len / seg.sum()
    ds = target_len / n_points

    x, y = pts[:, 0], pts[:, 1]
    dx, dy = np.gradient(x), np.gradient(y)
    ddx, ddy = np.gradient(dx), np.gradient(dy)
    kappa = _smooth_cyclic(np.abs(dx * ddy - dy * ddx) / ((dx * dx + dy * dy) ** 1.5 + 1e-9), 7)
    kref = np.percentile(kappa, 85) or 1.0
    v = vmax - (vmax - vmin) * np.clip(kappa / kref, 0, 1)     # corner-speed profile
    # backward braking pass (cyclic): brake EARLY for corners (gentle ramp = long
    # braking zone, so cars arrive at the apex already slow instead of overshooting)
    for _ in range(6):
        for i in range(n_points - 1, -1, -1):
            v[i] = min(v[i], v[(i + 1) % n_points] + 0.09 * ds)
    return _with_normals(np.column_stack([x, y, v]), closed=True)


def build_field(wps, n_cars, speed_scale, seed=7, closed=False, laps=1):
    n = len(wps)
    rng = np.random.default_rng(seed)
    drivers = []
    for i in range(n_cars):
        start_idx = (i * 26) % n                # staggered grid (>MIN_SEP apart, no start overlap)
        skill = 1.0 + (n_cars / 2 - i) * 0.045  # fast cars start at the BACK -> must overtake
        skill += rng.normal(0, 0.006)
        d = Driver(i, wps, start_idx, skill, speed_scale)
        d.closed, d.target_laps, d.n = closed, laps, n
        drivers.append(d)
    # grid position: further along the start spread = better grid slot (P1 = front)
    for p, d in enumerate(sorted(drivers, key=lambda d: d.progress, reverse=True), 1):
        d.grid_pos = p
    return drivers


def resolve_field(drivers, wps, n, step_no):
    """Find each car's nearest car ahead (higher progress) + gap, step everyone,
    and tally on-track passes (a pair whose progress order flipped this tick)."""
    active = [d for d in drivers if not d.finished]
    info = {}
    for d in active:
        ahead, best = None, 1e9
        for o in active:
            if o is d or o.progress < d.progress:
                continue
            g = float(np.hypot(o.car.x - d.car.x, o.car.y - d.car.y))
            if g < best:
                best, ahead = g, o
        info[d] = (ahead, best if ahead else 1e9)

    for d in active:
        ahead, gap = info[d]
        d.step(wps, n, step_no, ahead, gap)

    # hard no-overlap safety net: if two same-lane cars interpenetrate, separate
    # them along the line of centres (exact) and cap the rear car's speed.
    for _ in range(2):  # a couple of passes resolve short trains
        for i in range(len(active)):
            for j in range(i + 1, len(active)):
                a, b = active[i], active[j]
                dx, dy = a.car.x - b.car.x, a.car.y - b.car.y
                dist = float(np.hypot(dx, dy)) or 1e-6
                if dist < CAR_LENGTH and abs(a.offset - b.offset) < CAR_WIDTH:
                    rear = a if a.progress < b.progress else b
                    front = b if rear is a else a
                    overlap = CAR_LENGTH - dist
                    ux, uy = (rear.car.x - front.car.x) / dist, (rear.car.y - front.car.y) / dist
                    rear.car.x += ux * overlap          # push rear directly away from front
                    rear.car.y += uy * overlap
                    rear.car.v = min(rear.car.v, front.car.v)


def standings(drivers):
    return sorted(drivers, key=lambda d: (d.finished and -d.finish_step or 0, d.progress), reverse=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cars", type=int, default=6)
    ap.add_argument("--speed-scale", type=float, default=1.0, help="global speed multiplier")
    ap.add_argument("--svg", default=None, help="circuit SVG (closed loop, runs laps); e.g. svg/monza-7.svg")
    ap.add_argument("--laps", type=int, default=2, help="laps when using --svg")
    ap.add_argument("--save", default=None, help="save animation to this GIF path")
    ap.add_argument("--headless", action="store_true", help="no render, just simulate + print")
    ap.add_argument("--max-steps", type=int, default=12000)
    args = ap.parse_args()

    closed = bool(args.svg)
    if closed:
        svg = args.svg if os.path.isabs(args.svg) else os.path.join(HERE, args.svg)
        wps = load_svg_track(svg)
        print(f"loaded SVG circuit: {os.path.basename(svg)} ({len(wps)} pts, closed, {args.laps} laps)")
    else:
        wps = load_waypoints()
    n = len(wps)
    drivers = build_field(wps, args.cars, args.speed_scale, closed=closed, laps=args.laps)

    if args.headless:
        min_sep = 1e9
        for step_no in range(args.max_steps):
            resolve_field(drivers, wps, n, step_no)
            act = [d for d in drivers if not d.finished]
            for a in range(len(act)):
                for b in range(a + 1, len(act)):
                    # only same-lane pairs can truly overlap (side-by-side passes don't)
                    if abs(act[a].offset - act[b].offset) < CAR_WIDTH:
                        min_sep = min(min_sep, float(np.hypot(
                            act[a].car.x - act[b].car.x, act[a].car.y - act[b].car.y)))
            if all(d.finished for d in drivers):
                break
        order = standings(drivers)
        total_gained = 0
        print(f"Finished after {step_no} steps ({step_no * DT:.1f}s sim time)\n")
        print("FIN  DRIVER  grid  gained  skill   finish_step")
        for p, d in enumerate(order, 1):
            gained = d.grid_pos - p
            total_gained += max(0, gained)
            arrow = f"+{gained}" if gained > 0 else (str(gained) if gained < 0 else " 0")
            fin = d.finish_step if d.finished else "-"
            print(f"{p:>3}  {d.name:<6}  P{d.grid_pos:<3}  {arrow:>6}  {d.skill:.3f}  {str(fin):>11}")
        print(f"\non-track position changes (net places gained): {total_gained}")
        print(f"min car-to-car distance during race: {min_sep:.1f} units "
              f"(car length {CAR_LENGTH:.0f} => {'NO overlap' if min_sep >= CAR_LENGTH * 0.9 else 'OVERLAP!'})")
        return

    # --- live / saved animation ---
    import matplotlib
    if args.save:
        matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.animation import FuncAnimation
    from matplotlib.patches import Polygon

    fig, ax = plt.subplots(figsize=(9, 9))
    ctr, nor = wps[:, :2], wps[:, 3:5]
    left = ctr + (TRACK_WIDTH / 2) * nor
    right = ctr - (TRACK_WIDTH / 2) * nor
    band = np.vstack([left, right[::-1]])
    ax.add_patch(Polygon(band, closed=True, facecolor="#e9e9ea", edgecolor="none", zorder=0))
    ax.plot(left[:, 0], left[:, 1], "-", color="#222", lw=1.2, zorder=1)
    ax.plot(right[:, 0], right[:, 1], "-", color="#222", lw=1.2, zorder=1)
    ax.plot(ctr[:, 0], ctr[:, 1], "--", color="#bbb", lw=0.6, zorder=1)
    sf = 0 if closed else -1                      # start/finish line across the track
    ax.plot([left[sf, 0], right[sf, 0]], [left[sf, 1], right[sf, 1]], "k-", lw=2.5, zorder=2)
    ax.set_aspect("equal"); ax.axis("off")
    boxes = []
    for d in drivers:
        poly = Polygon(car_corners(d.car.x, d.car.y, d.car.yaw), closed=True,
                       facecolor=d.color, edgecolor="black", lw=0.6, zorder=5)
        ax.add_patch(poly)
        boxes.append(poly)
    labels = [ax.text(0, 0, d.name, fontsize=7, color=d.color, zorder=6) for d in drivers]
    title = ax.set_title("")

    STEPS_PER_FRAME = 4
    state = {"step": 0}

    def update(_):
        for _ in range(STEPS_PER_FRAME):
            resolve_field(drivers, wps, n, state["step"])
            state["step"] += 1
        for d, box, lab in zip(drivers, boxes, labels):
            box.set_xy(car_corners(d.car.x, d.car.y, d.car.yaw))
            lab.set_position((d.car.x + 14, d.car.y + 14))
        order = standings(drivers)
        title.set_text("  ".join(f"{p}.{d.name}" for p, d in enumerate(order, 1))
                       + f"    t={state['step'] * DT:.0f}s")
        if (all(d.finished for d in drivers) or state["step"] > args.max_steps) and not args.save:
            anim.event_source.stop()
        return boxes + labels + [title]

    def frame_gen():
        f = 0
        while not all(d.finished for d in drivers) and state["step"] <= args.max_steps:
            yield f
            f += 1
        yield f  # one final frame on the finish

    anim = FuncAnimation(fig, update, frames=frame_gen, save_count=args.max_steps // STEPS_PER_FRAME,
                         interval=30, blit=False, repeat=False)
    if args.save:
        from matplotlib.animation import PillowWriter
        anim.save(args.save, writer=PillowWriter(fps=30))
        print(f"Saved {args.save}")
    else:
        plt.show()


if __name__ == "__main__":
    main()
