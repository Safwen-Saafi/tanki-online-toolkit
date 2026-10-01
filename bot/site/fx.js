/* Landing page shot effects.
   One canvas over the hero tank, one animation loop, one recipe per turret.
   Everything is drawn here in code; nothing in this file comes from the game. */
(function () {
  'use strict';

  var CYCLE_MS = 6000;   // idle, fire, rest, then repeat
  var STEP_MS = 16;      // simulation step, so recipes behave the same at any frame rate
  var MAX_DPR = 2;
  var FLASH_MS = 150;

  var reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var params = new URLSearchParams(location.search);
  // ?fx=<ms> freezes the effect clock at that moment of the cycle, for screenshots and checks
  var frozenAt = params.has('fx') && isFinite(Number(params.get('fx'))) ? Math.max(0, Number(params.get('fx')) % CYCLE_MS) : null;

  var canvas = null, ctx = null, frame = null, real = null;
  var tank = null;        // { id, layout, turretEl }
  var recipe = null;
  var env = null;         // what a recipe sees: time, muzzle points in pixels, scale, room to the right
  var onScreen = true, running = false, rafId = 0, lastNow = 0, lastTurret = null;
  var dpr = 1;

  function makeRand(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- drawing helpers shared by the recipes ---------- */

  // A soft round glow. Meant to be drawn with the 'lighter' blend mode, which the engine sets.
  function glow(c, x, y, radius, rgb, alpha) {
    var g = c.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, 'rgba(' + rgb + ',' + alpha + ')');
    g.addColorStop(1, 'rgba(' + rgb + ',0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(x, y, radius, 0, Math.PI * 2);
    c.fill();
  }

  function drawFlash(c, p, size, strength) {
    glow(c, p.x, p.y, size * 1.1, '255,150,40', 0.55 * strength);
    glow(c, p.x, p.y, size * 0.55, '255,246,200', 0.95 * strength);
    c.save();
    c.translate(p.x, p.y);
    c.scale(2.6, 0.55);
    glow(c, 0, 0, size * 0.7, '255,214,120', 0.8 * strength);
    c.restore();
  }

  /* ---------- recipes: one per turret ---------- */

  // The default recipe, used by every turret until it gets its own: a muzzle flash and a recoil.
  // shots: when the turret fires, in ms from the start of the cycle (they drive the recoil too).
  // muzzles: optional hand-measured muzzle points inside the turret picture; default is the detected tip.
  var recipes = {};
  var generic = {
    shots: [1200],
    muzzles: null,
    update: function () {},
    draw: function (c, e) {
      for (var s = 0; s < this.shots.length; s++) {
        var age = e.t - this.shots[s];
        if (age < 0 || age > FLASH_MS) continue;
        var strength = 1 - age / FLASH_MS;
        for (var m = 0; m < e.muzzles.length; m++) drawFlash(c, e.muzzles[m], e.turretPx * 0.085, strength);
      }
    }
  };

  function recipeFor(id) { return recipes[id] || generic; }

  function recoilAt(t, shots) {
    var v = 0;
    for (var s = 0; s < shots.length; s++) {
      var age = t - shots[s];
      if (age < 0 || age > 600) continue;
      v += Math.exp(-age / 120) * (1 - Math.exp(-age / 14));
    }
    return Math.min(1, v * 1.6);
  }

  /* ---------- geometry ---------- */

  function sizeCanvas() {
    var r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function computeEnv() {
    if (!tank) return false;
    var cr = canvas.getBoundingClientRect(), rr = real.getBoundingClientRect(), L = tank.layout;
    if (!rr.width || !L.w) return false;
    var unit = rr.width / L.w, ox = rr.left - cr.left, oy = rr.top - cr.top;
    var tu = L.turret, k = tu.k || 1;
    var points = recipe.muzzles && recipe.muzzles.length ? recipe.muzzles : [[tu.mx / k, tu.my / k]];
    env.muzzles = points.map(function (m) { return { x: ox + (tu.x + m[0] * k) * unit, y: oy + (tu.y + m[1] * k) * unit }; });
    env.unit = unit;
    env.turretPx = tu.w * unit;
    env.w = cr.width;
    env.h = cr.height;
    env.groundY = oy + rr.height;
    // the page can cut the canvas off at the screen edge, so the room to the right is what is actually visible
    env.reach = Math.min(cr.right, document.documentElement.clientWidth) - cr.left - env.muzzles[0].x;
    return true;
  }

  /* ---------- the clock ---------- */

  function startCycle(index) {
    env.t = 0;
    env.cycle = index;
    env.store = {};
    env.rand = makeRand(frozenAt === null ? index * 7919 + 13 : 13);
  }

  function step(ms) {
    env.t += ms;
    if (env.t >= CYCLE_MS) startCycle(env.cycle + 1);
    recipe.update(env, ms);
  }

  function advance(dt) {
    while (dt > 0) { var s = Math.min(STEP_MS, dt); step(s); dt -= s; }
  }

  function paint() {
    ctx.clearRect(0, 0, env.w, env.h);
    ctx.globalCompositeOperation = 'lighter';
    recipe.draw(ctx, env);
    ctx.globalCompositeOperation = 'source-over';
    applyRecoil(recoilAt(env.t, recipe.shots || []));
  }

  function applyRecoil(v) {
    if (!tank || !tank.turretEl) return;
    var px = -v * env.turretPx * 0.016;
    tank.turretEl.style.transform = v > 0.002 ? 'translateX(' + px.toFixed(2) + 'px)' : '';
  }

  function simulateTo(ms) {
    startCycle(0);
    var left = ms;
    while (left > 0) { var s = Math.min(STEP_MS, left); step(s); left -= s; }
    paint();
  }

  /* ---------- lifecycle ---------- */

  function shouldRun() { return !!tank && onScreen && !document.hidden && !reducedMotion && frozenAt === null; }

  function tick(now) {
    rafId = 0;
    if (!running) return;
    var dt = Math.min(now - lastNow, 50);
    lastNow = now;
    advance(dt);
    paint();
    rafId = requestAnimationFrame(tick);
  }

  function sync() {
    var want = shouldRun();
    if (want && !running) {
      running = true;
      lastNow = performance.now();
      rafId = requestAnimationFrame(tick);
    } else if (!want && running) {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function clearCanvas() { if (ctx && env) ctx.clearRect(0, 0, env.w || canvas.width, env.h || canvas.height); }

  // Reduced motion: no loop, only one short flash when the turret changes.
  function flashOnce() {
    var t0 = performance.now();
    (function frameStep(now) {
      var age = now - t0;
      clearCanvas();
      if (age >= FLASH_MS || !tank) return;
      ctx.globalCompositeOperation = 'lighter';
      for (var m = 0; m < env.muzzles.length; m++) drawFlash(ctx, env.muzzles[m], env.turretPx * 0.085, 1 - age / FLASH_MS);
      ctx.globalCompositeOperation = 'source-over';
      requestAnimationFrame(frameStep);
    })(t0);
  }

  function rebuild() {
    if (!canvas) return;
    sizeCanvas();
    if (!tank || !computeEnv()) return;
    if (frozenAt !== null) simulateTo(frozenAt);
  }

  /* ---------- public API ---------- */

  window.TankFx = {
    recipes: recipes,
    helpers: { glow: glow, drawFlash: drawFlash },

    init: function (opts) {
      frame = opts.frame; real = opts.real; canvas = opts.canvas;
      ctx = canvas.getContext('2d');
      env = { t: 0, cycle: 0, store: {}, rand: makeRand(13), muzzles: [], unit: 1, turretPx: 100, w: 0, h: 0, groundY: 0, reach: 0 };
      recipe = generic;
      if (window.ResizeObserver) {
        var ro = new ResizeObserver(function () { rebuild(); });
        ro.observe(frame);
        ro.observe(real);
      }
      if (window.IntersectionObserver) {
        new IntersectionObserver(function (entries) { onScreen = entries[entries.length - 1].isIntersecting; sync(); }, { threshold: 0.02 }).observe(frame);
      }
      document.addEventListener('visibilitychange', sync);
      window.addEventListener('resize', rebuild);
    },

    // Call after the hero shows a new tank. turretEl is the element that recoils.
    setTank: function (info) {
      if (!canvas) return;
      var changedTurret = lastTurret !== info.id;
      lastTurret = info.id;
      tank = info;
      recipe = recipeFor(info.id);
      if (info.turretEl) info.turretEl.style.transform = '';
      sizeCanvas();
      if (!computeEnv()) return;
      startCycle(0);
      if (frozenAt !== null) { simulateTo(frozenAt); return; }
      if (reducedMotion) { if (changedTurret) flashOnce(); return; }
      clearCanvas();
      sync();
    },

    // Call when the hero shows the fallback drawing instead of the real images.
    clear: function () {
      tank = null;
      sync();
      clearCanvas();
    },

    // For checks and screenshots.
    info: function () {
      return { running: running, t: env ? env.t : 0, cycle: env ? env.cycle : 0, frozenAt: frozenAt, reduced: reducedMotion, muzzles: env ? env.muzzles.slice() : [], unit: env ? env.unit : 0, reach: env ? env.reach : 0 };
    }
  };
})();
