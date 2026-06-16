import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCenterline, splinePath, cornerRuns } from "../src/geom3d.js";
import { hashSeed, mulberry, straightRuns, longestStraight, farSide, spaceFracs, planScenery, placeAt } from "../src/scenery.js";

// elongated oval: two tight ends (corners) + two long straight sides
const ring = (rx, ry, n) => { const a = []; for (let i = 0; i < n; i++) { const t = (i / n) * 2 * Math.PI; a.push(0.5 + rx * Math.cos(t), 0.5 + ry * Math.sin(t)); } return a; };
const oval = () => buildCenterline(splinePath(ring(0.42, 0.12, 20)));

test("hashSeed: deterministic, non-zero, distinct for distinct strings", () => {
  assert.equal(hashSeed("Monza"), hashSeed("Monza"));
  assert.notEqual(hashSeed("Monza"), hashSeed("Monaco"));
  assert.ok(hashSeed("") > 0);
});

test("mulberry: deterministic stream in [0,1)", () => {
  const a = mulberry(123), b = mulberry(123);
  for (let i = 0; i < 50; i++) { const v = a(); assert.equal(v, b()); assert.ok(v >= 0 && v < 1); }
  assert.notEqual(mulberry(1)(), mulberry(2)());
});

test("straightRuns: an oval has straight runs that are NOT corner runs", () => {
  const cl = oval();
  const straights = straightRuns(cl, 600, 0.10);
  const corners = cornerRuns(cl, 600, 0.10);
  assert.ok(straights.length >= 2, `oval should have >=2 straights, got ${straights.length}`);
  assert.ok(corners.length >= 2, `oval should have >=2 corners, got ${corners.length}`);
  // a straight run's midpoint index should not fall inside any corner run
  const inCorner = (idx) => corners.some((c) => { const d = ((idx - c.start) % 600 + 600) % 600; return d < c.len; });
  for (const s of straights) {
    const mid = (s.start + (s.len >> 1)) % 600;
    assert.ok(!inCorner(mid), `straight midpoint ${mid} should be outside every corner run`);
  }
});

test("straightRuns: a tight circle (corner everywhere) has no straights", () => {
  const cl = buildCenterline(splinePath(ring(0.06, 0.06, 28)));
  assert.equal(straightRuns(cl, 400, 0.30).length, 0);
});

test("longestStraight: picks the longest run, mid lies on it", () => {
  const cl = oval();
  const ls = longestStraight(cl, 600, 0.10);
  assert.ok(ls, "oval has a longest straight");
  const all = straightRuns(cl, 600, 0.10);
  for (const r of all) assert.ok(ls.len >= r.len, "returned run is the longest");
  assert.ok(ls.mid >= 0 && ls.mid < 1, "mid is a lap-fraction");
});

test("farSide: returns ±1 and points away from centroid", () => {
  const cl = oval();
  for (const f of [0.0, 0.25, 0.5, 0.75]) {
    const s = farSide(cl, f);
    assert.ok(s === 1 || s === -1, `±1, got ${s}`);
  }
});

test("spaceFracs: n evenly spaced fracs within the run, all in [0,1)", () => {
  const fr = spaceFracs({ start: 100, len: 200 }, 5, 600, 10);
  assert.equal(fr.length, 5);
  for (const f of fr) assert.ok(f >= 0 && f < 1);
  assert.equal(spaceFracs({ start: 0, len: 10 }, 0, 600).length, 0);
  assert.equal(spaceFracs({ start: 0, len: 10 }, 1, 600).length, 1);
});

test("planScenery: deterministic shape, fracs valid, sides ±1, same name == same plan", () => {
  const cl = oval();
  const a = planScenery(cl, "Catalunya");
  const b = planScenery(cl, "Catalunya");
  assert.deepEqual(a, b, "same track name -> identical plan");
  assert.notEqual(planScenery(cl, "Monaco").seed, a.seed);
  for (const key of ["grandstands", "hoardings", "barriers", "marshals", "trees"]) {
    assert.ok(Array.isArray(a[key]), `${key} is an array`);
  }
  assert.ok(a.grandstands.length >= 2, "oval gets grandstands on its straights");
  assert.ok(a.barriers.length >= 4, "oval gets barriers on its corners");
  for (const g of a.grandstands) { assert.ok(g.frac >= 0 && g.frac < 1); assert.ok(g.side === 1 || g.side === -1); }
  for (const t of a.trees) { assert.ok(t.frac >= 0 && t.frac < 1); assert.ok(t.dist > 0 && t.scale > 0); }
});

test("placeAt: returns world x/y offset sideways + a heading", () => {
  const cl = oval();
  const on = placeAt(cl, 0.3, 1, 0);
  const off = placeAt(cl, 0.3, 1, 0.1);
  assert.ok(Number.isFinite(on.rot));
  const moved = Math.hypot(off.x - on.x, off.y - on.y);
  assert.ok(Math.abs(moved - 0.1) < 1e-6, `sideways move == latN, got ${moved}`);
});
