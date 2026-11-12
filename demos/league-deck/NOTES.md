# Touchline — notes

## Polish pass

**Core decision:** each spell you read the rival's plan and spend three Shouts on
cards to tilt three duels (keep the ball, break the line, score), and you cannot
win all three.

What changed and why:
- The match is drawn by the new shared view `shared/matchview.js` (the old
  `view.js` is gone). The ball is only ever at a player's feet, in flight or
  loose. Every change of possession is a contact: long ball won, pass cut
  out, tackle (ball pops loose, tackler collects), keeper catch or parry.
- Log lines, the ticker, score, banner, confetti and shake fire in `onHit`, on
  the contact frame (goal: the frame the ball crosses the line).
- Keeper saves: the save point is picked first, then ball and gloves arrive
  on the same frame. Goals: the keeper is beaten (wrong way or short).
- After a goal, at half-time and at kick-off everyone jogs home and the ball
  fades to the centre spot. Between spells play just pauses.
- Player cards substitute on the pitch (jog off / fade in); nobody snaps.
- The pitch has one size for the whole match (no compact/tall switch, no
  scroll jumps). Under it: a one-line ticker and one panel that swaps between
  planning, live play and the key-moment choice (min-height held).
- The six-stat grid became three duel bars per side with the sim's own odds.
  Tapping a card previews its effect on the bars; tap again to play it.
- The hand is five compact cards in a row, readable at 375 px.
- Card attribution: when a beat goes a side's way, the pitch label and the
  log name the card that helped ("⚡ Gegenpress → won it!").
- Sim odds and the random owner per possession are unchanged.

## Fix round (review findings)

- Shot lane: the aim is planned before the wind-up; anyone within a body width of
  the path sidesteps, and nobody moves during the flight. The striker stays about
  2.5 body widths from the keeper; goals clear the keeper's body by a ball width.
- Keeper dives and slide tackles ease over with `drawPlayer`'s `lay` and are fully
  down on the contact frame; getting up eases too. A beaten keeper dives toward the
  ball and ends short, or commits the wrong way.
- Player cards: the pitch re-syncs at every spell start; big chances only offer
  players who are on the pitch (`m.you.onPitch`).
- Card credit names only a card whose effect applied to that beat (largest
  contribution; conditions as at kick-off; set-piece cards only on corners).
- Tuning (sim.js / data.js, measured with a Node Monte-Carlo): about 3 goals a
  match (63% of matches have 2–4, was 39–56%); readable defending options;
  softer opponent ladder; clutch preset reaches ~21% per spell with good cards.
- Planning fits one phone screen: the pitch height is set from the panel's height.

## Final fix round

- One scripted movement per player (a new one cancels the old); key-moment taps
  are queued until the teammate's run into the box has finished.
- Saves register on the first frame ball and glove touch; misses and goals are
  aimed so the whole path clears the keeper (where he is and where he dives).
- Defending, tuned over every rival shooter: rush out vs Dribble 6 or less, guess
  vs a sharp finisher on a good chance (Wak reads sharp finishers more often),
  otherwise stay big (best option shares 41 / 21 / 38%).
- Ladder bases [8.6, 9.8, 10.8, 10.9] (+0.5 boss): about 74 / 62 / 48 / 35% wins
  per rung for a sensible player; about 2.4–2.7 goals a match.

## Last round

- Lane: outfield players (crosser too) step clear of the drawn ball path for the whole
  flight (0.5 sprite sizes, head included) and of the keeper's planned dive (0.85).
- Wrong-way leg save: he dives away from the shooter's side; the ball comes in low to
  the trailing boot.
- Defending (tuned on logged real chance qualities): standing big now concedes more to
  sharp finishers, so Guess wins vs Finishing 8+ (Viper: 90% of his chances), Stay vs
  average finishers who dribble (Zed 88%), Rush vs poor dribblers.
- First rung eased to base 7.8: about 82% wins (sensible), 76% (random cards).
- Played cards keep their own row while a card is previewed; the GOAL banner sits over
  the other half of the pitch; save lines show the one figure the player was shown.
