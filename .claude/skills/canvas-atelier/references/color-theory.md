# Color Theory

## Constrain the palette before anything else

Painters work from a limited palette — often three or four pigments plus white —
not because of scarcity but because it is what makes a picture cohere. Every
colour mixed from the same small set shares a common cast, so unrelated objects
look like they're standing in the same light.

Choosing a hue independently per object is the opposite of that, and it is one
of the most reliable tells of generated art: a scene where the apple is pure
`hsl(0, 90%, 50%)`, the leaf is pure `hsl(120, 90%, 40%)` and the sky is pure
`hsl(210, 90%, 60%)` reads as a set of stickers on a background, no matter how
well each individual object is shaded.

Pick 3–4 base hues at the start of the piece and derive every colour in it from
them by shifting lightness and saturation, blending between them, or tinting
toward the ambient light. If something needs to stand out, spend the *accent* —
one small area of a hue outside the set, placed at the focal point.

```js
// A palette is a decision, made once, that everything else refers back to.
const palette = {
  dominant:  [ 25, 55, 55],   // the hue most of the canvas is built from
  secondary: [200, 40, 45],   // supports and cools; usually the shadow family
  neutral:   [ 35, 12, 62],   // low-chroma connective tissue
  accent:    [355, 78, 52],   // used ONCE, small, at the focal point
};

// Everything else is mixed, not invented.
function mixHue(a, b, t) {
  const d = ((b[0] - a[0]) % 360 + 540) % 360 - 180;   // shortest way round
  return [(a[0] + d * t + 360) % 360, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
const foliage = mixHue(palette.dominant, palette.secondary, 0.6);
```

A quick test: list every distinct hue in the finished piece. More than about
five families, and the palette was never really chosen — it accumulated.

Two useful starting schemes when there's no brief to follow: **analogous plus
accent** (three neighbouring hues plus one small complement — calm, natural,
very forgiving), or **split-complementary** (one dominant hue plus the two
neighbours of its complement — livelier, harder to balance). Both give
harmony for free in a way three arbitrary hues never do.

## Warm/cool contrast is relative, not absolute

`lighting-and-shading.md`'s default shadow formula cool-shifts by a fixed amount — a reasonable default, but the actually-correct rule is relative to the light source's own temperature. Simultaneous contrast means the eye exaggerates the opposite temperature in adjacent shadow: if the light is warm (sunlight, candlelight, incandescent bulbs), shadows read as cooler/bluer by contrast. If the light is already cool (overcast sky, fluorescent, moonlight), shadows shift warm instead. Always derive the shadow's temperature shift from the light's temperature, not a constant.

```js
function shadowTemperatureShift(lightIsWarm) {
  // hue to blend toward in shadow regions
  return lightIsWarm ? 220 /* cool blue */ : 30 /* warm orange */;
}
```

## Chroma peaks at the mid-tone, not the extremes

A common mistake is making the darkest shadow the most saturated color in the piece (or the highlight the most saturated). In reality, saturation is usually highest at the core-shadow *transition* zone — the terminator, where local color is least diluted by either direct light or ambient bounce — and drops toward both the highlight (diluted toward white by direct light) and the deepest shadow (diluted toward neutral dark by ambient/bounce light).

```js
function chromaProfile(t) {
  // t: 0 = highlight, 1 = deepest shadow. Returns a relative saturation multiplier.
  const peak = 0.6, spread = 0.35; // peaks around the core-shadow transition
  return Math.max(0.35, 1 - Math.pow((t - peak) / spread, 2));
}
```

Apply this as a multiplier on the saturation (`s`) value when building a gradient's HSL stops, instead of a flat or linear saturation ramp.

## Local color vs. perceived color

An object's local color (its true pigment/material hue) is never quite what reaches the eye — ambient light color always tints it, and nearby objects bounce a little of their own color onto each other. A white object in a room with warm walls picks up warm bounce light on its shadow side; a red object near a blue object subtly tints the blue object's near-facing edge slightly warm, and vice versa.

Practical technique: after finishing an object's base shading, add one subtle, low-opacity overlay pass using the dominant nearby color, restricted to the side of the object facing that neighbor (clip to that region, then fill at low alpha with `globalCompositeOperation = 'overlay'` or `'soft-light'`). This single pass does more to make objects feel like they share one scene than almost anything else.

```js
function colorBleed(ctx, clipPath, bounceColor, strength = 0.12) {
  ctx.save();
  ctx.clip(clipPath); // clip to just the near-facing region of the receiving object
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = strength;
  ctx.fillStyle = bounceColor;
  ctx.fillRect(-10000, -10000, 20000, 20000); // fill within the active clip region
  ctx.restore();
}
```

## One more trap: canvas interpolates in sRGB

Both rules above describe colours at specific points on a form. Canvas fills the
space *between* your gradient stops by interpolating in premultiplied sRGB,
which drags the midpoint of any wide hue transition through grey. See the
gradient dead-zone section of `canvas-craft.md` — the short version is to emit
more stops (which `scripts/shading.js` does automatically) or use `oklch()`.

## Quick reference

| Mistake | Fix |
|---|---|
| A hue chosen independently per object | 3-4 base hues fixed up front; mix everything from them, spend one accent |
| Fixed cool shadow regardless of light color | Derive the shadow's temperature shift from the light source's own temperature |
| Most saturated color at the highlight or the deepest shadow | Peak saturation at the core-shadow transition zone |
| Every object rendered in isolation, ignoring neighbors | Add a subtle color-bleed overlay from nearby dominant colors |
| Treating local color as the final answer | Always filter local color through the scene's ambient light color |
| A 2-stop gradient between distant hues | More stops, or `oklch()` — sRGB interpolation runs through grey |
