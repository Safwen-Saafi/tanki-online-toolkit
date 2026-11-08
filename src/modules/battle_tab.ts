// Isolated-world content script for the battle tab's coloured icons (build-plan 18c, split in two by 18e). The colours are a
// stylesheet (extension/styles/battle_tab.css), which the manifest always loads, so this script only switches it: while a
// switch is off, it puts that switch's attribute on the page's root element, and its colour rules apply only without it, so
// the game's own icons show.
(function () {
    'use strict';

    // The switch key, and the attribute that turns its colour rules off: the protection icons and their marker, then the
    // players' turret icons.
    const SWITCHES = [
        { key: 'kasp_protectioncolours', plain: 'data-kasp-plain-protections' },
        { key: 'kasp_turretcolours', plain: 'data-kasp-plain-turrets' },
    ] as const;

    // The user's switches, set in the extension's settings tab: read at start, and the switch service (src/modules/switches.ts)
    // calls back with every change, so it applies at once. Without the service every switch counts as on.
    for (const { key, plain } of SWITCHES) {
        const apply = (on: boolean): void => {
            document.documentElement.toggleAttribute(plain, !on);
        };
        apply(window.kaspSwitches?.isOn(key) ?? true);
        window.kaspSwitches?.onChange(key, apply);
    }
})();
