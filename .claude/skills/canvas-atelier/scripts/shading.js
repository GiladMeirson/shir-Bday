// shading.js — derive shading from geometry instead of hand-picking gradient
// stops. Pairs with references/lighting-and-shading.md and color-theory.md.
//
// The rest of the skill describes the lighting model qualitatively: one light
// direction, a core shadow at the terminator, never black, shadow temperature
// from the light's temperature, peak chroma at the terminator. This file
// computes all of that from a surface normal and a light vector, so the
// gradient stops are a result rather than a guess.
//
// Why it matters most for cylinders: limbs, tree trunks, bottles, columns and
// fingers are cylinders, their terminator sits exactly where N·L = 0, and the
// falloff between highlight and terminator is cos θ, not a linear ramp.
// Hand-placed stops put the terminator in the wrong place and ramp it
// linearly, which is why canvas limbs come out looking like painted tubes.
//
// Coordinate convention: screen space. +x right, +y DOWN (canvas convention),
// +z toward the viewer.
//
//   const L = Shading.light(225, 35);            // from the upper left, 35° up
//   ctx.fillStyle = Shading.sphereGradient(ctx, cx, cy, r, [15, 65, 52], L);
//   ctx.fill();

const Shading = {
  // ------------------------------------------------------------------ vectors
  normalize(v) {
    const len = Math.hypot(v.x, v.y, v.z) || 1e-9;
    return { x: v.x / len, y: v.y / len, z: v.z / len };
  },

  dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  },

  // A light direction as a unit vector pointing FROM the surface TOWARD the
  // light. azimuth is a screen angle in degrees (0 = from the right, 90 = from
  // below, 180 = from the left, 270 = from above); elevation is how far the
  // light is tipped out of the screen plane toward the viewer (0 = raking
  // across the surface, 90 = straight down the camera axis, which flattens
  // everything and is almost never what you want).
  //
  // "Classic upper-left key light" is light(225, 35).
  light(azimuthDeg, elevationDeg = 30) {
    const az = (azimuthDeg * Math.PI) / 180;
    const el = (elevationDeg * Math.PI) / 180;
    return this.normalize({
      x: Math.cos(el) * Math.cos(az),
      y: Math.cos(el) * Math.sin(az),
      z: Math.sin(el),
    });
  },

  // ------------------------------------------------------------------ normals
  // Surface normal of a sphere at a screen point, or null if the point is off
  // the disc. This is the whole of "sphere shading" — everything else follows.
  sphereNormalAt(px, py, cx, cy, r) {
    const u = (px - cx) / r;
    const v = (py - cy) / r;
    const d2 = u * u + v * v;
    if (d2 > 1) return null;
    return { x: u, y: v, z: Math.sqrt(1 - d2) };
  },

  // Surface normal across a cylinder's cross-section. `u` runs -1..1 from one
  // silhouette edge to the other; `axisAngle` is the screen angle of the
  // cylinder's axis in radians.
  //
  // Note what is absent: the light's component ALONG the axis. An infinite
  // cylinder's shading genuinely does not depend on it — that is why a limb
  // lit from along its own length still shows the same cross-section falloff,
  // and why treating a limb like a sphere (which does depend on it) reads
  // wrong immediately.
  cylinderNormalAt(u, axisAngle) {
    const clamped = Math.max(-1, Math.min(1, u));
    const px = -Math.sin(axisAngle);
    const py = Math.cos(axisAngle);
    return {
      x: px * clamped,
      y: py * clamped,
      z: Math.sqrt(Math.max(0, 1 - clamped * clamped)),
    };
  },

  // Normal of a flat surface tilted by `tiltDeg` around a screen-space axis.
  // Useful for ground planes, table tops, walls, and any facet of a box.
  planeNormal(tiltDeg = 0, axisAngle = 0) {
    const t = (tiltDeg * Math.PI) / 180;
    return this.normalize({
      x: -Math.sin(axisAngle) * Math.sin(t),
      y: Math.cos(axisAngle) * Math.sin(t),
      z: Math.cos(t),
    });
  },

  // ------------------------------------------------------------------ terms
  lambert(n, l) {
    return Math.max(0, this.dot(n, l));
  },

  // Blinn-Phong specular. `power` is the tightness of the highlight: ~8 for
  // skin (broad and soft), ~40 for polished wood, ~120+ for metal and glass
  // (a small hard dot). Getting this exponent wrong is the main reason a
  // material reads as the wrong substance despite correct colour.
  specular(n, l, power = 32, view = { x: 0, y: 0, z: 1 }) {
    const h = this.normalize({ x: l.x + view.x, y: l.y + view.y, z: l.z + view.z });
    return Math.pow(Math.max(0, this.dot(n, h)), power);
  },

  // ------------------------------------------------------------------ colour
  // Shortest-path hue interpolation. Going the long way round the wheel is how
  // a red-to-orange blend ends up detouring through green.
  hueLerp(a, b, t) {
    let d = ((b - a) % 360 + 540) % 360 - 180;
    return (a + d * t + 360) % 360;
  },

  // Relative saturation multiplier. `t` is 0 at the highlight, 1 at the
  // deepest shadow; chroma peaks near the core-shadow transition, exactly as
  // color-theory.md argues, and falls off toward both extremes.
  chromaProfile(t) {
    const peak = 0.6, spread = 0.35;
    return Math.max(0.35, 1 - Math.pow((t - peak) / spread, 2));
  },

  // Turn a base colour and a light intensity into a colour string.
  //
  // base:      [h, s, l] — the object's local colour in full light
  // intensity: 0..1, normally a Lambert term
  // opts.lightHue:  hue of the light itself (default 45, a warm key light)
  // opts.ambient:   floor below which nothing goes; this is what stops shadows
  //                 collapsing to black. 0.12-0.25 for most scenes.
  //
  // The shadow's temperature is derived from the light's, not fixed: warm
  // light gives cool shadows and cool light gives warm ones.
  shade(base, intensity, opts = {}) {
    const [h, s, l] = base;
    const { lightHue = 45, ambient = 0.18, warmth = 0.35, alpha = null } = opts;
    const lightIsWarm = lightHue < 90 || lightHue > 300;
    const shadowHue = opts.shadowHue != null ? opts.shadowHue : (lightIsWarm ? 220 : 30);

    const t = Math.max(0, Math.min(1, intensity));
    const lit = ambient + (1 - ambient) * t;

    // Lightness never reaches 0 (no black shadows) and never reaches 100
    // (a blown highlight loses the local hue entirely).
    const lo = l * 0.3;
    const hi = l + (100 - l) * 0.55;
    const outL = lo + (hi - lo) * lit;

    // Hue drifts toward the shadow temperature in the dark and toward the
    // light's own hue in the brightest region.
    const outH = lit < 0.5
      ? this.hueLerp(h, shadowHue, (0.5 - lit) * 2 * warmth)
      : this.hueLerp(h, lightHue, (lit - 0.5) * 2 * warmth * 0.6);

    const outS = Math.max(0, Math.min(100, s * this.chromaProfile(1 - lit)));

    return alpha == null
      ? `hsl(${outH.toFixed(1)}, ${outS.toFixed(1)}%, ${outL.toFixed(1)}%)`
      : `hsla(${outH.toFixed(1)}, ${outS.toFixed(1)}%, ${outL.toFixed(1)}%, ${alpha})`;
  },

  // ---------------------------------------------------------------- gradients
  // A radial gradient whose stops are SAMPLED from the sphere's actual normals
  // rather than chosen by eye. Returns a CanvasGradient ready to assign to
  // fillStyle.
  sphereGradient(ctx, cx, cy, r, base, lightVec, opts = {}) {
    const { stops = 8 } = opts;
    const L = this.normalize(lightVec);

    // The surface point whose normal is exactly L projects to r*L. When the
    // light is nearly down the camera axis that lands on the centre, so fall
    // back to a fixed direction rather than dividing by ~0.
    let dirX = L.x, dirY = L.y;
    const planar = Math.hypot(dirX, dirY);
    if (planar < 1e-4) { dirX = -0.35; dirY = -0.35; }
    else { dirX /= planar; dirY /= planar; }

    const reach = Math.min(0.85, planar);
    const hx = cx + dirX * r * reach;
    const hy = cy + dirY * r * reach;

    const grad = ctx.createRadialGradient(hx, hy, r * 0.02, cx, cy, r * 1.02);
    for (let i = 0; i < stops; i++) {
      const t = i / (stops - 1);
      // Walk from the highlight across the sphere to the far rim, which is the
      // axis the light actually varies along.
      const px = hx + (cx - dirX * r - hx) * t;
      const py = hy + (cy - dirY * r - hy) * t;
      // The far end of that walk lands exactly ON the silhouette, where the
      // normal is undefined. Clamp back inside the disc rather than falling
      // back to some default normal: the obvious fallback points toward the
      // light, which paints the darkest edge of the sphere BRIGHT and rings
      // it with an accidental halo. Nothing about that is visible in source.
      let ox = px - cx, oy = py - cy;
      const d = Math.hypot(ox, oy);
      const limit = r * 0.995;
      if (d > limit) { ox = (ox / d) * limit; oy = (oy / d) * limit; }
      const n = this.sphereNormalAt(cx + ox, cy + oy, cx, cy, r);
      grad.addColorStop(t, this.shade(base, this.lambert(n, L), opts));
    }
    return grad;
  },

  // A linear gradient across a cylinder's width, sampled from cross-section
  // normals. (ax, ay) and (bx, by) are the two ends of the cylinder's axis.
  cylinderGradient(ctx, ax, ay, bx, by, radius, base, lightVec, opts = {}) {
    const { stops = 9 } = opts;
    const L = this.normalize(lightVec);
    const axisAngle = Math.atan2(by - ay, bx - ax);
    const px = -Math.sin(axisAngle), py = Math.cos(axisAngle);
    const mx = (ax + bx) / 2, my = (ay + by) / 2;

    const grad = ctx.createLinearGradient(
      mx - px * radius, my - py * radius,
      mx + px * radius, my + py * radius
    );
    for (let i = 0; i < stops; i++) {
      const t = i / (stops - 1);
      const n = this.cylinderNormalAt(t * 2 - 1, axisAngle);
      grad.addColorStop(t, this.shade(base, this.lambert(n, L), opts));
    }
    return grad;
  },

  // ------------------------------------------------------------------ camera
  // A one-point perspective camera. `horizonY` is the eye level on screen —
  // and it is also where every receding line converges, because as z grows the
  // scale factor goes to 0 and every projected y collapses onto it. That is
  // the definition of a horizon, not a coincidence, and it means you place the
  // horizon by choosing this number rather than by drawing guide lines.
  //
  // World y is measured DOWNWARD from eye level, so the ground plane sits at
  // y = eyeHeight (how far the camera is above it).
  camera({ focal = 620, horizonY = 0, originX = 0, eyeHeight = 120 } = {}) {
    const cam = {
      focal, horizonY, originX, eyeHeight,

      project(x, y, z) {
        const f = focal / Math.max(1e-6, focal + z);
        return { x: originX + x * f, y: horizonY + y * f, scale: f };
      },

      // A circle lying flat on the ground, projected. Wheels, plates, pools,
      // tree bases, the top of a mug. Returns ellipse params for ctx.ellipse.
      // The squash is derived from the geometry rather than picked, so a
      // circle near eye level flattens to a line on its own.
      groundCircle(x, z, r) {
        const left = cam.project(x - r, eyeHeight, z);
        const right = cam.project(x + r, eyeHeight, z);
        const near = cam.project(x, eyeHeight, z - r);
        const far = cam.project(x, eyeHeight, z + r);
        return {
          cx: (left.x + right.x) / 2,
          cy: (near.y + far.y) / 2,
          rx: Math.abs(right.x - left.x) / 2,
          ry: Math.abs(near.y - far.y) / 2,
        };
      },

      // How much smaller something is at distance z — use it to scale line
      // widths, texture frequency and detail, not just position.
      scaleAt(z) {
        return focal / Math.max(1e-6, focal + z);
      },
    };
    return cam;
  },
};

if (typeof module !== 'undefined') module.exports = Shading;
