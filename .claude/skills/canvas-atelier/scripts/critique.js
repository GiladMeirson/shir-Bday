// critique.js — diagnostic renders for stage 8.
//
// Rendering the piece and looking at it is necessary but weak on its own,
// because the same brain that decided where the eye goes is the one checking
// whether the eye is in the right place — it sees the subject it intended,
// not the pixels that are there. Illustrators break that loop with a handful
// of cheap transforms, each of which makes one class of error unmissable.
// Every function here returns a new canvas; none touch the source.
//
//   const sheet = Critique.contactSheet(canvas);
//   document.body.appendChild(sheet);   // then LOOK at it

const Critique = {
  _make(w, h) {
    const c = typeof OffscreenCanvas !== 'undefined' && false
      ? new OffscreenCanvas(w, h)
      : document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  },

  // Flat fill of everything non-transparent. The strongest single readability
  // test there is: if the subject isn't recognisable in solid black, no amount
  // of shading will rescue it, and the fix belongs back in the block-in.
  //
  // Requires the subject on a TRANSPARENT layer. If the piece has a painted
  // background every pixel is opaque and this returns a filled rectangle —
  // pass the subject's own layer, or use thresholdMask() instead.
  silhouette(src, { color = '#000', background = '#fff' } = {}) {
    const out = this._make(src.width, src.height);
    const ctx = out.getContext('2d');
    ctx.drawImage(src, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, out.width, out.height);
    return out;
  },

  // Silhouette for pieces that are already flattened onto an opaque
  // background: split by luminance instead of by alpha.
  thresholdMask(src, cutoff = 0.5) {
    const out = this._make(src.width, src.height);
    const ctx = out.getContext('2d');
    ctx.drawImage(src, 0, 0);
    const img = ctx.getImageData(0, 0, out.width, out.height);
    const d = img.data;
    const limit = cutoff * 255;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      const v = lum < limit ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return out;
  },

  // Mirror horizontally. The oldest trick in the studio and still the most
  // effective: your brain stops pattern-matching the subject it expects, and
  // proportion, balance and tilt errors it had been compensating for become
  // impossible to ignore.
  flip(src) {
    const out = this._make(src.width, src.height);
    const ctx = out.getContext('2d');
    ctx.translate(out.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(src, 0, 0);
    return out;
  },

  // The squint test, literally. Collapses the piece to its value masses, which
  // is what tells you whether the composition reads before any detail does. If
  // the focal point isn't still obvious here, contrast is spread too evenly —
  // see composition.md on selective fidelity.
  blur(src, radius = 8) {
    const out = this._make(src.width, src.height);
    const ctx = out.getContext('2d');
    ctx.filter = `blur(${radius}px)`;
    ctx.drawImage(src, 0, 0);
    return out;
  },

  // Value structure without hue hiding it — "it looks flat" is almost always
  // a value problem, and hue is very good at concealing one.
  desaturate(src) {
    const out = this._make(src.width, src.height);
    const ctx = out.getContext('2d');
    ctx.filter = 'grayscale(1)';
    ctx.drawImage(src, 0, 0);
    return out;
  },

  // All four at once, labelled, as a single image to look at.
  contactSheet(src, { opaque = false, gap = 12, labelHeight = 18 } = {}) {
    const panels = [
      ['original', src],
      ['flipped', this.flip(src)],
      ['value', this.desaturate(src)],
      [opaque ? 'mask' : 'silhouette', opaque ? this.thresholdMask(src) : this.silhouette(src)],
    ];
    const w = src.width, h = src.height;
    const out = this._make(w * 2 + gap * 3, (h + labelHeight) * 2 + gap * 3);
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#f4f4f5';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.font = '12px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    panels.forEach(([label, canvas], i) => {
      const col = i % 2, row = (i / 2) | 0;
      const x = gap + col * (w + gap);
      const y = gap + row * (h + labelHeight + gap);
      ctx.fillStyle = '#52525b';
      ctx.fillText(label, x, y);
      ctx.drawImage(canvas, x, y + labelHeight);
    });
    return out;
  },
};

if (typeof module !== 'undefined') module.exports = Critique;
