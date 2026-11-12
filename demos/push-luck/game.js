// Push Your Luck: every possession is a Can't Stop run. Each pass builds xG
// but adds pressure, and pressure makes every next pass riskier. Shoot to
// cash the xG in — or lose it all to a turnover and face a counter.

import { Shell, oddsPill, shuffle, pick, clamp, rand } from '../../shared/shell.js';
import { portrait, drawArrow, oddsColor } from '../../shared/art.js';
import { sfx } from '../../shared/sfx.js';
import { byId, LINEUP5 } from '../../shared/cast.js';
import { PossView } from './view.js';

const shell = new Shell({
  id: 'push-luck',
  title: 'Push Your Luck',
  pitch: 'Every pass builds your chance and the pressure. Shoot now, or risk one more pass?',
  how: [
    'On the ball you get 3 pass options. Each shows its turnover risk and ⚽ your shot chance if it works.',
    'Every action raises 🔥 pressure, and pressure raises the risk of every pass. The longer you keep the ball, the faster it climbs (+3 more for each pass already in the chain). Recycle halves it and Switch takes off 30% — they buy time, they never reset it. Each card shows its 🔥 cost.',
    'Shoot any time: your goal chance comes from the xG you have built. String 5 passes for a +0.08 xG bonus.',
    'Lose the ball and the xG is gone: Redrock counter. After every shot or turnover Redrock attack, and you make one defensive call with its odds shown: Press, Hold Shape, Deep Block, or a Tactical Foul on a counter.',
    '↻ Reroll swaps your 3 pass options. You get only a few per match (1 / 3 / 2 by phase).',
    'Named players (👤) makes stats count: Kenji\'s line-breakers and Pip\'s take-ons are safer, Rio finishes better.',
    'Keys: 1–3 pass · S shoot · R reroll · N named players.',
  ],
  notice: 'Does stop-or-push create soccer tension (patience vs. risk), and does it hold up across a whole match?',
  phases: [
    { id: 'early', label: 'Kickoff', sub: "0' · 0–0" },
    { id: 'mid', label: 'Second half', sub: "46' · 1–1 · ↻3" },
    { id: 'clutch', label: 'Clutch', sub: "88' · 1–2 · night" },
  ],
  onPhase: (id) => startPhase(id),
});
const stage = shell.stage;

// ------------------------------------------------------------------ data
const TYPES = {
  safe:    { name: 'Safe Pass', icon: '🟢', risk: 0.05, xg: 0.014, prog: 0.05, press: 8, stat: 'pass', text: 'Keep it simple.' },
  recycle: { name: 'Recycle', icon: '🔄', risk: 0.03, xg: -0.01, prog: -0.12, relief: 0.5, stat: 'pass', text: 'Go back. Pressure halves.' },
  prog:    { name: 'Progressive', icon: '⬆️', risk: 0.12, xg: 0.035, prog: 0.14, press: 12, stat: 'pass', text: 'Into the next line.' },
  breaker: { name: 'Line-breaker', icon: '⚡', risk: 0.23, xg: 0.085, prog: 0.24, press: 16, stat: 'pass', text: 'Split the defence.' },
  switch:  { name: 'Switch', icon: '🔀', risk: 0.12, xg: 0.02, prog: 0.03, relief: 0.3, stat: 'pass', lofted: true, text: 'Change flank. Pressure eases.' },
  takeon:  { name: 'Take-on', icon: '💨', risk: 0.26, xg: 0.06, prog: 0.12, press: 6, stat: 'dribble', text: 'Beat your man.' },
};
const CHAIN_BONUS = 0.08;
// Pressure is sticky. The longer you keep the ball the more the defence
// organises: every completed action adds +3, +6, +9… (3 + 3 × passes already
// in the chain) on top of its own pressure. Recycle and Switch shed only part
// of the pressure (half / 30%), so they buy time but never reset the clock.
function pressDelta(type) {
  const T = TYPES[type];
  const ramp = 3 + 3 * s.chain;
  return T.relief ? ramp - Math.round(s.pressure * T.relief) : T.press + ramp;
}
const YOU = ['wak', 'tomo', 'kenji', 'pip', 'rio'];
const OPP = LINEUP5.red; // oskar, hans, lu, zed, viper

const PHASES = {
  early: { clock: 0, end: 90, score: [0, 0], rerolls: 1, prog: 0.12, pressure: 0, variant: 'day', per: 2, theirs: [4, 6] },
  mid: { clock: 46, end: 90, score: [1, 1], rerolls: 3, prog: 0.25, pressure: 0, variant: 'dusk', per: 2, theirs: [4, 6] },
  clutch: { clock: 88, end: 93, score: [1, 2], rerolls: 2, prog: 0.35, pressure: 30, variant: 'night', per: 1, theirs: [2, 2] },
};

let s = null;      // state
let view = null;
let busy = false;
let token = 0;
let named = (() => { try { return localStorage.getItem('pl-push-named') !== '0'; } catch { return true; } })();

const ch = (k) => byId[(k[0] === 'y' ? YOU : OPP)[+k.slice(1)]];
const nm = (k) => ch(k).name;
const pct = (p) => Math.round(p * 100) + '%';
const clockStr = () => (s.clock > 90 ? `90+${Math.min(s.clock - 90, 9)}'` : `${Math.round(s.clock)}'`);
const log = (t, k = '') => shell.log(t, k, clockStr());

// ------------------------------------------------------------------ setup
function startPhase(id) {
  token++;
  const P = PHASES[id];
  busy = false;
  s = {
    phase: id, clock: P.clock, end: P.end, score: [...P.score], rerolls: P.rerolls, per: P.per, theirs: P.theirs, variant: P.variant,
    mode: 'atk', carrier: id === 'clutch' ? 'y2' : 'y1', picked: -1, prog: P.prog, pressure: P.pressure, xg: 0, chain: 0, offers: [], def: null, yellows: 0,
    startProg: P.prog, startPressure: P.pressure,
    stats: { you: { xg: 0, shots: 0, poss: 0, lost: 0 }, opp: { xg: 0, shots: 0 } },
  };
  buildScreen();
  // fresh screen: everyone starts in shape (the only instant placement, before the first frame)
  const bv = vOf(P.prog);
  view.placeNow({ ...layoutAttack(0.5, bv), [s.carrier]: [0.5, bv] });
  view.holdNow(s.carrier);
  log(id === 'clutch' ? 'Stoppage time. One goal down. Redrock have parked the bus — pressure starts high.' : id === 'mid' ? 'Second half, all square. You have 3 rerolls.' : 'Kick-off. Sunbirds have the ball.', 'info');
  beginPossession(P.prog, P.pressure, s.carrier);
}

function buildScreen() {
  view?.destroy();
  stage.innerHTML = `<div class="pl">
    <div class="pitchwrap"><canvas id="cv"></canvas>
      <div class="badge" id="badge"></div>
      <button class="namedtog" id="named" title="Named players (N)"></button>
    </div>
    <div class="meters">
      <div class="meter xg"><span class="ml">xG</span><div class="bar"><i id="xgbar"></i><b id="xgtick"></b></div><span class="mv" id="xgv"></span></div>
      <div class="meter pr"><span class="ml">🔥</span><div class="bar"><i id="prbar"></i></div><span class="mv" id="prv"></span></div>
      <div class="chain" id="chain"></div>
    </div>
    <div class="offers" id="offers"></div>
    <div class="actbar">
      <button class="btn red big" id="shoot"></button>
      <button class="btn small paper" id="reroll"></button>
    </div>
  </div>`;
  view = new PossView(stage.querySelector('#cv'));
  view.over = drawOver;
  fit();
  window.onresize = fit;
  view.setCast([...YOU.map((id, i) => ({ key: 'y' + i, c: byId[id], side: 'you', u: 0.5, v: 0.5 })), ...OPP.map((id, i) => ({ key: 'o' + i, c: byId[id], side: 'opp', u: 0.5, v: 0.3 }))]);
  stage.querySelector('#shoot').onclick = () => shoot();
  stage.querySelector('#reroll').onclick = () => reroll();
  stage.querySelector('#named').onclick = () => toggleNamed();
}

function fit() {
  const wrap = stage.querySelector('.pitchwrap');
  if (!wrap || !view) return;
  const w = Math.min(wrap.clientWidth - 6, 560);
  const top = wrap.getBoundingClientRect().top + scrollY;
  const h = Math.round(Math.max(320, Math.min(innerHeight - top - 268, w * 1.35)));
  view.resize(w, h, s.variant);
}

function toggleNamed() {
  named = !named;
  try { localStorage.setItem('pl-push-named', named ? '1' : '0'); } catch {}
  sfx.click();
  shell.toast(named ? '👤 Named players: stats and specials change the odds.' : '🎲 Plain mode: pure risk, no stats.');
  if (s.mode === 'atk' && !busy) s.offers = s.offers.map((o) => ({ ...buildOffer(o.type, o.to), spot: o.spot }));
  render();
}

// ------------------------------------------------------------------ odds
const vOf = (prog) => 0.86 - clamp(prog, 0, 1) * 0.72;

function riskFor(type, passerK, carrierK, prog, pressure) {
  const T = TYPES[type];
  const base = T.risk + (pressure / 100) * 0.3 + Math.max(0, prog) * 0.05;
  const mods = [];
  let mult = 1;
  if (named) {
    const c = ch(type === 'takeon' ? carrierK : passerK);
    if (T.stat === 'dribble') { mult *= 1.5 - c.stats.dribble * 0.09; mods.push(`dribble ${c.stats.dribble}`); }
    else { mult *= 1.3 - c.stats.pass * 0.05; mods.push(`pass ${c.stats.pass}`); }
    if (type === 'breaker' && c.id === 'kenji') { mult *= 0.6; mods.push('Needle −40%'); }
    if (type === 'takeon' && c.id === 'pip') { mult *= 0.6; mods.push('Pinball −40%'); }
  }
  return { p: clamp(base * mult, 0.02, 0.85), base: clamp(base, 0.02, 0.85), mods };
}

function shotChance(k = s.carrier, xg = s.xg) {
  let p = xg + 0.02;
  const mods = [];
  if (named) {
    const c = ch(k);
    const m = 0.7 + c.stats.shoot * 0.04 * (c.id === 'rio' ? 1.12 : 1);
    p *= m;
    mods.push(`${c.name} shoot ${c.stats.shoot}${c.id === 'rio' ? ' · Eagle Eye' : ''}`);
  }
  // Oskar is huge
  p *= 0.93;
  return { p: clamp(p, 0.02, 0.75), mods };
}

function xgGain(type, progAfter) {
  const T = TYPES[type];
  return T.xg < 0 ? T.xg : T.xg * (0.5 + progAfter * 1.1);
}

// pick a receiver for a pass type
function receiverFor(type) {
  const outfield = ['y1', 'y2', 'y3', 'y4'].filter((k) => k !== s.carrier);
  if (type === 'takeon') return s.carrier;
  if (type === 'recycle') return s.carrier !== 'y0' && s.prog < 0.25 && Math.random() < 0.5 ? 'y0' : pick(outfield.filter((k) => k !== 'y4')) || pick(outfield);
  if (type === 'breaker' || type === 'prog') return Math.random() < 0.6 && s.carrier !== 'y4' ? 'y4' : pick(outfield);
  return pick(outfield);
}

function buildOffer(type, to) {
  const T = TYPES[type];
  to = to || receiverFor(type);
  const progAfter = clamp(s.prog + T.prog, 0, 1);
  const r = riskFor(type, s.carrier, s.carrier, s.prog, s.pressure);
  const bu = view.at(s.carrier)?.u ?? 0.5;
  let u;
  if (type === 'switch') u = bu < 0.5 ? rand(0.72, 0.86) : rand(0.14, 0.28);
  else if (type === 'takeon') u = clamp(bu + rand(-0.12, 0.12), 0.15, 0.85);
  else if (type === 'breaker') u = rand(0.35, 0.65);
  else u = clamp(bu + (Math.random() < 0.5 ? -1 : 1) * rand(0.12, 0.25), 0.12, 0.88);
  const v = to === 'y0' ? 0.9 : vOf(progAfter);
  const gain = xgGain(type, progAfter);
  const xgAfter = Math.max(0, s.xg + gain) + (s.chain + 1 === 5 ? CHAIN_BONUS : 0);
  const shotAfter = to === 'y0' ? null : shotChance(to, xgAfter).p;
  return { type, to, risk: r.p, baseRisk: r.base, mods: r.mods, gain, progAfter, press: pressDelta(type), spot: [u, v], shotAfter };
}

function makeOffers() {
  const types = shuffle(Object.keys(TYPES));
  // never offer Recycle from deep inside your own half; keep one forward option
  const pool = types.filter((t) => !(t === 'recycle' && s.prog < 0.08) && !(s.carrier === 'y0' && (t === 'takeon' || t === 'recycle')));
  s.offers = pool.slice(0, 3).map((t) => buildOffer(t));
}

// ------------------------------------------------------------------ layout
// Both return target spots { key: [u, v] } for everyone except the carrier.
// Nobody is placed instantly: callers send them there with view.moveAll().
function layoutAttack(bu, bv) {
  const spots = {};
  const others = ['y1', 'y2', 'y3', 'y4'].filter((k) => k !== s.carrier);
  const slots = [[bu - 0.3, bv + 0.05], [bu + 0.3, bv + 0.02], [bu + (bu < 0.5 ? 0.16 : -0.16), bv - 0.2], [0.5 + (0.5 - bu) * 0.4, bv + 0.24]];
  // forward (y4 = Rio) takes the most advanced slot
  const order = [...others].sort((a, b) => +b.slice(1) - +a.slice(1));
  const slotOrder = [2, 0, 1, 3];
  order.forEach((k, i) => { const sl = slots[slotOrder[i]]; spots[k] = [clamp(sl[0], 0.08, 0.92), clamp(sl[1], 0.1, 0.9)]; });
  if (s.carrier !== 'y0') spots.y0 = [0.5 + (bu - 0.5) * 0.2, 0.95];
  spots.o0 = [0.5 + (bu - 0.5) * 0.25, 0.04];
  const pf = s.pressure / 100;
  const lineV = clamp(bv - 0.16, 0.08, 0.6);
  const base = { o1: [0.3, lineV], o2: [0.7, lineV], o3: [0.5 + (bu - 0.5) * 0.4, clamp(bv - 0.06, 0.1, 0.8)], o4: [0.5, clamp(bv + 0.08, 0.15, 0.85)] };
  // the two nearest defenders close in as pressure rises
  const near = Object.entries(base).sort((a, b) => Math.hypot(a[1][0] - bu, a[1][1] - bv) - Math.hypot(b[1][0] - bu, b[1][1] - bv)).slice(0, 2).map(([k]) => k);
  for (const [k, [u, v]] of Object.entries(base)) {
    if (near.includes(k)) {
      const side = k === near[0] ? -1 : 1;
      const tu = bu + side * 0.07, tv = bv - 0.035 * (k === near[0] ? 1 : -0.6);
      const f = 0.25 + pf * 0.72;
      spots[k] = [u + (tu - u) * f, v + (tv - v) * f];
    } else spots[k] = [u + (bu - 0.5) * 0.3, v];
  }
  delete spots[s.carrier];
  return spread(spots, bu, bv);
}

function layoutDefend(carrierK, bu, bv) {
  const spots = {};
  spots.o0 = [0.5, 0.05];
  const others = ['o1', 'o2', 'o3', 'o4'].filter((k) => k !== carrierK);
  const slots = [[bu - 0.28, bv - 0.04], [bu + 0.28, bv - 0.02], [bu + (bu < 0.5 ? 0.18 : -0.18), bv + 0.17], [0.5, bv - 0.24]];
  const order = [...others].sort((a, b) => +b.slice(1) - +a.slice(1));
  order.forEach((k, i) => { const sl = slots[[2, 0, 1, 3][i]]; spots[k] = [clamp(sl[0], 0.08, 0.92), clamp(sl[1], 0.08, 0.9)]; });
  spots.y0 = [0.5 + (bu - 0.5) * 0.2, 0.95];
  const lineV = clamp(bv + 0.14, 0.4, 0.88);
  spots.y1 = [0.32, lineV]; spots.y2 = [0.5 + (bu - 0.5) * 0.4, clamp(bv + 0.06, 0.2, 0.86)]; spots.y3 = [0.68, lineV]; spots.y4 = [0.5, clamp(bv - 0.12, 0.1, 0.7)];
  delete spots[carrierK];
  return spread(spots, bu, bv);
}

// Keep everyone at least a body-width from the carrier and from each other, so
// the ball and the carrier are never hidden behind another sprite.
function spread(spots, bu, bv) {
  const S = view.size;
  const P = Object.fromEntries(Object.entries(spots).map(([k, [u, v]]) => [k, view.px(u, v)]));
  const [cx, cy] = view.px(bu, bv);
  const keys = Object.keys(P).filter((k) => k !== 'y0' && k !== 'o0');
  for (let it = 0; it < 4; it++) {
    for (const k of keys) {
      const p = P[k];
      let dx = p[0] - cx, dy = p[1] - cy, d = Math.hypot(dx, dy);
      if (d < S * 1.25) { if (d < 1) { dx = p[0] < view.w / 2 ? -1 : 1; dy = 0; d = 1; } p[0] = cx + (dx / d) * S * 1.25; p[1] = cy + (dy / d) * S * 1.25; }
      for (const j of keys) {
        if (j === k) continue;
        const q = P[j];
        let ex = p[0] - q[0], ey = p[1] - q[1], e = Math.hypot(ex, ey);
        if (e < S * 0.9) { if (e < 1) { ex = 1; ey = 0; e = 1; } const push = (S * 0.9 - e) / 2; p[0] += (ex / e) * push; p[1] += (ey / e) * push; q[0] -= (ex / e) * push; q[1] -= (ey / e) * push; }
      }
    }
  }
  for (const k of keys) { const [u, v] = view.uv(P[k][0], P[k][1]); spots[k] = [clamp(u, 0.06, 0.94), clamp(v, 0.06, 0.94)]; }
  return spots;
}

const without = (spots, ...keys) => { const o = { ...spots }; for (const k of keys) delete o[k]; return o; };
const live = (tok) => tok === token;
const tag = (t) => { window.__jankCtx = t; };

// ------------------------------------------------------------------ your possession
// The carrier carries the ball to the start spot while the team jogs into shape.
async function beginPossession(prog, pressure, carrier = 'y1') {
  const tok = token;
  if (s.clock >= s.end) { fullTime(); return; }
  s.mode = 'atk'; s.def = null; s.offers = []; s.picked = -1;
  s.prog = prog; s.pressure = pressure; s.xg = 0; s.chain = 0; s.carrier = carrier;
  s.stats.you.poss++;
  busy = true;
  render();
  tag('setup');
  const c = view.at(carrier);
  const bu = carrier === 'y0' ? 0.5 : clamp(c.u, 0.2, 0.8), bv = carrier === 'y0' ? 0.93 : vOf(prog);
  view.pressureTarget = s.pressure / 100;
  const [x, y] = view.px(bu, bv);
  const dur = clamp(Math.hypot(x - c.x, y - c.y) / 240, 0.3, 1.1);
  await Promise.all([view.runTo(carrier, bu, bv, dur), view.moveAll(layoutAttack(bu, bv), Math.max(0.45, dur))]);
  if (!live(tok)) return;
  makeOffers();
  busy = false;
  render();
}

async function choose(i) {
  if (busy || s.mode !== 'atk') return;
  const o = s.offers[i];
  if (!o) return;
  busy = true;
  s.picked = i;
  const tok = token;
  sfx.card();
  view.clearLabels();
  render();
  const T = TYPES[o.type];
  const from = s.carrier;
  const lost = Math.random() < o.risk;
  const [u, v] = o.spot;
  if (o.type === 'takeon') {
    const d = nearestOpp(view.at(from));
    tag('takeon');
    if (lost) {
      sfx.whoosh();
      await view.tackleRun(from, u, v, d);
      if (!live(tok)) return;
      contactFx(d, 'TACKLED', o.risk);
      log(`${nm(from)} tries to beat ${nm(d)} — <b>tackled.</b> Risk was ${pct(o.risk)} at 🔥${Math.round(s.pressure)}.`, 'bad');
      await view.pokeAndCollect(d, from);
      if (!live(tok)) return;
      return turnover(d);
    }
    sfx.whoosh();
    await view.beat(from, d, u, v);
    if (!live(tok)) return;
    view.pose(d, 'idle');
  } else if (lost) {
    const fa = view.at(from), [tx, ty] = view.px(u, v);
    const d = nearestOpp({ x: (fa.x + tx) / 2, y: (fa.y + ty) / 2 });
    tag('intercept');
    await view.intercept(from, o.to, u, v, d, { lofted: T.lofted, onKick: () => sfx.kick() });
    if (!live(tok)) return;
    contactFx(d, 'INTERCEPTED', o.risk);
    log(`${T.name} ${nm(from)} → ${nm(o.to)} had ${pct(o.risk)} risk at 🔥${Math.round(s.pressure)} — <b>${nm(d)} intercepts.</b>`, 'bad');
    await view.wait(0.35);
    if (!live(tok)) return;
    view.pose(d, 'idle');
    return turnover(d);
  } else {
    tag('pass');
    await view.pass(from, o.to, u, v, { lofted: T.lofted, onKick: () => sfx.kick() });
    if (!live(tok)) return;
  }
  // success: the ball has arrived, now the numbers move
  s.clock += s.per;
  s.carrier = o.to;
  s.prog = o.progAfter;
  s.pressure = clamp(s.pressure + o.press, 0, 100);
  s.xg = Math.max(0, s.xg + o.gain);
  s.chain++;
  let bonus = '';
  if (s.chain === 5) {
    s.xg += CHAIN_BONUS;
    bonus = ` <b>5-pass chain! +${CHAIN_BONUS.toFixed(2)} xG.</b>`;
    sfx.perfect();
    view.labelOn(s.carrier, 'TIKI-TAKA! +0.08', '#FFD23F', 1.4);
    pulse('#xgbar');
  } else {
    sfx.pass();
    const xgTxt = `${o.gain >= 0 ? '+' : ''}${o.gain.toFixed(2)} xG`;
    view.labelOn(s.carrier, o.type === 'takeon' ? `SKINNED! ${xgTxt}` : xgTxt, o.type === 'takeon' ? '#FFD23F' : o.gain >= 0 ? '#8ef58e' : '#ccc', 1);
  }
  log(`${T.icon} ${T.name}${o.type === 'takeon' ? ` by ${nm(from)}` : ` ${nm(from)} → ${nm(o.to)}`} (${pct(o.risk)} risk) ✓ xG ${s.xg.toFixed(2)}, 🔥${Math.round(s.pressure)}.${bonus}`, 'good');
  const c = view.at(s.carrier);
  view.pressureTarget = s.pressure / 100;
  tag('shape');
  view.moveAll(layoutAttack(c.u, c.v), 0.5);
  makeOffers();
  s.picked = -1;
  busy = false;
  render();
}

function nearestOpp(p) {
  let best = 'o3', bd = 1e9;
  for (const key of ['o1', 'o2', 'o3', 'o4']) { const b = view.at(key); const d = Math.hypot(p.x - b.x, p.y - b.y); if (d < bd) { bd = d; best = key; } }
  return best;
}
function nearestMine(k) {
  const p = view.at(k);
  let best = 'y2', bd = 1e9;
  for (const key of ['y1', 'y2', 'y3', 'y4']) { const b = view.at(key); const d = Math.hypot(p.x - b.x, p.y - b.y); if (d < bd) { bd = d; best = key; } }
  return best;
}

// Played on the contact frame: the sound, the freeze and the label all land together.
function contactFx(k, text, risk) {
  sfx.thud();
  view.hitstop = 0.16;
  shell.shake(stage.querySelector('.pitchwrap'));
  view.labelOn(k, risk != null ? `${text} · ${pct(risk)}` : text, '#FF8A3D', 1.2);
}

async function turnover(dKey) {
  const tok = token;
  s.stats.you.lost++;
  s.clock += s.per;
  const lostXg = s.xg;
  if (lostXg > 0.05) shell.toast(`Turnover — ${lostXg.toFixed(2)} xG gone.`);
  sfx.groan();
  const lostProg = s.prog;
  s.xg = 0; s.chain = 0;
  render();
  await view.wait(0.25);
  if (!live(tok)) return;
  view.pose(dKey, 'idle');
  for (const k of ['y1', 'y2', 'y3', 'y4']) view.pose(k, 'idle');
  await rivalPossession({ counter: true, carrier: dKey, lostProg });
}

function reroll() {
  if (busy || s.mode !== 'atk' || s.rerolls <= 0) return;
  s.rerolls--;
  sfx.deal();
  makeOffers();
  log(`↻ Coach shout: new options (${s.rerolls} left).`, 'info');
  render();
}

async function shoot() {
  if (busy || s.mode !== 'atk') return;
  if (s.carrier === 'y0') { shell.toast('Wak won\'t shoot from his own box. Pass first.'); return; }
  busy = true;
  const tok = token;
  const sc = shotChance();
  s.stats.you.shots++; s.stats.you.xg += sc.p;
  render();
  if (named && ch(s.carrier).id === 'rio' && sc.p > 0.2) await shell.cutIn(byId.rio, 'EAGLE STRIKE');
  if (!live(tok)) return;
  const res = await shotFx(s.carrier, true, sc.p, 'o0');
  if (!live(tok)) return;
  s.clock += 1;
  const why = `${pct(sc.p)} from ${s.xg.toFixed(2)} xG built over ${s.chain} pass${s.chain === 1 ? '' : 'es'}`;
  if (res === 'goal') {
    s.score[0]++;
    log(`⚽ <b>GOAL!</b> ${nm(s.carrier)} scores (${why}). ${s.score[0]}–${s.score[1]}.`, 'goal');
    await goalJuice(true, s.carrier);
    if (!live(tok)) return;
    await rivalPossession({ counter: false, kickoff: true });
  } else {
    log(`🥅 ${nm(s.carrier)} shoots (${why}) — ${res === 'save' ? 'Oskar saves' : 'wide'}.`, 'bad');
    if (!live(tok)) return;
    await rivalPossession({ counter: false, carrier: 'o0' });
  }
}

// ------------------------------------------------------------------ rival possession
async function rivalPossession(o) {
  const tok = token;
  if (s.clock >= s.end) { fullTime(); return; }
  s.mode = 'def';
  busy = true;
  s.offers = []; s.def = null;
  s.xg = 0; s.chain = 0; s.pressure = 0;
  view.pressureTarget = 0;
  const shooter = Math.random() < 0.6 ? 'o4' : 'o3';
  let carrier = o.carrier || 'o3';
  render();
  if (o.kickoff) {
    // covered cut: the ball is in the net, kick-off happens off-screen
    carrier = 'o3';
    tag('kickoff');
    await view.cut(() => {
      view.placeNow({ ...layoutDefend('o3', 0.5, 0.5), o3: [0.5, 0.5] });
      view.holdNow('o3');
    });
    if (!live(tok)) return;
    sfx.whistle(1);
  }
  let base;
  if (o.counter) base = 0.13 + (1 - clamp(o.lostProg, 0, 1)) * 0.17;
  else base = rand(0.08, 0.2);
  // named stats: shooter vs keeper
  const sh = ch(shooter);
  base *= (0.7 + sh.stats.shoot * 0.04) * (1.15 - byId.wak.stats.keep * 0.03);
  base = clamp(base, 0.04, 0.5);
  // build-up: 1–2 passes downfield, the shape shifts after each
  tag('rival');
  const c0 = view.at(carrier);
  view.moveAll(layoutDefend(carrier, c0.u, c0.v), 0.55);
  await view.wait(o.counter ? 0.35 : 0.55);
  const stops = o.counter ? [[rand(0.3, 0.7), 0.62]] : [[rand(0.25, 0.75), 0.48], [rand(0.3, 0.7), 0.64]];
  let cur = carrier;
  const passOn = async (next, u, v) => {
    await view.pass(cur, next, u, v, { onKick: () => sfx.pass() });
    cur = next;
    view.moveAll(layoutDefend(cur, u, v), 0.5);
    await view.wait(0.25);
  };
  for (const [u, v] of stops) {
    if (!live(tok)) return;
    const next = cur === shooter ? (shooter === 'o4' ? 'o3' : 'o4') : shooter;
    await passOn(next, u, v);
  }
  if (!live(tok)) return;
  if (cur !== shooter) await passOn(shooter, 0.5, 0.66);
  if (!live(tok)) return;
  // one defensive call
  const opts = defOptions(o.counter, base);
  s.def = { opts, base, shooter, counter: o.counter };
  log(o.counter ? `⚡ Redrock counter! ${nm(shooter)} is through — base chance ${pct(base)}. Make a call.` : `Redrock attack. ${nm(shooter)} lines up a chance (${pct(base)}). Make a call.`, 'them');
  busy = false;
  render();
}

function defOptions(counter, base) {
  const out = [];
  if (counter && s.yellows < 2) out.push({ id: 'foul', name: 'Tactical Foul', icon: '🟨', text: 'Stop the counter. Costs a yellow (2 max).', goal: 0.05, win: 0, next: [0.1, 0] });
  out.push({ id: 'press', name: 'Press', icon: '🦶', text: 'Win it back high, or get carved open.', win: counter ? 0.25 : 0.35, goal: Math.min(0.75, base * 1.5), next: [0.55, 15] });
  out.push({ id: 'hold', name: 'Hold Shape', icon: '🛡️', text: 'Stay compact. Normal chance.', win: 0, goal: base, next: [0.15, 0] });
  if (!counter || out.length < 3) out.push({ id: 'deep', name: 'Deep Block', icon: '🧱', text: 'Drop deep: their chance drops. You restart under pressure.', win: 0, goal: base * 0.55, next: [0.02, 18] });
  return out;
}

async function defend(i) {
  if (busy || s.mode !== 'def' || !s.def) return;
  const d = s.def;
  const opt = d.opts[i];
  if (!opt) return;
  busy = true;
  s.picked = i;
  const tok = token;
  sfx.card();
  view.clearLabels();
  render();
  const sk = d.shooter;
  const nextProg = opt.next[0], nextPress = opt.next[1];
  const mins = rand(d.counter ? 1 : s.theirs[0], d.counter ? 2 : s.theirs[1]) | 0;
  if (opt.id === 'foul' || opt.win > 0) {
    // the nearest Sunbird closes the shooter down, coming in from the ball's
    // side and sliding the last stretch, so both bodies and the ball stay visible
    const m = nearestMine(sk), a = view.at(sk), me = view.at(m);
    const face = -a.facing;
    const [bx, by] = [view.ball.x, view.ball.y];
    const [sx, sy] = view.standFor(m, bx - face * view.size * 0.06, by, face);
    const rs = view.runSecs(m, sx, sy, 0.4, 320);
    const slideIn = { face, lastPose: 'slide', lastDur: 0.18, endPose: 'slide' };
    view.clearSpot(bx, by, view.size * 0.95, [m, sk], rs);
    tag('press');
    if (opt.id === 'foul') {
      await view.runToPx(m, sx, sy, rs, slideIn);
      if (!live(tok)) return;
      view.pose(m, 'slide', face); view.pose(sk, 'sad'); view.contact();
      s.yellows++;
      sfx.thud(); sfx.whistle(1); view.hitstop = 0.15;
      view.labelOn(m, `YELLOW ${s.yellows}/2`, '#FFD23F', 1.2);
      log(`🟨 ${nm(m)} brings down ${nm(sk)}. Yellow card ${s.yellows}/2. Free kick (${pct(opt.goal)}).`, 'info');
      await view.wait(0.8);
      if (!live(tok)) return;
      // the fouler gets up and steps back for the free kick
      view.pose(m, 'ready');
      await view.wait(0.15);
      if (!live(tok)) return;
      view.pose(sk, 'idle');
      await view.runTo(m, me.u + (face > 0 ? -0.06 : 0.06), me.v + 0.08, 0.4);
      if (!live(tok)) return;
    } else if (Math.random() < opt.win) {
      await view.runToPx(m, sx, sy, rs, slideIn);
      if (!live(tok)) return;
      view.pose(m, 'slide', face); view.pose(sk, 'sad'); view.contact();
      contactFx(m, 'PRESS WON', opt.win);
      log(`🦶 ${nm(m)} presses ${nm(sk)} (${pct(opt.win)}) — <b>won it high!</b> Break on.`, 'good');
      await view.pokeAndCollect(m, sk);
      if (!live(tok)) return;
      await view.wait(0.3);
      if (!live(tok)) return;
      view.pose(sk, 'idle');
      s.clock += mins;
      beginPossession(nextProg, nextPress, m);
      return;
    } else {
      sfx.whoosh();
      await view.beat(sk, m, clamp(a.u + (a.u < 0.5 ? 0.08 : -0.08), 0.15, 0.85), clamp(a.v + 0.06, 0.1, 0.8));
      if (!live(tok)) return;
      view.labelOn(m, `PRESS BEATEN · ${pct(opt.win)}`, '#FF8A80', 1.2);
      log(`🦶 Press on ${nm(sk)} fails (${pct(opt.win)} to win it) — they're through, now ${pct(opt.goal)}.`, 'bad');
      await view.wait(0.35);
      if (!live(tok)) return;
      view.pose(m, 'idle');
    }
  } else if (opt.id === 'deep') {
    // the back line drops in front of goal first: that is why the chance is lower
    tag('deep');
    const a = view.at(sk);
    await view.moveAll({ y1: [0.36, 0.86], y3: [0.64, 0.86], y2: [clamp(a.u, 0.3, 0.7), clamp(a.v + 0.12, 0.5, 0.88)] }, 0.45);
    if (!live(tok)) return;
  }
  const p = opt.goal;
  s.stats.opp.shots++; s.stats.opp.xg += p;
  const res = await shotFx(sk, false, p, 'y0', `${opt.name} `);
  if (!live(tok)) return;
  s.clock += mins;
  if (res === 'goal') {
    s.score[1]++;
    log(`⚽ <b>Redrock score.</b> ${nm(sk)} (${pct(p)} after "${opt.name}"). ${s.score[0]}–${s.score[1]}.`, 'goal');
    await goalJuice(false, sk);
    if (!live(tok)) return;
    if (s.clock >= s.end) { fullTime(); return; }
    // covered cut to your kick-off
    tag('kickoff');
    s.carrier = 'y4';
    await view.cut(() => {
      view.placeNow({ ...layoutAttack(0.5, 0.5), y4: [0.5, 0.5] });
      view.holdNow('y4');
    });
    if (!live(tok)) return;
    sfx.whistle(1);
    beginPossession(0.45, 0, 'y4');
    return;
  }
  log(`${nm(sk)} shoots (${pct(p)} after "${opt.name}") — ${res === 'save' ? 'Wak saves!' : 'wide.'}`, 'good');
  beginPossession(Math.max(0, nextProg - 0.1), nextPress, 'y0');
}

// ------------------------------------------------------------------ juice
// One shot. The result is rolled first so the keeper and the ball can be sent
// to the same point with the same arrival time. Resolves after the contact
// (and, for a save or a miss, once the keeper has the ball back in hand).
async function shotFx(k, top, p, gkKey, why = '') {
  const tok = token;
  const roll = Math.random();
  const result = roll < p ? 'goal' : roll < p + (1 - p) * 0.55 ? 'save' : 'miss';
  const gk = view.at(gkKey);
  const [gx, gy] = view.pitch.goalMouth(top);
  const gw = view.pitch.goalW, nd = view.pitch.netDepth, sz = view.size;
  const into = top ? -1 : 1; // direction from the pitch into the net
  const side = Math.random() < 0.5 ? -1 : 1;
  const aim = side * (0.18 + Math.random() * 0.22);
  let ex, ey;
  if (result === 'goal') { ex = gx + aim * gw; ey = gy + into * nd * 0.6; }
  else if (result === 'save') { ex = gx + aim * gw * 0.85; ey = gy - into * 6; }
  else { ex = gx + side * gw * (0.6 + Math.random() * 0.15); ey = gy + into * 7; } // just past the post, clear of the corner overlays
  // The ball's path is fixed first; the keeper's end point is placed from it.
  const bx0 = view.ball.x, by0 = view.ball.y;
  const pathX = (y) => bx0 + (ex - bx0) * clamp((y - by0) / ((ey - by0) || 1), 0, 1);
  const T = clamp(Math.hypot(ex - bx0, ey - by0) / 430, 0.4, 0.62);
  const react = 0.1;
  // The dive sprite lies head-first towards -facing; feet at (kx, ky), gloves
  // ~0.9 size from the feet in the dive direction.
  let kx, ky = gk.y, ddir, kpose = 'dive';
  const xp = pathX(gk.y), toBall = Math.sign(xp - gk.x) || side;
  const daylight = sz * 0.5; // more than a ball's width between path and gloves
  if (result === 'save') { ddir = Math.sign(ex - gk.x) || side; kx = ex - ddir * sz * 0.72; ky = ey + 2; }
  else if (result === 'goal') {
    const short = xp - toBall * (sz * 0.9 + daylight);           // right way, beaten by the reach
    if ((short - gk.x) * toBall > sz * 0.15 && Math.random() < 0.5) { ddir = toBall; kx = short; }
    else { ddir = -toBall; kx = xp - toBall * Math.max(sz * 0.3 + daylight, Math.abs(xp - gk.x) + gw * 0.18); } // wrong way
  } else { ddir = toBall; kx = gk.x + toBall * sz * 0.25; kpose = 'ready'; }
  kx = clamp(kx, 10, view.w - 10);
  tag('shot');
  view.clearLabels();
  view.kickPose(k, 'kick');
  sfx.kick();
  const ball = view.ballTo(ex, ey, T, result === 'miss' ? 20 : 9);
  await view.wait(react);
  if (!live(tok)) return result;
  const dive = kpose === 'dive' ? view.dive(gkKey, kx, ky, T - react, -ddir) : view.runToPx(gkKey, kx, ky, T - react, { pose: 'ready', endPose: 'ready', face: ddir });
  await Promise.all([ball, dive]);
  if (!live(tok)) return result;
  const home = top ? [0.5, 0.05] : [0.5, 0.95];
  if (result === 'save') {
    // the ball stops in his hands; he gets up and gathers it at his feet
    sfx.save();
    view.hitstop = 0.14;
    view.label(`SAVED · ${why}${pct(p)}`, ex, top ? gk.y + sz * 0.9 : gk.y - sz, '#9BE7FF', 1.3); // below the top keeper, clear of the corner badges
    await view.getUp(gkKey);
    if (!live(tok)) return result;
    tag('keeper');
    const [sx, sy] = view.standFor(gkKey, ex, ey, ddir);
    await view.runToPx(gkKey, sx, sy, 0.22, { face: ddir });
    if (!live(tok)) return result;
    view.hold(gkKey);
    await view.runTo(gkKey, home[0], home[1], 0.5, { pose: 'run' });
  } else if (result === 'miss') {
    sfx.ooh();
    view.label(`WIDE · ${why}${pct(p)}`, ex, ey - into * 34, '#fff', 1.3);
    await view.wait(0.5);
    if (!live(tok)) return result;
    // the keeper fetches it
    tag('keeper');
    const f = ex > gk.x ? 1 : -1;
    const [sx, sy] = view.standFor(gkKey, ex, ey, f);
    await view.runToPx(gkKey, sx, sy, view.runSecs(gkKey, sx, sy, 0.3, 260), { face: f });
    if (!live(tok)) return result;
    view.hold(gkKey);
    await view.runTo(gkKey, home[0], home[1], 0.45);
  } else if (result === 'goal') view.getUp(gkKey, 'sad'); // stays down through the goal frame
  return result;
}

async function goalJuice(you, k) {
  view.pitch.goal(you);
  sfx.goal();
  view.hitstop = 0.25;
  shell.flash(you ? '#FFD23F' : '#E8463A');
  shell.shake(stage.querySelector('.pitchwrap'));
  shell.banner(you ? 'GOAL!' : 'Redrock score', `${nm(k)} · ${clockStr()}`, you ? undefined : '#FF8A80');
  if (you) shell.confetti(); else sfx.groan();
  // the beaten keeper is still on the ground; he gets up on his own (shotFx)
  for (const key of view.actors.keys()) if (key !== (you ? 'o0' : 'y0')) view.pose(key, (key[0] === 'y') === you ? 'celebrate' : 'sad');
  render();
  await view.wait(1.8);
  for (const key of view.actors.keys()) view.pose(key, 'idle');
}

function pulse(sel) {
  const el = stage.querySelector(sel);
  if (!el) return;
  el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
}

async function fullTime() {
  s.mode = 'over'; busy = true;
  sfx.whistle(3);
  const [a, b] = s.score;
  const res = a > b ? 'WIN' : a === b ? 'DRAW' : 'LOSS';
  shell.banner('FULL TIME', `${a}–${b}`);
  log(`Full time: Sunbirds ${a}–${b} Redrock. Shot xG ${s.stats.you.xg.toFixed(2)} vs ${s.stats.opp.xg.toFixed(2)}.`, 'info');
  render();
  await view.wait(1.5);
  if (a > b) { sfx.win(); shell.confetti(); } else if (a < b) sfx.lose();
  const order = ['early', 'mid', 'clutch'];
  const next = order[(order.indexOf(s.phase) + 1) % 3];
  const st = s.stats;
  const v = await shell.modal({
    title: `${res === 'WIN' ? '🏆 ' : ''}${res} · ${a}–${b}`,
    html: `<table class="ftstats"><tr><th></th><th>Sunbirds</th><th>Redrock</th></tr>
      <tr><td>Shots</td><td>${st.you.shots}</td><td>${st.opp.shots}</td></tr>
      <tr><td>Shot xG</td><td>${st.you.xg.toFixed(2)}</td><td>${st.opp.xg.toFixed(2)}</td></tr>
      <tr><td>Possessions</td><td>${st.you.poss}</td><td>—</td></tr>
      <tr><td>Lost the ball</td><td>${st.you.lost}</td><td>—</td></tr></table>`,
    buttons: [{ label: 'Play again', value: 'again' }, { label: `Next: ${shell.o.phases.find((p) => p.id === next).label}`, cls: 'paper', value: 'next' }],
  });
  if (v === 'again') shell.setPhase(s.phase);
  else if (v === 'next') shell.setPhase(next);
}

// ------------------------------------------------------------------ render
function render() {
  if (!s || !view) return;
  shell.setScore({ home: s.score[0], away: s.score[1], clock: clockStr() });
  const last = s.clock >= s.end - 0.01;
  stage.querySelector('#badge').innerHTML = s.mode === 'atk' ? `⚽ Your ball${last ? ' · <b>last attack</b>' : ''}` : s.mode === 'def' ? '🛡️ Redrock ball' : 'Full time';
  const nb = stage.querySelector('#named');
  nb.innerHTML = named ? '👤 Named <span class="kbd">N</span>' : '🎲 Plain <span class="kbd">N</span>';
  nb.classList.toggle('on', named);
  // meters
  const sc = s.mode === 'atk' ? shotChance() : { p: 0 };
  stage.querySelector('#xgbar').style.width = `${clamp(s.xg / 0.6, 0, 1) * 100}%`;
  stage.querySelector('#xgv').textContent = s.xg.toFixed(2);
  stage.querySelector('#prbar').style.width = `${s.mode === 'atk' ? s.pressure : 0}%`;
  stage.querySelector('#prbar').style.background = `linear-gradient(90deg, #ffb74d, ${s.pressure > 60 ? '#e8463a' : '#ff8a65'})`;
  stage.querySelector('#prv').textContent = s.mode === 'atk' ? Math.round(s.pressure) : '–';
  stage.querySelector('#chain').innerHTML = Array.from({ length: 5 }, (_, i) => `<span class="pip ${i < s.chain ? 'on' : ''} ${s.chain >= 5 ? 'gold' : ''}"></span>`).join('') + `<span class="cl">${s.chain >= 5 ? 'chain ✓' : '5-chain +0.08'}</span>`;
  // offers / defensive calls
  const el = stage.querySelector('#offers');
  if (s.mode === 'atk') {
    el.innerHTML = s.offers.length ? s.offers.map((o, i) => offerHTML(o, i)).join('') : '<div class="waiting">Getting into shape…</div>';
    el.querySelectorAll('.gcard').forEach((g) => { g.onclick = () => choose(+g.dataset.i); });
  } else if (s.mode === 'def' && s.def) {
    el.innerHTML = s.def.opts.map((o, i) => defHTML(o, i)).join('');
    el.querySelectorAll('.gcard').forEach((g) => { g.onclick = () => defend(+g.dataset.i); });
  } else el.innerHTML = `<div class="waiting">${s.mode === 'def' ? 'Redrock on the ball… get ready to defend.' : s.mode === 'over' ? 'Full time.' : ''}</div>`;
  el.classList.toggle('busy', busy);
  el.querySelectorAll('.gcard').forEach((g) => g.classList.toggle('sel', busy && +g.dataset.i === s.picked));
  const shootB = stage.querySelector('#shoot');
  shootB.innerHTML = s.mode !== 'atk' ? (s.mode === 'def' ? '🛡️ Defending' : 'Full time') : s.carrier === 'y0' ? 'Keeper has it · pass first' : `Shoot ${oddsPill(sc.p)} <span class="key">S</span>`;
  shootB.disabled = busy || s.mode !== 'atk' || s.carrier === 'y0';
  shootB.classList.toggle('low', s.mode === 'atk' && sc.p < 0.1);
  const rr = stage.querySelector('#reroll');
  rr.innerHTML = `↻ ${s.rerolls} <span class="key">R</span>`;
  rr.disabled = busy || s.mode !== 'atk' || s.rerolls <= 0;
}

function riskCls(r) { return r <= 0.12 ? 'hi' : r <= 0.25 ? 'mid' : r <= 0.4 ? 'lo' : 'vlo'; }

function offerHTML(o, i) {
  const T = TYPES[o.type];
  const who = ch(o.to);
  const art = named ? `<div class="art" style="background-image:url(${portrait(who, 104)})"><span class="tico">${T.icon}</span></div>` : `<div class="art tac">${T.icon}</div>`;
  const tag = o.type === 'takeon' ? (named ? `${nm(s.carrier)} dribbles` : 'Dribble') : named ? `${nm(s.carrier)} → ${who.name}` : o.to === 'y0' ? 'Back to keeper' : 'Pass';
  const press = o.press;
  const modLine = named && o.mods.length ? `<div class="mods">${o.mods.join(' · ')}${Math.abs(o.risk - o.baseRisk) > 0.005 ? ` · was ${pct(o.baseRisk)}` : ''}</div>` : '';
  return `<div class="gcard opt" style="--cc:${oddsColor(1 - o.risk)}" data-i="${i}" tabindex="0">
    <div class="cost">${i + 1}</div><div class="name">${T.name}</div>${art}
    <span class="riskp ${riskCls(o.risk)}">${pct(o.risk)} risk</span>
    <div class="type">${tag}</div>
    <div class="text"><span class="gain ${o.gain < 0 ? 'neg' : ''}" title="${o.gain >= 0 ? '+' : ''}${o.gain.toFixed(2)} xG">⚽${o.shotAfter == null ? '–' : pct(o.shotAfter)}</span> <span class="pr ${press < 0 ? 'cool' : ''}">🔥${press >= 0 ? '+' : ''}${press}</span></div>${modLine}</div>`;
}

function defHTML(o, i) {
  return `<div class="gcard opt def" style="--cc:#a5d6a7" data-i="${i}" tabindex="0">
    <div class="cost">${i + 1}</div><div class="name">${o.name}</div><div class="art tac">${o.icon}</div>
    <div class="type">${o.win ? `Win back ${pct(o.win)}` : 'Defensive call'}</div>
    <div class="text">${o.text}</div>
    <div class="theirs">Their goal <span class="odds ${o.goal < 0.12 ? 'hi' : o.goal < 0.22 ? 'mid' : o.goal < 0.35 ? 'lo' : 'vlo'}">${pct(o.goal)}</span>${o.win ? '<small> if not won</small>' : ''}</div></div>`;
}

// preview arrows for the three options; numbered markers are placed clear of
// every sprite (and of each other) so they never sit on a head
function markerSpot(x, y, taken) {
  const S = view.size;
  const bodies = [...view.actors.values()].map((a) => [a.x, a.y - S * 0.5]);
  const cands = [[x, y - 6], [x, y + 12], [x - S * 0.7, y - S * 0.5], [x + S * 0.7, y - S * 0.5], [x, y - S * 1.25], [x - S * 0.75, y + 8], [x + S * 0.75, y + 8]];
  let best = cands[0], bestD = -1;
  for (const [cx, cy] of cands) {
    if (cx < 12 || cx > view.w - 12 || cy < 12 || cy > view.h - 12) continue;
    const d = Math.min(...bodies.map(([bx, by]) => Math.hypot((cx - bx) * 1.15, (cy - by) * 0.75)), ...taken.map(([tx, ty]) => Math.hypot(cx - tx, cy - ty) * 0.8));
    if (d > S * 0.55) return [cx, cy];
    if (d > bestD) { bestD = d; best = [cx, cy]; }
  }
  return best;
}
function drawOver(ctx, t) {
  if (!s || s.mode !== 'atk' || busy) return;
  const c = view.at(s.carrier);
  if (!c || view.sceneAlpha < 1) return;
  const taken = [];
  s.offers.forEach((o, i) => {
    const [x1, y1] = view.px(o.spot[0], o.spot[1]);
    ctx.save();
    ctx.globalAlpha = 0.85;
    drawArrow(ctx, c.x, c.y - 6, x1, y1 - 6, oddsColor(1 - o.risk), { dash: o.type === 'takeon' ? [3, 4] : TYPES[o.type].lofted ? [7, 4] : null, width: 2.5, curve: TYPES[o.type].lofted ? 26 : 0 });
    ctx.restore();
    const [mx, my] = markerSpot(x1, y1, taken);
    taken.push([mx, my]);
    ctx.save();
    const r = 9 + Math.sin(t * 5 + i) * 0.8;
    ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2);
    ctx.fillStyle = oddsColor(1 - o.risk); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#1b1b2f'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '13px "Lilita One", system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), mx, my + 0.5);
    ctx.restore();
  });
}

// ------------------------------------------------------------------ input
document.addEventListener('keydown', (e) => {
  if (!s || document.querySelector('.sheet-wrap') || e.altKey || e.metaKey || e.ctrlKey) return;
  const k = e.key.toLowerCase();
  if (k >= '1' && k <= '4') { if (s.mode === 'atk') choose(+k - 1); else defend(+k - 1); }
  else if (k === 's') shoot();
  else if (k === 'r') reroll();
  else if (k === 'n') toggleNamed();
});

window.pushLuck = { get s() { return s; }, get busy() { return busy; }, get view() { return view; } };
