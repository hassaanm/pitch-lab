// Touchline: a league-by-league deckbuilder. Your deck is your tactics;
// each 15-minute spell you play cards, then watch the match simulate.
import { Shell, oddsPill, oddsClass } from '../../shared/shell.js';
import { portrait, spriteURL } from '../../shared/art.js';
import { sfx } from '../../shared/sfx.js';
import { byId, LINEUP7, TEAMS, crestSVG } from '../../shared/cast.js';
import { STYLES, COACHES, LEAGUES, CUP, DIVISIONS, CARDS, COACH_DECK, AI_DECK, opponentStats, clubSquad, rewardPool } from './data.js';
import * as S from './sim.js';
import { MatchView } from './view.js';

const shell = new Shell({
  id: 'league-deck',
  title: 'Touchline',
  pitch: 'You are the coach. Your deck is your tactics. Every 15 minutes you play cards, then the match plays itself out — and you step in on the big chances.',
  how: [
    'Pick a coach and a league. Each league has 3 clubs, then its legendary coach.',
    'Each spell (15 minutes) you get 3 📣 Shouts and 5 cards. Cards change your team\'s stats for that spell.',
    'The rival coach shows their plan first. Read it, counter it. The odds update as you play cards.',
    'Kick off to watch the spell. On a big chance, you choose what happens (with odds).',
    'Win to draft a new card. Beat the legend to unlock that coach and their style.',
    'Tap a played card to take it back. Keys: 1–7 play a card, Enter kicks off, D shows your deck.',
  ],
  notice: 'Does a deck + simulation keep soccer\'s flow while still giving you real decisions? Watch whether reading the rival\'s plan feels like coaching, and whether the big-chance moments are enough hands-on play.',
  phases: [
    { id: 'early', label: 'Kickoff', sub: 'New run · pick coach & league' },
    { id: 'mid', label: 'Midgame', sub: "La Lija · 45' · 1–1" },
    { id: 'clutch', label: 'Clutch', sub: "Final vs Herr Gegen · 75' · 1–2" },
  ],
  onPhase: (id) => startPhase(id),
});

const stage = shell.stage;
const ALL_LEAGUES = [...LEAGUES, CUP];
const SAVE = 'touchline-progress-v1';
let progress = load();
function load() { try { return JSON.parse(localStorage.getItem(SAVE)) || { coaches: ['rookie'], beaten: [] }; } catch { return { coaches: ['rookie'], beaten: [] }; } }
function save() { try { localStorage.setItem(SAVE, JSON.stringify(progress)); } catch {} }

let run = null;   // { coach, league, round, deck, bonus }
let m = null;     // current match
let view = null;
let busy = false;
let selCoach = 'rookie';

// ================================================================ phases
function startPhase(id) {
  busy = false;
  if (id === 'early') { run = null; m = null; homeScreen(); return; }
  if (id === 'mid') {
    run = { coach: 'rookie', league: 'liga', round: 2, bonus: { ctrl: 1 },
      deck: ['shape', 'shape', 'passmove', 'passmove', 'forward', 'forward', 'press1', 'shootsight', 'breather', 'captain', 'rondo', 'thirdman', 'gegen', 'eagle'] };
    startMatch({ spell: 3, score: [1, 1], youSta: 64, oppSta: 60 });
    return;
  }
  if (id === 'clutch') {
    run = { coach: 'tiki', league: 'bunda', round: 3, bonus: { ctrl: 1, atk: 1 },
      deck: [...COACH_DECK.tiki, 'switchplay', 'eagle', 'setpiece', 'watersub', 'hairdryer', 'lateshow', 'nutmeg'] };
    startMatch({ spell: 5, score: [1, 2], youSta: 40, oppSta: 46 });
  }
}

// ================================================================ home
function homeScreen() {
  shell.setScore(null);
  const allBeaten = LEAGUES.every((l) => progress.beaten.includes(l.id));
  if (!progress.coaches.includes(selCoach)) selCoach = 'rookie';
  stage.innerHTML = `<div class="screen">
    <div class="logo">TOUCHLINE</div>
    <div class="sublogo">Deck-building football management · ${progress.beaten.length}/5 leagues conquered</div>
    <h2 class="sec">1 · Your coach</h2>
    <div class="coaches">${Object.values(COACHES).filter((c) => c.id !== 'cupboss').map((c) => {
      const locked = !progress.coaches.includes(c.id);
      return `<div class="coach panel ${locked ? 'locked' : ''} ${c.id === selCoach ? 'sel' : ''}" data-coach="${c.id}">
        <img src="${portrait(c.char, 84)}" alt=""><b>${locked ? '???' : c.name}</b><span>${STYLES[c.style].icon} ${STYLES[c.style].name}</span></div>`;
    }).join('')}</div>
    <div class="coachinfo panel dark" id="coachinfo"></div>
    <h2 class="sec">2 · Pick a league</h2>
    ${ALL_LEAGUES.map((l) => {
      const boss = COACHES[l.boss];
      const done = progress.beaten.includes(l.id);
      const locked = l.id === 'cup' && !allBeaten;
      return `<div class="league panel ${done ? 'done' : ''} ${locked ? 'locked' : ''}" data-league="${l.id}">
        <div class="flag">${l.flag}</div>
        <div class="grow"><h3>${l.name} ${done ? '✅' : ''}</h3>
          <span class="stylechip" style="background:${STYLES[l.style].color}">${STYLES[l.style].icon} ${STYLES[l.style].name}</span>
          <p>${l.lore}</p></div>
        <div class="boss center"><img src="${portrait(boss.char, 54)}" alt=""><div style="font-size:10px;font-weight:900">${locked ? '🔒' : boss.name}</div></div>
      </div>`;
    }).join('')}
    <div class="row wrap" style="justify-content:center;margin:8px 0 20px">
      <button class="btn small ghost" id="unlockall">Unlock everything (testing)</button>
      <button class="btn small ghost" id="reset">Reset progress</button>
    </div>
  </div>`;
  const info = () => {
    const c = COACHES[selCoach];
    stage.querySelector('#coachinfo').innerHTML = `<b style="font-family:var(--font-h);font-size:16px">${c.name}</b> · ${c.title}<br>${c.passive}<br><span class="muted">Starter deck: ${COACH_DECK[c.id].map((id) => CARDS[id].name).filter((v, i, a) => a.indexOf(v) === i).join(', ')}</span>`;
  };
  info();
  stage.querySelectorAll('.coach').forEach((el) => el.onclick = () => {
    if (el.classList.contains('locked')) { shell.toast('Beat this coach in their league to unlock them'); sfx.bad(); return; }
    sfx.click(); selCoach = el.dataset.coach;
    stage.querySelectorAll('.coach').forEach((e) => e.classList.toggle('sel', e === el)); info();
  });
  stage.querySelectorAll('.league').forEach((el) => el.onclick = () => {
    sfx.click();
    run = { coach: selCoach, league: el.dataset.league, round: 0, deck: [...COACH_DECK[selCoach]], bonus: {} };
    ladderScreen();
  });
  stage.querySelector('#unlockall').onclick = () => { progress = { coaches: Object.keys(COACHES).filter((c) => c !== 'cupboss'), beaten: LEAGUES.map((l) => l.id) }; save(); homeScreen(); };
  stage.querySelector('#reset').onclick = () => { progress = { coaches: ['rookie'], beaten: [] }; save(); selCoach = 'rookie'; homeScreen(); };
}

const leagueOf = (id) => ALL_LEAGUES.find((l) => l.id === id);
function opponentFor(round) {
  const L = leagueOf(run.league);
  const clubId = L.clubs[round];
  const isBoss = round === 3;
  const style = L.id === 'cup' ? L.styles[round] : L.style;
  const coach = isBoss ? L.boss : (L.id === 'cup' ? Object.values(COACHES).find((c) => c.style === style)?.id : null);
  return { clubId, isBoss, style, coach };
}

// ================================================================ ladder
function ladderScreen() {
  shell.setScore(null);
  const L = leagueOf(run.league);
  const coach = COACHES[run.coach];
  stage.innerHTML = `<div class="screen">
    <div class="row"><button class="btn small ghost" id="home">◀ Leagues</button><div class="grow"></div><span class="deckinfo" id="deck">Your deck: ${run.deck.length} cards</span></div>
    <div class="panel dark row"><img src="${portrait(coach.char, 48)}" style="border-radius:10px;border:3px solid var(--ink)" alt="">
      <div><b style="font-family:var(--font-h);font-size:18px">${L.flag} ${L.name}</b><br><span style="font-size:12px">Coach: ${coach.name} · ${STYLES[coach.style].icon} ${STYLES[coach.style].name}</span></div></div>
    <div class="ladder">${L.clubs.map((clubId, i) => {
      const o = opponentFor(i);
      const t = TEAMS[clubId];
      const boss = o.isBoss ? COACHES[o.coach] : null;
      return `<div class="rung panel ${i === run.round ? 'cur' : ''} ${i < run.round ? 'past' : ''}">
        <div class="num">${L.id === 'cup' ? ['Round of 16', 'Quarter-final', 'Semi-final', 'Final'][i] : DIVISIONS[i]}</div>
        <div class="kit" style="background:linear-gradient(90deg, ${t.shirt} 50%, ${t.trim} 50%)"></div>
        <div class="grow"><b style="font-family:var(--font-h);font-size:16px">${t.name}</b><br><span style="font-size:11px">${STYLES[o.style].icon} ${STYLES[o.style].name}${boss ? ` · Legendary coach: <b>${boss.name}</b>` : ''}</span></div>
        ${boss ? `<img src="${portrait(boss.char, 44)}" style="border-radius:8px;border:2px solid var(--ink)" alt="">` : (i < run.round ? '✅' : '')}
      </div>`;
    }).join('')}</div>
    <button class="btn big block" id="play">Play ${TEAMS[L.clubs[run.round]].name} ▶</button>
  </div>`;
  stage.querySelector('#home').onclick = () => { sfx.click(); homeScreen(); };
  stage.querySelector('#deck').onclick = () => showDeck();
  stage.querySelector('#play').onclick = () => { sfx.whistle(); startMatch({}); };
}

function cardHTML(id, o = {}) {
  const c = CARDS[id];
  const st = STYLES[c.style];
  const who = c.who ? byId[c.who] : null;
  const art = who ? `<div class="art" style="background-image:url(${portrait(who, 104)})"></div>` : `<div class="art tac">${c.icon || '⚽'}</div>`;
  const cost = o.cost ?? c.cost;
  return `<div class="gcard ${c.type === 'player' ? 'player' : ''} ${o.cls || ''}" style="--cc:${st.color};${o.style || ''}" data-id="${id}" ${o.idx != null ? `data-idx="${o.idx}"` : ''} tabindex="0">
    <div class="cost" ${cost < c.cost ? 'style="background:#6fd36a"' : ''}>${cost}</div><div class="name" ${c.name.length > 13 ? 'style="font-size:10px"' : ''}>${c.name}</div>${art}
    <div class="type">${st.icon} ${st.name} · ${c.type}</div><div class="text">${c.text}</div>${o.key ? `<span class="kbdh">${o.key}</span>` : ''}</div>`;
}

function showDeck() {
  const counts = {};
  for (const id of run.deck) counts[id] = (counts[id] || 0) + 1;
  shell.modal({ title: `Your deck (${run.deck.length})`, wide: true,
    html: `<div class="deckgrid">${Object.keys(counts).map((id) => `<div style="position:relative">${cardHTML(id)}${counts[id] > 1 ? `<span class="chip" style="position:absolute;top:-6px;right:-6px">×${counts[id]}</span>` : ''}</div>`).join('')}</div>`,
    buttons: [{ label: 'Close' }] });
}

// ================================================================ match setup
function startMatch(o) {
  const L = leagueOf(run.league);
  const opp = opponentFor(run.round);
  const base = { ctrl: 10, atk: 10, fin: 10, def: 10, prs: 10, gk: 10 };
  for (const k in run.bonus) base[k] += run.bonus[k];
  const variant = opp.isBoss ? 'night' : L.variant;
  m = {
    league: L, opp: null, you: null, spell: o.spell || 0, score: o.score ? [...o.score] : [0, 0], variant, oppInfo: opp,
  };
  const youSquad = LINEUP7.sun.map((id) => byId[id]);
  m.you = { coach: run.coach, base, perm: {}, permOpp: {}, permHooks: { staPerSpell: 0, drawPerSpell: 0 }, sta: o.youSta ?? 100,
    draw: S.shuffle(run.deck), discard: [], hand: [], played: [], log: [], shouts: 3, squad: youSquad, bench: ['bruno', 'pip', 'sol'].map((id) => byId[id]), exhausted: [] };
  m.opp = { coach: opp.coach, base: opponentStats(run.round, opp.style, opp.isBoss), perm: {}, permOpp: {}, permHooks: { staPerSpell: 0 }, sta: o.oppSta ?? 100,
    played: [], shouts: 3, squad: clubSquad(opp.clubId), deck: AI_DECK[opp.style], clubId: opp.clubId };
  matchScreen();
  beginSpell(true);
  const oc = opp.coach ? COACHES[opp.coach] : null;
  shell.log(`${TEAMS[opp.clubId].name}${oc ? ` (coach ${oc.name})` : ''} — ${STYLES[opp.style].name} style.`, 'info', `${m.spell * 15}'`);
}

function matchScreen() {
  const T = TEAMS[m.opp.clubId];
  stage.innerHTML = `<div class="screen">
    <div class="pitchwrap"><canvas id="pitch"></canvas><div class="spellbadge" id="spellbadge"></div>
      <div class="simctl" id="simctl" hidden><button class="btn small paper" data-sp="1">×1</button><button class="btn small paper" data-sp="2">×2</button><button class="btn small paper" data-sp="5">⏭</button></div>
    </div>
    <div class="intent panel dark" id="intent"></div>
    <div class="played" id="played"></div>
    <div class="hand" id="hand"></div>
    <div class="compare panel" id="compare"></div>
    <div class="bottombar"><div><div class="shouts" id="shouts"></div><div class="miniproj" id="miniproj"></div><div class="deckinfo" id="deckinfo"></div></div>
      <button class="btn big" id="kick">Kick off ▶</button></div>
  </div>`;
  const cv = stage.querySelector('#pitch');
  view = new MatchView(cv);
  fitPitch();
  window.onresize = () => fitPitch();
  view.setTeams(currentSquad(), m.opp.squad);
  stage.querySelector('#kick').onclick = () => kickOff();
  stage.querySelector('#deckinfo').onclick = () => showDeck();
  stage.querySelectorAll('[data-sp]').forEach((b) => b.onclick = () => { view.speed = +b.dataset.sp; sfx.click(); markSpeed(); });
  markSpeed();
  void T;
}
// Compact pitch while choosing cards; tall pitch while the spell plays.
function fitPitch() {
  const wrap = stage.querySelector('.pitchwrap');
  if (!wrap || !view) return;
  const w = wrap.clientWidth;
  const tall = busy;
  const h = Math.round(tall ? Math.min(w * 1.1, Math.max(320, innerHeight * 0.62)) : Math.min(w * 0.62, 330));
  view.resize(w, h, m.variant);
}
function markSpeed() { stage.querySelectorAll('[data-sp]').forEach((b) => b.classList.toggle('pressed', +b.dataset.sp === view.speed)); }

// Player cards bring that player onto the pitch for the spell.
function currentSquad() {
  const sq = [...m.you.squad];
  for (const id of m.you.played) {
    const c = CARDS[id];
    if (!c.who || sq.some((p) => p.id === c.who)) continue;
    const p = byId[c.who];
    const replace = p.pos === 'MF' ? 'lupe' : (m.you.played.some((x) => CARDS[x].who === 'rio') ? 'kenji' : 'rio');
    const i = sq.findIndex((q) => q.id === replace);
    if (i >= 0) sq[i] = p;
  }
  return sq;
}

// ================================================================ spells
function beginSpell(first = false) {
  const me = m.you;
  me.played = []; me.playLog = [];
  me.shouts = 3 + (run.coach === 'thunder' && m.spell >= 4 ? 1 : 0) + (me.bonusShout || 0);
  me.bonusShout = 0;
  drawCardsFor(5 + me.permHooks.drawPerSpell + (m.spell === 3 && !first ? 1 : 0));
  m.opp.shouts = 2 + (m.oppInfo.isBoss ? 1 : 0) + (m.oppInfo.isBoss && m.spell >= 4 ? 1 : 0);
  m.opp.played = [];
  m.opp.played = S.aiPlan(m, m.opp.deck);
  if (m.spell === 3 && !first) shell.log('Half-time team talk: draw 1 extra card.', 'info', "45'");
  render();
}

function drawCardsFor(n) { S.drawCards(m.you, n); }

function render() {
  if (!m) return;
  const me = m.you;
  shell.setScore({ home: m.score[0], away: m.score[1], clock: `${m.spell * 15}'`, awayTeam: 'red' });
  stage.querySelector('#spellbadge').textContent = `Spell ${m.spell + 1}/6 · ${m.spell * 15}'–${m.spell * 15 + 15}'`;
  // rival plan
  const oc = m.oppInfo.coach ? COACHES[m.oppInfo.coach] : null;
  const T = TEAMS[m.opp.clubId];
  stage.querySelector('#intent').innerHTML = `
    ${oc ? `<img src="${portrait(oc.char, 50)}" alt="">` : `<div style="flex:none">${crestSVG('red', 44).replace(/#E8463A/g, T.shirt)}</div>`}
    <div class="grow"><div class="lbl">${oc ? oc.name : T.name + "'s coach"} plans this spell:</div>
      <div class="chips">${m.opp.played.length ? m.opp.played.map((id) => { const c = CARDS[id]; return `<span class="ichip" title="${c.text}"><i style="background:${STYLES[c.style].color}">${c.icon || '👤'}</i>${c.name}</span>`; }).join('') : '<span class="ichip">Nothing special</span>'}</div>
      <div class="desc">${m.opp.played.map((id) => CARDS[id].text).join(' · ')}</div></div>`;
  // stat compare + projection
  const P = S.projection(m);
  const rows = ['ctrl', 'atk', 'def', 'prs', 'fin', 'gk'];
  const baseY = S.spellStats({ ...m, you: { ...me, played: [] }, opp: m.opp }, 'you');
  stage.querySelector('#compare').innerHTML = '<div class="cgrid">' + ['ctrl', 'def', 'atk', 'prs', 'fin', 'gk'].map((k) => {
    const y = P.Y[k], o = P.O[k], b = baseY[k];
    const cls = y > b + 0.05 ? 'up' : y < b - 0.05 ? 'down' : '';
    return `<div class="crow"><span>${S.STAT_LABEL[k]}</span><span class="v ${cls}">${fmt(y)}</span><div class="sbar"><i style="width:${(y / (y + o)) * 100}%"></i></div><span class="v">${fmt(o)}</span></div>`;
  }).join('') + `</div>
    <div class="proj">Ball ${oddsPill(P.share)} · You score ${oddsPill(P.pY)} · They score ${oddsPill(P.pO)}</div>
    <div class="proj" style="font-size:11px;opacity:.75">Their press wins it ${Math.round(P.pressO * 100)}% · You break their line ${Math.round(P.progY * 100)}% · ${P.n} possessions</div>
    <div class="staline"><span>Your legs</span><div class="stabar"><i style="width:${me.sta}%"></i></div><span>${Math.round(me.sta)}</span>
      <span>Theirs</span><div class="stabar opp"><i style="width:${m.opp.sta}%"></i></div><span>${Math.round(m.opp.sta)}</span></div>
    ${P.Y.h.fatigue > 0.2 ? `<div class="proj" style="color:var(--bad)">😮‍💨 Tired: −${fmt(P.Y.h.fatigue)} Attack/Defence, more to Press</div>` : ''}`;
  stage.querySelector('#miniproj').innerHTML = `⚽ ${oddsPill(P.share)} You ${oddsPill(P.pY)} Them ${oddsPill(P.pO)}`;
  // played
  stage.querySelector('#played').innerHTML = me.played.length
    ? me.played.map((id, i) => `<span class="pchip" data-pi="${i}" title="Tap to take back">${CARDS[id].icon || '👤'} ${CARDS[id].name}</span>`).join('')
    : `<span class="muted" style="font-size:12px">Play cards from your hand. Played cards show here — tap one to take it back.</span>`;
  stage.querySelectorAll('.pchip').forEach((el) => el.onclick = () => undoCard(+el.dataset.pi));
  // hand
  const hand = stage.querySelector('#hand');
  const n = me.hand.length;
  hand.innerHTML = me.hand.map((id, i) => {
    const cost = S.cardCost(m, id);
    const rot = (i - (n - 1) / 2) * 4;
    return cardHTML(id, { idx: i, cost, key: i + 1, cls: cost > me.shouts ? 'cant' : '', style: `transform:rotate(${rot}deg) translateY(${Math.abs(rot) * 1.2}px)` });
  }).join('') || '<span class="muted">No cards left in hand.</span>';
  hand.querySelectorAll('.gcard').forEach((el) => {
    el.onclick = () => playCard(+el.dataset.idx);
    el.onmouseenter = () => { el.dataset.t = el.style.transform; el.style.transform = 'translateY(-14px) scale(1.06)'; };
    el.onmouseleave = () => { el.style.transform = el.dataset.t || ''; };
  });
  stage.querySelector('#shouts').innerHTML = `📣 ${Array.from({ length: Math.max(3, me.shouts + me.played.reduce((a, _, i) => a + (me.playLog[i]?.cost || 0), 0)) }, (_, i) => `<span class="gem ${i < me.shouts ? '' : 'off'}"></span>`).join('')}`;
  stage.querySelector('#deckinfo').textContent = `Draw ${me.draw.length} · Discard ${me.discard.length} · Deck ${run.deck.length}`;
  stage.querySelector('#kick').textContent = m.spell >= S.SPELLS ? 'Extra time ▶' : `Kick off ${m.spell * 15}' ▶`;
}
const fmt = (v) => (Math.round(v * 10) / 10).toString();

function playCard(i) {
  if (busy) return;
  const me = m.you;
  const id = me.hand[i];
  if (!id) return;
  const cost = S.cardCost(m, id);
  if (cost > me.shouts) { sfx.bad(); shell.toast(`Not enough 📣 Shouts (${cost} needed)`); return; }
  const c = CARDS[id];
  sfx.card();
  me.shouts -= cost;
  me.hand.splice(i, 1);
  me.played.push(id);
  const entry = { id, cost, sta: c.sta || 0, perm: !!c.perm };
  me.sta = Math.max(0, Math.min(100, me.sta + entry.sta));
  if (c.perm) {
    for (const k in c.fx || {}) me.perm[k] = (me.perm[k] || 0) + c.fx[k];
    for (const k in c.oppFx || {}) me.permOpp[k] = (me.permOpp[k] || 0) + c.oppFx[k];
    me.permHooks.staPerSpell += c.staPerSpell || 0;
    me.permHooks.drawPerSpell += c.drawPerSpell || 0;
  }
  if (c.rhythm) { me.perm[c.rhythm] = (me.perm[c.rhythm] || 0) + 1; entry.rhythm = c.rhythm; }
  me.playLog.push(entry);
  if (c.who) {
    const p = byId[c.who];
    view.setTeams(currentSquad(), m.opp.squad);
    view.highlight = p.id;
    setTimeout(() => { if (view.highlight === p.id) view.highlight = null; }, 1500);
  }
  render();
}

function undoCard(pi) {
  if (busy) return;
  const me = m.you;
  const id = me.played[pi];
  const e = me.playLog[pi];
  const c = CARDS[id];
  sfx.deal();
  me.played.splice(pi, 1); me.playLog.splice(pi, 1);
  me.hand.push(id);
  me.shouts += e.cost;
  me.sta = Math.max(0, Math.min(100, me.sta - e.sta));
  if (e.perm) {
    for (const k in c.fx || {}) me.perm[k] -= c.fx[k];
    for (const k in c.oppFx || {}) me.permOpp[k] -= c.oppFx[k];
    me.permHooks.staPerSpell -= c.staPerSpell || 0;
    me.permHooks.drawPerSpell -= c.drawPerSpell || 0;
  }
  if (e.rhythm) me.perm[e.rhythm] -= 1;
  // costs may change (Don Tiki's free possession card): recompute shouts from scratch
  const spent = me.playLog.reduce((a, x) => a + x.cost, 0);
  me.shouts = 3 + (run.coach === 'thunder' && m.spell >= 4 ? 1 : 0) - spent;
  view.setTeams(currentSquad(), m.opp.squad);
  render();
}

// ================================================================ simulate a spell
async function kickOff() {
  if (busy) return;
  busy = true;
  sfx.whistle();
  const me = m.you, op = m.opp;
  stage.querySelector('#kick').disabled = true;
  stage.querySelector('#simctl').hidden = false;
  fitPitch();
  window.scrollTo({ top: stage.querySelector('.pitchwrap').getBoundingClientRect().top + scrollY - 64, behavior: 'smooth' });
  const Y = S.spellStats(m, 'you'), O = S.spellStats(m, 'opp');
  const share = S.possShare(Y, O);
  const n = S.numPoss(Y, O);
  const startMin = m.spell * 15;
  const playedNames = me.played.map((id) => CARDS[id].name);
  shell.log(`You: ${playedNames.join(', ') || 'no changes'}. They: ${op.played.map((id) => CARDS[id].name).join(', ') || 'no changes'}.`, 'info', `${startMin}'`);
  for (const c of op.played.map((id) => CARDS[id])) op.sta = clamp100(op.sta + (c.sta || 0));
  let scoredThisSpell = false;

  // set pieces first
  for (const [side, St, Def] of [['you', Y, O], ['opp', O, Y]]) {
    for (const sp of St.h.setPiece) {
      const min = startMin + 2;
      await view.corner(side);
      const p = S.goalP(sp.p, Def);
      const shooter = sp.who ? byId[sp.who] : S.pickShooter(m[side].squad);
      const actor = await view.setShooter(sp.who && side === 'you' ? byId[sp.who] : shooter, side);
      const res = S.rollShot(p);
      shell.log(`${side === 'you' ? '' : TEAMS[op.clubId].name + ' '}corner — ${shooter.name} attacks it (${Math.round(p * 100)}%)…`, side === 'you' ? '' : 'them', `${min}'`);
      await view.shot(actor, side, res, { header: true });
      if (res === 'goal') { goal(side, shooter, min); if (side === 'you') scoredThisSpell = true; }
    }
  }

  for (let i = 0; i < n; i++) {
    const min = Math.round(startMin + ((i + 1) * 15) / (n + 1));
    shell.setScore({ home: m.score[0], away: m.score[1], clock: `${min}'` });
    const owner = Math.random() < share ? 'you' : 'opp';
    const beats = S.genPossession(m, owner, Y, O);
    for (const b of beats) {
      const r = await animateBeat(b, min, Y, O);
      if (r === 'goal-you') scoredThisSpell = true;
    }
  }

  // end of spell bookkeeping
  stage.querySelector('#simctl').hidden = true;
  view.speed = 1; markSpeed();
  me.sta = clamp100(me.sta - 8 + me.permHooks.staPerSpell);
  op.sta = clamp100(op.sta - 8);
  if (scoredThisSpell && Y.h.onGoalShout) { me.bonusShout = Y.h.onGoalShout; shell.log('Rabona! The crowd gives you +1 Shout next spell.', 'good'); }
  me.discard.push(...me.played.filter((id) => !CARDS[id].perm), ...me.hand);
  me.hand = [];
  m.spell++;
  busy = false;
  fitPitch();
  stage.querySelector('#kick').disabled = false;
  if (m.spell === 3) { sfx.whistle(2); shell.banner('HALF-TIME', `${m.score[0]} – ${m.score[1]}`); }
  if (m.spell >= S.SPELLS) {
    if (m.score[0] === m.score[1] && m.spell === S.SPELLS) {
      sfx.whistle(2);
      shell.banner('EXTRA TIME', 'One more spell');
      shell.log('Level after 90. One spell of extra time, then penalties.', 'info', "90'");
      beginSpell();
      return;
    }
    return fullTime();
  }
  beginSpell();
}
const clamp100 = (v) => Math.max(0, Math.min(100, v));

function nameOf(side) { return side === 'you' ? 'Sunbirds' : TEAMS[m.opp.clubId].name; }

async function animateBeat(b, min, Y, O) {
  const side = b.side;
  const t = `${min}'`;
  const them = side === 'opp' ? 'them' : '';
  switch (b.k) {
    case 'build': await view.build(side); break;
    case 'pass': break;
    case 'press': {
      const victim = view.carrier?.c;
      await view.press(side);
      const presser = view.carrier?.c;
      shell.log(`${presser?.name || nameOf(side)} presses ${victim?.name || ''} and wins it high! (press ${Math.round(b.p * 100)}%)`, side === 'you' ? 'good' : 'bad', t);
      break;
    }
    case 'skill': await view.skill(); shell.log(`${view.carrier?.c.name} skips past the defence — skill move!`, side === 'you' ? 'good' : 'them', t); break;
    case 'lost': await view.blocked(side === 'you' ? 'opp' : 'you'); shell.log(`${nameOf(side)} try one trick too many and lose it.`, side === 'you' ? 'bad' : 'good', t); break;
    case 'progress': await view.progress(side); shell.log(`${nameOf(side)} break into the final third.`, them, t); break;
    case 'blocked': {
      const att = view.carrier?.c;
      await view.blocked(side);
      shell.log(`${view.carrier?.c.name} cuts out ${att?.name || 'the attack'}.`, side === 'you' ? 'good' : 'them', t);
      break;
    }
    case 'counter': await view.counter(side); shell.log(`Counter-attack by ${nameOf(side)}! (${Math.round(b.p * 100)}% to break)`, side === 'you' ? 'good' : 'bad', t); break;
    case 'foul': sfx.whistle(); view.label('🟨 FOUL', view.ball.x, view.ball.y - 30, '#FFD23F'); shell.log(`Tactical foul by ${nameOf(side)} stops a big chance. Booking.`, 'info', t); await view.wait(0.6); break;
    case 'chance': break;
    case 'shot': {
      const actor = await view.setShooter(b.shooter, side);
      shell.log(`${b.shooter.name} shoots${b.kind === 'counter' ? ' on the break' : b.kind === 'turnover' ? ' after the turnover' : ''} (${Math.round(b.p * 100)}%)…`, them, t);
      await view.shot(actor, side, b.result, { header: b.kind === 'header' });
      if (b.result === 'goal') { goal(side, b.shooter, min); return side === 'you' ? 'goal-you' : 'goal-opp'; }
      shell.log(b.result === 'save' ? 'Saved.' : 'Off target.', '', '');
      break;
    }
    case 'moment': {
      const actor = await view.setShooter(b.shooter, side);
      const opts = S.momentOptions(m, b, Y, O);
      const choice = await keyMoment(b, opts);
      const res = S.resolveMoment(m, b, choice, Y, O);
      shell.log(`${side === 'you' ? 'You' : 'Wak'} chose "${choice.label}" (${Math.round(choice.p * 100)}%). ${res.text || ''}`, side === 'you' ? '' : 'them', t);
      if (res.result === 'cut') { await view.blocked('opp'); return; }
      let shooterActor = actor;
      if (res.shooter && res.shooter.id !== b.shooter.id) {
        const mate = view.find(res.shooter, side);
        if (mate) { const [x, y] = view.pitch.toPx(0.5, side === 'you' ? 0.1 : 0.9); await Promise.all([view.runTo(mate, x, y, 0.4)]); await view.pass(actor, mate, 0.3); shooterActor = mate; }
      }
      if (res.round) await view.skill();
      await view.shot(shooterActor, side, res.result);
      view.release(shooterActor, actor);
      if (res.result === 'goal') { goal(side, res.shooter, min); return side === 'you' ? 'goal-you' : 'goal-opp'; }
      break;
    }
  }
}

function goal(side, scorer, min) {
  if (side === 'you') m.score[0]++; else m.score[1]++;
  shell.setScore({ home: m.score[0], away: m.score[1], clock: `${min}'` });
  shell.log(`GOAL! ${scorer.name} — ${m.score[0]}–${m.score[1]}`, 'goal', `${min}'`);
  if (side === 'you') { shell.banner('GOAL!', `${scorer.name} ${min}'`); shell.confetti(); }
  else shell.banner('GOAL', `${scorer.name} · ${nameOf('opp')}`, '#ff8a80');
  shell.shake(stage.querySelector('.pitchwrap'));
}

function keyMoment(b, opts) {
  return new Promise((resolve) => {
    const wrap = stage.querySelector('.pitchwrap');
    const el = document.createElement('div');
    el.className = 'moment' + (b.side === 'opp' ? ' def' : '');
    const youAtk = b.side === 'you';
    el.innerHTML = `<div class="panel">
      <div class="row"><span class="pframe"><img src="${portrait(youAtk ? b.shooter : byId.wak, 56)}" width="56" height="56" alt=""></span>
      <div><h3>${youAtk ? 'BIG CHANCE!' : 'DANGER!'}</h3><div style="font-size:13px">${youAtk ? `${b.shooter.name} is clean through.` : `${b.shooter.name} is through on Wak.`} What now?</div></div></div>
      ${opts.map((o, i) => `<button class="btn ${youAtk ? '' : 'paper'} opt" data-i="${i}"><span>${o.label}<small>${o.detail}</small></span>${oddsPill(o.p, youAtk ? 'goal' : 'save')}<span class="key">${i + 1}</span></button>`).join('')}
    </div>`;
    sfx.cutin();
    view.speed = Math.min(view.speed, 2);
    const done = (i) => { document.removeEventListener('keydown', onKey); el.remove(); sfx.click(); resolve(opts[i]); };
    const onKey = (e) => { const k = +e.key; if (k >= 1 && k <= opts.length) done(k - 1); };
    document.addEventListener('keydown', onKey);
    el.querySelectorAll('.opt').forEach((btn) => btn.onclick = () => done(+btn.dataset.i));
    wrap.appendChild(el);
  });
}

// ================================================================ full time
async function fullTime() {
  let [a, b] = m.score;
  let pens = '';
  if (a === b) {
    // quick shootout, 5 kicks each at 75%
    let pa = 0, pb = 0;
    for (let i = 0; i < 5 || pa === pb; i++) { if (Math.random() < 0.75) pa++; if (Math.random() < 0.75) pb++; if (i > 12) break; }
    pens = ` (pens ${pa}–${pb})`;
    shell.log(`Penalties: ${pa}–${pb}`, 'info', "120'");
    a += pa > pb ? 0.1 : 0; b += pb > pa ? 0.1 : 0;
  }
  const won = a > b;
  sfx.whistle(3);
  await shell.wait(600);
  const opp = m.oppInfo;
  const L = m.league;
  if (won) {
    sfx.win(); shell.confetti(200);
    if (opp.isBoss) return leagueWon(pens);
    shell.banner('FULL TIME', `You win ${m.score[0]}–${m.score[1]}${pens}`);
    await shell.wait(1200);
    run.round++;
    rewardScreen(`Beat ${TEAMS[opp.clubId].name} ${m.score[0]}–${m.score[1]}${pens}`);
  } else {
    sfx.lose();
    shell.banner('FULL TIME', `Lost ${m.score[0]}–${m.score[1]}${pens}`, '#ff8a80');
    await shell.wait(1000);
    const choice = await shell.modal({ title: 'Knocked out', dismiss: false,
      html: `<p>${TEAMS[opp.clubId].name} beat you ${m.score[0]}–${m.score[1]}${pens} in ${L.name}.</p><p class="muted">Prototype: you can replay the match with the same deck instead of starting over.</p>`,
      buttons: [{ label: 'Replay match', value: 'replay' }, { label: 'New run', cls: 'paper', value: 'home' }] });
    if (choice === 'replay') startMatch({}); else homeScreen();
  }
}

async function leagueWon(pens) {
  const L = m.league;
  const boss = COACHES[L.boss];
  const newCoach = !progress.coaches.includes(boss.id) && boss.id !== 'cupboss';
  if (newCoach) progress.coaches.push(boss.id);
  if (!progress.beaten.includes(L.id)) progress.beaten.push(L.id);
  save();
  shell.setScore(null);
  stage.innerHTML = `<div class="screen center">
    <div class="trophy">🏆</div>
    <div class="logo" style="font-size:34px">${L.name} CHAMPIONS</div>
    <p>You beat ${boss.name}'s ${TEAMS[m.opp.clubId].name} ${m.score[0]}–${m.score[1]}${pens}.</p>
    ${newCoach ? `<div class="panel row" style="text-align:left"><img src="${portrait(boss.char, 72)}" style="border-radius:10px;border:3px solid var(--ink)" alt="">
      <div><b style="font-family:var(--font-h);font-size:18px">Coach unlocked: ${boss.name}</b><br><i>${boss.quote || ''}</i><br>${boss.passive}</div></div>` : ''}
    ${progress.beaten.length === 5 && !progress.beaten.includes('cup') ? '<div class="panel">🏆 All five leagues conquered — the <b>Champions Cup</b> is open!</div>' : ''}
    <button class="btn big" id="home">Back to leagues</button></div>`;
  shell.confetti(240);
  stage.querySelector('#home').onclick = () => { sfx.click(); homeScreen(); };
}

function rewardScreen(headline) {
  shell.setScore(null);
  const L = leagueOf(run.league);
  const styles = L.id === 'cup' ? L.styles : [L.style];
  const own = rewardPool(styles[(Math.random() * styles.length) | 0]);
  const other = rewardPool(['possession', 'press', 'bus', 'power', 'flair'][(Math.random() * 5) | 0]);
  const pick3 = [];
  const pool = S.shuffle(own);
  while (pick3.length < 2 && pool.length) { const c = pool.pop(); if (!pick3.includes(c.id)) pick3.push(c.id); }
  const op = S.shuffle(other).find((c) => !pick3.includes(c.id));
  if (op) pick3.push(op.id);
  const boons = [['ctrl', 'Rondo drills', '+1 Control'], ['atk', 'Shooting drills', '+1 Attack'], ['def', 'Shape drills', '+1 Defence'], ['prs', 'Fitness camp', '+1 Press']];
  const boon3 = S.shuffle(boons).slice(0, 2);
  stage.innerHTML = `<div class="screen center">
    <div class="logo" style="font-size:32px">VICTORY</div><p>${headline}</p>
    <h2 class="sec">Sign a new tactic</h2>
    <div class="rewards">${pick3.map((id) => cardHTML(id)).join('')}</div>
    <h2 class="sec">…and a training camp</h2>
    <div class="boons">${boon3.map(([k, n, t]) => `<button class="btn paper boon" data-k="${k}">${n}<small style="font-family:var(--font);font-size:12px">&nbsp;${t}</small></button>`).join('')}</div>
    <p class="muted" style="font-size:12px">Pick one card and one camp. Your deck: ${run.deck.length} cards.</p>
    <button class="btn big" id="next" disabled>Next match ▶</button></div>`;
  let card = null, boon = null;
  const upd = () => { stage.querySelector('#next').disabled = !(card && boon); };
  stage.querySelectorAll('.rewards .gcard').forEach((el) => el.onclick = () => { sfx.card(); card = el.dataset.id; stage.querySelectorAll('.rewards .gcard').forEach((e) => e.classList.toggle('sel', e === el)); upd(); });
  stage.querySelectorAll('.boon').forEach((el) => el.onclick = () => { sfx.click(); boon = el.dataset.k; stage.querySelectorAll('.boon').forEach((e) => e.classList.toggle('pressed', e === el)); upd(); });
  stage.querySelector('#next').onclick = () => {
    run.deck.push(card);
    run.bonus[boon] = (run.bonus[boon] || 0) + 1;
    sfx.coin();
    ladderScreen();
  };
}

// ================================================================ keyboard
document.addEventListener('keydown', (e) => {
  if (!m || !stage.querySelector('#hand') || document.querySelector('.sheet-wrap') || stage.querySelector('.moment')) return;
  if (e.key >= '1' && e.key <= '9' && !e.altKey) playCard(+e.key - 1);
  if (e.key === 'Enter') { e.preventDefault(); kickOff(); }
  if (e.key === 'd') showDeck();
  if (e.key === 'z' || e.key === 'u') { if (m.you.played.length) undoCard(m.you.played.length - 1); }
});
