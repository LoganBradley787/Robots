# Gate 8: script speed (M9)

What to try, and what to judge. Play it, then write findings below (or tell Claude).

## Try
1. **The readout.** In the world, turn on Debug (`\`). Two new lines at the top left: frames per second, ticks per frame, and sim ms per tick split into scripts and the rest.
2. **Stress: Hover.** Turn on **Unlimited energy** first (or they run dry and fall after tens of seconds). The world toolbar's **Stress** button, then Hover 25, 50, 100. They appear in rows around the middle of the screen, hovering. Watch the sim ms per tick against the 16.7 ms a frame has. Before M9, 25 was about the limit.
3. **Stress: Battle 6 vs 6.** Two teams of enemy drones (red on the left, blue on the right) track and fire at each other. Watch the numbers while missiles fly.
4. **Everything as before.** Fly your drones, fire missiles, run the silo. Nothing should behave any differently: scripts see exactly the same numbers as before (a test checks every script call in 15 scenes, and every scene ends in exactly the same state as before M9).
5. Optional: `pnpm sim bench` prints the headless numbers (`pnpm sim bench battle`, `pnpm sim bench big` for the others).

## Numbers (headless, this Mac)
| | before | after |
|---|---|---|
| 1 hovering drone | 0.53 ms per tick | 0.17 |
| 25 | 11.2 | 2.9 |
| 100 | 46.2 | 12.6 |
| `flying-silo` | 1.89 | 0.68 |
| 6 vs 6 battle | 7.3 | 4.2 |

In the browser scripts ran about 20 to 40 percent slower than headless: 50 drones 6.2 ms per tick, 100 drones 15.2 ms.

## Flagged for your call
- **At 100 drones the browser has almost no time left to draw.** When a tick costs close to a whole frame, the sim keeps real time by running several ticks in one frame, and the frame rate drops (smooth sim, choppy picture). The other choice is fewer ticks per frame (smooth picture, slow motion). Running the sim in a Web Worker (its own thread) fixes both; it is in `docs/ideas.md`.
- **Part objects are now reused between ticks,** and sealed. A script that keeps a part in `state` sees it move instead of remembering where it was. No script does this; the playbook says to copy what you keep.
- **Team 2 is blue**, not red: each team already had its own tint since M8, so the two sides of a battle can be told apart.
- **The golden hashes** fail the tests whenever any of 15 scenes ends differently. That is on purpose: a change to physics or parts that should change things rewrites them (`UPDATE_GOLDEN=1 pnpm test`) and says why.

## Known issues
- The scripts' own work is now most of the cost (the drone's hover loops over all its parts four times each tick). Faster needs a faster script engine, not more plumbing.
- A script can grow memory without limit by keeping many small objects (the per-script limit only catches big ones). Older than M9, found by the review; a separate fix.
- The Stress menu uses shipped blueprints by name (`missile-drone-10prop`, `enemy-drone`); if either is renamed it shows an error.

## Findings
