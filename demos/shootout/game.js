// Shootout Minds — penalties as rock-paper-scissors with memory.
import { Shell, oddsPill, pick } from '../../shared/shell.js';
import { sfx } from '../../shared/sfx.js';
import { byId, crestSVG } from '../../shared/cast.js';
import { drawPlayer, drawBall, setupCanvas, portrait, lerp, ease } from '../../shared/art.js';
import {
  COLS, COL_SHORT, cellName, TELL_TRUTH, onTarget, Oskar, KICKERS,
  kickerPrior, kickerPosterior, stopOdds, sampleKick, resolveKick,
} from './brain.js';

const OURS = ['rio', 'kenji', 'bruno', 'pip', 'sol', 'lupe', 'ada', 'tomo', 'mo', 'wak'];
const THEIRS = ['viper', 'kofi', 'marisol', 'zed', 'rocco', 'nils', 'hans', 'lu', 'dima', 'oskar'];

const PHASES = [
  { id: 'early', label: 'First kick', sub: 'Round 1 · 0–0' },
  { id: 'mid', label: 'Round 4', sub: '2–2 · notes' },
  { id: 'clutch', label: 'Sudden death', sub: '4–4 · night' },
];
const shell = new Shell({
  id: 'shootout',
  title: 'Shootout Minds',
  pitch: 'Penalties as mind games. Big Oskar learns where you shoot; Redrock kickers have habits and tells.',
  how: [
    '<b>Shooting:</b> tap one of 6 spots (3 columns × top/low), pick <b>Placed</b> or <b>Power</b>, then <b>Shoot!</b> Power is harder to save but can go over or wide.',
    'Big Oskar keeps a notebook of your kicks and dives where you usually go. He stays in the middle more than you might think. Peek at his notes with <b>📓</b> (N) or the <b>🔥</b> heat-map (V).',
    'Low down the middle can still hit the trailing legs of a keeper who dives to a side.',
    '<b>In goal (Wak):</b> nothing is picked for you. Read the tell (eyes / run-up, true ~65% of the time), tap a spot to cover, then <b>Dive!</b>',
    'Each % already counts what you can see: Oskar\'s notes, the kicker\'s habit, and the tell. After each kick the panel shows the % you had.',
    'Five kicks each, then sudden death. In sudden death the tally shows the latest five rounds, and the keepers take a kick too.',
    'Keys: arrows pick the spot, 1 Placed / 2 Power, Enter or Space to commit.',
  ],
  notice: 'Does a learning opponent turn a coin flip into reading? Watch whether you start shooting against your own habits.',
  phases: PHASES,
  onPhase: (id) => startPhase(id),
});

const root = shell.stage;
root.innerHTML = `
<div class="so">
  <div class="tally panel dark">
    <div class="trows"><div class="trow" data-t="us"></div><div class="trow" data-t="them"></div></div>
    <div class="round"></div>
  </div>
  <div class="scene">
    <canvas></canvas>
    <div class="cells"></div>
    <div class="bubble" hidden></div>
    <div class="who"></div>
  </div>
  <div class="ctl panel">
    <div class="oddsline"></div>
    <div class="sm-actions"></div>
  </div>
</div>`;
const $ = (s) => root.querySelector(s);
const cv = $('canvas'), cellsEl = $('.cells'), bubble = $('.bubble'), whoEl = $('.who');
const oddsEl = $('.oddsline'), actEl = $('.sm-actions');

// ------------------------------------------------------------------ scene geometry
let W = 370, H = 300, ctx;
let G = {}; // goal geometry
const tweens = [];
let T = 0, lastNow = 0, freezeUntil = 0;
let crowd = [];
let ripple = { a: 0, x: 0, y: 0 };
let excite = 0;
const actors = { keeper: null, kicker: null }; // the two players taking part in the current kick
let cast = []; // everyone on screen, including players walking off
const ball = { x: 0, y: 0, r: 9, h: 0, spin: 0, vis: false, alpha: 1, held: null, behind: null };
// Dev aid: ?jank=1 exposes window.__slow (e.g. 0.25) to watch contacts in slow motion.
const DEV = new URLSearchParams(location.search).has('jank');
// Dev aid (?jank=1 only): window.__force = { out: {res, how}, dive?: {col,row}, kick?: {col,row,type} } scripts the next kick.
if (DEV) window.__state = () => ({ cast: cast.map((a) => ({ id: a.char.id, role: a.role, x: Math.round(a.x), y: Math.round(a.y), pose: a.pose, alpha: a.alpha })), ball: { ...ball, held: ball.held?.char.id }, tweens: tweens.length });
const takeForce = () => { if (!DEV || !window.__force) return null; const f = window.__force; window.__force = null; return f; };

function layout() {
  W = Math.round(Math.min(Math.max(root.clientWidth, 300), 620));
  H = Math.round(W * (W < 480 ? 0.86 : 0.7));
  ctx = setupCanvas(cv, W, H);
  cv.style.width = '100%'; cv.style.height = 'auto';
  G = { x0: W * 0.12, x1: W * 0.88, y0: H * 0.2, y1: H * 0.56, depth: H * 0.06 };
  G.w = G.x1 - G.x0; G.h = G.y1 - G.y0;
  G.spot = { x: W / 2, y: H * 0.84 };
  // crowd in the stand behind the goal
  crowd = [];
  const cols = ['#FFD23F', '#FFE680', '#E8463A', '#F06A5E', '#FFFFFF', '#1D2B53', '#F6D5BE', '#A86B43', '#6E4228', '#FFD23F'];
  let n = 1; const r = () => { const x = Math.sin(n++ * 9301 + 49297) * 233280; return x - Math.floor(x); };
  for (let y = 6; y < G.y0 - 10; y += 7) for (let x = 2; x < W; x += 7) crowd.push({ x: x + (r() - 0.5) * 3, y, c: cols[(r() * cols.length) | 0], p: r() * 6.28, k: 0.6 + r() * 0.8 });
  // DOM cells over the goal mouth
  cellsEl.style.left = (G.x0 / W) * 100 + '%';
  cellsEl.style.width = (G.w / W) * 100 + '%';
  cellsEl.style.top = (G.y0 / H) * 100 + '%';
  cellsEl.style.height = (G.h / H) * 100 + '%';
}
const cellPt = (c, r) => ({ x: G.x0 + G.w * (c + 0.5) / 3 + (c - 1) * G.w * 0.05, y: G.y0 + G.h * (r === 0 ? 0.24 : 0.78) });

function tween(o, to, dur, opt = {}) {
  return new Promise((res) => {
    const from = {}; for (const k in to) from[k] = o[k];
    tweens.push({ o, from, to, dur: Math.max(0.01, dur), t: 0, e: opt.ease || ease, arc: opt.arc || 0, res });
  });
}
const linear = (k) => k;
function stepTweens(dt) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i]; tw.t += dt;
    const k = Math.min(1, tw.t / tw.dur), v = tw.e(k);
    for (const key in tw.to) tw.o[key] = lerp(tw.from[key], tw.to[key], v);
    if (tw.arc) tw.o.h = tw.arc * Math.sin(Math.PI * k);
    if (k >= 1) { tweens.splice(i, 1); tw.res(); }
  }
}
const VAR = {
  day: { sky: ['#3d5a99', '#2E3A59'], g1: '#5DBB4C', g2: '#52AE43', tint: null },
  dusk: { sky: ['#6b4a7a', '#3B2E4A'], g1: '#59AE48', g2: '#4E9F3F', tint: 'rgba(255,140,60,.12)' },
  night: { sky: ['#0b1024', '#141A2E'], g1: '#3E9A45', g2: '#378C3E', tint: 'rgba(10,20,60,.22)', lights: true },
};

function frame(now, fromTimer) {
  if (!fromTimer) requestAnimationFrame(frame);
  if (!ctx || !S) return;
  let dt = Math.min(0.05, (now - lastNow) / 1000) * (DEV ? (window.__slow ?? 1) : 1); lastNow = now;
  if (now < freezeUntil) dt = 0;
  T += dt; stepTweens(dt);
  ripple.a *= Math.pow(0.03, dt); excite *= Math.pow(0.35, dt);
  ball.spin += dt * 10;
  const V = VAR[S.variant];
  // stand
  const sg = ctx.createLinearGradient(0, 0, 0, G.y0);
  sg.addColorStop(0, V.sky[0]); sg.addColorStop(1, V.sky[1]);
  ctx.fillStyle = sg; ctx.fillRect(0, 0, W, H);
  for (const p of crowd) {
    const hop = Math.max(0, Math.sin(T * (4 + excite * 7) * p.k + p.p)) * (0.6 + excite * 3.5);
    ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y - hop, 2.7, 0, 6.29); ctx.fill();
  }
  // ad boards
  const ay = G.y0 - G.depth - 12;
  ctx.fillStyle = '#1D2B53'; ctx.fillRect(0, ay, W, 12);
  ctx.fillStyle = '#FFD23F'; ctx.font = '700 9px "Lilita One", system-ui'; ctx.textBaseline = 'middle';
  for (let x = ((-T * 30) % 120) - 120; x < W; x += 120) { ctx.fillText('PITCH LAB', x + 6, ay + 6.5); ctx.fillStyle = '#E8463A'; ctx.fillText('REDROCK', x + 70, ay + 6.5); ctx.fillStyle = '#FFD23F'; }
  // grass with perspective stripes
  const gTop = ay + 12;
  for (let i = 0; i < 9; i++) {
    const y0 = gTop + (H - gTop) * Math.pow(i / 9, 1.35), y1 = gTop + (H - gTop) * Math.pow((i + 1) / 9, 1.35);
    ctx.fillStyle = i % 2 ? V.g1 : V.g2; ctx.fillRect(0, y0, W, y1 - y0 + 1);
  }
  // box lines
  ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, G.y1); ctx.lineTo(W, G.y1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(G.x0 - W * 0.08, G.y1); ctx.lineTo(G.x0 - W * 0.14, H * 0.72); ctx.lineTo(G.x1 + W * 0.14, H * 0.72); ctx.lineTo(G.x1 + W * 0.08, G.y1); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.ellipse(G.spot.x, G.spot.y + 6, 6, 2.5, 0, 0, 6.29); ctx.fill();
  drawNet();
  // keepers, then ball (if behind them), posts, ball, kickers
  if (ball.held) { const p = holdPt(ball.held); ball.x = p.x; ball.y = p.y; ball.h = 0; ball.alpha = ball.held.alpha ?? 1; }
  const ballBehind = ball.behind ?? (ball.y < G.y1 + 2 && ball.r < 6.5);
  const drawB = () => {
    if (!ball.vis || ball.alpha <= 0.02) return;
    ctx.save(); ctx.globalAlpha = ball.alpha;
    if (ball.halo) { // a dark ring so a ball over the bar reads against the crowd
      ctx.fillStyle = 'rgba(27,27,47,.85)'; ctx.beginPath(); ctx.arc(ball.x, ball.y - ball.h, ball.r + 2.5, 0, 6.29); ctx.fill();
    }
    drawBall(ctx, ball.x, ball.y, ball.r, ball.spin, ball.h); ctx.restore();
  };
  const drawA = (a) => {
    if ((a.alpha ?? 1) <= 0.02) return;
    // tilt: an extra rotation about the feet, used to swing into and out of the dive pose
    if (a.tilt) { ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(a.tilt); ctx.translate(-a.x, -a.y); }
    drawPlayer(ctx, a.char, a.x, a.y, { size: a.size, pose: a.pose, t: T, facing: a.facing, look: a.look, speed: a.speed || 1, alpha: a.alpha ?? 1 });
    if (a.tilt) ctx.restore();
  };
  if (ballBehind) drawB();
  cast.filter((a) => a.role === 'keeper').forEach(drawA);
  drawPosts();
  if (!ballBehind) drawB();
  cast.filter((a) => a.role === 'kicker').forEach(drawA);
  if (V.tint) { ctx.fillStyle = V.tint; ctx.fillRect(0, 0, W, H); }
  if (V.lights) {
    for (const lx of [10, W - 10]) {
      const g = ctx.createRadialGradient(lx, 8, 0, lx, 8, 60);
      g.addColorStop(0, 'rgba(255,255,240,.95)'); g.addColorStop(0.25, 'rgba(255,255,220,.35)'); g.addColorStop(1, 'rgba(255,255,220,0)');
      ctx.fillStyle = g; ctx.fillRect(lx - 60, 0, 120, 70);
    }
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,20,.4)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  }
}
requestAnimationFrame(frame);
// Dev aid (?jank=1 only): a hidden test browser pauses requestAnimationFrame, so
// keep the same frame loop ticking from a timer when rAF has gone quiet.
if (DEV) setInterval(() => { const n = performance.now(); if (n - lastNow > 40) frame(n, true); }, 16);

function drawNet() {
  const { x0, x1, y0, y1, depth } = G;
  const bx0 = x0 + depth * 0.8, bx1 = x1 - depth * 0.8, by0 = y0 - depth * 0.5;
  ctx.fillStyle = 'rgba(255,255,255,.1)';
  ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(bx0, y1 - depth * 0.3); ctx.lineTo(bx0, by0); ctx.lineTo(bx1, by0); ctx.lineTo(bx1, y1 - depth * 0.3); ctx.lineTo(x1, y1); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 0.9;
  const wob = (x, y) => {
    const d = Math.hypot(x - ripple.x, y - ripple.y);
    return ripple.a * Math.sin(d * 0.25 - T * 24) * Math.exp(-d * 0.025);
  };
  const N = 18, M = 9;
  for (let i = 0; i <= N; i++) {
    const x = lerp(bx0, bx1, i / N);
    ctx.beginPath();
    for (let j = 0; j <= M; j++) { const y = lerp(by0, y1 - depth * 0.3, j / M); const w = wob(x, y); j ? ctx.lineTo(x + w * 0.4, y + w) : ctx.moveTo(x + w * 0.4, y + w); }
    ctx.stroke();
  }
  for (let j = 0; j <= M; j++) {
    const y = lerp(by0, y1 - depth * 0.3, j / M);
    ctx.beginPath();
    for (let i = 0; i <= N; i++) { const x = lerp(bx0, bx1, i / N); const w = wob(x, y); i ? ctx.lineTo(x + w * 0.4, y + w) : ctx.moveTo(x + w * 0.4, y + w); }
    ctx.stroke();
  }
  // side nets
  for (const [a, b] of [[x0, bx0], [x1, bx1]]) for (let j = 0; j <= 5; j++) {
    ctx.beginPath(); ctx.moveTo(a, lerp(y0, y1, j / 5)); ctx.lineTo(b, lerp(by0, y1 - depth * 0.3, j / 5)); ctx.stroke();
  }
}
function drawPosts() {
  const { x0, x1, y0, y1 } = G;
  const pw = Math.max(5, W * 0.016);
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#1b1b2f'; ctx.lineWidth = pw + 4;
  ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(x0, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = pw;
  ctx.stroke();
  ctx.lineCap = 'butt';
}

// ------------------------------------------------------------------ state
let S = null, gen = 0;
const CANCEL = Symbol('cancel');
async function W8(p, g) { const v = await p; if (g !== gen) throw CANCEL; return v; }
let heat = false;

// hand-authored histories. kicks: {col,row,type,res:'goal'|'save'|'miss', dive:{col,row}}
const K = (col, row, type, res, dc, dr) => ({ col, row, type, res, dive: { col: dc, row: dr } });
const START = {
  early: { variant: 'day', ours: [], theirs: [] },
  mid: {
    variant: 'dusk',
    ours: [K(0, 0, 'placed', 'goal', 2, 1), K(0, 1, 'placed', 'save', 0, 1), K(2, 1, 'power', 'goal', 0, 1)],
    theirs: [K(2, 0, 'placed', 'goal', 0, 1), K(1, 1, 'power', 'goal', 2, 1), K(0, 1, 'placed', 'save', 0, 1)],
  },
  clutch: {
    variant: 'night',
    ours: [K(0, 0, 'placed', 'goal', 2, 1), K(0, 1, 'placed', 'save', 0, 1), K(2, 1, 'power', 'goal', 0, 0), K(0, 1, 'power', 'goal', 1, 1), K(0, 0, 'placed', 'goal', 2, 0)],
    theirs: [K(2, 0, 'placed', 'goal', 0, 1), K(1, 1, 'power', 'goal', 2, 1), K(0, 1, 'placed', 'save', 0, 1), K(2, 0, 'power', 'goal', 0, 0), K(0, 1, 'placed', 'goal', 2, 1)],
  },
};

function startPhase(id) {
  gen++;
  tweens.length = 0;
  // players who were mid-exit when the phase changed leave with the cut; the two
  // current players walk off normally in the next changeOver
  cast = cast.filter((a) => a === actors.keeper || a === actors.kicker);
  cast.forEach((a) => { a.alpha = 1; });
  if (ball.held && !cast.includes(ball.held)) ball.held = null;
  const st = START[id];
  S = { phase: id, variant: st.variant, ours: [...st.ours], theirs: [...st.theirs], sel: { col: 2, row: 1 }, type: 'placed' };
  S.oskar = new Oskar(S.ours.map((k) => ({ col: k.col, row: k.row, type: k.type })), S.ours.map((k) => k.dive));
  layout();
  excite = 0; ripple.a = 0;
  renderTally();
  const intro = {
    early: 'Shootout! Oskar has never seen you shoot. His notebook is empty, so his first dives are guesses.',
    mid: 'Round 4, 2–2. Oskar has three kicks in his notebook: two went left.',
    clutch: 'Sudden death under the lights, 4–4. Oskar has seen 5 kicks, 4 of them to the left.',
  }[id];
  shell.log(intro, 'info', '');
  run(gen);
}

const goals = (arr) => arr.filter((k) => k.res === 'goal').length;
function decided() {
  const a = S.ours.length, b = S.theirs.length, ga = goals(S.ours), gb = goals(S.theirs);
  if (a <= 5 && b <= 5) {
    const ra = 5 - a, rb = 5 - b;
    if (ga + ra < gb || gb + rb < ga) return true;
    if (a === 5 && b === 5) return ga !== gb;
    return false;
  }
  return a === b && ga !== gb;
}
function renderTally() {
  // always 5 pip slots so the tally never grows; in sudden death they show the
  // latest rounds and a small "R6–10" label says which
  const first = Math.max(0, Math.max(S.ours.length, S.theirs.length) - 5);
  const row = (team, arr, label) => {
    const pips = Array.from({ length: 5 }, (_, j) => {
      const k = arr[first + j];
      return `<i class="pip ${k ? k.res : ''}">${k ? (k.res === 'goal' ? '✓' : '✕') : ''}</i>`;
    }).join('');
    return `${crestSVG(team, 20)}<b>${goals(arr)}</b><span class="pips">${pips}</span>${label}`;
  };
  const lab = (top) => `<small class="win">${first && top ? `R${first + 1}–${first + 5}` : ''}</small>`;
  root.querySelector('[data-t=us]').innerHTML = row('sun', S.ours, lab(true));
  root.querySelector('[data-t=them]').innerHTML = row('red', S.theirs, lab(false));
  const rnd = Math.max(S.ours.length, S.theirs.length) + (S.ours.length === S.theirs.length ? 1 : 0);
  const done = decided();
  $('.round').innerHTML = done ? `<b>Full time</b><span>${goals(S.ours) > goals(S.theirs) ? 'Sunbirds win' : 'Redrock win'}</span>`
    : `<b>${rnd > 5 ? 'Sudden death' : 'Round ' + rnd}</b><span>${S.ours.length > S.theirs.length ? 'Wak in goal' : 'You shoot'}</span>`;
  shell.setScore({ home: goals(S.ours), away: goals(S.theirs), clock: done ? 'FT' : rnd > 5 ? 'SD' : 'PENS' });
}

async function run(g) {
  try {
    while (!decided()) {
      if (S.ours.length === S.theirs.length) await ourKick(g); else await theirKick(g);
      if (g !== gen) return;
    }
    await finish(g);
  } catch (e) { if (e !== CANCEL) throw e; }
}

// ------------------------------------------------------------------ cells UI
let keymap = {};
let onCell = null;
function renderCells(values, label, sel, heatMap) {
  cellsEl.innerHTML = '';
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
    const b = document.createElement('button');
    const on = sel && sel.col === c && sel.row === r;
    b.className = 'cell' + (on ? ' sel' : '');
    const hv = heatMap ? heatMap[r][c] : 0;
    if (heatMap) b.style.background = `rgba(232,70,58,${Math.min(0.75, hv * 1.6)})`;
    b.innerHTML = values ? `${oddsPill(values[r][c])}${heatMap ? `<small>🧤 ${Math.round(hv * 100)}%</small>` : ''}` : '';
    b.setAttribute('aria-label', `${cellName(c, r)}${values ? ' ' + Math.round(values[r][c] * 100) + '%' : ''}`);
    b.onclick = () => { if (onCell) { sfx.tick(); onCell(c, r); } };
    cellsEl.appendChild(b);
  }
}
function clearCells() { cellsEl.innerHTML = ''; onCell = null; }

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.sheet-wrap')) return;
  const f = keymap[e.key] || keymap[e.key.toLowerCase()];
  if (f) { e.preventDefault(); f(e); }
});
function moveSel(dc, dr) {
  if (!S.sel) S.sel = { col: 1, row: 1 };
  S.sel.col = Math.max(0, Math.min(2, S.sel.col + dc));
  S.sel.row = Math.max(0, Math.min(1, S.sel.row + dr));
  sfx.tick();
}

function showBubble(html) { bubble.hidden = false; bubble.innerHTML = html; bubble.classList.remove('pop'); void bubble.offsetWidth; bubble.classList.add('pop'); }

// ------------------------------------------------------------------ our kick
function setWaiting(text) { actEl.innerHTML = `<div class="wait">${text}</div>`; }
function showResult(cls, head, body) {
  oddsEl.innerHTML = `<div class="ol2 res ${cls}">${head}</div><div class="ol1">${body}</div>`;
}

async function ourKick(g) {
  const shooter = byId[OURS[S.ours.length % OURS.length]];
  const osk = S.oskar;
  bubble.hidden = true;
  clearCells();
  setWaiting(`${shooter.name} places the ball…`);
  whoEl.innerHTML = `<img src="${portrait(shooter, 56)}" alt=""><span><b>${shooter.name}</b> to shoot<small>SHO ${shooter.stats.shoot}${shooter.id === 'sol' ? ' · Late Show' : ''}</small></span>`;
  await W8(changeOver(g, shooter, byId.oskar), g);
  // Oskar shows his read: he shades a step toward the side his notes favour.
  if (!S.sel) S.sel = { col: 2, row: 1 };
  const lean = osk.lean();
  const kp = actors.keeper;
  if (osk.n) { kp.look = lean.col - 1; tween(kp, { x: W / 2 + (lean.col - 1) * W * 0.025 }, 0.5); }

  const committed = await W8(new Promise((resolve) => {
    const refresh = () => {
      const vals = [0, 1].map((r) => [0, 1, 2].map((c) => osk.goalOdds(c, r, S.type, shooter)));
      renderCells(vals, '', S.sel, heat ? osk.cover() : null);
      const p = vals[S.sel.row][S.sel.col];
      const dives = osk.dives.map((d) => COL_SHORT[d.col]).join(' ');
      const cnt = osk.colCounts();
      const n = osk.n;
      const rr = osk.repeatRate();
      const why = n === 0 ? 'Oskar has no notes on you yet: his dive is a guess.'
        : `You've shot ${cnt.map((v, i) => `${COL_SHORT[i]} ${v}`).join(' · ')}. ${rr ? `Same side ${rr.reps}/${rr.of}. ` : ''}Oskar leans <b>${COLS[lean.col]}</b> (${Math.round(lean.p * 100)}%).`;
      oddsEl.innerHTML = `<div class="ol1">${why}</div>
        <div class="ol2">${cellName(S.sel.col, S.sel.row)} · ${S.type} → ${oddsPill(p, 'goal')}<span class="muted">${S.type === 'power' ? ` over/wide ${Math.round((1 - onTarget(S.sel.col, S.sel.row, 'power', shooter)) * 100)}%` : ''}${dives ? ` · he dived: ${dives}` : ''}</span></div>`;
      actEl.innerHTML = `
        <div class="seg"><button class="btn small ${S.type === 'placed' ? 'blue' : 'paper'}" data-t="placed"><span class="key">1</span>Placed</button><button class="btn small ${S.type === 'power' ? 'red' : 'paper'}" data-t="power"><span class="key">2</span>Power</button></div>
        <button class="btn small paper icon" data-a="nb" title="Oskar's notebook (N)">📓</button>
        <button class="btn small ${heat ? 'red' : 'paper'} icon" data-a="heat" title="Heat-map of Oskar's read (V)">🔥</button>
        <button class="btn go" data-a="go">Shoot! <span class="key">⏎</span></button>`;
      actEl.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { sfx.click(); S.type = b.dataset.t; refresh(); }));
      actEl.querySelector('[data-a=nb]').onclick = () => { sfx.click(); notebook(); };
      actEl.querySelector('[data-a=heat]').onclick = () => { sfx.click(); heat = !heat; refresh(); };
      actEl.querySelector('[data-a=go]').onclick = () => { sfx.click(); go(); };
    };
    const go = () => { keymap = {}; onCell = null; resolve({ ...S.sel, type: S.type }); };
    onCell = (c, r) => { S.sel = { col: c, row: r }; refresh(); };
    keymap = {
      ArrowLeft: () => { moveSel(-1, 0); refresh(); }, ArrowRight: () => { moveSel(1, 0); refresh(); },
      ArrowUp: () => { moveSel(0, -1); refresh(); }, ArrowDown: () => { moveSel(0, 1); refresh(); },
      1: () => { S.type = 'placed'; refresh(); }, 2: () => { S.type = 'power'; refresh(); },
      p: () => { S.type = 'placed'; refresh(); }, o: () => { S.type = 'power'; refresh(); },
      n: () => notebook(), v: () => { heat = !heat; refresh(); },
      Enter: go, ' ': go,
    };
    refresh();
  }), g);
  const pShown = osk.goalOdds(committed.col, committed.row, committed.type, shooter);
  const forced = takeForce();
  const dive = forced?.dive || osk.pick();
  const cdBefore = osk.colDist();
  const out = forced?.out || resolveKick(committed.col, committed.row, committed.type, dive, shooter);
  clearCells(); keepSel(committed);
  setWaiting(`${shooter.name} runs up…`);
  const where = cellName(committed.col, committed.row);
  const rated = `he rated ${COLS[dive.col]} ${Math.round(cdBefore[dive.col] * 100)}%`;
  await W8(playKick(g, committed, dive, out, false, () => {
    // Contact frame: the score, pip and log change here, not before.
    const kick = { col: committed.col, row: committed.row, type: committed.type, res: out.res, dive };
    S.ours.push(kick);
    osk.record({ col: kick.col, row: kick.row, type: kick.type }, dive);
    renderTally();
    const R = 'R' + S.ours.length, pc = Math.round(pShown * 100);
    if (out.res === 'goal') {
      shell.log(`⚽ ${shooter.name} scores ${where} (${kick.type}, ${pc}%). Oskar dived ${COLS[dive.col]}: ${rated}.`, 'goal', R);
      showResult('good', `GOAL · you had ${pc}%`, out.how === 'beaten' ? `Oskar guessed ${COLS[dive.col]} but your ${kick.type} beat his hands.` : `Oskar dived ${COLS[dive.col]}: ${rated}.`);
    } else if (out.res === 'save') {
      shell.log(`🧤 Oskar saves ${shooter.name}'s ${where} ${kick.type}${out.how === 'legs' ? ' with his trailing legs' : ''}: ${rated}.`, 'bad', R);
      showResult('bad', `SAVED · you had ${pc}%`, out.how === 'legs' ? `Oskar dived ${COLS[dive.col]}, but low down the middle clipped his trailing legs.` : `He read it: ${rated}.`);
    } else {
      shell.log(`💨 ${shooter.name}'s ${kick.type} shot goes ${out.how === 'over' ? 'over the bar' : 'wide'}. Oskar dived ${COLS[dive.col]}.`, 'bad', R);
      showResult('bad', `${out.how === 'over' ? 'OVER' : 'WIDE'} · you had ${pc}%`, `${kick.type === 'power' ? 'Power can miss the target.' : 'Even placed shots miss sometimes.'} Oskar dived ${COLS[dive.col]}.`);
    }
  }), g);
  shell.toast(`📓 Oskar scribbles: “${shooter.name} → ${where}, ${committed.type}.”`);
}
// Keep the chosen cell outlined while the kick plays, so the result points back at it.
function keepSel(sel) {
  cellsEl.innerHTML = '';
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
    const d = document.createElement('div');
    d.className = 'cell ghost' + (sel.col === c && sel.row === r ? ' aim' : '');
    cellsEl.appendChild(d);
  }
}

// ------------------------------------------------------------------ their kick
function theirCtx() {
  const theirs = S.theirs;
  return {
    wakDives: theirs.map((k) => k.dive),
    lastTheirKick: theirs[theirs.length - 1] || null,
    lastTheirGoal: [...theirs].reverse().find((k) => k.res === 'goal') || null,
  };
}
async function theirKick(g) {
  const shooter = byId[THEIRS[S.theirs.length % THEIRS.length]];
  const prof = KICKERS[shooter.id];
  const cx = theirCtx();
  const prior = kickerPrior(shooter.id, cx);
  const kick = sampleKick(prior);
  const tellCol = Math.random() < TELL_TRUTH ? kick.col : pick([0, 1, 2].filter((c) => c !== kick.col));
  const tellPower = Math.random() < TELL_TRUTH ? kick.type === 'power' : kick.type !== 'power';
  const post = kickerPosterior(prior, tellCol, tellPower);
  bubble.hidden = true;
  clearCells();
  setWaiting(`${shooter.name} places the ball…`);
  whoEl.innerHTML = `<img src="${portrait(shooter, 56)}" alt=""><span><b>${shooter.name}</b> to shoot<small>${prof.note}</small></span>`;
  await W8(changeOver(g, shooter, byId.wak), g);
  // The tells play on the kicker: eyes toward a post, and a bouncing long run-up for power.
  actors.kicker.look = tellCol - 1;
  if (tellPower) { actors.kicker.pose = 'run'; actors.kicker.speed = 0.35; }
  const eyes = ['your left post', 'straight at you', 'your right post'][tellCol];
  showBubble(`<span class="ti">👀</span><span>Eyes: <b>${eyes}</b><br>${tellPower ? '💥 Long run-up (power?)' : '👣 Short run-up (placed?)'}<small>tells are true ~${Math.round(TELL_TRUTH * 100)}%</small></span>`);
  S.sel = null; // nothing pre-picked: read the tell first

  const committed = await W8(new Promise((resolve) => {
    const refresh = () => {
      const vals = [0, 1].map((r) => [0, 1, 2].map((c) => stopOdds(post, c, r, shooter)));
      renderCells(vals, '', S.sel, heat ? post.cells : null);
      const p = S.sel ? vals[S.sel.row][S.sel.col] : null;
      const colP = [0, 1, 2].map((c) => post.cells[0][c] + post.cells[1][c]);
      const live = prof.live ? prof.live(cx) + ' ' : '';
      oddsEl.innerHTML = `<div class="ol1">${live}Your read: ${colP.map((v, i) => `${COL_SHORT[i]} ${Math.round(v * 100)}%`).join(' · ')} · power ${Math.round(post.power * 100)}%</div>
        <div class="ol2">${S.sel ? `Cover ${cellName(S.sel.col, S.sel.row)} → ${oddsPill(p, 'stop')}` : '<span class="muted">Read the tell, then tap a spot to cover.</span>'}</div>`;
      actEl.innerHTML = `
        <button class="btn small ${heat ? 'red' : 'paper'} icon" data-a="heat" title="Heat-map of your read (V)">🔥</button>
        <span class="hint muted">Tap a spot for Wak to cover</span>
        <button class="btn go purple" data-a="go" ${S.sel ? '' : 'disabled title="Pick a spot first"'}>Dive! <span class="key">⏎</span></button>`;
      actEl.querySelector('[data-a=heat]').onclick = () => { sfx.click(); heat = !heat; refresh(); };
      actEl.querySelector('[data-a=go]').onclick = () => { sfx.click(); go(); };
    };
    const go = () => { if (!S.sel) { sfx.tick(); return; } keymap = {}; onCell = null; resolve({ ...S.sel }); };
    onCell = (c, r) => { S.sel = { col: c, row: r }; refresh(); };
    keymap = {
      ArrowLeft: () => { moveSel(-1, 0); refresh(); }, ArrowRight: () => { moveSel(1, 0); refresh(); },
      ArrowUp: () => { moveSel(0, -1); refresh(); }, ArrowDown: () => { moveSel(0, 1); refresh(); },
      v: () => { heat = !heat; refresh(); }, n: () => notebook(),
      Enter: go, ' ': go,
    };
    refresh();
  }), g);
  const pShown = stopOdds(post, committed.col, committed.row, shooter);
  const forced = takeForce();
  if (forced?.kick) Object.assign(kick, forced.kick);
  const out = forced?.out || resolveKick(kick.col, kick.row, kick.type, committed, shooter);
  bubble.hidden = true;
  clearCells(); keepSel(committed);
  setWaiting(`${shooter.name} runs up…`);
  const where = cellName(kick.col, kick.row);
  const tellTxt = tellCol === kick.col ? 'the eyes told the truth' : 'the eyes were a bluff';
  await W8(playKick(g, kick, committed, out, true, () => {
    S.theirs.push({ ...kick, res: out.res, dive: committed });
    renderTally();
    const R = 'R' + S.theirs.length, pc = Math.round(pShown * 100);
    const cov = cellName(committed.col, committed.row);
    if (out.res === 'goal') {
      shell.log(`⚽ ${shooter.name} scores ${where} (${kick.type}); ${tellTxt}. Wak covered ${cov} (stop was ${pc}%).`, 'them', R);
      showResult('bad', `GOAL · stop was ${pc}%`, `${shooter.name} went ${where}, ${kick.type}: ${tellTxt}.${out.how === 'beaten' ? ' Right side, but it beat Wak.' : ''}`);
    } else if (out.res === 'save') {
      shell.log(`🧤 Wak saves ${shooter.name}'s ${where} ${kick.type}${out.how === 'legs' ? ' with his trailing legs' : ''}! ${tellTxt[0].toUpperCase() + tellTxt.slice(1)}.`, 'good', R);
      showResult('good', `SAVED · stop was ${pc}%`, out.how === 'legs' ? 'Low down the middle clipped Wak\'s trailing legs.' : `You read ${where}: ${tellTxt}.`);
    } else {
      shell.log(`💨 ${shooter.name} puts it ${out.how === 'over' ? 'over the bar' : 'wide'}. Wak covered ${cov}.`, 'good', R);
      showResult('good', `${out.how === 'over' ? 'OVER' : 'WIDE'} · stop was ${pc}%`, `${shooter.name} missed the target (${kick.type}).`);
    }
  }), g);
}

// ------------------------------------------------------------------ animation
const wait = (sec) => tween({ v: 0 }, { v: 1 }, sec);
function stopTweens(o) { for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i].o === o) tweens.splice(i, 1); }
const kickMark = () => ({ x: G.spot.x - W * 0.08, y: G.spot.y + H * 0.1 });
const runupMark = () => ({ x: W * 0.3, y: H * 0.99 });
const keeperHome = () => ({ x: W / 2, y: G.y1 + 2 });
// Where a held ball sits on its carrier.
function holdPt(a) {
  if (a.holdOff) return { x: a.x + a.holdOff.x, y: a.y + a.holdOff.y };
  return { x: a.x + a.facing * a.size * 0.14, y: a.y - a.size * 0.38 };
}
const keeperSize = () => G.h * 0.66;
const kickerSize = () => H * 0.33;

// Keeper sprite geometry, measured from shared/art.js drawPlayer (design units,
// 44 = sprite height, feet at 0,0, x for facing = 1; mirror x for facing = -1).
// box: the whole sprite incl. hair; glove: the glove the ball should meet.
// The dive pose lies the body toward -facing; its front glove sits on the face,
// so saves use the lower (back) glove, which is clear of the head.
const KG = {
  dive: { box: [-50, 5, -25.5, 7], glove: { x: -30.5, y: 3 } },
  header: { box: [-13.5, 13.5, -56.5, 0], glove: { x: 0, y: -25.6 } },
  ready: { box: [-19.5, 19.5, -46.5, 3.5], glove: { x: 0, y: -15 } },
};
function kBox(k, pose, facing, at) {
  const s = k.size / 44, b = KG[pose].box;
  const xa = facing > 0 ? b[0] : -b[1], xb = facing > 0 ? b[1] : -b[0];
  return { x0: at.x + xa * s, x1: at.x + xb * s, y0: at.y + b[2] * s, y1: at.y + b[3] * s };
}
// Where the ball centre sits when it meets the glove (touching, on the side
// away from the body), relative to the feet.
function reach(k, pose, facing, br) {
  const s = k.size / 44, gl = KG[pose].glove;
  if (pose === 'dive') return { x: facing * (gl.x - 3 - br * 0.8) * s, y: gl.y * s };
  return { x: 0, y: gl.y * s };
}
// Keep the whole keeper inside the goal frame (head under the bar, hair inside the posts).
function clampFeet(k, pose, facing, feet) {
  const pad = Math.max(5, W * 0.016) / 2 + 2;
  const b = kBox(k, pose, facing, feet);
  let dx = 0, dy = 0;
  if (b.x0 < G.x0 + pad) dx = G.x0 + pad - b.x0;
  if (b.x1 > G.x1 - pad) dx = G.x1 - pad - b.x1;
  if (b.y0 < G.y0 + pad) dy = G.y0 + pad - b.y0;
  const y = Math.min(feet.y + dy, G.y1 + 2);
  return { x: feet.x + dx, y };
}
// Move a keeper sideways until his whole sprite has `gap` px of daylight from every point.
function clearOf(k, pose, facing, feet, pts, gap) {
  let f = { ...feet };
  for (let i = 0; i < 6; i++) {
    let worst = null;
    for (const p of pts) {
      const b = kBox(k, pose, facing, f);
      if (p.x > b.x0 - gap && p.x < b.x1 + gap && p.y > b.y0 - gap && p.y < b.y1 + gap) {
        const cx = (b.x0 + b.x1) / 2;
        const need = p.x >= cx ? p.x - (b.x1 + gap) : p.x - (b.x0 - gap); // shift that clears this point
        if (!worst || Math.abs(need) > Math.abs(worst)) worst = need;
      }
    }
    if (!worst) break;
    f.x += worst;
  }
  return f;
}

function newKeeper(char, fromX) {
  return { role: 'keeper', char, x: fromX, y: G.y1 + 2, size: keeperSize(), pose: 'run', facing: fromX < W / 2 ? 1 : -1, look: 0, alpha: 1 };
}
function newKicker(char) {
  return { role: 'kicker', char, x: -W * 0.12, y: H * 1.06, size: kickerSize(), pose: 'run', facing: 1, look: 0, alpha: 1 };
}
const placePt = () => ({ x: G.spot.x - kickerSize() * 0.14, y: G.spot.y + H * 0.1 });

// Between kicks: players who are not needed walk off, the next pair walks on,
// and the ball reaches the spot by being carried, rolled out or rolled in.
// A character is only ever one sprite: in sudden death a keeper who is due to
// kick walks out of his goal to the spot, and a kicker who is due in goal walks
// up into it.
async function changeOver(g, shooter, keeperChar) {
  window.__jankCtx = 'changeover';
  const olds = [actors.keeper, actors.kicker].filter(Boolean);
  const take = (char) => { const i = olds.findIndex((o) => o.char === char); return i < 0 ? null : olds.splice(i, 1)[0]; };
  const keeper0 = take(keeperChar), kicker0 = take(shooter);
  const jobs = [];
  const KS = keeperSize(), SS = kickerSize();
  const getUp = async (a) => {
    stopTweens(a);
    if (a.role === 'keeper' && (a.y < G.y1 + 2 || a.pose === 'dive')) {
      // swing up out of the dive: draw him upright but rotated flat, then rotate back
      if (a.pose === 'dive') { a.tilt = -a.facing * 1.35; tween(a, { tilt: 0 }, 0.3); }
      a.pose = 'idle'; await tween(a, { y: G.y1 + 2 }, 0.3);
    }
    a.tilt = 0;
  };

  // --- who leaves
  let exitSide = actors.keeper && actors.keeper.x < W / 2 ? -1 : 1;
  for (const o of olds) {
    jobs.push((async () => {
      await getUp(o);
      o.pose = 'run'; o.speed = 1; o.look = 0;
      if (o.role === 'keeper') {
        o.facing = exitSide;
        await Promise.all([tween(o, { x: exitSide < 0 ? -W * 0.16 : W * 1.16 }, 0.95, { ease: linear }), wait(0.55).then(() => tween(o, { alpha: 0 }, 0.4))]);
      } else {
        o.facing = 1;
        await Promise.all([tween(o, { x: W * 1.15, y: H * 1.12 }, 0.95, { ease: linear }), wait(0.5).then(() => tween(o, { alpha: 0 }, 0.4))]);
      }
      cast = cast.filter((a) => a !== o);
      if (ball.held === o) { ball.held = null; ball.vis = false; delete o.holdOff; }
    })());
  }

  // --- the keeper
  let keeper = keeper0;
  if (keeper) {
    const wasKicker = keeper.role === 'kicker';
    jobs.push((async () => {
      await getUp(keeper);
      keeper.pose = 'run'; keeper.speed = 1; keeper.look = 0;
      keeper.facing = keeper.x < W / 2 ? 1 : -1;
      if (wasKicker) await wait(0.3); // let the ball leave first
      keeper.role = 'keeper';
      await tween(keeper, { ...keeperHome(), size: KS }, wasKicker ? 1.1 : 0.6);
    })());
  } else {
    keeper = newKeeper(keeperChar, exitSide < 0 ? W * 1.14 : -W * 0.14);
    cast.push(keeper);
    jobs.push(wait(0.15).then(() => tween(keeper, keeperHome(), 1.0, { ease: linear })));
  }

  // --- the kicker and the ball
  let kicker = kicker0;
  const fresh = !kicker;
  if (fresh) { kicker = newKicker(shooter); cast.push(kicker); }
  actors.keeper = keeper; actors.kicker = kicker;
  const heldBy = ball.vis ? ball.held : null;
  let plan;
  if (heldBy && heldBy === kicker) plan = 'keep';           // he caught it and he kicks next
  else if (heldBy && fresh) plan = 'rollout';               // a keeper rolls it out to the next kicker
  else plan = fresh ? 'carry' : 'rollin';                   // new ball carried in, or rolled to the spot
  if (plan !== 'keep' && plan !== 'rollout' && ball.vis) {
    ball.held = null; stopTweens(ball);
    jobs.push(tween(ball, { alpha: 0 }, 0.3).then(() => { ball.vis = false; }));
  }
  let rolled = null;
  if (plan === 'rollout') {
    const from = heldBy;
    ball.held = null; delete from.holdOff; stopTweens(ball); ball.behind = false;
    from.pose = 'pass';
    rolled = tween(ball, { ...holdPt(kicker), r: W * 0.028 }, 0.6, { arc: 16 });
  }
  const place = async () => {
    await tween(kicker, { ...placePt(), size: SS }, fresh ? 0.85 : 1.0);
    kicker.pose = 'pass';
    if (ball.held === kicker) { delete kicker.holdOff; ball.held = null; }
    await tween(ball, { x: G.spot.x, y: G.spot.y, r: W * 0.026, h: 0 }, 0.25);
    sfx.thud();
  };
  jobs.push((async () => {
    if (!fresh) await getUp(kicker);
    kicker.role = 'kicker'; kicker.pose = 'run'; kicker.speed = 1; kicker.look = 0; kicker.facing = 1;
    if (plan === 'keep') {
      ball.held = kicker; ball.behind = false;
      await place();
    } else if (plan === 'rollin') {
      // he walks out to the run-up mark; a ball is rolled in to the spot from the side
      await wait(0.35);
      stopTweens(ball);
      Object.assign(ball, { vis: true, alpha: 1, held: null, behind: false, h: 0, r: W * 0.03, x: -W * 0.08, y: H * 0.97 });
      await Promise.all([
        tween(ball, { x: G.spot.x, y: G.spot.y, r: W * 0.026 }, 0.9, { ease: (x) => 1 - (1 - x) * (1 - x) }),
        tween(kicker, { ...runupMark(), size: SS }, 1.1),
      ]);
    } else {
      if (rolled) await rolled; else await wait(0.35);
      stopTweens(ball);
      Object.assign(ball, { vis: true, alpha: 1, r: W * 0.028, h: 0, behind: false, held: kicker });
      delete kicker.holdOff;
      await place();
    }
    if (plan !== 'rollin') {
      kicker.pose = 'run'; kicker.facing = -1;
      await tween(kicker, runupMark(), 0.5);
    }
    kicker.facing = 1; kicker.pose = 'idle';
  })());
  await W8(Promise.all(jobs), g);
  keeper.pose = 'ready'; keeper.facing = 1; keeper.look = 0; keeper.speed = 1;
  ball.behind = null;
  sfx.whistle();
  window.__jankCtx = '';
}

// One kick, cause before effect. The ball's path is decided first, then the
// keeper's dive is fitted to it: on a save his glove meets the ball on the same
// frame; on a goal or a miss his whole sprite keeps at least a ball's width of
// daylight from the end of the ball's path. Sound, banner and score fire on the
// frame the ball reaches the goal line (onContact).
async function playKick(g, kick, dive, out, wakInGoal, onContact) {
  const kk = actors.kicker, kp = actors.keeper;
  stopTweens(kp); stopTweens(kk);
  window.__jankCtx = 'runup';
  kk.pose = 'run'; kk.speed = 1; kk.look = 0;
  await W8(tween(kk, kickMark(), 0.55, { ease: linear }), g);
  kk.pose = 'kick'; sfx.kick();
  window.__jankCtx = 'shot';

  const aim = cellPt(kick.col, kick.row);
  const ksd = kick.col - 1;               // -1 left, 0 middle, 1 right
  const dsd = dive.col - 1;
  const poseFor = (col, row) => (col === 1 ? (row === 0 ? 'header' : 'ready') : 'dive');
  const faceFor = (col) => (col === 0 ? 1 : -1); // dive pose lies toward -facing
  const dur = kick.type === 'power' ? 0.36 : 0.52;
  const br = W * 0.016;                   // ball radius at the goal line
  const arc = kick.type === 'power' ? 6 : 14;
  let pose = poseFor(dive.col, dive.row), facing = faceFor(dive.col);
  let keeperTo, ballTo = aim, kDur = dur - 0.06;
  const s = kp.size / 44;

  if (out.res === 'save' && out.how === 'hands') {
    pose = poseFor(kick.col, kick.row); facing = faceFor(kick.col);
    const r = reach(kp, pose, facing, br / s);
    keeperTo = clampFeet(kp, pose, facing, { x: aim.x - r.x, y: aim.y - r.y });
    ballTo = { x: keeperTo.x + r.x, y: keeperTo.y + r.y }; // glove and ball meet here
  } else if (out.how === 'legs') {
    // he dives away, but the low middle shot clips his trailing legs
    keeperTo = { x: W / 2 + dsd * G.w * 0.07, y: G.y1 - G.h * 0.03 };
    ballTo = { x: keeperTo.x - facing * 4 * s, y: keeperTo.y - 6 * s };
  } else {
    if (out.res === 'miss') {
      if (out.how === 'over') ballTo = { x: aim.x + ksd * W * 0.04, y: G.y0 - G.h * 0.3 };
      else {
        const side = ksd || (Math.random() < 0.5 ? -1 : 1);
        ballTo = { x: side < 0 ? G.x0 - G.w * 0.12 : G.x1 + G.w * 0.12, y: G.y1 - G.h * 0.04 }; // low, so it passes beside the post foot, not across it
      }
    }
    if (out.how === 'beaten' && dive.row === kick.row) {
      // right guess: he goes for it, and falls short of it
      pose = poseFor(kick.col, kick.row); facing = faceFor(kick.col);
      if (kick.col === 1) facing = Math.random() < 0.5 ? 1 : -1;
      // top middle: he takes off sideways at it (a dive is a visible attempt), and ends short
      if (kick.col === 1 && kick.row === 0) pose = 'dive';
      const r = reach(kp, pose, facing, br / s);
      keeperTo = { x: aim.x - r.x, y: aim.y - r.y };
      kDur = dur * 0.85;
    } else {
      const dp = cellPt(dive.col, dive.row);
      const r = reach(kp, pose, facing, br / s);
      keeperTo = { x: dp.x - r.x, y: dp.y - r.y };
    }
    keeperTo = clampFeet(kp, pose, facing, keeperTo);
    // daylight: sample the last stretch of the ball's drawn path (incl. its arc);
    // earlier in flight the ball is well in front of him (drawn in front), so overlap there is depth, not contact
    const from = { x: ball.x, y: ball.y };
    const pts = [0.88, 0.94, 1].map((t) => ({ x: lerp(from.x, ballTo.x, t), y: lerp(from.y, ballTo.y, t) - arc * Math.sin(Math.PI * t) }));
    keeperTo = clampFeet(kp, pose, facing, clearOf(kp, pose, facing, keeperTo, pts, br * 2.5));
    keeperTo = clearOf(kp, pose, facing, keeperTo, pts, br * 2); // the posts win only if daylight survives
  }
  // in flight the ball is in front of the goal line, so it is drawn in front of the keeper
  ball.behind = false;
  ball.halo = out.res === 'miss';
  kp.pose = pose === 'dive' ? 'ready' : pose; kp.facing = facing;
  // the kicker follows through a little to his left so low contacts stay in view
  tween(kk, { x: kk.x - W * 0.05, y: kk.y + H * 0.02 }, 0.4);
  // ease-out: he springs fast and settles, so mid-flight he is already near his line
  const keeperDone = wait(0.06).then(() => {
    kp.pose = pose;
    // the dive pose is drawn already lying flat; start it upright and swing it down
    if (pose === 'dive') { kp.tilt = facing * 1.35; tween(kp, { tilt: 0 }, Math.min(0.16, kDur * 0.45)); }
    return tween(kp, keeperTo, kDur, { ease: (x) => 1 - (1 - x) * (1 - x) });
  });
  await W8(tween(ball, { x: ballTo.x, y: ballTo.y, r: br }, dur, { ease: linear, arc }), g);

  // ---- the ball reaches the goal line (or the glove)
  window.__jankCtx = 'contact';
  setWaiting(wakInGoal ? 'Your kick next' : 'Wak goes in goal next');
  const sx = cv.getBoundingClientRect(), k = sx.width / W;
  const pop = (t) => shell.popup(t, sx.left + ball.x * k, sx.top + (ball.y - ball.h) * k);
  const land = async () => { await keeperDone; if (kp.y < G.y1 - 1) await tween(kp, { y: G.y1 + 2 }, 0.25, { ease: (x) => x * x }); };
  // the banner lands a beat after the contact so the contact itself is seen first
  const say = (...a) => { wait(0.16).then(() => shell.banner(...a)); };
  const clampX = (x) => Math.max(ball.r + 6, Math.min(W - ball.r - 6, x));
  if (out.res === 'goal') {
    ball.behind = true; // it is in the net now, behind the keeper
    ripple = { a: 7, x: ball.x, y: ball.y }; excite = 1;
    if (!wakInGoal) { sfx.goal(); shell.flash('#fff'); shell.shake(); shell.confetti(); say('GOAL!', kk.char.name); }
    else { sfx.groan(); shell.shake(); say('GOAL…', kk.char.name, '#ff8a80'); }
    kk.pose = 'celebrate';
    onContact(); pop('⚽');
    // no stop at the line: it carries on into the net, then drops
    await W8(Promise.all([
      tween(ball, { y: ball.y - G.depth * 0.35, r: W * 0.014 }, 0.12, { ease: (x) => 1 - (1 - x) * (1 - x) })
        .then(() => tween(ball, { y: G.y1 - G.depth * 0.35 }, 0.3, { ease: (x) => x * x })),
      land(),
    ]), g);
    if (pose !== 'dive') kp.pose = 'sad';
  } else if (out.res === 'save') {
    sfx.save(); freeze(150); shell.shake();
    say('SAVED!', kp.char.name, wakInGoal ? '#9ef0a8' : '#d6c4ff');
    if (wakInGoal) shell.confetti(80, ['#3BB273', '#FFD23F', '#fff']);
    kk.pose = 'sad';
    onContact(); pop('🧤');
    if (out.how === 'hands' && kick.col === 1) {
      // straight at him: he holds it
      await keeperDone;
      kp.holdOff = { x: ball.x - kp.x, y: ball.y - kp.y }; ball.held = kp;
      await W8(land(), g);
    } else {
      // pushed away: wide of the post, or back out off the legs (kept on the canvas)
      const away = out.how === 'legs'
        ? { x: clampX(ball.x - dsd * W * 0.16), y: G.y1 + H * 0.1 }
        : { x: clampX(ball.x + ksd * W * 0.2), y: G.y1 + H * (kick.row === 0 ? 0.03 : 0.08) };
      await W8(Promise.all([
        tween(ball, { x: away.x, y: away.y, r: W * 0.02 }, 0.45, { arc: kick.row === 0 ? 26 : 14 }),
        wait(0.08).then(land),
      ]), g);
      sfx.thud();
    }
  } else {
    sfx.ooh();
    say(out.how === 'over' ? 'OVER!' : 'WIDE!', '', wakInGoal ? '#9ef0a8' : '#ff8a80');
    kk.pose = 'sad';
    onContact(); pop('💨');
    // it carries on into the stand and out of sight
    const on = out.how === 'over' ? { x: ball.x + ksd * W * 0.03, y: ball.y - G.h * 0.3 } : { x: ball.x + (ball.x < W / 2 ? -1 : 1) * W * 0.08, y: ball.y - G.h * 0.25 };
    await W8(Promise.all([
      tween(ball, { ...on, alpha: 0 }, 0.4, { ease: linear }),
      land(),
    ]), g);
    ball.vis = false; ball.halo = false;
  }
  window.__jankCtx = '';
  await W8(wait(1.1), g);
}
const freeze = (ms) => { freezeUntil = performance.now() + ms; };

// ------------------------------------------------------------------ notebook
function notebook() {
  const osk = S.oskar, n = osk.n;
  const cnt = osk.colCounts();
  const top = osk.hist.filter((h) => h.row === 0).length;
  const pow = osk.hist.filter((h) => h.type === 'power').length;
  const rr = osk.repeatRate();
  const cd = osk.colDist(), rd = osk.rowDist();
  const cover = osk.cover();
  const lines = osk.hist.map((h, i) => `<li><b>#${i + 1}</b> ${byId[OURS[i % OURS.length]].name}: ${cellName(h.col, h.row)}, ${h.type} <span class="muted">(he dived ${COLS[osk.dives[i].col]})</span></li>`).join('');
  shell.modal({
    title: "📓 Big Oskar's notebook",
    html: `<div class="nbk">
      <p style="margin:2px 0 8px">${n ? `He has watched <b>${n}</b> of your kicks and trusts his notes <b>${n < 2 ? 'a little' : n < 4 ? 'more and more' : 'a lot'}</b>.` : 'Empty. He is guessing.'}</p>
      <table><tr><th></th><th>Left</th><th>Mid</th><th>Right</th></tr>
      <tr><td>You shot</td>${cnt.map((v) => `<td>${v}</td>`).join('')}</tr>
      <tr><td>He'll dive</td>${cd.map((v) => `<td>${Math.round(v * 100)}%</td>`).join('')}</tr></table>
      <div class="nbgrid">${[0, 1].map((r) => [0, 1, 2].map((c) => `<i style="background:rgba(232,70,58,${Math.min(0.85, cover[r][c] * 1.8)})">${Math.round(cover[r][c] * 100)}%</i>`).join('')).join('')}</div>
      <p>Top ${top} · Low ${n - top} → ${Math.abs(rd[0] - rd[1]) < 0.01 ? 'no lean on height yet' : `he expects <b>${rd[0] > rd[1] ? 'top' : 'low'}</b> (${Math.round(Math.max(...rd) * 100)}%)`}. Power ${pow} · Placed ${n - pow}.</p>
      ${rr ? `<p>You kept the same side ${rr.reps} of ${rr.of} times, so he ${rr.rate > 0.45 ? 'expects a repeat' : rr.rate < 0.25 ? 'expects you to switch' : 'is unsure about repeats'}.</p>` : ''}
      ${lines ? `<ol class="nbl">${lines}</ol>` : ''}</div>`,
    buttons: [{ label: 'Close' }],
  });
}

// ------------------------------------------------------------------ end
async function finish(g) {
  const ga = goals(S.ours), gb = goals(S.theirs);
  const won = ga > gb;
  keymap = {};
  clearCells(); bubble.hidden = true;
  setWaiting('Full time');
  const last = oddsEl.querySelector('.res')?.textContent || '';
  showResult(won ? 'good' : 'bad', won ? '🏆 Sunbirds win the shootout!' : 'Redrock win the shootout.', `${ga}–${gb}${last ? ` · last kick: ${last}` : ''}`);
  if (won) { sfx.win(); shell.confetti(200); } else sfx.lose();
  // whoever is on the pitch reacts for their own team
  for (const a of [actors.keeper, actors.kicker]) if (a && a.pose !== 'dive') a.pose = (a.char.team === 'sun') === won ? 'celebrate' : 'sad';
  const osk = S.oskar;
  const saves = S.ours.filter((k) => k.res === 'save').length;
  const read = S.ours.filter((k) => k.dive.col === k.col).length;
  shell.log(`${won ? '🏆 Sunbirds' : 'Redrock'} win ${ga}–${gb}. Oskar guessed your side ${read}/${S.ours.length} times.`, 'goal', 'FT');
  await W8(wait(1.2), g);
  const idx = PHASES.findIndex((p) => p.id === S.phase);
  const next = PHASES[(idx + 1) % PHASES.length];
  const v = await shell.modal({
    title: won ? 'Shootout won!' : 'Shootout lost',
    html: `<p style="font-size:22px;font-family:var(--font-h);margin:4px 0">Sunbirds ${ga} – ${gb} Redrock</p>
      <p>Oskar guessed your side <b>${read} of ${S.ours.length}</b> times and saved ${saves}. ${read / Math.max(1, S.ours.length) >= 0.5 ? 'His notes were reading you.' : read / Math.max(1, S.ours.length) <= 0.25 ? 'You kept him guessing.' : 'He read you some of the time.'}</p>
      <div class="notice"><b>What to notice:</b> did you start shooting against your own habits, or did it still feel like a coin flip?</div>`,
    buttons: [{ label: 'Replay', value: 'again' }, { label: `Next: ${next.label}`, value: 'next', cls: 'blue' }],
  });
  if (g !== gen) return;
  shell.setPhase(v === 'next' ? next.id : S.phase);
}
