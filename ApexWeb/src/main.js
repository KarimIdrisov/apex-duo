// ApexWeb/src/main.js
import { Weekend } from "./weekend.js";
import { LocalNet, P2PNet } from "./net.js";
import { Race } from "./sim.js";
import { TEAMS, TRACK, STEP, GRID_GAP } from "./data.js";
import * as lobby from "./ui/lobby.js";
import * as practice from "./ui/practice.js";
import * as quali from "./ui/quali.js";
import * as race from "./ui/race.js";
import { buildGrid } from "./quali.js";
import { paceBonus, closeness, trackIdeal } from "./setup.js";
import { driverAttrs, composeCar, genPersonnel } from "./team.js";
import { fuelLaps } from "./fuel.js";
import { sfx } from "./audio.js";

const SCREENS = { lobby, practice, quali, race, result: race };
const root = document.getElementById("app");
// any button press blips (and unlocks the AudioContext on first gesture)
root.addEventListener("click", e => { if (e.target.closest("button")) sfx.click(); });

export const ctx = {
  net: null, role: null, weekend: new Weekend(), race: null,
  myPlayer: null,            // "p1" (host car) | "p2" (client car)
  teamIdx: 0, snapshot: null,
  send(cmd) {
    const msg = { type: "command", ...cmd };
    if (this.role === "host") onCommand(msg);   // host applies its own input directly
    else this.net.send(msg);                    // client -> host
  },
};

function rerender() {
  const phase = ctx.weekend.phase;
  root.className = (phase === "race" || phase === "result") ? "wide" : "";  // wide 2-col race layout
  SCREENS[phase].render(root, ctx);
}
ctx.weekend.onPhase = (phase) => {
  if (ctx.role === "host") { onPhaseHost(); if (ctx.net) ctx.net.send({ type: "phase", phase }); }
  rerender();
};

// HOST: handle inbound commands, run sim during race, broadcast snapshots
function onCommand(cmd) {
  if (ctx.role !== "host") return;
  switch (cmd.cmd) {
    case "ready":     ctx.weekend.setReady(cmd.player); break;
    case "set_pace":  ctx.race?.setPace(cmd.car, cmd.mode); break;
    case "set_engine": ctx.race?.setEngine(cmd.car, cmd.mode); break;
    case "request_pit": ctx.race?.requestPit(cmd.car, cmd.compound); break;
    case "toggle_pause":
      ctx.paused = !ctx.paused;
      if (ctx.race) pushRaceState();   // reflect pause on both screens immediately
      break;
    case "set_speed":
      ctx.speed = cmd.value;
      if (ctx.race) pushRaceState();   // reflect new speed on both screens
      break;
    case "set_setup": ctx.setups = ctx.setups || {}; ctx.setups[cmd.player] = cmd.setup; break;
    case "quali_risk":
      ctx.qrisk = ctx.qrisk || {};
      ctx.qrisk[cmd.player] = cmd.risk;
      broadcastQualiGrid();
      break;
  }
}
function onPhaseHost() {
  if (ctx.weekend.phase === "race") startRaceHost();
}
function startRaceHost() {
  const field = buildField();
  // host picks the race seed once; the sim run stays fully deterministic from it
  if (ctx.seed == null) ctx.seed = 1000 + Math.floor(Math.random() * 100000);
  ctx.race = new Race(field, TRACK, ctx.seed);
  // apply the quali grid as the start order (fastest quali -> P1), spread by slot
  const withRisk = field.map(f => ({ ...f, risk: f.player ? (ctx.qrisk?.[f.player] ?? 0.5) : 0.5 }));
  const grid = buildGrid(withRisk, TRACK, 1234);
  grid.forEach((g, slot) => {
    const c = ctx.race.cars[g.idx];
    c.lap = 0; c.lapFrac = -slot * (GRID_GAP / TRACK.lt); c.startPos = slot + 1;
  });
  ctx.paused = false;
  ctx._frame = 0;
  ctx.speed = ctx.speed || 1;
}
// build the full 22-car field: player team's two drivers flagged, rest AI.
// Reused by quali grid and the race start (Task 15).
function buildField() {
  let idx = 0;
  const ideal = trackIdeal(TRACK.laps * 1000 + Math.round(TRACK.lt));
  return TEAMS.flatMap((t, ti) => t.drivers.map((d, di) => {
    const isPlayerTeam = ti === ctx.teamIdx;
    // solo: only p1 is human, the teammate car runs as AI (player null)
    const player = isPlayerTeam ? (di === 0 ? "p1" : (ctx.solo ? null : "p2")) : null;
    const setup = (player && ctx.setups && ctx.setups[player]) ? ctx.setups[player] : [0.5, 0.5, 0.5];
    return {
      idx: idx++, name: d.name, abbrev: d.abbrev, skill: d.skill,
      car: composeCar(t.car), color: t.color, team: t.name, isPlayer: isPlayerTeam, player,
      attrs: driverAttrs(d.abbrev, d.skill), personnel: genPersonnel(t.facility, ti),
      setup, setupBonus: paceBonus(closeness(setup, ideal)), startTyre: "medium",
    };
  }));
}

// run every car's flying lap and broadcast the resulting grid to the client.
function broadcastQualiGrid() {
  const field = buildField().map(f => ({ ...f, risk: f.player ? (ctx.qrisk?.[f.player] ?? 0.5) : 0.5 }));
  const grid = buildGrid(field, TRACK, 1234);
  ctx.snapshot = { grid };
  if (ctx.net) ctx.net.send({ type: "snapshot", grid });
  rerender();
}

// serialise the authoritative race state for the client + the host's own UI.
function raceSnapshot() {
  return {
    type: "snapshot", phase: "race", paused: ctx.paused, finished: ctx.race.finished,
    speed: ctx.speed || 1, scActive: ctx.race.scActive, wetness: ctx.race.wetness,
    cars: ctx.race.order().map(c => ({
      idx: c.idx, pos: c.pos, abbrev: c.abbrev, color: c.color, player: c.player,
      lap: c.lap, lapFrac: c.lapFrac, tyre: c.tyre, wear: c.wear,
      pace: c.pace, engine: c.engine, retired: c.retired, isPlayer: c.isPlayer,
      fuel: c.fuel, fuelLaps: fuelLaps(c.fuel, c.engine, c.car.fuel),
      pitStops: c.pitStops, tyreAge: c.tyreAge, tyreTemp: c.tyreTemp, lastLap: c.lastLap, startPos: c.startPos,
      miniColors: c.player ? c.miniColors : undefined, sectorTimes: c.player ? c.sectorTimes : undefined,
    })),
  };
}
function pushRaceState() {
  const snap = raceSnapshot();
  ctx.snapshot = snap;
  if (ctx.net) ctx.net.send(snap);
  rerender();
}
function hostLoop() {
  if (ctx.role === "host" && ctx.weekend.phase === "race" && ctx.race && !ctx.paused) {
    const steps = ctx.speed || 1;                           // 1x ≈ 15x realtime (~6 min); 2x/4x fast-forward
    for (let i = 0; i < steps && !ctx.race.finished; i++) ctx.race.step(STEP);
    if ((++ctx._frame % 5) === 0) pushRaceState();          // throttle broadcast/render to ~12 Hz
    if (ctx.race.finished) {
      pushRaceState();
      ctx.weekend.setReady("p1"); ctx.weekend.setReady("p2");  // race -> result (onPhase broadcasts)
    }
  }
  requestAnimationFrame(hostLoop);
}

// CLIENT: render from snapshots; commands go to host
function onMessage(m) {
  if (m.type === "snapshot") { ctx.snapshot = m; rerender(); }
  if (m.type === "phase")    { ctx.weekend.phase = m.phase; rerender(); }
  if (ctx.role === "host" && m.type === "command") onCommand(m);
  if (ctx.role === "host" && m.type === "hello") {
    if (ctx.weekend.phase === "lobby") {
      ctx.weekend.start();                                   // partner joined -> begin the weekend
    } else {                                                 // late joiner mid-weekend: resync
      ctx.net.send({ type: "phase", phase: ctx.weekend.phase });
      if (ctx.snapshot) ctx.net.send({ type: "snapshot", ...ctx.snapshot });
    }
  }
}

// connection entry points used by lobby UI
export async function hostGame(useP2P) {
  ctx.role = "host"; ctx.myPlayer = "p1";
  ctx.net = useP2P ? new P2PNet("host") : new LocalNet("dev", "host");
  ctx.net.onMessage(onMessage);
  const code = useP2P ? await ctx.net.host() : "dev";
  requestAnimationFrame(hostLoop);
  return code;
}
export async function joinGame(code, useP2P) {
  ctx.role = "client"; ctx.myPlayer = "p2";
  ctx.net = useP2P ? new P2PNet("client") : new LocalNet("dev", "client");
  ctx.net.onMessage(onMessage);
  if (useP2P) await ctx.net.join(code);
  ctx.net.send({ type: "hello" });   // ask the host to sync us to the current phase
}

// solo: single player engineers car p1; teammate + grid are AI. No network.
export function startSolo() {
  ctx.role = "host"; ctx.myPlayer = "p1"; ctx.solo = true; ctx.net = null;
  ctx.weekend.solo = true;
  requestAnimationFrame(hostLoop);
  ctx.weekend.start();
}

rerender();
