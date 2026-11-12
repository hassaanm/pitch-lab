// Grid Tactics: pure rules + AI (no DOM). game.js animates what this decides.
//
// Grid: 7 columns x 11 rows over a vertical pitch. Row 0 touches Redrock's
// goal (top); Sunbirds attack UP. Row 10 touches our goal. Goals span cols 2-4.
import { byId } from '../../shared/cast.js';

export const COLS = 7, ROWS = 11, MID = 5;
export const GOAL_C = 3;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const k = (x, y) => x + ',' + y;
const enemyOf = (t) => (t === 'sun' ? 'red' : 'sun');
export const stats = (u) => byId[u.id].stats;
export const name = (u) => byId[u.id].name;

// ---------------------------------------------------------------- basics
export function unitAt(G, x, y) { return G.units.find((u) => u.x === x && u.y === y); }
export function carrier(G) { return G.units.find((u) => u.id === G.ball.owner) || null; }
export function ballPos(G) { const c = carrier(G); return c ? { x: c.x, y: c.y } : { x: G.ball.x, y: G.ball.y }; }
export const inGrid = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS;

// Move range from pace: 4-5 -> 2, 6-9 -> 3, 10 -> 4. A great dribbler (8+)
// moves 1 further with the ball.
export function moveRange(G, u) {
  const s = stats(u);
  let r = 1 + Math.round(s.pace / 4);
  if (G.ball.owner === u.id && s.dribble >= 8) r += 1;
  return Math.max(1, r);
}

function inOwnBox(u, x, y) {
  if (u.role !== 'GK') return true;
  return x >= 1 && x <= 5 && (u.team === 'sun' ? y >= 8 : y <= 2);
}

// Cells next to an enemy (8-neighbour). Entering one ends your move, unless
// you have the ball: a carrier may dribble past (but risks a standing tackle).
export function zoc(G, team) {
  const s = new Set();
  for (const e of G.units) {
    if (e.team === team) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) s.add(k(e.x + dx, e.y + dy));
  }
  return s;
}

// BFS over 4-neighbour steps. Returns Map key -> {x, y, path:[cells], stopped}
export function reach(G, u) {
  const out = new Map();
  if (u.moved || u.acted || u.dazed) return out;
  const range = moveRange(G, u);
  const z = zoc(G, u.team);
  const loose = G.ball.owner ? null : G.ball;
  const start = { x: u.x, y: u.y, path: [] };
  const seen = new Set([k(u.x, u.y)]);
  let frontier = [start];
  for (let step = 1; step <= range; step++) {
    const next = [];
    for (const c of frontier) {
      for (const [dx, dy] of [[0, -1], [1, 0], [-1, 0], [0, 1]]) {
        const x = c.x + dx, y = c.y + dy, kk = k(x, y);
        if (!inGrid(x, y) || seen.has(kk) || unitAt(G, x, y) || !inOwnBox(u, x, y)) continue;
        seen.add(kk);
        const cell = { x, y, path: [...c.path, { x, y }], stopped: z.has(kk) && G.ball.owner !== u.id };
        out.set(kk, cell);
        const pickup = loose && loose.x === x && loose.y === y;
        if (!cell.stopped && !pickup) next.push(cell);
      }
    }
    frontier = next;
  }
  return out;
}

// Offside line for the attacking team: the row of the second-last defender.
export function offsideRow(G, attTeam) {
  const rows = G.units.filter((u) => u.team !== attTeam).map((u) => u.y).sort((a, b) => (attTeam === 'sun' ? a - b : b - a));
  return rows[1] ?? (attTeam === 'sun' ? 0 : ROWS - 1);
}
export function isOffside(G, u, ball = ballPos(G)) {
  const line = offsideRow(G, u.team);
  if (u.team === 'sun') return u.y < MID && u.y < line && u.y < ball.y;
  return u.y > MID && u.y > line && u.y > ball.y;
}

// ---------------------------------------------------------------- odds
function segDist(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const L2 = vx * vx + vy * vy || 1;
  const t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2;
  const tc = clamp(t, 0, 1);
  return { d: Math.hypot(a.x + vx * tc - p.x, a.y + vy * tc - p.y), t };
}

// Pass ≈ 0.97 − 0.035·dist − 0.27·(defenders near the line) + passing skill.
export function passOdds(G, from, to, { needle = false } = {}) {
  const passer = unitAt(G, from.x, from.y) || carrier(G);
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const interceptors = [];
  for (const e of G.units) {
    if (e.team === passer.team || e.dazed) continue;
    const { d, t } = segDist(e, from, to);
    if (t > 0.08 && t <= 1.12 && d <= 0.85) interceptors.push({ u: e, d, t });
  }
  interceptors.sort((a, b) => a.t - b.t);
  const skill = (stats(passer).pass - 6) * 0.015;
  const n = needle ? 0 : interceptors.length;
  const p = clamp(0.97 - 0.035 * dist - 0.27 * n + skill, 0.08, 0.97);
  const recv = unitAt(G, to.x, to.y);
  const offside = recv && recv.team === passer.team ? isOffside(G, recv, from) : false;
  return { p, dist, interceptors: needle ? [] : interceptors.map((i) => i.u), offside, recv, skill };
}

// Shot ≈ (shoot/10) · reach(dist) · angle − keeper set − 0.12 per adjacent defender.
// reach() falls off steeply past ~4 squares (0.80 at 2, 0.48 at 4, 0.13 at 5.5),
// and angle is how much of the goal mouth you can see (posts at x = 1.5 and 4.5),
// relative to a central shot from the edge of the box, floored at 0.2.
export const shotReach = (d) => 0.85 / (1 + Math.exp((d - 4.2) * 1.3));
export function shotAngle(u) {
  const gy = u.team === 'sun' ? -0.5 : ROWS - 0.5;
  const dy = Math.max(0.3, Math.abs(u.y - gy));
  const th = Math.abs(Math.atan2(GOAL_C + 1.5 - u.x, dy) - Math.atan2(GOAL_C - 1.5 - u.x, dy));
  return clamp(th / 0.9, 0.2, 1);
}
export function shotOdds(G, u, { eagle = false } = {}) {
  const s = stats(u);
  const gy = u.team === 'sun' ? -0.5 : ROWS - 0.5;
  const dist = Math.hypot(u.x - GOAL_C, u.y - gy);
  const angle = shotAngle(u);
  const gk = G.units.find((e) => e.team !== u.team && e.role === 'GK');
  const lineRows = u.team === 'sun' ? [0, 1] : [ROWS - 2, ROWS - 1];
  const keeperSet = !!gk && !gk.dazed && lineRows.includes(gk.y) && Math.abs(gk.x - GOAL_C) <= 1;
  const keeperPen = keeperSet ? 0.10 + (byId[gk.id].stats.keep - 7) * 0.02 : 0;
  const pressure = G.units.filter((e) => e.team !== u.team && e.role !== 'GK' && cheb(e, u) <= 1).length;
  let p = (s.shoot / 10) * shotReach(dist) * angle - keeperPen - 0.12 * pressure + (eagle ? 0.2 : 0);
  p = clamp(p, 0.03, 0.85);
  return { p, dist, angle, keeperSet, keeperPen, pressure, gk };
}

// A tackle is a standing challenge: only a player who has not moved this turn.
export const canTackle = (u, c) => !!c && c.team !== u.team && !u.moved && !u.acted && !u.dazed && cheb(u, c) <= 1;

export function tackleOdds(tackler, target) {
  const a = stats(tackler).tackle, b = stats(target).dribble;
  return clamp((a / (a + b)) * 1.1, 0.1, 0.85);
}

// ---------------------------------------------------------------- AI
// Formation slots keep the shape; only one presser goes to the ball.
function slotFor(G, u, ball, attacking) {
  const bx = ball.x, by = ball.y;
  const down = u.team === 'red'; // red attacks down (+y)
  const fwd = (r) => (down ? r : ROWS - 1 - r); // mirror rows for sun
  const byN = down ? by : ROWS - 1 - by; // ball row seen from u's team (0 = own goal line)
  const side = G.units.filter((o) => o.team === u.team && o.role === u.role);
  const idx = side.indexOf(u);
  const sideOff = side.length > 1 ? (idx === 0 ? -1 : 1) : 0;
  let x, r;
  if (u.role === 'GK') { x = clamp(Math.round(GOAL_C + (bx - GOAL_C) * 0.4), 2, 4); r = 0; }
  else if (!attacking) {
    const shift = clamp(Math.round((bx - GOAL_C) * 0.5), -1, 1);
    if (u.role === 'DF') { x = GOAL_C + shift + sideOff * 1.5; r = clamp(byN - 2, 1, 4); }
    else if (u.role === 'MF') { x = clamp(bx, 1, 5); r = clamp(byN - 1, 2, 7); }
    else { x = clamp(GOAL_C + shift, 1, 5); r = clamp(byN + 1, 5, 7); }
  } else {
    if (u.role === 'DF') { x = GOAL_C + sideOff * 2; r = clamp(byN - 3, 1, 5); }
    else if (u.role === 'MF') { x = clamp(bx + (bx < GOAL_C ? 2 : -2), 1, 5); r = clamp(byN + 1, 3, 8); }
    else {
      const line = offsideRow(G, u.team);
      const lineN = down ? line : ROWS - 1 - line;
      x = bx <= GOAL_C ? 4 : 2; r = clamp(Math.max(byN + 2, lineN), 5, 9);
      r = Math.min(r, Math.max(lineN, byN));
    }
  }
  return { x: clamp(Math.round(x), 0, COLS - 1), y: fwd(clamp(r, 0, ROWS - 1)) };
}

function bestCellToward(G, u, target, score) {
  const cells = [...reach(G, u).values(), { x: u.x, y: u.y, path: [] }];
  let best = null, bv = -Infinity;
  for (const c of cells) {
    const v = (score ? score(c) : 0) - Math.hypot(c.x - target.x, c.y - target.y) * 1.0 - c.path.length * 0.01;
    if (v > bv) { bv = v; best = c; }
  }
  return best && (best.x !== u.x || best.y !== u.y) ? best : null;
}

// Decide one AI unit's move + action. Returns {move: cell|null, act: {...}|null, why}.
export function aiPlan(G, u) {
  const team = u.team, foe = enemyOf(team);
  const c = carrier(G);
  const ball = ballPos(G);
  const down = team === 'red';
  const progress = (y) => (down ? y : ROWS - 1 - y);

  // Loose ball: closest unit that can reach it takes it.
  if (!c) {
    const r = reach(G, u);
    const cell = r.get(k(ball.x, ball.y));
    const mates = G.units.filter((o) => o.team === team && !o.acted && !o.moved && !o.dazed && o.role !== 'GK');
    const nearest = mates.sort((a, b) => cheb(a, ball) - cheb(b, ball))[0];
    if (cell && (nearest === u || u.role === 'GK')) return { move: cell, act: null, why: 'loose ball' };
    if (nearest === u) return { move: bestCellToward(G, u, ball), act: null, why: 'chase loose ball' };
    return { move: bestCellToward(G, u, slotFor(G, u, ball, false)), act: null, why: 'shape' };
  }

  // Our ball.
  if (c.team === team) {
    if (c === u) return carrierPlan(G, u);
    const slot = slotFor(G, u, ball, true);
    const z = zoc(G, team);
    const open = (cell) => {
      const po = passOdds(G, ball, cell);
      return po.p * 2 - (z.has(k(cell.x, cell.y)) ? 0.6 : 0) - (isOffside(G, { ...u, x: cell.x, y: cell.y }) ? 3 : 0);
    };
    return { move: bestCellToward(G, u, slot, open), act: null, why: 'support' };
  }

  // Their ball: one presser, one lane-cover, the rest hold shape. A tackle needs
// a defender who starts his turn next to the carrier: the presser steps in
// this turn and can only tackle next turn, so the carrier gets a chance to react.
  const outfield = G.units.filter((o) => o.team === team && o.role !== 'GK' && !o.dazed);
  const byDist = [...outfield].sort((a, b) => cheb(a, c) - cheb(b, c) || progress(b.y) - progress(a.y));
  const presser = byDist[0];
  if (u === presser || cheb(u, c) <= 1 || (u.role === 'GK' && cheb(u, c) <= 2)) {
    if (cheb(u, c) <= 1) return { move: null, act: { t: 'tackle', target: c }, why: 'tackle' };
    // step next to the carrier, goal-side if possible
    const adj = [...reach(G, u).values()].filter((cell) => cheb(cell, c) <= 1);
    if (adj.length) {
      adj.sort((a, b) => progress(b.y) - progress(a.y));
      const goalSide = adj.sort((a, b) => (down ? a.y - b.y : b.y - a.y))[0];
      return { move: goalSide, act: null, why: 'press' };
    }
    return { move: bestCellToward(G, u, c), act: null, why: 'press' };
  }
  if (u === byDist[1]) {
    // cover the most dangerous pass: carrier -> most advanced attacker
    const threats = G.units.filter((o) => o.team === foe && o !== c && o.role !== 'GK');
    threats.sort((a, b) => (down ? b.y - a.y : a.y - b.y));
    const t = threats[0];
    if (t) {
      const mid = { x: Math.round((c.x + t.x) / 2), y: Math.round((c.y + t.y) / 2) };
      return { move: bestCellToward(G, u, mid), act: null, why: 'cover lane' };
    }
  }
  return { move: bestCellToward(G, u, slotFor(G, u, ball, false)), act: null, why: 'shape' };
}

function carrierPlan(G, u) {
  const down = u.team === 'red';
  const progress = (y) => (down ? y : ROWS - 1 - y);
  const foes = G.units.filter((o) => o.team !== u.team);
  const pressure = (cell) => foes.filter((f) => f.role !== 'GK' && cheb(f, cell) <= 1).length;
  // 1. shoot from here or after a move
  const here = { x: u.x, y: u.y, path: [] };
  const cells = [here, ...reach(G, u).values()];
  let bestShot = null;
  for (const cell of cells) {
    const sim = { ...G, units: G.units.map((o) => (o === u ? { ...o, x: cell.x, y: cell.y } : o)) };
    const so = shotOdds(sim, sim.units.find((o) => o.id === u.id));
    if (!bestShot || so.p > bestShot.p) bestShot = { p: so.p, cell };
  }
  if (bestShot && bestShot.p >= 0.18) return { move: bestShot.cell === here ? null : bestShot.cell, act: { t: 'shoot' }, why: `shot ${Math.round(bestShot.p * 100)}%` };
  // 2. pass forward if it is safe enough
  const mates = G.units.filter((o) => o.team === u.team && o !== u && o.role !== 'GK');
  let bestPass = null;
  for (const m of mates) {
    const po = passOdds(G, u, m);
    if (po.offside) continue;
    const gain = progress(m.y) - progress(u.y);
    const v = po.p * (1 + 0.22 * gain) - pressure(m) * 0.15;
    if (!bestPass || v > bestPass.v) bestPass = { v, m, po, gain };
  }
  const pressed = pressure(here) > 0;
  if (bestPass && bestPass.po.p >= 0.5 && (bestPass.gain >= 2 || (pressed && bestPass.gain >= -1))) {
    return { move: null, act: { t: 'pass', to: { x: bestPass.m.x, y: bestPass.m.y } }, why: 'pass' };
  }
  // 3. dribble forward away from pressure, then maybe shoot/pass
  let best = null, bv = -Infinity;
  for (const cell of cells) {
    const v = progress(cell.y) * 1.0 - pressure(cell) * 2.2 - Math.abs(cell.x - GOAL_C) * 0.15;
    if (v > bv) { bv = v; best = cell; }
  }
  if (best !== here) return { move: best, act: { t: 'after-dribble' }, why: 'dribble' };
  // 4. Boxed in: recycle the ball sideways or back instead of standing still,
  // so a passive defence still has to react every turn.
  if (bestPass && bestPass.po.p >= 0.6 && bestPass.gain >= -2) {
    return { move: null, act: { t: 'pass', to: { x: bestPass.m.x, y: bestPass.m.y } }, why: 'pass' };
  }
  return { move: null, act: { t: 'after-dribble' }, why: 'dribble' };
}

// After a dribble, decide whether to shoot or pass from the new cell.
export function afterDribble(G, u) {
  const so = shotOdds(G, u);
  if (so.p >= 0.18) return { t: 'shoot' };
  const down = u.team === 'red';
  const progress = (y) => (down ? y : ROWS - 1 - y);
  const mates = G.units.filter((o) => o.team === u.team && o !== u && o.role !== 'GK');
  let best = null;
  for (const m of mates) {
    const po = passOdds(G, u, m);
    if (po.offside || po.p < 0.6) continue;
    const gain = progress(m.y) - progress(u.y);
    if (gain >= 2 && (!best || gain > best.gain)) best = { m, gain };
  }
  if (best) return { t: 'pass', to: { x: best.m.x, y: best.m.y } };
  return null;
}
