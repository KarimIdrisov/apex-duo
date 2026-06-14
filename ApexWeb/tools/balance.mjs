// ApexWeb/tools/balance.mjs
// calibrated 2026-06-11: DNF 1.10/race, pace spread 1.69 s/lap, winners
// NOR 38 / VER 1 / LEC 1 (top teams, some variety). Tuned in data.js:
// SKILL_K 3.0->7.0 (widen field to land spread in corridor),
// DNF_BASE 0.005->0.0075 (lift retirements into ~1-2 band). All 24 node:test pass.
import { Race } from "../src/sim.js";
import { TEAMS, TRACK, COMPOUNDS, QUALI2 } from "../src/data.js";
import { driverAttrs, composeCar, genPersonnel } from "../src/team.js";
import { newQuali, qualiStep, advanceSegment, finalGrid } from "../src/quali_session.js";

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

// start corridor: how much the field reshuffles on the opening lap (lower = quali grid respected;
// the standing start should be a modest launch shuffle, not a lap-1 lottery).
{
  let move = 0, races = 25;
  for (let s = 0; s < races; s++) {
    const r = new Race(field(), TRACK, 1000 + s);
    r.gridStart();
    const grid = Object.fromEntries(r.order().map(c => [c.idx, c.pos]));
    let g = 0; while (r.order()[0].lap < 2 && g++ < 50000) r.step();   // run to ~end of lap 1
    const l1 = Object.fromEntries(r.order().map(c => [c.idx, c.pos]));
    move += r.cars.reduce((a, c) => a + Math.abs((l1[c.idx] || 0) - (grid[c.idx] || 0)), 0) / r.cars.length;
  }
  console.log(`start: avg |grid→lap1| position change = ${(move / races).toFixed(2)} places/car (lower = quali order held; expect ~1-3)`);
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

// practice convergence corridor: a hands-on tuning policy (run stints, move sliders to the
// revealed window centre) should reach >=75% satisfaction after 3 sessions, and should
// clearly beat an auto-sim policy that never touches the sliders (hands-on rewarded).
{
  const { newSession, sendRun, step: pracStep, setAxis, autoSim, carView, sessionSnapshot } = await import("../src/practice_session.js");
  const { PRAC2 } = await import("../src/data.js");
  const { driverAttrs, composeCar } = await import("../src/team.js");

  function pracCars() {
    const t = TEAMS[0];
    const mk = di => ({ drv:{ skill:t.drivers[di].skill, attrs:driverAttrs(t.drivers[di].abbrev, t.drivers[di].skill) }, car:composeCar(t.car) });
    return { p1: mk(0), p2: mk(1) };
  }

  // honest player: each round, run a stint to bank knowledge, then move every slider to the
  // REVEALED window centre (from the snapshot — NOT the hidden ideal). Repeat across 3 sessions.
  function goodPolicy(seed) {
    let s = newSession(seed, pracCars()); s.paused = false; s.speed = 8;
    for (let sess = 1; sess <= 3; sess++) {
      for (let round = 0; round < 4 && s.clock > 0; round++) {
        s = sendRun(s, "p1", "soft", 10);
        let g = 0; while (s.cars.p1.onTrack && s.clock > 0 && g++ < 3000) s = pracStep(s, 1.0);
        const snap = sessionSnapshot(s);
        for (let i = 0; i < PRAC2.AXES; i++) setAxis(s, "p1", i, snap.cars.p1.axes[i].window.center);
      }
      s.session = sess + 1; s.clock = PRAC2.SESSION_SEC; s.cars.p1.onTrack = false;  // next session: reset clock, keep knowledge
    }
    // confirm the final setup with one short run
    s = sendRun(s, "p1", "soft", PRAC2.CONFIRM_LAPS + 1); let g = 0;
    while (s.cars.p1.onTrack && g++ < 500) s = pracStep(s, 1.0);
    return carView(s, "p1").satisfaction;
  }

  // lazy: never tune, just auto-sim all three sessions on the default 0.5 setup.
  function autoPolicy(seed) {
    let s = newSession(seed, pracCars());
    for (let sess = 1; sess <= 3; sess++) { s.clock = PRAC2.SESSION_SEC; s = autoSim(s, "p1"); }
    return carView(s, "p1").satisfaction;
  }

  let good = 0, auto = 0; const NP = 6;
  for (let k = 0; k < NP; k++) { good += goodPolicy(1000 + k); auto += autoPolicy(1000 + k); }
  good = good / NP; auto = auto / NP;
  console.log(`practice: good-policy satisfaction after 3 sessions = ${(good*100).toFixed(0)}%  (target >=75%, achievable)`);
  console.log(`practice: no-tune auto-sim satisfaction      = ${(auto*100).toFixed(0)}%  (target < good-policy: hands-on rewarded)`);
}

// quali grid-realism corridor: every session should classify all 22 cars with unique grid positions,
// the pole→P22 lap-time spread should be realistic (not a procession or chaos), and the track
// should rubber in across the session (positive track evolution).
{
  function qualiField() {
    let idx = 0;
    return TEAMS.flatMap(t => t.drivers.map(d => ({
      idx: idx++, abbrev: d.abbrev, drv: { skill: d.skill, attrs: driverAttrs(d.abbrev, d.skill) },
      car: composeCar(t.car), setupBonus: 0, player: null,   // all AI
    })));
  }
  function runQuali(seed) {
    let s = newQuali(seed, qualiField()); s.paused = false; s.speed = 8;
    const grip0 = s.grip;
    // each new segment starts paused (players plan); the harness presses play immediately to run Q2/Q3
    let g = 0; while (s.segment <= 3 && g++ < 30000) { s = qualiStep(s, 2.0); if (s.clock <= 0 && s.segment <= 3) { s = advanceSegment(s); s.paused = false; } }
    return { grid: finalGrid(s), gripGain: (s.grip - grip0) * QUALI2.GRIP_GAIN };
  }
  let spread = 0, gripGain = 0, ok = 0; const NQ = 6;
  for (let k = 0; k < NQ; k++) {
    const { grid, gripGain: gg } = runQuali(2000 + k);
    const classified = grid.length === 22 && new Set(grid.map(x => x.idx)).size === 22 && grid.every(x => x.time != null);
    if (classified) { ok++; spread += grid[21].time - grid[0].time; }
    gripGain += gg;
  }
  spread /= Math.max(1, ok); gripGain /= NQ;
  console.log(`quali: all 22 classified, unique positions = ${ok}/${NQ} sessions`);
  console.log(`quali: pole→P22 spread = ${spread.toFixed(2)} s/lap  (target ~1.5-5: racing, not a procession/chaos)`);
  console.log(`quali: track evolution over the session = ${gripGain.toFixed(2)} s  (rubbering effect)`);
}
