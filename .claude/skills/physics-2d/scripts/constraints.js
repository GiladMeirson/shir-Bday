// constraints.js — joints that tie bodies together: rigid rods, pins, and
// springs. Pairs with references/constraints-and-joints.md.
//
// A joint is just another velocity constraint solved in the same iteration loop
// as contacts (world.step calls joint.prepare then joint.solveVelocity). The
// only genuinely different one is the SpringJoint, which is a soft force rather
// than a hard constraint, so it feeds the force accumulator before integration
// instead of solving a velocity constraint.
//
// Anchors are LOCAL points on each body (so they rotate with the body). Use
// {x:0,y:0} to attach at the center of mass. To pin a body to a fixed point in
// the world, make one side a static body whose position is that point.

const Vec2 = require('./vec2.js');

const EPS = 1e-6;

// Rigid rod OR fixed-distance link: keeps the two anchors exactly `length`
// apart (can both push and pull, unlike a contact which only pushes). Omit
// `length` to lock in the current separation.
class DistanceJoint {
  constructor(a, b, anchorA = { x: 0, y: 0 }, anchorB = { x: 0, y: 0 }, opts = {}) {
    this.a = a; this.b = b;
    this.localA = Vec2.clone(anchorA);
    this.localB = Vec2.clone(anchorB);
    this.beta = opts.beta ?? 0.2;         // position-correction stiffness
    this.collideConnected = opts.collideConnected ?? false;
    if (opts.length != null) {
      this.length = opts.length;
    } else {
      const pA = Vec2.add(a.position, Vec2.rotate(this.localA, a.angle));
      const pB = Vec2.add(b.position, Vec2.rotate(this.localB, b.angle));
      this.length = Vec2.dist(pA, pB);
    }
  }

  prepare(dt) {
    const { a, b } = this;
    this.rA = Vec2.rotate(this.localA, a.angle);
    this.rB = Vec2.rotate(this.localB, b.angle);
    const pA = Vec2.add(a.position, this.rA);
    const pB = Vec2.add(b.position, this.rB);
    const d = Vec2.sub(pB, pA);
    const len = Vec2.len(d);
    this.u = len > EPS ? Vec2.scale(d, 1 / len) : { x: 1, y: 0 };

    const crA = Vec2.cross(this.rA, this.u), crB = Vec2.cross(this.rB, this.u);
    const k = a.invMass + b.invMass + a.invInertia * crA * crA + b.invInertia * crB * crB;
    this.mass = k > EPS ? 1 / k : 0;
    this.bias = (this.beta / dt) * (len - this.length);   // pull back toward rest length
  }

  solveVelocity() {
    const { a, b, u, rA, rB } = this;
    const vpA = Vec2.add(a.velocity, Vec2.crossSV(a.angularVelocity, rA));
    const vpB = Vec2.add(b.velocity, Vec2.crossSV(b.angularVelocity, rB));
    const vrel = Vec2.dot(Vec2.sub(vpB, vpA), u);
    const dImp = -this.mass * (vrel + this.bias);
    const P = Vec2.scale(u, dImp);
    a.applyImpulse(Vec2.neg(P), rA);
    b.applyImpulse(P, rB);
  }
}

// Pin / revolute joint: forces the two anchor points to coincide while letting
// the bodies rotate freely about that shared point. This is a 2-DOF constraint,
// so it solves a 2×2 effective-mass system each iteration.
class RevoluteJoint {
  constructor(a, b, anchorA = { x: 0, y: 0 }, anchorB = { x: 0, y: 0 }, opts = {}) {
    this.a = a; this.b = b;
    this.localA = Vec2.clone(anchorA);
    this.localB = Vec2.clone(anchorB);
    this.beta = opts.beta ?? 0.2;
    this.collideConnected = opts.collideConnected ?? false;
  }

  prepare(dt) {
    const { a, b } = this;
    this.rA = Vec2.rotate(this.localA, a.angle);
    this.rB = Vec2.rotate(this.localB, b.angle);

    // Effective mass matrix K (2×2, symmetric). See the reference for the
    // derivation; it is the point-constraint Jacobian folded with inverse mass.
    const im = a.invMass + b.invMass;
    const iIA = a.invInertia, iIB = b.invInertia;
    const rA = this.rA, rB = this.rB;
    const k11 = im + iIA * rA.y * rA.y + iIB * rB.y * rB.y;
    const k12 = -iIA * rA.x * rA.y - iIB * rB.x * rB.y;
    const k22 = im + iIA * rA.x * rA.x + iIB * rB.x * rB.x;
    const det = k11 * k22 - k12 * k12;
    const invDet = Math.abs(det) > EPS ? 1 / det : 0;
    // Inverse of K.
    this.invK = { a: k22 * invDet, b: -k12 * invDet, c: -k12 * invDet, d: k11 * invDet };

    // Positional error (anchor separation) fed back as a bias velocity.
    const pA = Vec2.add(a.position, rA);
    const pB = Vec2.add(b.position, rB);
    const C = Vec2.sub(pB, pA);
    this.bias = Vec2.scale(C, this.beta / dt);
  }

  solveVelocity() {
    const { a, b, rA, rB, invK, bias } = this;
    const vpA = Vec2.add(a.velocity, Vec2.crossSV(a.angularVelocity, rA));
    const vpB = Vec2.add(b.velocity, Vec2.crossSV(b.angularVelocity, rB));
    const dv = Vec2.add(Vec2.sub(vpB, vpA), bias);
    // impulse = -K⁻¹ · dv
    const P = {
      x: -(invK.a * dv.x + invK.b * dv.y),
      y: -(invK.c * dv.x + invK.d * dv.y),
    };
    a.applyImpulse(Vec2.neg(P), rA);
    b.applyImpulse(P, rB);
  }
}

// Soft spring (damped Hooke's law) between two anchors. Unlike the rigid joints
// this is a FORCE, not a hard constraint — it can stretch and oscillate. It
// feeds the force accumulator, so it runs before integration (world calls
// applyForces), which keeps it compatible with semi-implicit Euler.
class SpringJoint {
  constructor(a, b, anchorA = { x: 0, y: 0 }, anchorB = { x: 0, y: 0 }, opts = {}) {
    this.a = a; this.b = b;
    this.localA = Vec2.clone(anchorA);
    this.localB = Vec2.clone(anchorB);
    this.stiffness = opts.stiffness ?? 50;   // N per unit stretch (k in F=-kx)
    this.damping = opts.damping ?? 2;        // resists relative velocity
    this.collideConnected = opts.collideConnected ?? true; // springs usually allow it
    if (opts.restLength != null) {
      this.restLength = opts.restLength;
    } else {
      const pA = Vec2.add(a.position, Vec2.rotate(this.localA, a.angle));
      const pB = Vec2.add(b.position, Vec2.rotate(this.localB, b.angle));
      this.restLength = Vec2.dist(pA, pB);
    }
  }

  applyForces() {
    const { a, b } = this;
    const rA = Vec2.rotate(this.localA, a.angle);
    const rB = Vec2.rotate(this.localB, b.angle);
    const pA = Vec2.add(a.position, rA);
    const pB = Vec2.add(b.position, rB);
    const d = Vec2.sub(pB, pA);
    const len = Vec2.len(d);
    if (len < EPS) return;
    const u = Vec2.scale(d, 1 / len);

    // Hooke's restoring force + velocity damping along the spring axis.
    const vpA = Vec2.add(a.velocity, Vec2.crossSV(a.angularVelocity, rA));
    const vpB = Vec2.add(b.velocity, Vec2.crossSV(b.angularVelocity, rB));
    const vrel = Vec2.dot(Vec2.sub(vpB, vpA), u);
    const forceMag = -this.stiffness * (len - this.restLength) - this.damping * vrel;
    const F = Vec2.scale(u, forceMag);

    // Equal and opposite, applied at the anchors (so it can also induce torque).
    a.applyForce(Vec2.neg(F), pA);
    b.applyForce(F, pB);
  }
}

module.exports = { DistanceJoint, RevoluteJoint, SpringJoint };
