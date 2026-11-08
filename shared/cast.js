// Shared cast for every Pitch Lab demo. The same characters appear everywhere:
// sprites on a pitch, portraits in menus, faces on cards.
//
// Stats are 1–10: pace, pass, shoot, tackle, dribble, keep (keepers), stamina.
// Look fields drive art.js: skin, hair (style), hairColor, build, boots, extras.

export const TEAMS = {
  sun: {
    id: 'sun', name: 'Sunbirds FC', short: 'SUN', city: 'Sunnyside',
    shirt: '#FFD23F', trim: '#1D2B53', shorts: '#1D2B53', socks: '#FFD23F', num: '#1D2B53',
    gkShirt: '#3BB273', gkTrim: '#0F3D2E', gkShorts: '#0F3D2E',
    accent: '#1D2B53', crest: 'bird',
  },
  red: {
    id: 'red', name: 'Redrock United', short: 'RRU', city: 'Redrock',
    shirt: '#E8463A', trim: '#FFFFFF', shorts: '#FFFFFF', socks: '#E8463A', num: '#FFFFFF',
    gkShirt: '#7B4FC9', gkTrim: '#2A1650', gkShorts: '#2A1650',
    accent: '#7A1410', crest: 'tower',
  },
};

const SKIN = { pale: '#F6D5BE', light: '#EDC09B', tan: '#D79E6E', brown: '#A86B43', deep: '#6E4228', dark: '#4B2C1B' };

const P = (o) => o;

export const CAST = [
  // ---------- Sunbirds FC (yellow, the player's team) ----------
  P({ id: 'wak', team: 'sun', name: 'Wak', nick: 'The Wall', pos: 'GK', num: 1,
      skin: SKIN.deep, hair: 'bun', hairColor: '#1A1110', build: 'big', boots: '#222', extras: ['beard', 'gloves', 'headband'], brow: 'calm',
      stats: { pace: 4, pass: 5, shoot: 2, tackle: 4, dribble: 3, keep: 8, stamina: 8 },
      bio: 'Unflappable. Has never once been seen running.', special: { name: 'Brick Wall', text: 'Next save is automatic.' } }),
  P({ id: 'tomo', team: 'sun', name: 'Tomo', nick: 'Steady', pos: 'DF', num: 4,
      skin: SKIN.light, hair: 'neat', hairColor: '#15151F', build: 'mid', boots: '#1D2B53', extras: ['armband'], brow: 'calm',
      stats: { pace: 5, pass: 6, shoot: 3, tackle: 8, dribble: 4, stamina: 8 },
      bio: 'Captain. Reads the game like a bus timetable.', special: { name: 'Clean Sweep', text: 'Win the ball, then a free pass.' } }),
  P({ id: 'ada', team: 'sun', name: 'Ada', nick: 'Express', pos: 'DF', num: 2,
      skin: SKIN.brown, hair: 'braids', hairColor: '#20140E', build: 'slim', boots: '#FF6B9A', extras: [], brow: 'happy',
      stats: { pace: 9, pass: 6, shoot: 4, tackle: 6, dribble: 7, stamina: 9 },
      bio: 'Full-back who forgets she is a full-back.', special: { name: 'Overlap Express', text: 'Sprints past the winger for a cross.' } }),
  P({ id: 'mo', team: 'sun', name: 'Big Mo', nick: 'Header', pos: 'DF', num: 5,
      skin: SKIN.tan, hair: 'bald', hairColor: '#2A1B12', build: 'big', boots: '#222', extras: ['mustache'], brow: 'fierce',
      stats: { pace: 4, pass: 4, shoot: 4, tackle: 8, dribble: 2, stamina: 7 },
      bio: 'Wins every header. Loses every footrace.', special: { name: 'Thunder Head', text: 'Clears any cross, scores from corners.' } }),
  P({ id: 'kenji', team: 'sun', name: 'Kenji', nick: 'Maestro', pos: 'MF', num: 10,
      skin: SKIN.pale, hair: 'swoop', hairColor: '#2B2340', build: 'slim', boots: '#4FC3F7', extras: ['sweatband'], brow: 'calm',
      stats: { pace: 6, pass: 9, shoot: 6, tackle: 4, dribble: 7, stamina: 6 },
      bio: 'Sees passes that do not exist yet.', special: { name: 'Needle Pass', text: 'A pass that ignores defenders.' } }),
  P({ id: 'lupe', team: 'sun', name: 'Lupe', nick: 'Engine', pos: 'MF', num: 8,
      skin: SKIN.tan, hair: 'curly', hairColor: '#3A2116', build: 'mid', boots: '#7CFC00', extras: ['freckles'], brow: 'happy',
      stats: { pace: 7, pass: 7, shoot: 5, tackle: 7, dribble: 6, stamina: 10 },
      bio: 'Runs 13 km a game and asks for more.', special: { name: 'Engine Room', text: 'Restores the team\'s stamina.' } }),
  P({ id: 'bruno', team: 'sun', name: 'Bruno', nick: 'Bulldozer', pos: 'FW', num: 9,
      skin: SKIN.light, hair: 'buzz', hairColor: '#4A3426', build: 'big', boots: '#E8463A', extras: ['stubble'], brow: 'fierce',
      stats: { pace: 6, pass: 4, shoot: 7, tackle: 5, dribble: 6, stamina: 7 },
      bio: 'Goes through defenders, not around them.', special: { name: 'Battering Ram', text: 'Bulldoze past your marker.' } }),
  P({ id: 'rio', team: 'sun', name: 'Rio', nick: 'Eagle Eye', pos: 'FW', num: 11,
      skin: SKIN.brown, hair: 'spiky', hairColor: '#111', build: 'mid', boots: '#FFFFFF', extras: [], brow: 'fierce',
      stats: { pace: 8, pass: 6, shoot: 9, tackle: 3, dribble: 7, stamina: 7 },
      bio: 'Spots the gap before the keeper does.', special: { name: 'Eagle Strike', text: 'A shot that finds the corner.' } }),
  P({ id: 'pip', team: 'sun', name: 'Pip', nick: 'Pinball', pos: 'MF', num: 7,
      skin: SKIN.pale, hair: 'mop', hairColor: '#E2622B', build: 'small', boots: '#FFD23F', extras: ['freckles'], brow: 'happy',
      stats: { pace: 9, pass: 5, shoot: 5, tackle: 3, dribble: 9, stamina: 7 },
      bio: 'Smallest on the pitch, hardest to catch.', special: { name: 'Pinball Run', text: 'Dribbles past two in a row.' } }),
  P({ id: 'sol', team: 'sun', name: 'Sol', nick: 'Late Show', pos: 'FW', num: 14,
      skin: SKIN.dark, hair: 'afro', hairColor: '#171010', build: 'tall', boots: '#B388FF', extras: [], brow: 'sly',
      stats: { pace: 7, pass: 6, shoot: 8, tackle: 3, dribble: 7, stamina: 5 },
      bio: 'Super-sub. Only wakes up after 75 minutes.', special: { name: 'Late Show', text: 'Shoots +30% after 80\'.' } }),

  // ---------- Redrock United (red, the rivals) ----------
  P({ id: 'oskar', team: 'red', name: 'Big Oskar', nick: 'The Fortress', pos: 'GK', num: 1,
      skin: SKIN.pale, hair: 'flattop', hairColor: '#F2D16B', build: 'big', boots: '#222', extras: ['gloves'], brow: 'fierce',
      stats: { pace: 4, pass: 4, shoot: 2, tackle: 4, dribble: 2, keep: 9, stamina: 8 },
      bio: 'Two metres tall. Shouts at his own defenders.', special: { name: 'Fortress', text: 'Shots from range lose 15%.' } }),
  P({ id: 'hans', team: 'red', name: 'Iron Hans', nick: 'Iron', pos: 'DF', num: 4,
      skin: SKIN.light, hair: 'buzz', hairColor: '#E9D8A6', build: 'big', boots: '#222', extras: ['armband'], brow: 'fierce',
      stats: { pace: 5, pass: 4, shoot: 3, tackle: 9, dribble: 3, stamina: 8 },
      bio: 'Tackles like a closing door.', special: { name: 'Iron Tackle', text: 'Tackle odds +20%.' } }),
  P({ id: 'lu', team: 'red', name: 'Spider Lu', nick: 'Spider', pos: 'DF', num: 3,
      skin: SKIN.light, hair: 'long', hairColor: '#0E0E14', build: 'tall', boots: '#7B4FC9', extras: [], brow: 'sly',
      stats: { pace: 7, pass: 6, shoot: 3, tackle: 8, dribble: 5, stamina: 7 },
      bio: 'Legs that reach two postcodes.', special: { name: 'Web', text: 'Intercepts the next pass nearby.' } }),
  P({ id: 'viper', team: 'red', name: 'Viper', nick: 'Venom', pos: 'FW', num: 9,
      skin: SKIN.tan, hair: 'slick', hairColor: '#111', build: 'slim', boots: '#2ECC71', extras: ['stubble'], brow: 'sly',
      stats: { pace: 8, pass: 6, shoot: 9, tackle: 3, dribble: 8, stamina: 6 },
      bio: 'Scores, then winks at the keeper.', special: { name: 'Venom Curl', text: 'Curled shot, hard to read.' } }),
  P({ id: 'zed', team: 'red', name: 'Zed', nick: 'Zigzag', pos: 'MF', num: 10,
      skin: SKIN.deep, hair: 'mohawk', hairColor: '#FF4D4D', build: 'mid', boots: '#FFD23F', extras: [], brow: 'happy',
      stats: { pace: 8, pass: 7, shoot: 6, tackle: 4, dribble: 9, stamina: 7 },
      bio: 'Dyes his mohawk to match the kit.', special: { name: 'Zed Zag', text: 'Skips one tackle.' } }),
  P({ id: 'dima', team: 'red', name: 'Dima', nick: 'Bear', pos: 'DF', num: 5,
      skin: SKIN.pale, hair: 'neat', hairColor: '#5A3A22', build: 'big', boots: '#222', extras: ['beard'], brow: 'calm',
      stats: { pace: 4, pass: 5, shoot: 4, tackle: 8, dribble: 3, stamina: 8 },
      bio: 'Gentle off the pitch. Not on it.', special: { name: 'Bear Hug', text: 'Shields the box for a turn.' } }),
  P({ id: 'marisol', team: 'red', name: 'Marisol', nick: 'Metronome', pos: 'MF', num: 8,
      skin: SKIN.tan, hair: 'bun', hairColor: '#2A1810', build: 'slim', boots: '#FFFFFF', extras: [], brow: 'calm',
      stats: { pace: 6, pass: 9, shoot: 5, tackle: 6, dribble: 6, stamina: 8 },
      bio: 'Never misplaces a pass. Ever.', special: { name: 'Metronome', text: 'Passes cannot be intercepted.' } }),
  P({ id: 'kofi', team: 'red', name: 'Kofi', nick: 'Rocket', pos: 'FW', num: 7,
      skin: SKIN.dark, hair: 'hightop', hairColor: '#111', build: 'mid', boots: '#FF8C00', extras: [], brow: 'happy',
      stats: { pace: 10, pass: 5, shoot: 7, tackle: 3, dribble: 8, stamina: 7 },
      bio: 'Fastest in the league. Knows it.', special: { name: 'Afterburner', text: 'Outruns any defender once.' } }),
  P({ id: 'nils', team: 'red', name: 'Nils', nick: 'Professor', pos: 'DF', num: 2,
      skin: SKIN.pale, hair: 'mop', hairColor: '#C8572B', build: 'slim', boots: '#4FC3F7', extras: ['sweatband', 'freckles'], brow: 'calm',
      stats: { pace: 6, pass: 7, shoot: 3, tackle: 7, dribble: 5, stamina: 7 },
      bio: 'Keeps a notebook of every winger he has faced.', special: { name: 'Homework', text: 'Reveals the next enemy move.' } }),
  P({ id: 'rocco', team: 'red', name: 'Rocco', nick: 'Fox', pos: 'FW', num: 11,
      skin: SKIN.tan, hair: 'curly', hairColor: '#1A1110', build: 'mid', boots: '#E8463A', extras: ['mustache'], brow: 'sly',
      stats: { pace: 6, pass: 5, shoot: 8, tackle: 3, dribble: 6, stamina: 6 },
      bio: 'Lurks offside, then suddenly is not.', special: { name: 'Fox in the Box', text: 'Tap-ins never miss.' } }),
];

export const byId = Object.fromEntries(CAST.map((c) => [c.id, c]));
export const roster = (team) => CAST.filter((c) => c.team === team);
export const team = (c) => TEAMS[typeof c === 'string' ? c : c.team];

// Small-sided default line-ups (5v5: GK, 2 DF, MF, FW).
export const LINEUP5 = {
  sun: ['wak', 'tomo', 'mo', 'kenji', 'rio'],
  red: ['oskar', 'hans', 'lu', 'zed', 'viper'],
};
export const LINEUP7 = {
  sun: ['wak', 'ada', 'tomo', 'mo', 'kenji', 'lupe', 'rio'],
  red: ['oskar', 'nils', 'hans', 'lu', 'marisol', 'zed', 'viper'],
};

// Crest SVGs, used in scoreboards and menus.
export function crestSVG(teamId, size = 28) {
  const t = TEAMS[teamId];
  const icon = t.crest === 'bird'
    ? `<path d="M9 17c3-1 5-4 6-7 1 3 4 4 7 4-2 1-4 3-5 6-2-2-5-3-8-3z" fill="${t.trim}"/><circle cx="17.5" cy="11" r="1" fill="${t.shirt}"/>`
    : `<path d="M10 22v-9h2v2h2v-2h4v2h2v-2h2v9z" fill="${t.trim}"/><rect x="14.5" y="17" width="3" height="5" fill="${t.shirt}"/>`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2l12 4v9c0 8-6 13-12 15C10 28 4 23 4 15V6z" fill="${t.shirt}" stroke="#1b1b2f" stroke-width="2"/><path d="M16 5l9 3v7c0 6-4 10-9 12" fill="none" stroke="${t.trim}" stroke-opacity=".35" stroke-width="2"/>${icon}</svg>`;
}
