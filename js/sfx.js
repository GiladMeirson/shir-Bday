/* sfx.js — procedural sound effects (Web Audio, no audio files).
 *
 *   SFX.unlock()                 call on the first user gesture (mobile autoplay policy)
 *   SFX.toggle() / setMuted(b)   mute persists in localStorage
 *   SFX.motor.update(state, vx)  continuous carriage hum / winch whine, driven every game tick
 *   one-shots: click drop clank grab slip miss thud release home win fanfare
 *              open popper crowd chime whoosh
 */
window.SFX = (() => {
  'use strict';
  const KEY = 'shir-sfx-muted';
  let ac = null, master = null, noiseBuf = null, muted = false;
  try { muted = localStorage.getItem(KEY) === '1'; } catch (e) {}

  function ctx() {
    if (ac) return ac;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 18; comp.ratio.value = 5;
    comp.attack.value = 0.004; comp.release.value = 0.18;
    master = ac.createGain(); master.gain.value = muted ? 0 : 1;
    master.connect(comp).connect(ac.destination);
    return ac;
  }
  function unlock() { try { const c = ctx(); if (c && c.state === 'suspended') c.resume(); } catch (e) {} }
  const safe = (fn) => (...a) => { try { if (!ctx()) return; return fn(...a); } catch (e) { console.warn('[sfx]', e); } };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ───────────── building blocks ─────────────
  function noise() {
    const c = ctx();
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = c.createBufferSource(); s.buffer = noiseBuf; s.loop = true; return s;
  }
  function filt(type, f, q = 1) { const b = ctx().createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  function env(t0, { a = 0.01, peak = 0.2, hold = 0, d = 0.3, lin = false } = {}) {
    const g = ctx().createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    if (hold) g.gain.setValueAtTime(peak, t0 + a + hold);
    if (lin) g.gain.linearRampToValueAtTime(0, t0 + a + hold + d);
    else g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + hold + d);
    return g;
  }
  function tone(freq, dur, { type = 'sine', vol = 0.18, slide = 0, delay = 0, a = 0.012, detune = 0 } = {}) {
    const c = ctx(), t0 = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type; o.detune.value = detune;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    const g = env(t0, { a, peak: vol, d: dur });
    o.connect(g).connect(master); o.start(t0); o.stop(t0 + a + dur + 0.05);
  }
  // Filtered noise burst. `slideTo` sweeps the filter over the burst's life.
  function burst(dur, { f = 1000, q = 1, type = 'bandpass', vol = 0.2, delay = 0, a = 0.003, hold = 0, slideTo = 0 } = {}) {
    const c = ctx(), t0 = c.currentTime + delay;
    const n = noise(), b = filt(type, f, q);
    if (slideTo) b.frequency.exponentialRampToValueAtTime(slideTo, t0 + a + hold + dur);
    const g = env(t0, { a, peak: vol, hold, d: dur });
    n.connect(b).connect(g).connect(master); n.start(t0); n.stop(t0 + a + hold + dur + 0.05);
  }

  // ───────────── the claw machine ─────────────
  // Metal-on-metal: a few inharmonic partials with a fast decay + a bright noise tick.
  function clank({ hit = false, vol = 1, delay = 0 } = {}) {
    burst(0.05, { f: 3400, q: 0.8, vol: 0.16 * vol, delay });
    [2170, 3340, 5230, 7100].forEach((f, i) => tone(f, 0.14 + i * 0.03, { vol: 0.07 * vol / (i + 1), delay, a: 0.002 }));
    if (hit) {  // fingers landing on cardboard: dull thunk under the clank
      tone(150, 0.12, { type: 'triangle', vol: 0.16 * vol, slide: -60, delay, a: 0.003 });
      burst(0.09, { f: 420, type: 'lowpass', vol: 0.25 * vol, delay });
    }
  }

  // Continuous motor sounds, driven by the game loop. Carriage = gritty low hum whose pitch
  // rises with speed; winch = higher whine with a chain rattle while the head moves vertically.
  const motor = (() => {
    let n = null, lastRattle = 0;
    function build() {
      const c = ctx();
      // carriage
      const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 50;
      const o2 = c.createOscillator(); o2.type = 'square'; o2.frequency.value = 100;
      const lp = filt('lowpass', 420, 2);
      const am = c.createGain(); am.gain.value = 1;
      const lfo = c.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 26;
      const lfoG = c.createGain(); lfoG.gain.value = 0.4; lfo.connect(lfoG).connect(am.gain);
      const carVol = c.createGain(); carVol.gain.value = 0;
      o1.connect(lp); o2.connect(lp); lp.connect(am).connect(carVol).connect(master);
      // winch
      const w1 = c.createOscillator(); w1.type = 'triangle'; w1.frequency.value = 190;
      const w2 = c.createOscillator(); w2.type = 'sawtooth'; w2.frequency.value = 380; w2.detune.value = 8;
      const bp = filt('bandpass', 900, 1.4);
      const winchVol = c.createGain(); winchVol.gain.value = 0;
      w1.connect(bp); w2.connect(bp); bp.connect(winchVol).connect(master);
      [o1, o2, lfo, w1, w2].forEach((o) => o.start());
      n = { o1, o2, w1, w2, carVol, winchVol };
    }
    function update(state, vx) {
      if (!ac || ac.state !== 'running') return;
      if (!n) build();
      const t = ac.currentTime;
      let car = 0, winch = 0;
      if (state === 'idle' || state === 'traverse' || state === 'return') car = clamp(Math.abs(vx) / 150, 0, 1);
      if (state === 'descend') winch = 1; else if (state === 'lift') winch = 0.9;
      n.carVol.gain.setTargetAtTime(car * 0.085, t, 0.05);
      n.o1.frequency.setTargetAtTime(46 + 30 * car, t, 0.09);
      n.o2.frequency.setTargetAtTime(92 + 60 * car, t, 0.09);
      n.winchVol.gain.setTargetAtTime(winch * 0.045, t, 0.04);
      // lifting under load whines a little higher than paying the cable out
      n.w1.frequency.setTargetAtTime(state === 'lift' ? 235 : 190, t, 0.12);
      n.w2.frequency.setTargetAtTime(state === 'lift' ? 470 : 380, t, 0.12);
      if (winch && t - lastRattle > 0.105) { lastRattle = t; burst(0.016, { f: 2600, q: 2, vol: 0.045, a: 0.002 }); }
    }
    function silence() {
      if (n && ac) { const t = ac.currentTime; n.carVol.gain.setTargetAtTime(0, t, 0.02); n.winchVol.gain.setTargetAtTime(0, t, 0.02); }
    }
    return { update: (s, v) => { try { update(s, v); } catch (e) { console.warn('[sfx motor]', e); } }, silence };
  })();
  document.addEventListener('visibilitychange', () => { if (document.hidden) motor.silence(); });

  // ───────────── party ─────────────
  // A crowd going "wooo!": a chorus of detuned sawtooth voices through two sweeping formant
  // filters (oo → ah), plus scheduled noise clicks for applause. `level` 0..1 sets the size.
  function crowd(level = 1) {
    const c = ctx(), t0 = c.currentTime + 0.04;
    const voices = Math.round(6 + 10 * level), dur = 1.5 + 1.7 * level;
    const bus = c.createGain(); bus.gain.value = 0.2 + 0.3 * level;
    const soft = filt('lowpass', 3200, 0.6);
    bus.connect(soft).connect(master);
    for (let i = 0; i < voices; i++) {
      const start = t0 + Math.random() * 0.3 * (1 + level);
      const f0 = [125, 175, 240][i % 3] * (0.9 + Math.random() * 0.25);
      const o = c.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0, start);
      o.frequency.linearRampToValueAtTime(f0 * 1.28, start + dur * 0.45);   // "wooOOO" rises…
      o.frequency.linearRampToValueAtTime(f0 * 0.93, start + dur);          // …and trails off
      const vib = c.createOscillator(); vib.frequency.value = 4.5 + Math.random() * 2;
      const vibG = c.createGain(); vibG.gain.value = f0 * 0.03; vib.connect(vibG).connect(o.frequency);
      const f1 = filt('bandpass', 380, 6), f2 = filt('bandpass', 800, 8);
      f1.frequency.setValueAtTime(380, start); f1.frequency.linearRampToValueAtTime(730, start + dur * 0.5);
      f2.frequency.setValueAtTime(800, start); f2.frequency.linearRampToValueAtTime(1180, start + dur * 0.5);
      const g = env(start, { a: 0.18 + Math.random() * 0.15, peak: 0.075, hold: dur * 0.35, d: dur * 0.5, lin: true });
      o.connect(f1).connect(g); o.connect(f2).connect(g); g.connect(bus);
      o.start(start); vib.start(start); o.stop(start + dur + 0.1); vib.stop(start + dur + 0.1);
    }
    // applause: many short clicks, dense in the middle, thinning out
    const span = dur + 0.6, claps = Math.round(50 + 150 * level);
    const times = [];
    for (let i = 0; i < claps; i++) times.push(t0 + Math.random() * span);
    times.sort((a, b) => a - b);
    const n = noise(), bp = filt('bandpass', 2400, 1.1), cg = c.createGain();
    cg.gain.setValueAtTime(0.0001, t0);
    let prev = 0;
    for (let t of times) {
      t = Math.max(t, prev + 0.024); prev = t;
      const shape = Math.pow(Math.sin(Math.PI * clamp((t - t0) / span, 0, 1)), 0.7);
      const amp = 0.5 * shape * (0.5 + Math.random() * 0.5) + 0.0001;
      cg.gain.setValueAtTime(amp, t);
      cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
    }
    n.connect(bp).connect(cg).connect(bus); n.start(t0); n.stop(t0 + span + 0.3);
  }
  // Party popper: sharp bang + low thump + a hiss of paper fluttering.
  function popper(level = 1) {
    const one = (delay) => {
      burst(0.07, { f: 800, q: 0.6, vol: 0.5, a: 0.001, delay });
      tone(140, 0.13, { vol: 0.35, slide: -90, a: 0.001, delay });
      burst(0.55, { f: 4500, q: 0.5, type: 'highpass', vol: 0.05, a: 0.02, delay });
    };
    one(0);
    if (level >= 0.5) one(0.07);
    if (level >= 0.9) one(0.5);
  }
  // Wrapping paper ripping: stuttering, brightening noise.
  function tear() {
    const c = ctx(), t0 = c.currentTime;
    const n = noise(), bp = filt('bandpass', 500, 2.5);
    bp.frequency.setValueAtTime(500, t0); bp.frequency.exponentialRampToValueAtTime(2600, t0 + 0.6);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0);
    for (let t = 0; t < 0.6; t += 0.03) {
      g.gain.linearRampToValueAtTime(0.12 + Math.random() * 0.14, t0 + t + 0.012);
      g.gain.linearRampToValueAtTime(0.03, t0 + t + 0.03);
    }
    g.gain.linearRampToValueAtTime(0, t0 + 0.75);
    n.connect(bp).connect(g).connect(master); n.start(t0); n.stop(t0 + 0.85);
  }
  function sparkle(count = 8, delay = 0.2) {
    const notes = [1568, 1760, 2093, 2349, 2637, 3136, 3520];
    for (let i = 0; i < count; i++) tone(notes[Math.floor(Math.random() * notes.length)], 0.4, { vol: 0.045, delay: delay + i * 0.055, a: 0.004 });
  }
  // Cabin "ding-dong" (C6 → G#5) and a jet passing overhead.
  function chime() {
    tone(1046.5, 1.0, { vol: 0.1, a: 0.005 }); tone(2093, 0.5, { vol: 0.025, a: 0.005 });
    tone(830.6, 1.4, { vol: 0.1, delay: 0.55, a: 0.005 }); tone(1661, 0.6, { vol: 0.025, delay: 0.55, a: 0.005 });
  }
  function whoosh() {
    burst(1.1, { f: 260, q: 0.7, vol: 0.14, a: 0.55, slideTo: 1900 });
    burst(0.9, { f: 1900, q: 0.7, vol: 0.09, delay: 1.1, a: 0.05, slideTo: 220 });
  }

  const api = {
    unlock,
    get muted() { return muted; },
    setMuted(b) {
      muted = !!b;
      try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch (e) {}
      if (ac && master) master.gain.setTargetAtTime(muted ? 0 : 1, ac.currentTime, 0.02);
    },
    toggle() { api.setMuted(!muted); return muted; },
    motor,

    click: safe(() => tone(900, 0.06, { type: 'square', vol: 0.06 })),
    // winch engages: a clunk, then the motor takes over
    drop: safe(() => {
      burst(0.06, { f: 600, type: 'lowpass', vol: 0.22, a: 0.002 });
      tone(110, 0.12, { type: 'square', vol: 0.05, slide: -40 });
      clank({ vol: 0.45, delay: 0.02 });
    }),
    clank: safe((hit) => clank({ hit })),
    grab: safe(() => {
      tone(520, 0.08, { type: 'square', vol: 0.07 }); tone(780, 0.12, { type: 'square', vol: 0.06, delay: 0.08 });
      tone(1900, 0.09, { vol: 0.035, slide: 400, delay: 0.03 });   // rubber pads squeak
    }),
    slip: safe(() => { clank({ vol: 0.35 }); tone(420, 0.5, { type: 'triangle', vol: 0.12, slide: -300 }); }),
    miss: safe(() => { tone(300, 0.4, { type: 'triangle', vol: 0.1, slide: -160 }); tone(180, 0.28, { type: 'square', vol: 0.04, delay: 0.05 }); }),
    thud: safe((speed = 600) => {
      const v = clamp(speed / 900, 0.25, 1);
      burst(0.07, { f: 220, type: 'lowpass', vol: 0.35 * v, a: 0.002 });
      tone(95, 0.16, { vol: 0.3 * v, slide: -55, a: 0.002 });
      burst(0.03, { f: 1800, vol: 0.07 * v, a: 0.001 });
    }),
    release: safe(() => { clank({ vol: 0.55 }); burst(0.28, { f: 5000, type: 'highpass', vol: 0.045, a: 0.01 }); }),
    home: safe(() => { burst(0.05, { f: 300, type: 'lowpass', vol: 0.18, a: 0.002 }); clank({ vol: 0.35 }); }),
    // present drops into the chute: bell + coin + the little melody
    win: safe(() => {
      tone(1568, 0.7, { vol: 0.09, a: 0.003 }); tone(2637, 0.5, { vol: 0.035, a: 0.003 });
      tone(988, 0.08, { type: 'square', vol: 0.05, delay: 0.12 }); tone(1319, 0.45, { type: 'square', vol: 0.05, delay: 0.2 });
      [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.28, { vol: 0.1, delay: 0.3 + i * 0.11 }));
    }),
    fanfare: safe(() => [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => tone(f, i === 6 ? 0.9 : 0.22, { vol: 0.13, delay: i * 0.13 }))),
    open: safe(() => { tear(); sparkle(); tone(600, 0.3, { vol: 0.08, slide: 500, delay: 0.5 }); }),
    popper: safe(popper),
    crowd: safe(crowd),
    chime: safe(chime),
    whoosh: safe(whoosh),
  };
  return api;
})();
