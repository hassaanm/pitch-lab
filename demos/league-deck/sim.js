// Touchline match model. Pure logic, no DOM.
// A match is 6 spells of 15 minutes. Each spell: both coaches play cards,
// then ~5 possessions are simulated from the combined team stats.

import { CARDS, COACHES } from './data.js';

const sig = (x) => 1 / (1 + Math.exp(-x));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const STAT_KEYS = ['ctrl', 'atk', 'fin', 'def', 'prs', 'gk'];
export const STAT_LABEL = { ctrl: 'Control', atk: 'Attack', fin: 'Finish', def: 'Defence', prs: 'Press', gk: 'Keeper' };

export const SPELLS = 6;
export const SPELL_MIN = 15;

// ---------------------------------------------------------------- stats
// side = 'you' | 'opp'. Played cards = this spell; perm = instructions.
export function spellStats(m, side) {
  const me = m[side], other = m[side === 'you' ? 'opp' : 'you'];
  const s = { ...me.base };
  const h = { counter: 0, counterXg: 0, pressXg: 0, bypass: 0, setPiece: [], arm: [], variance: 0, cancelBig: 0, header: false,
    fewerPoss: 0, ignoreDef: 0, counterAgainst: 0, onGoalShout: 0 };
  for (const k in me.perm) s[k] += me.perm[k];
  const lead = (side === 'you' ? m.score[0] - m.score[1] : m.score[1] - m.score[0]);
  const minute = m.spell * SPELL_MIN;
  const add = (fx, mult = 1) => { for (const k in fx || {}) s[k] = (s[k] || 0) + fx[k] * mult; };

  const cards = me.played.map((id) => CARDS[id]);
  for (const c of cards) {
    if (!c.perm) add(c.fx);
    if (c.ifCtrlLead) h._ctrlLead = (h._ctrlLead || []).concat(c.ifCtrlLead);
    if (c.ifTrailing && lead < 0) add(c.ifTrailing);
    if (c.ifLeading && lead > 0) add(c.ifLeading);
    if (c.lateFin && minute >= 75) s.fin += c.lateFin;
    h.counter += c.counter || 0;
    h.counterXg += c.counterXg || 0;
    h.pressXg += c.pressXg || 0;
    h.bypass += c.bypass || 0;
    if (c.setPiece) h.setPiece.push({ p: c.setPiece, who: c.who || null, card: c.id });
    if (c.arm) h.arm.push({ ...c.arm, card: c.id });
    h.variance += c.variance || 0;
    h.cancelBig += c.cancelBig || 0;
    h.header = h.header || !!c.header;
    h.fewerPoss += c.fewerPoss || 0;
    h.ignoreDef += c.ignoreDef || 0;
    h.counterAgainst += c.counterAgainst || 0;
    h.onGoalShout += c.onGoalShout || 0;
  }
  // opponent cards that weaken us
  for (const id of other.played) { const c = CARDS[id]; if (!c.perm) add(c.oppFx); }
  for (const k in other.permOpp || {}) s[k] += other.permOpp[k];

  // coach passives
  const coach = me.coach;
  if (coach === 'lock') { if (lead > 0) s.def += 3; h.counter += 0.08; }
  if (coach === 'gegen') h.pressXg += 0.06;
  if (coach === 'magic') h.variance = 0;

  // fatigue
  const fat = me.sta < 50 ? (50 - me.sta) / 12 : 0;
  s.atk -= fat; s.def -= fat; s.prs -= fat * 1.3;
  h.fatigue = fat;

  // conditional on control comparison (needs the other side's raw control; approximate with base)
  if (h._ctrlLead) {
    const oc = other.base.ctrl + (other.perm.ctrl || 0) + other.played.reduce((a, id) => a + (CARDS[id].fx?.ctrl || 0), 0);
    if (s.ctrl > oc) for (const fx of h._ctrlLead) add(fx);
  }
  for (const k of STAT_KEYS) s[k] = Math.max(1, s[k]);
  s.h = h;
  return s;
}

// ---------------------------------------------------------------- odds
export function pressP(A, D) { return 0.4 * sig((D.prs - A.ctrl) / 3); }
export function progressP(A, D) { return 0.05 + 0.85 * sig((A.atk - (D.def - A.h.ignoreDef)) / 3); }
export function chanceXg(A) { return clamp(0.085 + 0.013 * (A.fin - 10), 0.03, 0.35); }
export function bigP(A, D) { return clamp(0.22 + 0.025 * (A.atk - D.def), 0.08, 0.5); }
export function goalP(xg, D) { return clamp(xg * (1 + (10 - D.gk) * 0.05), 0.02, 0.92); }
export function counterP(A, D) { return clamp((0.12 + D.h.counter) * (1 + A.h.counterAgainst), 0, 0.7); }
export function possShare(Y, O) { const a = Math.pow(Y.ctrl, 1.6), b = Math.pow(O.ctrl, 1.6); return a / (a + b); }

// Expected goals per possession owned by A (for A, and against A via turnovers/counters).
function possExpect(A, D) {
  const pt = pressP(A, D);
  const turnXg = goalP(0.1 + D.h.pressXg, A);
  const pp = (1 - pt) * (1 - A.h.variance) * progressP(A, D);
  const xg = chanceXg(A);
  const bp = bigP(A, D);
  const forA = pp * ((1 - bp) * goalP(xg, D) + bp * goalP(Math.min(0.6, xg * 3.2), D));
  const failed = (1 - pt) - pp;
  const againstA = pt * turnXg + failed * counterP(A, D) * goalP(0.12 + D.h.counterXg, A);
  return { forA, againstA };
}

export function numPoss(Y, O) { return Math.max(2, 5 - Math.max(Y.h.fewerPoss, O.h.fewerPoss)); }

export function projection(m) {
  const Y = spellStats(m, 'you'), O = spellStats(m, 'opp');
  const share = possShare(Y, O);
  const n = numPoss(Y, O);
  const ey = possExpect(Y, O), eo = possExpect(O, Y);
  let lamY = n * (share * ey.forA + (1 - share) * eo.againstA);
  let lamO = n * ((1 - share) * eo.forA + share * ey.againstA);
  for (const sp of Y.h.setPiece) lamY += goalP(sp.p, O) * 0.9;
  for (const sp of O.h.setPiece) lamO += goalP(sp.p, Y) * 0.9;
  return { Y, O, share, n, xgY: lamY, xgO: lamO, pY: 1 - Math.exp(-lamY), pO: 1 - Math.exp(-lamO), pressY: pressP(O, Y), pressO: pressP(Y, O), progY: progressP(Y, O), progO: progressP(O, Y) };
}

// ---------------------------------------------------------------- possession scripts
// Each possession becomes a list of beats the view animates:
//   {k:'build', side}, {k:'pass', side}, {k:'press', side (presser)}, {k:'progress', side},
//   {k:'blocked', side (defender)}, {k:'chance', side, xg, big}, {k:'moment', side, xg, ...},
//   {k:'shot', side, shooter, p, result:'goal'|'save'|'miss'}, {k:'counter', side}, {k:'corner', side}
// The game reads `moment` beats and pauses for the player's choice.

export function pickShooter(squad, who) {
  if (who) { const c = squad.find((p) => p.id === who); if (c) return c; }
  const out = squad.filter((p) => p.pos !== 'GK');
  const w = out.map((p) => Math.pow(p.stats.shoot, 2.2) * (p.pos === 'FW' ? 1.6 : 1));
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < out.length; i++) { r -= w[i]; if (r <= 0) return out[i]; }
  return out[out.length - 1];
}
export function pickPlayer(squad, pos) {
  const c = squad.filter((p) => p.pos === pos);
  return c[(Math.random() * c.length) | 0] || squad[1];
}

export function genPossession(m, owner, Y, O) {
  const A = owner === 'you' ? Y : O;
  const D = owner === 'you' ? O : Y;
  const other = owner === 'you' ? 'opp' : 'you';
  const beats = [{ k: 'build', side: owner }];
  const r = Math.random;

  if (r() < pressP(A, D)) {
    beats.push({ k: 'press', side: other, p: pressP(A, D) });
    const xg = 0.1 + D.h.pressXg;
    beats.push(chanceBeats(m, other, xg, xg >= 0.17, D, A, 'turnover'));
    return beats.flat();
  }
  beats.push({ k: 'pass', side: owner });
  let progressed;
  if (A.h.bypass > 0) { A.h.bypass--; progressed = true; beats.push({ k: 'skill', side: owner }); }
  else if (A.h.variance && r() < A.h.variance) { beats.push({ k: 'lost', side: owner }); progressed = false; }
  else progressed = r() < progressP(A, D);

  if (progressed) {
    beats.push({ k: 'progress', side: owner });
    const xg = chanceXg(A);
    const big = r() < bigP(A, D);
    if (big && D.h.cancelBig > 0) {
      D.h.cancelBig--;
      beats.push({ k: 'foul', side: other });
      beats.push(chanceBeats(m, owner, 0.07, false, A, D, 'freekick'));
    } else {
      beats.push(chanceBeats(m, owner, big ? Math.min(0.6, xg * 3.2) : xg, big, A, D, A.h.header ? 'header' : 'open'));
    }
  } else {
    beats.push({ k: 'blocked', side: other });
    const pc = counterP(A, D);
    if (r() < pc) {
      beats.push({ k: 'counter', side: other, p: pc });
      beats.push(chanceBeats(m, other, 0.12 + D.h.counterXg, false, D, A, 'counter'));
    }
  }
  return beats.flat();
}

function chanceBeats(m, side, xg, big, A, D, kind) {
  const squad = m[side].squad;
  let who = null;
  if (big && A.h.arm.length) { const a = A.h.arm[0]; who = a.who; }
  const shooter = pickShooter(squad, who);
  const out = [{ k: 'chance', side, xg, big, kind }];
  if (big) out.push({ k: 'moment', side, xg, shooter, kind });
  else {
    const p = goalP(xg, D);
    out.push({ k: 'shot', side, shooter, p, xg, kind, result: rollShot(p) });
  }
  return out;
}

export function rollShot(p) {
  if (Math.random() < p) return 'goal';
  return Math.random() < 0.55 ? 'save' : 'miss';
}

// Key-moment options. For the player's big chances and for big chances against.
export function momentOptions(m, beat, Y, O) {
  if (beat.side === 'you') {
    const arm = Y.h.arm[0];
    const xg = beat.xg + (arm ? arm.xg : 0);
    const shooter = beat.shooter;
    const mate = m.you.squad.filter((p) => p.pos !== 'GK' && p.id !== shooter.id).sort((a, b) => b.stats.shoot - a.stats.shoot)[0];
    const passP = clamp(0.82 - 0.025 * (O.def - 10), 0.45, 0.95);
    const tapP = goalP(0.42, O);
    const roundP = clamp(0.2 + 0.05 * (shooter.stats.dribble - 5) + 0.03 * (Y.atk - O.def) / 2, 0.1, 0.65);
    return [
      { id: 'shoot', label: `${shooter.name} shoots`, p: goalP(xg, O), detail: arm ? `incl. ${CARDS[arm.card].name}` : 'first time' },
      { id: 'square', label: `Square to ${mate.name}`, p: passP * tapP, detail: `pass ${Math.round(passP * 100)}% → tap-in ${Math.round(tapP * 100)}%`, mate },
      { id: 'round', label: 'Round the keeper', p: roundP, detail: `${shooter.name}'s dribble ${shooter.stats.dribble}` },
    ];
  }
  const g = goalP(beat.xg, Y);
  return [
    { id: 'stay', label: 'Wak stays big', p: 1 - g, detail: 'safe, average' },
    { id: 'rush', label: 'Wak rushes out', p: clamp(1 - g * 0.65, 0, 0.95) * 0.85, detail: '15% foul → penalty' },
    { id: 'guess', label: 'Wak guesses a side', p: 0.5 * 0.85 + 0.5 * 0.1, detail: '50/50: right side 85%, wrong 10%' },
  ];
}

export function resolveMoment(m, beat, opt, Y, O) {
  if (beat.side === 'you') {
    if (Y.h.arm.length) Y.h.arm.shift();
    if (opt.id === 'square') {
      const passOk = Math.random() < opt.p / goalP(0.42, O);
      if (!passOk) return { result: 'cut', shooter: beat.shooter, text: `${opt.mate.name}'s pass is cut out!` };
      const goal = Math.random() < goalP(0.42, O);
      return { result: goal ? 'goal' : 'save', shooter: opt.mate, text: goal ? `${opt.mate.name} taps it in!` : `${opt.mate.name} somehow misses!` };
    }
    const goal = Math.random() < opt.p;
    return { result: goal ? 'goal' : (Math.random() < 0.6 ? 'save' : 'miss'), shooter: beat.shooter, round: opt.id === 'round' };
  }
  // defending
  if (opt.id === 'rush' && Math.random() < 0.15) {
    const goal = Math.random() < 0.76;
    return { result: goal ? 'goal' : 'save', shooter: beat.shooter, penalty: true, text: goal ? 'Penalty… scored.' : 'Penalty… Wak saves it!' };
  }
  if (opt.id === 'guess') {
    const right = Math.random() < 0.5;
    const saved = Math.random() < (right ? 0.85 : 0.1);
    return { result: saved ? 'save' : 'goal', shooter: beat.shooter, text: right ? 'Wak guessed right!' : 'Wak went the wrong way!' };
  }
  const saved = Math.random() < (opt.id === 'rush' ? opt.p / 0.85 : opt.p);
  return { result: saved ? 'save' : 'goal', shooter: beat.shooter };
}

// ---------------------------------------------------------------- AI coach
export function aiPlan(m, deck) {
  const lead = m.score[1] - m.score[0];
  const late = m.spell >= 4;
  let budget = m.opp.shouts;
  const choices = [];
  const pool = [...deck];
  const score = (id) => {
    const c = CARDS[id];
    let v = Math.random() * 2;
    const fx = c.fx || {};
    if (lead < 0 || (!late && lead === 0)) v += (fx.atk || 0) + (fx.fin || 0) + (fx.prs || 0) * 0.7 + (c.setPiece ? 3 : 0) + (c.ifTrailing ? 3 : 0);
    if (lead > 0) v += (fx.def || 0) * 1.2 + (c.fewerPoss ? 3 : 0) + (c.counter ? 2 : 0);
    v += (fx.ctrl || 0) * 0.6 + (fx.def || 0) * 0.4;
    if (c.sta && m.opp.sta < 40 && c.sta < 0) v -= 4;
    return v / Math.max(1, c.cost);
  };
  while (budget > 0 && pool.length) {
    pool.sort((a, b) => score(b) - score(a));
    const i = pool.findIndex((id) => CARDS[id].cost <= budget);
    if (i < 0) break;
    const id = pool.splice(i, 1)[0];
    choices.push(id);
    budget -= CARDS[id].cost;
    if (CARDS[id].cost === 0 && choices.length >= 3) break;
  }
  return choices;
}

// ---------------------------------------------------------------- deck helpers
export function shuffle(a) { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }

export function drawCards(side, n) {
  for (let i = 0; i < n; i++) {
    if (!side.draw.length) { side.draw = shuffle(side.discard); side.discard = []; }
    if (!side.draw.length) break;
    side.hand.push(side.draw.pop());
  }
}

export function cardCost(m, id) {
  const c = CARDS[id];
  if (m.you.coach === 'tiki' && c.style === 'possession' && !m.you.played.some((p) => CARDS[p].style === 'possession')) return 0;
  return c.cost;
}

export function coachName(id) { return COACHES[id]?.name || id; }
