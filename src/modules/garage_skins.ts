// Isolated-world content script. Ported from modules.customGarageSkins in
// src/kasp_main.ts:2954-3168, but the equipped skin is no longer detected from previews and
// looked up in a database: its art URL is learned from the game's own Skins tab.
(function () {
    'use strict';

    type SavedSkins = Record<string, string>;
    type DefaultImagesMap = Record<string, string[]>;

    const STORAGE_KEY = 'kasp_equipped_skins';
    const BASE_IMG_KEY = 'kasp_base_images';
    let NAME_TRANSLATE: SkinsDatabase['names'] | null = null;
    let PREFILLED_DEFAULTS: SkinsDatabase['defaults'] | null = null;
    let dataReadyPromise: Promise<void> | null = null;

    function loadSkinsData(): Promise<void> {
        if (dataReadyPromise) return dataReadyPromise;
        dataReadyPromise = fetch(chrome.runtime.getURL('data/skins.json'))
            .then(res => {
                if (!res.ok) throw new Error('skins.json: HTTP ' + res.status);
                return res.json();
            })
            .then((data: SkinsDatabase) => {
                NAME_TRANSLATE = data.names;
                PREFILLED_DEFAULTS = data.defaults;
            })
            .catch(e => console.error('[KI-test][garage-skins] failed to load data/skins.json:', e));
        return dataReadyPromise;
    }
    loadSkinsData();

    function safeParseJSON<T>(raw: string | null): T | null {
        if (!raw) return null;
        try {
            return JSON.parse(raw) as T;
        } catch (e) {
            return null;
        }
    }

    function getSavedSkins(): SavedSkins {
        return safeParseJSON<SavedSkins>(localStorage.getItem(STORAGE_KEY)) || {};
    }

    function getDefaultImages(): DefaultImagesMap {
        try {
            const stored = safeParseJSON<Record<string, string | string[]>>(localStorage.getItem(BASE_IMG_KEY)) || {};
            const merged: DefaultImagesMap = {};

            for (const key in PREFILLED_DEFAULTS) {
                merged[key] = [PREFILLED_DEFAULTS[key]];
            }

            for (const key in stored) {
                if (!merged[key]) merged[key] = [];
                const val = stored[key];
                if (Array.isArray(val)) {
                    val.forEach(v => { if (v && !merged[key].includes(v)) merged[key].push(v); });
                } else if (val) {
                    if (!merged[key].includes(val)) merged[key].push(val);
                }
            }
            return merged;
        } catch (e) {
            const fallback: DefaultImagesMap = {};
            for (const key in PREFILLED_DEFAULTS) fallback[key] = [PREFILLED_DEFAULTS[key]];
            return fallback;
        }
    }

    function updateGlobalCSS(): void {
        const savedSkins = getSavedSkins();
        const defaultImages = getDefaultImages();
        let css = '';

        for (const item of Object.keys(defaultImages)) {
            const targetUrl = savedSkins[item];
            if (!targetUrl) continue;

            const finalUrls = defaultImages[item].filter(url => url !== targetUrl);

            if (finalUrls.length > 0) {
                const selectors = finalUrls.map(url =>
                    `.GarageItemComponentStyle-mainImg[src="${url}"], .garage-item img[src="${url}"], .MountedItemsStyle-itemPreview[src="${url}"]`
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
        const blocks = document.querySelectorAll('.MountedItemsStyle-commonBlockForTurretsHulls');
        blocks.forEach((block) => {
            const src = block.querySelector('.MountedItemsStyle-itemPreview')?.getAttribute('src') || '';
            const owner = Object.keys(savedSkins).find(item => defaultImages[item]?.includes(src));
            toggleUnknownLabel(block, !!owner && hasUnknownSkin(owner, savedSkins, prefilledDefaults));
        });
    }

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
        row.querySelectorAll('.SkinCellStyle-nameDevices').forEach((titleEl) => {
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
        const row = document.querySelector('.SkinsAndAlterationsStyle-SkinsVerticalComponent');
        const menu = document.querySelector('.GarageCommonStyle-subMenu');
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

    type LearnAction =
        | { readonly kind: 'none' }
        | { readonly kind: 'set'; readonly item: string; readonly title: string; readonly url: string }
        | { readonly kind: 'clear'; readonly item: string };

    // Learned URLs end up inside a CSS url("..."), so anything but a plain game image URL is refused.
    const SAFE_ART_URL = /^https:\/\/[a-z0-9.-]+\.tankionline\.com\/[A-Za-z0-9/_.-]+\.webp$/;

    function decideLearnAction(state: SkinsScreenState, stockUrl: string | undefined): LearnAction {
        if (state.kind === 'absent') return { kind: 'none' };
        if (state.equipped.kind === 'standard') return { kind: 'clear', item: state.item };

        const selectedIsEquipped = state.selectedTitle !== null
            && state.selectedTitle.toLowerCase() === state.equipped.title.toLowerCase();
        if (!selectedIsEquipped) return { kind: 'none' };

        const title = state.equipped.title;
        if (state.artUrl && SAFE_ART_URL.test(state.artUrl)) return { kind: 'set', item: state.item, title, url: state.artUrl };
        // Art that cannot be read stores the stock image, which is what raises the "unknown skin" label.
        return stockUrl ? { kind: 'set', item: state.item, title, url: stockUrl } : { kind: 'none' };
    }

    function writeSavedSkins(savedSkins: SavedSkins): void {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(savedSkins));
        } catch (e: unknown) {
            console.warn('[KI-test][garage-skins] could not save skins:', e instanceof Error ? e.message : e);
        }
    }

    type ChangeAction = Exclude<LearnAction, { kind: 'none' }>;

    let pendingLearn: { readonly key: string; readonly ticks: number; readonly action: ChangeAction } | null = null;

    // The one place a skin change is logged: only when the saved skin really changes.
    function applyLearn(action: ChangeAction): void {
        const savedSkins = getSavedSkins();
        if (action.kind === 'set') {
            if (savedSkins[action.item] === action.url) return;
            savedSkins[action.item] = action.url;
            console.log(`[KI-test][garage-skins] ${action.item}: equipped ${JSON.stringify(action.title)}`);
        } else {
            if (savedSkins[action.item] === undefined) return;
            delete savedSkins[action.item];
            console.log(`[KI-test][garage-skins] ${action.item}: equipped Standard`);
        }
        writeSavedSkins(savedSkins);
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

        // One tick can catch the marker and the preview out of step mid-render, so a change must hold for two.
        const key = action.kind === 'set' ? `set|${action.item}|${action.url}` : `clear|${action.item}`;
        pendingLearn = { key, ticks: pendingLearn?.key === key ? pendingLearn.ticks + 1 : 1, action };
        if (pendingLearn.ticks < 2) return;

        applyLearn(action);
    }

    // The art of each skin the user has had selected, kept while its picture was steady for two ticks. Pressing equip
    // and leaving at once can come before any tick sees the new equipped skin, but the art was known from the moment the
    // skin was selected, so the equip itself can save it.
    // It is also kept in the browser (kasp_skin_art), so a skin that was selected on an earlier visit is already known
    // the next time, with no waiting at all.
    const ART_MEMORY_KEY = 'kasp_skin_art';
    const ART_MEMORY_LIMIT = 300;
    const seenArt = new Map<string, string>();
    let artCandidate: { readonly key: string; readonly url: string; readonly ticks: number } | null = null;
    let lastUnlearnedKey: string | null = null;

    function artKey(item: string, title: string): string {
        return `${item}|${title.toLowerCase()}`;
    }

    function loadArtMemory(): void {
        const stored = safeParseJSON<Record<string, unknown>>(localStorage.getItem(ART_MEMORY_KEY));
        if (stored === null || typeof stored !== 'object') return;
        for (const [key, url] of Object.entries(stored)) {
            if (typeof url === 'string' && SAFE_ART_URL.test(url)) seenArt.set(key, url);
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
        try {
            localStorage.setItem(ART_MEMORY_KEY, JSON.stringify(Object.fromEntries(seenArt)));
        } catch (e: unknown) {
            console.warn('[KI-test][garage-skins] could not save the skin art memory:', e instanceof Error ? e.message : e);
        }
    }

    // Says once when a selected skin is not known yet, so an instant equip of it would not be saved right away.
    function noteUnlearned(state: Extract<SkinsScreenState, { kind: 'ready' }>, title: string): void {
        const key = artKey(state.item, title);
        if (state.selectedIsStandard || seenArt.has(key) || key === lastUnlearnedKey) return;
        lastUnlearnedKey = key;
        console.log(`[KI-test][garage-skins] ${state.item}: ${JSON.stringify(title)} selected, not learned yet`);
    }

    function trackSelectedArt(state: SkinsScreenState): void {
        if (state.kind !== 'ready' || state.selectedTitle === null) {
            artCandidate = null;
            return;
        }
        noteUnlearned(state, state.selectedTitle);
        if (!state.artUrl || !SAFE_ART_URL.test(state.artUrl)) {
            artCandidate = null;
            return;
        }
        const key = artKey(state.item, state.selectedTitle);
        const ticks = artCandidate?.key === key && artCandidate.url === state.artUrl ? artCandidate.ticks + 1 : 1;
        artCandidate = { key, url: state.artUrl, ticks };
        if (ticks >= 2) rememberArt(key, state.artUrl);
    }

    loadArtMemory();

    let lastEquipPressAt = 0;

    // The equip press (the selected card pressed again, its button, or Space), handled before the game reacts, so the
    // screen still shows the old equipped skin. A skin that is not owned is not in the row, so every card is equippable.
    // One press can arrive more than once, so the ones right after the first are ignored.
    // `allowUnequip`: pressing the skin that is already equipped takes it off, and the game goes back to Standard.
    function saveOnEquip(allowUnequip: boolean): void {
        if (!NAME_TRANSLATE || window.kaspGarageTab?.read() !== 'skins') return;
        const now = Date.now();
        if (now - lastEquipPressAt < 600) return;
        lastEquipPressAt = now;
        const state = readSkinsScreen(NAME_TRANSLATE);
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
        if (url !== undefined) applyLearn({ kind: 'set', item: state.item, title: state.selectedTitle, url });
    }

    const DOUBLE_PRESS_MS = 500;
    let lastCardPress: { readonly title: string; readonly at: number } | null = null;

    const EQUIP_BUTTON_SELECTOR = '.GarageTurretsAlterationsComponentStyle-mountStandardButton, .AlterationButtonStyle-commonButton';

    function isTypingTarget(target: EventTarget | null): boolean {
        return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target.tagName));
    }

    // On window, in the capture phase, and from pointerdown on: the game may handle the press early or redraw the button
    // before the click, and a press must be seen before anything else can stop it.
    const SKIN_CARD_TITLE = '.SkinCellStyle-nameDevices';

    // The title of the skin card a press landed on, or null when it was not on a card. A card has no stable class, so it
    // is the closest parent that holds exactly one card title.
    function pressedCardTitle(target: Element): string | null {
        for (let node: Element | null = target; node; node = node.parentElement) {
            if (node.matches(SKIN_CARD_TITLE)) return (node.textContent ?? '').trim();
            const titles = node.querySelectorAll(SKIN_CARD_TITLE);
            if (titles.length === 1) return (titles[0]?.textContent ?? '').trim();
            if (titles.length > 1) return null;
        }
        return null;
    }

    // The logs showed that no press ever lands on the equip button: a skin is equipped by pressing the card that is
    // already selected again (a double click). The button and Space are still watched.
    window.addEventListener('pointerdown', (event) => {
        if (!(event.target instanceof Element) || window.kaspGarageTab?.read() !== 'skins') return;
        if (event.target.closest(EQUIP_BUTTON_SELECTOR) !== null) {
            saveOnEquip(true);
            return;
        }
        const title = pressedCardTitle(event.target);
        if (title === null || !NAME_TRANSLATE) return;
        // Taking a skin off needs a real double press on it, so a single click on the equipped card never clears it.
        const now = Date.now();
        const doublePress = lastCardPress !== null && lastCardPress.title === title.toLowerCase() && now - lastCardPress.at < DOUBLE_PRESS_MS;
        lastCardPress = doublePress ? null : { title: title.toLowerCase(), at: now };
        const state = readSkinsScreen(NAME_TRANSLATE);
        if (state.kind === 'ready' && state.selectedTitle?.toLowerCase() === title.toLowerCase()) saveOnEquip(doublePress);
    }, true);
    window.addEventListener('keydown', (event) => {
        if (event.code === 'Space' && !event.repeat && !isTypingTarget(event.target)) saveOnEquip(true);
    }, true);

    function isGarageScreen(): boolean {
        return !!document.querySelector(
            '.GarageCommonStyle-positionContent, .GarageItemComponent-container, .ContainerInfoComponentStyle-lootBoxContainer, .GarageMainScreenStyle-blockParameters, .SkinsAndAlterationsStyle-SkinsVerticalComponent'
        );
    }

    function tick(): void {
        if (!NAME_TRANSLATE || !PREFILLED_DEFAULTS) return; // data still loading
        if (!isGarageScreen()) return;

        const nameTranslate = NAME_TRANSLATE;
        const prefilledDefaults = PREFILLED_DEFAULTS;

        const skinsScreen = readSkinsScreen(nameTranslate);
        trackSelectedArt(skinsScreen);
        learnFromSkinsScreen(skinsScreen, prefilledDefaults);

        const defaultImages = getDefaultImages();
        let defaultsUpdated = false;
        const savedSkinsForList = getSavedSkins();

        const garageItems = document.querySelectorAll('.garage-item');
        garageItems.forEach((item) => {
            const titleSpan = item.querySelector('.GarageItemComponentStyle-descriptionDevice span');
            const imgMain = item.querySelector('.GarageItemComponentStyle-mainImg');

            if (titleSpan && imgMain) {
                const rawTitle = (titleSpan.textContent ?? '').trim().toLowerCase();
                const itemNameEN = nameTranslate[rawTitle.split(/\s+/)[0]] || rawTitle.split(/\s+/)[0];
                const originalSrc = imgMain.getAttribute('src') || '';

                // A tile already showing the saved skin's URL is not stock art, so it must not be learned as stock.
                if (originalSrc && originalSrc.includes('tankionline.com') && originalSrc !== savedSkinsForList[itemNameEN]) {
                    if (!defaultImages[itemNameEN]) defaultImages[itemNameEN] = [];
                    if (!defaultImages[itemNameEN].includes(originalSrc)) {
                        defaultImages[itemNameEN].push(originalSrc);
                        defaultsUpdated = true;
                    }
                }

                toggleUnknownLabel(item, hasUnknownSkin(itemNameEN, savedSkinsForList, prefilledDefaults));
            }
        });

        markMountedUnknownSkins(savedSkinsForList, defaultImages, prefilledDefaults);

        if (defaultsUpdated) {
            localStorage.setItem(BASE_IMG_KEY, JSON.stringify(defaultImages));
        }

        updateGlobalCSS();
    }

    setInterval(tick, 250);
})();
