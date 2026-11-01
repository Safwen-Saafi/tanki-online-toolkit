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

    window.addEventListener('message', (e: MessageEvent) => {
        if (e.source !== window) return;
        const data: unknown = e.data;
        if (!data || typeof data !== 'object' || (data as { type?: unknown }).type !== 'kasp:mounted-request') return;
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

        window.addEventListener('message', (e: MessageEvent) => {
            if (e.source !== window) return;
            const data: unknown = e.data;
            if (!data || typeof data !== 'object' || (data as { type?: unknown }).type !== 'kasp:sound-swap') return;
            const next = readSwapMessage(data);
            if (next !== null) {
                soundSwap = next;
            } else if (!warnedSwap) {
                warnedSwap = true;
                warn(`${LOG} a sound swap message was not understood, the game's own sounds stay`);
            }
        });

        window.addEventListener('message', (e: MessageEvent) => {
            if (e.source !== window) return;
            const data: unknown = e.data;
            if (!data || typeof data !== 'object') return;
            const type = (data as { type?: unknown }).type;
            if (type === 'kasp:late-sounds') {
                const groups = readLateMessage(data);
                if (groups !== null) {
                    lateGroups = groups;
                    lateDecoded.clear();
                    scheduleApply();
                } else if (!warnedLate) {
                    warnedLate = true;
                    warn(`${LOG} a turret sound message was not understood, the game's own lock sounds stay`);
                }
            } else if (type === 'kasp:turret') {
                const { turret } = data as { turret?: unknown };
                if (typeof turret === 'string' && (turret === '' || TURRET_NAME.test(turret))) {
                    activeTurret = turret;
                    scheduleApply();
                }
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
            warn(`${LOG} could not find the user id class in this bundle, the battle's turret hook is skipped`);
            return null;
        }
        const property = text[1];
        const tail = new RegExp(`this\\.${property}=([\\w$]+)\\}`, 'g');
        const found = code.match(tail);
        if (found === null || found.length !== 1) {
            warn(`${LOG} could not find the user id constructor in this bundle, the battle's turret hook is skipped`);
            return null;
        }
        return code.replace(tail, (_whole, value: string) => `this.${property}=${value},window.__kaspSendUserId(this,"${property}")}`);
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
        const thrown = patchGrenadeThrow(result);
        if (thrown !== null) {
            result = thrown;
            hooked.push('grenade-sounds');
        }
        return { code: result, hooked };
    }

    function runScript(script: HTMLScriptElement): void {
        (document.head || document.documentElement).appendChild(script);
    }

    // Puts the game's bundle back after it was held back. Whatever fails, the game still gets its code: the fetched
    // copy unpatched when only the patch failed, or the original address when the download failed.
    async function loadBundle(src: string): Promise<void> {
        const script = document.createElement('script');
        try {
            const res = await fetch(src, { signal: AbortSignal.timeout(BUNDLE_TIMEOUT_MS) });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const original = await res.text();
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
