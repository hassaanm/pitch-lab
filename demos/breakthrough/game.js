// Breakthrough Puzzles: deterministic Into-the-Breach style attacking puzzles.
// Rules live in rules.js (shared with the node solver in solve.mjs).
//
// Animation rule for this file: the rules state S only changes AFTER the
// motion that causes the change has played. Each action computes its result
// with apply(), animates the sprites in `vis`, and commits at the end. The
// ball is always either at a holder's feet (vis.holder) or in flight (vis.ball,
// in canvas pixels), so it never jumps between players.
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
const DEV = new URLSearchParams(location.search).has('jank');

const shell = new Shell({
  id: 'breakthrough',
  title: 'Breakthrough',
  pitch: 'Attacking puzzles with no dice. Every defender shows his next step. Bait them, slip through, score.',
  how: [
    'The ball carrier starts selected (yellow ring). Tap a blue square to move him, or tap another attacker first. Each attacker moves up to 2 squares once per turn.',
    '<b>One pass per turn</b> for the whole team, in a straight or diagonal line nobody stands on. A receiver who has not moved can still run after the pass.',
    'Red arrows show where each defender steps when you end the turn. They chase the square inside the <b>red ring</b>: where the ball was when the turn began. Pass or run away from it and they still go there. An attacker standing on an arrow stops that defender.',
    'Finish a turn with the ball next to a defender and he tackles you. Run out of turns and you lose too.',
    'Shoot from a <b>gold square</b> with a clear lane. The keeper covers his column and one either side, so pull him over first.',
    'Undo (↶) takes back one action. Fewer actions = more stars.',
    ...(matchMedia('(pointer: coarse)').matches ? [] : ['Keys: arrows/WASD cursor · Enter select/move · Tab cycle · P pass · F shoot · E end turn · U undo · R reset · N next.']),
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
let S = null;            // rules state (committed after each animation)
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

// visuals: per-unit float grid positions and poses; the ball lives at a
// holder's feet or in flight (pixels).
const vis = { att: [], def: [], holder: null, ball: null, inNet: false };
let sceneA = 1;          // sprite alpha, used to cover real cuts (new puzzle, ball back from the net)
let ovA = 1;             // planning-overlay alpha (arrows, red/gold squares)
let hideOv = false;      // true while defenders walk, a shot flies, or the scene changes
let L = null; // layout
let pitch = null;
let ctx = null;
let hitstop = 0;
let lastW = 0;

// ---------------------------------------------------------------- layout
// Sized once from the width; height changes (phone address bar) never resize mid-play.
function layout() {
  const stageW = Math.min(560, shell.stage.clientWidth || 360);
  lastW = stageW;
  const cw = Math.max(280, stageW - 6);
  const side = Math.max(12, Math.round(cw * 0.055));
  const cellW = (cw - side * 2) / W;
  const top = root.querySelector('.bt-canvas').getBoundingClientRect().top + scrollY;
  // room left for the pitch once the info row and the sticky action bar (plus gaps) are reserved
  const below = $('.bt-info').offsetHeight + $('.bt-bar').offsetHeight + 12 + 6;
  const viewH = Math.min(innerHeight, window.visualViewport?.height || innerHeight);
  const avail = Math.max(330, viewH - top - below);
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
// inverse of cx / feet, for sending a sprite's feet to a pixel point
const gridX = (px) => (px - L.x0) / L.cellW - 0.5;
const gridYFromFeet = (py) => (py - L.y0) / L.cellH - 0.8;
// where a held ball sits: always at the holder's right boot
const ballPx = (v) => ({ x: cx(v.x) + L.size * 0.2, y: feet(v.y) - 2 });
const ballR = () => Math.max(4, L.size * 0.11);
const holderVis = (h) => (h ? (h.side === 'att' ? vis.att[h.i] : vis.def[h.i]) : null);
const ballNow = () => (vis.holder ? ballPx(holderVis(vis.holder)) : { x: vis.ball.x, y: vis.ball.y });

// The web font changes the height of the rows above the pitch. Re-measure once it
// has loaded, but only before the first action, so the pitch never resizes in play.
document.fonts?.ready.then(() => { if (L && !busy && !history.length && actions === 0) { const h = L.ch; layout(); if (L.ch !== h) snapVis(); } });

let rT;
addEventListener('resize', () => {
  clearTimeout(rT);
  rT = setTimeout(() => { if (Math.min(560, shell.stage.clientWidth || 360) !== lastW && !busy) layout(); }, 150);
});

// ---------------------------------------------------------------- tweens
const tweens = [];
function tween(ms, fn) { return new Promise((res) => tweens.push({ t: 0, ms, fn, res })); }
function wait(ms) { return tween(ms, () => {}); }
async function idle() { while (busy) await wait(40); }

// ---------------------------------------------------------------- puzzles
function tierPuzzles(t = tier) { return PUZZLES.filter((p) => p.tier === t); }

function loadTier(t) {
  const list = tierPuzzles(t);
  const next = list.find((p) => !progress[p.id]) || list[0];
  loadPuzzle(next.id);
}

// A new puzzle is a real cut: fade the players out, swap, fade in.
async function loadPuzzle(id) {
  await idle();
  const p = PUZZLES.find((q) => q.id === id);
  const swap = () => {
    puzzle = p;
    const tierChanged = tier !== p.tier;
    tier = p.tier;
    hintShown = tier === 'early';
    shell.setScore({ ...SCORE[tier] });
    S = initState(puzzle);
    history = []; actions = 0; sel = S.ball; passMode = false; infoOverride = '';
    cursor = { x: S.att[S.ball].x, y: S.att[S.ball].y };
    renderChips();
    update(); // fill the text rows first so layout() measures the real pitch top
    if (!pitch) layout(); else if (tierChanged) pitch.setVariant(TIERS[tier].variant);
    snapVis();
  };
  if (!S) swap();
  else await coverCut(swap);
  shell.log(`<b>${puzzle.name}</b>: score within ${puzzle.turns} turn${puzzle.turns > 1 ? 's' : ''}. Par is ${puzzle.par} actions.`, 'info', 'KO');
  announceTurn();
}

async function coverCut(swap) {
  busy = true; hideOv = true; update();
  await tween(170, (k) => { sceneA = 1 - k; });
  swap();
  await tween(230, (k) => { sceneA = k; });
  sceneA = 1; hideOv = false; busy = false;
  update();
}

function snapVis() {
  vis.att = S.att.map((a) => ({ x: a.x, y: a.y, pose: 'idle', facing: 1 }));
  vis.def = S.def.map((d) => ({ x: d.x, y: d.y, pose: d.type === 'keeper' ? 'ready' : 'idle', facing: -1 }));
  vis.holder = { side: 'att', i: S.ball };
  vis.ball = null;
  vis.inNet = false;
}

// Rewind / reset: everyone jogs back to the target state and the ball travels
// back to its holder. If the ball is in the net, cover the cut with a fade.
async function transitionTo(T) {
  if (vis.inNet) { await coverCut(() => { S = T; snapVis(); }); return; }
  busy = true; hideOv = true; update();
  const fa = vis.att.map((v) => ({ x: v.x, y: v.y }));
  const fd = vis.def.map((v) => ({ x: v.x, y: v.y }));
  const moved = (f, t) => Math.abs(f.x - t.x) + Math.abs(f.y - t.y) > 0.01;
  const moveBall = !(vis.holder && vis.holder.side === 'att' && vis.holder.i === T.ball);
  const anyMove = moveBall || T.att.some((a, i) => moved(fa[i], a)) || T.def.some((d, i) => moved(fd[i], d));
  if (anyMove) {
    const bf = ballNow();
    if (moveBall) { vis.holder = null; vis.ball = { ...bf, h: 0, spin: 0 }; }
    T.att.forEach((a, i) => { if (moved(fa[i], a)) { vis.att[i].pose = 'run'; vis.att[i].facing = a.x >= fa[i].x ? 1 : -1; } });
    T.def.forEach((d, i) => { if (moved(fd[i], d)) { vis.def[i].pose = d.type === 'keeper' ? 'ready' : 'run'; vis.def[i].facing = d.x >= fd[i].x ? 1 : -1; } });
    await tween(340, (k) => {
      const e = ease(k);
      T.att.forEach((a, i) => { vis.att[i].x = lerp(fa[i].x, a.x, e); vis.att[i].y = lerp(fa[i].y, a.y, e); });
      T.def.forEach((d, i) => { vis.def[i].x = lerp(fd[i].x, d.x, e); vis.def[i].y = lerp(fd[i].y, d.y, e); });
      if (moveBall) {
        const to = ballPx(vis.att[T.ball]);
        vis.ball.x = lerp(bf.x, to.x, e); vis.ball.y = lerp(bf.y, to.y, e);
        vis.ball.h = Math.sin(Math.PI * k) * 8; vis.ball.spin = k * 10;
      }
    });
  }
  S = T;
  vis.att.forEach((v) => { v.pose = 'idle'; });
  vis.def.forEach((v, i) => { v.pose = S.def[i].type === 'keeper' ? 'ready' : 'idle'; });
  vis.holder = { side: 'att', i: S.ball }; vis.ball = null;
  hideOv = false; busy = false;
}

async function reset(silent) {
  if (busy) return;
  await transitionTo(initState(puzzle));
  history = []; actions = 0; sel = S.ball; passMode = false; infoOverride = '';
  cursor = { x: S.att[S.ball].x, y: S.att[S.ball].y };
  if (!silent) { sfx.whoosh(); shell.log('Puzzle reset.', 'info', 'T1'); announceTurn(); }
  update();
}

async function undo() {
  if (busy || !history.length) return;
  passMode = false; infoOverride = '';
  const h = history.pop();
  sfx.whoosh();
  await transitionTo(h.S);
  actions = h.actions; sel = h.sel;
  shell.log('Undo.', 'info', 'T' + S.turn);
  update();
}

function announceTurn() {
  const c = S.att[S.ball];
  const keeper = S.def.find((d) => d.type === 'keeper');
  let txt = `Turn ${S.turn}/${S.turns}. Defenders chase ${who(c.id)}'s square (red ring).`;
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
    b.onclick = () => { if (!busy && p.id !== puzzle.id) { sfx.click(); shell.clearLog(); loadPuzzle(p.id); } };
    box.appendChild(b);
  });
}

// ---------------------------------------------------------------- HUD
// Buttons are enabled by the rules only; taps during an animation are ignored,
// so nothing flickers grey on every move.
function update() {
  $('.bt-title h3').textContent = puzzle.name;
  $('.turn').textContent = S.status === 'play' ? `Turn ${S.turn}/${S.turns}` : S.status === 'won' ? 'Scored!' : 'Failed';
  $('.acts').textContent = `Actions ${actions} · par ${puzzle.par}`;
  const hint = $('.bt-hint');
  if (hintShown) hint.textContent = '💡 ' + puzzle.hint;
  else { hint.innerHTML = '<button>💡 Show hint</button>'; hint.querySelector('button').onclick = () => { hintShown = true; sfx.click(); update(); }; }

  const lanes = S.status === 'play' ? shotLanes(S) : { lanes: [] };
  btn.shoot.classList.toggle('disabled', !lanes.lanes.length); // stays tappable so it can say why
  btn.shoot.disabled = S.status !== 'play';
  btn.shoot.innerHTML = lanes.lanes.length ? `Shoot ${oddsPill(1)} <span class="key">F</span>` : 'Shoot <span class="key">F</span>';
  btn.undo.disabled = !history.length;
  const pts = S.status === 'play' ? passTargets(S) : [];
  if (!pts.length) passMode = false;
  btn.pass.classList.toggle('disabled', !pts.length && S.status === 'play');
  btn.pass.disabled = S.status !== 'play';
  btn.pass.classList.toggle('pressed', passMode);
  btn.pass.innerHTML = passMode ? 'Pick ⚽' : 'Pass <span class="key">P</span>';
  btn.end.disabled = S.status !== 'play';
  if (S.status === 'play') {
    const t = tacklersAfter(S);
    btn.end.innerHTML = `End turn ${t.length ? oddsPill(0, 'Keep') : oddsPill(1, 'Keep')} <span class="key">E</span>`;
  } else btn.end.innerHTML = 'End turn';

  const info = $('.bt-info');
  if (infoOverride) { info.innerHTML = infoOverride; return; }
  if (passMode) { info.innerHTML = `<span><b>Pass:</b> tap a teammate marked ⚽. Tap anywhere else to cancel. This uses the team's one pass this turn.</span>`; return; }
  if (S.status !== 'play') { info.innerHTML = S.status === 'won' ? '<span>⚽ Goal! Pick another puzzle or reset to chase par.</span>' : '<span>Ball lost. Undo (↶) or reset (⟲).</span>'; return; }
  if (sel >= 0) {
    const a = S.att[sel], c = byId[a.id];
    const isCarrier = sel === S.ball;
    let tip = a.moved ? 'Already moved this turn.' : 'Tap a blue square to move (2 max).';
    if (isCarrier) {
      const pt = passTargets(S);
      if (pt.length) tip += ' Or press Pass.';
      else if (S.passUsed) tip += ' Pass used this turn.';
      if (lanes.lanes.length) tip = '<b>Clear shot!</b> Press Shoot. ' + tip;
      else if (lanes.inZone && lanes.blocked.length) tip = (lanes.blocked[0].why === 'keeper' ? 'Keeper covers that angle. ' : 'Lane blocked. ') + tip;
    }
    info.innerHTML = `<img src="${portrait(c, 60)}" alt=""><span><b>${c.name}</b>${isCarrier ? ' · ⚽' : ''} — ${tip}</span>`;
  } else info.innerHTML = '<span>Tap an attacker (yellow). Tap a red defender to see how he moves.</span>';
}

// Push the pre-action state for undo, then commit the result.
function commit(r, counts = true) {
  history.push({ S, actions, sel });
  if (counts) actions++;
  S = r.state;
}

// ---------------------------------------------------------------- actions
async function moveTo(i, x, y) {
  const r = apply(S, { t: 'move', i, x, y });
  if (!r) return;
  busy = true; passMode = false; infoOverride = '';
  const from = { x: S.att[i].x, y: S.att[i].y };
  const v = vis.att[i];
  if (x !== from.x) v.facing = x > from.x ? 1 : -1;
  v.pose = 'run';
  sfx.tick();
  const d = cheb(from, { x, y });
  await tween(150 + d * 120, (k) => { const e = ease(k); v.x = lerp(from.x, x, e); v.y = lerp(from.y, y, e); });
  v.pose = 'idle';
  commit(r);
  shell.log(`${who(S.att[i].id)} runs ${d} square${d > 1 ? 's' : ''}.`, '', 'T' + S.turn);
  busy = false;
  if (i === S.ball && shotLanes(S).lanes.length) sfx.good(); // the Shoot button lights up; no toast over the bar
  update();
}

async function pass(j) {
  const i = S.ball;
  const r = apply(S, { t: 'pass', j });
  if (!r) return;
  busy = true; passMode = false; update();
  const a = vis.att[i], b = vis.att[j];
  a.facing = b.x >= a.x ? 1 : -1;
  if (b.x !== a.x) b.facing = a.x > b.x ? 1 : -1;
  a.pose = 'ready';                        // set the body
  await wait(110);
  a.pose = 'pass'; sfx.pass();              // strike: the ball leaves the boot now
  const from = ballPx(a);
  vis.holder = null; vis.ball = { ...from, h: 0, spin: 0 };
  const dist = cheb(S.att[i], S.att[j]);
  await tween(220 + dist * 80, (k) => {
    const to = ballPx(b);
    vis.ball.x = lerp(from.x, to.x, k); vis.ball.y = lerp(from.y, to.y, k);
    vis.ball.h = Math.sin(Math.PI * k) * (5 + dist * 4); vis.ball.spin = k * 12;
  });
  vis.ball = null; vis.holder = { side: 'att', i: j }; // controlled at the receiver's feet
  sfx.thud();
  await wait(120);
  a.pose = 'idle';
  commit(r);
  shell.log(`${who(S.att[i].id)} passes to ${who(S.att[j].id)}. That is the team's pass for this turn.`, 'good', 'T' + S.turn);
  sel = j;
  busy = false; update();
}

async function shoot() {
  if (busy || S.status !== 'play') return;
  const sl = shotLanes(S);
  if (!sl.lanes.length) {
    explain(!sl.inZone ? `No shot: get ${who(S.att[S.ball].id)} into the dashed scoring zone (top 3 rows) first.` : sl.blocked.some((b) => b.why === 'keeper') ? 'No shot: the keeper covers every lane from there. Pull him over first.' : 'No shot: a player is standing in the lane.');
    return;
  }
  const i = S.ball;
  const lane = sl.lanes[0];
  const r = apply(S, { t: 'shoot' });
  if (!r) return;
  busy = true; hideOv = true; passMode = false; infoOverride = ''; update();
  const a = vis.att[i];
  a.facing = lane.dx > 0 ? 1 : lane.dx < 0 ? -1 : a.facing;
  a.pose = 'ready';
  await wait(120);
  a.pose = 'kick'; sfx.kick();
  const from = ballPx(a);
  // aim into the net column where the rule checks the crossing (lane.cross.x), i.e. the OPEN column
  const to = { x: cx(lane.cross.x), y: L.y0 - pitch.netDepth * 0.45 };
  vis.holder = null; vis.ball = { ...from, h: 0, spin: 0 };
  // The keeper reacts to the strike and stretches toward the lane, but the
  // lane is outside his reach: he is at full stretch as the ball passes him.
  const ki = S.def.findIndex((d) => d.type === 'keeper');
  const kv = ki >= 0 ? vis.def[ki] : null;
  const kx0 = kv?.x;
  const dir = kv ? Math.sign(lane.cross.x - kv.x) || 1 : 0;
  const kCross = kv ? Math.min(0.9, Math.max(0.3, (from.y - feet(kv.y)) / (from.y - to.y))) : 1;
  const T = 360 + Math.max(0, from.y - to.y) * 0.35;
  await tween(T, (k) => {
    vis.ball.x = lerp(from.x, to.x, k); vis.ball.y = lerp(from.y, to.y, k);
    vis.ball.h = Math.sin(Math.PI * k) * 10; vis.ball.spin = k * 20;
    // the dive pose lays the body out behind `facing`, so facing = -dir puts the hands toward the ball
    if (kv && k > 0.12) { kv.pose = 'dive'; kv.facing = -dir; kv.x = kx0 + dir * 0.5 * ease(Math.min(1, (k - 0.12) / (kCross - 0.12))); }
    if (k > 0.25) a.pose = 'idle';
  });
  vis.ball.h = 0; vis.inNet = true;
  // contact: ball hits the net
  pitch.goal(true);
  sfx.goal();
  hitstop = 0.1;
  shell.banner('GOAL!', who(S.att[i].id));
  shell.confetti();
  shell.shake();
  vis.att.forEach((v) => { v.pose = 'celebrate'; });
  // the keeper stays down through the goal moment; he gets up a little later
  commit(r);
  const stars = starsFor(actions);
  const best = Math.max(stars, progress[puzzle.id] || 0);
  progress[puzzle.id] = best; save();
  if (tier === 'clutch') shell.setScore({ ...SCORE[tier], home: SCORE[tier].home + 1 });
  shell.log(`GOAL! ${who(S.att[i].id)} shoots through the open lane. ${actions} actions (par ${puzzle.par}) · ${'★'.repeat(stars)}`, 'goal', 'T' + S.turn);
  renderChips();
  update();
  await wait(700);
  if (kv) { kv.pose = 'ready'; await wait(150); kv.pose = 'sad'; }
  await wait(450);
  busy = false; update();
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
  const r = apply(S, { t: 'end' });
  if (!r) return;
  busy = true; hideOv = true; sel = -1; passMode = false;
  infoOverride = '<span><b>Defenders move…</b> each one walks his red arrow.</span>'; update();
  sfx.click();
  await wait(140); // planning overlays fade, then the defenders go
  // Each defender walks the cells he actually reaches. A defender stopped by
  // an attacker lunges into him and bounces back on the following beat.
  const moves = r.info.moves;
  const blockers = r.info.blockers;
  const steps = Math.max(0, ...moves.map((m, i) => m.walked.length + (blockers[i] >= 0 ? 1 : 0)));
  for (let step = 0; step < steps; step++) {
    const starts = vis.def.map((v) => ({ x: v.x, y: v.y }));
    const bumpers = moves.map((m, i) => (blockers[i] >= 0 && step === m.walked.length ? i : -1)).filter((i) => i >= 0);
    moves.forEach((m, i) => {
      const c = m.walked[step] || (bumpers.includes(i) ? m.blockedAt : null);
      if (!c) return;
      vis.def[i].pose = before.def[i].type === 'keeper' ? 'ready' : 'run';
      if (c.x !== starts[i].x) vis.def[i].facing = c.x > starts[i].x ? 1 : -1;
    });
    let contact = false;
    await tween(bumpers.length ? 320 : 260, (k) => {
      const e = ease(k);
      moves.forEach((m, i) => {
        const c = m.walked[step];
        if (c) { vis.def[i].x = lerp(starts[i].x, c.x, e); vis.def[i].y = lerp(starts[i].y, c.y, e); return; }
        if (!bumpers.includes(i)) return;
        // lunge to half a square, meet the blocker, bounce back
        const b = m.blockedAt, s = Math.sin(Math.PI * k) * 0.5;
        vis.def[i].x = starts[i].x + (b.x - starts[i].x) * s; vis.def[i].y = starts[i].y + (b.y - starts[i].y) * s;
        const bv = vis.att[blockers[i]], a0 = before.att[blockers[i]];
        const s2 = Math.sin(Math.PI * k) * 0.12; // blocker leans into the contact
        bv.x = a0.x + (starts[i].x - a0.x) * s2; bv.y = a0.y + (starts[i].y - a0.y) * s2;
      });
      if (!contact && bumpers.length && k >= 0.5) {
        contact = true;
        sfx.thud(); hitstop = 0.08;
        for (const i of bumpers) {
          const bv = vis.att[blockers[i]];
          bv.pose = 'ready'; // braced: he takes the hit and stays on his feet
          shell.popupAt(canvas, cx(bv.x), cy(bv.y) - L.crop - L.size * 0.6, 'BLOCKED', '#9fe8ff');
          shell.log(`${who(before.def[i].id)} runs into ${who(before.att[blockers[i]].id)} and stops short.`, 'good', 'T' + before.turn);
        }
      }
    });
    for (const i of bumpers) { const a0 = before.att[blockers[i]]; const bv = vis.att[blockers[i]]; bv.x = a0.x; bv.y = a0.y; bv.pose = 'idle'; }
    if (!bumpers.length) sfx.tick();
  }
  vis.def.forEach((v, i) => { v.pose = before.def[i].type === 'keeper' ? 'ready' : 'idle'; });
  commit(r, false);
  infoOverride = '';

  if (S.status === 'lost' && S.reason === 'tackled') {
    const ti = r.info.tacklers[0];
    const tv = vis.def[ti], cv = vis.att[S.ball];
    // anticipation: the tackler sets himself, then slides in to the ball
    const contactPt = ballPx(cv);
    const side = tv.x <= cv.x ? -1 : 1;
    const t0 = { x: tv.x, y: tv.y };
    const t1 = { x: gridX(contactPt.x + side * L.size * 0.3), y: gridYFromFeet(contactPt.y + 2) };
    tv.facing = -side; tv.pose = 'ready';
    await wait(160);
    tv.pose = 'slide'; sfx.whoosh();
    await tween(220, (k) => { const e = ease(k); tv.x = lerp(t0.x, t1.x, e); tv.y = lerp(t0.y, t1.y, e); });
    // contact: the foot reaches the ball now
    hitstop = 0.16; sfx.thud(); shell.shake(); shell.flash('#ff6b5a');
    cv.pose = 'sad';
    shell.banner('TACKLED', `${who(before.def[ti].id)} wins it`, '#ff8a7a');
    shell.log(`Tackled: ${who(before.att[before.ball].id)} finished the turn next to ${who(before.def[ti].id)} (${DEF_TYPES[before.def[ti].type].name}).`, 'bad', 'T' + before.turn);
    update();
    // the ball squirts loose back toward where the tackler came from; he gets up and collects it
    const loose = ballPx(t0);
    vis.holder = null; vis.ball = { ...contactPt, h: 0, spin: 0 };
    await tween(240, (k) => { const e = 1 - (1 - k) * (1 - k); vis.ball.x = lerp(contactPt.x, loose.x, e); vis.ball.y = lerp(contactPt.y, loose.y, e); vis.ball.h = Math.sin(Math.PI * k) * 4; vis.ball.spin = -k * 8; });
    tv.pose = 'run'; tv.facing = side;
    await tween(220, (k) => { const e = ease(k); tv.x = lerp(t1.x, t0.x, e); tv.y = lerp(t1.y, t0.y, e); });
    vis.ball = null; vis.holder = { side: 'def', i: ti };
    tv.pose = 'idle';
    sfx.lose();
    await wait(200);
    tv.pose = 'celebrate';
    busy = false; hideOv = false; update();
    await wait(700);
    failModal('Tackled', `${who(before.att[before.ball].id)} ended the turn next to a defender. Undo the turn and check the red squares first.`);
    return;
  }
  if (S.status === 'lost' && S.reason === 'time') {
    sfx.whistle(3);
    shell.banner('FULL TIME', 'out of turns', '#fff');
    shell.log('Out of turns. The chance is gone.', 'bad', 'T' + before.turn);
    vis.att.forEach((v) => { v.pose = 'sad'; });
    busy = false; hideOv = false; update();
    await wait(900);
    failModal('Out of turns', `You get ${puzzle.turns} turn${puzzle.turns > 1 ? 's' : ''} to score. Plan the bait on turn 1.`);
    return;
  }
  sfx.whistle();
  sel = S.ball;
  busy = false; hideOv = false;
  announceTurn();
  update();
}

// A blocked action explains itself in the info row (never a toast over the action bar).
function explain(msg) {
  infoOverride = `<span>⚠️ ${msg}</span>`;
  sfx.bad();
  update();
}

function togglePass() {
  if (busy || S.status !== 'play') return;
  if (!passTargets(S).length) { explain(S.passUsed ? 'No pass: the team already used its one pass this turn.' : 'No pass: no teammate on a clear straight or diagonal line.'); return; }
  passMode = !passMode;
  infoOverride = '';
  if (passMode) { sel = S.ball; const t = S.att[passTargets(S)[0]]; cursor = { x: t.x, y: t.y }; }
  sfx.click(); update();
}

async function failModal(title, text) {
  const v = await shell.modal({ title, html: `<p>${text}</p>`, buttons: [{ label: 'Undo turn', value: 'undo' }, { label: 'Reset', value: 'reset', cls: 'paper' }] });
  if (v === 'undo') undo(); else if (v === 'reset') reset();
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
    if (ai >= 0 && ai !== S.ball) { explain('No pass to ' + who(S.att[ai].id) + ': ' + passProblem(S, ai)); return; }
    sfx.click();
    update();
    return;
  }
  if (ai >= 0) {
    sel = ai; // tapping the selected player keeps him selected (How-to: tap an attacker, then a blue square)
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
  if (!L || !S) return;
  const r = canvas.getBoundingClientRect();
  const px = e.clientX - r.left, py = e.clientY - r.top + L.crop;
  if (py < L.y0) { if (!busy && S.status === 'play' && shotLanes(S).lanes.length) shoot(); return; }
  const x = Math.floor((px - L.x0) / L.cellW), y = Math.floor((py - L.y0) / L.cellH);
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  showCursor = false;
  tapCell(x, y);
});

let showCursor = false;
addEventListener('keydown', (e) => {
  if (e.defaultPrevented || document.querySelector('.sheet-wrap') || !S) return;
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
    if (busy) return;
    const i = PUZZLES.findIndex((p) => p.id === puzzle.id);
    const n = PUZZLES[(i + 1) % PUZZLES.length];
    shell.clearLog();
    if (n.tier !== tier) shell.setPhase(n.tier); else loadPuzzle(n.id);
  } else if (k === 'escape') { sel = -1; passMode = false; infoOverride = ''; update(); }
});

// test hook (used by automated play-throughs; harmless in production)
window.__bt = { pass: () => togglePass(), tap: (x, y) => tapCell(x, y), shoot: () => shoot(), end: () => endTurn(), undo: () => undo(), reset: () => reset(), state: () => S, busy: () => busy, sel: () => sel, load: (id) => loadPuzzle(id), progress: () => progress, vis, cell: (x, y) => { const r = canvas.getBoundingClientRect(); return [r.left + cx(x), r.top + cy(y) - L.crop]; } };

// ---------------------------------------------------------------- render
let last = performance.now();
let lastRaf = last;
function advance(now) {
  let dt = Math.min(0.05, Math.max(0, now - last) / 1000);
  last = now;
  if (DEV && window.__slow) dt *= window.__slow; // ?jank=1 only: window.__slow = 0.25 for slow motion
  const want = hideOv || !S || S.status !== 'play' ? 0 : 1;
  ovA += Math.sign(want - ovA) * Math.min(Math.abs(want - ovA), dt * 7);
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
// Under ?jank=1 also draw then, so the jank detector still sees every motion.
setInterval(() => {
  const now = performance.now();
  if (now - lastRaf > 200) { const dt = advance(now); if (DEV && S && L) draw(now / 1000, dt); }
}, 50);

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
  // planning overlays: drawn from the committed state, faded out while things move
  if (ovA > 0.01) {
    ctx.save();
    ctx.globalAlpha = ovA;
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
    // red ring: the square every ball-chasing defender is heading for this turn
    if (S.aim) aimRing(S.aim.x, S.aim.y, t);
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
    if (playing) {
      const c = S.att[S.ball];
      for (const l of shotLanes(S).lanes) drawArrow(ctx, cx(c.x), cy(c.y), cx(l.cross.x), L.y0 - pitch.netDepth * 0.5, '#FFD23F', { width: 3.5, head: 9 });
    }
    // telegraphs
    prev.forEach((p, i) => {
      const d = S.def[i];
      let px = cx(p.from.x), py = cy(p.from.y);
      p.walked.forEach((s, k) => {
        const nx = cx(s.x), ny = cy(s.y);
        const last = k === p.walked.length - 1;
        drawArrow(ctx, px, py, nx, ny, '#ff5a4a', { width: 3, dash: last ? null : [5, 4], head: last ? 8 : 0 });
        px = nx; py = ny;
      });
      if (p.blockedAt) {
        const bx = cx(p.blockedAt.x), by = cy(p.blockedAt.y) - L.cellH * 0.38;
        ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath();
        ctx.moveTo(bx - 5, by - 5); ctx.lineTo(bx + 5, by + 5); ctx.moveTo(bx + 5, by - 5); ctx.lineTo(bx - 5, by + 5); ctx.stroke(); ctx.restore();
      }
      if (p.walked.length) drawPlayer(ctx, byId[d.id], cx(p.to.x), feet(p.to.y), { size: L.size * 0.9, alpha: 0.32 * ovA, t, facing: -1, shadow: false, noTrack: true });
    });
    ctx.restore();
  }

  // sprites, back to front; the ball is drawn with its holder
  const sprites = [];
  S.att.forEach((a, i) => sprites.push({ c: byId[a.id], v: vis.att[i], att: true, i }));
  S.def.forEach((d, i) => sprites.push({ c: byId[d.id], v: vis.def[i], att: false, i, d }));
  sprites.sort((a, b) => a.v.y - b.v.y);
  for (const sp of sprites) {
    const x = cx(sp.v.x), y = feet(sp.v.y);
    const glow = sp.att && sp.i === sel && playing ? '#FFD23F' : null;
    drawPlayer(ctx, sp.c, x, y, { size: L.size, pose: sp.v.pose, t, facing: sp.v.facing, glow, alpha: sceneA });
    const h = vis.holder;
    if (h && (h.side === 'att') === sp.att && h.i === sp.i) {
      const b = ballPx(sp.v);
      ctx.save(); ctx.globalAlpha = sceneA; drawBall(ctx, b.x, b.y, ballR(), t * 2); ctx.restore();
    }
    if (!sp.att && sp.d.type === 'giant' && S.turn % 2 === 0 && S.status === 'play') {
      ctx.save(); ctx.globalAlpha = ovA; ctx.font = '700 13px "Lilita One", system-ui'; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1b1b2f'; ctx.lineWidth = 3;
      const zz = 'z' + (Math.sin(t * 3) > 0 ? 'Z' : 'z');
      ctx.strokeText(zz, x + L.size * 0.25, y - L.size * 0.95); ctx.fillText(zz, x + L.size * 0.25, y - L.size * 0.95); ctx.restore();
    }
  }
  if (vis.ball) { ctx.save(); ctx.globalAlpha = sceneA; drawBall(ctx, vis.ball.x, vis.ball.y, ballR(), vis.ball.spin, vis.ball.h); ctx.restore(); }
  pitch.drawFront(ctx, t);

  // overlays above the lighting, attached to the moving sprites
  ctx.save();
  ctx.globalAlpha = sceneA;
  S.def.forEach((d, i) => {
    if (d.type === 'def') return;
    const tag = { fast: '»2', marker: '◎', sweeper: '↔', giant: 'G', keeper: 'GK' }[d.type];
    tagAt(cx(vis.def[i].x) - L.size * 0.32, feet(vis.def[i].y) - L.size * 0.86, tag, '#E8463A');
  });
  ctx.globalAlpha = sceneA * ovA;
  // marker lines
  S.def.forEach((d, i) => {
    if (d.type !== 'marker') return;
    const a = vis.att[d.mark], v = vis.def[i];
    ctx.save(); ctx.setLineDash([2, 4]); ctx.strokeStyle = 'rgba(255,120,110,.8)'; ctx.lineWidth = 1.5; ctx.beginPath();
    ctx.moveTo(cx(v.x), cy(v.y)); ctx.lineTo(cx(a.x), cy(a.y)); ctx.stroke(); ctx.restore();
  });
  if (S.status === 'play') {
    // pass badges
    if (passMode && playing) for (const j of passTargets(S)) { const b = S.att[j]; tagAt(cx(b.x) + L.size * 0.32, feet(b.y) - L.size * 0.9, '⚽', '#fff', '#1b1b2f'); }
    // carrier safety if you ended the turn now (follows the carrier while he runs)
    const h = vis.holder;
    if (h && h.side === 'att' && h.i === S.ball) {
      const v = vis.att[S.ball];
      drawOdds(ctx, cx(v.x), feet(v.y) - L.size * 1.08, tacklersAfter(S, prev).length ? 0 : 1, 'Keep');
    }
    const sl = shotLanes(S);
    if (sl.lanes.length && playing) drawOdds(ctx, cx(sl.lanes[0].cross.x), L.y0 - pitch.netDepth - 12, 1, 'Goal');
  }
  ctx.restore();
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

function aimRing(x, y, t) {
  const px = cx(x), py = feet(y) - 1;
  ctx.save();
  ctx.strokeStyle = '#ff5a4a'; ctx.lineWidth = 2.5;
  ctx.setLineDash([5, 4]); ctx.lineDashOffset = -t * 12;
  ctx.beginPath(); ctx.ellipse(px, py, L.cellW * 0.38, L.cellH * 0.16, 0, 0, Math.PI * 2); ctx.stroke();
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
