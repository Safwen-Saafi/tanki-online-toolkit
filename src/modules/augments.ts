// Isolated-world content script. Shows each augment's advantages and disadvantages on the garage's Augments tab: a
// small "i" box on every augment tile that opens a spec box on hover. The augment data is what the Augments bot
// publishes on GitHub Pages; only the file for the game's language is loaded, and it is cached for a few hours.
// The file has four parts, in reading order: the data, the item and augment on screen, the spec box, the tile boxes.
(function () {
    'use strict';

    const LOG = '[KI-test][augments]';
    const BASE_URL = 'https://safwen-saafi.github.io/tanki-online-toolkit/';
    const FILE_NAMES = { EN: 'augments.en.json', RU: 'augments.ru.json' } as const;
    const CACHE_KEY = 'kasp_augments_cache';
    const KILL_SWITCH_KEY = 'kasp_augments';
    // The bot publishes once a day, so asking more often than this only costs requests.
    const FRESH_MS = 6 * 60 * 60 * 1000;
    const TICK_MS = 250;

    const LANGUAGES: readonly KaspLanguageCode[] = ['EN', 'RU'];

    interface CacheEntry {
        readonly fetchedAt: number;
        readonly file: AugmentsFile;
    }
    // One entry per language: only the game's language is loaded, but the other one is kept for a later switch.
    type AugmentsCache = Partial<Record<KaspLanguageCode, CacheEntry>>;

    // ---- 1. the data ----

    // The augment file of the game's language, or null until it is loaded (or when there is none).
    let augmentsFile: AugmentsFile | null = null;

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
    function parseAugmentsFile(value: unknown, language: KaspLanguageCode): AugmentsFile | null {
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
        const cache: AugmentsCache = {};
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

    async function fetchFile(language: KaspLanguageCode): Promise<AugmentsFile | null> {
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

    // Returns the cache entry to use: the cached one while it is fresh, else a new one from the network, else the stale
    // cached one when the network fails.
    async function loadLanguage(language: KaspLanguageCode, cached: CacheEntry | undefined): Promise<CacheEntry | undefined> {
        const age = cached === undefined ? Infinity : Date.now() - cached.fetchedAt;
        if (cached !== undefined && age >= 0 && age < FRESH_MS) return cached;

        const file = await fetchFile(language);
        if (file !== null) return { fetchedAt: Date.now(), file };

        if (cached === undefined) console.warn(`${LOG} no augment data for ${language}: not reachable and nothing cached`);
        return cached;
    }

    // A language change reloads the page, so the language the game starts in is the only one this page needs.
    async function loadAugments(): Promise<void> {
        const language = await (window.kaspLanguage?.whenKnown ?? Promise.resolve<KaspLanguageCode>('EN'));
        const cache = readCache();
        const entry = await loadLanguage(language, cache[language]);
        augmentsFile = entry?.file ?? null;
        // The other language's entry is written back unchanged, so a later switch of the game language still has it.
        if (entry !== undefined && entry !== cache[language]) {
            const next: AugmentsCache = { ...cache };
            next[language] = entry;
            writeCache(next);
        }
        console.log(`${LOG} ready: ${language}=${augmentsFile === null ? 'none' : countAugments(augmentsFile)}`);
    }

    // ---- 2. the item and the augment on screen ----

    // The turret or hull screen prints the item's name in its title ("Tsunami Mk3-8" or "Цунами Mk3-8"); the
    // Augments tab replaces that block, so the name is remembered while the title is up.
    const ITEM_TITLE_SELECTOR = '.TanksPartComponentStyle-descriptionContainer .ItemDescriptionComponentStyle-nameItem';

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
    }

    interface AugmentMatch {
        readonly language: KaspLanguageCode;
        readonly augment: Augment;
    }

    // Lowercase, quotes dropped, a possessive "'s" dropped, and hyphens, dashes and runs of spaces count as one space,
    // so "High pressure pump" matches "High-pressure pump", "Dragon breath" matches "Dragon's Breath", and a name in
    // quotes matches the same name without them.
    function normalizeName(text: string): string {
        return text
            .toLowerCase()
            .replace(/ё/g, 'е')
            .replace(/["“”„«»]/g, '')
            .replace(/['’‘]s\b/g, '')
            .replace(/['’‘]/g, '')
            .replace(/[\s\-‐-―]+/g, ' ')
            .trim();
    }

    const MIN_PARTIAL_NAME = 4;

    // The game and the wiki sometimes word one name differently ("Duplet" Firing Mode in the game, Duplet on the
    // wiki). The one wiki name that sits inside the game's name, or contains it, is taken, but only when it is the
    // only one, so a close call never picks a wrong augment.
    function closestAugment(index: ReadonlyMap<string, Augment>, wanted: string): Augment | undefined {
        if (wanted.length < MIN_PARTIAL_NAME) return undefined;
        const candidates = [...index].filter(
            ([name]) => name.length >= MIN_PARTIAL_NAME && (wanted.includes(name) || name.includes(wanted)),
        );
        return candidates.length === 1 ? candidates[0]?.[1] : undefined;
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
    function findAugment(item: string, cardName: string): AugmentMatch | null {
        const file = augmentsFile;
        if (file === null) return null;
        const bucket = file.items[item] === undefined ? 'hulls' : item;
        const index = indexFor(file, bucket);
        const wanted = normalizeName(cardName);
        const augment = index.get(wanted) ?? closestAugment(index, wanted);
        return augment === undefined ? null : { language: file.language, augment };
    }

    // ---- 3. the spec box ----

    // Each augment tile on the Augments tab gets a small box in its corner; hovering it shows that augment's
    // advantages and disadvantages in a box styled after the wiki's augment page (styles/augments.css).
    const CARD_ROW_SELECTOR = '.SkinsAndAlterationsStyle-SkinsVerticalComponent';
    const CARD_TITLE_SELECTOR = '.SkinCellStyle-nameDevices';
    const BOX_CLASS = 'kasp-spec-btn';
    const TOOLTIP_ID = 'kasp-spec-tooltip';
    const TOOLTIP_GAP = 16;
    const HEADINGS = {
        EN: { advantages: 'Advantages', disadvantages: 'Disadvantages' },
        RU: { advantages: 'Преимущества', disadvantages: 'Недостатки' },
    } as const;
    // A number with its sign or comparison ("+25%", "<=25%"), so values stand out the way they do on the wiki.
    const NUMBER_PATTERN = /([<>≤≥]?[+\-−]?\d+(?:[.,]\d+)?%?)/;

    // The images in extension/icons/. A status effect in the text arrives as {key}; an unknown key shows nothing.
    const EFFECT_ICONS: ReadonlySet<string> = new Set(['armor_piercing', 'burning', 'emp', 'freeze', 'jammer', 'stun']);
    // The English data names the effect inside the marker ({freeze|Freezing}); the Russian data leaves it after the marker
    // in guillemets ({freeze} «Заморозка»), so a quoted name right after a marker is taken as its name too.
    const MARKER_PATTERN = /\{([a-z_]+)(?:\|([^{}|]*))?\}(?:\s*«([^»]*)»)?/;
    const FRAME_RANKS: ReadonlySet<string> = new Set(['rare', 'epic', 'legendary', 'exotic']);
    // The game has no exotic container, so that rank shows none.
    const CONTAINER_RANKS: ReadonlySet<string> = new Set(['rare', 'epic', 'legendary']);

    function icon(className: string, path: string): HTMLImageElement {
        const image = document.createElement('img');
        image.className = className;
        image.alt = '';
        image.src = chrome.runtime.getURL(`icons/${path}`);
        return image;
    }

    function element(tag: string, className: string, text?: string): HTMLElement {
        const node = document.createElement(tag);
        node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function appendNumbers(parent: HTMLElement, text: string): void {
        // split() with one capture group puts the numbers at the odd positions.
        text.split(NUMBER_PATTERN).forEach((part, index) => {
            if (part === '') return;
            if (index % 2 === 1) parent.append(element('span', 'kasp-spec-num', part));
            else parent.append(document.createTextNode(part));
        });
    }

    function appendLine(list: HTMLElement, line: string): void {
        const item = element('li', 'kasp-spec-line');
        // split() with three capture groups gives the text, the key, the name and the quoted name, over and over.
        const parts = line.split(MARKER_PATTERN);
        for (let index = 0; index < parts.length; index += 4) {
            appendNumbers(item, parts[index] ?? '');
            const key = parts[index + 1];
            const name = parts[index + 2] || parts[index + 3];
            if (key === undefined || !EFFECT_ICONS.has(key)) continue;
            item.append(icon('kasp-spec-effect', `effects/${key}.png`));
            if (name !== undefined && name !== '') item.append(element('span', 'kasp-spec-effect-name', name));
        }
        list.append(item);
    }

    function buildColumn(kind: 'positive' | 'negative', heading: string, lines: readonly string[]): HTMLElement {
        const column = element('div', `kasp-spec-col kasp-spec-${kind}`);
        const title = element('div', 'kasp-spec-heading');
        title.append(icon('kasp-spec-sign', kind === 'positive' ? 'corners/advantages.svg' : 'corners/disadvantages.svg'), heading);
        column.append(title);
        const list = element('ul', 'kasp-spec-lines');
        for (const line of lines) appendLine(list, line);
        column.append(list);
        return column;
    }

    function getTooltip(): HTMLElement {
        const existing = document.getElementById(TOOLTIP_ID);
        if (existing !== null) return existing;
        const tooltip = element('div', 'kasp-spec-tooltip');
        tooltip.id = TOOLTIP_ID;
        document.body.append(tooltip);
        return tooltip;
    }

    function hideTooltip(): void {
        const tooltip = document.getElementById(TOOLTIP_ID);
        if (tooltip !== null) tooltip.style.display = 'none';
    }

    // Escape and Z also leave the screen in the game, so the box must not stay behind.
    window.addEventListener(
        'keydown',
        (event) => {
            if (event.code === 'Escape' || event.code === 'KeyZ') hideTooltip();
        },
        true,
    );

    function moveTooltip(event: MouseEvent): void {
        const tooltip = getTooltip();
        const size = tooltip.getBoundingClientRect();
        let x = event.clientX + TOOLTIP_GAP;
        let y = event.clientY + TOOLTIP_GAP;
        if (x + size.width > window.innerWidth) x = event.clientX - size.width - TOOLTIP_GAP;
        if (y + size.height > window.innerHeight) y = event.clientY - size.height - TOOLTIP_GAP;
        tooltip.style.left = `${Math.max(0, x)}px`;
        tooltip.style.top = `${Math.max(0, y)}px`;
    }

    // The corner ornaments and the container icon that go with the augment's rank.
    function buildDecorations(rarity: string | null): HTMLElement[] {
        const decorations: HTMLElement[] = [];
        if (rarity !== null && FRAME_RANKS.has(rarity)) {
            decorations.push(icon('kasp-spec-corner-start', `corners/corner_${rarity}.svg`));
            decorations.push(icon('kasp-spec-corner-end', `corners/corner_${rarity}.svg`));
        }
        if (rarity !== null && CONTAINER_RANKS.has(rarity)) {
            decorations.push(icon('kasp-spec-container', `containers/${rarity}_container.svg`));
        }
        return decorations;
    }

    function showTooltip(match: AugmentMatch, event: MouseEvent): void {
        const tooltip = getTooltip();
        const { augment, language } = match;
        tooltip.replaceChildren(...buildDecorations(augment.rarity), element('div', 'kasp-spec-name', augment.name));
        const columns = element('div', 'kasp-spec-columns');
        if (augment.advantages.length > 0) {
            columns.append(buildColumn('positive', HEADINGS[language].advantages, augment.advantages));
        }
        if (augment.disadvantages.length > 0) {
            columns.append(buildColumn('negative', HEADINGS[language].disadvantages, augment.disadvantages));
        }
        tooltip.append(columns);
        tooltip.dataset['rarity'] = augment.rarity ?? '';
        tooltip.style.display = 'block';
        moveTooltip(event);
    }

    // ---- 4. the tile boxes and the tick ----

    function createBox(card: HTMLElement, name: string, match: AugmentMatch): HTMLElement {
        if (window.getComputedStyle(card).position === 'static') card.style.position = 'relative';
        const box = element('div', BOX_CLASS, 'i');
        box.dataset['name'] = name;
        box.dataset['language'] = match.language;
        box.dataset['rarity'] = match.augment.rarity ?? '';
        hasBoxes = true;
        box.addEventListener('mouseenter', (event) => showTooltip(match, event));
        box.addEventListener('mousemove', moveTooltip);
        box.addEventListener('mouseleave', hideTooltip);
        // The box sits on top of the tile, so a click on it must not select or equip the augment.
        for (const type of ['click', 'mousedown']) {
            box.addEventListener(type, (event) => {
                event.stopPropagation();
                event.preventDefault();
            });
        }
        return box;
    }

    function syncBox(card: HTMLElement, name: string, match: AugmentMatch | null): void {
        const existing = card.querySelector<HTMLElement>(`:scope > .${BOX_CLASS}`);
        if (match === null) {
            existing?.remove();
            return;
        }
        if (existing?.dataset['name'] === name && existing.dataset['language'] === match.language) return;
        existing?.remove();
        card.append(createBox(card, name, match));
    }

    // True from the first box until they are all removed, so the check that runs on every page change costs nothing
    // while no box exists (in a battle, for one).
    let hasBoxes = false;

    function removeBoxes(): void {
        if (!hasBoxes) return;
        hasBoxes = false;
        document.querySelectorAll(`.${BOX_CLASS}`).forEach((box) => box.remove());
        hideTooltip();
    }

    function boxTick(): void {
        const item = currentItem;
        const row = document.querySelector(CARD_ROW_SELECTOR);
        if (item === null || row === null || window.kaspGarageTab?.read() !== 'augments') {
            removeBoxes();
            return;
        }
        row.querySelectorAll(CARD_TITLE_SELECTOR).forEach((title) => {
            const card = title.parentElement;
            if (card === null) return;
            const name = (title.textContent ?? '').trim();
            syncBox(card, name, findAugment(item, name));
        });
    }

    function tick(): void {
        itemTick();
        boxTick();
    }

    // The game draws the tiles by itself and nothing says when, so the page is watched instead of polled: the boxes go on
    // in the next frame after the tiles appear. One pass per frame at most, since the page changes constantly. The timer
    // stays as a safety net for any state reached without a page change.
    let scheduled = false;
    const observer = new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            tick();
        });
    });

    // After the load event, so the game's own start-up is not delayed.
    function start(): void {
        if (isDisabled()) {
            console.log(`${LOG} disabled (localStorage ${KILL_SWITCH_KEY} is 0)`);
            return;
        }
        void loadAugments();
        void loadItemNames();
        observer.observe(document.documentElement, { childList: true, subtree: true });
        setInterval(tick, TICK_MS);
    }

    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
})();
