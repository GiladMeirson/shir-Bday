---
name: canvas-atelier
description: Achieve photorealistic, gallery-quality drawing and animation on HTML canvas — construction-based shape building, physically-based lighting and shadow, organic bezier curves instead of geometric primitives, procedural texture/noise, and animation-principle-driven motion (easing, squash-and-stretch, follow-through, secondary motion). Use this skill whenever the user asks to draw, illustrate, render, sketch, or animate anything on an HTML canvas element or in a canvas-based artifact, or wants a canvas drawing to look "realistic," "lifelike," "polished," or "professional" — even if they don't use art terminology or explicitly mention this skill. Also use for canvas games, generative art, particle effects, or any visual illustration requiring fine detail.
---

# Canvas Atelier

Most canvas drawings look like clip art — not because the code is wrong, but because they skip straight from "idea" to "final flat shapes." A trained illustrator never draws final lines first: the process happens in stages, and each stage catches mistakes the next stage would otherwise bake in permanently. This skill encodes that process for canvas work.

The temptation under time pressure is to jump straight to final render. Resist it — a rushed block-in-to-final-render is exactly what produces the flat, symmetric, sterile look that gives canvas art away at a glance. Every stage below is cheap; skipping stages is what's expensive.

## Two things that make this different from drawing by hand

**You are drawing without eyes.** An illustrator types no coordinates at all — they put a mark down, look at it, and move it. `ctx.bezierCurveTo(340, 210, ...)` is dead reckoning in an invisible coordinate system, and because every feature is guessed independently the errors don't cancel, they accumulate. Two habits fix this structurally rather than by being careful: **derive coordinates instead of typing them** (stage 3), and **render early and look, not just at the end** (stage 9).

**You can compute.** Shading, perspective and proportion are all arithmetic, and arithmetic is the one thing that doesn't degrade when you can't see the canvas. Wherever this skill offers a computed version of a judgement call, prefer it — `scripts/shading.js` derives gradient stops from surface normals, `scripts/armature.js` asserts proportions before a pixel is drawn.

## Setup — before the first stroke

A canvas sized only in CSS pixels renders at one device pixel per CSS pixel and gets upscaled by the browser — the single most common reason a piece looks soft no matter how careful the shading is, and it's invisible in the source until you actually look at the rendered output. Size the canvas for the display's real pixel density first, using `scripts/canvas-setup.js`:

```js
const ctx = setupHiDPICanvas(canvas, 800, 600); // logical size; draw as if it were exactly this
```

Assigning to `canvas.width`/`canvas.height` later — in a resize handler, say — clears the canvas *and* resets this transform. Re-apply it after any resize.

## Workflow

### 1. Subject — know what you're drawing before you draw it
State the observable facts about the subject first, in a sentence or two: how many of each part, which way each joint bends, what overlaps what, and the two or three proportions that define it. This is the stage that prevents the errors nothing downstream can fix — a bird whose knee bends forward stays wrong through every lighting pass you give it.

Look up the numbers rather than recalling them; `references/proportion-canon.md` has the measured canon for the subjects that actually get requested, each paired with the specific error it prevents. If the host can show you an image, look at a reference before starting — the whole skill otherwise runs on memory.

### 2. Composition and intent — decide what this is about before drawing it
Capture the single line of energy the piece is built around — the line of action through a figure's pose, the sweep of a wave, the lean of a tree in wind — the way a painter's first mark is a loose gesture, not a careful outline. A geometrically accurate block-in with no gesture underneath it reads as static no matter how correct the proportions are.

Decide two more things before placing a shape. **What the eye should land on first**: every later decision — where detail concentrates, where contrast peaks, where the sharpest edges live — should serve that answer. And **the palette**: 3–4 base hues that everything else is mixed from, plus one accent spent at the focal point. Choosing a hue independently per object is one of the most reliable tells of generated art, and it's unfixable later without repainting. See `references/composition.md` and the palette section of `references/color-theory.md`.

### 3. Block-in — armature first, proportions before detail
Build a rig of named landmarks as fractions of the bounding box, then **derive** every other landmark from those instead of typing new coordinates. A derived landmark cannot drift away from its parents, because its position was never a number anyone chose — that's what stops the eye detaching from the head. Use `scripts/armature.js`, assert the canon from stage 1 with `rig.check(...)` / `rig.verify()`, and let it throw before you draw anything.

```js
rig.at('skullTop', 0.5, 0.10).at('chin', 0.5, 0.34);
rig.mid('eyeLine', 'skullTop', 'chin');   // canon, not a guess
rig.verify();
```

Then lay the composition out with simple primitives at low opacity, **render it, and look at it** — `rig.debugDraw(ctx)` puts the landmarks on screen, and landmarks in the wrong place are obvious as dots and invisible as numbers. Fix proportion problems now; they compound painfully if caught later.

Also at this stage: lock in perspective for structured/man-made subjects (`Shading.camera()` in `scripts/shading.js` makes this arithmetic rather than guesswork — see `references/precision-and-form.md`), and decide the value structure (dark/mid/light masses) before committing to hue. Getting value right matters more than getting colour right and is much harder to fix afterward.

### 4. Organic contour — kill the primitives
Replace every straight line and perfect circle/ellipse from the block-in with bezier or quadratic curves. Real edges are almost never perfectly symmetric or perfectly circular. Use `BezierUtils.organicBlob()` / `closedOrganicPath()` / `jitterPoints()`, where `irregularity` is a fraction of the shape's size and 8–15% reads as natural. See `references/organic-curves.md` for how much irregularity reads as organic rather than sloppy, and for deliberately varying "matching" features like a left and right eye.

Draw forms **complete, then occlude** them, rather than drawing only the visible sliver of a partly-hidden shape. A sliver doesn't carry enough information to place correctly, so its angle ends up invented; a whole form drawn back-to-front and painted over is correct by construction. See `references/precision-and-form.md`.

### 5. Light and shadow
Pick ONE dominant light direction before drawing any shading and make every highlight, core shadow and cast shadow agree with it. Then compute the shading rather than eyeballing gradient stops:

```js
const light = Shading.light(225, 35);   // upper-left key, 35° out of the screen plane
ctx.fillStyle = Shading.sphereGradient(ctx, cx, cy, r, [15, 65, 52], light);
```

`scripts/shading.js` folds in the whole model — never black, shadow temperature derived from the light's own temperature, peak chroma at the core-shadow transition. **Use `cylinderGradient` for anything cylindrical** — limbs, trunks, bottles, columns, fingers. A cylinder's terminator sits exactly where `N·L = 0` and falls off as `cos θ`; hand-placed stops put it in the wrong place, which is why canvas limbs come out looking like painted tubes.

`references/lighting-and-shading.md` covers what's being computed, plus cast shadows, contact shadows and per-material notes. Vary edge weight too: edges in light against a light background (or in shadow against a dark background) should soften or vanish, while edges at strong value contrast stay crisp — the lost-and-found-edges technique in `references/precision-and-form.md`.

### 6. Texture and imperfection
A perfectly smooth gradient still reads as fake. Add a subtle noise layer (`scripts/noise.js`) to break up flat gradients, plus small local colour variation and pinpoint specular highlights. Imperfection here is a controlled, deliberate amount, not randomness for its own sake — too much noise looks dirty, too little looks plastic.

**Gotcha confirmed by testing**: if the shape you're texturing is defined by a clip path, do NOT apply noise with `getImageData()` + `putImageData()` on the main canvas — `putImageData` ignores the active clip region entirely and will paint noise outside the intended silhouette. Build the noise on a separate offscreen canvas and composite it back with `drawImage()`, which does respect clipping. This generalises: see the compositing and layer-stack sections of `references/canvas-craft.md`, which is also where the painterly uses of `globalCompositeOperation` live — `multiply` for shadow passes, `screen` for glow, `source-atop` to shade inside a finished silhouette.

### 7. Animation — if motion is involved
Never drive motion with a linear time function. Load `scripts/easing.js` and pick the curve that matches the motion's physical character (elastic for bouncy, cubic ease-out for settling into place, spring for interactive response). Then apply classic animation principles adapted for canvas — see `references/animation-principles.md`: squash-and-stretch, anticipation before the main action, motion along arcs (almost nothing in nature moves in a straight line), and follow-through / secondary motion.

That's single-point motion. For anything made of *connected* points that must move as one physically coherent system — cloth, hair, rope, chains, a flag — a single eased curve per point looks disconnected. Use the Verlet approach in `references/physics-motion.md` and `scripts/verlet.js`, and shade the result with the fold-curvature technique described there so the mesh reads as lit fabric rather than a moving wireframe.

### 8. Polish and performance
Separate static and moving content onto different canvas layers, or redraw only the region that changed, instead of redrawing the entire scene every frame. Drive all animation with `requestAnimationFrame` using delta-time rather than a fixed per-frame increment, so motion speed stays consistent regardless of frame rate. `references/canvas-craft.md` has the rest in priority order.

### 9. Critique — look, and look at the right things
Everything above describes how to write code that *should* produce a good result. It doesn't confirm that it did — gradient math, compositing order and clip regions are all easy to get subtly wrong in ways that only show up in rendered pixels, never in the source. Render the canvas to an actual image and look at it the way an art director critiques a painting, not the way a linter checks syntax. Use whatever your host gives you: a headless-browser screenshot, a `node-canvas` PNG export, an IDE live preview, or a rendered artifact. If the host genuinely cannot show you pixels, say so explicitly rather than silently skipping this stage — an unverified render is a draft, not a finished piece.

**Render at three checkpoints, not one**: after the block-in (stage 3), after contour (stage 4), and at the end. A proportion error caught at the block-in costs nothing; the same error caught at the end costs the whole piece.

**And look at more than the straight render.** The brain that decided where the eye goes is the same one checking whether the eye is in the right place — it sees the subject it intended, not the pixels that are there. `scripts/critique.js` breaks that loop with four transforms; `Critique.contactSheet(canvas)` produces all of them as one image:

| Pass | Makes visible |
|---|---|
| **Silhouette** — everything flat black | Whether the subject is readable at all. If it fails here, no shading will save it. |
| **Flipped** — mirrored horizontally | Proportion, balance and tilt errors you'd been unconsciously compensating for. |
| **Blurred** — the literal squint test | Whether the composition and focal point still read once detail is gone. |
| **Desaturated** | Value structure, which hue is very good at hiding. "It looks flat" is almost always a value problem. |

Then check the rendered image against this, not the code:

| Ask | If the answer is no |
|---|---|
| Does the silhouette read correctly at a glance, before any colour or detail? | Back to stage 3 — shading can't fix a proportion problem |
| Are the subject's hard facts right — joint directions, part counts, key ratios? | Back to stage 1 and `references/proportion-canon.md` |
| Is there one place the eye lands first, with everything else deferring to it? | Redistribute contrast/detail/saturation per `references/composition.md` |
| Do all shadows agree with a single light direction? | Recheck stage 5 — one inconsistent shadow breaks the whole illusion |
| Could you name the 3–4 hues the whole piece is built from? | The palette was never chosen; see `references/color-theory.md` |
| Does anything look "traced with a compass" — too smooth, too symmetric? | Back to stage 4, or add noise per stage 6 |
| If it moves, does the motion carry weight and intention, or does it read as `x += n`? | Recheck easing/arcs/anticipation in stage 7 |
| Would this pass as a photo or painting for half a second, or does it register as a render immediately? | That gut reaction is the real test — trace the failure back to whichever stage skipped a step |

Treat this as a loop, not a final checkbox: if something fails, go back to the relevant stage, redo it, then re-render and check again. Stop when a full pass produces no changes worth making — not on the first render that isn't embarrassing.

## Quick reference — do this, not that

| Instead of | Do |
|---|---|
| Typing a coordinate per feature | Derive landmarks from a rig (`scripts/armature.js`) so they can't drift apart |
| Trusting recalled proportions | Look them up in `references/proportion-canon.md` and assert them before drawing |
| Hand-picking gradient stops | Compute them from surface normals (`scripts/shading.js`) |
| Shading a limb like a sphere | `cylinderGradient` — a cylinder ignores the light's axial component |
| Flat single-colour fill | Multi-stop gradient along the light direction |
| Pure black shadow | Darker, desaturated version of the local hue |
| Perfect circle / straight line | Bezier curve with slight, intentional asymmetry |
| A hue chosen per object | 3–4 base hues mixed into everything, one accent at the focal point |
| A 2-stop gradient between distant hues | More stops, or `oklch()` — canvas interpolates in sRGB and runs through grey |
| Drawing the visible sliver of a hidden form | Draw the whole form, then occlude it |
| Linear animation (`progress += 1` per frame) | Eased, delta-time-based motion from `scripts/easing.js` |
| Straight-line motion | Motion along an arc |
| Redrawing everything every frame | Layered canvases or dirty-rect updates |
| Uniform outline around the whole silhouette | Lost/found edges — soften in low contrast, crisp at the terminator |
| Fixed cool shadow regardless of light colour | Shadow temperature derived from the light source's own temperature |
| Most saturated colour at the highlight/deepest shadow | Peak saturation at the core-shadow transition |
| Per-point eased motion for connected systems | Verlet integration + distance constraints from `scripts/verlet.js` |
| Equal detail/contrast across the whole canvas | Concentrate fidelity at the focal point, let the periphery simplify |
| Painting every pass into one context | An offscreen layer per concern, composited (`references/canvas-craft.md`) |
| Looking at the rendered pixels once, at the end | Three checkpoint renders, and a critique contact sheet rather than one straight view |

## When to open the reference files

- Drawing a specific subject and needing its real proportions and the error it invites → `references/proportion-canon.md`
- Composing a full scene, deciding the focal point, or making multi-element depth read correctly → `references/composition.md`
- Shading a specific material (skin, metal, glass, cloth, fur) or getting a light/shadow relationship right → `references/lighting-and-shading.md`
- Drawing organic shapes (faces, animals, plants, clouds, water) that keep coming out too geometric → `references/organic-curves.md`
- Any animation, especially anything that should feel alive rather than mechanical → `references/animation-principles.md`
- Anything made of connected points that should move as one physical system — cloth, hair, rope, a flag → `references/physics-motion.md` + `scripts/verlet.js`
- Perspective/vanishing-point subjects, feedback that a piece "looks flat" despite good colour, or a silhouette needing believable edge variation → `references/precision-and-form.md`
- Warm/cool shadow relationships, palette choice, saturation, or how nearby objects tint each other → `references/color-theory.md`
- Compositing, layer stacks, `globalCompositeOperation`, gradient colour-space problems, `Path2D`, or canvas performance → `references/canvas-craft.md`

## Scripts

| Script | Use it for |
|---|---|
| `canvas-setup.js` | HiDPI sizing — call before anything else |
| `armature.js` | Landmark rigs and proportion assertions (stage 3) |
| `shading.js` | Normals, Lambert, computed gradients, perspective camera (stage 5) |
| `bezier-utils.js` | Organic contours, Catmull-Rom paths, seeded jitter (stage 4) |
| `noise.js` | Texture, grain, gentle procedural motion (stage 6) |
| `easing.js` | Single-point motion curves and springs (stage 7) |
| `verlet.js` | Cloth, hair, rope, flags (stage 7) |
| `critique.js` | Silhouette / flip / blur / value diagnostic renders (stage 9) |
| `selftest.js` | `node scripts/selftest.js` — run after changing any script |

This workflow scales down fine — even a 30-second gesture sketch or a one-shot animation benefits from a single light source and one eased curve — it just doesn't scale down to zero. Skip a stage only when the user explicitly asks for something quick/rough/schematic, not by default.
