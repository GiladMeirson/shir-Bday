// collision.js — narrow phase: given two bodies whose AABBs overlap, decide
// whether the actual shapes touch and, if so, produce a CONTACT MANIFOLD.
// Pairs with references/collision-detection.md.
//
// A manifold is everything the solver needs to push two bodies apart correctly:
//   { a, b, normal, penetration, contacts }
//   normal      : unit vector pointing FROM a TO b. To separate, a moves along
//                 -normal and b along +normal. Every function here honors that
//                 one convention — get it wrong and objects suck together
//                 instead of bouncing apart.
//   penetration : how deep the overlap is, along the normal (always >= 0).
//   contacts    : 1 point for circles / vertex hits, up to 2 for a face-on
//                 polygon rest (needed so a box doesn't tip on a single point).
//
// Polygon-vs-polygon uses SAT (Separating Axis Theorem) to find the axis of
// least penetration, then reference/incident face clipping to build the contact
// points. This is the classic Randy Gaul "Impulse Engine" construction.

const Vec2 = require('./vec2.js');

const EPS = 1e-6;

// --- small transform helpers ---
const toWorld = (body, local) => Vec2.add(body.position, Vec2.rotate(local, body.angle));
const dirToLocal = (body, dir) => Vec2.rotate(dir, -body.angle);
const dirToWorld = (body, dir) => Vec2.rotate(dir, body.angle);

// Support point: the vertex of a convex polygon furthest along `dir` (all in
// the polygon's local space). The workhorse of SAT.
function getSupport(vertices, dir) {
  let best = -Infinity, bestV = vertices[0];
  for (const v of vertices) {
    const p = Vec2.dot(v, dir);
    if (p > best) { best = p; bestV = v; }
  }
  return bestV;
}

// ---------------------------------------------------------------------------
// circle vs circle
// ---------------------------------------------------------------------------
function circleVsCircle(a, b) {
  const n = Vec2.sub(b.position, a.position);
  const rSum = a.shape.radius + b.shape.radius;
  const distSq = Vec2.lenSq(n);
  if (distSq >= rSum * rSum) return null;

  const dist = Math.sqrt(distSq);
  let normal, contact;
  if (dist < EPS) {
    // Exactly concentric — pick an arbitrary but consistent normal.
    normal = { x: 1, y: 0 };
    contact = Vec2.clone(a.position);
    return { a, b, normal, penetration: a.shape.radius, contacts: [contact] };
  }
  normal = Vec2.scale(n, 1 / dist);                 // from a to b
  contact = Vec2.addScaled(a.position, normal, a.shape.radius);
  return { a, b, normal, penetration: rSum - dist, contacts: [contact] };
}

// ---------------------------------------------------------------------------
// circle vs polygon — returns normal pointing from the CIRCLE to the POLYGON.
// ---------------------------------------------------------------------------
function circleVsPolygon(circle, poly) {
  const r = circle.shape.radius;
  const verts = poly.shape.vertices, norms = poly.shape.normals;
  // Circle center in the polygon's local frame.
  const center = dirToLocal(poly, Vec2.sub(circle.position, poly.position));

  // Face of greatest separation.
  let separation = -Infinity, faceIndex = 0;
  for (let i = 0; i < verts.length; i++) {
    const s = Vec2.dot(norms[i], Vec2.sub(center, verts[i]));
    if (s > r) return null;            // circle entirely outside this face
    if (s > separation) { separation = s; faceIndex = i; }
  }

  const v1 = verts[faceIndex];
  const v2 = verts[(faceIndex + 1) % verts.length];

  // Center inside the polygon: push straight out along the deepest face normal.
  if (separation < EPS) {
    const polyToCircle = dirToWorld(poly, norms[faceIndex]); // outward from poly
    return {
      a: circle, b: poly,
      normal: Vec2.neg(polyToCircle),      // circle -> poly
      penetration: r - separation,
      contacts: [Vec2.clone(circle.position)],
    };
  }

  // Center outside: which Voronoi region of the closest face?
  const dot1 = Vec2.dot(Vec2.sub(center, v1), Vec2.sub(v2, v1));
  const dot2 = Vec2.dot(Vec2.sub(center, v2), Vec2.sub(v1, v2));
  const penetration = r - separation;
  let nLocal, contactLocal;

  if (dot1 <= 0) {                        // nearest to corner v1
    if (Vec2.distSq(center, v1) > r * r) return null;
    nLocal = Vec2.normalize(Vec2.sub(center, v1));
    contactLocal = v1;
  } else if (dot2 <= 0) {                 // nearest to corner v2
    if (Vec2.distSq(center, v2) > r * r) return null;
    nLocal = Vec2.normalize(Vec2.sub(center, v2));
    contactLocal = v2;
  } else {                               // nearest to the face interior
    nLocal = norms[faceIndex];
    contactLocal = Vec2.addScaled(center, nLocal, -r);
  }

  const polyToCircle = dirToWorld(poly, nLocal); // outward from poly toward circle
  return {
    a: circle, b: poly,
    normal: Vec2.neg(polyToCircle),      // circle -> poly
    penetration,
    contacts: [toWorld(poly, contactLocal)],
  };
}

// ---------------------------------------------------------------------------
// polygon vs polygon — SAT + face clipping
// ---------------------------------------------------------------------------

// Greatest separation of B beyond any face of A, with the responsible face.
// Returned separation < 0 means the shapes overlap on every one of A's axes.
function findAxisLeastPenetration(A, B) {
  let best = -Infinity, bestIndex = 0;
  const vertsA = A.shape.vertices, normsA = A.shape.normals;
  for (let i = 0; i < vertsA.length; i++) {
    // Face normal of A, expressed in B's local frame.
    const nWorld = dirToWorld(A, normsA[i]);
    const nB = dirToLocal(B, nWorld);
    // Support point of B in the direction opposing that face.
    const s = getSupport(B.shape.vertices, Vec2.neg(nB));
    // The face vertex of A, moved into B's local frame.
    let v = toWorld(A, vertsA[i]);
    v = dirToLocal(B, Vec2.sub(v, B.position));
    const d = Vec2.dot(nB, Vec2.sub(s, v));
    if (d > best) { best = d; bestIndex = i; }
  }
  return { separation: best, faceIndex: bestIndex };
}

// The face of the incident polygon most anti-parallel to the reference normal —
// this is the face that gets clipped against the reference face's side planes.
function findIncidentFace(refPoly, incPoly, refIndex) {
  const refNormalWorld = dirToWorld(refPoly, refPoly.shape.normals[refIndex]);
  const refNormalInc = dirToLocal(incPoly, refNormalWorld);
  let minDot = Infinity, incIndex = 0;
  const norms = incPoly.shape.normals;
  for (let i = 0; i < norms.length; i++) {
    const d = Vec2.dot(refNormalInc, norms[i]);
    if (d < minDot) { minDot = d; incIndex = i; }
  }
  const verts = incPoly.shape.vertices;
  return [
    toWorld(incPoly, verts[incIndex]),
    toWorld(incPoly, verts[(incIndex + 1) % verts.length]),
  ];
}

// Clip the segment `face` to the half-plane dot(n, p) <= c. Returns how many of
// the (up to 2) output points lie behind the plane.
function clip(n, c, face) {
  const out = [face[0], face[1]];
  let sp = 0;
  const d1 = Vec2.dot(n, face[0]) - c;
  const d2 = Vec2.dot(n, face[1]) - c;
  if (d1 <= 0) out[sp++] = face[0];
  if (d2 <= 0) out[sp++] = face[1];
  if (d1 * d2 < 0) {                     // endpoints straddle the plane
    const alpha = d1 / (d1 - d2);
    out[sp++] = Vec2.addScaled(face[0], Vec2.sub(face[1], face[0]), alpha);
  }
  face[0] = out[0];
  face[1] = out[1];
  return sp;
}

// Prefer keeping A's face as the reference face unless B's penetration is
// meaningfully larger — the bias stops the reference face from flickering
// between A and B on near-ties, which would make resting stacks jitter.
function biasGreaterThan(a, b) {
  const REL = 0.95, ABS = 0.01;
  return a >= b * REL + a * ABS;
}

function polygonVsPolygon(a, b) {
  const penA = findAxisLeastPenetration(a, b);
  if (penA.separation >= 0) return null;
  const penB = findAxisLeastPenetration(b, a);
  if (penB.separation >= 0) return null;

  let refPoly, incPoly, refIndex, flip;
  if (biasGreaterThan(penA.separation, penB.separation)) {
    refPoly = a; incPoly = b; refIndex = penA.faceIndex; flip = false;
  } else {
    refPoly = b; incPoly = a; refIndex = penB.faceIndex; flip = true;
  }

  const incidentFace = findIncidentFace(refPoly, incPoly, refIndex);

  // Reference face endpoints in world space.
  const verts = refPoly.shape.vertices;
  const v1 = toWorld(refPoly, verts[refIndex]);
  const v2 = toWorld(refPoly, verts[(refIndex + 1) % verts.length]);

  const sidePlane = Vec2.normalize(Vec2.sub(v2, v1));     // along the face
  const refFaceNormal = { x: sidePlane.y, y: -sidePlane.x }; // outward from refPoly

  const refC = Vec2.dot(refFaceNormal, v1);
  const negSide = -Vec2.dot(sidePlane, v1);
  const posSide = Vec2.dot(sidePlane, v2);

  // Clip the incident face to the two side planes of the reference face.
  if (clip(Vec2.neg(sidePlane), negSide, incidentFace) < 2) return null;
  if (clip(sidePlane, posSide, incidentFace) < 2) return null;

  // normal always points from a to b.
  const normal = flip ? Vec2.neg(refFaceNormal) : refFaceNormal;

  // Keep only clipped points that sit behind the reference face; average their
  // depth for the manifold penetration.
  const contacts = [];
  let penetration = 0;
  for (const p of incidentFace) {
    const sep = Vec2.dot(refFaceNormal, p) - refC;
    if (sep <= 0) { contacts.push(p); penetration += -sep; }
  }
  if (contacts.length === 0) return null;
  penetration /= contacts.length;

  return { a, b, normal, penetration, contacts };
}

// Dispatcher: returns a manifold (normal pointing a -> b) or null.
function collide(a, b) {
  const ta = a.shape.type, tb = b.shape.type;
  if (ta === 'circle' && tb === 'circle') return circleVsCircle(a, b);
  if (ta === 'circle' && tb === 'polygon') return circleVsPolygon(a, b);
  if (ta === 'polygon' && tb === 'circle') {
    const m = circleVsPolygon(b, a);     // normal from circle(b) to poly(a) = b -> a
    if (m) { m.normal = Vec2.neg(m.normal); m.a = a; m.b = b; } // flip back to a -> b
    return m;
  }
  if (ta === 'polygon' && tb === 'polygon') return polygonVsPolygon(a, b);
  return null;
}

module.exports = { collide, circleVsCircle, circleVsPolygon, polygonVsPolygon, getSupport };
