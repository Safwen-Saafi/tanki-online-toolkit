// Isolated-world content script for the showroom garage's floor (build-plan 25). The floor picture is bundled in the extension, and
// only this world can ask Chrome for its address, so while the switch is on this puts that address on the page's root element,
// where src/modules/showroom.ts (MAIN world) reads it when the page has loaded; the same attribute turns on styles/showroom.css,
// which lets the screens' own backgrounds show the floor. In a battle the floor is hidden (styles/showroom.css again), from the
// battle service's existing check (src/modules/battle.ts), so it costs nothing there. The switch applies after a reload.
(function () {
    'use strict';

    const SWITCH_KEY = 'kasp_showroom';
    const FLOOR_ATTRIBUTE = 'data-kasp-showroom-floor';
    const BATTLE_ATTRIBUTE = 'data-kasp-showroom-battle';
    const FLOOR_PICTURE = 'showroom/floor.png';

    if (!(window.kaspSwitches?.isOn(SWITCH_KEY) ?? true)) return;
    try {
        document.documentElement.setAttribute(FLOOR_ATTRIBUTE, chrome.runtime.getURL(FLOOR_PICTURE));
    } catch {
        // no address: showroom.ts draws no floor and the game's background stays
        return;
    }
    window.kaspBattle?.onChange((on) => document.documentElement.toggleAttribute(BATTLE_ATTRIBUTE, on));
})();
