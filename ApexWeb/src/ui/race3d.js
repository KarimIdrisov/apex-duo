// ApexWeb/src/ui/race3d.js — 3D race view. Pure render layer over the sim: reads the SAME
// ctx._buf snapshot buffers + ctx.snapshot.cars that race.js maintains. No sim/netcode coupling.
// WebGL via THREE (CDN). Self-disposes when its canvas leaves the DOM. Cars ride an inside-hugging
// racing line and side-step when they catch the car ahead. This file builds a broadcast-grade scene:
// a painted track with raised 3D kerbs, procedural trackside scenery (grandstands+crowd, tyre
// barriers, hoardings, trees, marshal posts, a start/finish gantry), upgraded F1 car models with a
// halo, and an auto-directing TV camera (orbit / chase / tv). All scenery is deterministic from the
// track name (scenery.js), and every runtime geometry/material/texture is tracked + freed in dispose().
import * as THREE from "https://esm.sh/three@0.160.0";
import { TRACK_PATH } from "../data.js";
import { buildCenterline, pointAt, tangentAt, bounds, sampleProg, racingLineOffset, offsetPoint, splinePath, buildSpeedWarp, sampleWarp, cornerRuns } from "../geom3d.js";
import { TRACK_SHAPES } from "../track_shapes.js";
import { paintTrack } from "../track_paint.js";
import { effectiveTrack } from "../track_store.js";
import { pitLaneSample, advancePitPhase } from "../pitlane.js";
import { planScenery, hashSeed, mulberry } from "../scenery.js";

const WORLD = 175;                 // larger track axis spans ~175 world units — a grander circuit; cars read smaller
const HALF_W = 4.7;                // track half-width (world units) — wider so the cars sit on the road with room
const CAR_L = 2.8;                  // overall car length (used for the highlight ring radius)
const DELAY = 120;                 // render this many ms behind the newest snapshot
const POS_EASE = 0.5;              // low-pass the rendered car position (higher = less corner-cut lag)
const CLOSE_PROG = 0.012;          // gap (lap-fractions) under which a follower side-steps to pass
const CAR_HALF = 0.30;             // car half-width as a fraction of the track half-width
const ASPHALT = 0x2c2c33;
// tyre sidewall colour per compound (real F1 marking) — drawn as a band on each wheel, live-updated
const COMPOUND_COL = { soft: 0xe8002d, medium: 0xf6c915, hard: 0xededed, inter: 0x3fab5a, intermediate: 0x3fab5a, wet: 0x2d7dd2, _default: 0x6a6a72 };
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
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// crowd texture for grandstand faces: dense bright speckles (spectators) on a dark stand base.
function crowdTex(rndSeed) {
  const n = 128, c = document.createElement("canvas"); c.width = c.height = n;
  const x = c.getContext("2d");
  const rnd = mulberry(rndSeed >>> 0 || 7);
  x.fillStyle = "#1b1d24"; x.fillRect(0, 0, n, n);
  // horizontal seating rows
  for (let row = 4; row < n; row += 7) { x.fillStyle = "#11131a"; x.fillRect(0, row, n, 2); }
  const cols = ["#e8e8ee", "#d9534f", "#5aa0ff", "#ffce47", "#46d08a", "#f0f0f0", "#e07a1a", "#b06fd0"];
  for (let i = 0; i < n * n * 0.20; i++) {
    x.fillStyle = cols[(rnd() * cols.length) | 0];
    const px = (rnd() * n) | 0, py = ((((rnd() * n) | 0) / 7) | 0) * 7 + 1;
    x.fillRect(px, py, 2, 2);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// advertising-board texture: blocky colour bands + a faux wordmark (no real brands).
function adTex(rndSeed) {
  const w = 256, h = 64, c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d"); const rnd = mulberry(rndSeed >>> 0 || 3);
  const bands = ["#0e7a5f", "#1f4e8c", "#b23a48", "#c9a227", "#2a2d36", "#d05a1a"];
  let px = 0;
  while (px < w) { const bw = 30 + (rnd() * 50 | 0); x.fillStyle = bands[(rnd() * bands.length) | 0]; x.fillRect(px, 0, bw, h); px += bw; }
  x.fillStyle = "rgba(255,255,255,.92)"; x.font = "bold 30px sans-serif"; x.textBaseline = "middle";
  const words = ["APEX", "DUO", "PISTA", "VELOCE", "TURBO", "GRID", "PADDOCK"];
  x.fillText(words[(rnd() * words.length) | 0] + " " + words[(rnd() * words.length) | 0], 10, h / 2 + 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// soft radial blob for wheel spray / mist (alpha falls off to transparent at the edge).
function sprayTex() {
  const n = 64, c = document.createElement("canvas"); c.width = c.height = n;
  const x = c.getContext("2d");
  const g = x.createRadialGradient(n / 2, n / 2, 2, n / 2, n / 2, n / 2);
  g.addColorStop(0, "rgba(222,230,240,.55)"); g.addColorStop(1, "rgba(222,230,240,0)");
  x.fillStyle = g; x.fillRect(0, 0, n, n);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// rounded-rect path helper for the 2D canvas (MM-style driver tags)
function roundRect(x, X, y, w, h, r) { x.beginPath(); x.moveTo(X + r, y); x.arcTo(X + w, y, X + w, y + h, r); x.arcTo(X + w, y + h, X, y + h, r); x.arcTo(X, y + h, X, y, r); x.arcTo(X, y, X + w, y, r); x.closePath(); }

// draw a floating driver tag ("P3 NOR") into an existing canvas: team-colour pill + readable text.
function drawTag(cv, x, pos, abbrev, hex) {
  const w = cv.width, h = cv.height; x.clearRect(0, 0, w, h);
  const col = new THREE.Color(hex), lum = 0.299 * col.r + 0.587 * col.g + 0.114 * col.b;
  const txt = lum > 0.55 ? "#10131a" : "#ffffff";
  roundRect(x, 6, 8, w - 12, h - 16, 18); x.fillStyle = hex; x.fill();
  x.lineWidth = 5; x.strokeStyle = "rgba(0,0,0,.45)"; x.stroke();
  x.fillStyle = txt; x.textBaseline = "middle"; x.textAlign = "left";
  x.font = "bold 38px sans-serif"; x.fillText("P" + (pos || "-"), 26, h / 2 + 1);
  x.font = "bold 44px sans-serif"; x.fillText(String(abbrev || "").toUpperCase(), 112, h / 2 + 1);
}

export function init(canvas, ctx) {
  const trackName = (ctx.snapshot && ctx.snapshot.trackName) || null;
  const edited = (ctx.snapshot && ctx.snapshot.points)
    ? { points: ctx.snapshot.points, objects: ctx.snapshot.objects || [] }
    : effectiveTrack(trackName, (trackName && TRACK_SHAPES[trackName]) || TRACK_PATH);
  const pitLane = (edited.pitLane) || { entry: 0.95, exit: 0.06, side: 1, width: 2.5 };
  const cl = buildCenterline(splinePath(edited.points));
  const b = bounds(cl);
  const speedWarp = buildSpeedWarp(cl);
  const sc = WORLD / b.size;
  const wx = (p) => (p[0] - b.cx) * sc;
  const wz = (p) => (p[1] - b.cy) * sc;
  const W = (p, y = 0) => new THREE.Vector3(wx(p), y, wz(p));
  const mats = [], geos = [], texs = [];
  const HW_N = HALF_W / sc;
  const LANE_LAT = HW_N * 0.45, SIDE_LAT = HW_N * 0.22;
  const sceneSeed = hashSeed(trackName || "apex");
  let roadMat = null;                                         // hoisted so the weather pass can wet the road live
  const FOG_DRY = new THREE.Color(0x4a5a72), FOG_WET = new THREE.Color(0x5b6470);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(0x0a0a0c, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.36;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x4a5a72, WORLD * 2.4, WORLD * 5.6);   // light aerial haze pushed back so the track stays clear
  const cam = new THREE.PerspectiveCamera(42, 1, 0.1, WORLD * 9);

  // subtle bloom via the post-composer (add-ons loaded lazily); on any failure composer stays null
  // and the frame loop falls back to a plain renderer.render (no bloom).
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
    bloomPass = new ub.UnrealBloomPass(new THREE.Vector2(w, h), 0.30, 0.7, 0.85);
    cm.addPass(bloomPass);
    cm.addPass(new op.OutputPass());
    cm.setSize(w, h);
    if (alive) composer = cm; else { cm.dispose(); bloomPass.dispose(); }
  }).catch(() => { composer = null; });

  // --- lighting: warm key sun + cool sky/ground fill, low golden-hour angle for long shadows ---
  scene.add(new THREE.AmbientLight(0xffffff, 0.74));
  scene.add(new THREE.HemisphereLight(0xc6dcff, 0x40512f, 0.86));
  const key = new THREE.DirectionalLight(0xfff3e0, 1.45);
  key.position.set(WORLD * 0.5, WORLD * 1.75, -WORLD * 0.35); scene.add(key);   // higher sun -> shorter, cleaner shadows
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);                                            // crisper shadows (no blocky blobs)
  const shCam = key.shadow.camera;
  shCam.near = WORLD * 0.3; shCam.far = WORLD * 3.5;
  shCam.left = -WORLD * 0.78; shCam.right = WORLD * 0.78; shCam.top = WORLD * 0.78; shCam.bottom = -WORLD * 0.78;
  shCam.updateProjectionMatrix();
  key.shadow.bias = -0.0002; key.shadow.normalBias = 0.03;
  const rim = new THREE.DirectionalLight(0x9fc0ff, 0.25); rim.position.set(-WORLD, WORLD * 0.5, WORLD); scene.add(rim);

  // gradient sky dome (vertex-coloured, seen from inside)
  const skyGeo = new THREE.SphereGeometry(WORLD * 6, 24, 14); geos.push(skyGeo);
  {
    const sp = skyGeo.attributes.position, col = [], R = WORLD * 6;
    const top = new THREE.Color(0x16243f), bot = new THREE.Color(0x6a7c96);
    for (let i = 0; i < sp.count; i++) {
      const f = Math.max(0, Math.min(1, sp.getY(i) / R * 0.55 + 0.5)), c = bot.clone().lerp(top, f);
      col.push(c.r, c.g, c.b);
    }
    skyGeo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  }
  const skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }); mats.push(skyMat);
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  // grass ground plane under everything
  const grassGeo = new THREE.PlaneGeometry(WORLD * 4, WORLD * 4); geos.push(grassGeo);
  const grassMap = noiseTex("#33583b", ["#284a30", "#3c6848", "#244229", "#447552"], 128, 0.16); grassMap.repeat.set(14, 14); texs.push(grassMap);
  const grassMat = new THREE.MeshStandardMaterial({ map: grassMap, roughness: 1, metalness: 0 }); mats.push(grassMat);
  const grass = new THREE.Mesh(grassGeo, grassMat); grass.rotation.x = -Math.PI / 2; grass.position.y = -0.15; grass.receiveShadow = true; scene.add(grass);

  // --- painted track surface: ONE flat plane with a procedurally-painted CanvasTexture (road, kerb
  // rim, gravel/run-off, start line). Round-joined strokes can never spike/fold at corners. ---
  {
    const SIZE = 2048, HALF = WORLD * 0.72, PXW = SIZE / (2 * HALF);
    const cv = document.createElement("canvas"); cv.width = cv.height = SIZE;
    const g = cv.getContext("2d");
    const C = (p) => [(wx(p) + HALF) * PXW, (wz(p) + HALF) * PXW];
    paintTrack(g, cl, C, PXW, HALF_W);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.anisotropy = 8; texs.push(tex);
    const pg = new THREE.BufferGeometry(); geos.push(pg);
    pg.setAttribute("position", new THREE.Float32BufferAttribute([-HALF, 0, -HALF, HALF, 0, -HALF, HALF, 0, HALF, -HALF, 0, HALF], 3));
    pg.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    pg.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    pg.setIndex([0, 1, 2, 0, 2, 3]);
    const pm = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }); mats.push(pm); roadMat = pm;
    const pmesh = new THREE.Mesh(pg, pm); pmesh.position.y = 0.01; pmesh.receiveShadow = true; scene.add(pmesh);
  }

  // --- raised 3D kerbs along the OUTSIDE+INSIDE edges of every corner (red/white striped boxes).
  // Built as two InstancedMeshes (one per stripe colour) for a cheap draw. Cars clip them gently. ---
  {
    const STEPS = 600, KSTEP = 5, KH = 0.18, KWi = HALF_W * 0.42, KLen = (cl.total / STEPS) * sc * KSTEP * 1.25 || 1.4;
    const seg = new THREE.BoxGeometry(KWi, KH, KLen); geos.push(seg);
    const redM = new THREE.MeshStandardMaterial({ color: 0xcf2b2b, roughness: 0.7 }); mats.push(redM);
    const whiteM = new THREE.MeshStandardMaterial({ color: 0xe9e9ee, roughness: 0.7 }); mats.push(whiteM);
    const reds = [], whites = [];
    const runs = cornerRuns(cl, STEPS, 0.10);
    const tmp = new THREE.Object3D();
    for (const run of runs) {
      for (let s = 0; s < run.len; s += KSTEP) {
        const f = ((run.start + s) % STEPS) / STEPS;
        const t = tangentAt(cl, f);
        const rotY = Math.atan2(t[0], t[1]);
        for (const sgn of [1, -1]) {
          const p = offsetPoint(cl, f, sgn * (HW_N * 0.98));
          tmp.position.set(wx(p), KH / 2 + 0.01, wz(p));
          tmp.rotation.set(0, rotY, 0);
          tmp.updateMatrix();
          ((Math.floor(s / KSTEP) % 2) ? reds : whites).push(tmp.matrix.clone());
        }
      }
    }
    for (const [list, mat] of [[reds, redM], [whites, whiteM]]) {
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(seg, mat, list.length);
      im.castShadow = true; im.receiveShadow = true;
      for (let i = 0; i < list.length; i++) im.setMatrixAt(i, list[i]);
      im.instanceMatrix.needsUpdate = true; scene.add(im);
    }
  }

  // --- procedural trackside scenery (deterministic from the track name) ---
  const plan = planScenery(cl, trackName || "apex");

  // instanced-mesh builder from a list of {pos:Vector3, rotY, scale}
  function instanced(geo, mat, items, { shadow = true } = {}) {
    if (!items.length) return;
    geos.push(geo); mats.push(mat);
    const im = new THREE.InstancedMesh(geo, mat, items.length);
    im.castShadow = shadow; im.receiveShadow = shadow;
    const tmp = new THREE.Object3D();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      tmp.position.copy(it.pos); tmp.rotation.set(0, it.rotY || 0, 0);
      const s = it.scale || 1; tmp.scale.set(s, it.scaleY || s, s); tmp.updateMatrix();
      im.setMatrixAt(i, tmp.matrix);
    }
    im.instanceMatrix.needsUpdate = true; scene.add(im); return im;
  }

  // tyre barriers along corner outsides — stacked dark tyres (instanced cylinders) + a faint base
  {
    const items = plan.barriers.map((bd) => {
      const p = offsetPoint(cl, bd.frac, bd.side * (HW_N * 1.42)); const t = tangentAt(cl, bd.frac);
      return { pos: new THREE.Vector3(wx(p), 0.45, wz(p)), rotY: Math.atan2(t[0], t[1]), scale: 1 };
    });
    instanced(new THREE.CylinderGeometry(0.55, 0.55, 0.9, 12), new THREE.MeshStandardMaterial({ color: 0x17171c, roughness: 0.95 }), items);
  }

  // advertising hoardings lining the straights (instanced thin boards, one shared ad texture)
  {
    const adMap = adTex(sceneSeed ^ 0x9e3779b9); texs.push(adMap);
    const items = plan.hoardings.map((hd) => {
      const p = offsetPoint(cl, hd.frac, hd.side * (HW_N * 1.25)); const t = tangentAt(cl, hd.frac);
      return { pos: new THREE.Vector3(wx(p), 0.85, wz(p)), rotY: Math.atan2(t[0], t[1]), scale: 1 };
    });
    instanced(new THREE.BoxGeometry(5.2, 1.4, 0.18), new THREE.MeshStandardMaterial({ map: adMap, roughness: 0.8 }), items, { shadow: false });
  }

  // marshal posts at corner entries (instanced small white box with an orange roof = two meshes)
  {
    const base = plan.marshals.map((md) => {
      const p = offsetPoint(cl, md.frac, md.side * (HW_N * 1.9)); const t = tangentAt(cl, md.frac);
      return { pos: new THREE.Vector3(wx(p), 0.9, wz(p)), rotY: Math.atan2(t[0], t[1]), scale: 1 };
    });
    instanced(new THREE.BoxGeometry(1.6, 1.8, 1.2), new THREE.MeshStandardMaterial({ color: 0xdfe2e8, roughness: 0.9 }), base);
    instanced(new THREE.BoxGeometry(1.9, 0.35, 1.5), new THREE.MeshStandardMaterial({ color: 0xe07a1a, roughness: 0.8 }),
      base.map((it) => ({ pos: new THREE.Vector3(it.pos.x, 1.95, it.pos.z), rotY: it.rotY })), { shadow: false });
  }

  // background trees — instanced cones (foliage) + trunks
  {
    const rnd = mulberry(sceneSeed);
    const foliage = [], trunks = [];
    for (const tr of plan.trees) {
      const p = offsetPoint(cl, tr.frac, tr.side * (HW_N * (2.4 + tr.dist)));
      const x = wx(p), z = wz(p), s = tr.scale;
      foliage.push({ pos: new THREE.Vector3(x, 3.2 * s, z), scale: s, scaleY: s * (0.9 + rnd() * 0.5) });
      trunks.push({ pos: new THREE.Vector3(x, 1.0 * s, z), scale: s });
    }
    instanced(new THREE.ConeGeometry(1.7, 4.4, 8), new THREE.MeshStandardMaterial({ color: 0x2c6e36, roughness: 1 }), foliage);
    instanced(new THREE.CylinderGeometry(0.28, 0.34, 2.0, 6), new THREE.MeshStandardMaterial({ color: 0x4a3526, roughness: 1 }), trunks, { shadow: false });
  }

  // grandstands — a sloped structure + a crowd-textured seating face, one per planned bay
  {
    const cMap = crowdTex(sceneSeed); texs.push(cMap);
    const standMat = new THREE.MeshStandardMaterial({ color: 0x474c57, roughness: 1 }); mats.push(standMat);
    const crowdMat = new THREE.MeshStandardMaterial({ map: cMap, roughness: 1 }); mats.push(crowdMat);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xced2da, roughness: 0.85, metalness: 0.1 }); mats.push(roofMat);
    const structGeo = new THREE.BoxGeometry(9, 4.2, 6); geos.push(structGeo);
    const faceGeo = new THREE.PlaneGeometry(8.6, 6.4); geos.push(faceGeo);
    const roofGeo = new THREE.BoxGeometry(9.6, 0.3, 6.6); geos.push(roofGeo);
    for (const gs of plan.grandstands) {
      const p = offsetPoint(cl, gs.frac, gs.side * (HW_N * 3.1)); const t = tangentAt(cl, gs.frac);
      const X = wx(p), Z = wz(p), rotY = Math.atan2(t[0], t[1]);
      const toTrack = new THREE.Vector3(-(X), 0, -(Z)).normalize();        // rough inward dir (track centred at origin)
      const struct = new THREE.Mesh(structGeo, standMat); struct.position.set(X, 2.1, Z); struct.rotation.y = rotY; struct.castShadow = true; struct.receiveShadow = true; scene.add(struct);
      const roof = new THREE.Mesh(roofGeo, roofMat); roof.position.set(X + toTrack.x * 0.6, 4.5, Z + toTrack.z * 0.6); roof.rotation.y = rotY; roof.castShadow = true; scene.add(roof);
      const face = new THREE.Mesh(faceGeo, crowdMat);
      face.position.set(X + toTrack.x * 3.05, 2.4, Z + toTrack.z * 3.05);
      face.rotation.y = rotY; face.rotation.x = -0.62;                     // tilt the seating toward the track
      // make the crowd face look at the track centre on the horizontal
      face.lookAt(0, 2.4, 0); face.rotateX(-0.5);
      scene.add(face);
    }
  }

  // start/finish gantry straddling the road at frac 0 (two posts + a top beam)
  {
    const t0 = tangentAt(cl, 0), p0 = pointAt(cl, 0), rotY = Math.atan2(t0[0], t0[1]);
    const postGeo = new THREE.BoxGeometry(0.5, 6, 0.5); geos.push(postGeo);
    const beamGeo = new THREE.BoxGeometry(HALF_W * 2.4, 0.7, 0.6); geos.push(beamGeo);
    const gMat = new THREE.MeshStandardMaterial({ color: 0x20222a, roughness: 0.8, metalness: 0.2 }); mats.push(gMat);
    for (const sgn of [1, -1]) {
      const pp = offsetPoint(cl, 0, sgn * (HW_N * 1.05));
      const post = new THREE.Mesh(postGeo, gMat); post.position.set(wx(pp), 3, wz(pp)); post.rotation.y = rotY; post.castShadow = true; scene.add(post);
    }
    const beam = new THREE.Mesh(beamGeo, gMat); beam.position.set(wx(p0), 6, wz(p0)); beam.rotation.y = rotY; beam.castShadow = true; scene.add(beam);
  }

  // --- lived-in start/finish: a pit building (garages) on the pit side + packed grandstands opposite ---
  {
    const t0 = tangentAt(cl, 0), rotY = Math.atan2(t0[0], t0[1]);
    const pside = (pitLane.side || 1);
    const pbMat = new THREE.MeshStandardMaterial({ color: 0x5b626d, roughness: 0.85 }); mats.push(pbMat);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xc2c9d4, roughness: 0.7, metalness: 0.15 }); mats.push(roofMat);
    const garMat = new THREE.MeshStandardMaterial({ color: 0x23252d, roughness: 0.8 }); 