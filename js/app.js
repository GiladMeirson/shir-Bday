/* app.js — screen flow, gift sequence, sounds, confetti.
 * Everything you may want to edit lives in CONFIG below.
 */
(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════
  //  CONFIG — עריכה כאן בלבד
  // ═══════════════════════════════════════════════════════════════════════
  const CONFIG = {
    // PLACEHOLDER — הברכה האישית. אפשר לכתוב כמה שורות; שורה ריקה = פסקה חדשה.
    greeting: `
    אהבה שלי, יפה שלי השותפה שלי לחיים.
    עוד יומולדת אנחנו מציינים ויומולדת שניה שלך כ-אמא, אמא שאני וארבל מסתכלים עליה בהערצה ובאהבה.
    אין עוד נשים כמוך, כל כך מיוחדת מדהימה יפה חכמה אוהבת מכילה ומוצלחת שאני לא יודע איך עוד לתאר את האדם שאת, כי אין עוד אנשים כמוך. לפגוש אדם כמוך זה כמו לפגוש מלאך זה קורה פעם בכמה גלגולי חיים.
    ועוד בטח לעשות איתו ילדים ולהקים משפחה אין יום שאני לא מודה על כך.
    ובעיקר ביום הזה ביום ההולדת שלך אני רוצה לכתוב לך כמה אני אוהב אותך מעריץ אותך מעריך אותך ונמשך אלייך בצורה אובססיבית לחלוטין.
    כמה ארבל אוהבת אותך ונתמכת בך שאת בונה לה את כל הביטחון האופי והאהבה שהיא צריכה, אנחנו זכינו בך.
    ולכן אני רוצה לאחל לך עוד המון בריאות אהבה אושר הצלחה ושפע של עושר, עוד זיכרונות מתוקים עם משפחתנו הקטנה והחדשה והלוואי ותמיד ניצור זיכרונות טובים ואוהבים.
    יומולדת שמח אהובתי היקרה. 😘
    `,

    marqueeTitle: "GIFT GRABBER",
    roundSeconds: 30,

    // סדר המתנות קבוע — לא משנה איזה צבע היא תופסת.
    gifts: [
      {
        img: "assets/terrarium-present.jpg",
        kicker: "חוויה מתקנת ליומולדת 30",
        title: "סדנת טרריום 🌿",
        sub: "אותו קונספט, הפעם עם ציפיות נמוכות יותר. זכית בהזדמנות שנייה לעשות משהו שלא רצית לעשות פעם ראשונה",
        caption: "תפסת! לחצי על המתנה כדי לפתוח",
      },
      {
        img: "assets/tveria-present.jpeg",
        kicker: "סוף שבוע זוגי (עם הילדה)",
        title: "חופשה במלון בטבריה 🏨",
        sub: `שני לילות בטבריה. כי רציתי לקחת אותך לחו"ל, אבל אז פתחתי את חשבון הבנק. אז אותה כנרת, אותם פקקים — הפעם עם מזוודה.`,
        caption: "עוד אחת! לחצי כדי לפתוח",
      },
      {
        img: "assets/ras-el-hime-present.jpeg",
        kicker: "החופשה החלומית",
        title: "חופשה בראס אל־ח׳ימה 🏜️",
        sub: "חופשה בראס אל־ח'ימה. דובאי באווירת רמאללה, אבל עם מלון 5 כוכבים.",
        caption: "שוב! לחצי כדי לפתוח",
      },
      {
        final: true,
        img: "assets/thailand-present.jpeg",
        sticker: "assets/thailand-sticker.webp",   // animated WebP (WhatsApp sticker) over the photo
        kicker: "המתנה האמיתית",
        title: "טסים לתאילנד! 🌴",
        sub: `טיסות, מלונות, חופים, ים, והרבה רגעים שניצור ביחד.
        הכול כבר מחכה לנו.
        שלושתנו, רחוקים מהשגרה, בדרך לנופש שלנו — לכמה ימים של שקט, כיף, חוויות וזמן איכות ביחד.
        כי המתנה הכי טובה שאני יכול לתת לך היא זמן ביחד, זיכרונות שלנו, ורגעים שניקח איתנו הרבה אחרי שנחזור הביתה.
        יום הולדת שמח, אהובה שלי ❤️
        `,
        caption: "המתנה האחרונה… לחצי לפתוח 🎀",
        // PLACEHOLDER — פרטי הטיסות. עדכן תאריכים/יעד/שמות.
        flights: {
          airline: "BIRTHDAY AIR",
          passengers: ["שיר", "גלעד", "ארבל"],
          out: {
            from: "TLV",
            fromCity: "תל אביב",
            to: "BKK",
            toCity: "בנגקוק",
            date: "31.10.2026",
            time: "21:40",
            flight: "LY 083",
          },
          back: {
            from: "BKK",
            fromCity: "בנגקוק",
            to: "TLV",
            toCity: "תל אביב",
            date: "14.11.2026",
            time: "23:55",
            flight: "LY 082",
          },
          nights: "16",
        },
        finalNote: "תאריכים: <b>31.10.2026</b> עד <b>14.11.2026</b> 15 ימים·",
      },
    ],
  };
  // ═══════════════════════════════════════════════════════════════════════

  const $ = (s) => document.querySelector(s);
  const screens = { intro: $('#screen-intro'), game: $('#screen-game'), reveal: $('#screen-reveal') };
  let game = null, giftIndex = 0, pendingWin = null;

  function show(name) {
    for (const k in screens) screens[k].classList.toggle('active', k === name);
    window.scrollTo(0, 0);
  }

  // ─────────────────────────── sound (tiny synth) ───────────────────────────
  const Sound = (() => {
    let ac = null;
    const ctx = () => (ac ||= new (window.AudioContext || window.webkitAudioContext)());
    const unlock = () => { try { const c = ctx(); if (c.state === 'suspended') c.resume(); } catch (e) {} };
    function tone(freq, dur, { type = 'sine', vol = 0.18, slide = 0, delay = 0 } = {}) {
      try {
        const c = ctx(), o = c.createOscillator(), g = c.createGain();
        const t0 = c.currentTime + delay;
        o.type = type; o.frequency.setValueAtTime(freq, t0);
        if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
        g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
        o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.02);
      } catch (e) {}
    }
    return {
      unlock,
      click: () => tone(900, 0.06, { type: 'square', vol: 0.06 }),
      drop: () => tone(220, 0.35, { type: 'sawtooth', vol: 0.08, slide: -120 }),
      grab: () => { tone(520, 0.08, { type: 'square', vol: 0.08 }); tone(780, 0.12, { type: 'square', vol: 0.07, delay: 0.08 }); },
      slip: () => tone(420, 0.5, { type: 'triangle', vol: 0.12, slide: -300 }),
      miss: () => tone(300, 0.4, { type: 'triangle', vol: 0.1, slide: -160 }),
      win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.28, { vol: 0.12, delay: i * 0.11 })),
      fanfare: () => [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => tone(f, i === 6 ? 0.9 : 0.22, { vol: 0.13, delay: i * 0.13 })),
      open: () => tone(600, 0.25, { type: 'sine', vol: 0.12, slide: 500 }),
    };
  })();

  // ─────────────────────────── intro ───────────────────────────
  function renderGreeting() {
    const el = $('#greeting-text');
    const text = CONFIG.greeting.trim();
    if (!text || /^\[.*\]$/s.test(text.replace(/\n+/g, ' ').trim()) || text.startsWith('[')) {
      el.innerHTML = `<span class="placeholder">📝 כאן תופיע הברכה — ערוך את CONFIG.greeting בקובץ js/app.js</span>`;
    } else {
      el.textContent = text;
    }
  }

  // ─────────────────────────── HUD ───────────────────────────
  const hud = $('#hud-msg');
  function say(text, mood) {
    hud.textContent = text;
    hud.classList.remove('pop', 'bad', 'good');
    void hud.offsetWidth;
    hud.classList.add('pop'); if (mood) hud.classList.add(mood);
  }
  const MSG = {
    ready: ['הזיזי את הזרוע עם החצים, ולחצי על הכפתור האדום', 'כווני טוב… ותפסי!', 'קדימה, איזו מתנה קוראת לך?'],
    empty: ['פספוס! הזרוע חזרה ריקה 😅', 'כלום. אפילו לא נייר עטיפה.', 'זה כמו במכונה האמיתית — נסי שוב'],
    slip: ['אוי לא! המתנה נשמטה בדרך 😬', 'הייתה לך! ואז… לא 😩', 'החזקה חלשה מדי — נשמט'],
    nearmiss: ['כמעעעט! נפלה ליד הפתח 🙈', 'נחתה על השפה ונפלה חזרה… כמו בחיים', 'סנטימטר מהפתח. סנטימטר!'],
    grab: ['תפסת משהו! עכשיו שלא ייפול…', 'יש אחיזה! מחזיקים אצבעות 🤞'],
  };
  const pick = (k) => MSG[k][Math.floor(Math.random() * MSG[k].length)];

  // ─────────────────────────── game screen ───────────────────────────
  function setupGame() {
    game = new ClawGame($('#claw-canvas'), {
      title: CONFIG.marqueeTitle, roundTime: CONFIG.roundSeconds,
      onEvent(type, data) {
        switch (type) {
          case 'drop': Sound.drop(); say('יורדת…'); break;
          case 'grab': Sound.grab(); say(pick('grab'), 'good'); break;
          case 'empty': Sound.miss(); say(pick('empty'), 'bad'); break;
          case 'slip': Sound.slip(); say(pick('slip'), 'bad'); break;
          case 'nearmiss': Sound.miss(); say(pick('nearmiss'), 'bad'); break;
          case 'ready': say(pick('ready')); break;
          case 'win': onWin(data); break;
        }
      },
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => game.refreshLayers());

    // Controls: hold-to-move buttons + keyboard.
    const left = $('#btn-left'), right = $('#btn-right'), drop = $('#btn-drop');
    const held = { left: false, right: false };
    const applyInput = () => game.setInput((held.right ? 1 : 0) - (held.left ? 1 : 0));
    const bindHold = (btn, key) => {
      const down = (e) => { e.preventDefault(); Sound.unlock(); held[key] = true; btn.classList.add('held'); applyInput(); };
      const up = (e) => { if (e) e.preventDefault(); held[key] = false; btn.classList.remove('held'); applyInput(); };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up); btn.addEventListener('pointerleave', up);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    bindHold(left, 'left'); bindHold(right, 'right');
    drop.addEventListener('pointerdown', (e) => { e.preventDefault(); Sound.unlock(); drop.classList.add('pressed'); });
    const release = () => drop.classList.remove('pressed');
    drop.addEventListener('pointerup', (e) => { e.preventDefault(); release(); if (game.drop()) Sound.click(); });
    drop.addEventListener('pointercancel', release); drop.addEventListener('pointerleave', release);
    window.addEventListener('keydown', (e) => {
      if (!screens.game.classList.contains('active')) return;
      if (e.key === 'ArrowLeft') { held.left = true; left.classList.add('held'); applyInput(); e.preventDefault(); }
      if (e.key === 'ArrowRight') { held.right = true; right.classList.add('held'); applyInput(); e.preventDefault(); }
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown') { if (!e.repeat && game.drop()) Sound.click(); e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'ArrowLeft') { held.left = false; left.classList.remove('held'); applyInput(); }
      if (e.key === 'ArrowRight') { held.right = false; right.classList.remove('held'); applyInput(); }
    });
    window.addEventListener('blur', () => { held.left = held.right = false; applyInput(); });
    game.start();
  }

  function enterGame() {
    show('game');
    if (!game) setupGame();
    game.setEnabled(true);
    say(giftIndex === 0 ? MSG.ready[0] : 'אוקיי… בואי ננסה מתנה אחרת 🎯');
  }

  // ─────────────────────────── win → reveal ───────────────────────────
  function onWin(data) {
    Sound.win();
    say('תפסת! 🎉', 'good');
    game.setEnabled(false); game.setInput(0);
    pendingWin = data;
    setTimeout(() => showReveal(data), 1100);
  }

  function hslCss([h, s, l]) { return `hsl(${h} ${s}% ${l}%)`; }

  function showReveal(data) {
    const gift = CONFIG.gifts[Math.min(giftIndex, CONFIG.gifts.length - 1)];
    const box = $('#giftbox');
    box.style.setProperty('--wrap', hslCss(data.style.wrap));
    box.style.setProperty('--ribbon', hslCss(data.style.ribbon));
    box.classList.remove('opening', 'gone');
    $('#wrapped').hidden = false;
    $('#wrapped-caption').textContent = gift.caption;
    const card = $('#gift-card');
    card.hidden = true; card.classList.toggle('final', !!gift.final);
    show('reveal');
    box.onclick = () => openGift(gift);
  }

  function openGift(gift) {
    const box = $('#giftbox');
    if (box.classList.contains('opening')) return;
    Sound.open();
    spawnSparks(box, gift.final ? 26 : 16);
    box.classList.add('opening');
    $('#wrapped-caption').innerHTML = '<span class="opening-fx">✨ פותחים… ✨</span>';
    setTimeout(() => {
      box.classList.add('gone');
      setTimeout(() => {
        $('#wrapped').hidden = true;
        box.classList.remove('opening');
        fillCard(gift);
        $('#gift-card').hidden = false;
        // Confetti scales with the gift: a polite sprinkle for #1, the works for Thailand.
        const level = gift.final ? 1 : ([0.12, 0.3, 0.55][giftIndex] ?? 0.55);
        Confetti.burst(level);
        if (gift.final) Sound.fanfare();
      }, 420);
    }, 900);
  }

  // Glowing sparks + little stars thrown out of the box; each gets its own direction/delay.
  const SPARK_COLORS = ['#f6c453', '#fff4e6', '#ff9ecb', '#7fe3d3', '#ffd978'];
  function spawnSparks(box, n) {
    box.querySelectorAll('.gb-spark').forEach((el) => el.remove());
    for (let i = 0; i < n; i++) {
      const el = document.createElement('span');
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;          // mostly upward
      const r = 110 + Math.random() * 150;
      el.className = 'gb-spark' + (Math.random() < 0.35 ? ' star' : '');
      el.style.setProperty('--dx', `${Math.cos(a) * r}px`);
      el.style.setProperty('--dy', `${Math.sin(a) * r}px`);
      el.style.setProperty('--d', `${(Math.random() * 0.35).toFixed(2)}s`);
      el.style.setProperty('--s', `${6 + Math.random() * 9}px`);
      el.style.setProperty('--c', SPARK_COLORS[i % SPARK_COLORS.length]);
      box.appendChild(el);
    }
  }

  function fillCard(gift) {
    const badge = $('#gift-badge');
    badge.hidden = !gift.final;
    badge.textContent = '🎁 המתנה האמיתית';
    const img = $('#gift-img'); img.src = gift.img; img.alt = gift.title;
    const photo = img.parentElement;
    photo.querySelector('.sticker')?.remove();
    if (gift.sticker) {
      const st = document.createElement('img');
      st.className = 'sticker'; st.src = gift.sticker; st.alt = ''; st.setAttribute('aria-hidden', 'true');
      photo.appendChild(st);
    }
    $('#gift-kicker').textContent = gift.kicker;
    $('#gift-title').textContent = gift.title;
    $('#gift-sub').textContent = gift.sub;
    const extra = $('#gift-extra'); extra.innerHTML = '';
    const reject = $('#btn-reject');
    if (gift.final) {
      extra.innerHTML = boardingPasses(gift.flights) + `<p class="final-note">${gift.finalNote}</p>`;
      reject.hidden = true;
    } else {
      reject.hidden = false;
      reject.onclick = () => { Sound.click(); giftIndex++; enterGame(); };
    }
  }

  const planeSvg = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>`;
  function pass(leg, f, who, seat) {
    return `
    <div class="pass">
      <div class="pass-main">
        <div class="pass-head"><span class="airline">${f.airline}</span><span>BOARDING PASS · ${leg.flight}</span></div>
        <div class="pass-route">
          <div class="from"><div class="code">${leg.from}</div><div class="city">${leg.fromCity}</div></div>
          <div class="plane" aria-hidden="true"><span class="trail"></span><span class="jet">${planeSvg}</span></div>
          <div class="to"><div class="code">${leg.to}</div><div class="city">${leg.toCity}</div></div>
        </div>
        <div class="pass-grid">
          <div><small>תאריך</small>${leg.date}</div>
          <div><small>שעה</small>${leg.time}</div>
          <div><small>שער</small>30</div>
          <div><small>מחלקה</small>יומולדת</div>
        </div>
      </div>
      <div class="pass-stub">
        <div class="name">${who}</div>
        <div class="barcode"></div>
        <div class="seat">מושב ${seat}</div>
      </div>
    </div>`;
  }
  function boardingPasses(f) {
    const seats = ['12A', '12B', '12C'];
    const out = f.passengers.map((p, i) => pass(f.out, f, p, seats[i] || '12D')).join('');
    return `<div class="boarding">${out}</div>`;
  }

  // ─────────────────────────── confetti ───────────────────────────
  const Confetti = (() => {
    const cv = $('#confetti-canvas'); const ctx = cv.getContext('2d');
    let parts = [], raf = 0, last = 0;
    const COLORS = ['#f6c453', '#ff6b5a', '#2fb8a6', '#ff9ecb', '#8ad0ff', '#fff4e6'];
    function resize() { cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio; }
    function spawn(n, x, y, spread) {
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * spread, sp = 600 + Math.random() * 900;
        parts.push({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, w: 8 + Math.random() * 8, h: 5 + Math.random() * 6,
          rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 14, color: COLORS[i % COLORS.length],
          wob: Math.random() * Math.PI * 2, life: 0, ttl: 4 + Math.random() * 2, shape: Math.random() < 0.25 ? 'circle' : 'rect',
        });
      }
    }
    function frame(t) {
      const dt = Math.min(0.033, (t - last) / 1000 || 0.016); last = t;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      parts = parts.filter((p) => p.life < p.ttl && p.y < innerHeight + 40);
      for (const p of parts) {
        p.life += dt; p.vy += 1100 * dt;                          // gravity
        p.vx *= Math.exp(-2.2 * dt); p.vy *= Math.exp(-1.6 * dt);  // air drag (paper is light)
        p.wob += dt * 6; p.x += (p.vx + Math.sin(p.wob) * 40) * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        const fade = Math.min(1, (p.ttl - p.life) / 0.8);
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.globalAlpha = fade;
        ctx.fillStyle = p.color;
        const sq = 0.35 + 0.65 * Math.abs(Math.cos(p.wob * 0.7));  // flutter: foreshortened as it turns
        if (p.shape === 'circle') { ctx.beginPath(); ctx.ellipse(0, 0, p.w / 2, (p.w / 2) * sq, 0, 0, Math.PI * 2); ctx.fill(); }
        else ctx.fillRect(-p.w / 2, -(p.h * sq) / 2, p.w, p.h * sq);
        ctx.restore();
      }
      if (parts.length) raf = requestAnimationFrame(frame); else { raf = 0; ctx.clearRect(0, 0, innerWidth, innerHeight); }
    }
    return {
      // level 0..1: how big a deal this gift is.
      burst(level = 1) {
        resize();
        const n = Math.round(140 * level);
        if (level < 0.25) {
          spawn(Math.max(18, n * 2), innerWidth / 2, innerHeight * 0.72, 1.2);
        } else {
          spawn(n, innerWidth * 0.2, innerHeight * 0.75, 1.1);
          spawn(n, innerWidth * 0.8, innerHeight * 0.75, 1.1);
        }
        if (level >= 0.5) setTimeout(() => { spawn(Math.round(120 * level), innerWidth / 2, innerHeight * 0.6, 1.6); }, 500);
        if (level >= 0.9) setTimeout(() => { spawn(80, innerWidth * 0.5, -10, 2.6); }, 1300);
        if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
      },
    };
    })();
  window.addEventListener('resize', () => { /* canvas resized on next burst */ });

  // ─────────────────────────── boot ───────────────────────────
  renderGreeting();
  $('#btn-to-gift').addEventListener('click', () => { Sound.unlock(); Sound.click(); enterGame(); });

  // Dev preview: index.html?gift=2 shows the wrapped box for gift #3; add &open=1 to open it;
  // index.html?screen=game jumps straight to the machine.
  const qs = new URLSearchParams(location.search);
  if (qs.has('gift')) {
    giftIndex = Math.max(0, Math.min(CONFIG.gifts.length - 1, parseInt(qs.get('gift'), 10) || 0));
    const sample = { style: { wrap: [8, 78, 58], ribbon: [45, 88, 62] }, size: 50 };
    showReveal(sample);
    if (qs.get('open') === '1') { const gift = CONFIG.gifts[giftIndex]; $('#wrapped').hidden = true; fillCard(gift); $('#gift-card').hidden = false; }
  } else if (qs.get('screen') === 'game') {
    enterGame();
  }
})();
