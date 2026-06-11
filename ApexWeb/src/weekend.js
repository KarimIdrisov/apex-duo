// ApexWeb/src/weekend.js
const ORDER = ["lobby", "practice", "setup", "quali", "race", "result"];

export class Weekend {
  constructor() {
    this.phase = "lobby";
    this.ready = { p1: false, p2: false };
    this.onPhase = null;                       // optional callback(phase)
  }
  start() { this._goto("practice"); }
  setReady(player) {
    if (player !== "p1" && player !== "p2") return;
    this.ready[player] = true;
    if (this.ready.p1 && this.ready.p2) this._advance();
  }
  _advance() {
    const i = ORDER.indexOf(this.phase);
    if (i >= 0 && i < ORDER.length - 1) this._goto(ORDER[i + 1]);
  }
  _goto(phase) {
    this.phase = phase;
    this.ready = { p1: false, p2: false };
    if (this.onPhase) this.onPhase(phase);
  }
}
