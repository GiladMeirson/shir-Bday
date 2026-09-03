# Animation Principles for Canvas

Adapted from the classic 12 principles of animation, filtered down to the ones that matter most for canvas/JS work — the ones that make the difference between "things move" and "things feel alive."

## 1. Easing over linear time

The single biggest tell of programmer-made animation is `progress += 1/frames` driving position directly. Nothing in the physical world starts or stops instantly. Always pass raw progress through an easing function first — see `scripts/easing.js`.

- Settling into a resting position → `easeOutCubic` or `easeOutExpo`
- Something bouncy/springy/alive → `elastic` or `spring`
- A mechanical/robotic effect (rare, but sometimes correct on purpose) → linear is fine, but only when that's the intent

## 2. Squash and stretch

A ball is never a perfectly rigid circle in motion — it stretches slightly along its direction of travel and squashes on impact. This single technique sells weight and material more than almost anything else.

```js
// Builds the deformed path only — the caller fills or strokes it afterward.
// The transform is deliberately restored first: a path is captured in device
// space as it is constructed, so it stays correct once the transform is gone,
// and the caller gets to pick a fillStyle without fighting the scale.
function squashStretchPath(ctx, x, y, r, vx, vy, isImpact) {
  const speed = Math.hypot(vx, vy);
  const stretch = isImpact ? 0.7 : 1 + Math.min(speed * 0.01, 0.3);
  const squash = isImpact ? 1.3 : 1 - Math.min(speed * 0.01, 0.15);
  const angle = Math.atan2(vy, vx);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);          // x-axis now points along the direction of travel
  ctx.scale(stretch, squash); // so stretch is along travel, squash across it
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.restore();
}

// usage
squashStretchPath(ctx, x, y, 20, vx, vy, grounded);
ctx.fillStyle = Shading.sphereGradient(ctx, x, y, 20, [15, 65, 52], light);
ctx.fill();
```

Keep total area roughly conserved (stretch one axis, squash the other) — objects that just get bigger/smaller instead of deforming look like they're changing size, not moving fast.

## 3. Anticipation

A motion reads as intentional, not glitchy, when it has a small counter-movement before the main action — a slight crouch before a jump, a slight pull-back before a punch, a slight backward lean before running forward. Skipping this is the #2 tell after linear easing.

## 4. Arcs

Almost nothing in nature travels in a straight line — limbs rotate around joints, thrown objects follow parabolas, heads turn along a curve. Default to quadratic/bezier paths for motion rather than linear interpolation between two points, even for something as simple as a bouncing ball's horizontal position (a very slight curve reads as far more natural than a straight line).

## 5. Follow-through and secondary motion

When a main mass stops, attached loose elements (hair, cloth, a tail, antennae, liquid in a container) should keep moving briefly and settle with their own, slightly delayed easing curve. A cheap and effective version: delay the secondary element's easing start by 60-120ms and give it a slightly longer/bouncier curve than the primary motion.

```js
function secondaryMotion(mainProgress, delayMs, elapsedMs, easingFn) {
  const secondaryElapsed = Math.max(0, elapsedMs - delayMs);
  const secondaryDuration = 400; // slightly longer than primary, tune per-case
  return easingFn(Math.min(1, secondaryElapsed / secondaryDuration));
}
```

## 6. Timing conveys weight and mood

Fewer, longer holds + fast bursts of motion reads as heavy/powerful (a boulder, a heavy door). Continuous, evenly-spaced motion reads as light/mechanical (a leaf, a hummingbird, a robot). Choose frame timing deliberately based on what the object should feel like, not just what's convenient to code.

## Delta-time, always

Never assume a fixed frame duration. Compute elapsed time each frame and drive all motion off it, so the animation plays at the same real-world speed on a 60Hz and a 144Hz display:

```js
let lastTime = performance.now();
function frame(now) {
  const dt = now - lastTime;
  lastTime = now;
  update(dt); // pass dt into every position/progress calculation
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```
