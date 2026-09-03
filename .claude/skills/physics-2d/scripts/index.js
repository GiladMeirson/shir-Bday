// index.js — one import for the whole engine.
//
//   const P = require('./scripts/index.js');
//   const world = new P.World({ gravity: { x: 0, y: 900 } });
//   const ball = world.add(new P.RigidBody({ shape: P.makeCircle(20), position: { x: 100, y: 0 } }));
//   world.add(new P.RigidBody({ shape: P.makeBox(800, 40), position: { x: 400, y: 580 }, isStatic: true }));
//   // in your requestAnimationFrame loop, with dt in seconds:
//   world.update(dt);
//
// For browser/ESM use, re-export these with `export` or load via a bundler;
// the modules use CommonJS so they also run under Node for testing.

const Vec2 = require('./vec2.js');
const shapes = require('./shapes.js');
const { RigidBody } = require('./body.js');
const broadphase = require('./broadphase.js');
const collision = require('./collision.js');
const solver = require('./solver.js');
const constraints = require('./constraints.js');
const raycast = require('./raycast.js');
const { World } = require('./world.js');

module.exports = {
  Vec2,
  RigidBody,
  World,
  // shape constructors + mass helpers
  makeCircle: shapes.makeCircle,
  makeBox: shapes.makeBox,
  makePolygon: shapes.makePolygon,
  computeMass: shapes.computeMass,
  computeAABB: shapes.computeAABB,
  // joints
  DistanceJoint: constraints.DistanceJoint,
  RevoluteJoint: constraints.RevoluteJoint,
  SpringJoint: constraints.SpringJoint,
  // queries + lower-level pieces (for custom pipelines)
  raycast: raycast.raycast,
  rayVsBody: raycast.rayVsBody,
  collide: collision.collide,
  broadphase,
  solver,
};
