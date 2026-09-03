# Physics and Motion

## When springs and easing aren't enough

`scripts/easing.js` covers single-point motion well — a ball, a UI element, a simple bounce. But anything made of multiple *connected* points that should move as one physically coherent system — cloth, hair, rope, chains, a flag, dangling jewelry — looks disconnected and rubbery if each point just gets its own eased curve. That needs actual position-based physics.

## Verlet integration — the core technique

Verlet integration tracks each point's current and previous position instead of position + velocity. It's simpler than force/velocity integration, more numerically stable, and combines trivially with constraints — exactly what cloth/hair/rope need.

```js
class VerletPoint {
  constructor(x, y, pinned = false) {
    this.x = x; this.y = y;
    this.oldX = x; this.oldY = y;
    this.pinned = pinned;
  }
  update(gravityX = 0, gravityY = 0.4, damping = 0.99) {
    if (this.pinned) return;
    const vx = (this.x - this.oldX) * damping;
    const vy = (this.y - this.oldY) * damping;
    this.oldX = this.x; this.oldY = this.y;
    this.x += vx + gravityX;
    this.y += vy + gravityY;
  }
}

class DistanceConstraint {
  constructor(p1, p2, restLength = null) {
    this.p1 = p1; this.p2 = p2;
    this.restLength = restLength ?? Math.hypot(p2.x - p1.x, p2.y - p1.y);
  }
  solve() {
    const dx = this.p2.x - this.p1.x, dy = this.p2.y - this.p1.y;
    const dist = Math.hypot(dx, dy) || 0.0001;
    const diff = (this.restLength - dist) / dist;
    const offsetX = dx * diff * 0.5, offsetY = dy * diff * 0.5;
    if (!this.p1.pinned) { this.p1.x -= offsetX; this.p1.y -= offsetY; }
    if (!this.p2.pinned) { this.p2.x += offsetX; this.p2.y += offsetY; }
  }
}
```

Run the constraint solver several iterations per frame, not once — a single pass leaves visible stretchiness:

```js
function simulateStep(points, constraints, gravityX = 0, gravityY = 0.4, damping = 0.99, iterations = 8) {
  for (const p of points) p.update(gravityX, gravityY, damping);
  for (let i = 0; i < iterations; i++) {
    for (const c of constraints) c.solve();
  }
}
```

## Cloth / flag

A grid of points connected by structural constraints (each point to its right and below neighbor). Pin whichever edge is physically attached to something rigid — the left column for a flag on a pole, the top row for a hanging tapestry:

```js
function buildCloth(cols, rows, spacing, originX, originY, pinEdge = 'left') {
  const points = [], constraints = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const pinned = pinEdge === 'left' ? x === 0 : y === 0;
      points.push(new VerletPoint(originX + x * spacing, originY + y * spacing, pinned));
    }
  }
  const idx = (x, y) => y * cols + x;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (x < cols - 1) constraints.push(new DistanceConstraint(points[idx(x, y)], points[idx(x + 1, y)]));
      if (y < rows - 1) constraints.push(new DistanceConstraint(points[idx(x, y)], points[idx(x, y + 1)]));
    }
  }
  return { points, constraints, idx };
}
```

Add a diagonal "shear" constraint across every other cell if the cloth stretches into a rhombus instead of draping/rippling naturally.

## Rope, hair, and chains

Same system, just a single chain instead of a grid: one point pinned at the anchor (scalp, ceiling hook, pole top), each subsequent point linked to the previous by one distance constraint. For hair specifically, run 2-3 parallel chains per "strand cluster" with slightly different length/stiffness so they don't all swing in perfect unison — uniform swinging is the number one tell of fake simulated hair.

## Wind and secondary forces

Apply wind as an ACCELERATION into the same per-point update that gravity uses — never as a direct `p.x += ...` / `p.y += ...` offset. A direct position offset has nothing pulling the point back toward rest (`DistanceConstraint` only resists relative distance to neighbors, not absolute drift), so it becomes an unbounded random walk: given enough running time it will eventually tangle the mesh — columns overtaking each other, a self-intersecting silhouette, a flag/cloth that looks like it has "no back side" where it should be folding away from the viewer. Feeding wind in as an acceleration through the same Verlet update as gravity keeps it a bounded oscillation instead, the same way gravity itself stays bounded once a pinned edge and constraints are in place.

Prefer a noise-driven, non-constant strength over a fixed wind vector too — real wind gusts rather than blowing at one steady strength, and a good flag/cloth wave is a *traveling* ripple, not uniform bulk motion:

```js
// Pass the object buildCloth/buildChain returned — it carries cols, rows and
// pinEdge, and the falloff has to follow whichever edge is actually pinned.
const cloth = VerletPhysics.buildCloth(14, 8, 18, 60, 40, 'left');

function frame(time) {
  VerletPhysics.simulateStep(cloth.points, cloth.constraints, 0, 0.08, 0.985, 6,
    (p, i) => VerletPhysics.windAcceleration(i, cloth, noise, time));
  requestAnimationFrame(frame);
}
```

Two things that look like details and are not:

- **The falloff axis follows the pinned edge.** A flag on a pole ramps across
  columns; a hanging curtain ramps down rows. Ramping by column on a top-pinned
  cloth blows hardest *at the anchor*, which is both wrong and hard to spot.
- **A rope or hair strand is a one-column grid**, so any `col / (cols - 1)`
  falloff divides by zero and yields `NaN`. Worse, the natural defensive idiom
  `gx += w.x || 0` swallows it — `NaN` is falsy — so the wind silently becomes
  zero and the strand simply hangs there with nothing thrown and no clue in the
  source. `simulateStep` now throws on a non-finite wind instead.

## Simple collision

```js
function groundCollision(point, groundY, restitution = 0.4) {
  if (point.y > groundY) {
    const vy = (point.y - point.oldY) * restitution;
    point.y = groundY;
    point.oldY = point.y + vy; // reflects velocity with energy loss
  }
}

function circleCollision(point, cx, cy, radius) {
  const dx = point.x - cx, dy = point.y - cy;
  const dist = Math.hypot(dx, dy) || 0.0001;
  if (dist < radius) {
    const push = (radius - dist) / dist;
    point.x += dx * push;
    point.y += dy * push;
  }
}
```

## Rendering the result

Render cloth as a filled mesh of quads/triangles, not lines between points — and shade each quad using the lighting model from `lighting-and-shading.md` based on its *local* orientation (see the fold-curvature technique below), or the cloth reads as a wireframe instead of lit fabric. Render rope/hair by feeding the point positions into `bezier-utils.js`'s `catmullRomToBezier` for a smooth strand instead of straight segments.

### Cheap, effective fold shading

Full 3D normals are overkill for a 2D canvas piece. A cheap proxy that reads correctly: local curvature along the grid (second derivative of position between neighboring points). A point sitting at a local peak relative to its neighbors is a ridge (catches more light); a point at a local trough is a valley (self-shadowed):

```js
function foldCurvature(points, idx, x, y, cols) {
  if (x === 0 || x === cols - 1) return 0;
  const left = points[idx(x - 1, y)], mid = points[idx(x, y)], right = points[idx(x + 1, y)];
  return (left.y + right.y - 2 * mid.y); // positive = ridge, negative = valley
}
```

Map this curvature value to a brightness multiplier per quad and feed it into the shading gradient — this single technique is what separates "flat colored mesh that happens to move" from "fabric that looks like it has real folds."
