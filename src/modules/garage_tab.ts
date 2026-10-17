// Isolated-world content script. Publishes window.kaspGarageTab.read(), which says which tab of an item's
// garage screen is open. The Augments, Skins and Shot color tabs share one row of cards, so the tab is told
// apart by which menu item is active. The position is used, not the label, which changes with the language.
// Same rule as activeGarageCardSection() in the Kaspersky extension (src/core/gameAugments.ts).
(function () {
    'use strict';

    const TAB_ITEMS_SELECTOR = '.MenuComponentStyle-blockButtonsQECommunity .MenuComponentStyle-mainMenuItem';
    const TABS: readonly KaspGarageTab[] = ['augments', 'skins', 'shot-color'];

    function read(): KaspGarageTab | null {
        const items = Array.from(document.querySelectorAll(TAB_ITEMS_SELECTOR));
        // The garage's top category bar uses the same classes with seven items, so only two or three are tabs.
        if (items.length < 2 || items.length > 3) return null;
        const active = items.findIndex((item) => item.classList.contains('-activeMenu'));
        return TABS[active] ?? null;
    }

    window.kaspGarageTab = { read };
})();
