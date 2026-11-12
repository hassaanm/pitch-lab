// Dice Squad pitch view: a small vertical pitch with your attackers, the
// red defenders standing in each zone (the "walls"), the ball, and labels.
//
// Every ball movement is a tween from where the ball really is, and every
// change of owner happens at the end of a motion (pass arrives, tackle lands,
// keeper's hands meet the ball). Callers get an onContact hook at that frame
// so labels, sounds and numbers fire exactly there.
import { Pitch, drawPlayer, drawBall, setupCanvas, lerp, ease, clamp } from '../../shared/art.js';

// Zone bands (v = 0 is their goal). Index: 0 Defence, 1 Midfield, 2 Attack, 3 Box.
export const ZONE_V = [0.82, 0.57, 0.32, 0.1];
export const ZONE_EDGE = [[0.69, 1], [0.44, 0.69], [0.17, 0.44], [0, 0.17]];
const JANK = new URLSearchParams(location.search).has('jank');
const LYING = new Set(['dive', 'slide', 'tackle']);

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
    this.scene = 1;          // whole-scene alpha, used to cover deliberate cuts
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
    if (this.carrier) this.stickBall();
  }
  // you: [{c, key}], opp: [{c, zone, du}]
  setTeams(you, opp) {
    const mk = (o, side) => ({ ...o, side, u: 0.5, v: 0.5, x: 0, y: 0, pose: 'idle', facing: 1, alpha: 1, beaten: false });
    this.actors = [...you.map((o) => mk(o, 'you')), ...opp.map((o) => mk(o, 'opp'))];
    this.layout(true);
  }
  find(key) { return this.actors.find((a) => a.key === key); }
  keeper(side) { return this.actors.find((a) => a.c.pos === 'GK' && a.side === side); }

  // Formation targets around the ball zone.
  layout(snap = false) {
    const z = this.zone;
    const bv = this.mode === 'attack' ? ZONE_V[z] : (this.threatV ?? 0.55);
    const yourShape = this.mode === 'attack'
      ? { wak: [0.5, 0.95], tomo: [0.32, bv + 0.2], lupe: [0.68, bv + 0.12], kenji: [0.5, bv + 0.04], pip: [0.2, bv - 0.06], rio: [0.62, bv - 0.1] }
      : { wak: [0.5, 0.95], tomo: [0.4, bv + 0.1], lupe: [0.65, bv + 0.06], kenji: [0.5, bv - 0.04], pip: [0.25, bv + 0.02], rio: [0.7, bv - 0.12] };
    for (const a of this.actors) {
      let u, v;
      if (this.mode === 'pens') {
        a.beaten = false;
        if (a.c.pos === 'GK') [u, v] = a.side === 'you' ? [0.5, 0.97] : [0.5, 0.03];
        else if (a.key === this.kicker) [u, v] = this.kickSpot;
        else { const row = this.actors.filter((b) => b.side === a.side && b.c.pos !== 'GK'); const i = row.indexOf(a); u = 0.12 + (i / Math.max(1, row.length - 1)) * 0.76; v = a.side === 'you' ? 0.5 : 0.56; }
      }
      else if (a.side === 'you') { [u, v] = yourShape[a.key] || [0.5, 0.5]; if (this.mode === 'attack' && a.key !== 'wak') v = Math.max(v, 0.2); }  // shoot from a clear distance, never on the keeper's line
      else if (a.c.pos === 'GK') [u, v] = [0.5, 0.04];
      else if (this.mode === 'defend' && a.key === this.threatKey) [u, v] = [this.threatU ?? 0.5, bv];
      else { u = a.du; v = ZONE_V[a.zone] - (a.zone === 3 ? -0.02 : 0.02); if (this.mode === 'defend') v -= 0.08; }
      a.tu = clamp(u, 0.06, 0.94); a.tv = clamp(v, 0.03, 0.97);
      if (snap) { a.u = a.tu; a.v = a.tv; }
    }
    if (snap && this.pitch) { for (const a of this.actors) [a.x, a.y] = this.pitch.toPx(a.u, a.v); if (this.carrier) this.stickBall(); }
  }
  setZone(z, mode = 'attack') { this.zone = z; this.mode = mode; for (const a of this.actors) a.beaten = a.side === 'opp' && a.c.pos !== 'GK' && mode === 'attack' && a.zone < z; this.layout(); }

  tween(dur, fn) { return new Promise((resolve) => this.tweens.push({ t: 0, dur: Math.max(0.01, dur), fn, resolve })); }
  wait(s) { return this.tween(s, () => {}); }
  label(text, x, y, color = '#fff', life = 1.1, big = false) { this.labels.push({ text, x: clamp(x, 40, this.w - 40), y: Math.max(y, 22), color, t: 0, life, big }); }

  // Where the ball sits on a player: at his feet, or in a diving keeper's hands (a.hold).
  feet(a) { return a.hold ? [a.x + a.hold[0], a.y + a.hold[1]] : [a.x + a.facing * this.size * 0.18, a.y + 1]; }
  stickBall() { [this.ball.x, this.ball.y] = this.feet(this.carrier); this.ball.h = 0; }
  // Only for a scene that is covered (start of a match, inside cut()).
  give(a) { this.carrier = a; if (a) this.stickBall(); }

  // Ball travels from where it is to a point, or to a player's feet while he moves.
  async ballTo(target, dur, lift = 3) {
    this.carrier = null;
    const x0 = this.ball.x, y0 = this.ball.y;
    await this.tween(dur, (k) => {
      const [tx, ty] = typeof target === 'function' ? target() : target;
      const e = ease(k);
      this.ball.x = lerp(x0, tx, e); this.ball.y = lerp(y0, ty, e);
      this.ball.h = Math.sin(k * Math.PI) * lift; this.ball.spin += 0.3;
    });
  }
  async passTo(a, lofted = false) {
    const from = this.carrier;
    if (from === a) return;
    if (from) { from.pose = 'pass'; if (Math.abs(a.x - from.x) > 2) from.facing = a.x > from.x ? 1 : -1; }
    const d = Math.hypot(a.x - this.ball.x, a.y - this.ball.y);
    const dur = clamp(d / (lofted ? 330 : 420), 0.25, 0.6);
    await this.ballTo(() => this.feet(a), dur, lofted ? 26 : 3);
    if (from && from.pose === 'pass') from.pose = 'idle';
    this.carrier = a;
  }
  // Move a player along a straight line (locked from the formation loop).
  async runTo(a, x, y, dur) {
    a.lock = true;
    const x0 = a.x, y0 = a.y;
    if (Math.abs(x - x0) > 2) a.facing = x > x0 ? 1 : -1;
    a.pose = 'run';
    await this.tween(dur, (k) => { a.x = lerp(x0, x, ease(k)); a.y = lerp(y0, y, ease(k)); if (this.carrier === a) this.stickBall(); });
    a.pose = 'idle';
  }
  release(...as) { for (const a of as) { a.lock = false; if (!this.posesLocked) a.pose = 'idle'; } }
  flinch(a, s = 0.35) { if (!a) return; a.pose = 'sad'; this.tween(s, () => {}).then(() => { if (a.pose === 'sad' && !this.posesLocked) a.pose = 'idle'; }); }
  // Nearest standing wall defender to a point.
  wallMan(x, y) {
    const pool = this.actors.filter((a) => a.side === 'opp' && a.c.pos !== 'GK' && !a.beaten && a.zone === this.zone);
    return pool.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0] || null;
  }

  // Tackle: tackler runs in, contact frame (onContact), and if win the ball
  // leaves the victim's foot and the tackler collects it.
  async tackle(t, v, { win = false, onContact } = {}) {
    v.lock = true;
    const dir = Math.sign(t.x - v.x) || 1;
    const cx = v.x + dir * this.size * 0.42, cy = v.y + 2;
    const d = Math.hypot(cx - t.x, cy - t.y);
    await this.runTo(t, cx, cy, clamp(d / 260, 0.22, 0.55));
    t.facing = -dir;
    t.pose = 'tackle';
    v.pose = win ? 'sad' : 'idle';
    this.hitstop = 0.1;
    onContact?.();
    if (win) {
      await this.ballTo(() => this.feet(t), 0.16, 4);
      this.carrier = t;
    } else {
      // The attacker rides it: a stumble sideways, ball stays at his feet.
      const x0 = v.x;
      await this.tween(0.18, (k) => { v.x = x0 - dir * Math.sin(k * Math.PI) * this.size * 0.25; if (this.carrier === v) this.stickBall(); });
    }
    await this.wait(0.22);
    await Promise.all([this.getUp(t), v.pose === 'sad' ? this.wait(0.1) : null]);
    this.release(t, v);
  }

  // A shot at a goal (top = theirs). result: goal | save | miss.
  // Ball and keeper reach the save point on the same frame; onContact fires there.
  async shotAt(top, result, onContact) {
    const shooter = this.carrier;
    const gk = this.keeper(top ? 'opp' : 'you');
    const [gx, gy] = this.pitch.goalMouth(top);
    const side = Math.random() < 0.5 ? -1 : 1;
    const gw = this.pitch.goalW;
    const lineY = gk ? gk.y : gy;
    let bx, by;
    const x0 = this.ball.x, y0 = this.ball.y;
    let kx0 = gk ? gk.x : gx, ky0 = gk ? gk.y : gy, kx = kx0, ky = ky0;
    if (result === 'save') {
      bx = gx + side * gw * (0.15 + Math.random() * 0.2); by = lineY;
    } else {
      // Goal or wide: compute the ball path first, then end the dive off it.
      // Try both corners and both dives (short toward the ball, or the wrong
      // way); keep the first in random order that stays a ball's width clear
      // of his standing and diving body, else the clearest one.
      const opts = [];
      for (const sd of [side, -side]) for (const wrong of Math.random() < 0.5 ? [false, true] : [true, false]) {
        const tx = gx + sd * gw * (result === 'goal' ? 0.36 + Math.random() * 0.08 : 0.62 + Math.random() * 0.15);
        const ty = gy + (top ? -1 : 1) * (result === 'goal' ? 12 : 14);
        const f = Math.sign(tx - kx0) || sd;
        const dir = wrong ? -f : f;
        const ex = wrong ? kx0 - f * this.size * 0.5 : kx0 + f * Math.max(0, Math.abs(tx - kx0) - this.size * 1.1);
        opts.push({ tx, ty, dir, ex, gap: this.pathGap(x0, y0, tx, ty, kx0, ky0, ex, ky0, dir) });
      }
      const need = this.size * 0.28 + 3;
      const pick = opts.find((o) => o.gap >= need) || opts.sort((p, q) => q.gap - p.gap)[0];
      bx = pick.tx; by = pick.ty; kx = pick.ex; ky = ky0;
      if (gk) gk.diveDir = pick.dir;
    }
    if (shooter) { shooter.pose = 'kick'; shooter.facing = bx >= shooter.x ? 1 : -1; }
    this.carrier = null;
    const T = clamp(Math.hypot(bx - x0, by - y0) / 520, 0.32, 0.5);
    if (gk) {
      gk.lock = true; gk.pose = 'ready';
      if (result === 'save') {
        const f = Math.sign(bx - kx0) || side;
        // The art kit's dive pose lies toward -facing, so face away from the ball
        // to dive at it. Hands end ~0.6 size along the dive and ~0.12 size up.
        gk.facing = -f;
        const hold = [f * this.size * 0.6, -this.size * 0.12];
        kx = bx - hold[0]; ky = by - hold[1]; gk.saveHold = hold;
      } else gk.facing = -gk.diveDir;
    }
    await this.tween(T, (k) => {
      this.ball.x = lerp(x0, bx, k); this.ball.y = lerp(y0, by, k); this.ball.h = Math.sin(k * Math.PI) * 10; this.ball.spin += 0.6;
      if (gk && k > 0.25) { gk.pose = 'dive'; const e = ease((k - 0.25) / 0.75); gk.x = lerp(kx0, kx, e); gk.y = lerp(ky0, ky, e); }
      if (shooter && k > 0.5 && shooter.pose === 'kick') shooter.pose = 'idle';
    });
    this.ball.h = 0;
    if (result === 'save' && gk) { gk.hold = gk.saveHold; this.carrier = gk; }
    if (result === 'goal') { this.pitch.goal(top); this.hitstop = 0.2; }
    else this.hitstop = 0.12;
    onContact?.();
    await this.wait(0.45);
    if (gk && result !== 'save') await this.getUp(gk);   // a keeper with the ball stays down until recover()
  }
  // Smallest distance between the ball (drawn height included) and the keeper's
  // body over the whole shot: standing upright before the dive starts (k < 0.25),
  // then lying along dir from his feet.
  pathGap(x0, y0, bx, by, kx0, ky0, kx, ky, dir) {
    let gap = 1e9;
    for (let i = 0; i <= 50; i++) {
      const k = i / 50, e = k > 0.25 ? ease((k - 0.25) / 0.75) : 0;
      const px = lerp(x0, bx, k), py = lerp(y0, by, k) - Math.sin(k * Math.PI) * 10;
      const gx = lerp(kx0, kx, e), gy = lerp(ky0, ky, e);
      for (let j = 0; j <= 6; j++) {
        const [qx, qy] = k > 0.25 ? [gx + dir * this.size * 0.75 * (j / 6), gy - this.size * 0.15] : [gx, gy - this.size * 0.9 * (j / 6)];
        gap = Math.min(gap, Math.hypot(px - qx, py - qy) - this.size * 0.14 - this.size * 0.12);
      }
    }
    return gap;
  }
  // Getting up goes through the keeper's crouch, not a one-frame snap.
  // Lying poses go down and come up through drawPlayer's `lay`, then a short
  // `ready` crouch, so nobody snaps between lying and standing in one frame.
  async getUp(a) {
    if (!a) return;
    if (LYING.has(a.pose)) { a.rising = true; const l0 = a.lay ?? 1; await this.tween(0.16, (k) => { a.lay = l0 * (1 - ease(k)); }); a.rising = false; }
    a.pose = 'ready'; a.lay = 0;
    await this.wait(0.1);
    if (a.pose === 'ready') a.pose = 'idle';
  }
  // He gets up: ball goes from his hands back to his feet over a short beat.
  recover(gk) {
    if (!gk) return;
    // Ball comes from his hands to his feet while he gets up.
    if (gk.hold && this.carrier === gk) { const h = gk.hold; this.tween(0.26, (k) => { gk.hold = [lerp(h[0], gk.facing * this.size * 0.18, ease(k)), lerp(h[1], 1, ease(k))]; }).then(() => { gk.hold = null; }); }
    else gk.hold = null;
    return this.getUp(gk).then(() => { gk.lock = false; });
  }

  // A deliberate cut: fade the scene out, rearrange while covered, fade in.
  async cut(fn, out = 0.25, inn = 0.3) {
    await this.tween(out, (k) => { this.scene = 1 - k; });
    this.scene = 0;
    this.labels.length = 0;   // old callouts belong to the old scene
    await fn?.();
    for (const a of this.actors) { a.lock = false; a.pose = 'idle'; a.hold = null; }
    this.layout(true);
    await this.wait(0.05);
    await this.tween(inn, (k) => { this.scene = k; });
    this.scene = 1;
  }
  // Keepers are left out: the beaten one is still down from his dive and gets
  // up through getUp() (lay 1→0, crouch) instead of popping to 'sad'.
  celebrate(side, on = true) {
    for (const a of this.actors) { if (a.c.pos === 'GK') continue; a.pose = on ? (a.side === side ? 'celebrate' : 'sad') : 'idle'; }
    this.posesLocked = on;
  }

  frame(now) {
    if (!this.running) return;
    let dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.ctx) { requestAnimationFrame((t) => this.frame(t)); return; }
    if (JANK && window.__slow) dt *= window.__slow;
    if (this.hitstop > 0) { this.hitstop -= dt; dt *= 0.08; }
    const t = now / 1000;
    for (const tw of [...this.tweens]) {
      tw.t += dt; const k = Math.min(1, tw.t / tw.dur); tw.fn(k);
      if (k >= 1) { this.tweens.splice(this.tweens.indexOf(tw), 1); tw.resolve(); }
    }
    for (const a of this.actors) {
      if (!a.lock) {
        const [tx, ty] = this.pitch.toPx(a.tu, a.tv);
        const dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy);
        const sp = (60 + (a.c.stats?.pace || 5) * 8) * dt;
        if (d > 1.5) { a.x += (dx / d) * Math.min(d, sp); a.y += (dy / d) * Math.min(d, sp); if (!this.posesLocked && !['pass', 'kick', 'tackle', 'sad'].includes(a.pose)) a.pose = d > 4 ? 'run' : 'idle'; if (Math.abs(dx) > 2) a.facing = dx > 0 ? 1 : -1; }
        else if (a.pose === 'run') a.pose = 'idle';
      }
      [a.u, a.v] = this.pitch.toUV(a.x, a.y);
      // A new lying pose starts upright and goes down over ~0.1 s.
      if (LYING.has(a.pose)) { if (!LYING.has(a.lastPose)) a.lay = 0; if (!a.rising) a.lay = Math.min(1, (a.lay ?? 0) + dt / 0.1); }
      a.lastPose = a.pose;
      a.alpha += ((a.beaten ? 0.3 : 1) - a.alpha) * Math.min(1, dt * 6);
    }
    if (this.carrier) this.stickBall();

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
      if (i > 0 && this.mode !== 'pens') { ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.moveTo(this.pitch.x0, y1); ctx.lineTo(this.pitch.x1, y1); ctx.stroke(); ctx.setLineDash([]); }
    });
    const S = this.scene;
    const ball = () => { ctx.save(); ctx.globalAlpha = S; drawBall(ctx, this.ball.x, this.ball.y, this.size * 0.14, this.ball.spin, this.ball.h); ctx.restore(); };
    const sorted = [...this.actors].sort((a, b) => a.y - b.y);
    let ballDrawn = false;
    for (const a of sorted) {
      if (!ballDrawn && this.ball.y < a.y) { ball(); ballDrawn = true; }
      const glow = this.carrier === a ? (a.side === 'you' ? '#FFD23F' : '#FF6B6B') : (a.glow || null);
      drawPlayer(ctx, a.c, a.x, a.y, { size: this.size, pose: a.pose, t, facing: a.facing, glow, lay: LYING.has(a.pose) ? a.lay ?? 1 : undefined, alpha: a.alpha * S, look: a.side === 'you' ? 0.3 : -0.3 });
    }
    if (!ballDrawn) ball();
    this.pitch.drawFront(ctx, t);
    for (const l of [...this.labels]) {
      l.t += dt; const k = l.t / l.life;
      if (k >= 1) { this.labels.splice(this.labels.indexOf(l), 1); continue; }
      ctx.save();
      ctx.globalAlpha = (k < 0.8 ? 1 : (1 - k) / 0.2) * S;
      ctx.font = `${Math.round(this.size * (l.big ? 0.75 : 0.48))}px "Lilita One", system-ui`;
      ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = '#1b1b2f';
      const y = l.y - k * 16;
      ctx.strokeText(l.text, l.x, y); ctx.fillStyle = l.color; ctx.fillText(l.text, l.x, y);
      ctx.restore();
    }
    if (S < 1) { ctx.fillStyle = `rgba(17,24,48,${(1 - S) * 0.85})`; ctx.fillRect(0, 0, this.w, this.h); }
    requestAnimationFrame((tt) => this.frame(tt));
  }
}
