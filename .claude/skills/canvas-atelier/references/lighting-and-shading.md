# Lighting and Shading

## Compute it, don't eyeball it

Everything below describes the model qualitatively, and every number in the
hand-written examples is picked by feel. `scripts/shading.js` computes the same
model from a surface normal and a light vector, so the gradient stops are a
result rather than a guess:

```js
const light = Shading.light(225, 35);   // azimuth 225° = upper left, 35° out of the screen
ctx.fillStyle = Shading.sphereGradient(ctx, cx, cy, r, [15, 65, 52], light);
ctx.fill();
```

It already folds in the two colour rules from `color-theory.md` — shadow
temperature derived from the light's temperature, peak chroma at the terminator
— and it will not produce a black shadow or a blown highlight.

**Cylinders are where this matters most.** Limbs, tree trunks, bottles,
columns, fingers and rolled sleeves are all cylinders. A cylinder's terminator
sits exactly where `N·L = 0` and its falloff is `cos θ`, not a linear ramp;
hand-placed stops put the terminator in the wrong place and ramp it linearly,
which is why canvas limbs come out looking like painted tubes. There's a second
trap: a cylinder's cross-section normal is perpendicular to its own axis, so its
shading genuinely does not depend on the light's component along the axis.
Shading a limb as if it were a sphere — which does depend on it — reads wrong
immediately even when the colours are right.

```js
ctx.fillStyle = Shading.cylinderGradient(ctx, shoulderX, shoulderY, elbowX, elbowY, radius, base, light);
```

Read the rest of this file to understand *what* is being computed and to shade
anything the two helpers don't cover.

## The model

Every convincingly-lit shape on canvas needs four things, all consistent with one chosen light direction:

1. **Highlight** — the brightest point, closest to the light source, often slightly desaturated/whitened rather than pure white.
2. **Core shadow** — the darkest band, located on the side facing away from the light, at the terminator between lit and unlit surface (not at the very edge of the shape — that's a common mistake).
3. **Cast shadow** — the shadow the object throws onto whatever is behind/below it. Softer and more spread out the further it falls from the object; sharper close to the contact point.
4. **Ambient occlusion** — extra darkening wherever two surfaces meet or a surface curves away from all light (e.g. where a sphere touches the ground). This is what stops shapes from looking like they're floating.
5. **Rim/bounce light** — a thin, subtle light edge on the shadow side, from light bouncing off the environment. Skip only for objects in a totally dark void.

Pick the light direction FIRST — as an angle or a vector — and derive all five from it. If the highlight is top-left, the core shadow must be bottom-right, no exceptions.

## Never shade with black

Mixing black into a color desaturates and muddies it in a way real shadows don't. Instead, shift the same hue darker and slightly cooler (shadows skew toward blue/violet in most ambient lighting):

```js
// Given a base color as HSL, derive a believable shadow color
function shadowColor(h, s, l, { darken = 25, coolShift = 8, desaturate = 5 } = {}) {
  return `hsl(${h + coolShift}, ${Math.max(0, s - desaturate)}%, ${Math.max(0, l - darken)}%)`;
}
// base skin tone: hsl(25, 60%, 70%)  ->  shadow: shadowColor(25, 60, 70) => hsl(33, 55%, 45%)
```

## Multi-stop radial gradient for a lit sphere

The single highest-impact technique for "why does this look plastic instead of real": don't use a 2-stop gradient. Use 4-5 stops so the falloff has a believable curve.

```js
function drawLitSphere(ctx, cx, cy, r, hue) {
  // light source assumed upper-left; highlight offset accordingly
  const hlX = cx - r * 0.35, hlY = cy - r * 0.35;
  const grad = ctx.createRadialGradient(hlX, hlY, r * 0.05, cx, cy, r * 1.15);
  grad.addColorStop(0.00, `hsl(${hue}, 40%, 92%)`);   // highlight, desaturated-bright, not pure white
  grad.addColorStop(0.25, `hsl(${hue}, 65%, 70%)`);   // lit surface
  grad.addColorStop(0.55, `hsl(${hue}, 70%, 48%)`);   // mid-tone
  grad.addColorStop(0.80, `hsl(${hue + 8}, 60%, 28%)`); // core shadow, cool-shifted
  grad.addColorStop(1.00, `hsl(${hue + 8}, 45%, 18%)`); // deepest shadow at the rim
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // rim light: thin arc on the shadow side, opposite the highlight
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.98, Math.PI * 0.15, Math.PI * 0.75);
  ctx.strokeStyle = `hsla(${hue}, 50%, 80%, 0.15)`;
  ctx.lineWidth = r * 0.04;
  ctx.stroke();
  ctx.restore();
}
```

## Cast shadow with correct falloff

```js
function drawCastShadow(ctx, objX, objY, objR, groundY, lightAngle) {
  // project shadow away from the light, elongated and softened with distance
  const dx = Math.cos(lightAngle), dy = Math.sin(lightAngle);
  const shadowLen = objR * 2.2;
  const grad = ctx.createLinearGradient(objX, groundY, objX + dx * shadowLen, groundY + dy * shadowLen * 0.3);
  grad.addColorStop(0, 'rgba(0,0,0,0.35)');   // darkest near contact point
  grad.addColorStop(1, 'rgba(0,0,0,0)');       // fades to nothing
  ctx.save();
  ctx.filter = 'blur(4px)';
  ctx.beginPath();
  ctx.ellipse(objX + dx * shadowLen * 0.4, groundY, shadowLen * 0.5, objR * 0.35, 0, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();
}
```

## Ambient occlusion contact shadow

For any object resting on a surface, add one extra tight, dark, soft ellipse right at the contact point regardless of the main cast shadow — this single detail does more to "ground" an object than almost anything else:

```js
function contactShadow(ctx, x, y, width) {
  const grad = ctx.createRadialGradient(x, y, 0, x, y, width / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.4)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.beginPath();
  ctx.ellipse(x, y, width / 2, width / 8, 0, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
}
```

## Material quick notes

- **Skin**: warm mid-tones, soft/wide highlight (never a sharp specular dot), subsurface scattering look = slightly reddish transition in shadow areas rather than straight-to-brown.
- **Metal**: highlight is small, sharp, near-white; shadow side often reflects environment color rather than going neutral dark; high contrast overall.
- **Glass/water**: highlight is very sharp and small; add a secondary, dimmer highlight opposite it (light bouncing through); shadow is mostly about refraction distortion, not darkness.
- **Cloth/fabric**: many small, soft core-shadows following folds rather than one large one; avoid a single smooth gradient across the whole surface.
