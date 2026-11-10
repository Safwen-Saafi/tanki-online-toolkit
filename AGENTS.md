# AGENTS.md

Instructions for AI coding agents working in this project. This is the cross-tool
entry point: Codex, OpenCode, Cursor, GitHub Copilot, Gemini CLI, Aider, Zed,
Windsurf, and others read `AGENTS.md`. Claude Code reads `CLAUDE.md`, which imports
this file, so there is a single source of truth.

Claude Code, Codex, and every other AI tool must not add AI attribution to
commits or pull requests, including AI `Co-Authored-By` trailers or generated-by
signatures. Preserve genuine human attribution. See
[Commit and PR attribution](blueprint/context/ai-interaction.md#commit-and-pr-attribution)
for optional tool settings.

## What this is

Tanki Online ToolKit: a personal Manifest V3 Chrome extension that adds quality-of-life features to the browser game Tanki Online, which its own client does not offer: a marker on players who change equipment mid-battle, the chosen garage skins kept on screen, augment info and hidden cards in the garage and on the Containers screen, the old augment pictures, kill, battle and weapon sounds, the battle chat translated into a language the player picks (other players' messages in a box under the kill feed, the player's own through buttons beside the chat box), the game's debug info line in the screen corner hidden, and a tab in the game's own settings to switch each of them on or off. The repo also holds the Tanki Augments Bot, which publishes the wiki's augment data the extension reads.

## Proportional engineering

Build for established requirements, not hypothetical scale, threats, or future
flexibility. Reuse existing code, the standard library, native platform features,
and installed dependencies before adding machinery.

- Unknown scale or extensibility defaults to the smaller reversible design. Do
  not infer enterprise, multi-tenant, hostile-user, or compliance requirements.
- Derive trust and data-integrity boundaries from actual reachability: untrusted
  input, auth/session/ownership, shared persisted data, destructive operations,
  payments, secrets, and sensitive data.
- Ask only when an unknown materially changes behavior, architecture, persisted
  data, interoperability, a real security boundary, or cost. Otherwise choose the
  simplest repository-native implementation.
- Add an abstraction, dependency, service, configuration surface, compatibility
  layer, or security mechanism only for a current requirement.
- Simplicity never removes real trust-boundary validation, data-loss prevention,
  accessibility, explicit security requirements, configured tests, or project rules.
- Stack-specific template standards apply only when the project uses that stack.

## Read these when relevant

- `blueprint/config.json` - deterministic project workflow settings
- `blueprint/context/project-overview.md` - the project's source of truth
- `blueprint/context/coding-standards.md` - read before changing code
- `blueprint/context/ai-interaction.md` - read when running the Blueprint workflow
- `blueprint/context/current-feature.md` - the one feature, fix, or rollback being built right now
- `blueprint/context/battle-stats-table.md` - read before changing anything visual in the in-battle stats panel
- `blueprint/context/garage-skins-screen.md` - read before changing anything in the garage skins module (Skins tab, tiles, main screen blocks)
- `blueprint/context/garage-augments-screen.md` - read before changing anything in the augments module (the item title, tab detection, the Augments tab tiles and the spec box) or the old augment picture swap (the page hooks in `injector.ts`, `old_pictures.ts`, the Containers matching by stable path)
- `blueprint/context/kill-events.md` - read before changing anything in the kill sounds (the game's kill events, how the player is identified, the streak rules, how to add a sound)
- `blueprint/context/battle-sounds.md` - read before changing the end of battle music, the grenade sounds or the weapon sounds (Magnum, Striker, Gauss) (the game's battle time, the music rules, how a grenade throw is detected, how the game's weapon sound files are named and swapped)
- `blueprint/context/settings-tab.md` - read before changing the extension's tab in the game's settings screen (how the game builds its tabs, bar and panels, the settings-tab hook in `injector.ts` that adds ours, how `settings_tab.ts` fills our panel, the switches and the dropdowns and how `switches.ts` saves and applies them, and the dead ends)
- `blueprint/context/chat-translation.md` - read before changing the chat translation (how the game handles its battle chat and chat box, the chat hook in `injector.ts`, the box under the kill feed and the translation buttons in `chat_translation.ts`, Google's translate address, the flags, and the dead ends)
- `blueprint/context/workflow-rules.md` - read when running a Blueprint workflow command (the skills and the feature loop, the project configuration and quality gates, automation, dashboard activity, automatic checks)
- `bot/README.md` - read before working on the Tanki Augments Bot (`bot/`): its commands, the daily run, publishing and the file shape the extension reads

Reuse relevant context already loaded in the session. Claude Code imports only
this file; its Blueprint skills load the other files on demand.

## Workflow

Build one feature, fix, or rollback at a time, behind review gates: `/feature` (or `/fix`, `/rollback`) -> `/implement` -> `/check` -> `/audit current` -> `/complete`. Approve the spec before `/implement`. The full rules (the skills, the adapters, `blueprint/config.json` and its quality gates, Autopilot and Continuous Mode, dashboard activity, automatic GitHub checks) are in `blueprint/context/workflow-rules.md`; read it when running a workflow command.

Tracked commands record their activity first, with `node .claude/skills/doctor/scripts/run-state.mjs start --command <skill> --summary <summary> --boundary <boundary>` (then `update` and `finish`); never edit `blueprint/.state/run.json` by hand. The rules are in the same file.

## Commands

Manifest V3 Chrome extension. Source is TypeScript (strict mode) in `src/`,
compiled with `tsc` to the plain JS `extension/manifest.json` loads. No
bundler. Everything inside `extension/` ships to Chrome; everything outside it
does not.

- Install: `npm install`
- Build: `npm run build` (compiles `src/injector.ts` and the files in
  `src/modules/` to `extension/js/`, mirroring the `src/` folders, at the
  paths the manifest references). Run this after any `.ts` change, before
  reloading the extension - `extension/js/` is gitignored build output, not
  source.
- Load/run: `npm run build`, then `chrome://extensions` -> enable Developer
  mode -> Load unpacked -> select this repo's `extension/` folder. Reload the
  extension after any rebuild.
- Lint: none configured. `tsc`'s strict-mode type check is the current
  correctness gate.
- Package: `npm run package` (after `npm run build`) zips the whole
  `extension/` folder into `release/tanki-online-toolkit-v<version>.zip`, with
  `manifest.json`, `js/`, `styles/`, `data/` and `icons/` at the zip root. There is no
  file list to maintain: a new file the manifest references just has to live
  inside `extension/`. The script stops if `extension/js/` is missing.
- Release: `npm run release -- <patch|minor|major|x.y.z> [--dry-run]
  [--notes-file <path>]`. Bumps the version in `extension/manifest.json` and
  `package.json`, commits, tags `v<version>`, and pushes. Refuses to run
  unless on `main`, the working tree is clean, something has actually
  changed since the last release tag, and the project builds. `--dry-run`
  prints the plan without touching anything. `--notes-file <path>` makes the
  release commit's body that file's content (see `ai-interaction.md`'s
  Releases section for the full assistant-driven process, including the
  fixed description template).
- Old-style picture for a new augment: double-click `scripts/old-style-picture/start.cmd` (a terminal window with a menu: paste the new
  picture addresses, choose the old background, look at the result, save) to make the old-style picture of an augment the devs added after
  they changed the pictures (it has no bundled old file) from its new picture; it adds the file to `extension/old_pictures/` and the path to
  `extension/data/old_pictures.json`. The command-line version is `node scripts/old-style-picture/make.mjs <picture address> --like <old
  picture>` (`--list-colors` shows the old colours). Run by hand, when a new augment shows in the new style. Not part of the extension, never
  commits. See `scripts/old-style-picture/README.md`.
- Augment numbers for the battle tab: when the game adds augments (about every two months), paste `scripts/augment-ids/capture.js` into the
  game's DevTools console in the garage with any turret's Augments tab open, once with the game in English and once in Russian (each run
  saves `augment-ids-EN.json` or `augment-ids-RU.json` in Downloads), then `node scripts/augment-ids/merge.mjs <EN file> <RU file>` merges them
  into `extension/data/augment_ids.json` (it checks every line and refuses a broken file; `--dry-run` writes nothing). Until then a new
  augment says "No information yet" in the battle tab. Not part of the extension, never commits. See `scripts/augment-ids/README.md`.
- Pushing a `v*.*.*` tag triggers `.github/workflows/release.yml`, which
  builds, packages, and opens a **draft** GitHub Release with the zip
  attached and the release commit's body as the description - it never
  auto-publishes; open the draft on GitHub to review, edit, and publish it.

### Tanki Augments Bot (`bot/`)

A separate Node project, never shipped in the zip, with its own `package.json`, lockfile and tests (run them inside `bot/`). Its commands, the daily run, publishing and the file shape the extension reads are in `bot/README.md`.

Testing for the extension is opt-in and not yet set up; there is no unit test
runner for `src/`. Run `/tests` or `$tests` if one is wanted later.
Verification there is manual: load unpacked, play against `tankionline.com`,
check DevTools console for the `[KI-test]` log prefixes and behavior (battle
stats warning icon, garage skin overrides). The bot is the exception, with its
own tests, described in `bot/README.md`.

Browser testing is also opt-in and not set up. Run `/tests browser` or
`$tests browser` to add a harness if automated browser verification becomes
worthwhile.
