// ApexWeb/src/main.js
import { Weekend } from "./weekend.js";
import { LocalNet, P2PNet } from "./net.js";
import { Race } from "./sim.js";
import { TEAMS, TRACK, STEP } from "./data.js";
import * as lobby from "./ui/lobby.js";
import * as practice from "./ui/practice.js";
import * as setup from "./ui/setup.js";
import * as quali from "./ui/quali.js";
import * as race from "./ui/race.js";
import { buildGrid } from "./quali.js";
import { paceBonus, closeness, trackIdeal } from "./setup.js";

const SCREENS = { lobby, practice, setup, quali, race, result: race };
const root = document.getElementById("app");

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

function rerender() { SCREENS[ctx.weekend.phase].render(root, ctx); }
ctx.weekend.onPhase = (phase) => {
  if (ctx.role === "host") { onPhaseHost(); ctx.net.send({ type: "phase", phase }); }
  rerender();
};

// HOST: handle inbound commands, run sim during race, broadcast snapshots
function onCommand(cmd) {
  if (ctx.role !== "host") return;
  switch (cmd.cmd) {
    case "ready":     ctx.weekend.setReady(cmd.player); break;
    case "set_pace":  ctx.race?.setPace(cmd.car, cmd.mode); break;
    case "set_ers":   ctx.race?.setErs(cmd.car, cmd.mode); break;
    case "request_pit": ctx.race?.requestPit(cmd.car, cmd.compound); break;
    case "toggle_pause": ctx.paused = !ctx.paused; break;
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
  // build field: player team's two drivers flagged, rest AI (filled in Task 15)
  // ctx.race = new Race(field, TRACK, seed); ctx.race.gridStart();
}
// build the full 22-car field: player team's two drivers flagged, rest AI.
// Reused by quali grid and the race start (Task 15).
function buildField() {
  let idx = 0;
  const ideal = trackIdeal(TRACK.laps * 1000 + Math.round(TRACK.lt));
  return TEAMS.flatMap((t, ti) => t.drivers.map((d, di) => {
    const isPlayerTeam = ti === ctx.teamIdx;
    const player = isPlayerTeam ? (di === 0 ? "p1" : "p2") : null;
    const setup = (player && ctx.setups && ctx.setups[player]) ? ctx.setups[player] : [0.5, 0.5, 0.5];
    return {
      idx: idx++, name: d.name, abbrev: d.abbrev, skill: d.skill, car: t.car, color: t.color,
      team: t.name, isPlayer: isPlayerTeam, player,
      setup, setupBonus: paceBonus(closeness(setup, ideal)), startTyre: "medium",
    };
  }));
}

// run every car's flying lap and broadcast the resulting grid to the client.
function broadcastQualiGrid() {
  const field = buildField().map(f => ({ ...f, risk: f.player ? (ctx.qrisk?.[f.player] ?? 0.5) : 0.5 }));
  const grid = buildGrid(field, TRACK, 1234);
  ctx.snapshot = { grid };
  if (ctx.role === "host") ctx.net.send({ type: "snapshot", grid });
  rerender();
}

function hostLoop() {
  if (ctx.role === "host" && ctx.weekend.phase === "race" && ctx.race && !ctx.paused) {
    ctx.race.step(STEP);
    ctx.net.send({ type: "snapshot", phase: "race", paused: ctx.paused,
      cars: ctx.race.order().map(c => ({ idx:c.idx, pos:c.pos, abbrev:c.abbrev, color:c.color,
        lap:c.lap, lapFrac:c.lapFrac, tyre:c.tyre, wear:c.wear, soc:c.soc, pace:c.pace,
        ers:c.ers, retired:c.retired, isPlayer:c.isPlayer })) });
  }
  requestAnimationFrame(hostLoop);
}

// CLIENT: render from snapshots; commands go to host
function onMessage(m) {
  if (m.type === "snapshot") { ctx.snapshot = m; rerender(); }
  if (m.type === "phase")    { ctx.weekend.phase = m.phase; rerender(); }
  if (ctx.role === "host" && m.type === "command") onCommand(m);
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
}

rerender();
