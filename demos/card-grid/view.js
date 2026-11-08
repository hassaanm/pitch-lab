// Card Grid pitch view: the shared Pitch with a 7×11 grid on top, sprites that
// glide between cells, a ball that sticks to its carrier, tweens, hit-stop and
// floating labels. Game code draws overlays through the `under`/`over` hooks.

import { Pitch, drawPlayer, drawBall, setupCanvas, lerp, ease, clamp } from '../../shared/art.js';
import { byId } from '../../shared/cast.js';
import { COLS, ROWS } from './rules.js';

export class GridView {
  constructor(canvas) {
    this.canvas = canvas;
    this.vis = new Map();
    this.ball = { x: 0, y: 0, h: 0, spin: 0 };
    this.ballFree = false;
    this.holder = null;
    this.tweens = [];
    this.labels = [];
    this.hitstop = 0;
    this.last = performance.now();
    this.under = null; this.over = null;
    this.alive = true;
    requestAnimationFrame((t) => this.frame(t));
    // fallback tick so game flow keeps moving if rAF is throttled (hidden tab)
    this.timer = setInterval(() => { if (performance.now() - this.last > 150) this.frame(performance.now(), true); }, 100);
  }
  destroy() { this.alive = false; clearInterval(this.timer); }

  resize(w, h, variant) {
    this.w = w; this.h = h;
    this.ctx = setupCanvas(this.canvas, w, h);
    this.pitch = new Pitch(w, h, { variant });
    this.cw = this.pitch.pw / COLS; this.ch = this.pitch.ph / ROWS;
    this.size = clamp(Math.min(this.ch * 1.2, this.cw * 0.95), 24, 50);
    for (const v of this.vis.values()) { const [x, y] = this.feet(v.c, v.r); v.x = v.tx = x; v.y = v.ty = y; }
    if (this.units) this.sync(this.units, this.holder, true);
  }

  center(c, r) { return this.pitch.toPx((c + 0.5) / COLS, (r + 0.5) / ROWS); }
  feet(c, r) { const [x, y] = this.center(c, r); return [x, y + this.ch * 0.32]; }
  cellAt(x, y) {
    const [u, v] = this.pitch.toUV(x, y);
    if (u < 0 || u >= 1) return null;
    if (v < 0 && v > -0.09) return [3, -1];
    if (v < 0 || v >= 1) return null;
    return [Math.floor(u * COLS), Math.floor(v * ROWS)];
  }

  // Point sprites at the game's unit list. snap = jump without gliding.
  sync(units, holderUid, snap = false) {
    this.units = units;
    this.holder = holderUid;
    const seen = new Set();
    for (const u of units) {
      seen.add(u.uid);
      let v = this.vis.get(u.uid);
      const [x, y] = this.feet(u.c, u.r);
      if (!v) { v = { x, y, pose: 'idle', facing: u.side === 'you' ? 1 : -1, anim: 0 }; this.vis.set(u.uid, v); }
      v.c = u.c; v.r = u.r; v.tx = x; v.ty = y; v.cid = u.cid; v.side = u.side;
      if (snap) { v.x = x; v.y = y; }
    }
    for (const k of [...this.vis.keys()]) if (!seen.has(k)) this.vis.delete(k);
    if (snap && !this.ballFree) this.stick();
  }

  tween(dur, fn) { return new Promise((res) => this.tweens.push({ t: 0, dur: Math.max(0.01, dur), fn, res })); }
  wait(s) { return this.tween(s, () => {}); }

  // glide a unit to a cell
  moveTo(uid, c, r, dur = 0.32) {
    const v = this.vis.get(uid); if (!v) return Promise.resolve();
    const [x1, y1] = this.feet(c, r); const x0 = v.x, y0 = v.y;
    v.anim++; v.pose = 'run'; if (Math.abs(x1 - x0) > 2) v.facing = x1 > x0 ? 1 : -1;
    v.c = c; v.r = r; v.tx = x1; v.ty = y1;
    return this.tween(dur, (k) => { v.x = lerp(x0, x1, ease(k)); v.y = lerp(y0, y1, ease(k)); })
      .then(() => { v.anim--; v.pose = 'idle'; });
  }

  stick() {
    const v = this.vis.get(this.holder);
    if (!v) return;
    this.ball.x = v.x + v.facing * this.size * 0.2; this.ball.y = v.y + 1; this.ball.h = 0;
  }

  // ball flight to a point; returns when it lands
  ballTo(x, y, dur, height = 4) {
    this.ballFree = true;
    const x0 = this.ball.x, y0 = this.ball.y;
    return this.tween(dur, (k) => { this.ball.x = lerp(x0, x, k); this.ball.y = lerp(y0, y, k); this.ball.h = Math.sin(k * Math.PI) * height; this.ball.spin += 0.35; });
  }
  async passTo(fromUid, c, r, toUid, lofted = false) {
    const fv = this.vis.get(fromUid);
    if (fv) { fv.pose = 'pass'; setTimeout(() => { if (fv.pose === 'pass') fv.pose = 'idle'; }, 300); }
    const [x, y] = this.feet(c, r);
    const d = Math.hypot(x - this.ball.x, y - this.ball.y);
    await this.ballTo(x + 4, y + 1, clamp(d / 420, 0.22, 0.6), lofted ? 34 : 4);
    this.give(toUid);
  }
  give(uid) { this.holder = uid; this.ballFree = false; this.stick(); }

  pose(uid, pose, facing) { const v = this.vis.get(uid); if (v) { v.pose = pose; if (facing) v.facing = facing; } }
  label(text, x, y, color = '#fff', life = 1.1) { this.labels.push({ text, x, y, color, t: 0, life }); }
  labelAt(c, r, text, color, life) { const [x, y] = this.center(c, r); this.label(text, x, y - this.size * 0.6, color, life); }

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
    for (const v of this.vis.values()) {
      if (v.anim) continue;
      const kk = Math.min(1, dt * 12);
      v.x += (v.tx - v.x) * kk; v.y += (v.ty - v.y) * kk;
    }
    if (!this.ballFree) this.stick();

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    this.pitch.draw(ctx, t, dt);
    this.under?.(ctx, t);
    const sorted = [...this.vis.entries()].sort((a, b) => a[1].y - b[1].y);
    let ballDrawn = false;
    const br = this.size * 0.14;
    for (const [uid, v] of sorted) {
      if (!ballDrawn && this.ball.y < v.y) { drawBall(ctx, this.ball.x, this.ball.y, br, this.ball.spin, this.ball.h); ballDrawn = true; }
      const glow = this.holder === uid && !this.ballFree ? (v.side === 'you' ? '#FFD23F' : '#FF6B6B') : this.glowFor?.(uid);
      drawPlayer(ctx, byId[v.cid], v.x, v.y, { size: this.size, pose: v.pose, t, facing: v.facing, glow, look: v.side === 'you' ? 0.3 : -0.3, alpha: this.alphaFor?.(uid) ?? 1 });
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
      const x = clamp(l.x, 50, this.w - 50);
      ctx.strokeText(l.text, x, y); ctx.fillStyle = l.color; ctx.fillText(l.text, x, y);
      ctx.restore();
    }
  }
}
