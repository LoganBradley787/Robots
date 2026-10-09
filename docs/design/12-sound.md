# 12 Sound

Status: built in M15 (2026-10-08), decided with Logan. Tuning is by ear at the gate.

## What Logan asked for
- The game felt empty without sound: propellers, thrusters, blasts, lasers, guns, wheels, and a thud when something lands.
- Everything synthesized in the browser. No sound files.
- Mechanical and a bit crunchy, no bleeps. The laser is a machine too: a hum, a relay, a crackle.
- Far sounds arrive late (the speed of sound), on a toggle.

## Where it lives
- `packages/app/src/audio/`. `sim-core` knows nothing about audio.
- Sound only reads the sim. It may use wall-clock time and `Math.random`, like the visual effects.
- `SoundScene` is the one object the world screen talks to: `event(ev)`, `frame(world, cam, ...)`, `clear()`.
- The audio context is made on the first click or key press (browsers refuse earlier).

## Sounds are data on the part
- A part def may carry `sound: { run?, hit? }`. The sim carries it untouched and never hashes it.
- `run` names a looping voice: `propeller`, `thruster`, `wheel`, `laser`.
- `hit` names what it sounds like struck or broken: `metal` (when absent), `armor`, `soft`.
- The app never names a part type. A new part gets sound by adding the field. A new voice is one entry in `LOOP_VOICES` (`loops.ts`) and, if a part's channel drives it, one in `LOOP_DRIVES` (`loopLevels.ts`).

## What triggers what
| Sound | From |
|---|---|
| Blast (three sizes by radius) | `explosion` event |
| Part breaking, by material | `partDestroyed` (not exploded, not burnt out) |
| Shell hit, by material | `shellHit` |
| Decoupler clunk | `decoupled` |
| Thud, and a rattle above 8 m/s | `impact` (new in M15) |
| Gun | a shell object not seen before (`ShotWatcher`); the sim logs no event per shot |
| Propeller, thruster | the parts' `throttle` input |
| Wheel | the part's `angularVelocity` over its `maxSpeed`; the rumble is full while the wheel touches something |
| Laser hum and crackle | `world.liveBeams()`: the hum at the barrel, the crackle where it burns |
| Thruster lighting, laser on and off | a loop going from silent to sounding, or back |

- Missiles have no sound of their own (mechanics attach to parts, not kinds of robots). A launch is a decoupler's clunk, then the thrusters lighting.
- The `impact` event: `World.checkImpacts` logs a robot's hardest hit of the tick when a body's velocity changed by more than 2 m/s in one step (`IMPACT_HEARD`), gravity aside. Kicks and blast pushes do not count. Not hashed.

## One-shots
- Each is a recipe in `oneShots.ts`: noise, sines, filters. Rendered once at startup into buffers (`OfflineAudioContext`), two to four takes each, peak 0.9. Playing one is a buffer, a gain, a pan, and a lowpass when it is far.
- Limits (`limiter.ts`): 32 sounding at once, 4 starts of one name per 50 ms (the loudest win), nothing under 0.01 at the ear. A blast always plays, even with every voice taken.

## Loops
- One voice per robot per voice name, never per part. 732 boosters are one burn.
- Loudness is `min(1, 0.3 * sqrt(sum of the parts' levels))`. Pitch and tone follow the mean level of the parts that are on.
- A loop sits at the robot's root body. At most 12 sound at once, the loudest at the ear. Looked at 20 times a second, gliding between.
- A part that needs energy is silent once its robot has none.

## The ear is the camera
- Distance to a sound includes the ear's height, `12 / zoom` meters: zooming out makes everything quieter and duller.
- Gain `20 / (20 + d)`. Lowpass at `20000 / (1 + d / 60)` Hz. Pan by where it is on screen, up to 0.8.
- With `Sound delay` on, a one-shot starts `d / 343` sim seconds late (divided by the time scale). Loops are not delayed.

## Time and controls
- Paused is silent (a 50 ms fade). The builder is silent. A hidden tab suspends audio.
- Fast forward and slow motion never change pitch; things just happen faster or slower.
- Events more than half a second of sim old are not played.
- Toolbar: sound on and off, volume, `Sound delay`. Saved in the browser under `robots.sound`. No key (every world key is also refused as a robot binding by the validator; not worth one).
- `?soundboard`: every one-shot and loop on a button, with distance and zoom sliders, for tuning by ear.
- Debug overlay (`\`): a `sound:` line with the loops and one-shots sounding, the output's peak, and what has played.
