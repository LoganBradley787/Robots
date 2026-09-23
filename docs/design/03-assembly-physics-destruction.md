# 03 Assembly, physics, and destruction

Status: draft, 2026-09-22. Items tagged (Q#) depend on an open question in `07-open-questions.md`. Rapier specifics are in `08-tech-stack.md` and `docs/research/rapier2d.md`.

## Two graphs, not one
- Attachment graph: which cells are physically connected. Two adjacent cells are attached when both mark the shared face as attachable (after rotation). Flood fill over this graph gives chunks. Chunks are the unit of power sharing, control, and splitting.
- Body partition: inside a chunk, joint parts (wheels now, rotators later) are boundaries. Each side of a joint is a body group with its own rigid body. A chunk with only welded parts is exactly one body group.
- Reason for the split: a missile on a rotator is still part of the robot electrically and for control, but it is a separate rigid body.

## Attachment rules
- Frame, core, battery, warhead: all four faces.
- Wheel: only its mount face. A wheel is always a leaf.
- Thruster: not the nozzle face.
- Propeller: not the lift face.
- Decoupler: all four while armed. After firing, its release face is non-attachable, which is what causes the split.
- The validator reports any part with zero attached faces and any part not reachable from the primary core.

## Compound bodies
- One dynamic rigid body per body group.
- One box collider per cell, sized to the cell, with the part's explicit mass (`ColliderDesc.cuboid(hx, hy).setTranslation(x, y).setMass(m)`). Rapier sums center of mass and inertia from the colliders, so weight distribution is real. Verified on a 3x3 grid in `docs/research/rapier2d.md`.
- Rapier colliders have no user data. `physics/` keeps a side table from collider handle to part instance id (and body handle to body group). Handles are opaque floats; never round or format them.
- Removing a collider does not update the body's mass or center of mass until the next step or an explicit `recomputeMassPropertiesFromColliders()`. Call it after every removal so the split math below sees correct centers. A body left with zero colliders has mass zero and sleeps; destroy it.
- The body's translation is the body group's origin cell; parts keep their local offsets. Render reads body position and angle and draws sprites at local offsets.

## Joint parts
- Wheel: its own body with a ball collider (radius 0.45 tile so it does not catch on adjacent cells), high friction. A revolute joint at the cell center connects it to the parent group (`JointData.revolute(anchorInParent, anchorInWheel)`, `createImpulseJoint(data, parent, wheel, true)`). Motor in velocity mode: `configureMotorVelocity(speed * maxSpeed, factor)` with `setMotorMaxForce(maxTorque)` from `behaviorConfig`. Speed 0 with the motor enabled acts as a brake.
- Motor model: Rapier defaults to acceleration based (mass independent). Use `configureMotorModel(ForceBased)` so heavy robots need stronger wheels and the torque cap means something. Exposed in `behaviorConfig` so it can be flipped during tuning.
- Rotator (later, Q5): same joint with `configureMotorPosition(targetAngle, stiffness, damping)`; critical damping is about `2 * sqrt(stiffness)`. Parts attached on its rotating face form the other body group.
- Joints anchor to bodies, so when a body group is destroyed or split, `removeRigidBody` drops its joints and `physics/` re-creates them against the new bodies.

## Forces
- Thruster: force = `throttle` times `maxForce` along the part's thrust direction rotated into world space, at the part's world position.
- Propeller: same, along the part's lift direction. No physical rotation, no torque beyond the off-center force.
- Application: per tick, `applyImpulseAtPoint(force * dt, point, true)`. Rapier's `addForce` and `addForceAtPoint` persist and accumulate across steps (600 calls of 30 N left 18,000 N on a body in the spike), so `physics/` never uses them. Impulses are stateless and equivalent for a single step.
- Forces are only applied when the resource pool grants energy (see `05`).

## Solver settings
- SI units, gravity `(0, -9.81)`, `world.timestep = 1/60`. 1 CCD substep, sweep CCD on (0.20.0 defaults).
- `numSolverIterations = 8`, `numInternalPgsIterations = 8` (changed from the 4 and 1 defaults in M1, 2026-09-23). Measured with the car blueprint dropped 1.5 m: the defaults let the 9 kg body rebound off its 1.5 kg jointed wheels at 4.3 m/s and tilt 2.6 degrees, settling after 1.9 s; 8 and 8 give 0.6 m/s, 0.07 degrees, and 0.65 s. Substepping (two steps of dt/2) helped less per unit of cost. Contact stiffness (`contact_natural_frequency`) made no difference: the rebound comes from the joint solve, not the contact.
- Only `World` and `EventQueue` need `.free()`. Bodies, colliders, and joints are owned by the world.

## Terrain (Q6)
- v1 world file: a flat static ground plus an optional list of static boxes and ramps. Loaded from JSON.
- Targets and obstacles can simply be core-less blueprints spawned as static or dynamic props, so destruction works on them for free.

## Health and damage
- Every `PartInstance` has `health` from its def (v1: 1).
- Damage sources call `damage.apply(partId, amount, cause)`. Application is queued and resolved in the damage phase, never mid-step.
- v1 source: warhead explosions only (decided, Q11 and Q17). Batteries do not explode and there is no impact damage. Impact damage is a later `DamageModel` behind the same interface, so landing hard does not shatter robots at 1 HP.

## Cell removal pipeline
Runs in the damage phase, after the physics step:
1. Collect all parts with `health <= 0` this tick.
2. Remove their colliders and mark them dead. Fire `PartDestroyed`. Run `onDestroyed` behaviors (a warhead queues an explosion).
3. For each touched chunk, re-run flood fill.
4. Capture each affected body's center of mass, linear velocity, and angular velocity before any mutation.
5. If the chunk is unchanged apart from removed cells, keep its body but recompute mass properties and correct its velocity (see below), because Rapier keeps the center-of-mass velocity numerically unchanged when the center of mass moves.
6. Otherwise, for each new component create a new body at the parent's pose with fresh colliders (there is no re-parenting of colliders in the JS API), set its velocity from the captured values, remove the old body (which drops its colliders and joints), re-create joints, and rebuild resource pools. Fire `ChunkSplit`.
7. Recompute the active core per chunk. Chunks without a core latch their actuators (see `04`).
8. Process queued explosions, which may loop back to step 1. Cap at 100 explosions per tick.

## Momentum transfer on split
For every resulting body, including the remainder that kept the parent's handle, with new center of mass `c`, and the parent's pre-mutation center `p`, linear velocity `v`, angular velocity `w`:
- `angvel = w`
- `linvel = v + w x (c - p)`, in 2D: `(v.x - w * (c - p).y, v.y + w * (c - p).x)`
This preserves the velocity field of the rigid motion. The spike in `docs/research/rapier2d.md` showed momentum and energy conserved to four decimals with this rule, and visibly wrong spin without the remainder correction.

## Explosions
- Interface: `ExplosionModel.apply(world, center, params)` returns removed parts and impulses. Pluggable so a better model can replace it.
- Radius query: `world.intersectionsWithShape(center, 0, new Ball(r), callback)` yields collider handles; the side table maps them to parts.
- v1 radius model: every part whose cell center is within `radius` (default 3 tiles) is destroyed. Then every body within `impulseRadius` (default 5 tiles) receives an impulse away from the center with linear falloff. Terrain is immune.
- Triggers (decided): a warhead's `detonate` pulse, a warhead being destroyed (chain reactions between warheads), and a warhead hitting something hard. Impact detection uses `EventQueue` with `ActiveEvents.CONTACT_FORCE_EVENTS` and a per-collider `setContactForceEventThreshold`; the event reports total force magnitude, which is a better trigger than speed.
- Acceptance scenario (Logan's): a long two-wheeled robot with the core at one end drives forward; a bomb (a core-less blueprint of one warhead) is spawned above it mid-air, drops, detonates on impact, and the robot must break cleanly in two, with the core-less half latching its wheel speed.

## Debris
- A chunk with no core is debris. It keeps running latched actuators while it has energy.
- No auto despawn in v1. A "clear debris" command removes core-less chunks that have been at rest for a few seconds.

## Joints are multibody joints (Gate 3, 2026-09-23)
- Robots' revolute joints (wheels) are Rapier multibody joints, not impulse joints. Impulse joints stretch and feed energy back when a driven wheel slips and lands: a car driven off a 1 m ledge bounced higher each time and flipped (6 flips in 23 stress drives, and one drive reached 26 m/s, past the wheels' top speed). Multibody joints: 0 flips in the same drives. `test/stability.test.ts` keeps it that way.
- Rapier's JS API has no motor on multibody joints, so `PhysicsWorld` applies the velocity motor itself each step: torque `min(cap, gain * speed error)` on the wheel and the reaction on its parent. A motor that pushes wakes its bodies, which also fixed a car stuck with a wheel on the ground (its bodies had fallen asleep with the key held).
- Consequence: a robot's bodies are multibody links, and Rapier recomputes link velocities from the joints, so impulses and velocity writes on them are lost. Behaviors push with forces (`addForceAt`) and torques. Explosions (M6) must do the same.
- Multibody joints carry a little damping of their own: coasting from 10 m/s loses about 1.4 m/s in 2 s with the motor slack. It reads as rolling resistance; the wheel's `coastTorque` dropped to 0.3 and `maxSpeed` rose to 50 rad/s to keep the M3 feel (`11`).

## Air drag (M5, 2026-09-23)
- Every robot body gets `F = -0.0025 * cells * |v| * v` and, unless it hangs on a joint, a spin drag `-0.002 * cells * |w| * w` (`PhysicsWorld`, applied as forces so multibody links keep it). Terrain has none.
- Measured: a 3-cell, 4 kg brick falls at a terminal 72 m/s; the hopper under full thrust tops out between 50 and 90 m/s instead of climbing to 20 km; the car's top speed went from 19.1 to 18.1 m/s and coasting from 16 m/s loses 18% in 2 s.
- Spin drag leaves wheels alone: on them it ate the motor's torque near top speed (the car dropped to 16.5 m/s before that exception).
