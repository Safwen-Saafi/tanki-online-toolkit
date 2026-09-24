# Tanki Online Toolkit - Project Overview

> Personal Manifest V3 Chrome extension adding client-side QoL enhancements to
> the browser game Tanki Online.

## Problem

The stock Tanki Online web client gives no way to see who changed equipment
mid-battle or to keep a preferred cosmetic skin visually applied everywhere it
should show. This toolkit patches the running client to add both, for the
developer's own play sessions.

## Users

Single user: the developer, playing Tanki Online. Not built or intended for
other players or public distribution.

## Features

1. **MAIN-world game bundle injector** - patches the live game bundle at
   `document_start` to hook `TankUserActionLog` action dispatch and relay
   actions to isolated-world scripts via `postMessage`. Foundation the other
   two features depend on.
2. **Change-equipment counter** - marks players who swapped equipment
   mid-battle with a warning icon (⚠) next to their nickname in the battle
   stats table.
3. **Custom garage skins** - detects the equipped skin brand for a garage item
   from the mounted/preview image and persistently overrides its displayed
   image (garage list, preview) via injected CSS, using a bundled skin
   database.
4. **Packaging/build tooling** - not yet built. Add proper extension
   packaging (versioning, zip/release output, possibly a manifest build
   step). No `package.json` or build process exists today.

> All three shipped features (1-3) are WIP ports from a larger private
> extension source (`kasp_main.ts`); expect ongoing rework as fixes land
> upstream, not final/stable behavior.

## Data model

No server or account data. All state is either bundled static data or
browser-local storage, keyed by the `kasp_` prefix.

### Skins database (`database/skins.json`, bundled static)

- `brands` (map: image URL -> brand slug) - identifies which skin brand an
  equipped preview image belongs to.
- `names` (map: lowercase RU/EN item name -> canonical English slug) - name
  normalization for matching garage item titles.
- `defaults` (map: item slug -> default image URL) - the stock/default skin
  image per item, prefilled.
- `database` (map: item slug -> map of brand slug -> skin image URL) - full
  catalog of known alternate-brand skin images per item.

### Browser storage (per-browser-profile, not synced)

- `localStorage["kasp_equipped_skins"]` (map: item slug -> chosen skin image
  URL) - the skin the user wants persistently displayed for that item.
- `localStorage["kasp_base_images"]` (map: item slug -> array of observed
  default/base image URLs) - learned defaults, merged with `defaults` at
  read time.
- `sessionStorage["kasp_player_changes_cache"]` (map: nickname -> change
  count) - equipment-change count for the current battle, cleared on new
  battle id or when leaving the battle canvas.

> Storage key prefix `kasp_` and the `database/skins.json` shape are
> load-bearing - later features (e.g. packaging) must not rename or
> restructure these without updating every reader.

## Tech stack

- **Chrome Extension, Manifest V3** - `manifest.json` declares content
  scripts, injection worlds, and web-accessible resources.
- **Vanilla JavaScript** - no framework, no bundler, no TypeScript build; each
  script is a self-contained IIFE.
- **MAIN-world content script** (`injector.js`) - only script permitted to
  patch the page's own bundle/global scope; talks to isolated-world scripts
  via `window.postMessage`.
- **Isolated-world content scripts** (`change_counter.js`,
  `garage_skins.js`) - DOM-scraping against the live game client's class
  names, reading/writing `localStorage`/`sessionStorage`.

## Monetization

Not applicable. Personal-use tool, never monetized.

## UI/UX

No dedicated UI or routes. Visual footprint is minimal, injected into the
existing game screens:

- Battle stats table - a small red ⚠ glyph appended next to a nickname when
  that player changed equipment during the battle.
- Garage screen - equipped-item images (list thumbnail and mounted preview)
  are swapped via injected CSS to show the user's chosen skin brand instead
  of whatever the game would otherwise render.

No game CSS files are modified; changes are scoped to the specific elements
each script targets.

## Deployment

Not published. Loaded locally as an unpacked extension via
`chrome://extensions` -> Developer mode -> Load unpacked. No Chrome Web Store
listing planned, no build/output pipeline yet (tracked as feature 4).

## Open questions

> None outstanding - both plans agree. The one flagged risk (WIP-port status
> of features 1-3, expect rework) is carried into the Features section above
> rather than left here, since it's a standing fact, not a plan
> contradiction to resolve.
