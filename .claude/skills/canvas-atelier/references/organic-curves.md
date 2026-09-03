# Organic Curves

## Why perfect shapes read as fake

`ctx.arc()` draws a mathematically perfect circle. Nothing organic — a leaf, an eye, a knuckle, a cloud, a wave — is mathematically perfect. The human eye is extremely sensitive to this specific kind of perfection; a shape can have great color and shading and still look like a sticker if the contour is a perfect primitive. Fixing this is cheap: it only requires nudging control points, not redesigning the shape.

## Bezier over arc/lineTo

Replace circles/ellipses with a closed bezier path built from 4-8 points around the desired shape, each with a small, non-uniform random offset:

```js
// scripts/bezier-utils.js — organicBlob(ctx, cx, cy, baseR, opts)
BezierUtils.organicBlob(ctx, cx, cy, 60, {
  points: 8,
  irregularity: 0.12,                       // 8-15% reads organic; 0.3+ reads damaged
  rand: BezierUtils.seededRandom(42),       // seeded, so the shape is stable across frames
});
ctx.fill();
```

Use a seeded PRNG (not `Math.random`) if the shape needs to be identical across redraws/frames — otherwise the silhouette jitters every frame.

The closing loop matters more than it looks. `closedOrganicPath()` walks
**midpoint → vertex-as-control → midpoint**, which keeps the tangent continuous
all the way round. Starting the loop at `points[0]` instead — the obvious way to
write it — makes the first segment's control point coincide with its start, and
a quadratic with `P0 === P1` reduces to `B(t) = P0(1−t²) + t²P2`, a straight
chord. The closing segment then arrives at a different tangent. The result is
one flat edge and one corner on every shape, in the function whose entire job is
to have no geometric tells. It is invisible in the source and obvious in pixels.

Both `organicBlob` and `jitterPoints` take `irregularity` as a **fraction of the
shape's size**, not a pixel offset, so the same 0.12 means the same amount of
wobble at any scale.

## Smooth curve through a set of points (Catmull-Rom → Bezier)

Useful for hand-drawn-looking paths — hair strands, mountain ridgelines, wave crests, tree branches — where you have key points but want a smooth curve through all of them rather than sharp joints from `lineTo`.

```js
// See scripts/bezier-utils.js for catmullRomToBezier(points) — converts an
// array of [x, y] points into cubic bezier control points automatically.
```

## Breaking symmetry between "matching" features

Two eyes, two wings, two wheels — drawn with identical code, they look stamped rather than grown. Vary each instance slightly:

```js
function drawPaired(ctx, drawFn, cx, cy, spacing) {
  drawFn(ctx, cx - spacing, cy, { scale: 0.98, rotation: -0.03 });
  drawFn(ctx, cx + spacing, cy, { scale: 1.02, rotation: 0.02 });
}
```

A 2-5% variation in scale/rotation/position is enough — it reads as natural, not as a mistake. Beyond ~8% it starts reading as asymmetric on purpose (which is sometimes what you want — a wilted flower, an injured wing — but confirm that's the intent).

## How much irregularity is too much

| Irregularity | Reads as |
|---|---|
| 0% (perfect primitive) | Clip art / sticker |
| 5-15% | Natural, organic |
| 15-30% | Rough, hand-drawn, sketchy |
| 30%+ | Damaged, glitchy, or abstract |

Pick the band that matches the brief. Photorealism almost always wants the 5-15% band — enough to kill the "traced with a compass" look, not enough to look sketchy.

## Line weight variation

Real contour lines (and the edges of real objects, via shading) are not constant-width. If stroking a path, vary `lineWidth` slightly along its length, or simulate pressure by drawing 2-3 overlapping passes with slightly different widths and low opacity, thicker on the shadow side of a form and thinner on the lit side.
