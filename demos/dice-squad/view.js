// Dice Squad pitch view: a small vertical pitch with your attackers, the
// red defenders standing in each zone (the "walls"), the ball, and labels.
import { Pitch, drawPlayer, drawBall, setupCanvas, lerp, ease, clamp } from '../../shared/art.js';

// Zone bands (v = 0 is their goal). Index: 0 Defence, 1 Midfield, 2 Attack, 3 Box.
export const ZONE_V = [0.82, 0.57, 0.32, 0.1];
export const ZONE_EDGE = [[0.69, 1], [0.44, 0.69], [0.17, 0.44], [0, 0.17]];

export class DiceView {
  constructor(canvas) {
    this.canvas = canvas;
    this.actors = [];
    this.ball = { x: 0, y: 0, h: 0, spin: 0 };
    this.tweens = [];
    this.labels = [];
    this.zone = 0;
    this.mode = 'attack';
    this.carrier = null;
    this.last = performance.now();
    this.running = true;
    requestAnimationFrame((t) => this.frame(t));
  }
  resize(w, h, variant) {
    this.w = w; this.h = h;
    this.ctx = setupCanvas(this.canvas, w, h);
    this.pitch = new Pitch(w, h, { variant, crowd: true });
    this.size = clamp(w * 0.075, 24, 40);
    for (const a of this.actors) { [a.x, a.y] = this.pitch.toPx(a.u, a.v); }
  }
  // you: [{c, key}], opp: [{c, zone, du}]
  setTeams(you, opp) {
    const mk = (o, side) => ({ ...o, side, u: 0.5, v: 0.5, x: 0, y: 0, pose: 'idle', facing: 1, alpha: 1, beaten: false });
    this.actors = [...you.map((o) => mk(o, 'you')), ...opp.map((o) => mk(o, 'opp'))];
    this.layout(true);
  }
  find(key) { return this.actors.find((a) => a.key === key); }

  // Formation targets around the ball zone.
  layout(snap = false) {
    const z = this.zone;
    const bv = this.mode === 'attack' ? ZONE_V[z] : (this.threatV ?? 0.55);
    const yourShape = this.mode === 'attack'
      ? { wak: [0.5, 0.95], tomo: [0.32, bv + 0.2], lupe: [0.68, bv + 0.12], kenji: [0.5, bv + 0.04], pip: [0.2, bv - 0.06], rio: [0.62, bv - 0.1] }
      : { wak: [0.5, 0.95], tomo: [0.4, bv + 0.1], lupe: [0.65, bv + 0.06], kenji: [0.5, bv - 0.04], pip: [0.25, bv + 0.02], rio: [0.7, bv - 0.12] };
    for (const a of this.actors) {
      let u, v;
      if (a.side === 'you') [u, v] = yourShape[a.key] || [0.5, 0.5];
      else if (a.c.pos === 'GK') [u, v] = [0.5, 0.04];
      else if (this.mode === 'defend' && a.key === this.threatKey) [u, v] = [this.threatU ?? 0.5, bv];
      else { u = a.du; v = ZONE_V[a.zone] - (a.zone === 3 ? -0.02 : 0.02); if (this.mode === 'defend') v -= 0.08; }
      a.tu = clamp(u, 0.06, 0.94); a.tv = clamp(v, 0.03, 0.97);
      if (snap) { a.u = a.tu; a.v = a.tv; }
    }
    if (snap && this.pitch) for (const a of this.actors) [a.x, a.y] = this.pitch.toPx(a.u, a.v);
  }
  setZone(z, mode = 'attack') { this.zone = z; this.mode = mode; for (const a of this.actors) a.beaten = a.side === 'opp' && a.c.pos !== 'GK' && mode === 'attack' && a.zone < z; this.layout(); }

  tween(dur, fn) { return new Promise((resolve) => this.tweens.push({ t: 0, dur: Math.max(0.01, dur), fn, resolve })); }
  wait(s) { return this.tween(s, () => {}); }
  label(text, x, y, color = '#fff', life = 1.1, big = false) { this.labels.push({ text, x, y, color, t: 0, life, big }); }

  give(a) { this.carrier = a; }
  async passTo(a, dur = 0.35, lofted = false) {
    const from = this.carrier;
    if (from) from.pose = 'pass';
    this.carrier = null;
    const x0 = this.ball.x, y0 = this.ball.y;
    await this.tween(dur, (k) => {
      this.ball.x = lerp(x0, a.x + this.size * 0.18, ease(k)); this.ball.y = lerp(y0, a.y + 1, ease(k));
      this.ball.h = Math.sin(k * Math.PI) * (lofted ? 24 : 3); this.ball.spin += 0.3;
    });
    if (from) from.pose = 'idle';
    this.carrier = a;
  }
  // Ball into a goal (top = theirs). result: goal | save | miss
  async shotAt(top, result) {
    const shooter = this.carrier; if (shooter) shooter.pose = 'kick';
    this.carrier = null;
    const [gx, gy] = this.pitch.goalMouth(top);
    const gk = this.actors.find((a) => a.c.pos === 'GK' && (top ? a.side === 'opp' : a.side === 'you'));
    const aim = (Math.random() < 0.5 ? -1 : 1) * (0.18 + Math.random() * 0.2) * this.pitch.goalW;
    const tx = gx + (result === 'miss' ? aim * 2.6 : aim), ty = gy + (top ? -10 : 10);
    const x0 = this.ball.x, y0 = this.ball.y, gx0 = gk ? gk.x : gx;
    const sx = result === 'save' ? lerp(gx0, tx, 0.7) : tx, sy = result === 'save' ? gy + (top ? 8 : -8) : ty;
    if (gk) { gk.lock = true; gk.pose = 'ready'; }
    await this.tween(0.42, (k) => {
      this.ball.x = lerp(x0, sx, k); this.ball.y = lerp(y0, sy, k); this.ball.h = Math.sin(k * Math.PI) * 10; this.ball.spin += 0.6;
      if (gk && k > 0.3) { gk.pose = 'dive'; gk.facing = Math.sign(tx - gx0) || 1; gk.x = gx0 + Math.sign(tx - gx0) * this.pitch.goalW * 0.3 * ease((k - 0.3) / 0.7); }
    });
    if (shooter) shooter.pose = 'idle';
    if (result === 'goal') { this.pitch.goal(top); this.hitstop = 0.25; }
    await this.wait(result === 'goal' ? 1.0 : 0.6);
    if (gk) { gk.lock = false; gk.pose = 'idle'; }
  }
  celebrate(side, on = true) { for (const a of this.actors) a.pose = on ? (a.side === side && a.c.pos !== 'GK' ? 'celebrate' : (a.side !== side ? 'sad' : 'idle')) : 'idle'; this.posesLocked = on; }

  frame(now) {
    if (!this.running) return;
    let dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.ctx) { requestAnimationFrame((t) => this.frame(t)); return; }
    if (this.hitstop > 0) { this.hitstop -= dt; dt *= 0.08; }
    const t = now / 1000;
    for (const tw of [...this.tweens]) {
      tw.t += dt; const k = Math.min(1, tw.t / tw.dur); tw.fn(k);
      if (k >= 1) { this.tweens.splice(this.tweens.indexOf(tw), 1); tw.resolve(); }
    }
    for (const a of this.actors) {
      if (a.lock) continue;
      const [tx, ty] = this.pitch.toPx(a.tu, a.tv);
      const dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy);
      const sp = (60 + (a.c.stats?.pace || 5) * 8) * dt;
      if (d > 1.5) { a.x += (dx / d) * Math.min(d, sp); a.y += (dy / d) * Math.min(d, sp); if (!this.posesLocked && a.pose !== 'pass' && a.pose !== 'kick') a.pose = d > 4 ? 'run' : 'idle'; if (Math.abs(dx) > 2) a.facing = dx > 0 ? 1 : -1; }
      else if (a.pose === 'run') a.pose = 'idle';
      [a.u, a.v] = this.pitch.toUV(a.x, a.y);
      a.alpha += ((a.beaten ? 0.35 : 1) - a.alpha) * Math.min(1, dt * 6);
    }
    if (this.carrier) { this.ball.x = this.carrier.x + this.carrier.facing * this.size * 0.18; this.ball.y = this.carrier.y + 1; this.ball.h = 0; }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    this.pitch.draw(ctx, t, dt);
    // zone bands
    const zs = this.mode === 'attack' ? this.zone : null;
    ZONE_EDGE.forEach(([v0, v1], i) => {
      const [, y0] = this.pitch.toPx(0, v0), [, y1] = this.pitch.toPx(0, v1);
      if (i === zs) {
        ctx.fillStyle = `rgba(255,210,63,${0.13 + 0.05 * Math.sin(t * 4)})`;
        ctx.fillRect(this.pitch.x0, y0, this.pitch.pw, y1 - y0);
      }
      if (i > 0) { ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.moveTo(this.pitch.x0, y1); ctx.lineTo(this.pitch.x1, y1); ctx.stroke(); ctx.setLineDash([]); }
    });
    const sorted = [...this.actors].sort((a, b) => a.y - b.y);
    let ballDrawn = false;
    for (const a of sorted) {
      if (!ballDrawn && this.ball.y < a.y) { drawBall(ctx, this.ball.x, this.ball.y, this.size * 0.14, this.ball.spin, this.ball.h); ballDrawn = true; }
      const glow = this.carrier === a ? (a.side === 'you' ? '#FFD23F' : '#FF6B6B') : (a.glow || null);
      drawPlayer(ctx, a.c, a.x, a.y, { size: this.size, pose: a.pose, t, facing: a.facing, glow, alpha: a.alpha, look: a.side === 'you' ? 0.3 : -0.3 });
    }
    if (!ballDrawn) drawBall(ctx, this.ball.x, this.ball.y, this.size * 0.14, this.ball.spin, this.ball.h);
    this.pitch.drawFront(ctx, t);
    for (const l of [...this.labels]) {
      l.t += dt; const k = l.t / l.life;
      if (k >= 1) { this.labels.splice(this.labels.indexOf(l), 1); continue; }
      ctx.save();
      ctx.globalAlpha = k < 0.8 ? 1 : (1 - k) / 0.2;
      ctx.font = `${Math.round(this.size * (l.big ? 0.75 : 0.48))}px "Lilita One", system-ui`;
      ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = '#1b1b2f';
      const y = l.y - k * 16;
      ctx.strokeText(l.text, l.x, y); ctx.fillStyle = l.color; ctx.fillText(l.text, l.x, y);
      ctx.restore();
    }
    requestAnimationFrame((tt) => this.frame(tt));
  }
}
