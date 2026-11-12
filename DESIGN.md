# Pitch Lab — design doc

A playground of turn-based football prototypes. Every demo shares one art kit (`shared/`), one cast (Sunbirds FC in yellow vs Redrock United in red), and one shell (phases, odds, event log). The goal is to feel each concept and find where the fun is.

Live site: https://hassaanm.github.io/pitch-lab/ (once the repo is pushed).

## Shared kit

| File | What it gives a demo |
|---|---|
| `shared/cast.js` | 20 named characters with stats (pace, pass, shoot, tackle, dribble, keep, stamina), bios, signature specials, line-ups |
| `shared/art.js` | Chibi sprites in 11 poses, a vertical stadium pitch (day/dusk/night/rain, animated crowd, rippling nets), ball, portraits, odds bubbles, the jank detector |
| `shared/matchview.js` | The shared broadcast match view used by Touchline and Auto XI |
| `shared/shell.js` | Top bar, 3 jumpable phases, help sheet, event log, scoreboard, banners, cut-ins, confetti, shake |
| `shared/sfx.js` | Synthesised sounds (kick, whistle, crowd roar, cards, coins) |
| `shared/ui.css` | Chunky buttons, panels, the shared game-card frame `.gcard` |

Shared football math (starting points): pass ≈ 0.97 − 0.035·distance − 0.27·(defenders near the line); shot ≈ (shoot/10)·(1.15 − 0.14·distance) − 0.10 if the keeper is set − 0.12 per adjacent defender; tackle ≈ tackle/(tackle+dribble)·1.1. Several demos have since tuned their own versions (see their sections).

### The no-jank contract
- **[`POLISH.md`](POLISH.md)** is the contract every demo follows. In short: nothing teleports, cause comes before effect, things that meet arrive at the same place and time, and the ball changes owner only at a contact. The layout stays stable, and every tap responds within 100 ms.
- **`shared/matchview.js`** is a broadcast-style pitch that keeps those rules for you. The ball is only at a player's feet, in flight or loose. Possession changes only at a contact (pass arrives, tackle lands, pass cut out, keeper catch). Each verb (`build`, `press`, `tackle`, `intercept`, `counter`, `corner`, `shot`, `penalty`…) reports its contact frame through `onHit`, so the log, score and banners are written there. For a save, the keeper and the ball are sent to one computed point and arrive together. The API summary is at the top of the file.
- **Jank detector:** open any demo with `?jank=1`. The art kit then watches every `drawPlayer` and `drawBall` call and records teleports. Read them with `window.__jank.summary()`. Deliberate cuts are hidden by a fade (sprites under 35% alpha are ignored).
- **Going down and getting up:** `drawPlayer` takes `{ lay }` (0..1). Ease it from 0 to 1 to go to ground and back to 0 to get up, so the body never snaps. `dive`, `slide` and `tackle` lay the body toward `-facing`, so a keeper diving toward +x needs `facing = -1`.
- **Shell changes:** toasts show at the top and never take taps. Header buttons are 40 px. On phones the header title hides when the scoreboard shows. Sheets keep their buttons on screen when the text is taller than the phone.
- **Testing:** each demo is driven in headless Chromium through Playwright at 375×812 (phone, touch), at real animation speed. Each demo also had an independent review against `POLISH.md`.

---

## Touchline (the owner's idea) — `demos/league-deck/`

**Pitch:** you are the coach and your deck is your tactics. Every 15 minutes you play cards, then the match plays itself out, and you step in on the big chances.

### Run structure
- Pick a coach, then a league. Each league is a ladder: Division Three → Division Two → Division One → Title Decider against that league's legendary coach.
- Win a match: sign 1 of 3 tactic cards (mostly the league's style) and pick a training camp (+1 to a team stat for the run).
- Beat the legend: unlock that coach. Each coach has a style deck and a passive.
- Beat all five leagues: the Champions Cup opens (every legend in one bracket).
- Prototype mercy: a loss offers "Replay match". There is also an "Unlock everything (testing)" button.

### Leagues and styles
The styles are the common fan stereotypes of each league, turned into mechanics. Names are parodies.

| League | Style | Legend | What the style does in the sim |
|---|---|---|---|
| The Premiere League (England) | Intensity | Sir Thunder | Attack + press + set pieces, burns stamina. Passive: +1 Shout in the last 2 spells |
| La Lija (Spain) | Possession | Don Tiki | High Control = more of the ball and resistance to pressing. Passive: first Possession card each spell is free |
| Serie Ay (Italy) | Catenaccio | Il Lucchetto | High Defence, counters when the opponent's attack fails. Passive: +3 Defence while leading |
| Bundasliga (Germany) | Gegenpress | Herr Gegen | Press wins the ball high and creates quick chances. Passive: press turnovers +6% xG |
| Ligue Won (France) | Flair | Le Magicien | Attack bursts, skip-the-defence tricks, armed shot bonuses, some turnover risk. Passive: Flair never loses the ball |

Clubs are parodies too (Liverpuddle, Real Madrib, Juventoos, Bayern Munchkin, Paris St-Germane…). They use the Redrock cast in each club's colours.

### A match
- 6 spells of 15 minutes (plus one extra-time spell, then penalties, if level).
- Each spell: 3 📣 Shouts (energy) and 5 cards. The rival coach's plan is shown first (telegraphed intent).
- Team stats on a ~10 scale: Control, Attack, Finish, Defence, Press, Keeper. Stamina 0–100 drains 8 per spell plus card costs; below 50 it lowers Attack/Defence/Press.
- **Screen:** the pitch has one fixed size for the whole match, set so pitch, ticker and panel fit one phone screen. Under it is a one-line ticker and one panel. The panel swaps between planning, live play and the key-moment choice, so nothing below jumps.
- **Three duel bars** replace the six-stat grid. Each side gets Keep the ball (Control vs Press), Break the line (Attack vs Defence) and Score a chance (Finish vs Keeper), with the sim's own odds. The header shows the chance you score and the chance they score this spell.
- **Playing a card:** the hand is five compact cards in a row. Tap a card to preview its effect on the bars; tap it again to play it. Tap a played card to take it back.
- The spell then simulates ~5 possessions. Each one: their press may win the ball high (a quick chance) → otherwise your Attack vs their Defence decides if you reach the box → a chance (sometimes a big one) → shot vs keeper. A failed attack can give them a counter.
- **Card credit:** when a beat goes a side's way, the pitch label and the log name the card that helped most ("⚡ Gegenpress → won it!"; yours in gold, theirs in red). Only a card whose effect applied to that beat is named.
- **Big chance = key moment.** The sim pauses: shoot / square it / round the keeper (each with odds). When they get one, you choose Wak's move. Each defending option is best in a situation you can read from the shooter: rush out vs a poor dribbler (Dribble 6 or less, 10% penalty risk); guess a side vs a sharp finisher (Finishing 8+) on a good chance; otherwise stay big.
- Player cards (Kenji, Rio, Pip, Bruno, Sol…) substitute that character onto the pitch (jog off, fade in) and arm their signature move for the next big chance. Big chances only offer players who are on the pitch.

### Formulas (`sim.js`)
- Ball share = ctrl^1.6 / (ctrl^1.6 + theirCtrl^1.6)
- Press wins it = 0.4 · σ((theirPress − ctrl)/3); the steal gives a chance of xG 0.07 (+ press bonuses)
- Break the line = 0.05 + 0.85 · σ((atk − (theirDef − ignore))/3); a failed attack gives a counter chance of xG 0.08
- Chance xG = 0.055 + 0.01·(fin − 10), clamped 0.03–0.35; big chance (20% + 2.5%·(atk − def), at least 18%) = ×3.0, at most 0.6
- Goal = xG · (1 + (10 − keeper)·0.05)
- Your big chance: square = pass (0.82 − 0.025·(def − 10)) × tap-in goal(xG 0.42); round the keeper = 0.2 + 0.05·(dribble − 5) + 0.015·(atk − def), clamped 10–65%
- Their big chance (g = their goal chance): stay big saves 1 − 1.5·g·(1 + 0.15·(shoot − 6)) for finishers above 6; rush out saves 0.99 − 0.6·g − 0.11·(dribble − 6), with a 10% foul → penalty (scored 76%); guess reads the side 0.555 + 0.06·(shoot − 6) of the time and saves 90% if right, 15% if wrong
- Opponent strength per rung: 7.8 / 9.8 / 10.8 / 10.9 (+0.5 for the legend), then skewed by style. About 82 / 59 / 49 / 35% wins per rung for a sensible player, and about 2.4–2.7 goals a match. So guess against a sharp finisher (Finishing 8+), rush against a poor dribbler (Dribble 6 or less), and stay big otherwise.

### What to notice
Does a deck plus simulation keep football's flow while still giving real decisions? Does reading the rival's plan and choosing which duels to win feel like coaching? Do the pitch labels make it clear which of your cards paid off? Are the big-chance moments enough hands-on play?

### Lead's notes after building it
- **Core decision each spell:** which stat battle to win this spell given their plan and your legs (e.g. they Gegenpress → play Rondo for Control, or Rest Defence to kill their counters, or save stamina and accept it).
- **Fun is probably in:** the read-and-counter against a telegraphed plan, the stamina tension across 90 minutes, and the big-chance pauses. Watching your card choice show up on the pitch ("PRESSED!", "COUNTER!") sells it.
- **Risk:** stat-stacking cards can feel like spreadsheet tuning. Odds move a few % per card, which may be too subtle. The duel bars (with tap-to-preview) and card credit on the pitch now make each card's effect visible, but each card still moves the odds by only a few %. Possible fixes: fewer but more dramatic cards, cards that change *what happens* (e.g. "all chances become crosses") rather than numbers, and more key moments per spell.
- **Next ideas:** hidden-intent mode (guessing) vs telegraphed (planning); a real bench to draw substitutions from (player cards already substitute on the pitch); a real league table instead of a ladder; coaches that are better against specific styles (rock-paper-scissors).

**Polish pass:** the match now runs on `shared/matchview.js`. Every change of possession is a contact, and the ticker, log, score and banners fire on that frame. After a goal, at half-time and at kick-off everyone jogs home and the ball fades to the centre spot. Scoring and the opponent ladder were retuned (lower chance xG, softer top rungs), and the defending options were tuned so each one is best in a readable situation.

---

## Other demos

Each demo folder has a `NOTES.md` with its rules as built and an honest read on the fun. Collected here:

### Command Duel × Timed Strikes — `demos/command-duel/`

**Rules as built:** the ball moves Own box → Defense → Midfield → Attack → Box. Each zone is a 1v1 vs a named Redrock defender. You pick Dribble / Pass (2 receivers) / Shoot (Attack and Box only) / Special (60 guts) / a combo (80 guts: Kenji→Rio "Golden Thread", Pip→Bruno "Pinball Ram"). The defender has secretly picked Tackle (beats Dribble), Mark (beats Pass) or Press (−2.5 stamina, small penalty to everything).
**Reading:** each defender has a stated, true habit (Hans tackles when guts < 40, Nils counters your last move, Marisol marks after a pass, Zed presses tired carriers, Rocco gambles). Habit priors top out at 60%, and the tell bubble is honest 60% of the time, so a read leans rather than solves. The "Read" bar and every % are the exact Bayesian odds: habit prior × tell reliability. No command is shown above 85%. Redrock reshuffle their defenders each time you win the ball.
**Guts:** a won command pays `24×(1−p)` guts (at least 3), the green +g badge, so bold reads earn more. There is no free guts per duel. Specials win 85% of the time.
**Timing check (⏱, key T):** pass = stop a slider in the green, dribble = 3-arrow sequence, shot = fast slider, save = shrinking ring. Perfect +15% (and +5 guts), Miss −20%, never above 90%. With ⏱ OFF, every action uses the shown %.
**Defending:** Tackle / Mark / Press vs the carrier's hidden Dribble / Pass / Shoot. Then Wak picks Catch / Punch / Dive vs Normal / Power / Placed (or Brick Wall for 70 guts). Clock: +3 min per duel, so a match is about 30 duels (~6 min). Stoppage starts in midfield with 65 guts, so the combo needs a bold win first.
**Core decision each turn:** "Which response is this defender most likely hiding, and is my best counter worth the risk, or do I spend guts to skip the guess?"
**Where the fun is:** the habit notes. Having Hans tackle *because* you just spent guts makes you plan two turns ahead. Combos at full guts feel great with the cut-ins.
**Where it isn't (honest):** before the polish pass, the tell at 70% plus one habit usually produced a 60–70% favourite, so many turns were "press the green button". The 60% tells, 60% priors and the 85% cap are meant to fix this. Bot matches now use 1–3 specials each. The timing check has a bigger swing (+15/−20) than most reads, so with ⏱ ON your thumb matters more than your read. That may be the answer to the design question. The arrow sequence is the weakest check on touch (tap a screen side).
**Polish pass:** the duels play on one persistent pitch (`stage.js`), where players jog on and off between duels. Every contact (pass, cut-out, tackle, blocked shot, save) is computed first, and both players reach it together. A shot that beats Wak always clears his body and goes for a corner. The log quotes the % you committed at, and the panel has fixed regions with fixed 50 px buttons.
**Untested on a real iPhone.** Verified at 375×812 in headless Chromium and at desktop width.

### Shootout Minds — `demos/shootout/`

**Rules as built:** 5 kicks each, then sudden death. You shoot first each round.
**Shooting:** pick one of 6 spots (left / middle / right × top / low) and Placed or Power. Power is saved less often (55% vs 80% when Oskar guesses the spot) but goes over 26% of the time when aimed top. Big Oskar dives by a model of your kicks: column counts, whether you repeat or switch sides, and top vs low. He trusts the model more with each kick and still follows his gut 30% of the time; his gut prefers standing tall in the middle, and his notes start with a stronger middle prior (0.6 vs 0.8 for each side, was 0.4). A low middle shot can still clip the trailing legs of a keeper diving to a side. Every % on the goal is the exact chance against that model.
**Peeking:** 📓 (N) opens his notebook (your tallies, his dive odds per spot, his dive history). 🔥 (V) paints his expected cover onto the goal. A toast after each kick shows what he wrote down.
**In goal (Wak):** each Redrock kicker has a stated habit (Viper top corners, Kofi power middle, Marisol shoots away from where you dive most, Zed goes opposite to the last Redrock kick, Rocco low corners, Nils copies the last Redrock goal). Eyes and run-up tells are true 65% of the time. "Stop %" = habit × tells. Nothing is picked for you on a keeper turn: **Dive!** stays disabled until you tap a spot.
**Sudden death:** the tally keeps 5 slots and relabels them ("R6–10"), so the layout never moves. The keepers take a kick too: one walks out of his goal and the other walks in.
**Core decision each kick:** "Do I go where he doesn't expect me, knowing that doing so feeds his notes for next time?"
**Where the fun is:** by round 4 you can see Oskar leaning left, and you start breaking your own patterns on purpose. That is the reading the design question asks about. Marisol and Zed are the best keeper turns, because their habit depends on what already happened.
**Where it isn't (honest):** the middle used to be a free hole (top middle 82–95%). With the stronger middle gut it is about 76% early. A column you have never used is still the best shot (that is the reading game), and top middle can reach ~87% by round 4. Viper, Rocco and Hans are solved in one read. With only 5 kicks, the learning is visible but short, so sudden death is where it pays off. There is no execution skill: it is pure mind game, by design.
**Polish pass:** each kick now resolves the way its % says, including the trailing-legs save that was in the odds but never happened. The meeting point is computed first, so gloves (or legs) and ball arrive on the same frame, and a beaten keeper ends a ball's width short. Score and log change on the contact frame, and the panel then says what happened and the % you had ("SAVED · you had 72%"). Between kicks the pairs walk off and on, and a new ball is carried in, so nothing snaps.
**Untested on a real iPhone.** Verified at 375×812 in headless Chromium and at desktop width.

### Grid Tactics — `demos/grid-tactics/`

- **Rules as built:** 7×11 grid, 5v5 (LINEUP5). Move range = 1 + round(pace/4) in orthogonal steps; carrying the ball no longer slows you, and a dribbler with 8+ moves 1 further with it. Entering a square next to an opponent ends your move (zone of control), except for the ball carrier, who can dribble past. Keepers stay in their box. Each player moves (optional), then passes, shoots, tackles or holds. **Tackles need a standing start:** only a player who has not moved this turn can tackle (both teams). A round is your turn + Redrock's turn = 5 minutes.
- **Auto-hold:** the keeper (ball more than 2 away) and defenders (ball more than 3 away) hold shape by default, dimmed and skipped by End turn. Tap one to move him anyway.
- **Odds (logic.js):** pass 0.97 − 0.035·dist − 0.27·(opponents within 0.85 sq of the line) + (pass−6)·1.5%; the first opponent along the line intercepts. Shot = (shoot/10) · reach(dist) · angle − keeper set (10% + keep bonus) − 12% per adjacent defender, where reach = 0.85/(1 + e^(1.3·(dist − 4.2))) and angle = goal mouth seen ÷ 0.9 rad (floor 0.2). Rio: centre spot 3%, in front of goal 35–55%. A miss is blocked by the adjacent defender, saved, or goes wide for a goal kick. Tackle tackle/(tackle+dribble)·1.1; a failed tackle floors the tackler for a turn.
- **Offside / through balls:** line = second-last defender's row, only in the attacking half. A through ball goes to an empty square; whoever picks it up must have been onside when it was played. Pass previews show interceptors (red rings), odds, offside tags, and which runners can reach a through ball.
- **AI shape:** one presser (goal-side, tackles), one player screens the pass to our most advanced attacker, the rest move to formation slots that shift with the ball. In possession the carrier shoots at ≥18%, passes forward at ≥50%, dribbles away from pressure, or recycles when boxed in; runners hold the offside line.
- **Undo:** moves and holds undo freely; any dice roll (pass, shot, tackle) locks the turn so far. Phases: kick-off (0', 9 rounds), 60' at 1–1 with Kenji's Needle Pass and Rio's Eagle Strike, 80' at 1–2 at night.
- **Core decision each turn:** where to put the four players without the ball so the carrier has a pass with fewer red rings on it, without leaving the counter open.
- **Honest read:** the pass preview is the best part: dragging the aim around and watching odds and rings change makes space visible. Moving five players a turn feels like chess with a ball; auto-hold now removes the "hold" busywork for the back line. Zone of control made dribbling sticky; the carrier now ignores it, and tackles need a standing start. Before those rules and the new shot formula, a kick-off match averaged 0.1 goals (89% 0–0); an AI-vs-AI sim now gives about 4.5 shots and 1.7 goals (21% 0–0). The AI's single presser is easy to bait. Still worth trying: activate only 2–3 players a turn (Into the Breach style).
- **Polish pass:** the ball is always at a foot, in flight or loose, and ownership changes only after it arrives. Tackles, interceptions, blocks and keeper saves meet the ball on the same frame. Offside blows the whistle first, then the ball is played to the taker. After a goal players jog back, undo walks them back, and phase changes fade the scene. The info box has a fixed height and keeps a one-line "Last: …" result.

### Breakthrough Puzzles — `demos/breakthrough/`

- **Rules as built:** 5×7 grid, no dice. Each attacker moves once per turn (≤2 king steps through empty squares). The team gets **one pass per turn**, straight or diagonal, nobody on the line; a receiver who hasn't moved can still run after it. Shoot from the top 3 rows when a straight/diagonal lane crosses the goal line between the posts, outside the keeper's reach (his column ±1), with no bodies in it.
- **Defenders:** at the start of your turn each one telegraphs a path toward where the ball is *now*, marked by a red dashed ring (the chase ring, `state.aim`); they walk it when you end the turn, and an attacker on the path stops them. Pass or run away from the ring and the arrows still point at it. Finish a turn with the carrier next to any defender and you lose. Types: defender (1 step), sprinter (2), man-marker (2 toward his attacker, ignores the ball), sweeper (2, sideways only), slow giant (moves on odd turns only), keeper (slides 1 toward the ball's column).
- **Core decision each turn:** where to leave the ball at the end of the turn. That one square decides where every defender and the keeper will be next turn.
- **Verification:** `node demos/breakthrough/solve.mjs` runs a 0-1 BFS over the same `rules.js` the game uses. All 17 puzzles are solvable, their `par` matches, and none is solvable with one fewer turn. `-v` prints a solution. (The `package.json` here only marks the folder as ES modules for node.)
- **Where the fun is:** the "keeper covers ±1" rule makes every puzzle a show-left-score-right switch, which reads instantly and feels like real football (move the keeper, find the far post). Body-blocking a defender's arrow with a teammate is the best "aha".
- **Where it isn't:** because the keeper rule dominates, several puzzles feel like the same puzzle with different furniture. Par often rewards just standing still (end turn is free), so 3 stars can feel arbitrary. The man-marker barely matters in 2-turn puzzles because his move is locked in at turn start. Next try: shot lanes blocked by *defender arrows* (not just bodies), and puzzles where the keeper starts off-centre so baiting outfield players is the main idea.
- **Polish pass:** every action plays its motion first and only then commits the rules state, HUD and log. Tackles, body blocks and shots happen at a real contact. The shot flies into the column the rule checks (`lane.cross.x`), and the keeper is at full stretch just short of it. Undo and reset rewind with players jogging back; a new puzzle fades in. The pitch is sized once, and the hint and info rows have fixed heights.

### Possession Deck — `demos/possession-deck/`

- **Rules as built:** 5 zones (Defense → Midfield → Attack → Box → Keeper) are enemies with HP and a fixed, telegraphed intent cycle: Press X (hits Composure, Control absorbs), Compact X (block; Through Ball / Needle Pass ignore it), Foul (draw 1 fewer). 3 energy, draw 5, block-style Control resets each turn. Leftover Progress carries into the next zone (halved against the Keeper). Keeper: ½ from normal cards, ×3 from Shots; at the Keeper you always start the turn holding a Shot if the deck has one. Composure starts at 24 of 40 at kick-off (14 in the second-half phase). Tap a card to select it and again to play it; while a card plays, further cards queue (numbered badges). Break the Keeper = goal → pick 1 of 3 cards → touchline stop (Physio / Coach perk / Training thins the deck) → new attack with all zones +20% HP. Composure 0 = turnover → counter mini-turn (2 energy, 4 cards, each card's 🛡 value raises a visible stop %), then a roll. 5' per turn, full time at 90'.
- **Visible odds:** card text shows real numbers vs the current zone (Rhythm, Off-balance, keeper rules coloured). Selecting a card ghosts the HP loss / "BREAKS!" on the zone plate (with the carry-over, e.g. "BREAKS ×2! +7 → ATT") and the Composure you'd lose. The only random roll (counter) shows its %. Undo (Z) restores the exact state, including draw order.
- **Core decision each turn:** spend energy on Progress now vs. Control to survive the Press — and, at the Box, whether to save Shots for the Keeper (×3) instead of using them on outfield zones.
- **Where the fun is:** the Keeper rule makes Shots feel like a real finishing decision; Tiki Coach + Tiki-Taka pass chains feel like building play. Breaking a zone mid-turn and carrying leftover energy into the next zone feels like a counter-attack surge.
- **Where it isn't (honest):** outfield zones still read as "HP sponges with a football name". Press/Compact are just StS attack/block. Overflow Progress now carries forward, which makes a break feel like a surge, but a zone breaking still does not change how the next zone plays. Idea: zones that react to how you broke the last one (wing vs centre).
- **Balance:** rough. Starter deck usually scored 1–2 per match before the polish pass. Turnovers were rare unless you ignored Press; the lower starting Composure is meant to make ignoring Control cost a turnover.
- **Polish pass:** the rules emit ordered events, and the view plays each one on the pitch; the HUD changes only on each contact frame. The card's player gets the ball by a pass, and Press, Compact and Foul are shown as real challenges. A turnover is a tackle off our carrier's feet, and the counter ends in a slide tackle, a Wak save or a goal when the ball arrives. A normal card takes about 0.7–0.8 s from tap to next tap (was 1.2–2.4 s).

### Combo Hand — `demos/combo-hand/`

- **Rules as built:** 40 player cards (numbers 2–11 × GK/DF/MF/FW; Sunbirds stars + generated squad fillers). Hold 8, play up to 5; 4 plays, 4 discards. A discard is free and draws one extra card (hold up to 9). Hands from Golazo (100×8) down to Solo Run (5×1), with Build-up (DF+MF+FW) at 25×2; scoring cards add their number to Chips. Each `perGoal` points is a goal; beat the rival's goal count. **Every play ends in a shot** at Big Oskar: a goal only if the total crosses the next ⚽ line, and **one play scores at most one goal** (its total is capped at one goal's worth). Group (800 per goal; 800 to go through, a draw is enough, 1600 to win) → Knockout (625 per goal, 1875 to win; boss: man-marking zeroes your highest card) → Final (1500 per goal, 4500 to win; boss: VAR halves your first play). Draws in KO/Final go to one deciding penalty, Rio vs Oskar (50%, shown). Shop between matches: 2 coaches, 1 hand-type upgrade, reroll.
- **Soccer idea built: formation links.** Played cards stand in their line on a pitch. A card links to one card in the next line up (GK→DF→MF→FW) if numbers are within 1: +1 Mult each, drawn as pass arrows. A full GK→DF→MF→FW chain ("out from the back") is ×2 and the ball runs the chain into the net.
- **Coaches (jokers):** Gegenpresser, Number 10, Catenaccio, Target Man, Sweeper Keeper, Wonderkid (grows), Park the Bus. Portraits are cast-style faces in a navy tracksuit with a club badge.
- **Visible odds:** hand name, Chips × Mult and total update live while picking; ghost players + dashed link arrows preview the formation; goal bar shows the ghost gain and goal ticks.
- **Core decision:** pure poker hand vs. adding "filler" players from other lines to make links/chains — which fights Catenaccio (≤3 cards) and Full Line (all one line = zero links).
- **Where the fun is:** the clutch phase puzzle (3 nines + Catenaccio vs. adding the GK for a chain vs. adding a FW for Target Man) feels genuinely football-shaped. Watching the ball run the chain into the net sells it.
- **Where it isn't (honest):** Build-up (DF+MF+FW) is easy to hit and links make 5-card plays almost always best, so hand choice flattens; Build-up dropped from ×3 to ×2 to soften this. Numbers inflate fast with stacked coaches. The targets are now tuned by a full-run sim with shop money and coaches: a never-discard bot wins Group 81% · Knockout 50% · Final 39%, and a discard-when-below-need bot 100% · 85% · 53%. The one-goal cap removed the rare 1400+ plays that decided matches.
- **Polish pass:** the board is actors that tween and fade, not snapshots; cards land and then players solidify. Scoring is played out: the ball goes to each scorer, links turn solid as they fire, and the play ends with the shot. Iron Hans visibly slide-tackles the marked card, and VAR counts up then down to half. Messages go in a fixed strip under the pitch, never over the buttons, and the screen fits 375×812.

### Card Grid (remix) — `demos/card-grid/`

- **Rules as built:** 5v5 on a 7×11 grid, 10 turns (9' each; clutch = 2 turns). Each turn: draw 5 from your attack or defence deck (by possession), ⚡4 energy (⚡5 in the second-half phase). An attack hand always holds at least one playable ball-moving card (pass, through ball or dribble); a dead card is swapped out at the draw. Cards are player actions: Short Pass, Through Ball, Dribble, Switch, Overlap/Off-ball Run, Shoot, plus character cards (Kenji Needle Pass, Rio Eagle Strike, Pip Pinball Run, Sol Late Show, Tomo Clean Sweep, Mo Thunder Block, Wak Brick Wall…).
- **Rival telegraphs first.** On your ball: a red ◎ press anchored to a *cell* (move the ball away and it hits grass) plus step arrows. On their ball: a fixed 1–3 step plan (runs, pass/dribble, shot) whose odds update live as you Mark/Block/Press; Mark targets preview "their goal chance after".
- **Math:** pass from the brief (+ passer skill ±). Shot = (shoot/10)·(1.25 − 0.15·dist) − ~0.10 if the keeper is set (scaled by his Keep) − 0.10 per adjacent defender. Tackle = tackle/(tackle+dribble)·0.95. Dribble lunges at 60% of tackle odds; with a defender within 3 of the end cell, keep odds cap at 90%, and the miss is a heavy touch the nearest defender runs onto. A player who loses a press is dazed 💫 until the turn ends: no more cards for him, and he does not block. Switch Play reaches anyone 2+ columns across at any range. Redrock only take long shots above 12%. Turnover ends your turn. Undo works until a dice roll. Pick 1 of 3 cards after every goal and at half-time.
- **Core decision:** spend 4 energy to (a) progress the ball, (b) end the turn out of the ◎, and (c) set up a shot — usually you can only do two. On defence: which lane to cut so their chain's product drops most.
- **Where the fun is:** defence is the surprise hit — watching "their goal chance 37% → 14%" as you slot Tomo into the run cell feels like coaching. Dodging the ◎ press is a clean Into-the-Breach puzzle.
- **Where it isn't (yet):** attack hands could brick (no Shoot / carrier-locked character cards) about 1 turn in 4; the guaranteed ball-moving card fixes the worst of it. Dribble odds bubbles get cluttered. The AI is simple (1–2 pressers, greedy chain) and loses its threat once you learn to body-block runs. Goals were rare; with ⚡4 and the new shot and tackle odds, bot matches went from ~1–2 shots and 0–1 goals to ~2–4 shots and 0–3 goals.
- **Polish pass:** ball hand-offs roll to the new owner and passes home onto the receiver's feet. Tackles, interceptions and keeper saves happen at one shared contact point and frame, and each dribble lunge happens on the step where the carrier passes that defender. After a goal players jog back to kick-off shape, and the played card flies from the hand to where it takes effect. Hint lines and the hand fit at 375 px.

### Push Your Luck — `demos/push-luck/`

- **Rules as built:** each possession you see 3 random options from Safe, Recycle, Progressive, Line-breaker, Switch, Take-on. Each shows turnover risk, its exact 🔥 cost and ⚽ the shot chance after that pass (receiver's finishing included). Risk = base + 0.3×pressure + a bit for field position. **Pressure is sticky:** each completed action adds its own 🔥 plus 3 more for each pass already in the chain (+3, +6, +9…). Recycle halves pressure and Switch removes 30%, so they buy time but never reset it. 5 completed passes = +0.08 xG. Shoot any time: goal chance ≈ built xG. Turnover = xG lost + a Redrock counter.
- **Rival possessions** auto-play (2–3 animated passes), then you make one defensive call with visible odds: Press (win-back % or a worse chance), Hold Shape, Deep Block (lower chance, you restart deep), Tactical Foul on counters (2 yellows max).
- **Match:** 2' per action, 4–6' per rival possession, ~10 possessions a match. Rerolls ↻ are the scarce resource (1 / 3 / 2 by phase). Clutch: 88'–90+3', 1–2 down, pressure starts at 30.
- **Named players toggle (N):** passer's pass stat / carrier's dribble stat scale risk; Kenji Line-breakers and Pip Take-ons get −40%; shooter's stat scales the shot (Rio best). Off = pure dice.
- **Core decision:** "shoot at 24% now, or one more 25%-risk pass for +0.09?" — and when to spend a pass on Recycle to cool pressure (patience vs. greed).
- **Where the fun is:** the 4th–5th pass of a good chain is genuinely tense, and the chain bonus makes Safe/Recycle feel like a real choice. Named mode helps a lot: "give it to Pip" becomes a plan, not a dice roll.
- **Where it isn't:** with 3 random offers, the optimal line was often obvious (safe passes to the 5-chain, then shoot; one Recycle wiped the clutch start). Sticky pressure cut that line from 0.074 to 0.064 goals per possession, while "shoot when the next pass no longer beats the current shot" stays at 0.082 (sim, 40k possessions). Across a full match it starts to feel samey after ~6 possessions; rival possessions are one click and a bit passive. Needs opponent-specific twists (a high line that punishes Line-breakers less, etc.) to hold a whole match.
- **Polish pass:** players move only through timed runs, and the held ball follows the carrier's foot. Passes, interceptions, tackles and take-ons meet at a computed point, with the label and sound on the contact frame. Saves land the gloves on the ball; on a goal the keeper dives clear of the path. Defensive results name the call and its odds ("SAVED · Hold Shape 13%").

### Auto XI (auto-chess take on your idea) — `demos/auto-xi/`

**Rules as built:** 5-match cup run, 10 hearts. Shop of 5 (1–3 gold by tier; odds improve with level). Reroll 1g, level up 4–6g for 3→6 outfield slots, 5 bench slots, sell for full refund. Three copies of a player combine into ★★ (×1.45 stats).
Traits count unique players: styles (Possession, Gegenpress, Catenaccio, Intensity, Flair) tier at 2/4/6, roles (Engine, Playmaker, Poacher, Wall, Speedster) at 2/4.
Placement matters: each role has a home line (60% out of position); Playmaker feeds the forward ahead, side-by-side Walls form a Partnership, Engines carry adjacent midfielders, Speedsters on a flank add Attack. No Engine pair = 2nd-half fade.
Board → team stats (Control/Attack/Finish/Defence/Press/Keeper) → Touchline-style possession odds → 8 scripted possessions per half, animated by the shared `shared/matchview.js`. A corner is its own possession (build → corner → header). Break the line = 0.28 + 0.62·σ((Atk − Def)/4.5), so even the best defence cannot stop every attack; chance xG = 0.15 + 0.018·(Fin − 10). The W/D/L + xG projection updates live as you place. It is the exact score distribution from the sim's own per-possession odds, so projected win matches simulated win within about 1 point. Half-time = +4 gold and a fresh shop. Loss costs 2 + margin hearts, draw 1. Final draws go to penalties.
**Core decision each shop:** chase a trait tier vs. buy raw quality vs. save gold (interest) — and where on the board each player stands.
**Where the fun is:** the live projection reacting to every move (swap two players, watch win% jump) and hitting a ★★ or a 4-tier. Scouting a Catenaccio-4 opponent and building to beat it feels like coaching.
**Where it isn't:** the match itself is pure watching — once you hit Kick off you have zero input for ~40 seconds. Outcomes are low-scoring and swingy, so a good build can still lose 0–1. Causes on events now give each goal and block a story, and the progress floor cut halves with fewer than 2 shots from up to 34% to at most 11%. Pool is small (27 units), so rolls repeat; no opponent shop/adaptation at half-time. The match odds are tuned over many simulated halves, but a full cup run is not.
**Polish pass:** the demo's own copy of Touchline's match view is gone; every log line, score change and GOAL banner now fires in the shared view's `onHit`, on the contact frame. Each tackle, block, save or goal names the synergy or link behind it ("🤝 Dima+Tomo → BLOCKED!"), only if those players touched the ball, and the half-time and full-time sheets list goals with causes. Taps in the shop patch the screen in place (no blink), and bought or placed units fly to their slot. The sticky bottom bar is gone, so the draft screen fits 375×812.

### Dice Squad — `demos/dice-squad/`

**Rules as built:** 3-match season (Friendly, League, Cup Final), 12 turns per match (7.5' each). Roll 4 dice a turn. Six player cards each carry 1–2 dice sockets with constraints (Short Pass 1–3, Vision 6, Dribble EVEN, Shoot 5–6 Box only, Recycle 1–2 rerolls others, Lupe's Engine +1, Kenji's Split halves a die). Each socket fires once per turn.
Four zones (Defence → Midfield → Attack → Box) each have wall HP. Damage chips the current wall; breaking it moves you up and leftover dice keep working, but you break at most one line per turn (the next wall holds at 1). ⏱ Pressure clock: 3 turns per line, 0 = turnover. Box wall up gives their keeper +2; Shoot = die+2 vs keeper base (1/2/3 by match) + d6, odds shown on the socket. The keeper's 6 always saves (shots max 83%), and a shot ends the attack.
Defending: their attacker has Attack HP (Viper 12, Kofi 14, Zed 11; shot 3/2/3); Tackle/Track Back/Press/Nick It shrink it (0 = you win it and counter from Midfield). Nick It takes a 6 and removes 7 (no instant win). Remaining Attack sets shot power (shot + Attack÷3 + d6) vs Wak's Save die+2; the "they score" meter updates live.
Rivals tamper: Spider Lu steals your highest die in the Attack zone; Iron Hans locks a die in the Box (from match 2). Each strikes at the start of every turn in his zone and the moment you arrive there. After each match pick 1 of 3 upgrades (5th die, armband, gloves, Eagle Eye, Lucky Boots reroll, Second Wind). A drawn Final goes to penalties.
**Core decision each turn:** which die goes where — spend the 6 on Vision now, or Engine a 5 into a 6 for a shot; Recycle the 1s or keep them for Short Pass; save a die for Wak or throw everything at the tackle.
**Where the fun is:** combo turns (Engine 5→6 → Nick It; break a line and finish in the Box with leftovers) feel great, and the shot/save odds make the gamble readable.
**Where it isn't:** it is honestly closer to "a puzzle wearing a kit" — the football reads mostly through the zone track and sprites, not through the decisions. Walls have no personality beyond HP and tamper, defence turns are short and samey, and the outcome per match is still dominated by a couple of shot rolls. Balance: a greedy bot (3000 sims per match) now wins the Friendly 56% and the Final 42% (were 93% and 77%), with about 1.6 goals for and 1.0 against. The ball is won back on 45–54% of defend turns.
**Polish pass:** every slotted die plays out on the pitch, and its number lands on the frame the motion ends. Tackles, steals and shots meet at a real contact; a save ends with the ball in the keeper's hands, and a goal clears his body. Restarts after goals use a fade cut, and every penalty in a shoot-out is shown. The zone track, info line and dice tray have fixed heights, so nothing jumps.

