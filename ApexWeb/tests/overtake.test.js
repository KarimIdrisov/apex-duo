import { test } from "node:test";
import assert from "node:assert/strict";
import { slipstream, dirtyWear, passAccrual } from "../src/overtake.js";

test("slipstream is stronger on straights and for powerful cars", () => {
  assert.ok(slipstream(1, 0.95) > slipstream(0, 0.95));
  assert.ok(slipstream(1, 0.95) > slipstream(1, 0.78));
  assert.equal(slipstream(0, 0.95), 0);
});

test("dirty air wears more in corners than on straights", () => {
  assert.ok(dirtyWear(0) > dirtyWear(1));
  assert.equal(dirtyWear(1), 0);
});

test("pass-credit accrues faster on straights, with tow, and on push", () => {
  const edge = 0.3;
  assert.ok(passAccrual(edge, 0, "standard", 1) > passAccrual(edge, 0, "standard", 0));
  assert.ok(passAccrual(edge, 0.2, "standard", 1) > passAccrual(edge, 0, "standard", 1));
  assert.ok(passAccrual(edge, 0, "push", 1) > passAccrual(edge, 0, "standard", 1));
  assert.equal(passAccrual(-1, 0, "standard", 1), passAccrual(0, 0, "standard", 1));
});

import { zoneFor } from "../src/overtake.js";
import { TRACK } from "../src/data.js";

test("TRACK has 2 overtake zones; zoneFor resolves a mini-sector to a zone or null", () => {
  assert.ok(Array.isArray(TRACK.overtake_zones) && TRACK.overtake_zones.length === 2, "2 zones");
  for (const z of TRACK.overtake_zones) {
    assert.ok(Array.isArray(z.sectors) && z.sectors.length > 0, "zone has sectors");
    assert.ok(z.ease > 0 && z.ease <= 1, "ease in (0,1]");
    assert.ok(z.type === "brake" || z.type === "slip", "type brake|slip");
  }
  const inZoneMini = TRACK.overtake_zones[0].sectors[0];
  assert.ok(zoneFor(TRACK.overtake_zones, inZoneMini), "in-zone mini resolves");
  const all = new Set(TRACK.overtake_zones.flatMap(z => z.sectors));
  let outMini = -1; for (let m = 0; m < 18; m++) if (!all.has(m)) { outMini = m; break; }
  assert.equal(zoneFor(TRACK.overtake_zones, outMini), null, "out-of-zone mini -> null");
  assert.equal(zoneFor(undefined, 0), null, "missing zones -> null (safe)");
});
