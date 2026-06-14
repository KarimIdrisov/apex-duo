import { test } from "node:test";
import assert from "node:assert/strict";
import { incidentChance, cautionFromIncident } from "../src/events.js";
import { INCIDENT } from "../src/data.js";
import { RNG } from "../src/rng.js";

test("incidentChance: lap 1 and traffic elevate; nervy driver higher", () => {
  const base = (lap, inFight, comp) => incidentChance(INCIDENT.base, 1.0, comp, inFight, lap, INCIDENT);
  assert.ok(base(1, false, 0.5) > base(5, false, 0.5), "lap-1 elevated");
  assert.ok(base(5, true, 0.5) > base(5, false, 0.5), "traffic elevated");
  assert.ok(base(5, false, 0.1) > base(5, false, 0.9), "nervy (low composure) higher");
});

test("cautionFromIncident: deterministic; DNF weight ≥ minor; returns sc|vsc|null", () => {
  // with trackSc moderate and a DNF, some draws produce a caution; tally over seeds
  let scOrVsc = 0, n = 400;
  for (let i = 0; i < n; i++) { const c = cautionFromIncident(new RNG(7000 + i), 0.5, true, 0.6, INCIDENT); if (c) scOrVsc++; }
  assert.ok(scOrVsc > 0 && scOrVsc < n, "some draws caution, some don't");
  // determinism
  assert.equal(cautionFromIncident(new RNG(1), 0.3, false, 0.6, INCIDENT),
               cautionFromIncident(new RNG(1), 0.3, false, 0.6, INCIDENT), "same seed → same outcome");
  // a DNF is at least as likely to draw a caution as a minor incident
  const tally = (wasDNF) => { let k = 0; for (let i = 0; i < 600; i++) if (cautionFromIncident(new RNG(i), 0.3, wasDNF, 0.6, INCIDENT)) k++; return k; };
  assert.ok(tally(true) >= tally(false), "DNF draws cautions at least as often as a minor off");
});
