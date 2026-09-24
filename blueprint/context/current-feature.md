# Feature: Packaging/build tooling

**From build-plan:** feature 4
**Status:** not started

## Goal

Give the extension a real, repeatable release process: a `package.json` for
metadata/scripts, and a build script that assembles the extension's runtime
files into a versioned `.zip` under `release/`, so a shareable/loadable
package can be produced with one command instead of manually zipping files.

## In scope

- `package.json` at repo root: name, version (mirrors `manifest.json`
  version), `private: true`, one devDependency for zipping, one npm script
  (`build`) that runs the build script.
- `scripts/build.js`: reads `manifest.json` to get the version, copies the
  extension's runtime files (`manifest.json`, `injector.js`,
  `change_counter.js`, `garage_skins.js`, `database/skins.json`) into
  `dist/`, then zips `dist/` into `release/tanki-online-toolkit-v<version>.zip`.
- Wiring `npm run build` to produce that artifact from a clean checkout.
- Documenting the new `Build` command in `AGENTS.md`.

## Out of scope

- Chrome Web Store submission or publishing automation.
- CI/GitHub Actions packaging on tag/push (separate, later choice via `/ci`
  if ever wanted).
- Linting or a TypeScript build step - no such tooling exists yet and none is
  requested by this feature.
- Auto-bumping the version - the script reads whatever version is currently
  in `manifest.json`; bumping it remains a manual edit before running build.

## Build loop

Build one step at a time, never the whole feature at once.

1. Plan mode lays out the step before any code.
2. The AI implements just that step.
3. It shows the diff (not full files); you read it and understand it.
4. You approve, then choose whether to commit a checkpoint or roll straight on.
   Checkpoints are optional; `/complete` makes the real feature-level commit at the end.

Never accept a step you haven't read. If a diff is too big to review, the step was too big, so split it.

## Build steps

- [ ] **Step 1 - Add `package.json`** - create `package.json` with `name`,
      `version` matching `manifest.json`'s current version, `private: true`,
      and `archiver` as a devDependency (no runtime dependencies). *Done
      when:* `npm install` succeeds and creates `node_modules/` (gitignored)
      with no errors.
- [ ] **Step 2 - Write the build script** - add `scripts/build.js`: reads
      `manifest.json` for the version, then uses `archiver` to write
      `release/tanki-online-toolkit-v<version>.zip` directly from the fixed
      list of runtime files/folders (`manifest.json`, `injector.js`,
      `change_counter.js`, `garage_skins.js`, `database/skins.json`) at their
      existing paths - no intermediate copy directory. *Done when:* running
      `node scripts/build.js` produces
      `release/tanki-online-toolkit-v1.2.0.zip` (matching the current
      manifest version) containing exactly those 5 entries, and the zip loads
      successfully when extracted and loaded via `chrome://extensions` ->
      Load unpacked.
- [ ] **Step 3 - Wire the npm script** - add `"build": "node
      scripts/build.js"` to `package.json`'s `scripts`. *Done when:* `npm run
      build` produces the same zip as Step 2's direct invocation.
- [ ] **Step 4 - Document the command** - update the Commands section of
      `AGENTS.md` to add `Build: npm run build` (producing the versioned zip
      under `release/`), alongside the existing manual "Load unpacked" run
      instructions. *Done when:* `AGENTS.md` accurately describes both the
      manual dev flow and the new packaged build.

## Files / areas

- New: `package.json`, `scripts/build.js`.
- Changed: `AGENTS.md` (Commands section).
- Generated, not committed (already gitignored): `node_modules/`, `release/`.

## Data / contracts

- None. The build script only reads `manifest.json`'s existing `version`
  field; it does not define or change any runtime data shape.

## Testing

No test runner is configured for this project (see `coding-standards.md`),
and this feature does not introduce one - `scripts/build.js` is a small,
one-shot file-copy-and-zip script, not the kind of reusable parsing/validation
logic the testing gate targets. Verification is by running the build and
inspecting the artifact:

- `npm run build` exits 0.
- `release/tanki-online-toolkit-v<version>.zip` exists and its version
  matches `manifest.json`.
- Extracting the zip and loading it via `chrome://extensions` -> Load
  unpacked works with no manifest errors, and the extension behaves the same
  as loading the repo root directly (spot-check: change-counter warning icon
  and garage skin override both still function against the live game).

## Notes for the AI

- Keep `scripts/build.js` dependency-free beyond `archiver`; don't reach for
  a bundler or TypeScript - out of scope per project-plan.md and
  coding-standards.md (no build-step framework has been adopted).
- `release/` is already in `.gitignore`; don't remove that. No `dist/` output
  is created by this feature.
- The file list to package is fixed and short (5 entries) - hardcode it in
  the script rather than globbing the whole repo, so `.claude/`, `blueprint/`,
  and other non-runtime files never end up in the shipped zip.
- Match the existing console-log/comment conventions in
  `coding-standards.md` (no banner comments, comment only the why).
