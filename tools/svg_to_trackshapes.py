#!/usr/bin/env python3
"""Generate ApexDuo_Prototype/track_shapes.gd from real F1 circuit SVGs.

Source data: f1-circuits-svg by ROY Jules, licensed CC BY 4.0
    https://github.com/julesr0y/f1-circuits-svg

This is the provenance / regeneration tool for the circuit outlines used by the
2D minimap (track_map.gd) and the 3D race view (race_view_3d.gd).

To regenerate:
    git clone --depth 1 https://github.com/julesr0y/f1-circuits-svg _f1svg
    cp -r _f1svg/circuits ./_f1svg_circuits        # or point BASE at _f1svg/circuits
    python tools/svg_to_trackshapes.py

Each chosen circuit's *latest* layout (highest-numbered "minimal/black" centre-line
SVG) is parsed (M/L/H/V/C/S/Q/A path commands flattened to a polyline), evenly
resampled by arc length to N points, then uniformly normalized to 0..1 (real aspect
ratio preserved, centred). Output points are unclosed; TrackShapes.loop_for() and
TrackMap._fit_points() append the closing point.
"""
import re, math

BASE   = "_f1svg_circuits/minimal/black"
TARGET = "ApexDuo_Prototype/track_shapes.gd"
N      = 120     # resampled points per track (even arc-length)
BEZ    = 18      # flatten steps per bezier / arc segment

# Russian track name (as used by RaceSim.REAL_TRACKS) -> SVG file (latest layout).
CHOICES = [
    # Existing 10 (calendar core)
    ("Монца",        "monza-7"),
    ("Монако",       "monaco-6"),
    ("Спа",          "spa-francorchamps-4"),
    ("Сильверстоун", "silverstone-8"),
    ("Сингапур",     "marina-bay-4"),
    ("Бахрейн",      "bahrain-3"),
    ("Хунгароринг",  "hungaroring-3"),
    ("Сузука",       "suzuka-2"),
    ("Баку",         "baku-1"),
    ("Зандворт",     "zandvoort-5"),
    # Rest of the modern (2026-era) calendar
    ("Джидда",       "jeddah-1"),
    ("Мельбурн",     "melbourne-2"),
    ("Шанхай",       "shanghai-1"),
    ("Майами",       "miami-1"),
    ("Имола",        "imola-3"),
    ("Монреаль",     "montreal-6"),
    ("Барселона",    "catalunya-6"),
    ("Шпильберг",    "spielberg-3"),
    ("Остин",        "austin-1"),
    ("Мехико",       "mexico-city-3"),
    ("Интерлагос",   "interlagos-2"),
    ("Лас-Вегас",    "las-vegas-1"),
    ("Лусаил",       "lusail-1"),
    ("Яс-Марина",    "yas-marina-2"),
    ("Мадрид",       "madring-1"),
]

NUM = re.compile(r'[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?')
CMD = re.compile(r'([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)')


def get_d(path):
    txt = open(path, encoding="utf-8").read()
    m = re.search(r'<path[^>]*\bd="([^"]+)"', txt, re.S)
    if not m:
        raise RuntimeError("no path d in " + path)
    return m.group(1)


def cubic(p0, p1, p2, p3, steps):
    out = []
    for s in range(1, steps + 1):
        t = s / steps; mt = 1 - t
        x = mt*mt*mt*p0[0] + 3*mt*mt*t*p1[0] + 3*mt*t*t*p2[0] + t*t*t*p3[0]
        y = mt*mt*mt*p0[1] + 3*mt*mt*t*p1[1] + 3*mt*t*t*p2[1] + t*t*t*p3[1]
        out.append((x, y))
    return out


def quad(p0, p1, p2, steps):
    out = []
    for s in range(1, steps + 1):
        t = s / steps; mt = 1 - t
        x = mt*mt*p0[0] + 2*mt*t*p1[0] + t*t*p2[0]
        y = mt*mt*p0[1] + 2*mt*t*p1[1] + t*t*p2[1]
        out.append((x, y))
    return out


def arc(x0, y0, rx, ry, phi_deg, large, sweep, x, y, steps):
    # SVG endpoint -> centre arc (spec F.6), flattened to a polyline.
    if rx == 0 or ry == 0 or (x0 == x and y0 == y):
        return [(x, y)]
    phi = math.radians(phi_deg); rx = abs(rx); ry = abs(ry)
    dx2 = (x0 - x) / 2.0; dy2 = (y0 - y) / 2.0
    x1p =  math.cos(phi)*dx2 + math.sin(phi)*dy2
    y1p = -math.sin(phi)*dx2 + math.cos(phi)*dy2
    lam = x1p*x1p/(rx*rx) + y1p*y1p/(ry*ry)
    if lam > 1:
        s = math.sqrt(lam); rx *= s; ry *= s
    sign = -1 if large == sweep else 1
    den = rx*rx*y1p*y1p + ry*ry*x1p*x1p
    num = rx*rx*ry*ry - rx*rx*y1p*y1p - ry*ry*x1p*x1p
    co = sign * math.sqrt(max(0.0, num/den)) if den > 0 else 0.0
    cxp = co * (rx*y1p/ry); cyp = co * (-ry*x1p/rx)
    cxc = math.cos(phi)*cxp - math.sin(phi)*cyp + (x0+x)/2
    cyc = math.sin(phi)*cxp + math.cos(phi)*cyp + (y0+y)/2

    def ang(ux, uy, vx, vy):
        d = math.hypot(ux, uy) * math.hypot(vx, vy)
        c = max(-1.0, min(1.0, (ux*vx + uy*vy) / d)) if d > 0 else 1.0
        a = math.acos(c)
        return -a if (ux*vy - uy*vx) < 0 else a

    ux = (x1p - cxp)/rx; uy = (y1p - cyp)/ry
    vx = (-x1p - cxp)/rx; vy = (-y1p - cyp)/ry
    theta1 = ang(1, 0, ux, uy); dtheta = ang(ux, uy, vx, vy)
    if not sweep and dtheta > 0: dtheta -= 2*math.pi
    if sweep and dtheta < 0: dtheta += 2*math.pi
    out = []
    for s in range(1, steps + 1):
        t = theta1 + dtheta * s / steps
        ex = math.cos(phi)*rx*math.cos(t) - math.sin(phi)*ry*math.sin(t) + cxc
        ey = math.sin(phi)*rx*math.cos(t) + math.cos(phi)*ry*math.sin(t) + cyc
        out.append((ex, ey))
    return out


def flatten(d):
    subpaths = []; cur = []
    cx = cy = sx = sy = 0.0
    prev = None; pc = None  # previous command letter, previous control point
    for cmd, args in CMD.findall(d):
        n = [float(x) for x in NUM.findall(args)]
        i = 0
        if cmd in "Mm":
            if cur: subpaths.append(cur); cur = []
            first = True
            while i + 1 < len(n) + 1 and i < len(n):
                x, y = n[i], n[i+1]; i += 2
                if cmd == "m": x += cx; y += cy
                cx, cy = x, y
                if first: sx, sy = cx, cy; first = False
                cur.append((cx, cy))
            pc = None
        elif cmd in "Ll":
            while i + 1 < len(n):
                x, y = n[i], n[i+1]; i += 2
                if cmd == "l": x += cx; y += cy
                cx, cy = x, y; cur.append((cx, cy))
            pc = None
        elif cmd in "Hh":
            for v in n:
                cx = v + (cx if cmd == "h" else 0); cur.append((cx, cy))
            pc = None
        elif cmd in "Vv":
            for v in n:
                cy = v + (cy if cmd == "v" else 0); cur.append((cx, cy))
            pc = None
        elif cmd in "Cc":
            while i + 5 < len(n):
                x1, y1, x2, y2, x, y = n[i:i+6]; i += 6
                if cmd == "c":
                    x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy
                cur += cubic((cx, cy), (x1, y1), (x2, y2), (x, y), BEZ)
                pc = (x2, y2); cx, cy = x, y
        elif cmd in "Ss":
            while i + 3 < len(n):
                x2, y2, x, y = n[i:i+4]; i += 4
                if cmd == "s":
                    x2 += cx; y2 += cy; x += cx; y += cy
                if pc and prev in "CcSs":
                    x1 = 2*cx - pc[0]; y1 = 2*cy - pc[1]
                else:
                    x1, y1 = cx, cy
                cur += cubic((cx, cy), (x1, y1), (x2, y2), (x, y), BEZ)
                pc = (x2, y2); cx, cy = x, y
        elif cmd in "Qq":
            while i + 3 < len(n):
                x1, y1, x, y = n[i:i+4]; i += 4
                if cmd == "q":
                    x1 += cx; y1 += cy; x += cx; y += cy
                cur += quad((cx, cy), (x1, y1), (x, y), BEZ)
                pc = (x1, y1); cx, cy = x, y
        elif cmd in "Aa":
            while i + 6 < len(n):
                rx, ry, rot, large, sweep, x, y = n[i:i+7]; i += 7
                if cmd == "a": x += cx; y += cy
                cur += arc(cx, cy, rx, ry, rot, int(large), int(sweep), x, y, max(8, BEZ))
                cx, cy = x, y
            pc = None
        elif cmd in "Zz":
            cx, cy = sx, sy; pc = None
        else:
            raise RuntimeError("unhandled command: " + cmd)
        prev = cmd
    if cur: subpaths.append(cur)

    def perim(p):
        return sum(math.hypot(p[(k+1) % len(p)][0]-p[k][0],
                              p[(k+1) % len(p)][1]-p[k][1]) for k in range(len(p)))
    subpaths.sort(key=perim, reverse=True)   # main circuit = longest subpath
    return subpaths[0], len(subpaths)


def resample_closed(poly, n):
    m = len(poly)
    cum = [0.0]
    for i in range(m):
        a = poly[i]; b = poly[(i+1) % m]
        cum.append(cum[-1] + math.hypot(b[0]-a[0], b[1]-a[1]))
    total = cum[-1]; out = []; j = 0
    for k in range(n):
        dist = (k / n) * total
        while j < m and cum[j+1] < dist: j += 1
        segd = cum[j+1] - cum[j]
        t = (dist - cum[j]) / segd if segd > 1e-9 else 0.0
        a = poly[j]; b = poly[(j+1) % m]
        out.append((a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t))
    return out


def normalize(pts):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    minx, maxx = min(xs), max(xs); miny, maxy = min(ys), max(ys)
    w = max(maxx-minx, 1e-6); h = max(maxy-miny, 1e-6); s = max(w, h)
    ox = (1 - w/s) / 2; oy = (1 - h/s) / 2
    return [((p[0]-minx)/s + ox, (p[1]-miny)/s + oy) for p in pts], (w/s, h/s)


def ascii_preview(pts, W=48, H=24):
    g = [[' '] * W for _ in range(H)]
    for x, y in pts:
        gx = min(W-1, max(0, int(x*(W-1)))); gy = min(H-1, max(0, int(y*(H-1))))
        g[gy][gx] = '#'
    return '\n'.join(''.join(r) for r in g)


def emit_entry(name, pts):
    s = '\t"' + name + '": PackedVector2Array([\n'
    line = '\t\t'
    for (x, y) in pts:
        tok = "Vector2(%.4f, %.4f), " % (x, y)
        if len(line) + len(tok) > 100:
            s += line.rstrip() + '\n'; line = '\t\t'
        line += tok
    s += line.rstrip().rstrip(',') + ']),\n'
    return s


def gd(level, text):
    return "\t" * level + text


HEADER = """class_name TrackShapes
# Shared source of truth for circuit outlines (normalized 0..1, closed loops).
# Both the 2D minimap (track_map.gd) and the 3D race view (race_view_3d.gd) call
# loop_for() so they always draw the SAME shape.
#
# Outlines derived from the f1-circuits-svg project by ROY Jules (CC BY 4.0):
#   https://github.com/julesr0y/f1-circuits-svg
# Each circuit's latest layout (minimal centre-line SVG) was flattened, evenly
# resampled to 120 points and uniformly normalized (real aspect ratio preserved)
# by tools/svg_to_trackshapes.py. Points are unclosed; loop_for() appends closure.
#
# static var (not const): a PackedVector2Array built from Vector2 literals is NOT
# a constant expression, so Godot rejects it inside a const block.

static var TRACK_SHAPES: Dictionary = {
"""

FOOTER_LINES = [
    "}",
    "",
    "# Returns a closed, normalized (0..1) loop for the named track.",
    "# Falls back to a deterministic procedural loop when the track has no authored shape.",
    "# The returned array has the closure point appended (last == first) so callers can",
    "# treat it as a closed polygon without extra logic.",
    "static func loop_for(track_name: String, seed_value: int) -> PackedVector2Array:",
    gd(1, "var raw: PackedVector2Array"),
    gd(1, "if TRACK_SHAPES.has(track_name):"),
    gd(2, "raw = TRACK_SHAPES[track_name]"),
    gd(1, "else:"),
    gd(2, "raw = _generate(seed_value)"),
    gd(1, "return _fit_and_close(raw)"),
    "",
    "",
    "# ---------------------------------------------------------------- internals",
    "",
    "# Re-normalise a raw point cloud to 0..1 with a UNIFORM scale (real aspect ratio",
    "# preserved, shape centred in the unit box), then append the first point to close",
    "# the loop. Uniform (not per-axis) scaling stops long circuits being squashed into",
    "# a square — important now the outlines are real F1 layouts.",
    "static func _fit_and_close(src: PackedVector2Array) -> PackedVector2Array:",
    gd(1, "if src.size() == 0:"),
    gd(2, "return PackedVector2Array()"),
    gd(1, "var minx := 1.0e9"),
    gd(1, "var miny := 1.0e9"),
    gd(1, "var maxx := -1.0e9"),
    gd(1, "var maxy := -1.0e9"),
    gd(1, "for p in src:"),
    gd(2, "minx = minf(minx, p.x)"),
    gd(2, "miny = minf(miny, p.y)"),
    gd(2, "maxx = maxf(maxx, p.x)"),
    gd(2, "maxy = maxf(maxy, p.y)"),
    gd(1, "var w := maxf(maxx - minx, 0.001)"),
    gd(1, "var h := maxf(maxy - miny, 0.001)"),
    gd(1, "var sca := maxf(w, h)"),
    gd(1, "var ox := (1.0 - w / sca) * 0.5"),
    gd(1, "var oy := (1.0 - h / sca) * 0.5"),
    gd(1, "var out := PackedVector2Array()"),
    gd(1, "for p in src:"),
    gd(2, "out.append(Vector2((p.x - minx) / sca + ox, (p.y - miny) / sca + oy))"),
    gd(1, "out.append(out[0])   # close the loop"),
    gd(1, "return out"),
    "",
    "",
    "# Procedural harmonic loop — identical algorithm to track_map.gd._generate() so",
    "# host and client always produce the same shape for the same seed.",
    "static func _generate(seed_value: int) -> PackedVector2Array:",
    gd(1, "var r := RaceSim.RNG.new(RaceSim.mix32(seed_value))"),
    gd(1, "var harm: Array = []"),
    gd(1, "for _i in 3:"),
    gd(2, "harm.append([2 + int(r.next_u32() % 4), r.rangef(0.06, 0.18), r.rangef(0.0, TAU)])"),
    gd(1, "var n := 200"),
    gd(1, "var raw: Array = []"),
    gd(1, "for i in n:"),
    gd(2, "var th := TAU * float(i) / float(n)"),
    gd(2, "var rad := 1.0"),
    gd(2, "for hh in harm:"),
    gd(3, "rad += float(hh[1]) * sin(float(hh[0]) * th + float(hh[2]))"),
    gd(2, "raw.append(Vector2(cos(th), sin(th)) * rad)"),
    gd(1, "var fit := PackedVector2Array()"),
    gd(1, "for p in raw:"),
    gd(2, "fit.append(p)"),
    gd(1, "return fit"),
    "",
]
FOOTER = "\n".join(FOOTER_LINES)


def main():
    entries = ""
    for name, fn in CHOICES:
        d = get_d("%s/%s.svg" % (BASE, fn))
        poly, nsub = flatten(d)
        res = resample_closed(poly, N)
        norm, aspect = normalize(res)
        entries += emit_entry(name, norm)
        print("\n===== %s  (%s)  raw=%d subpaths=%d -> N=%d  aspect=%.2fx%.2f ====="
              % (name, fn, len(poly), nsub, len(norm), aspect[0], aspect[1]))
        print(ascii_preview(norm))
    out = HEADER + entries + FOOTER
    open(TARGET, "w", encoding="utf-8", newline="\n").write(out)
    print("\n[wrote %s : %d chars, %d tracks]" % (TARGET, len(out), len(CHOICES)))


if __name__ == "__main__":
    main()
