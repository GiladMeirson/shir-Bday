# Precision and Form

## Value before color

Painters build in value (dark / mid / light) before committing to color, because if the value structure is wrong, no amount of nice hue choice fixes it. Practical technique: before finalizing colors, block in three value zones as flat fills — shadow-mass, mid-tone, light-mass — and squint-test them. Do the big shapes read correctly at a glance? Only once that's right should hue be applied on top, per the model in `lighting-and-shading.md`.

A literal way to enforce this while working on canvas: render to an offscreen desaturated copy and compare it side by side with the color version, to catch value mistakes hue is otherwise hiding. `Critique.desaturate(canvas)` in `scripts/critique.js` does exactly this, and `Critique.contactSheet(canvas)` puts it next to the flipped, silhouetted and blurred versions in one image — see stage 8.

## Draw through, then occlude

Construction drawing builds the *whole* form, including the parts that will end up hidden, and only then covers them. It sounds wasteful and it is the difference between a far leg that reads as a far leg and one that reads as a mistake.

The reason is that a partly-hidden form's visible sliver is not enough information to place it correctly. Draw only the sliver and you are guessing its angle; draw the whole leg from hip to foot and the visible part is *correct by construction*, because it was derived from a complete form rather than invented to fill a gap.

On canvas this maps directly onto draw order:

```js
// 1. Build every form complete, back to front — nothing clipped yet.
drawLeg(ctx, rig, 'far');      // whole leg, including where the body will cover it
drawBody(ctx, rig);            // painted over it
drawLeg(ctx, rig, 'near');
```

Two consequences worth stating: the far form should be drawn with the *same*
construction code as the near one (a different code path is how the two end up
disagreeing), and anything overlapping needs the far copy pushed back with
atmospheric treatment — see `composition.md` — or overlap alone reads as "in
front of" rather than "further away."

## Lost and found edges

Not every contour should have equal weight. Where an object's value nearly matches its background or its own shadow, the edge should soften or vanish entirely (a "lost" edge) and reappear elsewhere with a crisp, high-contrast line (a "found" edge). This is the single biggest tell between "outlined cartoon" and "painted realism" — a hard, uniform-weight outline around an entire silhouette is the amateur signature.

Rule of thumb: an edge in light against a light background is lost. An edge in shadow against a dark background is lost. An edge at the light/shadow terminator, or where the object meets a strongly contrasting background, is found — and gets the crispest treatment.

```js
function drawEdgeWithLostFound(ctx, points, getLocalContrast) {
  // getLocalContrast(point) => 0 (no contrast, "lost") to 1 (high contrast, "found")
  for (let i = 0; i < points.length - 1; i++) {
    const contrast = getLocalContrast(points[i]);
    ctx.globalAlpha = contrast; // fades toward invisible where contrast is low
    ctx.lineWidth = 0.5 + contrast * 2;
    ctx.beginPath();
    ctx.moveTo(...points[i]);
    ctx.lineTo(...points[i + 1]);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
```

## Perspective and foreshortening — structured / man-made subjects

`organic-curves.md` is about deliberate irregularity for organic subjects. Man-made and structured subjects (buildings, vehicles, furniture, boxes) need the opposite discipline: consistent, correct perspective, not organic wobble.

- Pick vanishing point(s) on a horizon line first, draw every parallel edge of the object converging toward the same point, and only then add detail. Detail added before the perspective lines are locked in is what produces subtly-wrong-looking boxes and buildings.
- Circles/wheels in perspective are ellipses, and how "open" the ellipse looks depends on the vertical distance between the circle's center and the horizon (eye level) — a wheel exactly at eye level reads as a flat line; one far above or below reads as nearly a full circle. Derive the ellipse's squash from that distance, don't pick it arbitrarily.
- Foreshortening: anything pointing toward the viewer (an arm reaching out, a road receding) compresses dramatically along the axis of travel. Draw it noticeably shorter than its "actual" length and rely on overlapping forms plus width to sell depth — length alone reads as merely short, not as coming toward the camera.

Both of the above stop being estimates once there's an actual camera. `scripts/shading.js` has a small one-point projection — set the eye height and focal length, and position, scale and ellipse-squash all fall out of the geometry:

```js
const cam = Shading.camera({ focal: 600, horizonY: 220, originX: 400, eyeHeight: 140 });

const p = cam.project(x, y, z);              // screen position + scale factor
const wheel = cam.groundCircle(x, z, r);     // ellipse params, squash derived not guessed
ctx.ellipse(wheel.cx, wheel.cy, wheel.rx, wheel.ry, 0, 0, Math.PI * 2);
```

`horizonY` is not just where you decide to draw the horizon — it is where every receding line converges, because the scale factor goes to zero with distance and every projected `y` collapses onto it. Placing the horizon *is* choosing that number; you don't need guide lines.

Use `cam.scaleAt(z)` on more than position: line weight, texture frequency and detail density should all recede too. Detail that stays sharp at distance is the fastest way to flatten a scene that is otherwise correctly projected.

## Where this matters most

This level of rigor pays off most for: architectural/vehicle/product illustration (perspective discipline), any silhouette against a busy or similarly-toned background (lost/found edges), and anywhere the feedback is "it looks a little flat" despite otherwise-good color — that's almost always a value structure problem, not a color problem.
