// Isolated-world content script. Fixed port of modules.customGarageSkins from
// src/kasp_main.ts:2954-3168 (branch fix/garage-skins-unrecognized-fallback):
// - detects the equipped brand from the real mounted/preview image, not thumbnail-list order
// - falls back to the Standard image when the equipped skin matches no known brand
(function () {
    'use strict';

    type SavedSkins = Record<string, string>;
    type DefaultImagesMap = Record<string, string[]>;

    const STORAGE_KEY = 'kasp_equipped_skins';
    const BASE_IMG_KEY = 'kasp_base_images';
    let SKIN_BRANDS_MAP: SkinsDatabase['brands'] | null = null;
    let NAME_TRANSLATE: SkinsDatabase['names'] | null = null;
    let PREFILLED_DEFAULTS: SkinsDatabase['defaults'] | null = null;
    let SKINS_DATABASE: SkinsDatabase['database'] | null = null;
    let dataReadyPromise: Promise<void> | null = null;

    function loadSkinsData(): Promise<void> {
        if (dataReadyPromise) return dataReadyPromise;
        dataReadyPromise = fetch(chrome.runtime.getURL('database/skins.json'))
            .then(res => {
                if (!res.ok) throw new Error('skins.json: HTTP ' + res.status);
                return res.json();
            })
            .then((data: SkinsDatabase) => {
                SKIN_BRANDS_MAP = data.brands;
                NAME_TRANSLATE = data.names;
                PREFILLED_DEFAULTS = data.defaults;
                SKINS_DATABASE = data.database;
                console.log('[KI-test][garage-skins] database loaded');
            })
            .catch(e => console.error('[KI-test][garage-skins] failed to load database/skins.json:', e));
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
        // Invariant: only called from tick() after the "!SKIN_BRANDS_MAP" load
        // guard, so all four database fields are populated together here.
        const skinsDatabase = SKINS_DATABASE!;
        const savedSkins = getSavedSkins();
        const defaultImages = getDefaultImages();
        let css = '';

        const allItems = new Set([...Object.keys(defaultImages), ...Object.keys(skinsDatabase)]);

        for (const item of allItems) {
            const targetUrl = savedSkins[item];
            if (!targetUrl) continue;

            const urlsToOverride: string[] = [];
            if (defaultImages[item]) {
                urlsToOverride.push(...defaultImages[item]);
            }

            if (skinsDatabase[item]) {
                for (const skinUrl of Object.values(skinsDatabase[item])) {
                    if (skinUrl) urlsToOverride.push(skinUrl);
                }
            }

            const finalUrls = urlsToOverride.filter(url => url !== targetUrl);

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

    let lastItemName = "";
    let readAllowedTime = 0;

    function isGarageScreen(): boolean {
        return !!document.querySelector(
            '.GarageCommonStyle-positionContent, .GarageItemComponent-container, .ContainerInfoComponentStyle-lootBoxContainer'
        );
    }

    function tick(): void {
        if (!SKIN_BRANDS_MAP) return; // database still loading
        if (!isGarageScreen()) return;

        // Invariant: guarded by the SKIN_BRANDS_MAP check above - all four
        // database fields are set together in loadSkinsData()'s .then().
        const nameTranslate = NAME_TRANSLATE!;
        const skinsDatabase = SKINS_DATABASE!;
        const prefilledDefaults = PREFILLED_DEFAULTS!;
        const skinBrandsMap = SKIN_BRANDS_MAP;

        const defaultImages = getDefaultImages();
        let defaultsUpdated = false;

        const garageItems = document.querySelectorAll('.garage-item');
        garageItems.forEach((item) => {
            const titleSpan = item.querySelector('.GarageItemComponentStyle-descriptionDevice span');
            const imgMain = item.querySelector('.GarageItemComponentStyle-mainImg');

            if (titleSpan && imgMain) {
                const rawTitle = (titleSpan.textContent ?? '').trim().toLowerCase();
                const itemNameEN = nameTranslate[rawTitle.split(/\s+/)[0]] || rawTitle.split(/\s+/)[0];
                const originalSrc = imgMain.getAttribute('src') || '';

                if (originalSrc && originalSrc.includes('tankionline.com')) {
                    let isCustomSkin = false;
                    if (skinsDatabase[itemNameEN]) {
                        isCustomSkin = Object.values(skinsDatabase[itemNameEN]).includes(originalSrc);
                    }

                    if (!isCustomSkin) {
                        if (!defaultImages[itemNameEN]) defaultImages[itemNameEN] = [];
                        if (!defaultImages[itemNameEN].includes(originalSrc)) {
                            defaultImages[itemNameEN].push(originalSrc);
                            defaultsUpdated = true;
                        }
                    }
                }
            }
        });

        if (defaultsUpdated) {
            localStorage.setItem(BASE_IMG_KEY, JSON.stringify(defaultImages));
        }

        const nameEl = document.querySelector('.ItemDescriptionComponentStyle-nameItem span')
            || document.querySelector('.garage-item.-active .GarageItemComponentStyle-descriptionDevice span');

        if (nameEl) {
            const rawName = (nameEl.textContent ?? '').trim().toLowerCase();
            const firstWord = rawName.split(/\s+/)[0];
            const itemNameEN = nameTranslate[firstWord] || firstWord;

            if (itemNameEN !== lastItemName) {
                lastItemName = itemNameEN;
                readAllowedTime = Date.now() + 400;
            }

            if (Date.now() >= readAllowedTime) {
                const skinImgs = document.querySelectorAll('.SkinsIconComponentStyle-cellSkins img');
                let foundBrand: string | null = null;

                const previewImg = document.querySelector('.MountedItemsStyle-itemPreview, .ItemDescriptionComponentStyle-previewImg img');
                if (previewImg) {
                    const currentSrc = previewImg.getAttribute('src') || '';
                    if (skinsDatabase[itemNameEN]) {
                        for (const [brand, url] of Object.entries(skinsDatabase[itemNameEN])) {
                            if (url === currentSrc) {
                                foundBrand = brand;
                                break;
                            }
                        }
                    }
                    if (!foundBrand && prefilledDefaults[itemNameEN] === currentSrc) {
                        foundBrand = 'default';
                    }
                }

                if (!foundBrand && !previewImg) {
                    for (const skinImg of skinImgs) {
                        const src = skinImg.getAttribute('src') || '';
                        if (skinBrandsMap[src]) {
                            foundBrand = skinBrandsMap[src];
                            break;
                        } else if (src.includes('ic_standard') || src.includes('standard')) {
                            foundBrand = 'default';
                            break;
                        }
                    }
                }

                if (foundBrand) {
                    const savedSkins = getSavedSkins();
                    let skinsUpdated = false;

                    if (foundBrand === 'default') {
                        if (savedSkins[itemNameEN]) {
                            delete savedSkins[itemNameEN];
                            skinsUpdated = true;
                        }
                    } else if (skinsDatabase[itemNameEN] && skinsDatabase[itemNameEN][foundBrand]) {
                        const targetUrl = skinsDatabase[itemNameEN][foundBrand];
                        if (savedSkins[itemNameEN] !== targetUrl) {
                            savedSkins[itemNameEN] = targetUrl;
                            skinsUpdated = true;
                        }
                    }

                    if (skinsUpdated) {
                        localStorage.setItem(STORAGE_KEY, JSON.stringify(savedSkins));
                    }
                } else if (skinImgs.length > 0) {
                    const savedSkins = getSavedSkins();
                    const fallbackUrl = prefilledDefaults[itemNameEN];
                    if (fallbackUrl && savedSkins[itemNameEN] !== fallbackUrl) {
                        savedSkins[itemNameEN] = fallbackUrl;
                        localStorage.setItem(STORAGE_KEY, JSON.stringify(savedSkins));
                    }
                }
            }
        }

        updateGlobalCSS();
    }

    setInterval(tick, 250);
    console.log('[KI-test] garageSkins isolated-world content script loaded');
})();
