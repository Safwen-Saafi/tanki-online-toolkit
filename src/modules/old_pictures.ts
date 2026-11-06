// Isolated-world content script. The devs replaced the game's augment pictures with new ones, and the owner wants the old ones back.
// The 515 old pictures (SVG files) are bundled in extension/old_pictures/, and extension/data/old_pictures.json lists the stable path
// of each: the picture's address on the game's server without the version folder, for example /634/112237/40/362/image.svg for
// https://s.eu.tankionline.com/634/112237/40/362/31770757017104/image.svg (the number just before image.svg changes when the devs
// update a picture, the rest never does). The idea, and the list of paths, come from augments.user.js in the repo
// doomersson/doomersson.github.io (no license; none of its code is used). The old files themselves were taken once from the game's
// server and never change, and an augment added after the devs' change has no old picture and keeps the game's own, so there is
// no upkeep.
// This script does two things. It tells the page (kasp:old-pictures), where src/injector.ts swaps an address as the game assigns
// it, and it publishes window.kaspOldPictures so the modules that draw a game picture themselves (augments.ts) show the same
// picture: the page's hooks never see what an isolated script writes. The rule for a stable path and a file name is also written in
// src/injector.ts and in scripts/old-style-picture/lib.mjs, on purpose, since scripts share no imports; change all three together.
// Off when its switch, kasp_old_pictures, is off in the extension's settings tab.
(function () {
    'use strict';

    const LOG = '[KI-test][old pictures]';
    const KILL_SWITCH_KEY = 'kasp_old_pictures';
    const LIST_PATH = 'data/old_pictures.json';
    const FOLDER = 'old_pictures/';
    // A stable path: two or more numbers, then image.svg.
    const STABLE_PATH = /^(?:\/\d{1,12}){2,}\/image\.svg$/;
    // The name of a bundled file: the stable path without its first slash and without /image.svg, the slashes turned into dashes.
    const FILE_NAME = /^(\d{1,12}(?:-\d{1,12})+)\.svg$/;
    const GAME_HOST = /(^|\.)tankionline\.com$/;
    const MAX_KEYS = 5000;

    let known: ReadonlySet<string> = new Set();
    let base: string | null = null;
    // The old pictures that did not load, so the game's own is shown for them from then on.
    const failed = new Set<string>();

    // The user's switch, set in the extension's settings tab: read once at start through the switch service
    // (src/modules/switches.ts), so a change applies after a reload. Without the service the switch counts as on.
    const switchedOn = window.kaspSwitches?.isOn(KILL_SWITCH_KEY) ?? true;

    function describeError(e: unknown): string {
        return e instanceof Error ? e.message : String(e);
    }

    // The stable path of a game address, or null for anything else (another host, another file, an address that is not one).
    function stablePath(address: string): string | null {
        try {
            const url = new URL(address, window.location.href);
            if (url.protocol !== 'https:' || !GAME_HOST.test(url.hostname)) return null;
            const parts = url.pathname.split('/').filter((part) => part !== '');
            if (parts[parts.length - 1] !== 'image.svg') return null;
            parts.splice(parts.length - 2, 1);
            const path = '/' + parts.join('/');
            return STABLE_PATH.test(path) ? path : null;
        } catch {
            return null;
        }
    }

    function fileOf(path: string): string {
        return path.slice(1, -'/image.svg'.length).replace(/\//g, '-') + '.svg';
    }

    // The stable path of one of our own bundled files' addresses, so a picture already swapped is still known by its path.
    function pathOfOwnFile(address: string): string | null {
        if (base === null || !address.startsWith(base)) return null;
        const match = FILE_NAME.exec(address.slice(base.length));
        return match === null || match[1] === undefined ? null : `/${match[1].replace(/-/g, '/')}/image.svg`;
    }

    // The stable path of a game picture, or of the bundled file that stands for it; any other address comes back as it is.
    function keyOf(address: string): string {
        return stablePath(address) ?? pathOfOwnFile(address) ?? address;
    }

    // The address of the old picture for a game address, or the address itself when there is none (or it did not load).
    function swap(address: string): string {
        if (base === null) return address;
        const path = stablePath(address);
        return path !== null && known.has(path) && !failed.has(path) ? base + fileOf(path) : address;
    }

    // Called with the game's address when its old picture did not load: the game's own is shown for it from then on.
    function markFailed(address: string): void {
        const path = stablePath(address);
        if (path !== null) failed.add(path);
    }

    window.kaspOldPictures = { swap, keyOf, markFailed };

    function readList(value: unknown): ReadonlySet<string> | null {
        if (typeof value !== 'object' || value === null) return null;
        const { keys } = value as { keys?: unknown };
        if (!Array.isArray(keys) || keys.length === 0 || keys.length > MAX_KEYS) return null;
        const checked = new Set<string>();
        for (const key of keys as unknown[]) {
            if (typeof key !== 'string' || !STABLE_PATH.test(key)) return null;
            checked.add(key);
        }
        return checked;
    }

    async function load(): Promise<void> {
        try {
            const res = await fetch(chrome.runtime.getURL(LIST_PATH));
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const list = readList(await res.json());
            if (list === null) throw new Error('the list is not valid');
            known = list;
            base = chrome.runtime.getURL(FOLDER);
            const message: KaspOldPicturesMessage = { type: 'kasp:old-pictures', base, keys: [...list] };
            window.postMessage(message, window.location.origin);
        } catch (e) {
            console.warn(`${LOG} the old pictures cannot be used, the game's own stay:`, describeError(e));
        }
    }

    if (!switchedOn) console.log(`${LOG} disabled (switch ${KILL_SWITCH_KEY} is off)`);
    else void load();
})();
