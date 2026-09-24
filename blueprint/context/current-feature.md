# Feature: TypeScript migration

**From build-plan:** feature 4
**Status:** not started

## Goal

Convert the extension's three JavaScript content scripts to TypeScript
(strict mode, senior-level standards) with a `tsc` build step, so code that
patches a live third-party page's own bundle gets static typing instead of
`any`-shaped guesswork. Behavior stays identical; this is a typing/tooling
change, not a rewrite of logic.

## In scope

- `package.json` at repo root: `name`, `version` mirroring `manifest.json`,
  `private: true`, `typescript` and `@types/chrome` as devDependencies, one
  npm script (`build`) running `tsc`.
- `tsconfig.json`: `strict: true`, `target: "ES2020"`, `module: "None"` (each
  script stays a standalone classic script, no cross-file imports/exports -
  matches how MV3 loads content scripts today), `noUnusedLocals` and
  `noUnusedParameters` on, `lib` including `"dom"`.
- `types.d.ts`: shared ambient types with no `import`/`export` (so they're
  globally visible to every script without a runtime import) - `SkinsDatabase`
  matching `database/skins.json`'s real shape (`brands`, `names`, `defaults`,
  `database`), and `KaspUserActionMessage` for the `postMessage` relay
  (`{ type: "kasp:useraction"; detail: string[] }`).
- Converting `injector.js` -> `injector.ts`, `change_counter.js` ->
  `change_counter.ts`, `garage_skins.js` -> `garage_skins.ts`: add types
  (function signatures, the shared types above, `unknown` + narrowing for
  untyped external data) without changing runtime behavior.
- Compiling in place: `tsc` outputs `injector.js`, `change_counter.js`,
  `garage_skins.js` back at the repo root (same paths `manifest.json` already
  references), so no manifest change is needed.
- Untracking the now-generated `.js` files from git and adding them to
  `.gitignore`, since they become build output.
- Documenting the new build-before-load workflow in `AGENTS.md`.

## Out of scope

- Packaging/zip tooling (build-plan feature 5, comes after this and zips the
  compiled `.js` output).
- A bundler, a linter (ESLint), or a test runner - none exist yet and none
  are requested by this feature.
- Any behavioral change to the detection/injection logic itself - this is a
  typing pass, not a logic rewrite. If a real bug is found while typing a
  file, flag it rather than silently "fixing" it mid-step.
- Changing `manifest.json` - the compiled output lands at the same paths it
  already references.

## Build loop

Build one step at a time, never the whole feature at once.

1. Plan mode lays out the step before any code.
2. The AI implements just that step.
3. It shows the diff (not full files); you read it and understand it.
4. You approve, then choose whether to commit a checkpoint or roll straight on.
   Checkpoints are optional; `/complete` makes the real feature-level commit at the end.

Never accept a step you haven't read. If a diff is too big to review, the step was too big, so split it.

## Build steps

- [ ] **Step 1 - Add TypeScript build tooling** - create `package.json`
      (name, version matching `manifest.json`, `private: true`,
      devDependencies `typescript` + `@types/chrome`) and `tsconfig.json`
      (strict mode, `module: "None"`, `target: "ES2020"`, DOM lib,
      `noUnusedLocals`/`noUnusedParameters`), plus an npm `build` script
      running `tsc`. *Done when:* `npm install` succeeds with no errors.
- [ ] **Step 2 - Add shared ambient types** - create `types.d.ts` with
      `SkinsDatabase` (matching `database/skins.json`'s real shape) and
      `KaspUserActionMessage`. *Done when:* `npm run build` exits 0 (no `.ts`
      source files reference it yet, but the config and types file are
      valid).
- [ ] **Step 3 - Convert `injector.ts`** - rename/convert from `injector.js`,
      typing the `safeWalk` recursion, the `postMessage` payload
      (`KaspUserActionMessage`), and the mutation-observer callback; replace
      the ambient `chrome`-free MAIN-world assumptions with real DOM types.
      Untrack `injector.js` from git and add it to `.gitignore`. *Done when:*
      `npm run build` emits `injector.js` at the repo root, and loading the
      unpacked extension against `tankionline.com` still shows the
      `[KI-test][injector]` load and patch-applied console logs.
- [ ] **Step 4 - Convert `change_counter.ts`** - same treatment: type the
      `playerChanges` map, the `kasp:useraction` message handler (narrow
      `unknown` event data against `KaspUserActionMessage`), and the
      DOM-sync logic. Untrack `change_counter.js`, add to `.gitignore`.
      *Done when:* `npm run build` emits `change_counter.js`, and the
      warning-icon behavior still works in a real battle (spot-check).
- [ ] **Step 5 - Convert `garage_skins.ts`** - type `SKINS_DATABASE` and
      friends against `SkinsDatabase`, the `getSavedSkins`/`getDefaultImages`
      storage helpers, and the `tick()` DOM-scraping logic. Untrack
      `garage_skins.js`, add to `.gitignore`. *Done when:* `npm run build`
      emits `garage_skins.js`, and the garage-skin override still applies
      correctly in the garage screen (spot-check).
- [ ] **Step 6 - Document the build workflow** - update the Commands section
      of `AGENTS.md`: add `Build: npm run build` (compiles the `.ts` sources
      to the `.js` the manifest loads) and note it must run (or `tsc --watch`
      run) before "Load unpacked" picks up a source change. *Done when:*
      `AGENTS.md` accurately describes the build-then-load workflow.

## Files / areas

- New: `package.json`, `tsconfig.json`, `types.d.ts`, `injector.ts`,
  `change_counter.ts`, `garage_skins.ts`.
- Removed from git tracking (become build output): `injector.js`,
  `change_counter.js`, `garage_skins.js`.
- Changed: `.gitignore`, `AGENTS.md` (Commands section).
- Unchanged: `manifest.json` (same referenced paths), `database/skins.json`.

## Data / contracts

- `SkinsDatabase` (in `types.d.ts`) locks the shape of `database/skins.json`:
  `brands` (URL -> brand slug), `names` (raw name -> canonical slug),
  `defaults` (item slug -> default image URL), `database` (item slug -> brand
  slug -> image URL). Load-bearing: build-plan feature 5 (packaging) and any
  later feature reading this file must reuse this type, not re-derive it.
- `KaspUserActionMessage` (`{ type: "kasp:useraction"; detail: string[] }`)
  locks the MAIN-world -> isolated-world `postMessage` contract between
  `injector.ts` and `change_counter.ts`.

## Testing

No test runner is configured, and this feature does not add one (see
`coding-standards.md`) - there's no pure-logic module large enough yet to
justify it; the TypeScript compiler itself is the new correctness gate.
Verification per step:

- `npm run build` (or the project's declared build command) exits 0 with no
  type errors - this is the primary automated evidence for every step.
- Manual browser check per converted file: load the unpacked extension
  (after building), navigate to `tankionline.com`, and confirm the specific
  behavior that file owns still works (injector: console logs + patch
  applied; change_counter: warning icon in battle; garage_skins: skin image
  override in garage), per that step's done-when.

## Notes for the AI

- Preserve exact runtime behavior. Do not "improve" the detection logic,
  regexes, or DOM selectors while typing them - that's a separate fix if a
  real bug turns up, not silent scope creep here.
- `unknown` + narrowing, not `any`, for anything crossing an untyped boundary
  (DOM read, `postMessage` data, `JSON.parse`, `localStorage` read).
- Keep the existing `[KI-test][<module>]` console log prefixes exactly as-is;
  they're the debugging convention, not something this migration should
  touch.
- `module: "None"` means no `import`/`export` in the three script files;
  `types.d.ts`'s interfaces are ambient (no `import`/`export` in that file
  either), so they're visible everywhere without wiring.
- After each conversion step, the repo must still load and run as an
  unpacked extension - never leave a step where the compiled `.js` is stale
  or missing.
