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
  // flash and a light steady shake instead of a single kick.
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
    },
    draw: function (c, e) {
      var tp = e.turretPx, m = e.muzzles[0], flashes = e.store.flashes || [];
      if (e.store.bullets) bullets.draw(c, e.store.bullets);
      for (var i = 0; i < flashes.length; i++) drawFlash(c, { x: m.x, y: m.y + ((i * 37 % 7) - 3) * tp * 0.01 }, tp * 0.045, 1 - (e.t - flashes[i]) / 70);
    }
  };

  // A round projectile: a soft glow, a solid core and a short fading trail. Hammer's pellets and Twins' plasma use it.
  // b: x, y, vx, vy, age, life, len (px of trail), r (core radius px), core, glow, trail, tail (colours [r, g, b]), halo (glow radius in cores).
  function drawBall(c, b) {
    var fade = Math.min(1, (b.life - b.age) / 0.1), sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy), r = b.r, tx = b.x - b.vx / sp * b.len, ty = b.y - b.vy / sp * b.len;
    var g = c.createLinearGradient(tx, ty, b.x, b.y), halo = b.halo || 2.6;
    g.addColorStop(0, 'rgba(' + b.tail.join(',') + ',0)');
    g.addColorStop(1, 'rgba(' + b.trail.join(',') + ',' + (0.7 * fade).toFixed(3) + ')');
    c.strokeStyle = g;
    c.lineWidth = r * 0.9;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(tx, ty);
    c.lineTo(b.x, b.y);
    c.stroke();
    c.globalAlpha = fade * 0.75;
    c.drawImage(sprite(b.glow[0], b.glow[1], b.glow[2]), b.x - r * halo, b.y - r * halo, r * halo * 2, r * halo * 2);
    c.globalAlpha = fade;
    c.fillStyle = 'rgb(' + b.core.join(',') + ')';
    c.beginPath();
    c.arc(b.x, b.y, r, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;
  }

  // Grey gun smoke: warm and a little dense at first, cooling to grey, fading out. Drawn with source-over so it stays grey.
  function smokeTint(f) {
    var a = f < 0.12 ? f / 0.12 * 0.5 : 0.5 * (1 - (f - 0.12) / 0.88);
    return [lerp(200, 120, f), lerp(180, 120, f), lerp(155, 125, f), a];
  }
  function trailTint(f) { return [150, 145, 140, 0.17 * (1 - f)]; }
  function drawSmoke(c, s, trail) {
    c.globalCompositeOperation = 'source-over';
    stream.draw(c, s, smokeTint);
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

  // A single shell with a muzzle flash, a smoke puff at the muzzle and a faint trail behind the shell. Smoky and Thunder share it.
  // cfg: at (ms), flight (s), dist (turret widths), len, width (turret widths), head, tail (colours), flash (turret widths),
  //      shift (flash pushed forward by this share of its size, so a big flash bursts out of the barrel), flashMs, burst (puff particle count), puff (size scale), wisp (wisp rate), ring (smoke ring size, 0 for none), kick (recoil scale).
  function shellRecipe(cfg) {
    return {
      shots: [cfg.at],
      muzzles: null,
      recoilFn: function (e) { return Math.min(1.8, recoilAt(e.t, [cfg.at]) * cfg.kick); },
      update: function (e, dt) {
        var tp = e.turretPx, m = e.muzzles[0];
        var shell = e.store.shell || (e.store.shell = bullets.create(1));
        var puff = e.store.puff || (e.store.puff = stream.create(320)), trail = e.store.trail || (e.store.trail = stream.create(420));
        if (!e.store.fired && e.t >= cfg.at) {
          e.store.fired = true;
          var maxDist = Math.min(e.reach * 0.95, tp * cfg.dist), speed = maxDist / cfg.flight, len = tp * cfg.len;
          bullets.fire(shell, { x: m.x + len + tp * 0.012, y: m.y, vx: speed, vy: 0, life: maxDist / speed, len: len, width: Math.max(3, tp * cfg.width), head: cfg.head, tail: cfg.tail });
          // the puff: a burst forward, then a thin lingering wisp at the muzzle
          stream.emit(puff, { x: m.x, y: m.y, angle: 0, spread: 0.55, speed: [tp * 0.25, tp * 1.0], life: [1.2, 2.2], size: [tp * 0.025 * cfg.puff, tp * 0.1 * cfg.puff], rise: tp * 0.12, drag: 3, jitter: tp * 0.02 }, cfg.burst * 1000 / dt, dt, e.rand);
        }
        if (e.store.fired && e.t < cfg.at + 700) stream.emit(puff, { x: m.x, y: m.y, angle: -0.3, spread: 0.7, speed: [tp * 0.03, tp * 0.2], life: [1.0, 1.8], size: [tp * 0.02 * cfg.puff, tp * 0.07 * cfg.puff], rise: tp * 0.16, drag: 2, jitter: tp * 0.02 }, cfg.wisp, dt, e.rand);
        if (shell.p.length && e.t < cfg.at + cfg.flight * 1000 + 100) {
          var sh = shell.p[0];
          // the shell moves far in one step, so place each wisp somewhere along that step to keep the trail unbroken
          e.store.trailAcc = (e.store.trailAcc || 0) + 560 * dt / 1000;
          while (e.store.trailAcc >= 1) {
            e.store.trailAcc -= 1;
            stream.emit(trail, { x: sh.x - sh.len - e.rand() * sh.vx * dt / 1000, y: sh.y, angle: 0, spread: 3.1, speed: [0, tp * 0.03], life: [0.5, 0.8], size: [tp * 0.014 * cfg.puff, tp * 0.035 * cfg.puff], rise: tp * 0.05, drag: 2, jitter: tp * 0.008 }, 1000 / dt, dt, e.rand);
          }
        }
        bullets.update(shell, dt);
        stream.update(puff, dt);
        stream.update(trail, dt);
      },
      draw: function (c, e) {
        var age = e.t - cfg.at;
        if (e.store.puff) drawSmoke(c, e.store.puff, e.store.trail);
        if (cfg.ring) drawRing(c, e, cfg.at, cfg.ring);
        if (e.store.shell) bullets.draw(c, e.store.shell);
        if (age >= 0 && age < cfg.flashMs) drawFlash(c, { x: e.muzzles[0].x + e.turretPx * cfg.flash * cfg.shift, y: e.muzzles[0].y }, e.turretPx * cfg.flash, 1 - age / cfg.flashMs);
      }
    };
  }

  // Smoky: a light shell, a small flash and a small puff.
  recipes.smoky = shellRecipe({ at: 1200, flight: 0.6, dist: 1.9, len: 0.14, width: 0.026, head: [255, 226, 130], tail: [255, 120, 30], flash: 0.11, shift: 0, flashMs: 140, burst: 46, puff: 1, wisp: 55, ring: 0, kick: 1.6 });

  // Thunder: a heavier, slower shell, a much bigger flash and puff, a smoke ring and a hard kick.
  recipes.thunder = shellRecipe({ at: 1200, flight: 0.75, dist: 1.9, len: 0.18, width: 0.042, head: [255, 210, 110], tail: [235, 90, 20], flash: 0.2, shift: 0.45, flashMs: 200, burst: 90, puff: 1.55, wisp: 90, ring: 1, kick: 3 });

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
