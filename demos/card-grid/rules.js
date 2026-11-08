// Card Grid rules: grid geometry, odds math, card definitions and rival AI.
// Pure data + functions (no DOM), so the odds shown on screen are exactly the
// odds rolled.
//
// Grid: 7 columns × 11 rows. Row 0 is Redrock's goal end (top), row 10 is
// ours. Sunbirds ('you') attack UP, Redrock ('opp') attack DOWN.

import { byId } from '../../shared/cast.js';

export const COLS = 7, ROWS = 11;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const cheb = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const inside = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS;
export const cell = (u) => [u.c, u.r];
export const char = (u) => byId[u.cid];
export const st = (u) => byId[u.cid].stats;
export const other = (side) => (side === 'you' ? 'opp' : 'you');
export const GOAL = { you: [3, -1], opp: [3, ROWS] }; // the goal each side shoots at

export function unitAt(m, c, r, pos) {
  const P = pos || posMap(m);
  return m.units.find((u) => { const p = P[u.uid]; return p[0] === c && p[1] === r; }) || null;
}
export const holder = (m) => m.units.find((u) => u.uid === m.ball) || null;
export const side = (m, s) => m.units.filter((u) => u.side === s);
export const posMap = (m) => Object.fromEntries(m.units.map((u) => [u.uid, [u.c, u.r]]));
const isEmpty = (m, c, r, P) => inside(c, r) && !unitAt(m, c, r, P);

// Distance from point p to segment a–b (in cell units).
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = dx * dx + dy * dy || 1;
  const t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L, 0, 1);
  return { d: Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]), t };
}

// How much a defender counts (Block doubles, a beaten presser counts 0).
export const weight = (u) => (u.beaten ? 0 : u.block || 1);

// ------------------------------------------------------------------ odds
// Pass ≈ 0.97 − 0.035·distance − 0.27·(defenders near the line), clamp .08–.97
export function lineBlockers(m, from, to, defSide, P = posMap(m)) {
  const out = [];
  for (const u of side(m, defSide)) {
    const p = P[u.uid];
    if (p[0] === from[0] && p[1] === from[1]) continue;
    const { d, t } = segDist(p, from, to);
    if (d <= 1.0 && t > 0.12 && weight(u) > 0) out.push({ u, d });
  }
  return out.sort((a, b) => a.d - b.d);
}

export function passOdds(m, passer, from, to, defSide, o = {}, P = posMap(m)) {
  const d = dist(from, to);
  const skill = ((st(passer).pass - 6) * 0.015);
  if (o.needle) return { p: clamp(0.97 - 0.035 * d + skill, 0.08, 0.97), blockers: [] };
  if (o.lofted) {
    // Lofted ball: only markers right next to the target can cut it out.
    const near = side(m, defSide).filter((u) => cheb(P[u.uid], to) <= 1 && weight(u) > 0);
    const n = near.reduce((a, u) => a + weight(u), 0);
    return { p: clamp(0.95 - 0.02 * d - 0.27 * n + skill, 0.08, 0.97), blockers: near.map((u) => ({ u })) };
  }
  const bl = lineBlockers(m, from, to, defSide, P);
  const n = bl.reduce((a, b) => a + weight(b.u), 0);
  return { p: clamp(0.97 - 0.035 * d - 0.27 * n + skill + (o.bonus || 0), 0.08, 0.97), blockers: bl };
}

// Shot ≈ (shoot/10)·(1.15 − 0.14·dist) − 0.10 keeper set − 0.12 per adjacent defender, clamp .03–.85
export function shotDist(sideAtk, at) {
  const goalRow = sideAtk === 'you' ? -0.5 : ROWS - 0.5;
  return Math.hypot((at[0] - 3) * 0.8, at[1] - goalRow);
}
export function shotOdds(m, shooter, at, o = {}, P = posMap(m)) {
  const sAtk = shooter.side, dSide = other(sAtk);
  const d = shotDist(sAtk, at);
  let p = (st(shooter).shoot / 10) * (1.15 - 0.14 * d);
  const parts = [];
  const gk = side(m, dSide).find((u) => char(u).pos === 'GK');
  const keeperSet = !(sAtk === 'you' && m.flags.keeperUnset);
  if (keeperSet && gk) { const k = 0.1 * (st(gk).keep || 8) / 8.5; p -= k; parts.push(`keeper set −${Math.round(k * 100)}`); }
  if (!o.ignoreAdj) {
    const adj = side(m, dSide).filter((u) => char(u).pos !== 'GK' && cheb(P[u.uid], at) <= 1);
    const n = adj.reduce((a, u) => a + weight(u), 0);
    if (n) { p -= 0.12 * n; parts.push(`${adj.length} blocker${adj.length > 1 ? 's' : ''} −${Math.round(12 * n)}`); }
  }
  if (sAtk === 'opp' && m.flags.wall) { p -= 0.25; parts.push('Brick Wall −25'); }
  if (o.bonus) { p += o.bonus; parts.push(`+${Math.round(o.bonus * 100)}`); }
  return { p: clamp(p, 0.03, 0.85), parts };
}

// Tackle ≈ tackle/(tackle+dribble)·1.1, clamp .1–.85
export function tackleOdds(tackler, carrier, bonus = 0) {
  const tk = st(tackler).tackle, dr = st(carrier).dribble;
  return clamp((tk / (tk + dr)) * 1.1 + bonus, 0.1, 0.85);
}

// Dribble path (king steps) from a to b; null if blocked.
export function dribblePath(m, a, b, P = posMap(m)) {
  const path = [];
  let [c, r] = a;
  while (c !== b[0] || r !== b[1]) {
    c += Math.sign(b[0] - c); r += Math.sign(b[1] - r);
    if (!isEmpty(m, c, r, P)) return null;
    path.push([c, r]);
  }
  return path;
}
// Defenders adjacent to the path get a lunge at 60% of their tackle odds.
export function dribbleOdds(m, carrier, from, to, o = {}, P = posMap(m)) {
  const path = dribblePath(m, from, to, P);
  if (!path) return null;
  const dSide = other(carrier.side);
  const lungers = side(m, dSide).filter((u) => weight(u) > 0 && path.some((pc) => cheb(P[u.uid], pc) <= 1));
  let keep = 1;
  const rolls = lungers.map((u) => { const t = tackleOdds(u, carrier) * 0.6 * (o.half ? 0.5 : 1); keep *= 1 - t; return { u, t }; });
  return { p: keep, rolls, path };
}

// ------------------------------------------------------------------ cards
// kind: pass | through | dribble | move | shoot | energy | press | block | trap | wall
// who: a character card (that player must be the actor / carrier / on the pitch)
export const CARDS = {
  pass:    { name: 'Short Pass', cost: 1, side: 'atk', kind: 'pass', range: 3, icon: '⚽', text: 'Pass to a teammate within 3.' },
  switch:  { name: 'Switch Play', cost: 1, side: 'atk', kind: 'pass', range: 7, lofted: true, minCols: 3, icon: '🔀', text: 'Lofted, 3+ columns across. Only close markers cut it. Keeper unsettled.' },
  through: { name: 'Through Ball', cost: 2, side: 'atk', kind: 'through', icon: '🎯', text: 'A teammate runs up to 2 forward to meet the ball.' },
  dribble: { name: 'Dribble', cost: 1, side: 'atk', kind: 'dribble', range: 2, icon: '💨', text: 'Carry the ball up to 2. Nearby defenders lunge.' },
  overlap: { name: 'Overlap Run', cost: 1, side: 'atk', kind: 'move', range: 3, pos: 'DF', forward: true, icon: '🏃', text: 'A defender bursts up to 3 forward.' },
  run:     { name: 'Off-Ball Run', cost: 1, side: 'atk', kind: 'move', range: 2, icon: '👟', text: 'A teammate off the ball moves up to 2.' },
  shoot:   { name: 'Shoot', cost: 1, side: 'atk', kind: 'shoot', icon: '🥅', text: 'The ball carrier shoots.' },
  needle:  { name: 'Needle Pass', cost: 1, side: 'atk', kind: 'pass', who: 'kenji', range: 6, needle: true, text: 'Kenji passes up to 6. Ignores defenders.' },
  eagle:   { name: 'Eagle Strike', cost: 1, side: 'atk', kind: 'shoot', who: 'rio', bonus: 0.2, text: 'Rio shoots, +20%.' },
  express: { name: 'Overlap Express', cost: 1, side: 'atk', kind: 'move', who: 'ada', range: 4, forward: true, text: 'Ada flies up to 4 forward.' },
  pinball: { name: 'Pinball Run', cost: 1, side: 'atk', kind: 'dribble', who: 'pip', range: 3, half: true, text: 'Pip dribbles up to 3. Lunges at half odds.' },
  late:    { name: 'Late Show', cost: 1, side: 'atk', kind: 'shoot', who: 'sol', bonus: 0.05, lateBonus: 0.3, text: "Sol shoots, +5%. +30% from 80'." },
  ram:     { name: 'Battering Ram', cost: 1, side: 'atk', kind: 'shoot', who: 'bruno', ignoreAdj: true, text: "Bruno shoots. Blockers don't count." },
  engine:  { name: 'Engine Room', cost: 0, side: 'atk', kind: 'energy', who: 'lupe', text: '+2 energy this turn.' },
  // defence
  press:   { name: 'Press', cost: 1, side: 'def', kind: 'press', reach: 2, icon: '🦶', text: 'A player within 2 closes in and tackles now.' },
  mark:    { name: 'Mark', cost: 1, side: 'def', kind: 'move', range: 2, icon: '🛡️', text: 'Move a player up to 2 to cut lanes.' },
  block:   { name: 'Block', cost: 1, side: 'def', kind: 'block', mult: 2, icon: '🧱', text: 'A player counts double vs passes & shots.' },
  trap:    { name: 'Offside Trap', cost: 1, side: 'def', kind: 'trap', icon: '🚩', text: 'Line steps up 1. Runners behind it: 60% offside.' },
  sweep:   { name: 'Clean Sweep', cost: 1, side: 'def', kind: 'press', who: 'tomo', reach: 2, bonus: 0.2, text: 'Tomo presses, +20% tackle.' },
  thunder: { name: 'Thunder Block', cost: 1, side: 'def', kind: 'block', who: 'mo', mult: 3, text: 'Mo counts triple vs passes & shots.' },
  wall:    { name: 'Brick Wall', cost: 1, side: 'def', kind: 'wall', who: 'wak', text: 'Their shots −25% this turn.' },
};
export const REWARDS = ['pass', 'switch', 'through', 'dribble', 'overlap', 'run', 'shoot', 'needle', 'eagle', 'express', 'pinball', 'late', 'ram', 'engine',
  'press', 'mark', 'block', 'trap', 'sweep', 'thunder', 'wall'];

const onPitch = (m, cid) => m.units.some((u) => u.side === 'you' && u.cid === cid);
export const cardUsable = (m, id) => { const c = CARDS[id]; return !c.who || onPitch(m, c.who); };

// Who can act with this card. [] = cannot play. null = no actor needed.
export function cardActors(m, id) {
  const c = CARDS[id];
  const h = holder(m);
  const mine = side(m, 'you');
  if (c.side === 'atk' && m.poss !== 'you') return [];
  if (c.side === 'def' && m.poss !== 'opp') return [];
  if (c.who && !onPitch(m, c.who)) return [];
  switch (c.kind) {
    case 'pass': case 'dribble': case 'shoot':
      if (!h || h.side !== 'you') return [];
      if (c.who && h.cid !== c.who) return [];
      return [h];
    case 'through': return h && h.side === 'you' ? mine.filter((u) => u !== h && char(u).pos !== 'GK') : [];
    case 'move': return mine.filter((u) => u !== h && char(u).pos !== 'GK' && (!c.pos || char(u).pos === c.pos) && (!c.who || u.cid === c.who));
    case 'press': return h ? mine.filter((u) => char(u).pos !== 'GK' && (!c.who || u.cid === c.who) && cheb(cell(u), cell(h)) <= c.reach + 1) : [];
    case 'block': return mine.filter((u) => char(u).pos !== 'GK' && (!c.who || u.cid === c.who) && !u.block);
    case 'energy': case 'wall': case 'trap': return null;
  }
  return [];
}

// Targets for an actor: [{ cell, p, unit, label, extra }]
export function cardTargets(m, id, actor) {
  const c = CARDS[id];
  const h = holder(m);
  const P = posMap(m);
  const out = [];
  const empties = (center, rng, filter = () => true) => {
    for (let dc = -rng; dc <= rng; dc++) for (let dr = -rng; dr <= rng; dr++) {
      const cc = center[0] + dc, rr = center[1] + dr;
      if ((dc || dr) && isEmpty(m, cc, rr, P) && filter(cc, rr)) out.push([cc, rr]);
    }
    return out.splice(0);
  };
  switch (c.kind) {
    case 'pass': {
      for (const u of side(m, 'you')) {
        if (u === actor) continue;
        const d = dist(cell(actor), cell(u));
        if (d > c.range + 0.5) continue;
        if (c.minCols && Math.abs(u.c - actor.c) < c.minCols) continue;
        const o = passOdds(m, actor, cell(actor), cell(u), 'opp', { needle: c.needle, lofted: c.lofted }, P);
        out.push({ cell: cell(u), unit: u, p: o.p, blockers: o.blockers });
      }
      return out;
    }
    case 'through': {
      const cells = empties(cell(actor), 2, (cc, rr) => rr < actor.r);
      return cells.map((cl) => { const o = passOdds(m, h, cell(h), cl, 'opp', { bonus: -0.04 }, P); return { cell: cl, unit: actor, p: o.p, blockers: o.blockers }; });
    }
    case 'dribble': {
      const cells = empties(cell(actor), c.range);
      return cells.map((cl) => { const o = dribbleOdds(m, actor, cell(actor), cl, { half: c.half }, P); return o && { cell: cl, p: o.p, rolls: o.rolls }; }).filter(Boolean);
    }
    case 'move': {
      const cells = empties(cell(actor), c.range, (cc, rr) => !c.forward || (rr < actor.r && Math.abs(cc - actor.c) <= 1));
      return cells.map((cl) => ({ cell: cl, p: null }));
    }
    case 'shoot': {
      const late = c.lateBonus && lateGame(m);
      const o = shotOdds(m, actor, cell(actor), { bonus: late ? c.lateBonus : c.bonus || 0, ignoreAdj: c.ignoreAdj }, P);
      return [{ cell: GOAL.you, p: o.p, parts: o.parts, goal: true }];
    }
    case 'press': {
      const cells = empties(cell(h), 1, (cc, rr) => cheb(cell(actor), [cc, rr]) <= c.reach);
      const p = tackleOdds(actor, h, c.bonus || 0);
      return cells.map((cl) => ({ cell: cl, p }));
    }
    case 'block': return [{ cell: cell(actor), p: null }];
  }
  return out;
}
export const lateGame = (m) => (m.labels ? true : m.turn >= 10);

// Best odds a card could give right now (shown on the card face).
export function cardBest(m, id) {
  const actors = cardActors(m, id);
  if (actors === null) return { ok: true, p: null };
  let best = null, any = false;
  for (const a of actors) for (const t of cardTargets(m, id, a)) { any = true; if (t.p != null && (best == null || t.p > best)) best = t.p; }
  return { ok: any, p: best };
}

// ------------------------------------------------------------------ rival AI
// When we attack: rivals telegraph presses (anchored to a CELL, Into-the-Breach
// style — move the ball away and the press hits grass) and steps.
export function planDefence(m) {
  const h = holder(m);
  const P = posMap(m);
  const opp = side(m, 'opp').filter((u) => char(u).pos !== 'GK');
  const intents = [];
  const taken = new Set();
  const key = (c) => c[0] + ',' + c[1];
  // 1–2 pressers: nearest outfielders within 3 of the ball.
  const near = opp.map((u) => ({ u, d: cheb(cell(u), cell(h)) })).filter((x) => x.d <= 3).sort((a, b) => a.d - b.d);
  const nPress = m.turnCount % 3 === 2 ? 2 : 1;
  near.slice(0, nPress).forEach(({ u }) => intents.push({ type: 'press', uid: u.uid, cell: cell(h) }));
  const pressers = new Set(intents.map((i) => i.uid));
  // Others step goal-side of our most dangerous runner they can reach.
  const threats = side(m, 'you').filter((u) => char(u).pos !== 'GK' && u !== h).sort((a, b) => a.r - b.r);
  for (const u of opp) {
    if (pressers.has(u.uid)) continue;
    let best = null, bs = -1e9;
    for (const t of threats) {
      for (const dc of [0, -1, 1]) {
        const tc = [t.c + dc, t.r - 1];
        if (!inside(...tc) || taken.has(key(tc))) continue;
        const occ = unitAt(m, tc[0], tc[1], P);
        if (occ && occ !== u) continue;
        const reach = cheb(cell(u), tc);
        if (reach > 2) continue;
        const s = (10 - t.r) * 1.0 - reach * 0.6 - Math.abs(dc) * 0.4;
        if (s > bs) { bs = s; best = tc; }
      }
    }
    if (!best) {
      // drift toward the ball, staying goal-side
      const tc = [u.c + Math.sign(h.c - u.c), Math.min(u.r + Math.sign(h.r - 1 - u.r), h.r - 1)];
      if (inside(...tc) && !unitAt(m, tc[0], tc[1], P) && !taken.has(key(tc))) best = tc;
    }
    if (best && (best[0] !== u.c || best[1] !== u.r)) { taken.add(key(best)); intents.push({ type: 'step', uid: u.uid, to: best }); }
  }
  // keeper shuffles with the ball
  const gk = side(m, 'opp').find((u) => char(u).pos === 'GK');
  const gc = clamp(h.c, 2, 4);
  if (gk && gc !== gk.c && !unitAt(m, gc, 0, P)) intents.push({ type: 'step', uid: gk.uid, to: [gc, 0] });
  return { kind: 'def', list: intents };
}

// When they attack: a fixed plan (runs, then 1–3 ball actions). Odds are
// recomputed live from your positions, so Mark/Block/Press visibly change them.
export function planAttack(m) {
  const h = holder(m);
  const P = posMap(m);
  const opp = side(m, 'opp');
  const runs = [];
  const taken = new Set();
  for (const u of opp) {
    if (u === h || char(u).pos === 'GK') continue;
    if (char(u).pos === 'DF' && u.r >= 5) continue; // defenders hold
    const cands = [];
    for (let dc = -1; dc <= 1; dc++) for (let dr = 1; dr <= 2; dr++) {
      const tc = [u.c + dc, u.r + dr];
      if (!inside(...tc) || tc[1] > 9 || unitAt(m, tc[0], tc[1], P) || taken.has(tc + '')) continue;
      const lane = passOdds(m, h, cell(h), tc, 'you', {}, P).p;
      cands.push({ tc, s: lane + dr * 0.08 - Math.abs(tc[0] - 3) * 0.02 + Math.random() * 0.05 });
    }
    cands.sort((a, b) => b.s - a.s);
    if (cands[0]) { taken.add(cands[0].tc + ''); runs.push({ type: 'run', uid: u.uid, to: cands[0].tc }); }
  }
  // simulate positions after the runs
  const V = { ...P };
  for (const r of runs) V[r.uid] = r.to;
  const actions = [];
  let cur = h, at = V[h.uid];
  for (let step = 0; step < 3; step++) {
    const sp = shotOdds(m, cur, at, {}, V).p;
    if (sp >= (step === 0 ? 0.3 : 0.2) || (step === 2 && sp > 0.08)) { actions.push({ type: 'shoot', uid: cur.uid }); break; }
    let best = null, bv = 0.25;
    for (const t of opp) {
      if (t === cur || char(t).pos === 'GK') continue;
      const tp = V[t.uid];
      if (dist(at, tp) > 4.5) continue;
      const p = passOdds(m, cur, at, tp, 'you', {}, V).p;
      const gain = tp[1] - at[1];
      const v = p * (1 + Math.max(0, gain) * 0.3 + shotOdds(m, t, tp, {}, V).p) - (gain < 0 ? 0.15 : 0);
      if (p > 0.4 && v > bv) { bv = v; best = { type: 'pass', uid: cur.uid, to: t.uid }; }
    }
    for (let dc = -2; dc <= 2; dc++) for (let dr = 1; dr <= 2; dr++) {
      const tc = [at[0] + dc, at[1] + dr];
      if (!inside(...tc) || Object.entries(V).some(([, p]) => p[0] === tc[0] && p[1] === tc[1])) continue;
      const o = dribbleOdds(m, cur, at, tc, {}, V);
      if (!o) continue;
      const v = o.p * (1 + dr * 0.3 + shotOdds(m, cur, tc, {}, V).p) - 0.05;
      if (o.p > 0.45 && v > bv) { bv = v; best = { type: 'dribble', uid: cur.uid, to: tc }; }
    }
    if (!best) { if (sp > 0.06 && step > 0) actions.push({ type: 'shoot', uid: cur.uid }); break; }
    actions.push(best);
    if (best.type === 'pass') { cur = m.units.find((u) => u.uid === best.to); at = V[cur.uid]; }
    else { at = best.to; V[cur.uid] = at; }
  }
  if (!actions.length) {
    // nothing on: recycle sideways to the safest teammate
    const t = opp.filter((u) => u !== h && char(u).pos !== 'GK').sort((a, b) => passOdds(m, h, V[h.uid], V[b.uid], 'you', {}, V).p - passOdds(m, h, V[h.uid], V[a.uid], 'you', {}, V).p)[0];
    if (t) actions.push({ type: 'pass', uid: h.uid, to: t.uid });
  }
  return { kind: 'atk', runs, actions };
}

// Live odds for the rival plan given current positions (runs blocked if you
// stepped into their target cell).
export function evalAttack(m, plan) {
  const P = posMap(m);
  const V = { ...P };
  const runs = plan.runs.map((r) => {
    const occ = unitAt(m, r.to[0], r.to[1], V);
    const blocked = !!occ;
    if (!blocked) V[r.uid] = r.to;
    return { ...r, blocked };
  });
  const lastLine = Math.max(...side(m, 'you').filter((u) => char(u).pos !== 'GK').map((u) => V[u.uid][1]));
  const steps = [];
  let cumul = 1;
  for (const a of plan.actions) {
    const u = m.units.find((x) => x.uid === a.uid);
    const at = V[u.uid];
    let s;
    if (a.type === 'pass') {
      const t = m.units.find((x) => x.uid === a.to);
      const o = passOdds(m, u, at, V[t.uid], 'you', {}, V);
      const offside = m.flags.trap && V[t.uid][1] > lastLine ? 0.6 : 0;
      s = { ...a, from: at, toCell: V[t.uid], p: o.p * (1 - offside), raw: o.p, offside, blockers: o.blockers };
    } else if (a.type === 'dribble') {
      const o = dribbleOdds(m, u, at, a.to, {}, V);
      if (!o) s = { ...a, from: at, toCell: a.to, p: 0, rolls: [], blockedPath: true };
      else s = { ...a, from: at, toCell: a.to, p: o.p, rolls: o.rolls };
      if (o) V[u.uid] = a.to;
    } else {
      const o = shotOdds(m, u, at, {}, V);
      s = { ...a, from: at, toCell: GOAL.opp, p: o.p, parts: o.parts };
    }
    cumul *= a.type === 'shoot' ? 1 : s.p;
    s.reach = cumul;
    steps.push(s);
  }
  return { runs, steps, V, lastLine };
}

// Chance the rival plan ends in a goal (product of each step, then the shot).
export function goalChance(m, plan) {
  if (!plan || plan.kind !== 'atk') return 0;
  const ev = evalAttack(m, plan);
  let p = 1;
  for (const s of ev.steps) { p *= s.p; if (s.type === 'shoot') return p; }
  return 0;
}
