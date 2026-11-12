# Command Duel × Timed Strikes: notes

**Rules as built:** the ball moves Own box → Defense → Midfield → Attack → Box. Each zone is a 1v1 vs a named Redrock defender. You pick Dribble / Pass (2 receivers) / Shoot (Attack and Box only) / Special (40 guts) / a combo (60 guts: Kenji→Rio "Golden Thread", Pip→Bruno "Pinball Ram"). The defender has secretly picked Tackle (beats Dribble), Mark (beats Pass) or Press (−2.5 stamina, small penalty to everything).
**Reading:** each defender has a stated, true habit (Hans tackles when guts < 40, Nils counters your last move, Marisol marks after a pass, Zed presses tired carriers, Rocco gambles). The tell bubble is honest 70% of the time. The "Read" bar and every % are the exact Bayesian odds: habit prior × tell reliability.
**Timing check (⏱, key T):** pass = stop a slider in the green, dribble = 3-arrow sequence, shot = fast slider, save = shrinking ring. Perfect +15% (and +10 guts), Miss −20%. With ⏱ OFF, every action uses the shown %.
**Defending:** Tackle / Mark / Press vs the carrier's hidden Dribble / Pass / Shoot. Then Wak picks Catch / Punch / Dive vs Normal / Power / Placed (or Brick Wall for 50 guts). Clock: +3 min per duel, so a match is about 30 duels (~6 min).
**Core decision each turn:** "Which response is this defender most likely hiding, and is my best counter worth the risk, or do I spend guts to skip the guess?"
**Where the fun is:** the habit notes. Having Hans tackle *because* you just spent guts makes you plan two turns ahead. Combos at full guts feel great with the cut-ins.
**Where it isn't (honest):** the tell at 70% plus one habit usually produces a 60–70% favourite, so many turns are "press the green button". The bot test drew 1–1 twice: random play scores rarely. The timing check has a bigger swing (+15/−20) than most reads, so with ⏱ ON your thumb matters more than your read. That may be the answer to the design question. The arrow sequence is the weakest check on touch (tap a screen side).
**Untested on a real iPhone.** Verified at 390×750 in headless Chromium and at desktop width.

## Polish pass

- **One persistent pitch (`stage.js`).** Actors live between duels and jog on and off. The ball is always at a foot, in flight or loose. Hand-offs go through `settle()`: the holder passes to the next carrier.
- **Every contact is computed first** (`passTo`, `cutOut`, `tackleWin`, `beat`, `blockShot`, keeper saves): both parties reach the meeting point together. Logs, pops, guts and score land on the contact frame.
- **Goals clear the keeper.** The ball's path is fixed first. `clearOf()` then puts the keeper the wrong way, with his whole body at least a ball's width off the drawn path (measured 18–25 px). A shot that beats Wak always goes for a corner.
- **Going down and getting up** use the art kit's `lay`. Lunges tip over, `getUp`/`rise` hold about 0.4 s, tip back up and crouch. `stage.js` also tips up any lying player whose pose is replaced. The punch save meets the ball in front of Wak's body.
- **Log quotes the button.** Results say "you had 62% · perfect +15%", the % the player committed at.
- **Layout.** A fixed "vs" strip of player cards sits above the canvas. The panel has fixed regions. Buttons are a fixed 50 px with two-line sub-text and short copy, and the key numbers are hidden on phones. Nothing is ellipsized at 375 or 390 px.
- **Mechanics (tension pass):**
  - Shown odds are capped at 85% (90% with a Perfect). Tells are true 60% (was 70%) and habit priors top out at 60%, so a read leans rather than solves.
  - Specials are 85% (were up to 100%) and cost 60 (combo 80, Brick Wall 70). There is no free +5 per duel. Perfect gives +5 guts (was +10).
  - Guts come from bold wins: `24×(1−p)`, the green +g badge.
  - Redrock reshuffle their defenders each time you win the ball.
  - Stoppage starts in midfield with 65 guts, so the combo needs a bold win first.
  - Bot matches: 1–3 specials per match, 5–6 decisions in Stoppage.
- **Full-time** reports how many commands had a timing check and the specials used. A short tap shield after each check stops a late "up" tap from hitting the phase tabs.
- **Dev aids under `?jank=1`:** `window.__slow`, `window.__cdS` (stats), `window.__cdShot` and `window.__cdSide` (force a shot type or side).
