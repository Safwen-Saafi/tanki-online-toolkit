# Coding Standards

Reflects the real stack: a Manifest V3 Chrome extension, source in TypeScript
(strict mode), compiled with `tsc` to the plain JS the manifest loads. No
bundler, no framework. (Migration from the prior plain-JS codebase is
build-plan feature 4; until that lands, treat the `.js` files as the
pre-migration state and these rules as the target for new/converted code.)

## TypeScript

- `strict: true` in `tsconfig.json` (this turns on `strictNullChecks`,
  `noImplicitAny`, and the rest as one switch - don't cherry-pick a subset).
- No `any`. Use `unknown` for genuinely untyped external input (DOM text,
  `postMessage` payloads, `JSON.parse` results, `localStorage` reads) and
  narrow it with type guards before use. `any` defeats the entire point of
  converting this DOM-scraping code to TypeScript.
- No non-null assertions (`!`) on values whose presence isn't actually
  guaranteed - a `querySelector` result, a map lookup. Use an explicit
  null check or optional chaining instead; the game's DOM is a live third
  party surface that can legitimately return `null`.
- Prefer `readonly` on object/array fields that aren't mutated after
  construction, and `as const` for literal maps (skin brand tables, name
  translation tables) so their key/value types stay literal instead of
  widening to `string`.
- Model the domain with real types instead of loose objects: a `Brand`
  string union or branded type for skin brand slugs, an `ItemSlug` type for
  normalized item names, an interface for the `skins.json` shape
  (`SkinsDatabase { brands: ...; names: ...; defaults: ...; database: ... }`).
  Define these once, import/reuse them; don't re-inline the same object
  shape in every file that touches skins data.
- Discriminated unions over boolean flags for anything with more than two
  real states (for example, a "brand detection result" that can be found,
  defaulted, or absent - not three separate booleans).
- Exhaustiveness: a `switch` over a union or enum ends with a `default` that
  either handles every remaining case or asserts unreachability
  (`const _exhaustive: never = value`), so a new union member fails to
  compile instead of silently falling through.
- Use `@types/chrome` for `chrome.*` APIs (`chrome.runtime.getURL`, etc.)
  instead of ambient `declare const chrome: any`.
- Function signatures declare explicit parameter and return types at public/
  exported boundaries; rely on inference for short local variables where the
  type is obvious from the initializer.

## Extension architecture

- `manifest.json` is the source of truth for injection order and world
  (`MAIN` vs isolated). Keep `run_at: document_start` for scripts that must
  race the game bundle.
- `injector.ts` (MAIN world) is the only script allowed to touch the page's
  own bundle/global scope directly. It communicates to isolated-world scripts
  via `window.postMessage`, never by sharing object references (isolated and
  MAIN worlds do not share objects, and TypeScript can't type-check across
  that boundary - validate the message shape on receipt instead of trusting
  it).
- Isolated-world scripts (`change_counter.ts`, `garage_skins.ts`) read game
  state only through the DOM (`querySelector`/`querySelectorAll` against the
  game's real class names) or the `kasp:useraction` message channel. Do not
  assume a class name is stable; a selector that finds nothing should fail
  silently, not throw.
- Each compiled entry point stays a standalone script with no cross-file
  `import`/`export` (`"module": "None"` in `tsconfig.json`) - MV3 content
  scripts load as classic scripts, not ES modules. Share types via a local
  `.d.ts`/type-only file included in each script's compilation, not via
  runtime imports.
- Persisted state keys (`localStorage`/`sessionStorage`) are prefixed `kasp_`.
  Reuse existing keys; do not introduce a second naming scheme.
- `database/skins.json` is bundled static data, fetched at runtime via
  `chrome.runtime.getURL`. Type its shape with an interface and validate (or
  at least type-assert deliberately, not implicitly) the fetched JSON against
  it; keep the file valid JSON with no comments.

## File organization

- Source: one `.ts` file per content-script concern, flat at the repo root
  (`injector.ts`, `change_counter.ts`, `garage_skins.ts`), matching the
  current layout. Static data goes under `database/`.
- Compiled output: plain `.js` files the manifest actually loads. Keep the
  compiled files at the same paths the manifest already references so the
  extension still runs from the repo root when unpacked; don't introduce a
  `dist/` split unless a later feature (e.g. packaging) needs it.
- Shared types live in one `.d.ts` file (or a small `types.ts`) referenced by
  each script's compilation, not duplicated per file.

## Naming

- Functions/variables: camelCase.
- Types/interfaces: PascalCase, no `I` prefix.
- Constants (storage keys, cache keys): SCREAMING_SNAKE_CASE.
- Console log prefixes: keep the existing `[KI-test][<module>]` tag convention
  so log output stays attributable to a specific script during manual
  debugging in DevTools.

## Error handling

- Wrap any access to page-owned objects, postMessage payloads, or storage
  parsing in `try/catch`, typing the caught error as `unknown` and narrowing
  before use (`error instanceof Error`). A failure here must degrade
  silently (skip the feature for that tick) rather than throw and break the
  host page.
- Never let a thrown exception in a content script surface to the game's own
  console as an uncaught error the user has to investigate; log a warning
  instead.

## Testing

No test runner is configured. Adding one is a separate, explicit choice
(`/tests`) if pure-logic modules (name normalization, brand-matching)
eventually justify it; the TypeScript compiler itself is the main new
correctness gate this migration adds. Until a runner exists, verification is
manual (`/check` or manual load-unpacked testing in Chrome against the live
game), not unit tests.

## Browser verification

This project is 100% browser-driven. Every non-trivial change should be
verified by loading the unpacked extension in Chrome (compiled output, not
raw `.ts`), navigating to `tankionline.com`, and observing the actual
behavior (battle stats table, garage screen) plus the DevTools console for
the module's log prefix and any errors. Screenshots are the primary evidence
artifact when reporting a verified change.

## Code Quality

- No commented-out code unless specified.
- No unused variables or imports (`noUnusedLocals`/`noUnusedParameters` on in
  `tsconfig.json`).
- Keep functions under 50 lines when possible; the existing `tick()`-style
  polling functions in `garage_skins.ts` are an accepted exception given the
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
- Keep doc comments minimal: a one-line purpose on an exported type or
  function is plenty; don't write JSDoc that just repeats the signature the
  type already states.
- When in doubt, leave the comment out.

## Writing

- No em dashes (U+2014) in generated content: docs, comments, commit messages,
  READMEs, specs. They read as AI-generated.
- Use a hyphen for `term - description` separators; rephrase prose with commas,
  parentheses, or a colon. Avoid en dashes and the ellipsis character too.
