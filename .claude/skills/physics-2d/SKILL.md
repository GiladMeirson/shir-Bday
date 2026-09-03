---
name: physics-2d
description: Build correct, stable 2D rigid-body physics — gravity, collisions, bouncing, friction, stacking, joints (rods/pins/springs), raycasting, and a deterministic fixed-timestep simulation loop. Use this skill whenever motion must be SIMULATED rather than scripted: a game or animation where objects fall, collide, bounce, pile up, swing, get shot, or respond to forces on a 2D or 3D canvas — even if the user doesn't say "physics engine." Covers rigid-body dynamics, semi-implicit Euler integration, broad/narrow-phase collision (SAT), impulse-based response, restitution and Coulomb friction, constraints/joints, collision filtering, sleeping, and continuous-collision/anti-tunneling. For soft, connected-point aesthetic motion instead (cloth, hair, rope, a flag) use `canvas-atelier`'s Verlet physics; this skill is the rigid-body engine side.
---

# 2D Physics Engine

Most hand-rolled game physics is subtly wrong in ways that only show up later:
objects gain energy and vibrate, stacks explode or sink, fast objects pass
through walls, everything jitters and nothing ever comes to rest, and the
simulation gives different results on different machines. None of this is bad
luck — each is a specific, known mistake with a specific, known fix. This skill
is a small, complete, **tested** rigid-body engine that makes those correct
choices, plus the reference material explaining *why* each choice is the right
one so you can extend or debug it.

This is the "does it behave correctly" side of 2D motion. For the "does it look
alive" side — cloth, hair, rope, a waving flag, organic secondary motion — use
`canvas-atelier`, which uses Verlet integration for connected-point systems.
They compose: simulate rigid bodies here, drape soft details there.

## The engine

Nine modules in [`scripts/`](scripts/), each runnable under Node (CommonJS) and
usable in the browser. Import everything through [`scripts/index.js`](scripts/index.js):

```js
const P = require('./scripts/index.js');
const world = new P.World({ gravity: { x: 0, y: 900 } });   // pixels, y-down

world.add(new P.RigidBody({ shape: P.makeBox(800, 40), position: { x: 400, y: 580 }, isStatic: true }));
const ball = world.add(new P.RigidBody({ shape: P.makeCircle(20), position: { x: 400, y: 60 }, restitution: 0.6 }));

// in requestAnimationFrame, dt in seconds:
function frame(dt) {
  const alpha = world.update(dt);           // fixed-step, deterministic
  // draw each body at lerp(prevPosition, position, alpha)
}
```

| Module | Role |
|---|---|
| `vec2.js` | vector + 2D cross-product math (the cross products are what people get wrong) |
| `shapes.js` | circle / convex polygon, mass + moment-of-inertia, AABB |
| `body.js` | `RigidBody`: state, material, semi-implicit Euler, collision filter bits |
| `broadphase.js` | spatial-hash grid — cull O(N²) pairs to a handful |
| `collision.js` | narrow phase: circle/polygon SAT + contact manifolds |
| `solver.js` | accumulated-impulse solver: restitution, Coulomb friction, split-impulse correction |
| `constraints.js` | joints: distance (rod), revolute (pin), spring |
| `raycast.js` | ray queries: hitscan, line-of-sight, picking, swept CCD |
| `world.js` | the loop: fixed timestep, sleeping, anti-tunneling, filtering |

## Workflow — building a simulation

### 1. Choose units and commit to them
Pixels-directly (gravity ~`{x:0,y:1000}`) or meters-scaled-at-render (gravity
`{x:0,y:9.81}`, ×30–100 when drawing). This decision ripples into every
threshold. See `references/foundations.md`. Canvas is **y-down**, so positive
`gravity.y` falls down-screen — no flipping needed anywhere.

### 2. Drive with the fixed-timestep loop — never the raw frame delta
Call `world.update(realDeltaSeconds)`. It accumulates real time and steps at a
constant `fixedDt`, which is what makes the simulation deterministic and
stable. Stepping by the variable frame delta is the #1 source of "explodes when
the tab was backgrounded" bugs. Interpolate rendering with the returned `alpha`
(`lerp(prevPosition, position, alpha)`) or fast motion stutters.
**Read `references/foundations.md` before writing the loop.**

### 3. Build bodies from shapes
`makeCircle`, `makeBox`, `makePolygon` (convex, any winding — it's normalized
for you). Mass and inertia come from shape + density automatically. `isStatic:
true` for floors/walls (infinite mass). Set `restitution` (bounce) and
`friction` per body.

### 4. Let the world resolve collisions — and filter what shouldn't collide
Adding bodies is enough; the pipeline detects and resolves contacts each step.
Use `filterCategory` / `filterMask` / `filterGroup` for layers (player vs enemy
vs scenery) and to stop things that share space from colliding. **Jointed
bodies overlap and must be filtered** — joints do this by default. See
`references/collision-detection.md`.

### 5. Tie bodies together with joints
`DistanceJoint` (rigid rod / cable), `RevoluteJoint` (pin / hinge — doors,
ragdoll limbs, wheels), `SpringJoint` (soft, bouncy). `world.addJoint(...)`.
See `references/constraints-and-joints.md`.

### 6. Query the world with rays
`world.raycast(origin, dir, maxDist, filter)` → nearest `{body, point, normal,
t}`. Shooting, AI sight, ground sensors, mouse picking, and the real fix for
fast-bullet tunneling. See `references/collision-detection.md`.

### 7. Tune for stability, and let bodies sleep
Squishy stacks → more `velocityIterations`. Tunneling → raycast CCD or thicker
walls. Won't sleep → the contacts are under-converged, not the sleep threshold.
The full failure-mode map is `references/stability-and-tuning.md`.

## Quick reference — do this, not that

| Instead of | Do |
|---|---|
| `position += v*dt` then `v += a*dt` (explicit Euler) | `v += a*dt` **then** `position += v*dt` (semi-implicit) — else energy leaks in and it explodes |
| Stepping by the real frame delta | Fixed-timestep accumulator (`world.update`) — deterministic and stable |
| Snapping render straight to `body.position` | Interpolate with the returned `alpha` — no stutter |
| Treating gravity as a force (`F=mg`, divide by m) | Add gravity straight to velocity — it's an acceleration |
| One contact point for a resting box | Two — via face clipping — or it tips and wobbles |
| Naive "compute impulse, apply once" | Accumulated-impulse clamping — resting bodies reach true zero velocity |
| Restitution on every contact | Suppress bounce below `restitutionThreshold` — else settling buzzes forever |
| Baumgarte velocity bias for penetration | Split-impulse position correction — no injected energy |
| Correcting overlap to exactly zero | Leave a `slop` tolerance — else contacts flicker |
| Substepping to stop a fast bullet | Raycast its path (swept CCD) — substepping has a speed ceiling |
| Letting jointed bodies collide | `collideConnected: false` (joint default) — else the contact fights the joint |
| Concave polygon into SAT | Split into convex pieces — SAT silently returns garbage otherwise |
| Simulating a settled pile every frame | Sleeping — settled bodies should cost nothing |

## When to open the reference files

- Setting up the loop, choosing an integrator, units, or the y-down convention;
  "why does my sim gain energy / behave differently each run" →
  `references/foundations.md`
- Broad-phase tuning, SAT / manifolds, raycasting, or collision layers &
  filtering → `references/collision-detection.md`
- Bouncing, friction, why a stack is squishy or won't rest, restitution vs.
  resting → `references/collision-response.md`
- Rods, pins/hinges, springs, ragdolls, vehicles, chains → `references/constraints-and-joints.md`
- Tunneling, jitter, sleeping, energy drift, explosions, or any "it looks
  wrong" tuning question → `references/stability-and-tuning.md`

The engine is verified by Node smoke tests (free-fall, resting, stacking +
sleep, friction, anti-tunneling, distance/revolute/spring joints, filtering,
raycasting, rotated polygon collision). When you change a script, re-run that
kind of check — physics regressions are easy to introduce and hard to eyeball.

This scales down fine: a single bouncing ball needs only `World` + one
`RigidBody` + the fixed-step loop. It scales up to hundreds of interacting
bodies with the broad phase and sleeping doing the heavy lifting. What it does
*not* do is scale to zero rigor — the "just move it a bit each frame" shortcut
is exactly what produces the energy-gaining, wall-tunneling, never-resting mess
this skill exists to avoid.
