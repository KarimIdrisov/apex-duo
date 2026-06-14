// ApexWeb/src/ui/race3d.js — 3D orbital race view. Pure render layer over the sim:
// reads the SAME ctx._buf snapshot buffers + ctx.snapshot.cars that race.js maintains.
// No sim/netcode coupling. WebGL -> owner-playtest verified. Self-disposes when its
// canvas leaves the DOM. Cars ride a racing line (inside-hugging) and side-step when
// they catch the car ahead, so a train fans out instead of stacking on the centerline.
import * as THREE from "https://esm.sh/three@0.160.0";
import { TRACK_PATH } from "../data.js";
import { buildCenterline, pointAt, tangentAt, bounds, sampleProg, racingLineOffset, offsetPoint, splinePath, cornerRuns } from "../geom3d.js";
import { TRACK_SHAPES } from "../track_shapes.js";

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
  const trackName = (ctx.snapshot && ctx.snapshot.trackName) || null;   // host picked the circuit from the seed; client reads it from the snapshot
  const path = (trackName && TRACK_SHAPES[trackName]) || TRACK_PATH;     // selected real circuit, else Barcelona fallback
  const cl = buildCenterline(splinePath(path));         // Catmull-Rom-smoothed: soft corners, no per-vertex snapping
  const b = bounds(cl);
  const sc = WORLD / b.size;                       // normalized -> world scale
  const wx = (p) => (p[0] - b.cx) * sc;            // center the track at world origin
  const wz = (p) => (p[1] - b.cy) * sc;
  const mats = [];                                 // every runtime material, freed in dispose()
  const geos = [];                                 // every runtime geometry, freed in dispose()
  const texs = [];                                 // every runtime texture, freed in dispose()
  const HW_N = HALF_W / sc;                          // half-width in normalized units
  const LANE_LAT = HW_N * 0.45, SIDE_LAT = HW_N * 0.34;   // racing-line + side-step lateral range (kept on asphalt)

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


  // --- painted track surface: ONE flat plane with a procedurally-painted CanvasTexture. The road,
  // kerbs and run-off are smooth round-joined strokes, so corners can NEVER spike/fold/facet — even
  // hairpins (overlapping paint is fine). Replaces the extruded ribbon/kerb/line meshes. The quad's
  // UVs match the C() world->canvas mapping, so the painted road sits exactly under the cars. ---
  {
    const SIZE = 2048, HALF = WORLD * 0.72, PXW = SIZE / (2 * HALF), STEPS = 600;   // canvas px; plane half-extent (world); px/world; lap samples
    const cv = document.createElement("canvas"); cv.width = cv.height = SIZE;
    const g = cv.getContext("2d"); g.lineJoin = "round"; g.lineCap = "round";
    const C = (p) => [(wx(p) + HALF) * PXW, (wz(p) + HALF) * PXW];                  // normalized track point -> canvas px
    const lap = (offN) => { g.beginPath(); for (let k = 0; k <= STEPS; k++) { const f = k / STEPS, pp = offN ? offsetPoint(cl, f, offN) : pointAt(cl, f), c = C(pp); k ? g.lineTo(c[0], c[1]) : g.moveTo(c[0], c[1]); } g.closePath(); };
    g.fillStyle = "#2f5236"; g.fillRect(0, 0, SIZE, SIZE);                          // grass (brighter for contrast)
    lap(0); g.lineWidth = (HALF_W * 2 + 9) * PXW; g.strokeStyle = "#3a5a38"; g.stroke();    // run-off shoulder (subtle, lighter green)
    lap(0); g.lineWidth = (HALF_W * 2 + 0.8) * PXW; g.strokeStyle = "#5a5a64"; g.stroke();  // thin subtle road edge
    {                                                                              // red/white kerb RIM along the CENTERLINE through corners — wider than the asphalt, so a clean even
      const runs = cornerRuns(cl, STEPS, CORNER_R), CH = 7, KW = (HALF_W * 2 + 2.6) * PXW;  // rim peeks out BOTH edges. centerline is smooth -> no folding-offset-edge mess, no overlapping chunks.
      for (const run of runs) for (let s = 0; s < run.len; s += CH) {
        g.beginPath();
        for (let j = 0; j <= CH && s + j <= run.len; j++) { const k = (run.start + s + j) % STEPS, c = C(pointAt(cl, k / STEPS)); j ? g.lineTo(c[0], c[1]) : g.moveTo(c[0], c[1]); }
        g.lineWidth = KW; g.strokeStyle = (Math.floor(s / CH) % 2) ? "#d83b3b" : "#ededed"; g.stroke();
      }
    }
    lap(0); g.lineWidth = HALF_W * 2 * PXW; g.strokeStyle = "#30303a"; g.stroke();          // asphalt on top -> the kerb rim peeks out ~1.3 world each side at corners
    { const t = tangentAt(cl, 0), nx = -t[1], ny = t[0], p = pointAt(cl, 0);       // start/finish stripe
      const A = C([p[0] + nx * HW_N, p[1] + ny * HW_N]), B = C([p[0] - nx * HW_N, p[1] - ny * HW_N]);
      g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.lineWidth = 1.6 * PXW; g.strokeStyle = "#ffffff"; g.stroke(); }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.anisotropy = 8; texs.push(tex);
    const pg = new THREE.BufferGeometry(); geos.push(pg);
    pg.setAttribute("position", new THREE.Float32BufferAttribute([-HALF, 0, -HALF, HALF, 0, -HALF, HALF, 0, HALF, -HALF, 0, HALF], 3));
    pg.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    pg.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    pg.setIndex([0, 1, 2, 0, 2, 3]);
    const pm = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0, side: THREE.DoubleSide }); mats.push(pm);   // camera is always above; DoubleSide so the down-facing quad still renders
    const pmesh = new THREE.Mesh(pg, pm); pmesh.receiveShadow = true; scene.add(pmesh);
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
      const maxLat = Math.max(0, HW_N - CAR_HALF * HW_N);        // keep the car body on the painted constant-width road
      car.lat = Math.max(-maxLat, Math.min(maxLat, car.lat));
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
    updateCam();
    if (composer) composer.render(); else renderer.render(scene, cam);
  }
  frame();

  return { dispose };
}
