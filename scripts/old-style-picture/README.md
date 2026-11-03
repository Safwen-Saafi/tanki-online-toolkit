# old-style-picture

Makes the old-style picture of an augment that has no old file. The devs changed the augment pictures, and the extension swaps each one for a bundled old picture (`extension/old_pictures/`, listed in `extension/data/old_pictures.json`). An augment the devs added after that change has no old picture, so it keeps the new style. These tools make one.

A picture's drawing is the same in the old and the new style. Only the background gradient differs, and it is not one fixed colour: in the old style the colour depended on the augment (red for the standard ones, blue for cold, orange for lightning, and so on). So the tools cannot guess it. You choose the old background, and the tools copy that background onto the new picture.

They are not part of the extension and never ship in the zip. They have no dependencies (Node 18 or later), and they never commit, build or touch anything but `extension/old_pictures/` and `extension/data/old_pictures.json`.

## The friendly way: start.cmd

Double-click `start.cmd`. A terminal window opens with a menu. Arrow keys and Enter always work; the mouse works too in terminals that report it (Windows Terminal does). A terminal cannot draw pictures, so every choice has a preview that opens in your browser (press `O`, or click `[preview]`).

1. **The addresses.** Find each new picture's address (see below) and paste them, one per line; many at once is fine. Each address is checked (is it a game picture address) and compared with the list. An address that is already on the list is flagged "done": you are shown its old picture and asked if you really want to replace it. A bad address or a repeat is reported and left out; the others go on.
2. **The style.** Choose one of the 12 old backgrounds by name. Each has a colour swatch and a preview of that very picture in that style, next to a real old picture that has it. With many pictures you choose for the first, then say whether the same style is used for all the others, or you choose each.
3. **Look.** See every result next to the new picture (and next to the old file it would replace). Nothing is saved yet. Save all, choose the styles again, or cancel.
4. **Save.** The files are written, the list is updated, and everything is read back and checked: the list is sorted with no repeats, every picture on the list has its file, and each new file has the right background. A file that is replaced is copied to your temp folder first.

Then reload the extension on `chrome://extensions`, and reload the game. No build is needed, since no code changed, and `npm run package` includes the new files by itself.

The look of the window (the big "OLD STYLE AUGMENTS" title in a heavy frame with a Twizzy Toolkit label, the coloured help line, the heavy-line tables) is inspired by the terminal app [Stock-Manager](https://github.com/MedAziz218/Stock-Manager) by MedAziz218 (MIT licence). The letters and the code are our own. In a small window (under about 28 lines) it falls back to a shorter header and plain lists; a taller window shows the full look.

### Finding the new addresses

In the game, open the garage Augments tab with the augment on screen, press F12, and paste this in the console. It lists every augment picture the extension did not swap, which is exactly the ones with no old file:

```js
copy([...new Set([...document.images].map(i => i.src).concat([...document.querySelectorAll('*')].map(e => (getComputedStyle(e).backgroundImage.match(/https:[^")]+/) || [''])[0])).filter(s => /tankionline\.com.*image\.svg/.test(s)))].join('\n'))
```

It copies the addresses, one per line, ready to paste into the wizard.

## The command line: make.mjs

For one picture, without the menu. See the old colours and one example file for each:

```
node scripts/old-style-picture/make.mjs --list-colors
```

Make the picture, with the address and the example file of the colour you chose:

```
node scripts/old-style-picture/make.mjs <address> --like <example file>
```

Options:

- `--like <old picture>`: a file name in `extension/old_pictures`, as `--list-colors` prints it. Required.
- `--from-file <new.svg>`: use a saved copy of the new picture instead of downloading it. The address is still needed, for the name.
- `--dry-run`: say what would be written and write nothing.
- `--force`: replace a picture that already has an old file. Without it the command stops, because a real old file is better than a made one.
- `--list-colors`: list the old background colours and an example file for each.

## What it checks

It stops without writing anything when the address is not a game address ending in `image.svg`, when the picture already has an old file (the wizard asks instead), or when the new picture or the old picture to copy from does not have exactly one background gradient.

It also refuses a picture that holds anything a game picture never does, because the file goes into the extension: a script, a `foreignObject`, an event handler (`onload=` and the like), a `javascript:` or `data:` address, a link to another site, or a reference to anything outside the file. The wizard says so in the list of pictures that could not be used. All 516 bundled pictures pass this check.

## One rule in three places

Which addresses count, what a stable path is, and how it becomes a file name is written in `lib.mjs`, in `src/injector.ts` and in `src/modules/old_pictures.ts`, because scripts share no imports. If the rule ever changes, change all three, or a file saved here is never found by the extension.

## The files

- `start.cmd`: opens the wizard in a terminal window (Windows).
- `wizard.mjs`: the menu.
- `make.mjs`: the command line.
- `lib.mjs`: what both share (the address check, the recolouring, the list, the 12 styles).
