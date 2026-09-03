// broadphase.js — the cheap first pass that finds which body pairs are even
// worth testing exactly. Pairs with references/collision-detection.md.
//
// Narrow-phase collision (SAT, clipping) is expensive; running it on all
// N·(N-1)/2 pairs melts down past a few hundred bodies. The broad phase uses
// each body's axis-aligned bounding box to reject almost all pairs in near-O(N)
// time, handing the narrow phase only the handful that actually overlap.
//
// This is a uniform spatial hash grid: fast, allocation-light, and a good
// default when bodies are roughly the same size. If your world mixes tiny and
// huge bodies, or is mostly empty space, a quadtree or sweep-and-prune can beat
// it — see the reference for when to switch.

class SpatialHash {
  // cellSize should be around the average body diameter. Too small and big
  // bodies span many cells; too large and every body lands in one cell,
  // collapsing back to O(N²).
  constructor(cellSize = 64) {
    this.cellSize = cellSize;
    this.cells = new Map(); // "cx,cy" -> array of body indices
  }

  clear() { this.cells.clear(); }

  // Insert body index i with its precomputed world AABB.
  insert(i, aabb) {
    const cs = this.cellSize;
    const x0 = Math.floor(aabb.minX / cs), x1 = Math.floor(aabb.maxX / cs);
    const y0 = Math.floor(aabb.minY / cs), y1 = Math.floor(aabb.maxY / cs);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const key = cx + ',' + cy;
        let bucket = this.cells.get(key);
        if (!bucket) { bucket = []; this.cells.set(key, bucket); }
        bucket.push(i);
      }
    }
  }

  // Returns deduped candidate pairs [i, j] with i < j. A pair sharing several
  // cells would otherwise be emitted once per shared cell, so we filter through
  // a Set — with i < j the key is order-independent.
  queryPairs() {
    const pairs = [];
    const seen = new Set();
    for (const bucket of this.cells.values()) {
      const n = bucket.length;
      for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
          let i = bucket[a], j = bucket[b];
          if (i > j) { const t = i; i = j; j = t; }
          const key = i * 100000 + j; // fine for < 100k bodies
          if (seen.has(key)) continue;
          seen.add(key);
          pairs.push([i, j]);
        }
      }
    }
    return pairs;
  }
}

// Convenience: rebuild the grid from bodies carrying a `.aabb` and return the
// candidate pairs in one call.
function computePairs(bodies, cellSize = 64) {
  const grid = new SpatialHash(cellSize);
  for (let i = 0; i < bodies.length; i++) grid.insert(i, bodies[i].aabb);
  return grid.queryPairs();
}

module.exports = { SpatialHash, computePairs };
