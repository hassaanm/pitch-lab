# Pitch Lab — design doc

A playground of turn-based football prototypes. Every demo shares one art kit (`shared/`), one cast (Sunbirds FC in yellow vs Redrock United in red), and one shell (phases, odds, event log). The goal is to feel each concept and find where the fun is.

Live site: https://hassaanm.github.io/pitch-lab/ (once the repo is pushed).

## Shared kit

| File | What it gives a demo |
|---|---|
| `shared/cast.js` | 20 named characters with stats (pace, pass, shoot, tackle, dribble, keep, stamina), bios, signature specials, line-ups |
| `shared/art.js` | Chibi sprites in 11 poses, a vertical stadium pitch (day/dusk/night/rain, animated crowd, rippling nets), ball, portraits, odds bubbles |
| `shared/shell.js` | Top bar, 3 jumpable phases, help sheet, event log, scoreboard, banners, cut-ins, confetti, shake |
| `shared/sfx.js` | Synthesised sounds (kick, whistle, crowd roar, cards, coins) |
| `shared/ui.css` | Chunky buttons, panels, the shared game-card frame `.gcard` |

Shared football math (starting points): pass ≈ 0.97 − 0.035·distance − 0.27·(defenders near the line); shot ≈ (shoot/10)·(1.15 − 0.14·distance) − 0.10 if the keeper is set − 0.12 per adjacent defender; tackle ≈ tackle/(tackle+dribble)·1.1.

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
- Before kick-off you see the projection for the spell: ball share, chance you score, chance they score. It updates as you play or take back cards.
- The spell then simulates ~5 possessions. Each one: their press may win the ball high (a quick chance) → otherwise your Attack vs their Defence decides if you reach the box → a chance (sometimes a big one) → shot vs keeper. A failed attack can give them a counter.
- **Big chance = key moment.** The sim pauses: shoot / square it / round the keeper (each with odds). When they get one, you choose Wak's move: stay big / rush out (foul risk) / guess a side.
- Player cards (Kenji, Rio, Pip, Bruno, Sol…) bring that character onto the pitch and arm their signature move for the next big chance.

### Formulas (`sim.js`)
- Ball share = ctrl^1.6 / (ctrl^1.6 + theirCtrl^1.6)
- Press wins it = 0.4 · σ((theirPress − ctrl)/3)
- Break the line = 0.05 + 0.85 · σ((atk − (theirDef − ignore))/3)
- Chance xG = 0.085 + 0.013·(fin − 10); big chance (22% + 2.5%·(atk − def)) = ×3.2
- Goal = xG · (1 + (10 − keeper)·0.05)

### What to notice
Does a deck plus simulation keep football's flow while still giving real decisions? Does reading the rival's plan feel like coaching? Are the big-chance moments enough hands-on play?

### Lead's notes after building it
- **Core decision each spell:** which stat battle to win this spell given their plan and your legs (e.g. they Gegenpress → play Rondo for Control, or Rest Defence to kill their counters, or save stamina and accept it).
- **Fun is probably in:** the read-and-counter against a telegraphed plan, the stamina tension across 90 minutes, and the big-chance pauses. Watching your card choice show up on the pitch ("PRESSED!", "COUNTER!") sells it.
- **Risk:** stat-stacking cards can feel like spreadsheet tuning. Odds move a few % per card, which may be too subtle. Possible fixes: fewer but more dramatic cards, cards that change *what happens* (e.g. "all chances become crosses") rather than numbers, and more key moments per spell.
- **Next ideas:** hidden-intent mode (guessing) vs telegraphed (planning); substitutions as cards drawn from a bench; a real league table instead of a ladder; coaches that are better against specific styles (rock-paper-scissors).

---

## Other demos

Each demo folder has a `NOTES.md` with its rules as built and an honest read on the fun. Collected here:

### Command Duel × Timed Strikes — `demos/command-duel/`

**Rules as built:** the ball moves Own box → Defense → Midfield → Attack → Box. Each zone is a 1v1 vs a named Redrock defender. You pick Dribble / Pass (2 receivers) / Shoot (Attack and Box only) / Special (40 guts) / a combo (60 guts: Kenji→Rio "Golden Thread", Pip→Bruno "Pinball Ram"). The defender has secretly picked Tackle (beats Dribble), Mark (beats Pass) or Press (−2.5 stamina, small penalty to everything).
**Reading:** each defender has a stated, true habit (Hans tackles when guts < 40, Nils counters your last move, Marisol marks after a pass, Zed presses tired carriers, Rocco gambles). The tell bubble is honest 70% of the time. The "Read" bar and every % are the exact Bayesian odds: habit prior × tell reliability.
**Timing check (⏱, key T):** pass = stop a slider in the green, dribble = 3-arrow sequence, shot = fast slider, save = shrinking ring. Perfect +15% (and +10 guts), Miss −20%. With ⏱ OFF, every action uses the shown %.
**Defending:** Tackle / Mark / Press vs the carrier's hidden Dribble / Pass / Shoot. Then Wak picks Catch / Punch / Dive vs Normal / Power / Placed (or Brick Wall for 50 guts). Clock: +3 min per duel, so a match is about 30 duels (~6 min).
**Core decision each turn:** "Which response is this defender most likely hiding, and is my best counter worth the risk, or do I spend guts to skip the guess?"
**Where the fun is:** the habit notes. Having Hans tackle *because* you just spent guts makes you plan two turns ahead. Combos at full guts feel great with the cut-ins.
**Where it isn't (honest):** the tell at 70% plus one habit usually produces a 60–70% favourite, so many turns are "press the green button". The bot test drew 1–1 twice: random play scores rarely. The timing check has a bigger swing (+15/−20) than most reads, so with ⏱ ON your thumb matters more than your read. That may be the answer to the design question. The arrow sequence is the weakest check on touch (tap a screen side).
**Untested on a real iPhone.** Verified at 390×750 in headless Chromium and at desktop width.

### Shootout Minds — `demos/shootout/`

**Rules as built:** 5 kicks each, then sudden death. You shoot first each round.
**Shooting:** pick one of 6 spots (left / middle / right × top / low) and Placed or Power. Power is saved less often (55% vs 80% when Oskar guesses the spot) but goes over 26% of the time when aimed top. Big Oskar dives by a model of your kicks: column counts, whether you repeat or switch sides, and top vs low. He trusts the model more with each kick and still follows his gut 20% of the time. Every % on the goal is the exact chance against that model.
**Peeking:** 📓 (N) opens his notebook (your tallies, his dive odds per spot, his dive history). 🔥 (V) paints his expected cover onto the goal. A toast after each kick shows what he wrote down.
**In goal (Wak):** each Redrock kicker has a stated habit (Viper top corners, Kofi power middle, Marisol shoots away from where you dive most, Zed goes opposite to the last Redrock kick, Rocco low corners, Nils copies the last Redrock goal). Eyes and run-up tells are true 65% of the time. "Stop %" = habit × tells.
**Core decision each kick:** "Do I go where he doesn't expect me, knowing that doing so feeds his notes for next time?"
**Where the fun is:** by round 4 you can see Oskar leaning left, and you start breaking your own patterns on purpose. That is the reading the design question asks about. Marisol and Zed are the best keeper turns, because their habit depends on what already happened.
**Where it isn't (honest):** early on, the low middle shot is too strong because Oskar rarely stays in the middle. That stays true until he has seen a few middle kicks. Viper, Rocco and Hans are solved in one read. With only 5 kicks, the learning is visible but short, so sudden death is where it pays off. There is no execution skill: it is pure mind game, by design.
**Untested on a real iPhone.** Verified at 390×750 in headless Chromium and at desktop width.

### Grid Tactics — `demos/grid-tactics/`

- **Rules as built:** 7×11 grid, 5v5 (LINEUP5). Move range = 1 + round(pace/4) in orthogonal steps; the carrier is 1 slower unless dribble ≥ 8. Entering a square next to an opponent ends your move (zone of control). Keepers stay in their box. Each player moves (optional), then passes, shoots, tackles or holds. A round is your turn + Redrock's turn = 5 minutes.
- **Odds (logic.js):** pass 0.97 − 0.035·dist − 0.27·(opponents within 0.85 sq of the line) + (pass−6)·1.5%; the first opponent along the line intercepts. Shot (shoot/10)·(1.15 − 0.17·dist) − keeper set (10% + keep bonus) − 12% per adjacent defender (falloff steeper than the brief's 0.14, or halfway-line shots hit 20%). Tackle tackle/(tackle+dribble)·1.1; a failed tackle floors the tackler for a turn.
- **Offside / through balls:** line = second-last defender's row, only in the attacking half. A through ball goes to an empty square; whoever picks it up must have been onside when it was played. Pass previews show interceptors (red rings), odds, offside tags, and which runners can reach a through ball.
- **AI shape:** one presser (goal-side, tackles), one player screens the pass to our most advanced attacker, the rest move to formation slots that shift with the ball. In possession the carrier shoots at ≥30%, passes forward at ≥50%, or dribbles away from pressure; runners hold the offside line.
- **Undo:** moves and holds undo freely; any dice roll (pass, shot, tackle) locks the turn so far. Phases: kick-off (0', 9 rounds), 60' at 1–1 with Kenji's Needle Pass and Rio's Eagle Strike, 80' at 1–2 at night.
- **Core decision each turn:** where to put the four players without the ball so the carrier has a pass with fewer red rings on it, without leaving the counter open.
- **Honest read:** the pass preview is the best part: dragging the aim around and watching odds and rings change makes space visible. Moving five players a turn feels like chess with a ball; most turns the two defenders and keeper just get "hold". Zone of control makes dribbling feel sticky, and the AI's single presser is easy to bait. Worth trying: activate only 2–3 players a turn (Into the Breach style), and let defenders auto-hold shape.

### Breakthrough Puzzles — `demos/breakthrough/`

- **Rules as built:** 5×7 grid, no dice. Each attacker moves once per turn (≤2 king steps through empty squares). The team gets **one pass per turn**, straight or diagonal, nobody on the line; a receiver who hasn't moved can still run after it. Shoot from the top 3 rows when a straight/diagonal lane crosses the goal line between the posts, outside the keeper's reach (his column ±1), with no bodies in it.
- **Defenders:** at the start of your turn each one telegraphs a path toward where the ball is *now*; they walk it when you end the turn, and an attacker on the path stops them. Finish a turn with the carrier next to any defender and you lose. Types: defender (1 step), sprinter (2), man-marker (2 toward his attacker, ignores the ball), sweeper (2, sideways only), slow giant (moves on odd turns only), keeper (slides 1 toward the ball's column).
- **Core decision each turn:** where to leave the ball at the end of the turn. That one square decides where every defender and the keeper will be next turn.
- **Verification:** `node demos/breakthrough/solve.mjs` runs a 0-1 BFS over the same `rules.js` the game uses. All 17 puzzles are solvable, their `par` matches, and none is solvable with one fewer turn. `-v` prints a solution. (The `package.json` here only marks the folder as ES modules for node.)
- **Where the fun is:** the "keeper covers ±1" rule makes every puzzle a show-left-score-right switch, which reads instantly and feels like real football (move the keeper, find the far post). Body-blocking a defender's arrow with a teammate is the best "aha".
- **Where it isn't:** because the keeper rule dominates, several puzzles feel like the same puzzle with different furniture. Par often rewards just standing still (end turn is free), so 3 stars can feel arbitrary. The man-marker barely matters in 2-turn puzzles because his move is locked in at turn start. Next try: shot lanes blocked by *defender arrows* (not just bodies), and puzzles where the keeper starts off-centre so baiting outfield players is the main idea.

### Possession Deck — `demos/possession-deck/`

- **Rules as built:** 5 zones (Defense → Midfield → Attack → Box → Keeper) are enemies with HP and a fixed, telegraphed intent cycle: Press X (hits Composure, Control absorbs), Compact X (block; Through Ball / Needle Pass ignore it), Foul (draw 1 fewer). 3 energy, draw 5, block-style Control resets each turn. Keeper: ½ from normal cards, ×3 from Shots. Break the Keeper = goal → pick 1 of 3 cards → touchline stop (Physio / Coach perk / Training thins the deck) → new attack with all zones +20% HP. Composure 0 = turnover → counter mini-turn (2 energy, 4 cards, each card's 🛡 value raises a visible stop %), then a roll. 5' per turn, full time at 90'.
- **Visible odds:** card text shows real numbers vs the current zone (Rhythm, Off-balance, keeper rules coloured). Selecting a card ghosts the HP loss / "BREAKS!" on the zone plate and the Composure you'd lose. The only random roll (counter) shows its %. Undo (Z) restores the exact state, including draw order.
- **Core decision each turn:** spend energy on Progress now vs. Control to survive the Press — and, at the Box, whether to save Shots for the Keeper (×3) instead of using them on outfield zones.
- **Where the fun is:** the Keeper rule makes Shots feel like a real finishing decision; Tiki Coach + Tiki-Taka pass chains feel like building play. Breaking a zone mid-turn and carrying leftover energy into the next zone feels like a counter-attack surge.
- **Where it isn't (honest):** outfield zones still read as "HP sponges with a football name". Press/Compact are just StS attack/block. A zone breaking does not change how the next zone plays, so it's closer to "monsters in a row" than "an attack". Ideas: zones that react to how you broke the last one (wing vs centre), or overflow progress carrying forward.
- **Balance:** rough. Starter deck usually scores 1–2 per match; turnovers are rare unless you ignore Press.

### Combo Hand — `demos/combo-hand/`

- **Rules as built:** 40 player cards (numbers 2–11 × GK/DF/MF/FW; Sunbirds stars + generated squad fillers). Hold 8, play up to 5; 4 plays, 3 discards. Hands from Golazo (100×8) down to Solo Run (5×1); scoring cards add their number to Chips. Each `perGoal` points is a goal; beat the rival's goal count. Group (draw is enough) → Knockout (boss: man-marking zeroes your highest card) → Final (boss: VAR halves your first play). Draws in KO/Final go to penalties (50%, shown). Shop between matches: 2 coaches, 1 hand-type upgrade, reroll.
- **Soccer idea built: formation links.** Played cards stand in their line on a pitch. A card links to one card in the next line up (GK→DF→MF→FW) if numbers are within 1: +1 Mult each, drawn as pass arrows. A full GK→DF→MF→FW chain ("out from the back") is ×2 and the ball runs the chain into the net.
- **Coaches (jokers):** Gegenpresser, Number 10, Catenaccio, Target Man, Sweeper Keeper, Wonderkid (grows), Park the Bus. Portraits are cast-style faces in a navy tracksuit with a club badge.
- **Visible odds:** hand name, Chips × Mult and total update live while picking; ghost players + dashed link arrows preview the formation; goal bar shows the ghost gain and goal ticks.
- **Core decision:** pure poker hand vs. adding "filler" players from other lines to make links/chains — which fights Catenaccio (≤3 cards) and Full Line (all one line = zero links).
- **Where the fun is:** the clutch phase puzzle (3 nines + Catenaccio vs. adding the GK for a chain vs. adding a FW for Target Man) feels genuinely football-shaped. Watching the ball run the chain into the net sells it.
- **Where it isn't (honest):** Build-up (DF+MF+FW) is easy to hit and links make 5-card plays almost always best, so hand choice flattens. Numbers inflate fast with stacked coaches; tier targets are hand-tuned for the authored phases, not for a real run.

### Card Grid (remix) — `demos/card-grid/`

- **Rules as built:** 5v5 on a 7×11 grid, 10 turns (9' each; clutch = 2 turns). Each turn: draw 5 from your attack or defence deck (by possession), ⚡3 energy (⚡4 in phase 2). Cards are player actions: Short Pass, Through Ball, Dribble, Switch, Overlap/Off-ball Run, Shoot, plus character cards (Kenji Needle Pass, Rio Eagle Strike, Pip Pinball Run, Sol Late Show, Tomo Clean Sweep, Mo Thunder Block, Wak Brick Wall…).
- **Rival telegraphs first.** On your ball: a red ◎ press anchored to a *cell* (move the ball away and it hits grass) plus step arrows. On their ball: a fixed 1–3 step plan (runs, pass/dribble, shot) whose odds update live as you Mark/Block/Press; Mark targets preview "their goal chance after".
- **Math:** pass/shot/tackle formulas from the brief (+ passer skill ±, dribble lunges at 60% of tackle odds). Turnover ends your turn. Undo works until a dice roll. Pick 1 of 3 cards after every goal and at half-time.
- **Core decision:** spend 3 energy to (a) progress the ball, (b) end the turn out of the ◎, and (c) set up a shot — usually you can only do two. On defence: which lane to cut so their chain's product drops most.
- **Where the fun is:** defence is the surprise hit — watching "their goal chance 37% → 14%" as you slot Tomo into the run cell feels like coaching. Dodging the ◎ press is a clean Into-the-Breach puzzle.
- **Where it isn't (yet):** attack hands can brick (no Shoot / carrier-locked character cards) — the restriction feels frustrating ~1 turn in 4. Dribble odds bubbles get cluttered. The AI is simple (1–2 pressers, greedy chain) and loses its threat once you learn to body-block runs. Goals are rare-ish in 10 turns; tune shot formula or turn count next.

### Push Your Luck — `demos/push-luck/`

- **Rules as built:** each possession you see 3 random options from Safe, Recycle, Progressive, Line-breaker, Switch, Take-on. Each shows turnover risk and xG gain. Risk = base + 0.3×pressure + a bit for field position. Every action adds 🔥 pressure (Recycle and Switch remove it). 5 completed passes = +0.08 xG. Shoot any time: goal chance ≈ built xG. Turnover = xG lost + a Redrock counter.
- **Rival possessions** auto-play (2–3 animated passes), then you make one defensive call with visible odds: Press (win-back % or a worse chance), Hold Shape, Deep Block (lower chance, you restart deep), Tactical Foul on counters (2 yellows max).
- **Match:** 2' per action, 4–6' per rival possession, ~10 possessions a match. Rerolls ↻ are the scarce resource (1 / 3 / 2 by phase). Clutch: 88'–90+3', 1–2 down, pressure starts at 30.
- **Named players toggle (N):** passer's pass stat / carrier's dribble stat scale risk; Kenji Line-breakers and Pip Take-ons get −40%; shooter's stat scales the shot (Rio best). Off = pure dice.
- **Core decision:** "shoot at 24% now, or one more 25%-risk pass for +0.09?" — and when to spend a pass on Recycle to cool pressure (patience vs. greed).
- **Where the fun is:** the 4th–5th pass of a good chain is genuinely tense, and the chain bonus makes Safe/Recycle feel like a real choice. Named mode helps a lot: "give it to Pip" becomes a plan, not a dice roll.
- **Where it isn't:** with 3 random offers, the optimal line is often obvious (take the lowest risk/gain ratio, shoot ≥0.25). Across a full match it starts to feel samey after ~6 possessions; rival possessions are one click and a bit passive. Needs opponent-specific twists (a high line that punishes Line-breakers less, etc.) to hold a whole match.

### Auto XI (auto-chess take on your idea) — `demos/auto-xi/`

**Rules as built:** 5-match cup run, 10 hearts. Shop of 5 (1–3 gold by tier; odds improve with level). Reroll 1g, level up 4–6g for 3→6 outfield slots, 5 bench slots, sell for full refund. Three copies of a player combine into ★★ (×1.45 stats).
Traits count unique players: styles (Possession, Gegenpress, Catenaccio, Intensity, Flair) tier at 2/4/6, roles (Engine, Playmaker, Poacher, Wall, Speedster) at 2/4.
Placement matters: each role has a home line (60% out of position); Playmaker feeds the forward ahead, side-by-side Walls form a Partnership, Engines carry adjacent midfielders, Speedsters on a flank add Attack. No Engine pair = 2nd-half fade.
Board → team stats (Control/Attack/Finish/Defence/Press/Keeper) → Touchline-style possession odds → 8 scripted possessions per half, animated with an adapted copy of Touchline's MatchView. W/D/L + xG projection updates live as you place. Half-time = +4 gold and a fresh shop. Loss costs 2 + margin hearts, draw 1. Final draws go to penalties.
**Core decision each shop:** chase a trait tier vs. buy raw quality vs. save gold (interest) — and where on the board each player stands.
**Where the fun is:** the live projection reacting to every move (swap two players, watch win% jump) and hitting a ★★ or a 4-tier. Scouting a Catenaccio-4 opponent and building to beat it feels like coaching.
**Where it isn't:** the match itself is pure watching — once you hit Kick off you have zero input for ~40 seconds, and outcomes are low-scoring and swingy, so a good build can still lose 0–1 with no story. Pool is small (27 units), so rolls repeat; no opponent shop/adaptation at half-time; balance is hand-tuned, not tested over many runs.

### Dice Squad — `demos/dice-squad/`

**Rules as built:** 3-match season (Friendly, League, Cup Final), 12 turns per match (7.5' each). Roll 4 dice a turn. Six player cards each carry 1–2 dice sockets with constraints (Short Pass 1–3, Vision 6, Dribble EVEN, Shoot 5–6 Box only, Recycle 1–2 rerolls others, Lupe's Engine +1, Kenji's Split halves a die). Each socket fires once per turn.
Four zones (Defence → Midfield → Attack → Box) each have wall HP. Damage chips the current wall; breaking it moves you up and leftover dice keep working. ⏱ Pressure clock: 3 turns per line, 0 = turnover. Box wall up gives their keeper +2; Shoot = die+2 vs keeper base+d6, odds shown on the socket.
Defending: their attacker has Attack HP; Tackle/Track Back/Press/Nick It shrink it (0 = you win it and counter from Midfield). Remaining Attack sets shot power (shot + Attack÷3 + d6) vs Wak's Save die+3; the "they score" meter updates live.
Rivals tamper: Spider Lu steals your highest die in the Attack zone; Iron Hans locks a die in the Box (from match 2). After each match pick 1 of 3 upgrades (5th die, armband, gloves, Eagle Eye, Lucky Boots reroll, Second Wind). A drawn Final goes to penalties.
**Core decision each turn:** which die goes where — spend the 6 on Vision now, or Engine a 5 into a 6 for a shot; Recycle the 1s or keep them for Short Pass; save a die for Wak or throw everything at the tackle.
**Where the fun is:** combo turns (Engine 5→6 → Nick It; break a line and finish in the Box with leftovers) feel great, and the shot/save odds make the gamble readable.
**Where it isn't:** it is honestly closer to "a puzzle wearing a kit" — the football reads mostly through the zone track and sprites, not through the decisions. Walls have no personality beyond HP and tamper, defence turns are short and samey, and the outcome per match is still dominated by a couple of shot rolls. Balance is untested beyond a few play-throughs.

