// Possession Deck — Slay the Spire, but each zone of the pitch is the "enemy".
// Cards deal Progress to the current zone. Break all five zones and you score.
import { Shell, clamp, shuffle, pick, oddsPill } from '../../shared/shell.js';
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
  early: { minute: 0, us: 0, them: 0, level: 0, comp: 40, zi: 0, deck: STARTER, relics: [], variant: 'day', body: '' },
  mid: { minute: 45, us: 1, them: 1, level: 1, comp: 26, zi: 1, variant: 'dusk', body: 'dusk',
    deck: [...STARTER, 'through', 'tiki', 'overlap', 'kenji', 'gegen'], relics: ['tiki'],
    top: ['tiki', 'pass', 'kenji', 'pass', 'shield'] },
  clutch: { minute: 75, us: 0, them: 1, level: 1, comp: 12, zi: 3, boxHp: 10, variant: 'night', body: 'floodlit',
    deck: ['pass', 'pass', 'pass', 'pass', 'shield', 'shield', 'shield', 'dribble', 'shoot', 'volley', 'rio', 'through', 'nutmeg', 'bruno', 'rondo'],
    relics: ['late'], top: ['through', 'pass', 'shoot', 'shield', 'rio'] },
};

// ------------------------------------------------------------------ rules (pure: run on clones for previews)
let g = null;

const zoneOf = (s) => (s.mode === 'counter' ? null : s.zones[s.zi]);

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

function hit(s, base, o = {}) {
  const z = zoneOf(s);
  if (!z || z.hp <= 0) return 0;
  let v = prog(s, base, o);
  let blocked = 0;
  if (!o.pierce && z.block > 0) { blocked = Math.min(z.block, v); z.block -= blocked; v -= blocked; }
  z.hp = Math.max(0, z.hp - v);
  s.fx.push({ t: 'hit', v, blocked, shot: !!o.shot, pierce: !!o.pierce });
  return v;
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
    s.disc.push(card);
    return true;
  }
  if (d.tags?.includes('pass') && s.relics.includes('tiki')) s.tikiUsed = true;
  d.play(s);
  if (d.tags?.includes('pass')) s.passes += 1;
  (d.exhaust ? s.exh : s.disc).push(card);
  s.carrier = d.who || d.art[0];
  const z = s.zones[s.zi];
  if (z.hp <= 0) {
    s.fx.push({ t: 'fall', zi: s.zi });
    s.zi += 1;
    if (s.zi >= s.zones.length) { s.mode = 'goal'; s.fx.push({ t: 'goal' }); }
  }
  return true;
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
  return n;
}

// New attack: every card goes back into the deck, zones reset.
function resetPossession(s) {
  s.draw = shuffle([...s.draw, ...s.hand, ...s.disc, ...s.exh]);
  s.hand = []; s.disc = []; s.exh = [];
  s.zones = makeZones(s.level); s.zi = 0; s.rhythm = 0; s.control = 0; s.foul = 0; s.drawBonus = 0;
  s.mode = 'play'; s.counter = null;
}

const stopChance = (s) => clamp(0.2 + (0.75 * s.counter.def) / s.counter.threat + (s.relics.includes('wall') ? 0.2 : 0), 0.05, 0.95);

// ------------------------------------------------------------------ shell + DOM
const shell = new Shell({
  id: 'possession-deck', title: 'Possession Deck',
  pitch: 'Slay the Spire on a football pitch. Each zone between you and the net is an enemy. Break all five to score.',
  how: [
    'You have <b>3 energy</b> and draw 5 cards a turn. Tap a card to select it, tap again (or Play) to use it.',
    '<b>Progress</b> lowers the zone\'s bar. At 0 the zone breaks and the ball moves up: Defense → Midfield → Attack → Box → Keeper.',
    'Read the zone\'s <b>intent</b> above its bar: <b>Press</b> hits your Composure, <b>Compact</b> adds block, <b>Foul</b> means one card fewer next turn.',
    '<b>Control</b> absorbs Press for one turn. The <b>Keeper</b> takes half from normal cards and <b>triple from Shots</b>.',
    'Composure hits 0 → <b>turnover</b>: a quick defend turn with a visible stop chance.',
    'After a goal pick 1 of 3 new cards, then a stop on the run map. Keys: <span class="kbd">1–9</span> select, <span class="kbd">Enter</span> play, <span class="kbd">D</span> end turn, <span class="kbd">Z</span> undo.',
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
  <div class="field"><canvas></canvas><div class="plate"></div><div class="relics"></div></div>
  <div class="status">
    <div class="energy"><span><b>3</b><small>/3</small></span></div>
    <div class="comp"><div class="lbl"><span>Composure</span><span class="why"></span></div><div class="bar"><i class="loss"></i><i class="cur"></i><b></b></div></div>
    <div class="pill ctrl"><small>Control</small>🛡 <span>0</span></div>
    <div class="pill rhy" hidden><small>Rhythm</small>♪ <span>0</span></div>
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
const relicsEl = $('.relics'), compEl = $('.comp'), energyEl = $('.energy');
const btnPlay = $('[data-a=play]'), btnEnd = $('[data-a=end]'), btnUndo = $('[data-a=undo]'), pilesEl = $('.piles');

let ctx, pitch, W = 360, H = 240;
function sizeCanvas() {
  W = Math.min(fieldEl.clientWidth - 6 || 360, 560);
  H = Math.round(clamp(W * 0.68, 230, 330));
  ctx = setupCanvas(cv, W, H);
  const variant = pitch?.variant || 'day';
  pitch = new Pitch(W, H, { variant });
}
sizeCanvas();
window.addEventListener('resize', () => { sizeCanvas(); render(); });

let undoStack = [];
let sel = null;
const A = { ball: { u: 0.42, v: 0.95 }, runner: { u: 0.5, v: 0.5 }, hitAt: -9, celebrateUntil: 0, counterRes: null, carrierPose: null };

// ------------------------------------------------------------------ game flow
function newGame(id) {
  const P = PHASES[id];
  document.body.className = P.body;
  pitch.setVariant(P.variant);
  let uid = 0;
  g = {
    phase: id, minute: P.minute, score: { us: P.us, them: P.them }, level: P.level,
    compMax: 40, comp: P.comp, control: 0, energy: 3, rhythm: 0, foul: 0, drawBonus: 0, passes: 0, tikiUsed: false,
    zones: makeZones(P.level), zi: P.zi, draw: shuffle(P.deck.map((cid) => ({ uid: ++uid, id: cid }))), hand: [], disc: [], exh: [],
    relics: [...P.relics], mode: 'play', carrier: 'kenji', fx: [], turn: 0, counter: null, uid,
  };
  if (P.boxHp) {
    g.zones[3].hp = P.boxHp;
    for (const z of g.zones.slice(3)) { z.ix = 1; z.intent = intentFor(z, g.level); } // both open with a Press
  }
  undoStack = []; sel = null;
  A.ball = ballTarget(); A.celebrateUntil = 0; A.counterRes = null;
  startTurn(g, P.top);
  shell.setScore({ home: g.score.us, away: g.score.them, clock: `${g.minute}'` });
  const z = g.zones[g.zi];
  shell.log(`${id === 'clutch' ? 'Floodlights on. One down, three turns left.' : id === 'mid' ? 'Second half. Defense already broken — the ball is in Midfield.' : 'Kickoff. Break five zones to score.'}`, 'info', `${g.minute}'`);
  shell.log(`${z.name} intends <b>${intentLabel(z.intent)}</b>.`, 'them', `${g.minute}'`);
  render(true);
}

function snapshot() { undoStack.push(JSON.stringify(g)); if (undoStack.length > 30) undoStack.shift(); }

function selectCard(i) {
  if (!['play', 'counter'].includes(g.mode)) return;
  if (i < 0 || i >= g.hand.length) return;
  if (sel === i) { playSelected(); return; }
  sel = i; sfx.hover();
  render();
}

function playSelected() {
  if (sel == null || !['play', 'counter'].includes(g.mode)) return;
  const card = g.hand[sel];
  if (costOf(g, card) > g.energy) { shell.toast('Not enough energy'); sfx.bad(); return; }
  const el = handEl.children[sel];
  snapshot();
  const zBefore = g.zi;
  playCard(g, sel);
  sel = null;
  if (el) flyCard(el, g.mode === 'counter' ? plateEl : plateEl);
  sfx.card();
  const d = DEF[card.id];
  if (g.mode === 'counter') {
    shell.log(`${d.name} adds <b>${defVal(card)}</b> defence → stop chance ${Math.round(stopChance(g) * 100)}%.`, 'good', `${g.minute}'`);
    render();
    return;
  }
  handleFx(d, zBefore);
  render();
}

function handleFx(d, zBefore) {
  const fx = g.fx;
  const z = g.zones[Math.min(zBefore, 4)];
  const parts = [];
  let delay = 120;
  for (const f of fx) {
    if (f.t === 'hit') {
      setTimeout(() => {
        const r = plateEl.getBoundingClientRect(), fr = fieldEl.getBoundingClientRect();
        shell.popupAt(fieldEl, r.left - fr.left + r.width / 2 + (Math.random() - 0.5) * 30, r.top - fr.top + 10, f.v ? `-${f.v}` : 'BLOCKED', f.shot ? '#ffd23f' : '#fff');
        if (f.blocked) shell.popupAt(fieldEl, r.left - fr.left + 20, r.top - fr.top + 30, `🛡${f.blocked}`, '#81d4fa');
        bump(plateEl, 'hit'); A.hitAt = performance.now() / 1000;
        f.shot ? sfx.kick() : sfx.pass();
      }, delay);
      delay += 140;
      parts.push(`${f.shot ? 'Shot' : 'Progress'} <b>${f.v}</b>${f.blocked ? ` (${f.blocked} blocked by Compact)` : ''}${f.pierce ? ' — ignored Compact' : ''}`);
    } else if (f.t === 'ctrl') {
      parts.push(`+${f.v} Control`); sfx.good();
    } else if (f.t === 'buff') {
      setTimeout(() => shell.toast(f.text, 900), delay); parts.push(f.text);
    } else if (f.t === 'reshuffle') {
      parts.push('discard reshuffled into draw');
    }
  }
  const why = [];
  if (z && fx.some((f) => f.t === 'hit')) {
    if (z.key === 'gk') why.push(d.tags?.includes('shot') ? 'Keeper takes ×3 from Shots' : 'Keeper halves non-Shots');
    if (g.rhythm) why.push(`Rhythm +${g.rhythm}`);
  }
  shell.log(`<b>${d.who ? byId[d.who].name + ': ' : ''}${d.name}</b> — ${parts.join(', ') || 'played'}${why.length ? ` <i>(${why.join('; ')})</i>` : ''}.`, '', `${g.minute}'`);

  const fall = fx.find((f) => f.t === 'fall');
  if (fall) {
    const Z = g.zones[fall.zi];
    setTimeout(() => {
      sfx.whoosh(); pitch.excite = 0.6;
      shell.log(`<b>${Z.name} broken!</b> ${g.zi < 5 ? `Ball moves into the ${g.zones[g.zi].name} zone, which intends ${intentLabel(g.zones[g.zi].intent)}.` : ''}`, 'good', `${g.minute}'`);
      if (g.zi < 5) shell.toast(`${Z.name} broken → ${g.zones[g.zi].name}`, 1200);
    }, delay);
  }
  if (fx.some((f) => f.t === 'goal')) setTimeout(goalSequence, delay + 250);
}

async function goalSequence() {
  undoStack = [];
  A.celebrateUntil = performance.now() / 1000 + 4;
  pitch.goal(true);
  g.score.us += 1;
  sfx.goal(); shell.flash('#fff'); shell.shake(fieldEl); shell.confetti();
  shell.banner('GOAL!', `${byId[g.carrier].name} finishes it · ${g.score.us}–${g.score.them}`);
  shell.setScore({ home: g.score.us, away: g.score.them, clock: `${g.minute}'` });
  shell.log(`<b>GOAL!</b> ${byId[g.carrier].name} scores after breaking all five zones. ${g.score.us}–${g.score.them}.`, 'goal', `${g.minute}'`);
  render();
  await wait(1700);
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
  shell.log(`New attack from the back. Redrock regroup: every zone is tougher now.`, 'info', `${g.minute}'`);
  if (checkFullTime()) return;
  A.ball = ballTarget();
  startTurn(g);
  render(true);
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

function endTurn() {
  if (g.mode === 'counter') { resolveCounter(); return; }
  if (g.mode !== 'play') return;
  g.mode = 'enemy'; sel = null; undoStack = [];
  g.disc.push(...g.hand); g.hand = [];
  render();
  const z = g.zones[g.zi];
  setTimeout(() => {
    z.block = 0;
    const it = z.intent;
    const t = `${g.minute}'`;
    if (it.type === 'press') {
      const absorbed = Math.min(g.control, it.v);
      const dmg = it.v - absorbed;
      g.comp = Math.max(0, g.comp - dmg);
      g.control -= absorbed;
      sfx.thud(); bump(compEl, 'hurt');
      if (dmg) { const r = compEl.getBoundingClientRect(); shell.popup(`-${dmg}`, r.left + r.width / 2, r.top, '#ff8a7a'); shell.shake(fieldEl); }
      shell.log(`${z.name} <b>press ${it.v}</b>: Control absorbed ${absorbed}, you lose <b>${dmg}</b> Composure (${g.comp} left).`, 'them', t);
    } else if (it.type === 'compact') {
      z.block += it.v; sfx.save();
      shell.log(`${z.name} go <b>compact</b>: +${it.v} block. Through balls ignore it.`, 'them', t);
    } else if (it.type === 'foul') {
      g.foul = 1; sfx.whistle(1);
      shell.log(`${z.name} <b>foul</b> you: you draw 1 fewer card next turn.`, 'them', t);
    } else {
      shell.log(`${z.name} were rattled by the press and do nothing.`, 'info', t);
    }
    if (z.off > 0) z.off -= 1;
    z.ix += 1;
    z.intent = intentFor(z, g.level);
    g.minute += MINUTES_PER_TURN;
    shell.setScore({ home: g.score.us, away: g.score.them, clock: `${g.minute}'` });
    render();
    setTimeout(() => {
      if (g.comp <= 0) { startCounter(); return; }
      if (checkFullTime()) return;
      g.mode = 'play';
      const n = startTurn(g);
      shell.log(`Turn ${g.turn}: drew ${g.hand.length}${n < 5 ? ' (fouled)' : ''}. ${z.name} now intends <b>${intentLabel(z.intent)}</b>.`, 'info', `${g.minute}'`);
      sfx.deal();
      render(true);
    }, 500);
  }, 350);
}

function startCounter() {
  sfx.bad();
  shell.banner('TURNOVER', 'Redrock break!', '#ff8a7a');
  const runner = pick(['kofi', 'viper', 'rocco']);
  g.mode = 'counter';
  g.disc.push(...g.hand); g.hand = [];
  g.energy = 2;
  g.counter = { threat: 12 + 2 * g.level, def: 0, runner };
  const Z = ZONES[g.zi] || ZONES[4];
  A.runner = { u: 0.45, v: Z.v };
  A.counterRes = null;
  shell.log(`<b>Turnover!</b> Composure ran out. ${byId[runner].name} breaks with threat ${g.counter.threat}. Play cards (2 energy) to raise the stop chance.`, 'bad', `${g.minute}'`);
  g.fx = [];
  drawN(g, 4);
  undoStack = [];
  render(true);
}

async function resolveCounter() {
  if (g.mode !== 'counter') return;
  const p = stopChance(g);
  const roll = Math.random();
  g.mode = 'anim'; sel = null; undoStack = [];
  render();
  sfx.kick();
  const runner = byId[g.counter.runner];
  await wait(600);
  const t = `${g.minute}'`;
  if (roll < p) {
    A.counterRes = 'saved';
    sfx.save(); shell.banner('STOPPED!', `Wak & co. hold firm (${Math.round(p * 100)}%)`, '#81d4fa');
    shell.log(`Stop chance was ${Math.round(p * 100)}% — <b>stopped</b> ${runner.name}. You win the ball back at the back.`, 'good', t);
  } else {
    A.counterRes = 'goal';
    g.score.them += 1;
    pitch.goal(false); sfx.groan(); shell.shake(fieldEl);
    shell.banner('CONCEDED', `${runner.name} scores · ${g.score.us}–${g.score.them}`, '#ff8a7a');
    shell.log(`Stop chance was ${Math.round(p * 100)}% — ${runner.name} <b>scores</b>. ${g.score.us}–${g.score.them}.`, 'bad', t);
  }
  shell.setScore({ home: g.score.us, away: g.score.them, clock: `${g.minute}'` });
  await wait(1700);
  A.counterRes = null;
  resetPossession(g);
  g.comp = g.relics.includes('arm') ? g.compMax : Math.max(g.comp, Math.round(g.compMax * 0.6));
  g.minute += MINUTES_PER_TURN;
  shell.log(`Composure recovers to ${g.comp}. New attack from the back.`, 'info', `${g.minute}'`);
  if (checkFullTime()) return;
  A.ball = ballTarget();
  startTurn(g);
  render(true);
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

function undo() {
  if (!undoStack.length || !['play', 'counter'].includes(g.mode)) { sfx.bad(); return; }
  g = JSON.parse(undoStack.pop());
  sel = null;
  sfx.whoosh();
  shell.log('Undo: last card returned to hand.', 'info', `${g.minute}'`);
  render();
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

function ballTarget() {
  if (g.mode === 'goal' || g.zi >= 5) return { u: 0.5, v: -0.05 };
  const Z = ZONES[g.zi];
  return { u: 0.4, v: Math.min(0.97, Z.v + 0.085) };
}

function preview() {
  if (sel == null || !g.hand[sel]) return null;
  const s = JSON.parse(JSON.stringify(g));
  const zi = s.zi;
  if (!playCard(s, sel)) return { cant: true };
  if (g.mode === 'counter') return { def: s.counter.def, p: stopChance(s) };
  const z = s.zones[zi];
  return { zi, hp: z.hp, block: z.block, broke: s.zi > zi, control: s.control, goal: s.mode === 'goal' };
}

function render(deal = false) {
  if (!g) return;
  const pv = preview();
  // plate
  const counter = g.mode === 'counter' || (g.mode === 'anim' && g.counter);
  if (counter) {
    const p = pv?.p ?? stopChance(g);
    plateEl.innerHTML = `<div class="intent counter">⚡ Threat ${g.counter.threat}</div>
      <div class="zname">COUNTER <span>${byId[g.counter.runner].name} breaks</span></div>
      <div class="ztags" style="margin-top:6px"><span>Defence ${g.counter.def}${pv?.def != null ? ` → ${pv.def}` : ''}</span>${oddsPill(p, 'Stop')}</div>`;
    const [, y] = pitch.toPx(0.5, 0.62);
    plateEl.style.top = y + 'px';
  } else if (g.zi < 5) {
    const z = g.zones[g.zi];
    const it = z.intent;
    const lose = it.type === 'press' ? Math.max(0, it.v - (pv?.control ?? g.control)) : 0;
    const icon = it.type === 'press' ? '⚔' : it.type === 'compact' ? '🛡' : it.type === 'foul' ? '🟨' : '💫';
    const sub = it.type === 'press' ? `you lose ${lose}` : it.type === 'compact' ? 'gains block' : it.type === 'foul' ? '−1 card' : 'rattled';
    const ghostHp = pv && !pv.cant && pv.zi === g.zi ? pv.hp : z.hp;
    const foes = ZONES[z.i].foes.map((f) => byId[f].name).join(' & ');
    plateEl.innerHTML = `<div class="intent ${it.type}">${icon} ${it.v || ''}<small>${sub}</small></div>
      <div class="zname">${z.name.toUpperCase()} <span>${foes}</span></div>
      <div class="hpline"><div class="hp"><i class="ghost" style="width:${(z.hp / z.max) * 100}%"></i><i class="fill" style="width:${(ghostHp / z.max) * 100}%"></i><b>${z.hp}/${z.max}</b></div>${z.block || (pv && pv.zi === g.zi && pv.block !== z.block) ? `<span class="blk">🛡${z.block}</span>` : ''}</div>
      <div class="ztags">${z.off ? `<span>Off-balance ${z.off} (+50%)</span>` : ''}${z.key === 'gk' ? '<span>½ normal · ×3 Shots</span>' : ''}${pv && !pv.cant && pv.zi === g.zi ? (pv.goal ? '<span class="brk">GOAL!</span>' : pv.broke ? '<span class="brk">BREAKS!</span>' : z.hp - pv.hp || z.block - pv.block ? `<span class="pv">−${z.hp - pv.hp}${z.block - pv.block ? ` (${z.block - pv.block} blocked)` : ''}</span>` : '') : ''}</div>`;
    const [, y] = pitch.toPx(0.5, ZONES[g.zi].v);
    plateEl.style.top = clamp(y - 12, 22, H - 70) + 'px';
  } else {
    plateEl.innerHTML = `<div class="zname">GOAL! <span>${byId[g.carrier].name}</span></div>`;
  }
  // relics
  relicsEl.innerHTML = g.relics.map((r) => `<div class="relic" title="${RELICS[r].name}: ${RELICS[r].text}" data-r="${r}">${RELICS[r].icon}</div>`).join('');
  relicsEl.querySelectorAll('.relic').forEach((el) => { el.onclick = () => shell.toast(`<b>${RELICS[el.dataset.r].name}</b>: ${RELICS[el.dataset.r].text}`, 2600); });
  // status
  energyEl.innerHTML = `<span><b>${g.energy}</b><small>/${g.mode === 'counter' ? 2 : 3}</small></span>`;
  energyEl.classList.toggle('empty', g.energy === 0);
  const pct = (g.comp / g.compMax) * 100;
  const bar = compEl.querySelector('.bar');
  const z = g.zones[g.zi];
  const incoming = g.mode === 'play' && z?.intent.type === 'press' ? Math.max(0, z.intent.v - (pv?.control ?? g.control)) : 0;
  bar.querySelector('.loss').style.width = pct + '%';
  bar.querySelector('.cur').style.width = (Math.max(0, g.comp - incoming) / g.compMax) * 100 + '%';
  bar.querySelector('b').textContent = `${g.comp}/${g.compMax}`;
  bar.classList.toggle('low', g.comp <= 12);
  compEl.querySelector('.why').textContent = !incoming ? '' : incoming >= g.comp ? `−${incoming}: TURNOVER!` : `−${incoming} if you end turn`;
  const cpv = pv && pv.control != null && pv.control !== g.control ? ` <span class="pv">→${pv.control}</span>` : '';
  $('.ctrl span').innerHTML = `${g.control}${cpv}`;
  $('.rhy').hidden = !g.rhythm; $('.rhy span').textContent = g.rhythm;
  // hand
  handEl.innerHTML = g.hand.map((c, i) => cardHTML(c, i)).join('');
  [...handEl.children].forEach((el, i) => {
    el.onclick = (e) => { e.stopPropagation(); selectCard(i); };
    if (deal) { el.classList.add('dealt'); el.style.animationDelay = i * 60 + 'ms'; }
  });
  layoutHand();
  // hint + buttons
  const active = g.mode === 'play' || g.mode === 'counter';
  if (g.mode === 'counter') hintEl.innerHTML = `<b>Defend!</b> Each card adds its 🛡 value. Then <b>Face it</b>.`;
  else if (g.mode === 'play') hintEl.innerHTML = sel != null ? `Tap again or <b>Enter</b> to play` : g.energy === 0 || !g.hand.some((c) => costOf(g, c) <= g.energy) ? `Out of moves — <b>End turn</b>` : `${ZONES[g.zi]?.name || ''}: pick a card`;
  else if (g.mode === 'over') hintEl.innerHTML = 'Full time — pick a phase above to play again.';
  else hintEl.innerHTML = '';
  btnPlay.disabled = !active || sel == null || (g.hand[sel] && costOf(g, g.hand[sel]) > g.energy);
  btnPlay.firstChild.textContent = g.mode === 'counter' ? 'Defend ' : 'Play ';
  btnEnd.disabled = !active;
  btnEnd.firstChild.textContent = g.mode === 'counter' ? 'Face it ' : 'End turn ';
  btnUndo.disabled = !undoStack.length || !active;
  pilesEl.innerHTML = `Draw ${g.draw.length}<br>Disc ${g.disc.length}${g.exh.length ? ` · ✕${g.exh.length}` : ''}`;
  pilesEl.title = `Deck: ${allCards().length} cards (tap to view)`;
}

function layoutHand() {
  const cards = [...handEl.children];
  const n = cards.length, Wd = handEl.clientWidth || 360, cw = 108;
  const step = n > 1 ? Math.min(cw + 4, (Wd - cw) / (n - 1)) : 0;
  const x0 = (Wd - (cw + step * (n - 1))) / 2;
  cards.forEach((c, i) => {
    const mid = (n - 1) / 2, isSel = i === sel;
    c.style.left = x0 + i * step + 'px';
    c.style.transform = isSel ? 'translateY(-26px) scale(1.06)' : `translateY(${Math.abs(i - mid) ** 2 * 2}px) rotate(${(i - mid) * 3}deg)`;
    c.style.zIndex = isSel ? 50 : i + 1;
  });
}

function bump(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function flyCard(el, toEl) {
  const r = el.getBoundingClientRect(), t = toEl.getBoundingClientRect();
  const c = el.cloneNode(true);
  c.classList.add('flying');
  Object.assign(c.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', transform: 'none', zIndex: 75, margin: 0, animation: 'none' });
  document.body.appendChild(c);
  const dx = t.left + t.width / 2 - (r.left + r.width / 2), dy = t.top + t.height / 2 - (r.top + r.height / 2);
  const an = c.animate([
    { transform: 'translate(0,0) rotate(0deg) scale(1.05)', opacity: 1 },
    { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 40}px) rotate(-10deg) scale(.85)`, opacity: 1, offset: 0.55 },
    { transform: `translate(${dx}px, ${dy}px) rotate(14deg) scale(.25)`, opacity: 0 },
  ], { duration: 380, easing: 'cubic-bezier(.3,.7,.4,1)' });
  an.onfinish = () => c.remove();
  setTimeout(() => c.remove(), 700);
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
  if (g) drawScene(t, dt);
  requestAnimationFrame(frame);
}
function drawScene(t, dt) {
  ctx.clearRect(0, 0, W, H);
  pitch.draw(ctx, t, dt);
  const counter = !!g.counter && (g.mode === 'counter' || g.mode === 'anim');
  // zone bands
  ctx.save();
  ZONES.forEach((Z, i) => {
    const [x0, y0] = pitch.toPx(0, Z.v0), [x1, y1] = pitch.toPx(1, Z.v1);
    if (!counter && i < g.zi) { ctx.fillStyle = 'rgba(255,210,63,.16)'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); }
    if (!counter && i === g.zi) {
      ctx.fillStyle = `rgba(255,255,255,${0.08 + 0.05 * Math.sin(t * 4)})`; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.setLineDash([6, 5]); ctx.lineDashOffset = -t * 20; ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 2;
      ctx.strokeRect(x0 + 2, y0 + 2, x1 - x0 - 4, y1 - y0 - 4); ctx.setLineDash([]);
    }
    ctx.font = '11px "Lilita One", system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = i < g.zi && !counter ? 'rgba(255,230,120,.95)' : 'rgba(255,255,255,.7)';
    ctx.fillText((i < g.zi && !counter ? '✓ ' : '') + Z.short, x0 + 4, y0 + 3);
  });
  ctx.restore();

  const spr = [];
  const sz = clamp(H * 0.13, 26, 40);
  const recentHit = t - A.hitAt < 0.45;
  ZONES.forEach((Z, i) => {
    Z.foes.forEach((f, k) => {
      const u = Z.foes.length === 1 ? 0.5 : 0.24 + k * 0.17;
      const v = Z.key === 'gk' ? 0.015 : Z.v - 0.02;
      let pose = 'idle', alpha = 0.75;
      if (counter) { pose = 'idle'; alpha = 0.5; }
      else if (i < g.zi) { pose = 'sad'; alpha = 0.45; }
      else if (i === g.zi) {
        alpha = 1;
        pose = recentHit ? 'sad' : Z.key === 'gk' ? 'ready' : g.zones[i].intent.type === 'press' ? 'run' : g.zones[i].intent.type === 'foul' ? 'tackle' : 'ready';
      }
      if (g.mode === 'goal' && Z.key === 'gk') pose = 'dive';
      const [x, y] = pitch.toPx(u, v);
      spr.push({ y, draw: () => drawPlayer(ctx, byId[f], x + (recentHit && i === g.zi ? Math.sin(t * 60) * 2 : 0), y, { size: sz, pose, t, facing: -1, alpha, speed: 0.5 }) });
    });
  });
  if (!counter) {
    const tgt = ballTarget();
    const moving = Math.hypot(tgt.u - A.ball.u, tgt.v - A.ball.v) > 0.01;
    A.ball.u = lerp(A.ball.u, tgt.u, 1 - Math.pow(0.02, dt));
    A.ball.v = lerp(A.ball.v, tgt.v, 1 - Math.pow(0.02, dt));
    const [bx, by] = pitch.toPx(A.ball.u, A.ball.v);
    const celebrating = t < A.celebrateUntil;
    const carrier = byId[g.carrier] || byId.kenji;
    const [cx, cy] = celebrating ? pitch.toPx(0.62, 0.2) : [bx + sz * 0.32, by + sz * 0.14];
    spr.push({ y: cy, draw: () => drawPlayer(ctx, carrier, cx, cy, { size: sz * 1.1, pose: celebrating ? 'celebrate' : moving ? 'run' : 'idle', t, glow: '#FFD23F' }) });
    // a teammate offering support behind
    const mate = byId[g.carrier === 'lupe' ? 'kenji' : 'lupe'];
    const [mx, my] = pitch.toPx(0.78, Math.min(0.96, (ZONES[Math.min(g.zi, 4)].v + 0.14)));
    spr.push({ y: my, draw: () => drawPlayer(ctx, mate, mx, my, { size: sz * 0.95, pose: celebrating ? 'celebrate' : 'idle', t }) });
    spr.push({ y: by + 0.5, draw: () => drawBall(ctx, bx, by, sz * 0.15, t * (moving ? 12 : 0), g.mode === 'goal' ? 6 : 0) });
  } else {
    // counterattack: rival sprints at our goal
    const res = A.counterRes;
    const tv = res === 'goal' ? 0.9 : 0.74;
    A.runner.v = lerp(A.runner.v, tv, 1 - Math.pow(0.15, dt));
    A.runner.u = lerp(A.runner.u, 0.5, 1 - Math.pow(0.15, dt));
    const [rx, ry] = pitch.toPx(A.runner.u, A.runner.v);
    const run = byId[g.counter.runner];
    spr.push({ y: ry, draw: () => drawPlayer(ctx, run, rx, ry, { size: sz * 1.1, pose: res === 'goal' ? 'celebrate' : res === 'saved' ? 'sad' : 'run', t, glow: '#E8463A' }) });
    const [wx, wy] = pitch.toPx(0.5, 0.985);
    spr.push({ y: wy, draw: () => drawPlayer(ctx, byId.wak, wx + (res === 'saved' ? -10 : 0), wy, { size: sz * 1.1, pose: res === 'saved' ? 'dive' : res === 'goal' ? 'sad' : 'ready', t }) });
    for (const [id, u] of [['tomo', 0.3], ['mo', 0.7]]) {
      const [dx, dy] = pitch.toPx(u, 0.84);
      spr.push({ y: dy, draw: () => drawPlayer(ctx, byId[id], dx, dy, { size: sz, pose: res === 'saved' ? 'celebrate' : 'ready', t, facing: u < 0.5 ? 1 : -1 }) });
    }
    const [bx, by] = res === 'goal' ? pitch.toPx(0.56, 1.04) : res === 'saved' ? pitch.toPx(0.42, 0.97) : [rx + sz * 0.25, ry + 2];
    spr.push({ y: by + 0.5, draw: () => drawBall(ctx, bx, by, sz * 0.15, t * 10, 0) });
  }
  spr.sort((a, b) => a.y - b.y).forEach((s) => s.draw());
  pitch.drawFront(ctx, t);
}
requestAnimationFrame(frame);
window.pd = { get g() { return g; }, render: () => render() }; // debug hook

// ------------------------------------------------------------------ input
btnPlay.onclick = () => playSelected();
btnEnd.onclick = () => { sfx.click(); endTurn(); };
btnUndo.onclick = () => undo();
pilesEl.onclick = () => {
  const counts = {};
  allCards().forEach((c) => { counts[c.id] = (counts[c.id] || 0) + 1; });
  shell.modal({ title: `Your deck · ${allCards().length}`, html: `<div class="deckgrid">${Object.entries(counts).map(([id, n]) => cardHTML({ id }, -1, true) + (n > 1 ? `<b style="align-self:center">×${n}</b>` : '')).join('')}</div>`, wide: true });
};
root.addEventListener('click', (e) => { if (!e.target.closest('.gcard,.btn,.relic,.piles') && sel != null) { sel = null; render(); } });
window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.sheet-wrap')) return;
  if (/^[1-9]$/.test(e.key)) { selectCard(+e.key - 1); }
  else if (e.key === 'Enter') { e.preventDefault(); if (sel != null) playSelected(); else if (g.mode === 'counter') endTurn(); }
  else if (e.key === 'd' || e.key === 'D') endTurn();
  else if (e.key === 'z' || e.key === 'Z') undo();
  else if (e.key === 'Escape' && sel != null) { sel = null; render(); }
});
