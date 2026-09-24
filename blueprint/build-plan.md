# Build Plan

List the features that make up your project, high level and in rough build order.
Keep each item to one line; the details come later in `/feature`.

Plain bullets are fine. When both planning docs are ready, run `/overview`.
It adds tracking numbers and checkboxes to your feature list before generating
the project overview.

Run `/feature` to spec the next unchecked item, or `/feature 2` to pick one.
Keep completed items checked and append new features as the project grows.
Do not renumber completed features; their archived specs refer to those IDs.

Scaffolding the app and prototyping its look are pre-build steps, not features.
Start with your first real slice of functionality.

## Your features

- [x] 1. **MAIN-world game bundle injector** - patches the live game bundle at
      `document_start` to hook `TankUserActionLog` action dispatch and relay
      actions to isolated-world scripts via `postMessage`
- [x] 2. **Change-equipment counter** - marks players who swapped equipment
      mid-battle with a warning icon next to their nickname in the battle
      stats table
- [x] 3. **Custom garage skins** - detects the equipped skin brand for a
      garage item and persistently overrides its displayed image using a
      bundled skin database
- [ ] 4. **Packaging/build tooling** - add proper extension packaging
      (versioning, zip/release output, maybe a manifest build step); currently
      no `package.json` or build process exists

> TODO (confirm): items 1-3 are marked shipped but flagged as WIP ports from a
> larger private extension (`kasp_main.ts`) - expect rework, not treat as
> final/stable.
