// ApexWeb/tools/career_balance.mjs — career-loop corridor. Sims a full season with the real
// engine and checks: every round completes, points conserve per race, the season ends with a
// board verdict, and passes/race is sane across the varied calendar. Run: node tools/career_balance.mjs
import { TEAMS } from "../src/data.js";
import { Race } from "../src/sim.js";
import { driverAttrs, composeCar, genPersonnel } from "../src/team.js";
import { POINTS, newCareer, applyResult, advanceRound, isSeasonOver, constructorStandings, boardOutcome, CALENDAR, newSeason } from "../src/career.js";
import { careerTrack } from "../src/track_build.js";
import { effectiveCar, startProject } from "../src/development.js";
import { composePersonnel, upgradeStaff, upgradeFacility, upkeep } from "../src/staff.js";
import { moraleMod, DRIVER_NAME } from "../src/drivers.js";
import { negotiateSign, availableDrivers, signCost } from "../src/market.js";
import { signJunior, promoteJunior, SUPERLICENSE } from "../src/academy.js";

function field() {
  let idx = 0;
  const rosterOf = ti => Object.keys(career.drivers || {}).filter(ab => career.drivers[ab].teamIdx === ti)
    .sort((a, b) => career.drivers[b].overall - career.drivers[a].overall);
  return TEAMS.flatMap((t, ti) => rosterOf(ti).map(ab => {
    const dr = career.drivers[ab];
    return {
      idx: idx++, name: DRIVER_NAME[ab] || ab, abbrev: ab, skill: dr.overall,
      car: composeCar(effectiveCar(t.car, career.parts && career.parts[t.name])), color: t.color, team: t.name,
      attrs: driverAttrs(ab, dr.overall), personnel: (ti === career.teamIdx && career.staff) ? composePersonnel(career.staff) : genPersonnel(t.facility, ti),
      setup: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5], setupBonus: moraleMod(dr.morale), startTyre: "medium",
    };
  }));
}
function runRace(track, seed) {
  const r = new Race(field(), track, seed, 0.80);
  r.gridStart();
  let g = 0; while (!r.finished && g++ < 500000) r.step(0.25);
  const passes = r.events.filter(e => e.type === "pass").length;
  return { order: r.order().map(c => ({ abbrev: c.abbrev, team: c.team, retired: c.retired })), passes };
}

const career = newCareer({ teamIdx: 0, seed: 1 });
{ const out = Object.keys(career.drivers).find(a => career.drivers[a].teamIdx === 0);
  const top = availableDrivers(career)[0];                      // attempt the marquee target
  let res = { ok: false, reason: "—" };
  for (let s = 0; s < 30 && !res.ok; s++) res = negotiateSign(career, top.abbrev, out, { teamStrength: 1.0, seed: s });
  // a top driver's buyout is steep at season start (D4) -> often "деньги"; either way the grid stays intact
  // and the player keeps a competitive lineup (no income-wrecking downgrade).
  console.log(`transfer: negotiate ${top.abbrev} (ovr ${top.overall.toFixed(3)}, cost $${(signCost(top) / 1000).toFixed(1)}M vs $${(career.money / 1000).toFixed(1)}M) for ${out} -> ${res.ok} (${res.ok ? "signed" : res.reason})`); }
{ signJunior(career, "HIR"); const out = Object.keys(career.drivers).find(a => career.drivers[a].teamIdx === 0);
  const ok = promoteJunior(career, "HIR", out); console.log(`academy: signed+promoted HIR for ${out} -> ${ok} (gate ${SUPERLICENSE})`); }
let totalPts = 0, minPass = 1e9, maxPass = 0, races = 0;
const expectedPerRace = POINTS.reduce((a, b) => a + b, 0);
while (!isSeasonOver(career)) {
  const round = CALENDAR[career.round];
  if (!career.project && career.money > 2000) startProject(career, ["floor", "pu", "fw"][career.round % 3], "small");
  if (career.round < 6 && career.money > 8000) { upgradeStaff(career, "designer"); upgradeFacility(career, "design"); }
  const { order, passes } = runRace(careerTrack(round), 1000 + career.round);
  const before = Object.values(career.driverPts).reduce((a, b) => a + b, 0);
  applyResult(career, order);
  const gained = Object.values(career.driverPts).reduce((a, b) => a + b, 0) - before;
  if (gained !== expectedPerRace) { console.error(`ROUND ${career.round} ${round.name}: points ${gained} != ${expectedPerRace}`); process.exit(1); }
  minPass = Math.min(minPass, passes); maxPass = Math.max(maxPass, passes);
  console.log(`R${String(career.round + 1).padStart(2)} ${round.name.padEnd(28)} win=${order[0].abbrev.padEnd(4)} passes=${passes}`);
  totalPts += gained; races++;
  advanceRound(career);
}
const bo = boardOutcome(career);
const champ = constructorStandings(career)[0];
console.log(`\nseason: ${races} races, ${totalPts} pts awarded, champion=${champ.team} (${champ.pts}), player P${bo.finalPos} target P${bo.target} -> ${bo.met ? "MET" : "MISSED"}`);
console.log(`passes/race across the calendar: ${minPass}..${maxPass}`);
console.log(`player money end of season: $${(career.money / 1000).toFixed(1)}M  (sponsors: ${career.sponsors.map(s => s.name + " " + Math.round(s.happiness * 100) + "%").join(", ")})`);
if (races !== CALENDAR.length) { console.error("season did not complete all rounds"); process.exit(1); }
if (minPass < 1) { console.error("a race had zero passes — check overtake_zones on every calendar track"); process.exit(1); }
if (career.money <= 0) { console.error("a front-running team went broke over a season — economy too harsh"); process.exit(1); }
const effAvg = t => { const e = effectiveCar(t.car, career.parts && career.parts[t.name]); return (e.power + e.aero) / 2; };
const avgs = TEAMS.map(effAvg);
const spread = Math.max(...avgs) - Math.min(...avgs);
const myParts = career.parts[TEAMS[0].name] || {};
console.log(`dev: player parts floor +${(myParts.floor || 0).toFixed(3)} pu +${(myParts.pu || 0).toFixed(3)}; field (power+aero)/2 spread ${spread.toFixed(3)}`);
if (!(Object.values(myParts).some(v => v > 0))) { console.error("player car did not develop over the season"); process.exit(1); }
if (spread > 0.45) { console.error(`grid spread ${spread.toFixed(3)} too wide — development ran away`); process.exit(1); }
const antBefore = career.drivers["ANT"].overall, aloBefore = career.drivers["ALO"].overall;
const antAttr0 = { ...career.drivers["ANT"].attrs }, aloAttr0 = { ...career.drivers["ALO"].attrs };
const next = newSeason(career);
console.log(`drivers: ANT ${antBefore.toFixed(3)}->${next.drivers["ANT"].overall.toFixed(3)} (age ${next.drivers["ANT"].age}), ALO ${aloBefore.toFixed(3)}->${next.drivers["ALO"].overall.toFixed(3)}; player morale ${Object.keys(career.drivers).filter(a => career.drivers[a].teamIdx === 0).map(a => Math.round(career.drivers[a].morale * 100) + "%").join("/")}`);
if (!(next.drivers["ANT"].overall > antBefore && next.drivers["ALO"].overall < aloBefore)) { console.error("driver development curve broken (young should rise, veteran fall)"); process.exit(1); }
// D5: attributes develop independently and within bounds
const antPaceUp = next.drivers["ANT"].attrs.pace - antAttr0.pace;
const aloPaceDn = aloAttr0.pace - next.drivers["ALO"].attrs.pace, aloIqDn = aloAttr0.race_iq - next.drivers["ALO"].attrs.race_iq;
console.log(`attrs (D5): ANT pace ${antAttr0.pace.toFixed(3)}->${next.drivers["ANT"].attrs.pace.toFixed(3)}; ALO pace -${aloPaceDn.toFixed(3)} vs race_iq -${aloIqDn.toFixed(3)}`);
if (!(antPaceUp > 0)) { console.error("a young driver's pace did not improve (D5 attr dev)"); process.exit(1); }
if (!(aloPaceDn > aloIqDn)) { console.error("a veteran's pace should fade faster than craft (D5 attr dev)"); process.exit(1); }
for (const ab in next.drivers) { const a0 = career.drivers[ab] && career.drivers[ab].attrs, a1 = next.drivers[ab].attrs;
  if (a0 && a1) for (const k in a1) if (Math.abs(a1[k] - a0[k]) > 0.05) { console.error(`attr ${k} drifted ${(a1[k] - a0[k]).toFixed(3)} for ${ab} — too fast (D5)`); process.exit(1); } }
console.log(`staff: designer ${Math.round(career.staff.designer * 100)}, design office L${career.staff.facilities.design}, upkeep ${upkeep(career.staff).toFixed(0)}k/race`);
const counts = {}; for (const a in career.drivers) counts[career.drivers[a].teamIdx] = (counts[career.drivers[a].teamIdx] || 0) + 1;
const badTeams = Object.entries(counts).filter(([, n]) => n !== 2);
console.log(`grid integrity: ${Object.keys(counts).length} teams, ${badTeams.length === 0 ? "all 2 drivers" : "BAD " + JSON.stringify(badTeams)}`);
if (badTeams.length) { console.error("a team does not have exactly 2 drivers after transfers/churn"); process.exit(1); }
if (!career.drivers["HIR"] || career.drivers["HIR"].teamIdx !== 0) { console.error("promoted junior is not racing for the player"); process.exit(1); }
console.log(`academy: HIR racing for player (ovr ${career.drivers["HIR"].overall.toFixed(3)})`);
console.log(`board: confidence ${Math.round((career.board.confidence ?? 0.5) * 100)}%, news ${(career.news || []).length} items; latest "${(career.news || [])[0] || "-"}"`);
if (!(career.news && career.news.length > 0)) { console.error("no board/paddock news generated over the season"); process.exit(1); }
const regBefore = (career.parts["McLaren"] && career.parts["McLaren"].floor) || 0;
const regAfter = (next.parts["McLaren"] && next.parts["McLaren"].floor) || 0;
console.log(`regulation reset: McLaren parts.floor ${regBefore.toFixed(3)} -> ${regAfter.toFixed(3)} (new season)`);
if (!(regAfter <= regBefore)) { console.error("regulation reset did not trim development"); process.exit(1); }
console.log("CAREER CORRIDOR OK");
