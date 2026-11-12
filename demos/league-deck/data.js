// Touchline data: leagues, clubs, coaches, and the card pool.
//
// Team stats live on a ~10 scale:
//   ctrl  control: share of the ball, resists pressing
//   atk   attack: breaks lines into the final third
//   fin   finishing: quality of chances
//   def   defence: stops attacks reaching the box
//   prs   press: wins the ball high, creates quick chances
//   gk    keeper
// Stamina (sta) is 0–100 and drains every 15-minute spell; tired teams lose stats.

import { TEAMS, CAST } from '../../shared/cast.js';

// ---------------------------------------------------------------- styles
export const STYLES = {
  possession: { name: 'Possession', icon: '🔁', color: '#4FC3F7',
    blurb: 'Keep the ball. Starve them. High control blunts their press.' },
  press: { name: 'Gegenpress', icon: '⚡', color: '#FF8A3D',
    blurb: 'Win it back high and strike fast. Burns stamina.' },
  bus: { name: 'Catenaccio', icon: '🔒', color: '#7E8CE0',
    blurb: 'Lock the door, then counter when they over-commit.' },
  power: { name: 'Intensity', icon: '🔥', color: '#E8463A',
    blurb: 'Crosses, set pieces, second balls. Relentless, but tiring.' },
  flair: { name: 'Flair', icon: '✨', color: '#CE93D8',
    blurb: 'Dribblers and moments of magic. High risk, high ceiling.' },
  neutral: { name: 'Basic', icon: '⚽', color: '#A5D6A7', blurb: '' },
};

// ---------------------------------------------------------------- coaches
// Coach art reuses the sprite drawer with a "jacket" kit.
const SKIN = { pale: '#F6D5BE', light: '#EDC09B', tan: '#D79E6E', brown: '#A86B43', deep: '#6E4228' };
function coachKit(id, jacket, trim, trousers) {
  TEAMS[id] = { id, name: id, shirt: jacket, trim, shorts: trousers, socks: trousers, num: trim, gkShirt: jacket, gkTrim: trim, gkShorts: trousers };
}
coachKit('c_rookie', '#2B3A67', '#FFD23F', '#1B1B2F');
coachKit('c_tiki', '#9AA3B5', '#FFFFFF', '#2A2F3A');
coachKit('c_gegen', '#1B1B1F', '#FFD23F', '#1B1B1F');
coachKit('c_lock', '#1F2A44', '#C9D2E3', '#11182A');
coachKit('c_thunder', '#5A1A1A', '#F2C14E', '#2B1B12');
coachKit('c_magic', '#2D1B4E', '#F48FB1', '#1A1030');
coachKit('c_cup', '#0E2A47', '#9BE7FF', '#081A2E');

const coachChar = (id, o) => ({ id, team: o.kit, pos: 'MF', num: 0, build: 'mid', boots: '#222', extras: [], brow: 'calm', ...o });

export const COACHES = {
  rookie: { id: 'rookie', name: 'The Rookie', style: 'neutral', title: 'You',
    passive: 'No speciality yet. Beat a legend to learn their style.',
    char: coachChar('rookie', { kit: 'c_rookie', name: 'Rookie', skin: SKIN.tan, hair: 'neat', hairColor: '#2A1B12', brow: 'happy' }) },
  tiki: { id: 'tiki', name: 'Don Tiki', style: 'possession', title: 'The Philosopher',
    passive: 'The first Possession card each spell costs 0.',
    quote: '"If we have the ball, they cannot score."',
    char: coachChar('tiki', { kit: 'c_tiki', name: 'Don Tiki', skin: SKIN.light, hair: 'bald', hairColor: '#555', extras: ['stubble'], brow: 'fierce', build: 'slim' }) },
  gegen: { id: 'gegen', name: 'Herr Gegen', style: 'press', title: 'Heavy Metal',
    passive: 'Turnovers from your press make +0.06 xG chances.',
    quote: '"The best playmaker is the counter-press."',
    char: coachChar('gegen', { kit: 'c_gegen', name: 'Herr Gegen', skin: SKIN.pale, hair: 'neat', hairColor: '#C9A86A', extras: ['beard'], brow: 'happy', build: 'big' }) },
  lock: { id: 'lock', name: 'Il Lucchetto', style: 'bus', title: 'The Padlock',
    passive: '+3 defence while you lead. Counters are 30% more likely.',
    quote: '"A clean sheet is a work of art."',
    char: coachChar('lock', { kit: 'c_lock', name: 'Il Lucchetto', skin: SKIN.tan, hair: 'slick', hairColor: '#9A9AA5', extras: [], brow: 'sly' }) },
  thunder: { id: 'thunder', name: 'Sir Thunder', style: 'power', title: 'The Hairdryer',
    passive: '+1 Shout in the last two spells of every match.',
    quote: '"Squeaky bum time, lads."',
    char: coachChar('thunder', { kit: 'c_thunder', name: 'Sir Thunder', skin: SKIN.pale, hair: 'neat', hairColor: '#E8E8E8', extras: [], brow: 'fierce', build: 'big' }) },
  magic: { id: 'magic', name: 'Le Magicien', style: 'flair', title: 'The Artist',
    passive: 'Flair cards never cause a turnover.',
    quote: '"Football is not a science. It is a dance."',
    char: coachChar('magic', { kit: 'c_magic', name: 'Le Magicien', skin: SKIN.brown, hair: 'long', hairColor: '#1A1110', extras: ['stubble'], brow: 'sly', build: 'slim' }) },
  cupboss: { id: 'cupboss', name: 'The Gaffer of Gaffers', style: 'neutral', title: 'Champions Cup',
    passive: '', char: coachChar('cupboss', { kit: 'c_cup', name: 'The Gaffer', skin: SKIN.deep, hair: 'buzz', hairColor: '#DDD', extras: ['beard'], brow: 'calm', build: 'big' }) },
};

// ---------------------------------------------------------------- clubs and leagues
// Opponent clubs reuse the Redrock cast in each club's own colours.
function club(id, name, shirt, trim, shorts, gk = '#3BB273') {
  TEAMS[id] = { id, name, short: name.slice(0, 3).toUpperCase(), shirt, trim, shorts, socks: shirt, num: trim, gkShirt: gk, gkTrim: '#1b1b2f', gkShorts: '#1b1b2f', crest: 'tower' };
  return id;
}

export const LEAGUES = [
  { id: 'prem', name: 'The Premiere League', country: 'England', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', style: 'power', boss: 'thunder', variant: 'rain',
    lore: 'Pace, duels, second balls and set pieces. Nobody gets a quiet afternoon.',
    clubs: [club('liverpuddle', 'Liverpuddle', '#C8102E', '#F6EB61', '#C8102E'), club('arsenail', 'Arsenail', '#EF0107', '#FFFFFF', '#FFFFFF'),
      club('chelski', 'Chelski', '#034694', '#FFFFFF', '#034694'), club('mansky', 'Manchest Sky', '#6CABDD', '#1C2C5B', '#FFFFFF')] },
  { id: 'liga', name: 'La Lija', country: 'Spain', flag: '🇪🇸', style: 'possession', boss: 'tiki', variant: 'dusk',
    lore: 'Rondos, triangles and patience. The ball does the running.',
    clubs: [club('sevilha', 'Sevilha', '#FFFFFF', '#D71920', '#FFFFFF'), club('atletico', 'Atlético Madrud', '#CB3524', '#FFFFFF', '#1D2B53'),
      club('realmadrib', 'Real Madrib', '#F4F4F4', '#C9A227', '#F4F4F4'), club('barcelonia', 'Barcelonia', '#A50044', '#004D98', '#004D98')] },
  { id: 'serie', name: 'Serie Ay', country: 'Italy', flag: '🇮🇹', style: 'bus', boss: 'lock', variant: 'dusk',
    lore: 'Defending is an art form. One goal is usually enough.',
    clubs: [club('napolo', 'Napolo', '#12A0D7', '#FFFFFF', '#FFFFFF'), club('acmilano', 'AC Milano', '#FB090B', '#1B1B1B', '#FFFFFF'),
      club('intermil', 'Inter Milanese', '#0068A8', '#1B1B1B', '#1B1B1B'), club('juventoos', 'Juventoos', '#F0F0F0', '#111111', '#111111')] },
  { id: 'bunda', name: 'Bundasliga', country: 'Germany', flag: '🇩🇪', style: 'press', boss: 'gegen', variant: 'day',
    lore: 'Win it back in five seconds. Go vertical. Repeat until they break.',
    clubs: [club('leipzag', 'RB Leipzag', '#FFFFFF', '#DD0741', '#FFFFFF'), club('leverkuss', 'Leverkussen', '#E32221', '#111111', '#111111'),
      club('dortmumble', 'Dortmumble', '#FDE100', '#111111', '#111111'), club('munchkin', 'Bayern Munchkin', '#DC052D', '#FFFFFF', '#DC052D')] },
  { id: 'ligue', name: 'Ligue Won', country: 'France', flag: '🇫🇷', style: 'flair', boss: 'magic', variant: 'night',
    lore: 'Explosive wingers, academy wonderkids, moments of genius.',
    clubs: [club('lillo', 'Lillo', '#E01E13', '#1D2B53', '#FFFFFF'), club('marsupial', 'Olympique Marsupial', '#2FAEE0', '#FFFFFF', '#FFFFFF'),
      club('monacoco', 'AS Monaco-co', '#E51B22', '#FFFFFF', '#FFFFFF'), club('psg', 'Paris St-Germane', '#004170', '#DA291C', '#004170')] },
];
export const CUP = { id: 'cup', name: 'Champions Cup', country: 'Europe', flag: '🏆', style: 'neutral', boss: 'cupboss', variant: 'night',
  lore: 'Every legend, one trophy. Unlocks once you have beaten all five leagues.',
  clubs: [] };
CUP.clubs = [LEAGUES[1].clubs[3], LEAGUES[3].clubs[3], LEAGUES[2].clubs[3], LEAGUES[0].clubs[3]];
CUP.styles = ['possession', 'press', 'bus', 'power'];

export const DIVISIONS = ['Division Three', 'Division Two', 'Division One', 'Title Decider'];

// Base opponent strength per round (0..3). Style skews it.
export function opponentStats(round, style, isBoss) {
  const b = [7.8, 9.8, 10.8, 10.9][round] + (isBoss ? 0.5 : 0);
  const s = { ctrl: b, atk: b, fin: b, def: b, prs: b, gk: b };
  const skew = {
    possession: { ctrl: 3, atk: 1, prs: -1, def: -1 },
    press: { prs: 3, atk: 1, ctrl: -1, def: -1 },
    bus: { def: 3, gk: 1, ctrl: -2, atk: -1 },
    power: { atk: 2, prs: 1, fin: 1, ctrl: -2 },
    flair: { atk: 2, fin: 2, def: -2, ctrl: -1 },
    neutral: {},
  }[style];
  for (const k in skew) s[k] += skew[k];
  return s;
}

// Opponent squad: Redrock characters dressed in the club's colours.
export function clubSquad(clubId) {
  const ids = ['oskar', 'nils', 'hans', 'lu', 'marisol', 'zed', 'viper'];
  return ids.map((id) => ({ ...CAST.find((c) => c.id === id), team: clubId }));
}

// ---------------------------------------------------------------- cards
// fx: stat changes for this spell. perm: true = lasts the rest of the match.
// sta: stamina change. Hooks (read by sim.js): counter, pressXg, bypass,
// setPiece, arm (key-moment bonus), draw, shout, xgAgainst, variance.
export const CARDS = {
  // ---- basic (starter)
  shape:     { name: 'Keep Shape', cost: 1, style: 'neutral', type: 'tactic', icon: '🧱', fx: { def: 2 }, text: '+2 Defence' },
  passmove:  { name: 'Pass & Move', cost: 1, style: 'neutral', type: 'tactic', icon: '🔁', fx: { ctrl: 2 }, text: '+2 Control' },
  forward:   { name: 'Get Forward', cost: 1, style: 'neutral', type: 'tactic', icon: '⏫', fx: { atk: 2 }, text: '+2 Attack' },
  press1:    { name: 'Close Them Down', cost: 1, style: 'neutral', type: 'tactic', icon: '🏃', fx: { prs: 2 }, sta: -5, text: '+2 Press · −5 stamina' },
  shootsight:{ name: 'Shoot on Sight', cost: 1, style: 'neutral', type: 'tactic', icon: '🎯', fx: { fin: 2 }, text: '+2 Finishing' },
  breather:  { name: 'Take a Breather', cost: 0, style: 'neutral', type: 'tactic', icon: '💧', fx: { atk: -1 }, sta: 10, text: '+10 stamina · −1 Attack' },
  captain:   { name: 'Captain Tomo', cost: 1, style: 'neutral', type: 'player', who: 'tomo', fx: { def: 1, ctrl: 1, atk: 1 }, text: '+1 Defence, Control, Attack' },

  // ---- possession (La Lija / Don Tiki)
  rondo:     { name: 'Rondo', cost: 1, style: 'possession', type: 'tactic', icon: '⭕', fx: { ctrl: 3 }, text: '+3 Control' },
  tikitaka:  { name: 'Tiki-Taka', cost: 2, style: 'possession', type: 'tactic', icon: '🔺', fx: { ctrl: 4, atk: 1 }, rhythm: 'ctrl', text: '+4 Control, +1 Attack. Rhythm: +1 Control for the rest of the match.' },
  thirdman:  { name: 'Third-Man Run', cost: 1, style: 'possession', type: 'tactic', icon: '↗️', fx: { atk: 2 }, ifCtrlLead: { atk: 2 }, text: '+2 Attack. +2 more if your Control is higher.' },
  falsenine: { name: 'False Nine', cost: 2, style: 'possession', type: 'instruction', icon: '9️⃣', fx: { atk: 1 }, oppFx: { def: -1 }, perm: true, text: 'Rest of match: +1 Attack, their Defence −1.' },
  needle:    { name: 'Kenji: Needle Pass', cost: 1, style: 'possession', type: 'player', who: 'kenji', fx: { atk: 1 }, arm: { xg: 0.12, who: 'rio' }, text: '+1 Attack. Next big chance: +12% (Rio).' },
  switchplay:{ name: 'Switch Play', cost: 1, style: 'possession', type: 'tactic', icon: '↔️', fx: { atk: 2 }, ignoreDef: 2, text: '+2 Attack. Ignores 2 of their Defence.' },

  // ---- press (Bundasliga / Herr Gegen)
  gegen:     { name: 'Gegenpress', cost: 1, style: 'press', type: 'tactic', icon: '⚡', fx: { prs: 4 }, sta: -10, text: '+4 Press · −10 stamina' },
  vertical:  { name: 'Vertical Pass', cost: 1, style: 'press', type: 'tactic', icon: '⬆️', fx: { atk: 3, ctrl: -1 }, text: '+3 Attack, −1 Control' },
  trap:      { name: 'Pressing Trap', cost: 2, style: 'press', type: 'tactic', icon: '🪤', fx: { prs: 3 }, pressXg: 0.08, sta: -6, text: '+3 Press. Turnovers become big chances (+8%).' },
  metal:     { name: 'Heavy Metal', cost: 2, style: 'press', type: 'instruction', icon: '🤘', fx: { prs: 2, atk: 1 }, perm: true, staPerSpell: -4, text: 'Rest of match: +2 Press, +1 Attack, −4 stamina each spell.' },
  engine:    { name: 'Lupe: Engine Room', cost: 1, style: 'press', type: 'player', who: 'lupe', fx: { prs: 1 }, sta: 15, text: '+15 stamina, +1 Press' },
  restdef:   { name: 'Rest Defence', cost: 1, style: 'press', type: 'tactic', icon: '🛡️', fx: { def: 2 }, counterAgainst: -0.5, text: '+2 Defence. Halves their counters.' },

  // ---- catenaccio (Serie Ay / Il Lucchetto)
  bus:       { name: 'Park the Bus', cost: 2, style: 'bus', type: 'tactic', icon: '🚌', fx: { def: 6, atk: -3 }, text: '+6 Defence, −3 Attack' },
  libero:    { name: 'Libero', cost: 1, style: 'bus', type: 'tactic', icon: '🧹', fx: { def: 3 }, counter: 0.15, text: '+3 Defence. +15% counter chance.' },
  manmark:   { name: 'Man-Mark Their Star', cost: 1, style: 'bus', type: 'tactic', icon: '👁️', oppFx: { fin: -3 }, text: 'Their Finishing −3' },
  contro:    { name: 'Contropiede', cost: 1, style: 'bus', type: 'tactic', icon: '🏹', counter: 0.3, counterXg: 0.05, text: '+30% counter chance, counters +5% xG' },
  foul:      { name: 'Tactical Foul', cost: 0, style: 'bus', type: 'tactic', icon: '🟨', cancelBig: 1, text: 'Stop their next big chance. Booking risk.' },
  thunderhead:{ name: 'Big Mo: Thunder Head', cost: 1, style: 'bus', type: 'player', who: 'mo', fx: { def: 2 }, setPiece: 0.15, text: '+2 Defence. Corner routine: 15% goal.' },

  // ---- intensity (Premiere League / Sir Thunder)
  cross:     { name: 'Get It in the Mixer', cost: 1, style: 'power', type: 'tactic', icon: '🎯', fx: { atk: 2, fin: 1 }, header: true, text: '+2 Attack, +1 Finishing. Headers!' },
  secondball:{ name: 'Second Balls', cost: 1, style: 'power', type: 'tactic', icon: '🦵', fx: { ctrl: 2, prs: 1 }, sta: -4, text: '+2 Control, +1 Press · −4 stamina' },
  setpiece:  { name: 'Set-Piece Routine', cost: 1, style: 'power', type: 'tactic', icon: '🚩', setPiece: 0.2, text: 'One extra corner: 20% goal.' },
  upandatem: { name: "Up and At 'Em", cost: 2, style: 'power', type: 'tactic', icon: '💥', fx: { atk: 3, prs: 2 }, sta: -12, text: '+3 Attack, +2 Press · −12 stamina' },
  hairdryer: { name: 'Hairdryer', cost: 0, style: 'power', type: 'tactic', icon: '😤', ifTrailing: { atk: 2, prs: 2, fin: 1 }, text: 'If losing: +2 Attack, +2 Press, +1 Finishing.' },
  ram:       { name: 'Bruno: Battering Ram', cost: 1, style: 'power', type: 'player', who: 'bruno', fx: { atk: 2 }, arm: { xg: 0.1, who: 'bruno' }, text: '+2 Attack. Next big chance: +10% (Bruno).' },

  // ---- flair (Ligue Won / Le Magicien)
  takeon:    { name: 'Take Him On', cost: 1, style: 'flair', type: 'tactic', icon: '🌀', fx: { atk: 4 }, variance: 0.12, text: '+4 Attack. 12% of attacks lose the ball.' },
  nutmeg:    { name: 'Nutmeg', cost: 0, style: 'flair', type: 'tactic', icon: '🥜', bypass: 1, text: 'Your next attack skips their defence.' },
  rabona:    { name: 'Rabona', cost: 1, style: 'flair', type: 'tactic', icon: '🦩', fx: { fin: 2 }, onGoalShout: 1, text: '+2 Finishing. Score this spell: +1 Shout next spell.' },
  pinball:   { name: 'Pip: Pinball Run', cost: 1, style: 'flair', type: 'player', who: 'pip', fx: { atk: 3 }, bypass: 1, variance: 0.08, text: '+3 Attack. Skip their defence once.' },
  eagle:     { name: 'Rio: Eagle Strike', cost: 1, style: 'flair', type: 'player', who: 'rio', fx: { fin: 1 }, arm: { xg: 0.18, who: 'rio' }, text: '+1 Finishing. Next big chance: +18% (Rio).' },
  lateshow:  { name: 'Sol: Late Show', cost: 1, style: 'flair', type: 'player', who: 'sol', lateFin: 4, fx: { fin: 1 }, text: '+1 Finishing. After 75\': +4 more.' },
  academy:   { name: 'Youth Academy', cost: 1, style: 'flair', type: 'instruction', icon: '🌱', perm: true, drawPerSpell: 1, text: 'Rest of match: draw 1 extra card each spell.' },

  // ---- neutral rewards
  watersub:  { name: 'Fresh Legs', cost: 1, style: 'neutral', type: 'tactic', icon: '🔄', sta: 25, text: '+25 stamina (substitution)' },
  wakwall:   { name: 'Wak: Brick Wall', cost: 1, style: 'neutral', type: 'player', who: 'wak', fx: { gk: 4 }, text: '+4 Keeper' },
  timewaste: { name: 'Run the Clock', cost: 0, style: 'neutral', type: 'tactic', icon: '⏳', fewerPoss: 2, ifLeading: { def: 1 }, text: 'Two fewer possessions this spell. If leading, +1 Defence.' },
};
for (const [id, c] of Object.entries(CARDS)) c.id = id;

export const STARTER = ['shape', 'shape', 'passmove', 'passmove', 'forward', 'forward', 'press1', 'shootsight', 'breather', 'captain'];

// Coach starter decks swap 4 basics for their style.
export const COACH_DECK = {
  rookie: STARTER,
  tiki: ['shape', 'shape', 'forward', 'passmove', 'rondo', 'rondo', 'tikitaka', 'thirdman', 'breather', 'captain'],
  gegen: ['shape', 'passmove', 'forward', 'forward', 'gegen', 'gegen', 'vertical', 'engine', 'breather', 'captain'],
  lock: ['shape', 'passmove', 'forward', 'forward', 'libero', 'libero', 'contro', 'manmark', 'breather', 'captain'],
  thunder: ['shape', 'shape', 'passmove', 'forward', 'cross', 'secondball', 'setpiece', 'hairdryer', 'breather', 'captain'],
  magic: ['shape', 'shape', 'passmove', 'forward', 'takeon', 'nutmeg', 'eagle', 'pinball', 'breather', 'captain'],
};

// Opponent coach decks (what they can telegraph each spell).
export const AI_DECK = {
  possession: ['rondo', 'tikitaka', 'thirdman', 'switchplay', 'passmove', 'shape'],
  press: ['gegen', 'vertical', 'trap', 'restdef', 'forward', 'press1'],
  bus: ['bus', 'libero', 'contro', 'manmark', 'shape', 'timewaste'],
  power: ['cross', 'secondball', 'setpiece', 'upandatem', 'hairdryer', 'forward'],
  flair: ['takeon', 'nutmeg', 'rabona', 'shootsight', 'forward', 'switchplay'],
  neutral: ['shape', 'passmove', 'forward', 'press1', 'shootsight'],
};

export function rewardPool(style) {
  return Object.values(CARDS).filter((c) => c.style === style || (c.style === 'neutral' && ['watersub', 'wakwall', 'timewaste'].includes(c.id)));
}
