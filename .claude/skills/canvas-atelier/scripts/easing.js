// easing.js — drop-in easing functions for canvas animation.
// All functions take t in [0, 1] and return a value roughly in [0, 1]
// (elastic/bounce/spring can briefly overshoot beyond 1, which is intentional).
//
// Usage:
//   const eased = Easing.easeOutCubic(progress);
//   x = startX + (endX - startX) * eased;

const Easing = {
  linear: (t) => t,

  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),

  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),

  easeOutExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),

  // Overshoots slightly then settles — good for UI elements arriving into place.
  easeOutBack: (t, overshoot = 1.70158) => {
    const c = overshoot;
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
  },

  // Bouncy, springy settle — good for playful/organic motion (see squash & stretch).
  elastic: (t) => {
    if (t === 0 || t === 1) return t;
    const c4 = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },

  // Discrete bounce (ball hitting the ground repeatedly, losing energy each time).
  bounce: (t) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },

  // Simple critically-damped spring, useful for continuous interactive motion
  // (e.g. an element following a pointer). Call every frame, not with a fixed t.
  // Returns updated {value, velocity} — feed the previous frame's output back in.
  springStep: (current, target, velocity, { stiffness = 170, damping = 26, dt = 16 } = {}) => {
    const dtSec = dt / 1000;
    const force = (target - current) * stiffness;
    const damp = velocity * damping;
    const accel = force - damp;
    const newVelocity = velocity + accel * dtSec;
    const newValue = current + newVelocity * dtSec;
    return { value: newValue, velocity: newVelocity };
  },
};

// Support both browser <script> use and module import.
if (typeof module !== 'undefined') module.exports = Easing;
