// Isolated-world content script (build-plan feature 9). Loads the augment data that the Augments bot
// publishes on GitHub Pages. This file grows over three slices: 9a loads and caches the data, 9b finds
// the turret and augment on screen, 9c shows the hover box.
(function () {
    'use strict';

    const LOG = '[KI-test][augments]';
    const BASE_URL = 'https://safwen-saafi.github.io/tanki-online-toolkit/';
    const FILE_NAMES = { EN: 'augments.en.json', RU: 'augments.ru.json' } as const;
    const CACHE_KEY = 'kasp_augments_cache';
    const KILL_SWITCH_KEY = 'kasp_augments';
    // The bot publishes once a day, so asking more often than this only costs requests.
    const FRESH_MS = 6 * 60 * 60 * 1000;

    type Language = keyof typeof FILE_NAMES;
    const LANGUAGES: readonly Language[] = ['EN', 'RU'];

    interface CacheEntry {
        readonly fetchedAt: number;
        readonly file: AugmentsFile;
    }
    type AugmentsCache = Partial<Record<Language, CacheEntry>>;

    const loaded: Partial<Record<Language, AugmentsFile>> = {};

    function isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    function describeError(e: unknown): string {
        return e instanceof Error ? e.message : String(e);
    }

    function isStringArray(value: unknown): value is string[] {
        return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
    }

    const RARITY_PATTERN = /^[a-z]{1,20}$/;

    function readAugment(value: unknown): Augment | null {
        if (!isRecord(value) || typeof value['name'] !== 'string') return null;
        const advantages = value['advantages'];
        const disadvantages = value['disadvantages'];
        if (!isStringArray(advantages) || !isStringArray(disadvantages)) return null;
        const rarity = value['rarity'];
        return {
            name: value['name'],
            advantages,
            disadvantages,
            rarity: typeof rarity === 'string' && RARITY_PATTERN.test(rarity) ? rarity : null,
        };
    }

    // Turns untrusted JSON (from the network or the cache) into an AugmentsFile, or null when it is not one for this language.
    function parseAugmentsFile(value: unknown, language: Language): AugmentsFile | null {
        if (!isRecord(value)) return null;
        const schemaVersion = value['schemaVersion'];
        if ((schemaVersion !== 1 && schemaVersion !== 2) || value['language'] !== language) return null;
        const generatedAt = value['generatedAt'];
        const rawItems = value['items'];
        if (typeof generatedAt !== 'string' || !isRecord(rawItems)) return null;

        const items: Record<string, Record<string, Augment>> = {};
        for (const [item, rawAugments] of Object.entries(rawItems)) {
            if (!isRecord(rawAugments)) return null;
            const byName: Record<string, Augment> = {};
            for (const [name, rawAugment] of Object.entries(rawAugments)) {
                const augment = readAugment(rawAugment);
                if (augment === null) return null;
                byName[name] = augment;
            }
            items[item] = byName;
        }
        return { schemaVersion, language, generatedAt, items };
    }

    function countAugments(file: AugmentsFile): number {
        return Object.values(file.items).reduce((total, byName) => total + Object.keys(byName).length, 0);
    }

    function isDisabled(): boolean {
        try {
            return localStorage.getItem(KILL_SWITCH_KEY) === '0';
        } catch {
            return false;
        }
    }

    // Keeps only the entries that are still a valid file; anything else counts as no cache.
    function readCache(): AugmentsCache {
        const cache: { -readonly [L in Language]?: CacheEntry } = {};
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (raw === null) return cache;
            const parsed: unknown = JSON.parse(raw);
            if (!isRecord(parsed)) return cache;
            for (const language of LANGUAGES) {
                const entry = parsed[language];
                if (!isRecord(entry)) continue;
                const fetchedAt = entry['fetchedAt'];
                const file = parseAugmentsFile(entry['file'], language);
                if (typeof fetchedAt === 'number' && Number.isFinite(fetchedAt) && file !== null) cache[language] = { fetchedAt, file };
            }
        } catch (e) {
            console.warn(`${LOG} could not read the cache:`, describeError(e));
        }
        return cache;
    }

    function writeCache(cache: AugmentsCache): void {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
        } catch (e) {
            console.warn(`${LOG} could not save the cache:`, describeError(e));
        }
    }

    async function fetchFile(language: Language): Promise<AugmentsFile | null> {
        try {
            const res = await fetch(BASE_URL + FILE_NAMES[language], { cache: 'no-cache' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const file = parseAugmentsFile(await res.json(), language);
            if (file === null) console.warn(`${LOG} ${language}: the file is not a valid augment file, ignored`);
            return file;
        } catch (e) {
            console.warn(`${LOG} could not fetch ${language}:`, describeError(e));
            return null;
        }
    }

    // Returns the cache entry to store (a fresh one only when the network was used).
    async function loadLanguage(language: Language, cached: CacheEntry | undefined): Promise<CacheEntry | undefined> {
        const age = cached === undefined ? Infinity : Date.now() - cached.fetchedAt;
        if (cached !== undefined && age >= 0 && age < FRESH_MS) {
            loaded[language] = cached.file;
            console.log(`${LOG} loaded ${language}: ${countAugments(cached.file)} augments, from cache`);
            return cached;
        }

        const file = await fetchFile(language);
        if (file !== null) {
            loaded[language] = file;
            console.log(`${LOG} loaded ${language}: ${countAugments(file)} augments, from network`);
            return { fetchedAt: Date.now(), file };
        }

        if (cached !== undefined) {
            loaded[language] = cached.file;
            console.log(`${LOG} loaded ${language}: ${countAugments(cached.file)} augments, from cache (stale)`);
            return cached;
        }
        console.warn(`${LOG} no augment data for ${language}: not reachable and nothing cached`);
        return undefined;
    }

    // The loaded file for a language, or null when there is none (read by the lookup in slice 9b).
    function getAugmentsFile(language: Language): AugmentsFile | null {
        return loaded[language] ?? null;
    }

    async function loadAll(): Promise<void> {
        if (isDisabled()) {
            console.log(`${LOG} disabled (localStorage ${KILL_SWITCH_KEY} is 0)`);
            return;
        }
        const cache = readCache();
        const entries = await Promise.all(LANGUAGES.map((language) => loadLanguage(language, cache[language])));
        const next: { -readonly [L in Language]?: CacheEntry } = {};
        LANGUAGES.forEach((language, index) => {
            const entry = entries[index];
            if (entry !== undefined) next[language] = entry;
        });
        // Written once, after both languages are settled, so one language cannot overwrite the other.
        writeCache(next);
        const summary = LANGUAGES.map((language) => {
            const file = getAugmentsFile(language);
            return `${language}=${file === null ? 'none' : countAugments(file)}`;
        });
        console.log(`${LOG} ready: ${summary.join(', ')}`);
    }

    // The turret or hull screen prints the item's name in its title ("Tsunami Mk3-8" or "Цунами Mk3-8"); the
    // Augments tab replaces that block, so the name is remembered while the title is up.
    const ITEM_TITLE_SELECTOR = '.TanksPartComponentStyle-descriptionContainer .ItemDescriptionComponentStyle-nameItem';
    const ITEM_POLL_MS = 250;

    let itemNames: ReadonlyMap<string, string> | null = null;
    let currentItem: string | null = null;
    let lastItemTitle: string | null = null;

    // skins.json maps the lowercase RU and EN item names to one slug; it is read here as well because scripts share no imports.
    async function loadItemNames(): Promise<void> {
        try {
            const res = await fetch(chrome.runtime.getURL('data/skins.json'));
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data: unknown = await res.json();
            const names = isRecord(data) ? data['names'] : undefined;
            if (!isRecord(names)) throw new Error('no names table');
            const table = new Map<string, string>();
            for (const [name, slug] of Object.entries(names)) {
                if (typeof slug === 'string') table.set(name, slug);
            }
            itemNames = table;
        } catch (e) {
            console.warn(`${LOG} could not load the item names:`, describeError(e));
        }
    }

    // Only a visible title changes the remembered item, so leaving the title screen keeps the last one.
    function itemTick(): void {
        if (itemNames === null) return;
        const title = document.querySelector(ITEM_TITLE_SELECTOR)?.textContent?.trim();
        if (!title || title === lastItemTitle) return;
        lastItemTitle = title;
        const firstWord = title.toLowerCase().split(/\s+/)[0];
        currentItem = itemNames.get(firstWord) ?? null;
        console.log(`${LOG} item on screen: ${currentItem ?? 'unknown'} (title "${title}")`);
    }

    let lastTab: KaspGarageTab | null = null;

    // The Augments, Skins and Shot color tabs share one row of cards; garage_tab.ts tells them apart.
    function tabTick(): void {
        const tab = window.kaspGarageTab?.read() ?? null;
        if (tab === lastTab) return;
        lastTab = tab;
        console.log(`${LOG} garage tab: ${tab ?? 'none'} (item ${currentItem ?? 'unknown'})`);
    }

    // On the Augments tab the title block shows the selected augment ("Critical Mix"), or "Standard settings"
    // when none is picked, which has no entry in the data.
    const AUGMENT_TITLE_SELECTOR = '.ItemDescriptionComponentStyle-descriptionBlockDevice .ItemDescriptionComponentStyle-nameItem';

    interface AugmentMatch {
        readonly language: Language;
        readonly augment: Augment;
    }

    // Lowercase, and hyphens, dashes and runs of spaces count as one space, so "High pressure pump" matches "High-pressure pump".
    function normalizeName(text: string): string {
        return text.toLowerCase().replace(/ё/g, 'е').replace(/[\s\-‐-―]+/g, ' ').trim();
    }

    const nameIndexes = new Map<string, ReadonlyMap<string, Augment>>();

    // The index of one item's augments by normalised name, built once per file and item.
    function indexFor(file: AugmentsFile, bucket: string): ReadonlyMap<string, Augment> {
        const key = `${file.language}:${bucket}`;
        const cached = nameIndexes.get(key);
        if (cached !== undefined) return cached;
        const index = new Map<string, Augment>();
        for (const [name, augment] of Object.entries(file.items[bucket] ?? {})) index.set(normalizeName(name), augment);
        nameIndexes.set(key, index);
        return index;
    }

    // A hull has no bucket of its own: the data keeps every hull's augments under "hulls".
    function findAugment(item: string, language: Language, cardName: string): AugmentMatch | null {
        const file = getAugmentsFile(language);
        if (file === null) return null;
        const bucket = file.items[item] === undefined ? 'hulls' : item;
        const augment = indexFor(file, bucket).get(normalizeName(cardName));
        return augment === undefined ? null : { language, augment };
    }

    let lastAugmentKey: string | null = null;

    function augmentTick(): void {
        const title = window.kaspGarageTab?.read() === 'augments'
            ? document.querySelector(AUGMENT_TITLE_SELECTOR)?.textContent?.trim() ?? null
            : null;
        const language = window.kaspLanguage?.get() ?? 'EN';
        const key = title === null ? null : `${currentItem}|${language}|${title}`;
        if (key === lastAugmentKey) return;
        lastAugmentKey = key;
        if (title === null || currentItem === null) return;
        const match = findAugment(currentItem, language, title);
        if (match === null) {
            console.log(`${LOG} augment "${title}" (${currentItem}, ${language}): no entry`);
            return;
        }
        const { advantages, disadvantages, rarity } = match.augment;
        console.log(`${LOG} augment "${title}" (${currentItem}, ${language}): ${advantages.length} advantages, ${disadvantages.length} disadvantages, rarity ${rarity ?? 'none'}`);
    }

    // After the load event, so the game's own start-up is not delayed.
    function start(): void {
        void loadAll();
        if (isDisabled()) return;
        void loadItemNames();
        setInterval(() => {
            itemTick();
            tabTick();
            augmentTick();
        }, ITEM_POLL_MS);
    }

    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
})();
