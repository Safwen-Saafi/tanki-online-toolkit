# Tanki Online Toolkit - landing page

The public page at https://safwen-saafi.github.io/tanki-online-toolkit/. It shows the augment data
(live counts read from the two JSON files), lets a visitor build a tank from a hull and a turret, and
plays an original shot effect for each of the 17 turrets.

This branch holds only the page. It has nothing to do with the browser extension.

## Where things live

| Branch | Holds |
|---|---|
| `main` | the extension, the Augments bot, the workflows |
| `site` (this one) | the page and its tests |
| `data` | `augments.en.json` and `augments.ru.json`, written by the bot, nothing else |

The page is published by `.github/workflows/deploy-pages.yml` on `main`. It checks out this branch and
`data`, joins them into one folder, and deploys it. Nothing is committed back.

## Files

- `index.html`, `site.css`, `site.js` - the page, its styling and its behaviour.
- `fx.js` - the shot effects (plain JS, no libraries). See the comment at the top of the file.
- `img/` - the game's own garage exports of 17 turrets and 11 hulls, and the TWIZY clan logo.
  The tank pictures are Tanki Online's assets: keep the page marked as unofficial, keep the
  "images belong to Tanki Online" credit, and never hotlink images.
- `fonts/` - Orbitron, Rajdhani, Exo 2 and Russo One (latin and cyrillic), SIL Open Font License, texts beside them.
- `test/` - the browser checks and two small sample data files.

## Run it

```
npm install
npx playwright install chromium     # once
npm run serve                       # http://localhost:8000 (the stats cards need the data files, see below)
npm test                            # all checks, then frame-time reports (about 2 minutes)
npm run test:quick                  # the checks only (about 25 seconds)
```

`npm test -- --save-frames <file>` writes a fingerprint of every turret's canvas at five moments, and
`npm test -- --compare-frames <file>` lists every frame that changed since. Use it around any refactor
of `fx.js`. The fingerprints depend on the machine's graphics, so keep the file out of the repo.

## Rules that the tests enforce

- No request leaves the site (fonts and images are hosted here), and every external link opens in a new tab.
- Every file the page uses exists in this branch and is not one of the files the deploy leaves out
  (`test/`, `node_modules/`, `package.json`, `package-lock.json`, `README.md`, `.github/`, `.gitignore`).
- The effect canvas is empty at the end of each turret's 6 second loop, stays inside its box, and the
  loop pauses when the page is not visible. Reduced motion plays one flash only.

## The "Checked" time

`status.json` (`{ "schemaVersion": 1, "checkedAt": "<ISO time>" }`) is written by the deploy workflow on
`main` into the published folder, next to the two data files. It is not in any branch. The page shows it as
the "Checked" chip, because the data files only change when an augment changes, so their own date can be old
even though the wiki was checked this morning. Locally the sample in `test/fixtures` is used, and the chip is
hidden when the file is missing.

## Two things that live elsewhere

- "Next scrape 05:30 UTC" in `site.js` (`SCRAPE_UTC`) mirrors the cron in `main`'s
  `.github/workflows/augments-bot.yml`. Change both together.
- The data files are produced by the bot in `main` (`bot/`). The page only reads them.

## Changing the page

Branch from `site`, change, run `npm run test:quick`, and open a pull request into `site`. When it is
merged, `.github/workflows/deploy.yml` publishes it.
