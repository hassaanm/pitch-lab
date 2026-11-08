// Pitch Lab art kit: chunky chibi footballers, a stylised stadium pitch, ball,
// goals with rippling nets, and an animated crowd. Everything is drawn in code
// on a 2D canvas, so the whole lab shares one look.
//
// Main entry points:
//   drawPlayer(ctx, char, x, y, {size, pose, t, facing, look, glow, alpha})
//   portrait(char, size)            -> cached data URL (for <img>)
//   portraitCanvas(char, size)      -> canvas
//   Pitch class: new Pitch(w, h, {variant, crowd}) ; .draw(ctx, t) ; .toPx(u, v)
//   drawBall(ctx, x, y, r, spin, height)
//   setupCanvas(canvas, cssW, cssH) -> ctx scaled for devicePixelRatio

import { TEAMS } from './cast.js';

const INK = '#1b1b2f';

export function setupCanvas(canvas, w, h) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function kitFor(c) {
  const t = TEAMS[c.team];
  if (c.pos === 'GK') return { shirt: t.gkShirt, trim: t.gkTrim, shorts: t.gkShorts, socks: t.gkShirt, num: '#fff' };
  return { shirt: t.shirt, trim: t.trim, shorts: t.shorts, socks: t.socks, num: t.num };
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (v) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  return '#' + ((1 << 24) + (f(r) << 16) + (f(g) << 8) + f(b)).toString(16).slice(1);
}
export { shade };

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
export { rr as roundRect };

function fillStroke(ctx, fill, lw = 1.5) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); }

const hashCode = (s) => [...s].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7);

// ---------------------------------------------------------------- players
// Design units: feet at y=0, the whole sprite is ~44 units tall. `size` is the
// on-screen height in px. Poses: idle, run, kick, pass, dive, slide, celebrate,
// sad, tackle, ready (keeper crouch), header.
export function drawPlayer(ctx, c, x, y, o = {}) {
  const size = o.size ?? 44;
  const s = size / 44;
  const t = o.t ?? performance.now() / 1000;
  const pose = o.pose || 'idle';
  const facing = o.facing ?? 1; // 1 = right-ish, -1 = left-ish (mirrors sprite)
  const look = o.look ?? 0; // -1..1 eye direction
  const phase = (hashCode(c.id) % 100) / 16;
  const kit = kitFor(c);
  const build = c.build || 'mid';
  const bw = { big: 17, mid: 14, slim: 12.5, small: 12.5, tall: 13.5 }[build];
  const legLen = build === 'tall' ? 11 : build === 'small' ? 7.5 : 9;
  const torsoH = build === 'tall' ? 12 : build === 'small' ? 10 : 11;
  const headR = build === 'small' ? 10.5 : 10;

  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = o.alpha ?? 1;

  // ground shadow (does not rotate with the body)
  if (o.shadow !== false) {
    ctx.fillStyle = 'rgba(10,30,15,.28)';
    ctx.beginPath();
    const sw = pose === 'dive' || pose === 'slide' ? 16 : 9.5;
    ctx.ellipse(0, 0, sw * s, 3.4 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (o.glow) {
    ctx.save();
    ctx.globalAlpha *= 0.6 + 0.4 * Math.sin(t * 6);
    ctx.strokeStyle = o.glow;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, 13 * s, 5 * s, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.scale(s * facing, s);

  let bob = 0, lA = 0, lB = 0, aA = 0.2, aB = -0.2, rot = 0, lift = 0, headTilt = 0, squash = 1;
  let mouth = 'smile', eyes = 'open';
  const sp = o.speed ?? 1;
  switch (pose) {
    case 'idle':
      bob = Math.sin(t * 3 + phase) * 0.7;
      squash = 1 + Math.sin(t * 3 + phase) * 0.015;
      aA = 0.25; aB = -0.25;
      mouth = c.brow === 'fierce' ? 'flat' : 'smile';
      break;
    case 'run': {
      const k = t * 15 * sp + phase;
      lA = Math.sin(k) * 0.7; lB = -lA;
      aA = -Math.sin(k) * 0.9; aB = Math.sin(k) * 0.9;
      bob = -Math.abs(Math.sin(k)) * 1.8;
      rot = 0.08;
      mouth = 'flat';
      break;
    }
    case 'kick': case 'pass':
      lA = pose === 'kick' ? -1.25 : -0.8; lB = 0.25; aA = 1.2; aB = -1.3; rot = -0.12; mouth = pose === 'kick' ? 'grit' : 'flat';
      break;
    case 'header':
      lift = 6; lA = 0.4; lB = -0.3; aA = -1.6; aB = 1.6; headTilt = -0.25; mouth = 'grit';
      break;
    case 'tackle': case 'slide':
      rot = -1.15; lift = -4; lA = -1.4; lB = -0.9; aA = -2.2; aB = 0.5; mouth = 'grit';
      break;
    case 'dive':
      rot = -1.35; lift = 5 + Math.sin(t * 2) * 0.5; lA = 0.2; lB = -0.2; aA = -2.9; aB = -2.6; mouth = 'grit';
      break;
    case 'ready':
      squash = 0.92; bob = Math.sin(t * 5 + phase) * 0.6; lA = 0.35; lB = -0.35; aA = 0.9; aB = -0.9; mouth = 'flat';
      break;
    case 'celebrate': {
      const k = t * 9 + phase;
      lift = Math.abs(Math.sin(k)) * 6;
      aA = -2.6 + Math.sin(k) * 0.3; aB = 2.6 - Math.sin(k) * 0.3;
      lA = 0.3; lB = -0.3; mouth = 'open'; eyes = 'happy';
      break;
    }
    case 'sad':
      bob = 1.5; headTilt = 0.35; aA = 0.05; aB = -0.05; mouth = 'frown'; eyes = 'down';
      break;
  }
  if (o.mouth) mouth = o.mouth;

  ctx.translate(0, -lift);
  ctx.rotate(rot);
  ctx.scale(1, squash);

  const hipY = -legLen;
  const shoulderY = hipY - 4 - torsoH;
  const headY = shoulderY - headR + 2 + bob * 0.4;

  // --- back hair layer (behind head)
  const hairBack = () => {
    ctx.save();
    ctx.translate(0, headY + bob);
    ctx.rotate(headTilt);
    const hc = c.hairColor;
    if (c.hair === 'afro') { circle(ctx, 0, -3, headR + 5); fillStroke(ctx, hc); }
    if (c.hair === 'long') { rr(ctx, -headR - 1.5, -4, headR * 2 + 3, headR + 11, 6); fillStroke(ctx, hc); }
    if (c.hair === 'braids') {
      for (const bx of [-headR + 1, headR - 1]) { rr(ctx, bx - 2, -2, 4, headR + 9, 2); fillStroke(ctx, hc); }
    }
    if (c.hair === 'bun') { circle(ctx, 0, -headR - 3, 4.8); fillStroke(ctx, hc); }
    if (c.hair === 'ponytail') { ctx.beginPath(); ctx.ellipse(headR + 2, 2, 3, 7, 0.4 + Math.sin(t * 6) * 0.15, 0, Math.PI * 2); fillStroke(ctx, hc); }
    ctx.restore();
  };

  const limb = (x0, y0, len, ang, w, color, endColor, endR) => {
    ctx.save();
    ctx.translate(x0, y0);
    ctx.rotate(ang);
    rr(ctx, -w / 2, 0, w, len, w / 2);
    fillStroke(ctx, color, 1.4);
    if (endColor) { circle(ctx, 0, len, endR); fillStroke(ctx, endColor, 1.4); }
    ctx.restore();
  };

  const armY = shoulderY + 2.5;
  const ax = bw / 2 + 0.5;
  const glove = c.extras.includes('gloves');
  const handCol = glove ? '#F5F5F5' : c.skin;
  const handR = glove ? 3 : 2.1;

  // back arm
  limb(-ax, armY, 8.5, -aB * 0.9 + 0.1, 4, kit.shirt, handCol, handR);

  // legs
  const legW = build === 'big' ? 5.2 : 4.4;
  const leg = (lx, ang) => {
    ctx.save();
    ctx.translate(lx, hipY);
    ctx.rotate(ang);
    rr(ctx, -legW / 2, 0, legW, legLen, 2);
    fillStroke(ctx, c.skin, 1.4);
    // sock
    rr(ctx, -legW / 2, legLen * 0.45, legW, legLen * 0.55, 1.5);
    fillStroke(ctx, kit.socks, 1.4);
    // boot
    ctx.beginPath();
    ctx.ellipse(1.2, legLen + 0.6, legW * 0.75 + 0.6, 2.1, 0, 0, Math.PI * 2);
    fillStroke(ctx, c.boots || '#222', 1.4);
    ctx.restore();
  };
  leg(-bw / 4 - 0.2, lB);
  leg(bw / 4 + 0.2, lA);

  // shorts
  rr(ctx, -bw / 2 + 0.3, hipY - 5, bw - 0.6, 6.5, 2.5);
  fillStroke(ctx, kit.shorts, 1.5);

  // torso (shirt)
  rr(ctx, -bw / 2, shoulderY, bw, torsoH + 1.5, 4.5);
  fillStroke(ctx, kit.shirt, 1.6);
  // shirt shading + trim
  ctx.save();
  rr(ctx, -bw / 2, shoulderY, bw, torsoH + 1.5, 4.5);
  ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,.12)';
  ctx.fillRect(bw / 2 - 3.5, shoulderY, 4, torsoH + 2);
  ctx.fillStyle = kit.trim;
  ctx.fillRect(-bw / 2, shoulderY + torsoH - 0.5, bw, 2.2);
  ctx.restore();
  // collar
  ctx.beginPath();
  ctx.moveTo(-3, shoulderY + 0.3); ctx.lineTo(0, shoulderY + 3); ctx.lineTo(3, shoulderY + 0.3);
  ctx.strokeStyle = kit.trim; ctx.lineWidth = 1.6; ctx.stroke();
  // number
  if (o.number !== false && size >= 26) {
    ctx.fillStyle = kit.num;
    ctx.font = `900 ${c.num >= 10 ? 6 : 7}px "Lilita One", system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.save(); ctx.scale(facing, 1);
    ctx.fillText(String(c.num), 0, shoulderY + torsoH / 2 + 1.5);
    ctx.restore();
  }

  hairBack();

  // head
  ctx.save();
  ctx.translate(0, headY + bob);
  ctx.rotate(headTilt);
  // ears
  circle(ctx, -headR + 0.3, 1, 2.4); fillStroke(ctx, c.skin, 1.3);
  circle(ctx, headR - 0.3, 1, 2.4); fillStroke(ctx, c.skin, 1.3);
  circle(ctx, 0, 0, headR); fillStroke(ctx, c.skin, 1.6);
  // cheek shade
  ctx.save(); circle(ctx, 0, 0, headR); ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,.08)'; circle(ctx, 4, 3, headR); ctx.fill();
  ctx.restore();

  const fx = look * 1.6 + 0.8;
  // facial hair under features
  if (c.extras.includes('beard')) {
    ctx.beginPath();
    ctx.moveTo(-headR + 1.2, 0);
    ctx.quadraticCurveTo(-headR + 2, headR + 1, fx, headR + 1.8);
    ctx.quadraticCurveTo(headR - 2, headR + 1, headR - 1.2, 0);
    ctx.quadraticCurveTo(fx, 5, -headR + 1.2, 0);
    fillStroke(ctx, c.hairColor, 1.3);
  }
  if (c.extras.includes('stubble')) {
    ctx.fillStyle = 'rgba(40,25,20,.28)';
    ctx.beginPath(); ctx.ellipse(fx, 6, 6.5, 3.6, 0, 0, Math.PI); ctx.fill();
  }
  // eyes
  const ey = -0.5;
  for (const side of [-1, 1]) {
    const ex = fx + side * 3.8;
    if (eyes === 'happy') {
      ctx.beginPath(); ctx.arc(ex, ey + 1, 2, Math.PI * 1.1, Math.PI * 1.9);
      ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.stroke();
    } else if (eyes === 'down') {
      ctx.beginPath(); ctx.moveTo(ex - 1.8, ey + 1); ctx.lineTo(ex + 1.8, ey + 1);
      ctx.strokeStyle = INK; ctx.lineWidth = 1.4; ctx.stroke();
    } else {
      ctx.beginPath(); ctx.ellipse(ex, ey, 2.1, 2.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = INK; ctx.stroke();
      circle(ctx, ex + look * 0.7 + 0.3, ey + 0.4, 1.35); ctx.fillStyle = INK; ctx.fill();
      circle(ctx, ex + look * 0.7 + 0.8, ey - 0.3, 0.45); ctx.fillStyle = '#fff'; ctx.fill();
    }
  }
  // brows
  ctx.strokeStyle = shade(c.hairColor === '#F2D16B' || c.hairColor === '#E9D8A6' ? '#8a6a30' : c.hairColor, 0);
  ctx.lineWidth = 1.5; ctx.lineCap = 'round';
  const browY = ey - 3.6;
  const brow = pose === 'sad' ? 'sad' : (pose === 'celebrate' ? 'happy' : c.brow || 'calm');
  for (const side of [-1, 1]) {
    const ex = fx + side * 3.8;
    let inD = 0, outD = 0;
    if (brow === 'fierce') { inD = 1.2; outD = -0.6; }
    if (brow === 'sad') { inD = -1; outD = 0.6; }
    if (brow === 'sly') { if (side > 0) { inD = -0.6; outD = -1.6; } else { inD = 0.8; } }
    ctx.beginPath();
    if (brow === 'happy') {
      ctx.arc(ex, browY + 1.6, 2, Math.PI * 1.15, Math.PI * 1.85);
    } else {
      ctx.moveTo(ex + side * 1.9, browY + outD);
      ctx.lineTo(ex - side * 1.9, browY + inD);
    }
    ctx.stroke();
  }
  // freckles / blush
  if (c.extras.includes('freckles')) {
    ctx.fillStyle = 'rgba(160,80,40,.55)';
    for (const [dx, dy] of [[-5, 3], [-3.6, 3.8], [-6, 4.2], [5.6, 3], [4.2, 3.9], [6.6, 4.3]]) { circle(ctx, fx + dx, dy, 0.55); ctx.fill(); }
  }
  ctx.fillStyle = 'rgba(255,90,90,.22)';
  circle(ctx, fx - 5.6, 3.4, 1.8); ctx.fill();
  circle(ctx, fx + 5.6, 3.4, 1.8); ctx.fill();
  // mouth
  ctx.strokeStyle = INK; ctx.lineWidth = 1.4;
  const my = 5.2;
  ctx.beginPath();
  if (mouth === 'smile') ctx.arc(fx, my - 1.4, 2.2, Math.PI * 0.2, Math.PI * 0.8);
  else if (mouth === 'flat') { ctx.moveTo(fx - 1.6, my); ctx.lineTo(fx + 1.6, my); }
  else if (mouth === 'frown') ctx.arc(fx, my + 1.6, 2, Math.PI * 1.2, Math.PI * 1.8);
  else if (mouth === 'grit') { rr(ctx, fx - 2.3, my - 1.1, 4.6, 2.4, 1); ctx.fillStyle = '#fff'; ctx.fill(); }
  else if (mouth === 'open') { ctx.ellipse(fx, my, 2.2, 2.4, 0, 0, Math.PI * 2); ctx.fillStyle = '#7a2230'; ctx.fill(); }
  ctx.stroke();
  if (c.extras.includes('mustache')) {
    ctx.beginPath();
    ctx.moveTo(fx, my - 2.2);
    ctx.quadraticCurveTo(fx - 3.5, my - 3.4, fx - 4.4, my - 0.6);
    ctx.quadraticCurveTo(fx - 2, my - 1.4, fx, my - 1.2);
    ctx.quadraticCurveTo(fx + 2, my - 1.4, fx + 4.4, my - 0.6);
    ctx.quadraticCurveTo(fx + 3.5, my - 3.4, fx, my - 2.2);
    fillStroke(ctx, c.hairColor, 1);
  }

  drawHairFront(ctx, c, headR, fx, t);

  if (c.extras.includes('headband')) {
    ctx.save(); circle(ctx, 0, 0, headR + 0.2); ctx.clip();
    ctx.fillStyle = kit.trim === '#FFFFFF' ? '#fff' : '#FF4D6D';
    ctx.fillRect(-headR, -6.8, headR * 2, 2.6);
    ctx.restore();
  }
  ctx.restore(); // head

  // front arm
  limb(ax, armY, 8.5, -aA * 0.9 - 0.1, 4, kit.shirt, handCol, handR);
  if (c.extras.includes('armband')) {
    ctx.save(); ctx.translate(ax, armY); ctx.rotate(-aA * 0.9 - 0.1);
    rr(ctx, -2.3, 3, 4.6, 2, 0.8); fillStroke(ctx, '#FFB000', 1);
    ctx.restore();
  }
  if (c.extras.includes('sweatband')) {
    ctx.save(); ctx.translate(ax, armY); ctx.rotate(-aA * 0.9 - 0.1);
    rr(ctx, -2.3, 6.2, 4.6, 1.8, 0.8); fillStroke(ctx, '#fff', 1);
    ctx.restore();
  }

  ctx.restore();
}

function drawHairFront(ctx, c, R, fx, t) {
  const hc = c.hairColor;
  const hi = shade(hc, 0.25);
  ctx.save();
  ctx.lineJoin = 'round';
  const cap = (depth = 2) => {
    ctx.beginPath();
    ctx.arc(0, 0, R + 0.6, Math.PI * 1.02, Math.PI * 1.98);
    ctx.quadraticCurveTo(R * 0.5, -R * 0.35 + depth, 0, -R * 0.4 + depth);
    ctx.quadraticCurveTo(-R * 0.5, -R * 0.35 + depth, -R - 0.6, -0.4);
    fillStroke(ctx, hc, 1.5);
  };
  switch (c.hair) {
    case 'buzz': {
      ctx.save(); circle(ctx, 0, 0, R); ctx.clip();
      ctx.fillStyle = hc; ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.ellipse(0, -R * 0.55, R * 1.05, R * 0.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.beginPath(); ctx.arc(0, 0, R, Math.PI * 1.08, Math.PI * 1.92); ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.stroke();
      break;
    }
    case 'neat': cap(1.5);
      ctx.beginPath(); ctx.moveTo(-3, -R + 1.5); ctx.lineTo(-1, -R * 0.5); ctx.strokeStyle = hi; ctx.lineWidth = 1.2; ctx.stroke();
      break;
    case 'spiky': {
      ctx.beginPath();
      ctx.moveTo(-R - 1, -1);
      const n = 6;
      for (let i = 0; i <= n; i++) {
        const a = Math.PI * (1.05 + (0.9 * i) / n);
        const tip = R + 6 + (i % 2 ? 1 : -1);
        const am = a + 0.12;
        ctx.lineTo(Math.cos(a - 0.1) * (R + 0.5), Math.sin(a - 0.1) * (R + 0.5));
        ctx.lineTo(Math.cos(am) * tip, Math.sin(am) * tip);
      }
      ctx.lineTo(R + 1, -1);
      ctx.quadraticCurveTo(0, -R * 0.45, -R - 1, -1);
      fillStroke(ctx, hc, 1.5);
      break;
    }
    case 'afro': {
      ctx.beginPath(); ctx.arc(0, -3, R + 5, Math.PI * 0.95, Math.PI * 2.05);
      ctx.quadraticCurveTo(0, -R * 0.35, -R - 4.5, -2);
      fillStroke(ctx, hc, 1.5);
      ctx.fillStyle = hi; ctx.globalAlpha = 0.5;
      for (const [x, y] of [[-6, -12], [2, -15], [8, -10], [-1, -9]]) { circle(ctx, x, y, 1.2); ctx.fill(); }
      break;
    }
    case 'bun': cap(2); break;
    case 'long': cap(3);
      ctx.beginPath(); ctx.moveTo(-R - 0.5, -1); ctx.quadraticCurveTo(-R - 2, 6, -R + 0.5, 9); ctx.lineTo(-R + 2.5, 0); fillStroke(ctx, hc, 1.2);
      break;
    case 'braids': cap(2);
      ctx.strokeStyle = hi; ctx.lineWidth = 0.9;
      for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(i * 2.2, -R + 0.5); ctx.lineTo(i * 2.6, -R * 0.42); ctx.stroke(); }
      break;
    case 'mohawk': {
      ctx.save(); circle(ctx, 0, 0, R); ctx.clip();
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(0, -R * 0.6, R, R * 0.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.moveTo(-2.6, -R + 1.5);
      for (let i = 0; i < 4; i++) { ctx.lineTo(-2.6 + i * 1.7 + 0.9, -R - 6 + Math.abs(i - 1.5) * 1.1); ctx.lineTo(-2.6 + (i + 1) * 1.7, -R + 0.5); }
      ctx.lineTo(2.6, -R + 1.5);
      fillStroke(ctx, hc, 1.4);
      break;
    }
    case 'bald':
      ctx.fillStyle = 'rgba(255,255,255,.45)';
      ctx.beginPath(); ctx.ellipse(-3.5, -R * 0.62, 2.6, 1.4, -0.5, 0, Math.PI * 2); ctx.fill();
      break;
    case 'curly': {
      const pts = [[-8, -4], [-7.5, -8], [-4.5, -10.5], [0, -11.5], [4.5, -10.5], [7.5, -8], [8, -4]];
      for (const [x, y] of pts) { circle(ctx, x, y, 3.3); fillStroke(ctx, hc, 1.3); }
      ctx.beginPath(); ctx.ellipse(0, -7, 7.5, 3.4, 0, 0, Math.PI * 2); ctx.fillStyle = hc; ctx.fill();
      break;
    }
    case 'swoop': {
      ctx.beginPath();
      ctx.arc(0, 0, R + 0.8, Math.PI * 1.0, Math.PI * 1.95);
      ctx.quadraticCurveTo(R * 0.4, -R * 0.1, -R * 0.4, -R * 0.15);
      ctx.quadraticCurveTo(-R * 0.75, -R * 0.1, -R - 0.8, 0);
      fillStroke(ctx, hc, 1.5);
      ctx.beginPath(); ctx.moveTo(-4, -R + 2); ctx.quadraticCurveTo(1, -R * 0.5, 5, -R * 0.35);
      ctx.strokeStyle = hi; ctx.lineWidth = 1.2; ctx.stroke();
      break;
    }
    case 'mop': {
      ctx.beginPath();
      ctx.arc(0, -0.5, R + 1.8, Math.PI * 0.98, Math.PI * 2.02);
      for (let i = 0; i <= 6; i++) {
        const x = R + 1.8 - (i * (2 * R + 3.6)) / 6;
        ctx.lineTo(x, -R * 0.15 + (i % 2 ? 2.2 : 0));
      }
      ctx.closePath();
      fillStroke(ctx, hc, 1.5);
      break;
    }
    case 'flattop':
      rr(ctx, -R + 0.5, -R - 5, 2 * R - 1, 7.5, 1.5); fillStroke(ctx, hc, 1.5);
      ctx.fillStyle = hi; ctx.fillRect(-R + 2, -R - 3.8, 2 * R - 4, 1.2);
      break;
    case 'slick':
      ctx.beginPath();
      ctx.arc(0, 0, R + 0.7, Math.PI * 1.05, Math.PI * 1.98);
      ctx.quadraticCurveTo(R * 0.6, -R * 0.55, -R * 0.2, -R * 0.62);
      ctx.quadraticCurveTo(-R * 0.75, -R * 0.55, -R - 0.7, -0.5);
      fillStroke(ctx, hc, 1.5);
      ctx.beginPath(); ctx.moveTo(-5, -R + 1.8); ctx.quadraticCurveTo(0, -R - 0.5, 6, -R * 0.75);
      ctx.strokeStyle = hi; ctx.lineWidth = 1.3; ctx.stroke();
      break;
    case 'hightop':
      rr(ctx, -R + 1, -R - 8, 2 * R - 2, 12, 3); fillStroke(ctx, hc, 1.5);
      ctx.save(); circle(ctx, 0, 0, R); ctx.clip();
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(-R, -R, 2 * R, R * 0.5); ctx.restore();
      break;
  }
  ctx.restore();
}

// ---------------------------------------------------------------- portraits
const portraitCache = new Map();
export function portraitCanvas(c, size = 96, o = {}) {
  const cv = document.createElement('canvas');
  const ctx = setupCanvas(cv, size, size);
  const t = TEAMS[c.team];
  const bg = c.pos === 'GK' ? t.gkShirt : t.shirt;
  // background burst
  const g = ctx.createRadialGradient(size / 2, size * 0.35, 2, size / 2, size / 2, size * 0.75);
  g.addColorStop(0, shade(bg, 0.45));
  g.addColorStop(1, shade(bg, -0.15));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    ctx.moveTo(size / 2, size * 0.42);
    const a0 = (i / 12) * Math.PI * 2, a1 = a0 + 0.22;
    ctx.lineTo(size / 2 + Math.cos(a0) * size, size * 0.42 + Math.sin(a0) * size);
    ctx.lineTo(size / 2 + Math.cos(a1) * size, size * 0.42 + Math.sin(a1) * size);
    ctx.fill();
  }
  ctx.restore();
  // big player, cropped to head and shoulders
  const big = size * 1.75;
  drawPlayer(ctx, c, size * 0.5, size * (0.5 + (32 / 44) * 1.75), { size: big, pose: o.pose || 'idle', t: o.t ?? 0.3, shadow: false, look: o.look ?? -0.2, number: false });
  return cv;
}
export function portrait(c, size = 96, o = {}) {
  const key = c.id + size + (o.pose || '');
  if (!portraitCache.has(key)) portraitCache.set(key, portraitCanvas(c, size, o).toDataURL());
  return portraitCache.get(key);
}

// Full-body sprite as an image (for cards / DOM).
const spriteCache = new Map();
export function spriteURL(c, size = 80, pose = 'idle') {
  const key = c.id + size + pose;
  if (!spriteCache.has(key)) {
    const cv = document.createElement('canvas');
    const w = size * 0.8, h = size * 1.1;
    const ctx = setupCanvas(cv, w, h);
    drawPlayer(ctx, c, w / 2, h - 6, { size, pose, t: 0.4 });
    spriteCache.set(key, cv.toDataURL());
  }
  return spriteCache.get(key);
}

// ---------------------------------------------------------------- ball
export function drawBall(ctx, x, y, r = 5, spin = 0, height = 0) {
  ctx.save();
  // shadow on the ground
  ctx.fillStyle = `rgba(10,30,15,${0.3 - Math.min(height, 40) / 200})`;
  ctx.beginPath(); ctx.ellipse(x, y + r * 0.6, r * (1 + height / 60), r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
  const by = y - height;
  circle(ctx, x, by, r);
  ctx.fillStyle = '#fff'; ctx.fill();
  ctx.save(); circle(ctx, x, by, r); ctx.clip();
  ctx.fillStyle = INK;
  for (let i = 0; i < 5; i++) {
    const a = spin + (i / 5) * Math.PI * 2;
    circle(ctx, x + Math.cos(a) * r * 0.95, by + Math.sin(a) * r * 0.95, r * 0.32); ctx.fill();
  }
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = spin + (i / 5) * Math.PI * 2 + Math.PI / 5;
    ctx.lineTo(x + Math.cos(a) * r * 0.36, by + Math.sin(a) * r * 0.36);
  }
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,.15)'; circle(ctx, x + r * 0.35, by + r * 0.35, r); ctx.fill();
  ctx.restore();
  circle(ctx, x, by, r); ctx.lineWidth = 1.2; ctx.strokeStyle = INK; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.8)'; circle(ctx, x - r * 0.35, by - r * 0.4, r * 0.22); ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- pitch
// Vertical pitch (portrait friendly). The player's team attacks UP.
// Normalised pitch coords: u (0 left → 1 right), v (0 top/enemy goal → 1 bottom/own goal).
const VARIANTS = {
  day:   { g1: '#5DBB4C', g2: '#52AE43', line: 'rgba(255,255,255,.9)', stand: '#2E3A59', sky: null, tint: null },
  dusk:  { g1: '#59AE48', g2: '#4E9F3F', line: 'rgba(255,248,235,.88)', stand: '#3B2E4A', tint: 'rgba(255,140,60,.13)' },
  night: { g1: '#3E9A45', g2: '#378C3E', line: 'rgba(240,255,250,.9)', stand: '#141A2E', tint: 'rgba(10,20,60,.28)', lights: true },
  rain:  { g1: '#4D9E48', g2: '#44913F', line: 'rgba(255,255,255,.8)', stand: '#232B3D', tint: 'rgba(40,60,90,.22)', rain: true },
};

export class Pitch {
  constructor(w, h, o = {}) {
    this.w = w; this.h = h;
    this.variant = o.variant || 'day';
    this.crowdOn = o.crowd !== false;
    const side = Math.max(12, Math.round(w * 0.055));
    const end = Math.max(26, Math.round(h * 0.06));
    this.x0 = side; this.x1 = w - side;
    this.y0 = end; this.y1 = h - end;
    this.pw = this.x1 - this.x0; this.ph = this.y1 - this.y0;
    this.goalW = this.pw * 0.3;
    this.netDepth = Math.min(end - 6, 18);
    this.ripple = { top: 0, bottom: 0 };
    this.excite = 0;
    this.cache = null;
    this.buildCrowd();
  }
  setVariant(v) { this.variant = v; this.cache = null; this.buildCrowd(); }
  toPx(u, v) { return [this.x0 + u * this.pw, this.y0 + v * this.ph]; }
  toUV(x, y) { return [(x - this.x0) / this.pw, (y - this.y0) / this.ph]; }
  goalMouth(top = true) { return this.toPx(0.5, top ? 0 : 1); }

  buildCrowd() {
    const cols = ['#FFD23F', '#FFD23F', '#FFE680', '#E8463A', '#F06A5E', '#FFFFFF', '#1D2B53', '#F6D5BE', '#A86B43', '#6E4228'];
    const r = (n) => { const x = Math.sin(n * 9301 + 49297) * 233280; return x - Math.floor(x); };
    this.crowd = [];
    let n = 1;
    const add = (x, y) => { this.crowd.push({ x, y, c: cols[Math.floor(r(n++) * cols.length)], p: r(n++) * 6.28, k: 0.6 + r(n++) * 0.8 }); };
    const step = 7;
    for (let y = 8; y < this.h - 4; y += step) {
      for (let x = 3; x < this.x0 - 3; x += step) add(x + (r(n) - 0.5) * 2, y);
      for (let x = this.x1 + 4; x < this.w - 2; x += step) add(x + (r(n) - 0.5) * 2, y);
    }
    for (let x = this.x0; x < this.x1; x += step) {
      for (let y = 3; y < this.y0 - this.netDepth - 4; y += step) add(x, y);
      for (let y = this.y1 + this.netDepth + 6; y < this.h - 2; y += step) add(x, y);
    }
  }

  renderStatic() {
    const V = VARIANTS[this.variant];
    const cv = document.createElement('canvas');
    const ctx = setupCanvas(cv, this.w, this.h);
    const { x0, y0, pw, ph } = this;
    // stands
    const sg = ctx.createLinearGradient(0, 0, 0, this.h);
    sg.addColorStop(0, shade(V.stand, 0.12)); sg.addColorStop(1, V.stand);
    ctx.fillStyle = sg; ctx.fillRect(0, 0, this.w, this.h);
    // grass apron
    ctx.fillStyle = shade(V.g2, -0.12);
    rr(ctx, x0 - 8, y0 - this.netDepth - 4, pw + 16, ph + this.netDepth * 2 + 8, 6); ctx.fill();
    // ad boards
    const ads = ['PITCH LAB', 'SUNBIRDS', 'REDROCK', 'TURN-BASED', 'GOLAZO'];
    ctx.font = '700 7px "Lilita One", system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0, y = y0; y < y0 + ph; i++, y += 60) {
      for (const xx of [x0 - 10, x0 + pw + 7]) {
        ctx.fillStyle = i % 2 ? '#1D2B53' : '#E8463A';
        ctx.fillRect(xx, y, 3, 52);
      }
    }
    // stripes
    const n = 12;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i % 2 ? V.g1 : V.g2;
      ctx.fillRect(x0, y0 + (i * ph) / n, pw, ph / n + 0.5);
    }
    // subtle mow texture
    ctx.globalAlpha = 0.06;
    for (let i = 0; i < 400; i++) {
      const x = x0 + ((i * 97) % pw), y = y0 + ((i * 53 + i * i) % ph);
      ctx.fillStyle = i % 2 ? '#000' : '#fff';
      ctx.fillRect(x, y, 2, 1);
    }
    ctx.globalAlpha = 1;
    // lines
    ctx.strokeStyle = V.line; ctx.lineWidth = 2;
    ctx.strokeRect(x0, y0, pw, ph);
    ctx.beginPath(); ctx.moveTo(x0, y0 + ph / 2); ctx.lineTo(x0 + pw, y0 + ph / 2); ctx.stroke();
    const cr = pw * 0.15;
    ctx.beginPath(); ctx.arc(x0 + pw / 2, y0 + ph / 2, cr, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = V.line;
    circle(ctx, x0 + pw / 2, y0 + ph / 2, 2.5); ctx.fill();
    for (const top of [true, false]) {
      const gy = top ? y0 : y0 + ph, dir = top ? 1 : -1;
      const bw = pw * 0.62, bh = ph * 0.16, sw = pw * 0.32, sh = ph * 0.06;
      ctx.strokeRect(x0 + (pw - bw) / 2, top ? gy : gy - bh, bw, bh);
      ctx.strokeRect(x0 + (pw - sw) / 2, top ? gy : gy - sh, sw, sh);
      circle(ctx, x0 + pw / 2, gy + dir * ph * 0.11, 2); ctx.fill();
      ctx.beginPath();
      ctx.arc(x0 + pw / 2, gy + dir * ph * 0.11, pw * 0.14, top ? 0.25 * Math.PI : 1.25 * Math.PI, top ? 0.75 * Math.PI : 1.75 * Math.PI);
      ctx.stroke();
      // corner arcs
      for (const cx of [x0, x0 + pw]) {
        ctx.beginPath(); ctx.arc(cx, gy, 6, 0, Math.PI * 2); ctx.save(); ctx.clip();
        ctx.restore();
      }
    }
    // light pools for night
    if (V.lights) {
      for (const [lx, ly] of [[0, 0], [this.w, 0], [0, this.h], [this.w, this.h]]) {
        const lg = ctx.createRadialGradient(lx, ly, 10, lx, ly, this.h * 0.75);
        lg.addColorStop(0, 'rgba(255,255,230,.18)'); lg.addColorStop(1, 'rgba(255,255,230,0)');
        ctx.fillStyle = lg; ctx.fillRect(0, 0, this.w, this.h);
      }
    }
    this.cache = cv;
  }

  drawGoal(ctx, top, t) {
    const [cx, gy] = this.goalMouth(top);
    const gw = this.goalW, d = this.netDepth;
    const dir = top ? -1 : 1;
    const rip = top ? this.ripple.top : this.ripple.bottom;
    const x0 = cx - gw / 2;
    // net back
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.fillRect(x0, top ? gy - d : gy, gw, d);
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.lineWidth = 0.8;
    const wob = (x, y) => rip * Math.sin(x * 0.35 + t * 22) * Math.exp(-Math.abs(y - gy) * 0.02);
    for (let i = 0; i <= 12; i++) {
      const x = x0 + (i / 12) * gw;
      ctx.beginPath();
      for (let k = 0; k <= 6; k++) {
        const y = gy + dir * (k / 6) * d;
        const xx = x + wob(y, y) * 0.3, yy = y + dir * wob(x, y) * (k / 6);
        k ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
      }
      ctx.stroke();
    }
    for (let k = 1; k <= 5; k++) {
      ctx.beginPath();
      for (let i = 0; i <= 16; i++) {
        const x = x0 + (i / 16) * gw;
        const y = gy + dir * (k / 5) * d + dir * wob(x, gy + dir * d) * (k / 5);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    // frame
    ctx.strokeStyle = INK; ctx.lineWidth = 4.5;
    ctx.beginPath(); ctx.moveTo(x0, gy); ctx.lineTo(x0, gy + dir * d); ctx.lineTo(x0 + gw, gy + dir * d); ctx.lineTo(x0 + gw, gy); ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.lineWidth = 5; ctx.strokeStyle = INK;
    ctx.beginPath(); ctx.moveTo(x0 - 1, gy); ctx.lineTo(x0 + gw + 1, gy); ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
  }

  drawFlags(ctx, t) {
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const [x, y] = this.toPx(u, v);
      ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 12); ctx.stroke();
      const w = Math.sin(t * 5 + u * 3 + v) * 1.5;
      ctx.beginPath(); ctx.moveTo(x, y - 12); ctx.quadraticCurveTo(x + 4, y - 11 + w, x + 7, y - 10 + w); ctx.lineTo(x, y - 7);
      ctx.fillStyle = v ? '#FFD23F' : '#E8463A'; ctx.fill(); ctx.lineWidth = 1; ctx.stroke();
    }
  }

  drawCrowd(ctx, t) {
    const ex = this.excite;
    for (const p of this.crowd) {
      const hop = Math.max(0, Math.sin(t * (4 + ex * 6) * p.k + p.p)) * (0.6 + ex * 3.2);
      ctx.fillStyle = p.c;
      circle(ctx, p.x, p.y - hop, 2.6); ctx.fill();
      if (ex > 0.5 && p.k > 1.1) { ctx.fillRect(p.x - 3, p.y - hop - 5, 1.3, 3); ctx.fillRect(p.x + 1.8, p.y - hop - 5, 1.3, 3); }
    }
  }

  // Draw background layers (call first), then your players, then drawFront.
  draw(ctx, t = performance.now() / 1000, dt = 1 / 60) {
    if (!this.cache) this.renderStatic();
    ctx.drawImage(this.cache, 0, 0, this.w, this.h);
    if (this.crowdOn) this.drawCrowd(ctx, t);
    this.drawGoal(ctx, true, t);
    this.drawFlags(ctx, t);
    this.ripple.top *= Math.pow(0.04, dt);
    this.ripple.bottom *= Math.pow(0.04, dt);
    this.excite *= Math.pow(0.35, dt);
  }
  drawFront(ctx, t = performance.now() / 1000) {
    this.drawGoal(ctx, false, t);
    const V = VARIANTS[this.variant];
    if (V.tint) { ctx.fillStyle = V.tint; ctx.fillRect(0, 0, this.w, this.h); }
    if (V.lights) {
      const vg = ctx.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.25, this.w / 2, this.h / 2, this.h * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,20,.45)');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, this.w, this.h);
      for (const [lx, ly] of [[6, 6], [this.w - 6, 6], [6, this.h - 6], [this.w - 6, this.h - 6]]) {
        const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, 26);
        g.addColorStop(0, 'rgba(255,255,240,.95)'); g.addColorStop(0.3, 'rgba(255,255,220,.35)'); g.addColorStop(1, 'rgba(255,255,220,0)');
        ctx.fillStyle = g; ctx.fillRect(lx - 26, ly - 26, 52, 52);
      }
    }
    if (V.rain) {
      ctx.strokeStyle = 'rgba(200,220,255,.35)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 70; i++) {
        const x = ((i * 137 + t * 60) % (this.w + 40)) - 20;
        const y = ((i * 89 + t * 520) % (this.h + 30)) - 15;
        ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 9);
      }
      ctx.stroke();
    }
  }
  goal(top) { if (top) this.ripple.top = 9; else this.ripple.bottom = 9; this.excite = 1; }
}

// Small helper: draw a dashed arrow / pass line with an odds bubble.
export function drawArrow(ctx, x1, y1, x2, y2, color = '#fff', o = {}) {
  ctx.save();
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = o.width ?? 2.5; ctx.lineCap = 'round';
  if (o.dash) ctx.setLineDash(o.dash);
  ctx.beginPath(); ctx.moveTo(x1, y1);
  if (o.curve) { const mx = (x1 + x2) / 2 + o.curve, my = (y1 + y2) / 2 - Math.abs(o.curve); ctx.quadraticCurveTo(mx, my, x2, y2); }
  else ctx.lineTo(x2, y2);
  ctx.stroke(); ctx.setLineDash([]);
  const a = Math.atan2(y2 - y1, x2 - x1), hs = o.head ?? 7;
  ctx.beginPath(); ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - Math.cos(a - 0.45) * hs, y2 - Math.sin(a - 0.45) * hs);
  ctx.lineTo(x2 - Math.cos(a + 0.45) * hs, y2 - Math.sin(a + 0.45) * hs);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

// Odds bubble drawn on the canvas.
export function drawOdds(ctx, x, y, p, label = '') {
  const txt = (label ? label + ' ' : '') + Math.round(p * 100) + '%';
  ctx.save();
  ctx.font = '700 11px "Lilita One", system-ui';
  const w = ctx.measureText(txt).width + 12;
  rr(ctx, x - w / 2, y - 9, w, 18, 9);
  ctx.fillStyle = oddsColor(p); ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = INK; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(txt, x, y + 0.5);
  ctx.restore();
}
export function oddsColor(p) {
  if (p >= 0.7) return '#2E9E4F';
  if (p >= 0.45) return '#E0A200';
  if (p >= 0.25) return '#E07A1F';
  return '#D2412F';
}

export const lerp = (a, b, k) => a + (b - a) * k;
export const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
