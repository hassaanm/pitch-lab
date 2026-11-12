// Pitch Lab shared match view: a broadcast-style 2D pitch where every change
// of possession is a physical contact. Used by Touchline (demos/league-deck)
// and Auto XI (demos/auto-xi).
//
// ============================================================== API summary
// import { MatchView, SHAPE7 } from '../../shared/matchview.js';
//
// Pitch convention: vertical pitch. Side 'you' attacks UP (v = 0 is the
// opponent's goal), side 'opp' attacks DOWN. Home spots are given in the
// 'you' frame as [u, v] in 0..1; the view mirrors them (1-u, 1-v) for 'opp'.
// SHAPE7 = Touchline's 3-2-1 home spots: [GK, DF, DF, DF, MF, MF, FW].
//
// Setup
//   const view = new MatchView(canvas);
//   view.resize(w, h, variant)      // CSS px; call once, then only on a real resize
//   view.setTeams(you, opp)         // [{ c, home: [u, v], star? }] per side. Snaps
//                                   // everyone home, ball loose on the centre spot.
//                                   // Call only when a match screen is built.
//   await view.reset(kickoffSide)   // jog home, ball to the centre (faded), a forward
//                                   // of kickoffSide walks onto it. Start of match,
//                                   // half-time, after goals (shot() calls it itself).
//   view.syncTeam(side, list)       // animated substitution (same list shape). Queued;
//                                   // await view.settled() before playing verbs.
//   view.speed = 1 | 2 | 5          // time scale.  view.destroy() stops the loop.
//
// Verbs (all async; each takes an optional { onHit(info), label, color }):
//   onHit fires on the CONTACT frame, never before. Write the log line, the
//   score and banners inside it. info = { kind, by, from?, to?, result?, x, y }
//   (by/from/to are actors; actor.c is your character object).
//   `label` overrides the floating text shown at the contact.
//   ensurePossession(side)  explains any change of possession physically
//                           (long ball won, pass cut out, loose ball collected,
//                           keeper rolls it out, kick-off).
//   build(side)             ensurePossession + 1-2 passes + dribble to midfield.
//   keep(side)              one pass that beats the press (for "kept it" beats).
//   press(side)             side's nearest defender tackles the carrier.
//   tackle(defender, { slide })   generic tackle; ball pops loose, tackler collects.
//   intercept(defender, from, to) from passes toward to; defender cuts it out.
//   blocked(side)           side stops the attack: tackle or interception (random,
//                           or { mode: 'tackle' | 'intercept' }).
//   progress(side, { runner })  a forward (or `runner`, a character) runs into the final
//                           third; ball meets the run.
//   skill(side)             carrier beats the nearest defender (defender lunges, misses).
//   counter(side, { runner })  long ball to a forward (or `runner`) already running;
//                           COUNTER! at release.
//                           onHit info.to is null when no forward was there to pass to.
//   foul(side)              side's defender fouls the carrier; ball rolls loose (free kick).
//   corner(side, takerC?)   wide ball deflected out, taker jogs to the flag, ball fades
//                           in on the arc. Returns the taker. Then call setShooter + shot.
//   setShooter(c, side, { header })  gets c (or a forward if c is null) on the ball in
//                           a shooting position; returns the actor. After a corner or
//                           with { header: true } the shooter waits in the box and the
//                           cross happens inside shot().
//   shot(actor, side, result, { header, dive, miss, parry, keeperDown })
//                           result 'goal' | 'save' | 'miss'. If actor is not the carrier,
//                           the carrier crosses (header) or squares it first and the shot
//                           is first-time. Goal: onHit on the frame the ball crosses the
//                           line, celebration, then reset(conceding side) inside.
//                           dive: 'wrong' | 'short' (goal) ; miss: 'wide' | 'post' ;
//                           parry: true | false (save); dive: 'wrong' on a save = he
//                           commits the wrong way (away from the shooter's side) and the
//                           ball comes in low to his trailing boot without crossing him.
//                           Before the strike, outfield players (crosser included) step
//                           clear of the drawn ball path (0.5 sprite sizes) and of the
//                           keeper's planned path (0.85).
//                           A save registers on the first frame ball and glove touch.
//                           Every non-save path clears the keeper (where he is and
//                           where he dives) by a ball's width. The aim is planned before the
//                           wind-up: players in the shot lane sidestep, everyone holds
//                           still during the flight, and the striker keeps ~2.5 body
//                           widths from the keeper. Dives and slides ease over with
//                           drawPlayer's { lay } (actor.lay, 0..1) and are fully down
//                           on the contact frame; standUp(actor) eases anyone back up.
//   rushOut(side)           the keeper defending against side charges at the carrier.
//   holdGap(actor)          keep a shooter ~2.5 body widths from the keeper he faces
//                           (e.g. while a choice is shown).
//   roundKeeper(actor, side, result)  1-v-1: rounds the keeper (goal/miss) or is smothered (save).
//   penalty(side, takerC)   keeper fouls the carrier, PENALTY!, taker carries the ball to
//                           the spot, keeper back on the line. Returns the taker; then shot().
//   longBall(from, side)    from hits it long; side's nearest player wins it on landing.
// Movement: each actor has one scripted movement at a time. A new runTo (or verb) on an
//   actor takes over from where he is and the older movement stops (its promise resolves
//   early), so two scripts never fight over one player.
// Primitives: wait(s), tween(dur, k => {}), runTo(a, x, y, { dur }), pass(from, to,
//   { lofted }), collect(a), label(text, x, y, color), P(side, u, v) -> [x, y] in the
//   side's attacking frame, sv(side, x, y) -> [u, v] in that frame, find(c, side),
//   team(side), keeper(side), presser(side) (who closes down the carrier),
//   pick(side, pos, { exclude, near }) with fallback pos -> any outfield -> anyone.
// State you may read: view.carrier (actor or null), view.ball {x, y, h, alpha},
//   view.size (sprite px), view.pitch (shared Pitch), view.w / view.h.
// Rules the view keeps: the ball is at a carrier's feet, in flight, or loose; the
//   carrier changes only on a contact frame; nobody moves except in a tween or the
//   free drift (free players hold shape around the ball; the nearest defender
//   closes down the carrier). Run verbs one at a time (await each).
// Dev: with ?jank=1 the view sets window.__view = this. Drive verbs from the console,
//   e.g. __view.speed = 0.25; __view.shot(__view.carrier, 'you', 'save').
// =============================================================================

import { Pitch, drawPlayer, drawBall, setupCanvas, lerp, ease, clamp } from './art.js';
import { sfx } from './sfx.js';

export const SHAPE7 = [[0.5, 0.95], [0.2, 0.76], [0.5, 0.8], [0.8, 0.76], [0.33, 0.58], [0.67, 0.58], [0.5, 0.42]];

const JANK = (() => { try { return new URLSearchParams(location.search).has('jank'); } catch { return false; } })();
const rand = (a, b) => a + Math.random() * (b - a);
const sgn = (v, d = 1) => (v > 0 ? 1 : v < 0 ? -1 : d);
const other = (side) => (side === 'you' ? 'opp' : 'you');
const isGK = (a) => a && a.c.pos === 'GK';
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const easeOut = (k) => 1 - (1 - k) * (1 - k);

// ---- sprite geometry, mirrored from drawPlayer in shared/art.js (design units,
// feet at 0, facing = 1). Used so the ball meets gloves, heads and boots.
function geo(c) {
  const b = c.build || 'mid';
  const bw = { big: 17, mid: 14, slim: 12.5, small: 12.5, tall: 13.5 }[b] || 14;
  const legLen = b === 'tall' ? 11 : b === 'small' ? 7.5 : 9;
  const torsoH = b === 'tall' ? 12 : b === 'small' ? 10 : 11;
  const headR = b === 'small' ? 10.5 : 10;
  const hipY = -legLen, shoulderY = hipY - 4 - torsoH;
  return { bw, legLen, hipY, shoulderY, armY: shoulderY + 2.5, headY: shoulderY - headR + 2, headR, ax: bw / 2 + 0.5 };
}
const posePt = ([x, y], rot, lift) => [x * Math.cos(rot) - y * Math.sin(rot), x * Math.sin(rot) + y * Math.cos(rot) - lift];
const handAt = (x0, y0, ang) => [x0 - 8.5 * Math.sin(ang), y0 + 8.5 * Math.cos(ang)];
// Midpoint between both gloves in the 'dive' pose (diving toward -x when facing = 1).
// `lay` (0..1) is how far over the body has gone, as drawPlayer's { lay } option.
function diveGloves(c, lay = 1) {
  const g = geo(c);
  const rot = -1.35 * lay;
  const f = posePt(handAt(g.ax, g.armY, 2.9 * 0.9 - 0.1), rot, 5);
  const b = posePt(handAt(-g.ax, g.armY, 2.6 * 0.9 + 0.1), rot, 5);
  return [(f[0] + b[0]) / 2 - 2.5 * lay, (f[1] + b[1]) / 2];
}
const LYING = new Set(['dive', 'slide', 'tackle']);
const LANE_GAP = 0.5, KEEPER_GAP = 0.85; // sprite sizes: ball path to any outfield body, outfield player to keeper
const SHORT_TRAVEL = 0.1; // how far (sprite sizes) a beaten keeper's body travels toward the ball
const distSeg = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1;
  const t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L, 0, 1);
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
// Forehead in the 'header' pose.
function headPt(c) { const g = geo(c); return [g.headR * 0.55, g.headY - 6 - 2]; }

export class MatchView {
  constructor(canvas) {
    this.canvas = canvas;
    this.speed = 1;
    this.actors = [];
    this.ball = { x: 0, y: 0, h: 0, spin: 0, alpha: 1 };
    this.carrier = null;
    this.owner = null;
    this.stick = null;
    this.tweens = [];
    this.labels = [];
    this.hitstop = 0;
    this.highlight = null;
    this.kickoffSide = null;
    this.setPiece = null;
    this.queue = Promise.resolve();
    this.running = true;
    this.last = performance.now();
    if (JANK) window.__view = this;
    requestAnimationFrame((t) => this.frame(t));
  }

  destroy() { this.running = false; this.tweens.length = 0; }

  resize(w, h, variant) {
    const old = this.pitch;
    const uv = old ? this.actors.map((a) => old.toUV(a.x, a.y)) : null;
    const buv = old ? old.toUV(this.ball.x, this.ball.y) : null;
    this.w = w; this.h = h;
    this.ctx = setupCanvas(this.canvas, w, h);
    this.pitch = new Pitch(w, h, { variant: variant || old?.variant });
    this.size = clamp(w * 0.085, 28, 46);
    this.s = this.size / 44;
    this.RUN = 0.85 * Math.max(w, h);
    this.PASS = 1.5 * Math.max(w, h);
    this.SHOT = 2.3 * Math.max(w, h);
    if (old) {
      this.actors.forEach((a, i) => { [a.x, a.y] = this.pitch.toPx(...uv[i]); });
      [this.ball.x, this.ball.y] = this.pitch.toPx(...buv);
    }
  }
  setVariant(v) { this.pitch.setVariant(v); }

  // ------------------------------------------------------------ teams
  homePx(side, home) { return side === 'you' ? this.pitch.toPx(home[0], home[1]) : this.pitch.toPx(1 - home[0], 1 - home[1]); }
  mkActor(p, side) {
    const [x, y] = this.homePx(side, p.home);
    const f = side === 'you' ? 1 : -1;
    return { c: p.c, side, home: p.home, star: p.star || 0, x, y, pose: 'idle', facing: f, footOff: f * this.size * 0.2, handK: 0, lay: 1, busy: 0, alpha: 1, phase: Math.random() * 6 };
  }
  setTeams(you, opp) {
    this.tweens.length = 0;
    this.actors = [...you.map((p) => this.mkActor(p, 'you')), ...opp.map((p) => this.mkActor(p, 'opp'))];
    const [x, y] = this.pitch.toPx(0.5, 0.5);
    Object.assign(this.ball, { x, y, h: 0, alpha: 1 });
    this.carrier = null; this.owner = null; this.stick = null;
    this.kickoffSide = null; this.setPiece = null;
  }

  team(side) { return this.actors.filter((a) => a.side === side && !a.leaving); }
  find(c, side) { return c ? this.actors.find((a) => a.c.id === c.id && a.side === side && !a.leaving) : null; }
  keeper(side) { return this.team(side).find(isGK) || null; }
  pick(side, pos, o = {}) {
    const ex = o.exclude || [];
    const pool = this.team(side).filter((a) => !ex.includes(a));
    const tiers = [pos ? pool.filter((a) => a.c.pos === pos) : [], pool.filter((a) => !isGK(a)), pool];
    for (const t of tiers) {
      if (!t.length) continue;
      if (o.near) return t.reduce((b, a) => (dist([a.x, a.y], o.near) < dist([b.x, b.y], o.near) ? a : b));
      return t[(Math.random() * t.length) | 0];
    }
    return null;
  }
  // The side's nearest outfield player to the ball: the one who closes down.
  presser(side) { return this.pick(side, null, { near: [this.ball.x, this.ball.y], exclude: this.team(side).filter(isGK) }); }

  // Side frame: v = 0 is the goal `side` attacks.
  P(side, u, v) { return side === 'you' ? this.pitch.toPx(u, v) : this.pitch.toPx(1 - u, 1 - v); }
  sv(side, x, y) { const [u, v] = this.pitch.toUV(x, y); return side === 'you' ? [u, v] : [1 - u, 1 - v]; }
  fwd(side) { return side === 'you' ? -1 : 1; }
  inPitch([x, y], m = 6) { const p = this.pitch; return [clamp(x, p.x0 + m, p.x1 - m), clamp(y, p.y0 + m, p.y1 - m)]; }
  ballIn() { const p = this.pitch, b = this.ball; return b.alpha > 0.5 && b.x >= p.x0 - 1 && b.x <= p.x1 + 1 && b.y >= p.y0 - 1 && b.y <= p.y1 + 1; }

  // ------------------------------------------------------------ ball contact points
  // Foot point: shared by "stick" and "pass target", so passes end where the stick puts the ball.
  foot(a) { return [a.x + a.footOff, a.y + 1]; }
  gloves(a) { const g = diveGloves(a.c, a.lay ?? 1); return [a.x + g[0] * this.s * a.facing, a.y + 1, -g[1] * this.s]; }
  head(a) { const g = headPt(a.c); return [a.x + g[0] * this.s * a.facing, a.y + 1, -g[1] * this.s]; }
  hold(a) {
    const [fx, fy] = this.foot(a);
    if (a.handK <= 0.001) return [fx, fy, 0];
    const [gx, gy, gh] = this.gloves(a);
    return [lerp(fx, gx, a.handK), lerp(fy, gy, a.handK), gh * a.handK];
  }
  setCarrier(a) {
    this.carrier = a;
    if (a) { this.owner = a.side; this.stick = { x: this.ball.x, y: this.ball.y, h: this.ball.h, t: 0 }; }
  }
  release() { this.carrier = null; this.stick = null; }

  // ------------------------------------------------------------ time
  tween(dur, fn) { return new Promise((res) => this.tweens.push({ t: 0, dur: Math.max(0.001, dur), fn, res })); }
  timeline(T, fn) { return this.tween(T, (k) => fn(k * T, k)); }
  wait(s) { return this.tween(s, () => {}); }
  stop(s = 0.1) { this.hitstop = Math.max(this.hitstop, s); }
  tag(name) { if (JANK) window.__jankCtx = name; }
  lock(...as) {
    const l = as.filter(Boolean);
    l.forEach((a) => { a.busy++; });
    let done = false;
    return () => { if (done) return; done = true; l.forEach((a) => { a.busy = Math.max(0, a.busy - 1); }); };
  }
  label(text, x, y, color = '#fff', life = 1.2) {
    // one thing at a time: a new label replaces an older one in the same place
    this.labels = this.labels.filter((l) => Math.abs(l.x - x) > 90 || Math.abs(l.y - y) > 34);
    this.labels.push({ text, x, y, color, t: 0, life });
  }
  hit(info, o, text, color) {
    const t = o.label ?? text;
    if (t) this.label(t, info.x, info.y - this.size * 0.9, o.color || color);
    o.onHit?.(info);
  }

  // ------------------------------------------------------------ primitives
  // One scripted movement per actor at a time: a new one takes over from where the
  // actor is and the older one stops writing (its promise resolves early).
  claim(a) { a.mv = (a.mv || 0) + 1; return a.mv; }
  owns(a, tok) { return a.mv === tok; }
  // claim several actors; returns ok(a): true while this script still owns a's movement
  movers(...as) { const t = new Map(as.filter(Boolean).map((a) => [a, this.claim(a)])); return (a) => t.get(a) === a.mv; }

  runTo(a, x, y, o = {}) {
    if (!o.free) [x, y] = this.inPitch([x, y], 4);
    const tok = this.claim(a);
    const x0 = a.x, y0 = a.y;
    const d = Math.hypot(x - x0, y - y0);
    const dur = o.dur ?? clamp(d / (this.RUN * (o.walk ? 0.55 : 1)), 0.18, o.walk ? 1.3 : 0.9);
    const unlock = this.lock(a);
    a.pose = o.pose || 'run';
    if (o.face) a.facing = o.face; else if (Math.abs(x - x0) > 3) a.facing = sgn(x - x0);
    const e = o.ease || ease;
    if (o.lay) a.lay = o.lay[0];
    return this.tween(dur, (k) => {
      if (!this.owns(a, tok)) return true;
      a.x = lerp(x0, x, e(k)); a.y = lerp(y0, y, e(k));
      if (o.lay) a.lay = lerp(o.lay[0], o.lay[1], easeOut(k));
    }).then(() => { if (this.owns(a, tok)) a.pose = o.endPose || 'idle'; unlock(); });
  }

  // from must be the carrier. The target is the receiver's foot point, re-read every frame.
  async pass(from, to, o = {}) {
    if (this.carrier !== from || !to) return;
    const unlock = this.lock(from, to);
    try {
      const [tx0, ty0] = this.foot(to);
      from.facing = sgn(tx0 - from.x, from.facing);
      from.pose = o.lofted ? 'kick' : 'pass';
      if (to.busy === 1) { to.pose = 'idle'; to.facing = sgn(from.x - to.x, to.facing); }
      await this.wait(o.windup ?? 0.08);
      if (this.carrier !== from) return;
      o.lofted ? sfx.kick() : sfx.pass();
      o.onRelease?.();
      this.release();
      const sx = this.ball.x, sy = this.ball.y;
      const d = Math.hypot(tx0 - sx, ty0 - sy);
      const dur = o.dur ?? clamp(d / this.PASS, 0.22, 0.75) * (o.lofted ? 1.35 : 1);
      const H = o.lofted ? clamp(d * 0.22, 14, 44) : 1.5;
      await this.tween(dur, (k) => {
        const [tx, ty] = this.foot(to);
        this.ball.x = lerp(sx, tx, k); this.ball.y = lerp(sy, ty, k);
        this.ball.h = Math.sin(k * Math.PI) * H; this.ball.spin += 0.3;
        if (k > 0.35 && (from.pose === 'pass' || from.pose === 'kick')) from.pose = 'idle';
      });
      this.setCarrier(to);
    } finally { unlock(); }
  }

  // Loose ball: the actor runs on to it and arrives with their foot point on the ball.
  async collect(a, o = {}) {
    if (!a || this.carrier) return;
    const f = sgn(this.ball.x - a.x, a.facing);
    const off = this.size * 0.2;
    await this.runTo(a, this.ball.x - f * off, this.ball.y - 1, { face: f, walk: o.walk, free: true });
    if (!this.carrier) this.setCarrier(a);
  }

  // Loose-ball flight (no carrier during or after).
  flight(x, y, dur, o = {}) {
    this.release();
    const b = this.ball, x0 = b.x, y0 = b.y, h0 = b.h, a0 = b.alpha;
    const h1 = o.h1 ?? 0, arc = o.arc ?? 0, e = o.ease || ((k) => k);
    return this.tween(dur, (k) => {
      const q = e(k);
      b.x = lerp(x0, x, q); b.y = lerp(y0, y, q); b.h = lerp(h0, h1, q) + Math.sin(k * Math.PI) * arc; b.spin += o.spin ?? 0.4;
      if (o.alpha != null) b.alpha = lerp(a0, o.alpha, k);
    });
  }
  fadeBall(to, dur = 0.25) { const a0 = this.ball.alpha; return this.tween(dur, (k) => { this.ball.alpha = lerp(a0, to, k); }); }

  // ------------------------------------------------------------ possession
  async ensurePossession(side, o = {}) {
    this.tag('ensurePossession');
    if (!this.ballIn() && !this.carrier) await this.reset(side);
    const c = this.carrier;
    if (!c) {
      const a = this.pick(side, null, { near: [this.ball.x, this.ball.y], exclude: this.team(side).filter(isGK) });
      await this.collect(a);
      this.hit({ kind: 'collect', by: a, x: a.x, y: a.y }, o);
      return;
    }
    if (c.side === side) {
      if (this.kickoffSide === side) {
        this.kickoffSide = null;
        const mf = this.pick(side, 'MF', { exclude: [c], near: [c.x, c.y] });
        await this.pass(c, mf);
        o.onHit?.({ kind: 'kickoff', by: mf, from: c, x: mf.x, y: mf.y });
      } else if (isGK(c)) {
        const d = this.pick(side, 'DF', { exclude: [c] });
        await this.getUp(c);
        await this.pass(c, d);
        o.onHit?.({ kind: 'rollout', by: d, from: c, x: d.x, y: d.y });
      }
      return;
    }
    // the other side has it
    const kick = this.kickoffSide === c.side;
    this.kickoffSide = null;
    const pv = this.sv(side, c.x, c.y)[1];
    if (kick || (!isGK(c) && (Math.random() < 0.3 || pv > 0.5))) {
      const mate = this.pick(c.side, 'MF', { exclude: [c], near: [c.x, c.y] }) || this.pick(c.side, null, { exclude: [c] });
      const mid = [(c.x + mate.x) / 2, (c.y + mate.y) / 2];
      const def = this.pick(side, null, { near: mid, exclude: this.team(side).filter(isGK) });
      return this.intercept(def, c, mate, o);
    }
    return this.longBall(c, side, o);
  }

  // `from` (any side) hits it long; `side` wins it where it lands.
  async longBall(from, side, o = {}) {
    this.tag('longBall');
    const [pu, pv] = this.sv(side, from.x, from.y);
    const L = this.P(side, clamp(pu + rand(-0.25, 0.25), 0.2, 0.8), clamp(pv + 0.38, 0.45, 0.78));
    const R = this.pick(side, null, { near: L, exclude: this.team(side).filter(isGK) });
    const Q = this.pick(from.side, null, { near: L, exclude: [from, ...this.team(from.side).filter(isGK)] });
    const unlock = this.lock(from, R, Q);
    try {
      if (isGK(from)) await this.getUp(from);
      from.facing = sgn(L[0] - from.x, from.facing);
      from.pose = 'kick';
      await this.wait(0.12);
      sfx.kick();
      this.release();
      const S = [this.ball.x, this.ball.y];
      const d = dist(S, L);
      const T = clamp(d / this.PASS * 1.5, 0.55, 1.0);
      const H = clamp(d * 0.28, 24, 56);
      const rf = sgn(L[0] - R.x, R.facing);
      const R0 = [R.x, R.y], R1 = [L[0] - rf * this.size * 0.2, L[1] - 1];
      const Q0 = Q ? [Q.x, Q.y] : null;
      let Q1 = null;
      if (Q) { const dq = dist(Q0, L) || 1; const back = this.size * 0.85; Q1 = dq > back ? [L[0] + (Q0[0] - L[0]) / dq * back, L[1] + (Q0[1] - L[1]) / dq * back] : Q0; Q.facing = sgn(L[0] - Q.x, Q.facing); Q.pose = 'run'; }
      R.facing = rf; R.pose = 'run';
      const rStart = Math.max(0, T - clamp(dist(R0, R1) / this.RUN, 0.3, T));
      const mv = this.movers(R, Q);
      await this.timeline(T, (t, k) => {
        this.ball.x = lerp(S[0], L[0], k); this.ball.y = lerp(S[1], L[1], k);
        this.ball.h = Math.sin(k * Math.PI) * H; this.ball.spin += 0.25;
        if (k > 0.3) from.pose = 'idle';
        const kr = clamp((t - rStart) / (T - rStart), 0, 1);
        if (mv(R)) { R.x = lerp(R0[0], R1[0], ease(kr)); R.y = lerp(R0[1], R1[1], ease(kr)); }
        if (Q && mv(Q)) { const kq = ease(k); Q.x = lerp(Q0[0], Q1[0], kq); Q.y = lerp(Q0[1], Q1[1], kq); }
      });
      this.setCarrier(R);
      R.pose = 'idle';
      if (Q) Q.pose = 'idle';
      sfx.thud();
      this.hit({ kind: 'longball', by: R, from, x: L[0], y: L[1] }, o, 'WON IT', '#FFD23F');
      await this.wait(0.15);
    } finally { unlock(); }
  }

  // from passes toward to; defender reaches a point on the line at the same moment as the ball.
  async intercept(def, from, to, o = {}) {
    this.tag('intercept');
    if (this.carrier !== from || !def || !to) return;
    const unlock = this.lock(def, from, to);
    try {
      to.pose = 'idle'; to.facing = sgn(from.x - to.x, to.facing);
      from.facing = sgn(to.x - from.x, from.facing);
      await this.wait(0.03); // let the passer's foot offset settle toward the target
      const S = this.foot(from), E = this.foot(to);
      const f = rand(0.55, 0.7);
      const I = [lerp(S[0], E[0], f), lerp(S[1], E[1], f)];
      const df = sgn(I[0] - def.x, def.facing);
      const D0 = [def.x, def.y], D1 = [I[0] - df * this.size * 0.2, I[1] - 1];
      const W = 0.1;
      let TI = clamp(dist(S, E) / this.PASS, 0.22, 0.75) * f;
      TI = Math.max(TI, dist(D0, D1) / (this.RUN * 1.2) - W, 0.18);
      def.facing = df; def.pose = 'run';
      from.pose = 'pass';
      let released = false;
      const mv = this.movers(def);
      await this.timeline(W + TI, (t) => {
        const kd = clamp(t / (W + TI), 0, 1);
        if (mv(def)) { def.x = lerp(D0[0], D1[0], easeOut(kd)); def.y = lerp(D0[1], D1[1], easeOut(kd)); }
        if (t >= W) {
          if (!released) { released = true; this.release(); sfx.pass(); }
          const kb = clamp((t - W) / TI, 0, 1);
          this.ball.x = lerp(S[0], I[0], kb); this.ball.y = lerp(S[1], I[1], kb); this.ball.h = 0; this.ball.spin += 0.3;
          if (kb > 0.4) from.pose = 'idle';
        }
      });
      if (!released) this.release();
      this.setCarrier(def);
      def.pose = 'idle'; from.pose = 'idle';
      sfx.thud(); this.stop(0.08);
      this.hit({ kind: 'intercept', by: def, from, to, x: I[0], y: I[1] }, o, 'CUT OUT!', '#9BE7FF');
      await this.wait(0.2);
    } finally { unlock(); }
  }

  // ------------------------------------------------------------ duels
  // Defender runs in, slides; the ball pops loose; the defender gets up and collects it.
  async tackle(def, o = {}) {
    this.tag(o.tag || 'tackle');
    const V = this.carrier;
    if (!V || !def || V.side === def.side) return;
    const unlock = this.lock(def, V);
    try {
      V.pose = 'idle';
      V.facing = sgn(def.x - V.x, V.facing);
      const off = this.size * 0.2;
      const B = [V.x + V.facing * off, V.y + 1]; // where the ball will sit once V has turned
      const f = sgn(B[0] - def.x, -V.facing);
      const yo = clamp(def.y - B[1], -this.size * 0.5, this.size * 0.5);
      const L0 = [B[0] - f * this.size * 0.85, B[1] + yo];
      if (dist([def.x, def.y], L0) > 4) await this.runTo(def, L0[0], L0[1], { face: f, free: true, endPose: 'run' });
      // lunge: the boot meets the ball
      def.pose = o.slide === false ? 'tackle' : 'slide';
      def.facing = f;
      def.lay = 0;
      const C = [this.carrier === V ? this.ball.x : B[0], this.carrier === V ? this.ball.y : B[1]];
      const D0 = [def.x, def.y], D1 = [C[0] - f * 2.5 * this.s, C[1] - 1];
      const mv = this.movers(def);
      await this.tween(0.16, (k) => { if (!mv(def)) return true; def.x = lerp(D0[0], D1[0], k); def.y = lerp(D0[1], D1[1], k); def.lay = easeOut(k); });
      def.lay = 1;
      // contact
      V.pose = 'sad';
      if (o.foul) sfx.whistle(); else sfx.thud();
      this.stop(0.12);
      this.hit({ kind: o.foul ? 'foul' : 'tackle', by: def, from: V, x: C[0], y: C[1] }, o, o.foul ? '🟨 FOUL' : 'WON IT!', o.foul ? '#FFD23F' : '#FF8A3D');
      const pop = o.foul ? this.size * 0.45 : this.size * 0.95;
      const Lp = this.inPitch([C[0] + f * pop, C[1] + rand(-0.25, 0.25) * this.size], 8);
      await this.flight(Lp[0], Lp[1], o.foul ? 0.3 : 0.18, { arc: 3, ease: easeOut });
      await this.wait(0.08);
      await this.standUp(def, 0.22);
      if (o.foul) { this.setPiece = 'freekick'; await this.wait(0.2); return; }
      await this.collect(def);
    } finally { unlock(); }
  }

  press(side, o = {}) { return this.tackle(this.presser(side), { tag: 'press', ...o }); }
  foul(side, o = {}) { return this.tackle(this.presser(side), { tag: 'foul', foul: true, ...o }); }

  async blocked(side, o = {}) {
    this.tag('blocked');
    const C = this.carrier;
    if (!C || C.side === side) return;
    const mode = o.mode || (Math.random() < 0.5 ? 'tackle' : 'intercept');
    const to = this.pick(C.side, 'FW', { exclude: [C] });
    if (mode === 'tackle' || !to) return this.tackle(this.presser(side), { label: 'BLOCKED!', color: '#9BE7FF', ...o, tag: 'blocked' });
    const mid = [(C.x + to.x) / 2, (C.y + to.y) / 2];
    const def = this.pick(side, null, { near: mid, exclude: this.team(side).filter(isGK) });
    return this.intercept(def, C, to, o);
  }

  // One pass that beats the press (for "kept the ball" beats).
  async keep(side, o = {}) {
    this.tag('keep');
    const C = this.carrier;
    if (!C || C.side !== side) return;
    const pr = this.presser(other(side));
    const to = this.pick(side, null, { exclude: [C, ...this.team(side).filter(isGK)], near: pr ? [2 * C.x - pr.x, 2 * C.y - pr.y] : [C.x, C.y] });
    await this.pass(C, to);
    this.hit({ kind: 'keep', by: to, from: C, x: to.x, y: to.y }, o, null);
  }

  async build(side, o = {}) {
    await this.ensurePossession(side, o);
    this.tag('build');
    let C = this.carrier;
    if (!C || C.side !== side) return;
    for (let n = 0; n < 2 && C.c.pos !== 'MF'; n++) {
      const mf = this.pick(side, 'MF', { exclude: [C], near: this.P(side, 0.5, 0.5) });
      if (!mf || mf === C || mf.c.pos !== 'MF') break;
      await this.pass(C, mf); C = mf;
    }
    if (C.c.pos === 'MF' && Math.random() < 0.35) {
      const mate = this.pick(side, 'MF', { exclude: [C] });
      if (mate && mate.c.pos === 'MF') { await this.pass(C, mate); C = mate; }
    }
    const [u, v] = this.sv(side, C.x, C.y);
    const tv = v > 0.62 ? 0.56 : clamp(v - 0.06, 0.4, 0.6);
    const T = this.P(side, clamp(u + rand(-0.08, 0.08), 0.2, 0.8), tv);
    if (this.carrier === C) await this.runTo(C, T[0], T[1]);
  }

  // Ball and runner arrive together: `runner` runs to T while the carrier passes into the run.
  async passIntoRun(runner, T, o = {}) {
    const C = this.carrier;
    const Tr = clamp(dist([runner.x, runner.y], T) / this.RUN, 0.45, 0.9);
    const pd = dist(this.foot(C), T);
    const Tp = clamp(pd / this.PASS, 0.22, 0.75) * (o.lofted ? 1.35 : 1);
    const W = 0.08;
    const lead = Math.max(0, Tr - Tp - W);
    const total = Math.max(Tr, Tp + W);
    await Promise.all([
      this.runTo(runner, T[0], T[1], { dur: total }),
      this.wait(lead).then(() => this.pass(C, runner, { dur: total - lead - W, lofted: o.lofted, windup: W, onRelease: o.onRelease })),
    ]);
  }

  async progress(side, o = {}) {
    this.tag('progress');
    const C = this.carrier;
    if (!C || C.side !== side) return;
    const T = this.P(side, rand(0.3, 0.7), rand(0.2, 0.25));
    const named = this.find(o.runner, side);
    const fw = named && named !== C ? named : this.pick(side, 'FW', { exclude: [C, ...this.team(side).filter(isGK)] });
    let by = fw;
    if (named === C || !fw || (!named && (fw.c.pos !== 'FW' || this.sv(side, fw.x, fw.y)[1] > this.sv(side, C.x, C.y)[1] + 0.05))) {
      by = C;
      await this.runTo(C, T[0], T[1], { dur: 0.7 });
    } else {
      await this.passIntoRun(fw, T, { lofted: Math.random() < 0.35 });
    }
    this.hit({ kind: 'progress', by, from: C, x: by.x, y: by.y }, o, null, '#FFD23F');
  }

  async skill(side, o = {}) {
    this.tag('skill');
    const C = this.carrier;
    if (!C) return;
    side = C.side;
    const D = this.presser(other(side));
    const dir = this.fwd(side);
    const unlock = this.lock(C, D);
    try {
      if (D && dist([C.x, C.y], [D.x, D.y]) > this.size * 1.6) {
        const Cm = [lerp(C.x, D.x, 0.35), lerp(C.y, D.y, 0.35)];
        const Dm = [lerp(D.x, C.x, 0.3), lerp(D.y, C.y, 0.3)];
        await Promise.all([this.runTo(C, Cm[0], Cm[1], { dur: 0.32 }), this.runTo(D, Dm[0], Dm[1], { dur: 0.32 })]);
      }
      const cut = Math.random() < 0.5 ? -1 : 1;
      sfx.whoosh();
      const lunge = D ? this.runTo(D, D.x - cut * this.size * 0.7, D.y + dir * -0.1 * this.size, { dur: 0.22, pose: 'slide', face: -cut, endPose: 'slide', lay: [0, 1] }) : null;
      await this.runTo(C, C.x + cut * this.size * 0.7, C.y + dir * this.size * 0.25, { dur: 0.18 });
      const py = D ? D.y : C.y;
      await this.runTo(C, C.x + cut * this.size * 0.15, py + dir * this.size * 1.3, { dur: 0.24 });
      await lunge;
      this.hit({ kind: 'skill', by: C, from: D, x: C.x, y: C.y }, o, '✨ SKILL!', '#CE93D8');
      await this.wait(0.12);
      if (D) await this.standUp(D, 0.22);
    } finally { unlock(); }
  }

  async counter(side, o = {}) {
    this.tag('counter');
    const C = this.carrier;
    if (!C || C.side !== side) return;
    const named = this.find(o.runner, side);
    const fw = named && named !== C ? named : named === C ? null : this.pick(side, 'FW', { exclude: [C, ...this.team(side).filter(isGK)] });
    const T = this.P(side, rand(0.35, 0.65), 0.36);
    const passes = !!fw && (named ? true : fw.c.pos === 'FW');
    const label = () => { sfx.whoosh(); this.hit({ kind: 'counter', by: C, to: passes ? fw : null, x: C.x, y: C.y }, o, 'COUNTER!', '#FFD23F'); };
    let A = C;
    if (passes) {
      await this.passIntoRun(fw, T, { lofted: true, onRelease: label });
      A = fw;
    } else {
      // no runner ahead: the winner carries it; COUNTER! fires as he pushes the ball forward
      const G0 = this.P(side, clamp(this.sv(side, C.x, C.y)[0], 0.3, 0.7), clamp(this.sv(side, C.x, C.y)[1] - 0.12, 0.3, 0.6));
      const go = this.runTo(C, G0[0], G0[1], { dur: 0.45 });
      label();
      await go;
    }
    const G = this.P(side, rand(0.42, 0.58), 0.22);
    if (this.carrier === A) await this.runTo(A, G[0], G[1], { dur: 0.55 });
  }

  // ------------------------------------------------------------ set pieces
  async corner(side, takerC, o = {}) {
    this.tag('corner');
    if (!this.carrier || this.carrier.side !== side) await this.ensurePossession(side);
    const C = this.carrier;
    if (!C) return null;
    const fu = Math.random() < 0.5 ? 0.1 : 0.9;
    const to = this.pick(side, 'FW', { exclude: [C] }) || this.pick(side, null, { exclude: [C] });
    const W = this.P(side, fu, 0.12);
    // a wide ball toward the byline, deflected out by a defender
    const def = this.pick(other(side), 'DF', { near: W });
    const unlock = this.lock(C, to, def);
    let flag;
    try {
      const runT = this.P(side, fu, 0.1);
      const D1 = [lerp(W[0], this.P(side, 0.5, 0.1)[0], 0.25), W[1]];
      C.facing = sgn(W[0] - C.x, C.facing); C.pose = 'pass';
      await this.wait(0.08);
      sfx.pass(); this.release();
      const S = [this.ball.x, this.ball.y];
      const T = clamp(dist(S, D1) / this.PASS, 0.35, 0.7);
      const T0 = [to.x, to.y], F0 = [def.x, def.y];
      const df = sgn(D1[0] - def.x, def.facing);
      to.pose = 'run'; def.pose = 'run'; def.facing = df; to.facing = sgn(runT[0] - to.x, to.facing);
      const mv = this.movers(to, def);
      await this.timeline(T, (t, k) => {
        this.ball.x = lerp(S[0], D1[0], k); this.ball.y = lerp(S[1], D1[1], k); this.ball.spin += 0.3;
        if (mv(to)) { to.x = lerp(T0[0], lerp(runT[0], D1[0], 0.5), ease(k) * 0.8); to.y = lerp(T0[1], runT[1], ease(k) * 0.8); }
        if (mv(def)) { def.x = lerp(F0[0], D1[0] - df * 2.5 * this.s, easeOut(k)); def.y = lerp(F0[1], D1[1] - 1, easeOut(k)); }
        if (k > 0.7) { def.pose = 'slide'; def.lay = (k - 0.7) / 0.3; }
        if (k > 0.3) C.pose = 'idle';
      });
      def.pose = 'slide'; def.lay = 1; to.pose = 'idle';
      sfx.thud(); this.stop(0.1);
      this.hit({ kind: 'corner', by: def, from: C, x: D1[0], y: D1[1] }, o, 'CORNER', '#fff');
      const out = this.P(side, fu < 0.5 ? 0.04 : 0.96, -0.06);
      await Promise.all([this.flight(out[0], out[1], 0.35, { arc: 8, alpha: 0, ease: easeOut }), this.wait(0.12).then(() => this.standUp(def, 0.22))]);
      flag = this.P(side, fu < 0.5 ? 0.012 : 0.988, 0.012);
    } finally { unlock(); }
    // the taker jogs to the flag; the ball fades in on the arc as they arrive
    const taker = this.find(takerC, side) || this.pick(side, 'MF', { near: flag });
    const tf = flag[0] < this.w / 2 ? 1 : -1;
    Object.assign(this.ball, { x: flag[0], y: flag[1], h: 0, alpha: 0 });
    const run = this.runTo(taker, flag[0] - tf * this.size * 0.2, flag[1] - 1, { face: tf, free: true });
    const Tr = clamp(dist([taker.x, taker.y], flag) / this.RUN, 0.18, 0.9);
    await this.wait(Math.max(0, Tr - 0.3));
    await this.fadeBall(1, 0.3);
    await run;
    this.setCarrier(taker);
    this.setPiece = 'corner';
    return taker;
  }

  async setShooter(c, side, o = {}) {
    this.tag('setShooter');
    let A = this.find(c, side) || this.pick(side, 'FW', { exclude: this.team(side).filter(isGK) });
    let C = this.carrier;
    if (!C && this.setPiece === 'freekick') {
      this.setPiece = null;
      await this.collect(A, { walk: true });
      await this.wait(0.2);
      return A;
    }
    if (!C || C.side !== side) { await this.ensurePossession(side); C = this.carrier; }
    if (!C) return A;
    if (this.setPiece === 'corner' || o.header) {
      // the shooter waits in the box; shot() delivers the cross
      if (A === C) A = this.pick(side, 'FW', { exclude: [C] }) || this.pick(side, null, { exclude: [C] });
      const S = this.P(side, rand(0.4, 0.6), 0.23);
      const jobs = [this.runTo(A, S[0], S[1])];
      if (this.setPiece !== 'corner') {
        const [u] = this.sv(side, C.x, C.y);
        const Wd = this.P(side, u < 0.5 ? 0.1 : 0.9, rand(0.16, 0.22));
        jobs.push(this.runTo(C, Wd[0], Wd[1], { dur: 0.6 }));
      }
      await Promise.all(jobs);
      return A;
    }
    const S = this.P(side, rand(0.34, 0.66), rand(0.2, 0.26));
    if (C === A) {
      const v = this.sv(side, A.x, A.y)[1];
      if (v > 0.26) await this.runTo(A, S[0], S[1]);
      else await this.runTo(A, A.x + rand(-0.4, 0.4) * this.size, A.y + this.fwd(side) * this.size * 0.3, { dur: 0.25 });
      return A;
    }
    await this.passIntoRun(A, S);
    return A;
  }

  // ------------------------------------------------------------ the shot
  // The ball's path is planned before the wind-up: the aim is chosen for the result,
  // everyone but the keeper steps out of that lane, and nobody walks into it during
  // the flight (every player is held for the whole shot). The shooter strikes at
  // least ~2.5 body widths from the keeper.
  async shot(A, side, result, o = {}) {
    this.tag('shot');
    const top = side === 'you';
    const [gx, gy] = this.pitch.goalMouth(top);
    const half = this.pitch.goalW / 2;
    const inward = top ? 1 : -1;
    const K = this.keeper(other(side));
    if (result === 'save' && !K) result = 'miss';
    const unlock = this.lock(...this.actors);
    let reset = false;
    try {
      const C = this.carrier;
      if (C !== A) {
        if (!C) { await this.collect(A); }
        else if (C.side !== side) { await this.ensurePossession(side); if (this.carrier !== A && this.carrier) await this.pass(this.carrier, A); }
      }
      const D = this.carrier;
      const delivery = !!(D && D !== A && D.side === side);
      const header = delivery && !!(o.header || this.setPiece === 'corner');
      this.setPiece = null;
      // ---- where the strike happens
      let A1 = delivery ? this.inPitch([A.x + rand(-0.3, 0.3) * this.size, A.y - inward * this.size * 0.3], 6) : [A.x, A.y];
      if (K && !o.keeperDown) A1 = await this.keepGap(A1, K, gy, inward, delivery ? null : A);
      const af = sgn(gx - A1[0], A.facing);
      const hp = headPt(A.c);
      const S0 = header ? [A1[0] + hp[0] * this.s * af, A1[1] + 1] : [A1[0] + af * this.size * 0.2, A1[1] + 1];
      const plan = this.planShot(result, S0, K, gx, gy, half, { ...o, h0: header ? -hp[1] * this.s : 0 });
      // the drawn ball path for the whole flight (heights as the result will play them)
      const hS = header ? -hp[1] * this.s : 0;
      const [hE, arc] = result === 'goal' ? [5 * this.s, 5] : result === 'save' ? [-diveGloves(K.c)[1] * this.s, 4] : [(plan.post ? 8 : 6) * this.s, plan.post ? 5 : 9];
      const path = [];
      for (let i = 0; i <= 30; i++) { const k = i / 30; path.push([lerp(S0[0], plan.tx, k), lerp(S0[1], gy, k) - (lerp(hS, hE, k) + Math.sin(k * Math.PI) * arc)]); }
      // where the keeper will be: his planned dive or shuffle, or (saves) the line to the save point
      const kPath = [];
      if (K) {
        if (plan.kp && plan.kp.type !== 'still') for (let i = 0; i <= 8; i++) { const st = this.kAt(K, plan.kp, (plan.kp.T * i) / 8); kPath.push([st.x, st.y]); }
        else if (result === 'save') { const P = this.lineAt(S0, plan.tx, gy, K.y); for (let i = 0; i <= 8; i++) kPath.push([lerp(K.x, P[0], i / 8), K.y]); }
        else kPath.push([K.x, K.y]);
      }
      await this.clearLane(path, [A, K], K, kPath);
      // ---- delivery or wind-up
      let h0 = 0;
      if (delivery) h0 = await this.deliver(D, A, header, gx, A1, af);
      else {
        A.facing = af;
        A.pose = 'kick';
        if (K && !o.keeperDown) K.pose = 'ready';
        await this.wait(0.12);
      }
      sfx.kick();
      this.release();
      if (K && !o.keeperDown) K.pose = 'ready';
      const S = [this.ball.x, this.ball.y];
      this.ball.h = h0;
      if (result === 'save') await this.shotSave(A, K, S, h0, gx, gy, half, inward, o, plan);
      else if (result === 'goal') { await this.shotGoal(A, K, side, S, h0, gx, gy, half, inward, o, plan); reset = true; }
      else await this.shotMiss(A, K, side, S, h0, gx, gy, half, inward, o, plan);
    } finally {
      if (A.pose === 'kick' || A.pose === 'header') A.pose = 'idle';
      unlock();
    }
    if (reset) await this.reset(other(side));
  }

  // Keep ~2.5 body widths between the striker and the keeper: the keeper backs onto
  // his line, then (if still too close) the striker takes a touch away.
  async keepGap(A1, K, gy, inward, carrier) {
    const gap = this.size * 0.85; // about 2.5 body widths
    if (dist(A1, [K.x, K.y]) >= gap) return A1;
    const lineY = gy + inward * 4;
    const ky = (inward > 0 ? Math.max : Math.min)(lineY, A1[1] - inward * Math.sqrt(Math.max(0, gap * gap - (A1[0] - K.x) ** 2)));
    if (Math.abs(ky - K.y) > 1) await this.runTo(K, K.x, ky, { dur: 0.22, free: true, endPose: 'ready' });
    let d = dist(A1, [K.x, K.y]);
    if (d >= gap) return A1;
    const ux = d > 1 ? (A1[0] - K.x) / d : sgn(A1[0] - this.w / 2, 1), uy = d > 1 ? (A1[1] - K.y) / d : 0;
    const B = this.inPitch([K.x + ux * gap, K.y + uy * gap + inward * this.size * 0.2], 6);
    if (carrier && this.carrier === carrier) await this.runTo(carrier, B[0], B[1], { dur: 0.25 });
    return B;
  }

  // ---- keeper model, shared by planning and playback (so what was checked is what plays)
  // kp: { type: 'still' | 'shuffle' | 'dive', K0, B, kf, r, T, layStart }
  kAt(K, kp, t) {
    if (!kp || kp.type === 'still') return { x: K.x, y: K.y, pose: K.pose, lay: K.lay ?? 1, facing: K.facing };
    if (kp.type === 'shuffle') { const q = ease(clamp(t / kp.T, 0, 1)); return { x: lerp(kp.K0[0], kp.B[0], q), y: kp.K0[1], pose: 'ready', lay: 1, facing: K.facing }; }
    if (t < kp.r) return { x: kp.K0[0], y: kp.K0[1], pose: 'ready', lay: 1, facing: K.facing };
    const kk = clamp((t - kp.r) / (kp.T - kp.r), 0, 1);
    const q = ease(kk);
    const diving = kk >= kp.layStart;
    return { x: lerp(kp.K0[0], kp.B[0], q), y: lerp(kp.K0[1], kp.B[1], q), pose: diving ? 'dive' : 'ready',
      lay: diving ? easeOut((kk - kp.layStart) / Math.max(0.01, 1 - kp.layStart)) : 1, facing: diving ? kp.kf : K.facing };
  }
  applyK(K, st) { K.x = st.x; K.y = st.y; K.pose = st.pose; K.lay = st.lay; K.facing = st.facing; }
  // Screen points (x, y, radius px) that make up the keeper's body in a state.
  kBody(K, st) {
    const g = geo(K.c), s = this.s, f = st.facing;
    const dive = st.pose === 'dive';
    const rot = dive ? -1.35 * st.lay : 0, lift = dive ? 5 : 0;
    const aF = dive ? 2.9 * 0.9 - 0.1 : -0.9 * 0.9 - 0.1, aB = dive ? 2.6 * 0.9 + 0.1 : 0.9 * 0.9 + 0.1;
    const pts = [[[0, -1], 4], [[0, g.hipY], 6], [[0, g.shoulderY + 4], 7.5], [[0, g.headY], g.headR + 1],
      [handAt(g.ax, g.armY, aF), 3.5], [handAt(-g.ax, g.armY, aB), 3.5],
      [[g.ax, g.armY + 3], 3], [[-g.ax, g.armY + 3], 3]];
    return pts.map(([p, r]) => { const q = posePt(p, rot, lift); return [st.x + q[0] * s * f, st.y + q[1] * s, r * s]; });
  }
  // The two gloves in a state (screen).
  kHands(K, st) { return this.kBody(K, st).slice(4, 6); }
  // Smallest gap (px, edge to edge) between the ball and the keeper over a flight.
  kGap(K, kp, S, E, T, h0, h1, arc, tEnd = T) {
    const br = this.size * 0.13;
    let gap = 1e9;
    for (let i = 0; i <= 30; i++) {
      const t = (tEnd * i) / 30, k = t / T;
      const bx = lerp(S[0], E[0], k), by = lerp(S[1], E[1], k) - (lerp(h0, h1, k) + Math.sin(k * Math.PI) * arc);
      for (const [x, y, r] of this.kBody(K, this.kAt(K, kp, t))) gap = Math.min(gap, Math.hypot(bx - x, by - y) - r - br);
    }
    return gap;
  }

  // Keep a shooter about 2.5 body widths from the keeper he faces (e.g. while a choice is
  // shown): the keeper backs onto his line, then the shooter takes a touch away.
  async holdGap(A) {
    const K = A && this.keeper(other(A.side));
    if (!K) return;
    const top = A.side === 'you';
    const gy = this.pitch.goalMouth(top)[1];
    const inward = top ? 1 : -1;
    // the two sprites (and the name under the carrier) read as stacked when they are
    // less than ~0.75 sizes apart across and ~1.7 sizes apart in depth
    const overlaps = () => Math.abs(A.x - K.x) < this.size * 0.75 && Math.abs(A.y - K.y) < this.size * 1.7;
    const unlock = this.lock(A, K);
    try {
      await this.keepGap([A.x, A.y], K, gy, inward, this.carrier === A ? A : null);
      if (overlaps()) {
        const lineY = gy + inward * 4;
        if (Math.abs(K.y - lineY) > 1) await this.runTo(K, K.x, lineY, { dur: 0.22, free: true, endPose: 'ready' });
        if (overlaps() && this.carrier === A) {
          // a touch to the side (toward the middle if he is near a post): a clear angle on goal
          const [gx] = this.pitch.goalMouth(top);
          let dir = sgn(A.x - K.x, sgn(gx - A.x, 1));
          if (Math.abs(K.x + dir * this.size * 0.85 - gx) > this.pitch.goalW * 0.75) dir = -dir;
          await this.runTo(A, K.x + dir * this.size * 0.85, A.y, { dur: 0.25 });
        }
      }
    } finally { unlock(); }
  }

  // Choose the aim (and the keeper's movement) for a result before the ball is struck.
  // Every non-save path clears the keeper's body, arms and head (where he is and where
  // he goes) by at least a ball's width; saves land in the gloves.
  planShot(result, S, K, gx, gy, half, o) {
    const h0 = o.h0 || 0;
    const ballW = this.size * 0.3; // a ball's width (0.26) plus a little
    const first = Math.random() < 0.5 ? -1 : 1;
    const Tof = (tx) => clamp(dist(S, [tx, gy]) / this.SHOT, 0.22, 0.6);
    const pickBest = (cands) => {
      const ok = cands.filter((c) => c.gap >= ballW);
      if (ok.length) return ok[(Math.random() * ok.length) | 0];
      return cands.reduce((a, c) => (c.gap > a.gap ? c : a), cands[0]);
    };
    if (result === 'save') {
      const g = diveGloves(K.c);
      const reach = Math.abs(g[0]) * this.s;
      const f0 = this.lineAt(S, gx, gy, K.y)[2];
      const txFor = (px) => S[0] + (px - S[0]) / f0;
      let tx = null;
      for (const dd of [first, -first]) { const t = txFor(K.x + dd * (reach + rand(0.5, 0.9) * this.size)); if (Math.abs(t - gx) <= half * 0.9) { tx = t; break; } }
      if (tx == null) tx = clamp(txFor(K.x + first * (reach + 0.5 * this.size)), gx - half * 0.9, gx + half * 0.9);
      return { tx };
    }
    if (result === 'goal') {
      if (!K) return { tx: gx + first * half * rand(0.35, 0.7) };
      const cands = [];
      const xs = []; for (let i = 0; i <= 12; i++) xs.push(gx - half * 0.88 + (half * 1.76 * i) / 12);
      for (const tx of xs) {
        const T = Tof(tx);
        if (o.keeperDown) { cands.push({ tx, kp: { type: 'still' }, gap: this.kGap(K, { type: 'still' }, S, [tx, gy], T, h0, 5 * this.s, 5) }); continue; }
        const P = this.lineAt(S, tx, gy, K.y);
        const Tp = Math.max(0.2, T * P[2]);
        const d = sgn(P[0] - K.x, first);
        for (const mode of ['short', 'wrong']) {
          if (o.dive && o.dive !== mode) continue;
          const dd = mode === 'wrong' ? -d : d;
          const kp = { type: 'dive', K0: [K.x, K.y], B: [K.x + dd * this.size * (mode === 'wrong' ? 0.4 : SHORT_TRAVEL), K.y], kf: -dd, r: Math.min(0.08, Tp * 0.25), T: Tp, layStart: 0.15 };
          cands.push({ tx, kp, mode, d, gap: this.kGap(K, kp, S, [tx, gy], T, h0, 5 * this.s, 5) });
        }
      }
      return pickBest(cands);
    }
    // misses: wide (or over) and the post; the keeper shuffles toward the ball's side
    const wantPost = o.miss ? o.miss === 'post' : Math.random() < 0.35;
    const cands = [];
    for (const sd of [first, -first]) {
      const kp = K && !o.keeperDown ? { type: 'shuffle', K0: [K.x, K.y], B: [K.x + sd * this.size * 0.35, K.y], T: 0.4 } : { type: 'still' };
      const tries = wantPost ? [1] : [1.18, 1.3, 1.45, 1.6];
      for (const f of tries) {
        const tx = gx + sd * half * f, T = Tof(tx);
        kp.T = T;
        const gap = K ? this.kGap(K, kp, S, [tx, gy], T, h0, (wantPost ? 8 : 6) * this.s, wantPost ? 5 : 9) : 1e9;
        cands.push({ tx, kp: { ...kp }, s: sd, post: wantPost, gap });
      }
    }
    const best = pickBest(cands);
    if (wantPost && best.gap < ballW && !o.miss) return this.planShot(result, S, K, gx, gy, half, { ...o, miss: 'wide' });
    return best;
  }

  // Before the strike, every outfield player (crosser included, shooter excluded) whose
  // drawn sprite (feet to head) comes within LANE_GAP of the drawn ball path, or who
  // stands within KEEPER_GAP of the keeper, steps to the nearest spot that is clear of
  // both. `path` is the ball's drawn screen path ([x, y - h] points) for the whole flight.
  async clearLane(path, exclude = [], K = null, kPath = null) {
    const need = this.size * LANE_GAP, kNeed = this.size * KEEPER_GAP;
    const kPts = kPath && kPath.length ? kPath : K ? [[K.x, K.y]] : [];
    const body = (x, y) => [[x, y], [x, y - this.size * 0.95]];
    const gapTo = (x, y) => { const [f, h] = body(x, y); let g = 1e9; for (const p of path) g = Math.min(g, distSeg(p, f, h)); return g; };
    const ok = (x, y) => gapTo(x, y) >= need && kPts.every(([kx, ky]) => Math.hypot(x - kx, y - ky) >= kNeed)
      && x > this.pitch.x0 + 6 && x < this.pitch.x1 - 6 && y > this.pitch.y0 + 4 && y < this.pitch.y1 - 4;
    const jobs = [];
    for (const a of this.actors) {
      if (exclude.includes(a) || isGK(a) || a.alpha < 0.5 || a.leaving) continue;
      if (ok(a.x, a.y)) continue;
      // nearest clear spot: sideways first, then also back toward the pitch
      const away = K ? sgn(a.y - K.y, 1) : 1;
      let best = null;
      for (const dy of [0, 0.3, 0.6, 0.9]) for (let i = 1; i <= 60; i++) {
        for (const sx of [-1, 1]) {
          const x = a.x + sx * i * 2, y = a.y + away * dy * this.size;
          if (!ok(x, y)) continue;
          const cost = Math.hypot(x - a.x, y - a.y);
          if (!best || cost < best.cost) best = { x, y, cost };
        }
        if (best && best.cost < i * 2) break;
      }
      if (best) jobs.push(this.runTo(a, best.x, best.y, { dur: clamp(best.cost / this.RUN, 0.15, 0.3), face: sgn(best.x - a.x, a.facing), free: true }));
    }
    await Promise.all(jobs);
  }

  // Cross (header) or square pass to A, who meets it at A1; returns the ball height at the strike.
  async deliver(D, A, header, gx, A1, af) {
    const unlock = this.lock(D);
    const mv = this.movers(A);
    try {
      D.facing = sgn(A.x - D.x, D.facing);
      D.pose = header ? 'kick' : 'pass';
      await this.wait(0.1);
      header ? sfx.kick() : sfx.pass();
      this.release();
      const S = [this.ball.x, this.ball.y];
      const A0 = [A.x, A.y];
      const gyv = this.pitch.goalMouth(A.side === 'you')[1];
      A1 = A1 || [A.x + rand(-0.3, 0.3) * this.size, A.y + sgn(gyv - A.y) * this.size * 0.3];
      af = af || sgn(gx - A1[0], sgn(S[0] - A1[0]));
      A.facing = af;
      const hp = headPt(A.c);
      const tx = A1[0] + (header ? hp[0] * this.s * af : af * this.size * 0.2), ty = A1[1] + 1;
      const th = header ? -hp[1] * this.s : 0;
      const d = dist(S, [tx, ty]);
      const T = header ? clamp(d / this.PASS * 1.45, 0.5, 0.95) : clamp(d / this.PASS, 0.22, 0.6);
      const H = header ? clamp(d * 0.2, 16, 40) : 1;
      A.pose = 'run';
      await this.timeline(T, (t, k) => {
        this.ball.x = lerp(S[0], tx, k); this.ball.y = lerp(S[1], ty, k);
        this.ball.h = lerp(0, th, k) + Math.sin(k * Math.PI) * H; this.ball.spin += 0.3;
        if (mv(A)) { A.x = lerp(A0[0], A1[0], ease(k)); A.y = lerp(A0[1], A1[1], ease(k)); }
        if (T - t < 0.12) A.pose = header ? 'header' : 'kick';
        if (k > 0.35) D.pose = 'idle';
      });
      A.pose = header ? 'header' : 'kick';
      return th;
    } finally { unlock(); }
  }

  // Where the shot line from S to (tx, gy) crosses the keeper's y.
  lineAt(S, tx, gy, y) { const f = clamp((y - S[1]) / (gy - S[1]), 0.05, 0.98); return [lerp(S[0], tx, f), y, f]; }

  // The keeper's dive along a planned path (see kAt): a short set, then the body goes
  // over while it travels. Kept for callers that pass explicit points.
  diveStep(K, K0, B, kf, r, T, t) { this.applyK(K, this.kAt(K, { type: 'dive', K0, B, kf, r, T, layStart: 0.15 }, t)); }

  async shotSave(A, K, S, h0, gx, gy, half, inward, o, plan) {
    const tx = plan ? plan.tx : this.planShot('save', S, K, gx, gy, half, o).tx;
    const br = this.size * 0.13;
    const touch = (st, bx, by) => Math.min(...this.kHands(K, st).map(([x, y, r]) => Math.hypot(bx - x, by - y) - r - br)) <= 0;
    const leg = o.dive === 'wrong'; // a wrong-way guess that still saves: the trailing leg
    let P, kp, gh, Tp;
    const Tfull = clamp(dist(S, [tx, gy]) / this.SHOT, 0.22, 0.6);
    if (leg) {
      // he commits the other way from where he stands; the ball hits his feet
      // he dives away from the shooter's side (his body lies on the far side), so the ball
      // comes in to the trailing boot on the near side without crossing him
      const d = sgn(S[0] - K.x, Math.random() < 0.5 ? -1 : 1);
      const f0 = this.lineAt(S, gx, gy, K.y)[2];
      const txL = S[0] + (K.x + d * this.size * 0.2 - S[0]) / f0;
      P = this.lineAt(S, txL, gy, K.y);
      Tp = Math.max(0.24, Tfull * P[2]);
      // he goes at once and is down by 30% of the flight, so the column above his boots
      // is empty when the ball arrives; it meets the boot on the open side, low
      kp = { type: 'dive', K0: [K.x, K.y], B: [K.x, K.y], kf: d, r: 0, T: Tp * 0.3, layStart: 0 };
      gh = 6 * this.s; // boot height when he is down
    } else {
      const g = diveGloves(K.c);
      P = this.lineAt(S, tx, gy, K.y);
      const d = sgn(P[0] - K.x);
      const kf = -d; // the dive pose reaches toward -facing
      const B = [P[0] - g[0] * this.s * kf, P[1]];
      gh = -g[1] * this.s;
      Tp = Math.max(0.24, Tfull * P[2]);
      // pick the dive timing whose first glove touch comes on the last frame (the
      // raised arms must not meet the ball early and ride along with it)
      let best = null;
      for (const layStart of [0.15, 0.3, 0.45, 0.6, 0.75]) for (const rr of [0.04, 0.08, 0.12]) {
        const cand = { type: 'dive', K0: [K.x, K.y], B, kf, r: Math.min(rr, Tp * 0.4), T: Tp, layStart };
        let ft = Tp;
        for (let i = 0; i <= 60; i++) {
          const t = (Tp * i) / 60, k = t / Tp;
          const st = this.kAt(K, cand, t);
          const bx = lerp(S[0], P[0], k), by = lerp(S[1], P[1] + 1, k) - (lerp(h0, gh, k) + Math.sin(k * Math.PI) * 4);
          if (touch(st, bx, by)) { ft = t; break; }
        }
        const score = ft - layStart * 0.02; // later first touch is better; then the earliest dive
        if (!best || score > best.score + 1e-4) best = { score, cand, ft };
      }
      kp = best.cand;
    }
    const mv = this.movers(K);
    let early = false;
    await this.timeline(Tp, (t, k) => {
      this.ball.x = lerp(S[0], P[0], k); this.ball.y = lerp(S[1], P[1] + 1, k);
      this.ball.h = lerp(h0, gh, k) + Math.sin(k * Math.PI) * 4; this.ball.spin += 0.6;
      if (mv(K)) this.applyK(K, this.kAt(K, kp, t));
      if (k > 0.3 && A.pose === 'kick') A.pose = 'idle';
      // safety net: if a glove meets the ball before the planned frame, that is the contact
      if (!leg && k < 1 && touch(K, this.ball.x, this.ball.y - this.ball.h)) { early = true; return true; }
    });
    if (!early) this.applyK(K, this.kAt(K, kp, Tp));
    if (!leg) K.handK = 1;
    sfx.save(); this.stop(0.13);
    this.hit({ kind: 'save', result: 'save', by: K, from: A, x: this.ball.x, y: this.ball.y }, o, 'SAVED!', '#9BE7FF');
    const parry = leg || (o.parry ?? Math.random() < 0.4);
    const d = sgn(this.ball.x - K.x);
    if (!parry) {
      this.setCarrier(K);
      // caught before he was fully down: he lands with it
      if (K.lay < 1) { const l0 = K.lay; await this.tween(0.12, (k) => { K.lay = lerp(l0, 1, ease(k)); }); }
      await this.wait(0.3);
      await this.getUp(K);
      return;
    }
    K.handK = 0;
    const Lp = this.inPitch([this.ball.x + d * this.size * 1.1, this.ball.y + inward * this.size * 1.7], 10);
    await this.flight(Lp[0], Lp[1], 0.28, { h1: 0, arc: 8, ease: easeOut });
    const def = this.pick(K.side, 'DF', { near: Lp, exclude: [K] });
    await Promise.all([this.collect(def), this.wait(0.15).then(() => this.standUp(K, 0.3))]);
  }

  // Anyone lying (dive, slide, tackle) gets up over a few frames instead of snapping.
  async standUp(a, dur = 0.22, pose = 'idle') {
    if (!a || !LYING.has(a.pose)) return;
    const unlock = this.lock(a);
    try {
      const l0 = a.lay ?? 1;
      await this.tween(dur, (k) => { a.lay = l0 * (1 - ease(k)); });
      a.pose = pose; a.lay = 1;
    } finally { unlock(); }
  }

  // A keeper in the dive pose stands up where the ball is: the body comes up
  // (lay 1 -> 0) and the hold point eases from the gloves to the feet.
  async getUp(K) {
    if (K.pose !== 'dive' && K.handK <= 0.001) return;
    const unlock = this.lock(K);
    try {
      const holding = this.carrier === K;
      const [gx, gy] = this.gloves(K);
      const off = K.facing * this.size * 0.2;
      const B0 = [K.x, K.y], B1 = holding ? [gx - off, gy - 1] : [K.x, K.y];
      const l0 = K.pose === 'dive' ? K.lay ?? 1 : 0;
      K.footOff = off;
      const mv = this.movers(K);
      await this.tween(0.34, (k) => {
        if (mv(K)) { K.x = lerp(B0[0], B1[0], ease(k)); K.y = lerp(B0[1], B1[1], ease(k)); }
        K.lay = l0 * (1 - ease(k));
        K.handK = (1 - k) * (1 - k);
      });
      K.pose = 'idle'; K.lay = 1; K.handK = 0;
    } finally { unlock(); }
  }

  async shotGoal(A, K, side, S, h0, gx, gy, half, inward, o, plan) {
    plan = plan || this.planShot('goal', S, K, gx, gy, half, { ...o, h0 });
    const tx = plan.tx;
    const Tline = clamp(dist(S, [tx, gy]) / this.SHOT, 0.22, 0.6);
    const kp = K && !o.keeperDown ? plan.kp : null;
    const mv = this.movers(K);
    const E = [tx, gy];
    await this.timeline(Tline, (t, k) => {
      this.ball.x = lerp(S[0], E[0], k); this.ball.y = lerp(S[1], E[1], k);
      this.ball.h = lerp(h0, 5 * this.s, k) + Math.sin(k * Math.PI) * 5; this.ball.spin += 0.6;
      if (kp && mv(K)) this.applyK(K, this.kAt(K, kp, Math.min(t, kp.T)));
      if (k > 0.3 && A.pose === 'kick') A.pose = 'idle';
    });
    // the frame the ball crosses the line
    this.pitch.goal(side === 'you');
    sfx.goal(); this.stop(0.15);
    this.hit({ kind: 'goal', result: 'goal', by: A, x: E[0], y: E[1] }, o, null);
    const N = [tx + (tx - S[0]) * 0.05, gy - inward * this.pitch.netDepth * 0.65];
    await this.flight(N[0], N[1], 0.22, { h1: 0, ease: easeOut });
    // celebrate / slump; the beaten keeper gets up slowly, then slumps
    const scorers = this.team(side).filter((a) => !isGK(a)), losers = this.team(other(side));
    const unlock = this.lock(...this.actors);
    try {
      scorers.forEach((a) => { a.pose = 'celebrate'; });
      losers.forEach((a) => { if (a !== K && !LYING.has(a.pose)) a.pose = 'sad'; });
      await this.wait(0.35);
      await Promise.all(this.actors.filter((a) => LYING.has(a.pose)).map((a) => this.standUp(a, 0.4, 'sad')));
      await this.wait(0.7);
    } finally {
      this.actors.forEach((a) => { if (a.pose === 'celebrate' || a.pose === 'sad') a.pose = 'idle'; });
      unlock();
    }
  }

  async shotMiss(A, K, side, S, h0, gx, gy, half, inward, o, plan) {
    plan = plan || this.planShot('miss', S, K, gx, gy, half, { ...o, h0 });
    const { s, post, tx } = plan;
    const Tline = clamp(dist(S, [tx, gy]) / this.SHOT, 0.22, 0.6);
    const kp = K && !o.keeperDown && plan.kp && plan.kp.type === 'shuffle' ? { ...plan.kp, T: Tline } : null;
    const mv = this.movers(K);
    await this.timeline(Tline, (t, k) => {
      this.ball.x = lerp(S[0], tx, k); this.ball.y = lerp(S[1], gy, k);
      this.ball.h = lerp(h0, post ? 8 * this.s : 6 * this.s, k) + Math.sin(k * Math.PI) * (post ? 5 : 9); this.ball.spin += 0.6;
      if (kp && mv(K)) this.applyK(K, this.kAt(K, kp, t));
      if (k > 0.3 && A.pose === 'kick') A.pose = 'idle';
    });
    if (post) {
      sfx.thud(); this.stop(0.1);
      this.hit({ kind: 'post', result: 'miss', by: A, x: tx, y: gy + inward * this.size * 0.6 }, o, 'POST!', '#fff');
      const L = this.inPitch([tx - s * this.size * 1.0, gy + inward * this.size * 2.4], 10);
      await this.flight(L[0], L[1], 0.34, { h1: 0, arc: 10, ease: easeOut });
      if (K && K.pose === 'ready') K.pose = 'idle';
      A.pose = 'sad';
      const def = this.pick(K ? K.side : other(side), 'DF', { near: L, exclude: K ? [K] : [] });
      await this.collect(def);
      A.pose = 'idle';
      return;
    }
    sfx.ooh();
    this.hit({ kind: 'wide', result: 'miss', by: A, x: tx, y: gy + inward * this.size * 0.6 }, o, 'WIDE!', '#fff');
    A.pose = 'sad';
    const out = [tx + (tx - S[0]) * 0.12, gy - inward * (this.pitch.netDepth + 10)];
    await this.flight(out[0], out[1], 0.3, { h1: 0, alpha: 0, ease: easeOut });
    await this.wait(0.2);
    A.pose = 'idle';
    if (!K) return;
    // goal kick: the ball fades in on the six-yard line and the keeper walks to it
    K.pose = 'idle';
    const G = [gx + rand(-0.5, 0.5) * half, gy + inward * this.pitch.ph * 0.07];
    Object.assign(this.ball, { x: G[0], y: G[1], h: 0, alpha: 0 });
    await Promise.all([this.fadeBall(1, 0.3), this.collect(K, { walk: true })]);
  }

  // ------------------------------------------------------------ key moments
  async rushOut(side, o = {}) {
    this.tag('rushOut');
    const K = this.keeper(other(side));
    const C = this.carrier;
    if (!K || !C) return;
    const d = dist([K.x, K.y], [C.x, C.y]);
    const go = Math.max(0, Math.min(d * 0.45, d - this.size * 1.15));
    const T = [K.x + (C.x - K.x) / (d || 1) * go, K.y + (C.y - K.y) / (d || 1) * go];
    await this.runTo(K, T[0], T[1], { dur: 0.4, endPose: 'ready' });
    K.pose = 'ready';
  }

  async roundKeeper(A, side, result, o = {}) {
    this.tag('roundKeeper');
    const K = this.keeper(other(side));
    if (this.carrier !== A || !K) return this.shot(A, side, result, o);
    const unlock = this.lock(A, K);
    const dir = this.fwd(side);
    try {
      // close the gap: keeper comes out, shooter drives at him
      const M = [lerp(K.x, A.x, 0.5), lerp(K.y, A.y, 0.5)];
      await Promise.all([
        this.runTo(K, M[0], M[1] - dir * this.size * 0.55, { dur: 0.4, endPose: 'ready' }),
        this.runTo(A, M[0], M[1] + -dir * this.size * 0.75, { dur: 0.4, endPose: 'run' }),
      ]);
      const cut = Math.random() < 0.5 ? -1 : 1;
      const A0 = [A.x, A.y], A1 = this.inPitch([A.x + cut * this.size * 1.3, A.y + dir * this.size * 0.7], 6);
      const T = 0.26;
      const off = this.size * 0.2;
      A.facing = cut;
      const g = diveGloves(K.c);
      const K0 = [K.x, K.y];
      if (result === 'save') {
        // smother: gloves reach the ball at A's feet at the end of the cut
        const Bp = [lerp(A0[0], A1[0], 0.55) + cut * off, lerp(A0[1], A1[1], 0.55) + 1];
        const kf = -sgn(Bp[0] - K.x, cut);
        const KB = [Bp[0] - g[0] * this.s * kf, Bp[1] - 1];
        await this.timeline(T, (t, k) => {
          const q = ease(k) * 0.55;
          A.x = lerp(A0[0], A1[0], q); A.y = lerp(A0[1], A1[1], q);
          this.diveStep(K, K0, KB, kf, 0, T, t);
        });
        K.pose = 'dive'; K.facing = kf; K.lay = 1; K.handK = 1;
        A.pose = 'sad';
        sfx.save(); this.stop(0.13);
        this.setCarrier(K); this.stick = null;
        this.hit({ kind: 'save', result: 'save', by: K, from: A, x: Bp[0], y: Bp[1] }, o, 'SMOTHERED!', '#9BE7FF');
        await this.wait(0.45);
        await this.getUp(K);
        A.pose = 'idle';
        return;
      }
      // the keeper goes down where the ball was and misses
      const Bp = this.foot(A);
      const kf = -sgn(Bp[0] - K.x, -cut);
      const KB = [Bp[0] - g[0] * this.s * kf, Bp[1] - 1];
      await this.timeline(T, (t, k) => {
        A.x = lerp(A0[0], A1[0], ease(k)); A.y = lerp(A0[1], A1[1], ease(k));
        this.diveStep(K, K0, KB, kf, 0, T, t);
      });
      sfx.whoosh();
      this.label('ROUNDED HIM!', A.x, A.y - this.size, '#CE93D8');
      // carry on round him, goal-side and well clear, before the finish
      const A2 = this.inPitch([A.x + cut * this.size * 0.5, A.y + dir * this.size * 0.6], 8);
      await this.runTo(A, A2[0], A2[1], { dur: 0.22 });
    } finally { unlock(); }
    await this.shot(A, side, result, { ...o, keeperDown: true });
    if (LYING.has(K.pose)) await this.standUp(K, 0.3);
  }

  async penalty(side, takerC, o = {}) {
    this.tag('penalty');
    const K = this.keeper(other(side));
    const C = this.carrier;
    if (K && C && C.side === side) {
      await this.tackle(K, { tag: 'penalty', foul: true, label: 'PENALTY!', color: '#FF6B6B', onHit: o.onHit });
      this.setPiece = null;
    }
    const taker = this.find(takerC, side) || C || this.pick(side, 'FW');
    const spot = this.P(side, 0.5, 0.11); // the painted penalty spot
    const [gx, gy] = this.pitch.goalMouth(side === 'you');
    const Kline = [gx, gy + (side === 'you' ? 1 : -1) * 4]; // on his line
    const jobs = [];
    for (const a of this.actors) {
      if (a === taker || a === K || isGK(a)) continue;
      const [u, v] = this.sv(side, a.x, a.y);
      if (v < 0.28 && Math.abs(u - 0.5) < 0.4) { const T = this.P(side, u, rand(0.3, 0.36)); jobs.push(this.runTo(a, T[0], T[1])); }
    }
    if (K) jobs.push(this.standUp(K, 0.25).then(() => this.getUp(K)).then(() => this.runTo(K, Kline[0], Kline[1], { endPose: 'ready', free: true })));
    jobs.push((async () => {
      if (this.carrier !== taker) { this.release(); await this.collect(taker); }
      const f = sgn(spot[0] - taker.x, taker.facing);
      await this.runTo(taker, spot[0] - f * this.size * 0.2, spot[1] - 1, { walk: true });
      // place it: the ball rolls dead centre on the spot and the taker steps back
      this.release();
      await this.flight(spot[0], spot[1], 0.15);
      const back = this.P(side, 0.5, 0.18);
      await this.runTo(taker, back[0] - this.size * 0.3, back[1], { walk: true });
      taker.facing = 1;
    })());
    await Promise.all(jobs);
    if (K) K.pose = 'ready';
    await this.wait(0.3);
    const tf = 1;
    await this.runTo(taker, spot[0] - tf * this.size * 0.2, spot[1] - 1, { dur: 0.35, face: tf });
    this.setCarrier(taker);
    return taker;
  }

  // ------------------------------------------------------------ resets and subs
  async reset(kickoffSide = 'you', o = {}) {
    this.tag('reset');
    const unlock = this.lock(...this.actors);
    try {
      this.release();
      const centre = this.pitch.toPx(0.5, 0.5);
      const taker = this.pick(kickoffSide, 'FW');
      const tf = 1;
      await Promise.all(this.actors.filter((a) => LYING.has(a.pose)).map((a) => this.standUp(a, 0.3)));
      const jobs = this.actors.map((a) => {
        a.handK = 0;
        let [x, y] = a === taker ? [centre[0] - tf * this.size * 0.2 - this.size * 0.6, centre[1] - 1] : this.homePx(a.side, a.home);
        if (a !== taker) { const [u, v] = this.sv(a.side, x, y); [x, y] = this.P(a.side, u, Math.max(v, 0.55)); }
        const d = Math.hypot(x - a.x, y - a.y);
        return this.runTo(a, x, y, { dur: clamp(d / this.RUN, 0.6, 1.0), face: a === taker ? tf : undefined });
      });
      const ballJob = (async () => {
        if (this.ball.alpha > 0.01) await this.fadeBall(0, 0.25);
        Object.assign(this.ball, { x: centre[0], y: centre[1], h: 0 });
        await this.wait(0.3);
        await this.fadeBall(1, 0.3);
      })();
      await Promise.all([...jobs, ballJob]);
      this.actors.forEach((a) => { a.pose = 'idle'; });
      if (taker) await this.runTo(taker, centre[0] - tf * this.size * 0.2, centre[1] - 1, { walk: true, face: tf });
      if (taker && !this.carrier) this.setCarrier(taker);
      this.kickoffSide = kickoffSide;
      this.setPiece = null;
      o.onHit?.({ kind: 'reset', by: taker });
    } finally { unlock(); }
  }

  settled() { return this.queue; }
  syncTeam(side, list) {
    this.queue = this.queue.then(() => this._sync(side, list)).catch((e) => console.error(e));
    return this.queue;
  }
  async _sync(side, list) {
    this.tag('syncTeam');
    const cur = this.team(side);
    const ids = new Set(list.map((p) => p.c.id));
    const outgoing = cur.filter((a) => !ids.has(a.c.id));
    const incoming = list.filter((p) => !cur.some((a) => a.c.id === p.c.id));
    for (const a of cur) { const p = list.find((q) => q.c.id === a.c.id); if (p) { a.home = p.home; a.star = p.star || 0; } }
    if (!outgoing.length && !incoming.length) return;
    const jobs = [];
    const edge = (x, y) => [x < this.w / 2 ? this.pitch.x0 - this.size * 0.3 : this.pitch.x1 + this.size * 0.3, y];
    incoming.forEach((p, i) => {
      const o = outgoing[i];
      jobs.push((async () => {
        let E;
        if (o) {
          o.leaving = true;
          const unlock = this.lock(o);
          if (this.carrier === o) {
            const mate = this.pick(side, null, { near: [o.x, o.y], exclude: [o, ...cur.filter(isGK)] });
            if (mate) await this.pass(o, mate);
          }
          E = edge(o.x, o.y);
          await this.runTo(o, E[0], E[1], { free: true });
          await this.tween(0.25, (k) => { o.alpha = 1 - k; });
          unlock();
          this.actors.splice(this.actors.indexOf(o), 1);
        } else {
          const [hx, hy] = this.homePx(side, p.home);
          E = edge(hx, hy);
        }
        const a = this.mkActor(p, side);
        a.x = E[0]; a.y = E[1]; a.alpha = 0;
        a.facing = sgn(this.w / 2 - E[0]);
        this.actors.push(a);
        const unlock2 = this.lock(a);
        const [hx, hy] = this.homePx(side, p.home);
        await Promise.all([this.tween(0.25, (k) => { a.alpha = k; }), this.wait(0.1).then(() => this.runTo(a, hx, hy))]);
        a.alpha = 1;
        unlock2();
      })());
    });
    for (const o of outgoing.slice(incoming.length)) {
      jobs.push((async () => {
        o.leaving = true;
        const unlock = this.lock(o);
        const E = edge(o.x, o.y);
        await this.runTo(o, E[0], E[1], { free: true });
        await this.tween(0.25, (k) => { o.alpha = 1 - k; });
        unlock();
        this.actors.splice(this.actors.indexOf(o), 1);
      })());
    }
    await Promise.all(jobs);
  }

  // ------------------------------------------------------------ frame
  drift(sdt) {
    const b = this.ball;
    const [bu, bv] = this.pitch.toUV(b.x, b.y);
    const C = this.carrier;
    const pr = C ? this.presser(other(C.side)) : null;
    const t = performance.now() / 1000;
    for (const a of this.actors) {
      if (a.busy || a.leaving) continue;
      let tx, ty;
      if (a === C) { tx = a.x; ty = a.y; }
      else if (a === pr) {
        // goal-side and off to one side, so he never hides the keeper or the goal
        tx = b.x + (a.x < b.x ? -0.85 : 0.85) * this.size;
        ty = b.y + this.fwd(C.side) * this.size * 1.0;
      } else {
        const [hu, hv] = a.side === 'you' ? a.home : [1 - a.home[0], 1 - a.home[1]];
        let u = hu, v = hv;
        if (isGK(a)) u = 0.5 + (bu - 0.5) * 0.25;
        else {
          const attacking = this.owner === a.side;
          const push = attacking ? (a.side === 'you' ? -0.1 : 0.1) : (a.side === 'you' ? 0.05 : -0.05);
          v = hv + (bv - 0.5) * 0.55 + push;
          u = hu + (bu - 0.5) * 0.35 + Math.sin(t / 1.3 + a.phase) * 0.02;
        }
        [tx, ty] = this.pitch.toPx(clamp(u, 0.06, 0.94), clamp(v, 0.04, 0.96));
        // never park on top of a keeper (either team's): he must stay visible
        for (const gk of this.actors) {
          if (!isGK(gk) || gk === a) continue;
          if (Math.abs(tx - gk.x) < this.size * 0.8 && Math.abs(ty - gk.y) < this.size * 0.9) tx = gk.x + sgn(tx - gk.x, sgn(a.x - gk.x, 1)) * this.size * 0.8;
        }
      }
      const dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy);
      const sp = (40 + (a.c.stats?.pace ?? 6) * 6) * (a === pr ? 1.3 : 1) * sdt;
      if (d > 1.5) {
        a.x += (dx / d) * Math.min(d, sp); a.y += (dy / d) * Math.min(d, sp);
        if (d > 4) a.pose = 'run';
        if (Math.abs(dx) > 2) a.facing = sgn(dx);
      } else {
        a.pose = 'idle';
        if (Math.abs(b.x - a.x) > 8 && a !== C) a.facing = sgn(b.x - a.x);
      }
    }
  }

  frame(now) {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.ctx) { requestAnimationFrame((t) => this.frame(t)); return; }
    let sdt = dt * this.speed;
    if (this.hitstop > 0) { this.hitstop -= dt; sdt = 0; }
    if (sdt > 0) {
      this.drift(sdt);
      for (const tw of [...this.tweens]) {
        tw.t += sdt;
        const k = Math.min(1, tw.t / tw.dur);
        let stop = false;
        try { stop = tw.fn(k) === true; } catch (e) { console.error(e); stop = true; }
        if (stop || tw.t >= tw.dur) { this.tweens.splice(this.tweens.indexOf(tw), 1); tw.res(); }
      }
      const rate = 1 - Math.exp(-14 * sdt);
      for (const a of this.actors) a.footOff += (a.facing * this.size * 0.2 - a.footOff) * rate;
    }
    const C = this.carrier;
    if (C) {
      const [x, y, h] = this.hold(C);
      const st = this.stick;
      if (st && st.t < 1) {
        st.t = Math.min(1, st.t + sdt / 0.08);
        const k = ease(st.t);
        this.ball.x = lerp(st.x, x, k); this.ball.y = lerp(st.y, y, k); this.ball.h = lerp(st.h, h, k);
      } else { this.ball.x = x; this.ball.y = y; this.ball.h = h; }
    }
    this.draw(now / 1000, dt);
    requestAnimationFrame((t) => this.frame(t));
  }

  draw(t, dt) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    this.pitch.draw(ctx, t, dt);
    const sorted = [...this.actors].sort((a, b) => a.y - b.y);
    const b = this.ball;
    const r = this.size * 0.13;
    // A carried ball is depth-sorted with the players; a ball in flight or loose is
    // drawn over them, so a shot never vanishes behind a body on its way.
    const ballY = b.y - 0.5;
    const drawB = () => {
      if (b.alpha <= 0.01) return;
      ctx.save(); ctx.globalAlpha = b.alpha;
      drawBall(ctx, b.x, b.y, r, b.spin, b.h);
      ctx.restore();
    };
    let ballDrawn = false;
    const at = t * (this.speed > 1 ? 1.5 : 1);
    for (const a of sorted) {
      if (!ballDrawn && this.carrier && ballY < a.y) { drawB(); ballDrawn = true; }
      const glow = this.carrier === a ? (a.side === 'you' ? '#FFD23F' : '#FF6B6B') : (this.highlight === a.c.id ? '#fff' : null);
      drawPlayer(ctx, a.c, a.x, a.y, { size: this.size, pose: a.pose, t: at, facing: a.facing, glow, look: a.side === 'you' ? 0.3 : -0.3, alpha: a.alpha, lay: LYING.has(a.pose) ? a.lay ?? 1 : undefined });
      if (a.star >= 2 && a.alpha > 0.5) this.text('★★', a.x, a.y - this.size * 1.02, Math.round(this.size * 0.3), '#FFD23F', a.alpha);
    }
    if (!ballDrawn) drawB();
    // the carrier's name under their feet: every beat has a named actor on screen
    if (this.carrier && this.carrier.alpha > 0.5) {
      const a = this.carrier;
      this.text(a.c.name, clamp(a.x, 24, this.w - 24), a.y + this.size * 0.36, 10.5, '#fff', 1, '800 10.5px Nunito, system-ui, sans-serif');
    }
    this.pitch.drawFront(ctx, t);
    for (const l of [...this.labels]) {
      l.t += dt;
      const k = l.t / l.life;
      if (k >= 1) { this.labels.splice(this.labels.indexOf(l), 1); continue; }
      const fs = Math.round(this.size * 0.44);
      ctx.font = `${fs}px "Lilita One", system-ui`;
      const half = ctx.measureText(l.text).width / 2 + 4;
      const x = clamp(l.x, half, this.w - half);
      const y = clamp(l.y - k * 16, fs + 2, this.h - 4);
      const pop = k < 0.12 ? 0.7 + 0.3 * (k / 0.12) : 1;
      ctx.save();
      ctx.translate(x, y); ctx.scale(pop, pop);
      this.text(l.text, 0, 0, fs, l.color, k < 0.8 ? 1 : (1 - k) / 0.2, `${fs}px "Lilita One", system-ui`);
      ctx.restore();
    }
  }

  text(s, x, y, fs, color, alpha = 1, font) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = font || `${fs}px "Lilita One", system-ui`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = Math.max(3, fs * 0.3); ctx.lineJoin = 'round'; ctx.strokeStyle = '#1b1b2f';
    ctx.strokeText(s, x, y);
    ctx.fillStyle = color; ctx.fillText(s, x, y);
    ctx.restore();
  }
}
