// Auto XI match model. Pure logic, no DOM.
// A board of placed players -> team stats (+ synergies + adjacency links)
// -> per-half goal expectation -> a scripted half of possessions.
import { TRAITS, UNIT, ROLE_LINE, LINES } from './data.js';

const sig = (x) => 1 / (1 + Math.exp(-x));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const STAT_KEYS = ['ctrl', 'atk', 'fin', 'def', 'prs', 'gk'];
export const STAT_LABEL = { ctrl: 'Control', atk: 'Attack', fin: 'Finish', def: 'Defence', prs: 'Press', gk: 'Keeper' };
export const POSS_PER_HALF = 8;
export const STAR_MULT = 1.45;

// A board unit may carry its own display name (a rival stand-in for a player you field).
export const nameOf = (p) => p.name || UNIT[p.id].char.name;
export const lineOf = (slot) => LINES[Math.floor(slot / 3)];
export const colOf = (slot) => slot % 3;
export const roleOf = (unitId) => UNIT[unitId].traits[1];
export const styleOf = (unitId) => UNIT[unitId].traits[0];
export const fits = (unitId, slot) => ROLE_LINE[roleOf(unitId)].includes(lineOf(slot));

// Count traits by UNIQUE player (TFT rule: two Rios count once).
export function traitCounts(board) {
  const seen = new Set(), counts = {};
  for (const p of board) {
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    for (const t of UNIT[p.id].traits) counts[t] = (counts[t] || 0) + 1;
  }
  return counts;
}
export function activeTier(trait, n) {
  const tiers = TRAITS[trait].tiers;
  let k = -1;
  tiers.forEach((t, i) => { if (n >= t) k = i; });
  return k;
}

// Adjacency links: the "where you put them" layer.
export function links(board) {
  const out = [];
  const at = (s) => board[s];
  for (let s = 0; s < 9; s++) {
    const p = at(s); if (!p) continue;
    const role = roleOf(p.id), line = lineOf(s), col = colOf(s);
    // Playmaker in midfield feeds the forward straight ahead (or diagonal if none).
    if (role === 'playmaker' && line === 'mid') {
      const cands = [col, col - 1, col + 1].filter((c) => c >= 0 && c < 3).map((c) => c);
      const target = cands.map((c) => c).find((c) => at(c));
      if (target != null) out.push({ kind: 'feed', from: s, to: target, tag: `🎯 ${nameOf(p)}→${nameOf(at(target))}`, fx: { fin: 1.2, atk: 0.6 }, text: `${nameOf(p)} feeds ${nameOf(at(target))}: +1.2 Finish, +0.6 Attack` });
    }
    // Two Walls side by side at the back.
    if (role === 'wall' && line === 'back' && col < 2) {
      const q = at(s + 1);
      if (q && roleOf(q.id) === 'wall') out.push({ kind: 'pair', from: s, to: s + 1, tag: `🤝 ${nameOf(p)}+${nameOf(q)}`, fx: { def: 2 }, text: `${nameOf(p)} + ${nameOf(q)} partnership: +2 Defence` });
    }
    // Engine in midfield drives each midfielder beside him.
    if (role === 'engine' && line === 'mid') {
      for (const c of [col - 1, col + 1]) {
        if (c < 0 || c > 2 || !at(3 + c)) continue;
        out.push({ kind: 'engine', from: s, to: 3 + c, tag: `🫀 ${nameOf(p)}`, fx: { prs: 0.8, ctrl: 0.4 }, text: `${nameOf(p)} carries ${nameOf(at(3 + c))}: +0.8 Press, +0.4 Control` });
      }
    }
    // Speedster on a flank.
    if (role === 'speed' && col !== 1 && (line === 'front' || line === 'back')) {
      out.push({ kind: 'wing', from: s, to: s, tag: `💨 ${nameOf(p)}`, fx: { atk: 1, counter: 0.04 }, text: `${nameOf(p)} on the ${col === 0 ? 'left' : 'right'} flank: +1 Attack` });
    }
  }
  return out;
}

// side: { board, keeper, half } -> stats
export function teamStats(side, half = 1) {
  const raw = { ctrl: 0, atk: 0, fin: 0, def: 0, prs: 0 };
  const h = { counter: 0, pressXg: 0, big: 0, setPiece: 0, noFade: 0 };
  const notes = [];
  side.board.forEach((p, s) => {
    if (!p) return;
    const st = UNIT[p.id].char.stats;
    const m = (p.star === 2 ? STAR_MULT : 1) * (fits(p.id, s) ? 1 : 0.6);
    const line = lineOf(s);
    if (line === 'back') { raw.def += st.tackle * 0.9 * m; raw.ctrl += st.pass * 0.25 * m; raw.atk += st.pace * 0.1 * m; }
    if (line === 'mid') { raw.ctrl += st.pass * 0.7 * m; raw.prs += (st.tackle + st.stamina) * 0.35 * m; raw.def += st.tackle * 0.3 * m; raw.atk += st.dribble * 0.25 * m; }
    if (line === 'front') { raw.atk += (st.dribble + st.pace) * 0.35 * m; raw.fin += st.shoot * 0.8 * m; raw.prs += st.stamina * 0.2 * m; }
    if (!fits(p.id, s)) notes.push(`${nameOf(p)} is out of position (60%)`);
  });
  const s = {
    ctrl: 4 + raw.ctrl * 0.45, atk: 4 + raw.atk * 0.5, def: 4 + raw.def * 0.33,
    prs: 4 + raw.prs * 0.45, fin: 4 + raw.fin * 0.55, gk: 3 + side.keeper,
  };
  const add = (fx) => { for (const k in fx) { if (k in s) s[k] += fx[k]; else h[k] = (h[k] || 0) + fx[k]; } };
  const counts = traitCounts(side.board);
  const active = [];
  // src: every synergy or placement bonus, so a beat can name what caused it.
  const src = [];
  for (const t in counts) {
    const k = activeTier(t, counts[t]);
    if (k >= 0) {
      add(TRAITS[t].fx[k]); active.push({ t, k, n: counts[t] });
      src.push({ label: `${TRAITS[t].icon} ${TRAITS[t].name} ${counts[t]}`, fx: TRAITS[t].fx[k], who: side.board.map((p, sl) => (p && UNIT[p.id].traits.includes(t) ? sl : -1)).filter((sl) => sl >= 0) });
    }
  }
  const L = links(side.board);
  for (const l of L) { add(l.fx); src.push({ label: l.tag, fx: l.fx, who: l.from === l.to ? [l.from] : [l.from, l.to], link: l }); }
  if (half === 2 && !h.noFade) { s.atk -= 0.8; s.prs -= 1.2; notes.push('Tired legs in the 2nd half (no Engine pair: field 2 Engines): −0.8 Attack, −1.2 Press'); }
  for (const k of STAT_KEYS) s[k] = Math.max(1, s[k]);
  return { s, h, counts, active, links: L, notes, src };
}

// ---------------------------------------------------------------- odds (same family as Touchline)
export const pressP = (A, D) => 0.42 * sig((D.s.prs - A.s.ctrl) / 3);
// Floor 0.28: even the best defensive synergy cannot stop every attack (a half needs shots).
export const progressP = (A, D) => 0.28 + 0.62 * sig((A.s.atk - D.s.def) / 4.5);
export const chanceXg = (A) => clamp(0.15 + 0.018 * (A.s.fin - 10), 0.05, 0.45);
export const bigP = (A, D) => clamp(0.2 + 0.025 * (A.s.atk - D.s.def) + A.h.big, 0.06, 0.6);
export const goalP = (xg, D) => clamp(xg * (1 + (10 - D.s.gk) * 0.06), 0.02, 0.92);
export const counterP = (D) => clamp(0.12 + D.h.counter, 0, 0.7);
export const possShare = (Y, O) => { const a = Math.pow(Y.s.ctrl, 1.6), b = Math.pow(O.s.ctrl, 1.6); return a / (a + b); };

function possExpect(A, D) {
  const pt = pressP(A, D);
  const pp = (1 - pt) * progressP(A, D);
  const xg = chanceXg(A), bp = bigP(A, D);
  const forA = pp * ((1 - bp) * goalP(xg, D) + bp * goalP(Math.min(0.6, xg * 3.2), D));
  const failed = (1 - pt) - pp;
  // Must match simHalf beat for beat: a steal only becomes a shot with Gegenpress 4+ (60%).
  const againstA = pt * (D.h.pressXg ? 0.6 * goalP(0.1 + D.h.pressXg, A) : 0) + failed * counterP(D) * goalP(0.13, A);
  return { forA, againstA };
}

// Expected goals for one half.
export function halfXg(Y, O) {
  const share = possShare(Y, O), n = POSS_PER_HALF;
  const ey = possExpect(Y, O), eo = possExpect(O, Y);
  let xY = n * (share * ey.forA + (1 - share) * eo.againstA);
  let xO = n * ((1 - share) * eo.forA + share * ey.againstA);
  if (Y.h.setPiece) xY += goalP(Y.h.setPiece, O);
  if (O.h.setPiece) xO += goalP(O.h.setPiece, Y);
  return { share, xY, xO };
}

// Exact score distribution of the rest of the match, built from the same odds
// simHalf rolls: each possession ends with at most one goal (either side), plus
// one corner per half for a side with an Intensity set piece.
function halfDist(Y, O) {
  const share = possShare(Y, O), ey = possExpect(Y, O), eo = possExpect(O, Y);
  const pY = share * ey.forA + (1 - share) * eo.againstA;
  const pO = (1 - share) * eo.forA + share * ey.againstA;
  const steps = Array(POSS_PER_HALF).fill([pY, pO]);
  if (Y.h.setPiece) steps.push([goalP(Y.h.setPiece, O), 0]);
  if (O.h.setPiece) steps.push([0, goalP(O.h.setPiece, Y)]);
  return steps;
}
export function projectMatch(you, opp, score, fromHalf) {
  let lY = 0, lO = 0, share = 0, n = 0;
  let dist = new Map([['0,0', 1]]);
  for (let hf = fromHalf; hf <= 2; hf++) {
    const Y = teamStats(you, hf), O = teamStats(opp, hf);
    const r = halfXg(Y, O);
    lY += r.xY; lO += r.xO; share += r.share; n++;
    for (const [py, po] of halfDist(Y, O)) {
      const next = new Map();
      for (const [k, p] of dist) {
        const [a, b] = k.split(',').map(Number);
        const add = (kk, q) => next.set(kk, (next.get(kk) || 0) + q);
        add(`${a + 1},${b}`, p * py); add(`${a},${b + 1}`, p * po); add(k, p * (1 - py - po));
      }
      dist = next;
    }
  }
  let w = 0, d = 0, l = 0;
  for (const [k, p] of dist) {
    const [a, b] = k.split(',').map(Number);
    const A = score[0] + a, B = score[1] + b;
    if (A > B) w += p; else if (A === B) d += p; else l += p;
  }
  return { w, d, l, xgY: lY, xgO: lO, share: share / Math.max(1, n) };
}

// ---------------------------------------------------------------- causes
// The biggest synergy or placement bonus behind a stat (or hook), so the
// match can name it on the contact frame: { label, who: [slots], amt } or null.
// Every bonus behind a stat (or hook), biggest first: [{ label, who: [slots], amt, link }].
// The game credits the first one whose players actually took part in the beat.
export function causes(T, keys, min = 0.75) {
  const ks = [].concat(keys);
  const by = new Map();
  for (const x of T.src) {
    const amt = ks.reduce((a, k) => a + (x.fx[k] > 0 ? x.fx[k] * (k === 'counter' || k === 'pressXg' || k === 'big' || k === 'setPiece' ? 20 : 1) : 0), 0);
    if (amt <= 0) continue;
    const cur = by.get(x.label) || { label: x.label, who: [], amt: 0, link: x.link };
    cur.amt += amt;
    cur.who = [...new Set([...cur.who, ...x.who])];
    by.set(x.label, cur);
  }
  return [...by.values()].filter((c) => c.amt >= min).sort((a, b) => b.amt - a.amt);
}
export const cause = (T, keys, min) => causes(T, keys, min)[0] || null;

// ---------------------------------------------------------------- half script
// Returns possessions: { min, side, beats:[...] }. Every beat names the side it
// favours, its odds (p) and, where one applies, the synergy or placement that
// tipped it (cause). The game writes the log on the contact frame, not here.
// beats: build, press(side=presser), progress, blocked(side=defender), counter,
//        corner, shot{who, result, p, tag, cause, header}
export function simHalf(you, opp, half) {
  const Y = teamStats(you, half), O = teamStats(opp, half);
  const st = { you: Y, opp: O };
  const boards = { you: you.board, opp: opp.board };
  const share = possShare(Y, O);
  const out = [];
  const startMin = half === 1 ? 0 : 45;
  const pickShooter = (side) => {
    const ps = boards[side].map((p, s) => p && { p, s }).filter(Boolean);
    if (!ps.length) return null;
    const w = ps.map(({ p, s }) => Math.pow(UNIT[p.id].char.stats.shoot, 2) * (lineOf(s) === 'front' ? 2 : lineOf(s) === 'mid' ? 0.8 : 0.25) * (p.star === 2 ? 1.4 : 1));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < ps.length; i++) { r -= w[i]; if (r <= 0) return ps[i].p; }
    return ps[0].p;
  };
  const other = (s) => (s === 'you' ? 'opp' : 'you');
  // xg: chance quality; keys: what made the chance (credited if it scores).
  const shotBeat = (side, xg, tag, keys, o = {}) => {
    const A = st[side], D = st[other(side)];
    const p = goalP(xg, D);
    const why = o.causes || causes(A, keys);
    const shooter = pickShooter(side);
    const r = Math.random();
    const result = r < p ? 'goal' : r < p + (1 - p) * 0.55 ? 'save' : 'miss';
    const keep = result === 'save' ? causes(D, 'gk', 0.5) : [];
    return { k: 'shot', side, who: shooter, result, p, tag, causes: result === 'goal' ? why : keep, header: !!o.header, post: result === 'miss' && Math.random() < 0.3 };
  };
  for (let i = 0; i < POSS_PER_HALF; i++) {
    const side = Math.random() < share ? 'you' : 'opp';
    const A = st[side], D = st[other(side)];
    const beats = [{ k: 'build', side, p: side === 'you' ? share : 1 - share, causes: causes(A, 'ctrl', 1.5) }];
    const pt = pressP(A, D);
    if (Math.random() < pt) {
      beats.push({ k: 'press', side: other(side), p: pt, causes: causes(D, 'prs') });
      if (D.h.pressXg && Math.random() < 0.6) beats.push(shotBeat(other(side), 0.1 + D.h.pressXg, 'right after the steal', 'pressXg'));
    } else {
      const pp = progressP(A, D);
      if (Math.random() < pp) {
        const bp = bigP(A, D), big = Math.random() < bp;
        const xg = big ? Math.min(0.6, chanceXg(A) * 3.2) : chanceXg(A);
        beats.push({ k: 'progress', side, p: pp, causes: causes(A, 'atk'), big });
        beats.push(shotBeat(side, xg, big ? 'from a big chance' : '', big ? ['fin', 'big'] : 'fin'));
      } else {
        beats.push({ k: 'blocked', side: other(side), p: 1 - pp, causes: causes(D, 'def') });
        const cp = counterP(D);
        if (Math.random() < cp) {
          beats.push({ k: 'counter', side: other(side), p: cp, causes: causes(D, 'counter') });
          beats.push(shotBeat(other(side), 0.13, 'on the break', 'fin'));
        }
      }
    }
    out.push({ side, beats });
  }
  // Intensity set pieces: one corner per half, as its own possession.
  for (const side of ['you', 'opp']) {
    const A = st[side];
    if (!A.h.setPiece) continue;
    const i = 2 + Math.floor(Math.random() * (out.length - 3));
    const why = causes(A, 'setPiece', 0.1);
    out.splice(i, 0, { side, beats: [
      { k: 'build', side, p: 1, causes: [] },
      { k: 'corner', side, p: goalP(A.h.setPiece, st[other(side)]), causes: why },
      shotBeat(side, A.h.setPiece, 'with a header from the corner', 'setPiece', { causes: why, header: true }),
    ] });
  }
  out.forEach((poss, i) => { poss.min = startMin + Math.round(((i + 0.5) / out.length) * 45); });
  return { poss: out, Y, O, share };
}
const f1 = (v) => (Math.round(v * 10) / 10).toString();
export { f1 };
