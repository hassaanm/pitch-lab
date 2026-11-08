// Touchline pitch view: 7v7 sprites that hold a team shape around the ball,
// plus animated beats (pass, press, shot, save, goal) driven by sim.js scripts.

import { Pitch, drawPlayer, drawBall, setupCanvas, lerp, ease, clamp } from '../../shared/art.js';
import { sfx } from '../../shared/sfx.js';

// 3-2-1 for 7-a-side. You attack UP (v=0 is the opponent goal).
const SHAPE = [[0.5, 0.95], [0.2, 0.76], [0.5, 0.8], [0.8, 0.76], [0.33, 0.58], [0.67, 0.58], [0.5, 0.42]];

export class MatchView {
  constructor(canvas) {
    this.canvas = canvas;
    this.speed = 1;
    this.actors = [];
    this.ball = { x: 0, y: 0, h: 0, spin: 0 };
    this.tweens = [];
    this.owner = null;
    this.carrier = null;
    this.ballUV = [0.5, 0.5];
    this.labels = [];
    this.last = performance.now();
    this.running = true;
    this.hitstop = 0;
    requestAnimationFrame((t) => this.frame(t));
  }

  resize(w, h, variant) {
    this.w = w; this.h = h;
    this.ctx = setupCanvas(this.canvas, w, h);
    this.pitch = new Pitch(w, h, { variant });
    this.size = clamp(w * 0.085, 28, 46);
    for (const a of this.actors) { const [x, y] = this.pitch.toPx(a.u, a.v); a.x = x; a.y = y; }
    const [bx, by] = this.pitch.toPx(...this.ballUV);
    this.ball.x = bx; this.ball.y = by;
  }
  setVariant(v) { this.pitch.setVariant(v); }

  setTeams(you, opp) {
    const mk = (c, i, side) => {
      const [u, v] = side === 'you' ? SHAPE[i] : [1 - SHAPE[i][0], 1 - SHAPE[i][1]];
      const [x, y] = this.pitch.toPx(u, v);
      return { c, side, i, u, v, x, y, tx: x, ty: y, pose: 'idle', facing: side === 'you' ? 1 : -1, override: 0 };
    };
    this.actors = [...you.map((c, i) => mk(c, i, 'you')), ...opp.map((c, i) => mk(c, i, 'opp'))];
    this.kickoff();
  }

  kickoff() {
    this.ballUV = [0.5, 0.5];
    const [x, y] = this.pitch.toPx(0.5, 0.5);
    Object.assign(this.ball, { x, y, h: 0 });
    this.carrier = null;
    for (const a of this.actors) { a.pose = 'idle'; a.override = 0; }
  }

  team(side) { return this.actors.filter((a) => a.side === side); }
  find(c, side) { return this.actors.find((a) => a.c.id === c.id && a.side === side); }
  byPos(side, pos) { const t = this.team(side).filter((a) => a.c.pos === pos); return t[(Math.random() * t.length) | 0]; }
  nearest(side, x, y, exclude) {
    let best = null, bd = 1e9;
    for (const a of this.team(side)) { if (a === exclude || a.c.pos === 'GK') continue; const d = Math.hypot(a.x - x, a.y - y); if (d < bd) { bd = d; best = a; } }
    return best;
  }

  // ---- team shape: everyone drifts to a spot relative to the ball
  shapeTargets() {
    const [bu, bv] = this.pitch.toUV(this.ball.x, this.ball.y);
    for (const a of this.actors) {
      if (a.override > 0) continue;
      const base = a.side === 'you' ? SHAPE[a.i] : [1 - SHAPE[a.i][0], 1 - SHAPE[a.i][1]];
      let u = base[0], v = base[1];
      if (a.c.pos === 'GK') {
        u = 0.5 + (bu - 0.5) * 0.25;
      } else {
        const attacking = this.owner === a.side;
        const push = attacking ? (a.side === 'you' ? -0.1 : 0.1) : (a.side === 'you' ? 0.05 : -0.05);
        v = base[1] + (bv - 0.5) * 0.55 + push;
        u = base[0] + (bu - 0.5) * 0.35;
        u += Math.sin(performance.now() / 1300 + a.i * 2 + (a.side === 'you' ? 0 : 1)) * 0.02;
      }
      const [x, y] = this.pitch.toPx(clamp(u, 0.06, 0.94), clamp(v, 0.04, 0.96));
      a.tx = x; a.ty = y;
    }
  }

  // ---- tweening
  tween(dur, fn) {
    return new Promise((resolve) => this.tweens.push({ t: 0, dur: Math.max(0.01, dur), fn, resolve }));
  }
  wait(s) { return this.tween(s, () => {}); }

  runTo(a, x, y, dur = 0.5) {
    const x0 = a.x, y0 = a.y;
    a.override = 1;
    a.pose = 'run';
    a.facing = x >= x0 ? 1 : -1;
    return this.tween(dur, (k) => { a.x = lerp(x0, x, ease(k)); a.y = lerp(y0, y, ease(k)); if (this.carrier === a) this.stickBall(); })
      .then(() => { a.pose = 'idle'; });
  }
  release(...as) { for (const a of as) if (a) a.override = 0; }

  stickBall() {
    const a = this.carrier; if (!a) return;
    this.ball.x = a.x + a.facing * this.size * 0.18; this.ball.y = a.y + 1; this.ball.h = 0;
  }

  give(a) { this.carrier = a; this.owner = a.side; this.stickBall(); }

  pass(from, to, dur = 0.45, lofted = false) {
    from.pose = 'pass'; sfx.pass();
    this.carrier = null;
    const x0 = this.ball.x, y0 = this.ball.y;
    return this.tween(dur, (k) => {
      const tx = to.x + to.facing * this.size * 0.18, ty = to.y + 1;
      this.ball.x = lerp(x0, tx, k); this.ball.y = lerp(y0, ty, k);
      this.ball.h = lofted ? Math.sin(k * Math.PI) * 26 : Math.sin(k * Math.PI) * 3;
      this.ball.spin += 0.3;
    }).then(() => { from.pose = 'idle'; this.give(to); });
  }

  ballTo(x, y, dur, height = 0) {
    this.carrier = null;
    const x0 = this.ball.x, y0 = this.ball.y;
    return this.tween(dur, (k) => {
      this.ball.x = lerp(x0, x, k); this.ball.y = lerp(y0, y, k);
      this.ball.h = Math.sin(k * Math.PI) * height; this.ball.spin += 0.4;
    });
  }

  label(text, x, y, color = '#fff', life = 1.1) { this.labels.push({ text, x, y, color, t: 0, life }); }

  // ---- beats (high level)
  async build(side) {
    const df = this.byPos(side, 'DF');
    if (!this.carrier || this.carrier.side !== side) this.give(df);
    const mf = this.byPos(side, 'MF');
    await this.wait(0.15);
    if (this.carrier !== mf) await this.pass(this.carrier, mf, 0.45);
    const dir = side === 'you' ? -1 : 1;
    await this.runTo(mf, mf.x + (Math.random() - 0.5) * 30, mf.y + dir * this.h * 0.06, 0.45);
    this.release(mf);
  }

  async press(side) {
    const target = this.carrier;
    if (!target) return;
    const presser = this.nearest(side, target.x, target.y);
    this.label('PRESSED!', target.x, target.y - this.size, '#FF8A3D');
    await this.runTo(presser, target.x - presser.facing * 6, target.y + 4, 0.35);
    presser.pose = 'slide';
    target.pose = 'sad';
    sfx.thud();
    this.hitstop = 0.12;
    await this.wait(0.25);
    this.give(presser);
    presser.pose = 'run';
    target.pose = 'idle';
    this.release(presser);
  }

  async progress(side) {
    const fw = this.byPos(side, 'FW') || this.byPos(side, 'MF');
    const dir = side === 'you' ? -1 : 1;
    const [x, y] = this.pitch.toPx(0.3 + Math.random() * 0.4, side === 'you' ? 0.22 : 0.78);
    const run = this.runTo(fw, x, y, 0.55);
    if (this.carrier && this.carrier !== fw) await this.pass(this.carrier, fw, 0.5, Math.random() < 0.4);
    await run;
    this.give(fw);
    this.release(fw);
    void dir;
  }

  async skill() {
    const a = this.carrier; if (!a) return;
    this.label('✨ SKILL!', a.x, a.y - this.size, '#CE93D8');
    sfx.whoosh();
    const d = a.side === 'you' ? -1 : 1;
    await this.runTo(a, a.x + 18, a.y + d * 14, 0.2);
    await this.runTo(a, a.x - 22, a.y + d * 18, 0.22);
    this.release(a);
  }

  async blocked(side) {
    const target = this.carrier; if (!target) return;
    const d = this.nearest(side, target.x, target.y);
    await this.runTo(d, target.x + 5, target.y - 3, 0.3);
    d.pose = 'tackle'; sfx.thud(); this.hitstop = 0.08;
    this.label('BLOCKED', target.x, target.y - this.size, '#9BE7FF');
    await this.wait(0.2);
    this.give(d);
    this.release(d);
  }

  async counter(side) {
    const fw = this.byPos(side, 'FW');
    const [x, y] = this.pitch.toPx(0.5 + (Math.random() - 0.5) * 0.3, side === 'you' ? 0.38 : 0.62);
    this.label('COUNTER!', this.ball.x, this.ball.y - this.size, '#FFD23F');
    sfx.whoosh();
    const run = this.runTo(fw, x, y, 0.5);
    if (this.carrier !== fw) await this.pass(this.carrier, fw, 0.55, true);
    await run;
    const [x2, y2] = this.pitch.toPx(0.45 + Math.random() * 0.1, side === 'you' ? 0.2 : 0.8);
    await this.runTo(fw, x2, y2, 0.55);
    this.release(fw);
  }

  async setShooter(c, side) {
    const a = this.find(c, side) || this.byPos(side, 'FW');
    const [x, y] = this.pitch.toPx(0.35 + Math.random() * 0.3, side === 'you' ? 0.17 : 0.83);
    const run = this.runTo(a, x, y, 0.45);
    if (this.carrier && this.carrier !== a) await this.pass(this.carrier, a, 0.4);
    await run;
    this.give(a);
    return a;
  }

  async corner(side) {
    const top = side === 'you';
    const [cx, cy] = this.pitch.toPx(Math.random() < 0.5 ? 0.01 : 0.99, top ? 0.01 : 0.99);
    Object.assign(this.ball, { x: cx, y: cy, h: 0 }); this.carrier = null;
    this.label('CORNER', cx, cy + (top ? 20 : -20), '#fff');
    await this.wait(0.35);
  }

  // result: 'goal' | 'save' | 'miss'
  async shot(shooterActor, side, result, o = {}) {
    const a = shooterActor;
    const top = side === 'you';
    const gk = this.team(side === 'you' ? 'opp' : 'you').find((p) => p.c.pos === 'GK');
    const [gx, gy] = this.pitch.goalMouth(top);
    const gw = this.pitch.goalW;
    const aim = (Math.random() < 0.5 ? -1 : 1) * (0.2 + Math.random() * 0.25);
    let tx = gx + aim * gw, ty = gy + (top ? -this.pitch.netDepth * 0.6 : this.pitch.netDepth * 0.6);
    if (result === 'miss') { tx = gx + Math.sign(aim) * gw * (0.62 + Math.random() * 0.3); ty = gy + (top ? -12 : 12); }
    a.pose = o.header ? 'header' : 'kick';
    sfx.kick();
    this.carrier = null;
    const diveDir = result === 'save' ? Math.sign(tx - gk.x) : (Math.random() < 0.5 ? -1 : 1);
    gk.override = 1; gk.pose = 'ready';
    const gx0 = gk.x, gy0 = gk.y;
    const x0 = this.ball.x, y0 = this.ball.y;
    let saveX = tx, saveY = ty;
    if (result === 'save') { saveX = lerp(gx0, tx, 0.75); saveY = gy + (top ? 8 : -8); }
    const dur = 0.45;
    await this.tween(dur, (k) => {
      const ex = result === 'save' ? saveX : tx, ey = result === 'save' ? saveY : ty;
      this.ball.x = lerp(x0, ex, k); this.ball.y = lerp(y0, ey, k);
      this.ball.h = Math.sin(k * Math.PI) * (result === 'miss' ? 18 : 8); this.ball.spin += 0.6;
      if (k > 0.25) { gk.pose = 'dive'; gk.facing = diveDir; gk.x = gx0 + diveDir * gw * 0.32 * ease((k - 0.25) / 0.75); }
    });
    a.pose = 'idle';
    if (result === 'goal') {
      this.pitch.goal(top);
      sfx.goal();
      this.hitstop = 0.25;
      for (const p of this.team(side)) { if (p.c.pos !== 'GK') { p.pose = 'celebrate'; p.override = 1; } }
      for (const p of this.team(side === 'you' ? 'opp' : 'you')) { p.pose = 'sad'; p.override = 1; }
      await this.wait(1.6);
    } else if (result === 'save') {
      sfx.save();
      this.label('SAVED!', gk.x, gk.y - this.size, '#9BE7FF');
      await this.ballTo(saveX + diveDir * 30, saveY + (top ? 30 : -30), 0.35, 10);
      await this.wait(0.4);
    } else {
      sfx.ooh();
      this.label('WIDE!', tx, ty + (top ? 26 : -26), '#fff');
      await this.wait(0.6);
    }
    gk.pose = 'idle';
    gk.x = gx0; gk.y = gy0;
    for (const p of this.actors) { if (p.pose === 'celebrate' || p.pose === 'sad') p.pose = 'idle'; p.override = 0; }
    if (result === 'goal') this.kickoff();
    else { this.give(gk); this.owner = gk.side; }
  }

  // ---- render loop
  frame(now) {
    if (!this.running) return;
    let dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.ctx) { requestAnimationFrame((t) => this.frame(t)); return; }
    const t = now / 1000;
    if (this.hitstop > 0) { this.hitstop -= dt; dt *= 0.05; }
    const sdt = dt * this.speed;
    // tweens
    for (const tw of [...this.tweens]) {
      tw.t += sdt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.fn(k);
      if (k >= 1) { this.tweens.splice(this.tweens.indexOf(tw), 1); tw.resolve(); }
    }
    this.shapeTargets();
    for (const a of this.actors) {
      if (a.override) continue;
      const dx = a.tx - a.x, dy = a.ty - a.y, d = Math.hypot(dx, dy);
      const sp = (40 + a.c.stats.pace * 6) * sdt;
      if (d > 1.5) { a.x += (dx / d) * Math.min(d, sp); a.y += (dy / d) * Math.min(d, sp); a.pose = d > 4 ? 'run' : 'idle'; if (Math.abs(dx) > 2) a.facing = dx > 0 ? 1 : -1; }
      else if (a.pose === 'run') a.pose = 'idle';
    }
    if (this.carrier) this.stickBall();

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    this.pitch.draw(ctx, t, dt);
    const sorted = [...this.actors].sort((a, b) => a.y - b.y);
    let ballDrawn = false;
    for (const a of sorted) {
      if (!ballDrawn && this.ball.y < a.y) { drawBall(ctx, this.ball.x, this.ball.y, this.size * 0.13, this.ball.spin, this.ball.h); ballDrawn = true; }
      const glow = this.carrier === a ? (a.side === 'you' ? '#FFD23F' : '#FF6B6B') : (this.highlight === a.c.id ? '#fff' : null);
      drawPlayer(ctx, a.c, a.x, a.y, { size: this.size, pose: a.pose, t: t * (this.speed > 1 ? 1.5 : 1), facing: a.facing, glow, look: a.side === 'you' ? 0.3 : -0.3 });
    }
    if (!ballDrawn) drawBall(ctx, this.ball.x, this.ball.y, this.size * 0.13, this.ball.spin, this.ball.h);
    this.pitch.drawFront(ctx, t);

    // floating labels
    for (const l of [...this.labels]) {
      l.t += dt;
      const k = l.t / l.life;
      if (k >= 1) { this.labels.splice(this.labels.indexOf(l), 1); continue; }
      ctx.save();
      ctx.globalAlpha = k < 0.8 ? 1 : (1 - k) / 0.2;
      ctx.font = `${Math.round(this.size * 0.42)}px "Lilita One", system-ui`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4; ctx.strokeStyle = '#1b1b2f';
      const y = l.y - k * 18;
      ctx.strokeText(l.text, l.x, y);
      ctx.fillStyle = l.color; ctx.fillText(l.text, l.x, y);
      ctx.restore();
    }
    requestAnimationFrame((tt) => this.frame(tt));
  }
}
