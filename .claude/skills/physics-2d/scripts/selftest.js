// selftest.js — behavioral checks for the engine. Run: node scripts/selftest.js
// These assert PHYSICAL correctness (things fall, rest, bounce, stack, swing,
// don't tunnel), not just "no crash". Re-run after any change to a script;
// physics regressions are easy to introduce and hard to eyeball.

const P = require('./index.js');
const { Vec2, RigidBody, World, makeCircle, makeBox,
        DistanceJoint, RevoluteJoint, SpringJoint } = P;

let pass = 0, fail = 0;
const ck = (n, c, d = '') => { c ? (pass++, console.log(`  ok   ${n} ${d}`))
                                 : (fail++, console.log(`  FAIL ${n} ${d}`)); };

// 1. Free fall — semi-implicit Euler: v ≈ g·t after t seconds.
{
  const w = new World({ gravity: { x: 0, y: 10 }, allowSleep: false, ccd: false });
  const b = w.add(new RigidBody({ shape: makeCircle(1) }));
  for (let i = 0; i < 60; i++) w.step(1 / 60);
  ck('free fall v≈g·t', Math.abs(b.velocity.y - 10) < 0.2, `v=${b.velocity.y.toFixed(3)}`);
}

// 2. Ball rests on a static floor: settles, no sink, no explosion.
{
  const w = new World({ gravity: { x: 0, y: 10 }, ccd: false });
  w.add(new RigidBody({ shape: makeBox(200, 10), position: { x: 0, y: 100 }, isStatic: true }));
  const ball = w.add(new RigidBody({ shape: makeCircle(5), restitution: 0.3 }));
  for (let i = 0; i < 600; i++) w.step(1 / 60);
  ck('ball settled on floor', Math.abs(ball.position.y - 90) < 0.6, `y=${ball.position.y.toFixed(3)}`);
  ck('ball at rest', Math.abs(ball.velocity.y) < 0.5, `v=${ball.velocity.y.toFixed(3)}`);
}

// 3. Three-box stack keeps its heights, doesn't drift, and falls asleep.
{
  const w = new World({ gravity: { x: 0, y: 10 } });
  w.add(new RigidBody({ shape: makeBox(200, 20), position: { x: 0, y: 200 }, isStatic: true }));
  const s = 20, boxes = [];
  for (let k = 0; k < 3; k++)
    boxes.push(w.add(new RigidBody({ shape: makeBox(s, s), position: { x: 0, y: 190 - k * (s + 0.5) - s / 2 }, friction: 0.6, restitution: 0 })));
  for (let i = 0; i < 900; i++) w.step(1 / 60);
  boxes.forEach((b, k) => {
    ck(`stack box[${k}] height`, Math.abs(b.position.y - (180 - k * s)) < 3, `y=${b.position.y.toFixed(1)}`);
    ck(`stack box[${k}] no drift`, Math.abs(b.position.x) < 3, `x=${b.position.x.toFixed(2)}`);
  });
  ck('stack sleeps', boxes.every(b => b.sleeping));
}

// 4. Overlapping circles push apart symmetrically.
{
  const w = new World({ gravity: { x: 0, y: 0 }, allowSleep: false, ccd: false });
  const a = w.add(new RigidBody({ shape: makeCircle(5), position: { x: -3, y: 0 } }));
  const b = w.add(new RigidBody({ shape: makeCircle(5), position: { x: 3, y: 0 } }));
  for (let i = 0; i < 120; i++) w.step(1 / 60);
  ck('circles separated', Vec2.dist(a.position, b.position) > 9.5, `d=${Vec2.dist(a.position, b.position).toFixed(2)}`);
  ck('separation symmetric', Math.abs(a.position.x + b.position.x) < 1e-6);
}

// 5. Friction brings a sliding box to a stop.
{
  const w = new World({ gravity: { x: 0, y: 10 }, allowSleep: false, ccd: false });
  w.add(new RigidBody({ shape: makeBox(400, 10), position: { x: 0, y: 100 }, isStatic: true, friction: 0.8 }));
  const box = w.add(new RigidBody({ shape: makeBox(10, 10), position: { x: 0, y: 90 }, friction: 0.8, restitution: 0 }));
  box.velocity.x = 30;
  for (let i = 0; i < 600; i++) w.step(1 / 60);
  ck('friction stopped the box', Math.abs(box.velocity.x) < 15, `v=${box.velocity.x.toFixed(3)}`);
}

// 6. Anti-tunneling: a fast circle does not pass through a thin wall.
{
  const w = new World({ gravity: { x: 0, y: 0 }, allowSleep: false, ccd: true });
  w.add(new RigidBody({ shape: makeBox(2, 200), isStatic: true }));
  const bullet = w.add(new RigidBody({ shape: makeCircle(3), position: { x: -100, y: 0 }, restitution: 0.1 }));
  bullet.velocity.x = 500;
  for (let i = 0; i < 120; i++) w.step(1 / 60);
  ck('bullet did not tunnel', bullet.position.x < 5, `x=${bullet.position.x.toFixed(1)}`);
}

// 7. Pendulum (DistanceJoint): rod length held, energy bounded.
{
  const w = new World({ gravity: { x: 0, y: 10 }, allowSleep: false, ccd: false });
  const pivot = w.add(new RigidBody({ shape: makeCircle(1), isStatic: true }));
  const bob = w.add(new RigidBody({ shape: makeCircle(2), position: { x: 50, y: 0 } }));
  w.addJoint(new DistanceJoint(pivot, bob, { x: 0, y: 0 }, { x: 0, y: 0 }, { length: 50 }));
  let maxErr = 0, maxV = 0;
  for (let i = 0; i < 1200; i++) { w.step(1 / 60); maxErr = Math.max(maxErr, Math.abs(Vec2.dist(pivot.position, bob.position) - 50)); maxV = Math.max(maxV, Vec2.len(bob.velocity)); }
  ck('pendulum rod length held', maxErr < 0.6, `err=${maxErr.toFixed(3)}`);
  ck('pendulum energy bounded', maxV < 40 && Number.isFinite(bob.position.x), `maxV=${maxV.toFixed(1)}`);
}

// 8. Revolute pin: anchor stays coincident, arm swings (needs filtering).
{
  const w = new World({ gravity: { x: 0, y: 10 }, allowSleep: false, ccd: false });
  const anchor = w.add(new RigidBody({ shape: makeBox(4, 4), isStatic: true }));
  const arm = w.add(new RigidBody({ shape: makeBox(40, 6), position: { x: 20, y: 0 } }));
  w.addJoint(new RevoluteJoint(anchor, arm, { x: 0, y: 0 }, { x: -20, y: 0 }));
  let maxGap = 0;
  for (let i = 0; i < 600; i++) { w.step(1 / 60); maxGap = Math.max(maxGap, Vec2.dist(Vec2.add(arm.position, Vec2.rotate({ x: -20, y: 0 }, arm.angle)), anchor.position)); }
  ck('revolute pin coincident', maxGap < 1.0, `gap=${maxGap.toFixed(3)}`);
  ck('revolute arm swung', Math.abs(arm.angle) > 0.1, `angle=${arm.angle.toFixed(3)}`);
}

// 9. Spring settles to analytic equilibrium and comes to rest.
{
  const w = new World({ gravity: { x: 0, y: 10 }, allowSleep: false, ccd: false });
  const top = w.add(new RigidBody({ shape: makeCircle(1), isStatic: true }));
  const mass = w.add(new RigidBody({ shape: makeCircle(3), position: { x: 0, y: 20 } }));
  const k = 200, rest = 20;
  w.addJoint(new SpringJoint(top, mass, { x: 0, y: 0 }, { x: 0, y: 0 }, { stiffness: k, damping: 3, restLength: rest }));
  for (let i = 0; i < 2000; i++) w.step(1 / 60);
  ck('spring at equilibrium', Math.abs(mass.position.y - (rest + mass.mass * 10 / k)) < 1.5, `y=${mass.position.y.toFixed(2)}`);
  ck('spring at rest', Vec2.len(mass.velocity) < 0.5);
}

// 10. Rotated box dropped on floor tips, settles flat, no blow-up (poly-poly SAT).
{
  const w = new World({ gravity: { x: 0, y: 10 } });
  w.add(new RigidBody({ shape: makeBox(300, 20), position: { x: 0, y: 200 }, isStatic: true, friction: 0.6 }));
  const box = w.add(new RigidBody({ shape: makeBox(30, 30), position: { x: 0, y: 120 }, angle: 0.5, friction: 0.6, restitution: 0.1 }));
  for (let i = 0; i < 1200; i++) w.step(1 / 60);
  const a = ((box.angle % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
  ck('tilted box settled on a face', Math.min(a, Math.PI / 2 - a) < 0.06, `angle=${box.angle.toFixed(3)}`);
  ck('tilted box did not fall through', box.position.y > 150 && box.position.y < 190, `y=${box.position.y.toFixed(1)}`);
}

// 11. Raycast: nearest hit, surface point, normal, maxDist, filter.
{
  const w = new World({ gravity: { x: 0, y: 0 }, allowSleep: false });
  const circ = w.add(new RigidBody({ shape: makeCircle(10), position: { x: 100, y: 0 }, isStatic: true }));
  w.add(new RigidBody({ shape: makeBox(20, 20), position: { x: 100, y: 100 }, isStatic: true }));
  const h = w.raycast({ x: 0, y: 0 }, { x: 1, y: 0 });
  ck('ray hits nearest surface', h && h.body === circ && Math.abs(h.point.x - 90) < 0.5, h ? `x=${h.point.x.toFixed(1)}` : 'null');
  ck('ray maxDist bounds', w.raycast({ x: 0, y: 0 }, { x: 1, y: 0 }, 50) === null);
  ck('ray filter skips body', w.raycast({ x: 0, y: 0 }, { x: 1, y: 0 }, Infinity, b => b !== circ) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
