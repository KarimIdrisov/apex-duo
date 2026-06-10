"""
track3d_geom_check.py — self-contained geometry check for the 3D track pipeline.

Mirrors the logic in:
  track_shapes.gd  -> loop_for() + _fit_and_close() + _generate()
  track_builder_3d.gd -> build()

Checks:
  1. Loop is closed (last point ~= first point) for both authored and procedural tracks.
  2. Baked curve length is positive and stable (consistent across two builds).
  3. Uniform sampling: the 100 evenly-spaced offsets produce finite, non-NaN points.
  4. No NaN anywhere in the output.

Prints PASS / FAIL for each assertion.
"""

import math
import struct

# ---- LCG RNG (mirrors RaceSim.RNG / mix32 in GDScript) ---------------------

def mix32(x: int) -> int:
    """Port of RaceSim.mix32 — avalanche hash for seeding the events RNG."""
    x = x & 0xFFFFFFFF
    x ^= (x >> 16) & 0xFFFFFFFF
    x = (x * 0x45d9f3b) & 0xFFFFFFFF
    x ^= (x >> 16) & 0xFFFFFFFF
    x = (x * 0x45d9f3b) & 0xFFFFFFFF
    x ^= (x >> 16) & 0xFFFFFFFF
    return x


class RNG:
    """LCG matching RaceSim.RNG (multiplier 1664525, increment 1013904223, mod 2^32)."""
    def __init__(self, seed: int):
        self.state = seed & 0xFFFFFFFF

    def next_u32(self) -> int:
        self.state = (self.state * 1664525 + 1013904223) & 0xFFFFFFFF
        return self.state

    def rangef(self, lo: float, hi: float) -> float:
        return lo + (self.next_u32() / 0xFFFFFFFF) * (hi - lo)


# ---- track_shapes.gd port ---------------------------------------------------

TRACK_SHAPES = {
    "Монца": [
        (0.42, 0.98), (0.42, 0.62), (0.36, 0.55), (0.40, 0.50),
        (0.34, 0.40), (0.40, 0.22), (0.52, 0.10), (0.60, 0.12),
        (0.62, 0.22), (0.56, 0.30), (0.66, 0.40), (0.80, 0.44),
        (0.86, 0.56), (0.80, 0.64), (0.86, 0.74), (0.82, 0.90),
        (0.70, 0.96), (0.55, 0.92),
    ],
    "Монако": [
        (0.18, 0.86), (0.16, 0.60), (0.24, 0.48), (0.20, 0.40),
        (0.30, 0.30), (0.30, 0.20), (0.42, 0.14), (0.52, 0.20),
        (0.50, 0.32), (0.62, 0.34), (0.72, 0.26), (0.82, 0.34),
        (0.78, 0.48), (0.86, 0.58), (0.80, 0.72), (0.64, 0.74),
        (0.58, 0.66), (0.46, 0.72), (0.40, 0.86), (0.28, 0.90),
    ],
    "Сильверстоун": [
        (0.30, 0.90), (0.20, 0.74), (0.26, 0.60), (0.16, 0.48),
        (0.24, 0.34), (0.40, 0.30), (0.46, 0.18), (0.58, 0.14),
        (0.66, 0.22), (0.60, 0.34), (0.74, 0.36), (0.86, 0.30),
        (0.90, 0.44), (0.78, 0.54), (0.84, 0.66), (0.72, 0.78),
        (0.56, 0.74), (0.48, 0.86), (0.40, 0.94),
    ],
}

TAU = 2 * math.pi


def _fit_and_close(src: list) -> list:
    """Normalise to 0..1, append first point to close."""
    if not src:
        return []
    xs = [p[0] for p in src]
    ys = [p[1] for p in src]
    minx, maxx = min(xs), max(xs)
    miny, maxy = min(ys), max(ys)
    w = max(maxx - minx, 1e-9)
    h = max(maxy - miny, 1e-9)
    out = [((p[0] - minx) / w, (p[1] - miny) / h) for p in src]
    out.append(out[0])   # close
    return out


def _generate(seed_value: int) -> list:
    """Procedural harmonic loop (mirrors track_shapes.gd._generate)."""
    r = RNG(mix32(seed_value))
    harm = []
    for _ in range(3):
        freq = 2 + int(r.next_u32() % 4)
        amp  = r.rangef(0.06, 0.18)
        phase = r.rangef(0.0, TAU)
        harm.append((freq, amp, phase))
    n = 200
    raw = []
    for i in range(n):
        th = TAU * i / n
        rad = 1.0
        for (freq, amp, phase) in harm:
            rad += amp * math.sin(freq * th + phase)
        raw.append((math.cos(th) * rad, math.sin(th) * rad))
    return raw


def loop_for(track_name: str, seed_value: int) -> list:
    if track_name in TRACK_SHAPES:
        src = TRACK_SHAPES[track_name]
    else:
        src = _generate(seed_value)
    return _fit_and_close(src)


# ---- track_builder_3d.gd port -----------------------------------------------

TRACK_SCALE = 800.0
ROAD_W = 12.0


def build(loop: list, scale: float = TRACK_SCALE, width: float = ROAD_W) -> dict:
    """
    Mirror of TrackBuilder3D.build().
    Returns {'points_3d': [...], 'baked_length': float, 'closed': bool}.
    We can't run Curve3D here so we compute a piecewise-linear approximation of
    the baked length (same as what Godot's Curve3D does internally for a linear
    curve, i.e., no Bezier control handles set — points added with add_point
    using only the position get zero-length in/out handles so the curve IS
    piecewise-linear).
    """
    pts3 = []
    for p in loop:
        x = (p[0] - 0.5) * scale
        z = (p[1] - 0.5) * scale
        pts3.append((x, 0.0, z))

    # Close if not already closed.
    if len(pts3) > 1:
        p0 = pts3[0]
        pn = pts3[-1]
        dist = math.sqrt((p0[0]-pn[0])**2 + (p0[2]-pn[2])**2)
        if dist > 0.01:
            pts3.append(p0)

    # Piecewise-linear baked length.
    total = 0.0
    for i in range(len(pts3) - 1):
        a = pts3[i]
        b = pts3[i + 1]
        seg = math.sqrt((b[0]-a[0])**2 + (b[1]-a[1])**2 + (b[2]-a[2])**2)
        total += seg

    closed = len(pts3) > 1 and math.sqrt(
        (pts3[0][0]-pts3[-1][0])**2 + (pts3[0][2]-pts3[-1][2])**2) < 0.01

    return {"points_3d": pts3, "baked_length": total, "closed": closed}


def _sample_linear(pts3: list, total_len: float, offset: float):
    """Sample a piecewise-linear curve at arc-length offset."""
    acc = 0.0
    for i in range(len(pts3) - 1):
        a = pts3[i]
        b = pts3[i + 1]
        seg = math.sqrt((b[0]-a[0])**2 + (b[1]-a[1])**2 + (b[2]-a[2])**2)
        if acc + seg >= offset or i == len(pts3) - 2:
            t = (offset - acc) / seg if seg > 1e-9 else 0.0
            t = max(0.0, min(1.0, t))
            return (
                a[0] + (b[0]-a[0]) * t,
                a[1] + (b[1]-a[1]) * t,
                a[2] + (b[2]-a[2]) * t,
            )
        acc += seg
    return pts3[-1]


# ---- tests ------------------------------------------------------------------

PASS = 0
FAIL = 0

def check(label: str, cond: bool, detail: str = "") -> None:
    global PASS, FAIL
    if cond:
        print(f"  PASS  {label}" + (f"  ({detail})" if detail else ""))
        PASS += 1
    else:
        print(f"  FAIL  {label}" + (f"  ({detail})" if detail else ""))
        FAIL += 1


def run_track(name: str, seed: int):
    print(f"\n--- Track: {name!r} (seed={seed}) ---")
    loop = loop_for(name, seed)

    # 1. Loop is closed.
    first = loop[0]
    last  = loop[-1]
    dist_close = math.sqrt((first[0]-last[0])**2 + (first[1]-last[1])**2)
    check("loop closed (2D)", dist_close < 1e-9, f"dist={dist_close:.2e}")

    # 2. All 2D points are in [0,1].
    in_range = all(0.0 <= p[0] <= 1.0 and 0.0 <= p[1] <= 1.0 for p in loop)
    check("all 2D points in [0,1]", in_range)

    # 3. No NaN in 2D loop.
    no_nan_2d = all(not (math.isnan(p[0]) or math.isnan(p[1])) for p in loop)
    check("no NaN in 2D loop", no_nan_2d)

    # 4. Build 3D curve.
    result = build(loop)
    pts3  = result["points_3d"]
    length = result["baked_length"]
    closed = result["closed"]

    check("curve closed (3D)",   closed)
    check("baked length > 0",    length > 0.0, f"length={length:.1f} m")
    check("baked length < 5000", length < 5000.0, f"length={length:.1f} m")

    # 5. Stability: build twice → same length.
    result2 = build(loop_for(name, seed))
    check("length stable (2 builds)", abs(result2["baked_length"] - length) < 1e-6,
          f"|d|={abs(result2['baked_length'] - length):.2e}")

    # 6. Uniform sampling: 100 evenly-spaced fracs → finite non-NaN 3D points.
    n_samples = 100
    bad = 0
    for i in range(n_samples):
        frac = i / n_samples
        offset = frac * length
        p = _sample_linear(pts3, length, offset)
        if any(math.isnan(v) or math.isinf(v) for v in p):
            bad += 1
    check("100 uniform samples finite", bad == 0, f"{bad} bad samples")

    # 7. Sampling is roughly even: consecutive sample gap should be ~length/n_samples.
    expected_step = length / n_samples
    max_ratio = 0.0
    prev = _sample_linear(pts3, length, 0.0)
    for i in range(1, n_samples):
        frac = i / n_samples
        cur = _sample_linear(pts3, length, frac * length)
        d = math.sqrt(sum((cur[k]-prev[k])**2 for k in range(3)))
        ratio = d / expected_step if expected_step > 0 else 0.0
        max_ratio = max(max_ratio, ratio)
        prev = cur
    # For a piecewise-linear curve, consecutive sample gaps can vary; allow 3x.
    check("sampling roughly even (max step < 3x expected)", max_ratio < 3.0,
          f"max_ratio={max_ratio:.2f}")


def main():
    print("=" * 60)
    print("track3d_geom_check.py — 3D pipeline geometry verification")
    print("=" * 60)

    # Authored tracks.
    for name in ["Монца", "Монако", "Сильверстоун"]:
        run_track(name, 0)

    # Procedural tracks (two different seeds).
    for seed in [12345, 99999]:
        run_track("Баку", seed)

    print(f"\n{'='*60}")
    total = PASS + FAIL
    print(f"Result: {PASS}/{total} checks PASSED, {FAIL} FAILED")
    print("=" * 60)
    if FAIL == 0:
        print("OVERALL: PASS")
    else:
        print("OVERALL: FAIL")


if __name__ == "__main__":
    main()
