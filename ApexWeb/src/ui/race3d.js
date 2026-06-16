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
    const garMat = new THREE.MeshStandardMaterial({ color: 0x23252d, roughness: 0.8 }); mats.push(garMat);
    const pbGeo = new THREE.BoxGeometry(7, 5, 30); geos.push(pbGeo);
    const pbRoofGeo = new THREE.BoxGeometry(8.4, 0.5, 31); geos.push(pbRoofGeo);
    const garGeo = new THREE.BoxGeometry(0.5, 3, 28); geos.push(garGeo);
    const bp = offsetPoint(cl, 0, pside * (HW_N * 2.3)), bx = wx(bp), bz = wz(bp);
    const toTrk = new THREE.Vector3(-bx, 0, -bz).normalize();
    const pb = new THREE.Mesh(pbGeo, pbMat); pb.position.set(bx, 2.5, bz); pb.rotation.y = rotY; pb.castShadow = true; pb.receiveShadow = true; scene.add(pb);
    const pbRoof = new THREE.Mesh(pbRoofGeo, roofMat); pbRoof.position.set(bx, 5.1, bz); pbRoof.rotation.y = rotY; pbRoof.castShadow = true; scene.add(pbRoof);
    const gar = new THREE.Mesh(garGeo, garMat); gar.position.set(bx + toTrk.x * 3.5, 1.6, bz + toTrk.z * 3.5); gar.rotation.y = rotY; scene.add(gar);
    // packed main grandstands opposite the pits
    const cMap2 = crowdTex(sceneSeed ^ 0x55aa); texs.push(cMap2);
    const stMat = new THREE.MeshStandardMaterial({ color: 0x474c57, roughness: 1 }); mats.push(stMat);
    const cwMat = new THREE.MeshStandardMaterial({ map: cMap2, roughness: 1 }); mats.push(cwMat);
    const stGeo = new THREE.BoxGeometry(9, 5, 7); geos.push(stGeo);
    const stRoofGeo = new THREE.BoxGeometry(9.6, 0.35, 7.6); geos.push(stRoofGeo);
    const cwGeo = new THREE.PlaneGeometry(8.6, 6.6); geos.push(cwGeo);
    for (const fr of [-0.03, 0, 0.03]) {
      const sp = offsetPoint(cl, fr, -pside * (HW_N * 3.0)); const tt = tangentAt(cl, fr);
      const X = wx(sp), Z = wz(sp), ry = Math.atan2(tt[0], tt[1]);
      const inw = new THREE.Vector3(-X, 0, -Z).normalize();
      const st = new THREE.Mesh(stGeo, stMat); st.position.set(X, 2.5, Z); st.rotation.y = ry; st.castShadow = true; st.receiveShadow = true; scene.add(st);
      const rf = new THREE.Mesh(stRoofGeo, roofMat); rf.position.set(X + inw.x * 0.7, 5.0, Z + inw.z * 0.7); rf.rotation.y = ry; rf.castShadow = true; scene.add(rf);
      const cw = new THREE.Mesh(cwGeo, cwMat); cw.position.set(X + inw.x * 3.2, 2.8, Z + inw.z * 3.2); cw.lookAt(0, 2.8, 0); cw.rotateX(-0.5); scene.add(cw);
    }
  }

  // editor-placed decorations (render-only)
  for (const ob of edited.objects) {
    const P = [ob.x, ob.y], X = wx(P), Z = wz(P); let mesh;
    if (ob.type === "stand") { const go = new THREE.BoxGeometry(9, 2.2, 3); geos.push(go); const ma = new THREE.MeshStandardMaterial({ color: 0x9aa0aa, roughness: 1 }); mats.push(ma); mesh = new THREE.Mesh(go, ma); mesh.position.set(X, 1.1, Z); mesh.rotation.y = ob.rot || 0; mesh.castShadow = true; }
    else if (ob.type === "banner") { const go = new THREE.PlaneGeometry(7, 2); geos.push(go); const ma = new THREE.MeshStandardMaterial({ color: 0x3d7aa0, roughness: 1, side: THREE.DoubleSide }); mats.push(ma); mesh = new THREE.Mesh(go, ma); mesh.position.set(X, 1, Z); mesh.rotation.y = ob.rot || 0; }
    else if (ob.type === "tree") { const go = new THREE.ConeGeometry(1.6, 4, 7); geos.push(go); const ma = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 1 }); mats.push(ma); mesh = new THREE.Mesh(go, ma); mesh.position.set(X, 2, Z); mesh.castShadow = true; }
    else { const go = new THREE.ConeGeometry(0.6, 1.4, 10); geos.push(go); const ma = new THREE.MeshStandardMaterial({ color: 0xe07a1a, roughness: 1 }); mats.push(ma); mesh = new THREE.Mesh(go, ma); mesh.position.set(X, 0.7, Z); }
    scene.add(mesh);
  }

  // --- cars: an upgraded low-poly F1 silhouette (nose, sidepods, airbox, wings, halo, helmet, tyres).
  // Geometry is shared across all 22 cars (nose points +Z = direction of travel); body material is
  // per-team colour with a slight sheen. ---
  const floorGeo = new THREE.BoxGeometry(1.05, 0.05, 3.0); geos.push(floorGeo);             // floor plank
  const bodyGeo = new THREE.CapsuleGeometry(0.26, 1.55, 5, 16); geos.push(bodyGeo);         // rounded monocoque
  const engGeo = new THREE.CapsuleGeometry(0.22, 0.7, 4, 14); geos.push(engGeo);            // engine cover
  const noseGeo = new THREE.ConeGeometry(0.17, 1.5, 18); geos.push(noseGeo);                // tapered nose cone
  const podGeo = new THREE.CapsuleGeometry(0.18, 0.85, 4, 12); geos.push(podGeo);           // sidepods
  const finGeo = new THREE.BoxGeometry(0.04, 0.3, 0.95); geos.push(finGeo);                 // shark fin
  const cockGeo = new THREE.BoxGeometry(0.32, 0.2, 0.55); geos.push(cockGeo);               // cockpit surround
  const fwMainGeo = new THREE.BoxGeometry(1.55, 0.05, 0.42); geos.push(fwMainGeo);          // front wing
  const fwFlapGeo = new THREE.BoxGeometry(1.5, 0.04, 0.22); geos.push(fwFlapGeo);
  const fwEndGeo = new THREE.BoxGeometry(0.05, 0.24, 0.52); geos.push(fwEndGeo);
  const rwMainGeo = new THREE.BoxGeometry(1.2, 0.06, 0.36); geos.push(rwMainGeo);           // rear wing
  const rwBeamGeo = new THREE.BoxGeometry(1.0, 0.05, 0.18); geos.push(rwBeamGeo);
  const rwEndGeo = new THREE.BoxGeometry(0.06, 0.44, 0.46); geos.push(rwEndGeo);
  const rwStrutGeo = new THREE.BoxGeometry(0.07, 0.34, 0.12); geos.push(rwStrutGeo);
  const haloGeo = new THREE.TorusGeometry(0.21, 0.035, 8, 18, Math.PI); geos.push(haloGeo);
  const helmetGeo = new THREE.SphereGeometry(0.13, 14, 12); geos.push(helmetGeo);
  const wheelFGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.26, 18); geos.push(wheelFGeo);
  const wheelRGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.32, 18); geos.push(wheelRGeo);
  const hubGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.3, 10); geos.push(hubGeo);
  const bandFGeo = new THREE.TorusGeometry(0.32, 0.05, 8, 20); geos.push(bandFGeo);         // compound-colour sidewall
  const bandRGeo = new THREE.TorusGeometry(0.36, 0.055, 8, 20); geos.push(bandRGeo);
  const ringGeo = new THREE.RingGeometry(CAR_L * 0.85, CAR_L * 1.05, 28); geos.push(ringGeo);
  const sprayMap = sprayTex(); texs.push(sprayMap);                                         // wheel-spray mist (wet only)
  const sprayGeo = new THREE.PlaneGeometry(2.4, 1.5); geos.push(sprayGeo);
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0e0e13, roughness: 0.5, metalness: 0.25 }); mats.push(darkMat);
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x141418, roughness: 0.85 }); mats.push(tyreMat);
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xcfd4dc, roughness: 0.32, metalness: 0.9 }); mats.push(chromeMat);
  function makeCar(bodyMat, helmMat, bandMat) {
    const g = new THREE.Group();
    const add = (geo, mat, x, y, z, rx, ry, rz) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (rx) m.rotation.x = rx; if (ry) m.rotation.y = ry; if (rz) m.rotation.z = rz; m.castShadow = true; g.add(m); };
    add(floorGeo, darkMat, 0, 0.06, -0.05);
    add(bodyGeo, bodyMat, 0, 0.3, -0.05, Math.PI / 2, 0, 0);          // rounded monocoque
    add(engGeo, bodyMat, 0, 0.42, -0.72, Math.PI / 2, 0, 0);          // engine cover (raised at the rear)
    add(finGeo, darkMat, 0, 0.52, -0.9);                             // shark fin
    add(noseGeo, bodyMat, 0, 0.27, 1.25, Math.PI / 2, 0, 0);          // nose cone (apex forward)
    add(podGeo, bodyMat, 0.43, 0.27, -0.12, Math.PI / 2, 0.07, 0);    // sidepods
    add(podGeo, bodyMat, -0.43, 0.27, -0.12, Math.PI / 2, -0.07, 0);
    add(cockGeo, darkMat, 0, 0.46, 0.18);                            // cockpit surround
    add(helmetGeo, helmMat, 0, 0.51, 0.16);                          // driver helmet (team-tinted)
    add(haloGeo, chromeMat, 0, 0.57, 0.24, Math.PI / 2, 0, 0);        // halo
    add(fwMainGeo, darkMat, 0, 0.1, 1.74);                           // front wing main plane
    add(fwFlapGeo, bodyMat, 0, 0.19, 1.66);                          // front wing upper flap (livery)
    add(fwEndGeo, darkMat, 0.76, 0.18, 1.74); add(fwEndGeo, darkMat, -0.76, 0.18, 1.74);   // endplates
    add(rwMainGeo, bodyMat, 0, 0.74, -1.55);                         // rear wing (livery)
    add(rwBeamGeo, darkMat, 0, 0.44, -1.5);                          // beam wing
    add(rwStrutGeo, darkMat, 0, 0.58, -1.52);                        // central strut
    add(rwEndGeo, darkMat, 0.58, 0.62, -1.55); add(rwEndGeo, darkMat, -0.58, 0.62, -1.55); // rear endplates
    const WH = [[0.65, 0.32, 0.92, 0], [-0.65, 0.32, 0.92, 0], [0.67, 0.36, -0.98, 1], [-0.67, 0.36, -0.98, 1]];
    for (const w of WH) {
      const rear = w[3];
      add(rear ? wheelRGeo : wheelFGeo, tyreMat, w[0], w[1], w[2], 0, 0, Math.PI / 2);       // open wheel
      add(rear ? bandRGeo : bandFGeo, bandMat, w[0], w[1], w[2], 0, Math.PI / 2, 0);          // compound sidewall band
      add(hubGeo, chromeMat, w[0], w[1], w[2], 0, 0, Math.PI / 2);                            // wheel hub
    }
    return g;
  }
  const cars = {};
  for (const c of ((ctx.snapshot && ctx.snapshot.cars) || [])) {
    const col = new THREE.Color(c.color || "#888888");
    const bodyMat = new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.36, metalness: 0.35, clearcoat: 0.85, clearcoatRoughness: 0.28 }); mats.push(bodyMat);
    const helmMat = new THREE.MeshStandardMaterial({ color: col.clone().offsetHSL(0, 0, 0.12), roughness: 0.4 }); mats.push(helmMat);
    const bandMat = new THREE.MeshStandardMaterial({ color: COMPOUND_COL._default, roughness: 0.5 }); mats.push(bandMat);
    const g = makeCar(bodyMat, helmMat, bandMat);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide }); mats.push(ringMat);
    const ring = new THREE.Mesh(ringGeo, ringMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.09; g.add(ring);
    const sprayMat = new THREE.MeshBasicMaterial({ map: sprayMap, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }); mats.push(sprayMat);
    const spray = new THREE.Mesh(sprayGeo, sprayMat); spray.position.set(0, 0.5, -1.7); spray.rotation.x = -Math.PI / 2.4; g.add(spray);   // mist kicked up behind the rear wheels
    const tagCv = document.createElement("canvas"); tagCv.width = 256; tagCv.height = 72;        // MM-style floating driver tag
    const tagTex = new THREE.CanvasTexture(tagCv); tagTex.colorSpace = THREE.SRGBColorSpace; texs.push(tagTex);
    const tagMat = new THREE.SpriteMaterial({ map: tagTex, transparent: true, depthTest: false }); mats.push(tagMat);
    const tag = new THREE.Sprite(tagMat); tag.scale.set(5.2, 1.46, 1); tag.position.set(0, 3.0, 0); tag.renderOrder = 12; g.add(tag);
    g.scale.setScalar(1.0); cars[c.idx] = { group: g, ring, band: bandMat, spray: sprayMat, tag: { cv: tagCv, ctx: tagCv.getContext("2d"), tex: tagTex, key: "" }, lat: 0 }; scene.add(g);
  }

  // --- rain (driven by ctx.snapshot.wetness): a volume of falling streaks above the whole track,
  // recycled to the top as they hit the ground. Opacity/visibility scale with wetness. ---
  const RAIN_N = 900, RAIN_SPAN = WORLD * 2.2, RAIN_TOP = 95;
  const rainGeo = new THREE.BufferGeometry(); geos.push(rainGeo);
  const rainArr = new Float32Array(RAIN_N * 3);
  for (let r = 0; r < RAIN_N; r++) { rainArr[r * 3] = (Math.random() * 2 - 1) * RAIN_SPAN; rainArr[r * 3 + 1] = Math.random() * RAIN_TOP; rainArr[r * 3 + 2] = (Math.random() * 2 - 1) * RAIN_SPAN; }
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rainArr, 3));
  const rainMat = new THREE.PointsMaterial({ color: 0xd2e0f2, size: 1.6, transparent: true, opacity: 0, depthWrite: false, fog: false }); mats.push(rainMat);
  const rain = new THREE.Points(rainGeo, rainMat); rain.visible = false; scene.add(rain);

  // --- camera: orbit (auto-rotate + drag), chase (player/leader), or tv (auto-director). The frame
  // loop repositions every frame with smoothing; drag adjusts orbit angle, wheel zooms. ---
  let azim = -35 * Math.PI / 180, elev = 42 * Math.PI / 180, zoom = 1;
  const ORBIT_DIST = b.size * 1.12 * sc, CHASE_DIST = 18;
  const ORIGIN0 = new THREE.Vector3(0, 0, 0);
  const camTarget = new THREE.Vector3(0, 0, 0);
  const camPos = new THREE.Vector3(0, ORBIT_DIST, ORBIT_DIST);
  let curDist = ORBIT_DIST, autoAzim = 0;
  // TV-director state: current subject group + a held shot (offset params) that cuts every few s
  let tv = { subjIdx: null, holdUntil: 0, side: 1, height: 5, back: 16, fov: 38 };

  function liveGroup(c) { return (c && !c.retired && cars[c.idx]) ? cars[c.idx].group : null; }
  function chaseGroup() {
    const cam3d = ctx._cam3d || {}, snap = (ctx.snapshot && ctx.snapshot.cars) || [];
    if (cam3d.target === "leader") return liveGroup(snap[0]);
    return liveGroup(snap.find((x) => x.player)) || liveGroup(snap[0]);
  }
  // pick the most interesting subject for the TV director: the tightest on-track battle, else leader
  function directorSubject() {
    const snap = (ctx.snapshot && ctx.snapshot.cars) || [];
    let best = null, bestGap = 1e9;
    for (let i = 1; i < snap.length; i++) {
      const a = snap[i - 1], c = snap[i];
      if (!a || !c || a.retired || c.retired || a.lap !== c.lap) continue;
      const gap = (a.lap + a.lapFrac) - (c.lap + c.lapFrac);
      if (gap > 0 && gap < bestGap) { bestGap = gap; best = c; }
    }
    if (best && bestGap < 0.02) return best;          // a real fight -> follow it
    const player = snap.find((x) => x && x.player && !x.retired);
    return player || snap.find((x) => x && !x.retired) || snap[0];
  }
  function forwardOf(group) { return new THREE.Vector3(Math.sin(group.rotation.y), 0, Math.cos(group.rotation.y)); }

  function updateCam(dt) {
    const mode = (ctx._cam3d && ctx._cam3d.mode) || "orbit";
    let wantFov = 42;
    if (mode === "chase") {
      const gsel = chaseGroup();
      if (gsel) {
        const fwd = forwardOf(gsel), pos = gsel.position;
        camTarget.lerp(pos.clone().add(fwd.clone().multiplyScalar(6)), 0.16);
        const desired = pos.clone().add(fwd.clone().multiplyScalar(-CHASE_DIST * zoom)).add(new THREE.Vector3(0, 6.5 * zoom, 0));
        camPos.lerp(desired, 0.10); wantFov = 46;
      }
    } else if (mode === "tv") {
      const now = nowMs();
      const subj = directorSubject();
      if (subj && (tv.subjIdx !== subj.idx || now > tv.holdUntil)) {
        // cut to a fresh angle when the subject changes or the shot has been held long enough
        const r = mulberry((subj.idx + (now | 0)) >>> 0);
        tv = { subjIdx: subj.idx, holdUntil: now + 3800 + r() * 2600, side: r() < 0.5 ? 1 : -1, height: 4 + r() * 6, back: 12 + r() * 12, fov: 34 + r() * 12 };
      }
      const gsel = liveGroup(subj);
      if (gsel) {
        const fwd = forwardOf(gsel), pos = gsel.position;
        const sideV = new THREE.Vector3(fwd.z, 0, -fwd.x).multiplyScalar(tv.side * tv.back * 0.6);
        const desired = pos.clone().add(fwd.clone().multiplyScalar(-tv.back * 0.5)).add(sideV).add(new THREE.Vector3(0, tv.height, 0));
        camPos.lerp(desired, 0.06);
        camTarget.lerp(pos.clone().add(fwd.clone().multiplyScalar(3)), 0.1);
        wantFov = tv.fov;
      }
    } else { // orbit
      autoAzim += dt * 0.06;                              // gentle auto-rotate
      camTarget.lerp(ORIGIN0, 0.08);
      curDist += (ORBIT_DIST * zoom - curDist) * 0.1;
      const a = azim + autoAzim, horiz = Math.cos(elev) * curDist;
      const desired = new THREE.Vector3(Math.sin(a) * horiz, Math.sin(elev) * curDist, Math.cos(a) * horiz);
      camPos.lerp(desired, 0.12);
    }
    cam.position.copy(camPos); cam.lookAt(camTarget);
    cam.fov += (wantFov - cam.fov) * 0.08; cam.updateProjectionMatrix();
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

  let raf = 0, alive = true, lastFrame = 0;
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
    if (bloomPass) bloomPass.dispose();
    renderer.dispose();
  }
  function frame() {
    if (!canvas.isConnected) return dispose();
    raf = requestAnimationFrame(frame);
    const rt = nowMs() - DELAY;
    const dt = Math.min(0.05, (nowMs() - (lastFrame || nowMs())) / 1000); lastFrame = nowMs();
    const buf = ctx._buf || {};
    const snapCars = (ctx.snapshot && ctx.snapshot.cars) || [];
    // weather: wet-road sheen + greyer fog + dimmer sun + rain, all driven by snapshot wetness (0..1)
    const wet = Math.max(0, Math.min(1, (ctx.snapshot && ctx.snapshot.wetness) || 0));
    if (roadMat) { roadMat.roughness = 0.95 - 0.6 * wet; roadMat.metalness = 0.55 * wet; }
    key.intensity = 1.35 - 0.4 * wet;
    scene.fog.color.copy(FOG_DRY).lerp(FOG_WET, wet);
    renderer.toneMappingExposure = 1.36 - 0.12 * wet;
    rain.visible = wet > 0.1;
    if (rain.visible) {
      rainMat.opacity = Math.min(0.82, wet * 0.95);
      const pa = rainGeo.attributes.position.array;
      for (let r = 0; r < RAIN_N; r++) { pa[r * 3 + 1] -= (55 + 30 * wet) * dt; if (pa[r * 3 + 1] < 0) { pa[r * 3 + 1] = RAIN_TOP; pa[r * 3] = (Math.random() * 2 - 1) * RAIN_SPAN; pa[r * 3 + 2] = (Math.random() * 2 - 1) * RAIN_SPAN; } }
      rainGeo.attributes.position.needsUpdate = true;
      rain.position.set(camTarget.x, 0, camTarget.z);          // keep the rain volume centred on the view
    }
    const maxLat = Math.max(0, HW_N - CAR_HALF * HW_N);
    const lapLen = (cl.total * sc) || 1;
    const carLenProg = (CAR_L * 1.5) / lapLen;                  // ~a car length, in lap-fraction units
    const MIN_GAP = Math.min(maxLat * 1.2, 1.9 / sc);           // min lateral centre-to-centre gap (normalized)
    const active = [];
    // pass 1: per-car bookkeeping (tags/band/spray/pit) + collect on-track cars
    for (let i = 0; i < snapCars.length; i++) {
      const c = snapCars[i], car = cars[c.idx];
      if (!car) continue;
      if (c.retired) { car.group.visible = false; continue; }
      car.group.visible = true;
      if (car.band && c.tyre) car.band.color.set(COMPOUND_COL[c.tyre] || COMPOUND_COL._default);   // live tyre-compound colour
      if (car.spray) car.spray.opacity = (wet > 0.15 && !c.inPit) ? Math.min(0.72, wet * 0.82) : 0;   // wheel spray in the wet
      if (car.tag) { const tk = c.pos + "|" + c.abbrev + "|" + (c.color || ""); if (tk !== car.tag.key) { car.tag.key = tk; drawTag(car.tag.cv, car.tag.ctx, c.pos, c.abbrev, c.color || "#888888"); car.tag.tex.needsUpdate = true; } }
      car._pit = advancePitPhase(car._pit, c.inPit, dt);
      if (car._pit.active) {
        const s = pitLaneSample(car._pit.phase, pitLane);
        const p = offsetPoint(cl, s.frac, s.latUnit * pitLane.width * HW_N), t = tangentAt(cl, s.frac);
        car.group.position.set(wx(p), 0, wz(p));
        car.group.rotation.y = Math.atan2(t[0], t[1]);
        car.ring.material.opacity = 0; car.lat = 0; car.px = null;
        continue;
      }
      const prog = ctx.editorPreview ? (c.lap + c.lapFrac) : sampleProg(buf[c.idx], rt);
      car._wf = sampleWarp(speedWarp, prog); car._prog = prog;
      car._sepLat = racingLineOffset(cl, car._wf, LANE_LAT);    // start from the racing line, then separate
      car._id = c.idx; car._leader = (i === 0); car._isPlayer = !!c.player;
      active.push(car);
    }
    // pass 2: lateral separation — cars run side-by-side, never through each other (render-only, no sim change)
    active.sort((a, b) => b._prog - a._prog);
    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a < active.length; a++) {
        const A = active[a];
        for (let b = a + 1; b < active.length; b++) {
          const B = active[b];
          if (A._prog - B._prog > carLenProg * 1.4) break;     // sorted desc -> the rest are further back
          const dl = A._sepLat - B._sepLat, ad = Math.abs(dl);
          if (ad < MIN_GAP) {
            const push = (MIN_GAP - ad) * 0.5 + 1e-4;
            const dir = ad > 1e-3 ? Math.sign(dl) : ((A._id % 2) ? 1 : -1);
            A._sepLat = Math.max(-maxLat, Math.min(maxLat, A._sepLat + dir * push));
            B._sepLat = Math.max(-maxLat, Math.min(maxLat, B._sepLat - dir * push));
          }
        }
      }
    }
    // pass 3: ease toward the separated lane + low-pass the world position (smooth, no judder)
    for (const car of active) {
      car.lat += (car._sepLat - car.lat) * 0.16;
      car.lat = Math.max(-maxLat, Math.min(maxLat, car.lat));
      const p = offsetPoint(cl, car._wf, car.lat), t = tangentAt(cl, car._wf);
      const txp = wx(p), tzp = wz(p);
      if (car.px == null) { car.px = txp; car.pz = tzp; car.prevPx = txp; car.prevPz = tzp; car.yaw = Math.atan2(t[0], t[1]); }
      else { car.px += (txp - car.px) * POS_EASE; car.pz += (tzp - car.pz) * POS_EASE; }
      car.group.position.set(car.px, 0, car.pz);
      // heading follows the car's ACTUAL path of travel (natural turn-in through corners, no crabbing),
      // smoothed; falls back to the centerline tangent when nearly stationary (paused / pit).
      const vx = car.px - car.prevPx, vz = car.pz - car.prevPz; car.prevPx = car.px; car.prevPz = car.pz;
      const tgtYaw = (vx * vx + vz * vz > 4e-4) ? Math.atan2(vx, vz) : Math.atan2(t[0], t[1]);
      let dyaw = tgtYaw - car.yaw; while (dyaw > Math.PI) dyaw -= 2 * Math.PI; while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
      car.yaw += dyaw * 0.3; car.group.rotation.y = car.yaw;
      car.ring.material.opacity = (car._isPlayer || car._leader) ? 1 : 0;
      car.ring.material.color.set(car._leader ? 0xffd000 : 0xffffff);
    }
    updateCam(dt);
    if (composer) composer.render(); else renderer.render(scene, cam);
  }
  frame();

  return { dispose };
}
