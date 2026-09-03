# Constraints and joints — rods, pins, springs

A joint ties bodies together with a rule the solver enforces every step: "stay
this far apart", "keep these two points together", "pull toward this rest
length". Mechanically a joint is just another velocity constraint solved in the
same iteration loop as contacts — a contact is the special case "don't
overlap". Implementation: [`scripts/constraints.js`](../scripts/constraints.js).

## Anchors are local points

Every joint attaches at a **local anchor** on each body — a point in the body's
own frame that rotates with it. `{x:0, y:0}` is the centre of mass; an offset
anchor lets a joint apply torque (a rod attached to a box's corner will spin the
box). To pin something to a **fixed point in the world**, make one side a static
body positioned at that point — a static body has infinite mass, so it's an
immovable anchor.

## DistanceJoint — rigid rod / fixed link

Keeps the two anchors exactly `length` apart. Unlike a contact (which only
pushes), a distance joint both **pushes and pulls** — it's a rigid rod, or a
taut cable if you only care about the pull direction. Omit `length` to freeze
the current separation.

The solve is a 1-D velocity constraint along the line between anchors: compute
the relative velocity of the anchors *along* that line, and apply an impulse
that drives it (plus a small position-error bias) to zero. This is the simplest
joint and the template for the rest.

**Uses:** pendulums, chains (many distance joints in a row), a bridge plank
suspended from two ropes, keeping a camera target a fixed distance from a body.

> **Confirmed by testing:** a pendulum built from one `DistanceJoint` held its
> rod length to within 0.014 units over 20 seconds of swinging and never gained
> energy — the position-error bias (`beta`, default 0.2) corrects drift without
> pumping the system. Chains of distance joints need more `velocityIterations`
> (10–20) to stay taut, because each joint can only see its neighbours and the
> stiffness propagates one link per iteration.

## RevoluteJoint — pin / hinge

Forces the two anchor points to **coincide** while letting the bodies spin
freely about that shared point. This is the hinge for doors, the shoulder/elbow
of a ragdoll, the axle a wheel rotates on, the pivot of a seesaw.

It's a **2-DOF** constraint (the anchor must match in both x and y), so instead
of a scalar it solves a 2×2 "effective mass matrix" **K** each iteration:

```
K = [ mA+mB + iA·rAy² + iB·rBy²      -iA·rAx·rAy - iB·rBx·rBy ]
    [ -iA·rAx·rAy - iB·rBx·rBy        mA+mB + iA·rAx² + iB·rBx² ]

impulse = -K⁻¹ · (relativeAnchorVelocity + positionBias)
```

where `m` is inverse mass, `i` is inverse inertia, `r` is the anchor offset. The
off-diagonal terms couple x and y through rotation — that coupling is exactly
what lets the pin transmit the sideways reaction that keeps a swinging arm's end
fixed. `prepare` builds and inverts K once per step; `solveVelocity` applies it
each iteration.

> **Confirmed by testing:** an arm pinned at one end swung down under gravity
> like a real hinge, holding the pin gap under 0.01 units. It only worked once
> **collision filtering** existed — the pinned bodies overlap, so their contact
> was fighting the joint. Joints default `collideConnected = false` for this
> reason (see `collision-detection.md`). If a hinged pair explodes apart or
> refuses to move, that default being lost is the first thing to check.

## SpringJoint — soft, springy link

Unlike the rigid joints, a spring is a **soft force**, not a hard constraint: it
can stretch, compress, and oscillate. It applies a damped Hooke's-law force
along the anchor line:

```
F = -stiffness · (currentLength - restLength)   // restoring toward rest
    - damping · relativeVelocityAlongAxis        // bleeds off oscillation
```

Because it's a force, it feeds the accumulator **before** integration (the world
calls `applyForces` first), which keeps it compatible with semi-implicit Euler.

- **`stiffness`** — how hard it pulls back. High = stiff/twangy (and can go
  unstable if too high for the timestep — see below); low = loose and floppy.
- **`damping`** — how fast oscillation dies. Zero springs bounce forever; too
  much makes it feel like molasses.

> **Confirmed by testing:** a mass hung on a spring settled to its analytic
> equilibrium (`stretch = m·g / stiffness`) and came to rest — the damping term
> is what makes it *settle* rather than oscillate indefinitely.

**Stiffness vs. timestep — the stability limit.** An explicit spring goes
unstable when `stiffness · dt² / mass` gets close to ~1 (the spring pushes so
hard in one step that it overshoots further than it started, and the oscillation
grows). If a spring the sim explodes, either lower stiffness, raise damping,
shrink the fixed timestep, or — for a truly rigid link — use a `DistanceJoint`
instead, which is unconditionally stable because it's solved as a constraint.
`collideConnected` defaults to **true** for springs (spring-linked bodies
usually should still collide).

## Composing joints

- **Rope / chain** — a line of `DistanceJoint`s between bead bodies; pin the top
  bead to a static anchor.
- **Ragdoll** — body per limb, `RevoluteJoint` at each joint (neck, shoulders,
  hips, knees). Filtering keeps adjacent limbs from colliding; give the whole
  doll a shared negative `filterGroup` so no two of its parts ever collide.
- **Vehicle** — chassis body, a wheel body per axle joined by a `RevoluteJoint`,
  optionally a `SpringJoint` in parallel for suspension travel.
- **Motors / limits** (not built in) — a driven joint (motor) adds a target
  velocity to the constraint; an angle limit clamps the accumulated impulse to a
  range. Both are natural extensions of the `RevoluteJoint` solve if you need
  them; they follow the same accumulated-impulse pattern as contacts.
