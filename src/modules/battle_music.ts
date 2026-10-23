// Isolated-world content script. Plays a music file once in the last 50 seconds of a battle and stops it when the battle
// ends. The game sends the time left only once, when the player joins (src/injector.ts posts it as 'kasp:battle-time'),
// so this script works out when the battle ends from that moment and counts down by itself. The one flag it keeps, that
// the music already started in this battle, is in sessionStorage so a page reload in the last 50 seconds does not start
// it again. The music is one loop of 8 bars that ends where it begins (extension/sounds/battle-end.flac, lossless so it has
// no padding), decoded once and played from memory with loop = true, which repeats it sample for sample; an audio element
// leaves a small gap at every restart, so it is only the fallback when the sound cannot be decoded.
(function () {
    'use strict';

    const LOG = '[KI-test][battle_music]';
    const STATE_KEY = 'kasp_battle_music';
    const SWITCH_KEY = 'kasp_battlemusic';
    const BATTLE_CANVAS_SELECTOR = '.BattleComponentStyle-canvasContainer';
    const MUSIC_FILE = 'sounds/battle-end.flac';
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
    // The music decoded in memory, and what plays it. The fallback audio element is made only when the decoding fails.
    let context: AudioContext | null = null;
    let buffer: AudioBuffer | null = null;
    let loading: Promise<void> | null = null;
    let source: AudioBufferSourceNode | null = null;
    let gain: GainNode | null = null;
    let fallback: HTMLAudioElement | null = null;
    let warnedPlay = false;

    function warnPlay(error: unknown): void {
        if (warnedPlay) return;
        warnedPlay = true;
        console.warn(LOG, `could not play ${MUSIC_FILE}:`, error instanceof Error ? `${error.name}: ${error.message}` : error);
    }

    // Fetches and decodes the file once, as soon as a battle is known, so the music starts at once when it is time. A failure
    // is remembered (buffer stays null) and the audio element is used instead.
    function loadMusic(): Promise<void> {
        if (loading === null) {
            loading = (async () => {
                try {
                    const response = await fetch(chrome.runtime.getURL(MUSIC_FILE));
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    const data = await response.arrayBuffer();
                    context = new AudioContext();
                    buffer = await context.decodeAudioData(data);
                } catch (error: unknown) {
                    buffer = null;
                    warnPlay(error);
                }
            })();
        }
        return loading;
    }

    function fallbackElement(): HTMLAudioElement {
        if (fallback === null) {
            fallback = new Audio(chrome.runtime.getURL(MUSIC_FILE));
            fallback.preload = 'auto';
            fallback.volume = MUSIC_VOLUME;
            fallback.loop = true;
        }
        return fallback;
    }

    async function playMusic(): Promise<void> {
        await loadMusic();
        if (!playing) return;                           // stopped while the file was loading
        if (buffer !== null && context !== null) {
            // The page was clicked to join the battle, so the context may run; if it is suspended it starts when it can.
            context.resume().catch(warnPlay);
            const node = context.createBufferSource();
            node.buffer = buffer;
            node.loop = true;
            const volume = context.createGain();
            volume.gain.value = MUSIC_VOLUME;
            node.connect(volume);
            volume.connect(context.destination);
            node.start();
            source = node;
            gain = volume;
            return;
        }
        const audio = fallbackElement();
        audio.currentTime = 0;
        await audio.play();
    }

    function startMusic(): void {
        started = true;
        writeStarted(true);
        playing = true;
        playMusic().catch((error: unknown) => {
            playing = false;
            warnPlay(error);
        });
    }

    function stopMusic(): void {
        playing = false;
        try {
            source?.stop();
            source?.disconnect();
            gain?.disconnect();
        } catch {
            // nothing to stop
        }
        source = null;
        gain = null;
        try {
            fallback?.pause();
            if (fallback !== null) fallback.currentTime = 0;
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
            void loadMusic();
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
