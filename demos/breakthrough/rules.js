// Breakthrough Puzzles: pure, deterministic rules. Shared by the game (game.js)
// and the node solver (solve.mjs) so the two can never drift.
//
// Grid: W columns x H rows. Row 0 is the enemy goal line; the goal mouth sits
// above row 0 on columns GOAL_L..GOAL_R. Rows 0..ZONE-1 are the scoring zone.
//
// Your turn: each attacker may move once (up to 2 king steps through empty
// cells). The TEAM may make one pass per turn, along a straight or diagonal
// line with no player in between. Moves and the pass can come in any order, so
// a receiver who has not moved yet can still run after the pass. Shoot any time
// the carrier stands in the zone with a clear lane. End the turn: defenders
// walk the paths they telegraphed at the start of the turn (an attacker in the
// way stops them). If the carrier is then next to a defender, you lose the
// ball. Run out of turns and you lose too.

export const W = 5, H = 7, GOAL_L = 1, GOAL_R = 3, ZONE = 3;

const DIRS8 = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
export const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
export const inside = (x, y) => x >= 0 && x < W && y >= 0 && y < H;
const key = (c) => c.x + c.y * W;
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

export const DEF_TYPES = {
  def:     { name: 'Defender',    letter: 'd', char: ['hans', 'marisol', 'rocco', 'zed', 'viper'], tip: 'Steps 1 square toward where the ball was when your turn began.' },
  fast:    { name: 'Sprinter',    letter: 'f', char: ['kofi'], tip: 'Steps 2 squares toward the ball.' },
  marker:  { name: 'Man-marker',  letter: 'm', char: ['lu'], tip: 'Ignores the ball. Steps 2 toward the attacker he marks.' },
  sweeper: { name: 'Sweeper',     letter: 's', char: ['nils'], tip: 'Only slides sideways along his row, 2 squares toward the ball column.' },
  giant:   { name: 'Slow giant',  letter: 'g', char: ['dima'], tip: 'Steps 1 square, but only on turns 1 and 3. Rests on turn 2.' },
  keeper:  { name: 'Keeper',      letter: 'k', char: ['oskar'], tip: 'Slides 1 toward the ball. Covers his column ±1.' },
};
const BY_LETTER = Object.fromEntries(Object.entries(DEF_TYPES).map(([t, d]) => [d.letter, t]));

// Puzzle format: { id, name, turns, map: [7 strings of 5 chars], ball: '1',
//   cast: { 1: 'rio', 2: 'kenji' }, mark: { m: '2' } , hint }
// map chars: '.' empty, '1'..'4' attackers, d f m s g k defenders.
export function parse(p) {
  const att = [], def = [];
  const used = {};
  p.map.forEach((row, y) => {
    [...row.replace(/\s/g, '')].forEach((ch, x) => {
      if (/[1-4]/.test(ch)) att.push({ tag: ch, x, y, moved: false, id: p.cast?.[ch] || 'rio' });
      else if (BY_LETTER[ch]) {
        const type = BY_LETTER[ch];
        const n = used[type] = (used[type] || 0) + 1;
        const chars = DEF_TYPES[type].char;
        def.push({ type, x, y, id: chars[(n - 1) % chars.length] });
      }
    });
  });
  att.sort((a, b) => a.tag.localeCompare(b.tag));
  for (const d of def) if (d.type === 'marker') d.mark = att.findIndex((a) => a.tag === (p.mark || '1'));
  return { att, def, ball: att.findIndex((a) => a.tag === (p.ball || '1')) };
}

export function initState(p) {
  const { att, def, ball } = parse(p);
  const s = { turn: 1, turns: p.turns, att, def, ball, passUsed: false, status: 'play', reason: '' };
  s.plan = planDefenders(s);
  s.aim = { x: att[ball].x, y: att[ball].y }; // the square defenders chase this turn
  return s;
}

export function clone(s) {
  return { ...s, att: s.att.map((a) => ({ ...a })), def: s.def.map((d) => ({ ...d })) };
}

function occupied(s) {
  const o = new Set();
  for (const a of s.att) o.add(key(a));
  for (const d of s.def) o.add(key(d));
  return o;
}

// Each defender's intended path (cells, excluding his start), fixed at the
// start of the turn from where the ball is now.
export function planDefenders(s) {
  const occ = occupied(s);
  const ball = s.att[s.ball];
  return s.def.map((d) => {
    occ.delete(key(d));
    const path = [];
    let cur = { x: d.x, y: d.y };
    let steps = 1;
    if (d.type === 'fast' || d.type === 'marker' || d.type === 'sweeper') steps = 2;
    if (d.type === 'giant' && s.turn % 2 === 0) steps = 0;
    const target = d.type === 'marker' ? s.att[d.mark] : ball;
    for (let i = 0; i < steps; i++) {
      const n = stepToward(d.type, cur, target, occ);
      if (!n) break;
      path.push(n); cur = n;
    }
    occ.add(key(cur));
    return path;
  });
}

function stepToward(type, cur, target, occ) {
  if (type === 'keeper' || type === 'sweeper') {
    const tx = type === 'keeper' ? clampN(target.x, GOAL_L, GOAL_R) : target.x;
    if (cur.x === tx) return null;
    if (type === 'sweeper' && cheb(cur, target) <= 1) return null;
    const n = { x: cur.x + Math.sign(tx - cur.x), y: cur.y };
    return occ.has(key(n)) ? null : n;
  }
  const d0 = cheb(cur, target);
  if (d0 <= 1) return null;
  let best = null, bd = Infinity;
  for (const [dx, dy] of DIRS8) {
    const n = { x: cur.x + dx, y: cur.y + dy };
    if (!inside(n.x, n.y) || occ.has(key(n))) continue;
    const c = cheb(n, target);
    if (c >= d0) continue;
    const e = c * 100 + (n.x - target.x) ** 2 + (n.y - target.y) ** 2;
    if (e < bd) { bd = e; best = n; }
  }
  return best;
}

// Where every defender would end up if you ended the turn right now.
export function previewDefenders(s) {
  const occ = occupied(s);
  return s.def.map((d, i) => {
    occ.delete(key(d));
    const walked = [];
    let cur = { x: d.x, y: d.y };
    let blockedAt = null;
    for (const c of s.plan[i]) {
      if (occ.has(key(c))) { blockedAt = c; break; }
      walked.push(c); cur = c;
    }
    occ.add(key(cur));
    return { from: { x: d.x, y: d.y }, to: cur, walked, blockedAt };
  });
}

export function tacklersAfter(s, prev = previewDefenders(s)) {
  const c = s.att[s.ball];
  return prev.map((p, i) => (cheb(p.to, c) <= 1 ? i : -1)).filter((i) => i >= 0);
}

export function moveTargets(s, i) {
  const a = s.att[i];
  if (!a || a.moved || s.status !== 'play') return [];
  const occ = occupied(s);
  const seen = new Map([[key(a), 0]]);
  let frontier = [a];
  for (let step = 1; step <= 2; step++) {
    const next = [];
    for (const c of frontier) {
      for (const [dx, dy] of DIRS8) {
        const n = { x: c.x + dx, y: c.y + dy };
        if (!inside(n.x, n.y) || occ.has(key(n)) || seen.has(key(n))) continue;
        seen.set(key(n), step); next.push(n);
      }
    }
    frontier = next;
  }
  const out = [];
  for (const [k, st] of seen) if (st > 0) out.push({ x: k % W, y: Math.floor(k / W) });
  return out;
}

// Cells strictly between a and b on a straight/diagonal line, or null.
export function lineBetween(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (!(dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy))) return null;
  const n = Math.max(Math.abs(dx), Math.abs(dy));
  const sx = Math.sign(dx), sy = Math.sign(dy);
  const cells = [];
  for (let k = 1; k < n; k++) cells.push({ x: a.x + sx * k, y: a.y + sy * k });
  return cells;
}

export function passTargets(s) {
  if (s.passUsed || s.status !== 'play') return [];
  const occ = occupied(s);
  const c = s.att[s.ball];
  const out = [];
  s.att.forEach((a, j) => {
    if (j === s.ball) return;
    const between = lineBetween(c, a);
    if (!between) return;
    if (between.some((b) => occ.has(key(b)))) return;
    out.push(j);
  });
  return out;
}

// Why a pass to j is illegal (for UI messages).
export function passProblem(s, j) {
  if (s.passUsed) return 'You already used this turn\'s pass.';
  const c = s.att[s.ball], a = s.att[j];
  const between = lineBetween(c, a);
  if (!between) return 'Passes go in straight or diagonal lines only.';
  const occ = occupied(s);
  if (between.some((b) => occ.has(key(b)))) return 'Someone is standing on that passing line.';
  return '';
}

// Shot lanes from the carrier: straight up, or diagonal up-left / up-right,
// crossing the goal line between the posts. Every cell on the way must be
// empty, and the crossing cell must be out of the keeper's reach (his column
// and one either side). A centred keeper therefore covers the whole goal.
export function shotLanes(s) {
  const c = s.att[s.ball];
  const res = { inZone: c.y < ZONE, lanes: [], blocked: [] };
  if (!res.inZone || s.status !== 'play') return res;
  const occ = occupied(s);
  occ.delete(key(c));
  const keeper = s.def.find((d) => d.type === 'keeper');
  for (const dx of [0, -1, 1]) {
    const gx = c.x + dx * (c.y + 1);
    if (gx < GOAL_L || gx > GOAL_R) continue;
    const cells = [];
    for (let k = 1; k <= c.y; k++) cells.push({ x: c.x + dx * k, y: c.y - k });
    const cross = c.y === 0 ? { x: c.x, y: 0 } : cells[cells.length - 1];
    if (cross.x < GOAL_L || cross.x > GOAL_R) continue; // must cross the line between the posts
    const hit = cells.find((b) => occ.has(key(b)));
    const lane = { dx, cells, goal: { x: gx, y: -1 }, cross };
    if (hit) { res.blocked.push({ ...lane, why: 'body', at: hit }); continue; }
    if (keeper && Math.abs(cross.x - keeper.x) <= 1) { res.blocked.push({ ...lane, why: 'keeper', at: { x: keeper.x, y: keeper.y } }); continue; }
    res.lanes.push(lane);
  }
  return res;
}

// ---- actions: {t:'move', i, x, y} | {t:'pass', j} | {t:'shoot'} | {t:'end'}
export function legalActions(s) {
  if (s.status !== 'play') return [];
  const out = [];
  if (shotLanes(s).lanes.length) out.push({ t: 'shoot' });
  for (const j of passTargets(s)) out.push({ t: 'pass', j });
  s.att.forEach((a, i) => { for (const c of moveTargets(s, i)) out.push({ t: 'move', i, x: c.x, y: c.y }); });
  out.push({ t: 'end' });
  return out;
}

// Returns { state, info } or null when illegal. info carries what happened,
// for animation and the event log.
export function apply(s, a) {
  if (s.status !== 'play') return null;
  if (a.t === 'move') {
    if (!moveTargets(s, a.i).some((c) => c.x === a.x && c.y === a.y)) return null;
    const n = clone(s);
    n.att[a.i].x = a.x; n.att[a.i].y = a.y; n.att[a.i].moved = true;
    return { state: n, info: { from: { x: s.att[a.i].x, y: s.att[a.i].y } } };
  }
  if (a.t === 'pass') {
    if (!passTargets(s).includes(a.j)) return null;
    const n = clone(s);
    n.ball = a.j; n.passUsed = true;
    return { state: n, info: { from: s.ball } };
  }
  if (a.t === 'shoot') {
    const lanes = shotLanes(s).lanes;
    if (!lanes.length) return null;
    const n = clone(s);
    n.status = 'won';
    return { state: n, info: { lane: lanes[0] } };
  }
  if (a.t === 'end') {
    const prev = previewDefenders(s);
    const n = clone(s);
    prev.forEach((p, i) => { n.def[i].x = p.to.x; n.def[i].y = p.to.y; });
    const tacklers = tacklersAfter(s, prev);
    // name the attacker who body-blocks each stopped defender, so the view can show the contact
    const blockers = prev.map((p) => (p.blockedAt ? s.att.findIndex((a) => a.x === p.blockedAt.x && a.y === p.blockedAt.y) : -1));
    const info = { moves: prev, tacklers, blockers };
    if (tacklers.length) { n.status = 'lost'; n.reason = 'tackled'; return { state: n, info }; }
    if (n.turn >= n.turns) { n.status = 'lost'; n.reason = 'time'; return { state: n, info }; }
    n.turn++;
    n.passUsed = false;
    n.att.forEach((x) => { x.moved = false; });
    n.plan = planDefenders(n);
    n.aim = { x: n.att[n.ball].x, y: n.att[n.ball].y };
    return { state: n, info };
  }
  return null;
}

export function stateKey(s) {
  let k = s.turn + '|' + s.ball + (s.passUsed ? 'p' : '') + '|';
  for (const a of s.att) k += key(a) + (a.moved ? 'm' : '') + ',';
  k += '|';
  for (const d of s.def) k += key(d) + ',';
  k += '|';
  for (const p of s.plan) k += p.map(key).join('.') + ',';
  return k;
}

// Cells from which a shot would beat the keeper where he stands now
// (ignores bodies in the lane). Used for the gold "shoot from here" tint.
export function openScoringCells(s) {
  const keeper = s.def.find((d) => d.type === 'keeper');
  const out = [];
  for (let y = 0; y < ZONE; y++) for (let x = 0; x < W; x++) {
    for (const dx of [0, -1, 1]) {
      const gx = x + dx * (y + 1), cx = x + dx * y;
      if (gx < GOAL_L || gx > GOAL_R || cx < GOAL_L || cx > GOAL_R) continue;
      if (keeper && Math.abs(cx - keeper.x) <= 1) continue;
      out.push({ x, y }); break;
    }
  }
  return out;
}

// Solver prune (admissible): on the last turn, someone who can still get the
// ball must still be able to reach an open scoring cell.
function couldStillScore(s) {
  if (s.turn < s.turns) return true;
  const cells = openScoringCells(s);
  if (!cells.length) return false;
  return s.att.some((a, j) => {
    if (j !== s.ball && s.passUsed) return false;
    const reach = a.moved ? 0 : 2;
    return cells.some((c) => cheb(a, c) <= reach);
  });
}

// 0-1 BFS: minimum number of actions (move/pass/shoot cost 1, end turn free).
export function solve(p, { maxStates = 3e6 } = {}) {
  const s0 = initState(p);
  const seen = new Map([[stateKey(s0), 0]]);
  let cur = [{ s: s0, a: null, up: null }], nxt = [];
  let cost = 0, states = 0;
  const unwind = (node, last) => { const out = [last]; for (let n = node; n && n.a; n = n.up) out.push(n.a); return out.reverse(); };
  while (cur.length || nxt.length) {
    if (!cur.length) { cur = nxt; nxt = []; cost++; continue; }
    const node = cur.pop();
    if ((seen.get(stateKey(node.s)) ?? Infinity) < cost) continue;
    if (++states > maxStates) return { solved: false, aborted: true, states };
    for (const a of legalActions(node.s)) {
      const r = apply(node.s, a);
      if (!r) continue;
      if (r.state.status === 'won') return { solved: true, par: cost + 1, path: unwind(node, a), turns: r.state.turn, states };
      if (r.state.status !== 'play') continue;
      if (!couldStillScore(r.state)) continue;
      const c = a.t === 'end' ? cost : cost + 1;
      const k = stateKey(r.state);
      if ((seen.get(k) ?? Infinity) <= c) continue;
      seen.set(k, c);
      (a.t === 'end' ? cur : nxt).push({ s: r.state, a, up: node });
    }
  }
  return { solved: false, states };
}

export function describe(s, a) {
  const n = (i) => s.att[i]?.id;
  if (a.t === 'move') return `move ${n(a.i)}→${a.x},${a.y}`;
  if (a.t === 'pass') return `pass→${n(a.j)}`;
  return a.t;
}
