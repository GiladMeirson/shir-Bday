# Collision detection — broad phase, narrow phase, manifolds, rays

Detection answers two questions: *which pairs might touch* (broad phase) and
*do these two actually touch, and where* (narrow phase). Keep them separate —
they have completely different performance characteristics.

## Broad phase — cull the O(N²)

Testing every pair exactly is N·(N-1)/2 work; at 500 bodies that's 125k exact
tests per step and the frame rate dies. The broad phase uses cheap
axis-aligned bounding boxes (AABBs) to reject almost all pairs first, leaving a
few dozen candidates for the expensive exact test.

[`scripts/broadphase.js`](../scripts/broadphase.js) is a **uniform spatial hash
grid**: each body is bucketed into the grid cells its AABB overlaps, and only
bodies sharing a cell become candidate pairs. Near-O(N) when bodies are roughly
uniform in size and spread out.

**Cell size is the one knob.** Set it near the average body *diameter*:
- too small → big bodies span many cells, insertion cost balloons;
- too large → everything lands in one cell and you're back to O(N²).

When the grid is the wrong tool:

| Situation | Better broad phase |
|---|---|
| Bodies vary wildly in size (BB-sized and house-sized together) | Quadtree / loose quadtree — adapts cell size to body size |
| Mostly-static world, few movers | Sweep-and-prune (sort AABBs on one axis, exploit temporal coherence) |
| Huge mostly-empty world | Hash grid is fine — empty cells cost nothing |

A subtlety the grid handles: a pair sharing several cells would be emitted once
per shared cell, so `queryPairs` dedupes through a set keyed by the ordered
index pair.

## Narrow phase — the exact test

[`scripts/collision.js`](../scripts/collision.js) dispatches on shape types and
returns a **manifold** or `null`. The manifold is the entire contract with the
solver:

```
{ a, b, normal, penetration, contacts }
  normal      unit vector pointing FROM a TO b  (a separates along -normal)
  penetration overlap depth along the normal, always >= 0
  contacts    1 point (circles, vertex hits) or 2 (a face-on box rest)
```

**The normal convention is sacred: it always points from `a` to `b`.** Every
function respects it and the dispatcher flips the sign when it swaps argument
order (polygon-vs-circle reuses circle-vs-polygon and negates). Get this
backwards and objects *attract* instead of repel.

### Circle vs circle
Trivial: overlap when centre distance < sum of radii; normal is the line between
centres; contact sits on `a`'s surface. The only trap is exact concentricity
(distance 0) — pick an arbitrary fixed normal so you never divide by zero.

### Circle vs polygon
Work in the polygon's local frame (rotate the circle centre in by `-angle`),
find the face of greatest separation, then classify the circle against that
face's **Voronoi region**: is the nearest feature the face interior, or one of
its two end vertices? Corner hits use the vertex-to-centre direction as the
normal; face hits use the face normal. Missing the corner cases makes circles
catch on polygon edges incorrectly.

### Polygon vs polygon — SAT + clipping
The real machinery. Two parts:

1. **Separating Axis Theorem (SAT)** to find *whether* and *how much* they
   overlap. Two convex shapes are disjoint iff some axis exists on which their
   projections don't overlap. For polygons it suffices to test each polygon's
   face normals. `findAxisLeastPenetration` walks `a`'s faces, using the
   *support point* of `b` (the vertex furthest against each face normal) to
   measure penetration. If any face gives positive separation → no collision,
   bail immediately. The axis of *least* penetration is the collision normal.

2. **Reference/incident face clipping** to find *where* — the contact points.
   Pick the face of least penetration as the "reference" face, find the most
   anti-parallel "incident" face on the other polygon, and clip the incident
   face against the reference face's side planes (Sutherland–Hodgman). The
   clipped points that lie behind the reference face are the contacts — one for
   an edge-corner touch, two for a flat face-on-face rest.

**Why two contact points matter:** a box resting on the ground with a single
contact point would tip and wobble, because the solver can only apply torque
resistance where there's a contact. Two points across the face give a stable
rest. This is the whole reason clipping exists rather than just returning the
deepest point.

**Convex only.** SAT silently returns wrong results for concave polygons. Model
a concave shape as several convex pieces attached to one body (this engine
attaches one shape per body; for compound bodies, keep multiple bodies pinned
with a `RevoluteJoint`, or extend `RigidBody` to hold a shape list).

**The bias in reference-face selection** (`biasGreaterThan`) is not cosmetic:
without it, when two penetrations are nearly equal the reference face flickers
between `a` and `b` frame to frame, and a resting stack visibly jitters. The
0.95/0.01 bias keeps the choice stable across frames.

## Collision filtering — layers, groups, and jointed parts

Not every overlapping pair *should* collide. A player and their own bullet, the
links of a ragdoll, a ghost passing through walls — all need filtering.
[`scripts/body.js`](../scripts/body.js) gives every body:

- **`filterCategory`** (bits) — "what am I": player, enemy, projectile, scenery…
- **`filterMask`** (bits) — "what do I collide with".
- **`filterGroup`** (int) — an override: two bodies with the same non-zero group
  *always* collide if the group is positive, *never* if negative, regardless of
  bits.

Two bodies collide when `(a.category & b.mask) && (b.category & a.mask)` — the
agreement must be **mutual** — unless a matching group overrides it. Example:
players on category `0x0001`, enemies `0x0002`, pickups `0x0004`; make pickups'
mask `0x0001` so only players collect them.

> **Confirmed by testing:** a `RevoluteJoint` pinning two *overlapping* boxes
> was fighting itself until filtering existed — the contact between the pinned
> boxes tugged against the joint and the arm wouldn't swing. Joints therefore
> default to `collideConnected = false`, and the world excludes those pairs from
> narrow phase. If you build ragdolls or vehicles, this default is why adjacent
> limbs don't explode apart. Springs default `collideConnected = true` since
> spring-linked bodies usually *should* still collide.

## Raycasting — the query side

[`scripts/raycast.js`](../scripts/raycast.js) shoots a ray and returns the
nearest hit `{ body, point, normal, t }`. Games use this everywhere:

- **Hitscan weapons** — shoot along the aim direction, apply damage at the hit.
- **Line of sight / AI vision** — ray from enemy to player; if it hits scenery
  first, no sight.
- **Ground / wall sensors** — short ray down to detect "am I standing on
  something" without a physical contact.
- **Mouse picking** — a zero-length ray (point query) to grab a body.
- **The honest fix for fast-body tunneling** — cast the body's motion each step;
  if the ray hits, place the body at the hit instead of past it. See
  `stability-and-tuning.md`; substepping alone can't stop an arbitrarily fast
  bullet.

Use the `filter(body)` argument to skip the shooter itself or restrict to a
layer. Origin-inside-a-circle correctly returns `t = 0` (you're already inside).
