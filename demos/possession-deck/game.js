// Possession Deck — Slay the Spire, but each zone of the pitch is the "enemy".
// Cards deal Progress to the current zone. Break all five zones and you score.
import { Shell, clamp, shuffle, oddsPill } from '../../shared/shell.js';
import { byId } from '../../shared/cast.js';
import { drawPlayer, Pitch, drawBall, setupCanvas, spriteURL, portrait, lerp } from '../../shared/art.js';
import { sfx } from '../../shared/sfx.js';

// ------------------------------------------------------------------ data
const MINUTES_PER_TURN = 5;
const ZONES = [
  { key: 'def', name: 'Defense', short: 'DEF', hp: 12, v: 0.87, v0: 0.75, v1: 1.0, foes: ['viper', 'kofi'], pat: [['press', 5], ['compact', 4], ['press', 6]] },
  { key: 'mid', name: 'Midfield', short: 'MID', hp: 18, v: 0.64, v0: 0.53, v1: 0.75, foes: ['zed', 'marisol'], pat: [['compact', 5], ['press', 6], ['foul', 0], ['press', 7]] },
  { key: 'att', name: 'Attack', short: 'ATT', hp: 22, v: 0.43, v0: 0.32, v1: 0.53, foes: ['hans', 'nils'], pat: [['press', 7], ['compact', 6], ['press', 8]] },
  { key: 'box', name: 'Box', short: 'BOX', hp: 16, v: 0.22, v0: 0.12, v1: 0.32, foes: ['dima', 'lu'], pat: [['compact', 7], ['press', 9], ['foul', 0]] },
  { key: 'gk', name: 'Keeper', short: 'GK', hp: 20, v: 0.05, v0: 0.0, v1: 0.12, foes: ['oskar'], pat: [['compact', 6], ['press', 5], ['compact', 8]] },
];

// Card text helpers. `pn` = predicted progress vs the current zone, coloured
// when it differs from the printed base (Rhythm, Off-balance, Keeper rules).
const pn = (g, base, o = {}) => { const v = prog(g, base, o); return `<b class="${v > base ? 'up' : v < base ? 'dn' : ''}">${v}</b>`; };
const shotNote = (g) => (zoneOf(g)?.key === 'gk' ? '<small>×3 vs Keeper</small>' : '<small>×3 vs Keeper only</small>');

const DEF = {
  pass: { name: 'Short Pass', cost: 1, kind: 'attack', tags: ['pass'], art: ['kenji', 'pass'], base: 6,
    text: (g) => `Progress ${pn(g, 6)}.`, play: (g) => hit(g, 6) },
  shield: { name: 'Shield the Ball', cost: 1, kind: 'defend', art: ['mo', 'ready'], ctrl: 5,
    text: () => `+<b>5</b> Control.`, play: (g) => gainCtrl(g, 5) },
  dribble: { name: 'Dribble', cost: 2, kind: 'attack', art: ['pip', 'run'], base: 8,
    text: (g) => `Progress ${pn(g, 8)}. Zone is <b>Off-balance</b> 2 turns.`, play: (g) => { hit(g, 8); offbal(g, 2); } },
  shoot: { name: 'Shoot', cost: 1, kind: 'attack', tags: ['shot'], art: ['rio', 'kick'], base: 5,
    text: (g) => `Shot ${pn(g, 5, { shot: 1 })}.${shotNote(g)}`, play: (g) => hit(g, 5, { shot: 1 }) },
  through: { name: 'Through Ball', cost: 1, kind: 'attack', tags: ['pass'], art: ['lupe', 'pass'], base: 9,
    text: (g) => `Progress ${pn(g, 9)}. Ignores Compact.`, play: (g) => hit(g, 9, { pierce: 1 }) },
  tiki: { name: 'Tiki-Taka', cost: 1, kind: 'attack', tags: ['pass'], art: ['kenji', 'run'], base: 3,
    text: (g) => `Progress ${pn(g, 3 + 3 * g.passes)}. +3 per Pass played this turn.`, play: (g) => hit(g, 3 + 3 * g.passes) },
  switch: { name: 'Switch Play', cost: 1, kind: 'skill', tags: ['pass'], art: ['ada', 'pass'], ctrl: 3,
    text: () => `+<b>3</b> Control. Draw 2.`, play: (g) => { gainCtrl(g, 3); drawN(g, 2); } },
  overlap: { name: 'Overlap Run', cost: 1, kind: 'power', art: ['ada', 'run'], exhaust: true,
    text: () => `+2 <b>Rhythm</b>: every Progress and Shot +2 this attack.`, play: (g) => { g.rhythm += 2; g.fx.push({ t: 'buff', text: '+2 Rhythm' }); } },
  volley: { name: 'Volley', cost: 2, kind: 'attack', tags: ['shot'], art: ['sol', 'kick'], base: 9,
    text: (g) => `Shot ${pn(g, 9, { shot: 1 })}.${shotNote(g)}`, play: (g) => hit(g, 9, { shot: 1 }) },
  captain: { name: "Captain's Call", cost: 0, kind: 'skill', art: ['tomo', 'celebrate'], ctrl: 3, exhaust: true,
    text: () => `+1 Energy. +<b>3</b> Control. Once per attack.`, play: (g) => { g.energy += 1; gainCtrl(g, 3); } },
  rondo: { name: 'Rondo', cost: 1, kind: 'defend', tags: ['pass'], art: ['lupe', 'ready'], ctrl: 7,
    text: () => `+<b>7</b> Control. Draw 1 more next turn.`, play: (g) => { gainCtrl(g, 7); g.drawBonus += 1; } },
  nutmeg: { name: 'Nutmeg', cost: 0, kind: 'attack', art: ['pip', 'kick'], base: 3,
    text: (g) => `Progress ${pn(g, 3)}. Off-balance 1 turn.`, play: (g) => { hit(g, 3); offbal(g, 1); } },
  gegen: { name: 'Gegenpress', cost: 1, kind: 'attack', art: ['lupe', 'tackle'], base: 5,
    text: (g) => `Progress ${pn(g, 5)}. Cancels a <b>Press</b> intent.`, play: (g) => { hit(g, 5); rattle(g); } },
  rabona: { name: 'Rabona', cost: 1, kind: 'attack', tags: ['shot'], art: ['sol', 'kick'], base: 6,
    text: (g) => `Shot ${pn(g, 6, { shot: 1 })}. Free with 8+ Control.`, play: (g) => hit(g, 6, { shot: 1 }) },
  // Squad cards (rare, tied to a character)
  kenji: { name: 'Needle Pass', who: 'kenji', cost: 1, kind: 'rare', tags: ['pass'], art: ['kenji'], base: 10,
    text: (g) => `Progress ${pn(g, 10)}. Ignores Compact. Draw 1.`, play: (g) => { hit(g, 10, { pierce: 1 }); drawN(g, 1); } },
  rio: { name: 'Eagle Strike', who: 'rio', cost: 2, kind: 'rare', tags: ['shot'], art: ['rio'], base: 12,
    text: (g) => `Shot ${pn(g, 12, { shot: 1 })}. Finds the corner.${shotNote(g)}`, play: (g) => hit(g, 12, { shot: 1 }) },
  bruno: { name: 'Battering Ram', who: 'bruno', cost: 2, kind: 'rare', art: ['bruno'], base: 6,
    text: (g) => `Progress ${pn(g, 6 + g.control)}: 6 + your Control.`, play: (g) => hit(g, 6 + g.control) },
  pip: { name: 'Pinball Run', who: 'pip', cost: 1, kind: 'rare', art: ['pip'], base: 9,
    text: (g) => `Progress ${pn(g, 3)} three times.`, play: (g) => { hit(g, 3); hit(g, 3); hit(g, 3); } },
  ada: { name: 'Overlap Express', who: 'ada', cost: 1, kind: 'rare', art: ['ada'], base: 6,
    text: (g) => `Progress ${pn(g, 6)}. +1 Rhythm.`, play: (g) => { hit(g, 6); g.rhythm += 1; g.fx.push({ t: 'buff', text: '+1 Rhythm' }); } },
  tomo: { name: 'Clean Sweep', who: 'tomo', cost: 1, kind: 'rare', art: ['tomo'], ctrl: 8,
    text: () => `+<b>8</b> Control. Draw 1.`, play: (g) => { gainCtrl(g, 8); drawN(g, 1); } },
};
const COMMON_POOL = ['through', 'tiki', 'switch', 'overlap', 'volley', 'captain', 'rondo', 'nutmeg', 'gegen', 'rabona'];
const RARE_POOL = ['kenji', 'rio', 'bruno', 'pip', 'ada', 'tomo'];
const STARTER = ['pass', 'pass', 'pass', 'pass', 'shield', 'shield', 'shield', 'shield', 'dribble', 'shoot'];

const RELICS = {
  tiki: { name: 'Tiki Coach', icon: '📋', text: 'The first Pass you play each turn costs 0.' },
  engine: { name: 'Engine Room', icon: '🔋', text: 'Start every turn with 3 Control.' },
  late: { name: 'Late Show', icon: '🌙', text: 'From 75\', Shots get +2 base (×3 vs the keeper).' },
  wall: { name: 'Brick Wall', icon: '🧱', text: 'Counterattack stop chance +20%.' },
  arm: { name: 'Armband', icon: '🎗️', text: 'After a turnover, your Composure refills fully.' },
};

const PHASES = {
  early: { minute: 0, us: 0, them: 0, level: 0, comp: 24, zi: 0, deck: STARTER, relics: [], variant: 'day', body: '' },
  mid: { minute: 45, us: 1, them: 1, level: 1, comp: 14, zi: 1, variant: 'dusk', body: 'dusk',
    deck: [...STARTER, 'through', 'tiki', 'overlap', 'kenji', 'gegen'], relics: ['tiki'],
    top: ['tiki', 'pass', 'kenji', 'pass', 'shield'] },
  clutch: { minute: 75, us: 0, them: 1, level: 1, comp: 12, zi: 3, boxHp: 10, variant: 'night', body: 'floodlit',
    deck: ['pass', 'pass', 'pass', 'pass', 'shield', 'shield', 'shield', 'dribble', 'shoot', 'volley', 'rio', 'through', 'nutmeg', 'bruno', 'rondo'],
    relics: ['late'], top: ['through', 'pass', 'shoot', 'shield', 'rio'] },
};

// ------------------------------------------------------------------ rules (pure: run on clones for previews)
let g = null;

const zoneOf = (s) => (s.mode === 'counter' ? null : s.zones[s.zi] || null);

function intentFor(z, level) {
  const [type, v] = ZONES[z.i].pat[z.ix % ZONES[z.i].pat.length];
  return { type, v: type === 'foul' ? 0 : v + level };
}

function makeZones(level) {
  return ZONES.map((Z, i) => {
    const hp = Math.round(Z.hp * (1 + 0.2 * level));
    const z = { i, key: Z.key, name: Z.name, hp, max: hp, block: 0, ix: 0, off: 0 };
    z.intent = intentFor(z, level);
    return z;
  });
}

function prog(s, base, o = {}) {
  const z = zoneOf(s);
  let v = base + s.rhythm + (o.shot && s.relics.includes('late') && s.minute >= 75 ? 2 : 0);
  if (!z) return v;
  if (z.off > 0) v = Math.floor(v * 1.5);
  if (z.key === 'gk') v = o.shot ? v * 3 : Math.floor(v / 2);
  return Math.max(0, v);
}

// One hit of Progress. Every hit names the zone it landed on and the HP left,
// so the view can show each contact in order. Progress beyond what breaks a
// zone carries into the next zone (halved against the Keeper).
function hit(s, base, o = {}) {
  if (!zoneOf(s)) return 0;
  let v = prog(s, base, o), carry = false, total = 0;
  for (;;) {
    const z = zoneOf(s);
    if (!z) break;
    let blocked = 0;
    if (!o.pierce && z.block > 0) { blocked = Math.min(z.block, v); z.block -= blocked; v -= blocked; }
    const dealt = Math.min(z.hp, v);
    z.hp -= dealt; total += dealt;
    s.fx.push({ t: 'hit', zi: s.zi, v: dealt, blocked, hp: z.hp, shot: !!o.shot, pierce: !!o.pierce, carry });
    if (z.hp > 0) break;
    s.fx.push({ t: 'fall', zi: s.zi });
    s.zi += 1;
    if (s.zi >= s.zones.length) { s.mode = 'goal'; s.fx.push({ t: 'goal' }); break; }
    v -= dealt; carry = true;
    if (s.zones[s.zi].key === 'gk') v = Math.floor(v / 2);
    if (v <= 0) break;
  }
  return total;
}
function gainCtrl(s, n) { s.control += n; s.fx.push({ t: 'ctrl', v: n }); }
function offbal(s, n) { const z = zoneOf(s); if (z && z.hp > 0) { z.off = Math.max(z.off, n); s.fx.push({ t: 'buff', text: 'Off-balance!' }); } }
function rattle(s) {
  const z = zoneOf(s);
  if (z && z.hp > 0 && z.intent.type === 'press') { z.intent = { type: 'rattled', v: 0 }; s.fx.push({ t: 'buff', text: 'Press cancelled!' }); }
}
function drawN(s, n) {
  for (let k = 0; k < n; k++) {
    if (s.hand.length >= 10) return;
    if (!s.draw.length) {
      if (!s.disc.length) return;
      s.draw = shuffle(s.disc); s.disc = [];
      s.fx.push({ t: 'reshuffle' });
    }
    s.hand.push(s.draw.pop());
  }
}

function costOf(s, card) {
  const d = DEF[card.id];
  if (s.mode === 'play' && d.tags?.includes('pass') && s.relics.includes('tiki') && !s.tikiUsed) return 0;
  if (card.id === 'rabona' && s.control >= 8) return 0;
  return d.cost;
}
const defVal = (card) => { const d = DEF[card.id]; return (d.ctrl || 0) + Math.floor((d.base || 0) / 2); };

function playCard(s, idx) {
  const card = s.hand[idx];
  if (!card) return false;
  const d = DEF[card.id];
  const cost = costOf(s, card);
  if (cost > s.energy) return false;
  s.fx = [];
  s.energy -= cost;
  s.hand.splice(idx, 1);
  if (s.mode === 'counter') {
    s.counter.def += defVal(card);
    s.counter.played += 1;
    s.disc.push(card);
    return true;
  }
  if (d.tags?.includes('pass') && s.relics.includes('tiki')) s.tikiUsed = true;
  d.play(s);
  if (d.tags?.includes('pass')) s.passes += 1;
  (d.exhaust ? s.exh : s.disc).push(card);
  return true;
}

// The current zone acts on its intent. Pure: returns what happened.
function enemyPhase(s) {
  const z = s.zones[s.zi];
  z.block = 0;
  const it = z.intent;
  const ev = { type: it.type, v: it.v, zi: s.zi, absorbed: 0, dmg: 0 };
  if (it.type === 'press') {
    ev.absorbed = Math.min(s.control, it.v);
    ev.dmg = it.v - ev.absorbed;
    s.comp = Math.max(0, s.comp - ev.dmg);
    s.control -= ev.absorbed;
  } else if (it.type === 'compact') z.block += it.v;
  else if (it.type === 'foul') s.foul = 1;
  if (z.off > 0) z.off -= 1;
  z.ix += 1;
  z.intent = intentFor(z, s.level);
  s.minute += MINUTES_PER_TURN;
  return ev;
}

function startTurn(s, top) {
  s.turn += 1;
  s.control = s.relics.includes('engine') ? 3 : 0;
  s.energy = 3; s.passes = 0; s.tikiUsed = false;
  const n = 5 - s.foul + s.drawBonus;
  s.foul = 0; s.drawBonus = 0;
  s.fx = [];
  if (top) { // hand-authored opening hand
    for (const id of top) { const k = s.draw.findIndex((c) => c.id === id); if (k >= 0) s.hand.push(s.draw.splice(k, 1)[0]); }
    drawN(s, n - s.hand.length);
  } else drawN(s, n);
  ensureShot(s);
  return n;
}

// At the Keeper you always start the turn with a Shot if your deck has one:
// it swaps for the last card drawn (that card goes back on top of the draw pile).
function ensureShot(s) {
  const isShot = (c) => DEF[c.id].tags?.includes('shot');
  if (zoneOf(s)?.key !== 'gk' || s.hand.some(isShot)) return;
  for (const pile of [s.draw, s.disc]) {
    const k = pile.findIndex(isShot);
    if (k < 0) continue;
    const shot = pile.splice(k, 1)[0];
    if (s.hand.length) s.draw.push(s.hand.pop());
    s.hand.push(shot);
    s.fx.push({ t: 'buff', text: `Keeper: ${DEF[shot.id].name} drawn` });
    return;
  }
}

// New attack: every card goes back into the deck, zones reset.
function resetPossession(s) {
  s.draw = shuffle([...s.draw, ...s.hand, ...s.disc, ...s.exh]);
  s.hand = []; s.disc = []; s.exh = [];
  s.zones = makeZones(s.level); s.zi = 0; s.rhythm = 0; s.control = 0; s.foul = 0; s.drawBonus = 0;
  s.mode = 'play'; s.counter = null; s.carrier = 'kenji'; s.mate = 'lupe';
}

const stopChance = (s) => clamp(0.2 + (0.75 * s.counter.def) / s.counter.threat + (s.relics.includes('wall') ? 0.2 : 0), 0.05, 0.95);

// ------------------------------------------------------------------ shell + DOM
const shell = new Shell({
  id: 'possession-deck', title: 'Possession Deck',
  pitch: 'Slay the Spire on a football pitch. Each zone between you and the net is an enemy. Break all five to score.',
  how: [
    'You have <b>3 energy</b> and draw 5 cards a turn. Tap a card to select it, tap again (or Play) to use it. While a card plays, tapping another twice queues it (numbered badge).',
    '<b>Progress</b> lowers the zone\'s bar and moves the ball up the pitch. At 0 the zone breaks: Defense → Midfield → Attack → Box → Keeper. <b>Leftover Progress carries</b> into the next zone (halved against the Keeper).',
    'Read the zone\'s <b>intent</b> above its bar: <b>Press</b> — a defender closes down your player and hits your Composure. <b>Compact</b> — they squeeze together and gain block. <b>Foul</b> — one card fewer next turn.',
    '<b>Control</b> absorbs Press for one turn. The <b>Keeper</b> takes half from normal cards and <b>triple from Shots</b>. Against the Keeper you always start the turn holding a Shot, if your deck has one.',
    'Composure hits 0 → the presser wins the ball: <b>turnover</b>. Play cards to send your players back (each adds its 🛡), then <b>Face it</b> at the shown stop chance.',
    'After a goal pick 1 of 3 new cards, then a touchline stop. Keys: <span class="kbd">1–9</span> select, <span class="kbd">Enter</span> play, <span class="kbd">D</span> end turn, <span class="kbd">Z</span> undo.',
  ],
  notice: "Does 'zones as enemies' feel like building an attack, or like fighting monsters with a soccer skin?",
  phases: [
    { id: 'early', label: 'Kickoff', sub: "0' · 0–0 · starter deck" },
    { id: 'mid', label: 'Second half', sub: "45' · 1–1 · new cards + coach" },
    { id: 'clutch', label: 'Clutch', sub: "75' · 0–1 · floodlights" },
  ],
  onPhase: (id) => newGame(id),
});

const root = shell.stage;
root.innerHTML = `
<div class="pd">
  <div class="field"><canvas></canvas><div class="plate"></div><div class="relics"><div class="relic rhy off" title="Rhythm: + to every Progress and Shot this attack">♪<span>0</span></div><div class="perks"></div></div></div>
  <div class="status">
    <div class="energy"><span><b>3</b><small>/3</small></span></div>
    <div class="comp"><div class="lbl"><span>Composure</span><span class="why"></span></div><div class="bar"><i class="loss"></i><i class="cur"></i><b></b></div></div>
    <div class="pill ctrl"><small>Control</small>🛡 <span>0</span></div>
  </div>
  <div class="handwrap"><div class="hint"></div><div class="hand"></div></div>
  <div class="actions">
    <div class="piles"></div>
    <button class="btn small paper" data-a="undo">↶ Undo <span class="key">Z</span></button>
    <button class="btn small" data-a="play">Play <span class="key">⏎</span></button>
    <button class="btn red" data-a="end">End turn <span class="key">D</span></button>
  </div>
</div>`;

const $ = (q) => root.querySelector(q);
const fieldEl = $('.field'), cv = $('canvas'), plateEl = $('.plate'), handEl = $('.hand'), hintEl = $('.hint');
const relicsEl = $('.perks'), compEl = $('.comp'), energyEl = $('.energy'), ctrlEl = $('.ctrl'), rhyEl = $('.rhy');
const btnPlay = $('[data-a=play]'), btnEnd = $('[data-a=end]'), btnUndo = $('[data-a=undo]'), pilesEl = $('.piles');

let ctx, pitch, W = 360, H = 240;
function sizeCanvas() {
  W = Math.min(fieldEl.clientWidth - 6 || 360, 560);
  H = Math.round(clamp(W * 0.68, 230, 290));
  ctx = setupCanvas(cv, W, H);
  const variant = pitch?.variant || 'day';
  pitch = new Pitch(W, H, { variant });
}
sizeCanvas();
window.addEventListener('resize', () => { sizeCanvas(); render(); });

let undoStack = [];
let sel = null;

// ------------------------------------------------------------------ timing + tweens
// Every on-pitch motion is a tween with an arrival time, so two things that
// meet (ball and boot, ball and keeper's hands) are sent with the same time.
// ?jank=1 exposes window.__slow (0.25 = quarter speed) for checking contacts.
const DEBUG = new URLSearchParams(location.search).has('jank');
const TS = () => (DEBUG && window.__slow > 0 ? 1 / window.__slow : 1);
let gen = 0; // bumped by newGame: pending waits/tweens of an old game never resolve
function wait(ms) { const my = gen; return new Promise((r) => setTimeout(() => { if (my === gen) r(); }, ms * TS())); }
const EASE = { io: (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2), out: (k) => 1 - (1 - k) ** 2, lin: (k) => k };
let tweens = [];
function tween(o, to, ms, opt = {}) {
  for (const tw of tweens) if (tw.o === o) for (const k in to) delete tw.to[k];
  return new Promise((res) => {
    const from = {};
    for (const k in to) from[k] = o[k];
    tweens.push({ o, from, to, t0: performance.now(), d: Math.max(1, ms * TS()), ease: EASE[opt.ease || 'io'], arc: opt.arc || 0, res });
  });
}
function stepTweens(now) {
  const done = [];
  tweens = tweens.filter((tw) => {
    const k = Math.min(1, (now - tw.t0) / tw.d), e = tw.ease(k);
    for (const key in tw.to) tw.o[key] = tw.from[key] + (tw.to[key] - tw.from[key]) * e;
    if (tw.arc) tw.o.h = tw.arc * 4 * k * (1 - k);
    if (k >= 1) { if (tw.arc) tw.o.h = 0; done.push(tw.res); return false; }
    return true;
  });
  done.forEach((r) => r());
}

// ------------------------------------------------------------------ scene (actors on the pitch, normalised u/v)
const S = { fade: 1, ball: { u: 0.36, v: 0.9, h: 0, spin: 0 }, act: {}, holder: null, carrier: 'kenji', mate: 'lupe' };
const FOE_ZONE = {};
ZONES.forEach((Z, i) => Z.foes.forEach((f) => { FOE_ZONE[f] = i; }));
function A(key) {
  let a = S.act[key];
  if (!a) {
    const [side, id] = key.split(':');
    a = S.act[key] = { key, id, team: side === 'f' ? 'them' : 'us', u: 0.5, v: 0.5, alpha: 1, vis: side === 'f', lock: null, lockUntil: 0, lockFacing: null, cele: false, px: null, py: null, moving: 0, dir: null };
  }
  return a;
}
function pose(a, p, ms) { a.lock = p; a.lockUntil = performance.now() + ms * TS(); }
const sprSize = () => clamp(H * 0.13, 26, 40);
// Where the ball sits at a player's feet (ahead of them, in their attacking direction).
function footUV(p, team) {
  const [x, y] = pitch.toPx(p.u, p.v), sz = sprSize();
  const [u, v] = team === 'them' ? pitch.toUV(x + 0.3 * sz, y + 0.1 * sz) : pitch.toUV(x + 0.28 * sz, y - 0.12 * sz);
  return { u, v };
}
const dist = (a, b) => Math.hypot(a.u - b.u, a.v - b.v);
function approach(from, to, gap) { const d = dist(from, to) || 1; return { u: to.u + ((from.u - to.u) / d) * gap, v: to.v + ((from.v - to.v) / d) * gap }; }

// Layout: the ball's height up the pitch shows how much of the zone is broken.
const LANE = 0.36;
const RANGE = [[0.81, 0.75], [0.75, 0.53], [0.53, 0.32], [0.32, 0.13], [0.13, 0.085]];
function carrierAt(zi, hp, max) { if (zi >= 5) return { u: LANE, v: 0.085 }; const [a, b] = RANGE[zi]; return { u: LANE, v: a + (b - a) * (1 - hp / max) }; }
const carrierHome = (s) => (s.zi >= 5 ? carrierAt(5) : carrierAt(s.zi, s.zones[s.zi].hp, s.zones[s.zi].max));
function foeHome(s, i, k, bv) {
  const Z = ZONES[i];
  if (Z.key === 'gk') return { u: 0.5, v: 0.03 };
  const compact = i === s.zi && s.zones[i].block > 0;
  const u = (compact ? [0.25, 0.45] : [0.13, 0.45])[k]; // right-hand defender stays clear of the zone plate
  const v = i < s.zi ? Z.v0 + 0.025 : i === s.zi ? clamp(bv - 0.075, Z.v0 + 0.025, Z.v - 0.02) : Z.v - 0.02;
  return { u, v };
}
const mateHome = (bv) => ({ u: 0.24, v: Math.min(0.95, bv + 0.1) });
const WAK = { u: 0.5, v: 1.0 }; // on his line
function homes(s) {
  const c = carrierHome(s);
  const out = { ['u:' + S.carrier]: c, ['u:' + S.mate]: mateHome(c.v), 'u:wak': WAK };
  ZONES.forEach((Z, i) => Z.foes.forEach((id, k) => { out['f:' + id] = foeHome(s, i, k, c.v); }));
  return out;
}
// Chasers start where the turnover left them and close in on goal-side spots
// next to the runner; more defence = closer.
function chasePos(k, p) {
  const f = 0.2 + 0.8 * clamp((p - 0.2) / 0.6, 0, 1), cs = k.cs;
  // deep counters: the carrier closes from the side, the mate holds goal-side by the post (clear of Wak)
  const tc = k.deep ? { u: cs.u - 0.14, v: cs.v - 0.06 } : { u: cs.u - 0.13, v: cs.v + 0.03 };
  const tm = k.deep ? { u: k.m0.u + 0.08, v: k.m0.v - 0.04 } : { u: cs.u - 0.05, v: cs.v + 0.1 };
  const mix = (a, b) => ({ u: lerp(a.u, b.u, f), v: lerp(a.v, b.v, f) });
  return { c: mix(k.c0, tc), m: mix(k.m0, tm) };
}
// Place everyone for a state at once. Only used while the scene is faded out.
function snapScene(s) {
  tweens = tweens.filter((tw) => tw.o === S);
  for (const a of Object.values(S.act)) { if (a.team === 'us') a.vis = false; a.lock = null; a.cele = false; a.lockFacing = null; a.px = null; }
  S.carrier = s.carrier; S.mate = s.mate;
  for (const [k, p] of Object.entries(homes(s))) Object.assign(A(k), p, { vis: true, alpha: 1 });
  if (s.mode === 'counter' && s.counter) {
    const r = A('f:' + s.counter.runner);
    Object.assign(r, s.counter.cs);
    S.holder = r.key;
    const cp = chasePos(s.counter, stopChance(s));
    Object.assign(A('u:' + S.carrier), cp.c); Object.assign(A('u:' + S.mate), cp.m);
  } else S.holder = 'u:' + S.carrier;
  S.ball.h = 0;
  Object.assign(S.ball, footUV(A(S.holder), A(S.holder).team));
}
// Everyone jogs to where the state says they stand.
function settle(s, ms = 320) {
  return Promise.all(Object.entries(homes(s)).map(([k, p]) => (dist(A(k), p) < 0.002 ? null : tween(A(k), p, ms))));
}
const fadeTo = (a, ms) => tween(S, { fade: a }, ms);

// ------------------------------------------------------------------ game flow
let busy = false; // an action is animating: outcomes wait for their contact frame
let V = null; // what the HUD shows while busy (state before the action, patched at each contact)
let queue = [], hideUids = null; // queue: uids of cards tapped twice while an action plays
const view = () => V || g;
const clone = (o) => JSON.parse(JSON.stringify(o));

function newGame(id) {
  gen += 1; tweens = []; busy = false; V = null; queue = []; hideUids = null;
  clearTimeout(bannerAt.t); plateEl.style.opacity = '';
  const P = PHASES[id];
  document.body.className = P.body;
  pitch.setVariant(P.variant);
  let uid = 0;
  g = {
    phase: id, minute: P.minute, score: { us: P.us, them: P.them }, level: P.level,
    compMax: 40, comp: P.comp, control: 0, energy: 3, rhythm: 0, foul: 0, drawBonus: 0, passes: 0, tikiUsed: false,
    zones: makeZones(P.level), zi: P.zi, draw: shuffle(P.deck.map((cid) => ({ uid: ++uid, id: cid }))), hand: [], disc: [], exh: [],
    relics: [...P.relics], mode: 'play', carrier: 'kenji', mate: 'lupe', fx: [], turn: 0, counter: null, uid,
  };
  if (P.boxHp) {
    g.zones[3].hp = P.boxHp;
    for (const z of g.zones.slice(3)) { z.ix = 1; z.intent = intentFor(z, g.level); } // both open with a Press
  }
  undoStack = []; sel = null;
  startTurn(g, P.top);
  S.fade = 0; snapScene(g); fadeTo(1, 400);
  shell.setScore({ home: g.score.us, away: g.score.them, clock: `${g.minute}'` });
  const z = g.zones[g.zi];
  shell.log(`${id === 'clutch' ? 'Floodlights on. One down, three turns left.' : id === 'mid' ? 'Second half. Defense already broken — the ball is in Midfield.' : 'Kickoff. Break five zones to score.'}`, 'info', `${g.minute}'`);
  shell.log(`${z.name} intends <b>${intentLabel(z.intent)}</b>.`, 'them', `${g.minute}'`);
  render(true);
}

function snapshot() { g.carrier = S.carrier; g.mate = S.mate; undoStack.push(JSON.stringify(g)); if (undoStack.length > 30) undoStack.shift(); }

function selectCard(i) {
  if (!['play', 'counter'].includes(g.mode)) return;
  if (i < 0 || i >= g.hand.length || hideUids?.has(g.hand[i].uid)) return;
  if (sel === i) { playSelected(); return; }
  sel = i; sfx.hover(); // a single tap only selects, even while cards are queued
  render();
}

function playSelected() {
  if (sel == null || !['play', 'counter'].includes(g.mode)) return;
  const card = g.hand[sel];
  if (!card) return;
  if (costOf(g, card) > g.energy) { shell.toast('Not enough energy'); sfx.bad(); return; }
  if (busy) { if (!queue.includes(card.uid)) queue.push(card.uid); sel = null; sfx.hover(); render(); return; } // plays in order once the action lands
  const el = handEl.querySelector(`[data-i="${sel}"]`);
  const ghost = el ? ghostOf(el) : null;
  snapshot();
  const before = clone(g);
  const had = new Set(g.hand.map((c) => c.uid));
  playCard(g, sel);
  sel = null;
  hideUids = new Set(g.hand.filter((c) => !had.has(c.uid)).map((c) => c.uid)); // drawn cards appear when the card resolves
  V = before; busy = true;
  sfx.card();
  render();
  const my = gen;
  (g.mode === 'counter' ? animCounterCard(card, ghost) : animCard(card, ghost)).then(() => { if (my === gen) finishAction(); });
}

function finishAction() {
  V = null; busy = false;
  const fresh = hideUids; hideUids = null;
  g.carrier = S.carrier; g.mate = S.mate;
  render(fresh && fresh.size ? fresh : false);
  while (queue.length) {
    const k = g.hand.findIndex((c) => c.uid === queue[0]);
    queue.shift();
    if (k < 0 || !['play', 'counter'].includes(g.mode)) continue;
    if (costOf(g, g.hand[k]) > g.energy) { queue = []; shell.toast('Not enough energy for the queued card'); sfx.bad(); render(); break; }
    const keep = sel != null ? g.hand[sel]?.uid : null;
    sel = k; playSelected();
    if (keep != null) { const j = g.hand.findIndex((c) => c.uid === keep); sel = j >= 0 ? j : null; render(); }
    break;
  }
}

// ---- one card in attack: card → player → motion → contact → numbers
async function animCard(card, ghost) {
  const d = DEF[card.id], fx = g.fx, who = d.who || d.art[0];
  const acts = fx.some((f) => f.t === 'hit' || f.t === 'ctrl');
  if (acts) {
    const tgt = S.carrier === who || S.mate === who ? A('u:' + who) : mateHome(A('u:' + S.carrier).v);
    await Promise.all([flyTo(ghost, pitchClient(tgt), 220), getBall(who)]);
  } else await flyTo(ghost, centerOf(rhyEl), 260);
  const kind = d.tags?.includes('shot') ? 'shot' : d.tags?.includes('pass') ? 'pass' : 'carry';
  for (const f of fx) {
    if (f.t === 'hit') await animHit(f, kind);
    else if (f.t === 'fall') contactFall(f);
    else if (f.t === 'ctrl') await animCtrl(f);
    else if (f.t === 'buff') applyBuff(f);
    else if (f.t === 'goal') { logCard(d, fx, card); await goalSequence(); return; }
  }
  logCard(d, fx, card);
  settle(g, 300); // players drift back to shape while the next card can already go
}

function logCard(d, fx, card) {
  const parts = [];
  for (const f of fx) {
    if (f.t === 'hit') parts.push(`${f.carry ? `carries into ${g.zones[f.zi]?.name || 'goal'}` : f.shot ? 'Shot' : 'Progress'} <b>${f.v}</b>${f.blocked ? ` (${f.blocked} blocked by Compact)` : ''}${f.pierce ? ' — ignored Compact' : ''}`);
    else if (f.t === 'ctrl') parts.push(`+${f.v} Control`);
    else if (f.t === 'buff') parts.push(f.text);
    else if (f.t === 'reshuffle') parts.push('discard reshuffled into draw');
  }
  const why = [];
  const first = fx.find((f) => f.t === 'hit');
  if (first) {
    if (ZONES[first.zi].key === 'gk') why.push(d.tags?.includes('shot') ? 'Keeper takes ×3 from Shots' : 'Keeper halves non-Shots');
    if (g.rhythm) why.push(`Rhythm +${g.rhythm}`);
  }
  shell.log(`<b>${d.who ? byId[d.who].name + ': ' : ''}${d.name}</b> — ${parts.join(', ') || 'played'}${why.length ? ` <i>(${why.join('; ')})</i>` : ''}.`, '', `${g.minute}'`);
}

// The card's player gets the ball first: a pass from whoever has it.
async function getBall(id) {
  if (S.carrier === id) return;
  if (S.mate !== id) { // a new teammate arrives in the support spot; the old one drifts away
    const old = A('u:' + S.mate), nu = A('u:' + id), mh = mateHome(A('u:' + S.carrier).v);
    Object.assign(nu, { u: mh.u + 0.1, v: mh.v + 0.17, alpha: 0, vis: true, cele: false, lock: null, px: null });
    tween(old, { u: -0.08, v: old.v - 0.03, alpha: 0 }, 280).then(() => { if (S.mate !== old.id && S.carrier !== old.id) old.vis = false; });
    S.mate = id;
    await tween(nu, { u: mh.u, v: mh.v, alpha: 1 }, 260);
  }
  const c = A('u:' + S.carrier), m = A('u:' + id);
  m.lock = null;
  pose(c, 'pass', 260); sfx.pass();
  S.holder = null;
  await tween(S.ball, footUV(m, 'us'), 240, { ease: 'out' });
  S.holder = m.key;
  [S.carrier, S.mate] = [id, S.carrier];
  tween(c, mateHome(m.v), 380); // the passer drops into support, out of the ball's path
}

async function animHit(f, kind) {
  const zi = f.zi, Z = ZONES[zi], vz = V.zones[zi];
  const c = A('u:' + S.carrier), m = A('u:' + S.mate);
  const shot = kind === 'shot';
  if (Z.key === 'gk' && (shot || f.hp === 0)) return animKeeper(f, shot);
  if (f.carry && !shot) kind = 'carry';
  const P = carrierAt(zi, f.hp, vz.max);
  const after = { ...V, zones: V.zones.map((z, i) => (i === zi ? { ...z, hp: f.hp, block: Math.max(0, z.block - f.blocked) } : z)) };
  const foes = Z.foes.map((id, k) => ({ a: A('f:' + id), to: foeHome(after, zi, k, P.v) }));
  const nearestFoe = (p) => foes.reduce((b, x) => (dist(x.a, p) < dist(b.a, p) ? x : b));
  const T = clamp(200 + dist(c, P) * 700, 260, 440);

  if (f.v === 0) { // fully blocked: a defender steps into the ball's path, ball comes back
    const meet = { u: S.ball.u, v: S.ball.v - 0.07 };
    const b = nearestFoe(meet);
    S.holder = null; pose(c, shot ? 'kick' : 'pass', 260); shot ? sfx.kick() : sfx.pass();
    await Promise.all([tween(S.ball, meet, 260, { arc: shot ? 6 : 0 }), tween(b.a, { u: meet.u + 0.02, v: meet.v - 0.012 }, 260)]);
    pose(b.a, 'ready', 400);
    contactHit(f);
    await tween(S.ball, footUV(c, 'us'), 220, { ease: 'out' });
    S.holder = c.key;
    tween(b.a, b.to, 300);
    return;
  }
  if (kind === 'pass') { // played into space; the teammate runs onto it
    pose(c, 'pass', 260); sfx.pass(); S.holder = null; m.lock = null;
    await Promise.all([tween(S.ball, footUV(P, 'us'), T, { ease: 'out' }), tween(m, P, T), ...foes.map((x) => tween(x.a, x.to, T))]);
    S.holder = m.key;
    [S.carrier, S.mate] = [S.mate, S.carrier];
  } else if (shot && f.hp > 0) { // shot charged down: ball and blocker meet at P
    const M = footUV(P, 'us'), b = nearestFoe(M);
    pose(c, 'kick', 320); sfx.kick(); S.holder = null;
    await Promise.all([
      tween(S.ball, M, T * 0.8, { arc: 7, ease: 'lin' }),
      tween(b.a, { u: M.u + 0.02, v: M.v - 0.012 }, T * 0.8),
      ...foes.filter((x) => x !== b).map((x) => tween(x.a, x.to, T * 0.8)),
    ]);
    pose(b.a, 'ready', 450);
    contactHit(f);
    await wait(90);
    await tween(c, P, 220);
    S.holder = c.key;
    tween(b.a, b.to, 320);
    return;
  } else if (shot) { // shot breaks the zone: over the top, shooter chases it
    pose(c, 'kick', 320); sfx.kick(); S.holder = null;
    await Promise.all([tween(S.ball, footUV(P, 'us'), T, { arc: 10, ease: 'out' }), tween(c, P, T), ...foes.map((x) => tween(x.a, x.to, T))]);
    S.holder = c.key;
  } else { // carry: the ball stays at the player's feet
    await Promise.all([tween(c, P, T), ...foes.map((x) => tween(x.a, x.to, T))]);
  }
  contactHit(f);
  await wait(100);
}

// A keeper reads the strike, then dives: he leaves after the ball and arrives with it.
async function diveTo(k, to, T, hold) {
  pose(k, 'ready', T * 0.35);
  await wait(T * 0.35);
  pose(k, 'dive', hold);
  await tween(k, to, T * 0.65, { ease: 'out' });
}

// Shots at the keeper: hands and ball arrive together. Breaking the keeper = into the net.
async function animKeeper(f, shot) {
  const k = A('f:oskar'), c = A('u:' + S.carrier), sz = sprSize();
  const side = Math.random() < 0.5 ? -1 : 1;
  S.holder = null; pose(c, shot ? 'kick' : 'pass', 320); shot ? sfx.kick() : sfx.pass();
  if (f.hp > 0) {
    const SP = { u: 0.5 + side * 0.08, v: 0.045 };
    const [sx, sy] = pitch.toPx(SP.u, SP.v);
    const [ku, kv] = pitch.toUV(sx - side * sz * 0.7, sy + sz * 0.12);
    k.lockFacing = side > 0 ? -1 : 1;
    await Promise.all([tween(S.ball, SP, 300, { arc: shot ? 9 : 0, ease: 'lin' }), diveTo(k, { u: ku, v: kv }, 300, 600)]);
    contactHit(f);
    await wait(110);
    const P = carrierAt(4, f.hp, V.zones[4].max);
    tween(k, { u: 0.5, v: 0.03 }, 520);
    await Promise.all([tween(S.ball, footUV(P, 'us'), 260, { arc: 10, ease: 'out' }), tween(c, P, 280)]);
    S.holder = c.key;
  } else {
    k.lockFacing = side > 0 ? 1 : -1;
    await Promise.all([tween(S.ball, { u: 0.5 + side * 0.06, v: -0.04 }, 340, { arc: shot ? 9 : 0, ease: 'lin' }), diveTo(k, { u: 0.5 - side * 0.03, v: 0.04 }, 340, 1500)]);
    contactHit(f);
  }
}

function contactHit(f) {
  const z = V.zones[f.zi];
  z.hp = f.hp; z.block = Math.max(0, z.block - f.blocked);
  const r = plateEl.getBoundingClientRect(), fr = fieldEl.getBoundingClientRect();
  shell.popupAt(fieldEl, r.left - fr.left + r.width / 2, r.top - fr.top + 10, f.v ? `-${f.v}` : 'BLOCKED', f.shot ? '#ffd23f' : '#fff');
  if (f.blocked) shell.popupAt(fieldEl, r.left - fr.left + 20, r.top - fr.top + 30, `🛡${f.blocked}`, '#81d4fa');
  bump(plateEl, 'hit');
  if (f.v) { sfx.thud(); ZONES[f.zi].foes.forEach((id) => { const a = A('f:' + id); if (!a.lock || performance.now() > a.lockUntil) pose(a, 'sad', 350); }); } else sfx.save();
  render();
}

function contactFall(f) {
  V.zi = f.zi + 1;
  if (V.zi >= 5) { V.mode = 'goal'; V.scorer = S.carrier; }
  const Z = V.zones[f.zi];
  sfx.whoosh(); pitch.excite = 0.6;
  const nx = V.zones[V.zi];
  shell.log(`<b>${Z.name} broken!</b> ${nx ? `Ball moves into the ${nx.name} zone, which intends ${intentLabel(g.zones[V.zi].intent)}.` : ''}`, 'good', `${g.minute}'`);
  if (nx) shell.toast(`${Z.name} broken → ${nx.name}`, 1200);
  render();
}

// Control: your player shields; the nearest defender closes in and bounces off.
async function animCtrl(f) {
  const c = A('u:' + S.carrier);
  pose(c, 'ready', 700);
  const s = view(), Z = ZONES[s.zi];
  let fo = null;
  if (Z && Z.key !== 'gk') fo = Z.foes.map((id) => A('f:' + id)).reduce((b, x) => (dist(x, c) < dist(b, c) ? x : b));
  const home = fo && { u: fo.u, v: fo.v };
  if (fo) await tween(fo, approach(fo, c, 0.075), 200);
  V.control += f.v;
  const r = ctrlEl.getBoundingClientRect();
  shell.popup(`+${f.v}`, r.left + r.width / 2, r.top, '#81d4fa');
  bump(ctrlEl, 'pop'); sfx.good();
  render();
  if (fo) tween(fo, home, 320);
  await wait(110);
}

function applyBuff(f) {
  V.zones.forEach((z, i) => { z.off = g.zones[i].off; z.intent = g.zones[i].intent; });
  if (V.rhythm !== g.rhythm) bump(rhyEl, 'pop');
  V.rhythm = g.rhythm;
  shell.toast(f.text, 900);
  render();
}

async function goalSequence() {
  const scorer = A('u:' + S.carrier), mate = A('u:' + S.mate);
  undoStack = [];
  g.carrier = S.carrier;
  pitch.goal(true);
  g.score.us += 1;
  sfx.goal(); shell.flash('#fff'); shell.shake(fieldEl); shell.confetti();
  shell.banner('GOAL!', `${byId[g.carrier].name} finishes it · ${g.score.us}–${g.score.them}`);
  shell.setScore({ home: g.score.us, away: g.score.them, clock: `${g.minute}'` });
  shell.log(`<b>GOAL!</b> ${byId[g.carrier].name} scores after breaking all five zones. ${g.score.us}–${g.score.them}.`, 'goal', `${g.minute}'`);
  render();
  scorer.cele = true; mate.cele = true;
  tween(scorer, { u: 0.2, v: 0.2 }, 900); tween(mate, { u: 0.27, v: 0.27 }, 1100);
  await wait(1700);
  await fadeTo(0, 350);
  // reward: pick 1 of 3
  const offer = rewardOffer();
  const choice = await pickOverlay('Pick a card', 'Added to your deck for the next attack.', offer.map((id, i) => cardHTML({ id, uid: -1 }, i, true)), true);
  if (choice >= 0) {
    g.draw.push({ uid: ++g.uid, id: offer[choice] });
    shell.log(`Added <b>${DEF[offer[choice]].name}</b> to the deck.`, 'good', `${g.minute}'`);
    sfx.coin();
  }
  await runMapStop();
  g.level += 1;
  resetPossession(g);
  g.minute += MINUTES_PER_TURN;
  hideUids = null;
  V = null; // the HUD and pitch switch to the new attack while the scene is covered
  snapScene(g);
  shell.log(`New attack from the back. Redrock regroup: every zone is tougher now.`, 'info', `${g.minute}'`);
  if (checkFullTime()) { await fadeTo(1, 350); return; }
  startTurn(g);
  render(true);
  await fadeTo(1, 350);
}

function rewardOffer() {
  const out = [];
  const pool = shuffle(COMMON_POOL), rares = shuffle(RARE_POOL);
  for (let i = 0; i < 3; i++) out.push(Math.random() < 0.3 ? rares.pop() : pool.pop());
  return out;
}

async function runMapStop() {
  const owned = g.relics;
  const avail = Object.keys(RELICS).filter((k) => !owned.includes(k));
  const nodes = [
    { ic: '🩹', h: 'Physio', p: `+12 Composure (now ${g.comp}/${g.compMax}).` },
    { ic: '📋', h: 'Coach', p: avail.length ? 'Choose 1 of 2 coach perks.' : 'No coaches left.' },
    { ic: '🏃', h: 'Training', p: 'Remove one Short Pass or Shield from your deck.' },
  ];
  const map = `<div class="runmap"><span>Goal ${g.score.us}</span>▸<span class="on">Touchline stop</span>▸<span>Next attack</span>▸<span>Full time</span></div>`;
  const k = await pickOverlay('Touchline', map, nodes.map((n) => `<div class="node"><div class="ic">${n.ic}</div><h4>${n.h}</h4><p>${n.p}</p></div>`), true);
  if (k === 0) { g.comp = Math.min(g.compMax, g.comp + 12); shell.log('Physio: <b>+12 Composure</b>.', 'good'); sfx.good(); }
  if (k === 1 && avail.length) {
    const two = shuffle(avail).slice(0, 2);
    const r = await pickOverlay('Coach perk', 'Coach perks last the whole match.', two.map((id) => `<div class="node"><div class="ic">${RELICS[id].icon}</div><h4>${RELICS[id].name}</h4><p>${RELICS[id].text}</p></div>`), true);
    if (r >= 0) { g.relics.push(two[r]); shell.log(`Coach perk: <b>${RELICS[two[r]].name}</b> — ${RELICS[two[r]].text}`, 'good'); sfx.perfect(); }
  }
  if (k === 2) {
    const all = [g.draw, g.hand, g.disc, g.exh];
    for (const id of ['pass', 'shield']) {
      const pile = all.find((p) => p.some((c) => c.id === id));
      if (pile) { pile.splice(pile.findIndex((c) => c.id === id), 1); shell.log(`Training: removed a <b>${DEF[id].name}</b>. Thinner deck, better draws.`, 'good'); break; }
    }
  }
}

// ---- rival turn: the defender moves first, the number lands on contact
async function endTurn() {
  if (busy) return;
  if (g.mode === 'counter') { resolveCounter(); return; }
  if (g.mode !== 'play') return;
  busy = true; sel = null; undoStack = []; queue = [];
  discardHand();
  g.disc.push(...g.hand); g.hand = [];
  g.mode = 'enemy';
  render();
  await wait(200);
  V = clone(g);
  const ev = enemyPhase(g);
  V.zones[ev.zi].block = 0;
  render();
  const winner = await animEnemy(ev);
  shell.setScore({ home: g.score.us, away: g.score.them, clock: `${g.minute}'` });
  if (g.comp <= 0) { await startCounter(winner); busy = false; render(true); return; }
  V = null;
  render();
  settle(g, 320);
  if (checkFullTime()) { busy = false; return; }
  g.mode = 'play';
  const n = startTurn(g);
  const note = g.fx.find((f) => f.t === 'buff');
  shell.log(`Turn ${g.turn}: drew ${g.hand.length}${n < 5 ? ' (fouled)' : ''}${note ? ` — ${note.text}` : ''}. ${g.zones[g.zi].name} now intends <b>${intentLabel(g.zones[g.zi].intent)}</b>.`, 'info', `${g.minute}'`);
  if (note) shell.toast(note.text, 1100);
  sfx.deal();
  busy = false;
  render(true);
}

// Slides and tackles lead with the boots: the sprite lies toward -facing with
// its boots at the feet anchor, so face the ball and put the feet beside it.
function bootsAt(a, ball) {
  const f = ball.u >= a.u ? 1 : -1;
  a.lockFacing = f;
  return { u: ball.u - f * 0.025, v: ball.v - 0.004 };
}

async function animEnemy(ev) {
  const Z = ZONES[ev.zi], z = V.zones[ev.zi], c = A('u:' + S.carrier), t = `${V.minute}'`;
  const foes = Z.foes.map((id) => A('f:' + id));
  // the ball sits ahead-right of our carrier (away from the support player), so the defender on that open side makes the challenge
  const open = { u: S.ball.u + 0.08, v: S.ball.v };
  const fo = foes.reduce((b, x) => (dist(x, open) < dist(b, open) ? x : b));
  const home = { u: fo.u, v: fo.v };
  // deep in our half Wak shuffles across his line, away from where the challenge lands
  const wak = A('u:wak'), deep = (ev.type === 'press' || ev.type === 'foul') && c.v > 0.7;
  if (deep) tween(wak, { u: 0.62 }, 300);
  if (ev.type === 'press') {
    const to = bootsAt(fo, S.ball);
    await Promise.all([tween(fo, to, 320), wait(180).then(() => pose(fo, 'tackle', 560))]); // lunges in the last stride
    V.comp = g.comp; V.control = g.control;
    if (ev.dmg) {
      pose(c, 'sad', 700); sfx.thud(); bump(compEl, 'hurt'); shell.shake(fieldEl);
      const r = compEl.getBoundingClientRect(); shell.popup(`-${ev.dmg}`, r.left + r.width / 2, r.top, '#ff8a7a');
    } else { pose(c, 'ready', 600); sfx.save(); }
    if (ev.absorbed) { const r = ctrlEl.getBoundingClientRect(); shell.popup(`🛡${ev.absorbed}`, r.left + r.width / 2, r.top, '#81d4fa'); }
    shell.log(`${z.name} <b>press ${ev.v}</b>: ${byId[fo.id].name} closes down ${byId[c.id].name}. Control absorbed ${ev.absorbed}, you lose <b>${ev.dmg}</b> Composure (${g.comp} left).`, 'them', t);
    render();
    await wait(220);
    if (g.comp <= 0) { // the presser takes it off our player's feet
      S.holder = null;
      await tween(S.ball, footUV(fo, 'them'), 180, { ease: 'out' });
      S.holder = fo.key;
      if (deep) tween(wak, { u: WAK.u }, 420);
      return fo;
    }
    tween(fo, home, 340);
  } else if (ev.type === 'compact') {
    await Promise.all(foes.map((a, k) => tween(a, foeHome(g, ev.zi, k, c.v), 320)));
    V.zones[ev.zi].block = g.zones[ev.zi].block;
    const r = plateEl.getBoundingClientRect(), fr = fieldEl.getBoundingClientRect();
    shell.popupAt(fieldEl, r.left - fr.left + 30, r.top - fr.top + 20, `🛡+${ev.v}`, '#81d4fa');
    sfx.save();
    shell.log(`${z.name} go <b>compact</b>: +${ev.v} block. Through balls ignore it.`, 'them', t);
    render();
    await wait(150);
  } else if (ev.type === 'foul') {
    const to = bootsAt(fo, S.ball);
    pose(fo, 'slide', 650);
    await tween(fo, to, 300);
    pose(c, 'sad', 900); sfx.whistle(1);
    const [x, y] = pitch.toPx(c.u, c.v); shell.popupAt(cv, x, y - sprSize(), '🟨', '#ffd23f');
    V.foul = 1;
    shell.log(`${byId[fo.id].name} <b>fouls</b> ${byId[c.id].name}: you draw 1 fewer card next turn.`, 'them', t);
    shell.toast('Foul! 1 card fewer next turn', 1200);
    render();
    await wait(380);
    tween(fo, home, 360);
  } else {
    pose(fo, 'sad', 600);
    shell.log(`${z.name} were rattled by the press and do nothing.`, 'info', t);
    await wait(350);
  }
  if (deep) tween(wak, { u: WAK.u }, 420);
  return null;
}

// Result banners sit over the top of the pitch when the action is low on it.
function bannerAt(text, sub, color, v) {
  shell.banner(text, sub, color);
  const b = [...document.querySelectorAll('.banner')].pop();
  if (!b) return;
  const r = cv.getBoundingClientRect(), [, y] = pitch.toPx(0.5, v);
  b.style.top = r.top + y + 'px';
  // the plate sits in the same band: hide it while the result reads, so the two never print over each other
  plateEl.style.transition = 'opacity .15s'; plateEl.style.opacity = '0';
  clearTimeout(bannerAt.t); bannerAt.t = setTimeout(() => { plateEl.style.opacity = ''; }, 1500);
}

async function startCounter(fo) {
  sfx.bad();
  bannerAt('TURNOVER', `${byId[fo.id].name} wins it`, '#ff8a7a', fo.v < 0.5 ? 0.65 : 0.2); // away from where the ball was won
  let r = fo;
  if (fo.id === 'oskar') { // keeper claims it and throws it out
    const d = A('f:dima');
    S.holder = null;
    await tween(S.ball, footUV(d, 'them'), 420, { arc: 14, ease: 'lin' });
    S.holder = d.key; r = d;
    tween(fo, { u: 0.5, v: 0.03 }, 500);
  }
  fo.lockFacing = null;
  V = null;
  g.mode = 'counter';
  g.disc.push(...g.hand); g.hand = [];
  g.energy = 2;
  // Run at our goal. A turnover deep in our half breaks out wide instead,
  // so the runner, the tackle and Wak on his line never share one spot.
  const deep = r.v > 0.74;
  const cs = deep ? { u: 0.78, v: clamp(r.v, 0.76, 0.84) } : { u: 0.5, v: clamp(r.v + 0.12, 0.6, 0.74) };
  const c = A('u:' + S.carrier), m = A('u:' + S.mate);
  g.counter = { threat: 12 + 2 * g.level, def: 0, runner: r.id, cs, deep, played: 0, c0: { u: c.u, v: c.v }, m0: { u: m.u, v: m.v } };
  g.carrier = S.carrier; g.mate = S.mate;
  shell.log(`<b>Turnover!</b> ${byId[r.id].name} breaks with threat ${g.counter.threat}. Play cards (2 energy) to get players back and raise the stop chance.`, 'bad', `${g.minute}'`);
  render();
  const cp = chasePos(g.counter, stopChance(g));
  await Promise.all([tween(r, cs, 600), tween(c, cp.c, 620), tween(m, cp.m, 620)]);
  g.fx = [];
  drawN(g, 4);
  undoStack = [];
}

// Counter defence card: a chaser closes the gap, the stop % rises on arrival.
async function animCounterCard(card, ghost) {
  const chaser = g.counter.played % 2 ? A('u:' + S.carrier) : A('u:' + S.mate);
  await flyTo(ghost, pitchClient(chaser), 220);
  const cp = chasePos(g.counter, stopChance(g));
  await Promise.all([tween(A('u:' + S.carrier), cp.c, 300), tween(A('u:' + S.mate), cp.m, 300)]);
  V.counter.def = g.counter.def;
  sfx.good();
  const r = plateEl.getBoundingClientRect(), fr = fieldEl.getBoundingClientRect();
  shell.popupAt(fieldEl, r.left - fr.left + r.width / 2, r.top - fr.top + 10, `+${defVal(card)}🛡`, '#81d4fa');
  shell.log(`${DEF[card.id].name} adds <b>${defVal(card)}</b> defence → stop chance ${Math.round(stopChance(g) * 100)}%.`, 'good', `${g.minute}'`);
  render();
}

async function resolveCounter() {
  if (busy || g.mode !== 'counter') return;
  busy = true; queue = [];
  const p = stopChance(g), stopped = Math.random() < p, pct = Math.round(p * 100);
  discardHand();
  g.disc.push(...g.hand); g.hand = [];
  g.mode = 'anim'; sel = null; undoStack = [];
  render();
  const r = A('f:' + g.counter.runner), c = A('u:' + S.carrier), m = A('u:' + S.mate), w = A('u:wak'), sz = sprSize();
  const runner = byId[r.id], t = `${g.minute}'`, BV = 0.22; // banner height on the pitch
  // where the runner shoots from: outside the box, or from the side of it when he broke wide
  const M = g.counter.deep ? { u: 0.72, v: 0.84 } : { u: 0.5, v: Math.min(0.8, r.v + 0.06) };
  if (stopped && g.counter.def > 0) { // nearest chaser slides in from the side; boots and ball meet
    const tk = dist(c, M) < dist(m, M) ? c : m;
    const bm = footUV(M, 'them');
    const side = tk.u <= bm.u ? -1 : 1; // come in from the side the tackler is already on
    const start = { u: bm.u + side * 0.12, v: bm.v + 0.01 };
    await Promise.all([tween(r, M, 380), tween(tk, start, 300)]);
    tk.lockFacing = -side;
    pose(tk, 'slide', 700);
    await tween(tk, { u: bm.u + side * 0.025, v: bm.v + 0.008 }, 220);
    pose(r, 'sad', 1400); S.holder = null; sfx.thud(); sfx.save();
    bannerAt('STOPPED!', `${byId[tk.id].name} wins it back (${pct}%)`, '#81d4fa', BV);
    shell.log(`Stop chance was ${pct}% — ${byId[tk.id].name} <b>tackles</b> ${runner.name}. Ball won back.`, 'good', t);
    await tween(S.ball, { u: bm.u + side * 0.07, v: bm.v - 0.03 }, 260, { ease: 'out' });
  } else {
    await tween(r, M, 380);
    pose(r, 'kick', 350); sfx.kick(); S.holder = null;
    const side = Math.random() < 0.5 ? -1 : 1;
    if (stopped) { // Wak's gloves and the ball arrive together
      const SP = { u: 0.5 + side * 0.07, v: 0.96 };
      const [sx, sy] = pitch.toPx(SP.u, SP.v);
      const [ku, kv] = pitch.toUV(sx - side * sz * 0.7, sy + sz * 0.1);
      w.lockFacing = side > 0 ? -1 : 1;
      await Promise.all([tween(S.ball, SP, 300, { ease: 'lin' }), diveTo(w, { u: ku, v: kv }, 300, 900)]);
      sfx.save();
      bannerAt('SAVED!', `Wak denies ${runner.name} (${pct}%)`, '#81d4fa', BV);
      shell.log(`Stop chance was ${pct}% — <b>Wak saves</b> from ${runner.name}.`, 'good', t);
      await tween(S.ball, { u: SP.u + side * 0.12, v: 0.93 }, 320, { arc: 10, ease: 'out' });
    } else {
      w.lockFacing = side > 0 ? 1 : -1;
      await Promise.all([tween(S.ball, { u: 0.5 + side * 0.06, v: 1.035 }, 320, { ease: 'lin' }), diveTo(w, { u: 0.5 - side * 0.03, v: 0.985 }, 320, 1400)]);
      g.score.them += 1;
      pitch.goal(false); sfx.groan(); shell.shake(fieldEl);
      bannerAt('CONCEDED', `${runner.name} scores · ${g.score.us}–${g.score.them}`, '#ff8a7a', BV);
      shell.log(`Stop chance was ${pct}% — ${runner.name} <b>scores</b>. ${g.score.us}–${g.score.them}.`, 'bad', t);
      r.cele = true;
    }
  }
  shell.setScore({ home: g.score.us, away: g.score.them, clock: `${g.minute}'` });
  await wait(1400);
  await fadeTo(0, 350);
  resetPossession(g);
  g.comp = g.relics.includes('arm') ? g.compMax : Math.max(g.comp, Math.round(g.compMax * 0.6));
  g.minute += MINUTES_PER_TURN;
  V = null;
  snapScene(g);
  shell.log(`Composure recovers to ${g.comp}. New attack from the back.`, 'info', `${g.minute}'`);
  if (checkFullTime()) { busy = false; await fadeTo(1, 350); return; }
  startTurn(g);
  busy = false;
  render(true);
  await fadeTo(1, 350);
}

function checkFullTime() {
  if (g.minute < 90) return false;
  g.mode = 'over';
  sel = null;
  shell.setScore({ home: g.score.us, away: g.score.them, clock: 'FT' });
  const { us, them } = g.score;
  const res = us > them ? 'WIN' : us === them ? 'DRAW' : 'LOSS';
  res === 'WIN' ? sfx.win() : res === 'LOSS' ? sfx.lose() : sfx.whistle(3);
  if (res === 'WIN') shell.confetti();
  shell.log(`<b>Full time: ${us}–${them}. ${res}.</b>`, res === 'WIN' ? 'goal' : res === 'LOSS' ? 'bad' : 'info', 'FT');
  render();
  shell.modal({
    title: `Full time · ${us}–${them}`,
    html: `<p>${res === 'WIN' ? 'You won! The deck built the attack.' : res === 'DRAW' ? 'A draw. One more broken zone would have done it.' : 'Redrock hold on.'}</p><p class="muted" style="font-size:13px">Deck: ${allCards().length} cards · Coach perks: ${g.relics.map((r) => RELICS[r].name).join(', ') || 'none'}</p>`,
    buttons: [{ label: 'Replay this phase', value: 'r' }, { label: 'Close', cls: 'paper', value: 'c' }],
  }).then((v) => { if (v === 'r') newGame(g.phase); });
  return true;
}

async function undo() {
  if (busy || !undoStack.length || !['play', 'counter'].includes(g.mode)) { sfx.bad(); return; }
  busy = true; sel = null;
  sfx.whoosh();
  await fadeTo(0, 140); // a deliberate cut: rewind happens while the players are faded
  g = JSON.parse(undoStack.pop());
  snapScene(g);
  shell.log('Undo: last card returned to hand.', 'info', `${g.minute}'`);
  busy = false;
  render();
  await fadeTo(1, 160);
}

// ------------------------------------------------------------------ rendering
const allCards = () => [...g.draw, ...g.hand, ...g.disc, ...g.exh];
function intentLabel(it) {
  return it.type === 'press' ? `Press ${it.v}` : it.type === 'compact' ? `Compact ${it.v}` : it.type === 'foul' ? 'Foul' : 'nothing (rattled)';
}
function artFor(d) {
  if (d.who) return { url: portrait(byId[d.who], 96), cls: '' };
  return { url: spriteURL(byId[d.art[0]], 72, d.art[1] || 'idle'), cls: 'sprite' };
}
function cardHTML(card, i, static_ = false) {
  const d = DEF[card.id];
  const a = artFor(d);
  const cost = static_ ? d.cost : costOf(g, card);
  const affordable = static_ || cost <= g.energy;
  const typ = d.who ? `${byId[d.who].name} · ${d.tags?.includes('shot') ? 'Shot' : 'Squad'}` : d.tags?.includes('shot') ? 'Shot' : d.kind === 'defend' ? 'Hold' : d.kind === 'power' ? 'Tactic' : d.tags?.includes('pass') ? 'Pass' : d.kind === 'skill' ? 'Skill' : 'Carry';
  const dv = !static_ && g.mode === 'counter' ? `<div class="dv">🛡 ${defVal(card)}</div>` : '';
  return `<div class="gcard ${d.kind}${affordable ? '' : ' disabled'}${d.exhaust ? ' exh' : ''}${i === sel && !static_ ? ' sel' : ''}" data-i="${i}">
    <div class="cost" style="${cost < d.cost ? 'background:#7ee08a' : ''}">${cost}</div><div class="name">${d.name}</div>
    <div class="art ${a.cls}" style="background-image:url(${a.url})"></div>${dv}
    <div class="type">${typ}</div><div class="text"><span>${d.text(g)}</span></div>${static_ ? '' : `<span class="kh">${i + 1}</span>`}</div>`;
}

function preview() {
  if (busy || sel == null || !g.hand[sel]) return null;
  const s = clone(g);
  const zi = s.zi;
  if (!playCard(s, sel)) return { cant: true };
  if (g.mode === 'counter') return { def: s.counter.def, p: stopChance(s) };
  const z = s.zones[zi];
  // same rules on a copy: every hit after the first break carries on
  const first = s.fx.findIndex((f) => f.t === 'fall');
  // what lands in the last zone reached, read straight off the copy's hit events
  const carry = first < 0 ? 0 : s.fx.filter((f) => f.t === 'hit' && f.zi === s.zi).reduce((a, f) => a + f.v, 0);
  const breaks = s.fx.filter((f) => f.t === 'fall').length;
  return { zi, hp: z.hp, block: z.block, broke: s.zi > zi, control: s.control, goal: s.mode === 'goal', carry, breaks, next: ZONES[s.zi]?.short };
}

function render(deal = false) {
  if (!g) return;
  const s = view();
  const pv = preview();
  // plate
  const counter = s.mode === 'counter' || (s.mode === 'anim' && s.counter);
  if (counter) {
    const p = pv?.p ?? stopChance(s);
    plateEl.innerHTML = `<div class="intent counter">⚡ Threat ${s.counter.threat}</div>
      <div class="zname">COUNTER <span>${byId[s.counter.runner].name} breaks</span></div>
      <div class="ztags" style="margin-top:6px"><span>Defence ${s.counter.def}${pv?.def != null ? ` → ${pv.def}` : ''}</span>${oddsPill(p, 'Stop')}</div>`;
    const [, y] = pitch.toPx(0.5, 0.1);
    plateEl.style.top = y + 'px';
  } else if (s.zi < 5) {
    const z = s.zones[s.zi];
    const it = z.intent;
    const lose = it.type === 'press' ? Math.max(0, it.v - (pv?.control ?? s.control)) : 0;
    const icon = it.type === 'press' ? '⚔' : it.type === 'compact' ? '🛡' : it.type === 'foul' ? '🟨' : '💫';
    const sub = it.type === 'press' ? `you lose ${lose}` : it.type === 'compact' ? 'gains block' : it.type === 'foul' ? '−1 card' : 'rattled';
    const mine = pv && !pv.cant && pv.zi === s.zi;
    const ghostHp = mine ? pv.hp : z.hp;
    const foes = ZONES[z.i].foes.map((f) => byId[f].name).join(' & ');
    const tag = !mine ? '' : pv.goal ? '<span class="brk">GOAL!</span>' : pv.broke ? `<span class="brk">BREAKS${pv.breaks > 1 ? ` ×${pv.breaks}` : ''}!${pv.carry ? ` +${pv.carry} → ${pv.next}` : ''}</span>` : z.hp - pv.hp || z.block - pv.block ? `<span class="pv">−${z.hp - pv.hp}${z.block - pv.block ? ` (${z.block - pv.block} blocked)` : ''}</span>` : '';
    plateEl.innerHTML = `<div class="intent ${it.type}">${icon} ${it.v || ''}<small>${sub}</small></div>
      <div class="zname">${z.name.toUpperCase()} <span>${foes}</span></div>
      <div class="hpline"><div class="hp"><i class="ghost" style="width:${(z.hp / z.max) * 100}%"></i><i class="fill" style="width:${(ghostHp / z.max) * 100}%"></i><b>${z.hp}/${z.max}</b></div>${z.block || (mine && pv.block !== z.block) ? `<span class="blk">🛡${z.block}</span>` : ''}</div>
      <div class="ztags">${z.off ? `<span>Off-balance ${z.off} (+50%)</span>` : ''}${z.key === 'gk' ? '<span>½ normal · ×3 Shots</span>' : ''}${tag}</div>`;
    const [, y] = pitch.toPx(0.5, z.key === 'gk' ? 0.17 : ZONES[s.zi].v); // keeper plate sits below the goal so saves stay visible
    plateEl.style.top = clamp(y - 12, 22, H - 70) + 'px';
  } else {
    plateEl.innerHTML = `<div class="zname">GOAL! <span>${byId[s.scorer || S.carrier].name}</span></div>`;
  }
  // relics
  relicsEl.innerHTML = g.relics.map((r) => `<div class="relic" title="${RELICS[r].name}: ${RELICS[r].text}" data-r="${r}">${RELICS[r].icon}</div>`).join('');
  relicsEl.querySelectorAll('.relic').forEach((el) => { el.onclick = () => shell.toast(`<b>${RELICS[el.dataset.r].name}</b>: ${RELICS[el.dataset.r].text}`, 2600); });
  // status
  energyEl.innerHTML = `<span><b>${g.energy}</b><small>/${g.mode === 'counter' ? 2 : 3}</small></span>`;
  energyEl.classList.toggle('empty', g.energy === 0);
  const pct = (s.comp / s.compMax) * 100;
  const bar = compEl.querySelector('.bar');
  const z = s.zones[s.zi];
  const incoming = s.mode === 'play' && !busy && z?.intent.type === 'press' ? Math.max(0, z.intent.v - (pv?.control ?? s.control)) : 0;
  bar.querySelector('.loss').style.width = pct + '%';
  bar.querySelector('.cur').style.width = (Math.max(0, s.comp - incoming) / s.compMax) * 100 + '%';
  bar.querySelector('b').textContent = `${s.comp}/${s.compMax}`;
  bar.classList.toggle('low', s.comp <= 12);
  compEl.querySelector('.why').textContent = !incoming ? '' : incoming >= s.comp ? `−${incoming}: TURNOVER!` : `−${incoming} if you end turn`;
  const cpv = pv && pv.control != null && pv.control !== s.control ? ` <span class="pv">→${pv.control}</span>` : '';
  $('.ctrl span').innerHTML = `${s.control}${cpv}`;
  rhyEl.classList.toggle('off', !s.rhythm); rhyEl.querySelector('span').textContent = s.rhythm;
  // hand (cards drawn by the card in flight stay hidden until it resolves)
  handEl.innerHTML = g.hand.map((c, i) => (hideUids?.has(c.uid) ? '' : cardHTML(c, i))).join('');
  [...handEl.children].forEach((el) => {
    const i = +el.dataset.i;
    el.onclick = (e) => { e.stopPropagation(); selectCard(i); };
    const isNew = deal === true || (deal instanceof Set && deal.has(g.hand[i].uid));
    if (isNew) { // a card still being dealt is invisible and must not catch taps meant for the buttons
      el.classList.add('dealt'); el.style.animationDelay = (deal === true ? i : 0) * 60 + 'ms';
      el.addEventListener('animationend', () => el.classList.remove('dealt'), { once: true });
    }
    const q = queue.indexOf(g.hand[i].uid);
    if (q >= 0) { el.classList.add('queued'); el.insertAdjacentHTML('beforeend', `<b class="qn">${q + 1}</b>`); }
  });
  layoutHand();
  // hint + buttons
  const active = g.mode === 'play' || g.mode === 'counter';
  if (busy) hintEl.innerHTML = queue.length ? `<b>${queue.length} queued</b> — they play in order` : sel != null ? 'Tap again to queue it' : '&nbsp;';
  else if (g.mode === 'counter') hintEl.innerHTML = `<b>Defend!</b> Each card adds its 🛡 value. Then <b>Face it</b>.`;
  else if (g.mode === 'play') hintEl.innerHTML = sel != null ? `Tap again or <b>Enter</b> to play` : g.energy === 0 || !g.hand.some((c) => costOf(g, c) <= g.energy) ? `Out of moves — <b>End turn</b>` : `${ZONES[g.zi]?.name || ''}: pick a card`;
  else if (g.mode === 'over') hintEl.innerHTML = 'Full time — pick a phase above to play again.';
  else hintEl.innerHTML = '&nbsp;';
  btnPlay.disabled = !active || sel == null || (g.hand[sel] && costOf(g, g.hand[sel]) > g.energy);
  btnPlay.firstChild.textContent = g.mode === 'counter' ? 'Defend ' : 'Play ';
  btnEnd.disabled = !active || busy;
  btnEnd.firstChild.textContent = g.mode === 'counter' ? 'Face it ' : 'End turn ';
  btnUndo.disabled = busy || !undoStack.length || !active;
  pilesEl.innerHTML = `Draw ${g.draw.length}<br>Disc ${g.disc.length}${g.exh.length ? ` · ✕${g.exh.length}` : ''}`;
  pilesEl.title = `Deck: ${allCards().length} cards (tap to view)`;
}

function layoutHand() {
  const cards = [...handEl.children];
  const n = cards.length, pad = 14, Wd = (handEl.clientWidth || 360) - pad * 2, cw = 108;
  const step = n > 1 ? Math.min(cw + 4, (Wd - cw) / (n - 1)) : 0;
  const x0 = pad + (Wd - (cw + step * (n - 1))) / 2;
  cards.forEach((c, i) => {
    const mid = (n - 1) / 2, isSel = +c.dataset.i === sel;
    c.style.left = x0 + i * step + 'px';
    c.style.transform = isSel ? 'translateY(-14px) scale(1.04)' : `translateY(${Math.abs(i - mid) ** 2 * 2}px) rotate(${(i - mid) * 3}deg)`;
    c.style.zIndex = isSel ? 50 : i + 1;
  });
}

function bump(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
const centerOf = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
function pitchClient(p) { const r = cv.getBoundingClientRect(), [x, y] = pitch.toPx(p.u, p.v); return [r.left + x, r.top + y - sprSize() * 0.5]; }

// A played card: a copy leaves the hand and flies to where it takes effect.
function ghostOf(el) {
  const r = el.getBoundingClientRect();
  const c = el.cloneNode(true);
  c.classList.add('flying');
  c.classList.remove('dealt', 'sel');
  Object.assign(c.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', transform: 'none', zIndex: 75, margin: 0, animation: 'none' });
  document.body.appendChild(c);
  return { node: c, r };
}
function flyTo(ghost, [tx, ty], ms, delay = 0) {
  if (!ghost) return Promise.resolve();
  const { node, r } = ghost;
  const dx = tx - (r.left + r.width / 2), dy = ty - (r.top + r.height / 2);
  const an = node.animate([
    { transform: 'translate(0,0) rotate(0deg) scale(1.05)', opacity: 1 },
    { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 30}px) rotate(-8deg) scale(.7)`, opacity: 1, offset: 0.55 },
    { transform: `translate(${dx}px, ${dy}px) rotate(10deg) scale(.15)`, opacity: 0.2 },
  ], { duration: ms * TS(), delay: delay * TS(), easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'both' });
  return new Promise((res) => { an.onfinish = () => { node.remove(); res(); }; setTimeout(() => { node.remove(); res(); }, (ms + delay) * TS() + 400); });
}
function discardHand() {
  const to = centerOf(pilesEl);
  [...handEl.children].forEach((el, i) => flyTo(ghostOf(el), to, 300, i * 45));
  handEl.innerHTML = '';
}

// generic pick overlay with keyboard (1–9, Esc to skip)
function pickOverlay(title, subHTML, items, allowSkip) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';
    wrap.innerHTML = `<div class="sheet panel"><h2>${title}</h2><div class="body">${subHTML}</div><div class="picks"></div><div class="row">${allowSkip ? '<button class="btn small paper">Skip</button>' : ''}</div></div>`;
    const picks = wrap.querySelector('.picks');
    items.forEach((h, i) => {
      const d = document.createElement('div');
      d.innerHTML = h;
      const el = d.firstElementChild;
      el.classList.remove('sel');
      el.onclick = () => done(i);
      picks.appendChild(el);
    });
    const onKey = (e) => {
      if (/^[1-9]$/.test(e.key) && +e.key <= items.length) { e.preventDefault(); done(+e.key - 1); }
      if (e.key === 'Escape' && allowSkip) { e.preventDefault(); done(-1); }
    };
    const done = (v) => { sfx.click(); wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    wrap.querySelector('.row .btn')?.addEventListener('click', () => done(-1));
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
  });
}

// ------------------------------------------------------------------ canvas
let lastT = 0;
function frame(now) {
  const t = now / 1000, dt = Math.min(0.05, t - lastT || 0.016); lastT = t;
  if (g) drawScene(t, dt, now);
  requestAnimationFrame(frame);
}
function basePose(a, s, counter) {
  if (a.key === 'u:wak') return counter ? 'ready' : 'idle';
  if (a.team === 'us') return 'idle';
  if (counter) return 'idle';
  const i = FOE_ZONE[a.id];
  if (i < s.zi) return 'sad';
  if (i > s.zi) return 'idle';
  if (ZONES[i].key === 'gk') return 'ready';
  const it = s.zones[i].intent.type;
  return it === 'rattled' ? 'sad' : it === 'foul' ? 'idle' : 'ready';
}
function baseAlpha(a, s, counter) {
  if (a.team === 'us') return 1;
  if (counter) return a.id === s.counter.runner ? 1 : 0.6;
  const i = FOE_ZONE[a.id];
  return i < s.zi ? 0.5 : i === s.zi ? 1 : 0.75;
}
function drawScene(t, dt, now) {
  stepTweens(now);
  const s = view();
  ctx.clearRect(0, 0, W, H);
  pitch.draw(ctx, t, dt);
  const counter = !!s.counter && (s.mode === 'counter' || s.mode === 'anim');
  // zone bands
  ctx.save();
  ZONES.forEach((Z, i) => {
    const [x0, y0] = pitch.toPx(0, Z.v0), [x1, y1] = pitch.toPx(1, Z.v1);
    if (!counter && i < s.zi) { ctx.fillStyle = 'rgba(255,210,63,.16)'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); }
    if (!counter && i === s.zi) {
      ctx.fillStyle = `rgba(255,255,255,${0.08 + 0.05 * Math.sin(t * 4)})`; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.setLineDash([6, 5]); ctx.lineDashOffset = -t * 20; ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 2;
      ctx.strokeRect(x0 + 2, y0 + 2, x1 - x0 - 4, y1 - y0 - 4); ctx.setLineDash([]);
    }
    ctx.font = '11px "Lilita One", system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = i < s.zi && !counter ? 'rgba(255,230,120,.95)' : 'rgba(255,255,255,.7)';
    ctx.fillText((i < s.zi && !counter ? '✓ ' : '') + Z.short, x0 + 4, y0 + 3);
  });
  ctx.restore();

  const sz = sprSize();
  if (S.holder) Object.assign(S.ball, footUV(A(S.holder), A(S.holder).team));
  const spr = [];
  for (const a of Object.values(S.act)) {
    if (!a.vis) continue;
    const [x, y] = pitch.toPx(a.u, a.v);
    if (a.px != null) {
      const sp = Math.hypot(x - a.px, y - a.py) / dt;
      a.moving = sp > 18 ? 0.1 : Math.max(0, a.moving - dt);
      if (x - a.px > 0.4) a.dir = 1; else if (x - a.px < -0.4) a.dir = -1;
    }
    a.px = x; a.py = y;
    const locked = a.lock && now < a.lockUntil;
    const p = locked ? a.lock : a.cele ? 'celebrate' : a.moving > 0 ? 'run' : basePose(a, s, counter);
    const facing = locked && a.lockFacing ? a.lockFacing : a.dir ?? (a.team === 'them' ? -1 : 1);
    const alpha = a.alpha * S.fade * baseAlpha(a, s, counter);
    if (alpha < 0.01) continue;
    const glow = S.holder === a.key ? (a.team === 'us' ? '#FFD23F' : '#E8463A') : undefined;
    spr.push({ y, draw: () => drawPlayer(ctx, byId[a.id], x, y, { size: sz, pose: p, t, facing, alpha, glow, speed: a.team === 'them' ? 0.8 : 1 }) });
  }
  const [bx, by] = pitch.toPx(S.ball.u, S.ball.v);
  if (S.ball.px != null) S.ball.spin += Math.hypot(bx - S.ball.px, by - S.ball.py) * 0.12;
  S.ball.px = bx; S.ball.py = by;
  spr.push({ y: by + 0.5, draw: () => { ctx.save(); ctx.globalAlpha = S.fade; drawBall(ctx, bx, by, sz * 0.15, S.ball.spin, S.ball.h); ctx.restore(); } });
  spr.sort((a, b) => a.y - b.y).forEach((o) => o.draw());
  pitch.drawFront(ctx, t);
}
requestAnimationFrame(frame);
// Tweens also advance on a timer, so the game never stalls if rAF is paused (hidden tab).
setInterval(() => stepTweens(performance.now()), 100);
window.pd = { get g() { return g; }, get busy() { return busy; }, S, render: () => render() }; // debug hook

// ------------------------------------------------------------------ input
btnPlay.onclick = () => playSelected();
btnEnd.onclick = () => { sfx.click(); endTurn(); };
btnUndo.onclick = () => undo();
pilesEl.onclick = () => {
  const counts = {};
  allCards().forEach((c) => { counts[c.id] = (counts[c.id] || 0) + 1; });
  shell.modal({ title: `Your deck · ${allCards().length}`, html: `<div class="deckgrid">${Object.entries(counts).map(([id, n]) => cardHTML({ id }, -1, true) + (n > 1 ? `<b style="align-self:center">×${n}</b>` : '')).join('')}</div>`, wide: true });
};
root.addEventListener('click', (e) => { if (!e.target.closest('.gcard,.btn,.relic,.piles') && (sel != null || queue.length)) { sel = null; queue = []; render(); } });
window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.sheet-wrap')) return;
  if (/^[1-9]$/.test(e.key)) { selectCard(+e.key - 1); }
  else if (e.key === 'Enter') { e.preventDefault(); if (sel != null) playSelected(); else if (g.mode === 'counter') endTurn(); }
  else if (e.key === 'd' || e.key === 'D') endTurn();
  else if (e.key === 'z' || e.key === 'Z') undo();
  else if (e.key === 'Escape' && (sel != null || queue.length)) { sel = null; queue = []; render(); }
});
