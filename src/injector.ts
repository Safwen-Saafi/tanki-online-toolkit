// MAIN-world content script, the only one allowed to touch the page's own JavaScript. It holds back the game's main
// bundle, fetches it, adds one call to the constructor of three of the game's classes and one to a handler, and runs
// the patched copy. TankUserActionLog's call (window.__kaspSendAction) posts the strings of each equipment action,
// which is how change_counter.ts learns who changed equipment. TankDestroyActionLog's call (window.__kaspSendKill)
// posts each kill of the game's kill feed, which is how kill_sounds.ts learns who killed whom. BattleStatistics's call
// (window.__kaspSendBattleTime) posts the battle's time, which is how battle_music.ts knows the end is near. The
// handler's call (window.__kaspSendGrenadeThrow) posts each throw of the player's own grenade, for grenade_sounds.ts.
// A last, separate part wraps the page's own XMLHttpRequest, Response and decodeAudioData so that the game decodes the
// owner's file instead of some of its weapon sound files (kasp:sound-swap from magnum_sound.ts). Each hook is found
// and skipped on its own. When anything goes wrong the game's own bundle is run without the hook
// that failed (or unpatched), so the extension can lose a hook but never the game.
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

    // Called from inside the game's code, so it must never throw into it.
    window.__kaspSendGrenadeThrow = function (): void {
        try {
            const message: KaspGrenadeThrowMessage = { type: 'kasp:grenade-throw' };
            window.postMessage(message, window.location.origin);
        } catch {
            // a missed throw only means one missed sound
        }
    };

    // Replacing a weapon's sound. The game loads each weapon sound from an address like
    // /0/16723/73/217/31345722114416/sound.mp3 (four numbers that name the resource, then a version number) and decodes
    // the file with decodeAudioData. The address of each loaded file is remembered by the data object the loader produced
    // (the same object reaches decodeAudioData), and when the address holds a resource number from the list that
    // magnum_sound.ts sent, the game decodes the owner's file for that number (each file has its own numbers, so each
    // distance of a shot can have its own sound), or a silent one, instead. The game still plays the result where it
    // always played the sound. Until the list and the files arrive (kasp:sound-swap) nothing is touched.
    const SOUND_FILE = /\/sound\.(?:mp3|wav|ogg)(?:\?|$)/;
    const RESOURCE_NUMBER = /^\d+(?:\/\d+){1,5}$/;
    const MAX_SWAP_BYTES = 2 * 1024 * 1024;
    const MAX_SWAP_FILES = 10;
    const MAX_SWAP_NUMBERS = 50;
    const SILENCE_RATE = 8000;
    const SILENCE_SECONDS = 0.05;

    interface SoundReplacement {
        readonly data: ArrayBuffer;
        readonly numbers: readonly string[];
    }

    interface SoundSwap {
        readonly replacements: readonly SoundReplacement[];
        readonly silence: readonly string[];
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
        const { replacements, silence } = data as Partial<Record<'replacements' | 'silence', unknown>>;
        if (!Array.isArray(replacements) || replacements.length > MAX_SWAP_FILES || !isNumberList(silence)) return null;
        const read = replacements.map(readReplacement);
        const valid = read.filter((item): item is SoundReplacement => item !== null);
        if (valid.length !== read.length || valid.length + silence.length === 0) return null;
        return { replacements: valid, silence };
    }

    // A 16-bit mono WAV file with no sound in it, for a layer that must not play.
    function silentSound(): ArrayBuffer {
        const bytes = Math.round(SILENCE_RATE * SILENCE_SECONDS) * 2;
        const buffer = new ArrayBuffer(44 + bytes);
        const view = new DataView(buffer);
        const text = (offset: number, value: string): void => {
            for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
        };
        text(0, 'RIFF');
        view.setUint32(4, 36 + bytes, true);
        text(8, 'WAVE');
        text(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, SILENCE_RATE, true);
        view.setUint32(28, SILENCE_RATE * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        text(36, 'data');
        view.setUint32(40, bytes, true);
        return buffer;
    }

    // What decodeAudioData should be given instead of the game's data for this address, or null to leave it alone.
    function swappedData(address: string | undefined): ArrayBuffer | null {
        if (soundSwap === null || address === undefined) return null;
        // the first file that lists a matching number wins, and each decode gets its own copy
        for (const replacement of soundSwap.replacements) {
            if (replacement.numbers.some((number) => address.includes(`/${number}/`))) return replacement.data.slice(0);
        }
        if (soundSwap.silence.some((number) => address.includes(`/${number}/`))) return silentSound();
        return null;
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
                return originalDecode.call(this, source, success, failure);
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
        readonly call: '__kaspSendAction' | '__kaspSendKill' | '__kaspSendBattleTime';
        readonly label: string;
    }

    const HOOKS: readonly Hook[] = [
        { className: 'TankUserActionLog', call: '__kaspSendAction', label: 'change-counter' },
        { className: 'TankDestroyActionLog', call: '__kaspSendKill', label: 'kill-sounds' },
        { className: 'BattleStatistics', call: '__kaspSendBattleTime', label: 'battle-music' },
    ];

    // The code with the hook added to the class's constructor, or null when the bundle no longer looks the way the two
    // patterns expect. The first pattern finds the name of the property the game prints first in the class's text, which
    // names the constructor's first field; the second finds the constructor that assigns it.
    function patchClass(code: string, hook: Hook): string | null {
        const property = new RegExp(`return"${hook.className}\\(\\w+="\\+(?:\\w+\\()?this\\.(\\w+)`).exec(code);
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
    // dying or joining sends none, and other players' tanks have no such handler). The handler has no readable name, but
    // it sits just before the readable text of the data class ResetCooldownHudMessage, so the last handler of this
    // shape inside the 4000 characters before that text is the one:
    //   return Ex(n.j15g_1,Cx(0))>0&&ext(t,tR(),n.j15g_1),Lq
    // and the call in front of its last part becomes (window.__kaspSendGrenadeThrow(),ext(t,tR(),n.j15g_1)).
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
        const [whole, , , call] = last;
        const callAt = start + last.index + whole.length - call.length;
        return `${code.slice(0, callAt)}(window.__kaspSendGrenadeThrow(),${call})${code.slice(callAt + call.length)}`;
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
