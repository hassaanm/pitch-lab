// Card Grid: your hand is your playbook. Each card is a move one of your
// players makes on a 7×11 grid. Redrock telegraph their next move first
// (Into-the-Breach style), so every turn is a small coaching puzzle.

import { Shell, oddsPill, shuffle } from '../../shared/shell.js';
import { portrait, drawArrow, drawOdds, oddsColor, roundRect } from '../../shared/art.js';
import { sfx } from '../../shared/sfx.js';
import { byId, LINEUP5 } from '../../shared/cast.js';
import * as R from './rules.js';
import { GridView } from './view.js';

const { CARDS } = R;

const shell = new Shell({
  id: 'card-grid',
  title: 'Card Grid',
  pitch: 'Grid tactics where your hand is your playbook. Every card is a move one of your players makes — and Redrock show you their next move first.',
  how: [
    'Each turn you draw 5 cards and get ⚡4 energy (⚡5 in the second-half phase). Tap a card, then a player (if asked), then a highlighted cell. Odds show on every target before you commit. An attack hand always holds at least one card that moves the ball.',
    'Red arrows are Redrock\'s plan. When you attack, a red target ◎ is a press: if your ball carrier ends the turn next to it, they tackle. Dribblers get lunged at by each defender they pass next to, and with a defender within 3 a dribble is never better than 90% (heavy touch).',
    'When Redrock have the ball your hand turns defensive: Press, Mark, Block, Offside Trap. Watch their pass and shot odds drop as you move. A player who loses a tackle is dazed 💫 until the turn ends: no more cards for them, and they don\'t block passes or shots.',
    'Undo (Z) takes back moves until a dice roll happens. End Turn (E) lets Redrock act.',
    'After every goal and at half-time, add 1 of 3 cards to your deck.',
    'Keys: 1–5 card · ←→ cycle targets · Enter confirm · Esc cancel.',
  ],
  notice: 'Do cards-as-actions make the grid feel like coaching moves rather than chess? Is the hand restriction fun or frustrating?',
  phases: [
    { id: 'early', label: 'Kickoff', sub: "1' · 0–0" },
    { id: 'mid', label: 'Second half', sub: "46' · 1–1 · ⚡5" },
    { id: 'clutch', label: 'Clutch', sub: "88' · 1–2 · night" },
  ],
  onPhase: (id) => startPhase(id),
});
const stage = shell.stage;

// ------------------------------------------------------------------ phases
const KO = {
  you: { you: [[3, 10], [1, 8], [5, 8], [2, 6], [3, 5]], opp: [[3, 0], [2, 2], [4, 2], [3, 3], [4, 4]] },
  opp: { opp: [[3, 0], [1, 2], [5, 2], [4, 4], [3, 5]], you: [[3, 10], [2, 8], [4, 8], [3, 7], [2, 6]] },
};
const BASE_ATK = ['pass', 'pass', 'pass', 'dribble', 'dribble', 'through', 'shoot', 'shoot', 'run', 'overlap', 'needle', 'eagle'];
const BASE_DEF = ['press', 'press', 'press', 'mark', 'mark', 'mark', 'block', 'block', 'trap', 'sweep', 'wall', 'thunder'];
const PHASES = {
  early: { lineup: LINEUP5.sun, score: [0, 0], turn: 1, maxTurn: 10, half: 5, energy: 4, variant: 'day', poss: 'you', ballIdx: 4,
    you: KO.you.you, opp: KO.you.opp, atk: BASE_ATK, def: BASE_DEF },
  mid: { lineup: ['wak', 'ada', 'tomo', 'kenji', 'rio'], score: [1, 1], turn: 6, maxTurn: 10, half: 5, energy: 5, variant: 'dusk', poss: 'opp', ballIdx: 3,
    you: [[3, 10], [5, 7], [2, 8], [4, 5], [3, 3]], opp: [[3, 0], [2, 3], [5, 4], [3, 6], [2, 7]],
    atk: [...BASE_ATK, 'switch', 'express', 'through', 'pass'], def: [...BASE_DEF, 'press', 'mark'], halftimePick: true },
  clutch: { lineup: ['wak', 'tomo', 'kenji', 'pip', 'sol'], score: [1, 2], turn: 1, maxTurn: 2, half: 0, labels: ["88'", "90+3'"], energy: 4, variant: 'night', poss: 'you', ballIdx: 2,
    you: [[3, 10], [2, 7], [3, 5], [5, 4], [1, 3]], opp: [[3, 0], [2, 2], [4, 2], [3, 4], [4, 6]],
    atk: ['pass', 'pass', 'dribble', 'through', 'shoot', 'shoot', 'run', 'needle', 'pinball', 'late', 'switch'], def: ['press', 'press', 'mark', 'mark', 'block', 'trap', 'sweep', 'wall'] },
};

let m = null;       // match state (plain data, cloneable for undo)
let view = null;
let sel = null;     // { i, id, actors, actor, targets, focus, instant }
let undoStack = [];
let busy = false;
let phaseToken = 0;

const unit = (uid) => m.units.find((u) => u.uid === uid);
const nm = (u) => R.char(u).name;
const clock = () => (m.turn > m.maxTurn ? 'FT' : m.labels ? m.labels[m.turn - 1] : `${(m.turn - 1) * 9 + 1}'`);
const log = (t, k = '') => shell.log(t, k, clock());
const pct = (p) => Math.round(p * 100) + '%';

function startPhase(id) {
  phaseToken++;
  const P = PHASES[id];
  busy = false; sel = null; undoStack = [];
  m = {
    phase: id, units: [], ball: null, poss: P.poss, score: [...P.score], turn: P.turn, turnCount: 0, maxTurn: P.maxTurn, half: P.half, labels: P.labels || null,
    maxEnergy: P.energy, energy: P.energy, hand: [], handSide: null, decks: {}, plan: null, flags: {}, over: false, variant: P.variant, lineup: P.lineup,
  };
  P.lineup.forEach((cid, i) => m.units.push({ uid: 'y' + i, cid, side: 'you', c: P.you[i][0], r: P.you[i][1], block: 0, beaten: false }));
  LINEUP5.red.forEach((cid, i) => m.units.push({ uid: 'o' + i, cid, side: 'opp', c: P.opp[i][0], r: P.opp[i][1], block: 0, beaten: false }));
  m.ball = (P.poss === 'you' ? 'y' : 'o') + P.ballIdx;
  for (const s of ['atk', 'def']) {
    const list = P[s].filter((cid) => R.cardUsable(m, cid));
    m.decks[s] = { list, draw: shuffle(list), discard: [] };
  }
  buildScreen();
  log(`${P.lineup.map((c) => byId[c].name).join(', ')} vs Redrock United.`, 'info');
  if (id === 'clutch') log('One goal down, two turns left. Find an equaliser.', 'info');
  render();
  const tok = phaseToken;
  (async () => {
    if (P.halftimePick) { await view.wait(0.3); if (tok !== phaseToken) return; await offerReward('Half-time team talk'); if (tok !== phaseToken) return; }
    beginTurn();
  })();
}

// ------------------------------------------------------------------ screen
function buildScreen() {
  view?.destroy();
  stage.innerHTML = `<div class="cg">
    <div class="pitchwrap"><canvas id="cv"></canvas>
      <div class="badge" id="badge"></div><div class="possb" id="possb"></div>
      <div class="hint" id="hint"></div>
    </div>
    <div class="plan" id="plan"></div>
    <div class="bottombar">
      <div class="lft"><div class="energy" id="energy"></div><div class="deckinfo" id="deckinfo"></div></div>
      <button class="btn small ghost" id="undo">↶ Undo <span class="key">Z</span></button>
      <button class="btn" id="end">End turn <span class="key">E</span></button>
    </div>
    <div class="hand" id="hand"></div>
  </div>`;
  const cv = stage.querySelector('#cv');
  view = new GridView(cv);
  view.under = drawUnder; view.over = drawOver;
  view.alphaFor = (uid) => (unit(uid)?.beaten ? 0.6 : 1);
  view.glowFor = (uid) => (sel?.actor?.uid === uid ? '#ffffff' : (sel && !sel.actor && sel.actors?.some((a) => a.uid === uid)) ? '#9BE7FF' : null);
  fit();
  view.sync(m.units, m.ball, true);
  window.onresize = () => { fit(); };
  cv.addEventListener('pointerdown', onTap);
  stage.querySelector('#undo').onclick = () => undo();
  stage.querySelector('#end').onclick = () => endTurn();
}

function fit() {
  const wrap = stage.querySelector('.pitchwrap');
  if (!wrap || !view) return;
  const w = Math.min(wrap.clientWidth - 6, 560);
  // fit pitch + plan row + controls + hand in one phone screen
  const top = wrap.getBoundingClientRect().top + scrollY;
  const h = Math.round(Math.max(330, Math.min(innerHeight - top - 250, w * 1.45)));
  view.resize(w, h, m.variant);
}

function render() {
  if (!m || !view) return;
  shell.setScore({ home: m.score[0], away: m.score[1], clock: clock() });
  const turnsLeft = m.maxTurn - m.turn;
  stage.querySelector('#badge').textContent = m.over ? 'Full time' : `Turn ${m.turn}/${m.maxTurn}${turnsLeft === 0 ? ' · last' : ''}`;
  const pb = stage.querySelector('#possb');
  pb.textContent = m.poss === 'you' ? '⚽ Your ball · attack hand' : '🛡️ Their ball · defence hand';
  pb.className = 'possb ' + m.poss;
  // energy + deck
  stage.querySelector('#energy').innerHTML = `<span class="elbl">⚡</span>` + Array.from({ length: Math.max(m.maxEnergy, m.energy) }, (_, i) => `<span class="gem ${i < m.energy ? '' : 'off'}"></span>`).join('');
  const d = m.decks[m.handSide || 'atk'];
  stage.querySelector('#deckinfo').textContent = d ? `${m.handSide === 'def' ? 'Defence' : 'Attack'} deck: ${d.draw.length} left · ${d.list.length} total` : '';
  stage.querySelector('#undo').disabled = !undoStack.length || busy;
  stage.querySelector('#end').disabled = busy || m.over;
  renderPlan();
  renderHint();
  renderHand();
}

function cardHTML(id, o = {}) {
  const c = CARDS[id];
  const who = c.who ? byId[c.who] : null;
  const color = who ? 'var(--sun)' : c.side === 'def' ? '#a5d6a7' : c.kind === 'move' ? '#81d4fa' : '#ff8a65';
  const art = who ? `<div class="art" style="background-image:url(${portrait(who, 104)})"></div>` : `<div class="art tac">${c.icon}</div>`;
  const tag = who ? `${who.name} only` : c.pos ? `${c.pos} only` : c.side === 'def' ? 'Defence' : c.kind === 'move' ? 'Movement' : 'Ball';
  const best = o.best != null ? `<span class="bestp ${o.best >= 0.7 ? 'hi' : o.best >= 0.45 ? 'mid' : o.best >= 0.25 ? 'lo' : 'vlo'}">${pct(o.best)}</span>` : '';
  return `<div class="gcard ${o.cls || ''}" style="--cc:${color};${o.style || ''}" data-idx="${o.idx ?? ''}" data-id="${id}" tabindex="0">
    <div class="cost">${c.cost}</div><div class="name" ${c.name.length > 12 ? 'style="font-size:10px"' : ''}>${c.name}</div>${art}${best}
    <div class="type">${tag}</div><div class="text">${c.text}</div>${o.key ? `<span class="kbdh">${o.key}</span>` : ''}</div>`;
}

function renderHand() {
  const el = stage.querySelector('#hand');
  const n = m.hand.length;
  el.innerHTML = m.hand.map((id, i) => {
    const c = CARDS[id];
    const b = R.cardBest(m, id);
    const cant = c.cost > m.energy || !b.ok || busy;
    const rot = (i - (n - 1) / 2) * 3;
    const isSel = sel?.i === i;
    return cardHTML(id, { idx: i, key: i + 1, best: b.ok ? b.p : null, cls: `${cant ? 'cant' : ''} ${isSel ? 'sel' : ''}`, style: `--rot:${rot}deg` });
  }).join('') || (m.handSide && !busy && !m.over ? `<span class="muted" style="font-size:13px">Hand empty — end your turn.</span>` : '');
  el.querySelectorAll('.gcard').forEach((g) => { g.onclick = () => selectCard(+g.dataset.idx); });
}

function renderHint() {
  const el = stage.querySelector('#hint');
  let t = '';
  if (m.over) t = 'Full time.';
  else if (!m.plan && !busy) t = 'Kick-off coming…';
  else if (busy) t = m.poss === 'you' ? 'Playing it out…' : 'Redrock are on the move…';
  else if (sel?.instant) t = `<b>${CARDS[sel.id].name}</b> — tap the card again to play it.`;
  else if (sel && !sel.actor) t = `<b>${CARDS[sel.id].name}</b> — pick a player (glowing blue).`;
  else if (sel && sel.nowThreat != null) t = `<b>${nm(sel.actor)}</b>: ⚽ = their goal chance after (now ${pct(sel.nowThreat)})`;
  else if (sel) t = `<b>${CARDS[sel.id].name}</b> · ${nm(sel.actor)} — tap a yellow cell.`;
  else if (m.energy <= 0 || !m.hand.some((id) => CARDS[id].cost <= m.energy && R.cardBest(m, id).ok)) t = 'No more plays — <b>End turn</b>.';
  else t = m.poss === 'you' ? 'Your ball: play cards, end the turn clear of the red ◎.' : 'Their ball: Press, Mark or Block to cut their odds.';
  el.innerHTML = t;
}

function renderPlan() {
  const el = stage.querySelector('#plan');
  if (!m.plan) { el.innerHTML = ''; return; }
  const H = R.holder(m);
  if (m.plan.kind === 'def') {
    const items = m.plan.list.map((it) => {
      const u = unit(it.uid);
      if (it.type === 'press') {
        const live = H && H.side === 'you' && R.cheb(R.cell(H), it.cell) <= 1;
        return `<span class="pi press ${live ? '' : 'dodged'}">🦶 ${nm(u)} presses ◎${live ? ' ' + oddsPill(R.tackleOdds(u, H), 'tackle') : ' <i>dodged</i>'}</span>`;
      }
      return R.char(u).pos === 'GK' ? '' : `<span class="pi">↘ ${nm(u)} steps up</span>`;
    }).join('');
    el.innerHTML = `<span class="ph">Redrock plan</span>${items || '<span class="pi">Holding shape</span>'}`;
  } else {
    const ev = R.evalAttack(m, m.plan);
    const goal = R.goalChance(m, m.plan);
    const items = ev.steps.map((s, i) => {
      const u = unit(s.uid);
      if (s.type === 'pass') return `<span class="pi">${i + 1}. ${nm(u)} → ${nm(unit(s.to))} ${oddsPill(s.p)}${s.offside ? ' 🚩' : ''}</span>`;
      if (s.type === 'dribble') return `<span class="pi">${i + 1}. ${nm(u)} dribbles ${oddsPill(s.p)}</span>`;
      return `<span class="pi">${i + 1}. ${nm(u)} shoots ${oddsPill(s.p)}</span>`;
    }).join('');
    el.innerHTML = `<span class="ph">Redrock plan</span><span class="pi big">Their goal chance <span class="odds ${goal < 0.15 ? 'hi' : goal < 0.3 ? 'mid' : goal < 0.45 ? 'lo' : 'vlo'}">${pct(goal)}</span></span>${items}`;
  }
}

// ------------------------------------------------------------------ turn flow
function drawHand(sideKey, n = 5) {
  const d = m.decks[sideKey];
  m.hand = [];
  m.handSide = sideKey;
  for (let i = 0; i < n; i++) {
    if (!d.draw.length) { d.draw = shuffle(d.discard); d.discard = []; }
    if (!d.draw.length) break;
    m.hand.push(d.draw.pop());
  }
  if (sideKey === 'atk') ensureBallCard(d);
  sfx.deal();
}
// An attack hand always holds at least one playable card that moves the ball
// (pass, through ball or dribble), so a turn is never dead on arrival.
const MOVERS = ['pass', 'through', 'dribble'];
const playableMover = (id) => MOVERS.includes(CARDS[id].kind) && R.cardBest(m, id).ok;
function ensureBallCard(d) {
  if (!m.hand.length || m.hand.some(playableMover)) return;
  for (const pile of [d.draw, d.discard]) {
    const j = pile.findIndex(playableMover);
    if (j < 0) continue;
    const dead = m.hand.findIndex((id) => !R.cardBest(m, id).ok);
    const k = dead >= 0 ? dead : m.hand.length - 1;
    const out = m.hand[k];
    m.hand[k] = pile[j];
    pile[j] = out;
    return;
  }
}
function discardHand() {
  if (m.handSide) m.decks[m.handSide].discard.push(...m.hand);
  m.hand = [];
}

function beginTurn() {
  if (m.over) return;
  m.flags = {};
  for (const u of m.units) { if (u.beaten) view.pose(u.uid, 'idle'); u.block = 0; u.beaten = false; }
  m.energy = m.maxEnergy;
  drawHand(m.poss === 'you' ? 'atk' : 'def');
  m.plan = m.poss === 'you' ? R.planDefence(m) : R.planAttack(m);
  undoStack = [];
  sel = null;
  busy = false;
  view.sync(m.units, m.ball);
  if (m.poss === 'opp') {
    const ev = R.evalAttack(m, m.plan);
    const s = ev.steps.map((x) => x.type === 'pass' ? `pass to ${nm(unit(x.to))}` : x.type).join(', then ');
    log(`Redrock plan: ${s}. Cut the odds before they act.`, 'them');
  } else {
    const pr = m.plan.list.filter((i) => i.type === 'press').map((i) => nm(unit(i.uid)));
    log(pr.length ? `${pr.join(' & ')} will press the ball's cell (◎). Move it before you end the turn.` : 'No press coming — time on the ball.', 'info');
  }
  render();
}

async function endTurn() {
  if (busy || m.over || !m.plan) return;
  sfx.click();
  await finishTurn(false);
}

// skipResolve = possession already changed this turn (turnover / goal / ball won)
async function finishTurn(skipResolve) {
  const tok = phaseToken;
  busy = true; sel = null;
  discardHand();
  render();
  if (!skipResolve && m.plan) {
    if (m.plan.kind === 'def' && m.poss === 'you') await resolveDefence();
    else if (m.plan.kind === 'atk' && m.poss === 'opp') await resolveAttack();
  }
  if (tok !== phaseToken) return;
  m.plan = null;
  m.turn++; m.turnCount++;
  if (m.turn > m.maxTurn) { await fullTime(); return; }
  if (m.half && m.turn === m.half + 1) {
    sfx.whistle(2);
    shell.banner('HALF-TIME', `${m.score[0]}–${m.score[1]}`);
    log(`Half-time: ${m.score[0]}–${m.score[1]}.`, 'info');
    await view.wait(1.2);
    if (tok !== phaseToken) return;
    await offerReward('Half-time team talk');
    if (tok !== phaseToken) return;
  }
  beginTurn();
}

// Redrock defend: steps, then presses on the telegraphed cells.
async function resolveDefence() {
  const P = m.plan.list;
  const steps = P.filter((i) => i.type === 'step');
  const anims = [];
  for (const s of steps) {
    const u = unit(s.uid);
    if (R.unitAt(m, s.to[0], s.to[1])) { if (R.char(u).pos !== 'GK') view.labelAt(u.c, u.r, 'blocked', '#ccc', 0.8); continue; }
    u.c = s.to[0]; u.r = s.to[1];
    anims.push(view.moveTo(u.uid, u.c, u.r, 0.4));
  }
  await Promise.all(anims);
  for (const pr of P.filter((i) => i.type === 'press')) {
    const h = R.holder(m);
    if (!h || h.side !== 'you') break;
    const u = unit(pr.uid);
    if (R.cheb(R.cell(h), pr.cell) <= 1) {
      // close in next to the carrier
      const spot = adjacentFree(R.cell(h), R.cell(u));
      if (spot) { u.c = spot[0]; u.r = spot[1]; await view.moveTo(u.uid, u.c, u.r, 0.3); }
      const p = R.tackleOdds(u, h);
      const won = Math.random() < p;
      await contest(u, h, won, true);
      if (won) {
        log(`🦶 ${nm(u)} presses ${nm(h)} — tackle ${pct(p)} (tackle ${R.st(u).tackle} vs dribble ${R.st(h).dribble}). <b>Ball lost.</b>`, 'bad');
        m.ball = u.uid; m.poss = 'opp';
        return;
      }
      log(`${nm(h)} rides ${nm(u)}'s tackle (${pct(p)} to win it). Still your ball — ${nm(u)} is dazed 💫.`, 'good');
      u.beaten = true;
    } else {
      if (!R.unitAt(m, pr.cell[0], pr.cell[1]) && R.cheb(R.cell(u), pr.cell) <= 3) { u.c = pr.cell[0]; u.r = pr.cell[1]; await view.moveTo(u.uid, u.c, u.r, 0.3); }
      view.labelAt(u.c, u.r, 'DODGED', '#9BE7FF');
      log(`${nm(u)} presses empty grass — the ball had moved.`, 'good');
    }
  }
}

// Redrock attack: runs, then the planned chain, each roll at the shown odds.
async function resolveAttack() {
  const ev0 = R.evalAttack(m, m.plan);
  await Promise.all(ev0.runs.filter((r) => !r.blocked).map((r) => { const u = unit(r.uid); u.c = r.to[0]; u.r = r.to[1]; return view.moveTo(u.uid, u.c, u.r, 0.4); }));
  for (const r of ev0.runs.filter((x) => x.blocked)) { const u = unit(r.uid); view.labelAt(u.c, u.r, 'run blocked', '#9BE7FF', 0.9); }
  const ev = R.evalAttack({ ...m, plan: m.plan }, { runs: [], actions: m.plan.actions });
  for (const s of ev.steps) {
    const u = unit(s.uid);
    if (m.ball !== u.uid) break;
    if (s.type === 'pass') {
      const t = unit(s.to);
      if (s.offside && Math.random() < s.offside) {
        tag('offside');
        await view.passTo(u.uid, t.uid);
        sfx.whistle(1);
        view.labelAt(t.c, t.r, 'OFFSIDE!', '#FFD23F');
        view.pose(t.uid, 'sad');
        const df = nearestOf('you', R.cell(t), true);
        log(`🚩 Offside! ${nm(t)} was behind your line. Free kick to ${nm(df)}.`, 'good');
        await view.wait(0.45);
        view.pose(t.uid, 'idle'); view.pose(df.uid, 'ready');
        await view.give(df.uid, 0.55); // ball is rolled to the free-kick taker
        view.pose(df.uid, 'idle');
        m.ball = df.uid; m.poss = 'you';
        return;
      }
      const ok = Math.random() < s.raw;
      if (ok) {
        tag('pass');
        await view.passTo(u.uid, t.uid);
        m.ball = t.uid;
        log(`${nm(u)} → ${nm(t)} (${pct(s.raw)}) completes.`, 'them');
      } else {
        const cut = s.blockers[0]?.u || nearestToLine('you', R.cell(u), R.cell(t));
        await cutOut(u, view.footPt(t.uid), cut, false, 'CUT OUT!', '#9BE7FF');
        log(`${nm(u)} → ${nm(t)} had ${pct(s.raw)}${s.blockers.length ? ` with ${s.blockers.map((b) => nm(b.u)).join(' & ')} in the lane` : ''}. <b>${nm(cut)} intercepts!</b>`, 'good');
        m.ball = cut.uid; m.poss = 'you';
        return;
      }
    } else if (s.type === 'dribble') {
      const path = R.dribblePath(m, R.cell(u), s.to);
      if (!path) {
        // someone is standing in the lane: a Sunbird there steps in and takes it
        const wall = firstOnLine(R.cell(u), s.to);
        if (!wall || wall.side !== 'you') { log(`${nm(u)}'s dribble lane is closed — Redrock hold the ball.`, 'good'); return; }
        tag('dribble-block');
        await contest(wall, u, true);
        log(`${nm(u)} tries to dribble but ${nm(wall)} is standing in the way. <b>Won it!</b>`, 'good');
        m.ball = wall.uid; m.poss = 'you';
        return;
      }
      tag('dribble');
      const stop = await runDribble(u, path, s.rolls, s.nip, s.touch);
      if (stop) {
        log(stop.touch ? `${nm(u)} takes a heavy touch — <b>${nm(stop.u)} nips in!</b> (dribble was ${pct(s.p)})` : `${nm(stop.u)} lunges at ${nm(u)} (${pct(stop.t)}) — <b>ball won!</b>`, 'good');
        m.ball = stop.u.uid; m.poss = 'you';
        return;
      }
      log(`${nm(u)} dribbles through (${pct(s.p)}).`, 'them');
    } else {
      await shoot(u, s.p, s.parts);
      return;
    }
  }
}

function adjacentFree(center, from) {
  let best = null, bd = 1e9;
  for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
    const c = center[0] + dc, r = center[1] + dr;
    if ((!dc && !dr) || !R.inside(c, r) || R.unitAt(m, c, r)) continue;
    const d = R.dist([c, r], from);
    if (d < bd) { bd = d; best = [c, r]; }
  }
  return best;
}
function nearestOf(s, at, outfield = false) {
  return R.side(m, s).filter((u) => !outfield || R.char(u).pos !== 'GK').sort((a, b) => R.dist(R.cell(a), at) - R.dist(R.cell(b), at))[0];
}
// The outfielder of side s closest to the pass line from→to (the one who reads it).
function nearestToLine(s, from, to) {
  const segD = (p) => {
    const dx = to[0] - from[0], dy = to[1] - from[1], L = dx * dx + dy * dy || 1;
    const k = R.clamp(((p[0] - from[0]) * dx + (p[1] - from[1]) * dy) / L, 0.2, 1);
    return Math.hypot(from[0] + k * dx - p[0], from[1] + k * dy - p[1]);
  };
  return R.side(m, s).filter((u) => R.char(u).pos !== 'GK' && !u.beaten).sort((a, b) => segD(R.cell(a)) - segD(R.cell(b)))[0];
}
// First unit standing on the king-step line from a toward b.
function firstOnLine(a, b) {
  let [c, r] = a;
  while (c !== b[0] || r !== b[1]) {
    c += Math.sign(b[0] - c); r += Math.sign(b[1] - r);
    const u = R.unitAt(m, c, r);
    if (u) return u;
  }
  return null;
}

// ------------------------------------------------------------------ input
function selectCard(i) {
  if (busy || m.over) return;
  const id = m.hand[i];
  if (!id) return;
  const c = CARDS[id];
  if (sel?.i === i) {
    if (sel.instant) { playSel(null); return; }
    sel = null; render(); return;
  }
  if (c.cost > m.energy) { shell.toast(`Needs ⚡${c.cost} — you have ${m.energy}.`); sfx.bad(); return; }
  const actors = R.cardActors(m, id);
  sfx.card();
  if (actors === null) { sel = { i, id, instant: true }; render(); return; }
  if (!actors.length) { shell.toast(whyNot(id)); sfx.bad(); return; }
  sel = { i, id, actors, actor: null, targets: [], focus: 0 };
  if (actors.length === 1) setActor(actors[0]);
  if (sel && sel.actor && !sel.targets.length) { shell.toast('No legal target right now.'); sel = null; }
  render();
}
function whyNot(id) {
  const c = CARDS[id];
  const h = R.holder(m);
  if (c.who && !m.units.some((u) => u.cid === c.who && u.side === 'you')) return `${byId[c.who].name} isn't on the pitch.`;
  if (c.who && ['pass', 'dribble', 'shoot'].includes(c.kind)) return `${byId[c.who].name} needs the ball (${h ? nm(h) : 'nobody'} has it).`;
  const dazed = R.side(m, 'you').filter((u) => u.beaten).map(nm);
  if (dazed.length && ['press', 'move', 'block'].includes(c.kind)) return `${dazed.join(' & ')} ${dazed.length > 1 ? 'are' : 'is'} dazed 💫 after a lost tackle — nobody else can play this.`;
  if (c.kind === 'press') return 'Nobody is within reach of the ball.';
  return 'Nobody can play this right now.';
}
function setActor(a) {
  sel.actor = a;
  sel.targets = R.cardTargets(m, sel.id, a);
  // Defending: preview Redrock's goal chance if this player goes there.
  const c = CARDS[sel.id];
  if (m.plan?.kind === 'atk' && (c.kind === 'move' || c.kind === 'block')) {
    const c0 = a.c, r0 = a.r, b0 = a.block;
    for (const t of sel.targets) {
      a.c = t.cell[0]; a.r = t.cell[1]; if (c.kind === 'block') a.block = c.mult;
      t.threat = R.goalChance(m, m.plan);
    }
    a.c = c0; a.r = r0; a.block = b0;
    sel.nowThreat = R.goalChance(m, m.plan);
    sel.focus = sel.targets.reduce((b, t, i) => (t.threat < sel.targets[b].threat ? i : b), 0);
    return;
  }
  sel.focus = bestIdx(sel.targets);
}
const bestIdx = (ts) => { let b = 0; ts.forEach((t, i) => { if ((t.p ?? 0) > (ts[b].p ?? 0)) b = i; }); return b; };

function onTap(e) {
  if (busy || !m || m.over) return;
  const r = e.currentTarget.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const cl = view.cellAt(x, y);
  if (!sel || sel.instant) {
    const u = cl && R.unitAt(m, cl[0], cl[1]);
    if (u) { const s = R.st(u); shell.toast(`<b>${nm(u)}</b> · ${R.char(u).pos} · Pass ${s.pass} · Shoot ${s.shoot} · Tackle ${s.tackle} · Dribble ${s.dribble}`, 2200); }
    return;
  }
  if (!sel.actor) {
    const a = nearestHit(sel.actors.map((u) => ({ cell: R.cell(u), u })), x, y);
    if (a) { sfx.click(); setActor(a.u); if (!sel.targets.length) { shell.toast('No legal target for that player.'); sel.actor = null; } render(); }
    return;
  }
  const t = nearestHit(sel.targets, x, y);
  if (t) { playSel(t); return; }
  const other = cl && sel.actors.find((u) => u.c === cl[0] && u.r === cl[1]);
  if (other && sel.actors.length > 1) { setActor(other); render(); return; }
  sel = null; render();
}
// forgiving hit test: nearest candidate within ~0.8 cell (keeps taps ≥40px)
function nearestHit(list, x, y) {
  let best = null, bd = Math.max(view.cw, view.ch) * 0.8;
  for (const t of list) {
    const [cx, cy] = t.cell[1] < 0 ? view.pitch.goalMouth(true) : t.cell[1] >= R.ROWS ? view.pitch.goalMouth(false) : view.center(...t.cell);
    const d = Math.hypot(cx - x, cy - y) * (t.goal ? 0.5 : 1);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

document.addEventListener('keydown', (e) => {
  if (!m || !view || document.querySelector('.sheet-wrap') || e.altKey || e.metaKey || e.ctrlKey) return;
  const k = e.key;
  if (k >= '1' && k <= '9') { selectCard(+k - 1); return; }
  if (k === 'z' || k === 'u') { undo(); return; }
  if (k === 'e') { endTurn(); return; }
  if (k === 'Escape') { sel = null; render(); return; }
  if (!sel) { if (k === 'Enter') { e.preventDefault(); endTurn(); } return; }
  const list = sel.instant ? null : sel.actor ? sel.targets : sel.actors;
  if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Tab'].includes(k) && list?.length) {
    e.preventDefault();
    const d = k === 'ArrowLeft' || k === 'ArrowUp' || (k === 'Tab' && e.shiftKey) ? -1 : 1;
    sel.focus = (sel.focus + d + list.length) % list.length; sfx.tick(); return;
  }
  if (k === 'Enter' || k === ' ') {
    e.preventDefault();
    if (sel.instant) playSel(null);
    else if (!sel.actor) { setActor(sel.actors[sel.focus] || sel.actors[0]); if (!sel.targets.length) sel.actor = null; render(); }
    else if (sel.targets[sel.focus]) playSel(sel.targets[sel.focus]);
  }
});

// ------------------------------------------------------------------ undo
const snapshot = () => structuredClone({ units: m.units, ball: m.ball, energy: m.energy, hand: m.hand, decks: m.decks, flags: m.flags });
function undo() {
  if (busy || !undoStack.length) return;
  Object.assign(m, undoStack.pop());
  sel = null;
  sfx.whoosh();
  view.sync(m.units, m.ball);
  log('↶ Undone.', 'info');
  render();
}

// ------------------------------------------------------------------ playing cards
async function playSel(t) {
  const { i, id } = sel;
  const actor = sel.actor;
  const c = CARDS[id];
  const random = isRandom(c, t);
  flyCard(i, actor, t);
  if (random) undoStack = []; else undoStack.push(snapshot());
  m.energy -= c.cost;
  m.hand.splice(i, 1);
  m.decks[m.handSide].discard.push(id);
  sel = null;
  busy = true;
  sfx.card();
  render();
  const tok = phaseToken;
  const after = await resolveCard(id, actor, t);
  if (tok !== phaseToken) return;
  if (after === 'turnover') { await view.wait(0.5); if (tok === phaseToken) await finishTurn(true); return; }
  busy = false;
  render();
}
// The played card lifts out of the hand and flies to where it takes effect.
function flyCard(i, actor, t) {
  const el = stage.querySelector(`#hand .gcard[data-idx="${i}"]`);
  const cv = stage.querySelector('#cv');
  if (!el || !cv) return;
  const r0 = el.getBoundingClientRect(), rc = cv.getBoundingClientRect();
  const at = t?.cell && t.cell[1] >= 0 && t.cell[1] < R.ROWS ? t.cell : actor ? R.cell(actor) : [3, 5];
  const [px, py] = view.center(...at);
  const ghost = el.cloneNode(true);
  ghost.classList.remove('sel', 'cant');
  Object.assign(ghost.style, { position: 'fixed', left: r0.left + 'px', top: r0.top + 'px', width: r0.width + 'px', height: r0.height + 'px', margin: 0, zIndex: 50, pointerEvents: 'none', transition: 'transform .38s cubic-bezier(.3,.7,.4,1), opacity .38s ease-in', transform: 'none' });
  document.body.appendChild(ghost);
  const dx = rc.left + px - (r0.left + r0.width / 2), dy = rc.top + py - (r0.top + r0.height / 2);
  requestAnimationFrame(() => requestAnimationFrame(() => { ghost.style.transform = `translate(${dx}px, ${dy}px) scale(.3)`; ghost.style.opacity = '0'; }));
  setTimeout(() => ghost.remove(), 450);
}
const isRandom = (c, t) => ['pass', 'through', 'shoot', 'press'].includes(c.kind) || (c.kind === 'dribble' && (t.rolls?.length > 0 || t.touch < 1));

async function resolveCard(id, a, t) {
  const c = CARDS[id];
  const Ptag = (p) => pct(p);
  switch (c.kind) {
    case 'energy': m.energy += 2; sfx.coin(); log(`⚡ ${c.name}: +2 energy.`, 'good'); return;
    case 'wall': m.flags.wall = true; sfx.good(); log(`🧱 ${c.name}: Wak is set — their shots −25% this turn.`, 'good'); return;
    case 'trap': {
      m.flags.trap = true;
      const line = R.side(m, 'you').filter((u) => R.char(u).pos !== 'GK').sort((x, y) => x.r - y.r);
      await Promise.all(line.map((u) => { if (u.r > 0 && !R.unitAt(m, u.c, u.r - 1)) { u.r -= 1; return view.moveTo(u.uid, u.c, u.r, 0.3); } return null; }));
      sfx.whistle(1);
      log('🚩 Offside trap: your line steps up. Passes to runners behind it are 60% offside.', 'good');
      return;
    }
    case 'block': a.block = c.mult; sfx.thud(); view.labelAt(a.c, a.r, c.mult > 2 ? 'WALL ×3' : 'BLOCK ×2', '#9BE7FF'); log(`🧱 ${nm(a)} braces: counts ×${c.mult} vs passes and shots.`, 'good'); return;
    case 'move': {
      a.c = t.cell[0]; a.r = t.cell[1];
      await view.moveTo(a.uid, a.c, a.r, 0.35);
      log(`${c.icon || '🏃'} ${nm(a)}: ${c.name}.`, c.side === 'def' ? 'good' : '');
      return;
    }
    case 'pass': {
      const h = a;
      const to = t.unit;
      const won = Math.random() < t.p;
      const why = c.needle ? 'needle — ignores defenders' : t.blockers.length ? `${t.blockers.map((b) => nm(b.u)).join(' & ')} ${c.lofted ? 'marking' : 'in the lane'}` : 'clear lane';
      if (c.needle) await shell.cutIn(byId.kenji, 'NEEDLE PASS');
      if (won) {
        tag('pass');
        await view.passTo(h.uid, to.uid, c.lofted);
        m.ball = to.uid;
        m.flags.keeperUnset = !!c.lofted;
        log(`${nm(h)} → ${nm(to)}: ${c.name} ${Ptag(t.p)} (${why}). ✓`, 'good');
        return;
      }
      const cut = t.blockers[0]?.u || nearestToLine('opp', R.cell(h), R.cell(to));
      await cutOut(h, view.footPt(to.uid), cut, c.lofted, 'INTERCEPTED', '#FF8A80');
      log(`${nm(h)} → ${nm(to)} had ${Ptag(t.p)} (${why}). <b>${nm(cut)} intercepts.</b>`, 'bad');
      m.ball = cut.uid; m.poss = 'opp';
      return 'turnover';
    }
    case 'through': {
      const h = R.holder(m);
      const won = Math.random() < t.p;
      a.c = t.cell[0]; a.r = t.cell[1];
      tag('through');
      const run = view.moveTo(a.uid, a.c, a.r, 0.55);
      await view.wait(0.15);
      if (won) {
        await view.passTo(h.uid, a.uid, false, 0.4); // homes onto the runner: they meet as the run ends
        await run;
        m.ball = a.uid; m.flags.keeperUnset = a.r <= 3;
        log(`🎯 Through ball ${nm(h)} → ${nm(a)} (${Ptag(t.p)}). ✓${a.r <= 3 ? ' Keeper caught off his line!' : ''}`, 'good');
        return;
      }
      const cut = t.blockers[0]?.u || nearestToLine('opp', R.cell(h), t.cell);
      await Promise.all([cutOut(h, view.feet(...t.cell), cut, false, 'READ IT', '#FF8A80'), run]);
      log(`🎯 Through ball to ${nm(a)} had ${Ptag(t.p)}. <b>${nm(cut)} reads it.</b>`, 'bad');
      m.ball = cut.uid; m.poss = 'opp';
      return 'turnover';
    }
    case 'dribble': {
      if (c.who === 'pip') await shell.cutIn(byId.pip, 'PINBALL RUN');
      const path = R.dribblePath(m, R.cell(a), t.cell);
      if (!path) return;
      m.flags.keeperUnset = false;
      tag('dribble');
      const stop = await runDribble(a, path, t.rolls, t.nip, t.touch);
      if (stop) {
        log(stop.touch ? `💨 ${nm(a)} takes a heavy touch — <b>${nm(stop.u)} nips in.</b> Keep-ball odds were ${Ptag(t.p)}.` : `💨 ${nm(a)} dribbles; ${nm(stop.u)} lunges (${Ptag(stop.t)}) — <b>tackled.</b> Keep-ball odds were ${Ptag(t.p)}.`, 'bad');
        m.ball = stop.u.uid; m.poss = 'opp';
        return 'turnover';
      }
      log(`💨 ${nm(a)} dribbles to safety${t.rolls.length ? ` past ${t.rolls.map((r) => nm(r.u)).join(' & ')} (${Ptag(t.p)})` : ''}.`, 'good');
      return;
    }
    case 'shoot': {
      if (c.who) await shell.cutIn(byId[c.who], c.name.toUpperCase());
      const res = await shoot(a, t.p, t.parts);
      return res === 'goal' ? 'turnover' : 'turnover';
    }
    case 'press': {
      const h = R.holder(m);
      a.c = t.cell[0]; a.r = t.cell[1];
      await view.moveTo(a.uid, a.c, a.r, 0.3);
      const won = Math.random() < t.p;
      await contest(a, h, won, true);
      if (won) {
        log(`🦶 ${c.name}: ${nm(a)} presses ${nm(h)}: tackle ${Ptag(t.p)} (tackle ${R.st(a).tackle} vs dribble ${R.st(h).dribble}). <b>Ball won!</b>`, 'good');
        m.ball = a.uid; m.poss = 'you';
        shell.toast('Ball won! Your attack starts next turn.');
        return 'turnover';
      }
      a.beaten = true;
      log(`🦶 ${c.name}: ${nm(a)} presses ${nm(h)} (${Ptag(t.p)}) — skinned. ${nm(a)} is dazed 💫 and can't act again this turn.`, 'bad');
      return;
    }
  }
}

// ------------------------------------------------------------------ juice
const tag = (s) => { window.__jankCtx = s; };

// A tackle. The tackler closes in and slides at the carrier's feet; only at
// that contact frame do the sound, label and outcome happen. If won, the ball
// pops off the carrier's foot to the tackler.
async function contest(tk, victim, won, daze = false) {
  tag('tackle');
  const tv = view.vis.get(tk.uid);
  const [bx, by] = view.footPt(victim.uid);
  const dir = bx >= tv.x ? 1 : -1;
  const reach = view.size * 0.42;
  // anticipation: run in until one stride away, then slide the rest
  const far = Math.hypot(bx - tv.x, by - tv.y);
  if (far > view.cw * 1.3) {
    const k = 1 - (view.cw * 0.9) / far;
    await view.moveToPx(tk.uid, tv.x + (bx - tv.x) * k, tv.y + (by - tv.y) * k, R.clamp(far / 320, 0.2, 0.5));
  }
  await view.moveToPx(tk.uid, bx - dir * reach, by - 1, 0.2, 'slide');
  tv.facing = dir;
  // contact
  sfx.thud();
  view.hitstop = 0.14;
  shell.shake(stage.querySelector('.pitchwrap'));
  view.labelAt(victim.c, victim.r, won ? 'TACKLE!' : 'BEATEN!', won ? '#FF8A3D' : '#FFD23F');
  if (won) {
    view.pose(victim.uid, 'sad');
    await view.give(tk.uid, 0.16);
  } else {
    view.pose(victim.uid, 'celebrate'); sfx.whoosh();
  }
  await view.wait(0.4);
  view.pose(tk.uid, !won && daze ? 'sad' : 'idle'); view.pose(victim.uid, 'idle'); // a beaten presser stays dazed
  await view.wait(0.2); // tackler eases back onto their cell
}

// An interception: the cutter reads the pass and steps into the line; ball
// and cutter reach the same point on the same frame.
async function cutOut(passer, toPt, cutter, lofted, text, color) {
  tag('intercept');
  const [ax, ay] = view.footPt(passer.uid);
  const [bx, by] = toPt;
  const cv = view.vis.get(cutter.uid);
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1;
  let k = ((cv.x - ax) * dx + (cv.y - ay) * dy) / L;
  k = lofted ? R.clamp(k, 0.8, 0.95) : R.clamp(k, 0.3, 0.92);
  const mx = ax + dx * k, my = ay + dy * k;
  const f = Math.abs(mx - cv.x) > 2 ? Math.sign(mx - cv.x) : cv.facing;
  const T = view.flightTime(mx, my, 400, 0.3, 0.6);
  const pv = view.vis.get(passer.uid);
  if (pv) { pv.pose = 'pass'; view.wait(0.3).then(() => { if (pv.pose === 'pass') pv.pose = 'idle'; }); }
  sfx.pass();
  await Promise.all([
    view.ballTo(mx, my, T, lofted ? 30 : 4),
    view.moveToPx(cutter.uid, mx - f * view.size * 0.2, my - 1, T),
  ]);
  cv.facing = f;
  view.pose(cutter.uid, lofted ? 'header' : 'kick');
  await view.give(cutter.uid);
  sfx.thud(); view.hitstop = 0.12;
  view.label(text, mx, my - view.size * 0.6, color);
  await view.wait(0.35);
  view.pose(cutter.uid, 'idle');
  await view.wait(0.2);
}

// Carry the ball step by step. A defender lunges when the carrier passes
// next to them (each rolls once, at the odds shown). Returns the winning roll.
async function runDribble(u, path, rolls, nip = null, touch = 1) {
  const pending = [...rolls];
  let prev = R.cell(u);
  for (const pc of path) {
    u.c = pc[0]; u.r = pc[1];
    await view.moveTo(u.uid, u.c, u.r, 0.24);
    for (const roll of pending.filter((x) => R.cheb(R.cell(x.u), pc) <= 1)) {
      pending.splice(pending.indexOf(roll), 1);
      const won = Math.random() < roll.t;
      await contest(roll.u, u, won);
      if (won) return roll;
    }
    prev = pc;
  }
  // heavy touch: the ball runs ahead and the nearest defender nips in to meet it
  if (nip && Math.random() > touch) {
    const [fx, fy] = view.footPt(u.uid);
    const last = path[path.length - 1], before = path.length > 1 ? path[path.length - 2] : prev;
    const dx = Math.sign(last[0] - before[0]) || 0, dy = Math.sign(last[1] - before[1]) || 0;
    const ahead = [fx + dx * view.cw * 0.9, fy + dy * view.ch * 0.9];
    await cutOut(u, ahead, nip, false, 'HEAVY TOUCH', u.side === 'you' ? '#FF8A80' : '#9BE7FF');
    return { u: nip, t: 1 - touch, touch: true };
  }
  return null;
}

// Keeper dive geometry: in the 'dive' pose the body lies toward -facing, so
// the hands end up about this far from the feet.
const HANDS = { x: 0.92, y: 0.42 };

async function shoot(u, p, parts = []) {
  tag('shot');
  const sideAtk = u.side;
  const top = sideAtk === 'you';
  const roll = Math.random();
  const result = roll < p ? 'goal' : roll < p + (1 - p) * 0.55 ? 'save' : 'miss';
  const gk = R.side(m, R.other(sideAtk)).find((x) => R.char(x).pos === 'GK');
  const gv = view.vis.get(gk.uid);
  const [gx, gy] = view.pitch.goalMouth(top);
  const gw = view.pitch.goalW, nd = view.pitch.netDepth;
  const aim = (Math.random() < 0.5 ? -1 : 1) * (0.18 + Math.random() * 0.22);
  const gx0 = gv.x, gy0 = gv.y;
  const dir = Math.sign(gx + aim * gw - gx0) || 1;
  const S = view.size;
  // where the ball ends up, and where the keeper's feet end up
  let ex, ey, kx, ky;
  if (result === 'save') {
    kx = gx0 + dir * gw * 0.12; ky = gy0;
    ex = kx + dir * S * HANDS.x; ey = ky + 1;                      // under the gloves (lifted by h)
  } else if (result === 'goal') {
    ex = gx + aim * gw; ey = gy + (top ? -nd * 0.6 : nd * 0.6);   // in the net
    kx = gx0 + dir * gw * 0.1; ky = gy0;                           // dives, but short
  } else {
    ex = gx + dir * gw * (0.62 + Math.random() * 0.3); ey = gy + (top ? -14 : 14);
    kx = gx0 + dir * 6; ky = gy0;                                  // shuffles, watches it go wide
  }
  const T = 0.5;
  view.pose(u.uid, 'kick');
  sfx.kick();
  gv.anim++; gv.pose = 'ready';
  const x0 = view.ball.x, y0 = view.ball.y;
  view.ballFree = true;
  const diveFrom = result === 'goal' ? 0.45 : 0.3;
  await view.tween(T, (k) => {
    view.ball.x = x0 + (ex - x0) * k; view.ball.y = y0 + (ey - y0) * k; view.ball.spin += 0.6;
    view.ball.h = Math.sin(k * Math.PI) * (result === 'miss' ? 20 : 9) + (result === 'save' ? k * S * HANDS.y : 0);
    if (result !== 'miss' && k > diveFrom) {
      const q = (k - diveFrom) / (1 - diveFrom);
      gv.pose = 'dive'; gv.facing = -dir;
      gv.x = gx0 + (kx - gx0) * q; gv.y = gy0 + (ky - gy0) * q;
    } else if (result === 'miss') gv.x = gx0 + (kx - gx0) * k;
  });
  view.pose(u.uid, 'idle');
  const who = nm(u);
  const why = `${pct(p)}${parts.length ? ' — ' + parts.join(', ') : ''}`;
  if (result === 'goal') {
    gv.anim--; gv.pose = 'sad';
    await goalScored(sideAtk, u, why);
    return 'goal';
  }
  if (result === 'save') {
    // contact: ball in the gloves
    sfx.save(); view.hitstop = 0.12;
    view.label('SAVED!', ex, ey - S * 0.9, '#9BE7FF');
    await view.wait(0.45);
    gv.anim--; gv.pose = 'idle';           // gets up, gathers it, walks back to the cell
    await view.give(gk.uid, 0.25);
  } else {
    sfx.ooh(); view.label('WIDE!', ex, ey + (top ? 30 : -30), '#fff');
    await view.wait(0.6);
    gv.anim--; gv.pose = 'idle';
    view.labelAt(gk.c, gk.r, 'Goal kick', '#fff', 0.9);
    await view.give(gk.uid, 0.6);          // ball comes back for the goal kick
  }
  log(`${top ? '🥅' : '😮'} ${who} shoots (${why}) — ${result === 'save' ? `${nm(gk)} saves` : 'wide'}.`, top ? 'bad' : 'good');
  await view.wait(0.25);
  m.ball = gk.uid; m.poss = R.other(sideAtk);
  m.flags.keeperUnset = false;
  return result;
}

async function goalScored(sideAtk, u, why) {
  const top = sideAtk === 'you';
  view.pitch.goal(top);
  m.score[top ? 0 : 1]++;
  sfx.goal();
  view.hitstop = 0.25;
  shell.flash(top ? '#FFD23F' : '#E8463A');
  shell.shake(stage.querySelector('.pitchwrap'));
  shell.banner(top ? 'GOAL!' : 'Redrock score', `${nm(u)} · ${clock()}`, top ? undefined : '#FF8A80');
  if (top) shell.confetti(); else sfx.groan();
  for (const x of m.units) view.pose(x.uid, x.side === sideAtk ? 'celebrate' : 'sad');
  log(`⚽ <b>GOAL ${top ? 'Sunbirds' : 'Redrock'}!</b> ${nm(u)} scores (${why}). ${m.score[0]}–${m.score[1]}.`, 'goal');
  shell.setScore({ home: m.score[0], away: m.score[1], clock: clock() });
  await view.wait(1.8);
  for (const x of m.units) view.pose(x.uid, 'idle');
  await kickoff(R.other(sideAtk));
  if (m.turn < m.maxTurn) await offerReward(top ? 'Goal! Pick a card' : 'Respond: pick a card');
}

// Everyone jogs back to kick-off shape while the ball is fetched to the taker.
async function kickoff(s) {
  tag('kickoff');
  const F = KO[s];
  m.units.forEach((u) => { const i = +u.uid.slice(1); const p = F[u.side][i]; u.c = p[0]; u.r = p[1]; });
  m.poss = s;
  m.ball = (s === 'you' ? 'y' : 'o') + '4';
  await Promise.all([...m.units.map((u) => view.moveTo(u.uid, u.c, u.r, 1.0)), view.give(m.ball, 1.0)]);
}

// ------------------------------------------------------------------ rewards + full time
// One sheet at a time: wait for the How-to (or any other sheet) to close.
async function sheetsClear() {
  while (document.querySelector('.sheet-wrap')) await new Promise((r) => setTimeout(r, 150));
}

async function offerReward(title) {
  const tok = phaseToken;
  await sheetsClear();
  if (tok !== phaseToken) return; // phase changed while we waited
  const pool = shuffle(R.REWARDS.filter((id) => R.cardUsable(m, id)));
  const picks = pool.slice(0, 3);
  // make sure both attack and defence cards are on offer
  if (picks.length === 3 && picks.every((p) => CARDS[p].side === CARDS[picks[0]].side)) {
    const alt = pool.find((id) => CARDS[id].side !== CARDS[picks[0]].side);
    if (alt) picks[2] = alt;
  }
  const p = shell.modal({
    title,
    html: `<p class="pitchline">Add one card to your deck.</p><div class="rewards">${picks.map((id, i) => cardHTML(id, { idx: i, key: i + 1 })).join('')}</div>`,
    buttons: [{ label: 'Skip', cls: 'paper small', value: -1 }],
    dismiss: false,
  });
  const wrap = shell.lastModal;
  const choose = (i) => {
    const id = picks[i];
    const d = m.decks[CARDS[id].side];
    d.list.push(id);
    d.draw.splice(Math.floor(Math.random() * (d.draw.length + 1)), 0, id);
    sfx.perfect();
    log(`➕ Added <b>${CARDS[id].name}</b> to your ${CARDS[id].side === 'def' ? 'defence' : 'attack'} deck.`, 'good');
    document.removeEventListener('keydown', onKey, true);
    wrap.querySelector('.row .btn').click();
  };
  const onKey = (e) => { const k = +e.key; if (k >= 1 && k <= picks.length) { e.stopPropagation(); choose(k - 1); } };
  document.addEventListener('keydown', onKey, true);
  wrap.querySelectorAll('.rewards .gcard').forEach((g) => { g.onclick = () => choose(+g.dataset.idx); });
  return p.then(() => document.removeEventListener('keydown', onKey, true));
}

async function fullTime() {
  m.over = true; busy = false;
  sfx.whistle(3);
  const [a, b] = m.score;
  const res = a > b ? 'WIN' : a === b ? 'DRAW' : 'LOSS';
  shell.banner('FULL TIME', `${a}–${b}`);
  log(`Full time: Sunbirds ${a}–${b} Redrock.`, 'info');
  render();
  await view.wait(1.6);
  if (a > b) { sfx.win(); shell.confetti(); } else if (a < b) sfx.lose();
  for (const x of m.units) view.pose(x.uid, (x.side === 'you') === (a > b) ? 'celebrate' : a === b ? 'idle' : 'sad');
  const order = ['early', 'mid', 'clutch'];
  const next = order[(order.indexOf(m.phase) + 1) % 3];
  const v = await shell.modal({
    title: `${res === 'WIN' ? '🏆 ' : ''}${res} · ${a}–${b}`,
    html: `<p>${res === 'WIN' ? 'The Sunbirds take it.' : res === 'DRAW' ? 'Honours even.' : 'Redrock hold on.'} Your attack deck ended with ${m.decks.atk.list.length} cards, defence with ${m.decks.def.list.length}.</p>`,
    buttons: [{ label: 'Play again', value: 'again' }, { label: `Next: ${PHASES[next] && shell.o.phases.find((p) => p.id === next).label}`, cls: 'paper', value: 'next' }],
  });
  if (v === 'again') shell.setPhase(m.phase);
  else if (v === 'next') shell.setPhase(next);
}

// ------------------------------------------------------------------ canvas overlays
function drawUnder(ctx, t) {
  if (!m) return;
  const { pitch, cw, ch } = view;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,.13)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 1; c < R.COLS; c++) { const x = pitch.x0 + c * cw; ctx.moveTo(x, pitch.y0); ctx.lineTo(x, pitch.y1); }
  for (let r = 1; r < R.ROWS; r++) { const y = pitch.y0 + r * ch; ctx.moveTo(pitch.x0, y); ctx.lineTo(pitch.x1, y); }
  ctx.stroke();
  const box = (c, r, fill, stroke, lw = 2) => {
    const x = pitch.x0 + c * cw, y = pitch.y0 + r * ch;
    roundRect(ctx, x + 2, y + 2, cw - 4, ch - 4, 6);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  };
  // rival presses: red cells
  if (m.plan?.kind === 'def' && !busy) {
    for (const it of m.plan.list) if (it.type === 'press') {
      for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
        const c = it.cell[0] + dc, r = it.cell[1] + dr;
        if (R.inside(c, r)) box(c, r, `rgba(232,70,58,${dc || dr ? 0.13 : 0.3})`, null);
      }
    }
  }
  if (sel && !sel.instant) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 6);
    if (!sel.actor) sel.actors.forEach((u, i) => box(u.c, u.r, `rgba(155,231,255,${0.18 + pulse * 0.15})`, i === sel.focus ? '#fff' : '#9BE7FF', i === sel.focus ? 3 : 2));
    else {
      box(sel.actor.c, sel.actor.r, 'rgba(255,255,255,.18)', '#fff', 2);
      sel.targets.forEach((tg, i) => { if (tg.cell[1] >= 0 && tg.cell[1] < R.ROWS) box(tg.cell[0], tg.cell[1], `rgba(255,210,63,${0.22 + pulse * 0.12})`, i === sel.focus ? '#fff' : 'rgba(255,210,63,.9)', i === sel.focus ? 3 : 2); });
    }
  }
  ctx.restore();
}

// Their goal chance: low is good for us, so the colour scale is inverted.
function threatBubble(ctx, x, y, p, big) {
  const txt = '⚽' + Math.round(p * 100) + '%';
  ctx.save();
  ctx.font = `700 ${big ? 12 : 10}px "Lilita One", system-ui`;
  const w = ctx.measureText(txt).width + 10, h = big ? 18 : 15;
  roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fillStyle = oddsColor(1 - p); ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = '#1b1b2f'; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(txt, x, y + 0.5);
  ctx.restore();
}

function reticle(ctx, x, y, r, color, t) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(x, y, r * (0.9 + 0.08 * Math.sin(t * 7)), 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - r * 1.3, y); ctx.lineTo(x - r * 0.5, y); ctx.moveTo(x + r * 0.5, y); ctx.lineTo(x + r * 1.3, y);
  ctx.moveTo(x, y - r * 1.3); ctx.lineTo(x, y - r * 0.5); ctx.moveTo(x, y + r * 0.5); ctx.lineTo(x, y + r * 1.3); ctx.stroke();
  ctx.restore();
}

function drawOver(ctx, t) {
  if (!m) return;
  // name tags under feet
  ctx.save();
  ctx.font = `800 ${Math.round(Math.max(9, view.size * 0.24))}px Nunito, system-ui`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const v of view.vis.values()) {
    const name = byId[v.cid].name.replace('Big ', '').replace('Iron ', '').replace('Spider ', '');
    const w = ctx.measureText(name).width + 8, y = v.y + view.size * 0.2;
    ctx.fillStyle = v.side === 'you' ? 'rgba(29,43,83,.75)' : 'rgba(122,20,16,.75)';
    roundRect(ctx, v.x - w / 2, y - 6, w, 12, 6); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(name, v.x, y + 0.5);
  }
  // dazed players (lost a tackle this turn)
  ctx.font = `${Math.round(Math.max(12, view.size * 0.34))}px system-ui`;
  for (const u of m.units) if (u.beaten) { const v = view.vis.get(u.uid); if (v) ctx.fillText('💫', v.x, v.y - view.size * 1.02 + Math.sin(t * 4) * 2); }
  ctx.restore();
  const C = (cl) => (cl[1] < 0 ? view.pitch.goalMouth(true) : cl[1] >= R.ROWS ? view.pitch.goalMouth(false) : view.center(...cl));
  const H = R.holder(m);
  if (m.plan && !busy) {
    if (m.plan.kind === 'def') {
      for (const it of m.plan.list) {
        const u = unit(it.uid);
        const [x0, y0] = view.center(u.c, u.r);
        if (it.type === 'step') {
          if (R.char(u).pos === 'GK') continue;
          const [x1, y1] = view.center(...it.to);
          drawArrow(ctx, x0, y0, x1, y1, 'rgba(255,107,107,.85)', { dash: [5, 5], width: 2, head: 6 });
        } else {
          const [x1, y1] = view.center(...it.cell);
          const live = H && H.side === 'you' && R.cheb(R.cell(H), it.cell) <= 1;
          const a = Math.atan2(y1 - y0, x1 - x0), back = view.size * 0.45;
          if (Math.hypot(x1 - x0, y1 - y0) > back + 4) drawArrow(ctx, x0, y0, x1 - Math.cos(a) * back, y1 - Math.sin(a) * back, '#FF5A4E', { width: 3, head: 8 });
          reticle(ctx, x1, y1, view.size * 0.32, live ? '#FF3B30' : 'rgba(255,255,255,.5)', t);
          if (live) drawOdds(ctx, x1, y1 - view.ch * 0.62, R.tackleOdds(u, H), '🦶');
        }
      }
    } else {
      const ev = R.evalAttack(m, m.plan);
      for (const r of ev.runs) {
        const u = unit(r.uid);
        const [x0, y0] = view.center(u.c, u.r), [x1, y1] = view.center(...r.to);
        drawArrow(ctx, x0, y0, x1, y1, r.blocked ? 'rgba(200,200,200,.6)' : 'rgba(255,107,107,.85)', { dash: [5, 5], width: 2, head: 6 });
      }
      ev.steps.forEach((s, i) => {
        const [x0, y0] = C(s.from), [x1, y1] = C(s.toCell);
        drawArrow(ctx, x0, y0, x1, y1, s.type === 'shoot' ? '#FF3B30' : '#FF6B6B', { width: s.type === 'shoot' ? 3.5 : 3, dash: s.type === 'dribble' ? [3, 4] : null, head: 9 });
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        drawOdds(ctx, mx, my, s.p, `${i + 1}.${s.type === 'shoot' ? '🥅' : s.offside ? '🚩' : ''}`);
      });
    }
  }
  if (sel && sel.actor && !busy) {
    sel.targets.forEach((tg, i) => {
      if (tg.threat != null) {
        const [x, y] = C(tg.cell);
        const better = tg.threat < sel.nowThreat - 0.005;
        if (better || i === sel.focus) threatBubble(ctx, x, y - view.ch * 0.15, tg.threat, i === sel.focus);
        return;
      }
      if (tg.p == null) return;
      const [x, y] = C(tg.cell);
      const yy = tg.goal ? y + 14 : y - view.ch * 0.15;
      if (tg.unit && CARDS[sel.id].kind === 'pass') {
        const [ax, ay] = view.center(sel.actor.c, sel.actor.r);
        ctx.save(); ctx.globalAlpha = i === sel.focus ? 0.95 : 0.35;
        drawArrow(ctx, ax, ay, x, y, '#FFD23F', { dash: CARDS[sel.id].lofted ? [6, 4] : null, width: 2.5, curve: CARDS[sel.id].lofted ? 30 : 0 });
        ctx.restore();
      }
      if (tg.goal) {
        const [ax, ay] = view.center(sel.actor.c, sel.actor.r);
        drawArrow(ctx, ax, ay, x, y + 4, '#FFD23F', { width: 3 });
      }
      ctx.save();
      if (i === sel.focus) { ctx.translate(x, yy); ctx.scale(1.15, 1.15); ctx.translate(-x, -yy); }
      drawOdds(ctx, x, yy, tg.p);
      ctx.restore();
    });
  }
}


// debug handle for playtesting in the console
window.cardGrid = { get m() { return m; }, get view() { return view; }, R };
