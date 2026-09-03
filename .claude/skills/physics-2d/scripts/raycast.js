// raycast.js — shoot a ray into the world and find what it hits first. Pairs
// with references/collision-detection.md.
//
// This is the query side of collision, and games lean on it constantly:
// hitscan weapons, line-of-sight / AI vision checks, laser sights, mouse
// picking, ground sensors, and as the honest fix for bullet tunneling that
// adaptive substepping can't reach (cast the bullet's path each step, teleport
// to the hit). Returns the NEAREST hit: { body, point, normal, t } where t is
// the distance along the ray, or null for a miss.

const Vec2 = require('./vec2.js');

const EPS = 1e-9;

// Ray (origin + t·dir, dir unit, t>=0) vs circle. Returns t of the first
// surface crossing or null.
function rayVsCircle(origin, dir, center, radius) {
  const m = Vec2.sub(origin, center);
  const b = Vec2.dot(m, dir);
  const c = Vec2.dot(m, m) - radius * radius;
  if (c > 0 && b > 0) return null;            // origin outside and pointing away
  const disc = b * b - c;
  if (disc < 0) return null;                  // ray misses the circle
  let t = -b - Math.sqrt(disc);
  if (t < 0) t = 0;                           // origin inside the circle
  return t;
}

// Ray vs one segment a→b. Returns t along the ray (and u along the segment) or
// null. Used to walk a convex polygon's edges.
function rayVsSegment(origin, dir, a, b) {
  const e = Vec2.sub(b, a);
  const denom = Vec2.cross(dir, e);
  if (Math.abs(denom) < EPS) return null;     // parallel
  const ao = Vec2.sub(a, origin);
  const t = Vec2.cross(ao, e) / denom;
  const u = Vec2.cross(ao, dir) / denom;
  if (t < 0 || u < 0 || u > 1) return null;
  return t;
}

// Ray vs a body (circle or convex polygon). Returns { t, point, normal } or null.
function rayVsBody(origin, dir, body) {
  if (body.shape.type === 'circle') {
    const t = rayVsCircle(origin, dir, body.position, body.shape.radius);
    if (t == null) return null;
    const point = Vec2.addScaled(origin, dir, t);
    const normal = Vec2.normalize(Vec2.sub(point, body.position));
    return { t, point, normal };
  }
  // Polygon: nearest hit among the edges.
  const verts = body.shape.vertices, norms = body.shape.normals;
  let bestT = Infinity, bestNormal = null;
  for (let i = 0; i < verts.length; i++) {
    const a = Vec2.add(body.position, Vec2.rotate(verts[i], body.angle));
    const b = Vec2.add(body.position, Vec2.rotate(verts[(i + 1) % verts.length], body.angle));
    const t = rayVsSegment(origin, dir, a, b);
    if (t != null && t < bestT) {
      bestT = t;
      bestNormal = Vec2.rotate(norms[i], body.angle);
    }
  }
  if (!bestNormal) return null;
  return { t: bestT, point: Vec2.addScaled(origin, dir, bestT), normal: bestNormal };
}

// Cast a ray through every body in `bodies` and return the nearest hit, or null.
// `dir` need not be normalized. `maxDist` bounds the ray (default unbounded).
// `filter(body)` may reject bodies (e.g. skip the shooter, or a layer mask).
function raycast(bodies, origin, dir, maxDist = Infinity, filter = null) {
  const d = Vec2.normalize(dir);
  let best = null;
  for (const body of bodies) {
    if (filter && !filter(body)) continue;
    const hit = rayVsBody(origin, d, body);
    if (hit && hit.t <= maxDist && (!best || hit.t < best.t)) {
      best = { body, point: hit.point, normal: hit.normal, t: hit.t };
    }
  }
  return best;
}

module.exports = { raycast, rayVsBody, rayVsCircle, rayVsSegment };
