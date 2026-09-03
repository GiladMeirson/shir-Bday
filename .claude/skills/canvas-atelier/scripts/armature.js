// armature.js — place landmarks once, derive everything else from them, and
// assert the proportions before drawing a single pixel.
// Pairs with references/proportion-canon.md.
//
// The problem this solves is specific to drawing without eyes. A human
// illustrator types no coordinates at all; they put a mark down, look at it,
// and move it. Writing `ctx.bezierCurveTo(340, 210, ...)` is dead reckoning in
// an invisible coordinate system, and because every feature is guessed
// independently, the errors don't cancel — they accumulate into an eye at the
// wrong height, a wing that doesn't meet the shoulder, a limb attached three
// pixels off the body.
//
// A rig fixes that structurally rather than by being careful: a landmark that
// is DERIVED from other landmarks cannot drift away from them, because its
// position was never a number anyone chose.
//
//   const rig = Armature.rig(0, 0, W, H);
//   rig.at('skullTop', 0.42, 0.16);
//   rig.at('chin',     0.42, 0.48);
//   rig.mid('eyeLine', 'skullTop', 'chin');     // canon: eyes at the midline
//   rig.at('shoulderL', 0.28, 0.58);
//   rig.check('head height is 1 unit', rig.spanY('skullTop', 'chin'), H * 0.32, 2);
//   rig.verify();                                // throws a readable table
//   // ...then draw ONLY in terms of rig.p('eyeLine') etc.

class Rig {
  constructor(x, y, w, h) {
    this.box = { x, y, w, h };
    this.points = new Map();
    this.checks = [];
  }

  // Define a landmark as a fraction of the bounding box. Fractions, not
  // pixels, so the whole construction rescales with the canvas.
  at(name, fx, fy) {
    this.points.set(name, [this.box.x + this.box.w * fx, this.box.y + this.box.h * fy]);
    return this;
  }

  // Define a landmark from the ones already placed. This is the important
  // one — anything derived is anchored for good.
  derive(name, fn) {
    const p = fn(this);
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      throw new Error(`derive('${name}') must return a finite [x, y], got ${JSON.stringify(p)}`);
    }
    this.points.set(name, [p[0], p[1]]);
    return this;
  }

  mid(name, a, b, t = 0.5) {
    const pa = this.p(a), pb = this.p(b);
    this.points.set(name, [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t]);
    return this;
  }

  offset(name, from, dx, dy) {
    const p = this.p(from);
    this.points.set(name, [p[0] + dx, p[1] + dy]);
    return this;
  }

  // Mirror a landmark across a vertical axis, with a small deliberate
  // asymmetry so paired features aren't stamped copies (organic-curves.md).
  mirror(name, from, axisX, jitter = 0) {
    const p = this.p(from);
    this.points.set(name, [axisX + (axisX - p[0]) + jitter, p[1] + jitter * 0.5]);
    return this;
  }

  p(name) {
    const p = this.points.get(name);
    if (!p) throw new Error(`unknown landmark '${name}' (defined: ${[...this.points.keys()].join(', ') || 'none'})`);
    return p;
  }

  x(name) { return this.p(name)[0]; }
  y(name) { return this.p(name)[1]; }

  span(a, b) { const pa = this.p(a), pb = this.p(b); return Math.hypot(pb[0] - pa[0], pb[1] - pa[1]); }
  spanX(a, b) { return Math.abs(this.x(b) - this.x(a)); }
  spanY(a, b) { return Math.abs(this.y(b) - this.y(a)); }

  // |ab| / |bc| — proportion canons are almost always stated as ratios, so
  // check them as ratios rather than converting to pixels by hand.
  ratio(a, b, c, d = null) {
    const first = this.span(a, b);
    const second = d ? this.span(c, d) : this.span(b, c);
    return second === 0 ? Infinity : first / second;
  }

  // Record a proportion claim. Nothing throws yet — collecting them all means
  // one report listing every violation instead of failing on the first.
  check(label, got, want, tolerance = 1) {
    this.checks.push({ label, got, want, tolerance, ok: Math.abs(got - want) <= tolerance });
    return this;
  }

  // The block-in squint test, for something that can compute but not see.
  verify({ throwOnFail = true } = {}) {
    const failed = this.checks.filter((c) => !c.ok);
    if (failed.length && throwOnFail) {
      const rows = failed.map((c) =>
        `  ${c.label}: got ${c.got.toFixed(2)}, want ${c.want.toFixed(2)} (±${c.tolerance})`
      );
      throw new Error(`Proportion check failed — fix the block-in before drawing:\n${rows.join('\n')}`);
    }
    return { passed: this.checks.length - failed.length, failed };
  }

  // Draw the rig itself. Call this during block-in and actually look at it —
  // landmarks in the wrong place are obvious as dots and invisible as numbers.
  debugDraw(ctx, { color = '#e0245e', radius = 3, labels = true } = {}) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.font = '10px monospace';
    for (const [name, [x, y]] of this.points) {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      if (labels) ctx.fillText(name, x + radius + 2, y - radius - 2);
    }
    ctx.restore();
  }
}

const Armature = {
  Rig,
  rig(x, y, w, h) { return new Rig(x, y, w, h); },

  // Standalone version for checks that don't belong to a rig.
  assertProportions(checks) {
    const failed = checks.filter((c) => Math.abs(c.got - c.want) > (c.tol == null ? 1 : c.tol));
    if (failed.length) {
      const rows = failed.map((c) =>
        `  ${c.label}: got ${Number(c.got).toFixed(2)}, want ${Number(c.want).toFixed(2)} (±${c.tol == null ? 1 : c.tol})`
      );
      throw new Error(`Proportion check failed:\n${rows.join('\n')}`);
    }
    return true;
  },
};

if (typeof module !== 'undefined') module.exports = Armature;
