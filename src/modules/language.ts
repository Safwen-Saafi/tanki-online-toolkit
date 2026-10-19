// Isolated-world content script. Works out the game's language and shares it with the other modules through
// window.kaspLanguage: get() is the language so far (EN until one is found) and whenKnown resolves once, when it
// settles. Ported from utils.getLang() in the Kaspersky extension (src/core/utils.ts). It stops at
// the first real answer or when the main menu appears, and has no timeout, because the game can take any time to
// load and a language change reloads the page.
(function () {
    'use strict';

    const LOG = '[KI-test][language]';
    const STORAGE_KEY = 'language_store_key';
    // The game fills <html lang> some time after start-up, so without an answer the check runs until the main menu is up.
    const MAIN_MENU_SELECTOR = '.MainScreenComponentStyle-blockMainMenu, .MainScreenComponentStyle-buttonPlay';
    const POLL_MS = 250;

    type Source = 'storage' | 'html' | 'hostname' | 'default';

    // "en-US" and "EN" are English; only the first part of the code counts.
    function fromCode(raw: string): KaspLanguageCode | null {
        const primary = raw.toLowerCase().split(/[-_]/)[0];
        if (primary === 'ru') return 'RU';
        if (primary === 'en') return 'EN';
        return null;
    }

    function readStorage(): KaspLanguageCode | null {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw === null ? null : fromCode(raw);
        } catch {
            // blocked storage falls through to the next source
            return null;
        }
    }

    function readHtml(): KaspLanguageCode | null {
        return fromCode(document.documentElement?.lang ?? '');
    }

    function readHostname(): KaspLanguageCode | null {
        return window.location.hostname.includes('ru.') ? 'RU' : null;
    }

    const SOURCES: ReadonlyArray<readonly [Exclude<Source, 'default'>, () => KaspLanguageCode | null]> = [
        ['storage', readStorage],
        ['html', readHtml],
        ['hostname', readHostname],
    ];

    let currentLanguage: KaspLanguageCode = 'EN';
    let settled = false;
    let pollTimer: number | undefined;
    // A language change reloads the page, so the language never changes after it settles and one promise is enough.
    let resolveKnown: (language: KaspLanguageCode) => void = () => {};
    const whenKnown = new Promise<KaspLanguageCode>((resolve) => {
        resolveKnown = resolve;
    });

    function settle(source: Source): void {
        settled = true;
        window.clearInterval(pollTimer);
        resolveKnown(currentLanguage);
        console.log(`${LOG} ${currentLanguage} (${source})`);
    }

    function check(): void {
        if (settled) return;
        for (const [source, read] of SOURCES) {
            const language = read();
            if (language === null) continue;
            currentLanguage = language;
            settle(source);
            return;
        }
        if (document.querySelector(MAIN_MENU_SELECTOR) !== null) settle('default');
    }

    window.kaspLanguage = { get: () => currentLanguage, whenKnown };

    check();
    if (!settled) pollTimer = window.setInterval(check, POLL_MS);
})();
