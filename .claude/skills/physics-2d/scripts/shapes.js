// shapes.js — collision shapes (circle, convex polygon) plus the mass and
// moment-of-inertia math that turns a shape + density into the numbers the
// integrator needs. Pairs with references/foundations.md.
//
// Two shape kinds cover the vast majority of 2D games: circles and convex
// polygons (a box is just a 4-vertex polygon). Concave shapes are built by
// gluing several convex polygons onto one body — never feed a concave vertex
// loop to SAT, it will silently give wrong contacts.
//
// Convention: polygon vertices are stored CCW with the centroid at the local
// origin, and each normals[i] is the OUTWARD unit normal of the edge from
// vertices[i] to vertices[i+1]. makePolygon enforces all of that, so the SAT
// code in collision.js can rely on it.

const Vec2 = require('./vec2.js');

function makeCircle(radius) {
  return { type: 'circle', radius };
}

// vertices: array of {x, y} in local space, any winding. Returns a polygon with
// CCW winding, centroid-relative vertices, and outward edge normals.
function makePolygon(vertices) {
  let verts = vertices.map(v => ({ x: v.x, y: v.y }));

  // Enforce CCW winding (signed area > 0). Screen space is often y-down, which
  // visually mirrors winding — don't eyeball it, let the signed area decide.
  let signedArea = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i], b = verts[(i + 1) % verts.length];
    signedArea += Vec2.cross(a, b);
  }
  if (signedArea < 0) verts.reverse();

  const normals = [];
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i], b = verts[(i + 1) % verts.length];
    const edge = Vec2.sub(b, a);
    // CCW winding → outward normal is the right-hand perpendicular (e.y, -e.x).
    normals.push(Vec2.normalize({ x: edge.y, y: -edge.x }));
  }
  return { type: 'polygon', vertices: verts, normals };
}

// Axis-aligned box of full width w and height h, centered on the body origin.
function makeBox(w, h) {
  const hw = w / 2, hh = h / 2;
  return makePolygon([
    { x: -hw, y: -hh }, { x: hw, y: -hh },
    { x: hw, y: hh }, { x: -hw, y: hh },
  ]);
}

// Returns { mass, inertia } about the centroid. For polygons this also
// RECENTERS the shape's vertices so the centroid sits at the local origin —
// otherwise the body would spin about the wrong point. Call once at body
// creation; a static body ignores the numbers (it uses invMass = 0).
function computeMass(shape, density) {
  if (shape.type === 'circle') {
    const mass = density * Math.PI * shape.radius * shape.radius;
    // Solid disk about its center: I = ½·m·r².
    const inertia = 0.5 * mass * shape.radius * shape.radius;
    return { mass, inertia };
  }

  const verts = shape.vertices;
  const n = verts.length;

  // Pass 1: area + centroid via the fan-of-triangles integral.
  let area = 0;
  let centroid = { x: 0, y: 0 };
  for (let i = 0; i < n; i++) {
    const p1 = verts[i], p2 = verts[(i + 1) % n];
    const cross = Vec2.cross(p1, p2);       // 2·(triangle area)
    const triArea = 0.5 * cross;
    area += triArea;
    centroid.x += triArea * (p1.x + p2.x) / 3;
    centroid.y += triArea * (p1.y + p2.y) / 3;
  }
  centroid = Vec2.scale(centroid, 1 / area);

  // Recenter vertices so the centroid is the local origin. Do this BEFORE
  // computing inertia so the result is the centroidal moment directly (no
  // parallel-axis correction needed afterwards).
  for (const v of verts) { v.x -= centroid.x; v.y -= centroid.y; }

  // Pass 2: second moment about the (now centered) origin.
  let I = 0;
  for (let i = 0; i < n; i++) {
    const p1 = verts[i], p2 = verts[(i + 1) % n];
    const cross = Vec2.cross(p1, p2);
    const intx2 = p1.x * p1.x + p1.x * p2.x + p2.x * p2.x;
    const inty2 = p1.y * p1.y + p1.y * p2.y + p2.y * p2.y;
    I += (0.25 / 3) * cross * (intx2 + inty2);
  }

  const mass = density * area;
  return { mass, inertia: density * I };
}

// World-space axis-aligned bounding box, {minX, minY, maxX, maxY}. Broadphase
// uses this to reject pairs cheaply before the exact narrow-phase test.
function computeAABB(body) {
  const s = body.shape;
  if (s.type === 'circle') {
    return {
      minX: body.position.x - s.radius, minY: body.position.y - s.radius,
      maxX: body.position.x + s.radius, maxY: body.position.y + s.radius,
    };
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of s.vertices) {
    const w = Vec2.add(body.position, Vec2.rotate(v, body.angle));
    if (w.x < minX) minX = w.x; if (w.x > maxX) maxX = w.x;
    if (w.y < minY) minY = w.y; if (w.y > maxY) maxY = w.y;
  }
  return { minX, minY, maxX, maxY };
}

module.exports = { makeCircle, makePolygon, makeBox, computeMass, computeAABB };
