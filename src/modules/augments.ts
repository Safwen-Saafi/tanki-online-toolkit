// Isolated-world content script. Shows each augment's advantages and disadvantages on the garage's Augments tab: a
// small "i" box on every augment tile that opens a spec box on hover. The augment data is what the Augments bot
// publishes on GitHub Pages; only the file for the game's language is loaded, and it is cached for a few hours.
// The file has six parts, in reading order: the data, the item and augment on screen, the spec box, the tile boxes, the
// hidden "?" cards (on the Augments, Skins and Shot color tabs), the tick.
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

    const SMALL_WORD_LENGTH = 2;
    const MIN_SAME_LETTERS = 4;
    const MAX_ENDING_LETTERS = 2;
    const MAX_EXTRA_LETTERS = 2;

    // One word is the other with a few letters added inside it: the game's "наноботов" is the wiki's "нанороботов". A wider spelling
    // allowance is not safe: it would make "Exothermic" and "Endothermic", or "Stabilization" and "Destabilization", the same augment.
    function hasExtraLetters(a: string, b: string): boolean {
        const [short, long] = a.length < b.length ? [a, b] : [b, a];
        const extra = long.length - short.length;
        if (extra < 1 || extra > MAX_EXTRA_LETTERS || short.length < MIN_SAME_LETTERS * 2) return false;
        for (let split = MIN_SAME_LETTERS; split <= short.length - MIN_SAME_LETTERS; split++) {
            if (long.startsWith(short.slice(0, split)) && long.endsWith(short.slice(split))) return true;
        }
        return false;
    }

    // Small words dropped, the same words in the same order, each differing only in its last letters or by a few letters inside it.
    function sameWords(a: string, b: string): boolean {
        const first = a.split(' ').filter((word) => word.length > SMALL_WORD_LENGTH);
        const second = b.split(' ').filter((word) => word.length > SMALL_WORD_LENGTH);
        if (first.length === 0 || first.length !== second.length) return false;
        return first.every((word, index) => {
            const other = second[index] ?? '';
            let same = 0;
            while (same < word.length && word[same] === other[same]) same++;
            return (
                word === other ||
                (same >= MIN_SAME_LETTERS && same >= Math.max(word.length, other.length) - MAX_ENDING_LETTERS) ||
                hasExtraLetters(word, other)
            );
        });
    }

    // The game and the wiki sometimes word a name a little differently. Russian word endings change with a small word: the game's
    // "Иммунитет к оглушению" is the wiki's "Иммунитет от оглушения". The one wiki name it can be is taken, but only when it
    // is the only one, and no two names on one wiki list look alike by this test (checked 2026-11-01).
    function similarAugment(index: ReadonlyMap<string, Augment>, wanted: string): Augment | undefined {
        const candidates = [...index].filter(([name]) => sameWords(name, wanted));
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
        const augment = index.get(wanted) ?? closestAugment(index, wanted) ?? similarAugment(index, wanted);
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

    // The tab the last pass saw. Switching tab takes every drawing back first: the game reuses the row's elements and the
    // left panel for the other tab's items, and a card or panel we drew would otherwise stay on the wrong item.
    let lastTab: string | null = null;

    function boxTick(): void {
        // The garage's tab reads null on this screen, so the check below would take every box away.
        const containers = document.querySelector(REWARD_ROOT_SELECTOR);
        if (containers !== null) {
            removeHiddenMarks();
            containerTick(containers);
            return;
        }
        rewardDownloadFailed = false;
        const item = currentItem;
        const row = document.querySelector(CARD_ROW_SELECTOR);
        const tab = window.kaspGarageTab?.read() ?? null;
        if (tab !== lastTab) {
            lastTab = tab;
            removeHiddenMarks();
            switchedAt = Date.now();
            oldTabCards = row === null ? null : rowSignature(row);
        }
        if (row !== null && (tab === 'skins' || tab === 'shot-color')) {
            cosmeticTick(row, tab);
            return;
        }
        if (item === null || row === null || tab !== 'augments') {
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
        hiddenTick(row, tab, item);
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
    // The game's category of an augment. A skin's and a shot colour's cards both say SKIN (read from the cards, 2026-10-31), so
    // those two tabs are told apart by the cards themselves changing (see cosmeticTick), not by the category.
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
    // Set on an augment's card only: the left panel greys a hidden augment's picture. A hidden skin's or colour's keeps its own
    // colours, and the game's own dimming of an item the player cannot see is switched off for it. The cards' pictures are greyed
    // for all of them.
    const GREY_KEY = 'kaspHiddenGrey';
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
            const { name, category, rarity, unknown, picture, preview } = value;
            if (typeof name !== 'string' || name === '' || typeof rarity !== 'string' || !RARITY_NAME.test(rarity)) return null;
            if (typeof unknown !== 'boolean' || (picture !== null && !isGamePicture(picture))) return null;
            if (category !== null && (typeof category !== 'string' || !RARITY_NAME.test(category))) return null;
            if (preview !== null && preview !== undefined && !isGamePicture(preview)) return null;
            return {
                name,
                category,
                rarity,
                unknown,
                picture: picture === null ? null : new URL(String(picture)).href,
                preview: typeof preview === 'string' ? new URL(preview).href : null,
            };
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
        delete card.dataset[GREY_KEY];
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
        // A card that cannot be drawn now must not keep what it was drawn as before: the game reuses the element for another item.
        if (image === null || picture === null || failedPictures.has(image)) {
            undrawCard(card);
            return;
        }
        if (isDrawnAs(card, picture, augment, image)) return;
        undrawCard(card);
        const original = picture.getAttribute('src');
        if (original === null) return;
        card.dataset[HIDDEN_KEY] = augment.name;
        card.dataset[ORIGINAL_KEY] = original;
        card.dataset[PICTURE_KEY] = image;
        if (game.category === AUGMENT_CATEGORY) card.dataset[GREY_KEY] = '';
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
    function hiddenAugment(item: string | null, game: KaspGameCard): Augment {
        const known = item === null ? undefined : findAugment(item, game.name)?.augment;
        return known ?? { name: game.name, advantages: [], disadvantages: [], rarity: FRAME_RANKS_BY_GAME[game.rarity] ?? null };
    }

    // Augment cards belong to the Augments tab only, because the row keeps the old tab's cards for a moment after a switch.
    function belongsToTab(tab: KaspGarageTab, category: string | null): boolean {
        return (category === AUGMENT_CATEGORY) === (tab === 'augments');
    }

    // On the Augments tab item is the turret or hull; on the Skins and Shot color tabs it is null (no wiki text, no box).
    function hiddenTick(row: Element, tab: KaspGarageTab, item: string | null): void {
        for (const child of Array.from(row.children)) {
            if (!(child instanceof HTMLElement)) continue;
            const card = readGameCard(child);
            if (card === null || !card.unknown || !belongsToTab(tab, card.category)) undrawCard(child);
            else drawCard(child, hiddenAugment(item, card), card);
        }
    }

    // The row's cards as the game's data describes them, to tell when the game has swapped them.
    function rowSignature(row: Element): string {
        return Array.from(row.children, (child) => child.getAttribute(GAME_CARD_ATTRIBUTE) ?? '').join('\n');
    }

    // After a tab switch the row still holds the old tab's cards for a moment, and a skin card and a colour card say the same
    // category, so those cards are not drawn until the row has changed. The wait is capped in case it never does.
    const SWAP_WAIT_MS = 1500;
    let switchedAt = 0;
    let oldTabCards: string | null = null;

    // The Skins and Shot color tabs: a hidden card is drawn with its picture and name only. There is no wiki text for a skin or a
    // colour, so no spec box, and nothing here waits for the augment data.
    function cosmeticTick(row: Element, tab: KaspGarageTab): void {
        removeBoxes();
        window.dispatchEvent(new CustomEvent(GAME_CARD_REQUEST));
        if (oldTabCards !== null) {
            if (rowSignature(row) === oldTabCards && Date.now() - switchedAt < SWAP_WAIT_MS) {
                removeHiddenMarks();
                return;
            }
            oldTabCards = null;
        }
        hiddenTick(row, tab, null);
        sideTick();
    }

    // Selecting a hidden card makes the game show its panel for an item the player cannot see: the "?" is a background picture
    // of one element, with a "Not available" button below. The panel is told from any other picture by its background being the
    // game's "unavailable" one. Its picture is swapped for the augment's (greyed) and its name put under it. Which card was
    // chosen is the last one clicked; the game gives no readable selected card for an unknown item (checked 2026-10-30).
    const PICTURE_PANEL_SELECTOR = '[class~="-backgroundImageContain"]';
    const UNAVAILABLE_BACKGROUND = /unavailable\.[^/]*\.svg/;
    const SIDE_ATTRIBUTE = 'data-kasp-side';
    const SIDE_NAME_CLASS = 'kasp-hidden-side-name';
    // For an item the player cannot see, the game puts the panel's picture in a wrapper with filter: invert(0.25), which dims the
    // picture and the name we add next to it (measured 2026-10-31; a panel of an owned item has no such wrapper). A skin's or a
    // colour's panel switches that filter off, and the wrapper's own inline value is kept here to put it back.
    const WRAPPER_FILTER_KEY = 'kaspSideFilter';
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
            const wrapper = panel.parentElement;
            const kept = wrapper?.dataset[WRAPPER_FILTER_KEY];
            if (wrapper !== null && kept !== undefined) {
                if (kept === '') wrapper.style.removeProperty('filter');
                else wrapper.style.setProperty('filter', kept);
                delete wrapper.dataset[WRAPPER_FILTER_KEY];
            }
        });
        document.querySelectorAll(`.${SIDE_NAME_CLASS}`).forEach((node) => node.remove());
    }

    function sideTick(): void {
        const card = clickedCard;
        const connected = card?.isConnected === true ? card : null;
        const name = connected?.dataset[HIDDEN_KEY];
        // A skin or colour has a bigger picture for this panel than its card's; an augment's panel uses the card's.
        const image = (connected === null ? null : readGameCard(connected)?.preview) ?? connected?.dataset[PICTURE_KEY];
        const panel = name === undefined || image === undefined ? null : findUnavailablePanel();
        if (name === undefined || image === undefined || panel === null) {
            removeSide();
            return;
        }
        const key = `${name}|${image}`;
        if (panel.getAttribute(SIDE_ATTRIBUTE) === key && panel.nextElementSibling?.classList.contains(SIDE_NAME_CLASS) === true) return;
        removeSide();
        hasSide = true;
        panel.setAttribute(SIDE_ATTRIBUTE, key);
        panel.style.setProperty('background-image', `url("${image}")`, 'important');
        const grey = connected?.dataset[GREY_KEY] !== undefined;
        panel.style.setProperty('filter', grey ? 'grayscale(1) brightness(0.75)' : 'none', 'important');
        const wrapper = panel.parentElement;
        if (!grey && wrapper !== null && getComputedStyle(wrapper).filter !== 'none') {
            wrapper.dataset[WRAPPER_FILTER_KEY] = wrapper.style.getPropertyValue('filter');
            wrapper.style.setProperty('filter', 'none', 'important');
        }
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

    // ---- 6. the Containers screen ----

    // A tile on this screen has no name and no turret, and the game's list of rewards (read by injector.ts) has the name only. But each
    // augment's picture is an SVG that draws its turret's badge in the corner, the same on all of that turret's augments. So the badge is
    // learned from the tiles whose name belongs to one turret only, and then every tile has to show its turret's badge to get an answer.
    // A tile the rule is not sure of says there is no information, because a wrong spec is worse than none. Everything is worked out again on
    // each load, so nothing is stored. See blueprint/context/containers-augments-research.md.
    const REWARD_ROOT_SELECTOR = '.ContainerInfoComponentStyle-lootBoxContainer';
    const REWARD_TILE_SELECTOR = '.RewardCardComponentStyle-imageBlock';
    const REWARD_PICTURE_SELECTOR = '[class~="-backgroundImageContain"]';
    const REWARDS_ATTRIBUTE = 'data-kasp-rewards';
    const REWARDS_REQUEST = 'kasp:rewards-request';
    const REWARD_ANSWER_ATTRIBUTE = 'data-kasp-reward-item';
    const REWARD_REQUEST_GAP_MS = 1000;
    const REWARD_DOWNLOADS_AT_ONCE = 6;
    const NOT_SURE = '?';
    // How many of a turret's reference tiles must have a drawing for it to count as the turret's badge.
    const BADGE_SHARE = 0.6;
    const BADGE_MIN_TILES = 2;
    const CSS_URL = /url\("?([^")]+)"?\)/;
    const SVG_PATH = /\sd="([^"]+)"/g;

    let rewardListText: string | null = null;
    let rewardNames: ReadonlyMap<string, string> = new Map();
    let rewardRanks: ReadonlyMap<string, string> = new Map();
    let rewardAnswers: ReadonlyMap<string, string> = new Map();
    let answeredList: string | null = null;
    let rewardWorking = false;
    let rewardDownloadFailed = false;
    let lastRewardRequest = 0;
    const rewardDrawings = new Map<string, ReadonlySet<string>>();
    const tilePictures = new WeakMap<Element, { readonly className: string; readonly address: string | null }>();

    // The picture is a CSS background set by a class the game makes per picture, so it is read again only when that class changes:
    // getComputedStyle on every tile of every pass would be too slow.
    function tilePicture(tile: Element): string | null {
        const picture = tile.querySelector(REWARD_PICTURE_SELECTOR);
        if (picture === null) return null;
        const className = picture.className;
        const known = tilePictures.get(tile);
        if (known?.className === className) return known.address;
        const address = CSS_URL.exec(getComputedStyle(picture).backgroundImage)?.[1] ?? null;
        tilePictures.set(tile, { className, address });
        return address;
    }

    function readRewardList(text: string | null): void {
        const names = new Map<string, string>();
        const ranks = new Map<string, string>();
        try {
            const value: unknown = text === null ? [] : JSON.parse(text);
            for (const entry of Array.isArray(value) ? (value as unknown[]) : []) {
                if (!isRecord(entry)) continue;
                const { name, picture, rank } = entry;
                if (typeof name !== 'string' || !isGamePicture(picture)) continue;
                names.set(picture, name);
                if (typeof rank === 'string' && RARITY_NAME.test(rank)) ranks.set(picture, rank);
            }
        } catch {
            // a list that cannot be read gets no answers
        }
        rewardNames = names;
        rewardRanks = ranks;
    }

    async function downloadDrawings(addresses: readonly string[]): Promise<boolean> {
        let next = 0;
        let failed = false;
        const worker = async (): Promise<void> => {
            while (next < addresses.length) {
                const address = addresses[next++];
                if (address === undefined) return;
                try {
                    const res = await fetch(address);
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    const drawings = new Set<string>();
                    for (const match of (await res.text()).matchAll(SVG_PATH)) drawings.add((match[1] ?? '').replace(/\s+/g, ' ').trim());
                    if (drawings.size === 0) throw new Error('no drawing');
                    rewardDrawings.set(address, drawings);
                } catch (e) {
                    failed = true;
                    console.warn(`${LOG} could not read the picture ${address}:`, describeError(e));
                }
            }
        };
        await Promise.all(Array.from({ length: REWARD_DOWNLOADS_AT_ONCE }, worker));
        return !failed;
    }

    // The turrets or "hulls" whose wiki list has this name; a looser match counts only when no turret has it exactly.
    function rewardBuckets(file: AugmentsFile, name: string): ReadonlySet<string> {
        const wanted = normalizeName(name);
        const buckets = Object.keys(file.items);
        const exact = buckets.filter((bucket) => indexFor(file, bucket).has(wanted));
        if (exact.length > 0) return new Set(exact);
        return new Set(
            buckets.filter((bucket) => {
                const index = indexFor(file, bucket);
                return (closestAugment(index, wanted) ?? similarAugment(index, wanted)) !== undefined;
            }),
        );
    }

    // One round: every tile is judged against the badges learned from the given reference tiles.
    function judgeTiles(buckets: ReadonlyMap<string, ReadonlySet<string>>, references: ReadonlyMap<string, readonly string[]>): ReadonlyMap<string, string> {
        const drawnBy = new Map<string, Set<string>>();
        for (const [bucket, addresses] of references) {
            for (const address of addresses) {
                for (const drawing of rewardDrawings.get(address) ?? []) {
                    const owners = drawnBy.get(drawing) ?? new Set<string>();
                    owners.add(bucket);
                    drawnBy.set(drawing, owners);
                }
            }
        }
        // What is drawn on this turret's reference tiles and on no other turret's, leaving out the tile being judged.
        const badgeOf = (bucket: string, judged: string): ReadonlySet<string> => {
            const tiles = (references.get(bucket) ?? []).filter((address) => address !== judged);
            const counts = new Map<string, number>();
            for (const address of tiles) {
                for (const drawing of rewardDrawings.get(address) ?? []) {
                    if (drawnBy.get(drawing)?.size === 1) counts.set(drawing, (counts.get(drawing) ?? 0) + 1);
                }
            }
            const needed = tiles.length === 1 ? 1 : Math.max(BADGE_MIN_TILES, BADGE_SHARE * tiles.length);
            return new Set([...counts].filter(([, count]) => count >= needed).map(([drawing]) => drawing));
        };
        const answers = new Map<string, string>();
        for (const [address, candidates] of buckets) {
            const drawings = rewardDrawings.get(address) ?? new Set<string>();
            const scored: { bucket: string; matches: number }[] = [];
            const withoutReferences: string[] = [];
            for (const bucket of candidates) {
                if (!(references.get(bucket) ?? []).some((reference) => reference !== address)) {
                    withoutReferences.push(bucket);
                    continue;
                }
                scored.push({ bucket, matches: [...badgeOf(bucket, address)].filter((drawing) => drawings.has(drawing)).length });
            }
            scored.sort((a, b) => b.matches - a.matches);
            const best = scored[0];
            const [lone] = withoutReferences;
            let answer = NOT_SURE;
            if (best !== undefined && best.matches >= 1 && (scored[1]?.matches ?? 0) === 0) answer = best.bucket;
            // Only two turrets are possible, and one of them has no tile of its own to learn from (Firebird and Freeze share their mixes).
            else if (lone !== undefined && withoutReferences.length === 1 && candidates.size === 2 && (best?.matches ?? 0) === 0) answer = lone;
            answers.set(address, answer);
        }
        return answers;
    }

    // Two rounds. The first learns from the tiles whose name belongs to one turret only. The second learns from every tile the first placed,
    // because a turret with few such tiles has little to learn from: Firebird has none, so its Camper needs its mixes placed first.
    function workOutTurrets(file: AugmentsFile, names: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
        const buckets = new Map<string, ReadonlySet<string>>();
        for (const [address, name] of names) buckets.set(address, rewardBuckets(file, name));
        const namedOnce = new Map<string, string[]>();
        for (const [address, candidates] of buckets) {
            const [only] = candidates;
            if (candidates.size === 1 && only !== undefined) namedOnce.set(only, [...(namedOnce.get(only) ?? []), address]);
        }
        const placed = new Map<string, string[]>();
        for (const [address, answer] of judgeTiles(buckets, namedOnce)) {
            if (answer !== NOT_SURE) placed.set(answer, [...(placed.get(answer) ?? []), address]);
        }
        return judgeTiles(buckets, placed);
    }

    // The whole list is learned from, never the tiles on screen, and only when every picture was read: fewer pictures could change an answer.
    async function learnRewards(text: string | null, names: ReadonlyMap<string, string>, file: AugmentsFile): Promise<void> {
        rewardWorking = true;
        try {
            const missing = [...names.keys()].filter((address) => !rewardDrawings.has(address));
            if (!(await downloadDrawings(missing))) {
                rewardDownloadFailed = true;
                return;
            }
            rewardAnswers = workOutTurrets(file, names);
            answeredList = text;
        } finally {
            rewardWorking = false;
        }
    }

    // Says there is no information, like a garage tile the wiki lacks: a tile with no wiki text, or one the rule is not sure of.
    function noInformation(file: AugmentsFile, name: string, rank: string | undefined): AugmentMatch {
        const augment: Augment = { name, advantages: [], disadvantages: [], rarity: rank === undefined ? null : (FRAME_RANKS_BY_GAME[rank] ?? null) };
        return { language: file.language, augment, missing: true };
    }

    // The card holding the tile is positioned and nothing on it clips, and its bottom left corner is free (the count is centred).
    function syncRewardBox(card: HTMLElement, answer: string | undefined, name: string | undefined, rank: string | undefined): void {
        const key = answer === undefined || name === undefined ? null : `${answer}|${name}`;
        const existing = card.querySelector<HTMLElement>(`:scope > .${BOX_CLASS}`);
        if ((existing?.dataset['key'] ?? null) === key) return;
        if (existing !== null) {
            existing.remove();
            hideTooltip();
        }
        const file = augmentsFile;
        if (key === null || answer === undefined || name === undefined || file === null) return;
        const match = (answer === NOT_SURE ? null : findAugment(answer, name)) ?? noInformation(file, name, rank);
        card.append(createBox(card, key, match));
    }

    function containerTick(root: Element): void {
        const tiles = Array.from(root.querySelectorAll(REWARD_TILE_SELECTOR));
        const text = root.getAttribute(REWARDS_ATTRIBUTE);
        if (text !== rewardListText) {
            rewardListText = text;
            readRewardList(text);
        }
        const pictures = tiles.map(tilePicture);
        const now = Date.now();
        const unknownTile = pictures.some((address) => address?.endsWith('.svg') === true && !rewardNames.has(address));
        if ((text === null || unknownTile) && now - lastRewardRequest >= REWARD_REQUEST_GAP_MS) {
            lastRewardRequest = now;
            window.dispatchEvent(new CustomEvent(REWARDS_REQUEST));
        }
        const file = augmentsFile;
        if (file !== null && text !== null && text !== answeredList && !rewardWorking && !rewardDownloadFailed && rewardNames.size > 0) {
            void learnRewards(text, rewardNames, file);
        }
        tiles.forEach((tile, index) => {
            const address = pictures[index];
            const answer = address === null || address === undefined ? undefined : rewardAnswers.get(address);
            if (answer === undefined) tile.removeAttribute(REWARD_ANSWER_ATTRIBUTE);
            else if (tile.getAttribute(REWARD_ANSWER_ATTRIBUTE) !== answer) tile.setAttribute(REWARD_ANSWER_ATTRIBUTE, answer);
            const card = tile.parentElement;
            const name = address === null || address === undefined ? undefined : rewardNames.get(address);
            const rank = address === null || address === undefined ? undefined : rewardRanks.get(address);
            if (card !== null) syncRewardBox(card, answer, name, rank);
        });
    }

    // ---- 7. the tick ----

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
