// Isolated-world content script. Works out the game's language and shares it with the other modules
// through window.kaspLanguage and the kasp:language-changed event. Ported from utils.getLang() in the
// Kaspersky extension (src/core/utils.ts); it stops at the first real answer or when the main menu appears, and
// has no timeout, because the game can take any time to load and a language change reloads the page.
(function () {
    'use strict';

    const LOG = '[KI-test][language]';
    const STORAGE_KEY = 'language_store_key';
    // The game fills <html lang> some time after start-up, so without an answer the check runs until the main menu is up.
    const MAIN_MENU_SELECTOR = '.MainScreenComponentStyle-blockMainMenu, .MainScreenComponentStyle-buttonPlay';
    const POLL_MS = 250;

    type Source = KaspLanguageChange['source'];

    interface MethodResult {
        readonly language: KaspLanguageCode | null;
        readonly note: string;
    }

    function describeError(e: unknown): string {
        return e instanceof Error ? e.message : String(e);
    }

    // "en-US" and "EN" are English; only the first part of the code counts.
    function fromCode(raw: string): KaspLanguageCode | null {
        const primary = raw.toLowerCase().split(/[-_]/)[0];
        if (primary === 'ru') return 'RU';
        if (primary === 'en') return 'EN';
        return null;
    }

    function readStorage(): MethodResult {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw === null) return { language: null, note: `key ${STORAGE_KEY} missing` };
            const language = fromCode(raw);
            return language === null ? { language: null, note: `"${raw}" is not ru or en` } : { language, note: `"${raw}"` };
        } catch (e) {
            return { language: null, note: `unreadable (${describeError(e)})` };
        }
    }

    function readHtml(): MethodResult {
        const raw = document.documentElement?.lang ?? '';
        if (raw === '') return { language: null, note: 'empty' };
        const language = fromCode(raw);
        return language === null ? { language: null, note: `"${raw}" is not ru or en` } : { language, note: `"${raw}"` };
    }

    function readHostname(): MethodResult {
        const host = window.location.hostname;
        return host.includes('ru.') ? { language: 'RU', note: `"${host}"` } : { language: null, note: `"${host}" has no "ru."` };
    }

    let currentLanguage: KaspLanguageCode = 'EN';
    let currentSource: Source = 'default';
    let lastReport = '';
    let settled = false;
    let pollTimer: number | undefined;

    function settle(reason: 'answer' | 'main menu'): void {
        if (settled) return;
        settled = true;
        window.clearInterval(pollTimer);
        console.log(`${LOG} settled on ${currentLanguage} from ${currentSource} (${reason})`);
    }

    function check(): void {
        if (settled) return;
        const methods: ReadonlyArray<readonly [Exclude<Source, 'default'>, MethodResult]> = [
            ['storage', readStorage()],
            ['html', readHtml()],
            ['hostname', readHostname()],
        ];
        const winner = methods.find(([, result]) => result.language !== null);
        const language: KaspLanguageCode = winner?.[1].language ?? 'EN';
        const source: Source = winner?.[0] ?? 'default';

        const parts = methods.map(([name, result]) => `${name}: ${result.language === null ? 'no answer' : result.language} (${result.note})`);
        const report = `${parts.join(' | ')} => ${language} from ${source}`;
        if (report !== lastReport) {
            lastReport = report;
            console.log(`${LOG} ${report}`);
        }

        if (language !== currentLanguage || source !== currentSource) {
            currentLanguage = language;
            currentSource = source;
            const detail: KaspLanguageChange = { language, source };
            window.dispatchEvent(new CustomEvent('kasp:language-changed', { detail }));
        }

        if (winner !== undefined) settle('answer');
        else if (document.querySelector(MAIN_MENU_SELECTOR) !== null) settle('main menu');
    }

    window.kaspLanguage = {
        get: () => currentLanguage,
        source: () => currentSource,
    };

    check();
    if (!settled) pollTimer = window.setInterval(check, POLL_MS);
})();
