import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { teamColor, teamInk, DRIVER_NUM, teamLogoSrc, carImgSrc, tyreIcon } from "../src/ui/teamviz.js";
import { TEAMS, TEAM_LOGO } from "../src/data.js";

test("teamColor: known team → its hex; unknown → #888 fallback", () => {
  assert.equal(teamColor("McLaren"), "#ff8000");
  assert.equal(teamColor("Ferrari"), "#e8002d");
  assert.equal(teamColor("Nonexistent"), "#888");
});

test("teamInk: light colours get dark ink, dark colours get white", () => {
  assert.equal(teamInk("#ff8000"), "#0a0a0c");  // McLaren orange, lum ~0.59 > 0.55
  assert.equal(teamInk("#27f4d2"), "#0a0a0c");  // Mercedes teal, lum ~0.70
  assert.equal(teamInk("#e8002d"), "#fff");     // Ferrari red, lum ~0.29
  assert.equal(teamInk("#3671c6"), "#fff");     // Red Bull blue, lum ~0.41
});

test("DRIVER_NUM: all 22 grid abbrevs present with the verified 2026 numbers", () => {
  const abbrevs = TEAMS.flatMap(t => t.drivers.map(d => d.abbrev));
  assert.equal(abbrevs.length, 22);
  for (const a of abbrevs) assert.equal(typeof DRIVER_NUM[a], "number", `missing number for ${a}`);
  assert.equal(DRIVER_NUM.NOR, 1);
  assert.equal(DRIVER_NUM.VER, 3);
  assert.equal(DRIVER_NUM.LIN, 41);
  assert.equal(DRIVER_NUM.PIA, 81);
  assert.equal(DRIVER_NUM.BOT, 77);
});

test("teamLogoSrc / carImgSrc build the expected slug paths", () => {
  assert.equal(teamLogoSrc("McLaren"), "assets/teams/mclaren.png");
  assert.equal(teamLogoSrc("Sauber"), "assets/teams/audi.png");          // Sauber→audi
  assert.equal(carImgSrc("McLaren"), "assets/cars/mclaren.png");
  assert.equal(carImgSrc("RB"), "assets/cars/racing_bulls.png");          // RB→racing_bulls
});

test("tyreIcon: an <img> at assets/tyres/<compound>.png", () => {
  const html = tyreIcon("soft", 16);
  assert.match(html, /assets\/tyres\/soft\.png/);
  assert.match(html, /height:16px/);
});

test("asset presence: every grid driver has a photo and every team a car render on disk", () => {
  const here = u => fileURLToPath(new URL(u, import.meta.url));
  for (const t of TEAMS) {
    for (const d of t.drivers) {
      assert.ok(existsSync(here(`../assets/drivers/${d.abbrev}.png`)), `missing assets/drivers/${d.abbrev}.png`);
    }
    assert.ok(existsSync(here(`../assets/cars/${TEAM_LOGO[t.name]}.png`)), `missing car render for ${t.name}`);
  }
});
