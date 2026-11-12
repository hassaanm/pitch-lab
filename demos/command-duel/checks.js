// Timing checks (Paper Mario style action commands). Each returns a Promise
// that resolves to 'perfect' | 'good' | 'miss'. Tap anywhere or press Space.
//
//   bar    — stop a sliding marker in the green (pass, tackle)
//   shot   — same, but faster with a thinner green
//   arrows — enter a short arrow sequence before the timer runs out (dribble)
//   ring   — tap when the shrinking ring meets the target (keeper save)

import { sfx } from '../../shared/sfx.js';

let active = null;
export function cancelCheck() { if (active) active(true); }

const ARROWS = { up: '▲', down: '▼', left: '◀', right: '▶' };
const KEYDIR = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' };

export function timingCheck(kind, o = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'tc-wrap';
    const title = o.title || { bar: 'Stop it in the green!', shot: 'Strike it clean!', arrows: 'Beat your man!', ring: 'Time the save!' }[kind];
    wrap.innerHTML = `<div class="tc panel dark"><div class="tc-title">${title}</div><div class="tc-body"></div><div class="tc-hint">${
      kind === 'arrows' ? 'Arrow keys · or tap that side of the screen' : 'Tap anywhere · <span class="kbd">Space</span>'}</div></div>`;
    document.body.appendChild(wrap);
    const body = wrap.querySelector('.tc-body');
    const t0 = performance.now();
    let done = false, raf = 0;

    const finish = (res, cancelled) => {
      if (done) return; done = true; active = null;
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey, true);
      if (cancelled) { wrap.remove(); return; }
      const lbl = document.createElement('div');
      lbl.className = 'tc-result ' + res;
      lbl.textContent = res === 'perfect' ? 'PERFECT!' : res === 'good' ? 'GOOD' : 'MISS';
      wrap.querySelector('.tc').appendChild(lbl);
      (res === 'perfect' ? sfx.perfect : res === 'good' ? sfx.good : sfx.bad)();
      setTimeout(() => {
        // A short invisible shield eats late taps, so a fast "up" tap after the
        // check cannot fall through to the phase tabs at the top of the page.
        wrap.innerHTML = ''; wrap.style.background = 'none';
        setTimeout(() => wrap.remove(), 450);
        resolve(res);
      }, 520);
    };
    active = (c) => finish('miss', c);

    let hit = () => {}, dir = () => {};
    const onKey = (e) => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); hit(); }
      const d = KEYDIR[e.key];
      if (d) { e.preventDefault(); e.stopPropagation(); dir(d); }
    };
    document.addEventListener('keydown', onKey, true);
    wrap.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (performance.now() - t0 < 180) return; // ignore the tap that opened it
      if (kind === 'arrows') {
        const dx = e.clientX - innerWidth / 2, dy = e.clientY - innerHeight / 2;
        dir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
      } else hit();
    });

    if (kind === 'bar' || kind === 'shot') {
      // green zone width and perfect band, in 0..1 of the track
      const green = o.green ?? (kind === 'shot' ? 0.18 : 0.26);
      const perfect = o.perfect ?? green * 0.3;
      const speed = o.speed ?? (kind === 'shot' ? 1.55 : 0.95); // sweeps per second
      const center = 0.3 + Math.random() * 0.4;
      body.innerHTML = `<div class="tc-track"><div class="tc-green" style="left:${(center - green / 2) * 100}%;width:${green * 100}%"></div>
        <div class="tc-perf" style="left:${(center - perfect / 2) * 100}%;width:${perfect * 100}%"></div><div class="tc-mark"></div></div>`;
      const mark = body.querySelector('.tc-mark');
      let pos = 0;
      const frame = (now) => {
        const k = ((now - t0) / 1000) * speed;
        pos = 1 - Math.abs(1 - (k % 2)); // ping-pong 0..1
        mark.style.left = pos * 100 + '%';
        if (k > 4) return finish('miss'); // two full trips, then it's a miss
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      hit = () => {
        const d = Math.abs(pos - center);
        finish(d <= perfect / 2 + 0.01 ? 'perfect' : d <= green / 2 ? 'good' : 'miss');
      };
    }

    if (kind === 'arrows') {
      const n = o.count ?? 3;
      const time = o.time ?? 2.6;
      const keys = Object.keys(ARROWS);
      const seq = Array.from({ length: n }, () => keys[(Math.random() * 4) | 0]);
      body.innerHTML = `<div class="tc-arrows">${seq.map((d) => `<span>${ARROWS[d]}</span>`).join('')}</div><div class="tc-timer"><i></i></div>`;
      wrap.insertAdjacentHTML('beforeend', `<div class="tc-dirs"><b class="u">▲</b><b class="d">▼</b><b class="l">◀</b><b class="r">▶</b></div>`);
      const tiles = body.querySelectorAll('.tc-arrows span');
      const bar = body.querySelector('.tc-timer i');
      let i = 0;
      tiles[0].classList.add('cur');
      const frame = (now) => {
        const k = (now - t0) / 1000 / time;
        bar.style.width = Math.max(0, 1 - k) * 100 + '%';
        if (k >= 1) return finish('miss');
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      dir = (d) => {
        if (done) return;
        if (d !== seq[i]) { tiles[i].classList.add('bad'); return finish('miss'); }
        sfx.tick();
        tiles[i].classList.remove('cur'); tiles[i].classList.add('ok');
        i++;
        if (i >= n) {
          const used = (performance.now() - t0) / 1000 / time;
          return finish(used < 0.6 ? 'perfect' : 'good');
        }
        tiles[i].classList.add('cur');
      };
    }

    if (kind === 'ring') {
      const R = 38, start = 130, dur = o.time ?? 1.15;
      body.innerHTML = `<div class="tc-ringbox"><div class="tc-target" style="width:${R * 2}px;height:${R * 2}px"></div><div class="tc-ring"></div><div class="tc-glove">🧤</div></div>`;
      const ring = body.querySelector('.tc-ring');
      let r = start;
      const frame = (now) => {
        const k = (now - t0) / 1000 / dur;
        r = start * (1 - k);
        ring.style.width = ring.style.height = Math.max(0, r * 2) + 'px';
        if (r <= 4) return finish('miss');
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      hit = () => {
        const d = Math.abs(r - R);
        finish(d <= 6 ? 'perfect' : d <= 17 ? 'good' : 'miss');
      };
    }
  });
}
