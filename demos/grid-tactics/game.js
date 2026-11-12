// Grid Tactics: Advance Wars / Into the Breach football on a 7x11 grid.
// Pure rules and the AI live in logic.js; this file renders, animates and
// handles input.
import { Shell, oddsPill } from '../../shared/shell.js';
import { Pitch, drawPlayer, drawBall, drawArrow, drawOdds, setupCanvas, portrait, lerp, ease } from '../../shared/art.js';
import { byId } from '../../shared/cast.js';
import { sfx } from '../../shared/sfx.js';
import {
  COLS, ROWS, MID, GOAL_C, cheb, unitAt, carrier, ballPos, moveRange, zoc, reach, offsideRow, isOffside,
  passOdds, shotOdds, tackleOdds, canTackle, aiPlan, afterDribble, stats, name,
} from './logic.js';

// ---------------------------------------------------------------- phases
const ROLE = (id) => byId[id].pos;
const KICKOFF = {
  sun: { sun: [['wak', 3, 10], ['tomo', 2, 8], ['mo', 4, 8], ['kenji', 2, 6], ['rio', 3, 5]], red: [['oskar', 3, 0], ['hans', 2, 2], ['lu', 4, 2], ['zed', 4, 3], ['viper', 1, 4]], ball: 'rio' },
  red: { sun: [['wak', 3, 10], ['tomo', 2, 8], ['mo', 4, 8], ['kenji', 2, 7], ['rio', 5, 6]], red: [['oskar', 3, 0], ['hans', 2, 2], ['lu', 4, 2], ['zed', 4, 4], ['viper', 3, 5]], ball: 'viper' },
};
const PHASES = {
  early: { minute: 0, end: 45, score: [0, 0], variant: 'day', specials: { needle: 0, eagle: 0 }, setup: KICKOFF.sun,
    intro: 'Kick-off. First half, 5 minutes a round.' },
  mid: { minute: 60, end: 90, score: [1, 1], variant: 'dusk', specials: { needle: 1, eagle: 1 },
    setup: { sun: [['wak', 3, 10], ['tomo', 1, 7], ['mo', 4, 8], ['kenji', 3, 6], ['rio', 5, 3]], red: [['oskar', 3, 0], ['hans', 2, 2], ['lu', 4, 3], ['zed', 2, 4], ['viper', 5, 6]], ball: 'kenji' },
    intro: "60', 1–1. Kenji's Needle Pass and Rio's Eagle Strike are charged (one use each)." },
  clutch: { minute: 80, end: 95, score: [1, 2], variant: 'night', specials: { needle: 1, eagle: 1 },
    setup: { sun: [['wak', 3, 10], ['tomo', 1, 6], ['mo', 3, 8], ['kenji', 2, 4], ['rio', 5, 3]], red: [['oskar', 3, 0], ['hans', 2, 2], ['lu', 4, 2], ['zed', 3, 6], ['viper', 5, 7]], ball: 'kenji' },
    intro: "80', a goal down. Three rounds to the final whistle at 90+5'. Specials charged." },
};
const SPECIALS = {
  needle: { who: 'kenji', name: 'Needle Pass', text: 'Next pass ignores defenders on the line.' },
  eagle: { who: 'rio', name: 'Eagle Strike', text: '+20% on the next shot.' },
};

const shell = new Shell({
  id: 'grid-tactics',
  title: 'Grid Tactics',
  pitch: 'Football as a tactics board. Move the players near the ball, then pass, shoot or tackle. Every risk shows its odds first.',
  how: [
    'Tap a yellow player, then a blue square to move (range from pace; a great dribbler moves 1 further with the ball). On your turn, faint red squares show how far Redrock\'s ball carrier can dribble.',
    'Moving next to an opponent stops you (red-edged squares). The ball carrier is the exception: he can dribble past.',
    'After moving: <b>Pass</b> (pick a teammate or an empty square for a through ball), <b>Shoot</b>, or <b>Hold</b>.',
    '<b>Tackle</b> needs a standing start: a player who has not moved this turn and is next to the carrier. Step in now, tackle next turn (Redrock play by the same rule).',
    'Your keeper and defenders far from the ball hold shape on their own (dimmed). Tap one to move him anyway, or just end the turn.',
    'Red rings show who could intercept a pass. The dashed line is offside: a teammate past it (and past the ball) when you pass is flagged.',
    'Through ball: pass into space, then move a runner who has not moved yet onto the ball.',
    'Shot odds fall away fast beyond about 4 squares and at tight angles (good chances come from in front of goal, inside the box). They also drop for a keeper on his line and each defender next to the shooter. A miss is blocked by that defender (the ball runs loose), saved, or goes wide for a goal kick.',
    'A failed pass is cut out by the first red-ringed defender, or overhit into space as a loose ball.',
    'Moves can be undone until you roll dice (pass, shot, tackle). End the turn and Redrock moves. Each round is 5 minutes.',
    'Keys: arrows/WASD cursor · Enter select · Tab next player · P pass · F shoot · T tackle · X hold · Q special · U undo · E end turn.',
  ],
  notice: 'Does moving every player feel like football, or like chess with a ball? Watch whether you think about shape and space, or just about the ball carrier.',
  phases: [
    { id: 'early', label: 'Kick-off', sub: "0' · 0–0" },
    { id: 'mid', label: 'Second half', sub: "60' · 1–1 · specials" },
    { id: 'clutch', label: 'Stoppage', sub: "80' · 1–2 · lights" },
  ],
  onPhase: (id) => startPhase(id),
});

// ---------------------------------------------------------------- DOM
const root = document.createElement('div');
root.className = 'gt';
root.innerHTML = `
  <div class="gt-status"><span class="turn"></span><span class="chip clockchip"></span></div>
  <div class="gt-canvas"><canvas></canvas></div>
  <div class="gt-info"></div>
  <div class="gt-bar">
    <button class="btn paper small icon" data-a="undo" title="Undo move (U)">↶</button>
    <button class="btn blue small" data-a="pass">Pass <span class="key">P</span></button>
    <button class="btn red small" data-a="shoot">Shoot</button>
    <button class="btn purple small" data-a="tackle">Tackle</button>
    <button class="btn paper small" data-a="hold">Hold <span class="key">X</span></button>
    <button class="btn small end" data-a="end">End turn <span class="key">E</span></button>
  </div>
  <div class="keys">arrows/WASD cursor · Enter select/move · Tab next · P pass · F shoot · T tackle · X hold · Q special · U undo · E end</div>`;
shell.stage.appendChild(root);
// The log sits below the pitch on a phone, so the latest line is echoed in the
// info box while Redrock move: you always see what just happened.
let lastLine = '';
let lastResult = ''; // last dice outcome, kept on screen during your turn
const rawLog = shell.log.bind(shell);
shell.log = (text, kind, time) => {
  lastLine = text;
  if (kind && kind !== 'info') lastResult = text;
  rawLog(text, kind, time);
  if (G && G.side === 'red') update();
};
const $ = (s) => root.querySelector(s);
const canvas = $('canvas');
const btn = Object.fromEntries([...root.querySelectorAll('[data-a]')].map((b) => [b.dataset.a, b]));
btn.undo.onclick = () => undo();
btn.pass.onclick = () => passButton();
btn.shoot.onclick = () => shootSel();
btn.tackle.onclick = () => tackleSel();
btn.hold.onclick = () => holdSel();
btn.end.onclick = () => endSunTurn();

// ---------------------------------------------------------------- state
let G = null;              // game state (see newGame)
let phaseId = 'early';
let sel = null;            // selected sun unit id
let mode = 'idle';         // 'idle' | 'pass'
let aim = null;            // pass target cell
let armed = null;          // 'needle' | 'eagle' | null
let cursor = { x: 3, y: 7 };
let showCursor = false;
let busy = false;
let undoStack = [];
let infoUnit = null;       // enemy unit being inspected
const vis = new Map();     // id -> {x, y, pose, facing, popT}
let ballVis = null;        // {x, y, h, spin} while the ball flies
let L = null, pitch = null, ctx = null, hitstop = 0;

function makeUnits(setup) {
  const us = [];
  for (const team of ['sun', 'red']) for (const [id, x, y] of setup[team]) us.push({ id, team, role: ROLE(id), x, y, moved: false, acted: false, dazed: 0 });
  return us;
}

// Scene alpha for sprites and ball: a phase switch or restart fades the old
// scene out and the new one in, so nobody is seen jumping to the new setup.
let sceneA = 1, phaseToken = 0;
async function startPhase(id) {
  const token = ++phaseToken;
  const had = !!(G && L);
  // a phase switch mid-animation drops the old animation chain (its awaits never resolve)
  tweens.length = 0; hitstop = 0;
  if (had) {
    busy = true;
    const a0 = sceneA;
    await tween(200, (k) => { sceneA = lerp(a0, 0, k); });
    if (token !== phaseToken) return;
  }
  phaseId = id;
  const P = PHASES[id];
  G = {
    units: makeUnits(P.setup), ball: { owner: P.setup.ball, x: 0, y: 0, through: null },
    side: 'sun', round: 1, minute: P.minute, end: P.end, score: { sun: P.score[0], red: P.score[1] },
    specials: { ...P.specials }, over: false,
  };
  sel = null; mode = 'idle'; aim = null; armed = null; undoStack = []; infoUnit = null; busy = false;
  ballVis = null; lastResult = ''; lastLine = '';
  layout();
  snapVis();
  updateScore();
  shell.log(P.intro, 'info', clock());
  startSunTurn(true);
  if (had) {
    busy = true; update();
    await tween(320, (k) => { sceneA = k; });
    if (token !== phaseToken) return;
    busy = false; update();
  } else sceneA = 1;
}

function snapVis() {
  vis.clear(); // (fresh entries: no lay, so every sprite starts upright)
  for (const u of G.units) { const f = u.team === 'sun' ? 1 : -1; vis.set(u.id, { x: u.x, y: u.y, pose: u.role === 'GK' ? 'ready' : 'idle', facing: f, face: f }); }
}
const V = (u) => vis.get(u.id);
const clock = () => (G.minute > 90 ? `90+${G.minute - 90}'` : `${G.minute}'`);
const updateScore = () => shell.setScore({ home: G.score.sun, away: G.score.red, clock: clock() });
const sunUnits = () => G.units.filter((u) => u.team === 'sun');
const byUid = (id) => G.units.find((u) => u.id === id);
const selU = () => (sel ? byUid(sel) : null);
const pct = (p) => Math.round(p * 100) + '%';

// ---------------------------------------------------------------- layout
function layout() {
  const stageW = Math.min(560, shell.stage.clientWidth || 360);
  const cw = Math.max(280, stageW - 6);
  const side = Math.max(12, Math.round(cw * 0.055));
  const cellW = (cw - side * 2) / COLS;
  const top = root.querySelector('.gt-canvas').getBoundingClientRect().top + scrollY;
  const avail = Math.max(420, innerHeight - top - 148); // room for the info box + action bar
  const cellH = Math.max(cellW * 0.72, Math.min(cellW * 1.02, (avail - 72) / ROWS));
  const ph = cellH * ROWS;
  let h = ph + 52;
  for (let i = 0; i < 4; i++) h = ph + 2 * Math.max(26, Math.round(h * 0.06));
  pitch = new Pitch(cw, Math.round(h), { variant: PHASES[phaseId].variant });
  const crop = pitch.y0 - pitch.netDepth - 8;
  const ch = Math.round(pitch.y1 + pitch.netDepth + 8 - crop);
  ctx = setupCanvas(canvas, cw, ch);
  const cH = pitch.ph / ROWS;
  L = { cw, ch, cellW, cellH: cH, crop, x0: pitch.x0, y0: pitch.y0, size: Math.min(cellW * 1.05, cH * 1.12) };
}
let rT;
addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => { if (G) layout(); }, 150); });
const cx = (x) => L.x0 + (x + 0.5) * L.cellW;
const cy = (y) => L.y0 + (y + 0.5) * L.cellH;
const feet = (y) => cy(y) + L.cellH * 0.32;

// ---------------------------------------------------------------- ball position
// One mapping for every ball draw: grid point (gx, gy) -> pixel (cx(gx), cy(gy) + 0.2·cellH).
// The ball is always at a player's foot, in flight (ballVis) or loose on a cell, and
// every change between those three moves it there, so it never jumps.
const BALL_DY = 0.2;
const ballPx = (p) => ({ x: cx(p.x), y: cy(p.y) + L.cellH * BALL_DY });
function footPt(v, facing = v.face ?? v.facing) {
  return { x: v.x + (0.22 * L.size * facing) / L.cellW, y: v.y + 0.12 - 1 / L.cellH };
}
// Where the body must stand so its foot is on point p.
const standFor = (p, facing) => ({ x: p.x - (0.22 * L.size * facing) / L.cellW, y: p.y - 0.12 + 1 / L.cellH });
const loosePt = (x, y) => ({ x, y: y + 0.1 });
function ballPt() {
  if (ballVis) return { x: ballVis.x, y: ballVis.y };
  const c = carrier(G);
  if (c) return footPt(V(c));
  return loosePt(G.ball.x, G.ball.y);
}
// Fly the ball from where it is now to `to` (a point, or a function so a moving
// target is tracked). Leaves ballVis on the end point: the caller settles it.
async function flyBall(to, ms, arc, { hEnd = 0, spin = 14 } = {}) {
  const from = ballPt();
  const h0 = ballVis?.h || 0;
  ballVis = { x: from.x, y: from.y, h: h0, spin: 0 };
  await tween(ms, (k) => {
    const p = typeof to === 'function' ? to() : to;
    ballVis.x = lerp(from.x, p.x, k); ballVis.y = lerp(from.y, p.y, k);
    ballVis.h = Math.sin(Math.PI * k) * arc + lerp(h0, hEnd, k); ballVis.spin = k * spin;
  });
}
// Ball comes to rest: at a player's feet (owner id) or loose on a cell.
function settle(owner, cell) {
  G.ball = owner ? { owner, x: 0, y: 0, through: null } : { owner: null, x: cell.x, y: cell.y, through: cell.through || null };
  ballVis = null;
}
const faceTo = (v, x) => { if (Math.abs(x - v.x) > 0.05) v.facing = x > v.x ? 1 : -1; v.face = v.facing; };
// Move a sprite's visual position (not its cell) in a straight line.
function slide(v, to, ms, e = ease) {
  const fx = v.x, fy = v.y;
  return tween(ms, (k) => { v.x = lerp(fx, to.x, e(k)); v.y = lerp(fy, to.y, e(k)); });
}
const home = (u) => slide(V(u), { x: u.x, y: u.y }, 220);
// Lying poses (slide, dive) go down and get up over a few frames, not one.
const goDown = (v, ms) => { v.lay = 0; return tween(ms, (k) => { v.lay = ease(k); }); };
async function getUp(v, ms, pose) { await tween(ms, (k) => { v.lay = 1 - ease(k); }); v.lay = undefined; if (pose) v.pose = pose; }
function emptyNear(p, avoid = []) {
  const cells = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (unitAt(G, x, y) || avoid.some((a) => a.x === x && a.y === y)) continue;
    cells.push({ x, y, d: Math.hypot(x - p.x, y - p.y) });
  }
  return cells.sort((a, b) => a.d - b.d);
}

// ---------------------------------------------------------------- turn flow
function startSunTurn(first) {
  G.side = 'sun';
  for (const u of sunUnits()) {
    u.moved = u.acted = false;
    if (u.dazed) { u.moved = u.acted = true; u.dazed--; shell.log(`${name(u)} is still on the floor and sits this turn out.`, 'bad', clock()); }
  }
  undoStack = []; mode = 'idle'; aim = null; armed = null; infoUnit = null;
  // Auto-hold: the keeper and any defender far from the ball hold their shape
  // unless you tap them. Only the players near the play need a decision.
  const bp0 = ballPos(G);
  for (const u of sunUnits()) {
    u.rest = !u.acted && carrier(G) !== u && !tackleTarget(u) &&
      (u.role === 'GK' ? cheb(u, bp0) > 2 : u.role === 'DF' && cheb(u, bp0) > 3);
  }
  const c = carrier(G);
  sel = c && c.team === 'sun' && !c.acted ? c.id : null;
  if (!sel) {
    const bp = ballPos(G);
    const near = sunUnits().filter((u) => !u.acted && !u.rest).sort((a, b) => cheb(a, bp) - cheb(b, bp))[0];
    sel = near?.id || null;
  }
  if (sel) cursor = { x: selU().x, y: selU().y };
  if (!first) sfx.whistle();
  update();
  pulseTurn();
}

async function endSunTurn() {
  if (busy || G.over || G.side !== 'sun') return;
  sel = null; mode = 'idle'; aim = null; armed = null; undoStack = [];
  for (const u of sunUnits()) { u.moved = u.acted = true; }
  await redTurn();
}

async function redTurn() {
  busy = true;
  G.side = 'red';
  update();
  lastLine = '';
  pulseTurn();
  await wait(450);
  const reds = G.units.filter((u) => u.team === 'red');
  for (const u of reds) {
    u.moved = u.acted = false;
    if (u.dazed) { u.moved = u.acted = true; u.dazed--; }
  }
  // act in order of distance to the ball, carrier last when we have it
  const order = () => {
    const bp = ballPos(G), c = carrier(G);
    return reds.filter((u) => !u.acted).sort((a, b) => {
      if (c && c.team === 'red') { if (a === c) return 1; if (b === c) return -1; }
      return cheb(a, bp) - cheb(b, bp);
    });
  };
  let guard = 0;
  while (guard++ < 10) {
    const u = order()[0];
    if (!u) break;
    const plan = aiPlan(G, u);
    const WHY = { press: 'presses the ball', tackle: 'goes in for the tackle', 'cover lane': 'covers the passing lane', shape: 'holds shape', support: 'finds space', 'loose ball': 'goes for the loose ball', 'chase loose ball': 'chases the loose ball', pass: 'looks for a pass', dribble: 'dribbles forward' };
    lastLine = `${name(u)} ${WHY[plan.why] || (plan.why.startsWith('shot') ? 'lines up a shot' : plan.why)}.`;
    update();
    if (plan.move) await doMove(u, plan.move);
    if (G.goalPending) break;
    let act = plan.act;
    if (act?.t === 'after-dribble') act = carrier(G) === u ? afterDribble(G, u) : null;
    if (act?.t === 'tackle') { const c = carrier(G); if (c && c.team === 'sun' && canTackle(u, c)) await doTackle(u, c); }
    else if (act?.t === 'pass' && carrier(G) === u) await doPass(u, act.to, {});
    else if (act?.t === 'shoot' && carrier(G) === u) await doShoot(u, {});
    u.moved = u.acted = true;
    if (G.goalPending) break;
    await wait(120);
  }
  if (G.goalPending) { await afterGoal(); return; }
  busy = false;
  nextRound();
}

function nextRound() {
  G.round++;
  G.minute += 5;
  updateScore();
  if (G.minute >= G.end) { fullTime(); return; }
  startSunTurn(false);
}

async function afterGoal() {
  busy = true;
  const conceded = G.goalPending;
  G.goalPending = null;
  await wait(400);
  // kick-off: the side that conceded restarts. Everyone jogs back and the ball
  // is carried out of the net to the kick-off taker; nothing is placed.
  const from = ballPt();
  const ko = KICKOFF[conceded];
  for (const list of [ko.sun, ko.red]) for (const [id, x, y] of list) { const u = byUid(id); u.x = x; u.y = y; u.dazed = 0; }
  G.ball = { owner: ko.ball, x: 0, y: 0, through: null };
  await animateSnap(1100, from);
  shell.log(`Kick-off to ${conceded === 'sun' ? 'Sunbirds' : 'Redrock'}.`, 'info', clock());
  if (conceded === 'red') {
    // we scored on our turn: the round continues with Redrock's turn
    await redTurn();
  } else { busy = false; nextRound(); }
}

async function fullTime() {
  G.over = true;
  busy = false;
  update();
  sfx.whistle(3);
  const d = G.score.sun - G.score.red;
  const res = d > 0 ? 'WIN' : d < 0 ? 'LOSS' : 'DRAW';
  shell.banner('FULL TIME', `${G.score.sun} – ${G.score.red}`);
  shell.log(`Full time: Sunbirds ${G.score.sun} – ${G.score.red} Redrock.`, d > 0 ? 'goal' : d < 0 ? 'bad' : 'info', clock());
  if (d > 0) { sfx.win(); shell.confetti(); } else if (d < 0) sfx.lose();
  await wait(1400);
  const v = await shell.modal({
    title: `Full time · ${res}`,
    html: `<p class="center" style="font-size:22px;font-family:var(--font-h)">Sunbirds ${G.score.sun} – ${G.score.red} Redrock</p><p>${d > 0 ? 'You broke them down.' : d < 0 ? 'Redrock held on.' : 'Honours even.'} Did it feel like football, or chess with a ball?</p>`,
    buttons: [{ label: 'Play this phase again', value: 'again' }, { label: 'Close', value: 'close', cls: 'paper' }],
  });
  if (v === 'again') shell.setPhase(phaseId);
}

// ---------------------------------------------------------------- resolution (both teams)
// Every contact follows the same order: the actors move to a shared meeting
// point with the same arrival time, the outcome shows on that frame, then the
// ball goes somewhere real.
async function doMove(u, cell) {
  const v = V(u);
  const path = cell.path?.length ? cell.path : [{ x: cell.x, y: cell.y }];
  const pickup = !G.ball.owner && G.ball.x === cell.x && G.ball.y === cell.y;
  v.pose = 'run';
  let px = u.x, py = u.y;
  for (const step of path) {
    v.facing = step.x > px ? 1 : step.x < px ? -1 : v.facing;
    const fx = px, fy = py;
    await tween(105, (k) => { v.x = lerp(fx, step.x, k); v.y = lerp(fy, step.y, k); });
    px = step.x; py = step.y;
  }
  v.pose = u.role === 'GK' ? 'ready' : 'idle';
  u.x = cell.x; u.y = cell.y; u.moved = true;
  if (cell.stopped && u.team === 'sun') shell.log(`${name(u)} is stopped next to an opponent.`, 'info', clock());
  // loose ball pickup: the ball rolls onto the runner's foot, then it is his
  if (pickup) {
    const th = G.ball.through;
    await flyBall(() => footPt(v), 110, 0, { spin: 4 });
    settle(u.id);
    sfx.thud();
    if (th && th.team === u.team && !th.onside.includes(u.id)) {
      await offsideCall(u);
    } else {
      shell.log(`${name(u)} collects the ${th && th.team === u.team ? 'through ball' : 'loose ball'}.`, u.team === 'sun' ? 'good' : 'them', clock());
      popAt(u, th && th.team === u.team ? 'Through!' : 'Got it', '#fff');
    }
  }
}

// The whistle is the cause; then the ball is played to the free-kick taker.
async function offsideCall(u) {
  sfx.whistle(2);
  const foes = G.units.filter((o) => o.team !== u.team && o.role !== 'GK').sort((a, b) => cheb(a, u) - cheb(b, u));
  const taker = foes[0];
  popAt(u, 'OFFSIDE', '#FFD23F');
  shell.banner('OFFSIDE', `${name(u)} was past the line`, '#FFD23F');
  shell.log(`Offside! ${name(u)} was beyond the second-last defender when the ball was played. Free kick to ${taker.team === 'sun' ? 'Sunbirds' : 'Redrock'} (${name(taker)}).`, 'bad', clock());
  V(u).pose = 'sad';
  u.acted = true;
  await wait(550);
  const tv = V(taker);
  faceTo(tv, V(u).x);
  const d = Math.hypot(tv.x - V(u).x, tv.y - V(u).y);
  await flyBall(() => footPt(tv), 300 + d * 45, 6 + d * 2);
  settle(taker.id);
  sfx.thud();
  V(u).pose = 'idle';
  await wait(150);
}

async function doPass(u, to, { needle }) {
  const team = u.team;
  const tag = team === 'sun' ? '' : 'them';
  if (needle) { await shell.cutIn(byId[u.id], 'NEEDLE PASS', 'Kenji threads it'); G.specials.needle--; }
  const po = passOdds(G, u, to, { needle });
  const recv = unitAt(G, to.x, to.y);
  const v = V(u);
  faceTo(v, to.x);
  v.pose = 'pass';
  u.acted = true; u.moved = true;
  await wait(90); // wind-up: the swing lands, then the ball leaves
  sfx.pass();
  const roll = Math.random();
  const ok = po.offside || roll < po.p;
  const label = `${needle ? 'NEEDLE PASS: ' : ''}${name(u)} → ${recv ? name(recv) : 'space'} ${pct(po.p)}`;
  const flight = (d) => 240 + d * 55;
  if (ok) {
    if (recv) {
      const rv = V(recv);
      faceTo(rv, u.x);
      await flyBall(() => footPt(rv), flight(po.dist), 4 + po.dist * 3);
      v.pose = 'idle';
      settle(recv.id);
      sfx.thud();
      if (po.offside) { await offsideCall(recv); return; }
      popAt(recv, pct(po.p) + ' ✓', '#8ef58e');
      shell.log(`${label}: complete.`, team === 'sun' ? 'good' : tag, clock());
    } else {
      await flyBall(loosePt(to.x, to.y), flight(po.dist), 4 + po.dist * 3);
      v.pose = 'idle';
      const onside = G.units.filter((o) => o.team === team && !isOffside(G, o, { x: u.x, y: u.y })).map((o) => o.id);
      settle(null, { x: to.x, y: to.y, through: { team, onside } });
      shell.log(`${label}: through ball into space. A runner must reach it.`, team === 'sun' ? 'good' : tag, clock());
    }
  } else if (po.interceptors.length) {
    // The interceptor steps into the lane: his foot and the ball reach the
    // same point on the line on the same frame.
    const it = po.interceptors[0];
    const iv = V(it);
    const from = ballPt();
    const end = loosePt(to.x, to.y);
    const vx = end.x - from.x, vy = end.y - from.y;
    const L2 = vx * vx + vy * vy || 1;
    const tt = Math.max(0.15, Math.min(1, ((it.x - from.x) * vx + (it.y + 0.12 - from.y) * vy) / L2));
    const meet = { x: from.x + vx * tt, y: from.y + vy * tt };
    const T = flight(po.dist * tt);
    faceTo(iv, u.x);
    iv.pose = 'run';
    const stand = standFor(meet, iv.facing);
    const sx = iv.x, sy = iv.y;
    const lead = Math.min(T, 260);
    await Promise.all([
      flyBall(meet, T, (3 + po.dist * 2) * tt),
      tween(T, (k) => { const kk = ease(Math.max(0, (k * T - (T - lead)) / lead)); iv.x = lerp(sx, stand.x, kk); iv.y = lerp(sy, stand.y, kk); }),
    ]);
    v.pose = 'idle';
    iv.pose = 'kick';
    settle(it.id);
    hitstop = 0.12;
    sfx.thud(); sfx.bad(); shell.shake();
    popAt(it, 'CUT OUT', team === 'sun' ? '#ff8a7a' : '#8ef58e');
    shell.log(`${label}: rolled ${Math.round(roll * 100)}, missed. ${name(it)} was near the line and cuts it out.`, team === 'sun' ? 'bad' : 'good', clock());
    await wait(260);
    iv.pose = 'run';
    await home(it);
    iv.pose = it.role === 'GK' ? 'ready' : 'idle';
  } else {
    // overhit: runs past the target into empty grass
    const dx = Math.sign(to.x - u.x), dy = Math.sign(to.y - u.y);
    const want = { x: to.x + dx, y: to.y + dy };
    const land = emptyNear(want, [{ x: u.x, y: u.y }]).find((c) => c.x !== to.x || c.y !== to.y) || emptyNear(want)[0];
    const d = Math.hypot(land.x - u.x, land.y - u.y);
    await flyBall(loosePt(land.x, land.y), flight(d), 6 + d * 3);
    v.pose = 'idle';
    settle(null, land);
    sfx.bad();
    popAt(u, `${pct(po.p)} ✗`, '#ff8a7a');
    shell.log(`${label}: rolled ${Math.round(roll * 100)}, overhit. The ball runs loose.`, team === 'sun' ? 'bad' : tag, clock());
  }
  v.pose = 'idle';
}

async function doShoot(u, { eagle }) {
  if (eagle) { await shell.cutIn(byId[u.id], 'EAGLE STRIKE', 'Rio finds the corner'); G.specials.eagle--; }
  const so = shotOdds(G, u, { eagle });
  const v = V(u);
  u.acted = u.moved = true;
  const up = u.team === 'sun';
  const roll = Math.random();
  const goal = roll < so.p;
  const gy = up ? -0.75 : ROWS - 0.25;
  const gk = so.gk;
  const gkv = gk ? V(gk) : null;
  // Outcome on a miss: an adjacent defender blocks it, the set keeper saves it,
  // or it goes wide. Each one is caused by a factor shown in the odds.
  const blockers = G.units.filter((e) => e.team !== u.team && e.role !== 'GK' && cheb(e, u) <= 1);
  let kind = goal ? 'goal' : blockers.length && Math.random() < 0.3 + 0.2 * blockers.length ? 'block' : so.keeperSet && Math.random() < 0.75 ? 'save' : 'wide';
  const side = Math.random() < 0.5 ? -1 : 1;
  const target = kind === 'wide' ? { x: GOAL_C + side * (2.1 + Math.random() * 0.5), y: gy }
    : kind === 'save' ? { x: GOAL_C + (Math.random() - 0.5) * 1.6, y: gy }
    : { x: GOAL_C + (gk && gk.x !== GOAL_C ? Math.sign(GOAL_C - gk.x) : side) * (0.6 + Math.random() * 0.45), y: gy }; // goal: the far side from the keeper
  const why = [`from ${so.dist.toFixed(1)} squares`];
  if (so.angle < 0.7) why.push('tight angle');
  if (so.keeperSet) why.push(`keeper set −${Math.round(so.keeperPen * 100)}%`);
  if (so.pressure) why.push(`${so.pressure} defender${so.pressure > 1 ? 's' : ''} close −${so.pressure * 12}%`);
  if (eagle) why.push('Eagle Strike +20%');
  const head = `${name(u)} shoots ${pct(so.p)} (${why.join(', ')}): rolled ${Math.round(roll * 100)}.`;
  faceTo(v, target.x);
  v.pose = 'kick';

  const from = ballPt();
  const shotLen = Math.hypot(target.x - from.x, target.y - from.y);
  const T = 220 + shotLen * 26; // ~ 420 ms from the edge of the box

  if (kind === 'block') {
    // The blocker reads the wind-up and throws himself into the line; body and
    // ball meet about a square from the shooter.
    const b = blockers.sort((a, b2) => segLine(a, from, target) - segLine(b2, from, target))[0];
    const bv = V(b);
    const tb = Math.min(0.45, 0.85 / shotLen);
    const meet = { x: from.x + (target.x - from.x) * tb, y: from.y + (target.y - from.y) * tb };
    faceTo(bv, meet.x);
    bv.pose = 'slide';
    const stand = standFor(meet, bv.facing);
    sfx.whoosh();
    const wind = 140;
    await Promise.all([slide(bv, { x: lerp(bv.x, stand.x, 0.45), y: lerp(bv.y, stand.y, 0.45) }, wind), goDown(bv, wind)]);
    sfx.kick();
    const Tb = Math.max(130, T * tb);
    await Promise.all([flyBall(meet, Tb, 3), slide(bv, stand, Tb, (k) => k)]);
    hitstop = 0.14;
    sfx.thud(); shell.shake();
    popAt(b, 'BLOCKED', up ? '#ff8a7a' : '#8ef58e');
    shell.log(`${head} ${name(b)} was right next to him and blocks it.`, up ? 'bad' : 'good', clock());
    await wait(200);
    // deflects loose into nearby grass
    const away = { x: meet.x + (meet.x - from.x) * 1.2 + (Math.random() - 0.5) * 2, y: meet.y - (target.y - from.y) * 0.12 };
    const land = emptyNear(away, [{ x: u.x, y: u.y }])[0];
    await flyBall(loosePt(land.x, land.y), 320, 10, { spin: 10 });
    settle(null, land);
    v.pose = 'idle';
    await Promise.all([home(b), getUp(bv, 170, 'run')]);
    bv.pose = 'idle';
    return;
  }

  // wind-up, then the strike
  await wait(110);
  sfx.kick();

  if (kind === 'save' && gkv) {
    // Keeper and ball reach the save point on the same frame.
    const gkRow = gkv.y;
    const ts = Math.max(0.35, Math.min(0.95, (gkRow + 0.05 - from.y) / (target.y - from.y)));
    const meet = { x: from.x + (target.x - from.x) * ts, y: from.y + (target.y - from.y) * ts };
    const Ts = T * ts;
    const hEnd = L.size * 0.32;
    const gx0 = gkv.x, gy0 = gkv.y;
    const dive = Math.min(Ts * 0.75, 220);
    // The dive sprite lies head-first away from `facing`, so a keeper diving to
    // the right faces left; his gloves sit ~0.6 sprite-heights from his feet.
    const dir = meet.x >= gx0 ? 1 : -1;
    const diving = Math.abs(meet.x - gx0) > 0.35;
    const bodyX = diving ? meet.x - (dir * 0.6 * L.size) / L.cellW : meet.x;
    await Promise.all([
      flyBall(meet, Ts, 6, { hEnd, spin: 18 }),
      tween(Ts, (k) => {
        const kk = ease(Math.max(0, (k * Ts - (Ts - dive)) / dive));
        if (kk > 0 && diving && gkv.pose !== 'dive') { gkv.pose = 'dive'; gkv.facing = gkv.face = -dir; }
        if (diving) gkv.lay = kk;
        gkv.x = lerp(gx0, bodyX, kk); gkv.y = lerp(gy0, meet.y - 0.15, kk);
      }),
    ]);
    hitstop = 0.14;
    sfx.save();
    popAt(gk, 'SAVED', '#fff');
    shell.log(`${head} ${name(gk)} saves.`, up ? 'bad' : 'good', clock());
    await wait(180);
    // gathers it: the ball drops into his hands and he gets back up
    await Promise.all([
      flyBall(() => footPt(gkv), 180, 0, { hEnd: 0, spin: 2 }),
      gkv.pose === 'dive' ? getUp(gkv, 180, 'ready') : null,
    ]);
    gkv.pose = 'ready';
    settle(gk.id);
    v.pose = 'idle';
    await home(gk);
    return;
  }

  // goal or wide: the ball travels all the way
  const gx0 = gkv?.x, gy0 = gkv?.y;
  await Promise.all([
    flyBall(target, T, 14, { spin: 22 }),
    gkv && kind === 'goal' ? tween(T, (k) => {
      // late, and not far enough
      const kk = ease(Math.max(0, (k - 0.45) / 0.55));
      const dir = target.x >= gx0 ? 1 : -1;
      if (kk > 0) { gkv.pose = 'dive'; gkv.facing = gkv.face = -dir; gkv.lay = kk; }
      gkv.x = lerp(gx0, lerp(gx0, target.x, 0.5) - (dir * 0.6 * L.size) / L.cellW, kk);
    }) : null,
  ]);
  if (kind === 'goal') {
    pitch.goal(up);
    shell.shake();
    if (up) {
      G.score.sun++;
      sfx.goal(); shell.banner('GOAL!', name(u)); shell.confetti(); shell.flash('#FFD23F');
      for (const o of G.units) if (o !== gk) V(o).pose = o.team === 'sun' ? 'celebrate' : 'sad';
      shell.log(`GOAL! ${name(u)} scores. Shot ${pct(so.p)} (${why.join(', ')}), rolled ${Math.round(roll * 100)}.`, 'goal', clock());
    } else {
      G.score.red++;
      sfx.groan(); shell.banner('GOAL', `${name(u)} for Redrock`, '#ff8a7a');
      for (const o of G.units) if (o !== gk) V(o).pose = o.team === 'red' ? 'celebrate' : 'sad';
      shell.log(`Redrock score: ${name(u)}. Shot ${pct(so.p)} (${why.join(', ')}).`, 'bad', clock());
    }
    updateScore();
    if (gkv) { if (gkv.pose === 'dive') await getUp(gkv, 220, 'sad'); else gkv.pose = 'sad'; } // beaten keeper picks himself up
    G.goalPending = up ? 'red' : 'sun'; // who kicks off next = who conceded
    await wait(1000);
    return;
  }
  // wide: out for a goal kick, the ball is rolled back to the keeper
  sfx.ooh();
  const p = ballPx(target);
  const r = canvas.getBoundingClientRect();
  shell.popup('WIDE', r.left + p.x, r.top + p.y - L.crop - 20, '#fff');
  shell.log(`${head} Wide. Goal kick.`, up ? 'bad' : 'good', clock());
  v.pose = 'idle';
  await wait(350);
  if (gk) {
    faceTo(gkv, target.x);
    await flyBall(() => footPt(gkv), 520, 8, { spin: 8 });
    settle(gk.id);
    sfx.thud();
  }
}
function segLine(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2));
  return Math.hypot(a.x + vx * t - p.x, a.y + vy * t - p.y);
}

async function doTackle(t, c) {
  const p = tackleOdds(t, c);
  const tv = V(t), cv = V(c);
  t.acted = t.moved = true;
  // anticipation: the carrier turns to face the challenge (the ball rolls to
  // his near foot), then the tackler slides in and his foot reaches the ball.
  if (Math.abs(tv.x - cv.x) > 0.05) cv.facing = tv.x > cv.x ? 1 : -1;
  faceTo(tv, cv.x + 0.22 * L.size * cv.facing / L.cellW);
  tv.pose = 'run';
  await wait(150);
  const ball = footPt(cv, cv.facing);
  faceTo(tv, ball.x);
  tv.pose = 'slide';
  sfx.whoosh();
  await Promise.all([slide(tv, standFor(ball, tv.facing), 240), goDown(tv, 200)]);
  const roll = Math.random();
  const label = `${name(t)} tackles ${name(c)} ${pct(p)}`;
  if (roll < p) {
    hitstop = 0.12;
    sfx.thud(); shell.shake();
    cv.pose = 'sad';
    popAt(t, 'WON IT', t.team === 'sun' ? '#8ef58e' : '#ff8a7a');
    shell.log(`${label}: rolled ${Math.round(roll * 100)}, clean. Tackle ${stats(t).tackle} vs dribble ${stats(c).dribble}.`, t.team === 'sun' ? 'good' : 'bad', clock());
    // right after contact the ball pops off the carrier's foot and runs with
    // the tackler as he gets up and back to his square
    await Promise.all([
      flyBall(() => footPt(tv), 360, 5, { spin: 8 }),
      // he gets up while already moving away from the carrier
      Promise.all([home(t), getUp(tv, 170, 'run')]),
    ]);
    settle(t.id);
  } else {
    t.dazed = 1;
    sfx.ooh();
    popAt(c, 'SKINNED', t.team === 'sun' ? '#ff8a7a' : '#8ef58e');
    shell.log(`${label}: rolled ${Math.round(roll * 100)}, beaten. ${name(t)} is on the floor and misses next turn.`, t.team === 'sun' ? 'bad' : 'good', clock());
    // the carrier hops the challenge while the tackler slides on and stays down
    const cy0 = cv.y;
    await Promise.all([
      tween(260, (k) => { cv.y = cy0 - Math.sin(Math.PI * k) * 0.18; }),
      slide(tv, { x: lerp(tv.x, t.x, 0.3), y: lerp(tv.y, t.y, 0.3) }, 260),
    ]);
    await wait(120);
    await getUp(tv, 180, 'sad');
    await wait(120);
    await slide(tv, { x: t.x, y: t.y }, 320);
  }
  tv.pose = 'idle'; cv.pose = 'idle';
}

// Everyone moves from where they are drawn to their cell. The ball goes from
// `ballFrom` to wherever the state now says it is (usually a player's foot).
async function animateSnap(ms, ballFrom = null) {
  const starts = new Map([...vis].map(([id, v]) => [id, { x: v.x, y: v.y }]));
  for (const u of G.units) {
    const v = V(u), s = starts.get(u.id);
    v.pose = Math.hypot(s.x - u.x, s.y - u.y) > 0.05 ? 'run' : v.pose === 'celebrate' || v.pose === 'sad' ? 'idle' : v.pose;
    if (Math.abs(u.x - s.x) > 0.05) v.facing = u.x > s.x ? 1 : -1;
  }
  if (ballFrom) ballVis = { x: ballFrom.x, y: ballFrom.y, h: 0, spin: 0 };
  await tween(ms, (k) => {
    const e = ease(k);
    for (const u of G.units) { const s = starts.get(u.id), v = V(u); v.x = lerp(s.x, u.x, e); v.y = lerp(s.y, u.y, e); }
    if (ballFrom) {
      const c = carrier(G);
      const to = c ? footPt(V(c)) : loosePt(G.ball.x, G.ball.y);
      ballVis.x = lerp(ballFrom.x, to.x, e); ballVis.y = lerp(ballFrom.y, to.y, e); ballVis.spin = k * 10;
    }
  });
  ballVis = null;
  for (const u of G.units) { V(u).pose = u.role === 'GK' ? 'ready' : 'idle'; }
}

// ---------------------------------------------------------------- player actions
const clone = (o) => JSON.parse(JSON.stringify(o));
function pushUndo() { undoStack.push({ G: clone(G), sel }); }
function lockUndo() { undoStack = []; }

async function undo() {
  if (busy || !undoStack.length) return;
  const s = undoStack.pop();
  const from = ballPt();
  G = s.G; sel = s.sel; mode = 'idle'; aim = null;
  busy = true; sfx.whoosh();
  shell.log('Undo.', 'info', clock());
  update();
  await animateSnap(240, from); // players walk back; nothing jumps
  busy = false;
  update();
}

async function run(fn) {
  if (busy) return;
  busy = true; update();
  try { await fn(); } finally { busy = false; }
  if (G.goalPending) { update(); await afterGoal(); }
  if (G.side === 'sun' && !G.over) {
    const cur = selU();
    const c = carrier(G);
    if (!cur || cur.acted) {
      if (c && c.team === 'sun' && !c.acted) { sel = c.id; cursor = { x: c.x, y: c.y }; } else selectNext();
    }
  }
  update();
}

function canAct(u) { return u && u.team === 'sun' && !u.acted && G.side === 'sun' && !G.over; }

function moveSel(cell) {
  const u = selU();
  pushUndo();
  run(async () => { await doMove(u, cell); sfx.tick(); });
}

function passButton() {
  const u = selU();
  if (busy || !canAct(u) || carrier(G) !== u) return;
  if (mode === 'pass' && aim) { confirmPass(); return; }
  mode = mode === 'pass' ? 'idle' : 'pass';
  aim = null; infoUnit = null;
  sfx.click(); update();
}

function confirmPass() {
  const u = selU();
  const to = aim;
  const needle = armed === 'needle';
  armed = null; mode = 'idle'; aim = null;
  lockUndo();
  run(() => doPass(u, to, { needle }));
}

function shootSel() {
  const u = selU();
  if (busy || !canAct(u) || carrier(G) !== u) return;
  const eagle = armed === 'eagle';
  armed = null; mode = 'idle';
  lockUndo();
  run(() => doShoot(u, { eagle }));
}

function tackleTarget(u) {
  const c = carrier(G);
  return u && c && c.team === 'red' && canTackle(u, c) ? c : null;
}
function tackleSel() {
  const u = selU();
  const c = tackleTarget(u);
  if (busy || !canAct(u) || !c) return;
  lockUndo();
  run(() => doTackle(u, c));
}

function holdSel() {
  const u = selU();
  if (busy || !canAct(u)) return;
  pushUndo();
  u.moved = u.acted = true;
  shell.log(`${name(u)} holds position.`, 'info', clock());
  mode = 'idle'; aim = null;
  selectNext();
  update();
}

function selectNext() {
  // prefer whoever can tackle, then whoever is closest to the ball
  const bp = ballPos(G);
  const free = sunUnits().filter((o) => !o.acted && !o.rest).sort((a, b) => (tackleTarget(b) ? 1 : 0) - (tackleTarget(a) ? 1 : 0) || cheb(a, bp) - cheb(b, bp));
  sel = free.length ? free[0].id : null;
  if (sel) cursor = { x: selU().x, y: selU().y };
}

function toggleSpecial() {
  const u = selU();
  if (!u) return;
  const key = Object.keys(SPECIALS).find((k) => SPECIALS[k].who === u.id);
  if (!key || !G.specials[key]) return;
  armed = armed === key ? null : key;
  sfx.coin(); update();
}

// ---------------------------------------------------------------- input
function tapCell(x, y) {
  if (busy || G.over) return;
  cursor = { x, y };
  const u = selU();
  const there = unitAt(G, x, y);
  if (G.side !== 'sun') return;

  if (mode === 'pass' && u) {
    const ballThere = G.ball.owner === null && G.ball.x === x && G.ball.y === y;
    if (there && there.team === 'sun' && there !== u) {
      if (aim && aim.x === x && aim.y === y) { confirmPass(); return; }
      aim = { x, y }; sfx.tick(); update(); return;
    }
    if (!there && !ballThere) {
      if (aim && aim.x === x && aim.y === y) { confirmPass(); return; }
      aim = { x, y }; sfx.tick(); update(); return;
    }
    mode = 'idle'; aim = null;
  }
  if (there) {
    if (there.team === 'sun') {
      infoUnit = null;
      sel = sel === there.id && !(mode === 'pass') ? sel : there.id;
      mode = 'idle'; aim = null; armed = null;
      sfx.click(); update(); return;
    }
    // enemy: tackle if adjacent carrier and selected can act; else inspect
    infoUnit = there.id;
    sfx.hover(); update(); return;
  }
  if (u && canAct(u)) {
    const r = reach(G, u);
    const cell = r.get(x + ',' + y);
    if (cell) { infoUnit = null; moveSel(cell); return; }
  }
  infoUnit = null;
  update();
}

canvas.addEventListener('pointerdown', (e) => {
  if (!L) return;
  const r = canvas.getBoundingClientRect();
  const px = e.clientX - r.left, py = e.clientY - r.top + L.crop;
  const x = Math.floor((px - L.x0) / L.cellW), y = Math.floor((py - L.y0) / L.cellH);
  showCursor = false;
  if (y < 0 && selU() && carrier(G) === selU()) { shootSel(); return; }
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return;
  tapCell(x, y);
});

addEventListener('keydown', (e) => {
  if (e.defaultPrevented || document.querySelector('.sheet-wrap') || !G) return;
  const k = e.key.toLowerCase();
  const dirs = { arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1], arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0] };
  if (dirs[k]) {
    e.preventDefault(); showCursor = true;
    cursor = { x: Math.max(0, Math.min(COLS - 1, cursor.x + dirs[k][0])), y: Math.max(0, Math.min(ROWS - 1, cursor.y + dirs[k][1])) };
    if (mode === 'pass') { const t = unitAt(G, cursor.x, cursor.y); if (!t || t.team === 'sun') aim = { ...cursor }; }
    sfx.tick(); return;
  }
  if (k === 'enter' || k === ' ') { e.preventDefault(); showCursor = true; tapCell(cursor.x, cursor.y); }
  else if (k === 'tab') {
    e.preventDefault(); showCursor = true;
    if (busy || G.side !== 'sun') return;
    const free = sunUnits().filter((o) => !o.acted);
    if (!free.length) return;
    const i = free.findIndex((o) => o.id === sel);
    sel = free[(i + (e.shiftKey ? free.length - 1 : 1)) % free.length].id;
    mode = 'idle'; aim = null; armed = null; infoUnit = null;
    cursor = { x: selU().x, y: selU().y };
    sfx.click(); update();
  } else if (k === 'p') passButton();
  else if (k === 'f') shootSel();
  else if (k === 't') tackleSel();
  else if (k === 'x') holdSel();
  else if (k === 'q') toggleSpecial();
  else if (k === 'u' || k === 'z') undo();
  else if (k === 'e') endSunTurn();
  else if (k === 'escape') { mode = 'idle'; aim = null; armed = null; infoUnit = null; update(); }
});

// ---------------------------------------------------------------- HUD
function statLine(u) {
  const s = stats(u);
  return `MOV ${moveRange(G, u)} · PAS ${s.pass} · SHO ${s.shoot} · TKL ${s.tackle} · DRI ${s.dribble}${u.role === 'GK' ? ' · KEEP ' + s.keep : ''}`;
}

// The turn label pulses when the side changes (no toast: it covered the bar).
function pulseTurn() { const el = $('.turn'); el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }

function update() {
  if (!G) return;
  const turn = $('.turn');
  turn.textContent = G.over ? 'Full time' : G.side === 'sun' ? 'Your turn' : 'Redrock turn';
  turn.classList.toggle('red', G.side === 'red');
  $('.clockchip').textContent = `Round ${G.round} · ${clock()} · ends ${G.end > 90 ? '90+' + (G.end - 90) : G.end}'`;

  const u = selU();
  const mine = canAct(u) && !busy;
  const isCarrier = u && carrier(G) === u;
  btn.undo.disabled = busy || !undoStack.length;
  btn.end.disabled = busy || G.side !== 'sun' || G.over;
  btn.hold.disabled = !mine;
  btn.pass.hidden = !(mine && isCarrier);
  btn.shoot.hidden = !(mine && isCarrier);
  const tt = mine ? tackleTarget(u) : null;
  btn.tackle.hidden = !tt;
  if (tt) btn.tackle.innerHTML = `Tackle ${oddsPill(tackleOdds(u, tt))}`;
  if (mine && isCarrier) {
    const so = shotOdds(G, u, { eagle: armed === 'eagle' });
    btn.shoot.innerHTML = `Shoot ${oddsPill(so.p)}`;
    if (mode === 'pass' && aim) {
      const po = passOdds(G, u, aim, { needle: armed === 'needle' });
      btn.pass.innerHTML = po.offside ? 'Kick (offside!)' : `Kick ${oddsPill(po.p)}`;
    } else btn.pass.innerHTML = mode === 'pass' ? 'Pick target' : 'Pass <span class="key">P</span>';
    btn.pass.classList.toggle('pressed', mode === 'pass');
  }
  const left = sunUnits().filter((o) => !o.acted && !o.rest).length;
  btn.end.innerHTML = left && G.side === 'sun' && !G.over ? `End turn <span class="chip left" title="${left} player${left > 1 ? 's' : ''} still to act">${left}</span>` : 'End turn <span class="key">E</span>';

  const info = $('.gt-info');
  const iu = infoUnit ? byUid(infoUnit) : null;
  if (iu) {
    const c = byId[iu.id];
    info.innerHTML = `<img src="${portrait(c, 64)}" alt=""><span><b>${c.name}</b> <span class="st">${c.pos} · Redrock</span><br><span class="st">${statLine(iu)}</span></span>`;
    return;
  }
  if (G.side !== 'sun' || G.over) { info.innerHTML = `<span>${G.over ? 'Full time. Pick a phase above to replay.' : `<b>Redrock:</b> ${lastLine || 'one presses, one covers the lane, the rest hold the line.'}`}</span>`; return; }
  const last = lastResult && mode !== 'pass' ? `<div class="last">Last: ${lastResult}</div>` : '';
  if (!u) { info.innerHTML = `<div class="tx">${last}<div class="tip">${sunUnits().some((o) => o.rest && !o.acted) ? 'Everyone near the ball has acted; the back line holds shape.' : 'Everyone has acted.'} End the turn.</div></div>`; return; }
  const c = byId[u.id];
  let tip;
  if (u.acted) tip = 'Done for this turn.';
  else if (mode === 'pass') {
    if (!aim) tip = 'Tap a teammate, or empty grass for a through ball.';
    else {
      const po = passOdds(G, u, aim, { needle: armed === 'needle' });
      const recv = unitAt(G, aim.x, aim.y);
      if (po.offside) tip = `<b>${name(recv)} is offside.</b> Passing now gives a free kick away.`;
      else tip = `${recv ? 'Pass to ' + name(recv) : 'Through ball'} ${oddsPill(po.p)} · ${po.dist.toFixed(1)} sq${po.interceptors.length ? ` · ${po.interceptors.length} could intercept` : ' · clear line'}${!recv ? ' · ' + runnersFor(aim) : ''}. Tap again to kick.`;
    }
  } else if (isCarrier) {
    const so = shotOdds(G, u);
    const note = so.dist > 4.6 ? ' Too far to shoot well: get inside the box.' : so.angle < 0.7 ? ' Tight angle: cut inside for a better shot.' : '';
    tip = (u.moved ? 'Pass, shoot, or hold.' : 'Move first (blue), or pass/shoot from here.') + note;
  }
  else if (tt) tip = `Next to ${name(tt)}: tackle ${oddsPill(tackleOdds(u, tt))}, or move.`;
  else {
    const cc = carrier(G);
    const near = cc && cc.team === 'red' && cheb(u, cc) <= 1;
    if (near && u.moved) tip = `Next to ${name(cc)}. Tackles need a standing start: if he is still here next turn, you can tackle.`;
    else if (u.rest && !u.moved) tip = 'Holding shape this turn (auto). Tap a blue square only if you want to move him.';
    else tip = u.moved ? 'Hold, or end the turn.' : 'Tap a blue square to move. Red edges stop you.';
  }
  const spKey = Object.keys(SPECIALS).find((k) => SPECIALS[k].who === u.id);
  const sp = spKey && G.specials[spKey] && isCarrier ? `<button class="spbtn sp ${armed === spKey ? 'on' : ''}" title="${SPECIALS[spKey].text} (Q)">⚡ ${SPECIALS[spKey].name}</button>` : '';
  info.innerHTML = `<img src="${portrait(c, 64)}" alt=""><div class="tx">${last}<div class="who"><b>${c.name}</b> <span class="st">${statLine(u)}</span></div><div class="tip">${tip}</div></div>${sp ? `<span class="sp">${sp}</span>` : ''}`;
  info.querySelector('.spbtn')?.addEventListener('click', toggleSpecial);
}

function runnersFor(cell) {
  const rs = sunUnits().filter((o) => !o.acted && !o.moved && o.id !== sel && reach(G, o).has(cell.x + ',' + cell.y));
  return rs.length ? `${rs.map(name).join(', ')} can reach it` : 'no runner can reach it this turn';
}

// ---------------------------------------------------------------- tweens + loop
const tweens = [];
function tween(ms, fn) { return new Promise((res) => tweens.push({ t: 0, ms, fn, res })); }
function wait(ms) { return tween(ms, () => {}); }
let pops = [];
function popAt(u, text, color) {
  const r = canvas.getBoundingClientRect();
  const v = V(u) || u;
  shell.popup(text, r.left + cx(v.x), r.top + feet(v.y) - L.crop - L.size, color);
}

// ?jank=1 dev aid: window.__slow = 0.25 plays every animation at quarter speed.
const DEV = new URLSearchParams(location.search).has('jank');
let last = performance.now();
let lastRaf = last;
function advance(now) {
  const dt = Math.min(0.05, Math.max(0, now - last) / 1000) * (DEV ? window.__slow || 1 : 1);
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
  if (G && L) draw(now / 1000, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// If frames stop (background tab), keep animations and turns moving.
setInterval(() => { const now = performance.now(); if (now - lastRaf > 200) { const dt = advance(now); if (G && L) draw(now / 1000, dt); } }, 50);

// test hook for automated play-throughs
window.__gt = { cell: (x, y) => { const r = canvas.getBoundingClientRect(); return { x: r.left + cx(x), y: r.top + cy(y) - L.crop }; }, vis: () => vis, ball: () => ballVis, G: () => G, busy: () => busy, tap: (x, y) => tapCell(x, y), end: () => endSunTurn(), pass: () => passButton(), shoot: () => shootSel(), hold: () => holdSel(), sel: () => sel };

// ---------------------------------------------------------------- render
function cellFill(x, y, fill, stroke, lw = 2) {
  const px = L.x0 + x * L.cellW, py = L.y0 + y * L.cellH;
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(px + 1, py + 1, L.cellW - 2, L.cellH - 2); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.strokeRect(px + 2, py + 2, L.cellW - 4, L.cellH - 4); }
}

function draw(t, dt) {
  ctx.clearRect(0, 0, L.cw, L.ch);
  ctx.save();
  ctx.translate(0, -L.crop);
  pitch.draw(ctx, t, dt);

  // soft grid
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if ((x + y) % 2) cellFill(x, y, 'rgba(255,255,255,.05)');
  ctx.strokeStyle = 'rgba(255,255,255,.13)'; ctx.lineWidth = 1;
  for (let x = 1; x < COLS; x++) { ctx.beginPath(); ctx.moveTo(L.x0 + x * L.cellW, L.y0); ctx.lineTo(L.x0 + x * L.cellW, L.y0 + ROWS * L.cellH); ctx.stroke(); }
  for (let y = 1; y < ROWS; y++) { ctx.beginPath(); ctx.moveTo(L.x0, L.y0 + y * L.cellH); ctx.lineTo(L.x0 + COLS * L.cellW, L.y0 + y * L.cellH); ctx.stroke(); }

  const u = selU();
  const sunTurn = G.side === 'sun' && !busy && !G.over;
  const c = carrier(G);

  // offside line for whoever has the ball
  const attTeam = c ? c.team : G.ball.through?.team;
  if (attTeam) {
    const row = offsideRow(G, attTeam);
    const ly = attTeam === 'sun' ? L.y0 + row * L.cellH : L.y0 + (row + 1) * L.cellH;
    const midOk = attTeam === 'sun' ? row < MID : row > MID;
    if (midOk) {
      ctx.save(); ctx.setLineDash([7, 5]); ctx.strokeStyle = attTeam === 'sun' ? 'rgba(255,210,63,.9)' : 'rgba(255,138,122,.85)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(L.x0, ly); ctx.lineTo(L.x0 + COLS * L.cellW, ly); ctx.stroke(); ctx.restore();
    }
  }

  // Redrock's ball carrier: how far he can dribble next turn (faint red outline)
  if (sunTurn && c && c.team === 'red') {
    for (const cell of reach(G, { ...c, moved: false, acted: false, dazed: 0 }).values()) cellFill(cell.x, cell.y, null, 'rgba(255,110,90,.55)', 1.5);
  }
  if (sunTurn && u && !u.acted) {
    // threat: squares next to opponents
    const z = zoc(G, 'sun');
    for (const key of z) { const [x, y] = key.split(',').map(Number); if (x >= 0 && x < COLS && y >= 0 && y < ROWS && !unitAt(G, x, y)) cellFill(x, y, 'rgba(232,70,58,.22)'); }
    if (mode !== 'pass') {
      for (const cell of reach(G, u).values()) cellFill(cell.x, cell.y, 'rgba(80,185,255,.5)', cell.stopped ? 'rgba(255,90,74,.95)' : 'rgba(255,255,255,.8)');
    }
    cellFill(u.x, u.y, null, '#FFD23F', 2.5);
  }

  // pass preview
  let passPreview = null;
  if (sunTurn && u && mode === 'pass') {
    for (const m of sunUnits()) if (m !== u) {
      const po = passOdds(G, u, m, { needle: armed === 'needle' });
      drawArrow(ctx, cx(u.x), cy(u.y), cx(m.x), cy(m.y), aim && aim.x === m.x && aim.y === m.y ? '#fff' : 'rgba(255,255,255,.3)', { dash: [4, 5], width: 2, head: 6 });
      if (!aim) passPreview = passPreview || [];
      if (!aim) passPreview.push({ m, po });
    }
    if (aim) {
      const po = passOdds(G, u, aim, { needle: armed === 'needle' });
      drawArrow(ctx, cx(u.x), cy(u.y), cx(aim.x), cy(aim.y), '#fff', { width: 3.5, head: 9 });
      if (!unitAt(G, aim.x, aim.y)) cellFill(aim.x, aim.y, 'rgba(255,255,255,.25)', '#fff');
      for (const it of po.interceptors) {
        ctx.save(); ctx.strokeStyle = '#ff3b2f'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(cx(it.x), feet(it.y), L.size * 0.38, L.size * 0.16, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
      passPreview = { aim, po };
    }
  }

  const br = Math.max(4, L.size * 0.12);
  // loose ball
  if (!c && !ballVis) { const p = ballPx(loosePt(G.ball.x, G.ball.y)); ctx.save(); ctx.globalAlpha = sceneA; drawBall(ctx, p.x, p.y, br, t, Math.abs(Math.sin(t * 4)) * 3); ctx.restore(); }

  // sprites
  const list = [...G.units].sort((a, b) => V(a).y - V(b).y);
  for (const o of list) {
    const v = V(o);
    v.face = v.face ?? v.facing;
    v.face += (v.facing - v.face) * Math.min(1, dt * 16); // ball swaps feet smoothly when he turns
    const x = cx(v.x), y = feet(v.y);
    const glow = o.id === sel && G.side === 'sun' && !G.over ? '#FFD23F' : null;
    const done = o.team === G.side && o.acted && !busy;
    const resting = G.side === 'sun' && o.team === 'sun' && o.rest && !o.acted && !busy;
    drawPlayer(ctx, byId[o.id], x, y, { size: L.size, pose: v.pose, lay: v.lay, t, facing: v.facing, glow, alpha: (done || resting ? 0.78 : 1) * sceneA });
    if (o.id === G.ball.owner && !ballVis) { const p = ballPx(footPt(v)); ctx.save(); ctx.globalAlpha = sceneA; drawBall(ctx, p.x, p.y, br, t * 2); ctx.restore(); }
    if (o.dazed) {
      ctx.save(); ctx.fillStyle = '#FFD23F'; ctx.font = '700 10px system-ui';
      for (let i = 0; i < 3; i++) { const a = t * 4 + i * 2.1; ctx.fillText('★', x + Math.cos(a) * 9 - 4, y - L.size * 0.95 + Math.sin(a) * 3); }
      ctx.restore();
    }
  }
  if (ballVis) { const p = ballPx(ballVis); ctx.save(); ctx.globalAlpha = sceneA; drawBall(ctx, p.x, p.y, br, ballVis.spin, ballVis.h); ctx.restore(); }
  pitch.drawFront(ctx, t);

  // overlays above the lights
  if (attTeam) {
    const row = offsideRow(G, attTeam);
    const midOk = attTeam === 'sun' ? row < MID : row > MID;
    if (midOk) {
      const ly = attTeam === 'sun' ? L.y0 + row * L.cellH : L.y0 + (row + 1) * L.cellH;
      tag(L.x0 + COLS * L.cellW - 26, ly, 'OFFSIDE', attTeam === 'sun' ? '#E0A800' : '#B42D23');
    }
  }
  if (sunTurn && u && !u.acted) {
    if (carrier(G) === u) {
      const so = shotOdds(G, u, { eagle: armed === 'eagle' });
      drawOdds(ctx, cx(GOAL_C), L.y0 - pitch.netDepth * 0.4, so.p, so.dist > 4.6 ? 'Too far' : so.angle < 0.7 ? 'Tight angle' : 'Shot');
    }
    const tt = tackleTarget(u);
    if (tt) drawOdds(ctx, cx(tt.x), feet(tt.y) - L.size - 4, tackleOdds(u, tt), 'Tackle');
  }
  if (passPreview) {
    if (Array.isArray(passPreview)) for (const { m, po } of passPreview) {
      if (po.offside) tag(cx(m.x), feet(m.y) - L.size - 4, 'OFFSIDE', '#B42D23');
      else drawOdds(ctx, cx(m.x), feet(m.y) - L.size - 4, po.p);
    } else {
      const { aim: a, po } = passPreview;
      if (po.offside) tag(cx(a.x), cy(a.y) - L.cellH * 0.6, 'OFFSIDE', '#B42D23');
      else drawOdds(ctx, cx(a.x), cy(a.y) - L.cellH * 0.62, po.p, unitAt(G, a.x, a.y) ? 'Pass' : 'Through');
      for (const it of po.interceptors) tag(cx(it.x), feet(it.y) - L.size - 2, '!', '#ff3b2f');
    }
  }
  if (showCursor && G.side === 'sun') {
    const px = L.x0 + cursor.x * L.cellW, py = L.y0 + cursor.y * L.cellH, s = 7;
    ctx.save(); ctx.strokeStyle = '#FFD23F'; ctx.lineWidth = 3;
    for (const [ax, ay, dx, dy] of [[px, py, 1, 1], [px + L.cellW, py, -1, 1], [px, py + L.cellH, 1, -1], [px + L.cellW, py + L.cellH, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(ax + dx * 2, ay + dy * (s + 2)); ctx.lineTo(ax + dx * 2, ay + dy * 2); ctx.lineTo(ax + dx * (s + 2), ay + dy * 2); ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

function tag(x, y, text, bg) {
  ctx.save();
  ctx.font = '700 9px "Lilita One", system-ui';
  const w = ctx.measureText(text).width + 8;
  ctx.fillStyle = bg; ctx.strokeStyle = '#1b1b2f'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.rect(x - w / 2, y - 7, w, 14); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 0.5);
  ctx.restore();
}
