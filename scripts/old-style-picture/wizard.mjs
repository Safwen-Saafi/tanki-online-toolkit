// The friendly old-style picture maker: a terminal window with a menu (start.cmd opens it). It does what make.mjs does, for one
// or many pictures, in four steps: 1 paste the new addresses (checked, and compared with the list), 2 choose the old background,
// 3 look at the result, 4 save it into extension/old_pictures/ and extension/data/old_pictures.json and check that it all fits.
// Arrow keys and Enter always work; the mouse works in terminals that report it (Windows Terminal does). A terminal cannot draw
// the pictures, so every choice has a preview that opens in the browser (key O, or a click on [preview]).
// Never commits, builds or touches anything but those two places. No dependencies (Node 18 or later).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as lib from './lib.mjs';
import {
    ESC,
    c,
    clear,
    configure,
    draw,
    expand,
    finalNotes,
    firstRows,
    fit,
    header,
    lastRows,
    leaveScreen,
    line,
    menu,
    middle,
    next,
    notice,
    openFile,
    out,
    quit,
    rule,
    startInput,
    swatch,
    table,
    tableRows,
    tall,
    width,
} from '../tui.mjs';

// The terminal kit is shared with the game update check (scripts/tui.mjs); this tool's header, help line and stop messages.
configure({
    title: 'OLD STYLE AUGMENTS',
    label: 'Twizzy Toolkit',
    compact: ' TWIZZY TOOLKIT  ·  old style augments',
    stepLine: (step, title) => `${c.grey}Step ${step} of 4${c.reset}   ${c.title}${title}${c.reset}`,
    help: `${c.blue}↑↓${c.grey} choose  ·  ${c.good}Enter${c.grey} confirm  ·  ${c.warn}O${c.grey} preview  ·  ${c.grey}or click  ·  ${c.bad}Ctrl+C${c.grey} quits${c.reset}`,
    stopped: 'Stopped. Anything not shown as saved was not saved.',
    inputEnded: 'The input ended. Nothing more was saved.',
});

// ---- opening a preview in the browser ----

let previewDir = null;

function dataAddress(svg) {
    return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
}

// A small page that shows the pictures large on a dark background; each is a data address, so the pictures cannot mix their gradients.
function openPage(name, heading, tiles) {
    previewDir ??= fs.mkdtempSync(path.join(os.tmpdir(), 'old-style-picture-'));
    const escape = (text) => text.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch);
    const cells = tiles
        .map((tile) => `<figure><img src="${dataAddress(tile.svg)}" alt=""><figcaption>${escape(tile.label)}</figcaption></figure>`)
        .join('\n');
    const html = `<!doctype html><meta charset="utf-8"><title>${escape(heading)}</title>
<style>body{margin:0;padding:24px;background:#1b1b1b;color:#ddd;font:15px Segoe UI,sans-serif}h1{font-size:18px;color:#ffcc00;margin:0 0 18px}
main{display:flex;flex-wrap:wrap;gap:22px}figure{margin:0;text-align:center}img{width:256px;height:256px;background:#2a2a2a;border-radius:8px}figcaption{margin-top:8px}</style>
<h1>${escape(heading)}</h1><main>${cells}</main>`;
    const file = path.join(previewDir, name);
    fs.writeFileSync(file, html);
    openFile(file);
    return file;
}

// ---- step 1: the addresses ----

// A line that shows an address starts with the address itself, and the status comes after it: a mouse selection that starts at the
// beginning of the line then starts on the address, not on a marker. The address is shortened in the middle only when the window is
// too narrow to show it whole.
function addressCell(address) {
    const room = Math.max(30, Math.min(75, width() - 24));
    return middle(address, room).padEnd(Math.min(room, 75));
}

function verdictLine(address) {
    const found = lib.checkAddress(address);
    return line('', `${addressCell(address)}  ${found.ok ? `${c.good}✓${c.reset}` : `${c.bad}✗ ${found.reason}${c.reset}`}`);
}

// A line copied from this window may carry the pointer in front of the address, or a status after it (❯ ✓ ✗ !); only the address
// is kept, so selecting a little too much never matters. A pasted line with no address in it is left exactly as pasted.
function cleanPasted(text) {
    return /https?:\/\/\S+/.exec(text)?.[0] ?? text;
}

// Reads addresses until an empty line. Pasting many lines at once works. The line being typed can be edited: Left and Right move
// the cursor, Home and End jump, Backspace and Delete erase, Ctrl+U clears the line.
async function askAddresses() {
    const collected = [];
    let current = '';
    let cursor = 0;
    const add = (text) => {
        const trimmed = text.trim();
        if (trimmed !== '') collected.push(trimmed);
    };
    const insert = (text) => {
        current = current.slice(0, cursor) + text + current.slice(cursor);
        cursor += text.length;
    };
    out(`${ESC}[?25h`);
    for (;;) {
        const listed = lastRows(collected.map(verdictLine), 12, (hidden) => `... ${hidden} earlier addresses not shown`);
        const rows = [
            ...expand(
                [
                    ...header(1, 'Paste the new picture addresses'),
                    line('', `Each address is the game's own link of a new-style picture, ending in ${c.title}image.svg${c.reset}.`),
                    line('', `Press ${c.good}Enter${c.reset} after each one. When you are done, press ${c.good}Enter${c.reset} on an empty line.`),
                    line('', `${c.blue}← → Home End Delete${c.reset} edit the line  ·  ${c.blue}Ctrl+U${c.reset} clears it  ·  ${c.bad}Ctrl+C${c.reset} quits`),
                    '',
                ],
                listed.length + 2,
            ),
            ...listed,
            rule(),
        ];
        // A long line slides sideways instead of wrapping, so the cursor's place on it is always known.
        const room = Math.max(10, (process.stdout.columns ?? 100) - 4);
        const from = cursor >= room ? cursor - room + 1 : 0;
        const shown = current.slice(from, from + room);
        // The prompt line is the last row, written plainly (nothing erased after it). Windows Terminal left the cursor at the start of
        // the line unless it was told where to go, so the cursor is then placed explicitly, in a separate write, at the row and
        // column where the next letter goes. The text has its own bright colour, so it can never be dark. The pointer is ordinary text:
        // a terminal cannot mark a character as unselectable (a drag that starts on the first letter of the address leaves it out, and
        // a pointer that was copied along is removed when it is pasted back, see cleanPasted).
        rows.push(`${c.accent}❯${c.reset} ${ESC}[97m${shown}${c.reset}`);
        draw(rows);
        out(`${ESC}[${Math.min(rows.length, process.stdout.rows ?? rows.length)};${3 + cursor - from}H`);

        const event = await next();
        if (event.type === 'char') insert(event.ch);
        else if (event.type === 'paste') {
            // One newline at the very end of a paste (copying a whole line brings it) does not press Enter: the last pasted address
            // stays on the line to look at, and Enter adds it.
            const parts = event.text.replace(/\r?\n$/, '').split(/\r?\n/);
            parts.forEach((part, at) => {
                insert(cleanPasted(part));
                if (at < parts.length - 1) {
                    add(current);
                    current = '';
                    cursor = 0;
                }
            });
        } else if (event.type === 'key') {
            if (event.name === 'backspace' && cursor > 0) {
                current = current.slice(0, cursor - 1) + current.slice(cursor);
                cursor--;
            } else if (event.name === 'delete') current = current.slice(0, cursor) + current.slice(cursor + 1);
            else if (event.name === 'left') cursor = Math.max(0, cursor - 1);
            else if (event.name === 'right') cursor = Math.min(current.length, cursor + 1);
            else if (event.name === 'home') cursor = 0;
            else if (event.name === 'end') cursor = current.length;
            else if (event.name === 'clear-line') {
                current = '';
                cursor = 0;
            } else if (event.name === 'enter') {
                if (current.trim() !== '') {
                    add(current);
                    current = '';
                    cursor = 0;
                } else if (collected.length > 0) return collected;
            }
        }
    }
}

// Each address with what it is: new, already on the list, bad, or a repeat.
function analyse(addresses) {
    const listed = new Set(lib.readList());
    const seen = new Set();
    return addresses.map((address) => {
        const found = lib.checkAddress(address);
        if (!found.ok) return { address, status: 'bad', reason: found.reason };
        if (seen.has(found.stablePath)) return { address, status: 'repeat', stablePath: found.stablePath };
        seen.add(found.stablePath);
        return { address, status: listed.has(found.stablePath) ? 'listed' : 'new', stablePath: found.stablePath, name: found.name };
    });
}

function analysisLines(rows) {
    return rows.map((row) => {
        const shown = addressCell(row.address);
        if (row.status === 'new') return line('', `${shown}  ${c.good}✓ new${c.reset}`);
        if (row.status === 'listed') return line('', `${shown}  ${c.warn}! done${c.reset}`);
        if (row.status === 'repeat') return line('', `${shown}  ${c.grey}- repeat, ignored${c.reset}`);
        return line('', `${shown}  ${c.bad}✗ ${row.reason}${c.reset}`);
    });
}

// What to do with an address whose picture is already on the list: show it, then ask.
async function askAboutListed(row) {
    const file = lib.pictureFile(row.stablePath);
    const exists = fs.existsSync(file);
    const lines = [
        ...header(1, 'This picture is already done'),
        line(c.warn, 'The picture you want to make is already on the list.'),
        line('', 'The address:'),
        line('', middle(row.address, width())),
        line('', `Its old-style picture: ${exists ? path.relative(lib.ROOT, file) : '(the file is missing)'}`),
        '',
        line('', 'Look at it first. If it is wrong, you can make it again and replace it.'),
        '',
    ];
    const items = [
        {
            label: 'Look at the old picture we already have',
            run: () => {
                if (!exists) return 'The file is missing, there is nothing to look at.';
                const svg = fs.readFileSync(file, 'utf8');
                openPage('already-done.html', 'Already done', [{ label: 'old style, in the extension now', svg }]);
                return 'Opened in your browser.';
            },
        },
        { label: 'Skip this one' },
        { label: 'Replace it anyway' },
    ];
    return (await menu({ lines, items, start: 1 })) === 2;
}

// Turns the typed addresses into the pictures to make (asking about the ones already done). Null: start again.
async function collectItems() {
    for (;;) {
        const addresses = await askAddresses();
        const rows = analyse(addresses);
        const usable = rows.filter((row) => row.status === 'new' || row.status === 'listed');
        const lines = [...header(1, 'Check the addresses'), ...firstRows(analysisLines(rows), 12, (hidden) => `... and ${hidden} more`), ''];
        const items = [];
        if (usable.length > 0) items.push({ label: `Continue with ${usable.length} picture${usable.length === 1 ? '' : 's'}` });
        items.push({ label: 'Type the addresses again' });
        const footer = rows.some((row) => row.status === 'listed') ? ['"done" means the picture is already on the list; you will be asked about it.'] : [];
        const picked = await menu({ lines, items, footer });
        if (usable.length === 0 || picked !== 0) continue;
        const chosen = [];
        for (const row of usable) {
            if (row.status === 'listed' && !(await askAboutListed(row))) continue;
            chosen.push({ address: row.address, stablePath: row.stablePath, name: row.name, replacing: row.status === 'listed' });
        }
        if (chosen.length > 0) return chosen;
        await notice([...header(1, 'Nothing to make'), line('', 'All of them were skipped.'), ''], 'Start again');
    }
}

// Downloads the new pictures and keeps the ones that can be made.
async function downloadAll(items) {
    clear();
    out(expand(header(1, 'Getting the new pictures'), items.length + 1).join('\r\n') + '\r\n');
    const ready = [];
    const failed = [];
    for (const [at, item] of items.entries()) {
        out(fit(`  ${at + 1}/${items.length}  ${item.stablePath} ... `, width() - 12));
        try {
            const svg = await lib.downloadNewPicture(item.address);
            const unsafe = lib.unsafeContent(svg);
            if (unsafe !== null) throw new Error(`it holds ${unsafe}, which a game picture never does`);
            if (lib.backgroundColors(svg) === null) throw new Error('it has no single background gradient to replace');
            ready.push({ ...item, svg });
            out(`${c.good}ok${c.reset}\r\n`);
        } catch (error) {
            const reason = (error instanceof Error ? error.message : String(error)).replace(/ for https?:\S+$/, '');
            failed.push(`${item.stablePath}: ${reason}`);
            out(`${c.bad}failed${c.reset}\r\n`);
        }
    }
    if (failed.length > 0) {
        const lines = [...header(1, 'Some pictures could not be used'), ...firstRows(failed.map((text) => line(c.bad, `✗ ${text}`)), 10, (hidden) => `... and ${hidden} more`), ''];
        const label = ready.length > 0 ? `Continue with the ${ready.length} that worked` : 'Start again';
        await notice(lines, label);
    }
    return ready;
}

// ---- step 2: the style ----

const donors = new Map();

function donorSvg(style) {
    let svg = donors.get(style.id);
    if (svg === undefined) {
        svg = fs.readFileSync(path.join(lib.PICTURES_DIR, style.file), 'utf8');
        donors.set(style.id, svg);
    }
    return svg;
}

function styleColors(style) {
    return lib.backgroundColors(donorSvg(style)) ?? [];
}

function checkStyles() {
    const problems = [];
    for (const style of lib.STYLES) {
        try {
            if (lib.backgroundColors(donorSvg(style)) === null) problems.push(`${style.file} (${style.name}) does not have one background gradient`);
        } catch {
            problems.push(`${style.file} (${style.name}) is missing from extension/old_pictures`);
        }
    }
    if (problems.length > 0) throw new Error(`the styles cannot be shown:\n  ${problems.join('\n  ')}`);
}

// The choice of a style for one picture; the preview shows this very picture in each style next to the real old picture of it.
async function chooseStyle(item, at, total) {
    const lines = [
        ...header(2, 'Choose the old background'),
        line('', `Picture ${at + 1} of ${total}:  ${item.stablePath}`),
        line(c.grey, 'Each style has a preview: this picture with that background, next to a real old picture that has it.'),
        '',
    ];
    const items = lib.STYLES.map((style) => ({
        label: style.name,
        swatch: styleColors(style),
        preview: () => {
            openPage(`style-${style.id}.html`, style.name, [
                { label: 'new style (the game now)', svg: item.svg },
                { label: 'this picture, old style', svg: lib.recolor(item.svg, donorSvg(style)) },
                { label: `a real old one: ${style.file}`, svg: donorSvg(style) },
            ]);
            return 'Opened in your browser.';
        },
    }));
    return lib.STYLES[await menu({ lines, items })] ?? lib.STYLES[0];
}

async function askSameStyle(style, rest) {
    const lines = [
        ...header(2, 'Choose the old background'),
        line('', `You chose: ${style.name}`),
        '',
        line('', `Use the same style for the other ${rest} picture${rest === 1 ? '' : 's'}?`),
        '',
    ];
    return (await menu({ lines, items: [{ label: 'Yes, the same for all of them' }, { label: 'No, I will choose each one' }] })) === 0;
}

async function chooseStyles(items) {
    let same = null;
    for (const [at, item] of items.entries()) {
        const style = same ?? (await chooseStyle(item, at, items.length));
        item.style = style;
        item.result = lib.recolor(item.svg, donorSvg(style));
        if (at === 0 && items.length > 1 && (await askSameStyle(style, items.length - 1))) same = style;
    }
}

// ---- step 3: look, step 4: save and check ----

// 'save', 'again' (choose the styles again) or 'cancel'.
// The style as a table cell: its colours, then its name.
function styleCell(style, cellWidth) {
    return `${swatch(styleColors(style))}${fit(style.name, Math.max(4, cellWidth - 8))}`;
}

// The pictures as a table with heavy lines: [name column text, action cell] per picture; `rest` is the number of lines the rest of
// the screen needs, so the table takes what the window has left (at least three rows).
function picturesTable(items, nameOf, actionOf, nameTitle, actionTitle, rest) {
    const nameWidth = Math.min(30, Math.max(nameTitle.length, ...items.map((item) => nameOf(item).length)));
    const actionWidth = 9;
    const styleWidth = Math.max(16, Math.min(width(), 96) - nameWidth - actionWidth - 6 - 4);
    const columns = [
        { title: nameTitle, width: nameWidth },
        { title: 'Style', width: styleWidth },
        { title: actionTitle, width: actionWidth },
    ];
    const cap = Math.max(3, (process.stdout.rows ?? 30) - rest - 4);
    return table(columns, tableRows(items.map((item) => [nameOf(item), styleCell(item.style, styleWidth), actionOf(item)]), cap, 3));
}

async function review(items) {
    const count = line('', `${items.length} picture${items.length === 1 ? '' : 's'} ready. Nothing is saved yet.`);
    const tilesOf = (item) => {
        const tiles = [
            { label: `${item.stablePath} (new style)`, svg: item.svg },
            { label: `old style: ${item.style.name}`, svg: item.result },
        ];
        const existing = lib.pictureFile(item.stablePath);
        if (item.replacing && fs.existsSync(existing)) tiles.push({ label: 'the one in the extension now', svg: fs.readFileSync(existing, 'utf8') });
        return tiles;
    };
    const items2 = [];
    if (items.length > 1) {
        items2.push({
            label: 'Look at all of them together',
            run: () => {
                openPage('all.html', 'All the pictures', items.flatMap(tilesOf));
                return 'Opened in your browser.';
            },
        });
    }
    // With many pictures the single page of all of them is enough, and the menu stays shorter than the window.
    for (const item of items.length <= (tall() ? 3 : 5) ? items : []) {
        items2.push({
            label: `Look at ${item.stablePath}`,
            run: () => {
                openPage(`look-${lib.fileNameOf(item.stablePath)}.html`, item.stablePath, tilesOf(item));
                return 'Opened in your browser.';
            },
        });
    }
    const first = items2.length;
    items2.push({ label: `Save ${items.length === 1 ? 'it' : `all ${items.length}`}` }, { label: 'Choose the styles again' }, { label: 'Cancel, save nothing' });
    // In a tall window the pictures are a table; in a small one a plain list, as before.
    const lines = [...header(3, 'Look at the result'), count, ''];
    if (tall()) {
        const rest = BIG_HEADER_ROWS + 2 + 1 + items2.length + 3;
        lines.push(
            ...picturesTable(items, (item) => item.stablePath, (item) => (item.replacing ? `${c.warn}replaces${c.reset}` : `${c.good}new${c.reset}`), 'Picture', 'Action', rest),
            '',
        );
    } else {
        const summary = items.map((item) => line('', `${item.replacing ? `${c.warn}replaces${c.reset}` : `${c.good}new${c.reset}     `}  ${item.stablePath}  ${c.grey}${item.style.name}${c.reset}`));
        lines.push(...firstRows(summary, 8, (hidden) => `... and ${hidden} more`), '');
    }
    const picked = await menu({ lines, items: items2, start: first });
    return ['save', 'again', 'cancel'][picked - first] ?? 'cancel';
}

// Writes the pictures and the list, then reads everything back. Returns the checks with their result.
function saveAndVerify(items) {
    const before = lib.readList();
    const backups = [];
    for (const item of items) {
        const file = lib.pictureFile(item.stablePath);
        if (fs.existsSync(file)) {
            previewDir ??= fs.mkdtempSync(path.join(os.tmpdir(), 'old-style-picture-'));
            const copy = path.join(previewDir, `before-${path.basename(file)}`);
            fs.copyFileSync(file, copy);
            backups.push(copy);
        }
        fs.writeFileSync(file, item.result);
    }
    lib.writeList([...before, ...items.map((item) => item.stablePath)]);

    const checks = [];
    const now = lib.readList();
    const expected = new Set([...before, ...items.map((item) => item.stablePath)]);
    checks.push({ ok: now.length === expected.size && now.every((key) => expected.has(key)), text: `The list has ${now.length} pictures (it had ${before.length})` });
    checks.push({ ok: now.join('\n') === [...now].sort().join('\n'), text: 'The list is sorted and has no repeats' });
    const missing = now.filter((key) => !fs.existsSync(lib.pictureFile(key)));
    checks.push({ ok: missing.length === 0, text: missing.length === 0 ? 'Every picture on the list has its file' : `${missing.length} pictures on the list have no file` });
    for (const item of items) {
        const file = lib.pictureFile(item.stablePath);
        const saved = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
        const colors = lib.backgroundColors(saved);
        const wanted = lib.backgroundColors(donorSvg(item.style));
        const ok = saved === item.result && saved.includes('<svg') && colors !== null && wanted !== null && colors.join(' ') === wanted.join(' ') && now.includes(item.stablePath);
        checks.push({ ok, item, text: `${path.basename(file)}: saved, right background, on the list` });
    }
    return { checks, backups, before: before.length, now: now.length };
}

async function showSaved(items) {
    const { checks, backups, before, now } = saveAndVerify(items);
    const good = checks.every((check) => check.ok);
    // The first three checks are about the list; the rest are one per picture, joined into one line when there are many and all good.
    const perPicture = checks.slice(3);
    const shown =
        perPicture.length > 5 && perPicture.every((check) => check.ok)
            ? [...checks.slice(0, 3), { ok: true, text: `All ${perPicture.length} pictures: saved, right background, on the list` }]
            : checks;
    finalNotes.push(`Saved ${items.length} picture${items.length === 1 ? '' : 's'} (nothing was committed):`, ...shown.map((check) => `  ${check.ok ? '✓' : '✗'} ${check.text}`));
    if (good) finalNotes.push('Now reload the extension on chrome://extensions, then reload the game.');
    const lines = [...header(4, good ? 'Saved, and everything checks out' : 'Saved, but a check failed')];
    if (tall()) {
        // A table of the pictures with their result, and one line for the list; a failed list check gets its own line.
        const listChecks = checks.slice(0, 3);
        const failedList = listChecks.filter((check) => !check.ok);
        lines.push(
            ...(failedList.length === 0
                ? [line('', `${c.good}✓${c.reset} The list: ${now} pictures (it had ${before}), sorted, no repeats, every picture has its file`)]
                : failedList.map((check) => line('', `${c.bad}✗${c.reset} ${check.text}`))),
            '',
        );
        const rest = BIG_HEADER_ROWS + 1 + 1 + 1 + (backups.length > 0 ? 1 : 0) + (good ? 5 : 0) + 2 + 3;
        lines.push(
            ...picturesTable(
                checks.slice(3).map((check) => ({ ...check.item, ok: check.ok })),
                (item) => lib.fileNameOf(item.stablePath),
                (item) => (item.ok ? `${c.good}✓ ok${c.reset}` : `${c.bad}✗ failed${c.reset}`),
                'Picture file',
                'Result',
                rest,
            ),
            '',
        );
    } else {
        lines.push(...shown.map((check) => line('', `${check.ok ? `${c.good}✓` : `${c.bad}✗`}${c.reset} ${check.text}`)), '');
    }
    if (backups.length > 0) lines.push(line(c.grey, `The files that were replaced were copied first, to ${path.dirname(backups[0] ?? '')}`), ...(tall() ? [] : ['']));
    if (good) {
        lines.push(
            line(c.title, 'What to do now'),
            line('', '1. On chrome://extensions, press the reload button of the extension.'),
            line('', '2. Reload the game. No build is needed, since no code changed.'),
            line(c.grey, 'npm run package zips these files by itself. Nothing was committed.'),
            '',
        );
    }
    return (await menu({ lines, items: [{ label: 'Make more pictures' }, { label: 'Quit' }] })) === 0;
}

// ---- the whole walk ----

async function main() {
    checkStyles();
    startInput();
    for (;;) {
        const wanted = await collectItems();
        const items = await downloadAll(wanted);
        if (items.length === 0) continue;
        for (;;) {
            await chooseStyles(items);
            const decision = await review(items);
            if (decision === 'again') continue;
            if (decision === 'save' && !(await showSaved(items))) await quit('Bye.');
            break;
        }
    }
}

main().catch((error) => {
    leaveScreen();
    console.error(`[old-style-picture] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    process.stdin.pause();
});
