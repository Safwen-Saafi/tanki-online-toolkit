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
  if (!skipCost) await reportCost(browser, base);
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => r.problems.length);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
