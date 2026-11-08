// Tiny synthesized sound kit (no audio files). Call unlock() from a user gesture
// once; every demo's shell does that on first tap.
let ac = null;
let muted = (() => { try { return localStorage.getItem('pl-muted') === '1'; } catch { return false; } })();
let noiseBuf = null;

function ctx() {
  if (!ac) {
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}

export function unlock() { ctx(); }
export function isMuted() { return muted; }
export function setMuted(m) { muted = m; try { localStorage.setItem('pl-muted', m ? '1' : '0'); } catch {} }

function tone(freq, dur, { type = 'sine', vol = 0.2, slide = 0, delay = 0, attack = 0.005 } = {}) {
  const a = ctx(); if (!a || muted) return;
  const t0 = a.currentTime + delay;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

function noise(dur, { vol = 0.2, freq = 1000, q = 1, type = 'bandpass', delay = 0, attack = 0.01, sweep = 0 } = {}) {
  const a = ctx(); if (!a || muted) return;
  const t0 = a.currentTime + delay;
  const src = a.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const f = a.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
  if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(50, freq + sweep), t0 + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t0, Math.random()); src.stop(t0 + dur + 0.05);
}

export const sfx = {
  click: () => tone(660, 0.06, { type: 'triangle', vol: 0.12 }),
  hover: () => tone(880, 0.04, { type: 'sine', vol: 0.05 }),
  card: () => { noise(0.12, { vol: 0.12, freq: 3000, q: 0.7, sweep: -1500 }); },
  deal: () => { noise(0.08, { vol: 0.08, freq: 4000, q: 1 }); },
  kick: () => { tone(140, 0.12, { type: 'sine', vol: 0.45, slide: -80 }); noise(0.05, { vol: 0.2, freq: 1800 }); },
  pass: () => { tone(200, 0.08, { type: 'sine', vol: 0.3, slide: -100 }); },
  thud: () => { tone(90, 0.18, { type: 'sine', vol: 0.5, slide: -50 }); noise(0.1, { vol: 0.25, freq: 400 }); },
  whistle: (n = 1) => { for (let i = 0; i < n; i++) { tone(2600, 0.22, { type: 'square', vol: 0.05, delay: i * 0.3 }); tone(2750, 0.22, { type: 'sine', vol: 0.08, delay: i * 0.3 }); } },
  roar: (k = 1) => { noise(1.6 * k, { vol: 0.22 * k, freq: 700, q: 0.5, attack: 0.15 }); noise(1.4 * k, { vol: 0.12 * k, freq: 1600, q: 0.6, attack: 0.2 }); },
  groan: () => { noise(1.1, { vol: 0.15, freq: 500, q: 0.8, sweep: -300, attack: 0.1 }); },
  ooh: () => { noise(0.8, { vol: 0.14, freq: 600, q: 1.2, sweep: 400, attack: 0.08 }); },
  goal: () => { sfx.roar(1.3); [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, { type: 'triangle', vol: 0.14, delay: 0.05 + i * 0.09 })); },
  save: () => { tone(220, 0.15, { type: 'square', vol: 0.08, slide: 120 }); sfx.ooh(); },
  coin: () => { tone(988, 0.08, { type: 'square', vol: 0.06 }); tone(1319, 0.2, { type: 'square', vol: 0.06, delay: 0.07 }); },
  good: () => { tone(660, 0.1, { type: 'triangle', vol: 0.15 }); tone(990, 0.15, { type: 'triangle', vol: 0.15, delay: 0.08 }); },
  perfect: () => { [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.12, { type: 'triangle', vol: 0.13, delay: i * 0.05 })); },
  bad: () => { tone(220, 0.25, { type: 'sawtooth', vol: 0.08, slide: -90 }); },
  whoosh: () => noise(0.35, { vol: 0.15, freq: 600, q: 0.8, sweep: 2500 }),
  cutin: () => { noise(0.4, { vol: 0.18, freq: 400, q: 0.6, sweep: 3000 }); tone(196, 0.5, { type: 'sawtooth', vol: 0.07 }); tone(294, 0.5, { type: 'sawtooth', vol: 0.05, delay: 0.05 }); },
  tick: () => tone(1200, 0.03, { type: 'square', vol: 0.04 }),
  win: () => { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.15, delay: i * 0.12 })); sfx.roar(1.5); },
  lose: () => { [392, 349, 311, 262].forEach((f, i) => tone(f, 0.35, { type: 'triangle', vol: 0.12, delay: i * 0.18 })); },
};
