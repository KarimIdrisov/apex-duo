// ApexWeb/src/ui/race3d.js — 3D orbital race view. Pure render layer over the sim:
// reads the SAME ctx._buf snapshot buffers + ctx.snapshot.cars that race.js maintains.
// No sim/netcode coupling. WebGL -> owner-playtest verified. Self-disposes when its
// canvas leaves the DOM. Cars ride a racing line (inside-hugging) and side-step when
// they catch the car ahead, so a train fans out instead of stacking on the centerline.
import * as THREE from "https://esm.sh/three@0.160.0";
import { TRACK_PATH } from "../data.js";
import { buildCenterline, pointAt, tangentAt, bounds, ribbonEdges, sampleProg, racingLineOffset, offsetPoint, splinePath } from "../geom3d.js";

const WORLD = 120;                 // larger track axis spans ~120 world units
const HALF_W = 3.8;                // track half-width (world units) — wider for a real-track feel
const CAR_L = 2.8;                  // overall car length (used for the highlight ring radius)
const DELAY = 120;                 // render this many ms behind the newest snapshot
const POS_EASE = 0.35;             // low-pass the rendered car position — kills snapshot-interp micro-judder up close
const CLOSE_PROG = 0.012;          // gap (lap-fractions) under which a follower side-steps to pass
const SECTOR_COL = [0x5aa0ff, 0xffce47, 0x46d08a];
const ASPHALT = 0x2c2c33, ASPHALT_SC = 0x4a4626, GRASS = 0x1f3a22;
const KERB_RED = [0.86, 0.16, 0.18], KERB_WHITE = [0.88, 0.88, 0.9];
const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function init(canvas, ctx) {
  const cl = buildCenterline(splinePath(TRACK_PATH));   // Catmull-Rom-smoothed: soft corners, no per-vertex snapping
  const b = bounds(cl);
  const sc = WORLD / b.size;                       // normalized -> world scale
  const wx = (p) => (p[0] - b.cx) * sc;            // center the track at world origin
  const wz = (p) => (p[1] - b.cy) * sc;
  const mats = [];                                 // every runtime material, freed in dispose()
  const geos = [];                                 // every runtime geometry, freed in dispose()
  const HW_N = HALF_W / sc;                          // half-width in normalized units
  const LANE_LAT = HW_N * 0.45, SIDE_LAT = HW_N * 0.34;   // racing-line + side-step lateral range (kept on asphalt)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(0x0a0a0c, 1);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(45, 1, 0.1, WORLD * 8);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  scene.add(new THREE.HemisphereLight(0xaecbff, 0x2a3322, 0.55));   // sky/ground fill for nicer ambient
  const key = new THREE.DirectionalLight(0xffffff, 0.8);
  key.position.set(WORLD, WORLD * 1.4, WORLD * 0.5); scene.add(key);

  // gradient sky dome (vertex-coloured, seen from inside) wrapping the whole scene
  const skyGeo = new THREE.SphereGeometry(WORLD * 5, 24, 12); geos.push(skyGeo);
  {
    const sp = skyGeo.attributes.position, col = [], R = WORLD * 5;
    const top = new THREE.Color(0x14213d), bot = new THREE.Color(0x55657d);
    for (let i = 0; i < sp.count; i++) {
      const f = Math.max(0, Math.min(1, sp.getY(i) / R * 0.5 + 0.5)), c = bot.clone().lerp(top, f);
      col.push(c.r, c.g, c.b);
    }
    skyGeo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  }
  const skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }); mats.push(skyMat);
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  // grass ground plane under everything
  const grassGeo = new THREE.PlaneGeometry(WORLD * 3, WORLD * 3); geos.push(grassGeo);
  const grassMat = new THREE.MeshStandardMaterial({ color: GRASS, roughness: 1, metalness: 0 }); mats.push(grassMat);
  const grass = new THREE.Mesh(grassGeo, grassMat); grass.rotation.x = -Math.PI / 2; grass.position.y = -0.15; scene.add(grass);

  // low-poly grandstands set back outside the track at a few spots (broadcast venue feel)
  const bankGeo = new THREE.BoxGeometry(16, 5, 7); geos.push(bankGeo);
  const roofGeo = new THREE.BoxGeometry(17, 0.5, 8); geos.push(roofGeo);
  const standMat = new THREE.MeshStandardMaterial({ color: 0x39414f, roughness: 0.9 }); mats.push(standMat);
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x20252e, roughness: 0.8 }); mats.push(roofMat);
  for (const f of [0.0, 0.26, 0.52, 0.74]) {
    const sp = pointAt(cl, f), st = tangentAt(cl, f);
    let nx = -st[1], ny = st[0];
    if ((b.cx - sp[0]) * nx + (b.cy - sp[1]) * ny > 0) { nx = -nx; ny = -ny; }   // outward, away from centroid
    const o = [sp[0] + nx * HW_N * 2.4, sp[1] + ny * HW_N * 2.4];                 // set back beyond the track edge
    const g = new THREE.Group();
    const bank = new THREE.Mesh(bankGeo, standMat); bank.position.set(0, 2.5, 0); g.add(bank);
    const roof = new THREE.Mesh(roofGeo, roofMat); roof.position.set(0, 5.3, 1.2); g.add(roof);   // roof cantilevered toward the track
    g.position.set(wx(o), 0, wz(o)); g.rotation.y = Math.atan2(-nx, -ny); scene.add(g);
  }

  // --- track ribbon: a triangle strip between the left/right edges ---
  const STEPS = 320;
  const { left, right } = ribbonEdges(cl, HW_N, STEPS);   // edges in normalized space
  const pos = new Float32Array(STEPS * 2 * 3);
  for (let k = 0; k < STEPS; k++) {
    const l = left[k], r = right[k];
    pos[k * 6 + 0] = wx(l); pos[k * 6 + 1] = 0; pos[k * 6 + 2] = wz(l);
    pos[k * 6 + 3] = wx(r); pos[k * 6 + 4] = 0; pos[k * 6 + 5] = wz(r);
  }
  const index = [];
  for (let k = 0; k < STEPS; k++) {
    const a = k * 2, bb = k * 2 + 1, c = ((k + 1) % STEPS) * 2, d = ((k + 1) % STEPS) * 2 + 1;
    index.push(a, bb, c, bb, d, c);
  }
  const trackGeo = new THREE.BufferGeometry(); geos.push(trackGeo);
  trackGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  trackGeo.setIndex(index); trackGeo.computeVertexNormals();
  const trackMat = new THREE.MeshStandardMaterial({ color: ASPHALT, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }); mats.push(trackMat);
  scene.add(new THREE.Mesh(trackGeo, trackMat));

  // red/white rumble kerbs along both edges (alternating segment colors via vertex colors)
  const kerbMat = new THREE.LineBasicMaterial({ vertexColors: true }); mats.push(kerbMat);
  for (const edge of [left, right]) {
    const kp = [], kc = [];
    for (let k = 0; k < edge.length; k++) {
      const a = edge[k], e = edge[(k + 1) % edge.length], col = (k % 2 === 0) ? KERB_RED : KERB_WHITE;
      kp.push(wx(a), 0.05, wz(a), wx(e), 0.05, wz(e));
      kc.push(col[0], col[1], col[2], col[0], col[1], col[2]);
    }
    const kg = new THREE.BufferGeometry(); geos.push(kg);
    kg.setAttribute("position", new THREE.Float32BufferAttribute(kp, 3));
    kg.setAttribute("color", new THREE.Float32BufferAttribute(kc, 3));
    scene.add(new THREE.LineSegments(kg, kerbMat));
  }

  // sector tint lines just above the asphalt
  for (let s = 0; s < 3; s++) {
    const v = [], lo = s / 3, hi = (s + 1) / 3;
    for (let k = 0; k <= 48; k++) { const p = pointAt(cl, lo + (hi - lo) * (k / 48)); v.push(new THREE.Vector3(wx(p), 0.07, wz(p))); }
    const lg = new THREE.BufferGeometry().setFromPoints(v); geos.push(lg);
    const lm = new THREE.LineBasicMaterial({ color: SECTOR_COL[s] }); mats.push(lm);
    scene.add(new THREE.Line(lg, lm));
  }
  // start/finish line across the track at frac 0
  {
    const p = pointAt(cl, 0), t = tangentAt(cl, 0), nx = -t[1], ny = t[0];
    const a = [p[0] + nx * HW_N, p[1] + ny * HW_N], c = [p[0] - nx * HW_N, p[1] - ny * HW_N];
    const sg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(wx(a), 0.08, wz(a)), new THREE.Vector3(wx(c), 0.08, wz(c))]); geos.push(sg);
    const sm = new THREE.LineBasicMaterial({ color: 0xffffff }); mats.push(sm);
    scene.add(new THREE.Line(sg, sm));
  }

  // --- cars: a stylized low-poly F1 silhouette. Geometry is shared across all 22 cars
  // (nose points +Z = direction of travel); only the body material is per-team colour. ---
  const tubGeo = new THREE.BoxGeometry(0.5, 0.35, 1.6); geos.push(tubGeo);
  const noseGeo = new THREE.BoxGeometry(0.36, 0.24, 0.85); geos.push(noseGeo);
  const engGeo = new THREE.BoxGeometry(0.4, 0.42, 0.7); geos.push(engGeo);
  const airboxGeo = new THREE.BoxGeometry(0.26, 0.3, 0.32); geos.push(airboxGeo);
  const sidepodGeo = new THREE.BoxGeometry(0.3, 0.3, 0.8); geos.push(sidepodGeo);
  const wingFGeo = new THREE.BoxGeometry(1.3, 0.07, 0.35); geos.push(wingFGeo);
  const wingRGeo = new THREE.BoxGeometry(1.1, 0.07, 0.3); geos.push(wingRGeo);
  const wingSupGeo = new THREE.BoxGeometry(0.06, 0.42, 0.1); geos.push(wingSupGeo);
  const cockGeo = new THREE.BoxGeometry(0.24, 0.2, 0.36); geos.push(cockGeo);
  const wheelFGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.22, 12); geos.push(wheelFGeo);
  const wheelRGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.24, 12); geos.push(wheelRGeo);
  const ringGeo = new THREE.RingGeometry(CAR_L * 0.85, CAR_L * 1.05, 24); geos.push(ringGeo);
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 0.6 }); mats.push(darkMat);   // wings/wheels/cockpit, shared
  function makeCar(bodyMat) {
    const g = new THREE.Group();
    const add = (geo, mat, x, y, z, rz) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (rz) m.rotation.z = rz; g.add(m); };
    add(tubGeo, bodyMat, 0, 0.25, 0);                    // monocoque
    add(noseGeo, bodyMat, 0, 0.22, 0.95);                // nose
    add(engGeo, bodyMat, 0, 0.35, -0.5);                 // engine cover
    add(airboxGeo, bodyMat, 0, 0.55, -0.2);              // airbox intake
    add(sidepodGeo, bodyMat, 0.45, 0.25, -0.1);          // sidepods
    add(sidepodGeo, bodyMat, -0.45, 0.25, -0.1);
    add(wingFGeo, darkMat, 0, 0.12, 1.45);               // front wing
    add(wingRGeo, darkMat, 0, 0.55, -1.35);              // rear wing
    add(wingSupGeo, darkMat, 0.3, 0.35, -1.3);           // rear-wing endplates
    add(wingSupGeo, darkMat, -0.3, 0.35, -1.3);
    add(cockGeo, darkMat, 0, 0.42, 0.12);                // cockpit opening
    add(wheelFGeo, darkMat, 0.6, 0.28, 0.85, Math.PI / 2);   // open wheels (cylinder axis -> X)
    add(wheelFGeo, darkMat, -0.6, 0.28, 0.85, Math.PI / 2);
    add(wheelRGeo, darkMat, 0.62, 0.3, -0.85, Math.PI / 2);
    add(wheelRGeo, darkMat, -0.62, 0.3, -0.85, Math.PI / 2);
    return g;
  }
  const cars = {};   // idx -> { group, ring, lat }
  for (const c of ((ctx.snapshot && ctx.snapshot.cars) || [])) {
    const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(c.color || "#888888"), roughness: 0.5 }); mats.push(bodyMat);
    const g = makeCar(bodyMat);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide }); mats.push(ringMat);
    const ring = new THREE.Mesh(ringGeo, ringMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.09; g.add(ring);
    cars[c.idx] = { group: g, ring, lat: 0 }; scene.add(g);
  }
  // pit-lane parking spot: start/finish, offset outward by ~2.4 half-widths
  const pitN = tangentAt(cl, 0), pitP = pointAt(cl, 0);
  const PIT = [pitP[0] + (-pitN[1]) * (2.4 * HW_N), pitP[1] + pitN[0] * (2.4 * HW_N)];

  // --- camera: orbit the whole track, or chase a car (ctx._cam3d.mode/target).
  // Drag adjusts the angle; the frame loop repositions every frame (smooth pan/zoom). ---
  let azim = -35 * Math.PI / 180, elev = 42 * Math.PI / 180, zoom = 1;   // zoom = wheel-controlled distance multiplier
  const ORBIT_DIST = b.size * 1.6 * sc, CHASE_DIST = 14;   // camera distance (world units)
  const ORIGIN0 = new THREE.Vector3(0, 0, 0);
  const camTarget = new THREE.Vector3(0, 0, 0);            // smoothed look-at point
  let curDist = ORBIT_DIST;
  function chaseGroup() {
    const cam3d = ctx._cam3d || {}, snap = (ctx.snapshot && ctx.snapshot.cars) || [];
    const live = (c) => (c && !c.retired && cars[c.idx]) ? cars[c.idx].group : null;
    if (cam3d.target === "leader") return live(snap[0]);
    return live(snap.find((x) => x.player)) || live(snap[0]);   // default: your car, else leader
  }
  function updateCam() {
    const chase = (ctx._cam3d && ctx._cam3d.mode === "chase") ? chaseGroup() : null;
    camTarget.lerp(chase ? chase.position : ORIGIN0, 0.12);
    curDist += ((chase ? CHASE_DIST : ORBIT_DIST) * zoom - curDist) * 0.12;
    const horiz = Math.cos(elev) * curDist;
    cam.position.set(camTarget.x + Math.sin(azim) * horiz, camTarget.y + Math.sin(elev) * curDist, camTarget.z + Math.cos(azim) * horiz);
    cam.lookAt(camTarget);
  }
  let drag = null;
  const onDown = (e) => { drag = { x: e.clientX, y: e.clientY }; };
  const onUp = () => { drag = null; };
  const onMove = (e) => {
    if (!drag) return;
    azim -= (e.clientX - drag.x) * 0.01;
    elev = Math.min(1.45, Math.max(0.2, elev - (e.clientY - drag.y) * 0.01));
    drag = { x: e.clientX, y: e.clientY };
  };
  const onWheel = (e) => { e.preventDefault(); zoom = Math.min(2.5, Math.max(0.35, zoom * (e.deltaY > 0 ? 1.12 : 0.89))); };
  canvas.addEventListener("mousedown", onDown);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("mouseup", onUp);
  window.addEventListener("mousemove", onMove);

  function resize() {
    const w = canvas.clientWidth || 360, h = canvas.clientHeight || 300;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    cam.aspect = w / h; cam.updateProjectionMatrix();
  }
  resize(); window.addEventListener("resize", resize);

  let raf = 0, alive = true;
  function dispose() {
    if (!alive) return; alive = false;
    cancelAnimationFrame(raf);
    canvas.removeEventListener("mousedown", onDown);
    canvas.removeEventListener("wheel", onWheel);
    window.removeEventListener("mouseup", onUp);
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("resize", resize);
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
    renderer.dispose();
  }
  function frame() {
    if (!canvas.isConnected) return dispose();   // screen changed -> self-teardown
    raf = requestAnimationFrame(frame);
    const rt = nowMs() - DELAY;
    const buf = ctx._buf || {};
    const snapCars = (ctx.snapshot && ctx.snapshot.cars) || [];   // position order (P1..)
    for (let i = 0; i < snapCars.length; i++) {
      const c = snapCars[i], car = cars[c.idx];
      if (!car) continue;
      if (c.retired) { car.group.visible = false; continue; }
      car.group.visible = true;
      if (c.inPit) {
        car.group.position.set(wx(PIT), 0, wz(PIT));
        car.ring.material.opacity = 0; car.lat = 0; car.px = null;   // re-snap when it rejoins the track
        continue;
      }
      const prog = sampleProg(buf[c.idx], rt);
      // lateral target = racing line, + a side-step when right behind the car ahead (fan a train out)
      let side = 0;
      const ahead = snapCars[i - 1];
      if (ahead && !ahead.retired && ahead.lap === c.lap) {
        const gapProg = (ahead.lap + ahead.lapFrac) - (c.lap + c.lapFrac);
        if (gapProg > 0 && gapProg < CLOSE_PROG) side = ((c.idx % 2) ? 1 : -1) * SIDE_LAT;
      }
      const tlat = racingLineOffset(cl, prog, LANE_LAT) + side;
      car.lat += (tlat - car.lat) * 0.12;                        // ease toward target (smooth)
      const p = offsetPoint(cl, prog, car.lat), t = tangentAt(cl, prog);
      const txp = wx(p), tzp = wz(p);                            // low-pass the rendered position to smooth micro-judder
      if (car.px == null) { car.px = txp; car.pz = tzp; }
      else { car.px += (txp - car.px) * POS_EASE; car.pz += (tzp - car.pz) * POS_EASE; }
      car.group.position.set(car.px, 0, car.pz);
      car.group.rotation.y = Math.atan2(t[0], t[1]);             // local +Z faces the tangent
      const leader = i === 0;
      car.ring.material.opacity = (c.player || leader) ? 1 : 0;
      car.ring.material.color.set(leader ? 0xffd000 : 0xffffff);
    }
    trackMat.color.set(ctx.snapshot && ctx.snapshot.scActive ? ASPHALT_SC : ASPHALT);
    updateCam();
    renderer.render(scene, cam);
  }
  frame();

  return { dispose };
}
