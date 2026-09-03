// body.js — the RigidBody: state (position/velocity/rotation), material
// (restitution/friction), and semi-implicit (symplectic) Euler integration.
// Pairs with references/foundations.md.
//
// Why semi-implicit Euler and not the "obvious" explicit Euler:
//   explicit:      position += velocity*dt;  velocity += accel*dt   (WRONG order)
//   semi-implicit: velocity += accel*dt;      position += velocity*dt (integrateForces
//                                                                       then integrateVelocity)
// The single line swap is the difference between a stable engine and one where
// orbits spiral out and stacks gain energy from nowhere. Explicit Euler adds
// energy every step; semi-implicit conserves it on average. This is THE reason
// step() below calls integrateForces for every body before integrateVelocity
// for every body — never interleaved per-body.

const Vec2 = require('./vec2.js');
const { computeMass } = require('./shapes.js');

class RigidBody {
  // opts: { shape, position?, angle?, density?, restitution?, friction?,
  //         isStatic?, gravityScale? }
  constructor(opts) {
    this.shape = opts.shape;
    this.position = opts.position ? Vec2.clone(opts.position) : { x: 0, y: 0 };
    this.velocity = { x: 0, y: 0 };
    this.angle = opts.angle || 0;
    this.angularVelocity = 0;

    // Accumulators, cleared at the end of every step.
    this.force = { x: 0, y: 0 };
    this.torque = 0;

    this.restitution = opts.restitution ?? 0.2;   // bounciness, 0..1
    this.friction = opts.friction ?? 0.4;          // Coulomb coefficient
    this.gravityScale = opts.gravityScale ?? 1;    // 0 disables gravity for this body

    // Collision filtering (see references/collision-detection.md). Two bodies
    // collide when their category/mask bits agree BOTH ways — (a.category &
    // b.mask) && (b.category & a.mask) — unless a non-zero group overrides it:
    // equal positive groups always collide, equal negative groups never do.
    // Use this for layers (player/enemy/scenery) and to exclude jointed parts.
    this.filterCategory = opts.filterCategory ?? 0x0001;
    this.filterMask = opts.filterMask ?? 0xFFFF;
    this.filterGroup = opts.filterGroup ?? 0;
    this.id = -1;                                  // assigned by World.add

    // Sleeping bookkeeping (see world.js). A sleeping body is skipped by the
    // integrator until something wakes it.
    this.sleeping = false;
    this.sleepTimer = 0;

    if (opts.isStatic) {
      this.setStatic();
    } else {
      const density = opts.density ?? 1;
      const { mass, inertia } = computeMass(this.shape, density);
      this.mass = mass; this.invMass = mass > 0 ? 1 / mass : 0;
      this.inertia = inertia; this.invInertia = inertia > 0 ? 1 / inertia : 0;
    }
  }

  // Infinite mass / inertia: never translates or rotates from forces or
  // impulses. Walls, floors, moving platforms (drive those by setting velocity
  // directly each frame).
  setStatic() {
    this.mass = 0; this.invMass = 0;
    this.inertia = 0; this.invInertia = 0;
    this.velocity = { x: 0, y: 0 };
    this.angularVelocity = 0;
    return this;
  }

  get isStatic() { return this.invMass === 0; }

  // Continuous force (gravity-like, thrust, drag). Accumulated and applied over
  // dt during integrateForces. contact is a world point; omit it to push
  // through the center of mass with no torque.
  applyForce(f, contact = null) {
    this.force.x += f.x; this.force.y += f.y;
    if (contact) {
      const r = Vec2.sub(contact, this.position);
      this.torque += Vec2.cross(r, f);
    }
  }

  // Instantaneous change in momentum (a hit, a jump, the collision solver).
  // r is the contact offset FROM the center of mass; {0,0} for a central hit.
  applyImpulse(impulse, r = { x: 0, y: 0 }) {
    this.velocity.x += this.invMass * impulse.x;
    this.velocity.y += this.invMass * impulse.y;
    this.angularVelocity += this.invInertia * Vec2.cross(r, impulse);
  }

  // Step 1 of the pair: turn accumulated force + gravity into a velocity change.
  // gravity is an ACCELERATION (independent of mass — a feather and an anvil
  // fall at the same rate), so it is added directly, while contact/applied force
  // is scaled by invMass.
  integrateForces(gravity, dt) {
    if (this.isStatic || this.sleeping) return;
    this.velocity.x += (this.force.x * this.invMass + gravity.x * this.gravityScale) * dt;
    this.velocity.y += (this.force.y * this.invMass + gravity.y * this.gravityScale) * dt;
    this.angularVelocity += this.torque * this.invInertia * dt;
  }

  // Step 2 of the pair: advance position by the (already updated) velocity.
  integrateVelocity(dt) {
    if (this.isStatic || this.sleeping) return;
    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;
    this.angle += this.angularVelocity * dt;
  }

  clearForces() { this.force.x = 0; this.force.y = 0; this.torque = 0; }

  wake() { this.sleeping = false; this.sleepTimer = 0; }
}

module.exports = { RigidBody };
