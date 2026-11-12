// Push Your Luck pitch view: sprites on the shared Pitch.
//
// Contract (see POLISH.md): nothing here teleports during play.
//  - Players only move through timed runs (runTo / runToPx / moveAll). A new
//    run starts from where the sprite is right now, so runs can be chained or
//    interrupted without a jump.
//  - The ball is either in flight (ballTo), or held. hold(k) never snaps the
//    ball: if it is not already on the holder's foot it rolls there.
//  - setCast() is the only instant placement. It is used once per screen
//    build, before the first frame is drawn.
// Tweens, hit-stop, floating labels, and a timer fallback so the game flow
// never stalls if requestAnimationFrame is throttled.

import { Pitch, drawPlayer, drawBall, setupCanvas, lerp, ease, clamp } from '../../shared/art.js';

export class PossView {
  constructor(canvas) {
    this.canvas = canvas;
    this.actors = new Map(); // key -> { c, side, u, v, x, y, pose, facing, mv }
    this.ball = { x: 0, y: 0, h: 0, spin: 0 };
    this.ballFree = false;
    this.holder = null;
    this.tweens = [];
    this.labels = [];
    this.hitstop = 0;
    this.pressure = 0;       // drawn value, eases towards pressureTarget
    this.pressureTarget = 0;
    this.seq = 0;
    this.sceneAlpha = 1;
    this.ballTop = 0;
    this.layer = document.createElement('canvas');
    this.last = performance.now();
    this.alive = true;
    requestAnimationFrame((t) => this.frame(t));
    this.timer = setInterval(() => { if (performance.now() - this.last > 150) this.frame(performance.now(), true); }, 100);
  }
  destroy() { this.alive = false; clearInterval(this.timer); }

  resize(w, h, variant) {
    if (this.w === w && this.h === h && this.pitch) return;
    this.w = w; this.h = h;
    this.ctx = setupCanvas(this.canvas, w, h);
    this.lctx = setupCanvas(this.layer, w, h);
    this.pitch = new Pitch(w, h, { variant });
    this.size = clamp(w * 0.085, 26, 44);
    for (const a of this.actors.values()) { const [x, y] = this.pitch.toPx(a.u, a.v); a.x = x; a.y = y; }
    this.snapBall();
  }

  // Instant placement for a fresh screen. list: [{ key, c, side, u, v }]
  setCast(list, holder) {
    this.actors.clear();
    for (const p of list) {
      const [x, y] = this.pitch.toPx(p.u, p.v);
      this.actors.set(p.key, { c: p.c, side: p.side, u: p.u, v: p.v, x, y, pose: 'idle', facing: p.side === 'you' ? 1 : -1, mv: 0 });
    }
    this.holder = holder || null; this.ballFree = false;
    this.snapBall();
  }
  snapBall() { if (this.holder && this.actors.has(this.holder)) { const [x, y] = this.foot(this.holder); this.ball.x = x; this.ball.y = y; this.ball.h = 0; } }

  px(u, v) { return this.pitch.toPx(u, v); }
  uv(x, y) { return this.pitch.toUV(x, y); }
  at(k) { return this.actors.get(k); }

  tween(dur, fn) { return new Promise((res) => this.tweens.push({ t: 0, dur: Math.max(0.01, dur), fn, res })); }
  wait(s) { return this.tween(s, () => {}); }

  // Where the ball sits when actor k stands at (x, y).
  foot(k, x, y, facing) {
    const a = this.actors.get(k);
    return [(x ?? a.x) + (facing ?? a.facing) * this.size * 0.2, (y ?? a.y) + 1];
  }
  // Where actor k must stand so that the ball at (bx, by) is on its foot.
  standFor(k, bx, by, facing) {
    const a = this.actors.get(k);
    return [bx - (facing ?? a.facing) * this.size * 0.2, by - 1];
  }

  // Timed run to a pixel position.
  // o: { pose, endPose, face, linear, lastPose, lastDur } — lastPose takes over
  // for the final lastDur seconds (a slide that travels into the contact).
  runToPx(k, x, y, dur, o = {}) {
    const a = this.actors.get(k); if (!a) return Promise.resolve();
    const x0 = a.x, y0 = a.y, id = ++this.seq, pose = o.pose || 'run';
    const cut = o.lastPose ? 1 - Math.min(dur, o.lastDur ?? 0.18) / dur : 2;
    a.mv = id;
    if (o.face) a.facing = o.face; else if (Math.abs(x - x0) > 3) a.facing = x > x0 ? 1 : -1;
    a.pose = pose;
    [a.u, a.v] = this.pitch.toUV(x, y);
    return this.tween(dur, (q) => {
      if (a.mv !== id) return;
      const e = o.linear ? q : ease(q);
      a.x = lerp(x0, x, e); a.y = lerp(y0, y, e);
      if (q >= cut && a.pose === pose) a.pose = o.lastPose;
    }).then(() => { if (a.mv === id && (a.pose === pose || a.pose === o.lastPose)) a.pose = o.endPose || 'idle'; });
  }
  runTo(k, u, v, dur, o) {
    const [x, y] = this.pitch.toPx(clamp(u, 0.04, 0.96), clamp(v, 0.02, 0.98));
    return this.runToPx(k, x, y, dur, o);
  }
  // Everybody jogs to a spot in the same time. spots: { key: [u, v] }
  moveAll(spots, dur = 0.5) {
    const runs = [];
    for (const [k, [u, v]] of Object.entries(spots)) {
      const a = this.actors.get(k); if (!a) continue;
      const [x, y] = this.pitch.toPx(clamp(u, 0.04, 0.96), clamp(v, 0.02, 0.98));
      if (Math.hypot(x - a.x, y - a.y) < 2) { a.mv = ++this.seq; if (a.pose === 'run') a.pose = 'idle'; continue; }
      runs.push(this.runToPx(k, x, y, dur));
    }
    return runs.length ? Promise.all(runs) : this.wait(0.01);
  }

  // The ball belongs to k from now on. It rolls onto the foot if it is not there yet.
  hold(k) { this.holder = k; this.ballFree = false; }
  ballTo(x, y, dur, height = 4) {
    this.ballFree = true;
    const x0 = this.ball.x, y0 = this.ball.y;
    return this.tween(dur, (k) => { this.ball.x = lerp(x0, x, k); this.ball.y = lerp(y0, y, k); this.ball.h = Math.sin(k * Math.PI) * height; this.ball.spin += 0.35; });
  }
  pose(k, p, facing) { const a = this.actors.get(k); if (a) { a.pose = p; if (facing) a.facing = facing; } }
  // One label per spot: a new label fades out any label near it.
  label(text, x, y, color = '#fff', life = 1.1) {
    for (const l of this.labels) if (Math.abs(l.x - x) < 90 && Math.abs(l.y - y) < 36) l.t = Math.max(l.t, l.life * 0.88);
    this.labels.push({ text, x, y, color, t: 0, life });
  }
  clearLabels() { for (const l of this.labels) l.t = Math.max(l.t, l.life * 0.88); }
  labelOn(k, text, color, life) { const a = this.actors.get(k); if (a) this.label(text, a.x, a.y - this.size * 1.05, color, life); }

  // ---------------------------------------------------------------- synced moves
  // Each helper computes the meeting point first, then sends both parties there
  // with the same arrival time. They resolve on the contact frame. Challengers
  // come in from the ball's side so the two bodies and the ball stay readable.

  // Facing an actor will have after running to x.
  faceTo(k, x) { const a = this.actors.get(k); return Math.abs(x - a.x) > 3 ? (x > a.x ? 1 : -1) : a.facing; }
  runSecs(k, x, y, min = 0.25, speed = 300) { const a = this.actors.get(k); return Math.max(min, Math.hypot(x - a.x, y - a.y) / speed); }
  // Draw the ball above the sprites for a moment (contacts).
  contact(secs = 0.7) { this.ballTop = secs; }
  // Bystanders step off a contact spot so they do not cover it.
  clearSpot(x, y, r, except = [], dur = 0.3) {
    for (const [k, a] of this.actors) {
      if (except.includes(k)) continue;
      const dx = a.x - x, dy = a.y - y, d = Math.hypot(dx, dy);
      if (d >= r) continue;
      const ux = d > 1 ? dx / d : (a.x < this.w / 2 ? -1 : 1), uy = d > 1 ? dy / d : 0;
      this.runToPx(k, clamp(x + ux * r, 12, this.w - 12), clamp(y + uy * r, 12, this.h - 12), dur);
    }
  }

  // Pass from the holder to `toK`, who runs to (u, v) and meets the ball there.
  async pass(fromK, toK, u, v, o = {}) {
    const [x, y] = this.px(clamp(u, 0.04, 0.96), clamp(v, 0.02, 0.98));
    const face = o.face || this.faceTo(toK, x);
    const [fx, fy] = this.foot(toK, x, y, face);
    const T = clamp(Math.hypot(fx - this.ball.x, fy - this.ball.y) / (o.lofted ? 330 : 400), 0.3, 0.7);
    const R = this.runSecs(toK, x, y, T);
    const run = this.runToPx(toK, x, y, R, { face });
    if (R > T) await this.wait(R - T);
    this.kickPose(fromK);
    o.onKick?.();
    await this.ballTo(fx, fy, T, o.lofted ? 30 : 3);
    await run;
    this.hold(toK);
  }

  // Pass from the holder towards (u, v); defender dK steps into the lane and
  // takes it a body-length or more from the passer. Resolves on the contact frame.
  async intercept(fromK, toK, u, v, dK, o = {}) {
    const S = this.size;
    const [x, y] = this.px(clamp(u, 0.04, 0.96), clamp(v, 0.02, 0.98));
    const face = this.faceTo(toK, x);
    const [fx, fy] = this.foot(toK, x, y, face);
    const bx0 = this.ball.x, by0 = this.ball.y;
    const L = Math.max(1, Math.hypot(fx - bx0, fy - by0));
    const dist = clamp(L * (o.frac ?? 0.6), Math.min(S * 1.3, L * 0.85), L);
    const px = bx0 + (fx - bx0) * dist / L, py = by0 + (fy - by0) * dist / L;
    const T = clamp(L / (o.lofted ? 330 : 400), 0.3, 0.7);
    const Tb = T * dist / L;
    const d = this.actors.get(dK);
    const dFace = px > d.x ? 1 : -1;
    const [sx, sy] = this.standFor(dK, px, py, dFace);
    const Rd = this.runSecs(dK, sx, sy, Tb + 0.12, 320);
    // the receiver sets off but pulls up short of the contact spot
    const r = this.actors.get(toK);
    let [rx, ry] = [x, y];
    if (Math.hypot(rx - px, ry - py) < S * 1.2) {
      const ax = r.x - px, ay = r.y - py, ad = Math.hypot(ax, ay) || 1;
      [rx, ry] = [px + (ax / ad) * S * 1.2, py + (ay / ad) * S * 1.2];
    }
    this.runToPx(toK, rx, ry, Rd + 0.1, { face });
    this.clearSpot(px, py, S * 0.95, [dK, fromK, toK], Math.max(0.2, Rd - 0.05));
    const end = o.lofted ? 'header' : 'tackle';
    const dRun = this.runToPx(dK, sx, sy, Rd, { face: dFace, endPose: end, lastPose: end, lastDur: 0.16 });
    await this.wait(Rd - Tb);
    this.kickPose(fromK);
    o.onKick?.();
    await this.ballTo(px, py, Tb, o.lofted ? 30 * Math.sin((dist / L) * Math.PI) : 3);
    await dRun;
    this.pose(dK, end, dFace);
    this.contact();
    this.hold(dK);
  }

  // The holder dribbles towards (u, v); dK comes in from the ball's side and
  // slides into it. Resolves on the contact frame. Then call pokeAndCollect.
  async tackleRun(carK, u, v, dK, o = {}) {
    const c = this.actors.get(carK);
    const [x, y] = this.px(clamp(u, 0.04, 0.96), clamp(v, 0.02, 0.98));
    const f = o.frac ?? 0.75;
    const mx = lerp(c.x, x, f), my = lerp(c.y, y, f);
    const cFace = this.faceTo(carK, mx);
    const [bx, by] = this.foot(carK, mx, my, cFace);
    const dFace = -cFace;
    const [sx, sy] = this.standFor(dK, bx + cFace * this.size * 0.08, by, dFace);
    const T = Math.max(o.dur ?? 0.42, this.runSecs(dK, sx, sy, 0.3, 330));
    this.clearSpot(bx, by, this.size * 0.95, [carK, dK], T);
    await Promise.all([
      this.runToPx(carK, mx, my, T, { face: cFace, linear: true }),
      this.runToPx(dK, sx, sy, T, { face: dFace, lastPose: 'slide', lastDur: 0.18, endPose: 'slide' }),
    ]);
    this.pose(dK, 'slide', dFace);
    this.pose(carK, 'sad');
    this.contact();
  }
  // After a tackle: the ball squirts loose away from the beaten man, he stumbles
  // back, and the winner gets up and runs onto it.
  async pokeAndCollect(dK, victimK) {
    const d = this.actors.get(dK), v = this.actors.get(victimK);
    const S = this.size;
    const away = v ? (Math.sign(d.x - v.x) || d.facing) : d.facing;
    const lx = clamp(this.ball.x + away * S * 0.3, 14, this.w - 14), ly = clamp(this.ball.y + S * 0.6, 14, this.h - 14);
    const ball = this.ballTo(lx, ly, 0.2, 3);
    if (v) this.runToPx(victimK, clamp(v.x - away * S * 0.4, 12, this.w - 12), v.y - S * 0.1, 0.35, { pose: 'sad', endPose: 'sad' });
    await ball;
    await this.wait(0.12);
    d.pose = 'ready';
    await this.wait(0.12);
    const [sx, sy] = this.standFor(dK, lx, ly, away);
    await this.runToPx(dK, sx, sy, 0.2, { face: away });
    this.hold(dK);
  }
  // The holder beats a challenger: the challenger lunges and ends short of the
  // ball, the holder knocks it past him. Resolves when the holder is clear.
  async beat(carK, dK, u, v) {
    const c = this.actors.get(carK), d = this.actors.get(dK);
    const dFace = c.x > d.x ? 1 : -1;
    const sx = this.ball.x - dFace * this.size * 0.75, sy = this.ball.y - 1;
    const lunge = this.runToPx(dK, sx, sy, 0.3, { face: dFace, lastPose: 'slide', lastDur: 0.16, endPose: 'slide' });
    await this.wait(0.16);
    await this.runTo(carK, u, v, 0.42, { linear: true });
    await lunge;
  }

  // ---------------------------------------------------------------- keeper
  // Feet set first (crouch, small shuffle), then a launch that travels through
  // the air and lands at (x, y) exactly T seconds from now.
  async dive(k, x, y, T, face) {
    const a = this.actors.get(k); if (!a) return;
    const id = ++this.seq; a.mv = id; a.facing = face; a.pose = 'ready';
    [a.u, a.v] = this.pitch.toUV(x, y);
    const L = Math.min(0.26, T * 0.6);
    const x0 = a.x, y0 = a.y, xm = lerp(x0, x, 0.15), ym = lerp(y0, y, 0.15);
    await this.tween(T - L, (q) => { if (a.mv !== id) return; a.x = lerp(x0, xm, ease(q)); a.y = lerp(y0, ym, ease(q)); });
    if (a.mv !== id) return;
    a.pose = 'dive';
    const xs = a.x, ys = a.y, hop = this.size * 0.22;
    await this.tween(L, (q) => { if (a.mv !== id) return; a.x = lerp(xs, x, q); a.y = lerp(ys, y, q) - Math.sin(q * Math.PI) * hop; });
  }
  // Stay down a moment, then up through the crouch.
  async getUp(k, endPose = 'idle') {
    const a = this.actors.get(k); if (!a) return;
    const id = a.mv;
    await this.wait(0.4);
    if (a.mv !== id) return;
    a.pose = 'ready';
    await this.wait(0.15);
    if (a.mv !== id) return;
    a.pose = endPose;
  }

  kickPose(k, pose = 'pass') {
    const a = this.actors.get(k); if (!a) return;
    a.mv = ++this.seq; a.pose = pose;
    const id = a.mv;
    this.wait(0.3).then(() => { if (a.mv === id && a.pose === pose) a.pose = 'idle'; });
  }

  // ---------------------------------------------------------------- covered cut
  // Fade the whole scene out, rearrange while nobody can see, fade back in.
  fadeTo(a, dur) { const a0 = this.sceneAlpha; return this.tween(dur, (k) => { this.sceneAlpha = lerp(a0, a, k); }); }
  async cut(fn) {
    await this.fadeTo(0, 0.28);
    fn();
    await this.wait(0.3);
    await this.fadeTo(1, 0.3);
  }
  // Instant placement. Only for use under cut().
  placeNow(spots) {
    for (const [k, [u, v]] of Object.entries(spots)) {
      const a = this.actors.get(k); if (!a) continue;
      [a.x, a.y] = this.px(clamp(u, 0.04, 0.96), clamp(v, 0.02, 0.98));
      [a.u, a.v] = [u, v];
      a.mv = ++this.seq; a.pose = 'idle'; a.facing = a.side === 'you' ? 1 : -1;
    }
  }
  holdNow(k) { this.holder = k; this.ballFree = false; this.snapBall(); }

  frame(now, fallback = false) {
    if (!this.alive) return;
    // rAF timestamps can be older than the fallback timer's now(): never step backwards
    let dt = clamp((now - this.last) / 1000, 0, fallback ? 0.15 : 0.05);
    this.last = Math.max(this.last, now);
    if (!fallback) requestAnimationFrame((t) => this.frame(t));
    if (!this.ctx) return;
    const t = now / 1000;
    dt *= window.__slow || 1;  // ?jank=1 slow-motion switch
    const real = dt;
    if (this.hitstop > 0) { this.hitstop -= dt; dt *= 0.04; }
    for (const tw of [...this.tweens]) {
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.fn(k);
      if (k >= 1) { this.tweens.splice(this.tweens.indexOf(tw), 1); tw.res(); }
    }
    // held ball follows the foot; capped speed so a change of holder or facing never jumps
    if (!this.ballFree && this.actors.has(this.holder)) {
      const [fx, fy] = this.foot(this.holder);
      const dx = fx - this.ball.x, dy = fy - this.ball.y, d = Math.hypot(dx, dy), step = 1400 * real;
      if (d <= step || !(d > 0)) { this.ball.x = fx; this.ball.y = fy; } else { this.ball.x += (dx / d) * step; this.ball.y += (dy / d) * step; this.ball.spin += 0.3; }
      this.ball.h *= 0.5;
    }
    this.pressure += (this.pressureTarget - this.pressure) * Math.min(1, real * 6);

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    this.pitch.draw(ctx, t, dt);
    // pressure ring around the carrier
    const hk = this.actors.get(this.holder);
    if (hk && !this.ballFree && hk.side === 'you' && this.pressure > 0.02 && this.sceneAlpha > 0.9) {
      const r = this.size * (1.6 - this.pressure * 0.9);
      ctx.save();
      ctx.strokeStyle = `rgba(232,70,58,${0.25 + this.pressure * 0.6})`;
      ctx.lineWidth = 2 + this.pressure * 3;
      ctx.setLineDash([6, 5]); ctx.lineDashOffset = -t * 30;
      ctx.beginPath(); ctx.ellipse(hk.x, hk.y, r, r * 0.45, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    this.under?.(ctx, t);
    // During a covered cut the sprites are drawn to an offscreen layer and the
    // layer is faded as one image (some sprite parts set their own alpha).
    if (this.sceneAlpha >= 1) this.drawSprites(ctx, t);
    else if (this.sceneAlpha > 0.01) {
      const L = this.lctx;
      L.save(); L.setTransform(1, 0, 0, 1, 0, 0); L.clearRect(0, 0, this.layer.width, this.layer.height); L.restore();
      this.drawSprites(L, t);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = this.sceneAlpha; ctx.drawImage(this.layer, 0, 0); ctx.restore();
    }
    this.ballTop = Math.max(0, this.ballTop - real);
    this.pitch.drawFront(ctx, t);
    this.over?.(ctx, t);
    for (const l of [...this.labels]) {
      l.t += real;
      const k = l.t / l.life;
      if (k >= 1) { this.labels.splice(this.labels.indexOf(l), 1); continue; }
      ctx.save();
      ctx.globalAlpha = k < 0.75 ? 1 : (1 - k) / 0.25;
      ctx.font = `${Math.round(clamp(this.size * 0.5, 15, 22))}px "Lilita One", system-ui`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4; ctx.strokeStyle = '#1b1b2f';
      const y = Math.max(18, l.y - Math.min(k * 3, 1) * 16);
      const hw = ctx.measureText(l.text).width / 2 + 6;
      const x = clamp(l.x, hw, this.w - hw);
      ctx.strokeText(l.text, x, y); ctx.fillStyle = l.color; ctx.fillText(l.text, x, y);
      ctx.restore();
    }
  }
  drawSprites(ctx, t) {
    const sorted = [...this.actors.entries()].sort((a, b) => a[1].y - b[1].y);
    const br = this.size * 0.14;
    let ballDrawn = this.ballTop <= 0 ? false : null; // null: draw it last, on top
    for (const [k, a] of sorted) {
      if (ballDrawn === false && this.ball.y < a.y) { drawBall(ctx, this.ball.x, this.ball.y, br, this.ball.spin, this.ball.h); ballDrawn = true; }
      const glow = this.holder === k && !this.ballFree ? (a.side === 'you' ? '#FFD23F' : '#FF6B6B') : null;
      drawPlayer(ctx, a.c, a.x, a.y, { size: this.size, pose: a.pose, t, facing: a.facing, glow, look: a.side === 'you' ? 0.3 : -0.3 });
    }
    if (ballDrawn !== true) drawBall(ctx, this.ball.x, this.ball.y, br, this.ball.spin, this.ball.h);
  }
}
