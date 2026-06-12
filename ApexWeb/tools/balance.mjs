// ApexWeb/tools/balance.mjs
// calibrated 2026-06-11: DNF 1.10/race, pace spread 1.69 s/lap, winners
// NOR 38 / VER 1 / LEC 1 (top teams, some variety). Tuned in data.js:
// SKILL_K 3.0->7.0 (widen field to land spread in corridor),
// DNF_BASE 0.005->0.0075 (lift retirements into ~1-2 band). All 24 node:test pass.
import { Race } from "../src/sim.js";
import { TEAMS, TRACK, COMPOUNDS } from "../src/data.js";
import { driverAttrs, composeCar, genPersonnel } from "../src/team.js";

function field() {
  let idx = 0;
  return TEAMS.flatMap((t, ti) => t.drivers.map(d => ({
    idx: idx++, name:d.name, abbrev:d.abbrev, skill:d.skill,
    car: composeCar(t.car), color:t.color, team:t.name,
    attrs: driverAttrs(d.abbrev, d.skill), personnel: genPersonnel(t.facility, ti),
    setup:[0.5,0.5,0.5], startTyre:"medium",
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
    for (const c of r.cars) r.setEngine(c.idx, engine);   // pin the mode so the AI brain can't override the forced test
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

// sector specialism: power car relatively faster in the straightest sector, aero car in the twistiest.
{
  const { MINI, miniSplits, N_SECTOR } = await import("../src/track.js");
  const sectorStraightness = Array.from({ length: N_SECTOR }, (_, s) =>
    MINI.filter(m => m.sector === s).reduce((a, m) => a + m.straightness, 0) /
    MINI.filter(m => m.sector === s).length);
  const straightSec = sectorStraightness.indexOf(Math.max(...sectorStraightness));
  const twistySec = sectorStraightness.indexOf(Math.min(...sectorStraightness));
  const secTime = (car, sec) => miniSplits(80, car).filter((_, i) => MINI[i].sector === sec).reduce((a, b) => a + b, 0);
  const powerCar = { power: 0.95, aero: 0.78 }, aeroCar = { power: 0.78, aero: 0.95 };
  console.log(`sectors: power car ${(secTime(powerCar, straightSec) - secTime(aeroCar, straightSec)).toFixed(3)}s vs aero car in straight S${straightSec + 1} (expect negative = faster), ` +
    `${(secTime(powerCar, twistySec) - secTime(aeroCar, twistySec)).toFixed(3)}s in twisty S${twistySec + 1} (expect positive)`);
}

// overtaking corridor: racing happens (net position change from grid to flag) but isn't chaos,
// and dirty air bites harder in corners than on straights.
{
  const { dirtyWear } = await import("../src/overtake.js");
  let moved = 0, passEvents = 0, zonedPasses = 0;
  for (let s = 0; s < 20; s++) {
    const r = new Race(field(), TRACK, 9000 + s);
    r.gridStart();
    const start = Object.fromEntries(r.order().map(c => [c.idx, c.pos]));
    let g = 0; while (!r.finished && g++ < 500000) r.step();
    const fin = r.order();
    moved += fin.reduce((a, c) => a + Math.abs(c.pos - start[c.idx]), 0) / fin.length;
    const passes = r.events.filter(e => e.type === "pass");
    passEvents += passes.length;
    zonedPasses += passes.filter(e => e.zone).length;
  }
  console.log(`overtaking: avg |grid→finish| position change = ${(moved / 20).toFixed(2)} places/car ` +
    `(expect ~1-5: racing, not a procession or chaos); dirty-air wear corner/straight = ` +
    `${dirtyWear(0).toFixed(4)}/${dirtyWear(1).toFixed(4)}; ` +
    `passes/race ${(passEvents / 20).toFixed(1)}, in-zone ${passEvents ? (100 * zonedPasses / passEvents).toFixed(0) : 0}%`);
}

// safety-car corridor: SC occurrence over many races should land near track.sc.
{
  let sc = 0;
  for (let s = 0; s < 60; s++) {
    const r = new Race(field(), TRACK, 9500 + s);
    r.gridStart();
    let g = 0; while (!r.finished && g++ < 500000) r.step();
    if (r.scEverActive) sc++;
  }
  console.log(`safety car: occurred in ${sc}/60 races = ${(sc / 60).toFixed(2)} (expect ~${TRACK.sc})`);
}

// weather corridor: rain occurs near track.wet; in the wet, wets beat slicks (crossover holds).
{
  const { weatherTerm } = await import("../src/weather.js");
  let rained = 0;
  for (let s = 0; s < 60; s++) {
    const r = new Race(field(), TRACK, 9800 + s);
    if (r.weather.rains) rained++;
  }
  const dryGap = weatherTerm("wet", 0) - weatherTerm("hard", 0);     // >0: slick faster in the dry
  const wetGap = weatherTerm("hard", 0.85) - weatherTerm("wet", 0.85); // >0: wet faster in the rain
  console.log(`weather: rained in ${rained}/60 races = ${(rained / 60).toFixed(2)} (expect ~${TRACK.wet}); ` +
    `dry slick advantage ${dryGap.toFixed(1)}s, wet-tyre advantage in rain ${wetGap.toFixed(1)}s (both expect > 0)`);
}

// attribute corridor: the FM signature traits actually move the needle (the spread didn't collapse).
{
  const ver = driverAttrs("VER", 0.85), str = driverAttrs("STR", 0.80);
  console.log(`attrs: VER overtaking ${ver.overtaking.toFixed(2)} vs defending ${ver.defending.toFixed(2)}; ` +
    `HAM wet ${driverAttrs("HAM", 0.85).wet.toFixed(2)} > STR wet ${str.wet.toFixed(2)} (signature traits live); ` +
    `McLaren pit ${genPersonnel(0.95, 0).pitMult.toFixed(2)}× vs Cadillac ${genPersonnel(0.68, 10).pitMult.toFixed(2)}× (crew matters)`);
}

// strategy corridor: AI runs a sensible 1-2 stop race, pits in a mid-race window, and never
// throws the fuel away. (Spec §13: strategy bites — optimum is 1-2 stops, not a 0-stop cruise.)
{
  let stopSum = 0, stopN = 0, lapSum = 0, lapN = 0, fuelDry = 0, races = 30;
  for (let s = 0; s < races; s++) {
    const r = new Race(field(), TRACK, 7700 + s);
    r.gridStart();
    const lastStops = new Map(r.cars.map(c => [c.idx, 0]));
    let g = 0;
    while (!r.finished && g++ < 500000) {
      r.step();
      for (const c of r.cars) {
        if (c.player == null && c.pitStops > (lastStops.get(c.idx) || 0)) {
          lapSum += c.lap; lapN++; lastStops.set(c.idx, c.pitStops);
        }
      }
    }
    for (const c of r.cars) if (c.player == null && !c.retired) { stopSum += c.pitStops; stopN++; }
    fuelDry += r.cars.filter(c => c.player == null && c.retired && c.fuel <= 0).length;
  }
  console.log(`strategy: AI avg ${(stopSum / stopN).toFixed(2)} stops/race (expect ~1-2); ` +
    `mean stop on lap ${(lapSum / lapN).toFixed(0)}/${TRACK.laps} (expect a mid-race window); ` +
    `AI fuel run-outs ${fuelDry}/${races} races (expect 0 — the brain manages fuel)`);
}

// difficulty corridor: lower difficulty makes the AI field slower and MORE varied (more winners),
// higher difficulty is razor-sharp (the best car dominates). Each level keeps DNF in band.
{
  const sample = (diff, races = 40) => {
    const winners = {}; let dnf = 0, spread = 0, n = 0;
    for (let s = 0; s < races; s++) {
      const r = new Race(field(), TRACK, 1000 + s, diff);
      r.gridStart();
      let g = 0; while (!r.finished && g++ < 500000) r.step();
      const ord = r.order(); winners[ord[0].abbrev] = (winners[ord[0].abbrev] || 0) + 1;
      dnf += r.cars.filter(c => c.retired).length;
      const fin = r.cars.filter(c => !c.retired).map(c => c.avgLap).sort((a, b) => a - b);
      if (fin.length > 1) { spread += fin[fin.length - 1] - fin[0]; n++; }
    }
    return { uniqueWinners: Object.keys(winners).length, topWin: Math.max(...Object.values(winners)),
      dnf: (dnf / races).toFixed(2), spread: (spread / n).toFixed(2), winners };
  };
  const easy = sample(0.55), hard = sample(1.0);
  console.log(`difficulty easy(0.55): ${easy.uniqueWinners} winners, top ${easy.topWin}/40, DNF ${easy.dnf}, spread ${easy.spread}`);
  console.log(`difficulty hard(1.00): ${hard.uniqueWinners} winners, top ${hard.topWin}/40, DNF ${hard.dnf}, spread ${hard.spread}`);
  console.log(`  -> expect easy has >= hard unique winners (more variety) and each DNF ~1-2.5`);
}
