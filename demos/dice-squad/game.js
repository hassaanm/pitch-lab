// Dice Squad: Dicey Dungeons football. Roll dice, slot them into your
// players' abilities, chip down each zone's defensive wall, then shoot.
import { Shell, oddsClass, clamp } from '../../shared/shell.js';
import { portrait } from '../../shared/art.js';
import { sfx } from '../../shared/sfx.js';
import { byId } from '../../shared/cast.js';
import { DiceView, ZONE_V } from './view.js';

// ================================================================ rules data
const ZONES = ['Defence', 'Midfield', 'Attack', 'Box'];
const WALLS = [[8, 12, 12, 8], [9, 13, 14, 9], [10, 14, 15, 10]];
const TURNS = 12;
const MATCHES = [
  { name: 'Redrock Reserves', sub: 'Friendly', variant: 'day', kBase: 1, hans: false },
  { name: 'Redrock United', sub: 'League', variant: 'dusk', kBase: 2, hans: true },
  { name: 'Redrock United', sub: 'Cup Final', variant: 'night', kBase: 3, hans: true },
];
const THREATS = [
  // Tuned by simulation (see NOTES.md): one tackle is never enough to win it.
  { key: 'viper', atk: 12, shot: 3 },
  { key: 'kofi', atk: 14, shot: 2 },
  { key: 'zed', atk: 11, shot: 3 },
];

// Abilities. test(v) = which dice fit. zones = where it works (attack only).
const AB = {
  longkick: { name: 'Long Kick', need: '4+', test: (v) => v >= 4, zones: [0], kind: 'dmg', dmg: (v) => v, text: 'Defence zone only. Deal the die to the wall.' },
  short: { name: 'Short Pass', need: '1–3', test: (v) => v <= 3, kind: 'dmg', dmg: (v) => v + 2 + (has('armband') ? 2 : 0), text: 'Deal die +2 to the wall.' },
  recycle: { name: 'Recycle', need: '1–2', test: (v) => v <= 2, kind: 'recycle', text: 'Reroll all your other free dice.' },
  vision: { name: 'Vision', need: '6', test: (v) => v === 6, kind: 'dmg', dmg: () => 9, text: 'Through ball: 9 damage.' },
  split: { name: 'Split', need: '2+', test: (v) => v >= 2, kind: 'split', text: 'Split the die into two halves (5 → 2 + 3).' },
  engine: { name: 'Engine', need: '≤5', test: (v) => v <= 5, kind: 'plus', text: '+1 to the die. It goes back to your tray.' },
  drive: { name: 'Drive', need: '3–5', test: (v) => v >= 3 && v <= 5, kind: 'dmg', dmg: (v) => v + 1, text: 'Carry it: deal die +1.' },
  dribble: { name: 'Dribble', need: 'EVEN', test: (v) => v % 2 === 0, kind: 'dmg', dmg: (v) => v + 2, text: 'Even dice only. Deal die +2.' },
  layoff: { name: 'Lay-off', need: '4+', test: (v) => v >= 4, zones: [2, 3], kind: 'dmg', dmg: (v) => v, text: 'Attack or Box. Deal the die.' },
  shoot: { name: 'Shoot', need: '5–6', test: (v) => v >= 5, zones: [3], kind: 'shot', text: 'Box only. Shot power = die +2 vs their keeper. A shot ends your attack.' },
  // defence
  save: { name: 'Save', need: 'ANY', test: () => true, kind: 'save', text: 'Keeper value = die +2. Beat their shot power.' },
  tackle: { name: 'Tackle', need: 'ANY', test: () => true, kind: 'stop', amt: (v) => v, text: 'Take the die off their attack.' },
  track: { name: 'Track Back', need: 'EVEN', test: (v) => v % 2 === 0, kind: 'stop', amt: (v) => v, text: 'Even dice. Take the die off their attack.' },
  nick: { name: 'Nick It', need: '6', test: (v) => v === 6, kind: 'stop', amt: () => 7, text: 'A 6 takes 7 off their attack.' },
  press: { name: 'Press', need: '5–6', test: (v) => v >= 5, kind: 'stop', amt: () => 3, text: 'Take 3 off their attack.' },
};
const SQUAD = [
  { id: 'wak', atk: ['longkick'], def: ['save'] },
  { id: 'tomo', atk: ['short', 'recycle'], def: ['tackle'] },
  { id: 'kenji', atk: ['vision', 'split'], def: ['split'] },
  { id: 'lupe', atk: ['engine', 'drive'], def: ['engine', 'track'] },
  { id: 'pip', atk: ['dribble'], def: ['nick'] },
  { id: 'rio', atk: ['layoff', 'shoot'], def: ['press'] },
];
const UPGRADES = {
  die5: { name: 'Fifth Die', icon: '🎲', text: 'Roll 5 dice every turn.' },
  armband: { name: "Captain's Armband", icon: '©️', text: "Tomo's Short Pass deals +2 more." },
  gloves: { name: 'New Gloves', icon: '🧤', text: "Wak's Save gets +2." },
  eagle: { name: 'Eagle Eye', icon: '🦅', text: "Rio's shot power +1." },
  lucky: { name: 'Lucky Boots', icon: '🍀', text: 'Once per turn, reroll one die (G).' },
  engine2: { name: 'Second Wind', icon: '🫀', text: "Lupe's Engine works twice per turn." },
};
const SOCK_KEYS = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'];
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

const shell = new Shell({
  id: 'dice-squad',
  title: 'Dice Squad',
  pitch: 'Dicey Dungeons on a football pitch. Roll dice, slot them into your players\' abilities, and chip through four defensive walls to the goal.',
  how: [
    'Each turn you roll 4 dice. Tap a die, then tap a glowing socket on a player card. Each socket works once per turn and only takes dice that fit (1–3, EVEN, 6…).',
    'Every die you slot plays out on the pitch: a pass or a run into the wall. Damage chips the wall of the zone you are in: Defence → Midfield → Attack → Box. Break a wall to move up and leftover dice keep working, but you break at most one line per turn: the next wall holds at 1 until next turn.',
    'The ⏱ pressure clock gives you 3 turns per line. If it runs out, their nearest defender tackles you and they attack.',
    'In the Box, Rio can Shoot with a 5–6. The socket shows your goal chance before you commit. Their keeper\'s 6 always saves, and a shot ends your attack (leftover dice are lost).',
    'When they attack, slot dice to tackle (shrink their attack to 0 and your tackler wins the ball for a counter from Midfield) and give Wak a die to save (die +2). Press Defend to let them shoot. The meter shows their chance to score.',
    'Watch out: Spider Lu steals your highest die in the Attack zone, and Iron Hans locks a die in the Box (from the League match on). They strike at the start of each turn there, and the moment you arrive in their zone.',
    'After each match pick one upgrade. A drawn Final goes to sudden-death penalties.',
    'Keys: 1–5 pick a die · Q W E R T… sockets in card order · Enter ends the turn · G lucky reroll.',
  ],
  notice: 'Does slotting dice feel like building play, or like a puzzle wearing a kit?',
  phases: [
    { id: 'early', label: 'Kickoff', sub: "Friendly · 0' · 0–0" },
    { id: 'mid', label: 'Midgame', sub: "League · 45' · 1–1" },
    { id: 'clutch', label: 'Clutch', sub: "Final · 75' · 1–2" },
  ],
  onPhase: (id) => startPhase(id),
});
const stage = shell.stage;

let run = null;   // { match, up:Set, results:[] }
let m = null;     // current match state
let view = null;
let busy = false;
let dieSeq = 1;
let gen = 0;   // bumps on every new match; stale async flows stop at their next await
const stale = (g) => g !== gen ? new Promise(() => {}) : null;
const has = (u) => run?.up.has(u);
const JANK = new URLSearchParams(location.search).has('jank');

// ================================================================ phases
function startPhase(id) {
  busy = false;
  document.querySelectorAll('.die.flying').forEach((e) => e.remove());
  if (id === 'early') {
    run = { match: 0, up: new Set(), results: [] };
    startMatch({});
    shell.log('Friendly vs Redrock Reserves. Break four walls, then shoot.', 'info', "0'");
  }
  if (id === 'mid') {
    run = { match: 1, up: new Set(['die5']), results: ['W'] };
    startMatch({ turn: 7, score: [1, 1], zone: 1, wallNow: { 1: 5 }, clock: 2 });
    shell.log('Half-time came and went at 1–1. You are through their press and chipping at the midfield (5/13).', 'info', "45'");
    shell.log('Upgrade from the friendly: 🎲 Fifth Die.', 'info', '');
  }
  if (id === 'clutch') {
    run = { match: 2, up: new Set(['die5', 'eagle']), results: ['W', 'D'] };
    startMatch({ turn: 11, score: [1, 2], zone: 2, wallNow: { 2: 3 }, clock: 2 });
    shell.log('Cup Final, 75\'. 1–2 down. Two turns left. Their Attack wall is at 3/15 — then the Box.', 'info', "75'");
    shell.log('Spider Lu guards the Attack zone (steals your best die). Iron Hans guards the Box (locks a die).', 'bad', '');
  }
}

// ================================================================ match setup
function startMatch(o) {
  const M = MATCHES[run.match];
  m = {
    turn: o.turn || 1, score: o.score ? [...o.score] : [0, 0], mode: 'attack', zone: o.zone || 0,
    wallMax: [...WALLS[run.match]], wall: [...WALLS[run.match]], clock: o.clock ?? 3,
    dice: [], used: {}, sel: null, threat: null, luckyUsed: false, engineUses: 0,
  };
  for (const z in o.wallNow || {}) m.wall[z] = o.wallNow[z];
  for (let z = 0; z < m.zone; z++) m.wall[z] = 0;
  stage.innerHTML = `<div class="ds${has('die5') ? ' six' : ''}">
    <div class="status"><span class="mname">${M.sub} · vs <b>${M.name}</b></span><span class="clock" id="clock"></span></div>
    <div class="pitchwrap"><canvas id="pitch"></canvas><div class="modebadge" id="modebadge"></div></div>
    <div class="ztrack" id="ztrack"></div>
    <div class="info" id="info"></div>
    <div class="tray"><div class="dice" id="dice"></div><button class="btn" id="endbtn"></button></div>
    <div class="cards" id="cards"></div>
    ${run.up.size ? `<div class="ups">${[...run.up].map((u) => `<span class="chip" title="${UPGRADES[u].text}">${UPGRADES[u].icon} ${UPGRADES[u].name}</span>`).join('')}</div>` : ''}
  </div>`;
  gen++;
  if (view) view.running = false;
  view = new DiceView(stage.querySelector('#pitch'));
  fitPitch(M.variant);
  if (JANK) window.__ds = { view, get m() { return m; } };
  window.onresize = () => fitPitch(M.variant);
  const red = (id, zone, du) => ({ c: byId[id], key: id, zone, du });
  view.setTeams(SQUAD.map((p) => ({ c: byId[p.id], key: p.id })),
    [red('viper', 0, 0.62), red('kofi', 0, 0.3), red('zed', 1, 0.3), red('marisol', 1, 0.7), red('lu', 2, 0.38), red('nils', 2, 0.72), red('hans', 3, 0.36), red('dima', 3, 0.66), { c: byId.oskar, key: 'oskar', zone: 3, du: 0.5 }]);
  view.setZone(m.zone, 'attack');
  view.layout(true);
  view.give(view.find(m.zone === 0 ? 'tomo' : 'kenji'));
  stage.querySelector('#endbtn').onclick = endTurn;
  startAttackTurn(true);
}
function fitPitch(variant) {
  const wrap = stage.querySelector('.pitchwrap');
  if (!wrap || !view) return;
  const w = wrap.clientWidth;
  view.resize(w, Math.round(Math.min(w * 0.62, 300)), variant);
  view.layout(true);
}
const minute = () => Math.round((m.turn - 1) * 7.5);
const setScore = (clock) => shell.setScore({ home: m.score[0], away: m.score[1], clock: clock ?? `${minute()}'`, awayTeam: 'red' });

// ================================================================ dice
const newDie = (v) => ({ id: dieSeq++, v: v ?? 1 + Math.floor(Math.random() * 6), locked: false, stolen: false });
const free = () => m.dice.filter((d) => !d.locked && !d.stolen);
function dieHTML(d, o = {}) {
  const v = o.face ?? d.v;
  return `<span class="die ${o.cls || ''} ${d && m.sel === d.id ? 'sel' : ''} ${d?.locked ? 'locked' : ''} ${d?.stolen ? 'stolen' : ''}" ${o.attr || ''}>
    <span class="pips">${Array.from({ length: 9 }, (_, i) => `<i class="${PIPS[v]?.includes(i) ? 'on' : ''}"></i>`).join('')}</span>${o.key ? `<span class="kh">${o.key}</span>` : ''}</span>`;
}

async function rollDice(n) {
  const g = gen;
  m.dice = Array.from({ length: n }, () => newDie());
  m.sel = null;
  const box = stage.querySelector('#dice');
  const t0 = performance.now();
  box.innerHTML = m.dice.map((d, i) => dieHTML(d, { face: 1 + Math.floor(Math.random() * 6), cls: 'rolling', attr: `style="animation-delay:${i * 40}ms"` })).join('');
  const els = [...box.querySelectorAll('.die')];
  await new Promise((res) => {
    const tick = () => {
      // Faces flicker inside the same elements so the tumble animation plays once.
      els.forEach((el, i) => { const f = performance.now() - t0 > 440 ? m.dice[i].v : 1 + Math.floor(Math.random() * 6); el.querySelectorAll('.pips i').forEach((p, j) => p.classList.toggle('on', PIPS[f].includes(j))); });
      sfx.tick();
      if (performance.now() - t0 < 520) setTimeout(tick, 75); else res();
    };
    tick();
  });
  if (stale(g)) return stale(g);
  sfx.thud();
}

// A rival lunges at your carrier and takes one die. The pitch label and the
// tray die change on the contact frame. Fires at turn start and when the
// attack enters his zone mid-turn.
async function tamper(kind, entering = false) {
  const isLu = kind === 'lu';
  const pool = m.dice.filter((d) => !d.stolen && !d.locked);
  if (!pool.length) return;
  const d = isLu ? [...pool].sort((a, b) => b.v - a.v)[0] : pool[Math.floor(Math.random() * pool.length)];
  const rival = view.find(isLu ? 'lu' : 'hans');
  const c = view.carrier;
  // Reach: he runs at the carrier and stops a stride short, then lunges.
  if (c) {
    const dir = Math.sign(rival.x - c.x) || 1;
    await view.runTo(rival, c.x + dir * view.size * 0.6, c.y + 2, 0.3);
    rival.facing = -dir;
  }
  rival.pose = 'tackle';
  if (c && c.side === 'you') c.pose = 'sad';
  view.hitstop = 0.08;
  if (isLu) d.stolen = true; else d.locked = true;
  for (const l of view.labels) l.t = Math.max(l.t, l.life * 0.8);   // older callouts fade so this one reads alone
  view.label(isLu ? `🕸 STOLE A ${d.v}` : `⛓ LOCKED A ${d.v}`, rival.x, rival.y - view.size, isLu ? '#CE93D8' : '#9BE7FF');
  shell.log(isLu ? `Spider Lu's web${entering ? ' as you arrive' : ''}: he steals your highest die (${d.v}) this turn.` : `Iron Hans${entering ? ' meets you in the Box and' : ''} locks one of your dice (${d.v}). It can't be used this turn.`, 'bad', `${minute()}'`);
  isLu ? sfx.whoosh() : sfx.thud();
  renderAll();
  stage.querySelector(`[data-die="${d.id}"]`)?.classList.add('hitnow');
  await view.wait(0.35);
  await view.getUp(rival);
  if (c && c.pose === 'sad') c.pose = 'idle';
  view.release(rival);                     // he jogs back into the wall
}

const rivals = async (entering = false) => {
  if (m.zone === 2) await tamper('lu', entering);
  if (m.zone === 3 && MATCHES[run.match].hans) await tamper('hans', entering);
};

// ================================================================ turns
async function startAttackTurn(first = false) {
  if (m.turn > TURNS) return fullTime();
  setBusy(true);
  m.mode = 'attack'; m.used = {}; m.luckyUsed = false; m.engineUses = 0; m.broke = false;
  view.setZone(m.zone, 'attack');
  setScore();
  renderAll(true);
  await rollDice(4 + (has('die5') ? 1 : 0));
  renderAll();
  if (!first || m.turn === 1) shell.log(`Turn ${m.turn}: you roll ${m.dice.map((d) => d.v).join(' · ')} in the ${ZONES[m.zone]} zone (wall ${m.wall[m.zone]}/${m.wallMax[m.zone]}).`, '', `${minute()}'`);
  await rivals();
  setBusy(false);
  renderAll();
}

async function endTurn() {
  if (busy) return;
  if (m.mode === 'defend') return resolveDefence();
  if (m.mode !== 'attack') return;
  sfx.click();
  const left = free().length;
  m.turn++;
  m.clock--;
  if (left) shell.log(`${left} unused ${left > 1 ? 'dice' : 'die'} wasted.`, 'info', `${minute()}'`);
  if (m.turn > TURNS) return fullTime();
  if (m.clock <= 0) return turnover();
  startAttackTurn();
}

// ================================================================ placing
function sockets() {
  const out = [];
  for (const p of SQUAD) for (const ab of (m.mode === 'defend' ? p.def : p.atk)) out.push({ p: p.id, ab, key: `${p.id}:${ab}` });
  return out;
}
function sockState(s, d) {
  const A = AB[s.ab];
  if (m.used[s.key] && !(s.ab === 'engine' && has('engine2') && m.engineUses < 2 && m.used[s.key].n < 2)) return { ok: false, why: 'Used this turn' };
  if (m.mode === 'attack' && A.zones && !A.zones.includes(m.zone)) return { ok: false, why: A.zones.length === 1 ? `${ZONES[A.zones[0]]} only` : 'Attack or Box only' };
  if (!d) return { ok: true };
  if (d.locked) return { ok: false, why: 'Locked by Hans' };
  if (d.stolen) return { ok: false, why: 'Stolen by Lu' };
  if (!A.test(d.v)) return { ok: false, why: `Needs ${A.need}` };
  return { ok: true };
}
function preview(s, d) {
  const A = AB[s.ab];
  if (A.kind === 'dmg') {
    const n = A.dmg(d.v), after = wallAfter(n), held = after > 0 && m.wall[m.zone] - n <= 0;
    return { tag: held ? `−${n}→1` : `−${n}`, held, text: `${A.name}: −${n} to the ${ZONES[m.zone]} wall (${m.wall[m.zone]} → ${after})${held ? ' — holds at 1: one line per turn' : after === 0 && m.wall[m.zone] > 0 ? (m.zone < 3 ? ' — breaks the line!' : ' — opens the box!') : ''}` };
  }
  if (A.kind === 'shot') { const p = shotP(d.v); return { tag: `${Math.round(p * 100)}%`, odds: p, text: `Shoot: power ${shotPower(d.v)} vs keeper ${keeperBase()}+d6 (a 6 always saves) → <b>${Math.round(p * 100)}% goal</b>${m.wall[3] > 0 ? ' (box wall up: keeper +2)' : ''}. Ends your attack.` }; }
  if (A.kind === 'recycle') return { tag: '↻', text: 'Recycle: reroll your other free dice.' };
  if (A.kind === 'split') return { tag: `${Math.floor(d.v / 2)}+${Math.ceil(d.v / 2)}`, text: `Split ${d.v} into ${Math.floor(d.v / 2)} and ${Math.ceil(d.v / 2)}.` };
  if (A.kind === 'plus') return { tag: `→${d.v + 1}`, text: `Engine: ${d.v} becomes ${d.v + 1}.` };
  if (A.kind === 'stop') { const n = Math.min(A.amt(d.v), m.threat.atk); return { tag: A.amt(d.v) >= 99 ? 'WIN' : `−${n}`, text: `${A.name}: their attack ${m.threat.atk} → ${Math.max(0, m.threat.atk - A.amt(d.v))}${m.threat.atk - A.amt(d.v) <= 0 ? ' — you win the ball!' : ''}` }; }
  if (A.kind === 'save') { const k = saveVal(d.v); const p = theirGoalP(m.threat.atk, k); return { tag: `${Math.round((1 - p) * 100)}% save`, odds: 1 - p, text: `Wak saves at ${k}. Their chance to score: <b>${Math.round(p * 100)}%</b>` }; }
  return { tag: '', text: '' };
}

// True when a damage socket this die fits would be stopped by the one-line rule.
const holdsAny = (d) => m.mode === 'attack' && sockets().some((s) => AB[s.ab].kind === 'dmg' && sockState(s, d).ok && preview(s, d).held);
// One line per turn: once a wall has broken this turn, the next one holds at 1.
const wallAfter = (n) => (m.wall[m.zone] <= 0 ? 0 : Math.max(m.broke ? 1 : 0, m.wall[m.zone] - n));
const shotPower = (v) => v + 2 + (has('eagle') ? 1 : 0);
const keeperBase = () => MATCHES[run.match].kBase + (m.wall[3] > 0 ? 2 : 0);
// The keeper's 6 always saves, so no shot is better than 5 in 6.
const beats = (v, roll) => roll < 6 && shotPower(v) > keeperBase() + roll;
const shotP = (v) => { let n = 0; for (let k = 1; k <= 6; k++) if (beats(v, k)) n++; return n / 6; };
const saveVal = (v) => v + 2 + (has('gloves') ? 2 : 0);
const theirPower = (atk) => m.threat.shot + Math.ceil(Math.max(0, atk) / 3);
function theirGoalP(atk, keeper) {
  if (atk <= 0) return 0;
  let n = 0; for (let k = 1; k <= 6; k++) if (theirPower(atk) + k > keeper) n++;
  return n / 6;
}

function selectDie(id) {
  if (busy) return;
  const d = m.dice.find((x) => x.id === id);
  if (!d) return;
  if (d.stolen) { shell.toast('Spider Lu has that one 🕸'); sfx.bad(); return; }
  if (d.locked) { shell.toast('Iron Hans locked that die ⛓'); sfx.bad(); return; }
  m.sel = m.sel === id ? null : id;
  sfx.click();
  renderAll();
}

// Abilities where the card's player plays the ball forward (contact = the pass
// arrives); the rest carry it (contact = the run ends in the defender's face).
const PASSERS = { longkick: true, short: true, vision: true, layoff: true };

async function place(sockKey, dieId = m.sel) {
  if (busy) return;
  const s = sockets().find((x) => x.key === sockKey);
  const d = m.dice.find((x) => x.id === dieId);
  if (!s) return;
  if (!d) { shell.toast('Pick a die first'); return; }
  const st = sockState(s, d);
  if (!st.ok) { sfx.bad(); shell.toast(st.why); const el = stage.querySelector(`[data-sock="${sockKey}"]`); el?.classList.remove('nope'); void el?.offsetWidth; el?.classList.add('nope'); return; }
  setBusy(true);
  await snap(d.id, sockKey);
  const A = AB[s.ab];
  const who = byId[s.p].name;
  const actor = view.find(s.p);
  m.sel = null;
  const mark = (v) => { const u = m.used[sockKey]; m.used[sockKey] = { v, n: (u?.n || 0) + 1 }; };
  if (A.kind !== 'plus') m.dice = m.dice.filter((x) => x.id !== d.id);
  mark(d.v);
  if (A.kind === 'dmg') {
    const n = A.dmg(d.v);
    const before = m.wall[m.zone];
    renderAll();                         // die sits in the socket; the wall has not moved yet
    await playBall(actor, s.ab, (x, y) => {
      m.wall[m.zone] = wallAfter(n);
      view.label(m.wall[m.zone] === 1 && m.broke && before - n <= 0 ? `−${n} · HOLDS` : `−${n}`, x, y - view.size, '#FFD23F');
      popZone(m.zone, `−${n}`);
      sfx.thud();
      shell.log(`${who} · ${A.name} (${d.v}): −${n} to the ${ZONES[m.zone]} wall → ${m.wall[m.zone]}/${m.wallMax[m.zone]}.`, 'good', `${minute()}'`);
      renderAll();
    });
    if (m.wall[m.zone] === 0 && before > 0) await breakLine();
  } else if (A.kind === 'recycle') {
    const others = free();
    shell.log(`${who} · Recycle (${d.v}): reroll ${others.length} ${others.length === 1 ? 'die' : 'dice'}.`, '', `${minute()}'`);
    m.dice = m.dice.map((x) => (!x.locked && !x.stolen ? newDie() : x));
    renderAll();
    stage.querySelectorAll('#dice .die:not(.locked):not(.stolen)').forEach((el) => el.classList.add('rolling'));
    sfx.deal();
    await view.wait(0.45);
  } else if (A.kind === 'split') {
    const a = newDie(Math.floor(d.v / 2)), b = newDie(Math.ceil(d.v / 2));
    m.dice.push(a, b);
    shell.log(`${who} · Split: ${d.v} → ${a.v} + ${b.v}.`, '', `${minute()}'`);
    sfx.whoosh();
    renderAll();
    for (const x of [a, b]) stage.querySelector(`[data-die="${x.id}"]`)?.classList.add('rolling');
    await view.wait(0.4);
  } else if (A.kind === 'plus') {
    m.engineUses++;
    d.v += 1;
    shell.log(`${who} · Engine: die bumped to ${d.v}.`, '', `${minute()}'`);
    sfx.good();
    m.sel = d.id;
    renderAll();
    stage.querySelector(`[data-die="${d.id}"]`)?.classList.add('rolling');
    await view.wait(0.3);
  } else if (A.kind === 'shot') {
    renderAll();
    await shoot(d.v, actor);
    return;
  } else if (A.kind === 'stop') {
    const n = A.amt(d.v);
    const left = Math.max(0, m.threat.atk - n);
    renderAll();
    const att = view.find(m.threat.key);
    await view.tackle(actor, att, { win: left <= 0, onContact: () => {
      m.threat.atk = left;
      view.label(n >= 99 ? 'NICKED!' : left <= 0 ? 'WON IT!' : `−${n}`, att.x, att.y - view.size, '#9BE7FF');
      sfx.thud();
      shell.log(`${who} · ${A.name} (${d.v}): their attack → ${m.threat.atk}.`, 'good', `${minute()}'`);
      renderAll();
    } });
    if (m.threat.atk <= 0) return wonBall(actor);
  } else if (A.kind === 'save') {
    m.threat.keeper = saveVal(d.v);
    const wak = view.find('wak');
    wak.pose = 'ready';
    view.label(`SAVE ${m.threat.keeper}`, wak.x, wak.y - view.size, '#9BE7FF');
    sfx.save();
    shell.log(`Wak sets himself: save value ${m.threat.keeper}.`, '', `${minute()}'`);
    renderAll();
    await view.wait(0.3);
  }
  setBusy(false);
}

// The ball physically does the ability. onContact(x, y) fires on the frame it lands.
async function playBall(actor, ab, onContact) {
  const fwd = (a) => view.actors.filter((b) => b.side === 'you' && b !== a && b.c.pos !== 'GK').sort((p, q) => p.y - q.y)[0];
  if (PASSERS[ab]) {
    // The card's player gets the ball, then plays it forward.
    if (view.carrier !== actor) await view.passTo(actor);
    sfx.pass();
    const to = fwd(actor);
    await view.passTo(to, ab === 'longkick' || ab === 'vision');
    view.flinch(view.wallMan(to.x, to.y));
    onContact(to.x, to.y);
  } else {
    // Carry: the player takes the ball and drives at the nearest wall defender.
    if (view.carrier !== actor) await view.passTo(actor);
    const man = view.wallMan(actor.x, actor.y);
    const tx = man ? lerp(actor.x, man.x, 0.6) : actor.x, ty = man ? man.y + view.size * 0.45 : actor.y - view.size;
    await view.runTo(actor, tx, ty, 0.32);
    actor.pose = 'kick';
    view.flinch(man);
    onContact(actor.x, actor.y);
    await view.wait(0.12);
    view.release(actor);
  }
  await view.wait(0.25);
}
const lerp = (a, b, k) => a + (b - a) * k;

function setBusy(on) {
  busy = on;
  stage.querySelector('.ds')?.classList.toggle('busy', on);
}

// Fly a copy of the die into the socket.
async function snap(dieId, sockKey) {
  const from = stage.querySelector(`[data-die="${dieId}"]`), to = stage.querySelector(`[data-sock="${sockKey}"] .hole`);
  if (!from || !to) return;
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
  const ghost = from.cloneNode(true);
  ghost.classList.add('flying');
  Object.assign(ghost.style, { left: a.left + 'px', top: a.top + 'px', width: a.width + 'px', height: a.height + 'px' });
  document.body.appendChild(ghost);
  from.style.visibility = 'hidden';
  sfx.card();
  const anim = ghost.animate([{ transform: 'translate(0,0) rotate(0) scale(1)' },
    { transform: `translate(${(b.left - a.left) / 2}px, ${(b.top - a.top) / 2 - 30}px) rotate(200deg) scale(1.1)`, offset: 0.6 },
    { transform: `translate(${b.left - a.left}px, ${b.top - a.top}px) rotate(360deg) scale(${b.width / a.width})` }], { duration: 260, easing: 'ease-in' });
  const g = gen;
  // Never let the turn hang on a paused animation timeline.
  await Promise.race([anim.finished.catch(() => {}), new Promise((r) => setTimeout(r, 320))]);
  ghost.remove();
  if (stale(g)) return stale(g);
  sfx.thud();
}

async function breakLine() {
  const z = m.zone;
  m.broke = true;
  if (z < 3) {
    view.label('LINE BROKEN!', view.w / 2, view.pitch.toPx(0, ZONE_V[z])[1] - view.size, '#FFD23F', 1.2, true);
    sfx.whoosh(); sfx.roar(0.5);
    shell.shake(stage.querySelector('.pitchwrap'));
    await view.wait(0.25);
    m.zone++;
    m.clock = 3;
    view.setZone(m.zone, 'attack');           // the team surges up; beaten defenders fade
    shell.log(`<b>${ZONES[z]} line broken!</b> Into the ${ZONES[m.zone]} zone. Clock reset to 3. Leftover dice still count, but the next wall holds at 1 this turn.`, 'good', `${minute()}'`);
    renderAll();
    if (view.carrier) await view.passTo(view.find(m.zone >= 2 ? 'rio' : 'kenji'), true);
    await rivals(true);
  } else {
    view.label('BOX OPEN!', view.w / 2, view.pitch.toPx(0, 0.12)[1] + view.size, '#FFD23F', 1.2, true);
    sfx.roar(0.6);
    shell.log('Box wall down: their keeper loses his +2. Shoot!', 'good', `${minute()}'`);
    renderAll();
  }
  await view.wait(0.3);
}

async function shoot(v, actor) {
  const p = shotP(v), power = shotPower(v), roll = 1 + Math.floor(Math.random() * 6), kv = keeperBase() + roll;
  const goal = beats(v, roll);
  const pct = Math.round(p * 100);
  if (view.carrier !== actor) await view.passTo(actor);
  await view.wait(0.12);
  const result = goal ? 'goal' : (Math.random() < 0.6 ? 'save' : 'miss');
  sfx.kick();
  const gk = view.keeper('opp');
  await view.shotAt(true, result, () => {
    shell.log(`Rio shoots (${pct}%): power ${power} vs keeper ${keeperBase()}+${roll} = ${kv}${roll === 6 ? ' (a 6 always saves)' : ''}.`, '', `${minute()}'`);
    if (goal) {
      m.score[0]++;
      setScore();
      sfx.goal();
      shell.banner('GOAL!', `Rio · ${pct}% shot · ${m.score[0]}–${m.score[1]}`);
      shell.confetti(); shell.flash('#FFD23F'); shell.shake();
      view.celebrate('you');
      shell.log(`<b>GOAL! Rio.</b> ${m.score[0]}–${m.score[1]}`, 'goal', `${minute()}'`);
    } else {
      result === 'save' ? sfx.save() : sfx.ooh();
      view.label(result === 'save' ? `SAVED · ${pct}%` : `WIDE · ${pct}%`, view.ball.x, view.ball.y + view.size, '#9BE7FF');
      shell.log(`${result === 'save' ? 'Oskar saves' : 'Just wide'} (keeper ${kv} vs power ${power}).`, 'bad', `${minute()}'`);
    }
  });
  m.turn++;
  if (goal) {
    await view.wait(1.0);
    view.celebrate('you', false);
    if (m.turn > TURNS) return fullTime();
    // Their kick-off: cover the reset.
    return startDefend(() => view.cut(() => { prepThreat(); view.give(view.find(m.threat.key)); }));
  }
  await view.wait(0.3);
  if (m.turn > TURNS) { view.recover(gk); return fullTime(); }
  if (result === 'save') {
    // Oskar has it in his hands: he gets up and throws it out to their attacker.
    view.recover(gk);
    return startDefend(async () => { prepThreat(); await view.wait(0.35); await view.passTo(view.find(m.threat.key), true); });
  }
  // Wide: goal kick. The ball is out of play, so cover the reset.
  return startDefend(async () => {
    await view.cut(() => { view.recover(gk); view.give(gk); });
    prepThreat();
    await view.wait(0.2);
    await view.passTo(view.find(m.threat.key), true);
  });
}

// ================================================================ defending
function pickThreat() {
  const base = THREATS[Math.floor(Math.random() * THREATS.length)];
  m.threat = { ...base, atk: base.atk + run.match, shot: base.shot + (run.match >= 2 ? 1 : 0), keeper: 1 };
  m.threat.start = m.threat.atk;
}
// Switch the pitch into their attacking shape (players jog there).
function prepThreat() {
  if (!m.threat) pickThreat();
  view.threatKey = m.threat.key; view.threatV = 0.5; view.threatU = 0.5;
  view.setZone(0, 'defend');
}

// They have the ball. `bringBall` is the motion that got it to their attacker.
async function startDefend(bringBall) {
  setBusy(true);
  m.mode = 'defend'; m.used = {}; m.engineUses = 0; m.luckyUsed = false; m.sel = null; m.dice = [];
  m.threat = null;
  pickThreat();
  renderAll(true);
  await bringBall?.();
  const c = byId[m.threat.key];
  setScore();
  shell.log(`${c.name} attacks: Attack ${m.threat.atk}, shot ${m.threat.shot} + attack÷3 + d6. Tackle it to 0 or trust Wak.`, 'them', `${minute()}'`);
  renderAll(true);
  await rollDice(4 + (has('die5') ? 1 : 0));
  setBusy(false);
  renderAll();
}

// Pressure clock ran out: the nearest wall defender tackles your carrier,
// then plays it to their attacker.
async function turnover() {
  setBusy(true);
  m.dice = []; m.sel = null; renderAll();
  const carrier = view.carrier;
  const tackler = view.wallMan(carrier.x, carrier.y) || view.find('viper');
  shell.log(`⏱ Pressure clock hit zero in the ${ZONES[m.zone]} zone.`, 'bad', `${minute()}'`);
  await view.tackle(tackler, carrier, { win: true, onContact: () => {
    sfx.bad();
    view.label('TURNOVER', tackler.x, tackler.y - view.size, '#FF8A80');
    shell.banner('TURNOVER', `${byId[tackler.key].name} wins it`, '#FF8A80');
    shell.log(`${byId[tackler.key].name} wins the ball. Turnover!`, 'bad', `${minute()}'`);
  } });
  return startDefend(async () => {
    prepThreat();
    await view.wait(0.2);
    await view.passTo(view.find(m.threat.key), true);
  });
}

async function wonBall(actor) {
  setBusy(true);
  sfx.good();
  shell.banner('WON IT!', `${byId[actor.key].name} · counter from midfield`);
  shell.log(`Ball won by ${byId[actor.key].name}! You counter from the Midfield zone.`, 'good', `${minute()}'`);
  m.turn++;
  m.zone = 1; m.clock = 3; m.wall = [0, ...m.wallMax.slice(1)];
  view.threatKey = null;
  view.setZone(1, 'attack');   // everyone jogs into the counter shape; the tackler carries it
  await view.wait(0.7);
  startAttackTurn();
}

async function resolveDefence() {
  setBusy(true);
  m.sel = null; renderAll();
  const T = m.threat, c = byId[T.key];
  const p = theirGoalP(T.atk, T.keeper);
  const roll = 1 + Math.floor(Math.random() * 6), power = theirPower(T.atk) + roll;
  const goal = power > T.keeper;
  const pct = Math.round(p * 100);
  // He carries it at goal, then shoots.
  const att = view.find(T.key);
  // He shoots from the edge of the box, well clear of Wak (Wak stands at v 0.95).
  const [sx, sy] = view.pitch.toPx(clamp(att.u, 0.35, 0.65), 0.68);
  await view.runTo(att, sx, sy, 0.55);
  await view.wait(0.1);
  sfx.kick();
  const wak = view.keeper('you');
  await view.shotAt(false, goal ? 'goal' : 'save', () => {
    shell.log(`${c.name} shoots (${pct}%): power ${theirPower(T.atk)}+${roll} = ${power} vs Wak ${T.keeper}.`, 'them', `${minute()}'`);
    if (goal) {
      m.score[1]++;
      setScore();
      sfx.groan();
      shell.banner('GOAL', `${c.name} · ${m.score[0]}–${m.score[1]}`, '#FF6B6B');
      shell.shake(); shell.flash('#E8463A');
      view.celebrate('opp');
      shell.log(`<b>${c.name} scores.</b> ${m.score[0]}–${m.score[1]}`, 'goal', `${minute()}'`);
    } else {
      sfx.save();
      view.label(`SAVED · ${100 - pct}%`, wak.x, wak.y - view.size * 1.2, '#9BE7FF');
      shell.log(`Wak saves (${T.keeper} holds ${power})! Your ball from the back.`, 'good', `${minute()}'`);
    }
  });
  view.release(att);
  m.turn++;
  m.zone = 0; m.clock = 3; m.wall = [...m.wallMax];
  view.threatKey = null;
  if (goal) {
    await view.wait(1.0);
    view.celebrate('opp', false);
    if (m.turn > TURNS) { view.recover(wak); return fullTime(); }
    await view.cut(() => { view.recover(wak); view.setZone(0, 'attack'); view.give(wak); });
  } else {
    await view.wait(0.3);
    view.recover(wak);          // Wak keeps it in his hands and gets up
    if (m.turn > TURNS) return fullTime();
  }
  startAttackTurn();
}

// ================================================================ full time and upgrades
function fullTime() {
  m.mode = 'over';
  busy = true;
  setScore('FT');
  sfx.whistle(3);
  const [a, b] = m.score;
  if (a === b && run.match === MATCHES.length - 1 && !m.pens) return penalties();
  const r = m.pens ? m.pens : a > b ? 'W' : a < b ? 'L' : 'D';
  run.results.push(r);
  const M = MATCHES[run.match];
  shell.log(`Full time: ${a}–${b} vs ${M.name}.`, r === 'W' ? 'good' : 'bad', "90'");
  if (r === 'W') { sfx.win(); shell.confetti(); } else sfx.lose();
  renderAll();
  const last = run.match === MATCHES.length - 1;
  if (last) {
    const won = r === 'W';
    shell.modal({ title: won ? '🏆 Cup winners!' : 'Cup Final lost', html: `<p>${a}–${b} in the Final${m.pens ? ` (${m.pens === 'W' ? 'won' : 'lost'} on penalties)` : ''}. Season: ${run.results.join(' · ')}</p>${won ? '<div style="font-size:72px;text-align:center">🏆</div>' : ''}`, buttons: [{ label: 'New season' }] })
      .then(() => shell.setPhase('early'));
    return;
  }
  const pool = Object.keys(UPGRADES).filter((u) => !run.up.has(u)).sort(() => Math.random() - 0.5).slice(0, 3);
  shell.modal({ title: r === 'W' ? 'Win!' : r === 'D' ? 'Draw' : 'Defeat', dismiss: false,
    html: `<p><b>${a}–${b}</b> vs ${M.name}. Pick one upgrade for your squad:</p>`,
    buttons: pool.map((u) => ({ label: `${UPGRADES[u].icon} ${UPGRADES[u].name}`, value: u, cls: 'paper' })) })
    .then((u) => {
      run.up.add(u);
      run.match++;
      shell.clearLog();
      shell.log(`Upgrade: ${UPGRADES[u].icon} ${UPGRADES[u].name} — ${UPGRADES[u].text}`, 'good', '');
      shell.log(`${MATCHES[run.match].sub} vs ${MATCHES[run.match].name}. Walls are thicker${MATCHES[run.match].hans ? ' and Iron Hans now guards the Box' : ''}.`, 'info', "0'");
      busy = false;
      startMatch({});
    });
  // Make the upgrade text readable inside the modal buttons' sheet.
  const sheet = shell.lastModal?.querySelector('.body');
  if (sheet) sheet.insertAdjacentHTML('beforeend', `<ul>${pool.map((u) => `<li><b>${UPGRADES[u].icon} ${UPGRADES[u].name}</b>: ${UPGRADES[u].text}</li>`).join('')}</ul>`);
}

// A drawn Final goes to sudden-death penalties (odds shown first). Each kick
// is shown: cut to the spot, shoot, result on the frame the ball arrives.
async function penalties() {
  setBusy(true);
  const pY = 4 / 6, pO = 0.6;
  const pWin = pY * (1 - pO) / (pY * (1 - pO) + pO * (1 - pY));
  await shell.modal({ title: 'Penalties!', dismiss: false,
    html: `<p>${m.score[0]}–${m.score[1]} after 90. Sudden death: Rio scores ${Math.round(pY * 100)}%, their takers ${Math.round(pO * 100)}% (Wak).</p><p>Your chance to lift the Cup: <span class="odds ${pWin >= 0.5 ? 'mid' : 'lo'}">${Math.round(pWin * 100)}%</span></p>`,
    buttons: [{ label: 'Take the penalties ▶' }] });
  view.mode = 'pens';
  renderAll();
  const takers = ['viper', 'kofi', 'zed'];
  let round = 0, res = null, ys = 0, os = 0;
  const kick = async (key, top, scored) => {
    const k = view.find(key);
    await view.cut(() => { view.mode = 'pens'; view.kicker = key; view.kickSpot = top ? [0.5, 0.22] : [0.5, 0.78]; view.give(k); });
    await view.wait(0.35);
    sfx.kick();
    const gk = view.keeper(top ? 'opp' : 'you');
    await view.shotAt(top, scored ? 'goal' : 'save', () => {
      if (top) ys += scored ? 1 : 0; else os += scored ? 1 : 0;
      setScore(`P ${ys}–${os}`);
      scored ? (top ? sfx.goal() : sfx.groan()) : sfx.save();
      view.label(scored ? 'SCORES!' : 'SAVED!', view.w / 2, view.pitch.toPx(0, top ? 0.12 : 0.88)[1], scored === top ? '#FFD23F' : '#FF8A80', 1.1, true);
      shell.log(`Pens round ${round}: ${byId[key].name} ${scored ? 'scores' : 'is saved'}.`, scored === top ? 'good' : 'bad', 'P');
    });
    await view.wait(0.5);
    view.recover(gk);
  };
  while (!res && round < 20) {
    round++;
    const y = Math.random() < pY, o = Math.random() < pO;
    await kick('rio', true, y);
    await kick(takers[(round - 1) % 3], false, o);
    if (y !== o) res = y ? 'W' : 'L';
  }
  m.pens = res || 'W';
  setBusy(false);
  fullTime();
}

// ================================================================ render
function renderAll(rolling = false) {
  if (!m) return;
  const M = MATCHES[run.match];
  const attack = m.mode !== 'defend';
  // status
  stage.querySelector('#clock').innerHTML = attack
    ? `<span class="kicker">⏱ Pressure</span> ${[0, 1, 2].map((i) => `<i class="pip ${i < m.clock ? 'on' : ''} ${m.clock === 1 ? 'hot' : ''}"></i>`).join('')} <span class="muted">Turn ${Math.min(m.turn, TURNS)}/${TURNS}</span>`
    : `<span class="kicker red">DEFEND</span> <span class="muted">Turn ${m.turn}/${TURNS}</span>`;
  stage.querySelector('#modebadge').innerHTML = m.mode === 'over' ? (m.pens || view.mode === 'pens' ? 'PENALTIES' : 'FULL TIME') : attack ? `ATTACKING · ${ZONES[m.zone]}` : `DEFENDING · ${byId[m.threat.key].name}`;
  // Badge sits in the corner away from the ball: bottom while the play is up the pitch.
  const low = m.mode === 'defend' || (attack && m.mode !== 'over' && m.zone >= 1);
  stage.querySelector('#modebadge').className = 'modebadge ' + (attack ? '' : 'def') + (low ? ' low' : '');
  // zone track or threat panel
  const zt = stage.querySelector('#ztrack');
  if (attack) {
    zt.innerHTML = ZONES.map((z, i) => {
      const hp = m.wall[i], mx = m.wallMax[i];
      const tamper = i === 2 ? '🕸' : i === 3 && M.hans ? '⛓' : '';
      return `<div class="zp ${i === m.zone ? 'on' : ''} ${i < m.zone ? 'done' : ''}" data-zone="${i}"><b><span>${z}${tamper ? ` <small title="${i === 2 ? 'Spider Lu steals your highest die here' : 'Iron Hans locks a die here'}">${tamper}</small>` : ''}</span><span class="n">${i < m.zone ? '✓' : `${hp}/${mx}`}</span></b>
        <span class="hp"><i style="width:${(hp / mx) * 100}%"></i></span></div>`;
    }).join('');
  } else {
    const T = m.threat;
    const p = theirGoalP(T.atk, T.keeper);
    zt.innerHTML = `<div class="threat"><img src="${portrait(byId[T.key], 40)}" alt="">
      <div class="grow"><b>${byId[T.key].name}</b> attack <span class="hp red"><i style="width:${(T.atk / T.start) * 100}%"></i></span> <b>${T.atk}</b>
      <div class="muted" style="font-size:11px">Shot ${theirPower(T.atk)}+d6 vs Wak ${T.keeper}${m.used['wak:save'] ? '' : ' (no die yet!)'}</div></div>
      <div class="center"><div style="font-size:10px;line-height:1.4;margin-bottom:1px">They score</div><span class="odds ${oddsClass(1 - p)}">${Math.round(p * 100)}%</span></div></div>`;
  }
  // info line
  const d = m.dice.find((x) => x.id === m.sel);
  const info = stage.querySelector('#info');
  const left = free().length;
  // Each message is one <span> so bold parts don't split into separate flex items.
  if (m.mode === 'over') info.innerHTML = view.mode === 'pens' ? 'Penalties: sudden death.' : 'Full time.';
  else if (!busy && !d && !left && !rolling) info.innerHTML = `<span>${m.mode === 'defend' ? 'No dice left. Press <b>Defend</b> to face the shot.' : 'No dice left. Press <b>End turn</b>.'}</span>`;
  else if (d) info.innerHTML = `<span>Die <b>${d.v}</b> selected — ${holdsAny(d) ? 'the wall <b>holds at 1</b> this turn (one line per turn).' : 'tap a glowing socket.'}</span>${has('lucky') && !m.luckyUsed ? ' <button class="btn small green" id="lucky">🍀 Reroll <span class="key">G</span></button>' : ''}`;
  else info.innerHTML = '<span>' + (attack
    ? (m.zone === 3 ? `In the Box! Rio's Shoot takes a 5–6. ${m.wall[3] > 0 ? 'Chip the box wall to weaken their keeper.' : 'Wall down — shoot!'}` : `Chip the ${ZONES[m.zone]} wall: ${m.wall[m.zone]} left. Tap a die.`)
    : `Tackle their attack to 0 to win it, and give Wak a die for the save.${left ? ` <b>${left} ${left > 1 ? 'dice' : 'die'} left</b>.` : ''}`) + '</span>';
  info.querySelector('#lucky')?.addEventListener('click', luckyReroll);
  // dice
  if (m.mode === 'over') stage.querySelector('#dice').innerHTML = '';
  else if (!rolling) {
    const avail = m.dice;
    stage.querySelector('#dice').innerHTML = avail.length ? avail.map((x, i) => dieHTML(x, { attr: `data-die="${x.id}" role="button" tabindex="0"`, key: i + 1 })).join('') : '<span class="muted" style="font-size:12px">No dice left.</span>';
    stage.querySelectorAll('#dice .die').forEach((el) => {
      el.onclick = () => { if (dragJust) return; selectDie(+el.dataset.die); };
      el.onpointerdown = (e) => startDrag(e, el);
    });
  } else stage.querySelector('#dice').innerHTML = '';
  const eb = stage.querySelector('#endbtn');
  eb.innerHTML = m.mode === 'over' ? 'Full time' : m.mode === 'defend' ? 'Defend ▶ <span class="key">↵</span>' : 'End turn <span class="key">↵</span>';
  eb.className = 'btn ' + (m.mode === 'defend' ? 'red' : free().length ? 'paper' : '');
  eb.disabled = m.mode === 'over';
  // cards
  const socks = sockets();
  stage.querySelector('#cards').innerHTML = SQUAD.map((p) => {
    const c = byId[p.id];
    const list = socks.filter((s) => s.p === p.id);
    return `<div class="pcard ${p.id === 'wak' ? 'gk' : ''}">
      <div class="phead"><img src="${portrait(c, 30)}" alt=""><b>${c.name}</b></div>
      <div class="socks">${list.map((s) => sockHTML(s, d, socks.indexOf(s))).join('')}</div></div>`;
  }).join('');
  stage.querySelectorAll('[data-sock]').forEach((el) => {
    el.onclick = () => { if (m.sel) place(el.dataset.sock); else { const A = AB[el.dataset.sock.split(':')[1]]; shell.toast(`<b>${A.name}</b> (${A.need}): ${A.text}`, 2600); } };
  });
}
function sockHTML(s, d, idx) {
  const A = AB[s.ab];
  const st = sockState(s, d);
  const used = m.used[s.key];
  const off = !sockState(s, null).ok;
  let badge = '';
  if (d && st.ok) { const pv = preview(s, d); badge = `<span class="pv ${pv.odds != null ? 'odds-' + (pv.odds >= 0.7 ? 'hi' : pv.odds >= 0.45 ? 'mid' : pv.odds >= 0.25 ? 'lo' : 'vlo') : ''}">${pv.tag}</span>`; }
  const why = off ? sockState(s, null).why : '';
  return `<div class="sock ${d ? (st.ok ? 'ok' : 'no') : ''} ${used ? 'used' : ''} ${off && !used ? 'off' : ''}" data-sock="${s.key}" title="${A.name} (${A.need}): ${A.text}">
    <div class="hole">${used ? dieHTML(null, { face: used.v, cls: 'in' }) : `<span class="need">${A.need}</span>`}${badge}<span class="kh">${SOCK_KEYS[idx]?.toUpperCase() || ''}</span></div>
    <div class="aname">${A.name}${why && !used ? `<small>${why}</small>` : A.kind === 'shot' && !used ? '<small>ends attack</small>' : ''}</div></div>`;
}
function popZone(z, text) {
  const el = stage.querySelector(`[data-zone="${z}"]`);
  if (!el) return;
  const r = el.getBoundingClientRect();
  shell.popup(text, r.left + r.width / 2, r.top, '#FFD23F');
  el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit');
}
function luckyReroll() {
  if (!has('lucky') || m.luckyUsed || !m.sel || busy) return;
  const d = m.dice.find((x) => x.id === m.sel);
  if (!d) return;
  m.luckyUsed = true;
  const old = d.v;
  d.v = 1 + Math.floor(Math.random() * 6);
  shell.log(`🍀 Lucky Boots: ${old} → ${d.v}.`, '', `${minute()}'`);
  sfx.deal();
  renderAll();
}

// ---------------------------------------------------------------- mouse drag (phones tap)
let drag = null, dragJust = false;
function startDrag(e, el) {
  if (e.pointerType !== 'mouse' || busy) return;
  const d = m.dice.find((x) => x.id === +el.dataset.die);
  if (!d || d.locked || d.stolen) return;
  drag = { el, id: d.id, x: e.clientX, y: e.clientY, ghost: null };
  window.addEventListener('pointermove', moveDrag);
  window.addEventListener('pointerup', endDrag, { once: true });
}
function moveDrag(e) {
  if (!drag) return;
  if (!drag.ghost && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8) {
    m.sel = drag.id; renderAll();
    const src = stage.querySelector(`[data-die="${drag.id}"]`);
    drag.ghost = src.cloneNode(true); drag.ghost.classList.add('dragghost');
    document.body.appendChild(drag.ghost);
  }
  if (drag.ghost) { drag.ghost.style.left = e.clientX + 'px'; drag.ghost.style.top = e.clientY + 'px'; }
}
function endDrag(e) {
  window.removeEventListener('pointermove', moveDrag);
  const d = drag; drag = null;
  if (!d?.ghost) return;
  d.ghost.remove();
  dragJust = true; setTimeout(() => { dragJust = false; }, 60);
  const t = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-sock]');
  if (t) place(t.dataset.sock, d.id);
}

// ---------------------------------------------------------------- keyboard
window.addEventListener('keydown', (e) => {
  if (!m || document.querySelector('.sheet-wrap') || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (/^[1-9]$/.test(k)) { const d = m.dice[+k - 1]; if (d) selectDie(d.id); }
  else if (SOCK_KEYS.includes(k)) { const s = sockets()[SOCK_KEYS.indexOf(k)]; if (s && m.sel) place(s.key); }
  else if (k === 'enter') { e.preventDefault(); endTurn(); }
  else if (k === 'g') luckyReroll();
  else if (k === 'escape' && m.sel) { m.sel = null; renderAll(); }
});
