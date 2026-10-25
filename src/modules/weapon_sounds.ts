// Isolated-world content script. Sends the owner's weapon sounds (Magnum, Striker, Gauss) to src/injector.ts, which then
// makes the game decode those files instead of the game's own sound files (see the sound swap there), so the game still
// plays them where it always played the sound. The game has a sound file for each distance of a shot, so each of the
// owner's files lists the game's resource numbers it stands for. extension/data/weapon_sounds.json holds the groups (a file in
// extension/sounds/ and its numbers), so a game update that renumbers a sound is fixed by
// editing that file. A group may name a turret ("turret": "gauss"): it is for a sound file that several turrets share (the
// lock-on sounds), so it is not swapped as the game decodes it, which is before the game says which turret the player has.
// It is sent once as it is (kasp:late-sounds), and the injector writes it into the game's decoded sound while that turret is the
// mounted one. This script makes out the mounted turret from the game's announcement (kasp:mounted: from the garage's items,
// which carry the item's name, and from the battle's tank list, which carries ids only) and tells the injector (kasp:turret).
// A file that cannot be loaded leaves its numbers as the game's own sound; when nothing can be loaded, nothing is sent. The
// whole module is off when the switch is off.
(function () {
    'use strict';

    const LOG = '[KI-test][weapon_sounds]';
    const CONFIG_PATH = 'data/weapon_sounds.json';
    const SKINS_PATH = 'data/skins.json';
    const SOUNDS_DIR = 'sounds/';
    const KILL_SWITCH_KEY = 'kasp_weaponsounds';
    const SAFE_FILE_NAME = /^[\w-]+(?:\.[\w-]+)*\.(?:mp3|ogg|wav)$/i;
    // The four numbers of a game sound address joined with "/", for example 0/16723/73/223 (the injector checks it too).
    const RESOURCE_NUMBER = /^\d+(?:\/\d+){1,5}$/;
    // An item's name as skins.json writes it ("gauss"), and an item id as the game writes it.
    const TURRET_NAME = /^[a-z][a-z0-9-]*$/;
    const ITEM_ID = /^\d{1,20}$/;
    const MAX_BYTES = 2 * 1024 * 1024;
    // The most groups read from the list. src/injector.ts has its own MAX_SWAP_FILES, so change both together.
    const MAX_FILES = 10;
    const MAX_ITEM_NAME = 60;
    const MAX_TURRETS = 40;
    const MAX_IDS = 10;

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

    // One group of the list: a safe file name and at least one usable number, or null. A group with a turret that is not
    // a plain name is dropped, so a typo never turns a one-turret sound into a sound for every turret.
    function parseGroup(value: unknown): WeaponSoundGroup | null {
        if (!value || typeof value !== 'object') return null;
        const group = value as Partial<Record<keyof WeaponSoundGroup, unknown>>;
        if (typeof group.file !== 'string' || !SAFE_FILE_NAME.test(group.file)) return null;
        const numbers = parseNumbers(group.numbers);
        if (numbers.length === 0) return null;
        if (group.turret === undefined) return { file: group.file, numbers };
        if (typeof group.turret !== 'string' || !TURRET_NAME.test(group.turret)) return null;
        return { file: group.file, numbers, turret: group.turret };
    }

    // The ids the game gives each turret in a battle, by the turret's plain name.
    function parseTurrets(value: unknown): Record<string, string[]> {
        const turrets: Record<string, string[]> = {};
        if (!value || typeof value !== 'object' || Array.isArray(value)) return turrets;
        for (const [name, ids] of Object.entries(value as Record<string, unknown>).slice(0, MAX_TURRETS)) {
            if (!TURRET_NAME.test(name) || !Array.isArray(ids)) continue;
            turrets[name] = ids.filter((id): id is string => typeof id === 'string' && ITEM_ID.test(id)).slice(0, MAX_IDS);
        }
        return turrets;
    }

    // The list read from the data file, or null when it holds no usable group.
    function parseConfig(value: unknown): WeaponSoundConfig | null {
        if (!value || typeof value !== 'object') return null;
        const config = value as Partial<Record<keyof WeaponSoundConfig, unknown>>;
        if (!Array.isArray(config.replace)) return null;
        if (config.replace.length > MAX_FILES) {
            const ignored = config.replace.slice(MAX_FILES).map((value) => (value as { file?: unknown } | null)?.file ?? '?');
            console.warn(LOG, `${CONFIG_PATH} holds ${config.replace.length} groups, only the first ${MAX_FILES} load; ignored: ${ignored.join(', ')}`);
        }
        const replace = config.replace.slice(0, MAX_FILES).map(parseGroup).filter((group): group is WeaponSoundGroup => group !== null);
        return replace.length === 0 ? null : { replace, turrets: parseTurrets(config.turrets) };
    }

    async function loadFile(file: string): Promise<ArrayBuffer> {
        const response = await fetch(chrome.runtime.getURL(SOUNDS_DIR + file));
        if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
        const data = await response.arrayBuffer();
        if (data.byteLength === 0 || data.byteLength > MAX_BYTES) {
            throw new Error(`${file} must be between 1 byte and ${MAX_BYTES} bytes, it is ${data.byteLength}`);
        }
        return data;
    }

    // Every group loaded, with its file; the ones that could not be loaded are reported once and left to the game's own sound.
    async function loadGroups(groups: readonly WeaponSoundGroup[]): Promise<Array<{ group: WeaponSoundGroup; data: ArrayBuffer }>> {
        const results = await Promise.allSettled(groups.map((group) => loadFile(group.file)));
        const loaded: Array<{ group: WeaponSoundGroup; data: ArrayBuffer }> = [];
        const failures: string[] = [];
        results.forEach((result, index) => {
            if (result.status === 'fulfilled') loaded.push({ group: groups[index], data: result.value });
            else failures.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
        });
        // one warning for everything that could not be loaded; those numbers keep the game's own sound
        if (failures.length > 0) console.warn(LOG, `the game keeps its own sound for some weapon sounds: ${failures.join('; ')}`);
        return loaded;
    }

    // ---- the mounted turret ----

    // The plain name of an item the game names in words ("Gauss", or the Russian name), as skins.json writes it ("gauss").
    function plainName(itemName: string, names: Readonly<Record<string, string>>): string {
        const word = itemName.trim().toLowerCase();
        return Object.prototype.hasOwnProperty.call(names, word) ? names[word] : word;
    }

    // The turret fields of a kasp:mounted message, or null when it is another message.
    interface MountedTurret {
        readonly name: string;
        readonly id: string;
        readonly baseId: string;
    }

    function readMountedTurret(data: unknown): MountedTurret | null {
        if (!data || typeof data !== 'object' || (data as { type?: unknown }).type !== 'kasp:mounted') return null;
        const { name, id, baseId } = data as Partial<Record<'name' | 'id' | 'baseId', unknown>>;
        if (typeof name !== 'string' || name.length > MAX_ITEM_NAME) return null;
        if (typeof id !== 'string' || !ITEM_ID.test(id)) return null;
        if (baseId !== undefined && (typeof baseId !== 'string' || !ITEM_ID.test(baseId))) return null;
        return { name, id, baseId: baseId ?? '' };
    }

    async function start(): Promise<void> {
        let names: Readonly<Record<string, string>> = {};
        let config: WeaponSoundConfig | null = null;
        const idsOfTurret = new Map<string, string>();      // item id -> plain name: the ones in the data file, and the ones learned from the garage
        let mounted: MountedTurret | null = null;
        let sentTurret: string | null = null;

        // The mounted turret as a plain name, '' when the game said something this cannot be turned into a name for.
        const currentTurret = (): string => {
            if (mounted === null) return '';
            const known = idsOfTurret.get(mounted.id) ?? idsOfTurret.get(mounted.baseId);
            const turret = known ?? (mounted.name === '' ? '' : plainName(mounted.name, names));
            return TURRET_NAME.test(turret) ? turret : '';
        };

        // A turret change is told to the injector, once it is known which sounds there are (the list may still be loading).
        const refresh = (): void => {
            if (config === null) return;
            const turret = currentTurret();
            if (turret === sentTurret) return;
            sentTurret = turret;
            const message: KaspTurretMessage = { type: 'kasp:turret', turret };
            window.postMessage(message, window.location.origin);
        };

        // the message may come before the list is loaded, so the listener is the first thing that is set up
        window.addEventListener('message', (e: MessageEvent) => {
            if (e.source !== window) return;
            const next = readMountedTurret(e.data);
            if (next === null) return;
            // an item the garage names teaches the id for the battle's lists, which give no names
            if (next.name !== '') {
                const turret = plainName(next.name, names);
                if (TURRET_NAME.test(turret)) {
                    idsOfTurret.set(next.id, turret);
                    if (next.baseId !== '') idsOfTurret.set(next.baseId, turret);
                }
            }
            mounted = next;
            refresh();
        });
        // the game may have said it before this listener was set up, so the injector is asked to say it again
        const request: KaspMountedRequestMessage = { type: 'kasp:mounted-request' };
        window.postMessage(request, window.location.origin);

        const listResponse = await fetch(chrome.runtime.getURL(CONFIG_PATH));
        if (!listResponse.ok) throw new Error(`${CONFIG_PATH}: HTTP ${listResponse.status}`);
        const parsed = parseConfig(await listResponse.json());
        if (parsed === null) throw new Error(`${CONFIG_PATH} holds no usable file with numbers to replace`);
        const forTurrets = parsed.replace.filter((group) => group.turret !== undefined);
        if (forTurrets.length > 0) {
            try {
                const skinsResponse = await fetch(chrome.runtime.getURL(SKINS_PATH));
                if (skinsResponse.ok) names = ((await skinsResponse.json()) as SkinsDatabase).names;
            } catch {
                // without the names the game's own name, lower case, is used
            }
            for (const [turret, ids] of Object.entries(parsed.turrets ?? {})) for (const id of ids) idsOfTurret.set(id, turret);
        }

        const [plain, late] = await Promise.all([
            loadGroups(parsed.replace.filter((group) => group.turret === undefined)),
            loadGroups(forTurrets),
        ]);
        if (plain.length > 0) {
            const swap: KaspSoundSwapMessage = {
                type: 'kasp:sound-swap',
                replacements: plain.map(({ group, data }) => ({ data, numbers: [...group.numbers] })),
            };
            window.postMessage(swap, window.location.origin);
            const numbers = plain.reduce((sum, { group }) => sum + group.numbers.length, 0);
            console.log(LOG, `ready: ${plain.length} sound files stand for ${numbers} game sound files`);
        }
        if (late.length > 0) {
            const lateMessage: KaspLateSoundsMessage = {
                type: 'kasp:late-sounds',
                groups: late.map(({ group, data }) => ({ turret: group.turret ?? '', data, numbers: [...group.numbers] })),
            };
            window.postMessage(lateMessage, window.location.origin);
            console.log(LOG, `ready: ${late.length} sound files for a turret (${[...new Set(late.map(({ group }) => group.turret))].join(', ')})`);
        }
        config = parsed;
        refresh();
    }

    if (isSwitchedOff()) {
        console.log(LOG, 'disabled');
        return;
    }
    start().catch((error: unknown) => {
        console.warn(LOG, 'the game keeps its own weapon sounds:', error instanceof Error ? error.message : error);
    });
})();
