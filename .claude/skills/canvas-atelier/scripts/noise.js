// noise.js — dependency-free value-noise generator for canvas texture work.
// Not "true" Perlin/Simplex (those need a larger permutation table), but a
// smooth, seedable value-noise that's more than good enough for breaking up
// flat gradients, jittering organic shapes consistently frame-to-frame, and
// driving gentle "alive" motion like a flickering flame or rippling water.
//
// Usage:
//   const noise = new ValueNoise(12345); // seed for reproducibility
//   const n = noise.get(x * 0.05, y * 0.05); // returns roughly [-1, 1]
//   const n2 = noise.get(x * 0.05, y * 0.05, time * 0.001); // 3D: animatable over time

class ValueNoise {
  constructor(seed = 1) {
    this._seed = seed;
    this._perm = this._buildPermutation(seed);
  }

  _buildPermutation(seed) {
    const p = Array.from({ length: 256 }, (_, i) => i);
    let s = seed;
    const rand = () => {
      // simple mulberry32 PRNG so the same seed always gives the same table
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = p.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    return [...p, ...p]; // duplicate to avoid overflow when indexing
  }

  _fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  _lerp(a, b, t) {
    return a + t * (b - a);
  }

  _grad(hash, x, y, z) {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  // Returns a value roughly in [-1, 1]. Pass a small step (0.01-0.1) between
  // sample points — larger steps = coarser/spikier noise, smaller = smoother.
  get(x, y = 0, z = 0) {
    const p = this._perm;
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = this._fade(x), v = this._fade(y), w = this._fade(z);
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
    const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    return this._lerp(
      this._lerp(
        this._lerp(this._grad(p[AA], x, y, z), this._grad(p[BA], x - 1, y, z), u),
        this._lerp(this._grad(p[AB], x, y - 1, z), this._grad(p[BB], x - 1, y - 1, z), u),
        v
      ),
      this._lerp(
        this._lerp(this._grad(p[AA + 1], x, y, z - 1), this._grad(p[BA + 1], x - 1, y, z - 1), u),
        this._lerp(this._grad(p[AB + 1], x, y - 1, z - 1), this._grad(p[BB + 1], x - 1, y - 1, z - 1), u),
        v
      ),
      w
    );
  }

  // Layered/fractal noise — richer texture by stacking octaves at decreasing amplitude.
  fbm(x, y, z = 0, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amplitude = 1, frequency = 1, sum = 0, maxAmp = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.get(x * frequency, y * frequency, z * frequency) * amplitude;
      maxAmp += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return sum / maxAmp;
  }
}

if (typeof module !== 'undefined') module.exports = ValueNoise;
