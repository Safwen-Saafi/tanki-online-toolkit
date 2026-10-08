(function () {
  'use strict';

  /* ---------- text, English and Russian ---------- */
  var T = {
    EN: {
      title: 'Tanki Augments Database',
      desc: 'Daily-updated Tanki Online augment data in English and Russian, scraped from the Tanki Online wiki.',
      unofficial: 'Unofficial fan tool · not affiliated with Tanki Online',
      checking: 'Checking data...', live: 'Live data', partly: 'Partly available', down: 'Data unavailable',
      h1: 'Augments<br>Database',
      lead: 'Every augment for every turret and hull, scraped daily from the Tanki Online wiki in English and Russian, ready to load with one request.',
      items: 'Items', augments: 'Augments', next: 'Next scrape', updated: 'Updated', unavailable: 'unavailable',
      pick: 'Pick a language', open: 'Open file', copy: 'Copy link', copied: 'Link copied', copyPrompt: 'Copy this link:',
      garage: 'Build a tank', turrets: 'Turrets', hulls: 'Hulls',
      short: 'Short range', medium: 'Medium range', long: 'Long range',
      hullNote: 'Hull augments are shared by every hull', shared: 'shared',
      shoutTitle: 'Shoutout', clanLabel: 'Clan shoutout',
      clanText: 'Big respect to the TWIZY clan, my clan in Tanki Online. Roll out, tankers!',
      how: 'How it works',
      s1t: '1 · Scrape', s1d: 'A bot reads the EN and RU Tanki wiki augment pages once a day.',
      s2t: '2 · Validate', s2d: 'Broken or shrunken results are rejected and the last good file stays live.',
      s3t: '3 · Publish', s3d: 'Only changed files are committed here, so every patch is a readable diff.',
      foot1: 'Data comes from the community', wiki: 'Tanki Online wiki', foot2: 'Tanki Online belongs to its owners.',
      art: 'Tank images are exported from the game and belong to Tanki Online.',
      site: 'Official game site', src: 'Source on GitHub',
      aug: function (n) { return n + (n === 1 ? ' augment' : ' augments'); },
      hm: function (h, m) { return h + 'h ' + (m < 10 ? '0' : '') + m + 'm'; },
      heroLabel: function (name) { return 'Tank: ' + name; }
    },
    RU: {
      title: 'База устройств Tanki',
      desc: 'Ежедневно обновляемые данные об устройствах Tanki Online на английском и русском, собранные с вики Tanki Online.',
      unofficial: 'Неофициальный фан-проект · не связан с Tanki Online',
      checking: 'Проверка данных...', live: 'Данные актуальны', partly: 'Доступно частично', down: 'Данные недоступны',
      h1: 'База<br>устройств',
      lead: 'Все устройства для каждой пушки и корпуса, раз в день собранные с вики Tanki Online на английском и русском и готовые к загрузке одним запросом.',
      items: 'Предметы', augments: 'Устройства', next: 'Следующий сбор', updated: 'Обновлено', unavailable: 'недоступно',
      pick: 'Выберите язык', open: 'Открыть файл', copy: 'Копировать ссылку', copied: 'Ссылка скопирована', copyPrompt: 'Скопируйте ссылку:',
      garage: 'Соберите танк', turrets: 'Пушки', hulls: 'Корпуса',
      short: 'Ближний бой', medium: 'Средняя дистанция', long: 'Дальний бой',
      hullNote: 'Устройства для корпусов общие для всех корпусов', shared: 'общие',
      shoutTitle: 'Респект', clanLabel: 'Привет клану',
      clanText: 'Большой респект клану TWIZY, моему клану в Tanki Online. Вперёд, танкисты!',
      how: 'Как это работает',
      s1t: '1 · Сбор', s1d: 'Бот раз в день читает страницы устройств в EN и RU вики Tanki.',
      s2t: '2 · Проверка', s2d: 'Сломанные или урезанные результаты отклоняются, а последний хороший файл остаётся в сети.',
      s3t: '3 · Публикация', s3d: 'Сюда попадают только изменённые файлы, поэтому каждый патч виден как понятная разница.',
      foot1: 'Данные берутся из вики сообщества', wiki: 'Tanki Online', foot2: 'Tanki Online принадлежит своим владельцам.',
      art: 'Изображения танков экспортированы из игры и принадлежат Tanki Online.',
      site: 'Сайт игры', src: 'Исходный код на GitHub',
      aug: function (n) {
        var mod10 = n % 10, mod100 = n % 100;
        var word = mod10 === 1 && mod100 !== 11 ? 'устройство' : (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'устройства' : 'устройств');
        return n + ' ' + word;
      },
      hm: function (h, m) { return h + ' ч ' + (m < 10 ? '0' : '') + m + ' мин'; },
      heroLabel: function (name) { return 'Танк: ' + name; }
    }
  };

  var NAMES = {
    firebird: ['Firebird', 'Огнемёт'], freeze: ['Freeze', 'Фриз'], isida: ['Isida', 'Изида'], tesla: ['Tesla', 'Тесла'],
    hammer: ['Hammer', 'Молот'], twins: ['Twins', 'Твинс'], ricochet: ['Ricochet', 'Рикошет'], vulcan: ['Vulcan', 'Вулкан'],
    smoky: ['Smoky', 'Смоки'], striker: ['Striker', 'Страйкер'], thunder: ['Thunder', 'Гром'], tsunami: ['Tsunami', 'Цунами'],
    scorpion: ['Scorpion', 'Скорпион'], magnum: ['Magnum', 'Магнум'], railgun: ['Railgun', 'Рельса'], gauss: ['Gauss', 'Гаусс'],
    shaft: ['Shaft', 'Шафт'],
    wasp: ['Wasp', 'Оса'], hopper: ['Hopper', 'Хоппер'], hornet: ['Hornet', 'Хорнет'], viking: ['Viking', 'Викинг'],
    crusader: ['Crusader', 'Крестоносец'], hunter: ['Hunter', 'Хантер'], paladin: ['Paladin', 'Паладин'],
    dictator: ['Dictator', 'Диктатор'], titan: ['Titan', 'Титан'], ares: ['Ares', 'Арес'], mammoth: ['Mammoth', 'Мамонт']
  };

  // 'lang' was the first key name; every project on this github.io origin shares storage, so it is only read once for people who already picked a language
  var LANG_KEY = 'tanki-augments-lang';
  var lang = 'EN';
  try {
    var saved = localStorage.getItem(LANG_KEY) || localStorage.getItem('lang');
    if (saved === 'EN' || saved === 'RU') lang = saved; else if (/^ru/i.test(navigator.language || '')) lang = 'RU';
  } catch (e) { if (/^ru/i.test(navigator.language || '')) lang = 'RU'; }
  function t(key) { return T[lang][key]; }
  function nameOf(id) { return NAMES[id][lang === 'RU' ? 1 : 0]; }

  // The order of the tiles; the range sets the colour bar on a turret tile.
  var TURRETS = [
    { id: 'firebird', range: 'short' }, { id: 'freeze', range: 'short' }, { id: 'isida', range: 'short' }, { id: 'tesla', range: 'short' }, { id: 'hammer', range: 'short' },
    { id: 'twins', range: 'medium' }, { id: 'ricochet', range: 'medium' }, { id: 'vulcan', range: 'medium' }, { id: 'smoky', range: 'medium' }, { id: 'striker', range: 'medium' }, { id: 'thunder', range: 'medium' },
    { id: 'tsunami', range: 'long' }, { id: 'scorpion', range: 'long' }, { id: 'magnum', range: 'long' }, { id: 'railgun', range: 'long' }, { id: 'gauss', range: 'long' }, { id: 'shaft', range: 'long' }
  ];
  var HULLS = ['wasp', 'hopper', 'hornet', 'viking', 'crusader', 'hunter', 'paladin', 'dictator', 'titan', 'ares', 'mammoth'];

  // Real in-game renders. Everything is placed in one frame, the one the turrets were exported in
  // (all turrets sit on a Hunter there), in scaled-image pixels.
  // turret: x,y,w,h = where the crop sits; mx,my = the muzzle tip inside it; k = optional size correction.
  // hull: x,y,w,h = where the hull sits so that a turret rests correctly on it (already includes any size correction).
  // pivot: the seat point of the turrets, used as the centre when a turret is scaled.
  var REAL = {
    ground: 558,
    pivot: { x: 538.5, y: 336 },
    turret: {
      firebird: { src: 'img/turret-firebird.webp', x: 328.8, y: 191.4, w: 598, h: 146, mx: 595.8, my: 105.3 },
      freeze: { src: 'img/turret-freeze.webp', x: 319.8, y: 211.2, w: 634, h: 127, mx: 632.4, my: 75.3 },
      isida: { src: 'img/turret-isida.webp', x: 397.2, y: 208.2, w: 409, h: 129, mx: 406.8, my: 96.9 },
      tesla: { src: 'img/turret-tesla.webp', x: 267.6, y: 176.4, w: 561, h: 165, mx: 559.2, my: 104.4 },
      hammer: { src: 'img/turret-hammer.webp', x: 343.8, y: 181.2, w: 487, h: 155, mx: 485.4, my: 70.8 },
      twins: { src: 'img/turret-twins.webp', x: 336.6, y: 220.2, w: 537, h: 116, mx: 535.2, my: 70.5 },
      ricochet: { src: 'img/turret-ricochet.webp', x: 352.8, y: 200.4, w: 526, h: 136, mx: 524.4, my: 94.2 },
      vulcan: { src: 'img/turret-vulcan.webp', x: 276, y: 174.6, w: 575, h: 163, mx: 573.6, my: 71.4 },
      smoky: { src: 'img/turret-smoky.webp', x: 377.4, y: 230.4, w: 502, h: 106, mx: 500.4, my: 58.2 },
      striker: { src: 'img/turret-striker.webp', x: 363.6, y: 194.4, w: 299, h: 142, mx: 297.6, my: 35.1, k: 1.08 },
      thunder: { src: 'img/turret-thunder.webp', x: 290.4, y: 226.8, w: 644, h: 110, mx: 642.6, my: 57.9 },
      tsunami: { src: 'img/turret-tsunami.webp', x: 364.8, y: 225.6, w: 611, h: 113, mx: 609.6, my: 57.3 },
      scorpion: { src: 'img/turret-scorpion.webp', x: 311.4, y: 189, w: 800, h: 148, mx: 798.6, my: 90.9 },
      magnum: { src: 'img/turret-magnum.webp', x: 390, y: 189, w: 653, h: 148, mx: 651.6, my: 63.9 },
      railgun: { src: 'img/turret-railgun.webp', x: 382.8, y: 205.8, w: 656, h: 132, mx: 654, my: 74.7 },
      gauss: { src: 'img/turret-gauss.webp', x: 286.2, y: 214.8, w: 682, h: 122, mx: 679.8, my: 57.9 },
      shaft: { src: 'img/turret-shaft.webp', x: 286.2, y: 198.6, w: 784, h: 143, mx: 782.4, my: 84.6 }
    },
    hull: {
      wasp: { src: 'img/hull-wasp.webp', x: 260.9, y: 339.7, w: 730, h: 233 },
      hopper: { src: 'img/hull-hopper.webp', x: 152.1, y: 331.6, w: 789.4, h: 180.2, k: 1.1261 },
      hornet: { src: 'img/hull-hornet.webp', x: 209.9, y: 325.6, w: 743, h: 208 },
      viking: { src: 'img/hull-viking.webp', x: 174.6, y: 321.4, w: 863.3, h: 208.4, k: 0.9603 },
      crusader: { src: 'img/hull-crusader.webp', x: 135, y: 329.7, w: 822, h: 220.8, k: 0.9277 },
      hunter: { src: 'img/hull-hunter.webp', x: 159.2, y: 333.3, w: 802, h: 230 },
      paladin: { src: 'img/hull-paladin.webp', x: 148.1, y: 331.2, w: 826, h: 215 },
      dictator: { src: 'img/hull-dictator.webp', x: 204.9, y: 338, w: 982, h: 306 },
      titan: { src: 'img/hull-titan.webp', x: 54.2, y: 328.9, w: 928, h: 253 },
      ares: { src: 'img/hull-ares.webp', x: 89.3, y: 321.7, w: 886, h: 225 },
      mammoth: { src: 'img/hull-mammoth.webp', x: -42.9, y: 329.5, w: 967, h: 251 }
    }
  };

  function realLayout(turretId, hullId) {
    var t = REAL.turret[turretId], h = REAL.hull[hullId];
    if (!t || !h) return null;
    // a turret with a size correction is scaled around its seat point, so it stays on its hull
    var k = t.k || 1, p = REAL.pivot;
    var tx = p.x + (t.x - p.x) * k, ty = p.y + (t.y - p.y) * k, tw = t.w * k, th = t.h * k;
    var x0 = Math.min(h.x, tx), y0 = Math.min(h.y, ty);
    // the frame always reaches down to the ground line, so hovering hulls stay at their real height
    var x1 = Math.max(h.x + h.w, tx + tw), y1 = Math.max(h.y + h.h, ty + th, REAL.ground);
    return {
      w: x1 - x0, h: y1 - y0,
      hull: { src: h.src, x: h.x - x0, y: h.y - y0, w: h.w, h: h.h },
      turret: { src: t.src, x: tx - x0, y: ty - y0, w: tw, h: th, mx: t.mx * k, my: t.my * k, k: k }
    };
  }

  function pct(value, total) { return (value / total * 100).toFixed(3) + '%'; }
  function box(p, frame) { return 'left:' + pct(p.x, frame.w) + ';top:' + pct(p.y, frame.h) + ';width:' + pct(p.w, frame.w) + ';height:' + pct(p.h, frame.h); }

  // Every tank is drawn at the same scale, sized so the largest combination fills the frame.
  var FRAME_ASPECT = 520 / 250;
  var REF = (function () {
    var w = 0, h = 0;
    Object.keys(REAL.turret).forEach(function (t) {
      Object.keys(REAL.hull).forEach(function (hu) { var l = realLayout(t, hu); if (l.w > w) w = l.w; if (l.h > h) h = l.h; });
    });
    return { w: w, h: h };
  })();
  var FIT = Math.min(90 / REF.w, 90 / (FRAME_ASPECT * REF.h));

  var sel = { turret: 'railgun', hull: 'hunter' };
  var shown = { turret: null, hull: null };
  var counts = null;
  var heroReal = document.getElementById('heroReal');

  function place(part, p, layout) {
    part.style.cssText = box(p, layout);
    var img = part.firstChild;
    if (img.getAttribute('src') !== p.src) img.setAttribute('src', p.src);
  }

  // Only runs when the tank itself changed, so switching the language never restarts the shot.
  function renderReal() {
    if (shown.turret === sel.turret && shown.hull === sel.hull) return;
    shown.turret = sel.turret; shown.hull = sel.hull;
    var layout = realLayout(sel.turret, sel.hull);
    if (!heroReal.firstChild) {
      heroReal.innerHTML = '<div class="rshadow"></div><div class="rpart"><img alt=""></div><div class="rpart rturret"><img alt=""></div>';
    }
    heroReal.style.width = (layout.w * FIT).toFixed(2) + '%';
    heroReal.style.aspectRatio = layout.w + ' / ' + layout.h;
    var turretEl = heroReal.querySelector('.rturret');
    place(heroReal.querySelector('.rpart'), layout.hull, layout);
    place(turretEl, layout.turret, layout);
    // the shot effect canvas works out where the muzzle is from this layout
    if (window.TankFx) window.TankFx.setTank({ id: sel.turret, layout: layout, turretEl: turretEl });
  }

  function renderHero() {
    renderReal();
    var label = nameOf(sel.hull) + ' + ' + nameOf(sel.turret);
    document.getElementById('capName').textContent = label;
    document.getElementById('heroSvg').setAttribute('aria-label', t('heroLabel')(label));
    renderCaptionCount();
    var tiles = document.querySelectorAll('.tile');
    for (var i = 0; i < tiles.length; i++) {
      var tile = tiles[i];
      var on = tile.getAttribute('data-id') === (tile.getAttribute('data-kind') === 'turret' ? sel.turret : sel.hull);
      tile.classList.toggle('on', on);
      tile.setAttribute('aria-pressed', String(on));
    }
  }

  function renderCaptionCount() {
    var el = document.getElementById('capCount');
    var n = counts ? counts[sel.turret] : undefined;
    el.innerHTML = typeof n === 'number' ? t('aug')(n) : '&nbsp;';
  }

  function buildTiles() {
    var tt = document.getElementById('turretTiles'), ht = document.getElementById('hullTiles');
    function thumb(real) { return '<img class="thumb photo" src="' + real.src + '" alt="" aria-hidden="true">'; }
    TURRETS.forEach(function (tu) { tt.appendChild(makeTile('turret', tu.id, 'tile ' + tu.range, thumb(REAL.turret[tu.id]))); });
    HULLS.forEach(function (id) { ht.appendChild(makeTile('hull', id, 'tile hull', thumb(REAL.hull[id]))); });
  }

  function makeTile(kind, id, cls, thumbHtml) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.setAttribute('data-kind', kind); b.setAttribute('data-id', id);
    b.innerHTML = thumbHtml + '<span class="tn"></span><span class="tc"></span>';
    b.addEventListener('click', function () { auto = false; sel[kind] = id; renderHero(); });
    return b;
  }

  function renderTileText() {
    var tiles = document.querySelectorAll('.tile');
    for (var i = 0; i < tiles.length; i++) {
      var tile = tiles[i], id = tile.getAttribute('data-id'), isTurret = tile.getAttribute('data-kind') === 'turret';
      tile.querySelector('.tn').textContent = nameOf(id);
      var n = counts ? counts[id] : undefined;
      tile.querySelector('.tc').textContent = isTurret ? (typeof n === 'number' ? t('aug')(n) : '') : t('shared');
    }
    var hn = counts && typeof counts.hulls === 'number' ? t('aug')(counts.hulls) + ' · ' : '';
    document.getElementById('hullNote').textContent = hn + t('hullNote');
  }

  /* ---------- live data ---------- */
  var summaries = [];
  var formatter = null;

  function ago(iso) {
    var then = Date.parse(iso);
    if (isNaN(then)) return '-';
    var minutes = Math.round((then - Date.now()) / 60000);
    if (!formatter) return new Date(then).toUTCString();
    if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
    if (Math.abs(minutes) < 1440) return formatter.format(Math.round(minutes / 60), 'hour');
    return formatter.format(Math.round(minutes / 1440), 'day');
  }

  // Mirrors the cron in .github/workflows/augments-bot.yml ('30 5 * * *'); npm run test:site fails if the two drift apart.
  var SCRAPE_UTC = { hour: 5, minute: 30 };

  function nextScrapeLabel() {
    var now = new Date();
    var next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), SCRAPE_UTC.hour, SCRAPE_UTC.minute));
    if (next <= now) next = new Date(next.getTime() + 86400000);
    var minutes = Math.round((next - now) / 60000);
    return t('hm')(Math.floor(minutes / 60), minutes % 60);
  }

  function setText(root, name, value) {
    var el = root.querySelector('[data-stat="' + name + '"]');
    if (el) el.textContent = value;
  }

  function summarize(data) {
    var items = Object.keys(data.items || {});
    var per = {};
    var augments = items.reduce(function (total, item) { var n = Object.keys(data.items[item]).length; per[item] = n; return total + n; }, 0);
    return { items: items.length, augments: augments, generatedAt: data.generatedAt, per: per };
  }

  function renderCards() {
    var cards = document.querySelectorAll('.card');
    for (var i = 0; i < cards.length; i++) {
      var s = summaries[i];
      if (s) { setText(cards[i], 'items', s.items); setText(cards[i], 'augments', s.augments); setText(cards[i], 'updated', ago(s.generatedAt)); }
      else if (summaries.length === cards.length) { setText(cards[i], 'items', '-'); setText(cards[i], 'augments', '-'); setText(cards[i], 'updated', t('unavailable')); }
    }
    var ok = summaries.filter(Boolean);
    if (ok[0]) {
      document.getElementById('chipItems').textContent = ok[0].items;
      document.getElementById('chipAugments').textContent = ok[0].augments + (ok[1] ? ' / ' + ok[1].augments : '');
    }
  }

  function renderLive() {
    var live = document.getElementById('live'), text = document.getElementById('liveText');
    if (summaries.length === 0) { text.textContent = t('checking'); return; }
    var ok = summaries.filter(Boolean).length;
    text.textContent = ok === summaries.length ? t('live') : (ok ? t('partly') : t('down'));
    live.classList.toggle('off', ok !== summaries.length);
  }

  function loadCard(card) {
    return fetch(card.getAttribute('data-file'), { cache: 'no-cache' })
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then(summarize)
      .catch(function () { return null; });
  }

  /* ---------- language ---------- */
  function applyLang() {
    document.documentElement.lang = lang.toLowerCase();
    document.title = t('title');
    document.getElementById('metaDesc').setAttribute('content', t('desc'));
    formatter = typeof Intl !== 'undefined' && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat(lang.toLowerCase(), { numeric: 'auto' }) : null;
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = t(nodes[i].getAttribute('data-i18n'));
    document.getElementById('h1').innerHTML = t('h1');
    var buttons = document.querySelectorAll('.lang button');
    for (var j = 0; j < buttons.length; j++) buttons[j].setAttribute('aria-pressed', String(buttons[j].getAttribute('data-lang') === lang));
    renderLive(); renderCards(); renderTileText(); renderHero(); tickNext();
  }

  var langButtons = document.querySelectorAll('.lang button');
  for (var b = 0; b < langButtons.length; b++) {
    langButtons[b].addEventListener('click', function (event) {
      lang = event.currentTarget.getAttribute('data-lang');
      try { localStorage.setItem(LANG_KEY, lang); } catch (e) { /* storage may be blocked */ }
      applyLang();
    });
  }

  /* ---------- small helpers ---------- */
  var nextEl = document.getElementById('chipNext');
  function tickNext() { nextEl.textContent = nextScrapeLabel(); }
  setInterval(tickNext, 30000);

  var toast = document.getElementById('toast'), toastTimer = 0;
  function say(message) {
    toast.textContent = message; toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 1800);
  }
  document.querySelectorAll('button.copy').forEach(function (button) {
    button.addEventListener('click', function () {
      var url = new URL(button.getAttribute('data-copy'), location.href).href;
      var done = function () { say(t('copied')); };
      var fail = function () { window.prompt(t('copyPrompt'), url); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, fail); else fail();
    });
  });

  /* ---------- go ---------- */
  var auto = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  // two full shot cycles per tank, so every turret is seen firing, resting and firing again
  var cycleMs = window.TankFx ? window.TankFx.cycleMs : 6000;
  setInterval(function () {
    if (!auto) return;
    var at = TURRETS.map(function (tu) { return tu.id; }).indexOf(sel.turret);
    var hulls = HULLS.filter(function (id) { return id !== sel.hull; });
    sel.turret = TURRETS[(at + 1) % TURRETS.length].id;
    sel.hull = hulls[Math.floor(Math.random() * hulls.length)];
    renderHero();
  }, 2 * cycleMs);

  // ?tank=<turret>,<hull> starts on that tank with no auto-rotation (used for checks and screenshots)
  var tankParam = (new URLSearchParams(location.search).get('tank') || '').split(',');
  if (tankParam.length === 2 && REAL.turret[tankParam[0]] && REAL.hull[tankParam[1]]) {
    sel.turret = tankParam[0]; sel.hull = tankParam[1]; auto = false;
  }

  if (window.TankFx) window.TankFx.init({ frame: document.querySelector('.heroframe'), real: heroReal, canvas: document.getElementById('heroFx') });
  buildTiles();
  applyLang();

  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
  Promise.all(cards.map(loadCard)).then(function (results) {
    summaries = results;
    var source = results[0] || results[1];
    counts = source ? source.per : null;
    renderLive(); renderCards(); renderTileText(); renderCaptionCount();
  });
})();
