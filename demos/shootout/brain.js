// Shootout Minds: the odds model and the two "minds".
//  - Oskar (rival keeper) learns where YOU shoot.
//  - Each rival kicker has a habit; Marisol learns where YOU dive.
// Everything shown to the player is computed from these same functions.

export const COLS = ['left', 'middle', 'right'];
export const ROWS = ['top', 'low'];
export const COL_SHORT = ['L', 'M', 'R'];
export const cellName = (c, r) => `${ROWS[r]} ${COLS[c]}`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const norm = (a) => { const s = a.reduce((x, y) => x + y, 0) || 1; return a.map((x) => x / s); };

export const TELL_TRUTH = 0.65;

// Chance the shot is on target at all (power can sail over).
export function onTarget(col, row, type, shooter) {
  let p = type === 'power' ? (row === 0 ? 0.74 : 0.94) : row === 0 ? (col === 1 ? 0.97 : 0.9) : 0.97;
  p += ((shooter?.stats.shoot ?? 7) - 7) * 0.02;
  return clamp(p, 0.5, 0.99);
}
// Chance the keeper stops it when he went to the right column.
export function saveIfRightCol(rowMatch, type) {
  return type === 'power' ? (rowMatch ? 0.55 : 0.28) : rowMatch ? 0.8 : 0.42;
}
export function pGoalVs(col, row, type, dive, shooter) {
  const on = onTarget(col, row, type, shooter);
  // A low shot down the middle can still clip the trailing legs of a diving keeper.
  if (dive.col !== col) return col === 1 && row === 1 ? on * 0.85 : on;
  return on * (1 - saveIfRightCol(dive.row === row, type));
}

// ------------------------------------------------------------------ Oskar
export class Oskar {
  constructor(hist = [], dives = []) { this.hist = [...hist]; this.dives = [...dives]; }
  get n() { return this.hist.length; }
  // How strongly he trusts his notes: grows with every kick he has seen.
  get sharp() { return Math.min(1.9, 0.5 + 0.35 * this.n); }
  repeatRate() {
    const n = this.n; if (n < 2) return null;
    let reps = 0; for (let i = 1; i < n; i++) if (this.hist[i].col === this.hist[i - 1].col) reps++;
    return { reps, of: n - 1, rate: (reps + 0.5) / (n - 1 + 1.5) };
  }
  colCounts() { const f = [0, 0, 0]; this.hist.forEach((h) => f[h.col]++); return f; }
  colDist() {
    const f = this.colCounts().map((x, i) => x + (i === 1 ? 0.4 : 0.8));
    const rr = this.repeatRate();
    let p = f;
    if (rr) {
      const last = this.hist[this.n - 1].col;
      p = p.map((x, c) => x * 3 * (c === last ? rr.rate : (1 - rr.rate) / 2));
    }
    // He never fully commits: a fifth of the time he just follows his gut.
    const model = norm(p.map((x) => Math.pow(x, this.sharp)));
    return model.map((v, i) => 0.8 * v + 0.2 * (i === 1 ? 0.2 : 0.4));
  }
  rowDist() {
    const top = this.hist.filter((h) => h.row === 0).length;
    const p = [top + 1, this.n - top + 1];
    return norm(p.map((x) => Math.pow(x, Math.min(1.8, this.sharp * 0.8))));
  }
  cover() { // probability he covers each cell [row][col]
    const c = this.colDist(), r = this.rowDist();
    return [0, 1].map((ri) => c.map((cv) => cv * r[ri]));
  }
  pick() {
    const c = sample(this.colDist()), r = sample(this.rowDist());
    return { col: c, row: r };
  }
  goalOdds(col, row, type, shooter) {
    const c = this.colDist(), r = this.rowDist();
    let s = 0;
    for (let dc = 0; dc < 3; dc++) for (let dr = 0; dr < 2; dr++) s += c[dc] * r[dr] * pGoalVs(col, row, type, { col: dc, row: dr }, shooter);
    return s;
  }
  // One-line reading of what he expects, for the odds line.
  lean() {
    const c = this.colDist();
    const best = c.indexOf(Math.max(...c));
    return { col: best, p: c[best] };
  }
  record(kick, dive) { this.hist.push(kick); this.dives.push(dive); }
}

// ------------------------------------------------------------------ rival kickers
// cells: [row][col] weights. power: chance of a power shot. ctx = { wakDives, lastTheirKick, lastTheirGoal }
const G = (tl, tm, tr, ll, lm, lr) => [[tl, tm, tr], [ll, lm, lr]];
export const KICKERS = {
  viper: { note: 'Viper loves the top corners, and places it.', power: 0.15, cells: () => G(0.3, 0.05, 0.3, 0.12, 0.08, 0.15) },
  kofi: { note: 'Kofi blasts it, usually down the middle.', power: 0.85, cells: () => G(0.08, 0.22, 0.08, 0.14, 0.34, 0.14) },
  marisol: {
    note: 'Marisol is cool: she shoots away from where you dive most.', power: 0.1,
    cells: (x) => { const d = [0, 0, 0]; x.wakDives.forEach((v) => d[v.col]++); const w = d.map((k, i) => 1 / Math.pow(k + 1, 1.6) * (i === 1 ? 0.6 : 1)); return [w.map((v) => v * 0.4), w.map((v) => v * 0.6)]; },
    live: (x) => { const d = [0, 0, 0]; x.wakDives.forEach((v) => d[v.col]++); return `You've dived L ${d[0]} · M ${d[1]} · R ${d[2]}.`; },
  },
  zed: {
    note: 'Zed goes opposite to the previous Redrock kick.', power: 0.4,
    cells: (x) => { const l = x.lastTheirKick?.col; const w = l == null ? [1, 0.6, 1] : l === 0 ? [0.12, 0.13, 0.75] : l === 2 ? [0.75, 0.13, 0.12] : [0.45, 0.1, 0.45]; return [w.map((v) => v * 0.45), w.map((v) => v * 0.55)]; },
    live: (x) => (x.lastTheirKick ? `Last Redrock kick went ${COLS[x.lastTheirKick.col]}.` : 'He is the first Redrock kicker.'),
  },
  rocco: { note: 'Rocco the fox rolls it low into the corners.', power: 0.2, cells: () => G(0.05, 0.05, 0.05, 0.38, 0.09, 0.38) },
  nils: {
    note: 'Nils copies the last Redrock kick that scored.', power: 0.3,
    cells: (x) => { const k = x.lastTheirGoal; if (!k) return G(1, 0.5, 1, 1, 0.5, 1); const g = G(0.04, 0.04, 0.04, 0.04, 0.04, 0.04); g[k.row][k.col] = 0.8; return g; },
    live: (x) => (x.lastTheirGoal ? `Last Redrock goal: ${cellName(x.lastTheirGoal.col, x.lastTheirGoal.row)}.` : 'No Redrock goal to copy yet.'),
  },
  hans: { note: 'Iron Hans: power, straight down the middle.', power: 0.9, cells: () => G(0.05, 0.25, 0.05, 0.1, 0.45, 0.1) },
  lu: { note: 'Spider Lu likes the right side.', power: 0.3, cells: () => G(0.08, 0.06, 0.3, 0.12, 0.08, 0.36) },
  dima: { note: 'Dima has no habit on file. Pure guess.', power: 0.5, cells: () => G(1, 1, 1, 1, 1, 1) },
  oskar: { note: 'Big Oskar himself. Power, always.', power: 1, cells: () => G(0.1, 0.25, 0.1, 0.15, 0.25, 0.15) },
};

export function kickerPrior(id, ctx) {
  const k = KICKERS[id];
  const cells = k.cells(ctx);
  const s = cells.flat().reduce((a, b) => a + b, 0);
  return { cells: cells.map((r) => r.map((v) => v / s)), power: k.power };
}
// What you can infer: profile prior × the tells.
export function kickerPosterior(prior, tellCol, tellPower) {
  const lie = (1 - TELL_TRUTH) / 2;
  const cells = prior.cells.map((r) => r.map((v, c) => v * (c === tellCol ? TELL_TRUTH : lie)));
  const s = cells.flat().reduce((a, b) => a + b, 0);
  const pp = prior.power * (tellPower ? TELL_TRUTH : 1 - TELL_TRUTH);
  const pl = (1 - prior.power) * (tellPower ? 1 - TELL_TRUTH : TELL_TRUTH);
  return { cells: cells.map((r) => r.map((v) => v / s)), power: pp / (pp + pl) };
}
// Chance Wak stops it if he covers (col,row): saves + misses.
export function stopOdds(post, col, row, shooter) {
  let s = 0;
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
    for (const [type, pt] of [['power', post.power], ['placed', 1 - post.power]]) {
      s += post.cells[r][c] * pt * (1 - pGoalVs(c, r, type, { col, row }, shooter));
    }
  }
  return s;
}
export function sampleKick(prior) {
  const flat = prior.cells.flat();
  const i = sample(flat);
  return { col: i % 3, row: (i / 3) | 0, type: Math.random() < prior.power ? 'power' : 'placed' };
}
export function sample(p) { let r = Math.random(); for (let i = 0; i < p.length; i++) { r -= p[i]; if (r <= 0) return i; } return p.length - 1; }
