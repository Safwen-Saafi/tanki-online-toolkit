# Project Plan

## 1. Problem - What problem are we solving?

Personal quality-of-life (QoL) modding toolkit for the browser game Tanki
Online. Provides small client-side enhancements (battle-stat overlays,
cosmetic skin persistence) that the stock game client does not offer.

> TODO (confirm): no explicit problem statement was given beyond "personal QoL
> mod" — confirm this framing matches intent.

## 2. Users - Who is this for?

Single user (the developer), for personal use while playing Tanki Online. Not
intended for public distribution.

## 3. Features - What does the MVP need?

Already shipped (see build-plan for checked items):

- Change-equipment counter: marks players who swapped equipment mid-battle
  with a warning icon next to their nickname in the battle stats table.
- Custom garage skins: detects the equipped skin "brand" for a garage item and
  persistently overrides its displayed image (garage list, mounted preview)
  via injected CSS, using a bundled skin database.
- MAIN-world injector: patches the game's own bundled JS at load time to hook
  its internal `TankUserActionLog` action dispatch and relay actions
  (`postMessage`) to the isolated-world content scripts above.

## 4. Data - What are we storing?

- `database/skins.json` (bundled, static): skin brand map, name translation
  table (RU/EN), per-item default image URLs, per-item per-brand skin image
  URL database.
- Browser `localStorage`: `kasp_equipped_skins` (item -> chosen skin image
  URL), `kasp_base_images` (item -> known default/base image URLs).
- Browser `sessionStorage`: `kasp_player_changes_cache` (nickname -> equipment
  change count for the current battle).

No server-side or account data; everything is local to the browser profile.

## 5. Tech - What stack are we using?

- Chrome Extension, Manifest V3 (`manifest.json`).
- TypeScript (strict mode), compiled with `tsc` to the plain JS the manifest
  loads as content scripts. No bundler, no framework; each script stays a
  standalone script (no ES module imports/exports across files), matching how
  Chrome loads MV3 content scripts today.
- Content scripts injected at `document_start`: one in the page's `MAIN`
  world (`injector.ts`, patches the game bundle and relays actions), two in
  the extension's isolated world (`change_counter.ts`, `garage_skins.ts`).
- No frameworks, no UI libraries - DOM queries and inline styles/CSS strings
  only, targeting the live Tanki Online web client's own class names.

> TODO (confirm): code is explicitly described as a "WIP port" of modules
> from a larger private extension (`src/kasp_main.ts`) - expect ongoing rework
> as fixes land upstream in that source.

> Changed 2026-09-24: migrated from plain JavaScript to TypeScript (build-plan
> feature 4), for senior-level static typing on code that patches a live
> third-party page. See build-plan.md and coding-standards.md.

## 6. Monetize - How will this make money?

None. Personal-use tool, not monetized.

## 7. UI/UX - How should this look and feel?

No dedicated UI. Visual footprint is intentionally minimal and non-intrusive:
a small red warning glyph (⚠) next to a nickname, and CSS-level image
substitution for garage skins. No game CSS files are modified; scripts avoid
touching layout beyond the specific elements they annotate.

## 8. Deployment - Where and how will this ship?

Not shipped/published. Loaded locally as an unpacked Chrome extension
(`chrome://extensions` -> Developer mode -> Load unpacked) for personal use.
No Chrome Web Store listing planned.

## 9. Usage model and constraints (optional)

- Single user, local browser only, not internet-facing as a service.
- Trusted context: runs against the real tankionline.com client the user
  plays on; a MAIN-world script patches that game's live bundle, so care is
  needed to not break gameplay for the user's own session.
- No compliance/audit requirements. No multi-tenant concerns.
- Explicit non-requirements: no packaging/store distribution, no
  monetization, no multi-user support.
