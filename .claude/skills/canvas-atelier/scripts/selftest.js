// selftest.js — behavioural checks for the helper scripts.
// Run: node scripts/selftest.js
//
// These assert that the helpers do what the reference docs SAY they do, which
// is the failure mode this skill keeps running into: code that looks correct,
// runs without error, and produces the wrong picture. Several checks below are
// regressions for exactly that — a jitter that was silently a no-op, a wind
// function that silently returned NaN. Neither threw. Both were invisible in
// source and obvious in pixels.
//
// Re-run after touching anything in scripts/.

const Easing = require('./easing.js');
const ValueNoise = require('./noise.js');
const Bezier = require('./bezier-utils.js');
const Verlet = require('./verlet.js');
const Shading = require('./shading.js');
const Armature = require('./armature.js');

let pass = 0, fail = 0;
const ck = (n, c, d = '') => { c ? (pass++, console.log(`  ok   ${n} ${d}`))
                                 : (fail++, console.log(`  FAIL ${n} ${d}`)); };

const hsl = (s) => {
  const m = /hsla?\(\s*([\d.-]+),\s*([\d.]+)%,\s*([\d.]+)%/.exec(s);
  return m ? { h: +m[1], s: +m[2], l: +m[3] } : null;
};

function fakeCtx() {
  const calls = [];
  const grad = () => {
    const stops = [];
    return { stops, addColorStop: (o, c) => stops.push([o, c]) };
  };
  return {
    calls,
    createRadialGradient: grad,
    createLinearGradient: grad,
    beginPath() { calls.push(['beginPath']); },
    moveTo(...a) { calls.push(['moveTo', ...a]); },
    quadraticCurveTo(...a) { calls.push(['quadraticCurveTo', ...a]); },
    bezierCurveTo(...a) { calls.push(['bezierCurveTo', ...a]); },
    closePath() { calls.push(['closePath']); },
  };
}

console.log('easing');
{
  for (const name of ['linear', 'easeOutCubic', 'easeInOutCubic', 'easeOutExpo', 'elastic', 'bounce']) {
    const f = Easing[name];
    ck(`${name} anchored at 0 and 1`, Math.abs(f(0)) < 1e-6 && Math.abs(f(1) - 1) < 1e-6,
      `f(0)=${f(0).toFixed(4)} f(1)=${f(1).toFixed(4)}`);
  }
  let mono = true;
  for (let t = 0; t < 1; t += 0.01) if (Easing.easeOutCubic(t + 0.01) < Easing.easeOutCubic(t)) mono = false;
  ck('easeOutCubic is monotonic', mono);
  let over = 0;
  for (let t = 0; t <= 1; t += 0.005) over = Math.max(over, Easing.easeOutBack(t));
  ck('easeOutBack overshoots past 1 on purpose', over > 1.02, `max=${over.toFixed(3)}`);

  // A critically-damped spring must converge without oscillating past target.
  let v = 0, x = 0, crossings = 0, prev = -1;
  for (let i = 0; i < 400; i++) {
    const r = Easing.springStep(x, 100, v, { dt: 16 });
    x = r.value; v = r.velocity;
    const side = x < 100 ? -1 : 1;
    if (side !== prev) { crossings++; prev = side; }
  }
  ck('springStep converges on target', Math.abs(x - 100) < 0.5, `x=${x.toFixed(3)}`);
  ck('springStep does not ring', crossings <= 2, `crossings=${crossings}`);
}

console.log('noise');
{
  const n = new ValueNoise(1234);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 50000; i++) {
    const v = n.get(Math.random() * 40, Math.random() * 40, Math.random() * 40);
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  ck('noise stays inside [-1, 1]', lo >= -1 && hi <= 1, `[${lo.toFixed(3)}, ${hi.toFixed(3)}]`);
  ck('noise actually varies', hi - lo > 1, `range=${(hi - lo).toFixed(3)}`);

  const a = new ValueNoise(7), b = new ValueNoise(7), c = new ValueNoise(8);
  ck('same seed reproduces', a.get(3.3, 1.7, 0.4) === b.get(3.3, 1.7, 0.4));
  ck('different seed differs', a.get(3.3, 1.7, 0.4) !== c.get(3.3, 1.7, 0.4));

  // Neighbouring samples must be close, or "noise" is just static and will
  // read as dirt rather than texture.
  let maxJump = 0;
  for (let i = 0; i < 500; i++) maxJump = Math.max(maxJump, Math.abs(a.get(i * 0.02, 0) - a.get(i * 0.02 + 0.02, 0)));
  ck('noise is smooth between samples', maxJump < 0.35, `maxJump=${maxJump.toFixed(3)}`);
  ck('fbm stays in range', Math.abs(a.fbm(1.5, 2.5, 0.5)) <= 1);
}

console.log('bezier-utils');
{
  const pts = [[0, 0], [10, 20], [30, 15], [45, 40]];
  const segs = Bezier.catmullRomToBezier(pts);
  ck('catmull-rom yields n-1 open segments', segs.length === pts.length - 1, `got ${segs.length}`);
  ck('catmull-rom passes through every point',
    segs.every((s, i) => s.end[0] === pts[i + 1][0] && s.end[1] === pts[i + 1][1]));
  ck('closed catmull-rom returns to the start',
    (() => { const s = Bezier.catmullRomToBezier(pts, { closed: true }); return s.length === pts.length && s[s.length - 1].end === pts[0]; })());

  // REGRESSION: irregularity is a fraction of the shape, not absolute pixels.
  // This shipped applying `(rand()-0.5) * 0.12` as raw pixels, so the
  // documented 5-15% band displaced points by well under a tenth of a pixel
  // and every "organic" shape came out a perfect primitive.
  const ring = (r) => Array.from({ length: 16 }, (_, i) =>
    [Math.cos((i / 16) * Math.PI * 2) * r, Math.sin((i / 16) * Math.PI * 2) * r]);
  const disp = (r) => {
    const base = ring(r);
    const j = Bezier.jitterPoints(base, 0.12, Bezier.seededRandom(3));
    return Math.max(...j.map((p, i) => Math.hypot(p[0] - base[i][0], p[1] - base[i][1])));
  };
  const d100 = disp(100), d10 = disp(10);
  ck('jitterPoints displaces a meaningful amount', d100 > 1 && d100 < 100 * 0.12,
    `${d100.toFixed(2)}px on r=100`);
  ck('jitterPoints is scale-invariant', Math.abs(d100 / d10 - 10) < 0.01,
    `r=100:${d100.toFixed(3)} r=10:${d10.toFixed(3)}`);
  ck('jitterPoints honours an explicit scale',
    Math.max(...Bezier.jitterPoints(ring(10), 0.12, Bezier.seededRandom(3), 100)
      .map((p, i) => Math.hypot(p[0] - ring(10)[i][0], p[1] - ring(10)[i][1]))) > 1);

  // REGRESSION: the midpoint-quadratic loop must start at the first MIDPOINT.
  // Starting at points[0] makes the opening segment's control point coincide
  // with its start, collapsing it to a straight chord and leaving a tangent
  // break — a flat spot and a corner on every "organic" blob.
  const ctx = fakeCtx();
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  Bezier.closedOrganicPath(ctx, square);
  const moveTo = ctx.calls.find((c) => c[0] === 'moveTo');
  const firstQ = ctx.calls.find((c) => c[0] === 'quadraticCurveTo');
  ck('path starts at a midpoint, not a vertex',
    !(moveTo[1] === square[0][0] && moveTo[2] === square[0][1]), `moveTo(${moveTo[1]}, ${moveTo[2]})`);
  ck('first segment is not degenerate',
    !(firstQ[1] === moveTo[1] && firstQ[2] === moveTo[2]));
  ck('path emits one segment per point and closes',
    ctx.calls.filter((c) => c[0] === 'quadraticCurveTo').length === square.length &&
    ctx.calls.some((c) => c[0] === 'closePath'));

  const ctx2 = fakeCtx();
  const blob = Bezier.organicBlob(ctx2, 50, 50, 20, { points: 10, rand: Bezier.seededRandom(9) });
  const radii = blob.map(([x, y]) => Math.hypot(x - 50, y - 50));
  ck('organicBlob is not a perfect circle', Math.max(...radii) - Math.min(...radii) > 0.5,
    `spread=${(Math.max(...radii) - Math.min(...radii)).toFixed(2)}`);
  ck('organicBlob stays recognisably circular', Math.max(...radii) / Math.min(...radii) < 1.4);
}

console.log('verlet');
{
  // Constraints must actually restore rest length, or cloth reads as rubber.
  const a = new Verlet.VerletPoint(0, 0, true);
  const b = new Verlet.VerletPoint(60, 0);
  const c = new Verlet.DistanceConstraint(a, b, 40);
  for (let i = 0; i < 40; i++) c.solve();
  ck('distance constraint converges to rest length', Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - 40) < 0.01,
    `len=${Math.hypot(b.x - a.x, b.y - a.y).toFixed(4)}`);

  // REGRESSION: a rope/hair strand is a one-column grid, and the old
  // `col / (cols - 1)` divided by zero there. Via simulateStep's `|| 0` the
  // NaN became silent zero wind; via the documented direct-call pattern it
  // turned the whole mesh into NaN. Neither threw.
  const noise = new ValueNoise(5);
  const chain = Verlet.buildChain(8, 15, 100, 20);
  const w = Verlet.windAcceleration(3, chain, noise, 1000);
  ck('wind is finite on a single-column chain', Number.isFinite(w.x) && Number.isFinite(w.y),
    `{x:${w.x}, y:${w.y}}`);
  ck('chain anchor distance ramps 0 -> 1 down its length',
    Verlet.anchorDistance(0, chain) === 0 && Verlet.anchorDistance(7, chain) === 1);

  // REGRESSION: the falloff must follow whichever edge is actually pinned.
  // With pinEdge 'top' the old column-based ramp blew hardest AT the anchor.
  const tapestry = Verlet.buildCloth(6, 5, 20, 0, 0, 'top');
  const pinned = tapestry.points.map((p, i) => (p.pinned ? i : -1)).filter((i) => i >= 0);
  ck('top-pinned cloth pins the top row', pinned.join(',') === '0,1,2,3,4,5');
  ck('wind is zero at every pinned point',
    pinned.every((i) => Verlet.anchorDistance(i, tapestry) === 0));
  ck('wind is full strength at the free bottom row',
    Verlet.anchorDistance(tapestry.points.length - 1, tapestry) === 1);

  const flag = Verlet.buildCloth(6, 5, 20, 0, 0, 'left');
  ck('left-pinned cloth ramps across columns',
    Verlet.anchorDistance(0, flag) === 0 && Verlet.anchorDistance(5, flag) === 1 &&
    Verlet.anchorDistance(6, flag) === 0);

  // A broken wind function must be loud, not plausible.
  let threw = false;
  try {
    const ch = Verlet.buildChain(4, 10, 0, 0);
    Verlet.simulateStep(ch.points, ch.constraints, 0, 0.4, 0.99, 4, () => ({ x: NaN, y: 0 }));
  } catch (e) { threw = /non-finite/.test(e.message); }
  ck('simulateStep throws on non-finite wind instead of silently zeroing it', threw);

  // A full run must stay finite and bounded — the original direct-offset wind
  // was an unbounded random walk that eventually tangled the mesh.
  const cloth = Verlet.buildCloth(10, 6, 18, 40, 30, 'left');
  for (let t = 0; t < 1200; t++) {
    Verlet.simulateStep(cloth.points, cloth.constraints, 0, 0.08, 0.985, 6,
      (p, i) => Verlet.windAcceleration(i, cloth, noise, t * 16));
  }
  const finite = cloth.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const maxDrift = Math.max(...cloth.points.map((p) => Math.hypot(p.x - 40, p.y - 30)));
  ck('cloth stays finite over 1200 steps', finite);
  ck('cloth stays bounded (wind does not random-walk)', maxDrift < 10 * 18 * 3,
    `maxDrift=${maxDrift.toFixed(1)}`);
  let stretched = 0;
  for (const c2 of cloth.constraints) {
    const len = Math.hypot(c2.p2.x - c2.p1.x, c2.p2.y - c2.p1.y);
    if (len > c2.restLength * 1.5) stretched++;
  }
  ck('constraints hold under wind', stretched === 0, `${stretched} over-stretched`);

  ck('foldCurvature reports a ridge as positive',
    Verlet.foldCurvature([{ y: 10 }, { y: 0 }, { y: 10 }], (x) => x, 1, 0, 3) > 0);
}

console.log('shading');
{
  const L = Shading.light(225, 35);
  ck('light() returns a unit vector', Math.abs(Math.hypot(L.x, L.y, L.z) - 1) < 1e-9);
  ck('upper-left light points up and left', L.x < 0 && L.y < 0 && L.z > 0,
    `(${L.x.toFixed(2)}, ${L.y.toFixed(2)}, ${L.z.toFixed(2)})`);

  const n = Shading.sphereNormalAt(60, 40, 50, 50, 30);
  ck('sphere normal is unit length', Math.abs(Math.hypot(n.x, n.y, n.z) - 1) < 1e-9);
  ck('sphere normal is null off the disc', Shading.sphereNormalAt(200, 200, 50, 50, 30) === null);
  ck('sphere normal at centre faces the viewer',
    (() => { const c = Shading.sphereNormalAt(50, 50, 50, 50, 30); return c.z === 1 && c.x === 0; })());

  // A cylinder's cross-section normal is perpendicular to its own axis, so
  // shading genuinely cannot depend on the light's axial component. Treating a
  // limb like a sphere (which does depend on it) is what makes limbs wrong.
  const axis = 0.7;
  const cn = Shading.cylinderNormalAt(0.4, axis);
  const axisVec = { x: Math.cos(axis), y: Math.sin(axis), z: 0 };
  ck('cylinder normal is perpendicular to the axis', Math.abs(Shading.dot(cn, axisVec)) < 1e-12);
  const shifted = { x: L.x + 5 * axisVec.x, y: L.y + 5 * axisVec.y, z: L.z };
  ck('cylinder shading ignores axial light',
    Math.abs(Shading.dot(cn, L) - Shading.dot(cn, shifted)) < 1e-12);

  ck('lambert never goes negative', Shading.lambert({ x: 0, y: 0, z: -1 }, L) === 0);
  ck('specular peaks when the normal bisects light and view',
    Shading.specular(Shading.normalize({ x: L.x, y: L.y, z: L.z + 1 }), L, 32) > 0.99);
  ck('tight specular is tighter than broad',
    Shading.specular({ x: 0.3, y: 0, z: Math.sqrt(1 - 0.09) }, L, 120) <
    Shading.specular({ x: 0.3, y: 0, z: Math.sqrt(1 - 0.09) }, L, 8));

  ck('hueLerp takes the short way round', Math.abs(Shading.hueLerp(350, 10, 0.5) - 0) < 1e-9,
    `got ${Shading.hueLerp(350, 10, 0.5).toFixed(2)}`);

  // The two colour rules the skill argues for, asserted rather than described.
  const base = [15, 70, 50];
  const dark = hsl(Shading.shade(base, 0)), light = hsl(Shading.shade(base, 1));
  ck('shadow never reaches black', dark.l > 5, `l=${dark.l}`);
  ck('highlight never blows out to white', light.l < 95, `l=${light.l}`);
  // Assert the direction of the shift on the colour wheel, not the raw number:
  // hue wraps, so `dark.h > base.h` can pass for entirely the wrong reason.
  const angDist = (a, b) => Math.abs(((b - a) % 360 + 540) % 360 - 180);
  ck('warm light shifts the shadow toward the cool side',
    angDist(dark.h, 220) < angDist(base[0], 220),
    `h ${base[0]} -> ${dark.h.toFixed(1)}, distance to blue ${angDist(base[0], 220).toFixed(0)} -> ${angDist(dark.h, 220).toFixed(0)}`);
  const coolLit = [200, 70, 50];
  const coolDark = hsl(Shading.shade(coolLit, 0, { lightHue: 220 }));
  ck('cool light shifts the shadow toward the warm side',
    angDist(coolDark.h, 30) < angDist(coolLit[0], 30),
    `h ${coolLit[0]} -> ${coolDark.h.toFixed(1)}, distance to orange ${angDist(coolLit[0], 30).toFixed(0)} -> ${angDist(coolDark.h, 30).toFixed(0)}`);
  let peak = -1, peakAt = -1;
  for (let i = 0; i <= 20; i++) {
    const s = hsl(Shading.shade(base, i / 20)).s;
    if (s > peak) { peak = s; peakAt = i / 20; }
  }
  ck('chroma peaks between highlight and deepest shadow', peakAt > 0.15 && peakAt < 0.75,
    `peak at intensity ${peakAt.toFixed(2)}`);

  const ctx = fakeCtx();
  const g = Shading.sphereGradient(ctx, 60, 60, 40, base, L, { stops: 8 });
  const ls = g.stops.map(([, c]) => hsl(c).l);
  ck('sphere gradient emits every stop', g.stops.length === 8);
  ck('sphere gradient darkens away from the highlight',
    ls.every((v, i) => i === 0 || v <= ls[i - 1] + 1e-6), ls.map((v) => v.toFixed(1)).join(' > '));
  ck('sphere gradient offsets span 0..1',
    g.stops[0][0] === 0 && Math.abs(g.stops[g.stops.length - 1][0] - 1) < 1e-9);

  const cg = Shading.cylinderGradient(fakeCtx(), 20, 10, 20, 90, 15, base, Shading.light(200, 20), { stops: 9 });
  const cls = cg.stops.map(([, c]) => hsl(c).l);
  const brightest = cls.indexOf(Math.max(...cls));
  ck('cylinder highlight sits off-centre, not on the silhouette edge',
    brightest > 0 && brightest < cls.length - 1, `stop ${brightest} of ${cls.length - 1}`);
  ck('cylinder falls off on both sides of the highlight',
    cls[0] < cls[brightest] && cls[cls.length - 1] < cls[brightest]);
}

console.log('camera');
{
  const cam = Shading.camera({ focal: 600, horizonY: 200, originX: 300, eyeHeight: 100 });
  const near = cam.project(0, 100, 0), far = cam.project(0, 100, 100000);
  ck('receding points converge on the horizon', Math.abs(far.y - 200) < 1,
    `y=${far.y.toFixed(2)} horizon=200`);
  ck('nearer is lower on screen than farther, for ground points', near.y > far.y);
  ck('scale falls off with distance', cam.scaleAt(0) > cam.scaleAt(500) && cam.scaleAt(500) > 0);

  const atEye = Shading.camera({ focal: 600, horizonY: 200, originX: 300, eyeHeight: 0 }).groundCircle(0, 400, 50);
  const belowEye = cam.groundCircle(0, 400, 50);
  ck('a ground circle at eye level collapses to a line', atEye.ry < 0.01, `ry=${atEye.ry.toFixed(4)}`);
  ck('a ground circle below eye level opens up', belowEye.ry > 1, `ry=${belowEye.ry.toFixed(2)}`);
  ck('ground circle stays wider than it is deep', belowEye.rx > belowEye.ry);
}

console.log('armature');
{
  const rig = Armature.rig(0, 0, 200, 400);
  rig.at('skullTop', 0.5, 0.10).at('chin', 0.5, 0.26).mid('eyeLine', 'skullTop', 'chin');
  ck('derived landmark sits exactly where it should',
    rig.y('eyeLine') === (rig.y('skullTop') + rig.y('chin')) / 2, `y=${rig.y('eyeLine')}`);

  // The point of deriving: moving the parent moves the child, so they cannot
  // drift apart the way two independently typed coordinates do.
  rig.at('chin', 0.5, 0.30).mid('eyeLine', 'skullTop', 'chin');
  ck('re-deriving tracks the moved parent', rig.y('eyeLine') === (40 + 120) / 2, `y=${rig.y('eyeLine')}`);

  rig.mirror('eyeR', 'eyeLine', 100, 0.5);
  ck('mirror places the pair across the axis and breaks symmetry slightly',
    Math.abs(rig.x('eyeR') - 100) < 1 && rig.x('eyeR') !== rig.x('eyeLine'));

  ck('unknown landmark fails loudly',
    (() => { try { rig.p('nope'); return false; } catch (e) { return /unknown landmark/.test(e.message); } })());

  const r2 = Armature.rig(0, 0, 100, 800);
  r2.at('head', 0.5, 0.0).at('foot', 0.5, 1.0).at('waist', 0.5, 0.55);
  r2.check('figure is 7.5 heads tall', r2.spanY('head', 'foot') / (800 / 7.5), 7.5, 0.1);
  ck('a passing check does not throw', r2.verify().failed.length === 0);

  const r3 = Armature.rig(0, 0, 100, 100);
  r3.at('a', 0, 0).at('b', 0, 0.9);
  r3.check('deliberately wrong', r3.spanY('a', 'b'), 50, 1);
  ck('a failing check throws with the numbers in it',
    (() => { try { r3.verify(); return false; } catch (e) { return /got 90.00, want 50.00/.test(e.message); } })());
  ck('verify can report without throwing', r3.verify({ throwOnFail: false }).failed.length === 1);

  ck('assertProportions passes within tolerance',
    Armature.assertProportions([{ label: 'x', got: 10, want: 10.5, tol: 1 }]) === true);
  ck('assertProportions throws outside tolerance',
    (() => { try { Armature.assertProportions([{ label: 'x', got: 10, want: 20, tol: 1 }]); return false; } catch { return true; } })());
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
