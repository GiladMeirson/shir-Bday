# Composition and Intent

## Start from gesture, not geometry

Before any block-in, before measuring proportions, capture the single line of energy the piece is built around — the line of action running through a figure's pose, the sweep of a wave, the lean of a tree in wind. A painter's first mark on the page is a loose gesture, not a careful outline, because energy is easy to lose and hard to add back later: a geometrically accurate block-in with no gesture underneath it reads as static no matter how correct the proportions are. Get the line of energy right first, and let every later stage preserve it rather than average it away.

## One focal point, one hierarchy

Everything in a scene competes for attention unless something is deliberately made to win. Decide the single element the eye should land on first *before* laying out anything else, then treat every subsequent decision — contrast, saturation, detail density, edge sharpness — as a budget spent disproportionately on that one area.

**Selective fidelity** is the biggest lever here, and the one most often left at "off" by default: real paintings, and photos via lens depth-of-field, do not render everything at equal fidelity. Put the sharpest edges, highest contrast, most saturated color, and finest texture detail at the focal point; let everything else soften, desaturate slightly, and simplify with distance from it (in either physical distance or narrative importance). A piece where every object gets equal care looks like a catalog illustration; uneven fidelity is what makes something read as *composed* rather than *rendered*.

```js
function fidelityFalloff(distanceFromFocal, maxDistance) {
  // 1 at the focal point, dropping toward 0.3 at the periphery
  const t = Math.min(1, distanceFromFocal / maxDistance);
  return 1 - t * 0.7;
}
// use the result to scale contrast, saturation, edge lineWidth, and noise amount
// for anything outside the focal region
```

## Placement over centering

Dead-center, perfectly symmetric placement reads as a diagram, not a scene. Default to putting the focal point off-center — roughly a third of the way in from an edge — and let secondary elements balance it by weight rather than mirror it. Symmetry is a legitimate deliberate choice (formal portraiture, mandalas, architecture) but should be chosen on purpose because it serves the piece, not fallen into by default because `(width / 2, height / 2)` was the easiest coordinate to type.

## Depth through atmosphere, not just overlap

For any scene with foreground/midground/background elements, overlap alone reads as "in front of," not "far away." Add atmospheric perspective as elements recede: desaturate them, shift their hue toward the ambient/sky color (usually cooler/bluer), reduce the contrast between their own lights and darks, and soften their edges slightly.

```js
function atmosphericTint([h, s, l], depth, skyHue = 210) {
  // depth: 0 = foreground, 1 = far background
  const hueShift = h + (skyHue - h) * depth * 0.4;
  const desaturated = s * (1 - depth * 0.5);
  const lightened = l + (75 - l) * depth * 0.35; // recedes toward sky brightness
  return [hueShift, desaturated, lightened];
}
```

Combine with simple scale and vertical placement (for a ground-based scene, higher-and-smaller reads as farther) and even flat 2D shapes read as occupying real depth.

## Negative space

Not every region needs content. A composition that fills every pixel with detail reads as busy and gives the eye nowhere to rest — which paradoxically makes the focal point *harder* to find, since nothing is empty enough to contrast against it. Leave a quiet, low-detail area near (not on top of) the focal point; it's what the eye uses as a resting point before returning to the subject.

## Staging carries this over to motion

Everything above applies frame-by-frame to animation too — this is what animators call staging. At any given moment, the single most important action or change should be the clearest, highest-contrast, most legible thing on screen. If several things move with equal visual weight at once, the eye can't tell which one matters. Stagger secondary motion (see the follow-through section of `references/animation-principles.md`) partly so the primary action gets a brief window where it's the only thing moving.

## Quick reference

| Instead of | Do |
|---|---|
| Equal detail/contrast everywhere | Concentrate fidelity at the focal point; simplify the periphery |
| Subject dead-center | Off-center placement, roughly a third in from an edge |
| Depth from overlap alone | Add desaturation + cool hue shift + softened edges + reduced contrast with distance |
| Filling every region with detail | Deliberate negative space near the focal point |
| Several things moving with equal visual weight | Stage one clear primary action per moment; stagger the rest |
