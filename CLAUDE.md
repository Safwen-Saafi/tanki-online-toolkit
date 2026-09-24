# CLAUDE.md

This file provides guidance to AI agents (Claude Code, Antigravity, or others) working in this repository.

## What this is

A small, growing collection of independent quality-of-life modules for the Tanki Online web client (`*.tankionline.com`), packaged as an unpacked Manifest V3 Chrome extension. Vanilla JS, no build step, no framework, no bundler.

## Original source — read this before touching game selectors or architecture

This repo's modules were ported from a larger, more complete sibling extension, **Kaspersky's Inventions**, developed locally at:

```
C:\Users\saafi\Desktop\Kaspersky-Inventions-for-Tanki-Online
```

That repo is the canonical reference for this game's DOM structure, CSS class names (`*ComponentStyle-*`), `localStorage`/`sessionStorage` key conventions, and the overall content-script architecture. **Always check that repo first** — specifically `src/kasp_main.ts` and `src/kasp_injector.ts` — before:
- fixing a bug in a module that also exists there (fix it there too, or at least check whether the same bug exists there),
- adding a new module (check whether Kaspersky's Inventions already has a working implementation to port from, rather than reverse-engineering the game from scratch),
- looking for a game DOM selector or CSS class name (it very likely already has one, discovered through trial and error).

If asked to fix something here that also affects Kaspersky's Inventions, say so explicitly and ask whether the fix should be mirrored there.

## Why this has to be a real unpacked extension, not a Tampermonkey userscript

This was tested and confirmed the hard way: `injector.js` needs to intercept the game's own `main.*.js` bundle *before* it executes, which requires a **native, statically-declared** `"world": "MAIN"` + `"run_at": "document_start"` content script (see `manifest.json`). Two things specifically rule out Tampermonkey for this:

1. **CSP**: Tampermonkey's `@grant none` mode (needed for real page-context execution) injects itself via a `data:text/javascript;base64,...` script tag on some browser/version combos. Tanki Online's CSP doesn't allow `data:` in `script-src`, so that injection gets blocked outright — the whole userscript silently never runs.
2. **Timing guarantee**: even switching to `@grant unsafeWindow` (which avoids the CSP issue), Tampermonkey's `document-start` is best-effort, not a hard guarantee. A native Manifest V3 content script declared statically in `manifest.json` gets a browser-level guarantee that it runs before *any* page script, including the game's own bootstrap — Tampermonkey's dynamic registration cannot match that, and consistently lost the race against the game's `main.*.js` tag in testing, independent of any other extensions running.

**Conclusion: don't try to make `injector.js`-dependent modules (like `change_counter.js`) work as Tampermonkey scripts.** If you need a disposable/isolated test build of a module that *doesn't* depend on the injector (like `garage_skins.js`, which only reads/writes DOM and storage), a Tampermonkey script is fine for that. Anything that needs `window.__kaspSendAction` needs the real extension.

## Modules

- **`injector.js`** (MAIN-world content script, `document_start`) — patches a hook into the game's own minified bundle so `TankUserActionLog` calls (e.g. `CHANGE_EQUIPMENT`) become observable via `window.postMessage({ type: 'kasp:useraction', detail: [...] })`. Fragile by construction: it locates the hook point via a regex against the bundle's minified source (`/static/js/main.<hash>.js`), which can silently stop matching if the game ships a rebuilt bundle with different minified variable names — if that happens, the original script just gets re-injected unpatched, with zero errors, and everything downstream silently stops working. If a module that depends on this stops receiving events, check this regex match first, not the downstream module's logic.
- **`change_counter.js`** (isolated-world content script) — listens for `CHANGE_EQUIPMENT` events from the injector, counts them per player for the current battle (`sessionStorage` key `kasp_player_changes_cache`, cleared on `kasp:battle:id` or on leaving `.BattleComponentStyle-canvasContainer`), and appends a small self-contained `<span class="kasp-change-mark">` next to the nickname of anyone who changed equipment, inside `.BattleTabStatisticComponentStyle-nicknameCell`. Deliberately does **not** use a separate flex-column table cell (`kasp-change-td`/`kasp-change-th`) the way Kaspersky's Inventions does — that approach depends on the game's full production stylesheet fixing every other column to a set width, which this repo intentionally does not ship (no game CSS is loaded or modified here — keep it that way unless explicitly asked otherwise).
- **`garage_skins.js`** (isolated-world content script) — detects the equipped garage skin brand and force-overrides its image everywhere it appears. Loads `database/skins.json` via `chrome.runtime.getURL` (declared in `web_accessible_resources`). **Bug history worth knowing**: the original version (in Kaspersky's Inventions) detected the equipped brand by scanning the skin-picker thumbnail list and taking the *first recognized* thumbnail — not the one actually selected — so it frequently saved the wrong skin as the override. The fix (present in this repo and backported to Kaspersky's Inventions on branch `fix/garage-skins-unrecognized-fallback`) instead reads the real mounted/preview image's `src` and matches that against the skin database; the thumbnail-list scan is now only a last resort for when no preview element exists yet. It also falls back to the item's Standard image when the equipped skin matches no known brand at all (an uncatalogued/new skin), instead of leaving a stale override in place.

## Loading it

`chrome://extensions` → Developer mode → Load unpacked → select this repo's root folder. No build step — edit the `.js` files directly and reload the extension + refresh the game tab to see changes.

## Adding a new module

One file per module, registered as its own `content_scripts` entry in `manifest.json` — isolated world by default, `world: "MAIN"` only if it specifically needs to reach the real page `window` (like `injector.js` does). Keep modules self-contained; the only cross-module communication channel is `window.postMessage` (for anything coming from `injector.js`) plus whatever each module keeps in `localStorage`/`sessionStorage`. Check the original Kaspersky's Inventions repo first (see above) for a working reference before building a module from scratch.
