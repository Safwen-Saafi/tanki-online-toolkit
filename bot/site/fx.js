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
  var fxParam = (params.get('fx') || '').trim();
  var frozenAt = fxParam !== '' && isFinite(Number(fxParam)) ? Math.max(0, Number(fxParam) % CYCLE_MS) : null;

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

  function lerp(a, b, k) { return a + (b - a) * k; }

  // 0 before start, fades in over `up`, 1 until end, fades out over `down`, then 0.
  function ramp(t, start, end, up, down) {
    if (t < start || t > end + down) return 0;
    if (t < start + up) return (t - start) / up;
    if (t <= end) return 1;
    return 1 - (t - end) / down;
  }

  // A soft round sprite per tint, drawn instead of building a gradient for every particle.
  var sprites = {};
  function sprite(r, g, b) {
    var q = function (v) { return Math.max(0, Math.min(255, Math.round(v / 16) * 16)); };
    var key = q(r) + ',' + q(g) + ',' + q(b);
    if (sprites[key]) return sprites[key];
    var s = document.createElement('canvas');
    s.width = s.height = 64;
    var x = s.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(' + key + ',1)');
    gr.addColorStop(0.45, 'rgba(' + key + ',0.55)');
    gr.addColorStop(1, 'rgba(' + key + ',0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, 64, 64);
    sprites[key] = s;
    return s;
  }

  // The particle stream: a cone of soft particles that move, grow and fade. Used for flames, mist and smoke.
  // cfg: x, y (origin), angle, spread (radians, either side), speed [min,max] px/s, life [min,max] s,
  //      size [start,end] px radius, rise px/s^2 (upward pull), drag 1/s, jitter px.
  var stream = {
    create: function (cap) { return { p: [], cap: cap, acc: 0 }; },
    emit: function (s, cfg, rate, dtMs, rand) {
      s.acc += rate * dtMs / 1000;
      while (s.acc >= 1) {
        s.acc -= 1;
        if (s.p.length >= s.cap) continue;
        var ang = cfg.angle + (rand() - 0.5) * 2 * cfg.spread;
        var sp = cfg.speed[0] + rand() * (cfg.speed[1] - cfg.speed[0]);
        s.p.push({
          x: cfg.x + (rand() - 0.5) * (cfg.jitter || 0), y: cfg.y + (rand() - 0.5) * (cfg.jitter || 0),
          vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, age: 0,
          life: cfg.life[0] + rand() * (cfg.life[1] - cfg.life[0]),
          r0: cfg.size[0] * (0.7 + rand() * 0.6), r1: cfg.size[1] * (0.7 + rand() * 0.6),
          rise: cfg.rise || 0, drag: cfg.drag || 0, seed: rand()
        });
      }
    },
    update: function (s, dtMs) {
      var dt = dtMs / 1000;
      for (var i = s.p.length - 1; i >= 0; i--) {
        var q = s.p[i];
        q.age += dt;
        if (q.age >= q.life) { s.p.splice(i, 1); continue; }
        q.vy -= q.rise * dt;
        if (q.drag) { var d = Math.exp(-q.drag * dt); q.vx *= d; q.vy *= d; }
        q.x += q.vx * dt;
        q.y += q.vy * dt;
      }
    },
    // tint(f, seed) gets the particle's age as 0..1 and returns [r, g, b, alpha]
    draw: function (c, s, tint) {
      for (var i = 0; i < s.p.length; i++) {
        var q = s.p[i], f = q.age / q.life, col = tint(f, q.seed), rad = q.r0 + (q.r1 - q.r0) * f;
        c.globalAlpha = col[3];
        c.drawImage(sprite(col[0], col[1], col[2]), q.x - rad, q.y - rad, rad * 2, rad * 2);
      }
      c.globalAlpha = 1;
    }
  };

  // Fast tracer bullets: a short bright streak with a head, flying straight and fading at the end of their range.
  // b: x, y, vx, vy (px/s), life (s), len (px of trail), width (px), head and tail colours [r, g, b].
  var bullets = {
    create: function (cap) { return { p: [], cap: cap }; },
    fire: function (s, b) { if (s.p.length < s.cap) { b.age = 0; s.p.push(b); } },
    update: function (s, dtMs) {
      var dt = dtMs / 1000;
      for (var i = s.p.length - 1; i >= 0; i--) {
        var b = s.p[i];
        b.age += dt;
        if (b.age >= b.life) { s.p.splice(i, 1); continue; }
        b.x += b.vx * dt;
        b.y += b.vy * dt;
      }
    },
    draw: function (c, s) {
      c.lineCap = 'round';
      for (var i = 0; i < s.p.length; i++) {
        var b = s.p[i], fade = Math.min(1, (b.life - b.age) / 0.06), sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
        var tx = b.x - b.vx / sp * b.len, ty = b.y - b.vy / sp * b.len;
        var g = c.createLinearGradient(tx, ty, b.x, b.y);
        g.addColorStop(0, 'rgba(' + b.tail.join(',') + ',0)');
        g.addColorStop(1, 'rgba(' + b.head.join(',') + ',' + fade.toFixed(3) + ')');
        c.strokeStyle = g;
        c.lineWidth = b.width;
        c.beginPath();
        c.moveTo(tx, ty);
        c.lineTo(b.x, b.y);
        c.stroke();
        c.globalAlpha = fade * 0.9;
        c.drawImage(sprite(b.head[0], b.head[1], b.head[2]), b.x - b.width * 1.4, b.y - b.width * 1.4, b.width * 2.8, b.width * 2.8);
        c.globalAlpha = 1;
      }
    }
  };

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

  // Firebird: a continuous flame. White-yellow at the nozzle, orange, then dark red as it rises and fades.
  function fireTint(f) {
    var r, g, b, k;
    if (f < 0.3) { k = f / 0.3; r = 255; g = lerp(246, 170, k); b = lerp(190, 50, k); }
    else if (f < 0.7) { k = (f - 0.3) / 0.4; r = 255; g = lerp(170, 95, k); b = lerp(50, 20, k); }
    else { k = (f - 0.7) / 0.3; r = lerp(255, 150, k); g = lerp(95, 25, k); b = lerp(20, 10, k); }
    return [r, g, b, (f < 0.12 ? f / 0.12 : (1 - f) / 0.88) * 0.8];
  }
  recipes.firebird = {
    shots: [],
    muzzles: null,
    update: function (e, dt) {
      var tp = e.turretPx, m = e.muzzles[0];
      var st = e.store.flame || (e.store.flame = stream.create(e.w < 520 ? 150 : 300));
      var a = e.store.fire = ramp(e.t, 800, 3200, 160, 380);
      var reach = Math.min(tp * 0.95, e.reach * 0.9);
      stream.emit(st, { x: m.x, y: m.y, angle: 0, spread: 0.14, speed: [reach / 0.8, reach / 0.5], life: [0.5, 0.85], size: [tp * 0.024, tp * 0.088], rise: tp * 0.8, jitter: tp * 0.014 }, 300 * a, dt, e.rand);
      stream.update(st, dt);
    },
    draw: function (c, e) {
      if (e.store.flame) stream.draw(c, e.store.flame, fireTint);
      var a = e.store.fire || 0, m = e.muzzles[0];
      if (a > 0) glow(c, m.x, m.y, e.turretPx * 0.05, '255,230,150', 0.7 * a * (0.8 + 0.2 * Math.sin(e.t / 35)));
    }
  };

  // Freeze: a cold mist cone, white to cyan to pale blue, heavier than flame so it drifts down a little,
  // with small ice glints that twinkle inside it.
  function frostTint(f) {
    var r, g, b, k;
    // deep blue at the nozzle, getting lighter with age (and so with distance), never pure white
    if (f < 0.5) { k = f / 0.5; r = lerp(25, 105, k); g = lerp(115, 190, k); b = lerp(225, 255, k); }
    else { k = (f - 0.5) / 0.5; r = lerp(105, 170, k); g = lerp(190, 225, k); b = 255; }
    return [r, g, b, (f < 0.07 ? f / 0.07 : (1 - f) / 0.93) * 0.5];
  }
  recipes.freeze = {
    shots: [],
    muzzles: null,
    update: function (e, dt) {
      var tp = e.turretPx, m = e.muzzles[0], small = e.w < 520;
      var mist = e.store.mist || (e.store.mist = stream.create(small ? 320 : 620));
      var ice = e.store.ice || (e.store.ice = stream.create(small ? 60 : 120));
      var a = e.store.fire = ramp(e.t, 800, 3200, 200, 420);
      var reach = Math.min(tp * 0.9, e.reach * 0.9);
      stream.emit(mist, { x: m.x, y: m.y, angle: 0.04, spread: 0.2, speed: [reach / 1.05, reach / 0.65], life: [0.65, 1.1], size: [tp * 0.026, tp * 0.1], rise: -tp * 0.25, jitter: tp * 0.014 }, 620 * a, dt, e.rand);
      stream.emit(ice, { x: m.x, y: m.y, angle: 0.04, spread: 0.24, speed: [reach / 0.9, reach / 0.5], life: [0.35, 0.75], size: [tp * 0.011, tp * 0.019], rise: -tp * 0.1, jitter: tp * 0.01 }, 85 * a, dt, e.rand);
      stream.update(mist, dt);
      stream.update(ice, dt);
    },
    draw: function (c, e) {
      var tp = e.turretPx, m = e.muzzles[0], a = e.store.fire || 0;
      if (e.store.mist) {
        c.globalCompositeOperation = 'source-over';
        stream.draw(c, e.store.mist, frostTint);
        c.globalCompositeOperation = 'lighter';
      }
      if (e.store.ice) {
        // round ice droplets: a small bright core with a soft halo, fading in as they travel
        e.store.ice.p.forEach(function (q) {
          var f = q.age / q.life, tw = 0.65 + 0.35 * Math.sin(q.age * 28 + q.seed * 10);
          var alpha = (1 - f) * tw * Math.min(1, f / 0.3), rad = q.r0 + (q.r1 - q.r0) * f;
          c.globalAlpha = alpha * 0.35;
          c.drawImage(sprite(150, 205, 255), q.x - rad * 2.6, q.y - rad * 2.6, rad * 5.2, rad * 5.2);
          c.globalAlpha = alpha * 0.95;
          c.drawImage(sprite(205, 235, 255), q.x - rad, q.y - rad, rad * 2, rad * 2);
        });
        c.globalAlpha = 1;
      }
      if (a > 0) glow(c, m.x, m.y, tp * 0.05, '90,170,255', 0.55 * a * (0.85 + 0.15 * Math.sin(e.t / 45)));
    }
  };

  // Vulcan: a rapid stream of yellow tracers from across the barrel cluster, spinning up to speed, with a flickering
  // flash and a light steady shake instead of a single kick. After two seconds of firing it overheats: the barrel cluster glows red-hot,
  // glowing embers drift off it, and Gauss-style grey wind-blown smoke vents from the middle of the turret. It cools after the burst.
  function heatEmberTint(f) { return [255, lerp(170, 50, f), lerp(60, 15, f), 0.9 * (1 - f)]; }
  recipes.vulcan = {
    shots: [],
    muzzles: null,
    recoilFn: function (e) { return (e.store.fire || 0) * (0.3 + 0.12 * Math.sin(e.t / 16)); },
    update: function (e, dt) {
      var tp = e.turretPx, m = e.muzzles[0];
      var b = e.store.bullets || (e.store.bullets = bullets.create(24));
      var flashes = e.store.flashes || (e.store.flashes = []);
      var a = e.store.fire = ramp(e.t, 700, 3100, 450, 150);
      e.store.acc = (e.store.acc || 0) + 22 * a * dt / 1000;
      var maxDist = Math.min(e.reach * 0.95, tp * 1.5);
      while (e.store.acc >= 1) {
        e.store.acc -= 1;
        var speed = maxDist / 0.2 * (0.92 + e.rand() * 0.16), ang = (e.rand() - 0.5) * 0.03;
        bullets.fire(b, { x: m.x + speed * 0.04 + tp * 0.012, y: m.y + (e.rand() - 0.5) * 2 * tp * 0.045, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, life: maxDist / speed, len: speed * 0.04, width: Math.max(1.5, tp * 0.007), head: [255, 244, 160], tail: [255, 170, 40] });
        flashes.push(e.t);
      }
      bullets.update(b, dt);
      while (flashes.length && e.t - flashes[0] > 70) flashes.shift();
      // overheating: smoke from the middle of the turret from two seconds into the burst, and embers off the hot barrels
      var st = e.store, vent = st.vent || (st.vent = stream.create(260)), embers = st.embers || (st.embers = stream.create(120));
      var heat = st.heat = ramp(e.t, 1700, 3100, 1300, 1000);
      if (e.t >= 2700 && e.t < 3900) stream.emit(vent, { x: m.x - tp * 0.5, y: m.y - tp * 0.09, angle: -1.85, spread: 0.45, speed: [tp * 0.15, tp * 0.55], life: [0.9, 1.4], size: [tp * 0.022, tp * 0.075], rise: tp * 0.08, drag: 0.9, jitter: tp * 0.06 }, 70, dt, e.rand);
      for (var wi = 0; wi < vent.p.length; wi++) vent.p[wi].vx -= tp * 0.45 * dt / 1000;
      if (heat > 0.3) stream.emit(embers, { x: m.x - e.rand() * tp * 0.3, y: m.y, angle: -1.57, spread: 0.9, speed: [tp * 0.05, tp * 0.25], life: [0.4, 0.8], size: [tp * 0.01, tp * 0.003], rise: tp * 0.05, drag: 1.2, jitter: tp * 0.03 }, 28 * heat, dt, e.rand);
      stream.update(vent, dt);
      stream.update(embers, dt);
    },
    draw: function (c, e) {
      var tp = e.turretPx, m = e.muzzles[0], flashes = e.store.flashes || [], st = e.store, heat = st.heat || 0;
      if (st.vent) {
        // the smoke is drawn solid so it stays grey instead of glowing
        c.globalCompositeOperation = 'source-over';
        stream.draw(c, st.vent, ventTint);
        c.globalCompositeOperation = 'lighter';
      }
      if (heat > 0) {
        // the barrel cluster glows red-hot: a long soft glow along the barrels, a hotter one at the muzzle, and a flicker
        var fk = 0.85 + 0.15 * Math.sin(e.t * 0.05) * Math.sin(e.t * 0.13);
        c.globalAlpha = 0.55 * heat * fk;
        c.drawImage(sprite(255, 70, 20), m.x - tp * 0.5, m.y - tp * 0.075, tp * 0.55, tp * 0.15);
        c.globalAlpha = 1;
        glow(c, m.x - tp * 0.04, m.y, tp * 0.09, '255,80,25', 0.6 * heat * fk);
        if (st.embers) stream.draw(c, st.embers, heatEmberTint);
      }
      if (e.store.bullets) bullets.draw(c, e.store.bullets);
      for (var i = 0; i < flashes.length; i++) drawFlash(c, { x: m.x, y: m.y + ((i * 37 % 7) - 3) * tp * 0.01 }, tp * 0.045, 1 - (e.t - flashes[i]) / 70);
    }
  };

  // A round projectile: a soft glow, a solid core and a short fading trail. Hammer's pellets and Twins' plasma use it.
  // b: x, y, vx, vy, age, life, len (px of trail, 0 for none), r (core radius px), core, glow, trail, tail (colours [r, g, b]), halo (glow radius in cores).
  function drawBall(c, b) {
    var fade = Math.min(1, (b.life - b.age) / 0.1), sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy), r = b.r, tx = b.x - b.vx / sp * b.len, ty = b.y - b.vy / sp * b.len;
    var halo = b.halo || 2.6;
    if (b.len > 0) {
      var g = c.createLinearGradient(tx, ty, b.x, b.y);
      g.addColorStop(0, 'rgba(' + b.tail.join(',') + ',0)');
      g.addColorStop(1, 'rgba(' + b.trail.join(',') + ',' + (0.7 * fade).toFixed(3) + ')');
      c.strokeStyle = g;
      c.lineWidth = r * 0.9;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(tx, ty);
      c.lineTo(b.x, b.y);
      c.stroke();
    }
    c.globalAlpha = fade * 0.75;
    c.drawImage(sprite(b.glow[0], b.glow[1], b.glow[2]), b.x - r * halo, b.y - r * halo, r * halo * 2, r * halo * 2);
    c.globalAlpha = fade;
    c.fillStyle = 'rgb(' + b.core.join(',') + ')';
    c.beginPath();
    c.arc(b.x, b.y, r, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;
  }

  // A straight horizontal beam from (x, y) running `len` px to the right. Built from short slices so it can be brightest at the start and
  // fade with distance: a wide soft halo, a coloured body and a thin pale core. a is the overall strength, 0..1.
  // tint: { halo, body, core } as [r, g, b]. Railgun and Shaft share it.
  function drawBeam(c, x, y, len, width, a, tint) {
    if (a <= 0 || len <= 0) return;
    var N = 60, dpr = c.getTransform().a || 1;
    var layers = [[width * 7, tint.halo, 0.4], [width * 2.4, tint.body, 0.85], [width * 0.7, tint.core, 1]];
    for (var l = 0; l < layers.length; l++) {
      var h = layers[l][0], col = layers[l][1].join(','), base = layers[l][2];
      var g = c.createLinearGradient(0, y - h / 2, 0, y + h / 2);
      g.addColorStop(0, 'rgba(' + col + ',0)');
      g.addColorStop(0.5, 'rgba(' + col + ',1)');
      g.addColorStop(1, 'rgba(' + col + ',0)');
      c.fillStyle = g;
      for (var i = 0; i < N; i++) {
        // slice edges are snapped to device pixels so neighbouring slices neither overlap nor leave a seam
        var u = (i + 0.5) / N, x0 = Math.round((x + len * i / N) * dpr) / dpr, x1 = Math.round((x + len * (i + 1) / N) * dpr) / dpr;
        c.globalAlpha = a * base * (1 - 0.75 * Math.pow(u, 1.2)) * (l < 2 ? Math.min(1, 0.3 + u / 0.06) : 1);
        c.fillRect(x0, y - h / 2, x1 - x0, h);
      }
    }
    c.globalAlpha = 1;
  }

  // A flat, long glowing slug: solid from end to end with no fading tail, in a soft halo, a coloured body and a pale core.
  // Used for energy shots that are not round bullets (Shaft, Gauss). col: { halo, body, core } as 'r,g,b' strings.
  function drawSlug(c, headX, tailX, y, th, fade, col) {
    c.lineCap = 'round';
    c.strokeStyle = 'rgb(' + col.halo + ')';
    for (var hw = 0; hw < 4; hw++) {
      c.globalAlpha = fade * 0.13;
      c.lineWidth = th * (3 + hw * 2.2);
      c.beginPath(); c.moveTo(tailX, y); c.lineTo(headX, y); c.stroke();
    }
    c.globalAlpha = fade * 0.9;
    c.strokeStyle = 'rgb(' + col.body + ')';
    c.lineWidth = th * 2.2;
    c.beginPath(); c.moveTo(tailX, y); c.lineTo(headX, y); c.stroke();
    c.globalAlpha = fade;
    c.strokeStyle = 'rgb(' + col.core + ')';
    c.lineWidth = th;
    c.beginPath(); c.moveTo(tailX, y); c.lineTo(headX, y); c.stroke();
    c.globalAlpha = 1;
  }

  // Grey gun smoke: warm and a little dense at first, cooling to grey, fading out. Drawn with source-over so it stays grey.
  function smokeTint(f) {
    var a = f < 0.12 ? f / 0.12 * 0.5 : 0.5 * (1 - (f - 0.12) / 0.88);
    return [lerp(200, 120, f), lerp(180, 120, f), lerp(155, 125, f), a];
  }
  function trailTint(f) { return [150, 145, 140, 0.17 * (1 - f)]; }
  function drawSmoke(c, s, trail, tint) {
    c.globalCompositeOperation = 'source-over';
    stream.draw(c, s, tint || smokeTint);
    if (trail) stream.draw(c, trail, trailTint);
    c.globalCompositeOperation = 'lighter';
  }

  // A smoke ring seen edge on: a ring of soft puffs that travels forward from the muzzle, widens and fades.
  function drawRing(c, e, at, size) {
    var age = e.t - at, tp = e.turretPx, m = e.muzzles[0];
    if (age < 0 || age > 1400) return;
    var k = age / 1400, cx = m.x + tp * (0.08 + 0.42 * size * (1 - Math.exp(-age / 280))), ry = tp * size * (0.05 + 0.12 * k), rx = ry * 0.32, rad = tp * size * 0.04 * (1 + k);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 0.5 * Math.pow(1 - k, 1.3);
    var img = sprite(190, 175, 160);
    for (var i = 0; i < 18; i++) {
      var a = i / 18 * Math.PI * 2;
      c.drawImage(img, cx + Math.cos(a) * rx - rad, m.y + Math.sin(a) * ry - rad, rad * 2, rad * 2);
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'lighter';
  }

  // A shell with a muzzle flash, a smoke puff at the muzzle and a faint trail behind the shell. Smoky, Thunder, Scorpion and Tsunami share it.
  // cfg: at (ms) or times (ms, one entry per shell; shell i leaves muzzle i modulo the number of muzzles), flight (s), dist (turret widths),
  //      len, width (turret widths), head, tail (colours), flash (turret widths), shift (flash pushed forward by this share of its size, so a
  //      big flash bursts out of the barrel), flashMs, burst (puff particle count), puff (size scale), wisp (wisp rate),
  //      ring (smoke ring size, 0 for none), kick (recoil scale), gaussSmoke (true for Gauss's sparse grey wind-blown puffs instead of the
  //      warm round puff).
  function shellRecipe(cfg) {
    var times = cfg.times || [cfg.at];
    return {
      shots: times,
      muzzles: cfg.muzzles || null,
      recoilFn: function (e) { return Math.min(1.8, recoilAt(e.t, times) * cfg.kick); },
      update: function (e, dt) {
        var tp = e.turretPx, st = e.store;
        var shell = st.shell || (st.shell = bullets.create(times.length));
        var puff = st.puff || (st.puff = stream.create(320)), trail = st.trail || (st.trail = stream.create(420));
        st.n = st.n || 0;
        while (st.n < times.length && e.t >= times[st.n]) {
          var m = e.muzzles[st.n % e.muzzles.length], maxDist = Math.min(e.reach * 0.95, tp * cfg.dist), speed = maxDist / cfg.flight, len = tp * cfg.len;
          bullets.fire(shell, { x: m.x + len + tp * 0.012, y: m.y, vx: speed, vy: 0, life: maxDist / speed, len: len, width: Math.max(3, tp * cfg.width), head: cfg.head, tail: cfg.tail, born: times[st.n] });
          // the puff: a burst forward, then a thin lingering wisp at the muzzle
          if (!cfg.gaussSmoke) stream.emit(puff, { x: m.x, y: m.y, angle: 0, spread: 0.55, speed: [tp * 0.25, tp * 1.0], life: [1.2, 2.2], size: [tp * 0.025 * cfg.puff, tp * 0.1 * cfg.puff], rise: tp * 0.12, drag: 3, jitter: tp * 0.02 }, cfg.burst * 1000 / dt, dt, e.rand);
          st.last = times[st.n];
          st.lastMuzzle = m;
          st.n++;
        }
        if (cfg.gaussSmoke) {
          // Gauss's smoke: a handful of small grey puffs that rise, and a steady breeze from the front pushes them backward
          if (st.n && e.t < st.last + 450) stream.emit(puff, { x: st.lastMuzzle.x, y: st.lastMuzzle.y, angle: -1.85, spread: 0.45, speed: [tp * 0.15, tp * 0.55], life: [0.9, 1.4], size: [tp * 0.022, tp * 0.075], rise: tp * 0.08, drag: 0.9, jitter: tp * 0.03 }, 70, dt, e.rand);
          for (var wi = 0; wi < puff.p.length; wi++) puff.p[wi].vx -= tp * 0.45 * dt / 1000;
        } else if (st.n && e.t < st.last + 700) stream.emit(puff, { x: st.lastMuzzle.x, y: st.lastMuzzle.y, angle: -0.3, spread: 0.7, speed: [tp * 0.03, tp * 0.2], life: [1.0, 1.8], size: [tp * 0.02 * cfg.puff, tp * 0.07 * cfg.puff], rise: tp * 0.16, drag: 2, jitter: tp * 0.02 }, cfg.wisp, dt, e.rand);
        for (var i = 0; i < shell.p.length; i++) {
          var sh = shell.p[i];
          // the shell moves far in one step, so place each wisp somewhere along that step to keep the trail unbroken
          sh.acc = (sh.acc || 0) + 560 * dt / 1000;
          while (sh.acc >= 1) {
            sh.acc -= 1;
            stream.emit(trail, { x: sh.x - sh.len - e.rand() * sh.vx * dt / 1000, y: sh.y, angle: 0, spread: 3.1, speed: [0, tp * 0.03], life: [0.5, 0.8], size: [tp * 0.014 * cfg.puff, tp * 0.035 * cfg.puff], rise: tp * 0.05, drag: 2, jitter: tp * 0.008 }, 1000 / dt, dt, e.rand);
          }
        }
        bullets.update(shell, dt);
        stream.update(puff, dt);
        stream.update(trail, dt);
      },
      draw: function (c, e) {
        if (e.store.puff) drawSmoke(c, e.store.puff, e.store.trail, cfg.gaussSmoke ? ventTint : null);
        if (cfg.ring) drawRing(c, e, times[0], cfg.ring);
        if (e.store.shell) bullets.draw(c, e.store.shell);
        for (var i = 0; i < times.length; i++) {
          var age = e.t - times[i], m = e.muzzles[i % e.muzzles.length];
          if (age >= 0 && age < cfg.flashMs) drawFlash(c, { x: m.x + e.turretPx * cfg.flash * cfg.shift, y: m.y }, e.turretPx * cfg.flash, 1 - age / cfg.flashMs);
        }
      }
    };
  }

  // Smoky: a light shell, a small flash and a small puff.
  recipes.smoky = shellRecipe({ times: [1200, 2000, 2800, 3600], flight: 0.6, dist: 1.9, len: 0.14, width: 0.026, head: [255, 226, 130], tail: [255, 120, 30], flash: 0.11, shift: 0, flashMs: 140, burst: 46, puff: 1, wisp: 55, ring: 0, kick: 1.6, gaussSmoke: true });

  // Thunder: a heavier, slower shell, a much bigger flash and puff, a smoke ring and a hard kick.
  recipes.thunder = shellRecipe({ at: 1200, flight: 0.75, dist: 1.9, len: 0.18, width: 0.042, head: [255, 210, 110], tail: [235, 90, 20], flash: 0.2, shift: 0.45, flashMs: 200, burst: 90, puff: 1.55, wisp: 90, ring: 0, kick: 3, gaussSmoke: true });

  // Hammer: a shotgun. Five volleys in a row, both barrels at once (three yellow pellets each, with a spray of sparks and a small
  // puff), then a pause while it reloads and the five spent shells pop out of the top of the turret and fall.
  // The muzzle points are measured by eye on the turret picture: the two barrels stacked in the cap, then the ejection port.
  var HAMMER_VOLLEYS = [900, 1230, 1560, 1890, 2220], HAMMER_EJECT = [2700, 2960, 3220, 3480, 3740];
  function sparkTint(f) { return [255, lerp(225, 120, f), lerp(90, 30, f), 1 - f]; }
  recipes.hammer = {
    shots: HAMMER_VOLLEYS,
    muzzles: [[484, 58], [484, 84], [240, 28]],
    recoilFn: function (e) { return Math.min(1.8, recoilAt(e.t, HAMMER_VOLLEYS) * 1.6); },
    update: function (e, dt) {
      var tp = e.turretPx, st = e.store;
      var b = st.pellets || (st.pellets = bullets.create(90)), puff = st.puff || (st.puff = stream.create(220)), sparks = st.sparks || (st.sparks = stream.create(320));
      var cases = st.cases || (st.cases = []);
      st.vol = st.vol || 0;
      st.ej = st.ej || 0;
      while (st.vol < HAMMER_VOLLEYS.length && e.t >= HAMMER_VOLLEYS[st.vol]) {
        st.vol++;
        var dist = Math.min(e.reach * 0.9, tp * 1.1);
        // a shotgun load: seven round pellets from each barrel, in a wide cone, at slightly different speeds
        for (var i = 0; i < 14; i++) {
          var m = e.muzzles[i % 2], ang = ((Math.floor(i / 2) - 3) / 3) * 0.2 + (e.rand() - 0.5) * 0.07, speed = dist / 0.55 * (0.8 + e.rand() * 0.35), len = tp * 0.05;
          bullets.fire(b, { x: m.x + tp * 0.02, y: m.y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, life: dist / speed, len: len, r: Math.max(2.2, tp * 0.012), core: [255, 226, 110], glow: [255, 180, 50], trail: [255, 190, 60], tail: [255, 135, 30] });
        }
        for (var k = 0; k < 2; k++) {
          var mz = e.muzzles[k];
          stream.emit(sparks, { x: mz.x, y: mz.y, angle: 0, spread: 0.5, speed: [tp * 0.6, tp * 1.7], life: [0.2, 0.5], size: [tp * 0.008, tp * 0.018], drag: 2.2, jitter: tp * 0.012 }, 26000 / dt, dt, e.rand);
          stream.emit(puff, { x: mz.x, y: mz.y, angle: 0, spread: 0.6, speed: [tp * 0.15, tp * 0.6], life: [0.9, 1.6], size: [tp * 0.03, tp * 0.1], rise: tp * 0.12, drag: 3, jitter: tp * 0.02 }, 18000 / dt, dt, e.rand);
        }
      }
      while (st.ej < HAMMER_EJECT.length && e.t >= HAMMER_EJECT[st.ej]) {
        st.ej++;
        var port = e.muzzles[2];
        cases.push({ x: port.x, y: port.y, vx: -tp * (0.3 + e.rand() * 0.45), vy: -tp * (1.0 + e.rand() * 0.35), rot: e.rand() * 6.28, vr: (e.rand() < 0.5 ? -1 : 1) * (6 + e.rand() * 6), age: 0 });
      }
      for (var j = cases.length - 1; j >= 0; j--) {
        var q = cases[j], d = dt / 1000;
        q.age += d;
        if (q.age > 0.6) { cases.splice(j, 1); continue; }
        q.vy += tp * 5 * d;
        q.x += q.vx * d;
        q.y += q.vy * d;
        q.rot += q.vr * d;
      }
      bullets.update(b, dt);
      stream.update(puff, dt);
      stream.update(sparks, dt);
    },
    draw: function (c, e) {
      var tp = e.turretPx, st = e.store;
      if (st.puff) drawSmoke(c, st.puff);
      if (st.sparks) stream.draw(c, st.sparks, sparkTint);
      if (st.pellets) {
        // pellets are small solid balls with a soft glow and a short faint trail, so they read as shot and not as tracers
        for (var pi = 0; pi < st.pellets.p.length; pi++) drawBall(c, st.pellets.p[pi]);
      }
      for (var v = 0; v < HAMMER_VOLLEYS.length; v++) {
        var age = e.t - HAMMER_VOLLEYS[v];
        if (age >= 0 && age < 130) for (var m = 0; m < 2; m++) drawFlash(c, e.muzzles[m], tp * 0.08, 1 - age / 130);
      }
      // the spent shells: a brown body with a lighter brown base, tumbling, drawn solid so they do not glow
      if (st.cases && st.cases.length) {
        c.globalCompositeOperation = 'source-over';
        for (var i = 0; i < st.cases.length; i++) {
          var q = st.cases[i], w = tp * 0.14, h = tp * 0.068;
          c.save();
          c.translate(q.x, q.y);
          c.rotate(q.rot);
          c.globalAlpha = Math.min(1, (0.6 - q.age) / 0.2);
          c.fillStyle = '#6e3f1f';
          c.fillRect(-w / 2, -h / 2, w * 0.68, h);
          c.fillStyle = '#8f5d30';
          c.fillRect(-w / 2 + w * 0.68, -h / 2, w * 0.32, h);
          c.restore();
        }
        c.globalAlpha = 1;
        c.globalCompositeOperation = 'lighter';
      }
    }
  };

  // Twins: plasma balls from the two barrels in turn, a steady alternating stream with a cyan-green glow.
  // The two barrels sit one behind the other in the side view, so the muzzle points are just a little above and below the tip.
  var TWINS_SHOTS = [];
  for (var ts = 800; ts <= 3000; ts += 220) TWINS_SHOTS.push(ts);
  recipes.twins = {
    shots: TWINS_SHOTS,
    muzzles: [[533, 61.5], [533, 79.5]],
    recoilFn: function (e) { return Math.min(1, recoilAt(e.t, TWINS_SHOTS) * 0.55); },
    update: function (e, dt) {
      var tp = e.turretPx, st = e.store, b = st.balls || (st.balls = bullets.create(24));
      st.n = st.n || 0;
      while (st.n < TWINS_SHOTS.length && e.t >= TWINS_SHOTS[st.n]) {
        var m = e.muzzles[st.n % 2], dist = Math.min(e.reach * 0.95, tp * 1.9), speed = dist / 0.6 * (0.96 + e.rand() * 0.08), ang = (e.rand() - 0.5) * 0.012;
        bullets.fire(b, { x: m.x + tp * 0.02, y: m.y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, life: dist / speed, len: tp * 0.2, r: Math.max(4, tp * 0.032), core: [215, 255, 240], glow: [60, 255, 170], trail: [70, 240, 170], tail: [20, 160, 200], halo: 3.4 });
        st.n++;
      }
      bullets.update(b, dt);
    },
    draw: function (c, e) {
      var tp = e.turretPx;
      if (e.store.balls) for (var i = 0; i < e.store.balls.p.length; i++) {
        var q = e.store.balls.p[i];
        q.r = Math.max(4, tp * 0.032) * (1 + 0.1 * Math.sin(q.age * 50));
        drawBall(c, q);
      }
      for (var k = 0; k < TWINS_SHOTS.length; k++) {
        var age = e.t - TWINS_SHOTS[k];
        if (age >= 0 && age < 110) { var f = 1 - age / 110, mz = e.muzzles[k % 2]; glow(c, mz.x, mz.y, tp * 0.07, '70,255,180', 0.8 * f); glow(c, mz.x, mz.y, tp * 0.035, '225,255,245', 0.9 * f); }
      }
    }
  };

  // Ricochet: one barrel, a slower stream of orange-red plasma balls in a straight line. A small angled steel plate stands in their path,
  // and each ball that touches it throws sparks and glances off up and back, which is the turret's trademark.
  var RICO_SHOTS = [];
  for (var rs = 800; rs <= 2900; rs += 300) RICO_SHOTS.push(rs);
  var RICO_TILT = 0.21; // the plate leans this many radians to the right at the top
  function emberTint(f) { return [255, lerp(150, 50, f), lerp(40, 10, f), 0.6 * (1 - f)]; }
  function sparkOrangeTint(f) { return [255, lerp(210, 90, f), lerp(80, 20, f), 1 - f]; }
  recipes.ricochet = {
    shots: RICO_SHOTS,
    muzzles: null,
    recoilFn: function (e) { return Math.min(1, recoilAt(e.t, RICO_SHOTS) * 0.8); },
    update: function (e, dt) {
      var tp = e.turretPx, st = e.store, m = e.muzzles[0], d = dt / 1000;
      var balls = st.balls || (st.balls = []), trail = st.trail || (st.trail = stream.create(260)), sparks = st.sparks || (st.sparks = stream.create(200)), hits = st.hits || (st.hits = []);
      st.wallX = m.x + Math.min(e.reach * 0.7, tp * 1.4);
      st.n = st.n || 0;
      while (st.n < RICO_SHOTS.length && e.t >= RICO_SHOTS[st.n]) {
        st.n++;
        var speed = (st.wallX - m.x) / 0.42;
        balls.push({ x: m.x + tp * 0.06, y: m.y, vx: speed, vy: 0, age: 0, life: 1.2, len: tp * 0.26, r: Math.max(5, tp * 0.045), core: [255, 236, 205], glow: [255, 110, 30], trail: [255, 100, 30], tail: [200, 40, 10], halo: 3.4, hit: false });
      }
      for (var i = balls.length - 1; i >= 0; i--) {
        var b = balls[i];
        b.age += d;
        if (b.age >= b.life) { balls.splice(i, 1); continue; }
        b.x += b.vx * d;
        b.y += b.vy * d;
        if (!b.hit && b.x >= st.wallX - tp * 0.03) {
          // glance off the plate: reflect the velocity about the plate's normal (pointing left and up), and lose some speed
          var nx = -Math.cos(RICO_TILT), ny = -Math.sin(RICO_TILT), dot = b.vx * nx + b.vy * ny, jit = 1 + (e.rand() - 0.5) * 0.3;
          b.vx = (b.vx - 2 * dot * nx) * 0.7 * jit;
          b.vy = (b.vy - 2 * dot * ny) * 0.7 * jit;
          b.hit = true;
          b.life = b.age + 0.4;
          b.x = st.wallX - tp * 0.03;
          hits.push({ x: b.x, y: b.y, t: e.t });
          stream.emit(sparks, { x: b.x, y: b.y, angle: Math.atan2(b.vy, b.vx), spread: 0.9, speed: [tp * 0.4, tp * 1.2], life: [0.2, 0.5], size: [tp * 0.007, tp * 0.016], rise: -tp * 2, drag: 1.8, jitter: tp * 0.012 }, 22000 / dt, dt, e.rand);
        }
        e.store.acc = (e.store.acc || 0) + 120 * d;
        while (e.store.acc >= 1) {
          e.store.acc -= 1;
          stream.emit(trail, { x: b.x - e.rand() * b.vx * d, y: b.y - e.rand() * b.vy * d, angle: 0, spread: 3.1, speed: [0, tp * 0.04], life: [0.2, 0.4], size: [b.r * 0.8, b.r * 0.25], jitter: b.r * 0.2 }, 1000 / dt, dt, e.rand);
        }
      }
      stream.update(trail, dt);
      stream.update(sparks, dt);
    },
    draw: function (c, e) {
      var tp = e.turretPx, st = e.store, m = e.muzzles[0];
      if (st.wallX) {
        // the plate: dark steel with a light edge on the side the balls hit, fading in before the first shot and out after the last
        var fade = ramp(e.t, 500, 3400, 250, 500);
        if (fade > 0) {
          var w = tp * 0.075, h = tp * 0.7, heat = 0;
          for (var q = 0; q < st.hits.length; q++) { var ha = e.t - st.hits[q].t; if (ha >= 0 && ha < 300) heat = Math.max(heat, 1 - ha / 300); }
          c.save();
          c.globalCompositeOperation = 'source-over';
          c.globalAlpha = fade;
          c.translate(st.wallX, m.y);
          c.rotate(RICO_TILT);
          var g = c.createLinearGradient(-w / 2, 0, w / 2, 0);
          g.addColorStop(0, 'rgb(150,160,176)');
          g.addColorStop(0.25, 'rgb(96,104,120)');
          g.addColorStop(1, 'rgb(48,54,66)');
          c.fillStyle = g;
          c.beginPath();
          if (c.roundRect) c.roundRect(-w / 2, -h / 2, w, h, w * 0.3); else c.rect(-w / 2, -h / 2, w, h);
          c.fill();
          c.globalCompositeOperation = 'lighter';
          if (heat) { c.globalAlpha = fade * heat * 0.6; c.fillStyle = 'rgb(255,110,30)'; c.fillRect(-w / 2, -h * 0.12, w * 0.4, h * 0.24); }
          c.restore();
        }
      }
      if (st.trail) stream.draw(c, st.trail, emberTint);
      if (st.sparks) stream.draw(c, st.sparks, sparkOrangeTint);
      if (st.balls) for (var i = 0; i < st.balls.length; i++) {
        var bl = st.balls[i], base = Math.max(5, tp * 0.045);
        bl.r = base * (1 + 0.1 * Math.sin(bl.age * 45));
        drawBall(c, bl);
      }
      if (st.hits) for (var k = 0; k < st.hits.length; k++) {
        var age = e.t - st.hits[k].t;
        if (age >= 0 && age < 160) { var f = 1 - age / 160; glow(c, st.hits[k].x, st.hits[k].y, tp * 0.09, '255,120,40', 0.8 * f); glow(c, st.hits[k].x, st.hits[k].y, tp * 0.04, '255,235,200', 0.9 * f); }
      }
      for (var s = 0; s < RICO_SHOTS.length; s++) {
        var a = e.t - RICO_SHOTS[s];
        if (a >= 0 && a < 110) { var ff = 1 - a / 110; glow(c, m.x, m.y, tp * 0.08, '255,110,30', 0.8 * ff); glow(c, m.x, m.y, tp * 0.04, '255,235,205', 0.9 * ff); }
      }
    }
  };

  // Railgun: a short charge (glow growing at the muzzle, motes pulled in), then an instant bright beam that fades along its length and
  // over time, with ripples running down it. Two shots a loop, the second after a long reload.
  var RAIL_SHOTS = [1200, 2900], RAIL_CHARGE = 650, RAIL_TINT = { halo: [40, 140, 255], body: [90, 215, 255], core: [235, 252, 255] };
  recipes.railgun = {
    shots: RAIL_SHOTS,
    muzzles: null,
    recoilFn: function (e) { return Math.min(1.8, recoilAt(e.t, RAIL_SHOTS) * 2.2); },
    update: function () {},
    draw: function (c, e) {
      var tp = e.turretPx, m = e.muzzles[0];
      for (var s = 0; s < RAIL_SHOTS.length; s++) {
        var shot = RAIL_SHOTS[s], age = e.t - shot, until = shot - e.t;
        if (until > 0 && until < RAIL_CHARGE) {
          // charging: the glow swells and motes spiral in toward the muzzle
          var k = 1 - until / RAIL_CHARGE;
          glow(c, m.x, m.y, tp * (0.03 + 0.07 * k), '80,200,255', 0.4 + 0.5 * k);
          glow(c, m.x, m.y, tp * (0.012 + 0.025 * k), '230,250,255', 0.3 + 0.6 * k);
          for (var j = 0; j < 12; j++) {
            var kk = (k * 1.4 + j * 0.083) % 1, rad = tp * 0.15 * (1 - kk), ang = j * 0.52 + kk * 2.2;
            c.globalAlpha = kk * 0.9;
            c.drawImage(sprite(120, 220, 255), m.x + Math.cos(ang) * rad - tp * 0.012, m.y + Math.sin(ang) * rad - tp * 0.012, tp * 0.024, tp * 0.024);
          }
          c.globalAlpha = 1;
        }
        if (age >= 0 && age < 1000) {
          var len = e.reach * 0.98, w = tp * 0.04 * (1 - 0.6 * Math.min(1, age / 700)), a = Math.exp(-age / 300) * Math.min(1, age / 25 + 0.2);
          drawBeam(c, m.x, m.y, len, w, a, RAIL_TINT);
          // the muzzle burst
          if (age < 220) { var f = 1 - age / 220; glow(c, m.x + tp * 0.05, m.y, tp * 0.17, '70,190,255', 0.7 * f); glow(c, m.x + tp * 0.04, m.y, tp * 0.07, '235,252,255', 0.95 * f); }
          // ripples that run out along the beam one after another
          c.lineWidth = Math.max(1.2, tp * 0.006);
          for (var r = 0; r < 6; r++) {
            var ra = age - 40 - r * 55;
            if (ra < 0 || ra > 420) continue;
            var rf = ra / 420, rx = m.x + (r + 1) * len / 7, ry = tp * (0.02 + 0.09 * rf);
            c.strokeStyle = 'rgba(' + RAIL_TINT.body.join(',') + ',' + (0.7 * (1 - rf) * (1 - 0.6 * (r / 6))).toFixed(3) + ')';
            c.beginPath();
            c.ellipse(rx, m.y, ry * 0.3, ry, 0, 0, Math.PI * 2);
            c.stroke();
          }
        }
      }
    }
  };

  // Shaft: the sniper. A thin red laser sight fades in and flickers while it takes aim, then one fast red-hot shot leaves the barrel as a
  // single glowing fireball with no trail, and the sight goes out. The barrel tip glows hot while aiming and for a moment after the shot.
  var SHAFT_SHOT = 2500, SHAFT_AIM_FROM = 500;
  recipes.shaft = {
    shots: [SHAFT_SHOT],
    muzzles: null,
    recoilFn: function (e) { return Math.min(1.8, recoilAt(e.t, [SHAFT_SHOT]) * 1.9); },
    update: function (e, dt) {
      var tp = e.turretPx, st = e.store, m = e.muzzles[0], balls = st.balls || (st.balls = bullets.create(2));
      if (!st.fired && e.t >= SHAFT_SHOT) {
        st.fired = true;
        var dist = Math.min(e.reach * 0.97, tp * 2.6), speed = dist / 0.09;
        bullets.fire(balls, { x: m.x + tp * 0.05, x0: m.x + tp * 0.05, y: m.y, vx: speed, vy: 0, life: dist / speed, len: 0 });
      }
      bullets.update(balls, dt);
    },
    draw: function (c, e) {
      var tp = e.turretPx, st = e.store, m = e.muzzles[0], full = e.reach * 0.98;
      // aiming: the laser fades in, grows a little stronger and flickers, then is gone the instant the shot leaves
      if (e.t >= SHAFT_AIM_FROM && e.t < SHAFT_SHOT) {
        var k = (e.t - SHAFT_AIM_FROM) / (SHAFT_SHOT - SHAFT_AIM_FROM), flick = 0.82 + 0.18 * Math.sin(e.t * 0.09) * Math.sin(e.t * 0.31);
        drawBeam(c, m.x, m.y, full, tp * (0.0045 + 0.002 * k), Math.min(1, (e.t - SHAFT_AIM_FROM) / 300) * (0.55 + 0.35 * k) * flick, { halo: [255, 40, 30], body: [255, 70, 50], core: [255, 170, 150] });
      }
      // the shot: a thin, long glowing slug, solid from end to end with no fading tail. It grows out of the barrel, then flies as a whole.
      if (st.balls) for (var i = 0; i < st.balls.p.length; i++) {
        var q = st.balls.p[i], fade = Math.min(1, (q.life - q.age) / 0.06), L = Math.max(1, Math.min(tp * 0.3, q.x - q.x0)), tx = q.x - L, th = Math.max(1.6, tp * 0.012);
        drawSlug(c, q.x, tx, q.y, th, fade, { halo: '255,60,25', body: '255,110,45', core: '255,238,200' });
      }
      // the barrel tip: glows hot while aiming, flares at the shot, then cools
      var heat = e.t < SHAFT_SHOT ? ramp(e.t, SHAFT_AIM_FROM, SHAFT_SHOT, 500, 0) * (0.3 + 0.7 * (e.t - SHAFT_AIM_FROM) / (SHAFT_SHOT - SHAFT_AIM_FROM)) : ramp(e.t, SHAFT_SHOT, SHAFT_SHOT, 1, 900);
      if (heat > 0) { glow(c, m.x, m.y, tp * 0.07, '255,60,30', 0.75 * heat); glow(c, m.x, m.y, tp * 0.03, '255,200,150', 0.6 * heat); }
      var age = e.t - SHAFT_SHOT;
      if (age >= 0 && age < 150) { var f = 1 - age / 150; glow(c, m.x + tp * 0.04, m.y, tp * 0.13, '255,90,30', 0.85 * f); glow(c, m.x + tp * 0.03, m.y, tp * 0.055, '255,240,210', 0.95 * f); }
    }
  };

  // Gauss: two firing modes, as on the wiki. An arcade shot: a flat, long blue-violet plasma slug. Then the aimed salvo: the
  // barrel charges (a violet glow swells, motes are pulled in), and a much longer, thicker slug leaves with a hard kick and bursts with a
  // shockwave ring where it lands, since the salvo has big splash damage.
  function ventTint(f) { return [lerp(176, 140, f), lerp(178, 142, f), lerp(184, 148, f), 0.42 * (f < 0.1 ? f / 0.1 : 1 - (f - 0.1) / 0.9)]; }
  var GAUSS_ARCADE = 1200, GAUSS_CHARGE_FROM = 2700, GAUSS_SALVO = 3500;
  recipes.gauss = {
    shots: [GAUSS_ARCADE, GAUSS_SALVO],
    muzzles: null,
    recoilFn: function (e) { return Math.min(2, recoilAt(e.t, [GAUSS_ARCADE]) * 0.9 + recoilAt(e.t, [GAUSS_SALVO]) * 2.4); },
    update: function (e, dt) {
      var tp = e.turretPx, st = e.store, m = e.muzzles[0], b = st.bolts || (st.bolts = bullets.create(4));
      if (!st.arcade && e.t >= GAUSS_ARCADE) {
        st.arcade = true;
        var d1 = Math.min(e.reach * 0.95, tp * 2.2), sp1 = d1 / 0.2;
        bullets.fire(b, { x: m.x + tp * 0.05, x0: m.x + tp * 0.05, y: m.y, vx: sp1, vy: 0, life: d1 / sp1, len: 0, full: tp * 0.17, th: Math.max(1.8, tp * 0.013) });
      }
      if (!st.salvo && e.t >= GAUSS_SALVO) {
        st.salvo = true;
        var d2 = Math.min(e.reach * 0.88, tp * 2.0), sp2 = d2 / 0.18;
        st.impact = { x: m.x + d2, y: m.y, at: GAUSS_SALVO + 180 };
        bullets.fire(b, { x: m.x + tp * 0.07, x0: m.x + tp * 0.07, y: m.y, vx: sp2, vy: 0, life: d2 / sp2, len: 0, full: tp * 0.3, th: Math.max(3.4, tp * 0.027) });
      }
      var vent = st.vent || (st.vent = stream.create(560)), vx = m.x - tp * 0.66, vy = m.y - tp * 0.06;
      // and a great deal of long, dense smoke pours up out of the middle of the turret: the salvo is very powerful and drains the energy
      if (e.t >= GAUSS_SALVO && e.t < GAUSS_SALVO + 900) stream.emit(vent, { x: vx, y: vy, angle: -1.85, spread: 0.45, speed: [tp * 0.15, tp * 0.55], life: [0.9, 1.4], size: [tp * 0.022, tp * 0.075], rise: tp * 0.08, drag: 0.9, jitter: tp * 0.12 }, 70, dt, e.rand);
      // a steady breeze from the front pushes the smoke backward as it rises
      for (var wi = 0; wi < vent.p.length; wi++) vent.p[wi].vx -= tp * 0.45 * dt / 1000;
      bullets.update(b, dt);
      stream.update(vent, dt);
    },
    draw: function (c, e) {
      var tp = e.turretPx, st = e.store, m = e.muzzles[0];
      if (st.vent) {
        // the smoke is drawn solid so it stays grey instead of glowing
        c.globalCompositeOperation = 'source-over';
        stream.draw(c, st.vent, ventTint);
        c.globalCompositeOperation = 'lighter';
      }
      // charging for the salvo
      var until = GAUSS_SALVO - e.t;
      if (until > 0 && e.t >= GAUSS_CHARGE_FROM) {
        var k = 1 - until / (GAUSS_SALVO - GAUSS_CHARGE_FROM);
        glow(c, m.x, m.y, tp * (0.03 + 0.09 * k), '140,100,255', 0.35 + 0.55 * k);
        glow(c, m.x, m.y, tp * (0.012 + 0.03 * k), '236,226,255', 0.3 + 0.6 * k);
        for (var j = 0; j < 12; j++) {
          var kk = (k * 1.4 + j * 0.083) % 1, rad = tp * 0.13 * (1 - kk), ang = j * 0.52 + kk * 2.2;
          c.globalAlpha = kk * 0.9;
          c.drawImage(sprite(160, 130, 255), m.x + Math.cos(ang) * rad - tp * 0.012, m.y + Math.sin(ang) * rad - tp * 0.012, tp * 0.024, tp * 0.024);
        }
        c.globalAlpha = 1;
      }
      if (st.bolts) for (var i = 0; i < st.bolts.p.length; i++) {
        var q = st.bolts.p[i];
        // flat, long slugs that grow out of the barrel, like Shaft's shot but violet
        drawSlug(c, q.x, q.x - Math.max(1, Math.min(q.full, q.x - q.x0)), q.y, q.th * (1 + 0.06 * Math.sin(q.age * 60 + i)), Math.min(1, (q.life - q.age) / 0.06), { halo: '120,80,255', body: '150,115,255', core: '240,232,255' });
      }
      // muzzle flashes
      var shots = [GAUSS_ARCADE, GAUSS_SALVO];
      for (var s = 0; s < shots.length; s++) {
        var age = e.t - shots[s], big = s === 1;
        if (age >= 0 && age < (big ? 200 : 120)) { var f = 1 - age / (big ? 200 : 120), sz = big ? 0.15 : 0.08; glow(c, m.x + tp * 0.04, m.y, tp * sz, '120,80,255', 0.8 * f); glow(c, m.x + tp * 0.03, m.y, tp * sz * 0.45, '240,232,255', 0.95 * f); }
      }
      // the salvo's burst: a flash and an expanding shockwave ring where it lands
      if (st.impact) {
        var ia = e.t - st.impact.at;
        if (ia >= 0 && ia < 600) {
          var ik = ia / 600, x = st.impact.x, y = st.impact.y;
          if (ia < 220) { var fl = 1 - ia / 220; glow(c, x, y, tp * 0.2, '120,80,255', 0.8 * fl); glow(c, x, y, tp * 0.09, '240,232,255', 0.95 * fl); }
          c.strokeStyle = 'rgba(160,125,255,' + (0.8 * (1 - ik)).toFixed(3) + ')';
          c.lineWidth = Math.max(1.5, tp * 0.012 * (1 - ik));
          c.beginPath();
          c.ellipse(x, y, tp * (0.04 + 0.2 * ik) * 0.55, tp * (0.04 + 0.2 * ik), 0, 0, Math.PI * 2);
          c.stroke();
        }
      }
    }
  };

  // Isida: a continuous nanobot beam from the muzzle, short in range, made of three braided wavy strands with bright motes streaming
  // along it. It alternates every loop: orange-red when it damages (motes stream out to the target), green when it heals (motes stream
  // back toward the tank). A glowing node and sparks sit where the beam ends. No recoil, like the other continuous weapons.
  var ISIDA_START = 700, ISIDA_END = 3100;
  var ISIDA_MODES = {
    damage: { halo: '255,70,20', body: '255,135,45', core: '255,236,205', spark: [255, 160, 60], dir: 1 },
    heal: { halo: '30,200,90', body: '95,240,135', core: '226,255,232', spark: [120, 255, 160], dir: -1 }
  };
  recipes.isida = {
    shots: [],
    muzzles: null,
    forceMode: null, // test hook: 'damage' or 'heal' instead of alternating by loop
    recoilFn: function () { return 0; },
    update: function (e, dt) {
      var tp = e.turretPx, m = e.muzzles[0], a = ramp(e.t, ISIDA_START, ISIDA_END, 200, 280);
      var mode = ISIDA_MODES[this.forceMode || (e.cycle % 2 ? 'heal' : 'damage')], sparks = e.store.sparks || (e.store.sparks = stream.create(160));
      e.store.a = a;
      e.store.len = Math.min(e.reach * 0.85, tp * 1.05) * Math.min(1, Math.max(0, (e.t - ISIDA_START) / 220));
      if (a > 0.3) stream.emit(sparks, { x: m.x + e.store.len, y: m.y, angle: mode.dir > 0 ? -0.4 : -1.57, spread: mode.dir > 0 ? 1.6 : 0.8, speed: [tp * 0.1, tp * 0.45], life: [0.25, 0.55], size: [tp * 0.011, tp * 0.003], rise: mode.dir > 0 ? 0 : tp * 0.2, drag: 2, jitter: tp * 0.012 }, 70 * a, dt, e.rand);
      stream.update(sparks, dt);
    },
    draw: function (c, e) {
      var tp = e.turretPx, m = e.muzzles[0], st = e.store, a = st.a || 0, len = st.len || 0;
      var mode = ISIDA_MODES[this.forceMode || (e.cycle % 2 ? 'heal' : 'damage')];
      if (st.sparks) stream.draw(c, st.sparks, function (f) { return [mode.spark[0], mode.spark[1], mode.spark[2], 1 - f]; });
      if (a <= 0 || len < 2) return;
      var N = 44, ph = e.t * 0.011;
      // the point on strand k at fraction u along the beam: a travelling sine wave, pinned at the muzzle and loose at the far end
      var pt = function (u, k) {
        var amp = tp * 0.032 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.5 + 0.0)) , 0.8) * (u < 0.1 ? u / 0.1 : 1);
        return { x: m.x + u * len, y: m.y + amp * Math.sin(u * 14 - ph * 2 + k * 2.1) * (0.8 + 0.2 * Math.sin(ph * 0.7 + k)) };
      };
      c.lineCap = 'round';
      c.lineJoin = 'round';
      for (var layer = 0; layer < 3; layer++) {
        for (var k = 0; k < 3; k++) {
          if (layer === 2 && k > 0) break;
          c.strokeStyle = 'rgba(' + (layer === 0 ? mode.halo : layer === 1 ? mode.body : mode.core) + ',' + (a * (layer === 0 ? 0.16 : layer === 1 ? 0.7 : 0.95)).toFixed(3) + ')';
          c.lineWidth = tp * (layer === 0 ? 0.034 : layer === 1 ? 0.011 : 0.006);
          c.beginPath();
          for (var i = 0; i <= N; i++) { var q = pt(i / N, layer === 2 ? 1 : k); if (i) c.lineTo(q.x, q.y); else c.moveTo(q.x, q.y); }
          c.stroke();
        }
      }
      // motes streaming along the beam
      for (var j = 0; j < 14; j++) {
        var u = (e.t * 0.0011 * mode.dir + j / 14) % 1; if (u < 0) u += 1;
        var p = pt(u, j % 3);
        c.globalAlpha = a * (0.4 + 0.6 * Math.sin(Math.PI * u));
        c.drawImage(sprite(mode.spark[0], mode.spark[1], mode.spark[2]), p.x - tp * 0.017, p.y - tp * 0.017, tp * 0.034, tp * 0.034);
      }
      c.globalAlpha = 1;
      // the muzzle glow and the node where the beam ends
      glow(c, m.x, m.y, tp * 0.05, mode.halo, 0.7 * a);
      var pulse = 1 + 0.15 * Math.sin(e.t * 0.03), tip = pt(1, 0);
      glow(c, tip.x, tip.y, tp * 0.09 * pulse, mode.halo, 0.7 * a);
      glow(c, tip.x, tip.y, tp * 0.04 * pulse, mode.core, 0.9 * a);
    }
  };

  // A jagged lightning path from (ax, ay) to (bx, by): repeated midpoint displacement, so every call with a fresh seed gives a new bolt.
  function jaggedPath(ax, ay, bx, by, rand, rough) {
    var pts = [{ x: ax, y: ay }, { x: bx, y: by }];
    for (var it = 0; it < 5; it++) {
      var out = [pts[0]];
      for (var i = 1; i < pts.length; i++) {
        var p0 = pts[i - 1], p1 = pts[i], dx = p1.x - p0.x, dy = p1.y - p0.y, l = Math.sqrt(dx * dx + dy * dy) || 1, d = (rand() - 0.5) * l * rough;
        out.push({ x: (p0.x + p1.x) / 2 - dy / l * d, y: (p0.y + p1.y) / 2 + dx / l * d });
        out.push(p1);
      }
      pts = out;
    }
    return pts;
  }
  function strokePath(c, pts) {
    c.beginPath();
    for (var i = 0; i < pts.length; i++) { if (i) c.lineTo(pts[i].x, pts[i].y); else c.moveTo(pts[i].x, pts[i].y); }
    c.stroke();
  }

  // Tesla: chain lightning. Two jagged blue-white bolts leave the two prong tips on the front of the housing and reach forward, throwing
  // short forks off to the side. The whole bolt is redrawn with a fresh random shape about 18 times a second, so it flickers and crackles,
  // and each prong tip glows. Short range, no recoil. The two prong points are measured by eye on the turret picture.
  var TESLA_START = 700, TESLA_END = 3100;
  recipes.tesla = {
    shots: [],
    muzzles: [[557, 72], [557, 110]],
    recoilFn: function () { return 0; },
    update: function () {},
    draw: function (c, e) {
      var tp = e.turretPx, a = ramp(e.t, TESLA_START, TESLA_END, 150, 250);
      if (a <= 0) return;
      var fr = Math.floor(e.t / 55), rand = makeRand(fr * 7919 + 17), len = Math.min(e.reach * 0.85, tp * 1.0) * Math.min(1, (e.t - TESLA_START + 200) / 260);
      var flick = 0.75 + 0.25 * rand();
      var tints = [['50,120,255', '125,195,255', '238,246,255']];
      var ends = [{ x: e.muzzles[0].x + len, y: e.muzzles[0].y - tp * 0.035 }, { x: e.muzzles[1].x + len * 0.92, y: e.muzzles[1].y + tp * 0.04 }];
      c.lineCap = 'round';
      c.lineJoin = 'round';
      for (var k = 0; k < 2; k++) {
        var A = e.muzzles[k], B = ends[k], main = jaggedPath(A.x, A.y, B.x, B.y, rand, 0.17), forks = [];
        // forks: a few short side branches from points along the bolt
        for (var f = 0; f < 3; f++) {
          var at = main[Math.floor((0.25 + rand() * 0.6) * (main.length - 1))], ang = (rand() < 0.5 ? -1 : 1) * (0.4 + rand() * 0.5), fl = tp * (0.12 + rand() * 0.2);
          forks.push(jaggedPath(at.x, at.y, at.x + Math.cos(ang) * fl, at.y + Math.sin(ang) * fl, rand, 0.3));
        }
        var paths = [main].concat(forks);
        for (var layer = 0; layer < 3; layer++) {
          c.strokeStyle = 'rgba(' + tints[0][layer] + ',' + (a * flick * (layer === 0 ? 0.2 : layer === 1 ? 0.75 : 0.95)).toFixed(3) + ')';
          for (var q = 0; q < paths.length; q++) {
            c.lineWidth = tp * (layer === 0 ? 0.03 : layer === 1 ? 0.011 : 0.005) * (q ? 0.6 : 1);
            strokePath(c, paths[q]);
          }
        }
        glow(c, A.x, A.y, tp * 0.06 * (0.8 + 0.4 * rand()), '70,140,255', 0.8 * a);
        glow(c, A.x, A.y, tp * 0.026, '235,245,255', 0.9 * a);
        glow(c, B.x, B.y, tp * 0.05 * (0.8 + 0.4 * rand()), '70,140,255', 0.6 * a);
      }
    }
  };

  // A rocket seen from the side: a grey body with a red nose, nose to the right. Drawn solid, centred on (0, 0) in its own frame.
  function drawRocketBody(c, len, th, nose) {
    c.fillStyle = 'rgb(150,156,166)';
    c.beginPath();
    if (c.roundRect) c.roundRect(-len * 0.5, -th / 2, len * 0.72, th, th * 0.3); else c.rect(-len * 0.5, -th / 2, len * 0.72, th);
    c.fill();
    c.fillStyle = 'rgb(96,102,114)';
    c.fillRect(-len * 0.5, -th / 2, len * 0.14, th);
    c.fillStyle = nose || 'rgb(220,50,40)';
    c.beginPath();
    c.moveTo(len * 0.2, -th / 2);
    c.lineTo(len * 0.5, 0);
    c.lineTo(len * 0.2, th / 2);
    c.closePath();
    c.fill();
    c.fillStyle = 'rgb(120,126,138)';
    c.beginPath();
    c.moveTo(-len * 0.5, -th / 2); c.lineTo(-len * 0.62, -th * 1.1); c.lineTo(-len * 0.32, -th / 2);
    c.moveTo(-len * 0.5, th / 2); c.lineTo(-len * 0.62, th * 1.1); c.lineTo(-len * 0.32, th / 2);
    c.fill();
  }
  function rocketSmokeTint(f) { return [lerp(205, 150, f), lerp(200, 148, f), lerp(195, 148, f), 0.34 * (f < 0.08 ? f / 0.08 : 1 - (f - 0.08) / 0.92)]; }

  // Striker: a salvo of guided rockets. Ten rockets leave the two pods on the front of the launcher one after another, slowly at first and
  // accelerating, each with a bright exhaust flame and a long grey smoke trail, with a small backblast puff at the pod. Where each
  // rocket reaches the end of its range it bursts. The two pod mouths are measured by eye on the turret picture.
  var STRIKER_SHOTS = [];
  for (var sk = 700; sk <= 2500; sk += 200) STRIKER_SHOTS.push(sk);
  recipes.striker = {
    shots: STRIKER_SHOTS,
    muzzles: [[284, 52], [266, 89]],
    recoilFn: function (e) { return Math.min(1.5, recoilAt(e.t, STRIKER_SHOTS) * 0.55); },
    update: function (e, dt) {
      var tp = e.turretPx, st = e.store, d = dt / 1000;
      var rockets = st.rockets || (st.rockets = []), smoke = st.smoke || (st.smoke = stream.create(1900)), blast = st.blast || (st.blast = stream.create(160)), bursts = st.bursts || (st.bursts = []);
      st.n = st.n || 0;
      while (st.n < STRIKER_SHOTS.length && e.t >= STRIKER_SHOTS[st.n]) {
        var pod = e.muzzles[st.n % 2], dist = Math.min(e.reach * 0.93, tp * 2.1) - tp * 0.12, flight = 0.55 + e.rand() * 0.04, v0 = tp * 2.2;
        rockets.push({ x: pod.x + tp * 0.14, y: pod.y, x0: pod.x, y0: pod.y, v0: v0, a: 2 * (dist - v0 * flight) / (flight * flight), age: 0, life: flight, ph: e.rand() * 6.28 });
        stream.emit(blast, { x: pod.x, y: pod.y, angle: Math.PI, spread: 0.9, speed: [tp * 0.1, tp * 0.45], life: [0.4, 0.8], size: [tp * 0.03, tp * 0.09], rise: tp * 0.1, drag: 3, jitter: tp * 0.01 }, 14000 / dt, dt, e.rand);
        st.n++;
      }
      for (var i = rockets.length - 1; i >= 0; i--) {
        var r = rockets[i], px = r.x;
        r.age += d;
        if (r.age >= r.life) { bursts.push({ x: r.x, y: r.y, t: e.t }); rockets.splice(i, 1); continue; }
        r.vx = r.v0 + r.a * r.age;
        r.x = r.x0 + tp * 0.14 + r.v0 * r.age + 0.5 * r.a * r.age * r.age;
        r.y = r.y0 - tp * 0.02 * Math.min(1, r.age / 0.3) + tp * 0.004 * Math.sin(r.age * 22 + r.ph);
        r.ang = Math.atan2(r.y - (r.py === undefined ? r.y : r.py), Math.max(0.001, r.x - px)) ;
        r.py = r.y;
        // smoke from the tail, spread along the distance moved in this step so the trail has no gaps
        r.acc = (r.acc || 0) + 420 * d;
        while (r.acc >= 1) {
          r.acc -= 1;
          stream.emit(smoke, { x: r.x - tp * 0.2 - e.rand() * (r.x - px), y: r.y, angle: 0, spread: 3.1, speed: [0, tp * 0.05], life: [0.9, 1.4], size: [tp * 0.034, tp * 0.1], rise: tp * 0.06, drag: 2, jitter: tp * 0.008 }, 1000 / dt, dt, e.rand);
        }
      }
      while (bursts.length && e.t - bursts[0].t > 600) bursts.shift();
      stream.update(smoke, dt);
      stream.update(blast, dt);
    },
    draw: function (c, e) {
      var tp = e.turretPx, st = e.store;
      c.globalCompositeOperation = 'source-over';
      if (st.smoke) stream.draw(c, st.smoke, rocketSmokeTint);
      if (st.blast) stream.draw(c, st.blast, rocketSmokeTint);
      c.globalCompositeOperation = 'lighter';
      var rk = st.rockets || [], i;
      for (i = 0; i < rk.length; i++) {
        var r = rk[i], fl = 1 + 0.2 * Math.sin(e.t * 0.08 + i * 2);
        c.save();
        c.translate(r.x, r.y);
        c.rotate(r.ang || 0);
        // exhaust flame: a hot glow and a short tapered flame behind the tail
        glow(c, -tp * 0.2, 0, tp * 0.12 * fl, '255,150,40', 0.9);
        glow(c, -tp * 0.17, 0, tp * 0.06 * fl, '255,240,200', 0.95);
        c.drawImage(sprite(255, 170, 60), -tp * 0.5 * fl, -tp * 0.03, tp * 0.36 * fl, tp * 0.06);
        c.restore();
      }
      c.globalCompositeOperation = 'source-over';
      for (i = 0; i < rk.length; i++) {
        var q = rk[i];
        c.save();
        c.translate(q.x, q.y);
        c.rotate(q.ang || 0);
        drawRocketBody(c, tp * 0.32, tp * 0.088);
        c.restore();
      }
      c.globalCompositeOperation = 'lighter';
      // launch flashes at the pods, and the burst where a rocket reaches the end of its range
      for (var s = 0; s < STRIKER_SHOTS.length; s++) {
        var age = e.t - STRIKER_SHOTS[s];
        if (age >= 0 && age < 110) { var f = 1 - age / 110, pod = e.muzzles[s % 2]; glow(c, pod.x, pod.y, tp * 0.07, '255,140,40', 0.8 * f); glow(c, pod.x, pod.y, tp * 0.03, '255,240,200', 0.95 * f); }
      }
      var bs = st.bursts || [];
      for (i = 0; i < bs.length; i++) {
        var ba = e.t - bs[i].t, bk = ba / 600;
        glow(c, bs[i].x, bs[i].y, tp * (0.06 + 0.16 * bk), '255,120,40', 0.85 * (1 - bk));
        if (ba < 200) glow(c, bs[i].x, bs[i].y, tp * 0.06, '255,240,205', 0.95 * (1 - ba / 200));
      }
    }
  };

  // Scorpion: two firing modes, as on the wiki. First the long barrel fires a normal shell like Smoky's but of a bigger calibre, with a hard
  // kick. Then two lines of four rockets climb out above the round hatch on top of the turret (the launcher), arcs over and drops onto the ground
  // line far ahead, each landing in a flash, a low shockwave and a puff of dust. Amber exhaust and thick grey smoke trails. The hatch point is
  // measured by eye on the turret picture, and the barrel tip is the default muzzle.
  var SCORPION_SHELL_AT = 800, SCORPION_SHOTS = [1500, 1620, 1880, 2000, 2260, 2380, 2640, 2760]; // two lines of four, the right line 120 ms behind the left
  var scorpionShell = shellRecipe({ at: SCORPION_SHELL_AT, flight: 0.5, dist: 2.2, len: 0.13, width: 0.04, head: [255, 226, 130], tail: [255, 120, 30], flash: 0.15, shift: 0.25, flashMs: 170, burst: 62, puff: 1.2, wisp: 62, ring: 0, kick: 2.6, gaussSmoke: true });
  function dustTint(f) { return [lerp(190, 135, f), lerp(175, 130, f), lerp(155, 125, f), 0.5 * (f < 0.1 ? f / 0.1 : 1 - (f - 0.1) / 0.9)]; }
  recipes.scorpion = {
    shots: [SCORPION_SHELL_AT],
    muzzles: [[798.6, 90.9], [152, -45], [265, -45]],
    recoilFn: function (e) { return scorpionShell.recoilFn(e); },
    update: function (e, dt) {
      scorpionShell.update(e, dt);
      var tp = e.turretPx, st = e.store, tip = e.muzzles[0], d = dt / 1000;
      var rockets = st.rockets || (st.rockets = []), smoke = st.smoke || (st.smoke = stream.create(1200)), dust = st.dust || (st.dust = stream.create(300)), blast = st.blast || (st.blast = stream.create(260)), lands = st.lands || (st.lands = []);
      var gy = e.groundY - tp * 0.02;
      st.n = st.n || 0;
      while (st.n < SCORPION_SHOTS.length && e.t >= SCORPION_SHOTS[st.n]) {
        // a lob from the hatch: it climbs to a peak, then drops onto the ground line ahead of the barrel. g follows from the peak height h and the drop D.
        var line = st.n % 2, wave = Math.floor(st.n / 2), m = e.muzzles[1 + line];
        var dist = tip.x + e.reach * (0.74 + 0.12 * wave / 3 + 0.07 * line) - m.x, T = 1.25, h = Math.max(tp * 0.2, dist * 0.17) * (1 + 0.15 * (wave % 2)), D = gy - m.y, sg = (Math.sqrt(2 * h) + Math.sqrt(2 * h + 2 * D)) / T, g = sg * sg;
        rockets.push({ x0: m.x, y0: m.y, vx: dist / T, vy0: -Math.sqrt(2 * g * h), g: g, age: 0, life: T, ph: e.rand() * 6.28 });
        stream.emit(blast, { x: m.x, y: m.y, angle: -1.57, spread: 0.5, speed: [tp * 0.1, tp * 0.4], life: [0.6, 1.1], size: [tp * 0.02, tp * 0.06], rise: tp * 0.1, drag: 3, jitter: tp * 0.012 }, 14000 / dt, dt, e.rand);
        st.n++;
      }
      for (var i = rockets.length - 1; i >= 0; i--) {
        var r = rockets[i], px = r.x === undefined ? r.x0 : r.x, py = r.y === undefined ? r.y0 : r.y;
        r.age += d;
        if (r.age >= r.life) {
          lands.push({ x: r.x, t: e.t });
          stream.emit(dust, { x: r.x, y: gy, angle: -1.57, spread: 1.1, speed: [tp * 0.1, tp * 0.45], life: [0.8, 1.4], size: [tp * 0.02, tp * 0.065], rise: -tp * 0.07, drag: 2.5, jitter: tp * 0.035 }, 34000 / dt, dt, e.rand);
          rockets.splice(i, 1);
          continue;
        }
        r.x = r.x0 + r.vx * r.age;
        r.y = r.y0 + r.vy0 * r.age + 0.5 * r.g * r.age * r.age;
        r.ang = Math.atan2(r.y - py, Math.max(0.001, r.x - px));
        r.acc = (r.acc || 0) + 300 * d;
        while (r.acc >= 1) {
          r.acc -= 1;
          var back = e.rand();
          stream.emit(smoke, { x: r.x - Math.cos(r.ang) * tp * 0.08 - back * (r.x - px), y: r.y - Math.sin(r.ang) * tp * 0.08 - back * (r.y - py), angle: 0, spread: 3.1, speed: [0, tp * 0.04], life: [1.0, 1.5], size: [tp * 0.018, tp * 0.055], rise: tp * 0.05, drag: 2, jitter: tp * 0.01 }, 1000 / dt, dt, e.rand);
        }
      }
      while (lands.length && e.t - lands[0].t > 700) lands.shift();
      stream.update(smoke, dt);
      stream.update(dust, dt);
      stream.update(blast, dt);
    },
    draw: function (c, e) {
      scorpionShell.draw(c, e);
      var tp = e.turretPx, st = e.store, i;
      c.globalCompositeOperation = 'source-over';
      if (st.smoke) stream.draw(c, st.smoke, rocketSmokeTint);
      if (st.blast) stream.draw(c, st.blast, rocketSmokeTint);
      if (st.dust) stream.draw(c, st.dust, dustTint);
      c.globalCompositeOperation = 'lighter';
      var rk = st.rockets || [];
      for (i = 0; i < rk.length; i++) {
        var r = rk[i], fl = 1 + 0.2 * Math.sin(e.t * 0.08 + i * 2);
        if (r.x === undefined) continue;
        c.save();
        c.translate(r.x, r.y);
        c.rotate(r.ang || 0);
        glow(c, -tp * 0.08, 0, tp * 0.05 * fl, '255,170,50', 0.9);
        glow(c, -tp * 0.07, 0, tp * 0.025 * fl, '255,235,180', 0.95);
        c.drawImage(sprite(255, 190, 70), -tp * 0.22 * fl, -tp * 0.013, tp * 0.16 * fl, tp * 0.026);
        c.restore();
      }
      c.globalCompositeOperation = 'source-over';
      for (i = 0; i < rk.length; i++) {
        var q = rk[i];
        if (q.x === undefined) continue;
        c.save();
        c.translate(q.x, q.y);
        c.rotate(q.ang || 0);
        drawRocketBody(c, tp * 0.14, tp * 0.04, 'rgb(236,160,40)');
        c.restore();
      }
      c.globalCompositeOperation = 'lighter';
      // the launch flash at the hatch, and the landings
      for (var sIdx = 0; sIdx < SCORPION_SHOTS.length; sIdx++) {
        var age = e.t - SCORPION_SHOTS[sIdx];
        if (age >= 0 && age < 160) { var f = 1 - age / 160, hm = e.muzzles[1 + sIdx % 2]; glow(c, hm.x, hm.y, tp * 0.09, '255,160,50', 0.85 * f); glow(c, hm.x, hm.y, tp * 0.04, '255,240,200', 0.95 * f); }
      }
      var gy = e.groundY - tp * 0.02, ls = st.lands || [];
      for (i = 0; i < ls.length; i++) {
        var la = e.t - ls[i].t, k = la / 700;
        if (la < 220) { var fl2 = 1 - la / 220; glow(c, ls[i].x, gy, tp * 0.13, '255,150,40', 0.85 * fl2); glow(c, ls[i].x, gy, tp * 0.06, '255,240,205', 0.95 * fl2); }
        c.strokeStyle = 'rgba(255,190,100,' + (0.6 * (1 - k)).toFixed(3) + ')';
        c.lineWidth = Math.max(1.5, tp * 0.012 * (1 - k));
        c.beginPath();
        c.ellipse(ls[i].x, gy, tp * (0.04 + 0.2 * k), tp * (0.01 + 0.035 * k), 0, 0, Math.PI * 2);
        c.stroke();
      }
    }
  };

  // Tsunami: a two-shot combo, as on the wiki. The first shell is fired by hand from the upper barrel and the second follows by itself from
  // the lower barrel a moment later. Both are ordinary shells, like Smoky's and Thunder's, with a muzzle flash, a puff of smoke and a trail.
  // Two combos per loop with a long pause between them. The two barrel points are measured by eye on the turret picture.
  recipes.tsunami = shellRecipe({ times: [1200, 1450, 3200, 3450], muzzles: [[609, 50], [609, 66]], flight: 0.5, dist: 2.1, len: 0.11, width: 0.03, head: [255, 226, 130], tail: [255, 120, 30], flash: 0.1, shift: 0.35, flashMs: 150, burst: 50, puff: 1.05, wisp: 55, ring: 0, kick: 1.5, gaussSmoke: true });

  // Magnum: the barrel is level, so it fires like Thunder: a heavy shell flies straight out of the barrel, with a huge flash, Gauss-style grey
  // wind-blown smoke at the barrel tip and a hard kick, but where Thunder's shell just fades out the Magnum shell bursts at the end of its range, for its very
  // large splash: a big flash, a round shockwave, fast sparks and a lingering cloud. Two shells a loop, with a long reload between them.
  var MAGNUM_SHOTS = [1000, 2900], MAGNUM_FLIGHT = 0.7, MAGNUM_DIST = 2.2;
  function magnumDustTint(f) { return [lerp(200, 140, f), lerp(185, 135, f), lerp(160, 128, f), 0.5 * (f < 0.1 ? f / 0.1 : 1 - (f - 0.1) / 0.9)]; }
  function magnumSparkTint(f) { return [255, lerp(200, 80, f), lerp(80, 20, f), 1 - f]; }
  var magnumShell = shellRecipe({ times: MAGNUM_SHOTS, flight: MAGNUM_FLIGHT, dist: MAGNUM_DIST, len: 0.2, width: 0.05, head: [255, 214, 120], tail: [235, 90, 20], flash: 0.2, shift: 0.6, flashMs: 210, burst: 100, puff: 1.6, wisp: 100, ring: 0, kick: 3.2, gaussSmoke: true });
  recipes.magnum = {
    shots: MAGNUM_SHOTS,
    muzzles: null,
    recoilFn: function (e) { return magnumShell.recoilFn(e); },
    update: function (e, dt) {
      magnumShell.update(e, dt);
      var tp = e.turretPx, st = e.store, m = e.muzzles[0];
      var sparks = st.sparks || (st.sparks = stream.create(220)), dust = st.dust || (st.dust = stream.create(300));
      st.nb = st.nb || 0;
      while (st.nb < MAGNUM_SHOTS.length && e.t >= MAGNUM_SHOTS[st.nb] + MAGNUM_FLIGHT * 1000) {
        var x = m.x + Math.min(e.reach * 0.95, tp * MAGNUM_DIST);
        (st.bursts || (st.bursts = [])).push({ x: x, y: m.y, t: MAGNUM_SHOTS[st.nb] + MAGNUM_FLIGHT * 1000 });
        stream.emit(sparks, { x: x, y: m.y, angle: 0, spread: 3.14, speed: [tp * 0.4, tp * 1.4], life: [0.3, 0.7], size: [tp * 0.012, tp * 0.004], drag: 1.6, jitter: tp * 0.03 }, 60000 / dt, dt, e.rand);
        stream.emit(dust, { x: x, y: m.y, angle: 0, spread: 3.14, speed: [tp * 0.1, tp * 0.5], life: [0.9, 1.4], size: [tp * 0.04, tp * 0.12], rise: tp * 0.04, drag: 2.2, jitter: tp * 0.07 }, 50000 / dt, dt, e.rand);
        st.nb++;
      }
      stream.update(sparks, dt);
      stream.update(dust, dt);
    },
    draw: function (c, e) {
      var tp = e.turretPx, st = e.store, bs = st.bursts || [], i;
      c.globalCompositeOperation = 'source-over';
      if (st.dust) stream.draw(c, st.dust, magnumDustTint);
      c.globalCompositeOperation = 'lighter';
      magnumShell.draw(c, e);
      if (st.sparks) stream.draw(c, st.sparks, magnumSparkTint);
      for (i = 0; i < bs.length; i++) {
        var la = e.t - bs[i].t, k = la / 800;
        if (la < 0 || la > 800) continue;
        if (la < 260) { var fl = 1 - la / 260; glow(c, bs[i].x, bs[i].y, tp * 0.28, '255,140,40', 0.85 * fl); glow(c, bs[i].x, bs[i].y, tp * 0.12, '255,240,205', 0.95 * fl); }
        c.strokeStyle = 'rgba(255,200,120,' + (0.7 * (1 - k)).toFixed(3) + ')';
        c.lineWidth = Math.max(1.5, tp * 0.016 * (1 - k));
        c.beginPath();
        c.arc(bs[i].x, bs[i].y, tp * (0.05 + 0.3 * k), 0, Math.PI * 2);
        c.stroke();
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
    applyRecoil(recipe.recoilFn ? recipe.recoilFn(env) : recoilAt(env.t, recipe.shots || []));
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
    cycleMs: CYCLE_MS,
    helpers: { glow: glow, drawFlash: drawFlash, lerp: lerp, ramp: ramp, sprite: sprite, stream: stream, bullets: bullets },

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
