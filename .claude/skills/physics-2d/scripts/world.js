// world.js — the object you actually drive. Holds the bodies, owns gravity, and
// runs the pipeline in the ONE order that stays stable. Pairs with all five
// reference files; the pipeline order is explained in foundations.md.
//
//   update(realFrameDelta)   <- call this from requestAnimationFrame
//     └─ fixed-timestep accumulator: runs step() zero-or-more times at a
//        constant dt, so the simulation is deterministic and frame-rate
//        independent (see "Fix Your Timestep" in foundations.md).
//        └─ step(dt): broadphase → narrowphase → integrate forces →
//                     solve velocities (N iterations) → integrate positions →
//                     correct positions → sleep bookkeeping.
//
// Coordinates are unit-agnostic. A canvas game usually works in pixels with
// y pointing DOWN, so positive gravity.y (e.g. {x:0, y:1000}) pulls things
// down-screen. If you prefer SI units, work in meters and multiply by a
// pixels-per-meter constant only at render time.

const Vec2 = require('./vec2.js');
const { computeAABB } = require('./shapes.js');
const { computePairs } = require('./broadphase.js');
const { collide } = require('./collision.js');
const { prepare, solveVelocity, correctPositions } = require('./solver.js');
const { raycast } = require('./raycast.js');

class World {
  constructor(opts = {}) {
    this.gravity = opts.gravity ? Vec2.clone(opts.gravity) : { x: 0, y: 9.81 };
    this.bodies = [];
    this.joints = [];

    this.fixedDt = opts.fixedDt ?? 1 / 60;            // simulation timestep (s)
    this.velocityIterations = opts.velocityIterations ?? 8;
    this.cellSize = opts.cellSize ?? 64;              // broadphase grid cell
    this.maxSubSteps = opts.maxSubSteps ?? 5;         // spiral-of-death guard

    this.allowSleep = opts.allowSleep ?? true;
    this.sleepLinearTol = opts.sleepLinearTol ?? 0.08;
    this.sleepAngularTol = opts.sleepAngularTol ?? 0.05;
    this.timeToSleep = opts.timeToSleep ?? 0.5;

    // Below this closing speed, a collision does not bounce (restitution is
    // suppressed) so bodies settling under gravity don't jitter. Raise it if
    // you work in large pixel units and slow bounces look dead; lower it if
    // gentle impacts should still visibly bounce.
    this.restitutionThreshold = opts.restitutionThreshold ?? 1.0;

    // Anti-tunneling by adaptive substepping (see stability-and-tuning.md).
    // When a body would move more than `ccdSlop`× its own radius in one step,
    // the step is subdivided so it can't skip over a thin wall. This is finer
    // time resolution, not true swept CCD — good enough for the common case.
    this.ccd = opts.ccd ?? true;
    this.ccdSlop = opts.ccdSlop ?? 0.5;
    this.maxCcdSubSteps = opts.maxCcdSubSteps ?? 4;

    this.accumulator = 0;
    this._nextId = 0;
  }

  // Filtering rule: group overrides bits. Equal non-zero groups force the
  // outcome (positive = always collide, negative = never); otherwise the
  // category/mask bits must agree in both directions.
  _shouldCollide(a, b) {
    if (a.filterGroup !== 0 && a.filterGroup === b.filterGroup) {
      return a.filterGroup > 0;
    }
    return (a.filterCategory & b.filterMask) !== 0
      && (b.filterCategory & a.filterMask) !== 0;
  }

  add(body) {
    if (body.id < 0) body.id = this._nextId++;
    this.bodies.push(body);
    return body;
  }
  remove(body) {
    const i = this.bodies.indexOf(body);
    if (i >= 0) this.bodies.splice(i, 1);
  }

  addJoint(joint) { this.joints.push(joint); return joint; }
  removeJoint(joint) {
    const i = this.joints.indexOf(joint);
    if (i >= 0) this.joints.splice(i, 1);
  }

  // Nearest body hit by a ray from `origin` along `dir`. See raycast.js.
  // Returns { body, point, normal, t } or null.
  raycast(origin, dir, maxDist = Infinity, filter = null) {
    return raycast(this.bodies, origin, dir, maxDist, filter);
  }

  // Bounding radius (max distance centroid→surface), cached. Used by the CCD
  // guard and cheap culling.
  _boundingRadius(b) {
    if (b._boundingRadius != null) return b._boundingRadius;
    let r;
    if (b.shape.type === 'circle') r = b.shape.radius;
    else { r = 0; for (const v of b.shape.vertices) r = Math.max(r, Vec2.len(v)); }
    b._boundingRadius = r;
    return r;
  }

  // Drive from your render loop with the REAL elapsed seconds since last call.
  // Returns an interpolation alpha in [0,1): lerp each body between
  // prevPosition/prevAngle and position when drawing, for smooth motion that
  // doesn't stutter when the fixed step and the frame rate disagree.
  update(frameTime) {
    if (frameTime > 0.25) frameTime = 0.25;          // clamp huge stalls
    this.accumulator += frameTime;
    let steps = 0;
    while (this.accumulator >= this.fixedDt && steps < this.maxSubSteps) {
      this._fixedStep(this.fixedDt);
      this.accumulator -= this.fixedDt;
      steps++;
    }
    // Ran out of budget (tab was backgrounded, slow frame): drop the backlog
    // instead of trying to catch up forever.
    if (this.accumulator >= this.fixedDt) this.accumulator = 0;
    return this.accumulator / this.fixedDt;
  }

  // One fixed step, possibly subdivided for anti-tunneling.
  _fixedStep(dt) {
    // Snapshot for render interpolation.
    for (const b of this.bodies) {
      b.prevPosition = Vec2.clone(b.position);
      b.prevAngle = b.angle;
    }

    let k = 1;
    if (this.ccd) {
      for (const b of this.bodies) {
        if (b.isStatic || b.sleeping) continue;
        const travel = Vec2.len(b.velocity) * dt;
        const limit = this.ccdSlop * this._boundingRadius(b);
        if (limit > 0 && travel > limit) {
          k = Math.max(k, Math.min(this.maxCcdSubSteps, Math.ceil(travel / limit)));
        }
      }
    }
    const sub = dt / k;
    for (let s = 0; s < k; s++) this.step(sub);
  }

  // A single simulation step. Advances every body by dt and resolves contacts.
  step(dt) {
    const bodies = this.bodies;

    // 1. Broadphase — refresh AABBs, get candidate pairs.
    for (const b of bodies) b.aabb = computeAABB(b);
    const pairs = computePairs(bodies, this.cellSize);

    // Pairs excluded because a joint connects them with collideConnected off.
    const jointExcluded = new Set();
    for (const jt of this.joints) {
      if (!jt.collideConnected) {
        const lo = Math.min(jt.a.id, jt.b.id), hi = Math.max(jt.a.id, jt.b.id);
        jointExcluded.add(lo * 100000 + hi);
      }
    }

    // 2. Narrowphase — exact test, build manifolds, wake sleepers on contact.
    const manifolds = [];
    for (const [i, j] of pairs) {
      const A = bodies[i], B = bodies[j];
      if (A.isStatic && B.isStatic) continue;
      if (A.sleeping && B.sleeping) continue;
      if (!this._shouldCollide(A, B)) continue;
      const lo = Math.min(A.id, B.id), hi = Math.max(A.id, B.id);
      if (jointExcluded.has(lo * 100000 + hi)) continue;
      const m = collide(A, B);
      if (!m) continue;
      // A moving body touching a sleeper wakes it.
      if (A.sleeping && !B.sleeping && !B.isStatic) A.wake();
      if (B.sleeping && !A.sleeping && !A.isStatic) B.wake();
      manifolds.push(m);
    }

    // Jointed bodies stay awake — a joint can keep feeding energy (a swinging
    // pendulum, a driven spring), so it must not be frozen by the sleep system.
    for (const j of this.joints) {
      if (!j.a.isStatic) j.a.wake();
      if (!j.b.isStatic) j.b.wake();
    }

    // 3. Soft forces (springs) feed the accumulator, then integrate forces
    //    (velocity update) — semi-implicit Euler, step 1.
    for (const j of this.joints) if (j.applyForces) j.applyForces(dt);
    for (const b of bodies) b.integrateForces(this.gravity, dt);

    // 4. Prepare + 5. solve velocities (sequential impulses). Joints and
    //    contacts share the same iteration loop; joints solved first each pass.
    for (const m of manifolds) prepare(m, this.gravity, dt, this.restitutionThreshold);
    for (const j of this.joints) if (j.prepare) j.prepare(dt);
    for (let it = 0; it < this.velocityIterations; it++) {
      for (const j of this.joints) if (j.solveVelocity) j.solveVelocity();
      for (const m of manifolds) solveVelocity(m);
    }

    // 6. Integrate velocities (position update) — semi-implicit Euler, step 2.
    for (const b of bodies) b.integrateVelocity(dt);

    // 7. Positional correction — push out residual overlap.
    for (const m of manifolds) correctPositions(m);

    // 8. Clear force accumulators for next step.
    for (const b of bodies) b.clearForces();

    // 9. Sleeping bookkeeping.
    if (this.allowSleep) this._updateSleeping(dt);
  }

  _updateSleeping(dt) {
    const linTolSq = this.sleepLinearTol * this.sleepLinearTol;
    for (const b of this.bodies) {
      if (b.isStatic) continue;
      const still = Vec2.lenSq(b.velocity) < linTolSq
        && Math.abs(b.angularVelocity) < this.sleepAngularTol;
      if (!still) {
        b.sleepTimer = 0;
        b.sleeping = false;
      } else if (!b.sleeping) {
        b.sleepTimer += dt;
        if (b.sleepTimer >= this.timeToSleep) {
          b.sleeping = true;
          b.velocity.x = 0; b.velocity.y = 0; b.angularVelocity = 0;
        }
      }
    }
  }
}

module.exports = { World };
