// ApexWeb/tools/career_balance.mjs — career-loop corridor. Sims a full season with the real
// engine and checks: every round completes, points conserve per race, the season ends with a
// board verdict, and passes/race is sane across the varied calendar. Run: node tools/career_balance.mjs
import { TEAMS } from "../src/data.js";
import { Race } from "../src/sim.js";
import { driverAttrs, composeCar, genPersonnel } from "../src/team.js";
import { POINTS, newCareer, applyResult, advanceRound, isSeasonOver, constructorStandings, boardOutcome, CALENDAR } from "../src/career.js";
import { careerTrack } from "../src/track_build.js";

function field() {
  let idx = 0;
  return TEAMS.flatMap((t, ti) => t.drivers.map(d => ({
    idx: idx++, name: d.name, abbrev: d.abbrev, skill: d.skill,
    car: composeCar(t.car), color: t.color, team: t.name,
    attrs: driverAttrs(d.abbrev, d.skill), personnel: genPersonnel(t.facility, ti),
    setup: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5], setupBonus: 0, startTyre: "medium",
  })));
}
function runRace(track, seed) {
  const r = new Race(field(), track, seed, 0.80);
  r.gridStart();
  let g = 0; while (!r.finished && g++ < 500000) r.step(0.25);
  const passes = r.events.filter(e => e.type === "pass").length;
  return { order: r.order().map(c => ({ abbrev: c.abbrev, team: c.team, retired: c.retired })), passes };
}

const career = newCareer({ teamIdx: 0, seed: 1 });
let totalPts = 0, minPass = 1e9, maxPass = 0, races = 0;
const expectedPerRace = POINTS.reduce((a, b) => a + b, 0);
while (!isSeasonOver(career)) {
  const round = CALENDAR[career.round];
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
console.log("CAREER CORRIDOR OK");
