// Browser checks for the landing page and its shot effects. Run from bot/ with `npm run test:site`.
// It serves bot/site (plus bot/out for the data files) on a free local port and drives a real Chromium.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOTS = [join(HERE, '..'), join(HERE, '..', '..', 'out')];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp' };

const TURRETS = ['firebird', 'freeze', 'isida', 'tesla', 'hammer', 'twins', 'ricochet', 'vulcan', 'smoky', 'striker', 'thunder', 'tsunami', 'scorpion', 'magnum', 'railgun', 'gauss', 'shaft'];
const HULLS = ['wasp', 'hopper', 'hornet', 'viking', 'crusader', 'hunter', 'paladin', 'dictator', 'titan', 'ares', 'mammoth'];
const HEAVY = ['tesla', 'firebird', 'freeze', 'scorpion', 'striker'];
const FIRING_MS = 1260;
const REST_MS = 5800;
const COST_RUN_MS = 6200;

const skipCost = process.argv.includes('--skip-cost');

async function serve() {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '') || 'index.html';
    if (path.startsWith('..')) { res.writeHead(403).end(); return; }
    for (const root of ROOTS) {
      try {
        const body = await readFile(join(root, path));
        res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(body);
        return;
      } catch { /* try the next folder */ }
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const results = [];
function record(name, problems, note = '') {
  results.push({ name, problems });
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${name}${note ? ` (${note})` : ''}`);
  for (const p of problems.slice(0, 12)) console.log(`       ${p}`);
  if (problems.length > 12) console.log(`       ...and ${problems.length - 12} more`);
}

async function openPage(browser, base, query, options = {}) {
  const context = await browser.newContext(options);
  // fonts and anything else off the local server are not part of these checks
  await context.route((url) => url.hostname !== '127.0.0.1', (route) => route.fulfill({ status: 200, body: '' }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/augments\.(en|ru)\.json/.test(m.location().url)) return; // bot/out is not committed, a missing file is handled by the page
    errors.push(`console.error: ${m.text()}`);
  });
  await page.goto(`${base}/${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.TankFx && window.TankFx.info().muzzles.length > 0);
  return { page, context, errors };
}

// Picks a tank the way a visitor does and reads what the canvas holds at that moment (the clock is frozen by ?fx=).
const readCanvas = (page, turret, hull) => page.evaluate(({ turret, hull }) => {
  document.querySelector(`.tile[data-kind="turret"][data-id="${turret}"]`).click();
  document.querySelector(`.tile[data-kind="hull"][data-id="${hull}"]`).click();
  const canvas = document.getElementById('heroFx');
  const ctx = canvas.getContext('2d');
  const scale = canvas.width / canvas.getBoundingClientRect().width;
  const info = window.TankFx.info();
  const solid = (data) => { let n = 0; for (let i = 3; i < data.length; i += 4) if (data[i] > 8) n++; return n; };
  const whole = solid(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
  const reach = info.unit * 160 * scale;
  let nearMuzzle = 0;
  for (const m of info.muzzles) {
    const x = Math.max(0, Math.round(m.x * scale - reach)), y = Math.max(0, Math.round(m.y * scale - reach));
    const size = Math.round(reach * 2);
    nearMuzzle += solid(ctx.getImageData(x, y, Math.min(size, canvas.width - x), Math.min(size, canvas.height - y)).data);
  }
  const doc = document.documentElement;
  return { whole, nearMuzzle, sideways: doc.scrollWidth - doc.clientWidth };
}, { turret, hull });

async function checkEffectAtMuzzle(browser, base) {
  const { page, context, errors } = await openPage(browser, base, `?tank=railgun,hunter&fx=${FIRING_MS}`, { viewport: { width: 1280, height: 800 } });
  const problems = [];
  for (const turret of TURRETS) {
    for (const hull of HULLS) {
      const r = await readCanvas(page, turret, hull);
      if (r.nearMuzzle === 0) problems.push(`${turret} + ${hull}: nothing drawn at the muzzle at fx=${FIRING_MS}`);
    }
  }
  record(`effect at the muzzle, ${TURRETS.length * HULLS.length} combinations at fx=${FIRING_MS}`, problems);
  record('no console errors (desktop)', errors);
  await context.close();
}

async function checkEmptyAtRest(browser, base) {
  const { page, context } = await openPage(browser, base, `?tank=railgun,hunter&fx=${REST_MS}`, { viewport: { width: 1280, height: 800 } });
  const problems = [];
  for (const turret of TURRETS) {
    for (const hull of HULLS) {
      const r = await readCanvas(page, turret, hull);
      if (r.whole !== 0) problems.push(`${turret} + ${hull}: ${r.whole} pixels still drawn at fx=${REST_MS}`);
    }
  }
  record(`canvas empty at rest, ${TURRETS.length * HULLS.length} combinations at fx=${REST_MS}`, problems);
  await context.close();
}

async function checkPhoneWidth(browser, base) {
  const { page, context, errors } = await openPage(browser, base, `?tank=railgun,hunter&fx=${FIRING_MS}`, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const problems = [];
  for (const turret of TURRETS) {
    for (const hull of HULLS) {
      const r = await readCanvas(page, turret, hull);
      if (r.sideways > 0) problems.push(`${turret} + ${hull}: page is ${r.sideways}px wider than the screen`);
    }
  }
  record('no sideways scroll at 390 px wide, every combination', problems);
  record('no console errors (390 px)', errors);
  await context.close();
}

const info = (page) => page.evaluate(() => window.TankFx.info());
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function checkPausing(browser, base) {
  const { page, context } = await openPage(browser, base, '?tank=hammer,viking', { viewport: { width: 1280, height: 800 } });
  const problems = [];
  const expect = (cond, text) => { if (!cond) problems.push(text); };

  await pause(500);
  const first = await info(page);
  expect(first.running, 'loop is not running on load');
  await pause(300);
  expect((await info(page)).t !== first.t || (await info(page)).cycle !== first.cycle, 'effect clock does not advance while visible');

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await pause(400);
  const away = await info(page);
  expect(!away.running, 'loop keeps running after the hero scrolled away');
  await pause(300);
  const awayLater = await info(page);
  expect(awayLater.t === away.t && awayLater.cycle === away.cycle, 'effect clock advances while the hero is off screen');

  await page.evaluate(() => window.scrollTo(0, 0));
  await pause(400);
  expect((await info(page)).running, 'loop does not resume when the hero scrolls back');

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await pause(200);
  const hidden = await info(page);
  expect(!hidden.running, 'loop keeps running while the tab is hidden');
  await pause(300);
  const hiddenLater = await info(page);
  expect(hiddenLater.t === hidden.t && hiddenLater.cycle === hidden.cycle, 'effect clock advances while the tab is hidden');

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await pause(300);
  expect((await info(page)).running, 'loop does not resume when the tab is shown again');

  record('loop pauses off screen and in a hidden tab, and resumes', problems);
  await context.close();
}

async function checkReducedMotion(browser, base) {
  const { page, context } = await openPage(browser, base, '?tank=hammer,viking', { viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const problems = [];
  const canvasPixels = () => page.evaluate(() => {
    const canvas = document.getElementById('heroFx');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 8) n++;
    return n;
  });

  await pause(500);
  const start = await info(page);
  if (!start.reduced) problems.push('reduced motion is not detected');
  if (start.running) problems.push('loop runs under reduced motion');
  if (await canvasPixels() !== 0) problems.push('canvas is not empty after the first flash');

  // A new turret plays one short flash, sampled on the next frame, and then the canvas stays empty.
  const flash = await page.evaluate(() => new Promise((resolve) => {
    document.querySelector('.tile[data-kind="turret"][data-id="tesla"]').click();
    requestAnimationFrame(() => {
      const canvas = document.getElementById('heroFx');
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let n = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 8) n++;
      resolve(n);
    });
  }));
  if (flash === 0) problems.push('no muzzle flash when the turret changes');
  await pause(600);
  const after = await info(page);
  if (after.running) problems.push('loop runs after the flash');
  if (await canvasPixels() !== 0) problems.push('canvas is not empty after the flash ended');

  record('reduced motion plays one flash, then stays still', problems);
  await context.close();
}

async function checkPageBasics(browser, base) {
  const problems = [];
  const raw = await (await fetch(`${base}/`)).text();
  if (/Artwork is original fan art/i.test(raw)) problems.push('static footer still says the artwork is original fan art');
  if (!/belong to Tanki Online/.test(raw)) problems.push('static footer does not credit the images to Tanki Online');
  if (!/<meta property="og:title"/.test(raw) || !/<meta property="og:description"/.test(raw) || !/<meta property="og:type"/.test(raw)) problems.push('Open Graph title, description or type is missing');
  record('static HTML: right image credit and Open Graph tags', problems);

  // aria-pressed follows the selected tile
  const tiles = await openPage(browser, base, '?tank=railgun,hunter', { viewport: { width: 1280, height: 800 } });
  const tileProblems = [];
  const pressed = () => tiles.page.evaluate(() => [...document.querySelectorAll('.tile')].filter((t) => t.getAttribute('aria-pressed') === 'true').map((t) => `${t.dataset.kind}:${t.dataset.id}`).sort());
  const unset = await tiles.page.evaluate(() => [...document.querySelectorAll('.tile')].filter((t) => t.getAttribute('aria-pressed') === null).length);
  if (unset) tileProblems.push(`${unset} tiles have no aria-pressed`);
  let now = await pressed();
  if (now.join() !== 'hull:hunter,turret:railgun') tileProblems.push(`expected railgun and hunter pressed, got ${now.join() || 'none'}`);
  await tiles.page.click('.tile[data-kind="turret"][data-id="tesla"]');
  await tiles.page.click('.tile[data-kind="hull"][data-id="mammoth"]');
  now = await pressed();
  if (now.join() !== 'hull:mammoth,turret:tesla') tileProblems.push(`after clicking tesla and mammoth, got ${now.join() || 'none'}`);
  record('tiles announce the selected turret and hull with aria-pressed', tileProblems);
  await tiles.context.close();

  // an old 'lang' choice is still honoured, and the new choice is saved under the prefixed key
  const langProblems = [];
  const lang = await openPage(browser, base, '?tank=railgun,hunter', { viewport: { width: 1280, height: 800 } });
  await lang.page.evaluate(() => { localStorage.clear(); localStorage.setItem('lang', 'RU'); });
  await lang.page.reload();
  await lang.page.waitForFunction(() => window.TankFx && window.TankFx.info().muzzles.length > 0);
  if (await lang.page.evaluate(() => document.documentElement.lang) !== 'ru') langProblems.push('an old lang=RU choice was not honoured');
  await lang.page.click('.lang button[data-lang="EN"]');
  const saved = await lang.page.evaluate(() => ({ next: localStorage.getItem('tanki-augments-lang'), old: localStorage.getItem('lang') }));
  if (saved.next !== 'EN') langProblems.push(`new choice saved as ${saved.next} under the prefixed key`);
  if (saved.old !== 'RU') langProblems.push('the shared lang key was changed, other projects on this origin may use it');
  await lang.page.reload();
  await lang.page.waitForFunction(() => window.TankFx && window.TankFx.info().muzzles.length > 0);
  if (await lang.page.evaluate(() => document.documentElement.lang) !== 'en') langProblems.push('the prefixed key does not win over the old one');
  record('language choice: old key read once, prefixed key saved', langProblems);
  await lang.context.close();

  // an empty ?fx= means "not set", so the loop runs
  const empty = await openPage(browser, base, '?tank=railgun,hunter&fx=', { viewport: { width: 1280, height: 800 } });
  await pause(400);
  const emptyInfo = await info(empty.page);
  const emptyProblems = [];
  if (emptyInfo.frozenAt !== null) emptyProblems.push(`empty fx= froze the clock at ${emptyInfo.frozenAt}`);
  if (!emptyInfo.running) emptyProblems.push('loop is not running with an empty fx=');
  record('empty ?fx= is treated as not set', emptyProblems);
  await empty.context.close();
}

async function checkRotation(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.route((url) => url.hostname !== '127.0.0.1', (route) => route.fulfill({ status: 200, body: '' }));
  const page = await context.newPage();
  await page.clock.install();
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.TankFx && window.TankFx.info().muzzles.length > 0);
  const problems = [];
  const cycleMs = await page.evaluate(() => window.TankFx.cycleMs);
  if (!(cycleMs > 0)) problems.push('TankFx.cycleMs is not exported');
  const seen = new Set();
  const selected = () => page.evaluate(() => ({
    turret: document.querySelector('.tile[data-kind="turret"][aria-pressed="true"]')?.dataset.id,
    hull: document.querySelector('.tile[data-kind="hull"][aria-pressed="true"]')?.dataset.id,
    src: [...document.querySelectorAll('#heroReal img')].map((i) => i.getAttribute('src')),
  }));
  seen.add((await selected()).turret);
  // one rotation step is two shot cycles; a step must not come sooner than that
  await page.clock.fastForward(2 * cycleMs - 1000);
  if ((await selected()).turret !== [...seen][0]) problems.push('the tank changed before two shot cycles had passed');
  await page.clock.fastForward(1000);
  for (let i = 0; i < TURRETS.length + 2; i++) {
    const now = await selected();
    seen.add(now.turret);
    if (!HULLS.includes(now.hull)) problems.push(`rotation chose an unknown hull: ${now.hull}`);
    if (now.src.length !== 2 || now.src.some((s) => !s || !s.startsWith('img/'))) problems.push(`hero pictures not set after step ${i}: ${now.src}`);
    await page.clock.fastForward(2 * cycleMs);
  }
  const missing = TURRETS.filter((t) => !seen.has(t));
  if (missing.length) problems.push(`never shown in the rotation: ${missing.join(', ')}`);
  record('auto rotation shows all 17 turrets, one step every two shot cycles', problems);
  await context.close();
}

async function checkLanguageKeepsShot(browser, base) {
  const { page, context } = await openPage(browser, base, '?tank=hammer,viking', { viewport: { width: 1280, height: 800 } });
  const problems = [];
  await pause(1200);
  const before = await info(page);
  const heroNode = await page.evaluateHandle(() => document.querySelector('#heroReal .rturret'));
  await page.click('.lang button[data-lang="RU"]');
  const after = await info(page);
  if (after.cycle !== before.cycle || after.t < before.t) problems.push(`switching language restarted the shot (t ${Math.round(before.t)} to ${Math.round(after.t)})`);
  const sameNode = await page.evaluate((node) => node === document.querySelector('#heroReal .rturret'), heroNode);
  if (!sameNode) problems.push('switching language rebuilt the turret picture');
  await page.click('.lang button[data-lang="EN"]');
  const back = await info(page);
  if (back.cycle !== before.cycle || back.t < after.t) problems.push('switching back restarted the shot');
  record('switching the language does not restart the shot or rebuild the pictures', problems);
  await context.close();
}

// The frame is the canvas pixels folded into one number, so two frames can be compared without saving images.
const hashCanvas = () => {
  const canvas = document.getElementById('heroFx');
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let h = 2166136261;
  for (let i = 0; i < data.length; i++) h = Math.imul(h ^ data[i], 16777619) >>> 0;
  return h;
};

async function checkFrameRateIndependence(browser, base) {
  const problems = [];
  // frames of each refresh rate, keyed by the simulated time they show (only some moments are painted at every rate)
  const frames = {};
  for (const hz of [30, 60, 120, 144]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.route((url) => url.hostname !== '127.0.0.1', (route) => route.fulfill({ status: 200, body: '' }));
    // frames and the clock are driven by hand, so the frame rate is exactly what the test says
    await context.addInitScript(() => {
      let now = 1000, pending = null;
      performance.now = () => now;
      window.requestAnimationFrame = (cb) => { pending = cb; return 1; };
      window.cancelAnimationFrame = () => { pending = null; };
      window.__frame = (dt) => { now += dt; const cb = pending; pending = null; if (cb) cb(now); };
    });
    const page = await context.newPage();
    await page.goto(`${base}/?tank=railgun,hunter`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.TankFx && window.TankFx.info().muzzles.length > 0, null, { polling: 100 });
    frames[hz] = await page.evaluate(({ dt, hashSource }) => {
      const hash = new Function(`return (${hashSource})`)();
      const seen = {};
      for (let n = 0; n < 100000; n++) {
        window.__frame(dt);
        const i = window.TankFx.info();
        if (i.cycle > 0 || i.t > 2400) break;
        if (i.t >= 960 && i.t % 96 === 0 && !(i.t in seen)) seen[i.t] = hash();
      }
      return seen;
    }, { dt: 1000 / hz, hashSource: hashCanvas.toString() });
    await context.close();
  }
  const rates = Object.keys(frames);
  for (const a of rates) {
    for (const b of rates) {
      if (a >= b) continue;
      const common = Object.keys(frames[a]).filter((t) => t in frames[b]);
      if (common.length < 3) problems.push(`${a} Hz and ${b} Hz paint only ${common.length} moments in common, nothing to compare`);
      for (const t of common) if (frames[a][t] !== frames[b][t]) problems.push(`the frame at t=${t} differs between ${a} Hz and ${b} Hz`);
    }
  }
  record('the same moment looks the same at 30, 60, 120 and 144 Hz', problems);
}

async function checkLayoutArrivesLate(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.route((url) => url.hostname !== '127.0.0.1', (route) => route.fulfill({ status: 200, body: '' }));
  // the tank picture is served with no size, as if the layout had not happened yet; the frame itself stays on screen
  await context.route(`${base}/?*`, async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace('<head>', '<head><style id="hold-back">.real { display: none !important; }</style>');
    await route.fulfill({ response, body: html });
  });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto(`${base}/?tank=railgun,hunter`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.TankFx);
  await pause(300);
  if ((await info(page)).running) problems.push('loop runs although the hero has no size');
  await page.evaluate(() => document.getElementById('hold-back').remove());
  try {
    await page.waitForFunction(() => window.TankFx.info().running === true, null, { timeout: 3000 });
    await pause(300);
    const later = await info(page);
    if (later.muzzles.length === 0) problems.push('loop started but the muzzle points were never computed');
    if (later.t <= 0) problems.push('loop started but the clock does not move');
  } catch {
    problems.push('loop never started after the hero got its size');
  }
  record('a hero that gets its size late still starts the loop', problems);
  await context.close();
}

async function checkReducedMotionToggle(browser, base) {
  const { page, context } = await openPage(browser, base, '?tank=hammer,viking', { viewport: { width: 1280, height: 800 } });
  const problems = [];
  await pause(1500);
  if (!(await info(page)).running) problems.push('loop is not running to begin with');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await pause(300);
  let now = await info(page);
  if (!now.reduced || now.running) problems.push('turning on reduced motion did not stop the loop');
  const left = await page.evaluate(() => {
    const canvas = document.getElementById('heroFx');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 8) n++;
    return n;
  });
  if (left !== 0) problems.push(`${left} pixels stayed on the canvas after reduced motion was turned on`);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await pause(500);
  now = await info(page);
  if (now.reduced || !now.running) problems.push('turning reduced motion off did not bring the loop back');
  record('the loop follows a change of the reduced motion setting', problems);
  await context.close();
}

async function checkResize(browser, base) {
  const { page, context } = await openPage(browser, base, '?tank=hammer,viking', { viewport: { width: 1280, height: 800 } });
  const problems = [];
  await pause(1500);
  const before = await info(page);
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await pause(100);
  const same = await info(page);
  if (same.cycle !== before.cycle || same.t < before.t) problems.push('a resize event with no size change restarted the shot');
  await page.setViewportSize({ width: 900, height: 800 });
  await pause(200);
  const after = await info(page);
  if (after.cycle === same.cycle && after.t >= same.t) problems.push('the shot kept its old pixel positions after the hero changed size');
  record('a real size change restarts the shot, an unchanged size does not', problems);
  await context.close();
}

async function checkHelpersExported(browser, base) {
  const { page, context } = await openPage(browser, base, '?tank=hammer,viking', { viewport: { width: 1280, height: 800 } });
  const names = await page.evaluate(() => Object.keys(window.TankFx.helpers));
  const wanted = ['glow', 'drawFlash', 'lerp', 'ramp', 'sprite', 'stream', 'bullets', 'drawBall', 'drawSlug', 'drawBeam', 'shellRecipe'];
  record('TankFx.helpers exports everything AGENTS.md lists', wanted.filter((n) => !names.includes(n)).map((n) => `missing helper: ${n}`));
  await context.close();
}

async function checkScrapeTimeMirrorsCron() {
  const problems = [];
  const html = await readFile(join(HERE, '..', 'index.html'), 'utf8');
  const workflow = await readFile(join(HERE, '..', '..', '..', '.github', 'workflows', 'augments-bot.yml'), 'utf8');
  const cron = /cron:\s*'(\d+) (\d+) \* \* \*'/.exec(workflow);
  const page = /SCRAPE_UTC = \{ hour: (\d+), minute: (\d+) \}/.exec(html);
  if (!cron) problems.push('no daily cron found in augments-bot.yml');
  if (!page) problems.push('SCRAPE_UTC not found in index.html');
  if (cron && page && (Number(cron[2]) !== Number(page[1]) || Number(cron[1]) !== Number(page[2]))) {
    problems.push(`workflow runs at ${cron[2]}:${cron[1]} UTC but the page says ${page[1]}:${page[2]}`);
  }
  record('"Next scrape" time matches the workflow cron', problems);
}

async function reportCost(browser, base) {
  console.log('\nScript time per animation frame at 2x density (informational, no threshold)');
  for (const turret of HEAVY) {
    const { page, context } = await openPage(browser, base, `?tank=${turret},hunter`, { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    await page.evaluate(() => {
      window.__frames = [];
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => raf((ts) => { const a = performance.now(); cb(ts); window.__frames.push(performance.now() - a); });
    });
    await pause(COST_RUN_MS);
    const frames = await page.evaluate(() => window.__frames);
    const sorted = [...frames].sort((a, b) => a - b);
    const mean = frames.reduce((s, v) => s + v, 0) / (frames.length || 1);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    console.log(`  ${turret.padEnd(9)} mean ${mean.toFixed(2)} ms   p95 ${p95.toFixed(2)} ms   max ${(sorted.at(-1) ?? 0).toFixed(2)} ms   ${frames.length} frames`);
    await context.close();
  }
}

const { server, base } = await serve();
const browser = await chromium.launch();
try {
  await checkEffectAtMuzzle(browser, base);
  await checkEmptyAtRest(browser, base);
  await checkPausing(browser, base);
  await checkReducedMotion(browser, base);
  await checkPhoneWidth(browser, base);
  await checkPageBasics(browser, base);
  await checkRotation(browser, base);
  await checkLanguageKeepsShot(browser, base);
  await checkScrapeTimeMirrorsCron();
  await checkFrameRateIndependence(browser, base);
  await checkLayoutArrivesLate(browser, base);
  await checkReducedMotionToggle(browser, base);
  await checkResize(browser, base);
  await checkHelpersExported(browser, base);
  if (!skipCost) await reportCost(browser, base);
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => r.problems.length);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
