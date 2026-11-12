// Command Duel × Timed Strikes — RPG command menus for 1v1 duels, plus an
// optional Paper Mario style timing check that decides the quality.
//
// View rule: the match lives on one tall pitch (stage.js) with persistent
// actors. The ball is always at a foot, in flight or loose, and it changes
// owner only through a pass, tackle, interception, block or save that you can
// see. Log lines, pops and guts land on the contact frame, never before.
import { Shell, oddsPill, pick, shuffle, clamp } from '../../shared/shell.js';
import { sfx } from '../../shared/sfx.js';
import { byId } from '../../shared/cast.js';
import { portrait, lerp } from '../../shared/art.js';
import { timingCheck, cancelCheck } from './checks.js';
import {
  st, cam, ball, actors, initStage, actor, tween, clearTweens, wait, freeze, enter, leave, removeActor,
  runTo, face, footOf, standFor, ballTo, give, panTo, coverTo, camClamp, toPage, say, hush, linear, outQuad,
} from './stage.js';
import {
  ZONES, ZONE_SHORT, ZONE_V, RESP_LABEL, TELL_TRUTH, DEF_TELL, ATT_TELL, SHOT_TELL,
  RIVAL_DEF, RIVAL_ATT, OUR_DEF, PASS_POOL, SPECIALS, DEF_SPECIALS, SPECIAL_COST, COMBO_COST, COMBOS, WIN, SAVE, QMOD,
  WALL_COST, SPECIAL_P, MAX_P, PERFECT_GUTS,
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
    'Your carrier faces a named Redrock defender. Pick <b>Dribble</b>, <b>Pass</b> (both receivers are on the pitch), <b>Shoot</b> (Attack/Box only) or a <b>Special</b> (costs guts).',
    'The defender has secretly picked: <b>Tackle</b> beats Dribble, <b>Mark</b> beats Pass, <b>Press</b> drains 2.5 stamina and hurts everything a little.',
    'Read his speech bubble (true ~60%) and the scouting note. The % on each button already counts both, and no command goes above 85%.',
    'Redrock reshuffle their defenders every time you win the ball, so check who you are facing.',
    '<b>Guts come from bold reads:</b> a win pays the green <b>+g</b> badge, more for a riskier pick. A Perfect timing check adds +5. Guts buy a Special (60), a combo (80) or Brick Wall (70).',
    'Then a timing check: Perfect +15%, Miss −20% (never above 90%). Turn checks off with <b>⏱</b> (or T) to compare.',
    'When Redrock has the ball: Tackle / Mark / Press their carrier. If they get a shot away, keeper Wak picks Catch / Punch / Dive.',
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
  <div class="vs"><div class="hud you"></div><b class="vsx">VS</b><div class="hud them"></div></div>
  <div class="duel"><canvas></canvas></div>
  <div class="cmdpanel panel">
    <div class="scout"></div>
    <div class="read"></div>
    <div class="cmds"></div>
    <div class="rules"></div>
  </div>
</div>`;
const $ = (s) => root.querySelector(s);
const cv = $('canvas');
const hudThem = $('.hud.them'), hudYou = $('.hud.you');
const cmdsEl = $('.cmds'), scoutEl = $('.scout'), readEl = $('.read'), rulesEl = $('.rules');
const RULES_DUEL = 'Tackle ✕ Dribble · Mark ✕ Pass · Press drains stamina';
const RULES_KEEP = 'Catch ✕ Normal · Punch ✕ Power · Dive ✕ Placed';

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

// ------------------------------------------------------------------ state
let S = null;
let gen = 0;
const K = {}; // the two keepers, always on the pitch
const CANCEL = Symbol('cancel');
async function W8(p, g) { const v = await p; if (g !== gen) throw CANCEL; return v; }
const all = (...ps) => Promise.all(ps);
const DEV = (() => { try { return new URLSearchParams(location.search).has('jank'); } catch { return false; } })();

const START = {
  early: { min: 0, step: 3, end: 90, us: 0, them: 0, guts: 20, zone: 2, carrier: 'kenji', variant: 'day', sol: false, tired: 0 },
  mid: { min: 45, step: 3, end: 90, us: 1, them: 1, guts: 50, zone: 2, carrier: 'lupe', variant: 'dusk', sol: true, tired: 1 },
  clutch: { min: 88, step: 1.5, end: 95, us: 1, them: 2, guts: 65, zone: 2, carrier: 'kenji', variant: 'night', sol: true, tired: 3 },
};

// ------------------------------------------------------------------ positions
// We attack UP (toward Big Oskar), Redrock attacks DOWN (toward Wak).
const spotY = (z) => st.pitch.toPx(0.5, ZONE_V[z])[1];
const SZ = () => st.H * 0.22;
const pt = (u, y) => ({ x: u * st.W, y });
const C = (z) => pt(0.36, spotY(z) + 0.16 * st.H); // our carrier
const D = (z) => pt(0.64, spotY(z) - 0.04 * st.H); // their defender
const R = (z, i) => (z >= 4 ? pt(i ? 0.8 : 0.22, spotY(4) - 0.2 * st.H) : pt(i ? 0.8 : 0.2, spotY(z + 1) + 0.02 * st.H)); // receivers
const camAtk = (z) => spotY(z) - (z >= 4 ? 0.12 : 0.25) * st.H;
const TC = (z) => pt(0.64, spotY(z) - 0.06 * st.H); // their carrier
const OD = (z) => pt(0.38, spotY(z) + 0.12 * st.H); // our defender
const camDef = (z) => spotY(z);
const shotSpot = (z) => pt(0.42, st.pitch.y0 + (z >= 4 ? 0.62 : 0.74) * st.H);
const camShot = () => st.pitch.y0 + 0.3 * st.H;
const keepSpot = (far) => pt(0.6, st.pitch.y1 - (far ? 0.6 : 0.5) * st.H);
const camKeep = () => st.pitch.y1 - 0.36 * st.H;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const lerpP = (a, b, k) => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) });
const proj = (p, a, b) => { const dx = b.x - a.x, dy = b.y - a.y; return ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1); };
const runDur = (a, p, v = 0.85) => clamp(dist(a, p) / (st.W * v), 0.25, 1.1);
const fx = (a, f) => a.x + f * 10; // a faceX that makes runTo face `f`
const ballPos = () => ({ x: ball.x, y: ball.y });

function layout() {
  const w = Math.round(Math.min(Math.max(root.clientWidth, 300), 620));
  initStage(cv, w, S.variant);
  K.ok = actor(byId.oskar, 0, 0, 1, SZ() * 0.95);
  K.wk = actor(byId.wak, 0, 0, 1, SZ() * 0.95);
  homeKeepers();
}
function homeKeepers() {
  Object.assign(K.ok, { x: st.W / 2, y: st.pitch.y0 + 5, facing: 1, bs: 1, pose: 'ready', lay: null, _ly: 0 });
  Object.assign(K.wk, { x: st.W / 2, y: st.pitch.y1 - 3, facing: 1, bs: 1, pose: 'ready', lay: null, _ly: 0 });
}
// Bring a character on (he runs in from his touchline level with p).
const bring = (id, p) => enter(byId[id], p.y, SZ());
// Everyone not listed jogs off (keepers and the ball holder stay).
function castOnly(keep) {
  for (const a of [...actors]) if (a !== K.ok && a !== K.wk && a !== ball.owner && !keep.includes(a)) leave(a);
}
function popAt(a, text, color = '#fff') {
  const p = toPage(a.x, a.y - a.size * 1.05);
  shell.popup(text, p.x, p.y, color);
}

// ------------------------------------------------------------------ choreography
// Each helper computes the meeting point first and sends both parties there
// with the same arrival time. `hit` runs on the contact frame.

// Run most of the way, go to ground for the last stretch; arrives at `p` at T.
async function lunge(a, p, T, pose, f, then = null, pre = 'run') {
  const mid = lerpP(a, p, 0.6);
  const ok = await runTo(a, mid, T * 0.6, { ease: linear, pose: pre, then: null, faceX: fx(a, f) });
  if (!ok) return false;
  // go over gradually (art kit `lay`), so the body tips down instead of snapping flat
  const lying = pose === 'dive' || pose === 'slide' || pose === 'tackle';
  if (lying) { a.lay = 0; tween(a, { lay: 1 }, T * 0.4, { ease: outQuad }); }
  return runTo(a, p, T * 0.4, { ease: linear, pose, then, faceX: fx(a, f) });
}

// Get up from the ground: hold the ground pose, crouch, then stand.
// Gives up quietly if something else moves him meanwhile.
// Get up from a lying pose: the body tips back up over 0.22 s (art kit `lay`),
// then he is in the `ready` crouch.
async function rise(a) {
  if (a.pose === 'dive' || a.pose === 'slide' || a.pose === 'tackle') {
    if (a.lay == null) a.lay = 1;
    await tween(a, { lay: 0 }, 0.22, { ease: outQuad });
  }
  a.pose = 'ready'; a.lay = null;
}
async function getUp(a, then = 'idle', hold = 0.4) {
  const tok = a.tok;
  await wait(hold); if (a.tok !== tok) return false;
  await rise(a); if (a.tok !== tok) return false;
  await wait(0.15); if (a.tok !== tok) return false;
  a.pose = then; return true;
}
// Where a keeper must stand so his whole body stays clear of the ball's path
// into the net. Samples the drawn ball (ground point minus height) along the
// flight, keeps the part that passes his body's height band, and puts him
// `away` (−1 or 1) of it by half a body plus a ball and a margin.
function clearOf(s, t, hEnd, k, ky, away, lying) {
  const r = Math.max(4, st.H * 0.026);
  const top = ky - k.size * (lying ? 0.4 : 1.15), bot = ky + 4;
  const xs = [];
  for (let i = 0; i <= 24; i++) {
    const u = i / 24, y = lerp(s.y, t.y, u) - hEnd * u;
    if (y >= top - r && y <= bot + r) xs.push(lerp(s.x, t.x, u));
  }
  if (!xs.length) xs.push(t.x);
  const edge = away > 0 ? Math.max(...xs) : Math.min(...xs);
  return edge + away * ((lying ? 0.14 : 0.32) * k.size + 3 * r + 4); // body edge + a full ball width of air
}

// Pass from `from` to `to`, who runs to `p` and meets the ball on arrival.
async function passTo(from, to, p, o = {}) {
  const f = o.face ?? (from.x > p.x ? 1 : -1);
  const aim = footOf(to, f, p.x, p.y);
  const s = ballPos();
  const dBall = dist(s, aim), dRun = dist(to, p);
  const T = o.T ?? clamp(Math.max(dBall / (st.W * 1.35), dRun / (st.W * 1.1)), 0.32, 0.95);
  face(from, aim.x); from.pose = 'pass'; sfx.pass();
  window.__jankCtx = 'pass';
  const jobs = [ballTo(aim, T, { arc: Math.min(28, dBall * 0.1) })];
  if (dRun > 1) jobs.push(runTo(to, p, T, { ease: linear, face: f, then: null }));
  else to.facing = f;
  if (o.cam != null) jobs.push(panTo(o.cam, Math.max(T, 0.5)));
  if (o.late) jobs.push(lateLunge(o.late, s, aim, T));
  await all(...jobs);
  give(to); to.pose = 'idle'; from.pose = 'idle';
  o.hit?.();
}
// A defender who guessed wrong lunges at the pass line and arrives just too late.
async function lateLunge(d, s, aim, T) {
  const k = clamp(proj(d, s, aim), 0.2, 0.8);
  const I = lerpP(s, aim, k);
  const f = d.x > I.x ? -1 : 1;
  const stand = standFor(d, I, f);
  if (await lunge(d, lerpP(d, stand, 0.85), T * k + 0.16, 'slide', f)) getUp(d, 'sad');
}
// The pass is cut out: the cutter's foot and the ball reach the lane together.
async function cutOut(passer, cutter, recv, p, label, hit, o = {}) {
  const f = o.face ?? (passer.x > p.x ? 1 : -1);
  const aim = footOf(recv, f, p.x, p.y);
  const s = ballPos();
  const k = clamp(proj(cutter, s, aim), 0.25, 0.7);
  const I = lerpP(s, aim, k);
  const cf = cutter.x > I.x ? -1 : 1;
  const stand = standFor(cutter, I, cf);
  const T = clamp(Math.max(dist(s, I) / (st.W * 1.35), dist(cutter, stand) / (st.W * 1.1)), 0.28, 0.6);
  face(passer, aim.x); passer.pose = 'pass'; sfx.pass();
  window.__jankCtx = 'cutout';
  if (dist(recv, p) > 1) runTo(recv, p, Math.min(1, T / k), { then: 'sad', face: f });
  await all(ballTo(I, T, { arc: 5 }), lunge(cutter, stand, T, 'tackle', cf));
  give(cutter); passer.pose = 'sad'; // the cutter stays down with it for a beat
  sfx.thud(); freeze(130); popAt(cutter, label, o.color || '#ffb3ab');
  hit?.();
  await getUp(cutter, 'idle');
}
// Tackle: the carrier pushes on, the tackler meets the ball, it pops loose, he collects.
async function tackleWin(tackler, victim, label, hit, color = '#ffd23f') {
  const dirY = victim.char.team === 'sun' ? -1 : 1;
  const M = { x: victim.x + (tackler.x > victim.x ? 0.05 : -0.05) * st.W, y: victim.y + dirY * 0.06 * st.H };
  const meet = footOf(victim, victim.facing, M.x, M.y);
  const f = tackler.x > meet.x ? -1 : 1;
  const T = clamp(dist(tackler, standFor(tackler, meet, f)) / (st.W * 1.1), 0.3, 0.55);
  window.__jankCtx = 'tackle';
  await all(
    runTo(victim, M, T, { ease: linear, then: null }),
    lunge(tackler, standFor(tackler, meet, f), T, 'slide', f),
  );
  victim.pose = 'sad'; sfx.thud(); freeze(150); popAt(tackler, label, color);
  hit?.();
  const L = { x: meet.x - f * 0.05 * st.W, y: meet.y + 0.05 * st.H };
  await ballTo(L, 0.2, { arc: 7, ease: outQuad });
  await wait(0.2);
  await rise(tackler); await wait(0.15);
  await runTo(tackler, standFor(tackler, L, f), 0.24, { face: f, then: 'idle' });
  give(tackler);
  await wait(0.35);
}
// Dribble past: the runner cuts round, the defender lunges at where the ball was.
async function beat(runner, d, wp, dest, o = {}) {
  const s = ballPos();
  const tgt = lerpP(s, wp, 0.3);
  const f = d.x > tgt.x ? -1 : 1;
  sfx.whoosh();
  window.__jankCtx = 'beat';
  const run = (async () => {
    await runTo(runner, wp, 0.32, { ease: linear, then: null });
    await runTo(runner, dest, clamp(runDur(runner, dest, 0.8), 0.3, 1.0), { ease: outQuad, face: o.face, then: 'idle' });
  })();
  const miss = (async () => { await wait(0.1); if (await lunge(d, standFor(d, tgt, f), 0.3, 'slide', f)) getUp(d, 'sad'); })();
  const jobs = [run, miss];
  if (o.cam != null) jobs.push((async () => { await wait(0.2); await panTo(o.cam, 0.75); })());
  await all(...jobs);
}
// A shot is blocked: the blocker goes to ground as the strike comes, the ball
// hits him on the line, deflects, and he gets up and collects it.
async function blockShot(sh, blk, aim, label, hit) {
  const s = ballPos();
  const k = clamp(proj(blk, s, aim), 0.12, 0.5);
  const B = lerpP(s, aim, k);
  const f = blk.x > B.x ? -1 : 1;
  const Tb = clamp(dist(s, B) / (st.W * 1.7), 0.1, 0.2);
  const lead = clamp(dist(blk, standFor(blk, B, f)) / (st.W * 1.1) - Tb, 0.12, 0.4);
  window.__jankCtx = 'block';
  const slide = lunge(blk, standFor(blk, B, f), lead + Tb, 'slide', f);
  await wait(lead);
  face(sh, aim.x); sh.pose = 'kick'; sfx.kick();
  await all(ballTo(B, Tb, { arc: 3 }), slide);
  sfx.thud(); freeze(150); popAt(blk, label, '#ffb3ab'); hit?.();
  const L = pt(B.x > st.W / 2 ? 0.84 : 0.16, B.y + (aim.y > s.y ? -0.06 : 0.06) * st.H);
  await ballTo(L, 0.38, { arc: 14, ease: outQuad });
  sh.pose = 'sad';
  await rise(blk); await wait(0.15);
  const lf = blk.x > L.x ? -1 : 1;
  await runTo(blk, standFor(blk, L, lf), clamp(runDur(blk, standFor(blk, L, lf), 1), 0.25, 0.6), { face: lf, then: 'idle' });
  give(blk);
  await wait(0.3);
}
// Ball travels along the ground plane with its own height (for saves and nets).
function shotTo(p, h, T) { ball.owner = null; return tween(ball, { x: p.x, y: p.y, h }, T, { ease: linear }); }

// Whoever holds the ball gets it to `carChar`'s player at `p` (a pass), or the
// holder is that player and carries it there. Used before every duel.
async function settle(carChar, p, f, camY, others) {
  const holder = ball.owner;
  const car = bring(carChar.id, p);
  const jobs = [panTo(camY, 0.7), ...others];
  if (holder === car) jobs.push(runTo(car, p, runDur(car, p), { face: f }));
  else jobs.push(passTo(holder, car, p, { face: f }));
  await all(...jobs);
  return car;
}

// Keepers drift back to the middle of their goal when they are not busy.
function keepersHome() {
  for (const [k, y] of [[K.ok, st.pitch.y0 + 5], [K.wk, st.pitch.y1 - 3]]) {
    if (ball.owner === k || (Math.abs(k.x - st.W / 2) < 2 && Math.abs(k.y - y) < 2)) { k.pose = 'ready'; continue; }
    runTo(k, { x: st.W / 2, y }, 0.6, { then: 'ready', face: 1 });
  }
}

// Cover the cut, reset everyone for a kick-off, uncover.
async function kickoff(g, who) {
  hush();
  idleMenu(who === 'us' ? 'Sunbirds kick off…' : 'Redrock kick off…');
  window.__jankCtx = 'kickoff';
  await W8(coverTo(1, 0.35), g);
  if (who === 'us') { S.defs = shuffle(RIVAL_DEF); S.prevPoss = 'us'; }
  placeStart(who, 2);
  await W8(wait(0.25), g);
  await W8(coverTo(0, 0.35), g);
}
function placeStart(who, z) {
  for (const a of [...actors]) if (a !== K.ok && a !== K.wk) removeActor(a);
  homeKeepers();
  let car;
  if (who === 'us') {
    const c = C(z), d = D(z);
    car = actor(byId[S.carrier], c.x, c.y, 1, SZ());
    actor(byId[S.defs[z].id], d.x, d.y, -1, SZ());
    cam.y = camClamp(camAtk(z));
  } else {
    const c = TC(z), d = OD(z);
    car = actor(byId[RIVAL_ATT[z].id], c.x, c.y, -1, SZ());
    actor(byId[OUR_DEF[z]], d.x, d.y, 1, SZ());
    cam.y = camClamp(camDef(z));
  }
  Object.assign(ball, footOf(car), { h: 0 });
  give(car);
}

// ------------------------------------------------------------------ phase start
function startPhase(id) {
  gen++;
  cancelCheck();
  clearTweens();
  const s0 = START[id];
  S = {
    phase: id, min: s0.min, step: s0.step, end: s0.end, score: { us: s0.us, them: s0.them }, guts: s0.guts,
    zone: s0.zone, carrier: s0.carrier, poss: 'us', last: null, theirLast: null, variant: s0.variant, sol: s0.sol,
    sta: {}, stats: { duels: 0, perfect: 0, miss: 0, checks: 0, commits: 0, specials: 0, odds: [] }, after: null,
    defs: shuffle(RIVAL_DEF), prevPoss: 'us',
  };
  for (const pid of Object.keys(byId)) S.sta[pid] = Math.max(2, byId[pid].stats.stamina - s0.tired);
  if (DEV) window.__cdS = S; // dev aid: match stats for tests
  layout();
  placeStart('us', S.zone);
  hush(); readEl.innerHTML = ''; scoutEl.innerHTML = ''; rulesEl.textContent = RULES_DUEL;
  updateTop();
  const dn = byId[S.defs[S.zone].id].name;
  const intro = {
    early: `Kickoff. Kenji has the ball in midfield. ${dn} is waiting for him.`,
    mid: `Second half, 1–1. Guts 50: one bold win buys a Special (60). Sol is on the pitch now. ${dn} steps up.`,
    clutch: `88', 1–2 down under the lights. Guts 65: win a bold duel to afford Kenji + Rio's Golden Thread (80).`,
  }[id];
  shell.log(intro, 'info', clockStr());
  sfx.whistle();
  const g = gen;
  (async () => {
    try { await W8(wait(0.25), g); await W8(coverTo(0, 0.4), g); } catch (e) { if (e !== CANCEL) throw e; }
  })();
  run(g);
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
const P = (p) => clamp(p, 0.05, MAX_P);
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
// Bold pays: winning a duel earns guts, more for a less likely pick.
const reward = (p) => Math.max(3, Math.round(24 * (1 - p)));

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
const withQ = (p, q) => clamp(p + QMOD[q], 0.05, 0.9);
function pWin(dc, ac, r, i) {
  const stat = ac.stats[i];
  const tired = S.sta[ac.id] < 5 ? (5 - S.sta[ac.id]) * 0.04 : 0;
  return P(WIN[r][i] + (dc.stats.tackle - stat) * 0.03 + tired);
}

// ------------------------------------------------------------------ UI pieces
function statLine(c, keys) { return keys.map((k) => `${k.slice(0, 3).toUpperCase()} ${c.stats[k]}`).join(' · '); }
function hud(el, c, keys, label) {
  const sta = S.sta[c.id];
  el.innerHTML = `<img src="${portrait(c, 64)}" alt=""><div class="hi"><b>${c.name}</b><small>${label ? label + ' · ' : ''}${statLine(c, keys)}</small>
    <div class="sbar ${sta < 5 ? 'low' : ''}" title="Stamina"><i style="width:${sta * 10}%"></i></div></div>`;
  el.classList.toggle('red', c.team === 'red');
}
const TELL_SUB = `tells are true ~${Math.round(TELL_TRUTH * 100)}%`;
function sayTell(a, t, text) { say(a, t.icon, text, TELL_SUB); }
function sayReveal(a, label, truthful) {
  say(a, truthful ? '✔' : '✘', `${label.toUpperCase()}!`, truthful ? 'the tell was honest' : 'the tell was a bluff', truthful ? 'true' : 'bluff');
  sfx.tick();
}
function scout(note, active, extra = '') {
  scoutEl.innerHTML = `<span class="nb">📓</span><span>${note}${active ? ' <b class="act">ACTIVE NOW</b>' : ''}${extra}</span>`;
}
function readBar(post, labels) {
  const cols = { tackle: '#E8463A', mark: '#7B4FC9', press: '#E07A1F', dribble: '#E07A1F', pass: '#7B4FC9', shoot: '#E8463A', normal: '#8a8fa8', power: '#E8463A', placed: '#7B4FC9' };
  readEl.innerHTML = `<span class="rl">Read</span><div class="rbar">${Object.keys(post).map((k) =>
    `<i style="flex:${Math.max(post[k], 0.001)};background:${cols[k]}" title="${labels[k]}"><em>${post[k] >= 0.3 ? labels[k] + ' ' : post[k] >= 0.12 ? labels[k][0] + ' ' : ''}${post[k] >= 0.07 ? Math.round(post[k] * 100) + '%' : ''}</em></i>`).join('')}</div>`;
}

// Command menu. items: {label, sub, odds, cls, disabled, value, wide, img, cost, gain}
let keymap = {};
function menu(items, { back = false } = {}) {
  return new Promise((resolve) => {
    cmdsEl.innerHTML = '';
    keymap = {};
    let n = 0;
    const done = (v) => { keymap = {}; cmdsEl.querySelectorAll('button').forEach((b) => (b.disabled = true)); resolve(v); };
    for (const it of items) {
      if (it.odds != null && !it.disabled) S.stats.odds.push(it.odds);
      const b = document.createElement('button');
      const key = it.key ?? String(++n);
      b.className = `btn cmd ${it.cls || ''} ${it.wide ? 'wide' : ''}`;
      b.disabled = !!it.disabled;
      b.innerHTML = `<span class="key">${key}</span>${it.img ? `<img src="${it.img}" alt="">` : ''}<span class="lbl"><span class="t">${it.label}</span>${it.sub ? `<small>${it.sub}</small>` : ''}</span>${
        it.odds != null ? oddsPill(it.odds) : ''}${it.cost ? `<span class="cost">${it.cost}g</span>` : it.gain && !it.disabled ? `<span class="gain">+${it.gain}g</span>` : ''}`;
      const go = () => { if (b.disabled) return; sfx.click(); b.classList.add('picked'); done(it.value); };
      b.onclick = go;
      if (!it.disabled) keymap[key] = go;
      cmdsEl.appendChild(b);
    }
    if (back) {
      const b = document.createElement('button');
      b.className = 'btn cmd ghost small wide';
      b.innerHTML = '<span class="key">Esc</span><span class="lbl"><span class="t">Back</span></span>';
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

function tellPose(a, kind) {
  a.speed = 1; a.look = 0;
  if (kind === 'tackle' || kind === 'dribble') a.pose = 'ready';
  else if (kind === 'mark' || kind === 'pass') { a.pose = 'idle'; a.look = -1; }
  else if (kind === 'press') { a.pose = 'run'; a.speed = 0.45; }
  else if (kind === 'shoot') { a.pose = 'idle'; a.look = 1; }
}
// `eligible`: this command could have had a timing check (auto specials never do).
function noteQ(q, eligible = true) {
  if (eligible) S.stats.commits++;
  if (q !== 'off') S.stats.checks++;
  if (q === 'perfect') { S.stats.perfect++; addGuts(PERFECT_GUTS); }
  if (q === 'miss') S.stats.miss++;
}
const pct = (p) => Math.round(p * 100) + '%';
// The log quotes the % the player saw on the button, plus what the timing check did to it.
const qTxtOf = (q) => (q === 'off' ? '' : ` · ${q}${QMOD[q] ? ` ${QMOD[q] > 0 ? '+' : '−'}${Math.round(Math.abs(QMOD[q]) * 100)}%` : ''}`);
const quoteOf = (shown, q) => `you had ${pct(shown)}${qTxtOf(q)}`;

// ------------------------------------------------------------------ main loop
async function run(g) {
  try {
    while (S.min < S.end) {
      S.stats.duels++;
      // Redrock reshuffle their back line every time we win the ball back.
      if (S.poss === 'us' && S.prevPoss !== 'us') S.defs = shuffle(RIVAL_DEF);
      S.prevPoss = S.poss;
      if (S.poss === 'us') await offense(g); else await defense(g);
      if (g !== gen) return;
      S.min += S.step; // no free guts per duel: guts come from bold wins and Perfect checks
      updateTop();
    }
    await fullTime(g);
  } catch (e) { if (e !== CANCEL) throw e; }
}

function passOptions(car, z) {
  const tz = Math.min(4, z + 1);
  const pool = PASS_POOL[tz].filter((id) => id !== car.id && (id !== 'sol' || S.sol));
  const combo = COMBOS.find((c) => c.a === car.id && z >= c.minZone);
  const forced = combo ? [combo.b] : [];
  const rest = pool.filter((id) => !forced.includes(id)).sort((a, b) => ((a.charCodeAt(1) + S.stats.duels) % 5) - ((b.charCodeAt(1) + S.stats.duels) % 5));
  return [...forced, ...rest].slice(0, 2).map((id) => byId[id]);
}

// ---------------- staging
async function stageAttack(g, z) {
  const car = byId[S.carrier], dc = byId[S.defs[z].id];
  const opts = passOptions(car, z);
  hush(); readEl.innerHTML = ''; rulesEl.textContent = RULES_DUEL;
  scout(S.defs[z].note, false);
  idleMenu(`${car.name} brings it into ${ZONES[z].toLowerCase()}…`);
  hud(hudYou, car, ['dribble', 'pass', 'shoot'], '');
  hud(hudThem, dc, ['tackle', 'pace'], 'Defender');
  const d = bring(dc.id, D(z));
  const rs = opts.map((o, i) => bring(o.id, R(z, i)));
  window.__jankCtx = 'stage';
  const carA = await W8(settle(car, C(z), 1, camAtk(z), [
    runTo(d, D(z), runDur(d, D(z)), { face: -1 }),
    ...rs.map((r, i) => runTo(r, R(z, i), runDur(r, R(z, i)), { face: i ? -1 : 1 })),
  ]), g);
  if (S.after) { shell.log(S.after, 'good', clockStr()); S.after = null; }
  castOnly([carA, d, ...rs]);
  keepersHome();
  return { car, dc, carA, d, opts, rs };
}
async function stageDefense(g, z) {
  const ac = byId[RIVAL_ATT[z].id], dc = byId[OUR_DEF[z]];
  hush(); readEl.innerHTML = ''; rulesEl.textContent = RULES_DUEL;
  scout(RIVAL_ATT[z].note, false);
  idleMenu(`${ac.name} brings it into ${['your box', 'your half', 'midfield', 'their half', 'their box'][z]}…`);
  hud(hudYou, dc, ['tackle', 'pace'], 'Defending');
  hud(hudThem, ac, ['dribble', 'pass', 'shoot'], '');
  const dA = bring(dc.id, OD(z));
  window.__jankCtx = 'stage';
  const carA = await W8(settle(ac, TC(z), -1, camDef(z), [runTo(dA, OD(z), runDur(dA, OD(z)), { face: 1 })]), g);
  castOnly([carA, dA]);
  keepersHome();
  return { ac, dc, carA, dA };
}

// ---------------- attacking duel
async function offense(g) {
  const z = S.zone;
  const { car, dc, carA, d, opts, rs } = await stageAttack(g, z);
  const dm = S.defs[z];
  const c = { sta: S.sta[car.id], last: S.last, guts: S.guts };
  const prior = norm(dm.prior(c));
  const resp = sample(prior);
  const tell = tellOf(prior, resp);
  const post = posterior(prior, tell);
  tellPose(d, tell);
  sayTell(d, DEF_TELL[tell], DEF_TELL[tell].text.replace('{r}', opts[0]?.name || 'a teammate'));
  scout(dm.note, dm.active(c));
  readBar(post, RESP_LABEL);

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
      { label: 'Dribble', sub: z === 4 ? 'round them, through on goal' : 'beat them, move up', odds: dOdds, value: 'dribble', cls: 'blue', gain: reward(dOdds) },
      { label: 'Pass ▸', sub: opts.map((o) => o.name).join(' / '), odds: Math.max(...passOdds), value: 'pass', cls: 'green', gain: reward(Math.max(...passOdds)) },
      { label: 'Shoot', sub: canShoot ? (z === 4 ? 'from the box' : 'from range: harder') : 'only in Att / Box', odds: canShoot ? sOdds : null, value: 'shoot', cls: 'red', disabled: !canShoot },
      sp
        ? { label: `★ ${car.special.name}`, sub: sp.base === 'shoot' && !canShoot ? 'only in Att / Box' : S.guts < SPECIAL_COST ? `needs ${SPECIAL_COST}g` : sp.text, odds: spOdds, value: 'special', cls: 'purple', disabled: !spOk, cost: SPECIAL_COST }
        : { label: '★ Special', sub: 'none for this player', disabled: true, value: 'special', cls: 'purple' },
    ];
    if (combo) items.push({ label: `✦ ${combo.name}`, sub: S.guts < COMBO_COST ? `needs ${COMBO_COST}g · ${combo.text}` : `${combo.text} · to score`, odds: comboOdds, value: 'combo', cls: 'gold', wide: true, disabled: S.guts < COMBO_COST, cost: COMBO_COST });
    choice = await W8(menu(items), g);
    if (choice !== 'pass') break;
    const to = await W8(menu(opts.map((o, i) => ({
      label: o.name, sub: `${i ? 'right' : 'left'} · pace&nbsp;${o.stats.pace}${COMBOS.some((cb) => cb.a === car.id && cb.b === o.id) ? ' · combo' : ''}`,
      odds: passOdds[i], value: o, img: portrait(o, 56), cls: 'green', gain: reward(passOdds[i]),
    })), { back: true }), g);
    if (to !== 'back') { choice = { type: 'pass', to }; break; }
  }
  if (typeof choice === 'string') choice = { type: choice };
  idleMenu('…');

  // ----- commit
  if (choice.type === 'special') {
    addGuts(-SPECIAL_COST);
    carA.glow = '#FFD23F';
    await W8(shell.cutIn(car, car.special.name, sp.text), g);
  }
  if (choice.type === 'combo') {
    addGuts(-COMBO_COST);
    S.stats.specials++;
    const b = byId[combo.b];
    await W8(shell.cutIn(car, combo.name, `${car.name} → ${b.name}`), g);
    return comboShot(g, carA, car, b, combo, z);
  }
  const base = choice.type === 'special' ? sp.base : choice.type;
  const kind = base === 'dribble' ? 'arrows' : base === 'pass' ? 'bar' : 'shot';
  const q = timingOn ? await W8(timingCheck(kind, { title: { arrows: `Beat ${dc.name}!`, bar: 'Weight the pass!', shot: 'Strike it clean!' }[kind] }), g) : 'off';
  noteQ(q);
  carA.glow = null;

  // ----- reveal: the defender commits to what he really picked
  const ignore = choice.type === 'special';
  const shownOdds = base === 'dribble' ? dOdds : base === 'pass' ? passOdds[Math.max(0, opts.indexOf(choice.to))] : sOdds;
  if (!ignore) {
    tellPose(d, resp);
    sayReveal(d, RESP_LABEL[resp], tell === resp);
    if (resp === 'press') {
      await W8(runTo(d, lerpP(d, standFor(d, footOf(carA), -1), 0.3), 0.3, { pose: 'run', face: -1, then: 'ready' }), g);
      S.sta[car.id] = Math.max(1, S.sta[car.id] - 2.5);
      hud(hudYou, car, ['dribble', 'pass', 'shoot'], '');
      popAt(carA, '−2.5 STA', '#ffb3ab');
      shell.log(`${dc.name} presses: ${car.name} loses 2.5 stamina (now ${S.sta[car.id].toFixed(1)}).`, 'them', clockStr());
    }
    await W8(wait(0.5), g);
  }
  hush();
  const why = tell === resp ? `the tell (${DEF_TELL[tell].why}) was honest` : `${DEF_TELL[tell].why} was a bluff`;
  const quote = quoteOf(ignore ? spOdds : shownOdds, q);
  if (ignore) S.stats.specials++;

  if (base === 'dribble') {
    const p = ignore ? withQ(sp.p, q) : withQ(pDribble(car, dc, resp), q);
    const ok = Math.random() < p;
    S.last = 'dribble';
    S.sta[car.id] = Math.max(1, S.sta[car.id] - 1.5);
    if (ok) {
      const adv = ignore ? sp.adv : 1;
      const nz = Math.min(4, z + adv);
      const through = z === 4;
      await W8(beat(carA, d, pt(0.16, spotY(z) - 0.02 * st.H), through ? pt(0.36, st.pitch.y0 + 0.42 * st.H) : C(nz),
        { face: 1, cam: through ? camShot() : camAtk(nz) }), g);
      shell.log(ignore ? `★ ${car.special.name}! ${car.name} goes straight past ${dc.name} (${quote}).`
        : resp === 'tackle' ? `${car.name} beats ${dc.name}'s tackle anyway (${quote}).` : `${car.name} skins ${dc.name}, who chose ${RESP_LABEL[resp]}: ${why} (${quote}).`, 'good', clockStr());
      if (!ignore) { addGuts(reward(shownOdds)); popAt(carA, `+${reward(shownOdds)} guts`, '#ffd23f'); }
      if (through) return throughOnGoal(g, carA, car, 0.2, 'rounds the last man');
      S.zone = nz;
    } else {
      await W8(tackleWin(d, carA, 'WHAM!', () => {
        shell.log(ignore ? `★ ${car.special.name} fizzles: ${dc.name} gets lucky (${quote}).`
          : `${dc.name} ${resp === 'tackle' ? 'read the dribble' : 'stopped the dribble'} and won it: ${why} (${quote}).`, 'bad', clockStr());
      }), g);
      turnover(z);
    }
    return;
  }
  if (base === 'pass') {
    const to = choice.to || (sp.to ? byId[sp.to] : opts[0]);
    const p = ignore ? withQ(sp.p, q) : withQ(pPass(car, to, dc, resp), q);
    const ok = Math.random() < p;
    const adv = ignore ? sp.adv : 1;
    const nz = Math.min(4, z + adv);
    S.last = 'pass';
    // the receiver: one of the two on screen, or (long specials) a runner further up
    let recv = rs.find((r) => r.char.id === to.id);
    let target;
    if (recv && adv === 1) target = { x: recv.x + (recv.x < st.W / 2 ? 0.05 : -0.05) * st.W, y: recv.y - 0.03 * st.H };
    else {
      target = z === 4 ? pt(0.3, st.pitch.y0 + 0.4 * st.H) : pt(0.3, (nz >= 4 ? spotY(4) : spotY(nz)) + 0.02 * st.H);
      recv = bring(to.id, target);
    }
    if (ok) {
      const restore = () => {
        if (!(ignore && sp.restore)) return;
        for (const id in S.sta) if (byId[id].team === 'sun') S.sta[id] = Math.min(byId[id].stats.stamina, S.sta[id] + 3);
        shell.log('Engine Room: Sunbirds stamina +3.', 'good', clockStr());
      };
      await W8(passTo(carA, recv, target, { face: 1, late: ignore ? null : d, cam: z === 4 ? null : nz >= 4 ? camAtk(4) : camAtk(nz) - 0.1 * st.H, hit: () => {
        shell.log(ignore ? `★ ${car.special.name}: ${car.name} finds ${to.name} (${quote}).`
          : resp === 'mark' ? `${car.name} squeezes it past ${dc.name}'s marking to ${to.name} (${quote}).` : `${car.name} → ${to.name}. ${dc.name} went for ${RESP_LABEL[resp]}: ${why} (${quote}).`, 'good', clockStr());
        if (!ignore) { addGuts(reward(shownOdds)); popAt(recv, `+${reward(shownOdds)} guts`, '#ffd23f'); }
        restore();
      } }), g);
      S.carrier = to.id;
      if (z === 4) return throughOnGoal(g, recv, to, 0.12, 'gets a cut-back');
      S.zone = nz;
    } else {
      await W8(cutOut(carA, d, recv, target, 'CUT OUT!', () => {
        shell.log(ignore ? `★ ${car.special.name} misfires: ${dc.name} gets a lucky touch (${quote}).`
          : `${dc.name} ${resp === 'mark' ? 'read the pass and cut it out' : 'got a foot to the pass'}: ${why} (${quote}).`, 'bad', clockStr());
      }, { face: 1 }), g);
      turnover(z);
    }
    return;
  }
  // shoot (normal or special)
  const bonus = ignore ? (typeof sp.bonus === 'function' ? sp.bonus(S) : sp.bonus) : 0;
  const p = ignore ? withQ(shotBase(car, z) + bonus, q) : withQ(pShoot(car, z, resp), q);
  S.last = 'shoot';
  await shootAt(g, carA, car, p, {
    z, quote, d, chase: !ignore && resp === 'tackle', blocked: !ignore && resp === 'tackle' && Math.random() < 0.5,
    note: ignore ? `★ ${car.special.name}` : `${dc.name} chose ${RESP_LABEL[resp]}`,
  });
}

function turnover(z) { S.poss = 'them'; S.zone = z; S.last = null; }

async function throughOnGoal(g, shA, car, bonus, how) {
  shell.log(`${car.name} ${how}: one-on-one with Big Oskar (+${Math.round(bonus * 100)}%).`, 'good', clockStr());
  scout('Big Oskar: two metres tall, shots from range lose 15%.', false);
  readEl.innerHTML = '';
  hush();
  castOnly([shA]);
  hud(hudYou, car, ['shoot', 'pace'], 'Box');
  hud(hudThem, byId.oskar, ['keep'], 'Keeper');
  await W8(panTo(camShot(), 0.5), g);
  const p0 = P(shotBase(car, 4) + bonus);
  idleMenu(`One-on-one: ${pct(p0)} to score`);
  const q = timingOn ? await W8(timingCheck('shot', { title: `Finish it! ${pct(p0)}` }), g) : 'off';
  noteQ(q);
  await shootAt(g, shA, car, withQ(p0, q), { note: 'one-on-one', quote: quoteOf(p0, q), z: 4 });
}

async function comboShot(g, carA, a, b, combo, z) {
  hush(); readEl.innerHTML = '';
  const bA = bring(b.id, R(z, 0));
  const q = timingOn ? await W8(timingCheck('shot', { title: `${b.name}, first time!` }), g) : 'off';
  noteQ(q);
  // a threads it into the box; b meets it on the run and strikes first time
  const P0 = shotSpot(4);
  castOnly([carA, bA]);
  bA.glow = '#FFD23F';
  await W8(passTo(carA, bA, P0, { face: 1, cam: camShot() }), g);
  bA.glow = null;
  S.carrier = b.id;
  hud(hudYou, b, ['shoot', 'pace'], 'Box');
  const p0 = P(shotBase(b, 4) + combo.bonus);
  await shootAt(g, bA, b, withQ(p0, q), { note: `✦ ${combo.name}`, quote: quoteOf(p0, q), z: 4, oneTouch: true });
}

// Our shot at Big Oskar. Keeper and ball reach the save point together.
async function shootAt(g, sh, car, p, o) {
  const goal = Math.random() < p;
  const ok = K.ok, pitch = st.pitch, y0 = pitch.y0, W = st.W;
  const chaser = o.chase ? o.d : null;
  hush(); idleMenu('…'); readEl.innerHTML = '';
  castOnly([sh, o.d].filter(Boolean));
  hud(hudThem, byId.oskar, ['keep'], 'Keeper');
  const SP = shotSpot(o.z);
  const jobs = o.oneTouch ? [] : [panTo(camShot(), 0.6)];
  if (!o.oneTouch && sh.y > SP.y + 4) jobs.push(runTo(sh, SP, clamp(runDur(sh, SP), 0.4, 0.9), { face: 1 }));
  if (chaser) jobs.push(runTo(chaser, pt(0.68, SP.y - 0.26 * st.H), clamp(runDur(chaser, pt(0.68, SP.y - 0.26 * st.H)), 0.4, 0.9), { face: -1, then: 'ready' }));
  await W8(all(...jobs), g);
  const side = (DEV && window.__cdSide) || (Math.random() < 0.5 ? -1 : 1); // dev aid: window.__cdSide = ±1

  if (!goal && chaser && o.blocked) {
    await W8(blockShot(sh, chaser, pt(0.5 + side * 0.1, y0), 'BLOCKED!', () => {
      shell.log(`${o.d.char.name} throws himself in front: shot blocked (${o.quote}). He chose Tackle, so he was closing you down.`, 'bad', clockStr());
    }), g);
    S.poss = 'them'; S.zone = o.z; S.last = null;
    return;
  }
  const ksz = ok.size, gw = pitch.goalW;
  const T = clamp(dist(ballPos(), { x: W / 2, y: y0 }) / (W * 1.6), 0.3, 0.48);
  face(sh, W / 2); sh.pose = 'kick'; sfx.kick();
  window.__jankCtx = 'shot';
  if (goal) {
    // Oskar goes the wrong way; the ball's path is fixed first, then he is kept clear of it
    const tgt = { x: W / 2 + side * gw * 0.4, y: y0 - pitch.netDepth * 0.5 };
    const kx = clearOf(ballPos(), tgt, ksz * 0.25, ok, y0 + 6, -side, true);
    await W8(all(
      shotTo(tgt, ksz * 0.25, T),
      lunge(ok, { x: kx, y: y0 + 6 }, T * 0.6, 'dive', side, null, 'ready'),
    ), g);
    pitch.goal(true);
    S.score.us++;
    sfx.goal(); shell.flash('#fff'); shell.confetti(); shell.banner('GOAL!', `${car.name} · ${clockStr()}`);
    sh.pose = 'celebrate'; // Oskar stays down where he dived
    shell.log(`⚽ GOAL! ${car.name} scores (${o.note}, ${o.quote}).`, 'goal', clockStr());
    updateTop();
    await W8(tween(ball, { h: 0, y: tgt.y - 3 }, 0.25, { ease: outQuad }), g);
    await W8(wait(1.3), g);
    S.poss = 'them'; S.zone = 2; S.theirLast = null; S.last = null;
    await kickoff(g, 'them');
    return;
  }
  // save: hands and ball meet beside the post
  const kd = side;
  const hands = { x: W / 2 + side * gw * 0.3, y: y0 + 8 };
  await W8(all(
    shotTo(hands, ksz * 0.18, T),
    lunge(ok, { x: hands.x - kd * ksz * 0.75, y: hands.y }, T, 'dive', -kd, null, 'ready'),
  ), g);
  sfx.save(); freeze(130); popAt(ok, 'SAVED!', '#d6c4ff');
  shell.log(`Big Oskar saves from ${car.name} (${o.note}, ${o.quote}).`, 'bad', clockStr());
  sh.pose = 'sad';
  await W8(wait(0.4), g);
  // he gets up with it: crouch where he lay, then stand and step back
  await W8(rise(ok), g);
  await W8(wait(0.15), g);
  const up = { x: W / 2 + side * gw * 0.12, y: y0 + 6 };
  await W8(all(tween(ok, up, 0.3), tween(ball, { ...footOf(ok, 1, up.x, up.y), h: 0 }, 0.3)), g);
  ok.facing = 1; give(ok);
  S.poss = 'them'; S.zone = 4; S.last = null;
}

// ---------------- defending duel
async function defense(g) {
  const z = S.zone;
  const { ac, dc, carA, dA } = await stageDefense(g, z);
  const am = RIVAL_ATT[z];
  const c = { sta: S.sta[ac.id], last: S.theirLast };
  const prior = norm(am.prior(c));
  const intent = sample(prior);
  const tell = tellOf(prior, intent);
  const post = posterior(prior, tell);
  tellPose(carA, tell);
  sayTell(carA, ATT_TELL[tell], ATT_TELL[tell].text);
  scout(am.note, am.active(c));
  const iLabels = { dribble: 'Dribble', pass: 'Pass', shoot: 'Shoot' };
  readBar(post, iLabels);

  const odds = (r) => expect(post, (i) => pWin(dc, ac, r, i));
  const dsp = DEF_SPECIALS[dc.id];
  const choice = await W8(menu([
    { label: 'Tackle', sub: 'beats Dribble', odds: odds('tackle'), value: 'tackle', cls: 'red', gain: reward(odds('tackle')) },
    { label: 'Mark', sub: 'beats Pass', odds: odds('mark'), value: 'mark', cls: 'purple', gain: reward(odds('mark')) },
    { label: 'Press', sub: 'OK vs all, tires them', odds: odds('press'), value: 'press', cls: 'blue', gain: reward(odds('press')) },
    dsp ? { label: `★ ${dc.special.name}`, sub: S.guts < SPECIAL_COST ? `needs ${SPECIAL_COST}g` : dsp.text, odds: SPECIAL_P, value: 'special', cls: 'gold', disabled: S.guts < SPECIAL_COST, cost: SPECIAL_COST }
      : { label: '★ Special', sub: `${dc.name} has no defensive special`, disabled: true, value: 'special', cls: 'gold' },
  ]), g);
  idleMenu('…');
  if (choice === 'special') {
    addGuts(-SPECIAL_COST);
    S.stats.specials++;
    dA.glow = '#FFD23F';
    await W8(shell.cutIn(dc, dc.special.name, dsp.text), g);
  }
  const kind = choice === 'press' ? 'arrows' : 'bar';
  const q = choice === 'special' || !timingOn ? 'off' : await W8(timingCheck(kind, { title: choice === 'press' ? `Hound ${ac.name}!` : choice === 'mark' ? 'Step into the lane!' : 'Time the tackle!', green: choice === 'mark' ? 0.3 : 0.24 }), g);
  noteQ(q, choice !== 'special');
  dA.glow = null;
  tellPose(carA, intent);
  sayReveal(carA, iLabels[intent], tell === intent);
  await W8(wait(0.5), g);
  hush();
  const why = tell === intent ? `the tell (${ATT_TELL[tell].why}) was honest` : `${ATT_TELL[tell].why} was a bluff`;
  const quote = quoteOf(choice === 'special' ? SPECIAL_P : odds(choice), q);
  const p = choice === 'special' ? SPECIAL_P : withQ(pWin(dc, ac, choice, intent), q);
  const win = Math.random() < p;
  // where a pass from here would go (the next Redrock attacker down the pitch)
  const nextId = z > 0 ? RIVAL_ATT[z - 1].id : ac.id === 'rocco' ? 'kofi' : 'rocco';
  const nextP = z > 0 ? TC(z - 1) : keepSpot(false);

  if (win) {
    const gain = choice === 'special' ? 0 : reward(odds(choice));
    const hit = () => {
      shell.log(choice === 'special' ? `★ ${dc.special.name}! ${dc.name} wins it from ${ac.name}.`
        : `${dc.name} ${intent === 'dribble' ? 'tackles' : intent === 'pass' ? 'intercepts' : 'blocks'} ${ac.name} (you chose ${choice}): ${why} (${quote}).`, 'good', clockStr());
      if (gain) addGuts(gain);
      if (choice === 'special' && dc.id === 'lupe') {
        for (const id in S.sta) if (byId[id].team === 'sun') S.sta[id] = Math.min(byId[id].stats.stamina, S.sta[id] + 3);
        shell.log('Engine Room: Sunbirds stamina +3.', 'good', clockStr());
      }
    };
    if (intent === 'dribble') await W8(tackleWin(dA, carA, gain ? `WON IT! +${gain}g` : 'WON IT!', hit, '#9ef0a8'), g);
    else if (intent === 'pass') {
      const nA = bring(nextId, nextP);
      await W8(cutOut(carA, dA, nA, nextP, gain ? `CUT OUT! +${gain}g` : 'CUT OUT!', hit, { face: -1, color: '#9ef0a8' }), g);
    } else {
      await W8(blockShot(carA, dA, pt(0.5 + (Math.random() < 0.5 ? -0.1 : 0.1), st.pitch.y1), gain ? `BLOCKED! +${gain}g` : 'BLOCKED!', hit), g);
    }
    dA.pose = 'idle';
    S.poss = 'us'; S.carrier = dc.id; S.last = null;
    if (choice === 'special' && dc.id === 'tomo') { S.zone = Math.min(4, z + 1); S.carrier = 'kenji'; S.after = 'Clean Sweep: Tomo pings a free pass to Kenji.'; }
    if (choice === 'special' && dc.id === 'mo') { S.zone = Math.min(4, z + 1); S.carrier = 'lupe'; S.after = 'Thunder Head: Mo heads it clear to Lupe.'; }
    return;
  }
  S.theirLast = intent;
  const pressNote = () => {
    if (choice !== 'press') return '';
    S.sta[ac.id] = Math.max(1, S.sta[ac.id] - 3);
    return ` Your press cost them 3 stamina (${S.sta[ac.id].toFixed(1)}).`;
  };
  if (intent === 'shoot') {
    shell.log(`${ac.name} shapes to shoot past ${dc.name}: ${choice === 'special' ? `★ ${dc.special.name} fizzled` : `you chose ${choice}, ${why}`} (${quote}).${pressNote()}`, 'them', clockStr());
    return keeperDuel(g, carA, z, '');
  }
  if (intent === 'dribble') {
    await W8(beat(carA, dA, pt(0.86, spotY(z) + 0.14 * st.H), z === 0 ? keepSpot(false) : TC(z - 1),
      { face: -1, cam: z === 0 ? camKeep() : camDef(z - 1) }), g);
    shell.log(`${ac.name} skips past ${dc.name}: ${choice === 'special' ? `★ ${dc.special.name} fizzled` : `you chose ${choice}, ${why}`} (${quote}).${pressNote()}`, 'them', clockStr());
    if (z === 0) return keeperDuel(g, carA, 0, 'through on goal');
  } else {
    const nA = bring(nextId, nextP);
    await W8(passTo(carA, nA, nextP, { face: -1, late: dA, cam: z === 0 ? camKeep() : camDef(z - 1) }), g);
    shell.log(`${ac.name} passes around ${dc.name} to ${nA.char.name}: ${choice === 'special' ? `★ ${dc.special.name} fizzled` : `you chose ${choice}, ${why}`} (${quote}).${pressNote()}`, 'them', clockStr());
    if (z === 0) return keeperDuel(g, nA, 0, 'through on goal');
  }
  S.zone = z - 1;
}

// Wak vs their shooter. Hands (or fists) and ball reach the save point together.
async function keeperDuel(g, sh, z, how) {
  const shooter = sh.char;
  const am = RIVAL_ATT.find((m) => m.id === shooter.id) || {};
  const prior = norm(am.shot || { normal: 0.45, power: 0.3, placed: 0.25 });
  const type = (DEV && window.__cdShot) || sample(prior); // dev aid: window.__cdShot = 'power'
  const tell = tellOf(prior, type);
  const post = posterior(prior, tell);
  const wk = K.wk, pitch = st.pitch, y1 = pitch.y1, W = st.W;
  hush(); readEl.innerHTML = ''; idleMenu('…');
  castOnly([sh]);
  hud(hudYou, byId.wak, ['keep', 'pace'], 'Keeper');
  hud(hudThem, shooter, ['shoot', 'pace'], how || 'Shooting');
  const SS = keepSpot(z >= 1);
  await W8(all(panTo(camKeep(), 0.6), runTo(sh, SS, clamp(runDur(sh, SS), 0.3, 0.9), { face: -1 })), g);
  const TL = { normal: 'Normal', power: 'Power', placed: 'Placed' };
  tellPose(sh, 'shoot');
  sayTell(sh, SHOT_TELL[tell], SHOT_TELL[tell].text);
  rulesEl.textContent = RULES_KEEP;
  scout(am.shot ? `${shooter.name}'s shots: ${Object.entries(am.shot).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', ')}.` : `${shooter.name} has no shooting habit on file.`, false);
  readBar(post, TL);
  const adj = -(shooter.stats.shoot - 7) * 0.03 + (S.sta[shooter.id] < 5 ? 0.05 : 0);
  const odds = (k) => expect(post, (t) => P(SAVE[k][t] + adj));
  const bw = S.guts >= WALL_COST;
  const choice = await W8(menu([
    { label: 'Catch', sub: 'beats Normal', odds: odds('catch'), value: 'catch', cls: 'green', gain: reward(odds('catch')) },
    { label: 'Punch', sub: 'beats Power', odds: odds('punch'), value: 'punch', cls: 'red', gain: reward(odds('punch')) },
    { label: 'Dive', sub: 'beats Placed', odds: odds('dive'), value: 'dive', cls: 'blue', gain: reward(odds('dive')) },
    { label: '★ Brick Wall', sub: bw ? 'Wak sees everything' : `needs ${WALL_COST}g`, odds: SPECIAL_P, value: 'wall', cls: 'gold', disabled: !bw, cost: WALL_COST },
  ]), g);
  idleMenu('…');
  if (choice === 'wall') { addGuts(-WALL_COST); S.stats.specials++; await W8(shell.cutIn(byId.wak, 'Brick Wall', 'Wak reads every shot'), g); }
  const q = choice === 'wall' || !timingOn ? 'off' : await W8(timingCheck('ring', { title: 'Time the save!' }), g);
  noteQ(q, choice !== 'wall');
  const p = choice === 'wall' ? SPECIAL_P : withQ(P(SAVE[choice][type] + adj), q);
  const saved = Math.random() < p;
  sayReveal(sh, TL[type], tell === type);
  await W8(wait(0.45), g);
  hush();

  // ----- the strike
  // A shot that beats Wak goes for a corner; a saved one goes where its type says.
  const coin = Math.random() < 0.5 ? -1 : 1;
  const side = !saved || type === 'placed' ? coin : type === 'power' ? coin * 0.3 : 0;
  const tx = W / 2 + side * pitch.goalW * (saved ? 0.42 : 0.4);
  const ksz = wk.size;
  const T = type === 'power' ? 0.3 : 0.44;
  face(sh, tx); sh.pose = 'kick'; sfx.kick();
  window.__jankCtx = 'keeper';
  const dir = Math.sign(side) || 1;
  const why = tell === type ? `the tell (${SHOT_TELL[tell].why}) was honest` : `${SHOT_TELL[tell].why} was a bluff`;
  const quote = quoteOf(choice === 'wall' ? SPECIAL_P : odds(choice), q);
  if (saved) {
    const S0 = { x: tx, y: y1 - 4 };
    let kp, pose, h;
    if (choice === 'dive') { kp = { x: tx - dir * ksz * 0.75, y: S0.y }; pose = 'dive'; h = ksz * 0.18; }
    else if (choice === 'punch') { kp = { x: tx, y: S0.y - 4 }; pose = 'header'; h = ksz * 0.95; }
    else { kp = { x: tx, y: S0.y - 4 }; pose = 'ready'; h = ksz * 0.42; }
    await W8(all(shotTo(S0, h, T), lunge(wk, kp, T, pose, choice === 'dive' ? -dir : dir, null, 'ready')), g);
    sfx.save(); freeze(130);
    const gain = choice === 'wall' ? 0 : reward(odds(choice));
    popAt(wk, (choice === 'punch' ? 'PUNCHED!' : choice === 'dive' ? 'TIPPED!' : 'CAUGHT!') + (gain ? ` +${gain}g` : ''), '#9ef0a8');
    const verb = { catch: 'catches', punch: 'punches away', dive: 'dives to stop', wall: 'is a brick wall against' }[choice];
    shell.log(`🧤 Wak ${verb} ${shooter.name}'s ${type} shot${choice === 'wall' ? '' : `: ${why}`} (${quote}).`, 'good', clockStr());
    if (gain) addGuts(gain);
    sh.pose = 'sad';
    S.poss = 'us'; S.last = null;
    if (choice === 'catch' || choice === 'wall') {
      // he holds it, then brings it down to his feet
      await W8(wait(0.35), g);
      wk.pose = 'ready';
      await W8(tween(ball, { ...footOf(wk, 1, wk.x, wk.y), h: 0 }, 0.25), g);
      wk.facing = 1; give(wk);
      S.zone = 1; S.carrier = 'tomo'; S.after = 'Wak rolls it out to Tomo.';
    } else {
      // parried loose; Big Mo runs onto it
      const L = pt(tx < W / 2 ? 0.2 : 0.8, y1 - 0.3 * st.H);
      const mo = bring('mo', L);
      const f = L.x < W / 2 ? 1 : -1;
      await W8(all(tween(ball, { x: L.x, y: L.y, h: 0 }, 0.5, { ease: outQuad }),
        runTo(mo, standFor(mo, L, f), clamp(runDur(mo, L), 0.55, 1.0), { face: f })), g);
      give(mo);
      shell.log('Big Mo mops up the loose ball.', 'info', clockStr());
      if (choice === 'dive') { await W8(wait(0.1), g); await W8(rise(wk), g); await W8(wait(0.15), g); }
      wk.pose = 'ready';
      S.zone = 0; S.carrier = 'mo';
    }
  } else {
    // Fix the ball's path first, then send Wak the wrong way, clear of it.
    const tgt = { x: tx, y: y1 + pitch.netDepth * 0.55 }, hEnd = ksz * 0.25;
    const pose = choice === 'dive' ? 'dive' : choice === 'punch' ? 'header' : 'ready';
    const kp = { x: clearOf(ballPos(), tgt, hEnd, wk, y1 - 6, -dir, pose === 'dive'), y: y1 - 6 };
    await W8(all(shotTo(tgt, hEnd, T), lunge(wk, kp, T * 0.6, pose, choice === 'dive' ? dir : -dir, null, 'ready')), g);
    pitch.goal(false);
    S.score.them++;
    sfx.groan(); shell.flash('rgba(232,70,58,.5)'); shell.banner('GOAL…', `${shooter.name} · ${clockStr()}`, '#ff8a80');
    if (choice !== 'dive') wk.pose = 'sad';
    sh.pose = 'celebrate';
    shell.log(`⚽ Redrock goal. ${shooter.name}'s ${type} shot beats Wak, who chose ${choice}: ${why} (${quote} to save).`, 'goal', clockStr());
    updateTop();
    await W8(tween(ball, { h: 0 }, 0.25, { ease: outQuad }), g);
    await W8(wait(1.3), g);
    S.poss = 'us'; S.zone = 2; S.carrier = 'kenji'; S.last = null; S.theirLast = null;
    await kickoff(g, 'us');
  }
}

// ------------------------------------------------------------------ full time
async function fullTime(g) {
  idleMenu('Full time.');
  hush();
  sfx.whistle(3);
  const { us, them } = S.score;
  const res = us > them ? 'WIN' : us < them ? 'LOSS' : 'DRAW';
  (us > them ? sfx.win : us < them ? sfx.lose : sfx.good)();
  if (us > them) shell.confetti();
  for (const a of actors) if (a !== K.ok && a !== K.wk) a.pose = (a.char.team === 'sun') === (us >= them) ? 'celebrate' : 'sad';
  const st8 = S.stats;
  const used = st8.checks === 0 ? 'checks were OFF all match' : st8.checks === st8.commits ? `checks ON for all ${st8.commits} commands` : `checks ON for ${st8.checks} of ${st8.commits} commands`;
  shell.log(`Full time: Sunbirds ${us}–${them} Redrock. Perfect checks: ${st8.perfect}, misses: ${st8.miss} (${used}). Specials used: ${st8.specials}.`, 'goal', clockStr());
  const idx = PHASES.findIndex((p) => p.id === S.phase);
  const next = PHASES[(idx + 1) % PHASES.length];
  const v = await shell.modal({
    title: `Full time · ${res}`,
    html: `<p class="ft" style="font-size:22px;font-family:var(--font-h);margin:4px 0">Sunbirds ${us} – ${them} Redrock</p>
      <p>Timing: ${st8.perfect} perfect · ${st8.miss} missed · ${used}.</p>
      <p>Specials and combos used: ${st8.specials}.</p>
      <div class="notice"><b>What to notice:</b> did the timing check add tension, or just noise? Try this phase again with ⏱ ${timingOn ? 'OFF' : 'ON'}.</div>`,
    buttons: [{ label: `Replay with ⏱ ${timingOn ? 'OFF' : 'ON'}`, value: 'flip' }, { label: 'Replay', value: 'again', cls: 'paper' }, { label: `Next: ${next.label}`, value: 'next', cls: 'blue' }],
  });
  if (g !== gen) return;
  if (v === 'flip') { tbtn.click(); shell.setPhase(S.phase); }
  else if (v === 'next') shell.setPhase(next.id);
  else shell.setPhase(S.phase);
}
