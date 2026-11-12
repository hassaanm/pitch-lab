# Push Your Luck — notes
- **Rules as built:** each possession you see 3 random options from Safe, Recycle, Progressive, Line-breaker, Switch, Take-on. Each shows turnover risk and xG gain. Risk = base + 0.3×pressure + a bit for field position. Every action adds 🔥 pressure (Recycle and Switch remove it). 5 completed passes = +0.08 xG. Shoot any time: goal chance ≈ built xG. Turnover = xG lost + a Redrock counter.
- **Rival possessions** auto-play (2–3 animated passes), then you make one defensive call with visible odds: Press (win-back % or a worse chance), Hold Shape, Deep Block (lower chance, you restart deep), Tactical Foul on counters (2 yellows max).
- **Match:** 2' per action, 4–6' per rival possession, ~10 possessions a match. Rerolls ↻ are the scarce resource (1 / 3 / 2 by phase). Clutch: 88'–90+3', 1–2 down, pressure starts at 30.
- **Named players toggle (N):** passer's pass stat / carrier's dribble stat scale risk; Kenji Line-breakers and Pip Take-ons get −40%; shooter's stat scales the shot (Rio best). Off = pure dice.
- **Core decision:** "shoot at 24% now, or one more 25%-risk pass for +0.09?" — and when to spend a pass on Recycle to cool pressure (patience vs. greed).
- **Where the fun is:** the 4th–5th pass of a good chain is genuinely tense, and the chain bonus makes Safe/Recycle feel like a real choice. Named mode helps a lot: "give it to Pip" becomes a plan, not a dice roll.
- **Where it isn't:** with 3 random offers, the optimal line is often obvious (take the lowest risk/gain ratio, shoot ≥0.25). Across a full match it starts to feel samey after ~6 possessions; rival possessions are one click and a bit passive. Needs opponent-specific twists (a high line that punishes Line-breakers less, etc.) to hold a whole match.

## Polish pass
- **Core decision:** push one more pass for a better shot, or shoot now, because every pass raises the risk of the next. Cards show ⚽ *the shot chance after that pass* (receiver's finishing included) and its exact 🔥 cost.
- **Sticky pressure (review fix):** "safe passes to the 5-chain, then shoot" was the obvious line, and one Recycle wiped the clutch start. Now each completed action adds +3, +6, +9… (3 + 3 × passes already in the chain) on top of its own 🔥, Recycle halves pressure and Switch removes 30% (were flat −24 / −14). Sim (40k possessions, plain mode): safe-to-5 drops from 0.074 to 0.064 goals/possession (clutch 0.060 → 0.049), while "shoot when the next pass no longer beats the current shot" stays at 0.082. Shooting early and passing on are both right at different moments.
- **No teleports:** players move only through timed runs; the held ball follows the foot at capped speed. Possessions start with the carrier carrying the ball while the team jogs into shape.
- **Synced contacts** (`view.js`): `pass`, `intercept`, `tackleRun` + `pokeAndCollect`, `beat`. Meeting point first, same arrival time; label, sound, freeze on the contact frame. Challengers come in from the ball's side and slide the last stretch; the contact spot is cleared of bystanders; the ball is drawn on top for 0.7 s; the beaten player stumbles back.
- **Layouts** (`spread`): everyone at least 1.25 bodies from the carrier and 0.9 from each other. Option markers are placed clear of all sprites.
- **Shots** (`shotFx`): result and ball path first. Save: crouch, then a dive that travels through the air and lands with the gloves on the ball. Goal: the keeper dives off the path with at least half a body of daylight (in practice the wrong way). Keepers stay down 0.4 s and get up through `ready` (0.15 s). Wide: keeper fetches it.
- **Kick-off cuts:** the scene fades as one offscreen layer (the shared buzz-cut hair sets its own alpha and stayed opaque before).
- **Defending:** Press/Foul use the nearest Sunbird; Deep Block drops the back line first. Results name the call: "SAVED · Hold Shape 13%", "PRESS WON · 35%", "PRESS BEATEN · 25%".
- **Order and labels:** clock, log, score update after contact. A new label fades any label near it; every new action clears old labels.
- **UI:** picked card stays lit; Named toggle 40 px; all card text ≥ 11 px; Shoot is muted under 10%.
- **Bug:** rAF timestamps older than the fallback timer gave negative dt and a NaN ball; dt is clamped.
- **Dev:** under `?jank=1`, `window.__slow = 0.25` slows the view.
