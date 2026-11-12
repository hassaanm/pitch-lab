// Auto XI: auto-chess football. Draft players from a shop, place them on a
// formation board where traits and neighbours matter, then watch the half
// play itself. Half-time is the shop.
import { Shell, oddsPill, pick } from '../../shared/shell.js';
import { spriteURL, portrait } from '../../shared/art.js';
import { sfx } from '../../shared/sfx.js';
import { byId, TEAMS, crestSVG } from '../../shared/cast.js';
import { TRAITS, UNITS, UNIT, ROUNDS, SHOP_ODDS, LEVEL_COST, MAX_SLOTS, BENCH, HP_MAX, LINE_NAME, ROLE_LINE, slotUV } from './data.js';
import * as S from './sim.js';
import { MatchView } from '../../shared/matchview.js';

const shell = new Shell({
  id: 'auto-xi',
  title: 'Auto XI',
  pitch: 'Auto-chess football. Buy players, stack style synergies, place them in a formation, then watch the half play out. Half-time is the shop.',
  how: [
    'Tap a shop card to buy (gold). Three copies of a player combine into a ★★ upgrade.',
    'Tap a player, then tap a slot to place or swap. Drag works with a mouse. Drop on the shop or press Del to sell.',
    'Traits stack: 2/4/6 Possession, Gegenpress, Catenaccio, Intensity, Flair; 2/4 Engine, Playmaker, Poacher, Wall, Speedster.',
    'Lines matter: Walls at the back, Engines and Playmakers in midfield, Poachers up front. A Playmaker feeds the forward ahead; two Walls side by side are a Partnership.',
    'Without an Engine pair (2 Engines on the board) your team tires in the 2nd half: −0.8 Attack, −1.2 Press.',
    'Check the projection (win/draw/loss and xG): it is the exact chance of each result from the same odds the match rolls. Then kick off.',
    'The half plays itself. Each tackle, block, save or goal names the synergy or link that caused it (e.g. "🤝 Dima+Tomo → BLOCKED!"), but only if that player (both players, for a link) took part. A coloured dot shows whose player each name is.',
    'Half-time is a shop: +4 gold, a fresh shop, and a one-line summary of what decided the half (tap Why ▸ for all of it). Fix what went wrong.',
    'Five matches. Losses cost hearts. Win the Final to lift the Cup.',
    'Keys: 1–5 buy · R reroll · F level up · QWE/ASD/ZXC board slots · 6–0 bench · Del sell · Enter kick off · Space fast-forwards the match.',
  ],
  notice: 'Is building the squad and watching it play enough agency, or do you want to step in during the match?',
  phases: [
    { id: 'early', label: 'Kickoff', sub: 'Matchday 1 · draft' },
    { id: 'mid', label: 'Midgame', sub: "Napolo · HT · 1–1" },
    { id: 'clutch', label: 'Clutch', sub: "Final · HT · 0–1" },
  ],
  onPhase: (id) => startPhase(id),
});
const stage = shell.stage;

let run = null;
let sel = null;          // { where: 'board'|'bench', i }
let view = null;
let busy = false;
let uidSeq = 1;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function killView() { if (view) { view.destroy(); view = null; } }
// Key names appear only where there is a keyboard (a fine pointer that can hover).
const KB = (() => { try { return matchMedia('(hover: hover)').matches; } catch { return true; } })();
const BOARD_KEYS = ['q', 'w', 'e', 'a', 's', 'd', 'z', 'x', 'c'];
const BENCH_KEYS = ['6', '7', '8', '9', '0'];
const POS_OF = ['FW', 'FW', 'FW', 'MF', 'MF', 'MF', 'DF', 'DF', 'DF'];

const U = (id, star = 1) => ({ uid: uidSeq++, id, star });
function boardFrom(list) { const b = Array(9).fill(null); for (const [id, s, st] of list) b[s] = U(id, st || 1); return b; }
function benchFrom(list) { const b = Array(BENCH).fill(null); list.forEach((id, i) => { b[i] = U(id); }); return b; }

// ================================================================ phases
function startPhase(id) {
  busy = false; sel = null; report = null;
  killView();
  if (id === 'early') {
    run = { round: 0, hp: HP_MAX, gold: 6, slots: 3, streak: 0, half: 1, score: [0, 0],
      board: boardFrom([['tomo', 7], ['bruno', 1]]), bench: benchFrom(['g_lola']), shop: [] };
    rollShop();
    shell.log('Matchday 1. You have 6 gold and room for 3 players. Buy, place, then kick off.', 'info', '');
  }
  if (id === 'mid') {
    run = { round: 2, hp: 7, gold: 9, slots: 5, streak: 0, half: 2, score: [1, 1],
      board: boardFrom([['tomo', 7], ['dima', 6], ['kenji', 4], ['lupe', 3], ['rio', 1, 2]]), bench: benchFrom(['g_benny', 'g_benny', 'g_dex']), shop: [] };
    rollShop(['g_benny', 'g_tito', 'mo', 'rocco', 'g_ivo']);
    shell.log('First half vs Napolo: 1–1. Their Catenaccio 4 is a brick wall — break it or match it.', 'info', "45'");
    shell.log('You hold two Benny copies: a third combines into ★★.', 'info', 'HT');
  }
  if (id === 'clutch') {
    run = { round: 4, hp: 3, gold: 12, slots: 6, streak: 1, half: 2, score: [0, 1],
      board: boardFrom([['tomo', 7], ['dima', 8], ['kenji', 4, 2], ['lupe', 3], ['rio', 1, 2], ['pip', 0]]), bench: benchFrom(['sol', 'bruno', 'sol']), shop: [] };
    rollShop(['sol', 'viper', 'g_mika', 'zed', 'g_gus']);
    shell.log('The Final under the lights. Paris St-Germane lead 1–0 at the break. Flair 4 is cutting you open.', 'info', "45'");
    shell.log('Two Sols on the bench — a third makes ★★.', 'info', 'HT');
  }
  draftScreen(true);
}

// ================================================================ helpers
const R = () => ROUNDS[run.round];
const oppSide = () => ({ board: oppBoard(), keeper: R().keeper });
const youSide = () => ({ board: run.board, keeper: byId.wak.stats.keep });
let oppCache = null;
// A rival player who is also on your board plays under another name and look,
// so both sides never field the same character (same stats and traits).
const ALT = ['Dario', 'Toni', 'Luka', 'Remy', 'Ivan', 'Otto', 'Basti', 'Nico', 'Joel', 'Marco', 'Fede', 'Kasper'];
const ALT_HAIR = ['#1A1110', '#6B4A2E', '#C8572B', '#E9D8A6', '#2A1810', '#111'];
function oppBoard() {
  if (!oppCache || oppCache.round !== run.round) oppCache = { round: run.round, board: boardFrom(R().squad) };
  const mine = new Set(run.board.filter(Boolean).map((p) => p.id));
  oppCache.board.forEach((p, i) => {
    if (!p) return;
    if (!mine.has(p.id)) { delete p.name; delete p.look; return; }
    const h = [...p.id].reduce((a, ch) => a + ch.charCodeAt(0), 0) + run.round + i;
    p.name = ALT[h % ALT.length];
    p.look = { hairColor: ALT_HAIR[h % ALT_HAIR.length], num: 2 + (h % 30) };
  });
  return oppCache.board;
}
const onBoard = () => run.board.filter(Boolean).length;
const owned = (id) => [...run.board, ...run.bench].filter((p) => p && p.id === id && p.star === 1).length;
const charOf = (p, team, slot) => {
  const base = UNIT[p.id].char;
  // Distinct id per unit and kit: the portrait cache and the match view key on id.
  return { ...base, ...(p.look || {}), name: p.name || base.name, id: `${p.id}#${p.uid ?? 0}${p.name ? '~' + p.name : ''}@${team}`, team, pos: slot === 'gk' ? 'GK' : POS_OF[slot] };
};
const keeperChar = (team) => (team === 'sun' ? { ...byId.wak, id: 'wak@sun' } : { ...byId.oskar, id: `oskar@${team}`, team });
const sprite = (p, size = 60) => spriteURL(charOf(p, 'sun', 4), size);
const stars = (p) => (p.star === 2 ? '★★' : '★');
const traitIcons = (id) => UNIT[id].traits.map((t) => `<i title="${TRAITS[t].name}" style="background:${TRAITS[t].color}">${TRAITS[t].icon}</i>`).join('');

function rollShop(fixed) {
  if (fixed) { run.shop = [...fixed]; return; }
  const odds = SHOP_ODDS[run.slots];
  run.shop = Array.from({ length: 5 }, () => {
    let r = Math.random(), cost = 1;
    if (r > odds[0]) cost = r > odds[0] + odds[1] ? 3 : 2;
    return pick(UNITS.filter((u) => u.cost === cost)).id;
  });
}

// ================================================================ actions
function buy(i) {
  if (busy) return;
  const id = run.shop[i];
  if (!id) return;
  const u = UNIT[id];
  if (run.gold < u.cost) { sfx.bad(); shell.toast(`Need ${u.cost} gold`); return; }
  const free = run.bench.findIndex((b) => !b);
  const combines = owned(id) >= 2;
  if (free < 0 && !combines) { sfx.bad(); shell.toast(`Bench full: sell someone${KB ? ' (Del)' : ''} or place them`); return; }
  const from = rectOf(`.scard[data-i="${i}"] img`);
  run.gold -= u.cost;
  run.shop[i] = null;
  sfx.coin();
  if (free >= 0) run.bench[free] = U(id); else run.bench.push(U(id));
  shell.log(`Bought ${u.char.name} (${u.cost}g).`, '', '');
  const star = combine(id);
  run.bench = run.bench.slice(0, BENCH).concat(Array(Math.max(0, BENCH - run.bench.length)).fill(null)).slice(0, BENCH);
  draftScreen();
  if (star) fly(from, unitImg(star.where, star.i)); else if (free >= 0) fly(from, unitImg('bench', free));
}

function combine(id) {
  const spots = [];
  run.board.forEach((p, s) => { if (p && p.id === id && p.star === 1) spots.push({ where: 'board', i: s }); });
  run.bench.forEach((p, s) => { if (p && p.id === id && p.star === 1) spots.push({ where: 'bench', i: s }); });
  if (spots.length < 3) return null;
  const use = spots.slice(0, 3);
  for (const sp of use) run[sp.where][sp.i] = null;
  const keep = use[0];
  run[keep.where][keep.i] = U(id, 2);
  sel = null;
  sfx.perfect();
  shell.flash('#FFD23F');
  shell.banner('★★', `${UNIT[id].char.name} upgraded`);
  shell.log(`<b>${UNIT[id].char.name} ★★!</b> Three copies combine: ×${S.STAR_MULT} stats.`, 'good', '');
  return keep;
}

function reroll() {
  if (busy) return;
  if (run.gold < 1) { sfx.bad(); shell.toast('Need 1 gold'); return; }
  run.gold -= 1; rollShop(); sfx.deal(); draftScreen();
}
function levelUp() {
  if (busy) return;
  if (run.slots >= MAX_SLOTS) { shell.toast('Formation is full size (6 + keeper)'); return; }
  const c = LEVEL_COST[run.slots];
  if (run.gold < c) { sfx.bad(); shell.toast(`Need ${c} gold to level up`); return; }
  run.gold -= c; run.slots++;
  sfx.good();
  shell.log(`Levelled up: room for ${run.slots} outfield players. Shop odds improve.`, 'good', '');
  draftScreen();
}
function sell(where, i) {
  const p = run[where][i];
  if (!p) return;
  const v = UNIT[p.id].cost * (p.star === 2 ? 3 : 1);
  run[where][i] = null;
  run.gold += v;
  sel = null;
  sfx.coin();
  shell.log(`Sold ${UNIT[p.id].char.name} ${stars(p)} (+${v}g).`, '', '');
  draftScreen();
}

// Tap a slot: select, move, or swap.
function tapSlot(where, i) {
  if (busy) return;
  const here = run[where][i];
  if (!sel) {
    if (here) { sel = { where, i }; sfx.click(); }
    draftScreen(); return;
  }
  if (sel.where === where && sel.i === i) { sel = null; draftScreen(); return; }
  moveUnit(sel, { where, i });
}
function moveUnit(from, to) {
  const a = run[from.where][from.i], b = run[to.where][to.i];
  if (!a) { sel = null; draftScreen(); return; }
  if (to.where === 'board' && from.where === 'bench' && !b && onBoard() >= run.slots) {
    sfx.bad(); shell.toast(`Formation full (${run.slots}). Level up${KB ? ' (F)' : ''} or swap with a player on the pitch.`);
    return;
  }
  const ra = srcRect(from.where, from.i), rb = b ? srcRect(to.where, to.i) : null;
  run[from.where][from.i] = b;
  run[to.where][to.i] = a;
  sel = null;
  sfx.card();
  // warn about whichever player now stands out of position (either end of a swap)
  const oop = [[a, to], [b, from]].filter(([u, at]) => u && at.where === 'board' && !S.fits(u.id, at.i));
  if (oop.length) shell.toast(oop.map(([u]) => `⚠ ${UNIT[u.id].char.name} prefers ${ROLE_LINE[S.roleOf(u.id)].map((l) => LINE_NAME[l]).join(' or ')} (60% out of position)`).join('<br>'));
  draftScreen();
  fly(ra, unitImg(to.where, to.i));
  if (b) fly(rb, unitImg(from.where, from.i));
}

// Patch element a to match b in place (same structure is reused; only changed
// attributes, text and children are touched), so images and layout never blink.
function morph(a, b) {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) { a.replaceWith(b); return; }
  if (a.nodeType === 3 || a.nodeType === 8) { if (a.data !== b.data) a.data = b.data; return; }
  if (a.nodeType !== 1) return;
  for (const { name } of [...a.attributes]) if (!b.hasAttribute(name)) a.removeAttribute(name);
  for (const { name, value } of [...b.attributes]) if (a.getAttribute(name) !== value) a.setAttribute(name, value);
  const ac = [...a.childNodes], bc = [...b.childNodes];
  bc.forEach((n, i) => { if (i < ac.length) morph(ac[i], n); else a.appendChild(n); });
  for (let i = bc.length; i < ac.length; i++) ac[i].remove();
}
// A sprite travels from a screen rect (the tapped card or slot) to the image it
// ends up as. The target is hidden at once; the flight waits (at most 250 ms)
// for the sprite to decode, and falls back to the slot's centre if it still has
// no size. The clone is always removed, even if the animation fails.
const flights = new Set();
async function fly(from, img) {
  if (!from || !img) return;
  img.style.visibility = 'hidden';
  const g = document.createElement('img');
  g.className = 'flyer';
  flights.add(g);
  const done = () => { g.remove(); flights.delete(g); if (img.isConnected) img.style.visibility = ''; };
  const guard = setTimeout(done, 1200);
  try {
    if (!img.complete || !img.naturalWidth) await Promise.race([img.decode().catch(() => {}), new Promise((r) => setTimeout(r, 250))]);
    if (!img.isConnected) return;
    let to = img.getBoundingClientRect();
    if (!to.width || !to.height) {
      const slot = img.closest('.slot')?.getBoundingClientRect();
      if (!slot) return;
      const h = Math.min(slot.height * 0.7, from.height), w = h * (from.width / Math.max(1, from.height));
      to = { left: slot.left + (slot.width - w) / 2, top: slot.top + 4, width: w, height: h };
    }
    g.src = img.src;
    Object.assign(g.style, { left: to.left + 'px', top: to.top + 'px', width: to.width + 'px', height: to.height + 'px' });
    document.body.appendChild(g);
    window.__flights?.push({ from: [from.left, from.top, from.width, from.height].map(Math.round), to: [to.left, to.top, to.width, to.height].map(Math.round) });
    const sx = from.width / Math.max(1, to.width), sy = from.height / Math.max(1, to.height);
    await g.animate([
      { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${sx}, ${sy})`, transformOrigin: '0 0' },
      { transform: 'none', transformOrigin: '0 0' },
    ], { duration: 260, easing: 'cubic-bezier(.3,.7,.3,1)' }).finished;
  } catch { /* fall through: never leave a clone behind */ } finally { clearTimeout(guard); done(); }
}
if (new URLSearchParams(location.search).has('jank')) window.__flights = [];
const rectOf = (sel) => stage.querySelector(sel)?.getBoundingClientRect() || null;
// Where a unit visibly is now: its sprite, or the middle of its slot if the sprite has no size.
function srcRect(where, i) {
  const r = unitImg(where, i)?.getBoundingClientRect();
  if (r && r.width && r.height) return r;
  const sl = stage.querySelector(`.slot[data-where="${where}"][data-i="${i}"]`)?.getBoundingClientRect();
  return sl ? { left: sl.left + sl.width * 0.25, top: sl.top + 4, width: sl.width * 0.5, height: sl.height * 0.6 } : null;
}
const unitImg = (where, i) => stage.querySelector(`.slot[data-where="${where}"][data-i="${i}"] .unit img`);

// ================================================================ draft screen
// enter = a real screen change (phase start, half-time, new matchday): fade in.
// Otherwise the existing screen is patched in place, so taps never blink it.
function draftScreen(enter = false) {
  killView();
  busy = false;
  const r = R();
  const T = TEAMS[r.club];
  shell.setScore(run.half === 2 ? { home: run.score[0], away: run.score[1], clock: 'HT', awayTeam: 'red' } : null);
  const you = S.teamStats(youSide(), run.half), opp = S.teamStats(oppSide(), run.half);
  const P = S.projectMatch(youSide(), oppSide(), run.score, run.half);
  const ht = run.half === 2;
  const selP = sel ? run[sel.where][sel.i] : null;

  const html = `<div class="ax draft${enter ? ' enter' : ''}">
    <div class="topinfo panel dark">
      <div class="opp">${crestSVG('red', 34).replace(/#E8463A/g, T.shirt)}
        <div><div class="rl">${r.label} · ${r.league}</div><b>${T.name}</b> <span class="schip" style="background:${TRAITS[r.style].color}">${TRAITS[r.style].icon} ${TRAITS[r.style].name}</span></div></div>
      <div class="res"><span class="hp" title="Hearts">❤️ ${run.hp}</span><span class="gold" title="Gold">🪙 ${run.gold}</span></div>
    </div>
    ${ht ? `<div class="htbar"><span class="hthead">⏸ HT ${run.score[0]}–${run.score[1]} · +4 gold</span>${report && report.half === 1 ? `<button class="htwhy" id="why"><span>${reportLine(report)}</span><b>Why ▸</b></button>` : '<span class="htnote">Fresh shop. Fix what went wrong.</span>'}</div>` : ''}
    <div class="syn" id="syn">${synergyChips(you)}</div>
    <div class="boardwrap">
      <div class="board" id="board">
        <svg class="links" viewBox="0 0 300 240" preserveAspectRatio="none">${linkSVG(you.links)}</svg>
        ${['front', 'mid', 'back'].map((line, row) => `<div class="lrow"><span class="lname">${LINE_NAME[line]}</span>${[0, 1, 2].map((c) => slotHTML('board', row * 3 + c)).join('')}</div>`).join('')}
        <div class="gkrow"><div class="gk"><img src="${spriteURL(keeperChar('sun'), 44)}" alt=""><span>Wak · GK</span></div></div>
        <div class="count ${onBoard() >= run.slots ? 'full' : ''}">${onBoard()}/${run.slots}</div>
      </div>
    </div>
    <div class="infoline" id="infoline">${selP ? unitInfo(selP, sel) : linkInfo(you)}</div>
    <div class="benchrow"><span class="lbl">Bench</span>${run.bench.map((_, i) => slotHTML('bench', i)).join('')}</div>
    <div class="shophead">
      <button class="btn small paper" id="reroll" title="Reroll the shop">🔄 1g <span class="key">R</span></button>
      <button class="btn small blue" id="level" title="Room for one more player" ${run.slots >= MAX_SLOTS ? 'disabled' : ''}>⬆ ${run.slots >= MAX_SLOTS ? 'Max' : LEVEL_COST[run.slots] + 'g'} <span class="key">F</span></button>
      <span class="mini">Win ${oddsPill(P.w)}</span>
      <button class="btn" id="kick">${ht ? '2nd half' : 'Kick off'} ▶ <span class="key">↵</span></button></div>
    <div class="shop" id="shop">${run.shop.map((id, i) => shopCard(id, i)).join('')}</div>
    <div class="muted odds-note">Shop odds at level ${run.slots}: ${SHOP_ODDS[run.slots].map((p, i) => `${i + 1}g ${Math.round(p * 100)}%`).join(' · ')}. Tap a card to buy.</div>
    <div class="proj panel">
      <div class="phead"><b>Projection</b> <span class="muted">${ht ? '2nd half from ' + run.score.join('–') : 'full match'}</span><button class="btn small ghost" id="scout">🔍 Scout</button></div>
      <div class="wdl">Win ${oddsPill(P.w)} Draw ${oddsPill(P.d)} Loss ${oddsPill(P.l)}</div>
      <div class="xg">xG <b>${P.xgY.toFixed(2)}</b> – <b>${P.xgO.toFixed(2)}</b> · Ball ${Math.round(P.share * 100)}%</div>
      ${compareHTML(you, opp)}
      <div class="notes" title="${you.notes.join(' · ')}">${you.notes.length ? '⚠ ' + you.notes.join(' · ') : '<span class="muted">No warnings: everyone is in position.</span>'}</div>
    </div>
  </div>`;
  const cur = stage.querySelector('.ax.draft');
  if (enter || !cur) stage.innerHTML = html;
  else { const t = document.createElement('template'); t.innerHTML = html; morph(cur, t.content.firstElementChild); }

  stage.querySelectorAll('[data-where]').forEach((el) => {
    el.onclick = () => { if (dragJust) { dragJust = false; return; } tapSlot(el.dataset.where, +el.dataset.i); };
    el.onpointerdown = (e) => startDrag(e, el);
  });
  stage.querySelectorAll('.scard').forEach((el) => el.onclick = () => { if (dragJust) { dragJust = false; return; } buy(+el.dataset.i); });
  stage.querySelectorAll('.tchip').forEach((el) => el.onclick = () => {
    const t = TRAITS[el.dataset.t];
    shell.toast(`<b>${t.icon} ${t.name}</b><br>${t.tiers.map((n, i) => `(${n}) ${t.text[i]}`).join('<br>')}`, 3200);
  });
  stage.querySelector('#reroll').onclick = reroll;
  stage.querySelector('#level').onclick = levelUp;
  stage.querySelector('#kick').onclick = kickOff;
  stage.querySelector('#scout').onclick = scout;
  const sb = stage.querySelector('#sellbtn');
  if (sb) sb.onclick = () => sell(sel.where, sel.i);
  const why = stage.querySelector('#why');
  if (why) why.onclick = () => shell.modal({ title: 'What decided the first half', html: reportHTML(report), buttons: [{ label: 'Back to the shop' }] });
}

function synergyChips(st) {
  const ids = Object.keys(st.counts).sort((a, b) => (S.activeTier(b, st.counts[b]) - S.activeTier(a, st.counts[a])) || st.counts[b] - st.counts[a]);
  if (!ids.length) return '<span class="muted" style="font-size:12px">No players yet — traits appear here.</span>';
  return ids.map((t) => {
    const T = TRAITS[t], n = st.counts[t], k = S.activeTier(t, n);
    const next = T.tiers.find((x) => x > n);
    return `<button class="tchip ${k >= 0 ? 'on' : ''}" data-t="${t}" style="--tc:${T.color}"><i>${T.icon}</i><span class="tn">${T.name}</span><span class="tc">${n}${next ? '/' + next : ''}</span>
      <span class="pips">${T.tiers.map((x, i) => `<u class="${i <= k ? 'lit' : ''}">${x}</u>`).join('')}</span></button>`;
  }).join('');
}

function slotHTML(where, i) {
  const p = run[where][i];
  const isSel = sel && sel.where === where && sel.i === i;
  const key = where === 'board' ? BOARD_KEYS[i].toUpperCase() : BENCH_KEYS[i];
  const fit = where === 'board' && p ? S.fits(p.id, i) : true;
  const inner = p ? `<div class="unit ${p.star === 2 ? 's2' : ''}">
      <img src="${sprite(p, where === 'board' ? 54 : 46)}" alt="" draggable="false">
      <div class="uname">${UNIT[p.id].char.name}<em>${stars(p)}</em></div><div class="ti">${traitIcons(p.id)}</div>
      ${!fit ? '<span class="oop" title="Out of position">⚠</span>' : ''}</div>` : '';
  return `<div class="slot w-${where} ${p ? 'has' : ''} ${isSel ? 'sel' : ''} ${sel && !isSel ? 'target' : ''}" data-where="${where}" data-i="${i}">${inner}<span class="kh">${key}</span></div>`;
}

function shopCard(id, i) {
  if (!id) return `<div class="scard sold" data-i="${i}"><span>SOLD</span><span class="kh">${i + 1}</span></div>`;
  const u = UNIT[id], c = charOf({ id }, 'sun', 4);
  const own = owned(id);
  return `<div class="scard c${u.cost} ${run.gold < u.cost ? 'poor' : ''} ${own >= 2 ? 'combo' : ''}" data-i="${i}" title="${u.char.name}: ${u.traits.map((t) => TRAITS[t].name).join(' + ')}">
    <span class="cost">${u.cost}</span>
    <img src="${portrait(c, 56)}" alt="" draggable="false">
    <div class="sn">${u.char.name}</div><div class="ti">${traitIcons(id)}</div>
    ${own ? `<div class="own">${'●'.repeat(own)}${'○'.repeat(3 - own)}</div>` : ''}
    <span class="kh">${i + 1}</span></div>`;
}

function unitInfo(p, s) {
  const u = UNIT[p.id], st = u.char.stats;
  const where = s.where === 'board' ? `${LINE_NAME[S.lineOf(s.i)]}${S.fits(p.id, s.i) ? '' : ' ⚠ out of position'}` : 'Bench';
  const v = u.cost * (p.star === 2 ? 3 : 1);
  return `<div class="uinfo"><span class="top"><b>${u.char.name} ${stars(p)}</b> <span class="muted">· ${where}</span></span>
    <button class="btn small red" id="sellbtn">Sell +${v}g <span class="key">Del</span></button>
    <span>${u.traits.map((t) => `${TRAITS[t].icon} ${TRAITS[t].name}`).join(' · ')} · wants <b style="font-size:11px;font-family:inherit;font-weight:900">${ROLE_LINE[u.traits[1]].map((l) => LINE_NAME[l]).join('/')}</b></span>
    <span class="muted">PAC ${st.pace} PAS ${st.pass} SHO ${st.shoot} TAC ${st.tackle} DRI ${st.dribble} STA ${st.stamina} · tap a slot to move</span></div>`;
}
const FX_SHORT = { ctrl: 'Ctrl', atk: 'Atk', fin: 'Fin', def: 'Def', prs: 'Press', gk: 'GK' };
function linkInfo(st) {
  if (!st.links.length) return `<span class="muted">Links: a Playmaker behind a forward, two Walls side by side, an Engine next to a midfielder, or a Speedster on a flank.</span>`;
  return st.links.map((l) => `<span class="lk ${l.kind}" title="${l.text}">${l.tag} ${Object.entries(l.fx).filter(([k]) => FX_SHORT[k]).map(([k, v]) => `+${v} ${FX_SHORT[k]}`).join(' ')}</span>`).join('');
}
function linkSVG(L) {
  const c = (s) => [50 + (s % 3) * 100, 40 + Math.floor(s / 3) * 80];
  return L.map((l) => {
    const [x1, y1] = c(l.from), [x2, y2] = c(l.to);
    if (l.kind === 'wing') return `<circle cx="${x1}" cy="${y1}" r="34" class="lw"/>`;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="l${l.kind}"/>`;
  }).join('');
}
function compareHTML(Y, O) {
  return '<div class="cgrid">' + ['ctrl', 'atk', 'fin', 'def', 'prs', 'gk'].map((k) => {
    const y = Y.s[k], o = O.s[k];
    return `<div class="crow"><span>${S.STAT_LABEL[k]}</span><span class="v">${S.f1(y)}</span><div class="sbar"><i style="width:${(y / (y + o)) * 100}%"></i></div><span class="v">${S.f1(o)}</span></div>`;
  }).join('') + '</div>';
}

function scout() {
  const st = S.teamStats(oppSide(), run.half);
  const ob = oppBoard();
  const T = TEAMS[R().club];
  shell.modal({ title: `Scout: ${T.name}`, html: `
    <div class="syn">${synergyChips(st)}</div>
    <div class="scoutboard">${[0, 1, 2].map((row) => `<div class="srow">${[0, 1, 2].map((c) => { const p = ob[row * 3 + c]; return `<div class="sslot">${p ? `<img src="${spriteURL(charOf(p, R().club, row * 3 + c), 44)}" alt=""><b>${S.nameOf(p)} ${stars(p)}</b>` : ''}</div>`; }).join('')}</div>`).join('')}</div>
    <p style="font-size:13px;margin:6px 0 0">${st.links.map((l) => l.text).join('<br>') || 'No links.'}</p>
    <p class="muted" style="font-size:12px">Keeper rating ${R().keeper + 3}. They attack DOWN the pitch, so their front line faces your back line.</p>`, buttons: [{ label: 'Back to the shop' }] });
}

// ---------------------------------------------------------------- mouse drag (phones use tap-to-place)
let drag = null, dragJust = false;
function startDrag(e, el) {
  if (e.pointerType !== 'mouse' || busy) return;
  const p = run[el.dataset.where][+el.dataset.i];
  if (!p) return;
  drag = { el, x: e.clientX, y: e.clientY, ghost: null, from: { where: el.dataset.where, i: +el.dataset.i } };
  window.addEventListener('pointermove', moveDrag);
  window.addEventListener('pointerup', endDrag, { once: true });
}
function moveDrag(e) {
  if (!drag) return;
  if (!drag.ghost && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8) {
    const img = drag.el.querySelector('img');
    drag.ghost = img.cloneNode(); drag.ghost.className = 'dragghost';
    document.body.appendChild(drag.ghost);
    drag.el.classList.add('dragging');
  }
  if (drag.ghost) { drag.ghost.style.left = e.clientX + 'px'; drag.ghost.style.top = e.clientY + 'px'; }
}
function endDrag(e) {
  window.removeEventListener('pointermove', moveDrag);
  if (!drag) return;
  const d = drag; drag = null;
  if (!d.ghost) return;
  d.ghost.remove();
  dragJust = true; setTimeout(() => { dragJust = false; }, 50);
  const t = document.elementFromPoint(e.clientX, e.clientY);
  const slot = t?.closest('[data-where]');
  if (slot) { moveUnit(d.from, { where: slot.dataset.where, i: +slot.dataset.i }); return; }
  if (t?.closest('#shop')) { sell(d.from.where, d.from.i); return; }
  draftScreen();
}

// ---------------------------------------------------------------- keyboard
window.addEventListener('keydown', (e) => {
  if (!run || document.querySelector('.sheet-wrap') || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (busy) {
    if (k === ' ' || k === 'enter') { e.preventDefault(); skip(); }
    return;
  }
  if (['1', '2', '3', '4', '5'].includes(k)) buy(+k - 1);
  else if (k === 'r') reroll();
  else if (k === 'f') levelUp();
  else if (BOARD_KEYS.includes(k)) tapSlot('board', BOARD_KEYS.indexOf(k));
  else if (BENCH_KEYS.includes(k)) tapSlot('bench', BENCH_KEYS.indexOf(k));
  else if ((k === 'delete' || k === 'backspace') && sel) { e.preventDefault(); sell(sel.where, sel.i); }
  else if (k === 'escape' && sel) { sel = null; draftScreen(); }
  else if (k === 'enter') { e.preventDefault(); kickOff(); }
});

// ================================================================ match
// The half is drawn by the shared broadcast view (shared/matchview.js): every
// change of possession is a physical contact, and every log line, score change
// and banner is written on that contact frame (onHit), never before it.
function kickOff() {
  if (busy) return;
  if (onBoard() === 0) { sfx.bad(); shell.toast('Put at least one player on the pitch'); return; }
  playHalf();
}

function skip() { if (view) { view.speed = 5; markSpeed(); } }
function markSpeed() { stage.querySelectorAll('[data-sp]').forEach((b) => b.classList.toggle('pressed', +b.dataset.sp === view?.speed)); }

let curMin = 0;
let lines = [];       // newest first, for the ticker under the pitch
let report = null;    // what decided the half: { goals: [], credit: { you: {}, opp: {} } }
// A player's name with a kit-coloured dot, so "Nora wins it off Nora" can never happen
// unreadably: the dot says whose player it is.
const kitColor = (side) => (side === 'you' ? '#FFD23F' : TEAMS[R().club].shirt);
const nm = (a) => (a?.c ? `<span class="pn" style="--k:${kitColor(a.side)}">${a.c.name}</span>` : '');
const teamName = (side) => (side === 'you' ? 'Sunbirds' : TEAMS[R().club].name);
const good = (side) => (side === 'you' ? 'good' : 'bad');
const pc = (p) => `${Math.round(p * 100)}%`;
const lbl = (c, tail, fallback) => (c ? `${c.label} → ${tail}` : fallback);
const whyH = (c) => (c ? ` <i class="why">${c.label}</i>` : '');
const teamOf = (side) => (side === 'you' ? 'sun' : R().club);
const boardOf = (side) => (side === 'you' ? run.board : oppBoard());

function say(text, kind = '') {
  shell.log(text, kind, `${curMin}'`);
  lines.unshift({ text, kind, min: curMin });
  lines.length = Math.min(lines.length, 2);
  const t = stage.querySelector('#ticker');
  if (t) t.innerHTML = tickerHTML();
}
const tickerHTML = () => lines.map((l) => `<li class="${l.kind}"><b>${l.min}'</b> ${l.text}</li>`).join('');
// Credit a synergy or placement with an event that went `side`'s way.
function credit(side, c, what) {
  if (!c || !report) return;
  const r = report.credit[side];
  r[c.label] = r[c.label] || {};
  r[c.label][what] = (r[c.label][what] || 0) + 1;
}

function squadOf(side) {
  const team = teamOf(side);
  const gk = { c: keeperChar(team), home: slotUV('gk') };
  return [gk, ...boardOf(side).map((p, s) => p && { c: charOf(p, team, s), home: slotUV(s), star: p.star }).filter(Boolean)];
}
// The on-pitch actor of a board unit (or of a slot), or null.
const actorOf = (side, p) => {
  const b = boardOf(side), s = b.indexOf(p);
  return s >= 0 && view ? view.find(charOf(p, teamOf(side), s), side) : null;
};
async function playHalf() {
  busy = true; sel = null;
  const r = R(), T = TEAMS[r.club];
  const half = run.half;
  const you = youSide(), opp = oppSide();
  const res = S.simHalf(you, opp, half);
  const P = S.projectMatch(you, opp, run.score, half);
  report = { half, goals: [], credit: { you: {}, opp: {} }, notes: res.Y.notes.filter((n) => n.startsWith('Tired')) };
  lines = [];
  window.scrollTo(0, 0);
  stage.innerHTML = `<div class="ax match enter">
    <div class="pitchwrap"><canvas id="pitch"></canvas>
      <div class="halfbadge">${half === 1 ? '1st half' : '2nd half'} · vs ${T.name}</div>
    </div>
    <ol class="ticker" id="ticker"></ol>
    <div class="mctl">
      <div class="syn small">${res.Y.active.map((a) => `<span class="tchip on" style="--tc:${TRAITS[a.t].color}"><i>${TRAITS[a.t].icon}</i><span class="tn">${TRAITS[a.t].name}</span><span class="tc">${a.n}</span></span>`).join('') || '<span class="muted" style="font-size:12px">No synergies active</span>'}</div>
      <div class="simctl"><button class="btn small paper" data-sp="1">×1</button><button class="btn small paper" data-sp="2">×2</button><button class="btn small paper" data-sp="5">⏭<span class="key">Space</span></button></div>
    </div>
    <div class="mstrip muted">At kick-off: win ${pc(P.w)} · draw ${pc(P.d)} · loss ${pc(P.l)} · xG ${P.xgY.toFixed(2)}–${P.xgO.toFixed(2)} · ball ${pc(res.share)}</div>
  </div>`;
  killView();
  const cv = stage.querySelector('#pitch');
  view = new MatchView(cv);
  const myView = view;
  const alive = () => view === myView;
  const wrap = stage.querySelector('.pitchwrap');
  const w = wrap.clientWidth;
  // One size for the whole half: fit the pitch, the ticker and the controls on screen.
  const room = innerHeight - wrap.getBoundingClientRect().top - 128;
  view.resize(w, Math.round(clamp(room, 300, w * 1.25)), r.variant);
  view.setTeams(squadOf('you'), squadOf('opp'));
  stage.querySelectorAll('[data-sp]').forEach((b) => b.onclick = () => { view.speed = +b.dataset.sp; sfx.click(); markSpeed(); });
  markSpeed();

  curMin = half === 1 ? 0 : 45;
  shell.setScore({ home: run.score[0], away: run.score[1], clock: `${curMin}'`, awayTeam: 'red' });
  shell.log(`${half === 1 ? 'Kick-off' : 'Second half'} vs ${T.name}. Projection: win ${pc(P.w)}, xG ${P.xgY.toFixed(2)}–${P.xgO.toFixed(2)}.`, 'info', `${curMin}'`);
  for (const n of res.Y.notes) shell.log(n, 'bad', `${curMin}'`);
  sfx.whistle(half === 1 ? 1 : 2);
  await view.reset(half === 1 ? 'you' : 'opp');
  if (!alive()) return;
  say(`${teamName(half === 1 ? 'you' : 'opp')} kick off${res.Y.active.length ? `. Your synergies: ${res.Y.active.map((a) => `${TRAITS[a.t].icon} ${TRAITS[a.t].name} ${a.n}`).join(', ')}` : ''}.`, 'info');

  for (const poss of res.poss) {
    curMin = poss.min;
    took = new Set();
    shell.setScore({ home: run.score[0], away: run.score[1], clock: `${curMin}'`, awayTeam: 'red' });
    for (let k = 0; k < poss.beats.length; k++) {
      await playBeat(poss.beats[k], poss.beats[k + 1]);
      if (!alive()) return;
    }
    await view.wait(0.15);
    if (!alive()) return;
  }
  curMin = half === 1 ? 45 : 90;
  sfx.whistle(half === 1 ? 2 : 3);
  shell.setScore({ home: run.score[0], away: run.score[1], clock: half === 1 ? 'HT' : 'FT', awayTeam: 'red' });
  if (half === 1) {
    shell.banner('HALF-TIME', `${run.score[0]}–${run.score[1]}`);
    say(`Half-time: ${run.score[0]}–${run.score[1]}.`, 'info');
    view.speed = 1;
    await view.wait(1.4);
    if (!alive()) return;
    run.half = 2;
    run.gold += 4;
    rollShop();
    shell.log(`Half-time shop: +4 gold and a fresh shop. Fix what went wrong.`, 'info', "45'");
    draftScreen(true);
  } else {
    view.speed = 1;
    await view.wait(0.8);
    if (!alive()) return;
    fullTime();
  }
}

// Actors who touched the ball in this possession (by c.id). A synergy or link is
// credited only when its own players took part: a link needs both of them.
let took = new Set();
const touch = (...as) => as.forEach((a) => a?.c && took.add(a.c.id));
const slotIds = (side, who) => who.map((sl) => boardOf(side)[sl]).filter(Boolean).map((p) => charOf(p, teamOf(side), boardOf(side).indexOf(p)).id);
function pickCause(side, list) {
  for (const c of list || []) {
    const ids = slotIds(side, c.who);
    if (!ids.length) continue;
    if (c.link ? ids.every((id) => took.has(id)) : ids.some((id) => took.has(id))) return c;
  }
  return null;
}
// The first cause with a player on the pitch, nearest the ball, does the tackle.
function causeActor(side, list) {
  if (!view) return null;
  for (const c of list || []) {
    const as = slotIds(side, c.who).map((id) => view.team(side).find((a) => a.c.id === id)).filter(Boolean);
    if (!as.length) continue;
    const b = view.ball;
    return as.reduce((m, a) => (Math.hypot(a.x - b.x, a.y - b.y) < Math.hypot(m.x - b.x, m.y - b.y) ? a : m));
  }
  return null;
}
// One floating label per contact. The view's own labels are switched off (label: '')
// and the game draws a single combined one; a label that follows another within
// its life is lifted clear of it instead of drawn on top.
let lastMark = 0;
function mark(i, text, color = '#fff') {
  if (!text || !view || i.x == null) return;
  const now = performance.now();
  const recent = ((now - lastMark) / 1000) * view.speed < 0.8;
  lastMark = now;
  view.label(text, i.x, i.y - view.size * (recent ? 1.55 : 0.9), color, 0.8);
}
// " · shot 23%" when the next beat is this side's shot, so the odds ride on this label.
const shotTail = (side, next) => (next && next.k === 'shot' && next.side === side ? ` · shot ${pc(next.p)}` : '');

async function playBeat(b, next) {
  const v = view;
  const side = b.side;
  const tail = shotTail(side, next);
  switch (b.k) {
    case 'build':
      return v.build(side, { label: '', onHit: (i) => {
        touch(i.by, i.from);
        const t = { longball: `${nm(i.from)}'s long ball is won by ${nm(i.by)}`, intercept: `${nm(i.by)} cuts out ${nm(i.from)}'s pass`,
          rollout: `${nm(i.from)} rolls it out to ${nm(i.by)}`, collect: `${nm(i.by)} picks up the loose ball`, kickoff: `${nm(i.from)} kicks off to ${nm(i.by)}` }[i.kind];
        const won = i.kind === 'longball' || i.kind === 'intercept' || i.kind === 'collect';
        const c = won ? pickCause(side, b.causes) : null;
        if (won) mark(i, lbl(c, side === 'you' ? 'our ball' : 'their ball', i.kind === 'intercept' ? 'CUT OUT!' : i.kind === 'longball' ? 'WON IT' : null), '#9BE7FF');
        if (t) say(`${t}${won ? ` (${side === 'you' ? 'your' : 'their'} ball ${pc(b.p)})${whyH(c)}` : ''}.`, side === 'you' ? '' : 'them');
      } });
    case 'press': {
      const opts = { label: '', onHit: (i) => {
        touch(i.by);
        const c = pickCause(side, b.causes);
        credit(side, c, 'steal');
        mark(i, lbl(c, 'WON IT!', 'WON IT!') + tail, '#FF8A3D');
        say(`${nm(i.by)} wins it off ${nm(i.from)} (press ${pc(b.p)})${whyH(c)}.`, good(side));
      } };
      const a = causeActor(side, b.causes);
      return a && v.carrier && v.carrier.side !== side ? v.tackle(a, { tag: 'press', ...opts }) : v.press(side, opts);
    }
    case 'progress':
      return v.progress(side, { label: '', onHit: (i) => {
        touch(i.by, i.from);
        const c = pickCause(side, b.causes);
        credit(side, c, 'break');
        mark(i, lbl(c, b.big ? 'BIG CHANCE' : 'through!', b.big ? 'BIG CHANCE' : 'through!') + tail, '#FFD23F');
        say(`${i.by === i.from ? `${nm(i.by)} drives` : `${nm(i.from)} finds ${nm(i.by)}`} through the line (${pc(b.p)})${b.big ? ': <b>big chance</b>' : ''}${whyH(c)}.`, side === 'you' ? '' : 'them');
      } });
    case 'blocked': {
      const opts = { label: '', onHit: (i) => {
        touch(i.by);
        const c = pickCause(side, b.causes);
        credit(side, c, 'stop');
        // a counter follows at once: its label carries the news, so this one stays short
        mark(i, next && next.k === 'counter' ? 'BLOCKED!' : lbl(c, 'BLOCKED!', 'BLOCKED!'), '#9BE7FF');
        say(`${nm(i.by)} ${i.kind === 'intercept' ? `cuts out ${nm(i.from)}'s pass` : `stops ${nm(i.from)}`} (${pc(b.p)} to hold)${whyH(c)}.`, good(side));
      } };
      const a = causeActor(side, b.causes);
      return a && v.carrier && v.carrier.side !== side ? v.tackle(a, { tag: 'blocked', ...opts }) : v.blocked(side, opts);
    }
    case 'counter':
      return v.counter(side, { label: '', onHit: (i) => {
        touch(i.by, i.to);
        const c = pickCause(side, b.causes);
        credit(side, c, 'counter');
        mark(i, lbl(c, 'COUNTER!', 'COUNTER!') + tail, '#FFD23F');
        say(`Counter! ${nm(i.by)} sends ${nm(i.to) || 'it'} away (${pc(b.p)})${whyH(c)}.`, good(side));
      } });
    case 'corner':
      return v.corner(side, null, { label: '', onHit: (i) => {
        const c = b.causes?.[0] || null; // a team set piece: the synergy itself won it
        mark(i, lbl(c, 'CORNER', 'CORNER') + tail, '#fff');
        say(`${nm(i.by)} turns it behind. Corner to ${teamName(side)}${whyH(c)}.`, side === 'you' ? '' : 'them');
      } });
    case 'shot': {
      // The player already on the ball takes the shot after a counter or a run
      // through the line; otherwise the sim's shooter gets it.
      const C = v.carrier;
      const onBall = !b.header && C && C.side === side && C.c.pos !== 'GK' && (b.tag === 'on the break' || C.c.pos === 'FW') ? C.c : null;
      const shooterC = onBall || (b.who ? charOf(b.who, teamOf(side), boardOf(side).indexOf(b.who)) : null);
      const a = await v.setShooter(shooterC, side, { header: b.header });
      if (view !== v || !a) return;
      return playShot(a, b);
    }
  }
}

function playShot(A, b) {
  const side = b.side;
  const how = b.tag ? ` ${b.tag}` : '';
  touch(A, view.carrier);
  return view.shot(A, side, b.result, { header: b.header, miss: b.post ? 'post' : 'wide', label: '', onHit: (i) => {
    if (i.result === 'goal') {
      const c = b.header ? b.causes?.[0] || null : pickCause(side, b.causes);
      credit(side, c, 'goal');
      goal(side, A);
      mark(i, c ? `GOAL! ${c.label}` : '', '#FFD23F');
      report?.goals.push({ side, min: curMin, name: nm(A), cause: c?.label || '' });
      say(`GOAL! ${nm(A)} scores${how} (${pc(b.p)})${whyH(c)}. ${run.score[0]}–${run.score[1]}`, 'goal');
    } else if (i.kind === 'save') {
      const def = side === 'you' ? 'opp' : 'you';
      touch(i.by);
      const c = b.causes?.[0] || null; // a keeper bonus is team-wide: the synergy itself made the save
      credit(def, c, 'save');
      mark(i, lbl(c, 'SAVED!', 'SAVED!'), '#9BE7FF');
      say(`${nm(i.by)} saves from ${nm(A)}${how} (${pc(b.p)} chance)${whyH(c)}.`, side === 'you' ? 'bad' : 'good');
    } else {
      mark(i, i.kind === 'post' ? 'POST!' : 'WIDE!', '#fff');
      say(`${nm(A)}${b.tag ? ' shoots ' + b.tag + ' and' : ''} hits ${i.kind === 'post' ? 'the post' : 'it wide'} (${pc(b.p)} chance).`, side === 'you' ? 'bad' : 'good');
    }
  } });
}

// Score, banner and noise: called on the frame the ball crosses the line.
function goal(side, A) {
  if (side === 'you') run.score[0]++; else run.score[1]++;
  shell.setScore({ home: run.score[0], away: run.score[1], clock: `${curMin}'`, awayTeam: 'red' });
  if (side === 'you') { shell.banner('GOAL!', `${nm(A)} · ${run.score[0]}–${run.score[1]}`); shell.confetti(); }
  else { shell.banner('GOAL', `${nm(A)} · ${run.score[0]}–${run.score[1]}`, '#FF6B6B'); sfx.groan(); }
  shell.shake(stage.querySelector('.pitchwrap'));
}

// What decided the last half: goals with their cause, then each side's synergy or
// placement that did the most work. Shown on the half-time shop and at full time.
const VERB = { goal: ['goal', 'goals'], steal: ['steal', 'steals'], stop: ['stop', 'stops'], break: ['break', 'breaks'], counter: ['counter', 'counters'], save: ['save', 'saves'] };
const repTop = (rep, side) => Object.entries(rep.credit[side]).map(([k, w]) => ({ k, w, n: Object.values(w).reduce((a, b) => a + b, 0) }))
  .sort((a, b) => b.n - a.n).slice(0, 2)
  .map(({ k, w, n }) => ({ n, html: `<b>${k}</b> ${Object.entries(w).map(([x, c]) => `${c} ${VERB[x][c > 1 ? 1 : 0]}`).join(', ')}` }));
// One line for the half-time strip: the synergy or link that did the most work.
function reportLine(rep) {
  const y = repTop(rep, 'you')[0], o = repTop(rep, 'opp')[0];
  if (!y && !o) return 'No synergy or link decided it.';
  return !y || (o && o.n > y.n) ? `Them: ${o.html}` : `You: ${y.html}`;
}
function reportHTML(rep) {
  if (!rep) return '';
  const top = (side) => repTop(rep, side).map((x) => x.html);
  const goals = rep.goals.map((g) => `<li class="${g.side === 'you' ? 'good' : 'bad'}">⚽ ${g.min}' ${g.side === 'you' ? 'You' : teamName('opp')}: ${g.name}${g.cause ? ` <i>${g.cause}</i>` : ''}</li>`);
  const yours = top('you'), theirs = top('opp');
  const rows = [...goals,
    yours.length ? `<li>You: ${yours.join(' · ')}</li>` : '<li class="muted">You: no synergy or link made a difference.</li>',
    theirs.length ? `<li class="bad">Them: ${theirs.join(' · ')}</li>` : '',
    ...rep.notes.map((n) => `<li class="bad">⚠ ${n}</li>`)];
  return `<ul class="rep">${rows.join('')}</ul>`;
}

function fullTime() {
  const [a, b] = run.score;
  const r = R(), T = TEAMS[r.club];
  const final = run.round === ROUNDS.length - 1;
  let result = a > b ? 'win' : a < b ? 'loss' : 'draw';
  let pens = '';
  if (final && result === 'draw') {
    const p = 0.5 + (S.teamStats(youSide(), 2).s.gk - S.teamStats(oppSide(), 2).s.gk) * 0.03;
    result = Math.random() < p ? 'win' : 'loss';
    pens = ` Penalties (${Math.round(p * 100)}% for you): ${result === 'win' ? 'you win the shoot-out!' : 'you lose the shoot-out.'}`;
  }
  let dmg = 0;
  if (result === 'loss') dmg = 2 + Math.max(0, b - a);
  if (result === 'draw') dmg = 1;
  run.hp -= dmg;
  run.streak = result === 'win' ? run.streak + 1 : 0;
  shell.setScore({ home: a, away: b, clock: 'FT', awayTeam: 'red' });
  shell.log(`Full time ${a}–${b} vs ${T.name}.${pens}${dmg ? ` −${dmg} ❤️` : ''}`, result === 'win' ? 'good' : 'bad', "90'");
  if (result === 'win') { sfx.win(); shell.confetti(); } else sfx.lose();
  const rep = report && report.half === 2 ? `<p class="muted" style="margin:8px 0 2px;font-size:12px">What decided the second half:</p>${reportHTML(report)}` : '';

  if (final && result === 'win') {
    shell.banner('CHAMPIONS!', 'The Cup is yours');
    shell.modal({ title: '🏆 Cup winners!', html: `<p>You beat ${T.name} ${a}–${b} in the Final with ${run.hp} ❤️ left.${pens}</p><div class="trophy">🏆</div>${rep}`, buttons: [{ label: 'New run' }] }).then(() => shell.setPhase('early'));
    return;
  }
  if (run.hp <= 0 || final) {
    shell.modal({ title: final ? 'Runners-up' : 'Knocked out', html: `<p>${final ? `So close: ${T.name} take the Cup.` : 'Out of hearts.'} ${pens}</p><p class="muted">You reached ${r.label}.</p>${rep}`, buttons: [{ label: 'New run' }] }).then(() => shell.setPhase('early'));
    return;
  }
  const income = 5 + Math.min(3, Math.floor(run.gold / 10)) + (run.streak >= 2 ? 1 : 0) + (result === 'win' ? 1 : 0);
  const next = ROUNDS[run.round + 1];
  shell.modal({ title: result === 'win' ? 'Win!' : result === 'draw' ? 'Draw' : 'Defeat',
    html: `<p><b>${a}–${b}</b> vs ${T.name}. ${dmg ? `You lose ${dmg} ❤️ (${run.hp} left).` : 'No hearts lost.'}</p>
      <p>Income: <b>+${income}</b> gold (5 base${Math.min(3, Math.floor(run.gold / 10)) ? ' + interest' : ''}${run.streak >= 2 ? ' + streak' : ''}${result === 'win' ? ' + win' : ''}).</p>
      ${rep}
      <p>Next: <b>${TEAMS[next.club].name}</b> · ${TRAITS[next.style].icon} ${TRAITS[next.style].name} · ${next.label}</p>`,
    buttons: [{ label: 'To the shop ▶' }] }).then(() => {
    run.round++; run.half = 1; run.score = [0, 0]; run.gold += income;
    rollShop();
    shell.clearLog();
    shell.log(`${R().label}: ${TEAMS[R().club].name} (${TRAITS[R().style].name}). Scout them, then build.`, 'info', '');
    draftScreen(true);
  });
}

