// Game sound through WebAudio. Recorded samples (assets/audio/<name>.mp3,
// made with ElevenLabs) are used when listed in FILES; any other effect falls
// back to a small synthesized version, so every sound name always plays.
// Music is one looping track per world plus a boss track.

const FILES = ['step', 'hit', 'fanfare', 'checkpoint', 'music_w1', 'music_w2', 'music_w3', 'music_w4', 'music_w5', 'music_boss'];

let ac = null;
let master, musicBus, sfxBus;
const buffers = {};
let noiseBuf = null;
let music = null; // { key, src, gain }
let wanted = null; // { key, rate, vol } requested before the context was unlocked
const prefs = { music: true, sfx: true };
let ducked = false;

try { Object.assign(prefs, JSON.parse(localStorage.getItem('codebattle.audio') || '{}')); } catch { /* private mode */ }

function savePrefs() {
  try { localStorage.setItem('codebattle.audio', JSON.stringify(prefs)); } catch { /* private mode */ }
}

/** Browsers only allow audio after a user gesture: call from one. */
export function unlock() {
  if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ac = new AC();
  master = ac.createGain();
  master.connect(ac.destination);
  musicBus = ac.createGain();
  musicBus.gain.value = prefs.music ? 0.42 : 0;
  musicBus.connect(master);
  sfxBus = ac.createGain();
  sfxBus.gain.value = prefs.sfx ? 0.85 : 0;
  sfxBus.connect(master);
  noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  for (const name of FILES) load(name);
}

async function load(name) {
  try {
    const res = await fetch(`assets/audio/${name}.mp3`);
    if (!res.ok) return;
    buffers[name] = await ac.decodeAudioData(await res.arrayBuffer());
    if (wanted && wanted.key === name) playMusic(wanted.key, wanted.rate, wanted.vol);
  } catch { /* missing or undecodable: the synth fallback covers it */ }
}

export function getPrefs() { return { ...prefs }; }

export function setPref(kind, on) {
  prefs[kind] = on;
  savePrefs();
  if (!ac) return;
  const bus = kind === 'music' ? musicBus : sfxBus;
  bus.gain.setTargetAtTime(on ? (kind === 'music' ? 0.42 : 0.85) : 0, ac.currentTime, 0.05);
}

/* ---------------- music ---------------- */

/** world: 1..5, or 'boss'. Falls back to the jungle track until the others exist. */
export function setMusic(world) {
  let key = world === 'boss' ? 'music_boss' : `music_w${world}`;
  let rate = 1;
  if (!FILES.includes(key)) { rate = world === 'boss' ? 1.08 : 1; key = 'music_w1'; }
  playMusic(key, rate, 1);
}

/** Quieter music behind menus and the pause screen. */
export function duckMusic(on) {
  if (on === ducked) return;
  ducked = on;
  if (!music) return;
  const g = music.gain.gain;
  const t = ac.currentTime;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(on ? 0.35 : 1, t + 0.4);
}

export function stopMusic() {
  wanted = null;
  if (!music) return;
  fadeOut(music);
  music = null;
}

function fadeOut(m) {
  const t = ac.currentTime;
  m.gain.gain.cancelScheduledValues(t);
  m.gain.gain.setValueAtTime(m.gain.gain.value, t);
  m.gain.gain.linearRampToValueAtTime(0, t + 1.2);
  m.src.stop(t + 1.3);
}

function playMusic(key, rate, vol) {
  wanted = { key, rate, vol };
  if (!ac || !buffers[key]) return;
  if (music && music.key === key && music.rate === rate) return;
  if (music) fadeOut(music);
  const src = ac.createBufferSource();
  src.buffer = buffers[key];
  src.loop = true;
  src.playbackRate.value = rate;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0, ac.currentTime);
  gain.gain.linearRampToValueAtTime(ducked ? vol * 0.35 : vol, ac.currentTime + 1.5);
  src.connect(gain).connect(musicBus);
  src.start();
  music = { key, rate, src, gain };
}

/* ---------------- effects ---------------- */

// recorded sample reused for a related effect: [file, rate, volume]
const ALIAS = {
  hit_heavy: ['hit', 0.72, 1.2],
  enemy_hurt: ['hit', 1.25, 0.5],
  takedown: ['hit', 0.6, 1.3],
};

const last = {};

/**
 * Play an effect. opts: vol (0..1+), pan (-1..1), rate.
 * The same sound can't restart within 40 ms, so a crowd of hits stays readable.
 */
export function sfx(name, opts = {}) {
  if (!ac || !prefs.sfx) return;
  const now = ac.currentTime;
  if (last[name] && now - last[name] < 0.04) return;
  last[name] = now;
  const out = ac.createGain();
  out.gain.value = opts.vol ?? 1;
  let node = out;
  if (opts.pan && ac.createStereoPanner) {
    const p = ac.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, opts.pan));
    out.connect(p);
    node = p;
  }
  node.connect(sfxBus);
  const [file, rate, vol] = ALIAS[name] || [name, 1, 1];
  if (buffers[file]) {
    const src = ac.createBufferSource();
    src.buffer = buffers[file];
    src.playbackRate.value = rate * (opts.rate ?? 1) * (0.96 + Math.random() * 0.08);
    out.gain.value *= vol;
    src.connect(out);
    src.start();
    return;
  }
  (SYNTH[name] || SYNTH[file])?.(out, now);
}

/* small synthesis kit */
function tone(out, t, { type = 'sine', f0, f1 = f0, dur, vol = 0.4, attack = 0.005 }) {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(out, t, { dur, vol = 0.4, type = 'lowpass', f0 = 1200, f1 = f0, q = 0.8, attack = 0.004 }) {
  const s = ac.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  const f = ac.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(out);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.02);
}

const SYNTH = {
  step: (o, t) => noise(o, t, { dur: 0.08, vol: 0.3, f0: 600 }),
  jump: (o, t) => {
    noise(o, t, { dur: 0.22, vol: 0.25, type: 'bandpass', f0: 600, f1: 2400, q: 1.2 });
    tone(o, t, { type: 'triangle', f0: 220, f1: 520, dur: 0.16, vol: 0.12 });
  },
  land: (o, t) => {
    noise(o, t, { dur: 0.16, vol: 0.5, f0: 380, f1: 120 });
    tone(o, t, { f0: 110, f1: 55, dur: 0.12, vol: 0.3 });
  },
  whoosh: (o, t) => noise(o, t, { dur: 0.2, vol: 0.32, type: 'bandpass', f0: 500, f1: 2600, q: 1.6, attack: 0.03 }),
  hit: (o, t) => {
    noise(o, t, { dur: 0.12, vol: 0.6, f0: 1800, f1: 300 });
    tone(o, t, { f0: 160, f1: 60, dur: 0.14, vol: 0.5 });
  },
  hurt: (o, t) => {
    tone(o, t, { type: 'square', f0: 420, f1: 150, dur: 0.22, vol: 0.14 });
    noise(o, t, { dur: 0.1, vol: 0.3, f0: 1500 });
  },
  enemy_die: (o, t) => {
    tone(o, t, { type: 'sawtooth', f0: 600, f1: 70, dur: 0.55, vol: 0.14 });
    for (let k = 0; k < 4; k++) tone(o, t + 0.06 * k, { type: 'square', f0: 900 + Math.random() * 900, dur: 0.04, vol: 0.06 });
    noise(o, t + 0.35, { dur: 0.2, vol: 0.35, f0: 300 });
  },
  block: (o, t) => {
    tone(o, t, { type: 'triangle', f0: 1250, f1: 1100, dur: 0.25, vol: 0.18 });
    tone(o, t, { type: 'triangle', f0: 1870, dur: 0.18, vol: 0.1 });
    noise(o, t, { dur: 0.07, vol: 0.4, type: 'highpass', f0: 2500 });
  },
  coin: (o, t) => {
    tone(o, t, { type: 'square', f0: 988, dur: 0.07, vol: 0.09 });
    tone(o, t + 0.065, { type: 'square', f0: 1319, dur: 0.22, vol: 0.09 });
  },
  gem: (o, t) => [1047, 1319, 1568, 2093].forEach((f, k) => tone(o, t + k * 0.06, { type: 'triangle', f0: f, dur: 0.3, vol: 0.14 })),
  heart: (o, t) => [523, 659, 784, 1047].forEach((f, k) => tone(o, t + k * 0.08, { f0: f, dur: 0.35, vol: 0.18 })),
  crate: (o, t) => {
    for (let k = 0; k < 4; k++) noise(o, t + k * 0.04, { dur: 0.12, vol: 0.4, type: 'bandpass', f0: 700 + k * 300, q: 2 });
    tone(o, t, { f0: 140, f1: 70, dur: 0.15, vol: 0.3 });
  },
  explosion: (o, t) => {
    noise(o, t, { dur: 1.1, vol: 0.9, f0: 2200, f1: 90, attack: 0.01 });
    tone(o, t, { f0: 90, f1: 32, dur: 0.8, vol: 0.6 });
  },
  blast: (o, t) => {
    tone(o, t, { type: 'sawtooth', f0: 180, f1: 1400, dur: 0.28, vol: 0.12 });
    tone(o, t + 0.05, { type: 'sine', f0: 900, f1: 1800, dur: 0.3, vol: 0.12 });
    noise(o, t, { dur: 0.45, vol: 0.3, type: 'bandpass', f0: 3000, f1: 800, q: 1.5 });
  },
  bolt: (o, t) => {
    tone(o, t, { type: 'triangle', f0: 520, f1: 260, dur: 0.18, vol: 0.2 });
    noise(o, t + 0.02, { dur: 0.25, vol: 0.25, type: 'bandpass', f0: 2500, f1: 900, q: 1.4 });
  },
  laser: (o, t) => tone(o, t, { type: 'square', f0: 1700, f1: 260, dur: 0.22, vol: 0.1 }),
  alert: (o, t) => {
    tone(o, t, { type: 'square', f0: 880, dur: 0.09, vol: 0.1 });
    tone(o, t + 0.1, { type: 'square', f0: 1320, dur: 0.18, vol: 0.1 });
  },
  chest: (o, t) => {
    tone(o, t, { type: 'sawtooth', f0: 90, f1: 140, dur: 0.6, vol: 0.06, attack: 0.1 });
    [784, 988, 1175, 1568, 1976].forEach((f, k) => tone(o, t + 0.6 + k * 0.09, { type: 'triangle', f0: f, dur: 0.6, vol: 0.12 }));
  },
  click: (o, t) => tone(o, t, { type: 'triangle', f0: 900, f1: 600, dur: 0.06, vol: 0.2 }),
  gameover: (o, t) => [392, 349, 311, 262].forEach((f, k) => tone(o, t + k * 0.28, { type: 'triangle', f0: f, dur: 0.5, vol: 0.2 })),
  rune: (o, t) => {
    tone(o, t, { f0: 70, f1: 220, dur: 0.7, vol: 0.4, attack: 0.3 });
    noise(o, t + 0.6, { dur: 0.4, vol: 0.4, f0: 1600, f1: 200 });
  },
  stomp: (o, t) => {
    tone(o, t, { f0: 85, f1: 38, dur: 0.35, vol: 0.7 });
    noise(o, t, { dur: 0.25, vol: 0.5, f0: 500, f1: 150 });
  },
  teleport: (o, t) => tone(o, t, { type: 'sine', f0: 1800, f1: 300, dur: 0.3, vol: 0.15 }),
};
