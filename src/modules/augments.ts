// Isolated-world content script. Shows each augment's advantages and disadvantages on the garage's Augments tab: a
// small "i" box on every augment tile that opens a spec box on hover. The augment data is what the Augments bot
// publishes on GitHub Pages; only the file for the game's language is loaded, and it is cached for a few hours.
// The file has six parts, in reading order: the data, the item and augment on screen, the spec box, the tile boxes, the
// hidden "?" cards, the tick.
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
        // True for an augment the wiki does not have yet: the box then says so instead of listing advantages.
        readonly missing?: boolean;
    }

    // Lowercase, quotes dropped, a possessive "'s" dropped, and hyphens, dashes and runs of spaces count as one space,
    // so "High pressure pump" matches "High-pressure pump", "Dragon breath" matches "Dragon's Breath", and a name in
    // quotes matches the same name without them. The wiki also words one kind of ammunition both ways ("Jamming Rounds" for
    // Smoky, "Jamming Shells" for Scorpion), so round(s) and shell(s) count as the same word; no turret's list has two
    // augments that differ only in that word.
    function normalizeName(text: string): string {
        return text
            .toLowerCase()
            .replace(/ё/g, 'е')
            .replace(/["“”„«»]/g, '')
            .replace(/['’‘]s\b/g, '')
            .replace(/['’‘]/g, '')
            .replace(/[\s\-‐-―]+/g, ' ')
            .replace(/\b(?:rounds?|shells?)\b/g, 'shell')
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
    // What the box says for an augment the wiki has not described yet (the game adds some before the wiki does), followed by a warning picture.
    const MISSING_NOTE = {
        EN: 'No information yet',
        RU: 'Информации пока нет',
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
        if (match.missing === true) {
            // The warning picture is the one the change counter puts beside a player who changed equipment.
            const note = element('div', 'kasp-spec-note', MISSING_NOTE[language]);
            note.append(icon('kasp-spec-note-icon', 'change-marker.webp'));
            tooltip.append(note);
        } else {
            const columns = element('div', 'kasp-spec-columns');
            if (augment.advantages.length > 0) {
                columns.append(buildColumn('positive', HEADINGS[language].advantages, augment.advantages));
            }
            if (augment.disadvantages.length > 0) {
                columns.append(buildColumn('negative', HEADINGS[language].disadvantages, augment.disadvantages));
            }
            tooltip.append(columns);
        }
        tooltip.dataset['rarity'] = augment.rarity ?? '';
        tooltip.style.display = 'block';
        moveTooltip(event);
    }

    // ---- 4. the tile boxes and the tick ----

    // The augment is looked up once per tile and name, when its box is placed, because the box's colour comes from the
    // augment's rank. A tile that has its box, or was already found to have no entry, is skipped, so a pass over tiles
    // that did not change does no lookups at all.
    const NO_ENTRY_KEY = 'kaspNoEntry';

    function createBox(card: HTMLElement, key: string, match: AugmentMatch): HTMLElement {
        if (window.getComputedStyle(card).position === 'static') card.style.position = 'relative';
        const box = element('div', BOX_CLASS, 'i');
        box.dataset['key'] = key;
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

    // An augment card with no entry in the data still gets its box, saying there is no information yet, so no tile is left bare. The
    // card must be an augment's by the game's own category (a skin's card is not), and not Standard settings, the first card.
    function missingMatch(card: HTMLElement, name: string): AugmentMatch | null {
        const file = augmentsFile;
        const game = readGameCard(card);
        if (file === null || game === null || game.category !== AUGMENT_CATEGORY || card === card.parentElement?.firstElementChild) {
            return null;
        }
        const augment: Augment = { name, advantages: [], disadvantages: [], rarity: FRAME_RANKS_BY_GAME[game.rarity] ?? null };
        return { language: file.language, augment, missing: true };
    }

    function syncBox(card: HTMLElement, item: string, name: string): void {
        const key = `${item}|${name}`;
        const existing = card.querySelector<HTMLElement>(`:scope > .${BOX_CLASS}`);
        if (existing?.dataset['key'] === key || card.dataset[NO_ENTRY_KEY] === key) return;
        existing?.remove();
        const match = findAugment(item, name) ?? missingMatch(card, name);
        if (match === null) {
            // Only a lookup against loaded data and a readable card count as "no entry"; until then the tile is tried again.
            if (augmentsFile !== null && readGameCard(card) !== null) card.dataset[NO_ENTRY_KEY] = key;
            return;
        }
        card.append(createBox(card, key, match));
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
            removeHiddenMarks();
            return;
        }
        window.dispatchEvent(new CustomEvent(GAME_CARD_REQUEST));
        row.querySelectorAll(CARD_TITLE_SELECTOR).forEach((title) => {
            const card = title.parentElement;
            if (card === null) return;
            const name = (title.textContent ?? '').trim();
            syncBox(card, item, name);
        });
        if (augmentsFile === null) {
            removeHiddenMarks();
            return;
        }
        hiddenTick(row, item);
        sideTick();
    }

    // ---- 5. the hidden "?" cards ----

    // The game draws an augment the player cannot see as a "?" card, but its own React data for the card still holds the real
    // name and rank, with isUnknown true. injector.ts copies five values (name, category, rank, unknown, picture address), and
    // nothing else, onto each card as data-kasp-card; this section draws the card as that augment, with the text from the bot's
    // data: the game's own picture (greyed), our own frame in the colour of the rank, and the name. Each card is judged alone, so a card the game redraws (a click on it, say) never
    // changes another. See blueprint/context/garage-augments-screen.md.
    const GAME_CARD_ATTRIBUTE = 'data-kasp-card';
    const GAME_CARD_REQUEST = 'kasp:cards-request';
    const RARITY_NAME = /^[A-Z_]{2,20}$/;
    // The game's category of an augment. A skin's card has another, and is left alone.
    const AUGMENT_CATEGORY = 'DEVICE';
    // The game's rank word on a card, and the rank word of the corner images in extension/icons/corners (the game's exotic
    // rank is SPECIAL). The frame is drawn from our own stylesheet, because the game only adds the style of a rank once it
    // draws a visible card of that rank, so a hidden card could have no frame at all.
    const FRAME_RANKS_BY_GAME: Readonly<Record<string, string | undefined>> = {
        RARE: 'rare',
        EPIC: 'epic',
        LEGENDARY: 'legendary',
        SPECIAL: 'exotic',
    };
    // The game rewrites a card's class when it redraws the card, so what we drew is marked with data attributes, which it
    // leaves alone, and every node we add has our class so the drawing can be taken back whole.
    const OWN_NODE_CLASS = 'kasp-hidden-node';
    const HIDDEN_KEY = 'kaspHidden';
    const ORIGINAL_KEY = 'kaspHiddenOriginal';
    const PICTURE_KEY = 'kaspHiddenPicture';
    // The pictures that did not load, so a card goes back to the game's "?" and the address is not tried again.
    const failedPictures = new Set<string>();

    // The picture is shown on the game's own page, so only an https address on the game's server is taken.
    const GAME_PICTURE_HOST = /(^|\.)tankionline\.com$/;

    function isGamePicture(value: unknown): value is string {
        if (typeof value !== 'string' || value.length > 500) return false;
        try {
            const url = new URL(value);
            return url.protocol === 'https:' && GAME_PICTURE_HOST.test(url.hostname);
        } catch {
            return false;
        }
    }

    // What injector.ts wrote on a card, checked again here since it travels as text.
    function readGameCard(card: Element): KaspGameCard | null {
        const raw = card.getAttribute(GAME_CARD_ATTRIBUTE);
        if (raw === null) return null;
        try {
            const value: unknown = JSON.parse(raw);
            if (!isRecord(value)) return null;
            const { name, category, rarity, unknown, picture } = value;
            if (typeof name !== 'string' || name === '' || typeof rarity !== 'string' || !RARITY_NAME.test(rarity)) return null;
            if (typeof unknown !== 'boolean' || (picture !== null && !isGamePicture(picture))) return null;
            if (category !== null && (typeof category !== 'string' || !RARITY_NAME.test(category))) return null;
            return { name, category, rarity, unknown, picture: picture === null ? null : new URL(String(picture)).href };
        } catch {
            return null;
        }
    }

    // True from the first drawing until they are all removed, like hasBoxes.
    let hasHiddenMarks = false;

    // Puts the card back as the game drew it: the "?" picture, none of our nodes, no marks. A picture the game has changed in
    // the meantime is left as the game has it.
    function undrawCard(card: HTMLElement): void {
        if (card.dataset[HIDDEN_KEY] === undefined) return;
        card.querySelectorAll(`:scope > .${OWN_NODE_CLASS}, :scope > .${BOX_CLASS}`).forEach((node) => node.remove());
        const picture = card.querySelector(`:scope > img:not(.${OWN_NODE_CLASS})`);
        const original = card.dataset[ORIGINAL_KEY];
        if (picture !== null && original !== undefined && picture.getAttribute('src') === card.dataset[PICTURE_KEY]) {
            picture.setAttribute('src', original);
        }
        delete card.dataset[HIDDEN_KEY];
        delete card.dataset[ORIGINAL_KEY];
        delete card.dataset[PICTURE_KEY];
    }

    function isDrawnAs(card: HTMLElement, picture: HTMLImageElement, augment: Augment, image: string): boolean {
        return (
            card.dataset[HIDDEN_KEY] === augment.name &&
            card.dataset[PICTURE_KEY] === image &&
            picture.getAttribute('src') === image &&
            card.querySelector(`:scope > .${OWN_NODE_CLASS}`) !== null
        );
    }

    // Draws a hidden card as its augment: the game's own picture of it (greyed by the stylesheet), a frame and corner in the colour of
    // its rank, and the name. The tile box comes from the same pass as every other card's, because the name is on the card.
    function drawCard(card: HTMLElement, augment: Augment, game: KaspGameCard): void {
        const image = game.picture;
        const picture = card.querySelector<HTMLImageElement>(`:scope > img:not(.${OWN_NODE_CLASS})`);
        if (image === null || picture === null || failedPictures.has(image) || isDrawnAs(card, picture, augment, image)) return;
        undrawCard(card);
        const original = picture.getAttribute('src');
        if (original === null) return;
        card.dataset[HIDDEN_KEY] = augment.name;
        card.dataset[ORIGINAL_KEY] = original;
        card.dataset[PICTURE_KEY] = image;
        hasHiddenMarks = true;
        picture.setAttribute('src', image);
        picture.addEventListener(
            'error',
            () => {
                if (card.dataset[PICTURE_KEY] !== image || failedPictures.has(image)) return;
                failedPictures.add(image);
                console.warn(`${LOG} the picture of ${augment.name} did not load: ${image}`);
                undrawCard(card);
            },
            { once: true },
        );
        const nodes: HTMLElement[] = [];
        const rank = FRAME_RANKS_BY_GAME[game.rarity];
        if (rank !== undefined) {
            const frame = element('div', `kasp-hidden-frame ${OWN_NODE_CLASS}`);
            frame.dataset['rank'] = rank;
            nodes.push(frame, icon(`kasp-hidden-corner ${OWN_NODE_CLASS}`, `corners/corner_${rank}.svg`));
        }
        nodes.push(element('p', `SkinCellStyle-nameDevices ${OWN_NODE_CLASS}`, augment.name));
        picture.before(...nodes);
    }

    // The wiki's entry for a hidden card, or, when the wiki does not have the augment yet, one made of what the game says (its name and
    // rank), so the card is still drawn and its box says there is no information.
    function hiddenAugment(item: string, game: KaspGameCard): Augment {
        const known = findAugment(item, game.name)?.augment;
        return known ?? { name: game.name, advantages: [], disadvantages: [], rarity: FRAME_RANKS_BY_GAME[game.rarity] ?? null };
    }

    function hiddenTick(row: Element, item: string): void {
        for (const child of Array.from(row.children)) {
            if (!(child instanceof HTMLElement)) continue;
            const card = readGameCard(child);
            if (card === null || card.category !== AUGMENT_CATEGORY || !card.unknown) undrawCard(child);
            else drawCard(child, hiddenAugment(item, card), card);
        }
    }

    // Selecting a hidden card makes the game show its panel for an item the player cannot see: the "?" is a background picture
    // of one element, with a "Not available" button below. The panel is told from any other picture by its background being the
    // game's "unavailable" one. Its picture is swapped for the augment's (greyed) and its name put under it. Which card was
    // chosen is the last one clicked; the game gives no readable selected card for an unknown item (checked 2026-10-30).
    const PICTURE_PANEL_SELECTOR = '[class~="-backgroundImageContain"]';
    const UNAVAILABLE_BACKGROUND = /unavailable\.[^/]*\.svg/;
    const SIDE_ATTRIBUTE = 'data-kasp-side';
    const SIDE_NAME_CLASS = 'kasp-hidden-side-name';
    let clickedCard: HTMLElement | null = null;
    // True from the first change to the sidebar until it is put back, like hasBoxes.
    let hasSide = false;

    document.addEventListener(
        'click',
        (event) => {
            const target = event.target;
            if (!(target instanceof Element) || target.closest(`.${BOX_CLASS}`) !== null) return;
            const row = target.closest(CARD_ROW_SELECTOR);
            if (row === null) return;
            let card: Element = target;
            while (card.parentElement !== null && card.parentElement !== row) card = card.parentElement;
            clickedCard = card instanceof HTMLElement && card.dataset[HIDDEN_KEY] !== undefined ? card : null;
        },
        true,
    );

    function findUnavailablePanel(): HTMLElement | null {
        for (const candidate of document.querySelectorAll<HTMLElement>(PICTURE_PANEL_SELECTOR)) {
            if (candidate.hasAttribute(SIDE_ATTRIBUTE) || UNAVAILABLE_BACKGROUND.test(getComputedStyle(candidate).backgroundImage)) {
                return candidate;
            }
        }
        return null;
    }

    // The game slides a long name in this panel back and forth while the mouse is over it (measured 2026-10-31): the hidden part of the
    // text is scrolled into view and back in 2.1 s per round trip, smoothly, with no pause at the ends. Ours does the same.
    const SLIDE_PERIOD_MS = 2100;

    function slideOnHover(node: HTMLElement): void {
        let frame = 0;
        node.addEventListener('mouseenter', () => {
            const distance = node.scrollWidth - node.clientWidth;
            if (distance <= 0) return;
            const start = performance.now();
            const step = (now: number): void => {
                if (!node.isConnected) return;
                node.scrollLeft = distance * Math.sin((Math.PI * (now - start)) / SLIDE_PERIOD_MS) ** 2;
                frame = requestAnimationFrame(step);
            };
            frame = requestAnimationFrame(step);
        });
        node.addEventListener('mouseleave', () => {
            cancelAnimationFrame(frame);
            node.scrollLeft = 0;
        });
    }

    function removeSide(): void {
        if (!hasSide) return;
        hasSide = false;
        document.querySelectorAll<HTMLElement>(`[${SIDE_ATTRIBUTE}]`).forEach((panel) => {
            panel.removeAttribute(SIDE_ATTRIBUTE);
            panel.style.removeProperty('background-image');
            panel.style.removeProperty('filter');
        });
        document.querySelectorAll(`.${SIDE_NAME_CLASS}`).forEach((node) => node.remove());
    }

    function sideTick(): void {
        const card = clickedCard;
        const connected = card?.isConnected === true ? card : null;
        const name = connected?.dataset[HIDDEN_KEY];
        const image = connected?.dataset[PICTURE_KEY];
        const panel = name === undefined || image === undefined ? null : findUnavailablePanel();
        if (name === undefined || image === undefined || panel === null) {
            removeSide();
            return;
        }
        if (panel.getAttribute(SIDE_ATTRIBUTE) === name && panel.nextElementSibling?.classList.contains(SIDE_NAME_CLASS) === true) return;
        removeSide();
        hasSide = true;
        panel.setAttribute(SIDE_ATTRIBUTE, name);
        panel.style.setProperty('background-image', `url("${image}")`, 'important');
        panel.style.setProperty('filter', 'grayscale(1) brightness(0.75)');
        const label = element('p', SIDE_NAME_CLASS, name);
        slideOnHover(label);
        panel.after(label);
    }

    function removeHiddenMarks(): void {
        clickedCard = null;
        removeSide();
        if (!hasHiddenMarks) return;
        hasHiddenMarks = false;
        document.querySelectorAll<HTMLElement>('[data-kasp-hidden]').forEach(undrawCard);
    }

    // ---- 6. the tick ----

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
