# Shootout Minds: notes

**Rules as built:** 5 kicks each, then sudden death. You shoot first each round.
**Shooting:** pick one of 6 spots (left / middle / right × top / low) and Placed or Power. Power is saved less often (55% vs 80% when Oskar guesses the spot) but goes over 26% of the time when aimed top. Big Oskar dives by a model of your kicks: column counts, whether you repeat or switch sides, and top vs low. He trusts the model more with each kick and still follows his gut 30% of the time; his gut prefers standing tall in the middle. Every % on the goal is the exact chance against that model.
**Peeking:** 📓 (N) opens his notebook (your tallies, his dive odds per spot, his dive history). 🔥 (V) paints his expected cover onto the goal. A toast after each kick shows what he wrote down.
**In goal (Wak):** each Redrock kicker has a stated habit (Viper top corners, Kofi power middle, Marisol shoots away from where you dive most, Zed goes opposite to the last Redrock kick, Rocco low corners, Nils copies the last Redrock goal). Eyes and run-up tells are true 65% of the time. "Stop %" = habit × tells.
**Core decision each kick:** "Do I go where he doesn't expect me, knowing that doing so feeds his notes for next time?"
**Where the fun is:** by round 4 you can see Oskar leaning left, and you start breaking your own patterns on purpose. That is the reading the design question asks about. Marisol and Zed are the best keeper turns, because their habit depends on what already happened.
**Where it isn't (honest):** a column you have never used is still the best shot (that is the reading game), and top middle can reach ~87% by round 4. Viper, Rocco and Hans are solved in one read. With only 5 kicks, the learning is visible but short, so sudden death is where it pays off. There is no execution skill: it is pure mind game, by design.
**Untested on a real iPhone.** Verified at 390×750 in headless Chromium and at desktop width.

## Polish pass (no-jank)

- **Kick resolves like the odds say.** `brain.js resolveKick` uses `pGoalVs` and returns how it ended (hands/legs save, beaten/wrong-way goal, over/wide). Before, the "trailing legs" save was in the shown % but never happened.
- **Contact is physical.** `game.js playKick` computes the meeting point first: for a save, the keeper's feet go to `aim - reach(pose)` so gloves (or trailing legs) and ball arrive on the same frame. A beaten dive ends a ball's width short and a beat late. Middle saves are caught and held; side saves are parried wide; legs saves rebound out. Misses fly over the bar or past the post and leave into the stand.
- **Outcome at contact, not after.** Score, pips, log and result line change inside `onContact`; the banner lands 160 ms later so the contact is seen first.
- **No teleports between kicks.** `changeOver` walks the old pair off (keeper gets up first), walks the new pair on, and the new kicker carries a ball in and sets it on the spot. A keeper who caught it rolls it out to the next kicker. Old balls fade (<35% alpha) before a new one appears.
- **Layout:** odds panel has a fixed height; the tell bubble moved to the top of the scene (it overlapped the kicker card at 390 px); kicker sprite shrunk so it no longer hides low-middle contacts; the aimed cell stays outlined during the kick.
- **Legible results:** after each kick the panel says what happened and the % you had ("SAVED · you had 72%"). Tally shows "Full time" at the end.
- **Mechanics:** Oskar's gut weight 0.2→0.3 and it favours the middle; middle prior 0.4→0.6. Top middle was a free 82–95%; now 76% early, ~87% only when you have never gone there.
- **Dev aids (?jank=1 only):** `window.__slow`, `window.__force` (scripts the next kick), `window.__state()`, and a timer fallback that keeps frames ticking when rAF is paused in a hidden test pane.
- **Review fixes (round 2):** keeper sizes and glove points are measured from the `art.js` sprites (`KG` table). Saves meet the lower glove, never the face. The whole keeper is clamped inside the frame, so his head stays under the bar and inside the posts. A beaten keeper ends a ball's width short of the end of the ball's path (`clearOf`). Dives swing down from upright (`tilt`), and get-ups swing back. The ball never stops at the line: it carries into the net on the scoring frame. Over and wide balls get a dark ring and stay clear of the keeper and the post foot.
- **Sudden death:** one sprite per character. A keeper who is due to kick walks out of his goal, and the other keeper walks in. Then a ball is rolled to the spot. The tally keeps 5 slots and shows "R6–10" and so on, so the layout never moves.
- **Keeper turns:** nothing is picked by default, and **Dive!** stays disabled until you tap a spot. The end text now matches Oskar's real hit rate.

