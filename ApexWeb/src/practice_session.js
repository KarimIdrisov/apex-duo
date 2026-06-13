// ApexWeb/src/practice_session.js — pure deterministic real-time practice session.
// State + step(dt) advancing laps in accelerated game-time, banking setup knowledge.
// Reuses the calibrated per-lap pace/deg math — no new pace numbers. Seeded → deterministic.
import { PRAC2, TRACK, COMPOUNDS, TYRE } from "./data.js";
import { practiceLapBase } from "./practice.js";
import { tyreTerm, warmStep } from "./tyres.js";
import { startFuel, weightTerm, burnFor } from "./fuel.js";
import { idealFor, axisSat, windowFor, feedbackFor } from "./setup.js";

const PLAYERS = ["p1", "p2"];

function newCar(seed, driverSeed, drvCar) {
  const ideal = idealFor(seed, driverSeed);
  return {
    drv: drvCar.drv, car: drvCar.car, ideal,
    setup: Array.from({ length: PRAC2.AXES }, () => 0.5),
    knowledge: Array.from({ length: PRAC2.AXES }, () => 0),
    lapsOnVal: Array.from({ length: PRAC2.AXES }, () => 0),
    confirmedSat: Array.from({ length: PRAC2.AXES }, () => 0),
    onTrack: false, compound: "soft", stintLeft: 0,
    wear: 0, temp: TYRE.gridTemp, fuel: startFuel(TRACK),
    totalLaps: 0, accl: 0, lapAcc: 0, strategy: { degByCompound: {} },
  };
}

export function newSession(seed, cars, session = 1) {
  return {
    seed: seed >>> 0, session, clock: PRAC2.SESSION_SEC, speed: 1, paused: true,
    cars: { p1: newCar(seed, 0, cars.p1), p2: newCar(seed, 1, cars.p2) },
  };
}

function feedbackMult(car) { return 0.75 + PRAC2.IQ_LEARN * (car.drv.attrs?.race_iq ?? 0.7); }

export function setAxis(s, player, i, value) {
  const car = s.cars[player]; if (!car) return s;
  car.setup[i] = Math.max(0, Math.min(1, value));
  car.lapsOnVal[i] = 0;                       // changing a value un-confirms it (must re-run)
  return s;
}

export function sendRun(s, player, compound, laps) {
  const car = s.cars[player]; if (!car) return s;
  car.compound = compound; car.stintLeft = laps; car.onTrack = true;
  car.wear = 0; car.temp = TYRE.pitTemp; car.fuel = startFuel(TRACK);
  return s;
}

// one completed flying lap for a car: bank knowledge, confirm axes, accumulate deg, burn fuel.
function completeLap(car) {
  const fm = feedbackMult(car);
  for (let i = 0; i < PRAC2.AXES; i++) {
    car.knowledge[i] = Math.min(1, car.knowledge[i] + PRAC2.KNOW_PER_LAP * fm);
    car.lapsOnVal[i] += 1;
    if (car.lapsOnVal[i] >= PRAC2.CONFIRM_LAPS) car.confirmedSat[i] = axisSat(car.setup[i], car.ideal[i]);
  }
  const comp = COMPOUNDS[car.compound];
  const lapT = practiceLapBase(car.drv, car.car, car.setup, car.ideal) + comp.pace
    + tyreTerm(car.compound, car.wear, car.temp) + weightTerm(car.fuel);
  const d = car.strategy.degByCompound[car.compound] || (car.strategy.degByCompound[car.compound] = { lapTimes: [], cliffLap: Math.round(comp.cliff / comp.wear), stintLaps: Math.round(comp.cliff / comp.wear) });
  d.lapTimes.push(lapT);
  car.wear += comp.wear; car.temp = warmStep(car.temp, car.compound); car.fuel -= burnFor("standard", car.car.fuel);
  car.totalLaps += 1; car.accl = Math.min(1, car.accl + PRAC2.ACCL_PER_LAP);
  car.stintLeft -= 1; if (car.stintLeft <= 0) car.onTrack = false;
}

const LAP_SEC = () => TRACK.lt;   // game-seconds per practice lap (approx clean lap)

// advance the session by dt real-seconds × speed; complete whole laps as game-time accrues.
export function step(s, dt) {
  if (s.paused || s.clock <= 0) return s;
  const adv = Math.min(s.clock, dt * s.speed);
  s.clock -= adv;
  for (const p of PLAYERS) {
    const car = s.cars[p];
    if (!car.onTrack) continue;
    car.lapAcc += adv;
    let guard = 0;
    while (car.lapAcc >= LAP_SEC() && car.onTrack && guard++ < 50) { car.lapAcc -= LAP_SEC(); completeLap(car); }
  }
  return s;
}

// read-only projection for tests/UI
export function carView(s, player) {
  const car = s.cars[player];
  return {
    setup: car.setup.slice(), knowledge: car.knowledge.slice(), confirmedSat: car.confirmedSat.slice(),
    ideal: car.ideal.slice(), onTrack: car.onTrack, compound: car.compound, stintLeft: car.stintLeft,
    totalLaps: car.totalLaps, accl: car.accl, strategy: car.strategy,
    satisfaction: car.confirmedSat.reduce((a, b) => a + b, 0) / PRAC2.AXES,
  };
}

export function setSpeed(s, v) { s.speed = PRAC2.SPEEDS.includes(v) ? v : s.speed; return s; }
export function setPaused(s, p) { s.paused = !!p; return s; }

// fast-forward a car's remaining clock running the current setup, at reduced knowledge rate.
export function autoSim(s, player) {
  const car = s.cars[player];
  const laps = Math.floor(s.clock / LAP_SEC());
  car.onTrack = true; car.stintLeft = Math.max(car.stintLeft, laps);
  for (let n = 0; n < laps; n++) {
    const fm = (0.75 + PRAC2.IQ_LEARN * (car.drv.attrs?.race_iq ?? 0.7)) * PRAC2.AUTOSIM_MULT;
    for (let i = 0; i < PRAC2.AXES; i++) {
      car.knowledge[i] = Math.min(1, car.knowledge[i] + PRAC2.KNOW_PER_LAP * fm);
      car.lapsOnVal[i] += 1;
      if (car.lapsOnVal[i] >= PRAC2.CONFIRM_LAPS) car.confirmedSat[i] = axisSat(car.setup[i], car.ideal[i]);
    }
    car.totalLaps += 1; car.accl = Math.min(1, car.accl + PRAC2.ACCL_PER_LAP);
  }
  car.onTrack = false; car.stintLeft = 0; s.clock = 0;
  return s;
}

export function sessionSnapshot(s) {
  const proj = (car, dseedIdx) => ({
    onTrack: car.onTrack, compound: car.compound, stintLeft: car.stintLeft, totalLaps: car.totalLaps,
    satisfaction: car.confirmedSat.reduce((a, b) => a + b, 0) / PRAC2.AXES, accl: car.accl,
    strategy: car.strategy,
    axes: car.setup.map((v, i) => {
      const win = windowFor(car.knowledge[i], car.ideal[i], s.seed + dseedIdx * 101, i);
      return { value: v, knowledge: car.knowledge[i], confirmedSat: car.confirmedSat[i],
        window: win, feedback: feedbackFor(v, win, car.knowledge[i], car.drv.attrs?.race_iq ?? 0.7) };
    }),
  });
  return { type: "snapshot", phase: "practice", session: s.session, clock: s.clock, speed: s.speed, paused: s.paused,
    cars: { p1: proj(s.cars.p1, 0), p2: proj(s.cars.p2, 1) } };
}
