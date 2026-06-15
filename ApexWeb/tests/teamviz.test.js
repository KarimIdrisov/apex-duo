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

import { driverAvatar, driverCard } from "../src/ui/teamviz.js";

test("driverAvatar: number block base + photo layer with an onerror fallback", () => {
  const html = driverAvatar("VER", "Red Bull", 48);
  assert.match(html, /assets\/drivers\/VER\.png/, "photo src by abbrev");
  assert.match(html, /onerror/, "photo hides on error → reveals the colour block");
  assert.match(html, />3</, "the colour-block shows the driver number 3");
  assert.match(html, /#3671c6/, "uses the Red Bull team colour");
});

test("driverCard: shows name, team chip, avatar; car render only when opts.car", () => {
  const d = { team: "McLaren", abbrev: "NOR", name: "Норрис" };
  const withCar = driverCard(d, { car: true, sub: "ovr 0.950" });
  assert.match(withCar, /Норрис/);
  assert.match(withCar, /assets\/drivers\/NOR\.png/, "avatar photo present");
  assert.match(withCar, /assets\/cars\/mclaren\.png/, "car render present when opts.car");
  assert.match(withCar, /ovr 0\.950/, "sub line rendered");
  const noCar = driverCard(d, {});
  assert.doesNotMatch(noCar, /assets\/cars\//, "no car render without opts.car");
});

import { ATTR_RU, STAFF_TIP, personTipAttrs, staffTipAttrs, driverSkillTip, staffSkillTip } from "../src/ui/teamviz.js";
import { ATTR_KEYS } from "../src/team.js";

test("ATTR_RU: a Russian label for every one of the 13 attribute keys", () => {
  assert.equal(ATTR_KEYS.length, 13);
  for (const k of ATTR_KEYS) assert.equal(typeof ATTR_RU[k], "string", `missing label for ${k}`);
});

test("personTipAttrs / staffTipAttrs: emit the expected data-attributes", () => {
  const d = personTipAttrs({ abbrev: "VER", overall: 0.944, team: "Red Bull", name: "Ферстаппен", age: 28 });
  assert.match(d, /data-driver="VER"/); assert.match(d, /data-ovr="0\.944"/);
  assert.match(d, /data-team="Red Bull"/); assert.match(d, /data-name="Ферстаппен"/); assert.match(d, /data-age="28"/);
  const s = staffTipAttrs({ role: "strategist", val: 0.82, team: "Mercedes" });
  assert.match(s, /data-staff="strategist"/); assert.match(s, /data-val="0\.82"/); assert.match(s, /data-team="Mercedes"/);
});

test("driverSkillTip: header (name + OVR) + all 13 labels + bars", () => {
  const h = driverSkillTip("VER", 0.944, "Red Bull", "Ферстаппен", 28);
  assert.match(h, /Ферстаппен/); assert.match(h, /OVR/); assert.match(h, />94</, "OVR rounded to 94");
  for (const k of ATTR_KEYS) assert.ok(h.includes(ATTR_RU[k]), `tip missing ${ATTR_RU[k]}`);
  assert.match(h, /width:\d+%/, "has at least one bar fill");
  assert.match(h, /★/, "marks top skills with a star");
});

test("staffSkillTip: role label + rating + effect line", () => {
  const h = staffSkillTip("strategist", 0.82, "Mercedes");
  assert.match(h, /Стратег/); assert.match(h, />82</); assert.ok(h.includes(STAFF_TIP.strategist));
});
