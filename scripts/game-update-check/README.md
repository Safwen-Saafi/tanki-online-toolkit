# Game update check

Says in a minute what a game update broke in the extension, without opening the game.

When the game updates, its code is rebuilt and the short names inside it can move. The extension finds its places in the game's code by their shape, so most updates change nothing, but now and then a change no longer goes in (on 2026-11-27 the lobby, the drone, the pass and the friends invite broke this way). This check finds that before you play.

## How to use it

Double-click `start.cmd`. A window opens with a menu:

- **1 Check the live game now**: builds the extension, downloads the game's code of today and checks it.
- **2 Check a bundle file**: the same for a `main.<hash>.js` file on the computer (type its path or drag it into the window).
- **3 Save the last checked bundle as known-good**: keeps it as the one to compare with next time. It is saved only when nothing broke.
- **0 Quit**.

From a terminal, the same check: `node scripts/game-update-check/check.mjs` (today's game), `--bundle <file>` (a file), `--save-good` (save it when nothing broke), `--injector <file>` (check another built `injector.js`, for example an old one). It needs `npm run build` first. The exit code is 0 when nothing broke, 1 otherwise.

## What it does

1. Reads `https://tankionline.com/play/`, finds the address of the game's code (`main.<hash>.js`) and downloads it into `bundles/` (kept on this computer only, never committed; about 10 MB each). Only that page and that file are fetched, with a plain browser name and nothing about you.
2. Runs the extension's own built injector (`extension/js/injector.js`, unchanged) on it inside Node, with a stand-in browser and every switch on, exactly as Chrome would when the game loads. It does the same with the known-good copy, so a change in our own code never looks like a game change.
3. Reports, in plain words:
   1. **Hooks**: changes that went into the known-good copy and are missing now (with no known-good yet: every hook named in `src/injector.ts`).
   2. **Warnings**: the injector's warnings that are new.
   3. **Valid code**: whether the changed game code still parses (`node --check`).
   4. **Class names**: the game class names our code and styles use (`...Style-...`, read from `src/` and `extension/styles/` each time) that the known-good copy had and the new one does not.
4. Ends with "Nothing broke that this check can see" or "N things broke". A missing hook and the warning that explains it count as two.

Nothing has to be kept up to date by hand: the hooks and the class names are read from the extension's code on every run.

## What it cannot see

It reads code only. It cannot see page layout, how things look, the game's card data, the hangar files or sounds, and it does not run the lobby or showroom scripts inside the game's frames. "Nothing broke" means the extension's changes still go into the game's code, not that everything works: look at the game too.

## When the check itself fails

"The check itself failed (not the game)" means the stand-in browser was missing something the injector needed (for example after a new part of the injector calls a browser feature in a new way). It is a fault of this script, not of the game: fix the stand-in in `lib.mjs`. The script relies on four things in `src/injector.ts`: the `hooks added to the game: ` line, the `[KI-test][injector]` prefix on its warnings, catching the game's script tag with a `MutationObserver` by `/static/js/main.`, and downloading it with `fetch`.
