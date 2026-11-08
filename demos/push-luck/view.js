// Push Your Luck pitch view: free-moving sprites on the shared Pitch. The game
// sets target spots (u, v); sprites glide there. Ball sticks to its carrier.
// Tweens, hit-stop, floating labels, and a timer fallback so the game flow
// never stalls if requestAnimationFrame is throttled.

import { Pitch, drawPlayer, drawBall, setupCanvas, lerp, ease, clamp } from '../../shared/art.js';

export class PossView {
  constructor(canvas) {
    this.canvas = canvas;
    this.actors = new Map(); // key -> { c, side, x, y, tx, ty, pose, facing, anim }
    this.ball = { x: 0, y: 0, h: 0, spin: 0 };
    this.ballFree = false;
    this.holder = null;
    this.tweens = [];
    this.labels = [];
    this.hitstop = 0;
    this.pressure = 0;
    this.last = performance.now();
    this.alive = true;
    requestAnimationFrame((t) => this.frame(t));
    this.timer = setInterval(() => { if (performance.now() - this.last > 150) this.frame(performance.now(), true); }, 100);
  }
  destroy() { this.alive = false; clearInterval(this.timer); }

  resize(w, h, variant) {
    this.w = w; this.h = h;
    this.ctx = setupCanvas(this.canvas, w, h);
    this.pitch = new Pitch(w, h, { variant });
    this.size = clamp(w * 0.085, 26, 44);
    for (const a of this.actors.values()) { const [x, y] = this.pitch.toPx(a.u, a.v); a.x = a.tx = x; a.y = a.ty = y; }
    this.stick();
  }
  setVariant(v) { this.pitch.setVariant(v); }

  // Add / replace the cast. list: [{ key, c, side, u, v }]
  setCast(list) {
    this.actors.clear();
    for (const p of list) {
      const [x, y] = this.pitch.toPx(p.u, p.v);
      this.actors.set(p.key, { c: p.c, side: p.side, u: p.u, v: p.v, x, y, tx: x, ty: y, pose: 'idle', facing: p.side === 'you' ? 1 : -1, anim: 0 });
    }
  }
  // Glide actors to spots: { key: [u, v] }
  place(spots, snap = false) {
    for (const [k, [u, v]] of Object.entries(spots)) {
      const a = this.actors.get(k); if (!a) continue;
      a.u = clamp(u, 0.05, 0.95); a.v = clamp(v, 0.03, 0.97);
      const [x, y] = this.pitch.toPx(a.u, a.v);
      a.tx = x; a.ty = y;
      if (snap) { a.x = x; a.y = y; }
    }
    if (snap) this.stick();
  }
  px(u, v) { return this.pitch.toPx(u, v); }

  tween(dur, fn) { return new Promise((res) => this.tweens.push({ t: 0, dur: Math.max(0.01, dur), fn, res })); }
  wait(s) { return this.tween(s, () => {}); }

  runTo(k, u, v, dur = 0.4) {
    const a = this.actors.get(k); if (!a) return Promise.resolve();
    a.u = clamp(u, 0.05, 0.95); a.v = clamp(v, 0.03, 0.97);
    const [x1, y1] = this.pitch.toPx(a.u, a.v); const x0 = a.x, y0 = a.y;
    a.anim++; a.pose = 'run'; if (Math.abs(x1 - x0) > 2) a.facing = x1 > x0 ? 1 : -1;
    a.tx = x1; a.ty = y1;
    return this.tween(dur, (k2) => { a.x = lerp(x0, x1, ease(k2)); a.y = lerp(y0, y1, ease(k2)); }).then(() => { a.anim--; a.pose = 'idle'; });
  }

  stick() {
    const a = this.actors.get(this.holder); if (!a) return;
    this.ball.x = a.x + a.facing * this.size * 0.2; this.ball.y = a.y + 1; this.ball.h = 0;
  }
  give(k) { this.holder = k; this.ballFree = false; this.stick(); }
  ballTo(x, y, dur, height = 4) {
    this.ballFree = true;
    const x0 = this.ball.x, y0 = this.ball.y;
    return this.tween(dur, (k) => { this.ball.x = lerp(x0, x, k); this.ball.y = lerp(y0, y, k); this.ball.h = Math.sin(k * Math.PI) * height; this.ball.spin += 0.35; });
  }
  // ball to an actor's current target spot
  async passTo(fromK, toK, lofted = false) {
    const f = this.actors.get(fromK), t = this.actors.get(toK);
    if (f) { f.pose = 'pass'; setTimeout(() => { if (f.pose === 'pass') f.pose = 'idle'; }, 300); }
    const d = Math.hypot(t.tx - this.ball.x, t.ty - this.ball.y);
    await this.ballTo(t.tx + 4, t.ty + 1, clamp(d / 400, 0.25, 0.6), lofted ? 30 : 4);
    this.give(toK);
  }
  pose(k, p, facing) { const a = this.actors.get(k); if (a) { a.pose = p; if (facing) a.facing = facing; } }
  label(text, x, y, color = '#fff', life = 1.1) { this.labels.push({ text, x, y, color, t: 0, life }); }
  labelOn(k, text, color, life) { const a = this.actors.get(k); if (a) this.label(text, a.x, a.y - this.size * 1.05, color, life); }

  frame(now, fallback = false) {
    if (!this.alive) return;
    let dt = Math.min(fallback ? 0.15 : 0.05, (now - this.last) / 1000);
    this.last = now;
    if (!fallback) requestAnimationFrame((t) => this.frame(t));
    if (!this.ctx) return;
    const t = now / 1000;
    if (this.hitstop > 0) { this.hitstop -= dt; dt *= 0.04; }
    for (const tw of [...this.tweens]) {
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.fn(k);
      if (k >= 1) { this.tweens.splice(this.tweens.indexOf(tw), 1); tw.res(); }
    }
    for (const a of this.actors.values()) {
      if (a.anim) continue;
      const dx = a.tx - a.x, dy = a.ty - a.y, d = Math.hypot(dx, dy);
      const sp = (60 + a.c.stats.pace * 8) * dt;
      if (d > 1.2) { a.x += (dx / d) * Math.min(d, sp); a.y += (dy / d) * Math.min(d, sp); if (a.pose === 'idle' || a.pose === 'run') a.pose = d > 3 ? 'run' : 'idle'; if (Math.abs(dx) > 2) a.facing = dx > 0 ? 1 : -1; }
      else if (a.pose === 'run') a.pose = 'idle';
    }
    if (!this.ballFree) this.stick();

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    this.pitch.draw(ctx, t, dt);
    // pressure ring around the carrier
    const hk = this.actors.get(this.holder);
    if (hk && !this.ballFree && this.pressure > 0.02) {
      const r = this.size * (1.6 - this.pressure * 0.9);
      ctx.save();
      ctx.strokeStyle = `rgba(232,70,58,${0.25 + this.pressure * 0.6})`;
      ctx.lineWidth = 2 + this.pressure * 3;
      ctx.setLineDash([6, 5]); ctx.lineDashOffset = -t * 30;
      ctx.beginPath(); ctx.ellipse(hk.x, hk.y, r, r * 0.45, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    this.under?.(ctx, t);
    const sorted = [...this.actors.entries()].sort((a, b) => a[1].y - b[1].y);
    let ballDrawn = false;
    const br = this.size * 0.14;
    for (const [k, a] of sorted) {
      if (!ballDrawn && this.ball.y < a.y) { drawBall(ctx, this.ball.x, this.ball.y, br, this.ball.spin, this.ball.h); ballDrawn = true; }
      const glow = this.holder === k && !this.ballFree ? (a.side === 'you' ? '#FFD23F' : '#FF6B6B') : this.glowFor?.(k);
      drawPlayer(ctx, a.c, a.x, a.y, { size: this.size, pose: a.pose, t, facing: a.facing, glow, look: a.side === 'you' ? 0.3 : -0.3 });
    }
    if (!ballDrawn) drawBall(ctx, this.ball.x, this.ball.y, br, this.ball.spin, this.ball.h);
    this.pitch.drawFront(ctx, t);
    this.over?.(ctx, t);
    for (const l of [...this.labels]) {
      l.t += dt;
      const k = l.t / l.life;
      if (k >= 1) { this.labels.splice(this.labels.indexOf(l), 1); continue; }
      ctx.save();
      ctx.globalAlpha = k < 0.75 ? 1 : (1 - k) / 0.25;
      ctx.font = `${Math.round(clamp(this.size * 0.5, 15, 22))}px "Lilita One", system-ui`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4; ctx.strokeStyle = '#1b1b2f';
      const y = l.y - Math.min(k * 3, 1) * 16;
      const x = clamp(l.x, 60, this.w - 60);
      ctx.strokeText(l.text, x, y); ctx.fillStyle = l.color; ctx.fillText(l.text, x, y);
      ctx.restore();
    }
  }
}
