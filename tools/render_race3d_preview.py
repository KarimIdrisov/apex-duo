#!/usr/bin/env python3
# Static preview of ApexWeb's 3D race view (race3d.js). Pure-Python reimplementation
# of geom3d.js (centerline + ribbon edges) and the race3d orbital camera so we can SEE
# the procedural track without a browser/WebGL. Renders the asphalt ribbon, sector tint
# lines, start/finish and the box-cars exactly where race3d places them.
# Outputs: outputs/race3d_preview.png (default orbital) + outputs/race3d_lowangle.png.
import re, math, os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "ApexWeb", "src", "data.js")
OUTDIR = os.path.join(ROOT, "outputs")

# ---- pull TRACK_PATH + team colours straight from the game data ----
src = open(DATA, encoding="utf-8").read()
blk = src[src.index("export const TRACK_PATH = ["):]
blk = blk[:blk.index("];")]
nums = [float(x) for x in re.findall(r"-?\d+\.\d+", blk)]
PATH = [[nums[i], nums[i+1]] for i in range(0, len(nums)-1, 2)]
COLORS = re.findall(r'color:"(#[0-9a-fA-F]{6})"', src)  # team order

# ---- geom3d.js ----
def centerline(pts):
    seg = []; total = 0.0
    for i in range(len(pts)):
        a = pts[i]; bb = pts[(i+1) % len(pts)]
        d = math.hypot(bb[0]-a[0], bb[1]-a[1]); seg.append((a, bb, d)); total += d
    return pts, seg, total

def point_at(cl, frac):
    pts, seg, total = cl
    t = ((frac % 1)+1) % 1 * total
    for a, bb, d in seg:
        if t <= d:
            r = t/d if d else 0
            return [a[0]+(bb[0]-a[0])*r, a[1]+(bb[1]-a[1])*r]
        t -= d
    return list(pts[0])

def tangent_at(cl, frac):
    e = 1/2048
    a = point_at(cl, frac-e); bb = point_at(cl, frac+e)
    dx, dy = bb[0]-a[0], bb[1]-a[1]; m = math.hypot(dx, dy) or 1
    return [dx/m, dy/m]

def bounds(cl):
    xs = [p[0] for p in cl[0]]; ys = [p[1] for p in cl[0]]
    minX, maxX, minY, maxY = min(xs), max(xs), min(ys), max(ys)
    return dict(cx=(minX+maxX)/2, cy=(minY+maxY)/2, size=max(maxX-minX, maxY-minY) or 1)

cl = centerline(PATH); b = bounds(cl)

# ---- race3d.js constants + world mapping ----
WORLD = 120.0; HALF_W = 2.0; STEPS = 320
CAR_L, CAR_W, CAR_H = 2.8, 1.2, 0.7
sc = WORLD / b["size"]
wx = lambda p: (p[0]-b["cx"])*sc
wz = lambda p: (p[1]-b["cy"])*sc
W, H = 1280, 800

def dot(a, c): return a[0]*c[0]+a[1]*c[1]+a[2]*c[2]
def sub(a, c): return (a[0]-c[0], a[1]-c[1], a[2]-c[2])
def cross(a, c): return (a[1]*c[2]-a[2]*c[1], a[2]*c[0]-a[0]*c[2], a[0]*c[1]-a[1]*c[0])
def norm(a):
    m = math.sqrt(dot(a, a)) or 1; return (a[0]/m, a[1]/m, a[2]/m)
def hx(h): h = h.lstrip("#"); return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))

LIGHT = norm((WORLD, WORLD*1.4, WORLD*0.5))
SECT = ["#5aa0ff", "#ffce47", "#46d08a"]
FACES = [((4,5,6,7),(0,1,0)), ((0,1,2,3),(0,-1,0)),
         ((0,1,5,4),(0,0,-1)), ((3,2,6,7),(0,0,1)),
         ((1,2,6,5),(1,0,0)), ((0,3,7,4),(-1,0,0))]
FRACS = [0.00,0.018,0.045,0.085,0.14,0.205,0.28,0.37,0.5,0.66,0.82]

def yawpt(lx, ly, lz, a, ox, oz):
    ca, sa = math.cos(a), math.sin(a)
    return (ox + lx*ca + lz*sa, ly, oz - lx*sa + lz*ca)

def render(elev_deg, azim_deg, fill, out, caption):
    azim = math.radians(azim_deg); elev = math.radians(elev_deg); dist = b["size"]*fill*sc
    horiz = math.cos(elev)*dist
    P = (math.sin(azim)*horiz, math.sin(elev)*dist, math.cos(azim)*horiz)
    T = (0.0, 0.0, 0.0)
    zc = norm(sub(P, T)); xc = norm(cross((0, 1, 0), zc)); yc = cross(zc, xc)
    fov = math.radians(45); f = 1/math.tan(fov/2); aspect = W/H

    def project(world):
        d = sub(world, P)
        cx, cy, cz = dot(xc, d), dot(yc, d), dot(zc, d)
        if cz >= -1e-3: return None
        return (((f/aspect)*cx/(-cz)*0.5+0.5)*W, (1-(f*cy/(-cz)*0.5+0.5))*H, -cz)

    def shade(rgb, n):
        k = min(1.0, 0.75 + 0.8*max(0.0, dot(n, LIGHT)))
        return tuple(min(255, int(c*k)) for c in rgb)

    img = Image.new("RGB", (W, H), (10, 10, 12)); dr = ImageDraw.Draw(img, "RGBA")

    # track ribbon
    left = []; right = []
    for k in range(STEPS):
        fr = k/STEPS; p = point_at(cl, fr); t = tangent_at(cl, fr)
        nx, ny = -t[1], t[0]; hw = HALF_W/sc
        left.append([p[0]+nx*hw, p[1]+ny*hw]); right.append([p[0]-nx*hw, p[1]-ny*hw])
    quads = []
    for k in range(STEPS):
        j = (k+1) % STEPS
        w = [(wx(left[k]),0,wz(left[k])), (wx(right[k]),0,wz(right[k])),
             (wx(right[j]),0,wz(right[j])), (wx(left[j]),0,wz(left[j]))]
        pr = [project(v) for v in w]
        if any(p is None for p in pr): continue
        quads.append((sum(p[2] for p in pr)/4, [(p[0], p[1]) for p in pr]))
    quads.sort(key=lambda q: -q[0])
    acol = shade(hx("#2c2c33"), (0, 1, 0))
    for _, poly in quads: dr.polygon(poly, fill=acol)

    # sector tint lines + start/finish
    for s in range(3):
        pts = []
        for k in range(49):
            p = point_at(cl, s/3 + (1/3)*(k/48)); pr = project((wx(p), 0.05, wz(p)))
            if pr: pts.append((pr[0], pr[1]))
        if len(pts) > 1: dr.line(pts, fill=hx(SECT[s]), width=3)
    p0 = point_at(cl, 0); t0 = tangent_at(cl, 0); hw = HALF_W/sc
    a = (p0[0]-t0[1]*hw, p0[1]+t0[0]*hw); c = (p0[0]+t0[1]*hw, p0[1]-t0[0]*hw)
    pa = project((wx(a), 0.06, wz(a))); pc = project((wx(c), 0.06, wz(c)))
    if pa and pc: dr.line([(pa[0], pa[1]), (pc[0], pc[1])], fill=(255, 255, 255), width=4)

    # box-cars (yaw along tangent, like race3d)
    cars = []
    for i, fr in enumerate(FRACS):
        p = point_at(cl, fr); t = tangent_at(cl, fr); yaw = math.atan2(t[0], t[1])
        ox, oz = wx(p), wz(p); base = hx(COLORS[i % len(COLORS)])
        hX, hY, hZ = CAR_W/2, CAR_H, CAR_L/2
        v = [(-hX,0,-hZ),(hX,0,-hZ),(hX,0,hZ),(-hX,0,hZ),
             (-hX,hY,-hZ),(hX,hY,-hZ),(hX,hY,hZ),(-hX,hY,hZ)]
        vw = [yawpt(x, y, z, yaw, ox, oz) for (x, y, z) in v]
        depth = sum((project(w) or (0,0,1e9))[2] for w in vw)/8
        cars.append((depth, vw, yaw, base))
    cars.sort(key=lambda c: -c[0])
    for _, vw, yaw, base in cars:
        faces = []
        for idx, n in FACES:
            nw = yawpt(n[0], n[1], n[2], yaw, 0, 0)
            pr = [project(vw[k]) for k in idx]
            if any(p is None for p in pr): continue
            faces.append((sum(p[2] for p in pr)/len(pr),
                          [(p[0], p[1]) for p in pr], shade(base, nw)))
        faces.sort(key=lambda fc: -fc[0])
        for _, poly, fcol in faces: dr.polygon(poly, fill=fcol, outline=(8, 8, 10))

    dr.rectangle([0, 0, W, 34], fill=(0, 0, 0, 160))
    dr.text((12, 11), caption, fill=(220, 220, 230))
    os.makedirs(OUTDIR, exist_ok=True); img.save(out)
    print("wrote", out, "| quads:", len(quads))

render(42, -35, 1.15, os.path.join(OUTDIR, "race3d_preview.png"),
       "ApexWeb 3D race view (race3d.js) - Barcelona - default orbital camera (elev 42, azim -35)")
render(15, -28, 0.78, os.path.join(OUTDIR, "race3d_lowangle.png"),
       "ApexWeb 3D race view - low orbit (elev 15): box-cars show real 3D height; drag-to-orbit in-game")
