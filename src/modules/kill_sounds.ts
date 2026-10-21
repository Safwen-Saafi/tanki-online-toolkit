// Isolated-world content script. Receives the game's kill feed from src/injector.ts as 'kasp:kill' messages, keeps the
// player's own kill streak and death streak for the current battle, finds multi-kills (several kills inside one short
// time window) and picks the sound for each of the player's own kills and deaths. The player's id is learned once and
// kept; the counters live in sessionStorage, so a page reload in the middle of a battle does not lose them, and are
// cleared when the battle ends.
(function () {
    'use strict';

    const LOG = '[KI-test][kill_sounds]';
    const STATE_KEY = 'kasp_kill_state';
    const OWN_KEY = 'kasp_own_player';
    const BATTLE_CANVAS_SELECTOR = '.BattleComponentStyle-canvasContainer';
    // The player's own name in the HUD, written as "[CLAN] nickname" or just "nickname".
    const OWN_NAME_SELECTOR = '.UserInfoContainerStyle-userNameRank';
    const CHECK_MS = 500;
    // A multi-kill is the number of the player's kills inside one window that opens at the first of them: kills that
    // arrive within this time after it belong to it, and the next kill after the window opens a new one.
    const MULTI_KILL_WINDOW_MS = 500;

    // Which counts have a sound, and the file of each, is data (extension/data/killsounds.json); the files are in
    // extension/sounds/. A count without a file is silent.
    const CONFIG_PATH = 'data/killsounds.json';
    const SOUNDS_DIR = 'sounds/';
    const KILL_SWITCH_KEY = 'kasp_killsounds';
    const SOUND_VOLUME = 0.8;
    const SAFE_FILE_NAME = /^[\w-]+(?:\.[\w-]+)*\.(?:mp3|ogg|wav)$/i;

    type OwnEvent = 'kill' | 'death';
    // 'first' is the sound of the player's first kill of the battle, kept under the count 1.
    type SoundKind = 'multi' | 'streak' | 'death' | 'first';
    // The files of one kind of sound, by the count they play for.
    type SoundTable = ReadonlyMap<number, string>;

    interface SoundKey {
        readonly kind: SoundKind;
        readonly count: number;
    }

    // The kill streak (kills since the last death), the death streak (deaths since the last kill) and every kill of
    // the battle so far, which only the first kill of the battle needs.
    interface KillState {
        readonly kills: number;
        readonly deaths: number;
        readonly battleKills: number;
    }

    // The player as the kill feed names them. The id never changes for an account; the nickname is kept only to notice
    // that the account (or its name) is not the one the id was learned for.
    interface OwnPlayer {
        readonly uid: string;
        readonly userId: string;
    }

    const FRESH_STATE: KillState = { kills: 0, deaths: 0, battleKills: 0 };
    const NO_SOUNDS: Readonly<Record<SoundKind, SoundTable>> = { multi: new Map(), streak: new Map(), death: new Map(), first: new Map() };
    let sounds = NO_SOUNDS;

    function isCount(value: unknown): value is number {
        return typeof value === 'number' && Number.isInteger(value) && value >= 0;
    }

    function readState(): KillState {
        try {
            const parsed: unknown = JSON.parse(sessionStorage.getItem(STATE_KEY) ?? 'null');
            if (!parsed || typeof parsed !== 'object') return FRESH_STATE;
            const value = parsed as Partial<Record<keyof KillState, unknown>>;
            // A state saved before battleKills existed counts its kill streak as the battle's kills.
            if (isCount(value.kills) && isCount(value.deaths)) {
                return { kills: value.kills, deaths: value.deaths, battleKills: isCount(value.battleKills) ? value.battleKills : value.kills };
            }
        } catch {
            // unreadable storage or a broken value: start from nothing
        }
        return FRESH_STATE;
    }

    function writeState(state: KillState): void {
        try {
            sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
        } catch {
            // blocked or full storage only costs the streaks surviving a reload
        }
    }

    function clearState(): void {
        try {
            sessionStorage.removeItem(STATE_KEY);
        } catch {
            // nothing stored, nothing to clear
        }
    }

    function readOwn(): OwnPlayer | null {
        try {
            const parsed: unknown = JSON.parse(localStorage.getItem(OWN_KEY) ?? 'null');
            if (!parsed || typeof parsed !== 'object') return null;
            const value = parsed as Partial<Record<keyof OwnPlayer, unknown>>;
            if (typeof value.uid === 'string' && value.uid !== '' && typeof value.userId === 'string' && /^-?\d+$/.test(value.userId)) {
                return { uid: value.uid, userId: value.userId };
            }
        } catch {
            // unreadable storage or a broken value: learn the id again
        }
        return null;
    }

    function writeOwn(own: OwnPlayer): void {
        try {
            localStorage.setItem(OWN_KEY, JSON.stringify(own));
        } catch {
            // blocked storage only costs learning the id again next time
        }
    }

    function clearOwn(): void {
        try {
            localStorage.removeItem(OWN_KEY);
        } catch {
            // nothing stored, nothing to clear
        }
    }

    // The largest count in the table that is not above the real count, or null. A group bigger than the top sound
    // plays the top sound.
    function highestTier(table: SoundTable, count: number): number | null {
        let found: number | null = null;
        for (const tier of table.keys()) {
            if (tier <= count && (found === null || tier > found)) found = tier;
        }
        return found;
    }

    // The new counters for one of the player's own events, and the sound when it has one at once. A kill adds one to the
    // kill streak and ends the death streak; its sound waits for the multi-kill window to close. A death ends the kill
    // streak and adds one to the death streak, and has its sound at once.
    function applyOwnEvent(state: KillState, event: OwnEvent): { readonly state: KillState; readonly sound: SoundKey | null } {
        if (event === 'kill') return { state: { kills: state.kills + 1, deaths: 0, battleKills: state.battleKills + 1 }, sound: null };
        const next: KillState = { kills: 0, deaths: state.deaths + 1, battleKills: state.battleKills };
        const death = highestTier(sounds.death, next.deaths);
        return { state: next, sound: death === null ? null : { kind: 'death', count: death } };
    }

    function isPlayer(value: unknown): value is KaspKillPlayer {
        if (!value || typeof value !== 'object') return false;
        const player = value as Partial<Record<keyof KaspKillPlayer, unknown>>;
        return (
            typeof player.userId === 'string' &&
            typeof player.uid === 'string' &&
            (player.clanTag === null || typeof player.clanTag === 'string') &&
            typeof player.teamRelation === 'string'
        );
    }

    function isKillMessage(data: unknown): data is KaspKillMessage {
        if (!data || typeof data !== 'object' || (data as { type?: unknown }).type !== 'kasp:kill') return false;
        const detail = (data as { detail?: unknown }).detail;
        if (!detail || typeof detail !== 'object') return false;
        const event = detail as Partial<Record<keyof KaspKillEvent, unknown>>;
        return (
            isPlayer(event.killer) &&
            isPlayer(event.victim) &&
            typeof event.damageType === 'string' &&
            typeof event.critical === 'boolean' &&
            typeof event.kind === 'string'
        );
    }

    // The HUD text without the clan tag, or null when it is not on screen.
    function readOwnName(): string | null {
        const text = document.querySelector(OWN_NAME_SELECTOR)?.textContent;
        if (!text) return null;
        const name = text.replace(/^\s*\[[^\]]*\]\s*/, '').trim();
        return name === '' ? null : name;
    }

    // The file list read as the three tables. An entry that is not a whole count of 1 or more with a plain audio file
    // name (or is null) is left out, so a mistake in the file costs one sound, not the rest.
    function parseSoundTables(value: unknown): Readonly<Record<SoundKind, SoundTable>> | null {
        if (!value || typeof value !== 'object') return null;
        const config = value as Partial<Record<SoundKind, unknown>>;
        const tables: Record<SoundKind, Map<number, string>> = { multi: new Map(), streak: new Map(), death: new Map(), first: new Map() };
        for (const kind of ['multi', 'streak', 'death', 'first'] as const) {
            const entries = config[kind];
            if (entries === undefined) continue;
            if (!entries || typeof entries !== 'object') return null;
            for (const [key, file] of Object.entries(entries)) {
                const count = Number(key);
                if (!Number.isInteger(count) || count < 1 || typeof file !== 'string' || !SAFE_FILE_NAME.test(file)) continue;
                tables[kind].set(count, file);
            }
        }
        return tables;
    }

    const audioByFile = new Map<string, HTMLAudioElement>();
    let playing: HTMLAudioElement | null = null;
    let warnedPlay = false;

    // One audio element per file, made when the list is loaded so the file is ready when it is needed.
    function audioFor(file: string): HTMLAudioElement {
        let audio = audioByFile.get(file);
        if (audio === undefined) {
            audio = new Audio(chrome.runtime.getURL(SOUNDS_DIR + file));
            audio.preload = 'auto';
            audio.volume = SOUND_VOLUME;
            audioByFile.set(file, audio);
        }
        return audio;
    }

    function warnPlay(file: string, error: unknown): void {
        if (warnedPlay) return;
        warnedPlay = true;
        console.warn(LOG, `could not play ${file}:`, error instanceof Error ? `${error.name}: ${error.message}` : error);
    }

    // One sound at a time: a new sound stops the one still playing.
    function playSound(sound: SoundKey): void {
        const file = sounds[sound.kind].get(sound.count);
        if (file === undefined) return;
        try {
            playing?.pause();
            const audio = audioFor(file);
            audio.currentTime = 0;
            playing = audio;
            audio.play().catch((error: unknown) => warnPlay(file, error));
        } catch (error: unknown) {
            warnPlay(file, error);
        }
    }

    async function loadSounds(): Promise<void> {
        try {
            const response = await fetch(chrome.runtime.getURL(CONFIG_PATH));
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data: unknown = await response.json();
            const tables = parseSoundTables(data);
            if (tables === null) throw new Error('not a sounds list');
            sounds = tables;
            for (const table of Object.values(tables)) {
                for (const file of table.values()) audioFor(file);
            }
            console.log(LOG, `ready: ${audioByFile.size} sound files`);
        } catch (error: unknown) {
            console.warn(LOG, 'could not load the sounds list, no sound will play:', error instanceof Error ? error.message : error);
        }
    }

    let state: KillState = readState();
    let own: OwnPlayer | null = readOwn();
    let nameChecked = false;
    let inBattle = false;

    // The id is learned from the first event that names the player, found by the HUD name, and then kept for good.
    function ownEventOf(event: KaspKillEvent): OwnEvent | null {
        if (event.kind !== 'KILL') return null;
        if (own === null) {
            const name = readOwnName();
            const mine = name === null ? undefined : [event.killer, event.victim].find((player) => player.uid === name);
            if (mine === undefined) return null;
            own = { uid: mine.uid, userId: mine.userId };
            writeOwn(own);
            console.log(LOG, `learned the player id for ${own.uid}: ${own.userId}`);
        }
        const killed = event.killer.userId === own.userId;
        const died = event.victim.userId === own.userId;
        // Neither: other players. Both: a kill of oneself, which is not counted.
        if (killed === died) return null;
        return killed ? 'kill' : 'death';
    }

    // The player's kills inside the multi-kill window that is open now. The window opens at the first of them and closes
    // MULTI_KILL_WINDOW_MS later; its sound is chosen then, from the number of kills it caught, so a triple plays only
    // the triple and never the double before it. The window that holds the battle's first kill is marked, because that
    // kill has a sound of its own.
    let multiCount = 0;
    let multiHasFirstKill = false;
    let multiTimer: number | undefined;

    function closeMultiWindow(): void {
        const count = multiCount;
        const hasFirstKill = multiHasFirstKill;
        multiCount = 0;
        multiHasFirstKill = false;
        multiTimer = undefined;
        // A multi-kill sound always wins. Without one, the battle's first kill plays its own sound, and otherwise a
        // single kill that reaches a kill streak milestone plays the streak sound.
        const multi = highestTier(sounds.multi, count);
        let sound: SoundKey | null = multi === null ? null : { kind: 'multi', count: multi };
        if (sound === null && hasFirstKill && sounds.first.has(1)) sound = { kind: 'first', count: 1 };
        if (sound === null && sounds.streak.has(state.kills)) sound = { kind: 'streak', count: state.kills };
        console.log(LOG, `multi-kill window closed: ${count} kill${count === 1 ? '' : 's'}, kill streak ${state.kills}`, sound === null ? 'no sound' : `sound ${sound.kind}:${sound.count}`);
        if (sound !== null) playSound(sound);
    }

    function resetMultiWindow(): void {
        if (multiTimer !== undefined) clearTimeout(multiTimer);
        multiTimer = undefined;
        multiCount = 0;
        multiHasFirstKill = false;
    }

    function handleOwnEvent(event: OwnEvent, detail: string): void {
        const firstOfBattle = event === 'kill' && state.battleKills === 0;
        const result = applyOwnEvent(state, event);
        state = result.state;
        writeState(state);
        console.log(LOG, `${event} (${detail}): kill streak ${state.kills}, death streak ${state.deaths}${firstOfBattle ? ', first kill of the battle' : ''}`);
        if (event === 'kill') {
            multiCount++;
            if (firstOfBattle) multiHasFirstKill = true;
            if (multiTimer === undefined) multiTimer = setTimeout(closeMultiWindow, MULTI_KILL_WINDOW_MS);
        } else if (result.sound !== null) {
            console.log(LOG, `sound ${result.sound.kind}:${result.sound.count}`);
            playSound(result.sound);
        }
    }

    // The user's own switch: only the exact value 0 turns the kill sounds off, and the extension never writes it.
    function isSwitchedOff(): boolean {
        try {
            return localStorage.getItem(KILL_SWITCH_KEY) === '0';
        } catch {
            return false;
        }
    }

    if (isSwitchedOff()) {
        console.log(LOG, 'disabled');
        return;
    }
    void loadSounds();

    window.addEventListener('message', (e: MessageEvent) => {
        // The injector posts from the page to this same window; anything else is not ours.
        if (e.source !== window) return;
        const data: unknown = e.data;
        if (!isKillMessage(data)) return;
        const mine = ownEventOf(data.detail);
        if (mine !== null) handleOwnEvent(mine, `${data.detail.killer.uid} -> ${data.detail.victim.uid}, ${data.detail.damageType}`);
    });

    // The first time the HUD name can be read, it must agree with the saved id's nickname; if it does not, the account
    // (or its name) changed and the id is learned again from the next event.
    function checkOwnName(): void {
        if (nameChecked) return;
        const name = readOwnName();
        if (name === null) return;
        nameChecked = true;
        if (own !== null && own.uid !== name) {
            own = null;
            clearOwn();
        }
    }

    // The battle canvas only exists while a battle is on screen; leaving it ends the battle's counters.
    function checkBattle(): void {
        checkOwnName();
        const now = document.querySelector(BATTLE_CANVAS_SELECTOR) !== null;
        if (now === inBattle) return;
        inBattle = now;
        if (!inBattle) {
            state = FRESH_STATE;
            resetMultiWindow();
            clearState();
        }
    }

    setInterval(checkBattle, CHECK_MS);
})();
