// Isolated-world content script for the player's own screen pictures (build-plan 23). The game has three backgrounds the player can
// change, each reached by the game's own named style class, never by a number or the seasonal address:
//   - the picture-and-tips screen shown when a battle loads: its picture layer is .ApplicationLoaderComponentStyle-container.-background
//     (the logo, ring, tip, "Next hint" and bottom fade sit in another layer above it and stay the game's);
//   - the plain gradient screen shown during lobby screen changes: .LobbyLoaderComponentStyle-container, and the play page's own
//     first loading screen, #preloader, which looks the same;
//   - the entrance frame, .-entranceBackground (a class of a style object with no name): the forest picture behind "Press any button to
//     start" and behind the login and sign-up screens, which use the same frame (seen live and read in the game's code, 2026-11-12:
//     the game has only those two users of it). Its dark top fade, a layer inside it, stays.
// At document_start this script reads the three saved pictures once and writes one style element of its own with the rules for the
// pictures that are set. Nothing watches the page and nothing is rewritten while playing: a new or removed picture applies at the
// next start (the settings tab reloads the game when settings close). It also publishes window.kaspLoadingScreens for the settings
// tab, which makes the picture from the player's file with fromFile and checks a saved value with isPicture.
(function () {
    'use strict';

    const LOG = '[KI-test][loading-screens]';
    // The saved pictures (src/modules/settings_tab.ts has the same two keys; change both together). Each is an image data: address,
    // no key meaning the game's own screen. The page's security policy allows data: pictures but not blob: ones.
    const BATTLE_KEY = 'kasp_loadpic_battle';
    const PLAIN_KEY = 'kasp_loadpic_plain';
    const START_KEY = 'kasp_loadpic_start';
    const STYLE_ID = 'kasp-loading-screens';

    // A picture is at most this long as text (about 900 KB of image); the file picked may be up to MAX_FILE_BYTES.
    const MAX_TEXT_LENGTH = 1_200_000;
    // A saved value from elsewhere (an older version, a hand edit) may be a little longer; past this it is not read at all.
    const MAX_READ_LENGTH = 2_000_000;
    const MAX_FILE_BYTES = 25 * 1024 * 1024;
    const MAX_SIDE = 1920;
    const QUALITIES: readonly number[] = [0.85, 0.7, 0.5];
    // Only characters that cannot end a url("...") early or add a rule: the data: address of an image in base64.
    const PICTURE_ADDRESS = /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/;

    function isPicture(value: string | null): value is string {
        return value !== null && value.length <= MAX_READ_LENGTH && PICTURE_ADDRESS.test(value);
    }

    // The picture fills the screen, its edges cropped. !important, because the game's own rules also set a background.
    function rule(selector: string, picture: string): string {
        return `${selector} { background: url("${picture}") center / cover no-repeat !important; }`;
    }

    function start(): void {
        const battle = window.kaspSwitches?.getChoice(BATTLE_KEY) ?? null;
        const plain = window.kaspSwitches?.getChoice(PLAIN_KEY) ?? null;
        const entrance = window.kaspSwitches?.getChoice(START_KEY) ?? null;
        const rules: string[] = [];
        if (isPicture(battle)) rules.push(rule('.ApplicationLoaderComponentStyle-container.-background', battle));
        if (isPicture(plain)) rules.push(rule('.LobbyLoaderComponentStyle-container, #preloader', plain));
        if (isPicture(entrance)) rules.push(rule('.-entranceBackground', entrance));
        if (rules.length === 0) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = rules.join('\n');
        document.documentElement.appendChild(style);
    }

    // The player's file as a saved picture: shrunk so its long side is at most MAX_SIDE (never enlarged), made into a WebP address,
    // and made again at a lower quality while it is over MAX_TEXT_LENGTH. "notImage": the browser cannot open the file. "tooBig":
    // the file is over MAX_FILE_BYTES, or the picture is still too long as text at the lowest quality.
    async function fromFile(file: Blob): Promise<KaspLoadingPicture> {
        if (file.size > MAX_FILE_BYTES) return { ok: false, reason: 'tooBig' };
        let bitmap: ImageBitmap;
        try {
            bitmap = await createImageBitmap(file);
        } catch {
            return { ok: false, reason: 'notImage' };
        }
        try {
            const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            const context = canvas.getContext('2d');
            if (context === null) return { ok: false, reason: 'notImage' };
            context.imageSmoothingQuality = 'high';
            context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            for (const quality of QUALITIES) {
                const value = canvas.toDataURL('image/webp', quality);
                // A browser that cannot make WebP gives a PNG, which is not what this is for.
                if (!value.startsWith('data:image/webp;base64,')) return { ok: false, reason: 'notImage' };
                if (value.length <= MAX_TEXT_LENGTH) return { ok: true, value };
            }
            return { ok: false, reason: 'tooBig' };
        } catch (error: unknown) {
            console.warn(`${LOG} could not make the picture:`, error instanceof Error ? error.message : error);
            return { ok: false, reason: 'notImage' };
        } finally {
            bitmap.close();
        }
    }

    start();
    window.kaspLoadingScreens = { fromFile, isPicture };
})();
