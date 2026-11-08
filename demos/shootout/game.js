// Shootout Minds — penalties as rock-paper-scissors with memory.
import { Shell, oddsPill, pick } from '../../shared/shell.js';
import { sfx } from '../../shared/sfx.js';
import { byId, crestSVG } from '../../shared/cast.js';
import { drawPlayer, drawBall, setupCanvas, portrait, lerp, ease } from '../../shared/art.js';
import {
  COLS, COL_SHORT, cellName, TELL_TRUTH, onTarget, saveIfRightCol, Oskar, KICKERS,
  kickerPrior, kickerPosterior, stopOdds, sampleKick,
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
    '<b>Shooting:</b> pick one of 6 spots (3 columns × top/low) and <b>Placed</b> or <b>Power</b>. Power is harder to save but can sail over.',
    'Big Oskar keeps a notebook of your kicks and dives where you usually go. Peek at it with <b>📓</b> (N) or the <b>🔥</b> heat-map (V).',
    '<b>In goal (Wak):</b> pick a spot to cover. The kicker shows a tell (eyes / run-up) that is true ~65% of the time.',
    'Each % already counts what you can see: Oskar\'s notes, the kicker\'s habit, and the tell.',
    'Five kicks each, then sudden death.',
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
const actors = { keeper: null, kicker: null };
const ball = { x: 0, y: 0, r: 9, h: 0, spin: 0, vis: true };

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

function frame(now) {
  requestAnimationFrame(frame);
  if (!ctx || !S) return;
  let dt = Math.min(0.05, (now - lastNow) / 1000); lastNow = now;
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
  // keeper, then ball (if behind keeper), kicker
  const k = actors.keeper, kk = actors.kicker;
  const ballBehind = ball.y < G.y1 + 2 && ball.r < 6.5;
  if (ball.vis && ballBehind) drawBall(ctx, ball.x, ball.y, ball.r, ball.spin, ball.h);
  if (k) drawPlayer(ctx, k.char, k.x, k.y, { size: k.size, pose: k.pose, t: T, facing: k.facing, look: k.look });
  drawPosts();
  if (ball.vis && !ballBehind) drawBall(ctx, ball.x, ball.y, ball.r, ball.spin, ball.h);
  if (kk) drawPlayer(ctx, kk.char, kk.x, kk.y, { size: kk.size, pose: kk.pose, t: T, facing: kk.facing, look: kk.look, speed: kk.speed || 1 });
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  const row = (team, arr) => {
    const pips = Array.from({ length: Math.max(5, arr.length) }, (_, i) => {
      const k = arr[i];
      return `<i class="pip ${k ? k.res : ''}">${k ? (k.res === 'goal' ? '✓' : '✕') : ''}</i>`;
    }).join('');
    return `${crestSVG(team, 20)}<b>${goals(arr)}</b><span class="pips">${pips}</span>`;
  };
  root.querySelector('[data-t=us]').innerHTML = row('sun', S.ours);
  root.querySelector('[data-t=them]').innerHTML = row('red', S.theirs);
  const rnd = Math.max(S.ours.length, S.theirs.length) + (S.ours.length === S.theirs.length ? 1 : 0);
  $('.round').innerHTML = `<b>${rnd > 5 ? 'Sudden death' : 'Round ' + rnd}</b><span>${S.ours.length > S.theirs.length ? 'Wak in goal' : 'You shoot'}</span>`;
  shell.setScore({ home: goals(S.ours), away: goals(S.theirs), clock: rnd > 5 ? 'SD' : 'PENS' });
}

async function run(g) {
  try {
    while (!decided()) {
      if (S.ours.length === S.theirs.length) await ourKick(g); else await theirKick(g);
      if (g !== gen) return;
      renderTally();
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
  S.sel.col = Math.max(0, Math.min(2, S.sel.col + dc));
  S.sel.row = Math.max(0, Math.min(1, S.sel.row + dr));
  sfx.tick();
}

function showBubble(html) { bubble.hidden = false; bubble.innerHTML = html; bubble.classList.remove('pop'); void bubble.offsetWidth; bubble.classList.add('pop'); }

// ------------------------------------------------------------------ our kick
async function ourKick(g) {
  const shooter = byId[OURS[S.ours.length % OURS.length]];
  const osk = S.oskar;
  bubble.hidden = true;
  await W8(placeActors(g, shooter, byId.oskar), g);
  whoEl.innerHTML = `<img src="${portrait(shooter, 56)}" alt=""><span><b>${shooter.name}</b> to shoot<small>SHO ${shooter.stats.shoot}${shooter.id === 'sol' ? ' · Late Show' : ''}</small></span>`;

  const committed = await W8(new Promise((resolve) => {
    const refresh = () => {
      const vals = [0, 1].map((r) => [0, 1, 2].map((c) => osk.goalOdds(c, r, S.type, shooter)));
      renderCells(vals, '', S.sel, heat ? osk.cover() : null);
      const p = vals[S.sel.row][S.sel.col];
      const cd = osk.colDist();
      const dives = osk.dives.map((d) => COL_SHORT[d.col]).join(' ');
      const cnt = osk.colCounts();
      const lean = osk.lean();
      const n = osk.n;
      const why = n === 0 ? 'Oskar has no notes on you yet: his dive is a guess.'
        : `You've shot ${cnt.map((v, i) => `${COL_SHORT[i]} ${v}`).join(' · ')}. ${osk.repeatRate() ? `You repeat your side ${osk.repeatRate().reps}/${osk.repeatRate().of}. ` : ''}Oskar leans <b>${COLS[lean.col]}</b> (${Math.round(lean.p * 100)}%).`;
      oddsEl.innerHTML = `<div class="ol1">${why}</div>
        <div class="ol2">${cellName(S.sel.col, S.sel.row)} · ${S.type} → ${oddsPill(p, 'goal')}<span class="muted">${S.type === 'power' ? ` over the bar ${Math.round((1 - onTarget(S.sel.col, S.sel.row, 'power', shooter)) * 100)}%` : ''}${dives ? ` · Oskar dove: ${dives}` : ''}</span></div>`;
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
  actEl.innerHTML = '<div class="wait">…</div>';
  const pShown = osk.goalOdds(committed.col, committed.row, committed.type, shooter);
  const dive = osk.pick();
  const cdBefore = osk.colDist();
  const on = Math.random() < onTarget(committed.col, committed.row, committed.type, shooter);
  const saved = on && dive.col === committed.col && Math.random() < saveIfRightCol(dive.row === committed.row, committed.type);
  const res = !on ? 'miss' : saved ? 'save' : 'goal';
  renderCells(null, '', null, null);
  await W8(animateKick(g, committed, dive, res, false), g);
  const kick = { col: committed.col, row: committed.row, type: committed.type, res, dive };
  S.ours.push(kick);
  osk.record({ col: kick.col, row: kick.row, type: kick.type }, dive);
  const where = cellName(kick.col, kick.row);
  const lean = `he rated ${COLS[dive.col]} at ${Math.round(cdBefore[dive.col] * 100)}%`;
  if (res === 'goal') shell.log(`⚽ ${shooter.name} scores ${where} (${kick.type}, ${Math.round(pShown * 100)}%). Oskar dived ${COLS[dive.col]}: ${lean}.`, 'goal', 'R' + S.ours.length);
  else if (res === 'save') shell.log(`🧤 Oskar saves ${shooter.name}'s ${where} ${kick.type}. He read it: ${lean}.`, 'bad', 'R' + S.ours.length);
  else shell.log(`💨 ${shooter.name}'s power shot sails ${kick.row === 0 ? 'over the bar' : 'wide'}. Oskar dived ${COLS[dive.col]}.`, 'bad', 'R' + S.ours.length);
  shell.toast(`📓 Oskar scribbles: “${shooter.name} → ${where}, ${kick.type}.”`);
  renderTally();
  await W8(sleep(900), g);
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
  await W8(placeActors(g, shooter, byId.wak), g);
  actors.kicker.look = tellCol - 1;
  if (tellPower) { actors.kicker.pose = 'run'; actors.kicker.speed = 0.35; }
  whoEl.innerHTML = `<img src="${portrait(shooter, 56)}" alt=""><span><b>${shooter.name}</b> to shoot<small>${prof.note}</small></span>`;
  const eyes = ['your left post', 'straight at you', 'your right post'][tellCol];
  showBubble(`<span class="ti">👀</span><span>Eyes on <b>${eyes}</b><br>${tellPower ? '💥 Long run-up (power?)' : '👣 Short run-up (placed?)'}<small>tells are true ~${Math.round(TELL_TRUTH * 100)}%</small></span>`);
  S.sel = { col: 1, row: 1 };

  const committed = await W8(new Promise((resolve) => {
    const refresh = () => {
      const vals = [0, 1].map((r) => [0, 1, 2].map((c) => stopOdds(post, c, r, shooter)));
      renderCells(vals, '', S.sel, heat ? post.cells : null);
      const p = vals[S.sel.row][S.sel.col];
      const colP = [0, 1, 2].map((c) => post.cells[0][c] + post.cells[1][c]);
      const live = prof.live ? ' ' + prof.live(cx) : '';
      oddsEl.innerHTML = `<div class="ol1">📓 ${prof.note}${live}</div>
        <div class="ol2">Your read: ${colP.map((v, i) => `${COL_SHORT[i]} ${Math.round(v * 100)}%`).join(' · ')} · power ${Math.round(post.power * 100)}%</div>
        <div class="ol2">Cover ${cellName(S.sel.col, S.sel.row)} → ${oddsPill(p, 'stop')}</div>`;
      actEl.innerHTML = `
        <button class="btn small ${heat ? 'red' : 'paper'} icon" data-a="heat" title="Heat-map of your read (V)">🔥</button>
        <span class="hint muted">Pick a spot to cover</span>
        <button class="btn go purple" data-a="go">Dive! <span class="key">⏎</span></button>`;
      actEl.querySelector('[data-a=heat]').onclick = () => { sfx.click(); heat = !heat; refresh(); };
      actEl.querySelector('[data-a=go]').onclick = () => { sfx.click(); go(); };
    };
    const go = () => { keymap = {}; onCell = null; resolve({ ...S.sel }); };
    onCell = (c, r) => { S.sel = { col: c, row: r }; refresh(); };
    keymap = {
      ArrowLeft: () => { moveSel(-1, 0); refresh(); }, ArrowRight: () => { moveSel(1, 0); refresh(); },
      ArrowUp: () => { moveSel(0, -1); refresh(); }, ArrowDown: () => { moveSel(0, 1); refresh(); },
      v: () => { heat = !heat; refresh(); }, n: () => notebook(),
      Enter: go, ' ': go,
    };
    refresh();
  }), g);
  actEl.innerHTML = '<div class="wait">…</div>';
  const pShown = stopOdds(post, committed.col, committed.row, shooter);
  const on = Math.random() < onTarget(kick.col, kick.row, kick.type, shooter);
  const saved = on && committed.col === kick.col && Math.random() < saveIfRightCol(committed.row === kick.row, kick.type);
  const res = !on ? 'miss' : saved ? 'save' : 'goal';
  bubble.hidden = true;
  renderCells(null, '', null, null);
  await W8(animateKick(g, kick, committed, res, true), g);
  const rec = { ...kick, res, dive: committed };
  S.theirs.push(rec);
  const where = cellName(kick.col, kick.row);
  const tellTxt = tellCol === kick.col ? 'the eyes told the truth' : 'the eyes were a bluff';
  const n = S.theirs.length;
  if (res === 'goal') shell.log(`⚽ ${shooter.name} scores ${where} (${kick.type}); ${tellTxt}. Wak covered ${cellName(committed.col, committed.row)} (stop was ${Math.round(pShown * 100)}%).`, 'them', 'R' + n);
  else if (res === 'save') shell.log(`🧤 Wak saves ${shooter.name}'s ${where} ${kick.type}! ${tellTxt[0].toUpperCase() + tellTxt.slice(1)}.`, 'good', 'R' + n);
  else shell.log(`💨 ${shooter.name} blazes it over. Wak covered ${cellName(committed.col, committed.row)}.`, 'good', 'R' + n);
  renderTally();
  await W8(sleep(900), g);
}

// ------------------------------------------------------------------ animation
async function placeActors(g, shooter, keeper) {
  actors.keeper = { char: keeper, x: W / 2, y: G.y1 + 2, size: G.h * 0.82, pose: 'ready', facing: 1, look: 0 };
  actors.kicker = { char: shooter, x: W * 0.12, y: H * 1.02, size: H * 0.42, pose: 'run', facing: 1, look: 0 };
  ball.x = G.spot.x; ball.y = G.spot.y; ball.r = W * 0.026; ball.h = 0; ball.vis = true;
  sfx.whistle();
  await W8(tween(actors.kicker, { x: W * 0.3, y: H * 0.99 }, 0.6), g);
  actors.kicker.pose = 'idle';
}
async function animateKick(g, kick, dive, res, wakInGoal) {
  const kk = actors.kicker, kp = actors.keeper;
  kk.pose = 'run'; kk.speed = 1;
  await W8(tween(kk, { x: G.spot.x - W * 0.09, y: G.spot.y + H * 0.1 }, 0.55, { ease: linear }), g);
  kk.pose = 'kick'; sfx.kick();
  const pt = cellPt(kick.col, kick.row);
  let tx = pt.x, ty = pt.y;
  if (res === 'miss') { ty = G.y0 - G.h * 0.55; tx = pt.x + (kick.col - 1) * W * 0.06; }
  // keeper target
  const dp = cellPt(dive.col, dive.row);
  const side = dive.col - 1;
  kp.pose = side === 0 ? (dive.row === 0 ? 'header' : 'ready') : 'dive';
  kp.facing = side < 0 ? 1 : -1;
  const kTo = { x: side === 0 ? W / 2 : dp.x - side * G.w * 0.12, y: dive.row === 0 ? G.y1 - G.h * 0.32 : G.y1 - G.h * 0.02 };
  if (res === 'save') { tx = lerp(tx, kTo.x, 0.35); ty = lerp(ty, dp.y, 0.3); }
  const dur = kick.type === 'power' ? 0.28 : 0.45;
  await W8(Promise.all([
    tween(ball, { x: tx, y: ty, r: W * 0.016 }, dur, { ease: linear, arc: kick.type === 'power' ? 6 : 14 }),
    sleep(60).then(() => tween(kp, kTo, dur * 0.9)),
  ]), g);
  const sx = cv.getBoundingClientRect(), k = sx.width / W;
  if (res === 'goal') {
    ripple = { a: 7, x: tx, y: ty };
    excite = 1;
    freeze(90);
    if (!wakInGoal) {
      sfx.goal(); shell.flash('#fff'); shell.shake(); shell.confetti(); shell.banner('GOAL!', kk.char.name);
      kk.pose = 'celebrate'; kp.pose = 'sad';
    } else {
      sfx.groan(); shell.shake(); shell.banner('GOAL…', kk.char.name, '#ff8a80');
      kk.pose = 'celebrate'; kp.pose = 'sad';
    }
    await W8(tween(ball, { y: ty - G.depth * 0.3, r: W * 0.014 }, 0.15), g);
  } else if (res === 'save') {
    sfx.save(); freeze(140); shell.shake();
    shell.banner('SAVED!', kp.char.name, wakInGoal ? '#9ef0a8' : '#d6c4ff');
    if (wakInGoal) { shell.confetti(80, ['#3BB273', '#FFD23F', '#fff']); kk.pose = 'sad'; } else kk.pose = 'sad';
    await W8(tween(ball, { x: tx + (Math.random() - 0.5) * W * 0.5, y: G.y1 + H * 0.12, r: W * 0.02 }, 0.4, { arc: 30 }), g);
  } else {
    sfx.ooh();
    shell.banner('OVER!', '', wakInGoal ? '#9ef0a8' : '#ff8a80');
    kk.pose = 'sad';
    await W8(tween(ball, { y: ty - 40, r: W * 0.01 }, 0.3), g);
    ball.vis = false;
  }
  shell.popup(res === 'goal' ? '⚽' : res === 'save' ? '🧤' : '💨', sx.left + tx * k, sx.top + ty * k);
  await W8(sleep(1300), g);
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
      <p>Top ${top} · Low ${n - top} → he expects <b>${rd[0] > rd[1] ? 'top' : 'low'}</b> (${Math.round(Math.max(...rd) * 100)}%). Power ${pow} · Placed ${n - pow}.</p>
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
  actEl.innerHTML = '';
  oddsEl.innerHTML = `<div class="ol2" style="font-size:18px;font-family:var(--font-h)">${won ? 'Sunbirds win the shootout!' : 'Redrock win the shootout.'}</div>`;
  if (won) { sfx.win(); shell.confetti(200); } else sfx.lose();
  if (actors.keeper) actors.keeper.pose = won ? 'sad' : 'celebrate';
  if (actors.kicker) actors.kicker.pose = won ? 'celebrate' : 'sad';
  const osk = S.oskar;
  const saves = S.ours.filter((k) => k.res === 'save').length;
  const read = S.ours.filter((k) => k.dive.col === k.col).length;
  shell.log(`${won ? '🏆 Sunbirds' : 'Redrock'} win ${ga}–${gb}. Oskar guessed your side ${read}/${S.ours.length} times.`, 'goal', 'FT');
  await W8(sleep(1200), g);
  const idx = PHASES.findIndex((p) => p.id === S.phase);
  const next = PHASES[(idx + 1) % PHASES.length];
  const v = await shell.modal({
    title: won ? 'Shootout won!' : 'Shootout lost',
    html: `<p style="font-size:22px;font-family:var(--font-h);margin:4px 0">Sunbirds ${ga} – ${gb} Redrock</p>
      <p>Oskar guessed your side <b>${read} of ${S.ours.length}</b> times and saved ${saves}. ${osk.n >= 4 ? 'By the end his notes were sharp.' : ''}</p>
      <div class="notice"><b>What to notice:</b> did you start shooting against your own habits, or did it still feel like a coin flip?</div>`,
    buttons: [{ label: 'Replay', value: 'again' }, { label: `Next: ${next.label}`, value: 'next', cls: 'blue' }],
  });
  if (g !== gen) return;
  shell.setPhase(v === 'next' ? next.id : S.phase);
}
