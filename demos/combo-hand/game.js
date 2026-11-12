// Combo Hand — Balatro with a squad. Cards are players (number + position).
// Played cards line up in formation; neighbours in adjacent lines with close
// numbers form pass links (+Mult). Coaches are the jokers.
//
// Board model (polish pass): every sprite on the canvas is an "actor" with a
// position that only ever moves by tweening or speed-capped easing, and an
// alpha that fades. The ball is one object that is always at a player's feet,
// in flight, or in the keeper's hands / the net. Scoring is shown as play:
// the ball is passed to each scoring player and their chips pop on arrival;
// every play ends with a shot at Big Oskar — a goal only if the play pushed
// the score past the next goal line, otherwise he saves it.
import { Shell, clamp, shuffle, oddsPill } from '../../shared/shell.js';
import { Pitch, drawPlayer, drawBall, setupCanvas, portrait, portraitCanvas, drawArrow, lerp } from '../../shared/art.js';
import { sfx } from '../../shared/sfx.js';
import { byId } from '../../shared/cast.js';
import { SUIT_NAME, SUIT_CLS, ROW_V, HANDS, handById, makeDeck, scorePlay, links, chainOf, COACHES, BOSSES } from './rules.js';

const TIERS = [
  { name: 'Group stage', short: 'GRP', rival: 'Redrock Reserves', perGoal: 800, rivalGoals: 1, boss: 'none', variant: 'day', drawOk: true },
  { name: 'Knockout', short: 'KO', rival: 'Redrock United', perGoal: 625, rivalGoals: 2, boss: 'marking', variant: 'dusk' },
  { name: 'The Final', short: 'FINAL', rival: 'Redrock United', perGoal: 1500, rivalGoals: 2, boss: 'var', variant: 'night' },
];
const PHASES = {
  early: { tier: 0, score: 0, plays: 4, discards: 4, money: 4, coaches: [], levels: {}, playsMade: 0, firstPlay: true,
    top: ['DF7', 'MF7', 'FW4', 'GK6', 'FW9', 'DF2', 'FW11', 'MF5'] },
  mid: { tier: 1, perGoal: 625, score: 700, plays: 2, discards: 2, money: 6, coaches: ['gegen', 'ten', 'wonder'], levels: { hattrick: 2 }, playsMade: 5, firstPlay: false,
    top: ['DF10', 'MF9', 'FW8', 'MF6', 'GK3', 'DF6', 'FW10', 'MF4'] },
  clutch: { tier: 2, perGoal: 1500, score: 1800, plays: 2, discards: 2, money: 9, coaches: ['target', 'cat', 'bus', 'gegen', 'wonder'], levels: { hattrick: 2 }, playsMade: 9, firstPlay: false,
    top: ['FW9', 'MF9', 'DF9', 'GK8', 'MF6', 'FW7', 'DF3', 'MF2'] },
};
const HAND_SIZE = 8, MAX_PLAY = 5, MAX_COACHES = 5, DISCARDS = 4;
const GHOST = 0.55;          // alpha of preview players
const ABORT = Symbol('abort'); // thrown when a phase switch interrupts a play

// Slow motion for checking contact frames: ?jank=1 then window.__slow = 0.25
const SLOW = () => window.__slow || 1;
function wait(ms) { return new Promise((r) => setTimeout(r, ms / SLOW())); }

const shell = new Shell({
  id: 'combo-hand', title: 'Combo Hand',
  pitch: 'Balatro with your squad. Play poker-style hands of players, line them up in formation, and score goals.',
  how: [
    'Each card is a player: a <b>number</b> (2–11) and a <b>position</b> (GK, DF, MF, FW). Hold 8, play up to 5.',
    'The hand type gives <b>Chips × Mult</b>. Scoring cards add their number to Chips. The preview shows it live as you pick.',
    '<b>Formation:</b> played cards stand in their line. A card links to one card in the next line up if the numbers are within 1: <b>+1 Mult</b> each. A full GK→DF→MF→FW chain: <b>×2</b>.',
    'Each play ends with a shot. If your total crosses the next ⚽ line on the bar, it is a <b>goal</b>; if not, the keeper saves it but the points stay. <b>One play scores at most one goal</b>: its total is capped at one goal\'s worth. Outscore the rival before your 4 plays run out.',
    '<b>Discards are free</b> (4 per match) and draw you <b>one extra card</b> (hold up to 9). If your best hand is below the <b>need per play</b> shown under the pitch, discard to chase a better one. Group: score 800 to go through (a draw is enough), 1600 to win. Knockout: 1875 to win. Final: 4500 to win.',
    '<b>Coaches</b> are your jokers. Buy more in the shop between matches. Group → Knockout → Final, each with a boss rule.',
    'Keys: <span class="kbd">1–9</span> pick, <span class="kbd">Enter</span> play, <span class="kbd">D</span> discard, <span class="kbd">Z</span> undo pick, <span class="kbd">S</span> sort.',
  ],
  notice: 'Does the football theme matter, or is it poker with stickers?',
  phases: [
    { id: 'early', label: 'Group', sub: '0–0 · no coaches' },
    { id: 'mid', label: 'Knockout', sub: '1–2 down · last 2 plays · marked' },
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

let ctx, pitch, W = 360, H = 220;
function sizeCanvas() {
  W = Math.min(boardEl.clientWidth - 6 || 360, 560);
  H = Math.round(clamp(W * 0.6, 205, 260));
  ctx = setupCanvas(cv, W, H);
  pitch = new Pitch(W, H, { variant: pitch?.variant || 'day' });
  if (keeper) placeKeeperHome(true);
}

const DECK = makeDeck();
const byCard = Object.fromEntries(DECK.map((c) => [c.id, c]));
let g = null;
let picks = [];      // selected hand indices, in pick order (for undo)
// B: what the board shows. cards = the formation (preview or played).
const B = { cards: [], fired: new Set(), chainOn: false, active: null, celebrate: 0 };

// ------------------------------------------------------------------ actors + ball
// Actor: { id, char, x, y, tx, ty, a, ta, tw, pose, poseUntil, facing, pop, size }
const actors = new Map();
const sz = () => clamp(H * 0.17, 30, 44);
function actor(id, char) {
  let a = actors.get(id);
  if (!a) { a = { id, char, x: 0, y: 0, tx: 0, ty: 0, a: 0, ta: 0, tw: null, pose: null, poseUntil: 0, facing: 1, pop: 0, size: 1 }; actors.set(id, a); }
  return a;
}
// Ease toward a target; snap only while invisible (a deliberate, covered cut).
function aim(a, x, y) { a.tx = x; a.ty = y; if (a.a < 0.03 && !a.tw) { a.x = x; a.y = y; } }
// Timed move: arrives at (x, y) after exactly `dur` seconds.
function moveTo(o, x, y, dur, ease = 'out') {
  return new Promise((res) => { o.tw = { fx: o.x, fy: o.y, fh: o.h || 0, tx: x, ty: y, t: 0, d: dur, ease, res }; o.tx = x; o.ty = y; });
}
// Ease a lying pose (dive/tackle) down (to 1) or up (to 0) over `sec` seconds.
function layTo(a, to, sec) { if (a.lay == null) a.lay = to ? 0 : 1; a.layTo = to; a.layRate = 1 / Math.max(0.01, sec); }
function setPose(a, pose, ms) { a.pose = pose; a.poseUntil = performance.now() + ms / SLOW(); }

const ball = { x: 0, y: 0, h: 0, a: 0, ta: 0, tw: null, spin: 0, th: 0, arc: 0 };
function ballTo(x, y, dur, arc = 6, endH = 0) { ball.arc = arc; ball.th = endH; return moveTo(ball, x, y, dur, 'pass'); }
const feet = (a) => [a.tx + sz() * 0.24, a.ty + 8];

let keeper = null, hans = null;
function placeKeeperHome(snap) {
  const [x, y] = pitch.toPx(0.5, 0.03);
  keeper.tx = x; keeper.ty = y; keeper.ta = 1;
  if (snap) { keeper.x = x; keeper.y = y; keeper.a = 1; keeper.tw = null; }
}

function tickObj(o, dt, maxSpeed) {
  if (o.tw) {
    const w = o.tw;
    w.t += dt;
    const k = Math.min(1, w.t / w.d);
    const e = w.ease === 'pass' ? 1 - Math.pow(1 - k, 1.6) : w.ease === 'lin' ? k : 1 - Math.pow(1 - k, 2.2);
    o.x = lerp(w.fx, w.tx, e); o.y = lerp(w.fy, w.ty, e);
    if (o === ball) ball.h = lerp(w.fh, ball.th, e) + Math.sin(k * Math.PI) * ball.arc;
    if (k >= 1) { o.tw = null; w.res(); }
  } else {
    const dx = o.tx - o.x, dy = o.ty - o.y, d = Math.hypot(dx, dy);
    if (d > 0.01) {
      const step = Math.min(d * (1 - Math.exp(-dt * 12)), maxSpeed * dt);
      o.x += (dx / d) * step; o.y += (dy / d) * step;
    }
  }
  const fade = dt * 5;
  o.a += clamp(o.ta - o.a, -fade, fade);
}

// Lay out the formation for a set of cards (preview or played).
function setFormation(cards, alpha) {
  const ids = new Set(cards.map((c) => c.id));
  for (const a of actors.values()) if (a.card && !ids.has(a.id)) a.ta = 0;
  for (const c of cards) {
    const a = actor(c.id, c.char); a.card = c;
    const [x, y] = slotOf(c, cards);
    aim(a, x, y); a.ta = alpha;
  }
  B.cards = cards;
  // Iron Hans stands goal-side of the card he marks.
  const marked = T().boss === 'marking' && cards.length ? [...cards].sort((p, q) => q.rank - p.rank)[0] : null;
  hans.markId = marked?.id || null;
  if (marked) { const [x, y] = slotOf(marked, cards); aim(hans, x + sz() * 0.9, y - sz() * 0.08); hans.ta = alpha; }
  else hans.ta = 0;
}

// ------------------------------------------------------------------ flow
function newGame(id) {
  const P = PHASES[id];
  const T0 = TIERS[P.tier];
  g = {
    phase: id, tier: P.tier, perGoal: P.perGoal || T0.perGoal, score: P.score, plays: P.plays, discards: P.discards, money: P.money,
    coaches: [...P.coaches], levels: { ...P.levels }, playsMade: P.playsMade, firstPlay: P.firstPlay, sortBy: 'rank', mode: 'play',
    goals: 0, draw: [], hand: [],
  };
  startMatch(P.top, P.score);
  shell.log(`${T0.name} vs ${T0.rival}. They have ${T0.rivalGoals} goal${T0.rivalGoals > 1 ? 's' : ''}. ${targetText(T0)} (a goal every ${g.perGoal}; one play scores at most one goal).`, 'info', T0.short);
  if (T0.boss !== 'none') shell.log(`Boss rule — <b>${BOSSES[T0.boss].name}</b>: ${BOSSES[T0.boss].text}`, 'them', T0.short);
}

function startMatch(top, score = 0) {
  const t = T();
  document.body.className = t.variant === 'night' ? 'floodlit' : t.variant;
  pitch.setVariant(t.variant);
  g.score = score;
  g.goals = Math.floor(score / g.perGoal);
  g.mode = 'play';
  const ids = new Set(top || []);
  g.draw = shuffle(DECK.filter((c) => !ids.has(c.id)));
  g.hand = top ? top.map((i) => byCard[i]) : [];
  fillHand();
  sortHand();
  picks = [];
  // fresh board: new match is a deliberate cut, everything starts invisible
  for (const a of [...actors.values()]) if (a.card) actors.delete(a.id);
  B.cards = []; B.fired = new Set(); B.chainOn = false; B.active = null; B.celebrate = 0;
  ball.a = 0; ball.ta = 0; ball.tw = null; ball.held = false;
  actors.delete('pen');
  syncTab();
  hans.a = 0; hans.ta = 0; hans.tw = null;
  placeKeeperHome(true); keeper.pose = null; keeper.lay = keeper.layTo = hans.lay = hans.layTo = null; hans.pose = null;
  for (const el of cardEls.values()) el.remove();
  cardEls.clear();
  updateScoreboard();
  render();
}

function fillHand(n = HAND_SIZE) { while (g.hand.length < n && g.draw.length) g.hand.push(g.draw.pop()); }
function sortHand() {
  const ord = { GK: 0, DF: 1, MF: 2, FW: 3 };
  g.hand.sort(g.sortBy === 'rank' ? (a, b) => b.rank - a.rank || ord[a.suit] - ord[b.suit] : (a, b) => ord[a.suit] - ord[b.suit] || b.rank - a.rank);
}
const T = () => TIERS[g.tier];
const winAt = () => (T().rivalGoals + 1) * g.perGoal;
const st = () => ({ levels: g.levels, coaches: g.coaches, playsMade: g.playsMade, discards: g.discards, boss: T().boss, firstPlay: g.firstPlay });
const selected = () => picks.map((i) => g.hand[i]);
// One play scores at most one goal: the total is capped at perGoal.
function scoreFor(cards) {
  const r = scorePlay(cards, st());
  if (!r) return r;
  r.raw = r.total; r.capped = r.total > g.perGoal; r.total = Math.min(r.total, g.perGoal);
  return r;
}

function updateScoreboard() {
  shell.setScore({ home: g.goals, away: T().rivalGoals, clock: T().short });
}

function toggle(i) {
  if (g.mode !== 'play' || i < 0 || i >= g.hand.length) return;
  const k = picks.indexOf(i);
  if (k >= 0) picks.splice(k, 1);
  else if (picks.length < MAX_PLAY) picks.push(i);
  else { note('Max 5 cards: tap a picked card to drop it'); sfx.bad(); return; }
  sfx.card();
  clearNote();
  render();
}
function undoPick() { if (picks.length && g.mode === 'play') { picks.pop(); sfx.click(); render(); } }

async function discard() {
  if (g.mode !== 'play' || !picks.length) return;
  if (!g.discards) { note('No discards left'); sfx.bad(); return; }
  const G = g;
  g.mode = 'busy';
  const out = selected();
  out.forEach((c, k) => dropOut(cardEls.get(c.id), k * 50));
  [...picks].sort((a, b) => b - a).forEach((i) => g.hand.splice(i, 1));
  picks = [];
  g.discards -= 1;
  sfx.deal();
  setFormation([], GHOST);
  render(); // ghosts fade off the pitch, remaining cards slide together
  shell.log(`Discarded ${out.map(nameOf).join(', ')}. ${g.discards} discard${g.discards === 1 ? '' : 's'} left.`, 'info', T().short);
  await wait(260 + out.length * 50);
  if (g !== G) return;
  fillHand(HAND_SIZE + 1); sortHand(); // a discard draws one extra card to choose from
  g.mode = 'play';
  render();
}

async function play() {
  if (g.mode !== 'play' || !picks.length || !g.plays) return;
  const G = g;
  const live = () => { if (g !== G) throw ABORT; };
  try { await runPlay(live); } catch (e) { if (e !== ABORT) throw e; }
}

async function runPlay(live) {
  g.mode = 'scoring';
  const cards = selected();
  const res = scoreFor(cards);
  const G = g;
  // 1. cards fly from the hand onto their ghost players; each turns solid as it lands
  setFormation(cards, GHOST);
  calcShow(res.hand.name + (res.lv > 1 ? ` lv${res.lv}` : ''), res.hand.chips + (res.lv - 1) * res.hand.lc, res.hand.mult + (res.lv - 1) * res.hand.lm, '');
  calcEl.querySelector('.hname small').textContent = '';
  B.fired = new Set(); B.chainOn = false; B.active = null;
  const FLY = 380;
  cards.forEach((c, k) => {
    const a = actors.get(c.id), delay = k * 70;
    flyTo(cardEls.get(c.id), [a.tx, a.ty], delay, FLY);
    setTimeout(() => { if (g !== G) return; a.ta = 1; a.a = Math.max(a.a, 0.8); a.pop = 1; sfx.card(); }, (delay + FLY) / SLOW());
  });
  if (hans.markId) hans.ta = 1;
  [...picks].sort((a, b) => b - a).forEach((i) => g.hand.splice(i, 1));
  picks = [];
  render();
  await wait(FLY + (cards.length - 1) * 70 + 150); live();
  sfx.thud();

  // 2. cascade: the ball is played to each scoring player; chips pop on arrival
  let chips = res.hand.chips + (res.lv - 1) * res.hand.lc, mult = res.hand.mult + (res.lv - 1) * res.hand.lm;
  calcShow(res.hand.name + (res.lv > 1 ? ` lv${res.lv}` : ''), chips, mult, '');
  calcEl.querySelector('.hname small').textContent = '';
  bump(calcEl.querySelector('.hname'));
  sfx.whoosh();
  await wait(380); live();
  let holder = null;
  const passTo = async (a) => {
    if (holder === a) return;
    if (!holder) { // first touch: the ball is rolled in to the player's feet
      const [fx, fy] = feet(a);
      ball.tw = null; ball.held = false; ball.x = fx; ball.y = fy + 26; ball.h = 0; ball.a = 0; ball.ta = 1;
      await moveTo(ball, fx, fy, 0.3, 'out');
    } else {
      setPose(holder, 'pass', 260); sfx.pass();
      const [fx, fy] = feet(a), d = Math.hypot(fx - ball.x, fy - ball.y);
      await ballTo(fx, fy, clamp(d / 420, 0.2, 0.42), clamp(d * 0.06, 2, 9));
    }
    holder = a; B.active = a.id;
  };
  for (const s of res.steps) {
    if (s.kind === 'card') {
      const a = actors.get(s.card.id);
      if (!s.chips) { // man-marked: Hans crouches, slides in, and the card scores 0 on contact
        hans.pose = 'ready'; hans.poseUntil = 0;
        await wait(140); live();
        hans.pose = 'tackle'; hans.facing = 1; // the tackle pose leans toward -facing (left, onto the card)
        hans.lay = 0; layTo(hans, 1, 0.3);
        await moveTo(hans, a.tx + sz() * 0.2, a.ty + 3, 0.3, 'out'); live();
        setPose(a, 'sad', 900);
        shell.popupAt(cv, a.tx, a.ty - 34, 'Marked! +0', '#ff8a7a'); sfx.bad();
        await wait(380); live();
        layTo(hans, 0, 0.3);
        await wait(320); live();
        hans.pose = null; hans.lay = null; hans.layTo = null;
        continue;
      }
      await passTo(a); live();
      shell.popupAt(cv, a.tx, a.ty - 34, s.label, '#81d4fa');
      chips += s.chips; sfx.tick();
      calcShow(null, chips, mult); bump(calcEl.querySelector('.chips'));
      await wait(260); live();
    } else if (s.kind === 'link') {
      B.fired.add(linkKey(s.link));
      const [a, b] = s.link.map((c) => actors.get(c.id));
      shell.popupAt(cv, (a.tx + b.tx) / 2, (a.ty + b.ty) / 2 - 18, 'Link +1', '#ff8a7a');
      mult += 1; sfx.pass(); calcShow(null, chips, mult); bump(calcEl.querySelector('.mult'));
      await wait(280); live();
    } else if (s.kind === 'chain') {
      // played back to the keeper, then out from the back along the chain
      for (const c of s.chain) { await passTo(actors.get(c.id)); live(); }
      B.chainOn = true;
      const f = actors.get(s.chain[3].id);
      shell.popupAt(cv, f.tx, f.ty - 40, 'OUT FROM THE BACK ×2', '#ffd23f');
      mult *= 2; sfx.perfect(); calcShow(null, chips, mult); bump(calcEl.querySelector('.mult'));
      await wait(560); live();
    } else if (s.kind === 'coach') {
      const el = coachesEl.querySelector(`[data-c="${s.coach}"]`);
      if (el) { bump(el, 'fire'); const r = el.getBoundingClientRect(); shell.popup(s.label, r.left + r.width / 2, r.top + 10, s.chips ? '#81d4fa' : '#ff8a7a'); }
      if (s.chips) chips += s.chips;
      if (s.mult) mult += s.mult;
      if (s.x) mult *= s.x;
      mult = Math.round(mult * 10) / 10;
      s.x ? sfx.good() : sfx.tick();
      calcShow(null, chips, mult); bump(calcEl.querySelector(s.chips ? '.chips' : '.mult'));
      await wait(380); live();
    }
  }
  // nobody touched it (every scorer was marked): it starts with the furthest-back player
  const played = cards.map((c) => actors.get(c.id));
  if (!holder) { await passTo([...played].sort((p, q) => q.ty - p.ty)[0]); live(); }

  // 3. total: count up; VAR then visibly halves it
  const total = res.total;
  const isVar = res.steps.some((s) => s.kind === 'var');
  const full = isVar ? Math.floor(res.chips * res.mult) : res.raw;
  await countUp(0, full); live();
  if (isVar) {
    note('📺 VAR check… first play counts <b>half</b>', 1600); sfx.whistle(2);
    await wait(700); live();
    await countUp(full, res.raw); live();
  }
  if (res.capped) { // one play is worth at most one goal
    note(`🧤 One play scores at most one goal: <b>${total}</b> counts`, 1600); sfx.tick();
    await wait(500); live();
    await countUp(res.raw, total); live();
  }
  const newGoals = Math.floor((g.score + total) / g.perGoal) - g.goals;
  const big = newGoals > 0;
  shell.log(`<b>${res.hand.name}</b> (${cards.map(nameOf).join(', ')}): ${res.chips} chips × ${res.mult} mult = <b>${total}</b>${res.links.length ? ` · ${res.links.length} link${res.links.length > 1 ? 's' : ''}` : ''}${res.chain ? ' · out from the back ×2' : ''}${res.marked ? ` · ${nameOf(res.marked)} man-marked` : ''}${isVar ? ' · VAR halved it' : ''}${res.capped ? ` · capped at ${total} (one goal)` : ''}.`, big ? 'good' : '', T().short);
  await wait(250); live();

  // 4. the move ends with a shot; the points reach the bar on the net / save frame
  g.plays -= 1; g.playsMade += 1; g.firstPlay = false;
  render();
  const fwd = [...played].sort((p, q) => p.ty - q.ty)[0];
  if (fwd !== holder) { await passTo(fwd); live(); }
  await shoot(holder, big, live, () => {
    g.score += total;
    if (big) {
      pitch.goal(true);
      g.goals += newGoals;
      B.celebrate = performance.now() / 1000 + 2.2 / SLOW();
      calcEl.classList.add('flame');
      sfx.goal(); shell.flash('#fff'); shell.shake(boardEl); shell.confetti(90);
      updateScoreboard(); render();
      shell.banner(newGoals > 1 ? `${newGoals} GOALS!` : 'GOAL!', `${g.goals}–${T().rivalGoals}`);
      shell.log(`<b>GOAL${newGoals > 1 ? `S ×${newGoals}` : ''}!</b> Score passed ${g.goals * g.perGoal}. ${g.goals}–${T().rivalGoals}.`, 'goal', T().short);
    } else {
      render();
      sfx.save(); shell.popupAt(cv, ball.x, ball.y - 30, 'SAVED', '#fff');
      shell.log(`Big Oskar saves. The ${total} still count: next goal at ${(g.goals + 1) * g.perGoal}, ${(g.goals + 1) * g.perGoal - g.score} more.`, '', T().short);
    }
  });
  calcEl.classList.remove('flame');

  // 5. clear: players and ball fade out together, keeper walks back
  await wait(big ? 400 : 250); live();
  for (const a of played) a.ta = 0;
  hans.ta = 0; ball.ta = 0; B.active = null;
  await wait(250); live();            // the ball fades in his hands before he moves
  ball.held = false;
  keeper.pose = 'run'; keeper.lay = null; keeper.layTo = null;
  moveTo(keeper, ...pitch.toPx(0.5, 0.03), 0.6, 'lin').then(() => { keeper.pose = null; keeper.facing = 1; });
  await wait(100); live();
  B.cards = []; B.fired = new Set(); B.chainOn = false;
  fillHand(); sortHand();
  g.mode = 'play';
  render();
  checkEnd();
}

// Shot at Big Oskar. Goal: ball and keeper start together, he dives the wrong
// way and the ball hits the net on its arrival frame. Save: his gloves and the
// ball reach the same point on the same frame, and the ball stays in his gloves
// while he gets up. onArrive(goal) runs on the contact frame.
async function shoot(from, goal, live, onArrive) {
  const [cx, gy] = pitch.goalMouth(true);
  const side = from.tx < cx - 4 ? 1 : from.tx > cx + 4 ? -1 : (Math.random() < 0.5 ? -1 : 1); // aim across the keeper
  const [bx, by] = [ball.x, ball.y];
  setPose(from, 'kick', 420); sfx.kick();
  B.active = null;
  keeper.poseUntil = 0;
  if (goal) {
    const net = [cx + side * pitch.goalW * 0.3, gy - pitch.netDepth * 0.5];
    const Tm = clamp(Math.hypot(net[0] - bx, net[1] - by) / 480, 0.32, 0.5);
    keeper.pose = 'dive'; keeper.facing = side; // reaches toward -facing: the wrong way
    keeper.lay = 0; layTo(keeper, 1, Tm);
    moveTo(keeper, keeper.x - side * keeperS() * 22, keeper.y, Tm, 'out');
    await ballTo(net[0], net[1], Tm, 8, 4); live();
    onArrive(true);
    await wait(800); live();          // he stays down through the goal
    layTo(keeper, 0, 0.35);           // and gets up
    await wait(380); live();
    keeper.pose = 'sad'; keeper.lay = null; keeper.layTo = null;
  } else {
    // where the shot crosses Oskar's line, a little to his side
    const kx = keeper.x, ky = keeper.y;
    const net = [cx + side * pitch.goalW * 0.22, gy - pitch.netDepth * 0.5];
    const f = clamp((by - (ky + 16)) / (by - net[1]), 0.3, 0.95); // in front of his line, so his dive stays on the pitch
    const save = [lerp(bx, net[0], f), lerp(by, net[1], f)];
    const Tm = clamp(Math.hypot(save[0] - bx, save[1] - by) / 480, 0.28, 0.46);
    const dir = save[0] >= kx ? 1 : -1;
    const H = 6; // ball height at the catch
    keeper.pose = 'dive'; keeper.facing = -dir; // reaches toward dir
    keeper.lay = 0; layTo(keeper, 1, Tm);  // goes down as he travels, fully down on the catch
    const [ox, oy] = gloveOffset('dive', keeper.facing, 1);
    moveTo(keeper, save[0] - ox, save[1] - H - oy, Tm, 'out');
    await ballTo(save[0], save[1], Tm, 6, H); live();
    ball.held = true;                 // from the contact frame the ball rides in his gloves
    onArrive(false);
    await wait(400); live();
    layTo(keeper, 0, 0.4);            // gets up with the ball raised in his gloves
    await wait(420); live();
  }
}

// Glove point of Big Oskar's sprite, relative to his actor position, from the
// shared/art.js drawPlayer geometry (build 'big': shoulders at y -24, arms 8.5
// long from x ±9). Dive: rot -1.35, lift 5, arms at -2.9 / -2.6 rad, so the
// gloves sit at (-26.8, -15.1) (over his face) and (-30.5, 3.0) (the low glove,
// on the pitch side, where the shot comes from) in design units × facing. The
// ball sits against the low glove at (-30.5, 11), clear of his head
// (head spans y -22..-2). Ready / idle: between the hands at the chest, (0, -15).
// The sprite is drawn 6 px below the actor's y.
const keeperS = () => (sz() * 0.9) / 44;
function gloveOffset(pose, facing, lay = 1) {
  const s = keeperS();
  if (pose === 'dive') {
    // ball point before the body rotation, Q = (-22.3, -26.3); rotate by rot·lay, then lift 5
    const r = -1.35 * lay, c = Math.cos(r), sn = Math.sin(r);
    const px = -22.3 * c + 26.3 * sn, py = -22.3 * sn - 26.3 * c - 5;
    return [facing * px * s, 6 + py * s];
  }
  return [0, 6 - 15 * s];
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
      try { await penaltyKick(won); } catch (e) { if (e !== ABORT) throw e; return; }
      shell.log(`Penalties (50%): ${won ? '<b>Rio scores the decider — you win the shootout!</b>' : 'Big Oskar saves the decider — Redrock win the shootout.'}`, won ? 'good' : 'bad', 'PENS');
      if (won) return matchWon(false, true);
      return matchLost(true);
    }
  }
  matchLost();
}

async function matchLost(pens) {
  g.mode = 'over';
  sfx.lose();
  shell.log(`<b>Knocked out${pens ? ' on penalties' : ''}.</b> ${g.goals}–${T().rivalGoals}.`, 'bad', 'FT');
  render();
  const body = pens
    ? `<p>${g.goals}–${T().rivalGoals} after full time, so it went to penalties (50%). Big Oskar saved the decider: Redrock win the shootout.</p>`
    : `<p>${g.goals}–${T().rivalGoals} against ${T().rival}. Score ${g.score} of ${winAt()} needed.</p>`;
  const v = await shell.modal({ title: pens ? 'Knocked out on penalties' : 'Knocked out', html: body, buttons: [{ label: 'Play again', value: 'r' }, { label: 'Close', cls: 'paper', value: 'c' }] });
  if (v === 'r') newGame(g.phase);
}

// The deciding penalty, shown on the pitch: Rio runs up to the spot and shoots;
// the 50% result decides goal or save, and the same shot animation shows it.
async function penaltyKick(won) {
  const G = g;
  const live = () => { if (g !== G) throw ABORT; };
  const [sx, sy] = pitch.toPx(0.5, 0.32);
  ball.tw = null; ball.held = false; ball.x = ball.tx = sx; ball.y = ball.ty = sy; ball.h = 0; ball.a = 0; ball.ta = 1;
  const rio = actor('pen', byId.rio);
  rio.tw = null; rio.x = rio.tx = sx - sz() * 0.9; rio.y = rio.ty = sy + sz() * 0.8; rio.a = 0; rio.ta = 1; rio.pose = 'idle'; rio.facing = 1;
  placeKeeperHome(false); keeper.pose = null; keeper.lay = keeper.layTo = null;
  shell.log('Sudden death: Rio takes the deciding penalty (50%).', 'info', 'PENS');
  await wait(700); live();
  rio.pose = 'run';
  await moveTo(rio, sx - sz() * 0.24, sy - 8, 0.4, 'lin'); live();
  rio.pose = null;
  await shoot(rio, won, live, (goal) => {
    if (goal) { pitch.goal(true); sfx.goal(); shell.flash('#fff'); shell.banner('SCORED!', 'You win the shootout'); }
    else { sfx.save(); shell.popupAt(cv, ball.x, ball.y - 30, 'SAVED', '#fff'); shell.banner('SAVED', 'Redrock win the shootout', '#ff8a7a'); }
  });
  await wait(500); live();
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
  const G = g;
  await shop(earn);
  if (g !== G) return;
  g.tier += 1;
  g.perGoal = TIERS[g.tier].perGoal;
  g.plays = 4; g.discards = DISCARDS; g.firstPlay = true;
  const nt = T();
  shell.log(`${nt.name} vs ${nt.rival}: they have ${nt.rivalGoals}. ${targetText(nt)} (a goal every ${g.perGoal}).`, 'info', nt.short);
  if (nt.boss !== 'none') shell.log(`Boss rule — <b>${BOSSES[nt.boss].name}</b>: ${BOSSES[nt.boss].text}`, 'them', nt.short);
  startMatch(null, 0);
  shell.banner(nt.name.toUpperCase(), `${winAt()} to win${nt.boss !== 'none' ? ' · ' + BOSSES[nt.boss].name : ''}`);
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
    const msg = (t) => { const m = wrap.querySelector('.shopmsg'); if (m) m.textContent = t; };
    const draw = () => {
      const H = handById[upg.id], lv = g.levels[upg.id] || 1;
      wrap.innerHTML = `<div class="sheet panel shop"><h2>Transfer window</h2>
        <p class="muted" style="margin:0">Won +$${earn}. Coaches: ${g.coaches.length}/${MAX_COACHES}.</p>
        <div class="bank">$${g.money}</div>
        <p class="shopmsg"></p>
        <div class="shelf">${offer.map((o, i) => `<div class="item" data-i="${i}">${coachCard(o.id, true)}<button class="btn small ${o.sold || g.money < COACHES[o.id].price || g.coaches.length >= MAX_COACHES ? 'disabled' : ''}" data-buy="${i}">${o.sold ? 'Signed' : `Sign $${COACHES[o.id].price}`}</button></div>`).join('')}
          <div class="item"><div class="gcard rare upgcard"><div class="cost">⬆</div><div class="name">${H.name}</div><div class="art">📈</div><div class="type">Training · lv${lv}→${lv + 1}</div><div class="text">+${H.lc} Chips, +${H.lm} Mult</div></div><button class="btn small ${upg.sold || g.money < 3 ? 'disabled' : ''}" data-up="1">${upg.sold ? 'Done' : 'Train $3'}</button></div>
        </div>
        <div class="row"><button class="btn small paper" data-roll="1">Reroll $2</button><span class="grow"></span><button class="btn green" data-next="1">Next match ▶</button></div></div>`;
      wrap.querySelectorAll('[data-buy]').forEach((b) => b.onclick = () => {
        const o = offer[+b.dataset.buy]; const c = COACHES[o.id];
        if (o.sold || g.money < c.price || g.coaches.length >= MAX_COACHES) { sfx.bad(); msg(o.sold ? 'Already signed' : g.coaches.length >= MAX_COACHES ? 'Coach slots full' : 'Not enough money'); return; }
        g.money -= c.price; g.coaches.push(o.id); o.sold = true; sfx.coin();
        shell.log(`Signed coach <b>${c.name}</b>: ${c.text}.`, 'good', 'SHOP'); draw();
      });
      wrap.querySelector('[data-up]').onclick = () => {
        if (upg.sold || g.money < 3) { sfx.bad(); msg(upg.sold ? 'Already trained' : 'Not enough money'); return; }
        g.money -= 3; g.levels[upg.id] = (g.levels[upg.id] || 1) + 1; upg.sold = true; sfx.coin();
        shell.log(`Trained <b>${H.name}</b> to level ${g.levels[upg.id]}.`, 'good', 'SHOP'); draw();
      };
      wrap.querySelector('[data-roll]').onclick = () => { if (g.money < 2) { sfx.bad(); msg('Not enough money'); return; } g.money -= 2; roll(); sfx.deal(); draw(); };
      wrap.querySelector('[data-next]').onclick = () => { sfx.click(); wrap.remove(); resolve(); };
    };
    draw();
    document.body.appendChild(wrap);
  });
}

// ------------------------------------------------------------------ rendering helpers
const nameOf = (c) => `${c.char.name} (${c.suit}${c.rank})`;
const linkKey = ([a, b]) => a.id + '>' + b.id;
function cardHTML(c) {
  return `<div class="gcard ${SUIT_CLS[c.suit]}${c.star ? ' star' : ''}">
    <div class="cost">${c.rank}</div><div class="name">${c.char.name}</div>
    <div class="art" style="background-image:url(${portrait(c.char, 80)})"></div>
    <div class="type">${c.suit} · ${SUIT_NAME[c.suit]}</div><div class="text">${c.star ? `★ ${c.char.nick}` : 'Squad'}</div>
    <span class="kh"></span></div>`;
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
function countUp(from, to) {
  const el = calcEl.querySelector('.tot');
  const t0 = performance.now(), dur = clamp(Math.abs(to - from) / 3, 400, 1000) / SLOW();
  return new Promise((r) => {
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      el.innerHTML = `= <b>${Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)))}</b>`;
      if (k < 1) { if (Math.random() < 0.4) sfx.tick(); setTimeout(() => step(performance.now()), 16); } else { bump(el); r(); }
    };
    step(t0);
  });
}
// Short messages go in the fixed strip under the pitch, never over the buttons.
let noteOn = false, noteTimer = 0;
function note(html, ms = 1800) {
  noteOn = true;
  extraEl.innerHTML = `<span class="note">${html}</span>`;
  fitStrip();
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { noteOn = false; if (g && g.mode === 'play') render(); }, ms);
}
// Nothing in the strip may be cut off: drop the least useful chips from the end,
// then shrink the text of a lone chip until it fits.
function fitStrip() {
  extraEl.style.fontSize = '';
  while (extraEl.scrollWidth > extraEl.clientWidth + 0.5 && extraEl.children.length > 1) extraEl.lastElementChild.remove();
  for (let f = 9.5; extraEl.scrollWidth > extraEl.clientWidth + 0.5 && f >= 7.5; f -= 0.5) [...extraEl.children].forEach((c) => (c.style.fontSize = f + 'px'));
}
function clearNote() { if (noteOn) { noteOn = false; clearTimeout(noteTimer); } }
// Keep the phase tab in step with the match being played.
function syncTab() {
  const id = ['early', 'mid', 'clutch'][g.tier];
  shell.phase = id;
  document.querySelectorAll('.phasebar .phase').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
}
function bump(el, cls = 'bump') { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

// formation slot (canvas px) for a card within a set of played cards
function slotOf(c, cards) {
  const row = cards.filter((x) => x.suit === c.suit).sort((a, b) => a.rank - b.rank);
  const k = row.indexOf(c), n = row.length;
  const u = n === 1 ? { GK: 0.5, DF: 0.38, MF: 0.62, FW: 0.4 }[c.suit] : 0.2 + (0.6 * k) / (n - 1);
  return pitch.toPx(u, ROW_V[c.suit]);
}

// A hand card flies to its player on the pitch and shrinks into him.
function flyTo(el, pos, delay, dur) {
  if (!el) return;
  const r = el.getBoundingClientRect(), cr = cv.getBoundingClientRect();
  const c = el.cloneNode(true);
  c.classList.remove('dealt', 'sel');
  Object.assign(c.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', transform: 'none', zIndex: 75, margin: 0, animation: 'none', pointerEvents: 'none', transition: 'none' });
  document.body.appendChild(c);
  el.remove();
  const dx = cr.left + pos[0] - (r.left + r.width / 2), dy = cr.top + pos[1] - 18 - (r.top + r.height / 2);
  const an = c.animate([
    { transform: 'translate(0,0) scale(1)', opacity: 1 },
    { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 30}px) rotate(-8deg) scale(.75)`, opacity: 1, offset: 0.5 },
    { transform: `translate(${dx}px, ${dy}px) rotate(4deg) scale(.25)`, opacity: 0 },
  ], { duration: dur / SLOW(), delay: delay / SLOW(), easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'both' });
  an.onfinish = () => c.remove();
  setTimeout(() => c.remove(), (dur + delay) / SLOW() + 400);
}
// A discarded card drops out of the hand.
function dropOut(el, delay) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const c = el.cloneNode(true);
  Object.assign(c.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', transform: 'none', zIndex: 75, margin: 0, animation: 'none', pointerEvents: 'none', transition: 'none' });
  document.body.appendChild(c);
  el.remove();
  const an = c.animate([
    { transform: 'translate(0,-22px) rotate(0)', opacity: 1 },
    { transform: 'translate(0,120px) rotate(14deg)', opacity: 0 },
  ], { duration: 300 / SLOW(), delay: delay / SLOW(), easing: 'cubic-bezier(.5,0,.9,.6)', fill: 'both' });
  an.onfinish = () => c.remove();
}

// Hand: one DOM element per card, reused, so picks lift and the hand closes up
// with CSS transitions instead of being rebuilt.
const cardEls = new Map();
function renderHand() {
  const keep = new Set(g.hand.map((c) => c.id));
  for (const [id, el] of cardEls) if (!keep.has(id)) { el.remove(); cardEls.delete(id); }
  let fresh = 0;
  g.hand.forEach((c, i) => {
    let el = cardEls.get(c.id);
    if (!el) {
      const tpl = document.createElement('template');
      tpl.innerHTML = cardHTML(c).trim();
      el = tpl.content.firstChild;
      el.classList.add('dealt');
      el.style.animationDelay = (fresh++ * 60) / SLOW() + 'ms';
      el.addEventListener('animationend', () => el.classList.remove('dealt'), { once: true });
      el.onclick = () => toggle(g.hand.indexOf(c));
      handEl.appendChild(el);
      cardEls.set(c.id, el);
    }
    el.classList.toggle('sel', picks.includes(i));
    el.querySelector('.kh').textContent = i + 1;
  });
  layoutHand();
}

// What each remaining play must average to win the match.
function stakes() {
  const t = T();
  if (!g.plays || g.goals > t.rivalGoals) return '';
  const per = (n) => Math.ceil(Math.max(0, n - g.score) / g.plays);
  if (t.drawOk && g.goals < t.rivalGoals) return `🎯 ${per(t.rivalGoals * g.perGoal)}/play to go through · ${per(winAt())} to win`;
  if (per(winAt()) > g.perGoal && g.goals < t.rivalGoals && per(t.rivalGoals * g.perGoal) <= g.perGoal) // one play is worth at most one goal
    return `🎯 win out of reach · ${per(t.rivalGoals * g.perGoal)}/play to force penalties`;
  return `🎯 ${per(winAt())}/play to win · ${g.plays} left`;
}
// The target for the match, in words, for banners and logs.
function targetText(t = T()) {
  return t.drawOk ? `Score ${t.rivalGoals * g.perGoal} to go through, ${winAt()} to win` : `Score ${winAt()} to win`;
}
function render() {
  if (!g) return;
  const t = T();
  // top info
  $('.tier').textContent = `${t.name} · vs ${t.rival}`;
  $('.boss').innerHTML = t.boss === 'none' ? '' : `<span class="bosschip" title="${BOSSES[t.boss].text}">⚠ ${BOSSES[t.boss].name}${t.boss === 'var' && !g.firstPlay ? ' (used)' : ''}</span>`;
  $('.money').textContent = `$${g.money}`;
  const cap = winAt(); // fixed per match, so the bar never rescales backwards
  const sel = selected();
  const pv = sel.length && g.mode === 'play' ? scoreFor(sel) : null;
  $('.goalbar .fill').style.width = Math.min(100, (g.score / cap) * 100) + '%';
  $('.goalbar .ghost').style.width = Math.min(100, ((g.score + (pv?.total || 0)) / cap) * 100) + '%';
  let ticks = '';
  for (let k = 1; k * g.perGoal <= cap; k++) {
    const isWin = k === t.rivalGoals + 1, isDraw = k === t.rivalGoals;
    ticks += `<span class="tick${k <= g.goals ? ' got' : ''}${isWin ? ' win' : ''}" style="left:${(k * g.perGoal / cap) * 100}%">${isWin ? '🏆' : isDraw ? '=' : '⚽'}</span>`;
  }
  $('.goalbar .ticks').innerHTML = ticks;
  $('.goalbar .sc').textContent = `${g.score}${pv ? ` + ${pv.total}` : ''} / ${winAt()}`;
  $('.plays').innerHTML = `Plays <b>${g.plays}</b>`;
  $('.discards').innerHTML = `Discards <b>${g.discards}</b>`;
  const needWin = Math.max(0, winAt() - g.score);
  const needThrough = Math.max(0, t.rivalGoals * g.perGoal - g.score);
  $('.need').innerHTML = g.goals > t.rivalGoals ? 'Winning!' : t.drawOk && g.goals < t.rivalGoals ? `Need <b>${needThrough}</b> to go through` : t.drawOk ? `Through · <b>${needWin}</b> to win` : `Need <b>${needWin}</b> to win`;
  // coaches
  coachesEl.innerHTML = g.coaches.map((c) => coachCard(c)).join('') + Array.from({ length: MAX_COACHES - g.coaches.length }, () => `<div class="slot">${g.coaches.length ? 'empty' : 'coach'}</div>`).join('');
  coachesEl.classList.toggle('none', !g.coaches.length);
  coachesEl.querySelectorAll('.coach').forEach((el) => { el.onclick = () => note(`<b>${COACHES[el.dataset.c].name}</b>: ${COACHES[el.dataset.c].text}`, 2400); });
  // live preview: ghost formation on the pitch + the calculator
  if (g.mode === 'play') {
    setFormation(sel, GHOST);
    if (pv) {
      calcShow(`${pv.hand.name}${pv.lv > 1 ? ` lv${pv.lv}` : ''}`, pv.chips, pv.mult, `= <b>${pv.total}</b>${pv.capped ? '<small> max</small>' : ''}`);
      const ng = Math.floor((g.score + pv.total) / g.perGoal) - g.goals;
      calcEl.querySelector('.hname small').textContent = ng > 0 ? ` ⚽ ${ng > 1 ? ng + ' goals' : 'goal'}!` : '';
      const bits = [];
      // most useful first; fitStrip drops chips from the end if they do not fit
      if (stakes()) bits.push(stakes());
      if (pv.marked) bits.push(`🚫 ${pv.marked.rank} marked`);
      if (pv.steps.some((s) => s.kind === 'var')) bits.push('📺 VAR ½');
      if (pv.capped) bits.push('🧤 max 1 goal');
      if (pv.chain) bits.push('⛓ chain ×2');
      if (pv.links.length) bits.push(`🔗 +${pv.links.length}`);
      const nc = pv.steps.filter((s) => s.kind === 'coach').length;
      if (nc) bits.push(`🧢 ${nc}`);
      if (!noteOn) { extraEl.innerHTML = bits.map((b) => `<span>${b}</span>`).join(''); fitStrip(); }
      calcEl.classList.remove('empty');
    } else {
      calcShow('Pick up to 5', 0, 0, '');
      calcEl.querySelector('.hname small').textContent = '';
      if (!noteOn) { extraEl.innerHTML = (stakes() ? `<span>${stakes()}</span>` : '') + '<span>Link: next line, number ±1 → +1 Mult</span>'; fitStrip(); }
      calcEl.classList.add('empty');
    }
  }
  renderHand();
  const active = g.mode === 'play';
  btnPlay.disabled = !active || !picks.length || !g.plays;
  btnDisc.disabled = !active || !picks.length || !g.discards;
  btnSort.disabled = !active;
  btnDisc.firstChild.textContent = `Discard (${g.discards}) `;
  btnSort.firstChild.textContent = g.sortBy === 'rank' ? 'Sort: # ' : 'Sort: pos ';
}

function layoutHand() {
  const cards = g.hand.map((c) => cardEls.get(c.id)).filter(Boolean);
  const n = cards.length, pad = 14, Wd = (handEl.clientWidth || 360) - pad * 2, cw = cards[0]?.offsetWidth || 86;
  const step = n > 1 ? Math.min(cw + 4, (Wd - cw) / (n - 1)) : 0;
  const x0 = pad + (Wd - (cw + step * (n - 1))) / 2;
  cards.forEach((c, i) => {
    const mid = (n - 1) / 2, on = picks.includes(i);
    c.style.left = x0 + i * step + 'px';
    c.style.transform = on ? 'translateY(-22px)' : `translateY(${Math.abs(i - mid) ** 2 * 0.8}px) rotate(${(i - mid) * 1.2}deg)`;
    c.style.zIndex = i + 1;
  });
}

// ------------------------------------------------------------------ canvas
let lastT = 0;
function frame0(now) {
  const t = now / 1000, dt = Math.min(0.05, t - lastT || 0.016); lastT = t;
  if (g) { update(dt * SLOW(), now); drawBoard(t, dt); }
}
function frame(now) { frame0(now); requestAnimationFrame(frame); }
function update(dt, now) {
  for (const a of actors.values()) {
    tickObj(a, dt, 700);
    if (a.layTo != null && a.lay != null) a.lay += clamp(a.layTo - a.lay, -a.layRate * dt, a.layRate * dt);
    a.pop = Math.max(0, a.pop - dt * 4);
    if (a.pose && a.poseUntil && now > a.poseUntil) { a.pose = null; a.poseUntil = 0; }
    if (a.card && a.a <= 0.001 && a.ta === 0) actors.delete(a.id);
  }
  if (ball.held) { // carried in the keeper's gloves
    const [ox, oy] = gloveOffset(keeper.pose, keeper.facing, keeper.lay ?? 1);
    ball.tw = null; ball.x = keeper.x + ox; ball.y = keeper.y + oy; ball.h = 0;
    ball.tx = ball.x; ball.ty = ball.y;
    ball.a += clamp(ball.ta - ball.a, -dt * 5, dt * 5);
  } else tickObj(ball, dt, 900);
  if (ball.tw) ball.spin += dt * 16;
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
  const S = sz();
  // pass links: dashed until they fire, then solid (gold when the chain fires)
  const ls = links(B.cards), chain = chainOf(ls);
  for (const l of ls) {
    const a = actors.get(l[0].id), b = actors.get(l[1].id);
    if (!a || !b) continue;
    const alpha = Math.min(a.a, b.a);
    if (alpha < 0.02) continue;
    const fired = B.fired.has(linkKey(l)), gold = B.chainOn && chain && chain.includes(l[0]) && chain.includes(l[1]);
    ctx.save(); ctx.globalAlpha = Math.min(1, alpha * 1.4);
    drawArrow(ctx, a.x, a.y - S * 0.35, b.x, b.y + 4, gold ? '#FFD23F' : 'rgba(255,255,255,.9)', { dash: fired ? null : [5, 5], width: gold ? 3.5 : fired ? 3 : 2, curve: (b.x - a.x) * 0.2 });
    ctx.restore();
  }
  const celebrating = t < B.celebrate;
  const list = [...actors.values()].filter((a) => a.a > 0.01).sort((p, q) => p.y - q.y);
  for (const a of list) {
    const c = a.card;
    let pose = a.pose;
    if (!pose) {
      if (a === keeper) pose = 'ready';
      else if (a === hans) pose = 'ready';
      else if (celebrating) pose = 'celebrate';
      else pose = c && c.suit === 'GK' ? 'ready' : 'idle';
    }
    const act = c && B.active === c.id;
    const k = 1 + a.pop * 0.18;
    const size = (a === keeper ? S * 0.9 : S) * k;
    drawPlayer(ctx, a.char, a.x, a.y + 6, { size, pose, t, alpha: a.a, facing: a.facing, glow: act ? '#FFD23F' : null, ...(a.lay != null ? { lay: a.lay } : {}) });
    if (c) { // number badge
      ctx.save();
      ctx.globalAlpha = a.a;
      ctx.font = '12px "Lilita One", system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const bx = a.x + S * 0.38, by = a.y - S * 0.62;
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1b1b2f'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(bx, by, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#1b1b2f'; ctx.fillText(c.rank, bx, by + 0.5);
      ctx.restore();
    }
  }
  if (ball.a > 0.01) {
    ctx.save(); ctx.globalAlpha = ball.a;
    drawBall(ctx, ball.x, ball.y, 5, ball.spin, ball.h);
    ctx.restore();
  }
  pitch.drawFront(ctx, t);
}

// ------------------------------------------------------------------ boot
keeper = actor('oskar', byId.oskar);
hans = actor('hans', byId.hans);
sizeCanvas();
window.addEventListener('resize', () => { sizeCanvas(); render(); });
requestAnimationFrame(frame);
// Test aid (?jank=1 only): the preview pane pauses requestAnimationFrame while
// it is hidden; keep the board ticking from a timer so checks can still run.
if (new URLSearchParams(location.search).has('jank')) {
  setInterval(() => { const now = performance.now(); if (now - lastT * 1000 > 60) frame0(now); }, 16);
}
window.ch = { get g() { return g; }, actors, ball }; // debug hook

// ------------------------------------------------------------------ input
btnPlay.onclick = () => play();
btnDisc.onclick = () => discard();
btnSort.onclick = () => { if (g.mode !== 'play') return; g.sortBy = g.sortBy === 'rank' ? 'pos' : 'rank'; picks = []; sortHand(); sfx.click(); render(); };
window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.sheet-wrap') || !g) return;
  if (/^[1-9]$/.test(e.key)) toggle(+e.key - 1);
  else if (e.key === 'Enter') { e.preventDefault(); play(); }
  else if (e.key === 'd' || e.key === 'D') discard();
  else if (e.key === 'z' || e.key === 'Z') undoPick();
  else if (e.key === 's' || e.key === 'S') btnSort.click();
});
