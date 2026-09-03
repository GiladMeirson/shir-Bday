# Foundations — integration, timestep, and units

The parts of a physics engine that have nothing to do with collisions, but which
decide whether the whole thing is stable or garbage. Get these wrong and no
amount of good collision code will save you.

## The integrator: why semi-implicit Euler

Every body advances by integrating acceleration → velocity → position. There are
several ways to discretize that, and the choice matters more than beginners
expect.

```
explicit (forward) Euler — WRONG for physics:
  position += velocity * dt
  velocity += acceleration * dt      // position used the OLD velocity

semi-implicit (symplectic) Euler — the right default:
  velocity += acceleration * dt
  position += velocity * dt          // position uses the NEW velocity
```

That one-line reordering is the difference between an engine that conserves
energy and one that injects it. Explicit Euler systematically adds a little
energy every step: orbits spiral outward, pendulums swing higher each cycle,
stacks slowly gain motion from nowhere and explode. Semi-implicit Euler is
*symplectic* — it conserves energy on average, so bounded motion stays bounded.
It costs exactly the same. There is almost never a reason to use explicit Euler.

This is why [`scripts/world.js`](../scripts/world.js) integrates in two separate
passes — `integrateForces` (velocity) for **every** body, then
`integrateVelocity` (position) for every body — and never interleaves them
per-body. The order is load-bearing.

**Gravity is an acceleration, not a force.** A feather and an anvil fall at the
same rate, so gravity is added straight to velocity (`v += g*dt`), while applied
and contact forces are divided by mass first (`v += F/m*dt`). See
`integrateForces` in [`scripts/body.js`](../scripts/body.js).

### When to reach for something else

- **Verlet integration** (position + previous-position instead of velocity) is
  better for *connected particle systems* — cloth, rope, soft bodies — because
  constraints compose trivially with it. That is a different tool for a
  different job; this engine's sibling skill `canvas-atelier` uses Verlet for
  exactly that. For rigid bodies with rotation, the velocity-based
  semi-implicit scheme here is the standard.
- **RK4** is more accurate per step but 4× the cost, non-symplectic (it slowly
  loses energy), and painful to combine with collisions that discontinuously
  change velocity. Games essentially never use it. Skip it.

## Fixed timestep — the "Fix Your Timestep" rule

**Never step the simulation by the real frame delta.** Variable `dt` makes
physics non-deterministic (the same inputs give different results on different
machines), and large `dt` after a slow frame or a backgrounded tab makes bodies
teleport through walls and stacks explode.

Instead, accumulate real time and consume it in fixed-size chunks:

```js
accumulator += realFrameDelta;
while (accumulator >= FIXED_DT) {
  step(FIXED_DT);            // always the same dt — deterministic & stable
  accumulator -= FIXED_DT;
}
const alpha = accumulator / FIXED_DT;   // leftover fraction, for rendering
```

[`scripts/world.js`](../scripts/world.js)'s `update(frameTime)` does exactly this.
Two guards matter:

- **Clamp the incoming delta** (e.g. to 0.25 s) before accumulating. Otherwise a
  2-second stall dumps 2 seconds of catch-up steps into one frame — the "spiral
  of death" where each frame runs so many steps it takes longer than real time
  and the accumulator grows without bound. `maxSubSteps` is the hard backstop.
- **Interpolate for rendering.** Because the fixed step rarely lands exactly on
  the frame boundary, draw each body at `lerp(prevPosition, position, alpha)`
  (and `prevAngle → angle`). Without this, motion visibly stutters even at high
  frame rates. `update()` returns `alpha` and the world snapshots
  `prevPosition`/`prevAngle` each step for you.

`FIXED_DT = 1/60` is the usual default. Smaller (1/120) is more accurate and
more stable for fast/stiff scenes at higher CPU cost; larger (1/30) is cheaper
but wobblier.

## The step pipeline — order is not negotiable

One `step(dt)` runs these in this order (see `World.step`):

1. **Broadphase** — refresh AABBs, get candidate pairs.
2. **Narrowphase** — exact tests → contact manifolds; wake sleepers on contact.
3. **Integrate forces** — springs feed the accumulator, then `v += (F/m + g)·dt`.
4. **Prepare + solve velocities** — sequential impulses, N iterations, joints
   and contacts together.
5. **Integrate velocities** — `position += v·dt`.
6. **Correct positions** — push residual overlap out (split impulse).
7. **Clear force accumulators.**
8. **Sleep bookkeeping.**

Common ways to break it: solving velocities *after* integrating position (the
correction lags a frame and everything sinks); detecting collisions *after*
moving (contacts are a step stale); forgetting to clear forces (they accumulate
and bodies rocket away).

## Units and coordinate system

The engine is **unit-agnostic** — it only cares that your units are consistent.
Two workable conventions:

- **Pixels directly.** Positions in pixels, gravity like `{x:0, y:1000}` (≈ a
  brisk fall on screen). Simplest for canvas games. Because a 30 px box then has
  a mass of ~900 (density 1 × area), you rarely tune density — just leave it.
- **Meters, scaled at render.** Positions in meters, gravity `{x:0, y:9.81}`,
  and multiply by a `PIXELS_PER_METER` (say 30–100) only when drawing. Cleaner
  if you think in real-world numbers. Box2D recommends this and suggests keeping
  bodies roughly 0.1–10 m so the solver's tolerances (slop, sleep thresholds)
  are well-scaled.

Pick one and commit. If you work in pixels, bump `restitutionThreshold`,
`sleepLinearTol`, and the correction `slop` proportionally — their defaults are
tuned for smallish numbers.

**Y direction.** HTML canvas has **y pointing down**, so positive `gravity.y`
pulls objects down-screen — natural. All the shape/winding math here is
y-agnostic (`makePolygon` enforces correct winding from signed area regardless),
so you never have to flip anything; just be consistent about which way is "down"
in your gravity vector.
