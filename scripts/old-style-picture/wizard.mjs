// The friendly old-style picture maker: a terminal window with a menu (start.cmd opens it). It does what make.mjs does, for one
// or many pictures, in four steps: 1 paste the new addresses (checked, and compared with the list), 2 choose the old background,
// 3 look at the result, 4 save it into extension/old_pictures/ and extension/data/old_pictures.json and check that it all fits.
// Arrow keys and Enter always work; the mouse works in terminals that report it (Windows Terminal does). A terminal cannot draw
// the pictures, so every choice has a preview that opens in the browser (key O, or a click on [preview]).
// Never commits, builds or touches anything but those two places. No dependencies (Node 18 or later).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as lib from './lib.mjs';

// ---- the terminal ----

const ESC = '\x1b';
const c = {
    reset: `${ESC}[0m`,
    bold: `${ESC}[1m`,
    accent: `${ESC}[38;2;255;170;0m`,
    title: `${ESC}[1m${ESC}[38;2;255;220;60m`,
    good: `${ESC}[38;2;120;220;80m`,
    warn: `${ESC}[38;2;255;204;0m`,
    bad: `${ESC}[38;2;255;100;100m`,
    grey: `${ESC}[38;2;140;140;140m`,
    blue: `${ESC}[38;2;100;160;255m`,
    link: `${ESC}[4m${ESC}[38;2;110;190;255m`,
};
const MOUSE_ON = `${ESC}[?1000h${ESC}[?1006h`;
const MOUSE_OFF = `${ESC}[?1000l${ESC}[?1006l`;
// The whole wizard runs on the terminal's own full-screen buffer (like a text editor): nothing is left in the scrollback, and the
// window is put back as it was when the wizard ends.
const SCREEN_ON = `${ESC}[?1049h`;
const SCREEN_OFF = `${ESC}[?1049l`;

function out(text) {
    process.stdout.write(text);
}

// Draws a whole screen in place: from the top, each line overwritten (the rest of the line erased). Everything below the last line
// is erased before the last line is written, which is then written plainly with nothing after it (erasing after it, and jumping the
// cursor, made the prompt line invisible in Windows Terminal). `after` goes last, for example a cursor move.
// Nothing is cleared first, so there is no flicker, and nothing is pushed into the scrollback.
function draw(rows, after = '') {
    const body = rows.slice(0, -1).map((row) => `${row}${ESC}[K`).join('\r\n');
    out(`${ESC}[H${body}${rows.length > 1 ? '\r\n' : ''}${ESC}[J${rows[rows.length - 1] ?? ''}${after}`);
}

// The last `max` of the rows, with a note when some were left out, so a screen never grows taller than the window.
function lastRows(rows, max, note) {
    return rows.length <= max ? rows : [line(c.grey, note(rows.length - max + 1)), ...rows.slice(rows.length - max + 1)];
}

function firstRows(rows, max, note) {
    return rows.length <= max ? rows : [...rows.slice(0, max - 1), line(c.grey, note(rows.length - max + 1))];
}

function width() {
    return Math.max(50, (process.stdout.columns ?? 100) - 1);
}

const COLOR_CODE = /\x1b\[[0-9;?]*[A-Za-z]/y;

// The text cut to w visible characters; colour codes do not count and are never cut in half.
function fit(text, w = width()) {
    if (text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').length <= w) return text;
    let shown = 0;
    let result = '';
    for (let i = 0; i < text.length; ) {
        COLOR_CODE.lastIndex = i;
        const code = COLOR_CODE.exec(text);
        if (code !== null) {
            result += code[0];
            i += code[0].length;
        } else if (shown < w - 1) {
            result += text[i];
            shown++;
            i++;
        } else break;
    }
    return result + '…' + c.reset;
}

// A long address shortened in the middle, so both ends stay readable.
function middle(text, w) {
    if (text.length <= w) return text;
    const keep = Math.max(2, w - 1);
    return text.slice(0, Math.ceil(keep / 2)) + '…' + text.slice(text.length - Math.floor(keep / 2));
}

function line(color, text) {
    return `${color}${fit(text)}${c.reset}`;
}

function clear() {
    out(`${ESC}[H${ESC}[2J`);
}

// What to print on the normal screen when the wizard ends, since the full-screen buffer disappears (what was saved).
let finalNotes = [];

function leaveScreen() {
    out(`${MOUSE_OFF}${ESC}[?2004l${ESC}[?25h${c.reset}${SCREEN_OFF}`);
}

// Puts the terminal back and stops reading; Node then ends by itself (process.exit while the input is closing can crash on
// Windows). Returns a promise that never settles, so `await quit()` stops the caller where it is.
function quit(message) {
    leaveScreen();
    for (const text of finalNotes) out(`${text}\r\n`);
    if (message) out(`${message}\r\n`);
    try {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
    } catch {
        // the window is closing anyway
    }
    process.stdin.pause();
    return new Promise(() => {});
}

// ---- the keys and the mouse ----

const queue = [];
let waiter = null;
let pending = '';
let ended = false;

function push(event) {
    if (waiter !== null) {
        const resolve = waiter;
        waiter = null;
        resolve(event);
    } else queue.push(event);
}

// A paste that has started at s[i] (its first six characters are the start marker). Pushes it when its end marker is in s and
// returns the index after it. While the end has not arrived the text is held for the next chunk and -1 comes back, except that a
// Ctrl+C in the held text leaves the program, and a held text too long to be a paste is dropped, so a paste that never ends cannot
// lock the window. Terminals always send the end marker, so this only matters when something goes wrong.
const MAX_OPEN_PASTE = 1000000;

function takePaste(s, i) {
    const end = s.indexOf(`${ESC}[201~`, i);
    if (end >= 0) {
        push({ type: 'paste', text: s.slice(i + 6, end) });
        return end + 6;
    }
    if (s.includes('\x03', i)) {
        push({ type: 'key', name: 'ctrl-c' });
        return s.length;
    }
    if (s.length - i > MAX_OPEN_PASTE) return s.length;
    pending = s.slice(i);
    return -1;
}

// Turns what the terminal sends into events: key, char, paste and mouse.
function parse(chunk) {
    const s = pending + chunk;
    pending = '';
    let i = 0;
    while (i < s.length) {
        const ch = s[i] ?? '';
        if (ch === ESC) {
            if (s.startsWith('[200~', i + 1)) {
                const after = takePaste(s, i);
                if (after < 0) return;
                i = after;
                continue;
            }
            const match = /^\x1b(?:\[([<0-9;?]*)([A-Za-z~])|O([A-Za-z]))/.exec(s.slice(i, i + 40));
            if (match === null) {
                if (/^\x1b(\[[<0-9;?]*|O)?$/.test(s.slice(i))) {
                    pending = s.slice(i);
                    return;
                }
                i++;
                continue;
            }
            const params = match[1] ?? '';
            const final = match[2] ?? match[3] ?? '';
            i += match[0].length;
            const names = { A: 'up', B: 'down', C: 'right', D: 'left', H: 'home', F: 'end' };
            const tilde = { 1: 'home', 7: 'home', 4: 'end', 8: 'end', 3: 'delete' };
            if (final === '~') {
                const name = tilde[params.split(';')[0] ?? ''];
                if (name !== undefined) push({ type: 'key', name });
            } else if (names[final] !== undefined) push({ type: 'key', name: names[final] });
            else if ((final === 'M' || final === 'm') && params.startsWith('<')) {
                const [button, x, y] = params.slice(1).split(';').map(Number);
                if (final === 'M') push({ type: 'mouse', button: button ?? 0, x: x ?? 0, y: y ?? 0 });
            }
            continue;
        }
        i++;
        if (ch === '\r') {
            if (s[i] === '\n') i++;
            push({ type: 'key', name: 'enter' });
        } else if (ch === '\n') push({ type: 'key', name: 'enter' });
        else if (ch === '\x7f' || ch === '\b') push({ type: 'key', name: 'backspace' });
        else if (ch === '\x03') push({ type: 'key', name: 'ctrl-c' });
        else if (ch === '\x15') push({ type: 'key', name: 'clear-line' });
        else if (ch === '\x01') push({ type: 'key', name: 'home' });
        else if (ch === '\x05') push({ type: 'key', name: 'end' });
        else if (ch >= ' ') push({ type: 'char', ch });
    }
}

function startInput() {
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', parse);
    process.stdin.on('end', () => {
        ended = true;
        push({ type: 'end' });
    });
    process.stdin.resume();
    out(`${SCREEN_ON}${ESC}[?2004h`);
}

// The next event; Ctrl+C or a closed input leaves the program.
async function next() {
    const event = await new Promise((resolve) => {
        const queued = queue.shift();
        if (queued !== undefined) resolve(queued);
        else if (ended) resolve({ type: 'end' });
        else waiter = resolve;
    });
    if (event.type === 'end') await quit('The input ended. Nothing more was saved.');
    if (event.type === 'key' && event.name === 'ctrl-c') await quit('Stopped. Anything not shown as saved was not saved.');
    return event;
}

// ---- opening a preview in the browser ----

let previewDir = null;

function openFile(file) {
    try {
        const [command, args] =
            process.platform === 'win32' ? ['cmd', ['/c', 'start', '', file]] : process.platform === 'darwin' ? ['open', [file]] : ['xdg-open', [file]];
        spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true }).unref();
    } catch {
        // the path is printed, so it can be opened by hand
    }
}

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

// ---- drawing ----

// The look (a big coloured title in a heavy frame with a small framed label, a coloured help line under a rule, heavy-line tables)
// is inspired by the terminal app Stock-Manager by MedAziz218 (MIT licence, github.com/MedAziz218/Stock-Manager); the letters
// and the code here are our own. No frame is drawn down the sides of the lines: an address or a link on a line stays clean to select.

const visible = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

// The letters of the big title, three lines tall (box-drawing characters).
const GLYPHS = {
    O: ['╔═╗', '║ ║', '╚═╝'],
    L: ['╦  ', '║  ', '╩═╝'],
    D: ['╔╦╗', ' ║║', '═╩╝'],
    S: ['╔═╗', '╚═╗', '╚═╝'],
    T: ['╔╦╗', ' ║ ', ' ╩ '],
    Y: ['╦ ╦', '╚╦╝', ' ╩ '],
    E: ['╔═╗', '║╣ ', '╚═╝'],
    A: ['╔═╗', '╠═╣', '╩ ╩'],
    U: ['╦ ╦', '║ ║', '╚═╝'],
    G: ['╔═╗', '║ ╦', '╚═╝'],
    M: ['╔╦╗', '║║║', '╩ ╩'],
    N: ['╔╗╔', '║║║', '╝╚╝'],
    ' ': ['   ', '   ', '   '],
};

// The text in big letters, alternating orange and yellow: three rows. The letters touch, as in the usual figlet layout.
function bigTitle(text) {
    const rows = ['', '', ''];
    [...text].forEach((letter, at) => {
        const glyph = GLYPHS[letter] ?? GLYPHS[' '];
        for (let row = 0; row < 3; row++) rows[row] += `${at % 2 === 0 ? c.accent : c.title}${glyph?.[row] ?? ''}${c.reset}`;
    });
    return rows;
}

const BOX_WIDTH = 76;
const COMPACT_WIDTH = 62;
const BIG_HEADER_ROWS = 7;
const STEP_LINE = (step, title) => `${c.grey}Step ${step} of 4${c.reset}   ${c.title}${title}${c.reset}`;

// The tall header: seven lines (the frame with the big title and the label, the step, a blank line).
function bigHeaderRows(step, title) {
    const art = bigTitle('OLD STYLE AUGMENTS');
    const artWidth = Math.max(...art.map((row) => visible(row).length));
    const label = ['╔══════════════╗', '║Twizzy Toolkit║', '╚══════════════╝'];
    const inner = BOX_WIDTH - 2;
    const edge = (left, right) => `${c.accent}${left}${'━'.repeat(inner)}${right}${c.reset}`;
    const rows = [edge('┏', '┓')];
    for (let row = 0; row < 3; row++) {
        const text = label[row] ?? '';
        const gap = ' '.repeat(Math.max(1, inner - 2 - artWidth - text.length));
        const side = `${c.accent}┃${c.reset}`;
        rows.push(`${side} ${art[row] ?? ''}${gap}${c.warn}${text}${c.reset} ${side}`);
    }
    return [...rows, edge('┗', '┛'), STEP_LINE(step, title), ''];
}

// The short header, for a small window: five lines.
function compactHeaderRows(step, title) {
    const w = Math.min(width(), COMPACT_WIDTH);
    const text = ' TWIZZY TOOLKIT  ·  old style augments';
    return [
        `${c.accent}╔${'═'.repeat(w - 2)}╗${c.reset}`,
        `${c.accent}║${c.title}${text.padEnd(w - 2)}${c.accent}║${c.reset}`,
        `${c.accent}╚${'═'.repeat(w - 2)}╝${c.reset}`,
        STEP_LINE(step, title),
        '',
    ];
}

// A header is a placeholder until the screen is drawn: it becomes the tall one when the window has room for the rest of the screen
// (`below` lines come after the lines given), and the short one when it does not.
function header(step, title) {
    return [{ kind: 'header', step, title }];
}

function expand(lines, below) {
    const available = process.stdout.rows ?? 30;
    const others = lines.filter((entry) => typeof entry === 'string').length;
    const tall = width() >= BOX_WIDTH && available >= others + below + BIG_HEADER_ROWS;
    return lines.flatMap((entry) => (typeof entry === 'string' ? [entry] : tall ? bigHeaderRows(entry.step, entry.title) : compactHeaderRows(entry.step, entry.title)));
}

// The line above the help line, the bottom of the frame.
function rule() {
    return `${c.accent}${'━'.repeat(Math.min(width(), BOX_WIDTH))}${c.reset}`;
}

// The help line: the keys in colour.
function helpLine() {
    return line(
        '',
        `${c.blue}↑↓${c.grey} choose  ·  ${c.good}Enter${c.grey} confirm  ·  ${c.warn}O${c.grey} preview  ·  ${c.grey}or click  ·  ${c.bad}Ctrl+C${c.grey} quits${c.reset}`,
    );
}

// A table with heavy lines. columns: [{ title, width }]; rows: arrays of cell texts (they may carry colours).
function table(columns, rows) {
    const cell = (text, w) => {
        const cut = fit(text, w);
        return cut + ' '.repeat(Math.max(0, w - visible(cut).length));
    };
    const bar = `${c.accent}┃${c.reset}`;
    const edge = (left, middle, right) => `${c.accent}${left}${columns.map((column) => '━'.repeat(column.width + 2)).join(middle)}${right}${c.reset}`;
    const body = (cells) => bar + cells.map((text, at) => ` ${cell(text, columns[at]?.width ?? 0)} `).join(bar) + bar;
    return [
        edge('┏', '┳', '┓'),
        body(columns.map((column) => `${c.title}${column.title}${c.reset}`)),
        edge('┣', '╋', '┫'),
        ...rows.map(body),
        edge('┗', '┻', '┛'),
    ];
}

// Rows for a table, the last ones left out (with a note) when there are more than `max`.
function tableRows(rows, max, columnCount) {
    if (rows.length <= max) return rows;
    const note = [`${c.grey}... and ${rows.length - max + 1} more${c.reset}`, ...Array(columnCount - 1).fill('')];
    return [...rows.slice(0, max - 1), note];
}

// Whether the window is tall enough for the tables (otherwise the plain lists are shown, as before).
function tall() {
    return (process.stdout.rows ?? 30) >= 28 && width() >= BOX_WIDTH;
}

function swatch(colors) {
    const cells = colors
        .filter((color) => /^#[0-9A-F]{6}$/.test(color))
        .slice(0, 3)
        .map((color) => {
            const [r, g, b] = [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16));
            return `${ESC}[48;2;${r};${g};${b}m  ${c.reset}`;
        });
    return cells.join('') + ' '.repeat(6 - cells.length * 2) + '  ';
}

const TAG = '[preview]';

// A menu. An item is { label, swatch?, preview?, run? }. Enter on an item with run does it and stays (it may return a message to
// show); any other item ends the menu and its index is returned. O (or a click on [preview]) opens the item's preview.
async function menu({ lines, items, footer = [], start = 0 }) {
    let index = start;
    let status = '';
    const hasSwatch = items.some((item) => item.swatch !== undefined);
    const swatchWidth = hasSwatch ? 8 : 0;
    const labelWidth = Math.max(10, Math.min(Math.max(...items.map((item) => item.label.length)), width() - swatchWidth - TAG.length - 6));
    // The lines under the items: the rule, a line for a message (always counted, so the header does not change size), the footer
    // and the help line.
    const below = items.length + 1 + 1 + footer.length + 1;
    let firstRow = 1;
    const tagColumn = 3 + swatchWidth + labelWidth + 2;
    out(`${MOUSE_ON}${ESC}[?25l`);
    try {
        for (;;) {
            const rows = expand(lines, below);
            firstRow = rows.length + 1;
            items.forEach((item, at) => {
                const chosen = at === index;
                const label = fit(item.label, labelWidth).padEnd(labelWidth);
                const swatchText = hasSwatch ? (item.swatch === undefined ? ' '.repeat(swatchWidth) : swatch(item.swatch)) : '';
                const tag = item.preview === undefined ? '' : `  ${c.link}${TAG}${c.reset}`;
                rows.push(`${chosen ? c.accent + '❯' : ' '}${c.reset} ${swatchText}${chosen ? c.title : ''}${label}${c.reset}${tag}`);
            });
            rows.push(rule());
            if (status !== '') rows.push(line(c.good, status));
            for (const text of footer) rows.push(line(c.grey, text));
            rows.push(helpLine());
            draw(rows);

            const event = await next();
            const item = items[index];
            let confirm = false;
            if (event.type === 'key' && event.name === 'up') index = (index + items.length - 1) % items.length;
            else if (event.type === 'key' && event.name === 'down') index = (index + 1) % items.length;
            else if (event.type === 'char' && (event.ch === 'k' || event.ch === 'K')) index = (index + items.length - 1) % items.length;
            else if (event.type === 'char' && (event.ch === 'j' || event.ch === 'J')) index = (index + 1) % items.length;
            else if (event.type === 'key' && event.name === 'enter') confirm = true;
            else if (event.type === 'char' && (event.ch === 'o' || event.ch === 'O')) {
                if (item?.preview !== undefined) status = item.preview();
            } else if (event.type === 'mouse' && (event.button === 64 || event.button === 65)) {
                index = event.button === 64 ? (index + items.length - 1) % items.length : (index + 1) % items.length;
            } else if (event.type === 'mouse' && event.button === 0) {
                const at = event.y - firstRow;
                if (at >= 0 && at < items.length) {
                    index = at;
                    const clicked = items[at];
                    if (clicked?.preview !== undefined && event.x >= tagColumn && event.x < tagColumn + TAG.length) status = clicked.preview();
                    else confirm = true;
                }
            }
            if (confirm && items[index] !== undefined) {
                const chosen = items[index];
                if (chosen.run !== undefined) status = chosen.run() ?? '';
                else return index;
            }
        }
    } finally {
        out(`${MOUSE_OFF}${ESC}[?25h`);
    }
}

// A screen with only a message and one button.
async function notice(lines, button = 'Continue') {
    await menu({ lines, items: [{ label: button }] });
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
