// Combo Hand rules: deck, hand detection, pass links, coaches, scoring steps.
// Pure functions only (no DOM), so the live preview and the cascade use the
// exact same numbers.
import { byId } from '../../shared/cast.js';

export const SUITS = ['GK', 'DF', 'MF', 'FW'];
export const SUIT_NAME = { GK: 'Keeper', DF: 'Defender', MF: 'Midfield', FW: 'Forward' };
export const SUIT_CLS = { GK: 'defend', DF: 'skill', MF: 'power', FW: 'attack' };
export const ROW_V = { FW: 0.2, MF: 0.45, DF: 0.68, GK: 0.91 };

// Named stars of the Sunbirds; the rest of the squad is generated fillers.
const STARS = { GK11: 'wak', DF2: 'ada', DF4: 'tomo', DF5: 'mo', MF7: 'pip', MF8: 'lupe', MF10: 'kenji', FW9: 'bruno', FW10: 'sol', FW11: 'rio' };
const NAMES = ['Jun', 'Bea', 'Femi', 'Ola', 'Theo', 'Ines', 'Kai', 'Noor', 'Rafa', 'Mila', 'Sven', 'Yara', 'Dev', 'Lior', 'Cass', 'Omar', 'Tess', 'Nico', 'Zara', 'Ike', 'Luca', 'Remy', 'Ayo', 'Hana', 'Bo', 'Esme', 'Taj', 'Vik', 'Wren', 'Kit'];
const SKINS = ['#F6D5BE', '#EDC09B', '#D79E6E', '#A86B43', '#6E4228', '#4B2C1B'];
const HAIRS = ['buzz', 'neat', 'spiky', 'afro', 'bun', 'long', 'braids', 'mohawk', 'bald', 'curly', 'swoop', 'mop', 'flattop', 'slick', 'hightop'];
const HAIRC = ['#1A1110', '#3A2116', '#E2622B', '#F2D16B', '#111111', '#5A3A22'];
const BUILDS = ['mid', 'slim', 'big', 'small', 'tall'];
const BOOTS = ['#222', '#FF6B9A', '#4FC3F7', '#7CFC00', '#FFFFFF', '#FF8C00'];

function filler(n, suit, rank) {
  const h = (k) => (n * 7 + k * 13 + rank * 3) % 97;
  return {
    id: `f${suit}${rank}`, team: 'sun', name: NAMES[n % NAMES.length], nick: 'Squad', pos: suit, num: rank,
    skin: SKINS[h(1) % SKINS.length], hair: HAIRS[h(2) % HAIRS.length], hairColor: HAIRC[h(3) % HAIRC.length],
    build: BUILDS[h(4) % BUILDS.length], boots: BOOTS[h(5) % BOOTS.length], extras: h(6) % 4 === 0 ? ['freckles'] : [], brow: ['calm', 'happy', 'fierce', 'sly'][h(7) % 4],
  };
}

export function makeDeck() {
  const deck = [];
  let n = 0;
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 11; rank++) {
      const id = suit + rank;
      const star = STARS[id];
      deck.push({ id, suit, rank, char: star ? { ...byId[star], pos: suit, num: rank } : filler(n++, suit, rank), star: !!star });
    }
  }
  return deck;
}

// ------------------------------------------------------------------ hands
export const HANDS = [
  { id: 'golazo', name: 'Golazo', chips: 100, mult: 8, lc: 40, lm: 4, desc: '5 in a row, same position' },
  { id: 'overload', name: 'Overload', chips: 60, mult: 7, lc: 30, lm: 3, desc: '4 of the same number' },
  { id: 'squad', name: 'Full Squad', chips: 40, mult: 4, lc: 25, lm: 2, desc: '3 of one number + 2 of another' },
  { id: 'line', name: 'Full Line', chips: 35, mult: 4, lc: 15, lm: 2, desc: '5 of the same position' },
  { id: 'tiki', name: 'Tiki-Taka', chips: 30, mult: 4, lc: 30, lm: 3, desc: '5 numbers in a row' },
  { id: 'hattrick', name: 'Hat-trick', chips: 30, mult: 3, lc: 20, lm: 2, desc: '3 of the same number' },
  { id: 'buildup', name: 'Build-up', chips: 25, mult: 3, lc: 15, lm: 1, desc: 'a DF, an MF and an FW' },
  { id: 'double', name: 'Double One-Two', chips: 20, mult: 2, lc: 20, lm: 1, desc: 'two pairs' },
  { id: 'onetwo', name: 'One-Two', chips: 10, mult: 2, lc: 15, lm: 1, desc: 'a pair' },
  { id: 'solo', name: 'Solo Run', chips: 5, mult: 1, lc: 10, lm: 1, desc: 'highest card only' },
];
export const handById = Object.fromEntries(HANDS.map((h) => [h.id, h]));

export function detect(cards) {
  if (!cards.length) return null;
  const byRank = {};
  cards.forEach((c) => { (byRank[c.rank] ||= []).push(c); });
  const groups = Object.values(byRank).sort((a, b) => b.length - a.length || b[0].rank - a[0].rank);
  const five = cards.length === 5;
  const flush = five && cards.every((c) => c.suit === cards[0].suit);
  const rs = cards.map((c) => c.rank).sort((a, b) => a - b);
  const straight = five && groups.length === 5 && rs[4] - rs[0] === 4;
  const buildup = ['DF', 'MF', 'FW'].every((s) => cards.some((c) => c.suit === s));
  if (straight && flush) return { id: 'golazo', scoring: cards };
  if (groups[0].length >= 4) return { id: 'overload', scoring: groups[0] };
  if (groups[0].length === 3 && groups[1]?.length >= 2) return { id: 'squad', scoring: [...groups[0], ...groups[1]] };
  if (flush) return { id: 'line', scoring: cards };
  if (straight) return { id: 'tiki', scoring: cards };
  if (groups[0].length === 3) return { id: 'hattrick', scoring: groups[0] };
  if (buildup) { // the best DF, MF and FW form the move
    const best = (s) => cards.filter((c) => c.suit === s).sort((a, b) => b.rank - a.rank)[0];
    return { id: 'buildup', scoring: ['DF', 'MF', 'FW'].map(best) };
  }
  if (groups[0].length === 2 && groups[1]?.length === 2) return { id: 'double', scoring: [...groups[0], ...groups[1]] };
  if (groups[0].length === 2) return { id: 'onetwo', scoring: groups[0] };
  const hi = [...cards].sort((a, b) => b.rank - a.rank)[0];
  return { id: 'solo', scoring: [hi] };
}

// ------------------------------------------------------------------ formation: pass links
// Played cards stand in their line (GK, DF, MF, FW). A card links to one card in
// the next line up if their numbers are within 1. Each link: +1 Mult.
// A linked chain GK → DF → MF → FW ("played out from the back"): ×2 Mult.
const ORDER = ['GK', 'DF', 'MF', 'FW'];
export function links(cards) {
  const out = [];
  for (let r = 0; r < 3; r++) {
    const A = cards.filter((c) => c.suit === ORDER[r]);
    const B = cards.filter((c) => c.suit === ORDER[r + 1]);
    const used = new Set();
    for (const a of A) {
      let best = null;
      for (const b of B) {
        if (used.has(b.id)) continue;
        const d = Math.abs(a.rank - b.rank);
        if (d <= 1 && (!best || d < Math.abs(a.rank - best.rank))) best = b;
      }
      if (best) { used.add(best.id); out.push([a, best]); }
    }
  }
  return out;
}
export function chainOf(ls) {
  const up = new Map(ls.map(([a, b]) => [a.id, b]));
  for (const [a, b] of ls) {
    if (a.suit !== 'GK') continue;
    const m = up.get(b.id); if (!m) continue;
    const f = up.get(m.id); if (!f) continue;
    return [a, b, m, f];
  }
  return null;
}

// ------------------------------------------------------------------ coaches (jokers)
export const COACHES = {
  gegen: { name: 'Gegenpresser', price: 5, text: '+3 Mult per DF played', look: { hair: 'buzz', hairColor: '#C8C8C8', skin: '#EDC09B', extras: ['stubble'], brow: 'fierce' },
    apply: (s) => { const n = s.cards.filter((c) => c.suit === 'DF').length; return n ? { mult: 3 * n } : null; } },
  ten: { name: 'Number 10', price: 5, text: '+40 Chips if a 10 is played', look: { hair: 'swoop', hairColor: '#6b4a2b', skin: '#D79E6E', extras: [], brow: 'sly' },
    apply: (s) => (s.cards.some((c) => c.rank === 10) ? { chips: 40 } : null) },
  cat: { name: 'Catenaccio', price: 6, text: '×2 Mult if you play 3 or fewer cards', look: { hair: 'slick', hairColor: '#dcdcdc', skin: '#F6D5BE', extras: ['mustache'], brow: 'calm' },
    apply: (s) => (s.cards.length <= 3 ? { x: 2 } : null) },
  target: { name: 'Target Man', price: 6, text: '×1.5 Mult with 2+ FW played', look: { hair: 'bald', hairColor: '#333', skin: '#6E4228', extras: ['beard'], brow: 'fierce' },
    apply: (s) => (s.cards.filter((c) => c.suit === 'FW').length >= 2 ? { x: 1.5 } : null) },
  sweeper: { name: 'Sweeper Keeper', price: 4, text: '+30 Chips per GK played', look: { hair: 'bun', hairColor: '#2A1810', skin: '#A86B43', extras: ['headband'], brow: 'happy' },
    apply: (s) => { const n = s.cards.filter((c) => c.suit === 'GK').length; return n ? { chips: 30 * n } : null; } },
  wonder: { name: 'Wonderkid', price: 5, text: '+1 Mult per hand played this run (grows)', look: { hair: 'mop', hairColor: '#E2622B', skin: '#F6D5BE', extras: ['freckles'], brow: 'happy' },
    apply: (s) => (s.playsMade ? { mult: s.playsMade } : null), badge: (s) => `+${s.playsMade}` },
  bus: { name: 'Park the Bus', price: 4, text: '+2 Mult per unused discard', look: { hair: 'flattop', hairColor: '#111', skin: '#4B2C1B', extras: ['mustache'], brow: 'calm' },
    apply: (s) => (s.discards ? { mult: 2 * s.discards } : null), badge: (s) => `+${2 * s.discards}` },
};

export const BOSSES = {
  none: { name: 'Friendly ref', text: 'No special rule.' },
  marking: { name: 'Man-marking', text: 'Iron Hans marks your highest card: it scores 0 chips.' },
  var: { name: 'VAR', text: 'Your first play of the match scores half.' },
};

// Full scoring with every step, for the cascade and for the live preview.
// st: { levels, coaches, playsMade, discards, boss, firstPlay }
export function scorePlay(cards, st) {
  const det = detect(cards);
  if (!det) return null;
  const H = handById[det.id];
  const lv = st.levels[det.id] || 1;
  let chips = H.chips + (lv - 1) * H.lc;
  let mult = H.mult + (lv - 1) * H.lm;
  const steps = [];
  const marked = st.boss === 'marking' ? [...cards].sort((a, b) => b.rank - a.rank)[0] : null;
  const scoring = [...det.scoring].sort((a, b) => ORDER.indexOf(a.suit) - ORDER.indexOf(b.suit) || a.rank - b.rank);
  for (const c of scoring) {
    if (marked && c.id === marked.id) { steps.push({ kind: 'card', card: c, chips: 0, label: 'Marked!' }); continue; }
    chips += c.rank;
    steps.push({ kind: 'card', card: c, chips: c.rank, label: `+${c.rank}` });
  }
  const ls = links(cards);
  for (const l of ls) { mult += 1; steps.push({ kind: 'link', link: l, mult: 1, label: '+1 Mult' }); }
  const chain = chainOf(ls);
  if (chain) { mult *= 2; steps.push({ kind: 'chain', chain, x: 2, label: '×2 Out from the back' }); }
  const sctx = { cards, playsMade: st.playsMade, discards: st.discards };
  for (const id of st.coaches) {
    const r = COACHES[id].apply(sctx);
    if (!r) continue;
    if (r.chips) chips += r.chips;
    if (r.mult) mult += r.mult;
    if (r.x) mult *= r.x;
    steps.push({ kind: 'coach', coach: id, ...r, label: r.chips ? `+${r.chips} Chips` : r.mult ? `+${r.mult} Mult` : `×${r.x} Mult` });
  }
  mult = Math.round(mult * 10) / 10;
  let total = Math.floor(chips * mult);
  if (st.boss === 'var' && st.firstPlay) { total = Math.floor(total / 2); steps.push({ kind: 'var', label: 'VAR: ½' }); }
  return { hand: H, lv, det, chips, mult, total, steps, links: ls, chain, marked };
}
