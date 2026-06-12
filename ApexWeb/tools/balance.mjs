// ApexWeb/tools/balance.mjs
// calibrated 2026-06-11: DNF 1.10/race, pace spread 1.69 s/lap, winners
// NOR 38 / VER 1 / LEC 1 (top teams, some variety). Tuned in data.js:
// SKILL_K 3.0->7.0 (widen field to land spread in corridor),
// DNF_BASE 0.005->0.0075 (lift retirements into ~1-2 band). All 24 node:test pass.
import { Race } from "../src/sim.js";
import { TEAMS, TRACK, COMPOUNDS } from "../src/data.js";

function field() {
  let idx = 0;
  return TEAMS.flatMap(t => t.drivers.map(d => ({
    idx: idx++, name:d.name, abbrev:d.abbrev, skill:d.skill,
    car:t.car, color:t.color, team:t.name, setup:[0.5,0.5,0.5], startTyre:"medium",
  })));
}

const N = 40;
let dnfTotal = 0, winners = {}, topGapSum = 0;
for (let s = 0; s < N; s++) {
  const r = new Race(field(), TRACK, 1000 + s);
  r.gridStart();
  let guard = 0;
  while (!r.finished && guard++ < 500000) r.step();
  const ord = r.order();
  dnfTotal += r.cars.filter(c => c.retired).length;
  const w = ord[0].abbrev; winners[w] = (winners[w] || 0) + 1;
  // pace spread: best vs worst average lap among finishers
  const fin = r.cars.filter(c => !c.retired);
  const avgs = fin.map(c => c.avgLap).sort((a,b)=>a-b);
  topGapSum += (avgs[avgs.length-1] - avgs[0]);
}
console.log(`races: ${N}`);
console.log(`avg DNF/race: ${(dnfTotal/N).toFixed(2)}  (target ~1-2)`);
console.log(`avg pace spread best->worst: ${(topGapSum/N).toFixed(2)} s/lap (target ~1.5-2.5)`);
console.log(`winners:`, winners);

// fuel corridor: a full-push field should run several cars dry; a standard field should not.
// calibrated: push=212, standard=0 (FUEL.margin=0.06, ENGINE_MODES.push.burn=1.20)
function fuelRunouts(engine) {
  let dry = 0;
  for (let s = 0; s < 10; s++) {
    const r = new Race(field(), TRACK, 5000 + s);
    r.gridStart();
    for (const c of r.cars) c.engine = engine;
    let g = 0; while (!r.finished && g++ < 500000) r.step();
    dry += r.cars.filter(c => c.retired && c.fuel <= 0).length;
  }
  return dry;
}
console.log(`fuel run-outs over 10 races: push=${fuelRunouts("push")} (expect >0), standard=${fuelRunouts("standard")} (expect 0)`);

// tyre degradation corridor: a fresh tyre claws back time vs a worn one — this (with the
// cold out-lap) is what makes the undercut work. Uses real lap-based wear (wear = laps × compound.wear).
{
  const { tyreTerm } = await import("../src/tyres.js");
  const w = laps => laps * COMPOUNDS.medium.wear;     // medium wear after N laps at standard pace
  const deg20 = tyreTerm("medium", w(20), 1);          // 20-lap medium, warm
  const deg30 = tyreTerm("medium", w(30), 1);          // 30-lap medium, warm
  console.log(`tyre deg (medium, warm): 20 laps = ${deg20.toFixed(2)} s/lap off fresh, ` +
    `30 laps = ${deg30.toFixed(2)} s/lap (expect ~1.5-3 at 20; the undercut also rides the cold out-lap)`);
}
