# Canvas Craft

The rest of the references are about painting. This one is about canvas as a
*medium* — the compositing, layering and colour behaviour that decides whether
correct art direction survives contact with the API.

## Compositing is the painting technique, not a special effect

Painters build up in passes: a shadow glaze over a dry underpainting, a glow
scumbled on top, an edge lifted out. `globalCompositeOperation` is the direct
equivalent, and using it is the difference between painting on canvas and
colouring in shapes.

| Operation | What it's for |
|---|---|
| `multiply` | Shadow and glaze passes. Darkens without washing out the hue underneath — this is how to lay a cast shadow over an already-painted ground so the ground's texture still reads through it. |
| `screen` / `lighter` | Glow, bounce light, specular blooms, fire, mist. `lighter` is additive and clips to white fast; `screen` is gentler and usually the better default. |
| `overlay` / `soft-light` | Colour bleed between neighbouring objects, and warming or cooling a whole region without flattening its values. |
| `source-atop` | Shade *inside* a finished silhouette without re-tracing it: draw the shape, then paint gradients over it and they only land on painted pixels. |
| `destination-out` | Erasing and carving — chewed edges, holes, fading a layer into another, masking without a clip path. |
| `destination-over` | Painting a background *behind* something already drawn, which is often easier than getting the draw order right up front. |

Always `ctx.save()` before changing the mode and `ctx.restore()` after. A leaked
`globalCompositeOperation` is one of the most confusing canvas bugs there is,
because it corrupts drawing code that is itself completely correct.

## The layer stack

Do not paint everything into one context. Build offscreen canvases per concern
and composite them, exactly like layers in a paint program:

```js
function layer(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { canvas: c, ctx: c.getContext('2d') };
}

const base    = layer(W, H);   // local colour and form
const shadow  = layer(W, H);   // shadow pass, composited with 'multiply'
const light   = layer(W, H);   // highlights and rim, composited with 'screen'
const texture = layer(W, H);   // noise and grain

ctx.drawImage(base.canvas, 0, 0);
ctx.save();
ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(shadow.canvas, 0, 0);
ctx.globalCompositeOperation = 'screen';   ctx.globalAlpha = 0.8; ctx.drawImage(light.canvas, 0, 0);
ctx.restore();
```

Three things this buys that are otherwise painful: you can adjust one pass
without redrawing the others, you can tune the strength of the whole shadow or
light pass with a single `globalAlpha`, and you get a free silhouette layer for
the stage-8 critique (see `scripts/critique.js`).

## putImageData ignores clipping

Confirmed by testing, and the most expensive gotcha in the skill. If the region
you're texturing is defined by a clip path, do **not** apply noise with
`getImageData()` + `putImageData()` on the main canvas — `putImageData` ignores
the active clip region entirely and paints noise outside the silhouette. Build
the noise on an offscreen canvas and composite it with `drawImage()`, which
does respect the clip.

The same is true of the whole `ImageData` family: it writes raw pixels, so it
also ignores `globalAlpha`, `globalCompositeOperation` and the current
transform. If any of those matter, go through `drawImage`.

## Gradients interpolate in sRGB — mind the dead zone

Canvas interpolates gradient stops in premultiplied sRGB, channel by channel.
Blending between two hues far apart on the wheel therefore passes through a
desaturated grey in the middle: a warm-to-cool two-stop gradient goes orange →
mud → blue. That is the same muddiness the skill forbids under "never shade
with black", arriving through a back door.

Two fixes:

1. **Insert corrected mid-stops.** Never fewer than 4–5 stops, and make the
   middle ones follow the hue path you actually want. This is what
   `Shading.sphereGradient()` does automatically — it samples and emits every
   stop, so the interpolation never has to travel far between them.
2. **Use a perceptual colour space** where the browser supports it. Modern
   canvas accepts `oklch()` in `fillStyle` and in gradient stops, and OKLCH
   interpolation keeps lightness and chroma perceptually even:
   ```js
   grad.addColorStop(0, 'oklch(0.85 0.12 60)');
   grad.addColorStop(1, 'oklch(0.35 0.09 265)');
   ```
   Feature-detect before relying on it: assign the string to `fillStyle` and
   check that it stuck. An unparsable colour is **silently ignored** by canvas —
   the previous fill stays in effect, nothing throws, and a whole region renders
   in whatever colour happened to be set last.

```js
function supportsOklch(ctx) {
  const prev = ctx.fillStyle;
  ctx.fillStyle = 'oklch(0.5 0.1 200)';
  const ok = ctx.fillStyle !== prev;
  ctx.fillStyle = prev;
  return ok;
}
```

## Crisp lines and soft edges

- A 1px stroke on an integer coordinate straddles the pixel boundary and
  renders as a 2px blur. Offset by 0.5 for hairlines: `ctx.strokeRect(x + 0.5, y + 0.5, w, h)`.
- This does **not** apply to fills, and it does not apply once you're drawing
  organic curves — chasing pixel alignment on a bezier silhouette is wasted
  effort and can reintroduce the mechanical look.
- `ctx.filter = 'blur(Npx)'` is the cheapest soft shadow and the cheapest
  atmospheric haze, but it is expensive per call and it blurs everything drawn
  after it is set. Set it inside a `save()/restore()` pair, and prefer blurring
  a whole offscreen layer once over blurring many small draws.
- `ctx.shadowBlur` + `shadowColor` gives a glow without a second layer, but it
  applies to every subsequent draw call and is slower than compositing a
  pre-blurred layer when there are many shapes.

## Reuse paths, not path code

`Path2D` compiles a path once and re-fills it cheaply — a large win for
anything drawn every frame, and for shapes that get drawn several times per
frame (fill, then stroke, then clip and texture inside):

```js
const leaf = new Path2D();
leaf.moveTo(0, 0);
leaf.quadraticCurveTo(20, -30, 40, 0);
// each frame:
ctx.save(); ctx.translate(x, y); ctx.fill(leaf); ctx.restore();
```

`ctx.clip(path2d)` and `ctx.isPointInPath(path2d, x, y)` both take a `Path2D`
directly, which is what makes the "shade inside the silhouette" workflow cheap.

## Performance, in the order that actually matters

1. **Don't redraw what didn't change.** A static background on its own canvas
   element, drawn once, beats any amount of micro-optimisation in the loop.
2. **Batch by state.** Changing `fillStyle`, `filter` or composite mode is far
   more expensive than another `fill()`. Draw all the shapes that share a state
   together.
3. **`save()`/`restore()` are not free** — they push the whole state. In a tight
   particle loop, resetting the two properties you changed is cheaper.
4. **Size the canvas once.** Assigning to `canvas.width` or `canvas.height`
   clears the canvas *and* resets the entire context state, including the HiDPI
   transform from `scripts/canvas-setup.js`. Resizing inside a resize handler
   without re-applying that transform silently un-does the crispness fix.
5. **`getContext('2d', { alpha: false })`** for anything with an opaque
   background — it skips per-pixel blending against the page.
6. **Reach for `OffscreenCanvas` + a worker** only when the piece is genuinely
   heavy; the layer split in this file usually gets there first.

## Quick reference

| Instead of | Do |
|---|---|
| Drawing every pass into one context | An offscreen layer per concern, composited |
| A flat dark shape for a cast shadow | A shadow layer composited with `multiply` |
| Re-tracing a silhouette to shade inside it | `source-atop`, or `clip()` with a stored `Path2D` |
| `putImageData` for noise inside a clip | Offscreen noise composited with `drawImage` |
| A 2-stop gradient between distant hues | 4–5 sampled stops, or `oklch()` stops |
| Trusting a colour string parsed | Feature-detect — invalid colours are silently ignored |
| Rebuilding paths every frame | `Path2D`, built once |
| Resizing the canvas and carrying on | Re-apply the HiDPI transform after any resize |
