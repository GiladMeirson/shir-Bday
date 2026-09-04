/* plane.js — the little jet on the boarding passes.
 *
 * The route is a real SVG arc; every frame the jet is placed with getPointAtLength() and
 * rotated to the path's tangent, so it takes off nose-up, banks over the apex and flares
 * level for landing. The dotted trail is revealed behind it with a clip rect, a ground
 * shadow shrinks as it climbs, and faint contrail puffs are left in its wake.
 *
 *   PlaneRoute.markup()   → SVG string to drop into a .plane container
 *   PlaneRoute.start()    → animate every .route SVG currently in the document
 */
window.PlaneRoute = (() => {
  'use strict';
  const PATH = 'M6 34 Q60 -10 114 34';
  // Top-down airliner, nose at +x, drawn in a ~20×22 box centred on the origin.
  const JET = 'M10 0 C9.2 -1.7 7.6 -2 6 -2 L1.6 -2 L-2 -11 L-5.2 -11 L-4 -2.2 L-6.6 -2.2 L-8.6 -5.6 L-10.3 -5.6 ' +
              'L-9.4 -1 L-10 0 L-9.4 1 L-10.3 5.6 L-8.6 5.6 L-6.6 2.2 L-4 2.2 L-5.2 11 L-2 11 L1.6 2 L6 2 C7.6 2 9.2 1.7 10 0 Z';

  const PARK = 0.55, FLY = 4.2, PARK_END = 0.6, FADE = 0.35, STAGGER = 0.85;
  const CYCLE = PARK + FLY + PARK_END + FADE;
  const PUFF_LIFE = 0.9, PUFF_POOL = 14;
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let seq = 0;
  function markup() {
    const id = 'rt-clip-' + (++seq);
    return `<svg class="route" viewBox="0 0 120 44" aria-hidden="true">
      <defs><clipPath id="${id}"><rect class="rt-clip" x="0" y="0" width="0" height="44"/></clipPath></defs>
      <path class="rt-base" d="${PATH}"/>
      <path class="rt-trail" d="${PATH}" clip-path="url(#${id})"/>
      <circle class="rt-pin" cx="6" cy="34" r="2.3"/><circle class="rt-pin" cx="114" cy="34" r="2.3"/>
      <ellipse class="rt-shadow" cx="6" cy="37" rx="7" ry="1.5"/>
      <g class="rt-puffs"></g>
      <g class="rt-jet"><path class="rt-body" d="${JET}"/><ellipse class="rt-cockpit" cx="7.3" cy="0" rx="1.7" ry="0.85"/></g>
    </svg>`;
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  // Slow roll down the runway, cruise, gentle deceleration on approach.
  const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

  const routes = new Map();
  let raf = 0, t0 = 0;

  function setup(svg, index) {
    const path = svg.querySelector('.rt-base');
    const r = {
      svg, path, L: path.getTotalLength(), index,
      jet: svg.querySelector('.rt-jet'), trail: svg.querySelector('.rt-trail'), clip: svg.querySelector('.rt-clip'),
      shadow: svg.querySelector('.rt-shadow'), puffs: svg.querySelector('.rt-puffs'),
      pool: [], lastPuff: -1,
    };
    for (let i = 0; i < PUFF_POOL; i++) {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('r', '0'); c.style.opacity = '0';
      r.puffs.appendChild(c); r.pool.push({ el: c, born: -1, x: 0, y: 0 });
    }
    return r;
  }

  const pt = (r, u) => r.path.getPointAtLength(clamp(u, 0, 1) * r.L);

  function render(r, u, alpha, t) {
    const p = pt(r, u), pa = pt(r, u - 0.01), pb = pt(r, u + 0.01);
    const tan = Math.atan2(pb.y - pa.y, pb.x - pa.x) * 180 / Math.PI;
    // Level on the runway, pitch to the tangent once airborne, level again for touchdown…
    const airborne = ss(0, 0.12, u) * (1 - ss(0.84, 0.98, u));
    let ang = tan * airborne;
    // …with a small nose-up flare just before the wheels touch.
    ang -= 5 * ss(0.84, 0.94, u) * (1 - ss(0.96, 1, u));
    const alt = clamp((34 - p.y) / 22, 0, 1);
    const scale = 0.9 + 0.32 * Math.sin(Math.PI * u);              // closer to the viewer at the apex
    const bob = Math.sin(t * 9 + r.index) * 0.35 * ss(0.22, 0.4, u) * (1 - ss(0.6, 0.78, u));  // light chop mid-cruise
    r.jet.setAttribute('transform', `translate(${p.x.toFixed(2)} ${(p.y + bob).toFixed(2)}) rotate(${ang.toFixed(2)}) scale(${scale.toFixed(3)})`);
    r.jet.style.opacity = alpha.toFixed(3);
    // Trail: dots that have already been flown over (the arc is monotonic in x, so clip by x).
    r.clip.setAttribute('width', (u >= 1 ? 120 : Math.max(0, p.x - 3)).toFixed(2));
    r.trail.style.opacity = alpha.toFixed(3);
    // Ground shadow drifts under the jet and fades with altitude.
    r.shadow.setAttribute('cx', p.x.toFixed(2));
    r.shadow.setAttribute('rx', (7 * (1 - 0.45 * alt)).toFixed(2));
    r.shadow.style.opacity = (0.28 * (1 - 0.85 * alt) * alpha).toFixed(3);
    // Contrail.
    if (u > 0.08 && u < 0.93 && t - r.lastPuff > 0.11) {
      r.lastPuff = t;
      const rad = Math.atan2(pb.y - pa.y, pb.x - pa.x);
      let slot = r.pool[0];
      for (const q of r.pool) if (q.born < slot.born) slot = q;
      slot.born = t; slot.x = p.x - Math.cos(rad) * 8 * scale; slot.y = p.y - Math.sin(rad) * 8 * scale;
    }
    for (const q of r.pool) {
      const age = q.born < 0 ? Infinity : t - q.born;
      if (age > PUFF_LIFE) { if (q.el.style.opacity !== '0') q.el.style.opacity = '0'; continue; }
      const k = age / PUFF_LIFE;
      q.el.setAttribute('cx', q.x.toFixed(2)); q.el.setAttribute('cy', (q.y - age * 0.8).toFixed(2));
      q.el.setAttribute('r', (0.9 + 2.6 * k).toFixed(2));
      q.el.style.opacity = (0.3 * (1 - k) * alpha).toFixed(3);
    }
  }

  function frame(now) {
    const t = (now - t0) / 1000;
    for (const r of routes.values()) {
      if (!r.svg.isConnected) { routes.delete(r.svg); continue; }
      let lt = t - r.index * STAGGER;
      if (lt < 0) lt = 0; else lt %= CYCLE;
      let u, alpha = 1;
      if (lt < PARK) { u = 0; alpha = ss(0, 0.3, lt); }
      else if (lt < PARK + FLY) { u = ease((lt - PARK) / FLY); }
      else if (lt < PARK + FLY + PARK_END) { u = 1; }
      else { u = 1; alpha = 1 - ss(0, FADE, lt - PARK - FLY - PARK_END); }
      render(r, u, alpha, t);
    }
    raf = routes.size ? requestAnimationFrame(frame) : 0;
  }

  function start() {
    const svgs = document.querySelectorAll('svg.route');
    let i = 0;
    for (const svg of svgs) {
      if (!routes.has(svg)) {
        const r = setup(svg, i);
        if (reduced) { render(r, 0.5, 1, 0); r.clip.setAttribute('width', '120'); continue; }
        routes.set(svg, r);
      }
      i++;
    }
    if (routes.size && !raf) { t0 = performance.now(); raf = requestAnimationFrame(frame); }
  }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; routes.clear(); }

  return { markup, start, stop };
})();
