// Push Your Luck: every possession is a Can't Stop run. Each pass builds xG
// but adds pressure, and pressure makes every next pass riskier. Shoot to
// cash the xG in — or lose it all to a turnover and face a counter.

import { Shell, oddsPill, shuffle, pick, clamp, rand } from '../../shared/shell.js';
import { portrait, drawArrow, oddsColor, roundRect } from '../../shared/art.js';
import { sfx } from '../../shared/sfx.js';
import { byId, LINEUP5 } from '../../shared/cast.js';
import { PossView } from './view.js';

const shell = new Shell({
  id: 'push-luck',
  title: 'Push Your Luck',
  pitch: 'Every pass builds your chance and the pressure. Shoot now, or risk one more pass?',
  how: [
    'On the ball you get 3 pass options. Each shows its turnover risk and the xG it adds.',
    'Every action raises 🔥 pressure, and pressure raises the risk of every pass. Recycle and Switch cool it down.',
    'Shoot any time: your goal chance is the xG you have built. String 5 passes for a +0.08 bonus.',
    'Lose the ball and the xG is gone. Redrock counter, and you pick one defensive call.',
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
  recycle: { name: 'Recycle', icon: '🔄', risk: 0.03, xg: -0.01, prog: -0.12, press: -24, stat: 'pass', text: 'Go back. Pressure drops.' },
  prog:    { name: 'Progressive', icon: '⬆️', risk: 0.12, xg: 0.035, prog: 0.14, press: 12, stat: 'pass', text: 'Into the next line.' },
  breaker: { name: 'Line-breaker', icon: '⚡', risk: 0.23, xg: 0.085, prog: 0.24, press: 16, stat: 'pass', text: 'Split the defence.' },
  switch:  { name: 'Switch', icon: '🔀', risk: 0.12, xg: 0.02, prog: 0.03, press: -14, stat: 'pass', lofted: true, text: 'Change flank. Pressure eases.' },
  takeon:  { name: 'Take-on', icon: '💨', risk: 0.26, xg: 0.06, prog: 0.12, press: 6, stat: 'dribble', text: 'Beat your man.' },
};
const CHAIN_BONUS = 0.08;
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
    mode: 'atk', carrier: 'y1', prog: P.prog, pressure: P.pressure, xg: 0, chain: 0, offers: [], def: null, yellows: 0,
    startProg: P.prog, startPressure: P.pressure,
    stats: { you: { xg: 0, shots: 0, poss: 0, lost: 0 }, opp: { xg: 0, shots: 0 } },
  };
  buildScreen();
  log(id === 'clutch' ? 'Stoppage time. One goal down. Redrock have parked the bus — pressure starts high.' : id === 'mid' ? 'Second half, all square. You have 3 rerolls.' : 'Kick-off. Sunbirds have the ball.', 'info');
  beginPossession(P.prog, P.pressure, id === 'clutch' ? 'y2' : 'y1');
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
  if (s.mode === 'atk' && !busy) s.offers = s.offers.map((o) => buildOffer(o.type, o.to));
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
    if (T.stat === 'dribble') { mult *= 1.5 - c.stats.dribble * 0.09; mods.push(`${c.name} dribble ${c.stats.dribble}`); }
    else { mult *= 1.3 - c.stats.pass * 0.05; mods.push(`${c.name} pass ${c.stats.pass}`); }
    if (type === 'breaker' && c.id === 'kenji') { mult *= 0.6; mods.push('Needle −40%'); }
    if (type === 'takeon' && c.id === 'pip') { mult *= 0.6; mods.push('Pinball −40%'); }
  }
  return { p: clamp(base * mult, 0.02, 0.85), base: clamp(base, 0.02, 0.85), mods };
}

function shotChance() {
  let p = s.xg + 0.02;
  const mods = [];
  if (named) {
    const c = ch(s.carrier);
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
  if (type === 'recycle') return s.prog < 0.25 && Math.random() < 0.5 ? 'y0' : pick(outfield.filter((k) => k !== 'y4')) || pick(outfield);
  if (type === 'breaker' || type === 'prog') return Math.random() < 0.6 && s.carrier !== 'y4' ? 'y4' : pick(outfield);
  return pick(outfield);
}

function buildOffer(type, to) {
  const T = TYPES[type];
  to = to || receiverFor(type);
  const progAfter = clamp(s.prog + T.prog, 0, 1);
  const r = riskFor(type, s.carrier, s.carrier, s.prog, s.pressure);
  const bu = view.actors.get(s.carrier)?.u ?? 0.5;
  let u;
  if (type === 'switch') u = bu < 0.5 ? rand(0.72, 0.86) : rand(0.14, 0.28);
  else if (type === 'takeon') u = clamp(bu + rand(-0.12, 0.12), 0.15, 0.85);
  else if (type === 'breaker') u = rand(0.35, 0.65);
  else u = clamp(bu + (Math.random() < 0.5 ? -1 : 1) * rand(0.12, 0.25), 0.12, 0.88);
  const v = to === 'y0' ? 0.9 : vOf(progAfter);
  return { type, to, risk: r.p, baseRisk: r.base, mods: r.mods, gain: xgGain(type, progAfter), progAfter, press: T.press, spot: [u, v] };
}

function makeOffers() {
  const types = shuffle(Object.keys(TYPES));
  // never offer Recycle from deep inside your own half; keep one forward option
  const pool = types.filter((t) => !(t === 'recycle' && s.prog < 0.08));
  s.offers = pool.slice(0, 3).map((t) => buildOffer(t));
}

// ------------------------------------------------------------------ layout
function layoutAttack(snap = false) {
  const c = view.actors.get(s.carrier);
  const bu = c ? c.u : 0.5, bv = c ? c.v : vOf(s.prog);
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
  view.pressure = pf;
  view.place(spots, snap);
}

function layoutDefend(carrierK, bu, bv, snap = false) {
  const spots = {};
  spots.o0 = [0.5, 0.05];
  const others = ['o1', 'o2', 'o3', 'o4'].filter((k) => k !== carrierK);
  const slots = [[bu - 0.28, bv - 0.04], [bu + 0.28, bv - 0.02], [bu + (bu < 0.5 ? 0.18 : -0.18), bv + 0.17], [0.5, bv - 0.24]];
  const order = [...others].sort((a, b) => +b.slice(1) - +a.slice(1));
  order.forEach((k, i) => { const sl = slots[[2, 0, 1, 3][i]]; spots[k] = [clamp(sl[0], 0.08, 0.92), clamp(sl[1], 0.08, 0.9)]; });
  spots[carrierK] = [bu, bv];
  spots.y0 = [0.5 + (bu - 0.5) * 0.2, 0.95];
  const lineV = clamp(bv + 0.14, 0.4, 0.88);
  spots.y1 = [0.32, lineV]; spots.y2 = [0.5 + (bu - 0.5) * 0.4, clamp(bv + 0.06, 0.2, 0.86)]; spots.y3 = [0.68, lineV]; spots.y4 = [0.5, clamp(bv - 0.12, 0.1, 0.7)];
  view.pressure = 0;
  view.place(spots, snap);
}

// ------------------------------------------------------------------ your possession
function beginPossession(prog, pressure, carrier = 'y1') {
  if (s.clock >= s.end) { fullTime(); return; }
  s.mode = 'atk';
  s.prog = prog; s.pressure = pressure; s.xg = 0; s.chain = 0; s.carrier = carrier;
  s.stats.you.poss++;
  const [u] = [0.5 + rand(-0.15, 0.15)];
  view.place({ [carrier]: [u, carrier === 'y0' ? 0.94 : vOf(prog)] }, true);
  view.give(carrier);
  layoutAttack(true);
  makeOffers();
  busy = false;
  render();
}

async function choose(i) {
  if (busy || s.mode !== 'atk') return;
  const o = s.offers[i];
  if (!o) return;
  busy = true;
  const tok = token;
  sfx.card();
  const T = TYPES[o.type];
  const from = s.carrier;
  const lost = Math.random() < o.risk;
  s.clock += s.per;
  render();
  if (o.type === 'takeon') {
    const runner = view.runTo(from, o.spot[0], o.spot[1], 0.45);
    sfx.whoosh();
    await view.wait(0.2);
    if (lost) {
      const d = nearestOpp(from);
      await view.runTo(d, o.spot[0] - 0.03, o.spot[1] - 0.02, 0.22);
      await runner;
      await tackleFx(d, from, `${nm(from)} tries to beat ${nm(d)} — tackled. Risk was ${pct(o.risk)}.`);
      if (tok !== token) return;
      return turnover(d);
    }
    await runner;
    view.labelOn(from, 'SKINNED!', '#FFD23F');
  } else {
    const run = view.runTo(o.to, o.spot[0], o.spot[1], 0.4);
    await view.wait(0.12);
    if (lost) {
      const d = nearestOpp(o.to);
      const [ux, vx] = [(view.actors.get(from).u + o.spot[0]) / 2, (view.actors.get(from).v + o.spot[1]) / 2];
      const cut = view.runTo(d, ux, vx, 0.3);
      await view.passTo(from, d, T.lofted);
      await Promise.all([run, cut]);
      await tackleFx(d, null, `${T.name} ${nm(from)} → ${nm(o.to)} had ${pct(o.risk)} risk at 🔥${Math.round(s.pressure)} — <b>${nm(d)} intercepts.</b>`);
      if (tok !== token) return;
      return turnover(d);
    }
    await run;
    await view.passTo(from, o.to, T.lofted);
  }
  if (tok !== token) return;
  // success
  s.carrier = o.to;
  s.prog = o.progAfter;
  s.pressure = clamp(s.pressure + o.press + 4, 0, 100);
  s.xg = Math.max(0, s.xg + o.gain);
  s.chain++;
  let bonus = '';
  if (s.chain === 5) {
    s.xg += CHAIN_BONUS;
    bonus = ` <b>5-pass chain! +${CHAIN_BONUS.toFixed(2)} xG.</b>`;
    sfx.perfect();
    view.labelOn(s.carrier, 'TIKI-TAKA! +0.08', '#FFD23F', 1.4);
    pulse('#xgbar');
  } else sfx.pass();
  view.labelOn(s.carrier, `${o.gain >= 0 ? '+' : ''}${o.gain.toFixed(2)} xG`, o.gain >= 0 ? '#8ef58e' : '#ccc', 0.9);
  log(`${T.icon} ${T.name}${o.type === 'takeon' ? ` by ${nm(from)}` : ` ${nm(from)} → ${nm(o.to)}`} (${pct(o.risk)} risk) ✓ xG ${s.xg.toFixed(2)}, 🔥${Math.round(s.pressure)}.${bonus}`, 'good');
  layoutAttack();
  makeOffers();
  busy = false;
  render();
}

function nearestOpp(k) {
  const a = view.actors.get(k);
  let best = 'o3', bd = 1e9;
  for (const key of ['o1', 'o2', 'o3', 'o4']) { const b = view.actors.get(key); const d = Math.hypot(a.x - b.x, a.y - b.y); if (d < bd) { bd = d; best = key; } }
  return best;
}

async function tackleFx(d, victim, text) {
  view.pose(d, 'slide');
  if (victim) view.pose(victim, 'sad');
  sfx.thud();
  view.hitstop = 0.18;
  shell.shake(stage.querySelector('.pitchwrap'));
  view.labelOn(d, victim ? 'TACKLE!' : 'INTERCEPTED!', '#FF8A3D');
  view.give(d);
  log(text, 'bad');
  await view.wait(0.55);
  view.pose(d, 'idle'); if (victim) view.pose(victim, 'idle');
}

async function turnover(dKey) {
  s.stats.you.lost++;
  const lostXg = s.xg;
  if (lostXg > 0.05) shell.toast(`Turnover — ${lostXg.toFixed(2)} xG gone.`);
  sfx.groan();
  s.xg = 0; s.chain = 0;
  await rivalPossession({ counter: true, carrier: dKey, lostProg: s.prog });
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
  s.clock += 1;
  s.stats.you.shots++; s.stats.you.xg += sc.p;
  render();
  if (named && ch(s.carrier).id === 'rio' && sc.p > 0.2) await shell.cutIn(byId.rio, 'EAGLE STRIKE');
  const res = await shotFx(s.carrier, true, sc.p, 'o0');
  if (tok !== token) return;
  const why = `${pct(sc.p)} from ${s.xg.toFixed(2)} xG built over ${s.chain} pass${s.chain === 1 ? '' : 'es'}`;
  if (res === 'goal') {
    s.score[0]++;
    log(`⚽ <b>GOAL!</b> ${nm(s.carrier)} scores (${why}). ${s.score[0]}–${s.score[1]}.`, 'goal');
    await goalJuice(true, s.carrier);
    if (tok !== token) return;
    await rivalPossession({ counter: false, kickoff: true });
  } else {
    log(`🥅 ${nm(s.carrier)} shoots (${why}) — ${res === 'save' ? 'Oskar saves' : 'wide'}.`, 'bad');
    await view.wait(0.4);
    if (tok !== token) return;
    await rivalPossession({ counter: false, carrier: 'o0' });
  }
}

// ------------------------------------------------------------------ rival possession
async function rivalPossession(o) {
  const tok = token;
  if (s.clock >= s.end) { fullTime(); return; }
  s.mode = 'def';
  busy = true;
  s.offers = [];
  s.xg = 0; s.chain = 0; s.pressure = 0;
  const shooter = Math.random() < 0.6 ? 'o4' : 'o3';
  let base;
  let carrier = o.carrier || 'o3';
  if (o.kickoff) {
    view.place({ o3: [0.5, 0.48] }, true); carrier = 'o3';
  }
  if (o.counter) base = 0.13 + (1 - clamp(o.lostProg, 0, 1)) * 0.17;
  else base = rand(0.08, 0.2);
  // named stats: shooter vs keeper
  const sh = ch(shooter);
  base *= (0.7 + sh.stats.shoot * 0.04) * (1.15 - byId.wak.stats.keep * 0.03);
  base = clamp(base, 0.04, 0.5);
  render();
  // build-up animation: 1–2 passes downfield
  view.give(carrier);
  const c0 = view.actors.get(carrier);
  layoutDefend(carrier, c0.u, c0.v);
  await view.wait(o.counter ? 0.3 : 0.5);
  const stops = o.counter ? [[rand(0.3, 0.7), 0.62]] : [[rand(0.25, 0.75), 0.48], [rand(0.3, 0.7), 0.64]];
  let cur = carrier;
  for (const [u, v] of stops) {
    if (tok !== token) return;
    const next = cur === shooter ? (shooter === 'o4' ? 'o3' : 'o4') : shooter;
    const run = view.runTo(next, u, v, 0.4);
    await view.passTo(cur, next);
    await run;
    cur = next;
    layoutDefend(cur, u, v);
    await view.wait(0.2);
  }
  if (cur !== shooter) { const run = view.runTo(shooter, 0.5, 0.66, 0.3); await view.passTo(cur, shooter); await run; cur = shooter; layoutDefend(cur, 0.5, 0.66); }
  if (tok !== token) return;
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
  if (!counter || out.length < 3) out.push({ id: 'deep', name: 'Deep Block', icon: '🧱', text: 'Halve their chance. You start deep, under pressure.', win: 0, goal: base * 0.55, next: [0.02, 18] });
  return out;
}

async function defend(i) {
  if (busy || s.mode !== 'def' || !s.def) return;
  const d = s.def;
  const opt = d.opts[i];
  if (!opt) return;
  busy = true;
  const tok = token;
  sfx.card();
  s.def = null;
  s.clock += rand(d.counter ? 1 : s.theirs[0], d.counter ? 2 : s.theirs[1]) | 0;
  render();
  const sk = d.shooter;
  let nextProg = opt.next[0], nextPress = opt.next[1], carrier = 'y1';
  if (opt.id === 'foul') {
    s.yellows++;
    sfx.whistle(1);
    view.pose('y2', 'slide'); view.hitstop = 0.15; sfx.thud();
    view.labelOn(sk, 'YELLOW!', '#FFD23F');
    log(`🟨 Tactical foul on ${nm(sk)}. Yellow card ${s.yellows}/2. Free kick (${pct(opt.goal)}).`, 'info');
    await view.wait(0.6);
  }
  if (opt.win > 0) {
    const won = Math.random() < opt.win;
    const presser = 'y2';
    await view.runTo(presser, view.actors.get(sk).u + 0.04, view.actors.get(sk).v - 0.03, 0.3);
    if (won) {
      view.pose(presser, 'slide'); view.pose(sk, 'sad'); sfx.thud(); view.hitstop = 0.18;
      shell.shake(stage.querySelector('.pitchwrap'));
      view.labelOn(presser, 'WON IT!', '#8ef58e');
      view.give(presser);
      log(`🦶 Kenji presses ${nm(sk)} (${pct(opt.win)}) — <b>won it high!</b> You start in their half.`, 'good');
      await view.wait(0.7);
      if (tok !== token) return;
      view.pose(presser, 'idle'); view.pose(sk, 'idle');
      beginPossession(nextProg, nextPress, presser);
      return;
    }
    view.labelOn(presser, 'SKINNED', '#FF8A80');
    sfx.whoosh();
    log(`🦶 Press on ${nm(sk)} fails (${pct(opt.win)}) — they're through.`, 'bad');
    await view.wait(0.3);
  }
  const p = opt.goal;
  s.stats.opp.shots++; s.stats.opp.xg += p;
  const res = await shotFx(sk, false, p, 'y0');
  if (tok !== token) return;
  if (res === 'goal') {
    s.score[1]++;
    log(`⚽ <b>Redrock score.</b> ${nm(sk)} (${pct(p)} after "${opt.name}"). ${s.score[0]}–${s.score[1]}.`, 'goal');
    await goalJuice(false, sk);
    nextProg = 0.12; nextPress = 0; carrier = 'y4';
    if (tok !== token) return;
    view.place({ y4: [0.5, 0.5] }, true);
    beginPossession(0.45, 0, 'y4');
    return;
  }
  log(`${nm(sk)} shoots (${pct(p)} after "${opt.name}") — ${res === 'save' ? 'Wak saves!' : 'wide.'}`, 'good');
  await view.wait(0.3);
  if (tok !== token) return;
  carrier = res === 'save' ? 'y0' : 'y0';
  beginPossession(Math.max(0, nextProg - 0.1), nextPress, carrier);
}

// ------------------------------------------------------------------ juice
async function shotFx(k, top, p, gkKey) {
  const roll = Math.random();
  const result = roll < p ? 'goal' : roll < p + (1 - p) * 0.55 ? 'save' : 'miss';
  const gk = view.actors.get(gkKey);
  const [gx, gy] = view.pitch.goalMouth(top);
  const gw = view.pitch.goalW, nd = view.pitch.netDepth;
  const aim = (Math.random() < 0.5 ? -1 : 1) * (0.18 + Math.random() * 0.22);
  let tx = gx + aim * gw, ty = gy + (top ? -nd * 0.6 : nd * 0.6);
  if (result === 'miss') { tx = gx + Math.sign(aim) * gw * (0.62 + Math.random() * 0.3); ty = gy + (top ? -14 : 14); }
  const diveDir = Math.sign(tx - gk.x) || 1;
  const gx0 = gk.x;
  view.pose(k, 'kick');
  sfx.kick();
  gk.anim++; gk.pose = 'ready';
  const ex = result === 'save' ? (gx0 + tx) / 2 + diveDir * 6 : tx, ey = result === 'save' ? gy + (top ? 6 : -6) : ty;
  const x0 = view.ball.x, y0 = view.ball.y;
  view.ballFree = true;
  await view.tween(0.5, (q) => {
    view.ball.x = x0 + (ex - x0) * q; view.ball.y = y0 + (ey - y0) * q; view.ball.h = Math.sin(q * Math.PI) * (result === 'miss' ? 22 : 10); view.ball.spin += 0.6;
    if (q > 0.25) { gk.pose = 'dive'; gk.facing = diveDir; gk.x = gx0 + diveDir * gw * 0.3 * Math.min(1, (q - 0.25) / 0.6); }
  });
  view.pose(k, 'idle');
  if (result === 'save') { sfx.save(); view.label('SAVED!', gk.x, gk.y - view.size, '#9BE7FF'); await view.ballTo(ex + diveDir * 22, ey + (top ? 18 : -18), 0.3, 8); }
  else if (result === 'miss') { sfx.ooh(); view.label('WIDE!', tx, ty + (top ? 34 : -34), '#fff'); await view.wait(0.5); }
  gk.anim--; gk.pose = result === 'goal' ? 'sad' : 'idle';
  if (result !== 'goal') { gk.x = gx0; view.give(gkKey); }
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
  for (const key of view.actors.keys()) view.pose(key, (key[0] === 'y') === you ? 'celebrate' : 'sad');
  render();
  await view.wait(1.8);
  for (const key of view.actors.keys()) view.pose(key, 'idle');
  view.actors.get('y0').x = view.px(0.5, 0.95)[0];
  view.actors.get('o0').x = view.px(0.5, 0.05)[0];
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
    el.innerHTML = s.offers.map((o, i) => offerHTML(o, i)).join('');
    el.querySelectorAll('.gcard').forEach((g) => { g.onclick = () => choose(+g.dataset.i); });
  } else if (s.mode === 'def' && s.def) {
    el.innerHTML = s.def.opts.map((o, i) => defHTML(o, i)).join('');
    el.querySelectorAll('.gcard').forEach((g) => { g.onclick = () => defend(+g.dataset.i); });
  } else el.innerHTML = `<div class="waiting">${s.mode === 'def' ? 'Redrock on the ball…' : s.mode === 'over' ? 'Full time.' : ''}</div>`;
  el.classList.toggle('busy', busy);
  const shootB = stage.querySelector('#shoot');
  shootB.innerHTML = s.mode !== 'atk' ? (s.mode === 'def' ? '🛡️ Defending' : 'Full time') : s.carrier === 'y0' ? 'Keeper has it' : `Shoot ${oddsPill(sc.p)} <span class="key">S</span>`;
  shootB.disabled = busy || s.mode !== 'atk' || s.carrier === 'y0';
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
  const press = o.press + 4;
  const modLine = named && o.mods.length ? `<div class="mods">${o.mods.join(' · ')}${Math.abs(o.risk - o.baseRisk) > 0.005 ? ` (${pct(o.baseRisk)}→${pct(o.risk)})` : ''}</div>` : '';
  return `<div class="gcard opt" style="--cc:${oddsColor(1 - o.risk)}" data-i="${i}" tabindex="0">
    <div class="cost">${i + 1}</div><div class="name">${T.name}</div>${art}
    <span class="riskp ${riskCls(o.risk)}">${pct(o.risk)} risk</span>
    <div class="type">${tag}</div>
    <div class="text"><span class="gain ${o.gain < 0 ? 'neg' : ''}">${o.gain >= 0 ? '+' : ''}${o.gain.toFixed(2)} xG</span> <span class="pr ${press < 0 ? 'cool' : ''}">🔥${press >= 0 ? '+' : ''}${press}</span></div>${modLine}</div>`;
}

function defHTML(o, i) {
  return `<div class="gcard opt def" style="--cc:#a5d6a7" data-i="${i}" tabindex="0">
    <div class="cost">${i + 1}</div><div class="name">${o.name}</div><div class="art tac">${o.icon}</div>
    <div class="type">${o.win ? `Win back ${pct(o.win)}` : 'Defensive call'}</div>
    <div class="text">${o.text}</div>
    <div class="theirs">Their goal <span class="odds ${o.goal < 0.12 ? 'hi' : o.goal < 0.22 ? 'mid' : o.goal < 0.35 ? 'lo' : 'vlo'}">${pct(o.goal)}</span>${o.win ? '<small> if not won</small>' : ''}</div></div>`;
}

// preview arrows for the three options
function drawOver(ctx, t) {
  if (!s || s.mode !== 'atk' || busy) return;
  const c = view.actors.get(s.carrier);
  if (!c) return;
  s.offers.forEach((o, i) => {
    const [x1, y1] = view.px(o.spot[0], o.spot[1]);
    ctx.save();
    ctx.globalAlpha = 0.85;
    drawArrow(ctx, c.x, c.y - 6, x1, y1 - 6, oddsColor(1 - o.risk), { dash: o.type === 'takeon' ? [3, 4] : TYPES[o.type].lofted ? [7, 4] : null, width: 2.5, curve: TYPES[o.type].lofted ? 26 : 0 });
    ctx.restore();
    // numbered marker
    ctx.save();
    const r = 9 + Math.sin(t * 5 + i) * 0.8;
    ctx.beginPath(); ctx.arc(x1, y1 - 6, r, 0, Math.PI * 2);
    ctx.fillStyle = oddsColor(1 - o.risk); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#1b1b2f'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '13px "Lilita One", system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), x1, y1 - 5.5);
    ctx.restore();
  });
  void roundRect;
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

window.pushLuck = { get s() { return s; } };
