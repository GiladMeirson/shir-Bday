// verlet.js — minimal position-based physics for connected point systems
// (cloth, hair, rope, chains). Pairs with references/physics-motion.md.
//
// Usage:
//   const { points, constraints, idx } = VerletPhysics.buildCloth(10, 6, 20, 100, 50, 'left');
//   function frame(time) {
//     VerletPhysics.simulateStep(points, constraints, 0, 0.4, 0.99, 8,
//       (p, i) => VerletPhysics.windAcceleration(i, 10, noise, time));
//   }

class VerletPoint {
  constructor(x, y, pinned = false) {
    this.x = x; this.y = y;
    this.oldX = x; this.oldY = y;
    this.pinned = pinned;
  }
  update(gravityX = 0, gravityY = 0.4, damping = 0.99) {
    if (this.pinned) return;
    const vx = (this.x - this.oldX) * damping;
    const vy = (this.y - this.oldY) * damping;
    this.oldX = this.x; this.oldY = this.y;
    this.x += vx + gravityX;
    this.y += vy + gravityY;
  }
}

class DistanceConstraint {
  constructor(p1, p2, restLength = null) {
    this.p1 = p1; this.p2 = p2;
    this.restLength = restLength ?? Math.hypot(p2.x - p1.x, p2.y - p1.y);
  }
  solve() {
    const dx = this.p2.x - this.p1.x, dy = this.p2.y - this.p1.y;
    const dist = Math.hypot(dx, dy) || 0.0001;
    const diff = (this.restLength - dist) / dist;
    const offsetX = dx * diff * 0.5, offsetY = dy * diff * 0.5;
    if (!this.p1.pinned) { this.p1.x -= offsetX; this.p1.y -= offsetY; }
    if (!this.p2.pinned) { this.p2.x += offsetX; this.p2.y += offsetY; }
  }
}

const VerletPhysics = {
  VerletPoint,
  DistanceConstraint,

  simulateStep(points, constraints, gravityX = 0, gravityY = 0.4, damping = 0.99, iterations = 8, windFn = null) {
    points.forEach((p, i) => {
      let gx = gravityX, gy = gravityY;
      if (windFn) {
        const w = windFn(p, i);
        // Do NOT write this as `gx += w.x || 0`. NaN is falsy, so that idiom
        // silently converts a broken wind function into zero wind: the cloth
        // just hangs there, nothing throws, and the source looks correct.
        // A loud failure here is worth far more than a plausible-looking one.
        if (!Number.isFinite(w.x) || !Number.isFinite(w.y)) {
          throw new Error(
            `windFn returned a non-finite acceleration at point ${i}: ` +
            `{x: ${w.x}, y: ${w.y}}. Check the grid dimensions passed to windAcceleration().`
          );
        }
        gx += w.x;
        gy += w.y;
      }
      p.update(gx, gy, damping);
    });
    for (let i = 0; i < iterations; i++) {
      for (const c of constraints) c.solve();
    }
  },

  // pinEdge: 'left' pins the whole left column (e.g. a flag against a pole),
  // 'top' pins the whole top row (e.g. a hanging tapestry/curtain).
  //
  // The returned object carries cols/rows/pinEdge so windAcceleration() can
  // work out which axis runs away from the anchor. Pass the whole object
  // rather than a bare column count.
  buildCloth(cols, rows, spacing, originX, originY, pinEdge = 'left') {
    const points = [], constraints = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const pinned = pinEdge === 'left' ? x === 0 : y === 0;
        points.push(new VerletPoint(originX + x * spacing, originY + y * spacing, pinned));
      }
    }
    const idx = (x, y) => y * cols + x;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (x < cols - 1) constraints.push(new DistanceConstraint(points[idx(x, y)], points[idx(x + 1, y)]));
        if (y < rows - 1) constraints.push(new DistanceConstraint(points[idx(x, y)], points[idx(x, y + 1)]));
      }
    }
    return { points, constraints, idx, cols, rows, pinEdge };
  },

  // Single chain (rope/hair): first point pinned at the anchor. Shaped like a
  // one-column, top-pinned cloth so the same wind function drives both.
  buildChain(length, spacing, originX, originY, vertical = true) {
    const points = [], constraints = [];
    for (let i = 0; i < length; i++) {
      const x = vertical ? originX : originX + i * spacing;
      const y = vertical ? originY + i * spacing : originY;
      points.push(new VerletPoint(x, y, i === 0));
    }
    for (let i = 0; i < length - 1; i++) {
      constraints.push(new DistanceConstraint(points[i], points[i + 1]));
    }
    return { points, constraints, cols: 1, rows: length, pinEdge: 'top' };
  },

  // How far point `i` sits from the pinned edge, as 0 (at the anchor) to 1
  // (at the free edge). Which axis that runs along depends on which edge is
  // pinned — a flag on a pole ramps across columns, a hanging curtain ramps
  // down rows — so this needs the grid, not just a column count.
  //
  // Both denominators are guarded: a rope or hair strand is a 1-column grid,
  // and `col / (cols - 1)` divides by zero there, producing NaN that then
  // propagates silently through the whole simulation.
  anchorDistance(i, grid) {
    const g = typeof grid === 'number' ? { cols: grid, rows: Infinity, pinEdge: 'left' } : grid;
    const cols = g.cols || 1;
    const col = i % cols;
    const row = Math.floor(i / cols);
    if (g.pinEdge === 'top') {
      const rows = g.rows || 1;
      return rows > 1 ? row / (rows - 1) : 1;
    }
    return cols > 1 ? col / (cols - 1) : 1;
  },

  // Returns a wind ACCELERATION {x, y} for a given point index — pass this
  // into simulateStep's windFn. `grid` is the object buildCloth/buildChain
  // returned (it carries cols/rows/pinEdge):
  //
  //   const cloth = VerletPhysics.buildCloth(14, 8, 18, 60, 40, 'left');
  //   VerletPhysics.simulateStep(cloth.points, cloth.constraints, 0, 0.08, 0.985, 6,
  //     (p, i) => VerletPhysics.windAcceleration(i, cloth, noise, time));
  //
  // Do NOT apply wind as a direct p.x/p.y += offset. That was this
  // function's original (buggy) design: an unbounded random walk with
  // nothing pulling the point back toward rest (DistanceConstraints only
  // resist relative neighbor distance, not absolute drift). Given enough
  // running time it eventually tangles the mesh — columns overtaking each
  // other, a self-intersecting silhouette, a cloth/flag that looks like it
  // has "no back side" where it should be folding away from the viewer.
  // Feeding it in as an acceleration through the same Verlet update as
  // gravity keeps it a bounded oscillation instead.
  windAcceleration(i, grid, noise, time, strengthX = 0.35, strengthY = 0.3) {
    const f = VerletPhysics.anchorDistance(i, grid);
    // The travelling ripple has to run along the same axis as the falloff,
    // or the wave crosses the cloth sideways to the direction it's blowing.
    const g = typeof grid === 'number' ? { cols: grid, pinEdge: 'left' } : grid;
    const cols = g.cols || 1;
    const alongAxis = g.pinEdge === 'top' ? Math.floor(i / cols) : i % cols;
    return {
      x: noise.fbm(i * 0.15, 0, time * 0.0006) * strengthX * f,
      y: Math.sin(time * 0.0028 - alongAxis * 0.4) * strengthY * f
         + noise.get(i * 0.2, time * 0.001) * 0.15 * f,
    };
  },

  groundCollision(point, groundY, restitution = 0.4) {
    if (point.y > groundY) {
      const vy = (point.y - point.oldY) * restitution;
      point.y = groundY;
      point.oldY = point.y + vy;
    }
  },

  circleCollision(point, cx, cy, radius) {
    const dx = point.x - cx, dy = point.y - cy;
    const dist = Math.hypot(dx, dy) || 0.0001;
    if (dist < radius) {
      const push = (radius - dist) / dist;
      point.x += dx * push;
      point.y += dy * push;
    }
  },

  // Second-derivative curvature along a grid row — positive = ridge (catches
  // light), negative = valley (self-shadowed). Feed into fold shading.
  foldCurvature(points, idx, x, y, cols) {
    if (x === 0 || x === cols - 1) return 0;
    const left = points[idx(x - 1, y)], mid = points[idx(x, y)], right = points[idx(x + 1, y)];
    return (left.y + right.y - 2 * mid.y);
  },
};

if (typeof module !== 'undefined') module.exports = VerletPhysics;
