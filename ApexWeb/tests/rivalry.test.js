import { test } from "node:test";
import assert from "node:assert/strict";
import { pickRival, ensureRivals, rivalMoraleDelta } from "../src/rivalry.js";

// Smoke coverage for personal driver rivalries (each player driver benchmarks the closest-overall
// rival on another team). Pure + deterministic.
const makeDrivers = () => ({
  NOR: { teamIdx: 0, overall: 0.92 }, PIA: { teamIdx: 0, overall: 0.88 },
  VER: { teamIdx: 1, overall: 0.95 }, TSU: { teamIdx: 1, overall: 0.80 },
  LEC: { teamIdx: 2, overall: 0.90 }, HAM: { teamIdx: 2, overall: 0.89 },
});

test("pickRival picks the closest-overall driver on another team, deterministically", () => {
  const d = makeDrivers();
  const r = pickRival(d, "NOR");
  assert.ok(r && d[r].teamIdx !== 0, "rival is on a different team");
  assert.equal(pickRival(d, "NOR"), pickRival(d, "NOR"), "deterministic");
  assert.equal(r, "LEC", "NOR 0.92 → LEC 0.90 is the closest non-teammate");
});

test("ensureRivals assigns a valid rival to each player-team driver, idempotently", () => {
  const d = makeDrivers();
  assert.equal(ensureRivals(d, 0), 2, "both player drivers get a rival");
  assert.ok(d.NOR.rival && d.PIA.rival);
  assert.equal(ensureRivals(d, 0), 0, "already-valid rivals aren't reassigned");
});

test("rivalMoraleDelta: ahead lifts, behind stings, a missing rival is neutral", () => {
  assert.ok(rivalMoraleDelta(1, 5) > 0);
  assert.ok(rivalMoraleDelta(5, 1) < 0);
  assert.equal(rivalMoraleDelta(3, null), 0);
});
