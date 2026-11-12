// Command Duel stage: one tall pitch seen through a camera, a list of actors
// that persist between duels, and one ball that is always at a foot, in flight
// or loose. Everything moves through tweens, so nothing can jump.
import { drawPlayer, drawBall, Pitch, setupCanvas, lerp, ease } from '../../shared/art.js';

export const st = { W: 370, H: 296, ctx: null, cv: null, pitch: null, T: 0, cover: 1 };
// The tell / reveal speech bubble, drawn on the canvas above an actor's head.
export const bubble = { a: null, icon: '', text: '', sub: '', tone: 'plain', t0: 0 };
export function say(a, icon, text, sub = '', tone = 'plain') { Object.assign(bubble, { a, icon, text, sub, tone, t0: st.T }); }
export function hush() { bubble.a = null; }
// Dev aid: with ?jank=1, window.__slow = 0.25 plays everything at quarter speed.
const DEV = (() => { try { return new URLSearchParams(location.search).has('jank'); } catch { return false; } })();
export const cam = { y: 0 };
export const ball = { x: 0, y: 0, h: 0, spin: 0, owner: null };
export const actors = [];
const LYING = { dive: 1, slide: 1, tackle: 1 };
const tweens = [];
let lastNow = 0, freezeUntil = 0;

export const linear = (k) => k;
export const outQuad = (k) => 1 - (1 - k) * (1 - k);

export function initStage(canvas, width, variant) {
  st.cv = canvas;
  st.W = width;
  st.H = Math.round(width < 480 ? width * 0.72 : width * 0.5);
  st.ctx = setupCanvas(canvas, st.W, st.H);
  canvas.style.width = '100%'; canvas.style.height = 'auto';
  st.pitch = new Pitch(st.W, Math.round(st.W * 2.4), { variant });
  actors.length = 0; tweens.length = 0;
  ball.owner = null; ball.h = 0;
  bubble.a = null;
  st.cover = 1;
}
export const camClamp = (y) => Math.max(st.H / 2, Math.min(st.pitch.h - st.H / 2, y));

// ---------------------------------------------------------------- tweens
// A newer tween on the same object and key replaces the older one.
export function tween(o, to, dur, opt = {}) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    if (tw.o !== o) continue;
    for (const k in to) delete tw.to[k];
    if (!Object.keys(tw.to).length) { tweens.splice(i, 1); tw.res(false); }
  }
  return new Promise((res) => {
    const from = {};
    for (const k in to) from[k] = o[k];
    tweens.push({ o, from, to: { ...to }, dur: Math.max(0.01, dur), t: 0, e: opt.ease || ease, arc: opt.arc || 0, res });
  });
}
function stepTweens(dt) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    tw.t += dt;
    const k = Math.min(1, tw.t / tw.dur), v = tw.e(k);
    for (const key in tw.to) tw.o[key] = lerp(tw.from[key], tw.to[key], v);
    if (tw.arc) tw.o.h = tw.arc * Math.sin(Math.PI * k);
    if (k >= 1) { const j = tweens.indexOf(tw); if (j >= 0) tweens.splice(j, 1); tw.res(true); }
  }
}
export function clearTweens() { tweens.length = 0; }
// A pause that lives in the tween list, so a phase switch cancels it too.
export const wait = (sec) => tween({ k: 0 }, { k: 1 }, sec, { ease: linear });
export const freeze = (ms) => { freezeUntil = performance.now() + ms; };

// ---------------------------------------------------------------- actors
export function actor(char, x, y, facing, size) {
  const a = { char, x, y, facing, size, pose: 'idle', look: 0, alpha: 1, speed: 1, glow: null, bs: facing, tok: 0 };
  actors.push(a);
  return a;
}
export const byChar = (id) => actors.find((a) => a.char.id === id);
export function removeActor(a) {
  const i = actors.indexOf(a);
  if (i >= 0) actors.splice(i, 1);
  if (ball.owner === a) ball.owner = null;
}
const edgeX = (a) => (a.char.team === 'sun' ? -a.size * 0.7 : st.W + a.size * 0.7);
export const onScreen = (a) => a.x > -a.size * 0.5 && a.x < st.W + a.size * 0.5 && a.y > cam.y - st.H / 2 - 4 && a.y - a.size < cam.y + st.H / 2;

// Bring a character on: reuse the actor if he is still around, else he starts
// outside his own touchline (ours left, theirs right) level with `y`.
export function enter(char, y, size) {
  let a = byChar(char.id);
  if (a) { a.tok++; a.size = a.size || size; return a; }
  a = actor(char, 0, y, char.team === 'sun' ? 1 : -1, size);
  a.x = edgeX(a);
  return a;
}
// Send a character off: he jogs to his touchline and only then is removed.
export function leave(a, dur = 0.6) {
  if (!a || !actors.includes(a)) return;
  if (!onScreen(a)) { removeActor(a); return; }
  const tok = ++a.tok;
  const x = edgeX(a);
  a.facing = x > a.x ? 1 : -1; a.pose = 'run'; a.speed = 1; a.glow = null; a.look = 0;
  tween(a, { x, y: a.y }, dur, { ease: linear }).then((ok) => { if (ok && a.tok === tok) removeActor(a); });
}

export function face(a, x) { if (Math.abs(x - a.x) > 2) a.facing = x > a.x ? 1 : -1; }
// Run to a point. Resolves false if another move replaced this one.
export async function runTo(a, p, dur, o = {}) {
  a.tok++;
  face(a, o.faceX ?? p.x);
  a.pose = o.pose || 'run'; a.speed = 1;
  const ok = await tween(a, { x: p.x, y: p.y }, dur, { ease: o.ease || ease });
  if (!ok) return false;
  if (o.then !== null) a.pose = o.then || 'idle';
  if (o.face) a.facing = o.face;
  return true;
}

// ---------------------------------------------------------------- ball
// Where the ball sits when `a` carries it (also the point a pass must reach).
export const footOf = (a, facing = a.facing, x = a.x, y = a.y) => ({ x: x + facing * a.size * 0.17, y: y - 1 });
export function ballTo(p, dur, o = {}) {
  ball.owner = null;
  return tween(ball, { x: p.x, y: p.y }, dur, { ease: o.ease || linear, arc: o.arc || 0 });
}
// Hand the ball to `a`. Only call this when the ball is already at footOf(a).
export function give(a) { a.bs = a.facing; ball.owner = a; ball.h = 0; }
// Where `a` must stand so that his foot is on point `p`.
export const standFor = (a, p, facing) => ({ x: p.x - facing * a.size * 0.17, y: p.y + 1 });

export const panTo = (y, dur) => tween(cam, { y: camClamp(y) }, dur);
export const coverTo = (v, dur) => tween(st, { cover: v }, dur, { ease: linear });

// world -> page pixels (for DOM popups and the tell bubble)
export function toPage(x, y) {
  const r = st.cv.getBoundingClientRect(), k = r.width / st.W;
  return { x: r.left + x * k, y: r.top + (y - cam.y + st.H / 2) * k, k };
}

// ---------------------------------------------------------------- frame
function frame(now) {
  requestAnimationFrame(frame);
  const { ctx, W, H, pitch } = st;
  if (!ctx) return;
  let dt = Math.min(0.05, (now - lastNow) / 1000); lastNow = now;
  if (now < freezeUntil) dt = 0;
  if (DEV && window.__slow) dt *= window.__slow;
  st.T += dt;
  stepTweens(dt);
  for (const a of actors) {
    a.bs += (a.facing - a.bs) * Math.min(1, dt * 14);
    // Lying poses tip over / back up through the art kit's `lay`. If a lying
    // pose is replaced by a standing one, keep drawing the lying pose while it
    // tips back up (0.22 s), so getting up is never a one-frame pop.
    if (LYING[a.pose]) { a._lp = a.pose; a._ly = a.lay ?? 1; a._dp = a.pose; a._dl = a._ly; }
    else if (a._ly > 0) { a._ly = Math.max(0, a._ly - dt / 0.22); a._dp = a._ly > 0 ? a._lp : a.pose; a._dl = a._ly; }
    else { a._dp = a.pose; a._dl = undefined; }
  }
  if (ball.owner) { const o = ball.owner; ball.x = o.x + o.bs * o.size * 0.17; ball.y = o.y - 1; ball.h = 0; }
  ball.spin += dt * (ball.owner ? (ball.owner.pose === 'run' ? 8 : 0.6) : 13);

  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(0, Math.round(H / 2 - cam.y));
  pitch.draw(ctx, st.T, dt);
  if (st.cover < 0.98) { // under a full cover nothing is drawn: that is where cuts happen
    const list = actors.filter((a) => a.alpha > 0.01).sort((a, b) => a.y - b.y);
    const r = Math.max(4, H * 0.026);
    let done = false;
    for (const a of list) {
      if (!done && ball.y < a.y) { drawBall(ctx, ball.x, ball.y, r, ball.spin, ball.h); done = true; }
      drawPlayer(ctx, a.char, a.x, a.y, { size: a.size, pose: a._dp || a.pose, t: st.T, facing: a.facing, look: a.look, alpha: a.alpha, glow: a.glow, speed: a.speed, lay: a._dl });
    }
    if (!done) drawBall(ctx, ball.x, ball.y, r, ball.spin, ball.h);
    if (bubble.a && actors.includes(bubble.a)) drawBubble(ctx);
  }
  pitch.drawFront(ctx, st.T);
  ctx.restore();
  if (st.cover > 0.005) { ctx.fillStyle = `rgba(12,17,34,${Math.min(1, st.cover)})`; ctx.fillRect(0, 0, W, H); }
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------- bubble
const TONE = { plain: ['#fff', '#1b1b2f'], true: ['#c8f5c8', '#1b1b2f'], bluff: ['#ffd0cb', '#1b1b2f'] };
function drawBubble(ctx) {
  const a = bubble.a, { W } = st;
  const k = Math.min(1, (st.T - bubble.t0) / 0.18);
  const sc = 0.6 + 0.4 * (1 - Math.pow(1 - k, 3));
  ctx.save();
  ctx.font = '900 12.5px Nunito, system-ui, sans-serif';
  const tw = ctx.measureText(bubble.text).width;
  ctx.font = '800 9.5px Nunito, system-ui, sans-serif';
  const sw = bubble.sub ? ctx.measureText(bubble.sub).width : 0;
  const w = Math.min(W - 8, Math.max(tw, sw) + 34), h = bubble.sub ? 34 : 24;
  const ax = a.x, ay = a.y - a.size * 0.98;
  const top = cam.y - st.H / 2 + 3;
  let bx = Math.max(4, Math.min(W - 4 - w, ax - w / 2));
  let by = ay - h - 7;
  if (by < top) { // no room above the head: sit beside it instead
    by = Math.max(top, ay + 4);
    bx = ax > W / 2 ? ax - a.size * 0.4 - w : ax + a.size * 0.4;
    bx = Math.max(4, Math.min(W - 4 - w, bx));
  }
  ctx.globalAlpha = k;
  ctx.translate(ax, ay); ctx.scale(sc, sc); ctx.translate(-ax, -ay);
  const [bg, ink] = TONE[bubble.tone] || TONE.plain;
  ctx.fillStyle = bg; ctx.strokeStyle = ink; ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.roundRect(bx, by, w, h, 9); ctx.fill(); ctx.stroke();
  if (by + h < ay) { // tail toward the speaker
    const tx = Math.max(bx + 10, Math.min(bx + w - 10, ax));
    ctx.beginPath(); ctx.moveTo(tx - 6, by + h - 1); ctx.lineTo(tx, ay - 1); ctx.lineTo(tx + 6, by + h - 1); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillRect(tx - 5, by + h - 3, 10, 3);
  }
  ctx.fillStyle = ink; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.font = '15px system-ui, sans-serif';
  ctx.fillText(bubble.icon, bx + 6, by + (bubble.sub ? 13 : h / 2));
  ctx.font = '900 12.5px Nunito, system-ui, sans-serif';
  ctx.fillText(bubble.text, bx + 27, by + (bubble.sub ? 12 : h / 2 + 0.5), w - 32);
  if (bubble.sub) { ctx.globalAlpha = k * 0.6; ctx.font = '800 9.5px Nunito, system-ui, sans-serif'; ctx.fillText(bubble.sub, bx + 27, by + 25, w - 32); }
  ctx.restore();
}
