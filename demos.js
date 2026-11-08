// Registry of demos shown on the hub. status: 'ready' | 'soon'.
// `face` is a cast id used for the card art.
export const DEMOS = [
  { slug: 'league-deck', title: 'Touchline', tag: 'Your idea · deck → live sim', face: 'kenji', status: 'ready', star: true,
    pitch: 'Build a tactics deck. Each 15 minutes you play cards, then watch the match simulate. Beat the legendary coach of each league.' },
  { slug: 'grid-tactics', title: 'Grid Tactics', tag: 'Into the Breach × football', face: 'tomo', status: 'soon',
    pitch: 'Move every player on an 11×7 grid, then pass, shoot or tackle.' },
  { slug: 'command-duel', title: 'Command Duel', tag: 'RPG menus + timing', face: 'rio', status: 'soon',
    pitch: 'Pick a command against a named defender, then nail the timing check.' },
  { slug: 'possession-deck', title: 'Possession Deck', tag: 'Slay the Spire', face: 'lupe', status: 'soon',
    pitch: 'Each zone of the pitch is an enemy. Cards push the ball forward.' },
  { slug: 'combo-hand', title: 'Combo Hand', tag: 'Balatro', face: 'pip', status: 'soon',
    pitch: 'Play poker-like hands of players. Coaches are your jokers.' },
  { slug: 'breakthrough', title: 'Breakthrough Puzzles', tag: 'Deterministic puzzles', face: 'bruno', status: 'soon',
    pitch: 'Defenders telegraph their steps. Bait them and score in 2–3 turns.' },
  { slug: 'shootout', title: 'Shootout Minds', tag: 'Mind games', face: 'wak', status: 'soon',
    pitch: 'Penalties where the keeper learns your habits and kickers show tells.' },
];
