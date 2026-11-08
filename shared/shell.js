// Common chrome for every demo: top bar, phase picker, info sheet, event log,
// scoreboard, and the juice helpers (banner, popup, cut-in, confetti, shake).
//
//   const shell = new Shell({
//     id: 'grid', title: 'Grid Tactics',
//     pitch: 'one-line pitch', how: ['step', ...], notice: 'design question',
//     phases: [{ id: 'early', label: 'Kickoff', sub: "0' · 0–0" }, ...],
//     onPhase: (id) => { ...reset the demo to that hand-authored state... },
//   });
//   shell.stage -> the element to render into.

import { sfx, unlock, isMuted, setMuted } from './sfx.js';
import { portrait } from './art.js';
import { crestSVG, TEAMS } from './cast.js';

export class Shell {
  constructor(o) {
    this.o = o;
    document.title = `${o.title} · Pitch Lab`;
    const app = document.createElement('div');
    app.className = 'app';
    app.innerHTML = `
      <header class="topbar">
        <a class="back" href="${o.home || '../../'}">◀ Lab</a>
        <div class="title">${o.title}</div>
        <div class="scoreboard" hidden></div>
        <button class="iconbtn" data-act="mute" title="Sound (M)">${isMuted() ? '🔇' : '🔊'}</button>
        <button class="iconbtn" data-act="help" title="How to play (H)">?</button>
      </header>
      <nav class="phasebar"></nav>
      <div class="layout">
        <main class="stage"></main>
        <aside class="logpanel panel">
          <div class="loghead"><h3>Match log</h3><span class="muted kbd">L</span></div>
          <ol class="log"></ol>
        </aside>
      </div>`;
    document.body.appendChild(app);
    this.app = app;
    this.stage = app.querySelector('.stage');
    this.logEl = app.querySelector('.log');
    this.logPanel = app.querySelector('.logpanel');
    this.scoreEl = app.querySelector('.scoreboard');
    if (o.log === false) this.logPanel.remove();

    const bar = app.querySelector('.phasebar');
    (o.phases || []).forEach((p, i) => {
      const b = document.createElement('button');
      b.className = 'phase';
      b.dataset.id = p.id;
      b.innerHTML = `<b>${i + 1}. ${p.label}</b><span>${p.sub || ''}</span>`;
      b.onclick = () => { sfx.click(); this.setPhase(p.id); };
      bar.appendChild(b);
    });
    if (!o.phases?.length) bar.remove();

    app.querySelector('[data-act=help]').onclick = () => this.showHelp();
    const mute = app.querySelector('[data-act=mute]');
    mute.onclick = () => { setMuted(!isMuted()); mute.textContent = isMuted() ? '🔇' : '🔊'; };
    this.logPanel.querySelector?.('.loghead')?.addEventListener('click', () => this.logPanel.classList.toggle('collapsed'));

    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', (e) => {
      unlock();
      if (e.target?.closest?.('input,textarea')) return;
      if (e.key === 'h' || e.key === '?') this.showHelp();
      if (e.key === 'm') mute.click();
      if (e.key === 'l') this.logPanel.classList.toggle('collapsed');
      if (e.altKey && ['1', '2', '3'].includes(e.key)) { const p = o.phases?.[+e.key - 1]; if (p) this.setPhase(p.id); }
    });

    const seenKey = 'pl-seen-' + o.id;
    let seen = false;
    try { seen = localStorage.getItem(seenKey) === '1'; localStorage.setItem(seenKey, '1'); } catch {}
    const first = new URLSearchParams(location.search).get('phase') || o.phases?.[0]?.id;
    queueMicrotask(() => {
      if (first) this.setPhase(first);
      if (!seen && o.how) this.showHelp();
    });
  }

  setPhase(id) {
    this.phase = id;
    this.app.querySelectorAll('.phase').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
    this.clearLog();
    this.o.onPhase?.(id);
  }

  showHelp() {
    const o = this.o;
    this.modal({
      title: o.title,
      html: `<p class="pitchline">${o.pitch || ''}</p>
        ${o.how ? `<h4>How to play</h4><ul>${o.how.map((h) => `<li>${h}</li>`).join('')}</ul>` : ''}
        ${o.notice ? `<div class="notice"><b>What to notice:</b> ${o.notice}</div>` : ''}
        ${o.phases ? `<p class="muted" style="font-size:12px;margin-top:10px">Jump between phases with the buttons under the top bar.</p>` : ''}`,
      buttons: [{ label: "Let's play", cls: '' }],
    });
  }

  // ----- log
  log(text, kind = '', time = '') {
    const li = document.createElement('li');
    if (kind) li.className = kind;
    li.innerHTML = `<span class="t">${time}</span><span>${text}</span>`;
    this.logEl.prepend(li);
    while (this.logEl.children.length > 120) this.logEl.lastChild.remove();
  }
  clearLog() { this.logEl.innerHTML = ''; }

  // ----- scoreboard: { home, away, clock, homeTeam='sun', awayTeam='red', label }
  setScore(s) {
    if (!s) { this.scoreEl.hidden = true; return; }
    this.scoreEl.hidden = false;
    const ht = s.homeTeam || 'sun', at = s.awayTeam || 'red';
    this.scoreEl.innerHTML = `${crestSVG(ht, 20)}<span class="sc">${s.home}</span><span style="opacity:.5">–</span><span class="sc">${s.away}</span>${crestSVG(at, 20)}${s.clock != null ? `<span class="clock">${s.clock}</span>` : ''}`;
  }

  // ----- overlays
  modal({ title, html, buttons = [{ label: 'OK' }], dismiss = true, wide = false }) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'sheet-wrap';
      wrap.innerHTML = `<div class="sheet panel" style="${wide ? 'max-width:640px' : ''}">${title ? `<h2>${title}</h2>` : ''}<div class="body">${html || ''}</div><div class="row"></div></div>`;
      const row = wrap.querySelector('.row');
      const close = (v) => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      buttons.forEach((b, i) => {
        const el = document.createElement('button');
        el.className = 'btn ' + (b.cls || '');
        el.textContent = b.label;
        el.onclick = () => { sfx.click(); close(b.value ?? i); };
        row.appendChild(el);
      });
      const onKey = (e) => {
        if (e.key === 'Escape' && dismiss) close(-1);
        if (e.key === 'Enter') { e.preventDefault(); close(buttons[0]?.value ?? 0); }
      };
      document.addEventListener('keydown', onKey);
      if (dismiss) wrap.addEventListener('click', (e) => { if (e.target === wrap) close(-1); });
      document.body.appendChild(wrap);
      this.lastModal = wrap;
    });
  }

  banner(text, sub = '', color) {
    const b = document.createElement('div');
    b.className = 'banner';
    if (color) b.style.color = color;
    b.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 1500);
  }

  popup(text, x, y, color = '#fff') {
    const p = document.createElement('div');
    p.className = 'popup';
    p.style.left = x + 'px'; p.style.top = y + 'px'; p.style.color = color;
    p.textContent = text;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 1000);
  }
  // popup positioned relative to an element (e.g. a canvas) in its CSS pixels
  popupAt(el, x, y, text, color) {
    const r = el.getBoundingClientRect();
    this.popup(text, r.left + x, r.top + y, color);
  }

  toast(text, ms = 1800) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  cutIn(char, title, sub = '') {
    sfx.cutin();
    const t = TEAMS[char.team];
    const c = document.createElement('div');
    c.className = 'cutin';
    c.innerHTML = `<div class="stripe" style="--c1:${t.shirt};--c2:${shadeHex(t.shirt)}"><img src="${portrait(char, 150)}" alt=""><div class="ctext">${title}<small>${sub || char.name}</small></div></div>`;
    document.body.appendChild(c);
    return new Promise((r) => setTimeout(() => { c.remove(); r(); }, 1500));
  }

  flash(color = '#fff') {
    const f = document.createElement('div');
    f.className = 'flash'; f.style.background = color;
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 400);
  }

  shake(el = this.stage) {
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
  }

  confetti(n = 140, colors = ['#FFD23F', '#1D2B53', '#fff', '#4FC3F7', '#FF6B9A']) {
    let cv = document.getElementById('confetti');
    if (!cv) { cv = document.createElement('canvas'); cv.id = 'confetti'; document.body.appendChild(cv); }
    const w = (cv.width = innerWidth), h = (cv.height = innerHeight);
    const ctx = cv.getContext('2d');
    const ps = Array.from({ length: n }, () => ({
      x: w / 2 + (Math.random() - 0.5) * w * 0.3, y: h * 0.4, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 16 - 4,
      r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4, c: colors[(Math.random() * colors.length) | 0], s: 4 + Math.random() * 5,
    }));
    const t0 = performance.now();
    const step = (now) => {
      ctx.clearRect(0, 0, w, h);
      for (const p of ps) {
        p.vy += 0.45; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
      }
      if (now - t0 < 2600) requestAnimationFrame(step); else ctx.clearRect(0, 0, w, h);
    };
    requestAnimationFrame(step);
  }

  wait(ms) { return new Promise((r) => setTimeout(r, ms * (this.speed || 1))); }
}

function shadeHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.round(v * 0.82);
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export function oddsClass(p) { return p >= 0.7 ? 'hi' : p >= 0.45 ? 'mid' : p >= 0.25 ? 'lo' : 'vlo'; }
export function oddsPill(p, label = '') { return `<span class="odds ${oddsClass(p)}">${label ? label + ' ' : ''}${Math.round(p * 100)}%</span>`; }
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
