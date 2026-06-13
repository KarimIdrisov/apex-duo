// ApexWeb/src/ui/race3d.js — 3D orbital race view. Pure render layer over the sim:
// reads the SAME ctx._buf snapshot buffers + ctx.snapshot.cars that race.js maintains.
// No sim/netcode coupling. WebGL -> owner-playtest verified. Self-disposes when its
// canvas leaves the DOM. Cars ride a racing line (inside-hugging) and side-step when
// they catch the car ahead, so a train fans out instead of stacking on the centerline.
import * as THREE from "https://esm.sh/three@0.160.0";
import { TRACK_PATH } from "../data.js";
import { buildCenterline, pointAt, tangentAt, bounds, ribbonEdges, sampleProg, racingLineOffset, offsetPoint, splinePath, radiusAt, cornerRuns, RIBBON_CLAMP, elevation } from "../geom3d.js";

const WORLD = 120;                 // larger track axis spans ~120 world units
const HALF_W = 3.8;                // track half-width (world units) — wider for a real-track feel
const CAR_L = 2.8;                  // overall car length (used for the highlight ring radius)
const DELAY = 120;                 // render this many ms behind the newest snapshot
const POS_EASE = 0.35;             // low-pass the rendered car position — kills snapshot-interp micro-judder up close
const CLOSE_PROG = 0.012;          // gap (lap-fractions) under which a follower side-steps to pass
const CORNER_R = 0.10;             // centerline radius (normalized) below which a sample counts as a corner (kerbs)
const CAR_HALF = 0.20;             // car half-width as a fraction of the track half-width (lateral-clamp margin)
const SECTOR_COL = [0x5aa0ff, 0xffce47, 0x46d08a];
const ASPHALT = 0x2c2c33, ASPHALT_SC = 0x4a4626, GRASS = 0x1f3a22;
const KERB_RED = [0.86, 0.16, 0.18], KERB_WHITE = [0.88, 0.88, 0.9];
const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

// procedural CanvasTexture: a `base` fill peppered with `shades` speckles -> tileable surface grain
function noiseTex(base, shades, n = 128, density = 0.14) {
  const c = document.createElement("canvas"); c.width = c.height = n;
  const x = c.getContext("2d");
  x.fillStyle = base; x.fillRect(0, 0, n, n);
  for (let i = 0; i < n * n * density; i++) {
    x.fillStyle = shades[(Math.random() * shades.length) | 0];
    x.fillRect((Math.random() * n) | 0, (Math.random() * n) | 0, 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;   // colour map: decode from sRGB so lighting + tone-mapping are correct
  return t;
}

export function init(canvas, ctx) {
  const cl = buildCenterline(splinePath(TRACK_PATH));   // Catmull-Rom-smoothed: soft corners, no per-vertex snapping
  const b = bounds(cl);
  const sc = WORLD / b.size;                       // normalized -> world scale
  const wx = (p) => (p[0] - b.cx) * sc;            // center the track at world origin
  const wz = (p) => (p[1] - b.cy) * sc;
  const mats = [];                                 // every runtime material, freed in dispose()
  const geos = [];                                 // every runtime geometry, freed in dispose()
  const texs = [];                                 // every runtime texture, freed in dispose()
  const HW_N = HALF_W / sc;                          // half-width in normalized units
  const LANE_LAT = HW_N * 0.45, SIDE_LAT = HW_N * 0.34;   // racing-line + side-step lateral range (kept on asphalt)
  const ELEV_AMP = WORLD * 0.04;                     // elevation amplitude (world units) — subtle rolling terrain
  const surfaceY = (f) => ELEV_AMP * elevation(f);   // world height of the track surface at lap-frac f (render-only)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(0x0a0a0c, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;   // filmic colour grading — less flat/washed
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(45, 1, 0.1, WORLD * 8);

  // subtle bloom via the post-composer, add-ons loaded lazily from the CDN; on any failure
  // composer stays null and the frame loop falls back to a plain renderer.render (no bloom).
  let composer = null, bloomPass = null;
  const TJ = "https://esm.sh/three@0.160.0/examples/jsm/";
  Promise.all([
    import(TJ + "postprocessing/EffectComposer.js"),
    import(TJ + "postprocessing/RenderPass.js"),
    import(TJ + "postprocessing/UnrealBloomPass.js"),
    import(TJ + "postprocessing/OutputPass.js"),
  ]).then(([ec, rp, ub, op]) => {
    const w = canvas.clientWidth || 360, h = canvas.clientHeight || 300;
    const cm = new ec.EffectComposer(renderer);
    cm.addPass(new rp.RenderPass(scene, cam));
    bloomPass = new ub.UnrealBloomPass(new THREE.Vector2(w, h), 0.32, 0.6, 0.9);   // strength, radius, threshold (subtle)
    cm.addPass(bloomPass);
    cm.addPass(new op.OutputPass());                                               // tone mapping + sRGB at the end of the chain
    cm.setSize(w, h);
    if (alive) composer = cm; else { cm.dispose(); bloomPass.dispose(); }          // disposed already? drop it
  }).catch(() => { composer = null; });

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  scene.add(new THREE.HemisphereLight(0xaecbff, 0x2a3322, 0.55));   // sky/ground fill for nicer ambient
  const key = new THREE.DirectionalLight(0xffffff, 0.8);
  key.position.set(WORLD, WORLD * 1.4, WORLD * 0.5); scene.add(key);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const shCam = key.shadow.camera;                       // ortho frustum sized to cover the whole track
  shCam.near = WORLD * 0.4; shCam.far = WORLD * 3.5;
  shCam.left = -WORLD; shCam.right = WORLD; shCam.top = WORLD; shCam.bottom = -WORLD;
  shCam.updateProjectionMatrix();
  key.shadow.bias = -0.0002; key.shadow.normalBias = 0.02;   // keep thin cars attached to their contact shadow

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
  const grassMap = noiseTex("#23402a", ["#1b3320", "#284a30", "#192f1d", "#2d5236"], 128, 0.16); grassMap.repeat.set(10, 10); texs.push(grassMap);
  const grassMat = new THREE.MeshStandardMaterial({ map: grassMap, roughness: 1, metalness: 0 }); mats.push(grassMat);
  const grass = new THREE.Mesh(grassGeo, grassMat); grass.rotation.x = -Math.PI / 2; grass.position.y = -0.15; grass.receiveShadow = true; scene.add(grass);


  // --- track ribbon: a triangle strip between the left/right edges ---
  const STEPS = 800;                 // ribbon cross-sections — high so corners read smooth from the close chase cam
  const { left, right } = ribbonEdges(cl, HW_N, STEPS);   // edges in normalized space
  const pos = new Float32Array(STEPS * 2 * 3);
  for (let k = 0; k < STEPS; k++) {
    const l = left[k], r = right[k], y = surfaceY(k / STEPS);
    pos[k * 6 + 0] = wx(l); pos[k * 6 + 1] = y; pos[k * 6 + 2] = wz(l);
    pos[k * 6 + 3] = wx(r); pos[k * 6 + 4] = y; pos[k * 6 + 5] = wz(r);
  }
  const index = [];
  for (let k = 0; k < STEPS; k++) {
    const a = k * 2, bb = k * 2 + 1, c = ((k + 1) % STEPS) * 2, d = ((k + 1) % STEPS) * 2 + 1;
    index.push(a, bb, c, bb, d, c);
  }
  const trackGeo = new THREE.BufferGeometry(); geos.push(trackGeo);
  trackGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  trackGeo.setIndex(index); trackGeo.computeVertexNormals();
  const uv = new Float32Array(STEPS * 2 * 2);                          // u along the lap, v across the width
  for (let k = 0; k < STEPS; k++) { uv[k * 4] = k / STEPS; uv[k * 4 + 1] = 0; uv[k * 4 + 2] = k / STEPS; uv[k * 4 + 3] = 1; }
  trackGeo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  const asphaltMap = noiseTex("#e8e8e8", ["#d6d6d6", "#f2f2f2", "#dedede"], 128, 0.14); asphaltMap.repeat.set(50, 4); texs.push(asphaltMap);
  const trackMat = new THREE.MeshStandardMaterial({ map: asphaltMap, color: ASPHALT, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }); mats.push(trackMat);
  const trackMesh = new THREE.Mesh(trackGeo, trackMat); trackMesh.receiveShadow = true; scene.add(trackMesh);

  // red/white rumble kerbs through corners only — one CONTINUOUS strip per cornerRuns span,
  // flush to the ribbon edge and stepped slightly inward, with uniform red/white blocks by arc
  // length. cornerRuns merges threshold flicker into solid spans so the strip has no gaps.
  {
    const runs = cornerRuns(cl, STEPS, CORNER_R);
    const KERB_W = 0.5 / sc, BLOCK = 6, KY = 0.02;         // inward width; ~BLOCK-sample colour blocks, counted within each run
    const inward = (p, c) => { const dx = c[0] - p[0], dy = c[1] - p[1], m = Math.hypot(dx, dy) || 1; return [p[0] + dx / m * KERB_W, p[1] + dy / m * KERB_W]; };
    const kpos = [], kcol = [];
    for (const edge of [left, right]) {
      for (const run of runs) {
        for (let s = 0; s < run.len; s++) {
          const k = (run.start + s) % STEPS, k1 = (k + 1) % STEPS, a = edge[k], bb = edge[k1];
          const ca = pointAt(cl, k / STEPS), cb = pointAt(cl, k1 / STEPS);
          const ia = inward(a, ca), ib = inward(bb, cb);
          const ya = surfaceY(k / STEPS) + KY, yb = surfaceY(k1 / STEPS) + KY;
          const col = (Math.floor(s / BLOCK) % 2) ? KERB_RED : KERB_WHITE;   // counted WITHIN the run -> uniform, gap-free blocks
          for (const [pt, yy] of [[a, ya], [bb, yb], [ib, yb], [a, ya], [ib, yb], [ia, ya]]) { kpos.push(wx(pt), yy, wz(pt)); kcol.push(col[0], col[1], col[2]); }
        }
      }
    }
    const kerbGeo = new THREE.BufferGeometry(); geos.push(kerbGeo);
    kerbGeo.setAttribute("position", new THREE.Float32BufferAttribute(kpos, 3));
    kerbGeo.setAttribute("color", new THREE.Float32BufferAttribute(kcol, 3));
    const kerbMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }); mats.push(kerbMat);
    scene.add(new THREE.Mesh(kerbGeo, kerbMat));
  }

  // run-off verge: an apron just outside each edge — gravel through corners (cornerRuns), grass
  // on the straights — for real-circuit breathing room. Inner rail sits just under the track,
  // outer rail drops to the grass plane (this becomes the embankment once elevation is on).
  {
    const isCorner = new Array(STEPS).fill(false);
    for (const run of cornerRuns(cl, STEPS, CORNER_R)) for (let s = 0; s < run.len; s++) isCorner[(run.start + s) % STEPS] = true;
    const VERGE_W = HW_N * 1.5, VY = -0.04, GROUND = -0.15;       // outward width; apron just under the track, dropping to the grass
    const GRAVEL = [0.55, 0.49, 0.35], GREEN = [0.12, 0.25, 0.15];
    const outward = (f, sgn) => { const [tx, ty] = tangentAt(cl, f); return [-ty * sgn, tx * sgn]; };   // outward normal (sgn +1 left edge, -1 right)
    const vpos = [], vcol = [];
    for (const sgn of [1, -1]) {
      const edge = sgn > 0 ? left : right;
      for (let k = 0; k < STEPS; k++) {
        const k1 = (k + 1) % STEPS, a = edge[k], bb = edge[k1];
        const oa = outward(k / STEPS, sgn), ob = outward(k1 / STEPS, sgn);
        const va = [a[0] + oa[0] * VERGE_W, a[1] + oa[1] * VERGE_W], vb = [bb[0] + ob[0] * VERGE_W, bb[1] + ob[1] * VERGE_W];
        const col = isCorner[k] ? GRAVEL : GREEN;
        const ya = surfaceY(k / STEPS) + VY, yb = surfaceY(k1 / STEPS) + VY;     // inner rail rides the track; outer drops to GROUND -> embankment slope
        for (const [pt, y] of [[a, ya], [bb, yb], [vb, GROUND], [a, ya], [vb, GROUND], [va, GROUND]]) { vpos.push(wx(pt), y, wz(pt)); vcol.push(col[0], col[1], col[2]); }
      }
    }
    const vgeo = new THREE.BufferGeometry(); geos.push(vgeo);
    vgeo.setAttribute("position", new THREE.Float32BufferAttribute(vpos, 3));
    vgeo.setAttribute("color", new THREE.Float32BufferAttribute(vcol, 3));
    vgeo.computeVertexNormals();
    const vmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide }); mats.push(vmat);
    const vmesh = new THREE.Mesh(vgeo, vmat); vmesh.receiveShadow = true; scene.add(vmesh);
  }

  // sector tint lines just above the asphalt
  for (let s = 0; s < 3; s++) {
    const v = [], lo = s / 3, hi = (s + 1) / 3;
    for (let k = 0; k <= 48; k++) { const f = lo + (hi - lo) * (k / 48), p = pointAt(cl, f); v.push(new THREE.Vector3(wx(p), surfaceY(f) + 0.07, wz(p))); }
    const lg = new THREE.BufferGeometry().setFromPoints(v); geos.push(lg);
    const lm = new THREE.LineBasicMaterial({ color: SECTOR_COL[s] }); mats.push(lm);
    scene.add(new THREE.Line(lg, lm));
  }
  // start/finish line across the track at frac 0
  {
    const p = pointAt(cl, 0), t = tangentAt(cl, 0), nx = -t[1], ny = t[0];
    const a = [p[0] + nx * HW_N, p[1] + ny * HW_N], c = [p[0] - nx * HW_N, p[1] - ny * HW_N];
    const sg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(wx(a), surfaceY(0) + 0.08, wz(a)), new THREE.Vector3(wx(c), surfaceY(0) + 0.08, wz(c))]); geos.push(sg);
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
    const add = (geo, mat, x, y, z, rz) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (rz) m.rotation.z = rz; m.castShadow = true; g.add(m); };
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
    if (composer) composer.setSize(w, h);
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
    for (const t of texs) t.dispose();
    if (composer) composer.dispose();
    if (bloomPass) bloomPass.dispose();   // UnrealBloomPass owns internal targets not freed by composer.dispose()
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
        car.group.position.set(wx(PIT), surfaceY(0), wz(PIT));
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
      const hwLocal = Math.min(HW_N, radiusAt(cl, prog, 1 / STEPS) * RIBBON_CLAMP);   // local road half-width (matches the ribbon clamp)
      const maxLat = Math.max(0, hwLocal - CAR_HALF * HW_N);     // keep the car body on the asphalt at narrowed hairpins
      car.lat = Math.max(-maxLat, Math.min(maxLat, car.lat));
      const p = offsetPoint(cl, prog, car.lat), t = tangentAt(cl, prog);
      const txp = wx(p), tzp = wz(p);                            // low-pass the rendered position to smooth micro-judder
      if (car.px == null) { car.px = txp; car.pz = tzp; }
      else { car.px += (txp - car.px) * POS_EASE; car.pz += (tzp - car.pz) * POS_EASE; }
      car.group.position.set(car.px, surfaceY(prog), car.pz);   // ride the rolling surface
      car.group.rotation.y = Math.atan2(t[0], t[1]);             // local +Z faces the tangent
      const leader = i === 0;
      car.ring.material.opacity = (c.player || leader) ? 1 : 0;
      car.ring.material.color.set(leader ? 0xffd000 : 0xffffff);
    }
    trackMat.color.set(ctx.snapshot && ctx.snapshot.scActive ? ASPHALT_SC : ASPHALT);
    updateCam();
    if (composer) composer.render(); else renderer.render(scene, cam);
  }
  frame();

  return { dispose };
}
