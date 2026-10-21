// Isolated-world content script. Plays a music file once in the last 50 seconds of a battle and stops it when the battle
// ends. The game sends the time left only once, when the player joins (src/injector.ts posts it as 'kasp:battle-time'),
// so this script works out when the battle ends from that moment and counts down by itself. The one flag it keeps, that
// the music already started in this battle, is in sessionStorage so a page reload in the last 50 seconds does not start
// it again.
(function () {
    'use strict';

    const LOG = '[KI-test][battle_music]';
    const STATE_KEY = 'kasp_battle_music';
    const SWITCH_KEY = 'kasp_battlemusic';
    const BATTLE_CANVAS_SELECTOR = '.BattleComponentStyle-canvasContainer';
    const MUSIC_FILE = 'sounds/battle-end.mp3';
    const END_MUSIC_SECONDS = 50;
    const MUSIC_VOLUME = 0.7;
    const CHECK_MS = 500;
    // If the game's end message never comes, the music is stopped this long after the calculated end of the battle.
    const END_GRACE_MS = 10000;

    function isBattleTimeMessage(data: unknown): data is KaspBattleTimeMessage {
        if (!data || typeof data !== 'object' || (data as { type?: unknown }).type !== 'kasp:battle-time') return false;
        const detail = (data as { detail?: unknown }).detail;
        if (!detail || typeof detail !== 'object') return false;
        const value = detail as Partial<Record<keyof KaspBattleTimeMessage['detail'], unknown>>;
        return typeof value.remaining === 'number' && typeof value.roundStarted === 'boolean' && typeof value.battleLoaded === 'boolean';
    }

    function readStarted(): boolean {
        try {
            const parsed: unknown = JSON.parse(sessionStorage.getItem(STATE_KEY) ?? 'null');
            return !!parsed && typeof parsed === 'object' && (parsed as { started?: unknown }).started === true;
        } catch {
            return false;
        }
    }

    function writeStarted(started: boolean): void {
        try {
            if (started) sessionStorage.setItem(STATE_KEY, JSON.stringify({ started: true }));
            else sessionStorage.removeItem(STATE_KEY);
        } catch {
            // blocked storage only costs the music not being kept from starting again after a reload
        }
    }

    // The user's own switch: only the exact value 0 turns the music off, and the extension never writes it.
    function isSwitchedOff(): boolean {
        try {
            return localStorage.getItem(SWITCH_KEY) === '0';
        } catch {
            return false;
        }
    }

    if (isSwitchedOff()) {
        console.log(LOG, 'disabled');
        return;
    }

    // When the battle ends (epoch ms), worked out from the time left when it arrived, or null when no battle is running.
    let endAt: number | null = null;
    // The time left of the last message that set endAt. The game's later copies of its battle data carry the same
    // number, which is not a new count down, so only a different number sets endAt again.
    let lastRemaining: number | null = null;
    let started = readStarted();
    let playing = false;
    let inBattle = false;
    let music: HTMLAudioElement | null = null;
    let warnedPlay = false;

    function musicElement(): HTMLAudioElement {
        if (music === null) {
            music = new Audio(chrome.runtime.getURL(MUSIC_FILE));
            music.preload = 'auto';
            music.volume = MUSIC_VOLUME;
            // The file is shorter than the last 50 seconds, so it repeats until the battle ends.
            music.loop = true;
            music.addEventListener('ended', () => {
                playing = false;
            });
        }
        return music;
    }

    function warnPlay(error: unknown): void {
        if (warnedPlay) return;
        warnedPlay = true;
        console.warn(LOG, `could not play ${MUSIC_FILE}:`, error instanceof Error ? `${error.name}: ${error.message}` : error);
    }

    function startMusic(): void {
        started = true;
        writeStarted(true);
        try {
            const audio = musicElement();
            audio.currentTime = 0;
            playing = true;
            audio.play().catch((error: unknown) => {
                playing = false;
                warnPlay(error);
            });
        } catch (error: unknown) {
            playing = false;
            warnPlay(error);
        }
    }

    function stopMusic(): void {
        playing = false;
        try {
            music?.pause();
            if (music !== null) music.currentTime = 0;
        } catch {
            // nothing to stop
        }
    }

    // The battle is over (it ended, or the player left): no music, and the next battle starts from nothing.
    function endBattle(): void {
        stopMusic();
        endAt = null;
        lastRemaining = null;
        started = false;
        writeStarted(false);
    }

    function onBattleTime(detail: KaspBattleTimeMessage['detail']): void {
        if (!detail.battleLoaded || !detail.roundStarted) {
            // Only a battle that was running can end; the first copies of a joining or reloading page say "not started".
            if (endAt !== null) endBattle();
            return;
        }
        if (detail.remaining >= 0 && detail.remaining !== lastRemaining) {
            lastRemaining = detail.remaining;
            endAt = Date.now() + detail.remaining * 1000;
            musicElement();
        }
    }

    window.addEventListener('message', (e: MessageEvent) => {
        // The injector posts from the page to this same window; anything else is not ours.
        if (e.source !== window) return;
        const data: unknown = e.data;
        if (isBattleTimeMessage(data)) onBattleTime(data.detail);
    });

    function check(): void {
        const onScreen = document.querySelector(BATTLE_CANVAS_SELECTOR) !== null;
        if (onScreen !== inBattle) {
            inBattle = onScreen;
            if (!inBattle) endBattle();
        }
        if (endAt === null) return;
        const left = (endAt - Date.now()) / 1000;
        if (!started && left > 0 && left <= END_MUSIC_SECONDS) startMusic();
        else if (playing && left * 1000 < -END_GRACE_MS) stopMusic();
    }

    setInterval(check, CHECK_MS);
})();
