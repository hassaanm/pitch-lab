// Grid Tactics: Advance Wars / Into the Breach football on a 7x11 grid.
// Pure rules and the AI live in logic.js; this file renders, animates and
// handles input.
import { Shell, oddsPill } from '../../shared/shell.js';
import { Pitch, drawPlayer, drawBall, drawArrow, drawOdds, setupCanvas, portrait, lerp, ease } from '../../shared/art.js';
import { byId } from '../../shared/cast.js';
import { sfx } from '../../shared/sfx.js';
import {
  COLS, ROWS, MID, GOAL_C, cheb, unitAt, carrier, ballPos, moveRange, zoc, reach, offsideRow, isOffside,
  passOdds, shotOdds, tackleOdds, aiPlan, afterDribble, stats, name,
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
  pitch: 'Football as a tactics board. Move all five, then pass, shoot or tackle. Every risk shows its odds first.',
  how: [
    'Tap a yellow player, then a blue square to move (range from pace; the ball carrier is 1 slower unless a great dribbler).',
    'Moving next to an opponent stops you (red-edged squares).',
    'After moving: <b>Pass</b> (pick a teammate or an empty square for a through ball), <b>Shoot</b>, <b>Tackle</b> an adjacent carrier, or <b>Hold</b>.',
    'Red rings show who could intercept a pass. The dashed line is offside: a teammate past it (and past the ball) when you pass is flagged.',
    'Through ball: pass into space, then move a runner who has not moved yet onto the ball.',
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

function startPhase(id) {
  phaseId = id;
  const P = PHASES[id];
  G = {
    units: makeUnits(P.setup), ball: { owner: P.setup.ball, x: 0, y: 0, through: null },
    side: 'sun', round: 1, minute: P.minute, end: P.end, score: { sun: P.score[0], red: P.score[1] },
    specials: { ...P.specials }, over: false,
  };
  sel = null; mode = 'idle'; aim = null; armed = null; undoStack = []; infoUnit = null; busy = false;
  layout();
  snapVis();
  updateScore();
  shell.log(P.intro, 'info', clock());
  startSunTurn(true);
}

function snapVis() {
  vis.clear();
  for (const u of G.units) vis.set(u.id, { x: u.x, y: u.y, pose: u.role === 'GK' ? 'ready' : 'idle', facing: u.team === 'sun' ? 1 : -1 });
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
  const avail = Math.max(420, innerHeight - top - 112);
  const cellH = Math.max(cellW * 0.78, Math.min(cellW * 1.02, (avail - 48) / ROWS));
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

// ---------------------------------------------------------------- turn flow
function startSunTurn(first) {
  G.side = 'sun';
  for (const u of sunUnits()) {
    u.moved = u.acted = false;
    if (u.dazed) { u.moved = u.acted = true; u.dazed--; shell.log(`${name(u)} is still on the floor and sits this turn out.`, 'bad', clock()); }
  }
  undoStack = []; mode = 'idle'; aim = null; armed = null; infoUnit = null;
  const c = carrier(G);
  sel = c && c.team === 'sun' && !c.acted ? c.id : null;
  if (!sel) {
    const bp = ballPos(G);
    const near = sunUnits().filter((u) => !u.acted).sort((a, b) => cheb(a, bp) - cheb(b, bp))[0];
    sel = near?.id || null;
  }
  if (sel) cursor = { x: selU().x, y: selU().y };
  if (!first) { sfx.whistle(); shell.toast(`Your turn · ${clock()}`, 1200); }
  update();
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
  shell.toast('Redrock are moving…', 1000);
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
    if (plan.move) await doMove(u, plan.move);
    if (G.goalPending) break;
    let act = plan.act;
    if (act?.t === 'after-dribble') act = carrier(G) === u ? afterDribble(G, u) : null;
    if (act?.t === 'tackle') { const c = carrier(G); if (c && c.team === 'sun' && cheb(u, c) <= 1) await doTackle(u, c); }
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
  await wait(900);
  // kick-off: the side that conceded restarts
  const ko = KICKOFF[conceded];
  for (const [team, list] of [['sun', ko.sun], ['red', ko.red]]) for (const [id, x, y] of list) { const u = byUid(id); u.x = x; u.y = y; u.dazed = 0; }
  G.ball = { owner: ko.ball, x: 0, y: 0, through: null };
  await animateSnap(500);
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
async function doMove(u, cell) {
  const v = V(u);
  const path = cell.path?.length ? cell.path : [{ x: cell.x, y: cell.y }];
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
  if (cell.stopped && u.team === 'sun') shell.log(`${name(u)} is stopped next to an opponent.`, u.team === 'sun' ? 'info' : 'them', clock());
  // loose ball pickup
  if (!G.ball.owner && G.ball.x === u.x && G.ball.y === u.y) {
    const th = G.ball.through;
    G.ball = { owner: u.id, x: 0, y: 0, through: null };
    sfx.thud();
    if (th && th.team === u.team && !th.onside.includes(u.id)) {
      await offsideCall(u);
    } else {
      shell.log(`${name(u)} collects the ${th && th.team === u.team ? 'through ball' : 'loose ball'}.`, u.team === 'sun' ? 'good' : 'them', clock());
      popAt(u, th && th.team === u.team ? 'Through!' : 'Got it', '#fff');
    }
  }
}

async function offsideCall(u) {
  sfx.whistle(2);
  const foes = G.units.filter((o) => o.team !== u.team && o.role !== 'GK').sort((a, b) => cheb(a, u) - cheb(b, u));
  const taker = foes[0];
  G.ball = { owner: taker.id, x: 0, y: 0, through: null };
  popAt(u, 'OFFSIDE', '#FFD23F');
  shell.banner('OFFSIDE', `${name(u)} was past the line`, '#FFD23F');
  shell.log(`Offside! ${name(u)} was beyond the second-last defender when the ball was played. Free kick to ${taker.team === 'sun' ? 'Sunbirds' : 'Redrock'} (${name(taker)}).`, 'bad', clock());
  u.acted = true;
  await wait(600);
}

async function flyBall(from, to, ms, arc) {
  ballVis = { x: from.x, y: from.y, h: 0, spin: 0 };
  await tween(ms, (k) => {
    ballVis.x = lerp(from.x, to.x, k); ballVis.y = lerp(from.y, to.y, k);
    ballVis.h = Math.sin(Math.PI * k) * arc; ballVis.spin = k * 14;
  });
  ballVis = null;
}

async function doPass(u, to, { needle }) {
  const po = passOdds(G, u, to, { needle });
  const recv = unitAt(G, to.x, to.y);
  const isThrough = !recv;
  const v = V(u);
  v.pose = 'pass'; v.facing = to.x >= u.x ? 1 : -1;
  sfx.pass();
  u.acted = true; u.moved = true;
  const team = u.team;
  const tag = team === 'sun' ? '' : 'them';
  if (needle) { await shell.cutIn(byId[u.id], 'NEEDLE PASS', 'Kenji threads it'); G.specials.needle--; }
  if (po.offside) {
    await flyBall(u, to, 260 + po.dist * 50, 4 + po.dist * 3);
    v.pose = 'idle';
    await offsideCall(recv);
    return;
  }
  const roll = Math.random();
  const ok = roll < po.p;
  const label = `${name(u)} → ${recv ? name(recv) : 'space'} ${pct(po.p)}`;
  if (ok) {
    await flyBall(u, to, 240 + po.dist * 55, 4 + po.dist * 3);
    sfx.thud();
    if (recv) {
      G.ball = { owner: recv.id, x: 0, y: 0, through: null };
      popAt(recv, pct(po.p) + ' ✓', '#8ef58e');
      shell.log(`${label}: complete.`, team === 'sun' ? 'good' : tag, clock());
    } else {
      const onside = G.units.filter((o) => o.team === team && !isOffside(G, o, { x: u.x, y: u.y })).map((o) => o.id);
      G.ball = { owner: null, x: to.x, y: to.y, through: { team, onside } };
      shell.log(`${label}: through ball into space. A runner must reach it.`, team === 'sun' ? 'good' : tag, clock());
    }
  } else if (po.interceptors.length) {
    const it = po.interceptors[0];
    await flyBall(u, it, 200 + po.dist * 40, 3 + po.dist * 2);
    G.ball = { owner: it.id, x: 0, y: 0, through: null };
    V(it).pose = 'header'; setTimeout(() => { V(it).pose = 'idle'; }, 500);
    sfx.bad(); shell.shake();
    popAt(it, 'INTERCEPTED', '#ff8a7a');
    shell.log(`${label}: rolled ${Math.round(roll * 100)}, missed. ${name(it)} was standing near the line and cuts it out.`, team === 'sun' ? 'bad' : 'good', clock());
  } else {
    // overhit: runs one square past the target
    const dx = Math.sign(to.x - u.x), dy = Math.sign(to.y - u.y);
    let land = { x: Math.max(0, Math.min(COLS - 1, to.x + dx)), y: Math.max(0, Math.min(ROWS - 1, to.y + dy)) };
    if (unitAt(G, land.x, land.y)) land = { x: to.x, y: to.y };
    await flyBall(u, land, 260 + po.dist * 55, 6 + po.dist * 3);
    const who = unitAt(G, land.x, land.y);
    if (who) G.ball = { owner: who.id, x: 0, y: 0, through: null };
    else G.ball = { owner: null, x: land.x, y: land.y, through: null };
    sfx.bad();
    shell.log(`${label}: rolled ${Math.round(roll * 100)}, overhit. The ball runs loose.`, team === 'sun' ? 'bad' : tag, clock());
  }
  v.pose = 'idle';
}

async function doShoot(u, { eagle }) {
  if (eagle) { await shell.cutIn(byId[u.id], 'EAGLE STRIKE', 'Rio finds the corner'); G.specials.eagle--; }
  const so = shotOdds(G, u, { eagle });
  const v = V(u);
  v.pose = 'kick'; v.facing = GOAL_C >= u.x ? 1 : -1;
  u.acted = u.moved = true;
  const up = u.team === 'sun';
  const roll = Math.random();
  const goal = roll < so.p;
  const gy = up ? -0.75 : ROWS - 0.25;
  const target = { x: GOAL_C + (Math.random() - 0.5) * 2.2, y: gy };
  sfx.kick();
  const gk = so.gk;
  const gkv = gk ? V(gk) : null;
  const gx0 = gkv?.x, gy0 = gkv?.y;
  const diveTo = goal ? (target.x < GOAL_C ? GOAL_C + 0.9 : GOAL_C - 0.9) : target.x;
  const why = [`from ${so.dist.toFixed(1)} squares`];
  if (so.keeperSet) why.push(`keeper set −${Math.round(so.keeperPen * 100)}%`);
  if (so.pressure) why.push(`${so.pressure} defender${so.pressure > 1 ? 's' : ''} close −${so.pressure * 12}%`);
  if (eagle) why.push('Eagle Strike +20%');
  ballVis = { x: u.x, y: u.y, h: 0, spin: 0 };
  await tween(420, (k) => {
    ballVis.x = lerp(u.x, target.x, k); ballVis.y = lerp(u.y, target.y, k);
    ballVis.h = Math.sin(Math.PI * k) * 14; ballVis.spin = k * 22;
    if (gkv && k > 0.3) {
      const kk = ease(Math.min(1, (k - 0.3) / 0.55));
      gkv.pose = 'dive'; gkv.facing = diveTo >= gx0 ? 1 : -1;
      gkv.x = lerp(gx0, Math.max(gx0 - 1.2, Math.min(gx0 + 1.2, diveTo)), kk);
    }
  });
  if (goal) {
    ballVis.h = 0;
    pitch.goal(up);
    shell.shake();
    if (up) {
      G.score.sun++;
      sfx.goal(); shell.banner('GOAL!', name(u)); shell.confetti(); shell.flash('#FFD23F');
      for (const o of G.units) V(o).pose = o.team === 'sun' ? 'celebrate' : 'sad';
      shell.log(`GOAL! ${name(u)} scores. Shot ${pct(so.p)} (${why.join(', ')}), rolled ${Math.round(roll * 100)}.`, 'goal', clock());
    } else {
      G.score.red++;
      sfx.groan(); shell.banner('GOAL', `${name(u)} for Redrock`, '#ff8a7a');
      for (const o of G.units) V(o).pose = o.team === 'red' ? 'celebrate' : 'sad';
      shell.log(`Redrock score: ${name(u)}. Shot ${pct(so.p)} (${why.join(', ')}).`, 'bad', clock());
    }
    updateScore();
    G.goalPending = up ? 'red' : 'sun'; // who kicks off next = who conceded
    await wait(1200);
    ballVis = null;
    return;
  }
  ballVis = null;
  if (gk) {
    G.ball = { owner: gk.id, x: 0, y: 0, through: null };
    sfx.save();
    popAt(gk, so.keeperSet ? 'SAVED' : 'WIDE', '#fff');
    shell.log(`${name(u)} shoots ${pct(so.p)} (${why.join(', ')}): rolled ${Math.round(roll * 100)}. ${so.keeperSet ? `${name(gk)} saves.` : 'Wide. Goal kick.'}`, up ? 'bad' : 'good', clock());
    await wait(450);
    if (gkv) { gkv.pose = 'ready'; await tween(220, (k) => { gkv.x = lerp(gkv.x, gk.x, k); gkv.y = lerp(gkv.y, gk.y, k); }); }
  }
  v.pose = 'idle';
}

async function doTackle(t, c) {
  const p = tackleOdds(t, c);
  const tv = V(t), cv = V(c);
  t.acted = t.moved = true;
  const from = { x: tv.x, y: tv.y };
  tv.pose = 'slide'; tv.facing = c.x >= t.x ? 1 : -1;
  sfx.whoosh();
  await tween(170, (k) => { tv.x = lerp(from.x, (from.x * 0.4 + c.x * 0.6), k); tv.y = lerp(from.y, (from.y * 0.4 + c.y * 0.6), k); });
  const roll = Math.random();
  const label = `${name(t)} tackles ${name(c)} ${pct(p)}`;
  if (roll < p) {
    hitstop = 0.16;
    sfx.thud(); shell.shake();
    G.ball = { owner: t.id, x: 0, y: 0, through: null };
    cv.pose = 'sad';
    popAt(t, 'WON IT', t.team === 'sun' ? '#8ef58e' : '#ff8a7a');
    shell.log(`${label}: rolled ${Math.round(roll * 100)}, clean. Tackle ${stats(t).tackle} vs dribble ${stats(c).dribble}.`, t.team === 'sun' ? 'good' : 'bad', clock());
    await wait(380);
  } else {
    t.dazed = 1;
    sfx.ooh();
    tv.pose = 'sad';
    popAt(c, 'SKINNED', t.team === 'sun' ? '#ff8a7a' : '#8ef58e');
    shell.log(`${label}: rolled ${Math.round(roll * 100)}, beaten. ${name(t)} is on the floor and misses next turn.`, t.team === 'sun' ? 'bad' : 'good', clock());
    await wait(380);
  }
  await tween(160, (k) => { tv.x = lerp(tv.x, t.x, k); tv.y = lerp(tv.y, t.y, k); });
  tv.pose = 'idle'; cv.pose = 'idle';
}

async function animateSnap(ms) {
  const starts = new Map([...vis].map(([id, v]) => [id, { x: v.x, y: v.y }]));
  for (const u of G.units) V(u).pose = 'run';
  await tween(ms, (k) => { for (const u of G.units) { const s = starts.get(u.id), v = V(u); v.x = lerp(s.x, u.x, ease(k)); v.y = lerp(s.y, u.y, ease(k)); } });
  for (const u of G.units) { V(u).pose = u.role === 'GK' ? 'ready' : 'idle'; V(u).facing = u.team === 'sun' ? 1 : -1; }
}

// ---------------------------------------------------------------- player actions
const clone = (o) => JSON.parse(JSON.stringify(o));
function pushUndo() { undoStack.push({ G: clone(G), sel }); }
function lockUndo() { undoStack = []; }

function undo() {
  if (busy || !undoStack.length) return;
  const s = undoStack.pop();
  G = s.G; sel = s.sel; mode = 'idle'; aim = null;
  snapVis(); sfx.whoosh();
  shell.log('Undo.', 'info', clock());
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
  return u && c && c.team === 'red' && cheb(u, c) <= 1 ? c : null;
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
  const free = sunUnits().filter((o) => !o.acted).sort((a, b) => (tackleTarget(b) ? 1 : 0) - (tackleTarget(a) ? 1 : 0) || cheb(a, bp) - cheb(b, bp));
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
  const left = sunUnits().filter((o) => !o.acted).length;
  btn.end.innerHTML = left && G.side === 'sun' ? `End turn <span class="chip" style="font-size:11px;padding:0 6px">${left} left</span>` : 'End turn <span class="key">E</span>';

  const info = $('.gt-info');
  const iu = infoUnit ? byUid(infoUnit) : null;
  if (iu) {
    const c = byId[iu.id];
    info.innerHTML = `<img src="${portrait(c, 64)}" alt=""><span><b>${c.name}</b> <span class="st">${c.pos} · Redrock</span><br><span class="st">${statLine(iu)}</span></span>`;
    return;
  }
  if (G.side !== 'sun' || G.over) { info.innerHTML = `<span>${G.over ? 'Full time. Pick a phase above to replay.' : 'Redrock are moving. Watch their shape: one presses, one covers, the rest hold the line.'}</span>`; return; }
  if (!u) { info.innerHTML = '<span>Everyone has acted. End the turn (E).</span>'; return; }
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
  } else if (isCarrier) tip = u.moved ? 'Pass, shoot, or hold.' : 'Move first (blue), or pass/shoot from here.';
  else if (tt) tip = `Adjacent to ${name(tt)}: tackle ${oddsPill(tackleOdds(u, tt))}.`;
  else tip = u.moved ? 'Hold, or tackle if next to the carrier.' : 'Tap a blue square to move. Red edges stop you.';
  const spKey = Object.keys(SPECIALS).find((k) => SPECIALS[k].who === u.id);
  const sp = spKey && G.specials[spKey] && isCarrier ? `<button class="spbtn sp ${armed === spKey ? 'on' : ''}" title="${SPECIALS[spKey].text} (Q)">⚡ ${SPECIALS[spKey].name}</button>` : '';
  info.innerHTML = `<img src="${portrait(c, 64)}" alt=""><span><b>${c.name}</b> <span class="st">${statLine(u)}</span><br>${tip}</span>${sp ? `<span class="sp">${sp}</span>` : ''}`;
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
  shell.popup(text, r.left + cx(u.x), r.top + feet(u.y) - L.crop - L.size, color);
}

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
  if (G && L) draw(now / 1000, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// If frames stop (background tab), keep animations and turns moving.
setInterval(() => { const now = performance.now(); if (now - lastRaf > 200) advance(now); }, 50);

// test hook for automated play-throughs
window.__gt = { G: () => G, busy: () => busy, tap: (x, y) => tapCell(x, y), end: () => endSunTurn(), pass: () => passButton(), shoot: () => shootSel(), hold: () => holdSel(), sel: () => sel };

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

  // loose ball
  if (!c && !ballVis) drawBall(ctx, cx(G.ball.x), cy(G.ball.y) + L.cellH * 0.15, Math.max(4, L.size * 0.12), t, Math.abs(Math.sin(t * 4)) * 3);

  // sprites
  const list = [...G.units].sort((a, b) => V(a).y - V(b).y);
  for (const o of list) {
    const v = V(o);
    const x = cx(v.x), y = feet(v.y);
    const glow = o.id === sel && G.side === 'sun' && !G.over ? '#FFD23F' : null;
    const done = o.team === G.side && o.acted && !busy;
    drawPlayer(ctx, byId[o.id], x, y, { size: L.size, pose: v.pose, t, facing: v.facing, glow, alpha: done ? 0.78 : 1 });
    if (o.id === G.ball.owner && !ballVis) drawBall(ctx, x + L.size * 0.22 * v.facing, y - 1, Math.max(4, L.size * 0.12), t * 2);
    if (o.dazed) {
      ctx.save(); ctx.fillStyle = '#FFD23F'; ctx.font = '700 10px system-ui';
      for (let i = 0; i < 3; i++) { const a = t * 4 + i * 2.1; ctx.fillText('★', x + Math.cos(a) * 9 - 4, y - L.size * 0.95 + Math.sin(a) * 3); }
      ctx.restore();
    }
  }
  if (ballVis) drawBall(ctx, cx(ballVis.x), cy(ballVis.y) + L.cellH * 0.2, Math.max(4, L.size * 0.12), ballVis.spin, ballVis.h);
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
      drawOdds(ctx, cx(GOAL_C), L.y0 - pitch.netDepth * 0.4, so.p, 'Shot');
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
