// Command Duel × Timed Strikes — RPG command menus for 1v1 duels, plus an
// optional Paper Mario style timing check that decides the quality.
import { Shell, oddsPill, pick, clamp } from '../../shared/shell.js';
import { sfx } from '../../shared/sfx.js';
import { byId } from '../../shared/cast.js';
import { drawPlayer, drawBall, Pitch, setupCanvas, portrait, lerp, ease } from '../../shared/art.js';
import { timingCheck, cancelCheck } from './checks.js';
import {
  ZONES, ZONE_SHORT, ZONE_V, RESP, RESP_LABEL, INTENTS, SHOTS, TELL_TRUTH, DEF_TELL, ATT_TELL, SHOT_TELL,
  RIVAL_DEF, RIVAL_ATT, OUR_DEF, PASS_POOL, SPECIALS, DEF_SPECIALS, SPECIAL_COST, COMBO_COST, COMBOS, WIN, SAVE, QMOD,
} from './data.js';

// ------------------------------------------------------------------ shell
const PHASES = [
  { id: 'early', label: 'Kickoff', sub: "0' · 0–0" },
  { id: 'mid', label: '2nd half', sub: "45' · 1–1" },
  { id: 'clutch', label: 'Stoppage', sub: "88' · 1–2 ☾" },
];
const shell = new Shell({
  id: 'command-duel',
  title: 'Command Duel',
  pitch: 'Every step up the pitch is a 1v1. Read the defender, pick a command, then nail the timing.',
  how: [
    'Your carrier faces a named Redrock defender. Pick <b>Dribble</b>, <b>Pass</b>, <b>Shoot</b> (Attack/Box only) or a <b>Special</b> (costs guts).',
    'The defender has secretly picked: <b>Tackle</b> beats Dribble, <b>Mark</b> beats Pass, <b>Press</b> drains stamina.',
    'Read the tell bubble (true ~70%) and the scouting note. The % on each button already counts both.',
    'Then a timing check: Perfect +15%, Miss −20%. Turn checks off with <b>⏱</b> (or T) to compare.',
    'When Redrock has the ball: Tackle / Mark / Press their carrier, then your keeper Wak picks Catch / Punch / Dive.',
    'Keys: 1–5 commands, Esc back, Space/Enter or tap anywhere for timing, arrows for dribbles.',
  ],
  notice: 'Does the timing check add tension or just noise vs the pure menu? Play a few duels with ⏱ ON, then OFF.',
  phases: PHASES,
  onPhase: (id) => startPhase(id),
});

const root = shell.stage;
root.innerHTML = `
<div class="cd">
  <div class="cd-track"></div>
  <div class="cd-bar">
    <div class="guts"><span class="h">GUTS</span><div class="gbar"><i></i></div><b class="gval">0</b></div>
    <button class="tbtn" title="Toggle timing checks (T)">⏱ <span class="tstate">ON</span><span class="kbd">T</span></button>
  </div>
  <div class="duel">
    <canvas></canvas>
    <div class="hud them"></div>
    <div class="hud you"></div>
    <div class="tell" hidden></div>
  </div>
  <div class="cmdpanel panel">
    <div class="scout"></div>
    <div class="read"></div>
    <div class="cmds"></div>
    <div class="rules">Tackle ✕ Dribble · Mark ✕ Pass · Press drains stamina</div>
  </div>
</div>`;
const $ = (s) => root.querySelector(s);
const cv = $('canvas');
const hudThem = $('.hud.them'), hudYou = $('.hud.you'), tellEl = $('.tell');
const cmdsEl = $('.cmds'), scoutEl = $('.scout'), readEl = $('.read');

let timingOn = (() => { try { return localStorage.getItem('cd-timing') !== '0'; } catch { return true; } })();
const tbtn = $('.tbtn');
function renderTiming() { tbtn.querySelector('.tstate').textContent = timingOn ? 'ON' : 'OFF'; tbtn.classList.toggle('off', !timingOn); }
tbtn.onclick = () => {
  timingOn = !timingOn; sfx.click(); renderTiming();
  try { localStorage.setItem('cd-timing', timingOn ? '1' : '0'); } catch {}
  shell.toast(timingOn ? '⏱ Timing checks ON: Perfect +15%, Miss −20%' : '⏱ Timing checks OFF: pure menu, odds as shown');
  shell.log(`Timing checks turned ${timingOn ? 'ON' : 'OFF'}.`, 'info', clockStr());
};
renderTiming();

// ------------------------------------------------------------------ canvas world
let W = 370, H = 250, ctx, pitch;
const cam = { y: 0 };
let A = {}; // actors: us, them, okeep, wkeep
const ball = { x: 0, y: 0, h: 0, spin: 0, owner: null, vis: true };
let T = 0, lastNow = 0, freezeUntil = 0;
const tweens = [];

function layout() {
  W = Math.round(Math.min(Math.max(root.clientWidth, 300), 620));
  H = W < 480 ? Math.round(W * 0.6) : Math.round(W * 0.52);
  ctx = setupCanvas(cv, W, H);
  cv.style.width = '100%'; cv.style.height = 'auto';
  pitch = new Pitch(W, Math.round(W * 2.4), { variant: S?.variant || 'day' });
}
const spotY = (z) => pitch.toPx(0.5, ZONE_V[z])[1];
const sizeUs = () => H * 0.42, sizeThem = () => H * 0.38;

function actor(char, x, y, facing, size) {
  return { char, x, y, facing, size, pose: 'idle', look: 0, alpha: 1, speed: 1, glow: null };
}

function tween(o, to, dur, opt = {}) {
  return new Promise((res) => {
    const from = {};
    for (const k in to) from[k] = o[k];
    tweens.push({ o, from, to, dur: Math.max(0.01, dur), t: 0, e: opt.ease || ease, arc: opt.arc || 0, res });
  });
}
function stepTweens(dt) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    tw.t += dt;
    const k = Math.min(1, tw.t / tw.dur), v = tw.e(k);
    for (const key in tw.to) tw.o[key] = lerp(tw.from[key], tw.to[key], v);
    if (tw.arc) tw.o.h = tw.arc * Math.sin(Math.PI * k);
    if (k >= 1) { tweens.splice(i, 1); tw.res(); }
  }
}
const linear = (k) => k;
const freeze = (ms) => { freezeUntil = performance.now() + ms; };

function frame(now) {
  requestAnimationFrame(frame);
  if (!ctx) return;
  let dt = Math.min(0.05, (now - lastNow) / 1000); lastNow = now;
  if (now < freezeUntil) dt = 0;
  T += dt;
  stepTweens(dt);
  if (ball.owner) { const o = ball.owner; ball.x = o.x + o.facing * o.size * 0.17; ball.y = o.y - 1; ball.h = 0; }
  ball.spin += dt * (ball.owner ? 2 : 14);

  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(0, Math.round(-cam.y + H / 2));
  pitch.draw(ctx, T, dt);
  const list = [A.okeep, A.wkeep, A.us, A.them].filter((a) => a && a.alpha > 0.01).sort((a, b) => a.y - b.y);
  let ballDrawn = false;
  for (const a of list) {
    if (!ballDrawn && ball.vis && ball.y < a.y) { drawBall(ctx, ball.x, ball.y, H * 0.03, ball.spin, ball.h); ballDrawn = true; }
    drawPlayer(ctx, a.char, a.x, a.y, { size: a.size, pose: a.pose, t: T, facing: a.facing, look: a.look, alpha: a.alpha, glow: a.glow, speed: a.speed });
  }
  if (!ballDrawn && ball.vis) drawBall(ctx, ball.x, ball.y, H * 0.03, ball.spin, ball.h);
  pitch.drawFront(ctx, T);
  ctx.restore();
  // dramatic letterbox gradient so the HUD reads
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(10,14,30,.45)'); g.addColorStop(0.22, 'rgba(10,14,30,0)');
  g.addColorStop(0.8, 'rgba(10,14,30,0)'); g.addColorStop(1, 'rgba(10,14,30,.4)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
requestAnimationFrame(frame);

function popAt(a, text, color = '#fff') {
  const r = cv.getBoundingClientRect(), k = r.width / W;
  shell.popup(text, r.left + a.x * k, r.top + (a.y - cam.y + H / 2 - a.size * 0.9) * k, color);
}

// ------------------------------------------------------------------ state
let S = null;
let gen = 0;
const CANCEL = Symbol('cancel');
async function W8(p, g) { const v = await p; if (g !== gen) throw CANCEL; return v; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const START = {
  early: { min: 0, step: 3, end: 90, us: 0, them: 0, guts: 30, zone: 2, carrier: 'kenji', variant: 'day', sol: false, tired: 0 },
  mid: { min: 45, step: 3, end: 90, us: 1, them: 1, guts: 70, zone: 2, carrier: 'lupe', variant: 'dusk', sol: true, tired: 1 },
  clutch: { min: 88, step: 1.5, end: 95, us: 1, them: 2, guts: 100, zone: 3, carrier: 'kenji', variant: 'night', sol: true, tired: 3 },
};

function startPhase(id) {
  gen++;
  cancelCheck();
  tweens.length = 0;
  const st = START[id];
  S = {
    phase: id, min: st.min, step: st.step, end: st.end, score: { us: st.us, them: st.them }, guts: st.guts,
    zone: st.zone, carrier: st.carrier, poss: 'us', last: null, theirLast: null, variant: st.variant, sol: st.sol,
    sta: {}, stats: { duels: 0, perfect: 0, miss: 0 },
  };
  for (const id of Object.keys(byId)) S.sta[id] = Math.max(2, byId[id].stats.stamina - st.tired);
  layout();
  A = {
    okeep: actor(byId.oskar, W / 2, pitch.y0 + 4, 1, H * 0.24),
    wkeep: actor(byId.wak, W / 2, pitch.y1 - 2, 1, H * 0.24),
  };
  A.okeep.pose = 'ready'; A.wkeep.pose = 'ready';
  cam.y = spotY(S.zone);
  updateTop();
  const intro = { early: 'Kickoff. Kenji has the ball in midfield. Guts are low, so Hans will be tackle-happy.',
    mid: "Second half, 1–1. Guts 70: enough for a Special. Sol is on the bench… and now on the pitch.",
    clutch: "88', 1–2 down under the lights. Full guts: Kenji + Rio can fire the Golden Thread combo." }[id];
  shell.log(intro, 'info', clockStr());
  sfx.whistle();
  run(gen);
}

function clockStr() { if (!S) return ''; const m = S.min; return m <= 90 ? `${Math.floor(m)}'` : `90+${Math.ceil(m - 90)}'`; }
function updateTop() {
  shell.setScore({ home: S.score.us, away: S.score.them, clock: clockStr() });
  $('.gbar i').style.width = S.guts + '%';
  $('.gval').textContent = Math.round(S.guts);
  $('.guts').classList.toggle('full', S.guts >= COMBO_COST);
  const ours = S.poss === 'us';
  $('.cd-track').innerHTML = ZONE_SHORT.map((z, i) =>
    `<div class="zp ${i === S.zone ? 'on ' + (ours ? 'us' : 'them') : ''}">${i === S.zone ? '<span class="bl">⚽</span>' : ''}${z}</div>`).join('<span class="arrow">›</span>');
}
function addGuts(n) { S.guts = clamp(S.guts + n, 0, 100); updateTop(); }

// ------------------------------------------------------------------ probability helpers
const P = (p) => clamp(p, 0.05, 0.95);
function sample(dist) { let r = Math.random(), last; for (const k in dist) { if (dist[k] <= 0) continue; last = k; r -= dist[k]; if (r <= 0) return k; } return last; }
function norm(d) { const s = Object.values(d).reduce((a, b) => a + b, 0); const o = {}; for (const k in d) o[k] = d[k] / s; return o; }
function tellOf(dist, actual) {
  if (Math.random() < TELL_TRUTH) return actual;
  const others = Object.keys(dist).filter((k) => k !== actual && dist[k] > 0);
  return others.length ? pick(others) : actual;
}
// What you can infer: prior (from the scouting note) × how reliable the tell is.
function posterior(prior, tell) {
  const keys = Object.keys(prior).filter((k) => prior[k] > 0);
  const lie = (1 - TELL_TRUTH) / Math.max(1, keys.length - 1);
  const o = {};
  for (const k of keys) o[k] = prior[k] * (k === tell ? TELL_TRUTH : lie);
  return norm(o);
}
const expect = (post, f) => Object.keys(post).reduce((s, k) => s + post[k] * f(k), 0);
const fatigue = (id) => (S.sta[id] < 5 ? -(5 - S.sta[id]) * 0.04 : 0);

function pDribble(c, d, r) {
  const p = 0.55 + (c.stats.dribble - d.stats.tackle) * 0.05 + fatigue(c.id);
  return P(p + (r === 'tackle' ? -0.35 : r === 'mark' ? 0.25 : -0.08));
}
function pPass(c, recv, d, r) {
  const p = 0.62 + (c.stats.pass - 6) * 0.04 + (recv.stats.pace - 6) * 0.015 + fatigue(c.id);
  return P(p + (r === 'mark' ? -0.35 : r === 'tackle' ? 0.25 : -0.08));
}
function shotBase(c, zone) {
  let p = (0.12 + c.stats.shoot * 0.04) * (zone >= 4 ? 1 : 0.55);
  if (c.id === 'sol' && S.min >= 80) p += 0.08;
  return p + fatigue(c.id) * 0.5;
}
function pShoot(c, zone, r, bonus = 0) {
  return P((shotBase(c, zone) + bonus) * (r === 'tackle' ? 0.55 : r === 'press' ? 0.85 : 1));
}
const withQ = (p, q) => P(p + QMOD[q]);

// ------------------------------------------------------------------ UI pieces
function statLine(c, keys) { return keys.map((k) => `${k.slice(0, 3).toUpperCase()} ${c.stats[k]}`).join(' · '); }
function hud(el, c, keys, label) {
  const sta = S.sta[c.id];
  el.innerHTML = `<img src="${portrait(c, 64)}" alt=""><div class="hi"><b>${c.name}</b><small>${label ? label + ' · ' : ''}${statLine(c, keys)}</small>
    <div class="sbar ${sta < 5 ? 'low' : ''}" title="Stamina"><i style="width:${sta * 10}%"></i></div></div>`;
  el.classList.toggle('red', c.team === 'red');
}
function showTell(tell, text) {
  tellEl.hidden = false;
  tellEl.className = 'tell';
  tellEl.innerHTML = `<span class="ti">${tell.icon}</span><span>${text}<small>tells are true ~${Math.round(TELL_TRUTH * 100)}%</small></span>`;
}
function revealTell(label, truthful) {
  tellEl.className = 'tell reveal ' + (truthful ? 'true' : 'bluff');
  tellEl.innerHTML = `<span class="ti">${truthful ? '✔' : '✘'}</span><span>${label}!<small>${truthful ? 'the tell was honest' : 'the tell was a bluff'}</small></span>`;
}
function scout(note, active, extra = '') {
  scoutEl.innerHTML = `<span class="nb">📓</span><span>${note}${active ? ' <b class="act">ACTIVE NOW</b>' : ''}${extra}</span>`;
}
function readBar(post, labels) {
  const cols = { tackle: '#E8463A', mark: '#7B4FC9', press: '#E07A1F', dribble: '#E07A1F', pass: '#7B4FC9', shoot: '#E8463A', normal: '#8a8fa8', power: '#E8463A', placed: '#7B4FC9' };
  readEl.innerHTML = `<span class="rl">Read</span><div class="rbar">${Object.keys(post).map((k) =>
    `<i style="flex:${Math.max(post[k], 0.001)};background:${cols[k]}" title="${labels[k]}"><em>${post[k] >= 0.3 ? labels[k] + ' ' : post[k] >= 0.12 ? labels[k][0] + ' ' : ''}${post[k] >= 0.07 ? Math.round(post[k] * 100) + '%' : ''}</em></i>`).join('')}</div>`;
}

// Command menu. items: {label, sub, odds, cls, disabled, value, wide, img, cost}
let keymap = {};
function menu(items, { back = false } = {}) {
  return new Promise((resolve) => {
    cmdsEl.innerHTML = '';
    keymap = {};
    let n = 0;
    const done = (v) => { keymap = {}; cmdsEl.querySelectorAll('button').forEach((b) => (b.disabled = true)); resolve(v); };
    for (const it of items) {
      const b = document.createElement('button');
      const key = it.key ?? String(++n);
      b.className = `btn cmd ${it.cls || ''} ${it.wide ? 'wide' : ''}`;
      b.disabled = !!it.disabled;
      b.innerHTML = `<span class="key">${key}</span>${it.img ? `<img src="${it.img}" alt="">` : ''}<span class="lbl">${it.label}${it.sub ? `<small>${it.sub}</small>` : ''}</span>${
        it.odds != null ? oddsPill(it.odds) : ''}${it.cost ? `<span class="cost">${it.cost}g</span>` : ''}`;
      const go = () => { if (b.disabled) return; sfx.click(); done(it.value); };
      b.onclick = go;
      if (!it.disabled) keymap[key] = go;
      cmdsEl.appendChild(b);
    }
    if (back) {
      const b = document.createElement('button');
      b.className = 'btn cmd ghost small wide';
      b.innerHTML = '<span class="key">Esc</span><span class="lbl">Back</span>';
      b.onclick = () => { sfx.click(); done('back'); };
      keymap.Escape = keymap['0'] = b.onclick;
      cmdsEl.appendChild(b);
    }
  });
}
function idleMenu(text) { keymap = {}; cmdsEl.innerHTML = `<div class="wait">${text}</div>`; }

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.tc-wrap,.sheet-wrap')) return;
  if (e.key === 't' || e.key === 'T') { tbtn.click(); return; }
  const f = keymap[e.key];
  if (f) { e.preventDefault(); f(); }
});

// ------------------------------------------------------------------ staging
async function stageDuel(g, ours, theirs, oursHasBall) {
  const sy = spotY(S.zone);
  tellEl.hidden = true;
  A.us = actor(ours, -W * 0.25, sy + H * 0.38, 1, sizeUs());
  A.them = actor(theirs, W * 1.25, sy - H * 0.02, -1, sizeThem());
  A.us.pose = A.them.pose = 'run';
  ball.vis = true; ball.owner = oursHasBall ? A.us : A.them;
  if (!oursHasBall) A.them.facing = -1;
  hud(hudYou, ours, oursHasBall ? ['dribble', 'pass', 'shoot'] : ['tackle', 'pace'], '');
  hud(hudThem, theirs, oursHasBall ? ['tackle', 'pace'] : ['dribble', 'pass', 'shoot'], '');
  updateTop();
  await W8(Promise.all([
    tween(cam, { y: sy }, 0.55),
    tween(A.us, { x: W * 0.3 }, 0.55),
    tween(A.them, { x: W * 0.7 }, 0.55),
  ]), g);
  A.us.pose = 'idle'; A.them.pose = 'idle';
}
function tellPose(a, kind) {
  a.speed = 1; a.look = 0;
  if (kind === 'tackle' || kind === 'dribble') a.pose = 'ready';
  else if (kind === 'mark' || kind === 'pass') { a.pose = 'idle'; a.look = -1; }
  else if (kind === 'press') { a.pose = 'run'; a.speed = 0.45; }
  else if (kind === 'shoot') { a.pose = 'idle'; a.look = 1; }
}

// ------------------------------------------------------------------ main loop
async function run(g) {
  try {
    while (S.min < S.end) {
      S.stats.duels++;
      if (S.poss === 'us') await offense(g); else await defense(g);
      if (g !== gen) return;
      S.min += S.step;
      addGuts(5); // guts regen every encounter
      updateTop();
    }
    await fullTime(g);
  } catch (e) { if (e !== CANCEL) throw e; }
}

function passOptions(car, z) {
  const tz = Math.min(4, z + 1);
  let pool = PASS_POOL[tz].filter((id) => id !== car.id && (id !== 'sol' || S.sol));
  if (tz === 4 && z === 4) pool = PASS_POOL[4].filter((id) => id !== car.id && (id !== 'sol' || S.sol));
  const combo = COMBOS.find((c) => c.a === car.id && z >= c.minZone);
  const forced = combo ? [combo.b] : [];
  const rest = pool.filter((id) => !forced.includes(id)).sort((a, b) => ((a.charCodeAt(1) + S.stats.duels) % 5) - ((b.charCodeAt(1) + S.stats.duels) % 5));
  return [...forced, ...rest].slice(0, 2).map((id) => byId[id]);
}

// ---------------- attacking duel
async function offense(g) {
  const z = S.zone;
  const car = byId[S.carrier];
  const dm = RIVAL_DEF[z], dc = byId[dm.id];
  idleMenu(`${car.name} carries into ${ZONES[z].toLowerCase()}…`);
  await stageDuel(g, car, dc, true);
  const c = { sta: S.sta[car.id], last: S.last, guts: S.guts };
  const prior = norm(dm.prior(c));
  const resp = sample(prior);
  const opts = passOptions(car, z);
  const tell = tellOf(prior, resp);
  const post = posterior(prior, tell);
  tellPose(A.them, tell);
  showTell(DEF_TELL[tell], DEF_TELL[tell].text.replace('{r}', opts[0]?.name || 'a teammate'));
  scout(dm.note, dm.active(c));
  readBar(post, RESP_LABEL);
  hud(hudYou, car, ['dribble', 'pass', 'shoot'], ZONES[z]);

  const canShoot = z >= 3;
  const sp = SPECIALS[car.id];
  const spOk = sp && S.guts >= SPECIAL_COST && (sp.base !== 'shoot' || canShoot);
  const spOdds = sp ? (sp.base === 'shoot' ? P(shotBase(car, z) + (typeof sp.bonus === 'function' ? sp.bonus(S) : sp.bonus)) : sp.p) : null;
  const combo = COMBOS.find((cb) => cb.a === car.id && z >= cb.minZone);
  const comboOdds = combo ? P(shotBase(byId[combo.b], 4) + combo.bonus) : null;
  const dOdds = expect(post, (r) => pDribble(car, dc, r));
  const passOdds = opts.map((o) => expect(post, (r) => pPass(car, o, dc, r)));
  const sOdds = canShoot ? expect(post, (r) => pShoot(car, z, r)) : 0;

  let choice;
  for (;;) {
    const items = [
      { label: 'Dribble', sub: z === 4 ? 'round him, through on goal' : 'beat him, move up', odds: dOdds, value: 'dribble', cls: 'blue' },
      { label: 'Pass ▸', sub: opts.map((o) => o.name).join(' / '), odds: Math.max(...passOdds), value: 'pass', cls: 'green' },
      { label: 'Shoot', sub: canShoot ? (z === 4 ? 'from the box' : 'from range, Oskar −15%') : 'only in Attack / Box', odds: canShoot ? sOdds : null, value: 'shoot', cls: 'red', disabled: !canShoot },
      sp
        ? { label: `★ ${car.special.name}`, sub: sp.base === 'shoot' && !canShoot ? 'needs Attack / Box' : sp.text, odds: spOdds, value: 'special', cls: 'purple', disabled: !spOk, cost: SPECIAL_COST }
        : { label: '★ Special', sub: 'none for this player', disabled: true, value: 'special', cls: 'purple' },
    ];
    if (combo) items.push({ label: `✦ ${combo.name}`, sub: `${combo.text} · goal chance`, odds: comboOdds, value: 'combo', cls: 'gold', wide: true, disabled: S.guts < COMBO_COST, cost: COMBO_COST });
    choice = await W8(menu(items), g);
    if (choice !== 'pass') break;
    const to = await W8(menu(opts.map((o, i) => ({ label: o.name, sub: `${o.pos} · pace ${o.stats.pace}${COMBOS.some((cb) => cb.a === car.id && cb.b === o.id) ? ' · combo partner' : ''}`, odds: passOdds[i], value: o, img: portrait(o, 56), cls: 'green' })), { back: true }), g);
    if (to !== 'back') { choice = { type: 'pass', to }; break; }
  }
  if (typeof choice === 'string') choice = { type: choice };
  idleMenu('…');

  // ----- commit
  if (choice.type === 'special') {
    addGuts(-SPECIAL_COST);
    A.us.glow = '#FFD23F';
    await W8(shell.cutIn(car, car.special.name, sp.text), g);
  }
  if (choice.type === 'combo') {
    addGuts(-COMBO_COST);
    const b = byId[combo.b];
    await W8(shell.cutIn(car, combo.name, `${car.name} → ${b.name}`), g);
    return comboShot(g, car, b, combo);
  }
  const base = choice.type === 'special' ? sp.base : choice.type;
  const kind = base === 'dribble' ? 'arrows' : base === 'pass' ? 'bar' : 'shot';
  const q = timingOn ? await W8(timingCheck(kind, { title: { arrows: `Beat ${dc.name}!`, bar: 'Weight the pass!', shot: 'Strike it clean!' }[kind] }), g) : 'off';
  noteQ(q);
  A.us.glow = null;

  // ----- reveal
  const ignore = choice.type === 'special';
  if (!ignore) {
    tellPose(A.them, resp);
    revealTell(RESP_LABEL[resp], tell === resp);
    popAt(A.them, RESP_LABEL[resp].toUpperCase() + '!', '#ffb3ab');
    if (resp === 'press') {
      S.sta[car.id] = Math.max(1, S.sta[car.id] - 2.5);
      hud(hudYou, car, ['dribble', 'pass', 'shoot'], ZONES[z]);
      shell.log(`${dc.name} pressed: ${car.name} loses 2.5 stamina (now ${S.sta[car.id].toFixed(1)}).`, 'them', clockStr());
    }
    await W8(sleep(450), g);
  } else tellEl.hidden = true;
  const why = tell === resp ? `the tell (${DEF_TELL[tell].why}) was honest` : `the ${DEF_TELL[tell].why} was a bluff`;
  const qTxt = q === 'off' ? '' : ` · ${q}`;

  if (base === 'dribble') {
    const p = ignore ? withQ(sp.p, q) : withQ(pDribble(car, dc, resp), q);
    const ok = Math.random() < p;
    S.last = 'dribble';
    S.sta[car.id] = Math.max(1, S.sta[car.id] - 1.5);
    if (ok) {
      const adv = ignore ? sp.adv : 1;
      shell.log(ignore ? `★ ${car.special.name}! ${car.name} goes straight past ${dc.name} (${pct(p)}${qTxt}).`
        : resp === 'tackle' ? `${car.name} beat ${dc.name}'s tackle anyway (${pct(p)}${qTxt}).` : `${car.name} skins ${dc.name}: he chose ${RESP_LABEL[resp]}, ${why} (${pct(p)}${qTxt}).`, 'good', clockStr());
      addGuts(8);
      await dribblePast(g);
      if (z === 4) return throughOnGoal(g, car, 0.2, 'rounds the last man');
      S.zone = Math.min(4, z + adv);
    } else {
      shell.log(`${dc.name} ${resp === 'tackle' ? 'read the dribble' : 'stopped the dribble'} and won it: ${why} (${pct(p)}${qTxt}).`, 'bad', clockStr());
      await tackled(g, A.them, A.us);
      turnover(z);
    }
    return;
  }
  if (base === 'pass') {
    const to = choice.to || (sp.to ? byId[sp.to] : opts[0]);
    const p = ignore ? withQ(sp.p, q) : withQ(pPass(car, to, dc, resp), q);
    const ok = Math.random() < p;
    S.last = 'pass';
    if (ignore && sp.restore) { for (const id in S.sta) if (byId[id].team === 'sun') S.sta[id] = Math.min(byId[id].stats.stamina, S.sta[id] + 3); shell.log('Engine Room: Sunbirds stamina +3.', 'good', clockStr()); }
    if (ok) {
      const adv = ignore ? sp.adv : 1;
      shell.log(ignore ? `★ ${car.special.name}: ${car.name} finds ${to.name} (${pct(p)}${qTxt}).`
        : resp === 'mark' ? `${car.name} squeezed it past ${dc.name}'s marking to ${to.name} (${pct(p)}${qTxt}).` : `${car.name} → ${to.name}. ${dc.name} went for ${RESP_LABEL[resp]}: ${why} (${pct(p)}${qTxt}).`, 'good', clockStr());
      addGuts(6);
      await passAway(g);
      S.carrier = to.id;
      if (z === 4) return throughOnGoal(g, to, 0.12, 'gets a cut-back');
      S.zone = Math.min(4, z + adv);
    } else {
      shell.log(`${dc.name} ${resp === 'mark' ? 'read the pass and cut it out' : 'got a foot to the pass'}: ${why} (${pct(p)}${qTxt}).`, 'bad', clockStr());
      await intercepted(g);
      turnover(z);
    }
    return;
  }
  // shoot (normal or special)
  const bonus = ignore ? (typeof sp.bonus === 'function' ? sp.bonus(S) : sp.bonus) : 0;
  const p = ignore ? withQ(shotBase(car, z) + bonus, q) : withQ(pShoot(car, z, resp), q);
  S.last = 'shoot';
  const blocked = !ignore && resp === 'tackle' && Math.random() < 0.5;
  await shoot(g, car, p, { blocked, by: dc, note: ignore ? `★ ${car.special.name}` : `${dc.name} chose ${RESP_LABEL[resp]}`, qTxt, z });
}

function noteQ(q) {
  if (q === 'perfect') { S.stats.perfect++; addGuts(10); }
  if (q === 'miss') S.stats.miss++;
}
const pct = (p) => Math.round(p * 100) + '%';

function turnover(z) {
  S.poss = 'them'; S.zone = z; S.last = null;
  A.us.pose = 'sad';
}

async function throughOnGoal(g, car, bonus, how) {
  shell.log(`${car.name} ${how}: one-on-one with Big Oskar (+${Math.round(bonus * 100)}%).`, 'good', clockStr());
  scout('Big Oskar: two metres tall, shots from range lose 15%.', false);
  readEl.innerHTML = '';
  tellEl.hidden = true;
  A.them.alpha = 0;
  if (A.us.char.id !== car.id) A.us = actor(car, W * 0.6, cam.y + H * 0.3, 1, sizeUs());
  A.us.alpha = 1; A.us.pose = 'idle'; ball.owner = A.us;
  hud(hudYou, car, ['shoot', 'pace'], 'Box');
  const q = timingOn ? await W8(timingCheck('shot', { title: 'Finish it!' }), g) : 'off';
  noteQ(q);
  await shoot(g, car, withQ(shotBase(car, 4) + bonus, q), { note: 'one-on-one', qTxt: q === 'off' ? '' : ` · ${q}`, z: 4 });
}

async function comboShot(g, a, b, combo) {
  // a passes, b receives in the box and hits it first time.
  ball.owner = null;
  A.us.pose = 'pass'; sfx.pass();
  const sy = spotY(4);
  await W8(Promise.all([tween(ball, { x: W * 0.5, y: sy }, 0.5, { arc: 30 }), tween(cam, { y: sy }, 0.5)]), g);
  await W8(shell.cutIn(b, combo.name, `${b.name} first time!`), g);
  A.us = actor(b, W * 0.45, sy + H * 0.36, 1, sizeUs()); A.us.glow = '#FFD23F';
  A.them.alpha = 0;
  hud(hudYou, b, ['shoot', 'pace'], 'Box');
  ball.x = A.us.x + 18; ball.y = A.us.y;
  const q = timingOn ? await W8(timingCheck('shot', { title: `${b.name}, first time!` }), g) : 'off';
  noteQ(q);
  A.us.glow = null;
  S.carrier = b.id;
  await shoot(g, b, withQ(shotBase(b, 4) + combo.bonus, q), { note: `✦ ${combo.name}`, qTxt: q === 'off' ? '' : ` · ${q}`, z: 4 });
}

// ---------------- animations (attack)
async function dribblePast(g) {
  A.us.pose = 'run'; A.them.pose = 'slide';
  sfx.whoosh();
  await W8(Promise.all([
    tween(A.us, { x: W * 0.82, y: A.us.y - H * 0.42 }, 0.55),
    tween(A.them, { x: W * 0.5, y: A.them.y + H * 0.1 }, 0.4),
  ]), g);
  A.them.pose = 'sad';
  await W8(Promise.all([tween(A.us, { y: A.us.y - H * 0.5, alpha: 0 }, 0.35), tween(cam, { y: cam.y - H * 0.4 }, 0.5)]), g);
}
async function tackled(g, tackler, victim) {
  tackler.pose = 'slide';
  await W8(tween(tackler, { x: victim.x + victim.facing * victim.size * 0.25, y: victim.y - 4 }, 0.28, { ease: linear }), g);
  sfx.thud(); freeze(160); shell.shake(); shell.flash('rgba(255,255,255,.6)');
  popAt(victim, 'WHAM!', '#ffd23f');
  ball.owner = null; victim.pose = 'sad';
  await W8(tween(ball, { x: tackler.x + 20, y: tackler.y + 6 }, 0.3, { arc: 14 }), g);
  ball.owner = tackler;
  await W8(sleep(500), g);
}
async function passAway(g) {
  A.us.pose = 'pass'; sfx.pass(); ball.owner = null;
  await W8(tween(ball, { x: W * 0.6, y: ball.y - H * 0.9 }, 0.5, { arc: 22 }), g);
  A.them.pose = 'sad';
}
async function intercepted(g) {
  A.us.pose = 'pass'; sfx.pass(); ball.owner = null;
  A.them.pose = 'header';
  await W8(tween(ball, { x: A.them.x - 10, y: A.them.y - 4 }, 0.32, { arc: 18 }), g);
  sfx.thud(); freeze(120); shell.shake();
  ball.owner = A.them; A.them.pose = 'idle'; A.us.pose = 'sad';
  popAt(A.them, 'CUT OUT!', '#ffb3ab');
  await W8(sleep(500), g);
}

async function shoot(g, car, p, o) {
  const goal = Math.random() < p;
  // camera up to the goal, shooter steps in
  const gy = pitch.y0;
  const sh = A.us;
  sh.pose = 'run'; sh.alpha = 1; ball.owner = sh;
  await W8(Promise.all([
    tween(cam, { y: gy + H * 0.28 }, 0.55),
    tween(sh, { x: W * 0.42, y: gy + H * 0.66 }, 0.55),
    o.blocked ? tween(A.them, { x: W * 0.58, y: gy + H * 0.52 }, 0.55) : tween(A.them, { alpha: 0 }, 0.3),
  ]), g);
  sh.pose = 'kick'; sfx.kick(); ball.owner = null;
  const side = Math.random() < 0.5 ? -1 : 1;
  const ok = A.okeep;
  if (!goal && o.blocked) {
    A.them.pose = 'slide';
    await W8(tween(ball, { x: A.them.x, y: A.them.y - 6 }, 0.18, { arc: 8 }), g);
    sfx.thud(); freeze(150); shell.shake();
    popAt(A.them, 'BLOCKED!', '#ffb3ab');
    shell.log(`${o.by.name} threw himself in front: shot blocked (${pct(p)}${o.qTxt}). ${o.by.name} tackled, so the shot was always in danger.`, 'bad', clockStr());
    await tween(ball, { x: W * 0.8, y: ball.y + 20 }, 0.4, { arc: 12 });
    await W8(sleep(500), g);
    S.poss = 'them'; S.zone = Math.min(4, o.z); S.last = null;
    return;
  }
  const tx = W / 2 + side * pitch.goalW * (goal ? 0.4 : 0.22);
  ok.pose = 'dive'; ok.facing = goal ? -side : side;
  await W8(Promise.all([
    tween(ball, { x: tx, y: gy + (goal ? -pitch.netDepth * 0.6 : 2) }, 0.38, { arc: 16, ease: linear }),
    tween(ok, { x: W / 2 + side * pitch.goalW * (goal ? -0.12 : 0.22) }, 0.3),
  ]), g);
  if (goal) {
    pitch.goal(true);
    S.score.us++;
    sfx.goal(); shell.flash('#fff'); shell.shake(); shell.confetti(); shell.banner('GOAL!', `${car.name} · ${clockStr()}`);
    sh.pose = 'celebrate';
    shell.log(`⚽ GOAL! ${car.name} scores (${o.note}, ${pct(p)}${o.qTxt}).`, 'goal', clockStr());
    updateTop();
    await W8(sleep(1900), g);
    // they kick off
    S.poss = 'them'; S.zone = 2; S.theirLast = null; S.last = null;
  } else {
    sfx.save(); popAt(ok, 'SAVED!', '#d6c4ff');
    shell.log(`Big Oskar saves from ${car.name} (${o.note}, ${pct(p)}${o.qTxt}).`, 'bad', clockStr());
    ball.owner = ok;
    await W8(sleep(900), g);
    ball.owner = null;
    S.poss = 'them'; S.zone = 4; S.last = null;
  }
  ok.pose = 'ready'; ok.facing = 1;
  await tween(ok, { x: W / 2 }, 0.3);
}

// ---------------- defending duel
async function defense(g) {
  const z = S.zone;
  const am = RIVAL_ATT[z], ac = byId[am.id];
  const dc = byId[OUR_DEF[z]];
  idleMenu(`${ac.name} has it in ${['your box', 'your half', 'midfield', 'his half', 'his own box'][z]}…`);
  await stageDuel(g, dc, ac, false);
  const c = { sta: S.sta[ac.id], last: S.theirLast };
  const prior = norm(am.prior(c));
  const intent = sample(prior);
  const tell = tellOf(prior, intent);
  const post = posterior(prior, tell);
  tellPose(A.them, tell);
  showTell(ATT_TELL[tell], ATT_TELL[tell].text);
  scout(am.note, am.active(c));
  const iLabels = { dribble: 'Dribble', pass: 'Pass', shoot: 'Shoot' };
  readBar(post, iLabels);
  hud(hudYou, dc, ['tackle', 'pace'], 'Defending');

  const odds = (r) => expect(post, (i) => pWin(dc, ac, r, i));
  const dsp = DEF_SPECIALS[dc.id];
  const choice = await W8(menu([
    { label: 'Tackle', sub: 'beats Dribble', odds: odds('tackle'), value: 'tackle', cls: 'red' },
    { label: 'Mark', sub: 'beats Pass', odds: odds('mark'), value: 'mark', cls: 'purple' },
    { label: 'Press', sub: 'so-so vs all · tires him', odds: odds('press'), value: 'press', cls: 'blue' },
    dsp ? { label: `★ ${dc.special.name}`, sub: dsp.text, odds: 1, value: 'special', cls: 'gold', disabled: S.guts < SPECIAL_COST, cost: SPECIAL_COST }
      : { label: '★ Special', sub: `${dc.name} has no defensive special`, disabled: true, value: 'special', cls: 'gold' },
  ]), g);
  idleMenu('…');
  if (choice === 'special') {
    addGuts(-SPECIAL_COST);
    await W8(shell.cutIn(dc, dc.special.name, dsp.text), g);
  }
  const kind = choice === 'press' ? 'arrows' : 'bar';
  const q = choice === 'special' || !timingOn ? 'off' : await W8(timingCheck(kind, { title: choice === 'press' ? `Hound ${ac.name}!` : choice === 'mark' ? 'Step into the lane!' : 'Time the tackle!', green: choice === 'mark' ? 0.3 : 0.24 }), g);
  noteQ(q);
  tellPose(A.them, intent);
  revealTell(iLabels[intent], tell === intent);
  popAt(A.them, iLabels[intent].toUpperCase() + '!', '#ffb3ab');
  await W8(sleep(420), g);
  const why = tell === intent ? `his tell (${ATT_TELL[tell].why}) was honest` : `the ${ATT_TELL[tell].why} was a bluff`;
  const qTxt = q === 'off' ? '' : ` · ${q}`;
  const p = choice === 'special' ? 1 : withQ(pWin(dc, ac, choice, intent), q);
  const win = Math.random() < p;
  if (win) {
    shell.log(choice === 'special' ? `★ ${dc.special.name}! ${dc.name} wins it from ${ac.name}.`
      : `${dc.name} ${choice === 'tackle' ? 'tackles' : choice === 'mark' ? 'intercepts' : 'harries'} ${ac.name}: he went to ${intent}, ${why} (${pct(p)}${qTxt}).`, 'good', clockStr());
    addGuts(8);
    await tackled(g, A.us, A.them);
    A.us.pose = 'idle';
    S.poss = 'us'; S.carrier = dc.id; S.last = null;
    if (choice === 'special') {
      if (dc.id === 'tomo') { S.zone = Math.min(4, z + 1); S.carrier = 'kenji'; shell.log('Clean Sweep: Tomo pings a free pass to Kenji.', 'good', clockStr()); }
      if (dc.id === 'mo') { S.zone = Math.min(4, z + 1); S.carrier = 'lupe'; shell.log('Thunder Head: Mo heads it clear to Lupe.', 'good', clockStr()); }
      if (dc.id === 'lupe') { for (const id in S.sta) if (byId[id].team === 'sun') S.sta[id] = Math.min(byId[id].stats.stamina, S.sta[id] + 3); shell.log('Engine Room: Sunbirds stamina +3.', 'good', clockStr()); }
    }
    return;
  }
  S.theirLast = intent;
  if (choice === 'press') { S.sta[ac.id] = Math.max(1, S.sta[ac.id] - 3); }
  shell.log(`${ac.name} ${intent === 'dribble' ? 'skips past' : intent === 'pass' ? 'passes around' : 'gets a shot away past'} ${dc.name}: you chose ${choice}, ${why} (${pct(p)}${qTxt}).${choice === 'press' ? ` Your press cost him 3 stamina (${S.sta[ac.id].toFixed(1)}).` : ''}`, 'them', clockStr());
  if (intent === 'shoot' || z === 0) return keeperDuel(g, ac, intent === 'shoot' ? '' : 'through on goal');
  // they move down a zone
  if (intent === 'dribble') {
    A.us.pose = 'slide'; A.them.pose = 'run'; sfx.whoosh();
    await W8(Promise.all([tween(A.them, { x: W * 0.25, y: A.them.y + H * 0.55 }, 0.55), tween(A.us, { x: W * 0.5 }, 0.35)]), g);
  } else {
    A.them.pose = 'pass'; sfx.pass(); ball.owner = null;
    await W8(tween(ball, { x: W * 0.4, y: ball.y + H * 0.9 }, 0.5, { arc: 20 }), g);
  }
  A.us.pose = 'sad';
  await W8(tween(cam, { y: cam.y + H * 0.4 }, 0.4), g);
  S.zone = z - 1;
}
function pWin(dc, ac, r, i) {
  const stat = ac.stats[i === 'dribble' ? 'dribble' : i === 'pass' ? 'pass' : 'shoot'];
  const tired = S.sta[ac.id] < 5 ? (5 - S.sta[ac.id]) * 0.04 : 0;
  return P(WIN[r][i] + (dc.stats.tackle - stat) * 0.03 + tired);
}

async function keeperDuel(g, shooter, how) {
  const am = RIVAL_ATT.find((m) => m.id === shooter.id) || {};
  const prior = norm(am.shot || { normal: 0.45, power: 0.3, placed: 0.25 });
  const type = sample(prior);
  const tell = tellOf(prior, type);
  const post = posterior(prior, tell);
  const gy = pitch.y1;
  const wk = A.wkeep;
  // camera down to your goal
  A.them.pose = 'run';
  await W8(Promise.all([
    tween(cam, { y: gy - H * 0.28 }, 0.6),
    tween(A.them, { x: W * 0.56, y: gy - H * 0.36, alpha: 1 }, 0.6),
    tween(A.us, { alpha: 0 }, 0.3),
  ]), g);
  A.them.pose = 'idle'; A.them.look = 0;
  if (type === 'power' && tell === 'power') A.them.pose = 'ready';
  ball.owner = A.them;
  hud(hudYou, byId.wak, ['keep', 'pace'], 'Keeper');
  hud(hudThem, shooter, ['shoot', 'pace'], how || 'Shooting');
  showTell(SHOT_TELL[tell], SHOT_TELL[tell].text);
  scout(am.shot ? `${shooter.name}'s shots: ${Object.entries(am.shot).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', ')}.` : `${shooter.name} has no shooting habit on file.`, false,
    ' <span class="muted">Catch ✕ Normal · Punch ✕ Power · Dive ✕ Placed</span>');
  readBar(post, { normal: 'Normal', power: 'Power', placed: 'Placed' });
  const adj = -(shooter.stats.shoot - 7) * 0.03 + (S.sta[shooter.id] < 5 ? 0.05 : 0);
  const odds = (k) => expect(post, (t) => P(SAVE[k][t] + adj));
  const bw = S.guts >= 50;
  const choice = await W8(menu([
    { label: 'Catch', sub: 'beats Normal', odds: odds('catch'), value: 'catch', cls: 'green' },
    { label: 'Punch', sub: 'beats Power', odds: odds('punch'), value: 'punch', cls: 'red' },
    { label: 'Dive', sub: 'beats Placed', odds: odds('dive'), value: 'dive', cls: 'blue' },
    { label: '★ Brick Wall', sub: 'Wak: automatic save', odds: 1, value: 'wall', cls: 'gold', disabled: !bw, cost: 50 },
  ]), g);
  idleMenu('…');
  if (choice === 'wall') { addGuts(-50); await W8(shell.cutIn(byId.wak, 'Brick Wall', 'Next save is automatic'), g); }
  const q = choice === 'wall' || !timingOn ? 'off' : await W8(timingCheck('ring', { title: 'Time the save!' }), g);
  noteQ(q);
  const p = choice === 'wall' ? 1 : withQ(SAVE[choice][type] + adj, q);
  const saved = Math.random() < p;
  revealTell({ normal: 'Normal', power: 'Power', placed: 'Placed' }[type], tell === type);
  // animation
  A.them.pose = 'kick'; sfx.kick(); ball.owner = null;
  const side = type === 'placed' ? (Math.random() < 0.5 ? -1 : 1) : type === 'power' ? (Math.random() < 0.5 ? -0.3 : 0.3) : 0;
  const tx = W / 2 + side * pitch.goalW * 0.42;
  wk.pose = choice === 'dive' ? 'dive' : choice === 'punch' ? 'header' : 'ready';
  wk.facing = side < 0 ? -1 : 1;
  const wkx = choice === 'dive' ? W / 2 + (saved ? side || 0.6 : -(side || 0.6)) * pitch.goalW * 0.3 : W / 2;
  await W8(Promise.all([
    tween(ball, { x: saved ? lerp(tx, wkx, 0.7) : tx, y: saved ? gy - 10 : gy + pitch.netDepth * 0.6 }, type === 'power' ? 0.26 : 0.4, { arc: type === 'placed' ? 22 : 10, ease: linear }),
    tween(wk, { x: wkx }, 0.28),
  ]), g);
  const why = tell === type ? `his tell (${SHOT_TELL[tell].why}) was honest` : `the ${SHOT_TELL[tell].why} was a bluff`;
  const qTxt = q === 'off' ? '' : ` · ${q}`;
  if (saved) {
    sfx.save(); freeze(120); shell.shake(); shell.banner('SAVED!', 'Wak', '#9ef0a8');
    popAt(wk, choice === 'punch' ? 'PUNCHED!' : choice === 'catch' ? 'CAUGHT!' : 'TIPPED!', '#9ef0a8');
    const verb = { catch: 'catches', punch: 'punches away', dive: 'dives to stop', wall: 'is a brick wall against' }[choice];
    shell.log(`🧤 Wak ${verb} ${shooter.name}'s ${type} shot${choice === 'wall' ? '' : `: ${why}`} (${pct(p)}${qTxt}).`, 'good', clockStr());
    addGuts(10);
    ball.owner = wk;
    await W8(sleep(900), g);
    S.poss = 'us'; S.last = null;
    if (choice === 'catch' || choice === 'wall') { S.zone = 1; S.carrier = 'tomo'; shell.log('Wak rolls it out to Tomo.', 'info', clockStr()); }
    else { S.zone = 0; S.carrier = 'mo'; shell.log('Big Mo mops up the loose ball in the box.', 'info', clockStr()); }
  } else {
    pitch.goal(false);
    S.score.them++;
    sfx.groan(); shell.shake(); shell.flash('rgba(232,70,58,.5)'); shell.banner('GOAL…', `${shooter.name} · ${clockStr()}`, '#ff8a80');
    wk.pose = 'sad'; A.them.pose = 'celebrate';
    shell.log(`⚽ Redrock goal. ${shooter.name}'s ${type} shot beats Wak, who chose ${choice}: ${why} (save was ${pct(p)}${qTxt}).`, 'goal', clockStr());
    updateTop();
    await W8(sleep(1800), g);
    S.poss = 'us'; S.zone = 2; S.carrier = 'kenji'; S.last = null; S.theirLast = null;
  }
  wk.pose = 'ready'; wk.x = W / 2; wk.facing = 1;
}

// ------------------------------------------------------------------ full time
async function fullTime(g) {
  idleMenu('Full time.');
  tellEl.hidden = true;
  sfx.whistle(3);
  const { us, them } = S.score;
  const res = us > them ? 'WIN' : us < them ? 'LOSS' : 'DRAW';
  (us > them ? sfx.win : us < them ? sfx.lose : sfx.good)();
  if (us > them) shell.confetti();
  if (A.us) A.us.pose = us >= them ? 'celebrate' : 'sad';
  shell.log(`Full time: Sunbirds ${us}–${them} Redrock. Perfect checks: ${S.stats.perfect}, misses: ${S.stats.miss}. Timing was ${timingOn ? 'ON' : 'OFF'}.`, 'goal', clockStr());
  const idx = PHASES.findIndex((p) => p.id === S.phase);
  const next = PHASES[(idx + 1) % PHASES.length];
  const v = await shell.modal({
    title: `Full time · ${res}`,
    html: `<p class="ft" style="font-size:22px;font-family:var(--font-h);margin:4px 0">Sunbirds ${us} – ${them} Redrock</p>
      <p>Timing checks: ${S.stats.perfect} perfect · ${S.stats.miss} missed${timingOn ? '' : ' (checks were OFF)'}.</p>
      <div class="notice"><b>What to notice:</b> did the timing check add tension, or just noise? Try this phase again with ⏱ ${timingOn ? 'OFF' : 'ON'}.</div>`,
    buttons: [{ label: `Replay with ⏱ ${timingOn ? 'OFF' : 'ON'}`, value: 'flip' }, { label: 'Replay', value: 'again', cls: 'paper' }, { label: `Next: ${next.label}`, value: 'next', cls: 'blue' }],
  });
  if (g !== gen) return;
  if (v === 'flip') { tbtn.click(); shell.setPhase(S.phase); }
  else if (v === 'next') shell.setPhase(next.id);
  else shell.setPhase(S.phase);
}

