// Command Duel rules data: zones, personalities, tells, specials, combos.
// Every personality note is shown to the player; the rule behind it is real.

export const ZONES = ['Own box', 'Defense', 'Midfield', 'Attack', 'Box'];
export const ZONE_SHORT = ['Own box', 'Def', 'Mid', 'Att', 'Box'];
export const ZONE_V = [0.84, 0.67, 0.5, 0.33, 0.18]; // pitch v of each duel spot

export const RESP = ['tackle', 'mark', 'press'];
export const RESP_LABEL = { tackle: 'Tackle', mark: 'Mark', press: 'Press' };
export const INTENTS = ['dribble', 'pass', 'shoot'];
export const SHOTS = ['normal', 'power', 'placed'];

// Tells a defender gives for each hidden response. Truthful TELL_TRUTH of the time.
export const TELL_TRUTH = 0.7;
export const DEF_TELL = {
  tackle: { icon: '⬇', text: 'Low stance, weight forward', why: 'the low stance' },
  mark: { icon: '👀', text: 'Glancing at {r}', why: 'the glance at your teammate' },
  press: { icon: '💨', text: 'Bouncing on toes, closing in', why: 'the bounce on the toes' },
};
export const ATT_TELL = {
  dribble: { icon: '🦶', text: 'Drops a shoulder', why: 'the dropped shoulder' },
  pass: { icon: '👀', text: 'Eyes on a teammate', why: 'the look at a teammate' },
  shoot: { icon: '🎯', text: 'Sets feet, looks at goal', why: 'the set-up to shoot' },
};
export const SHOT_TELL = {
  normal: { icon: '👣', text: 'Short, tidy steps', why: 'the short run-up' },
  power: { icon: '💥', text: 'Long run-up, head down', why: 'the long run-up' },
  placed: { icon: '🎯', text: 'Opens hips to the corner', why: 'the hip angle' },
};

// Rival defenders you meet while attacking, by zone. ctx = { sta, last, guts }.
export const RIVAL_DEF = [
  { id: 'rocco', note: 'Rocco gambles: he tackles more often than not.',
    active: () => true, prior: () => ({ tackle: 0.6, mark: 0.2, press: 0.2 }) },
  { id: 'zed', note: 'Zed presses whenever your carrier is tired (stamina under 5).',
    active: (c) => c.sta < 5, prior: (c) => (c.sta < 5 ? { tackle: 0.15, mark: 0.15, press: 0.7 } : { tackle: 0.35, mark: 0.3, press: 0.35 }) },
  { id: 'marisol', note: 'Marisol marks right after you pass.',
    active: (c) => c.last === 'pass', prior: (c) => (c.last === 'pass' ? { tackle: 0.15, mark: 0.7, press: 0.15 } : { tackle: 0.35, mark: 0.35, press: 0.3 }) },
  { id: 'nils', note: 'Nils does homework: he counters whatever you did last.',
    active: (c) => c.last === 'dribble' || c.last === 'pass',
    prior: (c) => (c.last === 'dribble' ? { tackle: 0.7, mark: 0.15, press: 0.15 } : c.last === 'pass' ? { tackle: 0.15, mark: 0.7, press: 0.15 } : { tackle: 0.3, mark: 0.3, press: 0.4 }) },
  { id: 'hans', note: 'Iron Hans always tackles when your guts are under 40.',
    active: (c) => c.guts < 40, prior: (c) => (c.guts < 40 ? { tackle: 0.85, mark: 0.08, press: 0.07 } : { tackle: 0.4, mark: 0.35, press: 0.25 }) },
];

// Rival carriers you defend against, by zone (they attack DOWN, toward zone 0).
// ctx = { sta, last }  (last = what worked for them last time)
export const RIVAL_ATT = [
  { id: 'viper', note: 'Viper shoots on sight in your box, usually placed.',
    active: () => true, prior: () => ({ dribble: 0.2, pass: 0.1, shoot: 0.7 }), shot: { normal: 0.2, power: 0.2, placed: 0.6 } },
  { id: 'kofi', note: 'Kofi dribbles, unless he is tired: then he blasts from range.',
    active: (c) => c.sta < 5, prior: (c) => (c.sta < 5 ? { dribble: 0.2, pass: 0.15, shoot: 0.65 } : { dribble: 0.6, pass: 0.15, shoot: 0.25 }),
    shot: { normal: 0.2, power: 0.65, placed: 0.15 } },
  { id: 'zed', note: "Zed can't resist a dribble.",
    active: () => true, prior: () => ({ dribble: 0.72, pass: 0.28, shoot: 0 }) },
  { id: 'marisol', note: 'Marisol passes two times out of three.',
    active: () => true, prior: () => ({ dribble: 0.33, pass: 0.67, shoot: 0 }) },
  { id: 'nils', note: 'Nils repeats whatever worked for Redrock last time.',
    active: (c) => !!c.last,
    prior: (c) => (c.last === 'dribble' ? { dribble: 0.75, pass: 0.25, shoot: 0 } : c.last === 'pass' ? { dribble: 0.25, pass: 0.75, shoot: 0 } : { dribble: 0.5, pass: 0.5, shoot: 0 }) },
];

export const OUR_DEF = ['mo', 'tomo', 'lupe', 'kenji', 'rio']; // who defends each zone

// Who can receive a pass into each zone.
export const PASS_POOL = {
  1: ['ada', 'tomo', 'mo'],
  2: ['kenji', 'lupe', 'pip'],
  3: ['pip', 'kenji', 'ada', 'lupe'],
  4: ['rio', 'bruno', 'sol'],
};

// Signature moves on the attack. base = which check runs; ignores the defender.
export const SPECIALS = {
  kenji: { base: 'pass', p: 0.92, adv: 1, text: 'Pass that ignores the defender' },
  rio: { base: 'shoot', bonus: 0.3, text: 'Shot +30%, cannot be blocked' },
  sol: { base: 'shoot', bonus: (s) => (s.min >= 80 ? 0.3 : 0.1), text: "Shot +30% after 80' (+10% before)" },
  bruno: { base: 'dribble', p: 0.9, adv: 1, text: 'Bulldoze past, ignores the tackle' },
  pip: { base: 'dribble', p: 0.82, adv: 2, text: 'Beat two men: jump two zones' },
  ada: { base: 'pass', p: 0.85, adv: 2, to: 'rio', text: 'Sprint two zones, cross to Rio' },
  lupe: { base: 'pass', p: 0.88, adv: 1, restore: true, text: 'Safe pass + team stamina +3' },
  tomo: { base: 'pass', p: 0.95, adv: 1, text: 'A pass that never misses' },
  mo: { base: 'pass', p: 0.72, adv: 2, to: 'bruno', text: 'Long ball two zones up to Bruno' },
};
// Signature moves on defence (auto-win the duel).
export const DEF_SPECIALS = {
  tomo: { text: 'Win the ball, then a free pass upfield' },
  mo: { text: 'Win the ball, head it clear upfield' },
  lupe: { text: 'Win the ball + team stamina +3' },
};

export const SPECIAL_COST = 40;
export const COMBO_COST = 60;
export const COMBOS = [
  { id: 'golden', a: 'kenji', b: 'rio', name: 'Golden Thread', text: 'Kenji threads it, Rio shoots first time', minZone: 2, bonus: 0.3 },
  { id: 'pinram', a: 'pip', b: 'bruno', name: 'Pinball Ram', text: 'Pip draws two men, Bruno smashes it', minZone: 2, bonus: 0.22 },
];

// Defending: your response vs their hidden intent -> chance you win the ball.
export const WIN = {
  tackle: { dribble: 0.74, pass: 0.18, shoot: 0.3 },
  mark: { dribble: 0.2, pass: 0.74, shoot: 0.25 },
  press: { dribble: 0.42, pass: 0.42, shoot: 0.45 },
};
// Keeper: your choice vs hidden shot type -> save chance.
export const SAVE = {
  catch: { normal: 0.85, power: 0.3, placed: 0.25 },
  punch: { normal: 0.6, power: 0.82, placed: 0.2 },
  dive: { normal: 0.5, power: 0.35, placed: 0.8 },
};

// Timing quality modifiers (absolute probability shift).
export const QMOD = { perfect: 0.15, good: 0, miss: -0.2, off: 0 };
