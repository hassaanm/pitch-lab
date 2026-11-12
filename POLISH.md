# Polish pass: the no-jank contract

Every demo in Pitch Lab must follow this. It exists because of this feedback
from the owner after the first build:

> "There are times where certain plays happen, like you block or steal, but
> the actual visual effect is delayed. Your team steals the ball and all of a
> sudden there's a big jump where the ball just disappears from the player and
> goes to your team. Or there's a kick, the ball gets blocked, and *then* the
> player jumps and blocks it. It feels weird. It feels janky, and that takes
> you out of the moment."
>
> "I want it polished, but it doesn't have to be visually crazy impressive. It
> could not have a lot of bells and whistles and still feel not janky. If it
> doesn't do as much as it could, that's okay. Just make things better."

So: **coherent beats impressive.** Remove anything that breaks the illusion
before adding anything new. A demo that does less, but where every motion has a
cause, is the goal.

## The contract

1. **Continuity.** Nothing teleports. The ball and every player get from A to
   B by moving there. If a real cut is needed (new possession, next puzzle,
   kick-off after a goal), make it a deliberate transition: players jog back,
   or the scene fades / wipes, and the ball is placed while it is covered.
2. **Cause before effect.** Order is always anticipation → contact → reaction.
   The defender starts moving first, reaches the ball, and only then does the
   ball change owner. Never show the outcome (label, sound, score, log line,
   shake, banner) before the frame where it physically happens.
3. **Coincidence.** Two things that meet must be at the same place at the same
   time: keeper's hands and the ball, tackler's foot and the ball, blocker's
   body and the shot line, header and the cross. Compute the meeting point
   first, then send both there with the same arrival time.
4. **Possession is physical.** The ball is either at a player's feet, in
   flight, or loose. Ownership changes only at a contact: a pass arrives, a
   tackle lands, an interception cuts the lane, a keeper catches. No
   `ball.owner = x` without the motion that explains it.
5. **Readable timing.** One thing at a time. Beats last 250–600 ms. Hold
   100–250 ms after a contact so it registers (a short freeze on big contacts
   helps). Speed controls may scale this, but ×1 must read clearly.
6. **Outcome ties to the choice.** If the player saw "62%" before committing,
   the result should point back at it. If a card or ability caused an event,
   name it at that moment ("HIGH PRESS → stolen").
7. **Stable layout.** The pitch does not resize, and panels do not reflow or
   jump the scroll position mid-play. Swap content inside fixed regions.
   Reserve space for things that appear later.
8. **Input feel.** Every tap responds within 100 ms (press state, highlight,
   sound). One obvious primary action per state. Disabled controls say why.
   Undo where the rules are deterministic. Never accept input during an
   animation unless it is queued or clearly ignored.
9. **Legible state.** At any moment a new player can tell whose turn it is,
   what they can do, and what the last thing that happened was.
10. **Complete flows.** Kick-off, half-time, full-time, win, lose, restart and
    every `?phase=` deep link all work and end somewhere sensible.

## Patterns

```js
// WRONG: effect before cause, then a teleport.
label('STOLEN!'); ball.owner = defender;            // ball jumps 80 px
await run(defender, carrier);

// RIGHT: defender arrives, contact, ball pops loose, winner collects.
await run(defender, carrier, { stopShort: 10 });    // anticipation
defender.pose = 'tackle'; carrier.pose = 'sad';     // contact frame
sfx.tackle(); label('STOLEN!');                     // outcome AT contact
await ballTo(loosePoint, 0.14);                     // ball leaves the foot
await collect(defender);                            // winner runs onto it
```

```js
// WRONG: ball stops in mid-air, then the keeper dives.
await ballTo(goal); label('SAVED'); keeper.pose = 'dive';

// RIGHT: both reach the save point on the same frame.
const save = pointOnShotLine(0.82);
const T = 0.34;
await Promise.all([ballTo(save, T), diveTo(keeper, save, T)]);
hold(0.12); label('SAVED'); sfx.save();
await parry(save);                                   // ball goes somewhere real
```

```js
// WRONG: place everyone at kick-off instantly.
actors.forEach((a) => Object.assign(a, a.home));

// RIGHT: jog back, or cover the cut.
await Promise.all(actors.map((a) => run(a, a.home, 0.6)));
```

The same idea applies to cards, dice, chips and UI: a card flies from the hand
to where it takes effect; a number counts up from the thing that produced it;
a panel slides, it does not pop.

## Fun pass: the core principle

Before touching mechanics, write one sentence: *the decision the player makes
every turn is ____, and it is interesting because ____.* Then check:

- Is that decision the first thing on screen, and is it one tap or drag away?
- Are the stakes visible before committing (odds, damage, what the rival will
  do)?
- Does the result point back at the decision?
- Is there tension every turn, or are there dead turns and obvious best moves?
- Does the match have an arc (a comeback is possible, a lead can be lost)?

Fix the biggest gap in the rules or engine. Tune, clarify and cut first. Add a
system only when one is clearly missing. Do not change the demo's identity.

## Phone checklist (375×812 and 390×844)

- Nothing overlaps or clips. No horizontal scroll. Sticky bars never cover
  content the player needs.
- Tap targets are at least 40 px. Text is at least 11 px.
- The primary action is reachable with a thumb and always in the same place.
- The pitch or board stays on screen while its animation plays.
- The How-to (the `?` button) matches the rules after your changes.

## Jank detector

Open any demo with `?jank=1` (combine with others: `?jank=1&phase=mid`). The
art kit then watches every `drawPlayer` and `drawBall` call and records
teleports in `window.__jank`:

```js
window.__jank.summary()   // { total, by, worst: [...] }
window.__jank.reset()
window.__jankCtx = 'tackle'   // optional: tag what is animating right now
```

Run at ×1 speed. A full match should record nothing. Deliberate cuts must be
covered by a fade (the detector ignores sprites drawn below 35% alpha). The
detector only catches teleports; ordering and coincidence need your eyes.
