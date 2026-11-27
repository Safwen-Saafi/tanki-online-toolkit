// The game update check's engine: runs the extension's own built injector on a game bundle, offline in Node, the way the page
// does, and says which of its changes went into the game's code and what it warned about. Nothing in the extension changes for
// this: the injector is loaded as it ships, and a stand-in browser answers it. No dependencies (Node 18 or later).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// What the injector prints and how it finds the game's bundle (src/injector.ts). If one of these changes there, change it here
// in the same commit: the injector's notes in coding-standards.md say so.
const LOG_PREFIX = '[KI-test][injector]';
const HOOKS_LINE = 'hooks added to the game: ';
const BUNDLE_HOST = 'https://s.eu.tankionline.com';
const PAGE_URL = 'https://tankionline.com/play/';
const WAIT_MS = 60000;

// Every switch is on when its key is missing, so the stand-in storage has no keys, except the game colour: with the game's own
// blue the colour edit does nothing, so a colour is set to make it run too.
const STORAGE = { kasp_theme: 'pink' };

// A stand-in for anything the injector reaches that this file does not answer on purpose: every property is another stand-in,
// a call or `new` gives one back, and it reads as an empty text. It is never a promise (no `then`) and never iterates anything,
// so the injector's own code takes its "not there" paths quietly instead of throwing.
function standIn() {
    const children = new Map();
    const target = function () {};
    return new Proxy(target, {
        get(t, key) {
            if (key === 'then') return undefined;
            if (key === Symbol.toPrimitive) return () => '';
            if (key === Symbol.iterator) return function* () {};
            if (typeof key === 'symbol') return undefined;
            if (key === 'prototype' || key === 'length' || key === 'name') {
                if (!children.has(key)) children.set(key, key === 'prototype' ? standIn() : key === 'length' ? 0 : '');
                return children.get(key);
            }
            if (Object.prototype.hasOwnProperty.call(t, key)) return t[key];
            if (!children.has(key)) children.set(key, standIn());
            return children.get(key);
        },
        set(t, key, value) {
            children.set(key, value);
            return true;
        },
        apply: () => standIn(),
        construct: () => standIn(),
    });
}

// An object with the parts that matter written out, and a stand-in behind it for everything else.
function withStandIn(own) {
    const rest = standIn();
    return new Proxy(own, {
        get: (t, key) => (key in t ? t[key] : rest[key]),
        has: () => true,
    });
}

function sentence(args) {
    return args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : String(a))).join(' ');
}

// The hooks line is "a, b, game-colour (12 colours, 3 kept styles), c": split on the commas outside brackets.
function readHooks(line) {
    const list = line.slice(line.indexOf(HOOKS_LINE) + HOOKS_LINE.length);
    return list.split(/, (?![^(]*\))/).map((s) => s.trim()).filter(Boolean);
}

// Runs the built injector on one bundle's text. Resolves with the hooks that went in, the injector's warnings and errors (its
// prefix taken off), and the patched code; `failed` is set when the run itself went wrong, which is a fault of this check (a
// stand-in that is missing something), never of the game.
export async function runInjector(injectorPath, bundleText, bundleName) {
    const injector = fs.readFileSync(injectorPath, 'utf8');
    const lines = { log: [], warn: [], error: [] };
    const result = { hooked: [], warnings: [], errors: [], patchedCode: null, failed: null };
    let finish;
    const done = new Promise((resolve) => {
        finish = resolve;
    });

    const capture = (kind) => (...args) => {
        const text = sentence(args);
        lines[kind].push(text);
    };
    const console = { log: capture('log'), warn: capture('warn'), error: capture('error'), info() {}, debug() {} };

    class HTMLScriptElement {
        constructor(src = '') {
            this.src = src;
            this.type = '';
            this.textContent = '';
        }
        remove() {}
    }
    const documentElement = withStandIn({});
    // The injector puts the patched code on a script element it appends, then empties it; the code is taken at the append.
    const appendChild = (node) => {
        if (node instanceof HTMLScriptElement) {
            if (node.textContent !== '') result.patchedCode = node.textContent;
            finish();
        }
        return node;
    };
    const document = withStandIn({
        documentElement,
        head: withStandIn({ appendChild }),
        scripts: [],
        createElement: (tag) => (String(tag).toLowerCase() === 'script' ? new HTMLScriptElement() : standIn()),
    });

    let bundleArrived = null;
    class MutationObserver {
        constructor(callback) {
            this.callback = callback;
        }
        observe(target) {
            if (target === documentElement) bundleArrived = this.callback;
        }
        disconnect() {}
        takeRecords() {
            return [];
        }
    }

    const bundleUrl = `${BUNDLE_HOST}/static/js/${bundleName}`;
    const fetch = async (url) => {
        if (String(url) === bundleUrl) return { ok: true, status: 200, text: async () => bundleText };
        return { ok: false, status: 404, text: async () => '', json: async () => null };
    };

    const localStorage = withStandIn({
        getItem: (key) => (Object.prototype.hasOwnProperty.call(STORAGE, key) ? STORAGE[key] : null),
        setItem() {},
        removeItem() {},
    });

    const context = vm.createContext({
        console,
        document,
        MutationObserver,
        HTMLScriptElement,
        fetch,
        localStorage,
        sessionStorage: localStorage,
        location: withStandIn({ href: PAGE_URL, origin: 'https://tankionline.com', hostname: 'tankionline.com', protocol: 'https:' }),
        // The injector's own one-shot timers (its watchdog) never need to run for this check.
        setTimeout: () => 0,
        clearTimeout() {},
        setInterval: () => 0,
        clearInterval() {},
    });
    // Any browser name the injector reads that is not given above (HTMLImageElement, XMLHttpRequest, CSS, chrome and so on) is
    // found on the global's prototype, as a stand-in. The real JavaScript built-ins are the global's own and are found first.
    vm.runInContext('(fallback) => { Object.setPrototypeOf(globalThis, fallback); globalThis.window = globalThis; globalThis.self = globalThis; }', context)(
        new Proxy({}, { has: (t, key) => typeof key === 'string', get: (t, key) => (typeof key === 'string' ? standIn() : undefined) }),
    );

    const timer = setTimeout(() => {
        result.failed = `the injector did not finish within ${WAIT_MS / 1000} s`;
        finish();
    }, WAIT_MS);
    try {
        vm.runInContext(injector, context, { filename: 'injector.js' });
        if (bundleArrived === null) throw new Error('the injector did not start watching the page for the game bundle');
        // What the page does: the game's bundle tag is added to the page.
        bundleArrived([{ addedNodes: [new HTMLScriptElement(bundleUrl)] }]);
        await done;
    } catch (e) {
        result.failed = e instanceof Error ? e.message : String(e);
    } finally {
        clearTimeout(timer);
    }

    const strip = (text) => (text.startsWith(LOG_PREFIX) ? text.slice(LOG_PREFIX.length).trim() : text);
    const hooksLine = lines.log.find((line) => line.includes(HOOKS_LINE));
    if (hooksLine !== undefined) result.hooked = readHooks(hooksLine);
    result.warnings = lines.warn.map(strip);
    result.errors = lines.error.map(strip);
    if (result.failed === null && result.patchedCode === null) {
        // The injector gave the page the bundle's address instead of patched code: its download or its patch failed.
        result.failed = 'the injector did not patch the bundle' + (result.warnings.length > 0 ? `: ${result.warnings.at(-1)}` : '');
    }
    return result;
}

// ---- the game's current bundle ----

// A plain browser name, and nothing about the owner. Only the play page and the bundle address written in it are fetched.
const DOWNLOAD_HEADERS = { 'User-Agent': 'Mozilla/5.0' };
const DOWNLOAD_MS = 60000;
const BUNDLE_ADDRESS = /(?:https:\/\/[a-z0-9.-]+\.tankionline\.com)?\/static\/js\/(main\.[0-9a-f]+\.js)/;

// Thrown for a problem the owner can act on; its message is shown as it is, with no stack trace.
export class Plain extends Error {}

async function download(url, what) {
    let res;
    try {
        res = await fetch(url, { headers: DOWNLOAD_HEADERS, signal: AbortSignal.timeout(DOWNLOAD_MS) });
    } catch {
        throw new Plain(`Could not download ${what} (${url}). Is the internet on? Try again in a minute.`);
    }
    if (!res.ok) throw new Plain(`Could not download ${what} (${url}): the server answered ${res.status}. Try again in a minute.`);
    return res.text();
}

// Finds the bundle the play page loads today: its file name (main.<hash>.js) and full address.
export async function currentBundleAddress() {
    const page = await download(PAGE_URL, 'the game\'s play page');
    const found = BUNDLE_ADDRESS.exec(page);
    if (found === null) throw new Plain(`The play page (${PAGE_URL}) has no main.<hash>.js address in it: the game changed how it loads. Check the page by hand.`);
    const url = found[0].startsWith('/') ? new URL(found[0], BUNDLE_HOST).href : found[0];
    return { name: found[1], url };
}

// Downloads the bundle into the folder, unless that file is already there. Returns its path.
export async function fetchBundle(folder, { name, url }) {
    const file = path.join(folder, name);
    if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
    const text = await download(url, 'the game bundle');
    fs.mkdirSync(folder, { recursive: true });
    // Written beside it first, so a download cut halfway never leaves a broken bundle under its real name.
    fs.writeFileSync(file + '.part', text);
    fs.renameSync(file + '.part', file);
    return file;
}

// ---- the known-good bundle ----

const GOOD_CODE = 'known-good.js';
const GOOD_NOTE = 'known-good.json';

// The bundle last saved as working, or null when none is saved yet.
export function knownGood(folder) {
    const code = path.join(folder, GOOD_CODE);
    const note = path.join(folder, GOOD_NOTE);
    if (!fs.existsSync(code) || !fs.existsSync(note)) return null;
    try {
        const { name, savedAt } = JSON.parse(fs.readFileSync(note, 'utf8'));
        if (typeof name !== 'string' || typeof savedAt !== 'string') return null;
        return { file: code, name, savedAt };
    } catch {
        return null;
    }
}

export function saveKnownGood(folder, bundleFile) {
    fs.mkdirSync(folder, { recursive: true });
    fs.copyFileSync(bundleFile, path.join(folder, GOOD_CODE));
    const note = { name: path.basename(bundleFile), savedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(folder, GOOD_NOTE), JSON.stringify(note, null, 4) + '\n');
    return note;
}
