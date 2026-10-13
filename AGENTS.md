# AGENTS.md

Instructions for AI coding agents working on the `site` branch: the public landing page of the
Tanki Online Toolkit. This branch has nothing to do with the browser extension. The extension, the
Augments bot and the workflows live on `main`; the two augment JSON files live on `data`.

Claude Code, Codex and every other AI tool must not add AI attribution to commits or pull requests
(no `Co-Authored-By`, no generated-by lines). Conventional commits, no em dashes in text, and do not
hard-wrap prose paragraphs.

## Where things live

| Branch | Holds |
|---|---|
| `main` | the extension, the bot, the workflows |
| `site` (this one) | the page: `index.html`, `site.css`, `site.js`, `fx.js`, `img/`, `fonts/`, and its tests |
| `data` | `augments.en.json` and `augments.ru.json`, written by the bot, nothing else |

`deploy-pages.yml` on `main` joins this branch with `data` and deploys it with GitHub Pages. A push
to this branch triggers it through `.github/workflows/deploy.yml`. Work on a branch off `site` and
open pull requests into `site`, never into `main`. A repo-wide Blueprint skill that assumes `main`
needs to be pointed at `site` explicitly.

## Commands

Run these from the root of this branch.

- Install: `npm install`, then `npx playwright install chromium` once.
- Serve: `npm run serve` (http://localhost:8000; the stats cards need the data files, which this
  branch does not hold, so they show "unavailable" locally).
- Test: `npm run test:quick` runs the checks (about 25 seconds). `npm test` also prints script time
  and memory per frame and frames per second with a slowed CPU (about 2 minutes).
- Refactor guard: `npm test -- --save-frames <file>` writes a fingerprint of the canvas for every
  turret at five moments, and `npm test -- --compare-frames <file>` lists every frame that changed
  since. Use it around any change to `fx.js`. The fingerprints depend on the machine's graphics, so
  keep the file out of the repo.

`test/check-site.mjs` serves this folder plus `test/fixtures` (two small sample data files) on a free
local port and drives the Playwright Chromium. It checks, for all 187 turret and hull combinations,
that an effect is drawn at the muzzle and that the canvas is empty at the end of the loop, that the
loop pauses off screen and in a hidden tab, reduced motion, phone width (no sideways scroll at 390 px),
no console errors, the footer credit and Open Graph tags, `aria-pressed` on the tiles, the saved
language key, the rotation, that switching language does not restart the shot, that no request leaves
the site and the self-hosted fonts are in use, that every external link opens in a new tab, that no
tile picture is drawn larger than the others, that every file the page uses is in this branch and is
published, and the frame-rate, resize, reduced-motion and sprite-cache behaviour of `fx.js`.

## The page

It is bilingual (EN and RU: it follows the browser language, has a toggle, and remembers the choice) and shows live stats read from the two JSON files. Its turret and hull pictures are the game's own garage exports: 28 WebP files in `img/` (17 turrets, 11 hulls). The same folder holds `twizy-logo.webp`, the TWIZY clan logo shown in the shoutout (the owner's own picture, resized to 360 px wide). Every link that leaves the site opens in a new tab with `rel="noopener"`, and `npm run test:site` checks it. Each tank is assembled from one hull and one turret image using the placements in the page's `REAL` table (all in the frame the turrets were exported in; a part can carry a size correction `k`, measured against a real hull+turret export); the drawings in the page are only a fallback for a part with no image. These images are Tanki Online's assets, and Tanki's fan content guidelines do not clearly allow original in-game assets outside gameplay or fan art, so the owner chose this knowingly: keep the page clearly marked as unofficial, keep the "images belong to Tanki Online" credit, and take the images down if Tanki asks. Never hotlink Tanki or wiki images; host only these files.

## Shot effects

`fx.js` (plain JS, no libraries, published with `index.html`) draws one original canvas effect per turret over the hero tank, in a 6 second auto loop: it fires for a while, rests, and repeats, in default colours chosen in the code (a recipe per turret in `recipes.<turretId>`, shared helpers `glow`, `stream`, `bullets`, `drawBall`, `drawSlug`, `drawBeam`, `shellRecipe`, `windSmoke`, `trailDue`, `spawn`, `flashPair`, `ringBurst`, `drawCharge`, `drawRockets` and the lightning path helpers). No Tanki assets are used and the page does not claim the effects match the game. It runs only while the hero is on screen and the tab is visible, caps particles and the density scale at 2 (1.5 on a phone, a touch screen or a window up to 820 px wide, where the Striker and Scorpion rocket smoke also keeps half its particles), draws on a canvas that covers only what the effects reach and stops at the screen edge, resizes with the hero, and for reduced-motion visitors plays only one short muzzle flash when the turret changes. Test hooks in the URL (not a public feature): `?tank=<turret>,<hull>` starts on that tank with no auto-rotation, and `&fx=<ms>` freezes the effect clock at that moment of the loop (0 to 6000), which is how each effect is checked in a screenshot.

**Adding or changing an effect.** The hand-written recipes (Hammer, Vulcan, Striker, Scorpion, Gauss, Magnum) keep their numbers in one named table at the top of the recipe (times in ms, lengths in turret widths, like `shellRecipe`'s config), so tune the table and not the code. A recipe is `{ shots, muzzles, recoilFn?, update(env, dtMs), draw(ctx, env) }` where `muzzles` are optional hand-measured points in the turret picture's pixels (the default is the detected barrel tip) and `env` gives the time in the loop, the points in canvas pixels, the turret width, the room to the right and the ground line. A tint function (used by `stream.draw`) returns `rgba(r, g, b, a)`, which reuses one shared array, so read it before calling another tint. `draw` must not change any state, only `update` may. Keep every effect empty at the end of the loop (the canvas must be blank at `fx=5800`), keep it inside the canvas, and check it on at least Hunter, Wasp and Mammoth. `window.TankFx` exposes `init`, `setTank`, `clear`, `info`, `cycleMs`, `recipes` and `helpers`. The page rotates the hero through all 17 turrets (each with a random other hull), one step every two cycles, read from `cycleMs`.

## Things that live elsewhere

- "Next scrape 05:30 UTC" in `site.js` (`SCRAPE_UTC`) mirrors the cron in `main`'s
  `.github/workflows/augments-bot.yml`. Change both together.
- The `NOT_PUBLISHED` list in `test/check-site.mjs` mirrors the `--exclude` list in `main`'s
  `.github/workflows/deploy-pages.yml`. Change both together.
