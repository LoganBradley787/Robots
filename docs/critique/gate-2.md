# Gate 2 (Builder) punch list

Opened 2026-09-23 at tag `m2`. Logan: "Okay, this is pretty good. I'm liking the robot interface."

1. **D must drive, not toggle debug.** "I definitely want to be able to use D to drive the thing and not D for debug ... your main controls are A and D to move left and right. Debug can be some random key ... | for all I care." Rule adopted: every letter and digit belongs to the robot. World keys move to punctuation: `\` debug outlines, `` ` `` grid, `,` camera (re-follow, or next robot when already following). Space, `.`, `[`, `]` stay (pause, step, speed). Reset has no key (too easy to hit); a clickable world toolbar carries every world control, and Reset asks first. The builder refuses to bind a world key and says why, and new controls default to D, then A. Status: done, verified in the browser (`\` toggles debug, `d` does nothing in the world, binding Space is refused with an explanation, D binds).
