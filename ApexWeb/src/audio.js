// ApexWeb/src/audio.js — tiny procedural SFX via WebAudio. No asset files.
// AudioContext is created lazily and resumed on the first user gesture (browsers
// block autoplay), so just call sfx.* from click handlers.
let actx = null;

function ac() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) actx = new AC();
  }
  if (actx && actx.state === "suspended") actx.resume();
  return actx;
}

function beep(freq, dur, type = "square", vol = 0.05, when = 0) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + when;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(c.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

export const sfx = {
  click() { beep(420, 0.045, "square", 0.035); },
  pit()   { beep(300, 0.12, "sawtooth", 0.07); beep(460, 0.12, "sawtooth", 0.06, 0.1); },
  ready() { beep(660, 0.1, "triangle", 0.06); },
  // F1-style start: five red lights, then lights out
  lightsOut() {
    for (let i = 0; i < 5; i++) beep(440, 0.14, "square", 0.06, i * 0.45);
    beep(880, 0.35, "square", 0.09, 2.4);
  },
};
