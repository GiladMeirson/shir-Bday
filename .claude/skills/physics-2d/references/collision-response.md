# Collision response — impulses, restitution, friction, correction

Detection found the overlap and the manifold. Response decides how the bodies
*react*: bounce, slide, come to rest. This is where most homegrown engines feel
"mushy" or "explosive", and where the specific algorithm choices matter most.
Implementation: [`scripts/solver.js`](../scripts/solver.js).

## Impulses, not forces

At the instant of contact you don't want to apply a *force* (which changes
velocity gradually over dt) — you want to change velocity *now* so the bodies
stop interpenetrating. That instantaneous change is an **impulse** (a change in
momentum). Applying impulse `P` at contact offset `r` from the centre of mass:

```
velocity        += invMass * P
angularVelocity += invInertia * cross(r, P)
```

The `cross(r, P)` term is what makes off-centre hits spin a body — hit a box on
the corner and it rotates; hit it dead centre and it only translates. This is
`RigidBody.applyImpulse`.

## The normal impulse

For each contact point we compute the **relative velocity along the normal** and
apply just enough impulse to remove the approaching part of it:

```
rv = (vB + ωB×rB) - (vA + ωA×rA)      // relative velocity at the contact
vn = dot(rv, normal)                   // <0 means approaching
j  = -(1 + e) * vn / effectiveMass     // e = restitution
```

`effectiveMass` accounts for both linear and rotational response along the
normal: `invMassA + invMassB + invIA·(rA×n)² + invIB·(rB×n)²`. The heavier or
harder-to-rotate the bodies at that contact, the larger the effective mass and
the smaller the resulting velocity change — exactly right.

**Restitution `e`** is bounciness, 0 (dead thud) to 1 (perfect bounce). The
combined value for a pair is typically `min(eA, eB)` — a superball on concrete
barely bounces because the concrete kills it. `(1 + e)` reverses the approach
velocity and adds the bounce on top.

## Accumulated impulses — the trick that makes rest work

A naive solver computes `j` and applies it once per iteration. It converges
*slowly*, and the symptom is nasty:

> **Confirmed by testing:** with the naive method, a 3-box stack held its
> *position* (positional correction hid the overlap) but every box kept a
> phantom downward velocity of 0.1–0.25 units/s that never decayed, so the stack
> never fell asleep and looked subtly alive. Doubling iterations only halved the
> residual. The fix wasn't more iterations — it was the algorithm.

The **sequential-impulse method with accumulated-impulse clamping** (Erin Catto /
Box2D-lite) is what [`scripts/solver.js`](../scripts/solver.js) uses. Each
contact remembers the *total* normal impulse applied this step; each iteration
computes a *delta*, adds it to the running total, **clamps the total to ≥ 0**,
and applies only the change:

```js
const Pn0 = c.Pn;
c.Pn = Math.max(Pn0 + dPn, 0);   // accumulated impulse can never pull, only push
dPn  = c.Pn - Pn0;               // apply just the delta this iteration
```

Clamping the *accumulated* value (not the per-iteration delta) is the crucial
detail. It lets one iteration over-correct and a later one walk it back, which
converges in a handful of iterations where the naive method needs dozens. After
this change the same stack reached true zero velocity and slept immediately.

`velocityIterations` (default 8) trades cost for solidity: more iterations =
stiffer stacks and tighter joints. Tall stacks or dense piles want 10–20.

## Friction — the Coulomb cone

After the normal impulse, a second impulse along the **tangent** resists
sliding. Coulomb's law caps it: the friction impulse magnitude can't exceed
`μ · normalImpulse`. Below the cap the contact *sticks* (static friction, kills
tangential motion); at the cap it *slides* (kinetic friction, a bounded drag).

```js
let dPt = massTangent * -vt;              // impulse to kill tangential velocity
const maxPt = μ * c.Pn;                   // Coulomb cone, tied to normal impulse
c.Pt = clamp(c.Pt + dPt, -maxPt, +maxPt); // clamp the ACCUMULATED tangent impulse
```

Because `maxPt` scales with the *accumulated* normal impulse `c.Pn`, friction and
the normal solve must run in the right order (normal first) and share the
iteration loop — which they do. The combined coefficient for a pair is
`sqrt(μA · μB)`, so a slick body on a grippy one lands in between. `μ = 0`
gives frictionless ice; `μ ≈ 0.6` is a typical wooden-crate feel.

## Positional correction — split impulse

The velocity solve targets *zero velocity*, not *zero overlap*, so a sliver of
penetration survives every step. Left alone, gravity feeds that sliver back and
a stack slowly sinks. Two ways to remove it:

- **Baumgarte / velocity bias** — add a small "push-apart" velocity proportional
  to penetration into the velocity solve. Simple, but that bias is *real*
  velocity, so bodies gain a little energy and resting contacts feel slightly
  bouncy.
- **Split impulse** (what this engine uses) — correct *position* directly, after
  integration, touching position only and never velocity, so no energy leaks in:

```js
correction = max(penetration - slop, 0) / (invMassA + invMassB) * percent
positionA -= invMassA * correction * normal
positionB += invMassB * correction * normal
```

Two constants:
- **`slop`** (≈0.05) — a tolerance so bodies may rest *fractionally* overlapped
  without twitching. Correcting to exactly zero overlap makes contacts flicker
  on/off and jitter. Never correct below the slop.
- **`percent`** (≈0.2–0.6) — deliberately under-correct. Removing 100% of the
  overlap in one step overshoots and causes popping; bleeding it out over a few
  steps is stable.

## Resting vs. bouncing — the restitution threshold

If you apply restitution to *every* contact, a settling stack buzzes forever:
each frame gravity adds a whisker of approach velocity, `(1+e)` bounces it back,
and it never settles. The fix is a **speed threshold**: below some closing speed
(roughly one frame's worth of gravity, `restitutionThreshold`, default 1.0),
force `e = 0`. Fast impacts still bounce; gentle settling does not.

> **Confirmed by testing:** this threshold plus the accumulated-impulse solver is
> what lets a dropped ball bounce a few times and then rest dead-still, rather
> than either never bouncing or jittering on the floor indefinitely. In large
> pixel units, raise the threshold or slow bounces look dead; lower it if gentle
> impacts should still visibly bounce.
