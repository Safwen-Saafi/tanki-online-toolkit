// Isolated-world content script. Plays one sound each time the player throws a grenade. src/injector.ts posts a
// 'kasp:grenade-throw' message for each throw of the player's own grenade (the moment the game starts its reload), and
// this script plays extension/sounds/grenade-throw.mp3 from the start for it. The sound has its own audio element, so
// the kill sounds neither stop it nor are stopped by it. The sound of a kill with a grenade is a kill sound and lives in
// kill_sounds.ts.
(function () {
    'use strict';

    const LOG = '[KI-test][grenade_sounds]';
    const SOUND_FILE = 'sounds/grenade-throw.mp3';
    const SOUND_VOLUME = 0.8;
    const KILL_SWITCH_KEY = 'kasp_grenadesounds';

    // The user's own switch: only the exact value 0 turns the throw sound off, and the extension never writes it.
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

    const audio = new Audio(chrome.runtime.getURL(SOUND_FILE));
    audio.preload = 'auto';
    audio.volume = SOUND_VOLUME;
    let warnedPlay = false;

    function warnPlay(error: unknown): void {
        if (warnedPlay) return;
        warnedPlay = true;
        console.warn(LOG, `could not play ${SOUND_FILE}:`, error instanceof Error ? `${error.name}: ${error.message}` : error);
    }

    // A throw while the sound is still playing starts it again from the beginning.
    function playThrowSound(): void {
        try {
            audio.currentTime = 0;
            audio.play().catch(warnPlay);
        } catch (error: unknown) {
            warnPlay(error);
        }
    }

    function isThrowMessage(data: unknown): data is KaspGrenadeThrowMessage {
        return !!data && typeof data === 'object' && (data as { type?: unknown }).type === 'kasp:grenade-throw';
    }

    window.addEventListener('message', (e: MessageEvent) => {
        // The injector posts from the page to this same window; anything else is not ours.
        if (e.source !== window) return;
        if (isThrowMessage(e.data)) playThrowSound();
    });

    console.log(LOG, 'ready');
})();
