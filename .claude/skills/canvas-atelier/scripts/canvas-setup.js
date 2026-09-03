// canvas-setup.js — call this once, before any drawing, so output stays crisp
// on HiDPI/retina displays instead of soft/blurry. A canvas sized only in CSS
// pixels renders at one device pixel per CSS pixel and gets upscaled by the
// browser — the single most common reason a piece looks soft no matter how
// careful the shading code is, and it's invisible in the source until you
// actually look at the rendered output.
//
// Usage:
//   const ctx = setupHiDPICanvas(canvas, 800, 600); // logical size
//   // draw using ctx exactly as if the canvas were 800x600 — the scaling is transparent
function setupHiDPICanvas(canvas, width, height) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return ctx;
}

if (typeof module !== 'undefined') module.exports = { setupHiDPICanvas };
