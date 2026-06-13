// ApexWeb/src/ui/race3d.js — 3D orbital race view. Pure render layer over the sim:
// reads the SAME ctx._buf / ctx._meta snapshot buffers race.js maintains. No sim/netcode
// coupling. WebGL -> owner-playtest verified. Self-disposes when its canvas leaves the DOM.
import * as THREE from "https://esm.sh/three@0.160.0";
import { TRACK_PATH } from "../data.js";
import { buildCenterline, pointAt, tangentAt, bounds, ribbonEdges, sampleProg } from "../geom3d.js";

const WORLD = 120;                 // larger track axis spans ~120 world units
const HALF_W = 2.0;                // track half-width (world units)
const CAR_L = 2.8, CAR_W = 1.2, CAR_H = 0.7;
const DELAY = 120;                 // render this many ms behind the newest snapshot
const SECTOR_COL = [0x5aa0ff, 0xffce47, 0x46d08a];
const ASPHALT = 0x2c2c33, ASPHALT_SC = 0x4a4626;
const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function init(canvas, ctx) {
  const cl = buildCenterline(TRACK_PATH);
  const b = bounds(cl);
  const sc = WORLD / b.size;                       // normalized -> world scale
  const wx = (p) => (p[0] - b.cx) * sc;            // center the track at world origin
  const wz = (p) => (p[1] - b.cy) * sc;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(0x0a0a0c, 1);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(45, 1, 0.1, WORLD * 8);

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 0.8);
  key.position.set(WORLD, WORLD * 1.4, WORLD * 0.5); scene.add(key);

  // --- track ribbon: a triangle strip between the left/right edges ---
  const STEPS = 320;
  const { left, right } = ribbonEdges(cl, HALF_W / sc, STEPS);   // edges in normalized space
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
  const trackGeo = new THREE.BufferGeometry();
  trackGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  trackGeo.setIndex(index); trackGeo.computeVertexNormals();
  const trackMat = new THREE.MeshStandardMaterial({ color: ASPHALT, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  scene.add(new THREE.Mesh(trackGeo, trackMat));

  // sector tint lines just above the asphalt
  const lineGeos = [];
  for (let s = 0; s < 3; s++) {
    const v = [], lo = s / 3, hi = (s + 1) / 3;
    for (let k = 0; k <= 48; k++) { const p = pointAt(cl, lo + (hi - lo) * (k / 48)); v.push(new THREE.Vector3(wx(p), 0.05, wz(p))); }
    const lg = new THREE.BufferGeometry().setFromPoints(v); lineGeos.push(lg);
    scene.add(new THREE.Line(lg, new THREE.LineBasicMaterial({ color: SECTOR_COL[s] })));
  }
  // start/finish line across the track at frac 0
  {
    const p = pointAt(cl, 0), t = tangentAt(cl, 0), nx = -t[1], ny = t[0], hw = HALF_W / sc;
    const a = [p[0] + nx * hw, p[1] + ny * hw], c = [p[0] - nx * hw, p[1] - ny * hw];
    const sg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(wx(a), 0.06, wz(a)), new THREE.Vector3(wx(c), 0.06, wz(c))]);
    lineGeos.push(sg);
    scene.add(new THREE.Line(sg, new THREE.LineBasicMaterial({ color: 0xffffff })));
  }

  // --- cars: one Group per snapshot car, colored by team ---
  const carGeo = new THREE.BoxGeometry(CAR_W, CAR_H, CAR_L);
  const cockGeo = new THREE.BoxGeometry(CAR_W * 0.6, CAR_H * 0.7, CAR_L * 0.4);
  const ringGeo = new THREE.RingGeometry(CAR_L * 0.85, CAR_L * 1.05, 24);
  const cars = {};   // idx -> { group, ring }
  for (const c of ((ctx.snapshot && ctx.snapshot.cars) || [])) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(carGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color(c.color || "#888888"), roughness: 0.5 }));
    body.position.y = CAR_H / 2; g.add(body);
    const cock = new THREE.Mesh(cockGeo, new THREE.MeshStandardMaterial({ color: 0x101014 }));
    cock.position.set(0, CAR_H * 0.95, -CAR_L * 0.05); g.add(cock);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.09; g.add(ring);
    cars[c.idx] = { group: g, ring }; scene.add(g);
  }
  // pit-lane parking spot: start/finish, offset outward by ~2.4 half-widths
  const pitN = tangentAt(cl, 0), pitP = pointAt(cl, 0);
  const PIT = [pitP[0] + (-pitN[1]) * (2.4 * HALF_W / sc), pitP[1] + pitN[0] * (2.4 * HALF_W / sc)];

  // --- orbital camera (track centered at origin) + drag-to-orbit ---
  let azim = -35 * Math.PI / 180, elev = 42 * Math.PI / 180, dist = b.size * 1.6 * sc;
  const target = new THREE.Vector3(0, 0, 0);
  function placeCam() {
    const horiz = Math.cos(elev) * dist;
    cam.position.set(target.x + Math.sin(azim) * horiz, Math.sin(elev) * dist, target.z + Math.cos(azim) * horiz);
    cam.lookAt(target);
  }
  let drag = null;
  const onDown = (e) => { drag = { x: e.clientX, y: e.clientY }; };
  const onUp = () => { drag = null; };
  const onMove = (e) => {
    if (!drag) return;
    azim -= (e.clientX - drag.x) * 0.01;
    elev = Math.min(1.45, Math.max(0.2, elev - (e.clientY - drag.y) * 0.01));
    drag = { x: e.clientX, y: e.clientY }; placeCam();
  };
  canvas.addEventListener("mousedown", onDown);
  window.addEventListener("mouseup", onUp);
  window.addEventListener("mousemove", onMove);

  function resize() {
    const w = canvas.clientWidth || 360, h = Math.max(240, Math.round(w * 0.72));
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    cam.aspect = w / h; cam.updateProjectionMatrix();
  }
  resize(); window.addEventListener("resize", resize); placeCam();

  let raf = 0, alive = true;
  function dispose() {
    if (!alive) return; alive = false;
    cancelAnimationFrame(raf);
    canvas.removeEventListener("mousedown", onDown);
    window.removeEventListener("mouseup", onUp);
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("resize", resize);
    trackGeo.dispose(); for (const g of lineGeos) g.dispose();
    carGeo.dispose(); cockGeo.dispose(); ringGeo.dispose();
    renderer.dispose();
  }
  function frame() {
    if (!canvas.isConnected) return dispose();   // screen changed -> self-teardown
    raf = requestAnimationFrame(frame);
    const rt = nowMs() - DELAY;
    const meta = ctx._meta || {}, buf = ctx._buf || {};
    for (const id in cars) {
      const car = cars[id], m = meta[id];
      if (!m) { car.group.visible = false; continue; }
      if (m.retired) { car.group.visible = false; continue; }
      car.group.visible = true;
      if (m.inPit) {
        car.group.position.set(wx(PIT), 0, wz(PIT));
        car.ring.material.opacity = 0;
        continue;
      }
      const prog = sampleProg(buf[id], rt);
      const p = pointAt(cl, prog), t = tangentAt(cl, prog);
      car.group.position.set(wx(p), 0, wz(p));
      car.group.rotation.y = Math.atan2(t[0], t[1]);     // local +Z faces the tangent
      const hi = m.player || m.isLeader;
      car.ring.material.opacity = hi ? 1 : 0;
      car.ring.material.color.set(m.isLeader ? 0xffd000 : 0xffffff);
    }
    trackMat.color.set(ctx.snapshot && ctx.snapshot.scActive ? ASPHALT_SC : ASPHALT);
    renderer.render(scene, cam);
  }
  frame();

  return { dispose };
}
