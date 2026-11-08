// Auto XI: auto-chess football. Draft players from a shop, place them on a
// formation board where traits and neighbours matter, then watch the half
// play itself. Half-time is the shop.
import { Shell, oddsPill, pick } from '../../shared/shell.js';
import { spriteURL, portrait } from '../../shared/art.js';
import { sfx } from '../../shared/sfx.js';
import { byId, TEAMS, crestSVG } from '../../shared/cast.js';
import { TRAITS, UNITS, UNIT, ROUNDS, SHOP_ODDS, LEVEL_COST, MAX_SLOTS, BENCH, HP_MAX, LINE_NAME, ROLE_LINE } from './data.js';
import * as S from './sim.js';
import { MatchView } from './view.js';

const shell = new Shell({
  id: 'auto-xi',
  title: 'Auto XI',
  pitch: 'Auto-chess football. Buy players, stack style synergies, place them in a formation, then watch the half play out. Half-time is the shop.',
  how: [
    'Tap a shop card to buy (gold). Three copies of a player combine into a ★★ upgrade.',
    'Tap a player, then tap a slot to place or swap. Drag works with a mouse. Drop on the shop or press Del to sell.',
    'Traits stack: 2/4/6 Possession, Gegenpress, Catenaccio, Intensity, Flair; 2/4 Engine, Playmaker, Poacher, Wall, Speedster.',
    'Lines matter: Walls at the back, Engines and Playmakers in midfield, Poachers up front. A Playmaker feeds the forward ahead; two Walls side by side are a Partnership.',
    'Check the projection (win/draw/loss and xG), then kick off. At half-time you shop again.',
    'Five matches. Losses cost hearts. Win the Final to lift the Cup.',
    'Keys: 1–5 buy · R reroll · F level up · QWE/ASD/ZXC board slots · 6–0 bench · Del sell · Enter kick off.',
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
const BOARD_KEYS = ['q', 'w', 'e', 'a', 's', 'd', 'z', 'x', 'c'];
const BENCH_KEYS = ['6', '7', '8', '9', '0'];
const POS_OF = ['FW', 'FW', 'FW', 'MF', 'MF', 'MF', 'DF', 'DF', 'DF'];

const U = (id, star = 1) => ({ uid: uidSeq++, id, star });
function boardFrom(list) { const b = Array(9).fill(null); for (const [id, s, st] of list) b[s] = U(id, st || 1); return b; }
function benchFrom(list) { const b = Array(BENCH).fill(null); list.forEach((id, i) => { b[i] = U(id); }); return b; }

// ================================================================ phases
function startPhase(id) {
  busy = false; sel = null;
  if (view) view.running = false;
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
  draftScreen();
}

// ================================================================ helpers
const R = () => ROUNDS[run.round];
const oppSide = () => ({ board: oppBoard(), keeper: R().keeper });
const youSide = () => ({ board: run.board, keeper: byId.wak.stats.keep });
let oppCache = null;
function oppBoard() {
  if (!oppCache || oppCache.round !== run.round) oppCache = { round: run.round, board: boardFrom(R().squad) };
  return oppCache.board;
}
const onBoard = () => run.board.filter(Boolean).length;
const owned = (id) => [...run.board, ...run.bench].filter((p) => p && p.id === id && p.star === 1).length;
const charOf = (p, team, slot) => {
  const base = UNIT[p.id].char;
  // Distinct id per kit: the shared portrait cache keys on id only.
  return { ...base, id: `${p.id}@${team}`, team, pos: slot === 'gk' ? 'GK' : POS_OF[slot] };
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
  if (free < 0 && !combines) { sfx.bad(); shell.toast('Bench full — sell someone (Del) or place them'); return; }
  run.gold -= u.cost;
  run.shop[i] = null;
  sfx.coin();
  if (free >= 0) run.bench[free] = U(id); else run.bench.push(U(id));
  shell.log(`Bought ${u.char.name} (${u.cost}g).`, '', '');
  combine(id);
  run.bench = run.bench.slice(0, BENCH).concat(Array(Math.max(0, BENCH - run.bench.length)).fill(null)).slice(0, BENCH);
  draftScreen();
}

function combine(id) {
  const spots = [];
  run.board.forEach((p, s) => { if (p && p.id === id && p.star === 1) spots.push({ where: 'board', i: s }); });
  run.bench.forEach((p, s) => { if (p && p.id === id && p.star === 1) spots.push({ where: 'bench', i: s }); });
  if (spots.length < 3) return;
  const use = spots.slice(0, 3);
  for (const sp of use) run[sp.where][sp.i] = null;
  const keep = use[0];
  run[keep.where][keep.i] = U(id, 2);
  sel = null;
  sfx.perfect();
  shell.flash('#FFD23F');
  shell.banner('★★', `${UNIT[id].char.name} upgraded`);
  shell.log(`<b>${UNIT[id].char.name} ★★!</b> Three copies combine: ×${S.STAR_MULT} stats.`, 'good', '');
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
    sfx.bad(); shell.toast(`Formation full (${run.slots}). Level up (F) or swap with a player on the pitch.`);
    return;
  }
  run[from.where][from.i] = b;
  run[to.where][to.i] = a;
  sel = null;
  sfx.card();
  if (to.where === 'board') {
    const fit = S.fits(a.id, to.i);
    if (!fit) shell.toast(`⚠ ${UNIT[a.id].char.name} prefers ${ROLE_LINE[S.roleOf(a.id)].map((l) => LINE_NAME[l]).join(' or ')} (60% out of position)`);
  }
  draftScreen();
}

// ================================================================ draft screen
function draftScreen() {
  if (view) { view.running = false; view = null; }
  busy = false;
  const r = R();
  const T = TEAMS[r.club];
  shell.setScore(run.half === 2 ? { home: run.score[0], away: run.score[1], clock: 'HT', awayTeam: 'red' } : null);
  const you = S.teamStats(youSide(), run.half), opp = S.teamStats(oppSide(), run.half);
  const P = S.projectMatch(youSide(), oppSide(), run.score, run.half);
  const ht = run.half === 2;
  const selP = sel ? run[sel.where][sel.i] : null;

  stage.innerHTML = `<div class="ax">
    <div class="topinfo panel dark">
      <div class="opp">${crestSVG('red', 34).replace(/#E8463A/g, T.shirt)}
        <div><div class="rl">${r.label} · ${r.league}</div><b>${T.name}</b> <span class="schip" style="background:${TRAITS[r.style].color}">${TRAITS[r.style].icon} ${TRAITS[r.style].name}</span></div></div>
      <div class="res"><span class="hp" title="Hearts">❤️ ${run.hp}</span><span class="gold" title="Gold">🪙 ${run.gold}</span></div>
    </div>
    ${ht ? `<div class="htbar">⏸ HALF-TIME SHOP · ${run.score[0]}–${run.score[1]} · +4 gold, fresh shop</div>` : ''}
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
    <div class="shophead"><b>Shop</b><span class="muted odds-note">${SHOP_ODDS[run.slots].map((p, i) => `${i + 1}g ${Math.round(p * 100)}%`).join(' · ')}</span>
      <button class="btn small paper" id="reroll">🔄 1g <span class="key">R</span></button>
      <button class="btn small blue" id="level" ${run.slots >= MAX_SLOTS ? 'disabled' : ''}>⬆ ${run.slots >= MAX_SLOTS ? 'Max' : LEVEL_COST[run.slots] + 'g'} <span class="key">F</span></button></div>
    <div class="shop" id="shop">${run.shop.map((id, i) => shopCard(id, i)).join('')}</div>
    <div class="proj panel">
      <div class="phead"><b>Projection</b> <span class="muted">${ht ? '2nd half from ' + run.score.join('–') : 'full match'}</span><button class="btn small ghost" id="scout">🔍 Scout</button></div>
      <div class="wdl">Win ${oddsPill(P.w)} Draw ${oddsPill(P.d)} Loss ${oddsPill(P.l)}</div>
      <div class="xg">xG <b>${P.xgY.toFixed(2)}</b> – <b>${P.xgO.toFixed(2)}</b> · Ball ${Math.round(P.share * 100)}%</div>
      ${compareHTML(you, opp)}
      ${you.notes.length ? `<div class="notes">${you.notes.map((n) => '⚠ ' + n).join('<br>')}</div>` : ''}
    </div>
    <div class="bottombar"><div class="mini">Win ${oddsPill(P.w)} <span class="muted">xG ${P.xgY.toFixed(1)}–${P.xgO.toFixed(1)}</span></div>
      <button class="btn big" id="kick">${ht ? 'Second half' : 'Kick off'} ▶ <span class="key">↵</span></button></div>
  </div>`;

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
  stage.querySelector('#sellbtn')?.addEventListener('click', () => sell(sel.where, sel.i));
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
  return `<div class="uinfo"><b>${u.char.name} ${stars(p)}</b> <span class="muted">${u.char.nick || ''} · ${where}</span>
    <span class="stats">PAC ${st.pace} · PAS ${st.pass} · SHO ${st.shoot} · TAC ${st.tackle} · DRI ${st.dribble} · STA ${st.stamina}</span>
    <span>${u.traits.map((t) => `${TRAITS[t].icon} ${TRAITS[t].name}`).join(' · ')} · wants <b>${ROLE_LINE[u.traits[1]].map((l) => LINE_NAME[l]).join('/')}</b></span>
    <span class="muted">Tap a slot to move. Esc to cancel.</span>
    <button class="btn small red" id="sellbtn">Sell +${v}g <span class="key">Del</span></button></div>`;
}
function linkInfo(st) {
  if (!st.links.length) return `<span class="muted">Links: put a Playmaker behind a forward, two Walls side by side, an Engine next to a midfielder, or a Speedster on a flank.</span>`;
  return st.links.map((l) => `<span class="lk ${l.kind}">${{ feed: '🎯', pair: '🤝', engine: '🫀', wing: '💨' }[l.kind]} ${l.text}</span>`).join('');
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
    <div class="scoutboard">${[0, 1, 2].map((row) => `<div class="srow">${[0, 1, 2].map((c) => { const p = ob[row * 3 + c]; return `<div class="sslot">${p ? `<img src="${spriteURL(charOf(p, R().club, row * 3 + c), 44)}" alt=""><b>${UNIT[p.id].char.name} ${stars(p)}</b>` : ''}</div>`; }).join('')}</div>`).join('')}</div>
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
    drag.ghost = img.cloneNode(); drag.ghost.className = 'ghost';
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
function kickOff() {
  if (busy) return;
  if (onBoard() === 0) { sfx.bad(); shell.toast('Put at least one player on the pitch'); return; }
  playHalf();
}

let skipping = false;
function skip() { if (view) { view.speed = 6; skipping = true; markSpeed(); } }
function markSpeed() { stage.querySelectorAll('[data-sp]').forEach((b) => b.classList.toggle('pressed', +b.dataset.sp === view?.speed)); }

async function playHalf() {
  busy = true; sel = null; skipping = false;
  const r = R(), T = TEAMS[r.club];
  const half = run.half;
  const you = youSide(), opp = oppSide();
  const res = S.simHalf(you, opp, half);
  const P = S.projectMatch(you, opp, run.score, half);
  stage.innerHTML = `<div class="ax match">
    <div class="pitchwrap"><canvas id="pitch"></canvas>
      <div class="halfbadge">${half === 1 ? '1st half' : '2nd half'} · vs ${T.name}</div>
      <div class="simctl"><button class="btn small paper" data-sp="1">×1</button><button class="btn small paper" data-sp="2">×2</button><button class="btn small paper" data-sp="6">⏭ <span class="key">Space</span></button></div>
    </div>
    <div class="mstrip panel dark">
      <div><span class="muted" style="font-size:11px">At kick-off:</span> Win ${oddsPill(P.w)} Draw ${oddsPill(P.d)} Loss ${oddsPill(P.l)}</div>
      <div class="muted" style="font-size:12px">xG ${P.xgY.toFixed(2)}–${P.xgO.toFixed(2)} · Ball ${Math.round(res.share * 100)}% · Press ${S.f1(res.Y.s.prs)} vs Control ${S.f1(res.O.s.ctrl)}</div>
      <div class="syn small">${res.Y.active.map((a) => `<span class="tchip on" style="--tc:${TRAITS[a.t].color}"><i>${TRAITS[a.t].icon}</i><span class="tn">${TRAITS[a.t].name}</span><span class="tc">${a.n}</span></span>`).join('')}</div>
    </div>
  </div>`;
  const cv = stage.querySelector('#pitch');
  view = new MatchView(cv);
  const wrap = stage.querySelector('.pitchwrap');
  const w = wrap.clientWidth;
  view.resize(w, Math.round(Math.min(w * 1.25, Math.max(340, innerHeight * 0.6))), r.variant);
  const youList = [{ c: keeperChar('sun'), slot: 'gk' }, ...run.board.map((p, s) => p && { c: charOf(p, 'sun', s), slot: s, star: p.star }).filter(Boolean)];
  const oppList = [{ c: keeperChar(r.club), slot: 'gk' }, ...opp.board.map((p, s) => p && { c: charOf(p, r.club, s), slot: s, star: p.star }).filter(Boolean)];
  view.setTeams(youList, oppList);
  stage.querySelectorAll('[data-sp]').forEach((b) => b.onclick = () => { view.speed = +b.dataset.sp; sfx.click(); markSpeed(); });
  markSpeed();

  const t0 = half === 1 ? 0 : 45;
  shell.setScore({ home: run.score[0], away: run.score[1], clock: `${t0}'`, awayTeam: 'red' });
  shell.log(`${half === 1 ? 'Kick-off' : 'Second half'} vs ${T.name}. Projection: win ${Math.round(P.w * 100)}%, xG ${P.xgY.toFixed(2)}–${P.xgO.toFixed(2)}.`, 'info', `${t0}'`);
  if (res.Y.active.length) shell.log(`Your synergies: ${res.Y.active.map((a) => `${TRAITS[a.t].icon} ${TRAITS[a.t].name} ${a.n}`).join(', ')}.`, 'info', `${t0}'`);
  for (const l of res.Y.links) shell.log(l.text, 'info', `${t0}'`);
  for (const n of res.Y.notes) shell.log(n, 'bad', `${t0}'`);
  sfx.whistle(half === 1 ? 1 : 2);
  await view.wait(0.6);

  const myView = view;
  for (const poss of res.poss) {
    if (view !== myView) return; // phase changed mid-sim
    shell.setScore({ home: run.score[0], away: run.score[1], clock: `${poss.min}'`, awayTeam: 'red' });
    for (const l of poss.log) shell.log(l.text, l.kind, `${poss.min}'`);
    for (const b of poss.beats) {
      if (view !== myView) return;
      await playBeat(b, r, poss.min);
    }
    await view.wait(0.25);
  }
  if (view !== myView) return;
  sfx.whistle(half === 1 ? 2 : 3);
  if (half === 1) {
    shell.banner('HALF-TIME', `${run.score[0]}–${run.score[1]}`);
    await view.wait(1.4);
    if (view !== myView) return;
    run.half = 2;
    run.gold += 4;
    rollShop();
    shell.log(`Half-time: ${run.score[0]}–${run.score[1]}. +4 gold and a fresh shop. Fix what went wrong.`, 'info', "45'");
    draftScreen();
  } else {
    await view.wait(0.8);
    if (view !== myView) return;
    fullTime();
  }
}

async function playBeat(b, r, min) {
  const v = view;
  if (b.k === 'build') return v.build(b.side);
  if (b.k === 'press') return v.press(b.side);
  if (b.k === 'progress') return v.progress(b.side);
  if (b.k === 'blocked') return v.blocked(b.side);
  if (b.k === 'counter') return v.counter(b.side);
  if (b.k === 'corner') return v.corner(b.side);
  if (b.k === 'shot') {
    const team = b.side === 'you' ? 'sun' : r.club;
    const slot = (b.side === 'you' ? run.board : oppBoard()).findIndex((p) => p === b.who);
    const c = b.who ? charOf(b.who, team, slot) : null;
    const a = await v.setShooter(c, b.side);
    v.label(`${Math.round(b.p * 100)}%`, a.x, a.y - v.size * 1.1, b.side === 'you' ? '#FFD23F' : '#FF8A80', 1);
    await v.wait(0.35);
    const name = b.who ? UNIT[b.who.id].char.name : 'Their striker';
    const word = { goal: 'GOAL', save: 'saved', miss: 'wide' }[b.result];
    if (b.result === 'goal') {
      const shot = v.shot(a, b.side, 'goal');
      await v.wait(0.45);
      if (b.side === 'you') {
        run.score[0]++;
        shell.banner('GOAL!', `${name} · ${run.score[0]}–${run.score[1]}`);
        shell.confetti(); shell.flash('#FFD23F');
      } else {
        run.score[1]++;
        shell.banner('GOAL', `${name} · ${run.score[0]}–${run.score[1]}`, '#FF6B6B');
        sfx.groan();
      }
      shell.shake();
      shell.setScore({ home: run.score[0], away: run.score[1], clock: `${min}'`, awayTeam: 'red' });
      shell.log(`<b>${name} scores!</b> ${b.tag}, ${Math.round(b.p * 100)}% shot. ${run.score[0]}–${run.score[1]}`, 'goal', `${min}'`);
      await shot;
    } else {
      shell.log(`${name}: ${b.tag.toLowerCase()} (${Math.round(b.p * 100)}%) — ${word}.`, b.side === 'you' ? 'bad' : 'good', `${min}'`);
      await v.shot(a, b.side, b.result);
    }
  }
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

  if (final && result === 'win') {
    shell.banner('CHAMPIONS!', 'The Cup is yours');
    shell.modal({ title: '🏆 Cup winners!', html: `<p>You beat ${T.name} ${a}–${b} in the Final with ${run.hp} ❤️ left.${pens}</p><div class="trophy">🏆</div>`, buttons: [{ label: 'New run' }] }).then(() => shell.setPhase('early'));
    return;
  }
  if (run.hp <= 0 || final) {
    shell.modal({ title: final ? 'Runners-up' : 'Knocked out', html: `<p>${final ? `So close: ${T.name} take the Cup.` : 'Out of hearts.'} ${pens}</p><p class="muted">You reached ${r.label}.</p>`, buttons: [{ label: 'New run' }] }).then(() => shell.setPhase('early'));
    return;
  }
  const income = 5 + Math.min(3, Math.floor(run.gold / 10)) + (run.streak >= 2 ? 1 : 0) + (result === 'win' ? 1 : 0);
  const next = ROUNDS[run.round + 1];
  shell.modal({ title: result === 'win' ? 'Win!' : result === 'draw' ? 'Draw' : 'Defeat',
    html: `<p><b>${a}–${b}</b> vs ${T.name}. ${dmg ? `You lose ${dmg} ❤️ (${run.hp} left).` : 'No hearts lost.'}</p>
      <p>Income: <b>+${income}</b> gold (5 base${Math.min(3, Math.floor(run.gold / 10)) ? ' + interest' : ''}${run.streak >= 2 ? ' + streak' : ''}${result === 'win' ? ' + win' : ''}).</p>
      <p>Next: <b>${TEAMS[next.club].name}</b> · ${TRAITS[next.style].icon} ${TRAITS[next.style].name} · ${next.label}</p>`,
    buttons: [{ label: 'To the shop ▶' }] }).then(() => {
    run.round++; run.half = 1; run.score = [0, 0]; run.gold += income;
    rollShop();
    shell.clearLog();
    shell.log(`${R().label}: ${TEAMS[R().club].name} (${TRAITS[R().style].name}). Scout them, then build.`, 'info', '');
    draftScreen();
  });
}

