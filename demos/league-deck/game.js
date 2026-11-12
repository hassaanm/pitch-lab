// Touchline: a league-by-league deckbuilder. Your deck is your tactics;
// each 15-minute spell you play cards, then watch the match simulate.
// The match is drawn by the shared broadcast view (shared/matchview.js):
// every change of possession is a physical contact, and every log line,
// score change and banner is written on that contact frame (onHit).
import { Shell, oddsPill } from '../../shared/shell.js';
import { portrait } from '../../shared/art.js';
import { sfx } from '../../shared/sfx.js';
import { byId, LINEUP7, TEAMS, crestSVG } from '../../shared/cast.js';
import { MatchView, SHAPE7 } from '../../shared/matchview.js';
import { STYLES, COACHES, LEAGUES, CUP, DIVISIONS, CARDS, COACH_DECK, AI_DECK, opponentStats, clubSquad, rewardPool } from './data.js';
import * as S from './sim.js';

const shell = new Shell({
  id: 'league-deck',
  title: 'Touchline',
  pitch: 'You are the coach. Your deck is your tactics. Every 15 minutes you read the rival\'s plan, spend 3 Shouts on cards to tilt the duels, then watch the match play out, and you step in on the big chances.',
  how: [
    'Pick a coach and a league. Each league has 3 clubs, then its legendary coach.',
    'Each spell (15 minutes) you get 3 📣 Shouts and 5 cards. The rival coach shows their plan first.',
    'Three duels decide every attack: Keep the ball (Control vs Press), Break the line (Attack vs Defence) and Score (Finish vs Keeper). The bars show both sides\' odds.',
    'Tap a card to preview it: the bars show what it changes. Tap it again to play it. Tap a played card to take it back.',
    'Kick off to watch the spell. When a card swings a duel, the pitch names it (your cards in gold, theirs in red). On a big chance you choose what happens.',
    'Defending a big chance: rush out against a poor dribbler (Dribble 6 or less; small penalty risk). Guess a side against a sharp finisher (Finishing 8+): Wak reads sharp finishers more often. Otherwise stay big. The odds on each button show it.',
    'Win to draft a new card. Beat the legend to unlock that coach and their style.',
    'Keys: 1–7 select / play a card, Enter kicks off, D shows your deck, U takes back the last card.',
  ],
  notice: 'Does reading the rival\'s plan and choosing which duels to win feel like coaching? Do the pitch labels make it clear which of your cards paid off?',
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
let sel = -1;     // selected hand card
let curMin = 0;
let liveLines = [];
let ready = Promise.resolve();
let pitchW = 0;

// Dev hook under ?jank=1: read the live match from the console (tests set the score).
if (new URLSearchParams(location.search).has('jank')) window.__touchline = { get m() { return m; }, get run() { return run; } };

function killView() { if (view) { view.destroy(); view = null; } window.onresize = null; }

// ================================================================ phases
function startPhase(id) {
  busy = false;
  killView();
  if (id === 'early') { run = null; m = null; homeScreen(); return; }
  if (id === 'mid') {
    run = { coach: 'rookie', league: 'liga', round: 2, bonus: { ctrl: 1 },
      deck: ['shape', 'shape', 'passmove', 'passmove', 'forward', 'forward', 'press1', 'shootsight', 'breather', 'captain', 'rondo', 'thirdman', 'gegen', 'eagle'] };
    startMatch({ spell: 3, score: [1, 1], youSta: 64, oppSta: 60 });
    return;
  }
  if (id === 'clutch') {
    run = { coach: 'tiki', league: 'bunda', round: 3, bonus: { ctrl: 1, atk: 2, fin: 2 },
      deck: [...COACH_DECK.tiki, 'switchplay', 'eagle', 'setpiece', 'watersub', 'hairdryer', 'lateshow', 'nutmeg'] };
    startMatch({ spell: 5, score: [1, 2], youSta: 60, oppSta: 46 });
  }
}

// ================================================================ home
function homeScreen() {
  window.scrollTo(0, 0);
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
        <div class="boss center"><img src="${portrait(boss.char, 54)}" alt=""><div style="font-size:11px;font-weight:900">${locked ? '🔒' : boss.name}</div></div>
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
  window.scrollTo(0, 0);
  shell.setScore(null);
  const L = leagueOf(run.league);
  const coach = COACHES[run.coach];
  stage.innerHTML = `<div class="screen">
    <div class="row"><button class="btn small ghost" id="home">◀ Leagues</button><div class="grow"></div><span class="deckinfo" id="deck">Your deck: ${run.deck.length} cards</span></div>
    <div class="panel dark row"><img src="${portrait(coach.char, 48)}" width="48" height="48" style="border-radius:10px;border:3px solid var(--ink);flex:none" alt="">
      <div><b style="font-family:var(--font-h);font-size:18px">${L.flag} ${L.name}</b><br><span style="font-size:12px">Coach: ${coach.name} · ${STYLES[coach.style].icon} ${STYLES[coach.style].name}</span></div></div>
    <div class="ladder">${L.clubs.map((clubId, i) => {
      const o = opponentFor(i);
      const t = TEAMS[clubId];
      const boss = o.isBoss ? COACHES[o.coach] : null;
      return `<div class="rung panel ${i === run.round ? 'cur' : ''} ${i < run.round ? 'past' : ''}">
        <div class="num">${L.id === 'cup' ? ['Round of 16', 'Quarter-final', 'Semi-final', 'Final'][i] : DIVISIONS[i]}</div>
        <div class="kit" style="background:linear-gradient(90deg, ${t.shirt} 50%, ${t.trim} 50%)"></div>
        <div class="grow"><b style="font-family:var(--font-h);font-size:16px">${t.name}</b><br><span style="font-size:11px">${STYLES[o.style].icon} ${STYLES[o.style].name}${boss ? ` · Legend: <b>${boss.name}</b>` : ''}</span></div>
        ${boss ? `<img src="${portrait(boss.char, 44)}" width="44" height="44" style="border-radius:8px;border:2px solid var(--ink);flex:none" alt="">` : (i < run.round ? '✅' : '')}
      </div>`;
    }).join('')}</div>
    <button class="btn big block" id="play">Play ${TEAMS[L.clubs[run.round]].name} ▶</button>
  </div>`;
  stage.querySelector('#home').onclick = () => { sfx.click(); homeScreen(); };
  stage.querySelector('#deck').onclick = () => showDeck();
  stage.querySelector('#play').onclick = () => { sfx.whistle(); startMatch({}); };
}

// Full-size card (deck viewer, rewards).
function cardHTML(id, o = {}) {
  const c = CARDS[id];
  const st = STYLES[c.style];
  const who = c.who ? byId[c.who] : null;
  const art = who ? `<div class="art" style="background-image:url(${portrait(who, 104)})"></div>` : `<div class="art tac">${c.icon || '⚽'}</div>`;
  return `<div class="gcard ${c.type === 'player' ? 'player' : ''} ${o.cls || ''}" style="--cc:${st.color}" data-id="${id}" tabindex="0">
    <div class="cost">${c.cost}</div><div class="name" ${c.name.length > 13 ? 'style="font-size:11px"' : ''}>${c.name}</div>${art}
    <div class="type">${st.icon} ${st.name} · ${c.type}</div><div class="text">${c.text}</div></div>`;
}

// Compact hand card: cost, icon or portrait, name, a two-line effect summary.
const SHORT = { ctrl: 'Ctrl', atk: 'Atk', fin: 'Fin', def: 'Def', prs: 'Press', gk: 'GK' };
function fxSummary(c) {
  const out = [];
  const sgn = (v) => (v > 0 ? '+' : '−') + Math.abs(v);
  for (const k in c.fx || {}) out.push(`${sgn(c.fx[k])} ${SHORT[k]}`);
  for (const k in c.oppFx || {}) out.push(`Their ${SHORT[k]} ${sgn(c.oppFx[k])}`);
  if (c.ifTrailing) out.push('If losing: +Atk');
  if (c.ifCtrlLead) out.push('+2 Atk if more Ctrl');
  if (c.ifLeading) out.push('If leading +1 Def');
  if (c.lateFin) out.push(`+${c.lateFin} Fin after 75'`);
  if (c.pressXg) out.push('Steals → big chance');
  if (c.counter) out.push(`+${Math.round(c.counter * 100)}% counters`);
  if (c.counterAgainst) out.push('Halves their counters');
  if (c.bypass) out.push('Skip their defence');
  if (c.setPiece) out.push(`Corner: ${Math.round(c.setPiece * 100)}% goal`);
  if (c.arm) out.push(`1v1 +${Math.round(c.arm.xg * 100)}%`);
  if (c.variance) out.push(`${Math.round(c.variance * 100)}% lose it`);
  if (c.cancelBig) out.push('Stop a big chance');
  if (c.fewerPoss) out.push(`−${c.fewerPoss} possessions`);
  if (c.ignoreDef) out.push(`Ignore ${c.ignoreDef} Def`);
  if (c.header) out.push('Headers');
  if (c.onGoalShout) out.push('Goal: +1 Shout');
  if (c.drawPerSpell) out.push('+1 card each spell');
  if (c.sta) out.push(`${sgn(c.sta)} legs`);
  if (c.perm && !c.drawPerSpell) out.unshift('Rest of match:');
  return out.slice(0, c.perm ? 3 : 2).join('<br>');
}
function miniCard(id, i, cost, cant) {
  const c = CARDS[id];
  const st = STYLES[c.style];
  const who = c.who ? byId[c.who] : null;
  const ic = who ? `<div class="ic" style="background-image:url(${portrait(who, 64)})"></div>` : `<div class="ic">${c.icon || '⚽'}</div>`;
  return `<div class="mcard ${cant ? 'cant' : ''} ${i === sel ? 'sel' : ''}" style="--cc:${st.color}" data-idx="${i}" role="button" tabindex="0">
    <div class="cost" ${cost < c.cost ? 'style="background:#6fd36a"' : ''}>${cost}</div>${ic}
    <div class="nm ${(who ? c.name.replace(/^[^:]+:\s*/, '') : c.name).split(' ').some((w) => w.length > 8) ? 'long' : ''}">${who ? c.name.replace(/^[^:]+:\s*/, '') : c.name}</div><div class="fx">${fxSummary(c)}</div></div>`;
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
  m = { league: L, opp: null, you: null, spell: o.spell || 0, score: o.score ? [...o.score] : [0, 0], variant, oppInfo: opp };
  const youSquad = LINEUP7.sun.map((id) => byId[id]);
  m.you = { coach: run.coach, base, perm: {}, permOpp: {}, permHooks: { staPerSpell: 0, drawPerSpell: 0 }, sta: o.youSta ?? 100,
    draw: S.shuffle(run.deck), discard: [], hand: [], played: [], playLog: [], log: [], shouts: 3, squad: youSquad };
  m.opp = { coach: opp.coach, base: opponentStats(run.round, opp.style, opp.isBoss), perm: {}, permOpp: {}, permHooks: { staPerSpell: 0 }, sta: o.oppSta ?? 100,
    played: [], shouts: 3, squad: clubSquad(opp.clubId), deck: AI_DECK[opp.style], clubId: opp.clubId };
  shell.clearLog();
  matchScreen();
  const oc = opp.coach ? COACHES[opp.coach] : null;
  curMin = m.spell * 15;
  say(`${TEAMS[opp.clubId].name}${oc ? ` (coach ${oc.name})` : ''}: ${STYLES[opp.style].name} style.`, 'info');
  beginSpell(true);
  fitPitch();
  view.setTeams(squadList(currentSquad()), squadList(m.opp.squad));
  // kick-off: the first half is yours, the second half theirs
  ready = view.reset(m.spell >= 3 ? 'opp' : 'you');
}

const squadList = (sq) => sq.map((c, i) => ({ c, home: SHAPE7[i] }));

// The pitch gets one height per match, chosen so that the pitch, the ticker and the
// whole planning panel (with Kick off) fit one phone screen. It changes only when
// the width changes (phone URL bars change innerHeight while scrolling).
let pitchH = 300;
function pitchHeight(w) { return Math.round(Math.min(w * 1.15, pitchH)); }
function fitPitch() {
  const wrap = stage.querySelector('.pitchwrap'), panel = stage.querySelector('#mpanel'), ticker = stage.querySelector('#ticker');
  const top = document.querySelector('.topbar')?.offsetHeight || 56;
  const tabs = document.querySelector('.phasebar');
  const gapAbove = tabs ? Math.max(4, wrap.getBoundingClientRect().top - tabs.getBoundingClientRect().bottom) : 8;
  const used = top + gapAbove + 6 + ticker.offsetHeight + 16 + panel.offsetHeight + 10;
  pitchH = Math.round(Math.max(240, Math.min(420, innerHeight - used)));
  pitchW = wrap.clientWidth;
  view.resize(pitchW, pitchHeight(pitchW), m.variant);
  // start the match screen with the pitch right under the top bar (phase tabs hidden)
  const align = () => {
    const t = document.querySelector('.phasebar');
    const y = t ? t.getBoundingClientRect().bottom + scrollY - top : wrap.getBoundingClientRect().top + scrollY - top - gapAbove;
    window.scrollTo(0, Math.max(0, Math.round(y)));
    return scrollY;
  };
  const at = align();
  // web fonts can change the tab bar's height after this; re-align once if nobody scrolled
  document.fonts?.ready.then(() => { if (Math.abs(scrollY - at) < 2 && stage.contains(wrap)) align(); });
}

function matchScreen() {
  stage.innerHTML = `<div class="screen match">
    <div class="pitchwrap"><canvas id="pitch"></canvas><div class="spellbadge" id="spellbadge"></div></div>
    <div class="ticker" id="ticker">&nbsp;</div>
    <div class="mpanel panel dark" id="mpanel"></div>
  </div>`;
  killView();
  const cv = stage.querySelector('#pitch');
  view = new MatchView(cv);
  // The pitch keeps its size for the whole match; only a real width change resizes it
  // (phone URL bars change innerHeight while scrolling, which must not move anything).
  window.onresize = () => {
    const w = stage.querySelector('.pitchwrap')?.clientWidth;
    if (!view || !w || Math.abs(w - pitchW) < 2) return;
    pitchW = w;
    view.resize(w, pitchHeight(w), m.variant);
  };
  liveLines = [];
}

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

// ================================================================ commentary
function say(text, kind = '') {
  shell.log(text, kind, `${curMin}'`);
  const t = stage.querySelector('#ticker');
  if (t) { t.innerHTML = `<b>${curMin}'</b> ${text}`; t.className = 'ticker ' + kind; }
  liveLines.unshift({ text, kind, min: curMin });
  liveLines.length = Math.min(liveLines.length, 3);
  const c = stage.querySelector('#comm');
  if (c) c.innerHTML = commHTML();
}
const commHTML = () => liveLines.map((l) => `<li class="${l.kind}"><span class="t">${l.min}'</span><span>${l.text}</span></li>`).join('') || '<li class="info"><span class="t"></span>Kick-off.</li>';
const nm = (a) => a?.c?.name || '';
const teamName = (side) => (side === 'you' ? 'Sunbirds' : TEAMS[m.opp.clubId].name);

// Card credit: name a card only if its effect really applied to this beat, and
// pick the one that moved that duel most. Conditions are read as they stood at
// kick-off, because that is when the spell's stats were fixed. No card: the
// label names the duel (or stays quiet) and the log line gives the duel's odds.
function effOf(c, side) {
  const lead = m.kickLead?.[side] ?? 0;
  const e = {};
  const add = (fx) => { for (const k in fx || {}) e[k] = (e[k] || 0) + fx[k]; };
  add(c.fx);
  if (c.ifTrailing && lead < 0) add(c.ifTrailing);
  if (c.ifLeading && lead > 0) add(c.ifLeading);
  if (c.lateFin && m.spell * S.SPELL_MIN >= 75) e.fin = (e.fin || 0) + c.lateFin;
  if (c.ifCtrlLead && m.kickCtrlLead?.[side]) add(c.ifCtrlLead);
  return e;
}
const WEIGHT = {
  ball: (c, e) => e.ctrl || 0,
  keep: (c, e) => e.ctrl || 0,
  press: (c, e) => e.prs || 0,
  progress: (c, e) => (e.atk || 0) + (c.ignoreDef || 0) - (c.oppFx?.def || 0),
  block: (c, e) => e.def || 0,
  // big chances: 'shoot' uses Finish and the armed bonus, 'round' uses Attack, a square tap-in uses neither
  goal: (c, e, o) => o.moment === 'square' ? 0 : o.moment === 'round' ? (e.atk || 0)
    : (e.fin || 0) + (o.moment === 'shoot' && c.arm ? 4 : 0) + (o.header && c.header ? 2 : 0)
    + (o.kind === 'turnover' && c.pressXg ? 3 : 0) + (o.kind === 'counter' && c.counterXg ? 3 : 0),
  save: (c, e) => (e.gk || 0) - (c.oppFx?.fin || 0),
  miss: (c) => -(c.oppFx?.fin || 0),
  counter: (c) => (c.counter || 0) * 10 + (c.counterXg || 0) * 20,
  skill: (c) => c.bypass || 0,
  lost: (c) => c.variance || 0,
  foul: (c) => c.cancelBig || 0,
};
function credit(side, kind, o = {}) {
  if (o.setPiece) return CARDS[o.setPiece]; // a set-piece chance belongs to its card
  let best = null, bv = 0;
  for (const id of m[side].played) {
    const c = CARDS[id];
    const v = WEIGHT[kind](c, effOf(c, side), o);
    if (v > bv) { bv = v; best = c; }
  }
  return best;
}
// Labels read from the player's point of view: your cards in gold, theirs in red.
const TAIL = {
  ball: ['our ball', 'their ball'], keep: ['kept it', 'they keep it'], press: ['won it!', 'they win it'],
  progress: ['through!', "they're through"], block: ['blocked!', 'they block it'], save: ['saved!', 'they save it'],
  miss: ['wide!', 'wide'], counter: ['COUNTER!', 'they counter'], skill: ['skipped past!', 'they skip past'],
  lost: ['backfires', 'backfires'], foul: ['chance stopped', 'chance stopped'], corner: ['corner!', 'their corner'],
};
const cardTag = (c) => `${c.icon || '👤'} ${c.name}`;
// { label, color } for the canvas; `side` owns the card.
function lbl(card, side, kind, fallback) {
  if (!card) return { label: fallback, color: undefined };
  return { label: `${cardTag(card)} → ${TAIL[kind][side === 'you' ? 0 : 1]}`, color: side === 'you' ? '#FFD23F' : '#FF8A80' };
}
const why = (card) => (card ? ` <i class="why">${cardTag(card)}</i>` : '');
const good = (side) => (side === 'you' ? 'good' : 'bad');

// ================================================================ spells
function beginSpell(first = false) {
  const me = m.you;
  me.played = []; me.playLog = [];
  me.shouts = 3 + (run.coach === 'thunder' && m.spell >= 4 ? 1 : 0) + (me.bonusShout || 0);
  me.bonusShout = 0;
  S.drawCards(me, 5 + me.permHooks.drawPerSpell + (m.spell === 3 && !first ? 1 : 0));
  m.opp.shouts = 2 + (m.oppInfo.isBoss ? 1 : 0) + (m.oppInfo.isBoss && m.spell >= 4 ? 1 : 0);
  m.opp.played = S.aiPlan(m, m.opp.deck);
  // a player card lasts one spell: whoever came on jogs off and the regular comes back
  me.onPitch = currentSquad();
  if (!first) view.syncTeam('you', squadList(me.onPitch));
  if (m.spell === 3 && !first) say('Half-time team talk: draw 1 extra card.', 'info');
  sel = -1;
  planPanel();
}

function setPanel(html, cls) {
  const p = stage.querySelector('#mpanel');
  // hold the page height while the content swaps, so nothing below jumps
  p.style.minHeight = p.offsetHeight ? p.offsetHeight + 'px' : '';
  p.className = 'mpanel panel dark ' + (cls || '');
  p.innerHTML = html;
  return p;
}

function duelsHTML() {
  const row = (k, name, sub) => `<div class="drow" data-row="${k}"><div class="dname">${name}<small>${sub}</small></div>
    <div class="dcell" data-side="you"><div class="dbar"><i></i><b></b></div></div>
    <div class="dcell" data-side="opp"><div class="dbar opp"><i></i><b></b></div></div></div>`;
  return `<div class="duels"><div class="dhead"><span class="dname" id="dsub"></span><span>You attack <em id="pY"></em></span><span>They attack <em id="pO"></em></span></div>
    ${row('keep', 'Keep the ball', 'Ctrl v Press')}${row('break', 'Break the line', 'Atk v Def')}${row('score', 'Score a chance', 'Fin v GK')}</div>`;
}
function duelNumbers(P) {
  const Y = P.Y, O = P.O;
  return {
    you: { keep: [1 - P.pressO, Y.ctrl, O.prs], break: [P.progY, Y.atk, O.def], score: [S.goalP(S.chanceXg(Y), O), Y.fin, O.gk] },
    opp: { keep: [1 - P.pressY, O.ctrl, Y.prs], break: [P.progO, O.atk, Y.def], score: [S.goalP(S.chanceXg(O), Y), O.fin, Y.gk] },
  };
}
// Update bars in place so widths animate. `prev` marks what a previewed card changes.
function updateDuels(P, prev) {
  const N = duelNumbers(P), B = prev ? duelNumbers(prev) : null;
  // the header carries the spell's bottom line: each side's chance to score this spell
  const set = (id, h) => { const e = stage.querySelector('#' + id); if (e) e.innerHTML = h; };
  set('dsub', `Score this spell<small>${P.n} attacks each</small>`);
  set('pY', oddsPill(P.pY));
  set('pO', oddsPill(P.pO));
  for (const side of ['you', 'opp']) for (const k of ['keep', 'break', 'score']) {
    const cell = stage.querySelector(`.drow[data-row="${k}"] .dcell[data-side="${side}"]`);
    if (!cell) continue;
    const [p, a, d] = N[side][k];
    cell.querySelector('i').style.width = `${Math.round(p * 100)}%`;
    const delta = B ? Math.round(p * 100) - Math.round(B[side][k][0] * 100) : 0;
    cell.querySelector('b').innerHTML = `${Math.round(p * 100)}%${delta ? `<em class="${(delta > 0) === (side === 'you') ? 'up' : 'down'}">${delta > 0 ? '+' : ''}${delta}</em>` : ''}`;
    cell.title = `${fmt(a)} v ${fmt(d)}`;
    cell.classList.toggle('changed', !!delta);
  }
}
const fmt = (v) => (Math.round(v * 10) / 10).toString();

function planPanel() {
  const oc = m.oppInfo.coach ? COACHES[m.oppInfo.coach] : null;
  const T = TEAMS[m.opp.clubId];
  setPanel(`
    <div class="rival">${oc ? `<img src="${portrait(oc.char, 30)}" width="30" height="30" alt="">` : `<div class="crest">${crestSVG('red', 24).replace(/#E8463A/g, T.shirt)}</div>`}
      <span class="lbl">${oc ? oc.name.split(' ').pop() : 'They'} plan:</span>
      <div class="chips">${m.opp.played.length ? m.opp.played.map((id) => { const c = CARDS[id]; return `<span class="ichip" data-tip="${c.name}: ${c.text}"><i style="background:${STYLES[c.style].color}">${c.icon || '👤'}</i>${c.name}</span>`; }).join('') : '<span class="ichip">Nothing special</span>'}</div></div>
    ${duelsHTML()}
    <div class="played" id="played"></div>
    <div class="infoline" id="infoline"></div>
    <div class="hand" id="hand"></div>
    <div class="planbar"><div><div class="shouts" id="shouts"></div><div class="deckinfo" id="deckinfo"></div></div>
      <button class="btn" id="kick">Kick off ▶</button></div>`, 'plan');
  const p = stage.querySelector('#mpanel');
  p.querySelector('#kick').onclick = () => kickOff();
  p.querySelector('#deckinfo').onclick = () => showDeck();
  p.querySelectorAll('.ichip').forEach((el) => el.onclick = () => { sfx.click(); info(el.dataset.tip); });
  renderPlan();
  requestAnimationFrame(() => { if (p.isConnected) p.style.minHeight = ''; });
}

function info(html) { const el = stage.querySelector('#infoline'); if (el) el.innerHTML = `<div class="it">${html}</div>`; }

function previewProjection(id) {
  const me = m.you, c = CARDS[id];
  const perm = { ...me.perm };
  if (c.perm) for (const k in c.fx || {}) perm[k] = (perm[k] || 0) + c.fx[k];
  const permOpp = { ...me.permOpp };
  if (c.perm) for (const k in c.oppFx || {}) permOpp[k] = (permOpp[k] || 0) + c.oppFx[k];
  return S.projection({ ...m, you: { ...me, played: [...me.played, id], perm, permOpp, sta: Math.max(0, Math.min(100, me.sta + (c.sta || 0))) } });
}

function renderPlan() {
  if (!m) return;
  const me = m.you;
  shell.setScore({ home: m.score[0], away: m.score[1], clock: `${m.spell * 15}'`, awayTeam: 'red' });
  stage.querySelector('#spellbadge').textContent = m.spell >= S.SPELLS ? `ET ${m.spell * 15}'–${m.spell * 15 + 15}'` : `${m.spell + 1}/6 · ${m.spell * 15}'–${m.spell * 15 + 15}'`;
  if (!stage.querySelector('#hand')) return;
  const P = S.projection(m);
  const selId = sel >= 0 ? me.hand[sel] : null;
  const PP = selId ? previewProjection(selId) : null;
  updateDuels(PP || P, PP ? P : null);
  const Q = PP || P;
  const legs = Math.round(PP ? Math.max(0, Math.min(100, me.sta + (CARDS[selId].sta || 0))) : me.sta);
  if (selId) {
    const c = CARDS[selId];
    const cost = S.cardCost(m, selId);
    info(`<b>${c.name}</b> · ${c.text} <span class="tapagain">${cost > me.shouts ? `Needs ${cost} 📣` : 'Tap again to play'}</span>`);
  } else {
    info(me.played.length ? `Tap a played card to take it back, or a card below to preview it.` : `Read their plan, then pick the duels to win. <span class="muted">Tap a card to preview it.</span>`);
  }
  // played cards: their own row, always visible (scrolls sideways, never wraps)
  const pl = stage.querySelector('#played');
  pl.innerHTML = me.played.map((id, i) => `<span class="pchip" data-pi="${i}" title="Tap to take back">${CARDS[id].icon || '👤'} ${CARDS[id].name}<i>↩</i></span>`).join('') || '<span class="muted">Played cards show here.</span>';
  pl.querySelectorAll('.pchip').forEach((el) => el.onclick = () => undoCard(+el.dataset.pi));
  // hand
  const hand = stage.querySelector('#hand');
  hand.classList.toggle('many', me.hand.length > 5);
  hand.innerHTML = me.hand.map((id, i) => { const cost = S.cardCost(m, id); return miniCard(id, i, cost, cost > me.shouts); }).join('') || '<span class="muted">No cards left in hand.</span>';
  hand.querySelectorAll('.mcard').forEach((el) => {
    el.onclick = () => tapCard(+el.dataset.idx);
  });
  const total = 3 + (run.coach === 'thunder' && m.spell >= 4 ? 1 : 0);
  const spent = me.playLog.reduce((a, x) => a + x.cost, 0);
  stage.querySelector('#shouts').innerHTML = `📣 ${Array.from({ length: Math.max(total, me.shouts + spent) }, (_, i) => `<span class="gem ${i < me.shouts ? '' : 'off'}"></span>`).join('')}`;
  stage.querySelector('#deckinfo').innerHTML = `Legs ${legs} v ${Math.round(m.opp.sta)}${Q.Y.h.fatigue > 0.2 ? ' <b class="tired">tired</b>' : ''} · Deck ${me.draw.length}/${run.deck.length}`;
  stage.querySelector('#kick').textContent = m.spell >= S.SPELLS ? 'Extra time ▶' : `Kick off ${m.spell * 15}' ▶`;
}

function tapCard(i) {
  if (busy || !m.you.hand[i]) return;
  if (sel === i) { playCard(i); return; }
  sfx.deal();
  sel = i;
  renderPlan();
}

function playCard(i) {
  if (busy) return;
  const me = m.you;
  const id = me.hand[i];
  if (!id) return;
  const cost = S.cardCost(m, id);
  if (cost > me.shouts) { sfx.bad(); shell.toast(`Not enough 📣 Shouts (${cost} needed)`); return; }
  const c = CARDS[id];
  const from = stage.querySelector(`.mcard[data-idx="${i}"]`)?.getBoundingClientRect();
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
  sel = -1;
  me.onPitch = currentSquad();
  if (c.who) { view.syncTeam('you', squadList(me.onPitch)); view.highlight = c.who; setTimeout(() => { if (view && view.highlight === c.who) view.highlight = null; }, 1800); }
  renderPlan();
  flyCard(id, from);
}

// The played card flies from the hand to its chip in the played row.
function flyCard(id, from) {
  const chip = stage.querySelector('#played .pchip:last-child');
  if (!from || !chip) return;
  const to = chip.getBoundingClientRect();
  chip.style.visibility = 'hidden';
  const c = CARDS[id];
  const el = document.createElement('div');
  el.className = 'flycard';
  el.style.cssText = `left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px;--cc:${STYLES[c.style].color}`;
  el.innerHTML = `<span>${c.icon || '👤'}</span>`;
  document.body.appendChild(el);
  const dx = to.left + to.width / 2 - (from.left + from.width / 2), dy = to.top + to.height / 2 - (from.top + from.height / 2);
  el.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px,${dy}px) scale(.35)`, opacity: 0.6 }], { duration: 280, easing: 'cubic-bezier(.3,.7,.4,1)' })
    .finished.then(() => { el.remove(); chip.style.visibility = ''; });
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
  sel = -1;
  me.onPitch = currentSquad();
  if (c.who) view.syncTeam('you', squadList(me.onPitch));
  renderPlan();
}

// ================================================================ live play
function livePanel() {
  setPanel(`${duelsHTML()}
    <ol class="comm" id="comm">${commHTML()}</ol>
    <div class="liverow"><span class="muted" id="livestate">Watching the spell…</span>
      <div class="speed"><button class="btn small paper" data-sp="1">×1</button><button class="btn small paper" data-sp="2">×2</button><button class="btn small paper" data-sp="5">⏭</button></div></div>`, 'live');
  stage.querySelectorAll('[data-sp]').forEach((b) => b.onclick = () => { view.speed = +b.dataset.sp; sfx.click(); markSpeed(); });
  markSpeed();
}
function markSpeed() { stage.querySelectorAll('[data-sp]').forEach((b) => b.classList.toggle('pressed', +b.dataset.sp === view?.speed)); }
function focusDuel(side, row) {
  stage.querySelectorAll('.dcell').forEach((c) => c.classList.remove('focus'));
  if (side) stage.querySelector(`.drow[data-row="${row}"] .dcell[data-side="${side}"]`)?.classList.add('focus');
}

async function kickOff() {
  if (busy || !m) return;
  busy = true;
  sel = -1;
  const myView = view;
  const alive = () => view === myView && m;
  sfx.whistle();
  const me = m.you, op = m.opp;
  m.you.onPitch = currentSquad();
  const Y = S.spellStats(m, 'you'), O = S.spellStats(m, 'opp');
  // the spell's stats are fixed now, so card credit reads its conditions as of now
  m.kickLead = { you: m.score[0] - m.score[1], opp: m.score[1] - m.score[0] };
  m.kickCtrlLead = { you: Y.ctrl > O.ctrl, opp: O.ctrl > Y.ctrl };
  livePanel();
  updateDuels(S.projection(m));
  const wrap = stage.querySelector('.pitchwrap');
  const top = wrap.getBoundingClientRect().top;
  if (top < 50 || top > innerHeight * 0.25) window.scrollTo({ top: Math.max(0, top + scrollY - 62), behavior: 'smooth' });
  await ready;
  await view.settled();
  if (!alive()) return;
  const share = S.possShare(Y, O);
  const n = S.numPoss(Y, O);
  const startMin = m.spell * 15;
  curMin = startMin;
  say(`You: ${me.played.map((id) => CARDS[id].name).join(', ') || 'no changes'}. They: ${op.played.map((id) => CARDS[id].name).join(', ') || 'no changes'}.`, 'info');
  for (const c of op.played.map((id) => CARDS[id])) op.sta = clamp100(op.sta + (c.sta || 0));
  const ctx = { scored: false };

  // set pieces first
  for (const [side, St, Def] of [['you', Y, O], ['opp', O, Y]]) {
    for (const sp of St.h.setPiece) {
      curMin = startMin + 2;
      shell.setScore({ home: m.score[0], away: m.score[1], clock: `${curMin}'`, awayTeam: 'red' });
      const card = CARDS[sp.card];
      const p = S.goalP(sp.p, Def);
      const squad = S.onPitch(m, side);
      const shooterC = sp.who && squad.some((q) => q.id === sp.who) ? byId[sp.who] : S.pickShooter(squad);
      focusDuel(side, 'score');
      await view.corner(side, null, { ...lbl(card, side, 'corner', 'CORNER'), onHit: (i) => say(`${nm(i.by)} turns it behind. Corner to ${teamName(side)}${why(card)}.`, side === 'you' ? '' : 'them') });
      if (!alive()) return;
      const actor = await view.setShooter(shooterC, side, { header: true });
      if (!alive()) return;
      await playShot(actor, side, S.rollShot(p), p, { header: true, setPiece: sp.card, ctx });
      if (!alive()) return;
    }
  }

  for (let i = 0; i < n; i++) {
    curMin = Math.round(startMin + ((i + 1) * 15) / (n + 1));
    shell.setScore({ home: m.score[0], away: m.score[1], clock: `${curMin}'`, awayTeam: 'red' });
    const owner = Math.random() < share ? 'you' : 'opp';
    const beats = S.genPossession(m, owner, Y, O);
    for (let bi = 0; bi < beats.length; bi++) {
      const b = beats[bi];
      // the player who breaks through is the one who then has the chance
      const next = beats.slice(bi + 1).find((x) => (x.k === 'shot' || x.k === 'moment') && x.side === b.side);
      b.runner = next ? next.shooter : null;
      await animateBeat(b, owner, Y, O, ctx);
      if (!alive()) return;
    }
  }
  focusDuel(null);

  // end of spell bookkeeping: the play pauses where it is
  view.speed = 1; markSpeed();
  me.sta = clamp100(me.sta - 8 + me.permHooks.staPerSpell);
  op.sta = clamp100(op.sta - 8);
  if (ctx.scored && Y.h.onGoalShout) { me.bonusShout = Y.h.onGoalShout; say('Rabona! The crowd gives you +1 Shout next spell.', 'good'); }
  me.discard.push(...me.played.filter((id) => !CARDS[id].perm), ...me.hand);
  me.hand = [];
  m.spell++;
  curMin = m.spell * 15;
  if (m.spell === 3) {
    sfx.whistle(2);
    shell.banner('HALF-TIME', `${m.score[0]} – ${m.score[1]}`);
    say(`Half-time: ${m.score[0]}–${m.score[1]}.`, 'info');
    ready = view.reset('opp');
  }
  if (m.spell >= S.SPELLS) {
    if (m.score[0] === m.score[1] && m.spell === S.SPELLS) {
      sfx.whistle(2);
      shell.banner('EXTRA TIME', 'One more spell');
      say('Level after 90. One spell of extra time, then penalties.', 'info');
      ready = view.reset('you');
      busy = false;
      beginSpell();
      return;
    }
    busy = false;
    return fullTime();
  }
  busy = false;
  beginSpell();
}
const clamp100 = (v) => Math.max(0, Math.min(100, v));

async function animateBeat(b, owner, Y, O, ctx) {
  const side = b.side;
  const opp = side === 'you' ? 'opp' : 'you';
  const kindOf = side === 'you' ? '' : 'them';
  switch (b.k) {
    case 'build': {
      focusDuel(side, 'keep');
      const card = credit(side, 'ball');
      const L = lbl(card, side, 'ball', null);
      return view.build(side, { ...L, onHit: (i) => {
        const t = { longball: `${nm(i.from)}'s long ball is won by ${nm(i.by)}`, intercept: `${nm(i.by)} cuts out ${nm(i.from)}'s pass`,
          rollout: `${nm(i.from)} rolls it out to ${nm(i.by)}`, collect: `${nm(i.by)} picks up the loose ball`, kickoff: `${nm(i.from)} kicks off to ${nm(i.by)}` }[i.kind];
        if (t) say(t + (card && i.kind !== 'kickoff' && i.kind !== 'rollout' ? why(card) : '') + '.', kindOf);
      } });
    }
    case 'pass': {
      const card = credit(side, 'keep');
      if (!card) return;
      focusDuel(side, 'keep');
      return view.keep(side, { ...lbl(card, side, 'keep', null), onHit: (i) => say(`${nm(i.from)} plays through the press to ${nm(i.by)}${why(card)}.`, kindOf) });
    }
    case 'press': {
      focusDuel(opp, 'keep');
      const card = credit(side, 'press');
      return view.press(side, { ...lbl(card, side, 'press', side === 'you' ? 'WON IT!' : 'THEY WIN IT'), onHit: (i) => say(`${nm(i.by)} wins it off ${nm(i.from)} high up (press ${Math.round(b.p * 100)}%)${why(card)}.`, good(side)) });
    }
    case 'skill': {
      focusDuel(side, 'break');
      const card = credit(side, 'skill');
      return view.skill(side, { ...lbl(card, side, 'skill', '✨ SKILL!'), onHit: (i) => say(`${nm(i.by)} skips past ${nm(i.from)}${why(card)}.`, side === 'you' ? 'good' : 'them') });
    }
    case 'lost': {
      focusDuel(side, 'break');
      const card = credit(side, 'lost');
      return view.tackle(view.presser(opp), { tag: 'lost', label: card ? `${cardTag(card)} backfires` : 'LOST IT', color: '#FF8A80',
        onHit: (i) => say(`${nm(i.from)} tries one trick too many; ${nm(i.by)} takes it${why(card)}.`, side === 'you' ? 'bad' : 'good') });
    }
    case 'progress': {
      focusDuel(side, 'break');
      const card = credit(side, 'progress');
      return view.progress(side, { runner: b.runner, ...lbl(card, side, 'progress', null), onHit: (i) => say(`${i.by === i.from ? `${nm(i.by)} drives` : `${nm(i.from)} finds ${nm(i.by)}`} into the final third (${Math.round((side === 'you' ? S.progressP(Y, O) : S.progressP(O, Y)) * 100)}%)${why(card)}.`, kindOf) });
    }
    case 'blocked': {
      focusDuel(opp, 'break');
      const card = credit(side, 'block');
      return view.blocked(side, { ...lbl(card, side, 'block', 'BLOCKED!'), onHit: (i) => say(`${nm(i.by)} ${i.kind === 'intercept' ? `cuts out ${nm(i.from)}'s pass` : `tackles ${nm(i.from)}`}${why(card)}.`, good(side)) });
    }
    case 'counter': {
      focusDuel(side, 'score');
      const card = credit(side, 'counter');
      return view.counter(side, { runner: b.runner, ...lbl(card, side, 'counter', 'COUNTER!'), onHit: (i) => {
        const runner = i.to && i.to !== i.by ? ` sends ${nm(i.to)} away` : ' breaks forward';
        say(`Counter! ${nm(i.by)}${runner} (${Math.round(b.p * 100)}% to break)${why(card)}.`, good(side));
      } });
    }
    case 'foul': {
      const card = credit(side, 'foul');
      return view.foul(side, { label: card ? `🟨 ${card.name}` : '🟨 FOUL', onHit: (i) => say(`${nm(i.by)} hauls down ${nm(i.from)}: big chance stopped, booking${why(card)}.`, 'info') });
    }
    case 'chance': return;
    case 'shot': {
      focusDuel(side, 'score');
      const actor = await view.setShooter(b.shooter, side, { header: b.kind === 'header' });
      if (!view) return;
      return playShot(actor, side, b.result, b.p, { header: b.kind === 'header', kind: b.kind, ctx });
    }
    case 'moment': {
      focusDuel(side, 'score');
      return keyMomentBeat(b, Y, O, ctx);
    }
  }
}

// One shot with its contact-frame commentary. `p` is the chance the player saw.
function playShot(actor, side, result, p, o = {}) {
  const pct = Math.round(p * 100);
  const def = side === 'you' ? 'opp' : 'you';
  const fin = credit(side, 'goal', { setPiece: o.setPiece, moment: o.moment, header: o.header, kind: o.kind });
  const stop = credit(def, result === 'miss' ? 'miss' : 'save');
  let L;
  if (result === 'goal') L = fin ? { label: side === 'you' ? `GOAL! ${cardTag(fin)}` : `${cardTag(fin)} → they score`, color: side === 'you' ? '#FFD23F' : '#FF8A80' } : { label: null };
  else if (result === 'save') L = lbl(stop, def, 'save', 'SAVED!');
  else L = stop ? lbl(stop, def, 'miss', undefined) : { label: undefined };
  if (o.label !== undefined) L = { ...L, label: o.label };
  return view.shot(actor, side, result, { header: o.header, dive: o.dive, ...L, onHit: (i) => {
    const how = o.kind === 'counter' ? ' on the break' : o.kind === 'turnover' ? ' after the steal' : o.kind === 'freekick' ? ' from the free kick' : o.kind === 'penalty' ? ' from the spot' : o.header ? ' with a header' : '';
    const note = o.note ? ` ${o.note}.` : '';
    const odds = o.odds || `${pct}% chance`; // the figure the player was shown
    if (i.result === 'goal') { goal(side, actor.c, fin); if (side === 'you' && o.ctx) o.ctx.scored = true; say(`GOAL! ${nm(actor)} scores${how} (${odds})${why(fin)}. ${m.score[0]}–${m.score[1]}.${note}`, 'goal'); }
    else if (i.kind === 'save') say(`${nm(i.by)} saves from ${nm(actor)}${how} (${odds})${why(stop)}.${note}`, side === 'you' ? 'bad' : 'good');
    else say(`${nm(actor)}${how ? ' shoots' + how + ' and' : ''} hits ${i.kind === 'post' ? 'the post' : 'it wide'} (${odds})${why(stop)}.`, side === 'you' ? 'bad' : 'good');
  } });
}

function goal(side, scorer, card) {
  if (side === 'you') m.score[0]++; else m.score[1]++;
  shell.setScore({ home: m.score[0], away: m.score[1], clock: `${curMin}'`, awayTeam: 'red' });
  if (side === 'you') { shell.banner('GOAL!', `${scorer.name} ${curMin}'${card ? ' · ' + card.name : ''}`); shell.confetti(); }
  else shell.banner('GOAL', `${scorer.name} · ${teamName('opp')}`, '#ff8a80');
  // keep the banner over the other half of the pitch, so the ball going in stays visible
  const bn = [...document.querySelectorAll('.banner')].pop(), r = stage.querySelector('.pitchwrap')?.getBoundingClientRect();
  if (bn && r) bn.style.top = `${Math.round(r.top + r.height * (side === 'you' ? 0.66 : 0.3))}px`;
  shell.shake(stage.querySelector('.pitchwrap'));
}

async function keyMomentBeat(b, Y, O, ctx) {
  const side = b.side;
  const actor = await view.setShooter(b.shooter, side);
  if (!view) return;
  await view.holdGap(actor); // never drawn on top of the keeper while you choose
  if (!view) return;
  // ...and both hold still while the choice is shown (the keeper would drift off his line)
  const holdStill = view.lock(actor, view.keeper(side === 'you' ? 'opp' : 'you'));
  const opts = S.momentOptions(m, b, Y, O);
  if (window.__touchline) (window.__touchline.moments ||= []).push({ side, shooter: b.shooter.name, fin: b.shooter.stats.shoot, dri: b.shooter.stats.dribble, xg: +b.xg.toFixed(3), opts: opts.map((o) => `${o.id} ${Math.round(o.p * 100)}`) });
  // make the options visible on the pitch: the square option's teammate makes a run
  let mateActor = null;
  let sceneReady = Promise.resolve();
  if (side === 'you') {
    const sq = opts.find((o) => o.id === 'square');
    mateActor = (sq && view.find(sq.mate, 'you')) || view.pick('you', 'FW', { exclude: [actor, ...view.team('you').filter((a) => a.c.pos === 'GK')] });
    if (sq && mateActor) { sq.label = `Square to ${mateActor.c.name}`; sq.mate = mateActor.c; }
    if (mateActor && mateActor !== actor) {
      const [u] = view.sv('you', actor.x, actor.y);
      const T = view.P('you', u < 0.5 ? Math.min(0.85, u + 0.3) : Math.max(0.15, u - 0.3), 0.22);
      sceneReady = view.runTo(mateActor, T[0], T[1], { dur: 0.7 });
    }
  }
  const choice = await keyMoment(b, opts, sceneReady);
  holdStill();
  if (!view) return;
  livePanel();
  updateDuels(S.projection(m));
  focusDuel(side, 'score');
  const res = S.resolveMoment(m, b, choice, Y, O);
  const pct = choice.p;
  say(side === 'you' ? `You go for: ${choice.label} (${Math.round(pct * 100)}% goal).` : `${choice.label} (${Math.round(pct * 100)}% save).`, 'info');
  if (side === 'you') {
    if (res.result === 'cut') {
      const mid = [(actor.x + mateActor.x) / 2, (actor.y + mateActor.y) / 2];
      const def = view.pick('opp', null, { near: mid, exclude: view.team('opp').filter((a) => a.c.pos === 'GK') });
      return view.intercept(def, actor, mateActor, { onHit: (i) => say(`${nm(i.by)} cuts out the square ball to ${nm(i.to)}.`, 'bad') });
    }
    if (choice.id === 'square') return playShot(mateActor, 'you', res.result, pct, { ctx, moment: 'square' });
    if (choice.id === 'round') {
      return view.roundKeeper(actor, 'you', res.result, { onHit: (i) => {
        if (i.result === 'goal') { const rc = credit('you', 'goal', { moment: 'round' }); goal('you', actor.c, rc); ctx.scored = true; say(`GOAL! ${nm(actor)} rounds the keeper (${Math.round(pct * 100)}%)${why(rc)}. ${m.score[0]}–${m.score[1]}.`, 'goal'); }
        else if (i.kind === 'save') say(`${nm(i.by)} smothers it at ${nm(actor)}'s feet.`, 'bad');
        else say(`${nm(actor)} rounds the keeper but the angle beats him.`, 'bad');
      } });
    }
    return playShot(actor, 'you', res.result, pct, { ctx, moment: 'shoot' });
  }
  // defending: Wak's choice
  if (choice.id === 'rush') {
    await view.rushOut('opp');
    if (res.penalty) {
      const taker = await view.penalty('opp', b.shooter, { onHit: (i) => say(`Wak brings down ${nm(i.from)}. Penalty!`, 'bad') });
      return playShot(taker, 'opp', res.result, S.PEN_GOAL, { kind: 'penalty', ctx, odds: `penalty, ${Math.round((1 - S.PEN_GOAL) * 100)}% save` });
    }
  }
  // The dive comes from the result: a wrong guess commits the wrong way; otherwise a
  // beaten Wak goes the right way and ends short.
  let dive, label, note;
  if (res.guess) {
    dive = res.guess === 'wrong' ? 'wrong' : 'short';
    note = res.guess === 'right' ? 'Wak guessed right' : 'Wak went the wrong way';
    label = res.result === 'save' ? (res.guess === 'right' ? 'GUESSED RIGHT!' : 'WRONG WAY… LEG SAVE!') : (res.guess === 'right' ? 'RIGHT WAY, BEATEN' : 'WRONG WAY!');
    if (res.guess === 'wrong' && res.result === 'save') note = 'Wak went the wrong way but his trailing leg kept it out';
  } else if (res.result === 'goal') dive = 'short';
  return playShot(actor, 'opp', res.result, 1 - pct, { ctx, dive, label, note, moment: 'shoot', odds: `${Math.round(pct * 100)}% save` });
}

function keyMoment(b, opts, ready = Promise.resolve()) {
  return new Promise((resolve) => {
    const youAtk = b.side === 'you';
    const p = setPanel(`<div class="moment ${youAtk ? '' : 'def'}">
      <div class="row"><span class="pframe"><img src="${portrait(youAtk ? b.shooter : byId.wak, 44)}" width="44" height="44" alt=""></span>
      <div><h3>${youAtk ? 'BIG CHANCE!' : 'DANGER!'}</h3><div class="msub">${youAtk ? `${b.shooter.name} is clean through.` : `${b.shooter.name} is through on Wak.`} What now?</div></div></div>
      ${opts.map((o, i) => `<button class="btn ${youAtk ? '' : 'paper'} opt" data-i="${i}"><span>${o.label}<small>${o.detail}</small></span>${oddsPill(o.p, youAtk ? 'goal' : 'save')}</button>`).join('')}
    </div>`, 'mom');
    sfx.cutin();
    view.speed = Math.min(view.speed, 2); markSpeed();
    let answered = false;
    // a tap is taken at once (press state, sound) but plays out only when the scene is
    // ready, e.g. after the teammate's run into the box has finished
    const done = (i) => {
      document.removeEventListener('keydown', onKey);
      if (!p.isConnected || answered) return;
      answered = true; sfx.click();
      p.querySelectorAll('.opt').forEach((x, j) => { x.disabled = true; x.classList.toggle('pressed', j === i); });
      ready.then(() => { if (p.isConnected) resolve(opts[i]); });
    };
    const onKey = (e) => { const k = +e.key; if (k >= 1 && k <= opts.length) done(k - 1); };
    document.addEventListener('keydown', onKey);
    p.querySelectorAll('.opt').forEach((btn) => btn.onclick = () => { p.querySelectorAll('.opt').forEach((x) => { x.disabled = true; }); done(+btn.dataset.i); });
    // only scroll if an option is off screen; keep the shooter and the goal in view
    const last = [...p.querySelectorAll('.opt')].pop().getBoundingClientRect();
    if (last.bottom > innerHeight) window.scrollBy({ top: last.bottom - innerHeight + 8, behavior: 'smooth' });
  });
}

// ================================================================ full time
async function fullTime() {
  let [a, b] = m.score;
  let pens = '';
  if (a === b) {
    let pa = 0, pb = 0;
    for (let i = 0; i < 5 || pa === pb; i++) { if (Math.random() < 0.75) pa++; if (Math.random() < 0.75) pb++; if (i > 12) break; }
    pens = ` (pens ${pa}–${pb})`;
    shell.log(`Penalties: ${pa}–${pb}`, 'info', "120'");
    a += pa > pb ? 0.1 : 0; b += pb > pa ? 0.1 : 0;
  }
  const won = a > b;
  const myM = m;
  sfx.whistle(3);
  shell.setScore({ home: m.score[0], away: m.score[1], clock: 'FT', awayTeam: 'red' });
  setPanel(`<div class="ftpanel"><h3>FULL TIME</h3><p>${m.score[0]}–${m.score[1]}${pens}</p></div>`, 'ft');
  await shell.wait(600);
  if (m !== myM) return;
  const opp = m.oppInfo;
  const L = m.league;
  if (won) {
    sfx.win(); shell.confetti(200);
    if (opp.isBoss) { killView(); return leagueWon(pens); }
    shell.banner('FULL TIME', `You win ${m.score[0]}–${m.score[1]}${pens}`);
    await shell.wait(1400);
    if (m !== myM) return;
    run.round++;
    killView();
    rewardScreen(`Beat ${TEAMS[opp.clubId].name} ${m.score[0]}–${m.score[1]}${pens}`);
  } else {
    sfx.lose();
    shell.banner('FULL TIME', `Lost ${m.score[0]}–${m.score[1]}${pens}`, '#ff8a80');
    await shell.wait(1200);
    if (m !== myM) return;
    const choice = await shell.modal({ title: 'Knocked out', dismiss: false,
      html: `<p>${TEAMS[opp.clubId].name} beat you ${m.score[0]}–${m.score[1]}${pens} in ${L.name}.</p><p class="muted">Prototype: you can replay the match with the same deck instead of starting over.</p>`,
      buttons: [{ label: 'Replay match', value: 'replay' }, { label: 'New run', cls: 'paper', value: 'home' }] });
    if (m !== myM) return;
    if (choice === 'replay') startMatch({}); else { killView(); homeScreen(); }
  }
}

async function leagueWon(pens) {
  window.scrollTo(0, 0);
  const L = m.league;
  const boss = COACHES[L.boss];
  const newCoach = !progress.coaches.includes(boss.id) && boss.id !== 'cupboss';
  if (newCoach) progress.coaches.push(boss.id);
  if (!progress.beaten.includes(L.id)) progress.beaten.push(L.id);
  save();
  shell.setScore(null);
  stage.innerHTML = `<div class="screen center">
    <div class="trophy">🏆</div>
    <div class="logo" style="font-size:32px">${L.name} CHAMPIONS</div>
    <p>You beat ${boss.name}'s ${TEAMS[m.opp.clubId].name} ${m.score[0]}–${m.score[1]}${pens}.</p>
    ${newCoach ? `<div class="panel row" style="text-align:left"><img src="${portrait(boss.char, 64)}" width="64" height="64" style="border-radius:10px;border:3px solid var(--ink);flex:none" alt="">
      <div><b style="font-family:var(--font-h);font-size:18px">Coach unlocked: ${boss.name}</b><br><i>${boss.quote || ''}</i><br>${boss.passive}</div></div>` : ''}
    ${progress.beaten.length === 5 && !progress.beaten.includes('cup') ? '<div class="panel">🏆 All five leagues conquered: the <b>Champions Cup</b> is open!</div>' : ''}
    <button class="btn big" id="home">Back to leagues</button></div>`;
  shell.confetti(240);
  stage.querySelector('#home').onclick = () => { sfx.click(); homeScreen(); };
}

function rewardScreen(headline) {
  window.scrollTo(0, 0);
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
  if (!m || busy || !stage.querySelector('#hand') || document.querySelector('.sheet-wrap')) return;
  if (e.key >= '1' && e.key <= '9' && !e.altKey) tapCard(+e.key - 1);
  if (e.key === 'Enter') { e.preventDefault(); kickOff(); }
  if (e.key === 'Escape' && sel >= 0) { sel = -1; renderPlan(); }
  if (e.key === 'd') showDeck();
  if (e.key === 'z' || e.key === 'u') { if (m.you.played.length) undoCard(m.you.played.length - 1); }
});
