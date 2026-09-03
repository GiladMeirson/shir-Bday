// vec2.js — 2D vector + cross-product math for rigid-body physics.
// Pairs with references/foundations.md.
//
// Vectors are plain {x, y} objects. Most ops RETURN A NEW vector (functional
// style) so you never accidentally alias a body's position into a temp. The
// hot inner loop of the solver (solver.js) uses the *Mut in-place variants to
// avoid per-contact allocation.
//
// The cross products are the part people get wrong. In 2D you treat scalars as
// the z-component of a 3D vector, which gives three distinct operations:
//   cross(a, b)   : 2D × 2D → scalar  (the z of the 3D cross)   a.x*b.y - a.y*b.x
//   crossVS(v, s) : 2D × scalar → 2D                            ( s*v.y, -s*v.x )
//   crossSV(s, v) : scalar × 2D → 2D                            (-s*v.y,  s*v.x )
// crossSV(ω, r) is exactly "velocity contributed by spin ω at offset r from the
// center of mass" — it shows up everywhere in contact math, so keep it straight.

const Vec2 = {
  create(x = 0, y = 0) { return { x, y }; },
  clone(a) { return { x: a.x, y: a.y }; },
  set(out, x, y) { out.x = x; out.y = y; return out; },
  copy(out, a) { out.x = a.x; out.y = a.y; return out; },

  add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; },
  sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; },
  scale(a, s) { return { x: a.x * s, y: a.y * s }; },
  neg(a) { return { x: -a.x, y: -a.y }; },

  // a + b*s  — fused multiply-add, the single most common physics update.
  addScaled(a, b, s) { return { x: a.x + b.x * s, y: a.y + b.y * s }; },

  dot(a, b) { return a.x * b.x + a.y * b.y; },

  // 2D × 2D → scalar. Sign tells you which side b is of a (CCW positive).
  cross(a, b) { return a.x * b.y - a.y * b.x; },
  // 2D × scalar → 2D.
  crossVS(v, s) { return { x: s * v.y, y: -s * v.x }; },
  // scalar × 2D → 2D. crossSV(ω, r) = linear velocity at r due to spin ω.
  crossSV(s, v) { return { x: -s * v.y, y: s * v.x }; },

  lenSq(a) { return a.x * a.x + a.y * a.y; },
  len(a) { return Math.hypot(a.x, a.y); },
  distSq(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; },
  dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); },

  normalize(a) {
    const l = Math.hypot(a.x, a.y);
    return l > 1e-12 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
  },
  // 90° left turn (CCW). perp(v) is the outward face direction from an edge
  // wound CCW.
  perp(a) { return { x: -a.y, y: a.x }; },

  // Rotate by angle (radians). Used to take a shape's local vertices/normals
  // into world space given the body's orientation.
  rotate(a, angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
  },

  // --- In-place variants for the allocation-sensitive solver inner loop ---
  addMut(out, b) { out.x += b.x; out.y += b.y; return out; },
  addScaledMut(out, b, s) { out.x += b.x * s; out.y += b.y * s; return out; },
  subMut(out, b) { out.x -= b.x; out.y -= b.y; return out; },
};

if (typeof module !== 'undefined') module.exports = Vec2;
