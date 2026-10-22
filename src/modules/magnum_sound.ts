// Isolated-world content script. Sends the owner's Magnum shot sounds to src/injector.ts, which then makes the game decode
// those files instead of the game's own shot files (see the sound swap there), so the game still plays them where it
// always played the shot. The game has a shot file for each distance, so each of the owner's files lists the game's
// resource numbers it stands for. extension/data/magnum.json holds the groups (a file in extension/sounds/ and its
// numbers) and the numbers to silence, so a game update that renumbers a sound is fixed by editing that file. A file
// that cannot be loaded leaves its numbers as the game's own sound; when nothing can be loaded, nothing is sent. The
// whole module is off when the switch is off.
(function () {
    'use strict';

    const LOG = '[KI-test][magnum_sound]';
    const CONFIG_PATH = 'data/magnum.json';
    const SOUNDS_DIR = 'sounds/';
    const KILL_SWITCH_KEY = 'kasp_magnumsound';
    const SAFE_FILE_NAME = /^[\w-]+(?:\.[\w-]+)*\.(?:mp3|ogg|wav)$/i;
    // The four numbers of a game sound address joined with "/", for example 0/16723/73/223 (the injector checks it too).
    const RESOURCE_NUMBER = /^\d+(?:\/\d+){1,5}$/;
    const MAX_BYTES = 2 * 1024 * 1024;
    const MAX_FILES = 10;

    // The user's own switch: only the exact value 0 turns the replacement off, and the extension never writes it.
    function isSwitchedOff(): boolean {
        try {
            return localStorage.getItem(KILL_SWITCH_KEY) === '0';
        } catch {
            return false;
        }
    }

    // The resource numbers in a list; a value that is not a number of the right form is left out, so a mistake in the
    // file costs one sound, not the rest.
    function parseNumbers(value: unknown): string[] {
        if (!Array.isArray(value)) return [];
        return value.filter((item): item is string => typeof item === 'string' && RESOURCE_NUMBER.test(item));
    }

    // One group of the list: a safe file name and at least one usable number, or null.
    function parseGroup(value: unknown): MagnumSoundGroup | null {
        if (!value || typeof value !== 'object') return null;
        const group = value as Partial<Record<keyof MagnumSoundGroup, unknown>>;
        if (typeof group.file !== 'string' || !SAFE_FILE_NAME.test(group.file)) return null;
        const numbers = parseNumbers(group.numbers);
        return numbers.length === 0 ? null : { file: group.file, numbers };
    }

    // The list read from the data file, or null when it holds no usable group.
    function parseConfig(value: unknown): MagnumSoundConfig | null {
        if (!value || typeof value !== 'object') return null;
        const config = value as Partial<Record<keyof MagnumSoundConfig, unknown>>;
        if (!Array.isArray(config.replace)) return null;
        const replace = config.replace.slice(0, MAX_FILES).map(parseGroup).filter((group): group is MagnumSoundGroup => group !== null);
        return replace.length === 0 ? null : { replace, silence: parseNumbers(config.silence) };
    }

    async function loadGroup(group: MagnumSoundGroup): Promise<KaspSoundReplacement> {
        const response = await fetch(chrome.runtime.getURL(SOUNDS_DIR + group.file));
        if (!response.ok) throw new Error(`${group.file}: HTTP ${response.status}`);
        const data = await response.arrayBuffer();
        if (data.byteLength === 0 || data.byteLength > MAX_BYTES) {
            throw new Error(`${group.file} must be between 1 byte and ${MAX_BYTES} bytes, it is ${data.byteLength}`);
        }
        return { data, numbers: [...group.numbers] };
    }

    async function sendSwap(): Promise<void> {
        const listResponse = await fetch(chrome.runtime.getURL(CONFIG_PATH));
        if (!listResponse.ok) throw new Error(`${CONFIG_PATH}: HTTP ${listResponse.status}`);
        const config = parseConfig(await listResponse.json());
        if (config === null) throw new Error(`${CONFIG_PATH} holds no usable file with numbers to replace`);
        const results = await Promise.allSettled(config.replace.map(loadGroup));
        const replacements: KaspSoundReplacement[] = [];
        const failures: string[] = [];
        for (const result of results) {
            if (result.status === 'fulfilled') replacements.push(result.value);
            else failures.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
        }
        // one warning for everything that could not be loaded; those numbers keep the game's own sound
        if (failures.length > 0) console.warn(LOG, `the game keeps its own sound for some Magnum shots: ${failures.join('; ')}`);
        if (replacements.length === 0) return;
        const message: KaspSoundSwapMessage = { type: 'kasp:sound-swap', replacements, silence: [...config.silence] };
        window.postMessage(message, window.location.origin);
        const files = replacements.length;
        const numbers = replacements.reduce((sum, item) => sum + item.numbers.length, 0);
        console.log(LOG, `ready: ${files} sound files stand for ${numbers} game sound files, ${config.silence.length} silenced`);
    }

    if (isSwitchedOff()) {
        console.log(LOG, 'disabled');
        return;
    }
    sendSwap().catch((error: unknown) => {
        console.warn(LOG, 'the game keeps its own Magnum sound:', error instanceof Error ? error.message : error);
    });
})();
