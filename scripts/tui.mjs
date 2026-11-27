// The terminal kit shared by the toolkit's full-screen scripts (the old-style picture maker, the game update check): colours,
// the full-screen window, drawing a screen in place, the keys, mouse and paste input, the big title, tables and menus.
// Each tool passes its own header and help line with configure(). No dependencies (Node 18 or later).
import { spawn } from 'node:child_process';

// What each tool sets with configure(): its header (the big title, the framed label, the short title for a small window and the
// line under the header), its help line, and what is printed when Ctrl+C or the end of the input stops it.
const settings = {
    title: '',
    label: '',
    compact: '',
    stepLine: (_step, title) => title,
    help: '',
    stopped: 'Stopped.',
    inputEnded: 'The input ended.',
};

export function configure(options) {
    Object.assign(settings, options);
}

// ---- the terminal ----

export const ESC = '\x1b';
export const c = {
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
// The whole tool runs on the terminal's own full-screen buffer (like a text editor): nothing is left in the scrollback, and the
// window is put back as it was when the tool ends.
const SCREEN_ON = `${ESC}[?1049h`;
const SCREEN_OFF = `${ESC}[?1049l`;

export function out(text) {
    process.stdout.write(text);
}

// Draws a whole screen in place: from the top, each line overwritten (the rest of the line erased). Everything below the last line
// is erased before the last line is written, which is then written plainly with nothing after it (erasing after it, and jumping the
// cursor, made the prompt line invisible in Windows Terminal). `after` goes last, for example a cursor move.
// Nothing is cleared first, so there is no flicker, and nothing is pushed into the scrollback.
export function draw(rows, after = '') {
    const body = rows.slice(0, -1).map((row) => `${row}${ESC}[K`).join('\r\n');
    out(`${ESC}[H${body}${rows.length > 1 ? '\r\n' : ''}${ESC}[J${rows[rows.length - 1] ?? ''}${after}`);
}

// The last `max` of the rows, with a note when some were left out, so a screen never grows taller than the window.
export function lastRows(rows, max, note) {
    return rows.length <= max ? rows : [line(c.grey, note(rows.length - max + 1)), ...rows.slice(rows.length - max + 1)];
}

export function firstRows(rows, max, note) {
    return rows.length <= max ? rows : [...rows.slice(0, max - 1), line(c.grey, note(rows.length - max + 1))];
}

export function width() {
    return Math.max(50, (process.stdout.columns ?? 100) - 1);
}

const COLOR_CODE = /\x1b\[[0-9;?]*[A-Za-z]/y;

// The text cut to w visible characters; colour codes do not count and are never cut in half.
export function fit(text, w = width()) {
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
export function middle(text, w) {
    if (text.length <= w) return text;
    const keep = Math.max(2, w - 1);
    return text.slice(0, Math.ceil(keep / 2)) + '…' + text.slice(text.length - Math.floor(keep / 2));
}

export function line(color, text) {
    return `${color}${fit(text)}${c.reset}`;
}

export function clear() {
    out(`${ESC}[H${ESC}[2J`);
}

// What to print on the normal screen when the tool ends, since the full-screen buffer disappears (what was saved). A tool pushes
// its lines onto it.
export const finalNotes = [];

export function leaveScreen() {
    out(`${MOUSE_OFF}${ESC}[?2004l${ESC}[?25h${c.reset}${SCREEN_OFF}`);
}

// Puts the terminal back and stops reading; Node then ends by itself (process.exit while the input is closing can crash on
// Windows). Returns a promise that never settles, so `await quit()` stops the caller where it is.
export function quit(message) {
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

export function startInput() {
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
export async function next() {
    const event = await new Promise((resolve) => {
        const queued = queue.shift();
        if (queued !== undefined) resolve(queued);
        else if (ended) resolve({ type: 'end' });
        else waiter = resolve;
    });
    if (event.type === 'end') await quit(settings.inputEnded);
    if (event.type === 'key' && event.name === 'ctrl-c') await quit(settings.stopped);
    return event;
}

// ---- opening a file with its program ----

export function openFile(file) {
    try {
        const [command, args] =
            process.platform === 'win32' ? ['cmd', ['/c', 'start', '', file]] : process.platform === 'darwin' ? ['open', [file]] : ['xdg-open', [file]];
        spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true }).unref();
    } catch {
        // the path is printed, so it can be opened by hand
    }
}

// ---- drawing ----

// The look (a big coloured title in a heavy frame with a small framed label, a coloured help line under a rule, heavy-line tables)
// is inspired by the terminal app Stock-Manager by MedAziz218 (MIT licence, github.com/MedAziz218/Stock-Manager); the letters
// and the code here are our own. No frame is drawn down the sides of the lines: an address or a link on a line stays clean to select.

export const visible = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

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
    P: ['╔═╗', '╠═╝', '╩  '],
    C: ['╔═╗', '║  ', '╚═╝'],
    H: ['╦ ╦', '╠═╣', '╩ ╩'],
    K: ['╦╔═', '╠╩╗', '╩ ╩'],
    I: ['╦', '║', '╩'],
    B: ['╔╗ ', '╠╩╗', '╚═╝'],
    R: ['╦═╗', '╠╦╝', '╩╚═'],
    0: ['╔═╗', '║ ║', '╚═╝'],
    1: ['╔╗ ', ' ║ ', '═╩═'],
    2: ['╔═╗', '╔═╝', '╚═╝'],
    3: ['╔═╗', ' ═╣', '╚═╝'],
    4: ['╦ ╦', '╚═╣', '  ╩'],
    5: ['╔═╗', '╚═╗', '╚═╝'],
    6: ['╔═╗', '╠═╗', '╚═╝'],
    7: ['╔═╗', '  ║', '  ╩'],
    8: ['╔═╗', '╠═╣', '╚═╝'],
    9: ['╔═╗', '╚═╣', '╚═╝'],
    ' ': ['   ', '   ', '   '],
};

// The text in big letters, alternating orange and yellow (or the two colours given): three rows. The letters touch, as in the
// usual figlet layout.
export function bigTitle(text, colors = [c.accent, c.title]) {
    const rows = ['', '', ''];
    [...text].forEach((letter, at) => {
        const glyph = GLYPHS[letter] ?? GLYPHS[' '];
        for (let row = 0; row < 3; row++) rows[row] += `${colors[at % 2]}${glyph?.[row] ?? ''}${c.reset}`;
    });
    return rows;
}

export const BOX_WIDTH = 76;
const COMPACT_WIDTH = 62;
const BIG_HEADER_ROWS = 7;

// The tall header: seven lines (the frame with the big title and the label, the step, a blank line).
function bigHeaderRows(step, title) {
    const art = bigTitle(settings.title);
    const artWidth = Math.max(...art.map((row) => visible(row).length));
    const label = [`╔${'═'.repeat(settings.label.length)}╗`, `║${settings.label}║`, `╚${'═'.repeat(settings.label.length)}╝`];
    const inner = BOX_WIDTH - 2;
    const edge = (left, right) => `${c.accent}${left}${'━'.repeat(inner)}${right}${c.reset}`;
    const rows = [edge('┏', '┓')];
    for (let row = 0; row < 3; row++) {
        const text = label[row] ?? '';
        const gap = ' '.repeat(Math.max(1, inner - 2 - artWidth - text.length));
        const side = `${c.accent}┃${c.reset}`;
        rows.push(`${side} ${art[row] ?? ''}${gap}${c.warn}${text}${c.reset} ${side}`);
    }
    return [...rows, edge('┗', '┛'), settings.stepLine(step, title), ''];
}

// The short header, for a small window: five lines.
function compactHeaderRows(step, title) {
    const w = Math.min(width(), COMPACT_WIDTH);
    const text = settings.compact;
    return [
        `${c.accent}╔${'═'.repeat(w - 2)}╗${c.reset}`,
        `${c.accent}║${c.title}${text.padEnd(w - 2)}${c.accent}║${c.reset}`,
        `${c.accent}╚${'═'.repeat(w - 2)}╝${c.reset}`,
        settings.stepLine(step, title),
        '',
    ];
}

// A header is a placeholder until the screen is drawn: it becomes the tall one when the window has room for the rest of the screen
// (`below` lines come after the lines given), and the short one when it does not.
export function header(step, title) {
    return [{ kind: 'header', step, title }];
}

export function expand(lines, below) {
    const available = process.stdout.rows ?? 30;
    const others = lines.filter((entry) => typeof entry === 'string').length;
    const tall = width() >= BOX_WIDTH && available >= others + below + BIG_HEADER_ROWS;
    return lines.flatMap((entry) => (typeof entry === 'string' ? [entry] : tall ? bigHeaderRows(entry.step, entry.title) : compactHeaderRows(entry.step, entry.title)));
}

// The line above the help line, the bottom of the frame.
export function rule() {
    return `${c.accent}${'━'.repeat(Math.min(width(), BOX_WIDTH))}${c.reset}`;
}

// The help line: the keys in colour.
export function helpLine() {
    return line('', settings.help);
}

// A table with heavy lines. columns: [{ title, width }]; rows: arrays of cell texts (they may carry colours).
export function table(columns, rows) {
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
export function tableRows(rows, max, columnCount) {
    if (rows.length <= max) return rows;
    const note = [`${c.grey}... and ${rows.length - max + 1} more${c.reset}`, ...Array(columnCount - 1).fill('')];
    return [...rows.slice(0, max - 1), note];
}

// Whether the window is tall enough for the tables (otherwise the plain lists are shown, as before).
export function tall() {
    return (process.stdout.rows ?? 30) >= 28 && width() >= BOX_WIDTH;
}

export function swatch(colors) {
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
export async function menu({ lines, items, footer = [], start = 0 }) {
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
export async function notice(lines, button = 'Continue') {
    await menu({ lines, items: [{ label: button }] });
}
