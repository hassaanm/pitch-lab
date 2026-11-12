// Auto XI data: traits, the unit pool (cast + generic players), rival clubs.
import { TEAMS, CAST, byId } from '../../shared/cast.js';

// ---------------------------------------------------------------- traits
// Styles come from Touchline's leagues. Roles describe what a player does.
// fx keys are team stats: ctrl, atk, fin, def, prs, gk. Hooks: counter, pressXg, big, setPiece, noFade.
export const TRAITS = {
  possession: { kind: 'style', name: 'Possession', icon: '🔁', color: '#4FC3F7', tiers: [2, 4, 6],
    fx: [{ ctrl: 1.5 }, { ctrl: 3.5, atk: 1 }, { ctrl: 6, atk: 2 }],
    text: ['+1.5 Control', '+3.5 Control, +1 Attack', '+6 Control, +2 Attack'] },
  press: { kind: 'style', name: 'Gegenpress', icon: '⚡', color: '#FF8A3D', tiers: [2, 4, 6],
    fx: [{ prs: 2 }, { prs: 4, pressXg: 0.08 }, { prs: 6, atk: 1, pressXg: 0.14 }],
    text: ['+2 Press', '+4 Press, turnovers become chances', '+6 Press, +1 Attack, deadly turnovers'] },
  bus: { kind: 'style', name: 'Catenaccio', icon: '🔒', color: '#7E8CE0', tiers: [2, 4, 6],
    fx: [{ def: 2 }, { def: 4, counter: 0.12 }, { def: 6, gk: 1, counter: 0.25 }],
    text: ['+2 Defence', '+4 Defence, counters +12%', '+6 Defence, +1 Keeper, counters +25%'] },
  power: { kind: 'style', name: 'Intensity', icon: '🔥', color: '#E8463A', tiers: [2, 4, 6],
    fx: [{ atk: 1, prs: 1 }, { atk: 2, prs: 2, setPiece: 0.16 }, { atk: 4, prs: 3, setPiece: 0.28 }],
    text: ['+1 Attack, +1 Press', '+2 Attack, +2 Press, a corner each half', '+4 Attack, +3 Press, deadly corners'] },
  flair: { kind: 'style', name: 'Flair', icon: '✨', color: '#CE93D8', tiers: [2, 4, 6],
    fx: [{ fin: 1.5 }, { fin: 3, big: 0.08 }, { fin: 5, big: 0.16 }],
    text: ['+1.5 Finishing', '+3 Finishing, more big chances', '+5 Finishing, many big chances'] },
  engine: { kind: 'role', name: 'Engine', icon: '🫀', color: '#A5D6A7', tiers: [2, 4],
    fx: [{ prs: 1, ctrl: 1, noFade: 1 }, { prs: 2, ctrl: 2, noFade: 1 }],
    text: ['+1 Press, +1 Control, no 2nd-half fade', '+2 Press, +2 Control, no fade'] },
  playmaker: { kind: 'role', name: 'Playmaker', icon: '🎩', color: '#FFE082', tiers: [2, 4],
    fx: [{ atk: 1.5 }, { atk: 3, fin: 1 }], text: ['+1.5 Attack', '+3 Attack, +1 Finishing'] },
  poacher: { kind: 'role', name: 'Poacher', icon: '🦊', color: '#FFAB91', tiers: [2, 4],
    fx: [{ fin: 1.5 }, { fin: 3 }], text: ['+1.5 Finishing', '+3 Finishing'] },
  wall: { kind: 'role', name: 'Wall', icon: '🧱', color: '#BCAAA4', tiers: [2, 4],
    fx: [{ def: 1.5 }, { def: 3, gk: 1 }], text: ['+1.5 Defence', '+3 Defence, +1 Keeper'] },
  speed: { kind: 'role', name: 'Speedster', icon: '💨', color: '#80DEEA', tiers: [2, 4],
    fx: [{ atk: 1, counter: 0.08 }, { atk: 2, counter: 0.18 }], text: ['+1 Attack, counters +8%', '+2 Attack, counters +18%'] },
};
export const STYLE_IDS = ['possession', 'press', 'bus', 'power', 'flair'];
export const ROLE_IDS = ['engine', 'playmaker', 'poacher', 'wall', 'speed'];

// Which line each role wants. Speedsters are happy on either flank line.
export const ROLE_LINE = { wall: ['back'], engine: ['mid'], playmaker: ['mid'], poacher: ['front'], speed: ['front', 'back'] };
export const LINES = ['front', 'mid', 'back'];
export const LINE_NAME = { front: 'Attack', mid: 'Midfield', back: 'Defence' };

// ---------------------------------------------------------------- units
// Cast players keep their stats; red players are "transfers" and wear your kit.
const castUnit = (id, cost, style, role) => ({ id, cost, traits: [style, role], char: byId[id] });

// Generic journeymen: hand-made looks so copies can stack into ★★.
const SK = { pale: '#F6D5BE', light: '#EDC09B', tan: '#D79E6E', brown: '#A86B43', deep: '#6E4228', dark: '#4B2C1B' };
const gen = (id, name, nick, look, stats, style, role, cost = 1) => {
  const char = { id, team: 'sun', name, nick, pos: 'MF', num: 12 + (id.length * 7) % 80, brow: 'calm', boots: '#222', extras: [], build: 'mid', ...look,
    stats: { pace: 5, pass: 5, shoot: 5, tackle: 5, dribble: 5, stamina: 6, ...stats }, bio: 'A journeyman with one good trick.' };
  return { id, cost, traits: [style, role], char, generic: true };
};

export const UNITS = [
  // ---- 1 gold: journeymen
  gen('g_benny', 'Benny', 'Bricks', { skin: SK.light, hair: 'buzz', hairColor: '#6B4A2E', build: 'big' }, { tackle: 6, pass: 4, pace: 4 }, 'bus', 'wall'),
  gen('g_dex', 'Dex', 'Dynamo', { skin: SK.brown, hair: 'curly', hairColor: '#1A1110' }, { stamina: 8, tackle: 5, pass: 5 }, 'press', 'engine'),
  gen('g_lola', 'Lola', 'Loop', { skin: SK.tan, hair: 'bun', hairColor: '#2A1810', build: 'slim' }, { pass: 6, dribble: 5 }, 'possession', 'playmaker'),
  gen('g_gus', 'Gus', 'Goalhanger', { skin: SK.pale, hair: 'mop', hairColor: '#C8572B' }, { shoot: 6, pace: 5 }, 'power', 'poacher'),
  gen('g_mika', 'Mika', 'Zoom', { skin: SK.deep, hair: 'hightop', hairColor: '#111', build: 'slim' }, { pace: 8, dribble: 6, shoot: 4 }, 'flair', 'speed'),
  gen('g_ivo', 'Ivo', 'Iceberg', { skin: SK.pale, hair: 'flattop', hairColor: '#E9D8A6', build: 'tall' }, { tackle: 6, pace: 5 }, 'possession', 'wall'),
  gen('g_nora', 'Nora', 'Nag', { skin: SK.light, hair: 'long', hairColor: '#3A2116', build: 'slim' }, { stamina: 8, tackle: 5 }, 'power', 'engine'),
  gen('g_tito', 'Tito', 'Tap-in', { skin: SK.dark, hair: 'afro', hairColor: '#171010' }, { shoot: 6, dribble: 5 }, 'bus', 'poacher'),
  gen('g_suki', 'Suki', 'Spark', { skin: SK.pale, hair: 'swoop', hairColor: '#2B2340', build: 'small' }, { pace: 7, dribble: 7 }, 'press', 'speed'),
  // ---- 2 gold: the cast
  castUnit('tomo', 2, 'bus', 'wall'),
  castUnit('mo', 2, 'power', 'wall'),
  castUnit('ada', 2, 'power', 'speed'),
  castUnit('lupe', 2, 'press', 'engine'),
  castUnit('pip', 2, 'flair', 'speed'),
  castUnit('bruno', 2, 'power', 'poacher'),
  castUnit('nils', 2, 'possession', 'engine'),
  castUnit('dima', 2, 'bus', 'wall'),
  castUnit('rocco', 2, 'bus', 'poacher'),
  castUnit('hans', 2, 'press', 'wall'),
  // ---- 3 gold: stars
  castUnit('kenji', 3, 'possession', 'playmaker'),
  castUnit('rio', 3, 'flair', 'poacher'),
  castUnit('sol', 3, 'flair', 'poacher'),
  castUnit('marisol', 3, 'possession', 'playmaker'),
  castUnit('zed', 3, 'flair', 'playmaker'),
  castUnit('kofi', 3, 'press', 'speed'),
  castUnit('viper', 3, 'flair', 'poacher'),
  castUnit('lu', 3, 'press', 'wall'),
];
export const UNIT = Object.fromEntries(UNITS.map((u) => [u.id, u]));

// Kit swap: any unit on your team wears Sunbirds yellow.
const kitCache = {};
export function charFor(unitId, teamId, pos) {
  const k = unitId + teamId + pos;
  if (!kitCache[k]) kitCache[k] = { ...UNIT[unitId].char, team: teamId, pos };
  return kitCache[k];
}

// Shop odds (cost 1 / 2 / 3) by field slots unlocked.
export const SHOP_ODDS = { 3: [0.7, 0.3, 0], 4: [0.5, 0.4, 0.1], 5: [0.35, 0.45, 0.2], 6: [0.2, 0.45, 0.35] };
export const LEVEL_COST = { 3: 4, 4: 5, 5: 6 };
export const MAX_SLOTS = 6;
export const BENCH = 5;

// ---------------------------------------------------------------- rival clubs
function club(id, name, shirt, trim, shorts) {
  TEAMS[id] = { id, name, short: name.slice(0, 3).toUpperCase(), shirt, trim, shorts, socks: shirt, num: trim, gkShirt: '#3BB273', gkTrim: '#1b1b2f', gkShorts: '#1b1b2f', crest: 'tower' };
  return id;
}
club('arsenail', 'Arsenail', '#EF0107', '#FFFFFF', '#FFFFFF');
club('sevilha', 'Sevilha', '#FFFFFF', '#D71920', '#FFFFFF');
club('napolo', 'Napolo', '#12A0D7', '#FFFFFF', '#FFFFFF');
club('dortmumble', 'Dortmumble', '#FDE100', '#111111', '#111111');
club('psg', 'Paris St-Germane', '#004170', '#DA291C', '#004170');

// Board slots: index = row*3 + col; row 0 front, 1 mid, 2 back.
// Rival squads: [unitId, slot, stars].
export const ROUNDS = [
  { club: 'arsenail', league: '🏴󠁧󠁢󠁥󠁮󠁧󠁿 Premiere League', style: 'power', variant: 'rain', keeper: 4, label: 'Matchday 1',
    squad: [['g_gus', 1, 1], ['g_nora', 4, 1], ['mo', 7, 1], ['g_benny', 6, 1]] },
  { club: 'sevilha', league: '🇪🇸 La Lija', style: 'possession', variant: 'dusk', keeper: 5, label: 'Matchday 2',
    squad: [['g_lola', 3, 1], ['nils', 4, 1], ['g_ivo', 7, 1], ['g_tito', 1, 1], ['g_mika', 0, 1]] },
  { club: 'napolo', league: '🇮🇹 Serie Ay', style: 'bus', variant: 'dusk', keeper: 7, label: 'Matchday 3',
    squad: [['dima', 6, 1], ['tomo', 7, 1], ['g_benny', 8, 2], ['rocco', 1, 1], ['g_dex', 4, 1]] },
  { club: 'dortmumble', league: '🇩🇪 Bundasliga', style: 'press', variant: 'day', keeper: 6, label: 'Matchday 4',
    squad: [['lupe', 3, 2], ['g_dex', 5, 1], ['hans', 7, 1], ['kofi', 0, 1], ['mo', 8, 1], ['lu', 6, 1]] },
  { club: 'psg', league: '🇫🇷 Ligue Won', style: 'flair', variant: 'night', keeper: 7, label: 'Cup Final',
    squad: [['zed', 4, 2], ['viper', 1, 1], ['g_mika', 0, 1], ['pip', 2, 1], ['dima', 7, 2], ['marisol', 3, 1]] },
];
export const HP_MAX = 10;
export { CAST };

// Board slot -> home spot on the match pitch, in the frame of the side attacking
// UP ([u, v], v = 0 is the goal it attacks). Row 0 front, 1 mid, 2 back; 'gk' keeper.
// The shared match view mirrors these for the opponent.
export function slotUV(slot) {
  if (slot === 'gk') return [0.5, 0.95];
  const row = Math.floor(slot / 3), col = slot % 3;
  return [[0.2, 0.5, 0.8][col], [0.4, 0.58, 0.76][row]];
}
