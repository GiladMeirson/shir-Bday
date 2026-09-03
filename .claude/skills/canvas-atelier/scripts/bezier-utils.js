// bezier-utils.js — helpers for turning rough points/primitives into smooth,
// organic curves. Pairs with references/organic-curves.md.

const BezierUtils = {
  // Converts an array of [x, y] points into a smooth curve through all of
  // them (Catmull-Rom spline, expressed as bezier segments so it works
  // directly with ctx.bezierCurveTo). Great for hair strands, ridgelines,
  // wave crests, or any hand-drawn-looking path through key points.
  //
  // Usage:
  //   const segments = BezierUtils.catmullRomToBezier(points, { closed: false });
  //   ctx.beginPath();
  //   ctx.moveTo(...points[0]);
  //   for (const seg of segments) ctx.bezierCurveTo(...seg.cp1, ...seg.cp2, ...seg.end);
  //   ctx.stroke();
  catmullRomToBezier(points, { closed = false, tension = 1 } = {}) {
    const segments = [];
    const n = points.length;
    if (n < 3) return segments;
    const get = (i) => points[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];

    const upper = closed ? n : n - 1;
    for (let i = 0; i < upper; i++) {
      const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
      const cp1 = [
        p1[0] + ((p2[0] - p0[0]) / 6) * tension,
        p1[1] + ((p2[1] - p0[1]) / 6) * tension,
      ];
      const cp2 = [
        p2[0] - ((p3[0] - p1[0]) / 6) * tension,
        p2[1] - ((p3[1] - p1[1]) / 6) * tension,
      ];
      segments.push({ cp1, cp2, end: p2 });
    }
    return segments;
  },

  // Seeded pseudo-random generator — use this instead of Math.random() any
  // time an "organic" shape needs to look identical across re-renders
  // (e.g. redrawing every animation frame without the silhouette jittering).
  seededRandom(seed) {
    let s = seed;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  // Nudges a set of "reference" primitive points (e.g. from a perfect
  // polygon/circle sampling) by small, seeded, per-point offsets — the core
  // trick behind organicBlob(), factored out for reuse with arbitrary base
  // shapes (not just circles).
  //
  // `irregularity` is a FRACTION OF THE SHAPE'S SIZE, matching the 5-15% band
  // in organic-curves.md — not an absolute pixel offset. `scale` defaults to
  // the mean distance from the point set's centroid, so the same 0.12 means
  // the same visual amount of wobble on a 40px shape and a 400px one. Pass
  // `scale` explicitly to lock the jitter to some other reference length.
  jitterPoints(points, irregularity = 0.1, rand = Math.random, scale = null) {
    if (!points.length) return [];
    let scaleRef = scale;
    if (scaleRef == null) {
      let cx = 0, cy = 0;
      for (const [x, y] of points) { cx += x; cy += y; }
      cx /= points.length; cy /= points.length;
      let sum = 0;
      for (const [x, y] of points) sum += Math.hypot(x - cx, y - cy);
      scaleRef = sum / points.length;
    }
    const amp = scaleRef * irregularity;
    return points.map(([x, y]) => [
      x + (rand() - 0.5) * amp,
      y + (rand() - 0.5) * amp,
    ]);
  },

  // Closed, organic silhouette through `points` — the primitive-killer from
  // stage 3. Uses the midpoint-quadratic construction: each on-curve point
  // becomes a control point and each segment ends at the midpoint of the next
  // edge, which keeps the tangent continuous all the way around.
  //
  // Starting this loop at points[0] instead of the first midpoint (a very easy
  // mistake) makes the opening segment's control point coincide with its start
  // point. A quadratic with P0 === P1 reduces to B(t) = P0(1-t²) + t²P2 — a
  // straight chord — and the closing segment then arrives at a different
  // tangent, so every shape gets one flat edge and one corner at the seam.
  closedOrganicPath(ctx, points) {
    const n = points.length;
    if (n < 3) return;
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    ctx.beginPath();
    ctx.moveTo(...mid(points[n - 1], points[0]));
    for (let i = 0; i < n; i++) {
      const cur = points[i], next = points[(i + 1) % n];
      const end = mid(cur, next);
      ctx.quadraticCurveTo(cur[0], cur[1], end[0], end[1]);
    }
    ctx.closePath();
  },

  // Ready-made organic blob: samples a circle, jitters it, closes it smoothly.
  // irregularity follows the same 5-15%-reads-natural band as jitterPoints.
  organicBlob(ctx, cx, cy, baseR, { points = 8, irregularity = 0.12, rand = Math.random } = {}) {
    const pts = [];
    for (let i = 0; i < points; i++) {
      const angle = (i / points) * Math.PI * 2;
      const r = baseR * (1 + (rand() - 0.5) * irregularity);
      pts.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
    }
    BezierUtils.closedOrganicPath(ctx, pts);
    return pts;
  },

  // Distance-based line-width taper — call per stroke segment when you want
  // a hand-drawn line that thins toward its ends instead of constant width.
  taperedWidth(t, baseWidth, { taperStart = 0.3, taperEnd = 0.3 } = {}) {
    if (t < taperStart) return baseWidth * (t / taperStart);
    if (t > 1 - taperEnd) return baseWidth * ((1 - t) / taperEnd);
    return baseWidth;
  },
};

if (typeof module !== 'undefined') module.exports = BezierUtils;
