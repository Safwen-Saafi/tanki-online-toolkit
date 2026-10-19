// Isolated-world content script. Ported from modules.customGarageSkins in
// src/kasp_main.ts:2954-3168, but the equipped skin is no longer detected from previews and
// looked up in a database: its art URL is learned from the game's own Skins tab.
(function () {
    'use strict';

    type SavedSkins = Record<string, string>;
    type DefaultImagesMap = Record<string, string[]>;

    const LOG = '[KI-test][garage-skins]';
    const STORAGE_KEY = 'kasp_equipped_skins';
    const BASE_IMG_KEY = 'kasp_base_images';
    const ART_MEMORY_KEY = 'kasp_skin_art';
    const ART_MEMORY_LIMIT = 300;

    const TICK_MS = 250;
    // One tick can catch the marker and the preview out of step mid-render, so a change must hold for two.
    const LEARN_TICKS = 2;
    const EQUIP_DEBOUNCE_MS = 600;
    const DOUBLE_PRESS_MS = 500;

    // The game's own class names, in one place so a renamed class is fixed once.
    const SKIN_TITLE_SELECTOR = '.SkinCellStyle-nameDevices';
    const SKINS_ROW_SELECTOR = '.SkinsAndAlterationsStyle-SkinsVerticalComponent';
    const SUB_MENU_SELECTOR = '.GarageCommonStyle-subMenu';
    const TILE_SELECTOR = '.garage-item';
    const TILE_MAIN_IMG_SELECTOR = '.GarageItemComponentStyle-mainImg';
    const MOUNTED_BLOCK_SELECTOR = '.MountedItemsStyle-commonBlockForTurretsHulls';
    const MOUNTED_PREVIEW_SELECTOR = '.MountedItemsStyle-itemPreview';
    const EQUIP_BUTTON_SELECTOR = '.GarageTurretsAlterationsComponentStyle-mountStandardButton, .AlterationButtonStyle-commonButton';
    const GARAGE_SCREEN_SELECTOR = [
        '.GarageCommonStyle-positionContent',
        '.GarageItemComponent-container',
        '.ContainerInfoComponentStyle-lootBoxContainer',
        '.GarageMainScreenStyle-blockParameters',
        SKINS_ROW_SELECTOR,
    ].join(', ');

    // Learned URLs end up inside a CSS url("...") and an attribute selector, so anything but a plain game image URL is
    // refused, wherever it comes from.
    const SAFE_ART_URL = /^https:\/\/[a-z0-9.-]+\.tankionline\.com\/[A-Za-z0-9/_.-]+\.webp$/;

    // ---- data ----

    let skinsData: SkinsDatabase | null = null;

    fetch(chrome.runtime.getURL('data/skins.json'))
        .then(res => {
            if (!res.ok) throw new Error('skins.json: HTTP ' + res.status);
            return res.json();
        })
        .then((data: SkinsDatabase) => {
            skinsData = data;
        })
        .catch(e => console.error(`${LOG} failed to load data/skins.json:`, e));

    // ---- storage ----
    // Everything in storage is read back as unknown and checked, since the page and other scripts can write to it too.

    function isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    function isSafeUrl(value: unknown): value is string {
        return typeof value === 'string' && SAFE_ART_URL.test(value);
    }

    function readStore(key: string): unknown {
        try {
            const raw = localStorage.getItem(key);
            return raw === null ? null : JSON.parse(raw);
        } catch {
            // blocked storage or a broken value reads as nothing stored
            return null;
        }
    }

    // A write that keeps failing (the tick would repeat it) is reported once.
    const failedWrites = new Set<string>();

    function writeStore(key: string, value: unknown): void {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e: unknown) {
            if (failedWrites.has(key)) return;
            failedWrites.add(key);
            console.warn(`${LOG} could not save ${key}:`, e instanceof Error ? e.message : e);
        }
    }

    function readSavedSkins(): SavedSkins {
        const saved: SavedSkins = {};
        const stored = readStore(STORAGE_KEY);
        if (!isRecord(stored)) return saved;
        for (const [item, url] of Object.entries(stored)) {
            if (isSafeUrl(url)) saved[item] = url;
        }
        return saved;
    }

    // The stock art the tiles were seen showing, per item. A value may be one URL or a list of them.
    function readBaseImages(): DefaultImagesMap {
        const images: DefaultImagesMap = {};
        const stored = readStore(BASE_IMG_KEY);
        if (!isRecord(stored)) return images;
        for (const [item, value] of Object.entries(stored)) {
            const urls = (Array.isArray(value) ? value : [value]).filter(isSafeUrl);
            if (urls.length > 0) images[item] = urls;
        }
        return images;
    }

    // The stock art that ships in skins.json plus the stock art learned from the tiles.
    function mergeDefaultImages(prefilled: SkinsDatabase['defaults'], learned: DefaultImagesMap): DefaultImagesMap {
        const merged: DefaultImagesMap = {};
        for (const [item, url] of Object.entries(prefilled)) merged[item] = [url];
        for (const [item, urls] of Object.entries(learned)) {
            const list = (merged[item] ??= []);
            for (const url of urls) {
                if (!list.includes(url)) list.push(url);
            }
        }
        return merged;
    }

    // ---- painting ----

    function updateGlobalCSS(savedSkins: SavedSkins, defaultImages: DefaultImagesMap): void {
        let css = '';

        for (const item of Object.keys(defaultImages)) {
            const targetUrl = savedSkins[item];
            if (!targetUrl) continue;

            const finalUrls = defaultImages[item].filter(url => url !== targetUrl);

            if (finalUrls.length > 0) {
                const selectors = finalUrls.map(url =>
                    `${TILE_MAIN_IMG_SELECTOR}[src="${url}"], ${TILE_SELECTOR} img[src="${url}"], ${MOUNTED_PREVIEW_SELECTOR}[src="${url}"]`
                ).join(',\n');
                css += `${selectors} {\n    content: url("${targetUrl}") !important;\n    object-fit: contain !important;\n    pointer-events: none !important;\n}\n\n`;
            }
        }

        let styleEl = document.getElementById('kasp-skins-global-css');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'kasp-skins-global-css';
            document.head.appendChild(styleEl);
        }
        if (styleEl.textContent !== css) {
            styleEl.textContent = css;
        }
    }

    // Neither garage screen renders the equipped skin itself: the tiles and the
    // mounted previews both carry the item's stock art and the skin is painted
    // over it by CSS. So an element cannot tell on its own that an unknown skin
    // is on. What it can read is what learning stored: the stock URL is stored only
    // when the equipped skin's art could not be read, a learned skin stores its own
    // art URL, and Standard stores nothing at all.
    function hasUnknownSkin(
        itemNameEN: string,
        savedSkins: SavedSkins,
        prefilledDefaults: SkinsDatabase['defaults']
    ): boolean {
        const saved = savedSkins[itemNameEN];
        return !!saved && saved === prefilledDefaults[itemNameEN];
    }

    function toggleUnknownLabel(host: Element, show: boolean): void {
        const existing = host.querySelector('.kasp-unknown-skin');

        if (!show) {
            if (existing) existing.remove();
            return;
        }

        if (!existing) {
            const label = document.createElement('span');
            label.className = 'kasp-unknown-skin';
            label.textContent = 'unknown skin';
            host.appendChild(label);
        }
    }

    // The main screen's blocks only show the category ("Turrets"), never the item
    // name, so the item is found by matching the preview's stock image instead.
    function markMountedUnknownSkins(
        savedSkins: SavedSkins,
        defaultImages: DefaultImagesMap,
        prefilledDefaults: SkinsDatabase['defaults']
    ): void {
        for (const block of document.querySelectorAll(MOUNTED_BLOCK_SELECTOR)) {
            const src = block.querySelector(MOUNTED_PREVIEW_SELECTOR)?.getAttribute('src') || '';
            const owner = Object.keys(savedSkins).find(item => defaultImages[item]?.includes(src));
            toggleUnknownLabel(block, !!owner && hasUnknownSkin(owner, savedSkins, prefilledDefaults));
        }
    }

    // Walks the garage tiles: learns the stock art each one shows (adding it to `defaultImages`) and puts the
    // "unknown skin" label on the ones whose skin is not known. Returns true when a new stock URL was learned.
    function syncTiles(
        nameTranslate: SkinsDatabase['names'],
        savedSkins: SavedSkins,
        defaultImages: DefaultImagesMap,
        prefilledDefaults: SkinsDatabase['defaults']
    ): boolean {
        let learned = false;
        for (const tile of document.querySelectorAll(TILE_SELECTOR)) {
            const titleSpan = tile.querySelector('.GarageItemComponentStyle-descriptionDevice span');
            const imgMain = tile.querySelector(TILE_MAIN_IMG_SELECTOR);
            if (!titleSpan || !imgMain) continue;

            const word = (titleSpan.textContent ?? '').trim().toLowerCase().split(/\s+/)[0];
            const item = nameTranslate[word] || word;
            const src = imgMain.getAttribute('src') ?? '';

            // A tile already showing the saved skin's URL is not stock art, so it must not be learned as stock.
            if (src !== savedSkins[item] && isSafeUrl(src)) {
                const known = (defaultImages[item] ??= []);
                if (!known.includes(src)) {
                    known.push(src);
                    learned = true;
                }
            }

            toggleUnknownLabel(tile, hasUnknownSkin(item, savedSkins, prefilledDefaults));
        }
        return learned;
    }

    // ---- reading the Skins tab ----

    type EquippedCard =
        | { readonly kind: 'standard' }
        | { readonly kind: 'skin'; readonly title: string };

    type SkinsScreenState =
        | { readonly kind: 'absent' }
        | {
            readonly kind: 'ready';
            readonly item: string;
            readonly equipped: EquippedCard;
            readonly selectedTitle: string | null;
            readonly selectedIsStandard: boolean;
            readonly artUrl: string | null;
        };

    interface SkinCard {
        readonly title: string;
        readonly isStandard: boolean;
        readonly isEquipped: boolean;
    }

    function readSkinCards(row: Element): SkinCard[] {
        const cards: SkinCard[] = [];
        row.querySelectorAll(SKIN_TITLE_SELECTOR).forEach((titleEl) => {
            const card = titleEl.parentElement;
            if (!card) return;
            const icon = card.querySelector('.SkinCellStyle-iconCell');
            cards.push({
                title: (titleEl.textContent ?? '').trim(),
                isStandard: (icon?.getAttribute('src') ?? '').includes('ic_standard'),
                isEquipped: !!card.querySelector('.SkinCellStyle-mountIcon'),
            });
        });
        return cards;
    }

    // The panel prints the selected skin's title, but the same text also sits in
    // the cards row, so that row is skipped or the first card would always win.
    function readSelectedTitle(menu: Element, row: Element, cardTitles: ReadonlySet<string>): string | null {
        for (const el of menu.querySelectorAll('*')) {
            if (el.children.length > 0 || row.contains(el)) continue;
            const text = (el.textContent ?? '').trim();
            if (cardTitles.has(text.toLowerCase())) return text;
        }
        return null;
    }

    // The art is a CSS background on a div, not an img, so it only shows in computed style.
    function readPreviewArt(menu: Element, row: Element): string | null {
        for (const el of menu.querySelectorAll('[class*="backgroundImageContain"]')) {
            if (row.contains(el)) continue;
            const match = /url\("?([^")]+\.webp)"?\)/.exec(getComputedStyle(el).backgroundImage);
            if (match) return match[1];
        }
        return null;
    }

    function readSkinsScreen(nameTranslate: SkinsDatabase['names']): SkinsScreenState {
        // The Augments tab reuses this row and its cards, so an equipped augment would be read as a skin.
        // An unknown tab (null) keeps the old behaviour.
        const tab = window.kaspGarageTab?.read() ?? null;
        if (tab !== null && tab !== 'skins') return { kind: 'absent' };
        const row = document.querySelector(SKINS_ROW_SELECTOR);
        const menu = document.querySelector(SUB_MENU_SELECTOR);
        if (!row || !menu) return { kind: 'absent' };

        const cards = readSkinCards(row);
        const equippedCard = cards.find(card => card.isEquipped);
        // Standard's title carries no item name, so any other card supplies it.
        const namedCard = equippedCard && !equippedCard.isStandard
            ? equippedCard
            : cards.find(card => !card.isStandard);
        if (!equippedCard || !namedCard) return { kind: 'absent' };

        const word = namedCard.title.toLowerCase().split(/\s+/)[0];
        if (!word) return { kind: 'absent' };

        const selectedTitle = readSelectedTitle(menu, row, new Set(cards.map(card => card.title.toLowerCase())));
        const selectedCard = cards.find(card => card.title.toLowerCase() === selectedTitle?.toLowerCase());
        return {
            kind: 'ready',
            item: nameTranslate[word] || word,
            equipped: equippedCard.isStandard
                ? { kind: 'standard' }
                : { kind: 'skin', title: equippedCard.title },
            selectedTitle,
            selectedIsStandard: selectedCard?.isStandard ?? false,
            artUrl: readPreviewArt(menu, row),
        };
    }

    // ---- learning the equipped skin ----

    type LearnAction =
        | { readonly kind: 'none' }
        | { readonly kind: 'set'; readonly item: string; readonly url: string }
        | { readonly kind: 'clear'; readonly item: string };

    type ChangeAction = Exclude<LearnAction, { kind: 'none' }>;

    function decideLearnAction(state: SkinsScreenState, stockUrl: string | undefined): LearnAction {
        if (state.kind === 'absent') return { kind: 'none' };
        if (state.equipped.kind === 'standard') return { kind: 'clear', item: state.item };

        const selectedIsEquipped = state.selectedTitle !== null
            && state.selectedTitle.toLowerCase() === state.equipped.title.toLowerCase();
        if (!selectedIsEquipped) return { kind: 'none' };

        if (isSafeUrl(state.artUrl)) return { kind: 'set', item: state.item, url: state.artUrl };
        // Art that cannot be read stores the stock image, which is what raises the "unknown skin" label.
        return stockUrl ? { kind: 'set', item: state.item, url: stockUrl } : { kind: 'none' };
    }

    let pendingLearn: { readonly key: string; readonly ticks: number; readonly action: ChangeAction } | null = null;

    // The one place the saved skins change: only when the saved skin really changes.
    function applyLearn(action: ChangeAction): void {
        const savedSkins = readSavedSkins();
        if (action.kind === 'set') {
            if (savedSkins[action.item] === action.url) return;
            savedSkins[action.item] = action.url;
        } else {
            if (savedSkins[action.item] === undefined) return;
            delete savedSkins[action.item];
        }
        writeStore(STORAGE_KEY, savedSkins);
    }

    function learnFromSkinsScreen(state: SkinsScreenState, prefilledDefaults: SkinsDatabase['defaults']): void {
        const stockUrl = state.kind === 'ready' ? prefilledDefaults[state.item] : undefined;
        const action = decideLearnAction(state, stockUrl);
        if (action.kind === 'none') {
            // Leaving the Skins tab right after equipping must not lose a change one tick has already seen: the
            // skin would show the old art on the tiles until the tab was opened again.
            if (state.kind === 'absent' && pendingLearn !== null) applyLearn(pendingLearn.action);
            pendingLearn = null;
            return;
        }

        const key = action.kind === 'set' ? `set|${action.item}|${action.url}` : `clear|${action.item}`;
        pendingLearn = { key, ticks: pendingLearn?.key === key ? pendingLearn.ticks + 1 : 1, action };
        if (pendingLearn.ticks < LEARN_TICKS) return;

        applyLearn(action);
    }

    // The art of each skin the user has had selected, kept while its picture was steady for two ticks. Pressing equip
    // and leaving at once can come before any tick sees the new equipped skin, but the art was known from the moment the
    // skin was selected, so the equip itself can save it.
    // It is also kept in the browser (kasp_skin_art), so a skin that was selected on an earlier visit is already known
    // the next time, with no waiting at all.
    const seenArt = new Map<string, string>();
    let artCandidate: { readonly key: string; readonly url: string; readonly ticks: number } | null = null;

    function artKey(item: string, title: string): string {
        return `${item}|${title.toLowerCase()}`;
    }

    function loadArtMemory(): void {
        const stored = readStore(ART_MEMORY_KEY);
        if (!isRecord(stored)) return;
        for (const [key, url] of Object.entries(stored)) {
            if (isSafeUrl(url)) seenArt.set(key, url);
        }
    }

    function rememberArt(key: string, url: string): void {
        if (seenArt.get(key) === url) return;
        seenArt.delete(key);
        seenArt.set(key, url);
        // Map keeps insertion order, so the oldest entries go first when the memory is full.
        while (seenArt.size > ART_MEMORY_LIMIT) {
            const oldest = seenArt.keys().next().value;
            if (oldest === undefined) break;
            seenArt.delete(oldest);
        }
        writeStore(ART_MEMORY_KEY, Object.fromEntries(seenArt));
    }

    function trackSelectedArt(state: SkinsScreenState): void {
        if (state.kind !== 'ready' || state.selectedTitle === null || !isSafeUrl(state.artUrl)) {
            artCandidate = null;
            return;
        }
        const key = artKey(state.item, state.selectedTitle);
        const ticks = artCandidate?.key === key && artCandidate.url === state.artUrl ? artCandidate.ticks + 1 : 1;
        artCandidate = { key, url: state.artUrl, ticks };
        if (ticks >= LEARN_TICKS) rememberArt(key, state.artUrl);
    }

    // ---- detecting an equip ----

    let lastEquipPressAt = 0;

    // The equip press (the selected card pressed again, its button, or Space), handled before the game reacts, so the
    // screen still shows the old equipped skin. A skin that is not owned is not in the row, so every card is equippable.
    // One press can arrive more than once, so the ones right after the first are ignored.
    // `allowUnequip`: pressing the skin that is already equipped takes it off, and the game goes back to Standard.
    function saveOnEquip(allowUnequip: boolean): void {
        if (!skinsData || window.kaspGarageTab?.read() !== 'skins') return;
        const now = Date.now();
        if (now - lastEquipPressAt < EQUIP_DEBOUNCE_MS) return;
        lastEquipPressAt = now;
        const state = readSkinsScreen(skinsData.names);
        if (state.kind !== 'ready' || state.selectedTitle === null) return;
        const selectedIsEquipped = state.equipped.kind === 'skin'
            ? state.equipped.title.toLowerCase() === state.selectedTitle.toLowerCase()
            : state.selectedIsStandard;
        if (selectedIsEquipped) {
            if (allowUnequip && state.equipped.kind === 'skin') applyLearn({ kind: 'clear', item: state.item });
            return;
        }
        if (state.selectedIsStandard) {
            applyLearn({ kind: 'clear', item: state.item });
            return;
        }
        const url = seenArt.get(artKey(state.item, state.selectedTitle));
        if (url !== undefined) applyLearn({ kind: 'set', item: state.item, url });
    }

    let lastCardPress: { readonly title: string; readonly at: number } | null = null;

    function isTypingTarget(target: EventTarget | null): boolean {
        return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target.tagName));
    }

    // The title of the skin card a press landed on, or null when it was not on a card. A card has no stable class, so it
    // is the closest parent that holds exactly one card title.
    function pressedCardTitle(target: Element): string | null {
        for (let node: Element | null = target; node; node = node.parentElement) {
            if (node.matches(SKIN_TITLE_SELECTOR)) return (node.textContent ?? '').trim();
            const titles = node.querySelectorAll(SKIN_TITLE_SELECTOR);
            if (titles.length === 1) return (titles[0]?.textContent ?? '').trim();
            if (titles.length > 1) return null;
        }
        return null;
    }

    // The logs showed that no press ever lands on the equip button: a skin is equipped by pressing the card that is
    // already selected again (a double click). The button and Space are still watched.
    // On window, in the capture phase, and from pointerdown on: the game may handle the press early or redraw the button
    // before the click, and a press must be seen before anything else can stop it.
    window.addEventListener('pointerdown', (event) => {
        if (!(event.target instanceof Element) || window.kaspGarageTab?.read() !== 'skins') return;
        if (event.target.closest(EQUIP_BUTTON_SELECTOR) !== null) {
            saveOnEquip(true);
            return;
        }
        const title = pressedCardTitle(event.target);
        if (title === null || !skinsData) return;
        // Taking a skin off needs a real double press on it, so a single click on the equipped card never clears it.
        const now = Date.now();
        const doublePress = lastCardPress !== null && lastCardPress.title === title.toLowerCase() && now - lastCardPress.at < DOUBLE_PRESS_MS;
        lastCardPress = doublePress ? null : { title: title.toLowerCase(), at: now };
        const state = readSkinsScreen(skinsData.names);
        if (state.kind === 'ready' && state.selectedTitle?.toLowerCase() === title.toLowerCase()) saveOnEquip(doublePress);
    }, true);
    window.addEventListener('keydown', (event) => {
        if (event.code === 'Space' && !event.repeat && !isTypingTarget(event.target)) saveOnEquip(true);
    }, true);

    // ---- the tick ----

    function tick(): void {
        if (!skinsData || document.querySelector(GARAGE_SCREEN_SELECTOR) === null) return;
        const { names, defaults: prefilledDefaults } = skinsData;

        const skinsScreen = readSkinsScreen(names);
        trackSelectedArt(skinsScreen);
        learnFromSkinsScreen(skinsScreen, prefilledDefaults);

        // Read after learning, so a skin saved this tick is painted this tick. Each store is read once per tick.
        const savedSkins = readSavedSkins();
        const defaultImages = mergeDefaultImages(prefilledDefaults, readBaseImages());

        const learnedStock = syncTiles(names, savedSkins, defaultImages, prefilledDefaults);
        markMountedUnknownSkins(savedSkins, defaultImages, prefilledDefaults);
        if (learnedStock) writeStore(BASE_IMG_KEY, defaultImages);

        updateGlobalCSS(savedSkins, defaultImages);
    }

    loadArtMemory();
    setInterval(tick, TICK_MS);
})();
