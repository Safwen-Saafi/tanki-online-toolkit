// Isolated-world content script. Plays one sound each time the player throws a grenade. src/injector.ts posts a
// 'kasp:grenade-throw' message for each throw of the player's own grenade (the moment the game starts its reload), and
// this script plays extension/sounds/grenade-throw.mp3 from the start for it (not for a repeat of the same reload, see
// isRepeatOfLastReload). The sound has its own audio element, so the kill sounds neither stop it nor are stopped by it.
// The sound of a kill with a grenade is a kill sound and lives in kill_sounds.ts.
(function () {
    'use strict';

    const LOG = '[KI-test][grenade_sounds]';
    const SOUND_FILE = 'sounds/grenade-throw.mp3';
    const SOUND_VOLUME = 0.8;
    const SWITCH_KEY = 'kasp_grenadesounds';

    // The user's switch, set in the extension's settings tab: read once at start and kept here, and the switch service
    // (src/modules/switches.ts) calls back with every change, so it applies at once with nothing read in between. The sound
    // is always loaded for that. Without the service the switch counts as on.
    let switchedOn = window.kaspSwitches?.isOn(SWITCH_KEY) ?? true;
    window.kaspSwitches?.onChange(SWITCH_KEY, (on) => {
        switchedOn = on;
    });

    const audio = new Audio(chrome.runtime.getURL(SOUND_FILE));
    audio.preload = 'auto';
    audio.volume = SOUND_VOLUME;
    let warnedPlay = false;

    function warnPlay(error: unknown): void {
        if (warnedPlay) return;
        warnedPlay = true;
        console.warn(LOG, `could not play ${SOUND_FILE}:`, error instanceof Error ? `${error.name}: ${error.message}` : error);
    }

    // A throw while the sound is still playing starts it again from the beginning. The throws are still followed with the
    // switch off (onThrow), so a repeat is still known for one when it is turned back on.
    function playThrowSound(): void {
        if (!switchedOn) return;
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

    // The game sends its reload event for a throw, with the full reload time, and again with the time that is left
    // whenever it adds the grenade to the battle again during a reload (a respawn does: the counter goes on while the
    // player is dead, and the event comes at the respawn with the time that is left). A throw is impossible while the
    // grenade reloads, so an event that comes in the middle of the last throw's reload, with about the time that is left
    // of it, is such a repeat and is not a throw.
    const REPEAT_TOLERANCE_MS = 1500;
    let lastThrowAt = 0;
    let lastReloadMs = 0;

    function isRepeatOfLastReload(reloadMs: number, now: number): boolean {
        if (reloadMs <= 0 || lastReloadMs <= 0) return false;
        const elapsed = now - lastThrowAt;
        return elapsed < lastReloadMs && Math.abs(reloadMs - (lastReloadMs - elapsed)) < REPEAT_TOLERANCE_MS;
    }

    function onThrow(reloadMs: unknown): void {
        const now = Date.now();
        const reload = typeof reloadMs === 'number' && Number.isFinite(reloadMs) ? reloadMs : 0;
        if (isRepeatOfLastReload(reload, now)) return;
        lastThrowAt = now;
        lastReloadMs = reload;
        playThrowSound();
    }

    window.kaspMessages?.on('kasp:grenade-throw', (data) => {
        if (isThrowMessage(data)) onThrow(data.reloadMs);
    });

    console.log(LOG, 'ready');
})();
