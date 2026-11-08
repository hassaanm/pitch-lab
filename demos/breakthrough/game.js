// Breakthrough Puzzles: deterministic Into-the-Breach style attacking puzzles.
// Rules live in rules.js (shared with the node solver in solve.mjs).
import { Shell, oddsPill } from '../../shared/shell.js';
import { Pitch, drawPlayer, drawBall, drawArrow, drawOdds, setupCanvas, portrait, lerp, ease } from '../../shared/art.js';
import { byId } from '../../shared/cast.js';
import { sfx } from '../../shared/sfx.js';
import {
  W, H, GOAL_L, GOAL_R, ZONE, DEF_TYPES, cheb, initState, apply, moveTargets, passTargets, passProblem,
  shotLanes, previewDefenders, tacklersAfter, openScoringCells,
} from './rules.js';
import { PUZZLES, TIERS } from './puzzles.js';

const SAVE_KEY = 'pl-breakthrough-v1';
const SCORE = {
  early: { home: 0, away: 0, clock: "12'" },
  mid: { home: 1, away: 1, clock: "67'" },
  clutch: { home: 1, away: 2, clock: "90+4'" },
};

const shell = new Shell({
  id: 'breakthrough',
  title: 'Breakthrough',
  pitch: 'Attacking puzzles with no dice. Every defender shows his next step. Bait them, slip through, score.',
  how: [
    'Tap an attacker, then a blue square: each attacker moves up to 2 squares once per turn.',
    '<b>One pass per turn</b> for the whole team, in a straight or diagonal line nobody stands on. A receiver who has not moved can still run after the pass.',
    'Red arrows show where each defender steps when you end the turn. They chase where the ball <i>was</i> when the turn began. An attacker on their path stops them.',
    'Finish a turn with the ball next to a defender and you lose it. Run out of turns and you lose too.',
    'Shoot from a <b>gold square</b> with a clear lane. The keeper covers his column and one either side, so pull him over first.',
    'Keys: arrows/WASD cursor · Enter select/move · Tab cycle · F shoot · E end turn · U undo · R reset · N next.',
  ],
  notice: 'Is reading the arrows and planning two turns ahead satisfying, or does it feel like homework? Does "bait them by passing away" ever actually feel like football?',
  phases: [
    { id: 'early', label: 'Tutorial', sub: '6 puzzles · day' },
    { id: 'mid', label: 'Medium', sub: '6 puzzles · 1–1' },
    { id: 'clutch', label: 'Clutch', sub: '5 puzzles · 90+4\'' },
  ],
  onPhase: (id) => loadTier(id),
});

// ---------------------------------------------------------------- DOM
const root = document.createElement('div');
root.className = 'bt';
root.innerHTML = `
  <div class="bt-chips"></div>
  <div class="bt-title"><h3></h3><span class="chip turn"></span><span class="chip acts"></span></div>
  <div class="bt-hint"></div>
  <div class="bt-canvas"><canvas></canvas></div>
  <div class="bt-info"></div>
  <div class="bt-bar">
    <button class="btn paper small icon" data-a="undo" title="Undo (U)">↶</button>
    <button class="btn paper small icon" data-a="reset" title="Reset (R)">⟲</button>
    <button class="btn blue small" data-a="pass">Pass <span class="key">P</span></button>
    <button class="btn red small" data-a="shoot">Shoot <span class="key">F</span></button>
    <button class="btn small end" data-a="end">End turn <span class="key">E</span></button>
  </div>
  <div class="keys">arrows/WASD cursor · Enter select · Tab next player · F shoot · E end · U undo · R reset · N next puzzle</div>`;
shell.stage.appendChild(root);
const $ = (s) => root.querySelector(s);
const canvas = $('canvas');
const btn = Object.fromEntries([...root.querySelectorAll('[data-a]')].map((b) => [b.dataset.a, b]));
btn.undo.onclick = () => undo();
btn.reset.onclick = () => reset();
btn.shoot.onclick = () => shoot();
btn.pass.onclick = () => togglePass();
btn.end.onclick = () => endTurn();

// ---------------------------------------------------------------- state
let tier = 'early';
let puzzle = null;
let S = null;            // rules state
let history = [];        // previous states for undo
let actions = 0;
let sel = -1;            // selected attacker index
let cursor = { x: 2, y: 4 };
let busy = false;
let hintShown = false;
let infoOverride = '';
let passMode = false;
let progress = {};
try { progress = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}'); } catch {}

// visuals: per-unit float positions and poses
let vis = { att: [], def: [], ball: null, keeperDive: 0 };
let L = null; // layout
let pitch = null;
let ctx = null;
let hitstop = 0;

// ---------------------------------------------------------------- layout
function layout() {
  const stageW = Math.min(560, shell.stage.clientWidth || 360);
  const cw = Math.max(280, stageW - 6);
  const side = Math.max(12, Math.round(cw * 0.055));
  const cellW = (cw - side * 2) / W;
  const top = root.querySelector('.bt-canvas').getBoundingClientRect().top + scrollY;
  const avail = Math.max(330, innerHeight - top - 104);
  const cellH = Math.max(cellW * 0.74, Math.min(cellW, (avail - 54) / H));
  const pitchH = Math.round((cellH * H * 2) / 0.88);
  pitch = new Pitch(cw, pitchH, { variant: TIERS[tier].variant });
  pitch.goalW = cellW * (GOAL_R - GOAL_L + 1); // goal mouth matches the grid's goal columns
  const crop = pitch.y0 - 40;
  const ch = Math.round(40 + cellH * H + 14);
  ctx = setupCanvas(canvas, cw, ch);
  L = { cw, ch, cellW, cellH, crop, x0: pitch.x0, y0: pitch.y0, size: Math.min(cellW, cellH * 1.15) * 0.92 };
}
const cx = (x) => L.x0 + (x + 0.5) * L.cellW;
const cy = (y) => L.y0 + (y + 0.5) * L.cellH;
const feet = (y) => cy(y) + L.cellH * 0.3;

let rT;
addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => { layout(); }, 120); });

// ---------------------------------------------------------------- puzzles
function tierPuzzles(t = tier) { return PUZZLES.filter((p) => p.tier === t); }

function loadTier(t) {
  tier = t;
  const list = tierPuzzles();
  const next = list.find((p) => !progress[p.id]) || list[0];
  loadPuzzle(next.id);
}

function loadPuzzle(id) {
  puzzle = PUZZLES.find((p) => p.id === id);
  tier = puzzle.tier;
  hintShown = tier === 'early';
  layout();
  shell.setScore({ ...SCORE[tier] });
  reset(true);
  renderChips();
  shell.log(`<b>${puzzle.name}</b>: score within ${puzzle.turns} turn${puzzle.turns > 1 ? 's' : ''}. Par is ${puzzle.par} actions.`, 'info', 'KO');
}

function reset(silent) {
  if (busy) return;
  S = initState(puzzle);
  passMode = false;
  history = [];
  actions = 0;
  sel = S.ball;
  cursor = { x: S.att[S.ball].x, y: S.att[S.ball].y };
  snapVis();
  if (!silent) { sfx.whoosh(); shell.log('Puzzle reset.', 'info', 'T1'); }
  announceTurn();
  update();
}

function snapVis() {
  vis.att = S.att.map((a) => ({ x: a.x, y: a.y, pose: 'idle', facing: 1 }));
  vis.def = S.def.map((d) => ({ x: d.x, y: d.y, pose: d.type === 'keeper' ? 'ready' : 'idle', facing: -1 }));
  vis.ball = null;
  vis.keeperDive = 0;
}

function announceTurn() {
  const c = S.att[S.ball];
  const keeper = S.def.find((d) => d.type === 'keeper');
  let txt = `Turn ${S.turn}/${S.turns}. Defenders aim at ${who(c.id)}'s square.`;
  if (keeper) {
    const kp = previewDefenders(S)[S.def.indexOf(keeper)];
    txt += kp.to.x !== keeper.x ? ` Keeper will slide ${kp.to.x > keeper.x ? 'right' : 'left'}.` : ' Keeper holds his spot.';
  }
  if (S.def.some((d) => d.type === 'giant') && S.turn % 2 === 0) txt += ' The giant is resting.';
  shell.log(txt, 'info', 'T' + S.turn);
}

const who = (id) => byId[id]?.name || id;
const save = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(progress)); } catch {} };
const starsFor = (n) => (n <= puzzle.par ? 3 : n <= puzzle.par + 2 ? 2 : 1);

function renderChips() {
  const box = $('.bt-chips');
  box.innerHTML = '';
  tierPuzzles().forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'pz' + (p.id === puzzle.id ? ' on' : '');
    const st = progress[p.id] || 0;
    b.innerHTML = `<b>${i + 1}</b><i>${st ? '★'.repeat(st) + '☆'.repeat(3 - st) : ''}</i>`;
    b.title = p.name;
    b.onclick = () => { if (!busy) { sfx.click(); shell.clearLog(); loadPuzzle(p.id); } };
    box.appendChild(b);
  });
}

// ---------------------------------------------------------------- HUD
function update() {
  $('.bt-title h3').textContent = puzzle.name;
  $('.turn').textContent = S.status === 'play' ? `Turn ${S.turn}/${S.turns}` : S.status === 'won' ? 'Scored!' : 'Failed';
  $('.acts').textContent = `Actions ${actions} · par ${puzzle.par}`;
  const hint = $('.bt-hint');
  if (hintShown) hint.textContent = '💡 ' + puzzle.hint;
  else { hint.innerHTML = '<button>💡 Show hint</button>'; hint.querySelector('button').onclick = () => { hintShown = true; update(); }; }

  const lanes = S.status === 'play' ? shotLanes(S) : { lanes: [] };
  btn.shoot.disabled = !lanes.lanes.length || busy;
  btn.shoot.innerHTML = lanes.lanes.length ? `Shoot ${oddsPill(1)} <span class="key">F</span>` : 'Shoot <span class="key">F</span>';
  btn.undo.disabled = !history.length || busy;
  const pts = S.status === 'play' ? passTargets(S) : [];
  if (!pts.length) passMode = false;
  btn.pass.disabled = !pts.length || busy;
  btn.pass.classList.toggle('pressed', passMode);
  btn.pass.innerHTML = passMode ? 'Pick ⚽' : 'Pass <span class="key">P</span>';
  btn.end.disabled = S.status !== 'play' || busy;
  if (S.status === 'play') {
    const t = tacklersAfter(S);
    btn.end.innerHTML = `End turn ${t.length ? oddsPill(0, 'Keep') : oddsPill(1, 'Keep')} <span class="key">E</span>`;
  } else btn.end.innerHTML = 'End turn';

  const info = $('.bt-info');
  if (infoOverride) { info.innerHTML = infoOverride; return; }
  if (passMode) { info.innerHTML = `<span><b>Pass:</b> tap a teammate marked ⚽. Tap anywhere else to cancel.${S.passUsed ? '' : ' This uses the team\'s one pass this turn.'}</span>`; return; }
  if (S.status !== 'play') { info.innerHTML = S.status === 'won' ? '<span>⚽ Goal! Pick another puzzle or reset to chase par.</span>' : '<span>Ball lost. Undo (U) or reset (R).</span>'; return; }
  if (sel >= 0) {
    const a = S.att[sel], c = byId[a.id];
    const isCarrier = sel === S.ball;
    let tip = a.moved ? 'Already moved this turn.' : 'Tap a blue square to move (2 max).';
    if (isCarrier) {
      const pt = passTargets(S);
      if (pt.length) tip += ' Press Pass to pick a receiver.';
      else if (S.passUsed) tip += ' Pass used this turn.';
      if (lanes.lanes.length) tip = '<b>Clear shot!</b> Press Shoot. ' + tip;
      else if (lanes.inZone && lanes.blocked.length) tip = (lanes.blocked[0].why === 'keeper' ? 'Keeper covers that angle. ' : 'Lane blocked. ') + tip;
    }
    info.innerHTML = `<img src="${portrait(c, 60)}" alt=""><span><b>${c.name}</b>${isCarrier ? ' · ⚽' : ''} — ${tip}</span>`;
  } else info.innerHTML = '<span>Tap an attacker (yellow). Tap a red defender to see how he moves.</span>';
}

// ---------------------------------------------------------------- actions
function commit(action) {
  passMode = false;
  const r = apply(S, action);
  if (!r) return null;
  history.push({ S, actions, sel });
  if (action.t !== 'end') actions++;
  S = r.state;
  return r;
}

async function moveTo(i, x, y) {
  const from = { x: S.att[i].x, y: S.att[i].y };
  const r = commit({ t: 'move', i, x, y });
  if (!r) return;
  busy = true; update();
  const v = vis.att[i];
  v.facing = x >= from.x ? 1 : -1;
  v.pose = 'run';
  const d = cheb(from, { x, y });
  await tween(110 + d * 110, (k) => { const e = ease(k); v.x = lerp(from.x, x, e); v.y = lerp(from.y, y, e); });
  v.pose = 'idle';
  sfx.tick();
  shell.log(`${who(S.att[i].id)} runs ${d} square${d > 1 ? 's' : ''}.`, '', 'T' + S.turn);
  busy = false;
  if (i === S.ball && shotLanes(S).lanes.length) shell.toast('Clear shot! Press <b>Shoot</b> (F).', 1400);
  update();
}

async function pass(j) {
  const i = S.ball;
  const r = commit({ t: 'pass', j });
  if (!r) return;
  busy = true; update();
  const a = vis.att[i], b = vis.att[j];
  a.pose = 'pass'; a.facing = b.x >= a.x ? 1 : -1;
  sfx.pass();
  const from = { x: a.x, y: a.y }, to = { x: b.x, y: b.y };
  const dist = cheb(from, to);
  vis.ball = { x: from.x, y: from.y, h: 0, spin: 0 };
  await tween(220 + dist * 70, (k) => {
    vis.ball.x = lerp(from.x, to.x, k); vis.ball.y = lerp(from.y, to.y, k);
    vis.ball.h = Math.sin(Math.PI * k) * (6 + dist * 5); vis.ball.spin = k * 12;
  });
  vis.ball = null;
  a.pose = 'idle';
  sfx.thud();
  shell.log(`${who(S.att[i].id)} passes to ${who(S.att[j].id)}. That is the team's pass for this turn.`, 'good', 'T' + S.turn);
  sel = j;
  busy = false; update();
}

async function shoot() {
  if (busy || S.status !== 'play') return;
  const lanes = shotLanes(S).lanes;
  if (!lanes.length) {
    const sl = shotLanes(S);
    shell.toast(!sl.inZone ? 'Get into the shaded scoring zone first (top 3 rows).' : sl.blocked.some((b) => b.why === 'keeper') ? 'The keeper covers every lane from there.' : 'No clear lane from there.');
    sfx.bad();
    return;
  }
  const i = S.ball;
  const lane = lanes[0];
  const r = commit({ t: 'shoot' });
  if (!r) return;
  busy = true; update();
  const a = vis.att[i];
  a.pose = 'kick'; a.facing = lane.dx >= 0 ? 1 : -1;
  sfx.kick();
  const from = { x: a.x, y: a.y }, to = { x: lane.goal.x, y: -0.9 };
  vis.ball = { x: from.x, y: from.y, h: 0, spin: 0 };
  const ki = S.def.findIndex((d) => d.type === 'keeper');
  const kv = ki >= 0 ? vis.def[ki] : null;
  const kx0 = kv?.x;
  // the keeper dives the wrong way
  const diveDir = kv ? (kv.x >= lane.cross.x ? 1 : -1) : 0;
  await tween(380, (k) => {
    vis.ball.x = lerp(from.x, to.x, k); vis.ball.y = lerp(from.y, to.y, k);
    vis.ball.h = Math.sin(Math.PI * k) * 10; vis.ball.spin = k * 20;
    if (kv && k > 0.25) { kv.pose = 'dive'; kv.facing = diveDir; kv.x = kx0 + diveDir * 0.6 * ease(Math.min(1, (k - 0.25) / 0.6)); }
  });
  vis.ball.h = 0;
  pitch.goal(true);
  sfx.goal();
  shell.banner('GOAL!', who(S.att[i].id));
  shell.confetti();
  shell.shake();
  vis.att.forEach((v) => { v.pose = 'celebrate'; });
  if (kv) kv.pose = 'sad';
  const stars = starsFor(actions);
  const best = Math.max(stars, progress[puzzle.id] || 0);
  progress[puzzle.id] = best; save();
  if (tier === 'clutch') shell.setScore({ ...SCORE[tier], home: SCORE[tier].home + 1 });
  shell.log(`GOAL! ${who(S.att[i].id)} shoots through the open lane. ${actions} actions (par ${puzzle.par}) · ${'★'.repeat(stars)}`, 'goal', 'T' + S.turn);
  renderChips();
  busy = false; update();
  await wait(1300);
  const list = tierPuzzles();
  const idx = list.findIndex((p) => p.id === puzzle.id);
  const next = list[idx + 1] || PUZZLES[PUZZLES.findIndex((p) => p.id === puzzle.id) + 1];
  const starHtml = `<div class="stars">${[1, 2, 3].map((n) => `<span class="${n <= stars ? '' : 'off'}">★</span>`).join('')}</div>`;
  const msg = actions <= puzzle.par ? 'Par or better. Clinical.' : `Par is ${puzzle.par}. Can you do it in fewer actions?`;
  sfx.win();
  const v = await shell.modal({
    title: puzzle.name + ' — solved',
    html: `${starHtml}<p class="center">${actions} actions · ${msg}</p>`,
    buttons: [next ? { label: 'Next puzzle ▶', value: 'next' } : { label: 'Done', value: 'done' }, { label: 'Retry for ★★★', value: 'retry', cls: 'paper' }],
  });
  if (v === 'next' && next) { shell.clearLog(); if (next.tier !== tier) shell.setPhase(next.tier); else loadPuzzle(next.id); }
  else if (v === 'retry') reset();
}

async function endTurn() {
  if (busy || S.status !== 'play') return;
  const before = S;
  const r = commit({ t: 'end' });
  if (!r) return;
  busy = true; sel = -1; update();
  // animate every defender along the cells he actually walks
  const moves = r.info.moves;
  const maxSteps = Math.max(0, ...moves.map((m) => m.walked.length));
  for (let step = 0; step < maxSteps; step++) {
    const starts = moves.map((m, i) => ({ x: vis.def[i].x, y: vis.def[i].y }));
    moves.forEach((m, i) => { if (m.walked[step]) { vis.def[i].pose = before.def[i].type === 'keeper' ? 'ready' : 'run'; vis.def[i].facing = m.walked[step].x >= starts[i].x ? 1 : -1; } });
    await tween(260, (k) => {
      const e = ease(k);
      moves.forEach((m, i) => { const c = m.walked[step]; if (c) { vis.def[i].x = lerp(starts[i].x, c.x, e); vis.def[i].y = lerp(starts[i].y, c.y, e); } });
    });
    sfx.tick();
  }
  vis.def.forEach((v, i) => { v.pose = before.def[i].type === 'keeper' ? 'ready' : 'idle'; v.x = S.def[i].x; v.y = S.def[i].y; });
  moves.forEach((m, i) => {
    if (m.blockedAt) {
      const blocker = before.att.find((a) => a.x === m.blockedAt.x && a.y === m.blockedAt.y);
      shell.log(`${who(before.def[i].id)} is blocked${blocker ? ' by ' + who(blocker.id) : ''} and stops short.`, 'good', 'T' + before.turn);
    }
  });

  if (S.status === 'lost' && S.reason === 'tackled') {
    const ti = r.info.tacklers[0];
    const tv = vis.def[ti], cv = vis.att[S.ball];
    const t0 = { x: tv.x, y: tv.y };
    tv.pose = 'slide'; tv.facing = cv.x >= tv.x ? 1 : -1;
    sfx.whoosh();
    await tween(200, (k) => { tv.x = lerp(t0.x, (t0.x + cv.x) / 2, k); tv.y = lerp(t0.y, (t0.y + cv.y) / 2, k); });
    hitstop = 0.16; sfx.thud(); shell.shake(); shell.flash('#ff6b5a');
    cv.pose = 'sad';
    await wait(260);
    shell.banner('TACKLED', `${who(before.def[ti].id)} wins it`, '#ff8a7a');
    sfx.lose();
    shell.log(`Ball lost: ${who(before.att[before.ball].id)} finished the turn next to ${who(before.def[ti].id)} (${DEF_TYPES[before.def[ti].type].name}).`, 'bad', 'T' + before.turn);
    busy = false; update();
    await wait(900);
    failModal('Tackled', `${who(before.att[before.ball].id)} ended the turn next to a defender. Undo the turn and look at the red squares.`);
    return;
  }
  if (S.status === 'lost' && S.reason === 'time') {
    sfx.whistle(3);
    shell.banner('FULL TIME', 'out of turns', '#fff');
    shell.log('Out of turns. The chance is gone.', 'bad', 'T' + before.turn);
    busy = false; update();
    await wait(900);
    failModal('Out of turns', `You get ${puzzle.turns} turn${puzzle.turns > 1 ? 's' : ''} to score. Plan the bait on turn 1.`);
    return;
  }
  sfx.whistle();
  sel = S.ball;
  busy = false;
  announceTurn();
  update();
}

function togglePass() {
  if (busy || S.status !== 'play') return;
  if (!passTargets(S).length) { shell.toast(S.passUsed ? 'One pass per turn, already used.' : 'No open passing line. Lines must be straight or diagonal with nobody on them.'); sfx.bad(); return; }
  passMode = !passMode;
  infoOverride = '';
  if (passMode) { sel = S.ball; const t = S.att[passTargets(S)[0]]; cursor = { x: t.x, y: t.y }; }
  sfx.click(); update();
}

async function failModal(title, text) {
  const v = await shell.modal({ title, html: `<p>${text}</p>`, buttons: [{ label: 'Undo turn', value: 'undo' }, { label: 'Reset', value: 'reset', cls: 'paper' }] });
  if (v === 'undo') undo(); else if (v === 'reset') reset();
}

function undo() {
  if (busy || !history.length) return;
  passMode = false;
  const h = history.pop();
  S = h.S; actions = h.actions; sel = h.sel;
  snapVis();
  sfx.whoosh();
  shell.log('Undo.', 'info', 'T' + S.turn);
  update();
}

// ---------------------------------------------------------------- input
function attAt(x, y) { return S.att.findIndex((a) => a.x === x && a.y === y); }
function defAt(x, y) { return S.def.findIndex((d) => d.x === x && d.y === y); }

function tapCell(x, y) {
  if (busy) return;
  infoOverride = '';
  if (S.status !== 'play') { update(); return; }
  cursor = { x, y };
  const ai = attAt(x, y);
  if (passMode) {
    passMode = false;
    if (ai >= 0 && ai !== S.ball && passTargets(S).includes(ai)) { pass(ai); return; }
    if (ai >= 0 && ai !== S.ball) shell.toast(passProblem(S, ai), 1600);
    sfx.click(); update();
    return;
  }
  if (ai >= 0) {
    sel = sel === ai ? -1 : ai;
    sfx.click();
    update();
    return;
  }
  const di = defAt(x, y);
  if (di >= 0) {
    const d = S.def[di], t = DEF_TYPES[d.type];
    let extra = '';
    if (d.type === 'marker') extra = ` He marks <b>${who(S.att[d.mark].id)}</b>.`;
    if (d.type === 'giant') extra = S.turn % 2 === 0 ? ' <b>Resting this turn.</b>' : '';
    infoOverride = `<img src="${portrait(byId[d.id], 60)}" alt=""><span><b>${who(d.id)}</b> · ${t.name} — ${t.tip}${extra}</span>`;
    sfx.hover();
    update();
    return;
  }
  if (sel >= 0 && moveTargets(S, sel).some((c) => c.x === x && c.y === y)) { moveTo(sel, x, y); return; }
  sel = -1;
  update();
}

canvas.addEventListener('pointerdown', (e) => {
  const r = canvas.getBoundingClientRect();
  const px = e.clientX - r.left, py = e.clientY - r.top + L.crop;
  if (py < L.y0) { if (shotLanes(S).lanes.length) shoot(); return; }
  const x = Math.floor((px - L.x0) / L.cellW), y = Math.floor((py - L.y0) / L.cellH);
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  showCursor = false;
  tapCell(x, y);
});

let showCursor = false;
addEventListener('keydown', (e) => {
  if (e.defaultPrevented || document.querySelector('.sheet-wrap')) return;
  const k = e.key.toLowerCase();
  const dirs = { arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1], arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0] };
  if (dirs[k]) {
    e.preventDefault(); showCursor = true;
    cursor = { x: Math.max(0, Math.min(W - 1, cursor.x + dirs[k][0])), y: Math.max(0, Math.min(H - 1, cursor.y + dirs[k][1])) };
    sfx.tick();
    return;
  }
  if (k === 'enter' || k === ' ') { e.preventDefault(); showCursor = true; tapCell(cursor.x, cursor.y); }
  else if (k === 'tab') {
    e.preventDefault(); showCursor = true;
    if (busy || S.status !== 'play') return;
    if (passMode) {
      const pt = passTargets(S);
      const cur = pt.findIndex((j) => S.att[j].x === cursor.x && S.att[j].y === cursor.y);
      const j = pt[(cur + 1) % pt.length];
      cursor = { x: S.att[j].x, y: S.att[j].y }; sfx.tick(); return;
    }
    const order = S.att.map((_, i) => i);
    sel = order[(Math.max(-1, sel) + (e.shiftKey ? order.length - 1 : 1)) % order.length];
    cursor = { x: S.att[sel].x, y: S.att[sel].y };
    infoOverride = ''; sfx.click(); update();
  } else if (k === 'p') togglePass();
  else if (k === 'f') shoot();
  else if (k === 'e') endTurn();
  else if (k === 'u' || k === 'z') undo();
  else if (k === 'r') reset();
  else if (k === 'n') {
    const i = PUZZLES.findIndex((p) => p.id === puzzle.id);
    const n = PUZZLES[(i + 1) % PUZZLES.length];
    shell.clearLog();
    if (n.tier !== tier) shell.setPhase(n.tier); else loadPuzzle(n.id);
  } else if (k === 'escape') { sel = -1; passMode = false; infoOverride = ''; update(); }
});

// test hook (used by automated play-throughs; harmless in production)
window.__bt = { pass: () => togglePass(), tap: (x, y) => tapCell(x, y), shoot: () => shoot(), end: () => endTurn(), undo: () => undo(), state: () => S, busy: () => busy, sel: () => sel, load: (id) => loadPuzzle(id), progress: () => progress };

// ---------------------------------------------------------------- tweens
const tweens = [];
function tween(ms, fn) { return new Promise((res) => tweens.push({ t: 0, ms, fn, res })); }
function wait(ms) { return tween(ms, () => {}); }

// ---------------------------------------------------------------- render
let last = performance.now();
let lastRaf = last;
function advance(now) {
  const dt = Math.min(0.05, Math.max(0, now - last) / 1000);
  last = now;
  if (hitstop > 0) { hitstop -= dt; return dt; }
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    tw.t += dt * 1000;
    const k = Math.min(1, tw.t / tw.ms);
    tw.fn(k);
    if (k >= 1) { tweens.splice(i, 1); tw.res(); }
  }
  return dt;
}
function frame(now) {
  lastRaf = now;
  const dt = advance(now);
  if (S && L) draw(now / 1000, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// If frames stop (background tab), keep animations and turns moving.
setInterval(() => { const now = performance.now(); if (now - lastRaf > 200) advance(now); }, 50);

function cellRect(x, y, fill, stroke) {
  const px = L.x0 + x * L.cellW, py = L.y0 + y * L.cellH;
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(px + 1.5, py + 1.5, L.cellW - 3, L.cellH - 3); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.strokeRect(px + 2.5, py + 2.5, L.cellW - 5, L.cellH - 5); }
}

function draw(t, dt) {
  ctx.clearRect(0, 0, L.cw, L.ch);
  ctx.save();
  ctx.translate(0, -L.crop);
  pitch.draw(ctx, t, dt);
  const playing = S.status === 'play' && !busy;

  // grid
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    cellRect(x, y, (x + y) % 2 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.04)');
  }
  ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 1;
  for (let x = 0; x <= W; x++) { ctx.beginPath(); ctx.moveTo(L.x0 + x * L.cellW, L.y0); ctx.lineTo(L.x0 + x * L.cellW, L.y0 + H * L.cellH); ctx.stroke(); }
  for (let y = 0; y <= H; y++) { ctx.beginPath(); ctx.moveTo(L.x0, L.y0 + y * L.cellH); ctx.lineTo(L.x0 + W * L.cellW, L.y0 + y * L.cellH); ctx.stroke(); }
  // scoring zone outline
  ctx.save(); ctx.setLineDash([6, 5]); ctx.strokeStyle = 'rgba(255,210,63,.7)'; ctx.lineWidth = 2;
  ctx.strokeRect(L.x0 + 1, L.y0 + 1, W * L.cellW - 2, ZONE * L.cellH - 2); ctx.restore();

  const prev = previewDefenders(S);
  if (S.status === 'play') {
    // keeper reach on the goal mouth
    const keeper = S.def.find((d) => d.type === 'keeper');
    for (let gx = GOAL_L; gx <= GOAL_R; gx++) {
      const covered = keeper && Math.abs(gx - keeper.x) <= 1;
      ctx.fillStyle = covered ? 'rgba(232,70,58,.62)' : 'rgba(120,235,110,.75)';
      ctx.fillRect(L.x0 + gx * L.cellW + 2, L.y0 - pitch.netDepth, L.cellW - 4, pitch.netDepth - 1);
      if (!covered) { ctx.save(); ctx.font = '700 10px "Lilita One", system-ui'; ctx.fillStyle = '#123'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('OPEN', cx(gx), L.y0 - pitch.netDepth / 2); ctx.restore(); }
    }
    // red: squares next to where defenders will finish
    const threat = new Set();
    prev.forEach((p) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = p.to.x + dx, y = p.to.y + dy; if (x >= 0 && x < W && y >= 0 && y < H) threat.add(x + ',' + y); } });
    for (const k of threat) { const [x, y] = k.split(',').map(Number); if (!prev.some((p) => p.to.x === x && p.to.y === y)) cellRect(x, y, 'rgba(232,70,58,.30)'); }
    // gold: squares that beat the keeper where he stands now
    for (const c of openScoringCells(S)) { cellRect(c.x, c.y, 'rgba(255,210,63,.30)'); goldMark(c.x, c.y); }
    // selection: reachable squares, pass lines
    if (playing && sel >= 0) {
      const a = S.att[sel];
      for (const c of (passMode ? [] : moveTargets(S, sel))) {
        const danger = threat.has(c.x + ',' + c.y) && sel === S.ball;
        cellRect(c.x, c.y, danger ? 'rgba(120,200,255,.18)' : 'rgba(120,210,255,.45)', danger ? 'rgba(255,140,130,.9)' : 'rgba(255,255,255,.9)');
      }
      cellRect(a.x, a.y, null, '#FFD23F');
      if (sel === S.ball) {
        for (const j of passTargets(S)) {
          const b = S.att[j];
          drawArrow(ctx, cx(a.x), cy(a.y), cx(b.x), cy(b.y), passMode ? '#fff' : 'rgba(255,255,255,.4)', { dash: [4, 5], width: passMode ? 3 : 2, head: 6 });
        }
      }
    }
    // shot lanes from the carrier
    const sl = shotLanes(S);
    const c = S.att[S.ball];
    if (playing) {
      for (const l of sl.lanes) drawArrow(ctx, cx(c.x), cy(c.y), cx(l.goal.x), L.y0 - pitch.netDepth * 0.5, '#FFD23F', { width: 3.5, head: 9 });
    }
    // telegraphs
    prev.forEach((p, i) => {
      const d = S.def[i];
      let px = cx(p.from.x), py = cy(p.from.y);
      const pts = p.walked.length ? p.walked : [];
      pts.forEach((s, k) => {
        const nx = cx(s.x), ny = cy(s.y);
        const last = k === pts.length - 1;
        drawArrow(ctx, px, py, nx, ny, '#ff5a4a', { width: 3, dash: last ? null : [5, 4], head: last ? 8 : 0 });
        px = nx; py = ny;
      });
      if (p.blockedAt) {
        const bx = cx(p.blockedAt.x), by = cy(p.blockedAt.y) - L.cellH * 0.38;
        ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath();
        ctx.moveTo(bx - 5, by - 5); ctx.lineTo(bx + 5, by + 5); ctx.moveTo(bx + 5, by - 5); ctx.lineTo(bx - 5, by + 5); ctx.stroke(); ctx.restore();
      }
      if (p.walked.length && !busy) drawPlayer(ctx, byId[d.id], cx(p.to.x), feet(p.to.y), { size: L.size * 0.9, alpha: 0.32, t, facing: -1, shadow: false });
    });
  }

  // sprites, back to front
  const sprites = [];
  S.att.forEach((a, i) => sprites.push({ c: byId[a.id], v: vis.att[i], att: true, i }));
  S.def.forEach((d, i) => sprites.push({ c: byId[d.id], v: vis.def[i], att: false, i, d }));
  sprites.sort((a, b) => a.v.y - b.v.y);
  for (const sp of sprites) {
    const x = cx(sp.v.x), y = feet(sp.v.y);
    const glow = sp.att && sp.i === sel && S.status === 'play' ? '#FFD23F' : null;
    drawPlayer(ctx, sp.c, x, y, { size: L.size, pose: sp.v.pose, t, facing: sp.v.facing, glow });
    if (sp.att && sp.i === S.ball && !vis.ball && S.status !== 'won') drawBall(ctx, x + L.size * 0.2, y - 2, Math.max(4, L.size * 0.11), t * 2);
    if (!sp.att && sp.d.type === 'giant' && S.turn % 2 === 0 && S.status === 'play') {
      ctx.save(); ctx.font = '700 13px "Lilita One", system-ui'; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1b1b2f'; ctx.lineWidth = 3;
      const zz = 'z' + (Math.sin(t * 3) > 0 ? 'Z' : 'z');
      ctx.strokeText(zz, x + L.size * 0.25, y - L.size * 0.95); ctx.fillText(zz, x + L.size * 0.25, y - L.size * 0.95); ctx.restore();
    }
  }
  if (vis.ball) drawBall(ctx, cx(vis.ball.x), cy(vis.ball.y) + L.cellH * 0.25, Math.max(4, L.size * 0.11), vis.ball.spin, vis.ball.h);
  pitch.drawFront(ctx, t);

  // overlays above the lighting
  if (S.status === 'play' && !busy) {
    // defender type tags
    S.def.forEach((d, i) => {
      if (d.type === 'def') return;
      const tag = { fast: '»2', marker: '◎', sweeper: '↔', giant: 'G', keeper: 'GK' }[d.type];
      tagAt(cx(vis.def[i].x) - L.size * 0.32, feet(vis.def[i].y) - L.size * 0.86, tag, '#E8463A');
    });
    // marker lines
    S.def.forEach((d) => { if (d.type === 'marker') { const a = S.att[d.mark]; ctx.save(); ctx.setLineDash([2, 4]); ctx.strokeStyle = 'rgba(255,120,110,.8)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx(d.x), cy(d.y)); ctx.lineTo(cx(a.x), cy(a.y)); ctx.stroke(); ctx.restore(); } });
    // pass badges
    if (passMode) for (const j of passTargets(S)) { const b = S.att[j]; tagAt(cx(b.x) + L.size * 0.32, feet(b.y) - L.size * 0.9, '⚽', '#fff', '#1b1b2f'); }
    // carrier safety if you ended the turn now
    const c = S.att[S.ball];
    const safe = !tacklersAfter(S, prev).length;
    drawOdds(ctx, cx(c.x), feet(c.y) + 8, safe ? 1 : 0, 'Keep');
    // shot odds
    const sl = shotLanes(S);
    if (sl.lanes.length) drawOdds(ctx, cx(sl.lanes[0].goal.x), L.y0 - pitch.netDepth - 12, 1, 'Goal');
  }
  if (showCursor) {
    const px = L.x0 + cursor.x * L.cellW, py = L.y0 + cursor.y * L.cellH, s = 9;
    ctx.save(); ctx.strokeStyle = '#FFD23F'; ctx.lineWidth = 3;
    for (const [ax, ay, dx, dy] of [[px, py, 1, 1], [px + L.cellW, py, -1, 1], [px, py + L.cellH, 1, -1], [px + L.cellW, py + L.cellH, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(ax + dx * 2, ay + dy * (s + 2)); ctx.lineTo(ax + dx * 2, ay + dy * 2); ctx.lineTo(ax + dx * (s + 2), ay + dy * 2); ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

function goldMark(x, y) {
  const px = L.x0 + (x + 1) * L.cellW - 8, py = L.y0 + y * L.cellH + 8;
  ctx.save(); ctx.fillStyle = '#FFD23F'; ctx.strokeStyle = '#1b1b2f'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
}

function tagAt(x, y, text, bg, fg = '#fff') {
  ctx.save();
  ctx.font = '700 10px "Lilita One", system-ui';
  const w = Math.max(16, ctx.measureText(text).width + 8);
  ctx.fillStyle = bg; ctx.strokeStyle = '#1b1b2f'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - w / 2, y - 8, w, 15, 7) : ctx.rect(x - w / 2, y - 8, w, 15); ctx.fill(); ctx.stroke();
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y);
  ctx.restore();
}
