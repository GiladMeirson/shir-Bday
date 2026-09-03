/* claw.js — the claw machine: rigid-body simulation (physics-2d engine, bundled in
 * engine.js) + painterly canvas rendering (canvas-atelier helpers in atelier.js).
 *
 * Public API:
 *   const game = new ClawGame(canvas, { onEvent(type, data) {} });
 *   game.start();            // begin the loop
 *   game.setInput(-1|0|1);   // joystick left/right (hold)
 *   game.drop();             // the big red button
 *   game.setEnabled(bool);   // block input (during overlays)
 *
 * Events: 'ready' | 'drop' | 'grab' | 'empty' | 'slip' | 'nearmiss' | 'win' | 'tick'
 */
(function () {
  'use strict';

  const W = 420, H = 600;

  // ── One key light for the whole scene: upper-left, warm (marquee bulbs). ──
  const LIGHT = Shading.light(225, 42);
  const PAPER = { lightHue: 42, ambient: 0.20, warmth: 0.35 };
  const METAL = { lightHue: 42, ambient: 0.06, warmth: 0.15 };

  // ── Geometry (logical px). Everything else is derived from these. ──
  const G = {
    glass: { x: 26, y: 66, w: 368, h: 434 },   // inner glass window; floor = y+h = 500
    floorY: 500,
    chute: { x0: 26, x1: 110, lipW: 8, lipH: 26 },
    shaftBottom: 588,
    railY: 88,
    headRestY: 132,
    headMaxY: 442,
    carriageMin: 68, carriageMax: 366,
    homeX: 240,
    fingerLen: 48, fingerPivotDx: 14, fingerPivotDy: 10,
    palmDy: 30,
    thetaOpen: 0.86, thetaClosed: 0.10,
  };
  G.chuteX = (G.chute.x0 + G.chute.x1) / 2 - 2;

  // Little paper tags on the boxes: pure theatre — the gift order is fixed in app.js.
  const TAGS = [
    { t: 'שווה!', bad: false }, { t: 'שווה מאוד', bad: false }, { t: 'מתנה גרועה', bad: true },
    { t: 'לא כדאי', bad: true }, { t: '???', bad: false }, { t: 'יקר מאוד', bad: false },
    { t: 'אל תיקחי', bad: true }, { t: 'הכי טובה', bad: false }, { t: 'מזל?', bad: false },
  ];

  // Palette: 4 base hues (coral, teal, gold, lilac) and mixes of them.
  // Each present is [wrap hsl, ribbon hsl, pattern].
  const STYLES = [
    { wrap: [8, 78, 58],   ribbon: [45, 88, 62],  pattern: 'dots' },
    { wrap: [172, 52, 42], ribbon: [40, 60, 88],  pattern: 'stripes' },
    { wrap: [42, 84, 56],  ribbon: [8, 72, 56],   pattern: 'dots' },
    { wrap: [275, 42, 62], ribbon: [45, 88, 64],  pattern: 'stripes' },
    { wrap: [340, 66, 64], ribbon: [172, 45, 45], pattern: 'dots' },
    { wrap: [150, 42, 58], ribbon: [340, 65, 68], pattern: 'plain' },
    { wrap: [205, 58, 58], ribbon: [45, 88, 64],  pattern: 'stripes' },
    { wrap: [300, 32, 46], ribbon: [40, 60, 88],  pattern: 'dots' },
    { wrap: [25, 86, 58],  ribbon: [172, 45, 45], pattern: 'plain' },
  ];

  const CAT = { WALL: 1, PRESENT: 2, CLAW: 4 };

  // Pre-step hook so the claw is driven at the fixed simulation rate.
  class GameWorld extends P.World {
    step(dt) { if (this.preStep) this.preStep(dt); super.step(dt); }
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rnd = (a, b) => a + Math.random() * (b - a);

  class ClawGame {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.onEvent = opts.onEvent || (() => {});
      this.title = opts.title || 'GIFT GRABBER';
      this.roundTime = opts.roundTime ?? 30;

      this.dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = W * this.dpr; canvas.height = H * this.dpr;
      this.ctx = canvas.getContext('2d');
      this.ctx.scale(this.dpr, this.dpr);

      this.world = new GameWorld({
        gravity: { x: 0, y: 1500 }, fixedDt: 1 / 120, velocityIterations: 10,
        // A 3-high stack of light boxes keeps ~15 px/s of solver jitter; below this it is
        // invisible, so treat it as rest — otherwise the pile never sleeps and slowly creeps.
        restitutionThreshold: 60, cellSize: 60, sleepLinearTol: 14, sleepAngularTol: 0.12,
      });
      this.world.preStep = (dt) => this._preStep(dt);

      this.presents = [];
      this.enabled = false;
      this.input = 0;
      this.consecutiveFails = 0;

      // Claw state (all driven inside the fixed step).
      this.claw = {
        state: 'idle', x: G.homeX, y: G.headRestY, vx: 0, theta: G.thetaOpen,
        px: G.homeX, py: G.headRestY, ptheta: G.thetaOpen,   // previous step (for interpolation)
        thetaTarget: G.thetaOpen, timer: 0, hold: null, joint: null, grabQ: 0, releasedBySlip: false,
        fingersCollide: true, released: null, releaseTime: 0, clockLeft: this.roundTime,
      };

      this._buildStatics();
      this._spawnPresents();
      this._prewarm();
      this._buildLayers();

      this.tPrev = 0;
      this.running = false;
      this.doorGlow = 0;
      this.time = 0;
    }

    // ───────────────────────────── world setup ─────────────────────────────
    _buildStatics() {
      const w = this.world, g = G.glass;
      const mk = (cx, cy, bw, bh) => w.add(new P.RigidBody({
        shape: P.makeBox(bw, bh), position: { x: cx, y: cy }, isStatic: true,
        friction: 0.55, filterCategory: CAT.WALL,
      }));
      mk(g.x - 20, H / 2, 40, H * 2);                         // left wall
      mk(g.x + g.w + 20, H / 2, 40, H * 2);                   // right wall
      const fx0 = G.chute.x1 + G.chute.lipW, fx1 = g.x + g.w;
      mk((fx0 + fx1) / 2, G.floorY + 20, fx1 - fx0, 40);     // floor (to the right of the chute)
      // Chute wall + lip: from lip top (above floor) down the shaft.
      const lipTop = G.floorY - G.chute.lipH;
      mk(G.chute.x1 + G.chute.lipW / 2, (lipTop + G.shaftBottom + 40) / 2, G.chute.lipW, G.shaftBottom + 40 - lipTop);

      // Claw finger bodies (static, driven kinematically each step).
      this.fingers = [-1, 1].map(() => w.add(new P.RigidBody({
        shape: P.makeBox(6, 44), position: { x: -500, y: -500 }, isStatic: true,
        friction: 0.35, filterCategory: CAT.CLAW, filterMask: CAT.PRESENT,
      })));
      // Palm body: the joint anchor while holding. Collides with nothing.
      this.palm = w.add(new P.RigidBody({
        shape: P.makeCircle(3), position: { x: -500, y: -500 }, isStatic: true,
        filterCategory: 0, filterMask: 0,
      }));
      this._setFingerFilter();
    }

    _spawnPresents() {
      const order = STYLES.map((_, i) => i).sort(() => Math.random() - 0.5);
      const tags = TAGS.slice().sort(() => Math.random() - 0.5);
      const cols = [178, 256, 334];
      let k = 0;
      for (let row = 0; row < 3; row++) {
        for (let c = 0; c < 3; c++) {
          const size = rnd(40, 54);
          const body = this.world.add(new P.RigidBody({
            shape: P.makeBox(size, size),
            position: { x: cols[c] + rnd(-16, 16), y: 420 - row * 70 + rnd(-8, 8) },
            // Low density on purpose: with density 1 a 50px box weighs ~2500 units and the
            // joint solver's 2×2 effective-mass determinant (~invMass²) drops below its
            // 1e-6 singularity guard, so the grip would silently apply no impulse.
            angle: rnd(-0.35, 0.35), density: 0.002, restitution: 0.12, friction: 0.62,
            filterCategory: CAT.PRESENT,
          }));
          this.presents.push({ body, size, style: STYLES[order[k % STYLES.length]], tag: tags[k % tags.length], seed: Math.random() * 1000 }); k++;
        }
      }
    }

    _prewarm() {
      // Let the pile settle before the first frame so it opens on a resting scene.
      const saved = this.world.preStep; this.world.preStep = null;
      for (let i = 0; i < 360; i++) this.world.step(this.world.fixedDt);
      this.world.preStep = saved;
    }

    // ───────────────────────────── claw logic ─────────────────────────────
    setInput(dir) { this.input = dir; }
    setEnabled(v) { this.enabled = v; if (v) this.claw.clockLeft = this.roundTime; }

    drop() {
      const c = this.claw;
      if (!this.enabled || c.state !== 'idle') return false;
      c.state = 'descend'; c.timer = 0;
      this.onEvent('drop');
      return true;
    }

    _wakeNear(x0, x1, y0, y1) {
      for (const p of this.presents) {
        const a = p.body.aabb; if (!a) continue;
        if (a.maxX > x0 && a.minX < x1 && a.maxY > y0 && a.minY < y1) p.body.wake();
      }
    }

    _grabCandidate() {
      const c = this.claw, palmY = c.y + G.palmDy;
      let best = null, bestD = Infinity;
      for (const p of this.presents) {
        if (p.captured) continue;
        const a = p.body.aabb || P.computeAABB(p.body);
        const overlapsX = a.maxX > c.x - 26 && a.minX < c.x + 26;
        const topNear = a.minY > palmY - 19 && a.minY < palmY + 21;
        if (!overlapsX || !topNear) continue;
        const d = Math.abs(p.body.position.x - c.x);
        if (d < bestD) { bestD = d; best = p; }
      }
      return best;
    }

    _preStep(dt) {
      const c = this.claw;
      c.px = c.x; c.py = c.y; c.ptheta = c.theta;
      this.time += dt;

      // Finger spread eases toward its target (a motor, not a snap).
      const dTheta = c.thetaTarget - c.theta;
      const rate = 3.2 * dt;
      c.theta += Math.abs(dTheta) < rate ? dTheta : Math.sign(dTheta) * rate;

      switch (c.state) {
        case 'idle': {
          const target = this.enabled ? this.input * 150 : 0;
          c.vx = lerp(c.vx, target, 1 - Math.exp(-dt * 9));   // motor inertia
          c.x = clamp(c.x + c.vx * dt, G.carriageMin, G.carriageMax);
          if (this.enabled) {
            c.clockLeft -= dt;
            if (c.clockLeft <= 0) { c.clockLeft = 0; this.drop(); }
          }
          break;
        }
        case 'descend': {
          c.vx = 0;
          c.y += 150 * dt;
          const palmY = c.y + G.palmDy;
          this._wakeNear(c.x - 50, c.x + 50, c.y, c.y + 80);
          let stop = c.y >= G.headMaxY;
          if (!stop) {
            for (const p of this.presents) {
              if (p.captured) continue;
              const a = p.body.aabb; if (!a) continue;
              if (a.maxX > c.x - 24 && a.minX < c.x + 24 && a.minY <= palmY && a.maxY > palmY) { stop = true; break; }
            }
          }
          if (stop) {
            c.y = Math.min(c.y, G.headMaxY);
            c.state = 'close'; c.timer = 0;
            const cand = this._grabCandidate();
            c.candidate = cand;
            if (cand) {
              // Close only until the fingertips meet the box, not through it.
              const halfGap = cand.size / 2 + 3;
              const s = clamp((halfGap - G.fingerPivotDx) / G.fingerLen, 0.05, 0.9);
              c.thetaTarget = Math.max(G.thetaClosed, Math.asin(s));
            } else {
              c.thetaTarget = G.thetaClosed;
            }
            c.fingersCollide = false;   // don't crush neighbours between two infinite masses
            this._setFingerFilter();
            this.onEvent('close', { hit: !!cand });
          }
          break;
        }
        case 'close': {
          c.timer += dt;
          if (Math.abs(c.theta - c.thetaTarget) < 0.01 || c.timer > 0.9) {
            const cand = c.candidate;
            if (cand && !cand.captured) {
              const dx = cand.body.position.x - c.x;
              const tilt = Math.abs(Math.sin(2 * cand.body.angle));
              c.grabQ = clamp(0.2 + 0.8 * (1 - Math.abs(dx) / 36), 0.2, 1) * (1 - 0.28 * tilt);
              this._attach(cand);
              this.onEvent('grab', { q: c.grabQ });
            } else {
              this.onEvent('empty');
            }
            c.state = 'lift'; c.timer = 0; c.liftFrom = c.y;
            this.onEvent('lift');
          }
          break;
        }
        case 'lift': {
          c.y -= 130 * dt;
          if (!c.fingersCollide && c.liftFrom - c.y > 34) { c.fingersCollide = true; this._setFingerFilter(); }
          this._slipCheck(dt);
          if (c.y <= G.headRestY) { c.y = G.headRestY; c.state = 'traverse'; c.timer = 0; this.onEvent('traverse', { holding: !!c.hold }); }
          break;
        }
        case 'traverse': {
          const dist = c.x - G.chuteX;
          const target = -Math.min(150, 40 + dist * 1.4);
          c.vx = lerp(c.vx, target, 1 - Math.exp(-dt * 6));
          c.x += c.vx * dt;
          this._slipCheck(dt);
          if (c.x <= G.chuteX + 1) {
            c.x = G.chuteX; c.vx = 0;
            c.state = 'release'; c.timer = 0;
            c.thetaTarget = G.thetaOpen;
            const hadHold = !!c.hold;
            if (c.hold) this._detach(true);
            this.onEvent('release', { holding: hadHold });
          }
          break;
        }
        case 'release': {
          c.timer += dt;
          if (c.timer > 0.9) { c.state = 'return'; c.timer = 0; this.onEvent('return'); }
          break;
        }
        case 'return': {
          const dist = G.homeX - c.x;
          const target = Math.min(170, 40 + Math.abs(dist) * 1.6) * Math.sign(dist);
          c.vx = lerp(c.vx, target, 1 - Math.exp(-dt * 6));
          c.x += c.vx * dt;
          if (Math.abs(dist) < 3) {
            c.x = G.homeX; c.vx = 0; c.state = 'idle'; c.clockLeft = this.roundTime;
            this.onEvent('home');
            if (!c.released) this.onEvent('ready');
          }
          break;
        }
      }

      // Drive the kinematic bodies to the claw pose.
      this._placeFingers(dt);
      // A gripped box swings like a pendulum; the rubber finger pads damp that a little.
      if (c.hold) c.hold.body.angularVelocity *= Math.exp(-1.8 * dt);

      // Track a released present until it either falls in the chute or lands elsewhere.
      if (c.released) {
        const r = c.released, b = r.body;
        c.releaseTime += dt;
        // A sudden loss of downward speed = it hit something. Report it so the app can thud.
        const vy = b.velocity.y, pvy = c.releasedVy ?? vy;
        if (pvy > 220 && vy < pvy * 0.45) this.onEvent('thud', { speed: pvy, x: b.position.x, y: b.position.y });
        c.releasedVy = vy;
        if (b.position.y > G.shaftBottom - 12) {
          r.captured = true;
          this.world.remove(b);
          this.presents.splice(this.presents.indexOf(r), 1);
          c.released = null;
          this.doorGlow = 1;
          this.consecutiveFails = 0;
          this.onEvent('win', { style: r.style, size: r.size });
        } else if (b.position.y > G.floorY + 6 && b.position.x < G.chute.x1) {
          // Already inside the shaft: it can't come back out, so just wait for the bottom.
        } else if (c.releaseTime > 1.2 && (b.sleeping || c.releaseTime > 4.5)) {
          c.released = null;
          if (!c.releasedBySlip) { this.consecutiveFails++; this.onEvent('nearmiss'); }
          if (c.state === 'idle') this.onEvent('ready');
        }
      }
    }

    _slipCheck(dt) {
      const c = this.claw;
      if (!c.hold) return;
      const pity = this.consecutiveFails >= 4 ? 0.2 : this.consecutiveFails >= 2 ? 0.5 : 1;
      const swing = 1 + Math.min(2, Math.abs(c.hold.body.angularVelocity) * 0.25);
      // Per-second slip hazard. A centred grab (q≈0.9) survives the ~4 s trip ~85% of the
      // time; an edge grab (q≈0.3) lets go most of the time — a fair claw, not a cruel one.
      const rate = (0.03 + Math.pow(1 - c.grabQ, 2) * 0.85) * swing * pity;
      if (Math.random() < rate * dt) {
        this._detach(false);
        this.consecutiveFails++;
        this.onEvent('slip');
      }
    }

    _attach(p) {
      const c = this.claw;
      const palmPt = { x: c.x, y: c.y + G.palmDy };
      this.palm.position = { x: palmPt.x, y: palmPt.y };
      // Local anchor on the present = palm point expressed in the box frame.
      const local = P.Vec2.rotate(P.Vec2.sub(palmPt, p.body.position), -p.body.angle);
      c.joint = new P.RevoluteJoint(this.palm, p.body, { x: 0, y: 0 }, local, { beta: 0.35 });
      this.world.addJoint(c.joint);
      p.body.filterGroup = -2;
      p.body.wake();
      c.hold = p;
    }

    _detach(atChute) {
      const c = this.claw;
      if (c.joint) { this.world.removeJoint(c.joint); c.joint = null; }
      if (c.hold) {
        c.hold.body.filterGroup = 0;
        c.hold.body.wake();
        // Track the box either way: a present that slips from the claw but tumbles into
        // the chute still counts as a catch.
        c.released = c.hold; c.releaseTime = 0; c.releasedBySlip = !atChute;
        c.releasedVy = c.hold.body.velocity.y;
        c.hold = null;
      }
    }

    _setFingerFilter() {
      for (const f of this.fingers) f.filterMask = this.claw.fingersCollide ? CAT.PRESENT : 0;
      for (const f of this.fingers) f.filterGroup = -2;
    }

    _fingerPose(side, x, y, theta) {
      const a = side * theta;                         // outward spread from vertical
      const pivot = { x: x + side * G.fingerPivotDx, y: y + G.fingerPivotDy };
      const dir = { x: Math.sin(a), y: Math.cos(a) };
      const out = { x: side * Math.cos(a), y: -side * Math.sin(a) };
      return { a, pivot, dir, out };
    }

    _placeFingers(dt) {
      const c = this.claw;
      this.fingers.forEach((f, i) => {
        const side = i === 0 ? -1 : 1;
        const { a, pivot, dir } = this._fingerPose(side, c.x, c.y, c.theta);
        const nx = pivot.x + dir.x * 22, ny = pivot.y + dir.y * 22;
        f.velocity.x = (nx - f.position.x) / dt; f.velocity.y = (ny - f.position.y) / dt;
        if (Math.hypot(f.velocity.x, f.velocity.y) > 2000) { f.velocity.x = 0; f.velocity.y = 0; }
        f.position.x = nx; f.position.y = ny; f.angle = -a;
      });
      this.palm.position.x = c.x; this.palm.position.y = c.y + G.palmDy;
    }

    // ───────────────────────────── loop ─────────────────────────────
    start() {
      if (this.running) return;
      this.running = true;
      const tick = (t) => {
        if (!this.running) return;
        const dt = this.tPrev ? Math.min(0.05, (t - this.tPrev) / 1000) : 1 / 60;
        this.tPrev = t;
        const alpha = this.world.update(dt);
        this.render(alpha);
        this.onEvent('tick', { clock: this.claw.clockLeft, state: this.claw.state, vx: this.claw.vx, theta: this.claw.theta, thetaTarget: this.claw.thetaTarget });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
    stop() { this.running = false; this.tPrev = 0; }

    // ───────────────────────────── static layers ─────────────────────────────
    _layer(draw) {
      const cv = document.createElement('canvas');
      cv.width = W * this.dpr; cv.height = H * this.dpr;
      const ctx = cv.getContext('2d'); ctx.scale(this.dpr, this.dpr);
      draw(ctx); return cv;
    }

    _buildLayers() {
      this.noiseTile = this._makeNoiseTile();
      this.bg = this._layer((ctx) => this._drawCabinet(ctx));
      this.glass = this._layer((ctx) => this._drawGlass(ctx));
    }

    // Re-render the static layers (call after web fonts finish loading).
    refreshLayers() { this._buildLayers(); }

    _makeNoiseTile() {
      const n = new ValueNoise(7), s = 96;
      const cv = document.createElement('canvas'); cv.width = s; cv.height = s;
      const ctx = cv.getContext('2d');
      const img = ctx.createImageData(s, s);
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
        const v = 0.5 + 0.5 * n.fbm(x / 9, y / 9, 0, 3);
        const g = 200 + v * 55 + (Math.random() - 0.5) * 26;
        const i = (y * s + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = g; img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      return this.ctx.createPattern(cv, 'repeat');
    }

    _roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
    }

    _drawCabinet(ctx) {
      const g = G.glass;
      // Outer body: deep cherry red, lit from upper-left.
      const body = ctx.createLinearGradient(0, 0, W, H);
      body.addColorStop(0, Shading.shade([352, 70, 44], 1.0, PAPER));
      body.addColorStop(0.5, Shading.shade([352, 70, 40], 0.7, PAPER));
      body.addColorStop(1, Shading.shade([352, 70, 36], 0.35, PAPER));
      this._roundRect(ctx, 6, 6, W - 12, H - 12, 22); ctx.fillStyle = body; ctx.fill();
      // Bevel on the frame.
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,220,200,0.35)';
      this._roundRect(ctx, 8.5, 8.5, W - 17, H - 17, 20); ctx.stroke();
      ctx.strokeStyle = 'rgba(40,0,10,0.5)';
      this._roundRect(ctx, 11.5, 11.5, W - 23, H - 23, 18); ctx.stroke();

      // Marquee panel.
      this._roundRect(ctx, 18, 14, W - 36, 46, 10);
      const mq = ctx.createLinearGradient(0, 14, 0, 60);
      mq.addColorStop(0, '#1b1230'); mq.addColorStop(1, '#0d0a1a');
      ctx.fillStyle = mq; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.stroke();

      // Interior: back wall with a warm glow at the top-left, vignette at edges.
      ctx.save();
      ctx.beginPath(); ctx.rect(g.x, g.y, g.w, g.h); ctx.clip();
      const wall = ctx.createLinearGradient(0, g.y, 0, g.y + g.h);
      wall.addColorStop(0, '#3b1e46'); wall.addColorStop(0.6, '#2a1535'); wall.addColorStop(1, '#1a0e22');
      ctx.fillStyle = wall; ctx.fillRect(g.x, g.y, g.w, g.h);
      const glow = ctx.createRadialGradient(g.x + 60, g.y + 30, 10, g.x + 60, g.y + 30, 300);
      glow.addColorStop(0, 'rgba(255,190,120,0.28)'); glow.addColorStop(1, 'rgba(255,190,120,0)');
      ctx.fillStyle = glow; ctx.fillRect(g.x, g.y, g.w, g.h);
      // Faint back-wall stripes (wallpaper), very low contrast.
      ctx.globalAlpha = 0.07; ctx.fillStyle = '#ffd7f0';
      for (let x = g.x + 12; x < g.x + g.w; x += 28) ctx.fillRect(x, g.y, 6, g.h);
      ctx.globalAlpha = 1;
      // Back "shelf line" so the floor has depth: a lighter band right above the floor.
      const floorLit = ctx.createLinearGradient(0, G.floorY - 60, 0, G.floorY);
      floorLit.addColorStop(0, 'rgba(255,200,170,0)'); floorLit.addColorStop(1, 'rgba(255,200,170,0.22)');
      ctx.fillStyle = floorLit; ctx.fillRect(g.x, G.floorY - 60, g.w, 60);
      // Vignette.
      const vig = ctx.createRadialGradient(g.x + g.w / 2, g.y + g.h / 2, g.w * 0.35, g.x + g.w / 2, g.y + g.h / 2, g.w * 0.85);
      vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = vig; ctx.fillRect(g.x, g.y, g.w, g.h);
      ctx.restore();

      // Floor slab (visible thickness under the glass line) — the base cabinet top.
      const fx0 = G.chute.x1 + G.chute.lipW;
      const slab = ctx.createLinearGradient(0, G.floorY, 0, G.floorY + 14);
      slab.addColorStop(0, '#5a3d3a'); slab.addColorStop(1, '#2d1c1c');
      ctx.fillStyle = slab; ctx.fillRect(fx0, G.floorY, g.x + g.w - fx0, 14);
      // Floor top edge highlight.
      ctx.fillStyle = 'rgba(255,225,200,0.55)'; ctx.fillRect(fx0, G.floorY - 1, g.x + g.w - fx0, 1.5);
      // Floor surface (inside the glass): felt-like dark teal, lit.
      const felt = ctx.createLinearGradient(0, G.floorY - 12, 0, G.floorY);
      felt.addColorStop(0, Shading.shade([172, 30, 22], 0.9, PAPER)); felt.addColorStop(1, Shading.shade([172, 30, 18], 0.5, PAPER));
      ctx.fillStyle = felt; ctx.fillRect(fx0, G.floorY - 12, g.x + g.w - fx0, 12);

      // Chute shaft: dark, receding.
      const shaft = ctx.createLinearGradient(0, G.floorY - 12, 0, G.shaftBottom);
      shaft.addColorStop(0, '#120a16'); shaft.addColorStop(1, '#050308');
      ctx.fillStyle = shaft; ctx.fillRect(G.chute.x0, G.floorY - 12, G.chute.x1 - G.chute.x0, G.shaftBottom - G.floorY + 12);
      // Shaft inner edge shading (depth).
      const shx = ctx.createLinearGradient(G.chute.x0, 0, G.chute.x1, 0);
      shx.addColorStop(0, 'rgba(0,0,0,0.55)'); shx.addColorStop(0.3, 'rgba(0,0,0,0)'); shx.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = shx; ctx.fillRect(G.chute.x0, G.floorY - 12, G.chute.x1 - G.chute.x0, G.shaftBottom - G.floorY + 12);

      // Base cabinet under the floor (right of the shaft): darker red with a panel.
      const base = ctx.createLinearGradient(0, G.floorY + 14, 0, H);
      base.addColorStop(0, Shading.shade([352, 65, 34], 0.55, PAPER)); base.addColorStop(1, Shading.shade([352, 65, 28], 0.3, PAPER));
      ctx.fillStyle = base; ctx.fillRect(fx0, G.floorY + 14, g.x + g.w - fx0, H - 12 - (G.floorY + 14));
      // Control panel plate.
      this._roundRect(ctx, fx0 + 14, G.floorY + 26, g.x + g.w - fx0 - 28, 50, 8);
      const plate = ctx.createLinearGradient(0, G.floorY + 26, 0, G.floorY + 76);
      plate.addColorStop(0, '#2a1b2f'); plate.addColorStop(1, '#150d19');
      ctx.fillStyle = plate; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.stroke();
      // Coin slot.
      this._roundRect(ctx, g.x + g.w - 60, G.floorY + 40, 26, 22, 4);
      ctx.fillStyle = '#c9b48a'; ctx.fill();
      ctx.fillStyle = '#1a1010'; ctx.fillRect(g.x + g.w - 50, G.floorY + 44, 6, 14);
      ctx.font = '600 9px Rubik, sans-serif'; ctx.fillStyle = 'rgba(255,230,210,0.7)'; ctx.textAlign = 'center';
      ctx.fillText('FREE PLAY', g.x + g.w - 47, G.floorY + 71);

      // Prize door (below the shaft): dark opening with a metal frame + handle.
      this._roundRect(ctx, G.chute.x0 + 2, G.shaftBottom - 60, G.chute.x1 - G.chute.x0 - 4, 56, 6);
      ctx.fillStyle = '#0a0609'; ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = Shading.cylinderGradient(ctx, G.chute.x0, G.shaftBottom - 60, G.chute.x1, G.shaftBottom - 60, 3, [40, 12, 70], LIGHT, METAL);
      ctx.stroke();
      ctx.font = '700 9px Rubik, sans-serif'; ctx.fillStyle = 'rgba(255,220,180,0.55)'; ctx.textAlign = 'center';
      ctx.fillText('PRIZE ↓', (G.chute.x0 + G.chute.x1) / 2, G.shaftBottom - 66);

      // Rail (the claw's track) along the top of the glass.
      ctx.fillStyle = Shading.cylinderGradient(ctx, g.x, G.railY - 4, g.x + g.w, G.railY - 4, 4, [40, 8, 55], LIGHT, METAL);
      this._roundRect(ctx, g.x + 6, G.railY - 8, g.w - 12, 8, 3); ctx.fill();

      // Marquee title with neon glow (fonts may still be loading; redrawn in _drawMarqueeText).
      this._drawMarqueeText(ctx);
    }

    _drawMarqueeText(ctx) {
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '900 22px "Secular One", Rubik, sans-serif';
      ctx.shadowColor = 'rgba(255,84,170,0.95)'; ctx.shadowBlur = 16;
      ctx.fillStyle = '#ffd9ee'; ctx.fillText(this.title, W / 2, 38);
      ctx.shadowBlur = 4; ctx.fillStyle = '#fff6fb'; ctx.fillText(this.title, W / 2, 38);
      ctx.restore();
    }

    _drawGlass(ctx) {
      const g = G.glass;
      ctx.save();
      ctx.beginPath(); ctx.rect(g.x, g.y, g.w, g.h); ctx.clip();
      // Two soft diagonal reflections.
      ctx.globalCompositeOperation = 'screen';
      const r1 = ctx.createLinearGradient(g.x, g.y, g.x + 220, g.y + 300);
      r1.addColorStop(0, 'rgba(255,255,255,0)'); r1.addColorStop(0.42, 'rgba(255,255,255,0.10)');
      r1.addColorStop(0.5, 'rgba(255,255,255,0.14)'); r1.addColorStop(0.58, 'rgba(255,255,255,0.04)'); r1.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = r1; ctx.fillRect(g.x, g.y, g.w, g.h);
      const r2 = ctx.createLinearGradient(g.x + 200, g.y, g.x + 368, g.y + 260);
      r2.addColorStop(0, 'rgba(255,255,255,0)'); r2.addColorStop(0.5, 'rgba(255,255,255,0.05)'); r2.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = r2; ctx.fillRect(g.x, g.y, g.w, g.h);
      ctx.globalCompositeOperation = 'source-over';
      // Edge highlights (glass thickness).
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(g.x + 1, g.y + g.h); ctx.lineTo(g.x + 1, g.y + 1); ctx.lineTo(g.x + g.w, g.y + 1); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath(); ctx.moveTo(g.x + g.w - 1, g.y); ctx.lineTo(g.x + g.w - 1, g.y + g.h); ctx.stroke();
      ctx.restore();
    }

    // ───────────────────────────── dynamic rendering ─────────────────────────────
    render(alpha) {
      const ctx = this.ctx, c = this.claw, g = G.glass;
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(this.bg, 0, 0, W, H);

      // Clip to glass + shaft so falling presents stay "inside" the machine.
      ctx.save();
      ctx.beginPath();
      ctx.rect(g.x, g.y, g.w, g.h);
      ctx.rect(G.chute.x0, G.floorY, G.chute.x1 - G.chute.x0, G.shaftBottom - G.floorY - 4);
      ctx.clip();

      // Interpolated claw pose.
      const cx = lerp(c.px, c.x, alpha), cy = lerp(c.py, c.y, alpha), th = lerp(c.ptheta, c.theta, alpha);

      // Presents (back to front by y so lower ones overlap upper — simple depth).
      const list = this.presents.slice().sort((a, b) => a.body.position.y - b.body.position.y);
      for (const p of list) {
        const b = p.body;
        const x = lerp(b.prevPosition ? b.prevPosition.x : b.position.x, b.position.x, alpha);
        const y = lerp(b.prevPosition ? b.prevPosition.y : b.position.y, b.position.y, alpha);
        const ang = lerp(b.prevAngle ?? b.angle, b.angle, alpha);
        this._drawPresent(ctx, p, x, y, ang);
      }

      // Chute lip (metal), drawn in front of the presents.
      const lipTop = G.floorY - G.chute.lipH;
      ctx.fillStyle = Shading.cylinderGradient(ctx, G.chute.x1, lipTop, G.chute.x1, G.floorY, G.chute.lipW / 2 + 1, [40, 10, 62], LIGHT, METAL);
      this._roundRect(ctx, G.chute.x1 - 1, lipTop, G.chute.lipW + 2, G.chute.lipH + 6, 3); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(G.chute.x1, lipTop + 1, 2, G.chute.lipH - 2);

      this._drawClaw(ctx, cx, cy, th);
      ctx.restore();

      ctx.drawImage(this.glass, 0, 0, W, H);
      this._drawMarqueeLights(ctx);
      this._drawClock(ctx);
      this._drawDoorGlow(ctx);
    }

    _drawPresent(ctx, p, x, y, angle) {
      const s = p.size, h = s / 2, st = p.style;
      ctx.save();
      ctx.translate(x, y); ctx.rotate(angle);
      // Light direction expressed in the box's local frame.
      const ca = Math.cos(-angle), sa = Math.sin(-angle);
      const lx = LIGHT.x * ca - LIGHT.y * sa, ly = LIGHT.x * sa + LIGHT.y * ca;
      const pl = Math.hypot(lx, ly) || 1, ux = lx / pl, uy = ly / pl;

      // Cast shadow (world-space offset away from the light; shadow offsets ignore the transform).
      ctx.shadowColor = 'rgba(25,8,25,0.5)'; ctx.shadowBlur = 12 * this.dpr;
      ctx.shadowOffsetX = 5 * this.dpr; ctx.shadowOffsetY = 7 * this.dpr;
      this._roundRect(ctx, -h, -h, s, s, 3);
      const face = ctx.createLinearGradient(ux * h, uy * h, -ux * h, -uy * h);
      face.addColorStop(0, Shading.shade(st.wrap, 1.0, PAPER));
      face.addColorStop(0.45, Shading.shade(st.wrap, 0.78, PAPER));
      face.addColorStop(1, Shading.shade(st.wrap, 0.38, PAPER));
      ctx.fillStyle = face; ctx.fill();
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;

      ctx.save();
      this._roundRect(ctx, -h, -h, s, s, 3); ctx.clip();
      // Wrapping pattern.
      if (st.pattern === 'dots') {
        ctx.fillStyle = Shading.shade(st.wrap, 1, { ...PAPER, alpha: 0.35 });
        const step = s / 5;
        for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
          ctx.beginPath(); ctx.arc(i * step + step / 2, j * step + step / 2, s / 26, 0, Math.PI * 2); ctx.fill();
        }
      } else if (st.pattern === 'stripes') {
        ctx.fillStyle = Shading.shade(st.wrap, 1, { ...PAPER, alpha: 0.22 });
        ctx.save(); ctx.rotate(Math.PI / 4);
        for (let i = -6; i <= 6; i++) ctx.fillRect(i * (s / 5) - s / 20, -s, s / 10, s * 2);
        ctx.restore();
      }
      // Paper grain.
      ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.28;
      ctx.fillStyle = this.noiseTile; ctx.fillRect(-h, -h, s, s);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;

      // Ribbons: satin bands, brighter at the centre line.
      const rw = s * 0.17;
      const band = (vertical) => {
        const gr = vertical ? ctx.createLinearGradient(-rw / 2, 0, rw / 2, 0) : ctx.createLinearGradient(0, -rw / 2, 0, rw / 2);
        gr.addColorStop(0, Shading.shade(st.ribbon, 0.55, PAPER));
        gr.addColorStop(0.35, Shading.shade(st.ribbon, 1.0, PAPER));
        gr.addColorStop(0.6, Shading.shade(st.ribbon, 0.9, PAPER));
        gr.addColorStop(1, Shading.shade(st.ribbon, 0.5, PAPER));
        ctx.fillStyle = gr;
        if (vertical) ctx.fillRect(-rw / 2, -h, rw, s); else ctx.fillRect(-h, -rw / 2, s, rw);
      };
      band(true); band(false);
      // Ribbon shading follows the box light: darken the ribbon on the shadow side.
      const rsh = ctx.createLinearGradient(ux * h, uy * h, -ux * h, -uy * h);
      rsh.addColorStop(0, 'rgba(0,0,0,0)'); rsh.addColorStop(1, 'rgba(20,0,20,0.35)');
      ctx.fillStyle = rsh; ctx.fillRect(-rw / 2, -h, rw, s); ctx.fillRect(-h, -rw / 2, s, rw);

      // Bevel: lit edges toward the light, dark edges away.
      const bev = ctx.createLinearGradient(ux * h, uy * h, -ux * h, -uy * h);
      bev.addColorStop(0, 'rgba(255,255,255,0.55)'); bev.addColorStop(0.5, 'rgba(255,255,255,0)'); bev.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.strokeStyle = bev; ctx.lineWidth = 2.5;
      this._roundRect(ctx, -h + 1, -h + 1, s - 2, s - 2, 2.5); ctx.stroke();
      ctx.restore();

      // Bow at the top (local -y), two loops + knot, shaded as small spheres.
      const bx = 0, by = -h, r = s * 0.16;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.bezierCurveTo(bx + side * r * 0.6, by - r * 1.5, bx + side * r * 2.1, by - r * 1.3, bx + side * r * 1.9, by - r * 0.35);
        ctx.bezierCurveTo(bx + side * r * 1.7, by + r * 0.35, bx + side * r * 0.8, by + r * 0.25, bx, by);
        ctx.closePath();
        ctx.fillStyle = Shading.sphereGradient(ctx, bx + side * r * 1.15, by - r * 0.5, r * 1.1, st.ribbon, { x: lx, y: ly, z: LIGHT.z }, PAPER);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 0.8; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(bx, by, r * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = Shading.sphereGradient(ctx, bx, by, r * 0.42, st.ribbon, { x: lx, y: ly, z: LIGHT.z }, PAPER); ctx.fill();

      // Paper price tag, tied to the bow, hanging over the lower-right corner.
      if (p.tag) this._drawTag(ctx, p, s, angle);
      ctx.restore();
    }

    _drawTag(ctx, p, s, angle) {
      // Fixed-size tag so the text is legible on small boxes; drawn upright in world space
      // (counter-rotated) so it reads no matter how the box has tumbled.
      const h = s / 2, tw = 50, th = 18;
      const ax = h * 0.55, ay = h * 0.95;                       // anchor: near the lower-right corner
      // String from the knot (top centre) to the anchor.
      ctx.strokeStyle = 'rgba(60,40,30,0.6)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, -h); ctx.quadraticCurveTo(h * 0.7, -h * 0.1, ax, ay); ctx.stroke();
      ctx.save();
      ctx.translate(ax, ay); ctx.rotate(-angle + (-0.1 + Math.sin(p.seed) * 0.05));
      ctx.translate(tw * 0.4, th * 0.55);                       // hang from the eyelet
      ctx.shadowColor = 'rgba(25,8,25,0.45)'; ctx.shadowBlur = 5 * this.dpr; ctx.shadowOffsetX = 2 * this.dpr; ctx.shadowOffsetY = 3 * this.dpr;
      ctx.fillStyle = p.tag.bad ? '#ffe3e0' : '#fff8e8';
      this._roundRect(ctx, -tw / 2, -th / 2, tw, th, 3); ctx.fill();
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
      ctx.strokeStyle = p.tag.bad ? 'rgba(160,30,30,0.6)' : 'rgba(90,60,30,0.55)'; ctx.lineWidth = 1; ctx.stroke();
      // Eyelet with the string knot.
      ctx.beginPath(); ctx.arc(-tw / 2 + 5, 0, 1.6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(60,40,30,0.8)'; ctx.fill();
      // Text: bold, dark, shrunk to fit the tag.
      const maxW = tw - 12;
      let px = 11;
      ctx.font = `800 ${px}px Rubik, Arial, sans-serif`;
      const w = ctx.measureText(p.tag.t).width;
      if (w > maxW) { px = Math.max(7.5, px * maxW / w); ctx.font = `800 ${px.toFixed(1)}px Rubik, Arial, sans-serif`; }
      ctx.fillStyle = p.tag.bad ? '#a31212' : '#1c1016';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = 'rtl';
      ctx.fillText(p.tag.t, 3, 0.5);
      ctx.restore();
    }

    _drawClaw(ctx, x, y, theta) {
      const metal = [40, 8, 58];
      // Cable from carriage to head, with a thin highlight.
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#1a1418'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, G.railY - 4); ctx.lineTo(x, y - 12); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,230,210,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x - 0.8, G.railY - 4); ctx.lineTo(x - 0.8, y - 12); ctx.stroke();

      // Carriage on the rail.
      ctx.fillStyle = Shading.cylinderGradient(ctx, x - 16, G.railY - 4, x + 16, G.railY - 4, 7, metal, LIGHT, METAL);
      this._roundRect(ctx, x - 16, G.railY - 13, 32, 16, 4); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(x - 13, G.railY - 12, 26, 1.2);
      for (const wx of [-9, 9]) {
        ctx.beginPath(); ctx.arc(x + wx, G.railY - 9, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = Shading.sphereGradient(ctx, x + wx, G.railY - 9, 4.5, [40, 6, 40], LIGHT, METAL); ctx.fill();
      }

      // Middle finger (points at the viewer, foreshortened) — drawn behind the head.
      const midLen = G.fingerLen * (0.55 + 0.35 * Math.cos(theta));
      ctx.strokeStyle = Shading.shade(metal, 0.35, METAL); ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(x, y + G.fingerPivotDy);
      ctx.quadraticCurveTo(x + 1, y + G.fingerPivotDy + midLen * 0.6, x, y + G.fingerPivotDy + midLen); ctx.stroke();

      // Head: a vertical cylinder cap.
      ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 8 * this.dpr; ctx.shadowOffsetX = 3 * this.dpr; ctx.shadowOffsetY = 5 * this.dpr;
      ctx.fillStyle = Shading.cylinderGradient(ctx, x, y - 13, x, y + 13, 20, metal, LIGHT, METAL);
      this._roundRect(ctx, x - 20, y - 13, 40, 26, 7); ctx.fill();
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
      // Sharp specular streak (metal: small, near-white).
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; this._roundRect(ctx, x - 14, y - 10, 3, 18, 1.5); ctx.fill();
      // Cable eyelet.
      ctx.beginPath(); ctx.arc(x, y - 13, 5, 0, Math.PI * 2);
      ctx.fillStyle = Shading.sphereGradient(ctx, x, y - 13, 5, metal, LIGHT, METAL); ctx.fill();
      // Warning band on the head (a little colour).
      ctx.fillStyle = 'rgba(255,196,60,0.85)'; ctx.fillRect(x - 20, y + 4, 40, 3);

      // Two side fingers: talons that curl inward at the tip.
      for (const side of [-1, 1]) {
        const { pivot, dir, out } = this._fingerPose(side, x, y, theta);
        const L = G.fingerLen;
        const p1 = { x: pivot.x + dir.x * L * 0.45 + out.x * 9, y: pivot.y + dir.y * L * 0.45 + out.y * 9 };
        const p2 = { x: pivot.x + dir.x * L * 0.85 + out.x * 7, y: pivot.y + dir.y * L * 0.85 + out.y * 7 };
        const tip = { x: pivot.x + dir.x * L - out.x * 5, y: pivot.y + dir.y * L - out.y * 5 };
        ctx.strokeStyle = Shading.cylinderGradient(ctx, pivot.x, pivot.y, tip.x, tip.y, 4, metal, LIGHT, METAL);
        ctx.lineWidth = 7; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(pivot.x, pivot.y); ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, tip.x, tip.y); ctx.stroke();
        // Taper the tip with a thinner dark stroke over the last third.
        ctx.strokeStyle = Shading.shade(metal, 0.25, METAL); ctx.lineWidth = 3.5;
        ctx.beginPath(); ctx.moveTo(p2.x, p2.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
        // Specular edge on the lit side.
        ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(pivot.x - 1.5, pivot.y - 1.5); ctx.bezierCurveTo(p1.x - 1.5, p1.y - 1.5, p2.x - 1.5, p2.y - 1.5, tip.x - 1, tip.y - 1); ctx.stroke();
        // Pivot bolt.
        ctx.beginPath(); ctx.arc(pivot.x, pivot.y, 3.6, 0, Math.PI * 2);
        ctx.fillStyle = Shading.sphereGradient(ctx, pivot.x, pivot.y, 3.6, [40, 6, 38], LIGHT, METAL); ctx.fill();
      }
    }

    _drawMarqueeLights(ctx) {
      const t = this.time;
      const n = 14, x0 = 34, x1 = W - 34;
      for (let i = 0; i < n; i++) {
        const x = x0 + (x1 - x0) * i / (n - 1);
        const phase = ((i + Math.floor(t * 4)) % 3);
        const col = phase === 0 ? [340, 90, 66] : phase === 1 ? [45, 95, 62] : [172, 70, 55];
        const on = phase !== 2;
        for (const y of [20, 54]) {
          ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2);
          ctx.fillStyle = `hsl(${col[0]},${col[1]}%,${on ? col[2] : 28}%)`;
          if (on) { ctx.shadowColor = `hsla(${col[0]},${col[1]}%,${col[2]}%,0.9)`; ctx.shadowBlur = 8 * this.dpr; }
          ctx.fill(); ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
        }
      }
    }

    _drawClock(ctx) {
      const c = this.claw;
      const fx0 = G.chute.x1 + G.chute.lipW;
      const x = fx0 + 30, y = G.floorY + 51;
      // LCD.
      this._roundRect(ctx, x, y - 16, 74, 32, 5);
      ctx.fillStyle = '#0b120c'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.stroke();
      const secs = Math.ceil(c.state === 'idle' && this.enabled ? c.clockLeft : (c.state === 'idle' ? this.roundTime : 0));
      const urgent = c.state === 'idle' && this.enabled && c.clockLeft < 8;
      ctx.font = '22px "Share Tech Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = urgent ? (Math.floor(this.time * 4) % 2 ? '#ff5f6d' : '#ffb3b9') : '#7dff9a';
      ctx.shadowColor = urgent ? 'rgba(255,90,110,0.8)' : 'rgba(100,255,140,0.7)'; ctx.shadowBlur = 8 * this.dpr;
      ctx.fillText(String(secs).padStart(2, '0'), x + 37, y + 1);
      ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
      ctx.font = '600 9px Rubik, sans-serif'; ctx.fillStyle = 'rgba(255,230,210,0.7)';
      ctx.fillText('TIME', x + 37, y + 24);
    }

    _drawDoorGlow(ctx) {
      if (this.doorGlow <= 0) return;
      this.doorGlow = Math.max(0, this.doorGlow - 0.012);
      const a = Easing.easeOutCubic(this.doorGlow);
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const gr = ctx.createRadialGradient((G.chute.x0 + G.chute.x1) / 2, G.shaftBottom - 30, 4, (G.chute.x0 + G.chute.x1) / 2, G.shaftBottom - 30, 70);
      gr.addColorStop(0, `rgba(255,220,120,${0.9 * a})`); gr.addColorStop(1, 'rgba(255,220,120,0)');
      ctx.fillStyle = gr; ctx.fillRect(0, G.floorY, 200, H - G.floorY);
      ctx.restore();
    }
  }

  window.ClawGame = ClawGame;
})();
