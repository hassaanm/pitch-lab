// Combo Hand — Balatro with a squad. Cards are players (number + position).
// Played cards line up in formation; neighbours in adjacent lines with close
// numbers form pass links (+Mult). Coaches are the jokers.
import { Shell, clamp, shuffle, oddsPill } from '../../shared/shell.js';
import { Pitch, drawPlayer, drawBall, setupCanvas, portrait, portraitCanvas, drawArrow, lerp } from '../../shared/art.js';
import { sfx } from '../../shared/sfx.js';
import { SUIT_NAME, SUIT_CLS, ROW_V, HANDS, handById, makeDeck, scorePlay, links, chainOf, detect, COACHES, BOSSES } from './rules.js';

const TIERS = [
  { name: 'Group stage', short: 'GRP', rival: 'Redrock Reserves', perGoal: 150, rivalGoals: 1, boss: 'none', variant: 'day', drawOk: true },
  { name: 'Knockout', short: 'KO', rival: 'Redrock United', perGoal: 300, rivalGoals: 2, boss: 'marking', variant: 'dusk' },
  { name: 'The Final', short: 'FINAL', rival: 'Redrock United', perGoal: 600, rivalGoals: 2, boss: 'var', variant: 'night' },
];
const PHASES = {
  early: { tier: 0, score: 0, plays: 4, discards: 3, money: 4, coaches: [], levels: {}, playsMade: 0, firstPlay: true,
    top: ['DF7', 'MF7', 'FW4', 'GK6', 'FW9', 'DF2', 'FW11', 'MF5'] },
  mid: { tier: 1, perGoal: 800, score: 1650, plays: 2, discards: 2, money: 6, coaches: ['gegen', 'ten', 'wonder'], levels: { hattrick: 2 }, playsMade: 5, firstPlay: false,
    top: ['DF10', 'MF9', 'FW8', 'MF6', 'GK3', 'DF6', 'FW10', 'MF4'] },
  clutch: { tier: 2, perGoal: 1200, score: 1250, plays: 2, discards: 1, money: 9, coaches: ['target', 'cat', 'bus', 'gegen', 'wonder'], levels: { hattrick: 2 }, playsMade: 9, firstPlay: false,
    top: ['FW9', 'MF9', 'DF9', 'GK8', 'MF6', 'FW7', 'DF3', 'MF2'] },
};
const HAND_SIZE = 8, MAX_PLAY = 5, MAX_COACHES = 5;

const shell = new Shell({
  id: 'combo-hand', title: 'Combo Hand',
  pitch: 'Balatro with your squad. Play poker-style hands of players, line them up in formation, and score goals.',
  how: [
    'Each card is a player: a <b>number</b> (2–11) and a <b>position</b> (GK, DF, MF, FW). Hold 8, play up to 5.',
    'The hand type gives <b>Chips × Mult</b>. Scoring cards add their number to Chips. The preview shows it live as you pick.',
    '<b>Formation:</b> played cards stand in their line. A card links to one card in the next line up if the numbers are within 1: <b>+1 Mult</b> each. A full GK→DF→MF→FW chain: <b>×2</b>.',
    'Every target reached is a <b>goal</b>. Outscore the rival before your 4 plays run out. 3 discards to fish for better cards.',
    '<b>Coaches</b> are your jokers. Buy more in the shop between matches. Group → Knockout → Final, each with a boss rule.',
    'Keys: <span class="kbd">1–8</span> pick, <span class="kbd">Enter</span> play, <span class="kbd">D</span> discard, <span class="kbd">Z</span> undo pick, <span class="kbd">S</span> sort.',
  ],
  notice: 'Does the football theme matter, or is it poker with stickers?',
  phases: [
    { id: 'early', label: 'Group', sub: '0–0 · no coaches' },
    { id: 'mid', label: 'Knockout', sub: '2–2 · 3 coaches · marked' },
    { id: 'clutch', label: 'Final', sub: '1–2 down · last 2 plays · VAR' },
  ],
  onPhase: (id) => newGame(id),
});

const root = shell.stage;
root.innerHTML = `
<div class="ch">
  <div class="topinfo panel dark">
    <div class="row1"><b class="tier"></b><span class="boss"></span><span class="money"></span></div>
    <div class="goalbar"><i class="ghost"></i><i class="fill"></i><div class="ticks"></div><b class="sc"></b></div>
    <div class="row2"><span class="plays"></span><span class="discards"></span><span class="need"></span></div>
  </div>
  <div class="coaches"></div>
  <div class="calc"><div class="hname"><b></b><small></small></div><div class="cm"><span class="chips">0</span><span class="x">×</span><span class="mult">0</span></div><div class="tot"></div></div>
  <div class="board"><canvas></canvas>
    <div class="extra"></div>
  </div>
  <div class="handwrap"><div class="hand"></div></div>
  <div class="actions">
    <button class="btn small ghost" data-a="sort">Sort <span class="key">S</span></button>
    <button class="btn red" data-a="discard">Discard <span class="key">D</span></button>
    <button class="btn" data-a="play">Play <span class="key">⏎</span></button>
  </div>
</div>`;
const $ = (q) => root.querySelector(q);
const boardEl = $('.board'), cv = $('canvas'), handEl = $('.hand'), coachesEl = $('.coaches'), calcEl = $('.calc'), extraEl = $('.extra');
const btnPlay = $('[data-a=play]'), btnDisc = $('[data-a=discard]'), btnSort = $('[data-a=sort]');

let ctx, pitch, W = 360, H = 200;
function sizeCanvas() {
  W = Math.min(boardEl.clientWidth - 6 || 360, 560);
  H = Math.round(clamp(W * 0.5, 180, 240));
  ctx = setupCanvas(cv, W, H);
  pitch = new Pitch(W, H, { variant: pitch?.variant || 'day' });
}
sizeCanvas();
window.addEventListener('resize', () => { sizeCanvas(); render(); });

const DECK = makeDeck();
const byCard = Object.fromEntries(DECK.map((c) => [c.id, c]));
let g = null;
let picks = [];      // selected hand indices, in pick order (for undo)
const B = { played: [], active: null, links: [], chain: null, ballT: -1, celebrate: 0 };

// ------------------------------------------------------------------ flow
function newGame(id) {
  const P = PHASES[id];
  const T = TIERS[P.tier];
  g = {
    phase: id, tier: P.tier, perGoal: P.perGoal || T.perGoal, score: P.score, plays: P.plays, discards: P.discards, money: P.money,
    coaches: [...P.coaches], levels: { ...P.levels }, playsMade: P.playsMade, firstPlay: P.firstPlay, sortBy: 'rank', mode: 'play',
    goals: 0, draw: [], hand: [],
  };
  startMatch(P.top, P.score);
  shell.log(`${T.name} vs ${T.rival}. They have ${T.rivalGoals} goal${T.rivalGoals > 1 ? 's' : ''}. Every ${g.perGoal} points is a goal for you.`, 'info', T.short);
  if (T.boss !== 'none') shell.log(`Boss rule — <b>${BOSSES[T.boss].name}</b>: ${BOSSES[T.boss].text}`, 'them', T.short);
}

function startMatch(top, score = 0) {
  const T = TIERS[g.tier];
  document.body.className = T.variant === 'night' ? 'floodlit' : T.variant;
  pitch.setVariant(T.variant);
  g.score = score;
  g.goals = Math.floor(score / g.perGoal);
  g.mode = 'play';
  const ids = new Set(top || []);
  g.draw = shuffle(DECK.filter((c) => !ids.has(c.id)));
  g.hand = top ? top.map((i) => byCard[i]) : [];
  fillHand();
  sortHand();
  picks = [];
  B.played = []; B.links = []; B.chain = null;
  updateScoreboard();
  render(true);
}

function fillHand() { while (g.hand.length < HAND_SIZE && g.draw.length) g.hand.push(g.draw.pop()); }
function sortHand() {
  const ord = { GK: 0, DF: 1, MF: 2, FW: 3 };
  g.hand.sort(g.sortBy === 'rank' ? (a, b) => b.rank - a.rank || ord[a.suit] - ord[b.suit] : (a, b) => ord[a.suit] - ord[b.suit] || b.rank - a.rank);
}
const T = () => TIERS[g.tier];
const winAt = () => (T().rivalGoals + 1) * g.perGoal;
const st = () => ({ levels: g.levels, coaches: g.coaches, playsMade: g.playsMade, discards: g.discards, boss: T().boss, firstPlay: g.firstPlay });
const selected = () => picks.map((i) => g.hand[i]);

function updateScoreboard() {
  shell.setScore({ home: g.goals, away: T().rivalGoals, clock: T().short });
}

function toggle(i) {
  if (g.mode !== 'play' || i < 0 || i >= g.hand.length) return;
  const k = picks.indexOf(i);
  if (k >= 0) picks.splice(k, 1);
  else if (picks.length < MAX_PLAY) picks.push(i);
  else { shell.toast('Max 5 cards'); sfx.bad(); return; }
  sfx.card();
  render();
}
function undoPick() { if (picks.length && g.mode === 'play') { picks.pop(); sfx.click(); render(); } }

function discard() {
  if (g.mode !== 'play' || !picks.length) return;
  if (!g.discards) { shell.toast('No discards left'); sfx.bad(); return; }
  const out = selected();
  [...picks].sort((a, b) => b - a).forEach((i) => g.hand.splice(i, 1));
  picks = [];
  g.discards -= 1;
  fillHand(); sortHand();
  sfx.deal();
  shell.log(`Discarded ${out.map(nameOf).join(', ')}. ${g.discards} discard${g.discards === 1 ? '' : 's'} left.`, 'info', T().short);
  render(true);
}

async function play() {
  if (g.mode !== 'play' || !picks.length || !g.plays) return;
  g.mode = 'scoring';
  const cards = selected();
  const res = scorePlay(cards, st());
  // fly cards from hand onto the formation
  B.played = cards.map((c) => ({ card: c, pos: slotOf(c, cards) }));
  B.links = []; B.chain = null; B.active = null;
  const handEls = picks.map((i) => handEl.children[i]);
  handEls.forEach((el, k) => el && flyTo(el, B.played[k].pos, k * 60));
  [...picks].sort((a, b) => b - a).forEach((i) => g.hand.splice(i, 1));
  picks = [];
  B.hidden = true;
  render();
  await wait(380 + cards.length * 60);
  B.hidden = false;
  sfx.thud();
  // cascade
  let chips = res.hand.chips + (res.lv - 1) * res.hand.lc, mult = res.hand.mult + (res.lv - 1) * res.hand.lm;
  calcShow(res.hand.name + (res.lv > 1 ? ` lv${res.lv}` : ''), chips, mult, '');
  bump(calcEl.querySelector('.hname'));
  sfx.whoosh();
  await wait(420);
  for (const s of res.steps) {
    if (s.kind === 'card') {
      B.active = s.card.id;
      const p = B.played.find((x) => x.card.id === s.card.id).pos;
      shell.popupAt(cv, p[0], p[1] - 30, s.label, s.chips ? '#81d4fa' : '#ff8a7a');
      chips += s.chips; s.chips ? sfx.tick() : sfx.bad();
      calcShow(null, chips, mult); bump(calcEl.querySelector('.chips'));
      await wait(260);
    } else if (s.kind === 'link') {
      B.links.push(s.link);
      const a = posOf(s.link[0]), b = posOf(s.link[1]);
      shell.popupAt(cv, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 10, 'Link +1', '#ff8a7a');
      mult += 1; sfx.pass(); calcShow(null, chips, mult); bump(calcEl.querySelector('.mult'));
      await wait(240);
    } else if (s.kind === 'chain') {
      B.chain = s.chain; B.ballT = performance.now() / 1000;
      shell.popupAt(cv, W / 2, H / 2, 'OUT FROM THE BACK ×2', '#ffd23f');
      mult *= 2; sfx.perfect(); calcShow(null, chips, mult); bump(calcEl.querySelector('.mult'));
      await wait(700);
    } else if (s.kind === 'coach') {
      B.active = null;
      const el = coachesEl.querySelector(`[data-c="${s.coach}"]`);
      if (el) { bump(el, 'fire'); const r = el.getBoundingClientRect(); shell.popup(s.label, r.left + r.width / 2, r.top + 10, s.chips ? '#81d4fa' : '#ff8a7a'); }
      if (s.chips) chips += s.chips;
      if (s.mult) mult += s.mult;
      if (s.x) mult *= s.x;
      mult = Math.round(mult * 10) / 10;
      s.x ? sfx.good() : sfx.tick();
      calcShow(null, chips, mult); bump(calcEl.querySelector(s.chips ? '.chips' : '.mult'));
      await wait(360);
    } else if (s.kind === 'var') {
      shell.toast('📺 VAR check… first play counts <b>half</b>', 1400); sfx.whistle(2);
      await wait(800);
    }
  }
  B.active = null;
  // total count-up
  const total = res.total;
  const big = total >= g.perGoal;
  calcEl.classList.toggle('flame', big);
  await countUp(total);
  if (big) { sfx.roar(0.7); shell.shake(calcEl); }
  shell.log(`<b>${res.hand.name}</b> (${cards.map(nameOf).join(', ')}): ${chips} chips × ${mult} mult = <b>${total}</b>${res.links.length ? ` · ${res.links.length} link${res.links.length > 1 ? 's' : ''}` : ''}${res.chain ? ' · out from the back ×2' : ''}${res.marked ? ` · ${nameOf(res.marked)} man-marked` : ''}${res.steps.some((s) => s.kind === 'var') ? ' · VAR halved it' : ''}.`, big ? 'good' : '', T().short);
  await wait(400);
  // goals
  const before = g.goals;
  g.score += total;
  g.goals = Math.floor(g.score / g.perGoal);
  g.plays -= 1; g.playsMade += 1; g.firstPlay = false;
  render();
  for (let k = before; k < g.goals; k++) { await goalCelebration(k + 1); }
  calcEl.classList.remove('flame');
  B.played = []; B.links = []; B.chain = null;
  fillHand(); sortHand();
  g.mode = 'play';
  render(true);
  checkEnd();
}

async function goalCelebration(n) {
  B.ballT = performance.now() / 1000; B.chain = B.chain || null;
  pitch.goal(true); B.celebrate = performance.now() / 1000 + 2.2;
  sfx.goal(); shell.flash('#fff'); shell.shake(boardEl); shell.confetti(90);
  updateScoreboard();
  shell.banner('GOAL!', `${n}–${T().rivalGoals}`);
  shell.log(`<b>GOAL!</b> Score passed ${n * g.perGoal}. ${n}–${T().rivalGoals}.`, 'goal', T().short);
  await wait(1300);
}

async function checkEnd() {
  const t = T();
  if (g.goals > t.rivalGoals) return matchWon(false);
  if (g.plays > 0) return;
  g.mode = 'over';
  if (g.goals === t.rivalGoals) {
    if (t.drawOk) { shell.log('Full time: a draw. In the group a point is enough — you go through.', 'info', 'FT'); return matchWon(true); }
    const v = await shell.modal({ title: `Full time · ${g.goals}–${t.rivalGoals}`, html: `<p>Level. It goes to penalties.</p><p>Shootout odds: ${oddsPill(0.5, 'Win')}</p>`, buttons: [{ label: 'Take the penalties', value: 'p' }], dismiss: false });
    if (v === 'p') {
      const won = Math.random() < 0.5;
      shell.log(`Penalties (50%): ${won ? '<b>you win the shootout!</b>' : 'Redrock win the shootout.'}`, won ? 'good' : 'bad', 'PENS');
      if (won) return matchWon(false, true);
      return matchLost();
    }
  }
  matchLost();
}

async function matchLost() {
  g.mode = 'over';
  sfx.lose();
  shell.log(`<b>Knocked out.</b> ${g.goals}–${T().rivalGoals}.`, 'bad', 'FT');
  render();
  const v = await shell.modal({ title: 'Knocked out', html: `<p>${g.goals}–${T().rivalGoals} against ${T().rival}. Score ${g.score} of ${winAt()} needed.</p>`, buttons: [{ label: 'Replay this phase', value: 'r' }, { label: 'Close', cls: 'paper', value: 'c' }] });
  if (v === 'r') newGame(g.phase);
}

async function matchWon(draw, pens) {
  g.mode = 'over';
  const t = T();
  const earn = (draw ? 3 : 5) + g.plays + Math.min(3, Math.floor(g.money / 5));
  g.money += earn;
  if (!draw) { sfx.win(); shell.confetti(); }
  shell.log(`${draw ? 'Through with a draw' : pens ? 'Won on penalties' : 'Match won'}! +$${earn} (${draw ? 3 : 5} base, $${g.plays} for unused plays, interest).`, 'good', 'FT');
  render();
  if (g.tier === 2) {
    const v = await shell.modal({ title: '🏆 Champions!', html: `<p>Sunbirds FC win the cup! Final score ${g.goals}–${t.rivalGoals}.</p><p class="muted">Coaches: ${g.coaches.map((c) => COACHES[c].name).join(', ') || 'none'}</p>`, buttons: [{ label: 'Play again', value: 'r' }] });
    if (v === 'r') newGame('early');
    return;
  }
  await shop(earn);
  g.tier += 1;
  g.perGoal = TIERS[g.tier].perGoal;
  g.plays = 4; g.discards = 3; g.firstPlay = true;
  const nt = T();
  shell.log(`${nt.name} vs ${nt.rival}: they have ${nt.rivalGoals}. A goal every ${g.perGoal}.`, 'info', nt.short);
  if (nt.boss !== 'none') shell.log(`Boss rule — <b>${BOSSES[nt.boss].name}</b>: ${BOSSES[nt.boss].text}`, 'them', nt.short);
  startMatch(null, 0);
  shell.banner(nt.name.toUpperCase(), BOSSES[nt.boss].name);
}

// ------------------------------------------------------------------ shop
function shop(earn) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';
    let offer = [], upg = null;
    const roll = () => {
      offer = shuffle(Object.keys(COACHES).filter((k) => !g.coaches.includes(k))).slice(0, 2).map((id) => ({ id, sold: false }));
      upg = { id: shuffle(HANDS.filter((h) => !['golazo'].includes(h.id)))[0].id, sold: false };
    };
    roll();
    const draw = () => {
      const H = handById[upg.id], lv = g.levels[upg.id] || 1;
      wrap.innerHTML = `<div class="sheet panel shop"><h2>Transfer window</h2>
        <p class="muted" style="margin:0">Won +$${earn}. Coaches: ${g.coaches.length}/${MAX_COACHES}.</p>
        <div class="bank">$${g.money}</div>
        <div class="shelf">${offer.map((o, i) => `<div class="item" data-i="${i}">${coachCard(o.id, true)}<button class="btn small ${o.sold || g.money < COACHES[o.id].price || g.coaches.length >= MAX_COACHES ? 'disabled' : ''}" data-buy="${i}">${o.sold ? 'Signed' : `Sign $${COACHES[o.id].price}`}</button></div>`).join('')}
          <div class="item"><div class="gcard rare upgcard"><div class="cost">⬆</div><div class="name">${H.name}</div><div class="art">📈</div><div class="type">Training · lv${lv}→${lv + 1}</div><div class="text">+${H.lc} Chips, +${H.lm} Mult</div></div><button class="btn small ${upg.sold || g.money < 3 ? 'disabled' : ''}" data-up="1">${upg.sold ? 'Done' : 'Train $3'}</button></div>
        </div>
        <div class="row"><button class="btn small paper" data-roll="1">Reroll $2</button><span class="grow"></span><button class="btn green" data-next="1">Next match ▶</button></div></div>`;
      wrap.querySelectorAll('[data-buy]').forEach((b) => b.onclick = () => {
        const o = offer[+b.dataset.buy]; const c = COACHES[o.id];
        if (o.sold || g.money < c.price || g.coaches.length >= MAX_COACHES) { sfx.bad(); return; }
        g.money -= c.price; g.coaches.push(o.id); o.sold = true; sfx.coin();
        shell.log(`Signed coach <b>${c.name}</b>: ${c.text}.`, 'good', 'SHOP'); draw();
      });
      wrap.querySelector('[data-up]').onclick = () => {
        if (upg.sold || g.money < 3) { sfx.bad(); return; }
        g.money -= 3; g.levels[upg.id] = (g.levels[upg.id] || 1) + 1; upg.sold = true; sfx.coin();
        shell.log(`Trained <b>${H.name}</b> to level ${g.levels[upg.id]}.`, 'good', 'SHOP'); draw();
      };
      wrap.querySelector('[data-roll]').onclick = () => { if (g.money < 2) { sfx.bad(); return; } g.money -= 2; roll(); sfx.deal(); draw(); };
      wrap.querySelector('[data-next]').onclick = () => { sfx.click(); wrap.remove(); resolve(); };
    };
    draw();
    document.body.appendChild(wrap);
  });
}

// ------------------------------------------------------------------ rendering helpers
const nameOf = (c) => `${c.char.name} (${c.suit}${c.rank})`;
function cardHTML(c, i) {
  const on = picks.includes(i);
  return `<div class="gcard ${SUIT_CLS[c.suit]}${c.star ? ' star' : ''}${on ? ' sel' : ''}" data-i="${i}">
    <div class="cost">${c.rank}</div><div class="name">${c.char.name}</div>
    <div class="art" style="background-image:url(${portrait(c.char, 80)})"></div>
    <div class="type">${c.suit} · ${SUIT_NAME[c.suit]}</div><div class="text">${c.star ? `★ ${c.char.nick}` : 'Squad'}</div>
    <span class="kh">${i + 1}</span></div>`;
}
const coachArtCache = {};
function coachArt(id) {
  if (coachArtCache[id]) return coachArtCache[id];
  const co = COACHES[id];
  const ch = { id: 'coach_' + id, team: 'sun', pos: 'MF', num: 0, build: 'mid', boots: '#222', ...co.look };
  const c2 = portraitCanvas(ch, 72);
  const x = c2.getContext('2d');
  // tracksuit jacket + club badge over the kit
  x.fillStyle = '#1D2B53'; x.strokeStyle = '#1b1b2f'; x.lineWidth = 2;
  x.beginPath(); x.moveTo(6, 72); x.quadraticCurveTo(10, 50, 36, 50); x.quadraticCurveTo(62, 50, 66, 72); x.closePath(); x.fill(); x.stroke();
  x.fillStyle = '#fff'; x.beginPath(); x.moveTo(30, 50); x.lineTo(36, 64); x.lineTo(42, 50); x.closePath(); x.fill();
  x.fillStyle = '#FFD23F'; x.beginPath(); x.arc(52, 60, 4.5, 0, Math.PI * 2); x.fill(); x.stroke();
  coachArtCache[id] = c2.toDataURL();
  return coachArtCache[id];
}
function coachCard(id, full = false) {
  const co = COACHES[id];
  const badge = co.badge && g ? `<span class="cbadge">${co.badge(st())}</span>` : '';
  return `<div class="gcard rare coach${full ? '' : ' mini'}" data-c="${id}"><div class="name">${co.name}</div><div class="art" style="background-image:url(${coachArt(id)})"></div>${badge}<div class="type">Coach</div><div class="text">${co.text}</div></div>`;
}
function calcShow(name, chips, mult, tot) {
  if (name != null) calcEl.querySelector('.hname b').textContent = name;
  calcEl.querySelector('.chips').textContent = Math.round(chips);
  calcEl.querySelector('.mult').textContent = Math.round(mult * 10) / 10;
  if (tot != null) calcEl.querySelector('.tot').innerHTML = tot;
}
async function countUp(total) {
  const el = calcEl.querySelector('.tot');
  const t0 = performance.now(), dur = clamp(total / 3, 400, 1100);
  return new Promise((r) => {
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      el.innerHTML = `= <b>${Math.round(total * (1 - Math.pow(1 - k, 3)))}</b>`;
      if (k < 1) { if (Math.random() < 0.4) sfx.tick(); setTimeout(() => step(performance.now()), 16); } else { bump(el); r(); }
    };
    step(t0);
  });
}
function bump(el, cls = 'bump') { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

// formation slot (canvas px) for a card within a set of played cards
function slotOf(c, cards) {
  const row = cards.filter((x) => x.suit === c.suit).sort((a, b) => a.rank - b.rank);
  const k = row.indexOf(c), n = row.length;
  const u = n === 1 ? { GK: 0.5, DF: 0.38, MF: 0.62, FW: 0.46 }[c.suit] : 0.2 + (0.6 * k) / (n - 1);
  return pitch.toPx(u, ROW_V[c.suit]);
}
const posOf = (c) => (B.played.find((x) => x.card.id === c.id) || { pos: [0, 0] }).pos;

function flyTo(el, pos, delay) {
  const r = el.getBoundingClientRect(), cr = cv.getBoundingClientRect();
  const c = el.cloneNode(true);
  Object.assign(c.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', transform: 'none', zIndex: 75, margin: 0, animation: 'none', pointerEvents: 'none' });
  document.body.appendChild(c);
  const dx = cr.left + pos[0] - (r.left + r.width / 2), dy = cr.top + pos[1] - 20 - (r.top + r.height / 2);
  const an = c.animate([
    { transform: 'translate(0,0) scale(1)', opacity: 1 },
    { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 30}px) rotate(-8deg) scale(.8)`, opacity: 1, offset: 0.5 },
    { transform: `translate(${dx}px, ${dy}px) rotate(6deg) scale(.3)`, opacity: 0.2 },
  ], { duration: 380, delay, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'backwards' });
  an.onfinish = () => c.remove();
  setTimeout(() => c.remove(), 450 + delay + 300);
}

function render(deal = false) {
  if (!g) return;
  const t = T();
  // top info
  $('.tier').textContent = `${t.name} · vs ${t.rival}`;
  $('.boss').innerHTML = t.boss === 'none' ? '' : `<span class="bosschip" title="${BOSSES[t.boss].text}">⚠ ${BOSSES[t.boss].name}${t.boss === 'var' && !g.firstPlay ? ' (used)' : ''}</span>`;
  $('.money').textContent = `$${g.money}`;
  const cap = Math.max(winAt(), (g.goals + 1) * g.perGoal);
  const sel = selected();
  const pv = sel.length && g.mode === 'play' ? scorePlay(sel, st()) : null;
  $('.goalbar .fill').style.width = Math.min(100, (g.score / cap) * 100) + '%';
  $('.goalbar .ghost').style.width = Math.min(100, ((g.score + (pv?.total || 0)) / cap) * 100) + '%';
  let ticks = '';
  for (let k = 1; k * g.perGoal <= cap; k++) {
    const isWin = k === t.rivalGoals + 1, isDraw = k === t.rivalGoals;
    ticks += `<span class="tick${g.score >= k * g.perGoal ? ' got' : ''}${isWin ? ' win' : ''}" style="left:${(k * g.perGoal / cap) * 100}%">${isWin ? '🏆' : isDraw ? '=' : '⚽'}</span>`;
  }
  $('.goalbar .ticks').innerHTML = ticks;
  $('.goalbar .sc').textContent = `${g.score}${pv ? ` + ${pv.total}` : ''} / ${winAt()}`;
  $('.plays').innerHTML = `Plays <b>${g.plays}</b>`;
  $('.discards').innerHTML = `Discards <b>${g.discards}</b>`;
  const needWin = Math.max(0, winAt() - g.score);
  $('.need').innerHTML = g.goals > t.rivalGoals ? 'Winning!' : `Need <b>${needWin}</b> to win`;
  // coaches
  coachesEl.innerHTML = g.coaches.map((c) => coachCard(c)).join('') + Array.from({ length: MAX_COACHES - g.coaches.length }, () => `<div class="slot">${g.coaches.length ? 'empty' : 'coach'}</div>`).join('');
  coachesEl.classList.toggle('none', !g.coaches.length);
  coachesEl.querySelectorAll('.coach').forEach((el) => { el.onclick = () => shell.toast(`<b>${COACHES[el.dataset.c].name}</b>: ${COACHES[el.dataset.c].text}`, 2400); });
  // live preview
  if (g.mode === 'play') {
    if (pv) {
      calcShow(`${pv.hand.name}${pv.lv > 1 ? ` lv${pv.lv}` : ''}`, pv.chips, pv.mult, `= <b>${pv.total}</b>`);
      calcEl.querySelector('.hname small').textContent = pv.total >= g.perGoal ? ` ⚽ ${Math.floor((g.score + pv.total) / g.perGoal) - g.goals} goal${Math.floor((g.score + pv.total) / g.perGoal) - g.goals === 1 ? '' : 's'}!` : '';
      const bits = [];
      bits.push(`${pv.det.scoring.length} scoring`);
      if (pv.links.length) bits.push(`🔗 ${pv.links.length} link${pv.links.length > 1 ? 's' : ''} +${pv.links.length}`);
      if (pv.chain) bits.push('⛓ chain ×2');
      pv.steps.filter((s) => s.kind === 'coach').forEach((s) => bits.push(`${COACHES[s.coach].name} ${s.label}`));
      if (pv.marked) bits.push(`🚫 ${pv.marked.char.name} marked`);
      if (pv.steps.some((s) => s.kind === 'var')) bits.push('📺 VAR ½');
      extraEl.innerHTML = bits.map((b) => `<span>${b}</span>`).join('');
      calcEl.classList.remove('empty');
    } else {
      calcShow('Pick up to 5', 0, 0, '');
      calcEl.querySelector('.hname small').textContent = '';
      extraEl.innerHTML = '<span>Links: neighbouring lines, numbers within 1</span>';
      calcEl.classList.add('empty');
    }
  }
  // hand
  handEl.innerHTML = g.hand.map((c, i) => cardHTML(c, i)).join('');
  [...handEl.children].forEach((el, i) => {
    el.onclick = () => toggle(i);
    if (deal) { el.classList.add('dealt'); el.style.animationDelay = i * 40 + 'ms'; }
  });
  layoutHand();
  const active = g.mode === 'play';
  btnPlay.disabled = !active || !picks.length || !g.plays;
  btnDisc.disabled = !active || !picks.length || !g.discards;
  btnDisc.firstChild.textContent = `Discard (${g.discards}) `;
  btnSort.firstChild.textContent = g.sortBy === 'rank' ? 'Sort: # ' : 'Sort: pos ';
}

function layoutHand() {
  const cards = [...handEl.children];
  const n = cards.length, Wd = handEl.clientWidth || 360, cw = cards[0]?.offsetWidth || 86;
  const step = n > 1 ? Math.min(cw + 4, (Wd - cw) / (n - 1)) : 0;
  const x0 = (Wd - (cw + step * (n - 1))) / 2;
  cards.forEach((c, i) => {
    const mid = (n - 1) / 2, on = picks.includes(i);
    c.style.left = x0 + i * step + 'px';
    c.style.transform = on ? 'translateY(-22px)' : `translateY(${Math.abs(i - mid) ** 2 * 1.2}px) rotate(${(i - mid) * 2.2}deg)`;
    c.style.zIndex = i + 1;
  });
}

// ------------------------------------------------------------------ canvas
let lastT = 0;
function frame(now) {
  const t = now / 1000, dt = Math.min(0.05, t - lastT || 0.016); lastT = t;
  if (g) drawBoard(t, dt);
  requestAnimationFrame(frame);
}
function drawBoard(t, dt) {
  ctx.clearRect(0, 0, W, H);
  pitch.draw(ctx, t, dt);
  // line labels
  ctx.save();
  ctx.font = '11px "Lilita One", system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (const [s, v] of Object.entries(ROW_V)) {
    const [x, y] = pitch.toPx(0, v);
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(x, y - 1, pitch.pw, 2);
    ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillText(s, x + 4, y - 9);
  }
  ctx.restore();
  // what to draw: scoring board, or a live ghost preview of the selection
  let show = B.played, ghost = false, ls = B.links, chain = B.chain;
  if (g.mode === 'play' && picks.length) {
    const sel = selected();
    show = sel.map((c) => ({ card: c, pos: slotOf(c, sel) }));
    ls = links(sel); chain = chainOf(ls); ghost = true;
  }
  if (B.hidden) show = [];
  const sz = clamp(H * 0.2, 30, 48);
  // pass links
  for (const [a, b] of ls) {
    const pa = (show.find((x) => x.card.id === a.id) || {}).pos, pb = (show.find((x) => x.card.id === b.id) || {}).pos;
    if (!pa || !pb) continue;
    const inChain = chain && chain.includes(a) && chain.includes(b);
    drawArrow(ctx, pa[0], pa[1] - sz * 0.35, pb[0], pb[1] + 4, inChain ? '#FFD23F' : 'rgba(255,255,255,.9)', { dash: ghost ? [5, 5] : null, width: inChain ? 3.5 : 2.5, curve: (pb[0] - pa[0]) * 0.2 });
  }
  const celebrating = t < B.celebrate;
  const sorted = [...show].sort((a, b) => a.pos[1] - b.pos[1]);
  for (const p of sorted) {
    const c = p.card;
    const act = B.active === c.id;
    const pose = celebrating ? 'celebrate' : act ? (c.suit === 'FW' ? 'kick' : c.suit === 'GK' ? 'dive' : 'pass') : c.suit === 'GK' ? 'ready' : 'idle';
    drawPlayer(ctx, c.char, p.pos[0], p.pos[1] + 6, { size: sz * (act ? 1.15 : 1), pose, t, alpha: ghost ? 0.85 : 1, glow: act ? '#FFD23F' : null });
    // number badge
    ctx.save();
    ctx.font = '12px "Lilita One", system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const bx = p.pos[0] + sz * 0.38, by = p.pos[1] - sz * 0.62;
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1b1b2f'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(bx, by, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#1b1b2f'; ctx.fillText(c.rank, bx, by + 0.5);
    ctx.restore();
  }
  // ball: runs the chain, or flies to the net on a goal
  if (B.ballT > 0 && t - B.ballT < 1.6 && show.length) {
    const path = (chain || [...show].sort((a, b) => b.pos[1] - a.pos[1]).map((x) => x.card)).map((c) => posOf(c));
    path.push(pitch.toPx(0.5, -0.04));
    const k = clamp((t - B.ballT) / 1.2, 0, 1) * (path.length - 1);
    const i = Math.min(path.length - 2, Math.floor(k)), f = k - i;
    drawBall(ctx, lerp(path[i][0], path[i + 1][0], f), lerp(path[i][1], path[i + 1][1], f), 5, t * 14, Math.sin(f * Math.PI) * 10);
  }
  pitch.drawFront(ctx, t);
}
requestAnimationFrame(frame);
window.ch = { get g() { return g; } }; // debug hook

// ------------------------------------------------------------------ input
btnPlay.onclick = () => play();
btnDisc.onclick = () => discard();
btnSort.onclick = () => { g.sortBy = g.sortBy === 'rank' ? 'pos' : 'rank'; picks = []; sortHand(); sfx.click(); render(); };
window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.sheet-wrap') || !g) return;
  if (/^[1-8]$/.test(e.key)) toggle(+e.key - 1);
  else if (e.key === 'Enter') { e.preventDefault(); play(); }
  else if (e.key === 'd' || e.key === 'D') discard();
  else if (e.key === 'z' || e.key === 'Z') undoPick();
  else if (e.key === 's' || e.key === 'S') btnSort.click();
});
