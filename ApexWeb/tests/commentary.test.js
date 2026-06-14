import { test } from "node:test";
import assert from "node:assert/strict";
import { describe } from "../src/commentary.js";

test("describe returns a non-empty Russian string for every event type", () => {
  const evs = [
    { type: "start", lap: 0, abbr: "VER" },
    { type: "pass", lap: 5, abbr: "NOR", abbrB: "LEC" },
    { type: "pit", lap: 20, abbr: "HAM", compound: "hard" },
    { type: "fastlap", lap: 30, abbr: "PIA", t: 78.345 },
    { type: "dnf", lap: 12, abbr: "ALO" },
    { type: "sc_on", lap: 15 }, { type: "sc_off", lap: 18 },
    { type: "finish", lap: 66, abbr: "RUS" },
  ];
  for (const e of evs) { const s = describe(e); assert.ok(typeof s === "string" && s.length > 0, e.type); }
});

test("pass mentions both drivers; pit mentions the compound (in Russian)", () => {
  assert.ok(describe({ type: "pass", lap: 5, abbr: "NOR", abbrB: "LEC" }).includes("NOR"));
  assert.ok(describe({ type: "pass", lap: 5, abbr: "NOR", abbrB: "LEC" }).includes("LEC"));
  assert.ok(/медиум|софт|хард|интер|дожд/i.test(describe({ type: "pit", lap: 9, abbr: "HAM", compound: "medium" })));
});

test("deterministic: same event -> same line", () => {
  const e = { type: "pass", lap: 7, abbr: "VER", abbrB: "PER" };
  assert.equal(describe(e), describe(e));
});

test("unknown event type returns empty string (safe)", () => {
  assert.equal(describe({ type: "???", lap: 1 }), "");
});

test("zone passes get zone-flavoured lines (brake / slip)", () => {
  const brake = describe({ type: "pass", lap: 5, abbr: "NOR", abbrB: "LEC", zone: "brake" });
  const slip = describe({ type: "pass", lap: 5, abbr: "NOR", abbrB: "LEC", zone: "slip" });
  assert.ok(/торм/i.test(brake), "brake mentions braking");
  assert.ok(/слип|выхлоп|прям/i.test(slip), "slip mentions slipstream/straight");
  assert.ok(brake.includes("NOR") && brake.includes("LEC"));
});

test("a pass without a zone still works (default line)", () => {
  const s = describe({ type: "pass", lap: 5, abbr: "NOR", abbrB: "LEC" });
  assert.ok(typeof s === "string" && s.includes("NOR") && s.includes("LEC"));
});

test("incident + lockup events produce a non-empty Russian line", () => {
  assert.ok(describe({ type: "incident", lap: 4, a: 2, abbr: "VER", dnf: true }).length > 0);
  assert.ok(describe({ type: "incident", lap: 4, a: 2, abbr: "VER", dnf: false }).length > 0);
  assert.ok(describe({ type: "lockup", lap: 7, a: 1, abbr: "LEC" }).length > 0);
});
