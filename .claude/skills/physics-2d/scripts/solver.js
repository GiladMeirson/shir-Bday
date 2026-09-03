// solver.js — turns a contact manifold into the impulses that make bodies
// bounce, slide, and rest correctly. Pairs with references/collision-response.md.
//
// This is a SEQUENTIAL-IMPULSE solver with accumulated-impulse clamping (the
// Erin Catto / Box2D-lite method). The key idea that separates it from a naive
// "compute impulse, apply it" loop: each contact remembers the TOTAL normal
// impulse applied so far this step, and every iteration only adjusts that
// total — clamped so the accumulated normal impulse can never go negative
// (contacts can push, never pull). This converges in a handful of iterations
// where the naive method needs dozens, which is exactly what lets a resting
// stack reach true zero velocity and fall asleep instead of buzzing forever.
//
// Three entry points, run at different times by world.step():
//   prepare()          once per manifold, before the iteration loop.
//   solveVelocity()    velocityIterations times — the sequential impulse pass.
//   correctPositions() once, after integration — split-impulse position fix so
//                      residual overlap never leaks into real velocity.

const Vec2 = require('./vec2.js');

const EPS = 1e-6;

// Relative velocity of b w.r.t. a AT the contact, including each body's spin
// contribution (ω × r).
function relativeVelocity(a, b, ra, rb) {
  const va = Vec2.add(a.velocity, Vec2.crossSV(a.angularVelocity, ra));
  const vb = Vec2.add(b.velocity, Vec2.crossSV(b.angularVelocity, rb));
  return Vec2.sub(vb, va);
}

// Precompute, per contact point: the effective mass along the normal and
// tangent, and the restitution target velocity. Restitution is only applied
// when the closing speed is above restThreshold — below it (a body settling
// under gravity) bounce is suppressed so stacks don't jitter.
function prepare(m, gravity, dt, restThreshold = 1.0) {
  const { a, b, normal } = m;
  m.e = Math.min(a.restitution, b.restitution);
  m.sf = Math.sqrt(a.friction * b.friction);        // combined friction
  m.tangent = { x: normal.y, y: -normal.x };
  m.points = [];

  for (const point of m.contacts) {
    const ra = Vec2.sub(point, a.position);
    const rb = Vec2.sub(point, b.position);

    const rnA = Vec2.cross(ra, normal), rnB = Vec2.cross(rb, normal);
    const kn = a.invMass + b.invMass + a.invInertia * rnA * rnA + b.invInertia * rnB * rnB;

    const rtA = Vec2.cross(ra, m.tangent), rtB = Vec2.cross(rb, m.tangent);
    const kt = a.invMass + b.invMass + a.invInertia * rtA * rtA + b.invInertia * rtB * rtB;

    const rv = relativeVelocity(a, b, ra, rb);
    const vn = Vec2.dot(rv, normal);                 // <0 while approaching
    const restBias = (-vn > restThreshold) ? m.e * -vn : 0;

    m.points.push({
      ra, rb,
      massNormal: kn > EPS ? 1 / kn : 0,
      massTangent: kt > EPS ? 1 / kt : 0,
      restBias,
      Pn: 0, Pt: 0,                                  // accumulated impulses
    });
  }
}

// One sequential-impulse pass. Call velocityIterations times per step.
function solveVelocity(m) {
  const { a, b, normal, tangent, sf } = m;

  for (const c of m.points) {
    // --- normal ---
    let rv = relativeVelocity(a, b, c.ra, c.rb);
    const vn = Vec2.dot(rv, normal);
    let dPn = c.massNormal * (-vn + c.restBias);
    // Clamp the ACCUMULATED normal impulse to >= 0, then apply only the delta.
    const Pn0 = c.Pn;
    c.Pn = Math.max(Pn0 + dPn, 0);
    dPn = c.Pn - Pn0;
    const Pn = Vec2.scale(normal, dPn);
    a.applyImpulse(Vec2.neg(Pn), c.ra);
    b.applyImpulse(Pn, c.rb);

    // --- friction ---
    rv = relativeVelocity(a, b, c.ra, c.rb);
    const vt = Vec2.dot(rv, tangent);
    let dPt = c.massTangent * -vt;
    // Coulomb cone: |accumulated tangent impulse| <= μ · accumulated normal.
    const maxPt = sf * c.Pn;
    const Pt0 = c.Pt;
    c.Pt = Math.max(-maxPt, Math.min(Pt0 + dPt, maxPt));
    dPt = c.Pt - Pt0;
    const Pt = Vec2.scale(tangent, dPt);
    a.applyImpulse(Vec2.neg(Pt), c.ra);
    b.applyImpulse(Pt, c.rb);
  }
}

// Split-impulse position correction. The velocity solve targets zero velocity,
// NOT zero penetration, so a little overlap survives every step. This nudges it
// out geometrically (touching position only, never velocity) so gravity can't
// feed the overlap back and sink a stack. SLOP lets bodies rest fractionally
// overlapped without twitching; percent under-corrects to avoid overshoot.
function correctPositions(m, slop = 0.05, percent = 0.4) {
  const invSum = m.a.invMass + m.b.invMass;
  if (invSum < EPS) return;
  const mag = Math.max(m.penetration - slop, 0) / invSum * percent;
  const correction = Vec2.scale(m.normal, mag);
  m.a.position = Vec2.addScaled(m.a.position, correction, -m.a.invMass);
  m.b.position = Vec2.addScaled(m.b.position, correction, m.b.invMass);
}

module.exports = { prepare, solveVelocity, correctPositions, relativeVelocity };
