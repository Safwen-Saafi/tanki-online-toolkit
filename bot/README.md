# Tanki Augments Bot

Moved from the root `AGENTS.md` on 2026-11-10, word for word.

A separate Node project that is not part of the extension and never ships in
the zip. It scrapes the EN and RU Tanki wiki augment pages and publishes
per-language JSON. It has its own `package.json` and lockfile; run these inside
`bot/`.

- Install: `npm install`, then `npx playwright install chromium` once.
- Build: `npm run build` (compiles `bot/src/` to the gitignored `bot/dist/`).
- Test: `npm test` (builds, then runs Node's built-in test runner on the
  `*.test.ts` files, using the saved wiki snippets in `bot/test/fixtures/`).
- Landing page: it is not in this branch. It lives on the `site` branch, with its own tests and its own
  `AGENTS.md` and `README.md`. Do not change the page from `main`.
- Scrape: `npm run scrape` builds and validates both languages and writes
  `bot/out/augments.en.json` and `bot/out/augments.ru.json`. It exits non-zero
  if either language fails validation. Takes about 40 seconds.
- Other modes: `npm run scrape -- --discover` lists the pages found on each
  hub, `npm run scrape -- --page <en|ru> <item>` parses one page, and
  `npm run scrape -- --publish <dir>` copies the validated files from
  `bot/out/` into `<dir>` only when their content changed.
- Daily run: `.github/workflows/augments-bot.yml` runs the scrape at 05:30 UTC
  (and on manual dispatch; GitHub often starts it hours late). It commits to the
  `data` branch only when an augment really changed, and the `data` branch holds
  the two JSON files and nothing else. The commit message names what changed,
  for example `augments: update EN (2 changed, 1 added)` with one line per
  augment under the language (`npm run scrape -- --publish <dir> --message-file
  <path>` writes it). After every successful check the same workflow calls
  `.github/workflows/deploy-pages.yml` with the time of the check, which it
  writes as `status.json` into the published folder (never committed). A deploy
  that is not a check, such as a push to `site`, keeps the time already live.
  It never touches `main`.
- Publishing: GitHub Pages is set to the "GitHub Actions" source.
  `deploy-pages.yml` checks out the `site` branch (the landing page) and the
  `data` branch (the two JSON files), joins them into one folder, and deploys
  it; nothing is committed back. It also runs by hand from the Actions tab and
  from the `site` branch's own workflow when the page changes. Settings it
  needs: Pages source "GitHub Actions", and `site` listed in the
  `github-pages` environment's deployment branches.
- Published at (GitHub Pages, deployed by `deploy-pages.yml`, folder `/`):
  `https://safwen-saafi.github.io/tanki-online-toolkit/augments.en.json` and
  `.../augments.ru.json`. Both send `Access-Control-Allow-Origin: *`. The landing
  page at the same root is the `site` branch (see its `AGENTS.md`).
- The file shape (`schemaVersion: 2`, `items`, item slugs, augment-name keys,
  `name`, `advantages`, `disadvantages`, `rarity`) is defined in `bot/src/contract.ts` and
  is read by the extension's `src/modules/augments.ts` (types in
  `src/types.d.ts`); do not rename these.
