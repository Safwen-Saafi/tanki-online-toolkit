# Coding Standards

Reflects the real stack: a Manifest V3 Chrome extension in plain vanilla
JavaScript. No framework, no bundler, no TypeScript build, no package manager.

## JavaScript

- Plain ES2020+ JavaScript, no transpilation step. Code must run as-is in
  Chrome without a build.
- Each content script wraps itself in an IIFE (`(function () { 'use strict';
  ... })();`) to avoid leaking globals into the page.
- No `any`-style looseness excuse: still guard external/untrusted values
  (game DOM content, postMessage payloads, localStorage/sessionStorage reads)
  with `try/catch` or type checks before use, since this code runs against a
  live third-party page whose structure can change without notice.
- Prefer `const`/`let`, arrow functions where they read cleaner, template
  literals over string concatenation.

## Extension architecture

- `manifest.json` is the source of truth for injection order and world
  (`MAIN` vs isolated). Keep `run_at: document_start` for scripts that must
  race the game bundle.
- `injector.js` (MAIN world) is the only script allowed to touch the page's
  own bundle/global scope directly. It communicates to isolated-world scripts
  via `window.postMessage`, never by sharing object references (isolated and
  MAIN worlds do not share objects).
- Isolated-world scripts (`change_counter.js`, `garage_skins.js`) read game
  state only through the DOM (`querySelector`/`querySelectorAll` against the
  game's real class names) or the `kasp:useraction` message channel. Do not
  assume a class name is stable; a selector that finds nothing should fail
  silently, not throw.
- Persisted state keys (`localStorage`/`sessionStorage`) are prefixed `kasp_`.
  Reuse existing keys; do not introduce a second naming scheme.
- `database/skins.json` is bundled static data, fetched at runtime via
  `chrome.runtime.getURL`. Keep it valid JSON with no comments (JSON doesn't
  support them); document data shape assumptions in the code that reads it
  instead.

## File organization

- One file per content-script concern, flat at the repo root (matches
  current layout: `injector.js`, `change_counter.js`, `garage_skins.js`).
  Static data goes under `database/`.
- Do not introduce a `src/` build-output split unless a build step is
  actually adopted later.

## Naming

- Functions/variables: camelCase.
- Constants (storage keys, cache keys): SCREAMING_SNAKE_CASE.
- Console log prefixes: keep the existing `[KI-test][<module>]` tag convention
  so log output stays attributable to a specific script during manual
  debugging in DevTools.

## Error handling

- Wrap any access to page-owned objects, postMessage payloads, or storage
  parsing in `try/catch`. A failure here must degrade silently (skip the
  feature for that tick) rather than throw and break the host page.
- Never let a thrown exception in a content script surface to the game's own
  console as an uncaught error the user has to investigate; log a warning
  instead.

## Testing

No test runner is configured, and none is planned until the roadmap's
packaging/build-tooling work lands. This is a DOM-scraping browser extension
with no pure-logic modules of meaningful size; verification is manual
(`/check` or manual load-unpacked testing in Chrome against the live game),
not unit tests. If `AGENTS.md` later declares a `test` command, that becomes
the gate per the Blueprint's standard testing switch; until then, do not add
a runner mid-feature.

## Browser verification

This project is 100% browser-driven. Every non-trivial change should be
verified by loading the unpacked extension in Chrome, navigating to
`tankionline.com`, and observing the actual behavior (battle stats table,
garage screen) plus the DevTools console for the module's log prefix and any
errors. Screenshots are the primary evidence artifact when reporting a
verified change.

## Code Quality

- No commented-out code unless specified.
- No unused variables.
- Keep functions under 50 lines when possible; the existing `tick()`-style
  polling functions in `garage_skins.js` are an accepted exception given the
  branching DOM-state logic they encode.

## Comments

Write code that explains itself; comment only what the code cannot say.
Over-commenting is a common AI tell, so resist it.

- Comment the **why**, not the **what**. Delete any comment that restates the code.
- No banner/header blocks, section dividers, or step-by-step narration of obvious
  code.
- A comment earns its place only when it captures something the code can't: a
  non-obvious decision, a gotcha or workaround (e.g. why a regex targets a
  specific bundle pattern, why a fallback exists), or a pointer to the
  original source module (`kasp_main.ts:<lines>`) this was ported from.
- When in doubt, leave the comment out.

## Writing

- No em dashes (U+2014) in generated content: docs, comments, commit messages,
  READMEs, specs. They read as AI-generated.
- Use a hyphen for `term - description` separators; rephrase prose with commas,
  parentheses, or a colon. Avoid en dashes and the ellipsis character too.
