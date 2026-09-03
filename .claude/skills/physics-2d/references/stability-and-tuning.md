# Stability and tuning — the failure modes and their fixes

A physics engine that's *correct* on paper still misbehaves in practice: bodies
tunnel through walls, stacks jitter, things twitch forever and never sleep,
simulations drift or explode. Each has a known cause and a known fix. This is
the troubleshooting map.

## Tunneling — fast bodies pass through thin walls

A body moving faster than its own size per step can be on one side of a thin wall
at step N and fully past it at step N+1, with no step in between where they
overlap — so the collision is never detected. Classic "bullet through paper".

**What this engine does: adaptive substepping** ([`scripts/world.js`](../scripts/world.js)).
When a body would travel more than `ccdSlop × its radius` in one step, that step
is subdivided into up to `maxCcdSubSteps` finer steps so the body can't skip the
wall. This is just finer time resolution — cheap, and it robustly handles
"fast" (a body moving several times its size per frame).

> **Confirmed by testing:** a circle at ~8 units/frame against a 2-unit-wide
> wall was stopped cleanly by substepping. But the method has a **ceiling**: an
> extreme bullet (thousands of units/frame) needs dozens of substeps, more than
> `maxCcdSubSteps`, and still tunnels. Substepping is not a swept solution.

**For true bullets, raycast the path.** The honest fix for arbitrarily fast
objects is *swept* continuous collision: each step, cast a ray (or swept shape)
from the body's old position along its motion; if it hits, place the body at the
hit point instead of integrating past it.

```js
const hit = world.raycast(body.position, body.velocity, speed * dt, b => b !== body);
if (hit) { body.position = hit.point; /* then resolve/stop/bounce */ }
```

This works at *any* speed because it tests the whole path, not samples of it.
Reserve it for the few genuinely fast bodies (projectiles); running it on
everything is wasteful. See `collision-detection.md` for raycasting.

Cheaper mitigations that also help: make walls thicker than any body's
per-step travel, or shrink the fixed timestep globally.

## Jitter — resting bodies twitch and buzz

Small perpetual motion in a stack or a body against the ground. Causes and fixes:

- **Correcting overlap to exactly zero** → contacts flicker on/off. Fix: the
  `slop` tolerance (≈0.05) in positional correction; never correct below it.
- **Restitution on gentle contacts** → settling bodies bounce microscopically
  forever. Fix: the `restitutionThreshold` — no bounce below ~one frame of
  gravity's closing speed.
- **Reference face flickering** between the two polygons on near-equal
  penetration → a resting box shivers. Fix: the `biasGreaterThan` hysteresis in
  SAT (already in `collision.js`).
- **Under-converged contacts** → phantom residual velocity. Fix: accumulated
  impulses + enough `velocityIterations` (see `collision-response.md`).

If jitter persists in a heavy stack, raise `velocityIterations` before anything
else.

## Sleeping — stop simulating what isn't moving

A body whose linear and angular velocity stay below tolerances for
`timeToSleep` seconds is put to **sleep**: skipped by integration and the solver
until something wakes it. This is both a performance win (a settled pile costs
nothing) and a stability win (a sleeping body *cannot* jitter).

Wake conditions ([`scripts/world.js`](../scripts/world.js)): a moving,
non-static body touching a sleeper wakes it; jointed bodies are kept awake so a
pendulum can't freeze mid-swing.

> **Confirmed by testing:** sleeping only became reliable *after* the
> accumulated-impulse solver drove resting velocity to true zero. With the naive
> solver the residual velocity sat above the sleep tolerance forever and stacks
> never slept. If your bodies won't sleep, the real problem is usually
> under-converged contacts, not the sleep thresholds — raise iterations before
> loosening `sleepLinearTol`.

Tunables: `sleepLinearTol`, `sleepAngularTol`, `timeToSleep`. Scale the linear
tolerance up if you work in large pixel units. Set `allowSleep = false` while
debugging so nothing silently freezes and hides a bug.

## Energy drift and blow-ups

- **Gaining energy** (orbits spiral out, stacks slowly come alive) → almost
  always explicit instead of semi-implicit Euler, or a Baumgarte bias that's too
  aggressive. This engine avoids both (symplectic integration + split-impulse
  position correction). See `foundations.md`.
- **Instant explosion** (`NaN`, bodies fly to infinity) → usually deep initial
  overlap (two bodies spawned inside each other resolve with a huge impulse),
  a stiffness/timestep mismatch in a spring, or a mass/inertia of zero where it
  shouldn't be. Spawn bodies already separated; cap correction with `slop` and
  `percent`; keep spring `stiffness·dt²/mass` well below 1.
- **Slow sinking** (a stack gradually descends into the floor) → positional
  correction too weak or overlaps exceeding what one step removes. Raise the
  correction `percent`, raise iterations, or lower the timestep.

## Tuning cheat-sheet

| Symptom | First knob to turn |
|---|---|
| Stacks squishy / sink | ↑ `velocityIterations` (10–20) |
| Fast object tunnels | raycast CCD for that body; or ↑ `maxCcdSubSteps` / thicker walls |
| Resting bodies jitter | check `slop`, `restitutionThreshold`; ↑ iterations |
| Bodies won't sleep | ↑ iterations first, then ↑ `sleepLinearTol` |
| Everything explodes on spawn | separate bodies at spawn; check no deep overlap |
| Spring goes unstable | ↓ `stiffness`, ↑ `damping`, ↓ `fixedDt`, or use a DistanceJoint |
| Bounces feel dead (pixel units) | ↑ `restitutionThreshold` |
| Whole sim non-deterministic | you're stepping by real `dt` — use the fixed-step `update()` |

## Performance notes

- **Broadphase cell size** ≈ average body diameter (see
  `collision-detection.md`). Wrong size is the most common perf cliff.
- **Sleep** aggressively — a level full of settled debris should cost almost
  nothing.
- **Iterations** are the main cost/quality dial. Don't globally crank them;
  raise only if stacks demand it. Most scenes are fine at 8.
- **Fixed timestep** at 1/60 is the default; 1/120 doubles cost for accuracy,
  1/30 halves cost for wobble. Change `fixedDt`, never the per-frame delta.
