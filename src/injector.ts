// MAIN-world content script, the only one allowed to touch the page's own JavaScript. It holds back the game's main
// bundle, fetches it, adds one call to the constructor of six of the game's classes and one to a handler, and runs the
// patched copy. TankUserActionLog's call (window.__kaspSendAction) posts the strings of each equipment action, which is how
// change_counter.ts learns who changed equipment. TankDestroyActionLog's call (window.__kaspSendKill) posts each kill of
// the game's kill feed, which is how kill_sounds.ts learns who killed whom. BattleStatistics's call
// (window.__kaspSendBattleTime) posts the battle's time, which is how battle_music.ts knows the end is near. The
// handler's call (window.__kaspSendGrenadeThrow) posts each throw of the player's own grenade, for grenade_sounds.ts.
// Three more say which turret the player has, for weapon_sounds.ts, which answers with the turret:
// GarageItem's (window.__kaspSendGarageItem, from the garage), SetUserId's (window.__kaspSendUserId, the player's own id)
// and SetTankInfo's (window.__kaspSendTankInfo, the battle's list of tanks, of which the player's own is used).
// A last, separate part wraps the page's own XMLHttpRequest, Response and decodeAudioData so that the game decodes the
// owner's file instead of some of its weapon sound files (kasp:sound-swap from weapon_sounds.ts), and rewrites the
// game's decoded lock sounds while the player's turret has its own (kasp:late-sounds and kasp:turret). Each hook is
// found and skipped on its own. When anything goes wrong the game's own bundle is run without the hook that failed (or
// unpatched), so the extension can lose a hook but never the game. One more part patches nothing: it reads each garage card's
// name, rank and picture address from the game's React data for the hidden augment cards (kasp:cards-request from augments.ts).
// Another part swaps the game's augment pictures for the old ones bundled in the extension, as the game assigns their addresses (kasp:old-pictures from old_pictures.ts).
// The chat translation hook posts each player's battle chat message (window.__kaspChat, kasp:chat) for chat_translation.ts.
// The game colour part paints the game's blue look in the colour saved under kasp_theme, by rewriting the colours in the game's
// code once before it runs; a new colour applies at the next start.
(function () {
    'use strict';

    const LOG = '[KI-test][injector]';
    // The game replaces the page's console functions with empty ones, and this script shares the page's console. The real
    // ones are kept from before any game script runs, so a failure of the hook is still reported.
    const log = console.log.bind(console);
    const warn = console.warn.bind(console);
    const error = console.error.bind(console);
    const BUNDLE_PATH = '/static/js/main.';
    const WATCHDOG_MS = 8000;
    // A download that hangs would leave the game waiting, so after this long the original script address is used instead.
    const BUNDLE_TIMEOUT_MS = 30000;
    // How deep into the action object strings are collected, and how long one may be. change_counter.ts reads
    // nicknames out of this range, so the two files go together.
    const MAX_DEPTH = 2;
    const MIN_STRING_LENGTH = 2;
    const MAX_STRING_LENGTH = 29;

    // Every message posted on the page reaches every message listener of this world, the game's own messages too (its coroutines
    // post one for each batch of work), so this world has one listener for the extension's messages: it drops anything that is
    // not an object with a type at once and hands the rest to the one part that reads that type. A part that throws changes
    // nothing for the game.
    const messageParts = new Map<string, (data: Record<string, unknown>) => void>();

    function onMessage(type: string, read: (data: Record<string, unknown>) => void): void {
        messageParts.set(type, read);
    }

    window.addEventListener('message', (e: MessageEvent) => {
        if (e.source !== window) return;
        const data: unknown = e.data;
        if (!isObject(data) || typeof data['type'] !== 'string') return;
        const read = messageParts.get(data['type']);
        if (read === undefined) return;
        try {
            read(data);
        } catch {
            // a message that cannot be read leaves things as they were
        }
    });

    // The strings and numbers inside an object, to MAX_DEPTH levels, as short trimmed strings.
    function collectStrings(root: unknown): string[] {
        const found: string[] = [];
        const seen = new Set<object>();

        function walk(value: unknown, depth: number): void {
            if (depth > MAX_DEPTH || !value || typeof value !== 'object' || seen.has(value)) return;
            seen.add(value);
            let keys: string[];
            try {
                keys = Object.keys(value);
            } catch {
                return;
            }
            for (const key of keys) {
                let child: unknown;
                try {
                    child = (value as Record<string, unknown>)[key];
                } catch {
                    continue;
                }
                if (child === null || child === undefined) continue;
                if (typeof child === 'string' || typeof child === 'number') {
                    const text = String(child).trim();
                    if (text.length >= MIN_STRING_LENGTH && text.length <= MAX_STRING_LENGTH) found.push(text);
                } else if (typeof child === 'object' && depth < MAX_DEPTH) {
                    walk(child, depth + 1);
                }
            }
        }

        walk(root, 0);
        return found;
    }

    // Called from inside the game's code, so it must never throw into it.
    window.__kaspSendAction = function (className: string, obj: unknown): void {
        try {
            const message: KaspUserActionMessage = { type: 'kasp:useraction', detail: [className, ...collectStrings(obj)] };
            window.postMessage(message, window.location.origin);
        } catch {
            // a missed action only means one marker is not lit
        }
    };

    // What the game prints for a kill, from its Kotlin data classes (the nickname and the clan tag are plain text):
    // TankDestroyActionLog(userLabelData=UserLabelData(userId=1, uid=a, rank=31, hasPremium=false, clanTag=null, teamRelation=ALLY),
    // destroyedUserLabelData=UserLabelData(...), damageType=SMOKY, isCritical=false, type=KILL). Reading the text instead of the
    // object means a renamed minified property cannot swap the killer and the victim.
    const LABEL = 'UserLabelData\\(userId=(-?\\d+), uid=(.*?), rank=-?\\d+, hasPremium=(?:true|false), clanTag=(.*?), teamRelation=(\\w+)\\)';
    const KILL_PATTERN = new RegExp(`^TankDestroyActionLog\\(userLabelData=${LABEL}, destroyedUserLabelData=${LABEL}, damageType=(\\w+), isCritical=(true|false), type=(\\w+)\\)$`);

    function parseKillText(text: string): KaspKillEvent | null {
        const match = KILL_PATTERN.exec(text);
        if (match === null) return null;
        const player = (first: number): KaspKillPlayer => ({
            userId: match[first],
            uid: match[first + 1],
            clanTag: match[first + 2] === 'null' ? null : match[first + 2],
            teamRelation: match[first + 3],
        });
        return { killer: player(1), victim: player(5), damageType: match[9], critical: match[10] === 'true', kind: match[11] };
    }

    let warnedKill = false;

    // Called from inside the game's code, so it must never throw into it.
    window.__kaspSendKill = function (_className: string, obj: unknown): void {
        try {
            const text = String(obj);
            const detail = parseKillText(text);
            if (detail === null) {
                if (!warnedKill) {
                    warnedKill = true;
                    warn(`${LOG} a kill event was not understood, its sound is skipped: ${text.slice(0, 300)}`);
                }
                return;
            }
            const message: KaspKillMessage = { type: 'kasp:kill', detail };
            window.postMessage(message, window.location.origin);
        } catch {
            // a missed event only means one missed sound
        }
    };

    // BattleStatistics holds the time left of the battle (remainingTimeInSec), whether the battle is running
    // (roundStarted) and whether it is loaded (battleLoaded). Its fields are minified, but its toString names them
    // ("remainingTimeInSec=" + this.eq2_1), so the source of toString is read once to learn which property holds which
    // value, and after that each copy is three plain property reads. The game makes a copy on every update of the
    // battle, so a message is posted only when one of the three values changed. The time left is sent once, when the
    // player joins, and then stays the same in every copy, so it is the receiver's job to count down from it.
    interface BattleTimeFields {
        readonly remaining: string;
        readonly started: string;
        readonly loaded: string;
    }

    const battleTimeFields = new WeakMap<object, BattleTimeFields | null>();
    let lastBattleTime = '';
    let warnedBattleTime = false;

    function battleTimeFieldsOf(obj: object): BattleTimeFields | null {
        const method = (obj as { toString?: unknown }).toString;
        if (typeof method !== 'function') return null;
        if (battleTimeFields.has(method)) return battleTimeFields.get(method) ?? null;
        const labels = new Map<string, string>();
        for (const match of Function.prototype.toString.call(method).matchAll(/\b([A-Za-z]+)=.{0,35}?this\.([\w$]+)/g)) {
            labels.set(match[1], match[2]);
        }
        const remaining = labels.get('remainingTimeInSec');
        const started = labels.get('roundStarted');
        const loaded = labels.get('battleLoaded');
        const fields = remaining !== undefined && started !== undefined && loaded !== undefined ? { remaining, started, loaded } : null;
        battleTimeFields.set(method, fields);
        return fields;
    }

    // Called from inside the game's code, so it must never throw into it.
    window.__kaspSendBattleTime = function (_className: string, obj: unknown): void {
        try {
            if (obj === null || typeof obj !== 'object') return;
            const fields = battleTimeFieldsOf(obj);
            if (fields === null) {
                if (!warnedBattleTime) {
                    warnedBattleTime = true;
                    warn(`${LOG} the battle time fields were not found in BattleStatistics, the battle music is skipped`);
                }
                return;
            }
            const remaining: unknown = Object.getOwnPropertyDescriptor(obj, fields.remaining)?.value;
            const roundStarted: unknown = Object.getOwnPropertyDescriptor(obj, fields.started)?.value;
            const battleLoaded: unknown = Object.getOwnPropertyDescriptor(obj, fields.loaded)?.value;
            if (typeof remaining !== 'number' || typeof roundStarted !== 'boolean' || typeof battleLoaded !== 'boolean') return;
            const key = `${remaining}|${roundStarted}|${battleLoaded}`;
            if (key === lastBattleTime) return;
            lastBattleTime = key;
            const message: KaspBattleTimeMessage = { type: 'kasp:battle-time', detail: { remaining, roundStarted, battleLoaded } };
            window.postMessage(message, window.location.origin);
        } catch {
            // a missed update only means the music may start late or not at all
        }
    };

    // Called from inside the game's code, so it must never throw into it. The argument is the reload time the event
    // carries, a number of SECONDS (25 at the owner's grenade level, 15.496 for the time left); it is posted in milliseconds,
    // 0 when it cannot be read.
    window.__kaspSendGrenadeThrow = function (reload?: unknown): void {
        try {
            const seconds = Number(String(reload));
            const reloadMs = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0;
            const message: KaspGrenadeThrowMessage = { type: 'kasp:grenade-throw', reloadMs };
            window.postMessage(message, window.location.origin);
        } catch {
            // a missed throw only means one missed sound
        }
    };

    // The game builds a GarageItem for each item of the garage (a turret, a hull, a paint) when the garage is first opened
    // (not at load) and again whenever one changes, and each carries its name, its category and whether it is mounted. A mounted
    // turret is announced once (and again only when it is another turret), so a receiver learns the player's turret at load
    // and at every change in the garage. The property names are the game's own, found by the patch (patchGarageItem) and passed in.
    let mountedTurretId = '';
    // The last announcement, said again whenever a receiver asks (kasp:mounted-request), because the game builds its items at
    // load and may do it before the receiver is listening.
    let announcedTurret: KaspMountedMessage | null = null;

    onMessage('kasp:mounted-request', () => {
        if (announcedTurret !== null) window.postMessage(announcedTurret, window.location.origin);
    });

    // Called from inside the game's code, so it must never throw into it.
    window.__kaspSendGarageItem = function (obj: unknown, idProp: string, nameProp: string, categoryProp: string, mountedProp: string): void {
        try {
            const item = obj as Record<string, unknown>;
            if (item[mountedProp] !== true || String(item[categoryProp]) !== 'WEAPON') return;
            announceMounted(String(item[nameProp]), String(item[idProp]));
        } catch {
            // a missed announcement only means the lock sounds stay as they were
        }
    };

    // A mounted turret is announced once, and again only when it is another turret.
    function announceMounted(name: string, id: string, baseId?: string): void {
        if (mountedTurretId === id) return;
        mountedTurretId = id;
        const message: KaspMountedMessage = baseId === undefined ? { type: 'kasp:mounted', name, id } : { type: 'kasp:mounted', name, id, baseId };
        announcedTurret = message;
        window.postMessage(message, window.location.origin);
    }

    // The player's own user id, from the game's SetUserId at load (the constructor of that class holds a function, so patchUserId
    // adds the call at the end of it).
    let ownUserId = '';

    // Called from inside the game's code, so it must never throw into it.
    window.__kaspSendUserId = function (obj: unknown, idProp: string): void {
        try {
            const value = (obj as Record<string, unknown>)[idProp];
            ownUserId = value === null || value === undefined ? '' : String(value);
        } catch {
            // without the id the battle's tank list cannot be read, and the garage still says the turret
        }
    };

    // When the player enters a battle the game says, for every tank in it, what is mounted on it, in the text
    // SetTankInfo(user=3074457415728181208, info=TankInfoCC [hullBaseId = 921009707333 hullDeviceId = 1931010007813
    // hullId = 921009707339 weaponBaseId = 920009631151 weaponDeviceId = 1931009801096 weaponId = 920009631157 ]).
    // The text is read, not the object, so a renamed minified property cannot swap the fields. Only the player's own tank is used,
    // and its turret ids are announced: the same ids the garage's item carries for the same turret.
    const TANK_INFO = /^SetTankInfo\(user=(-?\d+), info=TankInfoCC \[hullBaseId = \d+ hullDeviceId = \S+ hullId = \d+ weaponBaseId = (\d+) weaponDeviceId = \S+ weaponId = (\d+) \]\)$/;
    let warnedTankInfo = false;

    // Called from inside the game's code, so it must never throw into it.
    window.__kaspSendTankInfo = function (_className: string, obj: unknown): void {
        try {
            const text = String(obj);
            const match = TANK_INFO.exec(text);
            if (match === null) {
                if (!warnedTankInfo) {
                    warnedTankInfo = true;
                    warn(`${LOG} a tank info was not understood, the turret is not read from the battle: ${text.slice(0, 300)}`);
                }
                return;
            }
            if (ownUserId === '' || match[1] !== ownUserId) return;
            announceMounted('', match[3], match[2]);
        } catch {
            // a missed announcement only means the lock sounds stay as they were
        }
    };

    // Replacing a weapon's sound. The game loads each weapon sound from an address like
    // /0/16723/73/217/31345722114416/sound.mp3 (four numbers that name the resource, then a version number) and decodes
    // the file with decodeAudioData. The address of each loaded file is remembered by the data object the loader produced
    // (the same object reaches decodeAudioData), and when the address holds a resource number from the list that
    // weapon_sounds.ts sent, the game decodes the owner's file for that number (each file has its own numbers, so each
    // distance of a shot can have its own sound), instead. The game still plays the result where it
    // always played the sound. Until the list and the files arrive (kasp:sound-swap) nothing is touched.
    const SOUND_FILE = /\/sound\.(?:mp3|wav|ogg)(?:\?|$)/;
    const RESOURCE_NUMBER = /^\d+(?:\/\d+){1,5}$/;
    const MAX_SWAP_BYTES = 2 * 1024 * 1024;
    const MAX_SWAP_FILES = 10;
    const MAX_SWAP_NUMBERS = 50;

    interface SoundReplacement {
        readonly data: ArrayBuffer;
        readonly numbers: readonly string[];
    }

    interface SoundSwap {
        readonly replacements: readonly SoundReplacement[];
    }

    let soundSwap: SoundSwap | null = null;
    let warnedSwap = false;

    function isNumberList(value: unknown): value is string[] {
        return (
            Array.isArray(value) &&
            value.length <= MAX_SWAP_NUMBERS &&
            value.every((item) => typeof item === 'string' && RESOURCE_NUMBER.test(item))
        );
    }

    function readReplacement(value: unknown): SoundReplacement | null {
        if (!value || typeof value !== 'object') return null;
        const { data, numbers } = value as Partial<Record<'data' | 'numbers', unknown>>;
        if (!(data instanceof ArrayBuffer) || data.byteLength === 0 || data.byteLength > MAX_SWAP_BYTES) return null;
        if (!isNumberList(numbers) || numbers.length === 0) return null;
        return { data, numbers };
    }

    // The swap in a message, or null when it is not a valid one: a bad file or number list makes the whole message
    // invalid, so the game's sounds are never half replaced by a message that was not understood. The game's own scripts
    // share this window, so every field is checked.
    function readSwapMessage(data: unknown): SoundSwap | null {
        if (!data || typeof data !== 'object' || (data as { type?: unknown }).type !== 'kasp:sound-swap') return null;
        const { replacements } = data as { replacements?: unknown };
        if (!Array.isArray(replacements) || replacements.length > MAX_SWAP_FILES) return null;
        const read = replacements.map(readReplacement);
        const valid = read.filter((item): item is SoundReplacement => item !== null);
        if (valid.length !== read.length || valid.length === 0) return null;
        return { replacements: valid };
    }

    // What decodeAudioData should be given instead of the game's data for this address, or null to leave it alone.
    function swappedData(address: string | undefined): ArrayBuffer | null {
        if (soundSwap === null || address === undefined) return null;
        // the first file that lists a matching number wins, and each decode gets its own copy
        for (const replacement of soundSwap.replacements) {
            if (replacement.numbers.some((number) => address.includes(`/${number}/`))) return replacement.data.slice(0);
        }
        return null;
    }

    // Sounds that depend on the mounted turret. The lock sounds are shared by several turrets (the Gauss and the Striker use the
    // same three files), and the game loads and decodes them before it says which turret the player has, so they cannot be
    // swapped as the game decodes them. Instead, the audio buffer the game made from such a file is rewritten in place (the game
    // plays the same buffer every time) with the owner's sound while the mounted turret is the one the sound is for, and the
    // buffer's own samples are put back for any other turret. weapon_sounds.ts sends the files (kasp:late-sounds) and the turret
    // it made out of the game's announcement (kasp:turret).
    interface LateGroup {
        readonly turret: string;
        readonly data: ArrayBuffer;
        readonly numbers: readonly string[];
    }

    const NUMBERS_OF_ADDRESS = /\/(\d+(?:\/\d+){3})\/\d+\/sound\.(?:mp3|wav|ogg)(?:\?|$)/;
    const TURRET_NAME = /^[a-z][a-z0-9-]*$/;
    let lateGroups: readonly LateGroup[] = [];
    let activeTurret = '';
    let warnedLate = false;
    let decodeWithoutSwap: ((this: BaseAudioContext, data: ArrayBuffer) => Promise<AudioBuffer>) | null = null;
    // the game's own buffers, by the numbers of the sound file they were decoded from
    const decodedByNumbers = new Map<string, WeakRef<AudioBuffer>>();
    const ownSamples = new WeakMap<AudioBuffer, Array<Float32Array<ArrayBuffer>>>();
    const appliedGroup = new WeakMap<AudioBuffer, LateGroup>();
    const lateDecoded = new Map<string, Promise<AudioBuffer>>();
    let applying: Promise<void> = Promise.resolve();

    function readLateMessage(data: unknown): LateGroup[] | null {
        if (!data || typeof data !== 'object' || (data as { type?: unknown }).type !== 'kasp:late-sounds') return null;
        const { groups } = data as { groups?: unknown };
        if (!Array.isArray(groups) || groups.length === 0 || groups.length > MAX_SWAP_FILES) return null;
        const read: LateGroup[] = [];
        for (const value of groups) {
            if (!value || typeof value !== 'object') return null;
            const { turret, data: bytes, numbers } = value as Partial<Record<'turret' | 'data' | 'numbers', unknown>>;
            if (typeof turret !== 'string' || !TURRET_NAME.test(turret)) return null;
            if (!(bytes instanceof ArrayBuffer) || bytes.byteLength === 0 || bytes.byteLength > MAX_SWAP_BYTES) return null;
            if (!isNumberList(numbers) || numbers.length === 0) return null;
            read.push({ turret, data: bytes, numbers });
        }
        return read;
    }

    function scheduleApply(): void {
        applying = applying.then(applyLateSounds).catch((e: unknown) => {
            if (!warnedLate) {
                warnedLate = true;
                warn(`${LOG} the lock sounds could not be changed, the game's own stay:`, e instanceof Error ? e.message : e);
            }
        });
    }

    // Called for every sound the game decodes; only the ones some turret has its own sound for are of interest.
    function rememberDecoded(address: string, buffer: AudioBuffer): void {
        const match = NUMBERS_OF_ADDRESS.exec(address);
        if (match === null) return;
        decodedByNumbers.set(match[1], new WeakRef(buffer));
        if (lateGroups.some((group) => group.numbers.includes(match[1]))) scheduleApply();
    }

    // The owner's file decoded at the buffer's sample rate, so the samples can be copied as they are.
    function replacementFor(group: LateGroup, rate: number, channels: number): Promise<AudioBuffer> {
        const key = `${lateGroups.indexOf(group)}@${rate}`;
        let loading = lateDecoded.get(key);
        if (loading === undefined) {
            if (decodeWithoutSwap === null) return Promise.reject(new Error('the page has no audio decoder to use'));
            loading = decodeWithoutSwap.call(new OfflineAudioContext(channels, 1, rate), group.data.slice(0));
            lateDecoded.set(key, loading);
        }
        return loading;
    }

    async function applyLateSounds(): Promise<void> {
        for (const [numbers, reference] of decodedByNumbers) {
            const buffer = reference.deref();
            if (buffer === undefined) {
                decodedByNumbers.delete(numbers);
                continue;
            }
            const groups = lateGroups.filter((group) => group.numbers.includes(numbers));
            if (groups.length === 0) continue;
            const wanted = groups.find((group) => group.turret === activeTurret);
            if (wanted === appliedGroup.get(buffer)) continue;
            const channels = buffer.numberOfChannels;
            if (wanted === undefined) {
                const own = ownSamples.get(buffer);
                if (own !== undefined) for (let channel = 0; channel < channels; channel++) buffer.copyToChannel(own[channel], channel);
                appliedGroup.delete(buffer);
                continue;
            }
            if (!ownSamples.has(buffer)) {
                ownSamples.set(buffer, Array.from({ length: channels }, (_unused, channel) => buffer.getChannelData(channel).slice()));
            }
            const replacement = await replacementFor(wanted, buffer.sampleRate, channels);
            for (let channel = 0; channel < channels; channel++) {
                const source = replacement.getChannelData(Math.min(channel, replacement.numberOfChannels - 1));
                const samples = new Float32Array(buffer.length);
                samples.set(source.subarray(0, buffer.length));
                buffer.copyToChannel(samples, channel);
            }
            appliedGroup.set(buffer, wanted);
        }
    }

    function installSoundSwap(): void {
        const addressOfData = new WeakMap<object, string>();

        onMessage('kasp:sound-swap', (data) => {
            const next = readSwapMessage(data);
            if (next !== null) {
                soundSwap = next;
            } else if (!warnedSwap) {
                warnedSwap = true;
                warn(`${LOG} a sound swap message was not understood, the game's own sounds stay`);
            }
        });

        onMessage('kasp:late-sounds', (data) => {
            const groups = readLateMessage(data);
            if (groups !== null) {
                lateGroups = groups;
                lateDecoded.clear();
                scheduleApply();
            } else if (!warnedLate) {
                warnedLate = true;
                warn(`${LOG} a turret sound message was not understood, the game's own lock sounds stay`);
            }
        });
        onMessage('kasp:turret', (data) => {
            const turret = data['turret'];
            if (typeof turret === 'string' && (turret === '' || TURRET_NAME.test(turret))) {
                activeTurret = turret;
                scheduleApply();
            }
        });

        if (typeof XMLHttpRequest !== 'undefined') {
            const originalOpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]): unknown {
                try {
                    const address = String(args[1]);
                    if (SOUND_FILE.test(address)) {
                        this.addEventListener('load', () => {
                            try {
                                const response: unknown = this.response;
                                if (response instanceof ArrayBuffer) addressOfData.set(response, address);
                            } catch {
                                // the swap must never break the game's loading
                            }
                        });
                    }
                } catch {
                    // the swap must never break the game's loading
                }
                return Reflect.apply(originalOpen, this, args);
            } as unknown as typeof XMLHttpRequest.prototype.open;
        }

        if (typeof Response !== 'undefined') {
            const originalArrayBuffer = Response.prototype.arrayBuffer;
            Response.prototype.arrayBuffer = function (this: Response): Promise<ArrayBuffer> {
                const address = this.url;
                const result = originalArrayBuffer.call(this);
                if (SOUND_FILE.test(address)) {
                    result.then((data) => addressOfData.set(data, address), () => undefined);
                }
                return result;
            };
        }

        if (typeof BaseAudioContext !== 'undefined') {
            const originalDecode = BaseAudioContext.prototype.decodeAudioData;
            decodeWithoutSwap = originalDecode as unknown as typeof decodeWithoutSwap;
            BaseAudioContext.prototype.decodeAudioData = function (
                this: BaseAudioContext,
                data: ArrayBuffer,
                success?: DecodeSuccessCallback | null,
                failure?: DecodeErrorCallback | null,
            ): Promise<AudioBuffer> {
                let source = data;
                try {
                    source = swappedData(addressOfData.get(data)) ?? data;
                } catch {
                    source = data;
                }
                const result = originalDecode.call(this, source, success, failure);
                try {
                    const address = addressOfData.get(data);
                    if (address !== undefined && result && typeof result.then === 'function') {
                        result.then((buffer) => rememberDecoded(address, buffer), () => undefined);
                    }
                } catch {
                    // the turret sounds must never break the game's decoding
                }
                return result;
            };
        }
    }

    try {
        installSoundSwap();
    } catch (e: unknown) {
        warn(`${LOG} the sound swap could not start, the game's own sounds stay:`, e instanceof Error ? e.message : e);
    }

    interface Hook {
        readonly className: string;
        // The window function the game's constructor calls, and the name the log uses for it.
        readonly call: '__kaspSendAction' | '__kaspSendKill' | '__kaspSendBattleTime' | '__kaspSendTankInfo';
        readonly label: string;
    }

    const HOOKS: readonly Hook[] = [
        { className: 'TankUserActionLog', call: '__kaspSendAction', label: 'change-counter' },
        { className: 'TankDestroyActionLog', call: '__kaspSendKill', label: 'kill-sounds' },
        { className: 'BattleStatistics', call: '__kaspSendBattleTime', label: 'battle-music' },
        { className: 'SetTankInfo', call: '__kaspSendTankInfo', label: 'tank-info' },
    ];

    // The code with the hook added to the class's constructor, or null when the bundle no longer looks the way the two
    // patterns expect. The first pattern finds the name of the property the game prints first in the class's text, which
    // names the constructor's first field; the second finds the constructor that assigns it.
    function patchClass(code: string, hook: Hook): string | null {
        const property = new RegExp(`return"${hook.className}\\(\\w+="\\+(?:[\\w$]+\\()?this\\.(\\w+)`).exec(code);
        if (property === null) {
            warn(`${LOG} could not find the ${hook.className} property name in this bundle, ${hook.label} hook skipped`);
            return null;
        }
        const propName = property[1];
        const constructorPattern = new RegExp(`(function [\\w$]+\\([^)]{1,150}\\)\\{[^{}]{0,800}?this\\.${propName}=[\\w$]+(?:,this\\.[\\w$]+=[\\w$]+){0,30})\\}`);
        const patched = code.replace(constructorPattern, `$1, window.${hook.call}("${hook.className}", this)}`);
        if (patched === code) {
            warn(`${LOG} could not find the ${hook.className} constructor for property "${propName}", ${hook.label} hook skipped`);
            return null;
        }
        return patched;
    }

    // The game keeps a cooldown for each of the player's own supplies, and one handler of that system runs when the
    // player's grenade starts its reload (the reload event carries the full reload time, above zero only after a throw;
    // dying or joining sends none, and other players' tanks have no such handler). The event also comes again, with the
    // time that is left, when the game adds the grenade to the battle again during a reload, so the receiver must tell
    // a throw from a repeat (grenade_sounds.ts does, by the time the event carries). The handler has no readable name,
    // but it sits just before the readable text of the data class ResetCooldownHudMessage, so the last handler of this
    // shape inside the 4000 characters before that text is the one:
    //   return Ex(n.j15g_1,Cx(0))>0&&ext(t,tR(),n.j15g_1),Lq
    // and the call in front of its last part becomes (window.__kaspSendGrenadeThrow(n.j15g_1),ext(t,tR(),n.j15g_1)).
    const COOLDOWN_ANCHOR = 'return"ResetCooldownHudMessage(supplyType=';
    const COOLDOWN_RANGE = 4000;
    const RELOAD_HANDLER = /return [\w$]+\(([\w$]+)\.([\w$]+),[\w$]+\(0\)\)>0&&([\w$]+\([\w$]+,[\w$]+\(\),\1\.\2\))/g;

    function patchGrenadeThrow(code: string): string | null {
        const anchor = code.indexOf(COOLDOWN_ANCHOR);
        if (anchor < 0) {
            warn(`${LOG} could not find the supply cooldown in this bundle, grenade-sounds hook skipped`);
            return null;
        }
        const start = Math.max(0, anchor - COOLDOWN_RANGE);
        const matches = [...code.slice(start, anchor).matchAll(RELOAD_HANDLER)];
        const last = matches[matches.length - 1];
        if (last === undefined) {
            warn(`${LOG} could not find the grenade reload handler in this bundle, grenade-sounds hook skipped`);
            return null;
        }
        const [whole, object, field, call] = last;
        const callAt = start + last.index + whole.length - call.length;
        return `${code.slice(0, callAt)}(window.__kaspSendGrenadeThrow(${object}.${field}),${call})${code.slice(callAt + call.length)}`;
    }

    // The game's GarageItem has about fifty fields and its constructor assigns them in one flat list, which is too long for
    // patchClass. The text the game builds for it names the property that holds each field (id=, name=, category=,
    // mounted=), and the call goes right after the mounted assignment, when the first twelve fields are set:
    //   this.bra_1=t,this.cra_1=n, ... ,this.mra_1=c   ->   ..., this.mra_1=c,window.__kaspSendGarageItem(this,"bra_1",...)
    const GARAGE_ITEM_TEXT = /return"GarageItem\(id="\+(?:[\w$]+\()?this\.([\w$]+)[^]{0,60}?", name="\+(?:[\w$]+\()?this\.([\w$]+)[^]{0,60}?", category="\+(?:[\w$]+\()?this\.([\w$]+)[^]{0,1200}?", mounted="\+(?:[\w$]+\()?this\.([\w$]+)/;

    function patchGarageItem(code: string): string | null {
        const text = GARAGE_ITEM_TEXT.exec(code);
        if (text === null) {
            warn(`${LOG} could not find the garage item's fields in this bundle, mounted-turret hook skipped`);
            return null;
        }
        const [, id, name, category, mounted] = text;
        const assignments = new RegExp(`(this\\.${id}=[\\w$]+(?:,this\\.[\\w$]+=[\\w$]+){0,30}?,this\\.${mounted}=[\\w$]+)`, 'g');
        const found = code.match(assignments);
        if (found === null || found.length !== 1) {
            warn(`${LOG} could not find the garage item constructor in this bundle, mounted-turret hook skipped`);
            return null;
        }
        const call = `window.__kaspSendGarageItem(this,"${id}","${name}","${category}","${mounted}")`;
        return code.replace(assignments, (whole) => `${whole},${call}`);
    }

    // SetUserId's constructor holds a function, which patchClass cannot step over, so the call goes at the end of it:
    //   this.etd_1=t}   ->   this.etd_1=t,window.__kaspSendUserId(this,"etd_1")}
    function patchUserId(code: string): string | null {
        const text = /return"SetUserId\(userId="\+[\w$]*\(?this\.([\w$]+)/.exec(code);
        if (text === null) {
            warn(`${LOG} could not find the user id class in this bundle, the battle's turret hook and the chat translation are skipped`);
            return null;
        }
        const property = text[1];
        const tail = new RegExp(`this\\.${property}=([\\w$]+)\\}`, 'g');
        const found = code.match(tail);
        if (found === null || found.length !== 1) {
            warn(`${LOG} could not find the user id constructor in this bundle, the battle's turret hook and the chat translation are skipped`);
            return null;
        }
        return code.replace(tail, (_whole, value: string) => `this.${property}=${value},window.__kaspSendUserId(this,"${property}")}`);
    }

    // The extension's own tab in the game's settings screen (build-plan 17, see blueprint/context/settings-tab.md). The game
    // builds that screen from three fixed tables: the list of tabs, the place of the yellow bar for each tab, and the panel for
    // each tab. Four edits put our tab in all three, so the game draws it, selects it, slides its own bar to it and remembers it
    // like its own tabs; for our tab it draws an empty panel box, which settings_tab.ts fills. All four or none: when one place
    // is not found, the game keeps its own tabs. The places are found by their shape, as in this build (names change per build):
    //   tabs:  JS([new aMi(RNi().o1s3(),AQ()), ...])          the entry class is the one whose text is "MenuItem(key=..., category=..."
    //   name:  _.fap(t.yat(i.q1s6_1))                         the tab's text, from its name key
    //   bar:   Z$(a,function(t,n,i){switch(n.k3_1){case 3:return Zq(i); ... default:return Zq(-1e3)}}(0,<open tab>,e))
    //   panel: switch(...k3_1){case 3:default:o=Ny(AAi);break; ... case 8:o=Ny(nOi)} ... c.kap(o,JPi)
    const SETTINGS_TAB_LABEL = 'Twizzy extension';
    // A number none of the game's tabs has (the game's own are 0 to 8).
    const SETTINGS_TAB_NUMBER = 99;
    const SETTINGS_TAB_ANCHOR = 'CONTROL';
    const SETTINGS_ITEM_TEXT = /\(([\w$]+)\)\.toString=function\(\)\{return"MenuItem\(key="\+[\w$]*\(?this\.([\w$]+)\)?\+", category="\+this\.([\w$]+)\.toString\(\)/g;
    const SETTINGS_BAR = /function\(([\w$]+),([\w$]+),([\w$]+)\)\{switch\(\2\.([\w$]+)\)\{(?:case \d:return ([\w$]+)\(\3(?:\+\d+\|0)?\);)+default:return \5\(-1e3\)\}\}\(0,([\w$.]+),[\w$]+\)/g;
    // The loop that draws the tabs, a little before the bar: for(var o=r.t();o.u();)cMi(this,s,o.v())
    const SETTINGS_LOOP = /for\(var ([\w$]+)=([\w$]+)\.([\w$]+)\(\);\1\.([\w$]+)\(\);\)[\w$]+\(this,[\w$]+,\1\.([\w$]+)\(\)\)/g;
    const SETTINGS_LOOP_RANGE = 1500;
    let settingsTabWarned = false;

    function exactlyOne(code: string, pattern: RegExp): RegExpExecArray | null {
        const found = [...code.matchAll(pattern)];
        return found.length === 1 ? found[0] : null;
    }

    // A name read from the game's script (letters, digits, _ and $), made safe to search with: a bare $ in a pattern means
    // "end of text", so a name like Z$ would find nothing. Every name the settings-tab hook puts in a pattern goes through here.
    function asPattern(name: string): string {
        return name.replace(/\$/g, '\\$');
    }

    // One change to the game's script: the text at `at`, `length` characters long, becomes `text`.
    interface Edit {
        readonly at: number;
        readonly length: number;
        readonly text: string;
    }

    // Applies the edits from the last place in the code to the first, so each index stays right.
    function applyEdits(code: string, edits: readonly Edit[]): string {
        let result = code;
        for (const edit of [...edits].sort((a, b) => b.at - a.at)) {
            result = result.slice(0, edit.at) + edit.text + result.slice(edit.at + edit.length);
        }
        return result;
    }

    // What the patched list calls: puts our tab right after CONTROLS (or last, when CONTROLS is not in the list). Our entry is
    // made by the game's own entry class, with CONTROLS' name key, which our tab never shows (it has its own text).
    function addSettingsTab(items: unknown[], make: (key: unknown) => unknown, keyField: string, categoryField: string): unknown[] {
        try {
            const at = items.findIndex((item) => isObject(item) && String(item[categoryField]) === SETTINGS_TAB_ANCHOR);
            const anchor = items[at < 0 ? items.length - 1 : at];
            if (!isObject(anchor)) return items;
            if (at < 0 && !settingsTabWarned) {
                settingsTabWarned = true;
                warn(`${LOG} no ${SETTINGS_TAB_ANCHOR} tab in the settings list, the extension's tab goes last`);
            }
            items.splice(at < 0 ? items.length : at + 1, 0, make(anchor[keyField]));
        } catch (e: unknown) {
            warn(`${LOG} could not add the extension's settings tab:`, e instanceof Error ? e.message : e);
        }
        return items;
    }

    function patchSettingsTab(code: string): string | null {
        const skip = (what: string): null => {
            warn(`${LOG} could not find the settings ${what} in this bundle, settings-tab hook skipped`);
            return null;
        };
        const item = exactlyOne(code, SETTINGS_ITEM_TEXT);
        if (item === null) return skip('tab entry');
        const [, itemClass, keyField, categoryField] = item;

        const list = exactlyOne(code, new RegExp(`\\(\\[new ${asPattern(itemClass)}\\([^\\[\\]]*?\\)(?:,new ${asPattern(itemClass)}\\([^\\[\\]]*?\\))*\\]\\)`, 'g'));
        if (list === null) return skip('tab list');
        const name = exactlyOne(code, new RegExp(`([\\w$]+)\\.([\\w$]+)\\(([\\w$]+)\\.${asPattern(keyField)}\\)`, 'g'));
        if (name === null) return skip('tab name');
        const bar = exactlyOne(code, SETTINGS_BAR);
        if (bar === null) return skip('bar position');
        const [, , , , numberField, size, openTab] = bar;
        const loop = exactlyOne(code.slice(Math.max(0, bar.index - SETTINGS_LOOP_RANGE), bar.index), SETTINGS_LOOP);
        if (loop === null) return skip('tab loop');
        const [, , listVar, iterate, hasNext, next] = loop;
        const count = new RegExp(`8===${asPattern(listVar)}\\.([\\w$]+)\\(\\)\\?-15:-10`).exec(code.slice(Math.max(0, bar.index - SETTINGS_LOOP_RANGE), bar.index));
        if (count === null) return skip('tab count');
        const panel = exactlyOne(code, new RegExp(`\\.${asPattern(numberField)}\\)\\{(case 3:default:([\\w$]+)=([\\w$]+)\\([\\w$]+\\);break;(?:case \\d:\\2=\\3\\([\\w$]+\\);break;)*case \\d:\\2=\\3\\([\\w$]+\\)\\})`, 'g'));
        if (panel === null) return skip('panel choice');
        const panelVar = panel[2];
        const panelEnd = panel.index + panel[0].length;
        const draw = new RegExp(`([\\w$]+)\\.([\\w$]+)\\(${asPattern(panelVar)},([\\w$]+)\\)`).exec(code.slice(panelEnd, panelEnd + 200));
        if (draw === null) return skip('panel drawing');

        // Our tab's category: what the game keeps as the open tab. The game compares categories as the same object, reads their
        // number, and calls these three on them.
        const category: Record<string, unknown> = {
            [numberField]: SETTINGS_TAB_NUMBER,
            equals(other: unknown) { return this === other; },
            hashCode() { return SETTINGS_TAB_NUMBER; },
            toString() { return 'TWIZZY'; },
        };
        window.__kaspSettingsTab = category;
        window.__kaspSettingsTabAdd = addSettingsTab;

        const ours = 'window.__kaspSettingsTab';
        return applyEdits(code, [
            {
                at: list.index,
                length: list[0].length,
                text: `((window.__kaspSettingsTabAdd||function(a){return a})(${list[0].slice(1, -1)},function(k){return new ${itemClass}(k,${ours})},"${keyField}","${categoryField}"))`,
            },
            {
                at: name.index,
                length: name[0].length,
                text: `(${name[3]}.${categoryField}===${ours}?"${SETTINGS_TAB_LABEL}":${name[0]})`,
            },
            {
                at: bar.index,
                length: bar[0].length,
                text: `function(c){for(var k=0,w=${listVar}.${iterate}();w.${hasNext}();k=k+1|0)if(w.${next}().${categoryField}===c)return ${size}(5*(k-${listVar}.${count[1]}()+5));return ${size}(-1e3)}(${openTab})`,
            },
            {
                at: panel.index + numberField.length + 3,
                length: 0,
                text: `case ${SETTINGS_TAB_NUMBER}:${panelVar}=null;break;`,
            },
            {
                at: panelEnd + draw.index,
                length: draw[0].length,
                text: `null!=${panelVar}&&${draw[0]}`,
            },
        ]);
    }

    // Shared by the battle tab hooks below. Each element of the game's tables is made by a small function that builds one
    // element class with no attributes, and the game gives an element its attributes with one helper, as it does for the alt
    // text of the rank picture. A hook that puts our own attributes on an element swaps the game's maker for a function that
    // builds the same class with that helper. As in this build (names change per build):
    //   made:        function Dk(t){return new ki(Xn(),t)}
    //   attributes:  new Ch(Vn(["alt",null,"src",n]),...)
    const ATTRIBUTE_LIST = /new [\w$]+\(([\w$]+)\(\["alt",/g;
    const GAME_MODULE_RANGE = 20000;
    // The attribute helper is found from the nearest pictures with an alt text, which in this build sit up to 22000
    // characters from the count's icon; every one of them in reach must use the same helper.
    const GAME_ATTRIBUTE_RANGE = 30000;

    function elementMaker(factory: string): RegExp {
        return new RegExp(`function ${asPattern(factory)}\\(([\\w$]+)\\)\\{return new ([\\w$]+)\\([\\w$]+\\(\\),\\1\\)\\}`, 'g');
    }

    function around(code: string, at: number, range: number): string {
        return code.slice(Math.max(0, at - range), at + range);
    }

    // The one name the pattern's first group finds in the text, or null when it finds none or more than one.
    function onlyName(text: string, pattern: RegExp): string | null {
        const names = new Set([...text.matchAll(pattern)].map((found) => found[1]));
        const [name] = names;
        return names.size === 1 && name !== undefined ? name : null;
    }

    // The class the game's maker `factory` builds, when exactly one such maker is in reach of the place.
    function elementClassNear(code: string, at: number, factory: string): string | null {
        const made = [...around(code, at, GAME_MODULE_RANGE).matchAll(elementMaker(factory))];
        return made.length === 1 ? made[0][2] ?? null : null;
    }

    function attributeHelperNear(code: string, at: number): string | null {
        return onlyName(around(code, at, GAME_ATTRIBUTE_RANGE), ATTRIBUTE_LIST);
    }

    // The code that replaces the game's maker: the same element class, with our attributes (a list of name, value pairs).
    function makerWithAttributes(element: string, attributes: string, list: string): string {
        return `function(kaspChild){return new ${element}(${attributes}([${list}]),kaspChild)}`;
    }

    // The change column of the battle tab (build-plan 18a, see blueprint/context/battle-stats-table.md). The game builds each team
    // table from a list of header cells, and draws each player row with one function that adds the row's cells in order, the
    // kills/deaths cell last. Two edits make the game draw one more column itself: a header after the skull, drawn by the game's
    // own header icon method with our picture, and one more cell after kills/deaths that carries the player's nickname, which
    // change_counter.ts marks. Both or none: when one place is not found, the game keeps its own table. The places are found by
    // their shape, as in this build (names change per build):
    //   headers:  r.columns=function(t,n){... return ku([r,e,u,s,o,new $_(ni,ni,mm(t))])}(t,n),r.keys=i,r.elementClass=Ln(Jk)
    //   header:   function(t){return function(n){return t.j1u9(n,v),On}}(t)
    //   row end:  var S=Xk,C=Nn.nut(S);C.juv().zp7(zk().y1u9()); ... T.tao(t.props.itemKey.h1u8_1+"/"+...),C.sao(T.s9k()),n.sao(C.s9k())}
    //   cell:     function Xk(t){return new Ch(Xn(),t)}, with attributes given the way the rank picture's are: Vn(["alt",null,"src",n])
    //   nickname: the row data's text, "UserBattleStatistic(userId="+... +", uid="+this.a1u8_1
    const BATTLE_TAB_CELL_ATTRIBUTE = 'data-kasp-change';
    const BATTLE_TAB_HEADERS = /\.columns=function\(([\w$]+),[\w$]+\)\{([^]{0,2000}?)return ([\w$]+)\(\[([^[\]]{1,300})\]\)\}\([\w$]+,[\w$]+\),[\w$]+\.keys=[\w$]+,[\w$]+\.elementClass=/g;
    const BATTLE_TAB_HEADER_ICON = /function\(([\w$]+)\)\{return function\(([\w$]+)\)\{return \1\.([\w$]+)\(\2,[\w$]+\),([\w$]+)\}\}\(\1\)/;
    const BATTLE_TAB_LAST_HEADER = /new ([\w$]+)\(([\w$]+),\2,[\w$]+\([\w$]+\)\)$/;
    const BATTLE_TAB_ROW_END = /([\w$]+)\.([\w$]+)\(([\w$]+)\.props\.itemKey\.[\w$]+\+"\/"\+\3\.props\.itemKey\.[\w$]+\),([\w$]+)\.([\w$]+)\(\1\.([\w$]+)\(\)\),([\w$]+)\.\5\(\4\.\6\(\)\)\}/g;
    const BATTLE_TAB_NICKNAME = /"UserBattleStatistic\(userId="[^]{0,200}?", uid="\+(?:[\w$]+\()?this\.([\w$]+)/g;
    const BATTLE_TAB_CELL_RANGE = 800;
    const BATTLE_TAB_FACTORY_RANGE = 3000;
    const BATTLE_TAB_ROW_RANGE = 10000;

    function patchBattleTab(code: string): string | null {
        const skip = (what: string): null => {
            warn(`${LOG} could not find the battle tab ${what} in this bundle, battle-tab hook skipped`);
            return null;
        };
        const headers = exactlyOne(code, BATTLE_TAB_HEADERS);
        if (headers === null) return skip('header list');
        const [, table, body, , list] = headers;
        const icon = BATTLE_TAB_HEADER_ICON.exec(body);
        if (icon === null) return skip('header icon');
        const [, , , iconMethod, unit] = icon;
        const last = BATTLE_TAB_LAST_HEADER.exec(list);
        if (last === null) return skip('last header');
        const [, columnClass, absent] = last;

        const row = exactlyOne(code, BATTLE_TAB_ROW_END);
        if (row === null) return skip('row end');
        const [, , , component, cell, append, build, rowBuilder] = row;
        const cellCode = new RegExp(`var ([\\w$]+)=([\\w$]+),${asPattern(cell)}=([\\w$]+)\\.([\\w$]+)\\(\\1\\);${asPattern(cell)}\\.([\\w$]+)\\(\\)\\.([\\w$]+)\\(([\\w$]+)\\(\\)\\.([\\w$]+)\\(\\)\\)`)
            .exec(code.slice(Math.max(0, row.index - BATTLE_TAB_CELL_RANGE), row.index));
        if (cellCode === null) return skip('kills/deaths cell');
        const [, , factory, builder, make, css, addStyle, styles, style] = cellCode;
        const element = elementMaker(factory).exec(code.slice(row.index, row.index + BATTLE_TAB_FACTORY_RANGE));
        if (element === null) return skip('cell element');
        const attributeLists = [...code.slice(Math.max(0, row.index - BATTLE_TAB_ROW_RANGE), row.index).matchAll(ATTRIBUTE_LIST)];
        if (attributeLists.length !== 1) return skip('attribute list');
        const attributes = attributeLists[0][1];
        const nickname = exactlyOne(code, BATTLE_TAB_NICKNAME);
        if (nickname === null) return skip('nickname field');

        const listEnd = headers.index + headers[0].indexOf(`[${list}]`) + 1 + list.length;
        const header = `,new ${columnClass}(${absent},${absent},function(h){return ${table}.${iconMethod}(h,window.__kaspChangeHeader||""),${unit}})`;
        const rowEnd = row.index + row[0].length - 1;
        const maker = makerWithAttributes(element[2], attributes, `"${BATTLE_TAB_CELL_ATTRIBUTE}",String(${component}.props.itemKey.${nickname[1]})`);
        const kaspCell = `;var kaspCell=${builder}.${make}(${maker});`
            + `kaspCell.${css}().${addStyle}(${styles}().${style}());${rowBuilder}.${append}(kaspCell.${build}())`;
        return applyEdits(code, [{ at: listEnd, length: 0, text: header }, { at: rowEnd, length: 0, text: kaspCell }]);
    }

    // The protection colours of the battle tab (build-plan 18c, see blueprint/context/battle-stats-table.md). The game draws each
    // protection icon as a stencil of its turret's picture filled with one colour (red for the protection against the player's
    // own turret), in two places: a slot of a player row and an item of the count under the tables. The page cannot tell which
    // turret an icon is for, so the game is made to write it on the element that holds the icon: the type's own name
    // (RAILGUN_RESISTANCE...) in data-kasp-protection, and data-kasp-own="1" where it draws red; battle_tab.css does the rest.
    // Both or none. The places, as in this build (names change per build):
    //   icon:  ze(c,i.bl4_1.equals(t.props.itemKey.t1u8_1)&&!t.props.itemKey.v1u8_1?pi().k1i3_1:pi().g1hz_1),C_(c,"url("+S_.uuq(i.bl4_1)+")")
    //          ze(h,i.equals(t.pas_1.o1u5_1)?pi().k1i3_1:pi().g1hz_1),C_(h,"url("+S_.uuq(i)+")")
    //   slot:  function $k(t,n,i){var r=Dk,e=Nn.nut(r), ...   function em(t,n,i,r){var e=qm,u=Nn.nut(e), ...
    const PROTECTION_ICON = /([\w$]+)\(([\w$]+),([^?;{}]{1,200})\?[\w$]+\(\)\.[\w$]+:[\w$]+\(\)\.[\w$]+\),[\w$]+\(\2,"url\("\+([\w$]+)\.([\w$]+)\(([\w$.]+)\)\+"\)"\)/g;
    const PROTECTION_SLOT = /function [\w$]+\(([\w$,]*)\)\{var ([\w$]+)=([\w$]+),[\w$]+=([\w$]+)\.([\w$]+)\(\2\)/g;
    const PROTECTION_SLOT_RANGE = 1500;

    // The names of the row data's fields that tell an enemy, read from the text the game builds for it:
    // "UserBattleStatistic(userId="+... +", isLocalUser="+this.z1u7_1+ ... +", team="+this.i1u8_1.toString()+ ...
    interface RowFields {
        readonly isLocalUser: string;
        readonly team: string;
        readonly isTeamMode: string;
        readonly currentUserTeam: string;
    }

    function rowFieldsOf(code: string): RowFields | null {
        const at = code.indexOf('"UserBattleStatistic(userId="');
        if (at < 0 || code.indexOf('"UserBattleStatistic(userId="', at + 1) >= 0) return null;
        // Only the row data's own text, which ends with its function: the next class's text names fields too.
        const end = code.indexOf('}', at);
        if (end < 0) return null;
        const text = code.slice(at, end);
        const field = (name: string): string | null =>
            new RegExp(`", ${name}="\\+(?:[\\w$]+\\()?this\\.([\\w$]+)`).exec(text)?.[1] ?? null;
        const isLocalUser = field('isLocalUser');
        const team = field('team');
        const isTeamMode = field('isTeamMode');
        const currentUserTeam = field('currentUserTeam');
        if (isLocalUser === null || team === null || isTeamMode === null || currentUserTeam === null) return null;
        return { isLocalUser, team, isTeamMode, currentUserTeam };
    }

    function patchProtectionColours(code: string): string | null {
        const skip = (what: string): null => {
            warn(`${LOG} could not find the protection ${what} in this bundle, protection-colours hook skipped`);
            return null;
        };
        const icons = [...code.matchAll(PROTECTION_ICON)];
        if (icons.length !== 2 || icons[0][4] !== icons[1][4] || icons[0][5] !== icons[1][5]) return skip('icons');
        const row = rowFieldsOf(code);
        if (row === null) return skip('row fields');
        const edits: Edit[] = [];
        for (const icon of icons) {
            const [, , , condition, , , type] = icon;
            const before = code.slice(Math.max(0, icon.index - PROTECTION_SLOT_RANGE), icon.index);
            const slots = [...before.matchAll(PROTECTION_SLOT)];
            const slot = slots[slots.length - 1];
            if (slot === undefined) return skip('slot');
            const [whole, params, slotVar, factory, builder, make] = slot;
            // The added code reads the icon's own names (i, t...), so the slot must be the icon's own function: no other
            // function starts in between, and every name the type and the colour test start with is one of its inputs.
            const inputs = new Set(params.split(','));
            const used = [...`${type} ${condition}`.matchAll(/(?<![\w$.])([\w$]+)\./g)].map((found) => found[1]);
            if (/\}function [\w$]+\(/.test(before.slice(slot.index)) || used.some((name) => !inputs.has(name))) return skip('slot');
            const element = elementClassNear(code, icon.index, factory);
            if (element === null) return skip('slot element');
            const attributes = attributeHelperNear(code, icon.index);
            if (attributes === null) return skip('attribute list');
            // A row slot belongs to one player, an enemy or not; the count under the tables only counts enemies.
            const owner = /([\w$]+)\.props\.itemKey\./.exec(condition);
            let enemy = '"1"';
            if (type.includes('.')) {
                if (owner === null) return skip('row owner');
                const p = `${owner[1]}.props.itemKey`;
                enemy = `(!${p}.${row.isLocalUser}&&(!${p}.${row.isTeamMode}||!${p}.${row.team}.equals(${p}.${row.currentUserTeam})))?"1":null`;
            }
            const call = `${builder}.${make}(${slotVar})`;
            edits.push({
                at: Math.max(0, icon.index - PROTECTION_SLOT_RANGE) + slot.index + whole.length - call.length,
                length: call.length,
                text: `${builder}.${make}(${makerWithAttributes(element, attributes, `"data-kasp-protection",String(${type}),"data-kasp-own",(${condition})?"1":null,"data-kasp-enemy",${enemy}`)})`,
            });
        }
        return applyEdits(code, edits);
    }

    // The battle tab's own colours (owner, 2026-11-11): every player row of the Tab screen that is an ally's (the player's own, or a
    // teammate's in a team battle) gets data-kasp-ally="1", so battle_tab.css colours the allies' and the enemies' rows with a
    // plain attribute and nothing has to be checked while the table is open. The row is made by the row component's own maker,
    // found by the row's key text, as in this build (names change per build):
    //   An(Jk).jap=function(t){var n=Sk,i=Nn.nut(n);i.cap("BattleTabStatisticRow_"+this.props.itemKey.y1u7_1.toString());
    // The maker is replaced by the same element class with the attribute; the row data is read right there (this.props.itemKey),
    // with the row fields read from the row data's text, as for the enemies' protection icons.
    // The row's element maker sits further from the row's code than other makers (about 69000 characters in this build); it
    // must still be the only one of its name and shape in reach.
    const BATTLE_TAB_ROW_ELEMENT_RANGE = 120000;
    const BATTLE_TAB_ROW = /var ([\w$]+)=([\w$]+),([\w$]+)=([\w$]+)\.([\w$]+)\(\1\);\3\.[\w$]+\("BattleTabStatisticRow_"\+this\.props\.itemKey\./g;

    function patchBattleTabRows(code: string): string | null {
        const skip = (what: string): null => {
            warn(`${LOG} could not find the battle tab row ${what} in this bundle, the allies' rows keep the enemies' colour`);
            return null;
        };
        const rows = [...code.matchAll(BATTLE_TAB_ROW)];
        if (rows.length !== 1) return skip('maker');
        const [whole, factoryVar, factory, , builder, make] = rows[0];
        const fields = rowFieldsOf(code);
        if (fields === null) return skip('fields');
        const made = [...around(code, rows[0].index, BATTLE_TAB_ROW_ELEMENT_RANGE).matchAll(elementMaker(factory))];
        const element = made.length === 1 ? made[0][2] : undefined;
        if (element === undefined) return skip('element');
        const attributes = attributeHelperNear(code, rows[0].index);
        if (attributes === null) return skip('attribute list');
        const p = 'this.props.itemKey';
        const ally = `${p}.${fields.isLocalUser}||${p}.${fields.isTeamMode}&&${p}.${fields.team}!=null&&${p}.${fields.team}.equals(${p}.${fields.currentUserTeam})`;
        // Read here, where this is the row, and handed to the maker, which runs later.
        const maker = `function(kaspAlly){return ${makerWithAttributes(element, attributes, '"data-kasp-ally",kaspAlly')}}((${ally})?"1":null)`;
        const call = `${builder}.${make}(${factoryVar})`;
        const at = rows[0].index + whole.indexOf(call);
        return applyEdits(code, [{ at, length: call.length, text: `${builder}.${make}(${maker})` }]);
    }

    // The turret colours of the battle tab (build-plan 18c). A row's turret cell starts with the turret's icon, which the game
    // draws as a white picture (a CSS background) chosen by the turret's id through a chain of id tests; it is the same picture
    // as that turret's protection. Two edits, both or none: the icon element gets data-kasp-turret with the turret's id, and the
    // game also sets the same picture as the icon's stencil (mask-image), which looks exactly the same until battle_tab.css
    // takes the white picture away and puts the turret's colour behind the stencil. As in this build:
    //   var e,u,s=Ik,o=Nn.nut(s),_=o.juv(),h=t.props.itemKey.w1u8_1,a=null==h?null:h.rl3_1;null==a||wh(_,new vh(lh((u=Jt(e=a,...)?In():...:cn(),an.ipl(u)))))
    // The hull cell is drawn the same way just after it; only the first one, the turret's, is edited.
    const TURRET_ICON = /var ([\w$]+),([\w$]+),([\w$]+)=([\w$]+),([\w$]+)=([\w$]+)\.([\w$]+)\(\3\),([\w$]+)=\5\.([\w$]+)\(\),([\w$]+)=([\w$]+)\.props\.itemKey\.([\w$]+),([\w$]+)=null==\10\?null:\10\.([\w$]+);null==\13\|\|([\w$]+)\(\8,new ([\w$]+)\(([\w$]+)\(\(\2=/g;
    const TURRET_CHAIN_RANGE = 3000;
    // The game's function that sets an element's stencil (mask-image): C_(c,"url("+...
    const STENCIL_SETTER = /([\w$]+)\([\w$]+,"url\("\+/g;

    function patchTurretColours(code: string): string | null {
        const skip = (what: string): null => {
            warn(`${LOG} could not find the turret ${what} in this bundle, turret-colours hook skipped`);
            return null;
        };
        const cells = [...code.matchAll(TURRET_ICON)];
        if (cells.length !== 2) return skip('icon cells');
        const turret = cells[0];
        const [whole, , picture, factoryVar, factory, , builder, make, css, , , component, tank, , field] = turret;
        // The picture call must end inside the turret icon's own statement: the hull icon's statement after it ends with the
        // same call, and edits split across the two would leave the game's script broken.
        const after = code.slice(turret.index + whole.length, turret.index + whole.length + TURRET_CHAIN_RANGE);
        const statementEnd = after.indexOf(';');
        if (statementEnd < 0) return skip('icon picture');
        const chainEnd = new RegExp(`,([\\w$]+)\\.([\\w$]+)\\(${asPattern(picture)}\\)\\)\\)\\)\\)`).exec(after.slice(0, statementEnd));
        if (chainEnd === null) return skip('icon picture');
        const element = elementClassNear(code, turret.index, factory);
        if (element === null) return skip('icon element');
        const attributes = attributeHelperNear(code, turret.index);
        const mask = onlyName(around(code, turret.index, GAME_ATTRIBUTE_RANGE), STENCIL_SETTER);
        if (attributes === null || mask === null) return skip('attribute list or stencil setter');

        const tankInfo = `${component}.props.itemKey.${tank}`;
        const call = `${builder}.${make}(${factoryVar})`;
        const callAt = turret.index + whole.indexOf(call);
        const drawAt = turret.index + whole.lastIndexOf('||') + 2;
        const endAt = turret.index + whole.length + chainEnd.index + chainEnd[0].length;
        return applyEdits(code, [
            { at: endAt, length: 0, text: `,${mask}(${css},"url("+${chainEnd[1]}.${chainEnd[2]}(${picture})+")"))` },
            { at: drawAt, length: 0, text: '(' },
            {
                at: callAt,
                length: call.length,
                text: `${builder}.${make}(${makerWithAttributes(element, attributes, `"data-kasp-turret",String(null==${tankInfo}?null:${tankInfo}.${field})`)})`,
            },
        ]);
    }

    // The augment numbers of the battle tab (build-plan 18d). A row's turret cell and hull cell each end with the icon of the
    // player's augment, which the game draws from the augment's number in the player's tank data. Both icons get that number
    // in data-kasp-augment, so augments.ts can show the augment's text when the mouse is on it. Both or none. As in this build:
    //   var c=Ak,f=Nn.nut(c),l=f.juv(),v=t.props.itemKey.w1u8_1,w=null==v?null:v.sl3_1;wh(l,new vh(lh(gh(null==w?new mr(-1,-1):w))))
    // and the same with Mk and v.pl3_1 for the hull's augment.
    const AUGMENT_ICON = /var ([\w$]+)=([\w$]+),([\w$]+)=([\w$]+)\.([\w$]+)\(\1\),([\w$]+)=\3\.([\w$]+)\(\),([\w$]+)=([\w$]+)\.props\.itemKey\.([\w$]+),([\w$]+)=null==\8\?null:\8\.([\w$]+);[\w$]+\(\6,new [\w$]+\([\w$]+\([\w$]+\(null==\11\?new [\w$]+\(-1,-1\):\11\)\)\)\)/g;

    function patchAugmentIcons(code: string): string | null {
        const skip = (what: string): null => {
            warn(`${LOG} could not find the augment ${what} in this bundle, augment-icons hook skipped`);
            return null;
        };
        const icons = [...code.matchAll(AUGMENT_ICON)];
        if (icons.length !== 2) return skip('icons');
        const edits: Edit[] = [];
        for (const icon of icons) {
            const [whole, factoryVar, factory, , builder, make, , , , component, tank, , field] = icon;
            const element = elementClassNear(code, icon.index, factory);
            if (element === null) return skip('icon element');
            const attributes = attributeHelperNear(code, icon.index);
            if (attributes === null) return skip('attribute list');
            const tankInfo = `${component}.props.itemKey.${tank}`;
            const call = `${builder}.${make}(${factoryVar})`;
            edits.push({
                at: icon.index + whole.indexOf(call),
                length: call.length,
                text: `${builder}.${make}(${makerWithAttributes(element, attributes, `"data-kasp-augment",String(null==${tankInfo}?null:${tankInfo}.${field})`)})`,
            });
        }
        return applyEdits(code, edits);
    }

    // The address of the column's header picture, from change_counter.ts (only the isolated world can ask the extension for
    // it). Checked before the game's code reads it: an extension address of an SVG picture, nothing else.
    function listenChangeHeader(): void {
        onMessage('kasp:change-header', (data) => {
            const address = data['address'];
            if (typeof address !== 'string' || address.length > 300 || !/^chrome-extension:\/\/[a-z]+\/[\w/-]+\.svg$/.test(address)) return;
            window.__kaspChangeHeader = address;
        });
    }

    listenChangeHeader();

    // The chat translation hook (build-plan 19, see blueprint/context/chat-translation.md). Every battle chat message the
    // game adds to its chat list goes through one function, right before the readable text "BattleChat":
    //   function nct(t,n){n instanceof Ret&&n.v11n_1||t.p12x_1.y(n);...}
    // The edit adds one call at its start (window.__kaspChat) that posts each player's message (kasp:chat: the sender's name,
    // clan, rank picture and side, whether it is the player's own, whether it is a team message, and the text) to
    // chat_translation.ts, which shows the translation in its own box. The game's own message is not touched. A team message
    // is told apart by its class, learned from the game's chat display, which registers it as "onTeamMessage".
    const CHAT_TEXT_MAX = 1000;
    const CHAT_LABEL = /^UserLabelData\(userId=(-?\d+), uid=(.*?), rank=(\d+), hasPremium=(true|false), clanTag=(.*?), teamRelation=(\w+)\)$/;
    const RANK_COUNT = 31;
    const seenChat = new WeakSet<object>();
    // The game's small rank pictures as full addresses: plain ranks 1 to 31, then premium ranks 1 to 31. Empty when not found.
    let rankPictures: string[] = [];

    // Called from inside the game's code, so it must never throw into it. Nothing is posted while the player's own id is unknown
    // (the user id hook was not added): the player's own messages could not be told apart, and they must never reach Google
    // except through a translation button.
    window.__kaspChat = function (event: unknown, teamClass: unknown): void {
        try {
            if (ownUserId === '' || !isObject(event) || seenChat.has(event)) return;
            seenChat.add(event);
            let label: RegExpExecArray | null = null;
            let text: string | null = null;
            for (const key of Object.keys(event)) {
                const value = event[key];
                if (typeof value === 'string') {
                    if (text === null) text = value;
                } else if (isObject(value) && label === null) {
                    label = CHAT_LABEL.exec(String(value));
                }
            }
            if (label === null || text === null || text.trim() === '' || text.length > CHAT_TEXT_MAX) return;
            const rank = Number(label[3]);
            const premium = label[4] === 'true';
            const message: KaspChatMessage = {
                type: 'kasp:chat',
                detail: {
                    uid: label[2],
                    clanTag: label[5] === 'null' ? null : label[5],
                    ally: label[6] === 'ALLY',
                    // the player's own message (the id from the game's SetUserId, known here: see above)
                    own: label[1] === ownUserId,
                    team: typeof teamClass === 'function' && event instanceof teamClass,
                    rankPicture: rankPictures[(premium ? RANK_COUNT : 0) + rank - 1] ?? null,
                    text,
                },
            };
            window.postMessage(message, window.location.origin);
        } catch {
            // a missed message only means one line is not translated
        }
    };

    // Each picture of the game is a module of its bundle that gives one file's address, for a rank picture:
    //   12345:(t,n,i)=>{"use strict";t.exports=i.p+"static/images/31.2d481c05.webp"}
    // and the game asks for all its rank pictures in one run of calls such as i(12345), six runs of ranks 1 to 31: 32 pixel
    // plain, 32 pixel premium, then bigger sizes. The first two runs that really are ranks 1 to 31 are taken. i.p is the
    // folder the bundle came from. Nothing is found, and no rank picture shown, when the game changes this.
    const RANK_MODULE = /(\d+):\([\w$]+,[\w$]+,[\w$]+\)=>\{"use strict";[\w$]+\.exports=[\w$]+\.p\+"(static\/images\/(\d{1,2})\.[0-9a-f]+\.webp)"\}/g;
    const RANK_CALL = /[\w$]+\((\d+)\)/g;

    function findRankPictures(code: string, src: string): string[] {
        const folder = src.indexOf('static/js/');
        if (folder < 0) return [];
        const modules = new Map<string, { readonly rank: number; readonly file: string }>();
        for (const m of code.matchAll(RANK_MODULE)) modules.set(m[1], { rank: Number(m[3]), file: m[2] });
        let run: string[] = [];
        for (const m of code.matchAll(RANK_CALL)) {
            const picture = modules.get(m[1]);
            if (picture === undefined) continue;
            if (picture.rank !== (run.length % RANK_COUNT) + 1) run = [];
            if (picture.rank !== (run.length % RANK_COUNT) + 1) continue;
            run.push(src.slice(0, folder) + picture.file);
            if (run.length === 2 * RANK_COUNT) return run;
        }
        return [];
    }

    const CHAT_ANCHOR = '="BattleChat",';
    const CHAT_ADD = /function ([\w$]+)\(([\w$]+),([\w$]+)\)\{(?=\3 instanceof [\w$]+&&\3\.[\w$]+\|\|\2\.[\w$]+\.[\w$]+\(\3\);)/g;
    const CHAT_TEAM = /callableName="onTeamMessage",[\w$]+\}\(this\);[\w$]+\.[\w$]+\([\w$]+\(([\w$]+)\),/;

    function patchChat(code: string): string | null {
        const anchor = code.indexOf(CHAT_ANCHOR);
        if (anchor < 0) {
            warn(`${LOG} could not find the battle chat in this bundle, chat-translation hook skipped`);
            return null;
        }
        const start = Math.max(0, anchor - 3000);
        const before = code.slice(start, anchor);
        let last: RegExpExecArray | null = null;
        CHAT_ADD.lastIndex = 0;
        for (let m = CHAT_ADD.exec(before); m !== null; m = CHAT_ADD.exec(before)) last = m;
        if (last === null) {
            warn(`${LOG} could not find the chat's add message function in this bundle, chat-translation hook skipped`);
            return null;
        }
        const message = last[3];
        const team = CHAT_TEAM.exec(code)?.[1];
        if (team === undefined) warn(`${LOG} could not find the team message class in this bundle, translated team lines get the all chat colour`);
        const teamClass = team === undefined ? 'null' : `typeof ${team}==="function"?${team}:null`;
        const at = start + last.index + last[0].length;
        const call = `window.__kaspChat&&window.__kaspChat(${message},${teamClass});`;
        return `${code.slice(0, at)}${call}${code.slice(at)}`;
    }

    // ---- the daily offer quick buying (build-plan 24, see blueprint/context/shop-quick-buy.md) ----
    // After every shop purchase the game draws a "Purchase successful" dialog. For a purchase made by clicking a card of the
    // showcase (the daily offer) the patched click function leaves a note, window.__kaspShopSkipUntil (a time, a few seconds
    // ahead). The dialog's render and mount functions read it: while the note holds, or for a dialog already skipped, the dialog
    // draws nothing, and when it mounts the note is used up and the game's own close function runs, as if the player had pressed
    // Enter. A dialog that mounts with no note (every other purchase) is untouched. Nothing watches the page: the game's own code
    // calls these functions when it clicks and when it draws, and no timer is started. As in this build (names change per build):
    //   click:  .onClick=function(t,n,i){return function(){var t;return t=n,z0(i)&&!p2t().aar().faq_1.apw_1.et6()&&p2t().aar().gaq(new n0(t)),jq}}
    //   render: xq(ZHi).jap=function(t){var n=!CHi(this);if(this.pas_1.z1so_1.r())return jq;var i=Mq(LYt);t.yao(i,BHi(this,n))}
    //   mount:  xq(ZHi).componentDidMount=function(){return this.k1hu()}
    //   close:  (u=function(){return EHi(e),jq}).callableName="close"   (inside BHi, the builder the render calls)
    // The click edit puts the note in front of the game's buy action, after the game's own checks (a card that is sold, or a
    // purchase still waiting for its answer, never leaves a note). The three edits are made all or none.
    const SHOP_NOTE_MS = 8000;
    const SHOP_CLOSE_RANGE = 1500;
    const skippedDialogs = new WeakSet<object>();

    function shopNoteHolds(): boolean {
        const until = window.__kaspShopSkipUntil;
        return typeof until === 'number' && Date.now() < until;
    }

    // Called from inside the game's code, so these must never throw into it.
    window.__kaspShopHide = function (dialog: object): boolean {
        try {
            return skippedDialogs.has(dialog) || shopNoteHolds();
        } catch {
            return false;
        }
    };

    window.__kaspShopMounted = function (dialog: object, close: () => void): void {
        try {
            if (!skippedDialogs.has(dialog)) {
                if (!shopNoteHolds()) return;
                skippedDialogs.add(dialog);
                window.__kaspShopSkipUntil = 0;
            }
            // A microtask runs before the browser paints, so the dialog is never seen, and the game's mounting is over by then.
            queueMicrotask(() => {
                try {
                    close();
                } catch (e: unknown) {
                    // The game's close could not run: show the dialog as the game drew it, so it is never left hidden and stuck.
                    warn(`${LOG} the shop dialog could not be closed, it is shown:`, e instanceof Error ? e.message : e);
                    skippedDialogs.delete(dialog);
                    const redraw = (dialog as { forceUpdate?: unknown }).forceUpdate;
                    if (typeof redraw === 'function') redraw.call(dialog);
                }
            });
        } catch {
            // an error here leaves the game's dialog as it is
        }
    };

    function shopQuickBuySwitchedOff(): boolean {
        try {
            return localStorage.getItem('kasp_shopquickbuy') === '0';
        } catch {
            return false;
        }
    }

    function patchShopQuickBuy(code: string): string | null {
        const skip = (what: string): null => {
            warn(`${LOG} could not find the shop ${what} in this bundle, shop quick buying skipped`);
            return null;
        };
        const N = '[\\w$]+';
        const click = exactlyOne(code, new RegExp(`\\.onClick=function\\(${N},${N},${N}\\)\\{return function\\(\\)\\{var (${N});return \\1=${N},${N}\\(${N}\\)&&!${N}\\(\\)\\.${N}\\(\\)\\.${N}\\.${N}\\.${N}\\(\\)&&(${N}\\(\\)\\.${N}\\(\\)\\.${N}\\(new ${N}\\(\\1\\)\\)),(${N})\\}\\}`, 'g'));
        if (click === null) return skip('card click');
        const render = exactlyOne(code, new RegExp(`(${N})\\((${N})\\)\\.jap=function\\(t\\)\\{var n=!${N}\\(this\\);if\\(this\\.pas_1\\.${N}\\.r\\(\\)\\)return (${N});var i=Mq\\(${N}\\);t\\.yao\\(i,(${N})\\(this,n\\)\\)\\}`, 'g'));
        if (render === null) return skip('success dialog render');
        const [, classWrapper, dialogClass, unit, builder] = render;
        const mount = exactlyOne(code, new RegExp(`${asPattern(classWrapper)}\\(${asPattern(dialogClass)}\\)\\.componentDidMount=function\\(\\)\\{return this\\.(${N})\\(\\)\\}`, 'g'));
        if (mount === null) return skip('success dialog mount');
        const builderAt = code.indexOf(`function ${builder}(t,n){`);
        const close = builderAt < 0 ? null : new RegExp(`\\(${N}=function\\(\\)\\{return (${N})\\(${N}\\),${asPattern(unit)}\\}\\)\\.callableName="close"`).exec(code.slice(builderAt, builderAt + SHOP_CLOSE_RANGE));
        if (close === null) return skip('success dialog close');

        const call = click[2];
        const callAt = click.index + click[0].lastIndexOf(`&&${call},`) + 2;
        return applyEdits(code, [
            { at: callAt, length: call.length, text: `(window.__kaspShopSkipUntil=Date.now()+${SHOP_NOTE_MS},${call})` },
            {
                at: render.index + render[0].indexOf('function(t){') + 'function(t){'.length,
                length: 0,
                text: `if(window.__kaspShopHide&&window.__kaspShopHide(this))return ${unit};`,
            },
            {
                at: mount.index,
                length: mount[0].length,
                text: `${classWrapper}(${dialogClass}).componentDidMount=function(){var $kr=this.${mount[1]}(),$ks=this;window.__kaspShopMounted&&window.__kaspShopMounted($ks,function(){${close[1]}($ks)});return $kr}`,
            },
        ]);
    }

    // The bundle with every hook that could be added, and the labels of those hooks.
    function patchBundle(code: string): { readonly code: string; readonly hooked: string[] } {
        let result = code;
        const hooked: string[] = [];
        for (const hook of HOOKS) {
            const patched = patchClass(result, hook);
            if (patched === null) continue;
            result = patched;
            hooked.push(hook.label);
        }
        const garage = patchGarageItem(result);
        if (garage !== null) {
            result = garage;
            hooked.push('mounted-turret');
        }
        const userId = patchUserId(result);
        if (userId !== null) {
            result = userId;
            hooked.push('user-id');
        }
        const settingsTab = patchSettingsTab(result);
        if (settingsTab !== null) {
            result = settingsTab;
            hooked.push('settings-tab');
        }
        const battleTab = patchBattleTab(result);
        if (battleTab !== null) {
            result = battleTab;
            hooked.push('battle-tab');
        }
        const battleTabRows = patchBattleTabRows(result);
        if (battleTabRows !== null) {
            result = battleTabRows;
            hooked.push('battle-tab-rows');
        }
        const protectionColours = patchProtectionColours(result);
        if (protectionColours !== null) {
            result = protectionColours;
            hooked.push('protection-colours');
        }
        const turretColours = patchTurretColours(result);
        if (turretColours !== null) {
            result = turretColours;
            hooked.push('turret-colours');
        }
        const augmentIcons = patchAugmentIcons(result);
        if (augmentIcons !== null) {
            result = augmentIcons;
            hooked.push('augment-icons');
        }
        const thrown = patchGrenadeThrow(result);
        if (thrown !== null) {
            result = thrown;
            hooked.push('grenade-sounds');
        }
        const chat = patchChat(result);
        if (chat !== null) {
            result = chat;
            hooked.push('chat-translation');
        }
        if (!shopQuickBuySwitchedOff()) {
            const shop = patchShopQuickBuy(result);
            if (shop !== null) {
                result = shop;
                hooked.push('shop-quick-buy');
            }
        }
        // Last, so every other edit finds the game's code as it was.
        if (theme !== null) {
            const coloured = patchColours(result, theme);
            if (coloured.count > 0) {
                result = coloured.code;
                hooked.push(`game-colour (${coloured.count} colours, ${coloured.kept} kept styles)`);
            }
        }
        return { code: result, hooked };
    }

    // An inline script runs while it is added, so its 10 MB of text can go right after.
    function runScript(script: HTMLScriptElement): void {
        (document.head || document.documentElement).appendChild(script);
        if (script.src === '') script.textContent = '';
    }

    // Puts the game's bundle back after it was held back. Whatever fails, the game still gets its code: the fetched
    // copy unpatched when only the patch failed, or the original address when the download failed.
    async function loadBundle(src: string): Promise<void> {
        const script = document.createElement('script');
        try {
            const res = await fetch(src, { signal: AbortSignal.timeout(BUNDLE_TIMEOUT_MS) });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const original = await res.text();
            try {
                rankPictures = findRankPictures(original, src);
            } catch {
                rankPictures = [];
            }
            if (rankPictures.length === 0) warn(`${LOG} could not find the rank pictures in this bundle, translated chat lines show no rank`);
            const patched = patchBundle(original);
            script.textContent = patched.code;
            if (patched.hooked.length > 0) log(`${LOG} hooks added to the game: ${patched.hooked.join(', ')}`);
        } catch (e: unknown) {
            warn(`${LOG} could not fetch the game bundle, starting it without the hook:`, e instanceof Error ? e.message : e);
            script.src = src;
        }
        runScript(script);
    }

    // The Augments tab draws an augment the player cannot see as a "?" card, but the game's own React data for that card still
    // holds its real name and rank, and the address of its picture. On request from augments.ts this copies those values, and
    // nothing else, onto each card of the row as data-kasp-card; it changes nothing in the game. React keeps a card's data on a property of its element, which the
    // isolated world cannot see, so only this world can read it. Nothing is printed: a card it cannot read just gets no attribute.
    const CARD_ROW_SELECTOR = '.SkinsAndAlterationsStyle-SkinsVerticalComponent';
    const CARD_ATTRIBUTE = 'data-kasp-card';
    const CARD_REQUEST = 'kasp:cards-request';
    const MAX_FIBER_DEPTH = 8;
    const MAX_CARD_NAME_LENGTH = 200;
    const RARITY_NAME = /^[A-Z_]{2,20}$/;
    const AUGMENT_CATEGORY = 'DEVICE';

    function isObject(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null;
    }

    // The game's picture object has no readable address field, only methods, and their names are scrambled and change with the
    // game. So the address is taken from the one of the object's own methods (no arguments) that returns an address on the
    // game's server, found by what it returns and remembered per class. Only the object's class and its parent are looked at.
    const PICTURE_HOST = /(^|\.)tankionline\.com$/;
    const MAX_PICTURE_LENGTH = 500;
    const PICTURE_METHOD_DEPTH = 2;
    type PictureMethod = () => unknown;
    const pictureMethods = new WeakMap<object, PictureMethod>();

    function asPictureUrl(value: unknown): string | null {
        if (typeof value !== 'string' || value.length > MAX_PICTURE_LENGTH) return null;
        try {
            const url = new URL(value);
            return url.protocol === 'https:' && PICTURE_HOST.test(url.hostname) ? url.href : null;
        } catch {
            return null;
        }
    }

    function readPictureUrl(picture: unknown): string | null {
        if (!isObject(picture)) return null;
        const first: unknown = Object.getPrototypeOf(picture);
        if (!isObject(first)) return null;
        const known = pictureMethods.get(first);
        if (known !== undefined) {
            const url = asPictureUrl(Reflect.apply(known, picture, []));
            if (url !== null) return url;
        }
        let proto: unknown = first;
        for (let depth = 0; depth < PICTURE_METHOD_DEPTH && isObject(proto) && proto !== Object.prototype; depth++) {
            for (const name of Object.getOwnPropertyNames(proto)) {
                const method = Object.getOwnPropertyDescriptor(proto, name)?.value as unknown;
                if (name === 'constructor' || typeof method !== 'function' || method.length !== 0) continue;
                let url: string | null = null;
                try {
                    url = asPictureUrl(Reflect.apply(method as PictureMethod, picture, []));
                } catch {
                    // a method that throws is not the one
                }
                if (url !== null) {
                    pictureMethods.set(first, method as PictureMethod);
                    return url;
                }
            }
            proto = Object.getPrototypeOf(proto);
        }
        return null;
    }

    function fiberOf(element: Element): unknown {
        const key = Object.keys(element).find((name) => name.startsWith('__reactFiber$'));
        return key === undefined ? null : (element as unknown as Record<string, unknown>)[key];
    }

    // The left panel shows a bigger picture of the selected skin or colour than the card does. The game keeps the selected item's
    // model in the panel's components, and the model holds two picture objects of the same class: the card's picture and the big
    // one. So the big one is the other .webp on the object that holds the card's picture, the first such object found looking
    // outward from the panel. Only the selected card is asked, and nothing is remembered: a picture address alone does not say
    // which item it belongs to (every turret's XT skin has the same badge), so an answer kept from one item is wrong for another.
    // Only plain data fields are read, and the only method ever called is the picture method already found for the card's picture
    // class, on objects of that class.
    const PANEL_SELECTOR = '[class~="-backgroundImageContain"]';
    const MAX_PANEL_FIBERS = 25;
    const MAX_MODEL_DEPTH = 6;
    const MAX_MODEL_OBJECTS = 20000;
    const MAX_OWN_NAMES = 300;
    const WEBP_PATH = /\.webp$/;

    function pictureOf(value: unknown, proto: object, method: PictureMethod): string | null {
        if (!isObject(value) || Object.getPrototypeOf(value) !== proto) return null;
        try {
            return asPictureUrl(Reflect.apply(method, value, []));
        } catch {
            return null;
        }
    }

    // A breadth first look through what the panel's component holds, for the object that holds the card's picture.
    function findPreviewIn(start: object, proto: object, method: PictureMethod, address: string, budget: { left: number }): string | null {
        const seen = new Set<object>([start]);
        let level: object[] = [start];
        for (let depth = 0; level.length > 0 && depth <= MAX_MODEL_DEPTH; depth++) {
            const next: object[] = [];
            for (const holder of level) {
                if (budget.left-- <= 0) return null;
                const pictures: string[] = [];
                for (const name of Object.getOwnPropertyNames(holder).slice(0, MAX_OWN_NAMES)) {
                    const value = Object.getOwnPropertyDescriptor(holder, name)?.value as unknown;
                    if (!isObject(value)) continue;
                    const url = pictureOf(value, proto, method);
                    if (url !== null) pictures.push(url);
                    else if (!seen.has(value) && !(value instanceof Node) && !(value instanceof Window) && !ArrayBuffer.isView(value)) {
                        seen.add(value);
                        next.push(value);
                    }
                }
                if (!pictures.includes(address)) continue;
                const bigger = pictures.filter((url) => url !== address && WEBP_PATH.test(new URL(url).pathname));
                if (bigger.length === 1 && bigger[0] !== undefined) return bigger[0];
            }
            level = next;
        }
        return null;
    }

    function readPreviewUrl(icon: unknown): string | null {
        if (!isObject(icon)) return null;
        const proto: unknown = Object.getPrototypeOf(icon);
        if (!isObject(proto)) return null;
        const method = pictureMethods.get(proto);
        if (method === undefined) return null;
        const address = pictureOf(icon, proto, method);
        if (address === null) return null;
        const budget = { left: MAX_MODEL_OBJECTS };
        for (const panel of Array.from(document.querySelectorAll(PANEL_SELECTOR))) {
            let fiber = fiberOf(panel);
            for (let level = 0; level < MAX_PANEL_FIBERS && isObject(fiber); level++) {
                const model = fiber['stateNode'];
                if (isObject(model) && !(model instanceof Node)) {
                    const found = findPreviewIn(model, proto, method, address, budget);
                    if (found !== null) return found;
                }
                fiber = fiber['return'];
            }
        }
        return null;
    }

    function isCardProps(props: unknown): props is Record<string, unknown> & { name: string; isUnknown: boolean } {
        return isObject(props) && typeof props['name'] === 'string' && typeof props['isUnknown'] === 'boolean';
    }

    // The card component's own object always holds its latest props. React keeps two copies of every fiber and the element's
    // pointer can stay on the older one, so the fiber's props can belong to the item the element showed before (a card kept
    // from another turret, say). The element's own props point at the elements the component made, and each of those names
    // the component that made it, so the latest props are read from there; the fiber walk is only the fallback.
    function ownerCardProps(card: Element): Record<string, unknown> | null {
        const key = Object.keys(card).find((name) => name.startsWith('__reactProps$'));
        const hostProps: unknown = key === undefined ? null : (card as unknown as Record<string, unknown>)[key];
        const children = isObject(hostProps) ? hostProps['children'] : null;
        const made: unknown = Array.isArray(children) ? (children as unknown[]).find(isObject) : children;
        const owner = isObject(made) ? made['_owner'] : null;
        const instance = isObject(owner) ? owner['stateNode'] : null;
        const props = isObject(instance) ? instance['props'] : null;
        return isCardProps(props) ? props : null;
    }

    function fiberCardProps(card: Element): Record<string, unknown> | null {
        let fiber: unknown = fiberOf(card);
        for (let depth = 0; depth < MAX_FIBER_DEPTH && isObject(fiber); depth++) {
            const props = fiber['memoizedProps'];
            if (isCardProps(props)) return props;
            fiber = fiber['return'];
        }
        return null;
    }

    // The values of the card component that holds a name and an unknown flag.
    function readCardProps(card: Element): KaspGameCard | null {
        const props = ownerCardProps(card) ?? fiberCardProps(card);
        if (props === null || !isCardProps(props)) return null;
        const rarity = String(props['currentRarity']);
        if (props.name === '' || !RARITY_NAME.test(rarity)) return null;
        const picture = props.isUnknown ? readPictureUrl(props['icon']) : null;
        const word = props['category'] === undefined ? null : String(props['category']);
        const category = word !== null && RARITY_NAME.test(word) ? word : null;
        // An augment's panel shows the card's own picture, so only the selected skin or colour needs the bigger one.
        const preview = picture !== null && props['isSelected'] === true && category !== AUGMENT_CATEGORY ? readPreviewUrl(props['icon']) : null;
        return {
            name: props.name.slice(0, MAX_CARD_NAME_LENGTH),
            category,
            rarity,
            unknown: props.isUnknown,
            picture,
            preview,
        };
    }

    function installCardReader(): void {
        window.addEventListener(CARD_REQUEST, () => {
            const row = document.querySelector(CARD_ROW_SELECTOR);
            if (row === null) return;
            for (const card of Array.from(row.children)) {
                let value: string | null = null;
                try {
                    const props = readCardProps(card);
                    value = props === null ? null : JSON.stringify(props);
                } catch {
                    // a card whose data cannot be read gets no attribute
                }
                if (value === null) {
                    if (card.hasAttribute(CARD_ATTRIBUTE)) card.removeAttribute(CARD_ATTRIBUTE);
                } else if (card.getAttribute(CARD_ATTRIBUTE) !== value) {
                    card.setAttribute(CARD_ATTRIBUTE, value);
                }
            }
        });
    }

    // The Containers screen. A tile shows no name, but the game keeps a list of every reward with its name and picture. On request
    // from augments.ts this copies the augments' names, ranks and picture addresses, and nothing else, onto the screen as data-kasp-rewards.
    // The list's field names are scrambled and change with the game, so it is found by what it holds: an array of objects of one class,
    // one of which has a field equal to the name the screen shows for the selected tile. The longest one is taken, because the list on
    // the screen's component shrinks when a rarity filter is on and the full one stays in the game's state. Only plain fields are read.
    const REWARD_ROOT_SELECTOR = '.ContainerInfoComponentStyle-lootBoxContainer';
    const REWARD_TILE_SELECTOR = '.RewardCardComponentStyle-imageBlock';
    const REWARD_NAME_SELECTOR = '.ContainerInfoComponentStyle-rewardNameContainer';
    const REWARDS_ATTRIBUTE = 'data-kasp-rewards';
    const REWARDS_REQUEST = 'kasp:rewards-request';
    const MAX_REWARD_FIBERS = 60;
    const MAX_REWARD_DEPTH = 7;
    const MAX_REWARD_OBJECTS = 100000;
    const MAX_REWARD_FIELDS = 5000;
    // A reward holds two objects, its rank and its picture. Anything with more is not this list, and readPictureUrl, which calls a
    // class's methods, is not used on it.
    const MAX_REWARD_ENTRY_OBJECTS = 2;
    const NOT_GAME_DATA = new Set(['_owner', '_store', 'return', 'child', 'sibling', 'alternate']);

    function plainField(holder: object, name: string): unknown {
        return Object.getOwnPropertyDescriptor(holder, name)?.value as unknown;
    }

    // Capitals count, and every entry must have the field: the type of the first tile says "rubies" where its name says "Rubies", and
    // the description of one reward is the same word as its name, but some rewards have no description.
    function rewardNameField(list: readonly unknown[], shown: string): string | null {
        const first: unknown = list[0];
        if (!isObject(first)) return null;
        const proto: unknown = Object.getPrototypeOf(first);
        if (proto === Object.prototype || proto === null) return null;
        // A plain loop, because every() skips the empty slots some of the game's arrays have.
        for (const entry of list) {
            if (!isObject(entry) || Object.getPrototypeOf(entry) !== proto) return null;
        }
        const entries = list as readonly object[];
        for (const entry of entries) {
            for (const name of Object.getOwnPropertyNames(entry)) {
                const value = plainField(entry, name);
                if (typeof value !== 'string' || value.trim() !== shown) continue;
                if (entries.every((other) => typeof plainField(other, name) === 'string')) return name;
            }
        }
        return null;
    }

    function findRewardList(start: object, shown: string, budget: { left: number }): { list: unknown[]; nameField: string } | null {
        const seen = new Set<object>([start]);
        let best: { list: unknown[]; nameField: string } | null = null;
        let level: object[] = [start];
        for (let depth = 0; level.length > 0 && depth <= MAX_REWARD_DEPTH; depth++) {
            const next: object[] = [];
            for (const holder of level) {
                if (budget.left-- <= 0) return best;
                if (Array.isArray(holder) && holder.length > (best?.list.length ?? 0)) {
                    const nameField = rewardNameField(holder as unknown[], shown);
                    if (nameField !== null) best = { list: holder as unknown[], nameField };
                }
                for (const name of Object.getOwnPropertyNames(holder).slice(0, MAX_REWARD_FIELDS)) {
                    if (NOT_GAME_DATA.has(name)) continue;
                    const value = plainField(holder, name);
                    if (isObject(value) && !seen.has(value) && !(value instanceof Node) && !(value instanceof Window) && !ArrayBuffer.isView(value)) {
                        seen.add(value);
                        next.push(value);
                    }
                }
            }
            level = next;
        }
        return best;
    }

    // Only the augments, whose pictures are SVGs; paints, crystals and supplies are not.
    function readRewards(list: readonly unknown[], nameField: string): { name: string; picture: string; rank: string | null }[] | null {
        const rewards: { name: string; picture: string; rank: string | null }[] = [];
        let pictureField: string | null = null;
        for (const entry of list) {
            if (!isObject(entry)) return null;
            const objects = Object.getOwnPropertyNames(entry).filter((name) => isObject(plainField(entry, name)));
            if (objects.length > MAX_REWARD_ENTRY_OBJECTS) return null;
            pictureField ??= objects.find((name) => readPictureUrl(plainField(entry, name)) !== null) ?? null;
            const picture = pictureField === null ? null : readPictureUrl(plainField(entry, pictureField));
            const name = plainField(entry, nameField);
            if (picture !== null && typeof name === 'string' && new URL(picture).pathname.endsWith('.svg')) {
                const rankField = objects.find((field) => field !== pictureField);
                const rank = rankField === undefined ? '' : String(plainField(entry, rankField));
                rewards.push({ name: name.slice(0, MAX_CARD_NAME_LENGTH), picture, rank: RARITY_NAME.test(rank) ? rank : null });
            }
        }
        return rewards;
    }

    function installRewardReader(): void {
        window.addEventListener(REWARDS_REQUEST, () => {
            const root = document.querySelector(REWARD_ROOT_SELECTOR);
            const tile = root?.querySelector(REWARD_TILE_SELECTOR);
            const shown = root?.querySelector(REWARD_NAME_SELECTOR)?.textContent?.trim();
            if (root === null || root === undefined || tile === null || tile === undefined || !shown) return;
            try {
                const budget = { left: MAX_REWARD_OBJECTS };
                let fiber = fiberOf(tile);
                for (let up = 0; up < MAX_REWARD_FIBERS && isObject(fiber); up++) {
                    const component = fiber['stateNode'];
                    if (isObject(component) && !(component instanceof Node)) {
                        const found = findRewardList(component, shown, budget);
                        const rewards = found === null ? null : readRewards(found.list, found.nameField);
                        if (rewards !== null) {
                            const value = JSON.stringify(rewards);
                            if (root.getAttribute(REWARDS_ATTRIBUTE) !== value) root.setAttribute(REWARDS_ATTRIBUTE, value);
                            return;
                        }
                    }
                    fiber = fiber['return'];
                }
            } catch {
                // a list that cannot be read gets no attribute, and those tiles get no box
            }
        });
    }

    // ---- the game colour ----

    // The game's look is one family of weak blues (the navy backgrounds, the see-through tints), written in the game's own code in
    // two ways: as colour text ("#001926", "rgba(0, 25, 38, 0)") and as numbers given to its colour makers (t$(0,25,38)). With a
    // colour saved under kasp_theme, those colours are rewritten once in the game's code before it runs (patchColours, called by
    // patchBundle), so the game draws itself in that colour on every screen, battles included, and nothing of this part runs while
    // the game is played (owner, 2026-11-11). The page's own style elements (its first loading screen) are painted while the page
    // loads, then nothing watches. A new colour applies at the next start: settings_tab.ts reloads the game when its settings close.
    const THEME_KEY = 'kasp_theme';
    // Kept before the old pictures part wraps it, so the values this part writes are not seen by any hook.
    const nativeSetProperty = CSSStyleDeclaration.prototype.setProperty;
    const MAX_THEME_DEPTH = 6;
    // A colour of the game's theme: a blue hue, and weak (the gap between its strongest and weakest channel). The strong blues mean
    // something (the cyan of rare items, the blue team) and stay, as every other hue does.
    const THEME_HUE_MIN = 185;
    const THEME_HUE_MAX = 240;
    const THEME_GAP_MIN = 0.04 * 255;
    const THEME_GAP_MAX = 0.45 * 255;
    // The very light blues (the icons and the pale text, all at 87% lightness; every other blue of the game is at 48% or darker)
    // keep the game's own colour (owner, 2026-11-11).
    const THEME_LIGHTNESS_MAX = 0.7;
    // A url(...) is passed through untouched: a picture address or an SVG id is not a colour.
    const COLOUR_TOKEN =
        /url\([^)]*\)|rgba?\(\s*(\d+(?:\.\d+)?)\s*[,\s]\s*(\d+(?:\.\d+)?)\s*[,\s]\s*(\d+(?:\.\d+)?)\s*(?:[,/]\s*(\d*\.?\d+%?)\s*)?\)|#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;
    // A call to one of the game's colour makers with plain numbers, name(r,g,b) or name(r,g,b,alpha), as the minified code writes
    // them. A call after "new " or after "." is something else (a 3D value, a method: new E$(0,0,80), x.n23(0,0,75)) and stays.
    const COLOUR_CALL = /(?<![\w$.])(?<!new )([\w$]+)\((\d{1,3}),(\d{1,3}),(\d{1,3})(,(?:\d*\.)?\d+)?\)/g;

    type Rgb = readonly [number, number, number];

    // The new look of a theme colour: its lightness, saturation and alpha are kept and its hue is replaced (null: no colour at all).
    interface Theme {
        readonly hue: number | null;
    }

    // The owner's choice of 2026-11-11: Pink and Purple kept, and three deep ones. A value saved before (grey, red, green) is no
    // longer one of them and gives the game's blue.
    const THEMES: Readonly<Record<string, Theme>> = {
        pink: { hue: 330 },
        purple: { hue: 275 },
        crimson: { hue: 345 },
        teal: { hue: 170 },
        bronze: { hue: 30 },
    };

    // The saved colour, or null for the game's own blue (no key, another value, or a storage that cannot be read). Read once, when
    // the page starts: a new colour comes with the next start.
    function savedTheme(): Theme | null {
        try {
            const value = localStorage.getItem(THEME_KEY);
            return value !== null && Object.prototype.hasOwnProperty.call(THEMES, value) ? THEMES[value] : null;
        } catch {
            return null;
        }
    }

    const theme = savedTheme();

    function isThemeColour([r, g, b]: Rgb): boolean {
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const gap = max - min;
        if (gap <= THEME_GAP_MIN || gap > THEME_GAP_MAX) return false;
        if ((max + min) / 2 / 255 > THEME_LIGHTNESS_MAX) return false;
        let hue = max === r ? ((g - b) / gap) % 6 : max === g ? (b - r) / gap + 2 : (r - g) / gap + 4;
        hue *= 60;
        if (hue < 0) hue += 360;
        return hue >= THEME_HUE_MIN && hue <= THEME_HUE_MAX;
    }

    function toSaturationLightness([r, g, b]: Rgb): [number, number] {
        const max = Math.max(r, g, b) / 255;
        const min = Math.min(r, g, b) / 255;
        const lightness = (max + min) / 2;
        const range = max - min;
        return [range === 0 ? 0 : range / (1 - Math.abs(2 * lightness - 1)), lightness];
    }

    function fromHsl(hue: number, saturation: number, lightness: number): Rgb {
        const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
        const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
        const m = lightness - chroma / 2;
        const [r, g, b] =
            hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
        return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
    }

    function themedColour(colour: Rgb, next: Theme): Rgb {
        const [saturation, lightness] = toSaturationLightness(colour);
        return next.hue === null ? fromHsl(0, 0, lightness) : fromHsl(next.hue, saturation, lightness);
    }

    const toHex = (channel: number): string => channel.toString(16).padStart(2, '0');

    // Every theme colour of a text in the saved colour, each written in its own form: a hex colour stays a hex colour (with its
    // alpha digits), an rgb() or rgba() stays one. Counts what it changed.
    function recolourText(text: string, next: Theme, changed: { count: number }): string {
        return text.replace(COLOUR_TOKEN, (whole: string, r?: string, g?: string, b?: string, alpha?: string, hex?: string) => {
            if (hex !== undefined) {
                const full = hex.length <= 4 ? hex.split('').map((digit) => digit + digit).join('') : hex;
                const rgb: Rgb = [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
                if (!isThemeColour(rgb)) return whole;
                changed.count++;
                return `#${themedColour(rgb, next).map(toHex).join('')}${full.slice(6)}`;
            }
            if (r === undefined || g === undefined || b === undefined) return whole;
            const rgb: Rgb = [+r, +g, +b];
            if (!isThemeColour(rgb)) return whole;
            changed.count++;
            const [nr, ng, nb] = themedColour(rgb, next);
            return alpha === undefined ? `rgb(${nr}, ${ng}, ${nb})` : `rgba(${nr}, ${ng}, ${nb}, ${alpha})`;
        });
    }

    // Every theme colour a colour maker is given in plain numbers, in the saved colour. Counts what it changed.
    function recolourCalls(text: string, next: Theme, changed: { count: number }): string {
        return text.replace(COLOUR_CALL, (whole: string, name: string, r: string, g: string, b: string, alpha?: string) => {
            const rgb: Rgb = [+r, +g, +b];
            if (rgb[0] > 255 || rgb[1] > 255 || rgb[2] > 255 || !isThemeColour(rgb)) return whole;
            changed.count++;
            return `${name}(${themedColour(rgb, next).join(',')}${alpha ?? ''})`;
        });
    }

    // The parts of the game the repaint leaves in the game's own blue (owner, 2026-11-12): the "Press any button to start" screen.
    // Its dark top fade is the shared style "entranceGradient" (the login and sign-up screens use it too, and keep it as well) and
    // its loading ring is StartScreenComponentStyle's "circleLoader". Each is one small style function in the game's code, found by
    // the name the game gives it (and, when given, by the style it belongs to); the colours inside it are never rewritten.
    const THEME_KEPT_STYLES: readonly { readonly property: string; readonly style?: string }[] = [
        { property: 'entranceGradient' },
        { property: 'circleLoader', style: 'StartScreenComponentStyle' },
    ];
    // A style function is a few hundred characters; a longer span means the end was not found right.
    const MAX_KEPT_STYLE_LENGTH = 4000;
    // A style function sits a little before the constructor line that names it (about 1000 and 10000 characters in this build);
    // one found further away belongs to another module, which uses the same short names.
    const MAX_KEPT_STYLE_DISTANCE = 50000;

    // Where a style's own function sits in the game's code, as [start, end), or null when it cannot be told for sure. A style
    // object's constructor makes each property from its function, as in this build:
    //   var a=this.quw([],Os),c=se;this.o1x4_1=a.iuv(this,gt("circleLoader",1,c,...))
    // and the function itself (function Os(t){...}) is written before the constructor, in the same module.
    function keptStyleSpan(code: string, property: string, style?: string): readonly [number, number] | null {
        let from = 0;
        let to = code.length;
        if (style !== undefined) {
            const registered = new RegExp(`[\\w$]+\\(([\\w$]+),"${style}"`).exec(code);
            if (registered === null) return null;
            to = registered.index;
            from = code.lastIndexOf(`function ${registered[1]}(){`, to);
            if (from < 0) return null;
        }
        const made = /this\.[\w$]+\(\[[^\]]*\],([\w$]+)\)[^;]{0,40};this\.[\w$]+=[\w$]+\.[\w$]+\(this,[\w$]+$/;
        const found: { readonly name: string; readonly at: number }[] = [];
        let at = code.indexOf(`("${property}"`, from);
        while (at >= 0 && at < to) {
            const match = made.exec(code.slice(Math.max(from, at - 300), at));
            if (match !== null) found.push({ name: match[1], at });
            at = code.indexOf(`("${property}"`, at + 1);
        }
        if (found.length !== 1) return null;
        // The short names repeat from module to module, so the nearest one before the constructor is this module's.
        const start = code.lastIndexOf(`function ${found[0].name}(t){`, found[0].at);
        if (start < 0 || found[0].at - start > MAX_KEPT_STYLE_DISTANCE) return null;
        const end = code.indexOf('}function', start);
        if (end < 0 || end - start > MAX_KEPT_STYLE_LENGTH) return null;
        return [start, end + 1];
    }

    // The game's code with its theme colours in the saved colour: first the colour text, then the colour makers' numbers, everywhere
    // but in the kept styles. A colour it made is never a theme colour again (its hue is the saved one, or none), so nothing is
    // changed twice.
    function patchColours(code: string, next: Theme): { readonly code: string; readonly count: number; readonly kept: number } {
        const changed = { count: 0 };
        const spans: (readonly [number, number])[] = [];
        for (const kept of THEME_KEPT_STYLES) {
            const span = keptStyleSpan(code, kept.property, kept.style);
            if (span === null) warn(`${LOG} could not find the game's ${kept.property} style in this bundle, it takes the game colour too`);
            else spans.push(span);
        }
        spans.sort((a, b) => a[0] - b[0]);
        const recolour = (part: string): string => recolourCalls(recolourText(part, next, changed), next, changed);
        let result = '';
        let at = 0;
        let kept = 0;
        for (const [start, end] of spans) {
            if (start < at) continue;
            result += recolour(code.slice(at, start)) + code.slice(start, end);
            at = end;
            kept++;
        }
        return { code: result + recolour(code.slice(at)), count: changed.count, kept };
    }

    // The page's own style elements, which are not in the game's code: every colour of a declaration block in the saved colour.
    function paintStyle(style: CSSStyleDeclaration, next: Theme): void {
        for (let index = 0; index < style.length; index++) {
            const name = style.item(index);
            const current = style.getPropertyValue(name);
            if (!current.includes('rgb') && !current.includes('#')) continue;
            const value = recolourText(current, next, { count: 0 });
            if (value !== current) nativeSetProperty.call(style, name, value, style.getPropertyPriority(name));
        }
    }

    // A rule and the rules inside it (@media, @supports, @keyframes).
    function paintRule(rule: CSSRule, depth: number, next: Theme): void {
        if (depth > MAX_THEME_DEPTH) return;
        const style = (rule as { style?: unknown }).style;
        if (style instanceof CSSStyleDeclaration) paintStyle(style, next);
        const inner = (rule as { cssRules?: unknown }).cssRules;
        if (inner instanceof CSSRuleList) {
            for (let index = 0; index < inner.length; index++) paintRule(inner[index], depth + 1, next);
        }
    }

    function paintSheet(sheet: CSSStyleSheet, next: Theme): void {
        try {
            const rules = sheet.cssRules;
            for (let index = 0; index < rules.length; index++) paintRule(rules[index], 0, next);
        } catch {
            // a sheet from another site cannot be read, and what is left keeps the game's colours
        }
    }

    // The extension's own stylesheets are not in the game's code, so they follow through two variables on the root element: each
    // of our weak blues is written as itself with this hue and strength (build-plan 22b). Written once, at start.
    function writeThemeVariables(next: Theme): void {
        const style = document.documentElement.style;
        nativeSetProperty.call(style, '--kasp-theme-hue', String(next.hue ?? 0));
        nativeSetProperty.call(style, '--kasp-theme-strength', next.hue === null ? '0' : '1');
    }

    // The page's own style elements (its first loading screen among them) are parsed, not in the game's code, so until the page
    // has loaded each one is painted as it arrives, before it is drawn. Then this watch stops for good, and every sheet is painted
    // once more (the game's own rules are already in the colour, and a made colour is never changed again).
    function paintWhileLoading(next: Theme): void {
        const paintAll = (): void => {
            for (const sheet of Array.from(document.styleSheets)) paintSheet(sheet, next);
        };
        if (document.readyState !== 'loading') {
            paintAll();
            return;
        }
        const arrivals = new MutationObserver((records) => {
            for (const record of records) {
                for (const node of record.addedNodes) {
                    if (node instanceof HTMLStyleElement && node.sheet !== null) paintSheet(node.sheet, next);
                }
            }
        });
        arrivals.observe(document.documentElement, { childList: true, subtree: true });
        document.addEventListener(
            'DOMContentLoaded',
            () => {
                arrivals.disconnect();
                paintAll();
            },
            { once: true },
        );
    }

    // With the game's own blue saved, nothing at all.
    function startGameColour(): void {
        if (theme === null) return;
        try {
            writeThemeVariables(theme);
            paintWhileLoading(theme);
        } catch (e) {
            warn(`${LOG} the game colour could not be applied, the game keeps its blue:`, e instanceof Error ? e.message : e);
        }
    }

    // ---- the old augment pictures ----

    // The devs replaced the augment pictures with new ones; old_pictures.ts bundles the old ones and posts kasp:old-pictures (the
    // address of the folder they are in and the stable path of each: a picture's address without its version folder, for example
    // /634/112237/40/362/image.svg). From then on, every address the game assigns to a picture is swapped for the bundled file when
    // its stable path is on the list: the idea of augments.user.js in the repo doomersson/doomersson.github.io (no license; none of
    // its code is used). A picture the list does not have keeps the game's own, and so does an <img> whose old file fails to load.
    // Nothing is touched before the message arrives and checks out, and nothing here may throw into the game. old_pictures.ts and
    // scripts/old-style-picture/lib.mjs have the same rule for a stable path and a file name, since scripts share no imports; change all
    // three together.
    const OLD_STABLE_PATH = /^(?:\/\d{1,12}){2,}\/image\.svg$/;
    const OLD_PICTURE_HOST = /(^|\.)tankionline\.com$/;
    const OLD_FOLDER = '/old_pictures/';
    const MAX_OLD_KEYS = 5000;
    const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

    interface OldPictures {
        readonly base: string;
        readonly keys: ReadonlySet<string>;
    }

    let oldPictures: OldPictures | null = null;
    // The game's addresses whose old picture did not load, so the game's own is kept for them.
    const failedOldPaths = new Set<string>();
    // The game's own address of each <img> that was given an old picture, to give it back when the old one does not load.
    const gameAddressOf = new WeakMap<HTMLImageElement, string>();

    function oldStablePath(address: string): string | null {
        try {
            const url = new URL(address, window.location.href);
            if (url.protocol !== 'https:' || !OLD_PICTURE_HOST.test(url.hostname)) return null;
            const parts = url.pathname.split('/').filter((part) => part !== '');
            if (parts[parts.length - 1] !== 'image.svg') return null;
            parts.splice(parts.length - 2, 1);
            const path = '/' + parts.join('/');
            return OLD_STABLE_PATH.test(path) ? path : null;
        } catch {
            return null;
        }
    }

    function readOldPicturesMessage(data: unknown): OldPictures | null {
        if (!isObject(data)) return null;
        const { base, keys } = data;
        if (typeof base !== 'string' || !Array.isArray(keys) || keys.length === 0 || keys.length > MAX_OLD_KEYS) return null;
        try {
            const url = new URL(base);
            if (url.protocol !== 'chrome-extension:' || url.href !== base || !url.pathname.endsWith(OLD_FOLDER)) return null;
        } catch {
            return null;
        }
        const checked = new Set<string>();
        for (const key of keys as unknown[]) {
            if (typeof key !== 'string' || !OLD_STABLE_PATH.test(key)) return null;
            checked.add(key);
        }
        return { base, keys: checked };
    }

    // The old picture's address for a game address, or the address itself.
    function oldAddress(address: string): string {
        const pictures = oldPictures;
        if (pictures === null || !address.includes('image.svg')) return address;
        const path = oldStablePath(address);
        if (path === null || !pictures.keys.has(path) || failedOldPaths.has(path)) return address;
        return pictures.base + path.slice(1, -'/image.svg'.length).replace(/\//g, '-') + '.svg';
    }

    // The same for every address inside the url(...) of a piece of CSS.
    function oldCss(text: string): string {
        if (oldPictures === null || !text.includes('image.svg')) return text;
        return text.replace(CSS_URL, (whole: string, quote: string, address: string) => {
            const replaced = oldAddress(address);
            return replaced === address ? whole : `url(${quote}${replaced}${quote})`;
        });
    }

    // The page's own setAttribute, kept for what this part writes itself.
    const nativeSetAttribute = Element.prototype.setAttribute;

    // The game's own picture back on an <img> whose old picture could not be loaded.
    function backToGamePicture(event: Event): void {
        try {
            const image = event.currentTarget;
            const pictures = oldPictures;
            if (!(image instanceof HTMLImageElement) || pictures === null) return;
            const original = gameAddressOf.get(image);
            if (original === undefined || !(image.getAttribute('src') ?? '').startsWith(pictures.base)) return;
            const path = oldStablePath(original);
            if (path !== null) failedOldPaths.add(path);
            gameAddressOf.delete(image);
            nativeSetAttribute.call(image, 'src', original);
        } catch {
            // the game keeps whatever it has
        }
    }

    // What an <img> gets for the address the game gave it, remembering the game's own for a failed load.
    function imageAddress(image: HTMLImageElement, address: string): string {
        try {
            const replaced = oldAddress(address);
            if (replaced === address) {
                gameAddressOf.delete(image);
                return address;
            }
            gameAddressOf.set(image, address);
            image.addEventListener('error', backToGamePicture, { once: true });
            return replaced;
        } catch {
            return address;
        }
    }

    // The rules of the page's style sheets that already hold a picture. The game makes the rule of a picture shown as a CSS background
    // (the big picture of the garage's left panel, the Containers tiles) by inserting it into a style sheet, so the style element has no
    // text with the address in it (measured 2026-11-01), and neither an attribute nor setProperty is ever called for it.
    const MAX_RULE_DEPTH = 4;

    function sweepRules(rules: CSSRuleList, depth: number): void {
        if (depth > MAX_RULE_DEPTH) return;
        for (const rule of Array.from(rules)) {
            if (rule instanceof CSSStyleRule) {
                const style = rule.style;
                for (let index = 0; index < style.length; index++) {
                    const name = style.item(index);
                    const value = style.getPropertyValue(name);
                    const next = oldCss(value);
                    if (next !== value) style.setProperty(name, next, style.getPropertyPriority(name));
                }
            } else if ('cssRules' in rule) {
                sweepRules((rule as CSSGroupingRule).cssRules, depth + 1);
            }
        }
    }

    // The pictures already on the page when the list arrives (the game may have drawn some before).
    function sweepOldPictures(): void {
        for (const sheet of Array.from(document.styleSheets)) {
            try {
                sweepRules(sheet.cssRules, 0);
            } catch {
                // a sheet from another origin cannot be read, and holds no picture of the game's
            }
        }
        for (const image of document.querySelectorAll('img[src]')) {
            const value = image.getAttribute('src');
            if (value === null || !(image instanceof HTMLImageElement)) continue;
            const next = imageAddress(image, value);
            if (next !== value) nativeSetAttribute.call(image, 'src', next);
        }
        for (const element of document.querySelectorAll('[style]')) {
            const value = element.getAttribute('style');
            const next = value === null ? null : oldCss(value);
            if (next !== null && next !== value) nativeSetAttribute.call(element, 'style', next);
        }
    }

    // The text of a piece of CSS with its picture addresses swapped, or the text itself if anything goes wrong.
    function swapCssText(text: string): string {
        try {
            return oldCss(text);
        } catch {
            return text;
        }
    }

    // Each function below hooks one way the game can give a picture an address. Every hook keeps the game's own value on any error.
    function hookMessage(): void {
        onMessage('kasp:old-pictures', (data) => {
            if (oldPictures !== null) return;
            const next = readOldPicturesMessage(data);
            if (next === null) {
                warn(`${LOG} an old pictures message was not understood, the game's own pictures stay`);
                return;
            }
            oldPictures = next;
            try {
                sweepOldPictures();
            } catch {
                // the pictures drawn from now on are still swapped
            }
        });
    }

    function hookSetAttribute(): void {
        Element.prototype.setAttribute = function (this: Element, name: string, value: string): void {
            let next = value;
            try {
                if (oldPictures !== null && typeof value === 'string') {
                    const lower = String(name).toLowerCase();
                    if (lower === 'src' || lower === 'href' || lower === 'xlink:href') {
                        next = this instanceof HTMLImageElement && lower === 'src' ? imageAddress(this, value) : oldAddress(value);
                    } else if (lower === 'style') {
                        next = swapCssText(value);
                    }
                }
            } catch {
                next = value;
            }
            return nativeSetAttribute.call(this, name, next);
        };
    }

    function hookImageSource(): void {
        const sourceProperty = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
        const sourceGet = sourceProperty?.get;
        const sourceSet = sourceProperty?.set;
        if (sourceProperty === undefined || sourceGet === undefined || sourceSet === undefined) return;
        Object.defineProperty(HTMLImageElement.prototype, 'src', {
            configurable: sourceProperty.configurable,
            enumerable: sourceProperty.enumerable,
            get: sourceGet,
            set(this: HTMLImageElement, value: unknown): void {
                sourceSet.call(this, typeof value === 'string' && oldPictures !== null ? imageAddress(this, value) : value);
            },
        });
    }

    function hookSetProperty(): void {
        const originalSetProperty = CSSStyleDeclaration.prototype.setProperty;
        CSSStyleDeclaration.prototype.setProperty = function (this: CSSStyleDeclaration, name: string, value: string | null, priority?: string): void {
            return originalSetProperty.call(this, name, typeof value === 'string' ? swapCssText(value) : value, priority ?? '');
        };
    }

    // The rule of a picture shown as a CSS background goes into a style sheet as text, in a sheet or in a group rule (@media, @supports).
    function hookInsertRule(): void {
        const originalInsertRule = CSSStyleSheet.prototype.insertRule;
        CSSStyleSheet.prototype.insertRule = function (this: CSSStyleSheet, rule: string, index?: number): number {
            return originalInsertRule.call(this, typeof rule === 'string' ? swapCssText(rule) : rule, index);
        };
        if (typeof CSSGroupingRule === 'undefined') return;
        const originalGroupInsertRule = CSSGroupingRule.prototype.insertRule;
        CSSGroupingRule.prototype.insertRule = function (this: CSSGroupingRule, rule: string, index?: number): number {
            return originalGroupInsertRule.call(this, typeof rule === 'string' ? swapCssText(rule) : rule, index);
        };
    }

    function hookXmlHttpRequest(): void {
        if (typeof XMLHttpRequest === 'undefined') return;
        const originalOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]): unknown {
            try {
                const address = args[1];
                if (oldPictures !== null && typeof address === 'string') args[1] = oldAddress(address);
                else if (oldPictures !== null && address instanceof URL) args[1] = oldAddress(address.href);
            } catch {
                // the game's own address is used
            }
            return Reflect.apply(originalOpen, this, args);
        } as unknown as typeof XMLHttpRequest.prototype.open;
    }

    function hookFetch(): void {
        if (typeof window.fetch !== 'function') return;
        const originalFetch = window.fetch;
        window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
            let next = input;
            try {
                if (oldPictures !== null) {
                    if (typeof input === 'string') next = oldAddress(input);
                    else if (input instanceof URL) next = oldAddress(input.href);
                    else if (input instanceof Request) {
                        const replaced = oldAddress(input.url);
                        if (replaced !== input.url) next = new Request(replaced, input);
                    }
                }
            } catch {
                next = input;
            }
            return Reflect.apply(originalFetch, this, [next, init]) as Promise<Response>;
        };
    }

    function installOldPictures(): void {
        hookMessage();
        hookSetAttribute();
        hookImageSource();
        hookSetProperty();
        hookInsertRule();
        hookXmlHttpRequest();
        hookFetch();
    }

    // Old augment pictures applies after a reload, so with it off (the exact text 0 under its key, the rule of switches.ts) none of
    // these hooks is put in front of the page's own functions. A storage that cannot be read counts as on, as there.
    function oldPicturesSwitchedOff(): boolean {
        try {
            return localStorage.getItem('kasp_old_pictures') === '0';
        } catch {
            return false;
        }
    }

    if (!oldPicturesSwitchedOff()) installOldPictures();

    // The game's start screen waits for any button unless window.skipEntranceAnyKey is on: the game's own launcher setting, which
    // it writes once at start from its launch parameters (off in the browser) and reads once, when the start screen opens. While
    // the switch is on, the setting always reads true and the game's own write is ignored, so the lobby opens directly. The switch
    // only matters when the game starts, so it is read here once, with the rule of switches.ts, before the game's script runs.
    function skipStartSwitchedOff(): boolean {
        try {
            return localStorage.getItem('kasp_skipstart') === '0';
        } catch {
            return false;
        }
    }

    function installStartScreenSkip(): void {
        try {
            Object.defineProperty(window, 'skipEntranceAnyKey', {
                configurable: true,
                get: () => true,
                set: () => {},
            });
        } catch (e) {
            warn(`${LOG} the start screen skip could not be set, the start screen stays:`, e instanceof Error ? e.message : e);
        }
    }

    if (!skipStartSwitchedOff()) installStartScreenSkip();
    startGameColour();
    installCardReader();
    installRewardReader();

    let caughtBundle = false;

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (!(node instanceof HTMLScriptElement) || !node.src.includes(BUNDLE_PATH)) continue;
                const src = node.src;
                caughtBundle = true;
                node.type = 'javascript/blocked';
                node.remove();
                observer.disconnect();
                void loadBundle(src);
                return;
            }
        }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // If the bundle's tag was never caught and is on the page, the observer lost the race and the game runs unpatched.
    // The observer itself stays on until the tag is caught, so a tag added late is still held back.
    function watchdog(): void {
        if (!caughtBundle && [...document.scripts].some((script) => script.src.includes(BUNDLE_PATH))) {
            error(`${LOG} the game's main bundle ran before it could be held back, the hook is not installed`);
        }
    }

    setTimeout(watchdog, WATCHDOG_MS);
})();
