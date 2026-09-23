# Gate 4 punch list (power and scripts)

From Logan's first play session, 2026-09-23. Overall positive: the drone hovers, stabilizes, and tilts ("this is promising"); energy with one battery "seems pretty reasonable"; saved his own `weird-thing` blueprint. Not yet explicitly closed: confirm with Logan after the items below.

## 1. The crash notice for the looper is unclear (open)
- Logan: "it immediately stopped and said it ran too long... I don't know what that means... Is that what we expected? I don't know what Looper is supposed to do."
- It is expected: `looper` exists only to prove an endless loop cannot freeze the game.
- Do: reword the budget error in plain words, e.g. "script loop stopped: it never finished its tick (an endless loop?), so it was turned off. The rest of the game keeps running." Make the looper's purpose visible, for example as the first line of its script and in the notice.

## 2. Decoupler and warhead do nothing, and nothing says so (open)
- Logan bound G to pulse the decoupler at 100% and pressed it: nothing. He fell on a warhead: nothing.
- They are placeholders until M6 (destruction), where decouplers separate and warheads explode.
- Do: mark them in the builder until M6. Options: a small "M6" badge on the palette buttons, and a line in the part menu such as "Does nothing yet: decoupling arrives with destruction (M6)". Controls could warn when a binding targets a part with no behavior yet.

## 3. Showcase cannot fly (open, low)
- Logan: "Showcase appears to be too weak to get into the air." It was built at Gate 1 to show every part's art, not to fly.
- Do: either make it a working demo (enough lift, perhaps a hover script) or say it is a look-only robot. Ask Logan which he prefers; recommend making it work.

## 4. Propellers stacked on propellers (open, investigate)
- Logan kept a heavy drone up with nine propellers "using an exploit... where you can place propellers on top of other propellers."
- A propeller at rotation 0 attaches through its S, E, and W faces, so propellers can chain sideways, and a propeller can sit on top of any part with an N face. Check in his `blueprints/weird-thing.json` what he built, decide with Logan whether it is an exploit (for example, should lift from a propeller be blocked by a part right above it?), and fix only if he agrees.

## Noted for later (ideas and future milestones)
- Hover height relative to the ground ("maintain a fixed height over the ground would make more sense... for something that would track you"): needs a ground-distance sensor. Sensor parts are planned (Q2: core built-ins plus sensor parts); an altimeter or downward rangefinder part is the natural first one.
- Enemy drones should not fall out of the air after 2 minutes: upgraded batteries, solar panels, or recharge. Recorded in `docs/ideas.md`.
- Tracking the player, dive bombing, cannons: sensors (M6+), `world.robots()` in the script API, weapons.
